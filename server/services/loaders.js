function loadGameSessionProofs({ fs, gameSessionStoreFile, normalizeStoredGameSessionEntry }) {
  const gameSessionProofs = new Map();
  try {
    if (!fs.existsSync(gameSessionStoreFile)) return gameSessionProofs;
    const raw = fs.readFileSync(gameSessionStoreFile, 'utf8');
    if (!raw.trim()) return gameSessionProofs;

    const parsed = JSON.parse(raw);
    const sessions = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.sessions) ? parsed.sessions : []);

    let loaded = 0;
    for (const item of sessions) {
      const normalized = normalizeStoredGameSessionEntry(item);
      if (!normalized) continue;
      gameSessionProofs.set(normalized.id, normalized);
      loaded += 1;
    }

    if (loaded > 0) {
      console.log(`[game-session] Loaded ${loaded} persisted proof(s)`);
    }
  } catch (error) {
    console.warn('[game-session] Failed to load persisted proofs', error);
  }
  return gameSessionProofs;
}

function loadAchievementData({ fs, achievementsStoreFile }) {
  const achievementData = new Map();
  try {
    if (!fs.existsSync(achievementsStoreFile)) return achievementData;
    const raw = fs.readFileSync(achievementsStoreFile, 'utf8');
    if (!raw.trim()) return achievementData;
    const parsed = JSON.parse(raw);
    const data = parsed?.data || {};
    const legacyClaims = parsed?.claims || {};
    for (const [addr, entry] of Object.entries(data)) {
      achievementData.set(addr, {
        unlocked: new Set(Array.isArray(entry.unlocked) ? entry.unlocked : []),
        claimed: new Set(Array.isArray(entry.claimed) ? entry.claimed : []),
      });
    }
    for (const [addr, ids] of Object.entries(legacyClaims)) {
      if (!achievementData.has(addr) && Array.isArray(ids)) {
        achievementData.set(addr, { unlocked: new Set(ids), claimed: new Set(ids) });
      }
    }
    console.log(`[achievements] Loaded data for ${achievementData.size} wallets`);
  } catch (error) {
    console.warn('[achievements] Failed to load', error);
  }
  return achievementData;
}

function loadReviveData({ fs, revivesStoreFile }) {
  const reviveData = new Map();
  try {
    if (!fs.existsSync(revivesStoreFile)) return reviveData;
    const raw = fs.readFileSync(revivesStoreFile, 'utf8');
    if (!raw.trim()) return reviveData;
    const parsed = JSON.parse(raw);
    const data = parsed?.data || {};
    for (const [addr, entry] of Object.entries(data)) {
      reviveData.set(addr, entry);
    }
    console.log(`[revives] Loaded data for ${reviveData.size} wallets`);
  } catch (error) {
    console.warn('[revives] Failed to load', error);
  }
  return reviveData;
}

function loadQuestProgress({ fs, questProgressFile }) {
  const questProgress = new Map();
  try {
    if (!fs.existsSync(questProgressFile)) return questProgress;
    const raw = JSON.parse(fs.readFileSync(questProgressFile, 'utf8'));
    if (raw.data) {
      for (const [key, value] of Object.entries(raw.data)) questProgress.set(key, value);
    }
    console.log(`[quests] Loaded ${questProgress.size} quest records`);
  } catch {}
  return questProgress;
}

function loadTournaments({ fs, tournamentFile, tournamentTiers }) {
  const activeTournaments = { daily: null, weekly: null, monthly: null };
  const tournamentHistory = [];
  let tournamentModeIndex = 0;

  try {
    if (fs.existsSync(tournamentFile)) {
      const raw = JSON.parse(fs.readFileSync(tournamentFile, 'utf8'));
      if (raw.active) {
        for (const tier of Object.keys(tournamentTiers)) {
          if (raw.active[tier]) activeTournaments[tier] = raw.active[tier];
        }
      }
      if (raw.active && raw.active.id && !raw.active.daily) {
        activeTournaments.daily = raw.active;
        activeTournaments.daily.tier = 'daily';
      }
      if (Array.isArray(raw.history)) tournamentHistory.push(...raw.history.slice(0, 50));
      if (typeof raw.modeIndex === 'number') tournamentModeIndex = raw.modeIndex;
      console.log(`[tournament] Loaded from disk, active=${Object.keys(activeTournaments).filter((key) => activeTournaments[key]).join(',')}, history=${tournamentHistory.length}`);
    }
  } catch (error) {
    console.warn('[tournament] Load error:', error.message);
  }

  return { activeTournaments, tournamentHistory, tournamentModeIndex };
}

function loadNotifications({ fs, notificationsFile }) {
  const notificationsDb = new Map();
  try {
    if (fs.existsSync(notificationsFile)) {
      const data = JSON.parse(fs.readFileSync(notificationsFile, 'utf8'));
      for (const [addr, notifs] of Object.entries(data)) {
        notificationsDb.set(addr, notifs);
      }
      console.log(`[notifications] Loaded for ${notificationsDb.size} wallets`);
    }
  } catch (error) {
    console.warn('[notifications] Load failed:', error.message);
  }
  return notificationsDb;
}

function loadChallenges({ fs, challengesFile }) {
  const challenges = [];
  try {
    if (fs.existsSync(challengesFile)) {
      const raw = JSON.parse(fs.readFileSync(challengesFile, 'utf8'));
      const arr = Array.isArray(raw?.challenges) ? raw.challenges : (Array.isArray(raw) ? raw : []);
      challenges.push(...arr);
      console.log(`[challenges] Loaded ${challenges.length} challenges`);
    }
  } catch {}
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
