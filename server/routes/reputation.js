import { PublicKey } from '@solana/web3.js';
import { checkApiKey } from '../services/apiKeyMiddleware.js';

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

      const created = submitSybilFeedback({
        targetAddress,
        reportedBy: jwtAuth.address || null,
        reportType,
        notes,
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
      const apiKeyRegistry = new Map(
        (process.env.REPUTATION_API_KEYS || '').split(',').filter(Boolean).map((key) => [key.trim(), true]),
      );
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

export { registerReputationRoute };
