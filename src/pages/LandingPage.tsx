import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Bell,
  CircleCheck,
  Flame,
  Gamepad2,
  Loader2,
  Radar,
  RotateCw,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Wallet,
  Zap,
} from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import type { PlanetTier, WalletData, WalletTraits } from '@/hooks/useWalletData';
import { useWalletData } from '@/hooks/useWalletData';
import { useCompositeScore } from '@/hooks/useCompositeScore';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@/lib/solanaToken';
import { fetchSybilAnalysis, type SybilResult } from '@/components/prism/shared';
import { gatherXPSourcesMerged, computeRangerXP, getRangerRank, getRankProgress } from '@/lib/rangerRanks';
import { TIER_HEX, TIER_LABELS } from '@/lib/constants/tierColors';
import { toast } from 'sonner';
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

function truncateAddress(address: string, chars = 4) {
  return address.length <= chars * 2 + 3 ? address : `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

function formatCompact(value: number) {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (abs >= 100) return `${Math.round(value)}`;
  if (abs >= 1) return `${Number(value.toFixed(2))}`;
  if (abs > 0) return `${Number(value.toFixed(5))}`;
  return '0';
}

function scoreToTier(score: number): PlanetTier {
  const index = Math.max(0, Math.min(tiers.length - 1, Math.floor(score / 100)));
  return tiers[index];
}

function isSolanaAddress(value: string) {
  try {
    return Boolean(new PublicKey(value.trim()));
  } catch {
    return false;
  }
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

function LandingWalletButton() {
  const { connected, connecting, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const address = publicKey?.toBase58();

  if (connected && address) {
    return (
      <button
        type="button"
        className="landing-btn small wallet-connected"
        onClick={() => void disconnect()}
        aria-label={`Disconnect wallet ${truncateAddress(address)}`}
      >
        <span aria-hidden="true" />
        Connected: {truncateAddress(address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="landing-btn small"
      disabled={connecting}
      onClick={() => setVisible(true)}
      aria-busy={connecting}
    >
      {connecting ? <Loader2 className="spin" aria-hidden="true" /> : <Wallet aria-hidden="true" />}
      {connecting ? 'Connecting' : 'Connect Wallet'}
    </button>
  );
}

type LandingTokenAccount = {
  pubkey: string;
  mint: string;
  amount: number;
  decimals: number;
  uiAmount: number;
  lamports: number;
  rentSol: number;
  frozen: boolean;
  status: 'protected' | 'quarantine';
  reason: string;
};

function BlackHoleFeature() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [tokens, setTokens] = useState<LandingTokenAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const address = publicKey?.toBase58() ?? '';

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

  const scan = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError('');
    try {
      const results = await Promise.all([
        connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }, 'confirmed'),
        connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }, 'confirmed'),
      ]);
      const next = results.flatMap((result) =>
        result.value.map(({ pubkey, account }) => {
          const parsed = account.data.parsed.info;
          const tokenAmount = parsed.tokenAmount ?? {};
          const rawAmount = Number(tokenAmount.amount ?? 0);
          const decimals = Number(tokenAmount.decimals ?? 0);
          const uiAmount =
            typeof tokenAmount.uiAmount === 'number' ? tokenAmount.uiAmount : rawAmount / Math.max(1, 10 ** decimals);
          const frozen = parsed.state === 'frozen';
          const isNft = decimals === 0 && rawAmount === 1;
          const isDust = !isNft && uiAmount > 0 && uiAmount < 1000;
          const status = frozen || isNft || !isDust ? 'protected' : 'quarantine';
          return {
            pubkey: pubkey.toBase58(),
            mint: String(parsed.mint),
            amount: rawAmount,
            decimals,
            uiAmount,
            lamports: account.lamports,
            rentSol: account.lamports / LAMPORTS_PER_SOL,
            frozen,
            status,
            reason: frozen ? 'Frozen account' : isNft ? 'NFT / collectible' : isDust ? 'Dust token cleanup candidate' : 'Token balance protected',
          } satisfies LandingTokenAccount;
        }),
      );
      setTokens(next.sort((a, b) => b.rentSol - a.rentSol).slice(0, 8));
    } catch (err) {
      console.error('[Landing BlackHole] scan failed', err);
      setError('Token scan failed. Try again or open the full BlackHole page.');
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setTokens([]);
      setError('');
      return;
    }
    void scan();
  }, [connected, publicKey, scan]);

  const protectedCount = tokens.filter((token) => token.status === 'protected').length;
  const threatCount = tokens.filter((token) => token.status === 'quarantine').length;
  const contaminationPct = tokens.length ? Math.round((threatCount / tokens.length) * 100) : 0;
  const salvageSol = tokens.filter((token) => token.status === 'quarantine').reduce((sum, token) => sum + token.rentSol, 0);

  return (
    <section className="section landing-section blackhole-feature" data-section-id="blackhole" id="blackhole">
      <div className="landing-container blackhole-v2-container">
        <div className="blackhole-v2-hero reveal" ref={wrapRef}>
          <Link to="/" className="landing-btn ghost bh-back">BACK TO HUB</Link>
          <div className="bh-beam" aria-hidden="true"><span /></div>
          <h2>BLACK HOLE</h2>
          <p>Recover rent from dust. Swap what still has value. Protected assets stay untouched.</p>
          <div className="blackhole-sphere-wrap">
            <div className="event-horizon apk" aria-hidden="true">
              <span className="polar-jet top" />
              <span className="polar-jet bottom" />
              <span className="accretion ring-a" />
              <span className="accretion ring-b" />
              <span className="photon-ring" />
              <span className="void-disc" />
            </div>
          </div>
          <div className="bh-found-toast">
            {loading ? <Loader2 className="spin" aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
            {connected ? (loading ? 'Scanning token accounts' : `Found ${tokens.length} token accounts`) : 'Connect wallet to scan'}
          </div>
        </div>

        <div className="bh-mode-panel reveal">
          <div className="bh-tabs" role="tablist" aria-label="Black Hole mode">
            <button type="button" className="active">READ-ONLY SCAN</button>
            <button type="button"><span />ACTIVE MISSION</button>
          </div>
          <p>{connected ? `Read-only scan for ${truncateAddress(address)}. Protected assets stay untouched; cleanup executes on the full page.` : 'Connect your Solana wallet to run the same read-only token account scan used by BlackHole.'}</p>
          <div className="bh-holder"><Shield aria-hidden="true" /> <b>ID Holder</b> — salvage fee: <strong>2%</strong> (vs 10% standard)</div>
        </div>

        <div className="bh-contamination glass-card reveal">
          <div className="bh-contamination-head">
            <span>CONTAMINATION LEVEL</span>
            <b>{!connected ? 'WAITING' : contaminationPct >= 40 ? 'HIGH' : contaminationPct > 0 ? 'WATCH' : 'CLEAN'}</b>
          </div>
          <div className="bh-contamination-meter"><span style={{ width: `${contaminationPct}%` }} /></div>
          <div className="bh-contamination-foot">
            <span>{contaminationPct}% contaminated</span>
            <span>{threatCount} threats / {tokens.length} total</span>
          </div>
        </div>

        <div className="bh-stats apk reveal-stagger">
          {[
            [Search, String(tokens.length), 'SCANNED', 'scanned'],
            [Shield, String(protectedCount), 'SHIELDED', 'shielded'],
            [AlertTriangle, String(threatCount), 'CAUTION', 'caution'],
            [Flame, salvageSol.toFixed(4), 'RENT SOL', 'threats'],
          ].map(([Icon, value, label, tone]) => (
            <div key={String(label)} className={String(tone)}>
              <Icon aria-hidden="true" />
              <b>{String(value)}</b>
              <span>{String(label)}</span>
            </div>
          ))}
        </div>

        <div className="bh-salvage glass-card reveal">
          <div>
            <span>SALVAGE REWARD</span>
            <b>~{salvageSol.toFixed(4)} SOL</b>
            <small>Rent estimate from real token accounts</small>
          </div>
          <Flame aria-hidden="true" />
          <p>{connected ? 'Read-only landing scan. Open the full page to review and sign cleanup.' : 'No scan runs until a wallet is connected.'}</p>
        </div>

        {error && <div className="bh-notice reveal in"><AlertTriangle aria-hidden="true" />{error}</div>}

        <div className="bh-controls reveal">
          <button type="button" className="landing-btn ghost" onClick={connected ? scan : () => setVisible(true)} disabled={loading} aria-busy={loading}>
            {loading ? <Loader2 className="spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
            {connected ? 'Re-scan' : 'Connect Wallet to scan'}
          </button>
          <div>
            <button type="button" className="active">All</button>
            <button type="button">NFTs</button>
            <button type="button">Tokens</button>
          </div>
          <label><input type="checkbox" /> Show all</label>
        </div>

        <div className="bh-token-table glass-card reveal">
          <div className="bh-token-head">
            <span></span><span>Asset</span><span>Balance</span><span>Value ↓</span><span>Return</span><span>Status</span>
          </div>
          {!connected && (
            <div className="landing-empty-state bh-empty">
              <Wallet aria-hidden="true" />
              <b>Connect Wallet to scan</b>
              <span>BlackHole will read your token accounts and separate protected assets from cleanup candidates.</span>
              <button type="button" className="landing-btn primary" onClick={() => setVisible(true)}>Select Wallet</button>
            </div>
          )}
          {connected && loading && (
            <div className="landing-empty-state bh-empty">
              <Loader2 className="spin" aria-hidden="true" />
              <b>Scanning token accounts</b>
              <span>Reading SPL and Token-2022 accounts from the connected wallet.</span>
            </div>
          )}
          {connected && !loading && tokens.length === 0 && (
            <div className="landing-empty-state bh-empty">
              <CircleCheck aria-hidden="true" />
              <b>No token accounts found</b>
              <span>This wallet has no cleanup candidates in the landing scan.</span>
            </div>
          )}
          {connected && !loading && tokens.map((token, index) => (
            <div className="bh-token-row" key={token.pubkey}>
              <label aria-label={`Select ${truncateAddress(token.mint)}`}><input type="checkbox" defaultChecked={token.status === 'quarantine'} /></label>
              <div className="bh-asset-cell">
                <span className={`bh-thumb ${token.status === 'protected' ? 'purple' : index % 2 ? 'orange' : 'cyan'}`}><em>{token.mint.slice(0, 2)}</em></span>
                <div>
                  <b>{truncateAddress(token.mint)}</b>
                  <i>{token.decimals === 0 && token.amount === 1 ? 'NFT' : 'TKN'}</i>
                  <small>{token.reason} · {truncateAddress(token.pubkey)}</small>
                </div>
              </div>
              <span>{formatCompact(token.uiAmount)}</span>
              <span>Read-only</span>
              <strong>+{token.rentSol.toFixed(4)} SOL</strong>
              <div className={`bh-status ${token.status}`}>
                {token.status === 'protected' ? <Shield aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
                <div><b>{token.status === 'protected' ? 'Protected' : 'Quarantine'}</b><small>{token.status === 'protected' ? 'Blue-chip collection' : 'Manual review required'}</small></div>
              </div>
            </div>
          ))}
        </div>

        <div className="bh-bulk glass-card reveal">
          <span>{threatCount} assets selected — Net SOL recovery: <b>~{salvageSol.toFixed(4)} SOL</b></span>
          <Link to="/blackhole" className="landing-btn primary">EXECUTE CLEANUP <ArrowRight aria-hidden="true" /></Link>
        </div>
      </div>
    </section>
  );
}

function IdentityFeature() {
  const [openCard, setOpenCard] = useState(false);
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const address = publicKey?.toBase58() ?? '';
  const walletData = useWalletData(connected ? address : undefined);
  const composite = useCompositeScore(connected ? address : null);
  const [rankState, setRankState] = useState<{ xp: number; rank: string; progress: number; next: string }>({
    xp: 0,
    rank: 'Cadet',
    progress: 0,
    next: 'Pilot',
  });

  useEffect(() => {
    if (!connected || !address) return;
    let cancelled = false;
    gatherXPSourcesMerged(address)
      .then((sources) => {
        if (cancelled) return;
        const xp = computeRangerXP(sources);
        const rank = getRangerRank(xp);
        const next = getRangerRank(xp + Math.max(1, Math.ceil((1 - getRankProgress(xp)) * 1500)));
        setRankState({ xp, rank: rank.name, progress: Math.round(getRankProgress(xp) * 100), next: next.name });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address, connected]);

  const score = composite.score || walletData.score || 0;
  const tier = (composite.tier || walletData.traits?.planetTier || scoreToTier(score)) as PlanetTier;
  const statBars = [
    ['ON-CHAIN', composite.breakdown.onchain, 400, 'cyan'],
    ['TRUST', composite.breakdown.sybilTrust, 250, 'violet'],
    ['GAMES', composite.breakdown.humanProof, 150, 'green'],
    ['SOCIAL', composite.breakdown.social, 100, 'pink'],
    ['ENGAGE', composite.breakdown.engagement, 100, 'purple'],
  ] as const;
  const hubItems = [
    ['league.png', 'League'],
    ['scanner.png', 'Sybil Hunt'],
    ['arena.png', 'Arena'],
    ['blackhole.png', 'Black Hole'],
  ];
  const fullBadges = [
    ['achievement_hunter.png', 'Achievement Hunter'],
    ['diamond_hands.png', 'Diamond Hands'],
    ['blue_chip.png', 'Blue Chip'],
    ['defi_architect.png', 'Defi Architect'],
    ['game_master.png', 'Game Master'],
  ];

  return (
    <section className="section landing-section identity-feature" data-section-id="identity" id="identity">
      <div className="landing-container identity-v2-container">
        <div className="identity-tier-hero reveal">
          <span>TIER LEVEL</span>
          <h2>{connected ? TIER_LABELS[tier] : 'LOCKED'}</h2>
          <button type="button" aria-label="Refresh identity card" onClick={() => composite.refetch()} disabled={!connected}><RotateCw aria-hidden="true" /></button>
        </div>

        {!connected ? (
          <div className="landing-empty-state identity-empty glass-card reveal">
            <Wallet aria-hidden="true" />
            <b>Connect Your Wallet</b>
            <span>Connect your Solana wallet to view your Identity card with tier, score, badges, and stats.</span>
            <button type="button" className="landing-btn primary" onClick={() => setVisible(true)}>Select Wallet</button>
          </div>
        ) : (
          <>
        <div className="identity-hub-card glass-card reveal">
          <div className="identity-score-col">
            <div className="score-ring" aria-label={`Identity score ${Math.round(score)}`} style={{ '--score': Math.max(0, Math.min(100, score / 10)) } as React.CSSProperties}>
              <svg viewBox="0 0 180 180" aria-hidden="true">
                <defs><linearGradient id="scoreRingGradient" x1="0" x2="1"><stop stopColor="#22d3ee" /><stop offset=".55" stopColor="#a78bfa" /><stop offset="1" stopColor="#f472b6" /></linearGradient></defs>
                <circle cx="90" cy="90" r="76" />
                <circle cx="90" cy="90" r="76" pathLength="100" />
              </svg>
              <b>{walletData.isLoading || composite.isLoading ? <Loader2 className="spin" aria-hidden="true" /> : Math.round(score)}</b>
              <span>SCORE</span>
            </div>
            <small>{truncateAddress(address)}</small>
          </div>

          <div className="identity-planet-col">
            {walletData.isLoading && !walletData.traits ? <div className="landing-skeleton"><Loader2 className="spin" aria-hidden="true" /> Loading identity...</div> : <PlanetCanvas tier={tier} />}
            <BadgeCheck className="identity-a-mark" aria-hidden="true" />
          </div>

          <div className="identity-rank-col">
            <div className="xp-line"><Star aria-hidden="true" /><b>{rankState.xp.toLocaleString('en-US')} XP</b></div>
            <div className="bell-line"><Bell aria-hidden="true" /><span>8</span></div>
            <div className="rank-badge">
              <Shield aria-hidden="true" />
              <b>{rankState.rank}</b>
              <div><span style={{ width: `${rankState.progress}%` }} /></div>
              <small>{rankState.progress}% — {rankState.next}</small>
            </div>
          </div>
        </div>

        <div className="identity-stat-bars reveal-stagger">
          {statBars.map(([label, value, max, tone]) => (
            <div key={label} className={tone}>
              <span>{label}</span>
              <div><i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} /></div>
              <b>{Math.round(value)}/{max}</b>
            </div>
          ))}
        </div>

        <div className="identity-hub-icons reveal-stagger">
          {hubItems.map(([src, label]) => (
            <div key={label}>
              <img src={`/landing/hub/${src}`} alt="" />
              <b>{label}</b>
            </div>
          ))}
        </div>

        <div className="identity-reveal-row reveal">
          <button type="button" className="landing-btn ghost" onClick={() => setOpenCard(true)}>REVEAL FULL CARD <ArrowRight aria-hidden="true" /></button>
        </div>

        {openCard && (
          <div className="identity-modal" role="dialog" aria-modal="true" aria-label="Identity full card">
            <button type="button" className="identity-modal-backdrop" aria-label="Close full card" onClick={() => setOpenCard(false)} />
            <div className="identity-modal-card glass-card">
              <div className="identity-modal-main">
                <span>TIER LEVEL</span>
                <h3>{TIER_LABELS[tier]}</h3>
                <div className="identity-card-stage landing-card-modal">
                  <Suspense fallback={<div className="landing-skeleton"><Loader2 className="spin" aria-hidden="true" /></div>}>
                    <CelestialCard data={walletData} captureView="back" />
                  </Suspense>
                </div>
                <div className="identity-modal-badges">
                  {fullBadges.map(([src, label]) => (
                    <div key={src}><img src={`/landing/badges/${src}`} alt={label} /><b>{label}</b></div>
                  ))}
                </div>
              </div>
              <div className="identity-modal-actions">
                <a href={`https://x.com/intent/tweet?text=My%20Identity%20Prism%20tier%20is%20${encodeURIComponent(TIER_LABELS[tier])}`} target="_blank" rel="noreferrer" className="landing-btn ghost">SHARE ON X</a>
                <button type="button" className="landing-btn ghost" onClick={() => setOpenCard(false)}>BACK</button>
              </div>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </section>
  );
}

