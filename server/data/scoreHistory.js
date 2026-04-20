import fs from 'node:fs';

function createScoreHistoryStore({
  storeFile,
  maxEntries,
  fbAvailable,
  fbGetAll,
  fbSet,
  fbBatchSet,
}) {
  const scoreHistory = new Map(); // address -> { scores: [{ score, tier, date }], lastUpdated }

  const loadScoreHistory = async () => {
    // Try Firestore first
    if (fbAvailable()) {
      try {
        const docs = await fbGetAll('scoreHistory');
        if (docs.size > 0) {
          for (const [addr, data] of docs) {
            if (Array.isArray(data.scores)) {
              scoreHistory.set(addr, { scores: data.scores.slice(0, maxEntries), lastUpdated: data.lastUpdated || null });
            }
          }
          console.log(`[score-history] Loaded history for ${scoreHistory.size} wallets from Firestore`);
          return;
        }
      } catch (err) {
        console.warn('[score-history] Firestore load failed, falling back to JSON:', err.message);
      }
    }
    // Fallback to JSON
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

export { createScoreHistoryStore };
