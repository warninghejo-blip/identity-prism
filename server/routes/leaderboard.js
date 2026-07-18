import { getScoreCeiling } from '../services/gameRules.js';

function registerLeaderboardRoute(ctx) {
  const {
    core: {
      respondJson,
      ipRateLimit,
      getClientIp,
      requireJwt,
      readBody,
    },
    wallet: {
      leaderboardEntries,
      submitLeaderboardEntry,
      gameSessionProofs,
      persistGameSessionProofs,
      triggerCompositeUpdate,
      toCanonGameMode,
      leaderboardCacheRef,
      leaderboardCacheTimeRef,
    },
    economy: {
      invalidateQuestProgressCache = () => {},
    } = {},
  } = ctx;

  return async function handleLeaderboardRoute(req, res, url, pathname) {
    if (pathname === '/api/game/leaderboard' && req.method === 'GET') {
      if (!ipRateLimit('lb_get', getClientIp(req), 60, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const gameTypeFilter = url.searchParams.get('gameType') || '';
      const cacheKey = `lb:${gameTypeFilter}`;
      if (leaderboardCacheRef.value && leaderboardCacheRef.value.key === cacheKey && Date.now() - leaderboardCacheTimeRef.value < 10_000) {
        respondJson(res, 200, leaderboardCacheRef.value.data);
        return true;
      }
      const canonFilter = toCanonGameMode(gameTypeFilter) || gameTypeFilter;
      const filtered = canonFilter
        ? leaderboardEntries.filter(e => (toCanonGameMode(e.gameType) || e.gameType || 'orbit') === canonFilter)
        : leaderboardEntries;
      const data = { entries: filtered.slice(0, 50) };
      leaderboardCacheRef.value = { key: cacheKey, data };
      leaderboardCacheTimeRef.value = Date.now();
      respondJson(res, 200, data);
      return true;
    }

    if (pathname === '/api/game/leaderboard' && req.method === 'POST') {
      if (!ipRateLimit('lb_post', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw);
        const { address: bodyAddress, score, txSignature, gameType, gameSessionId } = parsed;
        const playedAt = new Date().toISOString(); // server-authoritative timestamp
        const address = jwtAuth.address;
        if (bodyAddress && bodyAddress !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
        // score === 0 is a legitimate outcome (e.g. gravity's "columns passed" score is
        // commonly 0 on a fast death) and must still be recorded — only reject negative/NaN.
        if (!address || typeof address !== 'string' || typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
          respondJson(res, 400, { error: 'Invalid entry: address (string) and score (number >= 0) required' });
          return true;
        }
        // Require game session proof for leaderboard submit
        if (!gameSessionId) return respondJson(res, 400, { error: 'gameSessionId required for leaderboard' });
        const session = gameSessionProofs.get(gameSessionId);
        if (!session || !session.verified || !session.sessionTokenId || session.timingVerified !== true || session.economyEligible !== true || session.competitiveEligible !== true) {
          return respondJson(res, 400, { error: 'Token-backed, timing-verified game session required' });
        }
        if (session.walletAddress !== address) return respondJson(res, 403, { error: 'Session wallet mismatch' });
        if (session.score !== score) return respondJson(res, 400, { error: 'Score does not match session proof' });
        // Require gameType and enforce exact match
        if (!gameType) return respondJson(res, 400, { error: 'gameType required' });
        if (session.gameMode !== gameType) return respondJson(res, 400, { error: 'Session gameMode mismatch' });
        if (session.usedForLeaderboard) return respondJson(res, 400, { error: 'Session already used for leaderboard' });
        const scoreCeiling = Number(session.scoreCeiling);
        if (!Number.isFinite(scoreCeiling) || scoreCeiling !== getScoreCeiling(session.gameMode, session.durationMs) || score > scoreCeiling) {
          respondJson(res, 400, { error: 'Score exceeds maximum allowed' });
          return true;
        }
        // Mark session used AFTER all validation passes
        session.usedForLeaderboard = { address, at: Date.now() };
        persistGameSessionProofs();
        const result = submitLeaderboardEntry({ address, score, playedAt, txSignature, gameType });
        leaderboardCacheRef.value = null;
        leaderboardCacheTimeRef.value = 0;
        invalidateQuestProgressCache(address);
        triggerCompositeUpdate(address);
        const gt = gameType || 'orbit';
        const filtered = leaderboardEntries.filter(e => (e.gameType || 'orbit') === gt);
        respondJson(res, 200, { entry: result, leaderboard: filtered.slice(0, 50) });
      } catch (error) {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      }
      return true;
    }

    return false;
  };
}

export { registerLeaderboardRoute };
