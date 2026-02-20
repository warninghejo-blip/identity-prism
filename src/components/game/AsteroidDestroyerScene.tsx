import React, { useEffect, useMemo, useRef, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  type GameProps, type GameState, type SmallExplosion,
  IS_MOBILE, CAM_Z, TIER_COLORS,
  rnd, clamp, slerp,
  SpaceBG, Dust, SmallExplosions, FX, GameCanvas,
} from "./GameShared";

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */

interface Projectile {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  active: boolean;
  kind: "bullet" | "rocket";
}

type EnemyType = "scout" | "fighter" | "tank" | "swarm" | "bomber" | "cloaker" | "shielder" | "elite" | "boss";

interface Enemy {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  hp: number; maxHp: number;
  type: EnemyType;
  active: boolean;
  shootTimer: number;
  phaseTimer: number;
  shieldHp: number;
  cloakAlpha: number;
  r: number;
  rx: number; ry: number; rz: number;
}

interface EnemyBullet {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  active: boolean;
}

interface Wave {
  enemies: { type: EnemyType; count: number }[];
  delay: number; // seconds before wave starts
}

interface LevelDef {
  id: number;
  name: string;
  waves: Wave[];
  bgTint: string;
}

type DPwrType = "firerate" | "double" | "rocket" | "shield" | "bomb";

interface DPowerUp {
  id: number;
  x: number; y: number;
  type: DPwrType;
  life: number;
  active: boolean;
}

/* ═══════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════ */

const PLAY_W = 28;
const PLAY_H = 38;
const HALF_W = PLAY_W / 2;
const HALF_H = PLAY_H / 2;
const SHIP_SPEED = 18;
const SHIP_R = 0.55;

const MAX_PROJECTILES = 40;
const PROJ_SPEED = 42;
const PROJ_LIFE = 1.4;
const PROJ_HIT_R = 0.4;
const ROCKET_SPEED = 28;
const ROCKET_HIT_R = 0.7;
const ROCKET_DMG = 4;

const BASE_FIRE_CD = 0.22;
const FAST_FIRE_CD = 0.10;
const DOUBLE_DUR = 12;
const FIRERATE_DUR = 10;
const ROCKET_AMMO = 6;

const MAX_ENEMIES = 60;
const MAX_ENEMY_BULLETS = 80;
const MAX_POWERUPS = 4;

const ENEMY_STATS: Record<EnemyType, { hp: number; speed: number; r: number; score: number; shoots: boolean; color: string }> = {
  scout:    { hp: 1, speed: 5,  r: 0.6, score: 10,  shoots: false, color: "#44ff66" },
  fighter:  { hp: 2, speed: 8,  r: 0.5, score: 20,  shoots: true,  color: "#ff4466" },
  tank:     { hp: 5, speed: 3,  r: 1.0, score: 40,  shoots: true,  color: "#ff8800" },
  swarm:    { hp: 1, speed: 10, r: 0.35,score: 5,   shoots: false, color: "#aaffaa" },
  bomber:   { hp: 3, speed: 4,  r: 0.8, score: 30,  shoots: true,  color: "#ff44ff" },
  cloaker:  { hp: 2, speed: 6,  r: 0.55,score: 35,  shoots: true,  color: "#8844ff" },
  shielder: { hp: 3, speed: 4,  r: 0.7, score: 45,  shoots: true,  color: "#00ccff" },
  elite:    { hp: 6, speed: 7,  r: 0.65,score: 60,  shoots: true,  color: "#ffcc00" },
  boss:     { hp: 40,speed: 2,  r: 2.0, score: 500, shoots: true,  color: "#ff0044" },
};

/* ═══════════════════════════════════════════════════
   9 Levels
   ═══════════════════════════════════════════════════ */

