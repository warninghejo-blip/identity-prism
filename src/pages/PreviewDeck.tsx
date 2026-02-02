import { Link, useParams } from "react-router-dom";
import { CelestialCard } from "@/components/CelestialCard";
import type { PlanetTier, WalletData, WalletTraits } from "@/hooks/useWalletData";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const PREVIEW_TIERS: PlanetTier[] = [
  "mercury",
  "mars",
  "venus",
  "earth",
  "neptune",
  "uranus",
  "saturn",
  "jupiter",
  "sun",
  "binary_sun",
];

const PREVIEW_SCORE: Record<PlanetTier, number> = {
  mercury: 50,
  mars: 150,
  venus: 300,
  earth: 450,
  neptune: 600,
  uranus: 760,
  saturn: 900,
  jupiter: 1000,
  sun: 1150,
  binary_sun: 1300,
};

function buildPreviewTraits(tier: PlanetTier): WalletTraits {
  const base: WalletTraits = {
    hasSeeker: tier !== "mercury",
    hasPreorder: tier === "sun" || tier === "binary_sun",
    hasCombo: tier === "binary_sun",
    isOG: tier !== "mercury",
    isWhale: tier === "sun" || tier === "binary_sun",
    isCollector: tier !== "mercury",
    isEarlyAdopter: tier === "sun" || tier === "binary_sun",
    isTxTitan: tier === "jupiter" || tier === "sun" || tier === "binary_sun",
    isSolanaMaxi: tier === "binary_sun",
    isBlueChip: tier === "jupiter" || tier === "sun" || tier === "binary_sun",
    isDeFiKing: tier === "saturn" || tier === "jupiter" || tier === "sun" || tier === "binary_sun",
    uniqueTokenCount: 40,
    nftCount: 12,
    txCount: 800,
    memeCoinsHeld: [],
    isMemeLord: tier === "venus" || tier === "earth",
    hyperactiveDegen: tier === "mars" || tier === "venus",
    diamondHands: tier === "sun" || tier === "binary_sun",
    avgTxPerDay30d: 3.4,
    daysSinceLastTx: 1,
    solBalance: tier === "binary_sun" ? 18 : tier === "sun" ? 12 : tier === "jupiter" ? 8 : 2.5,
    solBonusApplied: 0,
    walletAgeDays: tier === "binary_sun" ? 900 : tier === "sun" ? 700 : tier === "jupiter" ? 500 : 200,
    walletAgeBonus: 0,
    planetTier: tier,
    totalAssetsCount: 42,
    solTier:
      tier === "binary_sun" || tier === "sun"
        ? "whale"
        : tier === "jupiter"
          ? "dolphin"
          : "shrimp",
  };

  return base;
}

function buildPreviewWalletData(tier: PlanetTier): WalletData {
  return {
    address: `Preview-${tier}`,
    score: PREVIEW_SCORE[tier],
    traits: buildPreviewTraits(tier),
    isLoading: false,
    error: null,
  };
}

export default function PreviewDeck() {
  const { tier: tierParam } = useParams();
  const normalizedTier = tierParam?.toLowerCase().replace("-", "_");
  const activeTier = PREVIEW_TIERS.includes(normalizedTier as PlanetTier)
    ? (normalizedTier as PlanetTier)
    : null;

  return (
    <div className="identity-shell relative min-h-screen overflow-y-auto">
      <div className="absolute inset-0 bg-[#050505] background-base fixed" />
      <div className="nebula-layer nebula-one fixed" />
      <div className="nebula-layer nebula-two fixed" />
      <div className="identity-gradient fixed" />

      <div className="relative z-10 w-full px-6 pt-12 pb-32">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-12">
            <Link to="/">
              <Button variant="ghost" className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/30">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Scanner
              </Button>
            </Link>
            <div className="text-center">
              <p className="text-xs tracking-[0.4em] uppercase text-cyan-200/60">System Preview</p>
              <h2 className="text-3xl font-black text-white mt-1">
                {activeTier ? `${activeTier.replace("_", " ")} Tier` : "Celestial Tier Deck"}
              </h2>
            </div>
            <div className="w-[100px]" />
          </div>

          {activeTier ? (
            <div className="flex flex-col items-center gap-6">
              <span className="text-[10px] uppercase tracking-widest text-white/30 border border-white/10 px-3 py-1 rounded-full bg-black/40">
                {activeTier.replace("_", " ")}
              </span>
              <div className="w-full max-w-md">
                <CelestialCard data={buildPreviewWalletData(activeTier)} />
              </div>
              <Link to="/preview">
                <Button variant="outline" className="border-white/15 text-white/80 hover:text-white hover:bg-white/5">
                  View All Tiers
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {PREVIEW_TIERS.map((tier) => (
                <div key={tier} className="flex flex-col items-center gap-3">
                  <span className="text-[10px] uppercase tracking-widest text-white/30 border border-white/10 px-2 py-1 rounded-full bg-black/40">
                    {tier.replace("_", " ")}
                  </span>
                  <Link to={`/preview/${tier}`} className="w-full flex justify-center">
                    <CelestialCard data={buildPreviewWalletData(tier)} />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
