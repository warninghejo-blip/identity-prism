import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, CircleCheck, Flame, Gamepad2, ShieldCheck, Sparkles, Trophy, Wallet, Zap, type LucideIcon } from 'lucide-react';
import { motion, useMotionValue, useTransform, animate, useScroll, useSpring } from 'framer-motion';
import SiteHeader from '@/components/SiteHeader';
import WebIdentityDemoCard from '@/components/WebIdentityDemoCard';
import type { PlanetTier } from '@/hooks/useWalletData';
import { useGlobalStats } from '@/hooks/useGlobalStats';
import { TIER_HEX, TIER_LABELS } from '@/lib/constants/tierColors';
import './landing.css';

const sections = [
  ['hero', 'Hero'],
  ['network-live', 'Network'],
  ['problem', 'Problem'],
  ['solution', 'Solution'],
  ['sybil-catch', 'Tracks'],
  ['badges', 'Badges'],
  ['tiers', 'Tiers'],
  ['games', 'Games'],
  ['ranks', 'Ranks'],
  ['explode', 'Finale'],
  ['cta', 'CTA'],
  ['footer', 'Footer'],
] as const;

const tiers: PlanetTier[] = ['mercury', 'mars', 'venus', 'earth', 'neptune', 'uranus', 'saturn', 'jupiter', 'sun', 'binary_sun'];

const badges = [
  ['verified_human.png', 'Verified Human', 'Trust signal'],
  ['clean_record.png', 'Clean Record', 'Low risk'],
  ['trust_pillar.png', 'Trust Pillar', 'Reputation'],
  ['veteran.png', 'Veteran', 'Wallet age'],
  ['defi_architect.png', 'DeFi Architect', 'Protocol use'],
  ['game_master.png', 'Game Master', 'Skill proof'],
  ['achievement_hunter.png', 'Achievement Hunter', 'Progression'],
  ['arena_champion.png', 'Arena Champion', 'PvP wins'],
  ['quest_hunter.png', 'Quest Hunter', 'Daily proof'],
  ['streak_lord.png', 'Streak Lord', 'Consistency'],
  ['seeker.png', 'Seeker', 'Device proof'],
  ['binary.png', 'Binary Sun', 'Top tier'],
] as const;

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="landing-divider" aria-hidden="true">
      <span>{label}</span>
    </div>
  );
}

