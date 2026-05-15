import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronRight, Shield, Wallet, X } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import SiteHeader from '@/components/SiteHeader';
import { useWalletData } from '@/hooks/useWalletData';
import { useCompositeScore } from '@/hooks/useCompositeScore';
import { TIER_LABELS } from '@/lib/constants/tierColors';
import { gatherXPSourcesMerged, computeRangerXP, getRangerRank, getRankProgress } from '@/lib/rangerRanks';
import type { PlanetTier } from '@/hooks/useWalletData';
import './apk-pages.css';

const Planet3D = lazy(() => import('@/components/Planet3D').then((module) => ({ default: module.Planet3D })));

const fallbackBreakdown = {
  onchain: 317,
  sybilTrust: 158,
  humanProof: 103,
  social: 20,
  engagement: 32,
};

const statMeta = [
  ['onchain', 'ON-CHAIN', 400, '#22d3ee'],
  ['sybilTrust', 'TRUST', 250, '#a78bfa'],
  ['humanProof', 'GAMES', 150, '#34d399'],
  ['social', 'SOCIAL', 100, '#ef4444'],
  ['engagement', 'ENGAGE', 100, '#e879f9'],
] as const;

const hubItems = [
  ['League', '/game', '/landing/hub/league.png'],
  ['Sybil Hunt', '/sybil-hunt', '/landing/hub/scanner.png'],
  ['Arena', '/arena', '/landing/hub/arena.png'],
  ['Black Hole', '/blackhole', '/landing/hub/blackhole.png'],
  ['Shop', '/forge', '/landing/hub/shop.png'],
  ['Leaderboard', '/leaderboard', '/landing/hub/leaderboard.png'],
  ['Quests', '/quests', '/landing/hub/quests.png'],
  ['Vault', '/vault', '/landing/hub/vault.png'],
] as const;

const badges = [
  ['early_adopter.png', 'EARLY BIRD'],
  ['verified_human.png', 'VERIFIED HUMAN'],
  ['game_master.png', 'GAME MASTER'],
  ['explorer.png', 'EXPLORER'],
  ['veteran.png', 'VETERAN'],
] as const;

