import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from './utils/solanaToken.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createNoopSigner,
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  publicKey,
} from '@metaplex-foundation/umi';
import { create, fetchCollection, fetchAsset, mplCore, burnV1, updateV1 } from '@metaplex-foundation/mpl-core';
import { getToday } from './utils/date.js';
import { toWeb3JsInstruction, toWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import { createRequire } from 'node:module';
import { calculateBlackHoleReward } from './services/blackHoleRewards.js';
import { JWT_TTL, createAuthServices, createJwt, verifyJwt } from './services/auth.js';
import { calculateIdentity } from './services/scoring.js';
import {
  loadAchievementData,
  loadChallenges,
  loadGameSessionProofs,
  loadNotifications,
  loadQuestProgress,
  loadReviveData,
  loadTournaments,
} from './services/loaders.js';
import { appDb } from './services/appDb.js';
import { DataStore } from './services/datastore.js';
import { createPersistenceServices } from './services/persistence.js';
import { createReputationBuilderService } from './services/reputationBuilder.js';
import { startSchedulers } from './services/scheduler.js';
import { buildDeterministicClusterId, upsertSybilClusterWithMembers } from './services/sybilClusterStore.js';
import { createSybilClusterService } from './services/sybilCluster.js';
import { createInitOrchestrator } from './services/initOrchestrator.js';
import { createBlackHoleSignatureStore } from './services/blackHoleSignatureStore.js';
import { createBlackHoleTxVerifier } from './services/blackHoleTx.js';
import {
  STAKING_TIERS,
  getLockTier,
  calcDailyYieldForAmount,
  getEffectiveRate,
  getRateSchedule,
  calcUnclaimedYield as rawCalcUnclaimedYield,
} from './services/yieldMath.js';
import { createHeliusEnhancedService, pickHeliusKey } from './services/heliusEnhanced.js';
import {
  buildIdentityHolderPerks,
  GAME_SESSION_ONCHAIN_BONUS_MULTIPLIER,
  normalizeGameCoinDeltaForCap,
} from './services/identityPerks.js';
import {
  PRISM_EARN_MAX_PER_CALL,
  applyStakingBoostAfterCap,
  canAwardQuizReward,
  getHolderAdjustedCap,
} from './services/economyRules.js';
import { calculateCompositeScore } from './services/compositeScore.js';
import { rateLimitCache, rateLimitStore } from './services/rateLimitStore.js';
import { getCompositeTrustProfile, getSybilQuickVerdict, getSybilRewardPath, getSybilVerdict } from './services/sybilVerdict.js';

// Load tweetnacl at module level (used by verifyWalletSignature as fallback)
let _naclInstance = null;
try { _naclInstance = createRequire(import.meta.url)('tweetnacl'); } catch { /* tweetnacl not available */ }
import {
  initFirebase,
  isAvailable as fbAvailable,
  setDoc as fbSet,
  getDoc as fbGet,
  getAllDocs as fbGetAll,
  batchSet as fbBatchSet,
} from './services/firebase.js';
import { createContext } from './context.js';
import { createLeaderboardStoreFromContext } from './data/leaderboards.js';
import { createMintedAddressesStoreFromContext } from './data/mintedAddresses.js';
import { createScoreHistoryStoreFromContext } from './data/scoreHistory.js';
import { KNOWN_LABELS, TREASURY_WALLETS } from './constants/labels.js';
import { registerAuthRoute } from './routes/auth.js';
import { registerArenaRoute } from './routes/arena.js';
import { registerBuyRoute } from './routes/buy.js';
import { registerBlackholeRoute } from './routes/blackhole.js';
import { registerEarnRoute } from './routes/earn.js';
import { registerHealthRoute } from './routes/health.js';
import { registerGameRoute, registerGameV1Route } from './routes/game.js';
import { registerLeaderboardRoute } from './routes/leaderboard.js';
import { registerMarketRoute } from './routes/market.js';
import { registerDiscoveryRoute } from './routes/discovery.js';
import { registerNotificationsRoute } from './routes/notifications.js';
import { registerQuestRoute } from './routes/quest.js';
import { registerQuizRoute } from './routes/quiz.js';
import { registerBlinksRoute } from './routes/blinks.js';
import { registerReputationInlineRoute, registerReputationRoute } from './routes/reputation.js';
import { registerTournamentRoute } from './routes/tournament.js';
import { registerVaultRoute } from './routes/vault.js';
import { registerWalletRoute } from './routes/wallet.js';
import { registerAdminRoute } from './routes/admin.js';
import { registerMetadataRoute } from './routes/metadata.js';
import { registerSpendRoute } from './routes/spend.js';
import { registerSybilRoute } from './routes/sybil.js';
import { registerUserDataRoute } from './routes/userData.js';
import { registerUtilityRoute } from './routes/utility.js';
import { formatActionAddress, isFungibleAsset } from './utils/formatters.js';
import { TRUSTED_PROXIES, getClientIp } from './utils/getClientIp.js';
import { ipRateLimit } from './utils/ipRateLimit.js';
import { readBody } from './utils/readBody.js';
import { respondJson } from './utils/respondJson.js';
import { extractSolTransfers, isProgramAddress, resolveAccountKey } from './utils/txHelpers.js';
import * as Sentry from '@sentry/node';

const loadEnvFile = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const splitIndex = trimmed.indexOf('=');
      if (splitIndex <= 0) return;
      const key = trimmed.slice(0, splitIndex).trim();
      if (!key || process.env[key] !== undefined) return;
      let value = trimmed.slice(splitIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    });
  } catch {
    // ignore missing env file
  }
};

const SOL_PRICE_TTL_MS = 60 * 1000;
let solPriceCache = { value: null, timestamp: 0 };
const SKR_PRICE_TTL_MS = 60 * 1000;
let skrPriceCache = { value: null, timestamp: 0 };

let _solPriceInflight = null;
const getCachedSolPriceUsd = async () => {
  const now = Date.now();
  if (solPriceCache.value && now - solPriceCache.timestamp < SOL_PRICE_TTL_MS) {
    return solPriceCache.value;
  }
  if (_solPriceInflight) return _solPriceInflight;
  _solPriceInflight = fetchSolPriceUsd().then(price => {
    if (price) solPriceCache = { value: price, timestamp: Date.now() };
    _solPriceInflight = null;
    return price;
  }).catch(e => { _solPriceInflight = null; throw e; });
  return _solPriceInflight;
};

let _skrPriceInflight = null;
const getCachedSkrPriceUsd = async () => {
  const now = Date.now();
  if (skrPriceCache.value && now - skrPriceCache.timestamp < SKR_PRICE_TTL_MS) {
    return skrPriceCache.value;
  }
  if (_skrPriceInflight) return _skrPriceInflight;
  _skrPriceInflight = fetchSkrPriceUsd().then(price => {
    if (price) skrPriceCache = { value: price, timestamp: Date.now() };
    _skrPriceInflight = null;
    return price;
  }).catch(e => { _skrPriceInflight = null; throw e; });
  return _skrPriceInflight;
};

loadEnvFile(process.env.ENV_PATH ?? path.join(process.cwd(), '.env'));
initFirebase();

// Sentry — optional, enabled only when SENTRY_DSN is set
const SENTRY_DSN = process.env.SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV || 'staging',
    release: process.env.RELEASE || 'unknown',
    integrations: [
      Sentry.httpIntegration(),
      Sentry.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: false }),
    ],
  });
  console.log('[sentry] initialized');
}

const PORT = Number(process.env.PORT ?? 3000);
const HOST = (process.env.HOST ?? '0.0.0.0').trim() || '0.0.0.0';
const HELIUS_RPC_BASE = (process.env.HELIUS_RPC_BASE ?? 'https://mainnet.helius-rpc.com/').trim();
const HELIUS_KEYS = (process.env.HELIUS_API_KEYS ?? process.env.HELIUS_API_KEY ?? '')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);
const ALCHEMY_RPC_URL = (process.env.ALCHEMY_RPC_URL ?? '').trim();
const FALLBACK_RPC_URL = (process.env.FALLBACK_RPC_URL ?? 'https://api.mainnet-beta.solana.com').trim();
const DAS_METHODS = new Set([
  'getAssetsByOwner', 'getAsset', 'getAssetBatch', 'getAssetProof', 'getAssetProofBatch',
  'getAssetsByGroup', 'getAssetsByCreator', 'getAssetsByAuthority', 'searchAssets',
  'getSignaturesForAsset', 'getTokenAccounts', 'getNftEditions',
]);
const STANDARD_RPC_METHODS = new Set([
  'getAccountInfo', 'getBalance', 'getBlockHeight', 'getBlockTime', 'getClusterNodes',
  'getEpochInfo', 'getFeeForMessage', 'getFirstAvailableBlock', 'getGenesisHash',
  'getHealth', 'getIdentity', 'getLatestBlockhash', 'getLeaderSchedule',
  'getMinimumBalanceForRentExemption', 'getMultipleAccounts', 'getProgramAccounts',
  'getRecentPerformanceSamples', 'getSignaturesForAddress', 'getSignatureStatuses',
  'getSlot', 'getSlotLeader', 'getSupply', 'getTokenAccountBalance',
  'getTokenAccountsByOwner', 'getTokenLargestAccounts', 'getTokenSupply',
  'getTransaction', 'getVersion', 'isBlockhashValid', 'sendTransaction',
  'simulateTransaction',
]);
const RPC_METHODS = new Set([...DAS_METHODS, ...STANDARD_RPC_METHODS]);
const RPC_PROXY_TOKEN = (process.env.RPC_PROXY_TOKEN ?? '').trim();
const DEFAULT_CORS_ORIGINS = [
  'https://identityprism.xyz',
  'https://staging.identityprism.xyz',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
];
const CORS_ORIGIN = [
  ...String(process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin && origin !== '*'),
  ...DEFAULT_CORS_ORIGINS,
].filter((origin, index, all) => all.indexOf(origin) === index).join(',');

const walletIpLog = new Map(); // address → Set of IPs seen
const METADATA_DIR = process.env.METADATA_DIR
  ? path.resolve(process.env.METADATA_DIR)
  : path.join(process.cwd(), 'metadata');
const ASSETS_DIR = path.join(METADATA_DIR, 'assets');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? '').trim();
const COLLECTION_AUTHORITY_SECRET = (process.env.COLLECTION_AUTHORITY_SECRET ?? '').trim();
const TREASURY_SECRET = (process.env.TREASURY_SECRET ?? '').trim();
const TREASURY_SECRET_PATH = (process.env.TREASURY_SECRET_PATH ?? path.join(process.cwd(), 'keys', 'treasury.json')).trim();
const CORE_COLLECTION = (process.env.CORE_COLLECTION ?? '').trim();
const TREASURY_ADDRESS = (process.env.TREASURY_ADDRESS ?? '').trim();
const MINT_PRICE_SOL_RAW = Number(process.env.MINT_PRICE_SOL ?? '0.03');
const MINT_PRICE_SOL = Number.isFinite(MINT_PRICE_SOL_RAW) && MINT_PRICE_SOL_RAW > 0
  ? MINT_PRICE_SOL_RAW
  : 0.01;
const SKR_MINT = (process.env.SKR_MINT ?? 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3').trim();
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const TRACKED_FUNDING_TOKEN_MINTS = new Map([
  [USDC_MINT, 'USDC'],
  [USDT_MINT, 'USDT'],
  [SKR_MINT, 'SKR'],
]);
const STABLECOIN_FUNDING_MINTS = new Set([USDC_MINT, USDT_MINT]);
const SKR_DISCOUNT = Number(process.env.SKR_DISCOUNT ?? '0');
const SKR_DISCOUNT_RATE = Number.isFinite(SKR_DISCOUNT) && SKR_DISCOUNT >= 0 ? SKR_DISCOUNT : 0;
const LAMPORTS_PER_SOL = 1_000_000_000;
const MAX_SIGNATURE_PAGES = Number(process.env.MAX_SIGNATURE_PAGES ?? '15');
const SIGNATURE_PAGE_LIMIT = 1000;
const MAGICBLOCK_RPC = (process.env.MAGICBLOCK_RPC ?? 'https://devnet.magicblock.app/api').trim();
const GAME_SESSION_TTL_RAW = Number(process.env.GAME_SESSION_TTL_MS ?? String(7 * 24 * 60 * 60 * 1000));
const GAME_SESSION_TTL_MS = Number.isFinite(GAME_SESSION_TTL_RAW) && GAME_SESSION_TTL_RAW > 0
  ? GAME_SESSION_TTL_RAW
  : 7 * 24 * 60 * 60 * 1000;
const GAME_SESSION_STORE_FILE = process.env.GAME_SESSION_STORE_FILE
  ? path.resolve(process.env.GAME_SESSION_STORE_FILE)
  : path.join(METADATA_DIR, 'game-session-proofs.json');
const LEADERBOARD_STORE_FILE = process.env.LEADERBOARD_STORE_FILE
  ? path.resolve(process.env.LEADERBOARD_STORE_FILE)
  : path.join(METADATA_DIR, 'leaderboard.json');
const LEADERBOARD_MAX_ENTRIES = 100;
const COIN_BALANCE_META_KEY = '__meta__:totalBurned';
const TOURNAMENT_HISTORY_KEY = '__history__';
const TOURNAMENT_META_KEY = '__meta__';
const parseJsonText = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const createJsonColumnStore = ({
  jsonPath,
  tableName,
  keyColumn,
  primaryKey = keyColumn,
  readJson,
  writeJson,
  debounceMs = 500,
  logLabel = tableName,
  persistUpdatedAt = false,
}) => {
  const selectOne = appDb.prepare(`SELECT data FROM ${tableName} WHERE ${keyColumn} = ?`);
  const selectAll = appDb.prepare(`SELECT ${keyColumn} AS entry_key, data FROM ${tableName}`);
  const countRows = appDb.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`);
  const clearRows = appDb.prepare(`DELETE FROM ${tableName}`);
  const deleteRow = appDb.prepare(`DELETE FROM ${tableName} WHERE ${keyColumn} = ?`);
  const upsertRow = persistUpdatedAt
    ? appDb.prepare(`
        INSERT INTO ${tableName} (${keyColumn}, data, updated_at)
        VALUES (@entry_key, @data, @updated_at)
        ON CONFLICT(${primaryKey}) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at
      `)
    : appDb.prepare(`
        INSERT INTO ${tableName} (${keyColumn}, data)
        VALUES (@entry_key, @data)
        ON CONFLICT(${primaryKey}) DO UPDATE SET
          data = excluded.data
      `);

  return new DataStore({
    db: appDb,
    jsonPath,
    tableName,
    primaryKey,
    readJson,
    writeJson,
    listSqlEntries: () => selectAll.all().map((row) => [row.entry_key, parseJsonText(row.data)]),
    getSqlValue: (key) => {
      const row = selectOne.get(key);
      return row ? parseJsonText(row.data) : undefined;
    },
    upsertSqlValue: (key, value) => {
      const payload = {
        entry_key: key,
        data: JSON.stringify(value),
      };
      if (persistUpdatedAt) payload.updated_at = Date.now();
      upsertRow.run(payload);
    },
    deleteSqlValue: (key) => deleteRow.run(key),
    clearSql: () => clearRows.run(),
    countSql: () => countRows.get().count,
    debounceMs,
    logLabel,
  });
};

const createPresenceStore = ({
  jsonPath,
  tableName,
  keyColumn,
  readJson,
  writeJson,
  debounceMs = 500,
  logLabel = tableName,
}) => {
  const selectOne = appDb.prepare(`SELECT ${keyColumn} AS entry_key FROM ${tableName} WHERE ${keyColumn} = ?`);
  const selectAll = appDb.prepare(`SELECT ${keyColumn} AS entry_key FROM ${tableName}`);
  const countRows = appDb.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`);
  const clearRows = appDb.prepare(`DELETE FROM ${tableName}`);
  const deleteRow = appDb.prepare(`DELETE FROM ${tableName} WHERE ${keyColumn} = ?`);
  const upsertRow = appDb.prepare(`
    INSERT INTO ${tableName} (${keyColumn})
    VALUES (?)
    ON CONFLICT(${keyColumn}) DO NOTHING
  `);

  return new DataStore({
    db: appDb,
    jsonPath,
    tableName,
    primaryKey: keyColumn,
    readJson,
    writeJson,
    listSqlEntries: () => selectAll.all().map((row) => [row.entry_key, true]),
    getSqlValue: (key) => (selectOne.get(key) ? true : undefined),
    upsertSqlValue: (key) => upsertRow.run(key),
    deleteSqlValue: (key) => deleteRow.run(key),
    clearSql: () => clearRows.run(),
    countSql: () => countRows.get().count,
    debounceMs,
    logLabel,
  });
};

const createCoinBalanceDataStore = ({ jsonPath, getTotalBurned }) => {
  const selectOne = appDb.prepare('SELECT balance, earned FROM coin_balances WHERE address = ?');
  const selectAll = appDb.prepare('SELECT address, balance, earned FROM coin_balances');
  const countRows = appDb.prepare('SELECT COUNT(*) AS count FROM coin_balances');
  const clearRows = appDb.prepare('DELETE FROM coin_balances');
  const deleteRow = appDb.prepare('DELETE FROM coin_balances WHERE address = ?');
  const upsertRow = appDb.prepare(`
    INSERT INTO coin_balances (address, balance, earned)
    VALUES (@address, @balance, @earned)
    ON CONFLICT(address) DO UPDATE SET
      balance = excluded.balance,
      earned = excluded.earned
  `);

  return new DataStore({
    db: appDb,
    jsonPath,
    tableName: 'coin_balances',
    primaryKey: 'address',
    readJson: (parsed) => {
      const entries = new Map();
      const balances = parsed?.balances || parsed || {};
      for (const [address, balance] of Object.entries(balances)) {
        if (typeof balance === 'number') entries.set(address, { balance, earned: 0 });
      }
      entries.set(COIN_BALANCE_META_KEY, { totalBurned: Number(parsed?.totalBurned) || 0 });
      return entries;
    },
    writeJson: (entries) => {
      const balances = {};
      let totalBurned = Number(getTotalBurned()) || 0;
      for (const [address, entry] of entries) {
        if (address === COIN_BALANCE_META_KEY) {
          totalBurned = Number(entry?.totalBurned) || totalBurned;
          continue;
        }
        if (typeof entry?.balance === 'number') balances[address] = Math.max(0, Math.round(entry.balance));
      }
      return {
        version: 1,
        updatedAt: new Date().toISOString(),
        totalBurned,
        balances,
      };
    },
    listSqlEntries: () => selectAll.all().map((row) => [
      row.address,
      { balance: Number(row.balance) || 0, earned: Number(row.earned) || 0 },
    ]),
    getSqlValue: (address) => {
      const row = selectOne.get(address);
      return row ? { balance: Number(row.balance) || 0, earned: Number(row.earned) || 0 } : undefined;
    },
    upsertSqlValue: (address, value) => {
      if (address === COIN_BALANCE_META_KEY) return;
      upsertRow.run({
        address,
        balance: Math.max(0, Math.round(Number(value?.balance) || 0)),
        earned: Math.max(0, Math.round(Number(value?.earned) || 0)),
      });
    },
    deleteSqlValue: (address) => {
      if (address === COIN_BALANCE_META_KEY) return;
      deleteRow.run(address);
    },
    clearSql: () => clearRows.run(),
    countSql: () => countRows.get().count,
    debounceMs: 1000,
    logLabel: 'coins',
  });
};

const createScoreHistoryDataStore = ({ jsonPath, maxEntries }) => {
  const selectAddress = appDb.prepare(`
    SELECT score, tier, date
    FROM score_history
    WHERE address = ?
    ORDER BY entry_idx ASC
  `);
  const selectAll = appDb.prepare(`
    SELECT address, entry_idx, score, tier, date
    FROM score_history
    ORDER BY address ASC, entry_idx ASC
  `);
  const countRows = appDb.prepare('SELECT COUNT(*) AS count FROM score_history');
  const clearRows = appDb.prepare('DELETE FROM score_history');
  const deleteAddress = appDb.prepare('DELETE FROM score_history WHERE address = ?');
  const insertEntry = appDb.prepare(`
    INSERT INTO score_history (address, entry_idx, score, tier, date)
    VALUES (@address, @entry_idx, @score, @tier, @date)
  `);

  const buildEntry = (rows) => {
    const scores = rows.map((row) => ({
      score: Number(row.score) || 0,
      tier: row.tier || null,
      date: row.date || null,
    }));
    return {
      scores,
      lastUpdated: scores[0]?.date || null,
    };
  };

  return new DataStore({
    db: appDb,
    jsonPath,
    tableName: 'score_history',
    primaryKey: 'address',
    readJson: (parsed) => {
      const entries = new Map();
      const data = parsed?.data || {};
      for (const [address, entry] of Object.entries(data)) {
        if (Array.isArray(entry?.scores)) {
          entries.set(address, {
            scores: entry.scores.slice(0, maxEntries),
            lastUpdated: entry.lastUpdated || entry.scores[0]?.date || null,
          });
        }
      }
      return entries;
    },
    writeJson: (entries) => {
      const data = {};
      for (const [address, entry] of entries) {
        data[address] = {
          scores: Array.isArray(entry?.scores) ? entry.scores.slice(0, maxEntries) : [],
          lastUpdated: entry?.lastUpdated || entry?.scores?.[0]?.date || null,
        };
      }
      return {
        version: 1,
        updatedAt: new Date().toISOString(),
        data,
      };
    },
    listSqlEntries: () => {
      const grouped = new Map();
      for (const row of selectAll.all()) {
        if (!grouped.has(row.address)) grouped.set(row.address, []);
        grouped.get(row.address).push(row);
      }
      return Array.from(grouped.entries()).map(([address, rows]) => [address, buildEntry(rows)]);
    },
    getSqlValue: (address) => {
      const rows = selectAddress.all(address);
      return rows.length > 0 ? buildEntry(rows) : undefined;
    },
    upsertSqlValue: (address, value) => {
      deleteAddress.run(address);
      const scores = Array.isArray(value?.scores) ? value.scores.slice(0, maxEntries) : [];
      scores.forEach((entry, index) => {
        insertEntry.run({
          address,
          entry_idx: index,
          score: Math.max(0, Math.round(Number(entry?.score) || 0)),
          tier: entry?.tier || null,
          date: entry?.date || null,
        });
      });
    },
    deleteSqlValue: (address) => deleteAddress.run(address),
    clearSql: () => clearRows.run(),
    countSql: () => countRows.get().count,
    debounceMs: 1000,
    logLabel: 'score-history',
  });
};

const SYBIL_VERDICT_CONFIDENCE_SCORES = Object.freeze({
  low: 35,
  medium: 60,
  high: 78,
  very_high: 92,
});

const createSybilVerdictDataStore = ({ jsonPath }) => {
  const selectOne = appDb.prepare(`
    SELECT
      address,
      score,
      risk_level,
      confidence,
      signals_json,
      analysis_json,
      funding_sources_json,
      last_seen_signature,
      first_seen_signature,
      estimated_tx_count,
      computed_at,
      ttl_expires_at,
      scan_version
    FROM sybil_verdicts
    WHERE address = ?
  `);
  const selectAll = appDb.prepare(`
    SELECT
      address,
      score,
      risk_level,
      confidence,
      signals_json,
      analysis_json,
      funding_sources_json,
      last_seen_signature,
      first_seen_signature,
      estimated_tx_count,
      computed_at,
      ttl_expires_at,
      scan_version
    FROM sybil_verdicts
    ORDER BY computed_at DESC, address ASC
  `);
  const countRows = appDb.prepare('SELECT COUNT(*) AS count FROM sybil_verdicts');
  const clearRows = appDb.prepare('DELETE FROM sybil_verdicts');
  const deleteRow = appDb.prepare('DELETE FROM sybil_verdicts WHERE address = ?');
  const upsertRow = appDb.prepare(`
    INSERT INTO sybil_verdicts (
      address,
      score,
      risk_level,
      confidence,
      signals_json,
      analysis_json,
      funding_sources_json,
      last_seen_signature,
      first_seen_signature,
      estimated_tx_count,
      computed_at,
      ttl_expires_at,
      scan_version
    ) VALUES (
      @address,
      @score,
      @risk_level,
      @confidence,
      @signals_json,
      @analysis_json,
      @funding_sources_json,
      @last_seen_signature,
      @first_seen_signature,
      @estimated_tx_count,
      @computed_at,
      @ttl_expires_at,
      @scan_version
    )
    ON CONFLICT(address) DO UPDATE SET
      score = excluded.score,
      risk_level = excluded.risk_level,
      confidence = excluded.confidence,
      signals_json = excluded.signals_json,
      analysis_json = excluded.analysis_json,
      funding_sources_json = excluded.funding_sources_json,
      last_seen_signature = excluded.last_seen_signature,
      first_seen_signature = excluded.first_seen_signature,
      estimated_tx_count = excluded.estimated_tx_count,
      computed_at = excluded.computed_at,
      ttl_expires_at = excluded.ttl_expires_at,
      scan_version = excluded.scan_version
  `);

  const fromRow = (row) => {
    if (!row) return undefined;
    const analysis = parseJsonText(row.analysis_json);
    if (!analysis || typeof analysis !== 'object') return undefined;
    const fundingSources = parseJsonText(row.funding_sources_json, []);
    const signals = parseJsonText(row.signals_json, analysis.signals || []);
    return {
      address: row.address,
      score: Number(row.score) || Number(analysis.riskScore) || 0,
      riskLevel: row.risk_level || analysis.riskLevel || 'clean',
      confidence: Number(row.confidence) || 0,
      signals: Array.isArray(signals) ? signals : [],
      analysis,
      fundingSources: Array.isArray(fundingSources) ? fundingSources : [],
      lastSeenSignature: row.last_seen_signature || analysis?.scanMeta?.lastSeenSignature || null,
      firstSeenSignature: row.first_seen_signature || analysis?.scanMeta?.firstSeenSignature || null,
      estimatedTxCount: Number(row.estimated_tx_count) || Number(analysis?.scanMeta?.estimatedTxCount) || Number(analysis?.metrics?.txCount) || 0,
      firstTxBlockTime: Number(analysis?.scanMeta?.firstTxBlockTime) || null,
      computedAt: Number(row.computed_at) || 0,
      ttlExpiresAt: Number(row.ttl_expires_at) || 0,
      scanVersion: Number(row.scan_version) || 1,
    };
  };

  return new DataStore({
    db: appDb,
    jsonPath,
    tableName: 'sybil_verdicts',
    primaryKey: 'address',
    readJson: (parsed) => Object.entries(parsed?.data || {}),
    writeJson: (entries) => ({
      version: 1,
      updatedAt: new Date().toISOString(),
      data: Object.fromEntries(entries),
    }),
    listSqlEntries: () => selectAll.all().map((row) => {
      const entry = fromRow(row);
      return entry ? [row.address, entry] : null;
    }).filter(Boolean),
    getSqlValue: (address) => fromRow(selectOne.get(address)),
    upsertSqlValue: (address, value) => {
      const analysis = value?.analysis && typeof value.analysis === 'object' ? value.analysis : null;
      if (!analysis) {
        throw new Error(`[sybil-verdicts] analysis missing for ${address}`);
      }
      const signals = Array.isArray(value?.signals)
        ? value.signals
        : (Array.isArray(analysis.signals) ? analysis.signals : []);
      const fundingSources = Array.isArray(value?.fundingSources) ? value.fundingSources : [];
      upsertRow.run({
        address,
        score: Math.round(Number(value?.score ?? analysis.riskScore) || 0),
        risk_level: value?.riskLevel || analysis.riskLevel || 'clean',
        confidence: Number(value?.confidence) || 0,
        signals_json: JSON.stringify(signals),
        analysis_json: JSON.stringify(analysis),
        funding_sources_json: JSON.stringify(fundingSources),
        last_seen_signature: value?.lastSeenSignature || analysis?.scanMeta?.lastSeenSignature || null,
        first_seen_signature: value?.firstSeenSignature || analysis?.scanMeta?.firstSeenSignature || null,
        estimated_tx_count: Math.max(0, Math.round(Number(value?.estimatedTxCount ?? analysis?.scanMeta?.estimatedTxCount ?? analysis?.metrics?.txCount) || 0)),
        computed_at: Math.max(0, Math.round(Number(value?.computedAt) || Date.now())),
        ttl_expires_at: Math.max(0, Math.round(Number(value?.ttlExpiresAt) || 0)),
        scan_version: Math.max(1, Math.round(Number(value?.scanVersion) || 1)),
      });
    },
    deleteSqlValue: (address) => deleteRow.run(address),
    clearSql: () => clearRows.run(),
    countSql: () => countRows.get().count,
    debounceMs: 1000,
    logLabel: 'sybil-verdicts',
  });
};

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_KEY = TOKEN_2022_PROGRAM_ID;
const TOKEN_PROGRAM_KEY_STRING = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022_PROGRAM_KEY_STRING = TOKEN_2022_PROGRAM_KEY.toBase58();
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_API_KEY = (process.env.JUPITER_API_KEY ?? '').trim();
const JUPITER_SWAP_API_V2 = 'https://api.jup.ag/swap/v2';
const JUPITER_LITE_QUOTE_API = 'https://lite-api.jup.ag/swap/v1/quote';
const JUPITER_LITE_SWAP_API = 'https://lite-api.jup.ag/swap/v1/swap';
const DAILY_BLACKHOLE_CLEANUP_CAP = 500;
const BLACKHOLE_USED_SIG_FILE = path.join(METADATA_DIR, 'used-blackhole-signatures.json');
const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FORGE_CATALOG_FILE = path.join(CURRENT_DIR, 'forge-catalog.json');
const FORGE_RANK_ORDER = ['cadet', 'pilot', 'captain', 'ace', 'legend'];
const FORGE_EQUIP_FIELDS = [
  ['equippedFrame', 'frame'],
  ['equippedAura', 'aura'],
  ['equippedShipSkin', 'ship_skin'],
  ['equippedTitle', 'title'],
];
const FORGE_UNLOCK_RULES = Object.freeze({
  frame_event_horizon: { questId: 'ot_burn100', minProgress: 100 },
  aura_binary_pulse: { questId: 'ot_reach_sun', minProgress: 1 },
  title_destroyer: { questId: 'ot_burn100', minProgress: 50 },
  title_sovereign: { minOwnedItems: 4 },
  title_ascended: { questId: 'ot_score1000', minProgress: 1000 },
});
const SERVER_RANGER_RANKS = [
  { id: 'cadet', minXP: 0 },
  { id: 'pilot', minXP: 1500 },
  { id: 'captain', minXP: 8000 },
  { id: 'ace', minXP: 25000 },
  { id: 'legend', minXP: 50000 },
];
const SERVER_GAME_XP_CONFIG = {
  orbit_survival: { mult: 5, cap: 2000 },
  cosmic_defender: { mult: 1.5, cap: 2000 },
  gravity_rush: { mult: 5, cap: 2000 },
  cosmic_mine: { mult: 3, cap: 1500 },
  cosmic_runner: { mult: 3, cap: 1500 },
};
const IDENTITY_OWNERSHIP_CACHE_TTL_MS = 5 * 60 * 1000;
const identityOwnershipCache = new Map();

