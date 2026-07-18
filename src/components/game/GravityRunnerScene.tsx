/**
 * Gravity Runner v5 — Cosmic Flappy Runner.
 *
 * Ship sprite (ship.png) flies horizontally. Tap/Space = upward thrust (Flappy Bird).
 * Gravity always pulls down. Constant tapping to stay airborne.
 * Obstacles: asteroid columns, comets, asteroid fields, dynamic columns.
 * Cinematic starfield + nebula background, engine trail, crystal collecting.
 * Coins accumulate passively per second + crystal bonuses.
 * Canvas 2D for max mobile performance.
 *
 * v5 changes:
 *  - Reduced base speed (~60% of v4), progressive ramp every 10s, capped near old base speed
 *  - Reduced gravity & flap impulse for smoother, more controllable flight
 *  - Predictable obstacle spacing: minimum 220px horizontal, 135px vertical gap
 *  - Gap Y clamped to middle 70% of play area (no extreme edges)
 *  - Progressive difficulty: gap shrinks over time, spawn interval tightens
 *  - Crystals now spawn inside column gaps when possible
 *  - Dense cinematic starfield (4 layers, colored stars, twinkle, glow halos)
 *  - Pre-rendered nebula canvas with slow parallax scroll
 *  - Vignette overlay for depth
 *  - Grace period before first obstacle
 */

import { useRef, useEffect, useCallback } from 'react';
import { getShipProfile } from '@/lib/shipProfiles';
import { sfxPickup } from '@/lib/gameAudio';

interface GravityRunnerProps {
  gameState: 'start' | 'countdown' | 'playing' | 'gameover';
  paused?: boolean;
  onScore: (score: number) => void;
  onCoins: (coins: number) => void;
  onGameOver: (score: number, coins: number, extraStats?: { columns: number; crystals: number }) => void;
  reviveRef: React.MutableRefObject<boolean>;
  traits: unknown;
  walletScore: number;
  hasMintedId: boolean;
  shipSkin?: string | null;
  challengeMode?: boolean;
  shipAura?: string | null;
  shipStats?: { speed: number; shield: number; firepower: number; luck: number };
}

// ── Aura colors for Canvas 2D glow ──
const AURA_CANVAS_COLORS: Record<string, string> = {
  aura_frost: '#67e8f9',
  aura_ember: '#fb923c',
  aura_electric: '#60a5fa',
  aura_plasma: '#c084fc',
  aura_dark_matter: '#8b5cf6',
  aura_binary_pulse: '#22d3ee',
  aura_solar_wind: '#fde047',
  aura_fortune_mist: '#a78bfa',
  aura_crimson_tide: '#f87171',
  aura_void_shell: '#818cf8',
  aura_stellar_tide: '#34d399',
};

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

// ── Game constants ──
const GROUND_H = 40;
const SHIP_W = 36;
const SHIP_H = 36;
// Physics balanced so gap ≈ ship visual (36px) + ~20px margin
// Jump arc = FLAP_VEL² / (2*GRAVITY) = 7² / (2*0.40) = 61px
// Gap 56px = tight but always passable with one well-timed flap
const GRAVITY = 0.4;
const FLAP_VEL = -8.0;
const MAX_FALL_VEL = 6.0;
const BASE_SPEED = 2.8;
const MAX_SPEED = 5.5;
const SPEED_RAMP_INTERVAL = 200;
const SPEED_RAMP_AMOUNT = 0.05;
const CRYSTAL_SIZE = 14;
const CRYSTAL_INTERVAL = 40;
const MIN_COL_GAP_PX = 63;
const MIN_COL_SPACING_PX = 280; // wider horizontal
const GAP_SHRINK_PER_MIN = 10; // progressive difficulty
const DYNAMIC_COL_SCORE = 12; // dynamic columns appear earlier

// ── Level themes ──
interface LevelTheme {
  name: string;
  bg1: string;
  bg2: string;
  floorColor: string;
  ceilColor: string;
  accentColor: string;
  crystalColor: string;
  obstacleColor: string;
  obstacleHighlight: string;
  scoreThreshold: number;
}

const LEVEL_THEMES: LevelTheme[] = [
  {
    name: 'Nebula',
    bg1: '#0a0818',
    bg2: '#0d1428',
    floorColor: 'rgba(34,211,238,0.06)',
    ceilColor: 'rgba(168,85,247,0.04)',
    accentColor: '#22d3ee',
    crystalColor: '#a855f7',
    obstacleColor: '#3d4a6b',
    obstacleHighlight: '#8b9dd4',
    scoreThreshold: 0,
  },
  {
    name: 'Asteroid Belt',
    bg1: '#0f0a05',
    bg2: '#1a1008',
    floorColor: 'rgba(245,158,11,0.06)',
    ceilColor: 'rgba(239,68,68,0.04)',
    accentColor: '#f59e0b',
    crystalColor: '#fbbf24',
    obstacleColor: '#5f5140',
    obstacleHighlight: '#c4ad8a',
    scoreThreshold: 500,
  },
  {
    name: 'Black Hole',
    bg1: '#050008',
    bg2: '#0a0014',
    floorColor: 'rgba(139,92,246,0.08)',
    ceilColor: 'rgba(236,72,153,0.04)',
    accentColor: '#8b5cf6',
    crystalColor: '#ec4899',
    obstacleColor: '#4c1d95',
    obstacleHighlight: '#8b5cf6',
    scoreThreshold: 1200,
  },
  {
    name: 'Warp Zone',
    bg1: '#000a0f',
    bg2: '#001420',
    floorColor: 'rgba(6,182,212,0.08)',
    ceilColor: 'rgba(16,185,129,0.06)',
    accentColor: '#06b6d4',
    crystalColor: '#10b981',
    obstacleColor: '#155e58',
    obstacleHighlight: '#2dd4bf',
    scoreThreshold: 2000,
  },
  {
    name: 'Prism Realm',
    bg1: '#0f0510',
    bg2: '#1a0820',
    floorColor: 'rgba(251,191,36,0.08)',
    ceilColor: 'rgba(34,211,238,0.06)',
    accentColor: '#fbbf24',
    crystalColor: '#22d3ee',
    obstacleColor: '#713f12',
    obstacleHighlight: '#fbbf24',
    scoreThreshold: 3000,
  },
];

function getThemeForScore(score: number): LevelTheme {
  let theme = LEVEL_THEMES[0];
  for (const t of LEVEL_THEMES) {
    if (score >= t.scoreThreshold) theme = t;
  }
  return theme;
}

