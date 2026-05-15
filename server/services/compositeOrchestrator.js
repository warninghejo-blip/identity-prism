function createCompositeOrchestrator({
  walletDatabase,
  challenges,
  saveWalletDatabaseDebounced,
  fbAvailable,
  fbSet,
  buildCompositeInput,
  calculateCompositeScore,
  calculateIdentity,
  rebuildTwitterWalletMap,
}) {
  function sumModernScoreBreakdown(scoreBreakdown) {
    if (!scoreBreakdown || (scoreBreakdown.solBalance?.max || 0) !== 40 || scoreBreakdown.behavioral) return null;
    let total = 0;
    let hasPointValues = false;
    for (const value of Object.values(scoreBreakdown)) {
      if (value && typeof value === 'object' && typeof value.pts === 'number') {
        total += value.pts;
        hasPointValues = true;
      }
    }
    if (!hasPointValues) return null;
    return Math.min(400, Math.max(0, total));
  }

  function triggerCompositeUpdate(address) {
    try {
      const input = buildCompositeInput(address);
      const result = calculateCompositeScore(input);
      const existing = walletDatabase.get(address) || {};
      existing.composite = result;
      walletDatabase.set(address, existing);
      saveWalletDatabaseDebounced();
      if (fbAvailable()) {
        fbSet('wallets', address, existing).catch(() => {});
      }
    } catch (err) {
      console.warn('[composite] Failed to update for', address, err.message);
    }
  }

  async function backfillCompositeScores() {
    let count = 0;
    let recalculated = 0;
    for (const [address, entry] of walletDatabase) {
      const modernScore = sumModernScoreBreakdown(entry.scoreBreakdown);
      if (modernScore !== null && entry.score > 400) {
        entry.score = modernScore;
        walletDatabase.set(address, entry);
      }
      const sbStale = entry.scoreBreakdown && (
        (entry.scoreBreakdown.solBalance?.max || 0) !== 40
        || entry.scoreBreakdown.behavioral
      );
      const scoreLegacy = entry.score > 400 && modernScore === null;
      if (entry.score > 0 && (!entry.scoreBreakdown || sbStale || scoreLegacy) && entry.stats) {
        try {
          const stats = entry.stats;
          const firstTxTime = entry.firstTxTimestamp || (stats.walletAgeYears > 0 ? Date.now() - stats.walletAgeYears * 365 * 86400000 : 0);
          const badges = entry.badges || [];
          const extraTraits = {
            hasSeeker: badges.includes('seeker'),
            hasPreorder: badges.includes('visionary'),
            swapCount: 0,
            nftTradeCount: 0,
            stakingCount: 0,
            defiProtocols: [],
            ...(entry.traits || {}),
          };
          const identity = calculateIdentity(
            stats.transactions || 0,
            firstTxTime,
            stats.solBalance || 0,
            stats.tokens || 0,
            stats.nfts || 0,
            extraTraits,
          );
          entry.scoreBreakdown = identity.scoreBreakdown;
          entry.score = identity.score;
          entry.tier = identity.tier;
          entry.badges = identity.badges;
          walletDatabase.set(address, entry);
          recalculated += 1;
        } catch (err) {
          console.warn(`[composite] Failed to recalculate identity for ${address.slice(0, 8)}:`, err.message);
        }
      }
      triggerCompositeUpdate(address);
      count += 1;
      if (count % 50 === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log(`[composite] Backfilled ${count} wallets (recalculated ${recalculated} identities)`);

    let cleaned = 0;
    for (const [addr, entry] of walletDatabase) {
      const socialStats = entry.socialStats;
      if (!socialStats) continue;
      const realChallengeWins = challenges.filter((challenge) => challenge.status === 'completed' && challenge.winner === addr).length;
      if ((socialStats.challengesWon || 0) > realChallengeWins) {
        socialStats.challengesWon = realChallengeWins;
        cleaned += 1;
      }
      if ((socialStats.constellationExplored || 0) > 20) {
        socialStats.constellationExplored = 0;
        cleaned += 1;
      }
      if ((socialStats.compareCount || 0) > 20) {
        socialStats.compareCount = 0;
        cleaned += 1;
      }
    }
    if (cleaned > 0) {
      console.log(`[cleanup] Fixed ${cleaned} suspicious socialStats entries`);
      saveWalletDatabaseDebounced();
      for (const [addr] of walletDatabase) {
        try {
          triggerCompositeUpdate(addr);
        } catch {}
      }
    }

    rebuildTwitterWalletMap();
    if (walletDatabase.size > 0) {
      const linkedCount = [...walletDatabase.values()].filter((entry) => entry?.trustRecovery?.twitter?.verified && entry?.trustRecovery?.twitter?.userId).length;
      if (linkedCount > 0) console.log(`[recovery] ${linkedCount} Twitter-linked wallets`);
    }
  }

  return {
    triggerCompositeUpdate,
    backfillCompositeScores,
  };
}

export { createCompositeOrchestrator };
