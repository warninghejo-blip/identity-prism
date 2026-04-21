import { Connection } from '@solana/web3.js';

function createBlackHoleOrchestrator(ctx) {
  const {
    core: {
      normalizePubkey,
      getRpcUrl,
    },
    wallet: {
      mintedAddresses,
      getStakingBoost,
      getCoinBalance,
      setCoinBalance,
      addCoinEarned,
      walletDatabase,
      saveWalletDatabaseDebounced,
      getPrismBalance,
    },
    economy: {
      cleanupBlackHoleUsedSignatures,
      blackHoleUsedSignatures,
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
      getHolderAdjustedCap,
      nonGameDailyEarnCap,
      prismTransactions,
      savePrismDataDebounced,
      feedItems,
      persistBlackHoleUsedSignatures,
    },
  } = ctx;

  function normalizeOperations(payload) {
    const opsRaw = Array.isArray(payload?.operations) ? payload.operations : [];
    if (opsRaw.length === 0 || opsRaw.length > 64) {
      throw new Error('operations array is required');
    }

    return opsRaw.map((op) => {
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
  }

  function dedupeOperations(operations) {
    const uniqueOperations = [];
    const seenOperations = new Set();
    for (const operation of operations) {
      const key = `${operation.action}:${operation.account}:${operation.mint}:${operation.closeSignature}:${operation.swapSignature || ''}`;
      if (seenOperations.has(key)) continue;
      seenOperations.add(key);
      uniqueOperations.push(operation);
    }
    return uniqueOperations;
  }

  async function claim({ address, payload }) {
    let uniqueSignatures;
    let releaseLock;

    try {
      cleanupBlackHoleUsedSignatures();
      const operations = normalizeOperations(payload);
      uniqueSignatures = [...new Set(operations.flatMap((op) => [op.closeSignature, op.swapSignature].filter(Boolean)))];

      for (const signature of uniqueSignatures) {
        if (blackHoleUsedSignatures.has(signature)) {
          return { status: 400, body: { error: 'One or more signatures were already claimed' } };
        }
      }

      for (const signature of uniqueSignatures) blackHoleUsedSignatures.set(signature, Date.now());
      releaseLock = () => {
        for (const signature of uniqueSignatures) blackHoleUsedSignatures.delete(signature);
      };

      const connection = new Connection(getRpcUrl(address), 'confirmed');
      const txMap = new Map();
      try {
        for (const signature of uniqueSignatures) {
          const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
          if (!tx) {
            releaseLock();
            return { status: 400, body: { error: `Transaction ${signature} not found or not confirmed yet` } };
          }
          txMap.set(signature, tx);
        }
      } catch (rpcError) {
        releaseLock();
        throw rpcError;
      }

      let holderPerks;
      try {
        holderPerks = await getIdentityHolderPerks(address, { allowStale: true, throwOnLookupFailure: true });
      } catch {
        releaseLock();
        return { status: 503, body: { error: 'Identity holder verification temporarily unavailable' } };
      }

      const uniqueOperations = dedupeOperations(operations);
      let fungibleResolved = 0;
      let nftResolved = 0;
      const verifiedCommissionBySignature = new Map();
      for (const operation of uniqueOperations) {
        const closeTx = txMap.get(operation.closeSignature);
        if (!verifiedCommissionBySignature.has(operation.closeSignature)) {
          verifiedCommissionBySignature.set(
            operation.closeSignature,
            verifyBlackHoleCommissionTx(closeTx, address, holderPerks.blackHoleCommissionRate),
          );
        }
        if (!verifiedCommissionBySignature.get(operation.closeSignature)) {
          releaseLock();
          return { status: 400, body: { error: 'Black Hole commission verification failed' } };
        }
        if (!verifyCloseOperationTx(closeTx, address, operation.account)) {
          releaseLock();
          return { status: 400, body: { error: 'Close transaction verification failed' } };
        }
        if (operation.action === 'burn' && !verifyBurnOperationTx(closeTx, address, operation.account, operation.mint)) {
          releaseLock();
          return { status: 400, body: { error: 'Burn transaction verification failed' } };
        }
        if (operation.action === 'swap') {
          const swapTx = txMap.get(operation.swapSignature);
          if (!verifySwapOperationTx(swapTx, address, operation.account, operation.mint)) {
            releaseLock();
            return { status: 400, body: { error: 'Swap transaction verification failed' } };
          }
        }
        if (inferBlackHoleAssetKind(closeTx, operation.account, operation.mint) === 'nft') {
          nftResolved += 1;
        } else {
          fungibleResolved += 1;
        }
      }

      const netResolvedLamports = uniqueSignatures.reduce(
        (sum, signature) => sum + getWalletLamportDelta(txMap.get(signature), address),
        0,
      );
      const netResolvedSol = netResolvedLamports / lamportsPerSol;
      let earned = calculateBlackHoleReward(fungibleResolved, nftResolved, netResolvedSol);

      const today = new Date().toISOString().slice(0, 10);
      const bhKey = `blackhole_cleanup:${address}:${today}`;
      const bhToday = getPrismEarnRateLimit(bhKey) || 0;
      earned = Math.max(0, Math.min(earned, dailyBlackHoleCleanupCap - bhToday));

      const isHolder = mintedAddresses.has(address);
      const nonGameCap = getHolderAdjustedCap(nonGameDailyEarnCap, isHolder);
      const ngKey = `nongame_daily:${address}`;
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
      const earnBoost = getStakingBoost(address);
      if (credited > 0 && earnBoost > 0) credited = Math.floor(credited * (1 + earnBoost));

      if (credited > 0) {
        const prevBal = getCoinBalance(address);
        const newBal = prevBal + credited;
        setCoinBalance(address, newBal);
        addCoinEarned(address, credited);
        const walletEntry = walletDatabase.get(address);
        if (walletEntry) {
          walletEntry.coins = newBal;
          saveWalletDatabaseDebounced();
        }
        const tx = {
          id: `bh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          address,
          amount: credited,
          type: 'earn',
          source: 'blackhole_cleanup',
          description: `Black Hole cleanup verified (${fungibleResolved + nftResolved} resolved)`,
          timestamp: new Date().toISOString(),
        };
        const txs = prismTransactions.get(address) || [];
        txs.unshift(tx);
        if (txs.length > 500) txs.length = 500;
        prismTransactions.set(address, txs);
        savePrismDataDebounced();
        feedItems.unshift({
          id: tx.id,
          type: 'scan',
          address,
          description: `Earned ${credited} PRISM from Black Hole cleanup`,
          timestamp: tx.timestamp,
        });
        if (feedItems.length > 200) feedItems.length = 200;
      }

      persistBlackHoleUsedSignatures();
      return {
        status: 200,
        body: {
          earned: credited,
          balance: getPrismBalance(address),
          netResolvedSol,
          fungibleResolved,
          nftResolved,
        },
      };
    } catch (error) {
      if (typeof releaseLock === 'function') {
        releaseLock();
      } else if (typeof uniqueSignatures !== 'undefined') {
        for (const signature of uniqueSignatures) blackHoleUsedSignatures.delete(signature);
      }
      return {
        status: 400,
        body: { error: error instanceof Error ? error.message : 'Invalid request body' },
      };
    }
  }

  return {
    claim,
  };
}

export { createBlackHoleOrchestrator };
