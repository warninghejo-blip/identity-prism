import React, { useEffect, useMemo, useRef, useCallback, useState } from "react";
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

type DPwrType = "prism_shield" | "photon_burst" | "quantum_core" | "nebula_bomb" | "nova_rockets";

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

const PLAY_W = 26;
const PLAY_H = 28;
const HALF_W = PLAY_W / 2;
const HALF_H = PLAY_H / 2;
const SHIP_SPEED = 16;
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
  scout:    { hp: 1, speed: 6,  r: 0.6, score: 2,   shoots: false, color: "#44ff66" },
  fighter:  { hp: 2, speed: 7,  r: 0.5, score: 3,   shoots: true,  color: "#ff4466" },
  tank:     { hp: 5, speed: 3.5,r: 1.0, score: 5,   shoots: true,  color: "#ff8800" },
  swarm:    { hp: 1, speed: 9,  r: 0.35,score: 1,   shoots: false, color: "#aaffaa" },
  bomber:   { hp: 3, speed: 4.5,r: 0.8, score: 4,   shoots: true,  color: "#ff44ff" },
  cloaker:  { hp: 2, speed: 6,  r: 0.55,score: 5,   shoots: true,  color: "#8844ff" },
  shielder: { hp: 3, speed: 4,  r: 0.7, score: 5,   shoots: true,  color: "#00ccff" },
  elite:    { hp: 6, speed: 7,  r: 0.65,score: 8,   shoots: true,  color: "#ffcc00" },
  boss:     { hp: 40,speed: 2.5,r: 2.0, score: 40,  shoots: true,  color: "#ff0044" },
};

/* ═══════════════════════════════════════════════════
   9 Levels
   ═══════════════════════════════════════════════════ */

const LEVELS: LevelDef[] = [
  { id: 1, name: "First Contact", bgTint: "#0a0a1a", waves: [
    { delay: 0.5, enemies: [{ type: "scout", count: 8 }] },
    { delay: 2, enemies: [{ type: "scout", count: 10 }] },
  ]},
  { id: 2, name: "Swarm Warning", bgTint: "#0a1a0a", waves: [
    { delay: 0.5, enemies: [{ type: "scout", count: 10 }] },
    { delay: 2, enemies: [{ type: "swarm", count: 16 }] },
    { delay: 2, enemies: [{ type: "scout", count: 8 }, { type: "fighter", count: 3 }] },
  ]},
  { id: 3, name: "Armored Assault", bgTint: "#1a0a0a", waves: [
    { delay: 0.5, enemies: [{ type: "fighter", count: 6 }] },
    { delay: 2.5, enemies: [{ type: "tank", count: 4 }] },
    { delay: 2.5, enemies: [{ type: "fighter", count: 6 }, { type: "tank", count: 3 }] },
  ]},
  { id: 4, name: "Speed Blitz", bgTint: "#0a0a2a", waves: [
    { delay: 0.5, enemies: [{ type: "swarm", count: 22 }] },
    { delay: 2, enemies: [{ type: "fighter", count: 10 }] },
    { delay: 2, enemies: [{ type: "swarm", count: 18 }, { type: "fighter", count: 5 }] },
  ]},
  { id: 5, name: "Bombardment", bgTint: "#1a0a1a", waves: [
    { delay: 0.5, enemies: [{ type: "bomber", count: 6 }] },
    { delay: 2.5, enemies: [{ type: "tank", count: 4 }, { type: "bomber", count: 4 }] },
    { delay: 3, enemies: [{ type: "boss", count: 1 }] },
  ]},
  { id: 6, name: "Phantom Menace", bgTint: "#0a001a", waves: [
    { delay: 0.5, enemies: [{ type: "cloaker", count: 8 }] },
    { delay: 2.5, enemies: [{ type: "cloaker", count: 5 }, { type: "fighter", count: 5 }] },
    { delay: 2.5, enemies: [{ type: "cloaker", count: 10 }, { type: "bomber", count: 3 }] },
  ]},
  { id: 7, name: "Shield Wall", bgTint: "#001a1a", waves: [
    { delay: 0.5, enemies: [{ type: "shielder", count: 6 }] },
    { delay: 2.5, enemies: [{ type: "shielder", count: 5 }, { type: "tank", count: 4 }] },
    { delay: 2.5, enemies: [{ type: "shielder", count: 7 }, { type: "elite", count: 3 }] },
  ]},
  { id: 8, name: "Total War", bgTint: "#1a1a0a", waves: [
    { delay: 0.5, enemies: [{ type: "scout", count: 12 }, { type: "fighter", count: 6 }] },
    { delay: 2.5, enemies: [{ type: "tank", count: 4 }, { type: "cloaker", count: 5 }, { type: "bomber", count: 4 }] },
    { delay: 2.5, enemies: [{ type: "elite", count: 5 }, { type: "shielder", count: 4 }] },
    { delay: 3, enemies: [{ type: "boss", count: 1 }, { type: "elite", count: 3 }] },
  ]},
  { id: 9, name: "Final Stand", bgTint: "#1a0000", waves: [
    { delay: 0.5, enemies: [{ type: "swarm", count: 24 }, { type: "fighter", count: 10 }] },
    { delay: 3, enemies: [{ type: "elite", count: 8 }, { type: "shielder", count: 5 }] },
    { delay: 3, enemies: [{ type: "tank", count: 5 }, { type: "bomber", count: 5 }, { type: "cloaker", count: 5 }] },
    { delay: 3, enemies: [{ type: "boss", count: 2 }, { type: "elite", count: 5 }] },
  ]},
];

