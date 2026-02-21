import { Suspense, useCallback, useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float, OrbitControls } from '@react-three/drei';
import { Activity, Clock, Info, Trophy, Wallet, Sparkles as SparklesIcon, Zap, Shield, Flame, Hourglass, RotateCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Planet3D } from './Planet3D';
import { StarField } from './StarField';
import type { WalletData, WalletTraits } from '@/hooks/useWalletData';

import { getRandomFunnyFact } from '@/utils/funnyFacts';
import { BLACKHOLE_ENABLED } from '@/constants';
import { getHeliusProxyUrl, getAppBaseUrl } from '@/constants';
import { createWormholeTunnel } from '@/lib/wormholeTunnel';

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

const TIER_COLORS: Record<string, string> = {
  mercury: 'text-stone-300',
  mars: 'text-orange-400',
  venus: 'text-yellow-300',
  earth: 'text-blue-400',
  neptune: 'text-cyan-400',
  uranus: 'text-sky-300',
  saturn: 'text-amber-300',
  jupiter: 'text-orange-300',
  sun: 'text-yellow-400',
  binary_sun: 'text-amber-400',
};

const TIER_LABELS: Record<string, string> = {
  mercury: 'MERCURY',
  mars: 'MARS',
  venus: 'VENUS',
  earth: 'EARTH',
  neptune: 'NEPTUNE',
  uranus: 'URANUS',
  saturn: 'SATURN',
  jupiter: 'JUPITER',
  sun: 'SUN',
  binary_sun: 'BINARY SUN',
};

