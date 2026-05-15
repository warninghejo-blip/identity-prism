import { appDb } from '../services/appDb.js';

const CACHE_TTL_MS = 30_000;
let cached = null;

function count(db, sql) {
  const row = db.prepare(sql).get();
  return Number(row?.c ?? 0);
}

function buildStats() {
  return {
    idsMinted: count(appDb, 'SELECT COUNT(*) AS c FROM minted_addresses'),
    walletsScanned: count(appDb, 'SELECT COUNT(*) AS c FROM sybil_verdicts'),
    sybilsCaught: count(appDb, "SELECT COUNT(*) AS c FROM sybil_verdicts WHERE risk_level IN ('high','critical')"),
    sybilsReported: count(appDb, 'SELECT COUNT(*) AS c FROM sybil_feedback WHERE admin_verified = 1'),
    blackHoleOps: count(appDb, 'SELECT COUNT(*) AS c FROM black_hole_signatures'),
    clusters: count(appDb, 'SELECT COUNT(*) AS c FROM sybil_clusters'),
    updatedAt: new Date().toISOString(),
    cacheTtlSec: 30,
  };
}

function getStats() {
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const value = buildStats();
  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

function registerStatsRoute(ctx) {
  const { ipRateLimit, getClientIp, respondJson } = ctx.core;

  return async function handleStatsRoute(req, res, _url, pathname) {
    if (pathname !== '/api/stats/global' || req.method !== 'GET') return false;
    if (!ipRateLimit('stats_global', getClientIp(req), 60, 60_000)) {
      respondJson(res, 429, { error: 'rate_limited' });
      return true;
    }
    try {
      res.setHeader('Cache-Control', 'public, max-age=30');
      respondJson(res, 200, getStats());
    } catch (error) {
      console.error('[stats/global]', error);
      respondJson(res, 500, { error: 'internal' });
    }
    return true;
  };
}

export { registerStatsRoute };
