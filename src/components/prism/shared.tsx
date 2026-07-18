/* eslint-disable react-refresh/only-export-components */
/**
 * Shared components and utilities for Prism Scanner & Arena pages.
 * Single source of truth — no duplicates in Compare/Scanner/Arena.
 */

import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getHeliusProxyUrl } from '@/constants';
import type { WalletTraits } from '@/hooks/useWalletData';
import { readPreferredMobileWalletAddress } from '@/lib/mobileWalletAddressPreference';
import { verdictFromScore } from '@/lib/sybilVerdict';

// Import + re-export canonical tier constants
import { TIER_HEX, TIER_LABELS, TIER_COLORS_TW, TIER_ICONS, getTierIcon } from '@/lib/constants/tierColors';
export { TIER_HEX, TIER_LABELS, TIER_COLORS_TW, TIER_ICONS, getTierIcon };
export { TIER_COLORS_TW as TIER_TEXT_COLORS };
// Backwards-compat alias
export const TIER_COLORS_HEX = TIER_HEX;

export const TIER_BG: Record<string, string> = {
  mercury: 'from-stone-500/10 to-stone-600/5',
  mars: 'from-orange-500/10 to-red-600/5',
  venus: 'from-yellow-500/10 to-amber-600/5',
  earth: 'from-blue-500/10 to-green-600/5',
  neptune: 'from-cyan-500/10 to-blue-600/5',
  uranus: 'from-sky-500/10 to-cyan-600/5',
  saturn: 'from-amber-500/10 to-yellow-600/5',
  jupiter: 'from-orange-500/10 to-amber-600/5',
  sun: 'from-yellow-500/10 to-orange-600/5',
  binary_sun: 'from-amber-400/10 to-yellow-500/5',
};

// ── Types ──

interface TopProgram {
  programId: string;
  name: string | null;
  interactions: number;
}

export interface CompositeBreakdown {
  onchain: number; // 0-400
  sybilTrust: number; // 0-250
  humanProof: number; // 0-150
  social: number; // 0-100
  engagement: number; // 0-100
}

export interface WalletPreview {
  address: string;
  score: number;
  tier: string;
  badges: string[];
  solBalance: number;
  txCount: number;
  walletAgeDays: number;
  tokenCount: number;
  nftCount: number;
  trustGrade: string | null;
  trustScore: number | null;
  riskLevel: string | null;
  sybilVerdict?: SybilVerdictSummary | null;
  topPrograms: TopProgram[];
  compositeScore: number;
  compositeTier: string;
  compositeBadgeCount: number;
  compositeBreakdown: CompositeBreakdown;
}

export interface CompareRow {
  label: string;
  valueA: string | number;
  valueB: string | number;
  numA: number;
  numB: number;
  higherIsBetter: boolean;
}

// ── API base ──

export function getApiBase(): string {
  const proxy = getHeliusProxyUrl();
  if (proxy) return proxy;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

function isRetryableNativeHttpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /timeout|timed\s*out|SocketTimeoutException|ECONN|ETIMEDOUT|network|connection|Failed to fetch/i.test(message);
}

