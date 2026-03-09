/**
 * Cosmic Mine — Idle Clicker game for Prism League.
 *
 * Tap asteroid to mine ore → buy upgrades → auto-mine → prestige for warp stars.
 * Pure CSS/2D, no Three.js.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShipStats } from '@/lib/shipStats';

/* ── Types ── */
interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  effect: string;
  baseCost: number;
  scale: number;
  oneTime?: boolean;
}

interface UpgradeState {
  level: number;
}

interface MineState {
  ore: number;
  coins: number;
  totalLifetimeOre: number;
  warpStars: number;
  upgrades: Record<string, UpgradeState>;
  darkMatter: number;
  totalTaps: number;
  totalCoinsEarned: number;
  sessionStart: number;
  lastTick: number;
  totalPrestiges: number;
}

/* ── Upgrade definitions ── */
const UPGRADES: UpgradeDef[] = [
  { id: 'drill1', name: 'Drill Mk.I', desc: '+1 ore/tap', effect: 'ore_per_tap', baseCost: 10, scale: 1.5 },
  { id: 'auto1', name: 'Auto-Miner', desc: '+1 ore/sec', effect: 'ore_per_sec', baseCost: 50, scale: 1.8 },
  { id: 'laser', name: 'Laser Excavator', desc: '+5 ore/tap', effect: 'ore_per_tap_5', baseCost: 300, scale: 2.0 },
  { id: 'fleet', name: 'Mining Fleet', desc: '+10 ore/sec', effect: 'ore_per_sec_10', baseCost: 1000, scale: 2.2 },
  { id: 'refinery', name: 'Ore Refinery', desc: 'x2 ore→coin', effect: 'refinery', baseCost: 5000, scale: 3.0 },
  { id: 'detector', name: 'DM Detector', desc: 'Dark matter drops', effect: 'detector', baseCost: 15000, scale: 1, oneTime: true },
  { id: 'qdrill', name: 'Quantum Drill', desc: '+50 ore/tap', effect: 'ore_per_tap_50', baseCost: 25000, scale: 2.5 },
  { id: 'dyson', name: 'Dyson Harvester', desc: '+100 ore/sec', effect: 'ore_per_sec_100', baseCost: 100000, scale: 3.0 },
  { id: 'offline', name: 'Warp Capacitor', desc: '+25% offline time', effect: 'offline', baseCost: 50000, scale: 4.0 },
  { id: 'forge', name: 'Cosmic Forge', desc: '+10% auto prestige', effect: 'forge', baseCost: 500000, scale: 5.0 },
];

function getUpgradeCost(def: UpgradeDef, level: number): number {
  if (def.oneTime && level >= 1) return Infinity;
  return Math.floor(def.baseCost * Math.pow(def.scale, level));
}

function calcOrePerTap(upgrades: Record<string, UpgradeState>, shipSpeed: number): number {
  let base = 1;
  base += (upgrades.drill1?.level ?? 0) * 1;
  base += (upgrades.laser?.level ?? 0) * 5;
  base += (upgrades.qdrill?.level ?? 0) * 50;
  base += Math.floor(shipSpeed / 10);
  return base;
}

function calcOrePerSec(upgrades: Record<string, UpgradeState>, shipFirepower: number): number {
  let base = 0;
  base += (upgrades.auto1?.level ?? 0) * 1;
  base += (upgrades.fleet?.level ?? 0) * 10;
  base += (upgrades.dyson?.level ?? 0) * 100;
  const mult = 1 + shipFirepower / 100;
  return Math.floor(base * mult);
}

function calcRefineryMult(upgrades: Record<string, UpgradeState>): number {
  return Math.pow(2, upgrades.refinery?.level ?? 0);
}

function calcDarkMatterChance(upgrades: Record<string, UpgradeState>, shipLuck: number): number {
  if ((upgrades.detector?.level ?? 0) === 0) return 0;
  return 0.02 + shipLuck / 200;
}

function calcMaxOffline(upgrades: Record<string, UpgradeState>, shipShield: number): number {
  const base = 7200;
  const bonus = (upgrades.offline?.level ?? 0) * 1800;
  const shieldBonus = shipShield * 180;
  return base + bonus + shieldBonus;
}

const SAVE_KEY = 'cosmic_mine_save_v1';

