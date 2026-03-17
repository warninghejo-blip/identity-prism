/**
 * ScanProgress — epic animated loading screen for wallet scanning.
 * Shows multi-phase progress with cosmic theme.
 */
import { useState, useEffect, useRef } from 'react';
import { onScanProgress, type ScanPhase } from '@/hooks/useWalletData';

const PHASE_CONFIG: Record<ScanPhase, { label: string; icon: string }> = {
  connecting: { label: 'Connecting to Solana', icon: '\u{1F30D}' },
  balance: { label: 'Reading SOL balance', icon: '\u{1F4B0}' },
  transactions: { label: 'Scanning transactions', icon: '\u{1F4DC}' },
  assets: { label: 'Analyzing digital assets', icon: '\u{1F48E}' },
  analyzing: { label: 'Mapping identity traits', icon: '\u{1F52C}' },
  scoring: { label: 'Computing cosmic score', icon: '\u2728' },
  done: { label: 'Identity resolved', icon: '\u{1F320}' },
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

export default function ScanProgress({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<ScanPhase>('connecting');
  const [pct, setPct] = useState(0);
  const [smoothPct, setSmoothPct] = useState(0);
  const [loreIdx, setLoreIdx] = useState(() => Math.floor(Math.random() * LORE_MESSAGES.length));
  const [completedPhases, setCompletedPhases] = useState<Set<ScanPhase>>(new Set());
  const frameRef = useRef(0);

  // Subscribe to scan progress events
  useEffect(() => {
    if (!active) return;
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
  }, [active]);

  // Smooth progress animation
  useEffect(() => {
    if (!active) return;
    let raf: number;
    const animate = () => {
      setSmoothPct((prev) => {
        const diff = pct - prev;
        if (Math.abs(diff) < 0.5) return pct;
        return prev + diff * 0.08;
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

  const currentConfig = PHASE_CONFIG[phase];
  const currentPhaseIdx = PHASE_ORDER.indexOf(phase);

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
      <p key={phase} className="scan-progress-phase">
        {currentConfig.label}
      </p>

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
