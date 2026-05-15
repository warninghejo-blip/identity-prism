export const IDENTITY_GAME_COIN_MULTIPLIER = 2;
export const GAME_SESSION_ONCHAIN_BONUS_MULTIPLIER = 1.5;
export const BLACKHOLE_STANDARD_COMMISSION_RATE = 0.10;
export const BLACKHOLE_HOLDER_COMMISSION_RATE = 0.02;

const toSafeInteger = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
};

export function buildIdentityHolderPerks(isHolder, freeRevivesPerDay = 3) {
  const holder = Boolean(isHolder);
  return {
    hasIdentityPrism: holder,
    gameCoinMultiplier: holder ? IDENTITY_GAME_COIN_MULTIPLIER : 1,
    freeRevivesPerDay: holder ? Math.max(0, Math.floor(Number(freeRevivesPerDay) || 0)) : 0,
    blackHoleCommissionRate: holder ? BLACKHOLE_HOLDER_COMMISSION_RATE : BLACKHOLE_STANDARD_COMMISSION_RATE,
    standardBlackHoleCommissionRate: BLACKHOLE_STANDARD_COMMISSION_RATE,
    holderBlackHoleCommissionRate: BLACKHOLE_HOLDER_COMMISSION_RATE,
  };
}

export function normalizeGameCoinDeltaForCap(delta, holderMultiplier = 1) {
  const safeDelta = toSafeInteger(delta);
  const safeMultiplier = Math.max(1, toSafeInteger(holderMultiplier));
  if (safeDelta <= 0) return 0;
  if (safeMultiplier === 1) return safeDelta;
  return Math.max(1, Math.floor(safeDelta / safeMultiplier));
}

export function scaleAppliedGameCoinDelta(requestedDelta, normalizedRequestedDelta, appliedNormalizedDelta) {
  const safeRequested = toSafeInteger(requestedDelta);
  const safeNormalizedRequested = toSafeInteger(normalizedRequestedDelta);
  const safeAppliedNormalized = toSafeInteger(appliedNormalizedDelta);
  if (safeRequested <= 0 || safeNormalizedRequested <= 0 || safeAppliedNormalized <= 0) return 0;
  if (safeAppliedNormalized >= safeNormalizedRequested) return safeRequested;
  return Math.max(1, Math.floor((safeRequested * safeAppliedNormalized) / safeNormalizedRequested));
}
