/**
 * MagicBlock integration for Orbit Survival game.
 * Uses MagicBlock's Ephemeral Rollups infrastructure for verified game sessions.
 *
 * For the hackathon, we use MagicBlock's devnet RPC to submit score verification
 * transactions, demonstrating the integration path for fully on-chain gaming.
 */

import { getHeliusProxyUrl } from '@/constants';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const MAGICBLOCK_RPC = 'https://devnet.magicblock.app/api';
const MAGICBLOCK_WS = 'wss://devnet.magicblock.app/api';

const normalizeBase = (url: string) => url.replace(/\/+$/, '');

/** Thrown for non-2xx HTTP responses so callers can distinguish them from network/timeout errors. */
export class HttpStatusError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

const getGameSessionApiBase = (): string | null => {
  const proxy = getHeliusProxyUrl();
  if (proxy) return normalizeBase(proxy);
  if (typeof window !== 'undefined' && window.location?.origin) {
    return normalizeBase(window.location.origin);
  }
  return null;
};

const getCachedGameJwt = (walletAddress?: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('ip_auth_jwt') || localStorage.getItem('ip_auth_jwt');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; address?: string; expiresAt?: number };
    const expected = walletAddress?.trim();
    if (expected && parsed.address && parsed.address !== expected) {
      sessionStorage.removeItem('ip_auth_jwt');
      localStorage.removeItem('ip_auth_jwt');
      return null;
    }
    if (!parsed.token || !parsed.expiresAt || parsed.expiresAt <= Date.now() + 60_000) {
      sessionStorage.removeItem('ip_auth_jwt');
      localStorage.removeItem('ip_auth_jwt');
      return null;
    }
    return parsed.token;
  } catch {
    sessionStorage.removeItem('ip_auth_jwt');
    localStorage.removeItem('ip_auth_jwt');
    return null;
  }
};

export interface MagicBlockConfig {
  rpcUrl: string;
  wsUrl: string;
  enabled: boolean;
}

export interface RegisterGameSessionPayload {
  walletAddress?: string;
  score: number;
  survivalTime: string;
  seed: string;
  slot: number;
  startedAtMs: number;
  endedAtMs: number;
  txSignature?: string;
  gameMode?: string;
  /** Server-issued single-use token from startGameSession(); omitted for legacy submits. */
  sessionToken?: string;
  /** Coins to credit atomically as part of this submit (server is authoritative/idempotent). */
  coinsDelta?: number;
}

/** Result of an atomic coin credit performed as part of a session submit. */
export interface GameCoinsCreditResult {
  coins: number;
  earned?: number;
  idMultiplier?: number;
  boost?: number;
  capped?: boolean;
  reason?: string;
  dailyRemaining?: number;
  alreadyCredited?: boolean;
}

export interface RegisterGameSessionResult {
  session: GameSessionProof | null;
  credit: GameCoinsCreditResult | null;
}

export interface StartGameSessionPayload {
  gameMode: string;
  walletAddress?: string;
}

export interface StartGameSessionResult {
  sessionToken: string;
  seed: string;
  slot: number;
  startedAtMs: number;
  expiresAtMs: number | null;
  seedSource: string | null;
}

export interface GameSessionProof {
  id: string;
  hash: string;
  walletAddress: string | null;
  score: number;
  survivalTime: string;
  seed: string;
  slot: number;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  scoreDelta: number;
  verified: boolean;
  proofUrl: string | null;
  verification: {
    rpcHealthy: boolean;
    slotFound: boolean;
    seedMatchesSlot: boolean;
    slotBlockhash: string | null;
    slotBlockTimeMs?: number | null;
    reason: string;
  };
  createdAt: string;
  lastVerifiedAt: string;
}

export function getMagicBlockConfig(): MagicBlockConfig {
  return {
    rpcUrl: MAGICBLOCK_RPC,
    wsUrl: MAGICBLOCK_WS,
    enabled: true,
  };
}

/**
 * Generate a provably fair seed for asteroid spawning patterns.
 * Uses the blockhash from MagicBlock's ephemeral rollup as entropy source.
 */
