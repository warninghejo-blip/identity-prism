/**
 * Prism Arena — Social hub for Identity Prism v5.
 * Tabs: Explore (wallet search), Compare (inline side-by-side), Challenges (P2P challenge system).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import {
  ArrowLeft, Search, Users, Zap,
  ChevronRight, Loader2, ArrowUpDown, Trophy,
  Plus, X, Swords, Gamepad2, Target, Flame, CircleDot,
  Clock, Check, Play, Ban, Shield, Wallet, Hash,
  Layers, Image, Calendar, ExternalLink, Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getHeliusProxyUrl } from '@/constants';
import { useWalletData, calculateScore, type WalletTraits } from '@/hooks/useWalletData';

// ── Types ──

interface TopProgram {
  programId: string;
  name: string | null;
  interactions: number;
}

interface WalletPreview {
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
  topPrograms: TopProgram[];
}

// ── Sub-tabs ──

type MarketTab = 'explore' | 'compare' | 'challenges';

const TABS: { id: MarketTab; label: string; icon: typeof Search }[] = [
  { id: 'explore', label: 'Explore', icon: Search },
  { id: 'compare', label: 'Compare', icon: Users },
  { id: 'challenges', label: 'Challenges', icon: Zap },
];

// ── Tier styling ──

const TIER_COLORS: Record<string, string> = {
  mercury: '#8B8B8B', mars: '#C1440E', venus: '#E8CDA0', earth: '#4B9CD3',
  neptune: '#3F54BE', uranus: '#73C2FB', saturn: '#E8D191', jupiter: '#C88B3A',
  sun: '#FFD700', binary_sun: '#22D3EE',
};

const TIER_LABELS: Record<string, string> = {
  mercury: 'MERCURY', mars: 'MARS', venus: 'VENUS', earth: 'EARTH',
  neptune: 'NEPTUNE', uranus: 'URANUS', saturn: 'SATURN', jupiter: 'JUPITER',
  sun: 'SUN', binary_sun: 'BINARY SUN',
};

// Compare tab: tailwind-based tier colors (text classes)
const TIER_TEXT_COLORS: Record<string, string> = {
  mercury: 'text-stone-300', mars: 'text-orange-400', venus: 'text-yellow-300',
  earth: 'text-blue-400', neptune: 'text-cyan-400', uranus: 'text-sky-300',
  saturn: 'text-amber-300', jupiter: 'text-orange-300', sun: 'text-yellow-400',
  binary_sun: 'text-amber-400',
};

const TIER_BG: Record<string, string> = {
  mercury: 'from-stone-500/10 to-stone-600/5', mars: 'from-orange-500/10 to-red-600/5',
  venus: 'from-yellow-500/10 to-amber-600/5', earth: 'from-blue-500/10 to-green-600/5',
  neptune: 'from-cyan-500/10 to-blue-600/5', uranus: 'from-sky-500/10 to-cyan-600/5',
  saturn: 'from-amber-500/10 to-yellow-600/5', jupiter: 'from-orange-500/10 to-amber-600/5',
  sun: 'from-yellow-500/10 to-orange-600/5', binary_sun: 'from-amber-400/10 to-yellow-500/5',
};

// ── API ──

function getApiBase(): string {
  const proxy = getHeliusProxyUrl();
  if (proxy) return proxy;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

async function fetchWalletPreview(address: string): Promise<WalletPreview | null> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/reputation?address=${address}`);
    if (!res.ok) return null;
    const data = await res.json();
    // Server returns stats nested in a `stats` object — flatten for our interface
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
      topPrograms: data.topPrograms ?? [],
    };
  } catch { return null; }
}

// ── Compare helpers ──

interface CompareRow {
  label: string;
  valueA: string | number;
  valueB: string | number;
  numA: number;
  numB: number;
  higherIsBetter: boolean;
}

function buildCompareRows(a: WalletTraits, b: WalletTraits): CompareRow[] {
  return [
    { label: 'SOL Balance', valueA: a.solBalance.toFixed(2), valueB: b.solBalance.toFixed(2), numA: a.solBalance, numB: b.solBalance, higherIsBetter: true },
    { label: 'Wallet Age', valueA: `${a.walletAgeDays}d`, valueB: `${b.walletAgeDays}d`, numA: a.walletAgeDays, numB: b.walletAgeDays, higherIsBetter: true },
    { label: 'Transactions', valueA: a.txCount.toLocaleString(), valueB: b.txCount.toLocaleString(), numA: a.txCount, numB: b.txCount, higherIsBetter: true },
    { label: 'NFTs', valueA: a.nftCount, valueB: b.nftCount, numA: a.nftCount, numB: b.nftCount, higherIsBetter: true },
    { label: 'Tokens', valueA: a.uniqueTokenCount, valueB: b.uniqueTokenCount, numA: a.uniqueTokenCount, numB: b.uniqueTokenCount, higherIsBetter: true },
    { label: 'Total Assets', valueA: a.totalAssetsCount, valueB: b.totalAssetsCount, numA: a.totalAssetsCount, numB: b.totalAssetsCount, higherIsBetter: true },
    { label: 'Avg Tx/Day', valueA: a.avgTxPerDay30d.toFixed(1), valueB: b.avgTxPerDay30d.toFixed(1), numA: a.avgTxPerDay30d, numB: b.avgTxPerDay30d, higherIsBetter: true },
  ];
}

function getBadgeCount(traits: WalletTraits): number {
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

function formatAddr(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function WinIndicator({ isWinner }: { isWinner: boolean }) {
  if (!isWinner) return null;
  return <span className="ml-1 text-green-400 text-[10px] font-bold">▲</span>;
}

// ── Trust grade helpers ──

const TRUST_GRADE_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  'A+': { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30' },
  'A':  { text: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30' },
  'B':  { text: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30' },
  'C':  { text: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30' },
  'D':  { text: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/30' },
  'F':  { text: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30' },
};

const BADGE_LABELS: Record<string, { label: string; color: string }> = {
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

function formatWalletAge(days: number): string {
  if (days >= 730) return `${(days / 365).toFixed(1)}y`;
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${days}d`;
}

// ── Explore Tab ──

function ExploreTab({ myAddress }: { myAddress: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WalletPreview | null>(null);
  const [error, setError] = useState('');

  const handleSearch = useCallback(async () => {
    const addr = query.trim();
    if (!addr || addr.length < 32) {
      setError('Enter a valid Solana wallet address');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);

    const data = await fetchWalletPreview(addr);
    setLoading(false);
    if (!data) {
      setError('Could not load wallet data');
      return;
    }
    setResult(data);

    // Quest tracking
    if (myAddress) {
      import('@/lib/prismQuests').then(({ getQuestState, incrementQuest }) => {
        const qs = getQuestState(myAddress);
        incrementQuest(qs, 'daily_explore');
      }).catch(() => {});
    }
  }, [query, myAddress]);

  const tierColor = result ? (TIER_COLORS[result.tier] ?? '#888') : '#888';
  const gradeStyle = result?.trustGrade ? (TRUST_GRADE_COLORS[result.trustGrade] ?? TRUST_GRADE_COLORS['C']) : null;

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Enter any Solana wallet address..."
            className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={loading}
          className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Scan'}
        </Button>
      </div>

      {error && <p className="text-red-400 text-sm text-center">{error}</p>}

      {/* Rich result card */}
      {result && (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* ── Header: Score + Tier + Trust Grade ── */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${tierColor}08, transparent 60%)`,
              borderColor: `${tierColor}25`,
            }}
          >
            {/* Score banner */}
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-white/40 text-xs font-mono mb-1">
                    {result.address.slice(0, 6)}...{result.address.slice(-4)}
                  </p>
                  <p className="font-bold text-xl" style={{ color: tierColor }}>
                    {TIER_LABELS[result.tier] ?? result.tier.toUpperCase()}
                  </p>
                  <p className="text-white/25 text-[10px] tracking-widest mt-0.5">IDENTITY TIER</p>
                </div>
                <div className="text-right">
                  <p className="text-4xl font-black text-white tabular-nums">{result.score}</p>
                  <p className="text-white/25 text-[10px] tracking-widest">/ 1400</p>
                </div>
              </div>

              {/* Score bar */}
              <div className="mt-3 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, (result.score / 1400) * 100)}%`,
                    background: `linear-gradient(90deg, ${tierColor}80, ${tierColor})`,
                  }}
                />
              </div>
            </div>

            {/* Trust + Badges row */}
            <div className="px-5 py-3 border-t border-white/[0.04] flex items-center gap-3 flex-wrap">
              {/* Trust Grade */}
              {gradeStyle && (
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${gradeStyle.bg} ${gradeStyle.border}`}>
                  <Shield className={`w-3.5 h-3.5 ${gradeStyle.text}`} />
                  <span className={`text-xs font-bold ${gradeStyle.text}`}>Trust {result.trustGrade}</span>
                  {result.trustScore !== null && (
                    <span className="text-[10px] text-white/25 ml-0.5">({result.trustScore}%)</span>
                  )}
                </div>
              )}

              {/* Badges */}
              {result.badges.length > 0 && result.badges.map((badge) => {
                const b = BADGE_LABELS[badge];
                if (!b) return null;
                return (
                  <span key={badge} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${b.color}`}>
                    {b.label}
                  </span>
                );
              })}
              {result.badges.length === 0 && (
                <span className="text-[10px] text-white/15">No badges earned</span>
              )}
            </div>
          </div>

          {/* ── Stats Grid ── */}
          <div className="grid grid-cols-3 gap-2">
            <StatCard icon={<Wallet className="w-3.5 h-3.5" />} label="SOL Balance" value={result.solBalance.toFixed(2)} color="text-yellow-400" />
            <StatCard icon={<Layers className="w-3.5 h-3.5" />} label="Tokens" value={String(result.tokenCount)} color="text-blue-400" />
            <StatCard icon={<Image className="w-3.5 h-3.5" />} label="NFTs" value={String(result.nftCount)} color="text-purple-400" />
            <StatCard icon={<Hash className="w-3.5 h-3.5" />} label="Transactions" value={result.txCount.toLocaleString()} color="text-cyan-400" />
            <StatCard icon={<Calendar className="w-3.5 h-3.5" />} label="Wallet Age" value={formatWalletAge(result.walletAgeDays)} color="text-green-400" />
            <StatCard icon={<Activity className="w-3.5 h-3.5" />} label="Avg Tx/Day" value={result.walletAgeDays > 0 ? (result.txCount / result.walletAgeDays).toFixed(1) : '—'} color="text-orange-400" />
          </div>

          {/* ── Top Protocols ── */}
          {result.topPrograms.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <h3 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <ExternalLink className="w-3.5 h-3.5 text-white/25" />
                Top Protocols
              </h3>
              <div className="space-y-2">
                {result.topPrograms.map((prog, i) => {
                  const maxInteractions = result.topPrograms[0]?.interactions ?? 1;
                  const pct = Math.max(5, (prog.interactions / maxInteractions) * 100);
                  return (
                    <div key={prog.programId} className="flex items-center gap-3">
                      <span className="text-[10px] text-white/20 w-4 text-right tabular-nums">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs text-white/70 font-medium truncate">
                            {prog.name ?? `${prog.programId.slice(0, 4)}...${prog.programId.slice(-4)}`}
                          </span>
                          <span className="text-[10px] text-white/30 tabular-nums ml-2">{prog.interactions}x</span>
                        </div>
                        <div className="h-1 rounded-full bg-white/[0.05] overflow-hidden">
                          <div className="h-full rounded-full bg-pink-500/40" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── View Card Button ── */}
          <button
            onClick={() => navigate(`/?address=${result.address}`)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border font-bold text-sm transition-all hover:scale-[1.01]"
            style={{
              borderColor: `${tierColor}30`,
              background: `linear-gradient(135deg, ${tierColor}10, transparent)`,
              color: tierColor,
            }}
          >
            <ExternalLink className="w-4 h-4" />
            View Identity Card
            <ChevronRight className="w-4 h-4 ml-1" />
          </button>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-16 text-white/20">
          <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-sm">Search any Solana wallet to explore its identity</p>
          <p className="text-xs text-white/10 mt-1">Score, tier, trust grade, NFTs, protocols & more</p>
        </div>
      )}
    </div>
  );
}

// ── Stat card helper ──

function StatCard({ icon, label, value, color }: { icon: JSX.Element; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
      <div className={`flex items-center justify-center mb-1.5 ${color} opacity-60`}>
        {icon}
      </div>
      <p className="text-white font-bold text-sm tabular-nums">{value}</p>
      <p className="text-white/25 text-[10px] uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

// ── Compare Tab (inline) ──

function CompareTab({ myAddress }: { myAddress: string }) {
  const wallet = useWallet();

  const [inputA, setInputA] = useState(myAddress || '');
  const [inputB, setInputB] = useState('');
  const [addrA, setAddrA] = useState('');
  const [addrB, setAddrB] = useState('');

  // Sync wallet connection to input A (once)
  const didSetInputA = useRef(false);
  useEffect(() => {
    if (wallet.publicKey && !didSetInputA.current) {
      setInputA(wallet.publicKey.toBase58());
      didSetInputA.current = true;
    }
  }, [wallet.publicKey]);

  const dataA = useWalletData(addrA || undefined);
  const dataB = useWalletData(addrB || undefined);

  const handleCompare = useCallback(() => {
    const a = inputA.trim();
    const b = inputB.trim();
    if (!a || a.length < 32) return;
    if (!b || b.length < 32) return;
    setAddrA(a);
    setAddrB(b);
    // Quest auto-tracking
    const myAddr = wallet.publicKey?.toBase58();
    if (myAddr) {
      import('@/lib/prismQuests').then(({ getQuestState, incrementQuest }) => {
        const qs = getQuestState(myAddr);
        incrementQuest(qs, 'weekly_compare3');
        incrementQuest(qs, 'ot_compare10');
        incrementQuest(qs, 'daily_explore');
      }).catch(() => {});
    }
  }, [inputA, inputB, wallet.publicKey]);

  const handleSwap = useCallback(() => {
    setInputA(inputB);
    setInputB(inputA);
    if (addrA || addrB) {
      setAddrA(inputB);
      setAddrB(inputA);
    }
  }, [inputA, inputB, addrA, addrB]);

  const scoreA = dataA.traits ? calculateScore(dataA.traits) : 0;
  const scoreB = dataB.traits ? calculateScore(dataB.traits) : 0;
  const tierA = dataA.traits?.planetTier || 'mercury';
  const tierB = dataB.traits?.planetTier || 'mercury';

  const rows = useMemo(() => {
    if (!dataA.traits || !dataB.traits) return [];
    return buildCompareRows(dataA.traits, dataB.traits);
  }, [dataA.traits, dataB.traits]);

  const badgesA = dataA.traits ? getBadgeCount(dataA.traits) : 0;
  const badgesB = dataB.traits ? getBadgeCount(dataB.traits) : 0;

  const bothLoaded = dataA.traits && dataB.traits && !dataA.isLoading && !dataB.isLoading;
  const isLoading = (addrA && dataA.isLoading) || (addrB && dataB.isLoading);

  return (
    <div className="space-y-4">
      {/* Input Section */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] uppercase tracking-widest text-cyan-400/60 font-bold mb-1 block">Wallet A</label>
            <input
              type="text"
              value={inputA}
              onChange={(e) => setInputA(e.target.value)}
              placeholder="Solana address..."
              className="w-full h-10 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40 font-mono"
            />
          </div>
          <button
            onClick={handleSwap}
            className="self-end h-10 w-10 flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
            title="Swap wallets"
          >
            <ArrowUpDown className="w-4 h-4 text-white/40" />
          </button>
          <div className="flex-1">
            <label className="text-[10px] uppercase tracking-widest text-purple-400/60 font-bold mb-1 block">Wallet B</label>
            <input
              type="text"
              value={inputB}
              onChange={(e) => setInputB(e.target.value)}
              placeholder="Solana address..."
              className="w-full h-10 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-purple-500/40 font-mono"
            />
          </div>
        </div>
        <Button
          className="w-full h-11 bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 text-black font-bold"
          onClick={handleCompare}
          disabled={!inputA.trim() || !inputB.trim() || !!isLoading}
        >
          {isLoading ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scanning...</>
          ) : (
            <><Search className="w-4 h-4 mr-2" /> Compare</>
          )}
        </Button>
      </div>

      {/* Results */}
      {bothLoaded && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Score Cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Wallet A */}
            <div className={`rounded-xl border p-4 text-center bg-gradient-to-br ${TIER_BG[tierA]} ${scoreA === scoreB ? 'border-yellow-500/30' : scoreA > scoreB ? 'border-green-500/30' : 'border-white/[0.06]'}`}>
              <div className="text-[10px] uppercase tracking-widest text-cyan-400/60 font-bold mb-1">Wallet A</div>
              <div className="font-mono text-xs text-white/50 mb-2">{formatAddr(addrA)}</div>
              <div className="text-4xl font-black tabular-nums text-white mb-1">{scoreA}</div>
              <div className={`text-sm font-bold uppercase tracking-wider ${TIER_TEXT_COLORS[tierA]}`}>
                {TIER_LABELS[tierA]}
                {scoreA > scoreB && <span className="ml-1.5 text-green-400 text-[10px]">&#x1F451;</span>}
                {scoreA === scoreB && <span className="ml-1.5 text-yellow-400 text-[10px]">&#x1F91D;</span>}
              </div>
              <div className="text-[10px] text-white/30 mt-1">{badgesA} badges</div>
            </div>
            {/* Wallet B */}
            <div className={`rounded-xl border p-4 text-center bg-gradient-to-br ${TIER_BG[tierB]} ${scoreA === scoreB ? 'border-yellow-500/30' : scoreB > scoreA ? 'border-green-500/30' : 'border-white/[0.06]'}`}>
              <div className="text-[10px] uppercase tracking-widest text-purple-400/60 font-bold mb-1">Wallet B</div>
              <div className="font-mono text-xs text-white/50 mb-2">{formatAddr(addrB)}</div>
              <div className="text-4xl font-black tabular-nums text-white mb-1">{scoreB}</div>
              <div className={`text-sm font-bold uppercase tracking-wider ${TIER_TEXT_COLORS[tierB]}`}>
                {TIER_LABELS[tierB]}
                {scoreB > scoreA && <span className="ml-1.5 text-green-400 text-[10px]">&#x1F451;</span>}
                {scoreA === scoreB && <span className="ml-1.5 text-yellow-400 text-[10px]">&#x1F91D;</span>}
              </div>
              <div className="text-[10px] text-white/30 mt-1">{badgesB} badges</div>
            </div>
          </div>

          {/* Score Difference Banner */}
          {scoreA !== scoreB ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2 flex items-center justify-center gap-2">
              <Trophy className="w-4 h-4 text-yellow-400" />
              <span className="text-sm text-white/60">
                <span className="font-bold text-white/80">{formatAddr(scoreA > scoreB ? addrA : addrB)}</span>
                {' '}wins by{' '}
                <span className="font-bold text-green-400">+{Math.abs(scoreA - scoreB)}</span>
                {' '}points
              </span>
            </div>
          ) : (
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-2 flex items-center justify-center gap-2">
              <Trophy className="w-4 h-4 text-yellow-400" />
              <span className="text-sm text-yellow-300/70 font-bold">
                It's a tie! Both wallets scored {scoreA} points
              </span>
            </div>
          )}

          {/* Detailed Comparison Table */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_80px] px-4 py-2 border-b border-white/[0.05] text-[10px] uppercase tracking-wider font-bold">
              <span className="text-white/30">Metric</span>
              <span className="text-cyan-400/60 text-right">A</span>
              <span className="text-purple-400/60 text-right">B</span>
            </div>

            {/* Score row */}
            <div className="grid grid-cols-[1fr_80px_80px] px-4 py-2.5 border-b border-white/[0.03] bg-white/[0.01]">
              <span className="text-xs font-bold text-white/70">Score</span>
              <span className={`text-xs font-bold text-right tabular-nums ${scoreA >= scoreB ? 'text-green-400' : 'text-white/50'}`}>
                {scoreA}<WinIndicator isWinner={scoreA > scoreB} />
              </span>
              <span className={`text-xs font-bold text-right tabular-nums ${scoreB >= scoreA ? 'text-green-400' : 'text-white/50'}`}>
                {scoreB}<WinIndicator isWinner={scoreB > scoreA} />
              </span>
            </div>

            {/* Tier row */}
            <div className="grid grid-cols-[1fr_80px_80px] px-4 py-2.5 border-b border-white/[0.03]">
              <span className="text-xs font-bold text-white/70">Tier</span>
              <span className={`text-xs font-bold text-right ${TIER_TEXT_COLORS[tierA]}`}>{TIER_LABELS[tierA]}</span>
              <span className={`text-xs font-bold text-right ${TIER_TEXT_COLORS[tierB]}`}>{TIER_LABELS[tierB]}</span>
            </div>

            {/* Badge count row */}
            <div className="grid grid-cols-[1fr_80px_80px] px-4 py-2.5 border-b border-white/[0.03] bg-white/[0.01]">
              <span className="text-xs font-bold text-white/70">Badges</span>
              <span className={`text-xs font-bold text-right tabular-nums ${badgesA >= badgesB ? 'text-green-400' : 'text-white/50'}`}>
                {badgesA}<WinIndicator isWinner={badgesA > badgesB} />
              </span>
              <span className={`text-xs font-bold text-right tabular-nums ${badgesB >= badgesA ? 'text-green-400' : 'text-white/50'}`}>
                {badgesB}<WinIndicator isWinner={badgesB > badgesA} />
              </span>
            </div>

            {/* Data rows */}
            {rows.map((row, i) => {
              const aWins = row.higherIsBetter ? row.numA > row.numB : row.numA < row.numB;
              const bWins = row.higherIsBetter ? row.numB > row.numA : row.numB < row.numA;
              const tied = row.numA === row.numB;
              return (
                <div
                  key={row.label}
                  className={`grid grid-cols-[1fr_80px_80px] px-4 py-2.5 ${i < rows.length - 1 ? 'border-b border-white/[0.03]' : ''} ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}
                >
                  <span className="text-xs text-white/50">{row.label}</span>
                  <span className={`text-xs text-right tabular-nums ${aWins ? 'text-green-400 font-bold' : tied ? 'text-white/60' : 'text-white/40'}`}>
                    {row.valueA}{!tied && <WinIndicator isWinner={aWins} />}
                  </span>
                  <span className={`text-xs text-right tabular-nums ${bWins ? 'text-green-400 font-bold' : tied ? 'text-white/60' : 'text-white/40'}`}>
                    {row.valueB}{!tied && <WinIndicator isWinner={bWins} />}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Badge Comparison */}
          {dataA.traits && dataB.traits && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">Badge Comparison</h3>
              <div className="space-y-1.5">
                {([
                  ['OG Member', dataA.traits.isOG, dataB.traits.isOG],
                  ['Whale', dataA.traits.isWhale, dataB.traits.isWhale],
                  ['Collector', dataA.traits.isCollector, dataB.traits.isCollector],
                  ['Binary Sun', dataA.traits.hasCombo, dataB.traits.hasCombo],
                  ['Early Adopter', dataA.traits.isEarlyAdopter, dataB.traits.isEarlyAdopter],
                  ['Tx Titan', dataA.traits.isTxTitan, dataB.traits.isTxTitan],
                  ['Solana Maxi', dataA.traits.isSolanaMaxi, dataB.traits.isSolanaMaxi],
                  ['Blue Chip', dataA.traits.isBlueChip, dataB.traits.isBlueChip],
                  ['DeFi King', dataA.traits.isDeFiKing, dataB.traits.isDeFiKing],
                  ['Meme Lord', dataA.traits.isMemeLord, dataB.traits.isMemeLord],
                  ['Diamond Hands', dataA.traits.diamondHands, dataB.traits.diamondHands],
                  ['Hyperactive', dataA.traits.hyperactiveDegen, dataB.traits.hyperactiveDegen],
                  ['Seeker', dataA.traits.hasSeeker, dataB.traits.hasSeeker],
                  ['Visionary', dataA.traits.hasPreorder, dataB.traits.hasPreorder],
                ] as [string, boolean, boolean][]).map(([name, hasA, hasB]) => (
                  <div key={name} className="grid grid-cols-[20px_1fr_20px] gap-2 items-center text-xs">
                    <span className={hasA ? 'text-green-400' : 'text-white/15'}>&#x25CF;</span>
                    <span className={`text-center ${hasA || hasB ? 'text-white/60' : 'text-white/20'}`}>{name}</span>
                    <span className={hasB ? 'text-green-400 text-right' : 'text-white/15 text-right'}>&#x25CF;</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!bothLoaded && !isLoading && (
        <div className="text-center py-12 text-white/20">
          <ArrowUpDown className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm">Enter two Solana wallet addresses to compare their identity scores</p>
        </div>
      )}
    </div>
  );
}

// ── Challenge Types ──

interface Challenge {
  id: string;
  creator: string;
  opponent: string | null;
  type: 'score' | 'game';
  gameMode: string | null;
  stakeType: 'coins' | 'sol';
  stakeAmount: number;
  status: 'open' | 'accepted' | 'playing' | 'completed' | 'cancelled';
  creatorScore: number | null;
  opponentScore: number | null;
  winner: string | null;
  createdAt: number;
  acceptedAt: number | null;
  completedAt: number | null;
  solPayoutStatus?: string;
  solPayoutTx?: string;
}

// ── Server health check ──
// Prevents spamming requests when backend isn't running

let _serverAvailable: boolean | null = null;
let _serverCheckAt = 0;
const SERVER_CHECK_INTERVAL = 30_000; // re-check every 30s

async function isServerAvailable(base: string): Promise<boolean> {
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

// ── Auth helper ──

function getCachedJwt(address: string): string | null {
  try {
    const raw = sessionStorage.getItem('ip_auth_jwt');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; address: string; expiresAt: number };
    if (parsed.address !== address) return null; // Wrong wallet
    if (parsed.expiresAt > Date.now() + 60_000) return parsed.token;
    sessionStorage.removeItem('ip_auth_jwt');
  } catch { /* ignore */ }
  return null;
}

async function obtainJwt(
  wallet: { publicKey?: { toBase58(): string } | null; signMessage?: (msg: Uint8Array) => Promise<Uint8Array> },
): Promise<string | null> {
  const address = wallet.publicKey?.toBase58();
  if (!address || !wallet.signMessage) return null;

  const existing = getCachedJwt(address);
  if (existing) return existing;

  try {
    const base = getApiBase();
    const challengeRes = await fetch(`${base}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!challengeRes.ok) return null;
    const { nonce, message } = await challengeRes.json() as { nonce: string; message: string };

    const msgBytes = new TextEncoder().encode(message);
    const signatureBytes = await wallet.signMessage(msgBytes);
    const signatureBase64 = btoa(String.fromCharCode(...signatureBytes));

    const tokenRes = await fetch(`${base}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, nonce, signature: signatureBase64 }),
    });
    if (!tokenRes.ok) return null;
    const { token } = await tokenRes.json() as { token: string };

    const entry = { token, address, expiresAt: Date.now() + 55 * 60 * 1000 };
    try { sessionStorage.setItem('ip_auth_jwt', JSON.stringify(entry)); } catch { /* ignore */ }
    return token;
  } catch {
    return null;
  }
}

// ── Time helpers ──

function timeAgo(timestamp: number): string {
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

// ── Status styling ──

const STATUS_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  open: { dot: 'bg-blue-400', text: 'text-blue-400', bg: 'bg-blue-400/10' },
  accepted: { dot: 'bg-cyan-400', text: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  playing: { dot: 'bg-yellow-400', text: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  completed: { dot: 'bg-green-400', text: 'text-green-400', bg: 'bg-green-400/10' },
  cancelled: { dot: 'bg-white/30', text: 'text-white/30', bg: 'bg-white/5' },
};

const GAME_MODE_LABELS: Record<string, { label: string; color: string }> = {
  orbit: { label: 'Orbit', color: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10' },
  destroyer: { label: 'Destroyer', color: 'text-red-400 border-red-400/30 bg-red-400/10' },
  gravity: { label: 'Gravity', color: 'text-purple-400 border-purple-400/30 bg-purple-400/10' },
};

// ── Type badge ──

function TypeBadge({ challenge }: { challenge: Challenge }) {
  if (challenge.type === 'game' && challenge.gameMode) {
    const mode = GAME_MODE_LABELS[challenge.gameMode];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${mode?.color ?? 'text-white/40 border-white/10 bg-white/5'}`}>
        <Gamepad2 className="w-3 h-3" />
        {mode?.label ?? challenge.gameMode}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-amber-400 border border-amber-400/30 bg-amber-400/10">
      <Target className="w-3 h-3" />
      Score
    </span>
  );
}

// ── Status badge ──

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.open;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.text} ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ── Challenges Tab ──

function ChallengesTab({ myAddress }: { myAddress: string }) {
  const navigate = useNavigate();
  const wallet = useWallet();

  const [openChallenges, setOpenChallenges] = useState<Challenge[]>([]);
  const [myChallenges, setMyChallenges] = useState<Challenge[]>([]);
  const [creating, setCreating] = useState(false);
  const [subTab, setSubTab] = useState<'open' | 'mine'>('open');
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [loadingMine, setLoadingMine] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Create form state
  const [formType, setFormType] = useState<'score' | 'game'>('score');
  const [formGameMode, setFormGameMode] = useState<'orbit' | 'destroyer' | 'gravity'>('orbit');
  const [formStake, setFormStake] = useState<number>(10);
  const [formBetType, setFormBetType] = useState<'coins' | 'sol'>('coins');
  const [formOpponent, setFormOpponent] = useState('');

  // Track previous "mine" for change detection
  const prevMineRef = useRef<string>('');

  // Prevent double-click race conditions on async actions
  const actionLockRef = useRef(false);

  const base = getApiBase();

  // ── Fetch open challenges ──
  const fetchOpen = useCallback(async () => {
    if (!(await isServerAvailable(base))) return;
    setLoadingOpen(true);
    try {
      const res = await fetch(`${base}/api/challenge/list`);
      if (res.ok) {
        const data = await res.json();
        setOpenChallenges(Array.isArray(data) ? data : data.challenges ?? []);
      }
    } catch { /* ignore */ }
    setLoadingOpen(false);
  }, [base]);

  // ── Fetch my challenges ──
  const fetchMine = useCallback(async () => {
    if (!myAddress) return;
    if (!(await isServerAvailable(base))) return;
    setLoadingMine(true);
    try {
      const res = await fetch(`${base}/api/challenge/my?address=${encodeURIComponent(myAddress)}`);
      if (res.ok) {
        const data = await res.json();
        const list: Challenge[] = Array.isArray(data) ? data : data.challenges ?? [];
        setMyChallenges(list);

        // Detect status changes for toast notifications
        const newKey = list.map(c => `${c.id}:${c.status}`).join(',');
        if (prevMineRef.current && prevMineRef.current !== newKey) {
          // Find changed challenges
          const prevMap = new Map<string, string>();
          prevMineRef.current.split(',').forEach(entry => {
            const [id, status] = entry.split(':');
            if (id) prevMap.set(id, status);
          });
          for (const c of list) {
            const prevStatus = prevMap.get(c.id);
            if (prevStatus && prevStatus !== c.status) {
              if (c.status === 'accepted') {
                toast.info('Challenge accepted! Get ready to battle.');
              } else if (c.status === 'playing') {
                toast.info('Challenge is now in play!');
              } else if (c.status === 'completed') {
                if (c.winner === myAddress) {
                  toast.success(`You won ${c.stakeAmount * 2} ${c.stakeType === 'sol' ? 'SOL' : 'Coins'}!`);
                } else {
                  toast.error(`You lost the challenge. ${c.stakeAmount} {c.stakeType === 'sol' ? 'SOL' : 'Coins'} gone.`);
                }
              } else if (c.status === 'cancelled') {
                toast.info('Challenge was cancelled.');
              }
            }
          }
        }
        prevMineRef.current = newKey;
      }
    } catch { /* ignore */ }
    setLoadingMine(false);
  }, [base, myAddress]);

  // ── Initial fetch + polling ──
  useEffect(() => {
    fetchOpen();
    fetchMine();

    const interval = setInterval(() => {
      fetchMine();
      if (subTab === 'open') fetchOpen();
    }, 15_000);

    return () => clearInterval(interval);
  }, [fetchOpen, fetchMine, subTab]);

  // ── Create challenge ──
  const handleCreate = useCallback(async () => {
    if (actionLockRef.current) return;
    if (!myAddress) {
      toast.error('Connect your wallet first');
      return;
    }
    const isSol = formBetType === 'sol';
    if (!isSol && (formStake < 1 || formStake > 1000)) {
      toast.error('Stake must be between 1 and 1000 Coins');
      return;
    }
    if (isSol && (formStake <= 0 || formStake > 10)) {
      toast.error('SOL stake must be between 0.01 and 10 SOL');
      return;
    }

    actionLockRef.current = true;
    setSubmitting(true);
    try {
      // Ensure we have a JWT
      let jwt = getCachedJwt(myAddress);
      if (!jwt) {
        jwt = await obtainJwt(wallet);
        if (!jwt) {
          toast.error('Please sign the message to authenticate');
          setSubmitting(false);
          actionLockRef.current = false;
          return;
        }
      }

      let solTxSignature: string | undefined;
      // SOL bet: send SOL to treasury first
      if (isSol) {
        try {
          const { Connection: SolConn, PublicKey: SolPK, SystemProgram: SolSP, Transaction: SolTx } = await import('@solana/web3.js');
          const conn = new SolConn(base.replace(/\/+$/, '').replace('/api', '') + '/rpc', 'confirmed');
          const treasuryAddr = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
          const tx = new SolTx().add(
            SolSP.transfer({ fromPubkey: new SolPK(myAddress), toPubkey: new SolPK(treasuryAddr), lamports: Math.floor(formStake * 1e9) })
          );
          tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
          tx.feePayer = new SolPK(myAddress);
          const signed = await wallet.signTransaction!(tx);
          const sig = await conn.sendRawTransaction(signed.serialize());
          await conn.confirmTransaction(sig, 'confirmed');
          solTxSignature = sig;
          toast.info('SOL transfer confirmed, creating challenge...');
        } catch (e: any) {
          toast.error(e?.message || 'SOL transfer failed');
          setSubmitting(false);
          actionLockRef.current = false;
          return;
        }
      }

      const body: Record<string, unknown> = {
        type: formType,
        stakeAmount: formStake,
        betType: formBetType,
      };
      if (isSol && solTxSignature) body.solTxSignature = solTxSignature;
      if (formType === 'game') body.gameMode = formGameMode;
      if (formOpponent.trim().length >= 32) body.opponent = formOpponent.trim();

      const res = await fetch(`${base}/api/challenge/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success(`Challenge created! ${isSol ? formStake + ' SOL' : formStake + ' Coins'} staked`);
        setCreating(false);
        setFormOpponent('');
        setFormStake(isSol ? 0.1 : 10);
        fetchOpen();
        fetchMine();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to create challenge' }));
        toast.error(err.error || 'Failed to create challenge');
      }
    } catch {
      toast.error('Network error — could not create challenge');
    } finally {
      actionLockRef.current = false;
    }
    setSubmitting(false);
  }, [myAddress, formType, formGameMode, formStake, formBetType, formOpponent, base, wallet, fetchOpen, fetchMine]);

  // ── Accept challenge ──
  const handleAccept = useCallback(async (challengeId: string) => {
    if (actionLockRef.current) return;
    if (!myAddress) {
      toast.error('Connect your wallet first');
      return;
    }

    actionLockRef.current = true;
    setAcceptingId(challengeId);
    try {
      let jwt = getCachedJwt(myAddress);
      if (!jwt) {
        jwt = await obtainJwt(wallet);
        if (!jwt) {
          toast.error('Please sign the message to authenticate');
          setAcceptingId(null);
          actionLockRef.current = false;
          return;
        }
      }

      // Find the challenge to check if it's SOL
      const challenge = [...openChallenges, ...myChallenges].find(c => c.id === challengeId);
      let solTxSignature: string | undefined;
      if (challenge?.stakeType === 'sol') {
        try {
          const { Connection: SolConn, PublicKey: SolPK, SystemProgram: SolSP, Transaction: SolTx } = await import('@solana/web3.js');
          const conn = new SolConn(base.replace(/\/+$/, '').replace('/api', '') + '/rpc', 'confirmed');
          const treasuryAddr = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
          const tx = new SolTx().add(
            SolSP.transfer({ fromPubkey: new SolPK(myAddress), toPubkey: new SolPK(treasuryAddr), lamports: Math.floor(challenge.stakeAmount * 1e9) })
          );
          tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
          tx.feePayer = new SolPK(myAddress);
          const signed = await wallet.signTransaction!(tx);
          const sig = await conn.sendRawTransaction(signed.serialize());
          await conn.confirmTransaction(sig, 'confirmed');
          solTxSignature = sig;
          toast.info('SOL transfer confirmed, accepting challenge...');
        } catch (e: any) {
          toast.error(e?.message || 'SOL transfer failed');
          setAcceptingId(null);
          actionLockRef.current = false;
          return;
        }
      }

      const acceptBody: Record<string, unknown> = { challengeId };
      if (solTxSignature) acceptBody.solTxSignature = solTxSignature;

      const res = await fetch(`${base}/api/challenge/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(acceptBody),
      });

      if (res.ok) {
        toast.success('Challenge accepted! Good luck.');
        fetchOpen();
        fetchMine();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to accept' }));
        toast.error(err.error || 'Failed to accept challenge');
      }
    } catch {
      toast.error('Network error');
    } finally {
      actionLockRef.current = false;
    }
    setAcceptingId(null);
  }, [myAddress, base, wallet, fetchOpen, fetchMine, openChallenges, myChallenges]);

  // ── Cancel challenge ──
  const handleCancel = useCallback(async (challengeId: string) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setCancellingId(challengeId);
    try {
      let jwt = getCachedJwt(myAddress);
      if (!jwt) {
        jwt = await obtainJwt(wallet);
        if (!jwt) {
          toast.error('Please sign the message to authenticate');
          setCancellingId(null);
          actionLockRef.current = false;
          return;
        }
      }

      const res = await fetch(`${base}/api/challenge/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ challengeId }),
      });

      if (res.ok) {
        toast.info('Challenge cancelled. Stake refunded.');
        fetchOpen();
        fetchMine();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to cancel' }));
        toast.error(err.error || 'Failed to cancel challenge');
      }
    } catch {
      toast.error('Network error');
    } finally {
      actionLockRef.current = false;
    }
    setCancellingId(null);
  }, [myAddress, base, wallet, fetchOpen, fetchMine]);

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
          <button
            onClick={() => setSubTab('open')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              subTab === 'open' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'
            }`}
          >
            Open
          </button>
          <button
            onClick={() => setSubTab('mine')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              subTab === 'mine' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'
            }`}
          >
            Mine
          </button>
        </div>
        <Button
          onClick={() => setCreating(!creating)}
          size="sm"
          className={creating
            ? 'bg-white/5 hover:bg-white/10 text-white/50 border border-white/10'
            : 'bg-amber-500 hover:bg-amber-400 text-black font-bold'
          }
        >
          {creating ? <><X className="w-3.5 h-3.5 mr-1" /> Cancel</> : <><Plus className="w-3.5 h-3.5 mr-1" /> New Challenge</>}
        </Button>
      </div>

      {/* ── Create form ── */}
      {creating && (
        <div className="p-5 rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Swords className="w-4 h-4 text-amber-400" />
            Create Challenge
          </h3>

          {/* Type toggle */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">Challenge Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setFormType('score')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                  formType === 'score'
                    ? 'bg-amber-400/15 border-amber-400/40 text-amber-400'
                    : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                Score Battle
              </button>
              <button
                onClick={() => setFormType('game')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                  formType === 'game'
                    ? 'bg-purple-400/15 border-purple-400/40 text-purple-400'
                    : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                }`}
              >
                <Gamepad2 className="w-3.5 h-3.5" />
                Game Battle
              </button>
            </div>
          </div>

          {/* Game mode selector (only for game type) */}
          {formType === 'game' && (
            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">Game Mode</label>
              <div className="flex gap-2">
                {([
                  { mode: 'orbit' as const, label: 'Orbit', icon: CircleDot, active: 'bg-cyan-400/15 border-cyan-400/40 text-cyan-400' },
                  { mode: 'destroyer' as const, label: 'Destroyer', icon: Flame, active: 'bg-red-400/15 border-red-400/40 text-red-400' },
                  { mode: 'gravity' as const, label: 'Gravity', icon: ArrowUpDown, active: 'bg-purple-400/15 border-purple-400/40 text-purple-400' },
                ] as const).map(({ mode, label, icon: Icon, active }) => (
                  <button
                    key={mode}
                    onClick={() => setFormGameMode(mode)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                      formGameMode === mode
                        ? active
                        : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bet type toggle */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">Bet Currency</label>
            <div className="flex gap-2">
              <button
                onClick={() => { setFormBetType('coins'); setFormStake(10); }}
                className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                  formBetType === 'coins' ? 'bg-amber-400/15 border-amber-400/40 text-amber-400' : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                }`}
              >
                Coins
              </button>
              <button
                onClick={() => { setFormBetType('sol'); setFormStake(0.1); }}
                className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                  formBetType === 'sol' ? 'bg-purple-400/15 border-purple-400/40 text-purple-400' : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                }`}
              >
                SOL
              </button>
            </div>
          </div>

          {/* Stake amount */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">
              Stake Amount {formBetType === 'sol' && <span className="text-purple-400/50">(10% fee)</span>}
            </label>
            <div className="relative">
              <input
                type="number"
                min={formBetType === 'sol' ? 0.01 : 1}
                max={formBetType === 'sol' ? 10 : 1000}
                step={formBetType === 'sol' ? 0.01 : 1}
                value={formStake}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  setFormStake(formBetType === 'sol' ? Math.max(0.01, Math.min(10, v)) : Math.max(1, Math.min(1000, Math.floor(v))));
                }}
                className="w-full px-4 py-3 pr-20 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white font-bold focus:outline-none focus:border-amber-500/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold ${formBetType === 'sol' ? 'text-purple-400/60' : 'text-amber-400/60'}`}>
                {formBetType === 'sol' ? 'SOL' : 'Coins'}
              </span>
            </div>
            {formBetType === 'sol' && (
              <p className="text-[10px] text-white/20 mt-1">Winner gets {(formStake * 2 * 0.9).toFixed(3)} SOL (90% of pool)</p>
            )}
          </div>

          {/* Opponent (optional) */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">
              Opponent <span className="text-white/15">(optional — leave empty for open challenge)</span>
            </label>
            <input
              type="text"
              value={formOpponent}
              onChange={(e) => setFormOpponent(e.target.value)}
              placeholder="Solana wallet address..."
              className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white font-mono placeholder-white/15 focus:outline-none focus:border-amber-500/40"
            />
          </div>

          {/* Submit */}
          <Button
            onClick={handleCreate}
            disabled={submitting || !myAddress}
            className="w-full h-11 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold"
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
            ) : (
              <><Swords className="w-4 h-4 mr-2" /> Create Challenge — {formStake} {formBetType === 'sol' ? 'SOL' : 'Coins'}</>
            )}
          </Button>
        </div>
      )}

      {/* ── Open Challenges ── */}
      {subTab === 'open' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider">
              Open Challenges
              <span className="ml-2 text-amber-400/60">{openChallenges.length}</span>
            </h3>
            <button onClick={fetchOpen} className="text-[10px] text-white/20 hover:text-white/40 transition-colors">
              {loadingOpen ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
            </button>
          </div>

          {openChallenges.length === 0 && !loadingOpen && (
            <div className="text-center py-12 text-white/20">
              <Swords className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No open challenges yet</p>
              <p className="text-xs text-white/10 mt-1">Be the first to create one</p>
            </div>
          )}

          {loadingOpen && openChallenges.length === 0 && (
            <div className="text-center py-12">
              <Loader2 className="w-6 h-6 mx-auto animate-spin text-white/20" />
            </div>
          )}

          {openChallenges.map((c) => (
            <div key={c.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 hover:bg-white/[0.04] transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-mono text-white/40">{formatAddr(c.creator)}</span>
                    <TypeBadge challenge={c} />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-amber-400 flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5" />
                      {c.stakeAmount} {c.stakeType === 'sol' ? 'SOL' : 'Coins'}
                    </span>
                    <span className="text-[10px] text-white/20">
                      <Clock className="w-3 h-3 inline mr-0.5 -mt-0.5" />
                      {timeAgo(c.createdAt)}
                    </span>
                  </div>
                </div>
                {c.creator !== myAddress && (
                  <Button
                    onClick={() => handleAccept(c.id)}
                    disabled={acceptingId === c.id || !myAddress}
                    size="sm"
                    className="bg-green-500 hover:bg-green-400 text-black font-bold shrink-0"
                  >
                    {acceptingId === c.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <><Check className="w-3.5 h-3.5 mr-1" /> Accept</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── My Challenges ── */}
      {subTab === 'mine' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider">
              My Challenges
              <span className="ml-2 text-amber-400/60">{myChallenges.length}</span>
            </h3>
            <button onClick={fetchMine} className="text-[10px] text-white/20 hover:text-white/40 transition-colors">
              {loadingMine ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
            </button>
          </div>

          {!myAddress && (
            <div className="text-center py-12 text-white/20">
              <Zap className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Connect your wallet to see your challenges</p>
            </div>
          )}

          {myAddress && myChallenges.length === 0 && !loadingMine && (
            <div className="text-center py-12 text-white/20">
              <Swords className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No challenges yet</p>
              <p className="text-xs text-white/10 mt-1">Create one or accept an open challenge</p>
            </div>
          )}

          {loadingMine && myChallenges.length === 0 && (
            <div className="text-center py-12">
              <Loader2 className="w-6 h-6 mx-auto animate-spin text-white/20" />
            </div>
          )}

          {myChallenges.map((c) => {
            const isCreator = c.creator === myAddress;
            const opponentAddr = isCreator ? c.opponent : c.creator;
            const myScore = isCreator ? c.creatorScore : c.opponentScore;
            const theirScore = isCreator ? c.opponentScore : c.creatorScore;
            const didWin = c.winner === myAddress;

            return (
              <div key={c.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                {/* Top row: opponent + type + status */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-white/40">
                      vs {opponentAddr ? formatAddr(opponentAddr) : 'Open'}
                    </span>
                    <TypeBadge challenge={c} />
                  </div>
                  <StatusBadge status={c.status} />
                </div>

                {/* Stake */}
                <div className="flex items-center gap-1 text-sm font-bold text-amber-400 mb-3">
                  <Zap className="w-3.5 h-3.5" />
                  {c.stakeAmount} {c.stakeType === 'sol' ? 'SOL' : 'Coins'}
                </div>

                {/* Completed: show results */}
                {c.status === 'completed' && (
                  <div className={`rounded-lg p-3 mb-3 ${didWin ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-xs font-bold ${didWin ? 'text-green-400' : 'text-red-400'}`}>
                          {didWin ? `Won ${c.stakeAmount * 2} ${c.stakeType === 'sol' ? 'SOL' : 'Coins'}` : 'Lost'}
                        </p>
                        {(myScore !== null || theirScore !== null) && (
                          <p className="text-[10px] text-white/30 mt-0.5">
                            You: {myScore ?? '—'} / Opponent: {theirScore ?? '—'}
                          </p>
                        )}
                      </div>
                      <Trophy className={`w-5 h-5 ${didWin ? 'text-green-400' : 'text-white/10'}`} />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {/* Playing + game type: Play Now button */}
                  {(c.status === 'playing' || c.status === 'accepted') && c.type === 'game' && c.gameMode && (
                    <Button
                      onClick={() => navigate(`/game?challengeId=${c.id}&mode=${c.gameMode}`)}
                      size="sm"
                      className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold"
                    >
                      <Play className="w-3.5 h-3.5 mr-1" />
                      Play Now
                    </Button>
                  )}

                  {/* Open + own: Cancel button */}
                  {c.status === 'open' && isCreator && (
                    <Button
                      onClick={() => handleCancel(c.id)}
                      disabled={cancellingId === c.id}
                      size="sm"
                      variant="ghost"
                      className="text-white/30 hover:text-red-400 hover:bg-red-400/10"
                    >
                      {cancellingId === c.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <><Ban className="w-3.5 h-3.5 mr-1" /> Cancel</>
                      )}
                    </Button>
                  )}

                  {/* Timestamp */}
                  <span className="ml-auto text-[10px] text-white/15">
                    {timeAgo(c.createdAt)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main ──

export default function NebulaMarket() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const address = searchParams.get('address');
  const { publicKey } = useWallet();
  const walletAddress = address || publicKey?.toBase58() || '';

  const [activeTab, setActiveTab] = useState<MarketTab>('explore');

  return (
    <div className="min-h-screen bg-[#050510] text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => goBack(navigate)}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-sm font-bold">Prism Arena</h1>
          <div className="w-16" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white/5 rounded-xl p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === tab.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'explore' && <ExploreTab myAddress={walletAddress} />}
        {activeTab === 'compare' && <CompareTab myAddress={walletAddress} />}
        {activeTab === 'challenges' && <ChallengesTab myAddress={walletAddress} />}
      </div>
    </div>
  );
}
