import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, CircleCheck, Flame, Gamepad2, ShieldCheck, Sparkles, Trophy, Wallet, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import SiteHeader from '@/components/SiteHeader';
import type { PlanetTier } from '@/hooks/useWalletData';
import { useGlobalStats } from '@/hooks/useGlobalStats';
import { TIER_HEX, TIER_LABELS } from '@/lib/constants/tierColors';
import './landing.css';

const sections = [
  ['hero', 'Hero'],
  ['problem', 'Problem'],
  ['solution', 'Solution'],
  ['sybil-catch', 'Tracks'],
  ['badges', 'Badges'],
  ['tiers', 'Tiers'],
  ['games', 'Games'],
  ['ranks', 'Ranks'],
  ['explode', 'Finale'],
  ['network-live', 'Network'],
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
    <div className="landing-section-head reveal in">
      <span className={`landing-eyebrow ${tone}`}>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

function formatStat(value: number) {
  return new Intl.NumberFormat('en-US', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
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
    <div className="sybil-stage reveal in">
      <canvas ref={canvasRef} className="sybil-canvas" aria-label="Animated live cluster graph" />
      <span>LIVE CLUSTER GRAPH</span>
    </div>
  );
}

export default function LandingPage() {
  const stats = useGlobalStats();
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const heroStats = [
    [stats?.idsMinted ?? 0, 'Identities'],
    [stats?.walletsScanned ?? 0, 'Wallets Scanned'],
    [stats?.sybilsCaught ?? 0, 'Sybils Caught'],
    [stats?.blackHoleOps ?? 0, 'Cleanups Done'],
  ] as const;

  return (
    <div className="landing-page">
      <div className="landing-stars" aria-hidden="true" />
      <SiteHeader />

      <aside className="scroll-rail" aria-label="Section progress">
        {sections.map(([id, label]) => (
          <button key={id} type="button" data-label={label} onClick={() => scrollTo(id)} aria-label={`Go to ${label}`} />
        ))}
      </aside>

      <main>
        <section className="section hero-section" data-section-id="hero" id="hero">
          <div className="landing-container hero-grid">
            <div className="reveal in">
              <span className="landing-eyebrow">Solana reputation layer</span>
              <h1><span>Sybil-resistant</span><span>identity for real users.</span></h1>
              <p>Identity Prism turns wallet history, gameplay, cleanup, badges, and community review into a readable reputation card.</p>
              <div className="hero-actions">
                <Link to="/identity" className="landing-btn primary">Open Identity Hub <ArrowRight aria-hidden="true" /></Link>
                <button type="button" className="landing-btn ghost" onClick={() => scrollTo('solution')}>See System</button>
              </div>
              <div className="hero-stats reveal-stagger in">
                {heroStats.map(([value, label]) => (
                  <div key={label}>
                    <b>{formatStat(value)}</b>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="hero-card-preview reveal in">
              <div className="cc-stage">
                <div className="cc-card">
                  <div className="cc-head"><span>2psA...r4RN</span><b>URANUS</b></div>
                  <div className="landing-id-mock">
                    <img src="/landing/textures/tiers/uranus.png" alt="Uranus tier preview" />
                    <strong>641</strong>
                  </div>
                  <div className="cc-info"><h3>PRISM ID</h3><strong>641<small>/1000</small></strong><div className="cc-progress"><span /></div></div>
                  <div className="cc-badges">{badges.slice(0, 5).map(([src, label]) => <img key={src} src={`/landing/badges/${src}`} alt={label} />)}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <SectionDivider label="The Problem" />
        <section className="section landing-section problem-section" data-section-id="problem" id="problem">
          <div className="landing-container split-grid">
            <div className="reveal in">
              <span className="landing-eyebrow red">Sybil pressure</span>
              <h2>Wallets are cheap. Trust is expensive.</h2>
              <p>Public campaigns, airdrops, quests, and communities need better signals than token balance. Identity Prism compresses hard-to-fake behavior into a score people can inspect.</p>
              <div className="problem-list reveal-stagger in">
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
            <div className="flow-grid reveal-stagger in">
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
              <div className="track-card bad reveal in"><h3>Bad Track</h3>{['Shared funding source', 'Script-like timing', 'Dust fan-out', 'Cluster similarity'].map((x) => <p key={x}><Flame aria-hidden="true" />{x}</p>)}</div>
              <div className="track-card good reveal in"><h3>Good Track</h3>{['Gameplay history', 'Clean wallet age', 'Human verification', 'Community corrections'].map((x) => <p key={x}><CircleCheck aria-hidden="true" />{x}</p>)}</div>
            </div>
          </div>
        </section>

        <SectionDivider label="Achievements" />
        <section className="section landing-section badges-section" data-section-id="badges" id="badges">
          <div className="landing-container">
            <SectionHead eyebrow="Badges" title="Achievements users can actually inspect." copy="Badges are visible proof units: wallet history, cleanup, games, social review, and device ownership." />
            <div className="badges-grid reveal-stagger in">{badges.map(([src, label, copy]) => <div className="badge-card glass-card" key={src}><img src={`/landing/badges/${src}`} alt={label} /><b>{label}</b><span>{copy}</span></div>)}</div>
          </div>
        </section>

        <SectionDivider label="Composite Tiers" />
        <section className="section landing-section tiers-section" data-section-id="tiers" id="tiers">
          <div className="landing-container">
            <SectionHead eyebrow="Tiers" tone="gold" title="Ten planets from Mercury to Binary Sun." copy="Each score band maps to a planet tier, making reputation scannable without hiding the underlying stats." />
            <div className="tiers-grid reveal-stagger in">
              {tiers.map((tier, index) => <div className="tier-card glass-card" key={tier} style={{ '--tier': TIER_HEX[tier] } as React.CSSProperties}><img src={`/landing/textures/tiers/${tier}.png`} alt={`${TIER_LABELS[tier]} tier`} /><b>{TIER_LABELS[tier]}</b><span>{index * 100}-{index === 9 ? '1000' : index * 100 + 99}</span></div>)}
            </div>
          </div>
        </section>

        <SectionDivider label="Games" />
        <section className="section landing-section games-section" data-section-id="games" id="games">
          <div className="landing-container">
            <SectionHead eyebrow="Prism League" title="Skill is proof that bots struggle to fake." copy="Games, arena matches, and quests become human-proof signals that feed Ranger XP and identity reputation." />
            <div className="games-grid reveal-stagger in">
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
            <div className="rank-table glass-card reveal in">
              {['Cadet', 'Pilot', 'Captain', 'Ace', 'Legend'].map((r, i) => <div key={r}><span>{r}</span><b>{[0, 1500, 8000, 25000, 50000][i].toLocaleString('en-US')} XP</b><em>{['Base gear', 'Text quests', 'Yellow slots', 'Red slots', 'All systems'][i]}</em></div>)}
            </div>
          </div>
        </section>

        <SectionDivider label="Finale" />
        <section className="section landing-section explode-section" data-section-id="explode" id="explode">
          <div className="landing-container">
            <SectionHead eyebrow="Planet Explode" title="Every identity can be rebuilt from fresh proof." copy="Risk collapses, shards fly, and a stronger planet reforms from updated evidence." />
            <div className="explode-stage reveal in">
              <div className="explode-planet"><img src="/landing/textures/tiers/sun.png" alt="Exploding planet finale" /></div>
              {Array.from({ length: 14 }, (_, i) => <span key={i} className="shard" style={{ '--i': i } as React.CSSProperties} />)}
            </div>
          </div>
        </section>

        <SectionDivider label="Network Live" />
        <section className="section landing-section live-stats-section" data-section-id="network-live" id="network-live">
          <div className="landing-container">
            <SectionHead
              eyebrow="Network Live"
              tone="green"
              title="The protocol pulse is public."
              copy="Identity mints, scans, sybil outcomes, cleanup operations, reports, and clusters update from the live backend."
            />
            <div className="live-stats-grid reveal-stagger in">
              <StatTile label="Identities Minted" value={stats?.idsMinted ?? 0} color="cyan" />
              <StatTile label="Wallets Scanned" value={stats?.walletsScanned ?? 0} color="violet" />
              <StatTile label="Sybils Caught" value={stats?.sybilsCaught ?? 0} color="red" />
              <StatTile label="Cleanups Done" value={stats?.blackHoleOps ?? 0} color="orange" />
              <StatTile label="Reports Verified" value={stats?.sybilsReported ?? 0} color="cyan" />
              <StatTile label="Clusters Mapped" value={stats?.clusters ?? 0} color="violet" />
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
              <Link to="/sybil-hunt" className="landing-btn ghost">Start Sybil Hunt</Link>
            </div>
            <div className="hero-stats reveal-stagger in">
              {heroStats.slice(0, 3).map(([value, label]) => (
                <div key={label}>
                  <b>{formatStat(value)}</b>
                  <span>{label}</span>
                </div>
              ))}
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