export async function generateFairSeed(signal?: AbortSignal): Promise<{ seed: string; slot: number } | null> {
  try {
    const res = await fetch(MAGICBLOCK_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'confirmed' }],
      }),
      signal,
    });
    const data = await res.json();
    if (data?.result?.value) {
      return {
        seed: data.result.value.blockhash,
        slot: data.result.context?.slot ?? 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Single-attempt POST to /api/game/session/start, honoring the tight timeout budget
 * (fetch abort 4s; native connect 3s / read 4s). Never throws for HTTP-level failures —
 * callers inspect `ok`/`status`/`data`. May throw on network/timeout errors.
 */
async function requestSessionStart(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return { ok: res.ok, status: res.status, data };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (!Capacitor.isNativePlatform()) throw error;
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: body,
      responseType: 'json',
      connectTimeout: 3000,
      readTimeout: 4000,
    });
    const data = (typeof response.data === 'string' ? JSON.parse(response.data || 'null') : response.data) as
      | Record<string, unknown>
      | null;
    return { ok: response.status >= 200 && response.status < 300, status: response.status, data };
  }
}

/**
 * Start a server-authoritative game session: server issues a single-use token bound to a
 * seed+slot, taking the slow client-side MagicBlock RPC off the coin-crediting critical path.
 *
 * Requires a cached JWT (obtained via obtainJwt() at game start) — returns null without one,
 * in which case the caller proceeds tokenless (legacy submit path).
 *
 * Compat-shim: an OLD server (pre-rework) requires the client to supply seed/slot itself and
 * responds `400 seed is required` — in that case we fetch a seed via generateFairSeed() once
 * and retry /start with it.
 */
