import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CircleCheck,
  Flame,
  Gamepad2,
  Loader2,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wallet,
  Zap,
} from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import type { PlanetTier, WalletData, WalletTraits } from '@/hooks/useWalletData';
import { TIER_HEX, TIER_LABELS } from '@/lib/constants/tierColors';
import './landing.css';

const Planet3D = lazy(() => import('@/components/Planet3D').then((module) => ({ default: module.Planet3D })));
const CelestialCard = lazy(() => import('@/components/CelestialCard').then((module) => ({ default: module.CelestialCard })));

const sections = [
  ['hero', 'Hero'],
  ['problem', 'Problem'],
  ['solution', 'Solution'],
  ['sybil-catch', 'Tracks'],
  ['blackhole', 'BlackHole'],
  ['identity', 'Identity'],
  ['sybil-hunt', 'Hunt'],
  ['badges', 'Badges'],
  ['tiers', 'Tiers'],
  ['games', 'Games'],
  ['ranks', 'Ranks'],
  ['explode', 'Finale'],
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

const mockTraits: WalletTraits = {
  hasSeeker: true,
  hasPreorder: true,
  hasCombo: false,
  isOG: true,
  isWhale: false,
  isCollector: true,
  isEarlyAdopter: true,
  isTxTitan: false,
  isSolanaMaxi: true,
  isBlueChip: true,
  isDeFiKing: true,
  uniqueTokenCount: 86,
  nftCount: 24,
  txCount: 4280,
  memeCoinsHeld: ['WIF', 'BONK'],
  isMemeLord: false,
  hyperactiveDegen: false,
  diamondHands: true,
  avgTxPerDay30d: 6.8,
  daysSinceLastTx: 1,
  solBalance: 14.72,
  solBonusApplied: 100,
  walletAgeDays: 914,
  walletAgeBonus: 250,
  planetTier: 'neptune',
  totalAssetsCount: 143,
  solTier: 'whale',
  totalValueUSD: 18420,
  cosmicRank: 'supernova',
  swapCount: 318,
  nftTradeCount: 42,
  stakingCount: 18,
  defiProtocols: ['Jupiter', 'Kamino', 'Tensor', 'Meteora'],
  isDeFiUser: true,
};

const mockWallet: WalletData = {
  address: 'FDpbCtY6S22L9PZ3oRDADpnQLhEAF8uP3meMtEMeLYqa',
  score: 740,
  traits: mockTraits,
  isLoading: false,
  error: null,
};

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ');
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="landing-divider" aria-hidden="true">
      <span>{label}</span>
    </div>
  );
}

