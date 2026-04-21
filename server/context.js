const CORE_KEYS = [
  'respondJson',
  'readBody',
  'getClientIp',
  'ipRateLimit',
  'requireJwt',
  'getToday',
  'resolveCorsOrigin',
  'getRpcUrl',
  'getBatchRpcUrl',
  'batchGetParsedTxs',
  'parsePublicKey',
  'safeParseJson',
  'requireAdminKey',
  'reputationRateLimit',
  'resolveAccountKey',
  'normalizePubkey',
  'verifyJwt',
];

const WALLET_KEYS = [
  'walletDatabase',
  'mintedAddresses',
  'getCoinBalance',
  'setCoinBalance',
  'addCoinEarned',
  'addCoinSpent',
  'getPrismBalance',
  'getStakingBoost',
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
  'pendingStakingOps',
  'totalBurned',
  'stakingTiers',
  'getLockTier',
  'calcUnclaimedYield',
  'bracketsDeployTs',
  'calcDailyYieldForAmount',
  'getEffectiveRate',
  'getRateSchedule',
  'quests',
  'getQuestProgressSnapshot',
  'getQuestPeriodKey',
  'questSourceIds',
  'saveQuestProgressDebounced',
  'cleanupBlackHoleUsedSignatures',
  'blackHoleUsedSignatures',
  'getIdentityHolderPerks',
  'verifyBlackHoleCommissionTx',
  'verifyCloseOperationTx',
  'verifyBurnOperationTx',
  'verifySwapOperationTx',
  'inferBlackHoleAssetKind',
  'getWalletLamportDelta',
  'lamportsPerSol',
  'calculateBlackHoleReward',
  'dailyBlackHoleCleanupCap',
  'feedItems',
  'persistBlackHoleUsedSignatures',
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

const TOURNAMENT_KEYS = [
  'checkTournaments',
  'tournamentTiers',
  'activeTournaments',
  'getTournamentBasePrizes',
  'tournamentXpRewards',
  'saveTournament',
  'completedTournaments',
  'tournamentHistory',
];

const AUTH_KEYS = [
  'authChallenges',
  'authChallengeTtlMs',
  'verifyWalletSignature',
  'createJwt',
  'verifyJwt',
  'requireJwt',
  'jwtTtl',
  'reputationRateLimit',
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
  const tournament = createFrozenSlice(rawConfig, TOURNAMENT_KEYS);
  const auth = createFrozenSlice(rawConfig, AUTH_KEYS);

  return {
    core,
    wallet,
    economy,
    sybil,
    tournament,
    auth,
    ...rawConfig,
  };
}

export { createContext };
