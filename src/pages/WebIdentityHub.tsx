import { Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Loader2, RefreshCw, Share2, Shield, Wallet } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@/lib/solanaToken';
import SiteHeader from '@/components/SiteHeader';
import { CelestialCard as WebCelestialCard } from '@/components/WebCelestialCard';
import { useWalletData, type PlanetTier, type WalletData, type WalletTraits } from '@/hooks/useWalletData';
import { useCompositeScore } from '@/hooks/useCompositeScore';
import { TIER_LABELS, getCompositeTierFromScore } from '@/lib/constants/tierColors';
import { mintIdentityPrism, updateIdentityPrism } from '@/lib/mintIdentityPrism';
import { getPrismBalance } from '@/lib/prismCoin';
import { getHeliusRpcUrl, getHeliusProxyHeaders, SEEKER_TOKEN } from '@/constants';
import { fetchApiJson, getApiBase } from '@/components/prism/shared';
import { toast } from '@/components/ui/sonner';
import './apk-pages.css';

type PayCurrency = 'SOL' | 'SKR' | 'COINS';

const PAY_OPTIONS: Array<{ key: PayCurrency; label: string; iconUrl?: string; emoji?: string }> = [
  { key: 'SOL', label: 'SOL', iconUrl: '/landing/badges/sol.png' },
  { key: 'SKR', label: 'SKR', iconUrl: '/tokens/skr-icon.png' },
  { key: 'COINS', label: 'PRISM', iconUrl: '/tokens/prism-icon.png' },
];

const demoAddress = '11111111111111111111111111111111';
const demoScore = 750;

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

