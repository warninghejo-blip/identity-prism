function registerUserDataRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      readBody,
      requireJwt,
    },
    wallet: {
      walletDatabase,
      mintedAddresses,
      getPrismBalance,
      getScoreHistory,
      updateWalletEntry,
      triggerCompositeUpdate,
      prismTransactions,
    },
    economy: {
      getPrismEarnRateLimit,
      setPrismEarnRateLimit,
      getHolderAdjustedCap,
      nonGameDailyEarnCap,
      dailyQuizCap,
      quizCorrectReward,
      dailyGameCoinCap,
      dailyHuntCap,
      dailyScanCap,
      dailyBlackHoleCleanupCap,
    },
    addScoreEntry,
    getIdentityHolderPerks,
    getOrCreateForgeState,
    getServerRangerSnapshot,
    getWalletUserData,
    getGameCoinsToday,
    sanitizeForgeLoadout,
  } = ctx;

  return async function handleUserDataRoute(req, res, url, pathname) {
    if (pathname === '/api/identity/perks' && req.method === 'GET') {
      if (!ipRateLimit('identity_perks_get', getClientIp(req), 120, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const addr = url.searchParams.get('address') || '';
      if (!addr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
        respondJson(res, 400, { error: 'valid address required' });
        return true;
      }
      const perks = await getIdentityHolderPerks(addr);
      respondJson(res, 200, { address: addr, ...perks });
      return true;
    }

    if (pathname === '/api/score-history' && req.method === 'GET') {
      if (!ipRateLimit('score_hist', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const addr = url.searchParams.get('address') || '';
      if (!addr) {
        respondJson(res, 400, { error: 'address query param required' });
        return true;
      }
      const history = getScoreHistory(addr);
      respondJson(res, 200, { address: addr, scores: history.scores, lastUpdated: history.lastUpdated });
      return true;
    }

    if (pathname === '/api/score-history' && req.method === 'POST') {
      if (!ipRateLimit('score_hist_post', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw);
        const { address: addr } = parsed;
        if (!addr || typeof addr !== 'string') {
          respondJson(res, 400, { error: 'address (string) required' });
          return true;
        }
        if (addr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
        // Security: ignore client-provided score — use server-computed value to prevent tier self-elevation
        const existingWallet = walletDatabase.get(addr) || {};
        const serverScore = existingWallet?.composite?.score ?? existingWallet?.score ?? 0;
        const computedTier = serverScore >= 800 ? 'binary_sun' : serverScore >= 600 ? 'pulsar' : serverScore >= 400 ? 'neutron_star' : serverScore >= 200 ? 'dwarf_star' : 'mercury';
        const entry = addScoreEntry(addr, serverScore, computedTier);
        updateWalletEntry(addr, {
          firstSeenAt: existingWallet.firstSeenAt || new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          scanCount: (existingWallet.scanCount || 0) + ((() => {
            const scanKey = `scan_daily:${addr}`;
            const today = new Date().toISOString().slice(0, 10);
            const scanEntry = getPrismEarnRateLimit(scanKey);
            if (scanEntry && typeof scanEntry === 'object' && scanEntry.date === today && scanEntry.count >= 5) return 0;
            setPrismEarnRateLimit(scanKey, { date: today, count: ((scanEntry && scanEntry.date === today) ? scanEntry.count : 0) + 1 });
            return 1;
          })()),
          score: serverScore,
          tier: computedTier,
          source: 'live',
        });
        triggerCompositeUpdate(addr);
        respondJson(res, 200, { address: addr, scores: entry.scores, lastUpdated: entry.lastUpdated });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      }
      return true;
    }

    if (pathname === '/api/prism/balance' && req.method === 'GET') {
      if (!ipRateLimit('prismBal', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const address = url.searchParams.get('address');
      if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid address' });
      respondJson(res, 200, getPrismBalance(address));
      return true;
    }

    if (pathname === '/api/prism/summary' && req.method === 'GET') {
      if (!ipRateLimit('prismSummary', getClientIp(req), 60, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const address = url.searchParams.get('address');
      if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid address' });
      const wallet = walletDatabase.get(address);
      if (!wallet) return respondJson(res, 404, { error: 'Wallet not found' });
      const compositeScore = Number(wallet.composite?.compositeScore);
      const compositeTier = typeof wallet.composite?.compositeTier === 'string' ? wallet.composite.compositeTier : '';
      const details = wallet.composite?.details || null;
      respondJson(res, 200, {
        address,
        score: Number.isFinite(compositeScore) ? compositeScore : (wallet.score || 0),
        tier: compositeTier || wallet.tier || 'mercury',
        badges: wallet.badges || [],
        mint: {
          ...(wallet.mint && typeof wallet.mint === 'object' ? wallet.mint : {}),
          minted: Boolean(wallet.mint?.minted || mintedAddresses.has(address)),
        },
        composite: wallet.composite
          ? {
              compositeScore: wallet.composite.compositeScore,
              compositeTier: wallet.composite.compositeTier,
              breakdown: wallet.composite.breakdown,
              details,
            }
          : null,
        scoreDetails: details,
        scoreBreakdown: details?.onchain?.scoreBreakdown || wallet.scoreBreakdown || null,
        tournamentXP: wallet.tournamentXP || 0,
      });
      return true;
    }

    if (pathname === '/api/xp' && req.method === 'GET') {
      if (!ipRateLimit('xp', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const address = url.searchParams.get('address') || jwtAuth.address;
      if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid address' });
      if (address !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      const snapshot = getServerRangerSnapshot(address);
      respondJson(res, 200, { sources: snapshot.sources, computedXP: snapshot.xp, computedRank: snapshot.rank });
      return true;
    }

    if (pathname === '/api/daily-limits' && req.method === 'GET') {
      if (!ipRateLimit('dailyLimits', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const requestedAddress = url.searchParams.get('address') || '';
      const authHeader = req.headers['authorization'] ?? '';
      const hasAuthToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');
      let address = requestedAddress;

      if (hasAuthToken || !address) {
        const jwtAuth = requireJwt(req, res);
        if (!jwtAuth.ok) return true;
        address = requestedAddress || jwtAuth.address;
        if (requestedAddress && requestedAddress !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      }

      if (!address) return respondJson(res, 400, { error: 'address required' });
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid address' });
      const today = new Date().toISOString().slice(0, 10);
      const gameToday = getGameCoinsToday ? getGameCoinsToday(address) : 0;
      const nonGameEntry = getPrismEarnRateLimit(`nongame_daily:${address}`);
      const nonGameToday = (nonGameEntry && typeof nonGameEntry === 'object' && nonGameEntry.date === today) ? (nonGameEntry.total || 0) : 0;
      const huntToday = getPrismEarnRateLimit(`subcap:${address}:sybil_hunt:${today}`) || 0;
      const scanToday = getPrismEarnRateLimit(`subcap:${address}:scan_wallet:${today}`) || 0;
      const quizToday = (getPrismEarnRateLimit(`quiz:${address}:${today}`) || 0) * quizCorrectReward;
      const blackHoleToday = getPrismEarnRateLimit(`blackhole_cleanup:${address}:${today}`) || 0;
      const isHolder = mintedAddresses.has(address);
      const gameCap = getHolderAdjustedCap(dailyGameCoinCap ?? 2000, isHolder);
      const nonGameCap = getHolderAdjustedCap(nonGameDailyEarnCap, isHolder);
      respondJson(res, 200, {
        game: { earned: gameToday, cap: gameCap },
        hunt: { earned: huntToday, cap: dailyHuntCap },
        scan: { earned: scanToday, cap: dailyScanCap },
        quiz: { earned: quizToday, cap: dailyQuizCap },
        nonGame: { earned: nonGameToday, cap: nonGameCap },
        blackHole: { earned: blackHoleToday, cap: dailyBlackHoleCleanupCap },
        blackHoleCap: dailyBlackHoleCleanupCap,
      });
      return true;
    }

    if (pathname === '/api/prism/transactions' && req.method === 'GET') {
      if (!ipRateLimit('prism_txs', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const address = jwtAuth.address;
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      if (!address) return respondJson(res, 400, { error: 'address required' });
      const txs = (prismTransactions.get(address) || []).slice(0, limit);
      respondJson(res, 200, txs);
      return true;
    }

    if (pathname === '/api/user-data' && req.method === 'GET') {
      if (!ipRateLimit('user_data_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const address = jwtAuth.address;
      const walletEntry = walletDatabase.get(address) || { address };
      const { forgeState, changed: forgeStateChanged } = getOrCreateForgeState(address, walletEntry);
      const existingUserData = getWalletUserData(walletEntry);
      const sanitizedLoadout = sanitizeForgeLoadout(address, existingUserData.loadout, forgeState);
      const userData = {
        ...existingUserData,
        loadout: sanitizedLoadout,
      };
      if (forgeStateChanged || JSON.stringify(existingUserData.loadout || null) !== JSON.stringify(sanitizedLoadout)) {
        updateWalletEntry(address, { forgeState, userData });
      }
      respondJson(res, 200, { address, userData });
      return true;
    }

    if (pathname === '/api/user-data' && req.method === 'POST') {
      if (!ipRateLimit('user_data_post', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const address = jwtAuth.address;
      const rawBody = await readBody(req);
      if (!rawBody) return respondJson(res, 400, { error: 'Missing body' });
      if (rawBody.length > 512 * 1024) return respondJson(res, 413, { error: 'Payload too large (max 512KB)' });
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return respondJson(res, 400, { error: 'Invalid JSON' });
      }
      if (!body || typeof body !== 'object') return respondJson(res, 400, { error: 'Body must be a JSON object' });

      // Only accept fields the client is allowed to set.
      // Progression fields (gameStats, textQuests, rangerXP, achievements, bestScores, score, tier, badges)
      // are managed exclusively by server-side routes and must never be trusted from the client.
      const CLIENT_SETTABLE_FIELDS = new Set([
        'loadout',
        'displayName', 'avatar', 'bio', 'socialLinks',
        'settings', 'preferences', 'theme',
      ]);

      const walletEntry = walletDatabase.get(address) || { address };
      const { forgeState, changed: forgeStateChanged } = getOrCreateForgeState(address, walletEntry);
      const existing = getWalletUserData(walletEntry);
      const updates = {};
      for (const key of CLIENT_SETTABLE_FIELDS) {
        if (body[key] !== undefined) updates[key] = body[key];
      }
      const merged = {
        ...existing,
        ...updates,
        loadout: sanitizeForgeLoadout(address, updates.loadout ?? existing.loadout, forgeState),
        lastSyncAt: new Date().toISOString(),
      };
      updateWalletEntry(address, {
        userData: merged,
        ...(forgeStateChanged ? { forgeState } : {}),
      });
      respondJson(res, 200, { ok: true, address, userData: merged });
      return true;
    }

    return false;
  };
}

export { registerUserDataRoute };