async function browserFetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const onAbort = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort();
    else upstreamSignal.addEventListener('abort', onAbort, { once: true });
  }
  const fetchPromise = (async () => {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const bodyText = await response.text();
    return new Response(bodyText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  })();
  fetchPromise.catch(() => undefined);
  try {
    return await Promise.race([
      fetchPromise,
      new Promise<Response>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`fetch timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (upstreamSignal) upstreamSignal.removeEventListener('abort', onAbort);
  }
}

export async function fetchApiJson<T = unknown>(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  // GET-only and idempotent → safe to retry. The device's FIRST request over Cloudflare
  // intermittently hits an SSL connection-reset (net_error -101) which otherwise left
  // pages stuck on skeletons / feeling slow (Leaderboard, Arena, League). Retry heals it.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchApiJsonOnce<T>(url, options);
    } catch (e) {
      lastErr = e;
      if (options.signal?.aborted) throw e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function fetchApiJsonOnce<T = unknown>(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  if (Capacitor.isNativePlatform()) {
    try {
      const response = await CapacitorHttp.get({
        url,
        headers: { Accept: 'application/json', ...options.headers },
        responseType: 'json',
        connectTimeout: options.timeoutMs ?? 3_500,
        readTimeout: options.timeoutMs ?? 4_500,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`API ${response.status}`);
      }
      return response.data as T;
    } catch (error) {
      if (!isRetryableNativeHttpError(error)) throw error;
      console.warn('[fetchApiJson] CapacitorHttp failed; falling back to fetch', url, error);
      const response = await browserFetchWithTimeout(url, {
        headers: { Accept: 'application/json', ...options.headers },
        signal: options.signal,
      }, options.timeoutMs ?? 8_000);
      if (!response.ok) throw new Error(`API ${response.status}`);
      return response.json() as Promise<T>;
    }
  }

  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 4_500);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...options.headers },
    signal,
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

export async function postApiJson<T = unknown>(
  url: string,
  body: unknown,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...options.headers };
  const bodyText = JSON.stringify(body);
  if (Capacitor.isNativePlatform()) {
    const nativeTimeoutMs = Math.min(options.timeoutMs ?? 12_000, 12_000);
    try {
      const response = await CapacitorHttp.request({
        url,
        method: 'POST',
        headers,
        data: bodyText,
        responseType: 'json',
        connectTimeout: Math.min(nativeTimeoutMs, 5_000),
        readTimeout: nativeTimeoutMs,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`API ${response.status}`);
      }
      return response.data as T;
    } catch (error) {
      if (!isRetryableNativeHttpError(error)) throw error;
      console.warn('[postApiJson] CapacitorHttp failed; falling back to fetch', url, error);
      const response = await browserFetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: bodyText,
      }, options.timeoutMs ?? 25_000);
      console.warn('[postApiJson] fallback fetch responded', url, response.status);
      if (!response.ok) throw new Error(`API ${response.status}`);
      return response.json() as Promise<T>;
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: bodyText,
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

// ── Shared sybil analysis fetch (deduped + cached) ──
export interface SybilVerdictEvidence {
  flaggedSignals: number;
  strongNetworkCount: number;
  supportingNetworkCount: number;
  strongBehaviorCount: number;
  supportingBehaviorCount: number;
  positiveIdentityCount: number;
}

export interface SybilVerdictSummary {
  key: 'unknown' | 'clean' | 'suspicious' | 'cluster_linked' | 'probable_sybil' | 'confirmed_sybil';
  label: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high' | 'very_high';
  confidenceScore: number;
  basis: 'insufficient_data' | 'organic' | 'network' | 'hybrid' | 'behavioral';
  dataQuality: 'none' | 'thin' | 'sampled' | 'rich';
  networkConfirmed: boolean;
  legacySybilFlag: boolean;
  bountyEligible: boolean;
  rewardPath: 'scan_wallet' | 'sybil_hunt';
  reasons: string[];
  evidence: SybilVerdictEvidence;
}

export interface SybilResult {
  riskScore: number;
  riskLevel: string;
  trustScore: number;
  trustGrade: string;
  signals?: unknown[];
  metrics?: unknown;
  verdict?: SybilVerdictSummary | null;
  [key: string]: unknown;
}
const _sybilCache = new Map<string, { data: SybilResult; ts: number }>();
const _sybilInflight = new Map<string, Promise<SybilResult | null>>();

export function fetchSybilAnalysis(address: string): Promise<SybilResult | null> {
  // Check client cache (5 min)
  const cached = _sybilCache.get(address);
  if (cached && Date.now() - cached.ts < 300_000) return Promise.resolve(cached.data);
  // Dedup in-flight
  const existing = _sybilInflight.get(address);
  if (existing) return existing;
  const p = (async (): Promise<SybilResult | null> => {
    try {
      const base = getApiBase();
      const data = await fetchApiJson<SybilResult>(`${base}/api/sybil/analysis?address=${address}`);
      if (data?.riskScore !== undefined) {
        data.verdict = data.verdict
          ? { ...data.verdict, label: verdictFromScore(Number(data.riskScore) || 0) }
          : data.verdict;
        _sybilCache.set(address, { data, ts: Date.now() });
        return data as SybilResult;
      }
      return null;
    } catch {
      return null;
    }
  })().finally(() => {
    _sybilInflight.delete(address);
  });
  _sybilInflight.set(address, p);
  return p;
}

// ── Fetch wallet preview (reputation + wallet-database in parallel) ──
// Request deduplication: if same address is already being fetched, reuse the in-flight promise
const _inflightPreviews = new Map<string, Promise<WalletPreview | null>>();

export function fetchWalletPreview(address: string): Promise<WalletPreview | null> {
  const existing = _inflightPreviews.get(address);
  if (existing) return existing;
  const p = _fetchWalletPreviewImpl(address).finally(() => {
    _inflightPreviews.delete(address);
  });
  _inflightPreviews.set(address, p);
  return p;
}

// Retrying raw fetch (returns a Response). GET-only/idempotent → safe. Heals the device's
// intermittent Cloudflare SSL connection-reset on the first request. Does NOT retry 4xx.
async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || (r.status >= 400 && r.status < 500)) return r;
      last = new Error(`HTTP ${r.status}`);
    } catch (e) {
      last = e;
    }
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  throw last;
}

async function _fetchWalletPreviewImpl(address: string): Promise<WalletPreview | null> {
  try {
    const base = getApiBase();
    // Use CapacitorHttp-based fetchApiJson (native + retrying), NOT raw WebView fetch (which
    // intermittently SSL-resets from capacitor://localhost on-device).
    //
    // Ship-stats only need `compositeBreakdown`, which comes from the FAST /api/wallet-database.
    // /api/reputation runs a full sybil-scan (~12s cold on a busy wallet) and only ENRICHES
    // sybil-specific fields (trustGrade/verdict/topPrograms) — so don't block the preview on it.
    // Fetch both in parallel, await the fast wallet-database, then give reputation a short grace
    // window (it's usually cached/fast). If the slow cold-scan is still running, build the
    // preview from wallet-database alone — ship-stats render in ~1-2s instead of waiting ~12s.
    const repPromise = fetchApiJson<any>(`${base}/api/reputation?address=${address}`, { timeoutMs: 20_000 })
      .catch(() => null);
    const db = await fetchApiJson<any>(`${base}/api/wallet-database?address=${address}`, { timeoutMs: 12_000 })
      .catch(() => null);
    const data: any = await Promise.race([
      repPromise,
      new Promise<null>((resolve) => { setTimeout(() => resolve(null), 1200); }),
    ]);
    if (!data && !db) return null;
    let compositeScore = 0;
    let compositeTier = '';
    let compositeBadgeCount = 0;
    let compositeBreakdown: CompositeBreakdown = { onchain: 0, sybilTrust: 0, humanProof: 0, social: 0, engagement: 0 };
    if (db) {
      try {
        const comp = db.composite;
        compositeScore = comp?.compositeScore ?? db.compositeScore ?? 0;
        compositeTier = comp?.compositeTier ?? db.compositeTier ?? 'mercury';
        compositeBadgeCount = comp?.badgeCount ?? db.badgeCount ?? 0;
        const bd = comp?.breakdown ?? db.breakdown;
        if (bd) {
          compositeBreakdown = {
            onchain: bd.onchain ?? 0,
            sybilTrust: bd.sybilTrust ?? 0,
            humanProof: bd.humanProof ?? 0,
            social: bd.social ?? 0,
            engagement: bd.engagement ?? 0,
          };
        }
      } catch {
        /* ignore */
      }
    }
    // Prefer reputation (`data`, richer) when available; fall back to wallet-database (`db`)
    // for every field so a db-only fast-path preview is still fully populated.
    const dbStats = db?.stats ?? {};
    const dbSybil = db?.sybil ?? {};
    return {
      address: data?.address ?? db?.address ?? address,
      score: data?.score ?? db?.score ?? compositeScore,
      tier: data?.tier ?? db?.tier ?? compositeTier ?? 'mercury',
      badges: data?.badges ?? db?.badges ?? [],
      solBalance: data?.stats?.solBalance ?? dbStats.solBalance ?? 0,
      txCount: data?.stats?.txCount ?? dbStats.txCount ?? 0,
      walletAgeDays: data?.stats?.walletAgeDays ?? dbStats.walletAgeDays ?? 0,
      tokenCount: data?.stats?.tokenCount ?? dbStats.tokenCount ?? 0,
      nftCount: data?.stats?.nftCount ?? dbStats.nftCount ?? 0,
      trustGrade: data?.trustGrade ?? dbSybil.trustGrade ?? null,
      trustScore: data?.trustScore ?? dbSybil.trustScore ?? null,
      riskLevel: data?.riskLevel ?? dbSybil.riskLevel ?? null,
      sybilVerdict: data?.sybilVerdict ?? dbSybil.verdict ?? dbSybil.sybilVerdict ?? null,
      topPrograms: data?.topPrograms ?? db?.topPrograms ?? [],
      compositeScore,
      compositeTier,
      compositeBadgeCount,
      compositeBreakdown,
    };
  } catch {
    return null;
  }
}

// ── Cached wallet preview (reads from sessionStorage synchronously) ──

export function getCachedWalletPreview(address: string): WalletPreview | null {
  try {
    const raw = sessionStorage.getItem(`ip_composite_v2_${address}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > 5 * 60 * 1000 || !data?.breakdown) return null;
    return {
      address,
      score: data.score ?? 0,
      tier: data.tier ?? 'mercury',
      badges: [],
      solBalance: 0,
      txCount: 0,
      walletAgeDays: 0,
      tokenCount: 0,
      nftCount: 0,
      trustGrade: null,
      trustScore: null,
      riskLevel: null,
      sybilVerdict: null,
      topPrograms: [],
      compositeScore: data.score ?? 0,
      compositeTier: data.tier ?? 'mercury',
      compositeBadgeCount: 0,
      compositeBreakdown: data.breakdown,
    };
  } catch {
    return null;
  }
}

// ── Build compare rows ──

export function buildCompareRows(a: WalletTraits, b: WalletTraits): CompareRow[] {
  return [
    {
      label: 'SOL Balance',
      valueA: a.solBalance.toFixed(2),
      valueB: b.solBalance.toFixed(2),
      numA: a.solBalance,
      numB: b.solBalance,
      higherIsBetter: true,
    },
    {
      label: 'Wallet Age',
      valueA: `${a.walletAgeDays}d`,
      valueB: `${b.walletAgeDays}d`,
      numA: a.walletAgeDays,
      numB: b.walletAgeDays,
      higherIsBetter: true,
    },
    {
      label: 'Transactions',
      valueA: a.txCount.toLocaleString(),
      valueB: b.txCount.toLocaleString(),
      numA: a.txCount,
      numB: b.txCount,
      higherIsBetter: true,
    },
    { label: 'NFTs', valueA: a.nftCount, valueB: b.nftCount, numA: a.nftCount, numB: b.nftCount, higherIsBetter: true },
    {
      label: 'Tokens',
      valueA: a.uniqueTokenCount,
      valueB: b.uniqueTokenCount,
      numA: a.uniqueTokenCount,
      numB: b.uniqueTokenCount,
      higherIsBetter: true,
    },
    {
      label: 'Total Assets',
      valueA: a.totalAssetsCount,
      valueB: b.totalAssetsCount,
      numA: a.totalAssetsCount,
      numB: b.totalAssetsCount,
      higherIsBetter: true,
    },
    {
      label: 'Avg Tx/Day',
      valueA: a.avgTxPerDay30d.toFixed(1),
      valueB: b.avgTxPerDay30d.toFixed(1),
      numA: a.avgTxPerDay30d,
      numB: b.avgTxPerDay30d,
      higherIsBetter: true,
    },
  ];
}

// ── MiniPlanet ──

export function MiniPlanet({ tier, size = 32 }: { tier: string; size?: number }) {
  const icon = getTierIcon(tier);
  const color = TIER_HEX[tier] || '#60a5fa';
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <img
        src={icon}
        alt={tier}
        width={size}
        height={size}
        className="w-full h-full object-contain"
        style={{ filter: `drop-shadow(0 0 ${size * 0.2}px ${color}60)` }}
        loading="lazy"
      />
    </div>
  );
}

