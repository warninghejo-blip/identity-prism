import fs from 'node:fs';

function createScoreHistoryStore({
  storeFile,
  maxEntries,
  datastore,
  fbAvailable,
  fbGetAll,
  fbSet,
  fbBatchSet,
}) {
  const scoreHistory = new Map(); // address -> { scores: [{ score, tier, date }], lastUpdated }

  const loadScoreHistory = async () => {
    if (datastore) {
      scoreHistory.clear();
      for (const [addr, entry] of datastore.entries()) {
        if (Array.isArray(entry?.scores)) {
          scoreHistory.set(addr, {
            scores: entry.scores.slice(0, maxEntries),
            lastUpdated: entry.lastUpdated || entry.scores[0]?.date || null,
          });
        }
      }
      console.log(`[score-history] Loaded history for ${scoreHistory.size} wallets from SQLite`);
      return;
    }

    try {
      if (!fs.existsSync(storeFile)) return;
      const raw = fs.readFileSync(storeFile, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      const data = parsed?.data || {};
      for (const [addr, entry] of Object.entries(data)) {
        if (Array.isArray(entry.scores)) {
          scoreHistory.set(addr, { scores: entry.scores.slice(0, maxEntries), lastUpdated: entry.lastUpdated || null });
        }
      }
      console.log(`[score-history] Loaded history for ${scoreHistory.size} wallets from JSON`);
      // Auto-migrate to Firestore
      if (scoreHistory.size > 0 && fbAvailable()) {
        console.log('[score-history] Migrating JSON data to Firestore...');
        fbBatchSet('scoreHistory', [...scoreHistory.entries()])
          .then(() => console.log('[score-history] Migration complete'))
          .catch(err => console.warn('[score-history] Migration failed:', err.message));
      }
    } catch (err) {
      console.warn('[score-history] Failed to load', err);
    }
  };

  const persistScoreHistory = async () => {
    if (datastore) {
      datastore.replaceAll(scoreHistory);
      return;
    }

    try {
      const obj = {};
      for (const [k, v] of scoreHistory) obj[k] = v;
      const tmp = storeFile + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data: obj }, null, 2));
      await fs.promises.rename(tmp, storeFile);
    } catch (err) {
      console.warn('[score-history] Failed to persist', err);
    }
  };

  const getScoreHistory = (address) => {
    return scoreHistory.get(address) || { scores: [], lastUpdated: null };
  };

  const addScoreEntry = (address, score, tier) => {
    const entry = scoreHistory.get(address) || { scores: [], lastUpdated: null };
    const now = new Date().toISOString();
    entry.scores.unshift({ score, tier, date: now });
    if (entry.scores.length > maxEntries) entry.scores.length = maxEntries;
    entry.lastUpdated = now;
    scoreHistory.set(address, entry);
    persistScoreHistory();
    if (fbAvailable()) {
      fbSet('scoreHistory', address, { scores: entry.scores, lastUpdated: entry.lastUpdated })
        .catch(() => {});
    }
    return entry;
  };

  return {
    scoreHistory,
    loadScoreHistory,
    persistScoreHistory,
    getScoreHistory,
    addScoreEntry,
  };
}

function createScoreHistoryStoreFromContext(ctx) {
  return createScoreHistoryStore({
    storeFile: ctx.scoreHistoryFile,
    maxEntries: ctx.scoreHistoryMaxEntries,
    datastore: ctx.datastore,
    fbAvailable: ctx.fbAvailable,
    fbGetAll: ctx.fbGetAll,
    fbSet: ctx.fbSet,
    fbBatchSet: ctx.fbBatchSet,
  });
}

export { createScoreHistoryStore, createScoreHistoryStoreFromContext };
