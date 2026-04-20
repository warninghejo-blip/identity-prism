const backfillWalletDatabaseSync = (ctx) => {
  const {
    walletDatabase,
    scoreHistory,
    getCoinBalance,
    coinBalances,
    mintedAddresses,
    persistWalletDatabase,
  } = ctx;

  if (walletDatabase.size > 0) return;
  let count = 0;
  for (const [address, hist] of scoreHistory) {
    const scores = hist.scores || [];
    walletDatabase.set(address, {
      address,
      firstSeenAt: scores.length > 0 ? scores[scores.length - 1]?.date : new Date().toISOString(),
      lastSeenAt: hist.lastUpdated || new Date().toISOString(),
      scanCount: scores.length,
      score: scores[0]?.score || 0,
      tier: scores[0]?.tier || 'unknown',
      coins: getCoinBalance(address),
      source: 'backfill-local',
    });
    count++;
  }
  for (const [address] of coinBalances) {
    if (!walletDatabase.has(address) && address !== 'anonymous') {
      walletDatabase.set(address, {
        address,
        coins: getCoinBalance(address),
        source: 'backfill-local',
      });
      count++;
    }
  }
  for (const address of mintedAddresses) {
    const wallet = walletDatabase.get(address) || { address, source: 'backfill-local' };
    if (!wallet.mint) wallet.mint = { minted: true, mintedAt: null, assetId: null, txSignature: null, metadataUri: '', remints: 0, lastRemintAt: null };
    walletDatabase.set(address, wallet);
  }
  if (count > 0) {
    persistWalletDatabase();
    console.log(`[wallet-db] Backfilled ${count} wallets from local data`);
  }
};

const backfillWalletDatabaseAsync = async (ctx) => {
  const {
    coreCollection,
    getRpcUrl,
    walletDatabase,
    persistWalletDatabase,
    port,
  } = ctx;

  if (!coreCollection) {
    console.log('[wallet-db] Skipping DAS backfill: CORE_COLLECTION not set');
    return;
  }
  const rpcUrl = getRpcUrl('backfill');
  if (!rpcUrl) return;

  console.log('[wallet-db] Starting async DAS backfill...');
  let dasCount = 0;
  try {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const dasRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `backfill-${page}`,
          method: 'getAssetsByGroup',
          params: { groupKey: 'collection', groupValue: coreCollection, page, limit: 1000 },
        }),
      });
      const dasJson = await dasRes.json();
      const items = dasJson?.result?.items || [];
      if (items.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of items) {
        const owner = item.ownership?.owner;
        if (!owner) continue;
        const assetId = item.id;
        const attrs = item.content?.metadata?.attributes || [];
        const attrMap = {};
        for (const attr of attrs) attrMap[attr.trait_type] = attr.value;

        const wallet = walletDatabase.get(owner) || { address: owner, source: 'backfill-das' };
        wallet.mint = {
          minted: true,
          assetId,
          mintedAt: wallet.mint?.mintedAt || null,
          txSignature: wallet.mint?.txSignature || null,
          metadataUri: item.content?.json_uri || wallet.mint?.metadataUri || '',
          remints: wallet.mint?.remints || 0,
          lastRemintAt: wallet.mint?.lastRemintAt || null,
        };
        if (attrMap.Score != null) wallet.score = parseInt(attrMap.Score, 10) || wallet.score;
        if (attrMap.Tier) wallet.tier = attrMap.Tier;
        if (!wallet.stats) {
          wallet.stats = {
            nfts: parseInt(attrMap.NFTs, 10) || 0,
            tokens: parseInt(attrMap.Tokens, 10) || 0,
            transactions: parseInt(attrMap.Transactions, 10) || 0,
            walletAgeYears: Math.floor((parseInt(attrMap['Wallet Age (days)'], 10) || 0) / 365),
          };
        }
        walletDatabase.set(owner, wallet);
        dasCount++;
      }
      if (items.length < 1000) hasMore = false;
      else page++;
    }
    if (dasCount > 0) {
      persistWalletDatabase();
      console.log(`[wallet-db] DAS backfill: enriched ${dasCount} wallet entries`);
    }
  } catch (error) {
    console.warn('[wallet-db] DAS backfill failed', error.message || error);
  }

  const walletsNeedingSybil = [];
  for (const [addr, wallet] of walletDatabase) {
    if (!wallet.sybil && addr.length >= 32) walletsNeedingSybil.push(addr);
  }
  if (walletsNeedingSybil.length > 0) {
    console.log(`[wallet-db] Sybil backfill: ${walletsNeedingSybil.length} wallets need analysis`);
    let sybilCount = 0;
    for (const addr of walletsNeedingSybil) {
      try {
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) continue;
        const sybilRes = await fetch(`http://127.0.0.1:${port}/api/sybil/analysis?address=${encodeURIComponent(addr)}`);
        if (sybilRes.ok) sybilCount++;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log(`[wallet-db] Sybil backfill complete: ${sybilCount}/${walletsNeedingSybil.length} analyzed`);
  }
};

export {
  backfillWalletDatabaseAsync,
  backfillWalletDatabaseSync,
};
