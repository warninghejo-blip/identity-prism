function readJsonEntries({ datastore, fallback }) {
  if (datastore) {
    const entries = datastore.entries();
    if (entries.size > 0 || datastore.hasRows()) return entries;
  }
  return fallback();
}

function loadGameSessionProofs({ datastore, fs, gameSessionStoreFile, normalizeStoredGameSessionEntry }) {
  const sessions = new Map();
  const rawEntries = readJsonEntries({
    datastore,
    fallback: () => {
      const jsonEntries = new Map();
      try {
        if (!fs.existsSync(gameSessionStoreFile)) return jsonEntries;
        const raw = fs.readFileSync(gameSessionStoreFile, 'utf8');
        if (!raw.trim()) return jsonEntries;

        const parsed = JSON.parse(raw);
        const storedSessions = Array.isArray(parsed)
          ? parsed
          : (Array.isArray(parsed?.sessions) ? parsed.sessions : []);

        for (const item of storedSessions) {
          const id = typeof item?.id === 'string' ? item.id : null;
          if (id) jsonEntries.set(id, item);
        }
      } catch (error) {
        console.warn('[game-session] Failed to load persisted proofs', error);
      }
      return jsonEntries;
    },
  });

  let loaded = 0;
  for (const item of rawEntries.values()) {
    const normalized = normalizeStoredGameSessionEntry(item);
    if (!normalized) continue;
    sessions.set(normalized.id, normalized);
    loaded += 1;
  }

  if (loaded > 0) {
    console.log(`[game-session] Loaded ${loaded} persisted proof(s)`);
  }

  return sessions;
}

function loadAchievementData({ datastore, fs, achievementsStoreFile }) {
  const achievementData = new Map();
  const rawEntries = readJsonEntries({
    datastore,
    fallback: () => {
      const jsonEntries = new Map();
      try {
        if (!fs.existsSync(achievementsStoreFile)) return jsonEntries;
        const raw = fs.readFileSync(achievementsStoreFile, 'utf8');
        if (!raw.trim()) return jsonEntries;
        const parsed = JSON.parse(raw);
        const data = parsed?.data || {};
        const legacyClaims = parsed?.claims || {};
        for (const [addr, entry] of Object.entries(data)) {
          jsonEntries.set(addr, entry);
        }
        for (const [addr, ids] of Object.entries(legacyClaims)) {
          if (!jsonEntries.has(addr) && Array.isArray(ids)) {
            jsonEntries.set(addr, { unlocked: ids, claimed: ids });
          }
        }
      } catch (error) {
        console.warn('[achievements] Failed to load', error);
      }
      return jsonEntries;
    },
  });

  for (const [addr, entry] of rawEntries) {
    achievementData.set(addr, {
      unlocked: new Set(Array.isArray(entry?.unlocked) ? entry.unlocked : []),
      claimed: new Set(Array.isArray(entry?.claimed) ? entry.claimed : []),
    });
  }

  console.log(`[achievements] Loaded data for ${achievementData.size} wallets`);
  return achievementData;
}

function loadReviveData({ datastore, fs, revivesStoreFile }) {
  const reviveData = new Map();
  const rawEntries = readJsonEntries({
    datastore,
    fallback: () => {
      const jsonEntries = new Map();
      try {
        if (!fs.existsSync(revivesStoreFile)) return jsonEntries;
        const raw = fs.readFileSync(revivesStoreFile, 'utf8');
        if (!raw.trim()) return jsonEntries;
        const parsed = JSON.parse(raw);
        const data = parsed?.data || {};
        for (const [addr, entry] of Object.entries(data)) {
          jsonEntries.set(addr, entry);
        }
      } catch (error) {
        console.warn('[revives] Failed to load', error);
      }
      return jsonEntries;
    },
  });

  for (const [addr, entry] of rawEntries) {
    reviveData.set(addr, entry);
  }

  console.log(`[revives] Loaded data for ${reviveData.size} wallets`);
  return reviveData;
}