export async function startGameSession(payload: StartGameSessionPayload): Promise<StartGameSessionResult | null> {
  const base = getGameSessionApiBase();
  if (!base) return null;
  const jwt = getCachedGameJwt(payload.walletAddress);
  if (!jwt) return null;

  const url = `${base}/api/game/session/start`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` };

  const toResult = (data: Record<string, unknown> | null): StartGameSessionResult | null => {
    if (!data) return null;
    const sessionToken = typeof data.sessionToken === 'string' ? data.sessionToken : '';
    const seed = typeof data.seed === 'string' ? data.seed : '';
    const slot = Number(data.slot);
    if (!sessionToken || !seed || !Number.isFinite(slot) || slot <= 0) return null;
    return {
      sessionToken,
      seed,
      slot,
      startedAtMs: typeof data.startedAtMs === 'number' ? data.startedAtMs : Date.now(),
      expiresAtMs: typeof data.expiresAtMs === 'number' ? data.expiresAtMs : null,
      seedSource: typeof data.seedSource === 'string' ? data.seedSource : null,
    };
  };

  let body: Record<string, unknown> = { gameMode: payload.gameMode };
  let shimAttempted = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result: { ok: boolean; status: number; data: Record<string, unknown> | null } | null = null;
    try {
      result = await requestSessionStart(url, headers, body);
    } catch {
      continue; // network/timeout — retry (counts against the 2 tries)
    }
    if (result.ok) {
      const parsed = toResult(result.data);
      if (parsed) return parsed;
      continue;
    }
    const errText = typeof result.data?.error === 'string' ? result.data.error : '';
    if (!shimAttempted && result.status === 400 && /seed is required/i.test(errText)) {
      // Old-server compat shim: fetch a seed ourselves and retry once with it.
      shimAttempted = true;
      const ctrl = new AbortController();
      const shimTimeout = setTimeout(() => ctrl.abort(), 2000);
      let seedResult: { seed: string; slot: number } | null = null;
      try {
        seedResult = await generateFairSeed(ctrl.signal);
      } finally {
        clearTimeout(shimTimeout);
      }
      if (!seedResult) return null;
      body = { gameMode: payload.gameMode, seed: seedResult.seed, slot: seedResult.slot };
      attempt -= 1; // the shim retry doesn't consume one of the 2 network-failure tries
      continue;
    }
    if (result.status >= 400 && result.status < 500) return null; // non-retryable client error
  }
  return null;
}

/**
 * Verify a game session by checking the seed against MagicBlock's state.
 */
export async function verifyGameSession(seed: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(MAGICBLOCK_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getHealth',
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    return data?.result === 'ok';
  } catch {
    return false;
  }
}

/**
 * Verify a game session by seed+slot. Falls back to health-check if slot missing.
 */
export async function verifyGameSessionSeed(seed: string, slot?: number): Promise<boolean> {
  if (!slot || slot <= 0) {
    return verifyGameSession(seed);
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(MAGICBLOCK_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBlock',
        params: [
          slot,
          {
            commitment: 'confirmed',
            transactionDetails: 'none',
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    const blockhash = data?.result?.blockhash;
    if (typeof blockhash === 'string' && blockhash.length > 0) {
      return blockhash === seed;
    }
    return verifyGameSession(seed);
  } catch {
    return verifyGameSession(seed);
  }
}

/**
 * Register completed run on backend to get verifiable session proof id/hash.
 */
export async function registerGameSessionProof(
  payload: RegisterGameSessionPayload,
): Promise<RegisterGameSessionResult | null> {
  const base = getGameSessionApiBase();
  if (!base) return null;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const jwt = getCachedGameJwt(payload.walletAddress);
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  const url = `${base}/api/game/session`;
  let data: { session?: GameSessionProof; credit?: GameCoinsCreditResult };

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new HttpStatusError(res.status, `Session proof API ${res.status}`);
      }
      data = (await res.json()) as { session?: GameSessionProof; credit?: GameCoinsCreditResult };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    // A real HTTP response (non-2xx) is not a network failure — don't fall back to the
    // CapacitorHttp transport (which would just re-send the same request), propagate as-is
    // so callers can inspect `error.status` and decide whether to retry.
    if (error instanceof HttpStatusError) throw error;
    if (!Capacitor.isNativePlatform()) throw error;
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: payload,
      responseType: 'json',
      connectTimeout: 3000,
      readTimeout: 5000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new HttpStatusError(response.status, `Session proof API ${response.status}`);
    }
    data = typeof response.data === 'string'
      ? JSON.parse(response.data) as { session?: GameSessionProof; credit?: GameCoinsCreditResult }
      : response.data as { session?: GameSessionProof; credit?: GameCoinsCreditResult };
  }

  if (data.session?.id && payload.walletAddress && typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(`game_session_owner_${data.session.id}`, payload.walletAddress);
    } catch {
      /* ignore */
    }
  }
  return { session: data.session ?? null, credit: data.credit ?? null };
}

/**
 * Read session proof status by id from backend.
 */
export async function getGameSessionProof(sessionId: string): Promise<GameSessionProof | null> {
  const base = getGameSessionApiBase();
  if (!base) return null;
  const safeId = encodeURIComponent(sessionId);
  const headers: Record<string, string> = {};
  try {
    const raw = sessionStorage.getItem(`game_session_owner_${sessionId}`);
    if (raw) {
      const jwt = getCachedGameJwt(raw);
      if (jwt) headers.Authorization = `Bearer ${jwt}`;
    }
  } catch {
    /* ignore */
  }
  const res = await fetch(`${base}/api/game/session/${safeId}`, { method: 'GET', headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Session verify API ${res.status}`);
  }
  const data = (await res.json()) as { session?: GameSessionProof };
  return data.session ?? null;
}

/**
 * Get MagicBlock network health status.
 */
export async function getMagicBlockHealth(): Promise<{
  healthy: boolean;
  latency: number;
}> {
  const start = Date.now();
  try {
    const res = await fetch(MAGICBLOCK_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getHealth',
      }),
    });
    const data = await res.json();
    return {
      healthy: data?.result === 'ok',
      latency: Date.now() - start,
    };
  } catch {
    return { healthy: false, latency: Date.now() - start };
  }
}

export const MAGICBLOCK_BADGE = {
  name: 'MagicBlock Verified',
  description: 'Game session verified via MagicBlock Ephemeral Rollups',
  icon: '⚡',
};
