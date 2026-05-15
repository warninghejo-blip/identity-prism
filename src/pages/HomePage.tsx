import { useRef, useEffect, useState, useMemo } from 'react';
import { fadeOutTransition } from '@/lib/fadeTransition';
import { useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform, useSpring, useInView } from 'framer-motion';

/* ═══════════════════════════════════════════════════
   Planet textures — same as CelestialCard / Planet3D
   ═══════════════════════════════════════════════════ */

const PLANETS = [
  {
    tier: 'mercury',
    label: 'Mercury',
    icon: '/textures/tiers/mercury.png',
    color: '#b4a995',
    desc: 'Newborn traveler',
  },
  { tier: 'mars', label: 'Mars', icon: '/textures/tiers/mars.png', color: '#ff6b4a', desc: 'First footsteps' },
  { tier: 'venus', label: 'Venus', icon: '/textures/tiers/venus.png', color: '#ffd166', desc: 'Growing presence' },
  { tier: 'earth', label: 'Earth', icon: '/textures/tiers/earth.png', color: '#5fa8ff', desc: 'Established identity' },
  { tier: 'neptune', label: 'Neptune', icon: '/textures/tiers/neptune.png', color: '#4cc9f0', desc: 'Deep explorer' },
  { tier: 'uranus', label: 'Uranus', icon: '/textures/tiers/uranus.png', color: '#80edff', desc: 'Ice giant' },
  { tier: 'saturn', label: 'Saturn', icon: '/textures/tiers/saturn.png', color: '#fcbf49', desc: 'Ringed royalty' },
  { tier: 'jupiter', label: 'Jupiter', icon: '/textures/tiers/jupiter.png', color: '#f4a261', desc: 'Gas colossus' },
  { tier: 'sun', label: 'Sun', icon: '/textures/tiers/sun.png', color: '#ffdd99', desc: 'Stellar power' },
  {
    tier: 'binary_sun',
    label: 'Binary Sun',
    icon: '/textures/tiers/binary_sun.png',
    color: '#fffbe6',
    desc: 'Twin star transcendence',
  },
];

const FEATURES = [
  {
    icon: '/hub/scanner.png',
    title: 'On-Chain Identity',
    desc: 'Your wallet activity distilled into a single score — transactions, age, holdings, and more.',
  },
  {
    icon: '/textures/tiers/sun.png',
    title: 'Planet Tier System',
    desc: '9 tiers from Mercury to Sun. Each tier unlocks a unique 3D planet on your card.',
  },
  {
    icon: '/badges/achievement_hunter.png',
    title: 'Achievement Badges',
    desc: 'OG, Whale, Collector, Tx Titan — earn badges based on your on-chain behavior.',
  },
  {
    icon: '/hub/league.png',
    title: 'Prism League',
    desc: 'Play Orbit Survival or Cosmic Defender. Earn coins, climb leaderboards.',
  },
  {
    icon: '/hub/blackhole.png',
    title: 'Black Hole',
    desc: 'Burn dust tokens and abandoned NFTs. Reclaim locked SOL rent from your wallet.',
  },
  {
    icon: '/hub/vault.png',
    title: 'Mint as NFT',
    desc: 'Mint your Identity Prism as a Metaplex Core NFT — your on-chain passport.',
  },
];

/* ═══════════════════════════════════════════════════
   Animated components
   ═══════════════════════════════════════════════════ */

