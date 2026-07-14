// PrismGuard VPN subscription payment routes for the identityprism helius-proxy.
// Self-contained + additive: own SQLite (node:sqlite), own routes under /api/v1/payment/.
// Mounted from helius-proxy.js via: import { paymentHandler } from './payment.js'
// and a dispatch line that returns early when paymentHandler handles the request.
//
// Money-critical: /verify fetches the real on-chain tx (Helius getTransaction) and only
// activates a subscription when the tx is a CONFIRMED transfer of the quoted amount of the
// quoted currency to the VPN treasury, signed by the claiming wallet, with a txid never used
// before. The quote must exist, match the wallet, and not be expired.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import { readBody } from './utils/readBody.js';
import fs from 'node:fs';
import { Connection, Transaction, SystemProgram, PublicKey, Keypair, NonceAccount } from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';

// ── Durable nonce (so a payment tx NEVER expires while the user signs — no "couldn't verify /
// blockhash expired" warning). The nonce authority is a DEDICATED key (keys/nonce_authority.json) —
// NOT the VPN treasury (D1mzmpBP…, whose key is off-server) and NOT any identity-prism key. It only
// advances/owns the nonce account; zero access to user funds or the treasury. Set up once via
// `node nonce_setup.js create`. /prepare prepends an advanceNonce ix, uses the nonce value as the
// recentBlockhash, and partial-signs with the authority; the wallet adds the fee-payer signature.
const NONCE_AUTHORITY_PATH = '/opt/identityprism/helius-proxy/keys/nonce_authority.json';
const NONCE_ACCOUNT_PATH = '/opt/identityprism/helius-proxy/keys/nonce_account.json';
let _nonceAuthority = null, _noncePubkey = null;
function nonceAuthority() {
  if (!_nonceAuthority) {
    try { _nonceAuthority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(NONCE_AUTHORITY_PATH)))); } catch {}
  }
  return _nonceAuthority;
}
function noncePubkey() {
  if (!_noncePubkey) {
    try { _noncePubkey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(NONCE_ACCOUNT_PATH)))).publicKey; } catch {}
  }
  return _noncePubkey;
}
async function fetchNonceValue(conn, np) {
  const info = await conn.getAccountInfo(np, 'confirmed');
  if (!info) return null;
  return NonceAccount.fromAccountData(info.data).nonce; // base58 durable-nonce value (used as recentBlockhash)
}

// ── Config ──
const VPN_TREASURY = 'D1mzmpBP5ZFG3Mrc1dTdbRdAYKV927zAUjzmdcnR2SFY';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
const LAMPORTS_PER_SOL = 1_000_000_000;
// Single paid plan. The former $8 "premium_monthly" tier was removed — there is now ONE paid plan
// ("Premium" in the UI, server tier string "basic") at $5/mo that bundles everything incl. Shield.
const PLANS = {
  basic_monthly: { tier: 'basic', usd: 5, days: 30 },
};
// Authoritative server-side price table (whole USD) per tier × months.
// The server NEVER trusts the client's total_usd; it prices from this table.
const PRICE_TABLE = {
  basic:   { 1: 5, 3: 14, 6: 27, 12: 50 },
};
const ALLOWED_MONTHS = [1, 3, 6, 12];
const DAYS_PER_MONTH = 30;
const QUOTE_TTL_MS = 10 * 60 * 1000;
const SOL_PRICE_TTL_MS = 60 * 1000;
const SOL_PRICE_FLOOR = 20;   // sanity floor if the oracle returns garbage
const SOL_PRICE_CEIL = 2000;

