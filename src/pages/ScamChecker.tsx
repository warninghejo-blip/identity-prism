/**
 * Scam Shield — 3-tab scanner: Sybil Analysis, Contract Check, Dark Pool Scan.
 * Mobile-first layout.
 */

import { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import {
  ArrowLeft, Search, Shield, ShieldAlert, ShieldCheck, AlertTriangle,
  CheckCircle, Loader2, ExternalLink, Copy, User, FileCode, Waves,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getHeliusProxyUrl } from '@/constants';

// ── Types ──

type TabId = 'sybil' | 'contract' | 'darkpool';

interface SybilSignal {
  id: string;
  name: string;
  detected: boolean;
  weight: number;
  severity: 'info' | 'warning' | 'danger';
  category?: 'behavioral' | 'financial' | 'network';
  value?: string;
  description?: string;
}

interface SybilResult {
  address: string;
  riskScore: number;
  riskLevel: 'clean' | 'low' | 'medium' | 'high' | 'critical';
  trustScore: number;
  trustGrade: string;
  signals: SybilSignal[];
  behaviorProfile: { txTimingVariance: number; protocolDiversity: number; timingCV?: number | null; activeDaysRatio?: number };
  metrics?: {
    walletAgeDays: number; activeDaysCount: number; activeDaysRatio: number;
    tokenDiversityCount: number; nftCount: number;
    incomingVolume: number; outgoingVolume: number; flowRatio: number;
    dustRatio: number; uniquePrograms: number;
    balance: number; historicalMaxBalance: number; txCount: number; clusterSimilarity: number;
  };
  timestamp: string;
}

interface ScamCheckResult {
  address: string;
  isKnownScam: boolean;
  isExecutable: boolean;
  programInfo: { executable: boolean; owner: string; lamports: number; dataSize: number } | null;
  verdict: string;
}

interface DarkPoolResult {
  address: string;
  scamInteractions: { program?: string; address?: string; signature: string; blockTime: string | null }[];
  scamCount: number;
  totalProgramsUsed: number;
  riskLevel: 'clean' | 'medium' | 'high' | 'unknown';
}

// ── Helpers ──

function getApiBase(): string {
  const proxy = getHeliusProxyUrl();
  if (proxy) return proxy;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

const TABS: { id: TabId; label: string; icon: typeof User }[] = [
  { id: 'sybil', label: 'Sybil Check', icon: User },
  { id: 'contract', label: 'Contract', icon: FileCode },
  { id: 'darkpool', label: 'Dark Pool', icon: Waves },
];

const RISK_COLORS: Record<string, string> = {
  clean: '#22c55e',
  low: '#86efac',
  medium: '#f59e0b',
  high: '#ef4444',
  critical: '#dc2626',
  unknown: '#6b7280',
};

const SEVERITY_COLORS: Record<string, string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  danger: '#ef4444',
};

function riskColor(level: string) {
  return RISK_COLORS[level] || '#6b7280';
}

export default function ScamChecker() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { publicKey } = useWallet();

  const [tab, setTab] = useState<TabId>('sybil');
  const [input, setInput] = useState(searchParams.get('address') || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Results
  const [sybilResult, setSybilResult] = useState<SybilResult | null>(null);
  const [contractResult, setContractResult] = useState<ScamCheckResult | null>(null);
  const [darkPoolResult, setDarkPoolResult] = useState<DarkPoolResult | null>(null);

  const clearResults = () => {
    setSybilResult(null);
    setContractResult(null);
    setDarkPoolResult(null);
    setError('');
  };

  const handleCheck = useCallback(async () => {
    const addr = input.trim();
    if (!addr || addr.length < 32) {
      setError('Enter a valid Solana address (32+ characters)');
      return;
    }
    setLoading(true);
    setError('');
    clearResults();

    const base = getApiBase();

    try {
      if (tab === 'sybil') {
        const res = await fetch(`${base}/api/sybil/analysis?address=${encodeURIComponent(addr)}`);
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data: SybilResult = await res.json();
        setSybilResult(data);
      } else if (tab === 'contract') {
        const res = await fetch(`${base}/api/scam-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr }),
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data: ScamCheckResult = await res.json();
        setContractResult(data);
      } else {
        const res = await fetch(`${base}/api/sybil/dark-pool?address=${encodeURIComponent(addr)}`);
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data: DarkPoolResult = await res.json();
        setDarkPoolResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check failed — try again');
    } finally {
      setLoading(false);
    }
  }, [input, tab]);

  const handleMyWallet = useCallback(() => {
    if (publicKey) {
      setInput(publicKey.toBase58());
    } else {
      toast.error('Connect wallet first');
    }
  }, [publicKey]);

  const copyAddr = (addr: string) => {
    navigator.clipboard?.writeText(addr).then(() => toast.success('Copied!')).catch(() => {});
  };

  const placeholder = tab === 'contract' ? 'Paste contract/program address...' : 'Paste wallet address...';
  const hasResult = sybilResult || contractResult || darkPoolResult;

  return (
    <div className="min-h-screen bg-[#05070a] text-white pb-safe">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-black/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => goBack(navigate)} className="text-white/50 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Shield className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">
            Scam Shield
          </h1>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-white/[0.06] bg-black/40">
        <div className="max-w-2xl mx-auto px-2 flex">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); clearResults(); }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold tracking-wide transition-colors border-b-2 ${
                  tab === t.id
                    ? 'border-blue-400 text-blue-400'
                    : 'border-transparent text-white/40 hover:text-white/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-24">
        {/* Description */}
        <p className="text-white/30 text-xs mb-4 leading-relaxed">
          {tab === 'sybil' && 'Comprehensive sybil risk analysis — checks 12 risk signals across behavioral, financial, and network categories. Includes Trust Score with letter grade.'}
          {tab === 'contract' && 'Check any Solana program/contract against our scam database and verify on-chain account details.'}
          {tab === 'darkpool' && 'Scan wallet transactions for interactions with known scam contracts and suspicious addresses.'}
        </p>

        {/* Input */}
        <div className="flex flex-col gap-3 mb-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
              placeholder={placeholder}
              className="w-full pl-10 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 font-mono"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCheck} disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold h-12">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
              {loading ? 'Scanning...' : 'Scan'}
            </Button>
            {tab !== 'contract' && (
              <Button onClick={handleMyWallet} variant="outline" className="border-white/10 text-white/50 h-12 px-4">
                My Wallet
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={handleCheck} className="text-red-400/60 hover:text-red-300">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ═══ SYBIL ANALYSIS RESULT ═══ */}
        {sybilResult && (() => {
          const trustScore = sybilResult.trustScore ?? (100 - sybilResult.riskScore);
          const trustGrade = sybilResult.trustGrade ?? 'N/A';
          const trustColor = trustScore >= 80 ? '#22c55e' : trustScore >= 60 ? '#3b82f6' : trustScore >= 40 ? '#eab308' : trustScore >= 20 ? '#f97316' : '#ef4444';
          const behavioral = sybilResult.signals.filter(s => s.category === 'behavioral');
          const financial = sybilResult.signals.filter(s => s.category === 'financial');
          const network = sybilResult.signals.filter(s => s.category === 'network');
          const hasCategories = behavioral.length > 0 || financial.length > 0 || network.length > 0;
          const flagged = sybilResult.signals.filter(s => s.detected).length;

          const renderCategory = (title: string, sigs: SybilSignal[], catColor: string) => {
            if (sigs.length === 0) return null;
            const passed = sigs.filter(s => !s.detected).length;
            return (
              <div className="mb-3" key={title}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: catColor }} />
                  <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: catColor }}>{title}</span>
                  <div className="flex-1 h-px bg-white/[0.06]" />
                  <span className="text-[10px] text-white/25 font-mono">{passed}/{sigs.length} passed</span>
                </div>
                <div className="space-y-1.5">
                  {sigs.map((sig) => (
                    <div
                      key={sig.id}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs ${
                        sig.detected ? 'bg-red-500/8 border border-red-500/15' : 'bg-white/[0.02] border border-white/[0.04]'
                      }`}
                    >
                      {sig.detected ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={SEVERITY_COLORS[sig.severity]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                          <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={sig.detected ? 'text-white/80 font-medium' : 'text-white/30'}>{sig.name}</span>
                          {sig.value && <span className="text-[10px] font-mono text-white/25">{sig.value}</span>}
                        </div>
                        {sig.description && sig.detected && (
                          <p className="text-[9px] text-white/20 mt-0.5">{sig.description}</p>
                        )}
                      </div>
                      {sig.detected && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ color: SEVERITY_COLORS[sig.severity], background: `${SEVERITY_COLORS[sig.severity]}15` }}>
                          +{sig.weight}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          };

          return (
          <div className="space-y-4">
            {/* Trust Score Header */}
            <div className="rounded-xl border p-5" style={{ borderColor: `${trustColor}30`, background: `${trustColor}08` }}>
              <div className="flex items-center gap-5 mb-5">
                {/* Trust Grade Circle */}
                <div className="relative flex-shrink-0">
                  <svg width="80" height="80" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                    <circle
                      cx="40" cy="40" r="34" fill="none"
                      stroke={trustColor}
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${(trustScore / 100) * 213.63} 213.63`}
                      transform="rotate(-90 40 40)"
                      style={{ filter: `drop-shadow(0 0 6px ${trustColor}50)` }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-black font-mono leading-none" style={{ color: trustColor }}>{trustGrade}</span>
                    <span className="text-[9px] text-white/25 mt-0.5">{trustScore}/100</span>
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white/50 uppercase tracking-wider mb-1">Trust Score</p>
                  <p className="text-2xl font-black" style={{ color: trustColor }}>{trustScore}</p>
                  <p className="text-xs mt-1" style={{ color: riskColor(sybilResult.riskLevel) }}>
                    {sybilResult.riskLevel === 'clean' ? 'No risk detected' :
                     sybilResult.riskLevel === 'low' ? 'Low sybil risk' :
                     sybilResult.riskLevel === 'medium' ? 'Moderate sybil risk' :
                     sybilResult.riskLevel === 'high' ? 'High sybil risk' : 'Critical sybil risk'}
                    {' '}({flagged}/{sybilResult.signals.length} signals flagged)
                  </p>
                  <button onClick={() => copyAddr(sybilResult.address)} className="text-white/30 text-[10px] font-mono flex items-center gap-1 mt-1.5 active:text-white/60">
                    {sybilResult.address.slice(0, 10)}...{sybilResult.address.slice(-6)}
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Metrics Grid */}
              {sybilResult.metrics && (
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[
                    { label: 'Wallet Age', value: `${sybilResult.metrics.walletAgeDays}d`, pct: Math.min(sybilResult.metrics.walletAgeDays / 730, 1) },
                    { label: 'Tokens', value: `${sybilResult.metrics.tokenDiversityCount}`, pct: Math.min(sybilResult.metrics.tokenDiversityCount / 15, 1) },
                    { label: 'NFTs', value: `${sybilResult.metrics.nftCount}`, pct: Math.min(sybilResult.metrics.nftCount / 20, 1) },
                    { label: 'Programs', value: `${sybilResult.metrics.uniquePrograms}`, pct: Math.min(sybilResult.metrics.uniquePrograms / 15, 1) },
                    { label: 'Active Days', value: `${sybilResult.metrics.activeDaysCount}`, pct: Math.min(sybilResult.metrics.activeDaysRatio, 1) },
                    { label: 'Dust Ratio', value: `${sybilResult.metrics.dustRatio}%`, pct: 1 - sybilResult.metrics.dustRatio / 100 },
                  ].map(m => (
                    <div key={m.label} className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.04]">
                      <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1">{m.label}</p>
                      <p className="text-sm font-bold text-white/70 font-mono">{m.value}</p>
                      <div className="mt-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${Math.max(m.pct * 100, 2)}%`,
                          background: m.pct > 0.5 ? '#22c55e' : m.pct > 0.25 ? '#f59e0b' : '#ef4444',
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Behavior profile (compact) */}
              {sybilResult.behaviorProfile && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 rounded-lg bg-white/5">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">Timing Variance</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${sybilResult.behaviorProfile.txTimingVariance * 100}%`,
                          background: sybilResult.behaviorProfile.txTimingVariance > 0.5 ? '#22c55e' : sybilResult.behaviorProfile.txTimingVariance > 0.25 ? '#f59e0b' : '#ef4444',
                        }} />
                      </div>
                      <span className="text-xs font-bold text-white/60">{(sybilResult.behaviorProfile.txTimingVariance * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-[9px] text-white/20 mt-1">{sybilResult.behaviorProfile.txTimingVariance > 0.5 ? 'Human-like' : sybilResult.behaviorProfile.txTimingVariance > 0.25 ? 'Suspicious' : 'Robotic'}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-white/5">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">Protocol Diversity</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${sybilResult.behaviorProfile.protocolDiversity * 100}%`,
                          background: sybilResult.behaviorProfile.protocolDiversity > 0.4 ? '#22c55e' : sybilResult.behaviorProfile.protocolDiversity > 0.15 ? '#f59e0b' : '#ef4444',
                        }} />
                      </div>
                      <span className="text-xs font-bold text-white/60">{(sybilResult.behaviorProfile.protocolDiversity * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-[9px] text-white/20 mt-1">{sybilResult.behaviorProfile.protocolDiversity > 0.4 ? 'Diverse' : sybilResult.behaviorProfile.protocolDiversity > 0.15 ? 'Limited' : 'Very low'}</p>
                  </div>
                </div>
              )}

              {/* Categorized Signals */}
              {hasCategories ? (
                <>
                  {renderCategory('Behavioral', behavioral, '#818cf8')}
                  {renderCategory('Financial', financial, '#34d399')}
                  {renderCategory('Network', network, '#f472b6')}
                </>
              ) : (
                /* Fallback: flat signal list for old API format */
                <div className="space-y-1.5">
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider mb-2">Risk Signals ({flagged}/{sybilResult.signals.length})</p>
                  {sybilResult.signals.map((sig) => (
                    <div
                      key={sig.id}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs ${
                        sig.detected ? 'bg-red-500/8 border border-red-500/15' : 'bg-white/[0.02] border border-white/[0.04]'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sig.detected ? SEVERITY_COLORS[sig.severity] : 'rgba(255,255,255,0.15)' }} />
                      <span className={sig.detected ? 'text-white/80 font-medium' : 'text-white/30'}>{sig.name}</span>
                      <span className="ml-auto text-[10px] text-white/20">w:{sig.weight}</span>
                      {sig.detected && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: SEVERITY_COLORS[sig.severity], background: `${SEVERITY_COLORS[sig.severity]}15` }}>
                          {sig.severity.toUpperCase()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <a
              href={`https://explorer.solana.com/address/${sybilResult.address}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 text-cyan-400/60 text-xs hover:text-cyan-300 py-2"
            >
              View on Explorer <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        );
        })()}

        {/* ═══ CONTRACT CHECK RESULT ═══ */}
        {contractResult && (
          <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: contractResult.isKnownScam ? '#ef444440' : '#22c55e40', background: contractResult.isKnownScam ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)' }}>
            <div className="flex items-center gap-3">
              {contractResult.isKnownScam ? (
                <ShieldAlert className="w-10 h-10 text-red-500 flex-shrink-0" />
              ) : (
                <ShieldCheck className="w-10 h-10 text-green-500 flex-shrink-0" />
              )}
              <div>
                <p className="font-bold text-sm" style={{ color: contractResult.isKnownScam ? '#ef4444' : '#22c55e' }}>
                  {contractResult.verdict}
                </p>
                <button onClick={() => copyAddr(contractResult.address)} className="text-white/30 text-[10px] font-mono flex items-center gap-1 mt-1 active:text-white/60">
                  {contractResult.address.slice(0, 12)}...{contractResult.address.slice(-8)}
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>

            {contractResult.programInfo && (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-white/5">
                  <p className="text-white/30 mb-1">Executable</p>
                  <p className="font-bold" style={{ color: contractResult.programInfo.executable ? '#22c55e' : '#f59e0b' }}>
                    {contractResult.programInfo.executable ? 'Yes' : 'No'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-white/5">
                  <p className="text-white/30 mb-1">Data Size</p>
                  <p className="font-bold text-white">{(contractResult.programInfo.dataSize / 1024).toFixed(1)} KB</p>
                </div>
                <div className="p-3 rounded-lg bg-white/5 col-span-2">
                  <p className="text-white/30 mb-1">Owner</p>
                  <p className="font-mono text-white/60 text-[10px] break-all">{contractResult.programInfo.owner}</p>
                </div>
              </div>
            )}

            {!contractResult.programInfo && (
              <div className="p-3 rounded-lg bg-white/5 text-center">
                <p className="text-white/30 text-xs">Account not found or not a program</p>
              </div>
            )}

            <a
              href={`https://explorer.solana.com/address/${contractResult.address}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 text-cyan-400/60 text-xs hover:text-cyan-300 py-2"
            >
              View on Explorer <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* ═══ DARK POOL RESULT ═══ */}
        {darkPoolResult && (
          <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: `${riskColor(darkPoolResult.riskLevel)}40` }}>
            <div className="flex items-center gap-3">
              {darkPoolResult.riskLevel === 'clean' || darkPoolResult.riskLevel === 'unknown' ? (
                <CheckCircle className="w-10 h-10 flex-shrink-0" style={{ color: darkPoolResult.riskLevel === 'clean' ? riskColor('clean') : '#6b7280' }} />
              ) : darkPoolResult.riskLevel === 'high' ? (
                <ShieldAlert className="w-10 h-10 flex-shrink-0" style={{ color: riskColor('high') }} />
              ) : (
                <AlertTriangle className="w-10 h-10 flex-shrink-0" style={{ color: riskColor(darkPoolResult.riskLevel) }} />
              )}
              <div>
                <p className="font-bold text-sm" style={{ color: riskColor(darkPoolResult.riskLevel) }}>
                  {darkPoolResult.riskLevel === 'clean' ? 'No scam interactions detected' :
                   darkPoolResult.riskLevel === 'medium' ? 'Caution — some suspicious interactions' :
                   darkPoolResult.riskLevel === 'high' ? 'Warning — multiple scam interactions' :
                   'Scan complete — no flagged data found'}
                </p>
                <p className="text-white/30 text-xs mt-1">{darkPoolResult.totalProgramsUsed} programs used, {darkPoolResult.scamCount} flagged</p>
              </div>
            </div>

            {darkPoolResult.scamInteractions.length > 0 && (
              <div className="space-y-2">
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Flagged Interactions</p>
                {darkPoolResult.scamInteractions.map((item, i) => (
                  <div key={i} className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-red-400 font-bold">
                        {item.program ? 'Scam Program' : 'Scam Address'}
                      </span>
                      {item.blockTime && (
                        <span className="text-white/20">{new Date(item.blockTime).toLocaleDateString()}</span>
                      )}
                    </div>
                    <p className="font-mono text-white/40 text-[10px] break-all">
                      {item.program || item.address}
                    </p>
                    <a
                      href={`https://explorer.solana.com/tx/${item.signature}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400/50 text-[10px] flex items-center gap-1 mt-1"
                    >
                      View TX <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                ))}
              </div>
            )}

            {darkPoolResult.scamInteractions.length === 0 && darkPoolResult.riskLevel === 'clean' && (
              <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/10 text-center">
                <CheckCircle className="w-8 h-8 mx-auto text-green-500 mb-2" />
                <p className="text-green-400 text-sm font-bold">Wallet is clean</p>
                <p className="text-white/30 text-xs mt-1">No interactions with known scam contracts found</p>
              </div>
            )}
          </div>
        )}

        {/* Info box */}
        {!hasResult && !loading && (
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 mt-2">
            <h3 className="text-white/50 text-xs font-bold mb-2">How it works</h3>
            <ul className="text-white/25 text-xs space-y-1.5 leading-relaxed">
              <li><strong className="text-white/40">Sybil Check:</strong> analyzes 10 risk signals — wallet age, funding patterns, timing behavior, protocol diversity, cluster membership</li>
              <li><strong className="text-white/40">Contract Check:</strong> verifies if a program is flagged in our scam database + on-chain account info</li>
              <li><strong className="text-white/40">Dark Pool:</strong> scans last 100 transactions for interactions with known scam contracts</li>
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
