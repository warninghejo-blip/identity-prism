import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
import { create, fetchCollection, mplCore } from '@metaplex-foundation/mpl-core';
import { toWeb3JsInstruction, toWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
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
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

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

if (!fs.existsSync(METADATA_DIR)) {
  fs.mkdirSync(METADATA_DIR, { recursive: true });
}
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
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
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
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
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    );
    if (!response.ok) return null;
    const data = await response.json();
    const price = Number(data?.solana?.usd ?? data?.usd ?? data?.price);
    return Number.isFinite(price) ? price : null;
  } catch (error) {
    console.warn('[market] SOL price fetch failed', error);
    return null;
  }
};

const fetchSkrPriceUsd = async () => {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=seeker&vs_currencies=usd'
    );
    if (!response.ok) return null;
    const data = await response.json();
    const price = Number(data?.seeker?.usd ?? data?.usd ?? data?.price);
    return Number.isFinite(price) ? price : null;
  } catch (error) {
    console.warn('[market] SKR price fetch failed', error);
    return null;
  }
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

  const isMemeLord = memeValueUSD >= 10;
  const isDeFiKing = hasLstExposure || defiProtocolExposure;

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
      if (!adminMode) {
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
      const latestBlockhash = await connection.getLatestBlockhash('finalized');
      const instructions = [
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

  if (!HELIUS_KEYS.length && !HELIUS_RPC_BASE) {
    respondJson(res, 500, { error: 'RPC endpoint is not configured' });
    return;
  }

  try {
    const seed = String(req.headers['x-wallet-address'] ?? '');
    const apiKey = pickHeliusKey(seed);

    if (!apiKey && HELIUS_KEYS.length) {
      respondJson(res, 500, { error: 'Helius API key required' });
      return;
    }

    const targetUrl = new URL(HELIUS_RPC_BASE);
    if (apiKey) {
      targetUrl.searchParams.set('api-key', apiKey);
    }

    const rpcBody = await readBody(req);

    const transport = targetUrl.protocol === 'https:' ? https : http;
    const upstreamReq = transport.request(
      targetUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, {
          'Content-Type': upstreamRes.headers['content-type'] ?? 'application/json',
        });
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.on('error', (error) => {
      console.error('[helius-proxy] upstream error', error);
      if (!res.headersSent) {
        respondJson(res, 502, { error: 'Upstream request failed' });
      } else {
        res.end();
      }
    });

    upstreamReq.write(rpcBody);
    upstreamReq.end();
    return;
  } catch (error) {
    console.error('[helius-proxy] upstream error', error);
    respondJson(res, 502, { error: 'Upstream request failed' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[helius-proxy] listening on ${HOST}:${PORT}`);
});