function loadSave(): MineState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveMineState(state: MineState) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* */ }
}

function defaultState(): MineState {
  return {
    ore: 0, coins: 0, totalLifetimeOre: 0, warpStars: 0,
    upgrades: {}, darkMatter: 0, totalTaps: 0, totalCoinsEarned: 0,
    sessionStart: Date.now(), lastTick: Date.now(), totalPrestiges: 0,
  };
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000) return (n / 1000).toFixed(1) + 'K';
  return Math.floor(n).toLocaleString();
}

/* ── Particle burst ── */
function spawnTapParticles(container: HTMLElement, x: number, y: number, amount: string) {
  for (let i = 0; i < 6; i++) {
    const p = document.createElement('div');
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 50;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:4px;height:4px;border-radius:50%;background:#fbbf24;pointer-events:none;z-index:50;transition:all 0.5s ease-out;opacity:1;`;
    container.appendChild(p);
    requestAnimationFrame(() => {
      p.style.transform = `translate(${dx}px, ${dy}px)`;
      p.style.opacity = '0';
    });
    setTimeout(() => p.remove(), 500);
  }
  // Floating text
  const txt = document.createElement('div');
  txt.textContent = `+${amount}`;
  txt.style.cssText = `position:absolute;left:${x}px;top:${y - 10}px;font-size:14px;font-weight:900;color:#fde047;pointer-events:none;z-index:50;text-shadow:0 0 8px rgba(253,224,71,0.6);transition:all 0.7s ease-out;opacity:1;`;
  container.appendChild(txt);
  requestAnimationFrame(() => {
    txt.style.transform = 'translateY(-40px)';
    txt.style.opacity = '0';
  });
  setTimeout(() => txt.remove(), 700);
}

/* ── Props ── */
interface CosmicMineProps {
  gameState: 'start' | 'playing' | 'gameover';
  onGameOver: (score: number, coins: number, extraStats?: { asteroidsMined: number; darkMatter: number; piratesDestroyed: number }) => void;
  traits?: Record<string, unknown> | null;
  hasMintedId: boolean;
  shipStats: ShipStats;
}