const DB_PATH = process.env.PAYMENT_DB_PATH || path.join(process.cwd(), 'payments.db');
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS quotes (
    quote_id TEXT PRIMARY KEY, wallet TEXT, plan_id TEXT, tier TEXT, currency TEXT,
    amount_raw TEXT, treasury TEXT, reference_pubkey TEXT, days INTEGER,
    months INTEGER DEFAULT 1,
    created_at INTEGER, expires_at INTEGER, used INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    wallet TEXT PRIMARY KEY, tier TEXT, expire_at INTEGER, updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS used_txids (
    txid TEXT PRIMARY KEY, wallet TEXT, quote_id TEXT, used_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS usage (
    wallet TEXT PRIMARY KEY, used_bytes INTEGER DEFAULT 0,
    down_bytes INTEGER DEFAULT 0, up_bytes INTEGER DEFAULT 0,
    reset_epoch INTEGER DEFAULT 0, updated_at INTEGER
  );
`);
// Migration: add `months` to a pre-existing quotes table (no-op if already present).
try { db.exec('ALTER TABLE quotes ADD COLUMN months INTEGER DEFAULT 1'); } catch { /* column exists */ }
// Migration: split usage into download/upload on a pre-existing usage table (no-op if present).
try { db.exec('ALTER TABLE usage ADD COLUMN down_bytes INTEGER DEFAULT 0'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE usage ADD COLUMN up_bytes INTEGER DEFAULT 0'); } catch { /* column exists */ }

// Promo / giveaway codes — grant a subscription WITHOUT an on-chain payment.
// max_uses 0 = unlimited; expires_at 0 = never. One redemption per wallet (promo_redemptions PK).
db.exec(`
  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY, tier TEXT, days INTEGER,
    max_uses INTEGER DEFAULT 0, used_count INTEGER DEFAULT 0, expires_at INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS promo_redemptions (
    code TEXT, wallet TEXT, redeemed_at INTEGER, PRIMARY KEY (code, wallet)
  );
`);

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isPubkey = (s) => typeof s === 'string' && B58.test(s);

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function heliusRpcUrl() {
  const base = (process.env.HELIUS_RPC_BASE || 'https://mainnet.helius-rpc.com/').trim();
  const key = (process.env.HELIUS_API_KEYS || '').split(',')[0].trim();
  const u = new URL(base);
  if (key) u.searchParams.set('api-key', key);
  return u.toString();
}

let solPriceCache = { price: 0, at: 0 };
async function getSolPriceUsd() {
  const now = Date.now();
  if (solPriceCache.price && now - solPriceCache.at < SOL_PRICE_TTL_MS) return solPriceCache.price;
  const sources = [
    async () => {
      const r = await fetch('https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112', { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      return Number(j?.data?.['So11111111111111111111111111111111111111112']?.price);
    },
    async () => {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      return Number(j?.solana?.usd);
    },
  ];
  for (const src of sources) {
    try {
      const p = await src();
      if (Number.isFinite(p) && p >= SOL_PRICE_FLOOR && p <= SOL_PRICE_CEIL) {
        solPriceCache = { price: p, at: now };
        return p;
      }
    } catch { /* try next */ }
  }
  if (solPriceCache.price) return solPriceCache.price; // stale better than nothing
  throw new Error('SOL price unavailable');
}

async function getTransaction(txid) {
  const res = await fetch(heliusRpcUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTransaction',
      params: [txid, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }],
    }),
  });
  const j = await res.json();
  return j?.result ?? null;
}

// Account keys (jsonParsed) → flat [{pubkey, signer}].
function accountKeys(tx) {
  const keys = tx?.transaction?.message?.accountKeys ?? [];
  return keys.map((k) => (typeof k === 'string' ? { pubkey: k, signer: false } : { pubkey: k.pubkey, signer: !!k.signer }));
}

function verifyUsdcTransfer(tx, amountRaw) {
  const want = BigInt(amountRaw);
  const pre = tx?.meta?.preTokenBalances ?? [];
  const post = tx?.meta?.postTokenBalances ?? [];
  const treasuryPost = post.find((b) => b.owner === VPN_TREASURY && b.mint === USDC_MINT);
  if (!treasuryPost) return false;
  const treasuryPre = pre.find((b) => b.accountIndex === treasuryPost.accountIndex);
  const postAmt = BigInt(treasuryPost.uiTokenAmount?.amount ?? '0');
  const preAmt = BigInt(treasuryPre?.uiTokenAmount?.amount ?? '0');
  return postAmt - preAmt >= want;
}

function verifySolTransfer(tx, lamports) {
  const want = BigInt(lamports);
  const keys = accountKeys(tx).map((k) => k.pubkey);
  const idx = keys.indexOf(VPN_TREASURY);
  if (idx < 0) return false;
  const pre = BigInt(tx?.meta?.preBalances?.[idx] ?? 0);
  const post = BigInt(tx?.meta?.postBalances?.[idx] ?? 0);
  return post - pre >= want;
}

function walletSigned(tx, wallet) {
  return accountKeys(tx).some((k) => k.pubkey === wallet && k.signer);
}

// ── Routes ──
async function handleQuote(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  const currency = String(body.currency || '').toUpperCase();
  const wallet = String(body.wallet || '');
  const planId = String(body.plan_id || 'basic_monthly');
  const plan = PLANS[planId];
  if (!plan) return sendJson(res, 400, { error: 'unknown plan_id' });
  if (currency !== 'SOL' && currency !== 'USDC') return sendJson(res, 400, { error: 'currency must be SOL or USDC' });
  if (!isPubkey(wallet)) return sendJson(res, 400, { error: 'invalid wallet' });

  // months defaults to 1 (back-compat). Must be one of {1,3,6,12}.
  const months = body.months === undefined || body.months === null ? 1 : Number(body.months);
  if (!ALLOWED_MONTHS.includes(months)) return sendJson(res, 400, { error: 'months must be one of 1,3,6,12' });

  const tier = plan.tier;
  const tierTable = PRICE_TABLE[tier];
  if (!tierTable) return sendJson(res, 400, { error: 'tier must be basic or premium' });
  // AUTHORITATIVE price from the server table — client total_usd is never trusted.
  const usd = tierTable[months];
  const days = months * DAYS_PER_MONTH;
  let amountRaw, lamports, usdcAmount;
  if (currency === 'USDC') {
    usdcAmount = Math.round(usd * 10 ** USDC_DECIMALS);
    amountRaw = String(usdcAmount);
  } else {
    let solPrice;
    try { solPrice = await getSolPriceUsd(); } catch { return sendJson(res, 503, { error: 'PRICE_UNAVAILABLE' }); }
    lamports = Math.round((usd / solPrice) * LAMPORTS_PER_SOL);
    amountRaw = String(lamports);
  }

  const quoteId = crypto.randomUUID();
  const referencePubkey = require_b58(crypto.randomBytes(32));
  const createdAt = Date.now();
  const expiresAt = createdAt + QUOTE_TTL_MS;
  db.prepare(`INSERT INTO quotes (quote_id,wallet,plan_id,tier,currency,amount_raw,treasury,reference_pubkey,days,months,created_at,expires_at,used)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`)
    .run(quoteId, wallet, planId, tier, currency, amountRaw, VPN_TREASURY, referencePubkey, days, months, createdAt, expiresAt);

  return sendJson(res, 200, {
    quote_id: quoteId,
    plan_id: planId,
    tier,
    months,
    currency,
    amount_raw: amountRaw,
    amount_ui: usd,
    treasury: VPN_TREASURY,
    reference_pubkey: referencePubkey,
    expires_at: new Date(expiresAt).toISOString(),
    expiresAt,
    priceUsd: usd,
    ...(currency === 'SOL' ? { lamports } : { usdcAmount }),
  });
}

async function handleVerify(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  const quoteId = String(body.quote_id || '');
  const txidIn = String(body.txid || '');
  const wallet = String(body.wallet || '');
  if (!quoteId || !isPubkey(wallet)) return sendJson(res, 400, { error: 'quote_id, wallet required' });

  const quote = db.prepare('SELECT * FROM quotes WHERE quote_id = ?').get(quoteId);
  if (!quote) return sendJson(res, 404, { error: 'quote not found' });
  if (quote.wallet !== wallet) return sendJson(res, 403, { error: 'quote/wallet mismatch' });
  // Already activated for this quote → idempotent success (client may retry after the wallet never
  // returned the txid). Report the live subscription instead of erroring.
  if (quote.used) {
    const s0 = db.prepare('SELECT * FROM subscriptions WHERE wallet = ?').get(wallet);
    const n0 = Date.now();
    const a0 = !!(s0 && s0.expire_at > n0);
    return sendJson(res, 200, { active: a0, tier: a0 ? s0.tier : quote.tier, expire_at: a0 ? s0.expire_at : 0, expireAt: a0 ? s0.expire_at : 0 });
  }
  // NOTE: deliberately NOT hard-failing on quote expiry — on Seeker the wallet often never returns
  // the txid, so the client falls back to reference-based polling which can land AFTER the short
  // quote TTL. The price/amount is locked into the quote; the reference+amount+wallet match below is
  // the real integrity guard.

  // Resolve a confirmed payment tx: prefer the client txid; else find it on-chain by the Solana Pay
  // reference key embedded in the transfer (so activation does NOT depend on the wallet returning a txid).
  let tx = null;
  let txid = txidIn;
  if (txid) {
    if (db.prepare('SELECT 1 FROM used_txids WHERE txid = ?').get(txid)) return sendJson(res, 409, { error: 'txid already used' });
    tx = await getTransaction(txid);
  } else if (quote.reference_pubkey) {
    try {
      const conn = new Connection(heliusRpcUrl(), 'confirmed');
      const sigs = await conn.getSignaturesForAddress(new PublicKey(quote.reference_pubkey), { limit: 12 });
      for (const s of sigs) {
        if (s.err) continue;
        if (db.prepare('SELECT 1 FROM used_txids WHERE txid = ?').get(s.signature)) continue;
        const cand = await getTransaction(s.signature);
        if (!cand || cand.meta?.err || !walletSigned(cand, wallet)) continue;
        const ok2 = quote.currency === 'USDC' ? verifyUsdcTransfer(cand, quote.amount_raw) : verifySolTransfer(cand, quote.amount_raw);
        if (ok2) { tx = cand; txid = s.signature; break; }
      }
    } catch (_) { /* fall through to pending */ }
  }
  if (!tx) return sendJson(res, 202, { active: false, status: 'pending', error: 'payment not found/not confirmed yet' });
  if (tx.meta?.err) return sendJson(res, 400, { active: false, error: 'tx failed on chain' });
  if (!walletSigned(tx, wallet)) return sendJson(res, 400, { active: false, error: 'tx not signed by wallet' });

  const ok = quote.currency === 'USDC' ? verifyUsdcTransfer(tx, quote.amount_raw) : verifySolTransfer(tx, quote.amount_raw);
  if (!ok) return sendJson(res, 400, { active: false, error: 'transfer to treasury not found / wrong amount' });

  // Activate (idempotent on txid). Extend by months×30d from max(now, current expiry).
  const now = Date.now();
  const months = Number(quote.months) || 1;
  // Prefer days (set from months at quote time); fall back to months×30 for legacy quotes.
  const extendDays = Number(quote.days) || months * DAYS_PER_MONTH;
  const sub = db.prepare('SELECT * FROM subscriptions WHERE wallet = ?').get(wallet);
  const base = sub && sub.expire_at > now ? sub.expire_at : now;
  const expireAt = base + extendDays * 86_400_000;
  db.prepare('INSERT INTO subscriptions (wallet,tier,expire_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET tier=excluded.tier, expire_at=excluded.expire_at, updated_at=excluded.updated_at')
    .run(wallet, quote.tier, expireAt, now);
  db.prepare('UPDATE quotes SET used = 1 WHERE quote_id = ?').run(quoteId);
  db.prepare('INSERT OR IGNORE INTO used_txids (txid,wallet,quote_id,used_at) VALUES (?,?,?,?)').run(txid, wallet, quoteId, now);

  // [vpnwire] Non-fatal: mint/refresh the VPN credential after recording the payment.
  // Payment is already committed to SQLite — a provisioning hiccup must never fail this response.
  let vpnKey = null;
  try {
    const provRes = await fetch('http://127.0.0.1:18787/internal/v1/provision', {
      method: 'POST',
      headers: { 'X-Internal-Secret': '0c772ab74dd4bc25877d1e635caa2f4d83fac5f4dbff62af', 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'solana', external_id: wallet, tier: quote.tier, expires_at: new Date(expireAt).toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    if (provRes.ok) { const pj = await provRes.json(); vpnKey = (pj && pj.vpn_key) || null; }
    else { console.error('[vpnwire] provision HTTP', provRes.status, await provRes.text().catch(() => '')); }
  } catch (e) { console.error('[vpnwire] provision failed', e && e.message); }

  return sendJson(res, 200, { active: true, tier: quote.tier, months, expire_at: expireAt, expireAt, vpn_key: vpnKey });
}

function handleStatus(req, res, url) {
  const wallet = url.searchParams.get('wallet') || '';
  if (!isPubkey(wallet)) return sendJson(res, 400, { error: 'invalid wallet' });
  const sub = db.prepare('SELECT * FROM subscriptions WHERE wallet = ?').get(wallet);
  const now = Date.now();
  const active = !!(sub && sub.expire_at > now);
  return sendJson(res, 200, { active, tier: active ? sub.tier : 'free', expire_at: active ? sub.expire_at : 0, expireAt: active ? sub.expire_at : 0 });
}

// Redeem a promo/giveaway code -> grants tier for `days`, extending from max(now, current expiry)
// so it never shortens an active sub. One redemption per (code,wallet); honours max_uses + expiry.
async function handleRedeem(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  const wallet = String(body.wallet || '');
  const code = String(body.code || '').trim().toUpperCase();
  if (!isPubkey(wallet)) return sendJson(res, 400, { error: 'invalid wallet' });
  if (!code) return sendJson(res, 400, { error: 'missing code' });
  const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code);
  if (!promo) return sendJson(res, 404, { error: 'invalid code' });
  const now = Date.now();
  if (promo.expires_at > 0 && promo.expires_at < now) return sendJson(res, 410, { error: 'code expired' });
  if (db.prepare('SELECT 1 FROM promo_redemptions WHERE code = ? AND wallet = ?').get(code, wallet)) {
    return sendJson(res, 409, { error: 'already redeemed by this wallet' });
  }
  if (promo.max_uses > 0 && promo.used_count >= promo.max_uses) return sendJson(res, 409, { error: 'code fully used' });
  const sub = db.prepare('SELECT * FROM subscriptions WHERE wallet = ?').get(wallet);
  const base = sub && sub.expire_at > now ? sub.expire_at : now;
  const expireAt = base + Number(promo.days) * 86_400_000;
  db.prepare('INSERT INTO subscriptions (wallet,tier,expire_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET tier=excluded.tier, expire_at=excluded.expire_at, updated_at=excluded.updated_at')
    .run(wallet, promo.tier, expireAt, now);
  db.prepare('INSERT OR IGNORE INTO promo_redemptions (code,wallet,redeemed_at) VALUES (?,?,?)').run(code, wallet, now);
  db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?').run(code);
  return sendJson(res, 200, { active: true, tier: promo.tier, days: Number(promo.days), expire_at: expireAt, expireAt });
}

// base58 of raw bytes (for reference_pubkey).
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function require_b58(buf) {
  let zeros = 0;
  while (zeros < buf.length && buf[zeros] === 0) zeros++;
  const b = Buffer.from(buf);
  let out = '';
  let start = zeros;
  const digits = [];
  while (start < b.length) {
    let rem = 0;
    for (let i = start; i < b.length; i++) {
      const num = (rem << 8) + b[i];
      b[i] = Math.floor(num / 58);
      rem = num % 58;
    }
    digits.push(B58_ALPHABET[rem]);
    if (b[start] === 0) start++;
  }
  out = '1'.repeat(zeros) + digits.reverse().join('');
  return out;
}

// Build the FRESH unsigned transfer tx server-side (fresh blockhash, fee payer = wallet).
// The client just MWA-signs+sends it, then calls /verify. Avoids client-side tx building.
async function handleTransaction(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  const quoteId = String(body.quote_id || '');
  const wallet = String(body.wallet || '');
  if (!quoteId || !isPubkey(wallet)) return sendJson(res, 400, { error: 'quote_id, wallet required' });
  const quote = db.prepare('SELECT * FROM quotes WHERE quote_id = ?').get(quoteId);
  if (!quote) return sendJson(res, 404, { error: 'quote not found' });
  if (quote.used) return sendJson(res, 409, { error: 'quote already used' });
  if (quote.wallet !== wallet) return sendJson(res, 403, { error: 'quote/wallet mismatch' });
  if (Date.now() > quote.expires_at) return sendJson(res, 410, { error: 'quote expired' });

  const conn = new Connection(heliusRpcUrl(), 'confirmed');
  const payer = new PublicKey(wallet);
  const treasury = new PublicKey(VPN_TREASURY);
  const ref = new PublicKey(quote.reference_pubkey); // Solana Pay reference (reference-based /verify)
  const tx = new Transaction();
  if (quote.currency === 'SOL') {
    const ix = SystemProgram.transfer({ fromPubkey: payer, toPubkey: treasury, lamports: Number(quote.amount_raw) });
    ix.keys.push({ pubkey: ref, isSigner: false, isWritable: false });
    tx.add(ix);
  } else {
    const mint = new PublicKey(USDC_MINT);
    const src = getAssociatedTokenAddressSync(mint, payer);
    const dst = getAssociatedTokenAddressSync(mint, treasury);
    // Idempotent: creates the treasury USDC ATA if missing (payer covers rent once), no-op otherwise.
    tx.add(createAssociatedTokenAccountIdempotentInstruction(payer, dst, treasury, mint));
    const xfer = createTransferInstruction(src, dst, payer, BigInt(quote.amount_raw));
    xfer.keys.push({ pubkey: ref, isSigner: false, isWritable: false });
    tx.add(xfer);
  }
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  return sendJson(res, 200, { transaction: serialized, quote_id: quoteId, currency: quote.currency, amount_raw: quote.amount_raw });
}

// Combined quote+transaction in ONE round-trip (client speed: drops a whole client→server hop
// before the wallet sheet). Same authoritative server-side pricing + tx build as /quote+/transaction.
async function handlePrepare(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  const currency = String(body.currency || '').toUpperCase();
  const wallet = String(body.wallet || '');
  const planId = String(body.plan_id || 'basic_monthly');
  const plan = PLANS[planId];
  if (!plan) return sendJson(res, 400, { error: 'unknown plan_id' });
  if (currency !== 'SOL' && currency !== 'USDC') return sendJson(res, 400, { error: 'currency must be SOL or USDC' });
  if (!isPubkey(wallet)) return sendJson(res, 400, { error: 'invalid wallet' });
  const months = body.months === undefined || body.months === null ? 1 : Number(body.months);
  if (!ALLOWED_MONTHS.includes(months)) return sendJson(res, 400, { error: 'months must be one of 1,3,6,12' });
  const tier = plan.tier;
  const tierTable = PRICE_TABLE[tier];
  if (!tierTable) return sendJson(res, 400, { error: 'tier must be basic or premium' });
  const usd = tierTable[months];
  const days = months * DAYS_PER_MONTH;
  let amountRaw, lamports, usdcAmount;
  if (currency === 'USDC') {
    usdcAmount = Math.round(usd * 10 ** USDC_DECIMALS);
    amountRaw = String(usdcAmount);
  } else {
    let solPrice;
    try { solPrice = await getSolPriceUsd(); } catch { return sendJson(res, 503, { error: 'PRICE_UNAVAILABLE' }); }
    lamports = Math.round((usd / solPrice) * LAMPORTS_PER_SOL);
    amountRaw = String(lamports);
  }
  const quoteId = crypto.randomUUID();
  const referencePubkey = require_b58(crypto.randomBytes(32));
  const createdAt = Date.now();
  const expiresAt = createdAt + QUOTE_TTL_MS;
  db.prepare(`INSERT INTO quotes (quote_id,wallet,plan_id,tier,currency,amount_raw,treasury,reference_pubkey,days,months,created_at,expires_at,used)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`)
    .run(quoteId, wallet, planId, tier, currency, amountRaw, VPN_TREASURY, referencePubkey, days, months, createdAt, expiresAt);

  const conn = new Connection(heliusRpcUrl(), 'confirmed');
  const payer = new PublicKey(wallet);
  const treasury = new PublicKey(VPN_TREASURY);
  const ref = new PublicKey(referencePubkey); // Solana Pay reference: lets /verify find the tx on-chain WITHOUT a client txid
  const tx = new Transaction();
  if (currency === 'SOL') {
    const ix = SystemProgram.transfer({ fromPubkey: payer, toPubkey: treasury, lamports: Number(amountRaw) });
    ix.keys.push({ pubkey: ref, isSigner: false, isWritable: false });
    tx.add(ix);
  } else {
    const mint = new PublicKey(USDC_MINT);
    const src = getAssociatedTokenAddressSync(mint, payer);
    const dst = getAssociatedTokenAddressSync(mint, treasury);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(payer, dst, treasury, mint));
    const xfer = createTransferInstruction(src, dst, payer, BigInt(amountRaw));
    xfer.keys.push({ pubkey: ref, isSigner: false, isWritable: false });
    tx.add(xfer);
  }
  // Durable nonce path: advanceNonce must be the FIRST instruction; the nonce value replaces a
  // recent blockhash so the tx never expires while the user signs. Falls back to a recent blockhash
  // if the nonce account isn't set up yet.
  const authority = nonceAuthority();
  const np = noncePubkey();
  const nonceVal = (authority && np) ? await fetchNonceValue(conn, np) : null;
  if (authority && np && nonceVal) {
    tx.instructions.unshift(SystemProgram.nonceAdvance({ noncePubkey: np, authorizedPubkey: authority.publicKey }));
    tx.recentBlockhash = nonceVal;
    tx.feePayer = payer;
    tx.partialSign(authority);
  } else {
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;
  }
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');

  return sendJson(res, 200, {
    quote_id: quoteId, plan_id: planId, tier, months, currency,
    amount_raw: amountRaw, amount_ui: usd, treasury: VPN_TREASURY,
    reference_pubkey: referencePubkey, expires_at: new Date(expiresAt).toISOString(), expiresAt, priceUsd: usd,
    transaction: serialized,
    ...(currency === 'SOL' ? { lamports } : { usdcAmount }),
  });
}

// On-chain balance for the connected wallet so the client can show "USDC: X · SOL: Y" under the
// pay method and block the pay button when funds are short. USDC read from the owner's ATA
// (missing ATA → 0); SOL from the native lamport balance.
async function handleBalance(req, res, url) {
  const wallet = url.searchParams.get('wallet') || '';
  if (!isPubkey(wallet)) return sendJson(res, 400, { error: 'invalid wallet' });
  const conn = new Connection(heliusRpcUrl(), 'confirmed');
  const owner = new PublicKey(wallet);
  let sol = 0, usdc = 0, solUsd = 0;
  try { sol = Number(await conn.getBalance(owner)) / LAMPORTS_PER_SOL; } catch {}
  try {
    const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner);
    const bal = await conn.getTokenAccountBalance(ata);
    usdc = Number(bal?.value?.uiAmount ?? 0);
  } catch { usdc = 0; }
  try { solUsd = Number(await getSolPriceUsd()) || 0; } catch {}
  // sol_usd lets the client show the exact SOL amount for a USD-priced plan and gate the SOL balance
  // with the SAME price the /quote tx uses, so the displayed SOL recalculation matches the charge.
  return sendJson(res, 200, { wallet, sol, usdc, sol_usd: solUsd });
}

// Broadcast a wallet-SIGNED transaction from the client (signTransactions + self-broadcast path).
// On Seeker, the wallet's signAndSendTransactions often signs but never returns the txid (or never
// broadcasts), so the client signs-only and hands us the signed tx to send — we own the txid and the
// Solana Pay reference still lets /verify confirm it. Returns { txid }.
async function handleBroadcast(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  const signedB64 = String(body.signed_tx || '');
  if (!signedB64) return sendJson(res, 400, { error: 'signed_tx required' });
  const raw = Buffer.from(signedB64, 'base64');
  const conn = new Connection(heliusRpcUrl(), 'confirmed');
  try {
    const txid = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
    return sendJson(res, 200, { txid });
  } catch (e) {
    return sendJson(res, 502, { error: 'broadcast_failed', detail: String(e?.message || e) });
  }
}

// ── Monthly traffic usage, keyed by wallet pubkey (survives app reinstall; the local DataStore
// counter is wiped on uninstall, so the fair-use number must live server-side tied to the account).
// Self-reported by the client (soft fair-use display, not a hard gate); a per-call delta cap blocks
// silly inflation. 30-day rolling window mirrors the client's rolloverUsageIfDue.
const USAGE_WINDOW_MS = 30 * 86_400_000;
const USAGE_DELTA_CAP = 50 * 1024 * 1024 * 1024; // 50 GB max per report call

async function handleUsageReport(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  const wallet = String(body.wallet || '');
  if (!isPubkey(wallet)) return sendJson(res, 400, { error: 'invalid wallet' });
  const clamp = (v) => { let n = Number(v); if (!Number.isFinite(n) || n < 0) n = 0; if (n > USAGE_DELTA_CAP) n = USAGE_DELTA_CAP; return n; };
  const dDown = clamp(body.deltaDown);
  const dUp = clamp(body.deltaUp);
  // Legacy clients (pre split) send only an aggregate `deltaBytes` with no down/up breakdown — fold it
  // into the total only (can't attribute it to download vs upload).
  const dLegacy = (body.deltaDown === undefined && body.deltaUp === undefined) ? clamp(body.deltaBytes) : 0;
  const now = Date.now();
  const row = db.prepare('SELECT * FROM usage WHERE wallet = ?').get(wallet);
  let used, down, up, resetEpoch;
  if (!row || !row.reset_epoch || now >= row.reset_epoch) {
    used = 0; down = 0; up = 0; resetEpoch = now + USAGE_WINDOW_MS; // new / expired window
  } else {
    used = Number(row.used_bytes) || 0; down = Number(row.down_bytes) || 0; up = Number(row.up_bytes) || 0;
    resetEpoch = row.reset_epoch;
  }
  down += dDown; up += dUp; used += dDown + dUp + dLegacy;
  db.prepare('INSERT INTO usage (wallet,used_bytes,down_bytes,up_bytes,reset_epoch,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET used_bytes=excluded.used_bytes, down_bytes=excluded.down_bytes, up_bytes=excluded.up_bytes, reset_epoch=excluded.reset_epoch, updated_at=excluded.updated_at')
    .run(wallet, used, down, up, resetEpoch, now);
  return sendJson(res, 200, { usedBytes: used, downBytes: down, upBytes: up, resetEpoch });
}

function handleUsageGet(req, res, url) {
  const wallet = url.searchParams.get('wallet') || '';
  if (!isPubkey(wallet)) return sendJson(res, 400, { error: 'invalid wallet' });
  const now = Date.now();
  const row = db.prepare('SELECT * FROM usage WHERE wallet = ?').get(wallet);
  if (!row) return sendJson(res, 200, { usedBytes: 0, downBytes: 0, upBytes: 0, resetEpoch: 0 });
  if (row.reset_epoch && now >= row.reset_epoch) {
    const resetEpoch = now + USAGE_WINDOW_MS;
    db.prepare('UPDATE usage SET used_bytes=0, down_bytes=0, up_bytes=0, reset_epoch=?, updated_at=? WHERE wallet=?').run(resetEpoch, now, wallet);
    return sendJson(res, 200, { usedBytes: 0, downBytes: 0, upBytes: 0, resetEpoch });
  }
  return sendJson(res, 200, { usedBytes: Number(row.used_bytes) || 0, downBytes: Number(row.down_bytes) || 0, upBytes: Number(row.up_bytes) || 0, resetEpoch: row.reset_epoch || 0 });
}

export async function paymentHandler(req, res, url, pathname) {
  if (!pathname.startsWith('/api/v1/payment/')) return false;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
    res.end();
    return true;
  }
  try {
    if (pathname === '/api/v1/payment/prepare' && req.method === 'POST') { await handlePrepare(req, res); return true; }
    if (pathname === '/api/v1/payment/quote' && req.method === 'POST') { await handleQuote(req, res); return true; }
    if (pathname === '/api/v1/payment/transaction' && req.method === 'POST') { await handleTransaction(req, res); return true; }
    if (pathname === '/api/v1/payment/verify' && req.method === 'POST') { await handleVerify(req, res); return true; }
    if (pathname === '/api/v1/payment/status' && req.method === 'GET') { handleStatus(req, res, url); return true; }
    if (pathname === '/api/v1/payment/redeem' && req.method === 'POST') { await handleRedeem(req, res); return true; }
    if (pathname === '/api/v1/payment/balance' && req.method === 'GET') { await handleBalance(req, res, url); return true; }
    if (pathname === '/api/v1/payment/broadcast' && req.method === 'POST') { await handleBroadcast(req, res); return true; }
    if (pathname === '/api/v1/payment/usage' && req.method === 'POST') { await handleUsageReport(req, res); return true; }
    if (pathname === '/api/v1/payment/usage' && req.method === 'GET') { handleUsageGet(req, res, url); return true; }
  } catch (e) {
    sendJson(res, 500, { error: 'payment_internal', detail: String(e?.message || e) });
    return true;
  }
  sendJson(res, 404, { error: 'Not found' });
  return true;
}


// ─────────────────────────────────────────────────────────────────────────────
// Background payment reconciliation (added 2026-06-22).
// A confirmed on-chain payment only activated a subscription if the CLIENT completed
// /verify. If the client polled before the tx confirmed (202 pending) and then the quote
// TTL'd out, a real payment that reached the treasury was silently lost. This loop scans
// recent unused quotes, finds the matching confirmed transfer via the Solana-Pay reference
// key, and runs the SAME validation + activation as /verify. Idempotent via the quote
// `used` flag and the used_txids primary key, and it can only ever activate against a real
// confirmed transfer to the treasury for the quote's exact amount.
// ─────────────────────────────────────────────────────────────────────────────
const RECONCILE_INTERVAL_MS = 30_000;
const RECONCILE_LOOKBACK_MS = 2 * 60 * 60 * 1000; // payments confirm in seconds; 2h is ample slack
let _reconcileRunning = false;

async function reconcilePendingPayments() {
  if (_reconcileRunning) return; // never overlap ticks
  _reconcileRunning = true;
  try {
    const since = Date.now() - RECONCILE_LOOKBACK_MS;
    const pending = db.prepare(
      'SELECT * FROM quotes WHERE used = 0 AND reference_pubkey IS NOT NULL AND created_at > ? ORDER BY created_at DESC LIMIT 25'
    ).all(since);
    if (!pending.length) return;
    const conn = new Connection(heliusRpcUrl(), 'confirmed');
    for (const quote of pending) {
      try {
        const sigs = await conn.getSignaturesForAddress(new PublicKey(quote.reference_pubkey), { limit: 12 });
        for (const s of sigs) {
          if (s.err) continue;
          if (db.prepare('SELECT 1 FROM used_txids WHERE txid = ?').get(s.signature)) continue;
          const cand = await getTransaction(s.signature);
          if (!cand || cand.meta?.err || !walletSigned(cand, quote.wallet)) continue;
          const ok = quote.currency === 'USDC'
            ? verifyUsdcTransfer(cand, quote.amount_raw)
            : verifySolTransfer(cand, quote.amount_raw);
          if (!ok) continue;
          // Re-check the quote wasn't activated by a concurrent /verify between SELECT and now.
          const fresh = db.prepare('SELECT used FROM quotes WHERE quote_id = ?').get(quote.quote_id);
          if (!fresh || fresh.used) break;
          const now = Date.now();
          const months = Number(quote.months) || 1;
          const extendDays = Number(quote.days) || months * DAYS_PER_MONTH;
          const sub = db.prepare('SELECT * FROM subscriptions WHERE wallet = ?').get(quote.wallet);
          const base = sub && sub.expire_at > now ? sub.expire_at : now;
          const expireAt = base + extendDays * 86_400_000;
          db.prepare('INSERT INTO subscriptions (wallet,tier,expire_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET tier=excluded.tier, expire_at=excluded.expire_at, updated_at=excluded.updated_at')
            .run(quote.wallet, quote.tier, expireAt, now);
          db.prepare('UPDATE quotes SET used = 1 WHERE quote_id = ?').run(quote.quote_id);
          db.prepare('INSERT OR IGNORE INTO used_txids (txid,wallet,quote_id,used_at) VALUES (?,?,?,?)').run(s.signature, quote.wallet, quote.quote_id, now);
          console.log(`[payment-reconcile] ACTIVATED wallet=${quote.wallet} tier=${quote.tier} txid=${s.signature} quote=${quote.quote_id} expire=${new Date(expireAt).toISOString()}`);
          break;
        }
      } catch (e) {
        console.warn(`[payment-reconcile] quote ${quote.quote_id} scan error: ${e?.message || e}`);
      }
    }
  } catch (e) {
    console.warn(`[payment-reconcile] tick error: ${e?.message || e}`);
  } finally {
    _reconcileRunning = false;
  }
}

const _reconcileTimer = setInterval(reconcilePendingPayments, RECONCILE_INTERVAL_MS);
if (_reconcileTimer && typeof _reconcileTimer.unref === 'function') _reconcileTimer.unref();
const _reconcileKick = setTimeout(reconcilePendingPayments, 5_000);
if (_reconcileKick && typeof _reconcileKick.unref === 'function') _reconcileKick.unref();
console.log('[payment-reconcile] background reconciliation loop armed (30s interval)');
