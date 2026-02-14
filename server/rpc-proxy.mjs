/**
 * Minimal standalone RPC proxy for Helius.
 * Runs as a separate process to avoid library conflicts in the main proxy.
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
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

function pickKey(seed) {
  if (!HELIUS_KEYS.length) return null;
  if (!seed) return HELIUS_KEYS[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  return HELIUS_KEYS[Math.abs(hash) % HELIUS_KEYS.length];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
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

  try {
    const body = await readBody(req);
    const seed = String(req.headers['x-wallet-address'] ?? '');
    const apiKey = pickKey(seed);
    const targetUrl = new URL(HELIUS_RPC_BASE);
    if (apiKey) targetUrl.searchParams.set('api-key', apiKey);

    const transport = targetUrl.protocol === 'https:' ? https : http;
    const upReq = transport.request(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, {
        'Content-Type': upRes.headers['content-type'] ?? 'application/json',
      });
      upRes.pipe(res);
    });

    upReq.on('error', (err) => {
      console.error('[rpc-proxy] upstream error:', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream request failed' }));
      }
    });

    upReq.write(body);
    upReq.end();
  } catch (err) {
    console.error('[rpc-proxy] error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[rpc-proxy] listening on 0.0.0.0:${PORT} (${HELIUS_KEYS.length} keys)`);
});
