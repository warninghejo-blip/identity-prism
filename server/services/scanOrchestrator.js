import { Connection, PublicKey } from '@solana/web3.js';

// Helius enhanced-tx `source`/`type` codes (e.g. PUMP_FUN, MAGIC_EDEN) → human label + category.
// These complement the curated PROGRAM_LABELS id map so unknown raw program ids are rare.
const PROTOCOL_CODE_CATEGORY = {
  JUPITER: 'DEX', RAYDIUM: 'DEX', ORCA: 'DEX', PHOENIX: 'DEX', METEORA: 'DEX', LIFINITY: 'DEX',
  ALDRIN: 'DEX', SABER: 'DEX', SERUM: 'DEX', OPENBOOK: 'DEX', CREMA: 'DEX', INVARIANT: 'DEX',
  PUMP_FUN: 'Memecoin', PUMP_AMM: 'Memecoin', MOONSHOT: 'Memecoin', BONKSWAP: 'Memecoin',
  MAGIC_EDEN: 'NFT', TENSOR: 'NFT', SOLANART: 'NFT', HADESWAP: 'NFT', HYPERSPACE: 'NFT',
  METAPLEX: 'NFT', CANDY_MACHINE: 'NFT', FORM_FUNCTION: 'NFT', EXCHANGE_ART: 'NFT',
  SOLEND: 'Lending', KAMINO: 'Lending', MARGINFI: 'Lending', MANGO: 'Lending', PORT: 'Lending',
  DRIFT: 'Perps', ZETA: 'Perps', JUPITER_PERPS: 'Perps',
  MARINADE: 'Staking', JITO: 'Staking', LIDO: 'Staking', SANCTUM: 'Staking', STAKE_PROGRAM: 'Staking',
  WORMHOLE: 'Bridge', ALLBRIDGE: 'Bridge', DEBRIDGE: 'Bridge', MAYAN: 'Bridge',
  SYSTEM_PROGRAM: 'Core', TOKEN_PROGRAM: 'Core', STAKE: 'Staking',
  // generic Helius `type:` action codes (when no protocol source is attached)
  SWAP: 'DEX', ADD_LIQUIDITY: 'DEX', REMOVE_LIQUIDITY: 'DEX', CREATE_POOL: 'DEX',
  NFT_SALE: 'NFT', NFT_MINT: 'NFT', NFT_LISTING: 'NFT', NFT_BID: 'NFT', NFT_CANCEL_LISTING: 'NFT', COMPRESSED_NFT_MINT: 'NFT',
  STAKE_SOL: 'Staking', UNSTAKE_SOL: 'Staking', STAKE_TOKEN: 'Staking',
  BORROW: 'Lending', REPAY: 'Lending', DEPOSIT: 'Lending', WITHDRAW: 'Lending',
};
function prettifyProtocolCode(code) {
  if (!code) return null;
  // SNAKE_CASE / UPPER → Title Case ("PUMP_FUN" → "Pump Fun", "MAGIC_EDEN" → "Magic Eden")
  const pretty = String(code).toLowerCase().split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  // common fixups
  return pretty
    .replace('Pump Amm', 'Pump.fun AMM')
    .replace('Pump Fun', 'Pump.fun')
    .replace('Marginfi', 'marginfi')
    .replace('Magic Eden', 'Magic Eden')
    .replace(/\bAmm\b/, 'AMM').replace(/\bNft\b/, 'NFT').replace(/\bDex\b/, 'DEX');
}
function protocolCodeCategory(code) {
  if (!code) return null;
  return PROTOCOL_CODE_CATEGORY[String(code).toUpperCase()] || null;
}

