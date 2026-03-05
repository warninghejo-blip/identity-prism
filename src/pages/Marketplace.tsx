/**
 * Prism Marketplace — Upload, browse, and purchase user 3D models.
 * Models are validated (GLB format, magic bytes), stored on server,
 * purchasable with Coins coins (80% to seller, 20% platform fee).
 * Mobile-first layout.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import {
  ArrowLeft, Upload, ShoppingBag, Download, Loader2, Check,
  Package, Star, Coins, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getHeliusProxyUrl } from '@/constants';
import { getPrismBalance, type PrismBalance } from '@/lib/prismCoin';

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

function getApiBase(): string {
  const proxy = getHeliusProxyUrl();
  if (proxy) return proxy;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

type Tab = 'browse' | 'upload' | 'my-items';

const CATEGORIES = [
  { id: 'ship', label: 'Ships', icon: '🚀' },
  { id: 'planet', label: 'Planets', icon: '🪐' },
  { id: 'badge', label: 'Badges', icon: '🏅' },
  { id: 'decoration', label: 'Decor', icon: '✨' },
];

function ListingCard({ listing, owned, onBuy, buying }: {
  listing: MarketListing;
  owned: boolean;
  onBuy: () => void;
  buying: boolean;
}) {
  const catIcon = CATEGORIES.find(c => c.id === listing.category)?.icon || '📦';

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 hover:bg-white/[0.05] transition-all">
      {/* Preview */}
      <div className="w-full aspect-square rounded-lg mb-3 bg-gradient-to-br from-purple-500/10 to-cyan-500/10 flex items-center justify-center overflow-hidden">
        {listing.previewImage ? (
          <img src={listing.previewImage} alt={listing.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-4xl">{catIcon}</span>
        )}
      </div>

      {/* Info */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="text-white font-bold text-sm truncate">{listing.name}</h3>
          <p className="text-white/30 text-[10px] truncate">{listing.description || 'No description'}</p>
        </div>
        <span className="text-[10px] text-white/20 font-mono uppercase flex-shrink-0">.{listing.format}</span>
      </div>

      {/* Seller + stats */}
      <div className="flex items-center justify-between text-[10px] text-white/20 mb-3">
        <span>{listing.seller.slice(0, 4)}...{listing.seller.slice(-4)}</span>
        <span className="flex items-center gap-1">
          <Download className="w-3 h-3" /> {listing.purchaseCount}
        </span>
      </div>

      {/* Action */}
      {owned ? (
        <div className="flex items-center gap-2 text-green-400 text-xs font-bold py-2">
          <Check className="w-4 h-4" /> Owned
        </div>
      ) : (
        <Button
          size="sm"
          className="w-full h-10 text-xs font-bold bg-purple-600 hover:bg-purple-500"
          onClick={onBuy}
          disabled={buying}
        >
          {buying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3 mr-1" />}
          {listing.price} Coins
        </Button>
      )}
    </div>
  );
}

function UploadTab({ walletAddress, onUploaded }: { walletAddress: string; onUploaded: () => void }) {
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
    if (!['glb', 'gltf', 'obj'].includes(ext)) {
      setError('Only .glb, .gltf, .obj files supported');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('File too large (max 5 MB)');
      return;
    }
    setFile(f);
    setError('');
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  };

  const handleUpload = useCallback(async () => {
    if (!file || !name.trim() || !walletAddress) return;
    setUploading(true);
    setError('');

    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const ext = file.name.split('.').pop()?.toLowerCase() || 'glb';
      const base = getApiBase();
      const res = await fetch(`${base}/api/marketplace/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: walletAddress,
          name: name.trim(),
          description: description.trim(),
          category,
          price: Number(price) || 50,
          modelData: base64,
          modelFormat: ext,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      toast.success('Model uploaded!', { description: `"${name}" is now listed on the marketplace` });
      setFile(null);
      setName('');
      setDescription('');
      onUploaded();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }, [file, name, description, category, price, walletAddress, onUploaded]);

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/8 space-y-4">
        <h3 className="text-white font-bold text-sm flex items-center gap-2">
          <Upload className="w-4 h-4 text-purple-400" />
          Upload Your 3D Model
        </h3>

        <p className="text-white/25 text-xs leading-relaxed">
          Upload a .glb, .gltf, or .obj model (max 5MB). Other players can purchase it with Coins coins.
          You earn 80% of each sale.
        </p>

        {/* File picker */}
        <div>
          <input ref={fileRef} type="file" accept=".glb,.gltf,.obj" onChange={handleFileChange} className="hidden" />
          <Button
            variant="outline"
            className="w-full h-12 border-dashed border-white/10 text-white/40 hover:text-white hover:border-purple-500/30"
            onClick={() => fileRef.current?.click()}
          >
            {file ? `📦 ${file.name} (${(file.size / 1024).toFixed(0)} KB)` : '📁 Choose .glb / .gltf / .obj file'}
          </Button>
        </div>

        {/* Name */}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Model name..."
          maxLength={60}
          className="w-full px-3 py-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50"
          style={{ fontSize: 16 }}
        />

        {/* Description */}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description (optional)..."
          maxLength={200}
          rows={2}
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50 resize-none"
          style={{ fontSize: 16 }}
        />

        {/* Category + Price */}
        <div className="flex gap-3">
          <div className="flex-1">
            <p className="text-white/30 text-[10px] mb-1 uppercase tracking-wider">Category</p>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <p className="text-white/30 text-[10px] mb-1 uppercase tracking-wider">Price (Coins)</p>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              min={1}
              max={10000}
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none text-center font-mono"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs">
            <AlertTriangle className="w-3 h-3" /> {error}
          </div>
        )}

        <Button
          className="w-full h-12 bg-purple-600 hover:bg-purple-500 font-bold"
          onClick={handleUpload}
          disabled={!file || !name.trim() || uploading}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
          {uploading ? 'Uploading & Validating...' : 'Upload Model'}
        </Button>
      </div>

      <div className="text-center text-white/15 text-[10px] leading-relaxed">
        Supported: GLB (glTF 2.0), GLTF, OBJ · Max 5MB · GLB files validated via magic bytes
      </div>
    </div>
  );
}

export default function Marketplace() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { publicKey } = useWallet();
  const walletAddress = searchParams.get('address') || publicKey?.toBase58() || '';

  const [tab, setTab] = useState<Tab>('browse');
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [myPurchases, setMyPurchases] = useState<Set<string>>(new Set());
  const [balance, setBalance] = useState<PrismBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const base = getApiBase();
    try {
      const [listRes, purchRes] = await Promise.all([
        fetch(`${base}/api/marketplace/listings`).then(r => r.ok ? r.json() : { listings: [] }),
        walletAddress ? fetch(`${base}/api/marketplace/my-purchases?address=${walletAddress}`).then(r => r.ok ? r.json() : { purchases: [] }) : { purchases: [] },
      ]);
      setListings(listRes.listings || []);
      setMyPurchases(new Set((purchRes.purchases || []).map((p: any) => p.id)));
    } catch {}
    setLoading(false);
  }, [walletAddress]);

  useEffect(() => {
    fetchData();
    if (walletAddress) getPrismBalance(walletAddress).then(setBalance).catch(() => {});
  }, [fetchData, walletAddress]);

  const handleBuy = useCallback(async (listing: MarketListing) => {
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
      fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Purchase failed');
    } finally {
      setBuying(null);
    }
  }, [walletAddress, fetchData]);

  const filteredListings = filterCat ? listings.filter(l => l.category === filterCat) : listings;

  return (
    <div className="min-h-screen bg-[#050510] text-white pb-safe">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={() => goBack(navigate)} className="flex items-center gap-2 text-white/50 hover:text-white text-sm">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            <span className="text-lg">💎</span>
            <span className="text-purple-300 font-bold font-mono">{balance?.balance ?? 0}</span>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5">
        <h1 className="text-xl font-black mb-1">🏪 Prism Marketplace</h1>
        <p className="text-white/30 text-xs mb-5">Upload & buy 3D models for your games</p>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-white/5 rounded-xl p-1">
          {([['browse', '🛒 Browse'], ['upload', '📤 Upload'], ['my-items', '📦 My Items']] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${tab === id ? 'bg-white/10 text-white' : 'text-white/30'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'upload' && <UploadTab walletAddress={walletAddress} onUploaded={fetchData} />}

        {tab === 'browse' && (
          <>
            {/* Category filter */}
            <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide pb-1">
              <button
                onClick={() => setFilterCat(null)}
                className={`px-3 py-1.5 rounded-full text-[10px] font-bold whitespace-nowrap ${!filterCat ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-white/5 text-white/30 border border-white/5'}`}
              >
                All
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setFilterCat(c.id)}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-bold whitespace-nowrap ${filterCat === c.id ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-white/5 text-white/30 border border-white/5'}`}
                >
                  {c.icon} {c.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-white/20" /></div>
            ) : filteredListings.length === 0 ? (
              <div className="text-center py-16 text-white/15">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No models yet</p>
                <p className="text-xs mt-1">Be the first to upload!</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredListings.map((l) => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    owned={myPurchases.has(l.id)}
                    onBuy={() => handleBuy(l)}
                    buying={buying === l.id}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'my-items' && (
          <>
            {listings.filter(l => myPurchases.has(l.id)).length === 0 ? (
              <div className="text-center py-16 text-white/15">
                <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No purchased models</p>
                <p className="text-xs mt-1">Browse and buy from the marketplace</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {listings.filter(l => myPurchases.has(l.id)).map((l) => (
                  <ListingCard key={l.id} listing={l} owned={true} onBuy={() => {}} buying={false} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
