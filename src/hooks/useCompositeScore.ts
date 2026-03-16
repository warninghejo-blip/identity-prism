import { useState, useEffect, useCallback } from 'react';
import { getHeliusProxyUrl } from '@/constants';

interface CompositeBreakdown {
  onchain: number;
  sybilTrust: number;
  humanProof: number;
  social: number;
  engagement: number;
}

export interface OnchainBreakdownItem {
  pts: number; max: number; raw?: number;
  items?: string[];
  swapPts?: number; nftTradePts?: number; protocolPts?: number; swaps?: number; protocols?: number;
}

export interface ScoreDetails {
  onchain: {
    identityScore: number; identityMax: number; basePts: number; badgeBonus: number;
    hasSeeker: boolean; hasPreorder: boolean; hasCombo: boolean;
    scoreBreakdown?: {
      solBalance: OnchainBreakdownItem; walletAge: OnchainBreakdownItem;
      transactions: OnchainBreakdownItem; nfts: OnchainBreakdownItem;
      defiActivity: OnchainBreakdownItem; badges: OnchainBreakdownItem;
      collection: OnchainBreakdownItem;
    } | null;
  };
  sybilTrust: { trustScore: number; trustMax: number; badgeBonus?: number };
  humanProof: { gameScoreTotal: number; gameDiversity: number; achievementPts: number; achievementCount: number; gameTypesCount: number; badgeBonus?: number };
  social: { challengesWon: number; challengePts: number; constellationExplored: number; constellationPts: number; compareCount: number; comparePts: number; badgeBonus?: number };
  engagement: { questsCompleted: number; questPts: number; streakDays: number; streakPts: number; scanCount: number; scanPts: number; badgeBonus?: number };
}

interface CompositeData {
  score: number;
  tier: string;
  breakdown: CompositeBreakdown;
  details: ScoreDetails | null;
  isLoading: boolean;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 min
const CACHE_KEY_PREFIX = 'ip_composite_v2_';

export function invalidateCompositeCache(address: string) {
  try { sessionStorage.removeItem(`${CACHE_KEY_PREFIX}${address}`); } catch {}
}

export function useCompositeScore(address: string | null): CompositeData & { refetch: () => void } {
  const [data, setData] = useState<CompositeData>({
    score: 0,
    tier: 'mercury',
    breakdown: { onchain: 0, sybilTrust: 0, humanProof: 0, social: 0, engagement: 0 },
    details: null,
    isLoading: true,
  });
  const [fetchTick, setFetchTick] = useState(0);

  const refetch = useCallback(() => {
    if (address) invalidateCompositeCache(address);
    setFetchTick(t => t + 1);
  }, [address]);

  useEffect(() => {
    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      setData(d => ({ ...d, isLoading: false }));
      return;
    }

    // Check sessionStorage cache
    const cacheKey = `${CACHE_KEY_PREFIX}${address}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { data: cachedData, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) {
          setData({ ...cachedData, isLoading: false });
          return;
        }
      }
    } catch {}

    let cancelled = false;
    const proxyUrl = getHeliusProxyUrl() || '';
    fetch(`${proxyUrl}/api/wallet-database?address=${encodeURIComponent(address)}`)
      .then(r => r.ok ? r.json() : null)
      .then(wallet => {
        if (cancelled) return;
        if (!wallet) { setData(d => ({ ...d, isLoading: false })); return; }
        const composite = wallet.composite || {
          compositeScore: 0,
          compositeTier: wallet.tier || 'mercury',
          breakdown: { onchain: 0, sybilTrust: 0, humanProof: 0, social: 0, engagement: 0 },
        };
        const details: ScoreDetails | null = wallet.scoreDetails || composite.details || null;
        // Merge top-level scoreBreakdown into composite details if missing
        // (composite may have been computed before wallet was fully scanned)
        if (details?.onchain && !details.onchain.scoreBreakdown && wallet.scoreBreakdown) {
          details.onchain.scoreBreakdown = wallet.scoreBreakdown;
        }
        const result = {
          score: composite.compositeScore,
          tier: composite.compositeTier,
          breakdown: composite.breakdown,
          details,
        };
        setData({ ...result, isLoading: false });
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ data: result, ts: Date.now() }));
        } catch {}
      })
      .catch(() => { if (!cancelled) setData(d => ({ ...d, isLoading: false })); });
    return () => { cancelled = true; };
  }, [address, fetchTick]);

  return { ...data, refetch };
}
