/**
 * Cosmic Mine — Premium Idle Clicker for Prism League.
 *
 * Tap asteroid to mine ore → buy upgrades → auto-mine → prestige for warp stars.
 * Pure CSS/2D, no Three.js. Phases: Surface → Ore Deposits → Deep Core → Crystal Nexus.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShipStats } from '@/lib/shipStats';

/* ── Types ── */
interface UpgradeDef {
  id: string;
  name: string;
  icon: string;
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
  { id: 'drill1', name: 'Drill Mk.I', icon: '⛏', desc: '+1 ore/tap', effect: 'ore_per_tap', baseCost: 10, scale: 1.5 },
  { id: 'auto1', name: 'Auto-Miner', icon: '⚙', desc: '+1 ore/sec', effect: 'ore_per_sec', baseCost: 50, scale: 1.8 },
  { id: 'laser', name: 'Laser Cutter', icon: '⚡', desc: '+5 ore/tap', effect: 'ore_per_tap_5', baseCost: 300, scale: 2.0 },
  { id: 'fleet', name: 'Mining Fleet', icon: '🚀', desc: '+10 ore/sec', effect: 'ore_per_sec_10', baseCost: 1000, scale: 2.2 },
  { id: 'refinery', name: 'Ore Refinery', icon: '🔥', desc: 'x2 ore→coin rate', effect: 'refinery', baseCost: 5000, scale: 3.0 },
  { id: 'detector', name: 'DM Detector', icon: '💎', desc: 'Dark matter drops', effect: 'detector', baseCost: 15000, scale: 1, oneTime: true },
  { id: 'qdrill', name: 'Quantum Drill', icon: '🔬', desc: '+50 ore/tap', effect: 'ore_per_tap_50', baseCost: 25000, scale: 2.5 },
  { id: 'dyson', name: 'Dyson Harvester', icon: '☀', desc: '+100 ore/sec', effect: 'ore_per_sec_100', baseCost: 100000, scale: 3.0 },
  { id: 'offline', name: 'Warp Capacitor', icon: '🌙', desc: '+25% offline time', effect: 'offline', baseCost: 50000, scale: 4.0 },
  { id: 'forge', name: 'Cosmic Forge', icon: '⭐', desc: 'Auto-refine 10%/10s', effect: 'forge', baseCost: 500000, scale: 5.0 },
];

/* ── Calc helpers ── */
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
  return Math.floor(base * (1 + shipFirepower / 100));
}

function calcRefineryMult(upgrades: Record<string, UpgradeState>): number {
  return Math.pow(2, upgrades.refinery?.level ?? 0);
}

function calcDarkMatterChance(upgrades: Record<string, UpgradeState>, shipLuck: number): number {
  if ((upgrades.detector?.level ?? 0) === 0) return 0;
  return 0.02 + shipLuck / 200;
}

function calcMaxOffline(upgrades: Record<string, UpgradeState>, shipShield: number): number {
  return 7200 + (upgrades.offline?.level ?? 0) * 1800 + shipShield * 180;
}

/* ── Persistence ── */
const SAVE_KEY = 'cosmic_mine_save_v1';

function loadSave(): MineState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveMineState(s: MineState) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* */ }
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

