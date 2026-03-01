import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { URL } from 'node:url';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createNoopSigner,
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  publicKey,
} from '@metaplex-foundation/umi';
import { create, fetchCollection, fetchAsset, mplCore, burnV1, updateV1 } from '@metaplex-foundation/mpl-core';
import { toWeb3JsInstruction, toWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import jwt from 'jsonwebtoken';
import { calculateIdentity } from './services/scoring.js';
import { drawBackCard, drawFrontCard, drawFrontCardImage } from './services/cardGenerator.js';

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

const getCachedSolPriceUsd = async () => {
  const now = Date.now();
  if (solPriceCache.value && now - solPriceCache.timestamp < SOL_PRICE_TTL_MS) {
    return solPriceCache.value;
  }
  const price = await fetchSolPriceUsd();
  if (price) {
    solPriceCache = { value: price, timestamp: now };
  }
  return price;
};

const getCachedSkrPriceUsd = async () => {
  const now = Date.now();
  if (skrPriceCache.value && now - skrPriceCache.timestamp < SKR_PRICE_TTL_MS) {
    return skrPriceCache.value;
  }
  const price = await fetchSkrPriceUsd();
  if (price) {
    skrPriceCache = { value: price, timestamp: now };
  }
  return price;
};

loadEnvFile(process.env.ENV_PATH ?? path.join(process.cwd(), '.env'));

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
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
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
const MINT_PRICE_SOL_RAW = Number(process.env.MINT_PRICE_SOL ?? '0.01');
const MINT_PRICE_SOL = Number.isFinite(MINT_PRICE_SOL_RAW) && MINT_PRICE_SOL_RAW > 0
  ? MINT_PRICE_SOL_RAW
  : 0.01;
const SKR_MINT = (process.env.SKR_MINT ?? 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3').trim();
const SKR_DISCOUNT = Number(process.env.SKR_DISCOUNT ?? '0.5');
const SKR_DISCOUNT_RATE = Number.isFinite(SKR_DISCOUNT) && SKR_DISCOUNT > 0 ? SKR_DISCOUNT : 0.5;
const LAMPORTS_PER_SOL = 1_000_000_000;
const MAX_SIGNATURE_PAGES = Number(process.env.MAX_SIGNATURE_PAGES ?? '10');
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
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// ── JWT Auth ──────────────────────────────────────────────────────────────────
const JWT_SECRET = (process.env.JWT_SECRET ?? crypto.randomBytes(32).toString('hex')).trim();
const JWT_TTL = '1h';
const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 min nonce window
const authChallenges = new Map(); // nonce → { address, expiresAt }

// Clean up expired challenges every minute
setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of authChallenges) {
    if (entry.expiresAt < now) authChallenges.delete(nonce);
  }
}, 60_000);

/**
 * Verify a Solana wallet signature (Ed25519) using node:crypto.
 * Returns true if signature of `message` is valid for `address`.
 */
function verifyWalletSignature(address, message, signatureBase64) {
  try {
    const pubkeyBytes = Buffer.from(new PublicKey(address).toBytes());
    const msgBytes = Buffer.from(message, 'utf8');
    const sigBytes = Buffer.from(signatureBase64, 'base64');
    return crypto.verify(null, msgBytes, { key: pubkeyBytes, dsaEncoding: 'ieee-p1363', format: 'der', type: 'spki' }, sigBytes);
  } catch {
    // fallback: use raw Ed25519 key verify
    try {
      const pubkeyBytes = Buffer.from(new PublicKey(address).toBytes());
      const keyObject = crypto.createPublicKey({ key: pubkeyBytes, format: 'raw', type: 'public' });
      const msgBytes = Buffer.from(message, 'utf8');
      const sigBytes = Buffer.from(signatureBase64, 'base64');
      return crypto.verify(null, msgBytes, keyObject, sigBytes);
    } catch {
      return false;
    }
  }
}

/**
 * Middleware: verify Authorization: Bearer <jwt> header.
 * Returns { ok: true, address } or sends 401 and returns { ok: false }.
 */
function requireJwt(req, res) {
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    respondJson(res, 401, { error: 'Missing auth token. Call /api/auth/challenge then /api/auth/token first.' });
    return { ok: false };
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { ok: true, address: payload.address };
  } catch {
    respondJson(res, 401, { error: 'Invalid or expired auth token' });
    return { ok: false };
  }
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
  'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w',
  'SMBH3wF6pdt967Y62N7S5mB4tJSTH3KAsdJ82D3L2nd',
  'SMB3ndYpSXY97H8MhpxYit3pD8TzYJ5v6ndP4D2L2nd',
  '6v9UWGmEB5Hthst9KqEAgXW6XF6R6yv4t7Yf3YfD3A7t',
  'BUjZjAS2vbbb9p56fAun4sFmPAt8W6JURG5L3AkVvHP9',
  '4S8L8L1M5E1X5vM1Y1M1X5vM1Y1M1X5vM1Y1M1X5vM1Y',
  '7TENEKwBnkpENuefriGPg4hBDR4WJ2Gyfw5AhdkMA4rq',
  '9uBX3ASuCtv6S5o56yq7F9n7U6o9o7o9o7o9o7o9o7o9',
  'GGSGP689TGoX6WJ9mSj2S8mH78S8S8S8S8S8S8S8S8S8S',
  'CDgbhX61QFADQAeeYKP5BQ7nnzDyMkkR3NEhYF2ETn1k',
  'Port7uDYB3P8meS5m7Yv62222222222222222222222',
  'CocMmG5v88888888888888888888888888888888888',
  'y00t9S9mD9mD9mD9mD9mD9mD9mD9mD9mD9mD9mD9mD',
  'abc777777777777777777777777777777777777777',
  'LILY5555555555555555555555555555555555555',
  'PRM77777777777777777777777777777777777777',
  'Jelly8888888888888888888888888888888888888',
  '4Q2C5S930M9c9e96b',
  'TFF77777777777777777777777777777777777777',
  'DTP77777777777777777777777777777777777777',
];

const PENDING_MINT_TTL_MS = 10 * 60 * 1000;
const pendingMintSigners = new Map();
const gameSessionProofs = new Map();

const prunePendingMints = () => {
  const now = Date.now();
  for (const [key, entry] of pendingMintSigners.entries()) {
    if (!entry || now - entry.createdAt > PENDING_MINT_TTL_MS) {
      pendingMintSigners.delete(key);
    }
  }
};

const storePendingMint = ({ requestId, owner, assetId, assetSecret, transaction }) => {
  prunePendingMints();
  pendingMintSigners.set(requestId, {
    owner,
    assetId,
    assetSecret,
    transaction,
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
      reason:
        typeof raw?.verification?.reason === 'string' && raw.verification.reason.trim()
          ? raw.verification.reason.trim()
          : 'Unknown',
    },
    createdAt,
    lastVerifiedAt,
    createdAtMs,
  };
};

const persistGameSessionProofs = () => {
  try {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sessions: Array.from(gameSessionProofs.values()),
    };
    fs.writeFileSync(GAME_SESSION_STORE_FILE, JSON.stringify(payload, null, 2));
  } catch (error) {
    console.warn('[game-session] Failed to persist proofs', error);
  }
};

const loadGameSessionProofs = () => {
  try {
    if (!fs.existsSync(GAME_SESSION_STORE_FILE)) return;
    const raw = fs.readFileSync(GAME_SESSION_STORE_FILE, 'utf8');
    if (!raw.trim()) return;

    const parsed = JSON.parse(raw);
    const sessions = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.sessions) ? parsed.sessions : []);

    let loaded = 0;
    for (const item of sessions) {
      const normalized = normalizeStoredGameSessionEntry(item);
      if (!normalized) continue;
      gameSessionProofs.set(normalized.id, normalized);
      loaded += 1;
    }

    if (loaded > 0) {
      console.log(`[game-session] Loaded ${loaded} persisted proof(s)`);
    }
  } catch (error) {
    console.warn('[game-session] Failed to load persisted proofs', error);
  }
};

const pruneGameSessionProofs = () => {
  const cutoff = Date.now() - GAME_SESSION_TTL_MS;
  let removed = 0;
  for (const [id, entry] of gameSessionProofs.entries()) {
    if (!entry || Number(entry.createdAtMs ?? 0) < cutoff) {
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
loadGameSessionProofs();
pruneGameSessionProofs();

// ── Server-side Leaderboard persistence ──
const leaderboardEntries = [];

const loadLeaderboard = () => {
  try {
    if (!fs.existsSync(LEADERBOARD_STORE_FILE)) return;
    const raw = fs.readFileSync(LEADERBOARD_STORE_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : (Array.isArray(parsed) ? parsed : []);
    leaderboardEntries.length = 0;
    for (const e of entries) {
      if (e && typeof e.address === 'string' && typeof e.score === 'number') {
        leaderboardEntries.push(e);
      }
    }
    leaderboardEntries.sort((a, b) => b.score - a.score);
    if (leaderboardEntries.length > LEADERBOARD_MAX_ENTRIES) leaderboardEntries.length = LEADERBOARD_MAX_ENTRIES;
    console.log(`[leaderboard] Loaded ${leaderboardEntries.length} entries`);
  } catch (err) {
    console.warn('[leaderboard] Failed to load', err);
  }
};

const persistLeaderboard = () => {
  try {
    fs.writeFileSync(LEADERBOARD_STORE_FILE, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries: leaderboardEntries }, null, 2));
  } catch (err) {
    console.warn('[leaderboard] Failed to persist', err);
  }
};

const submitLeaderboardEntry = (entry) => {
  const { address, score, playedAt, txSignature } = entry;
  if (!address || typeof score !== 'number' || score <= 0) return null;
  const existing = leaderboardEntries.findIndex((e) => e.address === address);
  if (existing !== -1) {
    if (score > leaderboardEntries[existing].score) {
      leaderboardEntries[existing] = { address, score, playedAt: playedAt || new Date().toISOString(), txSignature: txSignature || leaderboardEntries[existing].txSignature };
    } else if (txSignature && !leaderboardEntries[existing].txSignature) {
      leaderboardEntries[existing].txSignature = txSignature;
    } else {
      return leaderboardEntries[existing];
    }
  } else {
    leaderboardEntries.push({ address, score, playedAt: playedAt || new Date().toISOString(), txSignature: txSignature || undefined });
  }
  leaderboardEntries.sort((a, b) => b.score - a.score);
  if (leaderboardEntries.length > LEADERBOARD_MAX_ENTRIES) leaderboardEntries.length = LEADERBOARD_MAX_ENTRIES;
  persistLeaderboard();
  return leaderboardEntries.find((e) => e.address === address) || null;
};

loadLeaderboard();

// ── Server-side Coin balance persistence ──
const COINS_STORE_FILE = process.env.COINS_STORE_FILE
  ? path.resolve(process.env.COINS_STORE_FILE)
  : path.join(METADATA_DIR, 'coin-balances.json');

const coinBalances = new Map();

const loadCoinBalances = () => {
  try {
    if (!fs.existsSync(COINS_STORE_FILE)) return;
    const raw = fs.readFileSync(COINS_STORE_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    const entries = parsed?.balances || parsed || {};
    for (const [addr, bal] of Object.entries(entries)) {
      if (typeof bal === 'number') coinBalances.set(addr, bal);
    }
    console.log(`[coins] Loaded ${coinBalances.size} balances`);
  } catch (err) {
    console.warn('[coins] Failed to load', err);
  }
};

const persistCoinBalances = () => {
  try {
    const obj = {};
    for (const [k, v] of coinBalances) obj[k] = v;
    fs.writeFileSync(COINS_STORE_FILE, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), balances: obj }, null, 2));
  } catch (err) {
    console.warn('[coins] Failed to persist', err);
  }
};

const getCoinBalance = (address) => coinBalances.get(address) || 0;

const setCoinBalance = (address, coins) => {
  coinBalances.set(address, coins);
  persistCoinBalances();
};

loadCoinBalances();

// ── Server-side Score History (per wallet, last 20 scores) ──
const SCORE_HISTORY_FILE = path.join(METADATA_DIR, 'score-history.json');
const scoreHistory = new Map(); // address -> { scores: [{ score, tier, date }], lastUpdated }
const SCORE_HISTORY_MAX = 20;

const loadScoreHistory = () => {
  try {
    if (!fs.existsSync(SCORE_HISTORY_FILE)) return;
    const raw = fs.readFileSync(SCORE_HISTORY_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    const data = parsed?.data || {};
    for (const [addr, entry] of Object.entries(data)) {
      if (Array.isArray(entry.scores)) {
        scoreHistory.set(addr, { scores: entry.scores.slice(0, SCORE_HISTORY_MAX), lastUpdated: entry.lastUpdated || null });
      }
    }
    console.log(`[score-history] Loaded history for ${scoreHistory.size} wallets`);
  } catch (err) {
    console.warn('[score-history] Failed to load', err);
  }
};

const persistScoreHistory = () => {
  try {
    const obj = {};
    for (const [k, v] of scoreHistory) obj[k] = v;
    fs.writeFileSync(SCORE_HISTORY_FILE, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data: obj }, null, 2));
  } catch (err) {
    console.warn('[score-history] Failed to persist', err);
  }
};

const getScoreHistory = (address) => {
  return scoreHistory.get(address) || { scores: [], lastUpdated: null };
};

const addScoreEntry = (address, score, tier) => {
  const entry = scoreHistory.get(address) || { scores: [], lastUpdated: null };
  const now = new Date().toISOString();
  entry.scores.unshift({ score, tier, date: now });
  if (entry.scores.length > SCORE_HISTORY_MAX) entry.scores.length = SCORE_HISTORY_MAX;
  entry.lastUpdated = now;
  scoreHistory.set(address, entry);
  persistScoreHistory();
  return entry;
};

loadScoreHistory();

// ── Server-side Achievement tracking (unlocked + claimed per wallet) ──
const ACHIEVEMENTS_STORE_FILE = path.join(METADATA_DIR, 'achievement-claims.json');
// address -> { unlocked: Set<string>, claimed: Set<string> }
const achievementData = new Map();

const loadAchievementData = () => {
  try {
    if (!fs.existsSync(ACHIEVEMENTS_STORE_FILE)) return;
    const raw = fs.readFileSync(ACHIEVEMENTS_STORE_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    // Support both old format (claims only) and new format
    const data = parsed?.data || {};
    const legacyClaims = parsed?.claims || {};
    // Load new format
    for (const [addr, entry] of Object.entries(data)) {
      achievementData.set(addr, {
        unlocked: new Set(Array.isArray(entry.unlocked) ? entry.unlocked : []),
        claimed: new Set(Array.isArray(entry.claimed) ? entry.claimed : []),
      });
    }
    // Migrate old claims-only format
    for (const [addr, ids] of Object.entries(legacyClaims)) {
      if (!achievementData.has(addr) && Array.isArray(ids)) {
        achievementData.set(addr, { unlocked: new Set(ids), claimed: new Set(ids) });
      }
    }
    console.log(`[achievements] Loaded data for ${achievementData.size} wallets`);
  } catch (err) {
    console.warn('[achievements] Failed to load', err);
  }
};

const persistAchievementData = () => {
  try {
    const obj = {};
    for (const [k, v] of achievementData) {
      obj[k] = { unlocked: [...v.unlocked], claimed: [...v.claimed] };
    }
    fs.writeFileSync(ACHIEVEMENTS_STORE_FILE, JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), data: obj }, null, 2));
  } catch (err) {
    console.warn('[achievements] Failed to persist', err);
  }
};

const getWalletAchievements = (address) => {
  return achievementData.get(address) || { unlocked: new Set(), claimed: new Set() };
};

const markAchievementsUnlocked = (address, achievementIds) => {
  let entry = achievementData.get(address);
  if (!entry) { entry = { unlocked: new Set(), claimed: new Set() }; achievementData.set(address, entry); }
  let changed = false;
  for (const id of achievementIds) {
    if (!entry.unlocked.has(id)) { entry.unlocked.add(id); changed = true; }
  }
  if (changed) persistAchievementData();
  return changed;
};