const PWR_TYPES: DPwrType[] = ["quantum_core", "photon_burst", "nova_rockets", "prism_shield", "nebula_bomb"];
const PWR_COLORS: Record<DPwrType, string> = {
  quantum_core: "#ffcc00", photon_burst: "#00ffcc", nova_rockets: "#ff4444", prism_shield: "#22d3ee", nebula_bomb: "#ff66ff",
};
const PWR_LABELS: Record<DPwrType, string> = {
  quantum_core: "RAPID FIRE", photon_burst: "DUAL SHOT", nova_rockets: "HOMING", prism_shield: "SHIELD", nebula_bomb: "NUKE",
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
    id: ++_eid, x: ex, y: HALF_H + s.r + rnd(1, 3),
    vx: rnd(-1, 1) * s.speed * 0.3, vy: -s.speed * rnd(0.7, 1.0),
    hp: s.hp, maxHp: s.hp, type, active: true,
    shootTimer: rnd(0.5, 2), phaseTimer: 0,
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
   Enemy visuals — unique model per type
   ═══════════════════════════════════════════════════ */

function EnemyModel({ type }: { type: EnemyType }) {
  const s = ENEMY_STATS[type];
  const c = s.color;
  switch (type) {
    case "scout": return (<>
      {/* Arrow/dart shape */}
      <mesh rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.5, 1.2, 3]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.8} metalness={0.6} roughness={0.3} /></mesh>
      <mesh position={[0, 0.2, 0]}><sphereGeometry args={[0.15, 8, 8]} /><meshStandardMaterial color="#fff" emissive={c} emissiveIntensity={2} toneMapped={false} /></mesh>
    </>);
    case "fighter": return (<>
      {/* X-wing style */}
      <mesh><boxGeometry args={[0.3, 0.9, 0.2]} /><meshStandardMaterial color="#aa2233" emissive={c} emissiveIntensity={0.5} metalness={0.8} roughness={0.2} /></mesh>
      <mesh position={[0.5, 0, 0]} rotation={[0, 0, 0.4]}><boxGeometry args={[0.7, 0.08, 0.12]} /><meshStandardMaterial color="#cc3344" metalness={0.7} roughness={0.2} /></mesh>
      <mesh position={[-0.5, 0, 0]} rotation={[0, 0, -0.4]}><boxGeometry args={[0.7, 0.08, 0.12]} /><meshStandardMaterial color="#cc3344" metalness={0.7} roughness={0.2} /></mesh>
      <mesh position={[0, -0.3, 0]}><sphereGeometry args={[0.12, 8, 8]} /><meshStandardMaterial color="#ff6644" emissive="#ff4422" emissiveIntensity={3} toneMapped={false} /></mesh>
    </>);
    case "tank": return (<>
      {/* Heavy armored hexagon */}
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.9, 0.9, 0.4, 6]} /><meshStandardMaterial color="#885500" emissive={c} emissiveIntensity={0.4} metalness={0.9} roughness={0.1} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.6, 0.6, 0.5, 6]} /><meshStandardMaterial color="#aa6600" emissive={c} emissiveIntensity={0.6} metalness={0.85} roughness={0.15} /></mesh>
      <mesh position={[0, -0.5, 0]}><boxGeometry args={[0.15, 0.6, 0.1]} /><meshStandardMaterial color="#666" metalness={0.9} roughness={0.1} /></mesh>
    </>);
    case "swarm": return (<>
      {/* Tiny glowing orb */}
      <mesh><sphereGeometry args={[0.5, 8, 8]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.5} toneMapped={false} transparent opacity={0.85} /></mesh>
    </>);
    case "bomber": return (<>
      {/* Fat round body with bomb rack */}
      <mesh><sphereGeometry args={[0.7, 12, 12]} /><meshStandardMaterial color="#993399" emissive={c} emissiveIntensity={0.5} metalness={0.6} roughness={0.3} /></mesh>
      <mesh position={[-0.35, -0.5, 0]}><sphereGeometry args={[0.15, 6, 6]} /><meshStandardMaterial color="#ff44ff" emissive="#ff22ff" emissiveIntensity={2} toneMapped={false} /></mesh>
      <mesh position={[0.35, -0.5, 0]}><sphereGeometry args={[0.15, 6, 6]} /><meshStandardMaterial color="#ff44ff" emissive="#ff22ff" emissiveIntensity={2} toneMapped={false} /></mesh>
    </>);
    case "cloaker": return (<>
      {/* Sleek diamond stealth */}
      <mesh><octahedronGeometry args={[0.6, 0]} /><meshStandardMaterial color="#442288" emissive={c} emissiveIntensity={0.8} metalness={0.9} roughness={0.05} transparent /></mesh>
    </>);
    case "shielder": return (<>
      {/* Hexagon body + protective ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.6, 0.6, 0.3, 6]} /><meshStandardMaterial color="#006688" emissive={c} emissiveIntensity={0.6} metalness={0.7} roughness={0.2} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.85, 0.06, 8, 6]} /><meshBasicMaterial color={c} transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </>);
    case "elite": return (<>
      {/* Crystal star */}
      <mesh><octahedronGeometry args={[0.55, 0]} /><meshStandardMaterial color="#ccaa00" emissive={c} emissiveIntensity={1.2} metalness={0.95} roughness={0.05} toneMapped={false} /></mesh>
      <mesh rotation={[0, 0, Math.PI / 4]}><octahedronGeometry args={[0.55, 0]} /><meshStandardMaterial color="#ffdd33" emissive={c} emissiveIntensity={0.8} metalness={0.9} roughness={0.1} transparent opacity={0.5} toneMapped={false} /></mesh>
    </>);
    case "boss": return (<>
      {/* Large multi-part octagonal warship */}
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.8, 1.0, 0.35, 8]} /><meshStandardMaterial color="#880022" emissive={c} emissiveIntensity={0.6} metalness={0.85} roughness={0.15} /></mesh>
      <mesh position={[0, 0.25, 0]}><sphereGeometry args={[0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#ff2244" emissive="#ff0033" emissiveIntensity={1.5} toneMapped={false} transparent opacity={0.9} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.05, 0.05, 8, 8]} /><meshBasicMaterial color="#ff4444" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
      <mesh position={[0.7, -0.2, 0]}><boxGeometry args={[0.5, 0.12, 0.12]} /><meshStandardMaterial color="#662222" metalness={0.9} roughness={0.1} /></mesh>
      <mesh position={[-0.7, -0.2, 0]}><boxGeometry args={[0.5, 0.12, 0.12]} /><meshStandardMaterial color="#662222" metalness={0.9} roughness={0.1} /></mesh>
    </>);
  }
}