function FadeInSection({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function StarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const resize = () => {
      c.width = window.innerWidth * dpr;
      c.height = window.innerHeight * 3 * dpr;
      c.style.width = '100%';
      c.style.height = '300vh';
      draw();
    };
    const stars: { x: number; y: number; r: number; a: number }[] = [];
    for (let i = 0; i < 400; i++) {
      stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.5 + 0.3, a: Math.random() * 0.6 + 0.2 });
    }
    function draw() {
      if (!ctx || !c) return;
      ctx.clearRect(0, 0, c.width, c.height);
      for (const s of stars) {
        ctx.beginPath();
        ctx.arc(s.x * c.width, s.y * c.height, s.r * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.a})`;
        ctx.fill();
      }
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full pointer-events-none" style={{ height: '300vh' }} />;
}

/* ═══════════════════════════════════════════════════
   Main Home Page
   ═══════════════════════════════════════════════════ */

export default function HomePage() {
  const navigate = useNavigate();
  useEffect(() => {
    fadeOutTransition();
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });

  // Parallax transforms
  const shipY = useTransform(scrollYProgress, [0, 0.3], [0, -200]);
  const shipX = useTransform(scrollYProgress, [0, 0.15, 0.3, 0.5], [0, 80, -60, 0]);
  const shipRotate = useTransform(scrollYProgress, [0, 0.15, 0.3], [0, 8, -4]);
  const shipScale = useTransform(scrollYProgress, [0, 0.15, 0.4], [1, 1.1, 0.85]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);

  const bhScale = useTransform(scrollYProgress, [0.55, 0.75], [0.6, 1.15]);
  const bhOpacity = useTransform(scrollYProgress, [0.5, 0.6], [0, 1]);
  const bhRotate = useTransform(scrollYProgress, [0.55, 1], [0, 180]);
  const smoothBhScale = useSpring(bhScale, { stiffness: 80, damping: 20 });

  return (
    <div
      ref={containerRef}
      className="relative bg-[#050508] text-white overflow-x-hidden"
      style={{ minHeight: '400vh' }}
    >
      {/* Stars background */}
      <div className="fixed inset-0 z-0">
        <StarCanvas />
      </div>

      {/* ═══ HERO ═══ */}
      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4">
        <motion.div style={{ opacity: heroOpacity }} className="text-center">
          <motion.h1
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter leading-none mb-4"
          >
            <span className="bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              Identity
            </span>
            <br />
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-orange-300 bg-clip-text text-transparent">
              Prism
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="text-white/40 text-sm md:text-lg tracking-widest uppercase max-w-md mx-auto mb-10"
          >
            Your Solana wallet, crystallized into a living celestial identity
          </motion.p>
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.6 }}
            onClick={() => navigate('/app')}
            className="px-8 py-3.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-base tracking-wide hover:from-cyan-400 hover:to-blue-500 transition-all shadow-[0_0_30px_rgba(34,211,238,0.25)] hover:shadow-[0_0_40px_rgba(34,211,238,0.4)] hover:scale-105 active:scale-95"
          >
            Launch App
          </motion.button>
        </motion.div>

        {/* Flying ship */}
        <motion.div
          style={{ y: shipY, x: shipX, rotate: shipRotate, scale: shipScale }}
          className="absolute z-20 pointer-events-none"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 0.8 }}
        >
          <div className="relative w-16 h-24 md:w-20 md:h-28">
            <img
              src="/textures/ships/ship_default.png"
              alt="Ship"
              className="w-full h-full object-contain drop-shadow-[0_0_12px_rgba(34,211,238,0.5)]"
            />
          </div>
        </motion.div>

        {/* Scroll hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <span className="text-white/20 text-[10px] uppercase tracking-[0.3em]">Scroll to explore</span>
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
            className="w-5 h-8 rounded-full border border-white/15 flex items-start justify-center pt-1.5"
          >
            <div className="w-1 h-2 bg-white/30 rounded-full" />
          </motion.div>
        </motion.div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section className="relative z-10 py-32 px-4 max-w-5xl mx-auto">
        <FadeInSection className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
            <span className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
              What is Identity Prism?
            </span>
          </h2>
          <p className="text-white/30 text-sm md:text-base max-w-lg mx-auto">
            A comprehensive on-chain identity system that transforms your Solana wallet data into a visual cosmic card.
          </p>
        </FadeInSection>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <FadeInSection key={f.title} delay={i * 0.08}>
              <div className="group p-6 rounded-2xl border border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.08] transition-all duration-300">
                <img
                  src={f.icon}
                  alt=""
                  className="w-10 h-10 mb-3 object-contain drop-shadow-[0_0_12px_rgba(34,211,238,0.35)]"
                  loading="lazy"
                />
                <h3 className="text-base font-bold text-white/90 mb-1.5 tracking-tight">{f.title}</h3>
                <p className="text-sm text-white/30 leading-relaxed">{f.desc}</p>
              </div>
            </FadeInSection>
          ))}
        </div>
      </section>

      {/* ═══ PLANET TIERS (scrollytelling) ═══ */}
      <section className="relative z-10 py-32 px-4">
        <FadeInSection className="text-center mb-20">
          <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
            <span className="bg-gradient-to-r from-amber-200 via-orange-300 to-red-400 bg-clip-text text-transparent">
              10 Celestial Tiers
            </span>
          </h2>
          <p className="text-white/30 text-sm md:text-base max-w-lg mx-auto">
            Your Identity Score determines your planet tier. Each uses real NASA-quality textures.
          </p>
        </FadeInSection>

        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap justify-center gap-6 md:gap-8">
            {PLANETS.map((p, i) => (
              <FadeInSection key={p.tier} delay={i * 0.06} className="flex flex-col items-center group">
                <div
                  className="relative w-20 h-20 md:w-28 md:h-28 transition-all duration-500 group-hover:scale-110"
                  style={{ filter: `drop-shadow(0 0 12px ${p.color}40)` }}
                >
                  <img
                    src={p.icon}
                    alt={p.label}
                    className="w-full h-full object-contain transition-all duration-500 group-hover:brightness-110"
                    loading="lazy"
                  />
                </div>
                <span
                  className="mt-2.5 text-[10px] md:text-xs font-bold uppercase tracking-widest"
                  style={{ color: p.color }}
                >
                  {p.label}
                </span>
                <span className="text-[9px] text-white/20 mt-0.5">{p.desc}</span>
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ BLACK HOLE SECTION ═══ */}
      <section className="relative z-10 py-32 flex flex-col items-center justify-center min-h-[80vh]">
        <FadeInSection className="text-center mb-10">
          <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
            <span className="bg-gradient-to-r from-orange-400 via-red-500 to-red-700 bg-clip-text text-transparent">
              The Black Hole
            </span>
          </h2>
          <p className="text-white/30 text-sm md:text-base max-w-md mx-auto">
            Feed dust tokens to the void. Reclaim locked SOL from abandoned accounts.
          </p>
        </FadeInSection>

        <motion.div
          style={{ scale: smoothBhScale, opacity: bhOpacity, rotate: bhRotate }}
          className="relative w-56 h-56 md:w-80 md:h-80 flex items-center justify-center cursor-pointer"
          onClick={() => navigate('/blackhole')}
          whileHover={{ scale: 1.08 }}
        >
          {/* Outer glow */}
          <div className="absolute w-full h-full rounded-full bg-gradient-radial from-orange-600/20 via-red-900/10 to-transparent blur-2xl animate-pulse" />
          {/* Accretion disk */}
          <div
            className="absolute w-[110%] h-[110%] rounded-full opacity-70"
            style={{
              background:
                'conic-gradient(from 0deg, transparent, rgba(255,140,60,0.4) 80deg, rgba(255,80,20,0.5) 160deg, rgba(255,160,100,0.3) 240deg, transparent 320deg)',
              filter: 'blur(8px)',
              animation: 'spin 20s linear infinite',
            }}
          />
          {/* Ring */}
          <div
            className="absolute w-[90%] h-[35%] rounded-full border border-orange-400/30"
            style={{
              boxShadow: '0 0 30px rgba(255,100,40,0.2), inset 0 0 15px rgba(255,100,40,0.1)',
              transform: 'rotateX(75deg)',
            }}
          />
          {/* Core */}
          <div
            className="relative w-[45%] h-[45%] rounded-full bg-gradient-radial from-black via-black to-black/80 z-10"
            style={{
              boxShadow: '0 0 40px 15px rgba(0,0,0,0.95), 0 0 80px 30px rgba(0,0,0,0.6)',
            }}
          />
          {/* Event horizon glow */}
          <div
            className="absolute w-[50%] h-[50%] rounded-full border border-orange-500/20 z-5"
            style={{
              boxShadow: '0 0 20px rgba(255,120,60,0.15)',
            }}
          />
        </motion.div>

        <motion.p
          style={{ opacity: bhOpacity }}
          className="mt-8 text-orange-300/60 text-xs uppercase tracking-[0.3em] font-bold"
        >
          Click to enter the void
        </motion.p>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="relative z-10 py-32 px-4 flex flex-col items-center text-center">
        <FadeInSection>
          <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-6">
            <span className="bg-gradient-to-r from-cyan-300 to-purple-400 bg-clip-text text-transparent">
              Ready to discover your identity?
            </span>
          </h2>
          <p className="text-white/30 text-sm md:text-base max-w-md mx-auto mb-10">
            Connect your wallet, see your score, mint your card, and join the cosmos.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => navigate('/app')}
              className="px-10 py-4 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-lg tracking-wide hover:from-cyan-400 hover:to-blue-500 transition-all shadow-[0_0_30px_rgba(34,211,238,0.2)] hover:shadow-[0_0_50px_rgba(34,211,238,0.35)] hover:scale-105 active:scale-95"
            >
              Launch App
            </button>
            <button
              onClick={() => navigate('/game')}
              className="px-10 py-4 rounded-full border border-white/10 text-white/70 font-bold text-lg tracking-wide hover:bg-white/5 hover:text-white transition-all hover:scale-105 active:scale-95"
            >
              Play Prism League
            </button>
          </div>
        </FadeInSection>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.04] py-8 px-4 text-center">
        <p className="text-white/15 text-xs tracking-wider">
          Identity Prism &middot; Built on Solana &middot; Powered by Helius
        </p>
      </footer>

      {/* spin keyframe for black hole disk */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .bg-gradient-radial { background: radial-gradient(circle, var(--tw-gradient-stops)); }
      `}</style>
    </div>
  );
}