function truncateAddress(address: string, chars = 4) {
  return address.length <= chars * 2 + 3 ? address : `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(score / 1000, 1));
  return (
    <div className="score-ring" aria-label={`Composite score ${score}`}>
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <circle cx="90" cy="90" r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="10" />
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke="#4ee5d5"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
        />
      </svg>
      <strong>{score}</strong>
    </div>
  );
}

function IdentityPlanet({ tier }: { tier: PlanetTier }) {
  return (
    <div className="identity-planet" aria-label={`${TIER_LABELS[tier]} planet`}>
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

export default function IdentityHub() {
  const { connected, publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? '';
  const walletData = useWalletData(connected ? address : undefined);
  const composite = useCompositeScore(connected ? address : null);
  const [cardOpen, setCardOpen] = useState(false);
  const [tab, setTab] = useState<'BADGES' | 'DOSSIER' | 'STATS'>('BADGES');
  const [xp, setXp] = useState(300);
  const [rankLabel, setRankLabel] = useState('Cadet');
  const [nextRank, setNextRank] = useState('Pilot');
  const [rankPct, setRankPct] = useState(30);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    gatherXPSourcesMerged(address).then((sources) => {
      if (cancelled) return;
      const nextXp = computeRangerXP(sources);
      const rank = getRangerRank(nextXp);
      const progress = getRankProgress(nextXp);
      setXp(nextXp || 300);
      setRankLabel(rank.name);
      setNextRank(progress.nextRank?.name ?? 'Pilot');
      setRankPct(Math.round(progress.progressPct || 30));
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (!cardOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCardOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cardOpen]);

  const score = Math.round(composite.score || walletData.score || 630);
  const tier = ((composite.tier || walletData.traits?.planetTier || 'uranus') as PlanetTier);
  const breakdown = composite.hasComposite ? composite.breakdown : fallbackBreakdown;
  const coins = useMemo(() => Math.max(95_362, xp * 12 + score * 81), [score, xp]);

  if (!connected) {
    return (
      <div className="apk-page">
        <SiteHeader />
        <main className="apk-main">
          <section className="apk-panel identity-empty">
            <Wallet size={56} color="#4ee5d5" aria-hidden="true" />
            <h1 className="apk-title">Identity Hub</h1>
            <p className="apk-muted">Connect Wallet to view your Identity, score bars, hub modules, and full Data Prism card.</p>
            <WalletMultiButton />
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="apk-page">
      <SiteHeader />
      <main className="apk-main">
        <section className="apk-panel identity-hero">
          <div>
            <ScoreRing score={score} />
            <p className="apk-muted" style={{ fontFamily: 'monospace', marginTop: 16 }}>{truncateAddress(address)}</p>
          </div>
          <div>
            <div className="apk-kicker" style={{ color: '#4ee5d5' }}>Tier level</div>
            <h1 className="identity-tier">{TIER_LABELS[tier]}</h1>
            <IdentityPlanet tier={tier} />
          </div>
          <div className="identity-coins">
            <div className="identity-bell"><Bell aria-hidden="true" /><span>9</span></div>
            <div>⊕ {coins.toLocaleString('en-US')}</div>
          </div>

          <div className="stat-bars">
            {statMeta.map(([key, label, max, tone]) => {
              const value = Math.round(Number(breakdown[key] ?? 0));
              return (
                <div className="stat-bar" key={key} style={{ '--tone': tone } as React.CSSProperties}>
                  <div className="stat-bar__top" style={{ color: tone }}>
                    <span>{label}</span><span>{value}/{max}</span>
                  </div>
                  <div className="stat-bar__track"><span style={{ '--pct': `${Math.min(100, (value / max) * 100)}%` } as React.CSSProperties} /></div>
                </div>
              );
            })}
          </div>

          <div className="rank-row">
            <strong>{rankLabel}</strong>
            <div className="limit-track"><span style={{ '--pct': `${rankPct}%` } as React.CSSProperties} /></div>
            <span className="apk-muted">{xp.toLocaleString('en-US')} XP → {nextRank}</span>
          </div>

          <button type="button" className="reveal-card-button" onClick={() => setCardOpen(true)}>
            Reveal full card <ChevronRight size={18} aria-hidden="true" />
          </button>
        </section>

        <section className="hub-grid" aria-label="Identity modules">
          {hubItems.map(([label, href, src]) => (
            <Link className="hub-tile" to={href} key={label}>
              <img src={src} alt="" />
              <span>{label}</span>
            </Link>
          ))}
        </section>

        <section className="apk-panel daily-limits">
          <strong>DAILY LIMITS</strong>
          <div><b>GAMES 0/2,000</b><div className="limit-track"><span style={{ '--pct': '0%' } as React.CSSProperties} /></div></div>
          <div><b>POOL 10/1,500</b><div className="limit-track"><span style={{ '--pct': '1%' } as React.CSSProperties} /></div></div>
          <Shield color="#4ee5d5" aria-hidden="true" />
        </section>
      </main>

      {cardOpen && (
        <div className="identity-modal" role="dialog" aria-modal="true" aria-label="Data Prism card">
          <div className="apk-panel identity-modal__card">
            <button type="button" className="apk-secondary-button" onClick={() => setCardOpen(false)} style={{ float: 'right' }}>
              <X size={16} aria-hidden="true" /> Back
            </button>
            <div className="dossier-grid">
              <div>
                <div className="apk-kicker" style={{ color: '#4ee5d5' }}>Data Prism</div>
                <ScoreRing score={score} />
                <p className="apk-muted">{Math.max(0, 700 - score)} pts to SATURN</p>
                <p style={{ fontFamily: 'monospace' }}>{truncateAddress(address)}</p>
              </div>
              <div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                  {(['BADGES', 'DOSSIER', 'STATS'] as const).map((item) => (
                    <button key={item} type="button" className={tab === item ? 'apk-primary-button' : 'apk-secondary-button'} onClick={() => setTab(item)}>
                      {item}
                    </button>
                  ))}
                </div>
                {tab === 'BADGES' && (
                  <div className="hub-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginTop: 0 }}>
                    {badges.map(([src, label]) => <div key={src} style={{ textAlign: 'center' }}><img src={`/landing/badges/${src}`} alt={label} style={{ width: '100%' }} /><b>{label}</b></div>)}
                  </div>
                )}
                {tab === 'DOSSIER' && (
                  <div className="checklist">
                    {statMeta.map(([key, label, max, tone]) => <li key={key}><b style={{ color: tone }}>{label}</b> {Math.round(Number(breakdown[key] ?? 0))}/{max}</li>)}
                    <li><b>PROGRESSION</b> {rankLabel} {xp.toLocaleString('en-US')} XP</li>
                    <li><b>COSMIC INSIGHT</b> You remember when SOL was single digits.</li>
                  </div>
                )}
                {tab === 'STATS' && <pre style={{ whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,.72)' }}>{JSON.stringify(composite.details ?? walletData.traits ?? {}, null, 2)}</pre>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
