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
  const { datastore } = ctx;
  if (datastore) {
    const mintedAddresses = new Set();

    const loadMintedAddresses = () => {
      mintedAddresses.clear();
      for (const address of datastore.entries().keys()) {
        if (typeof address === 'string' && address.trim()) mintedAddresses.add(address.trim());
      }
      console.log(`[minted] Loaded ${mintedAddresses.size} minted addresses`);
    };

    const saveMintedAddresses = () => {
      const snapshot = new Map();
      for (const address of mintedAddresses) {
        snapshot.set(address, true);
      }
      datastore.replaceAll(snapshot);
    };

    return {
      mintedAddresses,
      loadMintedAddresses,
      saveMintedAddresses,
    };
  }

  return createMintedAddressesStore({
    storeFile: ctx.mintedAddressesFile,
  });
}

export { createMintedAddressesStore, createMintedAddressesStoreFromContext };
