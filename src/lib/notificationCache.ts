export interface CachedNotification {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  read: boolean;
  meta?: Record<string, unknown>;
}

const NOTIFICATION_CACHE_PREFIX = 'ip_notifications_cache_v1:';
const NOTIFICATION_CACHE_TTL_MS = 5 * 60 * 1000;

const cacheKey = (address: string) => `${NOTIFICATION_CACHE_PREFIX}${address}`;

export function readCachedNotifications(address: string): CachedNotification[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(address)) || localStorage.getItem(cacheKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; notifications?: CachedNotification[] };
    if (!parsed.ts || Date.now() - parsed.ts > NOTIFICATION_CACHE_TTL_MS) return null;
    return Array.isArray(parsed.notifications) ? parsed.notifications : null;
  } catch {
    return null;
  }
}

export function writeCachedNotifications(address: string, notifications: CachedNotification[]): void {
  const raw = JSON.stringify({ ts: Date.now(), notifications });
  try {
    sessionStorage.setItem(cacheKey(address), raw);
  } catch {
    // Storage can be unavailable in privacy modes; the live request still owns correctness.
  }
  try {
    localStorage.setItem(cacheKey(address), raw);
  } catch {
    // Storage can be unavailable in privacy modes; the live request still owns correctness.
  }
}

export function clearCachedNotifications(address: string): void {
  try {
    sessionStorage.removeItem(cacheKey(address));
  } catch {
    // ignore storage cleanup failures
  }
  try {
    localStorage.removeItem(cacheKey(address));
  } catch {
    // ignore storage cleanup failures
  }
}
