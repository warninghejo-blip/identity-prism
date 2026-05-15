/**
 * Standalone RPC proxy with multi-provider fallback.
 * Alchemy (primary) → Helius (DAS + fallback) → Solana Public (last resort).
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv dependency)
const envVars = {};
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    envVars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
} catch {}

const PORT = Number(envVars.RPC_PROXY_PORT ?? process.env.RPC_PROXY_PORT ?? 8788);
const HELIUS_RPC_BASE = (envVars.HELIUS_RPC_BASE ?? process.env.HELIUS_RPC_BASE ?? 'https://mainnet.helius-rpc.com/').trim();
const HELIUS_KEYS = (envVars.HELIUS_API_KEYS ?? process.env.HELIUS_API_KEYS ?? '')
  .split(',').map(k => k.trim()).filter(Boolean);
const ALCHEMY_RPC_URL = (envVars.ALCHEMY_RPC_URL ?? process.env.ALCHEMY_RPC_URL ?? '').trim();
const FALLBACK_RPC_URL = (envVars.FALLBACK_RPC_URL ?? process.env.FALLBACK_RPC_URL ?? 'https://api.mainnet-beta.solana.com').trim();
const RPC_PROXY_TOKEN = (envVars.RPC_PROXY_TOKEN ?? process.env.RPC_PROXY_TOKEN ?? '').trim();
const CORS_ORIGIN = (envVars.CORS_ORIGIN ?? process.env.CORS_ORIGIN ?? 'https://identityprism.xyz')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

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

function pickKey(seed) {
  if (!HELIUS_KEYS.length) return null;
  if (!seed) return HELIUS_KEYS[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  return HELIUS_KEYS[Math.abs(hash) % HELIUS_KEYS.length];
}

function buildHeliusUrl(seed) {
  const apiKey = pickKey(seed);
  if (!HELIUS_RPC_BASE && !apiKey) return null;
  const u = new URL(HELIUS_RPC_BASE);
  if (apiKey) u.searchParams.set('api-key', apiKey);
  return u.toString();
}

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

// IP-based rate limiting — 120 req/min per IP
const ipCounts = new Map();
setInterval(() => ipCounts.clear(), 60_000).unref();

function checkRateLimit(ip) {
  const count = (ipCounts.get(ip) || 0) + 1;
  ipCounts.set(ip, count);
  return count <= 120;
}

function resolveCorsOrigin(req) {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGIN.includes(origin)) return origin;
  return CORS_ORIGIN[0] || 'https://identityprism.xyz';
}

function getRpcAccessToken(req) {
  const header = req.headers.authorization ?? '';
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  const tokenHeader = req.headers['x-rpc-token'];
  return Array.isArray(tokenHeader) ? tokenHeader[0] : (tokenHeader || '');
}

function validateRpcPayload(payload) {
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
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', resolveCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization,x-wallet-address,x-rpc-token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end('Method not allowed'); return; }
  if (RPC_PROXY_TOKEN && getRpcAccessToken(req) !== RPC_PROXY_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'RPC auth required' }));
    return;
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  if (!checkRateLimit(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
    return;
  }

  try {
    const body = await readBody(req);
    const seed = String(req.headers['x-wallet-address'] ?? '');

    let rpcMethod = '';
    let parsed = null;
    try {
      parsed = JSON.parse(body);
      rpcMethod = Array.isArray(parsed) ? parsed[0]?.method ?? '' : parsed?.method ?? '';
    } catch {}
    const validation = validateRpcPayload(parsed);
    if (!validation.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: validation.error }));
      return;
    }
    const isDas = DAS_METHODS.has(rpcMethod);

    const heliusUrl = buildHeliusUrl(seed);
    const urls = [];
    if (isDas) {
      if (heliusUrl) urls.push({ url: heliusUrl, name: 'helius' });
    } else {
      if (ALCHEMY_RPC_URL) urls.push({ url: ALCHEMY_RPC_URL, name: 'alchemy' });
      if (heliusUrl) urls.push({ url: heliusUrl, name: 'helius' });
      if (FALLBACK_RPC_URL) urls.push({ url: FALLBACK_RPC_URL, name: 'solana-public' });
    }

    if (!urls.length) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No RPC provider available' }));
      return;
    }

    let lastError = null;
    for (const { url, name } of urls) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const upstream = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!upstream.ok) {
          lastError = `${name} HTTP ${upstream.status}`;
          console.warn(`[rpc-proxy] ${name} failed: ${upstream.status}, trying next...`);
          continue;
        }

        const responseBody = await upstream.text();
        try {
          const parsed = JSON.parse(responseBody);
          if (parsed?.error?.code === -32429 || parsed?.error?.message?.includes('rate limit')) {
            lastError = `${name} rate limited`;
            console.warn(`[rpc-proxy] ${name} rate limited, trying next...`);
            continue;
          }
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(responseBody);
        return;
      } catch (err) {
        lastError = `${name}: ${err.message}`;
        console.warn(`[rpc-proxy] ${name} error: ${err.message}, trying next...`);
      }
    }

    console.error(`[rpc-proxy] all providers failed for ${rpcMethod}: ${lastError}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'All RPC providers failed', detail: lastError }));
  } catch (err) {
    console.error('[rpc-proxy] error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const providers = [];
  if (ALCHEMY_RPC_URL) providers.push('alchemy');
  if (HELIUS_KEYS.length) providers.push(`helius(${HELIUS_KEYS.length} keys)`);
  if (FALLBACK_RPC_URL) providers.push('solana-public');
  console.log(`[rpc-proxy] listening on 0.0.0.0:${PORT} | providers: ${providers.join(' → ') || 'none'}`);
});