const loadForgeCatalog = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(FORGE_CATALOG_FILE, 'utf8'));
    return {
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      modules: Array.isArray(parsed?.modules) ? parsed.modules : [],
    };
  } catch (error) {
    console.warn('[forge] Failed to load forge catalog:', error?.message || error);
    return { items: [], modules: [] };
  }
};

const FORGE_CATALOG = loadForgeCatalog();
const FORGE_ITEM_MAP = new Map(
  FORGE_CATALOG.items.map((item) => [item.id, item]),
);
const FORGE_ITEM_NAME_MAP = new Map(
  FORGE_CATALOG.items.map((item) => [String(item.name || '').toLowerCase(), item]),
);
const FORGE_MODULE_MAP = new Map(
  FORGE_CATALOG.modules.map((moduleDef) => [moduleDef.id, moduleDef]),
);
const FORGE_MODULE_NAME_MAP = new Map(
  FORGE_CATALOG.modules.map((moduleDef) => [String(moduleDef.name || '').toLowerCase(), moduleDef]),
);

const createEmptyForgeLoadout = (address = '') => ({
  address,
  equippedFrame: null,
  equippedAura: null,
  equippedShipSkin: null,
  equippedTitle: null,
  ownedItems: [],
  installedModules: {},
  ownedModules: [],
});

const normalizeForgeEntries = (entries, keyField) => {
  const unique = new Map();
  if (!Array.isArray(entries)) return [];
  for (const entry of entries) {
    const id = typeof entry?.[keyField] === 'string' ? entry[keyField].trim() : '';
    if (!id || unique.has(id)) continue;
    const purchasedAt = typeof entry?.purchasedAt === 'string' && entry.purchasedAt.trim()
      ? entry.purchasedAt.trim()
      : new Date().toISOString();
    unique.set(id, { [keyField]: id, purchasedAt });
  }
  return [...unique.values()].sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));
};

const normalizeForgeState = (raw) => ({
  version: 1,
  items: normalizeForgeEntries(raw?.items, 'itemId'),
  modules: normalizeForgeEntries(raw?.modules, 'moduleId'),
});

const mergeForgeEntries = (existingEntries, derivedEntries, keyField) => {
  const merged = new Map();
  for (const entry of [...existingEntries, ...derivedEntries]) {
    const id = typeof entry?.[keyField] === 'string' ? entry[keyField].trim() : '';
    if (!id || merged.has(id)) continue;
    const purchasedAt = typeof entry?.purchasedAt === 'string' && entry.purchasedAt.trim()
      ? entry.purchasedAt.trim()
      : new Date().toISOString();
    merged.set(id, { [keyField]: id, purchasedAt });
  }
  return [...merged.values()].sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));
};

const getWalletUserData = (walletEntry) => (
  walletEntry?.userData && typeof walletEntry.userData === 'object' ? walletEntry.userData : {}
);

const meetsForgeRequiredRank = (userRank, requiredRank) => {
  if (!requiredRank) return true;
  if (!userRank) return false;
  const currentIndex = FORGE_RANK_ORDER.indexOf(String(userRank).trim());
  const requiredIndex = FORGE_RANK_ORDER.indexOf(String(requiredRank).trim());
  if (currentIndex < 0 || requiredIndex < 0) return false;
  return currentIndex >= requiredIndex;
};

const deriveForgeStateFromTransactions = (address, currentState) => {
  const txs = Array.isArray(prismTransactions.get(address)) ? [...prismTransactions.get(address)].reverse() : [];
  const derivedItems = [];
  const derivedModules = [];
  for (const tx of txs) {
    if (tx?.type !== 'spend') continue;
    const description = typeof tx?.description === 'string' ? tx.description.trim() : '';
    const purchasedAt = typeof tx?.timestamp === 'string' && tx.timestamp.trim() ? tx.timestamp.trim() : new Date().toISOString();
    if (tx.source === 'forge_module') {
      const moduleName = description.replace(/^Module:\s*/i, '').trim().toLowerCase();
      const moduleDef = FORGE_MODULE_NAME_MAP.get(moduleName);
      if (moduleDef && Number(tx.amount) === Number(moduleDef.price)) {
        derivedModules.push({ moduleId: moduleDef.id, purchasedAt });
      }
      continue;
    }
    if (typeof tx.source === 'string' && tx.source.startsWith('forge_')) {
      const itemName = description.replace(/^Purchased\s+/i, '').trim().toLowerCase();
      const itemDef = FORGE_ITEM_NAME_MAP.get(itemName);
      if (itemDef && tx.source === `forge_${itemDef.category}` && Number(tx.amount) === Number(itemDef.price)) {
        derivedItems.push({ itemId: itemDef.id, purchasedAt });
      }
    }
  }
  return {
    version: 1,
    items: mergeForgeEntries(currentState.items, derivedItems, 'itemId'),
    modules: mergeForgeEntries(currentState.modules, derivedModules, 'moduleId'),
  };
};

const getOrCreateForgeState = (address, walletEntry = walletDatabase.get(address) || { address }) => {
  const existingState = normalizeForgeState(walletEntry?.forgeState);
  const derivedState = deriveForgeStateFromTransactions(address, existingState);
  const changed = JSON.stringify(existingState) !== JSON.stringify(derivedState);
  return { forgeState: derivedState, changed };
};

const getStoredQuestProgressValue = (walletEntry, address, questId) => {
  const userData = getWalletUserData(walletEntry);
  const rangerState = userData?.rangerXP;
  if (rangerState && Array.isArray(rangerState.progress)) {
    const quest = rangerState.progress.find((entry) => entry && entry.questId === questId);
    if (quest) {
      return Math.max(
        Number(quest.current ?? quest.progress) || 0,
        quest.completed ? 1 : 0,
      );
    }
  }
  const serverQuest = questProgress.get(address)?.quests?.[questId];
  return Math.max(
    Number(serverQuest?.progress ?? serverQuest?.current) || 0,
    serverQuest?.completed ? 1 : 0,
  );
};

const isForgeUnlockSatisfied = (address, itemId, walletEntry, forgeState) => {
  const rule = FORGE_UNLOCK_RULES[itemId];
  if (!rule) return true;
  if (Number.isFinite(rule.minOwnedItems)) {
    return forgeState.items.length >= rule.minOwnedItems;
  }
  if (rule.questId) {
    return getStoredQuestProgressValue(walletEntry, address, rule.questId) >= (rule.minProgress || 1);
  }
  return true;
};

const sanitizeForgeLoadout = (address, candidateLoadout, forgeState) => {
  const raw = candidateLoadout && typeof candidateLoadout === 'object' ? candidateLoadout : {};
  const sanitized = createEmptyForgeLoadout(address);
  const ownedItems = forgeState.items
    .filter((entry) => FORGE_ITEM_MAP.has(entry.itemId))
    .map((entry) => ({ itemId: entry.itemId, purchasedAt: entry.purchasedAt, equipped: false }));
  const ownedItemIds = new Set(ownedItems.map((entry) => entry.itemId));
  const allModuleIds = forgeState.modules
    .map((entry) => entry.moduleId)
    .filter((moduleId) => FORGE_MODULE_MAP.has(moduleId));

  const installedModules = {};
  const usedModules = new Set();
  if (raw.installedModules && typeof raw.installedModules === 'object' && !Array.isArray(raw.installedModules)) {
    for (const [itemId, moduleIds] of Object.entries(raw.installedModules)) {
      const itemDef = FORGE_ITEM_MAP.get(itemId);
      if (!itemDef || !ownedItemIds.has(itemId) || !Array.isArray(moduleIds)) continue;
      const maxSlots = Number.isFinite(itemDef.maxModuleSlots) ? itemDef.maxModuleSlots : 3;
      const accepted = [];
      for (const moduleId of moduleIds) {
        if (accepted.length >= maxSlots) break;
        if (typeof moduleId !== 'string' || usedModules.has(moduleId) || !allModuleIds.includes(moduleId)) continue;
        const moduleDef = FORGE_MODULE_MAP.get(moduleId);
        if (!moduleDef || !Array.isArray(moduleDef.compatibleCategories) || !moduleDef.compatibleCategories.includes(itemDef.category)) continue;
        accepted.push(moduleId);
        usedModules.add(moduleId);
      }
      if (accepted.length > 0) installedModules[itemId] = accepted;
    }
  }

  sanitized.installedModules = installedModules;
  sanitized.ownedModules = allModuleIds.filter((moduleId) => !usedModules.has(moduleId));
  sanitized.ownedItems = ownedItems;

  for (const [field, category] of FORGE_EQUIP_FIELDS) {
    const itemId = typeof raw?.[field] === 'string' ? raw[field].trim() : '';
    const itemDef = FORGE_ITEM_MAP.get(itemId);
    if (itemDef && itemDef.category === category && ownedItemIds.has(itemId)) {
      sanitized[field] = itemId;
    }
  }

  const equippedIds = new Set(
    FORGE_EQUIP_FIELDS.map(([field]) => sanitized[field]).filter(Boolean),
  );
  sanitized.ownedItems = sanitized.ownedItems.map((entry) => ({
    ...entry,
    equipped: equippedIds.has(entry.itemId),
  }));

  return sanitized;
};

const getServerGameStats = (walletEntry) => {
  const gameStatsRaw = getWalletUserData(walletEntry)?.gameStats;
  if (!gameStatsRaw || typeof gameStatsRaw !== 'object') return undefined;
  const gameStats = {};

  const orbitStats = gameStatsRaw.orbit_survival_stats_v1;
  if (orbitStats && typeof orbitStats === 'object') {
    gameStats.orbit = {
      gamesPlayed: Number(orbitStats.gamesPlayed) || 0,
      totalSurvivalTime: Number(orbitStats.totalSurvivalTime) || 0,
    };
  }

  const defenderStats = gameStatsRaw.cosmic_defender_stats_v1;
  if (defenderStats && typeof defenderStats === 'object') {
    gameStats.defender = {
      gamesPlayed: Number(defenderStats.gamesPlayed) || 0,
      totalKills: Number(defenderStats.totalKills) || 0,
    };
  }

  const gravityStats = gameStatsRaw.gravity_rush_stats_v1;
  if (gravityStats && typeof gravityStats === 'object') {
    gameStats.gravity = {
      gamesPlayed: Number(gravityStats.gamesPlayed) || 0,
      totalTime: Number(gravityStats.totalPlayTime ?? gravityStats.totalSurvivalTime ?? gravityStats.totalTime) || 0,
    };
  }

  return Object.keys(gameStats).length > 0 ? gameStats : undefined;
};

const buildServerRangerSources = (address, walletEntry = walletDatabase.get(address) || {}) => {
  const coinStats = getCoinStats(address);
  const userData = getWalletUserData(walletEntry);

  const gameBestScores = {};
  const GAME_TYPE_TO_MODE = {
    orbit: 'orbit_survival',
    cosmic_defender: 'cosmic_defender',
    gravity_rush: 'gravity_rush',
    cosmic_mine: 'cosmic_mine',
    cosmic_runner: 'cosmic_runner',
  };
  for (const entry of leaderboardEntries) {
    if (entry.address !== address) continue;
    const mode = GAME_TYPE_TO_MODE[entry.gameType || 'orbit'] || entry.gameType || 'orbit';
    if (!gameBestScores[mode] || entry.score > gameBestScores[mode]) {
      gameBestScores[mode] = entry.score;
    }
  }

  const challengeWins = challenges.filter((challenge) => challenge.status === 'completed' && challenge.winner === address).length;
  const achievementCount = achievementData.get(address)?.unlocked?.size || 0;
  const completedTextQuests = Object.values(userData.textQuests || {}).filter((quest) => quest && quest.completed).length;
  const serverQuestState = questProgress.get(address) || {};
  const claimedQuestXpFallback = Object.entries(serverQuestState.quests || {})
    .filter(([, quest]) => quest?.claimed)
    .reduce((sum, [questId]) => sum + (QUEST_XP_REWARDS[questId] || 0), 0);
  const questXPEarned = Math.max(
    Number(serverQuestState.totalXPEarned) || 0,
    claimedQuestXpFallback,
    Number(userData?.rangerXP?.totalXPEarned) || 0,
  );
  const tournamentXP = Number(walletEntry?.tournamentXP) || 0;
  const arenaWeeklyXP = Number(walletEntry?.socialStats?.arenaWeeklyXP) || 0;
  const totalCoins = Number(coinStats?.totalEarned) || 0;

  return {
    gameBestScores: Object.keys(gameBestScores).length > 0 ? gameBestScores : undefined,
    gameStats: getServerGameStats(walletEntry),
    challengeWins: challengeWins || undefined,
    achievementCount: achievementCount || undefined,
    questXPEarned: questXPEarned || undefined,
    completedTextQuests: completedTextQuests || undefined,
    tournamentXP: tournamentXP || undefined,
    arenaWeeklyXP: arenaWeeklyXP || undefined,
    totalCoins: totalCoins || undefined,
  };
};

const computeServerRangerXP = (sources) => {
  let xp = 0;
  if (sources.gameBestScores) {
    for (const [mode, score] of Object.entries(sources.gameBestScores)) {
      const cfg = SERVER_GAME_XP_CONFIG[mode] || { mult: 2, cap: 1000 };
      xp += Math.min(Math.floor((score || 0) * cfg.mult), cfg.cap);
    }
  }
  if (sources.gameStats) {
    const stats = sources.gameStats;
    if (stats.orbit) xp += Math.min((Number(stats.orbit.gamesPlayed) || 0) * 5, 1000);
    if (stats.defender) xp += Math.min((Number(stats.defender.gamesPlayed) || 0) * 5, 1000);
    if (stats.gravity) xp += Math.min((Number(stats.gravity.gamesPlayed) || 0) * 5, 1000);
    if (stats.orbit) xp += Math.min(Math.floor((Number(stats.orbit.totalSurvivalTime) || 0) / 10), 500);
    if (stats.gravity) xp += Math.min(Math.floor((Number(stats.gravity.totalTime) || 0) / 10), 500);
    if (stats.defender) xp += Math.min(Math.floor((Number(stats.defender.totalKills) || 0) / 5), 500);
  }
  if (sources.achievementCount) xp += sources.achievementCount * 200;
  if (sources.challengeWins) xp += Math.min(sources.challengeWins * 300, 5000);
  if (sources.questXPEarned) xp += sources.questXPEarned;
  if (sources.completedTextQuests) xp += sources.completedTextQuests * 500;
  if (sources.tournamentXP) xp += sources.tournamentXP;
  if (sources.arenaWeeklyXP) xp += sources.arenaWeeklyXP;
  if (sources.totalCoins) xp += Math.min(Math.floor(sources.totalCoins / 200), 1000);
  return Math.max(0, Math.floor(xp));
};

const getServerRangerSnapshot = (address, walletEntry = walletDatabase.get(address) || {}) => {
  const sources = buildServerRangerSources(address, walletEntry);
  const xp = computeServerRangerXP(sources);
  let rank = SERVER_RANGER_RANKS[0];
  for (const entry of SERVER_RANGER_RANKS) {
    if (xp >= entry.minXP) rank = entry;
  }
  return { sources, xp, rank: rank.id };
};

const hasCoreCollectionAsset = async (address, options = {}) => {
  const { allowStale = true, throwOnLookupFailure = false } = options;
  if (!address || !CORE_COLLECTION) return false;
  const cached = identityOwnershipCache.get(address);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const rpcUrl = getRpcUrl(address);
  if (!rpcUrl) return false;
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `revive-entitlement-${address}`,
        method: 'searchAssets',
        params: { ownerAddress: address, grouping: ['collection', CORE_COLLECTION], page: 1, limit: 1 },
      }),
    });
    if (!response.ok) {
      throw new Error(`Identity ownership lookup failed with status ${response.status}`);
    }
    const payload = await response.json();
    const total = Number(payload?.result?.total ?? payload?.result?.grand_total ?? 0);
    const value = total > 0;
    identityOwnershipCache.set(address, { value, expiresAt: Date.now() + IDENTITY_OWNERSHIP_CACHE_TTL_MS, ts: Date.now() });
    return value;
  } catch (error) {
    if (allowStale && cached) {
      return cached.value;
    }
    if (throwOnLookupFailure) {
      const lookupError = new Error('Identity ownership lookup unavailable');
      lookupError.cause = error;
      throw lookupError;
    }
    return false;
  }
};

const getIdentityHolderPerks = async (address, options = {}) =>
  buildIdentityHolderPerks(
    mintedAddresses.has(address) || await hasCoreCollectionAsset(address, options),
    FREE_REVIVES_PER_DAY,
  );

const SCAN_ANALYSIS_TTL_MS = 60 * 60 * 1000;
const CLEAN_SCAN_REWARD_COOLDOWN_MS = 60 * 60 * 1000;
const SCAN_WALLET_REWARD = 5;
const SYBIL_HUNT_BASE_REWARD = 20;

const normalizeScanRewardClaims = (rawClaims) => {
  const claims = {};
  if (!rawClaims || typeof rawClaims !== 'object' || Array.isArray(rawClaims)) return claims;
  for (const [target, rawTimestamp] of Object.entries(rawClaims)) {
    const normalizedTarget = normalizePubkey(target);
    const timestamp = Number(rawTimestamp);
    if (!normalizedTarget || !Number.isFinite(timestamp) || timestamp <= 0) continue;
    claims[normalizedTarget] = timestamp;
  }
  return claims;
};

const normalizeScanRewardState = (rawState) => ({
  cleanClaims: normalizeScanRewardClaims(rawState?.cleanClaims),
  sybilClaims: normalizeScanRewardClaims(rawState?.sybilClaims),
});

const getScanRewardState = (address, walletEntry = walletDatabase.get(address) || { address }) => (
  normalizeScanRewardState(walletEntry?._scanRewardState)
);

const getUniqueScanTargetCount = (state) => (
  new Set([...Object.keys(state.cleanClaims), ...Object.keys(state.sybilClaims)]).size
);

const computeSybilHuntReward = (nextCatchCount) => {
  const rankBonus = nextCatchCount >= 50 ? 50
    : nextCatchCount >= 20 ? 30
    : nextCatchCount >= 10 ? 20
    : nextCatchCount >= 3 ? 10
    : 0;
  return SYBIL_HUNT_BASE_REWARD + rankBonus;
};

const getRecentSybilAnalysis = (targetAddress) => {
  if (!targetAddress) return null;
  const now = Date.now();
  const cached = loadSybilCacheEntry(targetAddress);
  const cachedAt = Number(cached?.cachedAt) || Number(cached?.computedAt) || 0;
  const ttlExpiresAt = Number(cached?.ttlExpiresAt) || 0;
  if (cached?.analysis && ((ttlExpiresAt && now < ttlExpiresAt) || now - cachedAt < SCAN_ANALYSIS_TTL_MS)) {
    return cached.analysis;
  }
  const walletEntry = walletDatabase.get(targetAddress);
  const sybil = walletEntry?.sybil;
  const updatedAt =
    Date.parse(String(sybil?.updatedAt || sybil?.timestamp || '')) ||
    Number(sybil?.scanMeta?.computedAt || 0);
  const sybilTtlExpiresAt = Number(sybil?.scanMeta?.ttlExpiresAt || 0);
  if (
    sybil &&
    Number.isFinite(updatedAt) &&
    ((sybilTtlExpiresAt && now < sybilTtlExpiresAt) || now - updatedAt < SCAN_ANALYSIS_TTL_MS)
  ) {
    return sybil;
  }
  return null;
};

function persistFundingEdge(fromAddress, toAddress, tokenMint, info, chainDepth = 1) {
  if (!fromAddress || !toAddress || !tokenMint || !info) return;
  const totalAmount = Number(info.totalAmount ?? info.totalSol) || 0;
  const txCount = Math.max(0, Math.round(Number(info.count) || 0));
  if (totalAmount <= 0 || txCount <= 0) return;

  upsertSybilFundingEdge.run({
    from_address: fromAddress,
    to_address: toAddress,
    token_mint: tokenMint,
    total_amount: totalAmount,
    tx_count: txCount,
    first_seen_at: Math.max(0, Math.round(Number(info.firstTime) || Date.now())),
    last_seen_at: Math.max(0, Math.round(Number(info.lastTime) || Date.now())),
    chain_depth: Math.max(1, Math.min(4, Math.round(Number(chainDepth) || 1))),
  });
}

function persistFundingEdgesForTarget(targetAddress, incoming, tokenFundingSources) {
  for (const [fromAddress, info] of incoming || []) {
    persistFundingEdge(fromAddress, targetAddress, SOL_MINT, info, 1);
  }
  for (const [mint, mintSources] of tokenFundingSources || []) {
    for (const [fromAddress, info] of mintSources || []) {
      persistFundingEdge(fromAddress, targetAddress, mint, info, 1);
    }
  }
}

function getStoredDominantFundingSource(address) {
  if (!address) return null;
  const row = selectDominantFundingEdgeRow.get(address);
  if (row?.from_address) {
    return {
      address: row.from_address,
      tokenMint: row.token_mint || SOL_MINT,
      totalAmount: Number(row.total_amount) || 0,
      txCount: Number(row.tx_count) || 0,
    };
  }

  const walletEntry = walletDatabase.get(address);
  const legacySource = walletEntry?.funding?.sources?.[0];
  if (legacySource?.address) {
    return {
      address: legacySource.address,
      tokenMint: legacySource.tokenMint || SOL_MINT,
      totalAmount: Number(legacySource.totalAmount ?? legacySource.totalSolReceived) || 0,
      txCount: Number(legacySource.transactionCount) || 0,
    };
  }
  return null;
}

function detectTemporalFundingCohort({ address, firstTxBlockTime, txCount, dominantFunder }) {
  if (!address || !dominantFunder || !Number.isFinite(Number(firstTxBlockTime)) || !Number.isFinite(Number(txCount)) || txCount <= 0) {
    return { cohortId: null, score: 0, walletCount: 0, members: [] };
  }

  const members = [{
    address,
    firstTxAt: Number(firstTxBlockTime),
    txCount: Number(txCount),
  }];

  let _scanned = 0;
  const _maxScan = walletDatabase.size > 5000 ? 2000 : walletDatabase.size;
  for (const [candidateAddress, entry] of walletDatabase) {
    if (_scanned >= _maxScan) break;
    _scanned++;
    if (!candidateAddress || candidateAddress === address) continue;
    if (!entry?.firstTxTimestamp) continue;
    const candidateFirstTx = Number(entry.firstTxTimestamp);
    if (!Number.isFinite(candidateFirstTx) || Math.abs(candidateFirstTx - Number(firstTxBlockTime)) > 3600) continue;
    const candidateTxCount = Number(entry?.stats?.transactions ?? entry?.sybil?.metrics?.txCount ?? 0);
    if (!Number.isFinite(candidateTxCount) || candidateTxCount <= 0) continue;
    if (candidateTxCount < txCount / 2 || candidateTxCount > txCount * 2) continue;
    const candidateFunder = getStoredDominantFundingSource(candidateAddress);
    if (!candidateFunder?.address || candidateFunder.address !== dominantFunder) continue;
    members.push({
      address: candidateAddress,
      firstTxAt: candidateFirstTx,
      txCount: candidateTxCount,
    });
  }

  if (members.length < 3) return { cohortId: null, score: 0, walletCount: members.length, members };

  const firstWalletAt = Math.min(...members.map((member) => member.firstTxAt));
  const windowEndAt = Math.max(...members.map((member) => member.firstTxAt));
  const birthWindowSeconds = Math.max(0, windowEndAt - firstWalletAt);
  if (birthWindowSeconds > 24 * 3600) return { cohortId: null, score: 0, walletCount: members.length, members };

  const minTxCount = Math.min(...members.map((member) => member.txCount));
  const maxTxCount = Math.max(...members.map((member) => member.txCount));
  const txSimilarity = maxTxCount > 0 ? minTxCount / maxTxCount : 0;
  const windowSimilarity = 1 - Math.min(1, birthWindowSeconds / (24 * 3600));
  const sizeScore = Math.min(1, members.length / 6);
  const score = Math.max(0, Math.min(1, Number((((txSimilarity * 0.45) + (windowSimilarity * 0.35) + (sizeScore * 0.20))).toFixed(4))));
  const cohortId = crypto.createHash('sha256')
    .update(`${dominantFunder}:${Math.floor(firstWalletAt / 3600)}`)
    .digest('hex')
    .slice(0, 24);

  upsertSybilTemporalCohort.run({
    cohort_id: cohortId,
    first_wallet_at: firstWalletAt,
    window_end_at: windowEndAt,
    wallet_count: members.length,
    similarity_score: score,
    first_common_funder: dominantFunder,
  });

  return { cohortId, score, walletCount: members.length, members };
}

function computeSameFunderScore(memberCount, siblingCount) {
  const normalizedMembers = Math.max(0, Number(memberCount) || 0);
  const normalizedSiblings = Math.max(0, Number(siblingCount) || 0);
  const coverageScore = normalizedSiblings > 0
    ? Math.min(1, Math.max(0, (normalizedMembers - 1) / normalizedSiblings))
    : (normalizedMembers >= 3 ? 1 : 0);
  const sizeScore = Math.min(1, normalizedMembers / 6);
  return Number(((coverageScore * 0.6) + (sizeScore * 0.4)).toFixed(4));
}

