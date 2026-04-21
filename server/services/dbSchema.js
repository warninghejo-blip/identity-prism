import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(SERVICES_DIR, '..');
const DATA_DIR = path.join(SERVER_DIR, 'data');

const getAppDbPath = () => (
  process.env.APP_DB_PATH
    ? path.resolve(process.env.APP_DB_PATH)
    : path.join(DATA_DIR, 'app.db')
);

function ensureAppDbDirectory(dbPath = getAppDbPath()) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return dbPath;
}

function initAppDbSchema(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coin_balances (
      address TEXT PRIMARY KEY,
      balance INTEGER NOT NULL,
      earned INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS score_history (
      address TEXT NOT NULL,
      entry_idx INTEGER NOT NULL,
      score INTEGER NOT NULL,
      tier TEXT,
      date TEXT,
      PRIMARY KEY (address, entry_idx)
    );

    CREATE TABLE IF NOT EXISTS achievements (
      address TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revives (
      address TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quest_progress (
      address TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tournaments (
      tier TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      address TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS minted_addresses (
      address TEXT PRIMARY KEY
    );

     CREATE TABLE IF NOT EXISTS game_session_proofs (
       session_id TEXT PRIMARY KEY,
       data TEXT NOT NULL
     );

     CREATE TABLE IF NOT EXISTS sybil_verdicts (
       address TEXT PRIMARY KEY,
       score INTEGER,
       risk_level TEXT,
       confidence REAL,
       signals_json TEXT,
       analysis_json TEXT NOT NULL,
       funding_sources_json TEXT,
       last_seen_signature TEXT,
       first_seen_signature TEXT,
       estimated_tx_count INTEGER,
       computed_at INTEGER,
       ttl_expires_at INTEGER,
       scan_version INTEGER DEFAULT 1
     );

     CREATE INDEX IF NOT EXISTS idx_verdicts_computed
     ON sybil_verdicts (computed_at);

     CREATE INDEX IF NOT EXISTS idx_verdicts_risk
     ON sybil_verdicts (risk_level, computed_at);
 
     PRAGMA user_version = 1;
   `);
 }

export {
  DATA_DIR,
  SERVER_DIR,
  ensureAppDbDirectory,
  getAppDbPath,
  initAppDbSchema,
};
