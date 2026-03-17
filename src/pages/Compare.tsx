import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
import { trackCompare } from '@/lib/analytics';
import { toast } from 'sonner';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Wallet, Search, Trophy, ArrowUpDown, Loader2, Swords, Shield, Zap, Home } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import PageShell from '@/components/PageShell';
import {
  TIER_LABELS,
  TIER_TEXT_COLORS as TIER_COLORS,
  TIER_HEX,
  MiniPlanet,
  BattleBar,
  formatAddr,
  fetchWalletPreview,
  type WalletPreview,
  type CompareRow,
  BADGE_LABELS,
} from '@/components/prism/shared';

// ── AnimatedScore — easeOutExpo counter ──
function AnimatedScore({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef(0);
  useEffect(() => {
    if (!value) {
      setDisplay(0);
      return;
    }
    const start = performance.now();
    const duration = 1200;
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(2, -10 * t);
      setDisplay(Math.round(from + (value - from) * ease));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value]);
  return <span className={className}>{display}</span>;
}

// ── RadarChart — uses WalletPreview data ──
function RadarChart({ a, b }: { a: WalletPreview; b: WalletPreview }) {
  const metrics = [
    { label: 'Age', a: Math.min(1, a.walletAgeDays / 1000), b: Math.min(1, b.walletAgeDays / 1000) },
    { label: 'Txns', a: Math.min(1, a.txCount / 5000), b: Math.min(1, b.txCount / 5000) },
    { label: 'NFTs', a: Math.min(1, a.nftCount / 100), b: Math.min(1, b.nftCount / 100) },
    { label: 'Tokens', a: Math.min(1, a.tokenCount / 50), b: Math.min(1, b.tokenCount / 50) },
    { label: 'SOL', a: Math.min(1, a.solBalance / 100), b: Math.min(1, b.solBalance / 100) },
    {
      label: 'Activity',
      a: Math.min(1, (a.walletAgeDays > 0 ? a.txCount / a.walletAgeDays : 0) / 20),
      b: Math.min(1, (b.walletAgeDays > 0 ? b.txCount / b.walletAgeDays : 0) / 20),
    },
  ];
  const cx = 100,
    cy = 100,
    R = 70;
  const n = metrics.length;

  const polygon = (values: number[], color: string, fill: string) => {
    const pts = values
      .map((v, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        return `${cx + Math.cos(angle) * R * Math.max(0.05, v)},${cy + Math.sin(angle) * R * Math.max(0.05, v)}`;
      })
      .join(' ');
    return <polygon points={pts} fill={fill} stroke={color} strokeWidth="1.5" />;
  };

  const rings = [0.25, 0.5, 0.75, 1].map((scale) => {
    const pts = Array.from({ length: n }, (_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return `${cx + Math.cos(angle) * R * scale},${cy + Math.sin(angle) * R * scale}`;
    }).join(' ');
    return <polygon key={scale} points={pts} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />;
  });

  const axes = metrics.map((_, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return (
      <line
        key={i}
        x1={cx}
        y1={cy}
        x2={cx + Math.cos(angle) * R}
        y2={cy + Math.sin(angle) * R}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="0.5"
      />
    );
  });

  const labels = metrics.map((m, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const lx = cx + Math.cos(angle) * (R + 16);
    const ly = cy + Math.sin(angle) * (R + 16);
    return (
      <text
        key={m.label}
        x={lx}
        y={ly}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="rgba(255,255,255,0.4)"
        fontSize="8"
        fontWeight="bold"
      >
        {m.label}
      </text>
    );
  });

  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[240px] mx-auto">
      {rings}
      {axes}
      {polygon(
        metrics.map((m) => m.a),
        'rgba(34,211,238,0.8)',
        'rgba(34,211,238,0.12)',
      )}
      {polygon(
        metrics.map((m) => m.b),
        'rgba(168,85,247,0.8)',
        'rgba(168,85,247,0.12)',
      )}
      {labels}
    </svg>
  );
}

