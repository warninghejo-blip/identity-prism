import { Suspense, useCallback, useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float, OrbitControls } from '@react-three/drei';
import { Sparkles as SparklesIcon, RotateCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Planet3D } from './Planet3D';
import { StarField } from './StarField';
import type { WalletData, WalletTraits, PlanetTier } from '@/hooks/useWalletData';

import { getRandomFunnyFact } from '@/utils/funnyFacts';
import { getHeliusProxyUrl, getAppBaseUrl } from '@/constants';
import CompositeScoreBreakdown from '@/components/CompositeScoreBreakdown';
import { useCompositeScore, type ScoreDetails } from '@/hooks/useCompositeScore';
import { FRAME_STYLES, AURA_GLOW_MAP } from '@/lib/forgeItems';
import { applyFrameToBreakdown, getBoostedCompositeScore } from '@/lib/shipStats';

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

interface CelestialCardProps {
  data: WalletData;
  captureMode?: boolean;
  captureView?: 'front' | 'back';
  captureTab?: 'stats' | 'badges';
  fromBlackHole?: boolean;
  onSceneReady?: () => void;
}

import { TIER_COLORS_TW as TIER_COLORS, TIER_HEX, TIER_LABELS } from '@/lib/constants/tierColors';

export const CelestialCard = forwardRef<HTMLDivElement, CelestialCardProps>(function CelestialCard(
  { data, captureMode = false, captureView = 'front', captureTab = 'stats', fromBlackHole = false, onSceneReady },
  ref,
) {
  const [isFlipped, setIsFlipped] = useState(captureView === 'back');
  const [isInteracting, setIsInteracting] = useState(false);
  const [texturesReady, setTexturesReady] = useState(false);
  const handleTexturesReady = useCallback(() => setTexturesReady(true), []);
  const [shakeWarning, setShakeWarning] = useState(false);
  const [jumpingToGame, setJumpingToGame] = useState(false);
  const [suckingIn, setSuckingIn] = useState(false);
  const [consuming, setConsuming] = useState(false);
  const [unsucking, setUnsucking] = useState(false);

  const [sybilRisk, setSybilRisk] = useState<{
    riskScore: number;
    riskLevel: string;
    trustScore: number;
    trustGrade: string;
    signals?: {
      id: string;
      name: string;
      detected: boolean;
      weight: number;
      severity: string;
      category?: string;
      value?: string;
      description?: string;
    }[];
    metrics?: {
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
    };
  } | null>(null);
  const [forgeFrame, setForgeFrame] = useState<string | null>(null);
  const [forgeAura, setForgeAura] = useState<string | null>(null);
  const [forgeTitle, setForgeTitle] = useState<string | null>(null);
  const [forgeTitleRarity, setForgeTitleRarity] = useState<'common' | 'rare' | 'epic' | 'legendary'>('common');
  const shellRef = useRef<HTMLDivElement | null>(null);
  const transitionTimersRef = useRef<number[]>([]);
  const { traits, score, address } = data;
  const isCapture = Boolean(captureMode);
  const defaultTab = captureTab === 'badges' ? 'badges' : 'stats';
  const compositeData = useCompositeScore(address);

  // Forge loadout — always load (needed for NFT capture too)
  useEffect(() => {
    if (!address) return;
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
  }, [address]);

  const refetchComposite = compositeData.refetch;

  // Fetch sybil risk — only in interactive mode
  useEffect(() => {
    if (!address || isCapture) return;
    const base = getHeliusProxyUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
    fetch(`${base}/api/sybil/analysis?address=${address}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.riskScore !== undefined) {
          setSybilRisk({
            riskScore: d.riskScore,
            riskLevel: d.riskLevel,
            trustScore: d.trustScore ?? 100 - d.riskScore,
            trustGrade: d.trustGrade ?? 'N/A',
            signals: d.signals,
            metrics: d.metrics,
          });
          // Invalidate cached composite score to reflect new sybil trust
          setTimeout(() => refetchComposite(), 500);
        }
      })
      .catch(() => {});
  }, [address, isCapture, refetchComposite]);

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
  const displayScore = boostedComposite.score;
  const maxDisplayScore = 1000;
  const effectiveTier = (displayScore > 0 ? compositeData.tier : safeTraits.planetTier) as PlanetTier;
  const shortAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : 'UNKNOWN';
  const tierLabel = TIER_LABELS[effectiveTier] || effectiveTier.toUpperCase();
  const tierColorClass = TIER_COLORS[effectiveTier] || 'text-white';

  const TIER_THRESHOLDS = [
    { min: 0, max: 99, tier: 'mercury', next: 'mars' },
    { min: 100, max: 219, tier: 'mars', next: 'venus' },
    { min: 220, max: 349, tier: 'venus', next: 'earth' },
    { min: 350, max: 479, tier: 'earth', next: 'neptune' },
    { min: 480, max: 599, tier: 'neptune', next: 'uranus' },
    { min: 600, max: 699, tier: 'uranus', next: 'saturn' },
    { min: 700, max: 799, tier: 'saturn', next: 'jupiter' },
    { min: 800, max: 879, tier: 'jupiter', next: 'sun' },
    { min: 880, max: 949, tier: 'sun', next: 'binary_sun' },
    { min: 950, max: 1000, tier: 'binary_sun', next: null },
  ];
  const currentThreshold = TIER_THRESHOLDS.find((t) => t.tier === effectiveTier) || TIER_THRESHOLDS[0];
  const tierProgress =
    currentThreshold.max > currentThreshold.min
      ? Math.min(1, (displayScore - currentThreshold.min) / (currentThreshold.max - currentThreshold.min))
      : 1;
  const nextTierLabel = currentThreshold.next ? TIER_LABELS[currentThreshold.next] || '' : null;
  const ptsToNext = currentThreshold.next ? Math.max(0, currentThreshold.max + 1 - displayScore) : 0;
  const badgeItems = getBadgeItems(safeTraits, sybilRisk, compositeData.details);
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

  const funFact = useMemo(() => getRandomFunnyFact(safeTraits), [safeTraits]);

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
              className={`absolute inset-0 bg-[#020408] pointer-events-none ${forgeFrame && FRAME_STYLES[forgeFrame] ? 'rounded-[35px]' : 'rounded-[38px]'}`}
            />

            {/* Header */}
            <div data-suck="header" className="relative z-20 pt-8 px-7 flex flex-col items-center text-center gap-1">
              {/* Sybil risk pill badge */}
              {sybilRisk &&
                !isCapture &&
                (() => {
                  const ts = sybilRisk.trustScore;
                  const grade = sybilRisk.trustGrade;
                  const color =
                    ts >= 80
                      ? '#22c55e'
                      : ts >= 60
                        ? '#3b82f6'
                        : ts >= 40
                          ? '#eab308'
                          : ts >= 20
                            ? '#f97316'
                            : '#ef4444';
                  return (
                    <div
                      className="capture-hidden absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold backdrop-blur-md border transition-all"
                      style={{
                        borderColor: `${color}40`,
                        background: `${color}18`,
                        color,
                      }}
                      title={`Trust Score: ${ts}/100 (Grade ${grade})`}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      <span>{grade}</span>
                    </div>
                  );
                })()}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsFlipped(true);
                }}
                className="capture-hidden absolute right-3 top-3 flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-white/12 to-white/5 border border-white/15 text-white/40 hover:text-white shadow-[0_0_16px_rgba(56,189,248,0.35)] backdrop-blur-md transition-all group/btn"
                title="Flip Card"
              >
                <RotateCw className="w-4 h-4 shrink-0 transition-transform group-hover/btn:rotate-180 duration-500" />
              </button>
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
              onPointerDown={(event) => {
                event.stopPropagation();
                setIsInteracting(true);
              }}
              onPointerUp={() => setIsInteracting(false)}
              onPointerLeave={() => setIsInteracting(false)}
              onClick={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
            >
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
                {!isCapture && <FrameDetector onReady={onSceneReady} texturesReady={texturesReady} />}
                <ambientLight intensity={IS_MOBILE ? 1.4 : 0.6} />
                <pointLight position={[10, 5, 5]} intensity={IS_MOBILE ? 3.0 : 1.5} color="#fff" />
                <pointLight position={[-8, -5, -5]} intensity={IS_MOBILE ? 1.2 : 0.5} color="#4cc9f0" />
                <pointLight position={[0, 8, 3]} intensity={IS_MOBILE ? 1.5 : 0} color="#ffe8b0" />

                <StarField
                  count={IS_MOBILE ? 300 : 560}
                  radius={[9, 18]}
                  sizeRange={[0.45, 1.35]}
                  intensityRange={[0.4, 0.85]}
                  hemisphere="full"
                  colors={['#fff5e6', '#ffffff', '#ffe2b0']}
                />

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
              <div className="flex justify-center items-center border-t border-white/5 pt-4 pb-2 relative z-30">
                {/* Badges moved here */}
                {frontBadges.length > 0 ? (
                  <div className="front-badges flex gap-3 flex-wrap justify-center items-center w-full pointer-events-auto">
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
            <div
              className="relative z-10 flex flex-col h-full"
              style={{ transformStyle: 'flat', transform: 'translateZ(0)', willChange: 'auto' }}
            >
              {/* Flip Button (Back) */}
              {/* Back Header */}
              <div className="text-center pt-8 pb-4 border-b border-white/5 relative z-20">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsFlipped(false);
                  }}
                  className="capture-hidden absolute right-3 top-3 flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-white/12 to-white/5 border border-white/15 text-white/40 hover:text-white shadow-[0_0_16px_rgba(56,189,248,0.35)] backdrop-blur-md transition-all group/btn"
                  title="Flip Back"
                >
                  <RotateCcw className="w-4 h-4 shrink-0 transition-transform group-hover/btn:-rotate-180 duration-500" />
                </button>
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
                  <span className="text-white/20 text-[8px] uppercase tracking-[0.3em]">Composite Score</span>
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
                  <div className="px-6 pt-4">
                    <TabsList className="w-full grid grid-cols-2 bg-white/5 border border-white/5 rounded-lg p-0.5 pointer-events-auto">
                      <TabsTrigger
                        value="stats"
                        className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-200 data-[state=active]:shadow-none rounded-md cursor-pointer pointer-events-auto"
                      >
                        STATS
                      </TabsTrigger>
                      <TabsTrigger
                        value="badges"
                        className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-200 data-[state=active]:shadow-none rounded-md cursor-pointer pointer-events-auto"
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
                          Composite Score
                        </span>
                        <span className="ml-auto text-sm font-bold text-purple-300">
                          {displayScore}
                          <span className="text-[9px] text-white/20">/1000</span>
                        </span>
                      </div>
                      <CompositeScoreBreakdown
                        breakdown={boostedComposite.breakdown}
                        details={compositeData.details}
                        compact={false}
                      />
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
                            onchain: { icon: '\u26D3\uFE0F', label: 'ON-CHAIN', color: '#d4a04a' },
                            sybilTrust: { icon: '\uD83D\uDEE1\uFE0F', label: 'SYBIL TRUST', color: '#4ac8e8' },
                            humanProof: { icon: '\uD83C\uDFAE', label: 'HUMAN PROOF', color: '#a855f7' },
                            identityPrism: { icon: '\u25C8', label: 'IDENTITY PRISM', color: '#34d399' },
                            social: { icon: '\uD83E\uDD1D', label: 'SOCIAL', color: '#ef4444' },
                            engagement: { icon: '\u26A1', label: 'ENGAGEMENT', color: '#94a3b8' },
                          };
                          const meta = catMeta[cat];
                          return (
                            <div key={cat}>
                              <div className="flex items-center justify-between mb-2 px-1">
                                <span
                                  className="text-[10px] uppercase tracking-wider font-bold flex items-center gap-1.5"
                                  style={{ color: `${meta.color}cc` }}
                                >
                                  <span>{meta.icon}</span>
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
  | 'star_navigator'
  | 'debate_king'
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
  star_navigator: '/badges/star_navigator.png',
  debate_king: '/badges/debate_king.png',
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
    // SYBIL TRUST (3)
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
    // HUMAN PROOF (3)
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
      description: 'Saw the constellation before it was drawn.',
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
    // SOCIAL (3)
    {
      key: 'arena_champion',
      label: 'Arena Champion',
      isActive: (details?.social.challengesWon ?? 0) >= 5,
      texture: BADGE_TEXTURES.arena_champion,
      description: 'The crowd already knows who wins.',
      category: 'social',
    },
    {
      key: 'star_navigator',
      label: 'Star Navigator',
      isActive: (details?.social.constellationExplored ?? 0) >= 10,
      texture: BADGE_TEXTURES.star_navigator,
      description: 'Maps the invisible threads between wallets.',
      category: 'social',
    },
    {
      key: 'debate_king',
      label: 'Debate King',
      isActive: (details?.social.compareCount ?? 0) >= 10,
      texture: BADGE_TEXTURES.debate_king,
      description: 'Weighs identities on scales of pure data.',
      category: 'social',
    },
    // ENGAGEMENT (3)
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
