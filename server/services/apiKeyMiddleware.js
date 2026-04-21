// Partner API key middleware — tiered quota enforcement
import { appDb } from './appDb.js';
import { ipRateLimit } from '../utils/ipRateLimit.js';

const TIER_LIMITS = {
  free:       { daily: 100,      perMinute: 10 },
  pro:        { daily: 10000,    perMinute: 100 },
  enterprise: { daily: Infinity, perMinute: 1000 },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

/**
 * checkApiKey(respondJson, req, res)
 * Returns { ok: true, tier: null } if no key provided (fall through to public rate limiting).
 * Returns { ok: false } if key is invalid/revoked/quota exceeded (response already sent).
 * Returns { ok: true, tier: string, remaining: number|null } on success.
 */
async function checkApiKey(respondJson, req, res) {
  const key = req.headers['x-api-key'];
  if (!key) return { ok: true, tier: null };

  // Look up key — must exist and not be revoked
  const row = appDb.prepare(
    'SELECT * FROM api_keys WHERE key = ? AND revoked_at IS NULL'
  ).get(key);

  if (!row) {
    respondJson(res, 401, { error: 'Invalid API key' });
    return { ok: false };
  }

  const limits = TIER_LIMITS[row.tier] || TIER_LIMITS.free;
  const day = todayStr();

  // Check daily quota (skip for enterprise/unlimited)
  let used = 0;
  if (limits.daily !== Infinity) {
    const usageRow = appDb.prepare(
      'SELECT count FROM api_key_usage WHERE key = ? AND day = ?'
    ).get(key, day);
    used = usageRow ? usageRow.count : 0;
    if (used >= limits.daily) {
      respondJson(res, 429, { error: 'Daily quota exceeded' });
      return { ok: false };
    }
  }

  // Check per-minute rate limit via existing ipRateLimit utility
  // ipRateLimit(prefix, ip, maxReqs, windowMs) → true=allowed, false=blocked
  const allowed = ipRateLimit('apikey', key, limits.perMinute, 60000);
  if (!allowed) {
    respondJson(res, 429, { error: 'Rate limit exceeded' });
    return { ok: false };
  }

  // Increment daily usage counter
  appDb.prepare(`
    INSERT INTO api_key_usage (key, day, count) VALUES (?, ?, 1)
    ON CONFLICT(key, day) DO UPDATE SET count = count + 1
  `).run(key, day);

  // Update last_used_at timestamp
  appDb.prepare(
    'UPDATE api_keys SET last_used_at = ? WHERE key = ?'
  ).run(Date.now(), key);

  const remaining = limits.daily === Infinity ? null : limits.daily - used - 1;
  return { ok: true, tier: row.tier, remaining };
}

export { checkApiKey };