function persistAutoDetectedScanClusters({
  address,
  temporalCohort,
  temporalCohortScore,
  fundingChainDepth,
  sameDepthSiblings,
}) {
  const now = Date.now();
  const detectedClusters = [];
  const normalizedSameDepthSiblings = [...new Set(
    Array.from(sameDepthSiblings || [])
      .map((sibling) => String(sibling ?? '').trim())
      .filter(Boolean)
  )];

  const cohortMembers = [...new Set(
    (temporalCohort?.members || [])
      .map((member) => member?.address)
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
  if (temporalCohort?.cohortId && cohortMembers.length >= 3) {
    const sameFunderScore = computeSameFunderScore(cohortMembers.length, Math.max(normalizedSameDepthSiblings.length, cohortMembers.length - 1));
    const confidence = Math.min(0.95, ((Number(temporalCohortScore) || 0) * 0.5) + (sameFunderScore * 0.5));
    const clusterId = buildDeterministicClusterId(cohortMembers);
    if (clusterId) {
      upsertSybilClusterWithMembers({
        clusterId,
        members: cohortMembers,
        detectionMethod: 'temporal_same_funder',
        confidence,
        detectedAt: now,
        lastUpdatedAt: now,
      });
      detectedClusters.push({
        clusterId,
        detectionMethod: 'temporal_same_funder',
        size: cohortMembers.length,
        confidence,
      });
    }
  }

  const deepChainMembers = [address, ...normalizedSameDepthSiblings].sort((left, right) => left.localeCompare(right));
  if ((Number(fundingChainDepth) || 0) >= 3 && deepChainMembers.length >= 3) {
    const depthScore = Math.min(1, (Number(fundingChainDepth) || 0) / 4);
    const siblingScore = computeSameFunderScore(deepChainMembers.length, normalizedSameDepthSiblings.length);
    const confidence = Math.min(0.95, (depthScore * 0.55) + (siblingScore * 0.45));
    const clusterId = buildDeterministicClusterId(deepChainMembers);
    if (clusterId) {
      upsertSybilClusterWithMembers({
        clusterId,
        members: deepChainMembers,
        detectionMethod: 'deep_funder_chain',
        confidence,
        detectedAt: now,
        lastUpdatedAt: now,
      });
      detectedClusters.push({
        clusterId,
        detectionMethod: 'deep_funder_chain',
        size: deepChainMembers.length,
        confidence,
      });
    }
  }

  return detectedClusters;
}

function snapshotSybilVerdictHistory(address, cacheEntry) {
  if (!address || !cacheEntry?.analysis) return;
  const computedAt = Math.max(0, Math.round(Number(cacheEntry.computedAt ?? cacheEntry.analysis?.scanMeta?.computedAt) || 0));
  if (!computedAt) return;

  insertSybilVerdictHistoryRow.run({
    address,
    version: Math.max(1, Math.round(Number(cacheEntry.analysis?.verdictSignals?.version ?? cacheEntry.scanVersion ?? cacheEntry.analysis?.scanMeta?.scanVersion) || 1)),
    score: Math.round(Number(cacheEntry.score ?? cacheEntry.analysis?.riskScore) || 0),
    risk_level: cacheEntry.riskLevel || cacheEntry.analysis?.riskLevel || 'clean',
    signals_json: JSON.stringify(Array.isArray(cacheEntry.analysis?.signals) ? cacheEntry.analysis.signals : []),
    computed_at: computedAt,
  });
  pruneSybilVerdictHistoryRows.run(address, address);
}

function getSybilVerdictHistory(address, days = 30) {
  const cutoff = Date.now() - Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000;
  const rows = selectSybilVerdictHistoryRows.all(address, cutoff).map((row) => ({
    computed_at: Number(row.computed_at) || 0,
    score: Number(row.score) || 0,
    risk_level: row.risk_level || 'clean',
  }));

  if (rows.length > 0) return rows;

  const fallback = getRecentSybilAnalysis(address) || walletDatabase.get(address)?.sybil;
  const computedAt = Date.parse(String(fallback?.updatedAt || ''));
  if (!fallback || !Number.isFinite(computedAt)) return [];
  return [{
    computed_at: computedAt,
    score: Math.round(Number(fallback.riskScore) || 0),
    risk_level: fallback.riskLevel || 'clean',
  }];
}

function submitSybilFeedback({ targetAddress, reportedBy, reportType, notes = null, adminVerified = null }) {
  const reportedAt = Date.now();
  const result = insertSybilFeedbackRow.run({
    target_address: targetAddress,
    reported_by: reportedBy,
    report_type: reportType,
    admin_verified: adminVerified == null ? null : (adminVerified ? 1 : 0),
    reported_at: reportedAt,
    notes,
  });

  return {
    id: Number(result.lastInsertRowid),
    target_address: targetAddress,
    reported_by: reportedBy,
    report_type: reportType,
    admin_verified: adminVerified == null ? null : (adminVerified ? 1 : 0),
    reported_at: reportedAt,
    notes,
  };
}

// === API VERSION DISPATCH ===
const GAME_MODE_ALIASES = {
  orbit: 'orbit', orbit_survival: 'orbit',
  defender: 'destroyer', cosmic_defender: 'destroyer', destroyer: 'destroyer',
  gravity: 'gravity', gravity_rush: 'gravity',
  mine: 'mine', cosmic_mine: 'mine',
  runner: 'runner', cosmic_runner: 'runner',
};
const toCanonGameMode = (raw) => GAME_MODE_ALIASES[String(raw || '').trim()] || null;

function getApiMeta(req, pathname) {
  return {
    apiVersion: pathname.startsWith('/api/v2/') ? 'v2' : 'v1',
    clientVersion: String(req.headers['x-client-version'] || '').trim() || 'unknown',
  };
}

const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 min nonce window
const authChallenges = new Map(); // nonce → { address, expiresAt }


/**
 * Verify a Solana wallet signature (Ed25519) using node:crypto.
 * Returns true if signature of `message` is valid for `address`.
 */
function verifyWalletSignature(address, message, signatureRaw) {
  try {
    const pubkeyBytes = new PublicKey(address).toBytes();
    const msgBytes =
      Buffer.isBuffer(message)
        ? message
        : message instanceof Uint8Array
          ? Buffer.from(message)
          : Buffer.from(String(message), 'utf8');

    // Try multiple signature decodings: hex (128 chars) → base64 (88 chars) → raw base64
    const encodings = [];
    const isHex = /^[0-9a-fA-F]+$/.test(signatureRaw) && signatureRaw.length === 128;
    if (isHex) {
      encodings.push({ name: 'hex', bytes: Buffer.from(signatureRaw, 'hex') });
      // Also try base64 decoding of the same string as fallback
      encodings.push({ name: 'base64-fallback', bytes: Buffer.from(signatureRaw, 'base64') });
    } else {
      encodings.push({ name: 'base64', bytes: Buffer.from(signatureRaw, 'base64') });
      // Also try hex decoding as fallback
      if (/^[0-9a-fA-F]+$/.test(signatureRaw)) {
        encodings.push({ name: 'hex-fallback', bytes: Buffer.from(signatureRaw, 'hex') });
      }
    }

    // Build SPKI key once
    const ed25519SpkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    let spkiKey = null;
    try {
      spkiKey = crypto.createPublicKey({
        key: Buffer.concat([ed25519SpkiPrefix, Buffer.from(pubkeyBytes)]),
        format: 'der',
        type: 'spki',
      });
    } catch (e) {
      console.warn('[auth:verify] SPKI key creation failed:', e.message);
    }

    // nacl loaded at module top-level (see _naclInstance)

    for (const { name, bytes: sigBytes } of encodings) {
      if (sigBytes.length !== 64) {
        // skip wrong-length signature
        continue;
      }

      // Try Node.js native Ed25519
      if (spkiKey) {
        try {
          const result = crypto.verify(null, msgBytes, spkiKey, sigBytes);
          if (result) {
            return true;
          }
        } catch (e) {
          console.warn(`[auth:verify] ${name} + native crypto error:`, e.message);
        }
      }

      // Try tweetnacl
      if (_naclInstance) {
        try {
          const result = _naclInstance.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
          if (result) {
            return true;
          }
        } catch (e) {
          console.warn(`[auth:verify] ${name} + tweetnacl error:`, e.message);
        }
      }
    }

    console.warn('[auth:verify] All verification attempts failed');
    return false;
  } catch (e) {
    console.error('[auth:verify] ERROR:', e.message);
    return false;
  }
}

const authCtx = { walletIpLog, getClientIp, respondJson, walletDatabase: null };
const { requireJwt, optionalJwt, createJwt: createJwtBound } = createAuthServices(authCtx);

const {
  blackHoleUsedSignatures,
  persistBlackHoleUsedSignatures,
  cleanupBlackHoleUsedSignatures,
  durableClaimSignatures,
} = createBlackHoleSignatureStore({
  fs,
  filePath: BLACKHOLE_USED_SIG_FILE,
});

function normalizePubkey(value) {
  try {
    return new PublicKey(String(value)).toBase58();
  } catch {
    return null;
  }
}

const {
  inferBlackHoleAssetKind,
  getWalletLamportDelta,
  verifyBlackHoleCommissionTx,
  verifyCloseOperationTx,
  verifyBurnOperationTx,
  verifySwapOperationTx,
} = createBlackHoleTxVerifier({
  treasuryAddress: TREASURY_ADDRESS,
  tokenProgramKeyString: TOKEN_PROGRAM_KEY_STRING,
  token2022ProgramKeyString: TOKEN_2022_PROGRAM_KEY_STRING,
});
const extractTrackedSolTransfers = (parsed, targetAddress) => extractSolTransfers(parsed, targetAddress, TREASURY_WALLETS);

/**
 * Admin key check: requires X-Admin-Key header matching ADMIN_KEY env var.
 * Returns true if authorized, false (and sends 403) if not.
 */
function requireAdminKey(req, res) {
  const key = req.headers['x-admin-key'];
  const adminKey = process.env.ADMIN_KEY;
  if (!key || !adminKey || key.length !== adminKey.length ||
      !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(adminKey))) {
    respondJson(res, 403, { error: 'Forbidden' });
    return false;
  }
  return true;
}

const TOKEN_ADDRESSES = {
  SEEKER_GENESIS_COLLECTION: 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te',
  SEEKER_MINT_AUTHORITY: 'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4',
  CHAPTER2_PREORDER: '2DMMamkkxQ6zDMBtkFp8KH7FoWzBMBA1CGTYwom4QH6Z',
};
const PREORDER_COLLECTION = '3uejyD3ZwHDGwT8n6KctN3Stnjn9Nih79oXES9VqA38D';
const LST_MINTS = {
  JITOSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  MSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  BSOL: 'BSo13v7qDMGWCM1cW8wwfsfZ7vQLZKxHCiNSN2B7Mq2u',
};
const MEME_COIN_MINTS = {
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  POPCAT: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
  MEW: 'MEW1VNoNHn99uH86fUvYvU42o9YkS9uH9Tst6t2291',
};
const MEME_COIN_PRICES_USD = {
  BONK: 0.000002,
  WIF: 3.5,
  POPCAT: 0.35,
  MEW: 0.003,
};
const MEME_MINT_LOOKUP = Object.entries(MEME_COIN_MINTS).reduce((acc, [symbol, mint]) => {
  acc[mint] = symbol;
  return acc;
}, {});
const DEFI_POSITION_HINTS = ['kamino', 'drift', 'marginfi', 'mango', 'jito', 'solend', 'zeta'];
const BLUE_CHIP_COLLECTIONS = [
  'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w', // Mad Lads
  'SMBH3wF6pdt967Y62N7S5mB4tJSTH3KAsdJ82D3L2nd', // SMB Gen2
  'SMB3ndYpSXY97H8MhpxYit3pD8TzYJ5v6ndP4D2L2nd', // SMB Gen3
  '6v9UWGmEB5Hthst9KqEAgXW6XF6R6yv4t7Yf3YfD3A7t', // Claynosaurz
  'BUjZjAS2vbbb9p56fAun4sFmPAt8W6JURG5L3AkVvHP9', // Famous Fox Federation
  '7TENEKwBnkpENuefriGPg4hBDR4WJ2Gyfw5AhdkMA4rq', // Okay Bears
  'CDgbhX61QFADQAeeYKP5BQ7nnzDyMkkR3NEhYF2ETn1k', // Taiyo Robotics
];
const BLUE_CHIP_COLLECTION_NAMES = [
  'mad lads', 'solana monkey business', 'claynosaurz', 'okay bears',
  'famous fox federation', 'taiyo robotics',
];

const PENDING_MINT_TTL_MS = 10 * 60 * 1000;
const MAX_GAME_SESSION_PROOFS = 50_000;
const pendingMintSigners = new Map();
const gameSessionProofs = new Map();
const gameSessionProofStore = createJsonColumnStore({
  jsonPath: GAME_SESSION_STORE_FILE,
  tableName: 'game_session_proofs',
  keyColumn: 'session_id',
  readJson: (parsed) => {
    const sessions = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.sessions) ? parsed.sessions : []);
    return sessions
      .filter((entry) => typeof entry?.id === 'string' && entry.id)
      .map((entry) => [entry.id, entry]);
  },
  writeJson: (entries) => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    sessions: Array.from(entries.values()),
  }),
  debounceMs: 2000,
  logLabel: 'game-session',
});

const prunePendingMints = () => {
  const now = Date.now();
  for (const [key, entry] of pendingMintSigners.entries()) {
    if (!entry || now - entry.createdAt > PENDING_MINT_TTL_MS) {
      pendingMintSigners.delete(key);
    }
  }
};

const storePendingMint = ({ requestId, owner, assetId, assetSecret, transaction, score, tier, traits, stats, metadataUri, isRemint }) => {
  prunePendingMints();
  pendingMintSigners.set(requestId, {
    owner,
    assetId,
    assetSecret,
    transaction,
    score,
    tier,
    traits,
    stats,
    metadataUri,
    isRemint,
    createdAt: Date.now(),
  });
};

const consumePendingMint = (requestId) => {
  prunePendingMints();
  const entry = pendingMintSigners.get(requestId);
  if (!entry) return null;
  pendingMintSigners.delete(requestId);
  return entry;
};

const normalizeStoredGameSessionEntry = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const hash = typeof raw.hash === 'string' ? raw.hash.trim() : '';
  const seed = typeof raw.seed === 'string' ? raw.seed.trim() : '';
  const slot = Number(raw.slot);
  if (!id || !hash || !seed || !Number.isInteger(slot) || slot <= 0) return null;

  const startedAtMs = Number(raw.startedAtMs);
  const endedAtMs = Number(raw.endedAtMs);
  const safeStartedAtMs = Number.isFinite(startedAtMs) ? Math.floor(startedAtMs) : 0;
  const safeEndedAtMs = Number.isFinite(endedAtMs) ? Math.floor(endedAtMs) : safeStartedAtMs;

  const durationCandidate = Number(raw.durationMs);
  const durationMs = Number.isFinite(durationCandidate)
    ? Math.max(0, Math.floor(durationCandidate))
    : Math.max(0, safeEndedAtMs - safeStartedAtMs);

  const score = Number(raw.score);
  const scoreDeltaCandidate = Number(raw.scoreDelta);
  const scoreDelta = Number.isFinite(scoreDeltaCandidate)
    ? Math.max(0, Math.floor(scoreDeltaCandidate))
    : 0;

  const createdAtMsCandidate = Number(raw.createdAtMs);
  const createdAtFromIso = Date.parse(String(raw.createdAt ?? ''));
  const createdAtMs = Number.isFinite(createdAtMsCandidate) && createdAtMsCandidate > 0
    ? Math.floor(createdAtMsCandidate)
    : (Number.isFinite(createdAtFromIso) ? createdAtFromIso : Date.now());

  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt.trim()
    ? raw.createdAt
    : new Date(createdAtMs).toISOString();

  const lastVerifiedAt = typeof raw.lastVerifiedAt === 'string' && raw.lastVerifiedAt.trim()
    ? raw.lastVerifiedAt
    : createdAt;

  return {
    id,
    hash,
    walletAddress: typeof raw.walletAddress === 'string' && raw.walletAddress.trim()
      ? raw.walletAddress.trim()
      : null,
    score: Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0,
    survivalTime: typeof raw.survivalTime === 'string' && raw.survivalTime.trim()
      ? raw.survivalTime.trim()
      : '0:00',
    seed,
    slot,
    startedAtMs: safeStartedAtMs,
    endedAtMs: safeEndedAtMs,
    durationMs,
    scoreDelta,
    verified: Boolean(raw.verified),
    proofUrl: typeof raw.proofUrl === 'string' && raw.proofUrl.trim() ? raw.proofUrl.trim() : null,
    verification: {
      rpcHealthy: Boolean(raw?.verification?.rpcHealthy),
      slotFound: Boolean(raw?.verification?.slotFound),
      seedMatchesSlot: Boolean(raw?.verification?.seedMatchesSlot),
      slotBlockhash:
        typeof raw?.verification?.slotBlockhash === 'string' && raw.verification.slotBlockhash.trim()
          ? raw.verification.slotBlockhash.trim()
          : null,
      slotBlockTimeMs: Number.isFinite(Number(raw?.verification?.slotBlockTimeMs))
        ? Math.floor(Number(raw.verification.slotBlockTimeMs))
        : null,
      reason:
        typeof raw?.verification?.reason === 'string' && raw.verification.reason.trim()
          ? raw.verification.reason.trim()
          : 'Unknown',
    },
    createdAt,
    lastVerifiedAt,
    createdAtMs,
    gameMode: typeof raw.gameMode === 'string' ? raw.gameMode : undefined,
    coinsCredited: Number.isFinite(Number(raw.coinsCredited)) ? Math.max(0, Math.floor(Number(raw.coinsCredited))) : 0,
    identityGameCoinMultiplier: Number.isFinite(Number(raw.identityGameCoinMultiplier))
      ? Math.max(1, Math.floor(Number(raw.identityGameCoinMultiplier)))
      : null,
    // Preserve reuse-prevention flags across restarts
    usedForTournament: raw.usedForTournament || null,
    usedForChallenge: raw.usedForChallenge || null,
    usedForLeaderboard: raw.usedForLeaderboard || null,
  };
};

const persistGameSessionProofs = () => {
  try {
    gameSessionProofStore.replaceAll(gameSessionProofs);
  } catch (error) {
    console.warn('[game-session] Failed to persist proofs', error);
  }
};

const pruneGameSessionProofs = () => {
  const cutoff = Date.now() - GAME_SESSION_TTL_MS;
  let removed = 0;
  for (const [id, entry] of gameSessionProofs.entries()) {
    if (!entry || (Number(entry.createdAtMs ?? 0) < cutoff
        && !entry.usedForTournament && !entry.usedForChallenge && !entry.usedForLeaderboard)) {
      gameSessionProofs.delete(id);
      removed += 1;
    }
  }
  if (removed > 0) {
    persistGameSessionProofs();
  }
};

if (!fs.existsSync(METADATA_DIR)) {
  fs.mkdirSync(METADATA_DIR, { recursive: true });
}
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

const gameSessionStoreDir = path.dirname(GAME_SESSION_STORE_FILE);
if (!fs.existsSync(gameSessionStoreDir)) {
  fs.mkdirSync(gameSessionStoreDir, { recursive: true });
}

let leaderboardCache = null;
let leaderboardCacheTime = 0;
const leaderboardCacheRef = {
  get value() {
    return leaderboardCache;
  },
  set value(value) {
    leaderboardCache = value;
  },
};
const leaderboardCacheTimeRef = {
  get value() {
    return leaderboardCacheTime;
  },
  set value(value) {
    leaderboardCacheTime = value;
  },
};
const {
  leaderboardEntries,
  persistLeaderboard: rawPersistLeaderboard,
  submitLeaderboardEntry,
  initLeaderboardStore,
} = createLeaderboardStoreFromContext({
  leaderboardStoreFile: LEADERBOARD_STORE_FILE,
  leaderboardMaxEntries: LEADERBOARD_MAX_ENTRIES,
});

const persistLeaderboard = () => {
  leaderboardCache = null; // invalidate cache on write
  rawPersistLeaderboard();
};

initLeaderboardStore();

// ── Server-side Coin balance persistence ──
const COINS_STORE_FILE = process.env.COINS_STORE_FILE
  ? path.resolve(process.env.COINS_STORE_FILE)
  : path.join(METADATA_DIR, 'coin-balances.json');

const coinBalances = new Map();
const coinBalanceStore = createCoinBalanceDataStore({
  jsonPath: COINS_STORE_FILE,
  getTotalBurned: () => totalBurnedRef.value,
});

const loadCoinBalances = async () => {
  try {
    coinBalances.clear();
    const entries = coinBalanceStore.entries();
    for (const [addr, entry] of entries) {
      if (addr === COIN_BALANCE_META_KEY) {
        if (typeof entry?.totalBurned === 'number') {
          totalBurnedRef.value = entry.totalBurned;
        }
        continue;
      }
      if (typeof entry?.balance === 'number') {
        coinBalances.set(addr, entry.balance);
      }
    }

    console.log(`[coins] Loaded ${coinBalances.size} balances from SQLite/JSON (totalBurned: ${totalBurnedRef.value})`);
    if (coinBalances.size > 0 && fbAvailable()) {
      const entries = [...coinBalances.entries()].map(([addr, bal]) => [addr, { balance: bal, updatedAt: new Date().toISOString() }]);
      fbBatchSet('coinBalances', entries)
        .catch(err => console.warn('[coins] Migration failed:', err.message));
    }
  } catch (err) {
    console.warn('[coins] Failed to load', err);
  }
};

const persistCoinBalances = () => {
  try {
    const snapshot = new Map([...coinBalances.entries()].map(([address, balance]) => [address, { balance, earned: 0 }]));
    snapshot.set(COIN_BALANCE_META_KEY, { totalBurned: totalBurnedRef.value });
    coinBalanceStore.replaceAll(snapshot);
  } catch (err) {
    console.warn('[coins] Failed to persist', err);
  }
};

const getCoinBalance = (address) => coinBalances.get(address) || 0;

const setCoinBalance = (address, coins) => {
  const safe = Math.max(0, Math.round(coins));
  coinBalances.set(address, safe);
  coinBalanceStore.set(address, { balance: safe, earned: 0 });
  // Keep walletDatabase in sync (walletDatabase is a Map)
  const wEntry = walletDatabase.get(address);
  if (wEntry) { wEntry.coins = safe; walletDatabase.set(address, wEntry); }
  coinBalanceStore.set(COIN_BALANCE_META_KEY, { totalBurned: totalBurnedRef.value });
  if (fbAvailable()) {
    fbSet('coinBalances', address, { balance: safe, updatedAt: new Date().toISOString() })
      .catch(() => {});
  }
};

// coinBalances loaded async in initData()

// ── Server-side Minted address tracking ──
const MINTED_ADDRESSES_FILE = path.join(METADATA_DIR, 'minted-addresses.json');
const mintedAddressesStore = createPresenceStore({
  jsonPath: MINTED_ADDRESSES_FILE,
  tableName: 'minted_addresses',
  keyColumn: 'address',
  readJson: (parsed) => {
    const addresses = Array.isArray(parsed?.addresses) ? parsed.addresses : (Array.isArray(parsed) ? parsed : []);
    return addresses
      .filter((address) => typeof address === 'string' && address.trim())
      .map((address) => [address.trim(), true]);
  },
  writeJson: (entries) => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    addresses: Array.from(entries.keys()),
  }),
  debounceMs: 500,
  logLabel: 'minted',
});
const {
  mintedAddresses,
  loadMintedAddresses,
  saveMintedAddresses,
} = createMintedAddressesStoreFromContext({
  mintedAddressesFile: MINTED_ADDRESSES_FILE,
  datastore: mintedAddressesStore,
});

// mintedAddresses loaded in initData()

// ── Server-side Score History (per wallet, last 20 scores) ──
const SCORE_HISTORY_FILE = path.join(METADATA_DIR, 'score-history.json');
const SCORE_HISTORY_MAX = 20;
const scoreHistoryStore = createScoreHistoryDataStore({
  jsonPath: SCORE_HISTORY_FILE,
  maxEntries: SCORE_HISTORY_MAX,
});
const {
  scoreHistory,
  loadScoreHistory,
  persistScoreHistory,
  getScoreHistory,
  addScoreEntry,
} = createScoreHistoryStoreFromContext({
  scoreHistoryFile: SCORE_HISTORY_FILE,
  scoreHistoryMaxEntries: SCORE_HISTORY_MAX,
  datastore: scoreHistoryStore,
  fbAvailable,
  fbGetAll,
  fbSet,
  fbBatchSet,
});

// scoreHistory loaded async in initData()

// ── Server-side Wallet Database (comprehensive wallet data) ──
const WALLET_DB_FILE = path.join(METADATA_DIR, 'wallet-database.json');
const walletDatabase = new Map(); // address -> wallet data object
authCtx.walletDatabase = walletDatabase; // wire up for JWT token version checks
const walletStore = createJsonColumnStore({
  jsonPath: WALLET_DB_FILE,
  tableName: 'wallets',
  keyColumn: 'address',
  readJson: (parsed) => Object.entries(parsed?.wallets || {}),
  writeJson: (entries) => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    totalWallets: entries.size,
    wallets: Object.fromEntries(entries),
  }),
  debounceMs: 500,
  logLabel: 'wallet-db',
  persistUpdatedAt: true,
});

const SYBIL_VERDICTS_FILE = path.join(METADATA_DIR, 'sybil-verdicts.json');
const sybilVerdictStore = createSybilVerdictDataStore({
  jsonPath: SYBIL_VERDICTS_FILE,
});

const upsertSybilFundingEdge = appDb.prepare(`
  INSERT INTO sybil_funding_edges (
    from_address,
    to_address,
    token_mint,
    total_amount,
    tx_count,
    first_seen_at,
    last_seen_at,
    chain_depth
  ) VALUES (
    @from_address,
    @to_address,
    @token_mint,
    @total_amount,
    @tx_count,
    @first_seen_at,
    @last_seen_at,
    @chain_depth
  )
  ON CONFLICT(from_address, to_address, token_mint) DO UPDATE SET
    total_amount = excluded.total_amount,
    tx_count = excluded.tx_count,
    first_seen_at = MIN(sybil_funding_edges.first_seen_at, excluded.first_seen_at),
    last_seen_at = MAX(sybil_funding_edges.last_seen_at, excluded.last_seen_at),
    chain_depth = MAX(sybil_funding_edges.chain_depth, excluded.chain_depth)
`);

const upsertSybilTemporalCohort = appDb.prepare(`
  INSERT INTO sybil_temporal_cohorts (
    cohort_id,
    first_wallet_at,
    window_end_at,
    wallet_count,
    similarity_score,
    first_common_funder
  ) VALUES (
    @cohort_id,
    @first_wallet_at,
    @window_end_at,
    @wallet_count,
    @similarity_score,
    @first_common_funder
  )
  ON CONFLICT(cohort_id) DO UPDATE SET
    first_wallet_at = excluded.first_wallet_at,
    window_end_at = excluded.window_end_at,
    wallet_count = excluded.wallet_count,
    similarity_score = excluded.similarity_score,
    first_common_funder = excluded.first_common_funder
`);

const insertSybilFeedbackRow = appDb.prepare(`
  INSERT INTO sybil_feedback (
    target_address,
    reported_by,
    report_type,
    admin_verified,
    reported_at,
    notes
  ) VALUES (
    @target_address,
    @reported_by,
    @report_type,
    @admin_verified,
    @reported_at,
    @notes
  )
`);

const insertSybilVerdictHistoryRow = appDb.prepare(`
  INSERT OR REPLACE INTO sybil_verdict_history (
    address,
    version,
    score,
    risk_level,
    signals_json,
    computed_at
  ) VALUES (
    @address,
    @version,
    @score,
    @risk_level,
    @signals_json,
    @computed_at
  )
`);

const pruneSybilVerdictHistoryRows = appDb.prepare(`
  DELETE FROM sybil_verdict_history
  WHERE address = ?
    AND computed_at < (
      SELECT computed_at
      FROM sybil_verdict_history
      WHERE address = ?
      ORDER BY computed_at DESC
      LIMIT 1 OFFSET 30
    )
`);

const selectSybilVerdictHistoryRows = appDb.prepare(`
  SELECT computed_at, score, risk_level
  FROM sybil_verdict_history
  WHERE address = ?
    AND computed_at >= ?
  ORDER BY computed_at ASC
`);

const selectDominantFundingEdgeRow = appDb.prepare(`
  SELECT from_address, token_mint, total_amount, tx_count
  FROM sybil_funding_edges
  WHERE to_address = ?
    AND chain_depth = 1
  ORDER BY total_amount DESC, tx_count DESC, last_seen_at DESC
  LIMIT 1
`);

const loadWalletDatabase = async () => {
  try {
    walletDatabase.clear();
    for (const [addr, entry] of walletStore.entries()) {
      if (addr && entry && typeof entry === 'object') walletDatabase.set(addr, entry);
    }
    console.log(`[wallet-db] Loaded ${walletDatabase.size} wallets from SQLite/JSON`);

    if (walletDatabase.size > 0 && fbAvailable()) {
      fbBatchSet('wallets', [...walletDatabase.entries()])
        .catch(err => console.warn('[wallet-db] Migration failed:', err.message));
    }
  } catch (err) {
    console.warn('[wallet-db] Failed to load', err);
  }
};

const updateWalletEntry = (address, updates) => {
  const existing = walletDatabase.get(address) || { address };
  const merged = { ...existing, ...updates, address };
  walletDatabase.set(address, merged);
  walletStore.set(address, merged);
  saveWalletDatabaseDebounced();
  if (fbAvailable()) {
    fbSet('wallets', address, merged).catch(() => {});
  }
};

// walletDatabase loaded async in initData()

// ── Server-side Achievement tracking (unlocked + claimed per wallet) ──
const ACHIEVEMENTS_STORE_FILE = path.join(METADATA_DIR, 'achievement-claims.json');
// address -> { unlocked: Set<string>, claimed: Set<string> }
const achievementData = new Map();
const achievementStore = createJsonColumnStore({
  jsonPath: ACHIEVEMENTS_STORE_FILE,
  tableName: 'achievements',
  keyColumn: 'address',
  readJson: (parsed) => {
    const entries = new Map(Object.entries(parsed?.data || {}));
    for (const [addr, ids] of Object.entries(parsed?.claims || {})) {
      if (!entries.has(addr) && Array.isArray(ids)) {
        entries.set(addr, { unlocked: ids, claimed: ids });
      }
    }
    return entries;
  },
  writeJson: (entries) => ({
    version: 2,
    updatedAt: new Date().toISOString(),
    data: Object.fromEntries(entries),
  }),
  debounceMs: 500,
  logLabel: 'achievements',
});

const persistAchievementData = () => {
  try {
    const snapshot = new Map();
    for (const [k, v] of achievementData) {
      snapshot.set(k, { unlocked: [...v.unlocked], claimed: [...v.claimed] });
    }
    achievementStore.replaceAll(snapshot);
  } catch (err) {
    console.warn('[achievements] Failed to persist', err);
  }
};

const getWalletAchievements = (address) => {
  return achievementData.get(address) || { unlocked: new Set(), claimed: new Set() };
};

const ACHIEVEMENT_REWARDS_BY_ID = Object.freeze({
  score_10: 25,
  score_50: 50,
  score_100: 100,
  score_200: 200,
  survived_15s: 25,
  survived_30s: 50,
  survived_60s: 100,
  survived_120s: 150,
  survived_180s: 200,
  survived_300s: 300,
  near_miss_1: 15,
  near_miss_5: 30,
  near_miss_25: 75,
  near_miss_50: 100,
  near_miss_100: 150,
  total_games_1: 10,
  total_games_10: 50,
  total_games_50: 100,
  total_games_100: 150,
  first_blood: 25,
  kill_streak_5: 50,
  kill_streak_10: 100,
  boss_slayer: 100,
  boss_rush: 200,
  perfect_wave: 150,
  destroyer_500: 100,
  destroyer_1000: 200,
  destroyer_2000: 300,
  grav_columns_50: 75,
  grav_columns_100: 150,
  grav_crystals_100: 100,
  grav_crystals_500: 200,
  grav_survived_120: 150,
  grav_survived_300: 300,
  first_orbit: 50,
  space_cadet: 50,
  orbit_walker: 150,
  cosmic_veteran: 150,
  asteroid_dancer: 400,
  orbit_legend: 1000,
  persistent_pilot: 50,
  dedicated_captain: 150,
  marathon_runner: 400,
  def_outer_rim: 50,
  def_nebula_front: 150,
  def_dark_sector: 400,
  def_final_stand: 1000,
  def_recruit: 50,
  def_veteran: 150,
  def_exterminator: 400,
  achive_trophy: 400,
  achive_diamond_ship: 1000,
  grav_first_flight: 50,
  grav_smooth_pilot: 50,
  grav_gravity_walker: 150,
  grav_crystal_hunter: 150,
  grav_gravity_veteran: 400,
  grav_column_king: 400,
  grav_marathon: 400,
  grav_gravity_legend: 1000,
  grav_ace: 1000,
});
const VALID_ACHIEVEMENT_IDS = new Set(Object.keys(ACHIEVEMENT_REWARDS_BY_ID));

const markAchievementsUnlocked = (address, achievementIds) => {
  let entry = achievementData.get(address);
  if (!entry) { entry = { unlocked: new Set(), claimed: new Set() }; achievementData.set(address, entry); }
  let changed = false;
  for (const id of achievementIds) {
    if (VALID_ACHIEVEMENT_IDS.has(id) && !entry.unlocked.has(id)) { entry.unlocked.add(id); changed = true; }
  }
  if (changed) persistAchievementData();
  return changed;
};

