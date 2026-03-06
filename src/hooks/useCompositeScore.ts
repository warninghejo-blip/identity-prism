import { useState, useEffect } from 'react';
import { getHeliusProxyUrl } from '@/constants';

interface CompositeBreakdown {
  onchain: number;
  sybilTrust: number;
  humanProof: number;
  social: number;
  engagement: number;
}

export interface ScoreDetails {
  onchain: { identityScore: number; identityMax: number; basePts: number; badgeBonus: number; hasSeeker: boolean; hasPreorder: boolean; hasCombo: boolean };
  sybilTrust: { trustScore: number; trustMax: number };
  humanProof: { gameScoreTotal: number; gameDiversity: number; achievementPts: number; achievementCount: number; gameTypesCount: number };
  social: { challengesWon: number; challengePts: number; constellationExplored: number; constellationPts: number; compareCount: number; comparePts: number };
  engagement: { questsCompleted: number; questPts: number; streakDays: number; streakPts: number; scanCount: number; scanPts: number };
}

interface CompositeData {
  score: number;
  tier: string;
  breakdown: CompositeBreakdown;
  details: ScoreDetails | null;
  isLoading: boolean;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 min
const CACHE_KEY_PREFIX = 'ip_composite_';

export function useCompositeScore(address: string | null): CompositeData {
  const [data, setData] = useState<CompositeData>({
    score: 0,
    tier: 'mercury',
    breakdown: { onchain: 0, sybilTrust: 0, humanProof: 0, social: 0, engagement: 0 },
    details: null,
    isLoading: true,
  });

  useEffect(() => {
    if (!address) {
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

    const proxyUrl = getHeliusProxyUrl() || '';
    fetch(`${proxyUrl}/api/wallet-database?address=${address}`)
      .then(r => r.ok ? r.json() : null)
      .then(wallet => {
        if (!wallet) return;
        const composite = wallet.composite || {
          compositeScore: 0,
          compositeTier: wallet.tier || 'mercury',
          breakdown: { onchain: 0, sybilTrust: 0, humanProof: 0, social: 0, engagement: 0 },
        };
        const result = {
          score: composite.compositeScore,
          tier: composite.compositeTier,
          breakdown: composite.breakdown,
          details: wallet.scoreDetails || composite.details || null,
        };
        setData({ ...result, isLoading: false });
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ data: result, ts: Date.now() }));
        } catch {}
      })
      .catch(() => setData(d => ({ ...d, isLoading: false })));
  }, [address]);

  return data;
}
