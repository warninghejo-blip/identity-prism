import { Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Copy, Loader2, RefreshCw, Share2, Wallet } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@/lib/solanaToken';
import SiteHeader from '@/components/SiteHeader';
import { CelestialCard as WebCelestialCard } from '@/components/WebCelestialCard';
import { useWalletData, type PlanetTier, type WalletData, type WalletTraits } from '@/hooks/useWalletData';
import { useCompositeScore } from '@/hooks/useCompositeScore';
import { useWebComposite } from '@/hooks/useWebComposite';
import { TIER_LABELS, TIER_HEX, getCompositeTierFromScore } from '@/lib/constants/tierColors';
import { mintIdentityPrism, updateIdentityPrism } from '@/lib/mintIdentityPrism';
import { getPrismBalance } from '@/lib/prismCoin';
import { getHeliusRpcUrl, getHeliusProxyHeaders, SEEKER_TOKEN } from '@/constants';
import { fetchApiJson, getApiBase } from '@/components/prism/shared';
import { toast } from '@/components/ui/sonner';
import './apk-pages.css';

type PayCurrency = 'SOL' | 'SKR' | 'COINS';

// Rough percentile copy for the mint panel. Bucketed so it stays stable.
function percentileLabel(score: number): string {
  if (score >= 950) return 'Top 0.1% of holders';
  if (score >= 880) return 'Top 1% of holders';
  if (score >= 800) return 'Top 5% of holders';
  if (score >= 700) return 'Top 12% of holders';
  if (score >= 600) return 'Top 22% of holders';
  if (score >= 480) return 'Top 38% of holders';
  if (score >= 350) return 'Top 55% of holders';
  if (score >= 220) return 'Top 75% of holders';
  if (score > 0)    return 'Building reputation';
  return '—';
}

// PRISM (COINS) payment is a Seeker-only privilege — APK uses ApkIdentityHub.tsx
// which keeps all three options. Web users see only SOL + SKR.
const PAY_OPTIONS: Array<{ key: PayCurrency; label: string; iconUrl?: string; emoji?: string }> = [
  { key: 'SOL', label: 'SOL', iconUrl: '/landing/badges/sol.png' },
  { key: 'SKR', label: 'SKR', iconUrl: '/tokens/skr-icon.png' },
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
  // Web-only composite: depends on onchain + sybilTrust (games/social/engagement
  // are Seeker-only). Capped at 899 (= "sun" tier) for wallets without a Seeker
  // Genesis NFT — binary_sun is gated behind Seeker.
  // IMPORTANT: do NOT fall back to walletData.score (raw full composite) — the
  // card and the side menu must show the SAME number.
  const webComposite = useWebComposite(wallet.connected ? address : null);
  const liveScore = Math.round(webComposite.score || 0);
  const liveTier = (
    webComposite.tier
      ? getCompositeTierFromScore(liveScore, webComposite.tier)
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

        {!wallet.connected ? (
          /* Web /identity page is wallet-only — demo lives on / (Index.tsx).
             Show a clean connect prompt instead of a fake preview card. */
          <section className="identity-connect-gate">
            <div className="identity-connect-card">
              <Wallet size={42} aria-hidden="true" />
              <h2>Connect your wallet first</h2>
              <p>Identity Prism reads your wallet to build a sybil-resistant identity passport. Demo and tier preview live on the home page.</p>
              <div className="identity-connect-hint">
                <Wallet size={16} aria-hidden="true" />
                Use the <strong>Connect Wallet</strong> button in the top-right menu.
              </div>
              <Link to="/" className="identity-connect-demo">See the demo card on home →</Link>
            </div>
          </section>
        ) : (
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
                compositeOverride={undefined}
              />
            </Suspense>
          </div>

          <aside className="mint-card-v2">
            {/* Top row: address + status pill */}
            <div className="mc-top-row">
              <button
                type="button"
                className="mc-addr-pill"
                onClick={() => navigator.clipboard?.writeText(address)}
                title="Copy address"
              >
                <span>{shortAddress(address)}</span>
                <Copy size={11} aria-hidden="true" />
              </button>
              <span className={`mc-pill ${readyToMint ? 'ready' : 'pending'}`}>
                <i />
                {walletData.isLoading ? 'LOADING' : readyToMint ? 'MINT READY' : 'PENDING'}
              </span>
            </div>

            {/* Score row */}
            <div className="mc-score-row">
              <div
                className="mc-ring"
                style={{ '--mc-c': TIER_HEX[liveTier] || '#22d3ee' } as CSSProperties}
              >
                <svg viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="6" />
                  <circle
                    cx="50" cy="50" r="42" fill="none"
                    stroke="var(--mc-c)" strokeWidth="6" strokeLinecap="round"
                    strokeDasharray="263"
                    strokeDashoffset={263 - Math.round((Math.max(0, Math.min(1000, liveScore)) / 1000) * 263)}
                    style={{ filter: 'drop-shadow(0 0 10px var(--mc-c))' }}
                  />
                </svg>
                <div className="mc-ring-label">
                  <div className="mc-ring-score">{liveScore || '—'}</div>
                  <div className="mc-ring-max">/ 1000</div>
                </div>
              </div>
              <div className="mc-score-meta">
                <div className="mc-label">IDENTITY SCORE</div>
                <div className="mc-percentile">{percentileLabel(liveScore)}</div>
                <div className="mc-tier">
                  Tier · <span style={{ color: TIER_HEX[liveTier] || '#22d3ee' }}>{tierLabel}</span>
                </div>
              </div>
            </div>

            {/* Card status row */}
            <div className="mc-card-row">
              <div>
                <div className="mc-label">CARD</div>
                <strong>Live Wallet</strong>
              </div>
              <span className="mc-pill synced"><i />SYNCED</span>
            </div>

            {/* Pay with */}
            <div className="mc-paywith">
              <div className="mc-label">PAY WITH</div>
              <div className="mc-pay-grid">
                {PAY_OPTIONS.map((opt) => {
                  const active = payWith === opt.key;
                  const amount = opt.key === 'SOL'
                    ? `${balances.SOL == null ? '—' : balances.SOL.toFixed(3)} SOL`
                    : `${balances.SKR == null ? '—' : Math.floor(balances.SKR).toLocaleString()} SKR`;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      className={`mc-pay-chip${active ? ' active' : ''}`}
                      onClick={() => setPayWith(opt.key)}
                      aria-pressed={active}
                    >
                      <span className="mc-pay-name">{opt.label}</span>
                      <span className="mc-pay-amount">{amount}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Big MINT IDENTITY button */}
            <button
              type="button"
              className="mc-mint"
              onClick={handleMint}
              disabled={minting || updating || !readyToMint}
            >
              <span className="mc-mint-l">
                {minting ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <BadgeCheck size={18} aria-hidden="true" />}
                {minting ? 'MINTING' : 'MINT IDENTITY'}
              </span>
              <span className="mc-mint-r">{activePaymentAmount}</span>
            </button>

            {/* 3 secondary buttons */}
            <div className="mc-actions">
              {canUpdateIdentity && (
                <button type="button" className="mc-act" onClick={handleUpdate} disabled={updating || minting}>
                  {updating ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
                  <span>UPDATE</span>
                </button>
              )}
              <button type="button" className="mc-act" onClick={() => setVisible(true)}>
                <Wallet size={18} aria-hidden="true" />
                <span>WALLET</span>
              </button>
              <Link to="/blackhole" className="mc-act">
                <Share2 size={18} aria-hidden="true" />
                <span>SHARE</span>
              </Link>
            </div>
          </aside>
        </section>
        )}
      </main>
    </div>
  );
}
