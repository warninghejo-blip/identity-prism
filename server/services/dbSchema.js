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

     CREATE TABLE IF NOT EXISTS sybil_funding_edges (
       from_address TEXT,
       to_address TEXT,
       token_mint TEXT,
       total_amount REAL,
       tx_count INTEGER,
       first_seen_at INTEGER,
       last_seen_at INTEGER,
       chain_depth INTEGER,
       PRIMARY KEY (from_address, to_address, token_mint)
     );

     CREATE INDEX IF NOT EXISTS idx_funding_edges_to
     ON sybil_funding_edges (to_address);

     CREATE INDEX IF NOT EXISTS idx_funding_edges_from
     ON sybil_funding_edges (from_address);

     CREATE TABLE IF NOT EXISTS sybil_clusters (
       cluster_id TEXT PRIMARY KEY,
       size INTEGER,
       detection_method TEXT,
       confidence REAL,
       detected_at INTEGER,
       last_updated_at INTEGER
     );

     CREATE TABLE IF NOT EXISTS sybil_cluster_members (
       cluster_id TEXT,
       address TEXT,
       PRIMARY KEY (cluster_id, address)
     );

     CREATE TABLE IF NOT EXISTS sybil_temporal_cohorts (
       cohort_id TEXT PRIMARY KEY,
       first_wallet_at INTEGER,
       window_end_at INTEGER,
       wallet_count INTEGER,
       similarity_score REAL,
       first_common_funder TEXT
     );

     CREATE INDEX IF NOT EXISTS idx_temporal_window
     ON sybil_temporal_cohorts (first_wallet_at);

     CREATE TABLE IF NOT EXISTS sybil_feedback (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       target_address TEXT,
       reported_by TEXT,
       report_type TEXT,
       admin_verified INTEGER,
       reported_at INTEGER,
       notes TEXT
     );

     CREATE INDEX IF NOT EXISTS idx_feedback_target
     ON sybil_feedback (target_address);

     CREATE INDEX IF NOT EXISTS idx_feedback_reported
     ON sybil_feedback (reported_at);

     CREATE TABLE IF NOT EXISTS sybil_verdict_history (
       address TEXT,
       version INTEGER,
       score INTEGER,
       risk_level TEXT,
       signals_json TEXT,
       computed_at INTEGER,
       PRIMARY KEY (address, computed_at)
     );

      CREATE INDEX IF NOT EXISTS idx_history_address
      ON sybil_verdict_history (address, computed_at);

      CREATE TABLE IF NOT EXISTS scheduler_job_runs (
        job_name TEXT PRIMARY KEY,
        last_run_at INTEGER,
        last_status TEXT,
        summary_json TEXT,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        key TEXT PRIMARY KEY,
        owner_name TEXT,
        contact_email TEXT,
        tier TEXT NOT NULL,
        created_at INTEGER,
        revoked_at INTEGER,
        last_used_at INTEGER,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_tier ON api_keys(tier, revoked_at);

      CREATE TABLE IF NOT EXISTS api_key_usage (
        key TEXT,
        day TEXT,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (key, day)
      );
      CREATE INDEX IF NOT EXISTS idx_api_usage_day ON api_key_usage(day);

      CREATE TABLE IF NOT EXISTS black_hole_signatures (
        signature TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_bh_signatures_wallet
      ON black_hole_signatures (wallet, created_at);

      PRAGMA user_version = 2;
     `);
  }

export {
  DATA_DIR,
  SERVER_DIR,
  ensureAppDbDirectory,
  getAppDbPath,
  initAppDbSchema,
};
