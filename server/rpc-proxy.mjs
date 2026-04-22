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

const DAS_METHODS = new Set([
  'getAssetsByOwner', 'getAsset', 'getAssetBatch', 'getAssetProof', 'getAssetProofBatch',
  'getAssetsByGroup', 'getAssetsByCreator', 'getAssetsByAuthority', 'searchAssets',
  'getSignaturesForAsset', 'getTokenAccounts', 'getNftEditions',
]);

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

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

// IP-based rate limiting — 120 req/min per IP
const ipCounts = new Map();
setInterval(() => ipCounts.clear(), 60_000).unref();

function checkRateLimit(ip) {
  const count = (ipCounts.get(ip) || 0) + 1;
  ipCounts.set(ip, count);
  return count <= 120;
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end('Method not allowed'); return; }

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
    try { rpcMethod = JSON.parse(body)?.method ?? ''; } catch {}
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
