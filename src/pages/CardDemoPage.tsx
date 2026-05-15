import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

/**
 * CardDemoPage - Interactive celestial card tier showcase
 * Allows clicking through 10 planet tiers, showing stat progression
 *
 * ASCII STORYBOARD:
 * ─────────────────────────────────────────────────────────────
 * Stage 0: Page load                              t=0ms
 * ├─ Header fade in                             t=0ms
 * ├─ Card stage scale in                        t=200ms
 * ├─ Tier selector buttons stagger               t=400ms (+50ms each)
 * └─ Stat display fade                          t=600ms
 *
 * Stage 1: Tier change animation
 * ├─ Card flip/scale out                        t=0ms
 * ├─ Planet change (crossfade)                  t=150ms
 * ├─ Stats update (rolling numbers)             t=300ms
 * └─ Badges stagger                             t=400ms
 */

// Tier data: planet name, color, stars required, stat modifiers, icon
const TIERS = [
  {
    name: 'Mercury',
    subtitle: 'Newcomer',
    color: 'from-slate-400 to-slate-300',
    colorAccent: '#94a3b8',
    stars: 0,
    stats: { speed: 20, shield: 40, firepower: 50, luck: 45 },
    description: 'Just starting your journey',
  },
  {
    name: 'Venus',
    subtitle: 'Explorer',
    color: 'from-amber-400 to-yellow-300',
    colorAccent: '#fbbf24',
    stars: 50,
    stats: { speed: 24, shield: 46, firepower: 55, luck: 50 },
    description: 'Getting your footing',
  },
  {
    name: 'Earth',
    subtitle: 'Established',
    color: 'from-blue-400 to-cyan-300',
    colorAccent: '#06b6d4',
    stars: 150,
    stats: { speed: 28, shield: 52, firepower: 62, luck: 58 },
    description: 'Proven track record',
  },
  {
    name: 'Mars',
    subtitle: 'Warrior',
    color: 'from-red-500 to-orange-400',
    colorAccent: '#ef4444',
    stars: 300,
    stats: { speed: 32, shield: 58, firepower: 70, luck: 62 },
    description: 'Battle-hardened',
  },
  {
    name: 'Jupiter',
    subtitle: 'Titan',
    color: 'from-orange-500 to-amber-500',
    colorAccent: '#f97316',
    stars: 500,
    stats: { speed: 38, shield: 68, firepower: 80, luck: 72 },
    description: 'Legendary presence',
  },
  {
    name: 'Saturn',
    subtitle: 'Celestial',
    color: 'from-amber-300 to-yellow-100',
    colorAccent: '#eab308',
    stars: 800,
    stats: { speed: 44, shield: 78, firepower: 90, luck: 82 },
    description: 'Cosmic influence',
  },
  {
    name: 'Uranus',
    subtitle: 'Ethereal',
    color: 'from-cyan-400 to-blue-300',
    colorAccent: '#22d3ee',
    stars: 1200,
    stats: { speed: 50, shield: 88, firepower: 100, luck: 90 },
    description: 'Beyond mortal ken',
  },
  {
    name: 'Neptune',
    subtitle: 'Mystic',
    color: 'from-blue-600 to-indigo-400',
    colorAccent: '#4f46e5',
    stars: 1600,
    stats: { speed: 56, shield: 98, firepower: 110, luck: 98 },
    description: 'Mysterious power',
  },
  {
    name: 'Pluto',
    subtitle: 'Ancient',
    color: 'from-slate-700 to-slate-500',
    colorAccent: '#64748b',
    stars: 2000,
    stats: { speed: 62, shield: 108, firepower: 120, luck: 105 },
    description: 'Old world wisdom',
  },
  {
    name: 'Sun',
    subtitle: 'Supreme',
    color: 'from-yellow-400 via-orange-400 to-red-400',
    colorAccent: '#fbbf24',
    stars: 3000,
    stats: { speed: 70, shield: 120, firepower: 135, luck: 115 },
    description: 'The ultimate form',
  },
];

