/**
 * Stellar Forge — Shop/Crafting page for Identity Prism v5.
 * Players spend PRISM coins on card frames, auras, ship skins, titles.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { ArrowLeft, ShoppingBag, Check, Lock, Sparkles, Coins } from 'lucide-react';
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
  type ForgeCategory,
  type ForgeItem,
  type ForgeLoadout,
} from '@/lib/forgeItems';
import { getPrismBalance, spendPrism, type PrismBalance } from '@/lib/prismCoin';

type Tab = ForgeCategory | 'all';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'all', label: 'All Items', icon: '🛒' },
  { id: 'frame', label: 'Frames', icon: CATEGORY_ICONS.frame },
  { id: 'aura', label: 'Auras', icon: CATEGORY_ICONS.aura },
  { id: 'ship_skin', label: 'Ships', icon: CATEGORY_ICONS.ship_skin },
  { id: 'title', label: 'Titles', icon: CATEGORY_ICONS.title },
];

function ItemCard({
  item,
  owned,
  equipped,
  canAfford,
  onPurchase,
  onEquip,
}: {
  item: ForgeItem;
  owned: boolean;
  equipped: boolean;
  canAfford: boolean;
  onPurchase: () => void;
  onEquip: () => void;
}) {
  const rarityColor = RARITY_COLORS[item.rarity];

  return (
    <div
      className="relative rounded-xl border p-4 transition-all duration-300 hover:scale-[1.02]"
      style={{
        background: `linear-gradient(135deg, rgba(0,0,0,0.6), rgba(0,0,0,0.3))`,
        borderColor: owned ? `${rarityColor}60` : 'rgba(255,255,255,0.08)',
        boxShadow: equipped ? `0 0 20px ${rarityColor}40` : undefined,
      }}
    >
      {/* Rarity badge */}
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
          style={{ color: rarityColor, background: `${rarityColor}15`, border: `1px solid ${rarityColor}30` }}
        >
          {item.rarity}
        </span>
        <span className="text-lg">{CATEGORY_ICONS[item.category]}</span>
      </div>

      {/* Preview area */}
      <div
        className="w-full h-24 rounded-lg mb-3 flex items-center justify-center text-3xl"
        style={{
          background: `radial-gradient(ellipse at center, ${rarityColor}15, transparent)`,
          border: `1px solid ${rarityColor}10`,
        }}
      >
        {item.category === 'title' ? (
          <span className="text-sm font-bold" style={{ color: rarityColor }}>{item.preview}</span>
        ) : (
          <Sparkles className="w-8 h-8" style={{ color: rarityColor }} />
        )}
      </div>

      {/* Info */}
      <h3 className="text-white font-bold text-sm mb-1">{item.name}</h3>
      <p className="text-white/40 text-xs mb-3 leading-relaxed">{item.description}</p>

      {/* Unlock condition */}
      {item.unlockCondition && !owned && (
        <div className="flex items-center gap-1.5 text-amber-400/60 text-[10px] mb-3">
          <Lock className="w-3 h-3" />
          {item.unlockCondition}
        </div>
      )}

      {/* Action */}
      {equipped ? (
        <div className="flex items-center gap-2 text-green-400 text-xs font-bold">
          <Check className="w-4 h-4" />
          Equipped
        </div>
      ) : owned ? (
        <Button
          size="sm"
          className="w-full h-8 text-xs font-bold"
          style={{ background: rarityColor, color: '#000' }}
          onClick={onEquip}
        >
          Equip
        </Button>
      ) : (
        <Button
          size="sm"
          className="w-full h-8 text-xs font-bold"
          style={{
            background: canAfford ? rarityColor : 'rgba(255,255,255,0.05)',
            color: canAfford ? '#000' : 'rgba(255,255,255,0.3)',
          }}
          disabled={!canAfford}
          onClick={onPurchase}
        >
          <Coins className="w-3 h-3 mr-1" />
          {item.price} PRISM
        </Button>
      )}
    </div>
  );
}

export default function StellarForge() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const address = searchParams.get('address');
  const { publicKey } = useWallet();
  const walletAddress = address || publicKey?.toBase58() || '';

  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [balance, setBalance] = useState<PrismBalance | null>(null);
  const [loadout, setLoadout] = useState<ForgeLoadout | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  // Load data
  useEffect(() => {
    if (!walletAddress) return;
    getPrismBalance(walletAddress).then(setBalance);
    setLoadout(getLocalLoadout(walletAddress));
  }, [walletAddress]);

  const filteredItems = useMemo(() => {
    if (activeTab === 'all') return ALL_FORGE_ITEMS;
    return ALL_FORGE_ITEMS.filter((i) => i.category === activeTab);
  }, [activeTab]);

  const handlePurchase = useCallback(async (item: ForgeItem) => {
    if (!walletAddress || !loadout || !balance) return;
    if (balance.balance < item.price) {
      toast.error('Not enough PRISM coins');
      return;
    }

    setPurchasing(item.id);
    const result = await spendPrism(walletAddress, `forge_${item.category}` as any, item.price, `Purchased ${item.name}`);
    if (!result) {
      toast.error('Purchase failed — insufficient PRISM');
      setPurchasing(null);
      return;
    }

    const newLoadout = purchaseItem(loadout, item.id);
    saveLocalLoadout(newLoadout);
    setLoadout(newLoadout);
    setBalance(result.balance);
    setPurchasing(null);
    toast.success(`Acquired ${item.name}!`, { description: `−${item.price} PRISM` });
  }, [walletAddress, loadout, balance]);

  const handleEquip = useCallback((item: ForgeItem) => {
    if (!loadout) return;
    const newLoadout = equipItem(loadout, item.id);
    saveLocalLoadout(newLoadout);
    setLoadout(newLoadout);
    toast.success(`Equipped ${item.name}`);
  }, [loadout]);

  const isOwned = useCallback((id: string) => loadout?.ownedItems.some((o) => o.itemId === id) ?? false, [loadout]);
  const isEquipped = useCallback((id: string) => {
    if (!loadout) return false;
    return loadout.equippedFrame === id || loadout.equippedAura === id ||
           loadout.equippedShipSkin === id || loadout.equippedTitle === id;
  }, [loadout]);

  return (
    <div className="min-h-screen bg-[#050510] text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <span className="text-lg">💎</span>
            <span className="text-purple-300 font-bold font-mono">{balance?.balance ?? 0}</span>
            <span className="text-white/30 text-xs tracking-widest">PRISM</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black">⚒️ Stellar Forge</h1>
          <p className="text-white/40 text-sm mt-2">Craft upgrades for your card, planet & ship</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'bg-white/5 text-white/40 border border-white/5 hover:bg-white/10'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

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

        {filteredItems.length === 0 && (
          <div className="text-center text-white/20 py-20">
            <ShoppingBag className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No items in this category</p>
          </div>
        )}
      </div>
    </div>
  );
}