const claimAchievement = (address, achievementId) => {
  let entry = achievementData.get(address);
  if (!entry) { entry = { unlocked: new Set(), claimed: new Set() }; achievementData.set(address, entry); }
  if (entry.claimed.has(achievementId)) return false;
  entry.unlocked.add(achievementId); // ensure unlocked too
  entry.claimed.add(achievementId);
  persistAchievementData();
  return true;
};

loadAchievementData();

// ── Server-side Free Revive tracking (3 per day per game mode, requires minted ID) ──
const REVIVES_STORE_FILE = path.join(METADATA_DIR, 'revive-usage.json');
const FREE_REVIVES_PER_DAY = 3;
// address -> { orbit: { date: 'YYYY-MM-DD', used: number }, destroyer: { ... } }
const reviveData = new Map();

const loadReviveData = () => {
  try {
    if (!fs.existsSync(REVIVES_STORE_FILE)) return;
    const raw = fs.readFileSync(REVIVES_STORE_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    const data = parsed?.data || {};
    for (const [addr, entry] of Object.entries(data)) {
      reviveData.set(addr, entry);
    }
    console.log(`[revives] Loaded data for ${reviveData.size} wallets`);
  } catch (err) {
    console.warn('[revives] Failed to load', err);
  }
};

const persistReviveData = () => {
  try {
    const obj = {};
    for (const [k, v] of reviveData) obj[k] = v;
    fs.writeFileSync(REVIVES_STORE_FILE, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data: obj }, null, 2));
  } catch (err) {
    console.warn('[revives] Failed to persist', err);
  }
};

const getToday = () => new Date().toISOString().slice(0, 10);

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

loadReviveData();

const getHeliusKeyIndex = (seed = '') => {
  if (!HELIUS_KEYS.length) return -1;
  if (!seed) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }
  return Math.abs(hash) % HELIUS_KEYS.length;
};

const pickHeliusKey = (seed) => {
  const index = getHeliusKeyIndex(seed);
  if (index < 0) return null;
  return HELIUS_KEYS[index];
};

const buildRpcUrl = (apiKey) => {
  if (!HELIUS_RPC_BASE) return null;
  const targetUrl = new URL(HELIUS_RPC_BASE);
  if (apiKey) {
    targetUrl.searchParams.set('api-key', apiKey);
  }
  return targetUrl.toString();
};

const getRpcUrl = (seed) => {
  if (!HELIUS_KEYS.length) {
    return buildRpcUrl(null);
  }
  const apiKey = pickHeliusKey(seed);
  if (!apiKey) return null;
  return buildRpcUrl(apiKey);
};

const getRpcUrls = (seed) => {
  if (!HELIUS_KEYS.length) {
    const fallbackUrl = buildRpcUrl(null);
    return fallbackUrl ? [fallbackUrl] : [];
  }
  const startIndex = Math.max(0, getHeliusKeyIndex(seed));
  return HELIUS_KEYS.map((_, index) => {
    const key = HELIUS_KEYS[(startIndex + index) % HELIUS_KEYS.length];
    return buildRpcUrl(key);
  }).filter(Boolean);
};

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
    return origin;
  }
  const allowList = configured.split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowList.length) {
    return origin;
  }
  if (allowList.includes('*')) {
    return origin;
  }
  if (allowList.includes(origin)) {
    return origin;
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return origin;
  }
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
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-wallet-address,solana-client,x-action-version,x-blockchain-ids');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Action-Version,X-Blockchain-Ids');
  res.setHeader('X-Action-Version', '2.1.3');
  res.setHeader('X-Blockchain-Ids', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
};

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
  });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

const getBaseUrl = (req) => {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
  const proto = forwardedProto || 'http';
  const host = forwardedHost || req.headers.host;
  return host ? `${proto}://${host}` : '';
};

const respondJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  const acceptEncoding = String(res.req?.headers?.['accept-encoding'] ?? '');
  if (body.length > 256 && acceptEncoding.includes('gzip')) {
    zlib.gzip(Buffer.from(body), (err, compressed) => {
      if (err || !compressed) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': compressed.length,
      });
      res.end(compressed);
    });
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
};

const safeParseJson = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
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
    verification.seedMatchesSlot = Boolean(blockhash) && blockhash === seed;
  } catch {
    verification.slotFound = false;
    verification.seedMatchesSlot = false;
    verification.slotBlockhash = null;
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
  const gameMode = typeof payload.gameMode === 'string' ? payload.gameMode.trim() : 'orbit';

  if (!Number.isFinite(score) || score < 0) {
    throw new Error('score must be a non-negative number');
  }
  if (!seed || seed.length < 16) {
    throw new Error('seed is required');
  }
  if (!Number.isInteger(slot) || slot <= 0) {
    throw new Error('slot must be a positive integer');
  }
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs < startedAtMs) {
    throw new Error('startedAtMs/endedAtMs are invalid');
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
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 1_000_000) return numeric / LAMPORTS_PER_SOL;
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
  const discountedUsd = baseUsd * (1 - SKR_DISCOUNT_RATE);
  const rawAmount = discountedUsd / skrUsd;
  const amount = Math.max(1, Math.ceil(rawAmount));
  return {
    amount,
    rawAmount,
    solUsd,
    skrUsd,
    baseUsd,
    discountedUsd,
  };
};

const getSkrQuote = async () => {
  const [solUsd, skrUsd] = await Promise.all([getCachedSolPriceUsd(), getCachedSkrPriceUsd()]);
  return computeSkrQuote(solUsd, skrUsd);
};