const claimAchievement = (address, achievementId) => {
  const entry = achievementData.get(address);
  if (!entry) return false; // no entry = nothing unlocked — must earn first
  if (!entry.unlocked.has(achievementId)) return false; // MUST be unlocked before claiming
  if (entry.claimed.has(achievementId)) return false;
  entry.claimed.add(achievementId);
  persistAchievementData();
  return true;
};

const getStoredGameAchievementMetrics = (address) => {
  const walletEntry = walletDatabase.get(address) || {};
  const raw = getWalletUserData(walletEntry)?.gameStats || {};
  return {
    orbit: raw.orbit_survival_stats_v1 || {},
    defender: raw.cosmic_defender_stats_v1 || {},
    gravity: raw.gravity_rush_stats_v1 || {},
  };
};

const isAchievementUnlockVerified = (address, achievementId) => {
  const { orbit, defender, gravity } = getStoredGameAchievementMetrics(address);
  switch (achievementId) {
    case 'first_orbit': return (Number(orbit.bestScore) || 0) >= 15;
    case 'space_cadet': return (Number(orbit.bestScore) || 0) >= 30;
    case 'orbit_walker': return (Number(orbit.bestScore) || 0) >= 60;
    case 'cosmic_veteran': return (Number(orbit.bestScore) || 0) >= 120;
    case 'asteroid_dancer': return (Number(orbit.bestScore) || 0) >= 180;
    case 'orbit_legend': return (Number(orbit.bestScore) || 0) >= 300;
    case 'persistent_pilot': return (Number(orbit.gamesPlayed) || 0) >= 10;
    case 'dedicated_captain': return (Number(orbit.gamesPlayed) || 0) >= 50;
    case 'marathon_runner': return (Number(orbit.totalSurvivalTime) || 0) >= 1800;

    case 'def_outer_rim': return (Number(defender.bestLevel) || 0) >= 1;
    case 'def_nebula_front': return (Number(defender.bestLevel) || 0) >= 2;
    case 'def_dark_sector': return (Number(defender.bestLevel) || 0) >= 3;
    case 'def_final_stand': return (Number(defender.bestLevel) || 0) >= 4;
    case 'def_recruit': return (Number(defender.gamesPlayed) || 0) >= 10;
    case 'def_veteran': return (Number(defender.gamesPlayed) || 0) >= 50;
    case 'def_exterminator': return (Number(defender.totalKills) || 0) >= 500;
    case 'achive_trophy': return (Number(defender.bestScore) || 0) >= 500;
    case 'achive_diamond_ship': return (Number(defender.bestScore) || 0) >= 1500;

    case 'grav_first_flight': return (Number(gravity.bestSurvivalTime) || 0) >= 15;
    case 'grav_smooth_pilot': return (Number(gravity.bestColumns) || 0) >= 30;
    case 'grav_gravity_walker': return (Number(gravity.bestSurvivalTime) || 0) >= 60;
    case 'grav_crystal_hunter': return (Number(gravity.totalCrystals) || 0) >= 100;
    case 'grav_gravity_veteran': return (Number(gravity.bestSurvivalTime) || 0) >= 120;
    case 'grav_column_king': return (Number(gravity.totalColumns) || 0) >= 200;
    case 'grav_marathon': return (Number(gravity.totalPlayTime ?? gravity.totalSurvivalTime ?? gravity.totalTime) || 0) >= 1800;
    case 'grav_gravity_legend': return (Number(gravity.bestSurvivalTime) || 0) >= 300;
    case 'grav_ace': return (Number(gravity.bestSurvivalTime) || 0) >= 180;
    default:
      return false;
  }
};

// ── Server-side Free Revive tracking (3 per day per game mode, requires minted ID) ──
const REVIVES_STORE_FILE = path.join(METADATA_DIR, 'revive-usage.json');
const FREE_REVIVES_PER_DAY = 3;
// address -> { orbit: { date: 'YYYY-MM-DD', used: number }, destroyer: { ... }, gravity: { ... } }
const reviveData = new Map();
const reviveStore = createJsonColumnStore({
  jsonPath: REVIVES_STORE_FILE,
  tableName: 'revives',
  keyColumn: 'address',
  readJson: (parsed) => Object.entries(parsed?.data || {}),
  writeJson: (entries) => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    data: Object.fromEntries(entries),
  }),
  debounceMs: 500,
  logLabel: 'revives',
});

const persistReviveData = () => {
  try {
    reviveStore.replaceAll(reviveData);
  } catch (err) {
    console.warn('[revives] Failed to persist', err);
  }
};

const getRevivesUsedToday = (address, gameMode) => {
  const entry = reviveData.get(address);
  if (!entry) return 0;
  const modeEntry = entry[gameMode];
  if (!modeEntry) return 0;
  return modeEntry.date === getToday() ? (modeEntry.used || 0) : 0;
};

const getRevivesLeft = (address, gameMode) => {
  return Math.max(0, FREE_REVIVES_PER_DAY - getRevivesUsedToday(address, gameMode));
};

const useRevive = (address, gameMode) => {
  const today = getToday();
  let entry = reviveData.get(address);
  if (!entry) { entry = {}; reviveData.set(address, entry); }
  let modeEntry = entry[gameMode];
  if (!modeEntry || modeEntry.date !== today) {
    modeEntry = { date: today, used: 0 };
    entry[gameMode] = modeEntry;
  }
  if (modeEntry.used >= FREE_REVIVES_PER_DAY) return false;
  modeEntry.used++;
  persistReviveData();
  return true;
};

// ═══════════════════════════════════════════════════════════════════════════
// Quest Progress Store
// ═══════════════════════════════════════════════════════════════════════════
const QUEST_PROGRESS_FILE = path.join(METADATA_DIR, 'quest-progress.json');
const questProgress = new Map();
const questProgressStore = createJsonColumnStore({
  jsonPath: QUEST_PROGRESS_FILE,
  tableName: 'quest_progress',
  keyColumn: 'address',
  readJson: (parsed) => Object.entries(parsed?.data || {}),
  writeJson: (entries) => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    data: Object.fromEntries(entries),
  }),
  debounceMs: 500,
  logLabel: 'quests',
});
const persistQuestProgress = () => {
  try {
    questProgressStore.replaceAll(questProgress);
  } catch (err) {
    console.warn('[quests] Failed to persist', err);
  }
};

const QUEST_SOURCE_IDS = Object.freeze({
  quest_daily: new Set(['daily_scan', 'daily_game', 'daily_burn', 'daily_explore', 'daily_highscore']),
  quest_weekly: new Set(['weekly_burn5', 'weekly_games5', 'weekly_arena', 'weekly_streak', 'weekly_forge']),
  quest_milestone: new Set(['ot_first_scan', 'ot_first_mint', 'ot_first_burn', 'ot_first_game', 'ot_reach_sun', 'ot_burn100', 'ot_score1000', 'ot_forge5', 'ot_arena_wins', 'ot_text_quest']),
});
const QUEST_XP_REWARDS = Object.freeze({
  daily_scan: 15,
  daily_game: 30,
  daily_burn: 25,
  daily_explore: 15,
  daily_highscore: 50,
  weekly_burn5: 150,
  weekly_games5: 120,
  weekly_arena: 100,
  weekly_streak: 200,
  weekly_forge: 100,
  ot_first_scan: 50,
  ot_first_mint: 250,
  ot_first_burn: 50,
  ot_first_game: 75,
  ot_reach_sun: 500,
  ot_burn100: 300,
  ot_score1000: 150,
  ot_forge5: 200,
  ot_arena_wins: 200,
  ot_text_quest: 100,
});

const GAME_SOURCE_TO_MODE = Object.freeze({
  game_orbit: 'orbit',
  game_defender: 'destroyer',
  game_gravity: 'gravity',
});

const getUtcDayStartMs = (dateStr = getToday()) => new Date(`${dateStr}T00:00:00.000Z`).getTime();

const getUtcWeekStartMs = (inputMs = Date.now()) => {
  const d = new Date(inputMs);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
};

const getQuestPeriodKey = (questId, nowMs = Date.now()) => {
  if (QUEST_SOURCE_IDS.quest_daily.has(questId)) return getToday();
  if (QUEST_SOURCE_IDS.quest_weekly.has(questId)) return new Date(getUtcWeekStartMs(nowMs)).toISOString().slice(0, 10);
  return 'all_time';
};

const getBlackHoleResolvedCountFromTx = (tx) => {
  const match = String(tx?.description || '').match(/\((\d+)\s+resolved\)/i);
  return match ? (Number(match[1]) || 0) : 0;
};

const _questProgressCache = new Map();
const invalidateQuestProgressCache = (address) => {
  if (address) _questProgressCache.delete(address);
  else _questProgressCache.clear();
};
const getQuestProgressSnapshot = (address, nowMs = Date.now()) => {
  const _cached = _questProgressCache.get(address);
  if (_cached && nowMs - _cached.ts < 30_000) return _cached.data;
  const walletEntry = walletDatabase.get(address) || {};
  const userData = getWalletUserData(walletEntry);
  const forgeState = getOrCreateForgeState(address, walletEntry).forgeState;
  const txs = prismTransactions.get(address) || [];
  const dayStart = getUtcDayStartMs();
  const weekStart = getUtcWeekStartMs(nowMs);
  const parseTs = (value) => {
    const ts = new Date(value || 0).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  const scoreEntries = leaderboardEntries.filter((entry) => entry.address === address);
  const todayScoreEntries = scoreEntries.filter((entry) => parseTs(entry.playedAt || entry.timestamp) >= dayStart);
  const weekScoreEntries = scoreEntries.filter((entry) => parseTs(entry.playedAt || entry.timestamp) >= weekStart);
  const priorScoreEntries = scoreEntries.filter((entry) => parseTs(entry.playedAt || entry.timestamp) < dayStart);

  const scanDailyEntry = getPrismEarnRateLimit(`scan_daily:${address}`);
  const scansToday = (scanDailyEntry && typeof scanDailyEntry === 'object' && scanDailyEntry.date === getToday())
    ? (Number(scanDailyEntry.count) || 0)
    : 0;

  const burnsAllTime = txs
    .filter((tx) => tx?.source === 'blackhole_cleanup')
    .reduce((sum, tx) => sum + getBlackHoleResolvedCountFromTx(tx), 0);
  const burnsToday = txs
    .filter((tx) => tx?.source === 'blackhole_cleanup' && parseTs(tx.timestamp) >= dayStart)
    .reduce((sum, tx) => sum + getBlackHoleResolvedCountFromTx(tx), 0);
  const burnsWeek = txs
    .filter((tx) => tx?.source === 'blackhole_cleanup' && parseTs(tx.timestamp) >= weekStart)
    .reduce((sum, tx) => sum + getBlackHoleResolvedCountFromTx(tx), 0);

  const sybilToday = txs.filter((tx) => tx?.source === 'sybil_hunt' && parseTs(tx.timestamp) >= dayStart).length;

  const weeklyForgePurchases = txs.filter((tx) => {
    if (tx?.type !== 'spend') return false;
    if (parseTs(tx.timestamp) < weekStart) return false;
    return typeof tx?.source === 'string' && tx.source.startsWith('forge_') && tx.source !== 'forge_module';
  }).length;

  const weeklyArenaBattles = challenges.filter((challenge) => {
    if (challenge.status !== 'completed') return false;
    if (challenge.creator !== address && challenge.opponent !== address) return false;
    return parseTs(challenge.completedAt || challenge.createdAt) >= weekStart;
  }).length;

  const totalArenaWins = challenges.filter((challenge) => challenge.status === 'completed' && challenge.winner === address).length;
  const bestScoreEver = Math.max(0, ...scoreEntries.map((entry) => Number(entry.score) || 0), 0);
  const bestScoreBeforeToday = Math.max(0, ...priorScoreEntries.map((entry) => Number(entry.score) || 0), 0);
  const bestScoreToday = Math.max(0, ...todayScoreEntries.map((entry) => Number(entry.score) || 0), 0);
  const completedTextQuests = Object.values(userData?.textQuests || {}).filter((quest) => quest && quest.completed).length;
  const compositeTier = calculateCompositeScore(buildCompositeInput(address)).compositeTier;
  const existing = questProgress.get(address) || { streakDays: 0 };
  const forgeItemsOwned = Array.isArray(forgeState.items) ? forgeState.items.length : 0;

  const _result = {
    daily_scan: { progress: Math.min(1, scansToday), completed: scansToday >= 1, periodKey: getQuestPeriodKey('daily_scan', nowMs) },
    daily_game: { progress: Math.min(1, todayScoreEntries.length), completed: todayScoreEntries.length >= 1, periodKey: getQuestPeriodKey('daily_game', nowMs) },
    daily_burn: { progress: Math.min(1, burnsToday), completed: burnsToday >= 1, periodKey: getQuestPeriodKey('daily_burn', nowMs) },
    daily_explore: { progress: Math.min(1, sybilToday), completed: sybilToday >= 1, periodKey: getQuestPeriodKey('daily_explore', nowMs) },
    daily_highscore: { progress: bestScoreToday > bestScoreBeforeToday ? 1 : 0, completed: bestScoreToday > bestScoreBeforeToday, periodKey: getQuestPeriodKey('daily_highscore', nowMs) },

    weekly_burn5: { progress: Math.min(5, burnsWeek), completed: burnsWeek >= 5, periodKey: getQuestPeriodKey('weekly_burn5', nowMs) },
    weekly_games5: { progress: Math.min(5, weekScoreEntries.length), completed: weekScoreEntries.length >= 5, periodKey: getQuestPeriodKey('weekly_games5', nowMs) },
    weekly_arena: { progress: Math.min(3, weeklyArenaBattles), completed: weeklyArenaBattles >= 3, periodKey: getQuestPeriodKey('weekly_arena', nowMs) },
    weekly_streak: { progress: Math.min(5, Number(existing.streakDays) || 0), completed: (Number(existing.streakDays) || 0) >= 5, periodKey: getQuestPeriodKey('weekly_streak', nowMs) },
    weekly_forge: { progress: Math.min(1, weeklyForgePurchases), completed: weeklyForgePurchases >= 1, periodKey: getQuestPeriodKey('weekly_forge', nowMs) },

    ot_first_scan: { progress: Math.min(1, Number(walletEntry.scanCount) || 0), completed: (Number(walletEntry.scanCount) || 0) >= 1, periodKey: 'all_time' },
    ot_first_mint: { progress: mintedAddresses.has(address) ? 1 : 0, completed: mintedAddresses.has(address), periodKey: 'all_time' },
    ot_first_burn: { progress: Math.min(1, burnsAllTime), completed: burnsAllTime >= 1, periodKey: 'all_time' },
    ot_first_game: { progress: Math.min(1, scoreEntries.length), completed: scoreEntries.length >= 1, periodKey: 'all_time' },
    ot_reach_sun: { progress: ['sun', 'binary_sun'].includes(compositeTier) ? 1 : 0, completed: ['sun', 'binary_sun'].includes(compositeTier), periodKey: 'all_time' },
    ot_burn100: { progress: Math.min(100, burnsAllTime), completed: burnsAllTime >= 100, periodKey: 'all_time' },
    ot_score1000: { progress: Math.min(1000, bestScoreEver), completed: bestScoreEver >= 1000, periodKey: 'all_time' },
    ot_forge5: { progress: Math.min(5, forgeItemsOwned), completed: forgeItemsOwned >= 5, periodKey: 'all_time' },
    ot_arena_wins: { progress: Math.min(10, totalArenaWins), completed: totalArenaWins >= 10, periodKey: 'all_time' },
    ot_text_quest: { progress: Math.min(1, completedTextQuests), completed: completedTextQuests >= 1, periodKey: 'all_time' },
  };
  _questProgressCache.set(address, { data: _result, ts: nowMs });
  return _result;
};

const verifyGameEarnClaim = (address, source, gameSessionId) => {
  if (!gameSessionId) return { ok: false, error: 'gameSessionId required' };
  const session = gameSessionProofs.get(gameSessionId);
  if (!session || !session.verified) return { ok: false, error: 'Invalid or unverified game session' };
  if (session.walletAddress !== address) return { ok: false, error: 'Session wallet mismatch' };
  if (session.usedForChallenge) return { ok: false, error: 'Challenge game — coins earned from challenge result' };
  const expectedMode = GAME_SOURCE_TO_MODE[source];
  if (expectedMode && session.gameMode && session.gameMode !== expectedMode) return { ok: false, error: 'Session gameMode mismatch' };
  if (session.prismEarnClaims?.[source]) return { ok: false, error: 'Reward already claimed for this session' };
  return { ok: true, session };
};

const markGameEarnClaimed = (gameSessionId, source, earned) => {
  const session = gameSessionProofs.get(gameSessionId);
  if (!session) return;
  session.prismEarnClaims = {
    ...(session.prismEarnClaims || {}),
    [source]: { at: Date.now(), earned },
  };
  gameSessionProofs.set(gameSessionId, session);
  persistGameSessionProofs();
};

const PUBLIC_REPUTATION_TTL_SECONDS = 300;

const buildRpcUrl = (apiKey) => {
  if (!HELIUS_RPC_BASE) return null;
  // Don't use Helius URL without an API key — it will fail with 401
  if (!apiKey) return null;
  const targetUrl = new URL(HELIUS_RPC_BASE);
  targetUrl.searchParams.set('api-key', apiKey);
  return targetUrl.toString();
};

const getRpcUrl = (seed) => {
  if (!HELIUS_KEYS.length) {
    return buildRpcUrl(null) || ALCHEMY_RPC_URL || FALLBACK_RPC_URL || 'https://api.mainnet-beta.solana.com';
  }
  const apiKey = pickHeliusKey(seed, HELIUS_KEYS);
  if (!apiKey) return ALCHEMY_RPC_URL || FALLBACK_RPC_URL || 'https://api.mainnet-beta.solana.com';
  return buildRpcUrl(apiKey);
};

const getRpcUrls = (seed) => {
  if (!HELIUS_KEYS.length) {
    const fallbackUrl = buildRpcUrl(null) || ALCHEMY_RPC_URL || FALLBACK_RPC_URL || 'https://api.mainnet-beta.solana.com';
    return fallbackUrl ? [fallbackUrl] : [];
  }
  const startIndex = Math.max(0, HELIUS_KEYS.indexOf(pickHeliusKey(seed, HELIUS_KEYS)));
  return HELIUS_KEYS.map((_, index) => {
    const key = HELIUS_KEYS[(startIndex + index) % HELIUS_KEYS.length];
    return buildRpcUrl(key);
  }).filter(Boolean);
};

// ── JSON-RPC batch helper: up to 100 getTransaction per HTTP call ──
// Tries batch first (supported by Alchemy, Helius paid plans).
// Falls back to sequential single calls if batch is rejected (Helius free = 403).
let _batchSupported = new Map(); // rpcUrl → boolean (cache per-provider)

// Prefer Alchemy for batch calls (it supports JSON-RPC batch on all plans)
function getBatchRpcUrl(seed) {
  if (ALCHEMY_RPC_URL) return ALCHEMY_RPC_URL;
  return getRpcUrl(seed);
}

async function batchGetParsedTxs(rpcUrl, signatures, { batchSize = 100, delayMs = 300 } = {}) {
  if (!signatures.length) return [];
  const results = new Array(signatures.length).fill(null);

  // Check if this RPC supports batching
  const batchOk = _batchSupported.get(rpcUrl);
  if (batchOk === false) {
    // Fallback: sequential single calls
    return _sequentialGetParsedTxs(rpcUrl, signatures, delayMs);
  }

  for (let offset = 0; offset < signatures.length; offset += batchSize) {
    const chunk = signatures.slice(offset, Math.min(offset + batchSize, signatures.length));
    const payload = chunk.map((sig, idx) => ({
      jsonrpc: '2.0',
      id: offset + idx,
      method: 'getTransaction',
      params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
    }));
    try {
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.status === 403) {
        // Batch not supported on this plan — fallback to sequential forever
        _batchSupported.set(rpcUrl, false);
        console.log('[rpc-batch] Batch not supported on', rpcUrl.replace(/api-key=[^&]+/, 'api-key=***'), '— falling back to sequential');
        return _sequentialGetParsedTxs(rpcUrl, signatures, delayMs);
      }
      if (!r.ok) {
        if (r.status === 429 || r.status >= 500) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const retry = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (retry.ok) {
            const data = await retry.json();
            if (Array.isArray(data)) {
              for (const item of data) {
                if (item && typeof item.id === 'number' && item.result) results[item.id] = item.result;
              }
            }
          }
        }
        if (offset + batchSize < signatures.length) await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      const data = await r.json();
      if (Array.isArray(data)) {
        _batchSupported.set(rpcUrl, true);
        for (const item of data) {
          if (item && typeof item.id === 'number' && item.result) results[item.id] = item.result;
        }
      } else if (data?.error?.code === -32403) {
        // Batch rejected in response body
        _batchSupported.set(rpcUrl, false);
        return _sequentialGetParsedTxs(rpcUrl, signatures, delayMs);
      }
    } catch { /* network error — skip this batch */ }
    if (offset + batchSize < signatures.length) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}

// Sequential fallback: individual getTransaction calls (for free-tier RPC)
async function _sequentialGetParsedTxs(rpcUrl, signatures, delayMs = 50) {
  const results = new Array(signatures.length).fill(null);
  for (let i = 0; i < signatures.length; i++) {
    try {
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getTransaction',
          params: [signatures[i], { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
        }),
      });
      if (r.status === 429) {
        // Rate limited — pause and retry once
        await new Promise(resolve => setTimeout(resolve, 2000));
        const retry = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'getTransaction',
            params: [signatures[i], { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
          }),
        });
        if (retry.ok) {
          const d = await retry.json();
          results[i] = d?.result || null;
        }
        continue;
      }
      if (r.ok) {
        const d = await r.json();
        results[i] = d?.result || null;
      }
    } catch { /* skip */ }
    // Small delay between calls to avoid rate limits
    if (i < signatures.length - 1 && (i + 1) % 10 === 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

const parseSecretKey = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  try {
    if (trimmed.startsWith('[')) {
      return Uint8Array.from(JSON.parse(trimmed));
    }
  } catch {
    // ignore
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded.trim().startsWith('[')) {
      return Uint8Array.from(JSON.parse(decoded));
    }
  } catch {
    // ignore
  }
  return null;
};

const loadSecretKeyFromFile = (filePath) => {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return Uint8Array.from(parsed);
    }
  } catch {
    // ignore
  }
  return null;
};

const parsePublicKey = (value, label) => {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid public key`);
  }
};

const resolveCorsOrigin = (req) => {
  const origin = String(req?.headers?.origin ?? '').trim();
  const configured = String(CORS_ORIGIN ?? '').trim();
  if (!origin) {
    return configured || '*';
  }
  if (!configured || configured === '*') {
    return 'https://identityprism.xyz'; // safe default, not wildcard
  }
  const allowList = configured.split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowList.length) {
    return 'https://identityprism.xyz'; // safe default, not wildcard
  }
  if (allowList.includes('*')) {
    return 'https://identityprism.xyz'; // safe default, not wildcard
  }
  if (allowList.includes(origin)) {
    return origin;
  }
  // localhost bypass removed for security — use CORS_ORIGIN env to whitelist dev origins
  return allowList[0];
};

const applyCors = (req, res) => {
  const requestUrl = typeof req.url === 'string' ? req.url : '';
  if (requestUrl.startsWith('/api/actions/') || requestUrl.startsWith('/actions.json')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids, X-Wallet-Address, Solana-Client'
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-Action-Version,X-Blockchain-Ids');
    res.setHeader('X-Action-Version', '2.1.3');
    res.setHeader('X-Blockchain-Ids', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', resolveCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization,x-wallet-address,solana-client,x-action-version,x-blockchain-ids,x-admin-key,x-api-key,x-client-version');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Action-Version,X-Blockchain-Ids,X-API-Version');
  res.setHeader('X-Action-Version', '2.1.3');
  res.setHeader('X-Blockchain-Ids', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
};

const getBaseUrl = (req) => {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  // Only trust forwarded headers from trusted proxies (same as getClientIp)
  const socketIp = req.socket?.remoteAddress || '';
  if (TRUSTED_PROXIES.has(socketIp)) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
    const forwardedHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
    const proto = forwardedProto || 'http';
    const host = forwardedHost || req.headers.host;
    return host ? `${proto}://${host}` : '';
  }
  const host = req.headers.host;
  return host ? `http://${host}` : '';
};

const safeParseJson = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const getRpcAccessToken = (req) => {
  const header = req.headers['authorization'] ?? '';
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  const tokenHeader = req.headers['x-rpc-token'];
  return Array.isArray(tokenHeader) ? tokenHeader[0] : (tokenHeader || '');
};

const validateRpcPayload = (payload) => {
  const calls = Array.isArray(payload) ? payload : [payload];
  if (!calls.length || calls.length > 10) return { ok: false, error: 'Invalid RPC batch size' };
  for (const call of calls) {
    const method = typeof call?.method === 'string' ? call.method : '';
    if (!RPC_METHODS.has(method)) return { ok: false, error: `RPC method not allowed: ${method || 'unknown'}` };
    if (method === 'getProgramAccounts') {
      const filters = call?.params?.[1]?.filters;
      if (!Array.isArray(filters) || filters.length === 0) {
        return { ok: false, error: 'getProgramAccounts requires filters' };
      }
    }
  }
  return { ok: true };
};

const createGameSessionProofId = (slot, hash) => `mb-${slot}-${String(hash).slice(0, 16)}`;

const toPublicGameSessionProof = (entry) => ({
  id: entry.id,
  hash: entry.hash,
  walletAddress: entry.walletAddress,
  score: entry.score,
  survivalTime: entry.survivalTime,
  seed: entry.seed,
  slot: entry.slot,
  startedAtMs: entry.startedAtMs,
  endedAtMs: entry.endedAtMs,
  durationMs: entry.durationMs,
  scoreDelta: entry.scoreDelta,
  verified: entry.verified,
  proofUrl: entry.proofUrl,
  verification: entry.verification,
  createdAt: entry.createdAt,
  lastVerifiedAt: entry.lastVerifiedAt,
});

const callMagicBlockRpc = async (method, params = []) => {
  if (!MAGICBLOCK_RPC) throw new Error('MagicBlock RPC URL is not configured');
  const response = await fetch(MAGICBLOCK_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `identity-prism-${Date.now()}`,
      method,
      params,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`MagicBlock RPC ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload?.error?.message ?? 'MagicBlock RPC error');
  }
  return payload?.result;
};

const verifyMagicBlockSeedSlot = async (seed, slot) => {
  const verification = {
    rpcHealthy: false,
    slotFound: false,
    seedMatchesSlot: false,
    slotBlockhash: null,
    slotBlockTimeMs: null,
    reason: 'unverified',
  };

  try {
    const health = await callMagicBlockRpc('getHealth', []);
    verification.rpcHealthy = health === 'ok';
  } catch {
    verification.rpcHealthy = false;
  }

  try {
    const block = await callMagicBlockRpc('getBlock', [
      slot,
      {
        commitment: 'confirmed',
        transactionDetails: 'none',
        rewards: false,
        maxSupportedTransactionVersion: 0,
      },
    ]);
    const blockhash = typeof block?.blockhash === 'string' ? block.blockhash : '';
    verification.slotFound = Boolean(blockhash);
    verification.slotBlockhash = blockhash || null;
    verification.slotBlockTimeMs = Number.isFinite(Number(block?.blockTime))
      ? Math.floor(Number(block.blockTime) * 1000)
      : null;
    verification.seedMatchesSlot = Boolean(blockhash) && blockhash === seed;
  } catch {
    verification.slotFound = false;
    verification.seedMatchesSlot = false;
    verification.slotBlockhash = null;
    verification.slotBlockTimeMs = null;
  }

  if (!verification.rpcHealthy && !verification.slotFound) {
    verification.reason = 'MagicBlock RPC unavailable';
  } else if (!verification.slotFound) {
    verification.reason = 'Slot not found on MagicBlock RPC';
  } else if (!verification.seedMatchesSlot) {
    verification.reason = 'Seed does not match slot blockhash';
  } else {
    verification.reason = 'Seed matches MagicBlock slot blockhash';
  }

  return verification;
};

const normalizeGameSessionPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid session payload');
  }

  const walletAddress = typeof payload.walletAddress === 'string' && payload.walletAddress.trim()
    ? payload.walletAddress.trim()
    : null;
  const score = Number(payload.score);
  const survivalTimeRaw = typeof payload.survivalTime === 'string' ? payload.survivalTime.trim() : '';
  const seed = String(payload.seed ?? '').trim();
  const slot = Number(payload.slot);
  const startedAtMs = Number(payload.startedAtMs);
  const endedAtMs = Number(payload.endedAtMs);
  const txSignature = typeof payload.txSignature === 'string' && payload.txSignature.trim()
    ? payload.txSignature.trim()
    : null;
  const VALID_GAME_MODES = new Set(['orbit', 'destroyer', 'gravity']);
  const gameMode = typeof payload.gameMode === 'string' ? payload.gameMode.trim() : 'orbit';
  if (!VALID_GAME_MODES.has(gameMode)) throw new Error('invalid gameMode');

  const MAX_SESSION_SCORE = 1_000_000;
  if (!Number.isFinite(score) || score < 0 || score > MAX_SESSION_SCORE) {
    throw new Error('score must be a non-negative number');
  }
  if (!seed || seed.length < 16) {
    throw new Error('seed is required');
  }
  if (!Number.isInteger(slot) || slot <= 0) {
    throw new Error('slot must be a positive integer');
  }
  const CLOCK_SKEW_MS = 30_000;
  const now = Date.now();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs < startedAtMs) {
    throw new Error('startedAtMs/endedAtMs are invalid');
  }
  if (startedAtMs > now + CLOCK_SKEW_MS || endedAtMs > now + CLOCK_SKEW_MS) {
    throw new Error('session timestamps are in the future');
  }
  const MAX_SESSION_AGE_MS = 20 * 60 * 1000;
  if (startedAtMs < now - MAX_SESSION_AGE_MS || endedAtMs < now - MAX_SESSION_AGE_MS) {
    throw new Error('session timestamps are too old');
  }
  const MAX_SESSION_DURATION_MS = 15 * 60 * 1000;
  if (endedAtMs - startedAtMs > MAX_SESSION_DURATION_MS) {
    throw new Error('session duration exceeds maximum');
  }

  return {
    walletAddress,
    score: Math.floor(score),
    survivalTime: survivalTimeRaw || '0:00',
    seed,
    slot,
    startedAtMs: Math.floor(startedAtMs),
    endedAtMs: Math.floor(endedAtMs),
    txSignature,
    gameMode,
  };
};

const resolveMetadataFile = (rawName) => {
  const trimmed = rawName.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) return null;
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
};

const resolveAssetFile = (rawName) => {
  const trimmed = rawName.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) return null;
  return trimmed;
};

const getContentType = (fileName) => {
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg';
  if (fileName.endsWith('.webp')) return 'image/webp';
  if (fileName.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
};

const sendImageDataUrl = (res, dataUrl) => {
  const match = /^data:(image\/[-a-zA-Z0-9.+]+);base64,(.+)$/.exec(dataUrl ?? '');
  if (!match) {
    respondJson(res, 500, { error: 'Invalid image payload' });
    return;
  }
  const [, contentType, data] = match;
  const buffer = Buffer.from(data, 'base64');
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
  res.end(buffer);
};

const normalizeFloorSol = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  // Values > 1000 assumed to be in lamports → convert to SOL
  if (numeric > 1000) return numeric / LAMPORTS_PER_SOL;
  return numeric;
};

const fetchMagicEdenCollectionStats = async (symbol) => {
  if (!symbol) return null;
  try {
    const response = await fetch(
      `https://api-mainnet.magiceden.dev/v2/collections/${encodeURIComponent(symbol)}/stats`
    );
    if (!response.ok) {
      if (response.status === 404) {
        return { status: 'not_listed', floorSol: null, source: 'magic_eden' };
      }
      return null;
    }
    const data = await response.json();
    const floorSol = normalizeFloorSol(data?.floorPrice ?? data?.floor_price ?? data?.floor);
    return { status: 'listed', floorSol: floorSol ?? null, source: 'magic_eden' };
  } catch (error) {
    console.warn('[market] Magic Eden stats failed', error);
    return null;
  }
};

