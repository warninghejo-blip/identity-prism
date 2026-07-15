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
  'getBaseUrl',
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
  'updateWalletEntry',
  'pushNotification',
  'prismTransactions',
  'savePrismDataDebounced',
  'feedItems',
];

const ECONOMY_KEYS = [
  'quizAnswers',
  'prismEarnMaxPerCall',
  'firstMintLocks',
  'getPrismEarnRateLimit',
  'setPrismEarnRateLimit',
  'prismEarnRateLimit',
  'rateLimitStore',
  'prismEarnCooldownTable',
  'prismEarnCooldownDefault',
  'dailyQuizCap',
  'quizCorrectReward',
  'getHolderAdjustedCap',
  'nonGameDailyEarnCap',
  'dailyHuntCap',
  'dailyScanCap',
  'canAwardQuizReward',
  'QUIZ_BANK',
  'buyUsedTxFile',
  'usedBuyTxSignatures',
  'dailyPurchases',
  'buyDailyPurchasesFile',
  'coinPackages',
  'dailyCoinLimit',
  'refundCoinSpent',
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
  'durableClaimSignatures',
  'applyStakingBoostAfterCap',
  'scanWalletReward',
  'computeSybilHuntReward',
  'getScanRewardState',
  'normalizeScanRewardState',
  'cleanScanRewardCooldownMs',
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
  'triggerCompositeUpdate',
  'getRecentSybilAnalysis',
  'getSybilRewardPath',
  'getSybilVerdictHistory',
  'submitSybilFeedback',
];

const TOURNAMENT_KEYS = [
  'checkTournaments',
  'tournamentTiers',
  'tournamentModes',
  'tournamentResponseModes',
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
  'optionalJwt',
  'jwtTtl',
  'reputationRateLimit',
];

const ARENA_KEYS = [
  'activeChallenges',
  'challengesFile',
  'saveChallenges',
  'challengeWeeklyHistory',
  'weeklyRewards',
  'weeklyXpRewards',
];

const QUEST_KEYS = [
  'quests',
  'questSourceIds',
  'getQuestProgressSnapshot',
  'getQuestPeriodKey',
  'saveQuestProgressDebounced',
  'validTextQuestIds',
];

const GAME_KEYS = [
  'normalizeGameSessionPayload',
  'pruneGameSessionProofs',
  'createGameSessionProofId',
  'verifyMagicBlockSeedSlot',
  'gameSessionProofs',
  'maxGameSessionProofs',
  'persistGameSessionProofs',
  'toPublicGameSessionProof',
  'normalizeGameCoinDeltaForCap',
  'maxDeltaPerGame',
  'gameSessionOnchainBonusMultiplier',
  'getGameCoinsToday',
  'addGameCoinsToday',
  'markGameEarnClaimed',
  'verifyGameEarnClaim',
  'dailyGameCoinCap',
  'getWalletAchievements',
  'claimAchievement',
  'achievementRewardsById',
  'isAchievementUnlockVerified',
  'markAchievementsUnlocked',
  'getRevivesLeft',
  'freeRevivesPerDay',
  'useRevive',
  'getIdentityHolderPerks',
  'hasCoreCollectionAsset',
  'achievements',
  'issueGameSessionToken',
  'verifyGameSessionToken',
  'bindGameSessionTokenProof',
  'redeemGameSessionToken',
  'getServerIssuedGameSeed',
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
  const arena = createFrozenSlice(rawConfig, ARENA_KEYS);
  const quest = createFrozenSlice(rawConfig, QUEST_KEYS);
  const game = createFrozenSlice(rawConfig, GAME_KEYS);

  return {
    core,
    wallet,
    economy,
    sybil,
    tournament,
    auth,
    arena,
    quest,
    game,
    ...rawConfig,
  };
}

export { createContext };
