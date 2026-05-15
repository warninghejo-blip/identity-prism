/**
 * ChallengeReadyModal — "Arena Ready" modal shown after creating/accepting a game challenge.
 * Creator MUST play — cancel only available for coin challenges (refunds coins).
 * SOL challenges cannot be cancelled (SOL already sent).
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Swords, Sparkles } from 'lucide-react';

const GAME_ICONS: Record<string, string> = {
  orbit: '\u{1F6F8}',
  destroyer: '\u{1F4A5}',
  gravity: '\u{1F504}',
};

const GAME_NAMES: Record<string, string> = {
  orbit: 'Orbit Survival',
  destroyer: 'Cosmic Defender',
  gravity: 'Gravity Runner',
};

interface ChallengeReadyModalProps {
  isOpen: boolean;
  challenge: {
    id: string;
    gameMode: string | null;
    stakeAmount: number;
    stakeType: 'coins' | 'sol';
  };
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ChallengeReadyModal({ isOpen, challenge, onConfirm, onCancel }: ChallengeReadyModalProps) {
  const [showContent, setShowContent] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => setShowContent(true), 200);
      return () => clearTimeout(t);
    }
    setShowContent(false);
  }, [isOpen]);

  const gameMode = challenge.gameMode ?? 'orbit';
  const icon = GAME_ICONS[gameMode] ?? '\u{1F3AE}';
  const name = GAME_NAMES[gameMode] ?? gameMode;
  const isSol = challenge.stakeType === 'sol';
  const stakeLabel = isSol ? `${challenge.stakeAmount} SOL` : `${challenge.stakeAmount} Coins`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          role="dialog"
          aria-modal="true"
          aria-label="Arena Challenge Ready"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.7, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 20 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-[90vw] max-w-sm rounded-2xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] backdrop-blur-2xl border border-white/[0.12] p-8 text-center overflow-hidden"
          >
            {/* Animated sword icon */}
            {showContent && (
              <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.2, type: 'spring', stiffness: 200 }}
                className="mb-4"
              >
                <Swords
                  size={40}
                  className="mx-auto text-amber-400 animate-bounce"
                  style={{ animationDuration: '2s' }}
                />
              </motion.div>
            )}

            <h2 className="text-xl font-black tracking-wider text-white/90 mb-6">ARENA READY</h2>

            {/* Game info */}
            <div className="space-y-3 mb-8">
              <div className="text-2xl">{icon}</div>
              <div className="text-base font-bold text-white/80">{name}</div>
              <div className="text-sm text-white/40">
                Stake: <span className="text-amber-400 font-bold">{stakeLabel}</span>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="space-y-3">
              <motion.button
                onClick={onConfirm}
                autoFocus
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold text-sm tracking-wider hover:from-amber-400 hover:to-orange-400 transition-all"
                animate={{
                  boxShadow: [
                    '0 0 20px rgba(251,191,36,0.3)',
                    '0 0 40px rgba(251,191,36,0.5)',
                    '0 0 20px rgba(251,191,36,0.3)',
                  ],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <span className="flex items-center justify-center gap-2">
                  <Sparkles size={16} />
                  Let's Go!
                  <Sparkles size={16} />
                </span>
              </motion.button>

              {/* Cancel only for coin challenges — SOL already sent, can't refund */}
              {!isSol && (
                <button
                  onClick={() => {
                    setCancelling(true);
                    onCancel();
                  }}
                  disabled={cancelling}
                  className="w-full py-2.5 rounded-xl bg-white/[0.05] text-white/40 text-sm font-medium hover:bg-red-500/10 hover:text-red-400/60 transition-all"
                >
                  {cancelling ? 'Cancelling...' : 'Cancel Challenge'}
                </button>
              )}
              {isSol && <p className="text-[10px] text-white/20 mt-2">SOL stake sent — play to compete</p>}
            </div>

            {/* Background glow */}
            <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-60 h-60 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