const fetchMeSlugByMint = async (mint) => {
  if (!mint) return null;
  try {
    const response = await fetch(
      `https://api-mainnet.magiceden.dev/v2/tokens/${encodeURIComponent(mint)}`
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data?.collection || null;
  } catch {
    return null;
  }
};

const fetchTensorCollectionStats = async (collectionId) => {
  if (!collectionId) return null;
  const endpoints = [
    `https://api.tensor.so/sol/collections/${collectionId}/stats`,
    `https://api.tensor.so/sol/collections/${collectionId}`,
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        if (response.status === 404) {
          return { status: 'not_listed', floorSol: null, source: 'tensor' };
        }
        continue;
      }
      const data = await response.json();
      const floorCandidate =
        data?.floorPrice ??
        data?.floor ??
        data?.stats?.floorPrice ??
        data?.stats?.floor ??
        data?.collection?.floorPrice ??
        data?.collection?.floor;
      const floorSol = normalizeFloorSol(floorCandidate);
      return { status: 'listed', floorSol: floorSol ?? null, source: 'tensor' };
    } catch (error) {
      console.warn('[market] Tensor stats failed', error);
    }
  }
  return null;
};

const fetchMeTokenLastPrice = async (mint) => {
  if (!mint) return null;
  try {
    const response = await fetch(
      `https://api-mainnet.magiceden.dev/v2/tokens/${encodeURIComponent(mint)}/activities?offset=0&limit=5`
    );
    if (!response.ok) return null;
    const activities = await response.json();
    if (!Array.isArray(activities) || activities.length === 0) return null;
    // Find most recent sale/listing with a price
    for (const act of activities) {
      if (act.price && act.price > 0 && ['buyNow', 'list', 'bid_won', 'mint'].includes(act.type)) {
        return normalizeFloorSol(act.price);
      }
    }
    // Fallback: any activity with a price
    for (const act of activities) {
      if (act.price && act.price > 0) {
        return normalizeFloorSol(act.price);
      }
    }
    return null;
  } catch {
    return null;
  }
};

const fetchSolPriceUsd = async () => {
  // 1. Binance public ticker (no auth, no rate limit for public data)
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
    if (response.ok) {
      const data = await response.json();
      const price = Number(data?.price);
      if (Number.isFinite(price) && price > 1) return price;
    }
  } catch {}
  // 2. Kraken public ticker (no auth)
  try {
    const response = await fetch('https://api.kraken.com/0/public/Ticker?pair=SOLUSD');
    if (response.ok) {
      const data = await response.json();
      const key = data?.result && Object.keys(data.result)[0];
      const price = Number(key && data.result[key]?.c?.[0]);
      if (Number.isFinite(price) && price > 1) return price;
    }
  } catch {}
  // 3. DexScreener — only use pairs where wSOL is the BASE token (not quote)
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
    if (res.ok) {
      const j = await res.json();
      const wSOL = 'So11111111111111111111111111111111111111112';
      const pair = j?.pairs?.find(p => p?.priceUsd && p?.baseToken?.address === wSOL && Number(p.priceUsd) > 1);
      const price = Number(pair?.priceUsd);
      if (Number.isFinite(price) && price > 1) return price;
    }
  } catch {}
  // 4. CoinGecko (free tier — may hit rate limits)
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    if (response.ok) {
      const data = await response.json();
      const price = Number(data?.solana?.usd);
      if (Number.isFinite(price) && price > 1) return price;
    }
  } catch {}
  return null;
};

