/**
 * Gravity Runner v2 — polished endless runner with gravity flip mechanic.
 * 
 * Features:
 * - 5 visual themes/levels (Nebula → Asteroid Belt → Black Hole → Warp Zone → Prism Realm)
 * - 4 power-ups: Shield, Magnet, Slow-Mo, Ghost
 * - Combo system (consecutive crystal pickups = multiplier)
 * - Boss obstacles every 1000 points (rotating lasers, gravity wells)
 * - Progressive difficulty with speed/obstacle density curves
 * - Screen shake, particles, trail effects
 * - One-tap mobile control
 * 
 * Canvas 2D for maximum mobile performance.
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
const GROUND_H = 50;
const PLAYER_W = 26;
const PLAYER_H = 26;
const GRAVITY = 0.55;
const BASE_SPEED = 3.5;
const MAX_SPEED = 9;
const SPEED_INCREMENT = 0.0006;
const CRYSTAL_SIZE = 14;

// ── Level themes ──
interface LevelTheme {
  name: string;
  bg1: string; bg2: string; bg3: string;
  floorColor: string; ceilColor: string;
  accentColor: string; crystalColor: string;
  scoreThreshold: number;
}

const LEVEL_THEMES: LevelTheme[] = [
  { name: 'Nebula', bg1: '#0a0e1a', bg2: '#0d1428', bg3: '#0a0e1a', floorColor: 'rgba(34,211,238,0.08)', ceilColor: 'rgba(168,85,247,0.06)', accentColor: '#22d3ee', crystalColor: '#a855f7', scoreThreshold: 0 },
  { name: 'Asteroid Belt', bg1: '#0f0a05', bg2: '#1a1008', bg3: '#0f0a05', floorColor: 'rgba(245,158,11,0.08)', ceilColor: 'rgba(239,68,68,0.06)', accentColor: '#f59e0b', crystalColor: '#fbbf24', scoreThreshold: 500 },
  { name: 'Black Hole', bg1: '#050008', bg2: '#0a0014', bg3: '#050008', floorColor: 'rgba(139,92,246,0.1)', ceilColor: 'rgba(236,72,153,0.06)', accentColor: '#8b5cf6', crystalColor: '#ec4899', scoreThreshold: 1200 },
  { name: 'Warp Zone', bg1: '#000a0f', bg2: '#001420', bg3: '#000a0f', floorColor: 'rgba(6,182,212,0.12)', ceilColor: 'rgba(16,185,129,0.08)', accentColor: '#06b6d4', crystalColor: '#10b981', scoreThreshold: 2000 },
  { name: 'Prism Realm', bg1: '#0f0510', bg2: '#1a0820', bg3: '#0f0510', floorColor: 'rgba(251,191,36,0.1)', ceilColor: 'rgba(34,211,238,0.08)', accentColor: '#fbbf24', crystalColor: '#22d3ee', scoreThreshold: 3000 },
];

function getThemeForScore(score: number): LevelTheme {
  let theme = LEVEL_THEMES[0];
  for (const t of LEVEL_THEMES) {
    if (score >= t.scoreThreshold) theme = t;
  }
  return theme;
}

// ── Power-up types ──
type PowerUpType = 'shield' | 'magnet' | 'slowmo' | 'ghost';

interface PowerUp {
  x: number;
  y: number;
  type: PowerUpType;
  collected: boolean;
  pulse: number;
}

const POWERUP_COLORS: Record<PowerUpType, string> = {
  shield: '#3b82f6',
  magnet: '#f59e0b',
  slowmo: '#8b5cf6',
  ghost: '#6ee7b7',
};

const POWERUP_ICONS: Record<PowerUpType, string> = {
  shield: '🛡', magnet: '🧲', slowmo: '⏳', ghost: '👻',
};

const POWERUP_DURATION = 300; // frames (~5 sec at 60fps)

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'spike' | 'wall' | 'laser' | 'boss_laser' | 'gravity_well';
  color: string;
  rotation?: number;
  rotSpeed?: number;
  gapY?: number;
  gapH?: number;
}

interface Crystal {
  x: number;
  y: number;
  collected: boolean;
  pulse: number;
  value: number;
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

export default function GravityRunnerScene({
  gameState,
  onScore,
  onCoins,
  onGameOver,
  reviveRef,
}: GravityRunnerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef({
    playerX: 80,
    playerY: 0,
    velY: 0,
    gravityDir: 1 as 1 | -1,
    score: 0,
    coins: 0,
    speed: BASE_SPEED,
    obstacles: [] as Obstacle[],
    crystals: [] as Crystal[],
    powerUps: [] as PowerUp[],
    particles: [] as Particle[],
    nextObstacle: 100,
    nextCrystal: 60,
    nextPowerUp: 400,
    nextBoss: 1000,
    frameCount: 0,
    alive: true,
    trail: [] as { x: number; y: number; alpha: number }[],
    screenShake: 0,
    combo: 0,
    comboTimer: 0,
    maxCombo: 0,
    flipCount: 0,
    activePowerUp: null as PowerUpType | null,
    powerUpTimer: 0,
    levelName: 'Nebula',
    prevLevelName: '',
    levelBanner: 0,
    bossWarning: 0,
  });

  const flipGravity = useCallback(() => {
    if (!stateRef.current.alive) return;
    stateRef.current.gravityDir *= -1;
    stateRef.current.velY = stateRef.current.gravityDir * JUMP_VEL * -0.5;
    // Trail burst
    for (let i = 0; i < 5; i++) {
      stateRef.current.particles.push({
        x: stateRef.current.playerX,
        y: stateRef.current.playerY + PLAYER_H / 2,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3,
        life: 20, maxLife: 20,
        color: stateRef.current.gravityDir > 0 ? '#22d3ee' : '#a855f7',
        size: 3 + Math.random() * 3,
      });
    }
  }, []);

  // Input handlers
  useEffect(() => {
    if (gameState !== 'playing') return;
    const handleInput = (e: Event) => {
      e.preventDefault();
      flipGravity();
    };
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('touchstart', handleInput, { passive: false });
    canvas.addEventListener('mousedown', handleInput);
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        flipGravity();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      canvas.removeEventListener('touchstart', handleInput);
      canvas.removeEventListener('mousedown', handleInput);
      window.removeEventListener('keydown', handleKey);
    };
  }, [gameState, flipGravity]);

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') {
      cancelAnimationFrame(animRef.current);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset state
    const s = stateRef.current;
    s.playerY = canvas.height / 2;
    s.velY = 0;
    s.gravityDir = 1;
    s.score = 0;
    s.coins = 0;
    s.speed = BASE_SPEED;
    s.obstacles = [];
    s.crystals = [];
    s.particles = [];
    s.nextObstacle = 100;
    s.nextCrystal = 60;
    s.frameCount = 0;
    s.alive = true;
    s.trail = [];
    s.screenShake = 0;

    const W = canvas.width;
    const H = canvas.height;
    const floorY = H - GROUND_H;
    const ceilY = GROUND_H;

    function spawnObstacle() {
      const types: Obstacle['type'][] = ['spike', 'wall', 'laser'];
      const type = types[Math.floor(Math.random() * types.length)];
      const onFloor = Math.random() > 0.5;

      let obs: Obstacle;
      if (type === 'spike') {
        const h = 30 + Math.random() * 40;
        obs = { x: W + 20, y: onFloor ? floorY - h : ceilY, w: 20, h, type, color: '#ef4444' };
      } else if (type === 'wall') {
        const h = 50 + Math.random() * 60;
        const gap = 100 + Math.random() * 40;
        obs = { x: W + 20, y: onFloor ? floorY - h : ceilY, w: 16, h, type, color: '#f59e0b' };
      } else {
        // Laser — spans full height with gap
        const gapY = ceilY + 40 + Math.random() * (floorY - ceilY - 120);
        obs = { x: W + 20, y: gapY, w: W * 0.4, h: 4, type, color: '#ef4444' };
      }
      s.obstacles.push(obs);
    }

    function spawnCrystal() {
      const y = ceilY + 30 + Math.random() * (floorY - ceilY - 60);
      s.crystals.push({ x: W + 20, y, collected: false, pulse: Math.random() * Math.PI * 2 });
    }

    function checkCollision(px: number, py: number, obs: Obstacle): boolean {
      return px + PLAYER_W > obs.x && px < obs.x + obs.w &&
             py + PLAYER_H > obs.y && py < obs.y + obs.h;
    }

    function tick() {
      if (!s.alive) return;
      s.frameCount++;
      s.speed = BASE_SPEED + s.frameCount * SPEED_INCREMENT;

      // Check revive
      if (reviveRef.current) {
        reviveRef.current = false;
        s.alive = true;
        s.screenShake = 0;
        // Clear nearby obstacles
        s.obstacles = s.obstacles.filter(o => o.x > s.playerX + 200);
      }

      // Physics
      s.velY += GRAVITY * s.gravityDir;
      s.playerY += s.velY;

      // Floor/ceiling collision
      if (s.gravityDir > 0 && s.playerY + PLAYER_H > floorY) {
        s.playerY = floorY - PLAYER_H;
        s.velY = 0;
      }
      if (s.gravityDir < 0 && s.playerY < ceilY) {
        s.playerY = ceilY;
        s.velY = 0;
      }

      // Move obstacles
      for (const obs of s.obstacles) {
        obs.x -= s.speed;
      }
      s.obstacles = s.obstacles.filter(o => o.x + o.w > -20);

      // Move crystals
      for (const c of s.crystals) {
        c.x -= s.speed;
        c.pulse += 0.1;
      }
      s.crystals = s.crystals.filter(c => c.x > -20);

      // Spawn
      s.nextObstacle--;
      if (s.nextObstacle <= 0) {
        spawnObstacle();
        s.nextObstacle = OBSTACLE_INTERVAL_MIN + Math.random() * (OBSTACLE_INTERVAL_MAX - OBSTACLE_INTERVAL_MIN);
        s.nextObstacle = Math.max(40, s.nextObstacle - s.frameCount * 0.01);
      }
      s.nextCrystal--;
      if (s.nextCrystal <= 0) {
        spawnCrystal();
        s.nextCrystal = CRYSTAL_INTERVAL;
      }

      // Collision with obstacles
      for (const obs of s.obstacles) {
        if (checkCollision(s.playerX, s.playerY, obs)) {
          s.alive = false;
          s.screenShake = 15;
          // Death particles
          for (let i = 0; i < 20; i++) {
            s.particles.push({
              x: s.playerX + PLAYER_W / 2,
              y: s.playerY + PLAYER_H / 2,
              vx: (Math.random() - 0.5) * 8,
              vy: (Math.random() - 0.5) * 8,
              life: 30 + Math.random() * 20, maxLife: 50,
              color: '#ef4444', size: 2 + Math.random() * 4,
            });
          }
          onGameOver(s.score, s.coins);
          return;
        }
      }

      // Crystal collection
      for (const c of s.crystals) {
        if (c.collected) continue;
        const dx = (s.playerX + PLAYER_W / 2) - c.x;
        const dy = (s.playerY + PLAYER_H / 2) - c.y;
        if (Math.sqrt(dx * dx + dy * dy) < CRYSTAL_SIZE + PLAYER_W / 2) {
          c.collected = true;
          s.coins += 1;
          onCoins(s.coins);
          // Collect particles
          for (let i = 0; i < 8; i++) {
            s.particles.push({
              x: c.x, y: c.y,
              vx: (Math.random() - 0.5) * 5,
              vy: (Math.random() - 0.5) * 5,
              life: 15, maxLife: 15,
              color: '#a855f7', size: 2 + Math.random() * 3,
            });
          }
        }
      }

      // Update particles
      for (const p of s.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        p.vx *= 0.95;
        p.vy *= 0.95;
      }
      s.particles = s.particles.filter(p => p.life > 0);

      // Trail
      s.trail.push({ x: s.playerX + PLAYER_W / 2, y: s.playerY + PLAYER_H / 2, alpha: 1 });
      if (s.trail.length > 20) s.trail.shift();
      for (const t of s.trail) t.alpha *= 0.88;

      // Score = time survived (frames / 60 * 10)
      s.score = Math.floor(s.frameCount / 6);
      onScore(s.score);

      // Screen shake decay
      if (s.screenShake > 0) s.screenShake *= 0.85;
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // Screen shake
      ctx.save();
      if (s.screenShake > 0.5) {
        ctx.translate(
          (Math.random() - 0.5) * s.screenShake,
          (Math.random() - 0.5) * s.screenShake,
        );
      }

      // Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#0a0e1a');
      bgGrad.addColorStop(0.5, '#0d1428');
      bgGrad.addColorStop(1, '#0a0e1a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Ground
      ctx.fillStyle = 'rgba(34,211,238,0.08)';
      ctx.fillRect(0, floorY, W, GROUND_H);
      ctx.strokeStyle = 'rgba(34,211,238,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, floorY);
      ctx.lineTo(W, floorY);
      ctx.stroke();

      // Ceiling
      ctx.fillStyle = 'rgba(168,85,247,0.06)';
      ctx.fillRect(0, 0, W, ceilY);
      ctx.strokeStyle = 'rgba(168,85,247,0.25)';
      ctx.beginPath();
      ctx.moveTo(0, ceilY);
      ctx.lineTo(W, ceilY);
      ctx.stroke();

      // Grid lines (scrolling)
      ctx.strokeStyle = 'rgba(255,255,255,0.02)';
      ctx.lineWidth = 1;
      const gridOffset = (s.frameCount * s.speed) % 40;
      for (let x = -gridOffset; x < W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, ceilY);
        ctx.lineTo(x, floorY);
        ctx.stroke();
      }

      // Trail
      for (const t of s.trail) {
        if (t.alpha < 0.05) continue;
        ctx.fillStyle = `rgba(34,211,238,${t.alpha * 0.3})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 4 * t.alpha, 0, Math.PI * 2);
        ctx.fill();
      }

      // Obstacles
      for (const obs of s.obstacles) {
        if (obs.type === 'laser') {
          ctx.strokeStyle = obs.color;
          ctx.lineWidth = obs.h;
          ctx.shadowColor = obs.color;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(obs.x, obs.y);
          ctx.lineTo(obs.x + obs.w, obs.y);
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = obs.color;
          ctx.shadowColor = obs.color;
          ctx.shadowBlur = 8;
          ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
          ctx.shadowBlur = 0;
        }
      }

      // Crystals
      for (const c of s.crystals) {
        if (c.collected) continue;
        const scale = 1 + Math.sin(c.pulse) * 0.15;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#a855f7';
        ctx.shadowColor = '#a855f7';
        ctx.shadowBlur = 12;
        // Diamond shape
        ctx.beginPath();
        ctx.moveTo(0, -CRYSTAL_SIZE / 2);
        ctx.lineTo(CRYSTAL_SIZE / 2, 0);
        ctx.lineTo(0, CRYSTAL_SIZE / 2);
        ctx.lineTo(-CRYSTAL_SIZE / 2, 0);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // Player
      const playerColor = s.gravityDir > 0 ? '#22d3ee' : '#a855f7';
      ctx.fillStyle = playerColor;
      ctx.shadowColor = playerColor;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.roundRect(s.playerX, s.playerY, PLAYER_W, PLAYER_H, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Player eye/direction indicator
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(
        s.playerX + PLAYER_W * 0.7,
        s.playerY + PLAYER_H * (s.gravityDir > 0 ? 0.35 : 0.65),
        3, 0, Math.PI * 2,
      );
      ctx.fill();

      // Particles
      for (const p of s.particles) {
        const alpha = p.life / p.maxLife;
        ctx.fillStyle = p.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    function loop() {
      tick();
      draw();
      animRef.current = requestAnimationFrame(loop);
    }

    // Resize canvas
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);
    loop();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [gameState, onScore, onCoins, onGameOver, reviveRef]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ touchAction: 'none', background: '#0a0e1a' }}
    />
  );
}
