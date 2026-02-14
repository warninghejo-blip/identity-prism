import { useRef, useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useScroll, useTransform, useInView, useSpring } from "framer-motion";
import "./Homepage.css";

/* ───────────────────────── helpers ───────────────────────── */

const FEATURES = [
  {
    title: "Cosmic Identity Card",
    desc: "Your wallet isn't just an address — it's a living, breathing identity. We scan your entire on-chain footprint and forge it into a stunning 3D card with a unique planet that evolves with you.",
    icon: "planet",
  },
  {
    title: "Reputation Scoring",
    desc: "From 0 to 1,200 points. Wallet age, transaction volume, DeFi positions, NFT holdings, token diversity — every on-chain action shapes your score and determines your cosmic tier.",
    icon: "score",
  },
  {
    title: "Planet Tier System",
    desc: "10 unique planet tiers from Mercury to Binary Sun. Each tier unlocks at a higher reputation score, with unique 3D textures, atmospheres, and visual effects.",
    icon: "tiers",
  },
  {
    title: "Achievement Badges",
    desc: "Earn badges like Diamond Hands, Meme Lord, DeFi King, Whale, and more. Each badge reflects a real on-chain behavior pattern — no fake flex.",
    icon: "badges",
  },
  {
    title: "Black Hole",
    desc: "Feed unwanted tokens to the void. Our Black Hole feature lets you burn dust tokens and reclaim your locked rent SOL — turning trash into treasure.",
    icon: "blackhole",
  },
  {
    title: "Mint as NFT",
    desc: "Lock your identity in time. Mint your card as a compressed NFT on Solana — a permanent, verifiable snapshot of your on-chain reputation.",
    icon: "mint",
  },
];

const TIERS = [
  { name: "Mercury", score: "0+", color: "#8C7E6A" },
  { name: "Venus", score: "80+", color: "#E8C36A" },
  { name: "Earth", score: "160+", color: "#4A90D9" },
  { name: "Mars", score: "250+", color: "#C1440E" },
  { name: "Jupiter", score: "350+", color: "#C88B3A" },
  { name: "Saturn", score: "450+", color: "#D4A574" },
  { name: "Uranus", score: "550+", color: "#73C2D4" },
  { name: "Neptune", score: "650+", color: "#3366CC" },
  { name: "Sun", score: "800+", color: "#FFB347" },
  { name: "Binary Sun", score: "950+", color: "#FF6B9D" },
];

/* ───────────────── small reusable components ─────────────── */

function StarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf: number;
    const stars: { x: number; y: number; r: number; speed: number; opacity: number }[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 300; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.3,
        speed: Math.random() * 0.3 + 0.05,
        opacity: Math.random() * 0.8 + 0.2,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = Date.now() * 0.001;
      for (const s of stars) {
        const flicker = 0.5 + 0.5 * Math.sin(t * s.speed * 3 + s.x);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.opacity * flicker})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={canvasRef} className="hp-star-canvas" />;
}

