import { Suspense, useMemo, useState, type CSSProperties } from 'react';
import { CelestialCard as WebCelestialCard } from '@/components/WebCelestialCard';
import type { PlanetTier, WalletData, WalletTraits } from '@/hooks/useWalletData';
import type { ScoreDetails } from '@/hooks/useCompositeScore';
import { TIER_HEX, TIER_LABELS } from '@/lib/constants/tierColors';

const DEMO_TIERS: PlanetTier[] = [
  'mercury',
  'mars',
  'venus',
  'earth',
  'neptune',
  'uranus',
  'saturn',
  'jupiter',
  'sun',
  'binary_sun',
];

type TierStyle = CSSProperties & { '--tier': string };

const DEMO_TIER_SCORES: Record<PlanetTier, number> = {
  mercury: 64,
  mars: 160,
  venus: 284,
  earth: 414,
  neptune: 540,
  uranus: 650,
  saturn: 750,
  jupiter: 840,
  sun: 910,
  binary_sun: 986,
};

const DEMO_BADGE_VARIANTS = [
  { age: 1180, sol: 12, nfts: 18, tx: 1840, defi: 4, trust: 96, games: 4, achievements: 18, gameScore: 72, wins: 7, reviews: 6, quests: 18, streak: 11, scans: 31 },
  { age: 430, sol: 4.7, nfts: 9, tx: 620, defi: 2, trust: 86, games: 2, achievements: 8, gameScore: 34, wins: 2, reviews: 8, quests: 12, streak: 5, scans: 22 },
  { age: 760, sol: 58, nfts: 23, tx: 1240, defi: 5, trust: 91, games: 3, achievements: 12, gameScore: 45, wins: 6, reviews: 3, quests: 9, streak: 8, scans: 16 },
  { age: 220, sol: 7.4, nfts: 14, tx: 900, defi: 3, trust: 78, games: 5, achievements: 20, gameScore: 81, wins: 4, reviews: 5, quests: 16, streak: 9, scans: 26 },
];

function buildCompositeBreakdown(score: number) {
  const onchain = Math.min(Math.round(score * 0.4), 400);
  const sybilTrust = Math.min(Math.round(score * 0.25), 250);
  const humanProof = Math.min(Math.round(score * 0.15), 150);
  const social = Math.min(Math.round(score * 0.1), 100);
  const engagement = Math.min(Math.max(0, score - onchain - sybilTrust - humanProof - social), 100);
  return { onchain, sybilTrust, humanProof, social, engagement };
}

function buildDemoScoreDetails(score: number, variantIndex: number): ScoreDetails {
  const profile = DEMO_BADGE_VARIANTS[variantIndex];
  return {
    onchain: {
      identityScore: Math.min(score, 400),
      identityMax: 400,
      basePts: Math.min(score, 360),
      badgeBonus: Math.max(0, Math.min(score, 400) - 360),
      hasSeeker: true,
      hasPreorder: true,
      hasCombo: score >= DEMO_TIER_SCORES.binary_sun,
    },
    sybilTrust: {
      trustScore: profile.trust,
      rawTrustScore: profile.trust,
      trustMax: 200,
      verdictLabel: profile.trust >= 90 ? 'Trusted' : 'Low risk',
    },
    humanProof: {
      gameScoreTotal: profile.gameScore,
      gameDiversity: profile.games,
      achievementPts: profile.achievements,
      achievementCount: profile.achievements,
      gameTypesCount: profile.games,
    },
    social: {
      challengesWon: profile.wins,
      challengesPlayed: profile.wins + 3,
      communityReviews: profile.reviews,
    },
    engagement: {
      questsCompleted: profile.quests,
      questPts: profile.quests,
      streakDays: profile.streak,
      streakPts: profile.streak,
      scanCount: profile.scans,
      scanPts: profile.scans,
    },
  };
}

