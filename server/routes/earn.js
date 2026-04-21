import fs from 'node:fs';

function registerEarnRoute(ctx) {
  const { core, wallet, economy, sybil, quest, game, arena } = ctx;
  const { ipRateLimit, getClientIp, respondJson, requireJwt, readBody, normalizePubkey } = core;
  const {
    walletDatabase,
    mintedAddresses,
    getStakingBoost,
    updateWalletEntry,
    getCoinBalance,
    setCoinBalance,
    addCoinEarned,
    saveWalletDatabaseDebounced,
    getPrismBalance,
    prismTransactions,
    savePrismDataDebounced,
    feedItems,
    pushNotification,
  } = wallet;
  const {
    prismEarnMaxPerCall,
    firstMintLocks,
    getPrismEarnRateLimit,
    prismEarnCooldownTable,
    prismEarnCooldownDefault,
    setPrismEarnRateLimit,
    prismEarnRateLimit,
    rateLimitStore,
    getHolderAdjustedCap,
    applyStakingBoostAfterCap,
    getScanRewardState,
    cleanScanRewardCooldownMs,
    scanWalletReward,
    computeSybilHuntReward,
    dailyHuntCap,
    dailyScanCap,
    nonGameDailyEarnCap,
    normalizeScanRewardState,
  } = economy;
  const { getRecentSybilAnalysis, getSybilVerdict, getSybilRewardPath } = sybil;
  const { questSourceIds, getQuestProgressSnapshot, quests, saveQuestProgressDebounced, validTextQuestIds } =
    quest;
  const { verifyGameEarnClaim, getGameCoinsToday, dailyGameCoinCap, addGameCoinsToday, markGameEarnClaimed } =
    game;
  const { activeChallenges, challengesFile } = arena;

  return async function handleEarnRoute(req, res, url, pathname) {
    if (pathname !== '/api/prism/earn' || req.method !== 'POST') return false;

    if (!ipRateLimit('prism_earn_burst', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many earn requests, slow down' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return true;
    try {
      const {
        address: bodyAddress,
        source,
        amount,
        description,
        questId,
        scanTarget: scanTargetRaw,
        gameSessionId,
      } = JSON.parse(await readBody(req));
      const address = jwtAuth.address;
      if (bodyAddress && bodyAddress !== address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!address || !amount) return respondJson(res, 400, { error: 'address and amount required' });
      if (!source || !prismEarnMaxPerCall[source]) return respondJson(res, 400, { error: 'Invalid earn source' });
      const maxAllowed = prismEarnMaxPerCall[source];
      if (!Number.isFinite(Number(amount)) || Number(amount) > maxAllowed) return respondJson(res, 400, { error: `Max ${maxAllowed} Coins per ${source || 'action'}` });
      if (source === 'first_mint') {
        if (firstMintLocks.has(address)) return respondJson(res, 400, { error: 'first_mint already claimed' });
        const firstMintWallet = walletDatabase.get(address);
        if (firstMintWallet?._firstMintClaimed) return respondJson(res, 400, { error: 'first_mint already claimed' });
      }

      const rlKey = `${address}:${source || 'unknown'}`;
      const lastEarn = getPrismEarnRateLimit(rlKey) || 0;
      const cooldownMs = prismEarnCooldownTable[source] ?? prismEarnCooldownDefault;
      if (Date.now() - lastEarn < cooldownMs) {
        return respondJson(res, 429, { error: 'Rate limited — try again later', cooldownMs: cooldownMs - (Date.now() - lastEarn) });
      }
      const globalKey = `${address}:__global__`;
      const lastGlobal = getPrismEarnRateLimit(globalKey) || 0;
      if (Date.now() - lastGlobal < 2000) {
        return respondJson(res, 429, { error: 'Too many requests — slow down' });
      }
      setPrismEarnRateLimit(globalKey, Date.now());
      setPrismEarnRateLimit(rlKey, Date.now());
      if (prismEarnRateLimit.size > 5000) {
        rateLimitStore.cleanup();
      }
      let earned = Math.max(0, Math.floor(Number(amount)));
      if (earned <= 0) return respondJson(res, 400, { error: 'amount must be positive' });
      const GAME_EARN_SOURCES = new Set(['game_orbit', 'game_defender', 'game_gravity']);

      if (source === 'achievement') {
        return respondJson(res, 400, { error: 'Use POST /api/game/achievements for achievement rewards' });
      }
      if (source === 'referral') {
        return respondJson(res, 400, { error: 'Use POST /api/referral/claim for referral rewards' });
      }

      if (GAME_EARN_SOURCES.has(source)) {
        const verifiedGame = verifyGameEarnClaim(address, source, gameSessionId);
        if (!verifiedGame.ok) return respondJson(res, 400, { error: verifiedGame.error });

        const todayCoins = getGameCoinsToday(address);
        const isHolder = mintedAddresses.has(address);
        const gameCap = getHolderAdjustedCap(dailyGameCoinCap, isHolder);
        if (todayCoins >= gameCap) return respondJson(res, 429, { error: 'Daily game coin cap reached', dailyRemaining: 0 });

        let baseDelta = Math.min(earned, gameCap - todayCoins);
        addGameCoinsToday(address, baseDelta);
        markGameEarnClaimed(gameSessionId, source, baseDelta);

        const gameBoost = getStakingBoost(address);
        earned = applyStakingBoostAfterCap(baseDelta, gameBoost);
      } else {
        if (source === 'quest_daily' || source === 'quest_weekly' || source === 'quest_milestone') {
          const allowedQuestIds = questSourceIds[source];
          if (!questId || !allowedQuestIds?.has(questId)) {
            return respondJson(res, 400, { error: `Invalid questId for ${source}` });
          }

          const snapshot = getQuestProgressSnapshot(address);
          const questState = snapshot[questId];
          if (!questState?.completed) {
            return respondJson(res, 400, { error: 'Quest is not completed on server' });
          }

          const existingQuestState = quests.get(address) || { quests: {}, streakDays: 0 };
          const prevQuest = existingQuestState.quests?.[questId] || {};
          if (prevQuest.claimed === true && (prevQuest.periodKey || 'all_time') === questState.periodKey) {
            return respondJson(res, 400, { error: 'Quest reward already claimed' });
          }

          quests.set(address, {
            ...existingQuestState,
            quests: {
              ...(existingQuestState.quests || {}),
              [questId]: {
                ...prevQuest,
                progress: questState.progress,
                completed: true,
                claimed: true,
                periodKey: questState.periodKey,
                completedAt: prevQuest.completedAt || new Date().toISOString(),
                claimedAt: new Date().toISOString(),
              },
            },
            updatedAt: new Date().toISOString(),
          });
          saveQuestProgressDebounced();
        }

        if (source === 'first_mint') {
          firstMintLocks.add(address);
          updateWalletEntry(address, { _firstMintClaimed: true });
        }
        if (source === 'text_quest') {
          const qid = String(questId || '').trim();
          if (!qid || !validTextQuestIds.has(qid)) return respondJson(res, 400, { error: 'Invalid or missing questId' });
          const w = walletDatabase.get(address) || {};
          const completedQuests = w._completedTextQuests || {};
          if (completedQuests[qid]) return respondJson(res, 400, { error: 'Quest reward already claimed' });
          updateWalletEntry(address, { _completedTextQuests: { ...completedQuests, [qid]: Date.now() } });
        }
        if (source === 'challenge_win') {
          const recentChallenges = Array.from(activeChallenges.values()).filter(
            c => c.status === 'completed' && c.winner === address && !c.earnClaimed && Date.now() - new Date(c.completedAt || c.createdAt).getTime() < 600_000
          );
          if (recentChallenges.length === 0) return respondJson(res, 400, { error: 'No recent challenge win found' });
          recentChallenges[0].earnClaimed = true;
          try {
            const tmpFile = challengesFile + '.tmp';
            await fs.promises.writeFile(tmpFile, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), challenges: activeChallenges }, null, 2));
            await fs.promises.rename(tmpFile, challengesFile);
          } catch {}
        }

        let scanRewardState = null;
        let scanRewardTarget = null;
        if (source === 'scan_wallet' || source === 'sybil_hunt') {
          const normalizedTarget = normalizePubkey(scanTargetRaw || (source === 'scan_wallet' ? address : ''));
          if (!normalizedTarget) return respondJson(res, 400, { error: 'scanTarget required' });
          if (source === 'sybil_hunt' && normalizedTarget === address) {
            return respondJson(res, 400, { error: 'Cannot claim sybil bounty for your own wallet' });
          }
          const analysis = getRecentSybilAnalysis(normalizedTarget);
          if (!analysis || !Number.isFinite(Number(analysis.trustScore))) {
            return respondJson(res, 400, { error: 'Scan target must be analyzed before claiming reward' });
          }
          const verdict = getSybilVerdict(analysis);
          const rewardPath = verdict?.rewardPath || getSybilRewardPath(analysis);
          const isSybilTarget = rewardPath === 'sybil_hunt';
          if (source === 'sybil_hunt' && !isSybilTarget) {
            return respondJson(res, 400, { error: 'Target does not qualify for sybil bounty' });
          }
          if (source === 'scan_wallet' && isSybilTarget) {
            return respondJson(res, 400, { error: 'Flagged target must use sybil_hunt reward path' });
          }

          scanRewardState = getScanRewardState(address);
          scanRewardTarget = normalizedTarget;
          if (source === 'scan_wallet') {
            const lastClaimedAt = Number(scanRewardState.cleanClaims[normalizedTarget]) || 0;
            const cooldownRemaining = cleanScanRewardCooldownMs - (Date.now() - lastClaimedAt);
            if (lastClaimedAt && cooldownRemaining > 0) {
              return respondJson(res, 429, { error: 'Scan reward already claimed recently for this wallet', cooldownMs: cooldownRemaining });
            }
            earned = scanWalletReward;
          } else {
            if (scanRewardState.sybilClaims[normalizedTarget]) {
              return respondJson(res, 400, { error: 'Sybil bounty already claimed for this wallet' });
            }
            earned = computeSybilHuntReward(Object.keys(scanRewardState.sybilClaims).length + 1);
          }
        }

        const today = new Date().toISOString().slice(0, 10);
        const SUB_CAPS = { sybil_hunt: dailyHuntCap, scan_wallet: dailyScanCap };
        if (SUB_CAPS[source]) {
          const subKey = `subcap:${address}:${source}:${today}`;
          const subEntry = getPrismEarnRateLimit(subKey) || 0;
          if (subEntry >= SUB_CAPS[source]) return respondJson(res, 429, { error: `Daily ${source.replace('_', ' ')} cap reached (${SUB_CAPS[source]} coins/day)`, dailyRemaining: 0 });
          if (scanRewardState && subEntry + earned > SUB_CAPS[source]) {
            return respondJson(res, 429, {
              error: `Verified ${source.replace('_', ' ')} reward would exceed daily cap`,
              dailyRemaining: Math.max(0, SUB_CAPS[source] - subEntry),
            });
          }
          if (!scanRewardState) earned = Math.min(earned, SUB_CAPS[source] - subEntry);
          setPrismEarnRateLimit(subKey, subEntry + earned);
        }

        const isHolder = mintedAddresses.has(address);
        const nonGameCap = getHolderAdjustedCap(nonGameDailyEarnCap, isHolder);
        const ngKey = `nongame_daily:${address}`;
        const ngEntry = getPrismEarnRateLimit(ngKey);
        let ngEarned = 0;
        if (ngEntry && typeof ngEntry === 'object' && ngEntry.date === today) {
          ngEarned = ngEntry.total || 0;
        }
        if (ngEarned >= nonGameCap) return respondJson(res, 429, { error: 'Daily earn cap reached', dailyRemaining: 0 });
        if (scanRewardState && ngEarned + earned > nonGameCap) {
          return respondJson(res, 429, {
            error: 'Not enough daily earn cap remaining for verified reward',
            dailyRemaining: Math.max(0, nonGameCap - ngEarned),
          });
        }
        if (!scanRewardState) earned = Math.min(earned, nonGameCap - ngEarned);
        setPrismEarnRateLimit(ngKey, { date: today, total: ngEarned + earned });
        const earnBoost = getStakingBoost(address);
        earned = applyStakingBoostAfterCap(earned, earnBoost);
        if (scanRewardState && scanRewardTarget) {
          const nextScanRewardState = normalizeScanRewardState(scanRewardState);
          if (source === 'scan_wallet') nextScanRewardState.cleanClaims[scanRewardTarget] = Date.now();
          if (source === 'sybil_hunt') nextScanRewardState.sybilClaims[scanRewardTarget] = Date.now();
          updateWalletEntry(address, { _scanRewardState: nextScanRewardState });
        }
      }

      const prevBal = getCoinBalance(address);
      const newBal = prevBal + earned;
      setCoinBalance(address, newBal);
      addCoinEarned(address, earned);
      const wEarn = walletDatabase.get(address);
      if (wEarn) {
        wEarn.coins = newBal;
        saveWalletDatabaseDebounced();
      }
      const bal = getPrismBalance(address);
      const tx = {
        id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        address, amount: earned, type: 'earn', source: source || 'unknown',
        description: description || `Earned ${earned} Coins`,
        timestamp: new Date().toISOString(),
      };
      const txs = prismTransactions.get(address) || [];
      txs.unshift(tx);
      if (txs.length > 500) txs.length = 500;
      prismTransactions.set(address, txs);
      savePrismDataDebounced();
      feedItems.unshift({
        id: tx.id,
        type: source?.includes('burn') ? 'burn' : source?.includes('game') ? 'achievement' : 'scan',
        address,
        description: description || `Earned ${earned} Coins from ${source}`,
        timestamp: tx.timestamp,
      });
      if (feedItems.length > 200) feedItems.length = 200;
      if (source === 'challenge_win') {
        const wCh = walletDatabase.get(address) || {};
        const ssCh = wCh.socialStats || { challengesWon: 0, constellationExplored: 0, compareCount: 0 };
        ssCh.challengesWon = (ssCh.challengesWon || 0) + 1;
        updateWalletEntry(address, { socialStats: ssCh });
      }
      if (source === 'quest_milestone') {
        const questName = description || 'Quest';
        pushNotification(address, 'quest_milestone', `Quest completed: ${questName}`, { questId: questId || null });
      }
      respondJson(res, 200, { balance: bal, earned });
    } catch {
      respondJson(res, 400, { error: 'Invalid request body' });
    }
    return true;
  };
}

export { registerEarnRoute };