const formatActionAddress = (address) => {
  if (!address) return '';
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

const isFungibleAsset = (asset) => {
  const iface = (asset?.interface ?? '').toUpperCase();
  if (iface === 'FUNGIBLETOKEN' || iface === 'FUNGIBLEASSET') return true;
  const supply = asset?.token_info?.supply || 0;
  const decimals = asset?.token_info?.decimals ?? 0;
  return decimals > 0 || supply > 1;
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
      const pageSignatures = await connection.getSignaturesForAddress(pubkey, {
        limit: SIGNATURE_PAGE_LIMIT,
        ...(before ? { before } : {}),
      });
      if (!pageSignatures.length) break;
      signatures.push(...pageSignatures);
      before = pageSignatures[pageSignatures.length - 1]?.signature;
      if (!before || pageSignatures.length < SIGNATURE_PAGE_LIMIT) break;
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
  const txCount = signatures.length;
  const oldest = signatures[signatures.length - 1];
  const firstTxTime = oldest?.blockTime ?? null;

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
      creators.some((creator) => creator.address === TOKEN_ADDRESSES.SEEKER_MINT_AUTHORITY) ||
      (name.includes('seeker') && (name.includes('genesis') || name.includes('citizen'))) ||
      isSeekerNamed;

    if (isSeekerGenesis) hasSeeker = true;

    const isChapter2Preorder =
      mint === TOKEN_ADDRESSES.CHAPTER2_PREORDER ||
      tokenGroup === PREORDER_COLLECTION ||
      metadataPointer === PREORDER_COLLECTION ||
      name.includes('chapter 2') ||
      name.includes('seeker preorder') ||
      collectionName.includes('chapter 2') ||
      collectionName.includes('seeker preorder') ||
      grouping.some((group) => group.group_value === PREORDER_COLLECTION);

    if (isChapter2Preorder) hasPreorder = true;

    const iface = (asset.interface || '').toUpperCase();
    const tokenInfo = asset.token_info || {};
    const decimals = tokenInfo.decimals ?? (isFungibleAsset(asset) ? 9 : 0);

    const isExplicitNFT =
      iface.includes('NFT') ||
      iface.includes('PROGRAMMABLE') ||
      iface === 'CUSTOM' ||
      asset.compression?.compressed === true;
    const isLikelyNFT = decimals === 0 && (metadata.name || content.links?.image || grouping.length > 0);
    const isKnownFungible =
      iface === 'FUNGIBLETOKEN' ||
      iface === 'FUNGIBLEASSET' ||
      ((tokenInfo.supply || 0) > 1 && decimals > 0);

    if (isExplicitNFT || (isLikelyNFT && !isKnownFungible)) {
      nftCount += 1;
      const collectionValue = collectionGroup?.group_value || '';
      if (BLUE_CHIP_COLLECTIONS.includes(collectionValue)) {
        isBlueChip = true;
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
  const isDeFiKing = (hasLstExposure || defiProtocolExposure) && (solBalance >= 0.1 || memeValueUSD >= 10);

  const walletAgeDays = firstTxTime
    ? Math.floor((Date.now() - firstTxTime * 1000) / (1000 * 60 * 60 * 24))
    : 0;
  const identity = calculateIdentity(txCount, firstTxTime, solBalance, uniqueTokenCount, nftCount, {
    hasSeeker,
    hasPreorder,
    isBlueChip,
    isDeFiKing,
    isMemeLord,
    uniqueTokenCount,
  });
  const stats = {
    score: identity.score,
    address: formatActionAddress(address),
    ageDays: walletAgeDays,
    txCount,
    solBalance,
    tokenCount: uniqueTokenCount,
    nftCount,
  };

  return {
    identity,
    stats,
    walletAgeDays,
    solBalance,
    txCount,
    tokenCount: uniqueTokenCount,
    nftCount,
  };
};

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/api/market/collection-stats' && req.method === 'GET') {
    const symbol = String(url.searchParams.get('symbol') ?? '').trim();
    const collectionId = String(url.searchParams.get('collectionId') ?? '').trim();
    const collName = String(url.searchParams.get('name') ?? '').trim();
    const mint = String(url.searchParams.get('mint') ?? '').trim();
    try {
      // 1. Try ME slug from mint, then collectionId as slug, then symbol/name derivation
      let meSlug = null;
      if (mint) {
        meSlug = await fetchMeSlugByMint(mint).catch(() => null);
      }

      // 2. Build candidate slugs
      const candidates = [];
      if (collectionId) candidates.push(collectionId);
      if (symbol) candidates.push(symbol, symbol.toLowerCase());
      if (collName) {
        candidates.push(collName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
        candidates.push(collName.toLowerCase().replace(/\s+/g, '_'));
      }

      // 3. Fetch ME stats — try meSlug first, then candidates
      let magicStats = null;
      if (meSlug) {
        magicStats = await fetchMagicEdenCollectionStats(meSlug).catch(() => null);
      }
      if (!magicStats?.floorSol) {
        for (const slug of candidates) {
          if (!slug || slug === meSlug) continue;
          const test = await fetchMagicEdenCollectionStats(slug).catch(() => null);
          if (test?.floorSol) {
            magicStats = test;
            meSlug = slug;
            break;
          }
          if (test?.status === 'listed' && !magicStats) {
            magicStats = test;
            meSlug = slug;
          }
        }
      }
      if (!meSlug && candidates.length > 0) meSlug = candidates[0];

      // 4. Tensor fallback
      let tensorStats = null;
      if (!magicStats?.floorSol && collectionId) {
        tensorStats = await fetchTensorCollectionStats(collectionId).catch(() => null);
      }

      // 5. Individual NFT last price as ultimate fallback
      let tokenLastPrice = null;
      if (!magicStats?.floorSol && !tensorStats?.floorSol && mint) {
        tokenLastPrice = await fetchMeTokenLastPrice(mint).catch(() => null);
      }

      const tensorUrl = collectionId ? `https://www.tensor.trade/trade/${collectionId}` : null;
      const meUrl = meSlug ? `https://magiceden.io/marketplace/${meSlug}` : (mint ? `https://magiceden.io/item-details/${mint}` : null);
      const floorSol = magicStats?.floorSol ?? tensorStats?.floorSol ?? tokenLastPrice ?? null;
      const bestSource = magicStats?.floorSol ? 'magic_eden' : (tensorStats?.floorSol ? 'tensor' : (tokenLastPrice ? 'magic_eden' : null));
      const status = magicStats?.status === 'listed' ? 'listed' : (tensorStats?.status === 'listed' ? 'listed' : (magicStats?.status ?? tensorStats?.status ?? 'unknown'));
      respondJson(res, 200, {
        status,
        floorSol,
        source: bestSource,
        tensorUrl,
        meUrl,
        meSlug: meSlug ?? null,
      });
      return;
    } catch (error) {
      respondJson(res, 500, {
        status: 'unknown',
        floorSol: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  // ── Auth: issue challenge nonce ──
  if (pathname === '/api/auth/challenge' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const parsed = safeParseJson(body);
      const address = typeof parsed?.address === 'string' ? parsed.address.trim() : '';
      if (!address) { respondJson(res, 400, { error: 'address required' }); return; }
      try { new PublicKey(address); } catch { respondJson(res, 400, { error: 'Invalid address' }); return; }
      const nonce = crypto.randomBytes(16).toString('hex');
      authChallenges.set(nonce, { address, expiresAt: Date.now() + AUTH_CHALLENGE_TTL_MS });
      const message = `Identity Prism auth\nAddress: ${address}\nNonce: ${nonce}`;
      respondJson(res, 200, { nonce, message });
    } catch (e) {
      respondJson(res, 500, { error: 'Challenge failed' });
    }
    return;
  }

  // ── Auth: verify signature, issue JWT ──
  if (pathname === '/api/auth/token' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const parsed = safeParseJson(body);
      const { address, nonce, signature } = parsed ?? {};
      if (!address || !nonce || !signature) {
        respondJson(res, 400, { error: 'address, nonce, and signature required' }); return;
      }
      const challenge = authChallenges.get(nonce);
      if (!challenge) { respondJson(res, 401, { error: 'Invalid or expired nonce' }); return; }
      if (challenge.address !== address) { respondJson(res, 401, { error: 'Address mismatch' }); return; }
      if (challenge.expiresAt < Date.now()) {
        authChallenges.delete(nonce);
        respondJson(res, 401, { error: 'Challenge expired' }); return;
      }
      // Verify Ed25519 signature using node:crypto
      const message = `Identity Prism auth\nAddress: ${address}\nNonce: ${nonce}`;
      let verified = false;
      try {
        const pubkeyBytes = Buffer.from(new PublicKey(address).toBytes());
        const keyObject = crypto.createPublicKey({ key: pubkeyBytes, format: 'raw', type: 'public', namedCurve: 'ed25519' });
        const msgBytes = Buffer.from(message, 'utf8');
        const sigBytes = Buffer.from(signature, 'base64');
        verified = crypto.verify(null, msgBytes, keyObject, sigBytes);
      } catch (verifyErr) {
        console.warn('[auth] signature verify error', verifyErr?.message);
        verified = false;
      }
      if (!verified) { respondJson(res, 401, { error: 'Invalid signature' }); return; }
      authChallenges.delete(nonce); // one-time use
      const token = jwt.sign({ address }, JWT_SECRET, { expiresIn: JWT_TTL });
      console.info('[auth] JWT issued', { address: address.slice(0, 8) });
      respondJson(res, 200, { token, expiresIn: JWT_TTL });
    } catch (e) {
      respondJson(res, 500, { error: 'Auth failed' });
    }
    return;
  }

  // ── Reputation API ──
  if (pathname === '/api/reputation' && req.method === 'GET') {
    const address = String(url.searchParams.get('address') ?? '').trim();
    if (!address) {
      respondJson(res, 400, { error: 'address query parameter is required' });
      return;
    }
    try {
      new PublicKey(address);
    } catch {
      respondJson(res, 400, { error: 'Invalid Solana address' });
      return;
    }
    try {
      const snapshot = await fetchIdentitySnapshot(address);
      const { identity, stats, walletAgeDays, solBalance, txCount, tokenCount, nftCount } = snapshot;
      respondJson(res, 200, {
        address,
        score: identity.score,
        tier: identity.tier,
        badges: identity.badges,
        stats: {
          walletAgeDays,
          solBalance: Math.round(solBalance * 1000) / 1000,
          txCount,
          tokenCount,
          nftCount,
        },
      });
      return;
    } catch (error) {
      console.error('[reputation] failed for', address, error);
      respondJson(res, 500, {
        error: 'Failed to compute reputation',
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  // ── Reputation API — batch (up to 5 addresses) ──
  if (pathname === '/api/reputation/batch' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON' });
        return;
      }
      const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];
      if (!addresses.length || addresses.length > 5) {
        respondJson(res, 400, { error: 'Provide 1-5 addresses in { "addresses": [...] }' });
        return;
      }
      const results = [];
      for (const addr of addresses) {
        const trimmed = String(addr).trim();
        try {
          new PublicKey(trimmed);
          const snapshot = await fetchIdentitySnapshot(trimmed);
          const { identity, walletAgeDays, solBalance, txCount, tokenCount, nftCount } = snapshot;
          results.push({
            address: trimmed,
            score: identity.score,
            tier: identity.tier,
            badges: identity.badges,
            stats: { walletAgeDays, solBalance: Math.round(solBalance * 1000) / 1000, txCount, tokenCount, nftCount },
          });
        } catch (error) {
          results.push({ address: trimmed, error: error instanceof Error ? error.message : String(error) });
        }
      }
      respondJson(res, 200, { results });
      return;
    } catch (error) {
      respondJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  // ── Reputation API — compare two wallets ──
  if (pathname === '/api/reputation/compare' && req.method === 'GET') {
    const a = String(url.searchParams.get('a') ?? '').trim();
    const b = String(url.searchParams.get('b') ?? '').trim();
    if (!a || !b) {
      respondJson(res, 400, { error: 'Both ?a= and ?b= address parameters are required' });
      return;
    }
    try {
      new PublicKey(a);
      new PublicKey(b);
    } catch {
      respondJson(res, 400, { error: 'Invalid Solana address' });
      return;
    }
    try {
      const [snapA, snapB] = await Promise.all([
        fetchIdentitySnapshot(a),
        fetchIdentitySnapshot(b),
      ]);
      const format = (snap, addr) => ({
        address: addr,
        score: snap.identity.score,
        tier: snap.identity.tier,
        badges: snap.identity.badges,
        stats: {
          walletAgeDays: snap.walletAgeDays,
          solBalance: Math.round(snap.solBalance * 1000) / 1000,
          txCount: snap.txCount,
          tokenCount: snap.tokenCount,
          nftCount: snap.nftCount,
        },
      });
      const resultA = format(snapA, a);
      const resultB = format(snapB, b);
      const diff = resultA.score - resultB.score;
      respondJson(res, 200, {
        wallets: [resultA, resultB],
        scoreDiff: diff,
        winner: diff > 0 ? a : diff < 0 ? b : 'tie',
      });
      return;
    } catch (error) {
      console.error('[reputation/compare] failed', error);
      respondJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  // ── Reputation Attestation (Blink-compatible Solana Action) ──
  if (pathname === '/api/actions/attest' || pathname === '/api/reputation/attest') {
    const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    const baseUrl = getBaseUrl(req) || PUBLIC_BASE_URL;

    if (req.method === 'GET' || req.method === 'OPTIONS') {
      const address = String(url.searchParams.get('address') ?? '').trim();
      if (!address) {
        respondJson(res, 200, {
          type: 'action',
          icon: `${baseUrl}/assets/identity-prism.png`,
          title: 'Attest Your On-Chain Reputation',
          description: 'Record your Identity Prism reputation score permanently on the Solana blockchain. This creates a verifiable, immutable attestation signed by both you and our authority.',
          label: 'Attest Reputation',
          links: {
            actions: [
              {
                label: 'Attest My Wallet',
                href: `${baseUrl}/api/actions/attest?address={address}`,
                parameters: [
                  { name: 'address', label: 'Enter your Solana wallet address', required: true },
                ],
              },
            ],
          },
        });
        return;
      }
      // Address provided — show score preview
      try {
        new PublicKey(address);
        const snapshot = await fetchIdentitySnapshot(address);
        const { identity } = snapshot;
        respondJson(res, 200, {
          type: 'action',
          icon: `${baseUrl}/api/actions/render?address=${address}&side=front`,
          title: `Attest Score: ${identity.score}/1400 — ${identity.tier.replace('_', ' ').toUpperCase()}`,
          description: `Badges: ${identity.badges.join(', ') || 'none'}. Click to record this reputation permanently on the Solana blockchain.`,
          label: `Attest ${identity.score} pts`,
          links: {
            actions: [
              { label: `Attest Score ${identity.score}`, href: `${baseUrl}/api/actions/attest?address=${address}` },
            ],
          },
        });
        return;
      } catch (error) {
        respondJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid address' });
        return;
      }
    }

    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        let payload = {};
        try { payload = body ? JSON.parse(body) : {}; } catch { respondJson(res, 400, { error: 'Invalid JSON' }); return; }

        const account = String(payload.account ?? '').trim();
        const addressParam = String(url.searchParams.get('address') ?? '').trim();
        const address = addressParam || account;

        if (!account) { respondJson(res, 400, { error: 'account is required' }); return; }
        if (!address) { respondJson(res, 400, { error: 'address parameter is required' }); return; }

        let payerKey, walletKey;
        try { payerKey = new PublicKey(account); } catch { respondJson(res, 400, { error: 'Invalid account' }); return; }
        try { walletKey = new PublicKey(address); } catch { respondJson(res, 400, { error: 'Invalid address' }); return; }

        // Fetch reputation
        const snapshot = await fetchIdentitySnapshot(address);
        const { identity, walletAgeDays, solBalance, txCount, tokenCount, nftCount } = snapshot;

        // Build attestation memo
        const attestation = JSON.stringify({
          protocol: 'identity-prism-v1',
          wallet: address,
          score: identity.score,
          tier: identity.tier,
          badges: identity.badges,
          stats: { walletAgeDays, solBalance: Math.round(solBalance * 1000) / 1000, txCount, tokenCount, nftCount },
          timestamp: Math.floor(Date.now() / 1000),
          authority: TREASURY_ADDRESS,
        });

        // Load treasury for co-signing
        const treasurySecret = parseSecretKey(TREASURY_SECRET) ?? loadSecretKeyFromFile(TREASURY_SECRET_PATH);
        if (!treasurySecret) {
          respondJson(res, 500, { error: 'Attestation authority not configured' });
          return;
        }
        const treasuryKeypair = Keypair.fromSecretKey(treasurySecret);

        // Build Memo instruction — signed by both payer and treasury
        const memoInstruction = new TransactionInstruction({
          keys: [
            { pubkey: payerKey, isSigner: true, isWritable: true },
            { pubkey: treasuryKeypair.publicKey, isSigner: true, isWritable: false },
          ],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(attestation, 'utf-8'),
        });

        const apiKey = pickHeliusKey(address);
        const rpcUrl = buildRpcUrl(apiKey);
        const connection = new Connection(rpcUrl, 'confirmed');
        const latestBlockhash = await connection.getLatestBlockhash('confirmed');

        const transaction = new Transaction().add(memoInstruction);
        transaction.feePayer = payerKey;
        transaction.recentBlockhash = latestBlockhash.blockhash;

        // Treasury co-signs
        transaction.partialSign(treasuryKeypair);

        const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');

        respondJson(res, 200, {
          transaction: serialized,
          message: `Reputation attestation: Score ${identity.score}/1400, Tier ${identity.tier.replace('_', ' ').toUpperCase()}. This will be permanently recorded on Solana.`,
        });
        return;
      } catch (error) {
        console.error('[attest] failed', error);
        respondJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
  }

  if (pathname === '/api/market/sol-price' && req.method === 'GET') {
    try {
      const price = await getCachedSolPriceUsd();
      respondJson(res, 200, { usd: price });
      return;
    } catch (error) {
      respondJson(res, 500, { usd: null, error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (pathname === '/api/market/skr-price' && req.method === 'GET') {
    try {
      const price = await getCachedSkrPriceUsd();
      respondJson(res, 200, { usd: price });
      return;
    } catch (error) {
      respondJson(res, 500, { usd: null, error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (pathname === '/api/market/jupiter-prices' && req.method === 'GET') {
    const ids = url.searchParams.get('ids');
    if (!ids) {
      respondJson(res, 400, { error: 'ids parameter required' });
      return;
    }
    try {
      const jupResp = await fetch(`https://api.jup.ag/price/v2?ids=${encodeURIComponent(ids)}`);
      if (!jupResp.ok) {
        respondJson(res, jupResp.status, { error: `Jupiter API returned ${jupResp.status}` });
        return;
      }
      const jupData = await jupResp.json();
      respondJson(res, 200, jupData);
      return;
    } catch (error) {
      console.warn('[market] Jupiter price proxy failed', error);
      respondJson(res, 502, { error: 'Jupiter price fetch failed' });
      return;
    }
  }

  if (pathname === '/api/market/mint-quote' && req.method === 'GET') {
    try {
      const quote = await getSkrQuote();
      if (!quote) {
        respondJson(res, 503, { error: 'SKR price unavailable' });
        return;
      }
      respondJson(res, 200, {
        solUsd: quote.solUsd,
        skrUsd: quote.skrUsd,
        baseSol: MINT_PRICE_SOL,
        discount: SKR_DISCOUNT_RATE,
        skrAmount: quote.amount,
        skrAmountRaw: quote.rawAmount,
      });
      return;
    } catch (error) {
      respondJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  // ── MagicBlock game-session proof API ──
  if (pathname === '/api/game/session' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const parsed = safeParseJson(raw);
      if (!parsed) {
        respondJson(res, 400, { error: 'Invalid JSON' });
        return;
      }

      let payload;
      try {
        payload = normalizeGameSessionPayload(parsed);
      } catch (error) {
        respondJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }

      pruneGameSessionProofs();

      const canonical = JSON.stringify({
        walletAddress: payload.walletAddress,
        score: payload.score,
        survivalTime: payload.survivalTime,
        seed: payload.seed,
        slot: payload.slot,
        startedAtMs: payload.startedAtMs,
        endedAtMs: payload.endedAtMs,
        txSignature: payload.txSignature,
        gameMode: payload.gameMode,
      });
      const hash = crypto.createHash('sha256').update(canonical).digest('hex');
      const id = createGameSessionProofId(payload.slot, hash);
      const durationMs = Math.max(0, payload.endedAtMs - payload.startedAtMs);
      // For orbit: score = survival seconds, check delta against duration
      // For destroyer: score = points (unrelated to time), skip score-time check
      const isDestroyerMode = payload.gameMode === 'destroyer';
      const expectedScore = Math.floor(durationMs / 1000);
      const scoreDelta = isDestroyerMode ? 0 : Math.abs(expectedScore - payload.score);
      const verification = await verifyMagicBlockSeedSlot(payload.seed, payload.slot);
      const verified = verification.seedMatchesSlot && scoreDelta <= 5;
      const nowIso = new Date().toISOString();
      const baseUrl = getBaseUrl(req);
      const proofUrl = baseUrl ? `${baseUrl}/api/game/session/${encodeURIComponent(id)}` : null;

      const reason = verified
        ? 'Seed matches MagicBlock slot and score delta is within tolerance'
        : `${verification.reason}; score delta=${scoreDelta}s`;

      const entry = {
        id,
        hash,
        walletAddress: payload.walletAddress,
        score: payload.score,
        survivalTime: payload.survivalTime,
        seed: payload.seed,
        slot: payload.slot,
        startedAtMs: payload.startedAtMs,
        endedAtMs: payload.endedAtMs,
        durationMs,
        scoreDelta,
        verified,
        gameMode: payload.gameMode,
        proofUrl,
        verification: {
          ...verification,
          reason,
        },
        createdAt: nowIso,
        lastVerifiedAt: nowIso,
        createdAtMs: Date.now(),
      };

      gameSessionProofs.set(id, entry);
      persistGameSessionProofs();
      respondJson(res, 200, { session: toPublicGameSessionProof(entry) });
      return;
    } catch (error) {
      respondJson(res, 500, {
        error: 'Failed to register game session',
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  if (pathname.startsWith('/api/game/session/') && req.method === 'GET') {
    pruneGameSessionProofs();
    const rawId = pathname.slice('/api/game/session/'.length);
    let sessionId = '';
    try {
      sessionId = decodeURIComponent(rawId).trim();
    } catch {
      sessionId = rawId.trim();
    }
    if (!sessionId) {
      respondJson(res, 400, { error: 'Session id is required' });
      return;
    }

    const existing = gameSessionProofs.get(sessionId);
    if (!existing) {
      respondJson(res, 404, { error: 'Session proof not found' });
      return;
    }

    try {
      const verification = await verifyMagicBlockSeedSlot(existing.seed, existing.slot);
      const verified = verification.seedMatchesSlot && existing.scoreDelta <= 5;
      const reason = verified
        ? 'Seed matches MagicBlock slot and score delta is within tolerance'
        : `${verification.reason}; score delta=${existing.scoreDelta}s`;

      const refreshed = {
        ...existing,
        verified,
        verification: {
          ...verification,
          reason,
        },
        lastVerifiedAt: new Date().toISOString(),
      };
      gameSessionProofs.set(sessionId, refreshed);
      persistGameSessionProofs();
      respondJson(res, 200, { session: toPublicGameSessionProof(refreshed) });
      return;
    } catch (error) {
      respondJson(res, 200, {
        session: toPublicGameSessionProof(existing),
        verificationWarning: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  // ── Leaderboard API ──
  if (pathname === '/api/game/leaderboard' && req.method === 'GET') {
    respondJson(res, 200, { entries: leaderboardEntries.slice(0, 50) });
    return;
  }

  if (pathname === '/api/game/leaderboard' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address, score, playedAt, txSignature } = parsed;
      if (!address || typeof address !== 'string' || typeof score !== 'number' || score <= 0) {
        respondJson(res, 400, { error: 'Invalid entry: address (string) and score (number > 0) required' });
        return;
      }
      const result = submitLeaderboardEntry({ address, score, playedAt, txSignature });
      respondJson(res, 200, { entry: result, leaderboard: leaderboardEntries.slice(0, 50) });
    } catch (error) {
      respondJson(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // ── Coins API (per-wallet coin balance) ──
  if (pathname === '/api/game/coins' && req.method === 'GET') {
    const addr = url.searchParams.get('address') || '';
    if (!addr) {
      respondJson(res, 400, { error: 'address query param required' });
      return;
    }
    const coins = getCoinBalance(addr);
    respondJson(res, 200, { address: addr, coins });
    return;
  }

  if (pathname === '/api/game/coins' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: addr, coins, delta } = parsed;
      if (!addr || typeof addr !== 'string') {
        respondJson(res, 400, { error: 'address (string) required' });
        return;
      }
      const current = getCoinBalance(addr);
      // Accept the higher of client-reported total or server total
      const newBalance = Math.max(current, typeof coins === 'number' ? coins : current + (typeof delta === 'number' ? delta : 0));
      setCoinBalance(addr, newBalance);
      respondJson(res, 200, { address: addr, coins: newBalance });
    } catch {
      respondJson(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // ── Achievements API (per-wallet unlocked + claimed) ──
  if (pathname === '/api/game/achievements' && req.method === 'GET') {
    const addr = url.searchParams.get('address') || '';
    if (!addr) {
      respondJson(res, 400, { error: 'address query param required' });
      return;
    }
    const entry = getWalletAchievements(addr);
    respondJson(res, 200, { address: addr, unlocked: [...entry.unlocked], claimed: [...entry.claimed] });
    return;
  }

  // POST: claim a single achievement
  if (pathname === '/api/game/achievements' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: addr, achievementId, reward } = parsed;
      if (!addr || typeof addr !== 'string' || !achievementId || typeof achievementId !== 'string') {
        respondJson(res, 400, { error: 'address (string) and achievementId (string) required' });
        return;
      }
      const success = claimAchievement(addr, achievementId);
      if (!success) {
        respondJson(res, 409, { error: 'Achievement already claimed', achievementId });
        return;
      }
      if (typeof reward === 'number' && reward > 0) {
        const current = getCoinBalance(addr);
        setCoinBalance(addr, current + reward);
      }
      const entry = getWalletAchievements(addr);
      const coins = getCoinBalance(addr);
      respondJson(res, 200, { address: addr, achievementId, unlocked: [...entry.unlocked], claimed: [...entry.claimed], coins });
    } catch {
      respondJson(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // PUT: sync unlocked achievements (batch, idempotent)
  if (pathname === '/api/game/achievements' && req.method === 'PUT') {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: addr, unlocked: ids } = parsed;
      if (!addr || typeof addr !== 'string' || !Array.isArray(ids)) {
        respondJson(res, 400, { error: 'address (string) and unlocked (array) required' });
        return;
      }
      markAchievementsUnlocked(addr, ids);
      const entry = getWalletAchievements(addr);
      respondJson(res, 200, { address: addr, unlocked: [...entry.unlocked], claimed: [...entry.claimed] });
    } catch {
      respondJson(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // ── Free Revive API (3 per day per game mode, server-authoritative) ──
  if (pathname === '/api/game/revives' && req.method === 'GET') {
    const addr = url.searchParams.get('address') || '';
    const mode = url.searchParams.get('mode') || 'orbit';
    if (!addr) {
      respondJson(res, 400, { error: 'address query param required' });
      return;
    }
    if (mode !== 'orbit' && mode !== 'destroyer') {
      respondJson(res, 400, { error: 'mode must be orbit or destroyer' });
      return;
    }
    const left = getRevivesLeft(addr, mode);
    respondJson(res, 200, { address: addr, mode, left, max: FREE_REVIVES_PER_DAY });
    return;
  }

  if (pathname === '/api/game/revives' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: addr, mode } = parsed;
      if (!addr || typeof addr !== 'string') {
        respondJson(res, 400, { error: 'address (string) required' });
        return;
      }
      if (mode !== 'orbit' && mode !== 'destroyer') {
        respondJson(res, 400, { error: 'mode must be orbit or destroyer' });
        return;
      }
      const success = useRevive(addr, mode);
      if (!success) {
        const left = getRevivesLeft(addr, mode);
        respondJson(res, 429, { error: 'No free revives left today', left, max: FREE_REVIVES_PER_DAY });
        return;
      }
      const left = getRevivesLeft(addr, mode);
      respondJson(res, 200, { address: addr, mode, success: true, left, max: FREE_REVIVES_PER_DAY });
    } catch {
      respondJson(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // ── Score History API ──
  if (pathname === '/api/score-history' && req.method === 'GET') {
    const addr = url.searchParams.get('address') || '';
    if (!addr) {
      respondJson(res, 400, { error: 'address query param required' });
      return;
    }
    const history = getScoreHistory(addr);
    respondJson(res, 200, { address: addr, scores: history.scores, lastUpdated: history.lastUpdated });
    return;
  }

  if (pathname === '/api/score-history' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: addr, score, tier } = parsed;
      if (!addr || typeof addr !== 'string' || typeof score !== 'number') {
        respondJson(res, 400, { error: 'address (string) and score (number) required' });
        return;
      }
      const entry = addScoreEntry(addr, score, tier || 'mercury');
      respondJson(res, 200, { address: addr, scores: entry.scores, lastUpdated: entry.lastUpdated });
    } catch {
      respondJson(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // ── Tapestry proxy — avoids CORS issues with direct browser calls ──
  if (pathname.startsWith('/api/tapestry/') && (req.method === 'POST' || req.method === 'GET')) {
    const tapestryKey = process.env.TAPESTRY_API_KEY || process.env.VITE_TAPESTRY_API_KEY || '';
    if (!tapestryKey) {
      respondJson(res, 503, { error: 'Tapestry API key not configured on server' });
      return;
    }
    const tapestryPath = pathname.replace('/api/tapestry', '');
    const tapestryUrl = `https://api.usetapestry.dev/api/v1${tapestryPath}?apiKey=${tapestryKey}`;
    try {
      const body = req.method === 'POST' ? await readBody(req) : null;
      const upstream = await fetch(tapestryUrl, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body } : {}),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(text);
    } catch (error) {
      respondJson(res, 502, { error: 'Tapestry upstream error', detail: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (pathname === '/api/actions/render') {
    const viewParam = String(url.searchParams.get('view') ?? 'front').trim();
    const view = viewParam === 'back' ? 'back' : 'front';
    const tabParam = String(url.searchParams.get('tab') ?? '').trim();
    const tab = tabParam === 'badges' ? 'badges' : 'stats';
    const empty = String(url.searchParams.get('empty') ?? '') === '1';
    const tierParam = String(url.searchParams.get('tier') ?? 'mercury').trim();
    const addressParam = String(url.searchParams.get('address') ?? '').trim();

    try {
      if (view === 'back') {
        let stats = null;
        let badges = [];
        if (!empty && addressParam) {
          const snapshot = await fetchIdentitySnapshot(addressParam);
          stats = snapshot.stats;
          badges = snapshot.identity.badges;
        }
        const image = await drawBackCard(stats, badges, { tab });
        sendImageDataUrl(res, image);
        return;
      }

      let tier = tierParam;
      let badges = [];
      if (addressParam && !empty) {
        const snapshot = await fetchIdentitySnapshot(addressParam);
        tier = snapshot.identity.tier;
        badges = snapshot.identity.badges;
      }
      const image = await drawFrontCardImage(tier, badges);
      sendImageDataUrl(res, image);
      return;
    } catch (error) {
      console.error('[actions/render] failed', error);
      respondJson(res, 500, {
        error: 'Unable to render card image',
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  if (pathname === '/api/actions/share') {
    const baseUrl = getBaseUrl(req);
    if (!baseUrl) {
      respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
      return;
    }

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const buildLandingAction = () => {
      const icon = `${baseUrl}/phav.png`;
      return {
        type: 'action',
        title: 'Identity Prism',
        icon,
        description: 'Scan a Solana address to reveal your Identity Prism card.',
        label: 'Scan',
        links: {
          actions: [
            {
              type: 'post',
              label: 'Scan',
              href: `${baseUrl}/api/actions/share?addressInput={addressInput}`,
              parameters: [
                {
                  name: 'addressInput',
                  label: 'Solana Address',
                  required: true,
                },
              ],
            },
          ],
        },
      };
    };

    const respondLanding = () => {
      respondJson(res, 200, buildLandingAction());
    };

    const buildAddressAction = async (address, viewParam, tabParam) => {
      const view = viewParam === 'back' ? 'back' : 'front';
      const tab = tabParam === 'badges' ? 'badges' : 'stats';
      const { identity, stats } = await fetchIdentitySnapshot(address);

      const encodedAddress = encodeURIComponent(address);
      const cacheKey = Date.now().toString(36);
      const icon = `${baseUrl}/api/actions/render?view=${view}&address=${encodedAddress}${view === 'back' ? `&tab=${tab}` : ''}&v=${cacheKey}`;
      const description = `Tier: ${identity.tier.toUpperCase()} • Score ${identity.score} • ${stats.txCount} tx • ${stats.ageDays} days`;
      const flipView = view === 'back' ? 'front' : 'back';
      const actionList = [
        {
          type: 'post',
          label: view === 'back' ? 'Flip to Front' : 'Flip Card',
          href: `${baseUrl}/api/actions/share?address=${encodedAddress}&view=${flipView}`,
        },
      ];

      if (view === 'back') {
        actionList.push(
          {
            type: 'post',
            label: 'Stats Tab',
            href: `${baseUrl}/api/actions/share?address=${encodedAddress}&view=back&tab=stats`,
          },
          {
            type: 'post',
            label: 'Badges Tab',
            href: `${baseUrl}/api/actions/share?address=${encodedAddress}&view=back&tab=badges`,
          },
        );
      }

      actionList.push(
        {
          type: 'transaction',
          label: 'Mint',
          href: `${baseUrl}/api/actions/mint-blink?address=${encodedAddress}`,
        },
        {
          type: 'post',
          label: 'View App',
          href: `${baseUrl}/api/actions/view-app?address=${encodedAddress}`,
        },
      );

      return {
        type: 'action',
        title: 'Identity Prism',
        icon,
        description,
        label: view === 'back' ? 'Back View' : 'Front View',
        links: {
          actions: actionList,
        },
      };
    };

    const respondForAddress = async (address, viewParam, tabParam) => {
      try {
        new PublicKey(address);
      } catch {
        respondJson(res, 400, { error: 'Invalid address' });
        return;
      }

      const action = await buildAddressAction(address, viewParam, tabParam);
      respondJson(res, 200, action);
    };

    const queryAddress = String(
      url.searchParams.get('address') ?? url.searchParams.get('addressInput') ?? ''
    ).trim();
    const queryView = String(url.searchParams.get('view') ?? 'front').trim();
    const queryTab = String(url.searchParams.get('tab') ?? '').trim();

    const findAddressCandidate = (payload) => {
      if (!payload || typeof payload !== 'object') return '';
      const queue = [payload];
      const visited = new Set();
      while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== 'object') continue;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const value of Object.values(current)) {
          if (typeof value === 'string') {
            const candidate = value.trim();
            if (candidate.length >= 32 && candidate.length <= 44) {
              try {
                new PublicKey(candidate);
                return candidate;
              } catch {
                // ignore invalid candidates
              }
            }
          } else if (value && typeof value === 'object') {
            queue.push(value);
          }
        }
      }
      return '';
    };

    if (req.method === 'GET') {
      if (!queryAddress) {
        respondLanding();
        return;
      }
      await respondForAddress(queryAddress, queryView, queryTab);
      return;
    }

    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const body = await readBody(req);
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (error) {
        respondJson(res, 400, { error: 'Invalid JSON payload' });
        return;
      }

      const payloadAddress = String(
        payload?.address ??
          payload?.addressInput ??
          payload?.inputs?.address ??
          payload?.inputs?.addressInput ??
          payload?.data?.address ??
          payload?.data?.addressInput ??
          payload?.input?.address ??
          payload?.input?.addressInput ??
          payload?.params?.address ??
          payload?.params?.addressInput ??
          payload?.fields?.address ??
          payload?.fields?.addressInput ??
          ''
      ).trim();
      const address = queryAddress || payloadAddress || findAddressCandidate(payload);
      if (!address) {
        respondJson(res, 200, {
          type: 'post',
          links: {
            next: {
              type: 'inline',
              action: buildLandingAction(),
            },
          },
        });
        return;
      }

      try {
        new PublicKey(address);
      } catch {
        respondJson(res, 400, { error: 'Invalid address' });
        return;
      }

      const viewParam = String(url.searchParams.get('view') ?? payload?.view ?? 'front').trim();
      const tabParam = String(url.searchParams.get('tab') ?? payload?.tab ?? '').trim();
      const action = await buildAddressAction(address, viewParam, tabParam);
      respondJson(res, 200, {
        type: 'post',
        links: {
          next: {
            type: 'inline',
            action,
          },
        },
      });
    } catch (error) {
      console.error('[actions/share] failed', error);
      respondJson(res, 500, {
        error: 'Unable to build action payload',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === '/api/actions/view-app') {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const baseUrl = getBaseUrl(req);
      if (!baseUrl) {
        respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
        return;
      }
      const body = await readBody(req);
      let payload = {};
      if (body) {
        try {
          payload = JSON.parse(body);
        } catch {
          const params = new URLSearchParams(body);
          if (params.size > 0) {
            payload = Object.fromEntries(params.entries());
          }
        }
      }

      const queryAddress = String(
        url.searchParams.get('address') ?? url.searchParams.get('addressInput') ?? ''
      ).trim();
      const payloadAddress = String(
        payload?.address ??
          payload?.addressInput ??
          payload?.inputs?.address ??
          payload?.inputs?.addressInput ??
          payload?.data?.address ??
          payload?.data?.addressInput ??
          payload?.input?.address ??
          payload?.input?.addressInput ??
          payload?.params?.address ??
          payload?.params?.addressInput ??
          payload?.fields?.address ??
          payload?.fields?.addressInput ??
          payload?.account ??
          ''
      ).trim();
      const address = queryAddress || payloadAddress;
      const encodedAddress = address ? encodeURIComponent(address) : '';
      const externalLink = address ? `${baseUrl}?address=${encodedAddress}` : `${baseUrl}`;
      respondJson(res, 200, { type: 'external-link', externalLink });
    } catch (error) {
      console.error('[actions/view-app] failed', error);
      respondJson(res, 500, {
        error: 'Unable to build view app link',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === '/api/actions/mint-blink') {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const baseUrl = getBaseUrl(req);
      if (!baseUrl) {
        respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
        return;
      }
      const body = await readBody(req);
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON payload' });
        return;
      }

      const owner = String(url.searchParams.get('address') ?? payload?.address ?? '').trim();
      const payer = String(payload?.account ?? '').trim();
      if (!owner || !payer) {
        respondJson(res, 400, { error: 'Address and account are required' });
        return;
      }

      if (!COLLECTION_AUTHORITY_SECRET) {
        respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured' });
        return;
      }
      if (!TREASURY_ADDRESS) {
        respondJson(res, 500, { error: 'TREASURY_ADDRESS is not configured' });
        return;
      }
      if (!CORE_COLLECTION) {
        respondJson(res, 500, { error: 'CORE_COLLECTION is not configured' });
        return;
      }

      const collectionSecret = parseSecretKey(COLLECTION_AUTHORITY_SECRET);
      if (!collectionSecret) {
        respondJson(res, 500, { error: 'Invalid collection authority secret' });
        return;
      }

      const ownerKey = parsePublicKey(owner, 'owner');
      const payerKey = parsePublicKey(payer, 'account');
      const collectionMintKey = parsePublicKey(CORE_COLLECTION, 'collectionMint');
      if (!ownerKey || !payerKey || !collectionMintKey) {
        respondJson(res, 400, { error: 'Invalid owner/account/collection mint' });
        return;
      }

      const { identity, stats, walletAgeDays } = await fetchIdentitySnapshot(ownerKey.toBase58());
      const imageUrl = drawFrontCard(identity.tier);
      const metadata = {
        name: `Identity Prism ${ownerKey.toBase58().slice(0, 4)}`,
        symbol: 'PRISM',
        description: 'Identity Prism — a living Solana identity card built from your on-chain footprint.',
        image: imageUrl,
        external_url: `${baseUrl}/?address=${ownerKey.toBase58()}`,
        attributes: [
          { trait_type: 'Tier', value: identity.tier },
          { trait_type: 'Score', value: identity.score.toString() },
          { trait_type: 'Wallet Age (days)', value: walletAgeDays },
          { trait_type: 'Transactions', value: stats.txCount },
        ],
        properties: {
          files: [{ uri: imageUrl, type: 'image/jpeg' }],
          category: 'image',
        },
      };

      const metadataId = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const metadataFile = resolveMetadataFile(metadataId);
      if (!metadataFile) {
        respondJson(res, 500, { error: 'Failed to create metadata file' });
        return;
      }
      const metadataPath = path.join(METADATA_DIR, metadataFile);
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      const metadataUri = `${baseUrl}/metadata/${metadataFile}`;

      const rpcUrl = getRpcUrl(payerKey.toBase58());
      if (!rpcUrl) {
        respondJson(res, 500, { error: 'Helius API key required' });
        return;
      }

      const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
      const treasuryKey = new PublicKey(TREASURY_ADDRESS);
      const expectedLamports = Math.round(MINT_PRICE_SOL * LAMPORTS_PER_SOL);
      const umi = createUmi(rpcUrl).use(mplCore());
      const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
      const collectionAuthoritySigner = umi.eddsa.createKeypairFromSecretKey(collectionSecret);
      umi.use(keypairIdentity(collectionAuthoritySigner));

      const collection = await fetchCollection(umi, publicKey(collectionMintKey.toBase58()));
      const assetSigner = generateSigner(umi);
      const assetKeypair = toWeb3JsKeypair(assetSigner);
      const ownerSigner = createNoopSigner(publicKey(ownerKey.toBase58()));
      const payerSigner = createNoopSigner(publicKey(payerKey.toBase58()));
      const builder = create(umi, {
        asset: assetSigner,
        collection,
        name: metadata.name,
        uri: metadataUri,
        owner: ownerSigner,
        payer: payerSigner,
        authority: collectionAuthoritySigner,
      }).setFeePayer(payerSigner);

      const transferIx = expectedLamports > 0
        ? SystemProgram.transfer({
            fromPubkey: payerKey,
            toPubkey: treasuryKey,
            lamports: expectedLamports,
          })
        : null;
      const latestBlockhash = await connection.getLatestBlockhash('finalized');
      const instructions = [
        ...(transferIx ? [transferIx] : []),
        ...builder.getInstructions().map((instruction) => {
          const web3Ix = toWeb3JsInstruction(instruction);
          web3Ix.keys = web3Ix.keys.map((key) => {
            const keyStr = key.pubkey.toBase58();
            if (keyStr === collectionAuthorityKeypair.publicKey.toBase58()) {
              return { ...key, isSigner: true };
            }
            if (keyStr === assetKeypair.publicKey.toBase58()) {
              return { ...key, isSigner: true };
            }
            return key;
          });
          return web3Ix;
        }),
      ];

      const transaction = new Transaction().add(...instructions);
      transaction.feePayer = payerKey;
      transaction.recentBlockhash = latestBlockhash.blockhash;
      const compiledMessage = transaction.compileMessage();
      const requiredSigners = compiledMessage.accountKeys
        .slice(0, compiledMessage.header.numRequiredSignatures)
        .map((key) => key.toBase58());
      const signerPool = [];
      if (requiredSigners.includes(assetKeypair.publicKey.toBase58())) {
        signerPool.push(assetKeypair);
      }
      if (requiredSigners.includes(collectionAuthorityKeypair.publicKey.toBase58())) {
        signerPool.push(collectionAuthorityKeypair);
      }
      if (signerPool.length) {
        transaction.partialSign(...signerPool);
      }

      const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');
      respondJson(res, 200, {
        transaction: serialized,
        message: 'Sign to mint your Identity Prism.',
        blockhash: latestBlockhash.blockhash,
      });
    } catch (error) {
      console.error('[actions/mint] failed', error);
      respondJson(res, 500, {
        error: 'Action mint failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === '/mint-cnft') {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    // JWT auth guard (optional — skip if no Authorization header to stay backward-compatible during rollout)
    const jwtAuth = req.headers['authorization'] ? requireJwt(req, res) : { ok: true, address: null };
    if (!jwtAuth.ok) return;

    try {
      const fallbackRequestId = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const body = await readBody(req);
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (error) {
        console.error('[mint-cnft] invalid json', {
          requestId: fallbackRequestId,
          error: error instanceof Error ? error.message : String(error),
          bodyPreview: body.slice(0, 200),
        });
        respondJson(res, 400, { error: 'Invalid JSON payload', requestId: fallbackRequestId });
        return;
      }

      const payloadRequestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : '';
      const requestId = payloadRequestId || fallbackRequestId;
      if (!COLLECTION_AUTHORITY_SECRET) {
        respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured', requestId });
        return;
      }
      if (!TREASURY_ADDRESS) {
        respondJson(res, 500, { error: 'TREASURY_ADDRESS is not configured', requestId });
        return;
      }

      const collectionSecret = parseSecretKey(COLLECTION_AUTHORITY_SECRET);
      if (!collectionSecret) {
        respondJson(res, 500, { error: 'Invalid collection authority secret', requestId });
        return;
      }

      const owner = payload?.owner ?? '';
      const metadataUri = payload?.metadataUri ?? '';
      const name = payload?.name ?? '';
      const symbol = payload?.symbol ?? '';
      const sellerFeeBasisPoints = Number(payload?.sellerFeeBasisPoints ?? 0);
      const collectionMintRaw = payload?.collectionMint ?? CORE_COLLECTION ?? '';
      const adminMode = Boolean(payload?.admin);
      const remintMode = Boolean(payload?.remint);
      const burnSignature = typeof payload?.burnSignature === 'string' ? payload.burnSignature.trim() : '';
      const burnAssetId = typeof payload?.burnAssetId === 'string' ? payload.burnAssetId.trim() : '';
      const paymentTokenRaw = typeof payload?.paymentToken === 'string' ? payload.paymentToken.trim() : '';
      const paymentToken = paymentTokenRaw.toUpperCase() === 'SKR' ? 'SKR' : 'SOL';
      const signedTransaction = typeof payload?.signedTransaction === 'string' ? payload.signedTransaction.trim() : '';
      if (signedTransaction && !payloadRequestId) {
        respondJson(res, 400, { error: 'requestId is required to finalize mint', requestId });
        return;
      }
      const isFinalize = Boolean(payloadRequestId && signedTransaction);
      if (isFinalize) {
        const pending = consumePendingMint(payloadRequestId);
        if (!pending) {
          respondJson(res, 400, { error: 'Mint finalize request expired or missing', requestId: payloadRequestId });
          return;
        }
        if (owner && pending.owner && owner !== pending.owner) {
          respondJson(res, 400, { error: 'Owner mismatch for finalize request', requestId: payloadRequestId });
          return;
        }
        const ownerAddress = owner || pending.owner;
        const ownerKey = parsePublicKey(ownerAddress, 'owner');
        if (!ownerKey) {
          respondJson(res, 400, { error: 'Invalid owner for finalize request', requestId: payloadRequestId });
          return;
        }
        const rpcUrl = getRpcUrl(ownerKey.toBase58());
        if (!rpcUrl) {
          respondJson(res, 500, { error: 'Helius API key required', requestId: payloadRequestId });
          return;
        }
        const connection = new Connection(rpcUrl, { commitment: 'confirmed' });

        let transaction;
        try {
          transaction = Transaction.from(Buffer.from(signedTransaction, 'base64'));
        } catch (error) {
          respondJson(res, 400, { error: 'Invalid signed transaction payload', requestId: payloadRequestId });
          return;
        }

        const assetKeypair = Keypair.fromSecretKey(Uint8Array.from(pending.assetSecret));
        const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
        transaction.partialSign(assetKeypair, collectionAuthorityKeypair);

        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          preflightCommitment: 'confirmed',
        });
        await connection.confirmTransaction(signature, 'confirmed');
        respondJson(res, 200, {
          signature,
          assetId: pending.assetId,
          requestId: payloadRequestId,
          finalized: true,
        });
        return;
      }

      const treasurySecret = adminMode
        ? parseSecretKey(TREASURY_SECRET) ?? loadSecretKeyFromFile(TREASURY_SECRET_PATH)
        : null;
      if (adminMode && !treasurySecret) {
        respondJson(res, 500, {
          error: 'Treasury secret not configured',
          requestId,
          hint: `Set TREASURY_SECRET or place key at ${TREASURY_SECRET_PATH}`,
        });
        return;
      }

      console.info('[mint-cnft] request', {
        requestId,
        owner,
        collectionMint: collectionMintRaw,
        metadataUri,
        name,
        symbol,
        sellerFeeBasisPoints,
      });

      if (!owner || !metadataUri || !name || !collectionMintRaw) {
        respondJson(res, 400, { error: 'Missing required mint payload', requestId });
        return;
      }

      const collectionMintKey = parsePublicKey(collectionMintRaw, 'collectionMint');
      const ownerKey = parsePublicKey(owner, 'owner');
      if (!collectionMintKey || !ownerKey) {
        respondJson(res, 400, { error: 'Invalid public keys in mint request', requestId });
        return;
      }

      const rpcUrl = getRpcUrl(ownerKey.toBase58());
      if (!rpcUrl) {
        respondJson(res, 500, { error: 'Helius API key required', requestId });
        return;
      }

      const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
      const treasuryKey = new PublicKey(TREASURY_ADDRESS);
      const expectedLamports = Math.round(MINT_PRICE_SOL * LAMPORTS_PER_SOL);
      const umi = createUmi(rpcUrl).use(mplCore());
      const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
      const collectionAuthoritySigner = umi.eddsa.createKeypairFromSecretKey(collectionSecret);
      umi.use(keypairIdentity(collectionAuthoritySigner));
      const treasuryKeypair = adminMode && treasurySecret ? Keypair.fromSecretKey(treasurySecret) : null;

      const collection = await fetchCollection(umi, publicKey(collectionMintKey.toBase58()));
      const resolveUpdateAuthorityAddress = (value) => {
        if (!value) return null;
        if (typeof value === 'string') return value;
        const addressValue =
          typeof value.address === 'string'
            ? value.address
            : value.address?.toString?.();
        if (addressValue) return addressValue;
        const publicKeyValue =
          typeof value.publicKey === 'string'
            ? value.publicKey
            : value.publicKey?.toString?.();
        if (publicKeyValue) return publicKeyValue;
        return value.toString?.() ?? null;
      };
      const updateAuthorityAddress = resolveUpdateAuthorityAddress(collection?.updateAuthority);
      if (!updateAuthorityAddress) {
        console.warn('[mint-cnft] collection update authority unresolved', {
          requestId,
          collectionMint: collectionMintKey.toBase58(),
          collectionAddress: collection?.publicKey?.toString?.(),
        });
      } else {
        console.info('[mint-cnft] collection fetched', {
          address: collection.publicKey.toString(),
          updateAuthority: updateAuthorityAddress,
          configuredAuthority: collectionAuthorityKeypair.publicKey.toBase58(),
          match: updateAuthorityAddress === collectionAuthorityKeypair.publicKey.toBase58()
        });
      }

      const assetSigner = generateSigner(umi);
      const assetKeypair = toWeb3JsKeypair(assetSigner);
      const ownerSigner = createNoopSigner(publicKey(ownerKey.toBase58()));
      const payerSigner = adminMode && treasuryKeypair
        ? createSignerFromKeypair(umi, treasuryKeypair)
        : ownerSigner;
      const builder = create(umi, {
        asset: assetSigner,
        collection,
        name,
        uri: metadataUri,
        owner: ownerSigner,
        payer: payerSigner,
        authority: collectionAuthoritySigner,
      }).setFeePayer(payerSigner);

      const paymentInstructions = [];
      // Remint mode: skip payment (combined burn+mint flow uses burnAssetId; legacy flow uses burnSignature)
      if (remintMode && (burnSignature || burnAssetId)) {
        console.info('[mint-cnft] remint mode — skipping payment', { requestId, burnAssetId: burnAssetId ? burnAssetId.slice(0, 16) : undefined, burnSignature: burnSignature ? burnSignature.slice(0, 16) : undefined });
        // Optionally verify burn tx on-chain (best-effort, only for legacy burnSignature flow)
        if (burnSignature) {
          try {
            const burnStatus = await connection.getSignatureStatus(burnSignature);
            const conf = burnStatus?.value?.confirmationStatus;
            if (conf !== 'confirmed' && conf !== 'finalized') {
              console.warn('[mint-cnft] remint burn signature not yet confirmed', { requestId, burnSignature: burnSignature.slice(0, 16), status: conf });
            }
          } catch (e) {
            console.warn('[mint-cnft] remint burn verification failed (non-blocking)', e);
          }
        }
      } else if (!adminMode) {
        if (paymentToken === 'SKR') {
          const skrMintKey = parsePublicKey(SKR_MINT, 'SKR_MINT');
          if (!skrMintKey) {
            respondJson(res, 500, { error: 'SKR mint is not configured', requestId });
            return;
          }
          const quote = await getSkrQuote();
          if (!quote) {
            respondJson(res, 503, { error: 'SKR price unavailable', requestId });
            return;
          }
          const mintInfo = await getMint(connection, skrMintKey, undefined, TOKEN_PROGRAM_ID)
            .then((info) => ({ info, programId: TOKEN_PROGRAM_ID }))
            .catch(async () => {
              const info = await getMint(connection, skrMintKey, undefined, TOKEN_2022_PROGRAM_ID);
              return { info, programId: TOKEN_2022_PROGRAM_ID };
            });
          const decimals = mintInfo.info.decimals ?? 0;
          const tokenProgramId = mintInfo.programId;
          const amountBaseUnits = BigInt(quote.amount) * (10n ** BigInt(decimals));
          const ownerAta = await getAssociatedTokenAddress(
            skrMintKey,
            ownerKey,
            false,
            tokenProgramId
          );
          const treasuryAta = await getAssociatedTokenAddress(
            skrMintKey,
            treasuryKey,
            false,
            tokenProgramId
          );
          const ownerAtaInfo = await connection.getAccountInfo(ownerAta);
          if (!ownerAtaInfo) {
            respondJson(res, 400, { error: 'SKR token account missing', requestId });
            return;
          }
          const treasuryAtaInfo = await connection.getAccountInfo(treasuryAta);
          if (!treasuryAtaInfo) {
            paymentInstructions.push(
              createAssociatedTokenAccountInstruction(
                ownerKey,
                treasuryAta,
                treasuryKey,
                skrMintKey,
                tokenProgramId
              )
            );
          }
          paymentInstructions.push(
            createTransferCheckedInstruction(
              ownerAta,
              skrMintKey,
              treasuryAta,
              ownerKey,
              amountBaseUnits,
              decimals,
              [],
              tokenProgramId
            )
          );
        } else if (expectedLamports > 0) {
          paymentInstructions.push(
            SystemProgram.transfer({
              fromPubkey: ownerKey,
              toPubkey: treasuryKey,
              lamports: expectedLamports,
            })
          );
        }
      }
      // Build burn instructions if burnAssetId provided (combined burn+mint in one tx)
      // Validate burnAssetId is a valid Solana public key (32-44 chars base58); legacy cNFT IDs are shorter
      const burnInstructions = [];
      let burnAssetIsValid = false;
      if (remintMode && burnAssetId) {
        try {
          new PublicKey(burnAssetId); // throws if not a valid 32-byte base58 pubkey
          burnAssetIsValid = true;
        } catch {
          console.warn('[mint-cnft] burnAssetId is not a valid public key (legacy cNFT?) — skipping burn instructions', { requestId, burnAssetId: burnAssetId.slice(0, 16) });
        }
        if (burnAssetIsValid) {
          try {
            // Fetch the asset on-chain to verify it's a real Core asset owned by this wallet
            const assetAccount = await fetchAsset(umi, publicKey(burnAssetId)).catch(() => null);
            if (!assetAccount) {
              console.warn('[mint-cnft] burnAssetId not found on-chain or not a Core asset — skipping burn', { requestId, burnAssetId: burnAssetId.slice(0, 16) });
              burnAssetIsValid = false;
            } else if (assetAccount.owner?.toString() !== ownerKey.toBase58()) {
              console.warn('[mint-cnft] burn asset owner mismatch — skipping burn', { requestId, assetOwner: assetAccount.owner?.toString(), expectedOwner: ownerKey.toBase58() });
              burnAssetIsValid = false;
            } else {
              console.info('[mint-cnft] burn asset verified', { requestId, assetId: burnAssetId.slice(0, 16), owner: assetAccount.owner?.toString(), collection: assetAccount.updateAuthority?.address?.toString() });
            }
          } catch (fetchErr) {
            console.warn('[mint-cnft] failed to fetch burn asset — skipping burn', { requestId, error: fetchErr?.message });
            burnAssetIsValid = false;
          }
        }
        if (burnAssetIsValid) {
          try {
            const burnOwnerSigner = createNoopSigner(publicKey(ownerKey.toBase58()));
            const burnBuilder = burnV1(umi, {
              asset: publicKey(burnAssetId),
              collection: publicKey(collectionMintKey.toBase58()),
              authority: burnOwnerSigner,
            });
            for (const umiIx of burnBuilder.getInstructions()) {
              burnInstructions.push(toWeb3JsInstruction(umiIx));
            }
            console.info('[mint-cnft] burn instructions added to combined tx', { requestId, burnAssetId: burnAssetId.slice(0, 16) });
          } catch (burnErr) {
            console.error('[mint-cnft] failed to build burn instructions', burnErr);
            respondJson(res, 500, { error: 'Failed to build burn instructions', requestId });
            return;
          }
        }
      }

      const latestBlockhash = await connection.getLatestBlockhash('finalized');
      const instructions = [
        ...burnInstructions,
        ...paymentInstructions,
        ...builder.getInstructions().map((instruction) => {
          const web3Ix = toWeb3JsInstruction(instruction);
          // Ensure collection authority and asset are signers
          let foundCollectionAuth = false;
          let foundAsset = false;
          
          web3Ix.keys = web3Ix.keys.map((key) => {
            const keyStr = key.pubkey.toBase58();
            if (keyStr === collectionAuthorityKeypair.publicKey.toBase58()) {
              foundCollectionAuth = true;
              return { ...key, isSigner: true };
            }
            if (keyStr === assetKeypair.publicKey.toBase58()) {
              foundAsset = true;
              return { ...key, isSigner: true };
            }
            return key;
          });
          
          console.info(`[mint-cnft] ix processed`, {
             programId: web3Ix.programId.toBase58(),
             foundCollectionAuth,
             foundAsset,
             collectionAuth: collectionAuthorityKeypair.publicKey.toBase58(),
             asset: assetKeypair.publicKey.toBase58()
          });
          
          return web3Ix;
        }),
      ];
      
      // Log instruction keys for debugging
      instructions.forEach((ix, i) => {
        console.info(`[mint-cnft] instruction ${i} keys`, ix.keys.map(k => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable
        })));
      });

      const transaction = new Transaction().add(...instructions);
      transaction.feePayer = adminMode && treasuryKeypair ? treasuryKeypair.publicKey : ownerKey;
      transaction.recentBlockhash = latestBlockhash.blockhash;
      const compiledMessage = transaction.compileMessage();
      const requiredSigners = compiledMessage.accountKeys
        .slice(0, compiledMessage.header.numRequiredSignatures)
        .map((key) => key.toBase58());
      console.info('[mint-cnft] required signers', { requestId, requiredSigners });

      const signerPool = [];
      if (requiredSigners.includes(assetKeypair.publicKey.toBase58())) {
        signerPool.push(assetKeypair);
      }
      if (requiredSigners.includes(collectionAuthorityKeypair.publicKey.toBase58())) {
        signerPool.push(collectionAuthorityKeypair);
      }
      if (adminMode && treasuryKeypair && requiredSigners.includes(treasuryKeypair.publicKey.toBase58())) {
        signerPool.push(treasuryKeypair);
      }
      if (adminMode && signerPool.length) {
        transaction.partialSign(...signerPool);
      }

      const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');

      if (adminMode) {
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          preflightCommitment: 'confirmed',
        });
        await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          'confirmed'
        );
        respondJson(res, 200, {
          signature,
          assetId: assetSigner.publicKey,
          blockhash: latestBlockhash.blockhash,
          requestId,
          admin: true,
        });
        return;
      }

      storePendingMint({
        requestId,
        owner,
        assetId: assetSigner.publicKey,
        assetSecret: Array.from(assetKeypair.secretKey),
        transaction: serialized,
      });

      respondJson(res, 200, {
        transaction: serialized,
        assetId: assetSigner.publicKey,
        blockhash: latestBlockhash.blockhash,
        requestId,
        finalize: true,
      });
    } catch (error) {
      console.error('[mint-cnft] failed', error);
      respondJson(res, 500, {
        error: 'Core mint failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  // ── UPDATE CARD (in-place metadata update via updateV1) ──
  // User pays: service fee (to treasury) + network fee. Server signs with collection authority.
  const UPDATE_FEE_SOL = 0.0005;
  if (pathname === '/api/update-card') {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    // JWT auth guard (optional during rollout)
    const jwtAuth = req.headers['authorization'] ? requireJwt(req, res) : { ok: true, address: null };
    if (!jwtAuth.ok) return;

    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const ownerAddress = typeof payload?.ownerAddress === 'string' ? payload.ownerAddress.trim() : '';
      let assetId = typeof payload?.assetId === 'string' ? payload.assetId.trim() : '';
      const metadataUri = typeof payload?.metadataUri === 'string' ? payload.metadataUri.trim() : '';
      const newName = typeof payload?.name === 'string' ? payload.name.trim() : '';
      const signedTransaction = typeof payload?.signedTransaction === 'string' ? payload.signedTransaction.trim() : '';

      if (!ownerAddress || !assetId || !metadataUri || !newName) {
        respondJson(res, 400, { error: 'Missing required fields: ownerAddress, assetId, metadataUri, name' });
        return;
      }
      if (!COLLECTION_AUTHORITY_SECRET) {
        respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured' });
        return;
      }
      if (!CORE_COLLECTION) {
        respondJson(res, 500, { error: 'CORE_COLLECTION is not configured' });
        return;
      }

      const collectionSecret = parseSecretKey(COLLECTION_AUTHORITY_SECRET);
      if (!collectionSecret) {
        respondJson(res, 500, { error: 'Invalid collection authority secret' });
        return;
      }
      const ownerKey = parsePublicKey(ownerAddress, 'owner');
      const collectionMintKey = parsePublicKey(CORE_COLLECTION, 'collectionMint');
      if (!ownerKey || !collectionMintKey) {
        respondJson(res, 400, { error: 'Invalid public keys' });
        return;
      }

      const rpcUrl = getRpcUrl(ownerKey.toBase58());
      if (!rpcUrl) {
        respondJson(res, 500, { error: 'Helius API key required' });
        return;
      }
      const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
      const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
      const treasuryKey = new PublicKey(TREASURY_ADDRESS);

      // ── Phase 2: user signed → co-sign colAuth via raw Ed25519 bytes & submit ──
      // We avoid Transaction.partialSign() because compileMessage() may reorder
      // accounts, invalidating the wallet's owner signature.  Instead we inject
      // the colAuth signature directly into the wire-format buffer so both sigs
      // are over the identical message bytes.
      if (signedTransaction) {
        const txBuf = Buffer.from(signedTransaction, 'base64');

        // Parse for diagnostics only (no compileMessage / partialSign)
        let txParsed;
        try {
          txParsed = Transaction.from(txBuf);
        } catch {
          respondJson(res, 400, { error: 'Invalid signed transaction' });
          return;
        }

        const colAuthPubkeyStr = collectionAuthorityKeypair.publicKey.toBase58();
        const colAuthIndex = txParsed.signatures.findIndex(
          (s) => s.publicKey.toBase58() === colAuthPubkeyStr,
        );
        const signerKeys = txParsed.signatures.map((s, i) => ({
          index: i,
          pubkey: s.publicKey.toBase58(),
          signed: s.signature !== null,
        }));
        console.info('[update-card] phase2 signers', JSON.stringify(signerKeys));

        if (colAuthIndex === -1) {
          console.error('[update-card] colAuth not in signers', { colAuthPubkeyStr });
          respondJson(res, 500, { error: 'Collection authority not a required signer' });
          return;
        }

        // Parse compact-u16 signature count to locate message bytes
        let sigCount = 0;
        let byteOffset = 0;
        for (let shift = 0; ; shift += 7) {
          const byte = txBuf[byteOffset++];
          sigCount |= (byte & 0x7f) << shift;
          if ((byte & 0x80) === 0) break;
        }
        const messageBytes = txBuf.slice(byteOffset + sigCount * 64);

        // Ed25519 sign the exact message bytes the wallet signed
        const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
        const seed = Buffer.from(collectionAuthorityKeypair.secretKey.slice(0, 32));
        const privateKeyObj = crypto.createPrivateKey({
          key: Buffer.concat([pkcs8Prefix, seed]),
          format: 'der',
          type: 'pkcs8',
        });
        const colSig = crypto.sign(null, messageBytes, privateKeyObj);
        colSig.copy(txBuf, byteOffset + colAuthIndex * 64);

        try {
          const signature = await connection.sendRawTransaction(txBuf, {
            preflightCommitment: 'confirmed',
            skipPreflight: true,
          });
          await connection.confirmTransaction(signature, 'confirmed');
          console.info('[update-card] finalized', { ownerAddress: ownerAddress.slice(0, 8), assetId: assetId.slice(0, 16), signature: signature.slice(0, 16) });
          respondJson(res, 200, { signature, assetId, finalized: true });
        } catch (submitErr) {
          console.error('[update-card] submit failed', submitErr?.message ?? submitErr);
          respondJson(res, 500, { error: 'Transaction submission failed', detail: submitErr?.message ?? String(submitErr) });
        }
        return;
      }

      // ── Phase 1: build tx, partially sign with collection authority, return to client ──
      const umi = createUmi(rpcUrl).use(mplCore());
      const collectionAuthoritySigner = umi.eddsa.createKeypairFromSecretKey(collectionSecret);
      umi.use(keypairIdentity(collectionAuthoritySigner));

      // Verify asset exists and is owned by requester (use DAS getAsset — more reliable than Umi fetchAsset)
      let dasAsset;
      try {
        const dasRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'update-verify', method: 'getAsset', params: { id: assetId } }),
        });
        const dasJson = await dasRes.json();
        dasAsset = dasJson?.result;
        if (!dasAsset || !dasAsset.ownership) throw new Error('DAS returned no asset');
      } catch (fetchErr) {
        console.error('[update-card] DAS getAsset failed', { assetId, error: fetchErr?.message ?? fetchErr });
        respondJson(res, 404, { error: 'Asset not found on-chain' });
        return;
      }
      if (dasAsset.ownership.owner !== ownerAddress) {
        console.warn('[update-card] owner mismatch', { expected: ownerAddress, actual: dasAsset.ownership.owner });
        respondJson(res, 403, { error: 'Asset not owned by this wallet' });
        return;
      }
      if (dasAsset.interface !== 'MplCoreAsset') {
        respondJson(res, 400, { error: 'Asset is not an mpl-core NFT' });
        return;
      }

      // Validate asset on-chain — DAS can return stale/burned accounts
      // Key::AssetV1 = 1 is the first byte of a valid MPL Core asset
      const rawAsset = await connection.getAccountInfo(new PublicKey(assetId), 'confirmed').catch(() => null);
      const isValidAsset = rawAsset && rawAsset.data.length > 0 && rawAsset.data[0] === 1;
      console.info('[update-card] asset on-chain check', {
        assetId: assetId.slice(0, 16),
        exists: !!rawAsset, dataLen: rawAsset?.data?.length ?? 0,
        firstByte: rawAsset?.data?.length > 0 ? rawAsset.data[0] : 'none', valid: isValidAsset,
      });

      if (!isValidAsset) {
        // DAS may have stale data — scan all owner assets to find a valid one
        console.warn('[update-card] assetId invalid on-chain, scanning DAS for valid asset');
        const dasSearch = await fetch(rpcUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'update-scan', method: 'getAssetsByOwner',
            params: { ownerAddress, page: 1, limit: 200 } }),
        }).then(r => r.json()).catch(() => null);
        const candidates = (dasSearch?.result?.items ?? []).filter(
          a => a.interface === 'MplCoreAsset' &&
               a.grouping?.some(g => g.group_key === 'collection' && g.group_value === CORE_COLLECTION)
        );
        let foundId = null;
        for (const c of candidates) {
          if (c.id === assetId) continue;
          const acc = await connection.getAccountInfo(new PublicKey(c.id), 'confirmed').catch(() => null);
          if (acc && acc.data.length > 0 && acc.data[0] === 1) { foundId = c.id; break; }
        }
        if (!foundId) {
          console.error('[update-card] no valid MPL Core asset found', { ownerAddress: ownerAddress.slice(0, 8) });
          respondJson(res, 404, { error: 'No valid Identity Prism NFT found on-chain. Try minting a new one.' });
          return;
        }
        console.info('[update-card] switching to valid asset', { from: assetId.slice(0, 16), to: foundId.slice(0, 16) });
        assetId = foundId;
      }

      // Build updateV1 instruction — explicit payer=owner so MPL Core account layout is correct
      const ownerSigner = createNoopSigner(publicKey(ownerKey.toBase58()));
      const builder = updateV1(umi, {
        asset: publicKey(assetId),
        collection: publicKey(collectionMintKey.toBase58()),
        payer: ownerSigner,
        authority: collectionAuthoritySigner,
        newName,
        newUri: metadataUri,
      }).setFeePayer(ownerSigner);
      const updateIxs = builder.getInstructions().map((ix) => {
        const web3Ix = toWeb3JsInstruction(ix);
        web3Ix.keys = web3Ix.keys.map((key) => {
          const keyStr = key.pubkey.toBase58();
          if (keyStr === collectionAuthorityKeypair.publicKey.toBase58()) {
            return { ...key, isSigner: true };
          }
          if (keyStr === ownerKey.toBase58()) {
            return { ...key, isSigner: true };
          }
          return key;
        });
        return web3Ix;
      });

      // Service fee transfer: user → treasury
      const feeLamports = Math.round(UPDATE_FEE_SOL * LAMPORTS_PER_SOL);
      const feeIx = SystemProgram.transfer({
        fromPubkey: ownerKey,
        toPubkey: treasuryKey,
        lamports: feeLamports,
      });

      const latestBlockhash = await connection.getLatestBlockhash('finalized');
      const transaction = new Transaction().add(feeIx, ...updateIxs);
      transaction.feePayer = ownerKey;
      transaction.recentBlockhash = latestBlockhash.blockhash;
      // Log required signers for diagnostics
      const compiledMsg = transaction.compileMessage();
      const requiredSigners = compiledMsg.accountKeys
        .slice(0, compiledMsg.header.numRequiredSignatures)
        .map((k) => k.toBase58());
      console.info('[update-card] required signers', { requiredSigners, collectionAuth: collectionAuthorityKeypair.publicKey.toBase58(), owner: ownerAddress });

      const txBuffer = transaction.serialize({ requireAllSignatures: false });

      console.info('[update-card] prepared', { ownerAddress: ownerAddress.slice(0, 8), assetId: assetId.slice(0, 16), feeSol: UPDATE_FEE_SOL });
      respondJson(res, 200, {
        transaction: txBuffer.toString('base64'),
        feeSol: UPDATE_FEE_SOL,
        blockhash: latestBlockhash.blockhash,
      });
    } catch (error) {
      console.error('[update-card] failed', error);
      respondJson(res, 500, {
        error: 'Update card failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === '/verify-collection') {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      if (!COLLECTION_AUTHORITY_SECRET) {
        respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured' });
        return;
      }

      const secretKey = parseSecretKey(COLLECTION_AUTHORITY_SECRET);
      if (!secretKey) {
        respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is invalid' });
        return;
      }

      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const mint = payload?.mint ? new PublicKey(payload.mint) : null;
      const collectionMint = payload?.collectionMint ? new PublicKey(payload.collectionMint) : null;
      if (!mint || !collectionMint) {
        respondJson(res, 400, { error: 'mint and collectionMint are required' });
        return;
      }

      const rpcUrl = getRpcUrl(mint.toBase58());
      if (!rpcUrl) {
        respondJson(res, 500, { error: 'Helius API key required' });
        return;
      }

      const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
      const collectionAuthority = Keypair.fromSecretKey(secretKey);
      const metadataPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )[0];
      const collectionMetadataPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          collectionMint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )[0];
      const collectionMasterEditionPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          collectionMint.toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )[0];

      const buildVerifyInstruction = (discriminator) =>
        new TransactionInstruction({
          programId: TOKEN_METADATA_PROGRAM_ID,
          keys: [
            { pubkey: metadataPda, isSigner: false, isWritable: true },
            { pubkey: collectionAuthority.publicKey, isSigner: true, isWritable: true },
            { pubkey: collectionAuthority.publicKey, isSigner: true, isWritable: true },
            { pubkey: collectionMint, isSigner: false, isWritable: false },
            { pubkey: collectionMetadataPda, isSigner: false, isWritable: true },
            { pubkey: collectionMasterEditionPda, isSigner: false, isWritable: false },
          ],
          data: Buffer.from([discriminator]),
        });

      const sendVerify = async (discriminator) => {
        const transaction = new Transaction().add(buildVerifyInstruction(discriminator));
        transaction.feePayer = collectionAuthority.publicKey;
        const latestBlockhash = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = latestBlockhash.blockhash;
        transaction.sign(collectionAuthority);

        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
        });
        await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          'confirmed'
        );
        return signature;
      };

      let signature;
      try {
        signature = await sendVerify(18);
      } catch (error) {
        console.warn('[verify-collection] verifyCollection failed, trying sized item', error);
        signature = await sendVerify(30);
      }

      respondJson(res, 200, { signature });
    } catch (error) {
      console.error('[verify-collection] failed', error);
      respondJson(res, 500, { error: 'Collection verification failed' });
    }
    return;
  }

  const isAssetUpload =
    pathname === '/assets' ||
    pathname === '/assets/' ||
    pathname === '/metadata/assets' ||
    pathname === '/metadata/assets/';
  if (isAssetUpload) {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      const body = await readBody(req);
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (error) {
        console.error('[assets] invalid json', {
          error: error instanceof Error ? error.message : String(error),
          bodyPreview: body.slice(0, 200),
        });
        respondJson(res, 400, { error: 'Invalid JSON payload' });
        return;
      }
      const imageValue = payload?.image ?? payload?.dataUrl ?? payload?.imageBase64 ?? '';
      if (!imageValue || typeof imageValue !== 'string') {
        respondJson(res, 400, { error: 'Missing image payload' });
        return;
      }
      let base64 = imageValue.trim();
      let contentType = typeof payload?.contentType === 'string' ? payload.contentType : '';
      const dataMatch = base64.match(/^data:([^;]+);base64,(.+)$/);
      if (dataMatch) {
        contentType = dataMatch[1];
        base64 = dataMatch[2];
      }
      if (!base64) {
        respondJson(res, 400, { error: 'Invalid image payload' });
        return;
      }
      let extension = 'png';
      if (contentType.includes('jpeg') || contentType.includes('jpg')) {
        extension = 'jpg';
      } else if (contentType.includes('webp')) {
        extension = 'webp';
      } else if (contentType.includes('gif')) {
        extension = 'gif';
      }
      const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const fileName = resolveAssetFile(`${id}.${extension}`);
      if (!fileName) {
        respondJson(res, 500, { error: 'Failed to create asset file' });
        return;
      }
      const filePath = path.join(ASSETS_DIR, fileName);
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      const baseUrl = getBaseUrl(req);
      if (!baseUrl) {
        respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
        return;
      }
      respondJson(res, 200, { url: `${baseUrl}/metadata/assets/${fileName}` });
    } catch (error) {
      console.error('[assets] upload failed', error);
      respondJson(res, 500, { error: 'Asset upload failed' });
    }
    return;
  }

  const isAssetFetch = pathname.startsWith('/assets/') || pathname.startsWith('/metadata/assets/');
  if (isAssetFetch) {
    if (req.method !== 'GET') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    const parts = pathname.split('/').filter(Boolean);
    const rawName = parts[parts.length - 1] ?? '';
    const fileName = resolveAssetFile(rawName);
    if (!fileName) {
      respondJson(res, 404, { error: 'Asset not found' });
      return;
    }
    const filePath = path.join(ASSETS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      respondJson(res, 404, { error: 'Asset not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': getContentType(fileName) });
    res.end(fs.readFileSync(filePath));
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname.startsWith('/metadata')) {
    if (req.method === 'POST' && (pathname === '/metadata' || pathname === '/metadata/')) {
      try {
        const body = await readBody(req);
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch (error) {
          console.error('[metadata] invalid json', {
            error: error instanceof Error ? error.message : String(error),
            bodyPreview: body.slice(0, 200),
          });
          respondJson(res, 400, { error: 'Invalid JSON payload' });
          return;
        }
        const wrappedMetadata = payload?.metadata;
        const metadata =
          wrappedMetadata && typeof wrappedMetadata === 'object'
            ? wrappedMetadata
            : payload && typeof payload === 'object'
              ? payload
              : null;
        if (!metadata || Array.isArray(metadata)) {
          respondJson(res, 400, { error: 'Missing metadata payload' });
          return;
        }

        const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const fileName = resolveMetadataFile(id);
        if (!fileName) {
          respondJson(res, 500, { error: 'Failed to create metadata file' });
          return;
        }
        const filePath = path.join(METADATA_DIR, fileName);
        fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
        const baseUrl = getBaseUrl(req);
        if (!baseUrl) {
          respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
          return;
        }
        respondJson(res, 200, { uri: `${baseUrl}/metadata/${fileName}` });
      } catch (error) {
        console.error('[metadata] write failed', error);
        respondJson(res, 500, { error: 'Metadata write failed' });
      }
      return;
    }

    if (req.method === 'GET') {
      const parts = pathname.split('/').filter(Boolean);
      const rawName = parts[1] ?? '';
      const fileName = resolveMetadataFile(rawName);
      if (!fileName) {
        respondJson(res, 404, { error: 'Metadata not found' });
        return;
      }
      const filePath = path.join(METADATA_DIR, fileName);
      if (!fs.existsSync(filePath)) {
        respondJson(res, 404, { error: 'Metadata not found' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(filePath, 'utf-8'));
      return;
    }

    respondJson(res, 405, { error: 'Method not allowed' });
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

  try {
    const rpcBody = await readBody(req);
    const seed = String(req.headers['x-wallet-address'] ?? '');

    // Detect RPC method to decide routing
    let rpcMethod = '';
    try { rpcMethod = JSON.parse(rpcBody)?.method ?? ''; } catch {}

    const isDasMethod = DAS_METHODS.has(rpcMethod);

    // Build Helius URL
    const apiKey = pickHeliusKey(seed);
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
      respondJson(res, 500, { error: 'No RPC endpoint available for method: ' + rpcMethod });
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

const prismBalances = new Map(); // address → { balance, totalEarned, totalSpent, lastUpdated }
const prismTransactions = new Map(); // address → PrismTransaction[]
const leaderboardCache = { entries: [], lastUpdated: 0 };
const feedItems = [];
const sybilCache = new Map(); // address → { analysis, cachedAt }

// Load persisted PRISM data
const PRISM_DATA_FILE = path.join(process.cwd(), 'prism_data.json');
try {
  if (fs.existsSync(PRISM_DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(PRISM_DATA_FILE, 'utf8'));
    if (raw.balances) for (const [k, v] of Object.entries(raw.balances)) prismBalances.set(k, v);
    if (raw.transactions) for (const [k, v] of Object.entries(raw.transactions)) prismTransactions.set(k, v);
    console.log(`[prism] Loaded ${prismBalances.size} balances`);
  }
} catch { /* first run */ }

function savePrismData() {
  try {
    const data = {
      balances: Object.fromEntries(prismBalances),
      transactions: Object.fromEntries(prismTransactions),
    };
    fs.writeFileSync(PRISM_DATA_FILE, JSON.stringify(data), 'utf8');
  } catch (e) { console.warn('[prism] save error', e.message); }
}

// Debounced save
let prismSaveTimer = null;
function debouncedSavePrism() {
  if (prismSaveTimer) clearTimeout(prismSaveTimer);
  prismSaveTimer = setTimeout(savePrismData, 2000);
}

function getPrismBalance(address) {
  return prismBalances.get(address) || { address, balance: 0, totalEarned: 0, totalSpent: 0, lastUpdated: new Date().toISOString() };
}

// PRISM Balance
router.get('/api/prism/balance', (req, res) => {
  const address = req.query?.address;
  if (!address) return respondJson(res, 400, { error: 'address required' });
  respondJson(res, 200, getPrismBalance(address));
});

// PRISM earn rate-limit: max 1 earn per source per 5 min per address
const prismEarnRateLimit = new Map(); // key: `${address}:${source}` → timestamp
const PRISM_EARN_COOLDOWN_MS = 5 * 60 * 1000;

// PRISM Earn
router.post('/api/prism/earn', async (req, res) => {
  const { address, source, amount, description } = req.body || {};
  if (!address || !amount) return respondJson(res, 400, { error: 'address and amount required' });
  
  // Rate limit check
  const rlKey = `${address}:${source || 'unknown'}`;
  const lastEarn = prismEarnRateLimit.get(rlKey) || 0;
  if (Date.now() - lastEarn < PRISM_EARN_COOLDOWN_MS) {
    return respondJson(res, 429, { error: 'Rate limited — try again later', cooldownMs: PRISM_EARN_COOLDOWN_MS - (Date.now() - lastEarn) });
  }
  prismEarnRateLimit.set(rlKey, Date.now());
  // Cleanup old entries every 1000 earns
  if (prismEarnRateLimit.size > 5000) {
    const cutoff = Date.now() - PRISM_EARN_COOLDOWN_MS * 2;
    for (const [k, v] of prismEarnRateLimit) { if (v < cutoff) prismEarnRateLimit.delete(k); }
  }
  
  const earned = Math.max(0, Math.floor(Number(amount)));
  if (earned <= 0) return respondJson(res, 400, { error: 'amount must be positive' });
  
  const bal = getPrismBalance(address);
  bal.balance += earned;
  bal.totalEarned += earned;
  bal.lastUpdated = new Date().toISOString();
  prismBalances.set(address, bal);
  
  const tx = {
    id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    address, amount: earned, type: 'earn', source: source || 'unknown',
    description: description || `Earned ${earned} PRISM`,
    timestamp: new Date().toISOString(),
  };
  const txs = prismTransactions.get(address) || [];
  txs.unshift(tx);
  if (txs.length > 500) txs.length = 500;
  prismTransactions.set(address, txs);
  
  debouncedSavePrism();
  
  // Add to feed
  feedItems.unshift({
    id: tx.id, type: source?.includes('burn') ? 'burn' : source?.includes('game') ? 'achievement' : 'scan',
    address, description: description || `Earned ${earned} PRISM from ${source}`,
    timestamp: tx.timestamp,
  });
  if (feedItems.length > 200) feedItems.length = 200;
  
  respondJson(res, 200, { balance: bal, earned });
});

// PRISM Spend
router.post('/api/prism/spend', async (req, res) => {
  const { address, source, amount, description } = req.body || {};
  if (!address || !amount) return respondJson(res, 400, { error: 'address and amount required' });
  
  const spent = Math.max(0, Math.floor(Number(amount)));
  const bal = getPrismBalance(address);
  if (bal.balance < spent) return respondJson(res, 400, { error: 'insufficient balance' });
  
  bal.balance -= spent;
  bal.totalSpent += spent;
  bal.lastUpdated = new Date().toISOString();
  prismBalances.set(address, bal);
  
  const tx = {
    id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    address, amount: spent, type: 'spend', source: source || 'unknown',
    description: description || `Spent ${spent} PRISM`,
    timestamp: new Date().toISOString(),
  };
  const txs = prismTransactions.get(address) || [];
  txs.unshift(tx);
  if (txs.length > 500) txs.length = 500;
  prismTransactions.set(address, txs);
  
  debouncedSavePrism();
  respondJson(res, 200, { balance: bal, spent });
});

// PRISM Transaction History
router.get('/api/prism/transactions', (req, res) => {
  const address = req.query?.address;
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));
  if (!address) return respondJson(res, 400, { error: 'address required' });
  const txs = (prismTransactions.get(address) || []).slice(0, limit);
  respondJson(res, 200, txs);
});

// Sybil Analysis — basic server-side endpoint
router.get('/api/sybil/analysis', async (req, res) => {
  const address = req.query?.address;
  if (!address) return respondJson(res, 400, { error: 'address required' });
  
  // Check cache (valid for 1 hour)
  const cached = sybilCache.get(address);
  if (cached && Date.now() - cached.cachedAt < 3600_000) {
    return respondJson(res, 200, cached.analysis);
  }
  
  try {
    // Basic analysis from on-chain data
    const conn = getConnection();
    const pubkey = new PublicKey(address);
    const [balanceResult, signaturesResult] = await Promise.allSettled([
      conn.getBalance(pubkey),
      conn.getSignaturesForAddress(pubkey, { limit: 100 }),
    ]);
    
    const balance = balanceResult.status === 'fulfilled' ? balanceResult.value / 1e9 : 0;
    const signatures = signaturesResult.status === 'fulfilled' ? signaturesResult.value : [];
    
    // Analyze transaction timing
    const timestamps = signatures.filter(s => s.blockTime).map(s => s.blockTime * 1000);
    let timingVariance = 1;
    let isRobotic = false;
    if (timestamps.length >= 10) {
      const sorted = [...timestamps].sort((a, b) => a - b);
      const intervals = [];
      for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1]);
      const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
      if (mean > 0) {
        const stdDev = Math.sqrt(intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length);
        const cv = stdDev / mean;
        timingVariance = Math.min(1, cv / 1.5);
        isRobotic = cv < 0.25 && intervals.length > 20;
      }
    }
    
    // Determine wallet age
    const oldestTx = signatures.length > 0 ? signatures[signatures.length - 1] : null;
    const walletAgeDays = oldestTx?.blockTime ? Math.floor((Date.now() / 1000 - oldestTx.blockTime) / 86400) : 0;
    
    // Build signals
    const signals = [];
    const freshBurst = walletAgeDays < 30 && signatures.length > 50;
    signals.push({ id: 'fresh_wallet', name: 'Fresh Wallet Burst', detected: freshBurst, weight: 15, severity: freshBurst ? 'warning' : 'info' });
    signals.push({ id: 'robotic_timing', name: 'Robotic Transaction Timing', detected: isRobotic, weight: 18, severity: isRobotic ? 'danger' : 'info' });
    
    let riskScore = signals.reduce((sum, s) => sum + (s.detected ? s.weight : 0), 0);
    riskScore = Math.min(100, riskScore);
    
    const riskLevel = riskScore >= 75 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 30 ? 'medium' : riskScore >= 10 ? 'low' : 'clean';
    
    const analysis = {
      address, riskScore, riskLevel, signals,
      behaviorProfile: { txTimingVariance: timingVariance, protocolDiversity: 0.5 },
      timestamp: new Date().toISOString(),
    };
    
    sybilCache.set(address, { analysis, cachedAt: Date.now() });
    respondJson(res, 200, analysis);
  } catch (e) {
    respondJson(res, 500, { error: 'Sybil analysis failed', detail: e.message });
  }
});

// Known CEX/Bridge/DEX addresses for labeling
const KNOWN_LABELS = {
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': { label: 'Binance', type: 'cex' },
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': { label: 'Binance Hot', type: 'cex' },
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': { label: 'Binance', type: 'cex' },
  'H8sMJSCQxfKbeSTMe3fPaFKBMq3pS3bhVwn9dSjYqYLn': { label: 'Coinbase', type: 'cex' },
  'GJRs4FwHtemZ5ZE9Q3MNTDzoH7VDrKEswLzVRSJNDRLZ': { label: 'Coinbase', type: 'cex' },
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': { label: 'Kraken', type: 'cex' },
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': { label: 'Jupiter', type: 'dex' },
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': { label: 'Raydium', type: 'dex' },
  'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb': { label: 'Wormhole', type: 'bridge' },
  'So1endDq2YkqhipRh3WViPa8hFvz0XP1MXF1VZU8Q4Mw': { label: 'Solend', type: 'dex' },
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': { label: 'Orca', type: 'dex' },
};

// Known scam contracts / rug-pull deployers
const KNOWN_SCAM_ADDRESSES = new Set([
  // Placeholder — in production, load from a maintained blocklist
]);
const scamListFile = path.join(process.cwd(), 'scam_addresses.json');
try {
  if (fs.existsSync(scamListFile)) {
    const list = JSON.parse(fs.readFileSync(scamListFile, 'utf8'));
    if (Array.isArray(list)) list.forEach(a => KNOWN_SCAM_ADDRESSES.add(a));
    console.log(`[sybil] Loaded ${KNOWN_SCAM_ADDRESSES.size} known scam addresses`);
  }
} catch {}

// Shared helper: fetch parsed transactions for an address
async function fetchParsedTransactions(address, limit = 50) {
  const conn = getConnection();
  const pubkey = new PublicKey(address);
  const sigs = await conn.getSignaturesForAddress(pubkey, { limit });
  if (!sigs.length) return { signatures: sigs, parsed: [] };
  
  // Fetch parsed txs in batches of 10
  const parsed = [];
  for (let i = 0; i < sigs.length; i += 10) {
    const batch = sigs.slice(i, i + 10).map(s => s.signature);
    try {
      const txs = await conn.getParsedTransactions(batch, { maxSupportedTransactionVersion: 0 });
      parsed.push(...txs.filter(Boolean));
    } catch { /* partial failure ok */ }
  }
  return { signatures: sigs, parsed };
}

// Extract SOL transfers from parsed transactions
function extractSolTransfers(parsed, targetAddress) {
  const incoming = new Map(); // sender → { totalSol, count, firstTime, lastTime }
  const outgoing = new Map(); // receiver → { totalSol, count }
  const programIds = new Set();
  
  for (const tx of parsed) {
    if (!tx?.meta || !tx?.transaction) continue;
    const blockTime = tx.blockTime ? tx.blockTime * 1000 : Date.now();
    
    // Collect program IDs for protocol diversity
    const ixs = tx.transaction.message?.instructions || [];
    for (const ix of ixs) {
      if (ix.programId) programIds.add(ix.programId.toBase58());
    }
    
    // Parse SOL balance changes from pre/post balances
    const accounts = tx.transaction.message?.accountKeys || [];
    const pre = tx.meta.preBalances || [];
    const post = tx.meta.postBalances || [];
    
    for (let i = 0; i < accounts.length; i++) {
      const acc = typeof accounts[i] === 'string' ? accounts[i] : accounts[i]?.pubkey?.toBase58?.() || '';
      const diff = ((post[i] || 0) - (pre[i] || 0)) / 1e9;
      
      if (acc === targetAddress && diff > 0.001) {
        // Someone sent SOL to us — find likely sender (account with negative diff)
        for (let j = 0; j < accounts.length; j++) {
          if (j === i) continue;
          const senderAcc = typeof accounts[j] === 'string' ? accounts[j] : accounts[j]?.pubkey?.toBase58?.() || '';
          const senderDiff = ((post[j] || 0) - (pre[j] || 0)) / 1e9;
          if (senderDiff < -0.001 && senderAcc !== '11111111111111111111111111111111') {
            const existing = incoming.get(senderAcc) || { totalSol: 0, count: 0, firstTime: blockTime, lastTime: blockTime };
            existing.totalSol += Math.abs(diff);
            existing.count += 1;
            existing.firstTime = Math.min(existing.firstTime, blockTime);
            existing.lastTime = Math.max(existing.lastTime, blockTime);
            incoming.set(senderAcc, existing);
            break;
          }
        }
      } else if (acc === targetAddress && diff < -0.001) {
        for (let j = 0; j < accounts.length; j++) {
          if (j === i) continue;
          const recvAcc = typeof accounts[j] === 'string' ? accounts[j] : accounts[j]?.pubkey?.toBase58?.() || '';
          const recvDiff = ((post[j] || 0) - (pre[j] || 0)) / 1e9;
          if (recvDiff > 0.001) {
            const existing = outgoing.get(recvAcc) || { totalSol: 0, count: 0 };
            existing.totalSol += Math.abs(recvDiff);
            existing.count += 1;
            outgoing.set(recvAcc, existing);
            break;
          }
        }
      }
    }
  }
  return { incoming, outgoing, programIds };
}

// Sybil Funding Sources — real implementation
router.get('/api/sybil/funding-sources', async (req, res) => {
  const address = req.query?.address;
  if (!address) return respondJson(res, 400, { error: 'address required' });
  
  try {
    const { parsed } = await fetchParsedTransactions(address, 100);
    const { incoming } = extractSolTransfers(parsed, address);
    
    const totalReceived = [...incoming.values()].reduce((s, v) => s + v.totalSol, 0) || 1;
    const sources = [...incoming.entries()]
      .sort((a, b) => b[1].totalSol - a[1].totalSol)
      .slice(0, 20)
      .map(([addr, info]) => {
        const known = KNOWN_LABELS[addr];
        return {
          address: addr,
          label: known?.label || null,
          type: known?.type || 'wallet',
          totalSolReceived: Math.round(info.totalSol * 10000) / 10000,
          transactionCount: info.count,
          firstInteraction: new Date(info.firstTime).toISOString(),
          lastInteraction: new Date(info.lastTime).toISOString(),
          percentage: Math.round((info.totalSol / totalReceived) * 100),
        };
      });
    
    respondJson(res, 200, { sources });
  } catch (e) {
    respondJson(res, 200, { sources: [], error: e.message });
  }
});

// Sybil Cluster Detection — finds wallets funded from same source
const clusterCache = new Map();
router.get('/api/sybil/cluster', async (req, res) => {
  const address = req.query?.address;
  if (!address) return respondJson(res, 400, { error: 'address required' });
  
  const cached = clusterCache.get(address);
  if (cached && Date.now() - cached.ts < 1800_000) return respondJson(res, 200, cached.data);
  
  try {
    const { parsed } = await fetchParsedTransactions(address, 50);
    const { incoming } = extractSolTransfers(parsed, address);
    
    // Find the top funder
    let topFunder = null;
    let topAmount = 0;
    for (const [addr, info] of incoming) {
      if (info.totalSol > topAmount) { topFunder = addr; topAmount = info.totalSol; }
    }
    
    if (!topFunder || topAmount < 0.01) {
      const result = { clusterId: null };
      clusterCache.set(address, { data: result, ts: Date.now() });
      return respondJson(res, 200, result);
    }
    
    // Check if the top funder also funded other wallets (siblings)
    const conn = getConnection();
    const funderSigs = await conn.getSignaturesForAddress(new PublicKey(topFunder), { limit: 50 });
    const funderBatch = funderSigs.slice(0, 20).map(s => s.signature);
    let funderParsed = [];
    try {
      const txs = await conn.getParsedTransactions(funderBatch, { maxSupportedTransactionVersion: 0 });
      funderParsed = txs.filter(Boolean);
    } catch {}
    
    const siblings = new Set();
    for (const tx of funderParsed) {
      if (!tx?.meta || !tx?.transaction) continue;
      const accounts = tx.transaction.message?.accountKeys || [];
      const pre = tx.meta.preBalances || [];
      const post = tx.meta.postBalances || [];
      for (let i = 0; i < accounts.length; i++) {
        const acc = typeof accounts[i] === 'string' ? accounts[i] : accounts[i]?.pubkey?.toBase58?.() || '';
        const diff = ((post[i] || 0) - (pre[i] || 0)) / 1e9;
        if (diff > 0.01 && acc !== topFunder && acc !== address && acc !== '11111111111111111111111111111111') {
          siblings.add(acc);
        }
      }
    }
    
    const known = KNOWN_LABELS[topFunder];
    const result = siblings.size >= 2 ? {
      clusterId: crypto.createHash('sha256').update(topFunder).digest('hex').slice(0, 16),
      clusterSize: siblings.size + 1,
      sharedFundingSource: topFunder,
      sharedFundingLabel: known?.label || null,
      siblingWallets: [...siblings].slice(0, 10),
      confidence: Math.min(100, 30 + siblings.size * 10),
    } : { clusterId: null };
    
    clusterCache.set(address, { data: result, ts: Date.now() });
    respondJson(res, 200, result);
  } catch (e) {
    respondJson(res, 200, { clusterId: null, error: e.message });
  }
});

// Sybil Circular Flow — detect A→B→C→A patterns
router.get('/api/sybil/circular-flow', async (req, res) => {
  const address = req.query?.address;
  if (!address) return respondJson(res, 400, { error: 'address required' });
  
  try {
    const { parsed } = await fetchParsedTransactions(address, 50);
    const { incoming, outgoing } = extractSolTransfers(parsed, address);
    
    // Check: did any address I sent SOL to also send SOL to me? (A↔B loop)
    const cycle = [];
    for (const [outAddr] of outgoing) {
      if (incoming.has(outAddr)) {
        cycle.push(address, outAddr, address);
        break;
      }
    }
    
    respondJson(res, 200, { detected: cycle.length > 0, cycle });
  } catch (e) {
    respondJson(res, 200, { detected: false, cycle: [], error: e.message });
  }
});

// Dark Pool Warning — check wallet interactions with known scam contracts
router.get('/api/sybil/dark-pool', async (req, res) => {
  const address = req.query?.address;
  if (!address) return respondJson(res, 400, { error: 'address required' });
  
  try {
    const { parsed } = await fetchParsedTransactions(address, 100);
    const scamInteractions = [];
    const allPrograms = new Set();
    
    for (const tx of parsed) {
      if (!tx?.transaction) continue;
      const ixs = tx.transaction.message?.instructions || [];
      for (const ix of ixs) {
        const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
        if (pid) allPrograms.add(pid);
        if (KNOWN_SCAM_ADDRESSES.has(pid)) {
          scamInteractions.push({
            program: pid,
            signature: tx.transaction.signatures?.[0] || '',
            blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
          });
        }
      }
      // Also check if any counterparty is a known scam address
      const accounts = tx.transaction.message?.accountKeys || [];
      for (const acc of accounts) {
        const addr = typeof acc === 'string' ? acc : acc?.pubkey?.toBase58?.() || '';
        if (KNOWN_SCAM_ADDRESSES.has(addr) && addr !== address) {
          scamInteractions.push({
            address: addr,
            signature: tx.transaction.signatures?.[0] || '',
            blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
          });
        }
      }
    }
    
    respondJson(res, 200, {
      address,
      scamInteractions: scamInteractions.slice(0, 20),
      scamCount: scamInteractions.length,
      totalProgramsUsed: allPrograms.size,
      riskLevel: scamInteractions.length >= 5 ? 'high' : scamInteractions.length >= 1 ? 'medium' : 'clean',
    });
  } catch (e) {
    respondJson(res, 200, { address, scamInteractions: [], scamCount: 0, riskLevel: 'unknown', error: e.message });
  }
});

// Contract Scanner — check if a specific contract/program is flagged
router.post('/api/scam-check', async (req, res) => {
  const { address } = req.body || {};
  if (!address) return respondJson(res, 400, { error: 'contract address required' });
  
  const isKnownScam = KNOWN_SCAM_ADDRESSES.has(address);
  
  // Also try to fetch program account info
  let programInfo = null;
  try {
    const conn = getConnection();
    const info = await conn.getAccountInfo(new PublicKey(address));
    if (info) {
      programInfo = {
        executable: info.executable,
        owner: info.owner?.toBase58(),
        lamports: info.lamports,
        dataSize: info.data?.length || 0,
      };
    }
  } catch {}
  
  respondJson(res, 200, {
    address,
    isKnownScam,
    isExecutable: programInfo?.executable || false,
    programInfo,
    verdict: isKnownScam ? 'FLAGGED — Known scam contract' : programInfo?.executable ? 'Program found — not in blocklist' : 'Not a program account',
  });
});

// Global Leaderboard — combines identity scores + PRISM earnings
router.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));
  
  // Build from score-history (identity scores) merged with PRISM balances
  const entryMap = new Map();
  
  // Add wallets from score-history (has real tier data)
  for (const [address, hist] of scoreHistory) {
    const latest = hist.scores?.[0];
    if (latest) {
      entryMap.set(address, {
        address,
        score: latest.score,
        tier: latest.tier || 'unknown',
        prismBalance: prismBalances.get(address)?.balance || 0,
        badges: 0,
        rank: 0,
      });
    }
  }
  
  // Add wallets from PRISM balances that aren't in score-history
  for (const [address, bal] of prismBalances) {
    if (!entryMap.has(address)) {
      entryMap.set(address, {
        address,
        score: 0,
        tier: 'unknown',
        prismBalance: bal.balance,
        badges: 0,
        rank: 0,
      });
    }
  }
  
  const entries = [...entryMap.values()]
    .sort((a, b) => b.score - a.score || b.prismBalance - a.prismBalance);
  entries.forEach((e, i) => { e.rank = i + 1; });
  
  respondJson(res, 200, { entries: entries.slice(0, limit) });
});

// Identity Feed
router.get('/api/feed', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 30));
  respondJson(res, 200, { items: feedItems.slice(0, limit) });
});

// Constellation Network — real tx graph from on-chain data
const constellationCache = new Map();
router.get('/api/constellation', async (req, res) => {
  const address = req.query?.address;
  if (!address) return respondJson(res, 400, { error: 'address required' });
  
  const cached = constellationCache.get(address);
  if (cached && Date.now() - cached.ts < 600_000) return respondJson(res, 200, cached.data);
  
  try {
    const { parsed } = await fetchParsedTransactions(address, 80);
    const { incoming, outgoing, programIds } = extractSolTransfers(parsed, address);
    
    // Build node map: center + all counterparties
    const nodeMap = new Map();
    nodeMap.set(address, { id: address, label: address.slice(0, 4) + '...' + address.slice(-4), size: 14, x: 0, y: 0, vx: 0, vy: 0, color: '#22d3ee', isCenter: true });
    
    const allCounterparties = new Map();
    for (const [addr, info] of incoming) {
      const existing = allCounterparties.get(addr) || { solIn: 0, solOut: 0, count: 0 };
      existing.solIn += info.totalSol;
      existing.count += info.count;
      allCounterparties.set(addr, existing);
    }
    for (const [addr, info] of outgoing) {
      const existing = allCounterparties.get(addr) || { solIn: 0, solOut: 0, count: 0 };
      existing.solOut += info.totalSol;
      existing.count += info.count;
      allCounterparties.set(addr, existing);
    }
    
    // Sort by total interaction volume, take top 25
    const sorted = [...allCounterparties.entries()]
      .sort((a, b) => (b[1].solIn + b[1].solOut) - (a[1].solIn + a[1].solOut))
      .slice(0, 25);
    
    const TIER_COLORS = { mercury: '#8B8B8B', mars: '#C1440E', venus: '#E8CDA0', earth: '#4B9CD3', neptune: '#3F54BE', uranus: '#73C2FB', saturn: '#E8D191', jupiter: '#C88B3A', sun: '#FFD700', binary_sun: '#22D3EE' };
    const colorPalette = Object.values(TIER_COLORS);
    
    const edges = [];
    for (let i = 0; i < sorted.length; i++) {
      const [addr, info] = sorted[i];
      const known = KNOWN_LABELS[addr];
      const angle = (i / sorted.length) * Math.PI * 2;
      const dist = 80 + Math.random() * 100;
      const totalVol = info.solIn + info.solOut;
      
      nodeMap.set(addr, {
        id: addr,
        label: known?.label || (addr.slice(0, 4) + '...' + addr.slice(-4)),
        size: Math.min(10, 3 + Math.log1p(totalVol) * 2),
        x: Math.cos(angle) * dist + (Math.random() - 0.5) * 30,
        y: Math.sin(angle) * dist + (Math.random() - 0.5) * 30,
        vx: 0, vy: 0,
        color: known ? '#f59e0b' : colorPalette[i % colorPalette.length],
        isCenter: false,
        tier: known?.type || null,
      });
      
      edges.push({
        source: address,
        target: addr,
        weight: info.count,
        totalSol: Math.round((info.solIn + info.solOut) * 10000) / 10000,
      });
    }
    
    const result = { nodes: [...nodeMap.values()], edges };
    constellationCache.set(address, { data: result, ts: Date.now() });
    respondJson(res, 200, result);
  } catch (e) {
    respondJson(res, 200, { nodes: [], edges: [], error: e.message });
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.listen(PORT, HOST, () => {
  const providers = [];
  if (ALCHEMY_RPC_URL) providers.push('alchemy');
  if (HELIUS_KEYS.length) providers.push(`helius(${HELIUS_KEYS.length} keys)`);
  else if (HELIUS_RPC_BASE) providers.push('helius(no-key)');
  if (FALLBACK_RPC_URL) providers.push('solana-public');
  console.log(`[helius-proxy] listening on ${HOST}:${PORT} | RPC chain: ${providers.join(' → ') || 'none'} (gzip, keep-alive 65s)`);
});
