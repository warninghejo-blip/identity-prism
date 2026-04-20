import { Connection } from '@solana/web3.js';

function registerBlackholeRoute(ctx) {
  const {
    ipRateLimit,
    getClientIp,
    respondJson,
    requireJwt,
    readBody,
    cleanupBlackHoleUsedSignatures,
    normalizePubkey,
    blackHoleUsedSignatures,
    getRpcUrl,
    getIdentityHolderPerks,
    verifyBlackHoleCommissionTx,
    verifyCloseOperationTx,
    verifyBurnOperationTx,
    verifySwapOperationTx,
    inferBlackHoleAssetKind,
    getWalletLamportDelta,
    lamportsPerSol,
    calculateBlackHoleReward,
    getPrismEarnRateLimit,
    setPrismEarnRateLimit,
    dailyBlackHoleCleanupCap,
    mintedAddresses,
    getHolderAdjustedCap,
    nonGameDailyEarnCap,
    getStakingBoost,
    getCoinBalance,
    setCoinBalance,
    addCoinEarned,
    walletDatabase,
    saveWalletDatabaseDebounced,
    prismTransactions,
    savePrismDataDebounced,
    feedItems,
    persistBlackHoleUsedSignatures,
    getPrismBalance,
  } = ctx;

  return async function handleBlackholeRoute(req, res, url, pathname) {
    if (pathname !== '/api/blackhole/claim' || req.method !== 'POST') return false;

    if (!ipRateLimit('blackhole_claim', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return true;
    let uniqueSignatures;
    let releaseLock;
    try {
      cleanupBlackHoleUsedSignatures();
      const parsed = JSON.parse(await readBody(req));
      const opsRaw = Array.isArray(parsed?.operations) ? parsed.operations : [];
      if (opsRaw.length === 0 || opsRaw.length > 64) {
        respondJson(res, 400, { error: 'operations array is required' });
        return true;
      }

      const operations = opsRaw.map((op) => {
        const account = normalizePubkey(op?.account);
        const mint = normalizePubkey(op?.mint);
        const action = String(op?.action || '').trim();
        const closeSignature = String(op?.closeSignature || '').trim();
        const swapSignature = op?.swapSignature ? String(op.swapSignature).trim() : null;
        if (!account || !mint || !closeSignature) {
          throw new Error('Invalid Black Hole operation payload');
        }
        if (!['swap', 'burn', 'close'].includes(action)) {
          throw new Error('Invalid Black Hole action');
        }
        if (action === 'swap' && !swapSignature) {
          throw new Error('swapSignature required for swap operations');
        }
        return { account, mint, action, closeSignature, swapSignature };
      });

      uniqueSignatures = [...new Set(operations.flatMap((op) => [op.closeSignature, op.swapSignature].filter(Boolean)))];
      for (const signature of uniqueSignatures) {
        if (blackHoleUsedSignatures.has(signature)) {
          respondJson(res, 400, { error: 'One or more signatures were already claimed' });
          return true;
        }
      }

      for (const signature of uniqueSignatures) blackHoleUsedSignatures.set(signature, Date.now());
      const connection = new Connection(getRpcUrl(jwtAuth.address), 'confirmed');
      const txMap = new Map();
      try {
        for (const signature of uniqueSignatures) {
          const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
          if (!tx) {
            respondJson(res, 400, { error: `Transaction ${signature} not found or not confirmed yet` });
            return true;
          }
          txMap.set(signature, tx);
        }
      } catch (rpcError) {
        for (const signature of uniqueSignatures) blackHoleUsedSignatures.delete(signature);
        throw rpcError;
      }

      releaseLock = () => {
        for (const signature of uniqueSignatures) blackHoleUsedSignatures.delete(signature);
      };

      let holderPerks;
      try {
        holderPerks = await getIdentityHolderPerks(jwtAuth.address, { allowStale: true, throwOnLookupFailure: true });
      } catch {
        releaseLock();
        respondJson(res, 503, { error: 'Identity holder verification temporarily unavailable' });
        return true;
      }

      const uniqueOperations = [];
      const seenOperations = new Set();
      for (const operation of operations) {
        const key = `${operation.action}:${operation.account}:${operation.mint}:${operation.closeSignature}:${operation.swapSignature || ''}`;
        if (seenOperations.has(key)) continue;
        seenOperations.add(key);
        uniqueOperations.push(operation);
      }

      let fungibleResolved = 0;
      let nftResolved = 0;
      const verifiedCommissionBySignature = new Map();
      for (const operation of uniqueOperations) {
        const closeTx = txMap.get(operation.closeSignature);
        if (!verifiedCommissionBySignature.has(operation.closeSignature)) {
          verifiedCommissionBySignature.set(
            operation.closeSignature,
            verifyBlackHoleCommissionTx(closeTx, jwtAuth.address, holderPerks.blackHoleCommissionRate),
          );
        }
        if (!verifiedCommissionBySignature.get(operation.closeSignature)) {
          releaseLock();
          respondJson(res, 400, { error: 'Black Hole commission verification failed' });
          return true;
        }
        if (!verifyCloseOperationTx(closeTx, jwtAuth.address, operation.account)) {
          releaseLock();
          respondJson(res, 400, { error: 'Close transaction verification failed' });
          return true;
        }
        if (operation.action === 'burn' && !verifyBurnOperationTx(closeTx, jwtAuth.address, operation.account, operation.mint)) {
          releaseLock();
          respondJson(res, 400, { error: 'Burn transaction verification failed' });
          return true;
        }
        if (operation.action === 'swap') {
          const swapTx = txMap.get(operation.swapSignature);
          if (!verifySwapOperationTx(swapTx, jwtAuth.address, operation.account, operation.mint)) {
            releaseLock();
            respondJson(res, 400, { error: 'Swap transaction verification failed' });
            return true;
          }
        }
        if (inferBlackHoleAssetKind(closeTx, operation.account, operation.mint) === 'nft') {
          nftResolved += 1;
        } else {
          fungibleResolved += 1;
        }
      }

      const netResolvedLamports = uniqueSignatures.reduce(
        (sum, signature) => sum + getWalletLamportDelta(txMap.get(signature), jwtAuth.address),
        0,
      );
      const netResolvedSol = netResolvedLamports / lamportsPerSol;
      let earned = calculateBlackHoleReward(fungibleResolved, nftResolved, netResolvedSol);

      const today = new Date().toISOString().slice(0, 10);
      const bhKey = `blackhole_cleanup:${jwtAuth.address}:${today}`;
      const bhToday = getPrismEarnRateLimit(bhKey) || 0;
      earned = Math.max(0, Math.min(earned, dailyBlackHoleCleanupCap - bhToday));

      const isHolder = mintedAddresses.has(jwtAuth.address);
      const nonGameCap = getHolderAdjustedCap(nonGameDailyEarnCap, isHolder);
      const ngKey = `nongame_daily:${jwtAuth.address}`;
      const ngEntry = getPrismEarnRateLimit(ngKey);
      let ngEarned = 0;
      if (ngEntry && typeof ngEntry === 'object' && ngEntry.date === today) {
        ngEarned = ngEntry.total || 0;
      }
      earned = Math.max(0, Math.min(earned, nonGameCap - ngEarned));

      if (earned > 0) {
        setPrismEarnRateLimit(bhKey, bhToday + earned);
        setPrismEarnRateLimit(ngKey, { date: today, total: ngEarned + earned });
      }

      let credited = earned;
      const earnBoost = getStakingBoost(jwtAuth.address);
      if (credited > 0 && earnBoost > 0) credited = Math.floor(credited * (1 + earnBoost));

      if (credited > 0) {
        const prevBal = getCoinBalance(jwtAuth.address);
        const newBal = prevBal + credited;
        setCoinBalance(jwtAuth.address, newBal);
        addCoinEarned(jwtAuth.address, credited);
        const walletEntry = walletDatabase.get(jwtAuth.address);
        if (walletEntry) {
          walletEntry.coins = newBal;
          saveWalletDatabaseDebounced();
        }
        const tx = {
          id: `bh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          address: jwtAuth.address,
          amount: credited,
          type: 'earn',
          source: 'blackhole_cleanup',
          description: `Black Hole cleanup verified (${fungibleResolved + nftResolved} resolved)`,
          timestamp: new Date().toISOString(),
        };
        const txs = prismTransactions.get(jwtAuth.address) || [];
        txs.unshift(tx);
        if (txs.length > 500) txs.length = 500;
        prismTransactions.set(jwtAuth.address, txs);
        savePrismDataDebounced();
        feedItems.unshift({
          id: tx.id,
          type: 'scan',
          address: jwtAuth.address,
          description: `Earned ${credited} PRISM from Black Hole cleanup`,
          timestamp: tx.timestamp,
        });
        if (feedItems.length > 200) feedItems.length = 200;
      }

      persistBlackHoleUsedSignatures();
      respondJson(res, 200, {
        earned: credited,
        balance: getPrismBalance(jwtAuth.address),
        netResolvedSol,
        fungibleResolved,
        nftResolved,
      });
    } catch (error) {
      if (typeof releaseLock === 'function') {
        releaseLock();
      } else if (typeof uniqueSignatures !== 'undefined') {
        for (const signature of uniqueSignatures) blackHoleUsedSignatures.delete(signature);
      }
      respondJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid request body' });
    }
    return true;
  };
}

export { registerBlackholeRoute };
