/**
 * Sybil Hunt — Gamified sybil detection bounty system.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useActiveWalletAddress } from '@/lib/useActiveWalletAddress';
import { friendlyVerdict } from '@/lib/sybilFriendly';
import {
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
  Crosshair,
  Trophy,
  Target,
  Coins,
  RotateCcw,
  Flag,
  Send,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageShell from '@/components/PageShell';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
import HubReturnButton from '@/components/HubReturnButton';
import {
  fetchWalletPreview,
  formatWalletAge,
  ensureJwt,
  getApiBase,
  setAuthWallet,
  type SybilVerdictSummary,
  type WalletPreview,
} from '@/components/prism/shared';
import { earnPrism } from '@/lib/prismCoin';
import { toast } from 'sonner';
import { getProgramLabel, PROGRAM_LABELS } from '@/lib/solanaPrograms';

const RECENT_WALLETS_KEY = 'prism_recent_scans';
const SCAN_HISTORY_KEY = 'prism_scan_history_v1';
const BASE = () => getApiBase();
const SYBIL_FETCH_TIMEOUT_MS = 20_000;

async function fetchJsonWithTimeout(url: string, init: RequestInit = {}, timeoutMs = SYBIL_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readJsonSafe<T>(response: Response, label: string): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    throw new Error(`${label} returned a non-JSON response`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

/* ── Scan History (with verdict) ── */
interface ScanHistoryEntry {
  address: string;
  verdict: string;
  verdictKey: string;
  score: number;
  timestamp: number;
}
function getScanHistory(): ScanHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(SCAN_HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveToScanHistory(address: string, verdictKey: string, verdict: string, score: number) {
  try {
    const history = getScanHistory().filter((h) => h.address !== address);
    history.unshift({ address, verdict, verdictKey, score, timestamp: Date.now() });
    if (history.length > 20) history.length = 20;
    localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

/* ── Hunt stats (localStorage) ── */
const HUNT_STATS_KEY = 'sybil_hunt_stats_v1';
interface HuntStats {
  totalHunts: number;
  sybilsCaught: number;
  coinsEarned: number;
}
function getHuntStats(): HuntStats {
  try {
    return JSON.parse(localStorage.getItem(HUNT_STATS_KEY) || '{}') as HuntStats;
  } catch {
    return { totalHunts: 0, sybilsCaught: 0, coinsEarned: 0 };
  }
}
function updateHuntStats(update: Partial<HuntStats>) {
  const stats = getHuntStats();
  const merged = {
    totalHunts: (stats.totalHunts || 0) + (update.totalHunts || 0),
    sybilsCaught: (stats.sybilsCaught || 0) + (update.sybilsCaught || 0),
    coinsEarned: (stats.coinsEarned || 0) + (update.coinsEarned || 0),
  };
  localStorage.setItem(HUNT_STATS_KEY, JSON.stringify(merged));
  return merged;
}

function getRecentWallets(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_WALLETS_KEY) || '[]');
  } catch {
    return [];
  }
}
function addRecentWallet(addr: string) {
  try {
    const list = getRecentWallets().filter((a) => a !== addr);
    list.unshift(addr);
    localStorage.setItem(RECENT_WALLETS_KEY, JSON.stringify(list.slice(0, 200)));
  } catch {}
}
function isAlreadyScanned(addr: string): boolean {
  return getRecentWallets().includes(addr);
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
  metrics: Record<string, unknown> & { siblingAddresses?: string[]; siblingCount?: number };
  behaviorProfile: Record<string, unknown>;
  verdict?: SybilVerdictSummary | null;
  primaryFundingSource?: FundingSource | null;
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

type BatchSybilResult = {
  trustGrade?: string;
  riskScore?: number;
  riskLevel?: string;
  trustScore?: number;
  verdict?: SybilVerdictSummary;
  source?: string;
};

function buildFallbackAnalysis(entry: BatchSybilResult): SybilAnalysis | null {
  const riskScore = Number(entry.riskScore);
  if (!Number.isFinite(riskScore) || riskScore < 0) return null;
  const trustScore = Number.isFinite(Number(entry.trustScore))
    ? Number(entry.trustScore)
    : Math.max(0, 100 - riskScore);
  return {
    riskScore,
    riskLevel:
      entry.riskLevel || (riskScore >= 75 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 30 ? 'medium' : 'low'),
    trustScore,
    trustGrade: entry.trustGrade || (trustScore >= 80 ? 'A' : trustScore >= 65 ? 'B' : trustScore >= 50 ? 'C' : 'F'),
    signals: [
      {
        type: 'graph_intel',
        detected: riskScore >= 30,
        severity: riskScore >= 75 ? 'high' : riskScore >= 30 ? 'medium' : 'low',
        message: 'Graph intelligence fallback used because full analysis exceeded the mobile response budget.',
      },
    ],
    metrics: { txCount: 10, fallbackSource: entry.source || 'graph' },
    behaviorProfile: {},
    verdict: entry.verdict || null,
  };
}

const VERDICT_DATA_QUALITY_LABELS: Record<SybilVerdictSummary['dataQuality'], string> = {
  none: 'no data',
  thin: 'thin data',
  sampled: 'sampled',
  rich: 'rich history',
};

function createPendingWalletPreview(address: string): WalletPreview {
  return {
    address,
    score: 0,
    tier: 'mercury',
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
    compositeScore: 0,
    compositeTier: 'mercury',
    compositeBadgeCount: 0,
    compositeBreakdown: { onchain: 0, sybilTrust: 0, humanProof: 0, social: 0, engagement: 0 },
  };
}

function resolveAnalysisVerdict(data: SybilAnalysis): SybilVerdictSummary {
  if (data.verdict) return data.verdict;

  const flaggedSignals = data.signals.filter((signal) => signal.detected).length;
  const txCount = Number(data.metrics?.txCount) || 0;
  const dataQuality: SybilVerdictSummary['dataQuality'] =
    txCount === 0 ? 'none' : txCount < 10 ? 'thin' : txCount < 50 ? 'sampled' : 'rich';
  const baseEvidence = {
    flaggedSignals,
    strongNetworkCount: 0,
    supportingNetworkCount: 0,
    strongBehaviorCount: 0,
    supportingBehaviorCount: 0,
    positiveIdentityCount: 0,
  };

  if (txCount < 10) {
    return {
      key: 'unknown',
      label: 'Unknown / Thin Data',
      summary:
        'This cached scan predates the new verdict model, so low-history wallets stay inconclusive until they are rescanned.',
      confidence: 'low',
      confidenceScore: 35,
      basis: 'insufficient_data',
      dataQuality,
      networkConfirmed: false,
      legacySybilFlag: data.trustScore < 50,
      bountyEligible: false,
      rewardPath: 'scan_wallet',
      reasons: ['Very little transaction history is available for a hard verdict'],
      evidence: baseEvidence,
    };
  }

  if (data.trustScore < 50 || data.riskScore >= 30) {
    return {
      key: 'suspicious',
      label: 'Suspicious',
      summary: 'Risk is elevated, but a server verdict is required before paying a sybil bounty.',
      confidence: 'medium',
      confidenceScore: 55,
      basis: 'behavioral',
      dataQuality,
      networkConfirmed: false,
      legacySybilFlag: data.trustScore < 50,
      bountyEligible: false,
      rewardPath: 'scan_wallet',
      reasons: ['A fresh server verdict is needed to separate watchlist risk from a confirmed sybil call'],
      evidence: baseEvidence,
    };
  }

  return {
    key: 'clean',
    label: 'Clean',
    summary: 'No strong sybil evidence is visible in this cached scan.',
    confidence: 'medium',
    confidenceScore: 60,
    basis: 'organic',
    dataQuality,
    networkConfirmed: false,
    legacySybilFlag: false,
    bountyEligible: false,
    rewardPath: 'scan_wallet',
    reasons: ['No strong sybil signals were preserved in this cached scan'],
    evidence: baseEvidence,
  };
}

const isSybilReportVerdict = (key?: string | null) =>
  key === 'confirmed_sybil' || key === 'probable_sybil' || key === 'suspicious' || key === 'cluster_linked';

function getVerdictTheme(key: SybilVerdictSummary['key']) {
  switch (key) {
    case 'confirmed_sybil':
      return {
        panelClass: 'bg-gradient-to-r from-red-500/10 to-amber-500/10 border-red-500/20',
        badgeClass: 'bg-red-500/15 border border-red-500/20 text-red-300',
        chipClass: 'bg-red-500/10 border border-red-500/15 text-red-200/80',
        titleClass: 'text-red-400',
        summaryClass: 'text-red-300/70',
        rewardClass: 'bg-amber-500/15 border border-amber-500/20 text-amber-300',
      };
    case 'probable_sybil':
      return {
        panelClass: 'bg-gradient-to-r from-orange-500/10 to-amber-500/10 border-orange-500/20',
        badgeClass: 'bg-orange-500/15 border border-orange-500/20 text-orange-300',
        chipClass: 'bg-orange-500/10 border border-orange-500/15 text-orange-200/80',
        titleClass: 'text-orange-300',
        summaryClass: 'text-orange-200/70',
        rewardClass: 'bg-amber-500/15 border border-amber-500/20 text-amber-300',
      };
    case 'cluster_linked':
    case 'suspicious':
      return {
        panelClass: 'bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border-amber-500/20',
        badgeClass: 'bg-amber-500/15 border border-amber-500/20 text-amber-200',
        chipClass: 'bg-amber-500/10 border border-amber-500/15 text-amber-100/80',
        titleClass: 'text-amber-300',
        summaryClass: 'text-amber-100/70',
        rewardClass: 'bg-white/[0.04] border border-white/[0.06] text-white/60',
      };
    case 'unknown':
      return {
        panelClass: 'bg-gradient-to-r from-slate-500/10 to-cyan-500/10 border-slate-500/20',
        badgeClass: 'bg-slate-500/15 border border-slate-500/20 text-slate-200',
        chipClass: 'bg-slate-500/10 border border-slate-500/15 text-slate-100/80',
        titleClass: 'text-slate-200',
        summaryClass: 'text-slate-200/70',
        rewardClass: 'bg-white/[0.04] border border-white/[0.06] text-white/60',
      };
    default:
      return {
        panelClass: 'bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border-emerald-500/20',
        badgeClass: 'bg-emerald-500/15 border border-emerald-500/20 text-emerald-200',
        chipClass: 'bg-emerald-500/10 border border-emerald-500/15 text-emerald-100/80',
        titleClass: 'text-emerald-300',
        summaryClass: 'text-emerald-200/70',
        rewardClass: 'bg-white/[0.04] border border-white/[0.06] text-white/60',
      };
  }
}

const formatConfidence = (confidence: SybilVerdictSummary['confidence']) => confidence.replace('_', ' ');

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
      aria-label={copied ? 'Copied!' : 'Copy address'}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-white/30" />}
    </button>
  );
}