/* ── Component ── */
export default function CosmicMineScene({ gameState, onGameOver, shipStats }: CosmicMineProps) {
  const [state, setState] = useState<MineState>(() => {
    const saved = loadSave();
    if (saved) {
      // Offline earnings
      const now = Date.now();
      const offlineSec = Math.floor((now - (saved.lastTick || now)) / 1000);
      if (offlineSec > 10) {
        const ops = calcOrePerSec(saved.upgrades, shipStats.firepower);
        const maxOff = calcMaxOffline(saved.upgrades, shipStats.shield);
        const effectiveSec = Math.min(offlineSec, maxOff);
        const offlineOre = ops * effectiveSec;
        if (offlineOre > 0) {
          saved.ore += offlineOre;
          saved.totalLifetimeOre += offlineOre;
          // Show welcome back message on next render
          (window as any).__cosmicMineOfflineOre = offlineOre;
        }
      }
      saved.lastTick = now;
      saved.sessionStart = now;
      return saved;
    }
    return defaultState();
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const containerRef = useRef<HTMLDivElement>(null);
  const autoSaveRef = useRef(0);
  const asteroidRef = useRef<HTMLDivElement>(null);
  const [showPrestige, setShowPrestige] = useState(false);
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);

  // Show offline earnings toast
  useEffect(() => {
    const offOre = (window as any).__cosmicMineOfflineOre;
    if (offOre && offOre > 0) {
      setOfflineMsg(`Welcome back! You mined ${formatNum(offOre)} ore while away`);
      delete (window as any).__cosmicMineOfflineOre;
      setTimeout(() => setOfflineMsg(null), 4000);
    }
  }, []);

  // Derived values
  const orePerTap = useMemo(() => calcOrePerTap(state.upgrades, shipStats.speed), [state.upgrades, shipStats.speed]);
  const orePerSec = useMemo(() => calcOrePerSec(state.upgrades, shipStats.firepower), [state.upgrades, shipStats.firepower]);
  const refineryMult = useMemo(() => calcRefineryMult(state.upgrades), [state.upgrades]);
  const dmChance = useMemo(() => calcDarkMatterChance(state.upgrades, shipStats.luck), [state.upgrades, shipStats.luck]);
  const warpStarBonus = state.warpStars * 0.1;
  const totalMult = (1 + warpStarBonus);
  const effectiveOrePerTap = Math.floor(orePerTap * totalMult);
  const effectiveOrePerSec = Math.floor(orePerSec * totalMult);
  const canPrestige = state.totalLifetimeOre >= 1_000_000;
  const warpStarsOnPrestige = canPrestige ? Math.floor(Math.sqrt(state.totalLifetimeOre / 100_000)) - state.warpStars : 0;

  // Count distinct upgrades bought
  const distinctUpgrades = useMemo(() => {
    return Object.values(state.upgrades).filter(u => u.level > 0).length;
  }, [state.upgrades]);

  // Auto-mine tick
  useEffect(() => {
    if (gameState !== 'playing') return;
    const interval = setInterval(() => {
      setState(prev => {
        if (effectiveOrePerSec <= 0) return prev;
        const newOre = prev.ore + effectiveOrePerSec;
        const newLifetime = prev.totalLifetimeOre + effectiveOrePerSec;
        return { ...prev, ore: newOre, totalLifetimeOre: newLifetime, lastTick: Date.now() };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState, effectiveOrePerSec]);

  // Auto-save every 5s
  useEffect(() => {
    if (gameState !== 'playing') return;
    autoSaveRef.current = window.setInterval(() => {
      saveMineState(stateRef.current);
    }, 5000);
    return () => clearInterval(autoSaveRef.current);
  }, [gameState]);

  // Save on unmount
  useEffect(() => () => { saveMineState(stateRef.current); }, []);

  // Handle tap
  const handleTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (gameState !== 'playing') return;
    const gained = effectiveOrePerTap;
    // Dark matter check
    let dm = 0;
    if (dmChance > 0 && Math.random() < dmChance) dm = 1;

    setState(prev => ({
      ...prev,
      ore: prev.ore + gained,
      totalLifetimeOre: prev.totalLifetimeOre + gained,
      totalTaps: prev.totalTaps + 1,
      darkMatter: prev.darkMatter + dm,
    }));

    // Visual feedback
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      let cx: number, cy: number;
      if ('touches' in e) {
        cx = e.changedTouches[0].clientX - rect.left;
        cy = e.changedTouches[0].clientY - rect.top;
      } else {
        cx = e.clientX - rect.left;
        cy = e.clientY - rect.top;
      }
      spawnTapParticles(containerRef.current, cx, cy, formatNum(gained) + (dm ? ' +DM!' : ''));
    }

    // Asteroid bounce
    if (asteroidRef.current) {
      asteroidRef.current.style.transform = 'scale(0.92)';
      setTimeout(() => {
        if (asteroidRef.current) asteroidRef.current.style.transform = 'scale(1)';
      }, 100);
    }
  }, [gameState, effectiveOrePerTap, dmChance]);

  // Convert ore to coins
  const convertOre = useCallback(() => {
    setState(prev => {
      if (prev.ore <= 0) return prev;
      const gained = Math.floor(prev.ore * refineryMult);
      return { ...prev, ore: 0, coins: prev.coins + gained, totalCoinsEarned: prev.totalCoinsEarned + gained };
    });
  }, [refineryMult]);

  // Buy upgrade
  const buyUpgrade = useCallback((def: UpgradeDef) => {
    setState(prev => {
      const current = prev.upgrades[def.id]?.level ?? 0;
      const cost = getUpgradeCost(def, current);
      if (prev.coins < cost) return prev;
      if (def.oneTime && current >= 1) return prev;
      return {
        ...prev,
        coins: prev.coins - cost,
        upgrades: { ...prev.upgrades, [def.id]: { level: current + 1 } },
      };
    });
  }, []);

  // Prestige
  const doPrestige = useCallback(() => {
    if (!canPrestige) return;
    const newStars = Math.floor(Math.sqrt(state.totalLifetimeOre / 100_000));
    setState(prev => ({
      ...defaultState(),
      warpStars: newStars,
      totalPrestiges: prev.totalPrestiges + 1,
      darkMatter: prev.darkMatter,
      totalTaps: prev.totalTaps,
      totalCoinsEarned: prev.totalCoinsEarned,
      totalLifetimeOre: prev.totalLifetimeOre,
      sessionStart: prev.sessionStart,
      lastTick: Date.now(),
    }));
    setShowPrestige(false);
  }, [canPrestige, state.totalLifetimeOre]);

  // End session → report stats
  const handleEndSession = useCallback(() => {
    const s = stateRef.current;
    saveMineState(s);
    const sessionSec = Math.floor((Date.now() - s.sessionStart) / 1000);
    onGameOver(
      Math.floor(s.totalLifetimeOre / 100), // score
      s.totalCoinsEarned,
      { asteroidsMined: s.totalTaps, darkMatter: s.darkMatter, piratesDestroyed: 0 }
    );
  }, [onGameOver]);

  // Auto-end when gameState becomes gameover from parent
  useEffect(() => {
    if (gameState === 'gameover') handleEndSession();
  }, [gameState, handleEndSession]);

  if (gameState !== 'playing') return null;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden select-none"
      style={{ background: 'radial-gradient(ellipse at 50% 30%, #0a0a2e 0%, #050510 50%, #000 100%)' }}
    >
      {/* Stars background */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.3), transparent), radial-gradient(1px 1px at 80% 20%, rgba(255,255,255,0.2), transparent), radial-gradient(1px 1px at 50% 70%, rgba(255,255,255,0.15), transparent), radial-gradient(1px 1px at 10% 80%, rgba(255,255,255,0.2), transparent), radial-gradient(1px 1px at 90% 60%, rgba(255,255,255,0.25), transparent)' }} />

      {/* Offline earnings toast */}
      {offlineMsg && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 text-xs font-bold backdrop-blur-md animate-pulse">
          {offlineMsg}
        </div>
      )}

      {/* ═══ Top HUD ═══ */}
      <div className="absolute top-12 left-0 right-0 z-20 flex flex-col items-center gap-1 pointer-events-none">
        {/* Ore counter */}
        <div className="text-3xl font-black text-amber-300 tabular-nums drop-shadow-[0_0_12px_rgba(251,191,36,0.4)]">
          {formatNum(state.ore)} <span className="text-lg text-amber-400/60">ore</span>
        </div>
        {/* Stats row */}
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-cyan-400">⛏ {formatNum(effectiveOrePerTap)}/tap</span>
          <span className="text-emerald-400">⚡ {formatNum(effectiveOrePerSec)}/sec</span>
          <span className="text-yellow-400">💰 {formatNum(state.coins)}</span>
          {state.warpStars > 0 && <span className="text-purple-400">⭐ {state.warpStars} (+{Math.round(warpStarBonus * 100)}%)</span>}
          {state.darkMatter > 0 && <span className="text-fuchsia-400">🌑 {state.darkMatter}</span>}
        </div>
      </div>

      {/* ═══ Tappable Asteroid (center) ═══ */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-auto">
        <div
          ref={asteroidRef}
          className="w-32 h-32 rounded-full cursor-pointer active:scale-90 transition-transform duration-100"
          style={{
            background: 'radial-gradient(circle at 35% 35%, #6b7280 0%, #374151 40%, #1f2937 70%, #111827 100%)',
            boxShadow: '0 0 40px rgba(251,191,36,0.15), 0 0 80px rgba(251,191,36,0.05), inset -8px -8px 20px rgba(0,0,0,0.5), inset 4px 4px 10px rgba(255,255,255,0.05)',
            border: '2px solid rgba(251,191,36,0.2)',
          }}
          onClick={handleTap}
          onTouchEnd={handleTap}
        >
          {/* Crater details */}
          <div className="absolute top-5 left-8 w-4 h-3 rounded-full bg-gray-800/60" />
          <div className="absolute top-12 right-6 w-6 h-5 rounded-full bg-gray-900/40" />
          <div className="absolute bottom-6 left-5 w-3 h-3 rounded-full bg-gray-700/50" />
          {/* Ore veins */}
          <div className="absolute top-8 right-8 w-2 h-8 rounded-full bg-amber-500/30 rotate-45" />
          <div className="absolute bottom-10 left-10 w-2 h-6 rounded-full bg-amber-400/20 -rotate-30" />
        </div>
        {/* Glow pulse */}
        <div className="absolute inset-0 rounded-full animate-ping opacity-10" style={{ background: 'radial-gradient(circle, rgba(251,191,36,0.3), transparent 70%)' }} />
      </div>

      {/* ═══ Convert ore button ═══ */}
      {state.ore >= 10 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-[90px] z-20 pointer-events-auto">
          <button
            onClick={convertOre}
            className="px-4 py-1.5 rounded-xl text-xs font-bold bg-amber-500/20 border border-amber-400/30 text-amber-300 hover:bg-amber-500/30 active:scale-95 transition-all backdrop-blur-sm"
          >
            Refine {formatNum(state.ore)} ore → {formatNum(Math.floor(state.ore * refineryMult))} coins
          </button>
        </div>
      )}

      {/* ═══ Prestige button (floating) ═══ */}
      {canPrestige && (
        <div className="absolute top-28 right-3 z-30 pointer-events-auto">
          <button
            onClick={() => setShowPrestige(true)}
            className="px-3 py-1.5 rounded-xl text-[10px] font-black bg-purple-500/20 border border-purple-400/40 text-purple-300 hover:bg-purple-500/30 active:scale-95 transition-all animate-pulse"
          >
            ⭐ Warp Reset{warpStarsOnPrestige > 0 ? ` (+${warpStarsOnPrestige})` : ''}
          </button>
        </div>
      )}

      {/* ═══ Prestige modal ═══ */}
      {showPrestige && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-auto">
          <div className="w-80 p-5 rounded-2xl bg-[#0a0a20]/95 border border-purple-500/30 text-center">
            <div className="text-lg font-black text-purple-300 mb-2">⭐ Warp Reset</div>
            <div className="text-xs text-white/50 mb-3">
              Reset ore, coins & upgrades. Keep warp stars, achievements, lifetime ore.
            </div>
            <div className="text-sm text-purple-400 font-bold mb-4">
              You will have {Math.floor(Math.sqrt(state.totalLifetimeOre / 100_000))} warp stars (+{Math.round(Math.floor(Math.sqrt(state.totalLifetimeOre / 100_000)) * 10)}% all income)
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowPrestige(false)} className="flex-1 py-2 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/50 active:scale-95 transition-all">Cancel</button>
              <button onClick={doPrestige} className="flex-1 py-2 rounded-xl text-xs font-bold bg-purple-500/30 border border-purple-400/40 text-purple-300 active:scale-95 transition-all">Prestige</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Upgrades panel (bottom) ═══ */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-auto">
        <div className="px-3 pb-3 pt-1">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider">Upgrades</span>
            <button
              onClick={handleEndSession}
              className="text-[10px] text-red-400/60 hover:text-red-400 font-bold px-2 py-0.5 rounded-lg bg-red-500/10 border border-red-500/20 transition-colors"
            >
              End Session
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none" style={{ WebkitOverflowScrolling: 'touch' }}>
            {UPGRADES.map(def => {
              const level = state.upgrades[def.id]?.level ?? 0;
              const cost = getUpgradeCost(def, level);
              const canBuy = state.coins >= cost && !(def.oneTime && level >= 1);
              const maxed = def.oneTime && level >= 1;
              return (
                <button
                  key={def.id}
                  onClick={() => buyUpgrade(def)}
                  disabled={!canBuy}
                  className={`flex-shrink-0 w-[120px] p-2.5 rounded-xl border text-left transition-all active:scale-95 ${
                    maxed
                      ? 'bg-emerald-500/10 border-emerald-400/20'
                      : canBuy
                        ? 'bg-white/[0.04] border-cyan-400/20 hover:bg-white/[0.08] hover:border-cyan-400/40'
                        : 'bg-white/[0.02] border-white/[0.06] opacity-50'
                  }`}
                >
                  <div className="text-[10px] font-black text-white/80 mb-0.5 truncate">{def.name}</div>
                  <div className="text-[9px] text-white/40 mb-1.5">{def.desc}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-cyan-400/70">Lv.{level}</span>
                    {maxed ? (
                      <span className="text-[9px] font-bold text-emerald-400">MAX</span>
                    ) : (
                      <span className={`text-[9px] font-bold ${canBuy ? 'text-amber-400' : 'text-white/30'}`}>{formatNum(cost)}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
