/**
 * Gravity Runner v5 — Cosmic Flappy Runner.
 *
 * Ship sprite (ship.png) flies horizontally. Tap/Space = upward thrust (Flappy Bird).
 * Gravity always pulls down. Constant tapping to stay airborne.
 * Obstacles: asteroid columns, laser beams, asteroid fields.
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

interface GravityRunnerProps {
  gameState: 'start' | 'playing' | 'gameover';
  onScore: (score: number) => void;
  onCoins: (coins: number) => void;
  onGameOver: (score: number, coins: number) => void;
  reviveRef: React.MutableRefObject<boolean>;
  traits: any;
  walletScore: number;
  hasMintedId: boolean;
}

// ── Game constants ──
const GROUND_H = 40;
const SHIP_W = 36;
const SHIP_H = 36;
const GRAVITY = 0.48;              // stronger gravity, snappier feel
const FLAP_VEL = -7.8;            // sharper jumps
const MAX_FALL_VEL = 8;           // terminal velocity
const BASE_SPEED = 4.0;           // fast start
const MAX_SPEED = 7.5;            // high ceiling
const SPEED_RAMP_INTERVAL = 250;  // fast ramp-up (~4 sec at 60fps)
const SPEED_RAMP_AMOUNT = 0.08;   // aggressive ramp
const CRYSTAL_SIZE = 14;
const CRYSTAL_INTERVAL = 45;
const MIN_COL_GAP_PX = 115;       // minimum vertical gap between columns (px)
const MIN_COL_SPACING_PX = 160;   // tighter horizontal distance between columns (px)
const GAP_SHRINK_PER_MIN = 12;    // gap shrinks faster
const DYNAMIC_COL_SCORE = 15;     // score threshold when dynamic columns start appearing

// ── Level themes ──
interface LevelTheme {
  name: string;
  bg1: string; bg2: string;
  floorColor: string; ceilColor: string;
  accentColor: string; crystalColor: string;
  obstacleColor: string; obstacleHighlight: string;
  laserColor: string;
  scoreThreshold: number;
}

const LEVEL_THEMES: LevelTheme[] = [
  { name: 'Nebula', bg1: '#06081a', bg2: '#0d1428', floorColor: 'rgba(34,211,238,0.06)', ceilColor: 'rgba(168,85,247,0.04)', accentColor: '#22d3ee', crystalColor: '#a855f7', obstacleColor: '#374151', obstacleHighlight: '#6b7280', laserColor: '#ef4444', scoreThreshold: 0 },
  { name: 'Asteroid Belt', bg1: '#0f0a05', bg2: '#1a1008', floorColor: 'rgba(245,158,11,0.06)', ceilColor: 'rgba(239,68,68,0.04)', accentColor: '#f59e0b', crystalColor: '#fbbf24', obstacleColor: '#57534e', obstacleHighlight: '#a8a29e', laserColor: '#f97316', scoreThreshold: 500 },
  { name: 'Black Hole', bg1: '#050008', bg2: '#0a0014', floorColor: 'rgba(139,92,246,0.08)', ceilColor: 'rgba(236,72,153,0.04)', accentColor: '#8b5cf6', crystalColor: '#ec4899', obstacleColor: '#4c1d95', obstacleHighlight: '#7c3aed', laserColor: '#d946ef', scoreThreshold: 1200 },
  { name: 'Warp Zone', bg1: '#000a0f', bg2: '#001420', floorColor: 'rgba(6,182,212,0.08)', ceilColor: 'rgba(16,185,129,0.06)', accentColor: '#06b6d4', crystalColor: '#10b981', obstacleColor: '#134e4a', obstacleHighlight: '#2dd4bf', laserColor: '#14b8a6', scoreThreshold: 2000 },
  { name: 'Prism Realm', bg1: '#0f0510', bg2: '#1a0820', floorColor: 'rgba(251,191,36,0.08)', ceilColor: 'rgba(34,211,238,0.06)', accentColor: '#fbbf24', crystalColor: '#22d3ee', obstacleColor: '#713f12', obstacleHighlight: '#fbbf24', laserColor: '#fbbf24', scoreThreshold: 3000 },
];

function getThemeForScore(score: number): LevelTheme {
  let theme = LEVEL_THEMES[0];
  for (const t of LEVEL_THEMES) {
    if (score >= t.scoreThreshold) theme = t;
  }
  return theme;
}

// ── Types ──
interface AsteroidColumn {
  x: number;
  gapY: number;
  gapH: number;
  width: number;
  passed: boolean;
  jagged: number[];
  crackSeeds: number[];  // seeds for crack pattern rendering
}

interface LaserBeam {
  x: number;
  y: number;
  width: number;
  warning: number;
  active: boolean;
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
  fromTop: boolean;       // true = descends from ceiling, false = rises from floor
  maxH: number;           // final height
  currentH: number;       // current animated height
  growSpeed: number;       // px per frame growth
  passed: boolean;
  jagged: number[];
  crackSeeds: number[];
  pulsing: boolean;       // wobbles at full extension
}

type ObstacleUnion =
  | { kind: 'column'; data: AsteroidColumn }
  | { kind: 'laser'; data: LaserBeam }
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
  x: number; y: number; size: number; brightness: number;
  color: string; twinkleSpeed: number; twinklePhase: number;
}

interface StarLayer {
  stars: StarDot[];
  speed: number;
}

export default function GravityRunnerScene({
  gameState,
  onScore,
  onCoins,
  onGameOver,
  reviveRef,
  hasMintedId,
}: GravityRunnerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const shipImgRef = useRef<HTMLImageElement | null>(null);
  const shipLoadedRef = useRef(false);

  const stateRef = useRef({
    playerX: 70,
    playerY: 0,
    velY: 0,
    shipRotation: 0,
    score: 0,
    coins: 0,
    coinAccum: 0,          // fractional coin accumulator
    speed: BASE_SPEED,
    obstacles: [] as ObstacleUnion[],
    crystals: [] as Crystal[],
    particles: [] as Particle[],
    trail: [] as { x: number; y: number; alpha: number; size: number }[],
    nextObstacle: 100,
    nextCrystal: 70,
    frameCount: 0,
    alive: true,
    screenShake: 0,
    starLayers: [] as StarLayer[],
    levelName: 'Nebula',
    levelBanner: 0,
    prevLevelName: '',
    columnsPassedForBonus: 0,
    startTime: 0,
    lastTickTime: 0,
  });

  // Load ship texture
  useEffect(() => {
    const img = new Image();
    img.src = '/textures/ship.png';
    img.onload = () => {
      shipImgRef.current = img;
      shipLoadedRef.current = true;
    };
  }, []);

  // Flap (Flappy Bird tap) — gives upward impulse
  const flap = useCallback(() => {
    const s = stateRef.current;
    if (!s.alive) return;
    s.velY = FLAP_VEL;
    // Thrust particles
    for (let i = 0; i < 5; i++) {
      s.particles.push({
        x: s.playerX + 4,
        y: s.playerY + SHIP_H / 2 + (Math.random() - 0.5) * 8,
        vx: -1.5 - Math.random() * 2.5,
        vy: 1 + Math.random() * 2,
        life: 14, maxLife: 14,
        color: Math.random() > 0.5 ? '#22d3ee' : '#60a5fa',
        size: 2 + Math.random() * 3,
      });
    }
  }, []);

  // Input handlers
  useEffect(() => {
    if (gameState !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleInput = (e: Event) => { e.preventDefault(); flap(); };
    canvas.addEventListener('touchstart', handleInput, { passive: false });
    canvas.addEventListener('mousedown', handleInput);
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      canvas.removeEventListener('touchstart', handleInput);
      canvas.removeEventListener('mousedown', handleInput);
      window.removeEventListener('keydown', handleKey);
    };
  }, [gameState, flap]);

  // ── Main game loop ──
  useEffect(() => {
    if (gameState !== 'playing') {
      cancelAnimationFrame(animRef.current);
      clearTimeout(animRef.current);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    // Reset state
    const s = stateRef.current;
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
    s.nextObstacle = 100;   // grace period at start before first obstacle
    s.nextCrystal = 80;
    s.frameCount = 0;
    s.alive = true;
    s.screenShake = 0;
    s.levelName = 'Nebula';
    s.levelBanner = 0;
    s.prevLevelName = '';
    s.columnsPassedForBonus = 0;
    s.startTime = performance.now();
    s.lastTickTime = s.startTime;

    const coinMult = hasMintedId ? 2 : 1;

    // Generate dense cinematic star layers (matching OrbitSurvival style)
    const STAR_COLORS = [
      'rgba(180,200,255,A)',   // blue-white
      'rgba(240,240,255,A)',   // pure white
      'rgba(255,240,220,A)',   // warm white
      'rgba(255,210,170,A)',   // orange-warm
      'rgba(200,220,255,A)',   // cool blue
    ];
    s.starLayers = [];
    for (let layer = 0; layer < 4; layer++) {
      const count = layer === 0 ? 120 : layer === 1 ? 80 : layer === 2 ? 50 : 30;
      const stars: StarDot[] = [];
      for (let i = 0; i < count; i++) {
        const colorTemplate = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          size: layer === 0 ? 0.3 + Math.random() * 0.4
              : layer === 1 ? 0.5 + Math.random() * 0.6
              : layer === 2 ? 0.8 + Math.random() * 0.8
              : 1.2 + Math.random() * 1.0,
          brightness: layer === 0 ? 0.08 + Math.random() * 0.12
                    : layer === 1 ? 0.15 + Math.random() * 0.2
                    : layer === 2 ? 0.3 + Math.random() * 0.25
                    : 0.5 + Math.random() * 0.4,
          color: colorTemplate,
          twinkleSpeed: 0.5 + Math.random() * 3.0,
          twinklePhase: Math.random() * Math.PI * 2,
        });
      }
      s.starLayers.push({ stars, speed: 0.1 + layer * 0.35 });
    }

    // Pre-render static nebula canvas (drawn once, scrolls slowly)
    const nebulaCanvas = document.createElement('canvas');
    nebulaCanvas.width = Math.ceil(W * 1.5);
    nebulaCanvas.height = Math.ceil(H);
    const nCtx = nebulaCanvas.getContext('2d')!;
    // Dark base
    nCtx.fillStyle = '#06081a';
    nCtx.fillRect(0, 0, nebulaCanvas.width, nebulaCanvas.height);
    // Paint 3-4 nebula blobs with radial gradients
    const nebulaBlobs = [
      { x: W * 0.3, y: H * 0.35, r: W * 0.28, color: 'rgba(100,40,160,' },
      { x: W * 0.9, y: H * 0.6, r: W * 0.22, color: 'rgba(30,60,140,' },
      { x: W * 1.2, y: H * 0.25, r: W * 0.2, color: 'rgba(40,80,120,' },
      { x: W * 0.6, y: H * 0.75, r: W * 0.18, color: 'rgba(80,30,100,' },
    ];
    for (const blob of nebulaBlobs) {
      const grad = nCtx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
      grad.addColorStop(0, blob.color + '0.07)');
      grad.addColorStop(0.5, blob.color + '0.03)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      nCtx.fillStyle = grad;
      nCtx.fillRect(0, 0, nebulaCanvas.width, nebulaCanvas.height);
    }
    // Store reference for draw loop
    (s as any)._nebulaCanvas = nebulaCanvas;
    (s as any)._nebulaScrollX = 0;

    // ── Spawn helpers ──

    /** Compute current gap height based on elapsed time (progressive difficulty). */
    function currentGapH(playH: number): number {
      const elapsedMin = (performance.now() - s.startTime) / 60000;
      const startGap = Math.max(playH * 0.38, SHIP_H * 4);       // generous initial gap
      const shrunk = startGap - elapsedMin * GAP_SHRINK_PER_MIN;
      return Math.max(MIN_COL_GAP_PX, shrunk);                     // never below minimum
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

      // Enforce minimum horizontal spacing from the rightmost existing obstacle
      const rightEdge = rightmostObstacleX();
      const spawnX = Math.max(W + 30, rightEdge + MIN_COL_SPACING_PX);

      // Dynamic columns appear after DYNAMIC_COL_SCORE
      const canDynamic = s.score >= DYNAMIC_COL_SCORE;
      const roll = Math.random();
      // At high scores, existing column types also become dynamic occasionally
      const dynamicize = canDynamic && s.score >= 30 && Math.random() < 0.3;

      if (canDynamic && roll < 0.22) {
        // Dynamic column — emerges from top or bottom
        const fromTop = Math.random() < 0.5;
        const colW = 38 + Math.random() * 16;
        const maxH = playH * (0.30 + Math.random() * 0.25); // covers 30-55% of play area
        const jagged: number[] = [];
        const crackSeeds: number[] = [];
        for (let j = 0; j < 14; j++) jagged.push((Math.random() - 0.5) * 14);
        for (let j = 0; j < 6; j++) crackSeeds.push(Math.random());
        s.obstacles.push({
          kind: 'dynamic',
          data: {
            x: spawnX, width: colW, fromTop, maxH, currentH: 0,
            growSpeed: 1.8 + Math.random() * 1.5, passed: false,
            jagged, crackSeeds, pulsing: Math.random() < 0.4,
          },
        });
      } else if (roll < (canDynamic ? 0.65 : 0.55)) {
        // Asteroid column pair (Flappy Bird style)
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
      } else if (roll < (canDynamic ? 0.82 : 0.78)) {
        // Laser beam — clamp to middle 70%
        const margin = playH * 0.15;
        const y = ceilY + margin + Math.random() * (playH - margin * 2);
        s.obstacles.push({
          kind: 'laser',
          data: { x: spawnX, y, width: W * 0.45, warning: 45, active: false },
        });
      } else {
        // Asteroid field
        const gapH = currentGapH(playH) * 1.05;  // slightly wider for fields
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

    /** Spawn crystal — prefer placing inside the gap of the nearest upcoming column. */
    function spawnCrystal() {
      const W = cssW();
      const H = cssH();
      const floorY = H - GROUND_H;
      const ceilY = GROUND_H;

      // Try to place inside the gap of the next upcoming column
      const nextCol = s.obstacles.find(
        o => o.kind === 'column' && o.data.x > s.playerX + SHIP_W,
      );
      let y: number;
      if (nextCol && nextCol.kind === 'column') {
        const col = nextCol.data;
        // Random Y within the gap (with small margin from edges)
        const gapTop = col.gapY - col.gapH / 2 + CRYSTAL_SIZE;
        const gapBot = col.gapY + col.gapH / 2 - CRYSTAL_SIZE;
        y = gapTop + Math.random() * Math.max(0, gapBot - gapTop);
      } else {
        // Fallback: middle 70% of playable area
        const margin = (floorY - ceilY) * 0.15;
        y = ceilY + margin + Math.random() * (floorY - ceilY - margin * 2);
      }
      s.crystals.push({ x: W + 20, y, collected: false, pulse: Math.random() * Math.PI * 2 });
    }

    // ── Collision helpers ──
    function shipHitbox() {
      return {
        x: s.playerX + 7,
        y: s.playerY + 7,
        w: SHIP_W - 14,
        h: SHIP_H - 14,
      };
    }

    function rectOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
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

    function checkLaserCollision(laser: LaserBeam): boolean {
      if (!laser.active) return false;
      const { x, y, w, h } = shipHitbox();
      return rectOverlap(x, y, w, h, laser.x, laser.y - 4, laser.width, 8);
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
      s.screenShake = 20;
      for (let i = 0; i < 28; i++) {
        const angle = (Math.PI * 2 * i) / 28;
        s.particles.push({
          x: s.playerX + SHIP_W / 2,
          y: s.playerY + SHIP_H / 2,
          vx: Math.cos(angle) * (3 + Math.random() * 6),
          vy: Math.sin(angle) * (3 + Math.random() * 6),
          life: 30 + Math.random() * 25, maxLife: 55,
          color: ['#ef4444', '#f97316', '#fbbf24', '#22d3ee'][Math.floor(Math.random() * 4)],
          size: 2 + Math.random() * 5,
        });
      }
      onGameOver(s.score, s.coins);
    }

    // ── Tick ──
    function tick() {
      // Revive check BEFORE alive guard so it works when dead
      if (reviveRef.current) {
        reviveRef.current = false;
        s.alive = true;
        s.screenShake = 0;
        s.velY = FLAP_VEL * 0.5; // gentle upward push on revive
        s.obstacles = s.obstacles.filter(o => {
          if (o.kind === 'column') return o.data.x > s.playerX + 200;
          if (o.kind === 'laser') return o.data.x > s.playerX + 200;
          return o.data.x > s.playerX + 200;
        });
      }

      if (!s.alive) return;
      const W = cssW();
      const H = cssH();
      const floorY = H - GROUND_H;
      const ceilY = GROUND_H;

      s.frameCount++;
      // Progressive speed: increases by SPEED_RAMP_AMOUNT every SPEED_RAMP_INTERVAL frames
      const rampSteps = Math.floor(s.frameCount / SPEED_RAMP_INTERVAL);
      s.speed = Math.min(MAX_SPEED, BASE_SPEED + rampSteps * SPEED_RAMP_AMOUNT);

      // Level theme changes
      const theme = getThemeForScore(s.score);
      if (theme.name !== s.levelName) {
        s.prevLevelName = s.levelName;
        s.levelName = theme.name;
        s.levelBanner = 120;
      }
      if (s.levelBanner > 0) s.levelBanner--;

      // Physics — gravity always pulls down
      s.velY += GRAVITY;
      if (s.velY > MAX_FALL_VEL) s.velY = MAX_FALL_VEL;
      s.playerY += s.velY;

      // Ship visual tilt based on velocity
      const targetRot = s.velY * 0.04;  // tilt nose down when falling, up when rising
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

      // Move obstacles
      for (const o of s.obstacles) {
        o.data.x -= s.speed;
        if (o.kind === 'laser') {
          if (o.data.warning > 0) {
            o.data.warning--;
            if (o.data.warning <= 0) o.data.active = true;
          }
        }
        if (o.kind === 'dynamic') {
          // Grow dynamic column towards max height
          if (o.data.currentH < o.data.maxH) {
            o.data.currentH = Math.min(o.data.maxH, o.data.currentH + o.data.growSpeed);
          }
        }
      }
      // Remove off-screen
      s.obstacles = s.obstacles.filter(o => o.data.x + (o.data.width ?? 0) > -30);

      // Move crystals
      for (const c of s.crystals) {
        c.x -= s.speed;
        c.pulse += 0.08;
      }
      s.crystals = s.crystals.filter(c => c.x > -20);

      // Spawn obstacles — consistent intervals with minimum spacing enforced in spawnObstacle
      s.nextObstacle--;
      if (s.nextObstacle <= 0) {
        spawnObstacle();
        // Interval shortens slightly over time, but never too fast
        const elapsedMin = (performance.now() - s.startTime) / 60000;
        const baseInterval = 100;     // tighter base interval (frames)
        const minInterval = 50;       // never spawn faster than this
        s.nextObstacle = Math.max(minInterval, baseInterval - elapsedMin * 10);
      }

      // Spawn crystals
      s.nextCrystal--;
      if (s.nextCrystal <= 0) {
        spawnCrystal();
        s.nextCrystal = CRYSTAL_INTERVAL;
      }

      // Collision checks
      for (const o of s.obstacles) {
        if (o.kind === 'column' && checkColumnCollision(o.data)) { die(); return; }
        if (o.kind === 'laser' && checkLaserCollision(o.data)) { die(); return; }
        if (o.kind === 'field' && checkFieldCollision(o.data)) { die(); return; }
        if (o.kind === 'dynamic' && checkDynamicCollision(o.data)) { die(); return; }
      }

      // Columns passed — bonus coins (columns + dynamics)
      for (const o of s.obstacles) {
        const passable = o.kind === 'column' || o.kind === 'dynamic';
        if (passable && !o.data.passed && o.data.x + o.data.width < s.playerX) {
          o.data.passed = true;
          s.columnsPassedForBonus++;
          // +3 coins per column passed
          s.coins += 3 * coinMult;
          onCoins(s.coins);
          // Celebratory particles
          s.particles.push({
            x: s.playerX + SHIP_W, y: s.playerY + SHIP_H / 2,
            vx: 2, vy: -1, life: 20, maxLife: 20,
            color: '#22d3ee', size: 4,
          });
        }
      }

      // Crystal collection
      for (const c of s.crystals) {
        if (c.collected) continue;
        const dx = (s.playerX + SHIP_W / 2) - c.x;
        const dy = (s.playerY + SHIP_H / 2) - c.y;
        if (Math.sqrt(dx * dx + dy * dy) < CRYSTAL_SIZE + SHIP_W * 0.4) {
          c.collected = true;
          s.coins += 5 * coinMult;
          onCoins(s.coins);
          for (let i = 0; i < 10; i++) {
            s.particles.push({
              x: c.x, y: c.y,
              vx: (Math.random() - 0.5) * 6,
              vy: (Math.random() - 0.5) * 6,
              life: 18, maxLife: 18,
              color: theme.crystalColor, size: 2 + Math.random() * 3,
            });
          }
        }
      }

      // Passive coin earning per second (FPS-independent via actual delta time)
      const now = performance.now();
      const dt = Math.min((now - s.lastTickTime) / 1000, 0.1); // cap at 100ms to prevent burst on tab-switch
      s.lastTickTime = now;
      const elapsedSec = (now - s.startTime) / 1000;
      const coinsPerSec = (1 + Math.floor(elapsedSec / 30)) * coinMult;
      s.coinAccum += coinsPerSec * dt;
      const wholeCoins = Math.floor(s.coinAccum);
      if (wholeCoins > 0) {
        s.coins += wholeCoins;
        s.coinAccum -= wholeCoins;
        onCoins(s.coins);
      }

      // Particles
      for (const p of s.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        p.vx *= 0.95;
        p.vy *= 0.95;
      }
      s.particles = s.particles.filter(p => p.life > 0);

      // Engine trail
      s.trail.push({
        x: s.playerX + 2,
        y: s.playerY + SHIP_H / 2 + (Math.random() - 0.5) * 6,
        alpha: 0.9,
        size: 3 + Math.random() * 4,
      });
      if (s.trail.length > 30) s.trail.shift();
      for (const t of s.trail) t.alpha *= 0.86;

      // Score = time survived in seconds (FPS-independent)
      s.score = Math.floor((performance.now() - s.startTime) / 1000);
      onScore(s.score);

      // Screen shake decay
      if (s.screenShake > 0) s.screenShake *= 0.85;

      // Stars parallax — different speeds per layer for depth
      for (const layer of s.starLayers) {
        for (const star of layer.stars) {
          star.x -= layer.speed * (s.speed / BASE_SPEED);
          if (star.x < -4) {
            star.x = W + 4 + Math.random() * 20;
            star.y = Math.random() * H;
          }
        }
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
        ctx.translate(
          (Math.random() - 0.5) * s.screenShake,
          (Math.random() - 0.5) * s.screenShake,
        );
      }

      // ── Deep space background ──
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#06081a');
      bgGrad.addColorStop(0.3, '#0a0c24');
      bgGrad.addColorStop(0.5, theme.bg2);
      bgGrad.addColorStop(0.7, '#0a0c24');
      bgGrad.addColorStop(1, '#06081a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // ── Scrolling nebula overlay (pre-rendered) ──
      const nebCanvas = (s as any)._nebulaCanvas as HTMLCanvasElement | undefined;
      if (nebCanvas) {
        (s as any)._nebulaScrollX = ((s as any)._nebulaScrollX + s.speed * 0.08) % nebCanvas.width;
        const nx = -(s as any)._nebulaScrollX;
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.drawImage(nebCanvas, nx, 0);
        if (nx + nebCanvas.width < W) {
          ctx.drawImage(nebCanvas, nx + nebCanvas.width, 0);
        }
        ctx.restore();
      }

      // ── Subtle theme accent glow (center) ──
      ctx.save();
      ctx.globalAlpha = 0.025;
      const accentGlow = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, W * 0.5);
      accentGlow.addColorStop(0, theme.accentColor);
      accentGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = accentGlow;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      // ── Cinematic parallax stars (dense, colored, twinkling) ──
      const time = s.frameCount * 0.016; // approximate seconds
      for (const layer of s.starLayers) {
        for (const star of layer.stars) {
          const twinkle = 0.65 + 0.35 * Math.sin(time * star.twinkleSpeed + star.twinklePhase);
          const alpha = star.brightness * twinkle;
          if (alpha < 0.02) continue; // skip invisible stars
          const colorStr = star.color.replace('A', alpha.toFixed(3));
          ctx.fillStyle = colorStr;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
          ctx.fill();
          // Larger stars get a soft glow
          if (star.size > 1.0 && alpha > 0.3) {
            ctx.save();
            ctx.globalAlpha = alpha * 0.15;
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.size * 3, 0, Math.PI * 2);
            ctx.fillStyle = star.color.replace('A', '0.25');
            ctx.fill();
            ctx.restore();
          }
        }
      }

      // ── Vignette overlay ──
      const vigGrad = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.85);
      vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
      vigGrad.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = vigGrad;
      ctx.fillRect(0, 0, W, H);

      // ── Floor ──
      ctx.fillStyle = theme.floorColor;
      ctx.fillRect(0, floorY, W, GROUND_H);
      // Floor line glow
      ctx.strokeStyle = theme.accentColor;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, floorY);
      ctx.lineTo(W, floorY);
      ctx.stroke();
      // Floor grid lines for depth
      ctx.globalAlpha = 0.06;
      for (let gx = 0; gx < W; gx += 30) {
        const offset = (s.frameCount * s.speed * 0.3) % 30;
        ctx.beginPath();
        ctx.moveTo(gx - offset, floorY);
        ctx.lineTo(gx - offset - 15, H);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // ── Ceiling ──
      ctx.fillStyle = theme.ceilColor;
      ctx.fillRect(0, 0, W, ceilY);
      ctx.strokeStyle = theme.accentColor;
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, ceilY);
      ctx.lineTo(W, ceilY);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // ── Engine trail ──
      for (const t of s.trail) {
        if (t.alpha < 0.03) continue;
        const gradient = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, t.size * 2.5);
        gradient.addColorStop(0, `rgba(34,211,238,${t.alpha * 0.6})`);
        gradient.addColorStop(0.4, `rgba(96,165,250,${t.alpha * 0.3})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.size * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Obstacles ──
      for (const o of s.obstacles) {
        if (o.kind === 'column') {
          const col = o.data;
          const topH = col.gapY - col.gapH / 2 - ceilY;
          const bottomTop = col.gapY + col.gapH / 2;
          const bottomH = floorY - bottomTop;

          // Draw asteroid pillars with improved visuals
          drawAsteroidPillar(ctx, col.x, ceilY, col.width, topH, col.jagged, col.crackSeeds, theme, false, s.frameCount);
          drawAsteroidPillar(ctx, col.x, bottomTop, col.width, bottomH, col.jagged, col.crackSeeds, theme, true, s.frameCount);

          // Small debris particles near columns
          if (Math.random() < 0.15) {
            s.particles.push({
              x: col.x + Math.random() * col.width,
              y: col.gapY + (Math.random() - 0.5) * col.gapH * 0.3,
              vx: -0.5 - Math.random(),
              vy: (Math.random() - 0.5) * 0.5,
              life: 12, maxLife: 12,
              color: theme.obstacleHighlight,
              size: 1 + Math.random() * 1.5,
            });
          }
        }

        if (o.kind === 'laser') {
          const laser = o.data;
          if (!laser.active) {
            // Warning phase — pulsing dotted line
            const pulse = 0.3 + Math.abs(Math.sin(s.frameCount * 0.15)) * 0.5;
            ctx.strokeStyle = theme.laserColor;
            ctx.globalAlpha = pulse;
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 10]);
            ctx.beginPath();
            ctx.moveTo(laser.x, laser.y);
            ctx.lineTo(laser.x + laser.width, laser.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;

            // Warning indicators at edges
            ctx.fillStyle = theme.laserColor;
            ctx.globalAlpha = pulse;
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText('⚠', laser.x - 16, laser.y + 4);
            ctx.fillText('⚠', laser.x + laser.width + 4, laser.y + 4);
            ctx.globalAlpha = 1;
          } else {
            // Active laser beam
            ctx.shadowColor = theme.laserColor;
            ctx.shadowBlur = 18;
            // Outer glow
            ctx.strokeStyle = theme.laserColor;
            ctx.globalAlpha = 0.25;
            ctx.lineWidth = 14;
            ctx.beginPath();
            ctx.moveTo(laser.x, laser.y);
            ctx.lineTo(laser.x + laser.width, laser.y);
            ctx.stroke();
            // Mid glow
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 5;
            ctx.stroke();
            // Core beam
            ctx.globalAlpha = 1;
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(laser.x, laser.y);
            ctx.lineTo(laser.x + laser.width, laser.y);
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
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
            ctx.shadowColor = theme.accentColor;
            ctx.shadowBlur = 5;
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
            ctx.shadowBlur = 0;
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

          // Warning glow while growing
          if (dc.currentH < dc.maxH) {
            ctx.save();
            ctx.globalAlpha = 0.15 + Math.sin(s.frameCount * 0.12) * 0.1;
            ctx.shadowColor = '#ef4444';
            ctx.shadowBlur = 15;
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(dc.x - 2, drawY, dc.width + 4, drawH);
            ctx.shadowBlur = 0;
            ctx.restore();
          }

          drawAsteroidPillar(ctx, dc.x, drawY, dc.width, drawH, dc.jagged, dc.crackSeeds, theme, dc.fromTop, s.frameCount);

          // Glowing tip for dynamic columns
          const tipY = dc.fromTop ? drawY + drawH : drawY;
          ctx.save();
          ctx.shadowColor = theme.accentColor;
          ctx.shadowBlur = 12;
          ctx.fillStyle = theme.accentColor;
          ctx.globalAlpha = 0.5 + Math.sin(s.frameCount * 0.08) * 0.2;
          ctx.fillRect(dc.x - 1, tipY - 2, dc.width + 2, 4);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }

      // ── Crystals ──
      for (const c of s.crystals) {
        if (c.collected) continue;
        const scale = 1 + Math.sin(c.pulse) * 0.18;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(scale, scale);
        // Outer glow
        ctx.shadowColor = theme.crystalColor;
        ctx.shadowBlur = 16;
        // PRISM diamond shape
        ctx.fillStyle = theme.crystalColor;
        ctx.beginPath();
        ctx.moveTo(0, -CRYSTAL_SIZE * 0.55);
        ctx.lineTo(CRYSTAL_SIZE * 0.55, 0);
        ctx.lineTo(0, CRYSTAL_SIZE * 0.55);
        ctx.lineTo(-CRYSTAL_SIZE * 0.55, 0);
        ctx.closePath();
        ctx.fill();
        // Inner facets
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.moveTo(0, -CRYSTAL_SIZE * 0.35);
        ctx.lineTo(CRYSTAL_SIZE * 0.2, 0);
        ctx.lineTo(0, CRYSTAL_SIZE * 0.15);
        ctx.lineTo(-CRYSTAL_SIZE * 0.2, 0);
        ctx.closePath();
        ctx.fill();
        // Sparkle
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        const sparkle = Math.sin(c.pulse * 1.5) * 0.5 + 0.5;
        ctx.globalAlpha = sparkle;
        ctx.beginPath();
        ctx.arc(CRYSTAL_SIZE * 0.12, -CRYSTAL_SIZE * 0.18, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // ── Ship ──
      ctx.save();
      ctx.translate(s.playerX + SHIP_W / 2, s.playerY + SHIP_H / 2);
      ctx.rotate(s.shipRotation);

      if (shipLoadedRef.current && shipImgRef.current) {
        ctx.rotate(Math.PI / 2);
        // Ship glow
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = s.alive ? 14 : 6;
        ctx.drawImage(shipImgRef.current, -SHIP_W / 2, -SHIP_H / 2, SHIP_W, SHIP_H);
        ctx.shadowBlur = 0;
      } else {
        // Fallback: draw a triangle ship
        ctx.fillStyle = '#22d3ee';
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(SHIP_W / 2, 0);
        ctx.lineTo(-SHIP_W / 2, -SHIP_H / 2);
        ctx.lineTo(-SHIP_W / 3, 0);
        ctx.lineTo(-SHIP_W / 2, SHIP_H / 2);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();

      // ── Particles ──
      for (const p of s.particles) {
        const alpha = p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
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
        ctx.shadowColor = theme.accentColor;
        ctx.shadowBlur = 25;
        ctx.fillText(`⟐ ${theme.name} ⟐`, W / 2, 75);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.textAlign = 'start';
      }

      ctx.restore();
    }

    // ── Draw asteroid pillar (improved rocky column) ──
    function drawAsteroidPillar(
      ctx: CanvasRenderingContext2D,
      x: number, y: number, w: number, h: number,
      jagged: number[], crackSeeds: number[],
      theme: LevelTheme, fromTop: boolean, frame: number,
    ) {
      if (h <= 0) return;

      // Main rocky body with gradient
      const bodyGrad = ctx.createLinearGradient(x, y, x + w, y);
      bodyGrad.addColorStop(0, theme.obstacleColor);
      bodyGrad.addColorStop(0.3, theme.obstacleHighlight);
      bodyGrad.addColorStop(0.7, theme.obstacleColor);
      bodyGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
      ctx.fillStyle = bodyGrad;
      ctx.fillRect(x, y, w, h);

      // Jagged edge on the gap side — more detailed
      const edgeY = fromTop ? y + h : y;
      ctx.beginPath();
      const steps = Math.min(jagged.length, 10);
      ctx.moveTo(x - 3, edgeY);
      for (let i = 0; i <= steps; i++) {
        const px = x + (w / steps) * i;
        const offset = jagged[i % jagged.length] * (fromTop ? -1 : 1);
        ctx.lineTo(px, edgeY + offset);
      }
      ctx.lineTo(x + w + 3, edgeY);
      ctx.lineTo(x + w + 3, fromTop ? y : y + h);
      ctx.lineTo(x - 3, fromTop ? y : y + h);
      ctx.closePath();
      ctx.fillStyle = theme.obstacleColor;
      ctx.fill();

      // Surface texture — cracks
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.7;
      for (let i = 0; i < crackSeeds.length; i++) {
        const cs = crackSeeds[i];
        const cx = x + 3 + cs * (w - 6);
        const cy = y + h * (0.15 + (i / crackSeeds.length) * 0.7);
        if (cy < y || cy > y + h) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (cs - 0.5) * 12, cy + 8 + cs * 6);
        ctx.lineTo(cx + (cs - 0.3) * 8, cy + 16 + cs * 4);
        ctx.stroke();
      }

      // Rocky bumps / highlights
      ctx.fillStyle = theme.obstacleHighlight;
      ctx.globalAlpha = 0.12;
      for (let i = 0; i < 4; i++) {
        const bx = x + 2 + ((i * 7 + 3) % (w - 4));
        const by = y + h * (0.2 + (i * 0.2));
        if (by >= y && by <= y + h - 4) {
          ctx.beginPath();
          ctx.arc(bx, by, 2 + (i % 3), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Dark edge gradient for 3D depth
      const depthGrad = ctx.createLinearGradient(x, y, x, y + h);
      depthGrad.addColorStop(0, fromTop ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0)');
      depthGrad.addColorStop(1, fromTop ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.15)');
      ctx.fillStyle = depthGrad;
      ctx.fillRect(x, y, w, h);

    }

    function loop() {
      tick();
      draw();
      if (s.alive) {
        animRef.current = requestAnimationFrame(loop);
      } else {
        let deathFrames = 0;
        const deathLoop = () => {
          // Check for revive during death animation
          if (reviveRef.current) {
            reviveRef.current = false;
            s.alive = true;
            s.screenShake = 0;
            s.velY = FLAP_VEL * 0.5;
            s.obstacles = s.obstacles.filter(o => o.data.x > s.playerX + 200);
            s.particles = [];
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
          s.particles = s.particles.filter(p => p.life > 0);
          if (s.screenShake > 0) s.screenShake *= 0.85;
          draw();
          if (deathFrames < 45 && s.particles.length > 0) {
            animRef.current = requestAnimationFrame(deathLoop);
          } else {
            // Keep checking for late revive after death animation ends
            const waitForRevive = () => {
              if (!animRef.current && animRef.current !== 0) return;
              if (reviveRef.current) {
                reviveRef.current = false;
                s.alive = true;
                s.screenShake = 0;
                s.velY = FLAP_VEL * 0.5;
                s.obstacles = s.obstacles.filter(o => o.data.x > s.playerX + 200);
                s.particles = [];
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

    loop();

    return () => {
      cancelAnimationFrame(animRef.current);
      clearTimeout(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [gameState, onScore, onCoins, onGameOver, reviveRef, hasMintedId]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ touchAction: 'none', background: '#06081a' }}
    />
  );
}