type RiskKind = 'clear' | 'warning' | 'high_risk';

type LandingSybilIndicator = {
  label: string;
  risk: 'low' | 'medium' | 'high';
  explanation: string;
};

function normalizeSybilResult(query: string, data: SybilResult): {
  kind: RiskKind;
  score: number;
  label: string;
  indicators: LandingSybilIndicator[];
} {
  const score = Math.max(0, Math.min(100, Number(data.riskScore ?? 0)));
  const kind: RiskKind = score >= 70 ? 'high_risk' : score >= 35 ? 'warning' : 'clear';
  const rawSignals = Array.isArray(data.signals) ? data.signals : [];
  const indicators = rawSignals.slice(0, 5).map((signal) => {
    const item = signal as Record<string, unknown>;
    const severity = String(item.severity ?? item.risk ?? 'low').toLowerCase();
    return {
      label: String(item.name ?? item.label ?? item.id ?? 'Risk signal'),
      risk: severity.includes('high') || severity.includes('danger') ? 'high' : severity.includes('medium') || severity.includes('warn') ? 'medium' : 'low',
      explanation: String(item.description ?? item.explanation ?? item.value ?? 'Signal returned by Sybil analysis.'),
    } satisfies LandingSybilIndicator;
  });

  return {
    kind,
    score,
    label:
      data.verdict && typeof data.verdict === 'object' && 'label' in data.verdict
        ? String((data.verdict as { label?: unknown }).label)
        : kind === 'high_risk'
          ? 'High risk cluster'
          : kind === 'warning'
            ? 'Needs review'
            : 'Likely human',
    indicators: indicators.length
      ? indicators
      : [
          {
            label: 'Analysis complete',
            risk: kind === 'clear' ? 'low' : kind === 'warning' ? 'medium' : 'high',
            explanation: `Sybil engine returned risk score for ${query}.`,
          },
        ],
  };
}

