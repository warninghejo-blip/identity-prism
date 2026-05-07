import { calculateIdentity } from './scoring.js';
import { calculateCompositeScore } from './compositeScore.js';
import { createCompositeOrchestrator } from './compositeOrchestrator.js';

function createReputationBuilderService({
  walletDatabase,
  questProgress,
  activeTournaments,
  tournamentHistory,
  leaderboardEntries,
  achievementData,
  challenges,
  appDb,
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

  function getCommunityReviewCount(address) {
    if (!appDb?.prepare) return 0;
    try {
      const row = appDb.prepare(
        'SELECT COUNT(*) AS count FROM sybil_feedback WHERE reported_by = ? AND (admin_verified IS NULL OR admin_verified = 1)',
      ).get(address);
      return Math.max(0, Number(row?.count) || 0);
    } catch {
      return 0;
    }
  }

  function getSocialActivitySummary(address) {
    let challengesWon = 0;
    let challengesPlayed = 0;
    const opponents = new Set();

    for (const challenge of challenges || []) {
      if (!challenge || challenge.status !== 'completed') continue;
      const isCreator = challenge.creator === address;
      const isOpponent = challenge.opponent === address;
      if (!isCreator && !isOpponent) continue;

      challengesPlayed += 1;
      if (challenge.winner === address) challengesWon += 1;
      const opponent = isCreator ? challenge.opponent : challenge.creator;
      if (opponent) opponents.add(opponent);
    }

    return {
      challengesWon,
      challengesPlayed,
      uniqueOpponents: opponents.size,
      tournamentsPlayed: getTournamentParticipationCount(address),
      communityReviews: getCommunityReviewCount(address),
    };
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
    const socialActivity = getSocialActivitySummary(address);

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
      ...socialActivity,
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
        challengesWon: socialActivity.challengesWon,
        totalCoinsEarned: getCoinBalance(address),
      }),
    };
  }

  const { triggerCompositeUpdate, backfillCompositeScores } = createCompositeOrchestrator({
    walletDatabase,
    challenges,
    saveWalletDatabaseDebounced,
    fbAvailable,
    fbSet,
    buildCompositeInput,
    calculateCompositeScore,
    calculateIdentity,
    rebuildTwitterWalletMap,
  });

  return {
    buildPublicReputationResponse,
    buildCompositeInput,
    triggerCompositeUpdate,
    backfillCompositeScores,
    rebuildTwitterWalletMap,
  };
}

export { createReputationBuilderService };
