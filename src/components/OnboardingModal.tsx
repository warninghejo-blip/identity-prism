import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const STEPS = [
  {
    title: 'Welcome to Identity Prism',
    desc: 'Your Solana identity, visualized. We analyze your on-chain activity to create a unique cosmic identity card — your digital passport in Web3.',
    icon: '🌟',
  },
  {
    title: 'Your Identity Score',
    desc: 'Your Composite Score is built from 5 pillars: On-Chain activity (max 400), Sybil Trust (250), Human Proof (150), Social (100), and Engagement (100).',
    icon: '📊',
  },
  {
    title: 'Earn & Prove',
    desc: 'Play games in Prism League, complete daily quests, challenge others in Prism Arena, and burn dust tokens in Black Hole. Every action strengthens your identity.',
    icon: '🚀',
  },
];

interface OnboardingModalProps {
  onClose: () => void;
}

export default function OnboardingModal({ onClose }: OnboardingModalProps) {
  const [step, setStep] = useState(0);

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      try { localStorage.setItem('ip_onboarding_v1', '1'); } catch {}
      onClose();
    }
  };

  const handleSkip = () => {
    try { localStorage.setItem('ip_onboarding_v1', '1'); } catch {}
    onClose();
  };

  const current = STEPS[step];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={handleSkip}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', damping: 25 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-sm bg-[#0a0c12] border border-white/10 rounded-2xl overflow-hidden"
      >
        {/* Top gradient */}
        <div className="h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500" />

        <div className="p-6 text-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-5xl mb-4">{current.icon}</div>
              <h2 className="text-lg font-bold text-white mb-2">{current.title}</h2>
              <p className="text-sm text-white/50 leading-relaxed">{current.desc}</p>
            </motion.div>
          </AnimatePresence>

          {/* Progress dots */}
          <div className="flex justify-center gap-2 mt-6 mb-4">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-all ${i === step ? 'bg-cyan-400 w-6' : 'bg-white/20'}`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleSkip}
              className="text-xs text-white/30 hover:text-white/60 transition"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="px-6 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 text-sm font-semibold hover:bg-cyan-500/30 transition"
            >
              {step < STEPS.length - 1 ? 'Next' : 'Get Started'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