export default function WebIdentityHub() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const address = wallet.publicKey?.toBase58() ?? '';
  const walletData = useWalletData(wallet.connected ? address : undefined);
  const composite = useCompositeScore(wallet.connected ? address : null);
  const [minting, setMinting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [hasIdentityPrism, setHasIdentityPrism] = useState(false);
  const [payWith, setPayWith] = useState<PayCurrency>('SOL');
  const [balances, setBalances] = useState<{ SOL: number | null; SKR: number | null; COINS: number | null }>({
    SOL: null,
    SKR: null,
    COINS: null,
  });

  // Fetch balances for the connected wallet (SOL, SKR, PRISM).
  useEffect(() => {
    let cancelled = false;
    if (!wallet.connected || !address) {
      setBalances({ SOL: null, SKR: null, COINS: null });
      return;
    }
    (async () => {
      try {
        const rpc = getHeliusRpcUrl(address);
        if (rpc) {
          const conn = new Connection(rpc, { commitment: 'confirmed', httpHeaders: getHeliusProxyHeaders(address) });
          const owner = new PublicKey(address);
          const lamports = await conn.getBalance(owner).catch(() => 0);
          if (!cancelled) setBalances((b) => ({ ...b, SOL: lamports / 1e9 }));
          // SKR — try both token programs
          let skr = 0;
          const skrMint = new PublicKey(SEEKER_TOKEN.MINT);
          for (const progId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
            try {
              const ata = await getAssociatedTokenAddress(skrMint, owner, false, progId);
              const info = await conn.getTokenAccountBalance(ata);
              skr = Number(info.value.uiAmount ?? 0);
              break;
            } catch { /* try next */ }
          }
          if (!cancelled) setBalances((b) => ({ ...b, SKR: skr }));
        }
        const coins = await getPrismBalance(address).catch(() => null);
        if (!cancelled && coins) setBalances((b) => ({ ...b, COINS: coins.balance ?? 0 }));
      } catch (e) {
        console.warn('[identity-hub] balance fetch failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [wallet.connected, address]);

  useEffect(() => {
    let cancelled = false;
    if (!wallet.connected || !address) {
      setHasIdentityPrism(false);
      return;
    }
    (async () => {
      try {
        const perks = await fetchApiJson<{ hasIdentityPrism?: boolean }>(
          `${getApiBase()}/api/identity/perks?address=${encodeURIComponent(address)}`,
          { timeoutMs: 8_000 },
        );
        if (!cancelled) setHasIdentityPrism(Boolean(perks?.hasIdentityPrism));
      } catch (e) {
        console.warn('[identity-hub] identity status fetch failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [wallet.connected, address]);

  const liveTraits = walletData.traits;
  const liveScore = Math.round(composite.score || walletData.score || 0);
  const liveTier = (
    composite.hasComposite
      ? getCompositeTierFromScore(liveScore, composite.tier)
      : getCompositeTierFromScore(liveScore, liveTraits?.planetTier || 'uranus')
  ) as PlanetTier;
  const previewTraits = useMemo(() => buildPreviewTraits('saturn'), []);
  const previewComposite = useMemo(
    () => ({
      score: demoScore,
      tier: 'saturn' as PlanetTier,
      breakdown: {
        onchain: 300,
        sybilTrust: 188,
        humanProof: 112,
        social: 75,
        engagement: 75,
      },
      details: null,
    }),
    [],
  );
  const isLiveCard = Boolean(wallet.connected && liveTraits);
  const cardData: WalletData = wallet.connected && liveTraits
    ? { ...walletData, score: liveScore, traits: { ...liveTraits, planetTier: liveTier }, address }
    : { address: demoAddress, score: demoScore, traits: previewTraits, isLoading: false, error: null };

  const readyToMint = Boolean(wallet.connected && address && liveTraits && !walletData.isLoading && !minting && !updating);
  const readyToUpdate = Boolean(
    wallet.connected && address && liveTraits && !walletData.isLoading && !minting && !updating,
  );
  const canUpdateIdentity = Boolean(hasIdentityPrism || walletData.isMinted);
  const tierLabel = TIER_LABELS[(cardData.traits?.planetTier || 'saturn') as PlanetTier];
  const activePaymentAmount =
    payWith === 'SOL'
      ? `${balances.SOL == null ? '—' : balances.SOL.toFixed(3)} SOL`
      : payWith === 'SKR'
        ? `${balances.SKR == null ? '—' : Math.floor(balances.SKR).toLocaleString()} SKR`
        : `${balances.COINS == null ? '—' : Math.floor(balances.COINS).toLocaleString()} PRISM`;

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
      const paymentToken: 'SOL' | 'SKR' = payWith === 'SKR' ? 'SKR' : 'SOL';
      const paidWithCoins = payWith === 'COINS';
      const result = await mintIdentityPrism({
        wallet,
        address,
        traits: liveTraits,
        score: liveScore,
        paymentToken,
        paidWithCoins,
      });
      toast.success('Identity minted', {
        description: `${result.mint.slice(0, 4)}...${result.mint.slice(-4)}`,
      });
      setHasIdentityPrism(true);
      getPrismBalance(address)
        .then((coins) => setBalances((b) => ({ ...b, COINS: coins.balance ?? b.COINS })))
        .catch(() => {});
    } catch (error) {
      toast.error('Mint failed', {
        description: error instanceof Error ? error.message : 'Try again in a moment.',
      });
    } finally {
      setMinting(false);
    }
  };

  const handleUpdate = async () => {
    if (!wallet.connected) {
      setVisible(true);
      return;
    }
    if (!readyToUpdate || !liveTraits) {
      toast.info('Identity is loading', { description: 'Wait for wallet traits before updating.' });
      return;
    }
    setUpdating(true);
    try {
      const result = await updateIdentityPrism({
        wallet,
        address,
        traits: liveTraits,
        score: liveScore,
      });
      setHasIdentityPrism(true);
      toast.success('Card updated', {
        description: `${result.assetId.slice(0, 4)}...${result.assetId.slice(-4)}`,
      });
    } catch (error) {
      toast.error('Update failed', {
        description: error instanceof Error ? error.message : 'Try again in a moment.',
      });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="identity-web-page identity-card-web-page">
      <SiteHeader />
      <main className="identity-card-web-shell">
        <div className="identity-card-web-toolbar">
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
              <WebCelestialCard
                data={cardData}
                liveData={isLiveCard}
                compositeOverride={isLiveCard ? undefined : previewComposite}
              />
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

              {/* Pay-selector: pick currency for mint */}
              <div className="identity-pay-selector" role="group" aria-label="Select payment currency">
                {PAY_OPTIONS.map((opt) => {
                  const active = payWith === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      className={`identity-pay-chip${active ? ' active' : ''}`}
                      onClick={() => setPayWith(opt.key)}
                      aria-pressed={active}
                      aria-label={opt.label}
                      title={opt.label}
                    >
                      {opt.iconUrl ? (
                        <img
                          src={opt.iconUrl}
                          className="identity-pay-icon"
                          alt=""
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <span className="identity-pay-emoji" aria-hidden="true">{opt.emoji}</span>
                      )}
                      <span className="identity-pay-label">{opt.label}</span>
                    </button>
                  );
                })}
                <div className="identity-pay-price" aria-live="polite">
                  {activePaymentAmount}
                </div>
              </div>

              <button
                type="button"
                className="mint-primary-btn identity-card-web-mint-btn"
                onClick={handleMint}
                disabled={minting || updating}
              >
                {minting ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <BadgeCheck size={18} aria-hidden="true" />}
                {minting ? 'MINTING' : wallet.connected ? 'MINT IDENTITY' : 'CONNECT WALLET'}
              </button>

              {canUpdateIdentity ? (
                <button
                  type="button"
                  className="mint-secondary-btn identity-card-web-secondary"
                  onClick={handleUpdate}
                  disabled={updating || minting}
                >
                  {updating ? (
                    <Loader2 className="animate-spin" size={18} aria-hidden="true" />
                  ) : (
                    <RefreshCw size={18} aria-hidden="true" />
                  )}
                  {updating ? 'UPDATING' : 'UPDATE IDENTITY'}
                </button>
              ) : null}

              <button type="button" className="mint-secondary-btn identity-card-web-secondary" onClick={() => setVisible(true)}>
                <Wallet size={16} aria-hidden="true" />
                WALLET
              </button>

              <Link to="/blackhole" className="mint-share-btn identity-card-web-secondary">
                <Share2 size={16} aria-hidden="true" />
                SHARE / BLACK HOLE
              </Link>

            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
