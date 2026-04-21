import crypto from 'node:crypto';
import { Connection, PublicKey } from '@solana/web3.js';

function registerSybilRoute(ctx) {
  const {
    ipRateLimit,
    getClientIp,
    respondJson,
    requireAdminKey,
    getRpcUrl,
    getBatchRpcUrl,
    batchGetParsedTxs,
    resolveAccountKey,
    optionalJwt,
    readBody,
    reputationRateLimit,
    walletDatabase,
    updateWalletEntry,
    triggerCompositeUpdate,
    getPrismEarnRateLimit,
    setPrismEarnRateLimit,
    sybilCache,
    sybilInFlight,
    clusterCache,
    getSybilVerdict,
    getSybilQuickVerdict,
    sybilGraph,
    saveSybilGraph,
    updateSybilGraphNode,
    checkGraphForKnownSybils,
    loadSybilCacheEntry,
    isFreshSybilCacheEntry,
    refreshCachedSybilAnalysis,
    persistSybilAnalysis,
    persistAutoDetectedScanClusters,
    fetchSybilSampleFor,
    findFirstTxTime,
    fetchParsedTransactions,
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
    skrMint,
    programLabels,
    treasuryWallets,
    knownLabels,
    knownScamAddresses,
    achievements,
    quests,
    leaderboardEntries,
    activeChallenges,
    getScanRewardState,
    getUniqueScanTargetCount,
  } = ctx;

  return async function handleSybilRoute(req, res, url, pathname) {
      if (pathname === '/api/sybil/analysis' && req.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address) return respondJson(res, 400, { error: 'address required' });
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    const jwtAuth = optionalJwt(req, res);
    if (!jwtAuth.ok) return respondJson(res, 401, { error: 'Invalid or expired auth token' });
    const isOwnWalletScan = Boolean(jwtAuth.address && jwtAuth.address === address);
    const cachedEntry = loadSybilCacheEntry(address);
    if (isFreshSybilCacheEntry(cachedEntry, isOwnWalletScan)) {
      return respondJson(res, 200, cachedEntry.analysis);
    }
    // In-flight dedup: if the same address is already being analyzed, wait for it
    if (sybilInFlight.has(address)) {
      try {
        const result = await sybilInFlight.get(address);
        return respondJson(res, 200, result);
      } catch {
        return respondJson(res, 500, { error: 'Analysis failed (in-flight)' });
      }
    }
    // Rate limit: 5 new analyses per minute per IP (cache + in-flight dedup handles the rest)
    if (!ipRateLimit('sybil_new', getClientIp(req), 5, 60_000)) {
      return respondJson(res, 429, { error: 'Rate limited. Try again in a minute.' });
    }
    // Wrap in a shared promise for in-flight dedup
    const analysisPromise = (async () => {
    try {
      const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
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

      const sampledHistory = await fetchSybilSampleFor(address, conn, pubkey, normalizedSampleMeta, balance).catch(() => null);
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
      } else {
        const signatures = await conn.getSignaturesForAddress(pubkey, { limit: 1000 });
        allSignatures = [...signatures];
        oldestSig = signatures.length > 0 ? signatures[signatures.length - 1] : null;
        const sybilRpcUrl = getRpcUrl(address) || 'https://api.mainnet-beta.solana.com';
        let earlySignatures = [];
        let paginationReachedEnd = signatures.length < 1000;

        if (signatures.length >= 1000) {
          let cursor = signatures[signatures.length - 1]?.signature;
          for (let page = 1; page < 10 && cursor; page++) {
            try {
              const moreSigs = await conn.getSignaturesForAddress(pubkey, { before: cursor, limit: 1000 });
              if (moreSigs.length === 0) { paginationReachedEnd = true; break; }
              allSignatures.push(...moreSigs);
              cursor = moreSigs[moreSigs.length - 1].signature;
              earlySignatures = moreSigs;
              const lastSig = moreSigs[moreSigs.length - 1];
              if (lastSig?.blockTime && (!oldestSig?.blockTime || lastSig.blockTime < oldestSig.blockTime)) {
                oldestSig = lastSig;
              }
              if (moreSigs.length < 1000) { paginationReachedEnd = true; break; }
            } catch { break; }
          }
        }
        totalSigCount = allSignatures.length;

        const SOLANA_GENESIS = 1584000000;
        if (paginationReachedEnd && allSignatures.length > 0) {
          for (let i = allSignatures.length - 1; i >= 0; i--) {
            if (allSignatures[i].blockTime > SOLANA_GENESIS) {
              firstTxBlockTime = allSignatures[i].blockTime;
              break;
            }
          }
        } else if (oldestSig?.blockTime > SOLANA_GENESIS) {
          firstTxBlockTime = oldestSig.blockTime;
        }
        if (firstTxBlockTime && (!oldestSig?.blockTime || firstTxBlockTime < oldestSig.blockTime)) {
          oldestSig = { ...(oldestSig || {}), blockTime: firstTxBlockTime };
        }

        const recentSigBatch = allSignatures.slice(0, 200).map(s => s.signature);
        const earlySigs = earlySignatures.length > 0
          ? earlySignatures.slice(-100)
          : (allSignatures.length > 300 ? allSignatures.slice(-100) : []);
        const earlySigBatch = earlySigs.map(s => s.signature);
        const recentSet = new Set(recentSigBatch);
        const dedupedEarlySigBatch = earlySigBatch.filter(s => !recentSet.has(s));

        const needsBinarySearch = !paginationReachedEnd;
        const firstTxPromise = needsBinarySearch
          ? findFirstTxTime(conn, pubkey, allSignatures.slice(-1000), cachedFirstTx, sybilRpcUrl)
          : Promise.resolve({ firstTxTime: firstTxBlockTime, totalSigs: totalSigCount });
        const firstTxResult = await Promise.allSettled([firstTxPromise]).then(r => r[0]);
        await new Promise(r => setTimeout(r, 300));

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
        timestamps = allSignatures.filter(s => s.blockTime).map(s => s.blockTime * 1000);
        failedTxCount = allSignatures.filter(s => s.err !== null).length;
      }

      const nowMs = Date.now();

      // 1. Wallet Age (uses paginated oldest tx)
      const walletAgeDays = oldestSig?.blockTime ? Math.round((nowMs / 1000 - oldestSig.blockTime) / 86400) : 0;

      // 2. Transaction Timing Variance (Coefficient of Variation)
      let timingVariance = 1;
      let timingCV = 999;
      let isRobotic = false;
      if (timestamps.length >= 10) {
        const sorted = [...timestamps].sort((a, b) => a - b);
        const intervals = [];
        for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1]);
        const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
        if (mean > 0) {
          const stdDev = Math.sqrt(intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length);
          timingCV = stdDev / mean;
          timingVariance = Math.min(1, timingCV / 1.5);
          isRobotic = timingCV < 0.25 && intervals.length >= 30;
        }
      }

      // 3. Active Days Ratio
      const uniqueDays = new Set(timestamps.map(t => new Date(t).toISOString().slice(0, 10)));
      const activeDaysCount = uniqueDays.size;
      const totalLifespanDays = Math.max(walletAgeDays, 1);
      const activeDaysRatio = activeDaysCount / totalLifespanDays;

      // 4. Token Diversity (from token accounts)
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
          // NFTs typically have decimals=0 and amount=1
          if (decimals === 0 && amount === 1) nftCount++;
        }
      }
      const tokenDiversityCount = uniqueTokenMints.size;

      // 5. Incoming vs Outgoing flow analysis + dust transactions + program diversity
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
          for (let i = 0; i < accounts.length; i++) {
            const acc = resolveAccountKey(accounts[i]);
            if (acc === address) { targetIdx = i; break; }
          }
          if (targetIdx >= 0) {
            const diffLamports = (post[targetIdx] || 0) - (pre[targetIdx] || 0);
            const diffSol = diffLamports / 1e9;
            if (Math.abs(diffSol) >= 0.0001) {
              totalSolTxCount++;
              if (diffSol > 0) { incomingVolume += diffSol; incomingCount++; }
              else { outgoingVolume += Math.abs(diffSol); outgoingCount++; }
              if (Math.abs(diffSol) < 0.001) dustTxCount++;
            }
            const preBal = (pre[targetIdx] || 0) / 1e9;
            if (preBal > historicalMaxBalance) historicalMaxBalance = preBal;
            for (let i = 0; i < accounts.length; i++) {
              if (i === targetIdx) continue;
              const acc = resolveAccountKey(accounts[i]);
              if (!acc || acc === '11111111111111111111111111111111') continue;
              const otherDiff = ((post[i] || 0) - (pre[i] || 0)) / 1e9;
              if (treasuryWallets.has(acc)) continue;
              if (diffSol > 0.001 && otherDiff < -0.001) incomingSenders.add(acc);
              if (diffSol < -0.001 && otherDiff > 0.001) outgoingRecipients.add(acc);
            }
          }
        }
      }

      // 6. Multi-hop funding graph + .sol domain check — run in parallel
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
      let topFunderPctExport = 0; // share of top funder in total received SOL
      let topFunderTxCount = 0; // how many times top funder sent to target
      let cexTrustBonus = 0; // CEX funding trust bonus — applied later to trustBonus

      let resolvedTopFunder = null; // shared: used for cluster key later
      let resolvedIncoming = null; // shared: expose for funding-sources cache
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
          resolvedTopFunder = topFunder; // expose for cluster key
          topFunderPctExport = topFunderPct;
          if (incoming.size === 0 && allTxsForFunding.length > 0) {
            console.warn(`[sybil-funding] ${address.slice(0,8)}: 0 funding sources from ${allTxsForFunding.length} parsed txs`);
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
            const tokenOnlyLabel = knownLabels[dominantTrackedTokenFunder.address];
            resolvedPrimaryFundingSource = {
              address: dominantTrackedTokenFunder.address,
              label: tokenOnlyLabel?.label || null,
              type: tokenOnlyLabel?.type || 'wallet',
              tokenMint: dominantTrackedTokenFunder.mints[0] || skrMint,
              transactionCount: dominantTrackedTokenFunder.count,
              percentage: Math.round(dominantTrackedTokenFunder.share * 100),
              totalAmount: Math.round(dominantTrackedTokenFunder.amount * 10000) / 10000,
            };
          }

          const hasMeaningfulFunding = topFundingMint === solMint ? topAmount >= 0.01 : topAmount >= 1;
          if (topFunder && hasMeaningfulFunding) {
            if (topFunderPct > 0.3) {
              fundingChainDepth = 1;
              if (topFunderLabel && (topFunderLabel.type === 'cex' || topFunderLabel.type === 'bridge')) {
                cexTrustBonus = 3;
              } else if (topFundingMint === solMint) try {
                const topFunderHistoryPromise = fetchEnhancedTxHistory(topFunder, { limit: 100 })
                  .then(data => data?.txs?.length ? summarizeEnhancedTxHistory(data.txs, topFunder, 0) : null)
                  .catch(() => null);
                const grandFunderSeedPromise = topFunderHistoryPromise.then(summary => summary ? { incoming: summary.incoming } : null);
                const [level1Summary, level2Seed] = await Promise.all([topFunderHistoryPromise, grandFunderSeedPromise]);
                let usedLegacyFunderFallback = false;
                let grandFunder = null;
                let grandShare = 0;

                if (level1Summary) {
                  for (const sibling of level1Summary.outgoing.keys()) {
                    if (sibling !== topFunder && sibling !== address && sibling !== '11111111111111111111111111111111' && !isProgramAddress(sibling, new Set())) {
                      allSiblings.add(sibling);
                      sameDepthSiblings.add(sibling);
                    }
                  }
                  hubSpokeScore = Math.min(1, allSiblings.size / 20);
                }

                if (!level1Summary || allSiblings.size > 5) {
                  usedLegacyFunderFallback = true;
                  allSiblings.clear();
                  hubSpokeScore = 0;
                  try {
                    const funderSigs = await conn.getSignaturesForAddress(new PublicKey(topFunder), { limit: 100 });
                    const funderBatch = funderSigs.map(s => s.signature);
                    const funderParsed = (await batchGetParsedTxs(getBatchRpcUrl(topFunder), funderBatch, { batchSize: 100, delayMs: 300 })).filter(Boolean);
                    for (const tx of funderParsed) {
                      if (!tx?.meta || !tx?.transaction) continue;
                      const accounts = tx.transaction.message?.accountKeys || [];
                      const pre = tx.meta.preBalances || [];
                      const post = tx.meta.postBalances || [];
                      const txProgs = new Set();
                      for (const ix of (tx.transaction.message?.instructions || [])) {
                        const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
                        if (pid) txProgs.add(pid);
                      }
                      for (let i = 0; i < accounts.length; i++) {
                        const acc = resolveAccountKey(accounts[i]);
                        const diff = ((post[i] || 0) - (pre[i] || 0)) / 1e9;
                        if (diff > 0.01 && acc !== topFunder && acc !== address && acc !== '11111111111111111111111111111111'
                            && !isProgramAddress(acc, txProgs)) {
                          allSiblings.add(acc);
                          sameDepthSiblings.add(acc);
                        }
                      }
                    }
                    hubSpokeScore = Math.min(1, allSiblings.size / 20);
                    if (topFunderPct > 0.5 && funderParsed.length > 0) {
                      try {
                        const { incoming: level2In } = extractSolTransfers(funderParsed, topFunder);
                        const dominantLevel2 = getDominantFundingSource(level2In, 'totalSol');
                        grandFunder = dominantLevel2.address;
                        grandShare = dominantLevel2.share;
                        if (grandFunder && dominantLevel2.amount > 0.01 && grandShare > 0.7) {
                          fundingChainDepth = 2;
                          persistFundingEdge(grandFunder, topFunder, solMint, level2In.get(grandFunder), 2);
                        }
                      } catch {}
                    }
                  } catch {}
                }

                if (!usedLegacyFunderFallback && topFunderPct > 0.5 && level2Seed?.incoming?.size) {
                  const dominantLevel2 = getDominantFundingSource(level2Seed.incoming, 'totalSol');
                  grandFunder = dominantLevel2.address;
                  grandShare = dominantLevel2.share;
                  if (grandFunder && dominantLevel2.amount > 0.01 && grandShare > 0.7) {
                    fundingChainDepth = 2;
                    persistFundingEdge(grandFunder, topFunder, solMint, level2Seed.incoming.get(grandFunder), 2);
                    try {
                      const grandFunderHistory = await fetchEnhancedTxHistory(grandFunder, { limit: 100 });
                      const grandFunderSummary = grandFunderHistory?.txs?.length ? summarizeEnhancedTxHistory(grandFunderHistory.txs, grandFunder, 0) : null;
                      if (grandFunderSummary?.outgoing) {
                        for (const sibling of grandFunderSummary.outgoing.keys()) {
                          if (sibling !== grandFunder && sibling !== topFunder && sibling !== address
                              && sibling !== '11111111111111111111111111111111' && !isProgramAddress(sibling, new Set())) {
                            allSiblings.add(sibling);
                          }
                        }
                      }
                    } catch {}
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
                clusterSimilarity = Math.min(1, allSiblings.size / 12);
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

      // 7. Time-of-day and day-of-week fingerprinting
      const hourBuckets = new Array(24).fill(0);
      const dayBuckets = new Array(7).fill(0);
      for (const ts of timestamps) {
        const d = new Date(ts);
        hourBuckets[d.getUTCHours()]++;
        dayBuckets[d.getUTCDay()]++;
      }
      // Shannon entropy for hour distribution (max = log2(24) ≈ 4.58 for uniform)
      let hourEntropy = 0;
      const totalTs = timestamps.length || 1;
      for (const count of hourBuckets) {
        if (count > 0) {
          const p = count / totalTs;
          hourEntropy -= p * Math.log2(p);
        }
      }
      // Entropy for timing intervals (replaces simple CV)
      let intervalEntropy = 0;
      if (timestamps.length >= 10) {
        const sorted = [...timestamps].sort((a, b) => a - b);
        const intervals = [];
        for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1]);
        // Bin intervals into 10 buckets by percentile for entropy calc
        const sortedIntervals = [...intervals].sort((a, b) => a - b);
        const binSize = Math.max(1, Math.floor(sortedIntervals.length / 10));
        const bins = new Array(10).fill(0);
        for (let i = 0; i < intervals.length; i++) {
          const bin = Math.min(9, Math.floor(i / binSize));
          bins[bin]++;
        }
        for (const count of bins) {
          if (count > 0) {
            const p = count / intervals.length;
            intervalEntropy -= p * Math.log2(p);
          }
        }
      }
      // Weekend ratio (sybil bots don't rest on weekends)
      const weekendTxs = dayBuckets[0] + dayBuckets[6]; // Sun + Sat
      const weekdayTxs = totalTs - weekendTxs;
      const weekendRatio = totalTs > 20 ? weekendTxs / totalTs : 0.28; // default neutral

      // 8. Airdrop farming pattern detection
      // Count programs with very few interactions (1-2 txs) — farmers touch many protocols minimally
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
          if (count <= 2) shallowProtocols++;
          if (count >= 5) deepProtocols++;
        }
      }
      const farmingRatio = enhancedSampleSummary?.farmingRatio
        ?? (programInteractionCounts.size > 3 ? shallowProtocols / programInteractionCounts.size : 0);

      // 9. DeFi depth scoring — check for known DeFi program interactions
      const DEFI_PROGRAMS = {
        // DEXes
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'jupiter',
        'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'orca',
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'raydium',
        'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'raydium_clmm',
        'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'meteora',
        // Lending
        'So1endDq2YkqhipRh3WViPa8hFb7GVEtcEMF3CBAK8h': 'solend',
        'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': 'marginfi',
        'KLend2g3cP87ber41GXWsSZQz9R1hGT2bVBaeEdnKHR': 'kamino',
        // Staking
        'CgDG2CLNqR2ypE3CXTMEq5R6J8FaqVjChn9Tfmwocs4Y': 'marinade',
        'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy': 'spl_stake_pool',
        'JitoSOL': 'jito',
        // Governance
        'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw': 'spl_governance',
        'GovHgfDPyQ1GwjFhNkMqZVs9EVecaH3MQ1Lmob5NLz2v': 'realms',
      };
      let defiCategories = new Set(); // 'dex', 'lending', 'staking', 'governance'
      for (const pid of allProgramIds) {
        const sourceName = pid.startsWith('source:') ? pid.slice(7).toLowerCase() : null;
        const name = DEFI_PROGRAMS[pid] || sourceName;
        if (!name) continue;
        if (['jupiter', 'orca', 'raydium', 'raydium_clmm', 'meteora'].includes(name)) defiCategories.add('dex');
        if (['solend', 'marginfi', 'kamino'].includes(name)) defiCategories.add('lending');
        if (['marinade', 'spl_stake_pool', 'jito'].includes(name)) defiCategories.add('staking');
        if (['spl_governance', 'realms'].includes(name)) defiCategories.add('governance');
      }
      const defiDepth = defiCategories.size; // 0-4

      // ── Build Signals ──
      const signals = [];

      // --- Derived metrics for new signals ---
      // Self-transfers: target appears on both sending and receiving side
      let selfTransferCount = enhancedSampleSummary?.selfTransferCount || 0;
      if (!enhancedSampleSummary) {
        for (const tx of parsedTxs) {
          if (!tx?.meta || !tx?.transaction || tx.meta.err) continue;
          const accounts = tx.transaction.message?.accountKeys || [];
          let targetIdx = -1;
          for (let i = 0; i < accounts.length; i++) {
            const acc = resolveAccountKey(accounts[i]);
            if (acc === address) { targetIdx = i; break; }
          }
          if (targetIdx >= 0) {
            const ixs = tx.transaction.message?.instructions || [];
            for (const ix of ixs) {
              const parsed = ix.parsed;
              if (parsed?.type === 'transfer' && parsed?.info) {
                if (parsed.info.source === address && parsed.info.destination === address) selfTransferCount++;
              }
            }
          }
        }
      }

      // Counterparty concentration: ratio of unique counterparties to total txs
      const totalCounterparties = incomingSenders.size + outgoingRecipients.size;
      const counterpartyRatio = totalSolTxCount > 5 ? totalCounterparties / totalSolTxCount : 1;

      // Activity burst detection: what % of active days are in the most active week
      let burstRatio = 0;
      if (timestamps.length >= 20 && walletAgeDays > 14) {
        const daySet = [...uniqueDays].sort();
        if (daySet.length >= 3) {
          let maxInWindow = 0;
          for (let i = 0; i < daySet.length; i++) {
            const windowStart = new Date(daySet[i]).getTime();
            const windowEnd = windowStart + 7 * 86400_000;
            let count = 0;
            for (let j = i; j < daySet.length; j++) {
              if (new Date(daySet[j]).getTime() <= windowEnd) count++;
              else break;
            }
            if (count > maxInWindow) maxInWindow = count;
          }
          burstRatio = maxInWindow / daySet.length;
        }
      }

      const uniquePrograms = allProgramIds.size;

      // Signal 0: No Transaction History — penalise wallets with zero or near-zero data
      // Without any activity there's no evidence of human behaviour; don't grant high trust
      const noHistory = totalSigCount < 3;
      const thinHistory = !noHistory && totalSigCount < 10 && walletAgeDays < 14;
      signals.push({
        id: 'no_history', name: noHistory ? 'No Transaction History' : 'Thin History', category: 'behavioral',
        detected: noHistory || thinHistory, weight: noHistory ? 30 : 15,
        severity: noHistory ? 'danger' : 'warning',
        value: `${totalSigCount} txs`,
        description: noHistory
          ? 'Wallet has virtually no transaction history — trust cannot be assessed'
          : `Only ${totalSigCount} transactions in ${walletAgeDays} days — insufficient data`,
      });

      // Signal 1: Wallet Age + Fresh Burst (MERGED — no double-counting)
      // Graduated: new wallet alone = moderate, new wallet + burst = high
      const isNewWallet = walletAgeDays < 30;
      const freshBurst = isNewWallet && totalSigCount > 50;
      signals.push({
        id: 'wallet_age', name: freshBurst ? 'Fresh Wallet Burst' : 'New Wallet', category: 'behavioral',
        detected: isNewWallet, weight: freshBurst ? 20 : 12,
        severity: freshBurst ? 'danger' : (isNewWallet ? 'warning' : 'info'),
        value: isNewWallet ? `${walletAgeDays}d / ${totalSigCount} txs` : `${walletAgeDays}d`,
        description: freshBurst
          ? `${totalSigCount} transactions in only ${walletAgeDays} days — suspicious burst`
          : (isNewWallet ? `Wallet is only ${walletAgeDays} days old` : `Wallet is ${walletAgeDays} days old`),
      });

      // Signal 2: Timing Pattern (MERGED — graduated single signal)
      // Robotic (CV < 0.25 + 20 txs) = full weight, Uniform (CV < 0.3) = lower weight
      const timingDetected = (isRobotic || (timingCV < 0.3 && timestamps.length >= 10));
      signals.push({
        id: 'timing_pattern', name: isRobotic ? 'Robotic Timing' : 'Uniform Timing', category: 'behavioral',
        detected: timingDetected, weight: isRobotic ? 18 : 10,
        severity: isRobotic ? 'danger' : (timingDetected ? 'warning' : 'info'),
        value: timingCV < 999 ? `CV ${timingCV.toFixed(2)}` : 'N/A',
        description: isRobotic
          ? 'Extreme timing uniformity — automated script detected'
          : (timingDetected ? 'Transactions are suspiciously evenly spaced' : 'Transaction timing appears natural'),
      });

      // Signal 3: Low Activity Ratio — dormant wallet suddenly active
      const lowActivityRatio = walletAgeDays > 60 && activeDaysRatio < 0.05;
      signals.push({
        id: 'low_activity_ratio', name: 'Low Activity Ratio', category: 'behavioral',
        detected: lowActivityRatio, weight: 8,
        severity: lowActivityRatio ? 'warning' : 'info',
        value: `${(activeDaysRatio * 100).toFixed(1)}%`,
        description: lowActivityRatio ? `Only active ${activeDaysCount} of ${totalLifespanDays} days (${(activeDaysRatio * 100).toFixed(1)}%)` : `Active ${activeDaysCount} of ${totalLifespanDays} days`,
      });

      // Signal 4: Activity Burst — most activity crammed into one week (NEW)
      const isBurst = burstRatio > 0.8 && activeDaysCount >= 3 && walletAgeDays > 30;
      signals.push({
        id: 'activity_burst', name: 'Activity Burst', category: 'behavioral',
        detected: isBurst, weight: 10,
        severity: isBurst ? 'warning' : 'info',
        value: `${(burstRatio * 100).toFixed(0)}% in 7d`,
        description: isBurst
          ? `${(burstRatio * 100).toFixed(0)}% of all active days fall within a single week — farming burst`
          : 'Activity is spread across wallet lifetime',
      });

      // Signal 5: Low Token Diversity
      const lowTokenDiv = tokenDiversityCount < 3;
      signals.push({
        id: 'low_token_diversity', name: 'Low Token Diversity', category: 'financial',
        detected: lowTokenDiv, weight: 5,
        severity: lowTokenDiv ? 'warning' : 'info',
        value: `${tokenDiversityCount} tokens`,
        description: lowTokenDiv ? `Only ${tokenDiversityCount} unique tokens held` : `Holds ${tokenDiversityCount} unique tokens`,
      });

      // Signal 6: No NFT Holdings
      const noNfts = nftCount === 0;
      signals.push({
        id: 'no_nft_holdings', name: 'No NFT Holdings', category: 'financial',
        detected: noNfts, weight: 4,
        severity: 'info',
        value: `${nftCount} NFTs`,
        description: noNfts ? 'Wallet holds no NFTs' : `Holds ${nftCount} NFTs`,
      });

      // Signal 7: One-Directional Flow
      const totalVolume = incomingVolume + outgoingVolume;
      const flowRatio = totalVolume > 0 ? Math.max(incomingVolume, outgoingVolume) / totalVolume : 0.5;
      const oneDirectional = totalVolume > 1.0 && flowRatio > 0.9 && totalSolTxCount >= 5;
      signals.push({
        id: 'one_directional_flow', name: 'One-Directional Flow', category: 'financial',
        detected: oneDirectional, weight: 10,
        severity: oneDirectional ? 'warning' : 'info',
        value: oneDirectional
          ? (incomingVolume > outgoingVolume ? `${(flowRatio * 100).toFixed(0)}% inbound` : `${(flowRatio * 100).toFixed(0)}% outbound`)
          : `${(flowRatio * 100).toFixed(0)}% / ${(100 - flowRatio * 100).toFixed(0)}%`,
        description: oneDirectional ? 'Heavily one-directional SOL flow (suspicious)' : 'Balanced SOL flow',
      });

      // Signal 8: Cluster Similarity — connected wallets from same funder
      const highClusterSim = clusterSimilarity > 0.3;
      signals.push({
        id: 'cluster_similarity', name: 'Cluster Similarity', category: 'network',
        detected: highClusterSim, weight: 15,
        severity: highClusterSim ? 'danger' : 'info',
        value: highClusterSim ? `${(clusterSimilarity * 100).toFixed(0)}% similar` : 'No cluster',
        description: highClusterSim ? 'Wallet shares funding source with multiple similar wallets' : 'No suspicious wallet clusters detected',
      });

      const temporalCohortDetected = temporalCohortScore >= 0.45;
      signals.push({
        id: 'temporal_cohort', name: 'Temporal Cohort', category: 'network',
        detected: temporalCohortDetected, weight: temporalCohortDetected ? Math.round(8 + temporalCohortScore * 6) : 0,
        severity: temporalCohortScore >= 0.7 ? 'danger' : (temporalCohortDetected ? 'warning' : 'info'),
        value: `${Math.round(temporalCohortScore * 100)}%`,
        description: temporalCohortDetected
          ? 'Wallet was created alongside multiple same-funder wallets in a narrow time window'
          : 'No suspicious wallet birth cohort detected',
      });

      // Signal 9: Dust Transactions — many tiny transactions indicate farming
      const dustRatio = totalSolTxCount > 0 ? dustTxCount / totalSolTxCount : 0;
      const highDust = totalSolTxCount >= 5 && dustRatio > 0.5;
      signals.push({
        id: 'dust_transactions', name: 'Dust Transactions', category: 'financial',
        detected: highDust, weight: 8,
        severity: highDust ? 'warning' : 'info',
        value: `${(dustRatio * 100).toFixed(0)}% dust`,
        description: highDust ? `${dustTxCount}/${totalSolTxCount} transactions are dust (<0.001 SOL)` : 'Normal transaction sizes',
      });

      // Signal 10: Low dApp Interaction Breadth
      const lowDappInteraction = uniquePrograms < 5 && totalSigCount > 20;
      signals.push({
        id: 'low_dapp_interaction', name: 'Low dApp Interaction', category: 'behavioral',
        detected: lowDappInteraction, weight: 7,
        severity: lowDappInteraction ? 'warning' : 'info',
        value: `${uniquePrograms} programs`,
        description: lowDappInteraction
          ? (uniquePrograms === 0
            ? `No dApp interactions detected among ${totalSigCount} transactions — SOL transfers only`
            : `Only ${uniquePrograms} dApps used across ${totalSigCount} transactions`)
          : `Interacted with ${uniquePrograms} different programs`,
      });

      // Signal 11: Drained Balance — current balance is tiny vs historical max
      const drainedBalance = historicalMaxBalance > 1 && balance < historicalMaxBalance * 0.01;
      signals.push({
        id: 'drained_balance', name: 'Drained Balance', category: 'financial',
        detected: drainedBalance, weight: 7,
        severity: drainedBalance ? 'warning' : 'info',
        value: drainedBalance ? `${balance.toFixed(3)} / ${historicalMaxBalance.toFixed(1)} SOL` : `${balance.toFixed(2)} SOL`,
        description: drainedBalance ? `Current balance (${balance.toFixed(3)}) is <1% of historical max (${historicalMaxBalance.toFixed(1)} SOL)` : 'Balance appears normal',
      });

      // Signal 12: Self-Transfers — sending SOL to yourself to inflate tx count (NEW)
      const hasSelfTransfers = selfTransferCount >= 3;
      signals.push({
        id: 'self_transfers', name: 'Self-Transfers', category: 'behavioral',
        detected: hasSelfTransfers, weight: 12,
        severity: hasSelfTransfers ? 'danger' : 'info',
        value: `${selfTransferCount} self-txs`,
        description: hasSelfTransfers
          ? `${selfTransferCount} transfers to self detected — tx count inflation`
          : 'No self-transfer patterns',
      });

      // Signal 13: Low Counterparty Diversity — few unique addresses despite many txs (NEW)
      const lowCounterparty = totalSolTxCount >= 10 && counterpartyRatio < 0.2;
      signals.push({
        id: 'low_counterparty', name: 'Low Counterparty Diversity', category: 'network',
        detected: lowCounterparty, weight: 10,
        severity: lowCounterparty ? 'warning' : 'info',
        value: `${totalCounterparties} counterparties / ${totalSolTxCount} txs`,
        description: lowCounterparty
          ? `Only ${totalCounterparties} unique counterparties across ${totalSolTxCount} SOL transactions`
          : `${totalCounterparties} unique counterparties`,
      });

      // Signal 14: Funding Chain Depth — multi-hop single-source funding
      // depth 1 + non-CEX = wallet-to-wallet funding (mild risk), depth 2+ = layered chain (high risk)
      const deepChain = fundingChainDepth >= 2;
      const walletToWallet = fundingChainDepth === 1 && cexTrustBonus === 0; // funded by a random wallet, not CEX
      const fundingChainWeight = deepChain
        ? Math.min(19, 15 + Math.max(0, fundingChainDepth - 2) * 2)
        : (walletToWallet ? 10 : 0);
      signals.push({
        id: 'funding_chain', name: deepChain ? 'Funding Chain' : (walletToWallet ? 'Wallet-to-Wallet Funding' : 'Funding Chain'), category: 'network',
        detected: deepChain || walletToWallet, weight: fundingChainWeight,
        severity: deepChain ? 'danger' : (walletToWallet ? 'warning' : 'info'),
        value: `${fundingChainDepth} hops`,
        description: deepChain
          ? `Funding traced through ${fundingChainDepth} intermediary wallets — layered sybil relay`
          : walletToWallet
            ? 'Primary funding from another wallet (not exchange) — common sybil pattern'
            : cexTrustBonus > 0 ? 'Funded from known exchange (KYC origin)' : 'No suspicious funding chains',
      });

      // Signal 15: Hub-and-Spoke — mass distribution from single funder
      const isHubSpokeMass = allSiblings.size >= 15;
      const isHubSpokeSmall = !isHubSpokeMass && allSiblings.size >= 5;
      signals.push({
        id: 'hub_spoke', name: 'Hub-and-Spoke Funding', category: 'network',
        detected: isHubSpokeMass || isHubSpokeSmall, weight: isHubSpokeMass ? 15 : (isHubSpokeSmall ? 8 : 0),
        severity: isHubSpokeMass ? 'danger' : (isHubSpokeSmall ? 'warning' : 'info'),
        value: `${allSiblings.size} siblings`,
        description: isHubSpokeMass
          ? `Funding source distributed to ${allSiblings.size}+ wallets — industrial sybil farm`
          : isHubSpokeSmall
            ? `Funding source also sent to ${allSiblings.size} other wallets — small cluster`
            : 'No hub-and-spoke pattern detected',
      });

      // Signal 15b: Concentrated single-source funding (>90% from one non-CEX wallet)
      const concentratedFunding = topFunderPctExport > 0.4 && cexTrustBonus === 0 && (topFunderTxCount >= 3 || totalSolTxCount >= 3);
      signals.push({
        id: 'concentrated_funding', name: 'Single-Source Concentration', category: 'network',
        detected: concentratedFunding, weight: 10,
        severity: concentratedFunding ? 'warning' : 'info',
        value: concentratedFunding ? `${(topFunderPctExport * 100).toFixed(0)}% from one wallet` : 'Diversified',
        description: concentratedFunding
          ? `${(topFunderPctExport * 100).toFixed(0)}% of funding from a single non-exchange wallet`
          : 'Funding sources are diversified or from known exchanges',
      });

      // Signal 16: Repeated Funder — same wallet funds target multiple times (sybil relay pattern)
      const repeatedFunder = topFunderTxCount >= 3 && cexTrustBonus === 0;
      // Weight scales: 3 txs = 8, 5 txs = 12, 7+ txs = 18 (capped)
      const repeatedFunderWeight = repeatedFunder ? Math.min(18, 4 + topFunderTxCount * 2) : 0;
      signals.push({
        id: 'repeated_funder', name: 'Repeated Funder', category: 'network',
        detected: repeatedFunder, weight: repeatedFunderWeight,
        severity: repeatedFunder ? (topFunderTxCount >= 5 ? 'danger' : 'warning') : 'info',
        value: `${topFunderTxCount} deposits from same wallet`,
        description: repeatedFunder
          ? `Same non-exchange wallet funded this address ${topFunderTxCount} times — typical sybil relay pattern`
          : topFunderTxCount <= 1 ? 'No repeated funding from same wallet' : `Top funder sent ${topFunderTxCount} txs (within normal range)`,
      });

      // Signal 17: Bot-like Hour Distribution — flat or extremely narrow time windows
      // Max entropy for 24 bins = log2(24) ≈ 4.58 — bots are near-max (all hours equal)
      // Humans typically use 3-4.0 range (concentrated in waking hours)
      const botlikeHours = timestamps.length >= 20 && hourEntropy > 4.2;
      const nightOwlHours = timestamps.length >= 20 && hourEntropy < 1.5; // extremely concentrated
      signals.push({
        id: 'hour_distribution', name: botlikeHours ? '24/7 Bot Activity' : (nightOwlHours ? 'Narrow Time Window' : 'Normal Hours'), category: 'behavioral',
        detected: botlikeHours || nightOwlHours, weight: botlikeHours ? 10 : (nightOwlHours ? 6 : 0),
        severity: botlikeHours ? 'warning' : (nightOwlHours ? 'info' : 'info'),
        value: `entropy ${hourEntropy.toFixed(2)}`,
        description: botlikeHours
          ? 'Activity spread evenly across all 24 hours — bot-like pattern'
          : (nightOwlHours ? 'All activity concentrated in a very narrow time window' : 'Normal day/night activity pattern'),
      });

      // Signal 17: Airdrop Farming — many protocols touched minimally
      const isFarming = farmingRatio > 0.7 && shallowProtocols >= 5;
      signals.push({
        id: 'airdrop_farming', name: 'Airdrop Farming Pattern', category: 'behavioral',
        detected: isFarming, weight: 18,
        severity: isFarming ? 'danger' : 'info',
        value: `${shallowProtocols}/${programInteractionCounts.size} shallow`,
        description: isFarming
          ? `${shallowProtocols} protocols with only 1-2 interactions each — airdrop farming pattern`
          : `${deepProtocols} deeply-used protocols`,
      });

      // Signal 18: No Weekend Activity — bots often run only on weekdays
      const noWeekends = timestamps.length >= 30 && weekendRatio < 0.05;
      signals.push({
        id: 'no_weekends', name: 'No Weekend Activity', category: 'behavioral',
        detected: noWeekends, weight: 6,
        severity: noWeekends ? 'warning' : 'info',
        value: `${(weekendRatio * 100).toFixed(0)}% weekend`,
        description: noWeekends
          ? 'Nearly zero weekend activity — scheduled bot pattern'
          : `${(weekendRatio * 100).toFixed(0)}% of transactions on weekends`,
      });

      // Signal 19: Failed Transaction Ratio — bots/MEV have high fail rates
      const failedRatio = totalSigCount >= 30 ? failedTxCount / totalSigCount : 0;
      const highFailRate = failedRatio > 0.5 && failedTxCount >= 15;
      signals.push({
        id: 'failed_tx_ratio', name: 'High Failed TX Rate', category: 'behavioral',
        detected: highFailRate, weight: 8,
        severity: highFailRate ? 'warning' : 'info',
        value: `${(failedRatio * 100).toFixed(0)}% failed`,
        description: highFailRate
          ? `${failedTxCount}/${totalSigCount} transactions failed — MEV/bot pattern`
          : `${(failedRatio * 100).toFixed(0)}% failure rate`,
      });

      // Signal 20: Behavior Drift — early txs vs recent txs show different patterns (account sold/repurposed)
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
        const intersection = [...earlyPrograms].filter(p => recentPrograms.has(p)).length;
        const union = new Set([...earlyPrograms, ...recentPrograms]).size;
        const jaccard = union > 0 ? intersection / union : 1;
        if (jaccard < 0.1 && earlyPrograms.size >= 3 && recentPrograms.size >= 3) {
          behaviorDriftDetected = true;
          behaviorDriftValue = `${(jaccard * 100).toFixed(0)}% overlap (${earlyPrograms.size} early → ${recentPrograms.size} recent programs)`;
        }
      }
      signals.push({
        id: 'behavior_drift', name: 'Behavior Drift', category: 'behavioral',
        detected: behaviorDriftDetected, weight: 10,
        severity: behaviorDriftDetected ? 'warning' : 'info',
        value: behaviorDriftValue || 'N/A',
        description: behaviorDriftDetected
          ? 'Early wallet activity completely differs from recent — possible account sale/repurpose for farming'
          : 'Consistent behavior across wallet lifetime',
      });

      // Signal 21: Rapid Token Cycling — receives tokens and immediately transfers out (wash trading)
      let rapidCycleCount = enhancedSampleSummary?.rapidCycleCount || 0;
      if (!enhancedSampleSummary && parsedTxs.length >= 10) {
        const txByTime = parsedTxs.filter(t => t?.blockTime).sort((a, b) => a.blockTime - b.blockTime);
        for (let i = 0; i < txByTime.length - 1; i++) {
          const tx1 = txByTime[i], tx2 = txByTime[i + 1];
          if (!tx1?.meta || !tx2?.meta) continue;
          const accs1 = tx1.transaction?.message?.accountKeys || [];
          const accs2 = tx2.transaction?.message?.accountKeys || [];
          let idx1 = -1, idx2 = -1;
          for (let j = 0; j < accs1.length; j++) {
            const a = typeof accs1[j] === 'string' ? accs1[j] : accs1[j]?.pubkey?.toBase58?.() || '';
            if (a === address) { idx1 = j; break; }
          }
          for (let j = 0; j < accs2.length; j++) {
            const a = typeof accs2[j] === 'string' ? accs2[j] : accs2[j]?.pubkey?.toBase58?.() || '';
            if (a === address) { idx2 = j; break; }
          }
          if (idx1 >= 0 && idx2 >= 0) {
            const diff1 = ((tx1.meta.postBalances?.[idx1] || 0) - (tx1.meta.preBalances?.[idx1] || 0)) / 1e9;
            const diff2 = ((tx2.meta.postBalances?.[idx2] || 0) - (tx2.meta.preBalances?.[idx2] || 0)) / 1e9;
            if (diff1 > 0.01 && diff2 < -0.01 && (tx2.blockTime - tx1.blockTime) < 60) {
              const ratio = Math.abs(diff2) / diff1;
              if (ratio > 0.8 && ratio < 1.2) rapidCycleCount++;
            }
          }
        }
      }
      const isRapidCycling = rapidCycleCount >= 3;
      signals.push({
        id: 'rapid_cycling', name: 'Rapid SOL Cycling', category: 'financial',
        detected: isRapidCycling, weight: 12,
        severity: isRapidCycling ? 'danger' : 'info',
        value: `${rapidCycleCount} cycles`,
        description: isRapidCycling
          ? `${rapidCycleCount} rapid in→out cycles detected (<60s) — wash trading or fund relay`
          : 'No rapid cycling detected',
      });

      // ── Calculate Risk Score ──
      let riskScore = 0;
      for (const s of signals) {
        if (!s.detected) continue;
        riskScore += s.weight;
      }
      riskScore = Math.min(100, riskScore);

      // ── Cross-session graph intelligence (applied BEFORE trust bonus) ──
      const fundingSources = [...new Set([
        ...incomingSenders,
        ...(resolvedTopFunder ? [resolvedTopFunder] : []),
      ])].filter(a => !treasuryWallets.has(a));
      const { graphRisk, graphDetails } = checkGraphForKnownSybils(address, fundingSources, [...allSiblings]);
      if (graphRisk > 0) {
        riskScore = Math.min(100, riskScore + graphRisk);
      }

      // Trust bonuses — applied AFTER graph risk so they can't fully absorb it (max ~40)
      let trustBonus = cexTrustBonus; // carry over CEX bonus from funding graph analysis
      if (walletAgeDays > 365) trustBonus += 5;          // 1+ year old
      if (walletAgeDays > 730) trustBonus += 3;          // 2+ years old
      if (walletAgeDays > 1460) trustBonus += 2;         // 4+ years old
      if (tokenDiversityCount >= 10) trustBonus += 3;    // diverse portfolio
      if (tokenDiversityCount >= 25) trustBonus += 2;    // very diverse
      if (nftCount >= 3) trustBonus += 2;                // collector
      if (nftCount >= 10) trustBonus += 1;               // active collector
      if (uniquePrograms >= 8) trustBonus += 2;          // uses many dApps
      if (uniquePrograms >= 15) trustBonus += 2;         // DeFi power user
      if (activeDaysRatio > 0.15) trustBonus += 2;       // regularly active
      if (activeDaysRatio > 0.4) trustBonus += 1;        // daily user
      if (incomingSenders.size >= 5) trustBonus += 2;     // receives from many sources
      if (hasSolDomain) trustBonus += 4;                 // owns .sol domain (strong identity signal)
      if (defiDepth >= 2) trustBonus += 2;               // uses DeFi beyond swaps
      if (defiDepth >= 3) trustBonus += 2;               // deep DeFi user (lending+staking+governance)
      // Trust bonus can reduce risk but never below half of graph risk (graph signal always partially persists)
      const graphFloor = Math.max(10, Math.floor(graphRisk * 0.6));
      riskScore = Math.max(graphFloor, riskScore - trustBonus);

      if (graphRisk > 0) {
        signals.push({
          id: 'graph_intelligence', name: 'Known Sybil Network', category: 'network',
          detected: true, weight: graphRisk,
          severity: graphRisk >= 15 ? 'danger' : 'warning',
          value: `+${graphRisk} from graph`,
          description: graphDetails.join('; '),
        });
      }

      const riskLevel = riskScore >= 75 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 30 ? 'medium' : riskScore >= 10 ? 'low' : 'clean';
      // Zero-data wallets get zero trust — can't assess what doesn't exist
      let trustScore;
      if (totalSigCount === 0) {
        trustScore = 0;
      } else if (totalSigCount < 3) {
        trustScore = Math.min(10, Math.max(0, 100 - riskScore));
      } else {
        trustScore = Math.max(0, 100 - riskScore);
      }
      const trustGrade = trustScore >= 90 ? 'A+' : trustScore >= 80 ? 'A' : trustScore >= 70 ? 'B' : trustScore >= 60 ? 'C' : trustScore >= 50 ? 'D' : 'F';

      // ── Top Programs from parsed txs ──
      const topProgramsList = [...programInteractionCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([pid, count]) => {
          const derivedName = pid.startsWith('source:') || pid.startsWith('type:')
            ? pid.split(':')[1]
            : null;
          const n = programLabels[pid];
          return { programId: pid, name: n || derivedName || null, interactions: count };
        });

      const analysis = {
        address, riskScore, riskLevel, trustScore, trustGrade, signals,
        metrics: {
          walletAgeDays,
          activeDaysCount, activeDaysRatio,
          tokenDiversityCount, nftCount,
          incomingVolume: Math.round(incomingVolume * 10000) / 10000,
          outgoingVolume: Math.round(outgoingVolume * 10000) / 10000,
          incomingCount, outgoingCount,
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
      persistAutoDetectedScanClusters({
        address,
        temporalCohort,
        temporalCohortScore,
        fundingChainDepth,
        sameDepthSiblings,
      });
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
      // Build funding sources from the already-computed incoming data
      let cachedFundingSources = [];
      if (resolvedIncoming && resolvedIncoming.size > 0) {
        const totalReceived = [...resolvedIncoming.values()].reduce((s, v) => s + v.totalSol, 0) || 1;
        cachedFundingSources = [...resolvedIncoming.entries()]
          .sort((a, b) => b[1].totalSol - a[1].totalSol)
          .slice(0, 20)
          .map(([addr, info]) => {
            const known = knownLabels[addr];
            return {
              address: addr, label: known?.label || null, type: known?.type || 'wallet',
              totalSolReceived: Math.round(info.totalSol * 10000) / 10000,
              transactionCount: info.count, percentage: Math.round((info.totalSol / totalReceived) * 100),
            };
          });
      }
      // Embed top funding source directly in analysis response so client doesn't need a 2nd rate-limited call
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

      // ── Update wallet database — FULL intelligence profile ──
      const m = analysis.metrics || {};
      const bp = analysis.behaviorProfile || {};
      const detectedSignals = signals.filter(s => s.detected).map(s => s.id);

      const walletProfile = {
        // Core identity
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
        // On-chain stats
        stats: {
          tokens: m.tokenDiversityCount || 0,
          nfts: m.nftCount || 0,
          transactions: m.txCount || 0,
          solBalance: m.balance || 0,
          historicalMaxBalance: m.historicalMaxBalance || 0,
          walletAgeDays: m.walletAgeDays || 0,
          walletAgeYears: Math.floor((m.walletAgeDays || 0) / 365),
          activeDays: m.activeDaysCount || 0,
          activeDaysRatio: m.activeDaysRatio || 0,
        },
        // Financial profile
        financial: {
          incomingVolume: m.incomingVolume || 0,
          outgoingVolume: m.outgoingVolume || 0,
          incomingCount: m.incomingCount || 0,
          outgoingCount: m.outgoingCount || 0,
          uniqueSenders: m.uniqueSenders || 0,
          uniqueRecipients: m.uniqueRecipients || 0,
          flowRatio: m.flowRatio || 0,
          dustRatio: m.dustRatio || 0,
          selfTransferCount: m.selfTransferCount || 0,
          rapidCycleCount: m.rapidCycleCount || 0,
        },
        // Funding intelligence
        funding: {
          chainDepth: m.fundingChainDepth || 0,
          topFunderPct: m.topFunderPct || 0,
          topFunderTxCount: m.topFunderTxCount || 0,
          sources: cachedFundingSources.slice(0, 10),
          primarySource: analysis.primaryFundingSource || null,
          siblingCount: m.siblingCount || 0,
          hubSpokeScore: m.hubSpokeScore || 0,
          clusterSimilarity: m.clusterSimilarity || 0,
          temporalCohortScore: m.temporalCohortScore || 0,
          splFlowDetected: Boolean(m.splFlowDetected),
        },
        // Behavioral fingerprint
        behavior: {
          timingCV: bp.timingCV,
          hourEntropy: bp.hourEntropy || 0,
          intervalEntropy: bp.intervalEntropy || 0,
          weekendRatio: m.weekendRatio || 0,
          hourDistribution: m.hourBuckets || [],
          dayDistribution: m.dayBuckets || [],
          protocolDiversity: bp.protocolDiversity || 0,
        },
        // DeFi / Protocol usage
        protocols: {
          uniquePrograms: m.uniquePrograms || 0,
          defiDepth: m.defiDepth || 0,
          defiCategories: m.defiCategories || [],
          topPrograms: topProgramsList.slice(0, 10),
          shallowProtocols: m.shallowProtocols || 0,
          deepProtocols: m.deepProtocols || 0,
          farmingRatio: m.farmingRatio || 0,
        },
        // Network graph
        network: {
          siblings: [...allSiblings].slice(0, 30),
          hasSolDomain: m.hasSolDomain || false,
        },
        // Metadata
        lastScannedAt: new Date().toISOString(),
        firstSeenAt: walletDatabase.get(address)?.firstSeenAt || new Date().toISOString(),
      };
      updateWalletEntry(address, walletProfile);
      triggerCompositeUpdate(address);

      // ── Persist to sybil graph ──
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
      // Record ALL siblings in graph — both new and existing (update riskScore if higher)
      for (const sib of allSiblings) {
        const existingNode = sybilGraph.nodes[sib];
        const inferredRisk = Math.max(50, Math.floor(riskScore * 0.7)); // siblings inherit 70% of parent risk, min 50
        if (!existingNode || existingNode.riskScore < inferredRisk) {
          updateSybilGraphNode(sib, {
            inferredFromCluster: address,
            riskScore: inferredRisk,
            fundedBy: resolvedTopFunder ? [resolvedTopFunder] : [],
            siblings: [address, ...[...allSiblings].filter(s => s !== sib).slice(0, 10)],
            verdictKey: existingNode?.verdictKey || 'cluster_linked',
            bountyEligible: Boolean(existingNode?.bountyEligible),
            confidence: existingNode?.confidence || 'low',
          });
        }
      }
      // Auto-flag clusters: if hub funded 5+ wallets and target is medium+ risk
      if (allSiblings.size >= 5 && riskScore >= 40) {
        // Use the top funder (by SOL amount) as cluster key, not insertion order
        const clusterKey = resolvedTopFunder || fundingSources[0] || address;
        const existing = sybilGraph.flaggedClusters.find(c => c.funder === clusterKey);
        if (existing) {
          existing.lastSeen = Date.now();
          if (!existing.members.includes(address)) existing.members.push(address);
        } else {
          sybilGraph.flaggedClusters.push({
            funder: clusterKey,
            label: `auto-${clusterKey.slice(0, 8)}`,
            members: [address, ...([...allSiblings].slice(0, 30))],
            flaggedAt: Date.now(),
            lastSeen: Date.now(),
          });
        }
      }
      saveSybilGraph();

      return analysis;
    } catch (e) {
      throw e;
    }
    })();
    sybilInFlight.set(address, analysisPromise);
    try {
      const analysis = await analysisPromise;
      respondJson(res, 200, analysis);
    } catch (e) {
      console.error('[sybil] Analysis failed:', e.message);
      respondJson(res, 500, { error: 'Sybil analysis failed' });
    } finally {
      sybilInFlight.delete(address);
    }
    return true;
  }

  // ═══ Sybil Batch Analysis ═══
  if (pathname === '/api/sybil/batch' && req.method === 'POST') {
    const rlIp = getClientIp(req);
    const rlKey = `sybilBatch:${rlIp}`;
    const lastBatch = reputationRateLimit.get(rlKey) || 0;
    if (Date.now() - lastBatch < 15000) {
      return respondJson(res, 429, { error: 'Rate limited — 15s cooldown' });
    }
    reputationRateLimit.set(rlKey, Date.now());
    try {
      const body = await readBody(req);
      const { addresses } = JSON.parse(body);
      if (!Array.isArray(addresses) || addresses.length === 0) return respondJson(res, 400, { error: 'addresses array required' });
      if (addresses.length > 20) return respondJson(res, 400, { error: 'Max 20 addresses per batch' });
      // Validate each address is a valid base58 Solana pubkey
      for (const addr of addresses) {
        if (typeof addr !== 'string' || addr.length < 32 || addr.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(addr)) {
          return respondJson(res, 400, { error: `Invalid address: ${String(addr).slice(0, 8)}...` });
        }
      }

      const results = {};
      for (const addr of addresses) {
        const cached = sybilCache.get(addr);
        if (cached && Date.now() - cached.cachedAt < 3600_000) {
          results[addr] = {
            trustGrade: cached.analysis.trustGrade,
            riskScore: cached.analysis.riskScore,
            riskLevel: cached.analysis.riskLevel,
            trustScore: cached.analysis.trustScore,
            verdict: cached.analysis.verdict || getSybilVerdict(cached.analysis),
          };
        } else {
          // Check graph for quick estimate
          const node = sybilGraph.nodes[addr];
          if (node && node.riskScore !== undefined) {
            results[addr] = {
              trustGrade: node.trustGrade || '?',
              riskScore: node.riskScore,
              riskLevel: node.riskScore >= 75 ? 'critical' : node.riskScore >= 50 ? 'high' : node.riskScore >= 30 ? 'medium' : node.riskScore >= 10 ? 'low' : 'clean',
              source: 'graph',
              verdict: getSybilQuickVerdict(node),
            };
          } else {
            results[addr] = { trustGrade: '?', riskScore: -1, riskLevel: 'unknown', source: 'not_analyzed' };
          }
        }
      }
      respondJson(res, 200, { results, total: addresses.length, analyzed: Object.values(results).filter(r => r.riskScore >= 0).length });
    } catch (e) {
      console.error('[sybil] Batch analysis failed:', e.message);
      respondJson(res, 500, { error: 'Batch analysis failed' });
    }
    return true;
  }

  // ═══ Sybil Stats ═══
  if (pathname === '/api/sybil/stats' && req.method === 'GET') {
    if (!requireAdminKey(req, res)) return true; // admin only — exposes graph intelligence
    const nodes = Object.values(sybilGraph.nodes);
    const analyzed = nodes.filter(n => n.riskScore !== undefined);
    const grades = { 'A+': 0, A: 0, B: 0, C: 0, D: 0, F: 0 };
    const verdicts = { unknown: 0, clean: 0, suspicious: 0, cluster_linked: 0, probable_sybil: 0, confirmed_sybil: 0 };
    for (const n of analyzed) {
      if (n.trustGrade && grades[n.trustGrade] !== undefined) grades[n.trustGrade]++;
      if (n.verdictKey && verdicts[n.verdictKey] !== undefined) verdicts[n.verdictKey]++;
    }
    const avgRisk = analyzed.length > 0 ? Math.round(analyzed.reduce((s, n) => s + n.riskScore, 0) / analyzed.length) : 0;
    const highRisk = analyzed.filter(n => n.riskScore >= 50).length;
    respondJson(res, 200, {
      totalAnalyzed: analyzed.length,
      totalInGraph: nodes.length,
      flaggedClusters: sybilGraph.flaggedClusters.length,
      averageRiskScore: avgRisk,
      highRiskCount: highRisk,
      gradeDistribution: grades,
      verdictDistribution: verdicts,
      cacheSize: sybilCache.size,
    });
    return true;
  }

  // ═══ Sybil Graph Lookup ═══
  if (pathname === '/api/sybil/graph' && req.method === 'GET') {
    const addr = url.searchParams.get('address');
    if (!addr) return respondJson(res, 400, { error: 'address required' });
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return respondJson(res, 400, { error: 'Invalid address' });
    // Rate limit: 10 req/min per IP
    const graphIp = getClientIp(req);
    const graphRlKey = `sybgraph:${graphIp}`;
    const graphRl = reputationRateLimit.get(graphRlKey) || 0;
    if (Date.now() - graphRl < 6000) return respondJson(res, 429, { error: 'Rate limited' });
    reputationRateLimit.set(graphRlKey, Date.now());
    const node = sybilGraph.nodes[addr];
    if (!node) return respondJson(res, 404, { error: 'Address not in sybil graph' });
    // Return safe subset — no fundedBy or full sibling list (prevents graph enumeration)
    respondJson(res, 200, {
      address: addr,
      riskScore: node.riskScore ?? -1,
      trustGrade: node.trustGrade ?? '?',
      verdict: getSybilQuickVerdict(node),
      walletAgeDays: node.walletAgeDays,
      defiDepth: node.defiDepth,
      hasSolDomain: node.hasSolDomain,
      siblingCount: node.siblings?.length || 0,
    });
    return true;
  }

  // ═══ Wallet Token Holdings / Recent Transactions ═══
  if (pathname.startsWith('/api/wallet/') && await walletHandler(req, res, url, pathname)) {
    return true;
  }

  // ═══ Sybil Funding Sources ═══
  if (pathname === '/api/sybil/funding-sources' && req.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    // Cache-first: return cached funding sources immediately (no rate limit)
    const cachedSybil = sybilCache.get(address);
    if (cachedSybil?.fundingSources && cachedSybil.fundingSources.length > 0 && Date.now() - cachedSybil.cachedAt < 3600_000) {
      return respondJson(res, 200, { sources: cachedSybil.fundingSources });
    }
    // Fresh fetch: rate limited (5s per IP)
    const fsRlKey = `fundSrc:${getClientIp(req)}`;
    if (Date.now() - (getPrismEarnRateLimit(fsRlKey) || 0) < 5_000) return respondJson(res, 429, { error: 'Rate limited' });
    setPrismEarnRateLimit(fsRlKey, Date.now());
    try {
      const { parsed } = await fetchParsedTransactions(address, 200);
      const { incoming } = extractSolTransfers(parsed, address);
      const totalReceived = [...incoming.values()].reduce((s, v) => s + v.totalSol, 0) || 1;
      const sources = [...incoming.entries()]
        .filter(([addr]) => !treasuryWallets.has(addr))
        .sort((a, b) => b[1].totalSol - a[1].totalSol)
        .slice(0, 20)
        .map(([addr, info]) => {
          const known = knownLabels[addr];
          return {
            address: addr, label: known?.label || null, type: known?.type || 'wallet',
            totalSolReceived: Math.round(info.totalSol * 10000) / 10000,
            transactionCount: info.count,
            firstInteraction: new Date(info.firstTime).toISOString(),
            lastInteraction: new Date(info.lastTime).toISOString(),
            percentage: Math.round((info.totalSol / totalReceived) * 100),
          };
        });
      respondJson(res, 200, { sources });
    } catch (e) {
      respondJson(res, 200, { sources: [], error: 'Failed to fetch funding sources' });
    }
    return true;
  }

  // ═══ Sybil Cluster Detection ═══
  if (pathname === '/api/sybil/cluster' && req.method === 'GET') {
    const clusterIp = getClientIp(req);
    const clusterRlKey = `sybilHeavy:${clusterIp}`;
    const lastCluster = getPrismEarnRateLimit(clusterRlKey) || 0;
    if (Date.now() - lastCluster < 15_000) return respondJson(res, 429, { error: 'Rate limited — try again in 15s' });
    setPrismEarnRateLimit(clusterRlKey, Date.now());
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    const cachedCluster = clusterCache.get(address);
    if (cachedCluster && Date.now() - cachedCluster.ts < 1800_000) { respondJson(res, 200, cachedCluster.data); return; }
    try {
      const { parsed } = await fetchParsedTransactions(address, 50);
      const { incoming } = extractSolTransfers(parsed, address);
      let topFunder = null, topAmount = 0;
      for (const [addr, info] of incoming) {
        if (treasuryWallets.has(addr)) continue; // skip treasury
        if (info.totalSol > topAmount) { topFunder = addr; topAmount = info.totalSol; }
      }
      if (!topFunder || topAmount < 0.01) {
        const result = { clusterId: null };
        clusterCache.set(address, { data: result, ts: Date.now() });
        respondJson(res, 200, result);
        return true;
      }
      const clusterRpcUrl = getRpcUrl(address) || 'https://api.mainnet-beta.solana.com';
      const conn = new Connection(clusterRpcUrl, 'confirmed');
      const funderSigs = await conn.getSignaturesForAddress(new PublicKey(topFunder), { limit: 100 });
      const funderBatch = funderSigs.map(s => s.signature);
      const funderParsed = (await batchGetParsedTxs(getBatchRpcUrl(topFunder), funderBatch, { batchSize: 100, delayMs: 300 })).filter(Boolean);
      const siblings = new Set();
      for (const tx of funderParsed) {
        if (!tx?.meta || !tx?.transaction) continue;
        const accounts = tx.transaction.message?.accountKeys || [];
        const pre = tx.meta.preBalances || [];
        const post = tx.meta.postBalances || [];
        for (let i = 0; i < accounts.length; i++) {
          const acc = resolveAccountKey(accounts[i]);
          const diff = ((post[i] || 0) - (pre[i] || 0)) / 1e9;
          if (diff > 0.01 && acc !== topFunder && acc !== address && acc !== '11111111111111111111111111111111') {
            siblings.add(acc);
          }
        }
      }
      const known = knownLabels[topFunder];
      const result = siblings.size >= 2 ? {
        clusterId: crypto.createHash('sha256').update(topFunder).digest('hex').slice(0, 16),
        clusterSize: siblings.size + 1, sharedFundingSource: topFunder,
        sharedFundingLabel: known?.label || null, siblingWallets: [...siblings].slice(0, 10),
        confidence: Math.min(100, 30 + siblings.size * 10),
      } : { clusterId: null };
      clusterCache.set(address, { data: result, ts: Date.now() });
      respondJson(res, 200, result);
    } catch (e) {
      respondJson(res, 200, { clusterId: null, error: 'Failed to compute cluster' });
    }
    return true;
  }

  // ═══ Sybil Circular Flow ═══
  if (pathname === '/api/sybil/circular-flow' && req.method === 'GET') {
    const circIp = getClientIp(req);
    const circRlKey = `sybilHeavy:${circIp}`;
    const lastCirc = getPrismEarnRateLimit(circRlKey) || 0;
    if (Date.now() - lastCirc < 15_000) return respondJson(res, 429, { error: 'Rate limited — try again in 15s' });
    setPrismEarnRateLimit(circRlKey, Date.now());
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    try {
      const { parsed } = await fetchParsedTransactions(address, 50);
      const { incoming, outgoing } = extractSolTransfers(parsed, address);
      const cycle = [];
      for (const [outAddr] of outgoing) {
        if (incoming.has(outAddr)) { cycle.push(address, outAddr, address); break; }
      }
      respondJson(res, 200, { detected: cycle.length > 0, cycle });
    } catch (e) {
      respondJson(res, 200, { detected: false, cycle: [], error: 'Failed to check circular flow' });
    }
    return true;
  }

  // ═══ Sybil Dark Pool ═══
  if (pathname === '/api/sybil/dark-pool' && req.method === 'GET') {
    const dpIp = getClientIp(req);
    const dpRlKey = `sybilHeavy:${dpIp}`;
    const lastDp = getPrismEarnRateLimit(dpRlKey) || 0;
    if (Date.now() - lastDp < 15_000) return respondJson(res, 429, { error: 'Rate limited — try again in 15s' });
    setPrismEarnRateLimit(dpRlKey, Date.now());
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    try {
      const { parsed } = await fetchParsedTransactions(address, 100);
      const scamInteractions = [];
      const allPrograms = new Set();
      for (const tx of parsed) {
        if (!tx?.transaction) continue;
        const ixs = tx.transaction.message?.instructions || [];
        for (const ix of ixs) {
          const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
          if (pid) allPrograms.add(pid);
          if (knownScamAddresses.has(pid)) {
            scamInteractions.push({ program: pid, signature: tx.transaction.signatures?.[0] || '', blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null });
          }
        }
        const accounts = tx.transaction.message?.accountKeys || [];
        for (const acc of accounts) {
          const addr = typeof acc === 'string' ? acc : acc?.pubkey?.toBase58?.() || '';
          if (knownScamAddresses.has(addr) && addr !== address) {
            scamInteractions.push({ address: addr, signature: tx.transaction.signatures?.[0] || '', blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null });
          }
        }
      }
      respondJson(res, 200, { address, scamInteractions: scamInteractions.slice(0, 20), scamCount: scamInteractions.length, totalProgramsUsed: allPrograms.size, riskLevel: scamInteractions.length >= 5 ? 'high' : scamInteractions.length >= 1 ? 'medium' : 'clean' });
    } catch (e) {
      respondJson(res, 200, { address, scamInteractions: [], scamCount: 0, riskLevel: 'unknown', error: 'Failed to check dark pool' });
    }
    return true;
  }

  // ═══ Sybil Suggested Targets — wallets to hunt ═══
  if (pathname === '/api/sybil/suggested-targets' && req.method === 'GET') {
    if (!ipRateLimit('sybil_targets', getClientIp(req), 5, 30000)) return respondJson(res, 429, { error: 'Rate limited' });
    const exclude = url.searchParams.get('exclude') || '';
    const excludeSet = new Set(exclude.split(',').filter(Boolean));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 10));

    // Collect unscanned siblings of known sybils
    const candidates = new Map(); // address → { source, parentRisk }
    for (const [addr, node] of Object.entries(sybilGraph.nodes)) {
      if (!node.riskScore || node.riskScore < 40 || node.inferredFromCluster) continue;
      // This is a directly-scanned suspicious wallet — its siblings are targets
      for (const sib of (node.siblings || [])) {
        if (excludeSet.has(sib)) continue;
        const sibNode = sybilGraph.nodes[sib];
        // Prefer siblings not yet directly scanned (only inferred)
        if (!sibNode || sibNode.inferredFromCluster) {
          candidates.set(sib, { source: 'sibling', parentRisk: node.riskScore, parent: addr.slice(0, 8) + '...' });
        }
      }
    }
    // Also add cluster members
    for (const cluster of sybilGraph.flaggedClusters) {
      for (const member of cluster.members) {
        if (excludeSet.has(member) || candidates.has(member)) continue;
        const mNode = sybilGraph.nodes[member];
        if (!mNode || mNode.inferredFromCluster) {
          candidates.set(member, { source: 'cluster', clusterLabel: cluster.label, funder: cluster.funder.slice(0, 8) + '...' });
        }
      }
    }

    // Sort by parent risk (highest first) and take limit
    const sorted = [...candidates.entries()]
      .sort((a, b) => (b[1].parentRisk || 0) - (a[1].parentRisk || 0))
      .slice(0, limit)
      .map(([addr, meta]) => ({ address: addr, ...meta }));

    respondJson(res, 200, { targets: sorted, totalAvailable: candidates.size });
    return true;
  }

  if (pathname === '/api/recovery/status' && req.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address) return respondJson(res, 400, { error: 'address required' });
    const entry = walletDatabase.get(address) || {};

    // Gather activity data from authoritative server-side sources
    const achEntry = achievements.get(address);
    const qp = quests.get(address);
    let questsCompleted = 0, streakDays = 0;
    if (qp?.quests) { for (const q of Object.values(qp.quests)) { if (q.completed) questsCompleted++; } streakDays = qp.streakDays || 0; }
    const playerEntries = leaderboardEntries.filter(e => e.address === address);
    const gameTypesCount = new Set(playerEntries.map(e => e.gameType || 'orbit')).size;
    const gamesPlayedCount = playerEntries.length;
    const realChallengeWins = activeChallenges.filter(c => c.status === 'completed' && c.winner === address).length;
    const realScanCount = getUniqueScanTargetCount(getScanRewardState(address, entry));
    const achievementCount = achEntry ? achEntry.unlocked.size : 0;
    // Text quests completed count — stored in userData.textQuests (object keyed by questId with completed flag)
    const userData = entry.userData || {};
    const tqMap = userData.textQuests || {};
    const textQuestsCompleted = Object.values(tqMap).filter(tq => tq && tq.completed).length;

    // Vault check
    const vaultStaked = Boolean(entry.staking?.tier);

    // Activity bonus calculation (max 25)
    let activityBonus = 0;
    if (gamesPlayedCount > 0) activityBonus += Math.min(6, gameTypesCount * 2); // up to 3 game types = +6
    if (achievementCount > 3) activityBonus += 3;
    if (questsCompleted > 3) activityBonus += 3;
    if (streakDays > 3) activityBonus += 3;
    if (realScanCount > 5) activityBonus += 3;
    if (realChallengeWins > 0) activityBonus += 2;
    if (textQuestsCompleted > 0) activityBonus += 2;
    if (gamesPlayedCount > 20) activityBonus += 3;
    if (vaultStaked) activityBonus += 2;
    activityBonus = Math.min(25, activityBonus);

    const currentTrustScore = entry.sybil?.trustScore || 0;
    const adjustedTrustScore = Math.min(100, currentTrustScore + activityBonus);

    respondJson(res, 200, {
      currentTrustScore,
      adjustedTrustScore,
      recoveryBonus: activityBonus,
      breakdown: {
        activityBonus,
      },
      activity: {
        gameTypes: gameTypesCount,
        achievements: achievementCount,
        quests: questsCompleted,
        streak: streakDays,
        scans: realScanCount,
        challengeWins: realChallengeWins,
        gamesPlayed: gamesPlayedCount,
        textQuests: textQuestsCompleted,
        vaultStaked,
      },
    });
    return true;
  }

    return false;
  };
}

export { registerSybilRoute };