function SectionHead({ eyebrow, title, copy, tone = 'prism' }: { eyebrow: string; title: string; copy: string; tone?: 'prism' | 'red' | 'green' | 'gold' }) {
  return (
    <div className="landing-section-head reveal">
      <span className={`landing-eyebrow ${tone}`}>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

function formatStat(value: number) {
  return new Intl.NumberFormat('en-US', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function PrimaryStatTile({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  color: 'cyan' | 'violet' | 'red';
}) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (latest) => Math.round(latest).toLocaleString());
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.2, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [mv, value]);
  return (
    <motion.div
      className={`primary-stat-tile ${color}`}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="primary-stat-glow" aria-hidden="true" />
      <div className="primary-stat-head">
        <span className="primary-stat-icon" aria-hidden="true">
          <Icon size={20} strokeWidth={1.8} />
        </span>
        <span className="primary-stat-live">
          <i />LIVE
        </span>
      </div>
      <motion.b className="primary-stat-value">{display}</motion.b>
      <span className="primary-stat-label">{label}</span>
    </motion.div>
  );
}

function StatTile({ label, value, color }: { label: string; value: number; color: 'cyan' | 'violet' | 'red' | 'orange' }) {
  return (
    <motion.div
      className={`live-stat-tile ${color}`}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.b
        key={value}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
      >
        {formatStat(value)}
      </motion.b>
      <span>{label}</span>
    </motion.div>
  );
}

function LiveClusterGraph() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let raf = 0;
    let flashIndex = 4;
    let flashUntil = 0;
    let lastFlash = 0;
    const nodes = Array.from({ length: 30 }, (_, index) => {
      const sybil = index < 16;
      const cx = sybil ? 0.34 : 0.68;
      const cy = sybil ? 0.54 : 0.42;
      return {
        sybil,
        x: cx + (Math.random() - 0.5) * 0.28,
        y: cy + (Math.random() - 0.5) * 0.34,
        vx: (Math.random() - 0.5) * 0.006,
        vy: (Math.random() - 0.5) * 0.006,
        r: 4 + Math.random() * 4,
      };
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (time - lastFlash > 4000) {
        flashIndex = Math.floor(Math.random() * nodes.length);
        flashUntil = time + 600;
        lastFlash = time;
      }

      ctx.clearRect(0, 0, width, height);
      const gradient = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, width * 0.8);
      gradient.addColorStop(0, 'rgba(34,211,238,.10)');
      gradient.addColorStop(1, 'rgba(2,6,23,.16)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      nodes.forEach((node) => {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0.06 || node.x > 0.94) node.vx *= -1;
        if (node.y < 0.12 || node.y > 0.9) node.vy *= -1;
      });

      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const ax = a.x * width;
          const ay = a.y * height;
          const bx = b.x * width;
          const by = b.y * height;
          const distance = Math.hypot(ax - bx, ay - by);
          if (distance <= 80) {
            ctx.strokeStyle = a.sybil === b.sybil ? 'rgba(255,255,255,.20)' : 'rgba(34,211,238,.12)';
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          }
        }
      }

      nodes.forEach((node, index) => {
        const x = node.x * width;
        const y = node.y * height;
        const isTarget = index === 2;
        const isFlash = index === flashIndex && time < flashUntil;
        const pulse = 1 + Math.sin(time / 160) * 0.22;
        ctx.shadowBlur = isTarget || isFlash ? 28 : 12;
        ctx.shadowColor = isFlash ? '#ef4444' : node.sybil ? '#f87171' : '#22d3ee';
        ctx.fillStyle = isFlash ? '#ef4444' : node.sybil ? '#f87171' : '#22d3ee';
        ctx.globalAlpha = isFlash ? 1 : 0.82;
        ctx.beginPath();
        ctx.arc(x, y, node.r * (isTarget ? pulse : 1), 0, Math.PI * 2);
        ctx.fill();
        if (isTarget || isFlash) {
          ctx.globalAlpha = 0.24;
          ctx.beginPath();
          ctx.arc(x, y, node.r * 3.2 * pulse, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      frame += 1;
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      void frame;
    };
  }, []);

  return (
    <div className="sybil-stage reveal">
      <canvas ref={canvasRef} className="sybil-canvas" aria-label="Animated live cluster graph" />
      <span>LIVE CLUSTER GRAPH</span>
    </div>
  );
}

// Magnetic CTA — cursor pulls the button toward itself within ~60px radius.
// Falls back to a plain Link if reduced-motion is requested.
function MagneticLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const reduce = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <Link
      to={to}
      ref={ref}
      className={className}
      onPointerMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const x = e.clientX - (r.left + r.width / 2);
        const y = e.clientY - (r.top + r.height / 2);
        setOffset({ x: x * 0.22, y: y * 0.22 });
      }}
      onPointerLeave={() => setOffset({ x: 0, y: 0 })}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        transition: 'transform 0.32s cubic-bezier(.16,1,.3,1)',
      }}
    >
      {children}
    </Link>
  );
}

// Fixed gradient scroll-progress bar across the very top of the viewport.
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });
  return <motion.div className="scroll-progress" style={{ scaleX }} aria-hidden="true" />;
}

// Subtle cursor-following radial glow that gives the page a "live" feel
// without being intrusive. Stays behind content.
function CursorGlow() {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 80, damping: 24 });
  const sy = useSpring(my, { stiffness: 80, damping: 24 });
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const onMove = (e: PointerEvent) => {
      mx.set(e.clientX);
      my.set(e.clientY);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [mx, my]);
  return (
    <motion.div
      className="cursor-glow"
      style={{
        x: useTransform(sx, (v) => v - 240),
        y: useTransform(sy, (v) => v - 240),
      }}
      aria-hidden="true"
    />
  );
}

