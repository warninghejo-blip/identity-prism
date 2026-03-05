/**
 * Coin Shop — unified shop + marketplace.
 * Tabs: Shop (buy items with Coins) | Creator Market (user sprites) | Equipped (loadout)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import {
  ArrowLeft, ShoppingBag, Check, Lock, Sparkles, Coins,
  Upload, Download, Loader2, Package, AlertTriangle,
} from 'lucide-react';
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
  type ForgeCategory,
  type ForgeItem,
  type ForgeLoadout,
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
const FRAME_STYLES: Record<string, React.CSSProperties> = {
  nebula: { border: '3px solid transparent', borderImage: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 50%, #c084fc 100%) 1', boxShadow: '0 0 12px rgba(168,85,247,0.3), inset 0 0 12px rgba(168,85,247,0.1)' },
  solar_flare: { border: '3px solid transparent', borderImage: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 40%, #ef4444 100%) 1', boxShadow: '0 0 16px rgba(245,158,11,0.4), inset 0 0 8px rgba(245,158,11,0.15)' },
  void: { border: '3px solid rgba(30,0,60,0.8)', boxShadow: '0 0 20px rgba(100,0,200,0.3), inset 0 0 20px rgba(0,0,0,0.5), 0 0 40px rgba(80,0,160,0.15)' },
  quantum: { border: '2px dashed rgba(34,211,238,0.5)', boxShadow: '0 0 12px rgba(34,211,238,0.2), inset 0 0 8px rgba(34,211,238,0.1)' },
  supernova: { border: '3px solid transparent', borderImage: 'linear-gradient(135deg, #fbbf24, #ef4444, #ec4899, #a855f7, #3b82f6) 1', boxShadow: '0 0 25px rgba(251,191,36,0.3), 0 0 50px rgba(239,68,68,0.15)' },
  event_horizon: { border: '4px solid rgba(0,0,0,0.9)', boxShadow: '0 0 30px rgba(100,0,200,0.4), inset 0 0 30px rgba(0,0,0,0.7), 0 0 60px rgba(139,92,246,0.2)' },
};

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
    const tint = SHIP_TINTS[item.preview] || { filter: 'none', shadow: 'none' };
    return (
      <div className="w-full h-28 rounded-lg flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, rgba(10,15,30,0.9), rgba(5,7,10,0.95))' }}>
        <img
          src="/textures/ship.png"
          alt={item.name}
          style={{
            width: 56, height: 56, objectFit: 'contain',
            filter: tint.filter,
            transform: 'rotate(0deg)',
            ...(tint.shadow ? { filter: `${tint.filter} drop-shadow(${tint.shadow.split(',')[0].replace('0 0', '0 0')})` } : {}),
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
function UploadSection({ walletAddress, onUploaded }: { walletAddress: string; onUploaded: () => void }) {
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
      <Button className="w-full h-12 bg-purple-600 hover:bg-purple-500 font-bold" onClick={handleUpload} disabled={!file || !name.trim() || uploading || Number(price) < 1 || Number(price) > 10000}>
        {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
        {uploading ? 'Uploading...' : 'Upload Model'}
      </Button>
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
      toast.success(`Acquired ${item.name}!`, { description: `−${item.price} Coins` });
      import('@/lib/prismQuests').then(({ getQuestState, incrementQuest }) => {
        const qs = getQuestState(walletAddress);
        incrementQuest(qs, 'weekly_forge');
        incrementQuest(qs, 'ot_forge5');
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
    <div className="h-screen flex flex-col text-white" style={{
      background: 'linear-gradient(180deg, #05070a 0%, #0a0e1a 30%, #0d0a18 60%, #08060f 100%)',
    }}>
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
            }}>Stellar Forge</h1>
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

            {showUpload && <UploadSection walletAddress={walletAddress} onUploaded={() => { fetchMarket(); setShowUpload(false); }} />}

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
  );
}
