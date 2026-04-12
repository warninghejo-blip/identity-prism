/**
 * Prism Shop — unified shop.
 * Tabs: Shop (buy items with Coins) | Equipped (loadout)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
import { trackForgePurchase } from '@/lib/analytics';
import {
  ArrowLeft,
  ShoppingBag,
  Check,
  Lock,
  Sparkles,
  Coins,
  Wallet,
  Loader2,
  AlertTriangle,
  Plus,
  Shield,
  Clock,
  TrendingUp,
  Zap,
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
  purchaseModule,
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
  meetsRequiredRank,
  RANK_LABELS,
  type ForgeCategory,
  type ForgeItem,
  type ForgeLoadout,
  type Micromodule,
} from '@/lib/forgeItems';
import { computeShipStats, getEquipmentBonusLines, SKIN_RARITY_BONUS, type ShipStats } from '@/lib/shipStats';
import { gatherXPSourcesMerged, computeRangerXP, getRangerRank } from '@/lib/rangerRanks';
import { fetchWalletPreview, getCachedWalletPreview, type WalletPreview } from '@/components/prism/shared';
import { getPrismBalance, spendPrism, type PrismBalance } from '@/lib/prismCoin';
import { getApiBase } from '@/components/prism/shared';
import { getQuestProgress, getQuestState } from '@/lib/prismQuests';

type TopTab = 'shop' | 'inventory';
type ShopFilter = ForgeCategory | 'all' | 'module';

const TIER_ORDER: Record<string, number> = { blue: 0, yellow: 1, red: 2 };
const SORTED_MODULES = [...MICROMODULE_DEFS].sort((a, b) => (TIER_ORDER[a.tier] ?? 0) - (TIER_ORDER[b.tier] ?? 0));

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
  { id: 'module', label: 'Modules', icon: '🔧' },
];

// ── Visual Preview Renderers ──

const AURA_STYLES: Record<string, { color: string; shadow: string }> = {
  frost: { color: '#67e8f9', shadow: '0 0 20px rgba(103,232,249,0.5), 0 0 40px rgba(103,232,249,0.2)' },
  ember: { color: '#fb923c', shadow: '0 0 20px rgba(251,146,60,0.5), 0 0 40px rgba(239,68,68,0.2)' },
  electric: {
    color: '#60a5fa',
    shadow: '0 0 15px rgba(96,165,250,0.6), 0 0 30px rgba(59,130,246,0.3), 0 0 45px rgba(96,165,250,0.15)',
  },
  plasma: { color: '#c084fc', shadow: '0 0 20px rgba(192,132,252,0.5), 0 0 45px rgba(168,85,247,0.25)' },
  dark_matter: { color: '#8b5cf6', shadow: '0 0 25px rgba(139,92,246,0.6), 0 0 50px rgba(109,40,217,0.35)' },
  binary_pulse: { color: '#22d3ee', shadow: '0 0 20px rgba(34,211,238,0.5), 0 0 40px rgba(251,191,36,0.3)' },
  solar_wind: { color: '#fde047', shadow: '0 0 20px rgba(253,224,71,0.5), 0 0 40px rgba(253,224,71,0.2)' },
  fortune_mist: { color: '#a78bfa', shadow: '0 0 20px rgba(167,139,250,0.5), 0 0 40px rgba(167,139,250,0.2)' },
  crimson_tide: { color: '#f87171', shadow: '0 0 20px rgba(248,113,113,0.5), 0 0 40px rgba(248,113,113,0.2)' },
  void_shell: { color: '#818cf8', shadow: '0 0 20px rgba(129,140,248,0.5), 0 0 40px rgba(129,140,248,0.2)' },
  stellar_tide: { color: '#34d399', shadow: '0 0 20px rgba(52,211,153,0.5), 0 0 40px rgba(52,211,153,0.2)' },
};

function ItemPreview({ item }: { item: ForgeItem }) {
  const rarityColor = RARITY_COLORS[item.rarity];

  if (item.category === 'frame') {
    const frameStyle = FRAME_STYLES[item.id] || {};
    return (
      <div
        className="w-full h-28 rounded-lg flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}
      >
        {/* Outer border = frame gradient */}
        <div
          style={{
            padding: 4,
            borderRadius: 10,
            background: frameStyle.gradient || 'transparent',
            boxShadow: frameStyle.boxShadow || 'none',
            animation: frameStyle.animation || undefined,
          }}
        >
          {/* Inner mini card */}
          <div
            style={{
              background: 'linear-gradient(135deg, #0a1020, #0d1428)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 6,
              width: 56,
              height: 76,
              borderRadius: 7,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: `radial-gradient(circle, ${rarityColor}60, ${rarityColor}20)`,
                marginBottom: 4,
              }}
            />
            <div
              style={{ width: 28, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.15)', marginBottom: 2 }}
            />
            <div style={{ width: 20, height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.08)' }} />
          </div>
        </div>
      </div>
    );
  }

  if (item.category === 'aura') {
    const aura = AURA_STYLES[item.preview] || { color: rarityColor, shadow: `0 0 20px ${rarityColor}50` };
    return (
      <div
        className="w-full h-28 rounded-lg flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}
      >
        {/* Ship with aura glow following its silhouette via stacked drop-shadows */}
        <img
          src="/textures/ship.png"
          alt="Ship with aura"
          style={{
            width: 44,
            height: 60,
            objectFit: 'contain',
            filter: `drop-shadow(0 0 6px ${aura.color}) drop-shadow(0 0 12px ${aura.color}90) drop-shadow(0 0 20px ${aura.color}50)`,
          }}
        />
      </div>
    );
  }

  if (item.category === 'ship_skin') {
    return (
      <div
        className="w-full h-28 rounded-lg flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}
      >
        <img
          src={`/textures/ships/ship_${item.preview}.png`}
          alt={item.name}
          style={{
            width: 48,
            height: 64,
            objectFit: 'contain',
            filter: `drop-shadow(0 0 8px ${rarityColor}40)`,
          }}
        />
      </div>
    );
  }

  // Title — premium badge display
  return (
    <div
      className="w-full h-28 rounded-lg flex flex-col items-center justify-center gap-1.5 px-2"
      style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}
    >
      <div
        style={{
          width: 32,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${rarityColor}40, transparent)`,
        }}
      />
      <div
        className="max-w-full"
        style={{
          padding: '5px 10px',
          borderRadius: 8,
          background: `linear-gradient(135deg, ${rarityColor}12, ${rarityColor}06)`,
          border: `1px solid ${rarityColor}25`,
          boxShadow: `0 0 20px ${rarityColor}10`,
        }}
      >
        <span
          className="block text-center leading-tight truncate"
          style={{
            fontSize: item.preview.length > 18 ? 10 : 11,
            fontWeight: 800,
            letterSpacing: '0.03em',
            color: rarityColor,
            textShadow: `0 0 10px ${rarityColor}40`,
          }}
        >
          {item.preview}
        </span>
      </div>
      <div
        style={{
          width: 32,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${rarityColor}40, transparent)`,
        }}
      />
    </div>
  );
}