// ── BadgeCard ──
function BadgeCard({ name, hasA, hasB }: { name: string; hasA: boolean; hasB: boolean }) {
  const both = hasA && hasB;
  const neither = !hasA && !hasB;
  return (
    <div
      className={`rounded-lg px-3 py-2 text-center border transition-all ${
        neither
          ? 'bg-white/[0.02] border-white/[0.04]'
          : both
            ? 'bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border-white/10'
            : hasA
              ? 'bg-cyan-500/8 border-cyan-500/20'
              : 'bg-purple-500/8 border-purple-500/20'
      }`}
    >
      <p className={`text-[10px] font-bold ${neither ? 'text-white/20' : 'text-white/70'}`}>{name}</p>
      <div className="flex justify-center gap-2 mt-1">
        <span
          className={`w-2 h-2 rounded-full ${hasA ? 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.5)]' : 'bg-white/10'}`}
        />
        <span
          className={`w-2 h-2 rounded-full ${hasB ? 'bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.5)]' : 'bg-white/10'}`}
        />
      </div>
    </div>
  );
}

// ── Build compare rows from WalletPreview ──
function buildCompareRowsFromPreview(a: WalletPreview, b: WalletPreview): CompareRow[] {
  const fmt = (n: number, d = 2) => (n % 1 === 0 ? String(n) : n.toFixed(d));
  const ageFmt = (d: number) => (d >= 365 ? `${(d / 365).toFixed(1)}y` : `${d}d`);
  const txDay = (p: WalletPreview) => (p.walletAgeDays > 0 ? p.txCount / p.walletAgeDays : 0);
  return [
    {
      label: 'SOL Balance',
      valueA: fmt(a.solBalance),
      valueB: fmt(b.solBalance),
      numA: a.solBalance,
      numB: b.solBalance,
      higherIsBetter: true,
    },
    {
      label: 'Wallet Age',
      valueA: ageFmt(a.walletAgeDays),
      valueB: ageFmt(b.walletAgeDays),
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
    {
      label: 'NFTs',
      valueA: String(a.nftCount),
      valueB: String(b.nftCount),
      numA: a.nftCount,
      numB: b.nftCount,
      higherIsBetter: true,
    },
    {
      label: 'Tokens',
      valueA: String(a.tokenCount),
      valueB: String(b.tokenCount),
      numA: a.tokenCount,
      numB: b.tokenCount,
      higherIsBetter: true,
    },
    {
      label: 'Tx/Day',
      valueA: txDay(a).toFixed(1),
      valueB: txDay(b).toFixed(1),
      numA: txDay(a),
      numB: txDay(b),
      higherIsBetter: true,
    },
  ];
}

export default function Compare() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const wallet = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();

  useEffect(() => {
    fadeOutTransition();
  }, []);

  const paramA = searchParams.get('a') || '';
  const paramB = searchParams.get('b') || '';

  const [inputA, setInputA] = useState(paramA || wallet.publicKey?.toBase58() || '');
  const [inputB, setInputB] = useState(paramB);

  const [dataA, setDataA] = useState<WalletPreview | null>(null);
  const [dataB, setDataB] = useState<WalletPreview | null>(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);

  useEffect(() => {
    if (wallet.publicKey && !inputA) {
      setInputA(wallet.publicKey.toBase58());
    }
  }, [wallet.publicKey, inputA]);

  // Auto-compare if both params present
  const didAutoCompare = useRef(false);
  useEffect(() => {
    if (paramA && paramB && !didAutoCompare.current) {
      didAutoCompare.current = true;
      doCompare(paramA, paramB);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);

  const doCompare = useCallback(async (a: string, b: string) => {
    setLoadingA(true);
    setLoadingB(true);
    setDataA(null);
    setDataB(null);
    setErrorA(null);
    setErrorB(null);
    const [resA, resB] = await Promise.all([fetchWalletPreview(a), fetchWalletPreview(b)]);
    if (!resA) setErrorA('Failed to load wallet A');
    if (!resB) setErrorB('Failed to load wallet B');
    setDataA(resA);
    setDataB(resB);
    setLoadingA(false);
    setLoadingB(false);
  }, []);

  const handleCompare = useCallback(() => {
    const a = inputA.trim();
    const b = inputB.trim();
    if (!a || !b) return;
    trackCompare();
    setSearchParams({ a, b });
    doCompare(a, b);
    const myAddr = wallet.publicKey?.toBase58();
    if (myAddr) {
      import('@/lib/prismQuests')
        .then(({ getQuestState, incrementQuest }) => {
          const qs = getQuestState(myAddr);
          const onComplete = (q: { name: string }) => toast.success(`Quest completed: ${q.name}!`, { duration: 4000 });
          incrementQuest(qs, 'weekly_compare3', 1, onComplete);
          incrementQuest(qs, 'ot_compare10', 1, onComplete);
          incrementQuest(qs, 'daily_explore', 1, onComplete);
        })
        .catch(() => {});
    }
  }, [inputA, inputB, setSearchParams, wallet.publicKey, doCompare]);

  const handleSwap = useCallback(() => {
    setInputA(inputB);
    setInputB(inputA);
    setDataA(dataB);
    setDataB(dataA);
    setErrorA(errorB);
    setErrorB(errorA);
    if (inputA && inputB) setSearchParams({ a: inputB, b: inputA });
  }, [inputA, inputB, dataA, dataB, errorA, errorB, setSearchParams]);

  const scoreA = dataA?.compositeScore ?? 0;
  const scoreB = dataB?.compositeScore ?? 0;
  const tierA = dataA?.compositeTier || 'mercury';
  const tierB = dataB?.compositeTier || 'mercury';

  const rows = useMemo(() => {
    if (!dataA || !dataB) return [];
    return buildCompareRowsFromPreview(dataA, dataB);
  }, [dataA, dataB]);

  const badgesA = dataA?.compositeBadgeCount || 0;
  const badgesB = dataB?.compositeBadgeCount || 0;

  // Merge badge sets for comparison grid
  const allBadges = useMemo(() => {
    if (!dataA || !dataB) return [];
    const setAll = new Set([...dataA.badges, ...dataB.badges]);
    return Array.from(setAll);
  }, [dataA, dataB]);

  const bothLoaded = dataA && dataB && !loadingA && !loadingB;
  const isLoading = loadingA || loadingB;
  const aWins = scoreA > scoreB;
  const bWins = scoreB > scoreA;

  return (
    <PageShell className="text-white">
      {/* Header */}
      <header className="flex-none sticky top-0 z-20 bg-[#050510]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => startFadeTransition(() => goBack(navigate))}
            className="text-white/50 hover:text-white transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
            Compare Wallets
          </h1>
          <div className="flex-1" />
          <button
            onClick={() => startFadeTransition(() => navigate('/'))}
            className="text-white/50 hover:text-white transition-colors"
            title="Home"
          >
            <Home className="w-5 h-5" />
          </button>
          {!wallet.connected && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs bg-cyan-950/50 border-cyan-800/60 text-cyan-400"
              onClick={() => setWalletModalVisible(true)}
            >
              <Wallet className="w-3 h-3 mr-1" /> Connect
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full px-4 py-6 pb-24 space-y-6">
        {/* Input Section */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-widest text-cyan-400/60 font-bold mb-1 block">
                Wallet A
              </label>
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
              <label className="text-[10px] uppercase tracking-widest text-purple-400/60 font-bold mb-1 block">
                Wallet B
              </label>
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
            disabled={!inputA.trim() || !inputB.trim() || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scanning...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" /> Compare
              </>
            )}
          </Button>
        </div>

        {/* Error state */}
        {!isLoading && (errorA || errorB) && (
          <div className="text-center py-6 space-y-2">
            {errorA && <p className="text-red-400 text-sm">{errorA}</p>}
            {errorB && <p className="text-red-400 text-sm">{errorB}</p>}
            <p className="text-white/30 text-xs">Check the addresses and try again</p>
          </div>
        )}

        {/* Results */}
        <AnimatePresence mode="wait">
          {bothLoaded && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
              className="space-y-5"
            >
              {/* BATTLE Arena */}
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/5 via-transparent to-purple-500/5 blur-3xl rounded-3xl" />

                {/* VS Battle Header */}
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.15, type: 'spring', stiffness: 200 }}
                  className="flex items-center justify-center gap-6 mb-4 relative"
                >
                  {/* Fighter A */}
                  <motion.div
                    initial={{ x: -60, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                    className="flex-1 text-center"
                  >
                    <div
                      className={`rounded-2xl border-2 p-4 relative overflow-hidden ${
                        aWins
                          ? 'border-cyan-400/40 bg-gradient-to-br from-cyan-500/15 to-cyan-900/10'
                          : 'border-white/[0.08] bg-white/[0.02]'
                      }`}
                    >
                      {aWins && (
                        <div className="absolute inset-0">
                          <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/10 to-transparent animate-pulse" />
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
                        </div>
                      )}
                      <div className="relative">
                        <div className="flex justify-center mb-2">
                          <MiniPlanet tier={tierA} size={52} />
                        </div>
                        <AnimatedScore value={scoreA} className="text-3xl font-black tabular-nums text-white block" />
                        <div className={`text-xs font-bold uppercase tracking-wider mt-1 ${TIER_COLORS[tierA]}`}>
                          {TIER_LABELS[tierA]}
                        </div>
                        <div className="font-mono text-[9px] text-white/30 mt-1">{formatAddr(dataA!.address)}</div>
                      </div>
                    </div>
                  </motion.div>

                  {/* VS Emblem */}
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 0.3, type: 'spring', stiffness: 150 }}
                    className="flex-none relative z-10"
                  >
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-500 via-red-500 to-pink-600 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.4),0_0_60px_rgba(239,68,68,0.2)]">
                      <Swords className="w-7 h-7 text-white" />
                    </div>
                    <div
                      className="absolute -inset-2 rounded-full border border-orange-500/30 animate-ping"
                      style={{ animationDuration: '2s' }}
                    />
                  </motion.div>

                  {/* Fighter B */}
                  <motion.div
                    initial={{ x: 60, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                    className="flex-1 text-center"
                  >
                    <div
                      className={`rounded-2xl border-2 p-4 relative overflow-hidden ${
                        bWins
                          ? 'border-purple-400/40 bg-gradient-to-br from-purple-500/15 to-purple-900/10'
                          : 'border-white/[0.08] bg-white/[0.02]'
                      }`}
                    >
                      {bWins && (
                        <div className="absolute inset-0">
                          <div className="absolute inset-0 bg-gradient-to-t from-purple-500/10 to-transparent animate-pulse" />
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-1 bg-gradient-to-r from-transparent via-purple-400 to-transparent" />
                        </div>
                      )}
                      <div className="relative">
                        <div className="flex justify-center mb-2">
                          <MiniPlanet tier={tierB} size={52} />
                        </div>
                        <AnimatedScore value={scoreB} className="text-3xl font-black tabular-nums text-white block" />
                        <div className={`text-xs font-bold uppercase tracking-wider mt-1 ${TIER_COLORS[tierB]}`}>
                          {TIER_LABELS[tierB]}
                        </div>
                        <div className="font-mono text-[9px] text-white/30 mt-1">{formatAddr(dataB!.address)}</div>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>

                {/* Victory Banner */}
                <motion.div
                  initial={{ opacity: 0, scaleX: 0 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  transition={{ delay: 0.5, duration: 0.4 }}
                >
                  {scoreA !== scoreB ? (
                    <div
                      className={`rounded-xl border-2 px-5 py-3 flex items-center justify-center gap-3 relative overflow-hidden ${
                        aWins
                          ? 'border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 via-transparent to-transparent'
                          : 'border-purple-500/30 bg-gradient-to-r from-transparent via-transparent to-purple-500/10'
                      }`}
                    >
                      <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.03)_50%,transparent_100%)] animate-[shimmer_3s_infinite]" />
                      <Trophy className="w-5 h-5 text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.6)]" />
                      <span className="text-sm text-white/70 relative">
                        <span className={`font-bold ${aWins ? 'text-cyan-300' : 'text-purple-300'}`}>
                          {formatAddr(aWins ? dataA!.address : dataB!.address)}
                        </span>{' '}
                        dominates by{' '}
                        <span className="font-black text-green-400 text-base">+{Math.abs(scoreA - scoreB)}</span>
                      </span>
                      <Zap className={`w-4 h-4 ${aWins ? 'text-cyan-400' : 'text-purple-400'}`} />
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-yellow-500/20 bg-gradient-to-r from-yellow-500/5 via-orange-500/5 to-yellow-500/5 px-5 py-3 flex items-center justify-center gap-3">
                      <Shield className="w-5 h-5 text-yellow-400" />
                      <span className="text-sm text-yellow-300/80 font-bold">DRAW — Both wallets scored {scoreA}</span>
                      <Shield className="w-5 h-5 text-yellow-400" />
                    </div>
                  )}
                </motion.div>
              </div>

              {/* Radar Chart */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
              >
                <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2 text-center">
                  Radar Comparison
                </h3>
                <div className="flex items-center justify-center gap-4 mb-2">
                  <span className="flex items-center gap-1.5 text-[10px] text-cyan-400/70">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />A
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-purple-400/70">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />B
                  </span>
                </div>
                <RadarChart a={dataA!} b={dataB!} />
              </motion.div>

              {/* Battle Bars */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6, duration: 0.4 }}
                className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-4 space-y-3"
              >
                <h3 className="text-xs font-bold text-white/40 uppercase tracking-wider text-center mb-1">
                  Battle Stats
                </h3>

                <BattleBar label="Power Score" valA={scoreA} valB={scoreB} maxVal={1000} showValues />

                <div className="flex items-center justify-between py-1.5 px-2">
                  <span className={`text-xs font-bold ${TIER_COLORS[tierA]}`}>{TIER_LABELS[tierA]}</span>
                  <span className="text-[9px] uppercase tracking-wider text-white/25 font-bold">Tier</span>
                  <span className={`text-xs font-bold ${TIER_COLORS[tierB]}`}>{TIER_LABELS[tierB]}</span>
                </div>

                <BattleBar label="Badges" valA={badgesA} valB={badgesB} maxVal={Math.max(badgesA, badgesB, 14)} />

                {rows.map((row, i) => {
                  const maxVal = Math.max(row.numA, row.numB, 1);
                  return (
                    <motion.div
                      key={row.label}
                      initial={{ opacity: 0, scaleX: 0 }}
                      animate={{ opacity: 1, scaleX: 1 }}
                      transition={{ delay: 0.7 + i * 0.06, duration: 0.4 }}
                      style={{ transformOrigin: 'center' }}
                    >
                      <BattleBar
                        label={row.label}
                        valA={row.numA}
                        valB={row.numB}
                        maxVal={maxVal}
                        displayA={String(row.valueA)}
                        displayB={String(row.valueB)}
                      />
                    </motion.div>
                  );
                })}
              </motion.div>

              {/* Badge Comparison */}
              {allBadges.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
                >
                  <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">Badge Comparison</h3>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {allBadges.map((badge) => {
                      const label = BADGE_LABELS[badge]?.label || badge;
                      return (
                        <BadgeCard
                          key={badge}
                          name={label}
                          hasA={dataA!.badges.includes(badge)}
                          hasB={dataB!.badges.includes(badge)}
                        />
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {!bothLoaded && !isLoading && (
          <div className="text-center py-12 text-white/20">
            <ArrowUpDown className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">Enter two Solana wallet addresses to compare their identity scores</p>
          </div>
        )}
      </main>
    </PageShell>
  );
}