function FeatureIcon({ icon }: { icon: string }) {
  const paths: Record<string, JSX.Element> = {
    planet: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="20" stroke="url(#gp)" strokeWidth="2" />
        <ellipse cx="32" cy="32" rx="30" ry="8" stroke="url(#gp)" strokeWidth="1.2" opacity=".5" transform="rotate(-20 32 32)" />
        <defs><linearGradient id="gp" x1="0" y1="0" x2="64" y2="64"><stop stopColor="#6AD9FF" /><stop offset="1" stopColor="#C3A3FF" /></linearGradient></defs>
      </svg>
    ),
    score: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M32 6L38 24H56L42 34L46 52L32 42L18 52L22 34L8 24H26L32 6Z" stroke="url(#gs)" strokeWidth="2" strokeLinejoin="round" />
        <defs><linearGradient id="gs" x1="8" y1="6" x2="56" y2="52"><stop stopColor="#FFD700" /><stop offset="1" stopColor="#FF6B35" /></linearGradient></defs>
      </svg>
    ),
    tiers: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="20" cy="32" r="8" stroke="#4A90D9" strokeWidth="1.5" />
        <circle cx="44" cy="32" r="12" stroke="#FFB347" strokeWidth="1.5" />
        <circle cx="32" cy="18" r="5" stroke="#C1440E" strokeWidth="1.5" />
        <defs />
      </svg>
    ),
    badges: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M32 4L40 20L58 22L44 36L48 54L32 46L16 54L20 36L6 22L24 20L32 4Z" fill="none" stroke="url(#gb)" strokeWidth="2" />
        <circle cx="32" cy="30" r="8" stroke="url(#gb)" strokeWidth="1.5" />
        <defs><linearGradient id="gb" x1="6" y1="4" x2="58" y2="54"><stop stopColor="#00D4FF" /><stop offset="1" stopColor="#7F5BFF" /></linearGradient></defs>
      </svg>
    ),
    blackhole: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="12" fill="url(#gbh)" />
        <circle cx="32" cy="32" r="20" stroke="#7F5BFF" strokeWidth="1" opacity=".6" />
        <circle cx="32" cy="32" r="26" stroke="#C3A3FF" strokeWidth=".6" opacity=".3" />
        <defs><radialGradient id="gbh" cx="32" cy="32" r="12" gradientUnits="userSpaceOnUse"><stop stopColor="#0a0a0a" /><stop offset="1" stopColor="#3b0764" /></radialGradient></defs>
      </svg>
    ),
    mint: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="14" y="10" width="36" height="44" rx="4" stroke="url(#gm)" strokeWidth="2" />
        <circle cx="32" cy="30" r="10" stroke="url(#gm)" strokeWidth="1.5" />
        <line x1="22" y1="46" x2="42" y2="46" stroke="url(#gm)" strokeWidth="1.5" />
        <defs><linearGradient id="gm" x1="14" y1="10" x2="50" y2="54"><stop stopColor="#00D4FF" /><stop offset="1" stopColor="#FFD700" /></linearGradient></defs>
      </svg>
    ),
  };
  return <div className="hp-feature-icon">{paths[icon] ?? null}</div>;
}

/* ───────────────── animated section wrapper ──────────────── */

function Section({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  return (
    <motion.section
      ref={ref}
      id={id}
      className={`hp-section ${className}`}
      initial={{ opacity: 0, y: 60 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {children}
    </motion.section>
  );
}

/* ───────────────── animated planet (CSS-only) ────────────── */

function HeroPlanet() {
  return (
    <div className="hp-hero-planet-wrap">
      <div className="hp-hero-planet">
        <div className="hp-planet-body" />
        <div className="hp-planet-ring" />
        <div className="hp-planet-glow" />
      </div>
    </div>
  );
}

/* ───────────────── black hole animation ──────────────────── */

function BlackHoleVisual() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <div ref={ref} className={`hp-blackhole-visual ${isInView ? "active" : ""}`}>
      <div className="hp-bh-core" />
      <div className="hp-bh-disk hp-bh-disk-1" />
      <div className="hp-bh-disk hp-bh-disk-2" />
      <div className="hp-bh-disk hp-bh-disk-3" />
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="hp-bh-particle"
          style={{
            ["--angle" as string]: `${i * 30}deg`,
            ["--delay" as string]: `${i * 0.15}s`,
            ["--dist" as string]: `${60 + Math.random() * 40}px`,
          }}
        />
      ))}
    </div>
  );
}

/* ────────────── exploding planet animation ───────────────── */

function ExplodingPlanet() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  const fragments = useMemo(
    () =>
      Array.from({ length: 20 }).map((_, i) => ({
        angle: (i / 20) * 360,
        dist: 40 + Math.random() * 80,
        size: 4 + Math.random() * 8,
        delay: Math.random() * 0.4,
        color: ["#6AD9FF", "#C3A3FF", "#FFB347", "#FF6B9D", "#4A90D9"][i % 5],
      })),
    []
  );
  return (
    <div ref={ref} className={`hp-exploding-planet ${isInView ? "active" : ""}`}>
      <div className="hp-ep-core" />
      {fragments.map((f, i) => (
        <div
          key={i}
          className="hp-ep-fragment"
          style={{
            ["--angle" as string]: `${f.angle}deg`,
            ["--dist" as string]: `${f.dist}px`,
            ["--size" as string]: `${f.size}px`,
            ["--delay" as string]: `${f.delay}s`,
            ["--color" as string]: f.color,
          }}
        />
      ))}
      <div className="hp-ep-shockwave" />
    </div>
  );
}

/* ──────────── floating score counter animation ───────────── */

