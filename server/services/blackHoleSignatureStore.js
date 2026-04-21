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

  return {
    blackHoleUsedSignatures,
    persistBlackHoleUsedSignatures,
    cleanupBlackHoleUsedSignatures,
  };
}

export { createBlackHoleSignatureStore };
