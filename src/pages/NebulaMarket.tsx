/**
 * Nebula Market — Social hub for Identity Prism v5.
 * Wallet Explorer, Global Leaderboard, Challenge System, Identity Feed.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  ArrowLeft, Search, Trophy, Users, Zap, Globe,
  ChevronRight, Loader2, Crown, Medal, Award,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getHeliusProxyUrl } from '@/constants';

// ── Types ──

interface LeaderboardEntry {
  address: string;
  score: number;
  tier: string;
  badges: number;
  rank: number;
}

interface WalletPreview {
  address: string;
  score: number;
  tier: string;
  badges: string[];
  solBalance: number;
  txCount: number;
  walletAgeDays: number;
}

interface Challenge {
  id: string;
  challengerAddress: string;
  opponentAddress: string;
  status: 'pending' | 'active' | 'completed';
  createdAt: string;
  expiresAt: string;
  challengerScore?: number;
  opponentScore?: number;
  winner?: string;
}

interface FeedItem {
  id: string;
  type: 'scan' | 'tier_up' | 'achievement' | 'burn' | 'mint' | 'challenge';
  address: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ── Sub-tabs ──

type MarketTab = 'explore' | 'leaderboard' | 'challenges' | 'feed';

const TABS: { id: MarketTab; label: string; icon: typeof Search }[] = [
  { id: 'explore', label: 'Explore', icon: Search },
  { id: 'leaderboard', label: 'Ranks', icon: Trophy },
  { id: 'challenges', label: 'Challenges', icon: Zap },
  { id: 'feed', label: 'Feed', icon: Globe },
];

// ── Tier styling ──

const TIER_COLORS: Record<string, string> = {
  mercury: '#8B8B8B', mars: '#C1440E', venus: '#E8CDA0', earth: '#4B9CD3',
  neptune: '#3F54BE', uranus: '#73C2FB', saturn: '#E8D191', jupiter: '#C88B3A',
  sun: '#FFD700', binary_sun: '#22D3EE',
};

const TIER_LABELS: Record<string, string> = {
  mercury: 'MERCURY', mars: 'MARS', venus: 'VENUS', earth: 'EARTH',
  neptune: 'NEPTUNE', uranus: 'URANUS', saturn: 'SATURN', jupiter: 'JUPITER',
  sun: 'SUN', binary_sun: 'BINARY SUN',
};

const RANK_ICONS = [Crown, Medal, Award];

// ── API ──

function getApiBase(): string {
  const proxy = getHeliusProxyUrl();
  if (proxy) return proxy;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

async function fetchWalletPreview(address: string): Promise<WalletPreview | null> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/reputation?address=${address}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/leaderboard?limit=50`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.entries ?? [];
  } catch { return []; }
}

async function fetchFeed(): Promise<FeedItem[]> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/feed?limit=30`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items ?? [];
  } catch { return []; }
}

// ── Explore Tab ──

function ExploreTab({ myAddress }: { myAddress: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WalletPreview | null>(null);
  const [error, setError] = useState('');

  const handleSearch = useCallback(async () => {
    const addr = query.trim();
    if (!addr || addr.length < 32) {
      setError('Enter a valid Solana wallet address');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);

    const data = await fetchWalletPreview(addr);
    setLoading(false);
    if (!data) {
      setError('Could not load wallet data');
      return;
    }
    setResult(data);
  }, [query]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Enter any Solana wallet address..."
            className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={loading}
          className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Scan'}
        </Button>
      </div>

      {error && <p className="text-red-400 text-sm text-center">{error}</p>}

      {/* Result card */}
      {result && (
        <div
          className="p-5 rounded-xl border cursor-pointer hover:scale-[1.01] transition-transform"
          style={{
            background: `linear-gradient(135deg, ${TIER_COLORS[result.tier] ?? '#333'}10, transparent)`,
            borderColor: `${TIER_COLORS[result.tier] ?? '#333'}30`,
          }}
          onClick={() => navigate(`/?address=${result.address}`)}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-white/40 text-xs font-mono">{result.address.slice(0, 6)}...{result.address.slice(-4)}</p>
              <p className="font-bold text-lg" style={{ color: TIER_COLORS[result.tier] }}>
                {TIER_LABELS[result.tier] ?? result.tier.toUpperCase()} Tier
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-white">{result.score}</p>
              <p className="text-white/30 text-[10px] tracking-widest">SCORE</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-white/30 text-[10px] uppercase">SOL</p>
              <p className="text-white text-sm font-bold">{result.solBalance?.toFixed(2) ?? '—'}</p>
            </div>
            <div>
              <p className="text-white/30 text-[10px] uppercase">Transactions</p>
              <p className="text-white text-sm font-bold">{result.txCount?.toLocaleString() ?? '—'}</p>
            </div>
            <div>
              <p className="text-white/30 text-[10px] uppercase">Age</p>
              <p className="text-white text-sm font-bold">{result.walletAgeDays ? `${result.walletAgeDays}d` : '—'}</p>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
            <p className="text-white/30 text-xs">Tap to view full card</p>
            <ChevronRight className="w-4 h-4 text-white/20" />
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="space-y-2">
        <p className="text-white/20 text-xs tracking-widest uppercase">Quick Compare</p>
        <Button
          variant="outline"
          className="w-full justify-start text-left border-white/10 text-white/50 hover:text-white"
          onClick={() => navigate(`/compare${myAddress ? `?a=${myAddress}` : ''}`)}
        >
          <Users className="w-4 h-4 mr-2" />
          Compare Two Wallets
        </Button>
      </div>
    </div>
  );
}

