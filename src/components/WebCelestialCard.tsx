import { Suspense, useCallback, useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { fetchApiJson, fetchSybilAnalysis } from '@/components/prism/shared';
import { riskBand, verdictFromScore } from '@/lib/sybilVerdict';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float, OrbitControls } from '@react-three/drei';
import {
  Sparkles as SparklesIcon,
  RotateCw,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowDownLeft,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Planet3D } from './Planet3D';
import type { WalletData, WalletTraits, PlanetTier } from '@/hooks/useWalletData';

import { getRandomFunnyFact } from '@/utils/funnyFacts';
import { getHeliusProxyUrl, getAppBaseUrl } from '@/constants';
import CompositeScoreBreakdown from '@/components/CompositeScoreBreakdown';
import TrustGradeBadge from '@/components/TrustGradeBadge';
import { useCompositeScore, type ScoreDetails } from '@/hooks/useCompositeScore';
import { FRAME_STYLES, AURA_GLOW_MAP } from '@/lib/forgeItems';
import { getBoostedCompositeScore } from '@/lib/shipStats';
import { CosmicStarfield } from '@/components/CosmicStarfield';
import { gatherXPSourcesMerged, computeRangerXP, getRangerRank, getRankProgress } from '@/lib/rangerRanks';

const IS_MOBILE = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

/** Waits for the Three.js render loop to produce real frames AND textures to load before signaling ready. */
function FrameDetector({ onReady, texturesReady }: { onReady?: () => void; texturesReady: boolean }) {
  const fired = useRef(false);
  const frameCount = useRef(0);
  const readyTime = useRef(0);
  useFrame((_, delta) => {
    if (fired.current || !onReady) return;
    // Only start counting frames once textures are loaded
    if (!texturesReady) return;
    frameCount.current += 1;
    readyTime.current += delta;
    // Wait for 25 frames AND at least 400ms after textures load so GPU has
    // fully composited the textured planet (heavier tiers like binary_sun need more time)
    if (frameCount.current >= 25 && readyTime.current >= 0.4) {
      fired.current = true;
      onReady();
    }
  });
  return null;
}

interface SybilSignal {
  id: string;
  name: string;
  detected: boolean;
  weight: number;
  severity: string;
  category?: string;
  value?: string;
  description?: string;
}

interface SybilMetrics {
  walletAgeDays: number;
  activeDaysCount: number;
  activeDaysRatio: number;
  tokenDiversityCount: number;
  nftCount: number;
  incomingVolume: number;
  outgoingVolume: number;
  flowRatio: number;
  dustRatio: number;
  uniquePrograms: number;
  balance: number;
  historicalMaxBalance: number;
  txCount: number;
  clusterSimilarity: number;
}

interface SybilCardRisk {
  riskScore: number;
  riskLevel: string;
  trustScore: number;
  trustGrade: string;
  signals?: SybilSignal[];
  metrics?: SybilMetrics;
}

const deriveTrustGrade = (trustScore: number) =>
  trustScore >= 90
    ? 'A+'
    : trustScore >= 80
      ? 'A'
      : trustScore >= 70
        ? 'B'
        : trustScore >= 60
          ? 'C'
          : trustScore >= 50
            ? 'D'
            : 'F';

const deriveRiskLevel = (riskScore: number) => riskBand(riskScore).label.toLowerCase().replace(/\s+/g, '_');

const getTrustStatusLabel = (risk: SybilCardRisk) => {
  const txCount = risk.metrics?.txCount ?? 0;
  if (risk.trustScore <= 10 && txCount === 0) return 'Thin wallet';
  return verdictFromScore(risk.riskScore);
};

interface CelestialCardProps {
  data: WalletData;
  captureMode?: boolean;
  captureView?: 'front' | 'back';
  captureTab?: 'stats' | 'badges' | 'intel';
  fromBlackHole?: boolean;
  onSceneReady?: () => void;
  staticFront?: boolean;
  liveData?: boolean;
  compositeOverride?: {
    score: number;
    tier: PlanetTier;
    breakdown?: {
      onchain: number;
      sybilTrust: number;
      humanProof: number;
      social: number;
      engagement: number;
    };
    details?: ScoreDetails | null;
  };
}

import {
  COMPOSITE_TIER_THRESHOLDS,
  TIER_COLORS_TW as TIER_COLORS,
  TIER_HEX,
  TIER_LABELS,
  getCompositeTierFromScore,
} from '@/lib/constants/tierColors';

