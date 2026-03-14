/**
 * Prism Shop — unified shop.
 * Tabs: Shop (buy items with Coins) | Equipped (loadout)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
import { trackForgePurchase } from '@/lib/analytics';
import {
  ArrowLeft, ShoppingBag, Check, Lock, Sparkles, Coins,
  Loader2, AlertTriangle, Plus, Shield, Clock, TrendingUp, Zap,
} from 'lucide-react';
import PageShell from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  ALL_FORGE_ITEMS,
  RARITY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  getLocalLoadout,
  saveLocalLoadout,
  purchaseItem,
  equipItem,
  unequipItem,
  getItemById,
  FRAME_STYLES,
  MICROMODULE_DEFS,
  MODULE_TIER_COLORS,
  installModule,
  uninstallModule,
  getItemModules,
  getModuleById,
  type ForgeCategory,
  type ForgeItem,
  type ForgeLoadout,
  type Micromodule,
} from '@/lib/forgeItems';
import { computeShipStats, type ShipStats } from '@/lib/shipStats';
import { fetchWalletPreview, type WalletPreview } from '@/components/prism/shared';
import { getPrismBalance, spendPrism, COIN_PACKAGES, type PrismBalance } from '@/lib/prismCoin';
import { getHeliusProxyUrl } from '@/constants';

type TopTab = 'shop' | 'equipped' | 'hangar';
type ShopFilter = ForgeCategory | 'all' | 'modules';

function getApiBase(): string {
  const proxy = getHeliusProxyUrl();
  if (proxy) return proxy;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}


// ── Stat thresholds: milestones with gameplay effects ──
const STAT_THRESHOLDS: Record<string, { at: number; label: string; effect: string; color: string }[]> = {
  speed: [
    { at: 25, label: 'Agile', effect: '+10% move speed', color: '#67e8f9' },
    { at: 50, label: 'Swift', effect: '+20% evasion', color: '#22d3ee' },
    { at: 75, label: 'Hyperdrive', effect: '+35% speed + afterburner', color: '#06b6d4' },
  ],
  shield: [
    { at: 25, label: 'Armored', effect: '+1 hit point', color: '#93c5fd' },
    { at: 50, label: 'Fortified', effect: '+2 HP + regen', color: '#3b82f6' },
    { at: 75, label: 'Invincible', effect: '+3 HP + auto-shield', color: '#2563eb' },
  ],
  firepower: [
    { at: 25, label: 'Armed', effect: '+15% damage', color: '#fca5a5' },
    { at: 50, label: 'Deadly', effect: '+30% damage + spread', color: '#ef4444' },
    { at: 75, label: 'Devastator', effect: '+50% damage + piercing', color: '#dc2626' },
  ],
  luck: [
    { at: 25, label: 'Lucky', effect: '+15% coin drops', color: '#fde68a' },
    { at: 50, label: 'Blessed', effect: '+30% drops + rare items', color: '#fbbf24' },
    { at: 75, label: 'Fated', effect: '+50% drops + crits', color: '#f59e0b' },
  ],
};

const SHOP_FILTERS: { id: ShopFilter; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: '🛒' },
  { id: 'frame', label: 'Frames', icon: CATEGORY_ICONS.frame },
  { id: 'aura', label: 'Auras', icon: CATEGORY_ICONS.aura },
  { id: 'ship_skin', label: 'Ships', icon: CATEGORY_ICONS.ship_skin },
  { id: 'title', label: 'Titles', icon: CATEGORY_ICONS.title },
  { id: 'modules', label: 'Modules', icon: '🔧' },
];

// ── Visual Preview Renderers ──

const AURA_STYLES: Record<string, { color: string; shadow: string }> = {
  frost: { color: '#67e8f9', shadow: '0 0 20px rgba(103,232,249,0.5), 0 0 40px rgba(103,232,249,0.2)' },
  ember: { color: '#fb923c', shadow: '0 0 20px rgba(251,146,60,0.5), 0 0 40px rgba(239,68,68,0.2)' },
  electric: { color: '#60a5fa', shadow: '0 0 15px rgba(96,165,250,0.6), 0 0 30px rgba(59,130,246,0.3), 0 0 45px rgba(96,165,250,0.15)' },
  plasma: { color: '#c084fc', shadow: '0 0 20px rgba(192,132,252,0.5), 0 0 45px rgba(168,85,247,0.25)' },
  dark_matter: { color: '#1e1b4b', shadow: '0 0 25px rgba(100,0,200,0.4), 0 0 50px rgba(0,0,50,0.3)' },
  binary_pulse: { color: '#22d3ee', shadow: '0 0 20px rgba(34,211,238,0.5), 0 0 40px rgba(251,191,36,0.3)' },
};


function ItemPreview({ item }: { item: ForgeItem }) {
  const rarityColor = RARITY_COLORS[item.rarity];

  if (item.category === 'frame') {
    const frameStyle = FRAME_STYLES[item.id] || {};
    return (
      <div className="w-full h-28 rounded-lg flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}>
        {/* Outer border = frame gradient */}
        <div style={{
          padding: 4,
          borderRadius: 10,
          background: frameStyle.gradient || 'transparent',
          boxShadow: frameStyle.boxShadow || 'none',
          animation: frameStyle.animation || undefined,
        }}>
          {/* Inner mini card */}
          <div style={{
            background: 'linear-gradient(135deg, #0a1020, #0d1428)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 6,
            width: 56, height: 76, borderRadius: 7,
          }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: `radial-gradient(circle, ${rarityColor}60, ${rarityColor}20)`, marginBottom: 4 }} />
            <div style={{ width: 28, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.15)', marginBottom: 2 }} />
            <div style={{ width: 20, height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.08)' }} />
          </div>
        </div>
      </div>
    );
  }

  if (item.category === 'aura') {
    const aura = AURA_STYLES[item.preview] || { color: rarityColor, shadow: `0 0 20px ${rarityColor}50` };
    return (
      <div className="w-full h-28 rounded-lg flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}>
        {/* Mini identity card with aura glow applied */}
        <div style={{
          width: 52, height: 72, borderRadius: 6,
          background: 'linear-gradient(135deg, #0a1020, #0d1428)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: aura.shadow,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 6,
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Aura glow overlay */}
          <div style={{
            position: 'absolute', inset: -4, borderRadius: 10,
            background: `radial-gradient(ellipse at 50% 30%, ${aura.color}20, transparent 70%)`,
            pointerEvents: 'none',
          }} />
          <div style={{ width: 18, height: 18, borderRadius: '50%', background: `radial-gradient(circle, ${aura.color}50, ${aura.color}15)`, marginBottom: 4, zIndex: 1 }} />
          <div style={{ width: 26, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.15)', marginBottom: 2, zIndex: 1 }} />
          <div style={{ width: 18, height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.08)', zIndex: 1 }} />
        </div>
        <div className="absolute bottom-1 text-center" style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)' }}>Card glow</div>
      </div>
    );
  }

  if (item.category === 'ship_skin') {
    return (
      <div className="w-full h-28 rounded-lg flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}>
        <img
          src={`/textures/ships/ship_${item.preview}.png`}
          alt={item.name}
          style={{
            width: 48, height: 64, objectFit: 'contain',
            filter: `drop-shadow(0 0 8px ${rarityColor}40)`,
          }}
        />
      </div>
    );
  }

  // Title — show on mini card where it will appear (under username)
  return (
    <div className="w-full h-28 rounded-lg flex items-center justify-center"
      style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}>
      <div style={{
        width: 64, height: 78, borderRadius: 6,
        background: 'linear-gradient(135deg, #0a1020, #0d1428)',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 4px',
      }}>
        {/* Mini avatar */}
        <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', marginBottom: 4 }} />
        {/* Username placeholder */}
        <div style={{ width: 32, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.15)', marginBottom: 3 }} />
        {/* Title badge - this is where it shows */}
        <div style={{
          padding: '2px 8px', borderRadius: 6,
          background: `${rarityColor}15`, border: `1px solid ${rarityColor}30`,
        }}>
          <span style={{ fontSize: 7, fontWeight: 800, color: rarityColor, textShadow: `0 0 8px ${rarityColor}40` }}>
            {item.preview}
          </span>
        </div>
        {/* Score placeholder */}
        <div style={{ width: 24, height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.06)', marginTop: 4 }} />
      </div>
    </div>
  );
}

// ── Shop Item Card (AAA) ──
function ItemCard({
  item, owned, equipped, canAfford, onPurchase, onEquip,
}: {
  item: ForgeItem; owned: boolean; equipped: boolean; canAfford: boolean;
  onPurchase: () => void; onEquip: () => void;
}) {
  const rarityColor = RARITY_COLORS[item.rarity];
  return (
    <div
      className="relative rounded-2xl p-[1px] transition-all duration-500 hover:scale-[1.03] group"
      style={{
        background: equipped
          ? `linear-gradient(135deg, ${rarityColor}60, ${rarityColor}20, ${rarityColor}40)`
          : owned
            ? `linear-gradient(135deg, ${rarityColor}30, transparent, ${rarityColor}15)`
            : 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
      }}
    >
      <div className="rounded-2xl p-3.5 h-full" style={{
        background: 'linear-gradient(135deg, rgba(8,10,18,0.95), rgba(5,7,12,0.98))',
        boxShadow: equipped ? `0 0 30px ${rarityColor}15, inset 0 0 30px ${rarityColor}05` : 'none',
      }}>
        {/* Rarity + Category header */}
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[8px] font-black uppercase tracking-[0.15em] px-2 py-1 rounded-md"
            style={{
              color: rarityColor,
              background: `${rarityColor}10`,
              border: `1px solid ${rarityColor}20`,
              textShadow: `0 0 8px ${rarityColor}30`,
            }}>
            {item.rarity}
          </span>
          <span className="text-sm opacity-60">{CATEGORY_ICONS[item.category]}</span>
        </div>

        {/* Preview */}
        <div className="mb-3 rounded-xl overflow-hidden" style={{
          boxShadow: `inset 0 0 20px ${rarityColor}08`,
        }}>
          <ItemPreview item={item} />
        </div>

        {/* Info */}
        <h3 className="text-white font-bold text-[13px] mb-0.5 leading-tight">{item.name}</h3>
        <p className="text-white/25 text-[10px] mb-3 leading-relaxed line-clamp-2">{item.description}</p>

        {item.unlockCondition && !owned && (
          <div className="flex items-center gap-1.5 text-amber-400/50 text-[10px] mb-3 px-2 py-1.5 rounded-lg bg-amber-500/[0.04] border border-amber-500/10">
            <Lock className="w-3 h-3" /> {item.unlockCondition}
          </div>
        )}

        {/* Action */}
        {equipped ? (
          <div className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold" style={{
            color: '#4ade80',
            background: 'rgba(74,222,128,0.06)',
            border: '1px solid rgba(74,222,128,0.15)',
          }}>
            <Check className="w-4 h-4" /> Equipped
          </div>
        ) : owned ? (
          <button
            onClick={onEquip}
            className="w-full py-2 rounded-xl text-xs font-bold transition-all duration-300 hover:brightness-110"
            style={{
              background: `linear-gradient(135deg, ${rarityColor}, ${rarityColor}cc)`,
              color: '#000',
              boxShadow: `0 4px 15px ${rarityColor}30`,
            }}
          >
            Equip
          </button>
        ) : (
          <button
            disabled={!canAfford || Boolean(item.unlockCondition)}
            onClick={onPurchase}
            className="w-full py-2 rounded-xl text-xs font-bold transition-all duration-300 flex items-center justify-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
            style={canAfford && !item.unlockCondition ? {
              background: `linear-gradient(135deg, ${rarityColor}, ${rarityColor}cc)`,
              color: '#000',
              boxShadow: `0 4px 15px ${rarityColor}25`,
            } : {
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.25)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {item.unlockCondition ? <><Lock className="w-3 h-3" /> Locked</> : <><Coins className="w-3 h-3" /> {item.price}</>}
          </button>
        )}
      </div>
    </div>
  );
}


// COIN_PACKAGES imported from prismCoin.ts

function BuyCoinsSection({ walletAddress, onPurchased }: { walletAddress: string; onPurchased: () => void }) {
  const wallet = useWallet();
  const [buyingIdx, setBuyingIdx] = useState<number | null>(null);
  const [status, setStatus] = useState<{ purchasedToday: number; remainingToday: number } | null>(null);

  useEffect(() => {
    if (!walletAddress) return;
    const base = getApiBase();
    fetch(`${base}/api/prism/buy/status?address=${walletAddress}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStatus(d); })
      .catch(() => {});
  }, [walletAddress]);

  const handleBuy = useCallback(async (pkgIndex: number) => {
    if (buyingIdx !== null || !walletAddress || !wallet.publicKey || !wallet.signTransaction) return;
    const pkg = COIN_PACKAGES[pkgIndex];
    setBuyingIdx(pkgIndex);

    try {
      // 1. Send SOL to treasury
      const { Connection: SolConn, PublicKey: SolPK, SystemProgram: SolSP, Transaction: SolTx } = await import('@solana/web3.js');
      const base = getApiBase();
      const conn = new SolConn(base.replace(/\/+$/, '').replace('/api', '') + '/rpc', 'confirmed');
      const treasuryAddr = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
      const tx = new SolTx().add(
        SolSP.transfer({ fromPubkey: new SolPK(walletAddress), toPubkey: new SolPK(treasuryAddr), lamports: Math.floor(pkg.solPrice * 1e9) })
      );
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.feePayer = new SolPK(walletAddress);
      const signed = await wallet.signTransaction(tx);
      const sig = await conn.sendRawTransaction(signed.serialize());
      toast.info('Confirming transaction...');
      await conn.confirmTransaction(sig, 'confirmed');

      // 2. Get JWT
      const { getCachedJwt, obtainJwt } = await import('@/components/prism/shared');
      let jwt = getCachedJwt(walletAddress);
      if (!jwt) {
        jwt = await obtainJwt(wallet);
        if (!jwt) { toast.error('Authentication failed'); setBuyingIdx(null); return; }
      }

      // 3. POST to buy endpoint
      const res = await fetch(`${base}/api/prism/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ packageIndex: pkgIndex, txSignature: sig }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Purchased ${pkg.coins} Coins!`);
        if (status) setStatus({ ...status, purchasedToday: status.purchasedToday + pkg.coins, remainingToday: status.remainingToday - pkg.coins });
        onPurchased();
      } else {
        const err = await res.json().catch(() => ({ error: 'Purchase failed' }));
        toast.error(err.error || 'Purchase failed');
      }
    } catch (e: any) {
      if (e?.message?.includes('User rejected')) {
        toast.info('Transaction cancelled');
      } else {
        toast.error(e?.message || 'Purchase failed');
      }
    }
    setBuyingIdx(null);
  }, [walletAddress, wallet, buyingIdx, status, onPurchased]);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-amber-400" />
          Buy Coins
        </h3>
        {status && (
          <span className="text-[10px] text-white/20">
            {status.remainingToday.toLocaleString()} remaining today
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {COIN_PACKAGES.map((pkg, i) => (
          <button
            key={i}
            onClick={() => handleBuy(i)}
            disabled={buyingIdx !== null || !walletAddress}
            className="relative overflow-hidden rounded-xl bg-white/[0.04] border border-white/[0.08] p-3 text-left hover:bg-white/[0.07] hover:border-amber-400/20 transition-all duration-300 disabled:opacity-50"
          >
            <div className="text-[10px] text-amber-400/60 font-bold uppercase mb-1">{pkg.label}</div>
            <div className="flex items-center gap-1 mb-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5"/></svg>
              <span className="text-lg font-black text-white">{pkg.coins.toLocaleString()}</span>
            </div>
            <div className="text-[11px] font-bold text-purple-400">{pkg.solPrice} SOL</div>
            {buyingIdx === i && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-xl">
                <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Prism Vault (Staking) ──

const YIELD_BRACKETS = [
  { upTo: 5000,     baseDailyRate: 0.010 },
  { upTo: 20000,    baseDailyRate: 0.007 },
  { upTo: 50000,    baseDailyRate: 0.005 },
  { upTo: 100000,   baseDailyRate: 0.0035 },
  { upTo: Infinity, baseDailyRate: 0.002 },
];

function calcClientDailyYield(amount: number, tierMultiplier: number): number {
  let remaining = amount;
  let daily = 0;
  let prevUpTo = 0;
  for (const b of YIELD_BRACKETS) {
    const sliceMax = b.upTo - prevUpTo;
    const slice = Math.min(remaining, sliceMax);
    if (slice <= 0) break;
    daily += slice * b.baseDailyRate * tierMultiplier;
    remaining -= slice;
    prevUpTo = b.upTo;
  }
  return daily;
}

function rateRangeLabel(mult: number): string {
  const high = (YIELD_BRACKETS[0].baseDailyRate * mult * 100).toFixed(1);
  const low = (YIELD_BRACKETS[YIELD_BRACKETS.length - 1].baseDailyRate * mult * 100).toFixed(1);
  return `${high}–${low}%/day`;
}

const VAULT_TIERS = [
  {
    id: 'bronze',
    label: 'Bronze',
    min: 10000,
    lock: 7,
    rateMultiplier: 1.0,
    boost: 10,
    color: '#cd7f32',
    glow: 'rgba(205,127,50,0.25)',
    icon: '🥉',
  },
  {
    id: 'silver',
    label: 'Silver',
    min: 30000,
    lock: 30,
    rateMultiplier: 1.4,
    boost: 20,
    color: '#c0c0c0',
    glow: 'rgba(192,192,192,0.2)',
    icon: '🥈',
  },
  {
    id: 'gold',
    label: 'Gold',
    min: 75000,
    lock: 90,
    rateMultiplier: 2.0,
    boost: 35,
    color: '#fbbf24',
    glow: 'rgba(251,191,36,0.3)',
    icon: '🥇',
  },
] as const;

type VaultTierId = 'bronze' | 'silver' | 'gold';

interface VaultStatus {
  staked: boolean;
  tier?: VaultTierId;
  amount?: number;
  stakedAt?: number;
  lockDays?: number;
  unlocksAt?: number;
  unclaimedYield?: number;
  earlyUnstakePenalty?: number;
  dailyYield?: number;
  effectiveRate?: number;
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'Unlocked';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function PrismVaultSection({ walletAddress, balance, onBalanceChange }: {
  walletAddress: string;
  balance: number;
  onBalanceChange: () => void;
}) {
  const wallet = useWallet();
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [selectedTier, setSelectedTier] = useState<VaultTierId>('bronze');
  const [stakeAmount, setStakeAmount] = useState('');
  const [staking, setStaking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [unstaking, setUnstaking] = useState(false);
  const [showUnstakeWarning, setShowUnstakeWarning] = useState(false);

  const tier = VAULT_TIERS.find(t => t.id === selectedTier)!;

  // Fetch vault status
  useEffect(() => {
    if (!walletAddress) return;
    setLoadingStatus(true);
    const base = getApiBase();
    fetch(`${base}/api/prism/vault/status?address=${walletAddress}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.staking) {
          setVaultStatus({
            staked: true,
            tier: d.staking.tier,
            amount: d.staking.amount,
            unlocksAt: d.staking.lockEnd,
            unclaimedYield: d.unclaimedYield ?? 0,
            dailyYield: d.dailyYield ?? 0,
            effectiveRate: d.effectiveRate ?? 0,
          });
        } else {
          setVaultStatus({ staked: false });
        }
      })
      .catch(() => setVaultStatus({ staked: false }))
      .finally(() => setLoadingStatus(false));
  }, [walletAddress]);

  const getJwt = async () => {
    const { getCachedJwt, obtainJwt } = await import('@/components/prism/shared');
    let jwt = getCachedJwt(walletAddress);
    if (!jwt) jwt = await obtainJwt(wallet);
    return jwt;
  };

  const handleStake = useCallback(async () => {
    const amount = Number(stakeAmount);
    if (!amount || amount < tier.min) { toast.error(`Minimum stake is ${tier.min} coins for ${tier.label}`); return; }
    if (amount > balance) { toast.error('Insufficient balance'); return; }
    if (!walletAddress) { toast.error('Connect wallet first'); return; }
    setStaking(true);
    try {
      const jwt = await getJwt();
      if (!jwt) { toast.error('Authentication failed'); return; }
      const base = getApiBase();
      const res = await fetch(`${base}/api/prism/vault/stake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ amount, tier: selectedTier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stake failed');
      toast.success(`Staked ${amount} coins in ${tier.label} Vault!`);
      setVaultStatus(data.status || { staked: true, tier: selectedTier, amount });
      setStakeAmount('');
      onBalanceChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Stake failed');
    } finally { setStaking(false); }
  }, [stakeAmount, tier, balance, walletAddress, selectedTier, onBalanceChange, wallet]);

  const handleClaim = useCallback(async () => {
    if (!walletAddress) return;
    setClaiming(true);
    try {
      const jwt = await getJwt();
      if (!jwt) { toast.error('Authentication failed'); return; }
      const base = getApiBase();
      const res = await fetch(`${base}/api/prism/vault/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Claim failed');
      toast.success(`Claimed ${data.claimed ?? ''} coins!`);
      setVaultStatus(v => v ? { ...v, unclaimedYield: 0 } : v);
      onBalanceChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Claim failed');
    } finally { setClaiming(false); }
  }, [walletAddress, onBalanceChange, wallet]);

  const handleUnstake = useCallback(async () => {
    if (!walletAddress) return;
    setUnstaking(true);
    setShowUnstakeWarning(false);
    try {
      const jwt = await getJwt();
      if (!jwt) { toast.error('Authentication failed'); return; }
      const base = getApiBase();
      const res = await fetch(`${base}/api/prism/vault/unstake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unstake failed');
      toast.success(data.message || 'Unstaked successfully');
      setVaultStatus({ staked: false });
      onBalanceChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unstake failed');
    } finally { setUnstaking(false); }
  }, [walletAddress, onBalanceChange, wallet]);

  const stakedTierInfo = vaultStatus?.tier ? VAULT_TIERS.find(t => t.id === vaultStatus.tier) : null;
  const isLocked = vaultStatus?.unlocksAt ? Date.now() < vaultStatus.unlocksAt : false;
  const timeLeft = vaultStatus?.unlocksAt ? vaultStatus.unlocksAt - Date.now() : 0;
  const stakeAmountNum = Number(stakeAmount);
  const canStake = stakeAmountNum >= tier.min && stakeAmountNum <= balance && !staking;

  return (
    <div className="mb-6">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-amber-400" />
          Prism Vault — Staking
        </h3>
        <span className="text-[10px] text-white/20">Earn yield on your coins</span>
      </div>

      {loadingStatus ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-purple-400/40" />
        </div>
      ) : vaultStatus?.staked ? (
        /* ── Active Stake Card ── */
        <div className="rounded-2xl p-4 border" style={{
          background: `linear-gradient(135deg, ${stakedTierInfo?.color ?? '#fbbf24'}08, ${stakedTierInfo?.color ?? '#fbbf24'}03)`,
          borderColor: `${stakedTierInfo?.color ?? '#fbbf24'}25`,
          boxShadow: `0 0 30px ${stakedTierInfo?.glow ?? 'rgba(251,191,36,0.1)'}`,
        }}>
          {/* Tier badge + lock status */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{
                background: `${stakedTierInfo?.color ?? '#fbbf24'}15`,
                border: `1px solid ${stakedTierInfo?.color ?? '#fbbf24'}25`,
              }}>
                {stakedTierInfo?.icon ?? '🏆'}
              </div>
              <div>
                <p className="text-white font-bold text-sm">{stakedTierInfo?.label ?? vaultStatus.tier} Vault</p>
                <p className="text-white/30 text-[10px]">{vaultStatus.amount?.toLocaleString()} coins staked</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{
              background: isLocked ? 'rgba(239,68,68,0.08)' : 'rgba(74,222,128,0.08)',
              border: `1px solid ${isLocked ? 'rgba(239,68,68,0.2)' : 'rgba(74,222,128,0.2)'}`,
            }}>
              <Clock className="w-3 h-3" style={{ color: isLocked ? '#f87171' : '#4ade80' }} />
              <span className="text-[10px] font-bold" style={{ color: isLocked ? '#f87171' : '#4ade80' }}>
                {isLocked ? formatTimeLeft(timeLeft) : 'Unlocked'}
              </span>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <TrendingUp className="w-3.5 h-3.5 mx-auto mb-1" style={{ color: stakedTierInfo?.color ?? '#fbbf24' }} />
              <p className="text-white font-black text-sm">{vaultStatus.dailyYield ?? 0}</p>
              <p className="text-white/25 text-[9px]">coins/day</p>
            </div>
            <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <Coins className="w-3.5 h-3.5 mx-auto mb-1 text-amber-400" />
              <p className="text-white font-black text-sm">{Math.floor(vaultStatus.unclaimedYield ?? 0)}</p>
              <p className="text-white/25 text-[9px]">unclaimed</p>
            </div>
            <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <Zap className="w-3.5 h-3.5 mx-auto mb-1 text-purple-400" />
              <p className="text-white font-black text-sm">+{stakedTierInfo?.boost ?? 0}%</p>
              <p className="text-white/25 text-[9px]">boost</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              className="flex-1 h-10 text-xs font-bold"
              style={{
                background: `linear-gradient(135deg, ${stakedTierInfo?.color ?? '#fbbf24'}, ${stakedTierInfo?.color ?? '#fbbf24'}cc)`,
                color: '#000',
                boxShadow: `0 4px 15px ${stakedTierInfo?.glow ?? 'rgba(251,191,36,0.3)'}`,
              }}
              onClick={handleClaim}
              disabled={claiming || (vaultStatus.unclaimedYield ?? 0) < 1}
            >
              {claiming ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Coins className="w-3 h-3 mr-1" />}
              Claim Yield
            </Button>
            <Button
              variant="outline"
              className="h-10 px-4 text-xs font-bold border-red-500/20 text-red-400/70 hover:bg-red-500/10"
              onClick={() => {
                if (isLocked) setShowUnstakeWarning(true);
                else handleUnstake();
              }}
              disabled={unstaking}
            >
              {unstaking ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Unstake'}
            </Button>
          </div>

          {/* Early unstake warning */}
          {showUnstakeWarning && (
            <div className="mt-3 p-3 rounded-xl flex flex-col gap-2" style={{
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
            }}>
              <div className="flex items-center gap-2 text-red-400 text-xs font-bold">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                25% penalty will be burned on early unstake
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 h-8 text-[10px] border-white/10 text-white/40" onClick={() => setShowUnstakeWarning(false)}>Cancel</Button>
                <Button size="sm" className="flex-1 h-8 text-[10px] bg-red-600 hover:bg-red-500 text-white" onClick={handleUnstake} disabled={unstaking}>
                  {unstaking ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm Unstake'}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Stake UI ── */
        <div>
          {/* Tier cards */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {VAULT_TIERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTier(t.id)}
                className="rounded-xl p-3 text-left transition-all duration-300 hover:scale-[1.02]"
                style={{
                  background: selectedTier === t.id
                    ? `linear-gradient(135deg, ${t.color}18, ${t.color}08)`
                    : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${selectedTier === t.id ? t.color + '35' : 'rgba(255,255,255,0.06)'}`,
                  boxShadow: selectedTier === t.id ? `0 0 20px ${t.glow}` : 'none',
                }}
              >
                <div className="text-xl mb-1.5">{t.icon}</div>
                <p className="text-white font-bold text-xs mb-1" style={{ color: selectedTier === t.id ? t.color : 'rgba(255,255,255,0.7)' }}>{t.label}</p>
                <div className="space-y-0.5">
                  <p className="text-[9px]" style={{ color: selectedTier === t.id ? t.color + 'cc' : 'rgba(255,255,255,0.25)' }}>Min: {t.min.toLocaleString()}</p>
                  <p className="text-[9px]" style={{ color: selectedTier === t.id ? t.color + 'cc' : 'rgba(255,255,255,0.25)' }}>{t.lock}d lock</p>
                  <p className="text-[9px] font-bold" style={{ color: selectedTier === t.id ? t.color : 'rgba(255,255,255,0.3)' }}>{rateRangeLabel(t.rateMultiplier)}</p>
                  <p className="text-[9px]" style={{ color: selectedTier === t.id ? '#c084fc' : 'rgba(192,132,252,0.4)' }}>+{t.boost}% boost</p>
                </div>
              </button>
            ))}
          </div>

          {/* Amount input */}
          <div className="relative mb-3">
            <input
              type="number"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              placeholder={`Stake amount (min ${tier.min.toLocaleString()})`}
              min={tier.min}
              max={balance}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40 pr-20"
              style={{ fontSize: 16 }}
            />
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold px-2 py-1 rounded-lg"
              style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
              onClick={() => setStakeAmount(String(balance))}
            >MAX</button>
          </div>

          {/* Projected yield info */}
          {stakeAmountNum >= tier.min && (
            <div className="mb-3 px-3 py-2 rounded-xl flex items-center justify-between" style={{
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <span className="text-[10px] text-white/30">Est. daily yield</span>
              <span className="text-[10px] font-bold" style={{ color: tier.color }}>
                +{calcClientDailyYield(stakeAmountNum, tier.rateMultiplier).toFixed(1)} coins/day
              </span>
            </div>
          )}

          {/* Stake button */}
          <Button
            className="w-full h-12 font-bold text-sm"
            style={canStake ? {
              background: `linear-gradient(135deg, ${tier.color}, ${tier.color}cc)`,
              color: '#000',
              boxShadow: `0 4px 20px ${tier.glow}`,
            } : {
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.25)',
            }}
            onClick={handleStake}
            disabled={!canStake || staking}
          >
            {staking
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Staking...</>
              : <><Shield className="w-4 h-4 mr-2" /> Stake {stakeAmountNum >= tier.min ? stakeAmountNum.toLocaleString() : ''} coins</>
            }
          </Button>
          {stakeAmountNum > 0 && stakeAmountNum < tier.min && (
            <p className="text-red-400/60 text-[10px] mt-2 text-center">Minimum for {tier.label} is {tier.min.toLocaleString()} coins</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──
export default function StellarForge() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const address = searchParams.get('address');
  const { publicKey } = useWallet();
  const walletAddress = address || publicKey?.toBase58() || '';

  useEffect(() => { fadeOutTransition(); }, []);

  const [walletPreview, setWalletPreview] = useState<WalletPreview | null>(null);
  useEffect(() => {
    if (!walletAddress) { setWalletPreview(null); return; }
    fetchWalletPreview(walletAddress).then(setWalletPreview);
  }, [walletAddress]);

  const [topTab, setTopTab] = useState<TopTab>('shop');
  const [shopFilter, setShopFilter] = useState<ShopFilter>('all');
  const [balance, setBalance] = useState<PrismBalance | null>(null);
  const [loadout, setLoadout] = useState<ForgeLoadout | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [moduleModal, setModuleModal] = useState<{ itemId: string; item: ForgeItem } | null>(null);
  const [confirmModule, setConfirmModule] = useState<{ itemId: string; mod: Micromodule } | null>(null);
  const [installingModule, setInstallingModule] = useState(false);
  const [hasIdentityCard, setHasIdentityCard] = useState(false);
  const [moduleInstallTarget, setModuleInstallTarget] = useState<Micromodule | null>(null);

  // Load data
  useEffect(() => {
    if (!walletAddress) return;
    getPrismBalance(walletAddress).then(setBalance);
    setLoadout(getLocalLoadout(walletAddress));
    // Check identity card status
    const base = getApiBase();
    fetch(`${base}/api/identity/status?address=${walletAddress}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.hasCard) setHasIdentityCard(true); })
      .catch(() => {});
  }, [walletAddress]);

  // Shop logic
  const filteredItems = useMemo(() => {
    if (shopFilter === 'modules') return []; // modules rendered separately
    if (shopFilter === 'all') return ALL_FORGE_ITEMS;
    return ALL_FORGE_ITEMS.filter((i) => i.category === shopFilter);
  }, [shopFilter]);

  const handlePurchase = useCallback(async (item: ForgeItem) => {
    if (!walletAddress || !loadout || !balance) return;
    if (purchasing) return; // prevent double-click
    if (item.unlockCondition) {
      toast.error('This item is still locked');
      return;
    }
    if (balance.balance < item.price) { toast.error('Not enough Coins'); return; }
    setPurchasing(item.id);
    try {
      const result = await spendPrism(walletAddress, `forge_${item.category}` as any, item.price, `Purchased ${item.name}`);
      if (!result) { toast.error('Purchase failed'); return; }
      const newLoadout = purchaseItem(loadout, item.id, balance.balance);
      if (!newLoadout) { toast.error('Purchase failed — insufficient Coins or invalid item'); return; }
      saveLocalLoadout(newLoadout);
      setLoadout(newLoadout);
      setBalance(result.balance);
      trackForgePurchase(item.name, item.price);
      toast.success(`Acquired ${item.name}!`, { description: `−${item.price} Coins` });
      import('@/lib/prismQuests').then(({ getQuestState, incrementQuest }) => {
        const qs = getQuestState(walletAddress);
        const onComplete = (q: { name: string }) => toast.success(`Quest completed: ${q.name}!`, { duration: 4000 });
        incrementQuest(qs, 'weekly_forge', 1, onComplete);
        incrementQuest(qs, 'ot_forge5', 1, onComplete);
      }).catch(() => {});
    } catch {
      toast.error('Purchase failed');
    } finally {
      setPurchasing(null);
    }
  }, [walletAddress, loadout, balance, purchasing]);

  const handleEquip = useCallback((item: ForgeItem) => {
    if (!loadout) return;
    const newLoadout = equipItem(loadout, item.id);
    saveLocalLoadout(newLoadout);
    setLoadout(newLoadout);
    toast.success(`Equipped ${item.name}`, {
      action: { label: 'View Card', onClick: () => navigate('/') },
    });
  }, [loadout, navigate]);

  const handleUnequip = useCallback((category: ForgeCategory) => {
    if (!loadout) return;
    const newLoadout = unequipItem(loadout, category);
    saveLocalLoadout(newLoadout);
    setLoadout(newLoadout);
    const labels: Record<ForgeCategory, string> = { frame: 'Frame', aura: 'Aura', ship_skin: 'Ship Skin', title: 'Title' };
    toast.success(`Unequipped ${labels[category]}`);
  }, [loadout]);

  const handleInstallModule = useCallback(async (itemId: string, moduleId: string) => {
    if (!loadout || !balance || !walletAddress || installingModule) return;
    const mod = getModuleById(moduleId);
    if (!mod) return;
    if (balance.balance < mod.price) { toast.error('Not enough Coins'); return; }
    setInstallingModule(true);
    try {
      const result = await spendPrism(walletAddress, 'forge_module', mod.price, `Module: ${mod.name}`);
      if (!result) { toast.error('Purchase failed'); return; }
      const newLoadout = installModule(loadout, itemId, moduleId, hasIdentityCard);
      if (!newLoadout) { toast.error('Cannot install module — check slot limits or identity card requirement'); return; }
      saveLocalLoadout(newLoadout);
      setLoadout(newLoadout);
      setBalance(result.balance);
      setConfirmModule(null);
      setModuleModal(null);
      toast.success(`Installed ${mod.name}!`, { description: 'This upgrade is permanent.' });
    } catch {
      toast.error('Install failed');
    } finally {
      setInstallingModule(false);
    }
  }, [loadout, balance, walletAddress, installingModule, hasIdentityCard]);

  const isOwned = useCallback((id: string) => loadout?.ownedItems.some((o) => o.itemId === id) ?? false, [loadout]);
  const isEquipped = useCallback((id: string) => {
    if (!loadout) return false;
    return loadout.equippedFrame === id || loadout.equippedAura === id ||
           loadout.equippedShipSkin === id || loadout.equippedTitle === id;
  }, [loadout]);

  // Equipped items for loadout tab
  const equippedItems = useMemo(() => {
    if (!loadout) return [];
    const ids = [loadout.equippedFrame, loadout.equippedAura, loadout.equippedShipSkin, loadout.equippedTitle].filter(Boolean) as string[];
    return ids.map(id => getItemById(id)).filter(Boolean) as ForgeItem[];
  }, [loadout]);

  return (
    <PageShell className="text-white">
      <div className="min-h-screen flex flex-col">
      {/* ── Ambient background effects ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {/* Floating orb 1 */}
        <div className="absolute w-[500px] h-[500px] rounded-full opacity-[0.04]" style={{
          top: '-10%', left: '-10%',
          background: 'radial-gradient(circle, #a855f7, transparent 70%)',
          animation: 'forge-float-1 20s ease-in-out infinite',
        }} />
        {/* Floating orb 2 */}
        <div className="absolute w-[400px] h-[400px] rounded-full opacity-[0.03]" style={{
          bottom: '-5%', right: '-10%',
          background: 'radial-gradient(circle, #ec4899, transparent 70%)',
          animation: 'forge-float-2 25s ease-in-out infinite',
        }} />
        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: `linear-gradient(rgba(168,85,247,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.3) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }} />
      </div>

      {/* ── Header ── */}
      <header className="flex-none sticky top-0 z-20" style={{
        background: 'linear-gradient(180deg, rgba(5,7,10,0.95) 0%, rgba(10,14,26,0.85) 100%)',
        backdropFilter: 'blur(20px) saturate(1.5)',
        borderBottom: '1px solid rgba(168,85,247,0.08)',
      }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => { startFadeTransition(() => goBack(navigate)); }} className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.08] transition-all border border-white/[0.06]">
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </button>
          <div className="flex-1">
            <h1 className="text-base font-black tracking-tight" style={{
              background: 'linear-gradient(135deg, #c084fc 0%, #f472b6 40%, #fbbf24 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>Prism Shop</h1>
            <p className="text-[9px] text-white/20 font-medium tracking-widest uppercase">Customize Your Identity</p>
          </div>
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-amber-500/15" style={{
            background: 'linear-gradient(135deg, rgba(251,191,36,0.08), rgba(245,158,11,0.04))',
          }}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              boxShadow: '0 0 12px rgba(251,191,36,0.3)',
            }}>
              <Coins className="w-3 h-3 text-black" />
            </div>
            <span className="text-amber-300 font-black font-mono text-sm">{balance?.balance ?? 0}</span>
          </div>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <div className="flex-none z-10 relative" style={{
        background: 'rgba(5,7,10,0.6)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div className="max-w-2xl mx-auto px-3 flex gap-1 py-1.5">
          {([
            { id: 'shop' as TopTab, label: 'Armory', icon: '🛡️' },
            { id: 'equipped' as TopTab, label: 'Loadout', icon: '⚔️' },
            { id: 'hangar' as TopTab, label: 'Hangar', icon: '🚀' },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTopTab(t.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all duration-300"
              style={topTab === t.id ? {
                background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(236,72,153,0.1))',
                color: '#c084fc',
                boxShadow: '0 0 20px rgba(168,85,247,0.1), inset 0 0 20px rgba(168,85,247,0.05)',
                border: '1px solid rgba(168,85,247,0.2)',
              } : {
                color: 'rgba(255,255,255,0.3)',
                border: '1px solid transparent',
              }}
            >
              <span className="text-sm">{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <main className="flex-1 overflow-y-auto max-w-2xl mx-auto w-full px-4 py-5 pb-24 relative z-10">
        {!walletAddress && (
          <div className="text-center py-16 space-y-3">
            <div className="text-4xl">🔗</div>
            <p className="text-white/50 text-sm">Connect your wallet to access the Forge</p>
          </div>
        )}

        {/* ═══ ARMORY TAB ═══ */}
        {walletAddress && topTab === 'shop' && (
          <>
            {/* Buy Coins & Staking → moved to /vault page */}

            {/* Category filters — glass pills */}
            <div className="flex gap-2 mb-5 overflow-x-auto scrollbar-hide pb-1">
              {SHOP_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setShopFilter(f.id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all duration-300"
                  style={shopFilter === f.id ? {
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(139,92,246,0.15))',
                    color: '#c084fc',
                    border: '1px solid rgba(168,85,247,0.3)',
                    boxShadow: '0 0 15px rgba(168,85,247,0.15)',
                  } : {
                    background: 'rgba(255,255,255,0.03)',
                    color: 'rgba(255,255,255,0.35)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <span>{f.icon}</span> {f.label}
                </button>
              ))}
            </div>

            {/* Hint: how to earn coins */}
            {balance && balance.balance === 0 && (
              <button
                onClick={() => navigate('/vault')}
                className="w-full mb-4 px-4 py-2.5 rounded-xl text-[11px] text-amber-300/60 bg-amber-500/[0.06] border border-amber-500/10 hover:bg-amber-500/10 transition-colors text-left"
              >
                💡 Earn Coins by playing games, completing quests, or <span className="underline">buy in the Vault</span>
              </button>
            )}

            {/* Items grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  owned={isOwned(item.id)}
                  equipped={isEquipped(item.id)}
                  canAfford={(balance?.balance ?? 0) >= item.price}
                  onPurchase={() => handlePurchase(item)}
                  onEquip={() => handleEquip(item)}
                />
              ))}
            </div>
            {filteredItems.length === 0 && shopFilter !== 'modules' && (
              <div className="text-center py-24">
                <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{
                  background: 'linear-gradient(135deg, rgba(168,85,247,0.1), rgba(139,92,246,0.05))',
                  border: '1px solid rgba(168,85,247,0.1)',
                }}>
                  <ShoppingBag className="w-7 h-7 text-purple-400/30" />
                </div>
                <p className="text-white/20 text-sm font-medium">No items in this category</p>
              </div>
            )}

            {/* ── Modules Grid ── */}
            {shopFilter === 'modules' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {MICROMODULE_DEFS.map((mod) => {
                  const tierColor = MODULE_TIER_COLORS[mod.tier];
                  return (
                    <div key={mod.id} className="rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-all duration-300">
                      <div className="p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xl">{mod.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-white/90 truncate">{mod.name}</div>
                            <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: tierColor }}>{mod.tier} tier</div>
                          </div>
                        </div>
                        <p className="text-[10px] text-white/40 mb-2">{mod.description}</p>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-bold text-green-400">+{mod.statBonus.value} {mod.statBonus.stat}</span>
                          {mod.tradeoff && <span className="text-[10px] font-bold text-red-400/60">-{mod.tradeoff.value} {mod.tradeoff.stat}</span>}
                        </div>
                        <button
                          onClick={() => setModuleInstallTarget(mod)}
                          disabled={!walletAddress || !balance || balance.balance < mod.price}
                          className="w-full py-1.5 rounded-lg text-[10px] font-bold transition-all duration-300"
                          style={{
                            background: balance && balance.balance >= mod.price
                              ? `linear-gradient(135deg, ${tierColor}30, ${tierColor}15)`
                              : 'rgba(255,255,255,0.04)',
                            color: balance && balance.balance >= mod.price ? tierColor : 'rgba(255,255,255,0.25)',
                            border: `1px solid ${balance && balance.balance >= mod.price ? `${tierColor}40` : 'rgba(255,255,255,0.06)'}`,
                          }}
                        >
                          <Coins className="w-3 h-3 inline mr-1" /> {mod.price.toLocaleString()}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Module Install Target Modal — pick item to install on */}
            {moduleInstallTarget && (
              <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setModuleInstallTarget(null)}>
                <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-sm font-bold text-white mb-1">Install {moduleInstallTarget.name}</h3>
                  <p className="text-[10px] text-white/40 mb-3">Select an owned item to install this module on:</p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {loadout?.ownedItems
                      .map(o => getItemById(o.itemId))
                      .filter((item): item is ForgeItem => item != null && moduleInstallTarget.compatibleCategories.includes(item.category))
                      .map(item => {
                        const currentMods = loadout ? (loadout.installedModules[item.id] || []) : [];
                        const maxSlots = item.maxModuleSlots ?? 3;
                        const isFull = currentMods.length >= maxSlots;
                        const alreadyHas = currentMods.includes(moduleInstallTarget.id);
                        const needsCard = item.category === 'ship_skin' && !hasIdentityCard;
                        const disabled = isFull || alreadyHas || needsCard;
                        return (
                          <button
                            key={item.id}
                            disabled={disabled}
                            onClick={() => {
                              setModuleInstallTarget(null);
                              setConfirmModule({ itemId: item.id, mod: moduleInstallTarget });
                            }}
                            className="w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all duration-200 text-left"
                            style={{
                              background: disabled ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
                              borderColor: disabled ? 'rgba(255,255,255,0.04)' : 'rgba(168,85,247,0.2)',
                              opacity: disabled ? 0.4 : 1,
                            }}
                          >
                            <span className="text-sm">{CATEGORY_ICONS[item.category]}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-bold text-white/80 truncate">{item.name}</div>
                              <div className="text-[9px] text-white/30">
                                Slots: {currentMods.map(() => '■').join('')}{Array(maxSlots - currentMods.length).fill('□').join('')}
                                {' '}({currentMods.length}/{maxSlots})
                                {needsCard && ' — Identity Card required'}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                  <button onClick={() => setModuleInstallTarget(null)} className="w-full mt-3 py-2 rounded-lg text-xs font-bold text-white/40 bg-white/5 hover:bg-white/10 transition-colors">Cancel</button>
                </div>
              </div>
            )}
          </>
        )}


        {/* ═══ LOADOUT TAB ═══ */}
        {walletAddress && topTab === 'equipped' && (
          <>
            <p className="text-white/25 text-xs mb-5 font-medium">Your current loadout. Tap an item to change or unequip.</p>

            {/* Loadout slots — premium cards */}
            {(['frame', 'aura', 'ship_skin', 'title'] as ForgeCategory[]).map((cat) => {
              const equippedId = loadout ? (cat === 'frame' ? loadout.equippedFrame : cat === 'aura' ? loadout.equippedAura : cat === 'ship_skin' ? loadout.equippedShipSkin : loadout.equippedTitle) : null;
              const equippedItem = equippedId ? getItemById(equippedId) : null;
              const ownedInCat = loadout ? ALL_FORGE_ITEMS.filter(i => i.category === cat && loadout.ownedItems.some(o => o.itemId === i.id)) : [];
              const rarityColor = equippedItem ? RARITY_COLORS[equippedItem.rarity] : '#6b7280';

              return (
                <div key={cat} className="mb-4 rounded-2xl p-4 transition-all duration-300" style={{
                  background: equippedItem
                    ? `linear-gradient(135deg, ${rarityColor}08, ${rarityColor}03)`
                    : 'rgba(255,255,255,0.015)',
                  border: `1px solid ${equippedItem ? `${rarityColor}18` : 'rgba(255,255,255,0.04)'}`,
                  boxShadow: equippedItem ? `0 0 30px ${rarityColor}08` : 'none',
                }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
                        background: equippedItem ? `${rarityColor}12` : 'rgba(255,255,255,0.04)',
                      }}>
                        <span className="text-base">{CATEGORY_ICONS[cat]}</span>
                      </div>
                      <span className="text-xs font-bold text-white/50 uppercase tracking-widest">{CATEGORY_LABELS[cat]}</span>
                    </div>
                    {equippedItem && (
                      <span className="text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider" style={{
                        color: rarityColor,
                        background: `${rarityColor}12`,
                        border: `1px solid ${rarityColor}20`,
                      }}>
                        {equippedItem.rarity}
                      </span>
                    )}
                  </div>

                  {equippedItem ? (
                    <div className="flex items-center gap-3.5">
                      <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{
                        background: `linear-gradient(135deg, ${rarityColor}15, ${rarityColor}08)`,
                        border: `1px solid ${rarityColor}20`,
                        boxShadow: `0 0 15px ${rarityColor}10`,
                      }}>
                        {equippedItem.category === 'title' ? (
                          <span className="text-[10px] font-black" style={{ color: rarityColor }}>{equippedItem.preview}</span>
                        ) : (
                          <Sparkles className="w-5 h-5" style={{ color: rarityColor, filter: `drop-shadow(0 0 6px ${rarityColor}40)` }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-bold text-sm">{equippedItem.name}</p>
                        <p className="text-white/25 text-[10px] truncate mt-0.5">{equippedItem.description}</p>
                      </div>
                      <button
                        onClick={() => handleUnequip(cat)}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-red-400/70 border border-red-500/15 hover:bg-red-500/10 transition-colors"
                      >
                        Unequip
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 py-2">
                      <div className="w-14 h-14 rounded-xl border border-dashed border-white/[0.06] flex items-center justify-center">
                        <span className="text-white/10 text-lg">+</span>
                      </div>
                      <p className="text-white/10 text-xs italic">No {CATEGORY_LABELS[cat].toLowerCase()} equipped</p>
                    </div>
                  )}

                  {/* Other owned items in this category */}
                  {ownedInCat.length > 1 && (
                    <div className="mt-3 pt-3 border-t border-white/[0.04]">
                      <p className="text-white/15 text-[10px] mb-2 font-medium">{ownedInCat.length} owned — tap to switch:</p>
                      <div className="flex gap-2 flex-wrap">
                        {ownedInCat.filter(i => i.id !== equippedId).map((item) => {
                          const rc = RARITY_COLORS[item.rarity];
                          return (
                            <button
                              key={item.id}
                              onClick={() => handleEquip(item)}
                              className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all duration-200 hover:scale-105"
                              style={{
                                border: `1px solid ${rc}25`,
                                color: rc,
                                background: `${rc}06`,
                              }}
                            >
                              {item.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Micromodules Section ── */}
            <div className="mt-8">
              <h3 className="text-white/30 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-amber-400" /> Micromodules
              </h3>
              <p className="text-white/15 text-[10px] mb-4">
                Permanent upgrades for equipped items. Cannot be removed after install.
              </p>

              {equippedItems.filter(i => i.category === 'frame' || i.category === 'aura' || i.category === 'ship_skin').length === 0 ? (
                <p className="text-white/10 text-xs italic py-4 text-center">Equip a frame, aura, or ship to install modules</p>
              ) : (
                <div className="space-y-3">
                  {equippedItems.filter(i => i.category === 'frame' || i.category === 'aura' || i.category === 'ship_skin').map((item) => {
                    const modules = loadout ? getItemModules(loadout, item.id) : [];
                    const rarityColor = RARITY_COLORS[item.rarity];
                    const maxSlots = item.maxModuleSlots ?? 3;
                    const needsCard = item.category === 'ship_skin' && !hasIdentityCard;
                    return (
                      <div key={item.id} className="rounded-xl p-3 border border-white/[0.06] bg-white/[0.02]">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm">{CATEGORY_ICONS[item.category]}</span>
                          <span className="text-white text-xs font-bold">{item.name}</span>
                          <span className={`text-[9px] ml-auto ${modules.length >= maxSlots ? 'text-green-400' : ''}`} style={modules.length < maxSlots ? { color: rarityColor } : undefined}>
                            {modules.length >= maxSlots ? 'Full' : `${modules.length}/${maxSlots} slots`}
                          </span>
                        </div>
                        {needsCard && (
                          <p className="text-[9px] text-amber-400/60 mb-2">Identity Card required to install modules on ships</p>
                        )}
                        <div className="flex gap-2">
                          {Array.from({ length: maxSlots }).map((_, slotIdx) => {
                            const mod = modules[slotIdx];
                            if (mod) {
                              const tierColor = MODULE_TIER_COLORS[mod.tier];
                              return (
                                <div key={slotIdx} className="flex-1 rounded-lg p-2 text-center" style={{
                                  background: `${tierColor}10`,
                                  border: `1px solid ${tierColor}25`,
                                }}>
                                  <span className="text-sm block">{mod.icon}</span>
                                  <span className="text-[9px] font-bold block mt-0.5" style={{ color: tierColor }}>{mod.name}</span>
                                  <span className="text-[8px] text-white/30">+{mod.statBonus.value} {mod.statBonus.stat}</span>
                                </div>
                              );
                            }
                            return (
                              <button
                                key={slotIdx}
                                onClick={() => !needsCard && setModuleModal({ itemId: item.id, item })}
                                disabled={needsCard}
                                className="flex-1 rounded-lg border border-dashed border-white/[0.08] p-2 flex flex-col items-center justify-center hover:border-purple-500/30 hover:bg-purple-500/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Plus className="w-3 h-3 text-white/15" />
                                <span className="text-[8px] text-white/10 mt-0.5">Install</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </>
        )}

        {/* ═══ HANGAR TAB ═══ */}
        {walletAddress && topTab === 'hangar' && loadout && (() => {
          const equippedShipId = loadout.equippedShipSkin;
          const equippedShip = equippedShipId ? getItemById(equippedShipId) : null;
          // Show default ship when nothing equipped (same as in games: /textures/ship.png)
          const displayShipId = equippedShipId;
          const displayShip = equippedShip;
          const skinKey = displayShipId ? displayShipId.replace('ship_', '') : null;
          const shipModules = displayShipId ? getItemModules(loadout, displayShipId) : [];
          const maxSlots = displayShip?.maxModuleSlots ?? 1;

          // Compute ship stats from compositeScore (consistent with card score)
          const stats = computeShipStats(walletPreview, loadout);

          // All owned ships
          const ownedShips = ALL_FORGE_ITEMS.filter(i =>
            i.category === 'ship_skin' && loadout.ownedItems.some(o => o.itemId === i.id)
          );

          const handleRemoveModule = (moduleId: string) => {
            if (!displayShipId) return;
            const updated = uninstallModule(loadout, displayShipId, moduleId);
            if (updated) {
              saveLocalLoadout(updated);
              setLoadout(updated);
              const mod = getModuleById(moduleId);
              toast.success(`Removed ${mod?.name ?? 'module'}`);
            }
          };

          const handleSwitchShip = (shipId: string) => {
            const updated = equipItem(loadout, shipId);
            saveLocalLoadout(updated);
            setLoadout(updated);
            const ship = getItemById(shipId);
            toast.success(`Switched to ${ship?.name ?? 'ship'}`);
          };

          const statBars: { key: keyof ShipStats; label: string; color: string }[] = [
            { key: 'speed', label: 'Speed', color: '#22d3ee' },
            { key: 'shield', label: 'Shield', color: '#3b82f6' },
            { key: 'firepower', label: 'Firepower', color: '#ef4444' },
            { key: 'luck', label: 'Luck', color: '#fbbf24' },
          ];

          return (
            <div className="space-y-4">
              {/* Ship Preview */}
              <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-5 text-center">
                <div className="flex justify-center mb-3">
                  <img
                    src={skinKey ? `/textures/ships/ship_${skinKey}.png` : '/textures/ship.png'}
                    alt={displayShip?.name ?? 'Standard Shuttle'}
                    className="w-32 h-32 object-contain"
                    style={{ filter: displayShip ? `drop-shadow(0 0 16px ${RARITY_COLORS[displayShip.rarity]}60)` : 'drop-shadow(0 0 12px rgba(255,255,255,0.15))' }}
                  />
                </div>
                {displayShip ? (
                  <>
                    <h3 className="text-white font-bold text-base">{displayShip.name}</h3>
                    <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md mt-1 inline-block"
                      style={{ color: RARITY_COLORS[displayShip.rarity], background: `${RARITY_COLORS[displayShip.rarity]}12`, border: `1px solid ${RARITY_COLORS[displayShip.rarity]}25` }}>
                      {displayShip.rarity}
                    </span>
                    <p className="text-white/30 text-xs mt-2">
                      Slots: {Array(maxSlots).fill(null).map((_, i) => i < shipModules.length ? '◆' : '◇').join('')} ({shipModules.length}/{maxSlots})
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="text-white/50 font-bold text-base">Standard Shuttle</h3>
                    <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md mt-1 inline-block text-white/20 bg-white/[0.04] border border-white/[0.08]">
                      default
                    </span>
                    <p className="text-white/15 text-[10px] mt-2">Purchase a ship in the Armory to customize</p>
                  </>
                )}
              </div>

              {/* Installed Modules */}
              {displayShip && (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <h4 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">Installed Modules</h4>
                  <div className="space-y-2">
                    {shipModules.map((mod) => {
                      const tierColor = MODULE_TIER_COLORS[mod.tier];
                      return (
                        <div key={mod.id} className="flex items-center gap-3 p-2.5 rounded-xl" style={{ background: `${tierColor}08`, border: `1px solid ${tierColor}20` }}>
                          <span className="text-lg">{mod.icon}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-bold text-white/80">{mod.name}</span>
                            <span className="text-[10px] ml-2 font-bold" style={{ color: '#4ade80' }}>+{mod.statBonus.value} {mod.statBonus.stat}</span>
                            {mod.tradeoff && <span className="text-[10px] ml-1 text-red-400/60">-{mod.tradeoff.value} {mod.tradeoff.stat}</span>}
                          </div>
                          <button
                            onClick={() => handleRemoveModule(mod.id)}
                            className="px-2 py-1 rounded-lg text-[10px] font-bold text-red-400/60 border border-red-500/15 hover:bg-red-500/10 transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                    {shipModules.length < maxSlots && (
                      <button
                        onClick={() => displayShipId && setModuleModal({ itemId: displayShipId, item: displayShip })}
                        className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-white/[0.08] text-white/20 text-xs hover:border-purple-500/30 hover:bg-purple-500/5 transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Module
                      </button>
                    )}
                    {shipModules.length === 0 && maxSlots > 0 && (
                      <p className="text-white/10 text-[10px] text-center py-1">No modules installed yet</p>
                    )}
                  </div>
                </div>
              )}

              {/* Ship Stats */}
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                <h4 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">Ship Stats</h4>
                {!walletPreview && walletAddress && (
                  <p className="text-white/15 text-[10px] mb-3 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading wallet data...
                  </p>
                )}
                <div className="space-y-3">
                  {statBars.map(({ key, label, color }) => {
                    const val = stats[key];
                    // Threshold effects
                    const thresholds = STAT_THRESHOLDS[key];
                    const activeThreshold = thresholds.filter(t => val >= t.at).pop();
                    const nextThreshold = thresholds.find(t => val < t.at);
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-bold text-white/60">{label}</span>
                          <div className="flex items-center gap-2">
                            {activeThreshold && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: activeThreshold.color, background: `${activeThreshold.color}15` }}>
                                {activeThreshold.label}
                              </span>
                            )}
                            <span className="text-[11px] font-black tabular-nums" style={{ color }}>{val}</span>
                          </div>
                        </div>
                        <div className="relative h-2.5 bg-white/[0.04] rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${val}%`, background: `linear-gradient(90deg, ${color}80, ${color})` }} />
                          {/* Threshold markers */}
                          {thresholds.map(t => (
                            <div key={t.at} className="absolute top-0 h-full w-px" style={{ left: `${t.at}%`, background: val >= t.at ? `${t.color}60` : 'rgba(255,255,255,0.08)' }} />
                          ))}
                        </div>
                        {nextThreshold && (
                          <p className="text-[10px] text-white/40 mt-0.5">
                            +{nextThreshold.at - val} to unlock: <span className="font-medium" style={{ color: nextThreshold.color }}>{nextThreshold.label}</span> — {nextThreshold.effect}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ship Grid */}
              {ownedShips.length > 1 && (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <h4 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">Your Ships</h4>
                  <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                    {ownedShips.map((ship) => {
                      const sk = ship.id.replace('ship_', '');
                      const isActive = ship.id === equippedShipId;
                      const rc = RARITY_COLORS[ship.rarity];
                      return (
                        <button
                          key={ship.id}
                          onClick={() => !isActive && handleSwitchShip(ship.id)}
                          className="flex-shrink-0 flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all duration-200"
                          style={{
                            border: `1px solid ${isActive ? `${rc}40` : 'rgba(255,255,255,0.06)'}`,
                            background: isActive ? `${rc}10` : 'transparent',
                            minWidth: 72,
                          }}
                        >
                          <img
                            src={`/textures/ships/ship_${sk}.png`}
                            alt={ship.name}
                            className="w-12 h-12 object-contain"
                            style={{ filter: isActive ? `drop-shadow(0 0 8px ${rc}60)` : 'brightness(0.6)' }}
                          />
                          <span className="text-[9px] font-bold truncate w-full text-center" style={{ color: isActive ? rc : 'rgba(255,255,255,0.3)' }}>
                            {ship.name.replace('Ship: ', '')}
                          </span>
                          {isActive && <Check className="w-3 h-3" style={{ color: rc }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Module Selection Modal ── */}
        {moduleModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => { setModuleModal(null); setConfirmModule(null); }}>
            <div className="bg-[#0a0e1a] border border-white/10 rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
              {confirmModule ? (
                <>
                  <h3 className="text-white font-bold text-base mb-2">Confirm Installation</h3>
                  <div className="p-3 rounded-xl mb-3" style={{
                    background: `${MODULE_TIER_COLORS[confirmModule.mod.tier]}10`,
                    border: `1px solid ${MODULE_TIER_COLORS[confirmModule.mod.tier]}25`,
                  }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{confirmModule.mod.icon}</span>
                      <span className="text-white font-bold text-sm">{confirmModule.mod.name}</span>
                    </div>
                    <p className="text-white/40 text-xs mb-2">{confirmModule.mod.description}</p>
                    <p className="text-green-400 text-xs font-bold">+{confirmModule.mod.statBonus.value} {confirmModule.mod.statBonus.stat}</p>
                    {confirmModule.mod.tradeoff && (
                      <p className="text-red-400 text-xs">-{confirmModule.mod.tradeoff.value} {confirmModule.mod.tradeoff.stat}</p>
                    )}
                  </div>
                  <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20 mb-4">
                    <p className="text-red-400 text-xs font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> This is permanent! Module cannot be removed.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1 h-10 text-xs" onClick={() => setConfirmModule(null)}>Cancel</Button>
                    <Button className="flex-1 h-10 text-xs bg-purple-600 hover:bg-purple-500 font-bold" onClick={() => handleInstallModule(confirmModule.itemId, confirmModule.mod.id)} disabled={installingModule}>
                      <Coins className="w-3 h-3 mr-1" /> {installingModule ? 'Installing...' : `Install (${confirmModule.mod.price})`}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-white font-bold text-base mb-1">Install Module</h3>
                  <p className="text-white/30 text-xs mb-4">Select a module for {moduleModal.item.name}</p>
                  <div className="space-y-2">
                    {MICROMODULE_DEFS
                      .filter(m => m.compatibleCategories.includes(moduleModal.item.category))
                      .filter(m => !(loadout?.installedModules[moduleModal.itemId] || []).includes(m.id))
                      .map((mod) => {
                        const tierColor = MODULE_TIER_COLORS[mod.tier];
                        const canAfford = (balance?.balance ?? 0) >= mod.price;
                        return (
                          <button
                            key={mod.id}
                            onClick={() => canAfford ? setConfirmModule({ itemId: moduleModal.itemId, mod }) : undefined}
                            disabled={!canAfford}
                            className={`w-full text-left p-3 rounded-xl border transition-all ${canAfford ? 'hover:bg-white/[0.03] cursor-pointer' : 'cursor-not-allowed'}`}
                            style={{
                              borderColor: `${tierColor}20`,
                              opacity: canAfford ? 1 : 0.4,
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{mod.icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-white text-xs font-bold">{mod.name}</span>
                                  <span className="text-[8px] font-black px-1.5 py-0.5 rounded" style={{ color: tierColor, background: `${tierColor}15` }}>
                                    {mod.tier.toUpperCase()}
                                  </span>
                                </div>
                                <p className="text-white/25 text-[10px] mt-0.5">{mod.description}</p>
                                <div className="flex items-center gap-3 mt-1">
                                  <span className="text-green-400 text-[10px] font-bold">+{mod.statBonus.value} {mod.statBonus.stat}</span>
                                  {mod.tradeoff && <span className="text-red-400 text-[10px]">-{mod.tradeoff.value} {mod.tradeoff.stat}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 text-amber-400 text-xs font-bold">
                                <Coins className="w-3 h-3" /> {mod.price}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                  <Button variant="outline" className="w-full mt-4 h-10 text-xs" onClick={() => setModuleModal(null)}>Close</Button>
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── Ambient CSS animations ── */}
      <style>{`
        @keyframes forge-float-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(5%, 8%) scale(1.05); }
          66% { transform: translate(-3%, -5%) scale(0.95); }
        }
        @keyframes forge-float-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-8%, -6%) scale(1.08); }
        }
      `}</style>
      </div>
    </PageShell>
  );
}
