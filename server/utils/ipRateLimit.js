// Generic per-IP rate limiter: returns true if allowed, false if rate-limited
const _ipRateLimits = new Map(); // key: `${prefix}:${ip}` → { count, resetAt }

function ipRateLimit(prefix, ip, maxReqs, windowMs) {
  const key = `${prefix}:${ip}`;
  const now = Date.now();
  let entry = _ipRateLimits.get(key);
  if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + windowMs }; _ipRateLimits.set(key, entry); }
  if (++entry.count > maxReqs) return false;
  // Periodic cleanup (every 10k entries)
  if (_ipRateLimits.size > 10000) { for (const [k, v] of _ipRateLimits) { if (now > v.resetAt) _ipRateLimits.delete(k); } }
  return true;
}

export { ipRateLimit };