function AnimatedScore() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!isInView) return;
    let frame: number;
    const target = 1200;
    const duration = 2000;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * target));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isInView]);
  return (
    <div ref={ref} className="hp-score-counter">
      <span className="hp-score-number">{count}</span>
      <span className="hp-score-label">/ 1,200</span>
    </div>
  );
}

/* ════════════════════════ MAIN COMPONENT ═════════════════════ */

export default function Homepage() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 50, damping: 20 });
  const heroOpacity = useTransform(smoothProgress, [0, 0.12], [1, 0]);
  const heroScale = useTransform(smoothProgress, [0, 0.12], [1, 0.92]);

  /* dismiss preloader */
  useEffect(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById("app-preloader");
        if (el) {
          el.style.opacity = "0";
          setTimeout(() => el.remove(), 400);
        }
      })
    );
  }, []);

  const launch = () => navigate("/app");

  return (
    <div ref={containerRef} className="hp-root">
      <StarCanvas />

      {/* ── progress bar ── */}
      <motion.div className="hp-progress" style={{ scaleX: smoothProgress }} />

      {/* ═══════════════ HERO ═══════════════ */}
      <motion.div className="hp-hero" style={{ opacity: heroOpacity, scale: heroScale }}>
        <HeroPlanet />
        <div className="hp-hero-content">
          <motion.h1
            className="hp-hero-title"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
          >
            Identity Prism
          </motion.h1>
          <motion.p
            className="hp-hero-subtitle"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.5 }}
          >
            Your wallet has a soul. We reveal it.
          </motion.p>
          <motion.button
            className="hp-cta"
            onClick={launch}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.9 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
          >
            Launch App
          </motion.button>
        </div>
        <motion.div
          className="hp-scroll-hint"
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 13l5 5 5-5M7 6l5 5 5-5" />
          </svg>
        </motion.div>
      </motion.div>

      {/* ═══════════════ WHAT IS IDENTITY PRISM ═══════════════ */}
      <Section className="hp-intro" id="about">
        <div className="hp-intro-grid">
          <div className="hp-intro-text">
            <h2 className="hp-section-title">
              What is <span className="hp-gradient-text">Identity Prism</span>?
            </h2>
            <p className="hp-body-text">
              Identity Prism scans your Solana wallet and transforms raw on-chain data into a
              visual cosmic identity. Your transactions, holdings, NFTs, DeFi positions, and
              wallet age are all distilled into a single reputation score — and brought to life
              as a unique 3D planet orbiting in your personal solar system.
            </p>
            <p className="hp-body-text hp-body-muted">
              No sign-ups. No KYC. Just connect your wallet and discover who you are on-chain.
            </p>
          </div>
          <ExplodingPlanet />
        </div>
      </Section>

      {/* ═══════════════ FEATURES ═══════════════ */}
      <Section className="hp-features" id="features">
        <h2 className="hp-section-title hp-center">Features</h2>
        <div className="hp-features-grid">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              className="hp-feature-card"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <FeatureIcon icon={f.icon} />
              <h3 className="hp-feature-title">{f.title}</h3>
              <p className="hp-feature-desc">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ═══════════════ REPUTATION ═══════════════ */}
      <Section className="hp-reputation" id="score">
        <div className="hp-rep-grid">
          <div>
            <h2 className="hp-section-title">
              On-Chain <span className="hp-gradient-text">Reputation</span>
            </h2>
            <p className="hp-body-text">
              Your score is calculated from real on-chain metrics — not vibes. Wallet age,
              transaction count, SOL balance, token diversity, NFT collections, DeFi positions,
              staking activity, and special bonuses all contribute.
            </p>
            <ul className="hp-rep-list">
              <li><span className="hp-rep-dot" style={{ background: "#FFD700" }} />Wallet age — up to 150 pts</li>
              <li><span className="hp-rep-dot" style={{ background: "#6AD9FF" }} />Transaction volume — up to 100 pts</li>
              <li><span className="hp-rep-dot" style={{ background: "#FF6B35" }} />SOL balance tiers — up to 75 pts</li>
              <li><span className="hp-rep-dot" style={{ background: "#C3A3FF" }} />Blue-chip NFTs — 50 pts each</li>
              <li><span className="hp-rep-dot" style={{ background: "#4ade80" }} />DeFi & Staking — 30+ pts</li>
              <li><span className="hp-rep-dot" style={{ background: "#FF6B9D" }} />Special badges — 50-200 pts</li>
            </ul>
          </div>
          <AnimatedScore />
        </div>
      </Section>

      {/* ═══════════════ PLANET TIERS ═══════════════ */}
      <Section className="hp-tiers" id="tiers">
        <h2 className="hp-section-title hp-center">Planet Tiers</h2>
        <p className="hp-body-text hp-center hp-body-muted" style={{ maxWidth: 600, margin: "0 auto 3rem" }}>
          Your reputation score determines your planet. From the barren surface of Mercury to
          the blazing glory of a Binary Sun — every tier is a milestone.
        </p>
        <div className="hp-tiers-track">
          {TIERS.map((t, i) => (
            <motion.div
              key={t.name}
              className="hp-tier-item"
              initial={{ opacity: 0, scale: 0.7 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.07 }}
            >
              <div
                className="hp-tier-orb"
                style={{
                  background: `radial-gradient(circle at 35% 35%, ${t.color}dd, ${t.color}44 70%, transparent)`,
                  boxShadow: `0 0 20px ${t.color}66, inset 0 0 15px ${t.color}33`,
                  width: 36 + i * 4,
                  height: 36 + i * 4,
                }}
              />
              <span className="hp-tier-name">{t.name}</span>
              <span className="hp-tier-score">{t.score}</span>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ═══════════════ BLACK HOLE ═══════════════ */}
      <Section className="hp-blackhole" id="blackhole">
        <div className="hp-bh-grid">
          <BlackHoleVisual />
          <div>
            <h2 className="hp-section-title">
              The <span className="hp-gradient-text-purple">Black Hole</span>
            </h2>
            <p className="hp-body-text">
              Your wallet is cluttered with dust tokens, failed airdrops, and worthless SPL
              tokens each locking 0.002 SOL in rent. The Black Hole lets you burn them all in
              one sweep — reclaiming your SOL from the void.
            </p>
            <p className="hp-body-text hp-body-muted">
              Select tokens, feed them to the singularity, watch them vanish in a cosmic
              animation, and get your SOL back. It's satisfying and profitable.
            </p>
          </div>
        </div>
      </Section>

      {/* ═══════════════ MINT ═══════════════ */}
      <Section className="hp-mint" id="mint">
        <h2 className="hp-section-title hp-center">
          Mint Your <span className="hp-gradient-text">Identity</span>
        </h2>
        <p className="hp-body-text hp-center" style={{ maxWidth: 560, margin: "0 auto" }}>
          Lock your on-chain reputation as a compressed NFT on Solana. Your identity card,
          planet tier, badges, and score — permanently verifiable on-chain for just 0.01 SOL.
        </p>
        <div className="hp-mint-cards">
          <motion.div
            className="hp-mint-card"
            initial={{ opacity: 0, rotateY: -15 }}
            whileInView={{ opacity: 1, rotateY: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="hp-mc-glow" />
            <div className="hp-mc-content">
              <div className="hp-mc-planet" />
              <span className="hp-mc-label">Your Identity</span>
              <span className="hp-mc-tier">Planet Tier</span>
            </div>
          </motion.div>
        </div>
      </Section>

      {/* ═══════════════ CTA ═══════════════ */}
      <Section className="hp-final-cta">
        <h2 className="hp-section-title hp-center">
          Ready to discover your <span className="hp-gradient-text">cosmic identity</span>?
        </h2>
        <p className="hp-body-text hp-center hp-body-muted" style={{ maxWidth: 480, margin: "0 auto 2rem" }}>
          Connect your Solana wallet and meet your digital twin in seconds.
        </p>
        <motion.button
          className="hp-cta hp-cta-large"
          onClick={launch}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.97 }}
        >
          Launch App
        </motion.button>
      </Section>

      {/* ═══════════════ FOOTER ═══════════════ */}
      <footer className="hp-footer">
        <span className="hp-footer-brand">Identity Prism</span>
        <div className="hp-footer-links">
          <a href="https://x.com/Identity_Prism" target="_blank" rel="noopener noreferrer">
            Twitter
          </a>
          <a href="/app">App</a>
        </div>
        <span className="hp-footer-copy">&copy; {new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}
