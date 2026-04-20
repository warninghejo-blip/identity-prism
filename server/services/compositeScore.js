import { getCompositeTrustProfile } from './sybilVerdict.js';

const COMPOSITE_TIER_MAP = [
  [99, 'mercury'], [219, 'mars'], [349, 'venus'], [479, 'earth'],
  [599, 'neptune'], [699, 'uranus'], [799, 'saturn'], [879, 'jupiter'],
  [949, 'sun'], [Infinity, 'binary_sun'],
];

function getCompositeTier(score) {
  if (!Number.isFinite(score) || score < 0) return 'mercury';
  for (const [threshold, tier] of COMPOSITE_TIER_MAP) {
    if (score <= threshold) return tier;
  }
  return 'binary_sun';
}

function calculateCompositeScore(input) {
  const {
    onchainScore = 0, trustScore = 0, riskScore = 0,
    walletAgeDays = 0, txCount = 0, nftCount = 0, solBalance = 0, defiProtoCount = 0,
    gameScores = [], gameTypes = new Set(), achievementCount = 0,
    challengesWon = 0, constellationExplored = 0, compareCount = 0,
    questsCompleted = 0, streakDays = 0, scanCount = 0,
    hasSeeker = false, hasPreorder = false, hasCombo = false, sybilVerdict = null, scoreBreakdown = null,
  } = input;

  const safeTrust = Number.isFinite(trustScore) ? Math.max(0, Math.min(100, trustScore)) : 0;
  const recovery = input.trustRecovery || {};
  const requestedRecoveryBonus = Math.min(25,
    (recovery.twitterBonus || 0) +
    (recovery.activityBonus || 0) +
    (recovery.crossVerifBonus || 0),
  );
  const compositeTrust = getCompositeTrustProfile({
    verdict: sybilVerdict,
    trustScore: safeTrust,
    recoveryBonus: requestedRecoveryBonus,
  });
  const adjustedTrust = compositeTrust.effectiveTrust;

  const sybilAnalyzed = input.sybilAnalyzed === true;
  const sybilBadgeEligible = sybilAnalyzed && compositeTrust.allowBadges;
  const badge_verifiedHuman = sybilBadgeEligible && safeTrust >= 80;
  const badge_cleanRecord = sybilBadgeEligible && safeTrust >= 50 && riskScore < 10;
  const badge_trustPillar = sybilBadgeEligible && safeTrust >= 95;
  const sybilBadgeBonus = (badge_verifiedHuman ? 10 : 0) + (badge_cleanRecord ? 10 : 0) + (badge_trustPillar ? 10 : 0);

  const validGameScores = gameScores.filter(Number.isFinite);
  const gameScoreTotal = validGameScores.length > 0
    ? Math.min(80, Math.round(Math.log2(1 + validGameScores.reduce((a, b) => a + b, 0)) * 8))
    : 0;
  const gameTypesCount = gameTypes.size;
  const badge_gameMaster = gameTypesCount >= 3;
  const badge_achievementHunter = achievementCount >= 10;
  const badge_highScorer = gameScoreTotal >= 40;
  const humanBadgeBonus = (badge_gameMaster ? 10 : 0) + (badge_achievementHunter ? 10 : 0) + (badge_highScorer ? 10 : 0);

  const badge_arenaChampion = challengesWon >= 5;
  const badge_topHunter = (scanCount || 0) >= 20;
  const badge_questMaster = (questsCompleted || 0) >= 15;
  const socialBadgeBonus = (badge_arenaChampion ? 8 : 0) + (badge_topHunter ? 8 : 0) + (badge_questMaster ? 8 : 0);

  const badge_questHunter = questsCompleted >= 10;
  const badge_streakLord = streakDays >= 7;
  const badge_explorer = scanCount >= 20;
  const engagementBadgeBonus = (badge_questHunter ? 8 : 0) + (badge_streakLord ? 8 : 0) + (badge_explorer ? 8 : 0);

  const onchain = Math.min(400, onchainScore);
  const basePts = onchain;

  const recoveryBonus = compositeTrust.recoveryBonus;
  const sybilBase = Math.round((adjustedTrust / 100) * 250);
  const sybilTrust = Math.min(250, Math.max(0, sybilBase + sybilBadgeBonus));

  const gameDiversity = Math.min(30, gameTypesCount * 5);
  const achievementPts = Math.min(40, achievementCount * 5);
  const humanProof = Math.min(150, gameScoreTotal + gameDiversity + achievementPts + humanBadgeBonus);

  const challengePts = Math.min(32, challengesWon * 4);
  const constellationPts = Math.min(28, constellationExplored * 2);
  const socialScanPts = Math.min(28, scanCount > 0 ? Math.round(Math.log2(1 + scanCount) * 4) : 0);
  const comparePts = Math.min(16, compareCount * 2);
  const social = Math.min(100, challengePts + Math.max(constellationPts, socialScanPts) + comparePts + socialBadgeBonus);

  const questPts = Math.min(40, questsCompleted * 2);
  const streakPts = Math.min(22, streakDays * 2);
  const scanPts = Math.min(14, scanCount > 0 ? Math.round(Math.log2(1 + scanCount) * 4) : 0);
  const engagement = Math.min(100, questPts + streakPts + scanPts + engagementBadgeBonus);

  const total = Math.min(1000, onchain + sybilTrust + humanProof + social + engagement);
  const tier = getCompositeTier(total);

  return {
    compositeScore: total,
    compositeTier: tier,
    breakdown: { onchain, sybilTrust, humanProof, social, engagement },
    details: {
      onchain: { identityScore: onchainScore, identityMax: 400, basePts, badgeBonus: 0, hasSeeker, hasPreorder, hasCombo, scoreBreakdown, walletAgeDays, txCount, nftCount, solBalance, defiProtoCount },
      sybilTrust: {
        trustScore: safeTrust,
        rawTrustScore: compositeTrust.rawTrustScore,
        baseCompositeTrust: compositeTrust.baseCompositeTrust,
        adjustedTrust,
        effectiveTrust: compositeTrust.effectiveTrust,
        verdictKey: compositeTrust.verdictKey,
        verdictLabel: compositeTrust.verdictLabel,
        verdictAdjustment: compositeTrust.verdictAdjustment,
        trustMax: 100,
        badgeBonus: sybilBadgeBonus,
        recoveryBonus,
        recoveryCap: compositeTrust.recoveryCap,
        recoveryBreakdown: recovery,
      },
      humanProof: { gameScoreTotal, gameDiversity, achievementPts, achievementCount, gameTypesCount, badgeBonus: humanBadgeBonus },
      social: { challengesWon, challengePts, scanCount, scanPts: socialScanPts, questsCompleted, questPts: Math.min(16, Math.floor((questsCompleted || 0) * 1.1)), badgeBonus: socialBadgeBonus },
      engagement: { questsCompleted, questPts, streakDays, streakPts, scanCount, scanPts, badgeBonus: engagementBadgeBonus },
    },
  };
}

export { calculateCompositeScore, getCompositeTier };