// ── Shop Item Card (AAA) ──
function ItemCard({
  item,
  owned,
  equipped,
  canAfford,
  userRank,
  unlockMet,
  onPurchase,
  onEquip,
}: {
  item: ForgeItem;
  owned: boolean;
  equipped: boolean;
  canAfford: boolean;
  userRank: string | undefined;
  unlockMet: boolean;
  onPurchase: () => void;
  onEquip: () => void;
}) {
  const rarityColor = RARITY_COLORS[item.rarity];
  const rankMet = meetsRequiredRank(userRank, item.requiredRank);
  const locked = (!unlockMet || !rankMet) && !owned;
  const lockLabel =
    !rankMet && item.requiredRank
      ? `Requires ${RANK_LABELS[item.requiredRank] || item.requiredRank} rank`
      : !unlockMet
        ? item.unlockCondition
        : undefined;
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
      <div
        className="rounded-2xl p-3.5 h-full flex flex-col"
        style={{
          background: 'linear-gradient(135deg, rgba(8,10,18,0.95), rgba(5,7,12,0.98))',
          boxShadow: equipped ? `0 0 30px ${rarityColor}15, inset 0 0 30px ${rarityColor}05` : 'none',
        }}
      >
        {/* Owned badge */}
        {owned && !equipped && (
          <div
            className="absolute top-3 right-3 z-10 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: `${rarityColor}30` }}
          >
            <Check className="w-3 h-3" style={{ color: rarityColor }} />
          </div>
        )}

        {/* Rarity + Category header */}
        <div className="flex items-center justify-between mb-2.5">
          <span
            className="text-[8px] font-black uppercase tracking-[0.15em] px-2 py-1 rounded-xl"
            style={{
              color: rarityColor,
              background: `${rarityColor}10`,
              border: `1px solid ${rarityColor}20`,
              textShadow: `0 0 8px ${rarityColor}30`,
            }}
          >
            {item.rarity}
          </span>
          <span className="text-sm opacity-60">{CATEGORY_ICONS[item.category]}</span>
        </div>

        {/* Preview */}
        <div
          className="mb-3 rounded-xl overflow-hidden"
          style={{
            boxShadow: `inset 0 0 20px ${rarityColor}08`,
          }}
        >
          <ItemPreview item={item} />
        </div>

        {/* Info */}
        <h3 className="text-white font-bold text-[13px] mb-0.5 leading-tight text-center">{item.name}</h3>
        <p className="text-white/25 text-[10px] mb-2 leading-relaxed line-clamp-2 text-center min-h-[28px]">
          {item.description}
        </p>

        {/* Stat bonuses */}
        {(() => {
          if (item.category === 'ship_skin') {
            const bonus = SKIN_RARITY_BONUS[item.rarity] ?? 0;
            return (
              <div className="mb-2 flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-green-400 font-bold w-7 text-right">+{bonus}</span>
                  <span className="text-white/50">All Stats</span>
                </div>
                <div className="flex items-center justify-center gap-1 mt-0.5">
                  {Array.from({ length: item.maxModuleSlots ?? 3 }).map((_, si) => (
                    <div key={si} className="w-2 h-2 rounded-full border border-cyan-400/30 bg-cyan-400/10" />
                  ))}
                  <span className="text-[8px] text-cyan-400/40 ml-1">slots</span>
                </div>
              </div>
            );
          }
          const typeMap: Record<string, 'frame' | 'aura' | 'title'> = {
            frame: 'frame',
            aura: 'aura',
            title: 'title',
          };
          const bonusType = typeMap[item.category];
          const lines = bonusType ? getEquipmentBonusLines(item.id, bonusType) : [];
          if (lines.length === 0) return null;
          const isAura = item.category === 'aura';
          return (
            <div className="mb-2 flex flex-col items-center gap-0.5">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center text-[10px]">
                  <span className={`w-8 text-right font-bold ${isAura ? 'text-purple-400' : 'text-green-400'}`}>
                    {l.value}
                  </span>
                  <span className="text-white/50 ml-1.5">{l.label}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Lock label */}
        <div className="mb-2">
          {lockLabel && !owned && (
            <div className="flex items-center justify-center gap-1.5 text-amber-400/50 text-[10px] px-2 py-1.5 rounded-xl bg-amber-500/[0.04] border border-amber-500/10">
              <Lock className="w-3 h-3" /> {lockLabel}
            </div>
          )}
        </div>

        {/* Action — mt-auto pushes buttons to bottom */}
        <div className="mt-auto">
          {equipped ? (
            <div
              className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold"
              style={{
                color: '#4ade80',
                background: 'rgba(74,222,128,0.06)',
                border: '1px solid rgba(74,222,128,0.15)',
              }}
            >
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
              disabled={!canAfford || locked}
              onClick={onPurchase}
              className="w-full py-2 rounded-xl text-xs font-bold transition-all duration-300 flex items-center justify-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
              style={
                canAfford && !locked
                  ? {
                      background: `linear-gradient(135deg, ${rarityColor}, ${rarityColor}cc)`,
                      color: '#000',
                      boxShadow: `0 4px 15px ${rarityColor}25`,
                    }
                  : {
                      background: 'rgba(255,255,255,0.04)',
                      color: 'rgba(255,255,255,0.25)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }
              }
            >
              {locked ? (
                <>
                  <Lock className="w-3 h-3" /> Locked
                </>
              ) : (
                <>
                  <Coins className="w-3 h-3" /> {item.price.toLocaleString()}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──
export default function StellarForge() {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() || '';

  useEffect(() => {
    fadeOutTransition();
  }, []);

  const [walletPreview, setWalletPreview] = useState<WalletPreview | null>(() =>
    walletAddress ? getCachedWalletPreview(walletAddress) : null,
  );
  useEffect(() => {
    if (!walletAddress) {
      setWalletPreview(null);
      return;
    }
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
  const [rangerRank, setRangerRank] = useState<string>('cadet');

  const questState = useMemo(
    () => (walletAddress ? getQuestState(walletAddress) : null),
    [walletAddress, loadout?.ownedItems.length],
  );

  const isUnlockRequirementMet = useCallback(
    (item: ForgeItem) => {
      if (!item.unlockCondition) return true;
      if (!walletAddress || !questState) return false;
      switch (item.id) {
        case 'frame_event_horizon':
          return getQuestProgress(questState, 'ot_burn100').current >= 100;
        case 'aura_binary_pulse':
          return getQuestProgress(questState, 'ot_reach_sun').completed;
        case 'title_destroyer':
          return getQuestProgress(questState, 'ot_burn100').current >= 50;
        case 'title_sovereign':
          return (loadout?.ownedItems.length ?? 0) >= 4;
        case 'title_ascended':
          return getQuestProgress(questState, 'ot_score1000').current >= 1000;
        default:
          return false;
      }
    },
    [walletAddress, questState, loadout?.ownedItems.length],
  );

  useEffect(() => {
    if (!walletAddress) {
      setRangerRank('cadet');
      return;
    }
    let cancelled = false;
    gatherXPSourcesMerged(walletAddress)
      .then((sources) => {
        if (cancelled) return;
        setRangerRank(getRangerRank(computeRangerXP(sources)).id);
      })
      .catch(() => {
        if (!cancelled) setRangerRank('cadet');
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // Load data
  useEffect(() => {
    if (!walletAddress) return;
    const base = getApiBase();
    let cancelled = false;
    if (base)
      fetch(`${base}/api/prism/balance?address=${encodeURIComponent(walletAddress)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && !cancelled) setBalance(d);
        })
        .catch(() => {});
    setLoadout(getLocalLoadout(walletAddress));
    import('@/lib/userDataSync')
      .then(async ({ loadFromServer }) => {
        await loadFromServer(walletAddress);
        if (!cancelled) setLoadout(getLocalLoadout(walletAddress));
      })
      .catch(() => {});
    // Check identity card status via wallet-database
    fetch(`${base}/api/wallet-database?address=${encodeURIComponent(walletAddress)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.mint?.minted && !cancelled) setHasIdentityCard(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // Shop logic
  const RARITY_ORDER: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
  const filteredItems = useMemo(() => {
    const items =
      shopFilter === 'all' || shopFilter === 'module'
        ? ALL_FORGE_ITEMS
        : ALL_FORGE_ITEMS.filter((i) => i.category === shopFilter);
    return [...items].sort((a, b) => (RARITY_ORDER[a.rarity] ?? 0) - (RARITY_ORDER[b.rarity] ?? 0));
  }, [shopFilter]);

  const handlePurchase = useCallback(
    async (item: ForgeItem) => {
      if (!walletAddress || !loadout || !balance) return;
      if (purchasing) return; // prevent double-click
      if (item.requiredRank && !meetsRequiredRank(rangerRank, item.requiredRank)) {
        toast.error(`Requires ${RANK_LABELS[item.requiredRank] || item.requiredRank} rank`);
        return;
      }
      if (!isUnlockRequirementMet(item)) {
        toast.error(item.unlockCondition || 'This item is still locked');
        return;
      }
      if (balance.balance < item.price) {
        toast.error('Not enough Coins');
        return;
      }
      setPurchasing(item.id);
      try {
        // Validate locally first (before spending on server) to avoid money loss
        const newLoadout = purchaseItem(loadout, item.id, balance.balance);
        if (!newLoadout) {
          toast.error('Purchase failed — insufficient Coins or invalid item');
          return;
        }
        const result = await spendPrism(
          walletAddress,
          `forge_${item.category}` as any,
          item.price,
          `Purchased ${item.name}`,
          { itemId: item.id },
        );
        if (!result) {
          toast.error('Purchase failed');
          return;
        }
        saveLocalLoadout(newLoadout);
        setLoadout(newLoadout);
        setBalance(result.balance);
        trackForgePurchase(item.name, item.price);
        toast.success(`Acquired ${item.name}!`, { description: `−${item.price} Coins` });
        import('@/lib/prismQuests')
          .then(({ getQuestState, incrementQuest }) => {
            let qs = getQuestState(walletAddress);
            const onComplete = (q: { name: string }) =>
              toast.success(`Quest completed: ${q.name}!`, { duration: 4000 });
            qs = incrementQuest(qs, 'weekly_forge', 1, onComplete).state;
            incrementQuest(qs, 'ot_forge5', 1, onComplete);
          })
          .catch(() => {});
      } catch {
        toast.error('Purchase failed');
      } finally {
        setPurchasing(null);
      }
    },
    [walletAddress, loadout, balance, purchasing, rangerRank, isUnlockRequirementMet],
  );

  const handleEquip = useCallback(
    (item: ForgeItem) => {
      if (!loadout) return;
      const newLoadout = equipItem(loadout, item.id);
      saveLocalLoadout(newLoadout);
      setLoadout(newLoadout);
      toast.success(`Equipped ${item.name}`, {
        action: { label: 'View Card', onClick: () => startFadeTransition(() => goBack(navigate)) },
      });
    },
    [loadout, navigate],
  );

  const handleUnequip = useCallback(
    (category: ForgeCategory) => {
      if (!loadout) return;
      const newLoadout = unequipItem(loadout, category);
      saveLocalLoadout(newLoadout);
      setLoadout(newLoadout);
      const labels: Record<ForgeCategory, string> = {
        frame: 'Frame',
        aura: 'Aura',
        ship_skin: 'Ship Skin',
        title: 'Title',
      };
      toast.success(`Unequipped ${labels[category]}`);
    },
    [loadout],
  );

  const handlePurchaseModule = useCallback(
    async (moduleId: string) => {
      if (!loadout || !balance || !walletAddress) return;
      const mod = getModuleById(moduleId);
      if (!mod) return;
      if (balance.balance < mod.price) {
        toast.error('Not enough Coins');
        return;
      }
      const newLoadout = purchaseModule(loadout, moduleId, balance.balance);
      if (!newLoadout) {
        toast.error('Module already owned');
        return;
      }
      setInstallingModule(true);
      try {
        const result = await spendPrism(walletAddress, 'forge_module', mod.price, `Module: ${mod.name}`, {
          moduleId: mod.id,
        });
        if (!result) {
          toast.error('Purchase failed');
          return;
        }
        saveLocalLoadout(newLoadout);
        setLoadout(newLoadout);
        setBalance(result.balance);
        toast.success(`Purchased ${mod.name}!`, { description: 'Install it on a ship from your inventory.' });
      } catch {
        toast.error('Purchase failed');
      } finally {
        setInstallingModule(false);
      }
    },
    [loadout, balance, walletAddress],
  );

  const handleInstallModule = useCallback(
    async (itemId: string, moduleId: string) => {
      if (!loadout || !walletAddress || installingModule) return;
      const mod = getModuleById(moduleId);
      if (!mod) return;
      // Specific pre-checks with clear error messages
      if (!loadout.ownedModules.includes(moduleId)) {
        toast.error('You need to purchase this module first');
        return;
      }
      const item = getItemById(itemId);
      if (!item) return;
      if (!loadout.ownedItems.some((o) => o.itemId === itemId)) {
        toast.error('You need to own this ship first');
        return;
      }
      const currentModules = loadout.installedModules[itemId] || [];
      const maxSlots = item.maxModuleSlots ?? 3;
      if (currentModules.length >= maxSlots) {
        toast.error(`All ${maxSlots} module slot${maxSlots > 1 ? 's' : ''} are full on this ship`);
        return;
      }
      if (currentModules.includes(moduleId)) {
        toast.error('This module is already installed on this ship');
        return;
      }
      const alreadyElsewhere = Object.entries(loadout.installedModules).some(
        ([key, mods]) => key !== itemId && mods.includes(moduleId),
      );
      if (alreadyElsewhere) {
        toast.error('This module is already installed on another ship — uninstall it first');
        return;
      }
      const newLoadout = installModule(loadout, itemId, moduleId, hasIdentityCard);
      if (!newLoadout) {
        toast.error('Cannot install module');
        return;
      }
      saveLocalLoadout(newLoadout);
      setLoadout(newLoadout);
      setConfirmModule(null);
      setModuleModal(null);
      toast.success(`Installed ${mod.name}!`, { description: 'Module can be uninstalled later.' });
    },
    [loadout, walletAddress, installingModule, hasIdentityCard],
  );

  const isOwned = useCallback((id: string) => loadout?.ownedItems.some((o) => o.itemId === id) ?? false, [loadout]);
  const isEquipped = useCallback(
    (id: string) => {
      if (!loadout) return false;
      return (
        loadout.equippedFrame === id ||
        loadout.equippedAura === id ||
        loadout.equippedShipSkin === id ||
        loadout.equippedTitle === id
      );
    },
    [loadout],
  );

  return (
    <PageShell className="text-white">
      <div className="min-h-screen flex flex-col">
        {/* ── Ambient background effects ── */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          {/* Floating orb 1 */}
          <div
            className="absolute w-[500px] h-[500px] rounded-full opacity-[0.04]"
            style={{
              top: '-10%',
              left: '-10%',
              background: 'radial-gradient(circle, #a855f7, transparent 70%)',
              animation: 'forge-float-1 20s ease-in-out infinite',
            }}
          />
          {/* Floating orb 2 */}
          <div
            className="absolute w-[400px] h-[400px] rounded-full opacity-[0.03]"
            style={{
              bottom: '-5%',
              right: '-10%',
              background: 'radial-gradient(circle, #ec4899, transparent 70%)',
              animation: 'forge-float-2 25s ease-in-out infinite',
            }}
          />
          {/* Grid overlay */}
          <div
            className="absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage: `linear-gradient(rgba(168,85,247,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.3) 1px, transparent 1px)`,
              backgroundSize: '60px 60px',
            }}
          />
        </div>

        {/* ── Header ── */}
        <header
          className="flex-none sticky top-0 z-20"
          style={{
            background: 'linear-gradient(180deg, rgba(5,7,10,0.95) 0%, rgba(10,14,26,0.85) 100%)',
            backdropFilter: 'blur(20px) saturate(1.5)',
            borderBottom: '1px solid rgba(168,85,247,0.08)',
          }}
        >
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <button
              onClick={() => {
                startFadeTransition(() => goBack(navigate));
              }}
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.08] transition-all border border-white/[0.06]"
            >
              <ArrowLeft className="w-4 h-4 text-white/60" />
            </button>
            <div className="flex-1">
              <h1
                className="text-base font-black tracking-tight"
                style={{
                  background: 'linear-gradient(135deg, #c084fc 0%, #f472b6 40%, #fbbf24 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Prism Shop
              </h1>
              <p className="text-[9px] text-white/20 font-medium tracking-widest uppercase">Customize Your Identity</p>
            </div>
            <div
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-amber-500/15"
              style={{
                background: 'linear-gradient(135deg, rgba(251,191,36,0.08), rgba(245,158,11,0.04))',
              }}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                  boxShadow: '0 0 12px rgba(251,191,36,0.3)',
                }}
              >
                <Coins className="w-3 h-3 text-black" />
              </div>
              <span className="text-amber-300 font-black font-mono text-sm">{balance?.balance ?? 0}</span>
            </div>
          </div>
        </header>

        {/* ── Tab Bar ── */}
        <div
          className="flex-none z-10 relative"
          style={{
            background: 'rgba(5,7,10,0.6)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          <div className="max-w-2xl mx-auto px-3 flex gap-1 py-1.5">
            {[
              { id: 'shop' as TopTab, label: 'Armory', icon: '🛡️' },
              { id: 'inventory' as TopTab, label: 'Inventory', icon: '📦' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTopTab(t.id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold tracking-wide transition-all duration-300"
                style={
                  topTab === t.id
                    ? {
                        background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(236,72,153,0.1))',
                        color: '#c084fc',
                        boxShadow: '0 0 20px rgba(168,85,247,0.1), inset 0 0 20px rgba(168,85,247,0.05)',
                        border: '1px solid rgba(168,85,247,0.2)',
                      }
                    : {
                        color: 'rgba(255,255,255,0.3)',
                        border: '1px solid transparent',
                      }
                }
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
              <Wallet className="w-10 h-10 text-purple-400/60" />
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
                    style={
                      shopFilter === f.id
                        ? {
                            background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(139,92,246,0.15))',
                            color: '#c084fc',
                            border: '1px solid rgba(168,85,247,0.3)',
                            boxShadow: '0 0 15px rgba(168,85,247,0.15)',
                          }
                        : {
                            background: 'rgba(255,255,255,0.03)',
                            color: 'rgba(255,255,255,0.35)',
                            border: '1px solid rgba(255,255,255,0.06)',
                          }
                    }
                  >
                    <span>{f.icon}</span> {f.label}
                  </button>
                ))}
              </div>

              {/* Hint: how to earn coins */}
              {balance && balance.balance === 0 && (
                <button
                  onClick={() => startFadeTransition(() => navigate('/vault'))}
                  className="w-full mb-4 px-4 py-2.5 rounded-xl text-[11px] text-amber-300/60 bg-amber-500/[0.06] border border-amber-500/10 hover:bg-amber-500/10 transition-colors text-left"
                >
                  💡 Earn Coins by playing games, completing quests, or{' '}
                  <span className="underline">buy in the Vault</span>
                </button>
              )}

              {/* Items grid — with category subheadings in All tab */}
              {shopFilter === 'all' ? (
                <>
                  {(['ship_skin', 'frame', 'aura', 'title'] as ForgeCategory[]).map((cat) => {
                    const catItems = ALL_FORGE_ITEMS.filter((i) => i.category === cat);
                    if (catItems.length === 0) return null;
                    return (
                      <div key={cat} className="mb-6">
                        <div className="flex items-center gap-2 mb-3 px-1">
                          <span className="text-sm">{CATEGORY_ICONS[cat]}</span>
                          <span className="text-white/40 text-[11px] font-bold uppercase tracking-widest">
                            {CATEGORY_LABELS[cat]}
                          </span>
                          <div className="flex-1 h-px bg-white/[0.06]" />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {catItems.map((item) => (
                            <ItemCard
                              key={item.id}
                              item={item}
                              owned={isOwned(item.id)}
                              equipped={isEquipped(item.id)}
                              canAfford={(balance?.balance ?? 0) >= item.price}
                              userRank={rangerRank}
                              unlockMet={isUnlockRequirementMet(item)}
                              onPurchase={() => handlePurchase(item)}
                              onEquip={() => handleEquip(item)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {/* Modules section in All tab */}
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <span className="text-sm">🔧</span>
                      <span className="text-white/40 text-[11px] font-bold uppercase tracking-widest">Modules</span>
                      <div className="flex-1 h-px bg-white/[0.06]" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {SORTED_MODULES.map((mod) => {
                        const tierColor = MODULE_TIER_COLORS[mod.tier];
                        const isModOwned =
                          loadout?.ownedModules.includes(mod.id) ||
                          Object.values(loadout?.installedModules ?? {}).some((mods) => mods.includes(mod.id));
                        const canAfford = (balance?.balance ?? 0) >= mod.price;
                        return (
                          <div
                            key={mod.id}
                            className="relative rounded-xl p-3 transition-all duration-300"
                            style={{
                              background: isModOwned ? `${tierColor}08` : 'rgba(255,255,255,0.02)',
                              border: `1px solid ${isModOwned ? `${tierColor}35` : `${tierColor}25`}`,
                            }}
                          >
                            {isModOwned && (
                              <div
                                className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                                style={{ background: `${tierColor}25` }}
                              >
                                <Check className="w-3 h-3" style={{ color: tierColor }} />
                              </div>
                            )}
                            <div className="flex items-center gap-2 mb-1.5">
                              <img src={mod.image} alt={mod.name} className="w-8 h-8 object-contain" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-white text-[11px] font-bold truncate">{mod.name}</span>
                                </div>
                              </div>
                            </div>
                            <p className="text-white/30 text-[10px] mb-2 line-clamp-2 min-h-[28px]">
                              {mod.description}
                            </p>
                            <div className="space-y-0.5 mb-2">
                              <div className="flex items-center text-[10px]">
                                <span className="text-green-400 font-bold w-7 text-right">+{mod.statBonus.value}</span>
                                <span className="text-white/50 ml-1.5">{mod.statBonus.stat}</span>
                              </div>
                              {mod.tradeoff && (
                                <div className="flex items-center text-[10px]">
                                  <span className="text-red-400 font-bold w-7 text-right">-{mod.tradeoff.value}</span>
                                  <span className="text-white/50 ml-1.5">{mod.tradeoff.stat}</span>
                                </div>
                              )}
                            </div>
                            {!isModOwned && (
                              <button
                                onClick={() => (canAfford ? handlePurchaseModule(mod.id) : undefined)}
                                disabled={!canAfford || installingModule}
                                className="w-full py-1.5 rounded-xl text-[10px] font-bold transition-all"
                                style={{
                                  background: canAfford ? `${tierColor}20` : 'rgba(255,255,255,0.03)',
                                  color: canAfford ? tierColor : 'rgba(255,255,255,0.2)',
                                  border: `1px solid ${canAfford ? `${tierColor}30` : 'rgba(255,255,255,0.06)'}`,
                                }}
                              >
                                <Coins className="w-3 h-3 inline mr-1" />
                                {mod.price.toLocaleString()}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : shopFilter === 'module' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {SORTED_MODULES.map((mod) => {
                    const tierColor = MODULE_TIER_COLORS[mod.tier];
                    const isModOwned =
                      loadout?.ownedModules.includes(mod.id) ||
                      Object.values(loadout?.installedModules ?? {}).some((mods) => mods.includes(mod.id));
                    const canAfford = (balance?.balance ?? 0) >= mod.price;
                    return (
                      <div
                        key={mod.id}
                        className="relative rounded-xl p-3 transition-all duration-300"
                        style={{
                          background: isModOwned ? `${tierColor}08` : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${isModOwned ? `${tierColor}35` : `${tierColor}25`}`,
                        }}
                      >
                        {isModOwned && (
                          <div
                            className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                            style={{ background: `${tierColor}25` }}
                          >
                            <Check className="w-3 h-3" style={{ color: tierColor }} />
                          </div>
                        )}
                        <div className="flex items-center gap-2 mb-1.5">
                          <img src={mod.image} alt={mod.name} className="w-8 h-8 object-contain" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-white text-[11px] font-bold truncate">{mod.name}</span>
                              <span
                                className="text-[8px] font-black px-1.5 py-0.5 rounded shrink-0"
                                style={{ color: tierColor, background: `${tierColor}15` }}
                              >
                                {mod.tier.toUpperCase()}
                              </span>
                            </div>
                          </div>
                        </div>
                        <p className="text-white/30 text-[10px] mb-2 line-clamp-2 min-h-[28px]">{mod.description}</p>
                        <div className="space-y-0.5 mb-2">
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <span className="text-green-400 font-bold">+{mod.statBonus.value}</span>
                            <span className="text-white/50">{mod.statBonus.stat}</span>
                          </div>
                          {mod.tradeoff && (
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <span className="text-red-400 font-bold">-{mod.tradeoff.value}</span>
                              <span className="text-white/50">{mod.tradeoff.stat}</span>
                            </div>
                          )}
                        </div>
                        {!isModOwned && (
                          <button
                            onClick={() => (canAfford ? handlePurchaseModule(mod.id) : undefined)}
                            disabled={!canAfford || installingModule}
                            className="w-full py-1.5 rounded-xl text-[10px] font-bold transition-all"
                            style={{
                              background: canAfford ? `${tierColor}20` : 'rgba(255,255,255,0.03)',
                              color: canAfford ? tierColor : 'rgba(255,255,255,0.2)',
                              border: `1px solid ${canAfford ? `${tierColor}30` : 'rgba(255,255,255,0.06)'}`,
                            }}
                          >
                            <Coins className="w-3 h-3 inline mr-1" />
                            {mod.price.toLocaleString()}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {filteredItems.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      owned={isOwned(item.id)}
                      equipped={isEquipped(item.id)}
                      canAfford={(balance?.balance ?? 0) >= item.price}
                      userRank={rangerRank}
                      unlockMet={isUnlockRequirementMet(item)}
                      onPurchase={() => handlePurchase(item)}
                      onEquip={() => handleEquip(item)}
                    />
                  ))}
                </div>
              )}
              {filteredItems.length === 0 && shopFilter !== 'all' && shopFilter !== 'module' && (
                <div className="text-center py-24">
                  <div
                    className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                    style={{
                      background: 'linear-gradient(135deg, rgba(168,85,247,0.1), rgba(139,92,246,0.05))',
                      border: '1px solid rgba(168,85,247,0.1)',
                    }}
                  >
                    <ShoppingBag className="w-7 h-7 text-purple-400/30" />
                  </div>
                  <p className="text-white/20 text-sm font-medium">No items in this category</p>
                </div>
              )}
            </>
          )}

          {/* ═══ INVENTORY TAB ═══ */}
          {walletAddress &&
            topTab === 'inventory' &&
            loadout &&
            (() => {
              // ── Equipment section data ──
              const equipmentCats = ['frame', 'aura', 'title'] as ForgeCategory[];

              // ── Ship Bay data ──
              const equippedShipId = loadout.equippedShipSkin;
              const equippedShip = equippedShipId ? getItemById(equippedShipId) : null;
              const displayShipId = equippedShipId;
              const displayShip = equippedShip;
              const skinKey = displayShipId ? displayShipId.replace('ship_', '') : null;
              const shipModules = displayShipId ? getItemModules(loadout, displayShipId) : [];
              const maxSlots = displayShip?.maxModuleSlots ?? 1;
              const stats = computeShipStats(walletPreview, loadout);
              const ownedShips = ALL_FORGE_ITEMS.filter(
                (i) => i.category === 'ship_skin' && loadout.ownedItems.some((o) => o.itemId === i.id),
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
                <div className="space-y-5">
                  {/* ── Equipment Section (frame / aura / title) ── */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" /> Equipment
                    </h3>

                    {equipmentCats.map((cat) => {
                      const equippedId =
                        cat === 'frame'
                          ? loadout.equippedFrame
                          : cat === 'aura'
                            ? loadout.equippedAura
                            : loadout.equippedTitle;
                      const ownedInCat = ALL_FORGE_ITEMS.filter(
                        (i) => i.category === cat && loadout.ownedItems.some((o) => o.itemId === i.id),
                      );

                      return (
                        <div key={cat}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm">{CATEGORY_ICONS[cat]}</span>
                            <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                              {CATEGORY_LABELS[cat]}s
                            </span>
                          </div>
                          {ownedInCat.length > 0 ? (
                            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                              {ownedInCat.map((item) => {
                                const isEq = item.id === equippedId;
                                const rc = RARITY_COLORS[item.rarity];
                                return (
                                  <button
                                    key={item.id}
                                    onClick={() => (isEq ? handleUnequip(cat) : handleEquip(item))}
                                    className="flex-shrink-0 flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-200 hover:scale-105"
                                    style={{
                                      width: 72,
                                      minWidth: 72,
                                      border: isEq ? `2px solid ${rc}60` : '1px solid rgba(255,255,255,0.06)',
                                      background: isEq ? `${rc}10` : 'rgba(255,255,255,0.02)',
                                      boxShadow: isEq ? `0 0 12px ${rc}20` : 'none',
                                    }}
                                  >
                                    {cat === 'title' ? (
                                      <div
                                        className="w-12 h-12 rounded-lg flex items-center justify-center"
                                        style={{ background: `${rc}10` }}
                                      >
                                        <span
                                          className="text-[8px] font-black text-center leading-tight"
                                          style={{ color: rc }}
                                        >
                                          {item.preview}
                                        </span>
                                      </div>
                                    ) : (
                                      <div
                                        className="w-12 h-12 rounded-lg flex items-center justify-center"
                                        style={{ background: `${rc}10` }}
                                      >
                                        <Sparkles
                                          className="w-5 h-5"
                                          style={{ color: rc, filter: `drop-shadow(0 0 4px ${rc}40)` }}
                                        />
                                      </div>
                                    )}
                                    <span
                                      className="text-[9px] font-bold truncate w-full text-center"
                                      style={{ color: isEq ? rc : 'rgba(255,255,255,0.4)' }}
                                    >
                                      {item.name}
                                    </span>
                                    {isEq && <Check className="w-3 h-3" style={{ color: rc }} />}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-white/15 text-[10px] italic pl-7">
                              No items —{' '}
                              <span className="text-purple-400/50 cursor-pointer" onClick={() => setTopTab('shop')}>
                                visit Armory
                              </span>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Ship Bay ── */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                      🚀 Ship Bay
                    </h3>

                    {/* Ship Grid — horizontal scroll */}
                    {ownedShips.length > 0 ? (
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
                                minWidth: 80,
                              }}
                            >
                              <img
                                src={`/textures/ships/ship_${sk}.png`}
                                alt={ship.name}
                                className="w-16 h-16 object-contain"
                                style={{ filter: isActive ? `drop-shadow(0 0 8px ${rc}60)` : 'brightness(0.6)' }}
                              />
                              <span
                                className="text-[9px] font-bold truncate w-full text-center"
                                style={{ color: isActive ? rc : 'rgba(255,255,255,0.3)' }}
                              >
                                {ship.name.replace('Ship: ', '')}
                              </span>
                              {isActive && <Check className="w-3 h-3" style={{ color: rc }} />}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-center">
                        <img
                          src="/textures/ship.png"
                          alt="Standard Shuttle"
                          className="w-16 h-16 object-contain mx-auto mb-2 opacity-30"
                        />
                        <p className="text-white/30 text-xs font-bold">Standard Shuttle</p>
                        <p className="text-white/15 text-[10px] mt-1">
                          <span className="text-purple-400/50 cursor-pointer" onClick={() => setTopTab('shop')}>
                            Buy ships in Armory
                          </span>
                        </p>
                      </div>
                    )}

                    {/* Ship Preview */}
                    {displayShip && (
                      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-5 text-center">
                        <div className="flex justify-center mb-3">
                          <img
                            src={skinKey ? `/textures/ships/ship_${skinKey}.png` : '/textures/ship.png'}
                            alt={displayShip.name}
                            className="w-24 h-24 object-contain"
                            style={{ filter: `drop-shadow(0 0 16px ${RARITY_COLORS[displayShip.rarity]}60)` }}
                          />
                        </div>
                        <h3 className="text-white font-bold text-base">{displayShip.name}</h3>
                        <span
                          className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-xl mt-1 inline-block"
                          style={{
                            color: RARITY_COLORS[displayShip.rarity],
                            background: `${RARITY_COLORS[displayShip.rarity]}12`,
                            border: `1px solid ${RARITY_COLORS[displayShip.rarity]}25`,
                          }}
                        >
                          {displayShip.rarity}
                        </span>
                        <p className="text-white/30 text-xs mt-2">
                          Slots:{' '}
                          {Array(maxSlots)
                            .fill(null)
                            .map((_, i) => (i < shipModules.length ? '◆' : '◇'))
                            .join('')}{' '}
                          ({shipModules.length}/{maxSlots})
                        </p>
                      </div>
                    )}

                    {/* Installed Modules */}
                    {displayShip && (
                      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                        <h4 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">
                          Installed Modules
                        </h4>
                        <div className="space-y-2">
                          {shipModules.map((mod) => {
                            const tierColor = MODULE_TIER_COLORS[mod.tier];
                            return (
                              <div
                                key={mod.id}
                                className="flex items-center gap-3 p-2.5 rounded-xl"
                                style={{ background: `${tierColor}08`, border: `1px solid ${tierColor}20` }}
                              >
                                <img src={mod.image} alt={mod.name} className="w-7 h-7 object-contain" />
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs font-bold text-white/80">{mod.name}</span>
                                  <span className="text-[10px] ml-2 font-bold" style={{ color: '#4ade80' }}>
                                    +{mod.statBonus.value} {mod.statBonus.stat}
                                  </span>
                                  {mod.tradeoff && (
                                    <span className="text-[10px] ml-1 text-red-400/60">
                                      -{mod.tradeoff.value} {mod.tradeoff.stat}
                                    </span>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleRemoveModule(mod.id)}
                                  className="px-2 py-1 rounded-xl text-[10px] font-bold text-red-400/60 border border-red-500/15 hover:bg-red-500/10 transition-colors"
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })}
                          {shipModules.length < maxSlots && (
                            <button
                              onClick={() =>
                                displayShipId && setModuleModal({ itemId: displayShipId, item: displayShip })
                              }
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
                          const thresholds = STAT_THRESHOLDS[key];
                          const activeThreshold = thresholds.filter((t) => val >= t.at).pop();
                          const nextThreshold = thresholds.find((t) => val < t.at);
                          return (
                            <div key={key}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] font-bold text-white/60">{label}</span>
                                <div className="flex items-center gap-2">
                                  {activeThreshold && (
                                    <span
                                      className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                      style={{ color: activeThreshold.color, background: `${activeThreshold.color}15` }}
                                    >
                                      {activeThreshold.label}
                                    </span>
                                  )}
                                  <span className="text-[11px] font-black tabular-nums" style={{ color }}>
                                    {val}
                                  </span>
                                </div>
                              </div>
                              <div className="relative h-2.5 bg-white/[0.04] rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${val}%`,
                                    background: `linear-gradient(90deg, ${color}80, ${color})`,
                                  }}
                                />
                                {thresholds.map((t) => (
                                  <div
                                    key={t.at}
                                    className="absolute top-0 h-full w-px"
                                    style={{
                                      left: `${t.at}%`,
                                      background: val >= t.at ? `${t.color}60` : 'rgba(255,255,255,0.08)',
                                    }}
                                  />
                                ))}
                              </div>
                              {nextThreshold && (
                                <p className="text-[10px] text-white/40 mt-0.5">
                                  +{nextThreshold.at - val} to unlock:{' '}
                                  <span className="font-medium" style={{ color: nextThreshold.color }}>
                                    {nextThreshold.label}
                                  </span>{' '}
                                  — {nextThreshold.effect}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

          {/* ── Module Selection Modal ── */}
          {moduleModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => {
                setModuleModal(null);
                setConfirmModule(null);
              }}
            >
              <div
                className="bg-[#0a0e1a] border border-white/10 rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5"
                onClick={(e) => e.stopPropagation()}
              >
                {confirmModule ? (
                  <>
                    <h3 className="text-white font-bold text-base mb-2">Confirm Installation</h3>
                    <div
                      className="p-3 rounded-xl mb-3"
                      style={{
                        background: `${MODULE_TIER_COLORS[confirmModule.mod.tier]}10`,
                        border: `1px solid ${MODULE_TIER_COLORS[confirmModule.mod.tier]}25`,
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <img
                          src={confirmModule.mod.image}
                          alt={confirmModule.mod.name}
                          className="w-7 h-7 object-contain"
                        />
                        <span className="text-white font-bold text-sm">{confirmModule.mod.name}</span>
                      </div>
                      <p className="text-white/40 text-xs mb-2">{confirmModule.mod.description}</p>
                      <p className="text-green-400 text-xs font-bold">
                        +{confirmModule.mod.statBonus.value} {confirmModule.mod.statBonus.stat}
                      </p>
                      {confirmModule.mod.tradeoff && (
                        <p className="text-red-400 text-xs">
                          -{confirmModule.mod.tradeoff.value} {confirmModule.mod.tradeoff.stat}
                        </p>
                      )}
                    </div>
                    <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 mb-4">
                      <p className="text-blue-400 text-xs font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Module can be uninstalled later.
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1 h-10 text-xs" onClick={() => setConfirmModule(null)}>
                        Cancel
                      </Button>
                      <Button
                        className="flex-1 h-10 text-xs bg-purple-600 hover:bg-purple-500 font-bold"
                        onClick={() => handleInstallModule(confirmModule.itemId, confirmModule.mod.id)}
                        disabled={installingModule}
                      >
                        {installingModule ? 'Installing...' : 'Install'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-white font-bold text-base mb-1">Install Module</h3>
                    <p className="text-white/30 text-xs mb-4">Select a module for {moduleModal.item.name}</p>
                    <div className="space-y-2">
                      {MICROMODULE_DEFS.filter((m) => m.compatibleCategories.includes(moduleModal.item.category))
                        .filter((m) => loadout?.ownedModules.includes(m.id))
                        .map((mod) => {
                          const tierColor = MODULE_TIER_COLORS[mod.tier];
                          return (
                            <button
                              key={mod.id}
                              onClick={() => setConfirmModule({ itemId: moduleModal.itemId, mod })}
                              className="w-full text-left p-3 rounded-xl border transition-all hover:bg-white/[0.03] cursor-pointer"
                              style={{ borderColor: `${tierColor}20` }}
                            >
                              <div className="flex items-center gap-2">
                                <img src={mod.image} alt={mod.name} className="w-7 h-7 object-contain" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-white text-xs font-bold">{mod.name}</span>
                                    <span
                                      className="text-[8px] font-black px-1.5 py-0.5 rounded"
                                      style={{ color: tierColor, background: `${tierColor}15` }}
                                    >
                                      {mod.tier.toUpperCase()}
                                    </span>
                                  </div>
                                  <p className="text-white/25 text-[10px] mt-0.5">{mod.description}</p>
                                  <div className="flex items-center gap-3 mt-1">
                                    <span className="text-green-400 text-[10px] font-bold">
                                      +{mod.statBonus.value} {mod.statBonus.stat}
                                    </span>
                                    {mod.tradeoff && (
                                      <span className="text-red-400 text-[10px]">
                                        -{mod.tradeoff.value} {mod.tradeoff.stat}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      {(loadout?.ownedModules.filter((id) => {
                        const m = getModuleById(id);
                        return m && m.compatibleCategories.includes(moduleModal.item.category);
                      }).length ?? 0) === 0 && (
                        <p className="text-white/20 text-[10px] text-center py-4">
                          No compatible modules in inventory. Buy modules from the shop first.
                        </p>
                      )}
                    </div>
                    <Button variant="outline" className="w-full mt-4 h-10 text-xs" onClick={() => setModuleModal(null)}>
                      Close
                    </Button>
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
