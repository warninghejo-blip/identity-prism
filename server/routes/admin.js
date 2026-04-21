// Admin API routes
// Required env var: ADMIN_KEY — must match X-Admin-Key header.
// If ADMIN_KEY is not set, all admin endpoints return 501 "Admin API not configured".

import crypto from 'crypto';
import { statSync } from 'fs';
import { appDb, APP_DB_PATH } from '../services/appDb.js';

export function registerAdminRoute(ctx) {
  const { core: { ipRateLimit, getClientIp, respondJson, readBody } } = ctx;

  /** Returns true if request is authorised; sends 501/403 and returns false otherwise. */
  function checkAdminKey(req, res) {
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey) {
      respondJson(res, 501, { error: 'Admin API not configured' });
      return false;
    }
    const key = req.headers['x-admin-key'];
    if (!key) {
      respondJson(res, 403, { error: 'Forbidden' });
      return false;
    }
    const buf1 = Buffer.from(key);
    const buf2 = Buffer.from(adminKey);
    if (buf1.length !== buf2.length || !crypto.timingSafeEqual(buf1, buf2)) {
      respondJson(res, 403, { error: 'Forbidden' });
      return false;
    }
    return true;
  }

  return async function handleAdminRoute(req, res, url, pathname) {
    // ── GET /api/admin/sybil/feedback ──────────────────────────────────────
    if (pathname === '/api/admin/sybil/feedback' && req.method === 'GET') {
      if (!ipRateLimit('admin_feedback', getClientIp(req), 20, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      if (!checkAdminKey(req, res)) return true;

      const status = url.searchParams.get('status') ?? 'pending';
      const limit  = Math.min(parseInt(url.searchParams.get('limit')  ?? '50', 10) || 50, 200);
      const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0',  10) || 0, 0);

      let whereClause;
      if (status === 'pending')  whereClause = 'WHERE admin_verified IS NULL';
      else if (status === 'verified')  whereClause = 'WHERE admin_verified = 1';
      else if (status === 'rejected')  whereClause = 'WHERE admin_verified = 0';
      else                             whereClause = '';

      try {
        const { total } = appDb.prepare(
          `SELECT COUNT(*) AS total FROM sybil_feedback ${whereClause}`
        ).get();

        const reports = appDb.prepare(
          `SELECT id, target_address, reported_by, report_type, admin_verified, reported_at, notes
           FROM sybil_feedback ${whereClause}
           ORDER BY reported_at DESC
           LIMIT ? OFFSET ?`
        ).all(limit, offset);

        respondJson(res, 200, { reports, total });
      } catch (err) {
        respondJson(res, 500, { error: 'Database error', detail: err.message });
      }
      return true;
    }

    // ── POST /api/admin/sybil/feedback/:id/verify ─────────────────────────
    const verifyMatch = pathname.match(/^\/api\/admin\/sybil\/feedback\/(\d+)\/verify$/);
    if (verifyMatch && req.method === 'POST') {
      if (!ipRateLimit('admin_feedback_verify', getClientIp(req), 20, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      if (!checkAdminKey(req, res)) return true;

      const id = parseInt(verifyMatch[1], 10);

      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
        return true;
      }

      if (typeof body.verified !== 'boolean') {
        respondJson(res, 400, { error: 'verified must be boolean' });
        return true;
      }

      try {
        const result = appDb.prepare(
          'UPDATE sybil_feedback SET admin_verified = ? WHERE id = ?'
        ).run(body.verified ? 1 : 0, id);

        if (result.changes === 0) {
          respondJson(res, 404, { error: 'Feedback report not found' });
        } else {
          respondJson(res, 200, { ok: true, id, admin_verified: body.verified ? 1 : 0 });
        }
      } catch (err) {
        respondJson(res, 500, { error: 'Database error', detail: err.message });
      }
      return true;
    }

    // ── GET /api/admin/sybil/stats ─────────────────────────────────────────
    if (pathname === '/api/admin/sybil/stats' && req.method === 'GET') {
      if (!ipRateLimit('admin_stats', getClientIp(req), 20, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      if (!checkAdminKey(req, res)) return true;

      try {
        const { totalVerdicts } = appDb.prepare(
          'SELECT COUNT(*) AS totalVerdicts FROM sybil_verdicts'
        ).get();

        const riskRows = appDb.prepare(
          'SELECT risk_level, COUNT(*) AS cnt FROM sybil_verdicts GROUP BY risk_level'
        ).all();
        const riskDistribution = { low: 0, medium: 0, high: 0 };
        for (const row of riskRows) {
          if (row.risk_level in riskDistribution) riskDistribution[row.risk_level] = row.cnt;
        }

        const since24h = Date.now() - 24 * 60 * 60 * 1000;
        const { newScans } = appDb.prepare(
          'SELECT COUNT(*) AS newScans FROM sybil_verdicts WHERE computed_at > ? AND scan_version = 1'
        ).get(since24h);
        const { incrementalRescans } = appDb.prepare(
          'SELECT COUNT(*) AS incrementalRescans FROM sybil_verdicts WHERE computed_at > ? AND scan_version > 1'
        ).get(since24h);
        const { falsePositivesReported } = appDb.prepare(
          'SELECT COUNT(*) AS falsePositivesReported FROM sybil_feedback WHERE reported_at > ?'
        ).get(since24h);

        const { totalClusters } = appDb.prepare(
          'SELECT COUNT(*) AS totalClusters FROM sybil_clusters'
        ).get();
        const methodRows = appDb.prepare(
          'SELECT detection_method, COUNT(*) AS cnt FROM sybil_clusters GROUP BY detection_method'
        ).all();
        const byMethod = {};
        for (const row of methodRows) byMethod[row.detection_method] = row.cnt;

        const { temporalCohorts } = appDb.prepare(
          'SELECT COUNT(*) AS temporalCohorts FROM sybil_temporal_cohorts'
        ).get();

        const { fundingEdges } = appDb.prepare(
          'SELECT COUNT(*) AS fundingEdges FROM sybil_funding_edges'
        ).get();

        let sqliteSize = 'unknown';
        try {
          const stat = statSync(APP_DB_PATH);
          sqliteSize = (stat.size / (1024 * 1024)).toFixed(2) + ' MB';
        } catch { /* ignore */ }

        const lastCluster = appDb.prepare(
          "SELECT MAX(detected_at) AS last FROM sybil_clusters WHERE detection_method = 'louvain'"
        ).get();
        const lastLouvainRun = lastCluster?.last ? new Date(lastCluster.last).toISOString() : null;

        const inMemory = ctx.sybilCache ? ctx.sybilCache.size : 0;

        respondJson(res, 200, {
          totalVerdicts,
          riskDistribution,
          last24h: { newScans, incrementalRescans, falsePositivesReported },
          clusters: { total: totalClusters, byMethod },
          temporalCohorts,
          fundingEdges,
          cacheStats: { inMemory, sqliteHits: 'TBD' },
          sqliteSize,
          lastLouvainRun,
        });
      } catch (err) {
        respondJson(res, 500, { error: 'Database error', detail: err.message });
      }
      return true;
    }

    return false;
  };
}