const fetchSkrPriceUsd = async () => {
  // 1. DexScreener — SKR is base token in its pairs, so priceUsd is correct
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SKR_MINT}`);
    if (res.ok) {
      const j = await res.json();
      const pair = j?.pairs?.find(p => p?.priceUsd && Number(p.priceUsd) > 0);
      const price = Number(pair?.priceUsd);
      if (Number.isFinite(price) && price > 0) return price;
    }
  } catch {}
  // 2. CoinGecko (free tier — may hit rate limits)
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=seeker&vs_currencies=usd'
    );
    if (response.ok) {
      const data = await response.json();
      const price = Number(data?.seeker?.usd ?? data?.usd ?? data?.price);
      if (Number.isFinite(price) && price > 0) return price;
    }
  } catch {}
  return null;
};

const computeSkrQuote = (solUsd, skrUsd) => {
  if (!Number.isFinite(solUsd) || !Number.isFinite(skrUsd) || skrUsd <= 0) return null;
  const baseUsd = MINT_PRICE_SOL * solUsd;
  const rawAmount = baseUsd / skrUsd;
  const amount = Math.max(1, Math.ceil(rawAmount));
  return {
    amount,
    rawAmount,
    solUsd,
    skrUsd,
    baseUsd,
  };
};

const getSkrQuote = async () => {
  try {
    const [solUsd, skrUsd] = await Promise.all([getCachedSolPriceUsd(), getCachedSkrPriceUsd()]);
    return computeSkrQuote(solUsd, skrUsd);
  } catch (error) {
    console.warn('[market] mint quote unavailable:', error?.message || error);
    return null;
  }
};

const fetchAssetsByOwner = async (rpcUrls, owner) => {
  for (const rpcUrl of rpcUrls) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'identity-prism-scan',
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: owner,
            page: 1,
            limit: 1000,
            displayOptions: { showCollectionMetadata: true },
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`DAS API returned ${response.status}`);
      }
      const payload = await response.json();
      if (payload?.error) {
        throw new Error(payload.error.message || 'DAS API error');
      }
      return Array.isArray(payload?.result?.items) ? payload.result.items : [];
    } catch (error) {
      console.warn('[das] fetch assets failed', error);
    }
  }
  return [];
};

const fetchIdentitySnapshot = async (address) => {
  const rpcUrls = getRpcUrls(address);
  const rpcUrl = rpcUrls[0];
  if (!rpcUrl) {
    throw new Error('Helius API key required');
  }
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
  const pubkey = new PublicKey(address);
  const fetchSignatures = async () => {
    const signatures = [];
    let before;
    const maxPages = Number.isFinite(MAX_SIGNATURE_PAGES) && MAX_SIGNATURE_PAGES > 0
      ? MAX_SIGNATURE_PAGES
      : Number.POSITIVE_INFINITY;
    for (let page = 0; page < maxPages; page += 1) {
      try {
        const pageSignatures = await connection.getSignaturesForAddress(pubkey, {
          limit: SIGNATURE_PAGE_LIMIT,
          ...(before ? { before } : {}),
        });
        if (!pageSignatures.length) break;
        signatures.push(...pageSignatures);
        before = pageSignatures[pageSignatures.length - 1]?.signature;
        if (!before || pageSignatures.length < SIGNATURE_PAGE_LIMIT) break;
      } catch (err) {
        console.warn(`[fetchSignatures] page ${page + 1} failed for ${address.slice(0, 8)}:`, err.message);
        break; // keep what we have so far
      }
    }
    return signatures;
  };
  const [balance, signatures, tokenAccounts, assets] = await Promise.all([
    connection.getBalance(pubkey),
    fetchSignatures(),
    connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
    fetchAssetsByOwner(rpcUrls, address),
  ]);

  const solBalance = balance / LAMPORTS_PER_SOL;
  const sigCount = signatures.length;
  const oldest = signatures[signatures.length - 1];
  // Use cached data from walletDatabase when available
  const cachedEntry = walletDatabase.get(address);
  const cachedTxCount = cachedEntry?.stats?.transactions || 0;
  const cachedFirstTx = cachedEntry?.firstTxTimestamp || null;

  // For high-tx wallets: findFirstTxTime paginates fully → returns exact firstTxTime + totalSigs
  // For low-tx wallets: pagination oldest is exact
  let firstTxTime;
  let txCount;
  if (sigCount >= SIGNATURE_PAGE_LIMIT) {
    try {
      const result = await findFirstTxTime(connection, pubkey, signatures, cachedFirstTx, rpcUrl);
      firstTxTime = result.firstTxTime;
      txCount = Math.max(result.totalSigs, cachedTxCount);
    } catch {
      firstTxTime = cachedFirstTx || oldest?.blockTime || null;
      txCount = Math.max(sigCount, cachedTxCount);
    }
    // Use the older (smaller) of new vs cached — first tx never gets newer
    if (cachedFirstTx && firstTxTime && cachedFirstTx < firstTxTime) {
      firstTxTime = cachedFirstTx;
    }
  } else {
    firstTxTime = oldest?.blockTime || null;
    txCount = Math.max(sigCount, cachedTxCount);
  }

  let nftCount = 0;
  let uniqueTokenCount = 0;
  let hasSeeker = false;
  let hasPreorder = false;
  let isBlueChip = false;
  let hasLstExposure = false;
  let defiProtocolExposure = false;
  let memeValueUSD = 0;
  const memeHoldingsSet = new Set();

  const foundPreorderAsset = assets.find((asset) => {
    const content = asset?.content || {};
    const metadata = content.metadata || {};
    const grouping = asset?.grouping || [];
    const collectionGroup = grouping.find((group) => group.group_key === 'collection');
    const collectionMetadata = collectionGroup?.collection_metadata || {};
    const mintExtensions = asset?.mint_extensions || {};
    const tokenGroup = mintExtensions?.token_group_member?.group;
    const metadataPointer = mintExtensions?.metadata_pointer?.metadata_address;
    const groupMemberPointer = mintExtensions?.group_member_pointer?.member_address;
    const rawName = (metadata.name || collectionMetadata.name || content.metadata?.name || asset?.id || '');
    const name = rawName.toLowerCase();
    const collectionName = String(collectionMetadata.name || '').toLowerCase();
    return (
      asset?.id === TOKEN_ADDRESSES.CHAPTER2_PREORDER ||
      tokenGroup === PREORDER_COLLECTION ||
      metadataPointer === PREORDER_COLLECTION ||
      name.includes('chapter 2') ||
      name.includes('seeker preorder') ||
      collectionName.includes('chapter 2') ||
      collectionName.includes('seeker preorder') ||
      grouping.some((group) => group.group_value === PREORDER_COLLECTION)
    );
  });
  if (foundPreorderAsset) {
    hasPreorder = true;
  }

  assets.forEach((asset) => {
    const content = asset?.content || {};
    const metadata = content.metadata || {};
    const mint = asset.id;

    const grouping = asset.grouping || [];
    const collectionGroup = grouping.find((group) => group.group_key === 'collection');
    const collectionMetadata = collectionGroup?.collection_metadata || {};
    const rawName = (metadata.name || collectionMetadata.name || content.metadata?.name || asset.id || '');
    const rawSymbol = (metadata.symbol || collectionMetadata.symbol || content.metadata?.symbol || '');
    const name = rawName.toLowerCase();
    const symbol = rawSymbol.toLowerCase();
    const collectionName = String(collectionMetadata.name || '').toLowerCase();
    const collectionSymbol = String(collectionMetadata.symbol || '').toLowerCase();
    const authorities = asset.authorities || [];
    const creators = asset.creators || [];
    const mintExtensions = asset?.mint_extensions || {};
    const tokenGroup = mintExtensions?.token_group_member?.group;
    const metadataPointer = mintExtensions?.metadata_pointer?.metadata_address;
    const groupMemberPointer = mintExtensions?.group_member_pointer?.member_address;

    const isSeekerNamed =
      (
        name.includes('seeker') ||
        symbol.includes('seeker') ||
        collectionName.includes('seeker') ||
        collectionSymbol.includes('seeker')
      ) &&
      !name.includes('preorder') &&
      !name.includes('chapter 2') &&
      !collectionName.includes('preorder') &&
      !collectionName.includes('chapter 2');

    const isSeekerGenesis =
      collectionGroup?.group_value === TOKEN_ADDRESSES.SEEKER_GENESIS_COLLECTION ||
      tokenGroup === TOKEN_ADDRESSES.SEEKER_GENESIS_COLLECTION ||
      metadataPointer === TOKEN_ADDRESSES.SEEKER_GENESIS_COLLECTION ||
      groupMemberPointer === TOKEN_ADDRESSES.SEEKER_GENESIS_COLLECTION ||
      authorities.some((auth) => auth.address === TOKEN_ADDRESSES.SEEKER_MINT_AUTHORITY) ||
      creators.some((creator) => creator.address === TOKEN_ADDRESSES.SEEKER_MINT_AUTHORITY);

    if (isSeekerGenesis) hasSeeker = true;

    const isChapter2Preorder =
      mint === TOKEN_ADDRESSES.CHAPTER2_PREORDER ||
      tokenGroup === PREORDER_COLLECTION ||
      metadataPointer === PREORDER_COLLECTION ||
      grouping.some((group) => group.group_value === PREORDER_COLLECTION) ||
      // Name-based fallback — require verified creator to prevent spoofing (+15 pts)
      ((name.includes('chapter 2') || name.includes('seeker preorder') ||
        collectionName.includes('chapter 2') || collectionName.includes('seeker preorder')) &&
        creators.some((c) => c.verified === true));

    if (isChapter2Preorder) hasPreorder = true;

    const iface = (asset.interface || '').toUpperCase();
    const tokenInfo = asset.token_info || {};
    const decimals = tokenInfo.decimals ?? (isFungibleAsset(asset) ? 9 : 0);

    // Skip burnt assets (matches frontend)
    if (asset.burnt) return;

    const isExplicitNFT =
      iface.includes('NFT') ||
      iface.includes('PROGRAMMABLE') ||
      asset.compression?.compressed === true;
    const supply = tokenInfo.supply !== undefined ? tokenInfo.supply : -1;
    const hasCollection = grouping.some((g) => g.group_key === 'collection');
    const isLikelyNFT = decimals === 0 && hasCollection && supply === 1;
    const isKnownFungible =
      iface === 'FUNGIBLETOKEN' ||
      iface === 'FUNGIBLEASSET' ||
      iface === 'FUNGIBLE_TOKEN' ||
      iface === 'FUNGIBLE_ASSET' ||
      (supply > 1 && decimals >= 0);

    const hasVerifiedCreator = creators.some((c) => c.verified === true);
    const isMplCore = iface === 'MPLCOREASSET' || iface === 'MPLBUBBLEGUMV2';
    const isRealNFT = isMplCore ? hasCollection : (hasVerifiedCreator && hasCollection);
    const royaltyBps = asset.royalty?.basis_points ?? 0;
    const hasRoyalty = royaltyBps >= 100;

    // Name-based Seeker fallback — require verified creator + collection to prevent spoofing
    if (!hasSeeker && isSeekerNamed && hasVerifiedCreator && hasCollection) {
      hasSeeker = true;
    }

    if ((isExplicitNFT || isMplCore || (isLikelyNFT && !isKnownFungible)) && isRealNFT && hasRoyalty) {
      nftCount += 1;
      const collectionValue = collectionGroup?.group_value || '';
      if (BLUE_CHIP_COLLECTIONS.includes(collectionValue)) {
        isBlueChip = true;
      }
      // Name-based blue chip fallback — require verified creator to prevent spoofing
      if (!isBlueChip && name && hasVerifiedCreator) {
        if (BLUE_CHIP_COLLECTION_NAMES.some((bcn) => name.includes(bcn))) {
          isBlueChip = true;
        }
      }
    } else {
      uniqueTokenCount += 1;
    }

    if (DEFI_POSITION_HINTS.some((hint) => name.includes(hint))) {
      defiProtocolExposure = true;
    }

    if (Object.values(LST_MINTS).some((lstMint) => lstMint === mint)) {
      hasLstExposure = true;
    }

    const memeSymbol = MEME_MINT_LOOKUP[mint];
    if (memeSymbol) {
      const balanceRaw = tokenInfo.balance ?? tokenInfo.amount ?? 0;
      const numericBalance = typeof balanceRaw === 'number' ? balanceRaw : parseFloat(balanceRaw || '0');
      const uiAmount = decimals > 0 ? numericBalance / Math.pow(10, decimals) : numericBalance;
      if (uiAmount > 0) {
        memeHoldingsSet.add(memeSymbol);
        memeValueUSD += uiAmount * (MEME_COIN_PRICES_USD[memeSymbol] || 0);
      }
    }
  });

  tokenAccounts.value.forEach((account) => {
    const info = account?.account?.data?.parsed?.info;
    const tokenAmount = info?.tokenAmount;
    const uiAmount = tokenAmount?.uiAmount ?? 0;
    if (!uiAmount || uiAmount <= 0) return;
    const mint = info?.mint;
    if (mint === TOKEN_ADDRESSES.CHAPTER2_PREORDER) hasPreorder = true;
    if (mint === TOKEN_ADDRESSES.SEEKER_GENESIS_COLLECTION) hasSeeker = true;
    if (Object.values(LST_MINTS).some((lstMint) => lstMint === mint)) {
      hasLstExposure = true;
    }
    const memeSymbol = MEME_MINT_LOOKUP[mint];
    if (memeSymbol) {
      const amount = tokenAmount?.uiAmount ?? 0;
      if (amount > 0) {
        memeHoldingsSet.add(memeSymbol);
        memeValueUSD += amount * (MEME_COIN_PRICES_USD[memeSymbol] || 0);
      }
    }
    if (!assets.some((asset) => asset.id === mint)) {
      uniqueTokenCount += 1;
      if ((tokenAmount?.decimals ?? 0) === 0) {
        nftCount += 1;
      }
    }
  });

  const isMemeLord = memeHoldingsSet.size >= 3 && memeValueUSD >= 10;
  const isDeFiKingBase = (hasLstExposure || defiProtocolExposure) && (solBalance >= 0.1 || memeValueUSD >= 10);

  // Enhanced TX data (non-blocking, best-effort)
  let enhancedData = null;
  try { enhancedData = await fetchEnhancedTransactions(address, 1000); } catch {}
  const isDeFiKing = isDeFiKingBase || (enhancedData?.isDeFiKing ?? false);

  const walletAgeDays = firstTxTime
    ? Math.round((Date.now() - firstTxTime * 1000) / (1000 * 60 * 60 * 24))
    : 0;
  const identity = calculateIdentity(txCount, firstTxTime, solBalance, uniqueTokenCount, nftCount, {
    hasSeeker,
    hasPreorder,
    isBlueChip,
    isDeFiKing,
    isMemeLord,
    uniqueTokenCount,
    swapCount: enhancedData?.swapCount ?? 0,
    nftTradeCount: enhancedData?.nftTradeCount ?? 0,
    stakingCount: enhancedData?.stakingCount ?? 0,
    defiProtocols: enhancedData?.defiProtocols ?? [],
  });
  const stats = {
    score: identity.score,
    address: formatActionAddress(address),
    ageDays: walletAgeDays,
    txCount,
    solBalance,
    tokenCount: uniqueTokenCount,
    nftCount,
    swapCount: enhancedData?.swapCount ?? 0,
    nftTradeCount: enhancedData?.nftTradeCount ?? 0,
    stakingCount: enhancedData?.stakingCount ?? 0,
    defiProtocols: enhancedData?.defiProtocols ?? [],
    isDeFiUser: enhancedData?.isDeFiUser ?? false,
  };

  return {
    identity,
    stats,
    walletAgeDays,
    solBalance,
    txCount,
    tokenCount: uniqueTokenCount,
    nftCount,
    firstTxTime,
  };
};

// ═══ V1 COMPAT HANDLERS (old APK ≤1.0.32) ═══════════════════════════════════
// Legacy game handlers now live in server/routes/game.js, except leaderboard shims,
// which stay here because leaderboard routes were already split earlier.

async function handleGameLeaderboardGetV1(req, res, url) {
  if (!ipRateLimit('lb_get', getClientIp(req), 60, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
  const rawFilter = url.searchParams.get('gameType') || '';
  const canonFilter = toCanonGameMode(rawFilter) || rawFilter;
  const cacheKey = `lb:${canonFilter}`;
  if (leaderboardCache && leaderboardCache.key === cacheKey && Date.now() - leaderboardCacheTime < 10_000) {
    return respondJson(res, 200, leaderboardCache.data);
  }
  const filtered = canonFilter
    ? leaderboardEntries.filter(e => (toCanonGameMode(e.gameType) || e.gameType || 'orbit') === canonFilter)
    : leaderboardEntries;
  const enriched = filtered.slice(0, 50).map(entry => {
    const wallet = walletDatabase.get(entry.address);
    const rangerRank = wallet?.rangerSnapshot?.rank || getServerRangerSnapshot(entry.address, wallet || {}).rank || 'cadet';
    const isHolder = !!wallet?.isIdentityHolder;
    return { ...entry, rangerRank, isHolder };
  });
  const data = { entries: enriched };
  leaderboardCache = { key: cacheKey, data };
  leaderboardCacheTime = Date.now();
  respondJson(res, 200, data);
}

async function handleGameLeaderboardV1(req, res, url) {
  if (!ipRateLimit('lb_post', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw);
    const { address, score, txSignature, gameType } = parsed;
    if (!address || typeof address !== 'string' || typeof score !== 'number' || score <= 0) {
      return respondJson(res, 400, { error: 'Invalid entry: address (string) and score (number > 0) required' });
    }
    const playedAt = new Date().toISOString();
    const canonMode = toCanonGameMode(gameType) || 'orbit';
    const result = submitLeaderboardEntry({ address, score, playedAt, txSignature, gameType: canonMode });
    triggerCompositeUpdate(address);
    const filtered = leaderboardEntries.filter(e => (toCanonGameMode(e.gameType) || e.gameType || 'orbit') === canonMode);
    respondJson(res, 200, { entry: result, leaderboard: filtered.slice(0, 50) });
  } catch {
    respondJson(res, 400, { error: 'Invalid JSON body' });
  }
}

// ═══ V2 MIGRATION: lazy account state seeding on first v2 request ════════════
const V2_MIGRATION_REV = 1;

function ensureV2AccountState(address) {
  const wallet = walletDatabase.get(address);
  if (!wallet) return;
  if (wallet._migrations?.apiV2 === V2_MIGRATION_REV) return wallet;

  const ranger = getServerRangerSnapshot(address, wallet);

  const playerEntries = (leaderboardEntries || []).filter(e => e.address === address);
  const bestScore = Math.max(0, ...playerEntries.map(e => Number(e.score) || 0), 0);
  const hasMint = mintedAddresses.has(address);
  const scans = Number(wallet.scanCount) || 0;

  const seedQuest = (existing, progress, completed) =>
    existing || { progress, completed: completed ?? progress > 0, claimed: false };

  const qp = questProgress.get(address) || { quests: {}, streakDays: 0 };
  qp.quests = {
    ...qp.quests,
    ot_first_scan: seedQuest(qp.quests?.ot_first_scan, Math.min(1, scans)),
    ot_first_mint: seedQuest(qp.quests?.ot_first_mint, hasMint ? 1 : 0),
    ot_first_game: seedQuest(qp.quests?.ot_first_game, playerEntries.length > 0 ? 1 : 0),
    ot_score1000: seedQuest(qp.quests?.ot_score1000, bestScore, bestScore >= 1000),
  };
  questProgress.set(address, { ...qp, updatedAt: new Date().toISOString() });

  wallet.rangerSnapshot = { xp: ranger.xp, rank: ranger.rank, sources: ranger.sources, updatedAt: new Date().toISOString() };
  wallet.forgeState = wallet.forgeState || createEmptyForgeLoadout(address);
  wallet._migrations = { ...(wallet._migrations || {}), apiV2: V2_MIGRATION_REV, migratedAt: new Date().toISOString() };

  // Store migration result so the welcome-back modal can display past achievements
  wallet._v2MigrationResult = {
    rangerRank: ranger.rank,
    totalXP: ranger.xp,
    xpBreakdown: {
      gameBestScores: ranger.sources?.gameBestScores || 0,
      gamesPlayed: ranger.sources?.gamesPlayed || 0,
      achievements: ranger.sources?.achievements || 0,
      coinsEarned: ranger.sources?.coinsEarned || 0,
    },
    coinBalance: getCoinBalance(address),
    gamesPlayed: playerEntries.length,
    achievementCount: Object.keys((walletDatabase.get(address)?._achievements?.unlocked) || {}).length,
  };

  walletDatabase.set(address, wallet);
  saveWalletDatabaseDebounced();

  return wallet;
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API Version Dispatch ──────────────────────────────────────────────────
  // Detect version BEFORE parsing url/pathname so we can rewrite for v2
  const _rawUrl = req.url ?? '/';
  const _apiMeta = getApiMeta(req, new URL(_rawUrl, 'http://localhost').pathname);
  res.setHeader('X-API-Version', _apiMeta.apiVersion);

  if (_apiMeta.apiVersion === 'v2') {
    // Rewrite /api/v2/* → /api/* before parsing, so existing router works unchanged
    req.url = _rawUrl.replace('/api/v2/', '/api/');
    // Run lazy migration for authenticated requests (optionalJwt never sends a response)
    try {
      const _jwtCheck = optionalJwt(req, null);
      if (_jwtCheck && _jwtCheck.ok && _jwtCheck.address) ensureV2AccountState(_jwtCheck.address);
    } catch { /* skip migration on error */ }
    // Fall through to existing router (url/pathname parsed below with rewritten URL)
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (_apiMeta.apiVersion === 'v1') {
    // V1: intercept only the remaining breaking routes — everything else falls through
    const V1_HANDLERS = {
      'GET /api/game/leaderboard': handleGameLeaderboardGetV1,
      'POST /api/game/leaderboard': handleGameLeaderboardV1,
    };
    const v1Key = `${req.method} ${pathname}`;
    if (V1_HANDLERS[v1Key]) return V1_HANDLERS[v1Key](req, res, url);
    if (await gameV1Handler(req, res, url, pathname)) return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (await utilityHandler(req, res, url, pathname)) {
    return;
  }

  if (await marketHandler(req, res, url, pathname)) {
    return;
  }

  if (await authHandler(req, res, url, pathname)) {
    return;
  }

  if (await adminHandler(req, res, url, pathname)) {
    return;
  }

  if (await reputationInlineHandler(req, res, url, pathname)) {
    return;
  }

  if (await gameHandler(req, res, url, pathname)) {
    return;
  }

  // ── Leaderboard API ──
  if (await leaderboardHandler(req, res, url, pathname)) {
    return;
  }

  if (await userDataHandler(req, res, url, pathname)) {
    return;
  }

  // ═══ Tournament System (Tiered) ═══
  if (await tournamentHandler(req, res, url, pathname)) {
    return;
  }

  // ═══ Prism Vault (Staking) ═══
  if (await vaultHandler(req, res, url, pathname)) {
    return;
  }

  if (await blinksHandler(req, res, url, pathname)) {
    return;
  }

  if ((
    pathname.startsWith('/api/actions/sybil/')
    || pathname.startsWith('/api/v1/reputation/')
    || pathname === '/api/v2/reputation'
    || pathname === '/api/sybil/feedback'
  ) && await reputationHandler(req, res, url, pathname)) {
    return;
  }

  if (await metadataHandler(req, res, url, pathname)) {
    return;
  }
  if (await healthHandler(req, res, url, pathname)) {
    return;
  }

  // ═══ PRISM Earn ═══
  if (await earnHandler(req, res, url, pathname)) {
    return;
  }

  if (await blackholeHandler(req, res, url, pathname)) {
    return;
  }

  // ═══ PRISM Spend ═══
  if (await spendHandler(req, res, url, pathname)) {
    return;
  }

  // ═══ PRISM Buy Coins ═══
  if (await buyHandler(req, res, url, pathname)) {
    return;
  }

  // ═══ Sybil Analysis & Cluster Intelligence ═══
  if (await sybilHandler(req, res, url, pathname)) {
    return;
  }

  // ═══ Wallet Token Holdings / Recent Transactions ═══
  if (pathname.startsWith('/api/wallet/') && await walletHandler(req, res, url, pathname)) {
    return;
  }

  // ═══ Sybil Hunt Quiz — blockchain trivia for coins ═══
  if (await quizHandler(req, res, url, pathname)) {
    return;
  }

  if (await discoveryHandler(req, res, url, pathname)) {
    return;
  }

  // ═══ Quest Sync ═══
  if (await questHandler(req, res, url, pathname)) {
    return;
  }

  if ((pathname.startsWith('/api/challenge/') || pathname.startsWith('/api/admin/challenge/') || pathname.startsWith('/api/arena/')) && await arenaHandler(req, res, url, pathname)) {
    return;
  }

  if (await notificationsHandler(req, res, url, pathname)) {
    return;
  }

  // ═══ Wallet Database API ═══
  if (pathname.startsWith('/api/wallet-database') && await walletHandler(req, res, url, pathname)) {
    return;
  }

  if (!pathname.startsWith('/rpc')) {
    respondJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!HELIUS_KEYS.length && !HELIUS_RPC_BASE && !ALCHEMY_RPC_URL && !FALLBACK_RPC_URL) {
    respondJson(res, 500, { error: 'RPC endpoint is not configured' });
    return;
  }
  if (RPC_PROXY_TOKEN && getRpcAccessToken(req) !== RPC_PROXY_TOKEN) {
    respondJson(res, 401, { error: 'RPC auth required' });
    return;
  }
  if (!ipRateLimit('rpc_proxy', getClientIp(req), 120, 60000)) {
    respondJson(res, 429, { error: 'RPC rate limit exceeded' });
    return;
  }

  try {
    const rpcBody = await readBody(req);
    const seed = String(req.headers['x-wallet-address'] ?? '');

    // Detect RPC method to decide routing
    let rpcMethod = '';
    let rpcParsed = null;
    try { rpcParsed = JSON.parse(rpcBody); rpcMethod = Array.isArray(rpcParsed) ? rpcParsed[0]?.method ?? '' : rpcParsed?.method ?? ''; } catch {}
    const rpcValidation = validateRpcPayload(rpcParsed);
    if (!rpcValidation.ok) return respondJson(res, 400, { error: rpcValidation.error });

    const isDasMethod = DAS_METHODS.has(rpcMethod);

    // Build Helius URL
    const apiKey = pickHeliusKey(seed, HELIUS_KEYS);
    let heliusUrl = null;
    if (HELIUS_RPC_BASE && (apiKey || !HELIUS_KEYS.length)) {
      const u = new URL(HELIUS_RPC_BASE);
      if (apiKey) u.searchParams.set('api-key', apiKey);
      heliusUrl = u.toString();
    }

    // Build ordered URL list based on method type
    // DAS methods → Helius only (other providers don't support DAS)
    // Standard RPC → Alchemy → Helius → Solana Public
    const urls = [];
    if (isDasMethod) {
      if (heliusUrl) urls.push({ url: heliusUrl, name: 'helius' });
    } else {
      if (ALCHEMY_RPC_URL) urls.push({ url: ALCHEMY_RPC_URL, name: 'alchemy' });
      if (heliusUrl) urls.push({ url: heliusUrl, name: 'helius' });
      if (FALLBACK_RPC_URL) urls.push({ url: FALLBACK_RPC_URL, name: 'solana-public' });
    }

    if (!urls.length) {
      respondJson(res, 500, { error: 'RPC endpoint not available' });
      return;
    }

    // Try each URL in order with fetch-based fallback
    let lastError = null;
    for (const { url, name } of urls) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const upstream = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rpcBody,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!upstream.ok) {
          lastError = `${name} returned ${upstream.status}`;
          console.warn(`[rpc-fallback] ${name} failed: HTTP ${upstream.status}, trying next...`);
          continue;
        }

        const responseBody = await upstream.text();

        // Check for RPC-level errors that warrant fallback (rate limits, etc.)
        try {
          const parsed = JSON.parse(responseBody);
          if (parsed?.error?.code === -32429 || parsed?.error?.message?.includes('rate limit')) {
            lastError = `${name} rate limited`;
            console.warn(`[rpc-fallback] ${name} rate limited, trying next...`);
            continue;
          }
        } catch {}

        if (!res.headersSent) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(responseBody);
        }
        return;
      } catch (err) {
        lastError = `${name}: ${err.message}`;
        console.warn(`[rpc-fallback] ${name} error: ${err.message}, trying next...`);
        continue;
      }
    }

    // All providers failed
    console.error(`[rpc-fallback] all providers failed for ${rpcMethod}: ${lastError}`);
    if (!res.headersSent) {
      respondJson(res, 502, { error: 'All RPC providers failed', detail: lastError });
    }
    return;
  } catch (error) {
    console.error('[helius-proxy] rpc error', error);
    if (!res.headersSent) {
      respondJson(res, 502, { error: 'Upstream request failed' });
    }
  }
});

// ═══════════════════════════════════════════════════════════
// v5.0 API — PRISM Coin, Sybil Detection, Leaderboard, Feed, Constellation
// ═══════════════════════════════════════════════════════════

// ── Unified economy: coinBalances is the single source of truth ──
// "PRISM" is now just the UI name for coins. All earn/spend goes through coinBalances.
const prismTransactions = new Map(); // address → PrismTransaction[] (kept for history)
const feedItems = [];
const sybilCache = new Map(); // address → { analysis, cachedAt }
const sybilInFlight = new Map(); // address → Promise<analysis> — dedup concurrent requests
const SYBIL_SCAN_VERSION = 2;

function getSybilCacheTtlMs(txCount = 0, isOwnWallet = false) {
  if (isOwnWallet) return 2 * 3600_000;
  if (txCount > 1000) return 24 * 3600_000;
  if (txCount >= 100) return 6 * 3600_000;
  return 3600_000;
}

function getSybilCacheTxCount(entry) {
  return Number(
    entry?.analysis?.metrics?.txCount
    ?? entry?.estimatedTxCount
    ?? entry?.analysis?.scanMeta?.estimatedTxCount
    ?? 0
  ) || 0;
}

function normalizeSybilCacheEntry(entry) {
  if (!entry?.analysis || typeof entry.analysis !== 'object') return null;
  const computedAt = Math.max(0, Math.round(Number(entry.computedAt ?? entry.cachedAt) || 0)) || Date.now();
  const estimatedTxCount = Math.max(
    0,
    Math.round(Number(
      entry.estimatedTxCount
      ?? entry.analysis?.scanMeta?.estimatedTxCount
      ?? entry.analysis?.metrics?.txCount
      ?? 0,
    ) || 0),
  );
  const normalized = {
    analysis: entry.analysis,
    fundingSources: Array.isArray(entry.fundingSources) ? entry.fundingSources : [],
    cachedAt: computedAt,
    computedAt,
    ttlExpiresAt: Math.max(0, Math.round(Number(entry.ttlExpiresAt) || 0)),
    lastSeenSignature: entry.lastSeenSignature || entry.analysis?.scanMeta?.lastSeenSignature || null,
    firstSeenSignature: entry.firstSeenSignature || entry.analysis?.scanMeta?.firstSeenSignature || null,
    estimatedTxCount,
    firstTxBlockTime: Number(entry.firstTxBlockTime ?? entry.analysis?.scanMeta?.firstTxBlockTime) || null,
    confidence: Number(entry.confidence) || Number(entry.analysis?.scanMeta?.confidenceScore) || 0,
    riskLevel: entry.riskLevel || entry.analysis?.riskLevel || 'clean',
    score: Math.round(Number(entry.score ?? entry.analysis?.riskScore) || 0),
    scanVersion: Math.max(1, Math.round(Number(entry.scanVersion ?? entry.analysis?.scanMeta?.scanVersion) || 1)),
  };
  if (!normalized.ttlExpiresAt) {
    normalized.ttlExpiresAt = normalized.cachedAt + getSybilCacheTtlMs(getSybilCacheTxCount(normalized), false);
  }
  return normalized;
}

function loadSybilCacheEntry(address) {
  const memoryEntry = normalizeSybilCacheEntry(sybilCache.get(address));
  const storedEntry = normalizeSybilCacheEntry(sybilVerdictStore.get(address));

  if (storedEntry && (!memoryEntry || storedEntry.computedAt >= memoryEntry.computedAt)) {
    sybilCache.set(address, storedEntry);
    return storedEntry;
  }
  return memoryEntry;
}

function isFreshSybilCacheEntry(entry, isOwnWallet = false, now = Date.now()) {
  if (!entry) return false;
  const entryAgeMs = now - (Number(entry.cachedAt) || 0);
  const dynamicTtlMs = getSybilCacheTtlMs(getSybilCacheTxCount(entry), isOwnWallet);
  if (entryAgeMs >= dynamicTtlMs) return false;
  return !entry.ttlExpiresAt || now < entry.ttlExpiresAt;
}

function persistSybilAnalysis(address, analysis, {
  fundingSources = [],
  lastSeenSignature = null,
  firstSeenSignature = null,
  estimatedTxCount = 0,
  firstTxBlockTime = null,
  isOwnWalletScan = false,
} = {}) {
  const computedAt = Date.now();
  const txCount = Math.max(
    Math.round(Number(estimatedTxCount) || 0),
    Math.round(Number(analysis?.metrics?.txCount) || 0),
  );
  const ttlMs = getSybilCacheTtlMs(txCount, isOwnWalletScan);
  const confidenceLabel = analysis?.verdict?.confidence || null;
  analysis.scanMeta = {
    ...(analysis.scanMeta || {}),
    strategy: 'enhanced_stratified_sampling',
    scanVersion: SYBIL_SCAN_VERSION,
    lastSeenSignature: lastSeenSignature || analysis?.scanMeta?.lastSeenSignature || null,
    firstSeenSignature: firstSeenSignature || analysis?.scanMeta?.firstSeenSignature || null,
    estimatedTxCount: txCount,
    firstTxBlockTime: Number(firstTxBlockTime ?? analysis?.scanMeta?.firstTxBlockTime) || null,
    computedAt,
    ttlExpiresAt: computedAt + ttlMs,
    confidenceScore: confidenceLabel ? (SYBIL_VERDICT_CONFIDENCE_SCORES[confidenceLabel] || 0) : 0,
  };

  const cacheEntry = normalizeSybilCacheEntry({
    analysis,
    fundingSources,
    cachedAt: computedAt,
    computedAt,
    ttlExpiresAt: computedAt + ttlMs,
    lastSeenSignature: analysis.scanMeta.lastSeenSignature,
    firstSeenSignature: analysis.scanMeta.firstSeenSignature,
    estimatedTxCount: analysis.scanMeta.estimatedTxCount,
    firstTxBlockTime: analysis.scanMeta.firstTxBlockTime,
    confidence: analysis.scanMeta.confidenceScore,
    riskLevel: analysis.riskLevel,
    score: analysis.riskScore,
    scanVersion: analysis.scanMeta.scanVersion,
  });

  sybilCache.set(address, cacheEntry);
  sybilVerdictStore.set(address, cacheEntry);
  snapshotSybilVerdictHistory(address, cacheEntry);
  return cacheEntry;
}

function refreshCachedSybilAnalysis(address, cachedEntry, isOwnWalletScan = false) {
  if (!cachedEntry?.analysis) return null;
  const refreshedAt = Date.now();
  const refreshedAnalysis = {
    ...cachedEntry.analysis,
    timestamp: new Date(refreshedAt).toISOString(),
    scanMeta: {
      ...(cachedEntry.analysis.scanMeta || {}),
      strategy: 'enhanced_stratified_sampling',
      incremental: true,
      newTxCount: 0,
      lastValidatedAt: refreshedAt,
    },
  };
  return persistSybilAnalysis(address, refreshedAnalysis, {
    fundingSources: cachedEntry.fundingSources,
    lastSeenSignature: cachedEntry.lastSeenSignature,
    firstSeenSignature: cachedEntry.firstSeenSignature,
    estimatedTxCount: cachedEntry.estimatedTxCount,
    firstTxBlockTime: cachedEntry.firstTxBlockTime,
    isOwnWalletScan,
  });
}

function getEnhancedSignature(tx) {
  return typeof tx?.signature === 'string' && tx.signature ? tx.signature : null;
}

function dedupeEnhancedTransactions(txs) {
  const deduped = new Map();
  for (const tx of txs || []) {
    if (!tx || typeof tx !== 'object') continue;
    const signature = getEnhancedSignature(tx) || `ts:${getEnhancedTxTimestampSeconds(tx) || 0}:${deduped.size}`;
    if (!deduped.has(signature)) deduped.set(signature, tx);
  }
  return [...deduped.values()].sort((a, b) => {
    const tsDiff = getEnhancedTxTimestampMs(b) - getEnhancedTxTimestampMs(a);
    if (tsDiff !== 0) return tsDiff;
    return String(getEnhancedSignature(b) || '').localeCompare(String(getEnhancedSignature(a) || ''));
  });
}

async function fetchSybilSampleFor(address, conn, pubkey, cachedMeta = null, currentBalance = 0) {
  const recentHistory = await fetchEnhancedTxHistory(address, { limit: 100 });
  const recentTxs = dedupeEnhancedTransactions(recentHistory?.txs || []);
  if (recentTxs.length === 0) return null;

  const latestSignature = getEnhancedSignature(recentTxs[0]);
  const recentSummary = summarizeEnhancedTxHistory(recentTxs, address, currentBalance);
  if (cachedMeta?.lastSeenSignature) {
    const knownIndex = recentTxs.findIndex((tx) => getEnhancedSignature(tx) === cachedMeta.lastSeenSignature);
    const newTxs = knownIndex >= 0 ? recentTxs.slice(0, knownIndex) : recentTxs;
    if (newTxs.length === 0) {
      return {
        incremental: true,
        reuseCached: true,
        summary: recentSummary,
        sampleTxs: recentTxs,
        lastSeenSignature: cachedMeta.lastSeenSignature,
        firstSeenSignature: cachedMeta.firstSeenSignature || getEnhancedSignature(recentTxs[recentTxs.length - 1]),
        estimatedTxCount: Math.max(Number(cachedMeta.estimatedTxCount) || 0, recentTxs.length),
        firstTxBlockTime: Number(cachedMeta.firstTxBlockTime) || recentSummary.firstTxBlockTime || null,
        extraTimestamps: [],
        newTxCount: 0,
      };
    }

    return {
      incremental: true,
      reuseCached: false,
      summary: recentSummary,
      sampleTxs: recentTxs,
      lastSeenSignature: latestSignature,
      firstSeenSignature: cachedMeta.firstSeenSignature || getEnhancedSignature(recentTxs[recentTxs.length - 1]),
      estimatedTxCount: Math.max((Number(cachedMeta.estimatedTxCount) || 0) + newTxs.length, recentTxs.length),
      firstTxBlockTime: Number(cachedMeta.firstTxBlockTime) || recentSummary.firstTxBlockTime || null,
      extraTimestamps: [],
      newTxCount: newTxs.length,
    };
  }

  const olderTxs = [];
  let before = getEnhancedSignature(recentTxs[recentTxs.length - 1]);
  let exhausted = recentTxs.length < 100;
  for (let page = 0; page < 4 && before; page += 1) {
    const pageHistory = await fetchEnhancedTxHistory(address, { limit: 100, before });
    const pageTxs = dedupeEnhancedTransactions(pageHistory?.txs || []);
    if (pageTxs.length === 0) {
      exhausted = true;
      break;
    }
    olderTxs.push(...pageTxs);
    before = getEnhancedSignature(pageTxs[pageTxs.length - 1]);
    if (pageTxs.length < 100) {
      exhausted = true;
      break;
    }
  }

  let combinedSample = dedupeEnhancedTransactions([...recentTxs, ...olderTxs]);
  let summary = summarizeEnhancedTxHistory(combinedSample, address, currentBalance);
  let estimatedTxCount = combinedSample.length;
  let firstTxBlockTime = summary.firstTxBlockTime || null;
  let firstSeenSignature = getEnhancedSignature(combinedSample[combinedSample.length - 1]);
  let extraTimestamps = [];

  if (!exhausted && before) {
    try {
      const olderSignatures = await conn.getSignaturesForAddress(pubkey, { before, limit: 1000 });
      if (olderSignatures.length > 0) {
        estimatedTxCount = Math.max(
          combinedSample.length + olderSignatures.length,
          Number(cachedMeta?.estimatedTxCount) || 0,
        );
        const midpoint = Math.max(0, Math.floor(olderSignatures.length / 2) - 25);
        extraTimestamps = olderSignatures
          .slice(midpoint, midpoint + 50)
          .map((sig) => Number(sig?.blockTime) || 0)
          .filter((blockTime) => blockTime > 1584000000)
          .map((blockTime) => blockTime * 1000);
        const tailFirstSeen = olderSignatures[olderSignatures.length - 1];
        if (tailFirstSeen?.signature) firstSeenSignature = tailFirstSeen.signature;
        if (tailFirstSeen?.blockTime > 1584000000) firstTxBlockTime = tailFirstSeen.blockTime;

        if (olderSignatures.length === 1000 && !(Number(cachedMeta?.firstTxBlockTime) > 0)) {
          const firstTxResult = await findFirstTxTime(
            conn,
            pubkey,
            olderSignatures,
            null,
            getRpcUrl(address) || 'https://api.mainnet-beta.solana.com',
          );
          if (firstTxResult?.totalSigs) {
            estimatedTxCount = combinedSample.length + firstTxResult.totalSigs;
          }
          if (firstTxResult?.firstTxTime) {
            firstTxBlockTime = firstTxResult.firstTxTime;
          }
        }
      }
    } catch {
      // keep bounded sample only
    }
  }

  if (Number(cachedMeta?.firstTxBlockTime) > 0) {
    firstTxBlockTime = Math.min(Number(cachedMeta.firstTxBlockTime), Number(firstTxBlockTime) || Number(cachedMeta.firstTxBlockTime));
  }

  if (extraTimestamps.length > 0) {
    summary = {
      ...summary,
      timestamps: [...summary.timestamps, ...extraTimestamps].sort((a, b) => a - b),
    };
  }

  return {
    incremental: false,
    reuseCached: false,
    summary,
    sampleTxs: combinedSample,
    lastSeenSignature: latestSignature,
    firstSeenSignature,
    estimatedTxCount: Math.max(estimatedTxCount, combinedSample.length),
    firstTxBlockTime: Number(firstTxBlockTime) || summary.firstTxBlockTime || null,
    extraTimestamps,
    newTxCount: recentTxs.length,
  };
}

// ── Binary search for wallet's first transaction (slot-based, no full pagination) ──
// Uses getBlock to get reference signatures at specific time points,
// then getSignaturesForAddress with 'before' to check if wallet had activity before that point.
// Total: ~14-20 RPC calls (all parallelized where possible) for ANY wallet, regardless of tx count.
async function findFirstTxTime(conn, pubkey, firstPageSigs, cachedFirstTx, rpcUrl) {
  const _ftStart = Date.now();
  const _addr = pubkey.toBase58().slice(0, 8);

  // Quick: < 1000 sigs on first page → oldest is exact
  if (firstPageSigs.length < 1000) {
    for (let i = firstPageSigs.length - 1; i >= 0; i--) {
      if (firstPageSigs[i].blockTime > 1584000000) {
        console.log(`[findFirstTx] ${_addr}.. sigs=${firstPageSigs.length} → fast path (${Date.now()-_ftStart}ms)`);
        return { firstTxTime: firstPageSigs[i].blockTime, totalSigs: firstPageSigs.length };
      }
    }
    return { firstTxTime: null, totalSigs: firstPageSigs.length };
  }

  // ─── Strategy: Paginate first (fast & exact), binary search fallback ───
  // Pagination: ~280ms/page on Helius, covers 99% of wallets in <3s
  // Binary search: fallback for extreme cases (>10K txs, ~7s)

  const SOLANA_GENESIS = 1584000000; // ~March 2020, filter out invalid blockTimes
  const MAX_PAGES = 30; // 30 pages × 1000 sigs = 30,000 txs max via pagination
  let before = firstPageSigs[firstPageSigs.length - 1]?.signature;
  let bestOldest = firstPageSigs[firstPageSigs.length - 1]?.blockTime || 0;
  let totalSigs = firstPageSigs.length;
  let pagesUsed = 1; // first page already fetched by caller
  let reachedEnd = false;

  // Phase 1: Paginate backwards (fast, exact)
  for (let page = 1; page < MAX_PAGES && before; page++) {
    try {
      const sigs = await conn.getSignaturesForAddress(pubkey, { before, limit: 1000 });
      pagesUsed++;
      totalSigs += sigs.length;
      if (sigs.length > 0) {
        // Find oldest sig with a valid blockTime (skip null/0/pre-genesis)
        for (let si = sigs.length - 1; si >= 0; si--) {
          if (sigs[si].blockTime > SOLANA_GENESIS) {
            bestOldest = sigs[si].blockTime;
            break;
          }
        }
        before = sigs[sigs.length - 1].signature;
      }
      if (sigs.length < 1000) { reachedEnd = true; break; }
    } catch { break; }
  }

  if (reachedEnd) {
    const ageDays = Math.round((Date.now() / 1000 - bestOldest) / 86400);
    console.log(`[findFirstTx] ${_addr}.. paginated ${pagesUsed} pages, ${totalSigs} sigs → age=${ageDays}d, first=${new Date(bestOldest*1000).toISOString().slice(0,10)} (${Date.now()-_ftStart}ms)`);
    return { firstTxTime: bestOldest, totalSigs };
  }

  // Phase 2: Binary search for wallets with >10K txs
  // We know wallet's oldest visible time from pagination — search before that
  console.log(`[findFirstTx] ${_addr}.. ${totalSigs}+ sigs, switching to binary search from ${new Date(bestOldest*1000).toISOString().slice(0,10)}`);

  const now = Math.floor(Date.now() / 1000);
  let currentSlot;
  try { currentSlot = await conn.getSlot(); } catch { return { firstTxTime: bestOldest, totalSigs }; }
  const timeToSlot = (t) => Math.max(0, Math.round(currentSlot - (now - t) * 2.5));

  // Raw RPC call with retry on 429
  async function rpcCall(method, params, retries = 3) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (res.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      const data = await res.json();
      return data?.result ?? null;
    }
    return null;
  }

  // Get a reference sig from a block near targetTime (2 RPC calls)
  async function getRefSig(targetTime) {
    const estSlot = timeToSlot(targetTime);
    try {
      const validSlots = await rpcCall('getBlocks', [estSlot, estSlot + 200]);
      if (!validSlots?.length) return null;
      const block = await rpcCall('getBlock', [validSlots[0], {
        transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 0,
      }]);
      if (block?.signatures?.length) return { sig: block.signatures[0], blockTime: block.blockTime };
    } catch {}
    return null;
  }

  // Check if wallet has txs before a reference sig (with retry)
  async function hasTxBefore(refSig) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const sigs = await conn.getSignaturesForAddress(pubkey, { before: refSig, limit: 1 });
        return sigs.length > 0 ? sigs[0] : false;
      } catch (e) {
        if (attempt < 2 && e?.message?.includes('429')) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return null;
      }
    }
    return null;
  }

  // Probe backwards from oldest paginated time
  const DAY = 86400;
  const probeOffsets = [90, 180, 365, 730, 1460, 2190];
  const probeTimes = probeOffsets
    .map(d => bestOldest - d * DAY)
    .filter(t => t > 1584000000);

  let upperTime = bestOldest;
  let lowerTime = 1584000000;

  for (const probeTime of probeTimes) {
    const ref = await getRefSig(probeTime);
    if (!ref) continue;
    const found = await hasTxBefore(ref.sig);
    if (found === null) continue;
    if (found) {
      const txTime = found.blockTime || probeTime;
      if (txTime < bestOldest) bestOldest = txTime;
      upperTime = probeTime;
    } else {
      lowerTime = probeTime;
      break;
    }
  }

  // Narrow down with 6 binary search iterations (~1 day precision)
  for (let iter = 0; iter < 6 && (upperTime - lowerTime) > 7 * DAY; iter++) {
    const midTime = Math.floor((lowerTime + upperTime) / 2);
    const ref = await getRefSig(midTime);
    if (!ref) { upperTime = midTime; continue; }
    const found = await hasTxBefore(ref.sig);
    if (found === null) continue;
    if (found) {
      upperTime = midTime;
      if (found.blockTime && found.blockTime < bestOldest) bestOldest = found.blockTime;
    } else {
      lowerTime = midTime;
    }
  }

  // Final exact fetch in the narrow window
  try {
    const ref = await getRefSig(upperTime);
    if (ref) {
      const finalSigs = await conn.getSignaturesForAddress(pubkey, { before: ref.sig, limit: 1000 });
      if (finalSigs.length > 0) {
        const exactOldest = finalSigs[finalSigs.length - 1]?.blockTime;
        if (exactOldest && exactOldest < bestOldest) bestOldest = exactOldest;
      }
    }
  } catch {}

  const ageDays = Math.round((Date.now() / 1000 - bestOldest) / 86400);
  console.log(`[findFirstTx] ${_addr}.. binary search done → age=${ageDays}d, first=${new Date(bestOldest*1000).toISOString().slice(0,10)} (${Date.now()-_ftStart}ms)`);
  return { firstTxTime: bestOldest, totalSigs };
}

// ═══ Persistent Sybil Wallet Graph ═══
// Stores relationships between wallets for cross-session intelligence.
// Keep it under METADATA_DIR so deployments that change cwd do not lose the graph on restart.
const SYBIL_GRAPH_FILE = process.env.SYBIL_GRAPH_FILE
  ? path.resolve(process.env.SYBIL_GRAPH_FILE)
  : path.join(METADATA_DIR, 'sybil-graph.json');
const LEGACY_SYBIL_GRAPH_FILE = path.join(process.cwd(), 'sybil_graph.json');
try {
  fs.mkdirSync(path.dirname(SYBIL_GRAPH_FILE), { recursive: true });
  if (
    path.resolve(SYBIL_GRAPH_FILE) !== path.resolve(LEGACY_SYBIL_GRAPH_FILE) &&
    !fs.existsSync(SYBIL_GRAPH_FILE) &&
    fs.existsSync(LEGACY_SYBIL_GRAPH_FILE)
  ) {
    fs.copyFileSync(LEGACY_SYBIL_GRAPH_FILE, SYBIL_GRAPH_FILE);
    console.log(`[sybil-graph] Migrated legacy graph to ${SYBIL_GRAPH_FILE}`);
  }
} catch (error) {
  console.warn('[sybil-graph] Failed to prepare persistence path:', error.message);
}
const {
  sybilGraph,
  saveSybilGraph,
  updateSybilGraphNode,
  checkGraphForKnownSybils,
} = createSybilClusterService({
  fs,
  sybilGraphFile: SYBIL_GRAPH_FILE,
});

// Migrate any old prism_data.json balances into coinBalances on first run
const PRISM_DATA_FILE = path.join(process.cwd(), 'prism_data.json');
try {
  if (fs.existsSync(PRISM_DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(PRISM_DATA_FILE, 'utf8'));
    if (raw.transactions) for (const [k, v] of Object.entries(raw.transactions)) prismTransactions.set(k, v);
    // Migrate old prism balances into coinBalances (one-time merge)
    if (raw.balances) {
      let migrated = 0;
      for (const [addr, bal] of Object.entries(raw.balances)) {
        const prismBal = typeof bal === 'object' && bal !== null ? (bal.balance || 0) : 0;
        if (prismBal > 0) {
          const currentCoins = getCoinBalance(addr);
          setCoinBalance(addr, currentCoins + prismBal);
          migrated++;
        }
      }
      if (migrated > 0) {
        console.log(`[coins] Migrated ${migrated} PRISM balances into coinBalances`);
        // Clear old prism balances from file to prevent double-migration
        raw.balances = {};
        fs.writeFileSync(PRISM_DATA_FILE, JSON.stringify(raw), 'utf8');
      }
    }
    // Load coinStats
    if (raw.coinStats) {
      for (const [addr, stats] of Object.entries(raw.coinStats)) coinStats.set(addr, stats);
    }
    console.log(`[coins] Loaded ${prismTransactions.size} transaction histories, ${coinStats.size} coin stats`);
  }
} catch { /* first run */ }

async function savePrismData() {
  try {
    const data = {
      balances: {}, // balances now live in coinBalances only
      transactions: Object.fromEntries(prismTransactions),
      coinStats: Object.fromEntries(coinStats),
    };
    const tmp = PRISM_DATA_FILE + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.promises.rename(tmp, PRISM_DATA_FILE);
  } catch (e) { console.warn('[coins] save error', e.message); }
}

// Debounced save
let prismSaveTimer = null;
function debouncedSavePrism() {
  if (prismSaveTimer) clearTimeout(prismSaveTimer);
  prismSaveTimer = setTimeout(() => { savePrismData(); persistCoinBalances(); }, 2000);
}

// Coin stats tracking (totalEarned / totalSpent)
const coinStats = globalThis._coinStats || (globalThis._coinStats = new Map());

function getCoinStats(address) {
  return coinStats.get(address) || { totalEarned: 0, totalSpent: 0 };
}
function addCoinEarned(address, amount) {
  const s = getCoinStats(address);
  s.totalEarned += amount;
  coinStats.set(address, s);
}
function addCoinSpent(address, amount) {
  const s = getCoinStats(address);
  s.totalSpent += amount;
  coinStats.set(address, s);
}
function refundCoinSpent(address, amount) {
  const s = getCoinStats(address);
  s.totalSpent = Math.max(0, s.totalSpent - amount);
  coinStats.set(address, s);
}

// getPrismBalance now wraps coinBalances — returns the structured object the client expects
function getPrismBalance(address) {
  const coins = getCoinBalance(address);
  const stats = getCoinStats(address);
  return { address, balance: coins, totalEarned: stats.totalEarned, totalSpent: stats.totalSpent, lastUpdated: new Date().toISOString() };
}

// PRISM earn rate-limit: per-source cooldowns
const prismEarnRateLimit = rateLimitCache; // write-through cache in front of SQLite

function getPrismEarnRateLimitTtlSeconds(key, value) {
  if (value && typeof value === 'object' && typeof value.date === 'string') return 2 * 24 * 60 * 60;
  if (
    key.startsWith('nongame_daily:')
    || key.startsWith('scan_daily:')
    || key.startsWith('quiz:')
    || key.startsWith('blackhole_cleanup:')
    || key.startsWith('subcap:')
  ) {
    return 2 * 24 * 60 * 60;
  }
  if (key.startsWith('authChallenge:')) return 60;
  if (key.startsWith('fundSrc:')) return 60;
  if (key.startsWith('sybilHeavy:')) return 120;
  if (key.startsWith('scam:')) return 120;
  if (key.startsWith('constellation:')) return 120;
  if (key.endsWith(':__global__')) return 60;

  const parts = key.split(':');
  const source = parts[0] === 'subcap' ? (parts[2] || '') : (parts[1] || '');
  const cooldownMs = PRISM_EARN_COOLDOWN_TABLE[source] ?? PRISM_EARN_COOLDOWN_DEFAULT;
  return Math.max(60, Math.ceil((cooldownMs * 2) / 1000));
}

const getPrismEarnRateLimit = (key) => rateLimitStore.get(key);
const setPrismEarnRateLimit = (key, value, ttlSeconds = getPrismEarnRateLimitTtlSeconds(key, value)) => {
  rateLimitStore.set(key, value, ttlSeconds);
};

const quizAnswers = new Map(); // qId → { correct, expiresAt }

// q=question, a=correct answer, options=all 4 options, cat=category, diff=difficulty
const QUIZ_BANK = [
  // ── Solana ──
  { q: 'What consensus mechanism does Solana use alongside Proof of Stake?', a: 'Proof of History', options: ['Proof of History', 'Proof of Work', 'Proof of Authority', 'Proof of Burn'], cat: 'solana' },
  { q: 'What is the native token of Solana?', a: 'SOL', options: ['SOL', 'SRM', 'RAY', 'ORCA'], cat: 'solana', diff: 'easy' },
  { q: 'What programming language are Solana programs (smart contracts) typically written in?', a: 'Rust', options: ['Rust', 'Solidity', 'Go', 'Python'], cat: 'solana' },
  { q: 'What is the smallest unit of SOL called?', a: 'Lamport', options: ['Lamport', 'Wei', 'Gwei', 'Satoshi'], cat: 'solana' },
  { q: 'What is Solana\'s theoretical max TPS (transactions per second)?', a: '65,000', options: ['65,000', '10,000', '1,000,000', '4,500'], cat: 'solana' },
  { q: 'Which Solana DEX aggregator is known for finding the best swap routes?', a: 'Jupiter', options: ['Jupiter', 'Uniswap', 'SushiSwap', '1inch'], cat: 'solana' },
  { q: 'What is the Solana runtime environment called?', a: 'Sealevel', options: ['Sealevel', 'EVM', 'MoveVM', 'CosmWasm'], cat: 'solana' },
  { q: 'Who is the co-founder and CEO of Solana Labs?', a: 'Anatoly Yakovenko', options: ['Anatoly Yakovenko', 'Vitalik Buterin', 'Charles Hoskinson', 'Raj Gokal'], cat: 'solana' },
  { q: 'What is the name of the Solana NFT standard by Metaplex?', a: 'Token Metadata', options: ['Token Metadata', 'ERC-721', 'CW-721', 'SPL-NFT'], cat: 'solana' },
  { q: 'What does SPL stand for in Solana?', a: 'Solana Program Library', options: ['Solana Program Library', 'Solana Protocol Layer', 'Smart Program Logic', 'Solana Public Ledger'], cat: 'solana' },
  { q: 'What is the block time on Solana?', a: '~400 milliseconds', options: ['~400 milliseconds', '~12 seconds', '~1 second', '~6 seconds'], cat: 'solana' },
  { q: 'Which Solana wallet is most popular for browser use?', a: 'Phantom', options: ['Phantom', 'MetaMask', 'Keplr', 'Trust Wallet'], cat: 'solana', diff: 'easy' },
  { q: 'What is the name of Solana\'s PoS leader selection algorithm?', a: 'Tower BFT', options: ['Tower BFT', 'Tendermint', 'Casper FFG', 'HotStuff'], cat: 'solana', diff: 'hard' },
  { q: 'What year was Solana mainnet beta launched?', a: '2020', options: ['2020', '2018', '2019', '2021'], cat: 'solana' },
  { q: 'What is the name of Solana\'s data propagation protocol?', a: 'Turbine', options: ['Turbine', 'Gossip', 'libp2p', 'DevP2P'], cat: 'solana', diff: 'hard' },
  { q: 'Which token standard handles fungible tokens on Solana?', a: 'SPL Token', options: ['SPL Token', 'ERC-20', 'BEP-20', 'CW-20'], cat: 'solana' },
  { q: 'What is the Solana validator client written in Rust called?', a: 'Agave', options: ['Agave', 'Geth', 'Prysm', 'Lighthouse'], cat: 'solana', diff: 'hard' },
  { q: 'What Solana feature allows parallel transaction processing?', a: 'Sealevel', options: ['Sealevel', 'Sharding', 'Rollups', 'Channels'], cat: 'solana' },
  { q: 'What is the minimum SOL needed to create a token account on Solana?', a: '~0.002 SOL (rent-exempt)', options: ['~0.002 SOL (rent-exempt)', '0.1 SOL', '1 SOL', '0.01 SOL'], cat: 'solana' },
  { q: 'Which Solana AMM was one of the first and uses constant product formula?', a: 'Raydium', options: ['Raydium', 'Uniswap', 'Curve', 'Balancer'], cat: 'solana' },
  { q: 'What is the name of Solana\'s mempool replacement?', a: 'Gulf Stream', options: ['Gulf Stream', 'Dark Forest', 'Flashbots', 'MEV Boost'], cat: 'solana', diff: 'hard' },
  { q: 'What compression technology reduces Solana NFT costs by 99%+?', a: 'State Compression (cNFTs)', options: ['State Compression (cNFTs)', 'zk-Rollups', 'Plasma', 'Validium'], cat: 'solana' },
  { q: 'Which Solana liquid staking protocol lets you stake SOL for mSOL?', a: 'Marinade Finance', options: ['Marinade Finance', 'Lido', 'Rocket Pool', 'Ankr'], cat: 'solana' },
  { q: 'What is the Solana account model based on?', a: 'Account-based (like a file system)', options: ['Account-based (like a file system)', 'UTXO-based', 'eUTXO-based', 'Object-based'], cat: 'solana' },

  // ── Blockchain General ──
  { q: 'What is the maximum supply of Bitcoin?', a: '21 million', options: ['21 million', '100 million', '18.5 million', 'Unlimited'], cat: 'blockchain', diff: 'easy' },
  { q: 'What cryptographic function does Bitcoin mining use?', a: 'SHA-256', options: ['SHA-256', 'Keccak-256', 'Scrypt', 'Blake2b'], cat: 'blockchain' },
  { q: 'What does DeFi stand for?', a: 'Decentralized Finance', options: ['Decentralized Finance', 'Digital Finance', 'Distributed Fintech', 'Deflationary Finance'], cat: 'blockchain', diff: 'easy' },
  { q: 'What is a "smart contract"?', a: 'Self-executing code on a blockchain', options: ['Self-executing code on a blockchain', 'A legal document on paper', 'An AI-written agreement', 'A centralized database query'], cat: 'blockchain', diff: 'easy' },
  { q: 'What was the first cryptocurrency?', a: 'Bitcoin', options: ['Bitcoin', 'Ethereum', 'Litecoin', 'Dogecoin'], cat: 'blockchain', diff: 'easy' },
  { q: 'What is a "51% attack"?', a: 'When an entity controls majority of network hashrate', options: ['When an entity controls majority of network hashrate', 'When 51% of nodes go offline', 'When 51% of tokens are burned', 'When gas fees exceed 51 gwei'], cat: 'blockchain' },
  { q: 'What does AMM stand for in DeFi?', a: 'Automated Market Maker', options: ['Automated Market Maker', 'Advanced Money Management', 'Algorithmic Mining Mechanism', 'Asset Margin Module'], cat: 'blockchain' },
  { q: 'What is the Byzantine Generals Problem?', a: 'Reaching consensus in a distributed system with potential traitors', options: ['Reaching consensus in a distributed system with potential traitors', 'A military strategy game', 'A type of blockchain attack', 'An encryption algorithm'], cat: 'blockchain', diff: 'hard' },
  { q: 'What is "impermanent loss" in DeFi?', a: 'Loss from providing liquidity vs holding tokens', options: ['Loss from providing liquidity vs holding tokens', 'Permanent loss of funds in a hack', 'Temporary network downtime losses', 'Loss from failed transactions'], cat: 'blockchain' },
  { q: 'What does TVL stand for in DeFi?', a: 'Total Value Locked', options: ['Total Value Locked', 'Token Volume Limit', 'Transaction Verification Layer', 'Total Validator Listings'], cat: 'blockchain' },
  { q: 'What is a "rug pull" in crypto?', a: 'Developers abandoning a project after taking investor funds', options: ['Developers abandoning a project after taking investor funds', 'A legitimate exit strategy', 'Network consensus failure', 'A type of MEV extraction'], cat: 'blockchain' },
  { q: 'What is the Ethereum merge?', a: 'Transition from Proof of Work to Proof of Stake', options: ['Transition from Proof of Work to Proof of Stake', 'Merging ETH and BTC blockchains', 'Combining L1 and L2 networks', 'A hard fork creating two chains'], cat: 'blockchain' },
  { q: 'What does MEV stand for?', a: 'Maximal Extractable Value', options: ['Maximal Extractable Value', 'Minimum Exchange Value', 'Multi-chain EVM Version', 'Market Efficiency Validator'], cat: 'blockchain', diff: 'hard' },
  { q: 'What is a "sybil attack" in blockchain?', a: 'Creating many fake identities to gain disproportionate influence', options: ['Creating many fake identities to gain disproportionate influence', 'Attacking a node with DDoS', 'Exploiting a smart contract bug', 'Double-spending coins'], cat: 'blockchain' },
  { q: 'What is a Merkle tree used for in blockchain?', a: 'Efficiently verifying data integrity', options: ['Efficiently verifying data integrity', 'Generating private keys', 'Mining new blocks', 'Storing transaction history'], cat: 'blockchain' },
  { q: 'What does "gas" represent in blockchain transactions?', a: 'Computational cost of executing operations', options: ['Computational cost of executing operations', 'Transaction speed', 'Network bandwidth', 'Storage space used'], cat: 'blockchain' },
  { q: 'What is a "flash loan" in DeFi?', a: 'An uncollateralized loan that must be repaid in the same transaction', options: ['An uncollateralized loan that must be repaid in the same transaction', 'A very fast bank transfer', 'A loan with lightning-fast approval', 'A micro-loan under $100'], cat: 'blockchain' },
  { q: 'What year was the Bitcoin whitepaper published?', a: '2008', options: ['2008', '2009', '2010', '2007'], cat: 'blockchain' },
  { q: 'What is a "hard fork"?', a: 'A non-backward-compatible protocol upgrade', options: ['A non-backward-compatible protocol upgrade', 'A hardware wallet reset', 'A network shutdown', 'A type of consensus mechanism'], cat: 'blockchain' },
  { q: 'What is the purpose of a "nonce" in blockchain?', a: 'A number used once in mining/transaction ordering', options: ['A number used once in mining/transaction ordering', 'A type of cryptocurrency', 'A network identifier', 'A wallet address format'], cat: 'blockchain' },
  { q: 'What layer are rollups considered in blockchain scaling?', a: 'Layer 2', options: ['Layer 2', 'Layer 0', 'Layer 1', 'Layer 3'], cat: 'blockchain' },
  { q: 'What is an "oracle" in blockchain context?', a: 'A service that provides real-world data to smart contracts', options: ['A service that provides real-world data to smart contracts', 'A prediction market', 'A type of validator', 'A consensus algorithm'], cat: 'blockchain' },

  // ── Crypto Culture & History ──
  { q: 'What is "HODL" originally?', a: 'A typo for "hold" in a 2013 Bitcoin forum post', options: ['A typo for "hold" in a 2013 Bitcoin forum post', 'Hold On for Dear Life (official acronym)', 'A trading strategy name', 'A protocol name'], cat: 'culture', diff: 'easy' },
  { q: 'What was the first item purchased with Bitcoin?', a: 'Two pizzas', options: ['Two pizzas', 'A car', 'A house', 'A laptop'], cat: 'culture', diff: 'easy' },
  { q: 'How much Bitcoin was paid for two pizzas on Bitcoin Pizza Day?', a: '10,000 BTC', options: ['10,000 BTC', '1,000 BTC', '100 BTC', '50,000 BTC'], cat: 'culture' },
  { q: 'Who is Satoshi Nakamoto?', a: 'The pseudonymous creator of Bitcoin', options: ['The pseudonymous creator of Bitcoin', 'The CEO of Binance', 'Ethereum\'s founder', 'A Japanese mathematician'], cat: 'culture', diff: 'easy' },
  { q: 'What does "DYOR" stand for?', a: 'Do Your Own Research', options: ['Do Your Own Research', 'Did You Order Recently', 'Decentralized Yield On Returns', 'Don\'t Yield On Rewards'], cat: 'culture', diff: 'easy' },
  { q: 'What event halves Bitcoin\'s block reward approximately every 4 years?', a: 'The Halving', options: ['The Halving', 'The Merge', 'The Fork', 'The Burn'], cat: 'culture' },
  { q: 'What is a "whale" in crypto terminology?', a: 'An entity holding a very large amount of cryptocurrency', options: ['An entity holding a very large amount of cryptocurrency', 'A type of scam', 'A mining pool', 'A blockchain explorer'], cat: 'culture', diff: 'easy' },
  { q: 'What does "GM" mean in crypto Twitter?', a: 'Good Morning', options: ['Good Morning', 'General Manager', 'Gain More', 'Governance Model'], cat: 'culture', diff: 'easy' },
  { q: 'What is "alpha" in crypto context?', a: 'Insider or early information about profitable opportunities', options: ['Insider or early information about profitable opportunities', 'The first version of a protocol', 'A type of token', 'A consensus mechanism'], cat: 'culture' },
  { q: 'What is a "airdrop" in crypto?', a: 'Free distribution of tokens to wallet addresses', options: ['Free distribution of tokens to wallet addresses', 'Dropping prices suddenly', 'A DDoS attack method', 'Sending tokens to a burn address'], cat: 'culture', diff: 'easy' },

  // ── Security & Privacy ──
  { q: 'What is a "seed phrase" (mnemonic)?', a: '12-24 words that can restore a crypto wallet', options: ['12-24 words that can restore a crypto wallet', 'A password for exchanges', 'An API key for dApps', 'A type of encryption'], cat: 'security' },
  { q: 'What is a "cold wallet"?', a: 'An offline wallet not connected to the internet', options: ['An offline wallet not connected to the internet', 'A wallet with zero balance', 'A wallet in cold storage (freezer)', 'A deactivated exchange account'], cat: 'security', diff: 'easy' },
  { q: 'What is "phishing" in the crypto context?', a: 'Tricking users into revealing private keys or signing malicious transactions', options: ['Tricking users into revealing private keys or signing malicious transactions', 'Mining tokens on someone else\'s computer', 'A legitimate marketing strategy', 'A type of consensus attack'], cat: 'security' },
  { q: 'What is a "multisig" wallet?', a: 'A wallet requiring multiple signatures to authorize transactions', options: ['A wallet requiring multiple signatures to authorize transactions', 'A wallet that holds multiple tokens', 'A wallet with multiple addresses', 'A wallet for multiple users to view'], cat: 'security' },
  { q: 'What is "front-running" in blockchain?', a: 'Placing a transaction ahead of a known pending transaction for profit', options: ['Placing a transaction ahead of a known pending transaction for profit', 'Being the first to validate a block', 'Running a node before mainnet launch', 'A marketing strategy for token launches'], cat: 'security', diff: 'hard' },

  // ── Technical Deep ──
  { q: 'What is an ERC-20 token?', a: 'A fungible token standard on Ethereum', options: ['A fungible token standard on Ethereum', 'An NFT standard', 'A Solana token type', 'A Bitcoin improvement proposal'], cat: 'technical' },
  { q: 'What is the difference between L1 and L2?', a: 'L1 is the base blockchain, L2 processes transactions off-chain', options: ['L1 is the base blockchain, L2 processes transactions off-chain', 'L1 is faster than L2', 'L2 is more secure than L1', 'L1 and L2 are the same'], cat: 'technical' },
  { q: 'What is a "zero-knowledge proof"?', a: 'Proving you know something without revealing the information itself', options: ['Proving you know something without revealing the information itself', 'A proof that no transactions occurred', 'An empty block validation', 'A way to hide wallet balances'], cat: 'technical', diff: 'hard' },
  { q: 'What is "sharding" in blockchain?', a: 'Splitting the network into parallel processing groups', options: ['Splitting the network into parallel processing groups', 'Breaking encryption keys', 'Destroying unused tokens', 'A type of fork'], cat: 'technical' },
  { q: 'What is a "bridge" in crypto?', a: 'A protocol that transfers assets between different blockchains', options: ['A protocol that transfers assets between different blockchains', 'A physical network connector', 'A type of liquidity pool', 'A governance mechanism'], cat: 'technical' },
  { q: 'What is a "wrapped" token?', a: 'A token pegged 1:1 to another asset on a different chain', options: ['A token pegged 1:1 to another asset on a different chain', 'A hidden token in a wallet', 'A compressed NFT', 'A token with limited supply'], cat: 'technical' },
  { q: 'What is the purpose of a "governance token"?', a: 'Voting on protocol decisions and parameter changes', options: ['Voting on protocol decisions and parameter changes', 'Paying gas fees', 'Mining new blocks', 'Backing stablecoin value'], cat: 'technical' },
  { q: 'What is "composability" in DeFi?', a: 'The ability of protocols to interact with each other like building blocks', options: ['The ability of protocols to interact with each other like building blocks', 'The process of creating new tokens', 'Writing smart contract code', 'Combining multiple wallets'], cat: 'technical' },
];
// Reputation v1 rate-limit: 1 request per 10 seconds per IP
const reputationRateLimit = new Map(); // key: `repv1:${ip}` → timestamp
const PRISM_EARN_COOLDOWN_TABLE = {
  game_orbit: 60_000,
  game_defender: 60_000,
  game_gravity: 60_000,
  quest_daily: 24 * 60 * 60_000,
  quest_weekly: 7 * 24 * 60 * 60_000,
  quest_milestone: 24 * 60 * 60_000,   // 1 per day
  challenge_win: 10 * 60_000,           // 10 min (was 10s — exploitable)
  scan_wallet: 60_000,                  // 1 min
  sybil_hunt: 120_000,                  // 2 min
  text_quest: 24 * 60 * 60_000,        // 1 per day (was 30s — exploitable for 288K/day)
  first_mint: 30 * 24 * 60 * 60_000,   // effectively one-time (30 days)
  achievement: 5 * 60_000,
};
// Global daily cap for non-game earn sources (prevents coin inflation exploits)
const NON_GAME_DAILY_EARN_CAP = 1500;
// Sub-caps per activity type (within the global cap)
const DAILY_HUNT_CAP = 500;    // max 500 coins/day from sybil hunts
const DAILY_SCAN_CAP = 100;    // max 100 coins/day from clean scans
const DAILY_QUIZ_CAP = 500;    // max 500 coins/day from quiz
const QUIZ_CORRECT_REWARD = 5;
// Valid text quest IDs (must match src/lib/textQuests.ts)
const VALID_TEXT_QUEST_IDS = new Set(['abandoned_station', 'pirate_ambush', 'dark_matter_anomaly', 'prison_break', 'dominator_factory', 'election_day', 'alien_zoo', 'smugglers_run', 'wormhole_gambit', 'living_city', 'galactic_jackpot', 'jungle_survey', 'plague_ship', 'fortress_heist', 'merc_contract', 'alien_embassy']);
const PRISM_EARN_COOLDOWN_DEFAULT = 5 * 60 * 1000;

// Known program IDs → human-readable names (used for wallet profiling)
const PROGRAM_LABELS = {
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcPX9t': 'Jupiter V4',
  'DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M': 'Jupiter DCA',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora',
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': 'Phoenix',
  'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ': 'Saber',
  'SSwapUtytfBdBn1b9NUGG6foMVPtcWgpRU32HToDUZr': 'Step Finance',
  'mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68': 'Marinade',
  'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': 'Marinade Finance',
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD': 'Marinade',
  'jCebN34bUfdeUhR6bhNixjhCSnx9CY23HsmUkT7XjVV': 'Jito',
  'So1endDq2YkqhipRh3WViPa8hFb7GVEtcEMF3CBAK8h': 'Solend',
  'CMZYPASGWeTz7RNGHaRJfCq2XQ5pYK6nDvVQxzkH51zb': 'Solend',
  'KLend2g3cP87ber41GXWsSZQz9R1hGT2bVBaeEdnKHR': 'Kamino',
  'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': 'marginfi',
  'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1': 'Tensor',
  'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN': 'Tensor Swap',
  'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K': 'Magic Eden V2',
  'hadeK9DLv9eA7ya5KnRSb4dTSitisSCRoB68Y8hmjtR': 'Magic Eden V3',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex',
  'BGUMAp9Gq7iTEuizy4pqAxsTkFQ1XyUbSreFdn6YqwPc': 'Bubblegum',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'Token Program',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'ATA Program',
  'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb': 'Wormhole',
  'FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH': 'Pyth Oracle',
  'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy': 'Stake Pool',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr': 'Memo',
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB': 'Phantom',
  'ComputeBudget111111111111111111111111111111': 'Compute Budget',
  '11111111111111111111111111111111': 'System Program',
};

// Known scam contracts / rug-pull deployers
const KNOWN_SCAM_ADDRESSES = new Set([]);
const scamListFile = path.join(process.cwd(), 'scam_addresses.json');
try {
  if (fs.existsSync(scamListFile)) {
    const list = JSON.parse(fs.readFileSync(scamListFile, 'utf8'));
    if (Array.isArray(list)) list.forEach(a => KNOWN_SCAM_ADDRESSES.add(a));
    console.log(`[sybil] Loaded ${KNOWN_SCAM_ADDRESSES.size} known scam addresses`);
  }
} catch {}

// Shared helper: fetch parsed transactions for an address (uses JSON-RPC batch)
async function fetchParsedTransactions(address, limit = 50) {
  const rpcUrl = getRpcUrl(address) || 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpcUrl, 'confirmed');
  const pubkey = new PublicKey(address);
  const sigs = await conn.getSignaturesForAddress(pubkey, { limit });
  if (!sigs.length) return { signatures: sigs, parsed: [] };
  const sigStrings = sigs.map(s => s.signature);
  const parsed = (await batchGetParsedTxs(getBatchRpcUrl(address), sigStrings, { batchSize: 100, delayMs: 300 })).filter(Boolean);
  return { signatures: sigs, parsed };
}

// ═══ Helius Enhanced Transactions API ═══

function getDominantFundingSource(map, amountKey) {
  let address = null;
  let amount = 0;
  let count = 0;
  let total = 0;
  for (const [candidate, info] of map || []) {
    if (!candidate || TREASURY_WALLETS.has(candidate)) continue;
    const candidateAmount = Number(info?.[amountKey]) || 0;
    if (candidateAmount <= 0) continue;
    total += candidateAmount;
    if (candidateAmount > amount) {
      address = candidate;
      amount = candidateAmount;
      count = Math.max(0, Math.round(Number(info?.count) || 0));
    }
  }
  return {
    address,
    amount,
    count,
    total,
    share: total > 0 ? amount / total : 0,
  };
}

function getDominantTokenFundingSource(tokenFundingSources, { stableOnly = false } = {}) {
  const aggregated = new Map();
  for (const [mint, mintSources] of tokenFundingSources || []) {
    if (stableOnly && !STABLECOIN_FUNDING_MINTS.has(mint)) continue;
    for (const [address, info] of mintSources || []) {
      const existing = aggregated.get(address) || { totalAmount: 0, count: 0, mints: new Set() };
      existing.totalAmount += Number(info?.totalAmount) || 0;
      existing.count += Math.max(0, Math.round(Number(info?.count) || 0));
      existing.mints.add(mint);
      aggregated.set(address, existing);
    }
  }

  const dominant = getDominantFundingSource(aggregated, 'totalAmount');
  const dominantEntry = dominant.address ? aggregated.get(dominant.address) : null;
  return {
    ...dominant,
    mints: dominantEntry ? [...dominantEntry.mints] : [],
  };
}

const {
  enhancedTxCache,
  fetchEnhancedTxHistory,
  parseEnhancedTransactions,
  summarizeEnhancedTxHistory,
  getEnhancedTxTimestampSeconds,
  getEnhancedTxTimestampMs,
} = createHeliusEnhancedService({
  heliusKeys: HELIUS_KEYS,
  trackedFundingTokenMints: TRACKED_FUNDING_TOKEN_MINTS,
  stablecoinFundingMints: STABLECOIN_FUNDING_MINTS,
  treasuryWallets: TREASURY_WALLETS,
  isProgramAddress,
});

async function fetchEnhancedTransactions(address, limit = 1000) {
  const data = await fetchEnhancedTxHistory(address, { limit });
  if (!data) return null;
  return data;
}

async function fetchDominantEnhancedFunder(address, minShare = 0.7) {
  const history = await fetchEnhancedTxHistory(address, { limit: 100 });
  if (!history?.txs?.length) return null;
  const summary = summarizeEnhancedTxHistory(history.txs, address, 0);
  const dominant = getDominantFundingSource(summary.incoming, 'totalSol');
  if (!dominant.address || dominant.share < minShare || dominant.amount <= 0.01) return null;
  return { summary, dominant };
}

const clusterCache = new Map();
const reputationV2RateLimit = new Map();

// ═══ 2% Burn Fee Helper ═══
let totalBurned = globalThis._totalBurned || 0;
const totalBurnedRef = {
  get value() {
    return totalBurned;
  },
  set value(value) {
    totalBurned = value;
    globalThis._totalBurned = value;
  },
};
function applyBurnFee(amount) {
  if (amount <= 50) return { spent: amount, burned: 0, net: amount };
  const burned = Math.max(1, Math.floor(amount * 0.02));
  totalBurnedRef.value = totalBurnedRef.value + burned;
  return { spent: amount, burned, net: amount - burned };
}

// ═══ Daily Game Coin Cap ═══
const DAILY_GAME_COIN_CAP = 2000;
const GAME_COINS_TODAY_FILE = path.join(process.cwd(), 'game_coins_today.json');
const gameCoinsToday = new Map(); // address → { coins: number, date: string }
// Load persisted daily caps
try {
  if (fs.existsSync(GAME_COINS_TODAY_FILE)) {
    const raw = JSON.parse(fs.readFileSync(GAME_COINS_TODAY_FILE, 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    for (const [addr, entry] of Object.entries(raw)) {
      if (entry && entry.date === today) gameCoinsToday.set(addr, entry);
    }
  }
} catch {}
function getGameCoinsToday(address) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = gameCoinsToday.get(address);
  if (!entry || entry.date !== today) {
    gameCoinsToday.set(address, { coins: 0, date: today });
    return 0;
  }
  return entry.coins;
}
let _saveGameCoinsTimer = null;
function saveGameCoinsToday() {
  if (_saveGameCoinsTimer) return;
  _saveGameCoinsTimer = setTimeout(() => {
    _saveGameCoinsTimer = null;
    const obj = {};
    for (const [addr, entry] of gameCoinsToday) obj[addr] = entry;
    const tmp = GAME_COINS_TODAY_FILE + '.tmp';
    fs.promises.writeFile(tmp, JSON.stringify(obj), 'utf8')
      .then(() => fs.promises.rename(tmp, GAME_COINS_TODAY_FILE))
      .catch(() => {});
  }, 5000);
}
function addGameCoinsToday(address, amount) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = gameCoinsToday.get(address);
  if (!entry || entry.date !== today) {
    gameCoinsToday.set(address, { coins: amount, date: today });
  } else {
    entry.coins += amount;
  }
  saveGameCoinsToday();
}

// ═══ Delta Validation per Game Mode ═══
const MAX_DELTA_PER_GAME = { orbit: 1000, destroyer: 1800, gravity: 1200, wars: 800, territory: 800 };

// ═══ Staking (Prism Vault) ═══
// Stakes created before this timestamp use old flat rate; after use brackets
// All stakes use bracket system by default (fallback 0 = epoch start = all stakes are "new")
const BRACKETS_DEPLOY_TS = parseInt(process.env.BRACKETS_DEPLOY_TS || '0', 10) || 0;
const calcUnclaimedYield = (stake) => rawCalcUnclaimedYield(stake, { bracketsDeployTs: BRACKETS_DEPLOY_TS });

function getStakingBoost(address) {
  const w = walletDatabase.get(address);
  const stake = w?.staking;
  if (!stake || !stake.tier) return 0;
  return STAKING_TIERS[stake.tier]?.boostRate || 0;
}

// ═══ Tournament System (Tiered: daily/weekly/monthly) ═══
const TOURNAMENT_FILE = path.join(process.cwd(), 'tournament_data.json');
const TOURNAMENT_TIERS = {
  daily:   { entryFee: 1000,  durationMs: 24 * 3600000,      label: 'Daily',   burnRate: 0.10 },
  weekly:  { entryFee: 5000,  durationMs: 7 * 24 * 3600000,  label: 'Weekly',  burnRate: 0.10 },
  monthly: { entryFee: 25000, durationMs: 30 * 24 * 3600000, label: 'Monthly', burnRate: 0.10 },
};
const TOURNAMENT_MODES = ['orbit', 'gravity', 'destroyer'];
const PRIZE_SHARES = {
  daily:   [0.50, 0.30, 0.20],                                         // top-3
  weekly:  [0.35, 0.22, 0.15, 0.10, 0.10, 0.08],                     // top-6
  monthly: [0.30, 0.18, 0.12, 0.09, 0.08, 0.06, 0.05, 0.04, 0.04, 0.04], // top-10
};
// Base prizes per place — paid by platform on top of player pool (index = place-1)
// Modest guarantees so platform stays sustainable with low participation
const TOURNAMENT_BASE_PRIZES = {
  daily:   [500, 250, 100],                                                     // total 850
  weekly:  [2000, 1500, 1000, 500, 250, 100],                                  // total 5,350
  monthly: [10000, 5000, 3000, 2000, 1500, 1000, 750, 500, 250, 100],         // total 24,100
};
const TOURNAMENT_BASE_PRIZE_SCALING = {
  daily: { targetParticipants: 8, minScale: 0.35 },
  weekly: { targetParticipants: 16, minScale: 0.25 },
  monthly: { targetParticipants: 30, minScale: 0.2 },
};
// XP rewards per place — equal step of 100 XP across all tiers
const TOURNAMENT_XP_REWARDS = {
  daily:   [300, 200, 100],                                                     // step 100
  weekly:  [600, 500, 400, 300, 200, 100],                                     // step 100
  monthly: [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],               // step 100
};
const activeTournaments = { daily: null, weekly: null, monthly: null };
const tournamentHistory = [];
let tournamentModeIndex = 0;
const tournamentStore = createJsonColumnStore({
  jsonPath: TOURNAMENT_FILE,
  tableName: 'tournaments',
  keyColumn: 'tier',
  readJson: (parsed) => {
    const entries = new Map();
    for (const tier of Object.keys(TOURNAMENT_TIERS)) {
      entries.set(tier, parsed?.active?.[tier] ?? null);
    }
    entries.set(TOURNAMENT_HISTORY_KEY, Array.isArray(parsed?.history) ? parsed.history.slice(0, 50) : []);
    entries.set(TOURNAMENT_META_KEY, {
      modeIndex: typeof parsed?.modeIndex === 'number' ? parsed.modeIndex : 0,
    });
    return entries;
  },
  writeJson: (entries) => ({
    active: {
      daily: entries.get('daily') ?? null,
      weekly: entries.get('weekly') ?? null,
      monthly: entries.get('monthly') ?? null,
    },
    history: Array.isArray(entries.get(TOURNAMENT_HISTORY_KEY)) ? entries.get(TOURNAMENT_HISTORY_KEY).slice(0, 50) : [],
    modeIndex: typeof entries.get(TOURNAMENT_META_KEY)?.modeIndex === 'number' ? entries.get(TOURNAMENT_META_KEY).modeIndex : 0,
  }),
  debounceMs: 500,
  logLabel: 'tournament',
});

function saveTournament() {
  try {
    tournamentStore.replaceAll(new Map([
      ['daily', activeTournaments.daily],
      ['weekly', activeTournaments.weekly],
      ['monthly', activeTournaments.monthly],
      [TOURNAMENT_HISTORY_KEY, tournamentHistory.slice(0, 50)],
      [TOURNAMENT_META_KEY, { modeIndex: tournamentModeIndex }],
    ]));
  } catch (e) {
    console.warn('[tournament] save error', e.message);
  }
}

function getTournamentBasePrizes(tier, participantCount = 0) {
  const basePrizes = TOURNAMENT_BASE_PRIZES[tier] || [];
  const scaling = TOURNAMENT_BASE_PRIZE_SCALING[tier] || { targetParticipants: basePrizes.length || 1, minScale: 0.25 };
  const joined = Math.max(0, Math.floor(Number(participantCount) || 0));
  if (joined < 2) return basePrizes.map(() => 0);
  const eligiblePlaces = Math.min(basePrizes.length, joined);
  if (eligiblePlaces <= 0) return basePrizes.map(() => 0);
  const normalized = Math.sqrt(Math.min(1, joined / Math.max(1, scaling.targetParticipants)));
  const scale = Math.max(scaling.minScale, normalized);
  return basePrizes.map((amount, index) => (
    index < eligiblePlaces ? Math.max(0, Math.floor(amount * scale)) : 0
  ));
}

function createTournamentForTier(tier) {
  const cfg = TOURNAMENT_TIERS[tier];
  if (!cfg) return;
  const mode = TOURNAMENT_MODES[tournamentModeIndex % TOURNAMENT_MODES.length];
  tournamentModeIndex++;
  activeTournaments[tier] = {
    id: `t_${tier}_${Date.now()}`,
    tier,
    mode,
    entryFee: cfg.entryFee,
    prizePool: 0,
    startTime: Date.now(),
    endTime: Date.now() + cfg.durationMs,
    entries: {},
    status: 'active',
    label: cfg.label,
  };
  console.log(`[tournament] Created ${tier} tournament: ${activeTournaments[tier].id} mode=${mode}`);
  saveTournament();
}

function finalizeTournamentTier(tier) {
  const t = activeTournaments[tier];
  if (!t || t.status !== 'active') return;
  t.status = 'ended';
  const sorted = Object.entries(t.entries)
    .map(([addr, data]) => ({ address: addr, score: data.score }))
    .filter(e => e.score > 0) // exclude players who joined but never submitted
    .sort((a, b) => b.score - a.score);
  const pool = t.prizePool;
  const winners = [];
  const shares = PRIZE_SHARES[tier] || PRIZE_SHARES.daily;
  const maxWinners = Math.min(shares.length, sorted.length);
  let totalPaid = 0;
  const basePrizes = getTournamentBasePrizes(tier, Object.keys(t.entries || {}).length);
  for (let i = 0; i < maxWinners; i++) {
    const poolPrize = Math.floor(pool * shares[i]);
    // Base prize from platform (per place)
    const basePrize = basePrizes[i] || 0;
    const totalPrize = poolPrize + basePrize;
    const walletUpdates = {};
    if (totalPrize > 0) {
      const cur = getCoinBalance(sorted[i].address);
      const newBalance = cur + totalPrize;
      setCoinBalance(sorted[i].address, newBalance);
      addCoinEarned(sorted[i].address, totalPrize);
      walletUpdates.coins = newBalance;
      totalPaid += poolPrize; // only track pool portion for burn calc
    }
    // Award XP for placement
    const xpRewards = TOURNAMENT_XP_REWARDS[tier] || [];
    const xpAmount = xpRewards[i] || 0;
    if (xpAmount > 0) {
      const wEntry = walletDatabase.get(sorted[i].address);
      walletUpdates.tournamentXP = ((wEntry?.tournamentXP || 0) + xpAmount);
    }
    if (Object.keys(walletUpdates).length > 0) {
      updateWalletEntry(sorted[i].address, walletUpdates);
    }
    winners.push({ address: sorted[i].address, score: sorted[i].score, prize: totalPrize, poolPrize, basePrize, place: i + 1, xp: xpAmount });
    if (totalPrize > 0) {
      pushNotification(sorted[i].address, 'tournament_result', `${tier} tournament ended — #${i + 1}, +${totalPrize} coins`, { tier, placement: i + 1, prize: totalPrize });
    }
  }
  // Any remaining pool dust (fewer participants than prize slots) is burned
  if (totalPaid < pool) {
    totalBurnedRef.value = totalBurnedRef.value + (pool - totalPaid);
    persistCoinBalances();
  }
  t.basePrizes = basePrizes.slice(0, maxWinners);
  t.winners = winners;
  tournamentHistory.unshift({ ...t });
  if (tournamentHistory.length > 50) tournamentHistory.length = 50;
  console.log(`[tournament] Finalized ${t.id}, ${winners.length} winners, pool=${pool}, basePrizes=${basePrizes.slice(0, maxWinners).join('/')}`);
  activeTournaments[tier] = null;
  saveTournament();
}

