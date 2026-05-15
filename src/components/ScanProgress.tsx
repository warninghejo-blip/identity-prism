/**
 * ScanProgress — epic animated loading screen for wallet scanning.
 * Shows multi-phase progress with cosmic theme.
 */
import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { onScanProgress, type ScanPhase } from '@/hooks/useWalletData';

/* ─────────────────────────────────────────────────────────
 * PRISM LOAD STORYBOARD
 *
 * Static starfield stays visible behind the glass panel.
 * Only the load panel stages forward while auth/data resolves.
 *
 *    0ms   glass panel appears, identity core starts pulsing
 *  350ms   wallet proof line resolves during Seed Vault signing
 *  900ms   profile stream activates while native/API data races
 * 1400ms   score synthesis line arms until hub is ready
 * ───────────────────────────────────────────────────────── */
const TIMING = {
  walletProof: 350,
  profileStream: 900,
  scoreSynthesis: 1400,
};

const PHASE_CONFIG: Record<ScanPhase, { label: string; icon: string }> = {
  connecting: { label: 'Linking identity core', icon: 'IP' },
  balance: { label: 'Reading SOL signal', icon: 'IP' },
  transactions: { label: 'Tracing transaction graph', icon: 'IP' },
  assets: { label: 'Indexing digital assets', icon: 'IP' },
  analyzing: { label: 'Mapping identity traits', icon: 'IP' },
  scoring: { label: 'Computing prism score', icon: 'IP' },
  done: { label: 'Identity resolved', icon: 'IP' },
};

const PHASE_ORDER: ScanPhase[] = ['connecting', 'balance', 'transactions', 'assets', 'analyzing', 'scoring', 'done'];

const LORE_MESSAGES = [
  'Tracing the echoes of your first transaction...',
  'Every token tells a story...',
  'The chain remembers what wallets forget...',
  'Mapping your constellation across the Solana sky...',
  'Decoding the rhythm of your on-chain heartbeat...',
  'Your digital footprint is unique as a supernova...',
  'Sifting through stardust and smart contracts...',
  'The cosmos recognizes its own...',
];

