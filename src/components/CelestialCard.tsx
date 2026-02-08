import { Suspense, useCallback, useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { Canvas } from '@react-three/fiber';
import { Environment, Float, OrbitControls } from '@react-three/drei';
import { Activity, Clock, Info, Trophy, Wallet, Sparkles as SparklesIcon, Zap, Skull, Shield, Gem, Flame, Hourglass, RotateCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Planet3D } from './Planet3D';
import { StarField } from './StarField';
import type { WalletData, WalletTraits } from '@/hooks/useWalletData';

import { getRandomFunnyFact } from '@/utils/funnyFacts';
import { BLACKHOLE_ENABLED } from '@/constants';

interface CelestialCardProps {
  data: WalletData;
  captureMode?: boolean;
  captureView?: 'front' | 'back';
  captureTab?: 'stats' | 'badges';
  fromBlackHole?: boolean;
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
  { data, captureMode = false, captureView = 'front', captureTab = 'stats', fromBlackHole = false },
  ref
) {
  const [isFlipped, setIsFlipped] = useState(captureView === 'back');
  const [isInteracting, setIsInteracting] = useState(false);
  const [wormholeActive, setWormholeActive] = useState(false);
  const [suckingIn, setSuckingIn] = useState(false);
  const [unsucking, setUnsucking] = useState(fromBlackHole);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const { traits, score, address } = data;
  const isCapture = Boolean(captureMode);
  const defaultTab = captureTab === 'badges' ? 'badges' : 'stats';
  const navigate = useNavigate();

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
      // Explicitly clear animation-related styles to restore WebGL canvas
      const shell = shellRef.current;
      if (shell) {
        shell.querySelectorAll('[data-suck]').forEach((el) => {
          const h = el as HTMLElement;
          h.style.removeProperty('filter');
          h.style.removeProperty('animation');
          h.style.removeProperty('transform');
          h.style.removeProperty('opacity');
        });
        const stage = shell.closest('.card-stage');
        if (stage) {
          const mp = stage.querySelector('.mint-panel') as HTMLElement | null;
          if (mp) {
            mp.style.removeProperty('filter');
            mp.style.removeProperty('animation');
            mp.style.removeProperty('transform');
            mp.style.removeProperty('opacity');
          }
        }
      }
      setUnsucking(false);
    }, 2400);
    return () => { cancelAnimationFrame(raf1); clearTimeout(timer); };
  }, [unsucking, setSuckVars]);

  // 3D Tilt Logic
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-300, 300], [5, -5]), { stiffness: 150, damping: 20 });
  const rotateY = useSpring(useTransform(x, [-300, 300], [-5, 5]), { stiffness: 150, damping: 20 });

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (isCapture || isInteracting || isFlipped) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set(event.clientX - centerX);
    y.set(event.clientY - centerY);
  }

  function handleMouseLeave() {
    if (isCapture || isFlipped) return;
    x.set(0);
    y.set(0);
  }

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
  const badgeItems = getBadgeItems(safeTraits);
  const activeBadges = badgeItems.filter((badge) => badge.isActive);
  const inactiveBadges = badgeItems.filter((badge) => !badge.isActive);
  const orderedBadges = [...activeBadges, ...inactiveBadges];
  const frontBadges = activeBadges.slice(0, 5);

  const funFact = useMemo(() => getRandomFunnyFact(safeTraits), [safeTraits]);

  return (
    <motion.div 
      className={`celestial-card-shell relative w-full perspective-1000 mx-auto group ${suckingIn ? 'card-suckin-active' : ''} ${unsucking ? 'card-unsuck-active' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX: isCapture ? 0 : rotateX, rotateY: isCapture ? 0 : rotateY, transformStyle: 'preserve-3d' }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      ref={(node) => {
        shellRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
    >
      <motion.div
        className="w-full h-full relative preserve-3d"
        initial={false}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ type: 'spring', stiffness: 60, damping: 12, mass: 0.8 }}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* FRONT */}
        <div
          className={`celestial-card-face absolute inset-0 w-full h-full rounded-[40px] overflow-hidden border border-white/10 bg-[#020408] shadow-[0_0_50px_-10px_rgba(0,150,255,0.2)] backface-hidden flex flex-col transition-opacity duration-300 ${isFlipped ? 'pointer-events-none opacity-0' : 'pointer-events-auto cursor-pointer opacity-100'}`}
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

          {!isCapture && BLACKHOLE_ENABLED && (
            <button
              type="button"
              className="bh-card-portal capture-hidden"
              onClick={(event) => {
                event.stopPropagation();
                // Set CSS variables FIRST (synchronously) so animation has correct targets
                setSuckVars();
                // Then trigger animation on next frame so vars are painted
                requestAnimationFrame(() => {
                  setSuckingIn(true);
                });
                // After charge-up (1s) + suck pieces (~1.8s), trigger camera-suck
                setTimeout(() => {
                  const shell = shellRef.current;
                  if (shell) {
                    const stage = shell.closest('.card-stage') as HTMLElement;
                    const portal = shell.querySelector('.bh-card-portal');
                    if (stage && portal) {
                      const sr = stage.getBoundingClientRect();
                      const pr = portal.getBoundingClientRect();
                      const px = ((pr.left + pr.width / 2 - sr.left) / sr.width * 100);
                      const py = ((pr.top + pr.height / 2 - sr.top) / sr.height * 100);
                      stage.style.setProperty('--portal-x', `${px}%`);
                      stage.style.setProperty('--portal-y', `${py}%`);
                      stage.classList.add('camera-sucking');
                    }
                  }
                }, 3200);
                const target = address ? `/blackhole?address=${encodeURIComponent(address)}` : '/blackhole';
                setTimeout(() => navigate(target), 4500);
              }}
            >
              <span className="bh-card-portal__glow" />
              <span className="bh-card-portal__disk" />
              <span className="bh-card-portal__ring" />
              <span className="bh-card-portal__core" />
              <span className="bh-card-portal__flare bh-card-portal__flare--t" />
              <span className="bh-card-portal__flare bh-card-portal__flare--b" />
              <span className="bh-card-portal__label">Black Hole</span>
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
              gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
              dpr={[1, 1.5]}
              onCreated={({ gl }) => {
                const canvas = gl.domElement;
                canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
                canvas.addEventListener('webglcontextrestored', () => { gl.forceContextRestore?.(); });
              }}
            >
              <ambientLight intensity={0.6} />
              <pointLight position={[10, 5, 5]} intensity={1.5} color="#fff" />
              <pointLight position={[-8, -5, -5]} intensity={0.5} color="#4cc9f0" />
              
              <StarField
                count={560}
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
                  <Planet3D tier={safeTraits.planetTier} isCapture={isCapture} />
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
          <div data-suck="footer" className="relative z-20 mt-auto px-7 pb-8 flex flex-col gap-5 pointer-events-none">
            <div className="flex justify-center items-center border-t border-white/5 pt-5 relative z-30">
               {/* Badges moved here */}
               {frontBadges.length > 0 ? (
                <div className="front-badges flex gap-2 flex-wrap justify-center px-6 w-full">
                  {frontBadges.map((badge) => (
                    <BadgeIcon key={badge.key} badge={badge} size="sm" />
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
          className={`celestial-card-face absolute inset-0 w-full h-full rounded-[40px] border border-white/10 bg-[#050505] backdrop-blur-xl shadow-2xl backface-hidden flex flex-col overflow-hidden transition-opacity duration-300 ${!isFlipped ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'}`}
          style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', pointerEvents: isFlipped ? 'auto' : 'none', zIndex: isFlipped ? 20 : 0 }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative z-10 flex flex-col h-full">
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
                <span
                  data-capture="score"
                  className={`capture-value text-4xl font-mono font-bold tracking-tighter drop-shadow-lg ${tierColorClass}`}
                >
                  {displayScore}
                </span>
                <span className="text-white/20 text-[8px] uppercase tracking-[0.3em]">Identity Score</span>
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
              <TabsContent value="stats" className="flex-1 overflow-y-auto px-6 pt-4 pb-16 custom-scrollbar relative z-20 pointer-events-auto">
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <StatItem
                    icon={<Wallet className="w-4 h-4" />}
                    label="SOL Balance"
                    value={`${safeTraits.solBalance.toFixed(2)}`}
                    captureKey="sol"
                  />
                  <StatItem
                    icon={<Clock className="w-4 h-4" />}
                    label="Wallet Age"
                    value={`${safeTraits.walletAgeDays}d`}
                    captureKey="age"
                  />
                  <StatItem
                    icon={<Activity className="w-4 h-4" />}
                    label="Tx Count"
                    value={safeTraits.txCount.toString()}
                    captureKey="tx"
                  />
                  <StatItem
                    icon={<Trophy className="w-4 h-4" />}
                    label="NFTs Held"
                    value={safeTraits.nftCount.toString()}
                    captureKey="nfts"
                  />
                  <StatItem
                    icon={<Flame className="w-4 h-4" />}
                    label="Activity Idx"
                    value={(safeTraits.txCount / Math.max(safeTraits.walletAgeDays, 1)).toFixed(2)}
                    captureKey="activity"
                  />
                  <StatItem
                    icon={<Hourglass className="w-4 h-4" />}
                    label="Dormancy"
                    value={safeTraits.daysSinceLastTx ? `${safeTraits.daysSinceLastTx}d` : 'Active'}
                    captureKey="dormancy"
                  />
                </div>

                <div className="bg-gradient-to-br from-cyan-900/10 to-blue-900/10 border border-cyan-500/20 rounded-xl p-4 relative overflow-hidden text-center">
                  <div className="absolute top-0 right-0 p-2 opacity-10">
                    <SparklesIcon className="w-16 h-16 text-cyan-500" />
                  </div>
                  <p className="text-[10px] text-cyan-300/60 uppercase tracking-widest mb-2 font-bold">Cosmic Insight</p>
                  <p className="text-sm text-cyan-100 font-medium leading-relaxed italic">
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
    </motion.div>
  );
});

function StatItem({
  icon,
  label,
  value,
  captureKey,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  captureKey?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/5 border border-white/5 group hover:bg-white/10 transition-colors">
      <div className="text-cyan-400/80 mb-2">{icon}</div>
      <span className="text-[9px] text-white/30 uppercase tracking-wider mb-0.5">{label}</span>
      <span
        data-stat-key={captureKey}
        className="capture-value text-sm font-bold text-white font-mono"
      >
        {value}
      </span>
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
  | 'visionary';

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
