import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { URL, fileURLToPath } from 'node:url';
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
import { createRequire } from 'node:module';
import { calculateBlackHoleReward } from './services/blackHoleRewards.js';
import { calculateIdentity } from './services/scoring.js';
import { drawBackCard, drawFrontCard, drawFrontCardImage } from './services/cardGenerator.js';
import {
  buildIdentityHolderPerks,
  GAME_SESSION_ONCHAIN_BONUS_MULTIPLIER,
  normalizeGameCoinDeltaForCap,
  scaleAppliedGameCoinDelta,
} from './services/identityPerks.js';
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
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'https://identityprism.xyz';

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
  const questXPEarned = Number(userData?.rangerXP?.totalXPEarned) || 0;
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
    identityOwnershipCache.set(address, { value, expiresAt: Date.now() + IDENTITY_OWNERSHIP_CACHE_TTL_MS });
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
  buildIdentityHolderPerks(await hasCoreCollectionAsset(address, options), FREE_REVIVES_PER_DAY);

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
  const cached = sybilCache.get(targetAddress);
  if (cached?.analysis && now - cached.cachedAt < SCAN_ANALYSIS_TTL_MS) {
    return cached.analysis;
  }
  const walletEntry = walletDatabase.get(targetAddress);
  const sybil = walletEntry?.sybil;
  const updatedAt = Date.parse(String(sybil?.updatedAt || ''));
  if (sybil && Number.isFinite(updatedAt) && now - updatedAt < SCAN_ANALYSIS_TTL_MS) {
    return sybil;
  }
  return null;
};

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

// ── JWT Auth ──────────────────────────────────────────────────────────────────
const JWT_SECRET_FILE = path.join(process.cwd(), '.jwt_secret');
const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET.trim();
  try {
    if (fs.existsSync(JWT_SECRET_FILE)) return fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
  } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(JWT_SECRET_FILE, secret, 'utf8'); } catch (e) { console.warn('[jwt] Could not persist secret:', e.message); }
  return secret;
})();
const JWT_TTL = '24h';
const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 min nonce window
const authChallenges = new Map(); // nonce → { address, expiresAt }

// ── Referral salt (cached per-process; production MUST set REFERRAL_SALT env var) ──
const _referralSalt = process.env.REFERRAL_SALT || (() => {
  const fallback = crypto.randomBytes(16).toString('hex');
  console.warn('[referral] REFERRAL_SALT env var not set — using random per-process fallback. Referral codes will change on restart!');
  return fallback;
})();

// Trusted proxy IPs — only trust X-Forwarded-For from these sources
const TRUSTED_PROXIES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** Extract real client IP, only trusting X-Forwarded-For from trusted proxies */
function getClientIp(req) {
  const socketIp = req.socket?.remoteAddress || 'unknown';
  if (TRUSTED_PROXIES.has(socketIp) && req.headers['x-forwarded-for']) {
    return req.headers['x-forwarded-for'].split(',')[0].trim();
  }
  return socketIp;
}

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
function verifyWalletSignature(address, message, signatureRaw) {
  try {
    const pubkeyBytes = new PublicKey(address).toBytes();
    const msgBytes = Buffer.from(message, 'utf8');

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
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: 'identity-prism', audience: 'identity-prism-api' });
    const clientIp = getClientIp(req);
    if (payload.address && clientIp) {
      const ips = walletIpLog.get(payload.address) || new Set();
      ips.add(clientIp);
      walletIpLog.set(payload.address, ips);
    }
    return { ok: true, address: payload.address };
  } catch {
    respondJson(res, 401, { error: 'Invalid or expired auth token' });
    return { ok: false };
  }
}

/**
 * Optional JWT: if token present and valid, returns { ok: true, address }.
 * If no token, returns { ok: true, address: null } (caller must get address elsewhere).
 * Only returns { ok: false } if token IS present but invalid/expired.
 */
function optionalJwt(req, res) {
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return { ok: true, address: null };
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: 'identity-prism', audience: 'identity-prism-api' });
    return { ok: true, address: payload.address };
  } catch {
    // Token present but invalid — reject to prevent spoofing
    return { ok: false, address: null };
  }
}

const blackHoleUsedSignatures = globalThis._usedBlackHoleSigMap || (() => {
  const map = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(BLACKHOLE_USED_SIG_FILE, 'utf8'));
    for (const [signature, ts] of Object.entries(raw)) map.set(signature, Number(ts) || Date.now());
  } catch {}
  return (globalThis._usedBlackHoleSigMap = map);
})();

function persistBlackHoleUsedSignatures() {
  const tmp = `${BLACKHOLE_USED_SIG_FILE}.tmp`;
  const payload = {};
  for (const [signature, ts] of blackHoleUsedSignatures) payload[signature] = ts;
  fs.promises
    .writeFile(tmp, JSON.stringify(payload), 'utf8')
    .then(() => fs.promises.rename(tmp, BLACKHOLE_USED_SIG_FILE))
    .catch(() => {});
}

function cleanupBlackHoleUsedSignatures() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [signature, ts] of blackHoleUsedSignatures) {
    if (ts < cutoff) blackHoleUsedSignatures.delete(signature);
  }
}

function normalizePubkey(value) {
  try {
    return new PublicKey(String(value)).toBase58();
  } catch {
    return null;
  }
}

function getParsedAccountKeyString(key) {
  if (!key) return null;
  if (typeof key === 'string') return normalizePubkey(key) || key;
  if (typeof key?.pubkey === 'string') return normalizePubkey(key.pubkey) || key.pubkey;
  if (key?.pubkey && typeof key.pubkey.toBase58 === 'function') return key.pubkey.toBase58();
  if (typeof key.toBase58 === 'function') return key.toBase58();
  return null;
}

function getInstructionProgramId(ix) {
  return getParsedAccountKeyString(ix?.programId) || null;
}

function getParsedTxKeys(tx) {
  return Array.isArray(tx?.transaction?.message?.accountKeys) ? tx.transaction.message.accountKeys : [];
}

function findTokenBalanceEntry(tx, account, mint) {
  const accountKeys = getParsedTxKeys(tx);
  const allBalances = [...(tx?.meta?.preTokenBalances || []), ...(tx?.meta?.postTokenBalances || [])];
  return (
    allBalances.find((entry) => {
      const key = accountKeys[entry.accountIndex];
      return getParsedAccountKeyString(key) === account && (!mint || entry.mint === mint);
    }) || null
  );
}

function getTokenAmountRaw(entry) {
  if (!entry?.uiTokenAmount) return null;
  const raw = entry.uiTokenAmount.amount;
  return raw == null ? null : BigInt(raw);
}

function inferBlackHoleAssetKind(tx, account, mint) {
  const entry = findTokenBalanceEntry(tx, account, mint);
  if (!entry?.uiTokenAmount) return 'fungible';
  const decimals = Number(entry.uiTokenAmount.decimals || 0);
  const amountRaw = getTokenAmountRaw(entry);
  return decimals === 0 && amountRaw === 1n ? 'nft' : 'fungible';
}

function getWalletLamportDelta(tx, address) {
  const accountKeys = getParsedTxKeys(tx);
  const index = accountKeys.findIndex((key) => getParsedAccountKeyString(key) === address);
  if (index < 0) return 0;
  const pre = tx?.meta?.preBalances?.[index] || 0;
  const post = tx?.meta?.postBalances?.[index] || 0;
  return post - pre;
}

function getParsedInstructionProgramId(ix) {
  if (!ix?.programId) return '';
  return typeof ix.programId === 'string'
    ? ix.programId
    : ix.programId?.toBase58?.() || ix.programId?.toString?.() || '';
}

function getParsedTxInstructions(tx) {
  const outer = Array.isArray(tx?.transaction?.message?.instructions)
    ? tx.transaction.message.instructions
    : [];
  const inner = Array.isArray(tx?.meta?.innerInstructions)
    ? tx.meta.innerInstructions.flatMap((entry) => Array.isArray(entry?.instructions) ? entry.instructions : [])
    : [];
  return [...outer, ...inner];
}

function isParsedTokenInstruction(ix, types) {
  if (!ix?.parsed || !types.includes(ix.parsed.type)) return false;
  const programId = getParsedInstructionProgramId(ix);
  return programId === TOKEN_PROGRAM_KEY_STRING || programId === TOKEN_2022_PROGRAM_KEY_STRING;
}

function verifyCloseOperationTx(tx, address, account) {
  if (!tx?.meta || tx.meta.err) return false;
  const keys = getParsedTxKeys(tx);
  if (!keys.some((key) => getParsedAccountKeyString(key) === address)) return false;
  return getParsedTxInstructions(tx).some((ix) => {
    if (!isParsedTokenInstruction(ix, ['closeAccount'])) return false;
    const info = ix.parsed.info || {};
    return (
      normalizePubkey(info.account) === account &&
      normalizePubkey(info.destination) === address &&
      normalizePubkey(info.owner) === address
    );
  });
}

function verifyBurnOperationTx(tx, address, account, mint) {
  if (!verifyCloseOperationTx(tx, address, account)) return false;
  return getParsedTxInstructions(tx).some((ix) => {
    if (!isParsedTokenInstruction(ix, ['burn', 'burnChecked'])) return false;
    const info = ix.parsed.info || {};
    return normalizePubkey(info.account) === account && normalizePubkey(info.authority) === address && info.mint === mint;
  });
}

function verifySwapOperationTx(tx, address, account, mint) {
  if (!tx?.meta || tx.meta.err) return false;
  const accountKeys = getParsedTxKeys(tx);
  if (!accountKeys.some((key) => getParsedAccountKeyString(key) === address)) return false;
  // Verify Jupiter aggregator was involved in the transaction
  const JUPITER_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
  const hasJupiter = accountKeys.some((key) => getParsedAccountKeyString(key) === JUPITER_PROGRAM_ID);
  if (!hasJupiter) return false;
  const entry = findTokenBalanceEntry(tx, account, mint);
  const postEntry = (tx?.meta?.postTokenBalances || []).find((balance) => {
    const key = accountKeys[balance.accountIndex];
    return getParsedAccountKeyString(key) === account && balance.mint === mint;
  });
  const preAmount = getTokenAmountRaw(entry);
  const postAmount = getTokenAmountRaw(postEntry);
  return preAmount !== null && preAmount > 0n && (!postEntry || postAmount === 0n);
}

function getClosedAccountLamports(tx, address) {
  if (!tx?.meta) return 0;
  const keys = getParsedTxKeys(tx);
  const preBalances = Array.isArray(tx.meta.preBalances) ? tx.meta.preBalances : [];
  let total = 0;
  for (const ix of getParsedTxInstructions(tx)) {
    if (!isParsedTokenInstruction(ix, ['closeAccount'])) continue;
    const info = ix.parsed.info || {};
    if (normalizePubkey(info.destination) !== address || normalizePubkey(info.owner) !== address) continue;
    const account = normalizePubkey(info.account);
    const accountIndex = keys.findIndex((key) => getParsedAccountKeyString(key) === account);
    if (accountIndex >= 0) total += Number(preBalances[accountIndex] || 0);
  }
  return total;
}

function verifyBlackHoleCommissionTx(tx, address, commissionRate) {
  if (!tx?.meta || tx.meta.err) return false;
  const normalizedAddress = normalizePubkey(address);
  const treasuryAddress = normalizePubkey(TREASURY_ADDRESS);
  if (!normalizedAddress || !treasuryAddress) return false;
  if (normalizedAddress === treasuryAddress) return true;
  const chunkLamports = getClosedAccountLamports(tx, normalizedAddress);
  if (chunkLamports <= 0) return true;
  const requiredCommissionLamports = Math.round(chunkLamports * commissionRate);
  if (requiredCommissionLamports <= 0) return true;

  let transferredLamports = 0;
  for (const ix of tx.transaction?.message?.instructions || []) {
    if (!ix?.parsed || ix.parsed.type !== 'transfer') continue;
    const info = ix.parsed.info || {};
    if (normalizePubkey(info.source) !== normalizedAddress || normalizePubkey(info.destination) !== treasuryAddress) continue;
    transferredLamports += Number(info.lamports) || 0;
  }
  return transferredLamports >= requiredCommissionLamports;
}

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

let _sessionPersistTimer = null;
let _sessionPersistInFlight = false;
const persistGameSessionProofs = () => {
  if (_sessionPersistTimer) clearTimeout(_sessionPersistTimer);
  _sessionPersistTimer = setTimeout(async () => {
    if (_sessionPersistInFlight) { persistGameSessionProofs(); return; }
    _sessionPersistInFlight = true;
    try {
      const payload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        sessions: Array.from(gameSessionProofs.values()),
      };
      const tmp = GAME_SESSION_STORE_FILE + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(payload, null, 2));
      await fs.promises.rename(tmp, GAME_SESSION_STORE_FILE);
    } catch (error) {
      console.warn('[game-session] Failed to persist proofs', error);
    } finally {
      _sessionPersistInFlight = false;
    }
  }, 2000);
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

let leaderboardCache = null;
let leaderboardCacheTime = 0;

const persistLeaderboard = () => {
  leaderboardCache = null; // invalidate cache on write
  const tmp = LEADERBOARD_STORE_FILE + '.tmp';
  fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries: leaderboardEntries }, null, 2))
    .then(() => fs.promises.rename(tmp, LEADERBOARD_STORE_FILE))
    .catch(err => console.warn('[leaderboard] Failed to persist', err));
};

const submitLeaderboardEntry = (entry) => {
  const { address, score, playedAt, txSignature, gameType } = entry;
  if (!address || typeof score !== 'number' || score <= 0) return null;
  const gt = gameType || 'orbit';
  // Find existing entry for same address + gameType
  const existing = leaderboardEntries.findIndex((e) => e.address === address && (e.gameType || 'orbit') === gt);
  if (existing !== -1) {
    if (score > leaderboardEntries[existing].score) {
      leaderboardEntries[existing] = { address, score, playedAt: playedAt || new Date().toISOString(), txSignature: txSignature || leaderboardEntries[existing].txSignature, gameType: gt };
    } else if (txSignature && !leaderboardEntries[existing].txSignature) {
      leaderboardEntries[existing].txSignature = txSignature;
    } else {
      return leaderboardEntries[existing];
    }
  } else {
    leaderboardEntries.push({ address, score, playedAt: playedAt || new Date().toISOString(), txSignature: txSignature || undefined, gameType: gt });
  }
  leaderboardEntries.sort((a, b) => b.score - a.score);
  if (leaderboardEntries.length > LEADERBOARD_MAX_ENTRIES) leaderboardEntries.length = LEADERBOARD_MAX_ENTRIES;
  persistLeaderboard();
  return leaderboardEntries.find((e) => e.address === address && (e.gameType || 'orbit') === gt) || null;
};

loadLeaderboard();
// Backfill gameType for old entries
leaderboardEntries.forEach(e => { if (!e.gameType) e.gameType = 'orbit'; });
// Clean cheated orbit/gravity scores > 600
const preClean = leaderboardEntries.length;
for (let i = leaderboardEntries.length - 1; i >= 0; i--) {
  const e = leaderboardEntries[i];
  const gt = e.gameType || 'orbit';
  if ((gt === 'orbit' || gt === 'gravity') && e.score > 600) {
    leaderboardEntries.splice(i, 1);
  }
}
if (leaderboardEntries.length < preClean) {
  console.log(`[leaderboard] Cleaned ${preClean - leaderboardEntries.length} cheated entries (score > 600)`);
  persistLeaderboard();
}

// ── Server-side Coin balance persistence ──
const COINS_STORE_FILE = process.env.COINS_STORE_FILE
  ? path.resolve(process.env.COINS_STORE_FILE)
  : path.join(METADATA_DIR, 'coin-balances.json');

const coinBalances = new Map();

const loadCoinBalances = async () => {
  // Try Firestore first
  if (fbAvailable()) {
    try {
      const docs = await fbGetAll('coinBalances');
      if (docs.size > 0) {
        for (const [addr, data] of docs) {
          const bal = typeof data.balance === 'number' ? data.balance : data;
          if (typeof bal === 'number') coinBalances.set(addr, bal);
        }
        console.log(`[coins] Loaded ${coinBalances.size} balances from Firestore`);
        // totalBurned is stored in JSON file, load it even with Firestore
        try {
          if (fs.existsSync(COINS_STORE_FILE)) {
            const raw = fs.readFileSync(COINS_STORE_FILE, 'utf8');
            if (raw.trim()) {
              const parsed = JSON.parse(raw);
              if (typeof parsed?.totalBurned === 'number') { totalBurned = parsed.totalBurned; globalThis._totalBurned = totalBurned; }
            }
          }
        } catch { /* ignore */ }
        console.log(`[coins] totalBurned restored: ${totalBurned}`);
        return;
      }
    } catch (err) {
      console.warn('[coins] Firestore load failed, falling back to JSON:', err.message);
    }
  }
  // Fallback to JSON
  try {
    if (!fs.existsSync(COINS_STORE_FILE)) return;
    const raw = fs.readFileSync(COINS_STORE_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    const entries = parsed?.balances || parsed || {};
    for (const [addr, bal] of Object.entries(entries)) {
      if (typeof bal === 'number') coinBalances.set(addr, bal);
    }
    if (typeof parsed?.totalBurned === 'number') { totalBurned = parsed.totalBurned; globalThis._totalBurned = totalBurned; }
    console.log(`[coins] Loaded ${coinBalances.size} balances from JSON (totalBurned: ${totalBurned})`);
    // Auto-migrate to Firestore
    if (coinBalances.size > 0 && fbAvailable()) {
      console.log('[coins] Migrating JSON data to Firestore...');
      const entries = [...coinBalances.entries()].map(([addr, bal]) => [addr, { balance: bal, updatedAt: new Date().toISOString() }]);
      fbBatchSet('coinBalances', entries)
        .then(() => console.log('[coins] Migration complete'))
        .catch(err => console.warn('[coins] Migration failed:', err.message));
    }
  } catch (err) {
    console.warn('[coins] Failed to load', err);
  }
};

let _coinPersistTimer = null;
const persistCoinBalances = () => {
  if (_coinPersistTimer) clearTimeout(_coinPersistTimer);
  _coinPersistTimer = setTimeout(async () => {
    try {
      const obj = {};
      for (const [k, v] of coinBalances) obj[k] = v;
      const tmp = COINS_STORE_FILE + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), totalBurned, balances: obj }, null, 2));
      await fs.promises.rename(tmp, COINS_STORE_FILE);
    } catch (err) {
      console.warn('[coins] Failed to persist', err);
    }
  }, 1000);
};

const getCoinBalance = (address) => coinBalances.get(address) || 0;

const setCoinBalance = (address, coins) => {
  const safe = Math.max(0, Math.round(coins));
  coinBalances.set(address, safe);
  // Keep walletDatabase in sync (walletDatabase is a Map)
  const wEntry = walletDatabase.get(address);
  if (wEntry) { wEntry.coins = safe; walletDatabase.set(address, wEntry); }
  persistCoinBalances();
  if (fbAvailable()) {
    fbSet('coinBalances', address, { balance: safe, updatedAt: new Date().toISOString() })
      .catch(() => {});
  }
};

// coinBalances loaded async in initData()

// ── Server-side Minted address tracking ──
const MINTED_ADDRESSES_FILE = path.join(METADATA_DIR, 'minted-addresses.json');
const mintedAddresses = new Set();

const loadMintedAddresses = () => {
  try {
    if (!fs.existsSync(MINTED_ADDRESSES_FILE)) return;
    const raw = fs.readFileSync(MINTED_ADDRESSES_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    const addresses = Array.isArray(parsed?.addresses) ? parsed.addresses : (Array.isArray(parsed) ? parsed : []);
    for (const addr of addresses) {
      if (typeof addr === 'string' && addr.trim()) mintedAddresses.add(addr.trim());
    }
    console.log(`[minted] Loaded ${mintedAddresses.size} minted addresses`);
  } catch (err) {
    console.warn('[minted] Failed to load', err);
  }
};

const saveMintedAddresses = () => {
  const tmp = MINTED_ADDRESSES_FILE + '.tmp';
  fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), addresses: [...mintedAddresses] }, null, 2), 'utf8')
    .then(() => fs.promises.rename(tmp, MINTED_ADDRESSES_FILE))
    .catch(err => console.warn('[minted] Failed to persist', err));
};

// mintedAddresses loaded in initData()

// ── Server-side Score History (per wallet, last 20 scores) ──
const SCORE_HISTORY_FILE = path.join(METADATA_DIR, 'score-history.json');
const scoreHistory = new Map(); // address -> { scores: [{ score, tier, date }], lastUpdated }
const SCORE_HISTORY_MAX = 20;

const loadScoreHistory = async () => {
  // Try Firestore first
  if (fbAvailable()) {
    try {
      const docs = await fbGetAll('scoreHistory');
      if (docs.size > 0) {
        for (const [addr, data] of docs) {
          if (Array.isArray(data.scores)) {
            scoreHistory.set(addr, { scores: data.scores.slice(0, SCORE_HISTORY_MAX), lastUpdated: data.lastUpdated || null });
          }
        }
        console.log(`[score-history] Loaded history for ${scoreHistory.size} wallets from Firestore`);
        return;
      }
    } catch (err) {
      console.warn('[score-history] Firestore load failed, falling back to JSON:', err.message);
    }
  }
  // Fallback to JSON
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
    console.log(`[score-history] Loaded history for ${scoreHistory.size} wallets from JSON`);
    // Auto-migrate to Firestore
    if (scoreHistory.size > 0 && fbAvailable()) {
      console.log('[score-history] Migrating JSON data to Firestore...');
      fbBatchSet('scoreHistory', [...scoreHistory.entries()])
        .then(() => console.log('[score-history] Migration complete'))
        .catch(err => console.warn('[score-history] Migration failed:', err.message));
    }
  } catch (err) {
    console.warn('[score-history] Failed to load', err);
  }
};

const persistScoreHistory = async () => {
  try {
    const obj = {};
    for (const [k, v] of scoreHistory) obj[k] = v;
    const tmp = SCORE_HISTORY_FILE + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data: obj }, null, 2));
    await fs.promises.rename(tmp, SCORE_HISTORY_FILE);
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
  if (fbAvailable()) {
    fbSet('scoreHistory', address, { scores: entry.scores, lastUpdated: entry.lastUpdated })
      .catch(() => {});
  }
  return entry;
};

// scoreHistory loaded async in initData()

// ── Server-side Wallet Database (comprehensive wallet data) ──
const WALLET_DB_FILE = path.join(METADATA_DIR, 'wallet-database.json');
const walletDatabase = new Map(); // address -> wallet data object

const loadWalletDatabase = async () => {
  let loadedFromFirestore = false;
  // Try Firestore first
  if (fbAvailable()) {
    try {
      const docs = await fbGetAll('wallets');
      if (docs.size > 0) {
        for (const [addr, data] of docs) {
          if (addr && typeof data === 'object') walletDatabase.set(addr, data);
        }
        console.log(`[wallet-db] Loaded ${walletDatabase.size} wallets from Firestore`);
        loadedFromFirestore = true;
      }
    } catch (err) {
      console.warn('[wallet-db] Firestore load failed, falling back to JSON:', err.message);
    }
  }
  // Load JSON (primary if no Firestore, or merge source if Firestore loaded)
  try {
    if (!fs.existsSync(WALLET_DB_FILE)) return;
    const raw = fs.readFileSync(WALLET_DB_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    const wallets = parsed?.wallets || {};
    if (!loadedFromFirestore) {
      for (const [addr, entry] of Object.entries(wallets)) {
        if (addr && typeof entry === 'object') walletDatabase.set(addr, entry);
      }
      console.log(`[wallet-db] Loaded ${walletDatabase.size} wallets from JSON`);
      // Auto-migrate to Firestore
      if (walletDatabase.size > 0 && fbAvailable()) {
        console.log('[wallet-db] Migrating JSON data to Firestore...');
        fbBatchSet('wallets', [...walletDatabase.entries()])
          .then(() => console.log('[wallet-db] Migration complete'))
          .catch(err => console.warn('[wallet-db] Migration failed:', err.message));
      }
    } else {
      // Merge missing fields from JSON into Firestore-loaded entries
      let mergeCount = 0;
      for (const [addr, jsonEntry] of Object.entries(wallets)) {
        const existing = walletDatabase.get(addr);
        if (!existing || typeof jsonEntry !== 'object') continue;
        let merged = false;
        // Merge scoreBreakdown if Firestore is missing it
        if (!existing.scoreBreakdown && jsonEntry.scoreBreakdown) {
          existing.scoreBreakdown = jsonEntry.scoreBreakdown;
          merged = true;
        }
        // Merge composite if Firestore is missing it
        if (!existing.composite && jsonEntry.composite) {
          existing.composite = jsonEntry.composite;
          merged = true;
        }
        // Merge traits if Firestore is missing them
        if (!existing.traits && jsonEntry.traits) {
          existing.traits = jsonEntry.traits;
          merged = true;
        }
        if (merged) {
          walletDatabase.set(addr, existing);
          mergeCount++;
        }
      }
      if (mergeCount > 0) {
        console.log(`[wallet-db] Merged ${mergeCount} wallets with JSON data`);
      } else {
        console.log(`[wallet-db] No wallets needed merging (JSON had ${Object.keys(wallets).length} entries)`);
      }
    }
  } catch (err) {
    console.warn('[wallet-db] Failed to load JSON', err);
  }
};

const persistWalletDatabase = () => {
  // JSON (synchronous fallback)
  try {
    const obj = {};
    for (const [k, v] of walletDatabase) obj[k] = v;
    const tmp = WALLET_DB_FILE + '.tmp';
    const data = JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      totalWallets: walletDatabase.size,
      wallets: obj,
    }, null, 2);
    fs.promises.writeFile(tmp, data, 'utf8')
      .then(() => fs.promises.rename(tmp, WALLET_DB_FILE))
      .catch(err => { console.warn('[wallet-db] Write error:', err.message); });
  } catch (err) {
    console.warn('[wallet-db] Failed to persist', err);
  }
  // Firestore (async, fire-and-forget)
  if (fbAvailable()) {
    fbBatchSet('wallets', [...walletDatabase.entries()]).catch(err =>
      console.warn('[wallet-db] Firestore batch write failed:', err.message));
  }
};

let walletDbSaveTimer = null;
const saveWalletDatabaseDebounced = () => {
  if (walletDbSaveTimer) clearTimeout(walletDbSaveTimer);
  walletDbSaveTimer = setTimeout(persistWalletDatabase, 500);
};

const updateWalletEntry = (address, updates) => {
  const existing = walletDatabase.get(address) || { address };
  const merged = { ...existing, ...updates, address };
  walletDatabase.set(address, merged);
  saveWalletDatabaseDebounced();
  if (fbAvailable()) {
    fbSet('wallets', address, merged).catch(() => {});
  }
};

// walletDatabase loaded async in initData()

// ── Backfill wallet database from existing data (sync: scoreHistory + coinBalances) ──
const backfillWalletDatabaseSync = () => {
  if (walletDatabase.size > 0) return; // already has data
  let count = 0;
  for (const [address, hist] of scoreHistory) {
    const scores = hist.scores || [];
    walletDatabase.set(address, {
      address,
      firstSeenAt: scores.length > 0 ? scores[scores.length - 1]?.date : new Date().toISOString(),
      lastSeenAt: hist.lastUpdated || new Date().toISOString(),
      scanCount: scores.length,
      score: scores[0]?.score || 0,
      tier: scores[0]?.tier || 'unknown',
      coins: getCoinBalance(address),
      source: 'backfill-local',
    });
    count++;
  }
  for (const [address] of coinBalances) {
    if (!walletDatabase.has(address) && address !== 'anonymous') {
      walletDatabase.set(address, {
        address,
        coins: getCoinBalance(address),
        source: 'backfill-local',
      });
      count++;
    }
  }
  for (const address of mintedAddresses) {
    const w = walletDatabase.get(address) || { address, source: 'backfill-local' };
    if (!w.mint) w.mint = { minted: true, mintedAt: null, assetId: null, txSignature: null, metadataUri: '', remints: 0, lastRemintAt: null };
    walletDatabase.set(address, w);
  }
  if (count > 0) {
    persistWalletDatabase();
    console.log(`[wallet-db] Backfilled ${count} wallets from local data`);
  }
};
// backfillWalletDatabaseSync called from initData()

// ── Async init: load data from Firestore (fallback JSON) ──
const initData = async () => {
  await loadCoinBalances();
  loadMintedAddresses();
  await loadScoreHistory();
  await loadWalletDatabase();
  backfillWalletDatabaseSync();
};

// ── Async backfill: DAS API + sybil batch (runs after server start) ──
const backfillWalletDatabaseAsync = async () => {
  // 8b: Fetch all NFTs from collection via DAS API getAssetsByGroup
  if (!CORE_COLLECTION) {
    console.log('[wallet-db] Skipping DAS backfill: CORE_COLLECTION not set');
    return;
  }
  const rpcUrl = getRpcUrl('backfill');
  if (!rpcUrl) return;

  console.log('[wallet-db] Starting async DAS backfill...');
  let dasCount = 0;
  try {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const dasRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: `backfill-${page}`,
          method: 'getAssetsByGroup',
          params: { groupKey: 'collection', groupValue: CORE_COLLECTION, page, limit: 1000 },
        }),
      });
      const dasJson = await dasRes.json();
      const items = dasJson?.result?.items || [];
      if (items.length === 0) { hasMore = false; break; }

      for (const item of items) {
        const owner = item.ownership?.owner;
        if (!owner) continue;
        const assetId = item.id;
        const attrs = item.content?.metadata?.attributes || [];
        const attrMap = {};
        for (const a of attrs) attrMap[a.trait_type] = a.value;

        const w = walletDatabase.get(owner) || { address: owner, source: 'backfill-das' };
        w.mint = {
          minted: true,
          assetId,
          mintedAt: w.mint?.mintedAt || null,
          txSignature: w.mint?.txSignature || null,
          metadataUri: item.content?.json_uri || w.mint?.metadataUri || '',
          remints: w.mint?.remints || 0,
          lastRemintAt: w.mint?.lastRemintAt || null,
        };
        if (attrMap['Score'] != null) w.score = parseInt(attrMap['Score'], 10) || w.score;
        if (attrMap['Tier']) w.tier = attrMap['Tier'];
        if (!w.stats) {
          w.stats = {
            nfts: parseInt(attrMap['NFTs'], 10) || 0,
            tokens: parseInt(attrMap['Tokens'], 10) || 0,
            transactions: parseInt(attrMap['Transactions'], 10) || 0,
            walletAgeYears: Math.floor((parseInt(attrMap['Wallet Age (days)'], 10) || 0) / 365),
          };
        }
        walletDatabase.set(owner, w);
        dasCount++;
      }
      if (items.length < 1000) hasMore = false;
      else page++;
    }
    if (dasCount > 0) {
      persistWalletDatabase();
      console.log(`[wallet-db] DAS backfill: enriched ${dasCount} wallet entries`);
    }
  } catch (err) {
    console.warn('[wallet-db] DAS backfill failed', err.message || err);
  }

  // 8c: Batch sybil analysis for wallets without sybil data (throttled 2 req/sec)
  const walletsNeedingSybil = [];
  for (const [addr, w] of walletDatabase) {
    if (!w.sybil && addr.length >= 32) walletsNeedingSybil.push(addr);
  }
  if (walletsNeedingSybil.length > 0) {
    console.log(`[wallet-db] Sybil backfill: ${walletsNeedingSybil.length} wallets need analysis`);
    let sybilCount = 0;
    for (const addr of walletsNeedingSybil) {
      try {
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) continue;
        const sybilRes = await fetch(`http://127.0.0.1:${PORT}/api/sybil/analysis?address=${encodeURIComponent(addr)}`);
        if (sybilRes.ok) sybilCount++;
      } catch { /* ignore individual failures */ }
      // Throttle: 500ms between requests (2 req/sec)
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[wallet-db] Sybil backfill complete: ${sybilCount}/${walletsNeedingSybil.length} analyzed`);
  }
};

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
  const obj = {};
  for (const [k, v] of achievementData) {
    obj[k] = { unlocked: [...v.unlocked], claimed: [...v.claimed] };
  }
  const tmp = ACHIEVEMENTS_STORE_FILE + '.tmp';
  fs.promises.writeFile(tmp, JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), data: obj }, null, 2), 'utf8')
    .then(() => fs.promises.rename(tmp, ACHIEVEMENTS_STORE_FILE))
    .catch(err => console.warn('[achievements] Failed to persist', err));
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

loadAchievementData();

// ── Server-side Free Revive tracking (3 per day per game mode, requires minted ID) ──
const REVIVES_STORE_FILE = path.join(METADATA_DIR, 'revive-usage.json');
const FREE_REVIVES_PER_DAY = 3;
// address -> { orbit: { date: 'YYYY-MM-DD', used: number }, destroyer: { ... }, gravity: { ... } }
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
  const obj = {};
  for (const [k, v] of reviveData) obj[k] = v;
  const tmp = REVIVES_STORE_FILE + '.tmp';
  fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data: obj }, null, 2), 'utf8')
    .then(() => fs.promises.rename(tmp, REVIVES_STORE_FILE))
    .catch(err => console.warn('[revives] Failed to persist', err));
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

// ═══════════════════════════════════════════════════════════════════════════
// Quest Progress Store
// ═══════════════════════════════════════════════════════════════════════════
const QUEST_PROGRESS_FILE = path.join(METADATA_DIR, 'quest-progress.json');
const questProgress = new Map();
try {
  if (fs.existsSync(QUEST_PROGRESS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(QUEST_PROGRESS_FILE, 'utf8'));
    if (raw.data) for (const [k, v] of Object.entries(raw.data)) questProgress.set(k, v);
    console.log(`[quests] Loaded ${questProgress.size} quest records`);
  }
} catch {}
const persistQuestProgress = () => {
  const obj = {};
  for (const [k, v] of questProgress) obj[k] = v;
  const tmp = QUEST_PROGRESS_FILE + '.tmp';
  fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data: obj }, null, 2), 'utf8')
    .then(() => fs.promises.rename(tmp, QUEST_PROGRESS_FILE))
    .catch(err => console.warn('[quests] Failed to persist', err));
};

// ═══════════════════════════════════════════════════════════════════════════
// Composite Score Engine (0-1000)
// ═══════════════════════════════════════════════════════════════════════════
const COMPOSITE_TIER_MAP = [
  [99, 'mercury'], [219, 'mars'], [349, 'venus'], [479, 'earth'],
  [599, 'neptune'], [699, 'uranus'], [799, 'saturn'], [879, 'jupiter'],
  [949, 'sun'], [Infinity, 'binary_sun'],
];

function getCompositeTier(score) {
  if (!Number.isFinite(score) || score < 0) return 'mercury';
  for (const [threshold, tier] of COMPOSITE_TIER_MAP) {
    if (score <= threshold) return tier;
  }
  return 'binary_sun';
}

function calculateCompositeScore(input) {
  const {
    onchainScore = 0, trustScore = 0, riskScore = 0,
    walletAgeDays = 0, txCount = 0, nftCount = 0, solBalance = 0, defiProtoCount = 0,
    gameScores = [], gameTypes = new Set(), achievementCount = 0,
    challengesWon = 0, constellationExplored = 0, compareCount = 0,
    questsCompleted = 0, streakDays = 0, scanCount = 0,
    hasSeeker = false, hasPreorder = false, hasCombo = false, sybilVerdict = null, scoreBreakdown = null,
  } = input;

  // ── Badge evaluation (same conditions as client-side getBadgeItems) ──
  // On-chain badges (5) — on-chain score already includes badge pts from scoring.js
  // No extra bonus here to avoid double-counting

  const safeTrust = Number.isFinite(trustScore) ? Math.max(0, Math.min(100, trustScore)) : 0;
  const recovery = input.trustRecovery || {};
  const requestedRecoveryBonus = Math.min(25,
    (recovery.twitterBonus || 0) +    // max 12
    (recovery.activityBonus || 0) +   // max 8
    (recovery.crossVerifBonus || 0),  // max 5
  );
  const compositeTrust = getCompositeTrustProfile({
    verdict: sybilVerdict,
    trustScore: safeTrust,
    recoveryBonus: requestedRecoveryBonus,
  });
  const adjustedTrust = compositeTrust.effectiveTrust;

  // Sybil Trust badges (3) — bonus 10 pts each (require full sybil analysis)
  const sybilAnalyzed = input.sybilAnalyzed === true;
  const sybilBadgeEligible = sybilAnalyzed && compositeTrust.allowBadges;
  const badge_verifiedHuman = sybilBadgeEligible && safeTrust >= 80;
  const badge_cleanRecord = sybilBadgeEligible && safeTrust >= 50 && riskScore < 10;
  const badge_trustPillar = sybilBadgeEligible && safeTrust >= 95;
  const sybilBadgeBonus = (badge_verifiedHuman ? 10 : 0) + (badge_cleanRecord ? 10 : 0) + (badge_trustPillar ? 10 : 0);

  // Human Proof badges (3) — bonus 10 pts each
  const validGameScores = gameScores.filter(Number.isFinite);
  const gameScoreTotal = validGameScores.length > 0
    ? Math.min(80, Math.round(Math.log2(1 + validGameScores.reduce((a, b) => a + b, 0)) * 8))
    : 0;
  const gameTypesCount = gameTypes.size;
  const badge_gameMaster = gameTypesCount >= 3;
  const badge_achievementHunter = achievementCount >= 10;
  const badge_highScorer = gameScoreTotal >= 40;
  const humanBadgeBonus = (badge_gameMaster ? 10 : 0) + (badge_achievementHunter ? 10 : 0) + (badge_highScorer ? 10 : 0);

  // Social badges (3) — bonus 8 pts each
  const badge_arenaChampion = challengesWon >= 5;
  const badge_starNavigator = constellationExplored >= 10;
  const badge_debateKing = compareCount >= 10;
  const socialBadgeBonus = (badge_arenaChampion ? 8 : 0) + (badge_starNavigator ? 8 : 0) + (badge_debateKing ? 8 : 0);

  // Engagement badges (3) — bonus 8 pts each
  const badge_questHunter = questsCompleted >= 10;
  const badge_streakLord = streakDays >= 7;
  const badge_explorer = scanCount >= 20;
  const engagementBadgeBonus = (badge_questHunter ? 8 : 0) + (badge_streakLord ? 8 : 0) + (badge_explorer ? 8 : 0);

  // ── Category scores ──
  // On-chain (40%, max 400) — scoring.js already outputs 0-400 directly
  const onchain = Math.min(400, onchainScore);
  const basePts = onchain;

  // Sybil Trust (25%, max 250) — verdict-aware trust floor/ceiling for composite only
  const recoveryBonus = compositeTrust.recoveryBonus;
  const sybilBase = Math.round((adjustedTrust / 100) * 250);
  const sybilTrust = Math.min(250, Math.max(0, sybilBase + sybilBadgeBonus));

  // Human Proof (15%, max 150)
  const gameDiversity = Math.min(30, gameTypesCount * 5);
  const achievementPts = Math.min(40, achievementCount * 5);
  const humanProof = Math.min(150, gameScoreTotal + gameDiversity + achievementPts + humanBadgeBonus);

  // Social (10%, max 100) — base activities capped at 76 so badge bonuses (up to 24) always matter
  const challengePts = Math.min(32, challengesWon * 4);
  const constellationPts = Math.min(28, constellationExplored * 2);
  const comparePts = Math.min(16, compareCount * 2);
  const social = Math.min(100, challengePts + constellationPts + comparePts + socialBadgeBonus);

  // Engagement (10%, max 100) — base activities capped at 76 so badge bonuses (up to 24) always matter
  const questPts = Math.min(40, questsCompleted * 2);
  const streakPts = Math.min(22, streakDays * 2);
  const scanPts = Math.min(14, scanCount > 0 ? Math.round(Math.log2(1 + scanCount) * 4) : 0);
  const engagement = Math.min(100, questPts + streakPts + scanPts + engagementBadgeBonus);

  const total = Math.min(1000, onchain + sybilTrust + humanProof + social + engagement);
  const tier = getCompositeTier(total);

  return {
    compositeScore: total,
    compositeTier: tier,
    breakdown: { onchain, sybilTrust, humanProof, social, engagement },
    details: {
      onchain: { identityScore: onchainScore, identityMax: 400, basePts, badgeBonus: 0, hasSeeker, hasPreorder, hasCombo, scoreBreakdown },
      sybilTrust: {
        trustScore: safeTrust,
        rawTrustScore: compositeTrust.rawTrustScore,
        baseCompositeTrust: compositeTrust.baseCompositeTrust,
        adjustedTrust,
        effectiveTrust: compositeTrust.effectiveTrust,
        verdictKey: compositeTrust.verdictKey,
        verdictLabel: compositeTrust.verdictLabel,
        verdictAdjustment: compositeTrust.verdictAdjustment,
        trustMax: 100,
        badgeBonus: sybilBadgeBonus,
        recoveryBonus,
        recoveryCap: compositeTrust.recoveryCap,
        recoveryBreakdown: recovery,
      },
      humanProof: { gameScoreTotal, gameDiversity, achievementPts, achievementCount, gameTypesCount, badgeBonus: humanBadgeBonus },
      social: { challengesWon, challengePts, constellationExplored, constellationPts, compareCount, comparePts, badgeBonus: socialBadgeBonus },
      engagement: { questsCompleted, questPts, streakDays, streakPts, scanCount, scanPts, badgeBonus: engagementBadgeBonus },
    },
  };
}

// ── Trust Recovery: compute bonus from Twitter verification + in-app activity ──
const twitterWalletMap = new Map(); // twitterUserId → walletAddress (1:1 dedup)

// Rebuild twitterWalletMap from walletDatabase on startup
function rebuildTwitterWalletMap() {
  twitterWalletMap.clear();
  for (const [addr, entry] of walletDatabase) {
    const tw = entry.trustRecovery?.twitter;
    if (tw?.verified && tw.userId) twitterWalletMap.set(tw.userId, addr);
  }
}

function computeTrustRecovery(address, activityData) {
  const entry = walletDatabase.get(address) || {};
  const rd = entry.trustRecovery || {};

  // 1. Twitter bonus (max 12)
  let twitterBonus = 0;
  const tw = rd.twitter;
  if (tw?.verified && !tw.suspended) {
    twitterBonus = 3; // base link bonus
    const ageYears = (tw.accountAgeDays || 0) / 365;
    if (ageYears >= 3) twitterBonus += 4;
    else if (ageYears >= 1) twitterBonus += 2;
    if ((tw.followers || 0) >= 500) twitterBonus += 3;
    else if ((tw.followers || 0) >= 50) twitterBonus += 1;
    if ((tw.tweets || 0) >= 1000) twitterBonus += 2;
    else if ((tw.tweets || 0) >= 100) twitterBonus += 1;
    twitterBonus = Math.min(12, twitterBonus);
  }

  // 2. Activity bonus (max 8) — computed from existing data
  let activityBonus = 0;
  const a = activityData || {};
  if ((a.gameTypesCount || 0) >= 3) activityBonus += 1;
  if ((a.achievementCount || 0) >= 15) activityBonus += 2;
  else if ((a.achievementCount || 0) >= 5) activityBonus += 1;
  if ((a.questsCompleted || 0) >= 5) activityBonus += 1;
  if ((a.streakDays || 0) >= 7) activityBonus += 1;
  if ((a.scanCount || 0) >= 10) activityBonus += 1;
  if ((a.challengesWon || 0) >= 3) activityBonus += 1;
  if ((a.totalCoinsEarned || 0) >= 500) activityBonus += 1;
  activityBonus = Math.min(8, activityBonus);

  // 3. Cross-verification bonus (max 5) — requires multiple methods
  let crossVerifBonus = 0;
  if (twitterBonus >= 3 && activityBonus >= 5) crossVerifBonus = 3;
  else if (twitterBonus >= 3 && activityBonus >= 3) crossVerifBonus = 2;
  else if (twitterBonus >= 3 && activityBonus >= 1) crossVerifBonus = 1;
  // Extra for really strong Twitter + full activity
  if (twitterBonus >= 8 && activityBonus >= 6) crossVerifBonus = 5;

  return { twitterBonus, activityBonus, crossVerifBonus };
}

function buildCompositeInput(address) {
  const walletEntry = walletDatabase.get(address) || {};
  const scoreBreakdown = walletEntry.scoreBreakdown || null;
  // Prefer sum from current scoreBreakdown (max 400) over legacy entry.score (may be from old 1000-scale system)
  let onchainScore = walletEntry.score || 0;
  if (scoreBreakdown && scoreBreakdown.solBalance && scoreBreakdown.solBalance.max === 40) {
    // Current scoring system — sum pts from breakdown for accurate on-chain score
    let sbSum = 0;
    for (const v of Object.values(scoreBreakdown)) {
      if (v && typeof v === 'object' && typeof v.pts === 'number') sbSum += v.pts;
    }
    onchainScore = Math.min(400, sbSum);
  } else if (onchainScore > 400) {
    onchainScore = 400; // legacy score, just cap
  }
  const trustScore = walletEntry.sybil?.trustScore || 0;
  const socialStats = walletEntry.socialStats || {};

  // Game scores from leaderboard
  const playerEntries = leaderboardEntries.filter(e => e.address === address);
  const gameScores = playerEntries.map(e => e.score || 0);
  const gameTypes = new Set(playerEntries.map(e => e.gameType || 'orbit'));

  // Achievements
  const achEntry = achievementData.get(address);
  const achievementCount = achEntry ? achEntry.unlocked.size : 0;

  // Quest progress
  const qp = questProgress.get(address);
  let questsCompleted = 0;
  let streakDays = 0;
  if (qp && qp.quests) {
    for (const q of Object.values(qp.quests)) {
      if (q.completed) questsCompleted++;
    }
    streakDays = qp.streakDays || 0;
  }

  const traits = walletEntry.traits || {};
  const stats = walletEntry.stats || {};
  const sybil = walletEntry.sybil || {};
  const sybilVerdict = sybil.verdict || (sybil.verdictKey ? getSybilQuickVerdict(sybil) : null);
  return {
    onchainScore,
    trustScore,
    riskScore: sybil.riskScore || 0,
    sybilAnalyzed: Boolean(sybil.updatedAt),
    sybilVerdict,
    walletAgeDays: stats.walletAgeDays || (traits.walletAgeDays ?? 0),
    txCount: stats.transactions || (traits.txCount ?? 0),
    nftCount: stats.nfts || (traits.nftCount ?? 0),
    solBalance: stats.solBalance || (traits.solBalance ?? 0),
    defiProtoCount: Array.isArray(traits.defiProtocols) ? traits.defiProtocols.length : 0,
    gameScores,
    gameTypes,
    achievementCount,
    // challengesWon: use authoritative challenges array (socialStats can be stale)
    // constellationExplored, compareCount, scanCount: only source is socialStats/walletEntry
    challengesWon: challenges.filter(c => c.status === 'completed' && c.winner === address).length,
    constellationExplored: socialStats.constellationExplored || 0,
    compareCount: socialStats.compareCount || 0,
    questsCompleted,
    streakDays,
    scanCount: walletEntry.scanCount || 0,
    hasSeeker: Boolean(traits.hasSeeker),
    hasPreorder: Boolean(traits.hasPreorder),
    hasCombo: Boolean(traits.hasCombo),
    scoreBreakdown,
    trustRecovery: computeTrustRecovery(address, {
      gameTypesCount: gameTypes.size,
      achievementCount,
      questsCompleted,
      streakDays,
      scanCount: walletEntry.scanCount || 0,
      challengesWon: challenges.filter(c => c.status === 'completed' && c.winner === address).length,
      totalCoinsEarned: getCoinBalance(address),
    }),
  };
}

function triggerCompositeUpdate(address) {
  try {
    const input = buildCompositeInput(address);
    const result = calculateCompositeScore(input);
    const existing = walletDatabase.get(address) || {};
    existing.composite = result;
    walletDatabase.set(address, existing);
    saveWalletDatabaseDebounced();
    if (fbAvailable()) {
      fbSet('wallets', address, existing).catch(() => {});
    }
  } catch (err) {
    console.warn('[composite] Failed to update for', address, err.message);
  }
}

async function backfillCompositeScores() {
  let count = 0;
  let recalculated = 0;
  for (const [address, entry] of walletDatabase) {
    // If wallet has a score but no/stale scoreBreakdown, generate approximate breakdown from stats
    // ONLY sets scoreBreakdown — does NOT overwrite score/tier/badges (those need a full scan)
    // Detect old scoring system: current system has solBalance.max=40, old had 100+
    const sbStale = entry.scoreBreakdown && (
      (entry.scoreBreakdown.solBalance?.max || 0) !== 40
      || entry.scoreBreakdown.behavioral
    );
    // Also recalculate if score exceeds current max (400) — legacy data
    const scoreLegacy = entry.score > 400;
    if (entry.score > 0 && (!entry.scoreBreakdown || sbStale || scoreLegacy) && entry.stats) {
      try {
        const s = entry.stats;
        const firstTxTime = entry.firstTxTimestamp || (s.walletAgeYears > 0 ? Date.now() - s.walletAgeYears * 365 * 86400000 : 0);
        const badges = entry.badges || [];
        const extraTraits = {
          hasSeeker: badges.includes('seeker'),
          hasPreorder: badges.includes('visionary'),
          swapCount: 0, nftTradeCount: 0, stakingCount: 0, defiProtocols: [],
          ...(entry.traits || {}),
        };
        const identity = calculateIdentity(
          s.transactions || 0,
          firstTxTime,
          s.solBalance || 0,
          s.tokens || 0,
          s.nfts || 0,
          extraTraits,
        );
        // Set scoreBreakdown + sync score/tier/badges to current scoring system
        entry.scoreBreakdown = identity.scoreBreakdown;
        entry.score = identity.score;
        entry.tier = identity.tier;
        entry.badges = identity.badges;
        walletDatabase.set(address, entry);
        recalculated++;
      } catch (err) {
        console.warn(`[composite] Failed to recalculate identity for ${address.slice(0, 8)}:`, err.message);
      }
    }
    triggerCompositeUpdate(address);
    count++;
    // Yield to event loop every 50 wallets to avoid blocking + Firestore write storm
    if (count % 50 === 0) await new Promise(r => setTimeout(r, 100));
  }
  console.log(`[composite] Backfilled ${count} wallets (recalculated ${recalculated} identities)`);
  // One-time cleanup: validate socialStats against authoritative sources
  let cleaned = 0;
  for (const [addr, entry] of walletDatabase) {
    const ss = entry.socialStats;
    if (!ss) continue;
    const realChallengeWins = challenges.filter(c => c.status === 'completed' && c.winner === addr).length;
    if ((ss.challengesWon || 0) > realChallengeWins) {
      ss.challengesWon = realChallengeWins;
      cleaned++;
    }
    // constellation and compare: cap at reasonable max (no user can do 50+ compares organically in early stage)
    if ((ss.constellationExplored || 0) > 20) { ss.constellationExplored = 0; cleaned++; }
    if ((ss.compareCount || 0) > 20) { ss.compareCount = 0; cleaned++; }
  }
  if (cleaned > 0) {
    console.log(`[cleanup] Fixed ${cleaned} suspicious socialStats entries`);
    saveWalletDatabaseDebounced();
    // Recalculate composite for affected wallets
    for (const [addr] of walletDatabase) { try { triggerCompositeUpdate(addr); } catch {} }
  }
  rebuildTwitterWalletMap();
  if (twitterWalletMap.size > 0) console.log(`[recovery] ${twitterWalletMap.size} Twitter-linked wallets`);
}

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
  const apiKey = pickHeliusKey(seed);
  if (!apiKey) return ALCHEMY_RPC_URL || FALLBACK_RPC_URL || 'https://api.mainnet-beta.solana.com';
  return buildRpcUrl(apiKey);
};

const getRpcUrls = (seed) => {
  if (!HELIUS_KEYS.length) {
    const fallbackUrl = buildRpcUrl(null) || ALCHEMY_RPC_URL || FALLBACK_RPC_URL || 'https://api.mainnet-beta.solana.com';
    return fallbackUrl ? [fallbackUrl] : [];
  }
  const startIndex = Math.max(0, getHeliusKeyIndex(seed));
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
};

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB hard limit
const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      req.destroy();
      reject(new Error('Request body too large'));
      return;
    }
    data += chunk;
  });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

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

const respondJson = (res, status, payload) => {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  const acceptEncoding = String(res.req?.headers?.['accept-encoding'] ?? '');
  if (body.length > 256 && acceptEncoding.includes('gzip')) {
    zlib.gzip(Buffer.from(body), (err, compressed) => {
      if (res.headersSent) return;
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
  const MAX_SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
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
// These are simplified versions of the current (v2) handlers.
// They write to the SAME data stores — no separate state.

// a) GET /api/game/leaderboard — v1 shim: map legacy gameType aliases → canonical names
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

// b) POST /api/game/leaderboard — v1: accepts body.address, no JWT/session required
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

// c) POST /api/game/coins — v1: accept body.address OR JWT, no session proof
async function handleGameCoinsV1(req, res, url) {
  if (!ipRateLimit('game_coins_post', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw);
    const { address: bodyAddr, delta, mode } = parsed;
    // Accept JWT if provided, else fall back to body.address (old APK may not send JWT)
    // Use optionalJwt so an invalid/missing token never auto-sends a 401
    let addr = bodyAddr;
    const _jwtV1 = optionalJwt(req, null);
    if (_jwtV1.ok && _jwtV1.address) {
      addr = _jwtV1.address;
      if (bodyAddr && bodyAddr !== addr) return respondJson(res, 403, { error: 'Address mismatch' });
    }
    if (!addr || typeof addr !== 'string') return respondJson(res, 400, { error: 'address required' });
    if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0 || !Number.isInteger(delta)) {
      return respondJson(res, 400, { error: 'delta (non-zero integer) required' });
    }
    if (delta > 0) {
      const gameMode = mode || 'orbit';
      const todayCoins = getGameCoinsToday(addr);
      if (todayCoins >= DAILY_GAME_COIN_CAP) {
        return respondJson(res, 200, { address: addr, coins: getCoinBalance(addr), capped: true, dailyRemaining: 0 });
      }
      let baseDelta = Math.min(delta, DAILY_GAME_COIN_CAP - todayCoins);
      addGameCoinsToday(addr, baseDelta);
      const boost = getStakingBoost(addr);
      const effectiveDelta = boost > 0 ? Math.floor(baseDelta * (1 + boost)) : baseDelta;
      const newBalance = getCoinBalance(addr) + effectiveDelta;
      setCoinBalance(addr, newBalance);
      addCoinEarned(addr, effectiveDelta);
      return respondJson(res, 200, {
        address: addr,
        coins: newBalance,
        earned: effectiveDelta,
        dailyRemaining: Math.max(0, DAILY_GAME_COIN_CAP - getGameCoinsToday(addr)),
      });
    } else {
      const absDelta = Math.abs(delta);
      const current = getCoinBalance(addr);
      if (current < absDelta) return respondJson(res, 400, { error: 'Insufficient balance' });
      setCoinBalance(addr, current - absDelta);
      addCoinSpent(addr, absDelta);
      return respondJson(res, 200, { address: addr, coins: getCoinBalance(addr) });
    }
  } catch {
    respondJson(res, 400, { error: 'Invalid JSON body' });
  }
}

// d) GET /api/game/revives — v1: no holder gate, always eligible=true
async function handleRevivesGetV1(req, res, url) {
  if (!ipRateLimit('game_rev', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
  const addr = url.searchParams.get('address') || '';
  const mode = url.searchParams.get('mode') || 'orbit';
  if (!addr) return respondJson(res, 400, { error: 'address query param required' });
  if (mode !== 'orbit' && mode !== 'destroyer' && mode !== 'gravity') {
    return respondJson(res, 400, { error: 'mode must be orbit, destroyer, or gravity' });
  }
  const left = getRevivesLeft(addr, mode);
  respondJson(res, 200, { address: addr, mode, left, max: FREE_REVIVES_PER_DAY, eligible: true });
}

// e) POST /api/game/revives — v1: allow for everyone, no holder check
async function handleRevivesPostV1(req, res, url) {
  if (!ipRateLimit('revive_post', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw);
    const { address: addr, mode } = parsed;
    if (!addr || typeof addr !== 'string') return respondJson(res, 400, { error: 'address (string) required' });
    if (mode !== 'orbit' && mode !== 'destroyer' && mode !== 'gravity') {
      return respondJson(res, 400, { error: 'mode must be orbit, destroyer, or gravity' });
    }
    const success = useRevive(addr, mode);
    if (!success) {
      const left = getRevivesLeft(addr, mode);
      return respondJson(res, 429, { error: 'No free revives left today', left, max: FREE_REVIVES_PER_DAY });
    }
    const left = getRevivesLeft(addr, mode);
    respondJson(res, 200, { address: addr, mode, success: true, left, max: FREE_REVIVES_PER_DAY });
  } catch {
    respondJson(res, 400, { error: 'Invalid JSON body' });
  }
}

// f) POST /api/prism/earn — v1: simplified, no cooldowns for scan_wallet, accept client amount
async function handlePrismEarnV1(req, res, url) {
  if (!ipRateLimit('prism_earn', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
  try {
    const {
      address,
      source,
      amount,
      description,
    } = JSON.parse(await readBody(req));
    if (!address || !amount) return respondJson(res, 400, { error: 'address and amount required' });
    const MAX_EARN_PER_CALL = { game_orbit: 50, game_defender: 50, game_gravity: 50, scan_wallet: 5, achievement: 50, quest_daily: 15, quest_weekly: 50, quest_milestone: 100, challenge_win: 30, first_mint: 100, referral: 20, text_quest: 1200, sybil_hunt: 70 };
    if (!source || !MAX_EARN_PER_CALL[source]) return respondJson(res, 400, { error: 'Invalid earn source' });
    const maxAllowed = MAX_EARN_PER_CALL[source];
    if (!Number.isFinite(Number(amount)) || Number(amount) > maxAllowed) return respondJson(res, 400, { error: `Max ${maxAllowed} Coins per ${source}` });
    let earned = Math.max(0, Math.floor(Number(amount)));
    if (earned <= 0) return respondJson(res, 400, { error: 'amount must be positive' });
    // Apply daily caps (same caps as v2)
    const GAME_EARN_SOURCES = new Set(['game_orbit', 'game_defender', 'game_gravity']);
    if (GAME_EARN_SOURCES.has(source)) {
      const todayCoins = getGameCoinsToday(address);
      if (todayCoins >= DAILY_GAME_COIN_CAP) return respondJson(res, 429, { error: 'Daily game coin cap reached', dailyRemaining: 0 });
      let baseDelta = Math.min(earned, DAILY_GAME_COIN_CAP - todayCoins);
      addGameCoinsToday(address, baseDelta);
      const gameBoost = getStakingBoost(address);
      earned = gameBoost > 0 ? Math.floor(baseDelta * (1 + gameBoost)) : baseDelta;
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const ngKey = `nongame_daily:${address}`;
      const ngEntry = prismEarnRateLimit.get(ngKey);
      let ngEarned = (ngEntry && typeof ngEntry === 'object' && ngEntry.date === today) ? (ngEntry.total || 0) : 0;
      if (ngEarned >= NON_GAME_DAILY_EARN_CAP) return respondJson(res, 429, { error: 'Daily earn cap reached', dailyRemaining: 0 });
      earned = Math.min(earned, NON_GAME_DAILY_EARN_CAP - ngEarned);
      prismEarnRateLimit.set(ngKey, { date: today, total: ngEarned + earned });
      const earnBoost = getStakingBoost(address);
      if (earnBoost > 0) earned = Math.floor(earned * (1 + earnBoost));
    }
    const prevBal = getCoinBalance(address);
    const newBal = prevBal + earned;
    setCoinBalance(address, newBal);
    addCoinEarned(address, earned);
    const wEarn = walletDatabase.get(address);
    if (wEarn) { wEarn.coins = newBal; saveWalletDatabaseDebounced(); }
    const bal = getPrismBalance(address);
    const tx = {
      id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      address, amount: earned, type: 'earn', source: source || 'unknown',
      description: description || `Earned ${earned} Coins`,
      timestamp: new Date().toISOString(),
    };
    const txs = prismTransactions.get(address) || [];
    txs.unshift(tx);
    if (txs.length > 500) txs.length = 500;
    prismTransactions.set(address, txs);
    debouncedSavePrism();
    respondJson(res, 200, { balance: bal, earned });
  } catch { respondJson(res, 400, { error: 'Invalid request body' }); }
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
    // V1: intercept only the 6 breaking routes — everything else falls through
    const V1_HANDLERS = {
      'GET /api/game/leaderboard': handleGameLeaderboardGetV1,
      'POST /api/game/leaderboard': handleGameLeaderboardV1,
      'POST /api/game/coins': handleGameCoinsV1,
      'GET /api/game/revives': handleRevivesGetV1,
      'POST /api/game/revives': handleRevivesPostV1,
      'POST /api/prism/earn': handlePrismEarnV1,
    };
    const v1Key = `${req.method} ${pathname}`;
    if (V1_HANDLERS[v1Key]) return V1_HANDLERS[v1Key](req, res, url);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // GET /api/migration-status?address=X  (accessed via /api/v2/migration-status)
  // Returns _v2MigrationResult for the address if it was just migrated, else { migrated: false }
  if (pathname === '/api/migration-status' && req.method === 'GET') {
    const addr = String(url.searchParams.get('address') ?? '').trim();
    if (!addr) return respondJson(res, 400, { error: 'address required' });
    const walletEntry = walletDatabase.get(addr);
    if (!walletEntry || !walletEntry._v2MigrationResult) {
      return respondJson(res, 200, { migrated: false });
    }
    const result = walletEntry._v2MigrationResult;
    // Clear after reading so it only shows once
    delete walletEntry._v2MigrationResult;
    walletDatabase.set(addr, walletEntry);
    saveWalletDatabaseDebounced();
    return respondJson(res, 200, { migrated: true, migrationData: result });
  }

  if (pathname === '/api/market/collection-stats' && req.method === 'GET') {
    if (!ipRateLimit('mkt_colstats', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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
      respondJson(res, 500, { status: 'unknown', floorSol: null, error: 'Failed to fetch collection stats' });
      return;
    }
  }

  // ── Auth: issue challenge nonce ──
  if (pathname === '/api/auth/challenge' && req.method === 'POST') {
    // Rate limit: 6 challenges per minute per IP
    const challengeIp = getClientIp(req);
    const challengeRlKey = `authChallenge:${challengeIp}`;
    const lastChallengeTs = prismEarnRateLimit.get(challengeRlKey) || 0;
    if (Date.now() - lastChallengeTs < 3_000) return respondJson(res, 429, { error: 'Too many auth challenges, try again later' });
    prismEarnRateLimit.set(challengeRlKey, Date.now());
    try {
      const body = await readBody(req);
      const parsed = safeParseJson(body);
      const address = typeof parsed?.address === 'string' ? parsed.address.trim() : '';
      if (!address) { respondJson(res, 400, { error: 'address required' }); return; }
      try { new PublicKey(address); } catch { respondJson(res, 400, { error: 'Invalid address' }); return; }
      const nonce = crypto.randomBytes(16).toString('hex');
      const message = `Identity Prism auth\nAddress: ${address}\nNonce: ${nonce}`;
      authChallenges.set(nonce, { address, message, expiresAt: Date.now() + AUTH_CHALLENGE_TTL_MS });
      respondJson(res, 200, { nonce, message });
    } catch (e) {
      respondJson(res, 500, { error: 'Challenge failed' });
    }
    return;
  }

  // ── Auth: verify signature, issue JWT ──
  if (pathname === '/api/auth/token' && req.method === 'POST') {
    const rlIp = getClientIp(req);
    const rlKey = `authToken:${rlIp}`;
    const lastAuth = reputationRateLimit.get(rlKey) || 0;
    if (Date.now() - lastAuth < 5000) {
      return respondJson(res, 429, { error: 'Rate limited — 5s cooldown' });
    }
    reputationRateLimit.set(rlKey, Date.now());
    try {
      const parsed = safeParseJson(await readBody(req));
      const address = typeof parsed?.address === 'string' ? parsed.address.trim() : '';
      const { nonce, signature } = parsed ?? {};
      if (!address || !nonce || !signature) {
        respondJson(res, 400, { error: 'address, nonce, and signature required' }); return;
      }
      const challenge = authChallenges.get(nonce);
      if (!challenge) {
        console.warn('[auth:token] nonce not found in authChallenges. Map size:', authChallenges.size);
        respondJson(res, 401, { error: 'Invalid or expired nonce' }); return;
      }
      if (challenge.address !== address) {
        console.warn('[auth:token] address mismatch:', { expected: challenge.address.slice(0, 8), got: address.slice(0, 8) });
        respondJson(res, 401, { error: 'Address mismatch' }); return;
      }
      if (challenge.expiresAt < Date.now()) {
        authChallenges.delete(nonce);
        respondJson(res, 401, { error: 'Challenge expired' }); return;
      }
      // Use the STORED challenge message (the one wallet actually signed)
      const challengeMessage = challenge.message;
      // Also reconstruct for comparison logging
      const reconstructed = `Identity Prism auth\nAddress: ${address}\nNonce: ${nonce}`;
      const messagesMatch = challengeMessage === reconstructed;

      // Try stored message first (wallet signed THIS), then reconstructed as fallback
      let verified = verifyWalletSignature(address, challengeMessage, signature);
      if (!verified && !messagesMatch) {
        console.warn('[auth] Stored message failed, trying reconstructed...');
        verified = verifyWalletSignature(address, reconstructed, signature);
      }
      if (!verified) {
        // Log detailed info for debugging
        console.warn('[auth] Signature verification failed', {
          address: address.slice(0, 8),
          nonce: nonce.slice(0, 8),
          sigLen: signature?.length,
          sigType: typeof signature,
          sigPreview: typeof signature === 'string' ? signature.slice(0, 16) + '...' : 'N/A',
          messagesMatch,
          challengeMsgLen: challengeMessage.length,
        });
        respondJson(res, 401, { error: 'Invalid signature' }); return;
      }
      authChallenges.delete(nonce); // one-time use
      const token = jwt.sign({ address }, JWT_SECRET, { expiresIn: JWT_TTL, algorithm: 'HS256', issuer: 'identity-prism', audience: 'identity-prism-api' });
      console.info('[auth] JWT issued', { address: address.slice(0, 8) });
      respondJson(res, 200, { token, expiresIn: JWT_TTL });
    } catch (e) {
      respondJson(res, 500, { error: 'Auth failed' });
    }
    return;
  }

  // ── Reputation API ──
  // Rate limit: 1 request per second per IP for /api/reputation, /api/reputation/compare, /api/reputation/batch
  if ((pathname === '/api/reputation' || pathname === '/api/reputation/compare' || pathname === '/api/reputation/batch')
      && (req.method === 'GET' || req.method === 'POST')) {
    const rlIp = getClientIp(req);
    const rlKey = `repv1:${rlIp}`;
    const lastReq = reputationRateLimit.get(rlKey) || 0;
    if (Date.now() - lastReq < 1_000) {
      return respondJson(res, 429, { error: 'Rate limited', retryAfterMs: 1_000 - (Date.now() - lastReq) });
    }
    reputationRateLimit.set(rlKey, Date.now());
    if (reputationRateLimit.size > 5000) {
      const cutoff = Date.now() - 20_000;
      for (const [k, v] of reputationRateLimit) { if (v < cutoff) reputationRateLimit.delete(k); }
    }
  }

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
    // Fast path: return cached reputation from walletDatabase if fresh (< 60s)
    const cachedWallet = walletDatabase.get(address);
    if (cachedWallet?.lastReputationAt && Date.now() - cachedWallet.lastReputationAt < 60_000 && cachedWallet._lastReputation) {
      return respondJson(res, 200, cachedWallet._lastReputation);
    }
    try {
      const snapshot = await fetchIdentitySnapshot(address);
      const { identity, stats, walletAgeDays, solBalance, txCount, tokenCount, nftCount } = snapshot;

      // Fetch sybil trust grade in parallel (best-effort, don't fail if unavailable)
      let trustGrade = null;
      let trustScore = null;
      let riskLevel = null;
      let sybilVerdict = null;
      let topPrograms = [];
      try {
        const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
        const pubkey = new PublicKey(address);

        // Get trust data from sybil cache or compute lightweight version
        const cachedSybil = sybilCache.get(address);
        if (cachedSybil && Date.now() - cachedSybil.cachedAt < 3600_000) {
          trustGrade = cachedSybil.analysis.trustGrade;
          trustScore = cachedSybil.analysis.trustScore;
          riskLevel = cachedSybil.analysis.riskLevel;
          sybilVerdict = cachedSybil.analysis.verdict || getSybilVerdict(cachedSybil.analysis);
          topPrograms = cachedSybil.analysis.metrics?.topPrograms || [];
        } else {
          // Lightweight trust estimation — capped at 70 until full sybil analysis
          let riskPts = 0;
          if (walletAgeDays < 30) riskPts += 15;
          if (txCount < 10) riskPts += 10;
          if (solBalance < 0.01) riskPts += 8;
          if (nftCount === 0) riskPts += 5;
          if (tokenCount < 3) riskPts += 6;
          // Trust bonus
          if (walletAgeDays > 365) riskPts -= 5;
          if (tokenCount >= 10) riskPts -= 3;
          if (nftCount >= 5) riskPts -= 2;
          riskPts = Math.max(0, Math.min(100, riskPts));
          const ts = Math.min(90, Math.max(0, 100 - riskPts)); // cap 90 — A+ requires full analysis
          trustScore = ts;
          trustGrade = ts >= 90 ? 'A+' : ts >= 80 ? 'A' : ts >= 70 ? 'B' : ts >= 60 ? 'C' : ts >= 50 ? 'D' : 'F';
          riskLevel = riskPts >= 75 ? 'critical' : riskPts >= 50 ? 'high' : riskPts >= 30 ? 'medium' : riskPts >= 10 ? 'low' : 'clean';
        }

        // Fetch top interacted programs from recent transactions
        if (topPrograms.length === 0) {
          try {
            const recentSigs = await conn.getSignaturesForAddress(pubkey, { limit: 100 });
            const sigBatch = recentSigs.map(s => s.signature);
            if (sigBatch.length > 0) {
              const programCounts = new Map();
              const batchTxs = await batchGetParsedTxs(getBatchRpcUrl(address), sigBatch, { batchSize: 100 });
              for (const tx of batchTxs) {
                if (!tx?.transaction?.message?.instructions) continue;
                for (const ix of tx.transaction.message.instructions) {
                  const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
                  if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') {
                    programCounts.set(pid, (programCounts.get(pid) || 0) + 1);
                  }
                }
              }
              // Map known program IDs to human-readable names
              const PROGRAM_NAMES = {
                'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
                'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
                'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
                '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
                'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ': 'Saber',
                'mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68': 'Marinade',
                'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': 'Marinade Finance',
                'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD': 'Marinade',
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'Token Program',
                'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'ATA Program',
                'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr': 'Memo',
                'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex',
                'BGUMAp9Gq7iTEuizy4pqAxsTkFQ1XyUbSreFdn6YqwPc': 'Bubblegum',
                'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1': 'Tensor',
                'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN': 'Tensor Swap',
                'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K': 'Magic Eden V2',
                'CMZYPASGWeTz7RNGHaRJfCq2XQ5pYK6nDvVQxzkH51zb': 'Solend',
                'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': 'Phoenix',
                'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora',
                'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB': 'Phantom',
                'FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH': 'Pyth Oracle',
                'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb': 'Wormhole',
                'SSwapUtytfBdBn1b9NUGG6foMVPtcWgpRU32HToDUZr': 'Step Finance',
                'DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M': 'Jupiter DCA',
                'jCebN34bUfdeUhR6bhNixjhCSnx9CY23HsmUkT7XjVV': 'Jito',
              };
              const entries = [...programCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([pid, count]) => ({
                  programId: pid,
                  name: PROGRAM_NAMES[pid] || null,
                  interactions: count,
                }));
              topPrograms = entries;
            }
          } catch { /* ignore — non-critical */ }
        }
      } catch { /* ignore — trust data is optional */ }

      // Update walletDatabase so composite score stays in sync
      // firstTxTimestamp: persisted permanently (first tx never changes) — used by sybil to skip pagination
      const firstTxTimestamp = snapshot.firstTxTime || null;
      updateWalletEntry(address, {
        score: identity.score,
        tier: identity.tier,
        badges: identity.badges,
        scoreBreakdown: identity.scoreBreakdown,
        ...(firstTxTimestamp ? { firstTxTimestamp } : {}),
        stats: { tokens: tokenCount, nfts: nftCount, transactions: txCount, solBalance: Math.round(solBalance * 1000) / 1000, walletAgeYears: Math.floor(walletAgeDays / 365) },
      });
      triggerCompositeUpdate(address);

      const repResponse = {
        address,
        score: identity.score,
        tier: identity.tier,
        badges: identity.badges,
        scoreBreakdown: identity.scoreBreakdown,
        trustGrade,
        trustScore,
        riskLevel,
        sybilVerdict,
        topPrograms,
        stats: {
          walletAgeDays,
          solBalance: Math.round(solBalance * 1000) / 1000,
          txCount,
          tokenCount,
          nftCount,
        },
      };
      // Cache for 60s to avoid redundant RPC calls on repeated requests
      updateWalletEntry(address, { _lastReputation: repResponse, lastReputationAt: Date.now() });
      respondJson(res, 200, repResponse);
      return;
    } catch (error) {
      console.error('[reputation] failed for', address, error);
      respondJson(res, 500, { error: 'Failed to compute reputation' });
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
          const comp = (walletDatabase.get(trimmed) || {}).composite || calculateCompositeScore(buildCompositeInput(trimmed));
          results.push({
            address: trimmed,
            score: identity.score,
            tier: identity.tier,
            badges: identity.badges,
            compositeScore: comp.compositeScore,
            compositeTier: comp.compositeTier,
            stats: { walletAgeDays, solBalance: Math.round(solBalance * 1000) / 1000, txCount, tokenCount, nftCount },
          });
        } catch (error) {
          results.push({ address: trimmed, error: 'Failed to compute reputation' });
        }
      }
      respondJson(res, 200, { results });
      return;
    } catch (error) {
      respondJson(res, 500, { error: 'Failed to compute batch reputation' });
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
      const format = (snap, addr) => {
        const comp = (walletDatabase.get(addr) || {}).composite || calculateCompositeScore(buildCompositeInput(addr));
        return {
          address: addr,
          score: snap.identity.score,
          tier: snap.identity.tier,
          badges: snap.identity.badges,
          compositeScore: comp.compositeScore,
          compositeTier: comp.compositeTier,
          stats: {
            walletAgeDays: snap.walletAgeDays,
            solBalance: Math.round(snap.solBalance * 1000) / 1000,
            txCount: snap.txCount,
            tokenCount: snap.tokenCount,
            nftCount: snap.nftCount,
          },
        };
      };
      const resultA = format(snapA, a);
      const resultB = format(snapB, b);
      const diff = resultA.compositeScore - resultB.compositeScore;

      // Increment compareCount — per-pair-per-day limit (prevent inflation)
      const comparePairKey = `compare_pair:${[a, b].sort().join(':')}`;
      const compareToday = new Date().toISOString().slice(0, 10);
      const comparePairEntry = prismEarnRateLimit.get(comparePairKey);
      if (!comparePairEntry || comparePairEntry.date !== compareToday) {
        prismEarnRateLimit.set(comparePairKey, { date: compareToday });
        for (const addr of [a, b]) {
          const w = walletDatabase.get(addr) || {};
          const ss = w.socialStats || { challengesWon: 0, constellationExplored: 0, compareCount: 0 };
          ss.compareCount = (ss.compareCount || 0) + 1;
          updateWalletEntry(addr, { socialStats: ss });
        }
        triggerCompositeUpdate(a);
        triggerCompositeUpdate(b);
      }

      respondJson(res, 200, {
        wallets: [resultA, resultB],
        scoreDiff: diff,
        winner: diff > 0 ? a : diff < 0 ? b : 'tie',
      });
      return;
    } catch (error) {
      console.error('[reputation/compare] failed', error);
      respondJson(res, 500, { error: 'Failed to compare reputations' });
      return;
    }
  }

  // ── Reputation Attestation (Blink-compatible Solana Action) ──
  if (pathname === '/api/actions/attest' || pathname === '/api/reputation/attest') {
    if (!ipRateLimit('attest', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    const baseUrl = getBaseUrl(req) || PUBLIC_BASE_URL;

    if (req.method === 'GET' || req.method === 'OPTIONS') {
      const address = String(url.searchParams.get('address') ?? '').trim();
      if (!address) {
        respondJson(res, 200, {
          type: 'action',
          icon: `${baseUrl}/assets/icon.png`,
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
          title: `Attest Score: ${identity.score}/1000 — ${identity.tier.replace('_', ' ').toUpperCase()}`,
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
          message: `Reputation attestation: Score ${identity.score}/400, Tier ${identity.tier.replace('_', ' ').toUpperCase()}. This will be permanently recorded on Solana.`,
        });
        return;
      } catch (error) {
        console.error('[attest] failed', error);
        respondJson(res, 500, { error: 'Attestation failed' });
        return;
      }
    }
  }

  if (pathname === '/api/market/sol-price' && req.method === 'GET') {
    if (!ipRateLimit('mkt_sol', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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
    if (!ipRateLimit('mkt_skr', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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
    if (!ipRateLimit('mkt_jup', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const ids = url.searchParams.get('ids') || '';
    if (!ids || ids.length > 2000) {
      respondJson(res, 400, { error: 'Invalid ids parameter' });
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
    if (!ipRateLimit('mkt_quote', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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
        skrAmount: quote.amount,
        skrAmountRaw: quote.rawAmount,
      });
      return;
    } catch (error) {
      respondJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (pathname === '/api/market/swap-quote' && req.method === 'GET') {
    if (!ipRateLimit('mkt_swap_quote', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const inputMint = normalizePubkey(url.searchParams.get('inputMint'));
    const amountRaw = String(url.searchParams.get('amount') || '').trim();
    const taker = normalizePubkey(url.searchParams.get('taker'));
    if (!inputMint || !amountRaw) {
      respondJson(res, 400, { error: 'inputMint and amount are required' });
      return;
    }
    let amount;
    try {
      amount = BigInt(amountRaw);
    } catch {
      respondJson(res, 400, { error: 'Invalid amount' });
      return;
    }
    if (amount <= 0n) {
      respondJson(res, 400, { error: 'Amount must be positive' });
      return;
    }
    try {
      if (JUPITER_API_KEY && taker) {
        const orderUrl = new URL(`${JUPITER_SWAP_API_V2}/order`);
        orderUrl.searchParams.set('inputMint', inputMint);
        orderUrl.searchParams.set('outputMint', SOL_MINT);
        orderUrl.searchParams.set('amount', amount.toString());
        orderUrl.searchParams.set('taker', taker);
        orderUrl.searchParams.set('slippageBps', '100');
        orderUrl.searchParams.set('restrictIntermediateTokens', 'true');
        const orderResp = await fetch(orderUrl.toString(), {
          headers: { 'x-api-key': JUPITER_API_KEY },
        });
        const orderData = await orderResp.json().catch(() => ({}));
        if (orderResp.ok && orderData?.outAmount) {
          respondJson(res, 200, {
            inputMint,
            outputMint: SOL_MINT,
            outAmount: orderData.outAmount,
            priceImpactPct: orderData.priceImpactPct ?? '0',
            transport: 'order_execute',
            quoteResponse: {
              mode: 'order_execute',
              inputMint,
              outputMint: SOL_MINT,
              amount: amount.toString(),
            },
          });
          return;
        }
        console.warn('[market] Jupiter /order quote failed, falling back to lite quote', orderData?.error || orderResp.status);
      }

      const quoteUrl = new URL(JUPITER_LITE_QUOTE_API);
      quoteUrl.searchParams.set('inputMint', inputMint);
      quoteUrl.searchParams.set('outputMint', SOL_MINT);
      quoteUrl.searchParams.set('amount', amount.toString());
      quoteUrl.searchParams.set('swapMode', 'ExactIn');
      quoteUrl.searchParams.set('slippageBps', '100');
      quoteUrl.searchParams.set('restrictIntermediateTokens', 'true');
      const quoteResp = await fetch(quoteUrl.toString());
      const quoteData = await quoteResp.json().catch(() => ({}));
      if (!quoteResp.ok || !quoteData?.outAmount) {
        respondJson(res, quoteResp.status || 502, { error: quoteData?.error || 'Swap quote unavailable' });
        return;
      }
      respondJson(res, 200, {
        inputMint,
        outputMint: SOL_MINT,
        outAmount: quoteData.outAmount,
        priceImpactPct: quoteData.priceImpactPct ?? '0',
        transport: 'legacy_raw',
        quoteResponse: quoteData,
      });
      return;
    } catch (error) {
      respondJson(res, 502, { error: error instanceof Error ? error.message : 'Swap quote fetch failed' });
      return;
    }
  }

  if (pathname === '/api/market/build-swap' && req.method === 'POST') {
    if (!ipRateLimit('mkt_build_swap', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const parsed = JSON.parse(await readBody(req));
      const userPublicKey = normalizePubkey(parsed?.userPublicKey);
      const quoteResponse = parsed?.quoteResponse;
      if (!userPublicKey || userPublicKey !== jwtAuth.address) {
        respondJson(res, 403, { error: 'Wallet address mismatch' });
        return;
      }
      if (!quoteResponse || quoteResponse.outputMint !== SOL_MINT || !normalizePubkey(quoteResponse.inputMint)) {
        respondJson(res, 400, { error: 'Invalid swap quote' });
        return;
      }

      if (JUPITER_API_KEY && quoteResponse.mode === 'order_execute' && String(quoteResponse.amount || '').trim()) {
        const orderUrl = new URL(`${JUPITER_SWAP_API_V2}/order`);
        orderUrl.searchParams.set('inputMint', normalizePubkey(quoteResponse.inputMint));
        orderUrl.searchParams.set('outputMint', SOL_MINT);
        orderUrl.searchParams.set('amount', String(quoteResponse.amount));
        orderUrl.searchParams.set('taker', userPublicKey);
        orderUrl.searchParams.set('slippageBps', '100');
        orderUrl.searchParams.set('restrictIntermediateTokens', 'true');
        const orderResp = await fetch(orderUrl.toString(), {
          headers: { 'x-api-key': JUPITER_API_KEY },
        });
        const orderData = await orderResp.json().catch(() => ({}));
        if (orderResp.ok && orderData?.transaction && orderData?.requestId) {
          respondJson(res, 200, {
            swapTransaction: orderData.transaction,
            requestId: orderData.requestId,
            transport: 'order_execute',
          });
          return;
        }
        console.warn('[market] Jupiter /order build failed, falling back to lite swap', orderData?.error || orderResp.status);
      }

      const swapResp = await fetch(JUPITER_LITE_SWAP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
        }),
      });
      const swapData = await swapResp.json().catch(() => ({}));
      if (!swapResp.ok || !swapData?.swapTransaction) {
        respondJson(res, swapResp.status || 502, { error: swapData?.error || 'Failed to build swap transaction' });
        return;
      }
      respondJson(res, 200, {
        swapTransaction: swapData.swapTransaction,
        lastValidBlockHeight: swapData.lastValidBlockHeight ?? null,
        prioritizationFeeLamports: swapData.prioritizationFeeLamports ?? null,
        transport: 'legacy_raw',
      });
      return;
    } catch (error) {
      respondJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid request body' });
      return;
    }
  }

  if (pathname === '/api/market/execute-swap' && req.method === 'POST') {
    if (!ipRateLimit('mkt_execute_swap', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    if (!JUPITER_API_KEY) {
      respondJson(res, 503, { error: 'Jupiter API key is not configured on the server' });
      return;
    }
    try {
      const parsed = JSON.parse(await readBody(req));
      const signedTransaction = String(parsed?.signedTransaction || '').trim();
      const requestId = String(parsed?.requestId || '').trim();
      if (!signedTransaction || !requestId) {
        respondJson(res, 400, { error: 'signedTransaction and requestId are required' });
        return;
      }
      const executeResp = await fetch(`${JUPITER_SWAP_API_V2}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': JUPITER_API_KEY,
        },
        body: JSON.stringify({
          signedTransaction,
          requestId,
        }),
      });
      const executeData = await executeResp.json().catch(() => ({}));
      if (!executeResp.ok || !executeData?.signature) {
        respondJson(res, executeResp.status || 502, { error: executeData?.error || 'Failed to execute swap' });
        return;
      }
      respondJson(res, 200, executeData);
      return;
    } catch (error) {
      respondJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid request body' });
      return;
    }
  }

  // ── MagicBlock game-session proof API ──
  if (pathname === '/api/game/session' && req.method === 'POST') {
    if (!ipRateLimit('game_session', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many session registrations' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
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
      // Enforce JWT address matches session wallet
      if (payload.walletAddress !== jwtAuth.address) {
        return respondJson(res, 403, { error: 'Wallet address mismatch' });
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
      // Score-time validation per game mode:
      // orbit: score ≈ survival seconds (±5)
      // gravity: score = points (not time-based), but cap at 10 pts/sec of play
      // destroyer: score = points (high variance), cap at 100 pts/sec of play
      const isDestroyerMode = payload.gameMode === 'destroyer';
      const isGravityMode = payload.gameMode === 'gravity';
      const durationSec = Math.max(1, durationMs / 1000);
      const expectedScore = Math.floor(durationSec);
      const maxDestroyerScore = Math.floor(Math.max(1, durationSec) * 100);
      const maxGravityScore = Math.floor(Math.max(1, durationSec) * 10);
      let scoreDelta = 0;
      let modeScoreValid = true;
      if (isDestroyerMode) {
        modeScoreValid = payload.score <= maxDestroyerScore;
      } else if (isGravityMode) {
        modeScoreValid = payload.score <= maxGravityScore;
      } else {
        // orbit: score ≈ seconds survived
        scoreDelta = Math.abs(expectedScore - payload.score);
      }
      const verification = await verifyMagicBlockSeedSlot(payload.seed, payload.slot);
      const verified = verification.seedMatchesSlot && scoreDelta <= 5 && modeScoreValid;
      const nowIso = new Date().toISOString();
      const baseUrl = getBaseUrl(req);
      const proofUrl = baseUrl ? `${baseUrl}/api/game/session/${encodeURIComponent(id)}` : null;

      const reason = verified
        ? 'Seed matches MagicBlock slot and score delta is within tolerance'
        : `${verification.reason}; score delta=${scoreDelta}s`;

      // Preserve reuse-prevention flags if session already exists (prevents replay attack)
      const existingSession = gameSessionProofs.get(id);
      if (existingSession && (existingSession.usedForTournament || existingSession.usedForChallenge || existingSession.usedForLeaderboard)) {
        // Session already used competitively — reject re-registration
        return respondJson(res, 409, { error: 'Session already registered and used competitively' });
      }

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
          coinsCredited: existingSession?.coinsCredited ?? 0,
          identityGameCoinMultiplier: Number.isFinite(Number(existingSession?.identityGameCoinMultiplier))
            ? Math.max(1, Math.floor(Number(existingSession.identityGameCoinMultiplier)))
            : null,
          // Carry over any existing reuse flags
          usedForTournament: existingSession?.usedForTournament ?? null,
          usedForChallenge: existingSession?.usedForChallenge ?? null,
          usedForLeaderboard: existingSession?.usedForLeaderboard ?? null,
        };

      // Evict oldest unprotected session if at capacity
      if (gameSessionProofs.size >= MAX_GAME_SESSION_PROOFS) {
        let evicted = false;
        for (const [key, val] of gameSessionProofs) {
          if (!val?.usedForTournament && !val?.usedForChallenge && !val?.usedForLeaderboard) {
            gameSessionProofs.delete(key);
            evicted = true;
            break;
          }
        }
        if (!evicted) { // all protected — evict absolute oldest as last resort
          const oldest = gameSessionProofs.keys().next().value;
          if (oldest) gameSessionProofs.delete(oldest);
        }
      }
      gameSessionProofs.set(id, entry);
      persistGameSessionProofs();
      respondJson(res, 200, { session: toPublicGameSessionProof(entry) });
      return;
    } catch (error) {
      respondJson(res, 500, {
        error: 'Failed to register game session',
      });
      return;
    }
  }

  if (pathname.startsWith('/api/game/session/') && req.method === 'GET') {
    if (!ipRateLimit('sess_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Rate limited' });
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
      // If RPC is unavailable, return cached data — never downgrade a verified session
      if (!verification.rpcHealthy) {
        respondJson(res, 200, {
          session: toPublicGameSessionProof(existing),
          verificationWarning: 'MagicBlock RPC unavailable; using cached verification',
        });
        return;
      }
      // Recalculate modeScoreValid (must match POST creation logic)
      let modeScoreValid = true;
      const exDurationSec = Math.max(1, (existing.durationMs || 0) / 1000);
      if (existing.gameMode === 'destroyer') {
        modeScoreValid = existing.score <= Math.floor(exDurationSec * 100);
      } else if (existing.gameMode === 'gravity') {
        modeScoreValid = existing.score <= Math.floor(exDurationSec * 10);
      }
      const verified = verification.seedMatchesSlot && existing.scoreDelta <= 5 && modeScoreValid;
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
      const verifiedChanged = refreshed.verified !== existing.verified;
      gameSessionProofs.set(sessionId, refreshed);
      if (verifiedChanged) persistGameSessionProofs(); // only persist on state change
      respondJson(res, 200, { session: toPublicGameSessionProof(refreshed) });
      return;
    } catch (error) {
      respondJson(res, 200, {
        session: toPublicGameSessionProof(existing),
        verificationWarning: 'Verification temporarily unavailable',
      });
      return;
    }
  }

  // ── Leaderboard API ──
  if (pathname === '/api/game/leaderboard' && req.method === 'GET') {
    if (!ipRateLimit('lb_get', getClientIp(req), 60, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const gameTypeFilter = url.searchParams.get('gameType') || '';
    const cacheKey = `lb:${gameTypeFilter}`;
    if (leaderboardCache && leaderboardCache.key === cacheKey && Date.now() - leaderboardCacheTime < 10_000) {
      respondJson(res, 200, leaderboardCache.data);
      return;
    }
    const canonFilter = toCanonGameMode(gameTypeFilter) || gameTypeFilter;
    const filtered = canonFilter
      ? leaderboardEntries.filter(e => (toCanonGameMode(e.gameType) || e.gameType || 'orbit') === canonFilter)
      : leaderboardEntries;
    const data = { entries: filtered.slice(0, 50) };
    leaderboardCache = { key: cacheKey, data };
    leaderboardCacheTime = Date.now();
    respondJson(res, 200, data);
    return;
  }

  if (pathname === '/api/game/leaderboard' && req.method === 'POST') {
    if (!ipRateLimit('lb_post', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: bodyAddress, score, txSignature, gameType, gameSessionId } = parsed;
      const playedAt = new Date().toISOString(); // server-authoritative timestamp
      const address = jwtAuth.address;
      if (bodyAddress && bodyAddress !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!address || typeof address !== 'string' || typeof score !== 'number' || score <= 0) {
        respondJson(res, 400, { error: 'Invalid entry: address (string) and score (number > 0) required' });
        return;
      }
      // Require game session proof for leaderboard submit
      if (!gameSessionId) return respondJson(res, 400, { error: 'gameSessionId required for leaderboard' });
      const session = gameSessionProofs.get(gameSessionId);
      if (!session || !session.verified) return respondJson(res, 400, { error: 'Invalid or unverified game session' });
      if (session.walletAddress !== address) return respondJson(res, 403, { error: 'Session wallet mismatch' });
      if (Math.abs(session.score - score) > 5) return respondJson(res, 400, { error: 'Score does not match session proof' });
      // Require gameType and enforce exact match
      if (!gameType) return respondJson(res, 400, { error: 'gameType required' });
      if (session.gameMode !== gameType) return respondJson(res, 400, { error: 'Session gameMode mismatch' });
      if (session.usedForLeaderboard) return respondJson(res, 400, { error: 'Session already used for leaderboard' });
      // MAX_SCORE validation per game mode (BEFORE marking session used)
      const MAX_SCORES = { orbit: 600, gravity: 600, destroyer: 9999, wars: 600, territory: 600 };
      const gtCheck = gameType;
      const maxScore = MAX_SCORES[gtCheck] || 9999;
      if (score > maxScore) {
        respondJson(res, 400, { error: 'Score exceeds maximum allowed' });
        return;
      }
      // Mark session used AFTER all validation passes
      session.usedForLeaderboard = { address, at: Date.now() };
      persistGameSessionProofs();
      const result = submitLeaderboardEntry({ address, score, playedAt, txSignature, gameType });
      triggerCompositeUpdate(address);
      const gt = gameType || 'orbit';
      const filtered = leaderboardEntries.filter(e => (e.gameType || 'orbit') === gt);
      respondJson(res, 200, { entry: result, leaderboard: filtered.slice(0, 50) });
    } catch (error) {
      respondJson(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // ── Coins API (per-wallet coin balance) ──
  if (pathname === '/api/game/coins' && req.method === 'GET') {
    if (!ipRateLimit('coins_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const addr = url.searchParams.get('address') || '';
    if (!addr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
      respondJson(res, 400, { error: 'valid address required' });
      return;
    }
    const coins = getCoinBalance(addr);
    respondJson(res, 200, { address: addr, coins });
    return;
  }

  if (pathname === '/api/game/coins' && req.method === 'POST') {
    if (!ipRateLimit('game_coins_post', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: bodyAddr, delta, mode } = parsed;
      const addr = jwtAuth.address;
      if (bodyAddr && bodyAddr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!addr || typeof addr !== 'string') {
        respondJson(res, 400, { error: 'address (string) required' });
        return;
      }
      if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0 || !Number.isInteger(delta)) {
        respondJson(res, 400, { error: 'delta (non-zero integer) required' });
        return;
      }
      // Delta validation per game mode.
      if (delta > 0) {
        // Require verified game session proof (prevents earning coins without playing)
        const gameSessionId = parsed.gameSessionId;
        if (!gameSessionId) return respondJson(res, 400, { error: 'gameSessionId required for earning coins' });
        const session = gameSessionProofs.get(gameSessionId);
        if (!session || !session.verified) return respondJson(res, 400, { error: 'Invalid or unverified game session' });
        if (session.walletAddress !== addr) return respondJson(res, 403, { error: 'Session wallet mismatch' });
        // Block coin earning if this session was used for a challenge — earnings come from challenge result
        if (session.usedForChallenge) return respondJson(res, 400, { error: 'Challenge game — coins earned from challenge result' });
        const VALID_GAME_MODES = new Set(['orbit', 'destroyer', 'gravity', 'wars', 'territory']);
        const gameMode = VALID_GAME_MODES.has(mode) ? mode : 'orbit';
        if (session.gameMode && session.gameMode !== gameMode) {
          return respondJson(res, 400, { error: 'Session mode mismatch' });
        }
        let pinnedIdentityGameCoinMultiplier = Number.isFinite(Number(session.identityGameCoinMultiplier))
          ? Math.max(1, Math.floor(Number(session.identityGameCoinMultiplier)))
          : null;
        if (!pinnedIdentityGameCoinMultiplier) {
          const holderPerks = await getIdentityHolderPerks(addr);
          pinnedIdentityGameCoinMultiplier = Math.max(1, Math.floor(Number(holderPerks.gameCoinMultiplier) || 1));
          session.identityGameCoinMultiplier = pinnedIdentityGameCoinMultiplier;
        }
        const normalizedRequestedDelta = normalizeGameCoinDeltaForCap(delta, pinnedIdentityGameCoinMultiplier);
        const maxDelta = Math.round((MAX_DELTA_PER_GAME[gameMode] || 500) * GAME_SESSION_ONCHAIN_BONUS_MULTIPLIER);
        if (normalizedRequestedDelta > maxDelta) {
          return respondJson(res, 400, { error: 'Delta exceeds maximum for game mode' });
        }
        const alreadyCredited = Number(session.coinsCredited) || 0;
        const remainingSessionAllowance = Math.max(0, Math.floor(maxDelta - alreadyCredited));
        if (remainingSessionAllowance <= 0) {
          return respondJson(res, 400, { error: 'Session coin allowance exhausted' });
        }
        // Daily cap and session allowance track normalized pre-holder earnings so holder perks and staking sit on top.
        const todayCoins = getGameCoinsToday(addr);
        if (todayCoins >= DAILY_GAME_COIN_CAP) {
          return respondJson(res, 200, { address: addr, coins: getCoinBalance(addr), capped: true, dailyRemaining: 0 });
        }
        const requestedDelta = Math.min(normalizedRequestedDelta, remainingSessionAllowance);
        let baseDelta = requestedDelta;
        if (todayCoins + requestedDelta > DAILY_GAME_COIN_CAP) {
          baseDelta = DAILY_GAME_COIN_CAP - todayCoins;
        }
        // Track normalized pre-holder amount in the daily counter
        addGameCoinsToday(addr, baseDelta);
        session.coinsCredited = alreadyCredited + baseDelta;
        gameSessionProofs.set(gameSessionId, session);
        persistGameSessionProofs();
        const appliedGameDelta = scaleAppliedGameCoinDelta(delta, normalizedRequestedDelta, baseDelta);
        // Apply staking boost ON TOP of the holder-adjusted amount (bonus coins don't count towards cap)
        const boost = getStakingBoost(addr);
        const effectiveDelta = boost > 0 ? Math.floor(appliedGameDelta * (1 + boost)) : appliedGameDelta;
        const current = getCoinBalance(addr);
        const newBalance = current + effectiveDelta;
        setCoinBalance(addr, newBalance);
        addCoinEarned(addr, effectiveDelta);
        respondJson(res, 200, {
          address: addr,
          coins: newBalance,
          earned: effectiveDelta,
          dailyRemaining: Math.max(0, DAILY_GAME_COIN_CAP - getGameCoinsToday(addr)),
          boost: boost > 0 ? boost : undefined,
          idMultiplier: pinnedIdentityGameCoinMultiplier > 1 ? pinnedIdentityGameCoinMultiplier : undefined,
        });
      } else {
        // Negative delta (spending) — deduct from balance (no separate burn; burn is only on /api/prism/spend)
        const absDelta = Math.abs(delta);
        const current = getCoinBalance(addr);
        if (current < absDelta) return respondJson(res, 400, { error: 'Insufficient balance' });
        setCoinBalance(addr, current - absDelta);
        addCoinSpent(addr, absDelta);
        respondJson(res, 200, { address: addr, coins: getCoinBalance(addr) });
      }
    } catch {
      respondJson(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // ── Achievements API (per-wallet unlocked + claimed) ──
  if (pathname === '/api/game/achievements' && req.method === 'GET') {
    if (!ipRateLimit('game_ach', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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
    if (!ipRateLimit('ach_post', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: addr, achievementId, reward } = parsed;
      if (addr && addr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!addr || typeof addr !== 'string' || !achievementId || typeof achievementId !== 'string') {
        respondJson(res, 400, { error: 'address (string) and achievementId (string) required' });
        return;
      }
      const success = claimAchievement(addr, achievementId);
      if (!success) {
        respondJson(res, 409, { error: 'Achievement already claimed', achievementId });
        return;
      }
      // Server-side achievement reward lookup (ignore client-supplied reward)
      const serverReward = ACHIEVEMENT_REWARDS_BY_ID[achievementId] || 0;
      if (serverReward > 0) {
        // Apply NON_GAME_DAILY_EARN_CAP to achievement rewards
        const ngKey = `nongame_daily:${addr}`;
        const ngToday = new Date().toISOString().slice(0, 10);
        const ngEntry = prismEarnRateLimit.get(ngKey);
        let ngEarned = (ngEntry && typeof ngEntry === 'object' && ngEntry.date === ngToday) ? (ngEntry.total || 0) : 0;
        const remaining = Math.max(0, NON_GAME_DAILY_EARN_CAP - ngEarned);
        const capped = Math.min(serverReward, remaining);
        if (capped > 0) {
          setCoinBalance(addr, getCoinBalance(addr) + capped);
          addCoinEarned(addr, capped);
          prismEarnRateLimit.set(ngKey, { date: ngToday, total: ngEarned + capped });
        }
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
    if (!ipRateLimit('ach_put', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: addr, unlocked: ids } = parsed;
      if (!addr || typeof addr !== 'string' || !Array.isArray(ids)) {
        respondJson(res, 400, { error: 'address (string) and unlocked (array) required' });
        return;
      }
      if (addr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
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
    if (!ipRateLimit('game_rev', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const addr = url.searchParams.get('address') || '';
    const mode = url.searchParams.get('mode') || 'orbit';
    if (!addr) {
      respondJson(res, 400, { error: 'address query param required' });
      return;
    }
    if (mode !== 'orbit' && mode !== 'destroyer' && mode !== 'gravity') {
      respondJson(res, 400, { error: 'mode must be orbit, destroyer, or gravity' });
      return;
    }
    const eligible = await hasCoreCollectionAsset(addr);
    if (!eligible) {
      respondJson(res, 200, { address: addr, mode, left: 0, max: FREE_REVIVES_PER_DAY, eligible: false });
      return;
    }
    const left = getRevivesLeft(addr, mode);
    respondJson(res, 200, { address: addr, mode, left, max: FREE_REVIVES_PER_DAY, eligible: true });
    return;
  }

  if (pathname === '/api/identity/perks' && req.method === 'GET') {
    if (!ipRateLimit('identity_perks_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const addr = url.searchParams.get('address') || '';
    if (!addr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
      respondJson(res, 400, { error: 'valid address required' });
      return;
    }
    const perks = await getIdentityHolderPerks(addr);
    respondJson(res, 200, { address: addr, ...perks });
    return;
  }

  if (pathname === '/api/game/revives' && req.method === 'POST') {
    if (!ipRateLimit('revive_post', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: addr, mode } = parsed;
      if (addr && addr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!addr || typeof addr !== 'string') {
        respondJson(res, 400, { error: 'address (string) required' });
        return;
      }
      if (mode !== 'orbit' && mode !== 'destroyer' && mode !== 'gravity') {
        respondJson(res, 400, { error: 'mode must be orbit, destroyer, or gravity' });
        return;
      }
      const eligible = await hasCoreCollectionAsset(addr);
      if (!eligible) {
        respondJson(res, 403, { error: 'Identity Prism holder perk required for free revives', left: 0, max: FREE_REVIVES_PER_DAY });
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

  // ═══ Tournament System (Tiered) ═══
  if (pathname === '/api/tournament/active' && req.method === 'GET') {
    if (!ipRateLimit('tourney_active', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    checkTournaments();
    // Optional JWT check for userJoined per tier
    let userAddr = null;
    try {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET, { algorithms: ['HS256'], issuer: 'identity-prism', audience: 'identity-prism-api' });
        if (decoded.address) userAddr = decoded.address;
      }
    } catch {}
    const tournaments = {};
    for (const tier of Object.keys(TOURNAMENT_TIERS)) {
      const t = activeTournaments[tier];
      if (!t) { tournaments[tier] = null; continue; }
      const userJoined = !!(userAddr && t.entries[userAddr]);
      const entriesArr = Object.entries(t.entries)
        .map(([addr, data]) => ({ address: addr, score: data.score, submittedAt: data.submittedAt }))
        .sort((a, b) => b.score - a.score);
      const participantCount = entriesArr.length;
      tournaments[tier] = {
        id: t.id, tier, mode: t.mode, entryFee: t.entryFee, label: t.label || TOURNAMENT_TIERS[tier].label,
        prizePool: t.prizePool,
        basePrizes: getTournamentBasePrizes(tier, participantCount),
        startTime: t.startTime, endTime: t.endTime, status: t.status,
        entriesCount: participantCount, endsAt: t.endTime, entryCount: participantCount,
        isEnded: t.status === 'ended', userJoined,
        xpRewards: TOURNAMENT_XP_REWARDS[tier] || [],
        // Gated: only show entries if user joined
        entries: userJoined ? entriesArr.slice(0, 50) : [],
        resultsHidden: !userJoined,
      };
    }
    // Backward compat: also provide "tournament" key (daily as default)
    respondJson(res, 200, { tournaments, tournament: tournaments.daily });
    return;
  }

  if (pathname === '/api/tournament/join' && req.method === 'POST') {
    if (!ipRateLimit('tourn_join', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    checkTournaments();
    let tier = 'daily';
    try { const body = JSON.parse(await readBody(req)); if (body.tier) tier = body.tier; } catch {}
    if (!TOURNAMENT_TIERS[tier]) return respondJson(res, 400, { error: 'Invalid tier' });
    const t = activeTournaments[tier];
    if (!t) return respondJson(res, 400, { error: 'No active tournament for this tier' });
    const addr = jwtAuth.address;
    if (t.entries[addr]) return respondJson(res, 400, { error: 'Already joined' });
    // Pre-lock entry to prevent race condition (double-join)
    t.entries[addr] = { score: 0, submittedAt: null };
    const fee = t.entryFee;
    const bal = getCoinBalance(addr);
    if (bal < fee) { delete t.entries[addr]; return respondJson(res, 400, { error: `Insufficient balance. Entry fee: ${fee} Coins` }); }
    // Apply 15% burn fee to entry
    const burnAmt = Math.max(1, Math.floor(fee * TOURNAMENT_TIERS[tier].burnRate));
    const net = fee - burnAmt;
    totalBurned += burnAmt;
    setCoinBalance(addr, bal - fee);
    addCoinSpent(addr, fee);
    t.prizePool += net;
    saveTournament();
    respondJson(res, 200, { success: true, tier, prizePool: t.prizePool, newBalance: bal - fee, burned: burnAmt });
    return;
  }

  if (pathname === '/api/tournament/submit' && req.method === 'POST') {
    if (!ipRateLimit('tourn_submit', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    checkTournaments();
    try {
      const body = JSON.parse(await readBody(req));
      const { score, tier: reqTier, gameSessionId } = body;
      const tier = reqTier || 'daily';
      if (!TOURNAMENT_TIERS[tier]) return respondJson(res, 400, { error: 'Invalid tier' });
      const t = activeTournaments[tier];
      if (!t || t.status === 'ended' || Date.now() > t.endTime) return respondJson(res, 400, { error: 'Tournament has ended' });
      const addr = jwtAuth.address;
      if (!t.entries[addr]) return respondJson(res, 400, { error: 'Not joined' });
      if (typeof score !== 'number' || score <= 0) return respondJson(res, 400, { error: 'Valid score required' });
      // Require game session proof for tournament
      if (!gameSessionId) return respondJson(res, 400, { error: 'gameSessionId required for tournament' });
      const tSession = gameSessionProofs.get(gameSessionId);
      if (!tSession || !tSession.verified) return respondJson(res, 400, { error: 'Invalid or unverified game session' });
      if (tSession.walletAddress !== addr) return respondJson(res, 403, { error: 'Session wallet mismatch' });
      if (Math.abs(tSession.score - score) > 5) return respondJson(res, 400, { error: 'Score does not match session proof' });
      if (!t.mode) return respondJson(res, 500, { error: 'Tournament mode not configured' });
      if (tSession.gameMode !== t.mode) return respondJson(res, 400, { error: 'Session gameMode does not match tournament mode' });
      if (tSession.usedForTournament) return respondJson(res, 400, { error: 'Session already used for a tournament submission' });
      const MAX_T_SCORES = { orbit: 600, gravity: 600, destroyer: 9999 };
      const maxTScore = MAX_T_SCORES[t.mode] || 9999;
      if (score > maxTScore) return respondJson(res, 400, { error: 'Score exceeds maximum' });
      // Mark session used AFTER all validation passes (atomic)
      tSession.usedForTournament = { tier, addr, at: Date.now() };
      persistGameSessionProofs();
      if (score > (t.entries[addr].score || 0)) {
        t.entries[addr] = { score, submittedAt: new Date().toISOString() };
        saveTournament();
      }
      respondJson(res, 200, { success: true, tier, score: t.entries[addr].score });
    } catch { respondJson(res, 400, { error: 'Invalid JSON body' }); }
    return;
  }

  if (pathname === '/api/tournament/history' && req.method === 'GET') {
    if (!ipRateLimit('t_hist', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    respondJson(res, 200, { tournaments: tournamentHistory.slice(0, 20) });
    return;
  }

  // ═══ Referral System ═══
  if (pathname === '/api/referral/code' && req.method === 'GET') {
    if (!ipRateLimit('referral_code', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const addr = jwtAuth.address;
    // Check if code already exists in Firebase
    if (fbAvailable()) {
      const existing = await fbGet('referralCodes', addr);
      if (existing?.code) {
        return respondJson(res, 200, { code: existing.code });
      }
    }
    // Generate deterministic code: base58 chars from sha256(address + SALT)
    const SALT = _referralSalt;
    const hash = crypto.createHash('sha256').update(addr + SALT).digest();
    const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let code = '';
    for (let i = 0; i < 6; i++) code += BASE58[hash[i] % 58];
    // Persist in Firebase
    if (fbAvailable()) {
      await fbSet('referralCodes', addr, { code, createdAt: Date.now() });
      await fbSet('referralCodes', `code_${code}`, { address: addr });
    }
    respondJson(res, 200, { code });
    return;
  }

  if (pathname === '/api/referral/claim' && req.method === 'POST') {
    if (!ipRateLimit('ref_claim', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const claimer = jwtAuth.address;
    try {
      const { code } = JSON.parse(await readBody(req));
      if (!code || typeof code !== 'string') return respondJson(res, 400, { error: 'Code required' });
      if (!fbAvailable()) return respondJson(res, 503, { error: 'Firebase unavailable' });

      // Look up referrer
      const codeDoc = await fbGet('referralCodes', `code_${code}`);
      if (!codeDoc?.address) return respondJson(res, 400, { error: 'Invalid referral code' });
      const referrer = codeDoc.address;

      // Validate
      if (referrer === claimer) return respondJson(res, 400, { error: 'Cannot use your own code' });

      // Race condition guard for referral claims
      if (!globalThis._pendingReferralClaims) globalThis._pendingReferralClaims = new Set();
      const refClaimKey = `${referrer}_${claimer}`;
      if (globalThis._pendingReferralClaims.has(refClaimKey)) return respondJson(res, 409, { error: 'Claim in progress' });
      if (globalThis._pendingReferralClaims.has(`claimer_${claimer}`)) return respondJson(res, 409, { error: 'Claim in progress' });
      globalThis._pendingReferralClaims.add(refClaimKey);
      globalThis._pendingReferralClaims.add(`claimer_${claimer}`);

      // Check if claimer already used ANY referral code (global per-claimer check)
      const claimerGlobal = await fbGet('referralClaimers', claimer);
      if (claimerGlobal) { globalThis._pendingReferralClaims.delete(refClaimKey); globalThis._pendingReferralClaims.delete(`claimer_${claimer}`); return respondJson(res, 400, { error: 'Already claimed a referral' }); }

      // Check this specific pair too
      const existingClaim = await fbGet('referrals', refClaimKey);
      if (existingClaim) { globalThis._pendingReferralClaims.delete(refClaimKey); globalThis._pendingReferralClaims.delete(`claimer_${claimer}`); return respondJson(res, 400, { error: 'Already claimed a referral' }); }

      // Check referrer max 50 referrals
      const referrerStats = await fbGet('referralStats', referrer);
      if (referrerStats && referrerStats.totalReferred >= 50) {
        globalThis._pendingReferralClaims.delete(refClaimKey);
        globalThis._pendingReferralClaims.delete(`claimer_${claimer}`);
        return respondJson(res, 400, { error: 'Referrer has reached maximum referrals' });
      }

      // Persist to Firestore BEFORE awarding coins (crash-safe: no double-claim)
      await fbSet('referralClaimers', claimer, { referrer, code, claimedAt: Date.now() });
      await fbSet('referrals', `${referrer}_${claimer}`, {
        referrer, claimer, code, timestamp: Date.now(), mintBonus: false,
      });

      // Award coins (only after Firestore confirms)
      const claimerBal = getCoinBalance(claimer);
      setCoinBalance(claimer, claimerBal + 50);
      addCoinEarned(claimer, 50);
      const referrerBal = getCoinBalance(referrer);
      setCoinBalance(referrer, referrerBal + 20);
      addCoinEarned(referrer, 20);

      // Update referrer stats
      const newTotal = (referrerStats?.totalReferred || 0) + 1;
      const newEarned = (referrerStats?.totalEarned || 0) + 20;
      await fbSet('referralStats', referrer, {
        totalReferred: newTotal,
        totalEarned: newEarned,
      });

      globalThis._pendingReferralClaims.delete(refClaimKey);
      globalThis._pendingReferralClaims.delete(`claimer_${claimer}`);
      respondJson(res, 200, { success: true, claimerBonus: 50, referrerBonus: 20 });
    } catch { if (typeof refClaimKey !== 'undefined') { globalThis._pendingReferralClaims?.delete(refClaimKey); globalThis._pendingReferralClaims?.delete(`claimer_${claimer}`); } respondJson(res, 400, { error: 'Invalid request' }); }
    return;
  }

  if (pathname === '/api/referral/stats' && req.method === 'GET') {
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const addr = jwtAuth.address;
    if (!fbAvailable()) return respondJson(res, 200, { code: null, totalReferred: 0, totalEarned: 0, referrals: [] });

    const codeDoc = await fbGet('referralCodes', addr);
    const statsDoc = await fbGet('referralStats', addr);

    // Get referral list (max 50)
    const referrals = [];
    if (statsDoc?.totalReferred > 0) {
      const db = (await import('./services/firebase.js')).getDb();
      if (db) {
        const snap = await db.collection('referrals')
          .where('referrer', '==', addr)
          .orderBy('timestamp', 'desc')
          .limit(50)
          .get();
        snap.forEach(doc => {
          const d = doc.data();
          referrals.push({ address: d.claimer, timestamp: d.timestamp, mintBonus: d.mintBonus || false });
        });
      }
    }

    respondJson(res, 200, {
      code: codeDoc?.code || null,
      totalReferred: statsDoc?.totalReferred || 0,
      totalEarned: statsDoc?.totalEarned || 0,
      referrals,
    });
    return;
  }

  // ═══ Prism Vault (Staking) ═══
  const _pendingStakingOps = globalThis._pendingStakingOps || (globalThis._pendingStakingOps = new Set());
  if (pathname === '/api/prism/vault/stake' && req.method === 'POST') {
    if (!ipRateLimit('vault_stake', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const addr = jwtAuth.address;
    if (_pendingStakingOps.has(addr)) return respondJson(res, 429, { error: 'Staking operation in progress' });
    _pendingStakingOps.add(addr);
    try {
      const body = JSON.parse(await readBody(req));
      const { amount, tier } = body;
      const lockDays = Number.isInteger(body.lockDays) && body.lockDays > 0 ? body.lockDays : 7;
      const tierConfig = STAKING_TIERS[tier];
      if (!tierConfig) return respondJson(res, 400, { error: 'Invalid tier. Use: bronze, silver, gold' });
      if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < tierConfig.minStake) {
        return respondJson(res, 400, { error: `Minimum stake for ${tier}: ${tierConfig.minStake} Coins (integer)` });
      }
      const MAX_STAKE_PER_WALLET = 500_000;
      if (amount > MAX_STAKE_PER_WALLET) {
        return respondJson(res, 400, { error: `Maximum stake: ${MAX_STAKE_PER_WALLET} Coins` });
      }
      const bal = getCoinBalance(addr);
      if (bal < amount) return respondJson(res, 400, { error: 'Insufficient balance' });
      const w = walletDatabase.get(addr) || { address: addr };
      if (w.staking && w.staking.amount > 0) {
        return respondJson(res, 400, { error: 'Already staking. Unstake first to change tier.' });
      }
      const lockTier = getLockTier(lockDays);
      setCoinBalance(addr, bal - amount);
      addCoinSpent(addr, amount);
      w.staking = {
        amount, tier,
        startTime: Date.now(), lastClaimTime: Date.now(),
        lockEnd: Date.now() + lockTier.days * 24 * 60 * 60 * 1000,
        lockDays: lockTier.days,
        yieldMultiplier: lockTier.yieldMultiplier,
        earlyPenalty: lockTier.earlyPenalty,
      };
      w.coins = bal - amount;
      walletDatabase.set(addr, w);
      saveWalletDatabaseDebounced();
      respondJson(res, 200, { success: true, staking: w.staking, newBalance: bal - amount });
    } catch { respondJson(res, 400, { error: 'Invalid JSON body' }); } finally { _pendingStakingOps.delete(addr); }
    return;
  }

  if (pathname === '/api/prism/vault/claim' && req.method === 'POST') {
    if (!ipRateLimit('vault_claim', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const addr = jwtAuth.address;
    if (_pendingStakingOps.has(addr)) return respondJson(res, 429, { error: 'Staking operation in progress' });
    _pendingStakingOps.add(addr);
    try {
      const w = walletDatabase.get(addr);
      if (!w?.staking || !w.staking.amount) { respondJson(res, 400, { error: 'No active stake' }); return; }
      const yieldAmount = calcUnclaimedYield(w.staking);
      if (yieldAmount <= 0) { respondJson(res, 200, { success: true, claimed: 0, message: 'No yield to claim yet' }); return; }
      const bal = getCoinBalance(addr);
      setCoinBalance(addr, bal + yieldAmount);
      addCoinEarned(addr, yieldAmount);
      w.staking.lastClaimTime = Date.now();
      w.coins = bal + yieldAmount;
      walletDatabase.set(addr, w);
      saveWalletDatabaseDebounced();
      respondJson(res, 200, { success: true, claimed: yieldAmount, newBalance: bal + yieldAmount });
    } finally { _pendingStakingOps.delete(addr); }
    return;
  }

  if (pathname === '/api/prism/vault/unstake' && req.method === 'POST') {
    if (!ipRateLimit('vault_unstake', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const addr = jwtAuth.address;
    if (_pendingStakingOps.has(addr)) return respondJson(res, 429, { error: 'Staking operation in progress' });
    _pendingStakingOps.add(addr);
    try {
      const w = walletDatabase.get(addr);
      if (!w?.staking || !w.staking.amount) { respondJson(res, 400, { error: 'No active stake' }); return; }
      const stake = w.staking;
      const now = Date.now();
      const isEarly = now < stake.lockEnd;
      let returnAmount = stake.amount;
      let penalty = 0;
      let burned = 0;
      // Claim any unclaimed yield first
      const yieldAmount = calcUnclaimedYield(stake);
      if (isEarly) {
        // Use stored earlyPenalty if available, otherwise look up from lockDays, fallback 0.25
        const penaltyRate = stake.earlyPenalty != null
          ? stake.earlyPenalty
          : getLockTier(stake.lockDays || 7).earlyPenalty;
        penalty = Math.floor(stake.amount * penaltyRate);
        burned = penalty; // early unstake penalty is fully burned
        totalBurned += burned;
        returnAmount = stake.amount - penalty;
      }
      const total = returnAmount + yieldAmount;
      const bal = getCoinBalance(addr);
      setCoinBalance(addr, bal + total);
      addCoinEarned(addr, yieldAmount); // only yield is earned income, not the returned deposit
      w.staking = null;
      w.coins = bal + total;
      walletDatabase.set(addr, w);
      saveWalletDatabaseDebounced();
      respondJson(res, 200, { success: true, returned: returnAmount, yield: yieldAmount, penalty, burned, early: isEarly, newBalance: bal + total });
    } finally { _pendingStakingOps.delete(addr); }
    return;
  }

  if (pathname === '/api/prism/vault/status' && req.method === 'GET') {
    if (!ipRateLimit('vault_st', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const addr = url.searchParams.get('address') || '';
    if (!addr) return respondJson(res, 400, { error: 'address required' });
    const w = walletDatabase.get(addr);
    const stake = w?.staking;
    if (!stake || !stake.amount) return respondJson(res, 200, { staking: null, boostRate: 0 });
    const tierConfig = STAKING_TIERS[stake.tier] || {};
    const unclaimedYield = calcUnclaimedYield(stake);
    const timeLeft = Math.max(0, (stake.lockEnd || 0) - Date.now());
    const lockMult = stake.yieldMultiplier != null ? stake.yieldMultiplier : 1.0;
    const dailyYield = stake.startTime < BRACKETS_DEPLOY_TS
      ? Math.floor((tierConfig.rateMultiplier ? calcDailyYieldForAmount(stake.amount, tierConfig.rateMultiplier) : 0))
      : Math.floor(calcDailyYieldForAmount(stake.amount, (tierConfig.rateMultiplier || 1) * lockMult));
    const effectiveRate = getEffectiveRate(stake.amount, (tierConfig.rateMultiplier || 1) * lockMult);
    respondJson(res, 200, {
      staking: { amount: stake.amount, tier: stake.tier, startTime: stake.startTime, lockEnd: stake.lockEnd, lastClaimTime: stake.lastClaimTime, lockDays: stake.lockDays || 7, yieldMultiplier: stake.yieldMultiplier || 1.0, earlyPenalty: stake.earlyPenalty != null ? stake.earlyPenalty : 0.25 },
      unclaimedYield, timeLeft, boostRate: tierConfig.boostRate || 0,
      dailyYield,
      effectiveRate: +(effectiveRate * 100).toFixed(3),
      rateSchedule: getRateSchedule(tierConfig.rateMultiplier || 1),
    });
    return;
  }

  // ═══ Mint ID for Coins ═══
  if (pathname === '/api/prism/mint-for-coins' && req.method === 'POST') {
    if (!ipRateLimit('mint_coins', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const addr = jwtAuth.address;
    const MINT_COIN_COST = 10000;
    const bal = getCoinBalance(addr);
    if (bal < MINT_COIN_COST) return respondJson(res, 400, { error: `Insufficient balance. Cost: ${MINT_COIN_COST} Coins` });
    const { burned: mintBurned } = applyBurnFee(MINT_COIN_COST);
    setCoinBalance(addr, bal - MINT_COIN_COST);
    addCoinSpent(addr, MINT_COIN_COST);
    const wMint = walletDatabase.get(addr);
    if (wMint) { wMint.coins = bal - MINT_COIN_COST; saveWalletDatabaseDebounced(); }
    const txm = {
      id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      address: addr, amount: MINT_COIN_COST, type: 'spend', source: 'mint_for_coins',
      description: `Mint ID for ${MINT_COIN_COST} Coins (${mintBurned} burned)`,
      timestamp: new Date().toISOString(),
    };
    const txsm = prismTransactions.get(addr) || [];
    txsm.unshift(txm);
    if (txsm.length > 500) txsm.length = 500;
    prismTransactions.set(addr, txsm);
    debouncedSavePrism();
    // Referral mint bonus: if minter was referred, give referrer +100 coins
    if (fbAvailable()) {
      const _mintBonusLocks = globalThis._mintBonusLocks || (globalThis._mintBonusLocks = new Set());
      if (!_mintBonusLocks.has(addr)) {
        _mintBonusLocks.add(addr);
        (async () => {
          try {
            const db = (await import('./services/firebase.js')).getDb();
            if (!db) return;
            const snap = await db.collection('referrals').where('claimer', '==', addr).limit(1).get();
            if (snap.empty) return;
            const refDoc = snap.docs[0];
            const refData = refDoc.data();
            if (refData.mintBonus) return; // already awarded
            // Set mintBonus FIRST to prevent race
            await fbSet('referrals', refDoc.id, { mintBonus: true });
            const referrer = refData.referrer;
            try {
              const rBal = getCoinBalance(referrer);
              setCoinBalance(referrer, rBal + 100);
              addCoinEarned(referrer, 100);
            } catch (coinErr) {
              // Rollback Firestore if coin award fails
              await fbSet('referrals', refDoc.id, { mintBonus: false }).catch(() => {});
              throw coinErr;
            }
            const rStats = await fbGet('referralStats', referrer);
            await fbSet('referralStats', referrer, {
              totalEarned: (rStats?.totalEarned || 0) + 100,
            });
          } catch (e) { console.warn('[referral] mint bonus error:', e.message); }
          finally { _mintBonusLocks.delete(addr); }
        })();
      }
    }
    respondJson(res, 200, { success: true, proceedWithMint: true, newBalance: bal - MINT_COIN_COST, burned: mintBurned });
    return;
  }

  // ═══ Economy Stats (totalBurned) ═══
  if (pathname === '/api/prism/economy' && req.method === 'GET') {
    if (!ipRateLimit('economy', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    respondJson(res, 200, { totalBurned, dailyGameCap: DAILY_GAME_COIN_CAP });
    return;
  }

  // ── Score History API ──
  if (pathname === '/api/score-history' && req.method === 'GET') {
    if (!ipRateLimit('score_hist', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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
    if (!ipRateLimit('score_hist_post', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const { address: addr, score, tier } = parsed;
      if (!addr || typeof addr !== 'string' || typeof score !== 'number') {
        respondJson(res, 400, { error: 'address (string) and score (number) required' });
        return;
      }
      if (addr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (typeof score !== 'number' || score < 0 || score > 1000) return respondJson(res, 400, { error: 'Score must be between 0 and 1000' });
      // Server-authoritative tier computation (ignore client-supplied tier)
      const computedTier = score >= 800 ? 'binary_sun' : score >= 600 ? 'pulsar' : score >= 400 ? 'neutron_star' : score >= 200 ? 'dwarf_star' : 'mercury';
      const entry = addScoreEntry(addr, score, computedTier);
      // ── Update wallet database ──
      const wExisting = walletDatabase.get(addr) || {};
      updateWalletEntry(addr, {
        firstSeenAt: wExisting.firstSeenAt || new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        scanCount: (wExisting.scanCount || 0) + ((() => { const scKey = `scan_daily:${addr}`; const scToday = new Date().toISOString().slice(0, 10); const sc = prismEarnRateLimit.get(scKey); if (sc && typeof sc === 'object' && sc.date === scToday && sc.count >= 5) return 0; prismEarnRateLimit.set(scKey, { date: scToday, count: ((sc && sc.date === scToday) ? sc.count : 0) + 1 }); return 1; })()),
        score,
        tier: computedTier,
        source: 'live',
      });
      triggerCompositeUpdate(addr);
      respondJson(res, 200, { address: addr, scores: entry.scores, lastUpdated: entry.lastUpdated });
    } catch {
      respondJson(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }


  if (pathname === '/api/actions/render') {
    if (!ipRateLimit('actions', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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
      respondJson(res, 500, { error: 'Unable to render card image' });
      return;
    }
  }

  if (pathname === '/api/actions/share') {
    if (!ipRateLimit('actions', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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

    const findAddressCandidate = (payload, maxNodes = 200) => {
      if (!payload || typeof payload !== 'object') return '';
      const queue = [payload];
      const visited = new Set();
      let nodeCount = 0;
      while (queue.length && nodeCount < maxNodes) {
        nodeCount++;
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
      });
    }
    return;
  }

  if (pathname === '/api/actions/view-app') {
    if (!ipRateLimit('actions', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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
      respondJson(res, 500, { error: 'Unable to build view app link' });
    }
    return;
  }

  if (pathname === '/api/actions/mint-blink') {
    if (!ipRateLimit('actions', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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
      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
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
      respondJson(res, 500, { error: 'Action mint failed' });
    }
    return;
  }

  if (pathname === '/mint-cnft') {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    // JWT auth guard (mandatory)
    const jwtAuth = requireJwt(req, res);
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
      // adminMode requires valid X-Admin-Key header — user payload alone is NOT enough
      // Guard: ADMIN_KEY must be explicitly set (undefined === undefined would bypass)
      const adminMode = Boolean(payload?.admin) && !!process.env.ADMIN_KEY && (() => {
        try { const a = req.headers['x-admin-key'] || '', b = process.env.ADMIN_KEY; return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
      })();
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

        // Track minted address
        const finalOwner = owner || pending.owner;
        if (finalOwner) {
          mintedAddresses.add(finalOwner);
          saveMintedAddresses();
          // ── Record mint in wallet database ──
          const wMint = walletDatabase.get(finalOwner) || { address: finalOwner };
          wMint.mint = {
            minted: true,
            assetId: pending.assetId,
            mintedAt: new Date().toISOString(),
            txSignature: signature,
            metadataUri: pending.metadataUri || '',
            remints: (wMint.mint?.remints || 0) + (pending.isRemint ? 1 : 0),
            lastRemintAt: pending.isRemint ? new Date().toISOString() : (wMint.mint?.lastRemintAt || null),
          };
          if (pending.score != null) wMint.score = pending.score;
          if (pending.tier) wMint.tier = pending.tier;
          if (pending.traits) wMint.traits = pending.traits;
          if (pending.stats) wMint.stats = pending.stats;
          walletDatabase.set(finalOwner, wMint);
          saveWalletDatabaseDebounced();
        }

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
          hint: 'Set TREASURY_SECRET environment variable',
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
        // Track minted address
        if (owner) {
          mintedAddresses.add(owner);
          saveMintedAddresses();
          // ── Record admin mint in wallet database ──
          const wAdmin = walletDatabase.get(owner) || { address: owner };
          wAdmin.mint = {
            minted: true,
            assetId: assetSigner.publicKey,
            mintedAt: new Date().toISOString(),
            txSignature: signature,
            metadataUri: metadataUri || '',
            remints: (wAdmin.mint?.remints || 0) + (remintMode ? 1 : 0),
            lastRemintAt: remintMode ? new Date().toISOString() : (wAdmin.mint?.lastRemintAt || null),
          };
          if (payload?.score != null) wAdmin.score = payload.score;
          if (payload?.tier) wAdmin.tier = payload.tier;
          if (payload?.traits) wAdmin.traits = payload.traits;
          if (payload?.stats) wAdmin.stats = payload.stats;
          walletDatabase.set(owner, wAdmin);
          saveWalletDatabaseDebounced();
        }

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
        score: payload?.score,
        tier: payload?.tier,
        traits: payload?.traits,
        stats: payload?.stats,
        metadataUri: payload?.metadataUri || metadataUri,
        isRemint: remintMode,
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
      respondJson(res, 500, { error: 'Core mint failed' });
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

    // JWT auth guard (mandatory)
    const jwtAuth = requireJwt(req, res);
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
            skipPreflight: false,
          });
          await connection.confirmTransaction(signature, 'confirmed');
          console.info('[update-card] finalized', { ownerAddress: ownerAddress.slice(0, 8), assetId: assetId.slice(0, 16), signature: signature.slice(0, 16) });
          respondJson(res, 200, { signature, assetId, finalized: true });
        } catch (submitErr) {
          console.error('[update-card] submit failed', submitErr?.message ?? submitErr);
          respondJson(res, 500, { error: 'Transaction submission failed' });
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
      respondJson(res, 500, { error: 'Update card failed' });
    }
    return;
  }

  if (pathname === '/verify-collection') {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    if (!requireAdminKey(req, res)) return;
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;

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
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
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
      await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'));
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
      if (!ipRateLimit('metadata_post', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return;
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
        await fs.promises.writeFile(filePath, JSON.stringify(metadata, null, 2));
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

  // ═══ PRISM Balance ═══
  if (pathname === '/api/prism/balance' && req.method === 'GET') {
    if (!ipRateLimit('prismBal', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid address' });
    respondJson(res, 200, getPrismBalance(address));
    return;
  }

  // ═══ XP Sources (server-authoritative) ═══
  if (pathname === '/api/xp' && req.method === 'GET') {
    if (!ipRateLimit('xp', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid address' });
    const snapshot = getServerRangerSnapshot(address);
    respondJson(res, 200, { sources: snapshot.sources, computedXP: snapshot.xp, computedRank: snapshot.rank });
    return;
  }

  // ═══ Daily Limits (public, no auth) ═══
  if (pathname === '/api/daily-limits' && req.method === 'GET') {
    if (!ipRateLimit('dailyLimits', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const address = url.searchParams.get('address');
    if (!address) return respondJson(res, 400, { error: 'address required' });
    const today = new Date().toISOString().slice(0, 10);
    // Game coins
    const gameToday = getGameCoinsToday ? getGameCoinsToday(address) : 0;
    // Non-game global
    const ngKey = `nongame_daily:${address}`;
    const ngEntry = prismEarnRateLimit.get(ngKey);
    const nonGameToday = (ngEntry && typeof ngEntry === 'object' && ngEntry.date === today) ? (ngEntry.total || 0) : 0;
    // Sub-caps
    const huntToday = prismEarnRateLimit.get(`subcap:${address}:sybil_hunt:${today}`) || 0;
    const scanToday = prismEarnRateLimit.get(`subcap:${address}:scan_wallet:${today}`) || 0;
    const quizToday = (prismEarnRateLimit.get(`quiz:${address}:${today}`) || 0) * 5; // answers × 5 coins
    respondJson(res, 200, {
      game:    { earned: gameToday, cap: typeof DAILY_GAME_COIN_CAP !== 'undefined' ? DAILY_GAME_COIN_CAP : 500 },
      hunt:    { earned: huntToday, cap: DAILY_HUNT_CAP },
      scan:    { earned: scanToday, cap: DAILY_SCAN_CAP },
      quiz:    { earned: quizToday, cap: DAILY_QUIZ_CAP },
      nonGame: { earned: nonGameToday, cap: NON_GAME_DAILY_EARN_CAP },
    });
    return;
  }

  // ═══ PRISM Earn ═══
  if (pathname === '/api/prism/earn' && req.method === 'POST') {
    if (!ipRateLimit('prism_earn', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const {
        address: bodyAddress,
        source,
        amount,
        description,
        questId,
        scanTarget: scanTargetRaw,
      } = JSON.parse(await readBody(req));
      const address = jwtAuth.address;
      if (bodyAddress && bodyAddress !== address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!address || !amount) return respondJson(res, 400, { error: 'address and amount required' });
      // Whitelist valid earn sources — reject unknown sources to prevent rate-limit bypass
      // burn_tokens/burn_nfts REMOVED — no on-chain verification, was exploitable for 144K coins/day
      const MAX_EARN_PER_CALL = { game_orbit: 50, game_defender: 50, game_gravity: 50, scan_wallet: 5, achievement: 50, quest_daily: 15, quest_weekly: 50, quest_milestone: 100, challenge_win: 30, first_mint: 100, referral: 20, text_quest: 1200, sybil_hunt: 70 };
      if (!source || !MAX_EARN_PER_CALL[source]) return respondJson(res, 400, { error: 'Invalid earn source' });
      const maxAllowed = MAX_EARN_PER_CALL[source];
      if (!Number.isFinite(Number(amount)) || Number(amount) > maxAllowed) return respondJson(res, 400, { error: `Max ${maxAllowed} Coins per ${source || 'action'}` });
      // Per-source rate limit with per-source cooldowns
      const rlKey = `${address}:${source || 'unknown'}`;
      const lastEarn = prismEarnRateLimit.get(rlKey) || 0;
      const cooldownMs = PRISM_EARN_COOLDOWN_TABLE[source] ?? PRISM_EARN_COOLDOWN_DEFAULT;
      if (Date.now() - lastEarn < cooldownMs) {
        return respondJson(res, 429, { error: 'Rate limited — try again later', cooldownMs: cooldownMs - (Date.now() - lastEarn) });
      }
      // Global per-address rate limit (max 1 earn per 2 seconds regardless of source)
      const globalKey = `${address}:__global__`;
      const lastGlobal = prismEarnRateLimit.get(globalKey) || 0;
      if (Date.now() - lastGlobal < 2000) {
        return respondJson(res, 429, { error: 'Too many requests — slow down' });
      }
      prismEarnRateLimit.set(globalKey, Date.now());
      prismEarnRateLimit.set(rlKey, Date.now());
      if (prismEarnRateLimit.size > 5000) {
        const now = Date.now();
        const todayCleanup = new Date().toISOString().slice(0, 10);
        for (const [k, v] of prismEarnRateLimit) {
          if (typeof v === 'object' && v !== null && v.date) {
            if (v.date < todayCleanup) prismEarnRateLimit.delete(k);
            continue;
          }
          if (now - v > 7 * 24 * 60 * 60_000) prismEarnRateLimit.delete(k);
        }
      }
      let earned = Math.max(0, Math.floor(Number(amount)));
      if (earned <= 0) return respondJson(res, 400, { error: 'amount must be positive' });
      // Enforce daily game coin cap for game sources via /api/prism/earn (prevents bypass of /api/game/coins cap)
      const GAME_EARN_SOURCES = new Set(['game_orbit', 'game_defender', 'game_gravity']);
      if (GAME_EARN_SOURCES.has(source)) {
        // Track pre-boost amount in daily cap (consistent with /api/game/coins)
        const todayCoins = getGameCoinsToday(address);
        if (todayCoins >= DAILY_GAME_COIN_CAP) return respondJson(res, 429, { error: 'Daily game coin cap reached', dailyRemaining: 0 });
        let baseDelta = Math.min(earned, DAILY_GAME_COIN_CAP - todayCoins);
        addGameCoinsToday(address, baseDelta);
        // Apply staking boost ON TOP of capped amount (bonus coins don't count towards cap)
        const gameBoost = getStakingBoost(address);
        earned = gameBoost > 0 ? Math.floor(baseDelta * (1 + gameBoost)) : baseDelta;
      } else {
        // Non-game sources: enforce global daily cap to prevent coin inflation
        // Server-side verification for one-time/conditional sources BEFORE cap consumption
        if (source === 'first_mint') {
          if (!globalThis._firstMintLocks) globalThis._firstMintLocks = new Set();
          if (globalThis._firstMintLocks.has(address)) return respondJson(res, 400, { error: 'first_mint already claimed' });
          globalThis._firstMintLocks.add(address);
          const wfm = walletDatabase.get(address);
          if (wfm?._firstMintClaimed) return respondJson(res, 400, { error: 'first_mint already claimed' });
          updateWalletEntry(address, { _firstMintClaimed: true });
        }
        if (source === 'text_quest') {
          const qid = String(questId || '').trim();
          if (!qid || !VALID_TEXT_QUEST_IDS.has(qid)) return respondJson(res, 400, { error: 'Invalid or missing questId' });
          const w = walletDatabase.get(address) || {};
          const completedQuests = w._completedTextQuests || {};
          if (completedQuests[qid]) return respondJson(res, 400, { error: 'Quest reward already claimed' });
          updateWalletEntry(address, { _completedTextQuests: { ...completedQuests, [qid]: Date.now() } });
        }
        if (source === 'challenge_win') {
          const recentChallenges = Array.from(challenges.values()).filter(
            c => c.status === 'completed' && c.winner === address && !c.earnClaimed && Date.now() - new Date(c.completedAt || c.createdAt).getTime() < 600_000
          );
          if (recentChallenges.length === 0) return respondJson(res, 400, { error: 'No recent challenge win found' });
          recentChallenges[0].earnClaimed = true; // mark so it can't be double-claimed
          // Await persist before awarding coins (prevent double-claim on crash)
          try {
            const _tmp = CHALLENGES_FILE + '.tmp';
            await fs.promises.writeFile(_tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), challenges }, null, 2));
            await fs.promises.rename(_tmp, CHALLENGES_FILE);
          } catch { /* saveChallenges debounced will retry */ }
        }
        let scanRewardState = null;
        let scanRewardTarget = null;
        if (source === 'scan_wallet' || source === 'sybil_hunt') {
          const normalizedTarget = normalizePubkey(scanTargetRaw || (source === 'scan_wallet' ? address : ''));
          if (!normalizedTarget) return respondJson(res, 400, { error: 'scanTarget required' });
          if (source === 'sybil_hunt' && normalizedTarget === address) {
            return respondJson(res, 400, { error: 'Cannot claim sybil bounty for your own wallet' });
          }
          const analysis = getRecentSybilAnalysis(normalizedTarget);
          if (!analysis || !Number.isFinite(Number(analysis.trustScore))) {
            return respondJson(res, 400, { error: 'Scan target must be analyzed before claiming reward' });
          }
          const verdict = getSybilVerdict(analysis);
          const rewardPath = verdict?.rewardPath || getSybilRewardPath(analysis);
          const isSybilTarget = rewardPath === 'sybil_hunt';
          if (source === 'sybil_hunt' && !isSybilTarget) {
            return respondJson(res, 400, { error: 'Target does not qualify for sybil bounty' });
          }
          if (source === 'scan_wallet' && isSybilTarget) {
            return respondJson(res, 400, { error: 'Flagged target must use sybil_hunt reward path' });
          }

          scanRewardState = getScanRewardState(address);
          scanRewardTarget = normalizedTarget;
          if (source === 'scan_wallet') {
            const lastClaimedAt = Number(scanRewardState.cleanClaims[normalizedTarget]) || 0;
            const cooldownRemaining = CLEAN_SCAN_REWARD_COOLDOWN_MS - (Date.now() - lastClaimedAt);
            if (lastClaimedAt && cooldownRemaining > 0) {
              return respondJson(res, 429, { error: 'Scan reward already claimed recently for this wallet', cooldownMs: cooldownRemaining });
            }
            earned = SCAN_WALLET_REWARD;
          } else {
            if (scanRewardState.sybilClaims[normalizedTarget]) {
              return respondJson(res, 400, { error: 'Sybil bounty already claimed for this wallet' });
            }
            earned = computeSybilHuntReward(Object.keys(scanRewardState.sybilClaims).length + 1);
          }
        }

        // Per-activity daily sub-caps
        const today = new Date().toISOString().slice(0, 10);
        const SUB_CAPS = { sybil_hunt: DAILY_HUNT_CAP, scan_wallet: DAILY_SCAN_CAP };
        if (SUB_CAPS[source]) {
          const subKey = `subcap:${address}:${source}:${today}`;
          const subEntry = prismEarnRateLimit.get(subKey) || 0;
          if (subEntry >= SUB_CAPS[source]) return respondJson(res, 429, { error: `Daily ${source.replace('_', ' ')} cap reached (${SUB_CAPS[source]} coins/day)`, dailyRemaining: 0 });
          if (scanRewardState && subEntry + earned > SUB_CAPS[source]) {
            return respondJson(res, 429, {
              error: `Verified ${source.replace('_', ' ')} reward would exceed daily cap`,
              dailyRemaining: Math.max(0, SUB_CAPS[source] - subEntry),
            });
          }
          if (!scanRewardState) earned = Math.min(earned, SUB_CAPS[source] - subEntry);
          prismEarnRateLimit.set(subKey, subEntry + earned);
        }
        // Global non-game daily cap
        const ngKey = `nongame_daily:${address}`;
        const ngEntry = prismEarnRateLimit.get(ngKey);
        let ngEarned = 0;
        if (ngEntry && typeof ngEntry === 'object' && ngEntry.date === today) {
          ngEarned = ngEntry.total || 0;
        }
        if (ngEarned >= NON_GAME_DAILY_EARN_CAP) return respondJson(res, 429, { error: 'Daily earn cap reached', dailyRemaining: 0 });
        if (scanRewardState && ngEarned + earned > NON_GAME_DAILY_EARN_CAP) {
          return respondJson(res, 429, {
            error: 'Not enough daily earn cap remaining for verified reward',
            dailyRemaining: Math.max(0, NON_GAME_DAILY_EARN_CAP - ngEarned),
          });
        }
        if (!scanRewardState) earned = Math.min(earned, NON_GAME_DAILY_EARN_CAP - ngEarned);
        prismEarnRateLimit.set(ngKey, { date: today, total: ngEarned + earned });
        // Apply staking boost AFTER cap (bonus coins don't count towards cap)
        const earnBoost = getStakingBoost(address);
        if (earnBoost > 0) earned = Math.floor(earned * (1 + earnBoost));
        if (scanRewardState && scanRewardTarget) {
          const nextScanRewardState = normalizeScanRewardState(scanRewardState);
          if (source === 'scan_wallet') nextScanRewardState.cleanClaims[scanRewardTarget] = Date.now();
          if (source === 'sybil_hunt') nextScanRewardState.sybilClaims[scanRewardTarget] = Date.now();
          updateWalletEntry(address, { _scanRewardState: nextScanRewardState });
        }
      }
      const prevBal = getCoinBalance(address);
      const newBal = prevBal + earned;
      setCoinBalance(address, newBal);
      addCoinEarned(address, earned);
      // ── Sync coins to wallet database ──
      const wEarn = walletDatabase.get(address);
      if (wEarn) { wEarn.coins = newBal; saveWalletDatabaseDebounced(); }
      const bal = getPrismBalance(address);
      const tx = {
        id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        address, amount: earned, type: 'earn', source: source || 'unknown',
        description: description || `Earned ${earned} Coins`,
        timestamp: new Date().toISOString(),
      };
      const txs = prismTransactions.get(address) || [];
      txs.unshift(tx);
      if (txs.length > 500) txs.length = 500;
      prismTransactions.set(address, txs);
      debouncedSavePrism();
      feedItems.unshift({
        id: tx.id, type: source?.includes('burn') ? 'burn' : source?.includes('game') ? 'achievement' : 'scan',
        address, description: description || `Earned ${earned} Coins from ${source}`,
        timestamp: tx.timestamp,
      });
      if (feedItems.length > 200) feedItems.length = 200;
      // Track social stats for challenge wins
      if (source === 'challenge_win') {
        const wCh = walletDatabase.get(address) || {};
        const ssCh = wCh.socialStats || { challengesWon: 0, constellationExplored: 0, compareCount: 0 };
        ssCh.challengesWon = (ssCh.challengesWon || 0) + 1;
        updateWalletEntry(address, { socialStats: ssCh });
      }
      // Quest milestone notification
      if (source === 'quest_milestone') {
        const questName = description || 'Quest';
        pushNotification(address, 'quest_milestone', `Quest completed: ${questName}`, { questId: questId || null });
      }
      respondJson(res, 200, { balance: bal, earned });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  if (pathname === '/api/blackhole/claim' && req.method === 'POST') {
    if (!ipRateLimit('blackhole_claim', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      cleanupBlackHoleUsedSignatures();
      const parsed = JSON.parse(await readBody(req));
      const opsRaw = Array.isArray(parsed?.operations) ? parsed.operations : [];
      if (opsRaw.length === 0 || opsRaw.length > 64) {
        respondJson(res, 400, { error: 'operations array is required' });
        return;
      }

      const operations = opsRaw.map((op) => {
        const account = normalizePubkey(op?.account);
        const mint = normalizePubkey(op?.mint);
        const action = String(op?.action || '').trim();
        const closeSignature = String(op?.closeSignature || '').trim();
        const swapSignature = op?.swapSignature ? String(op.swapSignature).trim() : null;
        if (!account || !mint || !closeSignature) {
          throw new Error('Invalid Black Hole operation payload');
        }
        if (!['swap', 'burn', 'close'].includes(action)) {
          throw new Error('Invalid Black Hole action');
        }
        if (action === 'swap' && !swapSignature) {
          throw new Error('swapSignature required for swap operations');
        }
        return { account, mint, action, closeSignature, swapSignature };
      });

      const uniqueSignatures = [...new Set(operations.flatMap((op) => [op.closeSignature, op.swapSignature].filter(Boolean)))];
      for (const signature of uniqueSignatures) {
        if (blackHoleUsedSignatures.has(signature)) {
          respondJson(res, 400, { error: 'One or more signatures were already claimed' });
          return;
        }
      }

      // Optimistic lock: reserve signatures BEFORE async work to prevent race conditions
      for (const signature of uniqueSignatures) blackHoleUsedSignatures.set(signature, Date.now());
      let lockAcquired = true;

      const connection = new Connection(getRpcUrl(jwtAuth.address), 'confirmed');
      const txMap = new Map();
      try {
        for (const signature of uniqueSignatures) {
          const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
          if (!tx) {
            respondJson(res, 400, { error: `Transaction ${signature} not found or not confirmed yet` });
            return;
          }
          txMap.set(signature, tx);
        }
      } catch (rpcError) {
        // Release lock on RPC failure
        for (const signature of uniqueSignatures) blackHoleUsedSignatures.delete(signature);
        lockAcquired = false;
        throw rpcError;
      }

      const releaseLock = () => { for (const sig of uniqueSignatures) blackHoleUsedSignatures.delete(sig); };

      let holderPerks;
      try {
        holderPerks = await getIdentityHolderPerks(jwtAuth.address, { allowStale: true, throwOnLookupFailure: true });
      } catch {
        releaseLock();
        respondJson(res, 503, { error: 'Identity holder verification temporarily unavailable' });
        return;
      }

      const uniqueOperations = [];
      const seenOperations = new Set();
      for (const operation of operations) {
        const key = `${operation.action}:${operation.account}:${operation.mint}:${operation.closeSignature}:${operation.swapSignature || ''}`;
        if (seenOperations.has(key)) continue;
        seenOperations.add(key);
        uniqueOperations.push(operation);
      }

      let fungibleResolved = 0;
      let nftResolved = 0;
      const verifiedCommissionBySignature = new Map();
      for (const operation of uniqueOperations) {
        const closeTx = txMap.get(operation.closeSignature);
        if (!verifiedCommissionBySignature.has(operation.closeSignature)) {
          verifiedCommissionBySignature.set(
            operation.closeSignature,
            verifyBlackHoleCommissionTx(closeTx, jwtAuth.address, holderPerks.blackHoleCommissionRate),
          );
        }
        if (!verifiedCommissionBySignature.get(operation.closeSignature)) {
          releaseLock();
          respondJson(res, 400, { error: 'Black Hole commission verification failed' });
          return;
        }
        if (!verifyCloseOperationTx(closeTx, jwtAuth.address, operation.account)) {
          releaseLock();
          respondJson(res, 400, { error: 'Close transaction verification failed' });
          return;
        }
        if (operation.action === 'burn' && !verifyBurnOperationTx(closeTx, jwtAuth.address, operation.account, operation.mint)) {
          releaseLock();
          respondJson(res, 400, { error: 'Burn transaction verification failed' });
          return;
        }
        if (operation.action === 'swap') {
          const swapTx = txMap.get(operation.swapSignature);
          if (!verifySwapOperationTx(swapTx, jwtAuth.address, operation.account, operation.mint)) {
            releaseLock();
            respondJson(res, 400, { error: 'Swap transaction verification failed' });
            return;
          }
        }
        if (inferBlackHoleAssetKind(closeTx, operation.account, operation.mint) === 'nft') {
          nftResolved += 1;
        } else {
          fungibleResolved += 1;
        }
      }

      const netResolvedLamports = uniqueSignatures.reduce(
        (sum, signature) => sum + getWalletLamportDelta(txMap.get(signature), jwtAuth.address),
        0,
      );
      const netResolvedSol = netResolvedLamports / LAMPORTS_PER_SOL;
      let earned = calculateBlackHoleReward(fungibleResolved, nftResolved, netResolvedSol);

      const today = new Date().toISOString().slice(0, 10);
      const bhKey = `blackhole_cleanup:${jwtAuth.address}:${today}`;
      const bhToday = prismEarnRateLimit.get(bhKey) || 0;
      earned = Math.max(0, Math.min(earned, DAILY_BLACKHOLE_CLEANUP_CAP - bhToday));

      const ngKey = `nongame_daily:${jwtAuth.address}`;
      const ngEntry = prismEarnRateLimit.get(ngKey);
      let ngEarned = 0;
      if (ngEntry && typeof ngEntry === 'object' && ngEntry.date === today) {
        ngEarned = ngEntry.total || 0;
      }
      earned = Math.max(0, Math.min(earned, NON_GAME_DAILY_EARN_CAP - ngEarned));

      if (earned > 0) {
        prismEarnRateLimit.set(bhKey, bhToday + earned);
        prismEarnRateLimit.set(ngKey, { date: today, total: ngEarned + earned });
      }

      let credited = earned;
      const earnBoost = getStakingBoost(jwtAuth.address);
      if (credited > 0 && earnBoost > 0) credited = Math.floor(credited * (1 + earnBoost));

      if (credited > 0) {
        const prevBal = getCoinBalance(jwtAuth.address);
        const newBal = prevBal + credited;
        setCoinBalance(jwtAuth.address, newBal);
        addCoinEarned(jwtAuth.address, credited);
        const walletEntry = walletDatabase.get(jwtAuth.address);
        if (walletEntry) {
          walletEntry.coins = newBal;
          saveWalletDatabaseDebounced();
        }
        const tx = {
          id: `bh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          address: jwtAuth.address,
          amount: credited,
          type: 'earn',
          source: 'blackhole_cleanup',
          description: `Black Hole cleanup verified (${fungibleResolved + nftResolved} resolved)`,
          timestamp: new Date().toISOString(),
        };
        const txs = prismTransactions.get(jwtAuth.address) || [];
        txs.unshift(tx);
        if (txs.length > 500) txs.length = 500;
        prismTransactions.set(jwtAuth.address, txs);
        debouncedSavePrism();
        feedItems.unshift({
          id: tx.id,
          type: 'scan',
          address: jwtAuth.address,
          description: `Earned ${credited} PRISM from Black Hole cleanup`,
          timestamp: tx.timestamp,
        });
        if (feedItems.length > 200) feedItems.length = 200;
      }

      // Signatures already reserved via optimistic lock — just persist
      persistBlackHoleUsedSignatures();

      respondJson(res, 200, {
        earned: credited,
        balance: getPrismBalance(jwtAuth.address),
        netResolvedSol,
        fungibleResolved,
        nftResolved,
      });
    } catch (error) {
      // Release optimistic lock on any unhandled error
      if (typeof releaseLock === 'function') {
        releaseLock();
      } else if (typeof uniqueSignatures !== 'undefined') {
        for (const signature of uniqueSignatures) blackHoleUsedSignatures.delete(signature);
      }
      respondJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid request body' });
    }
    return;
  }

  // ═══ PRISM Spend ═══
  if (pathname === '/api/prism/spend' && req.method === 'POST') {
    if (!ipRateLimit('prism_spend', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const {
        address: bodyAddress,
        source,
        amount,
        description,
        itemId: rawItemId,
        moduleId: rawModuleId,
      } = JSON.parse(await readBody(req));
      const address = jwtAuth.address;
      if (bodyAddress && bodyAddress !== address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!address || !amount) return respondJson(res, 400, { error: 'address and amount required' });
      if (!Number.isFinite(Number(amount))) return respondJson(res, 400, { error: 'invalid amount' });
      const spent = Math.max(0, Math.floor(Number(amount)));
      if (spent <= 0 || spent > 1_000_000) return respondJson(res, 400, { error: 'amount out of range' });
      const sanitizedSource = typeof source === 'string' ? source.slice(0, 50) : 'unknown';
      const itemId = typeof rawItemId === 'string' ? rawItemId.trim() : '';
      const moduleId = typeof rawModuleId === 'string' ? rawModuleId.trim() : '';
      const walletEntry = walletDatabase.get(address) || { address };
      const { forgeState, changed: forgeStateChanged } = getOrCreateForgeState(address, walletEntry);
      const purchaseTimestamp = new Date().toISOString();

      if (sanitizedSource === 'forge_module') {
        const moduleDef = FORGE_MODULE_MAP.get(moduleId);
        if (!moduleDef) return respondJson(res, 400, { error: 'Valid moduleId required for forge module purchase' });
        if (spent !== Number(moduleDef.price)) return respondJson(res, 400, { error: 'Forge module price mismatch' });
        if (forgeState.modules.some((entry) => entry.moduleId === moduleId)) {
          return respondJson(res, 400, { error: 'Forge module already owned' });
        }
        forgeState.modules = mergeForgeEntries(forgeState.modules, [{ moduleId, purchasedAt: purchaseTimestamp }], 'moduleId');
      } else if (sanitizedSource.startsWith('forge_')) {
        const itemDef = FORGE_ITEM_MAP.get(itemId);
        if (!itemDef) return respondJson(res, 400, { error: 'Valid itemId required for forge purchase' });
        if (sanitizedSource !== `forge_${itemDef.category}`) return respondJson(res, 400, { error: 'Forge item source mismatch' });
        if (spent !== Number(itemDef.price)) return respondJson(res, 400, { error: 'Forge item price mismatch' });
        if (forgeState.items.some((entry) => entry.itemId === itemId)) {
          return respondJson(res, 400, { error: 'Forge item already owned' });
        }
        const rangerSnapshot = getServerRangerSnapshot(address, walletEntry);
        if (!meetsForgeRequiredRank(rangerSnapshot.rank, itemDef.requiredRank)) {
          return respondJson(res, 400, { error: `Requires ${itemDef.requiredRank} rank` });
        }
        if (!isForgeUnlockSatisfied(address, itemId, walletEntry, forgeState)) {
          return respondJson(res, 400, { error: 'Forge unlock condition not met' });
        }
        forgeState.items = mergeForgeEntries(forgeState.items, [{ itemId, purchasedAt: purchaseTimestamp }], 'itemId');
      }

      const currentBal = getCoinBalance(address);
      if (currentBal < spent) return respondJson(res, 400, { error: 'insufficient balance' });
      // Apply 2% burn fee
      const { burned } = applyBurnFee(spent);
      const newBal = currentBal - spent;
      setCoinBalance(address, newBal);
      addCoinSpent(address, spent);
      updateWalletEntry(address, {
        coins: newBal,
        ...(forgeStateChanged || sanitizedSource.startsWith('forge_') ? { forgeState } : {}),
      });
      const tx = {
        id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        address, amount: spent, type: 'spend',
        source: sanitizedSource,
        description: (typeof description === 'string' ? description.slice(0, 200) : `Spent ${spent} Coins (${burned} burned)`),
        timestamp: purchaseTimestamp,
      };
      const txs = prismTransactions.get(address) || [];
      txs.unshift(tx);
      if (txs.length > 500) txs.length = 500;
      prismTransactions.set(address, txs);
      debouncedSavePrism();
      respondJson(res, 200, { balance: getPrismBalance(address), spent });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  // ═══ PRISM Buy Coins ═══
  // Replay protection map with TTL (48h auto-cleanup) + file persistence
  const USED_TX_FILE = path.join(METADATA_DIR, 'used-tx-signatures.json');
  const usedBuyTxSignatures = globalThis._usedBuyTxMap || (() => {
    const m = new Map();
    try { const d = JSON.parse(fs.readFileSync(USED_TX_FILE, 'utf8')); for (const [k, v] of Object.entries(d)) m.set(k, v); } catch {}
    return (globalThis._usedBuyTxMap = m);
  })();
  // Periodic cleanup of expired entries (every 1000 requests) + persist
  if (!globalThis._buyTxCleanupCounter) globalThis._buyTxCleanupCounter = 0;
  if (++globalThis._buyTxCleanupCounter % 1000 === 0) {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    for (const [sig, ts] of usedBuyTxSignatures) { if (ts < cutoff) usedBuyTxSignatures.delete(sig); }
    const _txTmp = USED_TX_FILE + '.tmp';
    const _txObj = {}; for (const [k, v] of usedBuyTxSignatures) _txObj[k] = v;
    fs.promises.writeFile(_txTmp, JSON.stringify(_txObj), 'utf8').then(() => fs.promises.rename(_txTmp, USED_TX_FILE)).catch(() => {});
  }
  // Daily purchase tracking (persisted to survive restarts)
  const DAILY_PURCHASES_FILE = path.join(METADATA_DIR, 'daily-purchases.json');
  const dailyPurchases = globalThis._dailyPurchases || (() => {
    const m = new Map();
    try {
      const d = JSON.parse(fs.readFileSync(DAILY_PURCHASES_FILE, 'utf8'));
      const today = new Date().toISOString().slice(0, 10);
      for (const [k, v] of Object.entries(d)) { if (k.endsWith(`:${today}`)) m.set(k, v); }
    } catch {}
    return (globalThis._dailyPurchases = m);
  })();

  const COIN_PACKAGES = [
    { coins: 5000,    solPrice: 0.015 },
    { coins: 15000,   solPrice: 0.038 },
    { coins: 50000,   solPrice: 0.11 },
    { coins: 150000,  solPrice: 0.23 },
  ];
  const DAILY_COIN_LIMIT = 300000;

  if (pathname === '/api/prism/buy/status' && req.method === 'GET') {
    if (!ipRateLimit('buy_status', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const address = url.searchParams.get('address');
    if (!address) return respondJson(res, 400, { error: 'address required' });
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid address format' });
    const today = new Date().toISOString().slice(0, 10);
    const dayKey = `${address}:${today}`;
    const purchasedToday = dailyPurchases.get(dayKey) || 0;
    respondJson(res, 200, {
      purchasedToday,
      remainingToday: Math.max(0, DAILY_COIN_LIMIT - purchasedToday),
      packages: COIN_PACKAGES,
    });
    return;
  }

  if (pathname === '/api/prism/buy' && req.method === 'POST') {
    if (!ipRateLimit('prism_buy', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const { packageIndex, txSignature } = JSON.parse(await readBody(req));
      const address = jwtAuth.address;
      if (!address) return respondJson(res, 400, { error: 'address required' });

      // Validate package
      const pkgIdx = Number(packageIndex);
      if (pkgIdx < 0 || pkgIdx >= COIN_PACKAGES.length) return respondJson(res, 400, { error: 'Invalid package' });
      const pkg = COIN_PACKAGES[pkgIdx];

      // Daily limit check
      const today = new Date().toISOString().slice(0, 10);
      const dayKey = `${address}:${today}`;
      const purchasedToday = dailyPurchases.get(dayKey) || 0;
      if (purchasedToday + pkg.coins > DAILY_COIN_LIMIT) {
        return respondJson(res, 400, { error: `Daily limit reached. Purchased today: ${purchasedToday}/${DAILY_COIN_LIMIT}` });
      }

      // Replay protection — reserve BEFORE async verification to prevent race condition
      if (!txSignature || typeof txSignature !== 'string') return respondJson(res, 400, { error: 'txSignature required' });
      if (usedBuyTxSignatures.has(txSignature)) return respondJson(res, 400, { error: 'Transaction already used' });
      usedBuyTxSignatures.set(txSignature, Date.now()); // reserve immediately with timestamp

      // Verify on-chain transaction
      try {
        const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
        const tx = await conn.getParsedTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
        if (!tx) { usedBuyTxSignatures.delete(txSignature); return respondJson(res, 400, { error: 'Transaction not found. Wait for confirmation and retry.' }); }
        const treasuryAddr = TREASURY_ADDRESS || '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
        const instructions = tx.transaction?.message?.instructions || [];
        const validTransfer = instructions.some(ix => {
          if (ix.programId?.toBase58?.() === '11111111111111111111111111111111' && ix.parsed?.type === 'transfer') {
            const info = ix.parsed.info;
            return info.source === address && info.destination === treasuryAddr && info.lamports >= Math.floor(pkg.solPrice * 1e9 * 0.99);
          }
          return false;
        });
        if (!validTransfer) { usedBuyTxSignatures.delete(txSignature); return respondJson(res, 400, { error: 'SOL transfer to treasury not verified' }); }
      } catch (e) {
        usedBuyTxSignatures.delete(txSignature); // release on error so user can retry
        console.error('[buy] Transaction verification failed:', e.message);
        return respondJson(res, 400, { error: 'Transaction verification failed' });
      }

      // Credit coins
      const prevBuyBal = getCoinBalance(address);
      setCoinBalance(address, prevBuyBal + pkg.coins);
      addCoinEarned(address, pkg.coins);

      // Sync to wallet database
      const wBuy = walletDatabase.get(address);
      if (wBuy) { wBuy.coins = prevBuyBal + pkg.coins; saveWalletDatabaseDebounced(); }

      // Update daily tracking + persist
      dailyPurchases.set(dayKey, purchasedToday + pkg.coins);
      { const _dpTmp = DAILY_PURCHASES_FILE + '.tmp'; const _dpObj = {}; for (const [k, v] of dailyPurchases) _dpObj[k] = v;
        fs.promises.writeFile(_dpTmp, JSON.stringify(_dpObj), 'utf8').then(() => fs.promises.rename(_dpTmp, DAILY_PURCHASES_FILE)).catch(() => {}); }
      // Persist used tx signature immediately (survive restart)
      { const _txTmp = USED_TX_FILE + '.tmp'; const _txObj = {}; for (const [k, v] of usedBuyTxSignatures) _txObj[k] = v;
        fs.promises.writeFile(_txTmp, JSON.stringify(_txObj), 'utf8').then(() => fs.promises.rename(_txTmp, USED_TX_FILE)).catch(() => {}); }

      // Log transaction
      const txLog = {
        id: `buy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        address, amount: pkg.coins, type: 'buy', source: 'sol_purchase',
        description: `Purchased ${pkg.coins} Coins for ${pkg.solPrice} SOL`,
        timestamp: new Date().toISOString(),
        solTx: txSignature,
      };
      const txs = prismTransactions.get(address) || [];
      txs.unshift(txLog);
      if (txs.length > 500) txs.length = 500;
      prismTransactions.set(address, txs);
      debouncedSavePrism();

      respondJson(res, 200, { balance: getPrismBalance(address), purchased: pkg.coins, solPaid: pkg.solPrice });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  // ═══ Buy Coins with SKR — quote ═══
  if (pathname === '/api/prism/buy/skr-quote' && req.method === 'GET') {
    if (!ipRateLimit('buy_skr_quote', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    try {
      const [solUsd, skrUsd] = await Promise.all([getCachedSolPriceUsd(), getCachedSkrPriceUsd()]);
      if (!solUsd || !skrUsd) return respondJson(res, 503, { error: 'Price data unavailable' });
      const quotes = COIN_PACKAGES.map(pkg => {
        const pkgUsd = pkg.solPrice * solUsd;
        const skrAmount = Math.max(1, Math.ceil(pkgUsd / skrUsd));
        return { coins: pkg.coins, solPrice: pkg.solPrice, skrPrice: skrAmount };
      });
      respondJson(res, 200, { quotes, solUsd, skrUsd });
    } catch { respondJson(res, 500, { error: 'Failed to fetch SKR quote' }); }
    return;
  }

  // ═══ Buy Coins with SKR — purchase ═══
  if (pathname === '/api/prism/buy/skr' && req.method === 'POST') {
    if (!ipRateLimit('prism_buy_skr', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const { packageIndex, txSignature } = JSON.parse(await readBody(req));
      const address = jwtAuth.address;
      if (!address) return respondJson(res, 400, { error: 'address required' });

      const pkgIdx = Number(packageIndex);
      if (pkgIdx < 0 || pkgIdx >= COIN_PACKAGES.length) return respondJson(res, 400, { error: 'Invalid package' });
      const pkg = COIN_PACKAGES[pkgIdx];

      // Daily limit check
      const today = new Date().toISOString().slice(0, 10);
      const dayKey = `${address}:${today}`;
      const purchasedToday = dailyPurchases.get(dayKey) || 0;
      if (purchasedToday + pkg.coins > DAILY_COIN_LIMIT) {
        return respondJson(res, 400, { error: `Daily limit reached. Purchased today: ${purchasedToday}/${DAILY_COIN_LIMIT}` });
      }

      if (!txSignature || typeof txSignature !== 'string') return respondJson(res, 400, { error: 'txSignature required' });
      if (usedBuyTxSignatures.has(txSignature)) return respondJson(res, 400, { error: 'Transaction already used' });
      usedBuyTxSignatures.set(txSignature, Date.now());

      // Compute expected SKR amount
      const [solUsd, skrUsd] = await Promise.all([getCachedSolPriceUsd(), getCachedSkrPriceUsd()]);
      if (!solUsd || !skrUsd) { usedBuyTxSignatures.delete(txSignature); return respondJson(res, 503, { error: 'Price data unavailable' }); }
      const pkgUsd = pkg.solPrice * solUsd;
      const expectedSkrAmount = Math.max(1, Math.ceil(pkgUsd / skrUsd));

      // Verify on-chain SPL token transfer
      try {
        const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
        const tx = await conn.getParsedTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
        if (!tx) { usedBuyTxSignatures.delete(txSignature); return respondJson(res, 400, { error: 'Transaction not found. Wait for confirmation and retry.' }); }
        const treasuryAddr = TREASURY_ADDRESS || '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
        const treasuryKey = parsePublicKey(treasuryAddr, 'TREASURY_ADDRESS');
        const skrMintKey = parsePublicKey(SKR_MINT, 'SKR_MINT');
        if (!treasuryKey || !skrMintKey) {
          usedBuyTxSignatures.delete(txSignature);
          return respondJson(res, 500, { error: 'SKR treasury configuration invalid' });
        }
        const mintInfo = await getMint(conn, skrMintKey, undefined, TOKEN_PROGRAM_ID)
          .then((info) => ({ info, programId: TOKEN_PROGRAM_ID }))
          .catch(async () => {
            const info = await getMint(conn, skrMintKey, undefined, TOKEN_2022_PROGRAM_ID);
            return { info, programId: TOKEN_2022_PROGRAM_ID };
          });
        const treasuryAta = await getAssociatedTokenAddress(
          skrMintKey,
          treasuryKey,
          false,
          mintInfo.programId,
        );
        const treasuryAtaStr = treasuryAta.toBase58();
        const instructions = tx.transaction?.message?.instructions || [];
        const skrMintAddr = skrMintKey.toBase58();
        const validTransfer = instructions.some(ix => {
          const parsed = ix.parsed;
          if (!parsed) return false;
          if (parsed.type === 'transferChecked' || parsed.type === 'transfer') {
            const info = parsed.info;
            const authority = String(info.authority || info.multisigAuthority || '');
            const destination = String(info.destination || '');
            if (authority !== address || destination !== treasuryAtaStr) return false;
            const mint = String(info.mint || '');
            const amount = parsed.type === 'transferChecked'
              ? Number(info.tokenAmount?.uiAmount ?? info.tokenAmount?.uiAmountString ?? 0)
              : Number(info.amount || 0) / 10 ** (mintInfo.info.decimals || 0);
            // Accept if at least 95% of expected amount (rounding tolerance)
            const minAmount = expectedSkrAmount * 0.95;
            if (parsed.type === 'transferChecked') {
              if (mint !== skrMintAddr) return false;
              return Number.isFinite(amount) && amount >= minAmount;
            }
            return Number.isFinite(amount) && amount >= minAmount;
          }
          return false;
        });
        if (!validTransfer) { usedBuyTxSignatures.delete(txSignature); return respondJson(res, 400, { error: 'SKR transfer to treasury not verified' }); }
      } catch (e) {
        usedBuyTxSignatures.delete(txSignature);
        console.error('[buy-skr] Transaction verification failed:', e.message);
        return respondJson(res, 400, { error: 'Transaction verification failed' });
      }

      // Credit coins
      const prevBuyBal = getCoinBalance(address);
      setCoinBalance(address, prevBuyBal + pkg.coins);
      addCoinEarned(address, pkg.coins);

      const wBuy = walletDatabase.get(address);
      if (wBuy) { wBuy.coins = prevBuyBal + pkg.coins; saveWalletDatabaseDebounced(); }

      dailyPurchases.set(dayKey, purchasedToday + pkg.coins);
      { const _dpTmp = DAILY_PURCHASES_FILE + '.tmp'; const _dpObj = {}; for (const [k, v] of dailyPurchases) _dpObj[k] = v;
        fs.promises.writeFile(_dpTmp, JSON.stringify(_dpObj), 'utf8').then(() => fs.promises.rename(_dpTmp, DAILY_PURCHASES_FILE)).catch(() => {}); }
      { const _txTmp = USED_TX_FILE + '.tmp'; const _txObj = {}; for (const [k, v] of usedBuyTxSignatures) _txObj[k] = v;
        fs.promises.writeFile(_txTmp, JSON.stringify(_txObj), 'utf8').then(() => fs.promises.rename(_txTmp, USED_TX_FILE)).catch(() => {}); }

      const txLog = {
        id: `buy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        address, amount: pkg.coins, type: 'buy', source: 'skr_purchase',
        description: `Purchased ${pkg.coins} Coins for ${expectedSkrAmount} SKR`,
        timestamp: new Date().toISOString(),
        solTx: txSignature,
      };
      const txs = prismTransactions.get(address) || [];
      txs.unshift(txLog);
      if (txs.length > 500) txs.length = 500;
      prismTransactions.set(address, txs);
      debouncedSavePrism();

      respondJson(res, 200, { balance: getPrismBalance(address), purchased: pkg.coins, skrPaid: expectedSkrAmount });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  // ═══ PRISM Transaction History ═══
  if (pathname === '/api/prism/transactions' && req.method === 'GET') {
    if (!ipRateLimit('prism_txs', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const address = jwtAuth.address;
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    if (!address) return respondJson(res, 400, { error: 'address required' });
    const txs = (prismTransactions.get(address) || []).slice(0, limit);
    respondJson(res, 200, txs);
    return;
  }

  // ═══ Sybil Analysis (Comprehensive — 18+ signals) ═══
  if (pathname === '/api/sybil/analysis' && req.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address) return respondJson(res, 400, { error: 'address required' });
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    // Serve from cache first (no rate limit for cached results)
    const cached = sybilCache.get(address);
    if (cached && Date.now() - cached.cachedAt < 3600_000) {
      return respondJson(res, 200, cached.analysis);
    }
    // In-flight dedup: if the same address is already being analyzed, wait for it
    if (sybilInFlight.has(address)) {
      try {
        const result = await sybilInFlight.get(address);
        return respondJson(res, 200, result);
      } catch {
        return respondJson(res, 500, { error: 'Analysis failed (in-flight)' });
      }
    }
    // Rate limit: 5 new analyses per minute per IP (cache + in-flight dedup handles the rest)
    if (!ipRateLimit('sybil_new', getClientIp(req), 5, 60_000)) {
      return respondJson(res, 429, { error: 'Rate limited. Try again in a minute.' });
    }
    // Wrap in a shared promise for in-flight dedup
    const analysisPromise = (async () => {
    try {
      const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
      const pubkey = new PublicKey(address);

      // Fetch balance, first page of signatures, and token accounts in parallel
      const [balanceResult, signaturesResult, tokenAccountsResult] = await Promise.allSettled([
        conn.getBalance(pubkey),
        conn.getSignaturesForAddress(pubkey, { limit: 1000 }),
        conn.getParsedTokenAccountsByOwner(pubkey, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }),
      ]);
      const balance = balanceResult.status === 'fulfilled' ? balanceResult.value / 1e9 : 0;
      const signatures = signaturesResult.status === 'fulfilled' ? signaturesResult.value : [];
      const tokenAccounts = tokenAccountsResult.status === 'fulfilled' ? tokenAccountsResult.value?.value || [] : [];

      // ── Phase 1: Paginate ALL signatures (up to 10K) — single pass for timing + age ──
      // Replaces separate findFirstTxTime pagination — saves ~100-300 credits per scan.
      // getSignaturesForAddress = 10 credits/call, so 10 pages = 100 credits total.
      let allSignatures = [...signatures]; // starts with first 1000
      let oldestSig = signatures.length > 0 ? signatures[signatures.length - 1] : null;
      const cachedWallet = walletDatabase.get(address);
      const cachedFirstTx = cachedWallet?.firstTxTimestamp || null;
      const sybilRpcUrl = getRpcUrl(address) || 'https://api.mainnet-beta.solana.com';
      let earlySignatures = []; // will hold the earliest page of sigs
      let paginationReachedEnd = signatures.length < 1000; // true if wallet has < 1000 tx total

      if (signatures.length >= 1000) {
        // Paginate to collect up to 10K signatures + capture earliest page
        let cursor = signatures[signatures.length - 1]?.signature;
        for (let page = 1; page < 10 && cursor; page++) {
          try {
            const moreSigs = await conn.getSignaturesForAddress(pubkey, { before: cursor, limit: 1000 });
            if (moreSigs.length === 0) { paginationReachedEnd = true; break; }
            allSignatures.push(...moreSigs);
            cursor = moreSigs[moreSigs.length - 1].signature;
            earlySignatures = moreSigs; // last page = earliest signatures
            // Update oldest
            const lastSig = moreSigs[moreSigs.length - 1];
            if (lastSig?.blockTime && (!oldestSig?.blockTime || lastSig.blockTime < oldestSig.blockTime)) {
              oldestSig = lastSig;
            }
            if (moreSigs.length < 1000) { paginationReachedEnd = true; break; }
          } catch { break; }
        }
      }
      const totalSigCount = allSignatures.length;

      // Determine wallet age from our pagination (no duplicate findFirstTxTime for ≤10K wallets)
      const SOLANA_GENESIS = 1584000000;
      let firstTxBlockTime = null;
      if (paginationReachedEnd && allSignatures.length > 0) {
        // We have ALL signatures — oldest is exact, no need for findFirstTxTime
        for (let i = allSignatures.length - 1; i >= 0; i--) {
          if (allSignatures[i].blockTime > SOLANA_GENESIS) {
            firstTxBlockTime = allSignatures[i].blockTime;
            break;
          }
        }
      } else if (oldestSig?.blockTime > SOLANA_GENESIS) {
        // >10K txs — use our pagination's oldest as starting point
        firstTxBlockTime = oldestSig.blockTime;
      }
      if (firstTxBlockTime && (!oldestSig?.blockTime || firstTxBlockTime < oldestSig.blockTime)) {
        oldestSig = { ...(oldestSig || {}), blockTime: firstTxBlockTime };
      }

      // ── Phase 2: Parse latest 200 + earliest 100 transactions in parallel ──
      const recentSigBatch = allSignatures.slice(0, 200).map(s => s.signature);
      const earlySigs = earlySignatures.length > 0
        ? earlySignatures.slice(-100)
        : (allSignatures.length > 300 ? allSignatures.slice(-100) : []);
      const earlySigBatch = earlySigs.map(s => s.signature);
      const recentSet = new Set(recentSigBatch);
      const dedupedEarlySigBatch = earlySigBatch.filter(s => !recentSet.has(s));

      let parsedTxs = [];
      let earlyParsedTxs = [];

      // Build parse batches (groups of 25)
      const recentBatches = [];
      for (let i = 0; i < recentSigBatch.length; i += 25) recentBatches.push(recentSigBatch.slice(i, i + 25));
      const earlyBatches = [];
      for (let i = 0; i < dedupedEarlySigBatch.length; i += 25) earlyBatches.push(dedupedEarlySigBatch.slice(i, i + 25));

      // Only call findFirstTxTime for wallets >10K tx (binary search for exact age)
      // For ≤10K wallets, we already have exact age from Phase 1 — saves 100-300 credits
      const needsBinarySearch = !paginationReachedEnd;
      // Run firstTxTime in parallel with sequential batch parsing (avoids RPC rate-limit 429s)
      const firstTxPromise = needsBinarySearch
        ? findFirstTxTime(conn, pubkey, allSignatures.slice(-1000), cachedFirstTx, sybilRpcUrl)
        : Promise.resolve({ firstTxTime: firstTxBlockTime, totalSigs: totalSigCount });

      // Wait for firstTxTime + rate limit recovery before Phase 2 parsing
      const firstTxResult = await Promise.allSettled([firstTxPromise]).then(r => r[0]);
      await new Promise(r => setTimeout(r, 1500)); // let RPC rate limit bucket refill

      // ── Phase 2 parsing via JSON-RPC batch (up to 100 getTransaction per HTTP call) ──
      // Max 100 per batch at same credit cost — more data = better detection
      const parseRpcUrl = getBatchRpcUrl(address + ':parse');
      const limitedRecent = recentSigBatch.slice(0, 100);
      const limitedEarly = dedupedEarlySigBatch.slice(0, 100);
      // Combine: up to 200 sigs → 2 batch calls of 100
      const parseSigs = [...limitedRecent, ...limitedEarly];
      const recentCount = limitedRecent.length;

      const allParsedResults = await batchGetParsedTxs(parseRpcUrl, parseSigs, { batchSize: 100, delayMs: 500 });

      // Process wallet age result
      const ftResult = firstTxResult.status === 'fulfilled' ? firstTxResult.value : null;
      const resolvedFirstTxTime = ftResult?.firstTxTime ?? firstTxBlockTime;
      if (resolvedFirstTxTime && (!oldestSig?.blockTime || resolvedFirstTxTime < oldestSig.blockTime)) {
        oldestSig = { ...(oldestSig || {}), blockTime: resolvedFirstTxTime };
      }
      if (resolvedFirstTxTime && (!cachedFirstTx || resolvedFirstTxTime < cachedFirstTx)) {
        updateWalletEntry(address, { firstTxTimestamp: resolvedFirstTxTime });
      }
      // Update txCount
      const bestTxCount = Math.max(totalSigCount, ftResult?.totalSigs || 0, cachedWallet?.stats?.transactions || 0);
      if (bestTxCount > (cachedWallet?.stats?.transactions || 0)) {
        updateWalletEntry(address, { stats: { ...(cachedWallet?.stats || {}), transactions: bestTxCount } });
      }

      // Split flat results array: first recentCount are recent, rest are early
      parsedTxs = allParsedResults.slice(0, recentCount).filter(Boolean);
      earlyParsedTxs = allParsedResults.slice(recentCount).filter(Boolean);

      // ── Derive metrics from ALL 10K signatures ──

      const timestamps = allSignatures.filter(s => s.blockTime).map(s => s.blockTime * 1000);
      const nowMs = Date.now();

      // 1. Wallet Age (uses paginated oldest tx)
      const walletAgeDays = oldestSig?.blockTime ? Math.round((nowMs / 1000 - oldestSig.blockTime) / 86400) : 0;

      // 2. Transaction Timing Variance (Coefficient of Variation)
      let timingVariance = 1;
      let timingCV = 999;
      let isRobotic = false;
      if (timestamps.length >= 10) {
        const sorted = [...timestamps].sort((a, b) => a - b);
        const intervals = [];
        for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1]);
        const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
        if (mean > 0) {
          const stdDev = Math.sqrt(intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length);
          timingCV = stdDev / mean;
          timingVariance = Math.min(1, timingCV / 1.5);
          isRobotic = timingCV < 0.25 && intervals.length >= 30;
        }
      }

      // 3. Active Days Ratio
      const uniqueDays = new Set(timestamps.map(t => new Date(t).toISOString().slice(0, 10)));
      const activeDaysCount = uniqueDays.size;
      const totalLifespanDays = Math.max(walletAgeDays, 1);
      const activeDaysRatio = activeDaysCount / totalLifespanDays;

      // 4. Token Diversity (from token accounts)
      const uniqueTokenMints = new Set();
      let nftCount = 0;
      for (const acc of tokenAccounts) {
        const info = acc.account?.data?.parsed?.info;
        if (!info) continue;
        const mint = info.mint;
        const amount = parseFloat(info.tokenAmount?.uiAmountString || '0');
        const decimals = info.tokenAmount?.decimals ?? 0;
        if (amount > 0) {
          uniqueTokenMints.add(mint);
          // NFTs typically have decimals=0 and amount=1
          if (decimals === 0 && amount === 1) nftCount++;
        }
      }
      const tokenDiversityCount = uniqueTokenMints.size;

      // 5. Incoming vs Outgoing flow analysis + dust transactions + program diversity
      let incomingVolume = 0;
      let outgoingVolume = 0;
      let incomingCount = 0;
      let outgoingCount = 0;
      let dustTxCount = 0;
      let totalSolTxCount = 0;
      let historicalMaxBalance = balance; // start with current
      let runningBalance = balance;
      const allProgramIds = new Set();
      const incomingSenders = new Set();
      const outgoingRecipients = new Set();

      for (const tx of parsedTxs) {
        if (!tx?.meta || !tx?.transaction) continue;
        if (tx.meta.err) continue;

        // Collect program IDs for dApp interaction breadth
        const ixs = tx.transaction.message?.instructions || [];
        for (const ix of ixs) {
          const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
          if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') {
            allProgramIds.add(pid);
          }
        }
        const innerIxs = tx.meta.innerInstructions || [];
        for (const inner of innerIxs) {
          for (const iix of (inner.instructions || [])) {
            const pid = iix.programId?.toBase58?.() || (typeof iix.programId === 'string' ? iix.programId : '');
            if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') {
              allProgramIds.add(pid);
            }
          }
        }

        // SOL balance changes for target address + counterparties
        const accounts = tx.transaction.message?.accountKeys || [];
        const pre = tx.meta.preBalances || [];
        const post = tx.meta.postBalances || [];
        let targetIdx = -1;
        for (let i = 0; i < accounts.length; i++) {
          const acc = resolveAccountKey(accounts[i]);
          if (acc === address) { targetIdx = i; break; }
        }
        if (targetIdx >= 0) {
          const diffLamports = (post[targetIdx] || 0) - (pre[targetIdx] || 0);
          const diffSol = diffLamports / 1e9;
          if (Math.abs(diffSol) >= 0.0001) {
            totalSolTxCount++;
            if (diffSol > 0) { incomingVolume += diffSol; incomingCount++; }
            else { outgoingVolume += Math.abs(diffSol); outgoingCount++; }
            if (Math.abs(diffSol) < 0.001) dustTxCount++;
          }
          const preBal = (pre[targetIdx] || 0) / 1e9;
          if (preBal > historicalMaxBalance) historicalMaxBalance = preBal;
          // Identify counterparties: accounts with opposite balance change
          for (let i = 0; i < accounts.length; i++) {
            if (i === targetIdx) continue;
            const acc = resolveAccountKey(accounts[i]);
            if (!acc || acc === '11111111111111111111111111111111') continue;
            const otherDiff = ((post[i] || 0) - (pre[i] || 0)) / 1e9;
            if (TREASURY_WALLETS.has(acc)) continue; // skip treasury wallets
            if (diffSol > 0.001 && otherDiff < -0.001) incomingSenders.add(acc);
            if (diffSol < -0.001 && otherDiff > 0.001) outgoingRecipients.add(acc);
          }
        }
      }

      // 6. Multi-hop funding graph + .sol domain check — run in parallel
      let clusterSimilarity = 0;
      let fundingChainDepth = 0;
      let hubSpokeScore = 0;
      const allSiblings = new Set();
      let hasSolDomain = false;
      let topFunderPctExport = 0; // share of top funder in total received SOL
      let topFunderTxCount = 0; // how many times top funder sent to target
      let cexTrustBonus = 0; // CEX funding trust bonus — applied later to trustBonus

      let resolvedTopFunder = null; // shared: used for cluster key later
      let resolvedIncoming = null; // shared: expose for funding-sources cache
      const fundingGraphPromise = (async () => {
        try {
          // Combine recent + early txs for full funding picture (early txs contain first funding!)
          const allTxsForFunding = [...parsedTxs, ...earlyParsedTxs];
          const { incoming } = extractSolTransfers(allTxsForFunding, address);
          resolvedIncoming = incoming;
          let topFunder = null, topAmount = 0, topFunderCount = 0;
          for (const [addr, info] of incoming) {
            if (TREASURY_WALLETS.has(addr)) continue; // skip treasury
            if (info.totalSol > topAmount) { topFunder = addr; topAmount = info.totalSol; topFunderCount = info.count; }
          }
          topFunderTxCount = topFunderCount;
          resolvedTopFunder = topFunder; // expose for cluster key
          if (incoming.size === 0 && allTxsForFunding.length > 0) {
            console.warn(`[sybil-funding] ${address.slice(0,8)}: 0 funding sources from ${allTxsForFunding.length} parsed txs`);
          }
          if (topFunder && topAmount >= 0.01) {
            const totalReceived = [...incoming.values()].reduce((s, v) => s + v.totalSol, 0) || 1;
            const topFunderPct = topAmount / totalReceived;
            topFunderPctExport = topFunderPct;
            if (topFunderPct > 0.3) {
              fundingChainDepth = 1;
              // Skip cluster analysis if top funder is a known CEX/bridge (reduces false positives)
              const topFunderLabel = KNOWN_LABELS[topFunder];
              if (topFunderLabel && (topFunderLabel.type === 'cex' || topFunderLabel.type === 'bridge')) {
                // CEX/bridge funding is a positive KYC signal — skip sibling detection
                cexTrustBonus = 3;
              } else
              try {
                const funderSigs = await conn.getSignaturesForAddress(new PublicKey(topFunder), { limit: 100 });
                const funderBatch = funderSigs.map(s => s.signature);
                const funderParsed = (await batchGetParsedTxs(getBatchRpcUrl(topFunder), funderBatch, { batchSize: 100, delayMs: 300 })).filter(Boolean);
                for (const tx of funderParsed) {
                  if (!tx?.meta || !tx?.transaction) continue;
                  const accounts = tx.transaction.message?.accountKeys || [];
                  const pre = tx.meta.preBalances || [];
                  const post = tx.meta.postBalances || [];
                  // Collect program IDs from this tx to filter out non-wallet accounts
                  const txProgs = new Set();
                  for (const ix of (tx.transaction.message?.instructions || [])) {
                    const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
                    if (pid) txProgs.add(pid);
                  }
                  for (let i = 0; i < accounts.length; i++) {
                    const accObj = accounts[i];
                    const acc = resolveAccountKey(accObj);
                    const diff = ((post[i] || 0) - (pre[i] || 0)) / 1e9;
                    // Only add real wallet-like accounts: received SOL, not a program, is a signer or writable
                    const isSigner = typeof accObj === 'object' && accObj?.signer;
                    if (diff > 0.01 && acc !== topFunder && acc !== address && acc !== '11111111111111111111111111111111'
                        && !isProgramAddress(acc, txProgs)) {
                      allSiblings.add(acc);
                    }
                  }
                }
                hubSpokeScore = Math.min(1, allSiblings.size / 20);
                // Level 2: only if strong single-source signal
                if (topFunderPct > 0.5 && funderParsed.length > 0) {
                  try {
                    const { parsed: level2Parsed } = await fetchParsedTransactions(topFunder, 100);
                    const { incoming: level2In } = extractSolTransfers(level2Parsed, topFunder);
                    let grandFunder = null, grandAmount = 0;
                    for (const [addr, info] of level2In) {
                      if (TREASURY_WALLETS.has(addr)) continue; // skip treasury
                      if (info.totalSol > grandAmount) { grandFunder = addr; grandAmount = info.totalSol; }
                    }
                    if (grandFunder && grandAmount > 0.01) {
                      const totalL2 = [...level2In.values()].reduce((s, v) => s + v.totalSol, 0) || 1;
                      if (grandAmount / totalL2 > 0.7) {
                        fundingChainDepth = 2;
                        try {
                          const gfSigs = await conn.getSignaturesForAddress(new PublicKey(grandFunder), { limit: 100 });
                          const gfBatch = gfSigs.map(s => s.signature);
                          const gfTxs = await batchGetParsedTxs(getBatchRpcUrl(grandFunder), gfBatch, { batchSize: 100, delayMs: 300 });
                          for (const tx of (gfTxs || []).filter(Boolean)) {
                            if (!tx?.meta || !tx?.transaction) continue;
                            const accs = tx.transaction.message?.accountKeys || [];
                            const pre2 = tx.meta.preBalances || [];
                            const post2 = tx.meta.postBalances || [];
                            const txP2 = new Set();
                            for (const ix of (tx.transaction.message?.instructions || [])) {
                              const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
                              if (pid) txP2.add(pid);
                            }
                            for (let i = 0; i < accs.length; i++) {
                              const acc = resolveAccountKey(accs[i]);
                              const diff = ((post2[i] || 0) - (pre2[i] || 0)) / 1e9;
                              if (diff > 0.01 && acc !== grandFunder && acc !== topFunder && acc !== address
                                  && acc !== '11111111111111111111111111111111' && !isProgramAddress(acc, txP2)) {
                                allSiblings.add(acc);
                              }
                            }
                          }
                        } catch {}
                      }
                      // Record grandFunder in graph as suspicious intermediary
                      if (grandFunder && fundingChainDepth >= 2) {
                        updateSybilGraphNode(grandFunder, {
                          riskScore: Math.max((sybilGraph.nodes[grandFunder]?.riskScore || 0), 60),
                          inferredFromCluster: address,
                          fundedBy: [],
                          siblings: [topFunder, address],
                        });
                      }
                    }
                  } catch {}
                }
              } catch {}
              // Also record topFunder in graph if it's funding multiple wallets
              if (topFunder && allSiblings.size >= 2) {
                const existingFunderNode = sybilGraph.nodes[topFunder];
                if (!existingFunderNode || existingFunderNode.riskScore < 40) {
                  updateSybilGraphNode(topFunder, {
                    riskScore: Math.max((existingFunderNode?.riskScore || 0), 40),
                    siblings: [address, ...[...allSiblings].slice(0, 10)],
                  });
                }
              }
              if (allSiblings.size >= 2) {
                clusterSimilarity = Math.min(1, allSiblings.size / 12);
              }
            }
          }
        } catch {}
      })();

      const domainCheckPromise = (async () => {
        try {
          const NAME_PROGRAM = new PublicKey('namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX');
          const nameAccounts = await conn.getProgramAccounts(NAME_PROGRAM, {
            filters: [{ memcmp: { offset: 32, bytes: pubkey.toBase58() } }],
            dataSlice: { offset: 0, length: 1 },
          });
          hasSolDomain = nameAccounts.length > 0;
        } catch {}
      })();

      await Promise.allSettled([fundingGraphPromise, domainCheckPromise]);

      // 7. Time-of-day and day-of-week fingerprinting
      const hourBuckets = new Array(24).fill(0);
      const dayBuckets = new Array(7).fill(0);
      for (const ts of timestamps) {
        const d = new Date(ts);
        hourBuckets[d.getUTCHours()]++;
        dayBuckets[d.getUTCDay()]++;
      }
      // Shannon entropy for hour distribution (max = log2(24) ≈ 4.58 for uniform)
      let hourEntropy = 0;
      const totalTs = timestamps.length || 1;
      for (const count of hourBuckets) {
        if (count > 0) {
          const p = count / totalTs;
          hourEntropy -= p * Math.log2(p);
        }
      }
      // Entropy for timing intervals (replaces simple CV)
      let intervalEntropy = 0;
      if (timestamps.length >= 10) {
        const sorted = [...timestamps].sort((a, b) => a - b);
        const intervals = [];
        for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1]);
        // Bin intervals into 10 buckets by percentile for entropy calc
        const sortedIntervals = [...intervals].sort((a, b) => a - b);
        const binSize = Math.max(1, Math.floor(sortedIntervals.length / 10));
        const bins = new Array(10).fill(0);
        for (let i = 0; i < intervals.length; i++) {
          const bin = Math.min(9, Math.floor(i / binSize));
          bins[bin]++;
        }
        for (const count of bins) {
          if (count > 0) {
            const p = count / intervals.length;
            intervalEntropy -= p * Math.log2(p);
          }
        }
      }
      // Weekend ratio (sybil bots don't rest on weekends)
      const weekendTxs = dayBuckets[0] + dayBuckets[6]; // Sun + Sat
      const weekdayTxs = totalTs - weekendTxs;
      const weekendRatio = totalTs > 20 ? weekendTxs / totalTs : 0.28; // default neutral

      // 8. Airdrop farming pattern detection
      // Count programs with very few interactions (1-2 txs) — farmers touch many protocols minimally
      const programInteractionCounts = new Map();
      for (const tx of parsedTxs) {
        if (!tx?.meta || !tx?.transaction || tx.meta.err) continue;
        const ixs = tx.transaction.message?.instructions || [];
        const txPrograms = new Set();
        for (const ix of ixs) {
          const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
          if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') txPrograms.add(pid);
        }
        for (const pid of txPrograms) {
          programInteractionCounts.set(pid, (programInteractionCounts.get(pid) || 0) + 1);
        }
      }
      let shallowProtocols = 0; // protocols with only 1-2 interactions
      let deepProtocols = 0;    // protocols with 5+ interactions
      for (const [, count] of programInteractionCounts) {
        if (count <= 2) shallowProtocols++;
        if (count >= 5) deepProtocols++;
      }
      const farmingRatio = programInteractionCounts.size > 3
        ? shallowProtocols / programInteractionCounts.size : 0;

      // 9. DeFi depth scoring — check for known DeFi program interactions
      const DEFI_PROGRAMS = {
        // DEXes
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'jupiter',
        'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'orca',
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'raydium',
        'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'raydium_clmm',
        'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'meteora',
        // Lending
        'So1endDq2YkqhipRh3WViPa8hFb7GVEtcEMF3CBAK8h': 'solend',
        'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': 'marginfi',
        'KLend2g3cP87ber41GXWsSZQz9R1hGT2bVBaeEdnKHR': 'kamino',
        // Staking
        'CgDG2CLNqR2ypE3CXTMEq5R6J8FaqVjChn9Tfmwocs4Y': 'marinade',
        'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy': 'spl_stake_pool',
        'JitoSOL': 'jito',
        // Governance
        'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw': 'spl_governance',
        'GovHgfDPyQ1GwjFhNkMqZVs9EVecaH3MQ1Lmob5NLz2v': 'realms',
      };
      let defiCategories = new Set(); // 'dex', 'lending', 'staking', 'governance'
      for (const pid of allProgramIds) {
        const name = DEFI_PROGRAMS[pid];
        if (!name) continue;
        if (['jupiter', 'orca', 'raydium', 'raydium_clmm', 'meteora'].includes(name)) defiCategories.add('dex');
        if (['solend', 'marginfi', 'kamino'].includes(name)) defiCategories.add('lending');
        if (['marinade', 'spl_stake_pool', 'jito'].includes(name)) defiCategories.add('staking');
        if (['spl_governance', 'realms'].includes(name)) defiCategories.add('governance');
      }
      const defiDepth = defiCategories.size; // 0-4

      // ── Build Signals ──
      const signals = [];

      // --- Derived metrics for new signals ---
      // Self-transfers: target appears on both sending and receiving side
      let selfTransferCount = 0;
      for (const tx of parsedTxs) {
        if (!tx?.meta || !tx?.transaction || tx.meta.err) continue;
        const accounts = tx.transaction.message?.accountKeys || [];
        const pre = tx.meta.preBalances || [];
        const post = tx.meta.postBalances || [];
        let targetIdx = -1;
        for (let i = 0; i < accounts.length; i++) {
          const acc = resolveAccountKey(accounts[i]);
          if (acc === address) { targetIdx = i; break; }
        }
        if (targetIdx >= 0) {
          // Check inner instructions for self-transfer (System.Transfer to self)
          const ixs = tx.transaction.message?.instructions || [];
          for (const ix of ixs) {
            const parsed = ix.parsed;
            if (parsed?.type === 'transfer' && parsed?.info) {
              if (parsed.info.source === address && parsed.info.destination === address) selfTransferCount++;
            }
          }
        }
      }

      // Counterparty concentration: ratio of unique counterparties to total txs
      const totalCounterparties = incomingSenders.size + outgoingRecipients.size;
      const counterpartyRatio = totalSolTxCount > 5 ? totalCounterparties / totalSolTxCount : 1;

      // Activity burst detection: what % of active days are in the most active week
      let burstRatio = 0;
      if (timestamps.length >= 20 && walletAgeDays > 14) {
        const daySet = [...uniqueDays].sort();
        if (daySet.length >= 3) {
          let maxInWindow = 0;
          for (let i = 0; i < daySet.length; i++) {
            const windowStart = new Date(daySet[i]).getTime();
            const windowEnd = windowStart + 7 * 86400_000;
            let count = 0;
            for (let j = i; j < daySet.length; j++) {
              if (new Date(daySet[j]).getTime() <= windowEnd) count++;
              else break;
            }
            if (count > maxInWindow) maxInWindow = count;
          }
          burstRatio = maxInWindow / daySet.length;
        }
      }

      const uniquePrograms = allProgramIds.size;

      // Signal 0: No Transaction History — penalise wallets with zero or near-zero data
      // Without any activity there's no evidence of human behaviour; don't grant high trust
      const noHistory = totalSigCount < 3;
      const thinHistory = !noHistory && totalSigCount < 10 && walletAgeDays < 14;
      signals.push({
        id: 'no_history', name: noHistory ? 'No Transaction History' : 'Thin History', category: 'behavioral',
        detected: noHistory || thinHistory, weight: noHistory ? 30 : 15,
        severity: noHistory ? 'danger' : 'warning',
        value: `${totalSigCount} txs`,
        description: noHistory
          ? 'Wallet has virtually no transaction history — trust cannot be assessed'
          : `Only ${totalSigCount} transactions in ${walletAgeDays} days — insufficient data`,
      });

      // Signal 1: Wallet Age + Fresh Burst (MERGED — no double-counting)
      // Graduated: new wallet alone = moderate, new wallet + burst = high
      const isNewWallet = walletAgeDays < 30;
      const freshBurst = isNewWallet && totalSigCount > 50;
      signals.push({
        id: 'wallet_age', name: freshBurst ? 'Fresh Wallet Burst' : 'New Wallet', category: 'behavioral',
        detected: isNewWallet, weight: freshBurst ? 20 : 12,
        severity: freshBurst ? 'danger' : (isNewWallet ? 'warning' : 'info'),
        value: isNewWallet ? `${walletAgeDays}d / ${totalSigCount} txs` : `${walletAgeDays}d`,
        description: freshBurst
          ? `${totalSigCount} transactions in only ${walletAgeDays} days — suspicious burst`
          : (isNewWallet ? `Wallet is only ${walletAgeDays} days old` : `Wallet is ${walletAgeDays} days old`),
      });

      // Signal 2: Timing Pattern (MERGED — graduated single signal)
      // Robotic (CV < 0.25 + 20 txs) = full weight, Uniform (CV < 0.3) = lower weight
      const timingDetected = (isRobotic || (timingCV < 0.3 && timestamps.length >= 10));
      signals.push({
        id: 'timing_pattern', name: isRobotic ? 'Robotic Timing' : 'Uniform Timing', category: 'behavioral',
        detected: timingDetected, weight: isRobotic ? 18 : 10,
        severity: isRobotic ? 'danger' : (timingDetected ? 'warning' : 'info'),
        value: timingCV < 999 ? `CV ${timingCV.toFixed(2)}` : 'N/A',
        description: isRobotic
          ? 'Extreme timing uniformity — automated script detected'
          : (timingDetected ? 'Transactions are suspiciously evenly spaced' : 'Transaction timing appears natural'),
      });

      // Signal 3: Low Activity Ratio — dormant wallet suddenly active
      const lowActivityRatio = walletAgeDays > 60 && activeDaysRatio < 0.05;
      signals.push({
        id: 'low_activity_ratio', name: 'Low Activity Ratio', category: 'behavioral',
        detected: lowActivityRatio, weight: 8,
        severity: lowActivityRatio ? 'warning' : 'info',
        value: `${(activeDaysRatio * 100).toFixed(1)}%`,
        description: lowActivityRatio ? `Only active ${activeDaysCount} of ${totalLifespanDays} days (${(activeDaysRatio * 100).toFixed(1)}%)` : `Active ${activeDaysCount} of ${totalLifespanDays} days`,
      });

      // Signal 4: Activity Burst — most activity crammed into one week (NEW)
      const isBurst = burstRatio > 0.8 && activeDaysCount >= 3 && walletAgeDays > 30;
      signals.push({
        id: 'activity_burst', name: 'Activity Burst', category: 'behavioral',
        detected: isBurst, weight: 10,
        severity: isBurst ? 'warning' : 'info',
        value: `${(burstRatio * 100).toFixed(0)}% in 7d`,
        description: isBurst
          ? `${(burstRatio * 100).toFixed(0)}% of all active days fall within a single week — farming burst`
          : 'Activity is spread across wallet lifetime',
      });

      // Signal 5: Low Token Diversity
      const lowTokenDiv = tokenDiversityCount < 3;
      signals.push({
        id: 'low_token_diversity', name: 'Low Token Diversity', category: 'financial',
        detected: lowTokenDiv, weight: 5,
        severity: lowTokenDiv ? 'warning' : 'info',
        value: `${tokenDiversityCount} tokens`,
        description: lowTokenDiv ? `Only ${tokenDiversityCount} unique tokens held` : `Holds ${tokenDiversityCount} unique tokens`,
      });

      // Signal 6: No NFT Holdings
      const noNfts = nftCount === 0;
      signals.push({
        id: 'no_nft_holdings', name: 'No NFT Holdings', category: 'financial',
        detected: noNfts, weight: 4,
        severity: 'info',
        value: `${nftCount} NFTs`,
        description: noNfts ? 'Wallet holds no NFTs' : `Holds ${nftCount} NFTs`,
      });

      // Signal 7: One-Directional Flow
      const totalVolume = incomingVolume + outgoingVolume;
      const flowRatio = totalVolume > 0 ? Math.max(incomingVolume, outgoingVolume) / totalVolume : 0.5;
      const oneDirectional = totalVolume > 1.0 && flowRatio > 0.9 && totalSolTxCount >= 5;
      signals.push({
        id: 'one_directional_flow', name: 'One-Directional Flow', category: 'financial',
        detected: oneDirectional, weight: 10,
        severity: oneDirectional ? 'warning' : 'info',
        value: oneDirectional
          ? (incomingVolume > outgoingVolume ? `${(flowRatio * 100).toFixed(0)}% inbound` : `${(flowRatio * 100).toFixed(0)}% outbound`)
          : `${(flowRatio * 100).toFixed(0)}% / ${(100 - flowRatio * 100).toFixed(0)}%`,
        description: oneDirectional ? 'Heavily one-directional SOL flow (suspicious)' : 'Balanced SOL flow',
      });

      // Signal 8: Cluster Similarity — connected wallets from same funder
      const highClusterSim = clusterSimilarity > 0.3;
      signals.push({
        id: 'cluster_similarity', name: 'Cluster Similarity', category: 'network',
        detected: highClusterSim, weight: 15,
        severity: highClusterSim ? 'danger' : 'info',
        value: highClusterSim ? `${(clusterSimilarity * 100).toFixed(0)}% similar` : 'No cluster',
        description: highClusterSim ? 'Wallet shares funding source with multiple similar wallets' : 'No suspicious wallet clusters detected',
      });

      // Signal 9: Dust Transactions — many tiny transactions indicate farming
      const dustRatio = totalSolTxCount > 0 ? dustTxCount / totalSolTxCount : 0;
      const highDust = totalSolTxCount >= 5 && dustRatio > 0.5;
      signals.push({
        id: 'dust_transactions', name: 'Dust Transactions', category: 'financial',
        detected: highDust, weight: 8,
        severity: highDust ? 'warning' : 'info',
        value: `${(dustRatio * 100).toFixed(0)}% dust`,
        description: highDust ? `${dustTxCount}/${totalSolTxCount} transactions are dust (<0.001 SOL)` : 'Normal transaction sizes',
      });

      // Signal 10: Low dApp Interaction Breadth
      const lowDappInteraction = uniquePrograms < 5 && totalSigCount > 20;
      signals.push({
        id: 'low_dapp_interaction', name: 'Low dApp Interaction', category: 'behavioral',
        detected: lowDappInteraction, weight: 7,
        severity: lowDappInteraction ? 'warning' : 'info',
        value: `${uniquePrograms} programs`,
        description: lowDappInteraction
          ? (uniquePrograms === 0
            ? `No dApp interactions detected among ${totalSigCount} transactions — SOL transfers only`
            : `Only ${uniquePrograms} dApps used across ${totalSigCount} transactions`)
          : `Interacted with ${uniquePrograms} different programs`,
      });

      // Signal 11: Drained Balance — current balance is tiny vs historical max
      const drainedBalance = historicalMaxBalance > 1 && balance < historicalMaxBalance * 0.01;
      signals.push({
        id: 'drained_balance', name: 'Drained Balance', category: 'financial',
        detected: drainedBalance, weight: 7,
        severity: drainedBalance ? 'warning' : 'info',
        value: drainedBalance ? `${balance.toFixed(3)} / ${historicalMaxBalance.toFixed(1)} SOL` : `${balance.toFixed(2)} SOL`,
        description: drainedBalance ? `Current balance (${balance.toFixed(3)}) is <1% of historical max (${historicalMaxBalance.toFixed(1)} SOL)` : 'Balance appears normal',
      });

      // Signal 12: Self-Transfers — sending SOL to yourself to inflate tx count (NEW)
      const hasSelfTransfers = selfTransferCount >= 3;
      signals.push({
        id: 'self_transfers', name: 'Self-Transfers', category: 'behavioral',
        detected: hasSelfTransfers, weight: 12,
        severity: hasSelfTransfers ? 'danger' : 'info',
        value: `${selfTransferCount} self-txs`,
        description: hasSelfTransfers
          ? `${selfTransferCount} transfers to self detected — tx count inflation`
          : 'No self-transfer patterns',
      });

      // Signal 13: Low Counterparty Diversity — few unique addresses despite many txs (NEW)
      const lowCounterparty = totalSolTxCount >= 10 && counterpartyRatio < 0.2;
      signals.push({
        id: 'low_counterparty', name: 'Low Counterparty Diversity', category: 'network',
        detected: lowCounterparty, weight: 10,
        severity: lowCounterparty ? 'warning' : 'info',
        value: `${totalCounterparties} counterparties / ${totalSolTxCount} txs`,
        description: lowCounterparty
          ? `Only ${totalCounterparties} unique counterparties across ${totalSolTxCount} SOL transactions`
          : `${totalCounterparties} unique counterparties`,
      });

      // Signal 14: Funding Chain Depth — multi-hop single-source funding
      // depth 1 + non-CEX = wallet-to-wallet funding (mild risk), depth 2+ = layered chain (high risk)
      const deepChain = fundingChainDepth >= 2;
      const walletToWallet = fundingChainDepth === 1 && cexTrustBonus === 0; // funded by a random wallet, not CEX
      signals.push({
        id: 'funding_chain', name: deepChain ? 'Funding Chain' : (walletToWallet ? 'Wallet-to-Wallet Funding' : 'Funding Chain'), category: 'network',
        detected: deepChain || walletToWallet, weight: deepChain ? 15 : (walletToWallet ? 10 : 0),
        severity: deepChain ? 'danger' : (walletToWallet ? 'warning' : 'info'),
        value: `${fundingChainDepth} hops`,
        description: deepChain
          ? `Funding traced through ${fundingChainDepth} intermediary wallets — layered sybil relay`
          : walletToWallet
            ? 'Primary funding from another wallet (not exchange) — common sybil pattern'
            : cexTrustBonus > 0 ? 'Funded from known exchange (KYC origin)' : 'No suspicious funding chains',
      });

      // Signal 15: Hub-and-Spoke — mass distribution from single funder
      const isHubSpokeMass = allSiblings.size >= 15;
      const isHubSpokeSmall = !isHubSpokeMass && allSiblings.size >= 5;
      signals.push({
        id: 'hub_spoke', name: 'Hub-and-Spoke Funding', category: 'network',
        detected: isHubSpokeMass || isHubSpokeSmall, weight: isHubSpokeMass ? 15 : (isHubSpokeSmall ? 8 : 0),
        severity: isHubSpokeMass ? 'danger' : (isHubSpokeSmall ? 'warning' : 'info'),
        value: `${allSiblings.size} siblings`,
        description: isHubSpokeMass
          ? `Funding source distributed to ${allSiblings.size}+ wallets — industrial sybil farm`
          : isHubSpokeSmall
            ? `Funding source also sent to ${allSiblings.size} other wallets — small cluster`
            : 'No hub-and-spoke pattern detected',
      });

      // Signal 15b: Concentrated single-source funding (>90% from one non-CEX wallet)
      const concentratedFunding = topFunderPctExport > 0.4 && cexTrustBonus === 0 && totalSolTxCount >= 3;
      signals.push({
        id: 'concentrated_funding', name: 'Single-Source Concentration', category: 'network',
        detected: concentratedFunding, weight: 10,
        severity: concentratedFunding ? 'warning' : 'info',
        value: concentratedFunding ? `${(topFunderPctExport * 100).toFixed(0)}% from one wallet` : 'Diversified',
        description: concentratedFunding
          ? `${(topFunderPctExport * 100).toFixed(0)}% of funding from a single non-exchange wallet`
          : 'Funding sources are diversified or from known exchanges',
      });

      // Signal 16: Repeated Funder — same wallet funds target multiple times (sybil relay pattern)
      const repeatedFunder = topFunderTxCount >= 3 && cexTrustBonus === 0;
      // Weight scales: 3 txs = 8, 5 txs = 12, 7+ txs = 18 (capped)
      const repeatedFunderWeight = repeatedFunder ? Math.min(18, 4 + topFunderTxCount * 2) : 0;
      signals.push({
        id: 'repeated_funder', name: 'Repeated Funder', category: 'network',
        detected: repeatedFunder, weight: repeatedFunderWeight,
        severity: repeatedFunder ? (topFunderTxCount >= 5 ? 'danger' : 'warning') : 'info',
        value: `${topFunderTxCount} deposits from same wallet`,
        description: repeatedFunder
          ? `Same non-exchange wallet funded this address ${topFunderTxCount} times — typical sybil relay pattern`
          : topFunderTxCount <= 1 ? 'No repeated funding from same wallet' : `Top funder sent ${topFunderTxCount} txs (within normal range)`,
      });

      // Signal 17: Bot-like Hour Distribution — flat or extremely narrow time windows
      // Max entropy for 24 bins = log2(24) ≈ 4.58 — bots are near-max (all hours equal)
      // Humans typically use 3-4.0 range (concentrated in waking hours)
      const botlikeHours = timestamps.length >= 20 && hourEntropy > 4.2;
      const nightOwlHours = timestamps.length >= 20 && hourEntropy < 1.5; // extremely concentrated
      signals.push({
        id: 'hour_distribution', name: botlikeHours ? '24/7 Bot Activity' : (nightOwlHours ? 'Narrow Time Window' : 'Normal Hours'), category: 'behavioral',
        detected: botlikeHours || nightOwlHours, weight: botlikeHours ? 10 : (nightOwlHours ? 6 : 0),
        severity: botlikeHours ? 'warning' : (nightOwlHours ? 'info' : 'info'),
        value: `entropy ${hourEntropy.toFixed(2)}`,
        description: botlikeHours
          ? 'Activity spread evenly across all 24 hours — bot-like pattern'
          : (nightOwlHours ? 'All activity concentrated in a very narrow time window' : 'Normal day/night activity pattern'),
      });

      // Signal 17: Airdrop Farming — many protocols touched minimally
      const isFarming = farmingRatio > 0.7 && shallowProtocols >= 5;
      signals.push({
        id: 'airdrop_farming', name: 'Airdrop Farming Pattern', category: 'behavioral',
        detected: isFarming, weight: 18,
        severity: isFarming ? 'danger' : 'info',
        value: `${shallowProtocols}/${programInteractionCounts.size} shallow`,
        description: isFarming
          ? `${shallowProtocols} protocols with only 1-2 interactions each — airdrop farming pattern`
          : `${deepProtocols} deeply-used protocols`,
      });

      // Signal 18: No Weekend Activity — bots often run only on weekdays
      const noWeekends = timestamps.length >= 30 && weekendRatio < 0.05;
      signals.push({
        id: 'no_weekends', name: 'No Weekend Activity', category: 'behavioral',
        detected: noWeekends, weight: 6,
        severity: noWeekends ? 'warning' : 'info',
        value: `${(weekendRatio * 100).toFixed(0)}% weekend`,
        description: noWeekends
          ? 'Nearly zero weekend activity — scheduled bot pattern'
          : `${(weekendRatio * 100).toFixed(0)}% of transactions on weekends`,
      });

      // Signal 19: Failed Transaction Ratio — bots/MEV have high fail rates
      const failedTxCount = allSignatures.filter(s => s.err !== null).length;
      const failedRatio = totalSigCount >= 30 ? failedTxCount / totalSigCount : 0;
      const highFailRate = failedRatio > 0.5 && failedTxCount >= 15;
      signals.push({
        id: 'failed_tx_ratio', name: 'High Failed TX Rate', category: 'behavioral',
        detected: highFailRate, weight: 8,
        severity: highFailRate ? 'warning' : 'info',
        value: `${(failedRatio * 100).toFixed(0)}% failed`,
        description: highFailRate
          ? `${failedTxCount}/${totalSigCount} transactions failed — MEV/bot pattern`
          : `${(failedRatio * 100).toFixed(0)}% failure rate`,
      });

      // Signal 20: Behavior Drift — early txs vs recent txs show different patterns (account sold/repurposed)
      let behaviorDriftDetected = false;
      let behaviorDriftValue = '';
      if (earlyParsedTxs.length >= 10 && parsedTxs.length >= 20) {
        // Compare program diversity: early vs recent
        const earlyPrograms = new Set();
        for (const tx of earlyParsedTxs) {
          if (!tx?.transaction?.message?.instructions) continue;
          for (const ix of tx.transaction.message.instructions) {
            const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
            if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') earlyPrograms.add(pid);
          }
        }
        const recentPrograms = new Set();
        for (const tx of parsedTxs.slice(0, 50)) {
          if (!tx?.transaction?.message?.instructions) continue;
          for (const ix of tx.transaction.message.instructions) {
            const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
            if (pid && pid !== '11111111111111111111111111111111' && pid !== 'ComputeBudget111111111111111111111111111111') recentPrograms.add(pid);
          }
        }
        // Jaccard similarity between early and recent program sets
        const intersection = [...earlyPrograms].filter(p => recentPrograms.has(p)).length;
        const union = new Set([...earlyPrograms, ...recentPrograms]).size;
        const jaccard = union > 0 ? intersection / union : 1;
        // Low overlap = wallet completely changed behavior
        if (jaccard < 0.1 && earlyPrograms.size >= 3 && recentPrograms.size >= 3) {
          behaviorDriftDetected = true;
          behaviorDriftValue = `${(jaccard * 100).toFixed(0)}% overlap (${earlyPrograms.size} early → ${recentPrograms.size} recent programs)`;
        }
      }
      signals.push({
        id: 'behavior_drift', name: 'Behavior Drift', category: 'behavioral',
        detected: behaviorDriftDetected, weight: 10,
        severity: behaviorDriftDetected ? 'warning' : 'info',
        value: behaviorDriftValue || 'N/A',
        description: behaviorDriftDetected
          ? 'Early wallet activity completely differs from recent — possible account sale/repurpose for farming'
          : 'Consistent behavior across wallet lifetime',
      });

      // Signal 21: Rapid Token Cycling — receives tokens and immediately transfers out (wash trading)
      let rapidCycleCount = 0;
      if (parsedTxs.length >= 10) {
        const txByTime = parsedTxs.filter(t => t?.blockTime).sort((a, b) => a.blockTime - b.blockTime);
        for (let i = 0; i < txByTime.length - 1; i++) {
          const tx1 = txByTime[i], tx2 = txByTime[i + 1];
          if (!tx1?.meta || !tx2?.meta) continue;
          const accs1 = tx1.transaction?.message?.accountKeys || [];
          const accs2 = tx2.transaction?.message?.accountKeys || [];
          let idx1 = -1, idx2 = -1;
          for (let j = 0; j < accs1.length; j++) {
            const a = typeof accs1[j] === 'string' ? accs1[j] : accs1[j]?.pubkey?.toBase58?.() || '';
            if (a === address) { idx1 = j; break; }
          }
          for (let j = 0; j < accs2.length; j++) {
            const a = typeof accs2[j] === 'string' ? accs2[j] : accs2[j]?.pubkey?.toBase58?.() || '';
            if (a === address) { idx2 = j; break; }
          }
          if (idx1 >= 0 && idx2 >= 0) {
            const diff1 = ((tx1.meta.postBalances?.[idx1] || 0) - (tx1.meta.preBalances?.[idx1] || 0)) / 1e9;
            const diff2 = ((tx2.meta.postBalances?.[idx2] || 0) - (tx2.meta.preBalances?.[idx2] || 0)) / 1e9;
            // Incoming followed immediately by outgoing of similar amount within 60 seconds
            if (diff1 > 0.01 && diff2 < -0.01 && (tx2.blockTime - tx1.blockTime) < 60) {
              const ratio = Math.abs(diff2) / diff1;
              if (ratio > 0.8 && ratio < 1.2) rapidCycleCount++;
            }
          }
        }
      }
      const isRapidCycling = rapidCycleCount >= 3;
      signals.push({
        id: 'rapid_cycling', name: 'Rapid SOL Cycling', category: 'financial',
        detected: isRapidCycling, weight: 12,
        severity: isRapidCycling ? 'danger' : 'info',
        value: `${rapidCycleCount} cycles`,
        description: isRapidCycling
          ? `${rapidCycleCount} rapid in→out cycles detected (<60s) — wash trading or fund relay`
          : 'No rapid cycling detected',
      });

      // ── Calculate Risk Score ──
      let riskScore = 0;
      for (const s of signals) {
        if (!s.detected) continue;
        riskScore += s.weight;
      }
      riskScore = Math.min(100, riskScore);

      // ── Cross-session graph intelligence (applied BEFORE trust bonus) ──
      const fundingSources = [...incomingSenders].filter(a => !TREASURY_WALLETS.has(a));
      const { graphRisk, graphDetails } = checkGraphForKnownSybils(address, fundingSources, [...allSiblings]);
      if (graphRisk > 0) {
        riskScore = Math.min(100, riskScore + graphRisk);
      }

      // Trust bonuses — applied AFTER graph risk so they can't fully absorb it (max ~40)
      let trustBonus = cexTrustBonus; // carry over CEX bonus from funding graph analysis
      if (walletAgeDays > 365) trustBonus += 5;          // 1+ year old
      if (walletAgeDays > 730) trustBonus += 3;          // 2+ years old
      if (walletAgeDays > 1460) trustBonus += 2;         // 4+ years old
      if (tokenDiversityCount >= 10) trustBonus += 3;    // diverse portfolio
      if (tokenDiversityCount >= 25) trustBonus += 2;    // very diverse
      if (nftCount >= 3) trustBonus += 2;                // collector
      if (nftCount >= 10) trustBonus += 1;               // active collector
      if (uniquePrograms >= 8) trustBonus += 2;          // uses many dApps
      if (uniquePrograms >= 15) trustBonus += 2;         // DeFi power user
      if (activeDaysRatio > 0.15) trustBonus += 2;       // regularly active
      if (activeDaysRatio > 0.4) trustBonus += 1;        // daily user
      if (incomingSenders.size >= 5) trustBonus += 2;     // receives from many sources
      if (hasSolDomain) trustBonus += 4;                 // owns .sol domain (strong identity signal)
      if (defiDepth >= 2) trustBonus += 2;               // uses DeFi beyond swaps
      if (defiDepth >= 3) trustBonus += 2;               // deep DeFi user (lending+staking+governance)
      // Trust bonus can reduce risk but never below half of graph risk (graph signal always partially persists)
      const graphFloor = Math.max(10, Math.floor(graphRisk * 0.6));
      riskScore = Math.max(graphFloor, riskScore - trustBonus);

      if (graphRisk > 0) {
        signals.push({
          id: 'graph_intelligence', name: 'Known Sybil Network', category: 'network',
          detected: true, weight: graphRisk,
          severity: graphRisk >= 15 ? 'danger' : 'warning',
          value: `+${graphRisk} from graph`,
          description: graphDetails.join('; '),
        });
      }

      const riskLevel = riskScore >= 75 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 30 ? 'medium' : riskScore >= 10 ? 'low' : 'clean';
      // Zero-data wallets get zero trust — can't assess what doesn't exist
      let trustScore;
      if (totalSigCount === 0) {
        trustScore = 0;
      } else if (totalSigCount < 3) {
        trustScore = Math.min(10, Math.max(0, 100 - riskScore));
      } else {
        trustScore = Math.max(0, 100 - riskScore);
      }
      const trustGrade = trustScore >= 90 ? 'A+' : trustScore >= 80 ? 'A' : trustScore >= 70 ? 'B' : trustScore >= 60 ? 'C' : trustScore >= 50 ? 'D' : 'F';

      // ── Top Programs from parsed txs ──
      const topProgramsList = [...programInteractionCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([pid, count]) => {
          const n = PROGRAM_LABELS[pid];
          return { programId: pid, name: n || null, interactions: count };
        });

      const analysis = {
        address, riskScore, riskLevel, trustScore, trustGrade, signals,
        metrics: {
          walletAgeDays,
          activeDaysCount, activeDaysRatio,
          tokenDiversityCount, nftCount,
          incomingVolume: Math.round(incomingVolume * 10000) / 10000,
          outgoingVolume: Math.round(outgoingVolume * 10000) / 10000,
          incomingCount, outgoingCount,
          uniqueSenders: incomingSenders.size,
          uniqueRecipients: outgoingRecipients.size,
          flowRatio: Math.round(flowRatio * 100),
          dustRatio: Math.round(dustRatio * 100),
          uniquePrograms,
          balance: Math.round(balance * 10000) / 10000,
          historicalMaxBalance: Math.round(historicalMaxBalance * 10000) / 10000,
          txCount: totalSigCount,
          clusterSimilarity: Math.round(clusterSimilarity * 100),
          selfTransferCount,
          counterpartyRatio: Math.round(counterpartyRatio * 100),
          burstRatio: Math.round(burstRatio * 100),
          trustBonus,
          cexTrustBonus,
          fundingChainDepth,
          topFunderTxCount,
          topFunderPct: Math.round(topFunderPctExport * 100),
          hourBuckets,
          dayBuckets,
          hubSpokeScore: Math.round(hubSpokeScore * 100),
          siblingCount: allSiblings.size,
          hourEntropy: Math.round(hourEntropy * 100) / 100,
          intervalEntropy: Math.round(intervalEntropy * 100) / 100,
          weekendRatio: Math.round(weekendRatio * 100),
          shallowProtocols,
          deepProtocols,
          farmingRatio: Math.round(farmingRatio * 100),
          defiDepth,
          defiCategories: [...defiCategories],
          hasSolDomain,
          earlyTxsAnalyzed: earlyParsedTxs.length,
          rapidCycleCount,
          siblingAddresses: [...allSiblings].slice(0, 30),
          topPrograms: topProgramsList,
        },
        behaviorProfile: {
          txTimingVariance: timingVariance,
          timingCV: timingCV < 999 ? Math.round(timingCV * 100) / 100 : null,
          intervalEntropy: Math.round(intervalEntropy * 100) / 100,
          hourEntropy: Math.round(hourEntropy * 100) / 100,
          protocolDiversity: Math.min(1, uniquePrograms / 10),
          defiDepth,
          activeDaysRatio: Math.round(activeDaysRatio * 100) / 100,
        },
        timestamp: new Date().toISOString(),
      };
      analysis.verdict = getSybilVerdict(analysis);
      analysis.walletType = (() => {
        if (analysis.verdict?.key === 'confirmed_sybil' || analysis.verdict?.key === 'probable_sybil') return 'sybil';
        if (analysis.verdict?.key === 'cluster_linked') return 'sybil_cluster';
        if (isRobotic && farmingRatio > 0.5) return 'bot';
        if (balance > 100 && totalSigCount > 500) return 'whale';
        if (defiDepth >= 3 && totalSolTxCount > 100) return 'defi_power_user';
        if (defiDepth >= 1 && totalSolTxCount > 30) return 'defi_user';
        if (nftCount >= 10) return 'nft_collector';
        if (farmingRatio > 0.6 && shallowProtocols >= 5) return 'airdrop_farmer';
        if (totalSigCount > 200 && activeDaysRatio > 0.15) return 'active_user';
        if (totalSigCount > 50) return 'regular_user';
        if (totalSigCount > 10) return 'light_user';
        if (totalSigCount <= 2) return 'empty';
        return 'new_user';
      })();
      // Build funding sources from the already-computed incoming data
      let cachedFundingSources = [];
      if (resolvedIncoming && resolvedIncoming.size > 0) {
        const totalReceived = [...resolvedIncoming.values()].reduce((s, v) => s + v.totalSol, 0) || 1;
        cachedFundingSources = [...resolvedIncoming.entries()]
          .sort((a, b) => b[1].totalSol - a[1].totalSol)
          .slice(0, 20)
          .map(([addr, info]) => {
            const known = KNOWN_LABELS[addr];
            return {
              address: addr, label: known?.label || null, type: known?.type || 'wallet',
              totalSolReceived: Math.round(info.totalSol * 10000) / 10000,
              transactionCount: info.count, percentage: Math.round((info.totalSol / totalReceived) * 100),
            };
          });
      }
      // Embed top funding source directly in analysis response so client doesn't need a 2nd rate-limited call
      const topFundingSource = cachedFundingSources.length > 0 ? cachedFundingSources[0] : null;
      if (topFundingSource) analysis.primaryFundingSource = topFundingSource;
      sybilCache.set(address, { analysis, fundingSources: cachedFundingSources, cachedAt: Date.now() });

      // ── Update wallet database — FULL intelligence profile ──
      const m = analysis.metrics || {};
      const bp = analysis.behaviorProfile || {};
      const detectedSignals = signals.filter(s => s.detected).map(s => s.id);

      const walletProfile = {
        // Core identity
        sybil: {
          riskScore: analysis.riskScore,
          riskLevel: analysis.riskLevel,
          trustScore: analysis.trustScore,
          trustGrade: analysis.trustGrade,
          walletType: analysis.walletType,
          verdict: analysis.verdict || null,
          verdictKey: analysis.verdict?.key || null,
          bountyEligible: Boolean(analysis.verdict?.bountyEligible),
          confidence: analysis.verdict?.confidence || null,
          dataQuality: analysis.verdict?.dataQuality || null,
          networkConfirmed: Boolean(analysis.verdict?.networkConfirmed),
          updatedAt: new Date().toISOString(),
          detectedSignals,
          signalCount: detectedSignals.length,
        },
        // On-chain stats
        stats: {
          tokens: m.tokenDiversityCount || 0,
          nfts: m.nftCount || 0,
          transactions: m.txCount || 0,
          solBalance: m.balance || 0,
          historicalMaxBalance: m.historicalMaxBalance || 0,
          walletAgeDays: m.walletAgeDays || 0,
          walletAgeYears: Math.floor((m.walletAgeDays || 0) / 365),
          activeDays: m.activeDaysCount || 0,
          activeDaysRatio: m.activeDaysRatio || 0,
        },
        // Financial profile
        financial: {
          incomingVolume: m.incomingVolume || 0,
          outgoingVolume: m.outgoingVolume || 0,
          incomingCount: m.incomingCount || 0,
          outgoingCount: m.outgoingCount || 0,
          uniqueSenders: m.uniqueSenders || 0,
          uniqueRecipients: m.uniqueRecipients || 0,
          flowRatio: m.flowRatio || 0,
          dustRatio: m.dustRatio || 0,
          selfTransferCount: m.selfTransferCount || 0,
          rapidCycleCount: m.rapidCycleCount || 0,
        },
        // Funding intelligence
        funding: {
          chainDepth: m.fundingChainDepth || 0,
          topFunderPct: m.topFunderPct || 0,
          topFunderTxCount: m.topFunderTxCount || 0,
          sources: cachedFundingSources.slice(0, 10),
          siblingCount: m.siblingCount || 0,
          hubSpokeScore: m.hubSpokeScore || 0,
          clusterSimilarity: m.clusterSimilarity || 0,
        },
        // Behavioral fingerprint
        behavior: {
          timingCV: bp.timingCV,
          hourEntropy: bp.hourEntropy || 0,
          intervalEntropy: bp.intervalEntropy || 0,
          weekendRatio: m.weekendRatio || 0,
          hourDistribution: m.hourBuckets || [],
          dayDistribution: m.dayBuckets || [],
          protocolDiversity: bp.protocolDiversity || 0,
        },
        // DeFi / Protocol usage
        protocols: {
          uniquePrograms: m.uniquePrograms || 0,
          defiDepth: m.defiDepth || 0,
          defiCategories: m.defiCategories || [],
          topPrograms: topProgramsList.slice(0, 10),
          shallowProtocols: m.shallowProtocols || 0,
          deepProtocols: m.deepProtocols || 0,
          farmingRatio: m.farmingRatio || 0,
        },
        // Network graph
        network: {
          siblings: [...allSiblings].slice(0, 30),
          hasSolDomain: m.hasSolDomain || false,
        },
        // Metadata
        lastScannedAt: new Date().toISOString(),
        firstSeenAt: walletDatabase.get(address)?.firstSeenAt || new Date().toISOString(),
      };
      updateWalletEntry(address, walletProfile);
      triggerCompositeUpdate(address);

      // ── Persist to sybil graph ──
      updateSybilGraphNode(address, {
        riskScore: analysis.riskScore,
        trustGrade: analysis.trustGrade,
        fundedBy: fundingSources.slice(0, 5),
        siblings: [...allSiblings].slice(0, 20),
        defiDepth,
        hasSolDomain,
        walletAgeDays,
        verdictKey: analysis.verdict?.key || null,
        bountyEligible: Boolean(analysis.verdict?.bountyEligible),
        confidence: analysis.verdict?.confidence || null,
        networkConfirmed: Boolean(analysis.verdict?.networkConfirmed),
      });
      // Record ALL siblings in graph — both new and existing (update riskScore if higher)
      for (const sib of allSiblings) {
        const existingNode = sybilGraph.nodes[sib];
        const inferredRisk = Math.max(50, Math.floor(riskScore * 0.7)); // siblings inherit 70% of parent risk, min 50
        if (!existingNode || existingNode.riskScore < inferredRisk) {
          updateSybilGraphNode(sib, {
            inferredFromCluster: address,
            riskScore: inferredRisk,
            fundedBy: resolvedTopFunder ? [resolvedTopFunder] : [],
            siblings: [address, ...[...allSiblings].filter(s => s !== sib).slice(0, 10)],
            verdictKey: existingNode?.verdictKey || 'cluster_linked',
            bountyEligible: Boolean(existingNode?.bountyEligible),
            confidence: existingNode?.confidence || 'low',
          });
        }
      }
      // Auto-flag clusters: if hub funded 5+ wallets and target is medium+ risk
      if (allSiblings.size >= 5 && riskScore >= 40) {
        // Use the top funder (by SOL amount) as cluster key, not insertion order
        const clusterKey = resolvedTopFunder || fundingSources[0] || address;
        const existing = sybilGraph.flaggedClusters.find(c => c.funder === clusterKey);
        if (existing) {
          existing.lastSeen = Date.now();
          if (!existing.members.includes(address)) existing.members.push(address);
        } else {
          sybilGraph.flaggedClusters.push({
            funder: clusterKey,
            label: `auto-${clusterKey.slice(0, 8)}`,
            members: [address, ...([...allSiblings].slice(0, 30))],
            flaggedAt: Date.now(),
            lastSeen: Date.now(),
          });
        }
      }
      saveSybilGraph();

      return analysis;
    } catch (e) {
      throw e;
    }
    })();
    sybilInFlight.set(address, analysisPromise);
    try {
      const analysis = await analysisPromise;
      respondJson(res, 200, analysis);
    } catch (e) {
      console.error('[sybil] Analysis failed:', e.message);
      respondJson(res, 500, { error: 'Sybil analysis failed' });
    } finally {
      sybilInFlight.delete(address);
    }
    return;
  }

  // ═══ Sybil Batch Analysis ═══
  if (pathname === '/api/sybil/batch' && req.method === 'POST') {
    const rlIp = getClientIp(req);
    const rlKey = `sybilBatch:${rlIp}`;
    const lastBatch = reputationRateLimit.get(rlKey) || 0;
    if (Date.now() - lastBatch < 15000) {
      return respondJson(res, 429, { error: 'Rate limited — 15s cooldown' });
    }
    reputationRateLimit.set(rlKey, Date.now());
    try {
      const body = await readBody(req);
      const { addresses } = JSON.parse(body);
      if (!Array.isArray(addresses) || addresses.length === 0) return respondJson(res, 400, { error: 'addresses array required' });
      if (addresses.length > 20) return respondJson(res, 400, { error: 'Max 20 addresses per batch' });
      // Validate each address is a valid base58 Solana pubkey
      for (const addr of addresses) {
        if (typeof addr !== 'string' || addr.length < 32 || addr.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(addr)) {
          return respondJson(res, 400, { error: `Invalid address: ${String(addr).slice(0, 8)}...` });
        }
      }

      const results = {};
      for (const addr of addresses) {
        const cached = sybilCache.get(addr);
        if (cached && Date.now() - cached.cachedAt < 3600_000) {
          results[addr] = {
            trustGrade: cached.analysis.trustGrade,
            riskScore: cached.analysis.riskScore,
            riskLevel: cached.analysis.riskLevel,
            trustScore: cached.analysis.trustScore,
            verdict: cached.analysis.verdict || getSybilVerdict(cached.analysis),
          };
        } else {
          // Check graph for quick estimate
          const node = sybilGraph.nodes[addr];
          if (node && node.riskScore !== undefined) {
            results[addr] = {
              trustGrade: node.trustGrade || '?',
              riskScore: node.riskScore,
              riskLevel: node.riskScore >= 75 ? 'critical' : node.riskScore >= 50 ? 'high' : node.riskScore >= 30 ? 'medium' : node.riskScore >= 10 ? 'low' : 'clean',
              source: 'graph',
              verdict: getSybilQuickVerdict(node),
            };
          } else {
            results[addr] = { trustGrade: '?', riskScore: -1, riskLevel: 'unknown', source: 'not_analyzed' };
          }
        }
      }
      respondJson(res, 200, { results, total: addresses.length, analyzed: Object.values(results).filter(r => r.riskScore >= 0).length });
    } catch (e) {
      console.error('[sybil] Batch analysis failed:', e.message);
      respondJson(res, 500, { error: 'Batch analysis failed' });
    }
    return;
  }

  // ═══ Sybil Stats ═══
  if (pathname === '/api/sybil/stats' && req.method === 'GET') {
    if (!requireAdminKey(req, res)) return; // admin only — exposes graph intelligence
    const nodes = Object.values(sybilGraph.nodes);
    const analyzed = nodes.filter(n => n.riskScore !== undefined);
    const grades = { 'A+': 0, A: 0, B: 0, C: 0, D: 0, F: 0 };
    const verdicts = { unknown: 0, clean: 0, suspicious: 0, cluster_linked: 0, probable_sybil: 0, confirmed_sybil: 0 };
    for (const n of analyzed) {
      if (n.trustGrade && grades[n.trustGrade] !== undefined) grades[n.trustGrade]++;
      if (n.verdictKey && verdicts[n.verdictKey] !== undefined) verdicts[n.verdictKey]++;
    }
    const avgRisk = analyzed.length > 0 ? Math.round(analyzed.reduce((s, n) => s + n.riskScore, 0) / analyzed.length) : 0;
    const highRisk = analyzed.filter(n => n.riskScore >= 50).length;
    respondJson(res, 200, {
      totalAnalyzed: analyzed.length,
      totalInGraph: nodes.length,
      flaggedClusters: sybilGraph.flaggedClusters.length,
      averageRiskScore: avgRisk,
      highRiskCount: highRisk,
      gradeDistribution: grades,
      verdictDistribution: verdicts,
      cacheSize: sybilCache.size,
    });
    return;
  }

  // ═══ Sybil Graph Lookup ═══
  if (pathname === '/api/sybil/graph' && req.method === 'GET') {
    const addr = url.searchParams.get('address');
    if (!addr) return respondJson(res, 400, { error: 'address required' });
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return respondJson(res, 400, { error: 'Invalid address' });
    // Rate limit: 10 req/min per IP
    const graphIp = getClientIp(req);
    const graphRlKey = `sybgraph:${graphIp}`;
    const graphRl = reputationRateLimit.get(graphRlKey) || 0;
    if (Date.now() - graphRl < 6000) return respondJson(res, 429, { error: 'Rate limited' });
    reputationRateLimit.set(graphRlKey, Date.now());
    const node = sybilGraph.nodes[addr];
    if (!node) return respondJson(res, 404, { error: 'Address not in sybil graph' });
    // Return safe subset — no fundedBy or full sibling list (prevents graph enumeration)
    respondJson(res, 200, {
      address: addr,
      riskScore: node.riskScore ?? -1,
      trustGrade: node.trustGrade ?? '?',
      verdict: getSybilQuickVerdict(node),
      walletAgeDays: node.walletAgeDays,
      defiDepth: node.defiDepth,
      hasSolDomain: node.hasSolDomain,
      siblingCount: node.siblings?.length || 0,
    });
    return;
  }

  // ═══ Wallet Token Holdings ═══
  if (pathname === '/api/wallet/tokens' && req.method === 'GET') {
    const rlIp = getClientIp(req);
    const rlKey = `walletTokens:${rlIp}`;
    const lastWT = reputationRateLimit.get(rlKey) || 0;
    if (Date.now() - lastWT < 10000) {
      return respondJson(res, 429, { error: 'Rate limited — 10s cooldown' });
    }
    reputationRateLimit.set(rlKey, Date.now());
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    try {
      const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
      const pubkey = new PublicKey(address);
      const [balResult, tokenResult] = await Promise.allSettled([
        conn.getBalance(pubkey),
        conn.getParsedTokenAccountsByOwner(pubkey, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }),
      ]);
      const solBalance = balResult.status === 'fulfilled' ? balResult.value / 1e9 : 0;
      const tokenAccounts = tokenResult.status === 'fulfilled' ? tokenResult.value?.value || [] : [];
      const tokens = [];
      for (const acc of tokenAccounts) {
        const info = acc.account?.data?.parsed?.info;
        if (!info) continue;
        const amount = parseFloat(info.tokenAmount?.uiAmountString || '0');
        if (amount <= 0) continue;
        const decimals = info.tokenAmount?.decimals ?? 0;
        tokens.push({
          mint: info.mint,
          amount,
          decimals,
          isNft: decimals === 0 && amount === 1,
        });
      }
      tokens.sort((a, b) => b.amount - a.amount);
      respondJson(res, 200, {
        solBalance: Math.round(solBalance * 10000) / 10000,
        tokens: tokens.slice(0, 30),
        totalTokens: tokens.filter(t => !t.isNft).length,
        totalNfts: tokens.filter(t => t.isNft).length,
      });
    } catch (e) {
      respondJson(res, 500, { error: 'Failed to fetch tokens' });
    }
    return;
  }

  // ═══ Wallet Recent Transactions ═══
  if (pathname === '/api/wallet/recent-txs' && req.method === 'GET') {
    const rlIp = getClientIp(req);
    const rlKey = `walletTxs:${rlIp}`;
    const lastWTx = reputationRateLimit.get(rlKey) || 0;
    if (Date.now() - lastWTx < 10000) {
      return respondJson(res, 429, { error: 'Rate limited — 10s cooldown' });
    }
    reputationRateLimit.set(rlKey, Date.now());
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    try {
      const rpcUrl = getRpcUrl(address) || 'https://api.mainnet-beta.solana.com';
      const conn = new Connection(rpcUrl, 'confirmed');
      const pubkey = new PublicKey(address);
      const sigs = await conn.getSignaturesForAddress(pubkey, { limit: 15 });
      const sigBatch = sigs.map(s => s.signature);
      // Single batch call for 15 txs (well within 100 limit)
      const parsed = sigBatch.length > 0
        ? (await batchGetParsedTxs(getBatchRpcUrl(address), sigBatch, { batchSize: 15 })).filter(Boolean)
        : [];
      const txs = [];
      for (let i = 0; i < parsed.length; i++) {
        const tx = parsed[i];
        if (!tx?.meta || !tx?.transaction) continue;
        const accounts = tx.transaction.message?.accountKeys || [];
        const pre = tx.meta.preBalances || [];
        const post = tx.meta.postBalances || [];
        let targetIdx = -1;
        for (let j = 0; j < accounts.length; j++) {
          const acc = resolveAccountKey(accounts[j]);
          if (acc === address) { targetIdx = j; break; }
        }
        const balChange = targetIdx >= 0 ? ((post[targetIdx] || 0) - (pre[targetIdx] || 0)) / 1e9 : 0;
        // Detect tx type from instructions
        const ixs = tx.transaction.message?.instructions || [];
        let txType = 'unknown';
        for (const ix of ixs) {
          const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
          if (pid === '11111111111111111111111111111111') txType = 'transfer';
          else if (pid.startsWith('JUP')) txType = 'swap';
          else if (['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'].includes(pid)) txType = 'swap';
          else if (['M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K', 'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN', 'hadeK9DLv9eA7ya5KnRSb4dTSitisSCRoB68Y8hmjtR'].includes(pid)) txType = 'nft_trade';
          else if (['So1endDq2YkqhipRh3WViPa8hFb7GVEtcEMF3CBAK8h', 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', 'KLend2g3cP87ber41GXWsSZQz9R1hGT2bVBaeEdnKHR'].includes(pid)) txType = 'lending';
          else if (['CgDG2CLNqR2ypE3CXTMEq5R6J8FaqVjChn9Tfmwocs4Y', 'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy'].includes(pid)) txType = 'staking';
          else if (txType === 'unknown') txType = 'contract';
        }
        txs.push({
          signature: sigs[i]?.signature || '',
          blockTime: tx.blockTime || sigs[i]?.blockTime || null,
          balanceChange: Math.round(balChange * 10000) / 10000,
          fee: (tx.meta.fee || 0) / 1e9,
          type: txType,
          success: !tx.meta.err,
          programCount: new Set(ixs.map(ix => ix.programId?.toBase58?.() || '')).size,
        });
      }
      respondJson(res, 200, { transactions: txs });
    } catch (e) {
      respondJson(res, 500, { error: 'Failed to fetch transactions' });
    }
    return;
  }

  // ═══ Sybil Funding Sources ═══
  if (pathname === '/api/sybil/funding-sources' && req.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    // Cache-first: return cached funding sources immediately (no rate limit)
    const cachedSybil = sybilCache.get(address);
    if (cachedSybil?.fundingSources && cachedSybil.fundingSources.length > 0 && Date.now() - cachedSybil.cachedAt < 3600_000) {
      return respondJson(res, 200, { sources: cachedSybil.fundingSources });
    }
    // Fresh fetch: rate limited (5s per IP)
    const fsRlKey = `fundSrc:${getClientIp(req)}`;
    if (Date.now() - (prismEarnRateLimit.get(fsRlKey) || 0) < 5_000) return respondJson(res, 429, { error: 'Rate limited' });
    prismEarnRateLimit.set(fsRlKey, Date.now());
    try {
      const { parsed } = await fetchParsedTransactions(address, 200);
      const { incoming } = extractSolTransfers(parsed, address);
      const totalReceived = [...incoming.values()].reduce((s, v) => s + v.totalSol, 0) || 1;
      const sources = [...incoming.entries()]
        .filter(([addr]) => !TREASURY_WALLETS.has(addr))
        .sort((a, b) => b[1].totalSol - a[1].totalSol)
        .slice(0, 20)
        .map(([addr, info]) => {
          const known = KNOWN_LABELS[addr];
          return {
            address: addr, label: known?.label || null, type: known?.type || 'wallet',
            totalSolReceived: Math.round(info.totalSol * 10000) / 10000,
            transactionCount: info.count,
            firstInteraction: new Date(info.firstTime).toISOString(),
            lastInteraction: new Date(info.lastTime).toISOString(),
            percentage: Math.round((info.totalSol / totalReceived) * 100),
          };
        });
      respondJson(res, 200, { sources });
    } catch (e) {
      respondJson(res, 200, { sources: [], error: 'Failed to fetch funding sources' });
    }
    return;
  }

  // ═══ Sybil Cluster Detection ═══
  if (pathname === '/api/sybil/cluster' && req.method === 'GET') {
    const clusterIp = getClientIp(req);
    const clusterRlKey = `sybilHeavy:${clusterIp}`;
    const lastCluster = prismEarnRateLimit.get(clusterRlKey) || 0;
    if (Date.now() - lastCluster < 15_000) return respondJson(res, 429, { error: 'Rate limited — try again in 15s' });
    prismEarnRateLimit.set(clusterRlKey, Date.now());
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    const cachedCluster = clusterCache.get(address);
    if (cachedCluster && Date.now() - cachedCluster.ts < 1800_000) { respondJson(res, 200, cachedCluster.data); return; }
    try {
      const { parsed } = await fetchParsedTransactions(address, 50);
      const { incoming } = extractSolTransfers(parsed, address);
      let topFunder = null, topAmount = 0;
      for (const [addr, info] of incoming) {
        if (TREASURY_WALLETS.has(addr)) continue; // skip treasury
        if (info.totalSol > topAmount) { topFunder = addr; topAmount = info.totalSol; }
      }
      if (!topFunder || topAmount < 0.01) {
        const result = { clusterId: null };
        clusterCache.set(address, { data: result, ts: Date.now() });
        respondJson(res, 200, result);
        return;
      }
      const clusterRpcUrl = getRpcUrl(address) || 'https://api.mainnet-beta.solana.com';
      const conn = new Connection(clusterRpcUrl, 'confirmed');
      const funderSigs = await conn.getSignaturesForAddress(new PublicKey(topFunder), { limit: 100 });
      const funderBatch = funderSigs.map(s => s.signature);
      const funderParsed = (await batchGetParsedTxs(getBatchRpcUrl(topFunder), funderBatch, { batchSize: 100, delayMs: 300 })).filter(Boolean);
      const siblings = new Set();
      for (const tx of funderParsed) {
        if (!tx?.meta || !tx?.transaction) continue;
        const accounts = tx.transaction.message?.accountKeys || [];
        const pre = tx.meta.preBalances || [];
        const post = tx.meta.postBalances || [];
        for (let i = 0; i < accounts.length; i++) {
          const acc = resolveAccountKey(accounts[i]);
          const diff = ((post[i] || 0) - (pre[i] || 0)) / 1e9;
          if (diff > 0.01 && acc !== topFunder && acc !== address && acc !== '11111111111111111111111111111111') {
            siblings.add(acc);
          }
        }
      }
      const known = KNOWN_LABELS[topFunder];
      const result = siblings.size >= 2 ? {
        clusterId: crypto.createHash('sha256').update(topFunder).digest('hex').slice(0, 16),
        clusterSize: siblings.size + 1, sharedFundingSource: topFunder,
        sharedFundingLabel: known?.label || null, siblingWallets: [...siblings].slice(0, 10),
        confidence: Math.min(100, 30 + siblings.size * 10),
      } : { clusterId: null };
      clusterCache.set(address, { data: result, ts: Date.now() });
      respondJson(res, 200, result);
    } catch (e) {
      respondJson(res, 200, { clusterId: null, error: 'Failed to compute cluster' });
    }
    return;
  }

  // ═══ Sybil Circular Flow ═══
  if (pathname === '/api/sybil/circular-flow' && req.method === 'GET') {
    const circIp = getClientIp(req);
    const circRlKey = `sybilHeavy:${circIp}`;
    const lastCirc = prismEarnRateLimit.get(circRlKey) || 0;
    if (Date.now() - lastCirc < 15_000) return respondJson(res, 429, { error: 'Rate limited — try again in 15s' });
    prismEarnRateLimit.set(circRlKey, Date.now());
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    try {
      const { parsed } = await fetchParsedTransactions(address, 50);
      const { incoming, outgoing } = extractSolTransfers(parsed, address);
      const cycle = [];
      for (const [outAddr] of outgoing) {
        if (incoming.has(outAddr)) { cycle.push(address, outAddr, address); break; }
      }
      respondJson(res, 200, { detected: cycle.length > 0, cycle });
    } catch (e) {
      respondJson(res, 200, { detected: false, cycle: [], error: 'Failed to check circular flow' });
    }
    return;
  }

  // ═══ Sybil Dark Pool ═══
  if (pathname === '/api/sybil/dark-pool' && req.method === 'GET') {
    const dpIp = getClientIp(req);
    const dpRlKey = `sybilHeavy:${dpIp}`;
    const lastDp = prismEarnRateLimit.get(dpRlKey) || 0;
    if (Date.now() - lastDp < 15_000) return respondJson(res, 429, { error: 'Rate limited — try again in 15s' });
    prismEarnRateLimit.set(dpRlKey, Date.now());
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
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
            scamInteractions.push({ program: pid, signature: tx.transaction.signatures?.[0] || '', blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null });
          }
        }
        const accounts = tx.transaction.message?.accountKeys || [];
        for (const acc of accounts) {
          const addr = typeof acc === 'string' ? acc : acc?.pubkey?.toBase58?.() || '';
          if (KNOWN_SCAM_ADDRESSES.has(addr) && addr !== address) {
            scamInteractions.push({ address: addr, signature: tx.transaction.signatures?.[0] || '', blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null });
          }
        }
      }
      respondJson(res, 200, { address, scamInteractions: scamInteractions.slice(0, 20), scamCount: scamInteractions.length, totalProgramsUsed: allPrograms.size, riskLevel: scamInteractions.length >= 5 ? 'high' : scamInteractions.length >= 1 ? 'medium' : 'clean' });
    } catch (e) {
      respondJson(res, 200, { address, scamInteractions: [], scamCount: 0, riskLevel: 'unknown', error: 'Failed to check dark pool' });
    }
    return;
  }

  // ═══ Sybil Suggested Targets — wallets to hunt ═══
  if (pathname === '/api/sybil/suggested-targets' && req.method === 'GET') {
    if (!ipRateLimit('sybil_targets', getClientIp(req), 5, 30000)) return respondJson(res, 429, { error: 'Rate limited' });
    const exclude = url.searchParams.get('exclude') || '';
    const excludeSet = new Set(exclude.split(',').filter(Boolean));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 10));

    // Collect unscanned siblings of known sybils
    const candidates = new Map(); // address → { source, parentRisk }
    for (const [addr, node] of Object.entries(sybilGraph.nodes)) {
      if (!node.riskScore || node.riskScore < 40 || node.inferredFromCluster) continue;
      // This is a directly-scanned suspicious wallet — its siblings are targets
      for (const sib of (node.siblings || [])) {
        if (excludeSet.has(sib)) continue;
        const sibNode = sybilGraph.nodes[sib];
        // Prefer siblings not yet directly scanned (only inferred)
        if (!sibNode || sibNode.inferredFromCluster) {
          candidates.set(sib, { source: 'sibling', parentRisk: node.riskScore, parent: addr.slice(0, 8) + '...' });
        }
      }
    }
    // Also add cluster members
    for (const cluster of sybilGraph.flaggedClusters) {
      for (const member of cluster.members) {
        if (excludeSet.has(member) || candidates.has(member)) continue;
        const mNode = sybilGraph.nodes[member];
        if (!mNode || mNode.inferredFromCluster) {
          candidates.set(member, { source: 'cluster', clusterLabel: cluster.label, funder: cluster.funder.slice(0, 8) + '...' });
        }
      }
    }

    // Sort by parent risk (highest first) and take limit
    const sorted = [...candidates.entries()]
      .sort((a, b) => (b[1].parentRisk || 0) - (a[1].parentRisk || 0))
      .slice(0, limit)
      .map(([addr, meta]) => ({ address: addr, ...meta }));

    respondJson(res, 200, { targets: sorted, totalAvailable: candidates.size });
    return;
  }

  if (pathname === '/api/recovery/status' && req.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address) return respondJson(res, 400, { error: 'address required' });
    const entry = walletDatabase.get(address) || {};

    // Gather activity data from authoritative server-side sources
    const achEntry = achievementData.get(address);
    const qp = questProgress.get(address);
    let questsCompleted = 0, streakDays = 0;
    if (qp?.quests) { for (const q of Object.values(qp.quests)) { if (q.completed) questsCompleted++; } streakDays = qp.streakDays || 0; }
    const playerEntries = leaderboardEntries.filter(e => e.address === address);
    const gameTypesCount = new Set(playerEntries.map(e => e.gameType || 'orbit')).size;
    const gamesPlayedCount = playerEntries.length;
    const realChallengeWins = challenges.filter(c => c.status === 'completed' && c.winner === address).length;
    const realScanCount = getUniqueScanTargetCount(getScanRewardState(address, entry));
    const achievementCount = achEntry ? achEntry.unlocked.size : 0;
    // Text quests completed count — stored in userData.textQuests (object keyed by questId with completed flag)
    const userData = entry.userData || {};
    const tqMap = userData.textQuests || {};
    const textQuestsCompleted = Object.values(tqMap).filter(tq => tq && tq.completed).length;

    // Vault check
    const vaultStaked = Boolean(entry.staking?.tier);

    // Activity bonus calculation (max 25)
    let activityBonus = 0;
    if (gamesPlayedCount > 0) activityBonus += Math.min(6, gameTypesCount * 2); // up to 3 game types = +6
    if (achievementCount > 3) activityBonus += 3;
    if (questsCompleted > 3) activityBonus += 3;
    if (streakDays > 3) activityBonus += 3;
    if (realScanCount > 5) activityBonus += 3;
    if (realChallengeWins > 0) activityBonus += 2;
    if (textQuestsCompleted > 0) activityBonus += 2;
    if (gamesPlayedCount > 20) activityBonus += 3;
    if (vaultStaked) activityBonus += 2;
    activityBonus = Math.min(25, activityBonus);

    const currentTrustScore = entry.sybil?.trustScore || 0;
    const adjustedTrustScore = Math.min(100, currentTrustScore + activityBonus);

    respondJson(res, 200, {
      currentTrustScore,
      adjustedTrustScore,
      recoveryBonus: activityBonus,
      breakdown: {
        activityBonus,
      },
      activity: {
        gameTypes: gameTypesCount,
        achievements: achievementCount,
        quests: questsCompleted,
        streak: streakDays,
        scans: realScanCount,
        challengeWins: realChallengeWins,
        gamesPlayed: gamesPlayedCount,
        textQuests: textQuestsCompleted,
        vaultStaked,
      },
    });
    return;
  }

  // ═══ Sybil Hunt Quiz — blockchain trivia for coins ═══
  if (pathname === '/api/quiz/question' && req.method === 'GET') {
    if (!ipRateLimit('quiz', getClientIp(req), 10, 5000)) return respondJson(res, 429, { error: 'Rate limited' });
    // Pick random question, return without correct answer
    const q = QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)];
    const qId = crypto.createHash('sha256').update(q.q + q.a).digest('hex').slice(0, 12);
    // Store answer temporarily (60s TTL)
    quizAnswers.set(qId, { correct: q.a, expiresAt: Date.now() + 60_000 });
    // Shuffle options
    const options = [...q.options].sort(() => Math.random() - 0.5);
    respondJson(res, 200, { id: qId, question: q.q, options, category: q.cat, difficulty: q.diff || 'medium' });
    return;
  }
  if (pathname === '/api/quiz/answer' && req.method === 'POST') {
    if (!ipRateLimit('quiz_ans', getClientIp(req), 10, 3000)) return respondJson(res, 429, { error: 'Rate limited' });
    try {
      const body = JSON.parse(await readBody(req));
      const { id, answer, address } = body;
      if (!id || !answer) return respondJson(res, 400, { error: 'id and answer required' });
      const stored = quizAnswers.get(id);
      if (!stored) return respondJson(res, 400, { error: 'Question expired or invalid' });
      quizAnswers.delete(id);
      if (Date.now() > stored.expiresAt) return respondJson(res, 400, { error: 'Time expired' });
      const isCorrect = answer === stored.correct;
      let earned = 0;
      if (isCorrect && address) {
        // Earn 5 coins per correct answer (max 100/day via quiz = 500 coins)
        const dailyKey = `quiz:${address}:${new Date().toISOString().slice(0, 10)}`;
        const dailyCount = (prismEarnRateLimit.get(dailyKey) || 0);
        if (dailyCount < 100) {
          prismEarnRateLimit.set(dailyKey, dailyCount + 1);
          earned = 5;
          const prevBal = getCoinBalance(address);
          setCoinBalance(address, prevBal + earned);
          addCoinEarned(address, earned);
          const txRecord = { id: `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, address, amount: earned, type: 'earn', source: 'quiz', description: 'Quiz correct answer', timestamp: new Date().toISOString() };
          const txs = prismTransactions.get(address) || [];
          txs.unshift(txRecord);
          if (txs.length > 500) txs.length = 500;
          prismTransactions.set(address, txs);
          debouncedSavePrism();
        }
      }
      respondJson(res, 200, { correct: isCorrect, correctAnswer: stored.correct, earned });
    } catch {
      respondJson(res, 400, { error: 'Invalid request body' });
    }
    return;
  }

  // ═══ Scam Check ═══
  if (pathname === '/api/scam-check' && req.method === 'POST') {
    const scamClientIp = getClientIp(req);
    const scamRlKey = `scam:${scamClientIp}`;
    const lastScam = prismEarnRateLimit.get(scamRlKey) || 0;
    if (Date.now() - lastScam < 10_000) return respondJson(res, 429, { error: 'Rate limited' });
    prismEarnRateLimit.set(scamRlKey, Date.now());
    try {
      const { address } = JSON.parse(await readBody(req));
      if (!address) return respondJson(res, 400, { error: 'contract address required' });
      const isKnownScam = KNOWN_SCAM_ADDRESSES.has(address);
      let programInfo = null;
      try {
        const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
        const info = await conn.getAccountInfo(new PublicKey(address));
        if (info) { programInfo = { executable: info.executable, owner: info.owner?.toBase58(), lamports: info.lamports, dataSize: info.data?.length || 0 }; }
      } catch {}
      respondJson(res, 200, { address, isKnownScam, isExecutable: programInfo?.executable || false, programInfo, verdict: isKnownScam ? 'FLAGGED — Known scam contract' : programInfo?.executable ? 'Program found — not in blocklist' : 'Not a program account' });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  // ═══ Global Leaderboard ═══
  if (pathname === '/api/leaderboard' && req.method === 'GET') {
    if (!ipRateLimit('glb_lb', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const entryMap = new Map();
    // Seed from score history
    for (const [address, hist] of scoreHistory) {
      const latest = hist.scores?.[0];
      if (latest) {
        entryMap.set(address, {
          address,
          totalCoins: getCoinBalance(address),
          score: latest.score,
          tier: latest.tier || 'unknown',
          prismBalance: getCoinBalance(address),
          isMinted: mintedAddresses.has(address),
          badges: 0,
          rank: 0,
        });
      }
    }
    // Add wallets that have coins but no score history
    for (const [address] of coinBalances) {
      if (!entryMap.has(address)) {
        entryMap.set(address, {
          address,
          totalCoins: getCoinBalance(address),
          score: 0,
          tier: 'unknown',
          prismBalance: getCoinBalance(address),
          isMinted: mintedAddresses.has(address),
          badges: 0,
          rank: 0,
        });
      }
    }
    const entries = [...entryMap.values()].sort((a, b) => b.totalCoins - a.totalCoins || b.score - a.score || b.prismBalance - a.prismBalance);
    entries.forEach((e, i) => { e.rank = i + 1; });
    respondJson(res, 200, { entries: entries.slice(0, limit) });
    return;
  }

  // ═══ Reputation API v2 — OPTIONS preflight ═══
  if (pathname === '/api/v2/reputation' && req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': resolveCorsOrigin(req), 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-API-Key', 'Access-Control-Max-Age': '86400' });
    res.end();
    return;
  }

  // ═══ Reputation API v2 ═══
  if (pathname === '/api/v2/reputation' && req.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address) return respondJson(res, 400, { error: 'address query parameter required', docs: 'GET /api/v2/reputation?address=<solana_address>' });
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
    const ip = getClientIp(req);
    const apiKey = req.headers['x-api-key']; // only accept via header (not URL query — leaks in logs)
    // API key validation
    const API_KEY_REGISTRY = new Map(
      (process.env.REPUTATION_API_KEYS || '').split(',').filter(Boolean).map(k => [k.trim(), true])
    );
    let maxPerMin = 10; // no key
    if (apiKey) {
      if (!API_KEY_REGISTRY.has(apiKey) && API_KEY_REGISTRY.size > 0) {
        return respondJson(res, 401, { error: 'Invalid API key' });
      }
      maxPerMin = 60;
    }
    const now = Date.now();
    const rl = reputationV2RateLimit.get(ip) || { count: 0, resetAt: now + 60000 };
    if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + 60000; }
    rl.count++;
    reputationV2RateLimit.set(ip, rl);
    if (rl.count > maxPerMin) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end(JSON.stringify({ error: 'Rate limited', retryAfterSec: Math.ceil((rl.resetAt - now) / 1000) }));
      return;
    }
    try {
      const snapshot = await fetchIdentitySnapshot(address);
      const identity = snapshot.identity;
      if (!identity || identity.error) return respondJson(res, 404, { error: 'Could not resolve wallet identity', address });
      let sybil = null;
      const cachedSybil = sybilCache.get(address);
      if (cachedSybil && now - cachedSybil.cachedAt < 3600_000) sybil = cachedSybil.analysis;
      const history = getScoreHistory(address);
      const latestScores = (history.scores || []).slice(0, 5);
      const coinBal = getCoinBalance(address);
      // Composite score
      // Always recalculate composite to avoid stale data (cheap operation)
      const compositeData = calculateCompositeScore(buildCompositeInput(address));
      const achEntry = achievementData.get(address);
      const response = {
        version: '2.1', address,
        onchainScore: identity.score,
        compositeScore: compositeData.compositeScore,
        compositeTier: compositeData.compositeTier,
        scoreBreakdown: compositeData.breakdown,
        scoreDetails: compositeData.details || null,
        identity: { score: identity.score, maxScore: 1000, tier: identity.tier, badges: identity.badges || [], badgeCount: identity.badges?.length || 0 },
        stats: { solBalance: Math.round(snapshot.solBalance * 1000) / 1000, walletAgeDays: snapshot.walletAgeDays, transactionCount: snapshot.txCount, tokenCount: snapshot.tokenCount, nftCount: snapshot.nftCount },
        sybilAnalysis: sybil ? {
          trustScore: sybil.trustScore,
          trustGrade: sybil.trustGrade,
          riskScore: sybil.riskScore,
          riskLevel: sybil.riskLevel,
          verdict: sybil.verdict || getSybilVerdict(sybil),
          signalsDetected: sybil.signals?.filter(s => s.detected).length || 0,
          totalSignals: sybil.signals?.length || 0,
        } : null,
        achievements: { unlocked: achEntry ? achEntry.unlocked.size : 0, claimed: achEntry ? achEntry.claimed.size : 0 },
        prism: coinBal > 0 ? { balance: coinBal, totalEarned: coinBal } : null,
        scoreHistory: latestScores,
        meta: { timestamp: new Date().toISOString(), cached: Boolean(cachedSybil), provider: 'Identity Prism', website: 'https://identityprism.xyz' },
      };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': resolveCorsOrigin(req), 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-API-Key', 'Cache-Control': 'private, no-store' });
      res.end(JSON.stringify(response));
    } catch (e) {
      respondJson(res, 500, { error: 'Internal error' });
    }
    return;
  }

  // ═══ Quest Sync ═══
  if (pathname === '/api/quest/sync' && req.method === 'POST') {
    if (!ipRateLimit('quest_sync', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const { address, quests } = JSON.parse(await readBody(req));
      if (address && address !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      const addr = jwtAuth.address;
      if (!quests || typeof quests !== 'object' || Array.isArray(quests)) return respondJson(res, 400, { error: 'quests object required' });
      // Validate quest data: only allow known quest IDs with numeric progress/claimed fields
      const VALID_QUEST_IDS = new Set([
        'daily_scan', 'daily_game', 'daily_burn', 'daily_explore', 'daily_highscore',
        'weekly_burn5', 'weekly_games5', 'weekly_arena', 'weekly_streak', 'weekly_forge',
        'ot_first_scan', 'ot_first_mint', 'ot_first_burn', 'ot_first_game',
        'ot_reach_sun', 'ot_burn100', 'ot_score1000', 'ot_forge5', 'ot_arena_wins', 'ot_text_quest',
      ]);
      const existingQuests = (questProgress.get(addr) || {}).quests || {};
      const sanitized = {};
      for (const [key, val] of Object.entries(quests)) {
        if (!VALID_QUEST_IDS.has(key)) continue;
        if (!val || typeof val !== 'object') continue;
        const prev = existingQuests[key] || {};
        const progress = Math.max(0, Math.min(Number(val.progress ?? val.current) || 0, 100000));
        // Server-side: completed can only go false→true (never back), and only if progress > 0
        // claimed can only go false→true (once claimed, stays claimed)
        // Support both `claimed` (boolean) and `claimedAt` (ISO string) from client
        const isClaimed = val.claimed === true || !!val.claimedAt;
        const completed = prev.completed === true ? true : ((val.completed === true || isClaimed) && progress > 0);
        const claimed = prev.claimed === true ? true : (isClaimed && completed);
        sanitized[key] = { progress, claimed, completed };
      }
      const existing = questProgress.get(addr) || {};
      // Streak only increments if at least one quest was completed today
      const hasCompletedQuest = Object.values(sanitized).some(q => q.completed);
      const today = new Date().toISOString().slice(0, 10);
      const lastDate = existing.lastStreakDate || '';
      let streakDays = existing.streakDays || 0;
      if (lastDate === today) {
        // Same day — no change
      } else if (!hasCompletedQuest) {
        // No quest completed today — reset streak if day was skipped
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (lastDate && lastDate !== yesterday) streakDays = 0;
      } else {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        streakDays = lastDate === yesterday ? streakDays + 1 : 1;
      }
      const streakDate = hasCompletedQuest ? today : (existing.lastStreakDate || today);
      questProgress.set(addr, { ...existing, quests: sanitized, streakDays, lastStreakDate: streakDate, updatedAt: new Date().toISOString() });
      persistQuestProgress();
      triggerCompositeUpdate(addr);
      respondJson(res, 200, { ok: true });
    } catch { respondJson(res, 400, { error: 'Invalid JSON body' }); }
    return;
  }

  if (pathname === '/api/quest/progress' && req.method === 'GET') {
    if (!ipRateLimit('quest_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const addr = url.searchParams.get('address');
    if (!addr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return respondJson(res, 400, { error: 'Valid address required' });
    const qp = questProgress.get(addr) || { quests: {} };
    respondJson(res, 200, qp);
    return;
  }

  // ═══ Marketplace Listings ═══
  if (pathname === '/api/marketplace/listings' && req.method === 'GET') {
    if (!ipRateLimit('mkt_list', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const category = url.searchParams.get('category');
    const entries = [...marketplaceListings.values()]
      .filter(l => l.status === 'approved' && (!category || l.category === category))
      .sort((a, b) => b.createdAt - a.createdAt);
    respondJson(res, 200, { listings: entries });
    return;
  }

  // ═══ Marketplace My Purchases ═══
  if (pathname === '/api/marketplace/my-purchases' && req.method === 'GET') {
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const address = jwtAuth.address;
    if (!address) return respondJson(res, 400, { error: 'address required' });
    const owned = [];
    for (const [key] of marketplacePurchases) {
      if (key.startsWith(address + ':')) {
        const listingId = key.split(':')[1];
        const listing = marketplaceListings.get(listingId);
        if (listing) owned.push(listing);
      }
    }
    respondJson(res, 200, { purchases: owned });
    return;
  }

  // ═══ Marketplace Upload ═══
  if (pathname === '/api/marketplace/upload' && req.method === 'POST') {
    if (!ipRateLimit('mkt_upload', getClientIp(req), 5, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const { address, name, description, category, price, modelData, modelFormat, previewImage } = JSON.parse(await readBody(req));
      if (address && address !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!address || !name || !modelData || !price) return respondJson(res, 400, { error: 'address, name, modelData, price required' });
      // Validate format, size, and content BEFORE charging fee
      const format = (modelFormat || '').toLowerCase();
      if (!['glb', 'gltf', 'obj'].includes(format)) return respondJson(res, 400, { error: 'Invalid format. Supported: GLB, GLTF, OBJ' });
      if (modelData.length > 5 * 1024 * 1024 * 1.37) return respondJson(res, 400, { error: 'Model too large. Max 5MB.' });
      const priceNum = Math.max(1, Math.floor(Number(price)));
      if (priceNum > 10000) return respondJson(res, 400, { error: 'Price too high. Max 10000 Coins.' });
      // Decode base64 once for validation + later write
      let modelBuf;
      try { modelBuf = Buffer.from(modelData.split(',').pop() || modelData, 'base64'); } catch { return respondJson(res, 400, { error: 'Invalid base64 encoding' }); }
      if (format === 'glb') {
        if (modelBuf.length < 12) return respondJson(res, 400, { error: 'GLB file too small' });
        const magic = modelBuf.readUInt32LE(0);
        if (magic !== 0x46546C67) return respondJson(res, 400, { error: 'Invalid GLB file — magic bytes mismatch.' });
        const version = modelBuf.readUInt32LE(4);
        if (version !== 2) return respondJson(res, 400, { error: `Unsupported GLB version ${version}. Only glTF 2.0 supported.` });
      }
      // All validation passed — now charge listing fee
      const LISTING_FEE = 10;
      const listingBal = getCoinBalance(address);
      if (listingBal < LISTING_FEE) return respondJson(res, 400, { error: `Insufficient balance. Listing fee: ${LISTING_FEE} Coins` });
      const { burned: listBurned } = applyBurnFee(LISTING_FEE);
      setCoinBalance(address, listingBal - LISTING_FEE);
      addCoinSpent(address, LISTING_FEE);
      const wList = walletDatabase.get(address);
      if (wList) { wList.coins = listingBal - LISTING_FEE; saveWalletDatabaseDebounced(); }
      const id = `model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const modelsDir = path.join(process.cwd(), 'marketplace_models');
      if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
      const modelPath = path.join(modelsDir, `${id}.${format}`);
      await fs.promises.writeFile(modelPath, modelBuf);
      // Validate previewImage MIME type (must be a valid image data URL)
      let safePreview = null;
      if (previewImage) {
        if (!/^data:image\/(png|jpe?g|gif|webp);base64,/.test(previewImage)) return respondJson(res, 400, { error: 'previewImage must be a valid image data URL (png, jpg, gif, webp)' });
        safePreview = previewImage.slice(0, 100000);
      }
      const listing = { id, seller: jwtAuth.address, name: name.slice(0, 60), description: (description || '').slice(0, 200), category: ['ship', 'planet', 'badge', 'decoration'].includes(category) ? category : 'ship', price: priceNum, format, modelUrl: `/marketplace_models/${id}.${format}`, previewImage: safePreview, status: 'pending', purchaseCount: 0, createdAt: Date.now() };
      marketplaceListings.set(id, listing);
      saveMarketplace();
      respondJson(res, 200, { listing, message: 'Model uploaded successfully!' });
    } catch (e) { console.error('[marketplace] Upload failed:', e.message); respondJson(res, 500, { error: 'Upload failed' }); }
    return;
  }

  // ═══ Marketplace Purchase ═══
  if (pathname === '/api/marketplace/purchase' && req.method === 'POST') {
    if (!ipRateLimit('mkt_purchase', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const { address, listingId } = JSON.parse(await readBody(req));
      if (address && address !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!address || !listingId) return respondJson(res, 400, { error: 'address and listingId required' });
      // Race condition guard: lock on purchaseKey
      const purchaseKey = `${address}:${listingId}`;
      if (marketplacePurchases.has(purchaseKey)) return respondJson(res, 400, { error: 'Already purchased' });
      // Mark as purchased BEFORE balance check to prevent double-spend race
      marketplacePurchases.set(purchaseKey, true);
      const listing = marketplaceListings.get(listingId);
      if (!listing) { marketplacePurchases.delete(purchaseKey); return respondJson(res, 404, { error: 'Listing not found' }); }
      if (listing.status !== 'approved') { marketplacePurchases.delete(purchaseKey); return respondJson(res, 400, { error: 'Listing is not available for purchase' }); }
      if (listing.seller === address) { marketplacePurchases.delete(purchaseKey); return respondJson(res, 400, { error: 'Cannot purchase your own listing' }); }
      const buyerBal = getCoinBalance(address);
      if (buyerBal < listing.price) { marketplacePurchases.delete(purchaseKey); return respondJson(res, 400, { error: 'Insufficient Coin balance' }); }
      // Marketplace: platform is the seller — coins are spent (deflationary)
      setCoinBalance(address, buyerBal - listing.price);
      addCoinSpent(address, listing.price);
      totalBurned += listing.price;
      listing.purchaseCount = (listing.purchaseCount || 0) + 1;
      marketplaceListings.set(listingId, listing);
      debouncedSavePrism();
      saveMarketplace();
      respondJson(res, 200, { success: true, listing, newBalance: getCoinBalance(address), message: `Purchased "${listing.name}" for ${listing.price} Coins` });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // P2P Challenge System
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Challenge: Create ──
  if (pathname === '/api/challenge/create' && req.method === 'POST') {
    if (!ipRateLimit('ch_create', getClientIp(req), 5, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const body = JSON.parse(await readBody(req));
      const { type, gameMode, stakeAmount, opponent, betType, expiresMinutes } = body;
      const creator = jwtAuth.address;
      // SOL stakes disabled — security risk without escrow smart contract
      if (betType === 'sol') return respondJson(res, 400, { error: 'SOL stakes are temporarily disabled. Use Coins.' });
      const isSolBet = false;

      // Validate type
      if (!type || !['score', 'game'].includes(type)) {
        return respondJson(res, 400, { error: 'type must be "score" or "game"' });
      }
      // Validate gameMode for game type
      if (type === 'game') {
        if (!gameMode || !['orbit', 'destroyer', 'gravity'].includes(gameMode)) {
          return respondJson(res, 400, { error: 'gameMode must be "orbit", "destroyer", or "gravity" for game challenges' });
        }
      }
      // Validate stakeAmount
      const stake = isSolBet ? Number(stakeAmount) : Math.floor(Number(stakeAmount));
      if (!Number.isFinite(stake) || stake < 5) {
        return respondJson(res, 400, { error: 'Minimum stake is 5 Coins' });
      }
      if (!isSolBet && stake > 1000) {
        return respondJson(res, 400, { error: 'stakeAmount cannot exceed 1000 Coins' });
      }
      if (isSolBet && stake > 10) {
        return respondJson(res, 400, { error: 'SOL stake cannot exceed 10 SOL' });
      }
      // Validate opponent if provided
      if (opponent) {
        if (opponent === creator) {
          return respondJson(res, 400, { error: 'Cannot challenge yourself' });
        }
        try { new PublicKey(opponent); } catch { return respondJson(res, 400, { error: 'Invalid opponent address' }); }
      }

      if (isSolBet) {
        // Verify SOL transfer to treasury
        if (!solTxSignature) return respondJson(res, 400, { error: 'solTxSignature required for SOL bets' });
        // Dedup: prevent reusing same tx for multiple challenges (Map with TTL + file persist)
        const USED_CHALLENGE_TX_FILE = path.join(METADATA_DIR, 'used-challenge-tx.json');
        if (!globalThis._usedChallengeSolTx) {
          const m = new Map();
          try { const d = JSON.parse(fs.readFileSync(USED_CHALLENGE_TX_FILE, 'utf8')); for (const [k, v] of Object.entries(d)) m.set(k, v); } catch {}
          globalThis._usedChallengeSolTx = m;
        }
        // Periodic cleanup (every 500 requests)
        if (!globalThis._challengeTxCleanupCounter) globalThis._challengeTxCleanupCounter = 0;
        if (++globalThis._challengeTxCleanupCounter % 500 === 0) {
          const cutoff = Date.now() - 48 * 60 * 60 * 1000;
          for (const [sig, ts] of globalThis._usedChallengeSolTx) { if (ts < cutoff) globalThis._usedChallengeSolTx.delete(sig); }
          const _ctTmp = USED_CHALLENGE_TX_FILE + '.tmp'; const _ctObj = {}; for (const [k, v] of globalThis._usedChallengeSolTx) _ctObj[k] = v;
          fs.promises.writeFile(_ctTmp, JSON.stringify(_ctObj), 'utf8').then(() => fs.promises.rename(_ctTmp, USED_CHALLENGE_TX_FILE)).catch(() => {});
        }
        if (globalThis._usedChallengeSolTx.has(solTxSignature)) return respondJson(res, 400, { error: 'This SOL transaction has already been used' });
        globalThis._usedChallengeSolTx.set(solTxSignature, Date.now());
        try {
          const conn = new Connection(getRpcUrl(creator) || 'https://api.mainnet-beta.solana.com', 'confirmed');
          const tx = await conn.getParsedTransaction(solTxSignature, { maxSupportedTransactionVersion: 0 });
          if (!tx) { globalThis._usedChallengeSolTx.delete(solTxSignature); return respondJson(res, 400, { error: 'Transaction not found. Wait for confirmation and retry.' }); }
          // Verify transfer to treasury from creator
          const treasuryAddr = TREASURY_ADDRESS || '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
          if (!treasuryAddr) { globalThis._usedChallengeSolTx.delete(solTxSignature); return respondJson(res, 500, { error: 'Treasury not configured' }); }
          const instructions = tx.transaction?.message?.instructions || [];
          const validTransfer = instructions.some(ix => {
            if (ix.programId?.toBase58?.() === '11111111111111111111111111111111' && ix.parsed?.type === 'transfer') {
              const info = ix.parsed.info;
              return info.source === creator && info.destination === treasuryAddr && info.lamports >= Math.floor(stake * 1e9 * 0.99);
            }
            return false;
          });
          if (!validTransfer) { globalThis._usedChallengeSolTx.delete(solTxSignature); return respondJson(res, 400, { error: 'SOL transfer to treasury not verified' }); }
        } catch (e) { console.error('[challenge] SOL verify failed:', e.message); globalThis._usedChallengeSolTx.delete(solTxSignature); return respondJson(res, 400, { error: 'SOL transfer verification failed' }); }
      } else {
        // Check creator Coin balance
        const creatorBal = getPrismBalance(creator);
        if (creatorBal.balance < stake) {
          return respondJson(res, 400, { error: `Insufficient balance. Have ${creatorBal.balance} Coins, need ${stake}` });
        }
        // Lock Coins from creator
        setCoinBalance(creator, creatorBal.balance - stake);
        addCoinSpent(creator, stake);
        const _txs = prismTransactions.get(creator) || [];
        _txs.unshift({ id: `ch_stake_${Date.now()}`, address: creator, amount: stake, type: 'spend', source: 'challenge_entry', description: `Challenge stake: -${stake} Coins`, timestamp: new Date().toISOString() });
        if (_txs.length > 200) _txs.length = 200;
        prismTransactions.set(creator, _txs);
        debouncedSavePrism();
      }

      const challenge = {
        id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        creator,
        opponent: opponent || null,
        type,
        gameMode: type === 'game' ? gameMode : null,
        stakeType: isSolBet ? 'sol' : 'coins',
        stakeAmount: stake,
        status: type === 'game' ? 'playing' : 'open',
        creatorScore: null,
        opponentScore: null,
        winner: null,
        createdAt: Date.now(),
        expiresAt: expiresMinutes && [15, 30, 60, 180, 360, 720, 1440].includes(Number(expiresMinutes))
          ? Date.now() + Number(expiresMinutes) * 60_000
          : Date.now() + 60 * 60_000, // default 1 hour
        acceptedAt: null,
        completedAt: null,
        solTxCreator: isSolBet ? solTxSignature : null,
        solTxAcceptor: null,
      };
      // Cap: prevent unbounded growth (evict completed/expired before adding)
      if (challenges.length >= 10000) {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (let i = challenges.length - 1; i >= 0; i--) {
          if ((challenges[i].status === 'completed' || challenges[i].status === 'expired' || challenges[i].status === 'cancelled') && challenges[i].createdAt < cutoff) challenges.splice(i, 1);
        }
        if (challenges.length >= 10000) return respondJson(res, 429, { error: 'Too many active challenges' });
      }
      challenges.push(challenge);
      saveChallenges();
      console.log(`[challenges] Created ${challenge.id} by ${creator.slice(0, 8)}... (${type}, ${stake} ${isSolBet ? 'SOL' : 'Coins'})`);
      respondJson(res, 200, { ok: true, challenge });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  // ── Challenge: List open (public — no auth required) ──
  // ── Challenge Leaderboard (weekly + all-time) ──
  if (pathname === '/api/challenge/leaderboard' && req.method === 'GET') {
    if (!ipRateLimit('ch_lb', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    try {
      const now = Date.now();
      // Monday 00:00 UTC of current week
      const d = new Date(now);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const weekStart = d.getTime();
      const weeklyStats = new Map();
      const allTimeStats = new Map();
      const buildEntry = (addr) => ({ address: addr, wins: 0, losses: 0, earned: 0, played: 0 });
      for (const c of challenges) {
        if (c.status !== 'completed' || !c.winner) continue;
        const loser = c.winner === c.creator ? c.opponent : c.creator;
        const prize = Math.floor(c.stakeAmount * 2 * 0.95);
        const isThisWeek = (c.completedAt || c.createdAt) >= weekStart;
        // All-time
        const aw = allTimeStats.get(c.winner) || buildEntry(c.winner); aw.wins++; aw.earned += prize; aw.played++; allTimeStats.set(c.winner, aw);
        if (loser) { const al = allTimeStats.get(loser) || buildEntry(loser); al.losses++; al.played++; allTimeStats.set(loser, al); }
        // Weekly
        if (isThisWeek) {
          const ww = weeklyStats.get(c.winner) || buildEntry(c.winner); ww.wins++; ww.earned += prize; ww.played++; weeklyStats.set(c.winner, ww);
          if (loser) { const wl = weeklyStats.get(loser) || buildEntry(loser); wl.losses++; wl.played++; weeklyStats.set(loser, wl); }
        }
      }
      const MIN_GAMES = 3;
      const weekly = [...weeklyStats.values()].filter(p => p.played >= MIN_GAMES).sort((a, b) => b.earned - a.earned || b.wins - a.wins).slice(0, 20);
      const allTime = [...allTimeStats.values()].sort((a, b) => b.earned - a.earned || b.wins - a.wins).slice(0, 20);
      // Weekly rewards info (matches cron distribution)
      const weeklyWithRewards = weekly.map((p, i) => ({ ...p, reward: WEEKLY_REWARDS[i] || 0, xpReward: WEEKLY_XP_REWARDS[i] || 0 }));
      // Next reset (next Monday 00:00 UTC)
      const nextReset = weekStart + 7 * 24 * 60 * 60 * 1000;
      // Last week's winners (from challengeWeeklyHistory)
      const lastWeek = globalThis._challengeWeeklyHistory || [];
      respondJson(res, 200, { ok: true, weekly: weeklyWithRewards, allTime, nextReset, lastWeekWinners: lastWeek, minGames: MIN_GAMES });
    } catch (e) {
      respondJson(res, 200, { ok: true, weekly: [], allTime: [], nextReset: 0, lastWeekWinners: [], minGames: 3 });
    }
    return;
  }

  if (pathname === '/api/challenge/list' && req.method === 'GET') {
    if (!ipRateLimit('ch_list', getClientIp(req), 60, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    try {
      const now = Date.now();
      const open = (challenges || [])
        .filter(c => c && (c.status === 'open' || (c.status === 'playing' && !c.opponent)))
        // Hide expired challenges (timer ran out, expiry cron may not have fired yet)
        .filter(c => !c.expiresAt || c.expiresAt > now)
        // Hide game challenges where creator hasn't played yet (not ready for opponents)
        .filter(c => c.type !== 'game' || c.creatorScore !== null)
        .slice(0, 50);
      respondJson(res, 200, { ok: true, challenges: open });
    } catch (e) {
      console.warn('[challenges] list error', e?.message);
      respondJson(res, 200, { ok: true, challenges: [] });
    }
    return;
  }

  // ── Challenge: My challenges (JWT required) ──
  if (pathname === '/api/challenge/my' && req.method === 'GET') {
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const address = jwtAuth.address;
    if (!address) return respondJson(res, 400, { error: 'Authentication required' });
    try {
      const my = (challenges || [])
        .filter(c => c && (c.creator === address || c.opponent === address))
        .slice(0, 50);
      respondJson(res, 200, { ok: true, challenges: my });
    } catch (e) {
      console.warn('[challenges] my error', e?.message);
      respondJson(res, 200, { ok: true, challenges: [] });
    }
    return;
  }

  // ── Challenge: Accept ──
  if (pathname === '/api/challenge/accept' && req.method === 'POST') {
    if (!ipRateLimit('ch_accept', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    let _acceptSolTxSig = null;
    try {
      const { challengeId, solTxSignature } = JSON.parse(await readBody(req));
      _acceptSolTxSig = solTxSignature || null;
      const acceptor = jwtAuth.address;
      if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });

      const challenge = challenges.find(c => c.id === challengeId);
      if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
      // Block expired challenges (cron may not have fired yet)
      if (challenge.expiresAt && Date.now() > challenge.expiresAt) {
        return respondJson(res, 409, { error: 'Challenge has expired' });
      }
      // Allow accept for 'open' (score challenges) and 'playing' without opponent (game challenges where creator already played)
      if (challenge.status !== 'open' && !(challenge.status === 'playing' && !challenge.opponent)) {
        return respondJson(res, 409, { error: 'Challenge no longer available' });
      }
      // Game challenges: creator must have played before opponent can accept
      if (challenge.type === 'game' && challenge.creatorScore === null) {
        return respondJson(res, 400, { error: 'Creator hasn\'t played yet — challenge not ready' });
      }
      if (challenge.creator === acceptor) return respondJson(res, 400, { error: 'Cannot accept your own challenge' });
      if (challenge.opponent && challenge.opponent !== acceptor) {
        return respondJson(res, 403, { error: 'This challenge is for a specific opponent' });
      }

      const isSolBet = challenge.stakeType === 'sol';

      // Save original state for rollback (preserve private opponent)
      const origOpponent = challenge.opponent;
      const origStatus = challenge.status;
      const origAcceptedAt = challenge.acceptedAt;
      const rollback = () => { challenge.status = origStatus; challenge.opponent = origOpponent; challenge.acceptedAt = origAcceptedAt; saveChallenges(); };

      // Lock challenge immediately to prevent race condition on double accept
      challenge.status = 'accepted';
      challenge.opponent = acceptor;
      challenge.acceptedAt = Date.now();
      saveChallenges();

      if (isSolBet) {
        // Verify SOL transfer from acceptor
        if (!solTxSignature) {
          rollback();
          return respondJson(res, 400, { error: 'solTxSignature required for SOL challenges' });
        }
        // Dedup SOL tx (Map with TTL — initialized in create path above)
        if (!globalThis._usedChallengeSolTx) globalThis._usedChallengeSolTx = new Map();
        if (globalThis._usedChallengeSolTx.has(solTxSignature)) { rollback(); return respondJson(res, 400, { error: 'This SOL transaction has already been used' }); }
        globalThis._usedChallengeSolTx.set(solTxSignature, Date.now());
        try {
          const conn = new Connection(getRpcUrl(acceptor) || 'https://api.mainnet-beta.solana.com', 'confirmed');
          const tx = await conn.getParsedTransaction(solTxSignature, { maxSupportedTransactionVersion: 0 });
          if (!tx) { rollback(); return respondJson(res, 400, { error: 'Transaction not found' }); }
          const treasuryAddr = TREASURY_ADDRESS || '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
          const instructions = tx.transaction?.message?.instructions || [];
          const validTransfer = instructions.some(ix => {
            if (ix.programId?.toBase58?.() === '11111111111111111111111111111111' && ix.parsed?.type === 'transfer') {
              return ix.parsed.info.source === acceptor && ix.parsed.info.destination === treasuryAddr && ix.parsed.info.lamports >= Math.floor(challenge.stakeAmount * 1e9 * 0.99);
            }
            return false;
          });
          if (!validTransfer) { globalThis._usedChallengeSolTx.delete(solTxSignature); rollback(); return respondJson(res, 400, { error: 'SOL transfer to treasury not verified' }); }
          challenge.solTxAcceptor = solTxSignature;
        } catch (e) { console.error('[challenge] SOL verify failed:', e.message); globalThis._usedChallengeSolTx.delete(solTxSignature); rollback(); return respondJson(res, 400, { error: 'Transfer verification failed' }); }
      } else {
        // Check acceptor Coin balance
        const accBal = getCoinBalance(acceptor);
        if (accBal < challenge.stakeAmount) {
          rollback();
          return respondJson(res, 400, { error: `Insufficient balance. Have ${accBal} Coins, need ${challenge.stakeAmount}` });
        }
        // Lock Coins from acceptor
        setCoinBalance(acceptor, accBal - challenge.stakeAmount);
        addCoinSpent(acceptor, challenge.stakeAmount);
        debouncedSavePrism();
      }

      if (challenge.type === 'score') {
        // Score challenge: resolve using composite scores (matches card display)
        try {
          // Ensure composite scores are up-to-date
          triggerCompositeUpdate(challenge.creator);
          triggerCompositeUpdate(acceptor);
          const creatorComposite = (walletDatabase.get(challenge.creator) || {}).composite || calculateCompositeScore(buildCompositeInput(challenge.creator));
          const acceptorComposite = (walletDatabase.get(acceptor) || {}).composite || calculateCompositeScore(buildCompositeInput(acceptor));
          challenge.creatorScore = creatorComposite.compositeScore ?? 0;
          challenge.opponentScore = acceptorComposite.compositeScore ?? 0;

          // Determine winner — 10% fee (burned), coins only
          const totalPot = challenge.stakeAmount * 2;
          const feeRate = 0.10;
          const winnerPrize = Math.floor(totalPot * (1 - feeRate));
          const fee = totalPot - winnerPrize;

          const resolveCoinWinner = (winnerAddr) => {
            setCoinBalance(winnerAddr, getCoinBalance(winnerAddr) + winnerPrize);
            addCoinEarned(winnerAddr, winnerPrize);
            // Record transaction
            const txs = prismTransactions.get(winnerAddr) || [];
            txs.unshift({ id: `ch_win_${Date.now()}`, address: winnerAddr, amount: winnerPrize, type: 'earn', source: 'challenge_win', description: `Challenge won: +${winnerPrize} Coins`, timestamp: new Date().toISOString() });
            if (txs.length > 200) txs.length = 200;
            prismTransactions.set(winnerAddr, txs);
          };

          const resolveSolWinner = async (winnerAddr) => {
            challenge.solPayoutAddress = winnerAddr;
            challenge.solPayoutAmount = winnerPrize;
            challenge.solPayoutStatus = 'pending';
            // Attempt payout from treasury
            try {
              const treasurySecret = parseSecretKey(TREASURY_SECRET) ?? loadSecretKeyFromFile(TREASURY_SECRET_PATH);
              if (treasurySecret) {
                const conn = new Connection(getRpcUrl(winnerAddr) || 'https://api.mainnet-beta.solana.com', 'confirmed');
                const treasuryKeypair = Keypair.fromSecretKey(treasurySecret);
                const tx = new Transaction().add(
                  SystemProgram.transfer({ fromPubkey: treasuryKeypair.publicKey, toPubkey: new PublicKey(winnerAddr), lamports: Math.floor(winnerPrize * 1e9) })
                );
                tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
                tx.feePayer = treasuryKeypair.publicKey;
                tx.sign(treasuryKeypair);
                const sig = await conn.sendRawTransaction(tx.serialize());
                challenge.solPayoutTx = sig;
                challenge.solPayoutStatus = 'sent';
                console.log(`[challenges] SOL payout ${winnerPrize} SOL → ${winnerAddr.slice(0,8)}... tx: ${sig}`);
              }
            } catch (e) { console.warn('[challenges] SOL payout failed:', e.message); challenge.solPayoutStatus = 'failed'; }
          };

          if (challenge.creatorScore > challenge.opponentScore) {
            challenge.winner = challenge.creator;
            if (isSolBet) await resolveSolWinner(challenge.creator);
            else resolveCoinWinner(challenge.creator);
            pushNotification(challenge.creator, 'challenge_win', `You won the challenge! +${winnerPrize} coins`, { challengeId, payout: winnerPrize });
            pushNotification(acceptor, 'challenge_loss', `Challenge lost against ${challenge.creator.slice(0, 6)}...`, { challengeId });
          } else if (challenge.opponentScore > challenge.creatorScore) {
            challenge.winner = acceptor;
            if (isSolBet) await resolveSolWinner(acceptor);
            else resolveCoinWinner(acceptor);
            pushNotification(acceptor, 'challenge_win', `You won the challenge! +${winnerPrize} coins`, { challengeId, payout: winnerPrize });
            pushNotification(challenge.creator, 'challenge_loss', `Challenge lost against ${acceptor.slice(0, 6)}...`, { challengeId });
          } else {
            // Tie — refund both (no fee)
            challenge.winner = null;
            if (!isSolBet) {
              // Tie — refund both
              setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
              refundCoinSpent(challenge.creator, challenge.stakeAmount);
              setCoinBalance(acceptor, getCoinBalance(acceptor) + challenge.stakeAmount);
              refundCoinSpent(acceptor, challenge.stakeAmount);
            } else {
              // SOL tie: refund both from treasury
              challenge.solPayoutStatus = 'tie_refund_pending';
            }
          }
          // Burn challenge fee (deflationary, consistent with game challenges)
          if (!isSolBet && challenge.winner && fee > 0) {
            totalBurned += fee;
            debouncedSavePrism();
          }
          challenge.status = 'completed';
          challenge.completedAt = Date.now();
        } catch (scoreErr) {
          // Score fetch failed — refund both and cancel
          console.warn('[challenges] Score fetch failed for', challengeId, scoreErr.message);
          if (!isSolBet) {
            // Score fetch failed — refund both
            setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
            refundCoinSpent(challenge.creator, challenge.stakeAmount);
            setCoinBalance(acceptor, getCoinBalance(acceptor) + challenge.stakeAmount);
            refundCoinSpent(acceptor, challenge.stakeAmount);
          }
          challenge.status = 'cancelled';
          challenge.completedAt = Date.now();
          debouncedSavePrism();
          saveChallenges();
          return respondJson(res, 500, { ok: false, error: 'Failed to fetch identity scores. Stakes refunded.' });
        }
      } else {
        // Game challenge: set to playing, wait for score submissions
        challenge.status = 'playing';
      }

      debouncedSavePrism();
      saveChallenges();
      console.log(`[challenges] Accepted ${challengeId} by ${acceptor.slice(0, 8)}... → status: ${challenge.status}`);
      respondJson(res, 200, { ok: true, challenge });
    } catch (e) {
      if (_acceptSolTxSig && globalThis._usedChallengeSolTx) globalThis._usedChallengeSolTx.delete(_acceptSolTxSig);
      respondJson(res, 400, { error: 'Invalid request body' });
    }
    return;
  }

  // ── Challenge: Mark player as "started playing" (prevents cancel) ──
  if (pathname === '/api/challenge/start' && req.method === 'POST') {
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const { challengeId } = JSON.parse(await readBody(req));
      const player = jwtAuth.address;
      const challenge = challenges.find(c => c.id === challengeId);
      if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
      if (player === challenge.creator) {
        challenge.creatorStartedAt = Date.now();
      } else if (player === challenge.opponent) {
        challenge.acceptorStartedAt = Date.now();
      }
      saveChallenges();
      respondJson(res, 200, { ok: true });
    } catch { respondJson(res, 400, { error: 'Invalid request' }); }
    return;
  }

  // ── Challenge: Submit score (game type only) ──
  if (pathname === '/api/challenge/submit' && req.method === 'POST') {
    if (!ipRateLimit('ch_submit', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const { challengeId, score, gameSessionId } = JSON.parse(await readBody(req));
      const submitter = jwtAuth.address;
      if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });
      if (typeof score !== 'number' || score < 0 || score > 100000) {
        return respondJson(res, 400, { error: 'Invalid score' });
      }
      const scoreNum = Math.floor(Number(score));
      if (!Number.isFinite(scoreNum) || scoreNum < 0) {
        return respondJson(res, 400, { error: 'score must be a non-negative number' });
      }

      const challenge = challenges.find(c => c.id === challengeId);
      if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
      if (challenge.type !== 'game') return respondJson(res, 400, { error: 'Score submission is for game challenges only' });
      // Allow submit in 'playing' or 'open' (creator plays before anyone accepts)
      if (challenge.status !== 'playing' && challenge.status !== 'open') return respondJson(res, 400, { error: 'Challenge is not in playing state' });

      // Per-gameMode score validation
      const CH_MAX_SCORES = { orbit: 600, gravity: 600, destroyer: 9999, wars: 600, territory: 600 };
      const chMaxScore = CH_MAX_SCORES[challenge.gameMode] || 600;
      if (scoreNum > chMaxScore) return respondJson(res, 400, { error: 'Score exceeds maximum for this game mode' });

      // Validate game session proof
      // Without proof (blur-kill): accept but cap at low score to prevent abuse
      const NO_PROOF_MAX = 30; // blur-kill can only submit low scores
      if (gameSessionId) {
        const cSession = gameSessionProofs.get(gameSessionId);
        if (!cSession || !cSession.verified) {
          if (scoreNum > NO_PROOF_MAX) return respondJson(res, 400, { error: 'Unverified session — score too high' });
        } else {
          if (cSession.walletAddress !== submitter) return respondJson(res, 403, { error: 'Session wallet mismatch' });
          if (Math.abs(cSession.score - scoreNum) > 5) return respondJson(res, 400, { error: 'Score does not match session proof' });
          if (challenge.gameMode && cSession.gameMode !== challenge.gameMode) return respondJson(res, 400, { error: 'Session gameMode does not match challenge' });
          // Block reuse of session across different challenges
          if (cSession.usedForChallenge && cSession.usedForChallenge.challengeId !== challengeId) {
            return respondJson(res, 400, { error: 'Game session already used for another challenge' });
          }
        }
      } else {
        // No session at all (blur-kill fallback) — hard cap
        if (scoreNum > NO_PROOF_MAX) return respondJson(res, 400, { error: 'Game session required for this score' });
      }

      // Race condition guard: atomic check-and-set
      const submitKey = `${challengeId}:${submitter}`;
      if (!globalThis._pendingSubmits) globalThis._pendingSubmits = new Set();
      if (globalThis._pendingSubmits.has(submitKey)) return respondJson(res, 409, { error: 'Submission in progress' });
      globalThis._pendingSubmits.add(submitKey);

      // Mark session used AFTER pendingSubmits guard (if session exists)
      if (gameSessionId) {
        const cSession = gameSessionProofs.get(gameSessionId);
        if (cSession) {
          cSession.usedForChallenge = { challengeId, submitter, at: Date.now() };
          persistGameSessionProofs();
        }
      }

      if (submitter === challenge.creator) {
        if (challenge.creatorScore !== null) { globalThis._pendingSubmits.delete(submitKey); return respondJson(res, 400, { error: 'Score already submitted' }); }
        challenge.creatorScore = scoreNum;
      } else if (submitter === challenge.opponent) {
        if (challenge.opponentScore !== null) { globalThis._pendingSubmits.delete(submitKey); return respondJson(res, 400, { error: 'Score already submitted' }); }
        challenge.opponentScore = scoreNum;
      } else {
        globalThis._pendingSubmits.delete(submitKey);
        return respondJson(res, 403, { error: 'You are not a participant in this challenge' });
      }

      // If both scores submitted, resolve the challenge
      if (challenge.creatorScore !== null && challenge.opponentScore !== null) {
        const isSolBet = challenge.stakeType === 'sol';
        const totalPot = challenge.stakeAmount * 2;
        const feeRate = isSolBet ? 0.10 : 0.05;
        const winnerPrize = isSolBet ? totalPot * (1 - feeRate) : Math.floor(totalPot * (1 - feeRate));
        const fee = totalPot - winnerPrize;

        const awardCoinWinner = (addr) => {
          setCoinBalance(addr, getCoinBalance(addr) + winnerPrize);
          addCoinEarned(addr, winnerPrize);
          // Record transaction
          const txs = prismTransactions.get(addr) || [];
          txs.unshift({ id: `ch_win_${Date.now()}`, address: addr, amount: winnerPrize, type: 'earn', source: 'challenge_win', description: `Challenge won: +${winnerPrize} Coins`, timestamp: new Date().toISOString() });
          if (txs.length > 200) txs.length = 200;
          prismTransactions.set(addr, txs);
        };

        const awardSolWinner = async (addr) => {
          challenge.solPayoutAddress = addr;
          challenge.solPayoutAmount = winnerPrize;
          challenge.solPayoutStatus = 'pending';
          try {
            const treasurySecret = parseSecretKey(TREASURY_SECRET) ?? loadSecretKeyFromFile(TREASURY_SECRET_PATH);
            if (treasurySecret) {
              const conn = new Connection(getRpcUrl(addr) || 'https://api.mainnet-beta.solana.com', 'confirmed');
              const kp = Keypair.fromSecretKey(treasurySecret);
              const tx = new Transaction().add(
                SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(addr), lamports: Math.floor(winnerPrize * 1e9) })
              );
              tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
              tx.feePayer = kp.publicKey;
              tx.sign(kp);
              const sig = await conn.sendRawTransaction(tx.serialize());
              challenge.solPayoutTx = sig;
              challenge.solPayoutStatus = 'sent';
            }
          } catch (e) { console.warn('[challenges] SOL payout failed:', e.message); challenge.solPayoutStatus = 'failed'; }
        };

        if (challenge.creatorScore > challenge.opponentScore) {
          challenge.winner = challenge.creator;
          if (isSolBet) await awardSolWinner(challenge.creator);
          else awardCoinWinner(challenge.creator);
        } else if (challenge.opponentScore > challenge.creatorScore) {
          challenge.winner = challenge.opponent;
          if (isSolBet) await awardSolWinner(challenge.opponent);
          else awardCoinWinner(challenge.opponent);
        } else {
          challenge.winner = null;
          if (!isSolBet) {
            // Tie — refund both
            setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
            refundCoinSpent(challenge.creator, challenge.stakeAmount);
            setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
            refundCoinSpent(challenge.opponent, challenge.stakeAmount);
          }
        }
        if (!isSolBet && fee > 0 && challenge.winner) {
          totalBurned += fee;
        }
        // Always persist coin changes (winner prize, tie refund, fee burn)
        debouncedSavePrism();
        challenge.status = 'completed';
        challenge.completedAt = Date.now();
        console.log(`[challenges] Completed ${challengeId}: creator=${challenge.creatorScore}, opponent=${challenge.opponentScore}, winner=${challenge.winner ? challenge.winner.slice(0, 8) + '...' : 'tie'}`);
      }

      debouncedSavePrism();
      saveChallenges();
      globalThis._pendingSubmits.delete(submitKey);
      respondJson(res, 200, { ok: true, challenge });
    } catch (e) { if (typeof submitKey !== 'undefined') globalThis._pendingSubmits?.delete(submitKey); respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  // ── Challenge: Cancel ──
  if (pathname === '/api/challenge/cancel' && req.method === 'POST') {
    if (!ipRateLimit('ch_cancel', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const { challengeId } = JSON.parse(await readBody(req));
      const canceller = jwtAuth.address;
      if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });

      const challenge = challenges.find(c => c.id === challengeId);
      if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
      if (challenge.creator !== canceller) return respondJson(res, 403, { error: 'Only the creator can cancel a challenge' });
      // Terminal states
      if (challenge.status === 'completed' || challenge.status === 'cancelled' || challenge.status === 'expired') {
        return respondJson(res, 400, { error: 'Challenge already finished' });
      }
      // Once opponent accepted, creator cannot cancel — both committed
      // But if status is 'playing' with no opponent, creator is still solo — allow cancel
      if (challenge.status === 'accepted') {
        return respondJson(res, 409, { error: 'Opponent has accepted — challenge cannot be cancelled' });
      }
      if (challenge.status === 'playing' && challenge.opponent) {
        return respondJson(res, 409, { error: 'Opponent is playing — challenge cannot be cancelled' });
      }
      // Only 'open' challenges can be cancelled

      // Lock status BEFORE refund to prevent double-cancel race condition
      challenge.status = 'cancelled';
      challenge.completedAt = Date.now();
      saveChallenges();

      // Early close penalty: 20% fee if creator already played, 10% if not
      const feeRate = challenge.creatorScore !== null ? 0.2 : 0.1;
      const fee = Math.ceil(challenge.stakeAmount * feeRate);
      const refundAmount = challenge.stakeAmount - fee;

      if (challenge.stakeType === 'sol') {
        // SOL refund — send 90% from treasury back to creator (10% kept as fee)
        challenge.solPayoutStatus = 'cancel_refund_pending';
        try {
          const treasurySecret = parseSecretKey(TREASURY_SECRET) ?? loadSecretKeyFromFile(TREASURY_SECRET_PATH);
          if (treasurySecret) {
            const conn = new Connection(getRpcUrl(challenge.creator) || 'https://api.mainnet-beta.solana.com', 'confirmed');
            const kp = Keypair.fromSecretKey(treasurySecret);
            const tx = new Transaction().add(
              SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(challenge.creator), lamports: Math.floor(refundAmount * 1e9) })
            );
            tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
            tx.feePayer = kp.publicKey;
            tx.sign(kp);
            const sig = await conn.sendRawTransaction(tx.serialize());
            challenge.solPayoutTx = sig;
            challenge.solPayoutStatus = 'refunded';
          }
        } catch (e) { console.warn('[challenges] SOL refund failed:', e.message); }
      } else {
        // Coin bet cancel — refund minus fee, burn the fee
        setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + refundAmount);
        refundCoinSpent(challenge.creator, refundAmount);
        totalBurned += fee; // burn cancellation fee
        // If opponent had joined and staked, refund them fully
        if (challenge.opponent) {
          setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
          refundCoinSpent(challenge.opponent, challenge.stakeAmount);
        }
        debouncedSavePrism();
      }

      saveChallenges(); // persist after refund
      console.log(`[challenges] Cancelled ${challengeId} by ${canceller.slice(0, 8)}... — refunded ${refundAmount} (fee: ${fee})`);
      respondJson(res, 200, { ok: true, refunded: refundAmount, fee });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  // ── Challenge: Abandon (leave without playing) ──
  if (pathname === '/api/challenge/abandon' && req.method === 'POST') {
    if (!ipRateLimit('ch_abandon', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    // Support ?token= query param for sendBeacon (no custom headers)
    const urlToken = url.searchParams.get('token');
    let jwtAuth;
    if (urlToken && typeof urlToken === 'string') {
      try {
        const payload = jwt.verify(urlToken, JWT_SECRET, { algorithms: ['HS256'], issuer: 'identity-prism', audience: 'identity-prism-api' });
        jwtAuth = { ok: true, address: payload.address };
      } catch {
        respondJson(res, 401, { error: 'Invalid or expired auth token' });
        return;
      }
    } else {
      jwtAuth = requireJwt(req, res);
    }
    if (!jwtAuth.ok) return;
    try {
      const { challengeId } = JSON.parse(await readBody(req));
      const abandoner = jwtAuth.address;
      if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });

      const challenge = challenges.find(c => c.id === challengeId);
      if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });

      // Must be a participant
      if (challenge.creator !== abandoner && challenge.opponent !== abandoner) {
        return respondJson(res, 403, { error: 'Not a participant of this challenge' });
      }

      if (challenge.status === 'open') {
        // Open challenge — only creator can abandon (same as cancel)
        if (challenge.creator !== abandoner) return respondJson(res, 403, { error: 'Only the creator can abandon an open challenge' });
      } else if (challenge.status === 'playing') {
        // Playing — only allow if neither player submitted a score
        if (challenge.creatorScore !== null || challenge.opponentScore !== null) {
          return respondJson(res, 400, { error: 'Cannot abandon — a score has already been submitted. Finish the game.' });
        }
      } else {
        return respondJson(res, 400, { error: `Cannot abandon a ${challenge.status} challenge` });
      }

      // Lock status BEFORE refund
      challenge.status = 'cancelled';
      challenge.completedAt = Date.now();
      saveChallenges();

      // Refund all participants
      if (challenge.stakeType === 'sol') {
        challenge.solPayoutStatus = 'cancel_refund_pending';
        try {
          const treasurySecret = parseSecretKey(TREASURY_SECRET) ?? loadSecretKeyFromFile(TREASURY_SECRET_PATH);
          if (treasurySecret) {
            const conn = new Connection(getRpcUrl(challenge.creator) || 'https://api.mainnet-beta.solana.com', 'confirmed');
            const kp = Keypair.fromSecretKey(treasurySecret);
            // Refund creator
            const tx1 = new Transaction().add(
              SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(challenge.creator), lamports: Math.floor(challenge.stakeAmount * 1e9) })
            );
            tx1.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
            tx1.feePayer = kp.publicKey;
            tx1.sign(kp);
            await conn.sendRawTransaction(tx1.serialize());
            // Refund opponent if exists
            if (challenge.opponent) {
              const tx2 = new Transaction().add(
                SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(challenge.opponent), lamports: Math.floor(challenge.stakeAmount * 1e9) })
              );
              tx2.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
              tx2.feePayer = kp.publicKey;
              tx2.sign(kp);
              await conn.sendRawTransaction(tx2.serialize());
            }
            challenge.solPayoutStatus = 'refunded';
          }
        } catch (e) { console.warn('[challenges] SOL abandon refund failed:', e.message); }
      } else {
        // Coin refund — creator always
        setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
        refundCoinSpent(challenge.creator, challenge.stakeAmount);
        // Opponent if playing
        if (challenge.opponent) {
          setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
          refundCoinSpent(challenge.opponent, challenge.stakeAmount);
        }
        debouncedSavePrism();
      }

      saveChallenges();
      console.log(`[challenges] Abandoned ${challengeId} by ${abandoner.slice(0, 8)}... — stakes refunded`);
      respondJson(res, 200, { ok: true });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  // ── Notifications API ──
  if (pathname === '/api/notifications' && req.method === 'GET') {
    if (!ipRateLimit('notifs_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const address = jwtAuth.address;
    const notifs = notificationsDb.get(address) || [];
    const unreadCount = notifs.filter(n => !n.read).length;
    respondJson(res, 200, { notifications: notifs, unreadCount });
    return;
  }

  if (pathname === '/api/notifications/read' && req.method === 'POST') {
    if (!ipRateLimit('notifs_post', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const address = jwtAuth.address;
      const { ids, all } = JSON.parse(await readBody(req));
      const notifs = notificationsDb.get(address) || [];
      if (all) {
        notifs.forEach(n => { n.read = true; });
      } else if (Array.isArray(ids)) {
        const idSet = new Set(ids);
        notifs.forEach(n => { if (idSet.has(n.id)) n.read = true; });
      }
      notificationsDb.set(address, notifs);
      saveNotificationsDebounced();
      respondJson(res, 200, { ok: true });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  if (pathname === '/api/notifications/delete' && req.method === 'POST') {
    if (!ipRateLimit('notifs_post', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    try {
      const address = jwtAuth.address;
      const { ids, all } = JSON.parse(await readBody(req));
      if (all) {
        notificationsDb.set(address, []);
      } else if (Array.isArray(ids)) {
        const idSet = new Set(ids);
        const notifs = (notificationsDb.get(address) || []).filter(n => !idSet.has(n.id));
        notificationsDb.set(address, notifs);
      }
      saveNotificationsDebounced();
      respondJson(res, 200, { ok: true });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  if (pathname === '/api/notifications/unread-count' && req.method === 'GET') {
    const address = normalizePubkey(url.searchParams.get('address'));
    if (!address) return respondJson(res, 400, { error: 'address required' });
    const notifs = notificationsDb.get(address) || [];
    const count = notifs.filter(n => !n.read).length;
    respondJson(res, 200, { count });
    return;
  }

  // ── Admin: List SOL stale/cancel refund pending challenges ──
  if (pathname === '/api/admin/challenge/stale-sol-refunds' && req.method === 'GET') {
    if (!requireAdminKey(req, res)) return;
    const stale = (challenges || []).filter(c => c && (c.solPayoutStatus === 'stale_refund_pending' || c.solPayoutStatus === 'cancel_refund_pending'));
    respondJson(res, 200, { ok: true, count: stale.length, challenges: stale.map(c => ({ id: c.id, creator: c.creator, opponent: c.opponent, stakeAmount: c.stakeAmount, createdAt: c.createdAt, solPayoutStatus: c.solPayoutStatus, status: c.status })) });
    return;
  }

  // ── Admin: Mark SOL stale/cancel refund as processed ──
  if (pathname === '/api/admin/challenge/stale-sol-refunds' && req.method === 'POST') {
    if (!requireAdminKey(req, res)) return;
    try {
      const body = await readBody(req);
      const { challengeId, action } = JSON.parse(body);
      const ch = (challenges || []).find(c => c.id === challengeId);
      if (!ch || (ch.solPayoutStatus !== 'stale_refund_pending' && ch.solPayoutStatus !== 'cancel_refund_pending')) return respondJson(res, 404, { error: 'Challenge not found or not pending refund' });
      ch.solPayoutStatus = action === 'refunded' ? 'refunded' : 'rejected';
      saveChallenges();
      respondJson(res, 200, { ok: true, challengeId, status: ch.solPayoutStatus });
    } catch { respondJson(res, 400, { error: 'Invalid request body' }); }
    return;
  }

  // ═══ Serve Marketplace Model Files ═══
  if (pathname.startsWith('/marketplace_models/') && req.method === 'GET') {
    const modelsRoot = path.join(process.cwd(), 'marketplace_models');
    const filePath = path.resolve(path.join(process.cwd(), pathname));
    if (!filePath.startsWith(modelsRoot + path.sep) && filePath !== modelsRoot) return respondJson(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(filePath)) return respondJson(res, 404, { error: 'Model not found' });
    // Access control: require JWT and verify caller has purchased the listing or is the seller
    const jwtAuth = optionalJwt(req, res);
    if (!jwtAuth.ok) return respondJson(res, 401, { error: 'Invalid token' });
    if (!jwtAuth.address) return respondJson(res, 401, { error: 'Authentication required to download marketplace models' });
    const fileBasename = path.basename(filePath, path.extname(filePath)); // listing id = filename without ext
    const listing = marketplaceListings.get(fileBasename);
    const isSeller = listing && listing.seller === jwtAuth.address;
    const hasPurchased = marketplacePurchases.has(`${jwtAuth.address}:${fileBasename}`);
    if (!isSeller && !hasPurchased) return respondJson(res, 403, { error: 'Purchase required to download this model' });
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.obj': 'text/plain' };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // ═══ Identity Feed ═══
  if (pathname === '/api/feed' && req.method === 'GET') {
    if (!ipRateLimit('feed', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
    respondJson(res, 200, { items: feedItems.slice(0, limit) });
    return;
  }

  // ═══ Enhanced TX Data ═══
  if (pathname === '/api/enhanced-tx' && req.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address) return respondJson(res, 400, { error: 'address required' });
    // Rate limit: 30s per address (cache covers repeats)
    const etxRlKey = `etx:${address}`;
    if (Date.now() - (reputationRateLimit.get(etxRlKey) || 0) < 30_000) {
      // Return cached if available during rate limit window
      const cached = enhancedTxCache.get(address);
      if (cached && Date.now() - cached.ts < 600_000) {
        const { edgeTypesMap, ...safe } = cached.data;
        return respondJson(res, 200, safe);
      }
      return respondJson(res, 429, { error: 'Rate limited. Try again in 30 seconds.' });
    }
    reputationRateLimit.set(etxRlKey, Date.now());
    try {
      const data = await fetchEnhancedTransactions(address, 1000);
      if (!data) return respondJson(res, 200, { swapCount: 0, nftTradeCount: 0, stakingCount: 0, defiProtocols: [], isDeFiUser: false, isDeFiKing: false });
      const { edgeTypesMap, ...safe } = data;
      respondJson(res, 200, safe);
    } catch (e) {
      respondJson(res, 200, { swapCount: 0, nftTradeCount: 0, stakingCount: 0, defiProtocols: [], isDeFiUser: false, isDeFiKing: false, error: e.message });
    }
    return;
  }

  // ═══ Constellation Network ═══
  if (pathname === '/api/constellation' && req.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Valid address required' });
    // Rate limit: 30s per IP (heavy — up to 1000 tx parsing)
    const constIp = getClientIp(req);
    const constIpRlKey = `const:${constIp}`;
    if (Date.now() - (reputationRateLimit.get(constIpRlKey) || 0) < 10_000) {
      const cached = constellationCache.get(address);
      if (cached && Date.now() - cached.ts < 600_000) { return respondJson(res, 200, cached.data); }
      return respondJson(res, 429, { error: 'Rate limited. Try again in 10 seconds.' });
    }
    const cachedConst = constellationCache.get(address);
    if (cachedConst && Date.now() - cachedConst.ts < 600_000) { respondJson(res, 200, cachedConst.data); return; }
    const constRlKey = `constellation:${address}`;
    const lastConst = prismEarnRateLimit.get(constRlKey) || 0;
    if (Date.now() - lastConst < 10_000) {
      const cached = constellationCache.get(address);
      if (cached && Date.now() - cached.ts < 600_000) { return respondJson(res, 200, cached.data); }
      return respondJson(res, 429, { error: 'Constellation data is being fetched, try again in 10s' });
    }
    reputationRateLimit.set(constIpRlKey, Date.now());
    prismEarnRateLimit.set(constRlKey, Date.now());
    try {
      const parsedLimit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10) || 500, 500);
      const [{ parsed }, enhancedResult] = await Promise.all([
        fetchParsedTransactions(address, parsedLimit),
        fetchEnhancedTransactions(address, 1000).catch(() => null),
      ]);
      const { incoming, outgoing, programIds } = extractSolTransfers(parsed, address);
      // Enhanced TX edge type map: signature → exact type classification
      const enhancedEdgeTypes = enhancedResult?.edgeTypesMap || new Map();
      const nodeMap = new Map();
      const centerTier = url.searchParams.get('tier') || null;
      nodeMap.set(address, { id: address, label: address.slice(0, 4) + '...' + address.slice(-4), size: 14, x: 0, y: 0, vx: 0, vy: 0, color: '#22d3ee', isCenter: true, solVolume: 0, txCount: 0, tier: centerTier });
      const allCounterparties = new Map();
      for (const [addr, info] of incoming) {
        // Double-check: skip any remaining program addresses
        if (isProgramAddress(addr, programIds)) continue;
        const existing = allCounterparties.get(addr) || { solIn: 0, solOut: 0, count: 0, firstTime: Infinity, lastTime: 0 };
        existing.solIn += info.totalSol; existing.count += info.count;
        existing.firstTime = Math.min(existing.firstTime, info.firstTime || Date.now());
        existing.lastTime = Math.max(existing.lastTime, info.lastTime || Date.now());
        allCounterparties.set(addr, existing);
      }
      for (const [addr, info] of outgoing) {
        if (isProgramAddress(addr, programIds)) continue;
        const existing = allCounterparties.get(addr) || { solIn: 0, solOut: 0, count: 0, firstTime: Infinity, lastTime: 0 };
        existing.solOut += info.totalSol; existing.count += info.count;
        existing.firstTime = Math.min(existing.firstTime, info.firstTime || Date.now());
        existing.lastTime = Math.max(existing.lastTime, info.lastTime || Date.now());
        allCounterparties.set(addr, existing);
      }
      // Filter out counterparties with negligible activity (< 0.001 SOL total)
      const filtered = [...allCounterparties.entries()].filter(([, info]) => (info.solIn + info.solOut) >= 0.001);
      const sorted = filtered.sort((a, b) => (b[1].solIn + b[1].solOut) - (a[1].solIn + a[1].solOut));
      const TIER_COLORS_MAP = { mercury: '#8B8B8B', mars: '#C1440E', venus: '#E8CDA0', earth: '#4B9CD3', neptune: '#3F54BE', uranus: '#73C2FB', saturn: '#E8D191', jupiter: '#C88B3A', sun: '#FFD700', binary_sun: '#22D3EE' };
      const colorPalette = Object.values(TIER_COLORS_MAP);
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
          solVolume: Math.round(totalVol * 10000) / 10000,
          txCount: info.count,
        });
        // Merge txTypes from both incoming and outgoing maps for this counterparty
        const txTypeSet = new Set();
        const inInfo = incoming.get(addr);
        const outInfo = outgoing.get(addr);
        if (inInfo?.txTypeSet) for (const t of inInfo.txTypeSet) txTypeSet.add(t);
        if (outInfo?.txTypeSet) for (const t of outInfo.txTypeSet) txTypeSet.add(t);
        // Enrich with Helius Enhanced TX classifications (more accurate)
        if (enhancedEdgeTypes.size > 0) {
          if (inInfo?.signatures) for (const sig of inInfo.signatures) { const et = enhancedEdgeTypes.get(sig); if (et && et !== 'transfer') txTypeSet.add(et); }
          if (outInfo?.signatures) for (const sig of outInfo.signatures) { const et = enhancedEdgeTypes.get(sig); if (et && et !== 'transfer') txTypeSet.add(et); }
        }
        const txTypes = txTypeSet.size > 0 ? [...txTypeSet] : ['transfer'];
        edges.push({
          source: address,
          target: addr,
          weight: info.count,
          totalSol: Math.round(totalVol * 10000) / 10000,
          outSol: Math.round((info.solOut || 0) * 10000) / 10000,
          inSol: Math.round((info.solIn || 0) * 10000) / 10000,
          firstTx: info.firstTime !== Infinity ? info.firstTime : null,
          lastTx: info.lastTime > 0 ? info.lastTime : null,
          txTypes,
        });
      }
      const allNodes = [...nodeMap.values()];
      const cappedNodes = allNodes.length > 200 ? allNodes.slice(0, 200) : allNodes;
      const nodeIds = new Set(cappedNodes.map(n => n.id));
      const cappedEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
      const result = { nodes: cappedNodes, edges: cappedEdges };
      constellationCache.set(address, { data: result, ts: Date.now() });
      // Track social stats: constellation explored — credit the VIEWER, not the target
      const viewerAuth = optionalJwt(req, res);
      const viewerAddr = viewerAuth?.address;
      if (viewerAddr && viewerAddr !== address) {
        // Daily limit: 10 constellation explorations per day (self-explore doesn't count)
        const ceKey = `ce_daily:${viewerAddr}`;
        const ceToday = new Date().toISOString().slice(0, 10);
        const ce = prismEarnRateLimit.get(ceKey);
        const ceDayCount = (ce && typeof ce === 'object' && ce.date === ceToday) ? ce.count : 0;
        if (ceDayCount < 10) {
          prismEarnRateLimit.set(ceKey, { date: ceToday, count: ceDayCount + 1 });
          const wViewer = walletDatabase.get(viewerAddr) || {};
          const ssViewer = wViewer.socialStats || { challengesWon: 0, constellationExplored: 0, compareCount: 0 };
          ssViewer.constellationExplored = (ssViewer.constellationExplored || 0) + 1;
          updateWalletEntry(viewerAddr, { socialStats: ssViewer });
          triggerCompositeUpdate(viewerAddr);
        }
      }
      respondJson(res, 200, result);
    } catch (e) {
      respondJson(res, 200, { nodes: [], edges: [], error: 'Failed to compute constellation' });
    }
    return;
  }

  // ═══ Admin: Set coin balance (dev/testing) ═══
  if (pathname === '/api/admin/set-coins' && req.method === 'POST') {
    if (!requireAdminKey(req, res)) return;
    try {
      const { address, coins } = JSON.parse(await readBody(req));
      if (!address || typeof coins !== 'number') return respondJson(res, 400, { error: 'address and coins (number) required' });
      setCoinBalance(address, coins);
      respondJson(res, 200, { ok: true, address, balance: getCoinBalance(address) });
    } catch (e) { respondJson(res, 400, { error: e.message }); }
    return;
  }

  // ═══ Admin: Set full wallet profile (dev/testing) ═══
  if (pathname === '/api/admin/set-wallet' && req.method === 'POST') {
    if (!requireAdminKey(req, res)) return;
    try {
      const { address, data } = JSON.parse(await readBody(req));
      if (!address || !data || typeof data !== 'object') return respondJson(res, 400, { error: 'address and data (object) required' });
      updateWalletEntry(address, data);
      if (typeof data.coins === 'number') setCoinBalance(address, data.coins);
      respondJson(res, 200, { ok: true, address, updatedFields: Object.keys(data) });
    } catch (e) { respondJson(res, 400, { error: e.message }); }
    return;
  }

  // ═══ Wallet Database API ═══
  if (pathname === '/api/wallet-database/stats' && req.method === 'GET') {
    if (!requireAdminKey(req, res)) return;
    let totalMinted = 0;
    let totalScore = 0;
    let scoreCount = 0;
    const tierDist = {};
    const sybilDist = { clean: 0, low: 0, medium: 0, high: 0, critical: 0 };
    let totalSybilRisk = 0;
    let sybilCount = 0;
    for (const w of walletDatabase.values()) {
      if (w.mint?.minted) totalMinted++;
      if (typeof w.score === 'number') { totalScore += w.score; scoreCount++; }
      if (w.tier) tierDist[w.tier] = (tierDist[w.tier] || 0) + 1;
      if (w.sybil?.riskLevel) {
        sybilDist[w.sybil.riskLevel] = (sybilDist[w.sybil.riskLevel] || 0) + 1;
        totalSybilRisk += w.sybil.riskScore || 0;
        sybilCount++;
      }
    }
    respondJson(res, 200, {
      totalWallets: walletDatabase.size,
      totalMinted,
      avgScore: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
      tierDistribution: tierDist,
      sybilDistribution: sybilDist,
      avgSybilRisk: sybilCount > 0 ? Math.round(totalSybilRisk / sybilCount) : 0,
    });
    return;
  }

  if (pathname === '/api/wallet-database/export' && req.method === 'GET') {
    if (!requireAdminKey(req, res)) return;
    const obj = {};
    for (const [k, v] of walletDatabase) obj[k] = v;
    respondJson(res, 200, {
      version: 1,
      exportedAt: new Date().toISOString(),
      totalWallets: walletDatabase.size,
      wallets: obj,
    });
    return;
  }

  // ── User Data Sync (loadout, game stats, text quests, XP) ──
  // Stores per-wallet JSON blobs in walletDatabase so data survives browser clears.
  // All fields are stored under wallet.userData = { loadout, gameStats, textQuests, ... }

  if (pathname === '/api/user-data' && req.method === 'GET') {
    if (!ipRateLimit('user_data_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const address = jwtAuth.address;
    const walletEntry = walletDatabase.get(address) || { address };
    const { forgeState, changed: forgeStateChanged } = getOrCreateForgeState(address, walletEntry);
    const existingUserData = getWalletUserData(walletEntry);
    const sanitizedLoadout = sanitizeForgeLoadout(address, existingUserData.loadout, forgeState);
    const userData = {
      ...existingUserData,
      loadout: sanitizedLoadout,
    };
    if (forgeStateChanged || JSON.stringify(existingUserData.loadout || null) !== JSON.stringify(sanitizedLoadout)) {
      updateWalletEntry(address, { forgeState, userData });
    }
    respondJson(res, 200, { address, userData });
    return;
  }

  if (pathname === '/api/user-data' && req.method === 'POST') {
    if (!ipRateLimit('user_data_post', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return;
    const address = jwtAuth.address;
    const rawBody = await readBody(req);
    if (!rawBody) return respondJson(res, 400, { error: 'Missing body' });
    if (rawBody.length > 512 * 1024) return respondJson(res, 413, { error: 'Payload too large (max 512KB)' });
    let body;
    try { body = JSON.parse(rawBody); } catch { return respondJson(res, 400, { error: 'Invalid JSON' }); }
    if (!body || typeof body !== 'object') return respondJson(res, 400, { error: 'Body must be a JSON object' });

    // Merge incoming fields into existing userData (don't overwrite unrelated fields)
    const walletEntry = walletDatabase.get(address) || { address };
    const { forgeState, changed: forgeStateChanged } = getOrCreateForgeState(address, walletEntry);
    const existing = getWalletUserData(walletEntry);
    const ALLOWED_KEYS = ['loadout', 'gameStats', 'bestScores', 'textQuests', 'rangerXP', 'achievements'];
    const updates = {};
    for (const key of ALLOWED_KEYS) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    const merged = {
      ...existing,
      ...updates,
      loadout: sanitizeForgeLoadout(address, updates.loadout ?? existing.loadout, forgeState),
      lastSyncAt: new Date().toISOString(),
    };
    updateWalletEntry(address, {
      userData: merged,
      ...(forgeStateChanged ? { forgeState } : {}),
    });
    respondJson(res, 200, { ok: true, address, userData: merged });
    return;
  }

  if (pathname === '/api/wallet-database' && req.method === 'GET') {
    if (!ipRateLimit('wallet_db', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const address = url.searchParams.get('address');
    if (address) {
      const w = walletDatabase.get(address);
      if (!w) return respondJson(res, 404, { error: 'Wallet not found' });
      // Public view: only expose safe fields (strip sybil details, internal stats, sensitive data)
      const publicData = {
        address,
        tier: w.tier || 'mercury',
        score: w.score || 0,
        badges: w.badges || [],
        composite: w.composite ? { compositeScore: w.composite.compositeScore, compositeTier: w.composite.compositeTier, breakdown: w.composite.breakdown, details: w.composite.details || null } : null,
        scoreBreakdown: w.scoreBreakdown || null,
        scoreDetails: w.composite?.details || null,
        joinedAt: w.joinedAt || null,
        lastSeenAt: w.lastSeenAt || null,
        tournamentXP: w.tournamentXP || 0,
      };
      respondJson(res, 200, publicData);
      return;
    }
    // Paginated list requires admin key
    if (!requireAdminKey(req, res)) return;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 500);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
    const sort = url.searchParams.get('sort') || 'lastSeenAt';
    const entries = [...walletDatabase.values()];
    entries.sort((a, b) => {
      if (sort === 'score') return (b.score || 0) - (a.score || 0);
      if (sort === 'scanCount') return (b.scanCount || 0) - (a.scanCount || 0);
      if (sort === 'coins') return (b.coins || 0) - (a.coins || 0);
      // default: lastSeenAt descending
      return (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '');
    });
    const page = entries.slice(offset, offset + limit);
    respondJson(res, 200, { total: entries.length, limit, offset, wallets: page });
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
    let rpcParsed = null;
    try { rpcParsed = JSON.parse(rpcBody); rpcMethod = rpcParsed?.method ?? ''; } catch {}

    // Block expensive methods without filters to prevent API credit drain
    if (rpcMethod === 'getProgramAccounts') {
      const filters = rpcParsed?.params?.[1]?.filters;
      if (!Array.isArray(filters) || filters.length === 0) {
        return respondJson(res, 400, { error: 'getProgramAccounts requires filters' });
      }
    }

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
// Stores relationships between wallets for cross-session intelligence
// Format: { nodes: { address: { riskScore, trustGrade, fundedBy, fundedWallets, lastSeen } }, edges: [...] }
const SYBIL_GRAPH_FILE = path.join(process.cwd(), 'sybil_graph.json');
const sybilGraph = { nodes: {}, flaggedClusters: [] };
try {
  if (fs.existsSync(SYBIL_GRAPH_FILE)) {
    const raw = JSON.parse(fs.readFileSync(SYBIL_GRAPH_FILE, 'utf8'));
    if (raw.nodes) Object.assign(sybilGraph.nodes, raw.nodes);
    if (raw.flaggedClusters) sybilGraph.flaggedClusters = raw.flaggedClusters;
    console.log(`[sybil-graph] Loaded ${Object.keys(sybilGraph.nodes).length} nodes, ${sybilGraph.flaggedClusters.length} clusters`);
  }
} catch (e) { console.warn('[sybil-graph] Failed to load:', e.message); }

const MAX_SYBIL_GRAPH_NODES = 10_000;

function pruneSybilGraph() {
  const nodeAddrs = Object.keys(sybilGraph.nodes);
  if (nodeAddrs.length > MAX_SYBIL_GRAPH_NODES) {
    const sorted = nodeAddrs.sort((a, b) => (sybilGraph.nodes[a].lastSeen || 0) - (sybilGraph.nodes[b].lastSeen || 0));
    const toRemove = sorted.slice(0, nodeAddrs.length - MAX_SYBIL_GRAPH_NODES);
    for (const addr of toRemove) delete sybilGraph.nodes[addr];
  }
  // Prune clusters by TTL (90 days) then by count (max 1000)
  const clusterTtl = 90 * 24 * 3600_000;
  const nowPrune = Date.now();
  sybilGraph.flaggedClusters = sybilGraph.flaggedClusters.filter(c =>
    c.lastSeen && (nowPrune - c.lastSeen) < clusterTtl
  );
  if (sybilGraph.flaggedClusters.length > 1000) {
    sybilGraph.flaggedClusters = sybilGraph.flaggedClusters.slice(-1000);
  }
}

async function saveSybilGraph() {
  pruneSybilGraph();
  try {
    const tmp = SYBIL_GRAPH_FILE + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(sybilGraph), 'utf8');
    await fs.promises.rename(tmp, SYBIL_GRAPH_FILE);
  } catch (e) { console.warn('[sybil-graph] Save failed:', e.message); }
}

function updateSybilGraphNode(address, data) {
  const existing = sybilGraph.nodes[address] || {};
  sybilGraph.nodes[address] = {
    ...existing,
    ...data,
    lastSeen: Date.now(),
  };
}

const GRAPH_NODE_TTL_MS = 90 * 24 * 3600_000; // 90 days
function checkGraphForKnownSybils(address, fundingSources, siblings) {
  let graphRisk = 0;
  let graphDetails = [];
  const now = Date.now();
  // Check if any funding source is a known sybil (with TTL)
  for (const funder of fundingSources) {
    const node = sybilGraph.nodes[funder];
    if (node && node.riskScore >= 50 && (now - (node.lastSeen || 0)) < GRAPH_NODE_TTL_MS) {
      graphRisk += 15;
      graphDetails.push(`Funded by flagged wallet ${funder.slice(0, 8)}... (risk ${node.riskScore})`);
    }
  }
  // Check if siblings are known sybils (with TTL)
  let flaggedSiblings = 0;
  for (const sib of siblings) {
    const node = sybilGraph.nodes[sib];
    if (node && node.riskScore >= 50 && (now - (node.lastSeen || 0)) < GRAPH_NODE_TTL_MS) flaggedSiblings++;
  }
  if (flaggedSiblings >= 2) {
    graphRisk += 10;
    graphDetails.push(`${flaggedSiblings} sibling wallets previously flagged as sybil`);
  }
  // Check if address is part of a known flagged cluster
  for (const cluster of sybilGraph.flaggedClusters) {
    if (cluster.members.includes(address)) {
      graphRisk += 20;
      graphDetails.push(`Part of flagged cluster "${cluster.label}" (${cluster.members.length} members)`);
      break;
    }
  }
  return { graphRisk: Math.min(40, graphRisk), graphDetails };
}

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

// PRISM earn rate-limit: per-source cooldowns
const prismEarnRateLimit = new Map(); // key: `${address}:${source}` → timestamp

// ── Quiz System: Blockchain Trivia ──
const quizAnswers = new Map(); // qId → { correct, expiresAt }
// Cleanup expired quiz answers every 5 minutes
setInterval(() => { const now = Date.now(); for (const [k, v] of quizAnswers) { if (now > v.expiresAt) quizAnswers.delete(k); } }, 300_000);

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
  referral: 60 * 60_000,               // 1 per hour
  achievement: 5 * 60_000,
};
// Global daily cap for non-game earn sources (prevents coin inflation exploits)
const NON_GAME_DAILY_EARN_CAP = 1500;
// Sub-caps per activity type (within the global cap)
const DAILY_HUNT_CAP = 500;    // max 500 coins/day from sybil hunts
const DAILY_SCAN_CAP = 100;    // max 100 coins/day from clean scans
const DAILY_QUIZ_CAP = 500;    // max 500 coins/day from quiz (100 answers × 5)
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

// Treasury / project wallets — excluded from sybil detection entirely
const TREASURY_WALLETS = new Set([
  '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN', // Identity Prism treasury
]);

// Known CEX/Bridge/DEX addresses for labeling
const KNOWN_LABELS = {
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': { label: 'Binance', type: 'cex' },
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': { label: 'Binance Hot', type: 'cex' },
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': { label: 'Binance', type: 'cex' },
  'H8sMJSCQxfKbeSTMe3fPaFKBMq3pS3bhVwn9dSjYqYLn': { label: 'Coinbase', type: 'cex' },
  'GJRs4FwHtemZ5ZE9Q3MNTDzoH7VDrKEswLzVRSJNDRLZ': { label: 'Coinbase', type: 'cex' },
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': { label: 'Kraken', type: 'cex' },
  '6FEVkH18iu1gKLksoKHiYq4VJFL6Lr2VkqhqRMp4VEto': { label: 'OKX', type: 'cex' },
  'ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ': { label: 'Bybit', type: 'cex' },
  'BmFdpraQhkiDQE6SnfG5PVb197fsGoiASaQUq8JEE6sB': { label: 'KuCoin', type: 'cex' },
  '88o1cLRMEDpbz1HZk8c5Ti6Rjs1yFhbqWrv5WmY5jdKm': { label: 'Gate.io', type: 'cex' },
  'HE1u8snzF1fPqtYVHSUGMsbiYFCYfXMVLJJDgGACrJHR': { label: 'Huobi', type: 'cex' },
  'BtQM6yeaU6B89RhMqYGasEJXEEXLjvwBpsHHRVxv9boW': { label: 'Bitget', type: 'cex' },
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': { label: 'Jupiter', type: 'dex' },
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': { label: 'Raydium', type: 'dex' },
  'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb': { label: 'Wormhole', type: 'bridge' },
  'So1endDq2YkqhipRh3WViPa8hFvz0XP1MXF1VZU8Q4Mw': { label: 'Solend', type: 'dex' },
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': { label: 'Orca', type: 'dex' },
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

const ENHANCED_TX_TYPES = {
  defi: new Set(['SWAP', 'ADD_LIQUIDITY', 'REMOVE_LIQUIDITY', 'REMOVE_FROM_POOL', 'CREATE_POOL', 'CLOSE_POSITION', 'OPEN_POSITION', 'BORROW_FOX', 'LEND_FOX', 'DEPOSIT', 'WITHDRAW']),
  nft: new Set(['NFT_SALE', 'NFT_BID', 'NFT_LISTING', 'NFT_MINT', 'NFT_CANCEL_LISTING', 'NFT_BID_CANCELLED', 'NFT_GLOBAL_BID', 'NFT_AUCTION_CREATED', 'NFT_AUCTION_UPDATED', 'NFT_AUCTION_CANCELLED', 'NFT_PARTICIPATION_REWARD', 'NFT_MINT_REJECTED', 'BURN_NFT', 'TRANSFER']),
  staking: new Set(['STAKE_SOL', 'UNSTAKE_SOL', 'STAKE_TOKEN', 'UNSTAKE_TOKEN', 'INIT_STAKE', 'MERGE_STAKE', 'SPLIT_STAKE']),
};

function classifyEnhancedTxType(type) {
  if (ENHANCED_TX_TYPES.defi.has(type)) return 'defi';
  if (ENHANCED_TX_TYPES.nft.has(type)) return 'nft';
  if (ENHANCED_TX_TYPES.staking.has(type)) return 'staking';
  return 'transfer';
}

function parseEnhancedTransactions(txs, address) {
  let swapCount = 0;
  let nftTradeCount = 0;
  let stakingCount = 0;
  const defiProtocols = new Set();
  const edgeTypesMap = new Map(); // signature → 'defi'|'nft'|'staking'|'transfer'

  for (const tx of txs) {
    if (!tx || !tx.type) continue;
    const txType = tx.type;
    const classified = classifyEnhancedTxType(txType);
    if (tx.signature) edgeTypesMap.set(tx.signature, classified);

    if (classified === 'defi') {
      swapCount += 1;
      if (tx.source) defiProtocols.add(tx.source.toUpperCase());
    } else if (classified === 'nft') {
      nftTradeCount += 1;
    } else if (classified === 'staking') {
      stakingCount += 1;
    }
  }

  const protocolList = [...defiProtocols];
  const isDeFiUser = swapCount >= 1;
  const isDeFiKing = swapCount >= 5 || protocolList.length >= 2;

  return { swapCount, nftTradeCount, stakingCount, defiProtocols: protocolList, isDeFiUser, isDeFiKing, edgeTypesMap };
}

async function fetchEnhancedTransactions(address, limit = 1000) {
  // Check cache first
  const cached = enhancedTxCache.get(address);
  if (cached && Date.now() - cached.ts < 600_000) return cached.data;

  const key = pickHeliusKey(address);
  if (!key) return null;

  const allTxs = [];
  const pageSize = 100; // Helius returns up to 100 per page
  const maxPages = Math.ceil(limit / pageSize);
  let lastSignature = undefined;

  for (let page = 0; page < maxPages; page++) {
    try {
      let url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${key}&limit=${pageSize}`;
      if (lastSignature) url += `&before=${lastSignature}`;

      const resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!resp.ok) break;
      const txs = await resp.json();
      if (!Array.isArray(txs) || txs.length === 0) break;

      allTxs.push(...txs);
      lastSignature = txs[txs.length - 1]?.signature;
      if (!lastSignature || txs.length < pageSize) break;
    } catch {
      break; // partial data is fine
    }
  }

  if (allTxs.length === 0) return null;

  const result = parseEnhancedTransactions(allTxs, address);

  // Cache with size cap
  if (enhancedTxCache.size >= 200) {
    const oldest = enhancedTxCache.keys().next().value;
    enhancedTxCache.delete(oldest);
  }
  enhancedTxCache.set(address, { data: result, ts: Date.now() });

  return result;
}

// Well-known Solana program addresses to filter out of wallet-to-wallet connections
const PROGRAM_ADDRESSES = new Set([
  '11111111111111111111111111111111',                   // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',      // Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',      // Token 2022
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',     // Associated Token Account
  'ComputeBudget111111111111111111111111111111',        // Compute Budget
  'Vote111111111111111111111111111111111111111',         // Vote Program
  'Stake11111111111111111111111111111111111111',         // Stake Program
  'Config1111111111111111111111111111111111111',         // Config Program
  'BPFLoader2111111111111111111111111111111111',         // BPF Loader
  'BPFLoaderUpgradeab1e11111111111111111111111',        // BPF Loader Upgradeable
  'NativeLoader1111111111111111111111111111111',         // Native Loader
  'Sysvar1111111111111111111111111111111111111',         // Sysvar (prefix match below too)
  'SysvarRent111111111111111111111111111111111',         // Sysvar Rent
  'SysvarC1ock11111111111111111111111111111111',         // Sysvar Clock
  'SysvarS1otHashes111111111111111111111111111',         // Sysvar Slot Hashes
  'SysvarStakeHistory1111111111111111111111111',         // Sysvar Stake History
  'SysvarRecentB1telephones11111111111111111111',        // Sysvar Recent Blockhashes
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',     // Memo Program v2
  'Memo1UhkJBfCR6MNB7C3EUkApJBswJaqzS6vQRHJph4',      // Memo Program v1
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',      // Metaplex Token Metadata
  'auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg',      // Metaplex Auth Rules
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',      // Jupiter v6
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcPX7H',      // Jupiter v4
  'JUP3jqKEFnJHTnQ9pP1bTJjrm3W9RWoWTxJoQGMGifDN',    // Jupiter v3
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',    // Raydium AMM v4
  '27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv',     // Raydium AMM authority
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',     // Raydium CLMM
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',      // Orca Whirlpool
  'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',      // Wormhole
  'So1endDq2YkqhipRh3WViPa8hFvz0XP1MXF1VZU8Q4Mw',    // Solend
  'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',      // Marinade Finance
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',      // Marinade State
  'mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68',      // Mango v4
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY',      // Phoenix DEX
  'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1',    // Orca legacy
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',      // Serum/OpenBook
  'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy',      // Stake Pool Program
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',      // Meteora DLMM
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',    // Phantom fee wallet
]);

// Check if an address looks like a program (static set + dynamic per-tx programIds)
function isProgramAddress(addr, txProgramIds) {
  if (PROGRAM_ADDRESSES.has(addr)) return true;
  if (txProgramIds && txProgramIds.has(addr)) return true;
  // Sysvar addresses all start with 'Sysvar'
  if (addr.startsWith('Sysvar')) return true;
  return false;
}

// ── Transaction type classification by program IDs ──
const TX_TYPE_PROGRAMS = {
  defi: new Set([
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter v6
    'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcPX7H',  // Jupiter v4
    'JUP3jqKEFnJHTnQ9pP1bTJjrm3W9RWoWTxJoQGMGifDN', // Jupiter v3
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
    'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1', // Orca legacy
    'So1endDq2YkqhipRh3WViPa8hFvz0XP1MXF1VZU8Q4Mw', // Solend
    'mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68',  // Mango v4
    'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY',  // Phoenix DEX
    'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',  // Serum/OpenBook
    'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
    'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',  // Marinade Finance (DeFi)
    'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',  // Wormhole
  ]),
  nft: new Set([
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',  // Metaplex Token Metadata
    'auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg',  // Metaplex Auth Rules
    'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN',  // Tensor Swap
    'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K',  // Magic Eden v2
    'hausS13jsjafwWwGqZTUQRmWyvyxn9EQpqMwV1PBBmk',  // Metaplex Auction House
    'CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz', // Solanart
  ]),
  staking: new Set([
    'Stake11111111111111111111111111111111111111',      // Native Stake
    'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy',  // Stake Pool Program
    'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',  // Marinade State (staking)
  ]),
};

function classifyTxType(txProgramIdSet) {
  const types = new Set();
  for (const pid of txProgramIdSet) {
    if (TX_TYPE_PROGRAMS.defi.has(pid)) types.add('defi');
    if (TX_TYPE_PROGRAMS.nft.has(pid)) types.add('nft');
    if (TX_TYPE_PROGRAMS.staking.has(pid)) types.add('staking');
  }
  if (types.size === 0) types.add('transfer');
  return [...types];
}

// Extract SOL transfers from parsed transactions — wallet-to-wallet only
// Helper: extract address string from accountKey (works with both batch JSON-RPC and @solana/web3.js)
function resolveAccountKey(accKey) {
  if (typeof accKey === 'string') return accKey;
  if (!accKey) return '';
  // @solana/web3.js returns PublicKey objects with .toBase58()
  if (accKey.pubkey?.toBase58) return accKey.pubkey.toBase58();
  // Raw JSON-RPC returns { pubkey: "string", signer: bool, ... }
  if (typeof accKey.pubkey === 'string') return accKey.pubkey;
  return '';
}

function extractSolTransfers(parsed, targetAddress) {
  const incoming = new Map();
  const outgoing = new Map();
  const programIds = new Set();

  for (const tx of parsed) {
    if (!tx?.meta || !tx?.transaction) continue;
    if (tx.meta.err) continue;
    const blockTime = tx.blockTime ? tx.blockTime * 1000 : Date.now();

    const txProgramIds = new Set();
    const ixs = tx.transaction.message?.instructions || [];
    for (const ix of ixs) {
      if (ix.programId) {
        const pid = typeof ix.programId === 'string' ? ix.programId : (ix.programId?.toBase58?.() || ix.programId?.toString?.() || '');
        if (pid) { txProgramIds.add(pid); programIds.add(pid); }
      }
    }
    const innerIxs = tx.meta.innerInstructions || [];
    for (const inner of innerIxs) {
      for (const iix of (inner.instructions || [])) {
        if (iix.programId) {
          const pid = typeof iix.programId === 'string' ? iix.programId : (iix.programId?.toBase58?.() || iix.programId?.toString?.() || '');
          if (pid) { txProgramIds.add(pid); programIds.add(pid); }
        }
      }
    }

    const accounts = tx.transaction.message?.accountKeys || [];
    const pre = tx.meta.preBalances || [];
    const post = tx.meta.postBalances || [];

    const signerAddresses = new Set();
    for (const acc of accounts) {
      if (typeof acc === 'object' && acc?.signer) {
        const addr = resolveAccountKey(acc);
        if (addr) signerAddresses.add(addr);
      }
    }

    let targetIdx = -1;
    let targetDiff = 0;
    for (let i = 0; i < accounts.length; i++) {
      const acc = resolveAccountKey(accounts[i]);
      if (acc === targetAddress) {
        targetIdx = i;
        targetDiff = ((post[i] || 0) - (pre[i] || 0)) / 1e9;
        break;
      }
    }
    if (targetIdx === -1) continue;

    // ── SOL Transfer Detection ──
    // Threshold 0.0003 SOL — catches micro-transfers but ignores pure fee dust
    if (Math.abs(targetDiff) >= 0.0003) {
      const candidates = [];
      for (let j = 0; j < accounts.length; j++) {
        if (j === targetIdx) continue;
        const acc = resolveAccountKey(accounts[j]);
        if (!acc) continue;
        const diff = ((post[j] || 0) - (pre[j] || 0)) / 1e9;
        const isSigner = typeof accounts[j] === 'object' ? !!accounts[j]?.signer : signerAddresses.has(acc);
        candidates.push({ addr: acc, diff, isSigner, isProgram: isProgramAddress(acc, txProgramIds) });
      }

      if (targetDiff > 0.0003) {
        const senders = candidates
          .filter(c => c.diff < -0.0003 && !c.isProgram)
          .sort((a, b) => {
            if (a.isSigner && !b.isSigner) return -1;
            if (!a.isSigner && b.isSigner) return 1;
            return a.diff - b.diff;
          });
        const sender = senders[0];
        if (sender && !TREASURY_WALLETS.has(sender.addr)) {
          const existing = incoming.get(sender.addr) || { totalSol: 0, count: 0, firstTime: blockTime, lastTime: blockTime, txTypeSet: new Set(), signatures: [] };
          existing.totalSol += Math.abs(targetDiff);
          existing.count += 1;
          existing.firstTime = Math.min(existing.firstTime, blockTime);
          existing.lastTime = Math.max(existing.lastTime, blockTime);
          for (const t of classifyTxType(txProgramIds)) existing.txTypeSet.add(t);
          const sig = tx.transaction.signatures?.[0];
          if (sig) existing.signatures.push(sig);
          incoming.set(sender.addr, existing);
        }
      } else if (targetDiff < -0.0003) {
        const receivers = candidates
          .filter(c => c.diff > 0.0003 && !c.isProgram)
          .sort((a, b) => {
            if (a.isSigner && !b.isSigner) return -1;
            if (!a.isSigner && b.isSigner) return 1;
            return b.diff - a.diff;
          });
        const receiver = receivers[0];
        if (receiver && !TREASURY_WALLETS.has(receiver.addr)) {
          const existing = outgoing.get(receiver.addr) || { totalSol: 0, count: 0, firstTime: blockTime, lastTime: blockTime, txTypeSet: new Set(), signatures: [] };
          existing.totalSol += Math.abs(receiver.diff);
          existing.count += 1;
          existing.firstTime = Math.min(existing.firstTime, blockTime);
          existing.lastTime = Math.max(existing.lastTime, blockTime);
          for (const t of classifyTxType(txProgramIds)) existing.txTypeSet.add(t);
          const sig = tx.transaction.signatures?.[0];
          if (sig) existing.signatures.push(sig);
          outgoing.set(receiver.addr, existing);
        }
      }
    }

    // ── SPL Token Transfer Detection ──
    // Runs ALWAYS (not gated by SOL diff) — catches funding via USDC, tokens, etc.
    const preTok = tx.meta.preTokenBalances || [];
    const postTok = tx.meta.postTokenBalances || [];
    if (preTok.length > 0 || postTok.length > 0) {
      const preMap = new Map();
      for (const tb of preTok) {
        if (tb.owner) preMap.set(`${tb.owner}:${tb.mint}`, tb.uiTokenAmount?.uiAmount || 0);
      }
      const postMap = new Map();
      for (const tb of postTok) {
        if (tb.owner) postMap.set(`${tb.owner}:${tb.mint}`, tb.uiTokenAmount?.uiAmount || 0);
      }
      // Check if target gained tokens
      let targetGainedToken = false;
      for (const [key, postAmt] of postMap) {
        if (!key.startsWith(targetAddress + ':')) continue;
        const preAmt = preMap.get(key) || 0;
        if (postAmt > preAmt + 0.001) { targetGainedToken = true; break; }
      }
      // If target gained tokens and SOL diff was negligible (fee-only), record token sender as funder
      if (targetGainedToken && Math.abs(targetDiff) < 0.01) {
        for (const [key, preAmt] of preMap) {
          const [owner] = key.split(':');
          if (owner === targetAddress) continue;
          const postAmt = postMap.get(key) || 0;
          if (preAmt > postAmt + 0.001 && !isProgramAddress(owner, txProgramIds)) {
            const tokenSolProxy = 0.05; // proxy value per token tx (better weight than 0.01)
            const existing = incoming.get(owner) || { totalSol: 0, count: 0, firstTime: blockTime, lastTime: blockTime, txTypeSet: new Set(), signatures: [] };
            existing.totalSol += tokenSolProxy;
            existing.count += 1;
            existing.firstTime = Math.min(existing.firstTime, blockTime);
            existing.lastTime = Math.max(existing.lastTime, blockTime);
            existing.txTypeSet.add('token_transfer');
            const sig = tx.transaction.signatures?.[0];
            if (sig) existing.signatures.push(sig);
            incoming.set(owner, existing);
            break;
          }
        }
      }
    }
  }
  return { incoming, outgoing, programIds };
}

const clusterCache = new Map();
const reputationV2RateLimit = new Map();

// ═══ 2% Burn Fee Helper ═══
let totalBurned = globalThis._totalBurned || 0;
function applyBurnFee(amount) {
  const burned = Math.max(1, Math.floor(amount * 0.02));
  totalBurned += burned;
  globalThis._totalBurned = totalBurned;
  return { net: amount - burned, burned };
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
const STAKING_TIERS = {
  bronze: { minStake: 10000, lockDays: 7, rateMultiplier: 0.75, boostRate: 0.05 },
  silver: { minStake: 30000, lockDays: 30, rateMultiplier: 1.0, boostRate: 0.10 },
  gold:   { minStake: 75000, lockDays: 90, rateMultiplier: 1.25, boostRate: 0.15 },
};

const LOCK_TIERS = [
  { days: 7,   label: '1 Week',    yieldMultiplier: 1.0, earlyPenalty: 0.10 },
  { days: 30,  label: '1 Month',   yieldMultiplier: 1.5, earlyPenalty: 0.15 },
  { days: 90,  label: '3 Months',  yieldMultiplier: 2.5, earlyPenalty: 0.20 },
  { days: 180, label: '6 Months',  yieldMultiplier: 4.0, earlyPenalty: 0.25 },
];
function getLockTier(lockDays) {
  // Find exact match or nearest valid tier
  const exact = LOCK_TIERS.find(t => t.days === lockDays);
  if (exact) return exact;
  // Fallback: pick tier with closest days
  return LOCK_TIERS.reduce((prev, curr) =>
    Math.abs(curr.days - lockDays) < Math.abs(prev.days - lockDays) ? curr : prev
  );
}

const YIELD_BRACKETS = [
  { upTo: 5000,     baseDailyRate: 0.0050 }, // 0.5%
  { upTo: 20000,    baseDailyRate: 0.0035 }, // 0.35%
  { upTo: 50000,    baseDailyRate: 0.0020 }, // 0.2%
  { upTo: 100000,   baseDailyRate: 0.0012 }, // 0.12%
  { upTo: Infinity, baseDailyRate: 0.0008 }, // 0.08%
];

// Stakes created before this timestamp use old flat rate; after use brackets
// All stakes use bracket system by default (fallback 0 = epoch start = all stakes are "new")
const BRACKETS_DEPLOY_TS = parseInt(process.env.BRACKETS_DEPLOY_TS || '0', 10) || 0;

function calcDailyYieldForAmount(amount, tierMultiplier) {
  let remaining = amount;
  let dailyYield = 0;
  let prevUpTo = 0;
  for (const bracket of YIELD_BRACKETS) {
    const sliceMax = bracket.upTo - prevUpTo;
    const slice = Math.min(remaining, sliceMax);
    if (slice <= 0) break;
    dailyYield += slice * bracket.baseDailyRate * tierMultiplier;
    remaining -= slice;
    prevUpTo = bracket.upTo;
  }
  return dailyYield;
}

function getEffectiveRate(amount, tierMultiplier) {
  if (amount <= 0) return 0;
  return calcDailyYieldForAmount(amount, tierMultiplier) / amount;
}

function getRateSchedule(tierMultiplier) {
  return YIELD_BRACKETS.map(b => ({
    upTo: b.upTo === Infinity ? null : b.upTo,
    rate: +(b.baseDailyRate * tierMultiplier * 100).toFixed(3),
  }));
}

function getStakingBoost(address) {
  const w = walletDatabase.get(address);
  const stake = w?.staking;
  if (!stake || !stake.tier) return 0;
  return STAKING_TIERS[stake.tier]?.boostRate || 0;
}
function calcUnclaimedYield(stake) {
  if (!stake || !stake.startTime) return 0;
  const now = Date.now();
  const lastClaim = stake.lastClaimTime || stake.startTime;
  const daysSinceClaim = Math.min(90, Math.max(0, (now - lastClaim) / (1000 * 60 * 60 * 24)));
  const tier = STAKING_TIERS[stake.tier];
  if (!tier) return 0;
  // Old stakes (before bracket deploy) use legacy flat rate for backward compat
  if (stake.startTime < BRACKETS_DEPLOY_TS) {
    // Legacy rates
    const legacyRates = { bronze: 0.00375, silver: 0.005, gold: 0.00625 };
    const legacyRate = legacyRates[stake.tier] || 0.00375;
    return Math.floor(daysSinceClaim * legacyRate * stake.amount);
  }
  // New bracket-based yield — apply lock duration yieldMultiplier if present
  const lockMult = stake.yieldMultiplier != null ? stake.yieldMultiplier : 1.0;
  const dailyYield = calcDailyYieldForAmount(stake.amount, tier.rateMultiplier * lockMult);
  return Math.floor(daysSinceClaim * dailyYield);
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

// Load persisted tournaments
try {
  if (fs.existsSync(TOURNAMENT_FILE)) {
    const raw = JSON.parse(fs.readFileSync(TOURNAMENT_FILE, 'utf8'));
    if (raw.active) {
      for (const tier of Object.keys(TOURNAMENT_TIERS)) {
        if (raw.active[tier]) activeTournaments[tier] = raw.active[tier];
      }
    }
    // Backward compat: old single-tournament format
    if (raw.active && raw.active.id && !raw.active.daily) {
      activeTournaments.daily = raw.active;
      activeTournaments.daily.tier = 'daily';
    }
    if (Array.isArray(raw.history)) tournamentHistory.push(...raw.history.slice(0, 50));
    if (typeof raw.modeIndex === 'number') tournamentModeIndex = raw.modeIndex;
    console.log(`[tournament] Loaded from disk, active=${Object.keys(activeTournaments).filter(k => activeTournaments[k]).join(',')}, history=${tournamentHistory.length}`);
  }
} catch (e) { console.warn('[tournament] Load error:', e.message); }

function saveTournament() {
  const tmp = TOURNAMENT_FILE + '.tmp';
  const data = JSON.stringify({ active: activeTournaments, history: tournamentHistory.slice(0, 50), modeIndex: tournamentModeIndex });
  fs.promises.writeFile(tmp, data, 'utf8')
    .then(() => fs.promises.rename(tmp, TOURNAMENT_FILE))
    .catch(e => console.warn('[tournament] save error', e.message));
}

function getTournamentBasePrizes(tier, participantCount = 0) {
  const basePrizes = TOURNAMENT_BASE_PRIZES[tier] || [];
  const scaling = TOURNAMENT_BASE_PRIZE_SCALING[tier] || { targetParticipants: basePrizes.length || 1, minScale: 0.25 };
  const joined = Math.max(0, Math.floor(Number(participantCount) || 0));
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
    // Pool share: 1st gets remainder to avoid rounding loss
    const poolPrize = i === 0
      ? pool - shares.slice(1, maxWinners).reduce((acc, s) => acc + Math.floor(pool * s), 0)
      : Math.floor(pool * shares[i]);
    // Base prize from platform (per place)
    const basePrize = basePrizes[i] || 0;
    const totalPrize = poolPrize + basePrize;
    if (totalPrize > 0) {
      const cur = getCoinBalance(sorted[i].address);
      setCoinBalance(sorted[i].address, cur + totalPrize);
      addCoinEarned(sorted[i].address, totalPrize);
      totalPaid += poolPrize; // only track pool portion for burn calc
    }
    // Award XP for placement
    const xpRewards = TOURNAMENT_XP_REWARDS[tier] || [];
    const xpAmount = xpRewards[i] || 0;
    if (xpAmount > 0) {
      const wEntry = walletDatabase.get(sorted[i].address);
      if (wEntry) {
        wEntry.tournamentXP = (wEntry.tournamentXP || 0) + xpAmount;
        walletDatabase.set(sorted[i].address, wEntry);
      }
    }
    winners.push({ address: sorted[i].address, score: sorted[i].score, prize: totalPrize, poolPrize, basePrize, place: i + 1, xp: xpAmount });
    if (totalPrize > 0) {
      pushNotification(sorted[i].address, 'tournament_result', `${tier} tournament ended — #${i + 1}, +${totalPrize} coins`, { tier, placement: i + 1, prize: totalPrize });
    }
  }
  // Any remaining pool dust (fewer participants than prize slots) is burned
  if (totalPaid < pool) totalBurned += (pool - totalPaid);
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
// Auto-finalize tournaments every 60 seconds (not just on HTTP request)
setInterval(checkTournaments, 60_000);

// ═══ Prism Marketplace ═══
const MARKETPLACE_FILE = path.join(process.cwd(), 'marketplace_data.json');
const marketplaceListings = new Map();
const marketplacePurchases = new Map();
try {
  if (fs.existsSync(MARKETPLACE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(MARKETPLACE_FILE, 'utf8'));
    if (raw.listings) for (const [k, v] of Object.entries(raw.listings)) marketplaceListings.set(k, v);
    if (raw.purchases) for (const [k, v] of Object.entries(raw.purchases)) marketplacePurchases.set(k, v);
    console.log(`[marketplace] Loaded ${marketplaceListings.size} listings`);
  }
} catch {}
function saveMarketplace() {
  const tmp = MARKETPLACE_FILE + '.tmp';
  fs.promises.writeFile(tmp, JSON.stringify({ listings: Object.fromEntries(marketplaceListings), purchases: Object.fromEntries(marketplacePurchases) }), 'utf8')
    .then(() => fs.promises.rename(tmp, MARKETPLACE_FILE))
    .catch(e => console.warn('[marketplace] save error', e.message));
}

const constellationCache = new Map();
const enhancedTxCache = new Map(); // address → { data, ts } — 10min TTL, max 200

// ═══ Notification System ═══
const notificationsDb = new Map(); // address → notification[]
const NOTIFICATIONS_FILE = path.join(METADATA_DIR, 'notifications.json');
const MAX_NOTIFICATIONS_PER_USER = 100;

function loadNotifications() {
  try {
    if (fs.existsSync(NOTIFICATIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf8'));
      for (const [addr, notifs] of Object.entries(data)) {
        notificationsDb.set(addr, notifs);
      }
      console.log(`[notifications] Loaded for ${notificationsDb.size} wallets`);
    }
  } catch (e) { console.warn('[notifications] Load failed:', e.message); }
}

function saveNotifications() {
  try {
    const data = {};
    for (const [addr, notifs] of notificationsDb) data[addr] = notifs;
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(data), 'utf8');
  } catch (e) { console.warn('[notifications] Save failed:', e.message); }
}
const saveNotificationsDebounced = (() => { let t; return () => { clearTimeout(t); t = setTimeout(saveNotifications, 5000); }; })();

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

loadNotifications();

// ═══ P2P Challenge System ═══
const CHALLENGES_FILE = path.join(METADATA_DIR, 'challenges.json');
const challenges = [];

// Load persisted challenges
try {
  if (fs.existsSync(CHALLENGES_FILE)) {
    const raw = JSON.parse(fs.readFileSync(CHALLENGES_FILE, 'utf8'));
    const arr = Array.isArray(raw?.challenges) ? raw.challenges : (Array.isArray(raw) ? raw : []);
    challenges.push(...arr);
    console.log(`[challenges] Loaded ${challenges.length} challenges`);
  }
} catch { /* first run */ }

// ── Weekly Challenge Rewards — checks every hour, distributes Monday 00:00 UTC ──
globalThis._challengeWeeklyHistory = globalThis._challengeWeeklyHistory || [];
globalThis._lastWeeklyRewardAt = globalThis._lastWeeklyRewardAt || 0;
// Coins: aligned with daily tournament base prizes (1000/700/400) but lower since no entry fee
// Coins: between daily (1k base) and weekly (5k base) tournament — motivating but not game-breaking
// XP: top-3 get meaningful XP toward Ranger ranks
const WEEKLY_REWARDS =    [2000, 1200, 600, 200, 200, 100, 100, 100, 100, 100]; // total: ~4,700/week
const WEEKLY_XP_REWARDS = [ 500,  300, 200,   0,   0,   0,   0,   0,   0,   0]; // top-3 only
const WEEKLY_MIN_GAMES = 3;
setInterval(() => {
  const now = Date.now();
  const d = new Date(now);
  // Check if it's Monday and we haven't distributed this week yet
  if (d.getUTCDay() !== 1) return; // only on Mondays
  const mondayStart = new Date(now); mondayStart.setUTCHours(0, 0, 0, 0);
  if (globalThis._lastWeeklyRewardAt >= mondayStart.getTime()) return; // already done this week
  // Calculate last week's range
  const lastWeekEnd = mondayStart.getTime();
  const lastWeekStart = lastWeekEnd - 7 * 24 * 60 * 60 * 1000;
  const stats = new Map();
  for (const c of challenges) {
    if (c.status !== 'completed' || !c.winner) continue;
    const t = c.completedAt || c.createdAt;
    if (t < lastWeekStart || t >= lastWeekEnd) continue;
    const s = stats.get(c.winner) || { address: c.winner, wins: 0, earned: 0, played: 0 };
    s.wins++; s.earned += Math.floor(c.stakeAmount * 2 * 0.95); s.played++;
    stats.set(c.winner, s);
    const loser = c.winner === c.creator ? c.opponent : c.creator;
    if (loser) { const l = stats.get(loser) || { address: loser, wins: 0, earned: 0, played: 0 }; l.played++; stats.set(loser, l); }
  }
  const ranked = [...stats.values()].filter(p => p.played >= WEEKLY_MIN_GAMES).sort((a, b) => b.earned - a.earned || b.wins - a.wins).slice(0, 10);
  if (ranked.length === 0) { globalThis._lastWeeklyRewardAt = mondayStart.getTime(); return; }
  const winners = [];
  ranked.forEach((p, i) => {
    const reward = WEEKLY_REWARDS[i] || 0;
    const xpReward = WEEKLY_XP_REWARDS[i] || 0;
    if (reward > 0) {
      setCoinBalance(p.address, getCoinBalance(p.address) + reward);
      addCoinEarned(p.address, reward);
      // Record transaction
      const txs = prismTransactions.get(p.address) || [];
      txs.unshift({ id: `ch_weekly_${Date.now()}_${i}`, address: p.address, amount: reward, type: 'earn', source: 'challenge_win', description: `Weekly Arena #${i + 1}: +${reward} Coins${xpReward ? ` +${xpReward} XP` : ''}`, timestamp: new Date().toISOString() });
      if (txs.length > 200) txs.length = 200;
      prismTransactions.set(p.address, txs);
      // Store XP reward in socialStats for client-side rangerRanks computation
      if (xpReward > 0) {
        const wdb = walletDatabase.get(p.address);
        if (wdb) {
          if (!wdb.socialStats) wdb.socialStats = {};
          wdb.socialStats.arenaWeeklyXP = (wdb.socialStats.arenaWeeklyXP || 0) + xpReward;
          walletDatabase.set(p.address, wdb);
        }
      }
      pushNotification(p.address, 'weekly_payout', `Weekly arena ranking: #${i + 1}, +${reward} coins`, { rank: i + 1, reward });
      winners.push({ address: p.address, rank: i + 1, reward, xp: xpReward, wins: p.wins, earned: p.earned });
    }
  });
  globalThis._challengeWeeklyHistory = winners;
  globalThis._lastWeeklyRewardAt = mondayStart.getTime();
  debouncedSavePrism();
  console.log(`[challenges] Weekly rewards distributed to ${winners.length} challengers: ${winners.map(w => `#${w.rank} ${w.address.slice(0,8)}.. +${w.reward}`).join(', ')}`);
}, 60 * 60 * 1000); // check every hour

// Auto-expire challenges — runs every 60 seconds
// 'open' (score type, waiting for opponent) and 'playing' without opponent (game type, opponent never joined)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const c of challenges) {
    if (!c.expiresAt || c.status === 'completed' || c.status === 'cancelled' || c.status === 'expired') continue;
    if (now < c.expiresAt) continue;
    // Expire 'open' challenges (score type, waiting for opponent)
    if (c.status === 'open') {
      c.status = 'expired';
      c.completedAt = now;
      changed = true;
      // Refund creator (only one who staked in open challenge)
      if (c.stakeAmount > 0) {
        setCoinBalance(c.creator, getCoinBalance(c.creator) + c.stakeAmount);
        refundCoinSpent(c.creator, c.stakeAmount);
      }
      pushNotification(c.creator, 'challenge_expired', `Your challenge expired — ${c.stakeAmount} coins refunded`, { challengeId: c.id, refunded: c.stakeAmount });
      console.log(`[challenges] Expired ${c.id} (open/score, no opponent, ${Math.round((now - c.createdAt) / 60000)}m)`);
      continue;
    }
    // Expire 'playing' game challenges where opponent never joined (no c.opponent set)
    // If opponent joined (c.opponent is set), both committed — safety-net handles stuck games
    if (c.status === 'playing' && !c.opponent) {
      c.status = 'expired';
      c.completedAt = now;
      changed = true;
      // Refund creator (only one who staked, opponent never joined)
      if (c.stakeAmount > 0) {
        setCoinBalance(c.creator, getCoinBalance(c.creator) + c.stakeAmount);
        refundCoinSpent(c.creator, c.stakeAmount);
      }
      pushNotification(c.creator, 'challenge_expired', `Your challenge expired — ${c.stakeAmount} coins refunded`, { challengeId: c.id, refunded: c.stakeAmount });
      console.log(`[challenges] Expired ${c.id} (playing/game, no opponent joined, ${Math.round((now - c.createdAt) / 60000)}m)`);
      continue;
    }
  }
  if (changed) { debouncedSavePrism(); saveChallenges(); }
}, 60_000);

function saveChallenges() {
  const tmp = CHALLENGES_FILE + '.tmp';
  fs.promises.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), challenges }, null, 2))
    .then(() => fs.promises.rename(tmp, CHALLENGES_FILE))
    .catch(e => console.warn('[challenges] save error', e.message));
}

// Cleanup: remove old challenges + cancel stale ones (every 30 minutes)
setInterval(() => {
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000; // 7 days
  const stalePlayingCutoff = now - 2 * 60 * 60 * 1000; // 2 hours
  let removed = 0;
  let staleCancelled = 0;

  // Safety net: expire playing/accepted challenges stuck >24h
  // CRITICAL: only refund players who haven't had coins awarded via win resolution
  const stuckCutoff = now - 24 * 60 * 60 * 1000;
  challenges.forEach(ch => {
    if ((ch.status === 'playing' || ch.status === 'accepted') && (ch.acceptedAt || ch.createdAt) < stuckCutoff) {
      // If both scored, try to resolve instead of refunding
      if (ch.creatorScore !== null && ch.opponentScore !== null) {
        // Attempt resolution — winner gets prize, no double-payout
        const totalPot = ch.stakeAmount * 2;
        const winnerPrize = Math.floor(totalPot * 0.95);
        if (ch.creatorScore > ch.opponentScore) {
          ch.winner = ch.creator;
          setCoinBalance(ch.creator, getCoinBalance(ch.creator) + winnerPrize);
          addCoinEarned(ch.creator, winnerPrize);
          pushNotification(ch.creator, 'challenge_win', `You won the challenge! +${winnerPrize} coins`, { challengeId: ch.id, payout: winnerPrize });
          if (ch.opponent) pushNotification(ch.opponent, 'challenge_loss', `Challenge lost against ${ch.creator.slice(0, 6)}...`, { challengeId: ch.id });
        } else if (ch.opponentScore > ch.creatorScore) {
          ch.winner = ch.opponent;
          setCoinBalance(ch.opponent, getCoinBalance(ch.opponent) + winnerPrize);
          addCoinEarned(ch.opponent, winnerPrize);
          pushNotification(ch.opponent, 'challenge_win', `You won the challenge! +${winnerPrize} coins`, { challengeId: ch.id, payout: winnerPrize });
          pushNotification(ch.creator, 'challenge_loss', `Challenge lost against ${ch.opponent.slice(0, 6)}...`, { challengeId: ch.id });
        } else {
          ch.winner = null;
          setCoinBalance(ch.creator, getCoinBalance(ch.creator) + ch.stakeAmount);
          if (ch.opponent) setCoinBalance(ch.opponent, getCoinBalance(ch.opponent) + ch.stakeAmount);
        }
        ch.status = 'completed';
      } else if (ch.winner) {
        // Winner already resolved but status stuck — just mark completed, NO refund
        ch.status = 'completed';
      } else {
        // No winner, no both-scores — safe to refund only players who staked
        // Only refund if no score was submitted (no partial resolution happened)
        if (ch.stakeAmount > 0 && ch.creatorScore === null && ch.opponentScore === null) {
          setCoinBalance(ch.creator, getCoinBalance(ch.creator) + ch.stakeAmount);
          refundCoinSpent(ch.creator, ch.stakeAmount);
          if (ch.opponent) {
            setCoinBalance(ch.opponent, getCoinBalance(ch.opponent) + ch.stakeAmount);
            refundCoinSpent(ch.opponent, ch.stakeAmount);
          }
        }
        ch.status = 'expired';
      }
      ch.completedAt = Date.now();
      staleCancelled++;
      console.log(`[challenges] Safety-resolved stuck ${ch.id} → ${ch.status} (>24h)`);
    }
  });

  if (staleCancelled > 0) {
    console.log(`[challenges] Auto-cancelled ${staleCancelled} stale challenges (playing >2h or open >7d)`);
    debouncedSavePrism();
  }

  // Remove completed/cancelled challenges older than 7 days
  for (let i = challenges.length - 1; i >= 0; i--) {
    const c = challenges[i];
    if ((c.status === 'completed' || c.status === 'cancelled' || c.status === 'expired') && c.createdAt < cutoff) {
      challenges.splice(i, 1);
      removed++;
    }
  }
  if (removed > 0 || staleCancelled > 0) {
    if (removed > 0) console.log(`[challenges] Cleaned up ${removed} old challenges`);
    saveChallenges();
  }
}, 30 * 60 * 1000);

// Periodic cache cleanup to prevent unbounded memory growth (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  // sybilCache: 1h TTL
  for (const [k, v] of sybilCache) {
    if (now - v.cachedAt > 3600_000) sybilCache.delete(k);
  }
  // clusterCache: 30min TTL
  for (const [k, v] of clusterCache) {
    if (now - v.ts > 1800_000) clusterCache.delete(k);
  }
  // constellationCache: 10min TTL
  for (const [k, v] of constellationCache) {
    if (now - v.ts > 600_000) constellationCache.delete(k);
  }
  // enhancedTxCache: 10min TTL
  for (const [k, v] of enhancedTxCache) {
    if (now - v.ts > 600_000) enhancedTxCache.delete(k);
  }
  // reputationV2RateLimit: 2min TTL
  for (const [k, v] of reputationV2RateLimit) {
    if (now > v.resetAt + 120_000) reputationV2RateLimit.delete(k);
  }
  // reputationRateLimit (v1): 20s TTL
  for (const [k, v] of reputationRateLimit) {
    if (now - v > 20_000) reputationRateLimit.delete(k);
  }
  // Hard cap: evict oldest if still too large
  if (sybilCache.size > 500) { const it = sybilCache.keys(); for (let i = sybilCache.size - 500; i > 0; i--) sybilCache.delete(it.next().value); }
  if (clusterCache.size > 300) { const it = clusterCache.keys(); for (let i = clusterCache.size - 300; i > 0; i--) clusterCache.delete(it.next().value); }
  if (constellationCache.size > 300) { const it = constellationCache.keys(); for (let i = constellationCache.size - 300; i > 0; i--) constellationCache.delete(it.next().value); }
  if (enhancedTxCache.size > 200) { const it = enhancedTxCache.keys(); for (let i = enhancedTxCache.size - 200; i > 0; i--) enhancedTxCache.delete(it.next().value); }
  if (reputationV2RateLimit.size > 1000) { const it = reputationV2RateLimit.keys(); for (let i = reputationV2RateLimit.size - 1000; i > 0; i--) reputationV2RateLimit.delete(it.next().value); }
  if (reputationRateLimit.size > 1000) { const it = reputationRateLimit.keys(); for (let i = reputationRateLimit.size - 1000; i > 0; i--) reputationRateLimit.delete(it.next().value); }
  // prismEarnRateLimit: remove entries older than their source cooldown (max 7d)
  if (prismEarnRateLimit.size > 0) {
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const [k, v] of prismEarnRateLimit) {
      // Handle object-format entries (nongame_daily:*, firstMintLocks)
      if (typeof v === 'object' && v !== null && v.date) {
        if (v.date < todayStr) prismEarnRateLimit.delete(k);
        continue;
      }
      const src = k.split(':')[1] || '';
      const cd = PRISM_EARN_COOLDOWN_TABLE[src] ?? PRISM_EARN_COOLDOWN_DEFAULT;
      if (now - v > cd * 2) prismEarnRateLimit.delete(k);
    }
  }
  if (prismEarnRateLimit.size > 3000) { const it = prismEarnRateLimit.keys(); for (let i = prismEarnRateLimit.size - 3000; i > 0; i--) prismEarnRateLimit.delete(it.next().value); }
}, 300_000);

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Load data from Firestore (fallback JSON), then start server
initData().then(() => {
  server.listen(PORT, HOST, () => {
    const providers = [];
    if (ALCHEMY_RPC_URL) providers.push('alchemy');
    if (HELIUS_KEYS.length) providers.push(`helius(${HELIUS_KEYS.length} keys)`);
    else if (HELIUS_RPC_BASE) providers.push('helius(no-key)');
    if (FALLBACK_RPC_URL) providers.push('solana-public');
    console.log(`[helius-proxy] listening on ${HOST}:${PORT} | RPC chain: ${providers.join(' → ') || 'none'} (gzip, keep-alive 65s)`);
    // Start async wallet database backfill (non-blocking)
    backfillWalletDatabaseAsync().catch(err => console.warn('[wallet-db] Async backfill error', err.message || err));
    // Backfill composite scores for existing wallets (non-blocking)
    setTimeout(backfillCompositeScores, 3000);
  });
}).catch(err => {
  console.error('[init] Failed to load data:', err);
  process.exit(1);
});

process.on('uncaughtException', (err, origin) => {
  console.error(`[fatal:${origin}]`, err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal:unhandledRejection]', reason);
});
