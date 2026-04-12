/* eslint-disable react-refresh/only-export-components */
/**
 * Shared components and utilities for Prism Scanner & Arena pages.
 * Single source of truth — no duplicates in Compare/Scanner/Arena.
 */

import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { getHeliusProxyUrl } from '@/constants';
import type { WalletTraits } from '@/hooks/useWalletData';

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
      const r = await fetch(`${base}/api/sybil/analysis?address=${address}`);
      if (!r.ok) return null;
      const data = await r.json();
      if (data?.riskScore !== undefined) {
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

async function _fetchWalletPreviewImpl(address: string): Promise<WalletPreview | null> {
  try {
    const base = getApiBase();
    const [repRes, dbRes] = await Promise.all([
      fetch(`${base}/api/reputation?address=${address}`),
      fetch(`${base}/api/wallet-database?address=${address}`).catch(() => null),
    ]);
    if (!repRes.ok) return null;
    const data = await repRes.json();
    let compositeScore = 0;
    let compositeTier = '';
    let compositeBadgeCount = 0;
    let compositeBreakdown: CompositeBreakdown = { onchain: 0, sybilTrust: 0, humanProof: 0, social: 0, engagement: 0 };
    if (dbRes?.ok) {
      try {
        const db = await dbRes.json();
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
    return {
      address: data.address,
      score: data.score,
      tier: data.tier,
      badges: data.badges ?? [],
      solBalance: data.stats?.solBalance ?? 0,
      txCount: data.stats?.txCount ?? 0,
      walletAgeDays: data.stats?.walletAgeDays ?? 0,
      tokenCount: data.stats?.tokenCount ?? 0,
      nftCount: data.stats?.nftCount ?? 0,
      trustGrade: data.trustGrade ?? null,
      trustScore: data.trustScore ?? null,
      riskLevel: data.riskLevel ?? null,
      sybilVerdict: data.sybilVerdict ?? null,
      topPrograms: data.topPrograms ?? [],
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

/** Get raw JWT token from session (no address check). For API calls. */
export function getSessionJwt(): string | null {
  try {
    const raw = sessionStorage.getItem('ip_auth_jwt');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; expiresAt: number };
    if (parsed.expiresAt > Date.now() + 60_000) return parsed.token;
    sessionStorage.removeItem('ip_auth_jwt');
  } catch {
    /* ignore */
  }
  return null;
}

export function getCachedJwt(address: string): string | null {
  try {
    const raw = sessionStorage.getItem('ip_auth_jwt');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; address: string; expiresAt: number };
    if (parsed.address !== address) return null;
    if (parsed.expiresAt > Date.now() + 60_000) return parsed.token;
    sessionStorage.removeItem('ip_auth_jwt');
  } catch {
    /* ignore */
  }
  return null;
}

let _jwtInFlight: Promise<string | null> | null = null;
let _lastChallengeTs = 0;

export async function obtainJwt(wallet: {
  publicKey?: { toBase58(): string } | null;
  signMessage?: (msg: Uint8Array) => Promise<Uint8Array>;
}): Promise<string | null> {
  const address = wallet.publicKey?.toBase58();
  if (!address || !wallet.signMessage) return null;

  const existing = getCachedJwt(address);
  if (existing) return existing;

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
      // Re-check cache (another caller may have resolved between our check and lock)
      const cached = getCachedJwt(address);
      if (cached) return cached;

      const base = getApiBase();
      _lastChallengeTs = Date.now();
      const challengeRes = await fetch(`${base}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!challengeRes.ok) return null;
      const { nonce, message } = (await challengeRes.json()) as { nonce: string; message: string };

      const msgBytes = new TextEncoder().encode(message);
      const signatureBytes = await wallet.signMessage!(msgBytes);
      const sigArr =
        signatureBytes instanceof Uint8Array ? signatureBytes : new Uint8Array(signatureBytes as ArrayLike<number>);
      const signatureHex = Array.from(sigArr, (b: number) => b.toString(16).padStart(2, '0')).join('');

      const tokenRes = await fetch(`${base}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, nonce, signature: signatureHex }),
      });
      if (!tokenRes.ok) return null;
      const { token } = (await tokenRes.json()) as { token: string };

      const entry = { token, address, expiresAt: Date.now() + 23 * 60 * 60 * 1000 }; // 23h (server = 24h)
      try {
        sessionStorage.setItem('ip_auth_jwt', JSON.stringify(entry));
      } catch {
        /* ignore */
      }
      return token;
    } catch {
      return null;
    } finally {
      _jwtInFlight = null;
    }
  })();

  return _jwtInFlight;
}

// ── Global wallet ref for auto-JWT in apiCall ──

type AuthWalletRef = {
  publicKey?: { toBase58(): string } | null;
  signMessage?: (msg: Uint8Array) => Promise<Uint8Array>;
};

let _authWallet: AuthWalletRef | null = null;

/** Store wallet ref so apiCall can auto-obtain JWT when needed. */
export function setAuthWallet(w: AuthWalletRef | null): void {
  _authWallet = w;
}

/** Try to get a valid JWT, auto-obtaining if wallet is available. */
export async function ensureJwt(): Promise<string | null> {
  const existing = getSessionJwt();
  if (existing) return existing;
  if (!_authWallet) return null;
  return obtainJwt(_authWallet);
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
