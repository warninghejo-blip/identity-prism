function createPersistenceServices({
  fs,
  walletDatabase,
  walletDbFile,
  fbAvailable,
  fbBatchSet,
  notificationsDb,
  notificationsFile,
  challenges,
  challengesFile,
  persistCoinBalances,
  saveMintedAddresses,
  persistScoreHistory,
  persistLeaderboard,
  persistAchievementData,
  persistReviveData,
  persistQuestProgress,
  saveTournament,
  debouncedSavePrism,
}) {
  const persistWalletDatabase = () => {
    try {
      const obj = {};
      for (const [k, v] of walletDatabase) obj[k] = v;
      const tmp = walletDbFile + '.tmp';
      const data = JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        totalWallets: walletDatabase.size,
        wallets: obj,
      }, null, 2);
      fs.promises.writeFile(tmp, data, 'utf8')
        .then(() => fs.promises.rename(tmp, walletDbFile))
        .catch((err) => { console.warn('[wallet-db] Write error:', err.message); });
    } catch (err) {
      console.warn('[wallet-db] Failed to persist', err);
    }
    if (fbAvailable()) {
      fbBatchSet('wallets', [...walletDatabase.entries()]).catch((err) =>
        console.warn('[wallet-db] Firestore batch write failed:', err.message));
    }
  };

  let walletDbSaveTimer = null;
  const saveWalletDatabaseDebounced = () => {
    if (walletDbSaveTimer) clearTimeout(walletDbSaveTimer);
    walletDbSaveTimer = setTimeout(persistWalletDatabase, 500);
  };

  function saveNotifications() {
    try {
      const data = {};
      for (const [addr, notifs] of notificationsDb) data[addr] = notifs;
      fs.writeFileSync(notificationsFile, JSON.stringify(data), 'utf8');
    } catch (e) {
      console.warn('[notifications] Save failed:', e.message);
    }
  }

  let notificationsSaveTimer;
  const saveNotificationsDebounced = () => {
    clearTimeout(notificationsSaveTimer);
    notificationsSaveTimer = setTimeout(saveNotifications, 5000);
  };

  function saveChallenges() {
    const tmp = challengesFile + '.tmp';
    fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), challenges }, null, 2))
      .then(() => fs.promises.rename(tmp, challengesFile))
      .catch((e) => console.warn('[challenges] save error', e.message));
  }

  return {
    persistWalletDatabase,
    saveWalletDatabaseDebounced,
    saveNotifications,
    saveNotificationsDebounced,
    saveChallenges,
    saveCoinBalancesDebounced: persistCoinBalances,
    saveMintedAddressesDebounced: saveMintedAddresses,
    saveScoreHistoryDebounced: persistScoreHistory,
    saveLeaderboardDebounced: persistLeaderboard,
    saveAchievementDataDebounced: persistAchievementData,
    saveReviveDataDebounced: persistReviveData,
    saveQuestProgressDebounced: persistQuestProgress,
    saveTournamentsDebounced: saveTournament,
    saveChallengesDebounced: saveChallenges,
    savePrismDataDebounced: debouncedSavePrism,
  };
}

export { createPersistenceServices };