function checkTournaments() {
  const now = Date.now();
  for (const tier of Object.keys(TOURNAMENT_TIERS)) {
    const t = activeTournaments[tier];
    if (t && now > t.endTime) finalizeTournamentTier(tier);
    if (!activeTournaments[tier]) createTournamentForTier(tier);
  }
}
// Backward compat alias
function checkTournament() { checkTournaments(); }

const constellationCache = new Map();

// ═══ Notification System ═══
const notificationsDb = new Map(); // address → notification[]
const NOTIFICATIONS_FILE = path.join(METADATA_DIR, 'notifications.json');
const MAX_NOTIFICATIONS_PER_USER = 100;
const notificationsStore = createJsonColumnStore({
  jsonPath: NOTIFICATIONS_FILE,
  tableName: 'notifications',
  keyColumn: 'address',
  readJson: (parsed) => Object.entries(parsed || {}),
  writeJson: (entries) => Object.fromEntries(entries),
  debounceMs: 5000,
  logLabel: 'notifications',
});

function pushNotification(address, type, message, meta = {}) {
  if (!address) return;
  const notifs = notificationsDb.get(address) || [];
  notifs.unshift({
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type, // 'challenge_win' | 'challenge_loss' | 'challenge_expired' | 'tournament_result' | 'quest_milestone' | 'yield_available' | 'weekly_payout' | 'system'
    message,
    meta,
    timestamp: new Date().toISOString(),
    read: false,
  });
  if (notifs.length > MAX_NOTIFICATIONS_PER_USER) notifs.length = MAX_NOTIFICATIONS_PER_USER;
  notificationsDb.set(address, notifs);
  saveNotificationsDebounced();
}

