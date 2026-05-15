function registerDiscoveryRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      reputationRateLimit,
    },
    auth: {
      optionalJwt,
    },
    wallet: {
      walletDatabase,
      mintedAddresses,
      getCoinBalance,
      updateWalletEntry,
      triggerCompositeUpdate,
      feedItems,
    },
    economy: {
      getPrismEarnRateLimit,
      setPrismEarnRateLimit,
    },
    scoreHistory,
    coinBalances,
    enhancedTxCache,
    constellationCache,
    fetchEnhancedTransactions,
    fetchParsedTransactions,
    isProgramAddress,
    extractSolTransfers,
    knownLabels,
  } = ctx;

  return async function handleDiscoveryRoute(req, res, url, pathname) {
    if (pathname === '/api/leaderboard' && req.method === 'GET') {
      if (!ipRateLimit('glb_lb', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const entryMap = new Map();
      for (const [address, history] of scoreHistory) {
        const latest = history.scores?.[0];
        if (latest) {
          entryMap.set(address, {
            address,
            totalCoins: getCoinBalance(address),
            score: latest.score,
            tier: latest.tier || 'unknown',
            prismBalance: getCoinBalance(address),
            isMinted: mintedAddresses.has(address),
            badges: 0,
            rank: 0,
          });
        }
      }
      for (const [address] of coinBalances) {
        if (!entryMap.has(address)) {
          entryMap.set(address, {
            address,
            totalCoins: getCoinBalance(address),
            score: 0,
            tier: 'unknown',
            prismBalance: getCoinBalance(address),
            isMinted: mintedAddresses.has(address),
            badges: 0,
            rank: 0,
          });
        }
      }
      const entries = [...entryMap.values()].sort((a, b) => b.totalCoins - a.totalCoins || b.score - a.score || b.prismBalance - a.prismBalance);
      entries.forEach((entry, index) => {
        entry.rank = index + 1;
      });
      respondJson(res, 200, { entries: entries.slice(0, limit) });
      return true;
    }

    if (pathname === '/api/feed' && req.method === 'GET') {
      if (!ipRateLimit('feed', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
      respondJson(res, 200, { items: feedItems.slice(0, limit) });
      return true;
    }

    if (pathname === '/api/enhanced-tx' && req.method === 'GET') {
      const address = url.searchParams.get('address');
      if (!address) return respondJson(res, 400, { error: 'address required' });
      const enhancedTxRateLimitKey = `etx:${address}`;
      if (Date.now() - (reputationRateLimit.get(enhancedTxRateLimitKey) || 0) < 30_000) {
        const cached = enhancedTxCache.get(address);
        if (cached && Date.now() - cached.ts < 600_000) {
          const { edgeTypesMap, txs, historyExhausted, ...safe } = cached.data;
          return respondJson(res, 200, safe);
        }
        return respondJson(res, 429, { error: 'Rate limited. Try again in 30 seconds.' });
      }
      reputationRateLimit.set(enhancedTxRateLimitKey, Date.now());
      try {
        const data = await fetchEnhancedTransactions(address, 1000);
        if (!data) return respondJson(res, 200, { swapCount: 0, nftTradeCount: 0, stakingCount: 0, defiProtocols: [], isDeFiUser: false, isDeFiKing: false });
        const { edgeTypesMap, txs, historyExhausted, ...safe } = data;
        respondJson(res, 200, safe);
      } catch (error) {
        respondJson(res, 200, {
          swapCount: 0,
          nftTradeCount: 0,
          stakingCount: 0,
          defiProtocols: [],
          isDeFiUser: false,
          isDeFiKing: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }

    if (pathname === '/api/constellation' && req.method === 'GET') {
      const address = url.searchParams.get('address');
      if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Valid address required' });
      const clientIp = getClientIp(req);
      const clientRateLimitKey = `const:${clientIp}`;
      if (Date.now() - (reputationRateLimit.get(clientRateLimitKey) || 0) < 10_000) {
        const cached = constellationCache.get(address);
        if (cached && Date.now() - cached.ts < 600_000) return respondJson(res, 200, cached.data);
        return respondJson(res, 429, { error: 'Rate limited. Try again in 10 seconds.' });
      }
      const cachedConstellation = constellationCache.get(address);
      if (cachedConstellation && Date.now() - cachedConstellation.ts < 600_000) {
        respondJson(res, 200, cachedConstellation.data);
        return true;
      }
      const constellationRateLimitKey = `constellation:${address}`;
      const lastConstellationRun = getPrismEarnRateLimit(constellationRateLimitKey) || 0;
      if (Date.now() - lastConstellationRun < 10_000) {
        const cached = constellationCache.get(address);
        if (cached && Date.now() - cached.ts < 600_000) return respondJson(res, 200, cached.data);
        return respondJson(res, 429, { error: 'Constellation data is being fetched, try again in 10s' });
      }
      reputationRateLimit.set(clientRateLimitKey, Date.now());
      setPrismEarnRateLimit(constellationRateLimitKey, Date.now());
      try {
        const parsedLimit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10) || 500, 500);
        const [{ parsed }, enhancedResult] = await Promise.all([
          fetchParsedTransactions(address, parsedLimit),
          fetchEnhancedTransactions(address, 1000).catch(() => null),
        ]);
        const { incoming, outgoing, programIds } = extractSolTransfers(parsed, address);
        const enhancedEdgeTypes = enhancedResult?.edgeTypesMap || new Map();
        const nodeMap = new Map();
        const centerTier = url.searchParams.get('tier') || null;
        nodeMap.set(address, { id: address, label: address.slice(0, 4) + '...' + address.slice(-4), size: 14, x: 0, y: 0, vx: 0, vy: 0, color: '#22d3ee', isCenter: true, solVolume: 0, txCount: 0, tier: centerTier });
        const allCounterparties = new Map();
        for (const [counterparty, info] of incoming) {
          if (isProgramAddress(counterparty, programIds)) continue;
          const existing = allCounterparties.get(counterparty) || { solIn: 0, solOut: 0, count: 0, firstTime: Infinity, lastTime: 0 };
          existing.solIn += info.totalSol;
          existing.count += info.count;
          existing.firstTime = Math.min(existing.firstTime, info.firstTime || Date.now());
          existing.lastTime = Math.max(existing.lastTime, info.lastTime || Date.now());
          allCounterparties.set(counterparty, existing);
        }
        for (const [counterparty, info] of outgoing) {
          if (isProgramAddress(counterparty, programIds)) continue;
          const existing = allCounterparties.get(counterparty) || { solIn: 0, solOut: 0, count: 0, firstTime: Infinity, lastTime: 0 };
          existing.solOut += info.totalSol;
          existing.count += info.count;
          existing.firstTime = Math.min(existing.firstTime, info.firstTime || Date.now());
          existing.lastTime = Math.max(existing.lastTime, info.lastTime || Date.now());
          allCounterparties.set(counterparty, existing);
        }
        const filtered = [...allCounterparties.entries()].filter(([, info]) => (info.solIn + info.solOut) >= 0.001);
        const sorted = filtered.sort((a, b) => (b[1].solIn + b[1].solOut) - (a[1].solIn + a[1].solOut));
        const tierColors = { mercury: '#8B8B8B', mars: '#C1440E', venus: '#E8CDA0', earth: '#4B9CD3', neptune: '#3F54BE', uranus: '#73C2FB', saturn: '#E8D191', jupiter: '#C88B3A', sun: '#FFD700', binary_sun: '#22D3EE' };
        const colorPalette = Object.values(tierColors);
        const edges = [];
        for (let index = 0; index < sorted.length; index += 1) {
          const [counterparty, info] = sorted[index];
          const known = knownLabels[counterparty];
          const angle = (index / sorted.length) * Math.PI * 2;
          const distance = 80 + Math.random() * 100;
          const totalVolume = info.solIn + info.solOut;
          nodeMap.set(counterparty, {
            id: counterparty,
            label: known?.label || (counterparty.slice(0, 4) + '...' + counterparty.slice(-4)),
            size: Math.min(10, 3 + Math.log1p(totalVolume) * 2),
            x: Math.cos(angle) * distance + (Math.random() - 0.5) * 30,
            y: Math.sin(angle) * distance + (Math.random() - 0.5) * 30,
            vx: 0,
            vy: 0,
            color: known ? '#f59e0b' : colorPalette[index % colorPalette.length],
            isCenter: false,
            tier: known?.type || null,
            solVolume: Math.round(totalVolume * 10000) / 10000,
            txCount: info.count,
          });
          const txTypeSet = new Set();
          const incomingInfo = incoming.get(counterparty);
          const outgoingInfo = outgoing.get(counterparty);
          if (incomingInfo?.txTypeSet) {
            for (const txType of incomingInfo.txTypeSet) txTypeSet.add(txType);
          }
          if (outgoingInfo?.txTypeSet) {
            for (const txType of outgoingInfo.txTypeSet) txTypeSet.add(txType);
          }
          if (enhancedEdgeTypes.size > 0) {
            if (incomingInfo?.signatures) {
              for (const signature of incomingInfo.signatures) {
                const edgeType = enhancedEdgeTypes.get(signature);
                if (edgeType && edgeType !== 'transfer') txTypeSet.add(edgeType);
              }
            }
            if (outgoingInfo?.signatures) {
              for (const signature of outgoingInfo.signatures) {
                const edgeType = enhancedEdgeTypes.get(signature);
                if (edgeType && edgeType !== 'transfer') txTypeSet.add(edgeType);
              }
            }
          }
          const txTypes = txTypeSet.size > 0 ? [...txTypeSet] : ['transfer'];
          edges.push({
            source: address,
            target: counterparty,
            weight: info.count,
            totalSol: Math.round(totalVolume * 10000) / 10000,
            outSol: Math.round((info.solOut || 0) * 10000) / 10000,
            inSol: Math.round((info.solIn || 0) * 10000) / 10000,
            firstTx: info.firstTime !== Infinity ? info.firstTime : null,
            lastTx: info.lastTime > 0 ? info.lastTime : null,
            txTypes,
          });
        }
        const allNodes = [...nodeMap.values()];
        const cappedNodes = allNodes.length > 200 ? allNodes.slice(0, 200) : allNodes;
        const nodeIds = new Set(cappedNodes.map((node) => node.id));
        const cappedEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
        const result = { nodes: cappedNodes, edges: cappedEdges };
        constellationCache.set(address, { data: result, ts: Date.now() });
        const viewerAuth = optionalJwt(req, res);
        const viewerAddr = viewerAuth?.address;
        if (viewerAddr && viewerAddr !== address) {
          const viewerRateLimitKey = `ce_daily:${viewerAddr}`;
          const today = new Date().toISOString().slice(0, 10);
          const viewerRateLimit = getPrismEarnRateLimit(viewerRateLimitKey);
          const viewerDayCount = (viewerRateLimit && typeof viewerRateLimit === 'object' && viewerRateLimit.date === today) ? viewerRateLimit.count : 0;
          if (viewerDayCount < 10) {
            setPrismEarnRateLimit(viewerRateLimitKey, { date: today, count: viewerDayCount + 1 });
            const viewerWallet = walletDatabase.get(viewerAddr) || {};
            const socialStats = viewerWallet.socialStats || { challengesWon: 0, constellationExplored: 0, compareCount: 0 };
            socialStats.constellationExplored = (socialStats.constellationExplored || 0) + 1;
            updateWalletEntry(viewerAddr, { socialStats });
            triggerCompositeUpdate(viewerAddr);
          }
        }
        respondJson(res, 200, result);
      } catch {
        respondJson(res, 200, { nodes: [], edges: [], error: 'Failed to compute constellation' });
      }
      return true;
    }

    return false;
  };
}

export { registerDiscoveryRoute };