export const CelestialCard = forwardRef<HTMLDivElement, CelestialCardProps>(function CelestialCard(
  { data, captureMode = false, captureView = 'front', captureTab = 'stats', fromBlackHole = false, onSceneReady },
  ref
) {
  const [isFlipped, setIsFlipped] = useState(captureView === 'back');
  const [isInteracting, setIsInteracting] = useState(false);
  const [wormholeActive, setWormholeActive] = useState(false);
  const [texturesReady, setTexturesReady] = useState(false);
  const handleTexturesReady = useCallback(() => setTexturesReady(true), []);
  const [shakeWarning, setShakeWarning] = useState(false);
  const [jumpingToGame, setJumpingToGame] = useState(false);
  const [suckingIn, setSuckingIn] = useState(false);
  const [consuming, setConsuming] = useState(false);
  const [unsucking, setUnsucking] = useState(false);
  const [scoreHistory, setScoreHistory] = useState<{ score: number; tier: string; date: string }[]>([]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const transitionTimersRef = useRef<number[]>([]);
  const { traits, score, address } = data;
  const isCapture = Boolean(captureMode);
  const defaultTab = captureTab === 'badges' ? 'badges' : 'stats';
  const navigate = useNavigate();

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
    return () => { cancelAnimationFrame(raf1); clearTimeout(timer); };
  }, [unsucking, setSuckVars]);

  useEffect(() => () => clearTransitionTimers(), [clearTransitionTimers]);

  // Fetch score history from server
  useEffect(() => {
    if (!address || isCapture) return;
    const base = getHeliusProxyUrl() || getAppBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!base) return;
    fetch(`${base}/api/score-history?address=${encodeURIComponent(address)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.scores?.length) setScoreHistory(data.scores); })
      .catch(() => {});
  }, [address, isCapture]);

  // Auto-save current score to history when card loads with a real score
  useEffect(() => {
    if (!address || !score || score <= 0 || isCapture) return;
    const base = getHeliusProxyUrl() || getAppBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!base) return;
    const tier = traits?.planetTier || 'mercury';
    fetch(`${base}/api/score-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, score, tier }),
    }).catch(() => {});
  }, [address, score, isCapture]);

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
  };

  const safeTraits = traits ?? fallbackTraits;
  const displayScore = traits ? score : 0;
  const shortAddress = address
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : 'UNKNOWN';
  const tierLabel = TIER_LABELS[safeTraits.planetTier] || safeTraits.planetTier.toUpperCase();
  const tierColorClass = TIER_COLORS[safeTraits.planetTier] || 'text-white';

  const TIER_THRESHOLDS = [
    { min: 0, max: 100, tier: 'mercury', next: 'mars' },
    { min: 101, max: 250, tier: 'mars', next: 'venus' },
    { min: 251, max: 400, tier: 'venus', next: 'earth' },
    { min: 401, max: 550, tier: 'earth', next: 'neptune' },
    { min: 551, max: 700, tier: 'neptune', next: 'uranus' },
    { min: 701, max: 850, tier: 'uranus', next: 'saturn' },
    { min: 851, max: 950, tier: 'saturn', next: 'jupiter' },
    { min: 951, max: 1050, tier: 'jupiter', next: 'sun' },
    { min: 1051, max: 1400, tier: 'sun', next: null },
  ];
  const currentThreshold = TIER_THRESHOLDS.find(t => t.tier === safeTraits.planetTier) || TIER_THRESHOLDS[0];
  const tierProgress = currentThreshold.max > currentThreshold.min
    ? Math.min(1, (displayScore - currentThreshold.min) / (currentThreshold.max - currentThreshold.min))
    : 1;
  const nextTierLabel = currentThreshold.next ? (TIER_LABELS[currentThreshold.next] || '') : null;
  const ptsToNext = currentThreshold.next ? Math.max(0, currentThreshold.max + 1 - displayScore) : 0;
  const badgeItems = getBadgeItems(safeTraits);
  const activeBadges = badgeItems.filter((badge) => badge.isActive);
  const inactiveBadges = badgeItems.filter((badge) => !badge.isActive);
  const orderedBadges = [...activeBadges, ...inactiveBadges];
  const frontBadges = activeBadges.slice(0, 5);

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
          transition={{ type: 'tween', duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
          style={{ transformStyle: 'preserve-3d' }}
        >
        {/* FRONT */}
        <div
          className={`celestial-card-face absolute inset-0 w-full h-full rounded-[40px] overflow-hidden border border-white/10 bg-[#020408] shadow-[0_0_50px_-10px_rgba(0,150,255,0.2)] backface-hidden flex flex-col ${isFlipped ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'}`}
          style={{ backfaceVisibility: 'hidden', zIndex: isFlipped ? 0 : 20 }}
          onClick={() => {
            if (!isCapture) {
              setIsFlipped(true);
            }
          }}
        >
          {/* Card background — separate suckable piece */}
          <div data-suck="bg" className="absolute inset-0 rounded-[40px] bg-[#020408] border border-white/10 shadow-[0_0_50px_-10px_rgba(0,150,255,0.2)] pointer-events-none">
            <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-black/60 rounded-[40px]" />
          </div>

          {/* Header */}
          <div data-suck="header" className="relative z-20 pt-8 px-7 flex flex-col items-center text-center gap-1">
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
            <p className="text-cyan-200/50 text-[9px] font-bold tracking-[0.3em] uppercase">
              Tier Level
            </p>
            <h1 className={`text-3xl font-black uppercase tracking-widest drop-shadow-[0_2px_4px_rgba(0,0,0,1)] ${tierColorClass}`}>
              {tierLabel}
            </h1>
          </div>

          {!isCapture && (
            <button
              type="button"
              className={`game-card-portal capture-hidden ${jumpingToGame ? 'is-jumping' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                if (jumpingToGame || suckingIn || consuming) return;
                clearTransitionTimers();
                setJumpingToGame(true);

                const portal = shellRef.current?.querySelector('.game-card-portal') as HTMLElement | null;
                if (portal) {
                  portal.style.animation = 'wt-portal-grow 0.45s ease-out forwards';
                  portal.style.zIndex = '100';
                }

                transitionTimersRef.current.push(window.setTimeout(() => {
                  createWormholeTunnel();
                }, 280));

                const returnAddress = address ? { returnAddress: address } : {};
                transitionTimersRef.current.push(window.setTimeout(() => {
                  navigate('/game', { state: { fromAppJump: true, ...returnAddress } });
                }, 1500));
              }}
            >
              <span className="game-card-portal__glow" />
              <svg className="game-card-portal__ship" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C12 2 8 6 8 12C8 16 9.5 19 10 20L12 22L14 20C14.5 19 16 16 16 12C16 6 12 2 12 2Z" fill="url(#shipGrad)" stroke="rgba(6,182,212,0.6)" strokeWidth="0.5"/>
                <path d="M8 12L4 15L8 14Z" fill="rgba(6,182,212,0.5)"/>
                <path d="M16 12L20 15L16 14Z" fill="rgba(6,182,212,0.5)"/>
                <circle cx="12" cy="9" r="1.8" fill="rgba(34,211,238,0.9)"/>
                <circle cx="12" cy="9" r="1" fill="rgba(255,255,255,0.6)"/>
                <path d="M10.5 18L12 21L13.5 18" fill="rgba(251,146,60,0.9)"/>
                <path d="M11 18.5L12 20.5L13 18.5" fill="rgba(253,186,116,0.8)"/>
                <defs>
                  <linearGradient id="shipGrad" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="rgba(6,182,212,0.9)"/>
                    <stop offset="0.5" stopColor="rgba(148,163,184,0.95)"/>
                    <stop offset="1" stopColor="rgba(100,116,139,0.9)"/>
                  </linearGradient>
                </defs>
              </svg>
              <span className="game-card-portal__label">Prism League</span>
            </button>
          )}

          {!isCapture && BLACKHOLE_ENABLED && (
            <button
              type="button"
              className="bh-card-portal capture-hidden"
              onClick={(event) => {
                event.stopPropagation();
                if (suckingIn || consuming) return;
                clearTransitionTimers();
                setSuckingIn(true);

                // Phase 1: Portal grows
                const portal = shellRef.current?.querySelector('.bh-card-portal') as HTMLElement | null;
                if (portal) {
                  portal.style.animation = 'wt-portal-grow 0.45s ease-out forwards';
                  portal.style.zIndex = '100';
                }

                // Phase 2: Wormhole tunnel
                transitionTimersRef.current.push(window.setTimeout(() => {
                  createWormholeTunnel();
                }, 350));

                // Phase 3: Navigate (tunnel persists across route change)
                const target = address ? `/blackhole?address=${encodeURIComponent(address)}` : '/blackhole';
                transitionTimersRef.current.push(window.setTimeout(() => {
                  navigate(target);
                }, 1650));
              }}
            >
              <span className="bh-card-portal__glow" />
              <span className="bh-card-portal__disk" />
              <span className="bh-card-portal__ring" />
              <span className="bh-card-portal__core" />
              <span className="bh-card-portal__flare bh-card-portal__flare--t" />
              <span className="bh-card-portal__flare bh-card-portal__flare--b" />
              <span className="bh-card-portal__label" data-suck="label">Black Hole</span>
            </button>
          )}
          {wormholeActive && (
            <div className="wormhole-overlay">
              {Array.from({ length: 14 }).map((_, i) => (
                <span
                  key={i}
                  className="wh-ring"
                  style={{
                    width: `${30 + i * 50}px`,
                    height: `${30 + i * 50}px`,
                    borderColor: i % 3 === 0
                      ? 'rgba(255,140,90,0.4)'
                      : i % 3 === 1
                        ? 'rgba(100,180,255,0.35)'
                        : 'rgba(255,200,160,0.2)',
                    borderWidth: i < 4 ? '2px' : '1px',
                    animation: `wh-ring-expand 1.6s ${i * 0.06}s cubic-bezier(0.22,1,0.36,1) forwards`,
                  }}
                />
              ))}
            </div>
          )}

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
              dpr={IS_MOBILE ? [1, 1.3] : [1, 1.5]}
              onCreated={({ gl }) => {
                const canvas = gl.domElement;
                canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
                canvas.addEventListener('webglcontextrestored', () => { gl.forceContextRestore?.(); });
              }}
            >
              {!isCapture && <FrameDetector onReady={onSceneReady} texturesReady={texturesReady} />}
              <ambientLight intensity={0.6} />
              <pointLight position={[10, 5, 5]} intensity={1.5} color="#fff" />
              <pointLight position={[-8, -5, -5]} intensity={0.5} color="#4cc9f0" />
              
              <StarField
                count={IS_MOBILE ? 250 : 560}
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
                  <Planet3D tier={safeTraits.planetTier} isCapture={isCapture} onTexturesReady={handleTexturesReady} />
                </Suspense>
              </Float>

              <Environment preset="city" />
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
          <div data-suck="footer" className="relative z-20 mt-auto px-7 pb-8 flex flex-col gap-5">
            <div className="flex justify-center items-center border-t border-white/5 pt-5 relative z-30">
               {/* Badges moved here */}
               {frontBadges.length > 0 ? (
                <div className="front-badges flex gap-3 flex-wrap justify-center px-6 w-full pointer-events-auto">
                  {frontBadges.map((badge) => (
                    <div key={badge.key} className="badge-icon-wrap">
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
          className={`celestial-card-face absolute inset-0 w-full h-full rounded-[40px] border border-white/10 bg-[#020408] shadow-2xl backface-hidden flex flex-col overflow-hidden ${!isFlipped ? 'pointer-events-none' : 'pointer-events-auto'}`}
          style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', pointerEvents: isFlipped ? 'auto' : 'none', zIndex: isFlipped ? 20 : 0 }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative z-10 flex flex-col h-full" style={{ transformStyle: 'flat', transform: 'translateZ(0)', willChange: 'auto' }}>
            {/* Flip Button (Back) */}
            {/* Back Header */}
            <div className="text-center pt-8 pb-4 border-b border-white/5 bg-black/20 relative z-20">
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
                      cx="44" cy="44" r="38" fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={`${tierProgress * 238.76} 238.76`}
                      className={`${tierColorClass} transition-all duration-1000 ease-out`}
                      style={{ filter: 'drop-shadow(0 0 4px currentColor)' }}
                    />
                  </svg>
                  <span
                    data-capture="score"
                    className={`capture-value text-3xl font-mono font-bold tracking-tighter drop-shadow-lg ${tierColorClass}`}
                  >
                    {displayScore}
                  </span>
                </div>
                <span className="text-white/20 text-[8px] uppercase tracking-[0.3em]">Identity Score</span>
                {nextTierLabel && ptsToNext > 0 && (
                  <span className="text-white/15 text-[8px] mt-0.5">
                    <span className="text-white/25">{ptsToNext}</span> pts to {nextTierLabel}
                  </span>
                )}
              </div>
              <p
                data-capture="address"
                className={`capture-value font-mono text-[10px] mt-1 tracking-wider ${tierColorClass}`}
              >
                {shortAddress}
              </p>
            </div>

            {/* Tabs Container */}
            <div className="flex-1 flex flex-col min-h-0 bg-black/10 cursor-auto relative z-10" onClick={(e) => e.stopPropagation()}>
            <Tabs defaultValue={defaultTab} className="w-full h-full flex flex-col pointer-events-auto">
              <div className="px-6 pt-4">
                <TabsList className="w-full grid grid-cols-2 bg-white/5 border border-white/5 pointer-events-auto">
                  <TabsTrigger value="stats" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-200 cursor-pointer pointer-events-auto">STATS</TabsTrigger>
                  <TabsTrigger value="badges" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-200 cursor-pointer pointer-events-auto">BADGES</TabsTrigger>
                </TabsList>
              </div>

              {/* STATS CONTENT */}
              <TabsContent value="stats" className="flex-1 overflow-y-auto px-5 pt-4 pb-16 custom-scrollbar relative z-20 pointer-events-auto">
                {/* 2-col stats grid with rich metric cards */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <StatItem icon={<Wallet className="w-3.5 h-3.5" />} label="SOL Balance" value={`${safeTraits.solBalance.toFixed(2)}`} captureKey="sol" bar={Math.min(safeTraits.solBalance / 100, 1)} />
                  <StatItem icon={<Clock className="w-3.5 h-3.5" />} label="Wallet Age" value={`${safeTraits.walletAgeDays}d`} captureKey="age" bar={Math.min(safeTraits.walletAgeDays / 1500, 1)} />
                  <StatItem icon={<Activity className="w-3.5 h-3.5" />} label="Transactions" value={safeTraits.txCount > 999 ? `${(safeTraits.txCount / 1000).toFixed(1)}k` : safeTraits.txCount.toString()} captureKey="tx" bar={Math.min(safeTraits.txCount / 10000, 1)} />
                  <StatItem icon={<Trophy className="w-3.5 h-3.5" />} label="NFTs" value={safeTraits.nftCount.toString()} captureKey="nfts" bar={Math.min(safeTraits.nftCount / 100, 1)} />
                  <StatItem icon={<Flame className="w-3.5 h-3.5" />} label="Daily Activity" value={`${(safeTraits.txCount / Math.max(safeTraits.walletAgeDays, 1)).toFixed(1)} tx/d`} captureKey="activity" bar={Math.min((safeTraits.txCount / Math.max(safeTraits.walletAgeDays, 1)) / 10, 1)} />
                  <StatItem icon={<Hourglass className="w-3.5 h-3.5" />} label="Dormancy" value={safeTraits.daysSinceLastTx ? `${safeTraits.daysSinceLastTx}d ago` : 'Active'} captureKey="dormancy" bar={safeTraits.daysSinceLastTx ? Math.max(0, 1 - safeTraits.daysSinceLastTx / 365) : 1} />
                  <StatItem icon={<Zap className="w-3.5 h-3.5" />} label="Meme Coins" value={safeTraits.memeCoinsHeld.length.toString()} captureKey="memes" bar={Math.min(safeTraits.memeCoinsHeld.length / 10, 1)} />
                  <StatItem icon={<SparklesIcon className="w-3.5 h-3.5" />} label="Planet" value={safeTraits.planetTier.charAt(0).toUpperCase() + safeTraits.planetTier.slice(1).replace('_', ' ')} captureKey="planet" bar={(['mercury','mars','venus','earth','neptune','uranus','saturn','jupiter','sun','binary_sun'].indexOf(safeTraits.planetTier) + 1) / 10} />
                </div>

                {/* Score History — premium sparkline */}
                {scoreHistory.length >= 1 && (
                  <div className="mb-4 rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.02] via-transparent to-white/[0.01] p-3.5 relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.02),transparent_70%)]" />
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                          <span className="text-[9px] uppercase tracking-[0.15em] text-white/30 font-bold">Score History</span>
                        </div>
                        <span className="text-[9px] text-white/20 font-mono">{scoreHistory.length} {scoreHistory.length === 1 ? 'scan' : 'scans'}</span>
                      </div>
                      {(() => {
                        const pts = [...scoreHistory].reverse();
                        const maxS = Math.max(...pts.map(p => p.score), 1);
                        const minS = Math.min(...pts.map(p => p.score), 0);
                        const isFlat = maxS === minS;
                        const range = Math.max(maxS - minS, 1);
                        const w = Math.max(pts.length - 1, 1) * 20;
                        const svgW = Math.max(w, 100);

                        if (pts.length === 1 || isFlat) {
                          return (
                            <div className="flex flex-col items-center justify-center h-12 gap-1">
                              <div className="flex items-center gap-2">
                                <div className="h-px w-8 bg-gradient-to-r from-transparent to-cyan-500/30" />
                                <span className="text-sm font-bold font-mono text-cyan-300/80">{pts[pts.length - 1].score}</span>
                                <div className="h-px w-8 bg-gradient-to-l from-transparent to-cyan-500/30" />
                              </div>
                              <span className="text-[8px] text-white/20">{isFlat && pts.length > 1 ? 'Stable score' : 'Current score'}</span>
                            </div>
                          );
                        }

                        const points = pts.map((p, i) => {
                          const x = (i / Math.max(pts.length - 1, 1)) * svgW;
                          const y = 44 - ((p.score - minS) / range) * 38;
                          return `${x},${y}`;
                        }).join(' ');
                        const areaPoints = `0,46 ${points} ${svgW},46`;
                        const lastX = ((pts.length - 1) / Math.max(pts.length - 1, 1)) * svgW;
                        const lastY = 44 - ((pts[pts.length - 1].score - minS) / range) * 38;
                        return (
                          <>
                            <svg viewBox={`0 0 ${svgW} 48`} className="w-full h-12" preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="rgba(34,211,238,0.12)" />
                                  <stop offset="100%" stopColor="rgba(34,211,238,0)" />
                                </linearGradient>
                                <filter id="sparkGlow">
                                  <feGaussianBlur stdDeviation="1.5" result="blur" />
                                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                                </filter>
                              </defs>
                              <polyline points={areaPoints} fill="url(#sparkGrad)" stroke="none" />
                              <polyline points={points} fill="none" stroke="rgba(34,211,238,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#sparkGlow)" />
                              {pts.map((p, i) => {
                                const cx = (i / Math.max(pts.length - 1, 1)) * svgW;
                                const cy = 44 - ((p.score - minS) / range) * 38;
                                return <circle key={i} cx={cx} cy={cy} r="1.5" fill="rgba(34,211,238,0.25)" stroke="rgba(34,211,238,0.5)" strokeWidth="0.5" />;
                              })}
                              <circle cx={lastX} cy={lastY} r="2.5" fill="#22d3ee" filter="url(#sparkGlow)" />
                            </svg>
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-[8px] text-white/15 font-mono">low {minS}</span>
                              <span className="text-[8px] text-white/25 font-mono font-bold">peak {maxS}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                <div className="bg-gradient-to-br from-cyan-900/10 to-blue-900/10 border border-cyan-500/15 rounded-2xl p-4 relative overflow-hidden text-center">
                  <div className="absolute top-0 right-0 p-2 opacity-10">
                    <SparklesIcon className="w-8 h-8 text-cyan-500" />
                  </div>
                  <p className="text-[9px] text-cyan-300/50 uppercase tracking-[0.15em] mb-2 font-bold">Cosmic Insight</p>
                  <p className="text-sm text-cyan-100/90 font-medium leading-relaxed italic">
                    "{funFact}"
                  </p>
                </div>
              </TabsContent>

              {/* BADGES CONTENT */}
              <TabsContent value="badges" className="flex-1 overflow-y-auto px-6 pt-4 pb-16 custom-scrollbar relative z-20 pointer-events-auto">
                <div className="space-y-3 pb-4">
                  {badgeItems.length === 0 ? (
                    <div className="text-center py-10 opacity-50">
                      <p className="text-xs text-white/40">No badges earned yet.</p>
                      <p className="text-[10px] text-white/20 mt-1">Keep exploring the cosmos.</p>
                    </div>
                  ) : (
                    orderedBadges.map((badge, index) => (
                      <div
                        key={badge.key}
                        data-badge-row={index}
                        className={`flex items-center gap-3 p-3 rounded-xl border border-white/5 transition-all ${badge.isActive ? 'bg-white/5 hover:border-white/10' : 'bg-white/2 opacity-50'}`}
                      >
                        <div className="capture-badge-content flex items-center gap-3 w-full">
                          <BadgeIcon badge={badge} size="md" dataBadgeIcon />
                          <div className="flex-1 min-w-0 text-center">
                            <p
                              data-badge-label
                              className={`text-xs font-bold uppercase tracking-wider ${badge.isActive ? 'text-white' : 'text-white/50'}`}
                            >
                              {badge.label}
                            </p>
                            <p
                              data-badge-desc
                              className={`text-[10px] leading-relaxed ${badge.isActive ? 'text-white/50' : 'text-white/30'}`}
                            >
                              {badge.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
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

function StatItem({
  icon,
  label,
  value,
  captureKey,
  bar = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  captureKey?: string;
  bar?: number;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, bar)) * 100);
  return (
    <div className="relative overflow-hidden rounded-xl border p-2.5 transition-colors bg-cyan-500/[0.04] border-cyan-500/10 hover:bg-cyan-500/[0.08]">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md bg-cyan-500/10 text-cyan-400">{icon}</div>
        <span className="text-[9px] text-cyan-300/40 uppercase tracking-wider leading-none truncate">{label}</span>
      </div>
      <span
        data-stat-key={captureKey}
        className="capture-value text-sm font-bold font-mono leading-none block text-cyan-200 text-center"
      >
        {value}
      </span>
      <div className="mt-1.5 h-[3px] w-full rounded-full bg-cyan-500/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 bg-gradient-to-r from-cyan-500/60 to-cyan-400/40"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

type BadgeKey =
  | 'og'
  | 'whale'
  | 'collector'
  | 'binary'
  | 'early'
  | 'titan'
  | 'maxi'
  | 'seeker'
  | 'visionary'
  | 'bluechip'
  | 'defi_king'
  | 'meme_lord'
  | 'diamond_hands';

type BadgeItem = {
  key: BadgeKey;
  label: string;
  isActive: boolean;
  texture: string;
  description: string;
};

const badgeTexture = (file: string) => `/textures/${encodeURIComponent(file)}`;

const BADGE_TEXTURES: Record<BadgeKey, string> = {
  og: badgeTexture('OG.png'),
  whale: badgeTexture('Whale.png'),
  collector: badgeTexture('Collector.png'),
  binary: badgeTexture('Binary Sun.png'),
  early: badgeTexture('Early Adopter.png'),
  titan: badgeTexture('Tx Titan.png'),
  maxi: badgeTexture('Solana Maxi.png'),
  seeker: badgeTexture('Seeker of Truth.png'),
  visionary: badgeTexture('Visionary.png'),
  bluechip: badgeTexture('Blue Chip.png'),
  defi_king: badgeTexture('DeFi King.png'),
  meme_lord: badgeTexture('Meme Lord.png'),
  diamond_hands: badgeTexture('Diamond Hands.png'),
};

function getBadgeItems(traits: WalletTraits): BadgeItem[] {
  return [
    { 
      key: 'og', 
      label: 'OG Member', 
      isActive: traits.isOG, 
      texture: BADGE_TEXTURES.og,
      description: 'Present since the genesis of the system.'
    },
    { 
      key: 'whale', 
      label: 'Whale', 
      isActive: traits.isWhale, 
      texture: BADGE_TEXTURES.whale,
      description: 'Commands a massive gravitational pull of SOL.'
    },
    { 
      key: 'collector', 
      label: 'Collector', 
      isActive: traits.isCollector, 
      texture: BADGE_TEXTURES.collector,
      description: 'A museum of NFTs orbits this wallet.'
    },
    { 
      key: 'binary', 
      label: 'Binary Sun', 
      isActive: traits.hasCombo, 
      texture: BADGE_TEXTURES.binary,
      description: 'A rare celestial phenomenon. Dual power.'
    },
    { 
      key: 'early', 
      label: 'Early Adopter', 
      isActive: traits.isEarlyAdopter, 
      texture: BADGE_TEXTURES.early,
      description: 'Arrived before the starlight reached the rest.'
    },
    { 
      key: 'titan', 
      label: 'Tx Titan', 
      isActive: traits.isTxTitan, 
      texture: BADGE_TEXTURES.titan,
      description: 'Thousands of transactions. A network pillar.'
    },
    { 
      key: 'maxi', 
      label: 'Solana Maxi', 
      isActive: traits.isSolanaMaxi, 
      texture: BADGE_TEXTURES.maxi,
      description: 'Bleeds purple and green. Pure loyalty.'
    },
    { 
      key: 'seeker', 
      label: 'Seeker of Truth', 
      isActive: traits.hasSeeker, 
      texture: BADGE_TEXTURES.seeker,
      description: 'Possesses the ancient Seeker device.'
    },
    { 
      key: 'visionary', 
      label: 'Visionary', 
      isActive: traits.hasPreorder, 
      texture: BADGE_TEXTURES.visionary,
      description: 'Foresaw the future of the ecosystem.'
    },
    { 
      key: 'bluechip', 
      label: 'Blue Chip', 
      isActive: traits.isBlueChip, 
      texture: BADGE_TEXTURES.bluechip,
      description: 'Holds tokens from blue-chip Solana collections.'
    },
    { 
      key: 'defi_king', 
      label: 'DeFi King', 
      isActive: traits.isDeFiKing, 
      texture: BADGE_TEXTURES.defi_king,
      description: 'A master of decentralized finance protocols.'
    },
    { 
      key: 'meme_lord', 
      label: 'Meme Lord', 
      isActive: traits.isMemeLord, 
      texture: BADGE_TEXTURES.meme_lord,
      description: 'Wields the power of meme coins with reckless abandon.'
    },
    { 
      key: 'diamond_hands', 
      label: 'Diamond Hands', 
      isActive: traits.diamondHands, 
      texture: BADGE_TEXTURES.diamond_hands,
      description: 'Never sells. Holds through every storm.'
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