// ── Pillar palette — precomputed per theme (cached; zero per-frame allocation) ──
interface PillarPalette {
  edgeDark: string;
  mid: string;
  light: string;
  capTint0: string;
  capTint1: string;
  facet: string;
  rim: string;
}
type Rgb = [number, number, number];
const _pillarPaletteCache = new Map<string, PillarPalette>();
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const rgbStr = (c: Rgb, al = 1) =>
  al >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`;
function getPillarPalette(theme: LevelTheme): PillarPalette {
  let p = _pillarPaletteCache.get(theme.name);
  if (p) return p;
  const base = hexToRgb(theme.obstacleColor);
  const hi = hexToRgb(theme.obstacleHighlight);
  const acc = hexToRgb(theme.accentColor);
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];
  p = {
    edgeDark: rgbStr(mixRgb(base, black, 0.55)),
    mid: rgbStr(base),
    light: rgbStr(mixRgb(hi, white, 0.22)),
    capTint0: rgbStr(acc, 0),
    capTint1: rgbStr(acc, 0.2),
    facet: rgbStr(mixRgb(hi, white, 0.5), 0.13),
    rim: rgbStr(acc, 0.3),
  };
  _pillarPaletteCache.set(theme.name, p);
  return p;
}
// Scratch buffer for crystal-teeth Y coords (avoids per-frame allocation)
const _toothY = new Array<number>(16).fill(0);

// ── Types ──
interface AsteroidColumn {
  x: number;
  gapY: number;
  gapH: number;
  width: number;
  passed: boolean;
  jagged: number[];
  crackSeeds: number[]; // seeds for crack pattern rendering
}

interface Comet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotSpeed: number;
  shape: number[];
  width: number; // bounding for generic filters
}

interface AsteroidField {
  x: number;
  rocks: { rx: number; ry: number; size: number; rot: number; shape: number[] }[];
  width: number;
  gapY: number;
  gapH: number;
}

/** Dynamic column: emerges from top or bottom, animated extension */
interface DynamicColumn {
  x: number;
  width: number;
  fromTop: boolean; // true = descends from ceiling, false = rises from floor
  maxH: number; // final height
  currentH: number; // current animated height
  growSpeed: number; // px per frame growth
  passed: boolean;
  jagged: number[];
  crackSeeds: number[];
  pulsing: boolean; // wobbles at full extension
}

type ObstacleUnion =
  | { kind: 'column'; data: AsteroidColumn }
  | { kind: 'comet'; data: Comet }
  | { kind: 'field'; data: AsteroidField }
  | { kind: 'dynamic'; data: DynamicColumn };

interface Crystal {
  x: number;
  y: number;
  collected: boolean;
  pulse: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface StarDot {
  x: number;
  y: number;
  size: number;
  brightness: number;
  color: string;
  twinkleSpeed: number;
  twinklePhase: number;
}

interface StarLayer {
  stars: StarDot[];
  speed: number;
}

export default function GravityRunnerScene(props: GravityRunnerProps) {
  const { gameState, paused = false, onScore, onCoins, onGameOver, reviveRef, hasMintedId } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const countdownDidReset = useRef(false);
  const pauseStartedAtRef = useRef<number | null>(null);
  const shipImgRef = useRef<HTMLImageElement | null>(null);
  const shipLoadedRef = useRef(false);
  const profileRef = useRef(getShipProfile(props.shipSkin));
  const auraColorRef = useRef<[number, number, number] | null>(
    props.shipAura && AURA_CANVAS_COLORS[props.shipAura] ? hexToRgb(AURA_CANVAS_COLORS[props.shipAura]) : null,
  );

  const _lastFlush = useRef(0);
  const stateRef = useRef({
    playerX: 70,
    playerY: 0,
    velY: 0,
    shipRotation: 0,
    score: 0,
    coins: 0,
    coinAccum: 0, // fractional coin accumulator
    speed: BASE_SPEED,
    obstacles: [] as ObstacleUnion[],
    crystals: [] as Crystal[],
    particles: [] as Particle[],
    trail: [] as { x: number; y: number; alpha: number; size: number }[],
    nextObstacle: 90,
    nextCrystal: 70,
    frameCount: 0,
    alive: true,
    screenShake: 0,
    starLayers: [] as StarLayer[],
    levelName: 'Nebula',
    levelBanner: 0,
    prevLevelName: '',
    columnsPassedForBonus: 0,
    crystalsCollected: 0,
    startTime: 0,
    lastTickTime: 0,
    _grazed: false,
    _deathTime: 0,
    _nebulaCanvas: null as HTMLCanvasElement | null,
    _nebulaScrollX: 0,
    _bgImg: null as HTMLImageElement | null,
    _parImg: null as HTMLImageElement | null,
    _bgScrollX: 0,
    _parScrollX: 0,
    exhaustParticles: [] as {
      x: number;
      y: number;
      vy: number;
      vx: number;
      life: number;
      maxLife: number;
      size: number;
    }[],
  });

  // Load coin powerup texture
  const coinImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.src = '/textures/powerups/powerup_coin.png';
    img.onload = () => {
      coinImgRef.current = img;
    };
  }, []);

  // Load ship texture
  useEffect(() => {
    const img = new Image();
    const skinKey = props.shipSkin ? props.shipSkin.replace('ship_', '') : '';
    img.src = skinKey ? `/textures/ships/ship_${skinKey}.png` : '/textures/ship.png';
    img.onload = () => {
      shipImgRef.current = img;
      shipLoadedRef.current = true;
    };
    img.onerror = () => {
      // Fallback to default ship if skin fails to load
      const fallback = new Image();
      fallback.src = '/textures/ship.png';
      fallback.onload = () => {
        shipImgRef.current = fallback;
        shipLoadedRef.current = true;
      };
    };
  }, [props.shipSkin]);

  // Flap (Flappy Bird tap) — gives upward impulse
  const flap = useCallback(() => {
    const s = stateRef.current;
    if (!s.alive) return;
    s.velY = FLAP_VEL;
    // No thrust particles — clean background only
  }, []);

  // Input handlers — prevent double-flap from touch+mouse emulation
  useEffect(() => {
    if (gameState !== 'playing' || paused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let usesTouch = false;
    const handleTouch = (e: TouchEvent) => {
      usesTouch = true;
      if (e.cancelable) e.preventDefault();
      flap();
    };
    const handleMouse = () => {
      if (usesTouch) return;
      flap();
    };
    canvas.addEventListener('touchstart', handleTouch, { passive: false });
    canvas.addEventListener('mousedown', handleMouse);
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      canvas.removeEventListener('touchstart', handleTouch);
      canvas.removeEventListener('mousedown', handleMouse);
      window.removeEventListener('keydown', handleKey);
    };
  }, [gameState, paused, flap]);

  // A revive countdown must not advance score, speed, physics, or spawn timing.
  useEffect(() => {
    const s = stateRef.current;
    const now = performance.now();
    if (paused) {
      pauseStartedAtRef.current = now;
      return;
    }
    if (pauseStartedAtRef.current !== null) {
      const pausedFor = now - pauseStartedAtRef.current;
      s.startTime += pausedFor;
      s.lastTickTime = now;
      (s as any)._prevFrame = now;
      pauseStartedAtRef.current = null;
    }
  }, [paused]);

  // ── Main game loop ──
  useEffect(() => {
    if (gameState !== 'playing' && gameState !== 'countdown') {
      cancelAnimationFrame(animRef.current);
      clearTimeout(animRef.current);
      return;
    }
    const isCountdown = gameState === 'countdown';
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Resize
    const dpr = Math.min(window.devicePixelRatio, 2);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const cssW = () => canvas.width / dpr;
    const cssH = () => canvas.height / dpr;

    // Reset state only for a new run; preserve it across either countdown phase.
    const s = stateRef.current;
    const skipReset = !isCountdown && (countdownDidReset.current || paused);
    if (isCountdown || paused) countdownDidReset.current = true;
    if (!isCountdown && !paused) countdownDidReset.current = false;

    if (!skipReset) {
      const W = cssW();
      const H = cssH();
      s.playerY = H / 2 - SHIP_H / 2;
      s.velY = 0;
      s.shipRotation = 0;
      s.score = 0;
      s.coins = 0;
      s.coinAccum = 0;
      s.speed = BASE_SPEED;
      s.obstacles = [];
      s.crystals = [];
      s.particles = [];
      s.trail = [];
      s.exhaustParticles = [];
      s.nextObstacle = 90; // ~1.5 sec grace period (normalized by dtScale)
      s.nextCrystal = 0;
      s.frameCount = 0;
      s.alive = true;
      s.screenShake = 0;
      s.levelName = 'Nebula';
      s.levelBanner = 0;
      s.prevLevelName = '';
    }
    s.columnsPassedForBonus = 0;
    s.crystalsCollected = 0;
    s._grazed = false;
    s.startTime = performance.now();
    s.lastTickTime = s.startTime;
    let hiddenAt = 0;
    let unmounted = false;

    // Pause score timer when tab is hidden (prevents score inflation)
    // Challenge mode: instant game over on tab hide (anti-abuse)
    const onVisChange = () => {
      if (document.hidden) {
        if (props.challengeMode && !s.dead) {
          s.dead = true;
          onGameOver(s.score, s.coins, { columns: s.columnsPassedForBonus, crystals: s.crystalsCollected });
          return;
        }
        hiddenAt = performance.now();
      } else if (hiddenAt > 0) {
        const pauseDuration = performance.now() - hiddenAt;
        s.startTime += pauseDuration;
        s.lastTickTime = performance.now();
        hiddenAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisChange);

    const coinMult = hasMintedId ? 2 : 1;

    // Background comets
    (s as any)._comets = Array.from({ length: 2 }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0,
      active: false,
    }));
    (s as any)._cometTimer = 0;

    // Stars handled by CosmicStarfield component

    s.starLayers = [];
    s._nebulaCanvas = null;
    s._nebulaScrollX = 0;

    // ── Spawn helpers ──

    /** Compute current gap height based on elapsed time (progressive difficulty). */
    function currentGapH(playH: number): number {
      const elapsedMin = (performance.now() - s.startTime) / 60000;
      const startGap = 135;
      const shrunk = startGap - elapsedMin * GAP_SHRINK_PER_MIN;
      // Never smaller than MIN_COL_GAP_PX, and never more than 60% of playable area
      return Math.max(MIN_COL_GAP_PX, Math.min(shrunk, playH * 0.6));
    }

    /** Find rightmost obstacle X so we can enforce minimum horizontal spacing. */
    function rightmostObstacleX(): number {
      let maxX = -Infinity;
      for (const o of s.obstacles) {
        const ox = o.data.x + (o.data.width ?? 0);
        if (ox > maxX) maxX = ox;
      }
      return maxX;
    }

    function spawnObstacle() {
      const W = cssW();
      const H = cssH();
      const floorY = H - GROUND_H;
      const ceilY = GROUND_H;
      const playH = floorY - ceilY;

      // Spawn just off-screen right, or after last obstacle with min spacing
      const rightEdge = rightmostObstacleX();
      const spawnX =
        rightEdge === -Infinity
          ? W + 10 // no obstacles on screen — spawn just off right edge
          : Math.max(W + 10, rightEdge + MIN_COL_SPACING_PX);

      const roll = Math.random();
      // Flappy Bird style: mostly paired columns, occasional comets/fields at higher scores
      if (roll < (s.score < 30 ? 0.95 : 0.7)) {
        // Asteroid column pair — ALWAYS both top and bottom (Flappy Bird)
        const gapH = currentGapH(playH);
        // Clamp gapY to middle 70% of playable area
        const margin = playH * 0.15;
        const minGapY = ceilY + margin + gapH / 2;
        const maxGapY = floorY - margin - gapH / 2;
        const gapY = minGapY + Math.random() * Math.max(0, maxGapY - minGapY);
        const colW = 34 + Math.random() * 14;
        const jagged: number[] = [];
        const crackSeeds: number[] = [];
        for (let j = 0; j < 14; j++) jagged.push((Math.random() - 0.5) * 14);
        for (let j = 0; j < 6; j++) crackSeeds.push(Math.random());
        s.obstacles.push({
          kind: 'column',
          data: { x: spawnX, gapY, gapH, width: colW, passed: false, jagged, crackSeeds },
        });
        // Crystal in every column gap
        s.crystals.push({ x: spawnX + colW / 2, y: gapY, collected: false, pulse: Math.random() * Math.PI * 2 });
      } else if (roll < 0.85) {
        // Comet — fast diagonal asteroid
        const margin = playH * 0.15;
        const y = ceilY + margin + Math.random() * (playH - margin * 2);
        const cometSize = 10 + Math.random() * 10;
        const sides = 6 + Math.floor(Math.random() * 3);
        const shape: number[] = [];
        for (let j = 0; j < sides; j++) shape.push(0.55 + Math.random() * 0.45);
        const goingUp = Math.random() < 0.5;
        s.obstacles.push({
          kind: 'comet',
          data: {
            x: spawnX,
            y,
            width: cometSize * 2,
            vx: -(s.speed * 1.6 + Math.random() * 2),
            vy: (goingUp ? -1 : 1) * (1.2 + Math.random() * 1.8),
            size: cometSize,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.08,
            shape,
          },
        });
      } else {
        // Asteroid field
        const gapH = currentGapH(playH) * 1.05; // slightly wider for fields
        const margin = playH * 0.15;
        const minGapY = ceilY + margin + gapH / 2;
        const maxGapY = floorY - margin - gapH / 2;
        const gapY = minGapY + Math.random() * Math.max(0, maxGapY - minGapY);
        const fieldW = 90 + Math.random() * 70;
        const rocks: AsteroidField['rocks'] = [];
        for (let i = 0; i < 12; i++) {
          let ry: number;
          if (Math.random() > 0.5) {
            ry = ceilY + Math.random() * Math.max(0, gapY - gapH / 2 - ceilY);
          } else {
            ry = gapY + gapH / 2 + Math.random() * Math.max(0, floorY - gapY - gapH / 2);
          }
          const shape: number[] = [];
          const sides = 5 + Math.floor(Math.random() * 4);
          for (let j = 0; j < sides; j++) shape.push(0.6 + Math.random() * 0.4);
          rocks.push({
            rx: Math.random() * fieldW,
            ry,
            size: 6 + Math.random() * 14,
            rot: Math.random() * Math.PI * 2,
            shape,
          });
        }
        s.obstacles.push({
          kind: 'field',
          data: { x: spawnX, rocks, width: fieldW, gapY, gapH },
        });
      }
    }

    // No pre-spawn — nextObstacle grace period handles the delay naturally

    // ── Collision helpers ──
    function shipHitbox() {
      return {
        x: s.playerX + 7,
        y: s.playerY + 7,
        w: SHIP_W - 14,
        h: SHIP_H - 14,
      };
    }

    function rectOverlap(
      ax: number,
      ay: number,
      aw: number,
      ah: number,
      bx: number,
      by: number,
      bw: number,
      bh: number,
    ) {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    function checkColumnCollision(col: AsteroidColumn): boolean {
      const { x, y, w, h } = shipHitbox();
      const H = cssH();
      const floorY = H - GROUND_H;
      const ceilY = GROUND_H;
      // Top pillar
      if (rectOverlap(x, y, w, h, col.x, ceilY, col.width, col.gapY - col.gapH / 2 - ceilY)) return true;
      // Bottom pillar
      const bottomTop = col.gapY + col.gapH / 2;
      if (rectOverlap(x, y, w, h, col.x, bottomTop, col.width, floorY - bottomTop)) return true;
      return false;
    }

    function checkCometCollision(comet: Comet): boolean {
      const sx = s.playerX + SHIP_W / 2;
      const sy = s.playerY + SHIP_H / 2;
      const dx = sx - comet.x;
      const dy = sy - comet.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist < comet.size + SHIP_W * 0.3;
    }

    function checkFieldCollision(field: AsteroidField): boolean {
      const { x, y, w, h } = shipHitbox();
      for (const rock of field.rocks) {
        const rx = field.x + rock.rx - rock.size;
        const ry = rock.ry - rock.size;
        if (rectOverlap(x, y, w, h, rx, ry, rock.size * 2, rock.size * 2)) return true;
      }
      return false;
    }

    function checkDynamicCollision(dc: DynamicColumn): boolean {
      if (dc.currentH <= 0) return false;
      const { x, y, w, h } = shipHitbox();
      const H = cssH();
      const floorY = H - GROUND_H;
      const ceilY = GROUND_H;
      // Pulsing adds slight wobble to height
      const pulseExtra = dc.pulsing ? Math.sin(s.frameCount * 0.06) * 4 : 0;
      const actualH = dc.currentH + pulseExtra;
      if (dc.fromTop) {
        // Block from ceiling downward
        return rectOverlap(x, y, w, h, dc.x, ceilY, dc.width, actualH);
      } else {
        // Block from floor upward
        return rectOverlap(x, y, w, h, dc.x, floorY - actualH, dc.width, actualH);
      }
    }

    function die() {
      s.alive = false;
      s._deathTime = performance.now();
      s.screenShake = 20;
      for (let i = 0; i < 28; i++) {
        const angle = (Math.PI * 2 * i) / 28;
        s.particles.push({
          x: s.playerX + SHIP_W / 2,
          y: s.playerY + SHIP_H / 2,
          vx: Math.cos(angle) * (3 + Math.random() * 6),
          vy: Math.sin(angle) * (3 + Math.random() * 6),
          life: 30 + Math.random() * 25,
          maxLife: 55,
          color: ['#ef4444', '#f97316', '#fbbf24', '#22d3ee'][Math.floor(Math.random() * 4)],
          size: 2 + Math.random() * 5,
        });
      }
      onGameOver(s.score, s.coins, { columns: s.columnsPassedForBonus, crystals: s.crystalsCollected });
    }

    const applyRevive = () => {
      if (!reviveRef.current) return false;
      reviveRef.current = false;
      s.alive = true;
      // Compensate startTime for death duration (prevent score jump)
      if (s._deathTime) {
        s.startTime += performance.now() - s._deathTime;
        s._deathTime = 0;
      }
      s.lastTickTime = performance.now();
      s.screenShake = 0;
      s._grazed = false; // reset graze immunity on revive
      // Resume from the same centered lane as a new run, never from the floor.
      s.playerY = cssH() / 2 - SHIP_H / 2;
      s.velY = 0;
      s.shipRotation = 0;
      (s as any)._prevFrame = s.lastTickTime;
      {
        let _wi = 0;
        for (let _i = 0; _i < s.obstacles.length; _i++) {
          if (s.obstacles[_i].data.x > s.playerX + 200) s.obstacles[_wi++] = s.obstacles[_i];
        }
        s.obstacles.length = _wi;
      }
      s.particles = [];
      return true;
    };

    // ── Tick ──
    function tick() {
      // Revive check BEFORE alive guard so it works when dead
      applyRevive();

      if (!s.alive) return;
      const W = cssW();
      const H = cssH();
      const floorY = H - GROUND_H;
      const ceilY = GROUND_H;

      // Delta-time normalization: all physics tuned for 60fps (16.67ms)
      const now60 = performance.now();
      const rawDt = now60 - (s as any)._prevFrame || 16.67;
      (s as any)._prevFrame = now60;
      const dtScale = Math.min(rawDt / 16.67, 2.5); // cap at 2.5× to prevent death spikes

      s.frameCount++;
      // Progressive speed: increases by SPEED_RAMP_AMOUNT every SPEED_RAMP_INTERVAL frames
      const spdBonus = 1 + (props.shipStats?.speed || 0) / 400; // slight initial speed boost x1.0-x1.25
      const rampSteps = Math.floor(s.frameCount / SPEED_RAMP_INTERVAL);
      s.speed = Math.min(MAX_SPEED, BASE_SPEED * spdBonus + rampSteps * SPEED_RAMP_AMOUNT);

      // Level theme changes
      const theme = getThemeForScore(s.score);
      if (theme.name !== s.levelName) {
        s.prevLevelName = s.levelName;
        s.levelName = theme.name;
        s.levelBanner = 120;
      }
      if (s.levelBanner > 0) s.levelBanner--;

      // Physics — gravity always pulls down (normalized to 60fps)
      s.velY += GRAVITY * dtScale;
      if (s.velY > MAX_FALL_VEL) s.velY = MAX_FALL_VEL;
      s.playerY += s.velY * dtScale;

      // Ship visual tilt based on velocity
      const targetRot = s.velY * 0.04; // tilt nose down when falling, up when rising
      s.shipRotation += (targetRot - s.shipRotation) * 0.15;
      // Clamp rotation
      s.shipRotation = Math.max(-0.5, Math.min(0.5, s.shipRotation));

      // Floor / Ceiling collision = death
      if (s.playerY + SHIP_H > floorY) {
        s.playerY = floorY - SHIP_H;
        die();
        return;
      }
      if (s.playerY < ceilY) {
        s.playerY = ceilY;
        s.velY = 1; // bounce off ceiling slightly
      }

      // Exhaust particles from engine nozzles
      const exhs = profileRef.current.exhausts;
      // Ship center in screen coords
      const shipCX = s.playerX + SHIP_W / 2;
      const shipCY = s.playerY + SHIP_H / 2;
      const cosR = Math.cos(s.shipRotation - Math.PI / 2);
      const sinR = Math.sin(s.shipRotation - Math.PI / 2);
      const exhScale = SHIP_W * 0.55; // map profile coords to pixel space
      const gravBio = profileRef.current.trailStyle === 'bio';
      // Spawn 1-2 particles per frame from random exhaust
      const spawnCount = gravBio ? 2 : 1;
      for (let si = 0; si < spawnCount; si++) {
        const exh = exhs[Math.floor(Math.random() * exhs.length)];
        const lx = exh.x * exhScale;
        const ly = exh.y * exhScale;
        const wx = shipCX + (lx * cosR - ly * sinR);
        const wy = shipCY + (lx * sinR + ly * cosR);
        const spread = gravBio ? 6 : 3;
        s.exhaustParticles.push({
          x: wx + (Math.random() - 0.5) * spread,
          y: wy + (Math.random() - 0.5) * spread,
          vx: -s.speed * (gravBio ? 0.2 : 0.4),
          vy: gravBio ? (Math.random() - 0.5) * 2 : (Math.random() - 0.5) * 0.8,
          life: gravBio ? 0.9 + Math.random() * 0.5 : 0.6 + Math.random() * 0.4,
          maxLife: gravBio ? 1.4 : 1.0,
          size: gravBio ? 3.5 + Math.random() * 3 : 2.5 + Math.random() * 2,
        });
      }
      // Update exhaust particles (fixed ~60fps delta)
      const exhDt = 0.016;
      for (let ei = s.exhaustParticles.length - 1; ei >= 0; ei--) {
        const ep = s.exhaustParticles[ei];
        ep.x += ep.vx;
        ep.y += ep.vy;
        // Bio: sinusoidal vertical wave
        if (gravBio) ep.y += Math.sin(ep.life * 10 + ei * 0.3) * 0.5;
        ep.life -= exhDt;
        if (ep.life <= 0) {
          s.exhaustParticles.splice(ei, 1);
        }
      }
      // Cap exhaust pool
      if (s.exhaustParticles.length > 80) s.exhaustParticles.splice(0, s.exhaustParticles.length - 80);

      // Move obstacles
      for (const o of s.obstacles) {
        if (o.kind === 'comet') {
          // Comets move independently
          o.data.x += o.data.vx;
          o.data.y += o.data.vy;
          o.data.rotation += o.data.rotSpeed;
          // Bounce off floor/ceiling
          if (o.data.y - o.data.size < ceilY) {
            o.data.vy = Math.abs(o.data.vy);
          }
          if (o.data.y + o.data.size > floorY) {
            o.data.vy = -Math.abs(o.data.vy);
          }
        } else {
          o.data.x -= s.speed * dtScale;
        }
        if (o.kind === 'dynamic') {
          // Grow dynamic column towards max height
          if (o.data.currentH < o.data.maxH) {
            o.data.currentH = Math.min(o.data.maxH, o.data.currentH + o.data.growSpeed);
          }
        }
      }
      // Comet-vs-column collision: comets shatter when hitting solid obstacles
      {
        const cometsToDestroy = new Set<number>();
        for (let ci = 0; ci < s.obstacles.length; ci++) {
          const co = s.obstacles[ci];
          if (co.kind !== 'comet') continue;
          const cx = co.data.x;
          const cy = co.data.y;
          const cr = (co.data as Comet).size;
          for (const so of s.obstacles) {
            if (so.kind === 'column') {
              const col = so.data as AsteroidColumn;
              // Top pillar
              const topBot = col.gapY - col.gapH / 2;
              if (cx > col.x && cx < col.x + col.width && cy - cr < topBot && cy + cr > ceilY) {
                cometsToDestroy.add(ci);
                break;
              }
              // Bottom pillar
              const botTop = col.gapY + col.gapH / 2;
              if (cx > col.x && cx < col.x + col.width && cy + cr > botTop && cy - cr < floorY) {
                cometsToDestroy.add(ci);
                break;
              }
            } else if (so.kind === 'dynamic') {
              const dc = so.data as DynamicColumn;
              if (dc.currentH <= 0) continue;
              if (cx > dc.x && cx < dc.x + dc.width) {
                if (dc.fromTop && cy - cr < ceilY + dc.currentH) {
                  cometsToDestroy.add(ci);
                  break;
                }
                if (!dc.fromTop && cy + cr > floorY - dc.currentH) {
                  cometsToDestroy.add(ci);
                  break;
                }
              }
            }
          }
        }
        // Spawn debris particles for destroyed comets
        for (const ci of cometsToDestroy) {
          const cd = s.obstacles[ci].data as Comet;
          for (let pi = 0; pi < 8; pi++) {
            const angle = (Math.PI * 2 * pi) / 8;
            s.particles.push({
              x: cd.x,
              y: cd.y,
              vx: Math.cos(angle) * (2 + Math.random() * 3),
              vy: Math.sin(angle) * (2 + Math.random() * 3),
              life: 18 + Math.random() * 12,
              maxLife: 30,
              color: ['#9ca3af', '#d1d5db', '#f59e0b'][Math.floor(Math.random() * 3)],
              size: 2 + Math.random() * 3,
            });
          }
        }
        // Remove destroyed comets + off-screen obstacles
        {
          let wi = 0;
          for (let i = 0; i < s.obstacles.length; i++) {
            if (cometsToDestroy.has(i)) continue;
            if (s.obstacles[i].data.x + (s.obstacles[i].data.width ?? 0) > -30) s.obstacles[wi++] = s.obstacles[i];
          }
          s.obstacles.length = wi;
        }
      }

      // Move crystals
      for (const c of s.crystals) {
        c.x -= s.speed * dtScale;
        c.pulse += 0.08 * dtScale;
      }
      {
        let ci = 0;
        for (let i = 0; i < s.crystals.length; i++) {
          if (s.crystals[i].x > -20) s.crystals[ci++] = s.crystals[i];
        }
        s.crystals.length = ci;
      }

      // Spawn obstacles — consistent intervals with minimum spacing enforced in spawnObstacle
      s.nextObstacle -= dtScale;
      if (s.nextObstacle <= 0) {
        spawnObstacle();
        // Steady interval — Flappy Bird pacing
        const baseInterval = 28;
        const minInterval = 18;
        const elapsedMin = (performance.now() - s.startTime) / 60000;
        s.nextObstacle = Math.max(minInterval, baseInterval - elapsedMin * 5);
      }

      // Collision checks (shield stat gives graze chance to survive)
      const grazeChance = Math.min(1, (props.shipStats?.shield || 0) / 100); // 0-100 → 0%-100% chance, *0.5 below
      for (const o of s.obstacles) {
        const hit =
          (o.kind === 'column' && checkColumnCollision(o.data)) ||
          (o.kind === 'comet' && checkCometCollision(o.data)) ||
          (o.kind === 'field' && checkFieldCollision(o.data)) ||
          (o.kind === 'dynamic' && checkDynamicCollision(o.data));
        if (hit) {
          if (grazeChance > 0 && Math.random() < grazeChance * 0.5 && !s._grazed) {
            // Graze — survive once, brief invuln
            s._grazed = true;
            s.screenShake = 3;
            s.particles.push({
              x: s.playerX + SHIP_W,
              y: s.playerY + SHIP_H / 2,
              vx: 0,
              vy: -2,
              life: 15,
              maxLife: 15,
              color: '#22d3ee',
              size: 8,
            });
          } else {
            die();
            return;
          }
        }
      }

      // Columns passed — bonus coins (columns + dynamics)
      for (const o of s.obstacles) {
        const passable = o.kind === 'column' || o.kind === 'dynamic';
        if (passable && !o.data.passed && o.data.x + o.data.width < s.playerX) {
          o.data.passed = true;
          s.columnsPassedForBonus++;
          // +2 coins per column passed
          s.coins += 2 * coinMult;
          onCoins(s.coins);
          // No celebratory particles — clean look
        }
      }

      // Crystal collection
      for (const c of s.crystals) {
        if (c.collected) continue;
        const dx = s.playerX + SHIP_W / 2 - c.x;
        const dy = s.playerY + SHIP_H / 2 - c.y;
        if (Math.sqrt(dx * dx + dy * dy) < CRYSTAL_SIZE + SHIP_W * 0.4) {
          c.collected = true;
          s.crystalsCollected++;
          s.coins += 2 * coinMult;
          onCoins(s.coins);
          sfxPickup();
          for (let i = 0; i < 10; i++) {
            s.particles.push({
              x: c.x,
              y: c.y,
              vx: (Math.random() - 0.5) * 6,
              vy: (Math.random() - 0.5) * 6,
              life: 18,
              maxLife: 18,
              color: theme.crystalColor,
              size: 2 + Math.random() * 3,
            });
          }
        }
      }

      // Passive coin earning per second (FPS-independent via actual delta time)
      const now = performance.now();
      const dt = Math.min((now - s.lastTickTime) / 1000, 0.1); // cap at 100ms to prevent burst on tab-switch
      s.lastTickTime = now;
      const elapsedSec = (now - s.startTime) / 1000;
      const coinsPerSec = Math.min(10, 1 + Math.floor(elapsedSec / 30)) * coinMult;
      s.coinAccum += coinsPerSec * dt;
      const wholeCoins = Math.floor(s.coinAccum);
      if (wholeCoins > 0) {
        s.coins += wholeCoins;
        s.coinAccum -= wholeCoins;
      }

      // Particles — in-place update & compact (no alloc)
      let pi = 0;
      for (let i = 0; i < s.particles.length; i++) {
        const p = s.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        p.vx *= 0.95;
        p.vy *= 0.95;
        if (p.life > 0) {
          s.particles[pi++] = p;
        }
      }
      s.particles.length = pi;

      // Engine trail disabled — clean background

      // Score = columns passed (Flappy Bird style)
      s.score = s.columnsPassedForBonus;
      // Batched React setState — flush every 100ms
      if (now - _lastFlush.current > 100) {
        _lastFlush.current = now;
        onScore(s.score);
        onCoins(s.coins);
      }

      // Screen shake decay
      if (s.screenShake > 0) s.screenShake *= 0.85;

      // Background stars handled by CosmicStarfield (reverseX while playing, paused on game over)

      // Background comets — spawn and fly across (like Defender)
      const comets = (s as any)._comets;
      (s as any)._cometTimer += 1;
      if ((s as any)._cometTimer > 400 + Math.random() * 300) {
        (s as any)._cometTimer = 0;
        for (const c of comets) {
          if (c.active) continue;
          // Spawn from random edge
          const edge = Math.floor(Math.random() * 4);
          const speed = 3 + Math.random() * 5;
          if (edge === 0) {
            c.x = Math.random() * W;
            c.y = -10;
          } // top
          else if (edge === 1) {
            c.x = W + 10;
            c.y = Math.random() * H;
          } // right
          else if (edge === 2) {
            c.x = Math.random() * W;
            c.y = H + 10;
          } // bottom
          else {
            c.x = -10;
            c.y = Math.random() * H;
          } // left
          // Aim toward center area
          const tx = W * (0.3 + Math.random() * 0.4);
          const ty = H * (0.3 + Math.random() * 0.4);
          const ang = Math.atan2(ty - c.y, tx - c.x);
          c.vx = Math.cos(ang) * speed;
          c.vy = Math.sin(ang) * speed;
          c.maxLife = 60 + Math.random() * 120;
          c.life = 0;
          c.active = true;
          break;
        }
      }
      for (const c of comets) {
        if (!c.active) continue;
        c.x += c.vx;
        c.y += c.vy;
        c.life++;
        if (c.life > c.maxLife) c.active = false;
      }
    }

    // ── Draw ──
    function draw() {
      const W = cssW();
      const H = cssH();
      const floorY = H - GROUND_H;
      const ceilY = GROUND_H;
      const theme = getThemeForScore(s.score);

      ctx.clearRect(0, 0, W, H);
      ctx.save();

      // Screen shake
      if (s.screenShake > 0.5) {
        ctx.translate((Math.random() - 0.5) * s.screenShake, (Math.random() - 0.5) * s.screenShake);
      }

      // Background is rendered by Three.js layer behind — canvas is transparent
      // No WebGL/Canvas2D background drawing needed

      // ── Background comets — bright streaks like Defender ──
      const comets = (s as any)._comets;
      if (comets) {
        for (const c of comets) {
          if (!c.active) continue;
          const fadeIn = Math.min(1, c.life / 8);
          const fadeOut = Math.min(1, (c.maxLife - c.life) / 12);
          const fade = fadeIn * fadeOut;
          if (fade < 0.01) continue;
          const ang = Math.atan2(c.vy, c.vx);
          const tailLen = 30 + Math.sqrt(c.vx * c.vx + c.vy * c.vy) * 8;
          const tx = c.x - Math.cos(ang) * tailLen;
          const ty = c.y - Math.sin(ang) * tailLen;
          const grad = ctx.createLinearGradient(c.x, c.y, tx, ty);
          grad.addColorStop(0, `rgba(170,204,255,${(fade * 0.35).toFixed(3)})`);
          grad.addColorStop(0.3, `rgba(150,180,255,${(fade * 0.15).toFixed(3)})`);
          grad.addColorStop(1, 'rgba(130,160,255,0)');
          ctx.save();
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.fillStyle = `rgba(200,220,255,${(fade * 0.5).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // ── Floor & Ceiling — gradient fade + glowing accent line ──
      // Floor
      const flGrad = ctx.createLinearGradient(0, floorY - 6, 0, H);
      flGrad.addColorStop(0, 'rgba(0,0,0,0)');
      flGrad.addColorStop(0.08, 'rgba(20,15,35,0.7)');
      flGrad.addColorStop(0.3, 'rgba(15,10,28,0.95)');
      flGrad.addColorStop(1, '#08060f');
      ctx.fillStyle = flGrad;
      ctx.fillRect(0, floorY - 6, W, GROUND_H + 6);
      // Accent glow line
      ctx.strokeStyle = theme.accentColor;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.shadowColor = theme.accentColor;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, floorY);
      ctx.lineTo(W, floorY);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // Ceiling
      const clGrad = ctx.createLinearGradient(0, 0, 0, ceilY + 6);
      clGrad.addColorStop(0, '#08060f');
      clGrad.addColorStop(0.7, 'rgba(15,10,28,0.95)');
      clGrad.addColorStop(0.92, 'rgba(20,15,35,0.7)');
      clGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = clGrad;
      ctx.fillRect(0, 0, W, ceilY + 6);
      ctx.strokeStyle = theme.accentColor;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 2;
      ctx.shadowColor = theme.accentColor;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, ceilY);
      ctx.lineTo(W, ceilY);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.globalAlpha = 1;

      // Engine trail disabled
      ctx.globalAlpha = 1;

      // ── Obstacles ──
      for (const o of s.obstacles) {
        if (o.kind === 'column') {
          const col = o.data;
          const topH = col.gapY - col.gapH / 2 - ceilY;
          const bottomTop = col.gapY + col.gapH / 2;
          const bottomH = floorY - bottomTop;

          // Draw crystal prism pillars — cap/teeth face the GAP (top pillar's
          // gap edge is at its bottom, bottom pillar's gap edge is at its top)
          drawAsteroidPillar(
            ctx,
            col.x,
            ceilY,
            col.width,
            topH,
            col.jagged,
            col.crackSeeds,
            theme,
            true,
            s.frameCount,
          );
          drawAsteroidPillar(
            ctx,
            col.x,
            bottomTop,
            col.width,
            bottomH,
            col.jagged,
            col.crackSeeds,
            theme,
            false,
            s.frameCount,
          );

          // Column debris disabled — clean background
        }

        if (o.kind === 'comet') {
          const comet = o.data;
          ctx.save();
          ctx.translate(comet.x, comet.y);

          // Comet trail — simple fading dots (no gradients)
          const trailLen = 6;
          for (let ti = 1; ti <= trailLen; ti++) {
            const tx = -comet.vx * ti * 0.6;
            const ty = -comet.vy * ti * 0.6;
            const ta = 0.3 * (1 - ti / trailLen);
            ctx.globalAlpha = ta;
            ctx.fillStyle = theme.accentColor;
            ctx.beginPath();
            ctx.arc(tx, ty, comet.size * (0.5 - ti * 0.06), 0, Math.PI * 2);
            ctx.fill();
          }

          // Comet body — irregular rock shape
          ctx.globalAlpha = 1;
          ctx.rotate(comet.rotation);
          ctx.fillStyle = theme.obstacleColor;
          ctx.beginPath();
          const sides = comet.shape.length;
          for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2;
            const r = comet.size * comet.shape[i];
            const px = Math.cos(angle) * r;
            const py = Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          // Highlight edge
          ctx.strokeStyle = theme.accentColor;
          ctx.globalAlpha = 0.4;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.restore();
        }

        if (o.kind === 'field') {
          const field = o.data;
          for (const rock of field.rocks) {
            const rx = field.x + rock.rx;
            const ry = rock.ry;
            ctx.save();
            ctx.translate(rx, ry);
            ctx.rotate(rock.rot + s.frameCount * 0.003);
            const sides = rock.shape.length;
            ctx.fillStyle = theme.obstacleColor;
            ctx.beginPath();
            for (let i = 0; i < sides; i++) {
              const angle = (i / sides) * Math.PI * 2;
              const r = rock.size * rock.shape[i];
              const px = Math.cos(angle) * r;
              const py = Math.sin(angle) * r;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = theme.obstacleHighlight;
            ctx.globalAlpha = 0.25;
            ctx.lineWidth = 0.8;
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.beginPath();
            ctx.arc(rock.size * 0.15, -rock.size * 0.1, rock.size * 0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        if (o.kind === 'dynamic') {
          const dc = o.data;
          if (dc.currentH <= 0) continue;
          const pulseExtra = dc.pulsing ? Math.sin(s.frameCount * 0.06) * 4 : 0;
          const drawH = dc.currentH + pulseExtra;
          const drawY = dc.fromTop ? ceilY : floorY - drawH;

          // Warning glow while growing (simple overlay)
          if (dc.currentH < dc.maxH) {
            ctx.save();
            ctx.globalAlpha = 0.15 + Math.sin(s.frameCount * 0.12) * 0.1;
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(dc.x - 2, drawY, dc.width + 4, drawH);
            ctx.restore();
          }

          drawAsteroidPillar(
            ctx,
            dc.x,
            drawY,
            dc.width,
            drawH,
            dc.jagged,
            dc.crackSeeds,
            theme,
            dc.fromTop,
            s.frameCount,
          );

          // Glowing tip for dynamic columns (simple rect)
          const tipY = dc.fromTop ? drawY + drawH : drawY;
          ctx.save();
          ctx.fillStyle = theme.accentColor;
          ctx.globalAlpha = 0.5 + Math.sin(s.frameCount * 0.08) * 0.2;
          ctx.fillRect(dc.x - 1, tipY - 2, dc.width + 2, 4);
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }

      // ── Crystals ──
      for (const c of s.crystals) {
        if (c.collected) continue;
        const scale = 1 + Math.sin(c.pulse) * 0.1;
        const sz = CRYSTAL_SIZE * 1.4; // slightly larger than old crystal
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(scale, scale);
        // Soft golden halo behind the coin — pickup readability + premium glow
        const haloR = sz * 1.05;
        const halo = ctx.createRadialGradient(0, 0, sz * 0.25, 0, 0, haloR);
        halo.addColorStop(0, 'rgba(251,191,36,0.30)');
        halo.addColorStop(1, 'rgba(251,191,36,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, haloR, 0, Math.PI * 2);
        ctx.fill();
        if (coinImgRef.current) {
          // Draw powerup_coin.png texture — same as Orbit/Defender coin powerup
          ctx.drawImage(coinImgRef.current, -sz / 2, -sz / 2, sz, sz);
        } else {
          // Fallback circle
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(0, 0, sz / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // ── Exhaust trail (ship-specific color) ──
      const [tcR, tcG, tcB] = profileRef.current.trailColor;
      const isBio = profileRef.current.trailStyle === 'bio';
      for (const ep of s.exhaustParticles) {
        const t = ep.life / ep.maxLife;
        if (t < 0.05) continue;
        const fade = t * t;
        const pulse = isBio ? 0.7 + 0.3 * Math.sin(ep.life * 12) : 1;
        const r = Math.round(tcR * 255 * fade * pulse);
        const g = Math.round(tcG * 255 * fade * pulse);
        const b = Math.round(tcB * 255 * fade * pulse);
        ctx.globalAlpha = fade * (isBio ? 0.7 : 0.8);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, ep.size * t * (isBio ? 1.3 : 1), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── Ship ──
      ctx.save();
      ctx.translate(s.playerX + SHIP_W / 2, s.playerY + SHIP_H / 2);
      ctx.rotate(s.shipRotation);

      if (shipLoadedRef.current && shipImgRef.current) {
        ctx.rotate(Math.PI / 2);
        // Aura glow — pulsing shadowBlur around ship silhouette
        if (auraColorRef.current) {
          const [ar, ag, ab] = auraColorRef.current;
          const pulse = 0.7 + 0.3 * Math.sin(s.frameCount * 0.04);
          ctx.shadowColor = `rgba(${ar},${ag},${ab},${pulse})`;
          ctx.shadowBlur = 20 + 10 * Math.sin(s.frameCount * 0.04);
        }
        ctx.drawImage(shipImgRef.current, -SHIP_W / 2, -SHIP_H / 2, SHIP_W, SHIP_H);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      } else {
        // Fallback: draw a triangle ship
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.moveTo(SHIP_W / 2, 0);
        ctx.lineTo(-SHIP_W / 2, -SHIP_H / 2);
        ctx.lineTo(-SHIP_W / 3, 0);
        ctx.lineTo(-SHIP_W / 2, SHIP_H / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // ── Particles ──
      for (const p of s.particles) {
        const t = p.life / p.maxLife;
        const alpha = t * t; // quadratic fade — soft start, quick disappear
        if (alpha < 0.02) continue;
        ctx.globalAlpha = alpha * 0.6; // max 60% opacity — no harsh flashes
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── Level banner ──
      if (s.levelBanner > 0) {
        const bannerAlpha = Math.min(1, s.levelBanner / 40);
        ctx.globalAlpha = bannerAlpha * 0.85;
        ctx.fillStyle = theme.accentColor;
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`⟐ ${theme.name} ⟐`, W / 2, 75);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'start';
      }

      ctx.restore();
    }

    // ── Draw crystal prism pillar — neon-prism aesthetic ──
    // Collision geometry is exactly the rect (x, y, w, h): the solid body always
    // fills that rect; teeth/glow are flourish at the gap-facing cap (≤ ~6px).
    function drawAsteroidPillar(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      jagged: number[],
      crackSeeds: number[],
      theme: LevelTheme,
      gapAtBottom: boolean, // true → the gap-facing edge is at y+h
      frame: number,
    ) {
      if (h <= 0) return;
      const pal = getPillarPalette(theme);
      const capY = gapAtBottom ? y + h : y;
      const dir = gapAtBottom ? 1 : -1; // teeth extend toward the gap

      // 1) Prism body — horizontal gradient: dark edges + off-center specular band
      const bodyGrad = ctx.createLinearGradient(x, 0, x + w, 0);
      bodyGrad.addColorStop(0, pal.edgeDark);
      bodyGrad.addColorStop(0.24, pal.mid);
      bodyGrad.addColorStop(0.38, pal.light);
      bodyGrad.addColorStop(0.62, pal.mid);
      bodyGrad.addColorStop(1, pal.edgeDark);
      ctx.fillStyle = bodyGrad;
      ctx.fillRect(x, y, w, h);

      // 2) Accent tint intensifying toward the gap edge (reads as inner energy)
      const bandH = Math.min(h, 64);
      const bandTop = gapAtBottom ? capY - bandH : capY;
      const capGrad = gapAtBottom
        ? ctx.createLinearGradient(0, bandTop, 0, capY)
        : ctx.createLinearGradient(0, capY + bandH, 0, capY);
      capGrad.addColorStop(0, pal.capTint0);
      capGrad.addColorStop(1, pal.capTint1);
      ctx.fillStyle = capGrad;
      ctx.fillRect(x, bandTop, w, bandH);

      // 3) Crystal teeth on the gap-facing cap (deterministic from jagged seeds)
      const steps = Math.min(jagged.length, 8);
      for (let i = 0; i <= steps; i++) {
        const j = Math.max(-6, Math.min(6, jagged[i % jagged.length]));
        _toothY[i] = capY + dir * (2 + j * 0.7); // −2.2px recess … +6.2px into gap
      }
      ctx.beginPath();
      ctx.moveTo(x, capY - dir * 3);
      for (let i = 0; i <= steps; i++) {
        ctx.lineTo(x + (w / steps) * i, _toothY[i]);
      }
      ctx.lineTo(x + w, capY - dir * 3);
      ctx.closePath();
      ctx.fillStyle = pal.mid;
      ctx.fill();

      // 4) Neon rim tracing the teeth — pulsing glow marks the danger edge
      //    (uses frame counter, which freezes during pause → no animation while paused)
      const pulse = 0.55 + 0.18 * Math.sin(frame * 0.05 + x * 0.012);
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const px = x + (w / steps) * i;
        if (i === 0) ctx.moveTo(px, _toothY[i]);
        else ctx.lineTo(px, _toothY[i]);
      }
      ctx.strokeStyle = theme.accentColor;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.globalAlpha = pulse;
      ctx.shadowColor = theme.accentColor;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();

      // 5) Facet lines — slanted translucent crystal facets (from crackSeeds)
      ctx.strokeStyle = pal.facet;
      ctx.lineWidth = 1;
      const facets = Math.min(crackSeeds.length, 3);
      for (let i = 0; i < facets; i++) {
        const cs = crackSeeds[i];
        const fx = x + 4 + cs * (w - 8);
        ctx.beginPath();
        ctx.moveTo(fx, y + 2);
        ctx.lineTo(fx + (cs - 0.5) * 8, y + h - 2);
        ctx.stroke();
      }

      // 6) Side edge rims — thin accent lines for a glassy silhouette
      ctx.strokeStyle = pal.rim;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, y + h);
      ctx.moveTo(x + w - 0.5, y);
      ctx.lineTo(x + w - 0.5, y + h);
      ctx.stroke();
    }

    function loop() {
      if (paused) applyRevive();
      if (!isCountdown && !paused) tick();
      draw();
      if (s.alive) {
        animRef.current = requestAnimationFrame(loop);
      } else {
        let deathFrames = 0;
        const deathLoop = () => {
          // Check for revive during death animation
          if (applyRevive()) {
            animRef.current = requestAnimationFrame(loop);
            return;
          }
          deathFrames++;
          for (const p of s.particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            p.vx *= 0.95;
            p.vy *= 0.95;
          }
          {
            let _pi = 0;
            for (let _i = 0; _i < s.particles.length; _i++) {
              if (s.particles[_i].life > 0) s.particles[_pi++] = s.particles[_i];
            }
            s.particles.length = _pi;
          }
          if (s.screenShake > 0) s.screenShake *= 0.85;
          draw();
          if (deathFrames < 45 && s.particles.length > 0) {
            animRef.current = requestAnimationFrame(deathLoop);
          } else {
            // Keep checking for late revive after death animation ends
            const waitForRevive = () => {
              if (unmounted) return;
              if (!animRef.current && animRef.current !== 0) return;
              if (applyRevive()) {
                animRef.current = requestAnimationFrame(loop);
              } else {
                animRef.current = setTimeout(waitForRevive, 100) as unknown as number;
              }
            };
            animRef.current = setTimeout(waitForRevive, 100) as unknown as number;
          }
        };
        animRef.current = requestAnimationFrame(deathLoop);
      }
    }

    // Reset timing and start immediately — ship draws placeholder if sprite not loaded yet
    const now = performance.now();
    s.startTime = now;
    s.lastTickTime = now;
    (s as any)._prevFrame = now;
    loop();

    return () => {
      unmounted = true;
      cancelAnimationFrame(animRef.current);
      clearTimeout(animRef.current);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, paused, onScore, onCoins, onGameOver, reviveRef, hasMintedId]);

  return (
    <canvas ref={canvasRef} className="w-full h-full" style={{ touchAction: 'none', background: 'transparent' }} />
  );
}
