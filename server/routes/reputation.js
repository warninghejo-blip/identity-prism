import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { checkApiKey } from '../services/apiKeyMiddleware.js';

const apiKeyRegistry = new Map(
  (process.env.REPUTATION_API_KEYS || '').split(',').filter(Boolean).map((key) => [key.trim(), true]),
);

function registerReputationRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      readBody,
      requireJwt,
      resolveCorsOrigin,
    },
    wallet: {
      walletDatabase,
      getScoreHistory,
      getCoinBalance,
      achievements,
    },
    sybil: {
      sybilCache,
      buildPublicReputationResponse,
      publicReputationTtlSeconds,
      reputationV2RateLimit,
      fetchIdentitySnapshot,
      calculateCompositeScore,
      buildCompositeInput,
      getSybilVerdict,
      getSybilVerdictHistory,
      submitSybilFeedback,
    },
  } = ctx;

  return async function handleReputationRoute(req, res, url, pathname) {
    if (pathname.startsWith('/api/actions/sybil/')) {
      const apiKeyResult = await checkApiKey(respondJson, req, res);
      if (!apiKeyResult.ok) return true;
      if (apiKeyResult.remaining != null) res.setHeader('X-RateLimit-Remaining', String(apiKeyResult.remaining));
      if (!ipRateLimit('actions', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Expose-Headers': 'X-Action-Version',
        });
        res.end();
        return true;
      }

      if (req.method !== 'GET') {
        respondJson(res, 405, { error: 'Method not allowed' });
        return true;
      }

      const validAddr = pathname.slice('/api/actions/sybil/'.length).split('?')[0].trim();
      try {
        new PublicKey(validAddr);
      } catch {
        respondJson(res, 400, { error: 'Invalid Solana address' });
        return true;
      }

      try {
        let score = 0;
        let tier = 'unknown';
        let risk = 'unknown';

        const cachedSybil = sybilCache.get(validAddr);
        const cachedWallet = walletDatabase.get(validAddr);

        if (cachedSybil && Date.now() - cachedSybil.cachedAt < 3600_000) {
          score = cachedSybil.analysis.trustScore ?? 0;
          tier = cachedSybil.analysis.trustGrade ?? 'unknown';
          risk = cachedSybil.analysis.riskLevel ?? 'unknown';
        } else if (cachedWallet?._lastReputation) {
          const rep = cachedWallet._lastReputation;
          score = rep.score ?? 0;
          tier = rep.tier ?? rep.trustGrade ?? 'unknown';
          risk = rep.riskLevel ?? 'unknown';
        } else {
          respondJson(res, 404, { error: 'Address not indexed yet' });
          return true;
        }

        const shortAddr = `${validAddr.slice(0, 4)}…${validAddr.slice(-4)}`;
        const displayScore = score > 100 ? score : Math.round(score * 10);
        const blinkPayload = {
          type: 'action',
          icon: 'https://identityprism.xyz/og-image.png',
          title: 'Identity Prism — Sybil Snapshot',
          description: `Check the sybil risk and reputation score for this Solana wallet: ${shortAddr}\n\nScore: ${displayScore}/1000  |  Tier: ${String(tier).toUpperCase()}  |  Risk: ${String(risk).toUpperCase()}\n\nPowered by Identity Prism behavioral + on-chain sybil detection.`,
          label: 'View Full Report',
          links: {
            actions: [
              {
                label: 'Open Full Report',
                href: `https://identityprism.xyz/?scan=${validAddr}`,
              },
            ],
          },
        };

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Expose-Headers', 'X-Action-Version');
        respondJson(res, 200, blinkPayload);
      } catch (error) {
        console.error('[actions/sybil] failed for', validAddr, error);
        respondJson(res, 500, { error: 'Failed to compute sybil snapshot' });
      }
      return true;
    }

    const publicReputationMatch = pathname.match(/^\/api\/v1\/reputation\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    const publicHistoryMatch = pathname.match(/^\/api\/v1\/reputation\/([1-9A-HJ-NP-Za-km-z]{32,44})\/history$/);
    if (publicReputationMatch && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': resolveCorsOrigin(req),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return true;
    }

    if (publicHistoryMatch && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': resolveCorsOrigin(req),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return true;
    }

    if (publicReputationMatch && req.method === 'GET') {
      const apiKeyResult = await checkApiKey(respondJson, req, res);
      if (!apiKeyResult.ok) return true;
      if (apiKeyResult.remaining != null) res.setHeader('X-RateLimit-Remaining', String(apiKeyResult.remaining));
      if (!ipRateLimit('public_reputation', getClientIp(req), 60, 60000)) {
        return respondJson(res, 429, { error: 'Too many reputation requests' });
      }

      const address = publicReputationMatch[1];
      const response = buildPublicReputationResponse(address);
      if (!response) return respondJson(res, 404, { error: 'address not found' });

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': resolveCorsOrigin(req),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': `public, max-age=${publicReputationTtlSeconds}`,
      });
      res.end(JSON.stringify(response));
      return true;
    }

    if (publicHistoryMatch && req.method === 'GET') {
      if (!ipRateLimit('public_reputation_history', getClientIp(req), 30, 60000)) {
        return respondJson(res, 429, { error: 'Too many reputation history requests' });
      }

      const address = publicHistoryMatch[1];
      const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
      const history = getSybilVerdictHistory(address, days);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': resolveCorsOrigin(req),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'private, no-store',
      });
      res.end(JSON.stringify(history));
      return true;
    }

    if (pathname === '/api/sybil/feedback' && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': resolveCorsOrigin(req),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return true;
    }

    if (pathname === '/api/sybil/feedback' && req.method === 'POST') {
      if (!ipRateLimit('sybil_feedback', getClientIp(req), 5, 60000)) {
        return respondJson(res, 429, { error: 'Too many feedback submissions' });
      }

      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return respondJson(res, 400, { error: 'Invalid JSON body' });
      }

      const targetAddress = typeof body?.target_address === 'string' ? body.target_address.trim() : '';
      const reportType = typeof body?.report_type === 'string' ? body.report_type.trim() : '';
      const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null;
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(targetAddress)) {
        return respondJson(res, 400, { error: 'Invalid target_address' });
      }
      if (!new Set(['sybil', 'human_verified', 'false_positive']).has(reportType)) {
        return respondJson(res, 400, { error: 'Invalid report_type' });
      }

      let adminVerified = null;
      if (reportType === 'sybil') {
        const cached = sybilCache.get(targetAddress);
        const analysis = cached?.analysis || cached;
        const verdict = analysis ? (analysis.verdict || getSybilVerdict(analysis)) : null;
        const verdictKey = verdict?.key;
        if (
          verdictKey === 'confirmed_sybil' ||
          verdictKey === 'probable_sybil' ||
          verdictKey === 'suspicious' ||
          verdictKey === 'cluster_linked'
        ) {
          adminVerified = true;
        }
      }

      const created = submitSybilFeedback({
        targetAddress,
        reportedBy: jwtAuth.address || null,
        reportType,
        notes,
        adminVerified,
      });

      res.writeHead(201, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': resolveCorsOrigin(req),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'private, no-store',
      });
      res.end(JSON.stringify(created));
      return true;
    }

    if (pathname === '/api/v2/reputation' && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': resolveCorsOrigin(req),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return true;
    }

    if (pathname === '/api/v2/reputation' && req.method === 'GET') {
      const address = url.searchParams.get('address');
      if (!address) return respondJson(res, 400, { error: 'address query parameter required', docs: 'GET /api/v2/reputation?address=<solana_address>' });
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
      const ip = getClientIp(req);
      const apiKey = req.headers['x-api-key'];
      let maxPerMin = 10;
      if (apiKey) {
        if (!apiKeyRegistry.has(apiKey) && apiKeyRegistry.size > 0) {
          return respondJson(res, 401, { error: 'Invalid API key' });
        }
        maxPerMin = 60;
      }
      const now = Date.now();
      const rl = reputationV2RateLimit.get(ip) || { count: 0, resetAt: now + 60000 };
      if (now > rl.resetAt) {
        rl.count = 0;
        rl.resetAt = now + 60000;
      }
      rl.count++;
      reputationV2RateLimit.set(ip, rl);
      if (rl.count > maxPerMin) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'Rate limited', retryAfterSec: Math.ceil((rl.resetAt - now) / 1000) }));
        return true;
      }
      try {
        const snapshot = await fetchIdentitySnapshot(address);
        const identity = snapshot.identity;
        if (!identity || identity.error) return respondJson(res, 404, { error: 'Could not resolve wallet identity', address });
        let sybil = null;
        const cachedSybil = sybilCache.get(address);
        if (cachedSybil && now - cachedSybil.cachedAt < 3600_000) sybil = cachedSybil.analysis;
        const history = getScoreHistory(address);
        const latestScores = (history.scores || []).slice(0, 5);
        const coinBal = getCoinBalance(address);
        const compositeData = calculateCompositeScore(buildCompositeInput(address));
        const achEntry = achievements.get(address);
        const response = {
          version: '2.1',
          address,
          onchainScore: identity.score,
          compositeScore: compositeData.compositeScore,
          compositeTier: compositeData.compositeTier,
          scoreBreakdown: compositeData.breakdown,
          scoreDetails: compositeData.details || null,
          identity: { score: identity.score, maxScore: 1000, tier: identity.tier, badges: identity.badges || [], badgeCount: identity.badges?.length || 0 },
          stats: { solBalance: Math.round(snapshot.solBalance * 1000) / 1000, walletAgeDays: snapshot.walletAgeDays, transactionCount: snapshot.txCount, tokenCount: snapshot.tokenCount, nftCount: snapshot.nftCount },
          sybilAnalysis: sybil ? {
            trustScore: sybil.trustScore,
            trustGrade: sybil.trustGrade,
            riskScore: sybil.riskScore,
            riskLevel: sybil.riskLevel,
            verdict: sybil.verdict || getSybilVerdict(sybil),
            signalsDetected: sybil.signals?.filter((signal) => signal.detected).length || 0,
            totalSignals: sybil.signals?.length || 0,
          } : null,
          achievements: { unlocked: achEntry ? achEntry.unlocked.size : 0, claimed: achEntry ? achEntry.claimed.size : 0 },
          prism: coinBal > 0 ? { balance: coinBal, totalEarned: coinBal } : null,
          scoreHistory: latestScores,
          meta: { timestamp: new Date().toISOString(), cached: Boolean(cachedSybil), provider: 'Identity Prism', website: 'https://identityprism.xyz' },
        };
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': resolveCorsOrigin(req),
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
          'Cache-Control': 'private, no-store',
        });
        res.end(JSON.stringify(response));
      } catch {
        respondJson(res, 500, { error: 'Internal error' });
      }
      return true;
    }

    return false;
  };
}

function registerReputationInlineRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      readBody,
      getRpcUrl,
      getBatchRpcUrl,
      getBaseUrl,
      batchGetParsedTxs,
      reputationRateLimit,
    },
    wallet: {
      walletDatabase,
      saveWalletDatabaseDebounced,
      updateWalletEntry,
      triggerCompositeUpdate,
    },
    economy: {
      getPrismEarnRateLimit,
      setPrismEarnRateLimit,
    },
    sybil: {
      sybilCache,
      fetchIdentitySnapshot,
      calculateCompositeScore,
      buildCompositeInput,
      getSybilVerdict,
    },
    treasuryAddress,
    treasurySecret,
    treasurySecretPath,
    parseSecretKey,
    loadSecretKeyFromFile,
  } = ctx;

  const PROGRAM_NAMES = {
    JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter',
    whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'Orca',
    CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'Raydium CLMM',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
    SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ: 'Saber',
    mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68: 'Marinade',
    MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA: 'Marinade Finance',
    MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD: 'Marinade',
    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'Token Program',
    ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'ATA Program',
    MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo',
    metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: 'Metaplex',
    BGUMAp9Gq7iTEuizy4pqAxsTkFQ1XyUbSreFdn6YqwPc: 'Bubblegum',
    DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1: 'Tensor',
    TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN: 'Tensor Swap',
    M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K: 'Magic Eden V2',
    CMZYPASGWeTz7RNGHaRJfCq2XQ5pYK6nDvVQxzkH51zb: 'Solend',
    PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY: 'Phoenix',
    LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'Meteora',
    Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: 'Phantom',
    FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH: 'Pyth Oracle',
    wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb: 'Wormhole',
    SSwapUtytfBdBn1b9NUGG6foMVPtcWgpRU32HToDUZr: 'Step Finance',
    DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M: 'Jupiter DCA',
    jCebN34bUfdeUhR6bhNixjhCSnx9CY23HsmUkT7XjVV: 'Jito',
  };

  const formatCompareWallet = (snapshot, address) => {
    const comp = walletDatabase.get(address)?.composite || calculateCompositeScore(buildCompositeInput(address));
    return {
      address,
      score: snapshot.identity.score,
      tier: snapshot.identity.tier,
      badges: snapshot.identity.badges,
      compositeScore: comp.compositeScore,
      compositeTier: comp.compositeTier,
      stats: {
        walletAgeDays: snapshot.walletAgeDays,
        solBalance: Math.round(snapshot.solBalance * 1000) / 1000,
        txCount: snapshot.txCount,
        tokenCount: snapshot.tokenCount,
        nftCount: snapshot.nftCount,
      },
    };
  };

  return async function handleReputationInlineRoute(req, res, url, pathname) {
    if (
      (pathname === '/api/reputation' || pathname === '/api/reputation/compare' || pathname === '/api/reputation/batch')
      && (req.method === 'GET' || req.method === 'POST')
    ) {
      const rlIp = getClientIp(req);
      const rlKey = `repv1:${rlIp}`;
      const now = Date.now();
      const lastReq = reputationRateLimit.get(rlKey) || 0;
      if (now - lastReq < 1_000) {
        respondJson(res, 429, { error: 'Rate limited', retryAfterMs: 1_000 - (now - lastReq) });
        return true;
      }
      reputationRateLimit.set(rlKey, now);
      if (reputationRateLimit.size > 5000) {
        const cutoff = now - 20_000;
        for (const [key, value] of reputationRateLimit) {
          if (value < cutoff) reputationRateLimit.delete(key);
        }
      }
    }

    if (pathname === '/api/reputation' && req.method === 'GET') {
      const address = String(url.searchParams.get('address') ?? '').trim();
      if (!address) {
        respondJson(res, 400, { error: 'address query parameter is required' });
        return true;
      }
      try {
        new PublicKey(address);
      } catch {
        respondJson(res, 400, { error: 'Invalid Solana address' });
        return true;
      }

      const cachedWallet = walletDatabase.get(address);
      if (cachedWallet?.lastReputationAt && Date.now() - cachedWallet.lastReputationAt < 60_000 && cachedWallet._lastReputation) {
        respondJson(res, 200, cachedWallet._lastReputation);
        return true;
      }

      try {
        const snapshot = await fetchIdentitySnapshot(address);
        const { identity, walletAgeDays, solBalance, txCount, tokenCount, nftCount } = snapshot;

        let trustGrade = null;
        let trustScore = null;
        let riskLevel = null;
        let sybilVerdict = null;
        let topPrograms = [];

        try {
          const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
          const pubkey = new PublicKey(address);
          const cachedSybil = sybilCache.get(address);
          if (cachedSybil && Date.now() - cachedSybil.cachedAt < 3600_000) {
            trustGrade = cachedSybil.analysis.trustGrade;
            trustScore = cachedSybil.analysis.trustScore;
            riskLevel = cachedSybil.analysis.riskLevel;
            sybilVerdict = cachedSybil.analysis.verdict || getSybilVerdict(cachedSybil.analysis);
            topPrograms = cachedSybil.analysis.metrics?.topPrograms || [];
          } else {
            let riskPts = 0;
            if (walletAgeDays < 30) riskPts += 15;
            if (txCount < 10) riskPts += 10;
            if (solBalance < 0.01) riskPts += 8;
            if (nftCount === 0) riskPts += 5;
            if (tokenCount < 3) riskPts += 6;
            if (walletAgeDays > 365) riskPts -= 5;
            if (tokenCount >= 10) riskPts -= 3;
            if (nftCount >= 5) riskPts -= 2;
            riskPts = Math.max(0, Math.min(100, riskPts));
            const ts = Math.min(90, Math.max(0, 100 - riskPts));
            trustScore = ts;
            trustGrade = ts >= 90 ? 'A+' : ts >= 80 ? 'A' : ts >= 70 ? 'B' : ts >= 60 ? 'C' : ts >= 50 ? 'D' : 'F';
            riskLevel = riskPts >= 75 ? 'critical' : riskPts >= 50 ? 'high' : riskPts >= 30 ? 'medium' : riskPts >= 10 ? 'low' : 'clean';
          }

          if (topPrograms.length === 0) {
            try {
              const recentSigs = await conn.getSignaturesForAddress(pubkey, { limit: 100 });
              const sigBatch = recentSigs.map((entry) => entry.signature);
              if (sigBatch.length > 0) {
                const programCounts = new Map();
                const batchTxs = await batchGetParsedTxs(getBatchRpcUrl(address), sigBatch, { batchSize: 100 });
                for (const tx of batchTxs) {
                  if (!tx?.transaction?.message?.instructions) continue;
                  for (const instruction of tx.transaction.message.instructions) {
                    const programId = instruction.programId?.toBase58?.() || (typeof instruction.programId === 'string' ? instruction.programId : '');
                    if (
                      programId
                      && programId !== '11111111111111111111111111111111'
                      && programId !== 'ComputeBudget111111111111111111111111111111'
                    ) {
                      programCounts.set(programId, (programCounts.get(programId) || 0) + 1);
                    }
                  }
                }
                topPrograms = [...programCounts.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([programId, interactions]) => ({
                    programId,
                    name: PROGRAM_NAMES[programId] || null,
                    interactions,
                  }));
              }
            } catch {
              // non-critical enrichment only
            }
          }
        } catch {
          // trust enrichment is best-effort
        }

        const firstTxTimestamp = snapshot.firstTxTime || null;
        updateWalletEntry(address, {
          score: identity.score,
          tier: identity.tier,
          badges: identity.badges,
          scoreBreakdown: identity.scoreBreakdown,
          ...(firstTxTimestamp ? { firstTxTimestamp } : {}),
          stats: {
            tokens: tokenCount,
            nfts: nftCount,
            transactions: txCount,
            solBalance: Math.round(solBalance * 1000) / 1000,
            walletAgeYears: Math.floor(walletAgeDays / 365),
          },
        });
        triggerCompositeUpdate(address);

        const repResponse = {
          address,
          score: identity.score,
          tier: identity.tier,
          badges: identity.badges,
          scoreBreakdown: identity.scoreBreakdown,
          trustGrade,
          trustScore,
          riskLevel,
          sybilVerdict,
          topPrograms,
          stats: {
            walletAgeDays,
            solBalance: Math.round(solBalance * 1000) / 1000,
            txCount,
            tokenCount,
            nftCount,
          },
        };
        updateWalletEntry(address, { _lastReputation: repResponse, lastReputationAt: Date.now() });
        respondJson(res, 200, repResponse);
      } catch (error) {
        console.error('[reputation] failed for', address, error);
        respondJson(res, 500, { error: 'Failed to compute reputation' });
      }
      return true;
    }

    if (pathname === '/api/reputation/batch' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          respondJson(res, 400, { error: 'Invalid JSON' });
          return true;
        }
        const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];
        if (!addresses.length || addresses.length > 5) {
          respondJson(res, 400, { error: 'Provide 1-5 addresses in { "addresses": [...] }' });
          return true;
        }

        const results = [];
        for (const address of addresses) {
          const trimmed = String(address).trim();
          try {
            new PublicKey(trimmed);
            const snapshot = await fetchIdentitySnapshot(trimmed);
            const comp = walletDatabase.get(trimmed)?.composite || calculateCompositeScore(buildCompositeInput(trimmed));
            results.push({
              address: trimmed,
              score: snapshot.identity.score,
              tier: snapshot.identity.tier,
              badges: snapshot.identity.badges,
              compositeScore: comp.compositeScore,
              compositeTier: comp.compositeTier,
              stats: {
                walletAgeDays: snapshot.walletAgeDays,
                solBalance: Math.round(snapshot.solBalance * 1000) / 1000,
                txCount: snapshot.txCount,
                tokenCount: snapshot.tokenCount,
                nftCount: snapshot.nftCount,
              },
            });
          } catch {
            results.push({ address: trimmed, error: 'Failed to compute reputation' });
          }
        }
        respondJson(res, 200, { results });
      } catch {
        respondJson(res, 500, { error: 'Failed to compute batch reputation' });
      }
      return true;
    }

    if (pathname === '/api/reputation/compare' && req.method === 'GET') {
      const a = String(url.searchParams.get('a') ?? '').trim();
      const b = String(url.searchParams.get('b') ?? '').trim();
      if (!a || !b) {
        respondJson(res, 400, { error: 'Both ?a= and ?b= address parameters are required' });
        return true;
      }
      try {
        new PublicKey(a);
        new PublicKey(b);
      } catch {
        respondJson(res, 400, { error: 'Invalid Solana address' });
        return true;
      }

      try {
        const [snapA, snapB] = await Promise.all([
          fetchIdentitySnapshot(a),
          fetchIdentitySnapshot(b),
        ]);
        const resultA = formatCompareWallet(snapA, a);
        const resultB = formatCompareWallet(snapB, b);
        const diff = resultA.compositeScore - resultB.compositeScore;

        const comparePairKey = `compare_pair:${[a, b].sort().join(':')}`;
        const compareToday = new Date().toISOString().slice(0, 10);
        const comparePairEntry = getPrismEarnRateLimit(comparePairKey);
        if (!comparePairEntry || comparePairEntry.date !== compareToday) {
          setPrismEarnRateLimit(comparePairKey, { date: compareToday });
          for (const address of [a, b]) {
            const wallet = walletDatabase.get(address) || {};
            const socialStats = wallet.socialStats || { challengesWon: 0, constellationExplored: 0, compareCount: 0 };
            socialStats.compareCount = (socialStats.compareCount || 0) + 1;
            updateWalletEntry(address, { socialStats });
          }
          triggerCompositeUpdate(a);
          triggerCompositeUpdate(b);
        }

        respondJson(res, 200, {
          wallets: [resultA, resultB],
          scoreDiff: diff,
          winner: diff > 0 ? a : diff < 0 ? b : 'tie',
        });
      } catch (error) {
        console.error('[reputation/compare] failed', error);
        respondJson(res, 500, { error: 'Failed to compare reputations' });
      }
      return true;
    }

    if (pathname === '/api/actions/attest' || pathname === '/api/reputation/attest') {
      if (!ipRateLimit('attest', getClientIp(req), 10, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }

      const memoProgramId = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
      const baseUrl = getBaseUrl(req);
      if (req.method === 'GET' || req.method === 'OPTIONS') {
        const address = String(url.searchParams.get('address') ?? '').trim();
        if (!address) {
          respondJson(res, 200, {
            type: 'action',
            icon: `${baseUrl}/assets/icon.png`,
            title: 'Attest Your On-Chain Reputation',
            description: 'Record your Identity Prism reputation score permanently on the Solana blockchain. This creates a verifiable, immutable attestation signed by both you and our authority.',
            label: 'Attest Reputation',
            links: {
              actions: [
                {
                  label: 'Attest My Wallet',
                  href: `${baseUrl}/api/actions/attest?address={address}`,
                  parameters: [
                    { name: 'address', label: 'Enter your Solana wallet address', required: true },
                  ],
                },
              ],
            },
          });
          return true;
        }

        try {
          new PublicKey(address);
          const snapshot = await fetchIdentitySnapshot(address);
          respondJson(res, 200, {
            type: 'action',
            icon: `${baseUrl}/api/actions/render?address=${address}&side=front`,
            title: `Attest Score: ${snapshot.identity.score}/1000 — ${snapshot.identity.tier.replace('_', ' ').toUpperCase()}`,
            description: `Badges: ${snapshot.identity.badges.join(', ') || 'none'}. Click to record this reputation permanently on the Solana blockchain.`,
            label: `Attest ${snapshot.identity.score} pts`,
            links: {
              actions: [
                { label: `Attest Score ${snapshot.identity.score}`, href: `${baseUrl}/api/actions/attest?address=${address}` },
              ],
            },
          });
        } catch (error) {
          respondJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid address' });
        }
        return true;
      }

      if (req.method === 'POST') {
        try {
          const body = await readBody(req);
          let payload = {};
          try {
            payload = body ? JSON.parse(body) : {};
          } catch {
            respondJson(res, 400, { error: 'Invalid JSON' });
            return true;
          }

          const account = String(payload.account ?? '').trim();
          const addressParam = String(url.searchParams.get('address') ?? '').trim();
          const address = addressParam || account;
          if (!account) {
            respondJson(res, 400, { error: 'account is required' });
            return true;
          }
          if (!address) {
            respondJson(res, 400, { error: 'address parameter is required' });
            return true;
          }

          let payerKey;
          let walletKey;
          try {
            payerKey = new PublicKey(account);
          } catch {
            respondJson(res, 400, { error: 'Invalid account' });
            return true;
          }
          try {
            walletKey = new PublicKey(address);
          } catch {
            respondJson(res, 400, { error: 'Invalid address' });
            return true;
          }

          const snapshot = await fetchIdentitySnapshot(address);
          const { identity, walletAgeDays, solBalance, txCount, tokenCount, nftCount } = snapshot;
          const attestation = JSON.stringify({
            protocol: 'identity-prism-v1',
            wallet: address,
            score: identity.score,
            tier: identity.tier,
            badges: identity.badges,
            stats: {
              walletAgeDays,
              solBalance: Math.round(solBalance * 1000) / 1000,
              txCount,
              tokenCount,
              nftCount,
            },
            timestamp: Math.floor(Date.now() / 1000),
            authority: treasuryAddress,
          });

          const treasurySecretKey = parseSecretKey(treasurySecret) ?? loadSecretKeyFromFile(treasurySecretPath);
          if (!treasurySecretKey) {
            respondJson(res, 500, { error: 'Attestation authority not configured' });
            return true;
          }
          const treasuryKeypair = Keypair.fromSecretKey(treasurySecretKey);
          const memoInstruction = new TransactionInstruction({
            keys: [
              { pubkey: payerKey, isSigner: true, isWritable: true },
              { pubkey: treasuryKeypair.publicKey, isSigner: true, isWritable: false },
            ],
            programId: memoProgramId,
            data: Buffer.from(attestation, 'utf-8'),
          });
          const connection = new Connection(getRpcUrl(walletKey.toBase58()) || 'https://api.mainnet-beta.solana.com', 'confirmed');
          const latestBlockhash = await connection.getLatestBlockhash('confirmed');
          const transaction = new Transaction().add(memoInstruction);
          transaction.feePayer = payerKey;
          transaction.recentBlockhash = latestBlockhash.blockhash;
          transaction.partialSign(treasuryKeypair);

          respondJson(res, 200, {
            transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
            message: `Reputation attestation: Score ${identity.score}/400, Tier ${identity.tier.replace('_', ' ').toUpperCase()}. This will be permanently recorded on Solana.`,
          });
        } catch (error) {
          console.error('[attest] failed', error);
          respondJson(res, 500, { error: 'Attestation failed' });
        }
        return true;
      }

      respondJson(res, 405, { error: 'Method not allowed' });
      return true;
    }

    return false;
  };
}

export { registerReputationRoute, registerReputationInlineRoute };
