/**
 * Prefetch — eagerly load data on wallet connect so pages render instantly.
 * Called once from Index.tsx when wallet address is resolved.
 *
 * Cached in sessionStorage with short TTLs. Each page checks cache first.
 */

import { getApiBase } from '@/components/prism/shared';

const TTL_BALANCE = 3 * 60 * 1000; // 3 min
const TTL_LEADER = 5 * 60 * 1000; // 5 min
const TTL_TOKENS = 5 * 60 * 1000; // 5 min

// ── Balance ──

const BAL_KEY = 'ip_prefetch_balance_';

export async function prefetchBalance(address: string): Promise<void> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/prism/balance?address=${encodeURIComponent(address)}`);
    if (!res.ok) return;
    const data = await res.json();
    sessionStorage.setItem(`${BAL_KEY}${address}`, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function getCachedBalance(address: string) {
  try {
    const raw = sessionStorage.getItem(`${BAL_KEY}${address}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > TTL_BALANCE) return null;
    return data;
  } catch {
    return null;
  }
}

/** Force-clear cached balance so next read hits the server */
export function invalidateBalanceCache(address: string) {
  try {
    sessionStorage.removeItem(`${BAL_KEY}${address}`);
  } catch {
    /* ignore */
  }
}

// ── Leaderboard ──

const LB_KEY = 'ip_prefetch_leaderboard';

export async function prefetchLeaderboard(): Promise<void> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/leaderboard?limit=50`);
    if (!res.ok) return;
    const data = await res.json();
    sessionStorage.setItem(LB_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function getCachedLeaderboard() {
  try {
    const raw = sessionStorage.getItem(LB_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > TTL_LEADER) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Token Accounts (for BlackHole) ──

const TOK_KEY = 'ip_prefetch_tokens_';

export async function prefetchTokenAccounts(address: string): Promise<void> {
  try {
    const base = getApiBase();
    // Use the RPC proxy to fetch parsed token accounts for both programs
    const body = (programId: string) =>
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getParsedTokenAccountsByOwner',
        params: [address, { programId }, { encoding: 'jsonParsed' }],
      });
    const headers = { 'Content-Type': 'application/json' };
    const [splRes, t22Res] = await Promise.all([
      fetch(`${base}/rpc`, { method: 'POST', headers, body: body('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }),
      fetch(`${base}/rpc`, { method: 'POST', headers, body: body('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') }),
    ]);
    if (!splRes.ok || !t22Res.ok) return;
    const [splData, t22Data] = await Promise.all([splRes.json(), t22Res.json()]);
    const combined = {
      spl: splData.result?.value ?? [],
      t22: t22Data.result?.value ?? [],
      ts: Date.now(),
    };
    sessionStorage.setItem(`${TOK_KEY}${address}`, JSON.stringify(combined));
  } catch {
    /* ignore */
  }
}

export function getCachedTokenAccounts(address: string) {
  try {
    const raw = sessionStorage.getItem(`${TOK_KEY}${address}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > TTL_TOKENS) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Run all prefetches ──

let _lastPrefetchAddr = '';

export function runPrefetch(address: string): void {
  if (_lastPrefetchAddr === address) return;
  _lastPrefetchAddr = address;

  // Fire-and-forget, non-blocking
  prefetchBalance(address).catch(() => {});
  prefetchLeaderboard().catch(() => {});
  // Token accounts prefetch removed — format mismatch with Connection SDK
  // useWalletData + useCompositeScore already have their own cache
}