function EnemyVisuals({ poolRef }: { poolRef: React.MutableRefObject<Enemy[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const hpBarRefs = useRef<(THREE.Mesh | null)[]>([]);
  const typeCache = useRef<(EnemyType | null)[]>(new Array(MAX_ENEMIES).fill(null));

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
      g.scale.setScalar(e.r);
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
        (hpBar.material as THREE.MeshBasicMaterial).color.set(e.hp / e.maxHp > 0.5 ? "#44ff44" : e.hp / e.maxHp > 0.25 ? "#ffaa00" : "#ff2222");
      } else if (hpBar) {
        hpBar.visible = false;
      }
    }
  });

  return (<>{Array.from({ length: MAX_ENEMIES }).map((_, i) => (
    <group key={i} ref={el => { refs.current[i] = el; }} visible={false}>
      <EnemyModelSlot index={i} poolRef={poolRef} />
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

function EnemyModelSlot({ index, poolRef }: { index: number; poolRef: React.MutableRefObject<Enemy[]> }) {
  const [currentType, setCurrentType] = useState<EnemyType>("scout");
  const lastType = useRef<EnemyType>("scout");
  useFrame(() => {
    const e = poolRef.current[index];
    if (e && e.active && e.type !== lastType.current) {
      lastType.current = e.type;
      setCurrentType(e.type);
    }
  });
  return <EnemyModel type={currentType} />;
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
   PowerUp drop visuals — distinct shape per type
   ═══════════════════════════════════════════════════ */

function PowerUpShape({ type }: { type: DPwrType }) {
  const c = PWR_COLORS[type];
  switch (type) {
    case "prism_shield": return (<>
      <mesh><icosahedronGeometry args={[0.4, 0]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={2} toneMapped={false} transparent opacity={0.7} metalness={0.8} roughness={0.1} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.55, 0.04, 8, 16]} /><meshBasicMaterial color={c} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </>);
    case "photon_burst": return (<>
      <mesh position={[-0.15, 0, 0]}><coneGeometry args={[0.15, 0.5, 8]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={2.5} toneMapped={false} /></mesh>
      <mesh position={[0.15, 0, 0]}><coneGeometry args={[0.15, 0.5, 8]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={2.5} toneMapped={false} /></mesh>
      <mesh><sphereGeometry args={[0.12, 8, 8]} /><meshBasicMaterial color="#fff" transparent opacity={0.8} blending={THREE.AdditiveBlending} /></mesh>
    </>);
    case "quantum_core": return (<>
      <mesh rotation={[0.6, 0.6, 0]}><boxGeometry args={[0.45, 0.45, 0.45]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={2} toneMapped={false} metalness={0.9} roughness={0.05} /></mesh>
      <mesh rotation={[0.6, 0.6, Math.PI / 4]}><boxGeometry args={[0.45, 0.45, 0.45]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={1} toneMapped={false} transparent opacity={0.4} /></mesh>
    </>);
    case "nebula_bomb": return (<>
      <mesh><sphereGeometry args={[0.35, 12, 12]} /><meshStandardMaterial color="#cc44cc" emissive={c} emissiveIntensity={2} toneMapped={false} /></mesh>
      <mesh><sphereGeometry args={[0.5, 8, 4]} /><meshBasicMaterial color={c} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} wireframe /></mesh>
    </>);
    case "nova_rockets": return (<>
      <mesh rotation={[0, 0, 0.3]}><coneGeometry args={[0.12, 0.6, 6]} /><meshStandardMaterial color="#cc2222" emissive={c} emissiveIntensity={1.5} toneMapped={false} metalness={0.8} roughness={0.1} /></mesh>
      <mesh position={[0, -0.35, 0]}><sphereGeometry args={[0.08, 6, 6]} /><meshStandardMaterial color="#ff8844" emissive="#ff6622" emissiveIntensity={4} toneMapped={false} /></mesh>
    </>);
  }
}

function DPowerUpVisuals({ poolRef }: { poolRef: React.MutableRefObject<DPowerUp[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const [types, setTypes] = useState<DPwrType[]>(new Array(MAX_POWERUPS).fill("prism_shield"));
  const lastTypes = useRef<DPwrType[]>(new Array(MAX_POWERUPS).fill("prism_shield"));

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    let needsUpdate = false;
    for (let i = 0; i < MAX_POWERUPS; i++) {
      const g = refs.current[i]; const pw = poolRef.current[i];
      if (!g) continue;
      if (!pw || !pw.active) { g.visible = false; continue; }
      g.visible = true;
      g.position.set(pw.x, pw.y, 0);
      g.rotation.y = t * 2.5;
      g.scale.setScalar(0.9 + Math.sin(t * 3 + i) * 0.12);
      if (pw.type !== lastTypes.current[i]) {
        lastTypes.current[i] = pw.type;
        needsUpdate = true;
      }
    }
    if (needsUpdate) setTypes([...lastTypes.current]);
  });

  return (<>{Array.from({ length: MAX_POWERUPS }).map((_, i) => (
    <group key={i} ref={el => { refs.current[i] = el; }} visible={false}>
      <PowerUpShape type={types[i]} />
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

function DestroyerWorld({ gameState, onGameOver, onScore, onCoins, traits, hasMintedId }: GameProps) {
  const scoreMult = hasMintedId ? 2 : 1;
  // Ship state
  const shipPos = useRef({ x: 0, y: -HALF_H + 4 });
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
    shipPos.current = { x: 0, y: -HALF_H + 4 };
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
        scoreRef.current += 50 * scoreMult; // completion bonus
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
        // Spawn this wave — stagger positions across the top
        for (const eg of wave.enemies) {
          const spacing = (PLAY_W - 4) / Math.max(1, eg.count);
          for (let j = 0; j < eg.count; j++) {
            const slot = enemies.current.find(e => !e.active);
            if (slot) {
              const spawned = spawnEnemy(eg.type);
              // Spread across top evenly with some randomness
              spawned.x = -HALF_W + 2 + spacing * (j + 0.5) + rnd(-1, 1);
              spawned.y = HALF_H + spawned.r + rnd(0.5, 3);
              Object.assign(slot, spawned);
            }
          }
        }
        waveSpawned.current = true;
      }
      // Check if all enemies from this wave are cleared (dead or off-screen)
      if (waveSpawned.current) {
        const alive = enemies.current.some(e => e.active);
        if (!alive) {
          waveIdx.current++;
          waveSpawned.current = false;
          waveTimer.current = 0;
          if (waveIdx.current >= lvl.waves.length) {
            levelComplete.current = true;
            levelPause.current = 0.3;
            const bonus = lvl.id * 5 * scoreMult;
            scoreRef.current += bonus;
            coinBank.current += lvl.id * 2 * scoreMult;
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
      return;
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
      const stats = ENEMY_STATS[e.type];

      // Homing: steer toward player
      const toPlayerX = sx - e.x;
      const toPlayerY = sy - e.y;
      const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY);

      if (e.type === "scout" || e.type === "swarm") {
        // Descend steadily + sinusoidal weave
        e.vy = -stats.speed * 0.7;
        e.vx = Math.sin(e.phaseTimer * 2.5 + e.id) * stats.speed * 0.6;
      } else if (e.type === "fighter" || e.type === "elite" || e.type === "cloaker") {
        // Active homing toward player
        if (distToPlayer > 0.5) {
          const nx = toPlayerX / distToPlayer, ny = toPlayerY / distToPlayer;
          e.vx += nx * stats.speed * 2 * dt;
          e.vy += ny * stats.speed * 1.5 * dt;
        }
        const spd = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
        if (spd > stats.speed) { e.vx *= stats.speed / spd; e.vy *= stats.speed / spd; }
      } else if (e.type === "bomber") {
        e.vy = -stats.speed * 0.6;
        e.vx = Math.sin(e.phaseTimer * 1.5 + e.id * 0.7) * 4;
      } else if (e.type === "tank" || e.type === "shielder") {
        // Slow descent, slight tracking
        e.vy = -stats.speed * 0.65;
        e.vx += (toPlayerX > 0 ? 1 : -1) * stats.speed * 0.5 * dt;
        e.vx = clamp(e.vx, -stats.speed * 0.5, stats.speed * 0.5);
      } else if (e.type === "boss") {
        // Boss hovers in upper area, tracks X
        const targetY = HALF_H * 0.35;
        if (e.y > targetY) e.vy = -stats.speed;
        else { e.vy = Math.sin(e.phaseTimer * 0.5) * 1.5; }
        e.vx += (toPlayerX > 0 ? 1 : -1) * 3 * dt;
        e.vx = clamp(e.vx, -4, 4);
      }

      e.x += e.vx * dt; e.y += e.vy * dt;

      // Bounce off walls
      if (e.x < -HALF_W + e.r) { e.x = -HALF_W + e.r; e.vx = Math.abs(e.vx); }
      if (e.x > HALF_W - e.r) { e.x = HALF_W - e.r; e.vx = -Math.abs(e.vx); }

      // Despawn if too far below screen
      if (e.y < -HALF_H - 4) { e.active = false; continue; }

      // Enemy shooting
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
          case "quantum_core": firerateT.current = FIRERATE_DUR; break;
          case "photon_burst": doubleT.current = DOUBLE_DUR; break;
          case "nova_rockets": rocketAmmo.current += ROCKET_AMMO; break;
          case "prism_shield": shieldActive.current = true; shieldHits.current = 3; break;
          case "nebula_bomb":
            // Kill all enemies on screen
            for (const e of enemies.current) {
              if (e.active) {
                addExplosion(smallExplosions.current, e.x, e.y, ENEMY_STATS[e.type].color);
                scoreRef.current += ENEMY_STATS[e.type].score * scoreMult;
                coinBank.current += Math.max(1, Math.floor(ENEMY_STATS[e.type].score * scoreMult / 5));
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
            const mult = Math.min(combo.current, 3);
            const pts = ENEMY_STATS[e.type].score * mult * scoreMult;
            scoreRef.current += pts;
            coinBank.current += Math.max(1, Math.floor(pts / 5));
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
            scoreRef.current += ENEMY_STATS[e.type].score * scoreMult;
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
