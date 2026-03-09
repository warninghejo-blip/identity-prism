/**
 * Prism Shop — unified shop + marketplace.
 * Tabs: Shop (buy items with Coins) | Creator Market (user sprites) | Equipped (loadout)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import { trackForgePurchase } from '@/lib/analytics';
import {
  ArrowLeft, ShoppingBag, Check, Lock, Sparkles, Coins,
  Upload, Download, Loader2, Package, AlertTriangle, Plus, Shield, Clock, TrendingUp, Zap,
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
  AURA_GLOW_MAP,
  MICROMODULE_DEFS,
  MODULE_TIER_COLORS,
  installModule,
  getItemModules,
  getModuleById,
  type ForgeCategory,
  type ForgeItem,
  type ForgeLoadout,
  type Micromodule,
} from '@/lib/forgeItems';
import { getPrismBalance, spendPrism, type PrismBalance } from '@/lib/prismCoin';
import { getHeliusProxyUrl } from '@/constants';

type TopTab = 'shop' | 'market' | 'equipped';
type ShopFilter = ForgeCategory | 'all';

function getApiBase(): string {
  const proxy = getHeliusProxyUrl();
  if (proxy) return proxy;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

// ── Market types ──
interface MarketListing {
  id: string;
  seller: string;
  name: string;
  description: string;
  category: string;
  price: number;
  format: string;
  modelUrl: string;
  previewImage: string | null;
  purchaseCount: number;
  createdAt: number;
}

const MARKET_CATEGORIES = [
  { id: 'ship', label: 'Ships', icon: '🚀' },
  { id: 'planet', label: 'Planets', icon: '🪐' },
  { id: 'badge', label: 'Badges', icon: '🏅' },
  { id: 'decoration', label: 'Decor', icon: '✨' },
];

const SHOP_FILTERS: { id: ShopFilter; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: '🛒' },
  { id: 'frame', label: 'Frames', icon: CATEGORY_ICONS.frame },
  { id: 'aura', label: 'Auras', icon: CATEGORY_ICONS.aura },
  { id: 'ship_skin', label: 'Ships', icon: CATEGORY_ICONS.ship_skin },
  { id: 'title', label: 'Titles', icon: CATEGORY_ICONS.title },
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

const SHIP_TINTS: Record<string, { filter: string; shadow: string }> = {
  stealth: { filter: 'brightness(0.6) saturate(0.3) hue-rotate(0deg)', shadow: '0 0 8px rgba(239,68,68,0.3)' },
  chrome: { filter: 'brightness(1.3) saturate(0.1) contrast(1.2)', shadow: '0 0 12px rgba(200,200,255,0.4)' },
  neon: { filter: 'brightness(1.1) saturate(1.5) hue-rotate(90deg)', shadow: '0 0 15px rgba(0,255,100,0.4), 0 0 30px rgba(0,200,255,0.2)' },
  phantom: { filter: 'brightness(1.2) saturate(0.5) opacity(0.6)', shadow: '0 0 20px rgba(200,200,255,0.3)' },
  prism: { filter: 'brightness(1.1) saturate(2) hue-rotate(0deg)', shadow: '0 0 15px rgba(255,100,100,0.3), 0 0 30px rgba(100,100,255,0.2)' },
  golden: { filter: 'brightness(1.2) saturate(1.5) sepia(0.6) hue-rotate(-10deg)', shadow: '0 0 20px rgba(251,191,36,0.5)' },
};

function ItemPreview({ item }: { item: ForgeItem }) {
  const rarityColor = RARITY_COLORS[item.rarity];

  if (item.category === 'frame') {
    const frameStyle = FRAME_STYLES[item.preview] || {};
    return (
      <div className="w-full h-28 rounded-lg flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}>
        {/* Mini card with frame applied */}
        <div className="w-16 h-22 rounded-md" style={{
          background: 'linear-gradient(135deg, #0a1020, #0d1428)',
          ...frameStyle,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 6,
          width: 56, height: 76,
        }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: `radial-gradient(circle, ${rarityColor}60, ${rarityColor}20)`, marginBottom: 4 }} />
          <div style={{ width: 28, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.15)', marginBottom: 2 }} />
          <div style={{ width: 20, height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.08)' }} />
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
    const tint = SHIP_TINTS[item.preview];
    const hasCustomTexture = !tint;
    const textureSrc = hasCustomTexture
      ? `/textures/ships/ship_${item.preview}.png`
      : '/textures/ship.png';
    return (
      <div className="w-full h-28 rounded-lg flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}>
        <img
          src={textureSrc}
          alt={item.name}
          style={{
            width: hasCustomTexture ? 48 : 56, height: hasCustomTexture ? 64 : 56, objectFit: 'contain',
            ...(tint ? {
              filter: tint.shadow ? `${tint.filter} drop-shadow(${tint.shadow.split(',')[0].replace('0 0', '0 0')})` : tint.filter,
            } : {
              filter: `drop-shadow(0 0 8px ${rarityColor}40)`,
            }),
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

// ── Market Listing Card ──
function ListingCard({ listing, owned, onBuy, buying }: {
  listing: MarketListing; owned: boolean; onBuy: () => void; buying: boolean;
}) {
  const catIcon = MARKET_CATEGORIES.find(c => c.id === listing.category)?.icon || '📦';
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 hover:bg-white/[0.05] transition-all">
      <div className="w-full aspect-square rounded-lg mb-3 bg-gradient-to-br from-purple-500/10 to-cyan-500/10 flex items-center justify-center overflow-hidden">
        {listing.previewImage ? (
          <img src={listing.previewImage} alt={listing.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-4xl">{catIcon}</span>
        )}
      </div>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="text-white font-bold text-sm truncate">{listing.name}</h3>
          <p className="text-white/30 text-[10px] truncate">{listing.description || 'No description'}</p>
        </div>
        <span className="text-[10px] text-white/20 font-mono uppercase flex-shrink-0">.{listing.format}</span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-white/20 mb-3">
        <span>{listing.seller.slice(0, 4)}...{listing.seller.slice(-4)}</span>
        <span className="flex items-center gap-1"><Download className="w-3 h-3" /> {listing.purchaseCount}</span>
      </div>
      {owned ? (
        <div className="flex items-center gap-2 text-green-400 text-xs font-bold py-2"><Check className="w-4 h-4" /> Owned</div>
      ) : (
        <Button size="sm" className="w-full h-10 text-xs font-bold bg-purple-600 hover:bg-purple-500" onClick={onBuy} disabled={buying}>
          {buying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3 mr-1" />}
          {listing.price} Coins
        </Button>
      )}
    </div>
  );
}

// ── Upload Section ──
const LISTING_FEE = 10;

function UploadSection({ walletAddress, onUploaded, coinBalance }: { walletAddress: string; onUploaded: () => void; coinBalance: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('ship');
  const [price, setPrice] = useState('50');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    if (!['png', 'webp', 'jpg', 'jpeg', 'svg'].includes(ext)) { setError('Only .png, .webp, .jpg, .svg files supported'); e.target.value = ''; return; }
    if (f.size > 2 * 1024 * 1024) { setError('File too large (max 2 MB)'); e.target.value = ''; return; }
    setFile(f); setError('');
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  };

  const handleUpload = useCallback(async () => {
    if (!file || !name.trim() || !walletAddress) return;
    setUploading(true); setError('');
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const base = getApiBase();
      const res = await fetch(`${base}/api/marketplace/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress, name: name.trim(), description: description.trim(), category, price: Number(price) || 50, modelData: base64, modelFormat: ext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast.success('Model uploaded!', { description: `"${name}" is now listed` });
      setFile(null); setName(''); setDescription('');
      onUploaded();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setError(msg); toast.error(msg);
    } finally { setUploading(false); }
  }, [file, name, description, category, price, walletAddress, onUploaded]);

  return (
    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-4 mb-5">
      <h3 className="text-white font-bold text-sm flex items-center gap-2">
        <Upload className="w-4 h-4 text-purple-400" /> Upload Your Sprite
      </h3>
      <p className="text-white/25 text-xs">Upload .png/.webp with transparent background (max 2MB). You earn 80% of each sale.</p>
      <div>
        <input ref={fileRef} type="file" accept=".png,.webp,.jpg,.jpeg,.svg" onChange={handleFileChange} className="hidden" />
        <Button variant="outline" className="w-full h-12 border-dashed border-white/10 text-white/40 hover:text-white hover:border-purple-500/30" onClick={() => fileRef.current?.click()}>
          {file ? `📦 ${file.name} (${(file.size / 1024).toFixed(0)} KB)` : '📁 Choose file'}
        </Button>
      </div>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Model name..." maxLength={60}
        className="w-full px-3 py-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50" style={{ fontSize: 16 }} />
      <div className="flex gap-3">
        <div className="flex-1">
          <p className="text-white/30 text-[10px] mb-1 uppercase tracking-wider">Category</p>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none">
            {MARKET_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </select>
        </div>
        <div className="w-28">
          <p className="text-white/30 text-[10px] mb-1 uppercase tracking-wider">Price</p>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} min={1} max={10000}
            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none text-center font-mono" />
        </div>
      </div>
      {error && <div className="flex items-center gap-2 text-red-400 text-xs"><AlertTriangle className="w-3 h-3" /> {error}</div>}
      {/* Listing fee notice */}
      <div className="flex items-center justify-between px-3 py-2.5 rounded-xl" style={{
        background: coinBalance < LISTING_FEE ? 'rgba(239,68,68,0.06)' : 'rgba(251,191,36,0.05)',
        border: `1px solid ${coinBalance < LISTING_FEE ? 'rgba(239,68,68,0.2)' : 'rgba(251,191,36,0.15)'}`,
      }}>
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill={coinBalance < LISTING_FEE ? '#f87171' : '#fbbf24'}><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5"/></svg>
          <span className="text-xs font-bold" style={{ color: coinBalance < LISTING_FEE ? '#f87171' : '#fbbf24' }}>
            Listing fee: {LISTING_FEE} coins
          </span>
        </div>
        {coinBalance < LISTING_FEE && (
          <span className="text-[10px] text-red-400/70">Insufficient balance</span>
        )}
      </div>
      <Button className="w-full h-12 bg-purple-600 hover:bg-purple-500 font-bold" onClick={handleUpload} disabled={!file || !name.trim() || uploading || Number(price) < 1 || Number(price) > 10000 || coinBalance < LISTING_FEE}>
        {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
        {uploading ? 'Uploading...' : 'Upload Model'}
      </Button>
    </div>
  );
}

// ── Coin Packages ──

const COIN_PACKAGES = [
  { coins: 1000,   solPrice: 0.001,  label: 'Starter' },    // ~$0.10 — base rate
  { coins: 5000,   solPrice: 0.0045, label: 'Explorer' },   // ~$0.45 — 10% discount
  { coins: 15000,  solPrice: 0.012,  label: 'Voyager' },    // ~$1.20 — 20% discount
  { coins: 50000,  solPrice: 0.035,  label: 'Commander' },  // ~$3.50 — 30% discount
];

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

const VAULT_TIERS = [
  {
    id: 'bronze',
    label: 'Bronze',
    min: 500,
    lock: 7,
    yieldPerDay: 0.5,
    boost: 10,
    color: '#cd7f32',
    glow: 'rgba(205,127,50,0.25)',
    icon: '🥉',
  },
  {
    id: 'silver',
    label: 'Silver',
    min: 2000,
    lock: 30,
    yieldPerDay: 0.8,
    boost: 20,
    color: '#c0c0c0',
    glow: 'rgba(192,192,192,0.2)',
    icon: '🥈',
  },
  {
    id: 'gold',
    label: 'Gold',
    min: 5000,
    lock: 90,
    yieldPerDay: 1.2,
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
      .then(d => { if (d) setVaultStatus(d); else setVaultStatus({ staked: false }); })
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
              <p className="text-white font-black text-sm">{stakedTierInfo?.yieldPerDay ?? 0}%</p>
              <p className="text-white/25 text-[9px]">per day</p>
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
                  <p className="text-[9px] font-bold" style={{ color: selectedTier === t.id ? t.color : 'rgba(255,255,255,0.3)' }}>{t.yieldPerDay}%/day</p>
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
                +{(stakeAmountNum * tier.yieldPerDay / 100).toFixed(1)} coins/day
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

  const [topTab, setTopTab] = useState<TopTab>('shop');
  const [shopFilter, setShopFilter] = useState<ShopFilter>('all');
  const [balance, setBalance] = useState<PrismBalance | null>(null);
  const [loadout, setLoadout] = useState<ForgeLoadout | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [moduleModal, setModuleModal] = useState<{ itemId: string; item: ForgeItem } | null>(null);
  const [confirmModule, setConfirmModule] = useState<{ itemId: string; mod: Micromodule } | null>(null);
  const [installingModule, setInstallingModule] = useState(false);

  // Market state
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [myPurchases, setMyPurchases] = useState<Set<string>>(new Set());
  const [marketLoading, setMarketLoading] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [marketCat, setMarketCat] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // Load data
  useEffect(() => {
    if (!walletAddress) return;
    getPrismBalance(walletAddress).then(setBalance);
    setLoadout(getLocalLoadout(walletAddress));
  }, [walletAddress]);

  // Fetch market data
  const fetchMarket = useCallback(async () => {
    setMarketLoading(true);
    const base = getApiBase();
    try {
      const [listRes, purchRes] = await Promise.all([
        fetch(`${base}/api/marketplace/listings`).then(r => r.ok ? r.json() : { listings: [] }),
        walletAddress ? fetch(`${base}/api/marketplace/my-purchases?address=${walletAddress}`).then(r => r.ok ? r.json() : { purchases: [] }) : { purchases: [] },
      ]);
      setListings(listRes.listings || []);
      setMyPurchases(new Set((purchRes.purchases || []).map((p: any) => p.id)));
    } catch {}
    setMarketLoading(false);
  }, [walletAddress]);

  useEffect(() => {
    if (topTab === 'market') fetchMarket();
  }, [topTab, fetchMarket]);

  // Shop logic
  const filteredItems = useMemo(() => {
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
      const newLoadout = installModule(loadout, itemId, moduleId);
      if (!newLoadout) { toast.error('Cannot install module'); return; }
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
  }, [loadout, balance, walletAddress, installingModule]);

  const isOwned = useCallback((id: string) => loadout?.ownedItems.some((o) => o.itemId === id) ?? false, [loadout]);
  const isEquipped = useCallback((id: string) => {
    if (!loadout) return false;
    return loadout.equippedFrame === id || loadout.equippedAura === id ||
           loadout.equippedShipSkin === id || loadout.equippedTitle === id;
  }, [loadout]);

  // Market buy
  const handleMarketBuy = useCallback(async (listing: MarketListing) => {
    if (!walletAddress) { toast.error('Connect wallet first'); return; }
    setBuying(listing.id);
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/marketplace/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress, listingId: listing.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message);
      setMyPurchases(prev => new Set([...prev, listing.id]));
      if (data.newBalance !== undefined) setBalance(b => b ? { ...b, balance: data.newBalance } : b);
      fetchMarket();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Purchase failed');
    } finally { setBuying(null); }
  }, [walletAddress, fetchMarket]);

  const filteredListings = marketCat ? listings.filter(l => l.category === marketCat) : listings;

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
          <button onClick={() => goBack(navigate)} className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.08] transition-all border border-white/[0.06]">
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
            { id: 'market' as TopTab, label: 'Bazaar', icon: '🎨' },
            { id: 'equipped' as TopTab, label: 'Loadout', icon: '⚔️' },
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
        {/* ═══ ARMORY TAB ═══ */}
        {topTab === 'shop' && (
          <>
            {/* Buy Coins Section */}
            <BuyCoinsSection
              walletAddress={walletAddress}
              onPurchased={() => {
                if (walletAddress) getPrismBalance(walletAddress).then(setBalance);
              }}
            />

            {/* Prism Vault — Staking */}
            <PrismVaultSection
              walletAddress={walletAddress}
              balance={balance?.balance ?? 0}
              onBalanceChange={() => {
                if (walletAddress) getPrismBalance(walletAddress).then(setBalance);
              }}
            />

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
          </>
        )}

        {/* ═══ BAZAAR TAB ═══ */}
        {topTab === 'market' && (
          <>
            {/* Upload toggle — premium button */}
            <button
              onClick={() => setShowUpload(!showUpload)}
              className="w-full mb-5 px-5 py-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all duration-300"
              style={{
                background: showUpload
                  ? 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(236,72,153,0.1))'
                  : 'rgba(168,85,247,0.04)',
                border: `1px dashed rgba(168,85,247,${showUpload ? '0.3' : '0.15'})`,
                color: showUpload ? '#c084fc' : 'rgba(192,132,252,0.6)',
                boxShadow: showUpload ? '0 0 20px rgba(168,85,247,0.1)' : 'none',
              }}
            >
              <Upload className="w-4 h-4" />
              {showUpload ? 'Hide Upload Form' : 'Upload Your Sprite'}
            </button>

            {showUpload && <UploadSection walletAddress={walletAddress} coinBalance={balance?.balance ?? 0} onUploaded={() => { fetchMarket(); setShowUpload(false); }} />}

            {/* Category filter */}
            <div className="flex gap-2 mb-5 overflow-x-auto scrollbar-hide pb-1">
              <button
                onClick={() => setMarketCat(null)}
                className="px-4 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all duration-300"
                style={!marketCat ? {
                  background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(139,92,246,0.15))',
                  color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)',
                } : {
                  background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.35)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >All</button>
              {MARKET_CATEGORIES.map((c) => (
                <button key={c.id} onClick={() => setMarketCat(c.id)}
                  className="px-4 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all duration-300"
                  style={marketCat === c.id ? {
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(139,92,246,0.15))',
                    color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)',
                  } : {
                    background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.35)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                  {c.icon} {c.label}
                </button>
              ))}
            </div>

            {marketLoading ? (
              <div className="flex justify-center py-24">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
                  background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.15)',
                }}>
                  <Loader2 className="w-5 h-5 animate-spin text-purple-400/50" />
                </div>
              </div>
            ) : filteredListings.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{
                  background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.1)',
                }}>
                  <Package className="w-7 h-7 text-purple-400/25" />
                </div>
                <p className="text-white/25 text-sm font-medium mb-1">No models yet</p>
                <p className="text-white/10 text-xs">Be the first to upload!</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredListings.map((l) => (
                  <ListingCard key={l.id} listing={l} owned={myPurchases.has(l.id)} onBuy={() => handleMarketBuy(l)} buying={buying === l.id} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ═══ LOADOUT TAB ═══ */}
        {topTab === 'equipped' && (
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
                Permanent upgrades for equipped items. Max 3 per item. Cannot be removed after install.
              </p>

              {equippedItems.filter(i => i.category === 'frame' || i.category === 'aura').length === 0 ? (
                <p className="text-white/10 text-xs italic py-4 text-center">Equip a frame or aura to install modules</p>
              ) : (
                <div className="space-y-3">
                  {equippedItems.filter(i => i.category === 'frame' || i.category === 'aura').map((item) => {
                    const modules = loadout ? getItemModules(loadout, item.id) : [];
                    const rarityColor = RARITY_COLORS[item.rarity];
                    return (
                      <div key={item.id} className="rounded-xl p-3 border border-white/[0.06] bg-white/[0.02]">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm">{CATEGORY_ICONS[item.category]}</span>
                          <span className="text-white text-xs font-bold">{item.name}</span>
                          <span className={`text-[9px] ml-auto ${modules.length >= 3 ? 'text-green-400' : ''}`} style={modules.length < 3 ? { color: rarityColor } : undefined}>{modules.length >= 3 ? 'Full' : `${modules.length}/3 slots`}</span>
                        </div>
                        <div className="flex gap-2">
                          {[0, 1, 2].map((slotIdx) => {
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
                                onClick={() => setModuleModal({ itemId: item.id, item })}
                                className="flex-1 rounded-lg border border-dashed border-white/[0.08] p-2 flex flex-col items-center justify-center hover:border-purple-500/30 hover:bg-purple-500/5 transition-all"
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

            {/* Purchased market items */}
            {myPurchases.size > 0 && (
              <div className="mt-8">
                <h3 className="text-white/30 text-xs font-bold uppercase tracking-widest mb-4">Purchased Models</h3>
                <div className="grid grid-cols-2 gap-3">
                  {listings.filter(l => myPurchases.has(l.id)).map((l) => (
                    <ListingCard key={l.id} listing={l} owned={true} onBuy={() => {}} buying={false} />
                  ))}
                </div>
                {listings.filter(l => myPurchases.has(l.id)).length === 0 && (
                  <p className="text-white/10 text-xs italic">No purchased models yet</p>
                )}
              </div>
            )}
          </>
        )}

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
