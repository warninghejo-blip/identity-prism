/**
 * Prism Scanner — Unified Trust Report (single scroll).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  ArrowLeft,
  Search,
  Loader2,
  Swords,
  ChevronRight,
  ChevronDown,
  Shield,
  Wallet,
  Hash,
  Layers,
  Image,
  Calendar,
  Activity,
  ExternalLink,
  Clock,
  User,
  AlertTriangle,
  CheckCircle,
  XCircle,
  BarChart3,
  GitBranch,
  Fingerprint,
  Copy,
  Check,
  ArrowDownLeft,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageShell from '@/components/PageShell';
import { goBack } from '@/lib/safeNavigate';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
import {
  fetchWalletPreview,
  StatPill,
  TIER_COLORS_HEX,
  TIER_LABELS,
  TRUST_GRADE_COLORS,
  formatWalletAge,
  type WalletPreview,
} from '@/components/prism/shared';

const RECENT_WALLETS_KEY = 'prism_recent_scans';
const MAX_RECENT = 6;
const BASE = () => (typeof window !== 'undefined' ? window.location.origin : '');

function getRecentWallets(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(RECENT_WALLETS_KEY) || '[]');
  } catch {
    return [];
  }
}
function addRecentWallet(addr: string) {
  try {
    const list = getRecentWallets().filter((a) => a !== addr);
    list.unshift(addr);
    sessionStorage.setItem(RECENT_WALLETS_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {}
}

/* ── Types ── */
interface SybilSignal {
  id: string;
  name: string;
  category: string;
  detected: boolean;
  weight: number;
  severity: string;
  value: string;
  description: string;
}
interface SybilAnalysis {
  riskScore: number;
  riskLevel: string;
  trustScore: number;
  trustGrade: string;
  signals: SybilSignal[];
  metrics: Record<string, unknown>;
  behaviorProfile: Record<string, unknown>;
}
interface FundingSource {
  address: string;
  label: string | null;
  type: string;
  totalSolReceived: number;
  transactionCount: number;
  percentage: number;
}
interface TopProgram {
  programId: string;
  name: string;
  interactions: number;
}

const sybilClientCache = new Map<string, { data: SybilAnalysis; ts: number }>();