function createScanOrchestrator(ctx) {
  const {
    getRpcUrl,
    getBatchRpcUrl,
    batchGetParsedTxs,
    resolveAccountKey,
    walletDatabase,
    updateWalletEntry,
    triggerCompositeUpdate,
    getSybilVerdict,
    sybilGraph,
    saveSybilGraph,
    updateSybilGraphNode,
    checkGraphForKnownSybils,
    loadSybilCacheEntry,
    refreshCachedSybilAnalysis,
    persistSybilAnalysis,
    persistAutoDetectedScanClusters,
    fetchSybilSampleFor,
    findFirstTxTime,
    getDominantFundingSource,
    getDominantTokenFundingSource,
    summarizeEnhancedTxHistory,
    fetchEnhancedTxHistory,
    fetchDominantEnhancedFunder,
    isProgramAddress,
    extractSolTransfers,
    detectTemporalFundingCohort,
    persistFundingEdge,
    persistFundingEdgesForTarget,
    sybilScanVersion,
    solMint,
    usdcMint,
    programLabels,
    treasuryWallets,
    knownLabels,
    mintedAddresses,
  } = ctx;

  return async function runSybilAnalysis(address, { isOwnWalletScan = false } = {}) {
    const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
    // Hard time budget so a full analysis (app + site) never exceeds ~10s: fast wallets
    // get the complete walk; heavy wallets bound the expensive optional work (deep
    // signature pagination + multi-level funding-chain) once the budget is spent and
    // return a sampled-but-complete result. Cheap cache reads are not gated.
    const _deadline = Date.now() + 8500;
    const _overBudget = () => Date.now() > _deadline;
    const _p = () => {};
    // Heavy = couldn't paginate the full history within the page cap. Gates the live
    // funding walk (its main cost) so heavy wallets stay within the time budget.
    let _heavyWallet = false;
    const pubkey = new PublicKey(address);
    const cachedBaseline = loadSybilCacheEntry(address);
    const [balanceResult, tokenAccountsResult] = await Promise.allSettled([
      conn.getBalance(pubkey),
      conn.getParsedTokenAccountsByOwner(pubkey, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }),
    ]);
    const balance = balanceResult.status === 'fulfilled' ? balanceResult.value / 1e9 : 0;
    const tokenAccounts = tokenAccountsResult.status === 'fulfilled' ? tokenAccountsResult.value?.value || [] : [];
    const cachedWallet = walletDatabase.get(address);
    const cachedFirstTx = cachedWallet?.firstTxTimestamp || null;

    let allSignatures = [];
    let oldestSig = null;
    let totalSigCount = 0;
    let firstTxBlockTime = null;
    let parsedTxs = [];
    let earlyParsedTxs = [];
    let timestamps = [];
    let failedTxCount = 0;
    let enhancedSampleSummary = null;

    const sampleMeta = {
      lastSeenSignature: cachedBaseline?.lastSeenSignature || null,
      firstSeenSignature: cachedBaseline?.firstSeenSignature || null,
      estimatedTxCount: cachedBaseline?.estimatedTxCount || cachedWallet?.stats?.transactions || 0,
      firstTxBlockTime: cachedBaseline?.firstTxBlockTime || cachedFirstTx || null,
    };
    const normalizedSampleMeta = sampleMeta.lastSeenSignature
      || sampleMeta.firstSeenSignature
      || sampleMeta.estimatedTxCount
      || sampleMeta.firstTxBlockTime
      ? sampleMeta
      : null;

    const sampledHistory = await fetchSybilSampleFor(address, conn, pubkey, normalizedSampleMeta, balance, _deadline).catch(() => null);
    _p('after-sample');
    if (sampledHistory?.incremental && sampledHistory.reuseCached && cachedBaseline?.analysis) {
      const refreshedEntry = refreshCachedSybilAnalysis(address, cachedBaseline, isOwnWalletScan);
      return refreshedEntry?.analysis || cachedBaseline.analysis;
    }

    if (sampledHistory?.summary) {
      enhancedSampleSummary = sampledHistory.summary;
      totalSigCount = Math.max(
        sampledHistory.estimatedTxCount || 0,
        cachedWallet?.stats?.transactions || 0,
        enhancedSampleSummary.totalTxs || 0,
      );
      firstTxBlockTime = sampledHistory.firstTxBlockTime ?? enhancedSampleSummary.firstTxBlockTime ?? cachedFirstTx ?? null;
      oldestSig = firstTxBlockTime
        ? { blockTime: firstTxBlockTime, signature: sampledHistory.firstSeenSignature || null }
        : null;
      timestamps = Array.isArray(enhancedSampleSummary.timestamps) ? enhancedSampleSummary.timestamps : [];
      failedTxCount = enhancedSampleSummary.failedTxCount;
      if (firstTxBlockTime && (!cachedFirstTx || firstTxBlockTime < cachedFirstTx)) {
        updateWalletEntry(address, { firstTxTimestamp: firstTxBlockTime });
      }
      const bestTxCount = Math.max(totalSigCount, cachedWallet?.stats?.transactions || 0);
      if (bestTxCount > (cachedWallet?.stats?.transactions || 0)) {
        updateWalletEntry(address, { stats: { ...(cachedWallet?.stats || {}), transactions: bestTxCount } });
      }
      // High-volume wallet on the enhanced-sample path: gate the optional live funding
      // walk (cost) and let looksEstablished fall back to the tx-volume proxy in case the
      // first-tx walk was time-bounded (under-estimated age).
      _heavyWallet = totalSigCount >= 5000;
    } else {
      const signatures = await conn.getSignaturesForAddress(pubkey, { limit: 1000 });
      allSignatures = [...signatures];
      oldestSig = signatures.length > 0 ? signatures[signatures.length - 1] : null;
      const sybilRpcUrl = getRpcUrl(address) || 'https://api.mainnet-beta.solana.com';
      let earlySignatures = [];
      let paginationReachedEnd = signatures.length < 1000;

      if (signatures.length >= 1000) {
        let cursor = signatures[signatures.length - 1]?.signature;
        for (let page = 1; page < 2 && cursor && !_overBudget(); page += 1) {
          try {
            const moreSigs = await conn.getSignaturesForAddress(pubkey, { before: cursor, limit: 1000 });
            if (moreSigs.length === 0) {
              paginationReachedEnd = true;
              break;
            }
            allSignatures.push(...moreSigs);
            cursor = moreSigs[moreSigs.length - 1].signature;
            earlySignatures = moreSigs;
            const lastSig = moreSigs[moreSigs.length - 1];
            if (lastSig?.blockTime && (!oldestSig?.blockTime || lastSig.blockTime < oldestSig.blockTime)) {
              oldestSig = lastSig;
            }
            if (moreSigs.length < 1000) {
              paginationReachedEnd = true;
              break;
            }
          } catch {
            break;
          }
        }
      }
      totalSigCount = allSignatures.length;
      _heavyWallet = !paginationReachedEnd;

      const SOLANA_GENESIS = 1584000000;
      if (paginationReachedEnd && allSignatures.length > 0) {
        for (let index = allSignatures.length - 1; index >= 0; index -= 1) {
          if (allSignatures[index].blockTime > SOLANA_GENESIS) {
            firstTxBlockTime = allSignatures[index].blockTime;
            break;
          }
        }
      } else if (oldestSig?.blockTime > SOLANA_GENESIS) {
        firstTxBlockTime = oldestSig.blockTime;
      }
      if (firstTxBlockTime && (!oldestSig?.blockTime || firstTxBlockTime < oldestSig.blockTime)) {
        oldestSig = { ...(oldestSig || {}), blockTime: firstTxBlockTime };
      }

      const recentSigBatch = allSignatures.slice(0, 200).map((signatureInfo) => signatureInfo.signature);
      const earlySigs = earlySignatures.length > 0
        ? earlySignatures.slice(-100)
        : (allSignatures.length > 300 ? allSignatures.slice(-100) : []);
      const earlySigBatch = earlySigs.map((signatureInfo) => signatureInfo.signature);
      const recentSet = new Set(recentSigBatch);
      const dedupedEarlySigBatch = earlySigBatch.filter((signature) => !recentSet.has(signature));

      // Skip the (multi-RPC, ~12s) binary search for HEAVY wallets (>=2000 paginated
      // sigs) or when over budget — the oldest paginated sig is a fine lower-bound age
      // estimate for sybil scoring. This was the main cause of 15-17s scans on busy
      // wallets. Light wallets (<2000 sigs) still get an exact first-tx time.
      const needsBinarySearch = !paginationReachedEnd && !_overBudget() && allSignatures.length < 2000;
      const firstTxPromise = needsBinarySearch
        ? findFirstTxTime(conn, pubkey, allSignatures.slice(-1000), cachedFirstTx, sybilRpcUrl)
        : Promise.resolve({ firstTxTime: firstTxBlockTime, totalSigs: totalSigCount });
      const firstTxResult = await Promise.allSettled([firstTxPromise]).then((results) => results[0]);
      await new Promise((resolve) => setTimeout(resolve, 100)); // brief pause before batch RPC parse to avoid rate limiting

      const parseRpcUrl = getBatchRpcUrl(address + ':parse');
      const limitedRecent = recentSigBatch.slice(0, 100);
      const limitedEarly = dedupedEarlySigBatch.slice(0, 100);
      const parseSigs = [...limitedRecent, ...limitedEarly];
      const recentCount = limitedRecent.length;

      const allParsedResults = await batchGetParsedTxs(parseRpcUrl, parseSigs, { batchSize: 100, delayMs: 200 });

      const ftResult = firstTxResult.status === 'fulfilled' ? firstTxResult.value : null;
      const resolvedFirstTxTime = ftResult?.firstTxTime ?? firstTxBlockTime;
      if (resolvedFirstTxTime && (!oldestSig?.blockTime || resolvedFirstTxTime < oldestSig.blockTime)) {
        oldestSig = { ...(oldestSig || {}), blockTime: resolvedFirstTxTime };
      }
      if (resolvedFirstTxTime && (!cachedFirstTx || resolvedFirstTxTime < cachedFirstTx)) {
        updateWalletEntry(address, { firstTxTimestamp: resolvedFirstTxTime });
      }
      const bestTxCount = Math.max(totalSigCount, ftResult?.totalSigs || 0, cachedWallet?.stats?.transactions || 0);
      if (bestTxCount > (cachedWallet?.stats?.transactions || 0)) {
        updateWalletEntry(address, { stats: { ...(cachedWallet?.stats || {}), transactions: bestTxCount } });
      }

      parsedTxs = allParsedResults.slice(0, recentCount).filter(Boolean);
      earlyParsedTxs = allParsedResults.slice(recentCount).filter(Boolean);
      timestamps = allSignatures.filter((signatureInfo) => signatureInfo.blockTime).map((signatureInfo) => signatureInfo.blockTime * 1000);
      failedTxCount = allSignatures.filter((signatureInfo) => signatureInfo.err !== null).length;
    }

    const nowMs = Date.now();
    const walletAgeDays = oldestSig?.blockTime ? Math.round((nowMs / 1000 - oldestSig.blockTime) / 86400) : 0;

    let timingVariance = 1;
    let timingCV = 999;
    let isRobotic = false;
    if (timestamps.length >= 10) {
      const sorted = [...timestamps].sort((a, b) => a - b);
      const intervals = [];
      for (let index = 1; index < sorted.length; index += 1) intervals.push(sorted[index] - sorted[index - 1]);
      const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
      if (mean > 0) {
        const stdDev = Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length);
        timingCV = stdDev / mean;
        timingVariance = Math.min(1, timingCV / 1.5);
        isRobotic = timingCV < 0.25 && intervals.length >= 30;
      }
    }

    const uniqueDays = new Set(timestamps.map((timestamp) => new Date(timestamp).toISOString().slice(0, 10)));
    const activeDaysCount = uniqueDays.size;
    const totalLifespanDays = Math.max(walletAgeDays, 1);
    // F-4: divide active-days by the window we ACTUALLY observed (the sampled tx span),
    // not the full lifetime — otherwise a long-lived wallet whose history is only
    // partially sampled reports a spuriously low activity ratio (false low_activity +
    // lost trust bonus).
    let observedSpanDays = totalLifespanDays;
    if (timestamps.length >= 2) {
      let minTs = timestamps[0];
      let maxTs = timestamps[0];
      for (const t of timestamps) { if (t < minTs) minTs = t; if (t > maxTs) maxTs = t; }
      observedSpanDays = Math.min(totalLifespanDays, Math.max(1, (maxTs - minTs) / 86400000));
    }
    const activeDaysRatio = Math.min(1, activeDaysCount / Math.max(observedSpanDays, 1));

    const uniqueTokenMints = new Set();
    let nftCount = 0;
    for (const acc of tokenAccounts) {
      const info = acc.account?.data?.parsed?.info;
      if (!info) continue;
      const mint = info.mint;
      const amount = parseFloat(info.tokenAmount?.uiAmountString || '0');
      const decimals = info.tokenAmount?.decimals ?? 0;
      if (amount > 0) {
        uniqueTokenMints.add(mint);
        if (decimals === 0 && amount === 1) nftCount += 1;
      }
    }
    const tokenDiversityCount = uniqueTokenMints.size;

    let incomingVolume = enhancedSampleSummary?.incomingVolume || 0;
    let outgoingVolume = enhancedSampleSummary?.outgoingVolume || 0;
    let incomingCount = enhancedSampleSummary?.incomingCount || 0;
    let outgoingCount = enhancedSampleSummary?.outgoingCount || 0;
    let dustTxCount = enhancedSampleSummary?.dustTxCount || 0;
    let totalSolTxCount = enhancedSampleSummary?.totalSolTxCount || 0;
    let historicalMaxBalance = enhancedSampleSummary?.historicalMaxBalance ?? balance;
    const allProgramIds = enhancedSampleSummary?.allProgramIds ? new Set(enhancedSampleSummary.allProgramIds) : new Set();
    const incomingSenders = enhancedSampleSummary?.incomingSenders ? new Set(enhancedSampleSummary.incomingSenders) : new Set();
    const outgoingRecipients = enhancedSampleSummary?.outgoingRecipients ? new Set(enhancedSampleSummary.outgoingRecipients) : new Set();

    if (!enhancedSampleSummary) {
      for (const tx of parsedTxs) {
        if (!tx?.meta || !tx?.transaction) continue;
        if (tx.meta.err) continue;

        const ixs = tx.transaction.message?.instructions || [];
        for (const ix of ixs) {
          const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
          if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') {
            allProgramIds.add(pid);
          }
        }
        const innerIxs = tx.meta.innerInstructions || [];
        for (const inner of innerIxs) {
          for (const iix of (inner.instructions || [])) {
            const pid = iix.programId?.toBase58?.() || (typeof iix.programId === 'string' ? iix.programId : '');
            if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') {
              allProgramIds.add(pid);
            }
          }
        }

        const accounts = tx.transaction.message?.accountKeys || [];
        const pre = tx.meta.preBalances || [];
        const post = tx.meta.postBalances || [];
        let targetIdx = -1;
        for (let index = 0; index < accounts.length; index += 1) {
          const acc = resolveAccountKey(accounts[index]);
          if (acc === address) {
            targetIdx = index;
            break;
          }
        }
        if (targetIdx >= 0) {
          const diffLamports = (post[targetIdx] || 0) - (pre[targetIdx] || 0);
          const diffSol = diffLamports / 1e9;
          if (Math.abs(diffSol) >= 0.0001) {
            totalSolTxCount += 1;
            if (diffSol > 0) {
              incomingVolume += diffSol;
              incomingCount += 1;
            } else {
              outgoingVolume += Math.abs(diffSol);
              outgoingCount += 1;
            }
            if (Math.abs(diffSol) < 0.001) dustTxCount += 1;
          }
          const preBal = (pre[targetIdx] || 0) / 1e9;
          if (preBal > historicalMaxBalance) historicalMaxBalance = preBal;
          for (let index = 0; index < accounts.length; index += 1) {
            if (index === targetIdx) continue;
            const acc = resolveAccountKey(accounts[index]);
            if (!acc || acc === '11111111111111111111111111111111') continue;
            const otherDiff = ((post[index] || 0) - (pre[index] || 0)) / 1e9;
            if (treasuryWallets.has(acc)) continue;
            if (diffSol > 0.001 && otherDiff < -0.001) incomingSenders.add(acc);
            if (diffSol < -0.001 && otherDiff > 0.001) outgoingRecipients.add(acc);
          }
        }
      }
    }

    let clusterSimilarity = 0;
    let fundingChainDepth = 0;
    let hubSpokeScore = 0;
    let temporalCohortScore = 0;
    let temporalCohort = null;
    let splFlowDetected = Boolean(enhancedSampleSummary?.splFlowDetected);
    let adaptiveThresholdTriggered = false;
    const allSiblings = new Set();
    const sameDepthSiblings = new Set();
    let hasSolDomain = false;
    let topFunderPctExport = 0;
    let topFunderTxCount = 0;
    let cexTrustBonus = 0;

    let resolvedTopFunder = null;
    let resolvedIncoming = null;
    let resolvedTokenFundingSources = enhancedSampleSummary?.tokenFundingSources || new Map();
    let resolvedPrimaryFundingSource = null;
    const fundingGraphPromise = (async () => {
      try {
        const allTxsForFunding = [...parsedTxs, ...earlyParsedTxs];
        const fundingSummary = enhancedSampleSummary || summarizeEnhancedTxHistory(allTxsForFunding, address, balance);
        const incoming = fundingSummary?.incoming || extractSolTransfers(allTxsForFunding, address).incoming;
        resolvedIncoming = incoming;
        resolvedTokenFundingSources = fundingSummary?.tokenFundingSources || new Map();
        splFlowDetected = splFlowDetected || Boolean(fundingSummary?.splFlowDetected);
        persistFundingEdgesForTarget(address, incoming, resolvedTokenFundingSources);

        const dominantSolFunder = getDominantFundingSource(incoming, 'totalSol');
        const dominantStableFunder = getDominantTokenFundingSource(resolvedTokenFundingSources, { stableOnly: true });
        const dominantTrackedTokenFunder = getDominantTokenFundingSource(resolvedTokenFundingSources);

        let topFunder = dominantSolFunder.address;
        let topAmount = dominantSolFunder.amount;
        let topFunderCount = dominantSolFunder.count;
        let topFunderPct = dominantSolFunder.share;
        let topFundingMint = solMint;

        if (dominantStableFunder.address && dominantStableFunder.share > 0.6 && dominantStableFunder.share >= topFunderPct) {
          topFunder = dominantStableFunder.address;
          topAmount = dominantStableFunder.amount;
          topFunderCount = dominantStableFunder.count;
          topFunderPct = dominantStableFunder.share;
          topFundingMint = dominantStableFunder.mints[0] || usdcMint;
        }

        topFunderTxCount = topFunderCount;
        resolvedTopFunder = topFunder;
        topFunderPctExport = topFunderPct;
        if (incoming.size === 0 && allTxsForFunding.length > 0) {
          console.warn(`[sybil-funding] ${address.slice(0, 8)}: 0 funding sources from ${allTxsForFunding.length} parsed txs`);
        }

        const topFunderLabel = topFunder ? knownLabels[topFunder] : null;
        if (topFunder) {
          resolvedPrimaryFundingSource = {
            address: topFunder,
            label: topFunderLabel?.label || null,
            type: topFunderLabel?.type || 'wallet',
            tokenMint: topFundingMint,
            transactionCount: topFunderCount,
            percentage: Math.round(topFunderPct * 100),
            ...(topFundingMint === solMint
              ? { totalSolReceived: Math.round(topAmount * 10000) / 10000 }
              : { totalAmount: Math.round(topAmount * 10000) / 10000 }),
          };
        } else if (dominantTrackedTokenFunder.address) {
          const trackedLabel = knownLabels[dominantTrackedTokenFunder.address];
          resolvedPrimaryFundingSource = {
            address: dominantTrackedTokenFunder.address,
            label: trackedLabel?.label || null,
            type: trackedLabel?.type || 'wallet',
            tokenMint: dominantTrackedTokenFunder.mints[0] || null,
            transactionCount: dominantTrackedTokenFunder.count,
            percentage: Math.round(dominantTrackedTokenFunder.share * 100),
            totalAmount: Math.round(dominantTrackedTokenFunder.amount * 10000) / 10000,
          };
        }

        // Heavy wallets (>=5000 tx) skip the live multi-RPC funding walk to stay within
        // the time budget — their cluster membership still comes from the (RPC-free) graph
        // + cross-sibling cache, and fresh farms are almost always thin (full walk runs).
        if (topFunder && topFunderPct > 0.7 && topAmount > 0.05 && !_overBudget() && !_heavyWallet) {
          persistFundingEdge(topFunder, address, topFundingMint, topAmount, 1);
          const known = knownLabels[topFunder];
          if (known && (known.type === 'cex' || known.type === 'bridge')) {
            cexTrustBonus = Math.max(cexTrustBonus, 3);
          } else {
            const topFunderHistoryPromise = fetchEnhancedTxHistory(topFunder, { limit: 100 })
              .then((data) => data?.txs?.length ? summarizeEnhancedTxHistory(data.txs, topFunder, 0) : null)
              .catch(() => null);
            const funderConnPromise = conn.getSignaturesForAddress(new PublicKey(topFunder), { limit: 100 }).catch(() => []);
            const [topFunderSummary, funderSigs] = await Promise.all([topFunderHistoryPromise, funderConnPromise]);
            const siblingCandidates = new Set();

            if (topFunderSummary?.outgoing?.size) {
              const outgoingList = [...topFunderSummary.outgoing.entries()]
                .filter(([candidate]) => candidate !== address && !treasuryWallets.has(candidate))
                .sort((a, b) => b[1].totalSol - a[1].totalSol)
                .slice(0, 30);
              for (const [candidate] of outgoingList) siblingCandidates.add(candidate);
            } else if (Array.isArray(funderSigs) && funderSigs.length > 0) {
              const funderBatch = funderSigs.map((signatureInfo) => signatureInfo.signature);
              const funderParsed = (await batchGetParsedTxs(getBatchRpcUrl(topFunder), funderBatch, { batchSize: 100, delayMs: 300 })).filter(Boolean);
              for (const tx of funderParsed) {
                if (!tx?.meta || !tx?.transaction) continue;
                const accounts = tx.transaction.message?.accountKeys || [];
                const pre = tx.meta.preBalances || [];
                const post = tx.meta.postBalances || [];
                for (let index = 0; index < accounts.length; index += 1) {
                  const acc = resolveAccountKey(accounts[index]);
                  const diff = ((post[index] || 0) - (pre[index] || 0)) / 1e9;
                  if (diff > 0.01 && acc !== topFunder && acc !== address && acc !== '11111111111111111111111111111111') {
                    siblingCandidates.add(acc);
                  }
                }
              }
            }

            // Hub guard: a funder that fans out to many distinct recipients (a CEX
            // hot wallet, an airdrop/distributor, a project payout wallet) is NOT
            // evidence that its recipients are a sybil farm. Receiving money from a
            // busy hub must not sibling-link or cluster innocent passive recipients —
            // otherwise one incoming transfer brands a wallet (and, with the cluster
            // hard-cap, near-permanently).
            // Only skip clustering for true MEGA-hubs (a CEX/major distributor fans
            // out to hundreds+). Mid-size fan-out (an airdrop vs a 50-wallet farm) is
            // NOT decided here — funder shape can't tell them apart — the per-wallet
            // looksEstablished behavior gate (below) does.
            const funderOutDegree = topFunderSummary?.outgoing?.size || 0;
            if (funderOutDegree > 150 || siblingCandidates.size > 150) {
              siblingCandidates.clear();
            }

            for (const sibling of siblingCandidates) {
              allSiblings.add(sibling);
              sameDepthSiblings.add(sibling);
            }

            const siblingCount = allSiblings.size;
            if (siblingCount >= 1) {
              hubSpokeScore = Math.min(1, siblingCount / 8);
            }
            if (siblingCount >= 3 && topFunderPct >= 0.8) adaptiveThresholdTriggered = true;

            if (topFunderSummary?.incoming?.size && topFunderPct > 0.75 && !_overBudget()) {
              const grandDominant = getDominantFundingSource(topFunderSummary.incoming, 'totalSol');
              const grandShare = grandDominant.share || 0;
              const grandFunder = grandDominant.address;
              if (grandFunder && grandShare > 0.7 && grandDominant.amount > 0.05) {
                try {
                  fundingChainDepth = 2;
                  persistFundingEdge(grandFunder, topFunder, solMint, topFunderSummary.incoming.get(grandFunder), 2);
                  const grandFunderHistory = await fetchEnhancedTxHistory(grandFunder, { limit: 100 });
                  const grandFunderSummary = grandFunderHistory?.txs?.length ? summarizeEnhancedTxHistory(grandFunderHistory.txs, grandFunder, 0) : null;
                  if (grandFunderSummary?.outgoing?.size && grandFunderSummary.outgoing.size <= 150) {
                    const sameDepthList = [...grandFunderSummary.outgoing.entries()]
                      .filter(([candidate]) => candidate !== topFunder && candidate !== address && !treasuryWallets.has(candidate))
                      .sort((a, b) => b[1].totalSol - a[1].totalSol)
                      .slice(0, 20);
                    for (const [candidate] of sameDepthList) {
                      allSiblings.add(candidate);
                      sameDepthSiblings.add(candidate);
                    }
                  }

                  if (fundingChainDepth >= 2 && grandFunder && grandShare > 0.7) {
                    const level3 = await fetchDominantEnhancedFunder(grandFunder, 0.7).catch(() => null);
                    if (level3?.dominant?.address) {
                      const greatGrandFunder = level3.dominant.address;
                      const greatGrandLabel = knownLabels[greatGrandFunder];
                      if (greatGrandLabel && (greatGrandLabel.type === 'cex' || greatGrandLabel.type === 'bridge')) {
                        cexTrustBonus = Math.max(cexTrustBonus, 3);
                      } else {
                        fundingChainDepth = 3;
                        persistFundingEdge(greatGrandFunder, grandFunder, solMint, level3.summary.incoming.get(greatGrandFunder), 3);
                        const level4 = await fetchDominantEnhancedFunder(greatGrandFunder, 0.7).catch(() => null);
                        if (level4?.dominant?.address) {
                          const greatGreatGrandFunder = level4.dominant.address;
                          const greatGreatGrandLabel = knownLabels[greatGreatGrandFunder];
                          if (greatGreatGrandLabel && (greatGreatGrandLabel.type === 'cex' || greatGreatGrandLabel.type === 'bridge')) {
                            cexTrustBonus = Math.max(cexTrustBonus, 3);
                          } else {
                            fundingChainDepth = 4;
                            persistFundingEdge(greatGreatGrandFunder, greatGrandFunder, solMint, level4.summary.incoming.get(greatGreatGrandFunder), 4);
                          }
                        }
                      }
                    }
                  }

                  if (fundingChainDepth >= 2 && grandFunder) {
                    updateSybilGraphNode(grandFunder, {
                      riskScore: Math.max((sybilGraph.nodes[grandFunder]?.riskScore || 0), 60),
                      inferredFromCluster: address,
                      fundedBy: [],
                      siblings: [topFunder, address],
                    });
                  }
                } catch {}
                if (topFunder && allSiblings.size >= 2) {
                  const existingFunderNode = sybilGraph.nodes[topFunder];
                  if (!existingFunderNode || existingFunderNode.riskScore < 40) {
                    updateSybilGraphNode(topFunder, {
                      riskScore: Math.max((existingFunderNode?.riskScore || 0), 40),
                      siblings: [address, ...[...allSiblings].slice(0, 10)],
                    });
                  }
                }
                if (allSiblings.size >= 2) {
                  // clusterSimilarity is now computed as REAL cross-sibling behavioral
                  // similarity (hour-profile cosine) further below, not a sibling count.
                }
              }
            }
          }
        }

        if (resolvedTopFunder && Number.isFinite(Number(firstTxBlockTime)) && totalSigCount > 0) {
          temporalCohort = detectTemporalFundingCohort({
            address,
            firstTxBlockTime,
            txCount: totalSigCount,
            dominantFunder: resolvedTopFunder,
          });
          temporalCohortScore = temporalCohort.score;
        }
      } catch {}
    })();

    const domainCheckPromise = (async () => {
      try {
        const NAME_PROGRAM = new PublicKey('namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX');
        const nameAccounts = await conn.getProgramAccounts(NAME_PROGRAM, {
          filters: [{ memcmp: { offset: 32, bytes: pubkey.toBase58() } }],
          dataSlice: { offset: 0, length: 1 },
        });
        hasSolDomain = nameAccounts.length > 0;
      } catch {}
    })();

    await Promise.allSettled([fundingGraphPromise, domainCheckPromise]);
    _p('after-funding');

    const hourBuckets = new Array(24).fill(0);
    const dayBuckets = new Array(7).fill(0);
    for (const timestamp of timestamps) {
      const date = new Date(timestamp);
      hourBuckets[date.getUTCHours()] += 1;
      dayBuckets[date.getUTCDay()] += 1;
    }
    let hourEntropy = 0;
    const totalTs = timestamps.length || 1;
    for (const count of hourBuckets) {
      if (count > 0) {
        const p = count / totalTs;
        hourEntropy -= p * Math.log2(p);
      }
    }
    let intervalEntropy = 0;
    if (timestamps.length >= 10) {
      const sorted = [...timestamps].sort((a, b) => a - b);
      const intervals = [];
      for (let index = 1; index < sorted.length; index += 1) intervals.push(sorted[index] - sorted[index - 1]);
      // Bin intervals by VALUE (log-scaled, to span the wide range of human inter-tx
      // gaps), then entropy of bin counts. Low entropy = intervals concentrated in a
      // few value ranges = regular/scripted cadence; high = varied/human.
      // (Previously this binned by array POSITION, which made entropy a near-constant
      // ~3.32 and the metric useless.)
      let minIv = intervals[0];
      let maxIv = intervals[0];
      for (const iv of intervals) { if (iv < minIv) minIv = iv; if (iv > maxIv) maxIv = iv; }
      const logMin = Math.log(Math.max(1, minIv));
      const logRange = Math.max(1e-9, Math.log(Math.max(1, maxIv)) - logMin);
      const bins = new Array(10).fill(0);
      for (const iv of intervals) {
        const norm = (Math.log(Math.max(1, iv)) - logMin) / logRange;
        const bin = Math.min(9, Math.max(0, Math.floor(norm * 10)));
        bins[bin] += 1;
      }
      for (const count of bins) {
        if (count > 0) {
          const p = count / intervals.length;
          intervalEntropy -= p * Math.log2(p);
        }
      }
    }

    // ---- Cross-sibling behavioral similarity (the REAL clusterSimilarity) ----
    // Per-wallet metrics can't separate a sybil farm from a CEX/airdrop, but whether
    // the SIBLINGS (same-funder wallets) behave IDENTICALLY can: a coordinated farm
    // runs on one schedule, so the wallet's hour-of-day activity profile is near-
    // identical to its siblings' (high cosine). Independent airdrop/CEX recipients are
    // not synchronized. This is the signal that catches even AGED/active farms that
    // pass the looksEstablished gate. (Replaces the old useless count = siblings/12.)
    // Async-cache design: every scan already stores its own hour-of-day profile in
    // metrics.hourBuckets, so a sibling's "fingerprint" is read from the cached scan —
    // ZERO extra RPC on the hot path (the inline-fetch version exhausted the rate limit
    // and hung scans). Similarity is computed only over siblings already scanned (the
    // pool grows over time); it degrades to 0 otherwise. Never blocks.
    let behavioralSimilarity = 0;
    if (allSiblings.size >= 2) {
      const selfNorm = Math.sqrt(hourBuckets.reduce((s, v) => s + v * v, 0));
      const sims = [];
      for (const sib of [...allSiblings].slice(0, 12)) {
        let sv;
        try { sv = loadSybilCacheEntry(sib)?.analysis?.metrics?.hourBuckets; } catch (e) { sv = null; }
        if (!Array.isArray(sv) || sv.length !== 24) continue;
        const sNorm = Math.sqrt(sv.reduce((s2, v) => s2 + (v * v), 0));
        if (selfNorm === 0 || sNorm === 0) continue;
        let dot = 0;
        for (let h = 0; h < 24; h += 1) dot += hourBuckets[h] * sv[h];
        sims.push(dot / (selfNorm * sNorm));
      }
      if (sims.length >= 2) behavioralSimilarity = sims.reduce((a, b) => a + b, 0) / sims.length;
    }
    clusterSimilarity = behavioralSimilarity;
    _p('after-crosssibling');

    const weekendTxs = dayBuckets[0] + dayBuckets[6];
    const weekendRatio = totalTs > 20 ? weekendTxs / totalTs : 0.28;

    const programInteractionCounts = enhancedSampleSummary?.programInteractionCounts
      ? new Map(enhancedSampleSummary.programInteractionCounts)
      : new Map();
    if (!enhancedSampleSummary) {
      for (const tx of parsedTxs) {
        if (!tx?.meta || !tx?.transaction || tx.meta.err) continue;
        const ixs = tx.transaction.message?.instructions || [];
        const txPrograms = new Set();
        for (const ix of ixs) {
          const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
          if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') txPrograms.add(pid);
        }
        for (const pid of txPrograms) {
          programInteractionCounts.set(pid, (programInteractionCounts.get(pid) || 0) + 1);
        }
      }
    }
    let shallowProtocols = enhancedSampleSummary?.shallowProtocols || 0;
    let deepProtocols = enhancedSampleSummary?.deepProtocols || 0;
    if (!enhancedSampleSummary) {
      for (const [, count] of programInteractionCounts) {
        if (count <= 2) shallowProtocols += 1;
        if (count >= 5) deepProtocols += 1;
      }
    }
    const farmingRatio = enhancedSampleSummary?.farmingRatio
      ?? (programInteractionCounts.size > 3 ? shallowProtocols / programInteractionCounts.size : 0);

    const DEFI_PROGRAMS = {
      JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'jupiter',
      whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'orca',
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'raydium',
      CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'raydium_clmm',
      LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'meteora',
      So1endDq2YkqhipRh3WViPa8hFb7GVEtcEMF3CBAK8h: 'solend',
      MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA: 'marginfi',
      KLend2g3cP87ber41GXWsSZQz9R1hGT2bVBaeEdnKHR: 'kamino',
      CgDG2CLNqR2ypE3CXTMEq5R6J8FaqVjChn9Tfmwocs4Y: 'marinade',
      SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy: 'spl_stake_pool',
      JitoSOL: 'jito',
      GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw: 'spl_governance',
      GovHgfDPyQ1GwjFhNkMqZVs9EVecaH3MQ1Lmob5NLz2v: 'realms',
    };
    const defiCategories = new Set();
    for (const pid of allProgramIds) {
      const sourceName = pid.startsWith('source:') ? pid.slice(7).toLowerCase() : null;
      const name = DEFI_PROGRAMS[pid] || sourceName;
      if (!name) continue;
      if (['jupiter', 'orca', 'raydium', 'raydium_clmm', 'meteora'].includes(name)) defiCategories.add('dex');
      if (['solend', 'marginfi', 'kamino'].includes(name)) defiCategories.add('lending');
      if (['marinade', 'spl_stake_pool', 'jito'].includes(name)) defiCategories.add('staking');
      if (['spl_governance', 'realms'].includes(name)) defiCategories.add('governance');
    }
    const defiDepth = defiCategories.size;

    const signals = [];

    let selfTransferCount = enhancedSampleSummary?.selfTransferCount || 0;
    if (!enhancedSampleSummary) {
      for (const tx of parsedTxs) {
        if (!tx?.meta || !tx?.transaction || tx.meta.err) continue;
        const accounts = tx.transaction.message?.accountKeys || [];
        let targetIdx = -1;
        for (let index = 0; index < accounts.length; index += 1) {
          const acc = resolveAccountKey(accounts[index]);
          if (acc === address) {
            targetIdx = index;
            break;
          }
        }
        if (targetIdx >= 0) {
          const ixs = tx.transaction.message?.instructions || [];
          for (const ix of ixs) {
            const parsed = ix.parsed;
            if (parsed?.type === 'transfer' && parsed?.info) {
              if (parsed.info.source === address && parsed.info.destination === address) selfTransferCount += 1;
            }
          }
        }
      }
    }

    const totalCounterparties = incomingSenders.size + outgoingRecipients.size;
    const counterpartyRatio = totalSolTxCount > 5 ? totalCounterparties / totalSolTxCount : 1;

    let burstRatio = 0;
    if (timestamps.length >= 20 && walletAgeDays > 14) {
      const daySet = [...uniqueDays].sort();
      if (daySet.length >= 3) {
        let maxInWindow = 0;
        for (let index = 0; index < daySet.length; index += 1) {
          const windowStart = new Date(daySet[index]).getTime();
          const windowEnd = windowStart + 7 * 86400_000;
          let count = 0;
          for (let innerIndex = index; innerIndex < daySet.length; innerIndex += 1) {
            if (new Date(daySet[innerIndex]).getTime() <= windowEnd) count += 1;
            else break;
          }
          if (count > maxInWindow) maxInWindow = count;
        }
        burstRatio = maxInWindow / daySet.length;
      }
    }

    const uniquePrograms = allProgramIds.size;
    const noHistory = totalSigCount < 3;
    const thinHistory = !noHistory && totalSigCount < 10 && walletAgeDays < 14;
    signals.push({
      id: 'no_history',
      name: noHistory ? 'No Transaction History' : 'Thin History',
      category: 'behavioral',
      detected: noHistory || thinHistory,
      weight: noHistory ? 30 : 15,
      severity: noHistory ? 'danger' : 'warning',
      value: `${totalSigCount} txs`,
      description: noHistory
        ? 'Wallet has virtually no transaction history — trust cannot be assessed'
        : `Only ${totalSigCount} transactions in ${walletAgeDays} days — insufficient data`,
    });

    const isNewWallet = walletAgeDays < 30;
    const freshBurst = isNewWallet && totalSigCount > 50;
    signals.push({
      id: 'wallet_age',
      name: freshBurst ? 'Fresh Wallet Burst' : 'New Wallet',
      category: 'behavioral',
      detected: isNewWallet,
      weight: freshBurst ? 20 : 12,
      severity: freshBurst ? 'danger' : (isNewWallet ? 'warning' : 'info'),
      value: isNewWallet ? `${walletAgeDays}d / ${totalSigCount} txs` : `${walletAgeDays}d`,
      description: freshBurst
        ? `${totalSigCount} transactions in only ${walletAgeDays} days — suspicious burst`
        : (isNewWallet ? `Wallet is only ${walletAgeDays} days old` : `Wallet is ${walletAgeDays} days old`),
    });

    const timingDetected = isRobotic || (timingCV < 0.3 && timestamps.length >= 10);
    signals.push({
      id: 'timing_pattern',
      name: isRobotic ? 'Robotic Timing' : 'Uniform Timing',
      category: 'behavioral',
      detected: timingDetected,
      weight: isRobotic ? 18 : 10,
      severity: isRobotic ? 'danger' : (timingDetected ? 'warning' : 'info'),
      value: timingCV < 999 ? `CV ${timingCV.toFixed(2)}` : 'N/A',
      description: isRobotic
        ? 'Extreme timing uniformity — automated script detected'
        : (timingDetected ? 'Transactions are suspiciously evenly spaced' : 'Transaction timing appears natural'),
    });

    const lowActivityRatio = walletAgeDays > 60 && activeDaysRatio < 0.05;
    signals.push({
      id: 'low_activity_ratio',
      name: 'Low Activity Ratio',
      category: 'behavioral',
      detected: lowActivityRatio,
      weight: 8,
      severity: lowActivityRatio ? 'warning' : 'info',
      value: `${(activeDaysRatio * 100).toFixed(1)}%`,
      description: lowActivityRatio
        ? `Only active ${activeDaysCount} of ${totalLifespanDays} days (${(activeDaysRatio * 100).toFixed(1)}%)`
        : `Active ${activeDaysCount} of ${totalLifespanDays} days`,
    });

    const isBurst = burstRatio > 0.8 && activeDaysCount >= 3 && walletAgeDays > 30;
    signals.push({
      id: 'activity_burst',
      name: 'Activity Burst',
      category: 'behavioral',
      detected: isBurst,
      weight: 10,
      severity: isBurst ? 'warning' : 'info',
      value: `${(burstRatio * 100).toFixed(0)}% in 7d`,
      description: isBurst
        ? `${(burstRatio * 100).toFixed(0)}% of all active days fall within a single week — farming burst`
        : 'Activity is spread across wallet lifetime',
    });

    const lowTokenDiv = tokenDiversityCount < 3;
    signals.push({
      id: 'low_token_diversity',
      name: 'Low Token Diversity',
      category: 'financial',
      detected: lowTokenDiv,
      weight: 5,
      severity: lowTokenDiv ? 'warning' : 'info',
      value: `${tokenDiversityCount} tokens`,
      description: lowTokenDiv ? `Only ${tokenDiversityCount} unique tokens held` : `Holds ${tokenDiversityCount} unique tokens`,
    });

    const noNfts = nftCount === 0;
    signals.push({
      id: 'no_nft_holdings',
      name: 'No NFT Holdings',
      category: 'financial',
      detected: noNfts,
      weight: 4,
      severity: 'info',
      value: `${nftCount} NFTs`,
      description: noNfts ? 'Wallet holds no NFTs' : `Holds ${nftCount} NFTs`,
    });

    const totalVolume = incomingVolume + outgoingVolume;
    const flowRatio = totalVolume > 0 ? Math.max(incomingVolume, outgoingVolume) / totalVolume : 0.5;
    const oneDirectional = totalVolume > 1.0 && flowRatio > 0.9 && totalSolTxCount >= 5;
    signals.push({
      id: 'one_directional_flow',
      name: 'One-Directional Flow',
      category: 'financial',
      detected: oneDirectional,
      weight: 10,
      severity: oneDirectional ? 'warning' : 'info',
      value: oneDirectional
        ? (incomingVolume > outgoingVolume ? `${(flowRatio * 100).toFixed(0)}% inbound` : `${(flowRatio * 100).toFixed(0)}% outbound`)
        : `${(flowRatio * 100).toFixed(0)}% / ${(100 - flowRatio * 100).toFixed(0)}%`,
      description: oneDirectional ? 'Heavily one-directional SOL flow (suspicious)' : 'Balanced SOL flow',
    });

    // clusterSimilarity is now an hour-profile cosine (0..1) vs siblings; only a
    // high value means a synchronized/coordinated farm (unrelated wallets overlap
    // partially by timezone, so the bar must be high).
    const highClusterSim = clusterSimilarity > 0.85;
    signals.push({
      id: 'cluster_similarity',
      name: 'Cluster Similarity',
      category: 'network',
      detected: highClusterSim,
      weight: 15,
      severity: highClusterSim ? 'danger' : 'info',
      value: highClusterSim ? `${(clusterSimilarity * 100).toFixed(0)}% similar` : 'No cluster',
      description: highClusterSim ? 'Wallet shares funding source with multiple similar wallets' : 'No suspicious wallet clusters detected',
    });

    const temporalCohortDetected = temporalCohortScore >= 0.45;
    signals.push({
      id: 'temporal_cohort',
      name: 'Temporal Cohort',
      category: 'network',
      detected: temporalCohortDetected,
      weight: temporalCohortDetected ? Math.round(8 + temporalCohortScore * 6) : 0,
      severity: temporalCohortScore >= 0.7 ? 'danger' : (temporalCohortDetected ? 'warning' : 'info'),
      value: `${Math.round(temporalCohortScore * 100)}%`,
      description: temporalCohortDetected
        ? 'Wallet was created alongside multiple same-funder wallets in a narrow time window'
        : 'No suspicious wallet birth cohort detected',
    });

    const dustRatio = totalSolTxCount > 0 ? dustTxCount / totalSolTxCount : 0;
    const highDust = totalSolTxCount >= 5 && dustRatio > 0.5;
    signals.push({
      id: 'dust_transactions',
      name: 'Dust Transactions',
      category: 'financial',
      detected: highDust,
      weight: 8,
      severity: highDust ? 'warning' : 'info',
      value: `${(dustRatio * 100).toFixed(0)}% dust`,
      description: highDust ? `${dustTxCount}/${totalSolTxCount} transactions are dust (<0.001 SOL)` : 'Normal transaction sizes',
    });

    const lowDappInteraction = uniquePrograms < 5 && totalSigCount > 20;
    signals.push({
      id: 'low_dapp_interaction',
      name: 'Low dApp Interaction',
      category: 'behavioral',
      detected: lowDappInteraction,
      weight: 7,
      severity: lowDappInteraction ? 'warning' : 'info',
      value: `${uniquePrograms} programs`,
      description: lowDappInteraction
        ? (uniquePrograms === 0
          ? `No dApp interactions detected among ${totalSigCount} transactions — SOL transfers only`
          : `Only ${uniquePrograms} dApps used across ${totalSigCount} transactions`)
        : `Interacted with ${uniquePrograms} different programs`,
    });

    const drainedBalance = historicalMaxBalance > 1 && balance < historicalMaxBalance * 0.01;
    signals.push({
      id: 'drained_balance',
      name: 'Drained Balance',
      category: 'financial',
      detected: drainedBalance,
      weight: 7,
      severity: drainedBalance ? 'warning' : 'info',
      value: drainedBalance ? `${balance.toFixed(3)} / ${historicalMaxBalance.toFixed(1)} SOL` : `${balance.toFixed(2)} SOL`,
      description: drainedBalance
        ? `Current balance (${balance.toFixed(3)}) is <1% of historical max (${historicalMaxBalance.toFixed(1)} SOL)`
        : 'Balance appears normal',
    });

    const hasSelfTransfers = selfTransferCount >= 3;
    signals.push({
      id: 'self_transfers',
      name: 'Self-Transfers',
      category: 'behavioral',
      detected: hasSelfTransfers,
      weight: 12,
      severity: hasSelfTransfers ? 'danger' : 'info',
      value: `${selfTransferCount} self-sends`,
      description: hasSelfTransfers
        ? `${selfTransferCount} self-transfers detected — tx count inflation pattern`
        : 'No self-transfers detected',
    });

    const lowCounterpartyVariety = counterpartyRatio < 0.2 && totalSolTxCount >= 10;
    signals.push({
      id: 'counterparty_concentration',
      name: 'Counterparty Concentration',
      category: 'network',
      detected: lowCounterpartyVariety,
      weight: 10,
      severity: lowCounterpartyVariety ? 'warning' : 'info',
      value: `${Math.round(counterpartyRatio * 100)}%`,
      description: lowCounterpartyVariety
        ? 'Very few counterparties relative to tx count — hub/spoke or scripted relay'
        : 'Counterparty distribution looks healthy',
    });

    // Exclude labelled CEX/bridge funders: someone who always withdraws from the same
    // exchange hot wallet is not a "sybil relay" — that's normal human behavior.
    const topFunderLabelType = resolvedTopFunder ? knownLabels[resolvedTopFunder]?.type : null;
    const repeatedFunder = topFunderTxCount >= 3 && topFunderPctExport >= 0.75
      && topFunderLabelType !== 'cex' && topFunderLabelType !== 'bridge';
    const repeatedFunderWeight = topFunderTxCount >= 5 ? 16 : 10;
    signals.push({
      id: 'repeated_funder',
      name: 'Repeated Funder',
      category: 'network',
      detected: repeatedFunder,
      weight: repeatedFunderWeight,
      severity: repeatedFunder ? (topFunderTxCount >= 5 ? 'danger' : 'warning') : 'info',
      value: `${topFunderTxCount} deposits from same wallet`,
      description: repeatedFunder
        ? `Same non-exchange wallet funded this address ${topFunderTxCount} times — typical sybil relay pattern`
        : topFunderTxCount <= 1 ? 'No repeated funding from same wallet' : `Top funder sent ${topFunderTxCount} txs (within normal range)`,
    });

    // High hour-entropy means activity is spread evenly across the day — that's a
    // normal globally-active human, NOT a bot. Only flag it as bot-like when the hour
    // spread is near-maximal AND the inter-tx intervals are also unnaturally uniform.
    const botlikeHours = timestamps.length >= 20 && hourEntropy > 4.5 && timingCV < 0.3;
    const nightOwlHours = timestamps.length >= 20 && hourEntropy < 1.5;
    signals.push({
      id: 'hour_distribution',
      name: botlikeHours ? '24/7 Bot Activity' : (nightOwlHours ? 'Narrow Time Window' : 'Normal Hours'),
      category: 'behavioral',
      detected: botlikeHours || nightOwlHours,
      weight: botlikeHours ? 10 : (nightOwlHours ? 6 : 0),
      severity: botlikeHours ? 'warning' : 'info',
      value: `entropy ${hourEntropy.toFixed(2)}`,
      description: botlikeHours
        ? 'Activity spread evenly across all 24 hours — bot-like pattern'
        : (nightOwlHours ? 'All activity concentrated in a very narrow time window' : 'Normal day/night activity pattern'),
    });

    const isFarming = farmingRatio > 0.7 && shallowProtocols >= 5;
    signals.push({
      id: 'airdrop_farming',
      name: 'Airdrop Farming Pattern',
      category: 'behavioral',
      detected: isFarming,
      weight: 18,
      severity: isFarming ? 'danger' : 'info',
      value: `${shallowProtocols}/${programInteractionCounts.size} shallow`,
      description: isFarming
        ? `${shallowProtocols} protocols with only 1-2 interactions each — airdrop farming pattern`
        : `${deepProtocols} deeply-used protocols`,
    });

    const noWeekends = timestamps.length >= 30 && weekendRatio < 0.05;
    signals.push({
      id: 'no_weekends',
      name: 'No Weekend Activity',
      category: 'behavioral',
      detected: noWeekends,
      weight: 6,
      severity: noWeekends ? 'warning' : 'info',
      value: `${(weekendRatio * 100).toFixed(0)}% weekend`,
      description: noWeekends
        ? 'Nearly zero weekend activity — scheduled bot pattern'
        : `${(weekendRatio * 100).toFixed(0)}% of transactions on weekends`,
    });

    const failedRatio = totalSigCount >= 30 ? failedTxCount / totalSigCount : 0;
    const highFailRate = failedRatio > 0.5 && failedTxCount >= 15;
    signals.push({
      id: 'failed_tx_ratio',
      name: 'High Failed TX Rate',
      category: 'behavioral',
      detected: highFailRate,
      weight: 8,
      severity: highFailRate ? 'warning' : 'info',
      value: `${(failedRatio * 100).toFixed(0)}% failed`,
      description: highFailRate
        ? `${failedTxCount}/${totalSigCount} transactions failed — MEV/bot pattern`
        : `${(failedRatio * 100).toFixed(0)}% failure rate`,
    });

    let behaviorDriftDetected = enhancedSampleSummary?.behaviorDriftDetected || false;
    let behaviorDriftValue = enhancedSampleSummary?.behaviorDriftValue || '';
    if (!enhancedSampleSummary && earlyParsedTxs.length >= 10 && parsedTxs.length >= 20) {
      const earlyPrograms = new Set();
      for (const tx of earlyParsedTxs) {
        if (!tx?.transaction?.message?.instructions) continue;
        for (const ix of tx.transaction.message.instructions) {
          const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
          if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') earlyPrograms.add(pid);
        }
      }
      const recentPrograms = new Set();
      for (const tx of parsedTxs.slice(0, 50)) {
        if (!tx?.transaction?.message?.instructions) continue;
        for (const ix of tx.transaction.message.instructions) {
          const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
          if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') recentPrograms.add(pid);
        }
      }
      const intersection = [...earlyPrograms].filter((pid) => recentPrograms.has(pid)).length;
      const union = new Set([...earlyPrograms, ...recentPrograms]).size;
      const jaccard = union > 0 ? intersection / union : 1;
      if (jaccard < 0.1 && earlyPrograms.size >= 3 && recentPrograms.size >= 3) {
        behaviorDriftDetected = true;
        behaviorDriftValue = `${(jaccard * 100).toFixed(0)}% overlap (${earlyPrograms.size} early → ${recentPrograms.size} recent programs)`;
      }
    }
    signals.push({
      id: 'behavior_drift',
      name: 'Behavior Drift',
      category: 'behavioral',
      detected: behaviorDriftDetected,
      weight: 10,
      severity: behaviorDriftDetected ? 'warning' : 'info',
      value: behaviorDriftValue || 'N/A',
      description: behaviorDriftDetected
        ? 'Early wallet activity completely differs from recent — possible account sale/repurpose for farming'
        : 'Consistent behavior across wallet lifetime',
    });

    let rapidCycleCount = enhancedSampleSummary?.rapidCycleCount || 0;
    if (!enhancedSampleSummary && parsedTxs.length >= 10) {
      const txByTime = parsedTxs.filter((tx) => tx?.blockTime).sort((a, b) => a.blockTime - b.blockTime);
      for (let index = 0; index < txByTime.length - 1; index += 1) {
        const tx1 = txByTime[index];
        const tx2 = txByTime[index + 1];
        if (!tx1?.meta || !tx2?.meta) continue;
        const accs1 = tx1.transaction?.message?.accountKeys || [];
        const accs2 = tx2.transaction?.message?.accountKeys || [];
        let idx1 = -1;
        let idx2 = -1;
        for (let subIndex = 0; subIndex < accs1.length; subIndex += 1) {
          const candidate = typeof accs1[subIndex] === 'string' ? accs1[subIndex] : accs1[subIndex]?.pubkey?.toBase58?.() || '';
          if (candidate === address) {
            idx1 = subIndex;
            break;
          }
        }
        for (let subIndex = 0; subIndex < accs2.length; subIndex += 1) {
          const candidate = typeof accs2[subIndex] === 'string' ? accs2[subIndex] : accs2[subIndex]?.pubkey?.toBase58?.() || '';
          if (candidate === address) {
            idx2 = subIndex;
            break;
          }
        }
        if (idx1 >= 0 && idx2 >= 0) {
          const diff1 = ((tx1.meta.postBalances?.[idx1] || 0) - (tx1.meta.preBalances?.[idx1] || 0)) / 1e9;
          const diff2 = ((tx2.meta.postBalances?.[idx2] || 0) - (tx2.meta.preBalances?.[idx2] || 0)) / 1e9;
          if (diff1 > 0.01 && diff2 < -0.01 && (tx2.blockTime - tx1.blockTime) < 60) {
            const ratio = Math.abs(diff2) / diff1;
            if (ratio > 0.8 && ratio < 1.2) rapidCycleCount += 1;
          }
        }
      }
    }
    const isRapidCycling = rapidCycleCount >= 3;
    signals.push({
      id: 'rapid_cycling',
      name: 'Rapid SOL Cycling',
      category: 'financial',
      detected: isRapidCycling,
      weight: 12,
      severity: isRapidCycling ? 'danger' : 'info',
      value: `${rapidCycleCount} cycles`,
      description: isRapidCycling
        ? `${rapidCycleCount} rapid in→out cycles detected (<60s) — wash trading or fund relay`
        : 'No rapid cycling detected',
    });

    let riskScore = 0;
    for (const signal of signals) {
      if (!signal.detected) continue;
      riskScore += signal.weight;
    }
    riskScore = Math.min(100, riskScore);

    const fundingSources = [...new Set([
      ...incomingSenders,
      ...(resolvedTopFunder ? [resolvedTopFunder] : []),
    ])].filter((candidate) => !treasuryWallets.has(candidate));
    const { graphRisk, graphDetails, clusterConfirmed, clusterInfo, graphSiblings } = checkGraphForKnownSybils(address, fundingSources, [...allSiblings]);
    // Display-facing cluster truth from the persistent graph (NOT the live cross-sibling
    // cosine, which degrades to 0 without cached siblings). Union the live-discovered
    // siblings with the graph's accumulated knowledge so real cluster members actually
    // show their network. Kept SEPARATE from siblingCount/clusterSimilarity (which feed
    // scoring) so this is purely additive and changes no scores.
    const knownSiblings = [...new Set([
      ...allSiblings,
      ...(graphSiblings || []),
      ...((clusterInfo && clusterInfo.members) || []),
    ])].filter((s) => s && s !== address).slice(0, 30);
    const knownCluster = clusterInfo
      ? { label: clusterInfo.label, size: clusterInfo.size, funder: clusterInfo.funder }
      : null;
    if (graphRisk > 0) {
      riskScore = Math.min(100, riskScore + graphRisk);
    }

    let trustBonus = cexTrustBonus;
    if (walletAgeDays > 365) trustBonus += 5;
    if (walletAgeDays > 730) trustBonus += 3;
    if (walletAgeDays > 1460) trustBonus += 2;
    if (tokenDiversityCount >= 10) trustBonus += 3;
    if (tokenDiversityCount >= 25) trustBonus += 2;
    if (nftCount >= 3) trustBonus += 2;
    if (nftCount >= 10) trustBonus += 1;
    if (uniquePrograms >= 8) trustBonus += 2;
    if (uniquePrograms >= 15) trustBonus += 2;
    if (activeDaysRatio > 0.15) trustBonus += 2;
    if (activeDaysRatio > 0.4) trustBonus += 1;
    if (incomingSenders.size >= 5) trustBonus += 2;
    if (hasSolDomain) trustBonus += 4;
    if (defiDepth >= 2) trustBonus += 2;
    if (defiDepth >= 3) trustBonus += 2;
    // F-8: a cheap .sol domain + farmable token/NFT diversity shouldn't let a wallet
    // cancel real sybil risk and slip below the verdict thresholds. Cap the bonus, and
    // void it entirely when the wallet already shows >=2 danger-severity sybil signals.
    {
      const dangerSignalCount = signals.filter((sig) => sig.detected && sig.severity === 'danger').length;
      trustBonus = dangerSignalCount >= 2 ? 0 : Math.min(25, trustBonus);
    }
    // Funding correlation alone NEVER hard-caps — we can't tell a sybil farm from a
    // CEX/airdrop by funder shape (both fan out). The discriminator is the wallet's
    // OWN behavior: a real independent history (age + tx volume + protocol variety +
    // active days) means a human, even if it shares a funder with flagged wallets.
    // Only a "thin"/scripted wallet that is ALSO a confirmed cluster member gets the
    // non-cancellable floor — i.e. a farm bot, caught where the funding heuristic is blind.
    // age + tx + protocol variety are RELIABLE establishment signals. (activeDaysCount
    // was dropped: it's sample-biased — heavy wallets with 30k+ tx sample few distinct
    // days → wrongly read as not-established → falsely hard-capped. A sophisticated aged
    // farm that meets this bar but behaves identically to its siblings is still caught
    // by the synchronizedFarm cross-sibling override below.)
    // _heavyWallet means we couldn't paginate to the end within the time budget, so the
    // first-tx walk was bounded → walletAgeDays is an UNDER-estimate. But a wallet with
    // that many txs across 5+ programs is established by definition regardless of the
    // (uncertain) measured age, so accept it on the tx-volume proxy. This is what lets
    // the ≤10s age-walk bound never false-cap a genuinely old high-volume wallet.
    const looksEstablished =
      (walletAgeDays > 180 && totalSigCount >= 50 && uniquePrograms >= 5) ||
      (_heavyWallet && uniquePrograms >= 8 && totalSigCount >= 500);
    // Hard-cap a confirmed cluster member when EITHER it's a thin/scripted wallet
    // (the common farm), OR — even if it looks established — it behaves near-identically
    // to several siblings (a sophisticated aged farm: same funder + synchronized
    // hour-profile across >=3 siblings). The latter is what catches farms the
    // looksEstablished gate would otherwise wave through.
    const synchronizedFarm = behavioralSimilarity > 0.9 && allSiblings.size >= 3;
    const hardCapCluster = clusterConfirmed && (!looksEstablished || synchronizedFarm);
    const graphFloor = hardCapCluster
      ? Math.max(65, Math.floor(graphRisk * 0.6))
      : Math.max(10, Math.floor(graphRisk * 0.6));
    riskScore = Math.max(graphFloor, riskScore - trustBonus);

    if (graphRisk > 0) {
      signals.push({
        id: 'graph_intelligence',
        name: 'Known Sybil Network',
        category: 'network',
        detected: true,
        weight: graphRisk,
        severity: graphRisk >= 15 ? 'danger' : 'warning',
        value: `+${graphRisk} from graph`,
        description: graphDetails.join('; '),
      });
    }

    const riskLevel = riskScore >= 75 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 30 ? 'medium' : riskScore >= 10 ? 'low' : 'clean';
    let trustScore;
    if (totalSigCount === 0) {
      trustScore = 0;
    } else if (totalSigCount < 3) {
      trustScore = Math.min(10, Math.max(0, 100 - riskScore));
    } else {
      trustScore = Math.max(0, 100 - riskScore);
    }
    // Holding a (paid, ~0.03 SOL) Identity Prism ID is an out-of-band commitment
    // signal: add a fixed bonus on top of the DISPLAYED trust, capped at 100.
    // IMPORTANT: keep the pre-bonus value (baseTrustScore) for sybil verdict
    // CLASSIFICATION — the $0.03 ID must lift the shown score, but must NOT flip
    // legacySybilFlag (trust<50) and downgrade a real sybil's verdict.
    const baseTrustScore = trustScore;
    if (mintedAddresses && typeof mintedAddresses.has === 'function' && mintedAddresses.has(address)) {
      trustScore = Math.min(100, trustScore + 15);
    }
    const trustGrade = trustScore >= 90 ? 'A+' : trustScore >= 80 ? 'A' : trustScore >= 70 ? 'B' : trustScore >= 60 ? 'C' : trustScore >= 50 ? 'D' : 'F';

    // Helius buckets each tx under both a `type:` and a `source:` pseudo-code; the generic
    // ones (UNKNOWN/TRANSFER/NONE) are noise, not real protocol usage — drop them so the
    // "programs/protocols" display shows actual apps, not a giant "Unknown" bucket.
    const NOISE_PROGRAM_CODES = new Set(['UNKNOWN', 'TRANSFER', 'NONE', '']);
    const topProgramsList = [...programInteractionCounts.entries()]
      .filter(([pid]) => {
        const code = (pid.startsWith('source:') || pid.startsWith('type:')) ? pid.split(':')[1] : null;
        return !(code && NOISE_PROGRAM_CODES.has(String(code).toUpperCase()));
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([pid, count]) => {
        // Helius already classifies many interactions by protocol (source:/type: JUPITER,
        // PUMP_FUN, MAGIC_EDEN, …) — prettify those; fall back to our curated id→{name,
        // category} map; else honest "unknown" so the UI never shows a bare base58.
        const sourceCode = (pid.startsWith('source:') || pid.startsWith('type:'))
          ? pid.split(':')[1]
          : null;
        const labelEntry = programLabels[pid] || null;
        const name = (labelEntry && labelEntry.name)
          || (sourceCode ? prettifyProtocolCode(sourceCode) : null)
          || null;
        const category = (labelEntry && labelEntry.category)
          || (sourceCode ? protocolCodeCategory(sourceCode) : null)
          || (name ? null : 'unknown');
        return { programId: pid, name, category, interactions: count };
      });

    const analysis = {
      address,
      riskScore,
      riskLevel,
      trustScore,
      baseTrustScore,
      trustGrade,
      signals,
      metrics: {
        walletAgeDays,
        activeDaysCount,
        activeDaysRatio,
        tokenDiversityCount,
        nftCount,
        incomingVolume: Math.round(incomingVolume * 10000) / 10000,
        outgoingVolume: Math.round(outgoingVolume * 10000) / 10000,
        incomingCount,
        outgoingCount,
        uniqueSenders: incomingSenders.size,
        uniqueRecipients: outgoingRecipients.size,
        flowRatio: Math.round(flowRatio * 100),
        dustRatio: Math.round(dustRatio * 100),
        uniquePrograms,
        balance: Math.round(balance * 10000) / 10000,
        historicalMaxBalance: Math.round(historicalMaxBalance * 10000) / 10000,
        txCount: totalSigCount,
        clusterSimilarity: Math.round(clusterSimilarity * 100),
        selfTransferCount,
        counterpartyRatio: Math.round(counterpartyRatio * 100),
        burstRatio: Math.round(burstRatio * 100),
        trustBonus,
        cexTrustBonus,
        fundingChainDepth,
        topFunderTxCount,
        topFunderPct: Math.round(topFunderPctExport * 100),
        temporalCohortScore: Math.round(temporalCohortScore * 100) / 100,
        splFlowDetected,
        hourBuckets,
        dayBuckets,
        hubSpokeScore: Math.round(hubSpokeScore * 100),
        intervalEntropy: Math.round(intervalEntropy * 1000) / 1000,
        hourEntropy: Math.round(hourEntropy * 1000) / 1000,
        timingCV: timingCV < 999 ? Math.round(timingCV * 1000) / 1000 : null,
        siblingCount: allSiblings.size,
        hourEntropy: Math.round(hourEntropy * 100) / 100,
        intervalEntropy: Math.round(intervalEntropy * 100) / 100,
        weekendRatio: Math.round(weekendRatio * 100),
        shallowProtocols,
        deepProtocols,
        farmingRatio: Math.round(farmingRatio * 100),
        defiDepth,
        defiCategories: [...defiCategories],
        hasSolDomain,
        earlyTxsAnalyzed: earlyParsedTxs.length,
        rapidCycleCount,
        siblingAddresses: [...allSiblings].slice(0, 30),
        topPrograms: topProgramsList,
        heavyWallet: _heavyWallet,
        // Graph-derived cluster truth for the UI (RPC-free). Lets the cluster panel/graph
        // show real membership even when the live cross-sibling cosine is 0.
        knownCluster,
        knownSiblings,
      },
      behaviorProfile: {
        txTimingVariance: timingVariance,
        timingCV: timingCV < 999 ? Math.round(timingCV * 100) / 100 : null,
        intervalEntropy: Math.round(intervalEntropy * 100) / 100,
        hourEntropy: Math.round(hourEntropy * 100) / 100,
        protocolDiversity: Math.min(1, uniquePrograms / 10),
        defiDepth,
        activeDaysRatio: Math.round(activeDaysRatio * 100) / 100,
      },
      verdictSignals: {
        version: 2,
        temporalCohortScore: Math.round(temporalCohortScore * 100) / 100,
        fundingDepth: Math.max(0, Math.min(4, fundingChainDepth)),
        splFlowDetected,
        hubSpokeScore: Math.round(hubSpokeScore * 100) / 100,
        adaptiveThresholdTriggered,
      },
      primaryFundingSource: resolvedPrimaryFundingSource,
      scanMeta: {
        strategy: sampledHistory ? 'enhanced_stratified_sampling' : 'legacy_signature_scan',
        scanVersion: sampledHistory ? sybilScanVersion : 1,
        incremental: Boolean(sampledHistory?.incremental),
        newTxCount: Math.max(0, Number(sampledHistory?.newTxCount) || 0),
        sampleSize: sampledHistory?.sampleTxs?.length || 0,
      },
      timestamp: new Date().toISOString(),
    };
    analysis.verdict = getSybilVerdict(analysis);
    _p('before-clusters');
    persistAutoDetectedScanClusters({
      address,
      temporalCohort,
      temporalCohortScore,
      fundingChainDepth,
      sameDepthSiblings,
    });
    _p('after-clusters');
    analysis.walletType = (() => {
      if (analysis.verdict?.key === 'confirmed_sybil' || analysis.verdict?.key === 'probable_sybil') return 'sybil';
      if (analysis.verdict?.key === 'cluster_linked') return 'sybil_cluster';
      if (isRobotic && farmingRatio > 0.5) return 'bot';
      if (balance > 100 && totalSigCount > 500) return 'whale';
      if (defiDepth >= 3 && totalSolTxCount > 100) return 'defi_power_user';
      if (defiDepth >= 1 && totalSolTxCount > 30) return 'defi_user';
      if (nftCount >= 10) return 'nft_collector';
      if (farmingRatio > 0.6 && shallowProtocols >= 5) return 'airdrop_farmer';
      if (totalSigCount > 200 && activeDaysRatio > 0.15) return 'active_user';
      if (totalSigCount > 50) return 'regular_user';
      if (totalSigCount > 10) return 'light_user';
      if (totalSigCount <= 2) return 'empty';
      return 'new_user';
    })();

    let cachedFundingSources = [];
    if (resolvedIncoming && resolvedIncoming.size > 0) {
      const totalReceived = [...resolvedIncoming.values()].reduce((sum, value) => sum + value.totalSol, 0) || 1;
      cachedFundingSources = [...resolvedIncoming.entries()]
        .sort((a, b) => b[1].totalSol - a[1].totalSol)
        .slice(0, 20)
        .map(([addr, info]) => {
          const known = knownLabels[addr];
          return {
            address: addr,
            label: known?.label || null,
            type: known?.type || 'wallet',
            totalSolReceived: Math.round(info.totalSol * 10000) / 10000,
            transactionCount: info.count,
            percentage: Math.round((info.totalSol / totalReceived) * 100),
          };
        });
    }
    const topFundingSource = cachedFundingSources.length > 0 ? cachedFundingSources[0] : (resolvedPrimaryFundingSource || null);
    if (topFundingSource) analysis.primaryFundingSource = topFundingSource;
    persistSybilAnalysis(address, analysis, {
      fundingSources: cachedFundingSources,
      lastSeenSignature: sampledHistory?.lastSeenSignature || cachedBaseline?.lastSeenSignature || null,
      firstSeenSignature: sampledHistory?.firstSeenSignature || cachedBaseline?.firstSeenSignature || null,
      estimatedTxCount: totalSigCount,
      firstTxBlockTime: firstTxBlockTime || cachedBaseline?.firstTxBlockTime || null,
      isOwnWalletScan,
    });

    const metrics = analysis.metrics || {};
    const behaviorProfile = analysis.behaviorProfile || {};
    const detectedSignals = signals.filter((signal) => signal.detected).map((signal) => signal.id);

    const walletProfile = {
      sybil: {
        riskScore: analysis.riskScore,
        riskLevel: analysis.riskLevel,
        trustScore: analysis.trustScore,
        trustGrade: analysis.trustGrade,
        walletType: analysis.walletType,
        verdict: analysis.verdict || null,
        verdictKey: analysis.verdict?.key || null,
        bountyEligible: Boolean(analysis.verdict?.bountyEligible),
        confidence: analysis.verdict?.confidence || null,
        dataQuality: analysis.verdict?.dataQuality || null,
        networkConfirmed: Boolean(analysis.verdict?.networkConfirmed),
        updatedAt: new Date().toISOString(),
        detectedSignals,
        signalCount: detectedSignals.length,
        verdictSignals: analysis.verdictSignals,
        primaryFundingSource: analysis.primaryFundingSource || null,
      },
      stats: {
        tokens: metrics.tokenDiversityCount || 0,
        nfts: metrics.nftCount || 0,
        transactions: metrics.txCount || 0,
        solBalance: metrics.balance || 0,
        historicalMaxBalance: metrics.historicalMaxBalance || 0,
        walletAgeDays: metrics.walletAgeDays || 0,
        walletAgeYears: Math.floor((metrics.walletAgeDays || 0) / 365),
        activeDays: metrics.activeDaysCount || 0,
        activeDaysRatio: metrics.activeDaysRatio || 0,
      },
      financial: {
        incomingVolume: metrics.incomingVolume || 0,
        outgoingVolume: metrics.outgoingVolume || 0,
        incomingCount: metrics.incomingCount || 0,
        outgoingCount: metrics.outgoingCount || 0,
        uniqueSenders: metrics.uniqueSenders || 0,
        uniqueRecipients: metrics.uniqueRecipients || 0,
        flowRatio: metrics.flowRatio || 0,
        dustRatio: metrics.dustRatio || 0,
        selfTransferCount: metrics.selfTransferCount || 0,
        rapidCycleCount: metrics.rapidCycleCount || 0,
      },
      funding: {
        chainDepth: metrics.fundingChainDepth || 0,
        topFunderPct: metrics.topFunderPct || 0,
        topFunderTxCount: metrics.topFunderTxCount || 0,
        sources: cachedFundingSources.slice(0, 10),
        primarySource: analysis.primaryFundingSource || null,
        siblingCount: metrics.siblingCount || 0,
        hubSpokeScore: metrics.hubSpokeScore || 0,
        clusterSimilarity: metrics.clusterSimilarity || 0,
        temporalCohortScore: metrics.temporalCohortScore || 0,
        splFlowDetected: Boolean(metrics.splFlowDetected),
      },
      behavior: {
        timingCV: behaviorProfile.timingCV,
        hourEntropy: behaviorProfile.hourEntropy || 0,
        intervalEntropy: behaviorProfile.intervalEntropy || 0,
        weekendRatio: metrics.weekendRatio || 0,
        hourDistribution: metrics.hourBuckets || [],
        dayDistribution: metrics.dayBuckets || [],
        protocolDiversity: behaviorProfile.protocolDiversity || 0,
      },
      protocols: {
        uniquePrograms: metrics.uniquePrograms || 0,
        defiDepth: metrics.defiDepth || 0,
        defiCategories: metrics.defiCategories || [],
        topPrograms: topProgramsList.slice(0, 10),
        shallowProtocols: metrics.shallowProtocols || 0,
        deepProtocols: metrics.deepProtocols || 0,
        farmingRatio: metrics.farmingRatio || 0,
      },
      network: {
        siblings: [...allSiblings].slice(0, 30),
        hasSolDomain: metrics.hasSolDomain || false,
      },
      lastScannedAt: new Date().toISOString(),
      firstSeenAt: walletDatabase.get(address)?.firstSeenAt || new Date().toISOString(),
    };
    updateWalletEntry(address, walletProfile);
    _p('before-composite');
    triggerCompositeUpdate(address);
    _p('after-composite');

    updateSybilGraphNode(address, {
      riskScore: analysis.riskScore,
      trustGrade: analysis.trustGrade,
      fundedBy: fundingSources.slice(0, 5),
      siblings: [...allSiblings].slice(0, 20),
      defiDepth,
      hasSolDomain,
      walletAgeDays,
      verdictKey: analysis.verdict?.key || null,
      bountyEligible: Boolean(analysis.verdict?.bountyEligible),
      confidence: analysis.verdict?.confidence || null,
      networkConfirmed: Boolean(analysis.verdict?.networkConfirmed),
    });
    // Only persist co-recipients as inferred siblings when the SCANNED wallet itself
    // looks like a farm bot (thin/scripted). If it's an established wallet, its
    // co-recipients are just fellow CEX/airdrop customers — don't pollute the graph.
    // And write them BELOW the 50 "flagged" threshold so they aren't auto-counted as
    // confirmed sybils on each other's next scan (the cascade that branded innocents).
    if (!looksEstablished) {
      for (const sibling of allSiblings) {
        const existingNode = sybilGraph.nodes[sibling];
        const inferredRisk = Math.min(48, Math.max(30, Math.floor(riskScore * 0.7)));
        if (!existingNode || existingNode.riskScore < inferredRisk) {
          updateSybilGraphNode(sibling, {
            inferredFromCluster: address,
            riskScore: inferredRisk,
            fundedBy: resolvedTopFunder ? [resolvedTopFunder] : [],
            siblings: [address, ...[...allSiblings].filter((candidate) => candidate !== sibling).slice(0, 10)],
            verdictKey: existingNode?.verdictKey || 'cluster_linked',
            bountyEligible: Boolean(existingNode?.bountyEligible),
            confidence: existingNode?.confidence || 'low',
          });
        }
      }
    }
    // Never form a flagged cluster around a labelled CEX/bridge funder — its
    // recipients are exchange customers, not a farm. (F-2: stop the cascade where a
    // mid-size CEX/airdrop fanout brands its passive recipients.)
    if (allSiblings.size >= 5 && riskScore >= 40 && !looksEstablished
        && topFunderLabelType !== 'cex' && topFunderLabelType !== 'bridge') {
      const clusterKey = resolvedTopFunder || fundingSources[0] || address;
      const existing = sybilGraph.flaggedClusters.find((cluster) => cluster.funder === clusterKey);
      if (existing) {
        existing.lastSeen = Date.now();
        if (!existing.members.includes(address)) existing.members.push(address);
      } else {
        sybilGraph.flaggedClusters.push({
          funder: clusterKey,
          label: `auto-${clusterKey.slice(0, 8)}`,
          members: [address, ...[...allSiblings].slice(0, 30)],
          flaggedAt: Date.now(),
          lastSeen: Date.now(),
        });
      }
    }
    _p('before-savegraph');
    saveSybilGraph();
    _p('END');

    return analysis;
  };
}

export { createScanOrchestrator };
