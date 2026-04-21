import { calculateIdentity } from './scoring.js';
import { calculateCompositeScore } from './compositeScore.js';

function createReputationBuilderService({
  walletDatabase,
  questProgress,
  activeTournaments,
  tournamentHistory,
  leaderboardEntries,
  achievementData,
  challenges,
  getRecentSybilAnalysis,
  getSybilVerdict,
  getSybilQuickVerdict,
  getServerRangerSnapshot,
  getCoinBalance,
  saveWalletDatabaseDebounced,
  fbAvailable,
  fbSet,
  publicReputationTtlSeconds,
}) {
  const twitterWalletMap = new Map();

  function getQuestCompletionSummary(address) {
    const qp = questProgress.get(address);
    if (!qp?.quests) return { questsCompleted: 0, updatedAt: null };
    let questsCompleted = 0;
    for (const quest of Object.values(qp.quests)) {
      if (quest?.completed) questsCompleted += 1;
    }
    return { questsCompleted, updatedAt: qp.updatedAt || null };
  }

  function getTournamentParticipationCount(address) {
    const seen = new Set();
    const allTournaments = [
      ...Object.values(activeTournaments || {}).filter(Boolean),
      ...(Array.isArray(tournamentHistory) ? tournamentHistory : []),
    ];
    for (const tournament of allTournaments) {
      if (!tournament?.id) continue;
      if (tournament.entries && Object.prototype.hasOwnProperty.call(tournament.entries, address)) {
        seen.add(tournament.id);
      }
    }
    return seen.size;
  }

  function formatRangerRankLabel(rankId) {
    const normalized = String(rankId || 'cadet').trim().toLowerCase();
    return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : 'Cadet';
  }

  function mapPublicSybilRisk(verdictKey) {
    if (verdictKey === 'confirmed_sybil' || verdictKey === 'probable_sybil') return 'high';
    if (verdictKey === 'cluster_linked' || verdictKey === 'suspicious') return 'medium';
    return 'low';
  }

  function buildPublicReputationResponse(address) {
    const walletEntry = walletDatabase.get(address);
    if (!walletEntry) return null;

    const compositeData = calculateCompositeScore(buildCompositeInput(address));
    const sybilAnalysis = getRecentSybilAnalysis(address) || walletEntry.sybil || null;
    const sybilVerdict = sybilAnalysis ? getSybilVerdict(sybilAnalysis) : null;
    const rangerSnapshot = getServerRangerSnapshot(address, walletEntry);
    const { questsCompleted, updatedAt: questUpdatedAt } = getQuestCompletionSummary(address);
    const gamesPlayed = leaderboardEntries.filter((entry) => entry.address === address).length;
    const tournamentsPlayed = getTournamentParticipationCount(address);
    const updatedCandidates = [
      walletEntry.lastSeenAt,
      walletEntry.updatedAt,
      walletEntry.composite?.updatedAt,
      walletEntry.sybil?.updatedAt,
      questUpdatedAt,
    ]
      .map((value) => Date.parse(String(value || '')))
      .filter((value) => Number.isFinite(value));
    const updatedAt = new Date(updatedCandidates.length > 0 ? Math.max(...updatedCandidates) : Date.now()).toISOString();
    const signalSummary = sybilAnalysis?.verdictSignals || {};
    const metricHubSpokeScore = Number(sybilAnalysis?.metrics?.hubSpokeScore);
    const metricFundingDepth = Number(sybilAnalysis?.metrics?.fundingChainDepth);

    return {
      address,
      score: compositeData.compositeScore,
      tier: compositeData.compositeTier,
      sybilRisk: mapPublicSybilRisk(sybilVerdict?.key),
      sybilConfidence: Math.max(0, Math.min(1, Number(sybilVerdict?.confidenceScore || 35) / 100)),
      breakdown: compositeData.breakdown,
      behavioralProof: {
        rank: formatRangerRankLabel(rangerSnapshot.rank),
        gamesPlayed,
        questsCompleted,
        tournamentsPlayed,
      },
      signals: {
        version: 2,
        temporalCohortScore: Number(signalSummary.temporalCohortScore) || 0,
        fundingDepth: Math.max(0, Math.min(4, Number(signalSummary.fundingDepth) || metricFundingDepth || 0)),
        splFlowDetected: Boolean(signalSummary.splFlowDetected),
        hubSpokeScore: Math.max(0, Math.min(1, Number(signalSummary.hubSpokeScore) || (Number.isFinite(metricHubSpokeScore) ? metricHubSpokeScore / 100 : 0))),
        adaptiveThresholdTriggered: Boolean(signalSummary.adaptiveThresholdTriggered),
      },
      updatedAt,
      ttl: publicReputationTtlSeconds,
    };
  }

  function rebuildTwitterWalletMap() {
    twitterWalletMap.clear();
    for (const [addr, entry] of walletDatabase) {
      const tw = entry.trustRecovery?.twitter;
      if (tw?.verified && tw.userId) twitterWalletMap.set(tw.userId, addr);
    }
  }

  function computeTrustRecovery(address, activityData) {
    const entry = walletDatabase.get(address) || {};
    const rd = entry.trustRecovery || {};

    let twitterBonus = 0;
    const tw = rd.twitter;
    if (tw?.verified && !tw.suspended) {
      twitterBonus = 3;
      const ageYears = (tw.accountAgeDays || 0) / 365;
      if (ageYears >= 3) twitterBonus += 4;
      else if (ageYears >= 1) twitterBonus += 2;
      if ((tw.followers || 0) >= 500) twitterBonus += 3;
      else if ((tw.followers || 0) >= 50) twitterBonus += 1;
      if ((tw.tweets || 0) >= 1000) twitterBonus += 2;
      else if ((tw.tweets || 0) >= 100) twitterBonus += 1;
      twitterBonus = Math.min(12, twitterBonus);
    }

    let activityBonus = 0;
    const a = activityData || {};
    if ((a.gameTypesCount || 0) >= 3) activityBonus += 1;
    if ((a.achievementCount || 0) >= 15) activityBonus += 2;
    else if ((a.achievementCount || 0) >= 5) activityBonus += 1;
    if ((a.questsCompleted || 0) >= 5) activityBonus += 1;
    if ((a.streakDays || 0) >= 7) activityBonus += 1;
    if ((a.scanCount || 0) >= 10) activityBonus += 1;
    if ((a.challengesWon || 0) >= 3) activityBonus += 1;
    if ((a.totalCoinsEarned || 0) >= 500) activityBonus += 1;
    activityBonus = Math.min(8, activityBonus);

    let crossVerifBonus = 0;
    if (twitterBonus >= 3 && activityBonus >= 5) crossVerifBonus = 3;
    else if (twitterBonus >= 3 && activityBonus >= 3) crossVerifBonus = 2;
    else if (twitterBonus >= 3 && activityBonus >= 1) crossVerifBonus = 1;
    if (twitterBonus >= 8 && activityBonus >= 6) crossVerifBonus = 5;

    return { twitterBonus, activityBonus, crossVerifBonus };
  }

  function buildCompositeInput(address) {
    const walletEntry = walletDatabase.get(address) || {};
    const scoreBreakdown = walletEntry.scoreBreakdown || null;
    let onchainScore = walletEntry.score || 0;
    if (scoreBreakdown && scoreBreakdown.solBalance && scoreBreakdown.solBalance.max === 40) {
      let sbSum = 0;
      for (const value of Object.values(scoreBreakdown)) {
        if (value && typeof value === 'object' && typeof value.pts === 'number') sbSum += value.pts;
      }
      onchainScore = Math.min(400, sbSum);
    } else if (onchainScore > 400) {
      onchainScore = 400;
    }
    const trustScore = walletEntry.sybil?.trustScore || 0;
    const socialStats = walletEntry.socialStats || {};

    const playerEntries = leaderboardEntries.filter((entry) => entry.address === address);
    const gameScores = playerEntries.map((entry) => entry.score || 0);
    const gameTypes = new Set(playerEntries.map((entry) => entry.gameType || 'orbit'));

    const achEntry = achievementData.get(address);
    const achievementCount = achEntry ? achEntry.unlocked.size : 0;

    const qp = questProgress.get(address);
    let questsCompleted = 0;
    let streakDays = 0;
    if (qp && qp.quests) {
      for (const quest of Object.values(qp.quests)) {
        if (quest.completed) questsCompleted++;
      }
      streakDays = qp.streakDays || 0;
    }

    const traits = walletEntry.traits || {};
    const stats = walletEntry.stats || {};
    const sybil = walletEntry.sybil || {};
    const sybilVerdict = sybil.verdict || (sybil.verdictKey ? getSybilQuickVerdict(sybil) : null);
    const challengesWon = challenges.filter((challenge) => challenge.status === 'completed' && challenge.winner === address).length;

    return {
      onchainScore,
      trustScore,
      riskScore: sybil.riskScore || 0,
      sybilAnalyzed: Boolean(sybil.updatedAt),
      sybilVerdict,
      walletAgeDays: stats.walletAgeDays || (traits.walletAgeDays ?? 0),
      txCount: stats.transactions || (traits.txCount ?? 0),
      nftCount: stats.nfts || (traits.nftCount ?? 0),
      solBalance: stats.solBalance || (traits.solBalance ?? 0),
      defiProtoCount: Array.isArray(traits.defiProtocols) ? traits.defiProtocols.length : 0,
      gameScores,
      gameTypes,
      achievementCount,
      challengesWon,
      constellationExplored: socialStats.constellationExplored || 0,
      compareCount: socialStats.compareCount || 0,
      questsCompleted,
      streakDays,
      scanCount: walletEntry.scanCount || 0,
      hasSeeker: Boolean(traits.hasSeeker),
      hasPreorder: Boolean(traits.hasPreorder),
      hasCombo: Boolean(traits.hasCombo),
      scoreBreakdown,
      trustRecovery: computeTrustRecovery(address, {
        gameTypesCount: gameTypes.size,
        achievementCount,
        questsCompleted,
        streakDays,
        scanCount: walletEntry.scanCount || 0,
        challengesWon,
        totalCoinsEarned: getCoinBalance(address),
      }),
    };
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
      const sbStale = entry.scoreBreakdown && (
        (entry.scoreBreakdown.solBalance?.max || 0) !== 40
        || entry.scoreBreakdown.behavioral
      );
      const scoreLegacy = entry.score > 400;
      if (entry.score > 0 && (!entry.scoreBreakdown || sbStale || scoreLegacy) && entry.stats) {
        try {
          const s = entry.stats;
          const firstTxTime = entry.firstTxTimestamp || (s.walletAgeYears > 0 ? Date.now() - s.walletAgeYears * 365 * 86400000 : 0);
          const badges = entry.badges || [];
          const extraTraits = {
            hasSeeker: badges.includes('seeker'),
            hasPreorder: badges.includes('visionary'),
            swapCount: 0, nftTradeCount: 0, stakingCount: 0, defiProtocols: [],
            ...(entry.traits || {}),
          };
          const identity = calculateIdentity(
            s.transactions || 0,
            firstTxTime,
            s.solBalance || 0,
            s.tokens || 0,
            s.nfts || 0,
            extraTraits,
          );
          entry.scoreBreakdown = identity.scoreBreakdown;
          entry.score = identity.score;
          entry.tier = identity.tier;
          entry.badges = identity.badges;
          walletDatabase.set(address, entry);
          recalculated++;
        } catch (err) {
          console.warn(`[composite] Failed to recalculate identity for ${address.slice(0, 8)}:`, err.message);
        }
      }
      triggerCompositeUpdate(address);
      count++;
      if (count % 50 === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log(`[composite] Backfilled ${count} wallets (recalculated ${recalculated} identities)`);
    let cleaned = 0;
    for (const [addr, entry] of walletDatabase) {
      const ss = entry.socialStats;
      if (!ss) continue;
      const realChallengeWins = challenges.filter((challenge) => challenge.status === 'completed' && challenge.winner === addr).length;
      if ((ss.challengesWon || 0) > realChallengeWins) {
        ss.challengesWon = realChallengeWins;
        cleaned++;
      }
      if ((ss.constellationExplored || 0) > 20) { ss.constellationExplored = 0; cleaned++; }
      if ((ss.compareCount || 0) > 20) { ss.compareCount = 0; cleaned++; }
    }
    if (cleaned > 0) {
      console.log(`[cleanup] Fixed ${cleaned} suspicious socialStats entries`);
      saveWalletDatabaseDebounced();
      for (const [addr] of walletDatabase) {
        try { triggerCompositeUpdate(addr); } catch {}
      }
    }
    rebuildTwitterWalletMap();
    if (twitterWalletMap.size > 0) console.log(`[recovery] ${twitterWalletMap.size} Twitter-linked wallets`);
  }

  return {
    buildPublicReputationResponse,
    buildCompositeInput,
    triggerCompositeUpdate,
    backfillCompositeScores,
    rebuildTwitterWalletMap,
  };
}

export { createReputationBuilderService };