/* ── Tap particles ── */
function spawnTapParticles(container: HTMLElement, x: number, y: number, label: string, phase: number) {
  const colors = ['#fbbf24', '#f59e0b', '#d97706', '#fef3c7'];
  if (phase >= 3) colors.push('#c084fc', '#a855f7');
  if (phase >= 4) colors.push('#818cf8', '#6366f1');

  for (let i = 0; i < 8; i++) {
    const p = document.createElement('div');
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 60;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const sz = 2 + Math.random() * 4;
    const c = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${sz}px;height:${sz}px;border-radius:50%;background:${c};pointer-events:none;z-index:50;transition:all .6s cubic-bezier(.25,.46,.45,.94);opacity:1;box-shadow:0 0 6px ${c};`;
    container.appendChild(p);
    requestAnimationFrame(() => { p.style.transform = `translate(${dx}px,${dy}px) scale(0.3)`; p.style.opacity = '0'; });
    setTimeout(() => p.remove(), 600);
  }

  const txt = document.createElement('div');
  txt.textContent = `+${label}`;
  txt.style.cssText = `position:absolute;left:${x}px;top:${y - 10}px;font-size:16px;font-weight:900;color:#fde047;pointer-events:none;z-index:50;text-shadow:0 0 12px rgba(253,224,71,.8);transition:all .8s cubic-bezier(.25,.46,.45,.94);opacity:1;white-space:nowrap;`;
  container.appendChild(txt);
  requestAnimationFrame(() => { txt.style.transform = 'translateY(-50px)'; txt.style.opacity = '0'; });
  setTimeout(() => txt.remove(), 800);
}

/* ── Starfield ── */
function generateStars(count: number) {
  const r: { x: number; y: number; s: number; o: number; tw: boolean; d: number }[] = [];
  let seed = 7919;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < count; i++) r.push({ x: rand() * 100, y: rand() * 100, s: 0.5 + rand() * 1.5, o: 0.15 + rand() * 0.4, tw: rand() > 0.6, d: rand() * 5 });
  return r;
}

/* ── Asteroid phase visuals ── */
function getPhase(totalTaps: number) {
  if (totalTaps >= 10000) return 4;
  if (totalTaps >= 1000) return 3;
  if (totalTaps >= 100) return 2;
  return 1;
}

const PHASE_BG = [
  '',
  'radial-gradient(circle at 35% 35%,#6b7280 0%,#374151 40%,#1f2937 70%,#111827 100%)',
  'radial-gradient(circle at 35% 35%,#78716c 0%,#44403c 40%,#292524 70%,#1c1917 100%)',
  'radial-gradient(circle at 30% 30%,#92400e 0%,#78350f 30%,#451a03 55%,#1c1917 80%,#0c0a09 100%)',
  'radial-gradient(circle at 30% 30%,#a78bfa 0%,#7c3aed 25%,#4c1d95 50%,#1e1b4b 75%,#0f0a3c 100%)',
];
const PHASE_GLOW = [
  '',
  '0 0 30px rgba(107,114,128,.1)',
  '0 0 40px rgba(120,113,108,.2),0 0 80px rgba(120,113,108,.05)',
  '0 0 50px rgba(251,191,36,.3),0 0 100px rgba(251,191,36,.1)',
  '0 0 60px rgba(124,58,237,.35),0 0 120px rgba(124,58,237,.15),0 0 200px rgba(124,58,237,.05)',
];
const PHASE_BORDER = ['', 'rgba(107,114,128,.2)', 'rgba(120,113,108,.3)', 'rgba(251,191,36,.3)', 'rgba(124,58,237,.4)'];
const PHASE_LABEL = ['', 'Surface Layer', 'Ore Deposits', 'Deep Core', 'Crystal Nexus'];
const PHASE_LABEL_CLR = ['', 'rgba(255,255,255,.25)', 'rgba(161,161,170,.5)', '#fbbf24', '#a78bfa'];

/* ── Props ── */
interface CosmicMineProps {
  gameState: 'start' | 'playing' | 'gameover';
  onGameOver: (score: number, coins: number, extraStats?: { asteroidsMined: number; darkMatter: number; piratesDestroyed: number }) => void;
  traits?: Record<string, unknown> | null;
  hasMintedId: boolean;
  shipStats: ShipStats;
}

/* ════════════════════════════════════════════════════════════════════
   ██  COMPONENT
   ════════════════════════════════════════════════════════════════════ */
