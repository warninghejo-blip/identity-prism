import { backfillWalletDatabaseAsync, backfillWalletDatabaseSync } from './walletBackfill.js';

function createInitOrchestrator({
  coinBalanceStore,
  mintedAddressesStore,
  scoreHistoryStore,
  walletStore,
  sybilVerdictStore,
  gameSessionProofStore,
  achievementStore,
  reviveStore,
  questProgressStore,
  notificationsStore,
  challengesStore,
  tournamentStore,
  loadCoinBalances,
  loadMintedAddresses,
  loadScoreHistory,
  loadWalletDatabase,
  loadGameSessionProofs,
  loadAchievementData,
  loadReviveData,
  loadQuestProgress,
  loadNotifications,
  loadChallenges,
  loadTournaments,
  normalizeStoredGameSessionEntry,
  gameSessionStoreFile,
  achievementsStoreFile,
  revivesStoreFile,
  questProgressFile,
  notificationsFile,
  challengesFile,
  tournamentFile,
  tournamentTiers,
  saveMintedAddresses,
  setTournamentModeIndex,
  fs,
}) {
  const replaceMap = (target, source) => {
    target.clear();
    for (const [key, value] of source) target.set(key, value);
  };

  async function initialize(ctx) {
    const {
      walletDatabase,
      mintedAddresses,
      gameSessionProofs,
      pruneGameSessionProofs,
      achievements,
      revives,
      quests,
      notifications,
      activeChallenges,
      activeTournaments,
      completedTournaments,
    } = ctx;

    const migrations = [
      ['coins', coinBalanceStore],
      ['minted', mintedAddressesStore],
      ['score-history', scoreHistoryStore],
      ['wallet-db', walletStore],
      ['sybil-verdicts', sybilVerdictStore],
      ['game-session', gameSessionProofStore],
      ['achievements', achievementStore],
      ['revives', reviveStore],
      ['quests', questProgressStore],
      ['notifications', notificationsStore],
      ['challenges', challengesStore],
      ['tournament', tournamentStore],
    ];

    for (const [label, store] of migrations) {
      const result = store.migrateFromJson();
      if (result.migrated && result.count > 0) {
        console.log(`[sqlite] Seeded ${label} with ${result.count} record(s) from JSON`);
      }
    }

    await loadCoinBalances();
    loadMintedAddresses();
    await loadScoreHistory();
    await loadWalletDatabase();
    replaceMap(gameSessionProofs, loadGameSessionProofs({
      datastore: gameSessionProofStore,
      fs,
      gameSessionStoreFile,
      normalizeStoredGameSessionEntry,
    }));
    pruneGameSessionProofs();
    replaceMap(achievements, loadAchievementData({ datastore: achievementStore, fs, achievementsStoreFile }));
    replaceMap(revives, loadReviveData({ datastore: reviveStore, fs, revivesStoreFile }));
    replaceMap(quests, loadQuestProgress({ datastore: questProgressStore, fs, questProgressFile }));
    replaceMap(notifications, loadNotifications({ datastore: notificationsStore, fs, notificationsFile }));
    activeChallenges.splice(0, activeChallenges.length, ...loadChallenges({ datastore: challengesStore, fs, challengesFile }));
    const tournamentState = loadTournaments({
      datastore: tournamentStore,
      fs,
      tournamentFile,
      tournamentTiers,
    });
    for (const tier of Object.keys(activeTournaments)) {
      activeTournaments[tier] = tournamentState.activeTournaments[tier];
    }
    completedTournaments.splice(0, completedTournaments.length, ...tournamentState.tournamentHistory);
    setTournamentModeIndex(tournamentState.tournamentModeIndex);

    let backfilled = 0;
    for (const [addr, entry] of walletDatabase.entries()) {
      if (entry?.mint && !mintedAddresses.has(addr)) {
        mintedAddresses.add(addr);
        backfilled += 1;
      }
    }
    if (backfilled > 0) {
      console.log(`[minted] Backfilled ${backfilled} addresses from walletDatabase, total: ${mintedAddresses.size}`);
      saveMintedAddresses();
    }

    backfillWalletDatabaseSync(ctx);
  }

  function startBackgroundBackfills(ctx) {
    return backfillWalletDatabaseAsync(ctx).catch((err) => {
      console.warn('[wallet-db] Async backfill error', err.message || err);
    });
  }

  return {
    initialize,
    startBackgroundBackfills,
  };
}

export { createInitOrchestrator };
