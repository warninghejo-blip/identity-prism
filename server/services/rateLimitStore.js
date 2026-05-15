import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SERVICES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(SERVICES_DIR, '..');
const DATA_DIR = path.join(SERVER_DIR, 'data');
const DB_PATH = process.env.RATE_LIMIT_DB_PATH
  ? path.resolve(process.env.RATE_LIMIT_DB_PATH)
  : path.join(DATA_DIR, 'ratelimit.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at
  ON rate_limits (expires_at);
`);

const cache = new Map();

const selectStmt = db.prepare(`
  SELECT value, expires_at
  FROM rate_limits
  WHERE key = ?
`);
const upsertStmt = db.prepare(`
  INSERT INTO rate_limits (key, value, expires_at)
  VALUES (@key, @value, @expires_at)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    expires_at = excluded.expires_at
`);
const deleteStmt = db.prepare(`
  DELETE FROM rate_limits
  WHERE key = ?
`);
const deleteExpiredStmt = db.prepare(`
  DELETE FROM rate_limits
  WHERE expires_at <= ?
`);

const pruneCache = (now = Date.now()) => {
  for (const [key, entry] of cache) {
    if (!entry || now >= entry.expiresAt) cache.delete(key);
  }
  if (cache.size > 5000) {
    const overflow = cache.size - 5000;
    const keys = cache.keys();
    for (let index = 0; index < overflow; index += 1) {
      const next = keys.next();
      if (next.done) break;
      cache.delete(next.value);
    }
  }
};

const parseRowValue = (row) => {
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
};

export const rateLimitCache = cache;

export const rateLimitStore = {
  cache,
  get(key) {
    const now = Date.now();
    const cached = cache.get(key);
    if (cached) {
      if (now >= cached.expiresAt) {
        cache.delete(key);
        deleteStmt.run(key);
        return undefined;
      }
      return cached.value;
    }

    const row = selectStmt.get(key);
    if (!row) return undefined;
    if (now >= row.expires_at) {
      deleteStmt.run(key);
      return undefined;
    }

    const value = parseRowValue(row);
    if (value === undefined) {
      deleteStmt.run(key);
      return undefined;
    }

    cache.set(key, { value, expiresAt: row.expires_at });
    pruneCache(now);
    return value;
  },
  set(key, value, ttlSeconds = 86400) {
    const ttlMs = Math.max(1, Math.floor(Number(ttlSeconds) || 0)) * 1000;
    const expiresAt = Date.now() + ttlMs;
    const serialized = JSON.stringify(value);
    cache.set(key, { value, expiresAt });
    pruneCache();
    upsertStmt.run({ key, value: serialized, expires_at: expiresAt });
  },
  delete(key) {
    cache.delete(key);
    deleteStmt.run(key);
  },
  cleanup() {
    const now = Date.now();
    pruneCache(now);
    deleteExpiredStmt.run(now);
  },
};

rateLimitStore.cleanup();