function loadQuestProgress({ datastore, fs, questProgressFile }) {
  const questProgress = new Map();
  const rawEntries = readJsonEntries({
    datastore,
    fallback: () => {
      const jsonEntries = new Map();
      try {
        if (!fs.existsSync(questProgressFile)) return jsonEntries;
        const raw = JSON.parse(fs.readFileSync(questProgressFile, 'utf8'));
        if (raw.data) {
          for (const [key, value] of Object.entries(raw.data)) {
            jsonEntries.set(key, value);
          }
        }
      } catch {
        // ignore malformed fallback payloads to preserve current behavior
      }
      return jsonEntries;
    },
  });

  for (const [key, value] of rawEntries) {
    questProgress.set(key, value);
  }

  console.log(`[quests] Loaded ${questProgress.size} quest records`);
  return questProgress;
}

function loadTournaments({ datastore, fs, tournamentFile, tournamentTiers }) {
  const activeTournaments = { daily: null, weekly: null, monthly: null };
  const tournamentHistory = [];
  let tournamentModeIndex = 0;

  const rawEntries = readJsonEntries({
    datastore,
    fallback: () => {
      const jsonEntries = new Map();
      try {
        if (!fs.existsSync(tournamentFile)) return jsonEntries;
        const raw = JSON.parse(fs.readFileSync(tournamentFile, 'utf8'));
        for (const tier of Object.keys(tournamentTiers)) {
          jsonEntries.set(tier, raw?.active?.[tier] ?? null);
        }
        jsonEntries.set('__history__', Array.isArray(raw?.history) ? raw.history.slice(0, 50) : []);
        jsonEntries.set('__meta__', {
          modeIndex: typeof raw?.modeIndex === 'number' ? raw.modeIndex : 0,
        });
      } catch (error) {
        console.warn('[tournament] Load error:', error.message);
      }
      return jsonEntries;
    },
  });

  for (const tier of Object.keys(tournamentTiers)) {
    if (rawEntries.has(tier)) activeTournaments[tier] = rawEntries.get(tier);
  }

  const history = rawEntries.get('__history__');
  if (Array.isArray(history)) tournamentHistory.push(...history.slice(0, 50));

  const meta = rawEntries.get('__meta__');
  if (typeof meta?.modeIndex === 'number') tournamentModeIndex = meta.modeIndex;

  console.log(
    `[tournament] Loaded from disk, active=${Object.keys(activeTournaments).filter((key) => activeTournaments[key]).join(',')}, history=${tournamentHistory.length}`,
  );

  return { activeTournaments, tournamentHistory, tournamentModeIndex };
}

function loadNotifications({ datastore, fs, notificationsFile }) {
  const notificationsDb = new Map();
  const rawEntries = readJsonEntries({
    datastore,
    fallback: () => {
      const jsonEntries = new Map();
      try {
        if (!fs.existsSync(notificationsFile)) return jsonEntries;
        const data = JSON.parse(fs.readFileSync(notificationsFile, 'utf8'));
        for (const [addr, notifs] of Object.entries(data)) {
          jsonEntries.set(addr, notifs);
        }
      } catch (error) {
        console.warn('[notifications] Load failed:', error.message);
      }
      return jsonEntries;
    },
  });

  for (const [addr, notifs] of rawEntries) {
    notificationsDb.set(addr, Array.isArray(notifs) ? notifs : []);
  }

  console.log(`[notifications] Loaded for ${notificationsDb.size} wallets`);
  return notificationsDb;
}

function loadChallenges({ datastore, fs, challengesFile }) {
  const challenges = [];
  const rawEntries = readJsonEntries({
    datastore,
    fallback: () => {
      const jsonEntries = new Map();
      try {
        if (!fs.existsSync(challengesFile)) return jsonEntries;
        const raw = JSON.parse(fs.readFileSync(challengesFile, 'utf8'));
        const arr = Array.isArray(raw?.challenges) ? raw.challenges : (Array.isArray(raw) ? raw : []);
        for (const challenge of arr) {
          const key = typeof challenge?.id === 'string' && challenge.id ? challenge.id : `challenge:${jsonEntries.size}`;
          jsonEntries.set(key, challenge);
        }
      } catch {
        // preserve existing silent failure behavior for malformed challenge fallbacks
      }
      return jsonEntries;
    },
  });

  challenges.push(...rawEntries.values());
  console.log(`[challenges] Loaded ${challenges.length} challenges`);
  return challenges;
}

export {
  loadGameSessionProofs,
  loadAchievementData,
  loadReviveData,
  loadQuestProgress,
  loadTournaments,
  loadNotifications,
  loadChallenges,
};
