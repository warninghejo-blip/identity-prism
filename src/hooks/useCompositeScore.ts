import { useState, useEffect, useCallback, useRef } from 'react';
import { getHeliusProxyUrl } from '@/constants';

interface CompositeBreakdown {
  onchain: number;
  sybilTrust: number;
  humanProof: number;
  social: number;
  engagement: number;
}

export interface OnchainBreakdownItem {
  pts: number;
  max: number;
  raw?: number;
  items?: string[];
  swapPts?: number;
  nftTradePts?: number;
  protocolPts?: number;
  swaps?: number;
  protocols?: number;
}

export interface ScoreDetails {
  onchain: {
    identityScore: number;
    identityMax: number;
    basePts: number;
    badgeBonus: number;
    hasSeeker: boolean;
    hasPreorder: boolean;
    hasCombo: boolean;
    scoreBreakdown?: {
      solBalance: OnchainBreakdownItem;
      walletAge: OnchainBreakdownItem;
      transactions: OnchainBreakdownItem;
      nfts: OnchainBreakdownItem;
      defiActivity: OnchainBreakdownItem;
      badges: OnchainBreakdownItem;
      collection: OnchainBreakdownItem;
    } | null;
  };
  sybilTrust: {
    trustScore: number;
    rawTrustScore?: number;
    baseCompositeTrust?: number;
    adjustedTrust?: number;
    effectiveTrust?: number;
    trustMax: number;
    verdictKey?: string | null;
    verdictLabel?: string | null;
    verdictAdjustment?: number;
    badgeBonus?: number;
    recoveryBonus?: number;
    recoveryCap?: number;
  };
  humanProof: {
    gameScoreTotal: number;
    gameDiversity: number;
    achievementPts: number;
    achievementCount: number;
    gameTypesCount: number;
    badgeBonus?: number;
  };
  social: {
    challengesWon: number;
    challengePts: number;
    constellationExplored: number;
    constellationPts: number;
    compareCount: number;
    comparePts: number;
    badgeBonus?: number;
  };
  engagement: {
    questsCompleted: number;
    questPts: number;
    streakDays: number;
    streakPts: number;
    scanCount: number;
    scanPts: number;
    badgeBonus?: number;
  };
}

interface CompositeData {
  score: number;
  tier: string;
  breakdown: CompositeBreakdown;
  details: ScoreDetails | null;
  isLoading: boolean;
  hasComposite: boolean;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 min
const CACHE_KEY_PREFIX = 'ip_composite_v2_';
const EMPTY_BREAKDOWN: CompositeBreakdown = {
  onchain: 0,
  sybilTrust: 0,
  humanProof: 0,
  social: 0,
  engagement: 0,
};

const buildOnchainFallbackBreakdown = (score: number): CompositeBreakdown => ({
  ...EMPTY_BREAKDOWN,
  onchain: Math.max(0, Math.min(Math.round(score), 400)),
});

const normalizeCachedData = (cachedData: Partial<CompositeData>): CompositeData => ({
  score: typeof cachedData.score === 'number' ? cachedData.score : 0,
  tier: typeof cachedData.tier === 'string' && cachedData.tier ? cachedData.tier : 'mercury',
  breakdown: cachedData.breakdown ?? EMPTY_BREAKDOWN,
  details: cachedData.details ?? null,
  isLoading: false,
  hasComposite: cachedData.hasComposite === true,
});

const INITIAL_COMPOSITE_DATA: CompositeData = {
  score: 0,
  tier: 'mercury',
  breakdown: EMPTY_BREAKDOWN,
  details: null,
  isLoading: true,
  hasComposite: false,
};

export function invalidateCompositeCache(address: string) {
  try {
    sessionStorage.removeItem(`${CACHE_KEY_PREFIX}${address}`);
  } catch {}
}

export function useCompositeScore(address: string | null): CompositeData & { refetch: () => void } {
  const [data, setData] = useState<CompositeData>(INITIAL_COMPOSITE_DATA);
  const [fetchTick, setFetchTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    if (address) invalidateCompositeCache(address);
    setFetchTick((t) => t + 1);
  }, [address]);

  useEffect(() => {
    // Cancel any pending debounce and in-flight request
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      setData({ ...INITIAL_COMPOSITE_DATA, isLoading: false });
      return;
    }

    // Check sessionStorage cache
    const cacheKey = `${CACHE_KEY_PREFIX}${address}`;
    let staleCachedData: CompositeData | null = null;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { data: rawCachedData, ts } = JSON.parse(cached);
        const cachedData = normalizeCachedData(rawCachedData);
        if (Date.now() - ts < CACHE_TTL) {
          setData(cachedData);
          return;
        }
        staleCachedData = cachedData;
        setData({ ...cachedData, isLoading: true });
      }
    } catch {}

    // Debounce: wait 200ms before firing request (collapses rapid re-renders)
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;

      const proxyUrl = getHeliusProxyUrl() || '';
      fetch(`${proxyUrl}/api/wallet-database?address=${encodeURIComponent(address)}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((wallet) => {
          if (controller.signal.aborted) return;
          if (!wallet) {
            setData(
              staleCachedData
                ? { ...staleCachedData, isLoading: false }
                : { ...INITIAL_COMPOSITE_DATA, isLoading: false },
            );
            return;
          }
          const fallbackScore = typeof wallet.score === 'number' ? wallet.score : 0;
          const fallbackTier = typeof wallet.tier === 'string' && wallet.tier ? wallet.tier : 'mercury';
          const hasComposite = Boolean(wallet.composite);
          const fallbackBreakdown = buildOnchainFallbackBreakdown(fallbackScore);
          const composite = wallet.composite
            ? {
                compositeScore:
                  typeof wallet.composite.compositeScore === 'number' ? wallet.composite.compositeScore : fallbackScore,
                compositeTier:
                  typeof wallet.composite.compositeTier === 'string' && wallet.composite.compositeTier
                    ? wallet.composite.compositeTier
                    : fallbackTier,
                breakdown: wallet.composite.breakdown ?? fallbackBreakdown,
                details: wallet.composite.details ?? null,
              }
            : {
                compositeScore: fallbackScore,
                compositeTier: fallbackTier,
                breakdown: fallbackBreakdown,
                details: null,
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
            hasComposite,
          };
          setData({ ...result, isLoading: false });
          // Sync tournament XP from server to localStorage for ranger rank calculation
          // Always write (even 0) to clear stale values
          if (address) {
            try {
              const txp = wallet.tournamentXP || 0;
              localStorage.setItem(`prism_tournament_xp_${address}`, String(txp));
            } catch {}
            // Sync arenaWeeklyXP from socialStats (written by weekly arena settlement)
            try {
              const awxp = wallet.socialStats?.arenaWeeklyXP || 0;
              localStorage.setItem(`prism_arena_weekly_xp_${address}`, String(awxp));
            } catch {}
          }
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ data: result, ts: Date.now() }));
          } catch {}
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (!controller.signal.aborted) {
            setData(
              staleCachedData
                ? { ...staleCachedData, isLoading: false }
                : { ...INITIAL_COMPOSITE_DATA, isLoading: false },
            );
          }
        });
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [address, fetchTick]);

  return { ...data, refetch };
}
