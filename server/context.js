const CORE_KEYS = [
  'respondJson',
  'readBody',
  'getClientIp',
  'ipRateLimit',
  'requireJwt',
  'getToday',
  'resolveCorsOrigin',
  'getRpcUrl',
  'parsePublicKey',
];

const WALLET_KEYS = [
  'walletDatabase',
  'mintedAddresses',
  'getCoinBalance',
  'setCoinBalance',
  'addCoinEarned',
  'getPrismBalance',
  'saveWalletDatabaseDebounced',
  'leaderboardEntries',
  'submitLeaderboardEntry',
  'gameSessionProofs',
  'persistGameSessionProofs',
  'triggerCompositeUpdate',
  'toCanonGameMode',
  'leaderboardCacheRef',
  'leaderboardCacheTimeRef',
  'getScoreHistory',
  'achievements',
];

const ECONOMY_KEYS = [
  'quizAnswers',
  'getPrismEarnRateLimit',
  'setPrismEarnRateLimit',
  'dailyQuizCap',
  'quizCorrectReward',
  'getHolderAdjustedCap',
  'nonGameDailyEarnCap',
  'canAwardQuizReward',
  'prismTransactions',
  'savePrismDataDebounced',
  'QUIZ_BANK',
  'buyUsedTxFile',
  'usedBuyTxSignatures',
  'dailyPurchases',
  'buyDailyPurchasesFile',
  'coinPackages',
  'dailyCoinLimit',
  'treasuryAddress',
  'getCachedSolPriceUsd',
  'getCachedSkrPriceUsd',
  'skrMint',
  'tokenProgramId',
  'token2022ProgramId',
];

const SYBIL_KEYS = [
  'sybilCache',
  'buildPublicReputationResponse',
  'publicReputationTtlSeconds',
  'reputationV2RateLimit',
  'fetchIdentitySnapshot',
  'calculateCompositeScore',
  'buildCompositeInput',
  'getSybilVerdict',
];

function createFrozenSlice(rawConfig, keys, extras = {}) {
  const slice = {};
  for (const key of keys) slice[key] = rawConfig[key];
  return Object.freeze({ ...slice, ...extras });
}

function createContext(rawConfig) {
  const core = createFrozenSlice(rawConfig, CORE_KEYS, {
    healthPayload: Object.freeze({ ok: true }),
  });
  const wallet = createFrozenSlice(rawConfig, WALLET_KEYS);
  const economy = createFrozenSlice(rawConfig, ECONOMY_KEYS);
  const sybil = createFrozenSlice(rawConfig, SYBIL_KEYS);

  return {
    core,
    wallet,
    economy,
    sybil,
    ...rawConfig,
  };
}

export { createContext };
