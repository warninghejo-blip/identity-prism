function toSnapshotMap(source, serializeValue = (value) => value) {
  const snapshot = new Map();
  for (const [key, value] of source) {
    snapshot.set(key, serializeValue(value, key));
  }
  return snapshot;
}

function replaceArrayStore(store, items, keySelector) {
  const snapshot = new Map();
  for (const item of items) {
    const key = keySelector(item, snapshot.size);
    if (!key) continue;
    snapshot.set(key, item);
  }
  store.replaceAll(snapshot);
}

function createPersistenceServices({
  fs,
  walletDatabase,
  walletDbFile,
  walletStore,
  fbAvailable,
  fbBatchSet,
  notificationsDb,
  notificationsFile,
  notificationsStore,
  challenges,
  challengesFile,
  challengesStore,
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
      if (walletStore) {
        walletStore.replaceAll(walletDatabase);
      } else {
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
      }
    } catch (err) {
      console.warn('[wallet-db] Failed to persist', err);
    }
    if (fbAvailable()) {
      fbBatchSet('wallets', [...walletDatabase.entries()]).catch((err) =>
        console.warn('[wallet-db] Firestore batch write failed:', err.message));
    }
  };

  const saveWalletDatabaseDebounced = () => {
    persistWalletDatabase();
  };

  function saveNotifications() {
    try {
      if (notificationsStore) {
        notificationsStore.replaceAll(toSnapshotMap(notificationsDb, (value) => Array.isArray(value) ? value : []));
      } else {
        const data = {};
        for (const [addr, notifs] of notificationsDb) data[addr] = notifs;
        fs.writeFileSync(notificationsFile, JSON.stringify(data), 'utf8');
      }
    } catch (e) {
      console.warn('[notifications] Save failed:', e.message);
    }
  }

  const saveNotificationsDebounced = () => {
    saveNotifications();
  };

  function saveChallenges() {
    if (challengesStore) {
      replaceArrayStore(
        challengesStore,
        challenges,
        (challenge, index) => (
          typeof challenge?.id === 'string' && challenge.id ? challenge.id : `challenge:${index}`
        ),
      );
      return;
    }

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
