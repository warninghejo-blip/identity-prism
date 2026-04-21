import crypto from 'node:crypto';
import { Connection, PublicKey } from '@solana/web3.js';
import { createScanOrchestrator } from '../services/scanOrchestrator.js';

function registerSybilRoute(ctx) {
  const runSybilAnalysis = createScanOrchestrator(ctx);
  const { ipRateLimit, getClientIp, respondJson, requireAdminKey, getRpcUrl, getBatchRpcUrl, batchGetParsedTxs, resolveAccountKey, readBody, reputationRateLimit } = ctx.core;
  // optionalJwt is in ctx.auth — it does NOT write to res on bad token, so passing res is safe
  const { optionalJwt } = ctx.auth;
  const { walletDatabase, updateWalletEntry, triggerCompositeUpdate, achievements, leaderboardEntries } = ctx.wallet;
  const { getPrismEarnRateLimit, setPrismEarnRateLimit, getScanRewardState, skrMint } = ctx.economy;
  const { sybilCache, getSybilVerdict } = ctx.sybil;
  // flat: not yet in a slice
  const {
    sybilInFlight,
    clusterCache,
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
    programLabels,
    treasuryWallets,
    knownLabels,
    knownScamAddresses,
    quests,
    activeChallenges,
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
    const analysisPromise = runSybilAnalysis(address, { isOwnWalletScan });
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


