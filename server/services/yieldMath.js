const STAKING_TIERS = {
  bronze: { minStake: 10000, lockDays: 7, rateMultiplier: 0.75, boostRate: 0.05 },
  silver: { minStake: 30000, lockDays: 30, rateMultiplier: 1.0, boostRate: 0.10 },
  gold: { minStake: 75000, lockDays: 90, rateMultiplier: 1.25, boostRate: 0.15 },
};

const LOCK_TIERS = [
  { days: 7, label: '1 Week', yieldMultiplier: 1.0, earlyPenalty: 0.10 },
  { days: 30, label: '1 Month', yieldMultiplier: 1.5, earlyPenalty: 0.15 },
  { days: 90, label: '3 Months', yieldMultiplier: 2.5, earlyPenalty: 0.20 },
  { days: 180, label: '6 Months', yieldMultiplier: 4.0, earlyPenalty: 0.25 },
];

const YIELD_BRACKETS = [
  { upTo: 5000, baseDailyRate: 0.0050 },
  { upTo: 20000, baseDailyRate: 0.0035 },
  { upTo: 50000, baseDailyRate: 0.0020 },
  { upTo: 100000, baseDailyRate: 0.0012 },
  { upTo: Infinity, baseDailyRate: 0.0008 },
];

function getLockTier(lockDays) {
  const exact = LOCK_TIERS.find((tier) => tier.days === lockDays);
  if (exact) return exact;
  return LOCK_TIERS.reduce((prev, curr) => (
    Math.abs(curr.days - lockDays) < Math.abs(prev.days - lockDays) ? curr : prev
  ));
}

function calcDailyYieldForAmount(amount, tierMultiplier) {
  let remaining = amount;
  let dailyYield = 0;
  let prevUpTo = 0;
  for (const bracket of YIELD_BRACKETS) {
    const sliceMax = bracket.upTo - prevUpTo;
    const slice = Math.min(remaining, sliceMax);
    if (slice <= 0) break;
    dailyYield += slice * bracket.baseDailyRate * tierMultiplier;
    remaining -= slice;
    prevUpTo = bracket.upTo;
  }
  return dailyYield;
}

function getEffectiveRate(amount, tierMultiplier) {
  if (amount <= 0) return 0;
  return calcDailyYieldForAmount(amount, tierMultiplier) / amount;
}

function getRateSchedule(tierMultiplier) {
  return YIELD_BRACKETS.map((bracket) => ({
    upTo: bracket.upTo === Infinity ? null : bracket.upTo,
    rate: +(bracket.baseDailyRate * tierMultiplier * 100).toFixed(3),
  }));
}

function calcUnclaimedYield(stake, { bracketsDeployTs = 0, now = Date.now() } = {}) {
  if (!stake || !stake.startTime) return 0;
  const lastClaim = stake.lastClaimTime || stake.startTime;
  const daysSinceClaim = Math.min(90, Math.max(0, (now - lastClaim) / (1000 * 60 * 60 * 24)));
  const tier = STAKING_TIERS[stake.tier];
  if (!tier) return 0;
  if (stake.startTime < bracketsDeployTs) {
    const legacyRates = { bronze: 0.00375, silver: 0.005, gold: 0.00625 };
    const legacyRate = legacyRates[stake.tier] || 0.00375;
    return Math.floor(daysSinceClaim * legacyRate * stake.amount);
  }
  const lockMult = stake.yieldMultiplier != null ? stake.yieldMultiplier : 1.0;
  const dailyYield = calcDailyYieldForAmount(stake.amount, tier.rateMultiplier * lockMult);
  return Math.floor(daysSinceClaim * dailyYield);
}

export {
  STAKING_TIERS,
  LOCK_TIERS,
  YIELD_BRACKETS,
  getLockTier,
  calcDailyYieldForAmount,
  getEffectiveRate,
  getRateSchedule,
  calcUnclaimedYield,
};