function SectionHead({ eyebrow, title, copy, tone = 'prism' }: { eyebrow: string; title: React.ReactNode; copy: string; tone?: 'prism' | 'red' | 'green' | 'gold' }) {
  return (
    <div className="landing-section-head reveal">
      <span className={`landing-eyebrow ${tone}`}>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

function PlanetCanvas({ tier = 'neptune' as PlanetTier }) {
  return (
    <div className="landing-planet-canvas">
      <Canvas camera={{ position: [0, 0, 4.2], fov: 42 }} dpr={[1, 1.8]}>
        <ambientLight intensity={1.1} />
        <directionalLight position={[4, 2, 5]} intensity={2.2} />
        <Suspense fallback={null}>
          <Planet3D tier={tier} />
          <Environment preset="night" />
        </Suspense>
        <OrbitControls enablePan={false} minDistance={2.6} maxDistance={6} autoRotate autoRotateSpeed={0.45} />
      </Canvas>
    </div>
  );
}

function SybilCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const stage = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !stage || !ctx) return;

    let width = 1;
    let height = 1;
    let frame = 0;
    let raf = 0;
    const nodes = Array.from({ length: 34 }, (_, index) => ({
      ring: 0.18 + Math.random() * 0.66,
      angle: Math.random() * Math.PI * 2,
      speed: (Math.random() * 0.003 + 0.001) * (index % 2 ? 1 : -1),
      alert: index % 7 === 0,
    }));

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = stage.getBoundingClientRect();
      width = Math.max(rect.width, 1);
      height = Math.max(rect.height, 1);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const point = (node: (typeof nodes)[number]) => {
      const a = node.angle + frame * node.speed;
      return {
        x: width / 2 + Math.cos(a) * width * node.ring * 0.42,
        y: height / 2 + Math.sin(a * 1.18) * height * node.ring * 0.35,
      };
    };

    const draw = () => {
      frame += 1;
      ctx.clearRect(0, 0, width, height);
      const center = { x: width / 2, y: height / 2 };
      const points = nodes.map(point);
      ctx.lineWidth = 1;
      points.forEach((p, index) => {
        ctx.strokeStyle = nodes[index].alert ? 'rgba(248,113,113,.36)' : 'rgba(248,113,113,.14)';
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      });
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const dx = points[i].x - points[j].x;
          const dy = points[i].y - points[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < width * 0.14) {
            ctx.strokeStyle = `rgba(248,113,113,${0.14 - dist / width})`;
            ctx.beginPath();
            ctx.moveTo(points[i].x, points[i].y);
            ctx.lineTo(points[j].x, points[j].y);
            ctx.stroke();
          }
        }
      }
      ctx.shadowBlur = 22;
      ctx.shadowColor = '#f87171';
      ctx.fillStyle = '#f87171';
      ctx.beginPath();
      ctx.arc(center.x, center.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      points.forEach((p, index) => {
        ctx.fillStyle = nodes[index].alert ? '#f87171' : 'rgba(255,255,255,.76)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, nodes[index].alert ? 3 : 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
      raf = window.requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="sybil-canvas" aria-label="Animated sybil cluster graph" />;
}

function BlackHoleFeature() {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onMove = (event: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width - 0.5) * 26}px`);
      el.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height - 0.5) * 26}px`);
    };
    el.addEventListener('mousemove', onMove);
    return () => el.removeEventListener('mousemove', onMove);
  }, []);

  const tokens = [
    ['BitX Rune', '12,490', '+0.0017 SOL', 'Burn'],
    ['Sarosism NFT', '1', '+0.0020 SOL', 'Close'],
    ['woofer', '840,000', '+0.0011 SOL', 'Swap'],
    ['Hawk Tuah', '77', '+0.0014 SOL', 'Burn'],
  ];

  return (
    <section className="section landing-section blackhole-feature" data-section-id="blackhole" id="blackhole">
      <div className="landing-container">
        <SectionHead eyebrow="Black Hole" tone="red" title="Feed the void. Reclaim your SOL." copy="The cleanup surface from the APK, adapted for wide screens: scan, protect valuable assets, burn spam, close empty accounts, and preview net SOL before execution." />
        <div className="blackhole-grid">
          <div className="blackhole-orbit reveal" ref={wrapRef}>
            <h3>BLACK HOLE</h3>
            <p>FEED THE VOID · RECLAIM YOUR SOL</p>
            <div className="event-horizon" aria-hidden="true">
              <span className="polar-jet top" />
              <span className="polar-jet bottom" />
              <span className="accretion ring-a" />
              <span className="accretion ring-b" />
              <span className="photon-ring" />
              <span className="void-disc" />
            </div>
          </div>
          <div className="blackhole-console glass-card reveal-stagger">
            <div className="contamination">
              <div>
                <span>Contamination</span>
                <b>MODERATE</b>
              </div>
              <strong>47%</strong>
              <div className="meter"><span style={{ width: '47%' }} /></div>
            </div>
            <div className="bh-stats">
              {[
                ['Scanned', '86', ''],
                ['Shielded', '41', 'green'],
                ['Caution', '14', 'gold'],
                ['Threats', '31', 'red'],
              ].map(([label, value, tone]) => (
                <div key={label} className={tone}>
                  <span>{label}</span>
                  <b>{value}</b>
                </div>
              ))}
            </div>
            <div className="token-table">
              {tokens.map(([asset, bal, ret, status]) => (
                <div key={asset}>
                  <span className="asset"><Flame aria-hidden="true" /> {asset}</span>
                  <span>{bal}</span>
                  <span className="green">{ret}</span>
                  <span className="status">{status}</span>
                </div>
              ))}
            </div>
            <div className="manifest">
              <div><span>Resolved</span><b>4 assets</b></div>
              <div><span>Swap</span><b>1</b></div>
              <div><span>Burn</span><b>2</b></div>
              <div><span>Close</span><b>1</b></div>
              <div><span>Net SOL</span><b>+0.0062</b></div>
              <div><span>Commission</span><b>0.0009</b></div>
              <Link to="/blackhole" className="landing-btn primary full">EXECUTE CLEANUP</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function IdentityFeature() {
  const [tab, setTab] = useState<'stats' | 'badges' | 'intel'>('stats');
  const stats = [
    ['SOL Balance', '14.72'],
    ['Wallet Age', '914d'],
    ['TX Count', '4,280'],
    ['NFTs Held', '24'],
    ['Activity Idx', '86'],
    ['Dormancy', '1d'],
  ];
  const intel = [
    ['trustScore', '82'],
    ['riskLevel', 'low'],
    ['walletAge', '914d'],
    ['flowRatio', '1.18'],
    ['dustRatio', '7%'],
    ['uniquePrograms', '63'],
    ['clusterSimilarity', '12%'],
  ];

  return (
    <section className="section landing-section identity-feature" data-section-id="identity" id="identity">
      <div className="landing-container">
        <SectionHead eyebrow="Identity Card" title="A living card for reputation, badges, and intel." copy="Score 0-1000, tier drift to the next planet, wallet stats, badge proof, and sybil intelligence in the same presentation model as the app." />
        <div className="identity-grid">
          <div className="identity-card-stage reveal">
            <Suspense fallback={<div className="landing-skeleton">Loading 3D card</div>}>
              <CelestialCard data={mockWallet} captureMode captureView="front" />
            </Suspense>
          </div>
          <div className="identity-panel glass-card reveal">
            <div className="id-topline">
              <span>Composite Score</span>
              <b>740<small>/1000</small></b>
              <em>Neptune · Grade A · next tier drift 74%</em>
              <div className="score-fill"><span /></div>
            </div>
            <div className="id-tabs" role="tablist" aria-label="Identity details">
              {(['stats', 'badges', 'intel'] as const).map((item) => (
                <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item.toUpperCase()}</button>
              ))}
            </div>
            {tab === 'stats' && (
              <div className="id-stat-grid">
                {stats.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}
              </div>
            )}
            {tab === 'badges' && (
              <div className="id-badge-list">
                {badges.slice(0, 5).map(([src, label, copy]) => (
                  <div key={src}><img src={`/landing/badges/${src}`} alt="" /><span>{label}</span><small>{copy}</small></div>
                ))}
              </div>
            )}
            {tab === 'intel' && (
              <div className="intel-list">
                {intel.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

type RiskKind = 'clear' | 'warning' | 'high_risk';

function riskForQuery(query: string): { kind: RiskKind; score: number; label: string } {
  const seed = Array.from(query || 'example').reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 3), 0);
  const score = 12 + (seed % 84);
  if (score >= 70) return { kind: 'high_risk', score, label: 'High risk cluster' };
  if (score >= 42) return { kind: 'warning', score, label: 'Needs review' };
  return { kind: 'clear', score, label: 'Likely human' };
}

function SybilHuntFeature() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [loading, setLoading] = useState(false);
  const risk = submitted ? riskForQuery(submitted) : null;

  const submit = (value = query) => {
    if (!value.trim()) return;
    setLoading(true);
    window.setTimeout(() => {
      setSubmitted(value.trim());
      setLoading(false);
    }, 360);
  };

  const indicators = [
    ['medium', 'Funding source reuse', 'Target shares sponsor wallets with known clusters.'],
    ['low', 'Human timing variance', 'Session cadence includes organic gaps.'],
    ['high', 'Dust fan-out', 'Many low-value token routes point to the same sink.'],
  ];

  return (
    <section className="section landing-section sybil-hunt-feature" data-section-id="sybil-hunt" id="sybil-hunt">
      <div className="landing-container">
        <div className="hunt-grid">
          <div className="reveal">
            <span className="detector-pill"><i /> Sybil Detector</span>
            <h2>Catch Sybils</h2>
            <p>Search a wallet, .skr name, or cluster hint. The landing preview mirrors the app logic with risk cards, indicators, and example targets.</p>
            <form className="hunt-search" onSubmit={(event) => { event.preventDefault(); submit(); }}>
              <label htmlFor="hunt-search">Wallet or name</label>
              <div>
                <input id="hunt-search" type="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="fenn.skr" />
                <button type="submit" aria-label="Search sybil target">{loading ? <Loader2 className="spin" /> : <Search />}</button>
              </div>
            </form>
            {!risk && (
              <div className="examples">
                {['fenn.skr', 'example'].map((item) => <button key={item} type="button" onClick={() => { setQuery(item); submit(item); }}>{item}</button>)}
              </div>
            )}
          </div>
          <div className="hunt-panel glass-card reveal">
            {risk ? (
              <div className={`risk-card ${risk.kind}`}>
                <span>{submitted}</span>
                <b>{risk.label}</b>
                <strong>{risk.score}</strong>
              </div>
            ) : (
              <div className="empty-risk"><Radar aria-hidden="true" /><b>No target selected</b><span>Use examples to run a mock scan.</span></div>
            )}
            <div className="indicator-list reveal-stagger in">
              {indicators.map(([level, label, copy]) => (
                <div key={label}><span className={level}>{level}</span><b>{label}</b><p>{copy}</p></div>
              ))}
            </div>
          </div>
        </div>
        <div className="how-grid reveal-stagger">
          {[
            ['Gameplay History', 'Skill sessions and reaction patterns separate people from scripts.'],
            ['On-Chain Footprint', 'Funding depth, flow ratio, wallet age, and programs reveal cohorts.'],
            ['Human Verification', 'Community correction turns false positives into better signal.'],
          ].map(([title, copy]) => <div className="glass-card" key={title}><b>{title}</b><p>{copy}</p></div>)}
        </div>
        <div className="center-cta reveal"><Link to="/app" className="landing-btn primary">Launch App & Get Started</Link></div>
      </div>
    </section>
  );
}

function LandingPage() {
  const [activeSection, setActiveSection] = useState('hero');
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const revealObserver = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('in')),
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    document.querySelectorAll('.landing-page .reveal, .landing-page .reveal-stagger').forEach((el) => revealObserver.observe(el));

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection((entry.target as HTMLElement).dataset.sectionId || 'hero');
        });
      },
      { threshold: 0.35, rootMargin: '-20% 0px -45% 0px' },
    );
    document.querySelectorAll<HTMLElement>('.landing-page .section[data-section-id]').forEach((el) => sectionObserver.observe(el));
    return () => {
      revealObserver.disconnect();
      sectionObserver.disconnect();
    };
  }, []);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });

  const rankCards = useMemo(() => [
    ['rank_cadet.png', 'Cadet', '0 XP', '#9ca3af'],
    ['rank_pilot.png', 'Pilot', '1,500 XP', '#60a5fa'],
    ['rank_captain.png', 'Captain', '8,000 XP', '#fcbf49'],
    ['rank_ace.png', 'Ace', '25,000 XP', '#a78bfa'],
    ['rank_legend.png', 'Legend', '50,000 XP', '#fde047'],
  ], []);

  return (
    <div className="landing-page">
      <div className="landing-stars" aria-hidden="true" />
      <header className="landing-header">
        <button type="button" className="landing-brand" onClick={() => scrollTo('hero')}>
          <img src="/phav.png" alt="" />
          <span><b>IDENTITY PRISM</b><small>Sybil-Resistant Identity</small></span>
        </button>
        <nav aria-label="Landing navigation">
          {['problem', 'solution', 'blackhole', 'identity', 'sybil-hunt'].map((id) => (
            <button key={id} type="button" onClick={() => scrollTo(id)}>{id.replace('-', ' ')}</button>
          ))}
        </nav>
        <Link to="/app" className="landing-btn small">Launch App</Link>
      </header>

      <aside className="scroll-rail" aria-label="Section progress">
        {sections.slice(0, 12).map(([id, label]) => (
          <button key={id} type="button" className={activeSection === id ? 'active' : ''} data-label={label} onClick={() => scrollTo(id)} aria-label={`Go to ${label}`} />
        ))}
      </aside>

      <main>
        <section className="section hero-section" data-section-id="hero" id="hero">
          <div className="landing-container hero-grid">
            <motion.div initial={reducedMotion ? false : { opacity: 0, y: 24 }} animate={reducedMotion ? undefined : { opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
              <span className="landing-eyebrow">Solana reputation layer</span>
              <h1><span>Sybil-resistant</span><span>identity for real users.</span></h1>
              <p>Identity Prism turns wallet history, gameplay, cleanup, badges, and community review into a readable reputation card.</p>
              <div className="hero-actions">
                <Link to="/app" className="landing-btn primary">Launch App <ArrowRight aria-hidden="true" /></Link>
                <button type="button" className="landing-btn ghost" onClick={() => scrollTo('solution')}>See System</button>
              </div>
              <div className="hero-stats reveal-stagger in">
                {['740 Score', '10 Tiers', '31 Threats', '5 Badges'].map((item) => <div key={item}><b>{item.split(' ')[0]}</b><span>{item.split(' ').slice(1).join(' ')}</span></div>)}
              </div>
            </motion.div>
            <motion.div className="hero-card-preview" initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }} animate={reducedMotion ? undefined : { opacity: 1, scale: 1 }} transition={{ duration: 0.9, delay: 0.15 }}>
              <div className="cc-stage">
                <div className="cc-card">
                  <div className="cc-head"><span>FDpb...LYqa</span><b>NEPTUNE</b></div>
                  <PlanetCanvas tier="neptune" />
                  <div className="cc-info"><h3>PRISM ID</h3><strong>740<small>/1000</small></strong><div className="cc-progress"><span /></div></div>
                  <div className="cc-badges">{badges.slice(0, 5).map(([src, label]) => <img key={src} src={`/landing/badges/${src}`} alt={label} />)}</div>
                </div>
              </div>
            </motion.div>
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
                  [AlertTriangle, 'Airdrop farms mimic humans', 'Clusters reuse funding, timing, and routing patterns.'],
                  [Wallet, 'Wallets have no context', 'Useful users look identical to fresh spam accounts.'],
                  [ShieldCheck, 'Manual review does not scale', 'Communities need explainable flags and correction loops.'],
                ].map(([Icon, title, copy]) => <div className="glass-card" key={String(title)}><Icon aria-hidden="true" /><b>{title as string}</b><span>{copy as string}</span></div>)}
              </div>
            </div>
            <div className="sybil-stage reveal"><SybilCanvas /><span>LIVE CLUSTER GRAPH</span></div>
          </div>
        </section>

        <SectionDivider label="Wallet To Identity" />

        <section className="section landing-section solution-section" data-section-id="solution" id="solution">
          <div className="landing-container">
            <SectionHead eyebrow="Solution" tone="green" title="A wallet becomes an identity when evidence compounds." copy="On-chain history, human gameplay, cleanup behavior, social review, and achievements flow into one composite score." />
            <div className="flow-grid reveal-stagger">
              {['Wallet', 'Signals', 'Score', 'Tier', 'Identity'].map((item, index) => (
                <React.Fragment key={item}>
                  <div className="flow-node"><span>{index + 1}</span><b>{item}</b><i /></div>
                  {index < 4 && <ArrowRight className="flow-arrow" aria-hidden="true" />}
                </React.Fragment>
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

        <BlackHoleFeature />
        <SectionDivider label="Prism ID" />
        <IdentityFeature />
        <SectionDivider label="Sybil Hunt" />
        <SybilHuntFeature />

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
            <div className="ranks-grid reveal-stagger">{rankCards.map(([src, name, xp, color]) => <div className="rank-card glass-card" key={src} style={{ '--rank': color } as React.CSSProperties}><img src={`/landing/textures/ranks/${src}`} alt={`${name} rank`} /><b>{name}</b><span>{xp}</span></div>)}</div>
          </div>
        </section>

        <SectionDivider label="Finale" />

        <section className="section landing-section explode-section" data-section-id="explode" id="explode">
          <div className="landing-container">
            <SectionHead eyebrow="Planet Explode" title="Every identity can be rebuilt from fresh proof." copy="A visual finale for the reputation loop: risk collapses, shards fly, and a stronger planet reforms." />
            <div className="explode-stage reveal">
              <div className="explode-planet"><img src="/landing/textures/tiers/sun.png" alt="Exploding planet finale" /></div>
              {Array.from({ length: 14 }, (_, i) => <span key={i} className="shard" style={{ '--i': i } as React.CSSProperties} />)}
            </div>
          </div>
        </section>
      </main>

      <footer className="section landing-footer" data-section-id="footer" id="footer">
        <div className="landing-container footer-grid">
          <div><img src="/phav.png" alt="" /><b>IDENTITY PRISM</b><p>Sybil-resistant identity for Solana wallets, games, cleanup, and community reputation.</p></div>
          <nav aria-label="Footer links"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/cookies.html">Cookies</a><a href="mailto:hello@identityprism.xyz">hello@identityprism.xyz</a></nav>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