const LEVELS: LevelDef[] = [
  { id: 1, name: "First Contact", bgTint: "#0a0a1a", waves: [
    { delay: 1, enemies: [{ type: "scout", count: 6 }] },
    { delay: 6, enemies: [{ type: "scout", count: 8 }] },
  ]},
  { id: 2, name: "Swarm Warning", bgTint: "#0a1a0a", waves: [
    { delay: 1, enemies: [{ type: "scout", count: 8 }] },
    { delay: 5, enemies: [{ type: "swarm", count: 14 }] },
    { delay: 4, enemies: [{ type: "scout", count: 6 }, { type: "fighter", count: 2 }] },
  ]},
  { id: 3, name: "Armored Assault", bgTint: "#1a0a0a", waves: [
    { delay: 1, enemies: [{ type: "fighter", count: 4 }] },
    { delay: 5, enemies: [{ type: "tank", count: 3 }] },
    { delay: 5, enemies: [{ type: "fighter", count: 4 }, { type: "tank", count: 2 }] },
  ]},
  { id: 4, name: "Speed Blitz", bgTint: "#0a0a2a", waves: [
    { delay: 1, enemies: [{ type: "swarm", count: 20 }] },
    { delay: 4, enemies: [{ type: "fighter", count: 8 }] },
    { delay: 4, enemies: [{ type: "swarm", count: 15 }, { type: "fighter", count: 4 }] },
  ]},
  { id: 5, name: "Bombardment", bgTint: "#1a0a1a", waves: [
    { delay: 1, enemies: [{ type: "bomber", count: 5 }] },
    { delay: 5, enemies: [{ type: "tank", count: 3 }, { type: "bomber", count: 3 }] },
    { delay: 5, enemies: [{ type: "boss", count: 1 }] },
  ]},
  { id: 6, name: "Phantom Menace", bgTint: "#0a001a", waves: [
    { delay: 1, enemies: [{ type: "cloaker", count: 6 }] },
    { delay: 5, enemies: [{ type: "cloaker", count: 4 }, { type: "fighter", count: 4 }] },
    { delay: 5, enemies: [{ type: "cloaker", count: 8 }, { type: "bomber", count: 2 }] },
  ]},
  { id: 7, name: "Shield Wall", bgTint: "#001a1a", waves: [
    { delay: 1, enemies: [{ type: "shielder", count: 5 }] },
    { delay: 5, enemies: [{ type: "shielder", count: 4 }, { type: "tank", count: 3 }] },
    { delay: 5, enemies: [{ type: "shielder", count: 6 }, { type: "elite", count: 2 }] },
  ]},
  { id: 8, name: "Total War", bgTint: "#1a1a0a", waves: [
    { delay: 1, enemies: [{ type: "scout", count: 10 }, { type: "fighter", count: 5 }] },
    { delay: 5, enemies: [{ type: "tank", count: 3 }, { type: "cloaker", count: 4 }, { type: "bomber", count: 3 }] },
    { delay: 5, enemies: [{ type: "elite", count: 4 }, { type: "shielder", count: 3 }] },
    { delay: 5, enemies: [{ type: "boss", count: 1 }, { type: "elite", count: 2 }] },
  ]},
  { id: 9, name: "Final Stand", bgTint: "#1a0000", waves: [
    { delay: 1, enemies: [{ type: "swarm", count: 20 }, { type: "fighter", count: 8 }] },
    { delay: 6, enemies: [{ type: "elite", count: 6 }, { type: "shielder", count: 4 }] },
    { delay: 6, enemies: [{ type: "tank", count: 4 }, { type: "bomber", count: 4 }, { type: "cloaker", count: 4 }] },
    { delay: 6, enemies: [{ type: "boss", count: 2 }, { type: "elite", count: 4 }] },
  ]},
];

const PWR_TYPES: DPwrType[] = ["firerate", "double", "rocket", "shield", "bomb"];
const PWR_COLORS: Record<DPwrType, string> = {
  firerate: "#ffcc00", double: "#00ffcc", rocket: "#ff4444", shield: "#22d3ee", bomb: "#ff66ff",
};

/* ═══════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════ */

let _eid = 0;
const resetEid = () => { _eid = 0; };
let _pwid = 0;
const resetPwid = () => { _pwid = 0; };

function spawnEnemy(type: EnemyType, x?: number): Enemy {
  const s = ENEMY_STATS[type];
  const ex = x ?? rnd(-HALF_W + 2, HALF_W - 2);
  return {
    id: ++_eid, x: ex, y: HALF_H + s.r + 1,
    vx: rnd(-1, 1) * s.speed * 0.3, vy: -s.speed,
    hp: s.hp, maxHp: s.hp, type, active: true,
    shootTimer: rnd(1, 3), phaseTimer: 0,
    shieldHp: type === "shielder" ? 3 : 0,
    cloakAlpha: type === "cloaker" ? 0.15 : 1,
    r: s.r, rx: 0, ry: 0, rz: rnd(0, 6.28),
  };
}

function fireProj(pool: Projectile[], x: number, y: number, vx: number, vy: number, kind: "bullet" | "rocket" = "bullet"): boolean {
  for (const p of pool) {
    if (!p.active) {
      p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.life = kind === "rocket" ? 2.2 : PROJ_LIFE;
      p.active = true; p.kind = kind;
      return true;
    }
  }
  return false;
}

/* ═══════════════════════════════════════════════════
   Projectile visuals
   ═══════════════════════════════════════════════════ */

