/**
 * BattleResultOverlay — Full-screen dramatic battle result with slot-counter animations,
 * screen shake, particle burst, and victory/defeat FX.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { Swords, ArrowLeft } from 'lucide-react';

/* ── Helpers ── */

function truncAddr(a: string) {
  return a.length > 8 ? `${a.slice(0, 4)}..${a.slice(-4)}` : a;
}

/* ── SlotCounter ── */

function SlotCounter({ target, delay, color }: { target: number; delay: number; color: string }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const startedRef = useRef(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      startedRef.current = true;
      const animate = (ts: number) => {
        if (!startRef.current) startRef.current = ts;
        const elapsed = ts - startRef.current;
        const duration = 2000;
        const t = Math.min(elapsed / duration, 1);
        // easeOut cubic: 1 - (1-t)^3
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplay(Math.round(eased * target));
        if (t < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };
      rafRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, delay]);

  return (
    <span
      className="text-4xl font-black font-mono tabular-nums"
      style={{ color, textShadow: `0 0 20px ${color}44, 0 0 40px ${color}22` }}
    >
      {display}
    </span>
  );
}

/* ── Particles ── */

function ParticleBurst({ show }: { show: boolean }) {
  if (!show) return null;
  const particles = Array.from({ length: 20 }, (_, i) => {
    const angle = (i / 20) * Math.PI * 2;
    const dist = 80 + Math.random() * 120;
    const px = Math.cos(angle) * dist;
    const py = Math.sin(angle) * dist;
    const colors = ['#fbbf24', '#a855f6', '#22d3ee', '#fb923c', '#34d399'];
    const color = colors[i % colors.length];
    const size = 3 + Math.random() * 4;

    return (
      <div
        key={i}
        className="absolute rounded-full"
        style={{
          width: size,
          height: size,
          background: color,
          left: '50%',
          top: '50%',
          boxShadow: `0 0 6px ${color}`,
          animation: `particle-float 1.2s ease-out forwards`,
          animationDelay: `${Math.random() * 0.3}s`,
          '--px': `${px}px`,
          '--py': `${py}px`,
        } as React.CSSProperties}
      />
    );
  });
  return <div className="absolute inset-0 pointer-events-none overflow-hidden">{particles}</div>;
}

/* ── Main Overlay ── */

export interface ChallengeResult {
  id: string;
  creator: string;
  opponent: string | null;
  creatorScore: number | null;
  opponentScore: number | null;
  winner: string | null;
  stakeAmount: number;
  stakeType: 'coins' | 'sol';
  status: string;
}

interface BattleResultOverlayProps {
  challenge: ChallengeResult;
  myAddress: string;
  onReturn: () => void;
}

export default function BattleResultOverlay({ challenge, myAddress, onReturn }: BattleResultOverlayProps) {
  const [phase, setPhase] = useState(0);
  // Phases: 0=backdrop, 1=panel, 2=sides, 3=counters, 4=shake, 5=result text, 6=particles+buttons

  const isCreator = myAddress.toLowerCase() === challenge.creator.toLowerCase();
  const myScore = isCreator ? (challenge.creatorScore ?? 0) : (challenge.opponentScore ?? 0);
  const opponentScore = isCreator ? (challenge.opponentScore ?? 0) : (challenge.creatorScore ?? 0);
  const opponentAddr = isCreator ? (challenge.opponent ?? '???') : challenge.creator;
  const won = challenge.winner?.toLowerCase() === myAddress.toLowerCase();
  const draw = challenge.winner === null && challenge.status === 'completed';

  const stakeLabel = challenge.stakeType === 'sol'
    ? `${challenge.stakeAmount} SOL`
    : `${challenge.stakeAmount} Coins`;

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1400),
      setTimeout(() => setPhase(4), 3500),
      setTimeout(() => setPhase(5), 3800),
      setTimeout(() => setPhase(6), 4200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-md"
      >
        {/* Panel */}
        {phase >= 1 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={phase >= 4
              ? { y: 0, opacity: 1, x: [0, -6, 6, -4, 4, 0] }
              : { y: 0, opacity: 1 }
            }
            transition={phase >= 4
              ? { x: { duration: 0.4, ease: 'easeOut' }, y: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } }
              : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
            }
            className="relative w-[92vw] max-w-md rounded-2xl bg-gradient-to-b from-white/[0.1] to-white/[0.03] backdrop-blur-2xl border border-white/[0.12] p-8 text-center overflow-visible"
          >
            <ParticleBurst show={phase >= 6} />

            {/* Title */}
            <div className="text-xs font-bold tracking-[0.3em] text-white/30 mb-6">BATTLE RESULT</div>

            {/* VS Layout */}
            <div className="flex items-center justify-center gap-4 mb-6">
              {/* Left (me) */}
              {phase >= 2 && (
                <motion.div
                  initial={{ x: -60, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="flex-1 text-center"
                >
                  <div className="text-[10px] text-cyan-400/60 font-mono tracking-wider mb-2">YOU</div>
                  <div className="text-xs text-white/40 font-mono mb-3">{truncAddr(myAddress)}</div>
                  {phase >= 3 && (
                    <SlotCounter target={myScore} delay={0} color={won ? '#22c55e' : '#ef4444'} />
                  )}
                </motion.div>
              )}

              {/* VS */}
              {phase >= 2 && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                  className="flex flex-col items-center gap-1"
                >
                  <Swords size={20} className="text-amber-400/60" />
                  <span className="text-[10px] font-bold text-white/20">VS</span>
                </motion.div>
              )}

              {/* Right (opponent) */}
              {phase >= 2 && (
                <motion.div
                  initial={{ x: 60, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
                  className="flex-1 text-center"
                >
                  <div className="text-[10px] text-pink-400/60 font-mono tracking-wider mb-2">OPP</div>
                  <div className="text-xs text-white/40 font-mono mb-3">{truncAddr(opponentAddr)}</div>
                  {phase >= 3 && (
                    <SlotCounter target={opponentScore} delay={0} color={won ? '#ef4444' : '#22c55e'} />
                  )}
                </motion.div>
              )}
            </div>

            {/* Result text */}
            {phase >= 5 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.2, 1] }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="mb-2"
              >
                <div
                  className="text-2xl font-black tracking-wider mb-1"
                  style={{
                    color: draw ? '#fbbf24' : won ? '#22c55e' : '#ef4444',
                    textShadow: `0 0 30px ${draw ? '#fbbf2444' : won ? '#22c55e44' : '#ef444444'}`,
                  }}
                >
                  {draw ? 'DRAW!' : won ? 'YOU WON!' : 'YOU LOST'}
                </div>
                <div className="text-sm text-white/40">
                  {draw ? 'Stake returned' : won ? `+${stakeLabel}` : `-${stakeLabel}`}
                </div>
              </motion.div>
            )}

            {/* Action buttons */}
            {phase >= 6 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="mt-6"
              >
                <button
                  onClick={onReturn}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] text-white/70 hover:text-white font-bold text-sm tracking-wider transition-all border border-white/[0.08]"
                >
                  <ArrowLeft size={16} />
                  Return to Arena
                </button>
              </motion.div>
            )}

            {/* Winner glow */}
            {phase >= 5 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, scale: [1, 1.05, 1] }}
                transition={{ scale: { duration: 1.5, repeat: Infinity } }}
                className="absolute -top-20 left-1/2 -translate-x-1/2 w-60 h-60 rounded-full blur-3xl pointer-events-none"
                style={{ background: draw ? 'rgba(251,191,36,0.1)' : won ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.08)' }}
              />
            )}
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