/* ── Quiz while scanning ── */
interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  category: string;
  difficulty: string;
}

function ScanningSequence({ targetAddress, walletAddress }: { targetAddress: string; walletAddress: string }) {
  const [phase, setPhase] = useState(0);
  const [quiz, setQuiz] = useState<QuizQuestion | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{ correct: boolean; correctAnswer: string; earned: number } | null>(null);
  const [quizScore, setQuizScore] = useState({ correct: 0, wrong: 0, earned: 0 });
  const [loadingAnswer, setLoadingAnswer] = useState(false);
  const fetchedRef = useRef(false);

  // Progress phases
  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 600),
      setTimeout(() => setPhase(2), 1800),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 5500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Fetch first question
  const fetchQuestion = useCallback(async () => {
    try {
      const r = await fetch(`${BASE()}/api/quiz/question`);
      if (r.ok) {
        const q = await r.json();
        setQuiz(q);
        setSelected(null);
        setResult(null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchQuestion();
    }
  }, [fetchQuestion]);

  const handleAnswer = async (answer: string) => {
    if (selected || !quiz) return;
    setSelected(answer);
    setLoadingAnswer(true);
    try {
      const jwt = await ensureJwt();
      if (!jwt) {
        toast.error('Sign in to submit quiz answers');
        setLoadingAnswer(false);
        return;
      }
      const r = await fetch(`${BASE()}/api/quiz/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ id: quiz.id, answer, address: walletAddress }),
      });
      if (r.ok) {
        const res = await r.json();
        setResult(res);
        setQuizScore((prev) => ({
          correct: prev.correct + (res.correct ? 1 : 0),
          wrong: prev.wrong + (res.correct ? 0 : 1),
          earned: prev.earned + (res.earned || 0),
        }));
        // Auto-fetch next question after 2s
        setTimeout(() => fetchQuestion(), 2000);
      }
    } catch {
      /* ignore */
    }
    setLoadingAnswer(false);
  };

  const phases = [
    'Connecting to Solana RPC...',
    'Fetching transaction history',
    'Analyzing 23 risk signals',
    'Tracing funding graph',
    'Profiling behavior patterns',
  ];

  const catLabel: Record<string, string> = {
    solana: 'Solana',
    blockchain: 'Blockchain',
    culture: 'Crypto Culture',
    security: 'Security',
    technical: 'Technical',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Sybil scan in progress"
      className="rounded-xl border border-amber-500/[0.15] bg-gradient-to-br from-amber-900/[0.08] to-red-900/[0.06] p-4 animate-in fade-in duration-300"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Crosshair className="w-6 h-6 text-amber-400 animate-spin" style={{ animationDuration: '3s' }} />
            <div
              className="absolute inset-0 w-6 h-6 rounded-full border border-amber-400/20 animate-ping"
              style={{ animationDuration: '2s' }}
            />
          </div>
          <div>
            <p className="text-sm font-bold text-amber-200/80">Hunting Target...</p>
            <p className="text-[10px] text-white/25 font-mono">
              {targetAddress.slice(0, 10)}...{targetAddress.slice(-6)}
            </p>
          </div>
        </div>
        {quizScore.earned > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <Coins className="w-3 h-3 text-amber-400" />
            <span className="text-xs font-bold text-amber-300">+{quizScore.earned}</span>
          </div>
        )}
      </div>

      {/* Quiz Area */}
      {quiz ? (
        <div className="mb-3 rounded-lg bg-black/20 border border-amber-500/[0.08] p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/70">
              {catLabel[quiz.category] || quiz.category}
            </span>
            <span className="text-[9px] text-white/20">+5 coins</span>
            {quizScore.correct + quizScore.wrong > 0 && (
              <span className="text-[9px] text-white/20 ml-auto">
                {quizScore.correct}/{quizScore.correct + quizScore.wrong}
              </span>
            )}
          </div>
          <p className="text-xs text-white/70 mb-3 leading-relaxed">{quiz.question}</p>
          <div className="grid grid-cols-1 gap-1.5">
            {quiz.options.map((opt) => {
              let cls = 'text-left w-full px-3 py-2 rounded-lg text-xs transition-all duration-200 ';
              if (!selected) {
                cls +=
                  'bg-white/[0.03] border border-white/[0.06] text-white/60 hover:bg-amber-500/10 hover:border-amber-500/20 hover:text-amber-200/80';
              } else if (opt === result?.correctAnswer) {
                cls += 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300';
              } else if (opt === selected && !result?.correct) {
                cls += 'bg-red-500/15 border border-red-500/30 text-red-300';
              } else {
                cls += 'bg-white/[0.02] border border-white/[0.04] text-white/20';
              }
              return (
                <button
                  key={opt}
                  onClick={() => handleAnswer(opt)}
                  disabled={!!selected || loadingAnswer}
                  className={cls}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {result && (
            <div
              className={`mt-2 text-center text-xs font-bold ${result.correct ? 'text-emerald-400' : 'text-red-400/70'}`}
            >
              {result.correct
                ? result.earned > 0
                  ? `Correct! +${result.earned} coins`
                  : 'Correct! (daily limit reached)'
                : `Wrong — ${result.correctAnswer}`}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-3 h-24 rounded-lg bg-black/20 border border-amber-500/[0.06] flex items-center justify-center">
          <Loader2 className="w-4 h-4 text-amber-400/30 animate-spin" />
        </div>
      )}

      {/* Progress steps */}
      <div className="space-y-1">
        {phases.map((step, i) => (
          <div key={step} className="flex items-center gap-2">
            <div
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                i < phase ? 'bg-amber-400' : i === phase ? 'bg-amber-400 animate-pulse' : 'bg-white/[0.06]'
              }`}
            />
            <span
              className={`text-[10px] font-mono transition-colors duration-300 ${
                i < phase ? 'text-amber-300/40' : i === phase ? 'text-amber-300/70' : 'text-white/[0.08]'
              }`}
            >
              {step}
              {i < phase && <span className="text-emerald-400/50 ml-1">✓</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PrismScanner() {
  const navigate = useNavigate();
  const wallet = useWallet();
  const { publicKey } = wallet;
  const myAddress = useActiveWalletAddress() || publicKey?.toBase58() || '';
  useEffect(() => {
    setAuthWallet(wallet);
  }, [wallet]);
  useEffect(() => {
    fadeOutTransition();
  }, []);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WalletPreview | null>(null);
  const [error, setError] = useState('');
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>(getScanHistory);

  // Data states
  const [sybilData, setSybilData] = useState<SybilAnalysis | null>(null);
  const [sybilLoading, setSybilLoading] = useState(false);
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([]);

  // Hunt states
  const [huntStats, setHuntStats] = useState<HuntStats>(getHuntStats);
  const [huntVerdict, setHuntVerdict] = useState<SybilVerdictSummary | null>(null);
  const [huntCoinsEarned, setHuntCoinsEarned] = useState(0);
  const [showVerdictAnim, setShowVerdictAnim] = useState(false);
  const [rescanUsedAt, setRescanUsedAt] = useState<number | null>(() => {
    try {
      return Number(sessionStorage.getItem('prism_rescan_ts')) || null;
    } catch {
      return null;
    }
  });
  const [isRescanning, setIsRescanning] = useState(false);
  const [rescanStep, setRescanStep] = useState('');
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  // Suggested targets from sybil graph
  const [suggestedTargets, setSuggestedTargets] = useState<
    { address: string; source: string; parentRisk?: number; parent?: string }[]
  >([]);
  const suggestedTargetExclusions = useMemo(() => getRecentWallets().slice(0, 40), [scanHistory]);
  useEffect(() => {
    const params = new URLSearchParams({ limit: '6' });
    if (suggestedTargetExclusions.length > 0) {
      params.set('exclude', suggestedTargetExclusions.join(','));
    }
    fetchJsonWithTimeout(`${BASE()}/api/sybil/suggested-targets?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.targets) setSuggestedTargets(d.targets);
      })
      .catch(() => {});
  }, [suggestedTargetExclusions]);

  const fetchSybil = useCallback(async (addr: string) => {
    const cached = sybilClientCache.get(addr);
    if (cached && Date.now() - cached.ts < 1800_000) {
      setSybilData(cached.data);
      processHuntVerdict(cached.data, addr);
      return;
    }
    setSybilLoading(true);
    try {
      const r = await fetchJsonWithTimeout(`${BASE()}/api/sybil/analysis?address=${encodeURIComponent(addr)}`);
      if (r.status === 429 && cached) {
        setSybilData(cached.data);
        processHuntVerdict(cached.data, addr);
        return;
      }
      if (!r.ok) {
        const data = await readJsonSafe<{ error?: string }>(r, 'Sybil analysis').catch(() => null);
        setSybilData(null);
        setError('Sybil analysis failed: ' + (data?.error || 'unknown error'));
        return;
      }
      const data = await readJsonSafe<SybilAnalysis>(r, 'Sybil analysis');
      sybilClientCache.set(addr, { data, ts: Date.now() });
      setSybilData(data);
      processHuntVerdict(data, addr);
    } catch {
      try {
        const batchRes = await fetchJsonWithTimeout(`${BASE()}/api/sybil/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: [addr] }),
        });
        const batchData = batchRes.ok ? await readJsonSafe<any>(batchRes, 'Sybil fallback') : null;
        const fallback = buildFallbackAnalysis(batchData?.results?.[addr] || {});
        if (fallback) {
          sybilClientCache.set(addr, { data: fallback, ts: Date.now() });
          setSybilData(fallback);
          processHuntVerdict(fallback, addr);
          setError('');
          return;
        }
      } catch {
        /* keep user-facing timeout below */
      }
      setSybilData(null);
      setError('Sybil analysis is still warming up. Try another target or retry in a few seconds.');
    } finally {
      setSybilLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRescan = useCallback(async () => {
    if (!result?.address) return;
    const remainingMs = rescanUsedAt ? 86_400_000 - (Date.now() - rescanUsedAt) : 0;
    if (remainingMs > 0) {
      const hoursLeft = Math.ceil(remainingMs / 3_600_000);
      toast(`1 free re-scan per day · available in ${hoursLeft}h`);
      return;
    }
    sybilClientCache.delete(result.address);
    setIsRescanning(true);
    try {
      const steps = [
        'Fetching tx history (1/5)...',
        'Analyzing patterns (2/5)...',
        'Checking network links (3/5)...',
        'Computing trust score (4/5)...',
        'Finalizing verdict (5/5)...',
      ];
      for (const step of steps) {
        setRescanStep(step);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      await fetchSybil(result.address);
      const ts = Date.now();
      setRescanUsedAt(ts);
      try {
        sessionStorage.setItem('prism_rescan_ts', String(ts));
      } catch {}
      toast('Verdict updated');
    } finally {
      setIsRescanning(false);
      setRescanStep('');
    }
  }, [fetchSybil, rescanUsedAt, result?.address]);

  const handleFeedbackSubmit = useCallback(async () => {
    if (!result?.address || !huntVerdict) return;
    try {
      const jwt = await ensureJwt();
      if (!jwt) {
        toast('Connect wallet to submit feedback');
        return;
      }
      const res = await fetchJsonWithTimeout(`${BASE()}/api/sybil/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          target_address: result.address,
          report_type: isSybilReportVerdict(huntVerdict.key) ? 'sybil' : 'false_positive',
          notes: `Verdict: ${huntVerdict.key}. ${feedbackText.trim()}`.slice(0, 1000),
        }),
      });
      if (!res.ok) throw new Error('Feedback rejected');
    } catch {
      toast('Feedback failed, try again');
      return;
    }
    toast(isSybilReportVerdict(huntVerdict.key) ? 'Sybil report submitted' : 'Thanks, flagged for review');
    setShowFeedbackModal(false);
    setFeedbackText('');
  }, [feedbackText, huntVerdict, result?.address]);

  const processHuntVerdict = useCallback(
    (data: SybilAnalysis, addr: string) => {
      if (!data) return;
      const verdict = resolveAnalysisVerdict(data);
      // Save to history regardless of self-scan
      saveToScanHistory(addr, verdict.key, verdict.label, data.trustScore ?? 0);
      setScanHistory(getScanHistory());

      if (!myAddress || addr === myAddress) return; // don't reward self-scan
      const rewardPath = verdict.rewardPath;
      setHuntVerdict(verdict);
      setShowVerdictAnim(true);
      setTimeout(() => setShowVerdictAnim(false), 3000);

      setHuntCoinsEarned(0);
      // Ensure server-side sybil cache is warm before claiming earn reward.
      // Server requires a recent analysis (1h TTL) to approve scan_wallet/sybil_hunt.
      // If server restarted, its in-memory cache is gone even if client has cached data.
      void fetchJsonWithTimeout(`${BASE()}/api/sybil/analysis?address=${encodeURIComponent(addr)}`)
        .then((res) => {
          if (!res?.ok) return null;
          return res;
        })
        .catch(() => null)
        .then((warmRes) =>
          warmRes
            ? earnPrism(
                myAddress,
                rewardPath,
                undefined,
                rewardPath === 'sybil_hunt'
                  ? `Sybil bounty: ${addr.slice(0, 8)}...`
                  : verdict.key === 'clean'
                    ? `Cleared wallet: ${addr.slice(0, 8)}...`
                    : `Intel scan: ${addr.slice(0, 8)}...`,
                undefined,
                { scanTarget: addr },
              )
            : null,
        )
        .then((reward) => {
          if (!reward || reward.earned <= 0) return;
          setHuntCoinsEarned(reward.earned);
          const newStats = updateHuntStats({
            totalHunts: 1,
            sybilsCaught: rewardPath === 'sybil_hunt' ? 1 : 0,
            coinsEarned: reward.earned,
          });
          setHuntStats(newStats);
        })
        .catch(() => {});
    },
    [myAddress],
  );

  const fetchFunding = useCallback(async (addr: string) => {
    try {
      const r = await fetchJsonWithTimeout(`${BASE()}/api/sybil/funding-sources?address=${encodeURIComponent(addr)}`);
      if (r.ok) {
        const d = await readJsonSafe<{ sources?: FundingSource[] }>(r, 'Funding source lookup');
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
      setResult(createPendingWalletPreview(addr));
      setSybilData(null);
      setFundingSources([]);
      setHuntVerdict(null);
      setHuntCoinsEarned(0);

      const previewPromise = fetchWalletPreview(addr);
      const sybilPromise = fetchSybil(addr);
      const data = await previewPromise;
      if (!data) {
        setLoading(false);
        setResult(null);
        setError('Could not load wallet data');
        return;
      }
      setResult(data);
      addRecentWallet(addr);

      await sybilPromise;
      setLoading(false);
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

  const HUNT_RANKS = [
    { name: 'Recruit', min: 0, icon: '/icons/hunt/hunt_recruit.png', color: 'text-white/40', perk: '' },
    {
      name: 'Tracker',
      min: 3,
      icon: '/icons/hunt/hunt_tracker.png',
      color: 'text-green-400',
      perk: '+10 coins per sybil',
    },
    {
      name: 'Specialist',
      min: 10,
      icon: '/icons/hunt/hunt_specialist.png',
      color: 'text-blue-400',
      perk: '+20 coins per sybil',
    },
    {
      name: 'Veteran',
      min: 20,
      icon: '/icons/hunt/hunt_veteran.png',
      color: 'text-purple-400',
      perk: '+30 coins, 2× quiz reward',
    },
    {
      name: 'Apex Hunter',
      min: 50,
      icon: '/icons/hunt/hunt_apex.png',
      color: 'text-amber-400',
      perk: '+50 coins, 3× quiz reward',
    },
  ];
  const currentRankIdx = HUNT_RANKS.reduce((best, r, i) => (huntStats.sybilsCaught >= r.min ? i : best), 0);
  const huntRankData = HUNT_RANKS[currentRankIdx];
  const nextRankData = HUNT_RANKS[currentRankIdx + 1] || null;

  return (
    <PageShell>
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-amber-500/[0.08]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <HubReturnButton />
          <h1 className="text-sm font-bold bg-gradient-to-r from-amber-400 to-red-500 bg-clip-text text-transparent flex items-center gap-1.5">
            <Crosshair className="w-4 h-4 text-amber-400" />
            SYBIL HUNT
          </h1>
          <div className="w-16" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Hunter Rank Card */}
        {(huntStats.totalHunts > 0 || myAddress) && (
          <div className="rounded-2xl bg-gradient-to-r from-amber-500/[0.06] to-red-500/[0.04] border border-amber-500/[0.1] p-4">
            <div className="flex items-center gap-3 mb-3">
              <img src={huntRankData.icon} alt="" className="w-10 h-10 object-contain shrink-0" loading="lazy" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-black ${huntRankData.color}`}>{huntRankData.name}</span>
                  {huntRankData.perk && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-lg bg-amber-400/10 text-amber-300/60 font-bold">
                      {huntRankData.perk}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[10px]">
                  <span className="text-white/30">
                    <span className="text-white/50 font-bold">{huntStats.totalHunts || 0}</span> hunts
                  </span>
                  <span className="text-white/30">
                    <span className="text-red-400/80 font-bold">{huntStats.sybilsCaught || 0}</span> caught
                  </span>
                  <span className="flex items-center gap-1 text-white/30 ml-auto">
                    <Coins className="w-3 h-3 text-amber-400/50" />
                    <span className="text-amber-300/70 font-bold">{huntStats.coinsEarned || 0}</span>
                  </span>
                </div>
              </div>
            </div>
            {/* Progress to next rank */}
            {nextRankData && (
              <div>
                <div className="flex justify-between text-[9px] mb-1">
                  <span className="text-white/20">Next: {nextRankData.name}</span>
                  <span className="text-white/20">
                    {huntStats.sybilsCaught}/{nextRankData.min} sybils
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400/60 to-red-400/60 transition-all"
                    style={{ width: `${Math.min(100, (huntStats.sybilsCaught / nextRankData.min) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {!nextRankData && <div className="text-[9px] text-amber-400/40 text-center font-bold">MAX RANK</div>}
          </div>
        )}

        {/* Search */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Crosshair className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500/30" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Enter target wallet address..."
              className="w-full pl-10 pr-4 py-3 bg-white/[0.04] border border-amber-500/15 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40 font-mono"
            />
          </div>
          <button
            onClick={() => handleSearch()}
            disabled={loading}
            className="relative px-6 py-3 rounded-xl font-black text-sm tracking-wider overflow-hidden transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-amber-500 to-red-500 hover:from-amber-400 hover:to-red-400 text-black shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 active:scale-95"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="animate-pulse">SCANNING</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Crosshair className="w-4 h-4" />
                HUNT
              </span>
            )}
          </button>
        </div>

        {/* Scanning — Interactive Hunt Sequence */}
        {loading && <ScanningSequence targetAddress={query} walletAddress={myAddress} />}

        {/* Scan History — show last 8 with verdict */}
        {!loading && !result && scanHistory.length > 0 && (
          <div>
            <p className="text-[10px] text-white/20 uppercase tracking-wider mb-2 font-bold">Recent Scans</p>
            <div className="space-y-1.5">
              {scanHistory.slice(0, 8).map((h) => (
                <button
                  key={h.address}
                  onClick={() => {
                    setQuery(h.address);
                    handleSearch(h.address);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left border border-white/[0.04]"
                >
                  <Crosshair className="w-3 h-3 text-amber-500/30 shrink-0" />
                  <span className="text-[10px] text-white/50 font-mono flex-1 truncate">
                    {h.address.slice(0, 6)}...{h.address.slice(-4)}
                  </span>
                  <span
                    className={`text-[10px] font-bold shrink-0 ${
                      h.verdictKey === 'clean'
                        ? 'text-green-400'
                        : h.verdictKey === 'confirmed_sybil' || h.verdictKey === 'probable_sybil'
                          ? 'text-red-400'
                          : h.verdictKey === 'suspicious'
                            ? 'text-amber-400'
                            : 'text-white/30'
                    }`}
                  >
                    {h.verdict}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Suggested Targets from sybil graph — hide already scanned */}
        {!loading && !result && suggestedTargets.length === 0 && (
          <div className="text-center py-8">
            {suggestedTargetExclusions.length > 0 ? (
              <>
                <p className="text-white/40 text-sm">No fresh bounty targets right now</p>
                <p className="text-white/20 text-xs mt-1">
                  You already scanned the current shortlist. Try another wallet or come back after new hunts land.
                </p>
              </>
            ) : (
              <>
                <p className="text-white/40 text-sm">Enter a Solana wallet address above to start hunting</p>
                <p className="text-white/20 text-xs mt-1">Scan wallets to detect sybil activity and earn rewards</p>
              </>
            )}
          </div>
        )}

        {!loading && !result && suggestedTargets.filter((t) => !isAlreadyScanned(t.address)).length > 0 && (
          <div>
            <p className="text-[10px] text-red-400/30 uppercase tracking-wider mb-2 font-bold flex items-center gap-1.5">
              <Target className="w-3 h-3" /> Bounty Board
            </p>
            <div className="space-y-1.5">
              {suggestedTargets
                .filter((t) => !isAlreadyScanned(t.address))
                .map((t) => (
                  <button
                    key={t.address}
                    onClick={() => {
                      setQuery(t.address);
                      handleSearch(t.address);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-red-500/[0.03] border border-red-500/[0.08] hover:bg-red-500/[0.08] transition-colors text-left"
                  >
                    <Crosshair className="w-3.5 h-3.5 text-red-400/40 shrink-0" />
                    <span className="text-xs font-mono text-white/50 flex-1">
                      {t.address.slice(0, 6)}...{t.address.slice(-4)}
                    </span>
                    {t.parentRisk && <span className="text-[9px] font-mono text-red-400/50">risk {t.parentRisk}</span>}
                    <span className="text-[9px] text-amber-400/40 font-bold">
                      {t.source === 'cluster' ? 'CLUSTER' : 'LINKED'}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        {/* Hunt Verdict Banner */}
        {huntVerdict &&
          result &&
          result.address !== myAddress &&
          (() => {
            const verdictTheme = getVerdictTheme(huntVerdict.key);
            const isBounty = isSybilReportVerdict(huntVerdict.key);
            const isClean = huntVerdict.key === 'clean';
            const isUnknown = huntVerdict.key === 'unknown';

            return (
              <div
                className={`rounded-2xl border p-4 text-left shadow-lg shadow-black/20 transition-all duration-500 ${
                  showVerdictAnim ? 'animate-in fade-in zoom-in-95 duration-500' : ''
                } ${verdictTheme.panelClass}`}
              >
                <div className="flex items-start gap-2.5 mb-2">
                  {isBounty ? (
                    <AlertTriangle className={`w-5 h-5 mt-0.5 shrink-0 ${verdictTheme.titleClass}`} />
                  ) : isClean ? (
                    <Shield className={`w-5 h-5 mt-0.5 shrink-0 ${verdictTheme.titleClass}`} />
                  ) : isUnknown ? (
                    <Clock className={`w-5 h-5 mt-0.5 shrink-0 ${verdictTheme.titleClass}`} />
                  ) : (
                    <Target className={`w-5 h-5 mt-0.5 shrink-0 ${verdictTheme.titleClass}`} />
                  )}
                  <div className="min-w-0 flex-1">
                    <span
                      className={`block text-base font-black leading-tight tracking-wide ${verdictTheme.titleClass}`}
                    >
                      {friendlyVerdict(sybilData?.trustScore ?? 0).title}
                    </span>
                    <p className={`text-xs leading-relaxed mt-1 ${verdictTheme.summaryClass}`}>
                      Trust {sybilData?.trustScore ?? '?'}/100 · {huntVerdict.summary}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wide ${verdictTheme.badgeClass}`}
                  >
                    {friendlyVerdict(sybilData?.trustScore ?? 0).title}
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wide ${verdictTheme.chipClass}`}
                  >
                    {formatConfidence(huntVerdict.confidence)}
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wide ${verdictTheme.chipClass}`}
                  >
                    {VERDICT_DATA_QUALITY_LABELS[huntVerdict.dataQuality]}
                  </span>
                </div>
                <div
                  className={`inline-flex max-w-full items-center gap-1.5 px-3 py-1.5 rounded-full mt-3 ${verdictTheme.rewardClass}`}
                >
                  {isBounty ? (
                    <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Coins className="w-3.5 h-3.5 text-white/50" />
                  )}
                  <span className="text-sm font-bold truncate">
                    +{huntCoinsEarned} Coins {isBounty ? 'Bounty' : isClean ? '(clear scan)' : '(intel scan)'}
                  </span>
                </div>
                {isSybilReportVerdict(huntVerdict.key) && (
                  <div className="mt-3 border-t border-white/[0.06] pt-3">
                    <button
                      onClick={() => setShowFeedbackModal(true)}
                      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3.5 py-2 text-xs font-bold text-amber-100/80 transition-colors hover:border-amber-200/35 hover:bg-amber-300/[0.13] hover:text-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/35"
                    >
                      <Flag className="h-3.5 w-3.5" />
                      <span>{isBounty ? 'Submit sybil report' : 'Report false flag'}</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

        {/* Result — only show after sybilData loaded (prevents score jumping) */}
        {result && sybilData && (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Target Dossier */}
            {(() => {
              const verdict = resolveAnalysisVerdict(sybilData);
              const verdictTheme = getVerdictTheme(verdict.key);
              const trustScore = sybilData.trustScore;
              const trustGrade = sybilData.trustGrade;
              const riskScore = sybilData.riskScore;
              const flaggedCount = sybilData.signals.filter((s) => s.detected).length;
              const totalSignals = sybilData.signals.length;
              const metrics = sybilData.metrics;
              const gradeColor =
                trustScore >= 80 ? '#22c55e' : trustScore >= 60 ? '#3b82f6' : trustScore >= 40 ? '#eab308' : '#ef4444';

              return (
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: `${gradeColor}20` }}>
                  <div className="p-4">
                    {/* Address + Trust Gauge */}
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0">
                        <svg width="72" height="72" viewBox="0 0 72 72">
                          <circle cx="36" cy="36" r="29" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
                          <circle
                            cx="36"
                            cy="36"
                            r="29"
                            fill="none"
                            stroke={gradeColor}
                            strokeWidth="5"
                            strokeLinecap="round"
                            strokeDasharray={`${(trustScore / 100) * 2 * Math.PI * 29} ${2 * Math.PI * 29}`}
                            transform="rotate(-90 36 36)"
                            style={{ filter: `drop-shadow(0 0 8px ${gradeColor}60)` }}
                          />
                          <text
                            x="36"
                            y="33"
                            textAnchor="middle"
                            fill={gradeColor}
                            fontSize="18"
                            fontWeight="bold"
                            fontFamily="monospace"
                          >
                            {trustGrade}
                          </text>
                          <text x="36" y="46" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="9">
                            {trustScore}/100
                          </text>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className="text-white/40 text-xs font-mono truncate">
                            {result.address.slice(0, 6)}...{result.address.slice(-4)}
                          </p>
                          <CopyButton text={result.address} />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold" style={{ color: gradeColor }}>
                            Trust {trustScore}/100
                          </span>
                          {sybilData && (
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${riskScore >= 50 ? 'bg-red-500/15 text-red-400' : riskScore >= 20 ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}
                            >
                              Risk {riskScore}
                            </span>
                          )}
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${verdictTheme.badgeClass}`}>
                            {friendlyVerdict(trustScore).title}
                          </span>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${verdictTheme.chipClass}`}>
                            {formatConfidence(verdict.confidence)}
                          </span>
                          {sybilData && (
                            <span className="text-[10px] text-white/25 font-mono">
                              {flaggedCount}/{totalSignals} flags
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Re-scan button */}
                    {result.address !== myAddress &&
                      (() => {
                        const rescanRemainingMs = rescanUsedAt
                          ? Math.max(0, 86_400_000 - (Date.now() - rescanUsedAt))
                          : 0;
                        const rescanQuotaUsed = rescanRemainingMs > 0;
                        return (
                          <div className="mt-3 mb-1">
                            <button
                              onClick={handleRescan}
                              disabled={isRescanning || rescanQuotaUsed}
                              className={`w-full rounded-xl border px-3 py-2 text-sm font-semibold flex items-center justify-center gap-2 ${
                                isRescanning
                                  ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200'
                                  : rescanQuotaUsed
                                    ? 'border-white/10 bg-white/[0.02] text-white/25 cursor-not-allowed'
                                    : 'border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-300 hover:bg-cyan-500/[0.12]'
                              }`}
                            >
                              {isRescanning ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span>{rescanStep}</span>
                                </>
                              ) : (
                                <>
                                  <RotateCcw className="w-4 h-4" />
                                  <span>{rescanQuotaUsed ? 'Re-scan (used)' : 'Re-scan'}</span>
                                </>
                              )}
                            </button>
                            <p className="text-[9px] text-white/20 text-center mt-1">1 free re-scan / day</p>
                          </div>
                        );
                      })()}

                    {/* Key Metrics Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                      {[
                        {
                          label: 'Wallet age',
                          value: formatWalletAge(Number(metrics.walletAgeDays) || result.walletAgeDays),
                          color: 'text-green-400/70',
                        },
                        {
                          label: 'Transactions',
                          value: (() => {
                            const n = Number(metrics.txCount) || result.txCount;
                            return n >= 10000 ? '10 000+' : n.toLocaleString();
                          })(),
                          color: 'text-cyan-400/70',
                        },
                        {
                          label: 'SOL balance',
                          value: `${(Number(metrics.balance) || result.solBalance).toFixed(2)}◎`,
                          color: 'text-yellow-400/70',
                        },
                        {
                          label: 'Tokens held',
                          value: String(Number(metrics.tokenDiversityCount) || result.tokenCount),
                          color: 'text-blue-400/70',
                        },
                        {
                          label: 'NFTs held',
                          value: String(Number(metrics.nftCount) || result.nftCount),
                          color: 'text-purple-400/70',
                        },
                        {
                          label: 'Apps used',
                          value: String(Number(metrics.uniquePrograms) || 0),
                          color: 'text-orange-400/70',
                        },
                      ].map((m) => (
                        <div
                          key={m.label}
                          className="min-h-12 rounded-xl bg-white/[0.025] border border-white/[0.04] px-2.5 py-2"
                        >
                          <span className="block text-[9px] uppercase tracking-wide text-white/25">{m.label}</span>
                          <span className={`block truncate text-[12px] font-mono font-bold ${m.color}`}>{m.value}</span>
                        </div>
                      ))}
                    </div>

                    {/* Funding Source (from sybil data) */}
                    {(() => {
                      // Prefer live funding sources list; fall back to primaryFundingSource embedded in sybil analysis
                      const primarySrc =
                        fundingSources.length > 0 ? fundingSources[0] : (sybilData.primaryFundingSource ?? null);
                      if (!primarySrc) return null;
                      return (
                        <div className="mt-3 pt-3 border-t border-white/[0.05]">
                          <p className="text-[9px] text-white/20 uppercase tracking-wider mb-1.5 font-bold">
                            Primary Funding
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <div
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{
                                background:
                                  primarySrc.type === 'cex'
                                    ? '#22c55e'
                                    : primarySrc.type === 'bridge'
                                      ? '#3b82f6'
                                      : '#ef4444',
                              }}
                            />
                            <span className="min-w-0 flex-1 text-xs text-white/50 font-mono truncate">
                              {primarySrc.label ||
                                `${primarySrc.address.slice(0, 6)}...${primarySrc.address.slice(-4)}`}
                            </span>
                            <span className="text-[10px] text-white/25 font-mono ml-auto whitespace-nowrap">
                              {primarySrc.totalSolReceived.toFixed(2)}◎ ({primarySrc.percentage.toFixed(0)}%)
                            </span>
                            <span
                              className={`rounded-full border border-white/[0.06] px-2 py-0.5 text-[9px] font-bold ${primarySrc.type === 'cex' ? 'text-emerald-400/60' : 'text-red-400/50'}`}
                            >
                              {primarySrc.type === 'cex'
                                ? 'EXCHANGE'
                                : primarySrc.type === 'bridge'
                                  ? 'BRIDGE'
                                  : 'WALLET'}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Actions */}
                  <div className="flex border-t border-white/[0.06]">
                    <button
                      onClick={() =>
                        startFadeTransition(() =>
                          navigate(`/?address=${result.address}`, { state: { openCard: true } }),
                        )
                      }
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold transition-all hover:bg-white/[0.03] text-cyan-400/70"
                    >
                      <ExternalLink className="w-4 h-4" /> Full Card
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Connected Wallets (siblings from sybil analysis) */}
            {sybilData?.metrics?.siblingAddresses && (sybilData.metrics.siblingAddresses as string[]).length > 0 && (
              <div className="glass-card p-3">
                <p className="text-[10px] font-bold text-red-400/50 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <GitBranch className="w-3 h-3" /> Linked Wallets
                  <span className="ml-auto text-[9px] text-white/15 font-mono">
                    {(sybilData.metrics.siblingAddresses as string[]).length} found
                  </span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {(sybilData.metrics.siblingAddresses as string[]).slice(0, 15).map((addr) => (
                    <button
                      key={addr}
                      onClick={() => {
                        setQuery(addr);
                        handleSearch(addr);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/[0.04] border border-red-500/[0.08] text-[10px] font-mono text-white/30 hover:bg-red-500/[0.1] hover:text-amber-300/60 transition-colors"
                    >
                      {addr.slice(0, 4)}..{addr.slice(-3)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Protocol Usage */}
            {result.topPrograms && result.topPrograms.length > 0 && (
              <div className="glass-card p-4">
                <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400/40" /> Protocol Activity
                </p>
                <div className="space-y-2">
                  {(result.topPrograms as TopProgram[]).slice(0, 6).map((p, i) => {
                    const maxInt = Math.max(...(result.topPrograms as TopProgram[]).map((x) => x.interactions), 1);
                    return (
                      <div key={p.programId || i} className="flex items-center gap-3">
                        <span className="text-xs text-white/60 font-bold w-24 truncate" title={p.programId}>
                          {PROGRAM_LABELS[p.programId]?.label ?? p.name ?? getProgramLabel(p.programId)}
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
          <div className="space-y-4 py-4">
            {/* Mission Briefing */}
            <div className="rounded-xl border border-amber-500/[0.1] bg-gradient-to-br from-amber-900/[0.08] to-red-900/[0.04] p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[10px] uppercase tracking-[0.15em] text-amber-300/50 font-bold">
                  Mission Briefing
                </span>
              </div>
              <p className="text-sm text-white/60 leading-relaxed">
                Sybil wallets pollute the ecosystem with fake identities. Your mission: scan suspicious addresses and
                expose them.
              </p>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="rounded-lg bg-red-500/[0.06] border border-red-500/[0.1] p-3 text-center">
                  <AlertTriangle className="w-5 h-5 text-red-400/60 mx-auto mb-1" />
                  <p className="text-[10px] text-red-300/60 font-bold">SYBIL FOUND</p>
                  <p className="text-lg font-black text-amber-400 font-mono">+20</p>
                  <p className="text-[9px] text-white/20">coins bounty</p>
                </div>
                <div className="rounded-lg bg-emerald-500/[0.04] border border-emerald-500/[0.08] p-3 text-center">
                  <Shield className="w-5 h-5 text-emerald-400/40 mx-auto mb-1" />
                  <p className="text-[10px] text-emerald-300/40 font-bold">WALLET CLEAR</p>
                  <p className="text-lg font-black text-white/30 font-mono">+5</p>
                  <p className="text-[9px] text-white/20">coins scan fee</p>
                </div>
              </div>
            </div>

            {/* Detection Capabilities */}
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/20 font-bold mb-3">Detection Arsenal</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: <BarChart3 className="w-3.5 h-3.5" />, label: '23 Signals', sub: 'risk analysis' },
                  { icon: <GitBranch className="w-3.5 h-3.5" />, label: 'Fund Graph', sub: 'chain tracing' },
                  { icon: <Fingerprint className="w-3.5 h-3.5" />, label: 'Behavior', sub: 'pattern match' },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-1.5 py-2 rounded-lg bg-white/[0.02]">
                    <span className="text-amber-400/40">{item.icon}</span>
                    <span className="text-[10px] text-white/40 font-bold">{item.label}</span>
                    <span className="text-[9px] text-white/15">{item.sub}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Rank progression with perks */}
            {huntStats.totalHunts > 0 && (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/20 font-bold mb-3">
                  All Ranks & Perks
                </p>
                <div className="space-y-2">
                  {HUNT_RANKS.map((rank, i) => {
                    const unlocked = huntStats.sybilsCaught >= rank.min;
                    const isCurrent = i === currentRankIdx;
                    return (
                      <div
                        key={rank.name}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-colors ${isCurrent ? 'bg-amber-400/[0.08] border border-amber-400/20' : unlocked ? 'bg-white/[0.02]' : 'opacity-40'}`}
                      >
                        <img src={rank.icon} alt="" className="w-7 h-7 object-contain shrink-0" loading="lazy" />
                        <div className="flex-1 min-w-0">
                          <span className={`text-[11px] font-bold ${unlocked ? rank.color : 'text-white/20'}`}>
                            {rank.name}
                          </span>
                          {rank.perk && <span className="text-[9px] text-white/25 ml-2">{rank.perk}</span>}
                        </div>
                        <span className="text-[9px] text-white/15">{rank.min}+</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showFeedbackModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-md"
          onClick={() => setShowFeedbackModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0d16] p-4 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/15 bg-amber-400/[0.08] text-amber-300">
                <Flag className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-white/85">
                  {huntVerdict && isSybilReportVerdict(huntVerdict.key) ? 'Submit sybil report' : 'Report false flag'}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-white/40">
                  {huntVerdict && isSybilReportVerdict(huntVerdict.key)
                    ? 'Send this suspicious wallet to the community signal.'
                    : 'Tell us why this wallet should not be treated as sybil-linked.'}
                </p>
              </div>
              <button
                onClick={() => setShowFeedbackModal(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                aria-label="Close false flag report"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              className="h-28 w-full resize-none rounded-xl border border-white/10 bg-white/[0.045] p-3 text-sm leading-relaxed text-white/75 placeholder:text-white/25 focus:border-cyan-400/35 focus:outline-none focus:ring-2 focus:ring-cyan-400/15"
              placeholder={
                huntVerdict && isSybilReportVerdict(huntVerdict.key)
                  ? 'Optional note for reviewers...'
                  : 'Describe why this verdict seems incorrect...'
              }
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowFeedbackModal(false)}
                className="min-h-10 flex-1 rounded-xl border border-white/[0.08] px-3 py-2 text-sm font-semibold text-white/45 transition-colors hover:bg-white/[0.05] hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                Cancel
              </button>
              <button
                onClick={handleFeedbackSubmit}
                disabled={huntVerdict ? !isSybilReportVerdict(huntVerdict.key) && !feedbackText.trim() : true}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/[0.12] px-3 py-2 text-sm font-bold text-cyan-100 transition-colors hover:bg-cyan-400/[0.18] disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.03] disabled:text-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/35"
              >
                <Send className="h-3.5 w-3.5" />
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
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
        <p className="text-sm font-bold">Scanning target...</p>
        <p className="text-xs text-white/20">21 risk signals, funding graph, timing patterns</p>
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
  const verdict = resolveAnalysisVerdict(data);
  const verdictTheme = getVerdictTheme(verdict.key);
  const metrics = data.metrics as Record<string, unknown>;
  const profile = data.behaviorProfile as Record<string, number>;

  const behavioral = data.signals.filter((s) => s.category === 'behavioral');
  const financial = data.signals.filter((s) => s.category === 'financial');
  const network = data.signals.filter((s) => s.category === 'network');
  const flagged = data.signals.filter((s) => s.detected);

  // Activity = txs/day over full life (unbiased; activeDaysRatio is sampled and reads ~100%
  // for active whales). 10+/day = full axis. Zero extra calls — uses existing metrics.
  const txPerDayRadar = (Number(metrics.txCount) || 0) / Math.max(1, Math.round(Number(metrics.walletAgeDays) || 0));
  // Radar chart data (5 axes, 0-1 normalized)
  const radarAxes = [
    { label: 'Age', value: Math.min(1, (Number(metrics.walletAgeDays) || 0) / 730) },
    { label: 'DeFi', value: Math.min(1, (Number(metrics.defiDepth) || 0) / 4) },
    { label: 'Diversity', value: Math.min(1, (Number(metrics.uniquePrograms) || 0) / 15) },
    { label: 'Activity', value: Math.min(1, txPerDayRadar / 10) },
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
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
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
          <div className="flex-1 flex justify-center overflow-hidden">
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold leading-tight" style={{ color: riskColor }}>
              Risk: {data.riskScore}/100 — {data.riskLevel.toUpperCase()}
            </span>
            <span className="shrink-0 rounded-full bg-white/[0.03] px-2 py-1 text-xs text-white/35">
              {flagged.length}/{data.signals.length} flagged
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {metrics.hasSolDomain && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20">
                <CheckCircle className="w-3 h-3 inline mr-0.5" />
                .sol
              </span>
            )}
            {Array.isArray(metrics.defiCategories) &&
              (metrics.defiCategories as string[]).map((c) => (
                <span key={c} className="px-2 py-0.5 rounded-full text-[10px] font-bold text-cyan-400/60 bg-cyan-400/5">
                  {c}
                </span>
              ))}
            {Number(metrics.trustBonus) > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-emerald-400 bg-emerald-400/5">
                bonus -{String(metrics.trustBonus)}
              </span>
            )}
          </div>
          <div className={`mt-3 rounded-2xl border p-3 ${verdictTheme.panelClass}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${verdictTheme.badgeClass}`}
              >
                {verdict.label}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${verdictTheme.chipClass}`}
              >
                {formatConfidence(verdict.confidence)}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${verdictTheme.chipClass}`}
              >
                {VERDICT_DATA_QUALITY_LABELS[verdict.dataQuality]}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${verdictTheme.chipClass}`}
              >
                {verdict.rewardPath === 'sybil_hunt'
                  ? 'bounty path'
                  : verdict.key === 'clean'
                    ? 'clear scan'
                    : 'watchlist'}
              </span>
            </div>
            <p className={`text-xs mt-2 ${verdictTheme.summaryClass}`}>{verdict.summary}</p>
            {verdict.reasons.length > 0 && (
              <div className="mt-2 space-y-1">
                {verdict.reasons.slice(0, 3).map((reason) => (
                  <div key={reason} className="flex items-start gap-2 text-[11px] leading-relaxed text-white/55">
                    <span className="mt-0.5 shrink-0 text-white/20">•</span>
                    <span className="min-w-0">{reason}</span>
                  </div>
                ))}
              </div>
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
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400">
                  {catFlagged} flagged
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
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
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={`min-w-0 text-xs font-bold leading-tight ${sig.detected ? 'text-white/80' : 'text-white/40'}`}
                        >
                          {sig.name}
                        </span>
                        <span className="max-w-full truncate text-[10px] text-white/20 font-mono">{sig.value}</span>
                        {sig.detected && (
                          <span className="ml-auto shrink-0 text-[10px] text-red-400/60 font-mono">+{sig.weight}</span>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed text-white/25 mt-0.5">{sig.description}</p>
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
              <div
                key={s.address}
                className="grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 py-2 px-2 rounded-xl hover:bg-white/[0.03]"
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: s.percentage > 50 ? '#ef4444' : s.percentage > 20 ? '#f97316' : '#22c55e' }}
                />
                <span className="text-xs font-mono text-white/40 truncate flex-1">
                  {s.label || `${s.address.slice(0, 4)}...${s.address.slice(-4)}`}
                </span>
                <span className="col-start-2 sm:col-start-auto text-xs font-bold text-white/50 tabular-nums whitespace-nowrap">
                  {s.totalSolReceived.toFixed(2)} SOL
                </span>
                <span className="text-[10px] text-white/25 sm:w-8 sm:text-right whitespace-nowrap">
                  {s.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