// ── BattleBar (unified — supports both Scanner inline and Compare detailed modes) ──

export function BattleBar({
  label,
  valA,
  valB,
  maxVal: _maxVal,
  displayA,
  displayB,
  showValues,
}: {
  label: string;
  valA: number;
  valB: number;
  maxVal?: number;
  displayA?: string;
  displayB?: string;
  showValues?: boolean;
}) {
  const total = valA + valB || 1;
  const pctA = Math.max(8, (valA / total) * 100);
  const pctB = Math.max(8, (valB / total) * 100);
  const aWins = valA > valB;
  const bWins = valB > valA;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <span className={`text-[10px] tabular-nums font-bold ${aWins ? 'text-cyan-400' : 'text-white/40'}`}>
          {displayA ?? (showValues ? valA : valA.toLocaleString())}
          {aWins && showValues && <Zap className="w-2.5 h-2.5 inline ml-0.5 text-cyan-400" />}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-white/25 font-bold">{label}</span>
        <span className={`text-[10px] tabular-nums font-bold ${bWins ? 'text-purple-400' : 'text-white/40'}`}>
          {bWins && showValues && <Zap className="w-2.5 h-2.5 inline mr-0.5 text-purple-400" />}
          {displayB ?? (showValues ? valB : valB.toLocaleString())}
        </span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.04] gap-px">
        <motion.div
          initial={{ width: '50%' }}
          animate={{ width: `${pctA}%` }}
          transition={{ delay: 0.3, duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
          className={`h-full rounded-l-full ${
            aWins
              ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.4)]'
              : 'bg-gradient-to-r from-cyan-800/50 to-cyan-700/40'
          }`}
        />
        <motion.div
          initial={{ width: '50%' }}
          animate={{ width: `${pctB}%` }}
          transition={{ delay: 0.3, duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
          className={`h-full rounded-r-full ${
            bWins
              ? 'bg-gradient-to-l from-purple-500 to-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.4)]'
              : 'bg-gradient-to-l from-purple-800/50 to-purple-700/40'
          }`}
        />
      </div>
    </div>
  );
}

// ── StatPill ──

export function StatPill({
  icon,
  label,
  value,
  color,
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
      <span className={`${color} opacity-70`}>{icon}</span>
      <span className="text-white font-bold text-xs tabular-nums">{value}</span>
      <span className="text-white/25 text-[9px] uppercase">{label}</span>
    </div>
  );
}

// ── Auth helpers ──

const AUTH_JWT_KEY = 'ip_auth_jwt';

type StoredAuthJwt = {
  token: string;
  address?: string;
  expiresAt: number;
};

function readStoredAuthJwt(): string | null {
  try {
    const sessionRaw = sessionStorage.getItem(AUTH_JWT_KEY);
    if (sessionRaw) return sessionRaw;
  } catch {
    /* ignore */
  }
  try {
    const localRaw = localStorage.getItem(AUTH_JWT_KEY);
    if (localRaw) {
      try {
        sessionStorage.setItem(AUTH_JWT_KEY, localRaw);
      } catch {
        /* ignore */
      }
      return localRaw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function storeAuthJwt(entry: StoredAuthJwt): void {
  const raw = JSON.stringify(entry);
  try {
    sessionStorage.setItem(AUTH_JWT_KEY, raw);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(AUTH_JWT_KEY, raw);
  } catch {
    /* ignore */
  }
}

export function clearAuthJwt(): void {
  try {
    sessionStorage.removeItem(AUTH_JWT_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(AUTH_JWT_KEY);
  } catch {
    /* ignore */
  }
}

/** Get raw JWT token from session (no address check). For API calls. */
export function getSessionJwt(): string | null {
  try {
    const raw = readStoredAuthJwt();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuthJwt;
    if (parsed.expiresAt > Date.now() + 60_000) return parsed.token;
    clearAuthJwt();
  } catch {
    /* ignore */
  }
  return null;
}

export function getCachedJwt(address: string): string | null {
  try {
    const raw = readStoredAuthJwt();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuthJwt;
    if (parsed.address !== address) {
      clearAuthJwt();
      return null;
    }
    if (parsed.expiresAt > Date.now() + 60_000) return parsed.token;
    clearAuthJwt();
  } catch {
    /* ignore */
  }
  return null;
}

let _jwtInFlight: Promise<string | null> | null = null;
let _lastChallengeTs = 0;
const AUTH_DEBUG_KEY = 'ip_auth_debug';
const AUTH_FETCH_TIMEOUT_MS = 15_000;
const BODYLESS_AUTH_ATTEMPTS = 3;
const BODYLESS_AUTH_TIMEOUT_MS = 6_000;
const BODYLESS_AUTH_STAGGER_MS = 450;

function writeAuthDebug(event: Record<string, unknown>): void {
  try {
    const prevRaw = sessionStorage.getItem(AUTH_DEBUG_KEY);
    const prev = prevRaw ? JSON.parse(prevRaw) : {};
    sessionStorage.setItem(
      AUTH_DEBUG_KEY,
      JSON.stringify({
        ...prev,
        ...event,
        ts: new Date().toISOString(),
      }),
    );
  } catch {
    /* ignore */
  }
}

function describeAuthError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: typeof error, message: String(error ?? '') };
}

async function fetchAuthEndpoint(url: string, init: RequestInit, timeoutMs = AUTH_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(new Error('AUTH_FETCH_TIMEOUT')), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldUseBodylessAuthTransport(url: string): boolean {
  try {
    const target = new URL(url);
    return (
      window.location.protocol === 'https:' &&
      window.location.hostname === 'localhost' &&
      target.hostname.endsWith('identityprism.xyz')
    );
  } catch {
    return false;
  }
}

async function nativeAuthEndpoint(url: string): Promise<Response | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const response = await CapacitorHttp.get({
      url,
      responseType: 'json',
      connectTimeout: 4_000,
      readTimeout: 6_000,
      headers: { Accept: 'application/json' },
    });
    const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? null);
    return new Response(data, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    writeAuthDebug({ stage: 'auth_native_failed', ...describeAuthError(error) });
    return null;
  }
}

async function postAuthEndpoint(url: string, payload: Record<string, string | undefined>): Promise<Response> {
  if (Capacitor.isNativePlatform()) {
    try {
      const response = await CapacitorHttp.post({
        url,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        data: payload,
        responseType: 'json',
        connectTimeout: 8_000,
        readTimeout: 12_000,
      });
      const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? null);
      return new Response(data, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      writeAuthDebug({ stage: 'auth_native_post_failed', ...describeAuthError(error) });
    }
  }

  if (shouldUseBodylessAuthTransport(url)) {
    const nativeTarget = new URL(url);
    Object.entries(payload).forEach(([key, value]) => {
      if (value) nativeTarget.searchParams.set(key, value);
    });
    nativeTarget.searchParams.set('_authTransport', 'native');
    const nativeResponse = await nativeAuthEndpoint(nativeTarget.toString());
    if (nativeResponse) return nativeResponse;

    const controllers: AbortController[] = [];
    let settled = false;
    const attempts = Array.from({ length: BODYLESS_AUTH_ATTEMPTS }, async (_, attempt) => {
      if (attempt > 0) {
        await sleep(BODYLESS_AUTH_STAGGER_MS * attempt);
      }
      if (settled) {
        throw new Error('AUTH_HEDGE_CANCELLED');
      }
      const target = new URL(url);
      Object.entries(payload).forEach(([key, value]) => {
        if (value) target.searchParams.set(key, value);
      });
      target.searchParams.set('_authAttempt', `${Date.now()}-${attempt}`);
      const controller = new AbortController();
      controllers.push(controller);
      const timeout = window.setTimeout(
        () => controller.abort(new Error('AUTH_FETCH_TIMEOUT')),
        BODYLESS_AUTH_TIMEOUT_MS,
      );
      try {
        const response = await fetch(target.toString(), {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        return { response, controller };
      } catch (error) {
        if (!settled) {
          writeAuthDebug({ stage: 'auth_bodyless_retry', attempt: attempt + 1, ...describeAuthError(error) });
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }
    });

    try {
      const { response, controller: winner } = await Promise.any(attempts);
      settled = true;
      controllers.forEach((controller) => {
        if (controller !== winner) controller.abort();
      });
      return response;
    } catch (error) {
      throw error instanceof AggregateError && error.errors.length > 0 ? error.errors[error.errors.length - 1] : error;
    }
  }

  return fetchAuthEndpoint(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

type WalletSignatureResult =
  | Uint8Array
  | ArrayBuffer
  | number[]
  | {
      signature?: Uint8Array | ArrayBuffer | number[];
      signedMessage?: Uint8Array | ArrayBuffer | number[];
    };

type WalletSignInResult = {
  account?: { address?: string };
  signature?: Uint8Array | ArrayBuffer | number[];
  signedMessage?: Uint8Array | ArrayBuffer | number[];
};

type WalletSignInInput = {
  domain?: string;
  address?: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
};

function toSignatureBytes(result: WalletSignatureResult): Uint8Array {
  const value =
    result && typeof result === 'object' && !(result instanceof Uint8Array) && !(result instanceof ArrayBuffer)
      ? 'signature' in result && result.signature
        ? result.signature
        : 'signedMessage' in result && result.signedMessage
          ? result.signedMessage
          : result
      : result;

  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : Array.isArray(value)
          ? new Uint8Array(value)
          : new Uint8Array(value as ArrayLike<number>);

  // Wallet-standard signedMessage can be payload+signature; Solana signatures are the last 64 bytes.
  return bytes.length > 64 ? bytes.slice(bytes.length - 64) : bytes;
}

function toBytes(value: Uint8Array | ArrayBuffer | number[] | undefined): Uint8Array {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function obtainJwt(
  wallet: {
    publicKey?: { toBase58(): string } | null;
    signMessage?: (msg: Uint8Array) => Promise<WalletSignatureResult>;
    signIn?: (input?: WalletSignInInput) => Promise<WalletSignInResult>;
    preferSignMessage?: boolean;
    authDelayMs?: number;
  },
  options?: { forceFresh?: boolean },
): Promise<string | null> {
  const address = wallet.publicKey?.toBase58();
  if (!address || (!wallet.signMessage && !wallet.signIn)) {
    writeAuthDebug({
      stage: !address ? 'missing_address' : 'missing_sign_message',
      hasAddress: Boolean(address),
      hasSignMessage: Boolean(wallet.signMessage),
      hasSignIn: Boolean(wallet.signIn),
    });
    return null;
  }

  if (options?.forceFresh) {
    clearAuthJwt();
  } else {
    const existing = getCachedJwt(address);
    if (existing) {
      writeAuthDebug({ stage: 'cached', address: address.slice(0, 8) });
      return existing;
    }
  }

  // Deduplicate in-flight requests — all callers share the same promise
  if (_jwtInFlight) return _jwtInFlight;

  // Client-side cooldown — but WAIT instead of returning null
  const sinceLast = Date.now() - _lastChallengeTs;
  if (sinceLast < 3_500) {
    // Wait out the cooldown then check cache (another call likely just completed)
    await new Promise((r) => setTimeout(r, 3_500 - sinceLast));
    const cached2 = getCachedJwt(address);
    if (cached2) return cached2;
    // Still in-flight from the waited call?
    if (_jwtInFlight) return _jwtInFlight;
  }

  _jwtInFlight = (async () => {
    try {
      if (wallet.authDelayMs && wallet.authDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, wallet.authDelayMs));
      }
      // Re-check cache (another caller may have resolved between our check and lock)
      if (!options?.forceFresh) {
        const cached = getCachedJwt(address);
        if (cached) return cached;
      }

      setAuthState('signing');
      const base = getApiBase();
      writeAuthDebug({ stage: 'challenge_start', address: address.slice(0, 8), base });
      _lastChallengeTs = Date.now();
      const challengeRes = await postAuthEndpoint(`${base}/api/auth/challenge`, { address });
      if (!challengeRes.ok) {
        const body = await challengeRes.text().catch(() => '');
        writeAuthDebug({ stage: 'challenge_failed', status: challengeRes.status, body: body.slice(0, 180) });
        setAuthState('declined');
        return null;
      }
      const { nonce, message } = (await challengeRes.json()) as { nonce: string; message: string };

      let signatureHex = '';
      let signedMessageBase64: string | undefined;
      const signTimeoutMs = Capacitor.isNativePlatform() ? 240_000 : wallet.preferSignMessage ? 60_000 : 45_000;
      const signTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SIGN_TIMEOUT')), signTimeoutMs),
      );

      const signWithMessage = async () => {
        if (!wallet.signMessage) throw new Error('SIGN_MESSAGE_UNAVAILABLE');
        const msgBytes = new TextEncoder().encode(message);
        writeAuthDebug({ stage: 'sign_start', messageLength: msgBytes.length, noncePrefix: nonce.slice(0, 8) });
        const signatureBytes = await Promise.race([wallet.signMessage(msgBytes), signTimeout]);
        const sigArr = toSignatureBytes(signatureBytes);
        writeAuthDebug({ stage: 'sign_done', signatureLength: sigArr.length });
        signatureHex = bytesToHex(sigArr);
      };

      if (wallet.signIn && !wallet.preferSignMessage) {
        writeAuthDebug({ stage: 'sign_in_start', noncePrefix: nonce.slice(0, 8) });
        try {
          const signedIn = await Promise.race([
            wallet.signIn({
              domain: window.location.host,
              address,
              statement: 'Sign in to Identity Prism to save progress and earn coins.',
              uri: window.location.origin,
              version: '1',
              chainId: 'solana:mainnet',
              nonce,
              issuedAt: new Date().toISOString(),
            }),
            signTimeout,
          ]);
          const sigArr = toBytes(signedIn.signature);
          const msgArr = toBytes(signedIn.signedMessage);
          if (sigArr.length !== 64 || msgArr.length === 0) {
            throw new Error('SIGN_IN_INVALID_RESULT');
          }
          signatureHex = bytesToHex(sigArr);
          signedMessageBase64 = bytesToBase64(msgArr);
          writeAuthDebug({
            stage: 'sign_in_done',
            signatureLength: sigArr.length,
            signedMessageLength: msgArr.length,
            account: signedIn.account?.address?.slice(0, 8) ?? null,
          });
        } catch (error) {
          if (!wallet.signMessage) throw error;
          writeAuthDebug({
            stage: 'sign_in_fallback',
            ...describeAuthError(error),
          });
          await signWithMessage();
        }
      } else {
        await signWithMessage();
      }

      writeAuthDebug({ stage: 'token_start' });
      let tokenRes = await postAuthEndpoint(`${base}/api/auth/token`, {
        address,
        nonce,
        signature: signatureHex,
        signedMessage: signedMessageBase64,
      });
      if (tokenRes.status === 429) {
        writeAuthDebug({ stage: 'token_rate_limited_retry', address: address.slice(0, 8) });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        tokenRes = await postAuthEndpoint(`${base}/api/auth/token`, {
          address,
          nonce,
          signature: signatureHex,
          signedMessage: signedMessageBase64,
        });
      }
      if (!tokenRes.ok) {
        setAuthState('declined');
        const body = await tokenRes.text().catch(() => '');
        writeAuthDebug({ stage: 'token_failed', status: tokenRes.status, body: body.slice(0, 180) });
        if (import.meta.env.DEV) {
          console.warn('[auth] token exchange failed', tokenRes.status, body.slice(0, 160));
        }
        return null;
      }
      const { token } = (await tokenRes.json()) as { token: string };

      const entry = { token, address, expiresAt: Date.now() + 23 * 60 * 60 * 1000 }; // 23h (server = 24h)
      storeAuthJwt(entry);
      writeAuthDebug({ stage: 'signed', address: address.slice(0, 8), expiresAt: entry.expiresAt });
      setAuthState('signed');
      return token;
    } catch (error) {
      writeAuthDebug({ stage: 'exception', ...describeAuthError(error) });
      setAuthState('declined');
      return null;
    } finally {
      _jwtInFlight = null;
    }
  })();

  return _jwtInFlight;
}

// ── SIWS one-shot via adapter.signIn() (single MWA transact session) ──
// IMPORTANT: this calls adapter.signIn() directly. On MWA/Seed Vault this triggers a SINGLE
// wallet popup that BOTH authorizes the dapp AND signs the SIWS message in one round-trip.
// Use this for the initial connect flow on Capacitor Android (Seeker) to avoid the
// well-known "second wallet popup never surfaces" bug that froze PRISM SCAN at 64%.
//
// Server-side: the matching /api/auth/token endpoint accepts a `siws: true` flag with a
// client-generated nonce (no server-stored challenge needed). The server verifies the signed
// message contains address + "Identity Prism" keyword + the supplied nonce, then burns the
// nonce to prevent replay.
export async function obtainJwtViaAdapterSignIn(adapter: {
  name?: string;
  signIn?: (input?: WalletSignInInput) => Promise<WalletSignInResult>;
  publicKey?: { toBase58(): string } | null;
}): Promise<{ token: string; address: string } | null> {
  if (typeof adapter?.signIn !== 'function') {
    writeAuthDebug({ stage: 'siws_adapter_no_signin', name: adapter?.name ?? null });
    return null;
  }

  try {
    setAuthState('signing');
    const base = getApiBase();

    // Generate a client-side nonce. Server accepts it via the `siws: true` path on /api/auth/token,
    // verifies the signed message contains it, and burns it to prevent replay.
    const clientNonce =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).padEnd(32, '0');

    const preAddress = adapter.publicKey?.toBase58?.() ?? null;
    const preferredAddress = readPreferredMobileWalletAddress();
    const requestedAddress = preferredAddress || preAddress;
    writeAuthDebug({
      stage: 'siws_calling_adapter_signin',
      hasPreAddress: Boolean(preAddress),
      preferredAddress: preferredAddress ? `${preferredAddress.slice(0, 4)}...${preferredAddress.slice(-4)}` : null,
      noncePrefix: clientNonce.slice(0, 8),
    });

    // Single wallet popup: authorize + sign-in message in one MWA transact session.
    const signedIn = await adapter.signIn({
      domain: window.location.host,
      ...(requestedAddress ? { address: requestedAddress } : {}),
      statement: 'Sign in to Identity Prism to save progress and earn coins.',
      uri: window.location.origin,
      version: '1',
      chainId: 'solana:mainnet',
      nonce: clientNonce,
      issuedAt: new Date().toISOString(),
    });

    const resolvedAddress = signedIn?.account?.address ?? adapter.publicKey?.toBase58?.() ?? preAddress;
    if (!resolvedAddress) {
      writeAuthDebug({ stage: 'siws_no_resolved_address' });
      setAuthState('declined');
      return null;
    }
    const sigArr = toBytes(signedIn.signature);
    const msgArr = toBytes(signedIn.signedMessage);
    if (sigArr.length !== 64 || msgArr.length === 0) {
      writeAuthDebug({ stage: 'siws_invalid_result', sigLen: sigArr.length, msgLen: msgArr.length });
      setAuthState('declined');
      return null;
    }
    const signatureHex = bytesToHex(sigArr);
    const signedMessageBase64 = bytesToBase64(msgArr);
    let tokenRes = await postAuthEndpoint(`${base}/api/auth/token`, {
      address: resolvedAddress,
      nonce: clientNonce,
      signature: signatureHex,
      signedMessage: signedMessageBase64,
      siws: true,
    });
    if (tokenRes.status === 429) {
      writeAuthDebug({ stage: 'siws_token_rate_limited_retry', address: resolvedAddress.slice(0, 8) });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      tokenRes = await postAuthEndpoint(`${base}/api/auth/token`, {
        address: resolvedAddress,
        nonce: clientNonce,
        signature: signatureHex,
        signedMessage: signedMessageBase64,
        siws: true,
      });
    }
    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => '');
      writeAuthDebug({ stage: 'siws_token_failed', status: tokenRes.status, body: body.slice(0, 180) });
      setAuthState('declined');
      return null;
    }
    const { token } = (await tokenRes.json()) as { token: string };
    const entry = { token, address: resolvedAddress, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
    storeAuthJwt(entry);
    try {
      const readBack = readStoredAuthJwt();
      const parsed = readBack ? (JSON.parse(readBack) as StoredAuthJwt) : null;
      writeAuthDebug({
        stage: 'siws_signed',
        address: resolvedAddress.slice(0, 8),
        addressFull: resolvedAddress,
        storedAddress: parsed?.address ?? null,
        addressMatch: parsed?.address === resolvedAddress,
        tokenLen: token.length,
        storedTokenLen: parsed?.token?.length ?? 0,
      });
    } catch {
      writeAuthDebug({ stage: 'siws_signed', address: resolvedAddress.slice(0, 8) });
    }
    try {
      window.dispatchEvent(
        new CustomEvent('identityprism:mwa-siws-connected', {
          detail: { address: resolvedAddress },
        }),
      );
    } catch {
      /* ignore */
    }
    setAuthState('signed');
    return { token, address: resolvedAddress };
  } catch (error) {
    writeAuthDebug({ stage: 'siws_exception', ...describeAuthError(error) });
    setAuthState('declined');
    return null;
  }
}

// ── Auth state listeners ──
type AuthState = 'idle' | 'signing' | 'signed' | 'declined';
let _authState: AuthState = 'idle';
const _authListeners = new Set<(s: AuthState) => void>();

export function getAuthState(): AuthState {
  return _authState;
}

export function subscribeAuthState(cb: (s: AuthState) => void): () => void {
  _authListeners.add(cb);
  return () => _authListeners.delete(cb);
}

function setAuthState(s: AuthState): void {
  _authState = s;
  for (const cb of _authListeners) {
    try {
      cb(s);
    } catch {
      /* ignore */
    }
  }
}

// ── Global wallet ref for auto-JWT in apiCall ──

type AuthWalletRef = {
  publicKey?: { toBase58(): string } | null;
  signMessage?: (msg: Uint8Array) => Promise<WalletSignatureResult>;
  signIn?: (input?: WalletSignInInput) => Promise<WalletSignInResult>;
  preferSignMessage?: boolean;
  authDelayMs?: number;
};

let _authWallet: AuthWalletRef | null = null;

/** Store wallet ref so apiCall can auto-obtain JWT when needed. */
export function setAuthWallet(w: AuthWalletRef | null): void {
  _authWallet = w;
}

/** Try to get a valid JWT, auto-obtaining if wallet is available. */
export async function ensureJwt(): Promise<string | null> {
  const sessionJwt = getSessionJwt();
  if (!_authWallet) {
    if (sessionJwt) return sessionJwt;
    writeAuthDebug({ stage: 'ensure_missing_wallet' });
    return null;
  }
  const address = _authWallet.publicKey?.toBase58();
  if (address) {
    const existing = getCachedJwt(address);
    if (existing) return existing;
  } else if (sessionJwt) {
    return sessionJwt;
  }
  return (await obtainJwt(_authWallet)) ?? sessionJwt;
}

// ── Server health check ──

let _serverAvailable: boolean | null = null;
let _serverCheckAt = 0;
const SERVER_CHECK_INTERVAL = 30_000;

export async function isServerAvailable(base: string): Promise<boolean> {
  if (_serverAvailable !== null && Date.now() - _serverCheckAt < SERVER_CHECK_INTERVAL) {
    return _serverAvailable;
  }
  try {
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({
        url: `${base}/api/challenge/list`,
        responseType: 'json',
        connectTimeout: 3_000,
        readTimeout: 3_000,
      });
      _serverAvailable = response.status < 500;
      _serverCheckAt = Date.now();
      return _serverAvailable;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${base}/api/challenge/list`, { signal: controller.signal });
    clearTimeout(timeout);
    _serverAvailable = res.ok || res.status < 500;
    _serverCheckAt = Date.now();
    return _serverAvailable;
  } catch {
    _serverAvailable = false;
    _serverCheckAt = Date.now();
    return false;
  }
}

// ── Utility helpers ──

export function formatAddr(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function formatWalletAge(days: number): string {
  if (days >= 730) return `${(days / 365).toFixed(1)}y`;
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${days}d`;
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function getBadgeCount(traits: WalletTraits): number {
  let count = 0;
  if (traits.isOG) count++;
  if (traits.isWhale) count++;
  if (traits.isCollector) count++;
  if (traits.hasCombo) count++;
  if (traits.isEarlyAdopter) count++;
  if (traits.isTxTitan) count++;
  if (traits.isSolanaMaxi) count++;
  if (traits.hasSeeker) count++;
  if (traits.hasPreorder) count++;
  if (traits.isBlueChip) count++;
  if (traits.isDeFiKing) count++;
  if (traits.isMemeLord) count++;
  if (traits.hyperactiveDegen) count++;
  if (traits.diamondHands) count++;
  return count;
}

// ── Trust grade colors ──

export const TRUST_GRADE_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  'A+': { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30' },
  A: { text: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30' },
  B: { text: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30' },
  C: { text: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30' },
  D: { text: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/30' },
  F: { text: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30' },
};

export const BADGE_LABELS: Record<string, { label: string; color: string }> = {
  og: { label: 'OG', color: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' },
  whale: { label: 'Whale', color: 'text-blue-400 border-blue-400/30 bg-blue-400/10' },
  collector: { label: 'Collector', color: 'text-purple-400 border-purple-400/30 bg-purple-400/10' },
  binary: { label: 'Binary Sun', color: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10' },
  early: { label: 'Early Adopter', color: 'text-green-400 border-green-400/30 bg-green-400/10' },
  titan: { label: 'Tx Titan', color: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
  maxi: { label: 'Solana Maxi', color: 'text-violet-400 border-violet-400/30 bg-violet-400/10' },
  seeker: { label: 'Seeker', color: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  visionary: { label: 'Visionary', color: 'text-pink-400 border-pink-400/30 bg-pink-400/10' },
};
