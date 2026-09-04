const BASE_IDENTITY_MAX_SCORE = 400;
const COMPOSITE_MAX_SCORE = 1000;

function normalizeScore(value, maxScore) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(maxScore, score));
}

function buildReputationScoreContract(identity = {}, composite = {}, { primary = null } = {}) {
  const badges = Array.isArray(identity.badges) ? identity.badges : [];
  const baseScore = normalizeScore(identity.score, BASE_IDENTITY_MAX_SCORE);
  const baseTier = typeof identity.tier === 'string' && identity.tier ? identity.tier : 'unknown';
  const compositeScore = normalizeScore(composite.compositeScore, COMPOSITE_MAX_SCORE);
  const compositeTier = typeof composite.compositeTier === 'string' && composite.compositeTier
    ? composite.compositeTier
    : 'unknown';

  return {
    ...(primary === 'base' ? { maxScore: BASE_IDENTITY_MAX_SCORE } : {}),
    ...(primary === 'composite' ? { maxScore: COMPOSITE_MAX_SCORE } : {}),
    baseScore,
    baseTier,
    baseMaxScore: BASE_IDENTITY_MAX_SCORE,
    compositeScore,
    compositeTier,
    compositeMaxScore: COMPOSITE_MAX_SCORE,
    identity: {
      score: baseScore,
      maxScore: BASE_IDENTITY_MAX_SCORE,
      tier: baseTier,
      badges,
      badgeCount: badges.length,
    },
  };
}

export {
  BASE_IDENTITY_MAX_SCORE,
  COMPOSITE_MAX_SCORE,
  buildReputationScoreContract,
};