export default function ScanProgress({
  active,
  authenticating = false,
}: {
  active: boolean;
  authenticating?: boolean;
}) {
  const [phase, setPhase] = useState<ScanPhase>('connecting');
  const [pct, setPct] = useState(0);
  const [smoothPct, setSmoothPct] = useState(0);
  const [loreIdx, setLoreIdx] = useState(() => Math.floor(Math.random() * LORE_MESSAGES.length));
  const [completedPhases, setCompletedPhases] = useState<Set<ScanPhase>>(new Set());
  const [stage, setStage] = useState(0);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    setStage(0);
    const timers = [
      window.setTimeout(() => setStage(1), TIMING.walletProof),
      window.setTimeout(() => setStage(2), TIMING.profileStream),
      window.setTimeout(() => setStage(3), TIMING.scoreSynthesis),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [active, authenticating]);

  // Subscribe to scan progress events
  useEffect(() => {
    if (!active) return;
    if (authenticating) {
      setPhase('connecting');
      setPct(18);
      setSmoothPct(18);
      setCompletedPhases(new Set());
      return;
    }
    setPhase('connecting');
    setPct(0);
    setSmoothPct(0);
    setCompletedPhases(new Set());

    return onScanProgress((newPhase, newPct) => {
      setPhase(newPhase);
      setPct(newPct);
      // Mark all phases before current as completed
      const idx = PHASE_ORDER.indexOf(newPhase);
      if (idx > 0) {
        setCompletedPhases(new Set(PHASE_ORDER.slice(0, idx)));
      }
    });
  }, [active, authenticating]);

  useEffect(() => {
    if (!active || !authenticating) return;
    const nextPct = stage >= 3 ? 64 : stage >= 2 ? 46 : stage >= 1 ? 30 : 18;
    setPct(nextPct);
  }, [active, authenticating, stage]);

  // Smooth progress animation
  useEffect(() => {
    if (!active) return;
    let raf: number;
    const animate = () => {
      setSmoothPct((prev) => {
        const diff = pct - prev;
        if (Math.abs(diff) < 0.5) return pct;
        return prev + diff * 0.15;
      });
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [active, pct]);

  // Cycle lore messages
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setLoreIdx((prev) => (prev + 1) % LORE_MESSAGES.length);
    }, 3200);
    return () => clearInterval(timer);
  }, [active]);

  // Floating particles animation
  useEffect(() => {
    if (!active) return;
    frameRef.current = 0;
    const timer = setInterval(() => {
      frameRef.current++;
    }, 50);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const currentConfig = authenticating
    ? {
        icon: 'IP',
        label:
          stage >= 3
            ? 'Preparing identity stream'
            : stage >= 2
              ? 'Opening prism profile'
              : stage >= 1
                ? 'Waiting for Seed Vault proof'
                : 'Securing wallet session',
      }
    : PHASE_CONFIG[phase];
  const currentPhaseIdx = PHASE_ORDER.indexOf(phase);
  const statusRows = authenticating
    ? [
        { label: 'Wallet session', done: stage >= 1 },
        { label: 'Seed Vault proof', done: stage >= 2 },
        { label: 'Prism profile', done: stage >= 3 },
      ]
    : [
        { label: 'Profile', done: smoothPct >= 35 },
        { label: 'Signals', done: smoothPct >= 70 },
        { label: 'Score', done: smoothPct >= 96 },
      ];

  return (
    <div className="scan-progress-root">
      {/* Radial glow background */}
      <div className="scan-progress-glow" />

      {/* Center ring */}
      <div className="scan-progress-ring-wrap">
        <svg className="scan-progress-ring" viewBox="0 0 120 120">
          {/* Track */}
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
          {/* Progress arc */}
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke="url(#scanGrad)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(smoothPct / 100) * 326.73} 326.73`}
            className="scan-progress-arc"
          />
          <defs>
            <linearGradient id="scanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="50%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
          </defs>
        </svg>

        {/* Center content */}
        <div className="scan-progress-center">
          <span className="scan-progress-icon">{currentConfig.icon}</span>
          <span className="scan-progress-pct">{Math.round(smoothPct)}%</span>
        </div>
      </div>

      {/* Phase label */}
      <p className="scan-progress-eyebrow">PRISM SCAN</p>
      <p key={phase} className="scan-progress-phase">
        {currentConfig.label}
      </p>

      <div className="scan-progress-status" aria-label="Identity load status">
        {statusRows.map((row, index) => (
          <div key={row.label} className={`scan-progress-status-row${row.done ? ' done' : ''}`}>
            <span className="scan-progress-status-mark">{row.done ? 'OK' : `0${index + 1}`}</span>
            <span>{row.label}</span>
          </div>
        ))}
      </div>

      <div className="scan-progress-passport" aria-hidden="true">
        {['ON-CHAIN', 'TRUST', 'GAMES', 'SOCIAL', 'ENGAGE'].map((label, index) => (
          <div key={label} className="scan-progress-passport-row">
            <span>{label}</span>
            <i style={{ '--bar-scale': `${0.34 + index * 0.12}` } as CSSProperties & Record<'--bar-scale', string>} />
          </div>
        ))}
      </div>

      {/* Phase dots */}
      <div className="scan-progress-dots">
        {PHASE_ORDER.filter((p) => p !== 'done').map((p, i) => (
          <div
            key={p}
            className={`scan-dot ${completedPhases.has(p) ? 'done' : p === phase ? 'active' : ''}`}
            title={PHASE_CONFIG[p].label}
          />
        ))}
      </div>

      {/* Lore message */}
      <p key={loreIdx} className="scan-progress-lore">
        {LORE_MESSAGES[loreIdx]}
      </p>

      {/* Orbiting particles */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="scan-particle"
          style={
            {
              '--particle-delay': `${i * -1.5}s`,
              '--particle-size': `${2 + (i % 3)}px`,
              '--particle-orbit': `${80 + i * 15}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
