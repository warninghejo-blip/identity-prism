/**
 * WelcomeBackModal — shown once when a migrated v1→v2 user opens the app.
 * Celebrates past achievements and reveals their earned Ranger rank.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Trophy, Gamepad2, Coins } from 'lucide-react';

const RANK_NAMES: Record<string, string> = {
  cadet: 'Cadet',
  pilot: 'Pilot',
  captain: 'Captain',
  ace: 'Ace',
  legend: 'Legend',
};

const RANK_COLORS: Record<string, string> = {
  cadet: '#94A3B8',
  pilot: '#06B6D4',
  captain: '#A855F7',
  ace: '#F59E0B',
  legend: '#EF4444',
};

export interface MigrationData {
  rangerRank: string;
  totalXP: number;
  xpBreakdown: {
    gameBestScores: number;
    gamesPlayed: number;
    achievements: number;
    coinsEarned: number;
  };
  coinBalance: number;
  gamesPlayed: number;
  achievementCount: number;
}

interface WelcomeBackModalProps {
  open: boolean;
  onClose: () => void;
  migrationData: MigrationData;
}

function useCountUp(target: number, enabled: boolean, duration = 1500) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, target, duration]);

  return value;
}

const prefersReducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function WelcomeBackModal({ open, onClose, migrationData }: WelcomeBackModalProps) {
  const { rangerRank, totalXP, xpBreakdown, coinBalance, gamesPlayed, achievementCount } = migrationData;

  const rankColor = RANK_COLORS[rangerRank] ?? '#7C3AED';
  const rankLabel = (RANK_NAMES[rangerRank] ?? rangerRank).toUpperCase();

  // XP counter starts after 0.8s delay
  const [xpCounterEnabled, setXpCounterEnabled] = useState(false);
  useEffect(() => {
    if (!open) {
      setXpCounterEnabled(false);
      return;
    }
    const t = setTimeout(() => setXpCounterEnabled(true), prefersReducedMotion ? 0 : 800);
    return () => clearTimeout(t);
  }, [open]);

  const displayXP = useCountUp(totalXP, xpCounterEnabled, prefersReducedMotion ? 0 : 1500);

  const motionDisabled = prefersReducedMotion;

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
  };

  const cardVariants = {
    hidden: { opacity: 0, scale: motionDisabled ? 1 : 0.9, y: motionDisabled ? 0 : 20 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { duration: 0.3, type: 'spring' as const, stiffness: 260, damping: 22 },
    },
    exit: { opacity: 0, scale: 0.95, y: 10, transition: { duration: 0.2 } },
  };

  const statCards = [
    { icon: Gamepad2, label: 'Games Played', value: gamesPlayed },
    { icon: Trophy, label: 'Best Score XP', value: xpBreakdown.gameBestScores },
    { icon: Shield, label: 'Achievements', value: achievementCount },
    { icon: Coins, label: 'Coins Earned', value: xpBreakdown.coinsEarned },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="wb-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={onClose}
        >
          <motion.div
            key="wb-card"
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-2xl overflow-hidden"
            style={{
              background: 'linear-gradient(160deg, rgba(124,58,237,0.12) 0%, rgba(15,15,35,0.98) 40%)',
              border: '1px solid rgba(124,58,237,0.25)',
              backdropFilter: 'blur(24px)',
            }}
          >
            {/* Background glow orbs */}
            <div
              className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
              style={{
                background: `radial-gradient(circle, ${rankColor}22 0%, transparent 70%)`,
                filter: 'blur(24px)',
              }}
            />
            <div
              className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full pointer-events-none"
              style={{
                background: 'radial-gradient(circle, rgba(6,182,212,0.15) 0%, transparent 70%)',
                filter: 'blur(20px)',
              }}
            />

            <div className="relative z-10 px-6 pt-8 pb-7 flex flex-col items-center gap-5">
              {/* Header */}
              <motion.div
                initial={motionDisabled ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.3 }}
                className="text-center"
              >
                <p className="text-xs tracking-[0.35em] uppercase text-cyan-400/60 mb-1">Identity Prism</p>
                <h2 className="text-2xl font-black tracking-wide text-white">
                  Welcome Back,{' '}
                  <span
                    className="text-transparent bg-clip-text"
                    style={{ backgroundImage: 'linear-gradient(90deg, #7C3AED, #06B6D4)' }}
                  >
                    Ranger!
                  </span>
                </h2>
              </motion.div>

              {/* Rank Badge */}
              <motion.div
                initial={motionDisabled ? false : { opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5, duration: 0.45, type: 'spring', stiffness: 220, damping: 15 }}
                className="flex flex-col items-center gap-2"
              >
                {/* Glow ring */}
                <div className="relative flex items-center justify-center">
                  <motion.div
                    className="absolute w-24 h-24 rounded-full"
                    style={{ background: `radial-gradient(circle, ${rankColor}40 0%, transparent 70%)` }}
                    animate={
                      motionDisabled
                        ? {}
                        : {
                            scale: [1, 1.15, 1],
                            opacity: [0.6, 1, 0.6],
                          }
                    }
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <div
                    className="relative w-20 h-20 rounded-full flex items-center justify-center text-3xl font-black"
                    style={{
                      background: `linear-gradient(135deg, ${rankColor}30, ${rankColor}10)`,
                      border: `2px solid ${rankColor}60`,
                      boxShadow: `0 0 24px ${rankColor}40`,
                      color: rankColor,
                    }}
                  >
                    {rankLabel.charAt(0)}
                  </div>
                </div>
                <div>
                  <p className="text-center text-[11px] tracking-[0.4em] uppercase text-white/40 mb-0.5">Ranger Rank</p>
                  <p
                    className="text-center text-xl font-black tracking-widest"
                    style={{ color: rankColor, textShadow: `0 0 16px ${rankColor}80` }}
                  >
                    {rankLabel}
                  </p>
                </div>
              </motion.div>

              {/* XP Counter */}
              <motion.div
                initial={motionDisabled ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8, duration: 0.3 }}
                className="text-center"
              >
                <p className="text-xs uppercase tracking-[0.3em] text-white/40 mb-1">Total XP Earned</p>
                <p
                  className="text-4xl font-black tabular-nums"
                  style={{
                    background: 'linear-gradient(90deg, #7C3AED, #06B6D4)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  {displayXP.toLocaleString()} <span className="text-2xl">XP</span>
                </p>
              </motion.div>

              {/* Stat breakdown 2×2 grid */}
              <div className="w-full grid grid-cols-2 gap-2.5">
                {statCards.map(({ icon: Icon, label, value }, i) => (
                  <motion.div
                    key={label}
                    initial={motionDisabled ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.0 + i * 0.1, duration: 0.3 }}
                    className="rounded-xl px-3 py-3 flex flex-col gap-1"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <Icon size={14} className="text-white/40" />
                    <p className="text-[10px] text-white/40 leading-tight">{label}</p>
                    <p className="text-base font-bold text-white/90 tabular-nums">{value.toLocaleString()}</p>
                  </motion.div>
                ))}
              </div>

              {/* Message */}
              <motion.p
                initial={motionDisabled ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.4, duration: 0.3 }}
                className="text-[13px] text-center text-white/50 leading-snug px-2"
              >
                Your past achievements have been recognized.
              </motion.p>

              {/* CTA */}
              <motion.button
                initial={motionDisabled ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5, duration: 0.3 }}
                whileHover={motionDisabled ? {} : { scale: 1.04 }}
                whileTap={motionDisabled ? {} : { scale: 0.97 }}
                onClick={onClose}
                className="w-full py-3.5 rounded-full font-bold text-sm tracking-wider text-white transition-all"
                style={{
                  background: 'linear-gradient(90deg, #7C3AED, #06B6D4)',
                  boxShadow: '0 0 24px rgba(124,58,237,0.4)',
                }}
              >
                Begin New Chapter
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
