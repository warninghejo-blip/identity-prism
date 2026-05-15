import { Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Loader2, Share2, Shield, Wallet } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import SiteHeader from '@/components/SiteHeader';
import { CelestialCard } from '@/components/CelestialCard';
import { useWalletData, type PlanetTier, type WalletData, type WalletTraits } from '@/hooks/useWalletData';
import { useCompositeScore } from '@/hooks/useCompositeScore';
import { TIER_LABELS } from '@/lib/constants/tierColors';
import { mintIdentityPrism } from '@/lib/mintIdentityPrism';
import { toast } from '@/components/ui/sonner';
import './apk-pages.css';

const demoAddress = '11111111111111111111111111111111';

function buildPreviewTraits(tier: PlanetTier): WalletTraits {
  return {
    hasSeeker: true,
    hasPreorder: true,
    hasCombo: false,
    isOG: true,
    isWhale: false,
    isCollector: true,
    isEarlyAdopter: true,
    isTxTitan: true,
    isSolanaMaxi: false,
    isBlueChip: true,
    isDeFiKing: true,
    uniqueTokenCount: 38,
    nftCount: 9,
    txCount: 760,
    memeCoinsHeld: [],
    isMemeLord: false,
    hyperactiveDegen: false,
    diamondHands: true,
    avgTxPerDay30d: 3.2,
    daysSinceLastTx: 1,
    solBalance: 4.7,
    solBonusApplied: 0,
    walletAgeDays: 640,
    walletAgeBonus: 0,
    planetTier: tier,
    totalAssetsCount: 47,
    solTier: 'dolphin',
    totalValueUSD: 12800,
    cosmicRank: 'supernova',
  };
}

function shortAddress(address: string) {
  return address ? `${address.slice(0, 4)}...${address.slice(-4)}` : 'Not connected';
}

export default function IdentityHub() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const address = wallet.publicKey?.toBase58() ?? '';
  const walletData = useWalletData(wallet.connected ? address : undefined);
  const composite = useCompositeScore(wallet.connected ? address : null);
  const [minting, setMinting] = useState(false);

  const liveTraits = walletData.traits;
  const liveScore = Math.round(composite.score || walletData.score || 0);
  const liveTier = (composite.tier || liveTraits?.planetTier || 'uranus') as PlanetTier;
  const previewTraits = useMemo(() => buildPreviewTraits('saturn'), []);
  const cardData: WalletData = wallet.connected && liveTraits
    ? { ...walletData, score: liveScore, traits: { ...liveTraits, planetTier: liveTier }, address }
    : { address: demoAddress, score: 900, traits: previewTraits, isLoading: false, error: null };

  const readyToMint = Boolean(wallet.connected && address && liveTraits && !walletData.isLoading && !minting);
  const tierLabel = TIER_LABELS[(cardData.traits?.planetTier || 'saturn') as PlanetTier];

  const handleMint = async () => {
    if (!wallet.connected) {
      setVisible(true);
      return;
    }
    if (!readyToMint || !liveTraits) {
      toast.info('Identity is loading', { description: 'Wait for wallet traits before minting.' });
      return;
    }
    setMinting(true);
    try {
      const result = await mintIdentityPrism({
        wallet,
        address,
        traits: liveTraits,
        score: liveScore,
        paymentToken: 'SOL',
      });
      toast.success('Identity minted', {
        description: `${result.mint.slice(0, 4)}...${result.mint.slice(-4)}`,
      });
    } catch (error) {
      toast.error('Mint failed', {
        description: error instanceof Error ? error.message : 'Try again in a moment.',
      });
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="identity-web-page identity-card-web-page">
      <SiteHeader />
      <main className="identity-card-web-shell">
        <div className="identity-card-web-toolbar">
          <Link to="/" className="identity-card-web-back">
            <ArrowLeft size={18} aria-hidden="true" />
            Back
          </Link>
          <div>
            <span>Identity Prism</span>
            <h1>Identity Passport</h1>
          </div>
        </div>

        <section className="identity-card-web-stage card-stage controls-closed">
          <div className="identity-card-web-card">
            <Suspense
              fallback={
                <div className="identity-card-web-loading">
                  <Loader2 className="animate-spin" size={26} aria-hidden="true" />
                  Loading Identity
                </div>
              }
            >
              <CelestialCard data={cardData} />
            </Suspense>
          </div>

          <aside className="identity-card-web-mint mint-panel open">
            <div className="mint-panel-content identity-card-web-mint-inner">
              <div className="identity-card-web-status">
                <div>
                  <span>{wallet.connected ? shortAddress(address) : 'Preview mode'}</span>
                  <strong>{wallet.connected ? liveScore || 'Loading' : 'Connect wallet'}</strong>
                </div>
                <Shield size={22} aria-hidden="true" />
              </div>

              <div className="identity-card-web-readout">
                <div>
                  <span>Tier</span>
                  <b>{tierLabel}</b>
                </div>
                <div>
                  <span>Card</span>
                  <b>{wallet.connected ? 'Live wallet' : 'Demo preview'}</b>
                </div>
                <div>
                  <span>Mint</span>
                  <b>{readyToMint ? 'Ready' : wallet.connected ? 'Loading' : 'Connect'}</b>
                </div>
              </div>

              <button
                type="button"
                className="mint-primary-btn identity-card-web-mint-btn"
                onClick={handleMint}
                disabled={wallet.connected && !readyToMint}
              >
                {minting ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <BadgeCheck size={18} aria-hidden="true" />}
                {minting ? 'MINTING' : wallet.connected ? 'MINT IDENTITY' : 'CONNECT WALLET'}
              </button>

              <button type="button" className="mint-secondary-btn identity-card-web-secondary" onClick={() => setVisible(true)}>
                <Wallet size={16} aria-hidden="true" />
                WALLET
              </button>

              <Link to="/blackhole" className="mint-share-btn identity-card-web-secondary">
                <Share2 size={16} aria-hidden="true" />
                BLACK HOLE
              </Link>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