/* ── Copy button helper ── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="p-1 rounded hover:bg-white/10 transition-colors"
      title="Copy address"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-white/30" />}
    </button>
  );
}

export default function PrismScanner() {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const myAddress = publicKey?.toBase58() || '';
  useEffect(() => {
    fadeOutTransition();
  }, []);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WalletPreview | null>(null);
  const [error, setError] = useState('');
  const [recentWallets, setRecentWallets] = useState<string[]>(getRecentWallets);
  const [counterparties, setCounterparties] = useState<{ address: string; volume?: number }[]>([]);

  // Data states
  const [sybilData, setSybilData] = useState<SybilAnalysis | null>(null);
  const [sybilLoading, setSybilLoading] = useState(false);
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([]);

  // Auto-scan on wallet connect / wallet change
  const hasAutoScanned = useRef<string | null>(null);
  useEffect(() => {
    if (myAddress && hasAutoScanned.current !== myAddress) {
      hasAutoScanned.current = myAddress;
      handleSearch(myAddress);
    }
    if (!myAddress) hasAutoScanned.current = null;
  }, [myAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch counterparties (constellation graph)
  useEffect(() => {
    if (!myAddress) {
      setCounterparties([]);
      return;
    }
    const ac = new AbortController();
    fetch(`${BASE()}/api/constellation?address=${myAddress}&depth=1`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.nodes) return;
        const others = (d.nodes as { address?: string; volume?: number }[])
          .filter((n) => n.address && n.address !== myAddress)
          .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
          .slice(0, 10) as { address: string; volume?: number }[];
        setCounterparties(others);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [myAddress]);

  const fetchSybil = useCallback(async (addr: string) => {
    const cached = sybilClientCache.get(addr);
    if (cached && Date.now() - cached.ts < 1800_000) {
      setSybilData(cached.data);
      return;
    }
    setSybilLoading(true);
    try {
      const r = await fetch(`${BASE()}/api/sybil/analysis?address=${addr}`);
      if (r.status === 429 && cached) {
        setSybilData(cached.data);
        return;
      }
      if (!r.ok) {
        setSybilData(null);
        return;
      }
      const data = await r.json();
      sybilClientCache.set(addr, { data, ts: Date.now() });
      setSybilData(data);
    } catch {
      setSybilData(null);
    } finally {
      setSybilLoading(false);
    }
  }, []);

  const fetchFunding = useCallback(async (addr: string) => {
    try {
      const r = await fetch(`${BASE()}/api/sybil/funding-sources?address=${addr}`);
      if (r.ok) {
        const d = await r.json();
        setFundingSources(d.sources || []);
      }
    } catch {}
  }, []);

  const handleSearch = useCallback(
    async (overrideAddr?: string) => {
      const addr = (overrideAddr || query).trim();
      if (!addr || addr.length < 32) {
        setError('Enter a valid Solana wallet address');
        return;
      }
      setLoading(true);
      setError('');
      setResult(null);
      setSybilData(null);
      setFundingSources([]);

      const data = await fetchWalletPreview(addr);
      setLoading(false);
      if (!data) {
        setError('Could not load wallet data');
        return;
      }
      setResult(data);
      addRecentWallet(addr);
      setRecentWallets(getRecentWallets());

      // Parallel background fetches
      fetchSybil(addr);
      fetchFunding(addr);

      if (myAddress && addr !== myAddress) {
        import('@/lib/prismQuests')
          .then(({ getQuestState, incrementQuest }) => {
            incrementQuest(getQuestState(myAddress), 'daily_explore');
          })
          .catch(() => {});
      }
    },
    [query, myAddress, fetchSybil, fetchFunding],
  );

  const displayScore = result ? result.compositeScore || result.score || 0 : 0;
  const maxScore = 1000;
  const displayTier = result ? result.compositeTier || result.tier || 'mercury' : 'mercury';
  const tierColor = displayTier ? (TIER_COLORS_HEX[displayTier] ?? '#888') : '#888';
  const gradeStyle = result?.trustGrade ? (TRUST_GRADE_COLORS[result.trustGrade] ?? TRUST_GRADE_COLORS['C']) : null;

  return (
    <PageShell>
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => startFadeTransition(() => goBack(navigate))}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <h1 className="text-sm font-bold bg-gradient-to-r from-cyan-500 to-sky-400 bg-clip-text text-transparent">
            PRISM SCANNER
          </h1>
          <div className="w-16" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Search */}
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
            onClick={() => handleSearch()}
            disabled={loading}
            className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Scan'}
          </Button>
        </div>

        {/* Quick-select */}
        {!loading && (myAddress || recentWallets.length > 0 || counterparties.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {myAddress && !result && (
              <button
                onClick={() => {
                  setQuery(myAddress);
                  handleSearch(myAddress);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold hover:bg-cyan-500/20 transition-colors"
              >
                <User className="w-3 h-3" /> My Wallet
              </button>
            )}
            {counterparties.slice(0, 5).map((cp) => (
              <button
                key={cp.address}
                onClick={() => {
                  setQuery(cp.address);
                  handleSearch(cp.address);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/[0.06] border border-purple-500/[0.12] text-purple-300/60 text-xs font-mono hover:bg-purple-500/[0.12] transition-colors"
              >
                <GitBranch className="w-3 h-3" /> {cp.address.slice(0, 4)}...{cp.address.slice(-4)}
              </button>
            ))}
            {recentWallets
              .filter((a) => a !== myAddress && !counterparties.some((c) => c.address === a))
              .slice(0, 4)
              .map((addr) => (
                <button
                  key={addr}
                  onClick={() => {
                    setQuery(addr);
                    handleSearch(addr);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/50 text-xs font-mono hover:bg-white/[0.08] transition-colors"
                >
                  <Clock className="w-3 h-3" /> {addr.slice(0, 4)}...{addr.slice(-4)}
                </button>
              ))}
          </div>
        )}

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        {/* Result */}
        {result && (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header card */}
            <div className="glass-card overflow-hidden" style={{ borderColor: `${tierColor}20` }}>
              <div className="p-4">
                <div className="flex items-center gap-4">
                  <div className="relative flex-shrink-0">
                    <svg width="68" height="68" viewBox="0 0 68 68">
                      <circle cx="34" cy="34" r="28" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="4" />
                      <circle
                        cx="34"
                        cy="34"
                        r="28"
                        fill="none"
                        stroke={tierColor}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={`${Math.min(displayScore / maxScore, 1) * 2 * Math.PI * 28} ${2 * Math.PI * 28}`}
                        transform="rotate(-90 34 34)"
                        style={{ filter: `drop-shadow(0 0 6px ${tierColor}80)` }}
                      />
                      <text
                        x="34"
                        y="31"
                        textAnchor="middle"
                        fill={tierColor}
                        fontSize="15"
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        {displayScore}
                      </text>
                      <text x="34" y="42" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="8">
                        /{maxScore}
                      </text>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-white/40 text-xs font-mono truncate">
                        {result.address.slice(0, 6)}...{result.address.slice(-4)}
                      </p>
                      <CopyButton text={result.address} />
                    </div>
                    <p className="font-bold text-lg" style={{ color: tierColor }}>
                      {TIER_LABELS[displayTier] ?? displayTier.toUpperCase()}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {gradeStyle && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${gradeStyle.bg} ${gradeStyle.border} ${gradeStyle.text}`}
                        >
                          <Shield className="w-3 h-3" /> Trust {result.trustGrade}
                        </span>
                      )}
                      {(result.compositeBadgeCount > 0 || result.badges.length > 0) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-amber-400 border border-amber-400/20 bg-amber-400/10">
                          {result.compositeBadgeCount || result.badges.length} badges
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <StatPill
                    icon={<Wallet className="w-3 h-3" />}
                    label="SOL"
                    value={result.solBalance.toFixed(2)}
                    color="text-yellow-400"
                  />
                  <StatPill
                    icon={<Layers className="w-3 h-3" />}
                    label="Tokens"
                    value={String(result.tokenCount)}
                    color="text-blue-400"
                  />
                  <StatPill
                    icon={<Image className="w-3 h-3" />}
                    label="NFTs"
                    value={String(result.nftCount)}
                    color="text-purple-400"
                  />
                  <StatPill
                    icon={<Hash className="w-3 h-3" />}
                    label="Txns"
                    value={result.txCount.toLocaleString()}
                    color="text-cyan-400"
                  />
                  <StatPill
                    icon={<Calendar className="w-3 h-3" />}
                    label="Age"
                    value={formatWalletAge(result.walletAgeDays)}
                    color="text-green-400"
                  />
                  <StatPill
                    icon={<Activity className="w-3 h-3" />}
                    label="Tx/Day"
                    value={result.walletAgeDays > 0 ? (result.txCount / result.walletAgeDays).toFixed(1) : '—'}
                    color="text-orange-400"
                  />
                </div>
              </div>
              <div className="flex border-t border-white/[0.06]">
                <button
                  onClick={() => navigate(`/?address=${result.address}`, { state: { openCard: true } })}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold transition-all hover:bg-white/[0.03]"
                  style={{ color: tierColor }}
                >
                  <ExternalLink className="w-4 h-4" /> View Full Card
                </button>
                {myAddress && result.address !== myAddress && (
                  <button
                    onClick={() => navigate(`/compare?a=${myAddress}&b=${result.address}`)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 border-l border-white/[0.06] text-sm font-bold transition-all hover:bg-white/[0.03] text-purple-400"
                  >
                    <Swords className="w-4 h-4" /> Compare
                  </button>
                )}
              </div>
            </div>

            {/* Protocol Usage */}
            {result.topPrograms && result.topPrograms.length > 0 && (
              <div className="glass-card p-4">
                <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-white/30" /> Protocol Usage
                </p>
                <div className="space-y-2">
                  {(result.topPrograms as TopProgram[]).slice(0, 6).map((p, i) => {
                    const maxInt = Math.max(...(result.topPrograms as TopProgram[]).map((x) => x.interactions), 1);
                    return (
                      <div key={p.programId || i} className="flex items-center gap-3">
                        <span className="text-xs text-white/60 font-bold w-24 truncate">
                          {p.name || p.programId.slice(0, 8)}
                        </span>
                        <div className="flex-1 h-2 bg-white/[0.04] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-500/60 to-cyan-400/40"
                            style={{ width: `${(p.interactions / maxInt) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-white/30 font-mono w-8 text-right">{p.interactions}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Trust Report */}
            <SybilReportPanel data={sybilData} loading={sybilLoading} fundingSources={fundingSources} />
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-16 text-white/20">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">Search any Solana wallet to explore its trust profile</p>
            <p className="text-xs text-white/10 mt-1">Trust Report, Sybil Analysis, Funding Sources & more</p>
          </div>
        )}
      </div>
    </PageShell>
  );
}

/* ═══════════════════════════════════════════════
   SYBIL REPORT PANEL
   ═══════════════════════════════════════════════ */
function SybilReportPanel({
  data,
  loading,
  fundingSources,
}: {
  data: SybilAnalysis | null;
  loading: boolean;
  fundingSources: FundingSource[];
}) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  if (loading)
    return (
      <div className="glass-card p-8 flex flex-col items-center gap-3 text-white/40">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
        <p className="text-sm font-bold">Analyzing wallet behavior...</p>
        <p className="text-xs text-white/20">18+ risk signals, funding graph, timing patterns</p>
      </div>
    );

  if (!data)
    return (
      <div className="glass-card p-8 text-center text-white/30">
        <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">Sybil analysis unavailable</p>
        <p className="text-xs text-white/15 mt-1">Rate limited or failed — try again shortly</p>
      </div>
    );

  const riskColor =
    data.riskScore >= 75
      ? '#ef4444'
      : data.riskScore >= 50
        ? '#f97316'
        : data.riskScore >= 30
          ? '#eab308'
          : data.riskScore >= 10
            ? '#3b82f6'
            : '#22c55e';
  const gradeColor =
    data.trustScore >= 80
      ? '#22c55e'
      : data.trustScore >= 60
        ? '#3b82f6'
        : data.trustScore >= 40
          ? '#eab308'
          : '#ef4444';
  const metrics = data.metrics as Record<string, unknown>;
  const profile = data.behaviorProfile as Record<string, number>;

  const behavioral = data.signals.filter((s) => s.category === 'behavioral');
  const financial = data.signals.filter((s) => s.category === 'financial');
  const network = data.signals.filter((s) => s.category === 'network');
  const flagged = data.signals.filter((s) => s.detected);

  // Radar chart data (5 axes, 0-1 normalized)
  const radarAxes = [
    { label: 'Age', value: Math.min(1, (Number(metrics.walletAgeDays) || 0) / 730) },
    { label: 'DeFi', value: Math.min(1, (Number(metrics.defiDepth) || 0) / 4) },
    { label: 'Diversity', value: Math.min(1, (Number(metrics.uniquePrograms) || 0) / 15) },
    { label: 'Activity', value: Math.min(1, (profile.activeDaysRatio || 0) / 0.5) },
    { label: 'Flow Balance', value: 1 - Math.abs((Number(metrics.flowRatio) || 50) - 50) / 50 },
  ];

  const categories = [
    {
      key: 'behavioral',
      label: 'Behavioral',
      signals: behavioral,
      color: '#a78bfa',
      icon: <BarChart3 className="w-3.5 h-3.5" />,
    },
    {
      key: 'financial',
      label: 'Financial',
      signals: financial,
      color: '#fbbf24',
      icon: <Wallet className="w-3.5 h-3.5" />,
    },
    {
      key: 'network',
      label: 'Network',
      signals: network,
      color: '#34d399',
      icon: <GitBranch className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div className="space-y-3">
      {/* Header: gauge + radar */}
      <div className="glass-card p-4">
        <div className="flex items-start gap-4">
          {/* Trust gauge */}
          <div className="flex-shrink-0">
            <svg width="76" height="76" viewBox="0 0 76 76">
              <circle cx="38" cy="38" r="30" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
              <circle
                cx="38"
                cy="38"
                r="30"
                fill="none"
                stroke={gradeColor}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${(data.trustScore / 100) * 2 * Math.PI * 30} ${2 * Math.PI * 30}`}
                transform="rotate(-90 38 38)"
                style={{ filter: `drop-shadow(0 0 8px ${gradeColor}60)` }}
              />
              <text
                x="38"
                y="35"
                textAnchor="middle"
                fill={gradeColor}
                fontSize="18"
                fontWeight="bold"
                fontFamily="monospace"
              >
                {data.trustGrade}
              </text>
              <text x="38" y="48" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="9">
                {data.trustScore}/100
              </text>
            </svg>
          </div>

          {/* Radar chart (SVG spider) */}
          <div className="flex-1 flex justify-center">
            <svg width="130" height="130" viewBox="0 0 130 130">
              {/* Grid rings */}
              {[0.33, 0.66, 1].map((r) => (
                <polygon
                  key={r}
                  points={radarAxes
                    .map((_, i) => {
                      const a = (i / radarAxes.length) * Math.PI * 2 - Math.PI / 2;
                      return `${65 + Math.cos(a) * 45 * r},${65 + Math.sin(a) * 45 * r}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="0.5"
                />
              ))}
              {/* Axis lines */}
              {radarAxes.map((_, i) => {
                const a = (i / radarAxes.length) * Math.PI * 2 - Math.PI / 2;
                return (
                  <line
                    key={i}
                    x1="65"
                    y1="65"
                    x2={65 + Math.cos(a) * 45}
                    y2={65 + Math.sin(a) * 45}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="0.5"
                  />
                );
              })}
              {/* Data polygon */}
              <polygon
                points={radarAxes
                  .map((ax, i) => {
                    const a = (i / radarAxes.length) * Math.PI * 2 - Math.PI / 2;
                    const r = Math.max(0.05, ax.value);
                    return `${65 + Math.cos(a) * 45 * r},${65 + Math.sin(a) * 45 * r}`;
                  })
                  .join(' ')}
                fill={`${gradeColor}20`}
                stroke={gradeColor}
                strokeWidth="1.5"
              />
              {/* Data dots + labels */}
              {radarAxes.map((ax, i) => {
                const a = (i / radarAxes.length) * Math.PI * 2 - Math.PI / 2;
                const r = Math.max(0.05, ax.value);
                const lx = 65 + Math.cos(a) * 58;
                const ly = 65 + Math.sin(a) * 58;
                return (
                  <g key={ax.label}>
                    <circle cx={65 + Math.cos(a) * 45 * r} cy={65 + Math.sin(a) * 45 * r} r="2.5" fill={gradeColor} />
                    <text
                      x={lx}
                      y={ly + 3}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.35)"
                      fontSize="7"
                      fontWeight="bold"
                    >
                      {ax.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Risk summary */}
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold" style={{ color: riskColor }}>
              Risk: {data.riskScore}/100 — {data.riskLevel.toUpperCase()}
            </span>
            <span className="text-xs text-white/25">
              {flagged.length}/{data.signals.length} flagged
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {metrics.hasSolDomain && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20">
                <CheckCircle className="w-3 h-3 inline mr-0.5" />
                .sol
              </span>
            )}
            {Array.isArray(metrics.defiCategories) &&
              (metrics.defiCategories as string[]).map((c) => (
                <span key={c} className="px-2 py-0.5 rounded text-[10px] font-bold text-cyan-400/60 bg-cyan-400/5">
                  {c}
                </span>
              ))}
            {Number(metrics.trustBonus) > 0 && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold text-emerald-400 bg-emerald-400/5">
                bonus -{String(metrics.trustBonus)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Signal categories */}
      {categories.map((cat) => {
        const catFlagged = cat.signals.filter((s) => s.detected).length;
        const isExpanded = expandedCategory === cat.key;
        return (
          <div key={cat.key} className="glass-card overflow-hidden">
            <button
              onClick={() => setExpandedCategory(isExpanded ? null : cat.key)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
            >
              <span style={{ color: cat.color }}>{cat.icon}</span>
              <span className="text-xs font-bold text-white/60 flex-1">{cat.label}</span>
              {catFlagged > 0 ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-400">
                  {catFlagged} flagged
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                  clean
                </span>
              )}
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-white/30" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-white/30" />
              )}
            </button>
            {isExpanded && (
              <div className="px-4 pb-3 space-y-1.5">
                {cat.signals.map((sig) => (
                  <div
                    key={sig.id}
                    className={`flex items-start gap-2 p-2 rounded-lg ${sig.detected ? 'bg-red-500/[0.06]' : 'bg-white/[0.02]'}`}
                  >
                    {sig.detected ? (
                      sig.severity === 'danger' ? (
                        <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                      )
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400/50 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${sig.detected ? 'text-white/80' : 'text-white/40'}`}>
                          {sig.name}
                        </span>
                        <span className="text-[10px] text-white/20 font-mono">{sig.value}</span>
                        {sig.detected && (
                          <span className="text-[10px] text-red-400/60 font-mono ml-auto">+{sig.weight}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/25 mt-0.5">{sig.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Heatmaps */}
      {(metrics.hourBuckets || metrics.hourEntropy != null) && (
        <div className="glass-card p-4">
          <p className="text-xs font-bold text-white/50 mb-3 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-white/30" /> Activity Heatmap
          </p>
          <div className="flex gap-px items-end" style={{ height: 40 }}>
            {(() => {
              const buckets = Array.isArray(metrics.hourBuckets) ? (metrics.hourBuckets as number[]) : null;
              const maxB = buckets ? Math.max(...buckets, 1) : 1;
              const isBot = Number(metrics.hourEntropy || 0) > 4.0;
              return Array.from({ length: 24 }, (_, h) => {
                const count = buckets ? buckets[h] || 0 : 0;
                const ratio = buckets ? count / maxB : h >= 8 && h <= 22 ? 0.5 : 0.1;
                return (
                  <div
                    key={h}
                    className="flex-1 rounded-t-sm"
                    style={{
                      height: `${Math.max(8, ratio * 100)}%`,
                      background: `rgba(${isBot ? '239,68,68' : '34,211,238'},${0.15 + ratio * 0.55})`,
                    }}
                    title={`${h}:00 — ${count} txs`}
                  />
                );
              });
            })()}
          </div>
          <div className="flex justify-between mt-1">
            {['0:00', '6:00', '12:00', '18:00', '23:00'].map((l) => (
              <span key={l} className="text-[9px] text-white/15">
                {l}
              </span>
            ))}
          </div>
          {Array.isArray(metrics.dayBuckets) && (
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <p className="text-[10px] text-white/20 mb-2">Day of week</p>
              <div className="flex gap-1 items-end" style={{ height: 28 }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => {
                  const b = metrics.dayBuckets as number[];
                  const count = b[i] || 0;
                  const max = Math.max(...b, 1);
                  const ratio = count / max;
                  const isWe = i === 0 || i === 6;
                  return (
                    <div key={day} className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        className="w-full rounded-t-sm"
                        style={{
                          height: `${Math.max(4, ratio * 100)}%`,
                          background: `rgba(${isWe ? '168,85,247' : '34,211,238'},${0.15 + ratio * 0.5})`,
                        }}
                        title={`${day}: ${count}`}
                      />
                      <span className="text-[8px] text-white/15">{day}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top Funding Sources */}
      {fundingSources.length > 0 && (
        <div className="glass-card p-4">
          <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" /> Top Funding Sources
          </p>
          <div className="space-y-1.5">
            {fundingSources.slice(0, 6).map((s) => (
              <div key={s.address} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/[0.03]">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: s.percentage > 50 ? '#ef4444' : s.percentage > 20 ? '#f97316' : '#22c55e' }}
                />
                <span className="text-xs font-mono text-white/40 truncate flex-1">
                  {s.label || `${s.address.slice(0, 4)}...${s.address.slice(-4)}`}
                </span>
                <span className="text-xs font-bold text-white/50 tabular-nums">
                  {s.totalSolReceived.toFixed(2)} SOL
                </span>
                <span className="text-[10px] text-white/25 w-8 text-right">{s.percentage}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