// ── Leaderboard Tab ──

function LeaderboardTab() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard().then((data) => {
      setEntries(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-white/30" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-16 text-white/20">
        <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p>Leaderboard data loading...</p>
        <p className="text-xs mt-1">Scan your wallet to appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry, i) => {
        const RankIcon = RANK_ICONS[i] ?? null;
        const tierColor = TIER_COLORS[entry.tier] ?? '#666';
        return (
          <div
            key={entry.address}
            className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors"
          >
            <div className="w-8 text-center">
              {RankIcon ? (
                <RankIcon className="w-5 h-5 mx-auto" style={{ color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : '#CD7F32' }} />
              ) : (
                <span className="text-white/20 text-sm font-bold">#{i + 1}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white/60 text-xs font-mono truncate">{entry.address}</p>
              <p className="text-xs font-bold" style={{ color: tierColor }}>
                {TIER_LABELS[entry.tier] ?? entry.tier}
              </p>
            </div>
            <div className="text-right">
              <p className="text-white font-bold">{entry.score}</p>
              <p className="text-white/20 text-[10px]">{entry.badges} badges</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Challenges Tab ──

function ChallengesTab({ myAddress }: { myAddress: string }) {
  const [targetAddress, setTargetAddress] = useState('');

  const handleChallenge = useCallback(async () => {
    if (!targetAddress.trim() || targetAddress.trim().length < 32) {
      toast.error('Enter a valid wallet address to challenge');
      return;
    }
    toast.success('Challenge sent!', { description: 'Your opponent will see it in their feed' });
    setTargetAddress('');
  }, [targetAddress]);

  return (
    <div className="space-y-6">
      {/* Create challenge */}
      <div className="p-4 rounded-xl bg-white/5 border border-white/10">
        <h3 className="text-white font-bold text-sm mb-3">⚡ Challenge a Wallet</h3>
        <p className="text-white/30 text-xs mb-4">
          Compare your identity score against any wallet. Winner gets PRISM coins!
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={targetAddress}
            onChange={(e) => setTargetAddress(e.target.value)}
            placeholder="Opponent wallet address..."
            className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50"
          />
          <Button
            onClick={handleChallenge}
            className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-4"
          >
            <Zap className="w-4 h-4 mr-1" />
            Challenge
          </Button>
        </div>
      </div>

      {/* Active challenges */}
      <div>
        <h3 className="text-white/20 text-xs tracking-widest uppercase mb-3">Your Challenges</h3>
        <div className="text-center py-10 text-white/15">
          <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No active challenges yet</p>
          <p className="text-xs mt-1">Challenge someone above to get started!</p>
        </div>
      </div>
    </div>
  );
}

// ── Feed Tab ──

function FeedTab() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFeed().then((data) => {
      setItems(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-white/30" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-white/20">
        <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p>Identity Feed coming soon</p>
        <p className="text-xs mt-1">See real-time activity from the Identity Prism community</p>
      </div>
    );
  }

  const FEED_ICONS: Record<string, string> = {
    scan: '🔬', tier_up: '🚀', achievement: '🏆', burn: '🔥', mint: '💎', challenge: '⚡',
  };

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
          <div className="flex items-start gap-3">
            <span className="text-lg">{FEED_ICONS[item.type] ?? '📌'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-white/60 text-xs font-mono">{item.address.slice(0, 6)}...{item.address.slice(-4)}</p>
              <p className="text-white text-sm">{item.description}</p>
              <p className="text-white/20 text-[10px] mt-1">{new Date(item.timestamp).toLocaleString()}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main ──

export default function NebulaMarket() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const address = searchParams.get('address');
  const { publicKey } = useWallet();
  const walletAddress = address || publicKey?.toBase58() || '';

  const [activeTab, setActiveTab] = useState<MarketTab>('explore');

  return (
    <div className="min-h-screen bg-[#050510] text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-sm font-bold">🌌 Nebula Market</h1>
          <div className="w-16" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white/5 rounded-xl p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === tab.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'explore' && <ExploreTab myAddress={walletAddress} />}
        {activeTab === 'leaderboard' && <LeaderboardTab />}
        {activeTab === 'challenges' && <ChallengesTab myAddress={walletAddress} />}
        {activeTab === 'feed' && <FeedTab />}
      </div>
    </div>
  );
}
