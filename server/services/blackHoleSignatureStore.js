import { appDb } from './appDb.js';

function createBlackHoleSignatureStore({ fs, filePath }) {
  const blackHoleUsedSignatures = globalThis._usedBlackHoleSigMap || (() => {
    const map = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const [signature, ts] of Object.entries(raw)) map.set(signature, Number(ts) || Date.now());
    } catch {}
    return (globalThis._usedBlackHoleSigMap = map);
  })();

  function persistBlackHoleUsedSignatures() {
    const tmp = `${filePath}.tmp`;
    const payload = {};
    for (const [signature, ts] of blackHoleUsedSignatures) payload[signature] = ts;
    fs.promises
      .writeFile(tmp, JSON.stringify(payload), 'utf8')
      .then(() => fs.promises.rename(tmp, filePath))
      .catch(() => {});
  }

  function cleanupBlackHoleUsedSignatures() {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [signature, ts] of blackHoleUsedSignatures) {
      if (ts < cutoff) blackHoleUsedSignatures.delete(signature);
    }
  }

  /**
   * Durably claim a signature in SQLite BEFORE crediting any reward.
   * Returns true if this is the first claim (insert succeeded),
   * false if the signature was already claimed (conflict).
   * better-sqlite3 is synchronous — no await needed.
   */
  const _insertDurableSig = appDb.prepare(
    'INSERT OR IGNORE INTO black_hole_signatures (signature, wallet, amount, created_at) VALUES (?, ?, ?, ?)'
  );

  function durableClaimSignatures(signatures, wallet, amount) {
    for (const signature of signatures) {
      const result = _insertDurableSig.run(signature, wallet, amount, Date.now());
      if (result.changes === 0) {
        // Conflict — already in DB (survived crash/restart)
        return false;
      }
    }
    return true;
  }

  return {
    blackHoleUsedSignatures,
    persistBlackHoleUsedSignatures,
    cleanupBlackHoleUsedSignatures,
    durableClaimSignatures,
  };
}

export { createBlackHoleSignatureStore };