// Lenis smooth scroll — gives the page a cinematic ease on every wheel tick.
// Scoped to the landing route only so BlackHole / Sybil / Identity custom
// scroll containers aren't affected.
function useLenisSmoothScroll() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let rafId: number | null = null;
    let lenisRef: { destroy: () => void; raf: (t: number) => void } | null = null;
    void (async () => {
      try {
        const mod = await import('lenis');
        if (cancelled) return;
        const Lenis = (mod.default || (mod as unknown as { Lenis: typeof mod.default }).Lenis) as new (opts?: object) => {
          destroy: () => void; raf: (t: number) => void;
        };
        lenisRef = new Lenis({
          duration: 1.15,
          easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          smoothWheel: true,
          wheelMultiplier: 0.95,
          touchMultiplier: 1.2,
        });
        const loop = (time: number) => {
          lenisRef?.raf(time);
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      } catch (error) {
        console.warn('[lenis] init failed, falling back to native scroll', error);
      }
    })();
    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      lenisRef?.destroy();
    };
  }, []);
}

function useLandingScrollReveals() {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('.landing-page .reveal, .landing-page .reveal-stagger'));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      targets.forEach((target) => target.classList.add('in'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -10% 0px' },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);
}

export default function LandingPage() {
  useLandingScrollReveals();
  useLenisSmoothScroll();
  const stats = useGlobalStats(15_000);
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const statsUpdatedAt = stats?.updatedAt
    ? new Date(stats.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'syncing';
  const heroStats = [
    [stats?.idsMinted ?? 0, 'Identities'],
    [stats?.walletsScanned ?? 0, 'Wallets Scanned'],
    [stats?.sybilsCaught ?? 0, 'Sybils Caught'],
  ] as const;

  // Hero parallax — title block drifts up, demo card drifts down, slight
  // opacity fade as the hero exits. Both driven by viewport scroll progress.
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: heroScroll } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const heroTextY = useTransform(heroScroll, [0, 1], ['0%', '-30%']);
  const heroCardY = useTransform(heroScroll, [0, 1], ['0%', '15%']);
  const heroOpacity = useTransform(heroScroll, [0, 0.8], [1, 0.4]);
  const heroBlur = useTransform(heroScroll, [0, 1], ['blur(0px)', 'blur(4px)']);

  return (
    <div className="landing-page">
      <div className="landing-stars" aria-hidden="true" />
      <SiteHeader />

      <ScrollProgress />
      <CursorGlow />

      <aside className="scroll-rail" aria-label="Section progress">
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => scrollTo(id)}
            aria-label={`Go to ${label}`}
          >{label}</button>
        ))}
      </aside>

      <main>
        <section ref={heroRef} className="section hero-section" data-section-id="hero" id="hero">
          <div className="landing-container hero-grid">
            <motion.div className="reveal" style={{ y: heroTextY, opacity: heroOpacity, filter: heroBlur }}>
              <span className="landing-eyebrow">Solana reputation layer</span>
              <h1><span>Sybil-resistant</span><span>identity for real users.</span></h1>
              <p>Identity Prism turns wallet history, gameplay, cleanup, badges, and community review into a readable reputation card.</p>
              <div className="hero-actions">
                <MagneticLink to="/identity" className="landing-btn primary">Open Identity Hub <ArrowRight aria-hidden="true" /></MagneticLink>
                <button type="button" className="landing-btn ghost" onClick={() => scrollTo('solution')}>See System</button>
              </div>
              <div className="hero-stats reveal-stagger">
                {heroStats.map(([value, label]) => (
                  <div key={label}>
                    <b>{formatStat(value)}</b>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </motion.div>
            <motion.div className="hero-card-preview reveal" style={{ y: heroCardY, opacity: heroOpacity }}>
              <WebIdentityDemoCard />
            </motion.div>
          </div>
        </section>

        <SectionDivider label="Network Live" />
        <section className="section landing-section live-stats-section" data-section-id="network-live" id="network-live">
          <div className="landing-container">
            <SectionHead
              eyebrow="Network Live"
              tone="green"
              title="The protocol pulse is public."
              copy="Identity mints, wallet scans, sybil verdicts, reports, and clusters — all updating live from the backend."
            />
            <p className="live-stats-updated reveal" aria-live="polite">Fresh backend sync: {statsUpdatedAt}</p>
            <div className="live-stats-primary reveal-stagger">
              <PrimaryStatTile icon={BadgeCheck} label="Identities Minted" value={stats?.idsMinted ?? 0} color="cyan" />
              <PrimaryStatTile icon={Wallet} label="Wallets Scanned" value={stats?.walletsScanned ?? 0} color="violet" />
              <PrimaryStatTile icon={ShieldCheck} label="Sybils Caught" value={stats?.sybilsCaught ?? 0} color="red" />
            </div>
            <div className="live-stats-secondary reveal-stagger">
              <StatTile label="Reports Verified" value={stats?.sybilsReported ?? 0} color="cyan" />
              <StatTile label="Clusters Mapped" value={stats?.clusters ?? 0} color="violet" />
            </div>
          </div>
        </section>

        <SectionDivider label="The Problem" />
        <section className="section landing-section problem-section" data-section-id="problem" id="problem">
          <div className="landing-container split-grid">
            <div className="reveal">
              <span className="landing-eyebrow red">Sybil pressure</span>
              <h2>Wallets are cheap. Trust is expensive.</h2>
              <p>Public campaigns, airdrops, quests, and communities need better signals than token balance. Identity Prism compresses hard-to-fake behavior into a score people can inspect.</p>
              <div className="problem-list reveal-stagger">
                {[
                  [Flame, 'Airdrop farms mimic humans', 'Clusters reuse funding, timing, and routing patterns.'],
                  [Wallet, 'Wallets have no context', 'Useful users look identical to fresh spam accounts.'],
                  [ShieldCheck, 'Manual review does not scale', 'Communities need explainable flags and correction loops.'],
                ].map(([Icon, title, copy]) => <div className="glass-card" key={String(title)}><Icon aria-hidden="true" /><b>{title as string}</b><span>{copy as string}</span></div>)}
              </div>
            </div>
            <LiveClusterGraph />
          </div>
        </section>

        <SectionDivider label="Wallet To Identity" />
        <section className="section landing-section solution-section" data-section-id="solution" id="solution">
          <div className="landing-container">
            <SectionHead eyebrow="Solution" tone="green" title="A wallet becomes an identity when evidence compounds." copy="On-chain history, human gameplay, cleanup behavior, social review, and achievements flow into one composite score." />
            <div className="flow-grid reveal-stagger">
              {['Wallet', 'Signals', 'Score', 'Tier', 'Identity'].map((item, index) => (
                <div className="flow-node" key={item}><span>{index + 1}</span><b>{item}</b><i /></div>
              ))}
            </div>
          </div>
        </section>

        <SectionDivider label="Bad Track / Good Track" />
        <section className="section landing-section sybil-catch-section" data-section-id="sybil-catch" id="sybil-catch">
          <div className="landing-container">
            <SectionHead eyebrow="Sybil Catch" tone="gold" title="Two tracks. One reputation outcome." copy="Bad behavior gets isolated. Organic users can clear ambiguity through proof instead of waiting on manual moderation." />
            <div className="track-grid">
              <div className="track-card bad reveal"><h3>Bad Track</h3>{['Shared funding source', 'Script-like timing', 'Dust fan-out', 'Cluster similarity'].map((x) => <p key={x}><Flame aria-hidden="true" />{x}</p>)}</div>
              <div className="track-card good reveal"><h3>Good Track</h3>{['Gameplay history', 'Clean wallet age', 'Human verification', 'Community corrections'].map((x) => <p key={x}><CircleCheck aria-hidden="true" />{x}</p>)}</div>
            </div>
          </div>
        </section>

        <SectionDivider label="Achievements" />
        <section className="section landing-section badges-section" data-section-id="badges" id="badges">
          <div className="landing-container">
            <SectionHead eyebrow="Badges" title="Achievements users can actually inspect." copy="Badges are visible proof units: wallet history, cleanup, games, social review, and device ownership." />
            <div className="badges-grid reveal-stagger">{badges.map(([src, label, copy]) => <div className="badge-card glass-card" key={src}><img src={`/landing/badges/${src}`} alt={label} /><b>{label}</b><span>{copy}</span></div>)}</div>
          </div>
        </section>

        <SectionDivider label="Composite Tiers" />
        <section className="section landing-section tiers-section" data-section-id="tiers" id="tiers">
          <div className="landing-container">
            <SectionHead eyebrow="Tiers" tone="gold" title="Ten planets from Mercury to Binary Sun." copy="Each score band maps to a planet tier, making reputation scannable without hiding the underlying stats." />
            <div className="tiers-grid reveal-stagger">
              {tiers.map((tier, index) => <div className="tier-card glass-card" key={tier} style={{ '--tier': TIER_HEX[tier] } as React.CSSProperties}><img src={`/landing/textures/tiers/${tier}.png`} alt={`${TIER_LABELS[tier]} tier`} /><b>{TIER_LABELS[tier]}</b><span>{index * 100}-{index === 9 ? '1000' : index * 100 + 99}</span></div>)}
            </div>
          </div>
        </section>

        <SectionDivider label="Games" />
        <section className="section landing-section games-section" data-section-id="games" id="games">
          <div className="landing-container">
            <SectionHead eyebrow="Prism League" title="Skill is proof that bots struggle to fake." copy="Games, arena matches, and quests become human-proof signals that feed Ranger XP and identity reputation." />
            <div className="games-grid reveal-stagger">
              {[
                ['Prism League', 'Orbit survival, gravity runs, and session scores.', Gamepad2],
                ['Arena', 'Wallet-vs-wallet brackets with seasonal standings.', Trophy],
                ['Quests', 'Daily and weekly missions that build proof over time.', Zap],
              ].map(([title, copy, Icon]) => <div className="game-card glass-card" key={String(title)}><Icon aria-hidden="true" /><b>{title as string}</b><p>{copy as string}</p></div>)}
            </div>
          </div>
        </section>

        <SectionDivider label="Ranks" />
        <section className="section landing-section ranks-section" data-section-id="ranks" id="ranks">
          <div className="landing-container">
            <SectionHead eyebrow="Ranger Ranks" tone="green" title="A second progression track for play." copy="Composite tier measures wallet reputation. Ranger Rank measures XP earned through games, quests, achievements, and community actions." />
            <div className="rank-table glass-card reveal">
              {['Cadet', 'Pilot', 'Captain', 'Ace', 'Legend'].map((r, i) => <div key={r}><span>{r}</span><b>{[0, 1500, 8000, 25000, 50000][i].toLocaleString('en-US')} XP</b><em>{['Base gear', 'Text quests', 'Yellow slots', 'Red slots', 'All systems'][i]}</em></div>)}
            </div>
          </div>
        </section>

        <SectionDivider label="Finale" />
        <section className="section landing-section explode-section" data-section-id="explode" id="explode">
          <div className="landing-container">
            <SectionHead eyebrow="Planet Explode" title="Every identity can be rebuilt from fresh proof." copy="Risk collapses, shards fly, and a stronger planet reforms from updated evidence." />
            <div className="explode-stage reveal">
              <div className="explode-planet"><img src="/landing/textures/tiers/sun.png" alt="Exploding planet finale" /></div>
              {Array.from({ length: 14 }, (_, i) => <span key={i} className="shard" style={{ '--i': i } as React.CSSProperties} />)}
            </div>
          </div>
        </section>

        <section className="section landing-section cta-section" data-section-id="cta" id="cta">
          <div className="landing-container cta-panel">
            <Sparkles aria-hidden="true" />
            <h2>Ready to claim your identity?</h2>
            <p>Open the hub, connect your wallet, inspect your score bars, and start building proof.</p>
            <div className="hero-actions">
              <Link to="/identity" className="landing-btn primary">Open Identity Hub</Link>
              <Link to="/sybil-check" className="landing-btn ghost">Open Sybil Checker</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="section landing-footer" data-section-id="footer" id="footer">
        <div className="landing-container footer-grid">
          <div><img src="/phav.png" alt="" /><b>IDENTITY PRISM</b><p>Sybil-resistant identity for Solana wallets, games, cleanup, and community reputation.</p></div>
          <nav aria-label="Footer links"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="mailto:hello@identityprism.xyz">hello@identityprism.xyz</a></nav>
        </div>
      </footer>
    </div>
  );
}
