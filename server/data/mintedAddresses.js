import fs from 'node:fs';

function createMintedAddressesStore({ storeFile }) {
  const mintedAddresses = new Set();

  const loadMintedAddresses = () => {
    try {
      if (!fs.existsSync(storeFile)) return;
      const raw = fs.readFileSync(storeFile, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      const addresses = Array.isArray(parsed?.addresses) ? parsed.addresses : (Array.isArray(parsed) ? parsed : []);
      for (const addr of addresses) {
        if (typeof addr === 'string' && addr.trim()) mintedAddresses.add(addr.trim());
      }
      console.log(`[minted] Loaded ${mintedAddresses.size} minted addresses`);
    } catch (err) {
      console.warn('[minted] Failed to load', err);
    }
  };

  const saveMintedAddresses = () => {
    const tmp = storeFile + '.tmp';
    fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), addresses: [...mintedAddresses] }, null, 2), 'utf8')
      .then(() => fs.promises.rename(tmp, storeFile))
      .catch(err => console.warn('[minted] Failed to persist', err));
  };

  return {
    mintedAddresses,
    loadMintedAddresses,
    saveMintedAddresses,
  };
}

function createMintedAddressesStoreFromContext(ctx) {
  return createMintedAddressesStore({
    storeFile: ctx.mintedAddressesFile,
  });
}

export { createMintedAddressesStore, createMintedAddressesStoreFromContext };
