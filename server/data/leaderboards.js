import fs from 'node:fs';

function createLeaderboardStore({ storeFile, maxEntries }) {
  const leaderboardEntries = [];

  const loadLeaderboard = () => {
    try {
      if (!fs.existsSync(storeFile)) return;
      const raw = fs.readFileSync(storeFile, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : (Array.isArray(parsed) ? parsed : []);
      leaderboardEntries.length = 0;
      for (const e of entries) {
        if (e && typeof e.address === 'string' && typeof e.score === 'number') {
          leaderboardEntries.push(e);
        }
      }
      leaderboardEntries.sort((a, b) => b.score - a.score);
      if (leaderboardEntries.length > maxEntries) leaderboardEntries.length = maxEntries;
      console.log(`[leaderboard] Loaded ${leaderboardEntries.length} entries`);
    } catch (err) {
      console.warn('[leaderboard] Failed to load', err);
    }
  };

  const persistLeaderboard = () => {
    const tmp = storeFile + '.tmp';
    fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries: leaderboardEntries }, null, 2))
      .then(() => fs.promises.rename(tmp, storeFile))
      .catch(err => console.warn('[leaderboard] Failed to persist', err));
  };

  const submitLeaderboardEntry = (entry) => {
    const { address, score, playedAt, txSignature, gameType } = entry;
    // score === 0 is a legitimate outcome (e.g. gravity's "columns passed" score is
    // commonly 0 on a fast death) and must still be recorded — only reject negative/NaN.
    if (!address || typeof score !== 'number' || !Number.isFinite(score) || score < 0) return null;
    const gt = gameType || 'orbit';
    // Find existing entry for same address + gameType
    const existing = leaderboardEntries.findIndex((e) => e.address === address && (e.gameType || 'orbit') === gt);
    if (existing !== -1) {
      if (score > leaderboardEntries[existing].score) {
        leaderboardEntries[existing] = { address, score, playedAt: playedAt || new Date().toISOString(), txSignature: txSignature || leaderboardEntries[existing].txSignature, gameType: gt };
      } else if (txSignature && !leaderboardEntries[existing].txSignature) {
        leaderboardEntries[existing].txSignature = txSignature;
      } else {
        return leaderboardEntries[existing];
      }
    } else {
      leaderboardEntries.push({ address, score, playedAt: playedAt || new Date().toISOString(), txSignature: txSignature || undefined, gameType: gt });
    }
    leaderboardEntries.sort((a, b) => b.score - a.score);
    if (leaderboardEntries.length > maxEntries) leaderboardEntries.length = maxEntries;
    persistLeaderboard();
    return leaderboardEntries.find((e) => e.address === address && (e.gameType || 'orbit') === gt) || null;
  };

  const initLeaderboardStore = () => {
    loadLeaderboard();
    // Backfill gameType for old entries
    leaderboardEntries.forEach(e => { if (!e.gameType) e.gameType = 'orbit'; });
    // Clean cheated orbit/gravity scores > 600
    const preClean = leaderboardEntries.length;
    for (let i = leaderboardEntries.length - 1; i >= 0; i--) {
      const e = leaderboardEntries[i];
      const gt = e.gameType || 'orbit';
      if ((gt === 'orbit' || gt === 'gravity') && e.score > 600) {
        leaderboardEntries.splice(i, 1);
      }
    }
    if (leaderboardEntries.length < preClean) {
      console.log(`[leaderboard] Cleaned ${preClean - leaderboardEntries.length} cheated entries (score > 600)`);
      persistLeaderboard();
    }
  };

  return {
    leaderboardEntries,
    loadLeaderboard,
    persistLeaderboard,
    submitLeaderboardEntry,
    initLeaderboardStore,
  };
}

function createLeaderboardStoreFromContext(ctx) {
  return createLeaderboardStore({
    storeFile: ctx.leaderboardStoreFile,
    maxEntries: ctx.leaderboardMaxEntries,
  });
}

export { createLeaderboardStore, createLeaderboardStoreFromContext };