export default function CosmicMineScene({ gameState, onGameOver, shipStats }: CosmicMineProps) {
  /* ── State ── */
  const [state, setState] = useState<MineState>(() => {
    const saved = loadSave();
    if (saved) {
      const now = Date.now();
      const offSec = Math.floor((now - (saved.lastTick || now)) / 1000);
      if (offSec > 10) {
        const ops = calcOrePerSec(saved.upgrades, shipStats.firepower);
        const maxOff = calcMaxOffline(saved.upgrades, shipStats.shield);
        const ore = ops * Math.min(offSec, maxOff);
        if (ore > 0) { saved.ore += ore; saved.totalLifetimeOre += ore; (window as any).__cmOff = ore; }
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
  const [tapFlash, setTapFlash] = useState(false);

  const stars = useMemo(() => generateStars(50), []);

  /* ── Offline toast ── */
  useEffect(() => {
    const off = (window as any).__cmOff;
    if (off && off > 0) {
      setOfflineMsg(`Welcome back! Mined ${formatNum(off)} ore while away`);
      delete (window as any).__cmOff;
      setTimeout(() => setOfflineMsg(null), 4000);
    }
  }, []);

  /* ── Derived values ── */
  const orePerTap = useMemo(() => calcOrePerTap(state.upgrades, shipStats.speed), [state.upgrades, shipStats.speed]);
  const orePerSec = useMemo(() => calcOrePerSec(state.upgrades, shipStats.firepower), [state.upgrades, shipStats.firepower]);
  const refineryMult = useMemo(() => calcRefineryMult(state.upgrades), [state.upgrades]);
  const dmChance = useMemo(() => calcDarkMatterChance(state.upgrades, shipStats.luck), [state.upgrades, shipStats.luck]);
  const warpBonus = state.warpStars * 0.1;
  const totalMult = 1 + warpBonus;
  const effTap = Math.floor(orePerTap * totalMult);
  const effSec = Math.floor(orePerSec * totalMult);
  const canPrestige = state.totalLifetimeOre >= 1_000_000;
  const warpOnPrestige = canPrestige ? Math.floor(Math.sqrt(state.totalLifetimeOre / 100_000)) - state.warpStars : 0;
  const phase = getPhase(state.totalTaps);
  const prestigeProg = canPrestige ? 1 : Math.min(1, state.totalLifetimeOre / 1_000_000);
  const depthKm = (state.totalLifetimeOre / 10000).toFixed(1);
  const ringC = 2 * Math.PI * 82;

  /* ── Auto-mine tick ── */
  useEffect(() => {
    if (gameState !== 'playing') return;
    const iv = setInterval(() => {
      setState(prev => {
        if (effSec <= 0) return prev;
        return { ...prev, ore: prev.ore + effSec, totalLifetimeOre: prev.totalLifetimeOre + effSec, lastTick: Date.now() };
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [gameState, effSec]);

  /* ── Auto-save ── */
  useEffect(() => {
    if (gameState !== 'playing') return;
    autoSaveRef.current = window.setInterval(() => saveMineState(stateRef.current), 5000);
    return () => clearInterval(autoSaveRef.current);
  }, [gameState]);
  useEffect(() => () => { saveMineState(stateRef.current); }, []);

  /* ── Forge auto-refine (makes forge upgrade functional) ── */
  useEffect(() => {
    if (gameState !== 'playing') return;
    const fl = state.upgrades.forge?.level ?? 0;
    if (fl === 0) return;
    const iv = setInterval(() => {
      setState(prev => {
        if (prev.ore < 100) return prev;
        const portion = Math.floor(prev.ore * 0.1 * fl);
        const gained = Math.floor(portion * calcRefineryMult(prev.upgrades));
        return { ...prev, ore: prev.ore - portion, coins: prev.coins + gained, totalCoinsEarned: prev.totalCoinsEarned + gained };
      });
    }, 10000);
    return () => clearInterval(iv);
  }, [gameState, state.upgrades.forge?.level]);

  /* ── Tap handler ── */
  const handleTap = useCallback((e: React.PointerEvent) => {
    if (gameState !== 'playing') return;
    e.preventDefault();
    const gained = effTap;
    let dm = 0;
    if (dmChance > 0 && Math.random() < dmChance) dm = 1;

    setState(prev => ({
      ...prev,
      ore: prev.ore + gained,
      totalLifetimeOre: prev.totalLifetimeOre + gained,
      totalTaps: prev.totalTaps + 1,
      darkMatter: prev.darkMatter + dm,
    }));

    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 100);

    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      spawnTapParticles(containerRef.current, e.clientX - r.left, e.clientY - r.top, formatNum(gained) + (dm ? ' +DM!' : ''), phase);
    }
    if (asteroidRef.current) {
      asteroidRef.current.style.transform = 'scale(0.88)';
      setTimeout(() => { if (asteroidRef.current) asteroidRef.current.style.transform = 'scale(1)'; }, 120);
    }
  }, [gameState, effTap, dmChance, phase]);

  /* ── Convert ore → coins ── */
  const convertOre = useCallback(() => {
    setState(prev => {
      if (prev.ore <= 0) return prev;
      const gained = Math.floor(prev.ore * calcRefineryMult(prev.upgrades));
      return { ...prev, ore: 0, coins: prev.coins + gained, totalCoinsEarned: prev.totalCoinsEarned + gained };
    });
  }, []);

  /* ── Buy upgrade ── */
  const buyUpgrade = useCallback((def: UpgradeDef) => {
    setState(prev => {
      const lv = prev.upgrades[def.id]?.level ?? 0;
      const cost = getUpgradeCost(def, lv);
      if (prev.coins < cost || (def.oneTime && lv >= 1)) return prev;
      return { ...prev, coins: prev.coins - cost, upgrades: { ...prev.upgrades, [def.id]: { level: lv + 1 } } };
    });
  }, []);

  /* ── Prestige ── */
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

  /* ── End session ── */
  const handleEndSession = useCallback(() => {
    const s = stateRef.current;
    saveMineState(s);
    onGameOver(
      Math.floor(s.totalLifetimeOre / 100),
      s.totalCoinsEarned,
      { asteroidsMined: s.totalTaps, darkMatter: s.darkMatter, piratesDestroyed: 0 },
    );
  }, [onGameOver]);

  useEffect(() => {
    if (gameState === 'gameover') handleEndSession();
  }, [gameState, handleEndSession]);

  if (gameState !== 'playing') return null;

  /* ════════════════════════════════════════════════════════
     ██  RENDER
     ════════════════════════════════════════════════════════ */
  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden select-none"
      style={{ background: 'radial-gradient(ellipse at 50% 25%,#0d0d35 0%,#070718 45%,#020208 100%)' }}
    >
      {/* ── Keyframes ── */}
      <style>{`
        @keyframes cm-tw{0%,100%{opacity:var(--o,.2)}50%{opacity:calc(var(--o,.2) + .35)}}
        @keyframes cm-vein{0%,100%{opacity:.2}50%{opacity:.6}}
        @keyframes cm-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes cm-glow{0%,100%{filter:drop-shadow(0 0 2px currentColor)}50%{filter:drop-shadow(0 0 8px currentColor)}}
        .cm-s::-webkit-scrollbar{display:none}.cm-s{scrollbar-width:none;-ms-overflow-style:none}
      `}</style>

      {/* ── Stars ── */}
      {stars.map((s, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.s,
            height: s.s,
            background: 'white',
            opacity: s.o,
            ...(s.tw ? { animation: `cm-tw ${2 + s.d}s ease-in-out infinite`, '--o': s.o } as React.CSSProperties : {}),
          }}
        />
      ))}

      {/* ── Nebula patches ── */}
      <div className="absolute pointer-events-none" style={{ left: '10%', top: '15%', width: 200, height: 200, background: 'radial-gradient(circle,rgba(124,58,237,.06) 0%,transparent 70%)', filter: 'blur(40px)' }} />
      <div className="absolute pointer-events-none" style={{ right: '5%', top: '40%', width: 150, height: 150, background: 'radial-gradient(circle,rgba(6,182,212,.05) 0%,transparent 70%)', filter: 'blur(30px)' }} />
      <div className="absolute pointer-events-none" style={{ left: '30%', bottom: '20%', width: 180, height: 180, background: 'radial-gradient(circle,rgba(251,191,36,.04) 0%,transparent 70%)', filter: 'blur(35px)' }} />

      {/* ── Offline toast ── */}
      {offlineMsg && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl text-cyan-300 text-xs font-bold backdrop-blur-xl"
          style={{ background: 'rgba(6,182,212,.12)', border: '1px solid rgba(6,182,212,.2)', animation: 'cm-float 2s ease-in-out infinite' }}
        >
          {offlineMsg}
        </div>
      )}

      {/* ═══════════ Top HUD ═══════════ */}
      <div className="absolute top-10 left-3 right-3 z-20 pointer-events-none">
        <div
          className="rounded-2xl px-4 py-3 backdrop-blur-xl"
          style={{ background: 'linear-gradient(135deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.02) 100%)', border: '1px solid rgba(255,255,255,.06)' }}
        >
          {/* Row 1: ore + coins */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-2xl font-black text-amber-300 tabular-nums" style={{ textShadow: '0 0 20px rgba(251,191,36,.3)' }}>
              {formatNum(state.ore)} <span className="text-sm text-amber-400/50 font-bold">ORE</span>
            </div>
            <div className="text-sm font-black text-yellow-400 tabular-nums">
              {formatNum(state.coins)} <span className="text-[10px] text-yellow-400/50">coins</span>
            </div>
          </div>
          {/* Row 2: stats */}
          <div className="flex items-center gap-3 text-[10px] font-bold">
            <span className="text-cyan-400/80">⛏ {formatNum(effTap)}/tap</span>
            <span className="text-emerald-400/80">⚡ {formatNum(effSec)}/sec</span>
            <span className="text-white/25">⬇ {depthKm}km</span>
            {state.warpStars > 0 && <span className="text-purple-400/80">⭐{state.warpStars} +{Math.round(warpBonus * 100)}%</span>}
            {state.darkMatter > 0 && <span className="text-fuchsia-400/80">◆{state.darkMatter}</span>}
          </div>
        </div>
      </div>

      {/* ═══════════ Asteroid (center) ═══════════ */}
      <div className="absolute top-[38%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-auto">
        {/* SVG progress ring */}
        <svg width="180" height="180" className="absolute -top-[6px] -left-[6px]" style={{ animation: 'cm-glow 3s ease-in-out infinite', color: phase >= 4 ? '#a78bfa' : '#fbbf24' }}>
          <circle cx="90" cy="90" r="82" fill="none" stroke="rgba(255,255,255,.04)" strokeWidth="2.5" />
          <circle
            cx="90" cy="90" r="82" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={ringC} strokeDashoffset={ringC * (1 - prestigeProg)}
            transform="rotate(-90 90 90)"
            style={{ transition: 'stroke-dashoffset .5s ease,stroke .3s ease', opacity: 0.6 }}
          />
        </svg>

        {/* Asteroid body */}
        <div
          ref={asteroidRef}
          className="w-[168px] h-[168px] rounded-full cursor-pointer relative"
          style={{
            background: PHASE_BG[phase],
            boxShadow: `${PHASE_GLOW[phase]},inset -10px -10px 25px rgba(0,0,0,.6),inset 5px 5px 15px rgba(255,255,255,.04)`,
            border: `2px solid ${PHASE_BORDER[phase]}`,
            transition: 'transform 120ms cubic-bezier(.25,.46,.45,.94),background .5s ease',
          }}
          onPointerDown={handleTap}
        >
          {/* Craters */}
          <div className="absolute top-6 left-10 w-5 h-4 rounded-full" style={{ background: 'rgba(0,0,0,.3)' }} />
          <div className="absolute top-14 right-7 w-7 h-5 rounded-full" style={{ background: 'rgba(0,0,0,.25)' }} />
          <div className="absolute bottom-8 left-6 w-4 h-4 rounded-full" style={{ background: 'rgba(0,0,0,.2)' }} />
          {phase >= 2 && <div className="absolute top-20 left-16 w-3 h-3 rounded-full" style={{ background: 'rgba(0,0,0,.2)' }} />}

          {/* Ore veins (pulse in later phases) */}
          <div className="absolute top-9 right-10 w-2 h-10 rounded-full" style={{
            background: phase >= 3 ? 'rgba(251,191,36,.4)' : 'rgba(251,191,36,.15)',
            transform: 'rotate(45deg)',
            animation: phase >= 2 ? 'cm-vein 2s ease-in-out infinite' : 'none',
          }} />
          <div className="absolute bottom-12 left-12 w-2 h-8 rounded-full" style={{
            background: phase >= 3 ? 'rgba(251,191,36,.35)' : 'rgba(251,191,36,.1)',
            transform: 'rotate(-30deg)',
            animation: phase >= 2 ? 'cm-vein 2.5s ease-in-out infinite .5s' : 'none',
          }} />
          {phase >= 3 && (
            <div className="absolute top-16 left-8 w-1.5 h-12 rounded-full" style={{
              background: 'rgba(251,191,36,.3)', transform: 'rotate(15deg)', animation: 'cm-vein 3s ease-in-out infinite 1s',
            }} />
          )}
          {phase >= 4 && (
            <div className="absolute inset-8 rounded-full" style={{
              background: 'radial-gradient(circle,rgba(139,92,246,.3) 0%,transparent 70%)', animation: 'cm-vein 2s ease-in-out infinite',
            }} />
          )}

          {/* Tap flash overlay */}
          {tapFlash && <div className="absolute inset-0 rounded-full" style={{ background: 'rgba(251,191,36,.15)' }} />}
        </div>

        {/* Phase label */}
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-bold whitespace-nowrap" style={{ color: PHASE_LABEL_CLR[phase] }}>
          {PHASE_LABEL[phase]}
        </div>
      </div>

      {/* ═══════════ Convert button ═══════════ */}
      {state.ore >= 10 && (
        <div className="absolute top-[58%] left-1/2 -translate-x-1/2 z-20 pointer-events-auto" style={{ animation: 'cm-float 3s ease-in-out infinite' }}>
          <button
            onClick={convertOre}
            className="px-5 py-2 rounded-2xl text-xs font-black active:scale-95 transition-all backdrop-blur-xl"
            style={{
              background: 'linear-gradient(135deg,rgba(251,191,36,.15) 0%,rgba(245,158,11,.1) 100%)',
              border: '1px solid rgba(251,191,36,.25)', color: '#fde68a',
              boxShadow: '0 0 20px rgba(251,191,36,.1)', textShadow: '0 0 10px rgba(251,191,36,.3)',
            }}
          >
            ⚒ Refine {formatNum(state.ore)} ore → {formatNum(Math.floor(state.ore * refineryMult))} coins
          </button>
        </div>
      )}

      {/* ═══════════ Prestige ═══════════ */}
      {canPrestige && (
        <div className="absolute top-28 right-3 z-30 pointer-events-auto">
          <button
            onClick={() => setShowPrestige(true)}
            className="px-3 py-2 rounded-2xl text-[10px] font-black active:scale-95 transition-all"
            style={{
              background: 'linear-gradient(135deg,rgba(124,58,237,.2) 0%,rgba(139,92,246,.1) 100%)',
              border: '1px solid rgba(124,58,237,.35)', color: '#c4b5fd',
              boxShadow: '0 0 20px rgba(124,58,237,.15)', animation: 'cm-vein 2s ease-in-out infinite',
            }}
          >
            ⭐ Warp Reset{warpOnPrestige > 0 ? ` (+${warpOnPrestige})` : ''}
          </button>
        </div>
      )}

      {/* ── Prestige modal ── */}
      {showPrestige && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto" style={{ background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(8px)' }}>
          <div className="w-80 p-6 rounded-3xl text-center" style={{ background: 'linear-gradient(180deg,rgba(15,10,60,.98) 0%,rgba(10,10,32,.98) 100%)', border: '1px solid rgba(124,58,237,.3)', boxShadow: '0 0 60px rgba(124,58,237,.1)' }}>
            <div className="text-xl font-black text-purple-300 mb-3" style={{ textShadow: '0 0 20px rgba(124,58,237,.4)' }}>⭐ Warp Reset</div>
            <div className="text-xs text-white/40 mb-4 leading-relaxed">Reset ore, coins & upgrades.<br />Keep warp stars, dark matter & lifetime stats.</div>
            <div className="text-sm text-purple-400 font-black mb-5 px-4 py-2.5 rounded-2xl" style={{ background: 'rgba(124,58,237,.1)', border: '1px solid rgba(124,58,237,.15)' }}>
              {Math.floor(Math.sqrt(state.totalLifetimeOre / 100_000))} warp stars → +{Math.round(Math.floor(Math.sqrt(state.totalLifetimeOre / 100_000)) * 10)}% all income
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowPrestige(false)}
                className="flex-1 py-2.5 rounded-2xl text-xs font-bold active:scale-95 transition-all"
                style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', color: 'rgba(255,255,255,.4)' }}
              >Cancel</button>
              <button
                onClick={doPrestige}
                className="flex-1 py-2.5 rounded-2xl text-xs font-black active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,rgba(124,58,237,.3) 0%,rgba(139,92,246,.2) 100%)', border: '1px solid rgba(124,58,237,.4)', color: '#c4b5fd', boxShadow: '0 0 20px rgba(124,58,237,.15)' }}
              >Prestige</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ Upgrades panel (bottom) ═══════════ */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-auto">
        <div className="px-3 pb-3 pt-2">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[10px] text-white/30 font-black uppercase tracking-widest">Upgrades</span>
            <button
              onClick={handleEndSession}
              className="text-[10px] font-bold px-3 py-1 rounded-xl active:scale-95 transition-all"
              style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.15)', color: 'rgba(239,68,68,.5)' }}
            >End Session</button>
          </div>
          <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto cm-s">
            {UPGRADES.map(def => {
              const lv = state.upgrades[def.id]?.level ?? 0;
              const cost = getUpgradeCost(def, lv);
              const canBuy = state.coins >= cost && !(def.oneTime && lv >= 1);
              const maxed = def.oneTime && lv >= 1;
              return (
                <button
                  key={def.id}
                  onClick={() => buyUpgrade(def)}
                  disabled={!canBuy}
                  className="p-2.5 rounded-2xl text-left transition-all active:scale-[.97]"
                  style={{
                    background: maxed ? 'rgba(16,185,129,.06)' : canBuy ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.01)',
                    border: `1px solid ${maxed ? 'rgba(16,185,129,.2)' : canBuy ? 'rgba(6,182,212,.2)' : 'rgba(255,255,255,.04)'}`,
                    opacity: canBuy || maxed ? 1 : 0.4,
                    ...(canBuy ? { boxShadow: '0 0 15px rgba(6,182,212,.05)' } : {}),
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm leading-none">{def.icon}</span>
                    <span className="text-[10px] font-black text-white/80 truncate">{def.name}</span>
                  </div>
                  <div className="text-[9px] text-white/30 mb-1.5">{def.desc}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold" style={{ color: maxed ? '#34d399' : 'rgba(6,182,212,.7)' }}>
                      {maxed ? '✓ MAX' : `Lv.${lv}`}
                    </span>
                    {!maxed && (
                      <span className="text-[9px] font-bold" style={{ color: canBuy ? '#fbbf24' : 'rgba(255,255,255,.2)' }}>
                        {formatNum(cost)}
                      </span>
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