const TIMING = {
  headerFadeIn: 0,
  cardScaleIn: 200,
  buttonStagger: 400,
  buttonStaggerOffset: 50,
  statFade: 600,
  cardFlip: 0,
  planetChange: 150,
  statsUpdate: 300,
};

interface CardStatProps {
  label: string;
  value: number;
  max?: number;
}

const CardStat: React.FC<CardStatProps> = ({ label, value, max = 150 }) => {
  const percentage = (value / max) * 100;
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="font-orbitron text-xs tracking-wider text-white/40 uppercase">{label}</span>
        <span className="font-jetbrains font-700 text-white">{value}</span>
      </div>
      <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ delay: TIMING.statsUpdate / 1000, duration: 0.6, ease: 'easeOut' }}
          className="h-full bg-gradient-to-r from-purple-500 to-cyan-400"
        />
      </div>
    </div>
  );
};

export default function CardDemoPage() {
  const [selectedTier, setSelectedTier] = useState(2); // Start at Earth (mid-tier)
  const tier = TIERS[selectedTier];

  return (
    <div className="relative w-full min-h-screen bg-black text-white overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-900/5 to-transparent" />
      </div>

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: TIMING.headerFadeIn / 1000, duration: 0.6 }}
        className="relative z-10 border-b border-white/10 backdrop-blur-lg bg-black/50 py-4"
      >
        <div className="container mx-auto px-8 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-xs font-bold">
              IP
            </div>
            <span className="font-orbitron text-sm font-700 tracking-wider">IDENTITY PRISM</span>
          </a>
          <a
            href="/app"
            className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white font-600 text-sm rounded-lg transition-colors"
          >
            Launch App
          </a>
        </div>
      </motion.header>

      {/* Main Content */}
      <div className="relative z-10 min-h-[calc(100vh-100px)] flex items-center py-16">
        <div className="container mx-auto px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start lg:items-center">
            {/* Left: Info */}
            <motion.div initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-400/25 mb-6">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                <span className="font-orbitron text-xs tracking-widest text-purple-300 uppercase">
                  Interactive Demo
                </span>
              </div>

              <h1 className="font-space-grotesk text-4xl md:text-5xl font-900 mb-4">
                <span className="block">Celestial</span>
                <span className="block">Cards</span>
              </h1>

              <p className="text-white/60 text-lg leading-relaxed mb-8 max-w-lg">
                Choose a tier to see how celestial cards showcase your reputation and unlock stat bonuses. The higher
                you climb, the stronger your identity.
              </p>

              {/* Tier Stats */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-8">
                <p className="text-xs font-orbitron tracking-widest text-white/40 uppercase mb-4">Current Stats</p>
                <div className="space-y-3">
                  <CardStat label="Speed" value={tier.stats.speed} max={80} />
                  <CardStat label="Shield" value={tier.stats.shield} max={130} />
                  <CardStat label="Firepower" value={tier.stats.firepower} max={150} />
                  <CardStat label="Luck" value={tier.stats.luck} max={120} />
                </div>
              </div>

              <div>
                <p className="text-xs font-orbitron tracking-widest text-white/40 uppercase mb-3">About this tier</p>
                <p className="text-white/70">{tier.description}</p>
              </div>
            </motion.div>

            {/* Right: Card Visual */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: TIMING.cardScaleIn / 1000, duration: 0.8, ease: 'easeOut' }}
              className="flex flex-col items-center gap-8"
            >
              {/* Card */}
              <div className="w-full max-w-sm">
                <motion.div
                  key={selectedTier}
                  initial={{ rotateY: -90, opacity: 0 }}
                  animate={{ rotateY: 0, opacity: 1 }}
                  exit={{ rotateY: 90, opacity: 0 }}
                  transition={{ duration: 0.5, ease: 'easeInOut' }}
                  className="perspective"
                >
                  <div
                    className={`relative p-6 rounded-2xl bg-gradient-to-br from-white/5 to-white/2 border border-white/10 
                    shadow-2xl overflow-hidden`}
                    style={{
                      background: `linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))`,
                    }}
                  >
                    {/* Glow background */}
                    <div
                      className="absolute inset-0 opacity-20 blur-3xl"
                      style={{
                        background: `radial-gradient(circle, ${tier.colorAccent}40, transparent 70%)`,
                      }}
                    />

                    {/* Card content */}
                    <div className="relative z-10">
                      {/* Header */}
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <p className="font-orbitron text-10px tracking-widest text-white/40 uppercase">
                            Tier {selectedTier + 1}/10
                          </p>
                          <h2
                            className={`font-orbitron text-3xl font-900 tracking-wide uppercase mt-2 bg-gradient-to-r ${tier.color} bg-clip-text text-transparent`}
                          >
                            {tier.name}
                          </h2>
                          <p className="text-sm text-white/50 mt-1">{tier.subtitle}</p>
                        </div>
                      </div>

                      {/* Stars */}
                      <div className="flex items-center gap-2 mb-6">
                        <div className="flex gap-1">
                          {[...Array(5)].map((_, i) => (
                            <div
                              key={i}
                              className={`w-3 h-3 rounded-full ${
                                i < Math.min(5, Math.floor(tier.stars / 600))
                                  ? `bg-gradient-to-br ${tier.color}`
                                  : 'bg-white/10'
                              }`}
                            />
                          ))}
                        </div>
                        <p className="font-jetbrains text-xs text-white/40">{tier.stars.toLocaleString()} EARTH</p>
                      </div>

                      {/* Score display */}
                      <div className="text-center py-6 border-t border-b border-white/10">
                        <p className="font-orbitron text-10px tracking-widest text-white/40 uppercase mb-2">
                          Reputation Score
                        </p>
                        <div className="font-orbitron text-4xl font-900 text-white">
                          {(tier.stars * 0.15).toFixed(0)}
                        </div>
                      </div>

                      {/* Badges */}
                      <div className="mt-6 grid grid-cols-4 gap-2">
                        {[...Array(4)].map((_, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{
                              delay: (TIMING.statsUpdate + i * 100) / 1000,
                              duration: 0.4,
                            }}
                            className="aspect-square rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"
                          >
                            <div className={`w-6 h-6 rounded bg-gradient-to-br ${tier.color}`} />
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Tier Selector */}
              <div className="w-full">
                <p className="text-xs font-orbitron tracking-widest text-white/40 uppercase mb-4">Select Tier</p>
                <div className="grid grid-cols-5 gap-2">
                  {TIERS.map((t, idx) => (
                    <motion.button
                      key={t.name}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: (TIMING.buttonStagger + idx * TIMING.buttonStaggerOffset) / 1000,
                        duration: 0.4,
                      }}
                      onClick={() => setSelectedTier(idx)}
                      className={`py-2 px-2 rounded-lg font-orbitron text-xs font-700 tracking-wide transition-all text-center ${
                        idx === selectedTier
                          ? `bg-gradient-to-r ${t.color} text-black shadow-lg`
                          : 'bg-white/5 border border-white/10 text-white/50 hover:text-white hover:border-white/20'
                      }`}
                    >
                      {t.name.slice(0, 3)}
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <motion.section
        className="relative z-10 py-16 px-8 text-center border-t border-white/10"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
      >
        <p className="text-white/60 mb-6">Ready to build your celestial card?</p>
        <a
          href="/app"
          className="inline-block px-10 py-3 bg-gradient-to-r from-cyan-400 to-purple-500 text-black font-700 rounded-lg hover:scale-105 transition-transform"
        >
          Launch App & Start Playing
        </a>
      </motion.section>
    </div>
  );
}
