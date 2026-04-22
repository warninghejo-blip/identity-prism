import {
  getLouvainCommunityDetectionState,
  getMsUntilNextLouvainWindow,
  runLouvainCommunityDetection,
} from './louvainCommunityDetection.js';

/**
 * One-time startup cleanup: purge legacy SOL-staked challenges from the challenges array.
 * Moved here from arena route factory so it only runs once at server startup, not on every route registration.
 */
function purgeLegacySolChallenges({ activeChallenges, saveChallenges }) {
  if (!Array.isArray(activeChallenges)) return;
  const coinChallenges = activeChallenges.filter((c) => c && c.stakeType !== 'sol');
  if (coinChallenges.length !== activeChallenges.length) {
    activeChallenges.splice(0, activeChallenges.length, ...coinChallenges);
    saveChallenges();
    console.warn('[challenges] Removed legacy SOL challenges at startup');
  }
}

function startSchedulers(ctx) {
  const {
    authChallenges,
    quizAnswers,
    checkTournaments,
    activeChallenges: challenges,
    setCoinBalance,
    getCoinBalance,
    refundCoinSpent,
    addCoinEarned,
    pushNotification,
    prismTransactions,
    walletDatabase,
    savePrismDataDebounced: debouncedSavePrism,
    saveChallenges,
    sybilCache,
    clusterCache,
    constellationCache,
    enhancedTxCache,
    reputationV2RateLimit,
    reputationRateLimit,
    rateLimitStore,
    getSybilCacheTtlMs,
    weeklyRewards,
    weeklyXpRewards,
    backfillCompositeScores,
    walletIpLog,
  } = ctx;

  const handles = [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const launchLouvainDetection = (reason) => {
    Promise.resolve()
      .then(() => runLouvainCommunityDetection({ reason }))
      .catch((error) => console.warn(`[sybil-louvain] ${reason} failed: ${error.message}`));
  };

  handles.push(setInterval(() => {
    const now = Date.now();
    for (const [nonce, entry] of authChallenges) {
      if (entry.expiresAt < now) authChallenges.delete(nonce);
    }
  }, 60_000));

  handles.push(setInterval(() => {
    const now = Date.now();
    for (const [key, value] of quizAnswers) {
      if (now > value.expiresAt) quizAnswers.delete(key);
    }
  }, 300_000));

  handles.push(setInterval(checkTournaments, 60_000));

  handles.push(setInterval(() => {
    const now = Date.now();
    const d = new Date(now);
    if (d.getUTCDay() !== 1) return;
    const mondayStart = new Date(now);
    mondayStart.setUTCHours(0, 0, 0, 0);
    if (globalThis._lastWeeklyRewardAt >= mondayStart.getTime()) return;

    const lastWeekEnd = mondayStart.getTime();
    const lastWeekStart = lastWeekEnd - 7 * 24 * 60 * 60 * 1000;
    const stats = new Map();
    for (const challenge of challenges) {
      if (challenge.status !== 'completed' || !challenge.winner) continue;
      const completedAt = challenge.completedAt || challenge.createdAt;
      if (completedAt < lastWeekStart || completedAt >= lastWeekEnd) continue;
      const winner = stats.get(challenge.winner) || { address: challenge.winner, wins: 0, earned: 0, played: 0 };
      winner.wins++;
      winner.earned += Math.floor(challenge.stakeAmount * 2 * 0.95);
      winner.played++;
      stats.set(challenge.winner, winner);
      const loser = challenge.winner === challenge.creator ? challenge.opponent : challenge.creator;
      if (loser) {
        const loserStats = stats.get(loser) || { address: loser, wins: 0, earned: 0, played: 0 };
        loserStats.played++;
        stats.set(loser, loserStats);
      }
    }

    const WEEKLY_MIN_GAMES = 3;
    const ranked = [...stats.values()]
      .filter((player) => player.played >= WEEKLY_MIN_GAMES)
      .sort((a, b) => b.earned - a.earned || b.wins - a.wins)
      .slice(0, 10);
    if (ranked.length === 0) {
      globalThis._lastWeeklyRewardAt = mondayStart.getTime();
      return;
    }

    const winners = [];
    ranked.forEach((player, index) => {
      const reward = weeklyRewards[index] || 0;
      const xpReward = weeklyXpRewards[index] || 0;
      if (reward <= 0) return;
      setCoinBalance(player.address, getCoinBalance(player.address) + reward);
      addCoinEarned(player.address, reward);

      const txs = prismTransactions.get(player.address) || [];
      txs.unshift({
        id: `ch_weekly_${Date.now()}_${index}`,
        address: player.address,
        amount: reward,
        type: 'earn',
        source: 'challenge_win',
        description: `Weekly Arena #${index + 1}: +${reward} Coins${xpReward ? ` +${xpReward} XP` : ''}`,
        timestamp: new Date().toISOString(),
      });
      if (txs.length > 200) txs.length = 200;
      prismTransactions.set(player.address, txs);

      if (xpReward > 0) {
        const wallet = walletDatabase.get(player.address);
        if (wallet) {
          if (!wallet.socialStats) wallet.socialStats = {};
          wallet.socialStats.arenaWeeklyXP = (wallet.socialStats.arenaWeeklyXP || 0) + xpReward;
          walletDatabase.set(player.address, wallet);
        }
      }

      pushNotification(player.address, 'weekly_payout', `Weekly arena ranking: #${index + 1}, +${reward} coins`, { rank: index + 1, reward });
      winners.push({ address: player.address, rank: index + 1, reward, xp: xpReward, wins: player.wins, earned: player.earned });
    });

    globalThis._challengeWeeklyHistory = winners;
    globalThis._lastWeeklyRewardAt = mondayStart.getTime();
    debouncedSavePrism();
    console.log(`[challenges] Weekly rewards distributed to ${winners.length} challengers: ${winners.map((winner) => `#${winner.rank} ${winner.address.slice(0, 8)}.. +${winner.reward}`).join(', ')}`);
  }, 60 * 60 * 1000));

  handles.push(setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const challenge of challenges) {
      if (!challenge.expiresAt || challenge.status === 'completed' || challenge.status === 'cancelled' || challenge.status === 'expired') continue;
      if (now < challenge.expiresAt) continue;
      if (challenge.status === 'open') {
        challenge.status = 'expired';
        challenge.completedAt = new Date().toISOString();
        changed = true;
        if (challenge.stakeAmount > 0) {
          setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
          refundCoinSpent(challenge.creator, challenge.stakeAmount);
        }
        pushNotification(challenge.creator, 'challenge_expired', `Your challenge expired — ${challenge.stakeAmount} coins refunded`, {
          challengeId: challenge.id,
          refunded: challenge.stakeAmount,
        });
        console.log(`[challenges] Expired ${challenge.id} (open/score, no opponent, ${Math.round((now - challenge.createdAt) / 60000)}m)`);
        continue;
      }
      if (challenge.status === 'scoring') {
        // Opponent never submitted score — refund both players
        if (challenge.stakeAmount > 0) {
          if (challenge.creator) {
            setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
            refundCoinSpent(challenge.creator, challenge.stakeAmount);
          }
          if (challenge.opponent) {
            setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
            refundCoinSpent(challenge.opponent, challenge.stakeAmount);
          }
        }
        challenge.status = 'expired';
        challenge.result = 'timeout_scoring';
        challenge.completedAt = new Date().toISOString();
        changed = true;
        if (challenge.creator) pushNotification(challenge.creator, 'challenge_expired', `Challenge expired in scoring — ${challenge.stakeAmount} coins refunded`, { challengeId: challenge.id, refunded: challenge.stakeAmount });
        if (challenge.opponent) pushNotification(challenge.opponent, 'challenge_expired', `Challenge expired in scoring — ${challenge.stakeAmount} coins refunded`, { challengeId: challenge.id, refunded: challenge.stakeAmount });
        console.log(`[challenges] Expired ${challenge.id} (scoring timeout, ${Math.round((now - challenge.createdAt) / 60000)}m)`);
        continue;
      }
      if (challenge.status === 'playing' && !challenge.opponent) {
        challenge.status = 'expired';
        challenge.completedAt = new Date().toISOString();
        changed = true;
        if (challenge.stakeAmount > 0) {
          setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
          refundCoinSpent(challenge.creator, challenge.stakeAmount);
        }
        pushNotification(challenge.creator, 'challenge_expired', `Your challenge expired — ${challenge.stakeAmount} coins refunded`, {
          challengeId: challenge.id,
          refunded: challenge.stakeAmount,
        });
        console.log(`[challenges] Expired ${challenge.id} (playing/game, no opponent joined, ${Math.round((now - challenge.createdAt) / 60000)}m)`);
      }
    }
    if (changed) {
      debouncedSavePrism();
      saveChallenges();
    }
  }, 60_000));

  handles.push(setInterval(() => {
    const now = Date.now();
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    let removed = 0;
    let staleCancelled = 0;
    const stuckCutoff = now - 24 * 60 * 60 * 1000;

    challenges.forEach((challenge) => {
      if ((challenge.status === 'playing' || challenge.status === 'accepted') && (challenge.acceptedAt || challenge.createdAt) < stuckCutoff) {
        if (challenge.creatorScore !== null && challenge.opponentScore !== null) {
          const totalPot = challenge.stakeAmount * 2;
          const winnerPrize = Math.floor(totalPot * 0.95);
          if (challenge.creatorScore > challenge.opponentScore) {
            challenge.winner = challenge.creator;
            setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + winnerPrize);
            addCoinEarned(challenge.creator, winnerPrize);
            pushNotification(challenge.creator, 'challenge_win', `You won the challenge! +${winnerPrize} coins`, { challengeId: challenge.id, payout: winnerPrize });
            if (challenge.opponent) pushNotification(challenge.opponent, 'challenge_loss', `Challenge lost against ${challenge.creator.slice(0, 6)}...`, { challengeId: challenge.id });
          } else if (challenge.opponentScore > challenge.creatorScore) {
            challenge.winner = challenge.opponent;
            setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + winnerPrize);
            addCoinEarned(challenge.opponent, winnerPrize);
            pushNotification(challenge.opponent, 'challenge_win', `You won the challenge! +${winnerPrize} coins`, { challengeId: challenge.id, payout: winnerPrize });
            pushNotification(challenge.creator, 'challenge_loss', `Challenge lost against ${challenge.opponent.slice(0, 6)}...`, { challengeId: challenge.id });
          } else {
            challenge.winner = null;
            setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
            if (challenge.opponent) setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
          }
          challenge.status = 'completed';
        } else if (challenge.winner) {
          challenge.status = 'completed';
        } else {
          if (challenge.stakeAmount > 0 && challenge.creatorScore === null && challenge.opponentScore === null) {
            setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
            refundCoinSpent(challenge.creator, challenge.stakeAmount);
            if (challenge.opponent) {
              setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
              refundCoinSpent(challenge.opponent, challenge.stakeAmount);
            }
          }
          challenge.status = 'expired';
        }
        challenge.completedAt = new Date().toISOString();
        staleCancelled++;
        console.log(`[challenges] Safety-resolved stuck ${challenge.id} → ${challenge.status} (>24h)`);
      }
    });

    if (staleCancelled > 0) {
      console.log(`[challenges] Auto-cancelled ${staleCancelled} stale challenges (playing >2h or open >7d)`);
      debouncedSavePrism();
    }

    for (let index = challenges.length - 1; index >= 0; index--) {
      const challenge = challenges[index];
      if ((challenge.status === 'completed' || challenge.status === 'cancelled' || challenge.status === 'expired') && challenge.createdAt < cutoff) {
        challenges.splice(index, 1);
        removed++;
      }
    }
    if (removed > 0 || staleCancelled > 0) {
      if (removed > 0) console.log(`[challenges] Cleaned up ${removed} old challenges`);
      saveChallenges();
    }
  }, 30 * 60 * 1000));

  handles.push(setInterval(() => {
    const now = Date.now();
    for (const [key, value] of sybilCache) {
      const txCount = Number(value?.analysis?.metrics?.txCount ?? value?.estimatedTxCount ?? 0) || 0;
      const ttlMs = typeof getSybilCacheTtlMs === 'function' ? getSybilCacheTtlMs(txCount, false) : 3600_000;
      if (!value?.cachedAt || now - value.cachedAt > ttlMs) sybilCache.delete(key);
    }
    for (const [key, value] of clusterCache) {
      if (now - value.ts > 1800_000) clusterCache.delete(key);
    }
    for (const [key, value] of constellationCache) {
      if (now - value.ts > 600_000) constellationCache.delete(key);
    }
    for (const [key, value] of enhancedTxCache) {
      if (now - value.ts > 600_000) enhancedTxCache.delete(key);
    }
    for (const [key, value] of reputationV2RateLimit) {
      if (now > value.resetAt + 120_000) reputationV2RateLimit.delete(key);
    }
    for (const [key, value] of reputationRateLimit) {
      if (now - value > 20_000) reputationRateLimit.delete(key);
    }
    if (sybilCache.size > 500) { const it = sybilCache.keys(); for (let i = sybilCache.size - 500; i > 0; i--) sybilCache.delete(it.next().value); }
    if (clusterCache.size > 300) { const it = clusterCache.keys(); for (let i = clusterCache.size - 300; i > 0; i--) clusterCache.delete(it.next().value); }
    if (constellationCache.size > 300) { const it = constellationCache.keys(); for (let i = constellationCache.size - 300; i > 0; i--) constellationCache.delete(it.next().value); }
    if (enhancedTxCache.size > 200) { const it = enhancedTxCache.keys(); for (let i = enhancedTxCache.size - 200; i > 0; i--) enhancedTxCache.delete(it.next().value); }
    if (reputationV2RateLimit.size > 1000) { const it = reputationV2RateLimit.keys(); for (let i = reputationV2RateLimit.size - 1000; i > 0; i--) reputationV2RateLimit.delete(it.next().value); }
    if (reputationRateLimit.size > 1000) { const it = reputationRateLimit.keys(); for (let i = reputationRateLimit.size - 1000; i > 0; i--) reputationRateLimit.delete(it.next().value); }
    rateLimitStore.cleanup();
    // Evict walletIpLog entries not seen in 24h to prevent unbounded growth
    if (walletIpLog) {
      const ipLogCutoff = now - 24 * 60 * 60 * 1000;
      for (const [address, entry] of walletIpLog) {
        if (entry.lastSeen < ipLogCutoff) walletIpLog.delete(address);
      }
    }
  }, 300_000));

  handles.push(setTimeout(backfillCompositeScores, 3000));

  const louvainState = getLouvainCommunityDetectionState();
  if (!louvainState?.lastRunAt) {
    handles.push(setTimeout(() => {
      if (getLouvainCommunityDetectionState()?.lastRunAt) return;
      launchLouvainDetection('startup_bootstrap');
    }, FIVE_MINUTES_MS));
  }

  const dailyLouvainStarter = setTimeout(() => {
    launchLouvainDetection('scheduled');
    handles.push(setInterval(() => launchLouvainDetection('scheduled'), DAY_MS));
  }, getMsUntilNextLouvainWindow());
  handles.push(dailyLouvainStarter);

  return handles;
}

export { startSchedulers };