export const CelestialCard = forwardRef<HTMLDivElement, CelestialCardProps>(function CelestialCard(
  {
    data,
    captureMode = false,
    captureView = 'front',
    captureTab = 'stats',
    fromBlackHole = false,
    onSceneReady,
    staticFront = false,
    liveData = true,
    compositeOverride,
  },
  ref,
) {
  const [isFlipped, setIsFlipped] = useState(captureView === 'back');
  const [isInteracting, setIsInteracting] = useState(false);
  const [texturesReady, setTexturesReady] = useState(false);
  const handleTexturesReady = useCallback(() => setTexturesReady(true), []);
  const [planetVisible, setPlanetVisible] = useState(Boolean(captureMode));
  const handleSceneReady = useCallback(() => {
    setPlanetVisible(true);
    onSceneReady?.();
  }, [onSceneReady]);
  const [shakeWarning, setShakeWarning] = useState(false);
  const [jumpingToGame, setJumpingToGame] = useState(false);
  const [suckingIn, setSuckingIn] = useState(false);
  const [consuming, setConsuming] = useState(false);
  const [unsucking, setUnsucking] = useState(false);

  const [sybilRisk, setSybilRisk] = useState<SybilCardRisk | null>(null);
  const [reputationSignals, setReputationSignals] = useState<{
    temporalCohortScore?: number;
    fundingDepth?: number;
    splFlowDetected?: boolean;
    hubSpokeScore?: number;
    adaptiveThresholdTriggered?: boolean;
    version?: number;
  } | null>(null);
  const [fundingSources, setFundingSources] = useState<
    {
      address: string;
      label: string | null;
      type: string;
      totalSolReceived: number;
      transactionCount: number;
      percentage: number;
    }[]
  >([]);
  const [isDeepSybilLoading, setIsDeepSybilLoading] = useState(false);
  const [hasFullSybilAnalysis, setHasFullSybilAnalysis] = useState(false);
  const [isFundingLoading, setIsFundingLoading] = useState(false);
  const [trustHistory, setTrustHistory] = useState<{ ts: string; trustScore: number }[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [forgeFrame, setForgeFrame] = useState<string | null>(null);
  const [forgeAura, setForgeAura] = useState<string | null>(null);
  const [forgeTitle, setForgeTitle] = useState<string | null>(null);
  const [rangerXP, setRangerXP] = useState<number>(0);
  const [rangerRank, setRangerRank] = useState<import('@/lib/rangerRanks').RangerRank | null>(null);
  const [forgeTitleRarity, setForgeTitleRarity] = useState<'common' | 'rare' | 'epic' | 'legendary'>('common');
  const shellRef = useRef<HTMLDivElement | null>(null);
  const transitionTimersRef = useRef<number[]>([]);
  const starfieldRotRef = useRef<number>(0);
  const starfieldCameraRef = useRef({ azimuth: 0, polar: Math.PI / 2 });
  const lastAzimuthRef = useRef<number | null>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const { traits, score, address } = data;
  const isCapture = Boolean(captureMode);
  const defaultTab = captureTab === 'badges' ? 'badges' : captureTab === 'intel' ? 'intel' : 'stats';
  const fetchedCompositeData = useCompositeScore(liveData ? address : null);
  const compositeData = useMemo(
    () =>
      compositeOverride
        ? {
            score: compositeOverride.score,
            tier: compositeOverride.tier,
            breakdown: compositeOverride.breakdown ?? {
              onchain: Math.min(Math.round(compositeOverride.score * 0.4), 400),
              sybilTrust: Math.min(Math.round(compositeOverride.score * 0.25), 250),
              humanProof: Math.min(Math.round(compositeOverride.score * 0.15), 150),
              social: Math.min(Math.round(compositeOverride.score * 0.1), 100),
              engagement: Math.min(Math.round(compositeOverride.score * 0.1), 100),
            },
            details: compositeOverride.details ?? null,
            isLoading: false,
            hasComposite: true,
            refetch: () => {},
          }
        : fetchedCompositeData,
    [compositeOverride, fetchedCompositeData],
  );

  // Forge loadout — always load (needed for NFT capture too)
  useEffect(() => {
    if (!address || !liveData) return;
    try {
      const raw = localStorage.getItem(`prism_forge_loadout_v1_${address}`);
      if (raw) {
        const loadout = JSON.parse(raw);
        if (loadout.equippedFrame) setForgeFrame(loadout.equippedFrame);
        if (loadout.equippedAura) setForgeAura(loadout.equippedAura);
        if (loadout.equippedTitle) {
          import('@/lib/forgeItems')
            .then(({ getItemById }) => {
              const item = getItemById(loadout.equippedTitle);
              if (item) {
                setForgeTitle(item.preview);
                setForgeTitleRarity(item.rarity);
              }
            })
            .catch(() => {});
        }
      }
    } catch {}
  }, [address, liveData]);

  // Ranger XP + Rank
  useEffect(() => {
    if (!address || !liveData) return;
    let cancelled = false;
    gatherXPSourcesMerged(address).then((sources) => {
      if (cancelled) return;
      const xp = computeRangerXP(sources);
      const rank = getRangerRank(xp);
      setRangerXP(xp);
      setRangerRank(rank);
    });
    return () => {
      cancelled = true;
    };
  }, [address, liveData]);

  const refetchComposite = compositeData.refetch;

  // Hydrate the dossier from already-prefetched trust data, then enrich it with the deep scan.
  useEffect(() => {
    if (!address || isCapture || !liveData) return;
    const base = getHeliusProxyUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
    let cancelled = false;

    setIsDeepSybilLoading(true);
    setHasFullSybilAnalysis(false);
    setIsFundingLoading(true);

    (async () => {
      const sybilTask = (async () => {
        try {
          const d = await fetchSybilAnalysis(address);
          if (cancelled || !d) return;
          setSybilRisk({
            riskScore: d.riskScore,
            riskLevel: d.riskLevel,
            trustScore: d.trustScore ?? 100 - d.riskScore,
            trustGrade: d.trustGrade ?? 'N/A',
            signals: d.signals as SybilSignal[] | undefined,
            metrics: d.metrics,
          });
          // Extract temporal cohort signals from reputation response if available
          const repSignals = d.reputationSignals as Record<string, unknown> | undefined;
          if (repSignals && typeof repSignals === 'object') {
            setReputationSignals({
              temporalCohortScore:
                typeof repSignals.temporalCohortScore === 'number' ? repSignals.temporalCohortScore : undefined,
              fundingDepth: typeof repSignals.fundingDepth === 'number' ? repSignals.fundingDepth : undefined,
              splFlowDetected: typeof repSignals.splFlowDetected === 'boolean' ? repSignals.splFlowDetected : undefined,
              hubSpokeScore: typeof repSignals.hubSpokeScore === 'number' ? repSignals.hubSpokeScore : undefined,
              adaptiveThresholdTriggered:
                typeof repSignals.adaptiveThresholdTriggered === 'boolean'
                  ? repSignals.adaptiveThresholdTriggered
                  : undefined,
              version: typeof repSignals.version === 'number' ? repSignals.version : undefined,
            });
          }
          setHasFullSybilAnalysis(true);
          if (!compositeData.hasComposite) {
            setTimeout(() => refetchComposite(), 500);
          }
        } catch {
          /* ignore */
        } finally {
          if (!cancelled) setIsDeepSybilLoading(false);
        }
      })();

      const fundingTask = (async () => {
        try {
          const d2 = await fetchApiJson<{
            sources?: {
              address: string;
              label: string | null;
              type: string;
              totalSolReceived: number;
              transactionCount: number;
              percentage: number;
            }[];
          }>(`${base}/api/sybil/funding-sources?address=${address}`, { timeoutMs: 4_500 });
          if (!cancelled && d2?.sources) setFundingSources(d2.sources);
        } catch {
          /* ignore */
        } finally {
          if (!cancelled) setIsFundingLoading(false);
        }
      })();

      const reputationTask = (async () => {
        try {
          const d3 = await fetchApiJson<{ signals?: Record<string, unknown> }>(`${base}/api/v1/reputation/${address}`, {
            timeoutMs: 4_500,
          });
          if (!cancelled) {
            const sigs = d3?.signals;
            if (sigs && typeof sigs === 'object' && !Array.isArray(sigs)) {
              setReputationSignals({
                temporalCohortScore:
                  typeof sigs.temporalCohortScore === 'number' ? sigs.temporalCohortScore : undefined,
                fundingDepth: typeof sigs.fundingDepth === 'number' ? sigs.fundingDepth : undefined,
                splFlowDetected: typeof sigs.splFlowDetected === 'boolean' ? sigs.splFlowDetected : undefined,
                hubSpokeScore: typeof sigs.hubSpokeScore === 'number' ? sigs.hubSpokeScore : undefined,
                adaptiveThresholdTriggered:
                  typeof sigs.adaptiveThresholdTriggered === 'boolean' ? sigs.adaptiveThresholdTriggered : undefined,
                version: typeof sigs.version === 'number' ? sigs.version : undefined,
              });
            }
          }
        } catch {
          /* ignore */
        }
      })();

      await Promise.allSettled([sybilTask, fundingTask, reputationTask]);
    })();

    return () => {
      cancelled = true;
    };
  }, [address, isCapture, liveData, refetchComposite, compositeData.hasComposite]);

  useEffect(() => {
    if (!address || isCapture || !liveData) return;
    let cancelled = false;
    setHistoryLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/v1/reputation/${address}/history?days=30`);
        if (r.status === 404) {
          if (!cancelled) {
            setTrustHistory(null);
            setHistoryLoading(false);
          }
          return;
        }
        if (!r.ok) throw new Error('history_fetch_failed');
        const d = await r.json();
        if (!cancelled) setTrustHistory(Array.isArray(d?.history) ? d.history : null);
      } catch {
        if (!cancelled) setTrustHistory(null);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, isCapture, liveData]);

  const clearTransitionTimers = useCallback(() => {
    transitionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    transitionTimersRef.current = [];
  }, []);

  // Helper: set --tx/--ty on suck targets relative to portal center
  const setSuckVars = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const portal = shell.querySelector('.bh-card-portal');
    if (!portal) return;
    const pr = portal.getBoundingClientRect();
    const pcx = pr.left + pr.width / 2;
    const pcy = pr.top + pr.height / 2;

    const setVarsOnEl = (el: HTMLElement, dx: number, dy: number) => {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const angleDeg = angle * (180 / Math.PI);
      // Perpendicular offset for spiral curve (rotated 90°)
      const perpScale = dist * 0.4;
      const px = -Math.sin(angle) * perpScale;
      const py = Math.cos(angle) * perpScale;
      // Transform-origin: edge closest to portal (for "pulled from one end" effect)
      const r = el.getBoundingClientRect();
      const ox = r.width > 0 ? Math.max(0, Math.min(100, ((dx > 0 ? r.width : 0) / r.width) * 100)) : 50;
      const oy = r.height > 0 ? Math.max(0, Math.min(100, ((dy > 0 ? r.height : 0) / r.height) * 100)) : 50;
      el.style.setProperty('--tx', `${dx}px`);
      el.style.setProperty('--ty', `${dy}px`);
      el.style.setProperty('--px', `${px}px`);
      el.style.setProperty('--py', `${py}px`);
      el.style.setProperty('--dist', `${dist}`);
      el.style.setProperty('--angle', `${angleDeg}deg`);
      el.style.setProperty('--angle-neg', `${-angleDeg}deg`);
      el.style.setProperty('--ox', `${ox}%`);
      el.style.setProperty('--oy', `${oy}%`);
    };

    shell.querySelectorAll('[data-suck]').forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const dx = pcx - (r.left + r.width / 2);
      const dy = pcy - (r.top + r.height / 2);
      setVarsOnEl(el as HTMLElement, dx, dy);
    });

    const stage = shell.closest('.card-stage');
    if (stage) {
      const mp = stage.querySelector('.mint-panel') as HTMLElement | null;
      if (mp) {
        const r = mp.getBoundingClientRect();
        const dx = pcx - (r.left + r.width / 2);
        const dy = pcy - (r.top + r.height / 2);
        setVarsOnEl(mp, dx, dy);
      }
    }
  }, []);

  // Reverse suck (return from black hole): set offsets then clear after animation
  useEffect(() => {
    if (!unsucking) return;
    // Double-rAF to ensure DOM is fully laid out before setting vars
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSuckVars();
      });
    });
    const timer = setTimeout(() => {
      // Clear animation artifacts — be careful not to touch scene transforms (WebGL)
      const shell = shellRef.current;
      if (shell) {
        shell.querySelectorAll('[data-suck]').forEach((el) => {
          const h = el as HTMLElement;
          h.style.removeProperty('filter');
          h.style.removeProperty('animation');
          h.style.removeProperty('opacity');
          // Only clear transform on non-scene elements (transforms break WebGL)
          if (h.getAttribute('data-suck') !== 'scene') {
            h.style.removeProperty('transform');
          }
          h.style.removeProperty('will-change');
        });
        // Clear card-body clip-path from big-bang-reveal
        const body = shell.querySelector('.celestial-card-body') as HTMLElement | null;
        if (body) {
          body.style.removeProperty('clip-path');
          body.style.removeProperty('will-change');
          body.style.removeProperty('animation');
        }
        const stage = shell.closest('.card-stage');
        if (stage) {
          const mp = stage.querySelector('.mint-panel') as HTMLElement | null;
          if (mp) {
            mp.style.removeProperty('filter');
            mp.style.removeProperty('animation');
            mp.style.removeProperty('transform');
            mp.style.removeProperty('opacity');
            mp.style.removeProperty('will-change');
          }
        }
      }
      setUnsucking(false);
    }, 3200);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(timer);
    };
  }, [unsucking, setSuckVars]);

  useEffect(() => () => clearTransitionTimers(), [clearTransitionTimers]);

  // 3D Tilt removed — card stays flat

  useEffect(() => {
    if (!isCapture) return;
    setIsFlipped(captureView === 'back');
  }, [isCapture, captureView]);

  useEffect(() => {
    if (staticFront) setIsFlipped(false);
  }, [staticFront]);

  const fallbackTraits: WalletTraits = {
    hasSeeker: false,
    hasPreorder: false,
    hasCombo: false,
    isOG: false,
    isWhale: false,
    isCollector: false,
    isEarlyAdopter: false,
    isTxTitan: false,
    isSolanaMaxi: false,
    isBlueChip: false,
    isDeFiKing: false,
    uniqueTokenCount: 0,
    nftCount: 0,
    txCount: 0,
    memeCoinsHeld: [],
    isMemeLord: false,
    hyperactiveDegen: false,
    diamondHands: false,
    avgTxPerDay30d: 0,
    daysSinceLastTx: null,
    solBalance: 0,
    solBonusApplied: 0,
    walletAgeDays: 0,
    walletAgeBonus: 0,
    planetTier: 'mercury',
    totalAssetsCount: 0,
    solTier: null,
    totalValueUSD: 0,
    cosmicRank: 'stardust',
  };

  const safeTraits = {
    ...fallbackTraits,
    ...(traits ?? {}),
    cosmicRank: traits?.cosmicRank || fallbackTraits.cosmicRank,
    planetTier: traits?.planetTier || fallbackTraits.planetTier,
  };
  // Apply frame bonus to composite breakdown + score
  const frameLoadout = useMemo(
    () => (forgeFrame ? { equippedShipSkin: null, equippedFrame: forgeFrame, equippedAura: null } : null),
    [forgeFrame],
  );
  const boostedComposite = useMemo(() => {
    const result = getBoostedCompositeScore(compositeData.breakdown, frameLoadout);
    return result ?? { score: compositeData.score, breakdown: compositeData.breakdown };
  }, [compositeData.breakdown, compositeData.score, frameLoadout]);
  const hasCompositeDisplay = compositeData.hasComposite;
  const fallbackIdentityScore = Math.max(score, 0);
  const fallbackBreakdown = {
    onchain: Math.min(Math.round(fallbackIdentityScore), 400),
    sybilTrust: 0,
    humanProof: 0,
    social: 0,
    engagement: 0,
  };
  const displayScore = hasCompositeDisplay ? boostedComposite.score : fallbackIdentityScore;
  const displayBreakdown = hasCompositeDisplay ? boostedComposite.breakdown : fallbackBreakdown;
  const maxDisplayScore = hasCompositeDisplay ? 1000 : 400;
  const effectiveTier = (
    hasCompositeDisplay
      ? getCompositeTierFromScore(displayScore, compositeData.tier)
      : safeTraits.planetTier
  ) as PlanetTier;
  const shortAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : 'UNKNOWN';
  const tierLabel = TIER_LABELS[effectiveTier] || effectiveTier.toUpperCase();
  const tierColorClass = TIER_COLORS[effectiveTier] || 'text-white';
  const tierGlowColor = TIER_HEX[effectiveTier] || '#06B6D4';
  const prefetchedTrust = compositeData.details?.sybilTrust ?? null;
  const dossierRisk = useMemo<SybilCardRisk | null>(() => {
    if (sybilRisk) return sybilRisk;
    if (!prefetchedTrust) return null;
    const trustScore = Math.max(0, Math.min(100, Math.round(prefetchedTrust.trustScore ?? 0)));
    const riskScore = Math.max(0, 100 - trustScore);
    return {
      riskScore,
      riskLevel: deriveRiskLevel(riskScore),
      trustScore,
      trustGrade: deriveTrustGrade(trustScore),
      signals: [],
      metrics: undefined,
    };
  }, [prefetchedTrust, sybilRisk]);

  const currentThreshold =
    COMPOSITE_TIER_THRESHOLDS.find((t) => t.tier === effectiveTier) || COMPOSITE_TIER_THRESHOLDS[0];
  const tierProgress =
    hasCompositeDisplay && currentThreshold.max > currentThreshold.min
      ? Math.max(0, Math.min(1, (displayScore - currentThreshold.min) / (currentThreshold.max - currentThreshold.min)))
      : Math.max(0, Math.min(1, displayScore / maxDisplayScore));
  const nextTierLabel = hasCompositeDisplay && currentThreshold.next ? TIER_LABELS[currentThreshold.next] || '' : null;
  const ptsToNext =
    hasCompositeDisplay && currentThreshold.next ? Math.max(0, currentThreshold.max + 1 - displayScore) : 0;
  const badgeItems = getBadgeItems(safeTraits, dossierRisk, compositeData.details);
  const activeBadges = badgeItems.filter((badge) => badge.isActive);
  const inactiveBadges = badgeItems.filter((badge) => !badge.isActive);
  const orderedBadges = [...activeBadges, ...inactiveBadges];
  const frontBadges: typeof activeBadges = (() => {
    const result: typeof activeBadges = [];
    const usedCats = new Set<string>();
    for (const b of activeBadges) {
      if (result.length >= 5) break;
      if (usedCats.has(b.category)) continue;
      usedCats.add(b.category);
      result.push(b);
    }
    for (const b of activeBadges) {
      if (result.length >= 5) break;
      if (!result.includes(b)) result.push(b);
    }
    return result;
  })();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const funFact = useMemo(() => getRandomFunnyFact(safeTraits), [address]);

  return (
    <div
      className={`celestial-card-shell relative w-full perspective-1000 mx-auto group ${shakeWarning ? 'card-shake-warning' : ''} ${suckingIn ? 'card-suckin-active' : ''} ${consuming ? 'card-consume-active' : ''} ${unsucking ? 'card-unsuck-active' : ''}`}
      style={{ transformStyle: 'preserve-3d' }}
      ref={(node) => {
        shellRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
    >
      <div className={`celestial-card-body relative w-full h-full ${unsucking ? 'big-bang-active' : ''}`}>
        <span className="big-bang-flash" aria-hidden="true" />
        <motion.div
          className="w-full h-full relative preserve-3d"
          initial={false}
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ type: 'tween', duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}
        >
          {/* FRONT — single div with gradient border via background-clip technique */}
          <div
            className={`celestial-card-face absolute inset-0 rounded-[40px] overflow-hidden backface-hidden flex flex-col ${isFlipped ? 'pointer-events-none' : 'pointer-events-auto'}`}
            style={{
              backfaceVisibility: 'hidden',
              zIndex: isFlipped ? 0 : 20,
              border:
                forgeFrame && FRAME_STYLES[forgeFrame] ? '5px solid transparent' : '2px solid rgba(6,182,212,0.3)',
              background:
                forgeFrame && FRAME_STYLES[forgeFrame]
                  ? `linear-gradient(#020408, #020408) padding-box, ${FRAME_STYLES[forgeFrame].gradient} border-box`
                  : '#020408',
              boxShadow: (() => {
                const fs = forgeFrame ? FRAME_STYLES[forgeFrame] : null;
                const base = fs?.boxShadow || '0 0 20px -4px rgba(6,182,212,0.15)';
                const aura = forgeAura ? AURA_GLOW_MAP[forgeAura] : null;
                return aura ? `${base}, ${aura}` : base;
              })(),
              animation: (forgeFrame && FRAME_STYLES[forgeFrame]?.animation) || undefined,
            }}
          >
            {/* Card background — separate suckable piece */}
            <div
              data-suck="bg"
              className={`absolute inset-0 pointer-events-none ${forgeFrame && FRAME_STYLES[forgeFrame] ? 'rounded-[35px]' : 'rounded-[38px]'}`}
            />
            {/* Starfield background */}
            <CosmicStarfield
              mode="drift"
              variant="card"
              rotationOffsetRef={starfieldRotRef}
              cameraAnglesRef={starfieldCameraRef}
            />

            {/* Header */}
            <div data-suck="header" className="relative z-20 pt-8 px-7 flex flex-col items-center text-center gap-1">
              {/* Trust grade badge */}
              {dossierRisk &&
                !isCapture &&
                (() => {
                  const ts = dossierRisk.trustScore;
                  const grade = dossierRisk.trustGrade;
                  return (
                    <TrustGradeBadge
                      grade={grade}
                      size="xs"
                      className="capture-hidden absolute top-3 left-3"
                    />
                  );
                })()}
              {!staticFront && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsFlipped(true);
                  }}
                  className="capture-hidden absolute right-3 top-3 flex aspect-square h-10 w-10 items-center justify-center rounded-full !rounded-full bg-gradient-to-br from-white/12 to-white/5 border border-white/15 p-0 text-white/40 hover:text-white shadow-[0_0_16px_rgba(56,189,248,0.35)] backdrop-blur-md transition-all group/btn"
                  title="Flip Card"
                >
                  <RotateCw className="w-4 h-4 shrink-0 transition-transform group-hover/btn:rotate-180 duration-500" />
                </button>
              )}
              <p className="text-cyan-200/50 text-[9px] font-bold tracking-[0.3em] uppercase">Tier Level</p>
              <h1
                className="text-3xl font-black uppercase tracking-widest"
                style={{
                  color: TIER_HEX[effectiveTier] || '#fff',
                  textShadow: `0 0 20px ${TIER_HEX[effectiveTier] || '#fff'}, 0 0 40px ${TIER_HEX[effectiveTier] || '#fff'}, 0 2px 4px rgba(0,0,0,1)`,
                }}
              >
                {tierLabel}
              </h1>
            </div>

            {/* 3D Scene */}
            <div
              data-suck="scene"
              className="absolute inset-0 z-10"
              style={{ opacity: planetVisible ? 1 : 0, transition: 'opacity 0.4s ease-in' }}
              onPointerDown={(event) => {
                event.stopPropagation();
                setIsInteracting(true);
              }}
              onPointerUp={() => setIsInteracting(false)}
              onPointerLeave={() => setIsInteracting(false)}
              onClick={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
            >
              <div
                ref={glowRef}
                className="absolute inset-0 pointer-events-none transition-opacity duration-300"
                style={{
                  background: `radial-gradient(ellipse at 50% 45%, ${tierGlowColor}15 0%, transparent 55%)`,
                  zIndex: 1,
                }}
              />
              <Canvas
                camera={{ position: [0, 0, 8.5], fov: 35 }}
                gl={{ antialias: !IS_MOBILE, alpha: true, preserveDrawingBuffer: isCapture }}
                dpr={IS_MOBILE ? [1, 1.5] : [1, 1.5]}
                onCreated={({ gl }) => {
                  const canvas = gl.domElement;
                  canvas.addEventListener('webglcontextlost', (e) => {
                    e.preventDefault();
                  });
                  canvas.addEventListener('webglcontextrestored', () => {
                    gl.forceContextRestore?.();
                  });
                }}
              >
                {!isCapture && <FrameDetector onReady={handleSceneReady} texturesReady={texturesReady} />}
                <ambientLight intensity={IS_MOBILE ? 1.4 : 0.6} />
                <pointLight position={[10, 5, 5]} intensity={IS_MOBILE ? 3.0 : 1.5} color="#fff" />
                <pointLight position={[-8, -5, -5]} intensity={IS_MOBILE ? 1.2 : 0.5} color="#4cc9f0" />
                <pointLight position={[0, 8, 3]} intensity={IS_MOBILE ? 1.5 : 0} color="#ffe8b0" />

                <Float
                  speed={isCapture ? 0 : 1.5}
                  rotationIntensity={isCapture ? 0 : 0.2}
                  floatIntensity={isCapture ? 0 : 0.2}
                >
                  <Suspense fallback={null}>
                    <Planet3D tier={effectiveTier} isCapture={isCapture} onTexturesReady={handleTexturesReady} />
                  </Suspense>
                </Float>

                {!IS_MOBILE && <Environment preset="city" />}
                <OrbitControls
                  enableZoom
                  enableRotate
                  enablePan={false}
                  minDistance={5.5}
                  maxDistance={12}
                  zoomSpeed={0.8}
                  rotateSpeed={0.6}
                  enableDamping
                  dampingFactor={0.08}
                  onChange={(e) => {
                    if (!e) return;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const controls = (e as any).target;
                    const az = controls?.getAzimuthalAngle?.() as number | undefined;
                    const polar = controls?.getPolarAngle?.() as number | undefined;
                    if (az !== undefined) {
                      if (lastAzimuthRef.current !== null) {
                        starfieldRotRef.current += az - lastAzimuthRef.current;
                      }
                      lastAzimuthRef.current = az;
                      starfieldCameraRef.current.azimuth = az;
                    }
                    if (polar !== undefined) {
                      starfieldCameraRef.current.polar = polar;
                    }
                    if (glowRef.current && az !== undefined && polar !== undefined) {
                      const xPct = 50 + az * 8;
                      const yPct = 45 - (polar - Math.PI / 2) * 8;
                      glowRef.current.style.background = `radial-gradient(ellipse at ${xPct}% ${yPct}%, ${tierGlowColor}15 0%, transparent 55%)`;
                    }
                  }}
                />
              </Canvas>
            </div>

            {/* Footer Info */}
            <div data-suck="footer" className="relative z-20 mt-auto px-7 pb-4 flex flex-col">
              {/* Title pill above badges */}
              {forgeTitle && (
                <div className="flex justify-center mb-2">
                  <span
                    className={`title-pill title-pill--${forgeTitleRarity} relative inline-flex items-center px-3.5 py-1 rounded-full font-bold uppercase tracking-wider border overflow-hidden ${
                      forgeTitleRarity === 'legendary'
                        ? 'text-[12px]'
                        : forgeTitleRarity === 'epic'
                          ? 'text-[11px]'
                          : 'text-[11px]'
                    }`}
                  >
                    <span className="title-pill-text relative z-10">{forgeTitle}</span>
                  </span>
                </div>
              )}
              <div className="flex justify-center items-center border-t border-white/5 pt-3 pb-1 relative z-30">
                {/* Badges moved here */}
                {frontBadges.length > 0 ? (
                  <div className="front-badges grid grid-cols-5 gap-1.5 justify-items-center items-center w-full max-w-[340px] mx-auto pointer-events-auto">
                    {frontBadges.map((badge) => (
                      <div
                        key={badge.key}
                        className="badge-icon-wrap"
                        onTouchStart={(e) => e.currentTarget.classList.add('active')}
                        onTouchEnd={(e) => {
                          const el = e.currentTarget;
                          setTimeout(() => el.classList.remove('active'), 400);
                        }}
                        onTouchCancel={(e) => e.currentTarget.classList.remove('active')}
                      >
                        <span className="badge-tooltip">{badge.label}</span>
                        <BadgeIcon badge={badge} size="sm" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-6" />
                )}
              </div>
            </div>
          </div>

          {/* BACK */}
          <div
            className={`celestial-card-face absolute inset-0 w-full h-full rounded-[40px] bg-[#020408] backface-hidden flex flex-col overflow-hidden ${!isFlipped ? 'pointer-events-none' : 'pointer-events-auto'}`}
            style={{
              transform: 'rotateY(180deg)',
              backfaceVisibility: 'hidden',
              pointerEvents: isFlipped ? 'auto' : 'none',
              zIndex: isFlipped ? 20 : 0,
              border:
                forgeFrame && FRAME_STYLES[forgeFrame] ? '5px solid transparent' : '2px solid rgba(6,182,212,0.3)',
              background:
                forgeFrame && FRAME_STYLES[forgeFrame]
                  ? `linear-gradient(#020408, #020408) padding-box, ${FRAME_STYLES[forgeFrame].gradient} border-box`
                  : '#020408',
              boxShadow: (() => {
                const fs = forgeFrame ? FRAME_STYLES[forgeFrame] : null;
                const base = fs?.boxShadow || '0 0 20px -4px rgba(6,182,212,0.15)';
                const aura = forgeAura ? AURA_GLOW_MAP[forgeAura] : null;
                return aura ? `${base}, ${aura}` : base;
              })(),
              animation: (forgeFrame && FRAME_STYLES[forgeFrame]?.animation) || undefined,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {/* Starfield background */}
            <CosmicStarfield
              mode="drift"
              variant="card"
              rotationOffsetRef={starfieldRotRef}
              cameraAnglesRef={starfieldCameraRef}
            />
            <div
              className="relative z-10 flex flex-col h-full"
              style={{ transformStyle: 'flat', transform: 'translateZ(0)', willChange: 'auto' }}
            >
              {/* Flip Button (Back) */}
              {/* Back Header */}
              <div className="text-center pt-8 pb-4 border-b border-white/5 relative z-20">
                {!staticFront && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsFlipped(false);
                    }}
                    className="capture-hidden absolute right-3 top-3 flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-white/12 to-white/5 border border-white/15 text-white/40 hover:text-white shadow-[0_0_16px_rgba(56,189,248,0.35)] backdrop-blur-md transition-all group/btn"
                    title="Flip Back"
                  >
                    <RotateCcw className="w-4 h-4 shrink-0 transition-transform group-hover/btn:-rotate-180 duration-500" />
                  </button>
                )}
                <h2 className="text-lg font-bold text-white uppercase tracking-widest">Data Prism</h2>
                <div className="flex flex-col gap-0.5 items-center mt-2 mb-1">
                  {/* Progress Ring */}
                  <div className="relative w-[88px] h-[88px] flex items-center justify-center">
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 88 88">
                      <circle cx="44" cy="44" r="38" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                      <circle
                        cx="44"
                        cy="44"
                        r="38"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${tierProgress * 238.76} 238.76`}
                        className="transition-all duration-1000 ease-out"
                        style={{
                          color: TIER_HEX[effectiveTier] || '#fff',
                          stroke: TIER_HEX[effectiveTier] || '#fff',
                          filter: `drop-shadow(0 0 4px ${TIER_HEX[effectiveTier] || '#fff'})`,
                        }}
                      />
                    </svg>
                    <span
                      data-capture="score"
                      className="capture-value text-3xl font-mono font-bold tracking-tighter drop-shadow-lg"
                      style={{ color: TIER_HEX[effectiveTier] || '#fff' }}
                    >
                      {displayScore}
                    </span>
                  </div>
                  <span className="text-white/20 text-[8px] uppercase tracking-[0.3em]">
                    {hasCompositeDisplay ? 'Composite Score' : 'Identity Score'}
                  </span>
                  {nextTierLabel && ptsToNext > 0 && (
                    <span className="text-white/15 text-[8px] mt-0.5">
                      <span className="text-white/25">{ptsToNext}</span> pts to {nextTierLabel}
                    </span>
                  )}
                </div>
                <p
                  data-capture="address"
                  className="capture-value font-mono text-[10px] mt-1 tracking-wider"
                  style={{ color: TIER_HEX[effectiveTier] || '#fff', opacity: 0.7 }}
                >
                  {shortAddress}
                </p>
              </div>

              {/* Tabs Container */}
              <div
                className="flex-1 flex flex-col min-h-0 bg-black/10 cursor-auto relative z-10"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Solana logo watermark — centered behind tabs content */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                  <img src="/textures/Solana.png" alt="" className="w-[55%] opacity-[0.07]" draggable={false} />
                </div>
                <Tabs defaultValue={defaultTab} className="w-full h-full flex flex-col pointer-events-auto">
                  <div className="px-5 pt-4">
                    <TabsList className="flex w-full rounded-lg bg-white/[0.03] p-0.5 border-0 pointer-events-auto">
                      <TabsTrigger
                        value="stats"
                        className="flex-1 rounded-md text-[10px] font-semibold py-1.5 text-white/30 transition-all data-[state=active]:bg-white/[0.08] data-[state=active]:text-cyan-400 data-[state=active]:shadow-none cursor-pointer pointer-events-auto"
                      >
                        STATS
                      </TabsTrigger>
                      <TabsTrigger
                        value="intel"
                        className="flex-1 rounded-md text-[10px] font-semibold py-1.5 text-white/30 transition-all data-[state=active]:bg-white/[0.08] data-[state=active]:text-cyan-400 data-[state=active]:shadow-none cursor-pointer pointer-events-auto"
                      >
                        DOSSIER
                      </TabsTrigger>
                      <TabsTrigger
                        value="badges"
                        className="flex-1 rounded-md text-[10px] font-semibold py-1.5 text-white/30 transition-all data-[state=active]:bg-white/[0.08] data-[state=active]:text-cyan-400 data-[state=active]:shadow-none cursor-pointer pointer-events-auto"
                      >
                        BADGES
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {/* STATS CONTENT */}
                  <TabsContent
                    value="stats"
                    forceMount
                    className="flex-1 overflow-y-auto no-scrollbar px-5 pt-4 pb-4 relative z-20 pointer-events-auto data-[state=inactive]:hidden"
                  >
                    {/* Composite Score Breakdown — always shown */}
                    <div className="mb-4 rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.02] via-transparent to-white/[0.01] p-3.5">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                        <span className="text-[9px] uppercase tracking-[0.15em] text-white/30 font-bold">
                          {hasCompositeDisplay ? 'Composite Score' : 'Identity Score'}
                        </span>
                        <span className="ml-auto text-sm font-bold text-purple-300">
                          {displayScore}
                          <span className="text-[9px] text-white/20">/{maxDisplayScore}</span>
                        </span>
                      </div>
                      <CompositeScoreBreakdown
                        breakdown={displayBreakdown}
                        details={compositeData.details}
                        compact={false}
                      />
                    </div>

                    {/* PROGRESSION */}
                    <div className="mb-4 rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.02] via-transparent to-white/[0.01] p-3.5">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-[9px] uppercase tracking-[0.15em] text-white/30 font-bold">
                          Progression
                        </span>
                      </div>
                      {rangerRank ? (
                        <div>
                          <div className="flex items-center gap-2 mb-2.5">
                            <img
                              src={`/textures/ranks/rank_${rangerRank.id}.png`}
                              alt={rangerRank.name}
                              className="w-7 h-7 object-contain drop-shadow-[0_0_6px_rgba(251,191,36,0.5)]"
                            />
                            <span className={`text-sm font-bold ${rangerRank.color}`}>{rangerRank.name}</span>
                            <span className="ml-auto text-[9px] text-white/30 uppercase tracking-[0.1em]">
                              {rangerXP.toLocaleString()} XP
                            </span>
                          </div>
                          <div className="w-full bg-white/10 rounded-full h-1.5 mb-1.5">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-all duration-500"
                              style={{ width: `${Math.round(getRankProgress(rangerXP) * 100)}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[9px] text-white/25">
                            <span>{rangerRank.name}</span>
                            {(() => {
                              const idx = [0, 1500, 8000, 25000, 50000].indexOf(rangerRank.minXP);
                              const nextNames = ['Pilot', 'Captain', 'Ace', 'Legend', 'Max'];
                              return <span>{nextNames[idx] ?? 'Max'}</span>;
                            })()}
                          </div>
                        </div>
                      ) : (
                        <div className="text-[9px] text-white/20 text-center py-1">Loading...</div>
                      )}
                    </div>

                    <div className="bg-gradient-to-br from-cyan-900/10 to-blue-900/10 border border-cyan-500/15 rounded-2xl p-4 relative overflow-hidden text-center">
                      <div className="absolute top-0 right-0 p-2 opacity-10">
                        <SparklesIcon className="w-8 h-8 text-cyan-500" />
                      </div>
                      <p className="text-[9px] text-cyan-300/50 uppercase tracking-[0.15em] mb-2 font-bold">
                        Cosmic Insight
                      </p>
                      <p className="text-sm text-cyan-100/90 font-medium leading-relaxed italic">"{funFact}"</p>
                    </div>
                  </TabsContent>

                  {/* BADGES CONTENT — grouped by composite category */}
                  <TabsContent
                    value="badges"
                    forceMount
                    className="flex-1 overflow-y-auto no-scrollbar px-5 pt-3 pb-4 relative z-20 pointer-events-auto data-[state=inactive]:hidden"
                  >
                    <div className="space-y-4 pb-2">
                      {badgeItems.length === 0 ? (
                        <div className="text-center py-10 opacity-50">
                          <p className="text-xs text-white/40">No badges earned yet.</p>
                          <p className="text-[10px] text-white/20 mt-1">Keep exploring the cosmos.</p>
                        </div>
                      ) : (
                        (() => {
                          const allCats: BadgeCategory[] = [
                            'onchain',
                            'sybilTrust',
                            'humanProof',
                            'identityPrism',
                            'social',
                            'engagement',
                          ];
                          const catData = allCats
                            .map((cat) => ({
                              cat,
                              badges: badgeItems.filter((b) => b.category === cat),
                              activeCount: badgeItems.filter((b) => b.category === cat && b.isActive).length,
                            }))
                            .filter((c) => c.badges.length > 0);
                          // Sort: categories with active badges first, preserve relative order within groups
                          catData.sort((a, b) => (b.activeCount > 0 ? 1 : 0) - (a.activeCount > 0 ? 1 : 0));
                          return catData;
                        })().map(({ cat, badges: catBadges, activeCount }) => {
                          const catMeta: Record<BadgeCategory, { icon: string; label: string; color: string }> = {
                            onchain: { icon: '/textures/Solana.png', label: 'ON-CHAIN', color: '#d4a04a' },
                            sybilTrust: {
                              icon: '/icons/trust/trust-grade-unknown.png',
                              label: 'TRUST',
                              color: '#4ac8e8',
                            },
                            humanProof: { icon: '/hub/league.png', label: 'GAMES', color: '#34d399' },
                            identityPrism: {
                              icon: '/tokens/prism-icon.png',
                              label: 'IDENTITY PRISM',
                              color: '#34d399',
                            },
                            social: { icon: '/hub/arena.png', label: 'SOCIAL', color: '#ef4444' },
                            engagement: { icon: '/hub/quests.png', label: 'ENGAGEMENT', color: '#f472b6' },
                          };
                          const meta = catMeta[cat];
                          return (
                            <div key={cat}>
                              <div className="flex items-center justify-between mb-2 px-1">
                                <span
                                  className="text-[10px] uppercase tracking-wider font-bold flex items-center gap-1.5"
                                  style={{ color: `${meta.color}cc` }}
                                >
                                  <img src={meta.icon} alt="" className="w-4 h-4 object-contain" loading="lazy" />
                                  <span>{meta.label}</span>
                                </span>
                                <span className="text-[10px] font-mono" style={{ color: `${meta.color}66` }}>
                                  {activeCount}/{catBadges.length}
                                </span>
                              </div>
                              <div className="space-y-2">
                                {[...catBadges]
                                  .sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0))
                                  .map((badge) => (
                                    <div
                                      key={badge.key}
                                      className={`flex items-center gap-3.5 p-3 rounded-xl border transition-all ${badge.isActive ? 'bg-white/5' : 'bg-white/2 opacity-40'}`}
                                      style={{
                                        borderColor: badge.isActive ? `${meta.color}30` : 'rgba(255,255,255,0.05)',
                                      }}
                                    >
                                      <div className="capture-badge-content flex items-center gap-3.5 w-full">
                                        <BadgeIcon badge={badge} size="md" dataBadgeIcon />
                                        <div className="flex-1 min-w-0 text-center">
                                          <p
                                            data-badge-label
                                            className={`text-sm font-bold uppercase tracking-wider ${badge.isActive ? 'text-white' : 'text-white/50'}`}
                                          >
                                            {badge.label}
                                          </p>
                                          <p
                                            data-badge-desc
                                            className={`text-[11px] leading-snug mt-1 italic ${badge.isActive ? 'text-white/45' : 'text-white/25'}`}
                                          >
                                            {badge.description}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </TabsContent>

                  {/* INTEL CONTENT — full sybil breakdown */}
                  <TabsContent
                    value="intel"
                    forceMount
                    className="flex-1 overflow-y-auto no-scrollbar px-5 pt-3 pb-4 relative z-20 pointer-events-auto data-[state=inactive]:hidden"
                  >
                    {!dossierRisk ? (
                      <div className="text-center py-10 opacity-50">
                        <p className="text-xs text-white/40">
                          {isDeepSybilLoading ? 'Analyzing wallet...' : 'Trust snapshot unavailable'}
                        </p>
                        <p className="text-[10px] text-white/20 mt-1">
                          {isDeepSybilLoading
                            ? 'Sybil intelligence loading'
                            : 'Reconnect wallet to refresh dossier data'}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3 pb-2">
                        {/* Trust Overview */}
                        <div className="rounded-xl border border-amber-500/15 bg-gradient-to-br from-amber-900/10 to-orange-900/10 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] uppercase tracking-[0.15em] text-amber-300/50 font-bold flex items-center gap-1">
                              {dossierRisk.trustScore >= 60 ? (
                                <ShieldCheck className="w-3 h-3" />
                              ) : (
                                <ShieldAlert className="w-3 h-3" />
                              )}
                              Trust
                            </span>
                            <TrustGradeBadge grade={dossierRisk.trustGrade} score={dossierRisk.trustScore} size="sm" />
                          </div>
                          <div className="rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2.5">
                            <div className="flex items-end justify-between gap-3">
                              <div>
                                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/30">
                                  Wallet Trust
                                </div>
                                <div className="mt-1 font-mono text-2xl font-black tabular-nums text-white/90">
                                  {dossierRisk.trustScore}
                                  <span className="text-xs text-white/25">/100</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-[9px] font-black uppercase tracking-[0.14em] text-amber-200/75">
                                  Grade {dossierRisk.trustGrade}
                                </div>
                                <div className="mt-1 text-[10px] text-white/45">{getTrustStatusLabel(dossierRisk)}</div>
                              </div>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${dossierRisk.trustScore}%`,
                                  background:
                                    dossierRisk.trustScore >= 80
                                      ? '#4ade80'
                                      : dossierRisk.trustScore >= 60
                                        ? '#60a5fa'
                                        : dossierRisk.trustScore >= 40
                                          ? '#facc15'
                                          : '#f87171',
                                }}
                              />
                            </div>
                          </div>
                          {dossierRisk.trustScore < 50 && (
                            <Link
                              to={`/recovery?address=${encodeURIComponent(address)}`}
                              className="mt-2 inline-flex items-center gap-1 rounded-md text-[9px] font-black uppercase tracking-[0.1em] text-amber-200/75 transition-colors hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/40"
                            >
                              Recovery plan
                              <ArrowRight className="h-3 w-3" aria-hidden="true" />
                            </Link>
                          )}
                        </div>

                        {/* Trust Breakdown */}
                        {dossierRisk.metrics &&
                          (() => {
                            const m = dossierRisk.metrics;
                            const sigs = dossierRisk.signals ?? [];
                            const behavSigs = sigs.filter((s) => s.category === 'behavioral');
                            const detectedBehav = behavSigs.filter((s) => s.detected).length;
                            const totalBehav = behavSigs.length;
                            const passedBehav = totalBehav - detectedBehav;
                            const dangerSigs = sigs.filter((s) => s.detected && s.severity === 'danger');
                            const onchain = Math.min(
                              150,
                              Math.round(
                                (m.walletAgeDays / 365) * 40 +
                                  (Math.min(m.txCount, 1000) / 1000) * 60 +
                                  (Math.min(m.uniquePrograms, 20) / 20) * 50,
                              ),
                            );
                            const behavioral = Math.min(
                              75,
                              totalBehav === 0 ? 75 : Math.round(75 * (1 - detectedBehav / totalBehav)),
                            );
                            const social = sigs.find((s) => s.id === 'social_verify')?.detected === false ? 25 : 15;
                            return (
                              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] uppercase tracking-[0.15em] text-white/30 font-bold">
                                    Trust Signals
                                  </span>
                                  <span className="text-[10px] font-mono text-white/45">
                                    {getTrustStatusLabel(dossierRisk)}
                                  </span>
                                </div>
                                <div className="space-y-2 pl-3 border-l border-white/[0.08]">
                                  {[
                                    { label: 'On-chain history', value: onchain, max: 150, color: '#60a5fa' },
                                    { label: 'Behavior pattern', value: behavioral, max: 75, color: '#f59e0b' },
                                    { label: 'Identity proof', value: social, max: 25, color: '#4ade80' },
                                  ].map((row) => (
                                    <div key={row.label} className="grid grid-cols-[96px_1fr] items-center gap-2">
                                      <span className="text-[10px] text-white/45">{row.label}</span>
                                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                        <div
                                          className="h-full rounded-full"
                                          style={{ width: `${(row.value / row.max) * 100}%`, background: row.color }}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                {(m.txCount > 100 ||
                                  m.walletAgeDays > 365 ||
                                  passedBehav > 3 ||
                                  dangerSigs.length > 0) && (
                                  <div className="space-y-1">
                                    <div className="text-[9px] uppercase tracking-[0.15em] text-white/25 font-bold">
                                      Reasoning
                                    </div>
                                    <ul className="space-y-1">
                                      {m.txCount > 100 && (
                                        <li className="flex items-start gap-2 text-[10px] text-white/55">
                                          <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-400/70 shrink-0" />
                                          <span>{m.txCount.toLocaleString()} transactions on-chain</span>
                                        </li>
                                      )}
                                      {m.walletAgeDays > 365 && (
                                        <li className="flex items-start gap-2 text-[10px] text-white/55">
                                          <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-400/70 shrink-0" />
                                          <span>{(m.walletAgeDays / 365).toFixed(1)}y wallet age</span>
                                        </li>
                                      )}
                                      {passedBehav > 3 && (
                                        <li className="flex items-start gap-2 text-[10px] text-white/55">
                                          <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-400/70 shrink-0" />
                                          <span>{passedBehav} behavioral checks passed</span>
                                        </li>
                                      )}
                                      {dangerSigs.map((sig) => (
                                        <li key={sig.id} className="flex items-start gap-2 text-[10px] text-white/55">
                                          <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-400 shrink-0" />
                                          <span>
                                            {sig.name}
                                            {sig.value
                                              ? ` · ${sig.value}`
                                              : sig.description
                                                ? ` · ${sig.description}`
                                                : ''}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                        {/* Temporal Cohort & Funding Signals (version 2) */}
                        {reputationSignals?.version === 2 && (
                          <div className="space-y-1">
                            {(reputationSignals.fundingDepth ?? 0) >= 3 && (
                              <div className="text-[9px] text-red-300/70">
                                ⚠ Deep funding chain: {reputationSignals.fundingDepth}-hop trace
                              </div>
                            )}
                            {reputationSignals.splFlowDetected && (
                              <div className="text-[9px] text-orange-300/70">Funded via stablecoin</div>
                            )}
                            {(reputationSignals.hubSpokeScore ?? 0) > 0.5 && (
                              <div className="text-[9px] text-amber-300/70">
                                Hub-spoke pattern ({Math.round((reputationSignals.hubSpokeScore ?? 0) * 100)}%
                                dominance)
                              </div>
                            )}
                          </div>
                        )}

                        {/* Birthday Cohort Panel */}
                        {reputationSignals?.version === 2 && (reputationSignals?.temporalCohortScore ?? 0) > 0.3 && (
                          <div className="mt-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
                            <div className="flex items-center gap-2 mb-1">
                              <AlertTriangle className="w-3 h-3 text-amber-400/80" />
                              <span className="text-[10px] font-bold text-amber-300/90">BIRTHDAY COHORT</span>
                            </div>
                            <p className="text-[10px] text-white/60 leading-relaxed">
                              This wallet appears created within a <strong>1-hour window</strong> alongside others
                              sharing the same funding source. Often indicates coordinated farm activity.
                            </p>
                            <div className="mt-2 flex items-center gap-3 text-[9px] text-white/40">
                              <span>
                                Similarity:{' '}
                                <strong className="text-amber-300">
                                  {Math.round((reputationSignals.temporalCohortScore ?? 0) * 100)}%
                                </strong>
                              </span>
                              {(reputationSignals.fundingDepth ?? 0) > 2 && (
                                <span>
                                  Funding chain:{' '}
                                  <strong className="text-red-300">{reputationSignals.fundingDepth} hops</strong>
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Signals by category */}
                        {dossierRisk.signals &&
                          dossierRisk.signals.length > 0 &&
                          (() => {
                            const catOrder = ['behavioral', 'financial', 'network'] as const;
                            const catMeta: Record<string, { label: string; color: string }> = {
                              behavioral: { label: 'BEHAVIORAL', color: '#f59e0b' },
                              financial: { label: 'FINANCIAL', color: '#3b82f6' },
                              network: { label: 'NETWORK', color: '#a855f7' },
                            };
                            const grouped = catOrder
                              .map((cat) => ({
                                cat,
                                signals: dossierRisk.signals!.filter((s) => s.category === cat),
                              }))
                              .filter((g) => g.signals.length > 0);

                            return grouped.map(({ cat, signals }) => {
                              const meta = catMeta[cat] || { label: cat.toUpperCase(), color: '#94a3b8' };
                              const detected = signals.filter((s) => s.detected).length;
                              return (
                                <div key={cat} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <span
                                      className="text-[9px] uppercase tracking-[0.12em] font-bold"
                                      style={{ color: `${meta.color}cc` }}
                                    >
                                      {meta.label}
                                    </span>
                                    <span
                                      className="text-[9px] font-mono"
                                      style={{ color: detected > 0 ? '#f87171aa' : '#4ade80aa' }}
                                    >
                                      {detected}/{signals.length} flagged
                                    </span>
                                  </div>
                                  <div className="space-y-1.5">
                                    {signals.map((sig) => (
                                      <div
                                        key={sig.id}
                                        className={`flex items-start gap-2 p-2 rounded-lg ${sig.detected ? 'bg-red-500/5 border border-red-500/10' : 'bg-white/[0.01]'}`}
                                      >
                                        {sig.detected ? (
                                          sig.severity === 'danger' ? (
                                            <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                                          ) : (
                                            <XCircle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                                          )
                                        ) : (
                                          <CheckCircle2 className="w-3 h-3 text-emerald-500/50 shrink-0 mt-0.5" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center justify-between gap-1">
                                            <span
                                              className={`text-[10px] font-semibold ${sig.detected ? 'text-white/80' : 'text-white/30'}`}
                                            >
                                              {sig.name}
                                            </span>
                                            {sig.detected && sig.value && (
                                              <span className="text-[9px] text-amber-300/60 font-mono shrink-0">
                                                {sig.value}
                                              </span>
                                            )}
                                          </div>
                                          {sig.detected && sig.description && (
                                            <p className="text-[9px] text-white/25 mt-0.5 leading-snug">
                                              {sig.description}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            });
                          })()}

                        {/* Key Metrics */}
                        {dossierRisk.metrics && (
                          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                            <div className="text-[9px] uppercase tracking-[0.15em] text-white/30 font-bold mb-2">
                              Key Metrics
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                              {[
                                { label: 'Wallet Age', value: `${dossierRisk.metrics.walletAgeDays}d` },
                                { label: 'Transactions', value: dossierRisk.metrics.txCount.toLocaleString() },
                                {
                                  label: 'Active Days',
                                  value: `${dossierRisk.metrics.activeDaysCount} (${(dossierRisk.metrics.activeDaysRatio * 100).toFixed(0)}%)`,
                                },
                                { label: 'Programs Used', value: String(dossierRisk.metrics.uniquePrograms) },
                                { label: 'Token Types', value: String(dossierRisk.metrics.tokenDiversityCount) },
                                { label: 'NFTs Held', value: String(dossierRisk.metrics.nftCount) },
                                { label: 'Balance', value: `${dossierRisk.metrics.balance.toFixed(2)} SOL` },
                                {
                                  label: 'Peak Balance',
                                  value: `${dossierRisk.metrics.historicalMaxBalance.toFixed(2)} SOL`,
                                },
                                { label: 'In Volume', value: `${dossierRisk.metrics.incomingVolume.toFixed(1)} SOL` },
                                { label: 'Out Volume', value: `${dossierRisk.metrics.outgoingVolume.toFixed(1)} SOL` },
                                { label: 'Dust Ratio', value: `${dossierRisk.metrics.dustRatio.toFixed(0)}%` },
                                {
                                  label: 'Cluster Sim.',
                                  value: `${dossierRisk.metrics.clusterSimilarity.toFixed(0)}%`,
                                },
                              ].map(({ label, value }) => (
                                <div key={label} className="flex justify-between">
                                  <span className="text-[10px] text-white/25">{label}</span>
                                  <span className="text-[10px] text-white/60 font-mono">{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Funding Sources */}
                        {fundingSources.length > 0 && (
                          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                            <div className="flex items-center gap-1.5 mb-2">
                              <ArrowDownLeft className="w-3 h-3 text-blue-400/50" />
                              <span className="text-[9px] uppercase tracking-[0.15em] text-white/30 font-bold">
                                Funding Sources
                              </span>
                            </div>
                            <div className="space-y-1.5">
                              {fundingSources.slice(0, 8).map((src, i) => (
                                <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.01]">
                                  <div
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{
                                      background:
                                        src.type === 'cex' ? '#4ade80' : src.type === 'bridge' ? '#60a5fa' : '#94a3b8',
                                    }}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] font-semibold text-white/60 truncate">
                                        {src.label || `${src.address.slice(0, 4)}...${src.address.slice(-4)}`}
                                      </span>
                                      <span className="text-[9px] text-white/40 font-mono shrink-0 ml-1">
                                        {src.totalSolReceived.toFixed(1)} SOL
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between mt-0.5">
                                      <span className="text-[9px] text-white/20">
                                        {src.type === 'cex' ? 'Exchange' : src.type === 'bridge' ? 'Bridge' : 'Wallet'}{' '}
                                        · {src.transactionCount} txs
                                      </span>
                                      <span className="text-[9px] text-white/20 font-mono">
                                        {src.percentage.toFixed(0)}%
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Trust Timeline */}
                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                          <div className="text-[9px] uppercase tracking-[0.15em] text-white/30 font-bold mb-2">
                            30D Trust Timeline
                          </div>
                          {historyLoading ? (
                            <div className="text-[10px] text-white/30">Loading...</div>
                          ) : trustHistory && trustHistory.length > 1 ? (
                            <svg viewBox="0 0 200 50" className="w-full h-12 overflow-visible">
                              <path
                                d={(() => {
                                  const pts = trustHistory.map((h, i) => [
                                    (i / (trustHistory.length - 1)) * 200,
                                    50 - ((h.trustScore ?? 0) / 100) * 48,
                                  ]);
                                  return pts
                                    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
                                    .join(' ');
                                })()}
                                stroke="#22d3ee"
                                strokeWidth="1.5"
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ filter: 'drop-shadow(0 0 4px #22d3ee80)' }}
                              />
                            </svg>
                          ) : (
                            <p className="text-[10px] text-white/20 text-center py-2">
                              Timeline starts collecting from next scan
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
});

type BadgeKey =
  | 'early_bird'
  | 'veteran'
  | 'whale'
  | 'nft_collector'
  | 'defi_architect'
  | 'verified_human'
  | 'clean_record'
  | 'trust_pillar'
  | 'game_master'
  | 'achievement_hunter'
  | 'high_scorer'
  | 'seeker'
  | 'visionary'
  | 'binary'
  | 'arena_champion'
  | 'top_hunter'
  | 'quest_master'
  | 'quest_hunter'
  | 'streak_lord'
  | 'explorer';

type BadgeCategory = 'onchain' | 'sybilTrust' | 'humanProof' | 'identityPrism' | 'social' | 'engagement';

type BadgeItem = {
  key: BadgeKey;
  label: string;
  isActive: boolean;
  texture: string;
  description: string;
  category: BadgeCategory;
};

const BADGE_TEXTURES: Record<BadgeKey, string> = {
  early_bird: '/badges/early_bird.png',
  veteran: '/badges/veteran.png',
  whale: '/badges/whale.png',
  nft_collector: '/badges/nft_collector.png',
  defi_architect: '/badges/defi_architect.png',
  verified_human: '/badges/verified_human.png',
  clean_record: '/badges/clean_record.png',
  trust_pillar: '/badges/trust_pillar.png',
  game_master: '/badges/game_master.png',
  achievement_hunter: '/badges/achievement_hunter.png',
  high_scorer: '/badges/high_scorer.png',
  seeker: '/badges/seeker.png',
  visionary: '/badges/visionary.png',
  binary: '/badges/binary.png',
  arena_champion: '/badges/arena_champion.png',
  top_hunter: '/badges/debate_king.png',
  quest_master: '/badges/quest_hunter.png',
  quest_hunter: '/badges/quest_hunter.png',
  streak_lord: '/badges/streak_lord.png',
  explorer: '/badges/explorer.png',
};

// Preload badge images so they render instantly
if (typeof window !== 'undefined') {
  Object.values(BADGE_TEXTURES).forEach((src) => {
    const img = new Image();
    img.src = src;
  });
}

function getBadgeItems(
  traits: WalletTraits,
  sybilRisk: { trustScore: number; riskScore: number } | null,
  details: ScoreDetails | null,
): BadgeItem[] {
  const defiProtoCount = Array.isArray(traits.defiProtocols) ? traits.defiProtocols.length : 0;
  return [
    // ON-CHAIN (5)
    {
      key: 'early_bird',
      label: 'Early Bird',
      isActive: traits.walletAgeDays >= 365,
      texture: BADGE_TEXTURES.early_bird,
      description: 'The first orbit around the sun leaves its mark.',
      category: 'onchain',
    },
    {
      key: 'veteran',
      label: 'Veteran',
      isActive: traits.walletAgeDays >= 730 && traits.txCount > 1000,
      texture: BADGE_TEXTURES.veteran,
      description: 'Scars of a thousand battles etched into the ledger.',
      category: 'onchain',
    },
    {
      key: 'whale',
      label: 'Whale',
      isActive: traits.solBalance >= 50,
      texture: BADGE_TEXTURES.whale,
      description: 'Where this one swims, the tides obey.',
      category: 'onchain',
    },
    {
      key: 'nft_collector',
      label: 'NFT Collector',
      isActive: traits.nftCount >= 10,
      texture: BADGE_TEXTURES.nft_collector,
      description: 'A gallery of digital relics, each with a story.',
      category: 'onchain',
    },
    {
      key: 'defi_architect',
      label: 'DeFi Architect',
      isActive: defiProtoCount >= 3,
      texture: BADGE_TEXTURES.defi_architect,
      description: 'Weaves liquidity across multiple dimensions.',
      category: 'onchain',
    },
    // TRUST (3)
    {
      key: 'verified_human',
      label: 'Verified Human',
      isActive: (sybilRisk?.trustScore ?? 0) >= 80,
      texture: BADGE_TEXTURES.verified_human,
      description: 'Not a ghost, not a shadow. Pulse confirmed.',
      category: 'sybilTrust',
    },
    {
      key: 'clean_record',
      label: 'Clean Record',
      isActive: sybilRisk != null && sybilRisk.riskScore < 10,
      texture: BADGE_TEXTURES.clean_record,
      description: 'A crystal without a single fracture.',
      category: 'sybilTrust',
    },
    {
      key: 'trust_pillar',
      label: 'Trust Pillar',
      isActive: (sybilRisk?.trustScore ?? 0) >= 95,
      texture: BADGE_TEXTURES.trust_pillar,
      description: 'The chain itself vouches for this one.',
      category: 'sybilTrust',
    },
    // GAMES (3)
    {
      key: 'game_master',
      label: 'Game Master',
      isActive: (details?.humanProof.gameTypesCount ?? 0) >= 3,
      texture: BADGE_TEXTURES.game_master,
      description: 'No arena unfamiliar, no game unplayed.',
      category: 'humanProof',
    },
    {
      key: 'achievement_hunter',
      label: 'Achievement Hunter',
      isActive: (details?.humanProof.achievementCount ?? 0) >= 10,
      texture: BADGE_TEXTURES.achievement_hunter,
      description: 'Collects victories like others collect dust.',
      category: 'humanProof',
    },
    {
      key: 'high_scorer',
      label: 'High Scorer',
      isActive: (details?.humanProof.gameScoreTotal ?? 0) >= 40,
      texture: BADGE_TEXTURES.high_scorer,
      description: 'The scoreboard bends under the weight of their name.',
      category: 'humanProof',
    },
    // IDENTITY PRISM (3)
    {
      key: 'seeker',
      label: 'Seeker of Truth',
      isActive: traits.hasSeeker,
      texture: BADGE_TEXTURES.seeker,
      description: 'Carries the ancient lens that reveals what others hide.',
      category: 'identityPrism',
    },
    {
      key: 'visionary',
      label: 'Visionary',
      isActive: traits.hasPreorder,
      texture: BADGE_TEXTURES.visionary,
      description: 'Early believer — secured a spot before launch.',
      category: 'identityPrism',
    },
    {
      key: 'binary',
      label: 'Binary Sun',
      isActive: traits.hasCombo,
      texture: BADGE_TEXTURES.binary,
      description: 'Two stars in perfect orbit. A rare celestial anomaly.',
      category: 'identityPrism',
    },
    // SOCIAL
    {
      key: 'arena_champion',
      label: 'Arena Champion',
      isActive: (details?.social.challengesWon ?? 0) >= 5,
      texture: BADGE_TEXTURES.arena_champion,
      description: 'The crowd already knows who wins.',
      category: 'social',
    },
    {
      key: 'top_hunter',
      label: 'Sybil Hunter',
      isActive: (details?.social.communityReviews ?? 0) >= 5,
      texture: BADGE_TEXTURES.top_hunter,
      description: 'Filed enough Sybil Hunt reviews to move the community signal.',
      category: 'social',
    },
    {
      key: 'quest_master',
      label: 'Quest Master',
      isActive: (details?.engagement.questsCompleted ?? 0) >= 15,
      texture: BADGE_TEXTURES.quest_master,
      description: 'Complete 15+ quests.',
      category: 'engagement',
    },
    // ENGAGEMENT
    {
      key: 'quest_hunter',
      label: 'Quest Hunter',
      isActive: (details?.engagement.questsCompleted ?? 0) >= 10,
      texture: BADGE_TEXTURES.quest_hunter,
      description: 'Every quest a chapter, every reward a verse.',
      category: 'engagement',
    },
    {
      key: 'streak_lord',
      label: 'Streak Lord',
      isActive: (details?.engagement.streakDays ?? 0) >= 7,
      texture: BADGE_TEXTURES.streak_lord,
      description: 'Discipline forged into an unbroken chain of fire.',
      category: 'engagement',
    },
    {
      key: 'explorer',
      label: 'Explorer',
      isActive: (details?.engagement.scanCount ?? 0) >= 20,
      texture: BADGE_TEXTURES.explorer,
      description: 'Turns every unknown address into a known story.',
      category: 'engagement',
    },
  ];
}

function BadgeIcon({
  badge,
  size,
  dataBadgeIcon = false,
}: {
  badge: BadgeItem;
  size: 'sm' | 'md';
  dataBadgeIcon?: boolean;
}) {
  return (
    <div
      className={`badge-icon badge-${size} ${badge.isActive ? 'is-active' : 'is-inactive'} shrink-0`}
      data-badge-icon={dataBadgeIcon ? true : undefined}
      style={{ backgroundImage: `url(${badge.texture})` }}
      title={badge.label}
    />
  );
}