// ═══ P2P Challenge System ═══
const CHALLENGES_FILE = path.join(METADATA_DIR, 'challenges.json');
const challenges = [];
const challengesStore = createJsonColumnStore({
  jsonPath: CHALLENGES_FILE,
  tableName: 'challenges',
  keyColumn: 'id',
  readJson: (parsed) => {
    const entries = new Map();
    const list = Array.isArray(parsed?.challenges) ? parsed.challenges : (Array.isArray(parsed) ? parsed : []);
    list.forEach((challenge, index) => {
      const key = typeof challenge?.id === 'string' && challenge.id ? challenge.id : `challenge:${index}`;
      entries.set(key, challenge);
    });
    return entries;
  },
  writeJson: (entries) => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    challenges: Array.from(entries.values()),
  }),
  debounceMs: 500,
  logLabel: 'challenges',
});

// ── Weekly Challenge Rewards — checks every hour, distributes Monday 00:00 UTC ──
globalThis._challengeWeeklyHistory = globalThis._challengeWeeklyHistory || [];
globalThis._lastWeeklyRewardAt = globalThis._lastWeeklyRewardAt || 0;
// Coins: aligned with daily tournament base prizes (1000/700/400) but lower since no entry fee
// Coins: between daily (1k base) and weekly (5k base) tournament — motivating but not game-breaking
// XP: top-3 get meaningful XP toward Ranger ranks
const WEEKLY_REWARDS =    [2000, 1200, 600, 200, 200, 100, 100, 100, 100, 100]; // total: ~4,700/week
const WEEKLY_XP_REWARDS = [ 500,  300, 200,   0,   0,   0,   0,   0,   0,   0]; // top-3 only

const leaderboards = leaderboardEntries;
const activeChallenges = challenges;
const notifications = notificationsDb;
const achievements = achievementData;
const revives = reviveData;
const quests = questProgress;
const completedTournaments = tournamentHistory;
const {
  persistWalletDatabase,
  saveWalletDatabaseDebounced,
  saveNotificationsDebounced,
  saveChallenges,
  saveCoinBalancesDebounced,
  saveMintedAddressesDebounced,
  saveScoreHistoryDebounced,
  saveLeaderboardDebounced,
  saveAchievementDataDebounced,
  saveReviveDataDebounced,
  saveQuestProgressDebounced,
  saveTournamentsDebounced,
  saveChallengesDebounced,
  savePrismDataDebounced,
} = createPersistenceServices({
  fs,
  walletDatabase,
  walletDbFile: WALLET_DB_FILE,
  walletStore,
  fbAvailable,
  fbBatchSet,
  notificationsDb,
  notificationsFile: NOTIFICATIONS_FILE,
  notificationsStore,
  challenges,
  challengesFile: CHALLENGES_FILE,
  challengesStore,
  persistCoinBalances,
  saveMintedAddresses,
  persistScoreHistory,
  persistLeaderboard,
  persistAchievementData,
  persistReviveData,
  persistQuestProgress,
  saveTournament,
  debouncedSavePrism,
});
const USED_TX_FILE = path.join(METADATA_DIR, 'used-tx-signatures.json');
const usedBuyTxSignatures = globalThis._usedBuyTxMap || (() => {
  const map = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(USED_TX_FILE, 'utf8'));
    for (const [key, value] of Object.entries(raw)) map.set(key, value);
  } catch {}
  return (globalThis._usedBuyTxMap = map);
})();
const DAILY_PURCHASES_FILE = path.join(METADATA_DIR, 'daily-purchases.json');
const dailyPurchases = globalThis._dailyPurchases || (() => {
  const map = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(DAILY_PURCHASES_FILE, 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    for (const [key, value] of Object.entries(raw)) {
      if (key.endsWith(`:${today}`)) map.set(key, value);
    }
  } catch {}
  return (globalThis._dailyPurchases = map);
})();
const COIN_PACKAGES = [
  { coins: 5000, solPrice: 0.015 },
  { coins: 15000, solPrice: 0.038 },
  { coins: 50000, solPrice: 0.11 },
  { coins: 150000, solPrice: 0.23 },
];
const DAILY_COIN_LIMIT = 300000;
const pendingStakingOps = globalThis._pendingStakingOps || (globalThis._pendingStakingOps = new Set());
const mintBonusLocks = globalThis._mintBonusLocks || (globalThis._mintBonusLocks = new Set());
const firstMintLocks = globalThis._firstMintLocks || (globalThis._firstMintLocks = new Set());
const challengeWeeklyHistory = globalThis._challengeWeeklyHistory;
const {
  buildPublicReputationResponse,
  buildCompositeInput,
  triggerCompositeUpdate,
  backfillCompositeScores,
  rebuildTwitterWalletMap,
} = createReputationBuilderService({
  walletDatabase,
  questProgress,
  activeTournaments,
  tournamentHistory,
  leaderboardEntries,
  achievementData,
  challenges,
  appDb,
  getRecentSybilAnalysis,
  getSybilVerdict,
  getSybilQuickVerdict,
  getServerRangerSnapshot,
  getCoinBalance,
  saveWalletDatabaseDebounced,
  fbAvailable,
  fbSet,
  publicReputationTtlSeconds: PUBLIC_REPUTATION_TTL_SECONDS,
});

const ctx = createContext({
  walletDatabase,
  coinBalances,
  totalBurned: totalBurnedRef,
  mintedAddresses,
  scoreHistory,
  leaderboards,
  sybilCache,
  reputationRateLimit,
  prismEarnRateLimit,
  authChallenges,
  activeChallenges,
  activeTournaments,
  completedTournaments,
  notifications,
  achievements,
  revives,
  quests,
  walletIpLog,
  identityOwnershipCache,
  blackHoleUsedSignatures,
  pendingMintSigners,
  gameSessionProofs,
  prismTransactions,
  feedItems,
  sybilInFlight,
  quizAnswers,
  clusterCache,
  sybilGraph,
  reputationV2RateLimit,
  gameCoinsToday,
  usedBuyTxSignatures,
  dailyPurchases,
  constellationCache,
  enhancedTxCache,
  pendingStakingOps,
  mintBonusLocks,
  firstMintLocks,
  challengeWeeklyHistory,
  port: PORT,
  respondJson,
  readBody,
  getClientIp,
  ipRateLimit,
  rateLimitStore,
  createJwt: createJwtBound,
  verifyJwt,
  requireJwt,
  optionalJwt,
  persistWalletDatabase,
  saveWalletDatabaseDebounced,
  saveCoinBalancesDebounced,
  saveMintedAddressesDebounced,
  saveScoreHistoryDebounced,
  saveLeaderboardDebounced,
  saveAchievementDataDebounced,
  saveReviveDataDebounced,
  saveQuestProgressDebounced,
  saveTournamentsDebounced,
  saveNotificationsDebounced,
  saveChallengesDebounced,
  savePrismDataDebounced,
  debouncedSavePrism,
  saveTournament,
  saveChallenges,
  persistBlackHoleUsedSignatures,
  cleanupBlackHoleUsedSignatures,
  durableClaimSignatures,
  pushNotification,
  requireAdminKey,
  safeParseJson,
  verifyWalletSignature,
  getToday,
  updateWalletEntry,
  getCoinBalance,
  setCoinBalance,
  addCoinEarned,
  addCoinSpent,
  getPrismBalance,
  getCachedSolPriceUsd,
  getCachedSkrPriceUsd,
  getSkrQuote,
  getRpcUrl,
  getBatchRpcUrl,
  parsePublicKey,
  getPrismEarnRateLimit,
  setPrismEarnRateLimit,
  getSybilCacheTtlMs,
  getSybilVerdictHistory,
  submitSybilFeedback,
  getQuestProgressSnapshot,
  invalidateQuestProgressCache,
  getQuestPeriodKey,
  batchGetParsedTxs,
  resolveAccountKey,
  resolveCorsOrigin,
  buildPublicReputationResponse,
  fetchIdentitySnapshot,
  getScoreHistory,
  addScoreEntry,
  calculateCompositeScore,
  buildCompositeInput,
  getSybilVerdict,
  getSybilQuickVerdict,
  getIdentityHolderPerks,
  getStakingBoost,
  getGameCoinsToday,
  addGameCoinsToday,
  verifyGameEarnClaim,
  markGameEarnClaimed,
  applyStakingBoostAfterCap,
  getWalletAchievements,
  claimAchievement,
  isAchievementUnlockVerified,
  markAchievementsUnlocked,
  hasCoreCollectionAsset,
  getRevivesLeft,
  useRevive,
  getBaseUrl,
  fetchMeSlugByMint,
  fetchMagicEdenCollectionStats,
  fetchTensorCollectionStats,
  fetchMeTokenLastPrice,
  resolveAssetFile,
  resolveMetadataFile,
  getContentType,
  assetsDir: ASSETS_DIR,
  createGameSessionProofId,
  toPublicGameSessionProof,
  verifyMagicBlockSeedSlot,
  normalizeGameSessionPayload,
  pruneGameSessionProofs,
  normalizePubkey,
  verifyBlackHoleCommissionTx,
  verifyCloseOperationTx,
  verifyBurnOperationTx,
  verifySwapOperationTx,
  inferBlackHoleAssetKind,
  getWalletLamportDelta,
  calculateBlackHoleReward,
  getOrCreateForgeState,
  getWalletUserData,
  mergeForgeEntries,
  getServerRangerSnapshot,
  meetsForgeRequiredRank,
  isForgeUnlockSatisfied,
  applyBurnFee,
  forgeItemMap: FORGE_ITEM_MAP,
  forgeModuleMap: FORGE_MODULE_MAP,
  canAwardQuizReward,
  getHolderAdjustedCap,
  questSourceIds: QUEST_SOURCE_IDS,
  questXpRewards: QUEST_XP_REWARDS,
  authChallengeTtlMs: AUTH_CHALLENGE_TTL_MS,
  jwtTtl: JWT_TTL,
  nonGameDailyEarnCap: NON_GAME_DAILY_EARN_CAP,
  dailyQuizCap: DAILY_QUIZ_CAP,
  quizCorrectReward: QUIZ_CORRECT_REWARD,
  dailyGameCoinCap: DAILY_GAME_COIN_CAP,
  dailyHuntCap: DAILY_HUNT_CAP,
  dailyScanCap: DAILY_SCAN_CAP,
  freeRevivesPerDay: FREE_REVIVES_PER_DAY,
  achievementRewardsById: ACHIEVEMENT_REWARDS_BY_ID,
  maxDeltaPerGame: MAX_DELTA_PER_GAME,
  maxGameSessionProofs: MAX_GAME_SESSION_PROOFS,
  gameSessionOnchainBonusMultiplier: GAME_SESSION_ONCHAIN_BONUS_MULTIPLIER,
  normalizeGameCoinDeltaForCap,
  prismEarnMaxPerCall: PRISM_EARN_MAX_PER_CALL,
  prismEarnCooldownTable: PRISM_EARN_COOLDOWN_TABLE,
  prismEarnCooldownDefault: PRISM_EARN_COOLDOWN_DEFAULT,
  coinPackages: COIN_PACKAGES,
  dailyCoinLimit: DAILY_COIN_LIMIT,
  buyUsedTxFile: USED_TX_FILE,
  buyDailyPurchasesFile: DAILY_PURCHASES_FILE,
  lamportsPerSol: LAMPORTS_PER_SOL,
  dailyBlackHoleCleanupCap: DAILY_BLACKHOLE_CLEANUP_CAP,
  treasuryAddress: TREASURY_ADDRESS,
  collectionAuthoritySecret: COLLECTION_AUTHORITY_SECRET,
  treasurySecret: TREASURY_SECRET,
  treasurySecretPath: TREASURY_SECRET_PATH,
  metadataDir: METADATA_DIR,
  jupiterApiKey: JUPITER_API_KEY,
  jupiterSwapApiV2: JUPITER_SWAP_API_V2,
  jupiterLiteQuoteApi: JUPITER_LITE_QUOTE_API,
  jupiterLiteSwapApi: JUPITER_LITE_SWAP_API,
  mintPriceSol: MINT_PRICE_SOL,
  skrMint: SKR_MINT,
  tokenProgramId: TOKEN_PROGRAM_ID,
  token2022ProgramId: TOKEN_2022_PROGRAM_ID,
  QUIZ_BANK,
  publicReputationTtlSeconds: PUBLIC_REPUTATION_TTL_SECONDS,
  validTextQuestIds: VALID_TEXT_QUEST_IDS,
  challengesFile: CHALLENGES_FILE,
  getRecentSybilAnalysis,
  getSybilRewardPath,
  saveSybilGraph,
  updateSybilGraphNode,
  checkGraphForKnownSybils,
  loadSybilCacheEntry,
  isFreshSybilCacheEntry,
  refreshCachedSybilAnalysis,
  persistSybilAnalysis,
  persistAutoDetectedScanClusters,
  fetchSybilSampleFor,
  findFirstTxTime,
  fetchParsedTransactions,
  fetchEnhancedTransactions,
  getDominantFundingSource,
  getDominantTokenFundingSource,
  summarizeEnhancedTxHistory,
  fetchEnhancedTxHistory,
  fetchDominantEnhancedFunder,
  isProgramAddress,
  extractSolTransfers: extractTrackedSolTransfers,
  detectTemporalFundingCohort,
  persistFundingEdge,
  persistFundingEdgesForTarget,
  getScanRewardState,
  normalizeScanRewardState,
  computeSybilHuntReward,
  cleanScanRewardCooldownMs: CLEAN_SCAN_REWARD_COOLDOWN_MS,
  scanWalletReward: SCAN_WALLET_REWARD,
  coreCollection: CORE_COLLECTION,
  sybilScanVersion: SYBIL_SCAN_VERSION,
  solMint: SOL_MINT,
  usdcMint: USDC_MINT,
  programLabels: PROGRAM_LABELS,
  treasuryWallets: TREASURY_WALLETS,
  knownLabels: KNOWN_LABELS,
  knownScamAddresses: KNOWN_SCAM_ADDRESSES,
  stakingTiers: STAKING_TIERS,
  getLockTier,
  calcUnclaimedYield,
  bracketsDeployTs: BRACKETS_DEPLOY_TS,
  calcDailyYieldForAmount,
  getEffectiveRate,
  getRateSchedule,
  tournamentTiers: TOURNAMENT_TIERS,
  tournamentXpRewards: TOURNAMENT_XP_REWARDS,
  leaderboardStoreFile: LEADERBOARD_STORE_FILE,
  leaderboardMaxEntries: LEADERBOARD_MAX_ENTRIES,
  mintedAddressesFile: MINTED_ADDRESSES_FILE,
  scoreHistoryFile: SCORE_HISTORY_FILE,
  scoreHistoryMaxEntries: SCORE_HISTORY_MAX,
  fbAvailable,
  fbGet,
  fbGetAll,
  fbSet,
  fbBatchSet,
  notificationsDb,
  tokenMetadataProgramId: TOKEN_METADATA_PROGRAM_ID,
  sendImageDataUrl,
  sanitizeForgeLoadout,
  leaderboardEntries,
  submitLeaderboardEntry,
  persistGameSessionProofs,
  triggerCompositeUpdate,
  getUniqueScanTargetCount,
  parseSecretKey,
  loadSecretKeyFromFile,
  storePendingMint,
  consumePendingMint,
  toCanonGameMode,
  leaderboardCacheRef,
  leaderboardCacheTimeRef,
  weeklyRewards: WEEKLY_REWARDS,
  weeklyXpRewards: WEEKLY_XP_REWARDS,
  checkTournaments,
  getTournamentBasePrizes,
  refundCoinSpent,
  backfillCompositeScores,
});
const initOrchestrator = createInitOrchestrator({
  coinBalanceStore,
  mintedAddressesStore,
  scoreHistoryStore,
  walletStore,
  sybilVerdictStore,
  gameSessionProofStore,
  achievementStore,
  reviveStore,
  questProgressStore,
  notificationsStore,
  challengesStore,
  tournamentStore,
  loadCoinBalances,
  loadMintedAddresses,
  loadScoreHistory,
  loadWalletDatabase,
  loadGameSessionProofs,
  loadAchievementData,
  loadReviveData,
  loadQuestProgress,
  loadNotifications,
  loadChallenges,
  loadTournaments,
  normalizeStoredGameSessionEntry,
  gameSessionStoreFile: GAME_SESSION_STORE_FILE,
  achievementsStoreFile: ACHIEVEMENTS_STORE_FILE,
  revivesStoreFile: REVIVES_STORE_FILE,
  questProgressFile: QUEST_PROGRESS_FILE,
  notificationsFile: NOTIFICATIONS_FILE,
  challengesFile: CHALLENGES_FILE,
  tournamentFile: TOURNAMENT_FILE,
  tournamentTiers: TOURNAMENT_TIERS,
  saveMintedAddresses,
  setTournamentModeIndex: (value) => {
    tournamentModeIndex = value;
  },
  fs,
});
const authHandler = registerAuthRoute(ctx);
const arenaHandler = registerArenaRoute(ctx);
const blinksHandler = registerBlinksRoute(ctx);
const blackholeHandler = registerBlackholeRoute(ctx);
const earnHandler = registerEarnRoute(ctx);
const gameHandler = registerGameRoute(ctx);
const gameV1Handler = registerGameV1Route(ctx);
const healthHandler = registerHealthRoute(ctx);
const marketHandler = registerMarketRoute(ctx);
const metadataHandler = registerMetadataRoute(ctx);
const notificationsHandler = registerNotificationsRoute(ctx);
const spendHandler = registerSpendRoute(ctx);
const sybilHandler = registerSybilRoute(ctx);
const leaderboardHandler = registerLeaderboardRoute(ctx);
const discoveryHandler = registerDiscoveryRoute(ctx);
const buyHandler = registerBuyRoute(ctx);
const questHandler = registerQuestRoute(ctx);
const quizHandler = registerQuizRoute(ctx);
const reputationInlineHandler = registerReputationInlineRoute(ctx);
const reputationHandler = registerReputationRoute(ctx);
const tournamentHandler = registerTournamentRoute(ctx);
const userDataHandler = registerUserDataRoute(ctx);
const utilityHandler = registerUtilityRoute(ctx);
const vaultHandler = registerVaultRoute(ctx);
const walletHandler = registerWalletRoute(ctx);
const adminHandler = registerAdminRoute(ctx);

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

function validateProductionEnv() {
  const warnings = [];
  const errors = [];

  if (!process.env.ADMIN_KEY || process.env.ADMIN_KEY.length < 32) {
    warnings.push('ADMIN_KEY is missing or too short (< 32 chars). Use: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  if (!process.env.TREASURY_ADDRESS) {
    errors.push('TREASURY_ADDRESS is required for buy operations');
  }
  if (!process.env.CORE_COLLECTION) {
    warnings.push('CORE_COLLECTION not set — identity holder perks will be disabled');
  }
  warnings.forEach(w => console.warn(`[STARTUP WARNING] ${w}`));
  if (errors.length > 0) {
    errors.forEach(e => console.error(`[STARTUP ERROR] ${e}`));
    // Don't crash — just warn. Let the operator decide.
  }
}

validateProductionEnv();

// Load data from Firestore (fallback JSON), then start server
initOrchestrator.initialize(ctx).then(() => {
  server.listen(PORT, HOST, () => {
    const providers = [];
    if (ALCHEMY_RPC_URL) providers.push('alchemy');
    if (HELIUS_KEYS.length) providers.push(`helius(${HELIUS_KEYS.length} keys)`);
    else if (HELIUS_RPC_BASE) providers.push('helius(no-key)');
    if (FALLBACK_RPC_URL) providers.push('solana-public');
    console.log(`[helius-proxy] listening on ${HOST}:${PORT} | RPC chain: ${providers.join(' → ') || 'none'} (gzip, keep-alive 65s)`);
    startSchedulers(ctx);
    initOrchestrator.startBackgroundBackfills(ctx);
  });
}).catch(err => {
  console.error('[init] Failed to load data:', err);
  process.exit(1);
});

const shutdown = (signal) => {
  console.log(`[shutdown] ${signal} received, flushing...`);
  const timer = setTimeout(() => { console.error('[shutdown] force exit after 10s'); process.exit(1); }, 10000);
  server.close(async () => {
    try {
      if (typeof persistWalletDatabase === 'function') await persistWalletDatabase();
      if (typeof savePrismDataDebounced === 'function') savePrismDataDebounced();
      if (typeof saveCoinBalancesDebounced === 'function') saveCoinBalancesDebounced();
      if (appDb?.close) appDb.close();
      console.log('[shutdown] flushed, exiting cleanly');
    } catch (err) { console.error('[shutdown] flush error:', err); }
    clearTimeout(timer);
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [k, v] of identityOwnershipCache) {
    if (v.ts < cutoff) identityOwnershipCache.delete(k);
  }
}, 600_000);

setInterval(() => {
  if (walletIpLog.size > 10000) {
    const entries = [...walletIpLog.keys()];
    entries.slice(0, entries.length - 5000).forEach((k) => walletIpLog.delete(k));
  }
}, 3600_000);

process.on('uncaughtException', (err, origin) => {
  console.error(`[fatal:${origin}]`, err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal:unhandledRejection]', reason);
});