function ProjectileVisuals({ poolRef, color }: { poolRef: React.MutableRefObject<Projectile[]>; color: string }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRefs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const m = refs.current[i]; const g = glowRefs.current[i]; const p = poolRef.current[i];
      if (!m || !g) continue;
      if (!p || !p.active) { m.visible = false; g.visible = false; continue; }
      m.visible = true; g.visible = true;
      m.position.set(p.x, p.y, 0); g.position.set(p.x, p.y, 0);
      const isRocket = p.kind === "rocket";
      const fade = Math.min(1, p.life * 4);
      const sc = isRocket ? 1.6 : 1;
      m.scale.setScalar(sc);
      (m.material as THREE.MeshBasicMaterial).color.set(isRocket ? "#ff4444" : color);
      (m.material as THREE.MeshBasicMaterial).opacity = fade;
      g.scale.setScalar((isRocket ? 2.2 : 1) * (1 + Math.sin(t * 8 + i * 2) * .15));
      (g.material as THREE.MeshBasicMaterial).color.set(isRocket ? "#ff6622" : color);
      (g.material as THREE.MeshBasicMaterial).opacity = fade * .3 * (.7 + Math.sin(t * 12 + i) * .3);
    }
  });
  return (<>{Array.from({ length: MAX_PROJECTILES }).map((_, i) => (
    <React.Fragment key={i}>
      <mesh ref={el => { refs.current[i] = el; }} visible={false}>
        <sphereGeometry args={[.18, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={1} />
      </mesh>
      <mesh ref={el => { glowRefs.current[i] = el; }} visible={false}>
        <sphereGeometry args={[.5, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </React.Fragment>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Enemy visuals (3D UFO shapes)
   ═══════════════════════════════════════════════════ */

function EnemyVisuals({ poolRef }: { poolRef: React.MutableRefObject<Enemy[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const hpBarRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const g = refs.current[i]; const e = poolRef.current[i];
      const hpBar = hpBarRefs.current[i];
      if (!g) continue;
      if (!e || !e.active) { g.visible = false; continue; }
      g.visible = true;
      g.position.set(e.x, e.y, 0);
      g.rotation.z = e.rz + Math.sin(t * 2 + i) * 0.1;
      const sc = e.r;
      g.scale.setScalar(sc);
      // Cloaker fade
      if (e.type === "cloaker") {
        const alpha = 0.15 + Math.sin(t * 3 + i * 1.7) * 0.1;
        e.cloakAlpha = alpha;
        g.children.forEach(c => {
          const m = (c as THREE.Mesh).material;
          if (m && 'opacity' in m) (m as THREE.MeshBasicMaterial).opacity = alpha;
        });
      }
      // HP bar
      if (hpBar && e.maxHp > 1) {
        hpBar.visible = true;
        hpBar.scale.x = Math.max(0.01, e.hp / e.maxHp);
      } else if (hpBar) {
        hpBar.visible = false;
      }
    }
  });

  return (<>{Array.from({ length: MAX_ENEMIES }).map((_, i) => (
    <group key={i} ref={el => { refs.current[i] = el; }} visible={false}>
      {/* Saucer body */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.7, 1, 0.25, 16]} />
        <meshStandardMaterial color="#888" emissive="#224" emissiveIntensity={0.5} metalness={0.8} roughness={0.2} transparent />
      </mesh>
      {/* Dome */}
      <mesh position={[0, 0.15, 0]}>
        <sphereGeometry args={[0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#aaf" emissive="#66f" emissiveIntensity={1} transparent toneMapped={false} />
      </mesh>
      {/* Glow ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.85, 0.04, 8, 24]} />
        <meshBasicMaterial color="#44ffaa" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* HP bar background */}
      <mesh position={[0, -1.3, 0]}>
        <planeGeometry args={[1.6, 0.12]} />
        <meshBasicMaterial color="#333" transparent opacity={0.5} />
      </mesh>
      {/* HP bar fill */}
      <mesh ref={el => { hpBarRefs.current[i] = el; }} position={[0, -1.3, 0.01]} visible={false}>
        <planeGeometry args={[1.6, 0.12]} />
        <meshBasicMaterial color="#44ff44" transparent opacity={0.8} />
      </mesh>
    </group>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Enemy bullet visuals
   ═══════════════════════════════════════════════════ */

function EnemyBulletVisuals({ poolRef }: { poolRef: React.MutableRefObject<EnemyBullet[]> }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    for (let i = 0; i < MAX_ENEMY_BULLETS; i++) {
      const m = refs.current[i]; const b = poolRef.current[i];
      if (!m) continue;
      if (!b || !b.active) { m.visible = false; continue; }
      m.visible = true;
      m.position.set(b.x, b.y, 0);
    }
  });
  return (<>{Array.from({ length: MAX_ENEMY_BULLETS }).map((_, i) => (
    <mesh key={i} ref={el => { refs.current[i] = el; }} visible={false}>
      <sphereGeometry args={[.15, 6, 6]} />
      <meshBasicMaterial color="#ff2244" transparent opacity={0.9} blending={THREE.AdditiveBlending} />
    </mesh>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   PowerUp drop visuals
   ═══════════════════════════════════════════════════ */

function DPowerUpVisuals({ poolRef }: { poolRef: React.MutableRefObject<DPowerUp[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let i = 0; i < MAX_POWERUPS; i++) {
      const g = refs.current[i]; const pw = poolRef.current[i];
      if (!g) continue;
      if (!pw || !pw.active) { g.visible = false; continue; }
      g.visible = true;
      g.position.set(pw.x, pw.y, 0);
      g.rotation.y = t * 2;
      g.scale.setScalar(0.8 + Math.sin(t * 3 + i) * 0.1);
      const col = PWR_COLORS[pw.type];
      g.children.forEach(c => {
        const m = (c as THREE.Mesh).material;
        if (m && 'color' in m) (m as THREE.MeshBasicMaterial).color.set(col);
        if (m && 'emissive' in m) (m as THREE.MeshStandardMaterial).emissive.set(col);
      });
    }
  });
  return (<>{Array.from({ length: MAX_POWERUPS }).map((_, i) => (
    <group key={i} ref={el => { refs.current[i] = el; }} visible={false}>
      <mesh>
        <octahedronGeometry args={[.4, 1]} />
        <meshStandardMaterial emissiveIntensity={2.5} toneMapped={false} transparent opacity={0.9} metalness={.7} roughness={.15} />
      </mesh>
      <mesh>
        <torusGeometry args={[.55, .03, 8, 24]} />
        <meshBasicMaterial transparent opacity={.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Shooter Ship (bottom, H/V movement)
   ═══════════════════════════════════════════════════ */

function ShooterShip({ posRef, color, shieldActive }: {
  posRef: React.MutableRefObject<{ x: number; y: number }>;
  color: string;
  shieldActive: React.MutableRefObject<boolean>;
}) {
  const gRef = useRef<THREE.Group>(null);
  const shieldRef = useRef<THREE.Mesh>(null);
  const exRef = useRef<THREE.Points>(null);
  const N = 40;
  const exSt = useMemo(() => {
    const p = new Float32Array(N * 3);
    const d: { l: number; ml: number; sp: number; ox: number }[] = [];
    for (let i = 0; i < N; i++) {
      d.push({ l: Math.random() * .4, ml: .15 + Math.random() * .25, sp: 1.5 + Math.random() * 3, ox: (Math.random() - .5) * .1 });
      p[i * 3] = 0; p[i * 3 + 1] = -.7; p[i * 3 + 2] = 0;
    }
    return { p, d };
  }, []);

  useFrame((s, delta) => {
    if (!gRef.current) return;
    const dt = Math.min(delta, .033); const t = s.clock.elapsedTime;
    gRef.current.position.x = slerp(gRef.current.position.x, posRef.current.x, 12, dt);
    gRef.current.position.y = slerp(gRef.current.position.y, posRef.current.y, 12, dt);
    if (shieldRef.current) {
      shieldRef.current.visible = shieldActive.current;
      if (shieldActive.current) {
        (shieldRef.current.material as THREE.MeshBasicMaterial).opacity = .12 + Math.sin(t * 4) * .05;
        shieldRef.current.scale.setScalar(1 + Math.sin(t * 3) * .05);
      }
    }
    if (exRef.current) {
      const a = exRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < N; i++) {
        const d = exSt.d[i]; d.l -= dt;
        if (d.l <= 0) { d.l = d.ml; a[i * 3] = d.ox; a[i * 3 + 1] = -.7; a[i * 3 + 2] = (Math.random() - .5) * .04; }
        else { a[i * 3 + 1] -= d.sp * dt; a[i * 3] += (Math.random() - .5) * dt * .5; }
      }
      exRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <group ref={gRef}>
      {/* Nose */}
      <mesh position={[0, .42, 0]}><coneGeometry args={[.17, .82, 16]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.7} metalness={.92} roughness={.06} toneMapped={false} /></mesh>
      {/* Body */}
      <mesh position={[0, -.1, 0]}><cylinderGeometry args={[.21, .27, .72, 16]} /><meshStandardMaterial color="#e8ecf0" metalness={.94} roughness={.04} emissive="#111820" emissiveIntensity={.15} /></mesh>
      {/* Canopy */}
      <mesh position={[0, .15, .21]}><sphereGeometry args={[.15, 16, 12, 0, 6.28, 0, Math.PI * .55]} /><meshStandardMaterial color="#67e8f9" emissive="#22d3ee" emissiveIntensity={2.5} toneMapped={false} transparent opacity={.88} /></mesh>
      {/* Wings */}
      <mesh position={[.42, -.08, 0]} rotation={[0, 0, -.3]}><boxGeometry args={[.6, .035, .14]} /><meshStandardMaterial color="#cbd5e1" metalness={.82} roughness={.15} /></mesh>
      <mesh position={[-.42, -.08, 0]} rotation={[0, 0, .3]}><boxGeometry args={[.6, .035, .14]} /><meshStandardMaterial color="#cbd5e1" metalness={.82} roughness={.15} /></mesh>
      {/* Wing tips */}
      <mesh position={[.68, -.15, 0]}><sphereGeometry args={[.04, 8, 8]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={3} toneMapped={false} /></mesh>
      <mesh position={[-.68, -.15, 0]}><sphereGeometry args={[.04, 8, 8]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={3} toneMapped={false} /></mesh>
      {/* Engines */}
      <mesh position={[.2, -.52, 0]}><cylinderGeometry args={[.06, .08, .28, 10]} /><meshStandardMaterial color="#94a3b8" metalness={.94} roughness={.06} /></mesh>
      <mesh position={[-.2, -.52, 0]}><cylinderGeometry args={[.06, .08, .28, 10]} /><meshStandardMaterial color="#94a3b8" metalness={.94} roughness={.06} /></mesh>
      <mesh position={[.2, -.72, 0]}><sphereGeometry args={[.07, 8, 8]} /><meshStandardMaterial color="#fb923c" emissive="#f97316" emissiveIntensity={6} toneMapped={false} /></mesh>
      <mesh position={[-.2, -.72, 0]}><sphereGeometry args={[.07, 8, 8]} /><meshStandardMaterial color="#fb923c" emissive="#f97316" emissiveIntensity={6} toneMapped={false} /></mesh>
      {/* Shield bubble */}
      <mesh ref={shieldRef} visible={false}><sphereGeometry args={[1.3, 24, 24]} /><meshBasicMaterial color="#22d3ee" transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      {/* Exhaust particles */}
      <points ref={exRef}><bufferGeometry><bufferAttribute attach="attributes-position" args={[exSt.p, 3]} /></bufferGeometry><pointsMaterial size={.06} color="#ffaa55" transparent opacity={.7} blending={THREE.AdditiveBlending} sizeAttenuation depthWrite={false} /></points>
      <pointLight intensity={2.8} color={color} distance={8} />
    </group>
  );
}

/* ═══════════════════════════════════════════════════
   Fixed Camera (top-down)
   ═══════════════════════════════════════════════════ */

function FixedCam({ shake }: { shake: React.MutableRefObject<number> }) {
  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, .033);
    let sx = 0, sy = 0;
    if (shake.current > .01) {
      sx = (Math.random() - .5) * shake.current * .6;
      sy = (Math.random() - .5) * shake.current * .6;
      shake.current = Math.max(0, shake.current - dt * 4);
    }
    camera.position.set(sx, sy, CAM_Z);
    camera.lookAt(sx, sy, 0);
  });
  return null;
}

/* ═══════════════════════════════════════════════════
   Game World — Cosmic Defender (top-down shooter)
   ═══════════════════════════════════════════════════ */

function DestroyerWorld({ gameState, onGameOver, onScore, onCoins, traits }: GameProps) {
  // Ship state
  const shipPos = useRef({ x: 0, y: -HALF_H + 3 });
  const inputDir = useRef({ x: 0, y: 0 });
  const touchId = useRef<number | null>(null);
  const touchStart = useRef({ x: 0, y: 0, sx: 0, sy: 0 });

  // Pools
  const projectiles = useRef<Projectile[]>(
    Array.from({ length: MAX_PROJECTILES }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, active: false, kind: "bullet" as const }))
  );
  const enemies = useRef<Enemy[]>(
    Array.from({ length: MAX_ENEMIES }, (_, i) => ({
      id: i, x: 0, y: 99, vx: 0, vy: 0, hp: 0, maxHp: 0, type: "scout" as EnemyType,
      active: false, shootTimer: 0, phaseTimer: 0, shieldHp: 0, cloakAlpha: 1,
      r: 0.5, rx: 0, ry: 0, rz: 0,
    }))
  );
  const enemyBullets = useRef<EnemyBullet[]>(
    Array.from({ length: MAX_ENEMY_BULLETS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, active: false }))
  );
  const powerups = useRef<DPowerUp[]>(
    Array.from({ length: MAX_POWERUPS }, () => ({ id: 0, x: 0, y: 0, type: "shield" as DPwrType, life: 0, active: false }))
  );
  const smallExplosions = useRef<SmallExplosion[]>([]);

  // Game state refs
  const overRef = useRef(false);
  const scoreRef = useRef(0);
  const coinBank = useRef(0);
  const shake = useRef(0);
  const elapsed = useRef(0);

  // Level system
  const level = useRef(0);
  const waveIdx = useRef(0);
  const waveTimer = useRef(0);
  const waveSpawned = useRef(false);
  const levelComplete = useRef(false);
  const levelPause = useRef(0);
  const allEnemiesSpawned = useRef(false);

  // Powerup durations
  const shieldActive = useRef(false);
  const shieldHits = useRef(0);
  const doubleT = useRef(0);
  const firerateT = useRef(0);
  const rocketAmmo = useRef(0);
  const fireCooldown = useRef(0);
  const autoFire = useRef(true);

  // Combo
  const combo = useRef(0);
  const comboTimer = useRef(0);

  const sCol = traits?.planetTier ? TIER_COLORS[traits.planetTier] || "#22d3ee" : "#22d3ee";

  // Input handling
  useEffect(() => {
    if (gameState !== "playing") return;
    const keys = new Set<string>();

    const onKeyDown = (e: KeyboardEvent) => {
      keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.code); };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (touchId.current !== null) return;
      const t = e.changedTouches[0];
      touchId.current = t.identifier;
      touchStart.current = { x: t.clientX, y: t.clientY, sx: shipPos.current.x, sy: shipPos.current.y };
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === touchId.current) {
          const sensitivity = 0.06;
          const dx = (t.clientX - touchStart.current.x) * sensitivity;
          const dy = -(t.clientY - touchStart.current.y) * sensitivity;
          shipPos.current.x = clamp(touchStart.current.sx + dx, -HALF_W + 1, HALF_W - 1);
          shipPos.current.y = clamp(touchStart.current.sy + dy, -HALF_H + 1, HALF_H - 1);
        }
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId.current) touchId.current = null;
      }
    };
    const onCtx = (e: Event) => e.preventDefault();

    const updateInput = () => {
      let dx = 0, dy = 0;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) dx -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) dx += 1;
      if (keys.has("KeyW") || keys.has("ArrowUp")) dy += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) dy -= 1;
      inputDir.current = { x: dx, y: dy };
    };
    const interval = setInterval(updateInput, 16);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("touchstart", onTouchStart, { passive: false });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("contextmenu", onCtx);
    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("contextmenu", onCtx);
    };
  }, [gameState]);

  // Reset on game start
  useEffect(() => {
    if (gameState !== "playing") return;
    resetEid(); resetPwid();
    shipPos.current = { x: 0, y: -HALF_H + 3 };
    inputDir.current = { x: 0, y: 0 };
    touchId.current = null;
    projectiles.current.forEach(p => { p.active = false; });
    enemies.current.forEach(e => { e.active = false; });
    enemyBullets.current.forEach(b => { b.active = false; });
    powerups.current.forEach(p => { p.active = false; });
    smallExplosions.current = [];
    overRef.current = false; scoreRef.current = 0; coinBank.current = 0;
    shake.current = 0; elapsed.current = 0;
    level.current = 0; waveIdx.current = 0; waveTimer.current = 0;
    waveSpawned.current = false; levelComplete.current = false; levelPause.current = 0;
    allEnemiesSpawned.current = false;
    shieldActive.current = false; shieldHits.current = 0;
    doubleT.current = 0; firerateT.current = 0; rocketAmmo.current = 0;
    fireCooldown.current = 0; autoFire.current = true;
    combo.current = 0; comboTimer.current = 0;
    onScore(0); onCoins(0);
  }, [gameState]);

  const physAccum = useRef(0);
  const PHYS_DT = 1 / 90;

  useFrame((_, delta) => {
    if (gameState !== "playing" || overRef.current) return;
    const frameDt = Math.min(delta, .1);
    physAccum.current += frameDt;
    if (physAccum.current > PHYS_DT * 6) physAccum.current = PHYS_DT * 6;

    while (physAccum.current >= PHYS_DT) {
      physAccum.current -= PHYS_DT;
      const dt = PHYS_DT;
      elapsed.current += dt;

      // Ship movement
      const { x: dx, y: dy } = inputDir.current;
      if (dx !== 0 || dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy);
        shipPos.current.x += (dx / len) * SHIP_SPEED * dt;
        shipPos.current.y += (dy / len) * SHIP_SPEED * dt;
      }
      shipPos.current.x = clamp(shipPos.current.x, -HALF_W + 1, HALF_W - 1);
      shipPos.current.y = clamp(shipPos.current.y, -HALF_H + 1, HALF_H - 4);

      // Powerup timers
      if (doubleT.current > 0) doubleT.current -= dt;
      if (firerateT.current > 0) firerateT.current -= dt;
      if (fireCooldown.current > 0) fireCooldown.current -= dt;

      // Combo decay
      if (comboTimer.current > 0) { comboTimer.current -= dt; if (comboTimer.current <= 0) combo.current = 0; }
    }

    // Frame-rate updates
    const dt = frameDt;
    const sx = shipPos.current.x, sy = shipPos.current.y;
    const lvl = LEVELS[level.current];
    if (!lvl) {
      // All 9 levels complete — game over with victory score
      if (!overRef.current) {
        overRef.current = true;
        scoreRef.current += 1000; // completion bonus
        onScore(scoreRef.current);
        onGameOver(scoreRef.current, coinBank.current);
      }
      return;
    }

    // Level wave system
    if (!levelComplete.current) {
      waveTimer.current += dt;
      const wave = lvl.waves[waveIdx.current];
      if (wave && !waveSpawned.current && waveTimer.current >= wave.delay) {
        // Spawn this wave
        for (const eg of wave.enemies) {
          for (let j = 0; j < eg.count; j++) {
            const slot = enemies.current.find(e => !e.active);
            if (slot) {
              const spawned = spawnEnemy(eg.type);
              // Stagger spawn X position
              spawned.x = rnd(-HALF_W + 2, HALF_W - 2);
              spawned.y = HALF_H + spawned.r + rnd(0, 4);
              Object.assign(slot, spawned);
            }
          }
        }
        waveSpawned.current = true;
      }
      // Check if all enemies from this wave are dead
      if (waveSpawned.current) {
        const alive = enemies.current.some(e => e.active);
        if (!alive) {
          waveIdx.current++;
          waveSpawned.current = false;
          waveTimer.current = 0;
          if (waveIdx.current >= lvl.waves.length) {
            levelComplete.current = true;
            levelPause.current = 2.5;
            // Level completion bonus
            const bonus = lvl.id * 100;
            scoreRef.current += bonus;
            coinBank.current += lvl.id * 10;
            onScore(scoreRef.current);
            onCoins(coinBank.current);
          }
        }
      }
    } else {
      // Pause between levels
      levelPause.current -= dt;
      if (levelPause.current <= 0) {
        level.current++;
        waveIdx.current = 0;
        waveTimer.current = 0;
        waveSpawned.current = false;
        levelComplete.current = false;
      }
      return; // skip combat during pause
    }

    // Auto-fire
    if (autoFire.current && fireCooldown.current <= 0) {
      const cd = firerateT.current > 0 ? FAST_FIRE_CD : BASE_FIRE_CD;
      const hasDouble = doubleT.current > 0;

      if (rocketAmmo.current > 0) {
        // Find closest enemy for homing
        let closest: Enemy | null = null; let closestD = 999;
        for (const e of enemies.current) {
          if (!e.active) continue;
          const d = Math.abs(e.x - sx) + Math.abs(e.y - sy);
          if (d < closestD) { closestD = d; closest = e; }
        }
        if (closest) {
          const ang = Math.atan2(closest.y - sy, closest.x - sx);
          fireProj(projectiles.current, sx, sy + 0.8, Math.cos(ang) * ROCKET_SPEED, Math.sin(ang) * ROCKET_SPEED, "rocket");
          rocketAmmo.current--;
        } else {
          fireProj(projectiles.current, sx, sy + 0.8, 0, PROJ_SPEED, "bullet");
        }
      } else if (hasDouble) {
        fireProj(projectiles.current, sx - 0.35, sy + 0.5, 0, PROJ_SPEED, "bullet");
        fireProj(projectiles.current, sx + 0.35, sy + 0.5, 0, PROJ_SPEED, "bullet");
      } else {
        fireProj(projectiles.current, sx, sy + 0.8, 0, PROJ_SPEED, "bullet");
      }
      fireCooldown.current = cd;
    }

    // Update projectiles
    for (const p of projectiles.current) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0 || p.y > HALF_H + 2 || p.y < -HALF_H - 2) { p.active = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }

    // Update enemies
    for (const e of enemies.current) {
      if (!e.active) continue;
      e.phaseTimer += dt;
      e.x += e.vx * dt; e.y += e.vy * dt;

      // Bounce off walls
      if (e.x < -HALF_W + e.r) { e.x = -HALF_W + e.r; e.vx = Math.abs(e.vx); }
      if (e.x > HALF_W - e.r) { e.x = HALF_W - e.r; e.vx = -Math.abs(e.vx); }

      // Stop descending past middle area
      const minY = e.type === "boss" ? 4 : 0;
      if (e.y < minY) { e.vy = Math.abs(e.vy) * 0.5; e.y = minY; }

      // Despawn if too far below
      if (e.y < -HALF_H - 5) { e.active = false; continue; }

      // Sinusoidal movement patterns
      if (e.type === "scout" || e.type === "swarm") {
        e.vx = Math.sin(e.phaseTimer * 2 + e.id) * ENEMY_STATS[e.type].speed * 0.5;
      }
      if (e.type === "bomber") {
        e.vx = Math.sin(e.phaseTimer * 1.5 + e.id * 0.7) * 3;
      }

      // Enemy shooting
      const stats = ENEMY_STATS[e.type];
      if (stats.shoots) {
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          const shootInterval = e.type === "boss" ? 0.6 : e.type === "elite" ? 1.0 : 2.0;
          e.shootTimer = shootInterval + rnd(0, 0.5);
          // Fire at ship
          const ang = Math.atan2(sy - e.y, sx - e.x);
          const bspd = e.type === "boss" ? 12 : e.type === "elite" ? 10 : 7;
          for (const b of enemyBullets.current) {
            if (!b.active) {
              b.x = e.x; b.y = e.y - e.r;
              b.vx = Math.cos(ang) * bspd; b.vy = Math.sin(ang) * bspd;
              b.life = 4; b.active = true;
              break;
            }
          }
          // Boss fires spread
          if (e.type === "boss") {
            for (let s = -2; s <= 2; s++) {
              if (s === 0) continue;
              const sa = ang + s * 0.2;
              for (const b of enemyBullets.current) {
                if (!b.active) {
                  b.x = e.x; b.y = e.y - e.r;
                  b.vx = Math.cos(sa) * bspd; b.vy = Math.sin(sa) * bspd;
                  b.life = 4; b.active = true;
                  break;
                }
              }
            }
          }
        }
      }
    }

    // Update enemy bullets
    for (const b of enemyBullets.current) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; continue; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y < -HALF_H - 2 || b.y > HALF_H + 2 || Math.abs(b.x) > HALF_W + 2) b.active = false;
    }

    // Update powerups
    for (const pw of powerups.current) {
      if (!pw.active) continue;
      pw.life += dt;
      pw.y -= 3 * dt; // drift down
      if (pw.y < -HALF_H - 2 || pw.life > 12) { pw.active = false; continue; }
      // Pickup check
      const pdx = pw.x - sx, pdy = pw.y - sy;
      if (Math.sqrt(pdx * pdx + pdy * pdy) < 1.5) {
        pw.active = false;
        shake.current = Math.max(shake.current, .2);
        switch (pw.type) {
          case "firerate": firerateT.current = FIRERATE_DUR; break;
          case "double": doubleT.current = DOUBLE_DUR; break;
          case "rocket": rocketAmmo.current += ROCKET_AMMO; break;
          case "shield": shieldActive.current = true; shieldHits.current = 3; break;
          case "bomb":
            // Kill all enemies on screen
            for (const e of enemies.current) {
              if (e.active) {
                addExplosion(smallExplosions.current, e.x, e.y, ENEMY_STATS[e.type].color);
                scoreRef.current += ENEMY_STATS[e.type].score;
                coinBank.current += Math.floor(ENEMY_STATS[e.type].score / 5);
                e.active = false;
              }
            }
            for (const b of enemyBullets.current) b.active = false;
            shake.current = 2;
            onScore(scoreRef.current); onCoins(coinBank.current);
            break;
        }
      }
    }

    // Collision: player projectiles vs enemies
    for (const p of projectiles.current) {
      if (!p.active) continue;
      for (const e of enemies.current) {
        if (!e.active) continue;
        const dx = p.x - e.x, dy = p.y - e.y;
        const hitR = (p.kind === "rocket" ? ROCKET_HIT_R : PROJ_HIT_R) + e.r * 0.85;
        if (dx * dx + dy * dy < hitR * hitR) {
          p.active = false;
          const dmg = p.kind === "rocket" ? ROCKET_DMG : 1;
          // Shield absorbs first
          if (e.shieldHp > 0) { e.shieldHp -= dmg; shake.current = Math.max(shake.current, .1); }
          else { e.hp -= dmg; }
          if (e.hp <= 0) {
            e.active = false;
            addExplosion(smallExplosions.current, e.x, e.y, ENEMY_STATS[e.type].color);
            // Score + combo
            combo.current++;
            comboTimer.current = 3;
            const mult = Math.min(combo.current, 10);
            const pts = ENEMY_STATS[e.type].score * mult;
            scoreRef.current += pts;
            coinBank.current += Math.max(1, Math.floor(pts / 10));
            onScore(scoreRef.current); onCoins(coinBank.current);
            shake.current = Math.max(shake.current, e.type === "boss" ? 1.5 : .3);
            // Drop powerup (15% chance, higher for bosses)
            const dropChance = e.type === "boss" ? 1.0 : e.type === "elite" ? 0.4 : 0.15;
            if (Math.random() < dropChance) {
              for (const pw of powerups.current) {
                if (!pw.active) {
                  pw.id = ++_pwid; pw.x = e.x; pw.y = e.y;
                  pw.type = PWR_TYPES[Math.floor(Math.random() * PWR_TYPES.length)];
                  pw.life = 0; pw.active = true;
                  break;
                }
              }
            }
          } else {
            shake.current = Math.max(shake.current, .08);
          }
          break;
        }
      }
    }

    // Collision: enemy bullets vs ship
    for (const b of enemyBullets.current) {
      if (!b.active) continue;
      const dx = b.x - sx, dy = b.y - sy;
      if (dx * dx + dy * dy < (SHIP_R + 0.15) * (SHIP_R + 0.15)) {
        b.active = false;
        if (shieldActive.current) {
          shieldHits.current--;
          shake.current = Math.max(shake.current, .5);
          if (shieldHits.current <= 0) shieldActive.current = false;
        } else {
          overRef.current = true; shake.current = 2;
          onGameOver(scoreRef.current, coinBank.current);
          return;
        }
      }
    }

    // Collision: enemies vs ship (body collision)
    for (const e of enemies.current) {
      if (!e.active) continue;
      const dx = e.x - sx, dy = e.y - sy;
      if (dx * dx + dy * dy < (SHIP_R + e.r * 0.7) * (SHIP_R + e.r * 0.7)) {
        if (shieldActive.current) {
          shieldHits.current--;
          e.hp -= 2;
          shake.current = Math.max(shake.current, .8);
          if (shieldHits.current <= 0) shieldActive.current = false;
          if (e.hp <= 0) {
            e.active = false;
            addExplosion(smallExplosions.current, e.x, e.y, ENEMY_STATS[e.type].color);
            scoreRef.current += ENEMY_STATS[e.type].score;
            onScore(scoreRef.current);
          }
        } else {
          overRef.current = true; shake.current = 2;
          onGameOver(scoreRef.current, coinBank.current);
          return;
        }
      }
    }
  });

  return (
    <>
      <color attach="background" args={["#010208"]} />
      <ambientLight intensity={.35} />
      <directionalLight intensity={.65} color="#93c5fd" position={[8, 10, 14]} />
      <directionalLight intensity={.32} color="#f8fafc" position={[-12, -8, 12]} />
      <FixedCam shake={shake} />
      <SpaceBG />
      <Dust />
      <ShooterShip posRef={shipPos} color={sCol} shieldActive={shieldActive} />
      <ProjectileVisuals poolRef={projectiles} color={sCol} />
      <EnemyVisuals poolRef={enemies} />
      <EnemyBulletVisuals poolRef={enemyBullets} />
      <DPowerUpVisuals poolRef={powerups} />
      <SmallExplosions poolRef={smallExplosions} />
      <FX />
    </>
  );
}

function addExplosion(pool: SmallExplosion[], x: number, y: number, color: string) {
  const exp: SmallExplosion = { x, y, t: 0, active: true, color };
  const idx = pool.findIndex(e => !e.active);
  if (idx >= 0) pool[idx] = exp;
  else if (pool.length < 12) pool.push(exp);
}

/* ═══════════════════════════════════════════════════
   Exported levels + scene
   ═══════════════════════════════════════════════════ */

export { LEVELS };

export default function AsteroidDestroyerScene(props: GameProps) {
  return (
    <GameCanvas>
      <DestroyerWorld {...props} />
    </GameCanvas>
  );
}