function SybilHuntFeature() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [loading, setLoading] = useState(false);
  const [risk, setRisk] = useState<ReturnType<typeof normalizeSybilResult> | null>(null);
  const [error, setError] = useState('');

  const submit = async (value = query) => {
    const target = value.trim();
    if (!target) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchSybilAnalysis(target);
      if (!data) throw new Error('No Sybil analysis returned');
      setSubmitted(target);
      setRisk(normalizeSybilResult(target, data));
    } catch (err) {
      console.error('[Landing Sybil] search failed', err);
      setRisk(null);
      setSubmitted('');
      setError('Sybil analysis failed. Check the address and try again.');
      toast.error('Sybil analysis failed. Try another address.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="section landing-section sybil-hunt-feature" data-section-id="sybil-hunt" id="sybil-hunt">
      <div className="landing-container">
        <div className="hunt-grid">
          <div className="reveal">
            <span className="detector-pill"><i /> Sybil Detector</span>
            <h2>Catch Sybils</h2>
            <p>Search a wallet, .skr name, or cluster hint. The landing preview mirrors the app logic with risk cards, indicators, and example targets.</p>
            <form className="hunt-search" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <label htmlFor="hunt-search">Wallet or name</label>
              <div>
                <input id="hunt-search" type="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="fenn.skr" />
                <button type="submit" aria-label="Search sybil target">{loading ? <Loader2 className="spin" /> : <Search />}</button>
              </div>
            </form>
            {error && <div className="hunt-error" role="alert">{error}</div>}
            {!risk && (
              <div className="examples">
                {['fenn.skr', 'FDpbCtY6S22L9PZ3oRDADpnQLhEAF8uP3meMtEMeLYqa'].map((item) => <button key={item} type="button" onClick={() => { setQuery(item); void submit(item); }}>{item}</button>)}
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
              {(risk?.indicators ?? []).map(({ risk: level, label, explanation }) => (
                <div key={label}><span className={level}>{level}</span><b>{label}</b><p>{explanation}</p></div>
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

  useEffect(() => {
    const id = window.location.hash.replace('#', '');
    if (!id) return;
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' }), 80);
    return () => window.clearTimeout(timer);
  }, []);

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
        <div className="landing-header-actions">
          <LandingWalletButton />
          <Link to="/app" className="landing-btn small">Launch App</Link>
        </div>
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