function buildDemoTraits(tier: PlanetTier, variantIndex: number): WalletTraits {
  const profile = DEMO_BADGE_VARIANTS[variantIndex];
  const topTier = tier === 'jupiter' || tier === 'sun' || tier === 'binary_sun';
  return {
    hasSeeker: true,
    hasPreorder: variantIndex !== 1,
    hasCombo: tier === 'binary_sun' || variantIndex === 2,
    isOG: true,
    isWhale: topTier || profile.sol >= 50,
    isCollector: profile.nfts >= 10,
    isEarlyAdopter: true,
    isTxTitan: profile.tx > 1000,
    isSolanaMaxi: topTier,
    isBlueChip: true,
    isDeFiKing: profile.defi >= 3,
    uniqueTokenCount: 34 + variantIndex * 9,
    nftCount: profile.nfts,
    txCount: profile.tx,
    memeCoinsHeld: tier === 'binary_sun' ? ['BONK'] : [],
    isMemeLord: tier === 'binary_sun',
    hyperactiveDegen: tier === 'sun' || tier === 'binary_sun',
    diamondHands: variantIndex !== 1,
    avgTxPerDay30d: 3.2 + variantIndex,
    daysSinceLastTx: 1,
    solBalance: topTier ? Math.max(profile.sol, 18.4) : profile.sol,
    solBonusApplied: 0,
    walletAgeDays: profile.age,
    walletAgeBonus: 0,
    planetTier: tier,
    totalAssetsCount: profile.nfts + 42,
    solTier: topTier || profile.sol >= 50 ? 'whale' : 'dolphin',
    totalValueUSD: topTier ? 18800 : 4200 + variantIndex * 1350,
    cosmicRank: tier === 'binary_sun' || tier === 'sun' ? 'quasar' : 'supernova',
    swapCount: 24 + variantIndex * 16,
    nftTradeCount: Math.max(1, profile.nfts - 4),
    stakingCount: variantIndex + 2,
    defiProtocols: ['Jupiter', 'Kamino', 'Tensor', 'MarginFi', 'Drift'].slice(0, profile.defi),
    isDeFiUser: profile.defi > 0,
  };
}

export default function WebIdentityDemoCard() {
  const [activeTier, setActiveTier] = useState<PlanetTier>('uranus');
  const [demoVariant, setDemoVariant] = useState(0);
  const activeIndex = DEMO_TIERS.indexOf(activeTier);
  const activeScore = DEMO_TIER_SCORES[activeTier];
  const variantIndex = (activeIndex + demoVariant) % DEMO_BADGE_VARIANTS.length;
  const compositeDetails = useMemo(() => buildDemoScoreDetails(activeScore, variantIndex), [activeScore, variantIndex]);
  const compositeBreakdown = useMemo(() => buildCompositeBreakdown(activeScore), [activeScore]);

  const cardData = useMemo<WalletData>(
    () => ({
      address: '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN',
      score: activeScore,
      traits: buildDemoTraits(activeTier, variantIndex),
      isLoading: false,
      error: null,
    }),
    [activeScore, activeTier, variantIndex],
  );

  const selectTier = (tier: PlanetTier) => {
    setActiveTier(tier);
    setDemoVariant((value) => value + 1);
  };

  return (
    <div className="web-id-demo" style={{ '--tier': TIER_HEX[activeTier] } as TierStyle}>
      <div className="web-id-card-shell" aria-label={`${TIER_LABELS[activeTier]} demo identity card`}>
        <Suspense fallback={null}>
          <WebCelestialCard
            key={`${activeTier}-${demoVariant}`}
            data={cardData}
            staticFront
            liveData={false}
            compositeOverride={{
              score: activeScore,
              tier: activeTier,
              breakdown: compositeBreakdown,
              details: compositeDetails,
            }}
          />
        </Suspense>
      </div>

      <div className="web-id-tier-switcher" role="group" aria-label="Preview identity tier">
        {DEMO_TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            className={tier === activeTier ? 'active' : undefined}
            style={{ '--tier': TIER_HEX[tier] } as TierStyle}
            onClick={() => selectTier(tier)}
            aria-pressed={tier === activeTier}
            aria-label={`Show ${TIER_LABELS[tier]} identity card`}
            title={TIER_LABELS[tier]}
          >
            <img src={`/textures/tiers/${tier}.png`} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}
