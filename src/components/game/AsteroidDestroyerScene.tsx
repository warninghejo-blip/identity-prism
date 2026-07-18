import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import {
  type GameProps,
  type SmallExplosion,
  IS_MOBILE,
  CAM_Z,
  TIER_COLORS,
  rnd,
  clamp,
  slerp,
  SpaceBG,
  Dust,
  SmallExplosions,
  FX,
  GameCanvas,
  AURA_GAME_COLORS,
  DEFAULT_SHIP_COLORS,
} from './GameShared';
import { getShipProfile } from '@/lib/shipProfiles';
import {
  sfxShoot,
  sfxShootDouble,
  sfxShootRocket,
  sfxEnemyDestroy,
  sfxExplosion,
  sfxShield,
  sfxPickup,
  sfxNuke,
  sfxLevelUp,
  sfxBossAppear,
  sfxVictory,
} from '@/lib/gameAudio';

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  active: boolean;
  kind: 'bullet' | 'rocket';
}

type EnemyType =
  | 'scout'
  | 'fighter'
  | 'tank'
  | 'swarm'
  | 'bomber'
  | 'cloaker'
  | 'shielder'
  | 'elite'
  | 'boss1'
  | 'boss2'
  | 'boss3'
  | 'boss4';
const isBoss = (t: EnemyType) => t === 'boss1' || t === 'boss2' || t === 'boss3' || t === 'boss4';

interface Enemy {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  type: EnemyType;
  active: boolean;
  dying: number; // fade-out timer (>0 = dying, visually fading)
  shootTimer: number;
  phaseTimer: number;
  shieldHp: number;
  cloakAlpha: number;
  hitFlash: number; // >0 = flash white briefly on hit
  r: number;
  rx: number;
  ry: number;
  rz: number;
  cascadeTimer: number;
  enraged: boolean;
}

interface EnemyBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
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

type DPwrType = 'prism_shield' | 'photon_burst' | 'quantum_core' | 'nebula_bomb' | 'nova_rockets';

interface DPowerUp {
  id: number;
  x: number;
  y: number;
  type: DPwrType;
  life: number;
  active: boolean;
}

/* ═══════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════ */

const PLAY_W = 18; // narrower — mobile-like on desktop too
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
const FAST_FIRE_CD = 0.1;
const DOUBLE_DUR = 12;
const FIRERATE_DUR = 10;
const ROCKET_AMMO = 6;

const MAX_ENEMIES = 60;
const MAX_ENEMY_BULLETS = 80;
const MAX_POWERUPS = 4;

const ENEMY_STATS: Record<
  EnemyType,
  { hp: number; speed: number; r: number; score: number; shoots: boolean; color: string }
> = {
  scout: { hp: 1, speed: 6, r: 0.85, score: 2, shoots: false, color: '#44ff66' },
  fighter: { hp: 2, speed: 7, r: 0.8, score: 3, shoots: true, color: '#ff4466' },
  tank: { hp: 5, speed: 3.5, r: 1.1, score: 5, shoots: true, color: '#ff8800' },
  swarm: { hp: 1, speed: 9, r: 0.65, score: 1, shoots: false, color: '#aaffaa' },
  bomber: { hp: 3, speed: 4.5, r: 0.9, score: 4, shoots: true, color: '#ff44ff' },
  cloaker: { hp: 2, speed: 6, r: 0.8, score: 5, shoots: true, color: '#8844ff' },
  shielder: { hp: 3, speed: 4, r: 0.85, score: 5, shoots: true, color: '#00ccff' },
  elite: { hp: 6, speed: 7, r: 0.85, score: 8, shoots: true, color: '#ffcc00' },
  boss1: { hp: 40, speed: 2.5, r: 2.0, score: 120, shoots: true, color: '#4488ff' },
  boss2: { hp: 60, speed: 3.0, r: 1.8, score: 200, shoots: true, color: '#aa44ff' },
  boss3: { hp: 80, speed: 2.0, r: 2.2, score: 300, shoots: true, color: '#ff4422' },
  boss4: { hp: 100, speed: 2.5, r: 1.9, score: 500, shoots: true, color: '#22ffaa' },
};

/* ═══════════════════════════════════════════════════
   4 Levels × (3 waves + unique boss)
   ═══════════════════════════════════════════════════ */

const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: 'Outer Rim',
    bgTint: '#0a0a1a',
    waves: [
      { delay: 0.5, enemies: [{ type: 'scout', count: 8 }] },
      {
        delay: 1.5,
        enemies: [
          { type: 'scout', count: 6 },
          { type: 'swarm', count: 8 },
        ],
      },
      {
        delay: 1.5,
        enemies: [
          { type: 'fighter', count: 4 },
          { type: 'scout', count: 6 },
        ],
      },
      { delay: 2, enemies: [{ type: 'boss1', count: 1 }] },
    ],
  },
  {
    id: 2,
    name: 'Nebula Front',
    bgTint: '#0a1a1a',
    waves: [
      {
        delay: 0.5,
        enemies: [
          { type: 'fighter', count: 5 },
          { type: 'swarm', count: 10 },
        ],
      },
      {
        delay: 1.5,
        enemies: [
          { type: 'bomber', count: 4 },
          { type: 'tank', count: 3 },
        ],
      },
      {
        delay: 1.5,
        enemies: [
          { type: 'cloaker', count: 4 },
          { type: 'fighter', count: 4 },
        ],
      },
      {
        delay: 2,
        enemies: [
          { type: 'boss2', count: 1 },
          { type: 'fighter', count: 2 },
        ],
      },
    ],
  },
  {
    id: 3,
    name: 'Dark Sector',
    bgTint: '#1a0a1a',
    waves: [
      {
        delay: 0.5,
        enemies: [
          { type: 'shielder', count: 4 },
          { type: 'cloaker', count: 4 },
        ],
      },
      {
        delay: 1.5,
        enemies: [
          { type: 'elite', count: 3 },
          { type: 'bomber', count: 4 },
        ],
      },
      {
        delay: 1.5,
        enemies: [
          { type: 'tank', count: 4 },
          { type: 'shielder', count: 3 },
          { type: 'fighter', count: 3 },
        ],
      },
      {
        delay: 2,
        enemies: [
          { type: 'boss3', count: 1 },
          { type: 'elite', count: 2 },
        ],
      },
    ],
  },
  {
    id: 4,
    name: 'Final Stand',
    bgTint: '#1a0000',
    waves: [
      {
        delay: 0.5,
        enemies: [
          { type: 'elite', count: 5 },
          { type: 'cloaker', count: 4 },
        ],
      },
      {
        delay: 1.5,
        enemies: [
          { type: 'shielder', count: 4 },
          { type: 'bomber', count: 4 },
          { type: 'tank', count: 3 },
        ],
      },
      {
        delay: 1.5,
        enemies: [
          { type: 'elite', count: 4 },
          { type: 'shielder', count: 3 },
          { type: 'cloaker', count: 3 },
        ],
      },
      {
        delay: 2.5,
        enemies: [
          { type: 'boss4', count: 1 },
          { type: 'elite', count: 3 },
        ],
      },
    ],
  },
];

const PWR_TYPES: DPwrType[] = ['quantum_core', 'photon_burst', 'nova_rockets', 'prism_shield', 'nebula_bomb'];
const PWR_COLORS: Record<DPwrType, string> = {
  quantum_core: '#ffcc00',
  photon_burst: '#44ff44',
  nova_rockets: '#ff4444',
  prism_shield: '#4488ff',
  nebula_bomb: '#ff66ff',
};
const _PWR_LABELS: Record<DPwrType, string> = {
  quantum_core: 'RAPID FIRE',
  photon_burst: 'DUAL SHOT',
  nova_rockets: 'HOMING',
  prism_shield: 'SHIELD',
  nebula_bomb: 'NUKE',
};

/* ═══════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════ */

let _eid = 0;
const resetEid = () => {
  _eid = 0;
};
let _pwid = 0;
const resetPwid = () => {
  _pwid = 0;
};

function spawnEnemy(type: EnemyType, x?: number, _levelIdx = 0): Enemy {
  const s = ENEMY_STATS[type];
  const ex = x ?? rnd(-HALF_W + 2, HALF_W - 2);
  const hp = s.hp;
  return {
    id: ++_eid,
    x: ex,
    y: HALF_H + s.r + rnd(1, 3),
    vx: rnd(-1, 1) * s.speed * 0.3,
    vy: -s.speed * rnd(0.7, 1.0),
    hp,
    maxHp: hp,
    type,
    active: true,
    dying: 0,
    shootTimer: rnd(0.5, 2),
    phaseTimer: 0,
    shieldHp: type === 'shielder' ? 3 : type === 'boss4' ? 5 : 0,
    cloakAlpha: type === 'cloaker' ? 0.15 : 1,
    hitFlash: 0,
    r: s.r,
    rx: 0,
    ry: 0,
    rz: rnd(0, 6.28),
    cascadeTimer: 0,
    enraged: false,
  };
}

function fireProj(
  pool: Projectile[],
  x: number,
  y: number,
  vx: number,
  vy: number,
  kind: 'bullet' | 'rocket' = 'bullet',
): boolean {
  for (const p of pool) {
    if (!p.active) {
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.life = kind === 'rocket' ? 2.2 : PROJ_LIFE;
      p.active = true;
      p.kind = kind;
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
      const m = refs.current[i];
      const g = glowRefs.current[i];
      const p = poolRef.current[i];
      if (!m || !g) continue;
      if (!p || !p.active) {
        m.visible = false;
        g.visible = false;
        continue;
      }
      m.visible = true;
      g.visible = true;
      m.position.set(p.x, p.y, 0);
      g.position.set(p.x, p.y, 0);
      const isRocket = p.kind === 'rocket';
      const fade = Math.min(1, p.life * 4);
      const sc = isRocket ? 1.6 : 1;
      m.scale.setScalar(sc);
      (m.material as THREE.MeshBasicMaterial).color.set(isRocket ? '#ff4444' : color);
      (m.material as THREE.MeshBasicMaterial).opacity = fade;
      g.scale.setScalar((isRocket ? 2.2 : 1) * (1 + Math.sin(t * 8 + i * 2) * 0.15));
      (g.material as THREE.MeshBasicMaterial).color.set(isRocket ? '#ff6622' : color);
      (g.material as THREE.MeshBasicMaterial).opacity = fade * 0.3 * (0.7 + Math.sin(t * 12 + i) * 0.3);
    }
  });
  return (
    <>
      {Array.from({ length: MAX_PROJECTILES }).map((_, i) => (
        <React.Fragment key={i}>
          <mesh
            ref={(el) => {
              refs.current[i] = el;
            }}
            visible={false}
          >
            <capsuleGeometry args={[0.06, 0.2, 6, 8]} />
            <meshBasicMaterial color={color} transparent opacity={1} />
          </mesh>
          <mesh
            ref={(el) => {
              glowRefs.current[i] = el;
            }}
            visible={false}
          >
            <sphereGeometry args={[0.22, 10, 10]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </React.Fragment>
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Enemy textures — sprite-based (huge perf win over 3D models)
   ═══════════════════════════════════════════════════ */

const ENEMY_TEX_PATHS: Record<EnemyType, string> = {
  scout: '/textures/enemies/enemy_scout.png',
  fighter: '/textures/enemies/enemy_fighter.png',
  tank: '/textures/enemies/enemy_tank.png',
  swarm: '/textures/enemies/enemy_swarm.png',
  bomber: '/textures/enemies/enemy_bomber.png',
  cloaker: '/textures/enemies/enemy_cloaker.png',
  shielder: '/textures/enemies/enemy_shielder.png',
  elite: '/textures/enemies/enemy_elite.png',
  boss1: '/textures/enemies/enemy_boss1.png',
  boss2: '/textures/enemies/enemy_boss2.png',
  boss3: '/textures/enemies/enemy_boss3.png',
  boss4: '/textures/enemies/enemy_boss4.png',
};

const ENEMY_SPRITE_SCALE: Record<EnemyType, number> = {
  scout: 1.7,
  fighter: 1.9,
  tank: 2.5,
  swarm: 1.2,
  bomber: 2.2,
  cloaker: 1.9,
  shielder: 2.1,
  elite: 2.2,
  boss1: 3.8,
  boss2: 3.4,
  boss3: 4.0,
  boss4: 3.6,
};

const ENEMY_TYPE_LIST: EnemyType[] = [
  'scout',
  'fighter',
  'tank',
  'swarm',
  'bomber',
  'cloaker',
  'shielder',
  'elite',
  'boss1',
  'boss2',
  'boss3',
  'boss4',
];

// Shared plane geometry for enemy sprites (reused across all enemies)
const _enemyPlaneGeo = new THREE.PlaneGeometry(1, 1);

function EnemyVisuals({
  poolRef,
  shipPos,
}: {
  poolRef: React.MutableRefObject<Enemy[]>;
  shipPos: React.MutableRefObject<{ x: number; y: number }>;
}) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const spriteRefs = useRef<(THREE.Mesh | null)[]>([]);
  const shadowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const hpBarBgRefs = useRef<(THREE.Mesh | null)[]>([]);
  const hpBarRefs = useRef<(THREE.Mesh | null)[]>([]);
  const shieldFxRefs = useRef<(THREE.Mesh | null)[]>([]);
  const cloakFxRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lastTypes = useRef<(EnemyType | null)[]>(Array(MAX_ENEMIES).fill(null));

  // Preload all enemy textures
  const texMap = useRef<Record<string, THREE.Texture>>({});
  const allTexPaths = useMemo(() => ENEMY_TYPE_LIST.map((t) => ENEMY_TEX_PATHS[t]), []);
  const allTextures = useLoader(THREE.TextureLoader, allTexPaths);
  useMemo(() => {
    for (let i = 0; i < ENEMY_TYPE_LIST.length; i++) {
      const tex = allTextures[i];
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      texMap.current[ENEMY_TYPE_LIST[i]] = tex;
    }
  }, [allTextures]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const sp = shipPos.current;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const g = refs.current[i];
      const e = poolRef.current[i];
      const sprite = spriteRefs.current[i];
      const shadow = shadowRefs.current[i];
      const glow = glowRefs.current[i];
      const hpBar = hpBarRefs.current[i];
      const hpBg = hpBarBgRefs.current[i];
      if (!g) continue;
      if (!e || !e.active) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      g.position.set(e.x, e.y, 0);

      // Swap texture if type changed
      if (e.type !== lastTypes.current[i]) {
        lastTypes.current[i] = e.type;
        const tex = texMap.current[e.type];
        if (sprite) {
          const m = sprite.material as THREE.MeshBasicMaterial;
          m.map = tex;
          m.needsUpdate = true;
        }
        if (shadow) {
          const m = shadow.material as THREE.MeshBasicMaterial;
          m.map = tex;
          m.needsUpdate = true;
        }
        if (glow) {
          const m = glow.material as THREE.MeshBasicMaterial;
          m.map = tex;
          m.needsUpdate = true;
        }
        // Scale sprite to match type
        const ss = ENEMY_SPRITE_SCALE[e.type] || 1.8;
        if (sprite) sprite.scale.set(ss, ss, 1);
        if (shadow) shadow.scale.set(ss, ss, 1);
        if (glow) glow.scale.set(ss * 1.08, ss * 1.08, 1);
      }

      // Dying fade-out: shrink and fade (boss=0.6s dramatic, others=0.25s)
      const dyingMax = isBoss(e.type) ? 0.6 : 0.25;
      const dyingPct = e.dying > 0 ? Math.min(1, Math.max(0, e.dying / dyingMax)) : 1;
      g.scale.setScalar(e.r * dyingPct);
      const baseOp = e.type === 'cloaker' && e.dying <= 0 ? e.cloakAlpha : e.dying > 0 ? dyingPct : 1;
      if (sprite) (sprite.material as THREE.MeshBasicMaterial).opacity = baseOp;
      if (shadow) (shadow.material as THREE.MeshBasicMaterial).opacity = baseOp * 0.12;
      if (glow) (glow.material as THREE.MeshBasicMaterial).opacity = baseOp * 0.18;

      // Hit flash: brief white flash
      if (e.hitFlash > 0) {
        if (sprite)
          (sprite.material as THREE.MeshBasicMaterial).color.setRGB(
            1 + e.hitFlash * 2,
            1 + e.hitFlash * 2,
            1 + e.hitFlash * 2,
          );
      } else {
        if (sprite) (sprite.material as THREE.MeshBasicMaterial).color.setRGB(1, 1, 1);
      }

      // Rotation: homing types face player, others face strictly down (PI)
      const isHoming = e.type === 'fighter' || e.type === 'elite' || e.type === 'cloaker';
      if (isHoming) {
        e.rz = Math.atan2(sp.y - e.y, sp.x - e.x) - Math.PI / 2;
      } else {
        e.rz = Math.PI;
      }
      g.rotation.z = e.rz;

      // Shielder: visible shield bubble when shieldHp > 0
      const shFx = shieldFxRefs.current[i];
      if (shFx) {
        if ((e.type === 'shielder' || e.type === 'boss4') && e.shieldHp > 0 && e.dying <= 0) {
          shFx.visible = true;
          const invR = 1 / Math.max(e.r, 0.1);
          const pulse = 1.0 + Math.sin(t * 4 + i) * 0.08;
          shFx.scale.set(invR * pulse * 1.4, invR * pulse * 1.4, 1);
          shFx.rotation.z = -e.rz; // counteract parent rotation
          (shFx.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(t * 3) * 0.1;
        } else {
          shFx.visible = false;
        }
      }
      // Cloaker: distortion ring
      const clFx = cloakFxRefs.current[i];
      if (clFx) {
        if (e.type === 'cloaker' && e.dying <= 0) {
          clFx.visible = true;
          const invR = 1 / Math.max(e.r, 0.1);
          clFx.scale.set(invR * 1.3, invR * 1.3, 1);
          clFx.rotation.z = t * 1.5 - e.rz;
          (clFx.material as THREE.MeshBasicMaterial).opacity = baseOp * 0.4;
        } else {
          clFx.visible = false;
        }
      }

      // HP bar — boss, tank, elite (counteract parent group scale)
      const bossEnemy = isBoss(e.type);
      const showHp = bossEnemy || e.type === 'tank' || e.type === 'elite';
      if (hpBar && hpBg) {
        if (showHp && e.dying <= 0) {
          hpBg.visible = true;
          hpBar.visible = true;
          const pct = Math.max(0.01, e.hp / e.maxHp);
          const invR = 1 / Math.max(e.r, 0.1);
          const barW = bossEnemy ? 1.6 : 1.0;
          const yOff = bossEnemy ? -2.6 : -1.5;
          const localY = yOff * invR;
          hpBg.scale.set(barW * invR, invR, 1);
          hpBg.position.set(0, localY, 0.5);
          hpBar.scale.set(pct * barW * invR, invR * 0.85, 1);
          hpBar.position.set(-(1 - pct) * 1.2 * barW * invR, localY, 0.51);
          const col = pct > 0.5 ? '#00ffaa' : pct > 0.25 ? '#ffaa00' : '#ff2244';
          (hpBar.material as THREE.MeshBasicMaterial).color.set(col);
        } else {
          hpBg.visible = false;
          hpBar.visible = false;
        }
      }
    }
  });

  return (
    <>
      {Array.from({ length: MAX_ENEMIES }).map((_, i) => (
        <group
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          visible={false}
        >
          {/* Bottom rim-light for 3D depth (no shadows in space) */}
          <mesh
            ref={(el) => {
              shadowRefs.current[i] = el;
            }}
            geometry={_enemyPlaneGeo}
            position={[0, -0.06, -0.04]}
          >
            <meshBasicMaterial
              transparent
              depthWrite={false}
              color="#4488cc"
              opacity={0.12}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          {/* Main sprite */}
          <mesh
            ref={(el) => {
              spriteRefs.current[i] = el;
            }}
            geometry={_enemyPlaneGeo}
            position={[0, 0, 0.02]}
          >
            <meshBasicMaterial transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
          {/* Rim glow — bright edge overlay for volume */}
          <mesh
            ref={(el) => {
              glowRefs.current[i] = el;
            }}
            geometry={_enemyPlaneGeo}
            position={[0, 0.02, 0.04]}
            scale={[1.08, 1.08, 1]}
          >
            <meshBasicMaterial
              transparent
              depthWrite={false}
              color="#ccddff"
              opacity={0.22}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          {/* Shielder: shield bubble ring */}
          <mesh
            ref={(el) => {
              shieldFxRefs.current[i] = el;
            }}
            visible={false}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <torusGeometry args={[0.7, 0.04, 8, 20]} />
            <meshBasicMaterial
              color="#00ccff"
              transparent
              opacity={0.3}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          {/* Cloaker: distortion ring */}
          <mesh
            ref={(el) => {
              cloakFxRefs.current[i] = el;
            }}
            visible={false}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <torusGeometry args={[0.6, 0.02, 6, 16]} />
            <meshBasicMaterial
              color="#8844ff"
              transparent
              opacity={0.3}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          {/* HP bar */}
          <mesh
            ref={(el) => {
              hpBarBgRefs.current[i] = el;
            }}
            position={[0, -1.6, 0]}
            visible={false}
          >
            <planeGeometry args={[2.4, 0.18]} />
            <meshBasicMaterial color="#111" transparent opacity={0.7} />
          </mesh>
          <mesh
            ref={(el) => {
              hpBarRefs.current[i] = el;
            }}
            position={[0, -1.6, 0.01]}
            visible={false}
          >
            <planeGeometry args={[2.4, 0.14]} />
            <meshBasicMaterial color="#00ffaa" transparent opacity={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Enemy bullet visuals
   ═══════════════════════════════════════════════════ */

// Shared geometry + materials for enemy bullets — one geo/mat instead of 80
// (visual upgrade: hot core + additive plasma halo; hitbox logic unchanged)
const _ebCoreGeo = new THREE.SphereGeometry(0.09, 8, 8);
const _ebGlowGeo = new THREE.SphereGeometry(0.22, 8, 8);
const _ebCoreMat = new THREE.MeshBasicMaterial({
  color: '#ff5566',
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});
const _ebGlowMat = new THREE.MeshBasicMaterial({
  color: '#ff2244',
  transparent: true,
  opacity: 0.3,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

function EnemyBulletVisuals({ poolRef }: { poolRef: React.MutableRefObject<EnemyBullet[]> }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRefs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((s) => {
    // Shared-material shimmer — one update per frame, not per bullet
    _ebGlowMat.opacity = 0.3 + 0.12 * Math.sin(s.clock.elapsedTime * 9);
    for (let i = 0; i < MAX_ENEMY_BULLETS; i++) {
      const m = refs.current[i];
      const g = glowRefs.current[i];
      const b = poolRef.current[i];
      if (!m || !g) continue;
      if (!b || !b.active) {
        m.visible = false;
        g.visible = false;
        continue;
      }
      m.visible = true;
      g.visible = true;
      m.position.set(b.x, b.y, 0);
      g.position.set(b.x, b.y, 0);
    }
  });
  return (
    <>
      {Array.from({ length: MAX_ENEMY_BULLETS }).map((_, i) => (
        <React.Fragment key={i}>
          <mesh
            ref={(el) => {
              refs.current[i] = el;
            }}
            visible={false}
            geometry={_ebCoreGeo}
            material={_ebCoreMat}
          />
          <mesh
            ref={(el) => {
              glowRefs.current[i] = el;
            }}
            visible={false}
            geometry={_ebGlowGeo}
            material={_ebGlowMat}
          />
        </React.Fragment>
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   PowerUp drop visuals — texture sprite with 3D volume
   ═══════════════════════════════════════════════════ */

const D_PWR_TEX_PATHS: Record<DPwrType, string> = {
  prism_shield: '/textures/powerups/powerup_shield.png',
  photon_burst: '/textures/powerups/powerup_photon_burst.png',
  quantum_core: '/textures/powerups/powerup_quantum_core.png',
  nebula_bomb: '/textures/powerups/powerup_nebula_bomb.png',
  nova_rockets: '/textures/powerups/powerup_nova_rockets.png',
};
const D_PWR_TYPES: DPwrType[] = ['prism_shield', 'photon_burst', 'quantum_core', 'nebula_bomb', 'nova_rockets'];
const _pwrDiscGeo = new THREE.CircleGeometry(0.5, 64);
const _pwrEdgeGeo = new THREE.TorusGeometry(0.48, 0.02, 16, 64);

function DPowerUpVisuals({ poolRef }: { poolRef: React.MutableRefObject<DPowerUp[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const lastTypes = useRef<(DPwrType | null)[]>(Array(MAX_POWERUPS).fill(null));
  const faceMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const edgeMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const pwrTexMap = useRef<Record<string, THREE.Texture>>({});
  const allPwrTexPaths = useMemo(() => D_PWR_TYPES.map((t) => D_PWR_TEX_PATHS[t]), []);
  const allPwrTextures = useLoader(THREE.TextureLoader, allPwrTexPaths);
  useMemo(() => {
    for (let i = 0; i < D_PWR_TYPES.length; i++) {
      const tex = allPwrTextures[i];
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 16;
      tex.generateMipmaps = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      pwrTexMap.current[D_PWR_TYPES[i]] = tex;
    }
  }, [allPwrTextures]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let i = 0; i < MAX_POWERUPS; i++) {
      const g = refs.current[i];
      const pw = poolRef.current[i];
      if (!g) continue;
      if (!pw || !pw.active) {
        g.visible = false;
        lastTypes.current[i] = null;
        continue;
      }
      g.visible = true;
      g.position.set(pw.x, pw.y, 0);
      g.rotation.y = t * 1.8 + i * 1.5;
      g.scale.setScalar(1.1);

      if (pw.type !== lastTypes.current[i]) {
        lastTypes.current[i] = pw.type;
        const tex = pwrTexMap.current[pw.type];
        const mat = faceMats.current[i];
        if (tex && mat) {
          mat.map = tex;
          mat.needsUpdate = true;
        }
      }
      // Always sync edge color every frame
      const eMat = edgeMats.current[i];
      if (eMat) {
        eMat.color.set(PWR_COLORS[pw.type]);
      }
    }
  });

  return (
    <>
      {Array.from({ length: MAX_POWERUPS }).map((_, i) => {
        if (!faceMats.current[i])
          faceMats.current[i] = new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
          });
        if (!edgeMats.current[i])
          edgeMats.current[i] = new THREE.MeshBasicMaterial({
            color: '#44ddff',
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
          });
        return (
          <group
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            visible={false}
          >
            <mesh geometry={_pwrDiscGeo} material={faceMats.current[i]} position={[0, 0, 0.03]} />
            <mesh
              geometry={_pwrDiscGeo}
              material={faceMats.current[i]}
              position={[0, 0, -0.03]}
              rotation={[0, Math.PI, 0]}
            />
            <mesh geometry={_pwrEdgeGeo} material={edgeMats.current[i]} />
          </group>
        );
      })}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Shooter Ship (bottom, H/V movement)
   ═══════════════════════════════════════════════════ */

function ShooterShip({
  posRef,
  color: _color,
  shieldActive,
  invulnRef,
  skinId,
  shipAura,
}: {
  posRef: React.MutableRefObject<{ x: number; y: number }>;
  color: string;
  shieldActive: React.MutableRefObject<boolean>;
  invulnRef: React.MutableRefObject<number>;
  skinId?: string | null;
  shipAura?: string | null;
}) {
  const ac = (shipAura && AURA_GAME_COLORS[shipAura]) || DEFAULT_SHIP_COLORS;
  const profile = useMemo(() => getShipProfile(skinId), [skinId]);
  const gRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const shieldRef = useRef<THREE.Group>(null);
  const shipMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const tiltY = useRef(0);
  const tiltX = useRef(0);
  const auraMat = useRef<THREE.MeshBasicMaterial>(null);
  const glowTex = useMemo(() => {
    const s = 128;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }, []);
  const _shieldGeo = useMemo(() => new THREE.IcosahedronGeometry(1.65, 1), []);
  const _shieldEdgeGeo = useMemo(() => {
    const tmp = new THREE.IcosahedronGeometry(1.66, 1);
    const edges = new THREE.EdgesGeometry(tmp);
    tmp.dispose();
    return edges;
  }, []);
  const texPath = skinId ? `/textures/ships/ship_${skinId.replace('ship_', '')}.png` : '/textures/ship.png';
  const shipTex = useLoader(THREE.TextureLoader, texPath);
  shipTex.colorSpace = THREE.SRGBColorSpace;
  shipTex.minFilter = THREE.LinearMipmapLinearFilter;
  shipTex.anisotropy = 16;

  // Exhaust trail
  const TRAIL_N = IS_MOBILE ? 40 : 60;
  const TRAIL_LIFE = 1.5;
  const trailRef = useRef<THREE.InstancedMesh>(null);
  const trailData = useRef(Array.from({ length: TRAIL_N }, () => ({ x: 0, y: 0, vy: 0, age: 99, sz: 0 })));
  const trailIdx = useRef(0);
  const trailTimer = useRef(0);
  const _tDummy = useMemo(() => new THREE.Object3D(), []);
  const _tColor = useMemo(() => new THREE.Color(), []);
  const trailGeo = useMemo(() => new THREE.CircleGeometry(0.15, 6), []);
  const trailMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useFrame((s, delta) => {
    if (!gRef.current) return;
    const dt = Math.min(delta, 0.033);
    const t = s.clock.elapsedTime;
    const prevX = gRef.current.position.x;
    const prevY = gRef.current.position.y;
    gRef.current.position.x = slerp(gRef.current.position.x, posRef.current.x, 22, dt);
    gRef.current.position.y = slerp(gRef.current.position.y, posRef.current.y, 22, dt);
    // Tilt ship when moving left/right (bank)
    const vx = (gRef.current.position.x - prevX) / Math.max(dt, 0.001);
    const targetTiltY = clamp(vx * 0.04, -0.35, 0.35);
    tiltY.current = slerp(tiltY.current, targetTiltY, 8, dt);
    // Tilt forward/backward (pitch)
    const vy = (gRef.current.position.y - prevY) / Math.max(dt, 0.001);
    const targetTiltX = clamp(-vy * 0.03, -0.25, 0.25);
    tiltX.current = slerp(tiltX.current, targetTiltX, 8, dt);
    if (bodyRef.current) {
      bodyRef.current.rotation.y = tiltY.current;
      bodyRef.current.rotation.x = tiltX.current;
    }
    if (shieldRef.current) {
      shieldRef.current.visible = shieldActive.current;
      if (shieldActive.current) {
        shieldRef.current.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
        shieldRef.current.rotation.y = t * 1.5;
      }
    }
    // Invulnerability visual — semi-transparent flicker
    if (shipMatRef.current) {
      shipMatRef.current.opacity = invulnRef.current > 0 ? 0.2 + Math.sin(t * 10) * 0.1 : 1;
    }
    // Aura pulse
    if (auraMat.current) {
      auraMat.current.opacity = 0.15 + 0.05 * Math.sin(t * 2.0);
    }

    // Exhaust trail — spawn particles from each engine nozzle
    const exhs = profile.exhausts;
    trailTimer.current += dt;
    const spawnInt = IS_MOBILE ? 0.03 : 0.02;
    const isBio = profile.trailStyle === 'bio';
    const [tcR, tcG, tcB] = profile.trailColor;
    while (trailTimer.current >= spawnInt) {
      trailTimer.current -= spawnInt;
      const exh = exhs[Math.floor(Math.random() * exhs.length)];
      const i = trailIdx.current % TRAIL_N;
      const spread = isBio ? 0.25 : 0.12;
      trailData.current[i].x = gRef.current.position.x + exh.x * 1.4 + (Math.random() - 0.5) * spread;
      trailData.current[i].y = gRef.current.position.y + exh.y * 1.4 + (Math.random() - 0.5) * spread;
      trailData.current[i].vy = isBio ? -(0.4 + Math.random() * 0.3) : -(0.8 + Math.random() * 0.5);
      trailData.current[i].age = 0;
      trailData.current[i].sz = isBio ? 0.25 + Math.random() * 0.2 : 0.18 + Math.random() * 0.12;
      trailIdx.current++;
    }
    if (trailRef.current) {
      for (let i = 0; i < TRAIL_N; i++) {
        const d = trailData.current[i];
        d.age += dt;
        d.y += d.vy * dt;
        // Bio trail: sinusoidal sideways drift
        if (isBio) d.x += Math.sin(d.age * 6 + i) * 0.3 * dt;
        const life = d.age / TRAIL_LIFE;
        if (life >= 1 || d.sz === 0) {
          _tDummy.position.set(0, 0, -9999);
          _tDummy.scale.setScalar(0.001);
          _tColor.setRGB(0, 0, 0);
        } else {
          const fade = Math.pow(1 - life, isBio ? 0.8 : 1.2);
          const pulse = isBio ? 0.7 + 0.3 * Math.sin(d.age * 8 + i * 0.5) : 1;
          _tDummy.position.set(d.x, d.y, -0.1);
          _tDummy.scale.setScalar(Math.max(d.sz * (0.5 + 0.5 * fade) * pulse, 0.01));
          _tColor.setRGB(tcR * fade, tcG * fade, tcB * fade);
        }
        _tDummy.updateMatrix();
        trailRef.current.setMatrixAt(i, _tDummy.matrix);
        trailRef.current.setColorAt(i, _tColor);
      }
      trailRef.current.instanceMatrix.needsUpdate = true;
      if (trailRef.current.instanceColor) trailRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <group ref={gRef} scale={[1.0, 1.0, 1.0]}>
        <group ref={bodyRef} position-y={profile.spriteYOff || 0}>
          {/* Ship sprite */}
          <mesh>
            <planeGeometry args={[1.6, 2.2]} />
            <meshBasicMaterial ref={shipMatRef} map={shipTex} transparent depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
        {/* Aura — soft glow behind ship */}
        {shipAura && (
          <mesh position={[0, profile.spriteYOff || 0, -0.06]}>
            <planeGeometry args={[3.8, 3.8]} />
            <meshBasicMaterial
              ref={auraMat}
              map={glowTex}
              transparent
              depthWrite={false}
              color={ac.glow}
              opacity={0.3}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )}
        {/* Shield — hex-panel geodesic */}
        <group ref={shieldRef} visible={false}>
          <mesh geometry={_shieldGeo}>
            <meshBasicMaterial
              color="#22d3ee"
              transparent
              opacity={0.12}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <lineSegments geometry={_shieldEdgeGeo}>
            <lineBasicMaterial color="#44eeff" transparent opacity={0.5} />
          </lineSegments>
          {!IS_MOBILE && <pointLight intensity={4} color="#22d3ee" distance={6} />}
        </group>
        {!IS_MOBILE && <pointLight intensity={6} color={ac.light} distance={2.5} />}
      </group>
      {/* Exhaust trail particles (world space) */}
      <instancedMesh ref={trailRef} args={[trailGeo, trailMat, TRAIL_N]} renderOrder={5} frustumCulled={false} />
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Fixed Camera (top-down)
   ═══════════════════════════════════════════════════ */

function FixedCam({
  shake,
  shipPos,
}: {
  shake: React.MutableRefObject<number>;
  shipPos?: React.MutableRefObject<{ x: number; y: number }>;
}) {
  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.033);
    // Parallax: camera follows ship at 30% for visible background movement
    let tx = 0,
      ty = 0;
    if (shipPos) {
      tx = shipPos.current.x * 0.3;
      ty = shipPos.current.y * 0.3;
    }
    let sx = 0,
      sy = 0;
    if (shake.current > 0.01) {
      const shakeScale = IS_MOBILE ? 0.42 : 0.6;
      sx = (Math.random() - 0.5) * shake.current * shakeScale;
      sy = (Math.random() - 0.5) * shake.current * shakeScale;
      shake.current = Math.max(0, shake.current - dt * 4);
    }
    camera.position.set(tx + sx, ty + sy, CAM_Z);
    camera.lookAt(tx + sx, ty + sy, 0);
  });
  return null;
}

/* ═══════════════════════════════════════════════════
   Game World — Cosmic Defender (top-down shooter)
   ═══════════════════════════════════════════════════ */

/* Background comets — occasional bright streaks */
const COMET_N = IS_MOBILE ? 3 : 6;
function Comets() {
  const data = useRef<
    { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; active: boolean }[]
  >(Array.from({ length: COMET_N }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, active: false })));
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const timer = useRef(0);
  useFrame((s, delta) => {
    const dt = Math.min(delta, 0.033);
    const cx = s.camera.position.x,
      cy = s.camera.position.y;
    timer.current += dt;
    if (timer.current > (IS_MOBILE ? 3.5 : 2.0)) {
      timer.current = 0;
      for (const c of data.current) {
        if (!c.active) {
          const edge = Math.floor(Math.random() * 4);
          const speed = 20 + Math.random() * 40;
          const spread = 60;
          if (edge === 0) {
            c.x = cx + (Math.random() - 0.5) * spread;
            c.y = cy + 25;
          } else if (edge === 1) {
            c.x = cx + 30;
            c.y = cy + (Math.random() - 0.5) * spread;
          } else if (edge === 2) {
            c.x = cx + (Math.random() - 0.5) * spread;
            c.y = cy - 25;
          } else {
            c.x = cx - 30;
            c.y = cy + (Math.random() - 0.5) * spread;
          }
          const ang = Math.atan2(cy - c.y + (Math.random() - 0.5) * 30, cx - c.x + (Math.random() - 0.5) * 30);
          c.vx = Math.cos(ang) * speed;
          c.vy = Math.sin(ang) * speed;
          c.maxLife = 1.0 + Math.random() * 2.0;
          c.life = 0;
          c.active = true;
          break;
        }
      }
    }
    for (let i = 0; i < COMET_N; i++) {
      const c = data.current[i];
      const m = refs.current[i];
      if (!m) continue;
      if (!c.active) {
        m.visible = false;
        continue;
      }
      c.life += dt;
      if (c.life > c.maxLife) {
        c.active = false;
        m.visible = false;
        continue;
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      m.visible = true;
      m.position.set(c.x, c.y, -8);
      m.rotation.z = Math.atan2(c.vy, c.vx);
      const fade = Math.min(1, c.life * 3) * Math.min(1, (c.maxLife - c.life) * 2);
      (m.material as THREE.MeshBasicMaterial).opacity = fade * 0.35;
    }
  });
  return (
    <>
      {Array.from({ length: COMET_N }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          visible={false}
        >
          <planeGeometry args={[3.5, 0.04]} />
          <meshBasicMaterial
            color="#aaccff"
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}

function DestroyerWorld({
  gameState,
  onGameOver,
  onScore,
  onCoins,
  onLevel,
  onActiveBonuses,
  reviveRef,
  traits,
  hasMintedId,
  shipSkin,
  shipAura,
  shipStats,
  challengeMode,
  paused = false,
}: GameProps) {
  const coinMult = hasMintedId ? 2 : 1;
  // Throttled score/coins updates — batch React setState to max once per 100ms
  const _scoreDirty = useRef(false);
  const _coinDirty = useRef(false);
  const _lastScoreFlush = useRef(0);
  const flushScoreCoins = useCallback(
    (score: number, coins: number, force?: boolean) => {
      const now = performance.now();
      _scoreDirty.current = true;
      _coinDirty.current = true;
      if (force || now - _lastScoreFlush.current > 100) {
        _lastScoreFlush.current = now;
        if (_scoreDirty.current) {
          onScore(score);
          _scoreDirty.current = false;
        }
        if (_coinDirty.current) {
          onCoins(coins);
          _coinDirty.current = false;
        }
      }
    },
    [onScore, onCoins],
  );
  // Visible bounds (computed from camera each frame)
  const visBounds = useRef({ hw: HALF_W, hh: HALF_H });
  // Per-ship gun profile
  const shipProfile = useMemo(() => getShipProfile(shipSkin), [shipSkin]);
  // Ship state
  const shipPos = useRef({ x: 0, y: -HALF_H + 4 });
  const inputDir = useRef({ x: 0, y: 0 });
  const touchId = useRef<number | null>(null);
  const touchStart = useRef({ x: 0, y: 0, sx: 0, sy: 0 });

  // Pools
  const projectiles = useRef<Projectile[]>(
    Array.from({ length: MAX_PROJECTILES }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      active: false,
      kind: 'bullet' as const,
    })),
  );
  const enemies = useRef<Enemy[]>(
    Array.from({ length: MAX_ENEMIES }, (_, i) => ({
      id: i,
      x: 0,
      y: 99,
      vx: 0,
      vy: 0,
      hp: 0,
      maxHp: 0,
      type: 'scout' as EnemyType,
      active: false,
      dying: 0,
      shootTimer: 0,
      phaseTimer: 0,
      shieldHp: 0,
      cloakAlpha: 1,
      hitFlash: 0,
      r: 0.5,
      rx: 0,
      ry: 0,
      rz: 0,
      cascadeTimer: 0,
      enraged: false,
    })),
  );
  const enemyBullets = useRef<EnemyBullet[]>(
    Array.from({ length: MAX_ENEMY_BULLETS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, active: false })),
  );
  const powerups = useRef<DPowerUp[]>(
    Array.from({ length: MAX_POWERUPS }, () => ({
      id: 0,
      x: 0,
      y: 0,
      type: 'shield' as DPwrType,
      life: 0,
      active: false,
    })),
  );
  const smallExplosions = useRef<SmallExplosion[]>(
    Array.from({ length: IS_MOBILE ? 6 : 12 }, () => ({ x: 0, y: 0, t: 0, active: false, color: '#fff' })),
  );

  // Game state refs
  const overRef = useRef(false);
  const scoreRef = useRef(0);
  const coinBank = useRef(0);
  const shake = useRef(0);
  const elapsed = useRef(0);
  const explPos = useRef({ x: 0, y: 0 });
  const explAct = useRef(false);

  // Level system
  const level = useRef(0);
  const waveIdx = useRef(0);
  const waveTimer = useRef(0);
  const waveSpawned = useRef(false);
  const levelComplete = useRef(false);
  const levelPause = useRef(0);
  const allEnemiesSpawned = useRef(false);
  const levelBanner = useRef(0); // countdown for "LEVEL X" banner display
  const spawnQueue = useRef<{ type: EnemyType; x: number; delay: number }[]>([]);
  const warnIndicators = useRef<{ x: number; life: number }[]>([]);

  // Powerup durations
  const shieldActive = useRef(false);
  const shieldHits = useRef(0);
  const invulnT = useRef(0); // invulnerability timer (seconds) — ship is semi-transparent
  const doubleT = useRef(0);
  const firerateT = useRef(0);
  const rocketAmmo = useRef(0);
  const fireCooldown = useRef(0);
  const autoFire = useRef(true);

  // Combo
  const combo = useRef(0);
  const comboTimer = useRef(0);

  const sCol = traits?.planetTier ? TIER_COLORS[traits.planetTier] || '#22d3ee' : '#22d3ee';

  // Input handling
  useEffect(() => {
    if (gameState !== 'playing' || paused) return;
    const keys = new Set<string>();

    const syncInput = () => {
      let dx = 0,
        dy = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) dy += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) dy -= 1;
      inputDir.current = { x: dx, y: dy };
    };

    const onKeyDown = (e: KeyboardEvent) => {
      keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      syncInput();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
      syncInput();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (overRef.current) return;
      e.preventDefault();
      if (touchId.current !== null) return;
      const t = e.changedTouches[0];
      touchId.current = t.identifier;
      touchStart.current = { x: t.clientX, y: t.clientY, sx: shipPos.current.x, sy: shipPos.current.y };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (overRef.current) return;
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === touchId.current) {
          const sensitivity = 0.055;
          const dx = (t.clientX - touchStart.current.x) * sensitivity;
          const dy = -(t.clientY - touchStart.current.y) * sensitivity;
          const bw = visBounds.current.hw - 1,
            bh = visBounds.current.hh;
          shipPos.current.x = clamp(touchStart.current.sx + dx, -bw, bw);
          shipPos.current.y = clamp(touchStart.current.sy + dy, -bh - 1, bh - 1);
        }
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (overRef.current) {
        touchId.current = null;
        return;
      }
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId.current) touchId.current = null;
      }
    };
    const onCtx = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('contextmenu', onCtx);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('contextmenu', onCtx);
    };
  }, [gameState, paused]);

  // Reset on game start
  useEffect(() => {
    if (gameState !== 'playing') return;
    resetEid();
    resetPwid();
    shipPos.current = { x: 0, y: -HALF_H + 4 };
    inputDir.current = { x: 0, y: 0 };
    touchId.current = null;
    for (let _i = 0; _i < projectiles.current.length; _i++) projectiles.current[_i].active = false;
    for (let _i = 0; _i < enemies.current.length; _i++) enemies.current[_i].active = false;
    for (let _i = 0; _i < enemyBullets.current.length; _i++) enemyBullets.current[_i].active = false;
    for (let _i = 0; _i < powerups.current.length; _i++) powerups.current[_i].active = false;
    for (let _si = 0; _si < smallExplosions.current.length; _si++) smallExplosions.current[_si].active = false;
    overRef.current = false;
    scoreRef.current = 0;
    coinBank.current = 0;
    shake.current = 0;
    elapsed.current = 0;
    explAct.current = false;
    level.current = 0;
    waveIdx.current = 0;
    waveTimer.current = 0;
    waveSpawned.current = false;
    levelComplete.current = false;
    levelPause.current = 0;
    allEnemiesSpawned.current = false;
    shieldActive.current = false;
    shieldHits.current = 0;
    invulnT.current = 0;
    doubleT.current = 0;
    firerateT.current = 0;
    rocketAmmo.current = 0;
    fireCooldown.current = 0;
    autoFire.current = true;
    combo.current = 0;
    comboTimer.current = 0;
    onScore(0);
    onCoins(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  const physAccum = useRef(0);
  const PHYS_DT = IS_MOBILE ? 1 / 60 : 1 / 90;
  const tabHiddenRef = useRef(false);

  // Pause when tab is hidden to prevent time jumps
  // Challenge mode: instant game over on tab hide (anti-abuse)
  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        if (challengeMode && gameState === 'playing' && !overRef.current) {
          overRef.current = true;
          onGameOver(scoreRef.current, coinBank.current);
          return;
        }
        tabHiddenRef.current = true;
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [challengeMode, gameState, onGameOver]);

  useFrame(({ camera }, delta) => {
    // Compute visible bounds from camera
    const cam = camera as THREE.PerspectiveCamera;
    const vFov = (cam.fov * Math.PI) / 180;
    const visH = Math.tan(vFov / 2) * CAM_Z;
    const visW = visH * cam.aspect;
    visBounds.current.hw = Math.min(visW - 0.5, HALF_W);
    visBounds.current.hh = Math.min(visH - 0.5, HALF_H);

    // Revive check
    if (reviveRef?.current && overRef.current) {
      overRef.current = false;
      reviveRef.current = false;
      invulnT.current = 3; // 3 seconds of invulnerability (semi-transparent)
      for (const b of enemyBullets.current) b.active = false;
    }
    if (paused) return;
    if (gameState !== 'playing' || overRef.current) {
      // Clear visuals when not playing
      for (const pw of powerups.current) pw.active = false;
      for (const e of enemies.current) e.active = false;
      for (const p of projectiles.current) p.active = false;
      for (const b of enemyBullets.current) b.active = false;
      return;
    }
    // Tab was hidden — skip frame to prevent time jump
    if (tabHiddenRef.current) {
      if (!document.hidden) {
        tabHiddenRef.current = false;
        physAccum.current = 0;
      }
      return;
    }
    const frameDt = Math.min(delta, 0.1);
    physAccum.current += frameDt;
    if (physAccum.current > PHYS_DT * 4) physAccum.current = PHYS_DT * 4;

    while (physAccum.current >= PHYS_DT) {
      physAccum.current -= PHYS_DT;
      const dt = PHYS_DT;
      elapsed.current += dt;
      if (invulnT.current > 0) invulnT.current -= dt;

      // Tick down spawn warning indicators — in-place, zero alloc
      {
        let wi = 0;
        for (let k = 0; k < warnIndicators.current.length; k++) {
          const w = warnIndicators.current[k];
          w.life -= dt;
          if (w.life > 0) warnIndicators.current[wi++] = w;
        }
        warnIndicators.current.length = wi;
      }

      // Ship movement
      const { x: dx, y: dy } = inputDir.current;
      if (dx !== 0 || dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy);
        const spdMult = 1 + (shipStats?.speed || 0) / 200; // x1.0 to x1.5
        shipPos.current.x += (dx / len) * SHIP_SPEED * spdMult * dt;
        shipPos.current.y += (dy / len) * SHIP_SPEED * spdMult * dt;
      }
      const bw = visBounds.current.hw - 1,
        bh = visBounds.current.hh;
      shipPos.current.x = clamp(shipPos.current.x, -bw, bw);
      shipPos.current.y = clamp(shipPos.current.y, -bh - 1, bh - 1);

      // Powerup timers
      if (doubleT.current > 0) doubleT.current -= dt;
      if (firerateT.current > 0) firerateT.current -= dt;
      if (fireCooldown.current > 0) fireCooldown.current -= dt;

      // Combo decay
      if (comboTimer.current > 0) {
        comboTimer.current -= dt;
        if (comboTimer.current <= 0) combo.current = 0;
      }
    }

    // Frame-rate updates
    const dt = frameDt;
    const sx = shipPos.current.x,
      sy = shipPos.current.y;
    const lvl = LEVELS[level.current];
    if (!lvl) {
      // All 4 levels complete — victory
      if (!overRef.current) {
        overRef.current = true;
        scoreRef.current += 100; // completion bonus
        onScore(scoreRef.current);
        sfxVictory();
        onGameOver(scoreRef.current, coinBank.current, true);
      }
      return;
    }

    // Level banner countdown
    if (levelBanner.current > 0) {
      levelBanner.current -= dt;
      onLevel?.(lvl.id, 0, lvl.name, true);
      if (levelBanner.current > 0) return; // pause during banner
    }

    // Process staggered spawn queue — in-place, no splice
    const sq = spawnQueue.current;
    if (sq.length > 0) {
      let sqW = 0;
      for (let qi = 0; qi < sq.length; qi++) {
        sq[qi].delay -= dt;
        if (sq[qi].delay <= 0) {
          const item = sq[qi];
          let slot: Enemy | null = null;
          for (let si = 0; si < enemies.current.length; si++) {
            if (!enemies.current[si].active) {
              slot = enemies.current[si];
              break;
            }
          }
          if (slot) {
            const spawned = spawnEnemy(item.type, item.x, level.current);
            spawned.x = item.x;
            spawned.y = HALF_H + spawned.r + rnd(0.5, 3);
            Object.assign(slot, spawned);
          }
        } else {
          sq[sqW++] = sq[qi];
        }
      }
      sq.length = sqW;
    }

    // Level wave system
    if (!levelComplete.current) {
      waveTimer.current += dt;
      const wave = lvl.waves[waveIdx.current];
      if (wave && !waveSpawned.current && waveTimer.current >= wave.delay) {
        onLevel?.(lvl.id, waveIdx.current + 1, lvl.name, false);
        // Play boss appear sound if this wave contains a boss
        if (wave.enemies.some((eg) => isBoss(eg.type))) sfxBossAppear();
        // Queue staggered spawning with telegraph delay
        let idx = 0;
        for (const eg of wave.enemies) {
          const spacing = (PLAY_W - 4) / Math.max(1, eg.count);
          for (let j = 0; j < eg.count; j++) {
            const ex = -HALF_W + 2 + spacing * (j + 0.5) + rnd(-1, 1);
            // Add 0.35s telegraph delay before enemies actually spawn
            sq.push({ type: eg.type, x: ex, delay: 0.35 + idx * 0.04 });
            idx++;
          }
        }
        // Add warning indicators for this wave
        for (let wi = 0; wi < sq.length && wi < warnIndicators.current.length; wi++) {
          warnIndicators.current[wi].x = sq[wi].x;
          warnIndicators.current[wi].life = 0.35;
        }
        if (warnIndicators.current.length < sq.length) {
          for (let wi = warnIndicators.current.length; wi < sq.length; wi++)
            warnIndicators.current.push({ x: sq[wi].x, life: 0.35 });
        }
        warnIndicators.current.length = sq.length;
        waveSpawned.current = true;
      }
      // Check if all enemies from this wave are cleared
      if (waveSpawned.current && sq.length === 0) {
        let alive = false;
        for (let ai = 0; ai < enemies.current.length; ai++) {
          if (enemies.current[ai].active) {
            alive = true;
            break;
          }
        }
        if (!alive) {
          waveIdx.current++;
          waveSpawned.current = false;
          waveTimer.current = 0;
          if (waveIdx.current >= lvl.waves.length) {
            levelComplete.current = true;
            levelPause.current = 0.8;
            const bonus = lvl.id * 10;
            scoreRef.current += bonus;
            coinBank.current += lvl.id * 5 * coinMult;
            onScore(scoreRef.current);
            onCoins(coinBank.current);
          }
        }
      }
    } else {
      // Pause between levels + show banner — do NOT return, let dying/explosions/powerups tick
      levelPause.current -= dt;
      if (levelPause.current <= 0) {
        level.current++;
        waveIdx.current = 0;
        waveTimer.current = 0;
        waveSpawned.current = false;
        levelComplete.current = false;
        const nextLvl = LEVELS[level.current];
        if (nextLvl) {
          levelBanner.current = 2.0;
          onLevel?.(nextLvl.id, 0, nextLvl.name, true);
          sfxLevelUp();
        }
      }
    }

    // Auto-fire (skip during level pause)
    if (autoFire.current && fireCooldown.current <= 0 && !levelComplete.current) {
      const fpMult = 1 - (shipStats?.firepower || 0) / 300; // down to 0.67x cooldown
      const cd = (firerateT.current > 0 ? FAST_FIRE_CD : BASE_FIRE_CD) * fpMult;
      const hasDouble = doubleT.current > 0;
      let firedType: 'rocket' | 'double' | 'single' = 'single';

      const SHIP_SCALE = 1.0;
      const sg = shipProfile.singleGun;
      const dg = shipProfile.doubleGuns;

      if (rocketAmmo.current > 0) {
        // Find closest enemy for homing
        let closest: Enemy | null = null;
        let closestD = 999;
        for (const e of enemies.current) {
          if (!e.active) continue;
          const d = Math.abs(e.x - sx) + Math.abs(e.y - sy);
          if (d < closestD) {
            closestD = d;
            closest = e;
          }
        }
        if (closest) {
          const ang = Math.atan2(closest.y - sy, closest.x - sx);
          fireProj(
            projectiles.current,
            sx + sg.x * SHIP_SCALE,
            sy + sg.y * SHIP_SCALE,
            Math.cos(ang) * ROCKET_SPEED,
            Math.sin(ang) * ROCKET_SPEED,
            'rocket',
          );
          rocketAmmo.current--;
          firedType = 'rocket';
        } else {
          fireProj(projectiles.current, sx + sg.x * SHIP_SCALE, sy + sg.y * SHIP_SCALE, 0, PROJ_SPEED, 'bullet');
        }
      } else if (hasDouble) {
        fireProj(projectiles.current, sx + dg[0].x * SHIP_SCALE, sy + dg[0].y * SHIP_SCALE, 0, PROJ_SPEED, 'bullet');
        fireProj(projectiles.current, sx + dg[1].x * SHIP_SCALE, sy + dg[1].y * SHIP_SCALE, 0, PROJ_SPEED, 'bullet');
        firedType = 'double';
      } else {
        fireProj(projectiles.current, sx + sg.x * SHIP_SCALE, sy + sg.y * SHIP_SCALE, 0, PROJ_SPEED, 'bullet');
      }
      fireCooldown.current = cd;
      if (firedType === 'rocket') sfxShootRocket();
      else if (firedType === 'double') sfxShootDouble();
      else sfxShoot();
    }

    // Update projectiles
    for (let pi = 0; pi < projectiles.current.length; pi++) {
      const p = projectiles.current[pi];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0 || p.y > HALF_H + 2 || p.y < -HALF_H - 2) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // Tick dying enemies (fade-out animation + boss cascade explosions)
    for (let ei = 0; ei < enemies.current.length; ei++) {
      const e = enemies.current[ei];
      if (!e.active || e.dying <= 0) continue;
      e.dying -= dt;
      // Boss cascade: spawn explosions at random offsets every 0.08s during dying
      if (isBoss(e.type) && e.dying > 0) {
        e.cascadeTimer += dt;
        if (e.cascadeTimer >= 0.08) {
          e.cascadeTimer -= 0.08;
          const ox = (Math.random() - 0.5) * e.r * 4;
          const oy = (Math.random() - 0.5) * e.r * 4;
          const cc = ['#ff6622', '#ffaa33', '#ff3300', '#ffdd55', '#ff8844', '#ff2200'];
          addExplosion(smallExplosions.current, e.x + ox, e.y + oy, cc[Math.floor(Math.random() * cc.length)]);
          shake.current = Math.max(shake.current, 0.8 + Math.random() * 0.5);
        }
      }
      if (e.dying <= 0) {
        e.active = false;
        e.dying = 0;
      }
    }

    // Update enemies
    for (let ei = 0; ei < enemies.current.length; ei++) {
      const e = enemies.current[ei];
      if (!e.active || e.dying > 0) continue;
      e.phaseTimer += dt;
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
      const stats = ENEMY_STATS[e.type];

      // Homing: steer toward player
      const toPlayerX = sx - e.x;
      const toPlayerY = sy - e.y;
      const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY);

      if (e.type === 'scout' || e.type === 'swarm') {
        // Descend steadily + sinusoidal weave
        e.vy = -stats.speed * 0.7;
        e.vx = Math.sin(e.phaseTimer * 2.5 + e.id) * stats.speed * 0.6;
      } else if (e.type === 'fighter' || e.type === 'elite' || e.type === 'cloaker') {
        // Active homing toward player
        if (distToPlayer > 0.5) {
          const nx = toPlayerX / distToPlayer,
            ny = toPlayerY / distToPlayer;
          e.vx += nx * stats.speed * 2 * dt;
          e.vy += ny * stats.speed * 1.5 * dt;
        }
        const spd = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
        if (spd > stats.speed) {
          e.vx *= stats.speed / spd;
          e.vy *= stats.speed / spd;
        }
      } else if (e.type === 'bomber') {
        e.vy = -stats.speed * 0.6;
        e.vx = Math.sin(e.phaseTimer * 1.5 + e.id * 0.7) * 4;
      } else if (e.type === 'tank' || e.type === 'shielder') {
        // Slow descent, slight tracking
        e.vy = -stats.speed * 0.65;
        e.vx += (toPlayerX > 0 ? 1 : -1) * stats.speed * 0.5 * dt;
        e.vx = clamp(e.vx, -stats.speed * 0.5, stats.speed * 0.5);
      } else if (isBoss(e.type)) {
        // All bosses hover in upper area, track X
        const targetY = HALF_H * 0.35;
        if (e.y > targetY) e.vy = -stats.speed;
        else {
          e.vy = Math.sin(e.phaseTimer * 0.5) * 1.5;
        }
        e.vx += (toPlayerX > 0 ? 1 : -1) * 3 * dt;
        e.vx = clamp(e.vx, -4, 4);
        // Boss2 (Phantom): teleport every ~6s
        if (
          e.type === 'boss2' &&
          e.phaseTimer > 0 &&
          Math.floor(e.phaseTimer / 6) !== Math.floor((e.phaseTimer - dt) / 6)
        ) {
          e.x = rnd(-visBounds.current.hw + 3, visBounds.current.hw - 3);
          e.y = rnd(HALF_H * 0.2, HALF_H * 0.55);
        }
        // Boss3 (Warlord): enrage at 50% HP — faster movement (apply once)
        if (e.type === 'boss3' && e.hp < e.maxHp * 0.5 && !e.enraged) {
          e.enraged = true;
          e.vx *= 1.4;
        }
        // Boss4 (Nexus): regenerate shield over time (1 HP every 3s)
        if (e.type === 'boss4') {
          if (e.shieldHp < 5 && Math.floor(e.phaseTimer / 3) !== Math.floor((e.phaseTimer - dt) / 3)) {
            e.shieldHp++;
          }
        }
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // Bounce off visible walls (use visBounds so enemies stay on-screen)
      const vbw = visBounds.current.hw;
      if (e.x < -vbw + e.r) {
        e.x = -vbw + e.r;
        e.vx = Math.abs(e.vx);
      }
      if (e.x > vbw - e.r) {
        e.x = vbw - e.r;
        e.vx = -Math.abs(e.vx);
      }
      // Clamp to top of screen (enemies can't fly above visible area)
      if (e.y > HALF_H - e.r) {
        e.y = HALF_H - e.r;
        e.vy = -Math.abs(e.vy) * 0.5;
      }

      // Despawn if too far below screen
      if (e.y < -HALF_H - 4) {
        e.active = false;
        continue;
      }

      // Shielder: regenerate shield after 4s without being hit
      if (e.type === 'shielder' && e.shieldHp < 3 && e.hitFlash <= 0) {
        if (Math.floor(e.phaseTimer / 4) !== Math.floor((e.phaseTimer - dt) / 4)) {
          e.shieldHp = Math.min(3, e.shieldHp + 1);
        }
      }

      // Cloaker: real cloak cycle (visible 2s, invisible 3s)
      if (e.type === 'cloaker' && e.dying <= 0) {
        const cycle = e.phaseTimer % 5;
        e.cloakAlpha = cycle < 2 ? 0.9 : 0.08;
      }

      // Enemy shooting
      if (stats.shoots) {
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          const bossE = isBoss(e.type);
          const shootInterval = bossE
            ? e.type === 'boss3' && e.hp < e.maxHp * 0.5
              ? 0.35
              : 0.6
            : e.type === 'elite'
              ? 1.0
              : 2.0;
          e.shootTimer = shootInterval + rnd(0, 0.5);
          const ang = Math.atan2(sy - e.y, sx - e.x);
          const bspd = bossE ? 12 : e.type === 'elite' ? 10 : 7;
          // Helper: fire one enemy bullet
          const fireBullet = (bx: number, by: number, bvx: number, bvy: number) => {
            for (let bi2 = 0; bi2 < enemyBullets.current.length; bi2++) {
              const b = enemyBullets.current[bi2];
              if (!b.active) {
                b.x = bx;
                b.y = by;
                b.vx = bvx;
                b.vy = bvy;
                b.life = 4;
                b.active = true;
                return;
              }
            }
          };

          if (e.type === 'boss1') {
            // Sentinel: aimed spread (5 bullets)
            for (let s = -2; s <= 2; s++) {
              fireBullet(e.x, e.y - e.r, Math.cos(ang + s * 0.18) * bspd, Math.sin(ang + s * 0.18) * bspd);
            }
          } else if (e.type === 'boss2') {
            // Phantom: rapid 3-shot burst (fast bullets)
            for (let s = 0; s < 3; s++) {
              fireBullet(e.x, e.y - e.r, Math.cos(ang + (s - 1) * 0.08) * 15, Math.sin(ang + (s - 1) * 0.08) * 15);
            }
          } else if (e.type === 'boss3') {
            // Warlord: circular barrage (8 bullets in ring)
            for (let s = 0; s < 8; s++) {
              const ca = (s / 8) * Math.PI * 2 + e.phaseTimer * 0.3;
              fireBullet(e.x, e.y, Math.cos(ca) * 9, Math.sin(ca) * 9);
            }
          } else if (e.type === 'boss4') {
            // Nexus: tracking bolts (4 aimed shots with slight spread)
            for (let s = -1; s <= 1; s += 0.5) {
              fireBullet(e.x, e.y - e.r, Math.cos(ang + s * 0.12) * 11, Math.sin(ang + s * 0.12) * 11);
            }
          } else {
            // Regular enemies: single aimed shot
            fireBullet(e.x, e.y - e.r, Math.cos(ang) * bspd, Math.sin(ang) * bspd);
          }
        }
      }
    }

    // Update enemy bullets
    for (let bi = 0; bi < enemyBullets.current.length; bi++) {
      const b = enemyBullets.current[bi];
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -HALF_H - 2 || b.y > HALF_H + 2 || Math.abs(b.x) > HALF_W + 2) b.active = false;
    }

    // Update powerups
    for (let pwi = 0; pwi < powerups.current.length; pwi++) {
      const pw = powerups.current[pwi];
      if (!pw.active) continue;
      pw.life += dt;
      pw.y -= 3 * dt; // drift down
      if (pw.y < -HALF_H - 2 || pw.life > 12) {
        pw.active = false;
        continue;
      }
      // Pickup check
      const pdx = pw.x - sx,
        pdy = pw.y - sy;
      if (Math.sqrt(pdx * pdx + pdy * pdy) < 1.5) {
        pw.active = false;
        shake.current = Math.max(shake.current, 0.2);
        if (pw.type === 'prism_shield') sfxShield();
        else sfxPickup();
        switch (pw.type) {
          case 'quantum_core':
            firerateT.current = FIRERATE_DUR;
            break;
          case 'photon_burst':
            doubleT.current = DOUBLE_DUR;
            break;
          case 'nova_rockets':
            rocketAmmo.current += ROCKET_AMMO;
            break;
          case 'prism_shield':
            shieldActive.current = true;
            shieldHits.current = 1 + Math.floor((shipStats?.shield || 0) / 20);
            break; // +0-5 extra hits
          case 'nebula_bomb':
            // Kill all enemies on screen EXCEPT bosses
            for (let ni = 0; ni < enemies.current.length; ni++) {
              const e = enemies.current[ni];
              if (e.active && e.dying <= 0 && !isBoss(e.type)) {
                scoreRef.current += ENEMY_STATS[e.type].score;
                coinBank.current += Math.max(1, Math.floor(ENEMY_STATS[e.type].score / 5)) * coinMult;
                e.dying = 0.25;
              }
            }
            for (let ni = 0; ni < enemyBullets.current.length; ni++) enemyBullets.current[ni].active = false;
            shake.current = 2;
            sfxNuke();
            onScore(scoreRef.current);
            onCoins(coinBank.current);
            break;
        }
      }
    }

    // Collision: player projectiles vs enemies
    for (let pi = 0; pi < projectiles.current.length; pi++) {
      const p = projectiles.current[pi];
      if (!p.active) continue;
      for (let ei = 0; ei < enemies.current.length; ei++) {
        const e = enemies.current[ei];
        if (!e.active || e.dying > 0) continue;
        const dx = p.x - e.x,
          dy = p.y - e.y;
        const hitMul = isBoss(e.type) ? 1.5 : 0.85;
        const hitR = (p.kind === 'rocket' ? ROCKET_HIT_R : PROJ_HIT_R) + e.r * hitMul;
        if (dx * dx + dy * dy < hitR * hitR) {
          p.active = false;
          const dmg = p.kind === 'rocket' ? ROCKET_DMG : 1;
          // Shield absorbs first
          if (e.shieldHp > 0) {
            e.shieldHp -= dmg;
            shake.current = Math.max(shake.current, 0.1);
          } else {
            e.hp -= dmg;
            e.hitFlash = 0.25;
          }
          if (e.hp <= 0) {
            e.dying = isBoss(e.type) ? 0.6 : 0.25;
            e.cascadeTimer = 0;
            // Explosion particles for every enemy kill
            addExplosion(smallExplosions.current, e.x, e.y, ENEMY_STATS[e.type].color);
            if (isBoss(e.type)) {
              // Immediate burst of explosions for dramatic boss death
              const bColors = ['#ff6622', '#ffaa33', '#ff3300', '#ffdd55', '#ff8844'];
              for (let be = 0; be < 3; be++) {
                const ox = (Math.random() - 0.5) * e.r * 2;
                const oy = (Math.random() - 0.5) * e.r * 2;
                addExplosion(smallExplosions.current, e.x + ox, e.y + oy, bColors[be]);
              }
              sfxExplosion();
              shake.current = 2.5;
              // Boss killed: clear all enemy projectiles so player can't die after boss death
              for (let _bi = 0; _bi < enemyBullets.current.length; _bi++) enemyBullets.current[_bi].active = false;
            }
            sfxEnemyDestroy();
            // Score + combo
            combo.current++;
            comboTimer.current = 3;
            const mult = Math.min(combo.current, 3);
            const pts = ENEMY_STATS[e.type].score * mult;
            scoreRef.current += pts;
            const luckCoinMult = 1 + (shipStats?.luck || 0) / 200; // up to +50% coins
            coinBank.current += Math.max(1, Math.floor((pts / 3) * luckCoinMult)) * coinMult;
            // Flat bonus coins for boss kills
            if (isBoss(e.type)) {
              coinBank.current += Math.floor(
                (({ boss1: 50, boss2: 100, boss3: 150, boss4: 250 } as Record<string, number>)[e.type] ?? 50) *
                  luckCoinMult,
              );
            }
            flushScoreCoins(scoreRef.current, coinBank.current);
            shake.current = Math.max(shake.current, isBoss(e.type) ? 1.5 : 0.3);
            // Drop powerup (15% chance, higher for bosses)
            const dropChance = isBoss(e.type) ? 0.6 : e.type === 'elite' ? 0.15 : 0.04;
            if (Math.random() < dropChance) {
              for (let _pi2 = 0; _pi2 < powerups.current.length; _pi2++) {
                const pw = powerups.current[_pi2];
                if (!pw.active) {
                  pw.id = ++_pwid;
                  pw.x = e.x;
                  pw.y = e.y;
                  pw.type = PWR_TYPES[Math.floor(Math.random() * PWR_TYPES.length)];
                  pw.life = 0;
                  pw.active = true;
                  break;
                }
              }
            }
          } else {
            shake.current = Math.max(shake.current, 0.08);
          }
          break;
        }
      }
    }

    // Collision: enemy bullets vs ship
    for (let bi = 0; bi < enemyBullets.current.length; bi++) {
      const b = enemyBullets.current[bi];
      if (!b.active) continue;
      const dx = b.x - sx,
        dy = b.y - sy;
      if (dx * dx + dy * dy < (SHIP_R + 0.15) * (SHIP_R + 0.15)) {
        b.active = false;
        if (invulnT.current > 0) {
          // invulnerable — ignore hit
        } else if (shieldActive.current) {
          shieldHits.current--;
          shake.current = Math.max(shake.current, 0.5);
          if (shieldHits.current <= 0) shieldActive.current = false;
        } else {
          overRef.current = true;
          shake.current = 2;
          explPos.current = { x: sx, y: sy };
          explAct.current = true;
          sfxExplosion();
          addExplosion(smallExplosions.current, sx, sy, '#ff8844');
          onGameOver(scoreRef.current, coinBank.current);
          return;
        }
      }
    }

    // Collision: enemies vs ship (body collision)
    for (let ei = 0; ei < enemies.current.length; ei++) {
      const e = enemies.current[ei];
      if (!e.active || e.dying > 0) continue;
      const dx = e.x - sx,
        dy = e.y - sy;
      const bodyMul = isBoss(e.type) ? 1.3 : 0.7;
      if (dx * dx + dy * dy < (SHIP_R + e.r * bodyMul) * (SHIP_R + e.r * bodyMul)) {
        if (invulnT.current > 0) {
          // invulnerable — ignore collision
        } else if (shieldActive.current) {
          shieldHits.current--;
          e.hp -= 2;
          shake.current = Math.max(shake.current, 0.8);
          if (shieldHits.current <= 0) shieldActive.current = false;
          if (e.hp <= 0) {
            e.dying = isBoss(e.type) ? 0.6 : 0.25;
            e.cascadeTimer = 0;
            addExplosion(smallExplosions.current, e.x, e.y, ENEMY_STATS[e.type].color);
            if (isBoss(e.type)) {
              for (let _bi = 0; _bi < enemyBullets.current.length; _bi++) enemyBullets.current[_bi].active = false;
            }
            sfxEnemyDestroy();
            combo.current++;
            comboTimer.current = 3;
            const shMult = Math.min(combo.current, 3);
            const shPts = ENEMY_STATS[e.type].score * shMult;
            scoreRef.current += shPts;
            const shLuckMult = 1 + (shipStats?.luck || 0) / 200;
            coinBank.current += Math.max(1, Math.floor((shPts / 3) * shLuckMult)) * coinMult;
            if (isBoss(e.type)) {
              coinBank.current += Math.floor(
                (({ boss1: 50, boss2: 100, boss3: 150, boss4: 250 } as Record<string, number>)[e.type] ?? 50) *
                  shLuckMult,
              );
            }
            flushScoreCoins(scoreRef.current, coinBank.current);
          }
        } else {
          overRef.current = true;
          shake.current = 2;
          explPos.current = { x: sx, y: sy };
          explAct.current = true;
          sfxExplosion();
          addExplosion(smallExplosions.current, sx, sy, '#ff8844');
          onGameOver(scoreRef.current, coinBank.current);
          return;
        }
      }
    }
    // Emit active bonuses for HUD display
    if (onActiveBonuses) {
      const b: import('@/components/game/GameShared').ActiveBonus[] = [];
      if (shieldActive.current)
        b.push({ type: 'prism_shield', label: 'Shield', icon: '🛡️', color: '#4488ff', t: shieldHits.current, max: 1 });
      if (doubleT.current > 0)
        b.push({
          type: 'photon_burst',
          label: 'Double',
          icon: '⚡',
          color: '#44ff44',
          t: doubleT.current,
          max: DOUBLE_DUR,
        });
      if (firerateT.current > 0)
        b.push({
          type: 'quantum_core',
          label: 'Rapid',
          icon: '🔥',
          color: '#ffcc00',
          t: firerateT.current,
          max: FIRERATE_DUR,
        });
      if (rocketAmmo.current > 0)
        b.push({
          type: 'nova_rockets',
          label: 'Rockets',
          icon: '🚀',
          color: '#ff4444',
          t: rocketAmmo.current,
          max: ROCKET_AMMO,
        });
      if (invulnT.current > 0)
        b.push({ type: 'invuln', label: 'Invuln', icon: '✨', color: '#ffffff', t: invulnT.current, max: 3 });
      onActiveBonuses(b);
    }
    // Flush throttled score/coins at end of frame (respect throttle — don't force)
    if (_scoreDirty.current || _coinDirty.current) flushScoreCoins(scoreRef.current, coinBank.current);
  });

  return (
    <>
      {/* No scene background — transparent, CosmicStarfield shows through */}
      <ambientLight intensity={IS_MOBILE ? 0.55 : 0.35} />
      <directionalLight intensity={0.65} color="#93c5fd" position={[8, 10, 14]} />
      <directionalLight intensity={0.32} color="#f8fafc" position={[-12, -8, 12]} />
      <FixedCam shake={shake} />
      <ShooterShip
        posRef={shipPos}
        color={sCol}
        shieldActive={shieldActive}
        invulnRef={invulnT}
        skinId={shipSkin}
        shipAura={shipAura}
      />
      <ProjectileVisuals poolRef={projectiles} color={sCol} />
      <EnemyVisuals poolRef={enemies} shipPos={shipPos} />
      <EnemyBulletVisuals poolRef={enemyBullets} />
      <DPowerUpVisuals poolRef={powerups} />
      <SmallExplosions poolRef={smallExplosions} />
      <ShipExplosion pRef={explPos} actRef={explAct} />
      <WarnArrows warnRef={warnIndicators} />
      <FX />
    </>
  );
}

const SHIP_EXPL_N = IS_MOBILE ? 30 : 120;
function ShipExplosion({
  pRef,
  actRef,
}: {
  pRef: React.MutableRefObject<{ x: number; y: number }>;
  actRef: React.MutableRefObject<boolean>;
}) {
  const ptRef = useRef<THREE.Points>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const tRef = useRef(0);
  const inited = useRef(false);
  const st = useMemo(() => {
    const p = new Float32Array(SHIP_EXPL_N * 3);
    const v = new Float32Array(SHIP_EXPL_N * 3);
    const c = new Float32Array(SHIP_EXPL_N * 3);
    for (let i = 0; i < SHIP_EXPL_N; i++) {
      c[i * 3] = 0.9 + Math.random() * 0.1;
      c[i * 3 + 1] = 0.2 + Math.random() * 0.5;
      c[i * 3 + 2] = Math.random() * 0.15;
    }
    return { p, v, c };
  }, []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.033);
    if (!actRef.current) {
      inited.current = false;
      if (ptRef.current) ptRef.current.visible = false;
      if (flashRef.current) flashRef.current.visible = false;
      return;
    }
    if (!inited.current) {
      inited.current = true;
      tRef.current = 0;
      const px = pRef.current.x,
        py = pRef.current.y;
      for (let i = 0; i < SHIP_EXPL_N; i++) {
        const a = Math.random() * 6.28,
          s = 3 + Math.random() * 14;
        st.v[i * 3] = Math.cos(a) * s;
        st.v[i * 3 + 1] = Math.sin(a) * s;
        st.v[i * 3 + 2] = (Math.random() - 0.5) * 4;
        st.p[i * 3] = px;
        st.p[i * 3 + 1] = py;
        st.p[i * 3 + 2] = 0;
      }
    }
    tRef.current += dt;
    const t = tRef.current;
    if (t > 2.5) {
      actRef.current = false;
      return;
    }
    // Animate particles
    if (ptRef.current) {
      ptRef.current.visible = true;
      const a = ptRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < SHIP_EXPL_N; i++) {
        st.p[i * 3] += st.v[i * 3] * dt;
        st.p[i * 3 + 1] += st.v[i * 3 + 1] * dt;
        st.p[i * 3 + 2] += st.v[i * 3 + 2] * dt;
        st.v[i * 3] *= 0.96;
        st.v[i * 3 + 1] *= 0.96;
        st.v[i * 3 + 2] *= 0.96;
      }
      a.set(st.p);
      ptRef.current.geometry.attributes.position.needsUpdate = true;
      const m = ptRef.current.material as THREE.PointsMaterial;
      m.opacity = Math.max(0, 1 - t / 2.2);
      m.size = 0.35 + t * 0.1;
    }
    // Flash sphere
    if (flashRef.current) {
      if (t < 0.4) {
        flashRef.current.visible = true;
        flashRef.current.position.set(pRef.current.x, pRef.current.y, 0);
        const s = t * 8;
        flashRef.current.scale.setScalar(s);
        (flashRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - t * 2);
      } else {
        flashRef.current.visible = false;
      }
    }
  });
  return (
    <>
      <points ref={ptRef} visible={false} renderOrder={999}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[st.p, 3]} />
          <bufferAttribute attach="attributes-color" args={[st.c, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.35}
          vertexColors
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
      <mesh ref={flashRef} visible={false} renderOrder={998}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial
          color="#ff8844"
          transparent
          opacity={0.8}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

const _warnDiamondGeo = new THREE.BufferGeometry();
_warnDiamondGeo.setAttribute(
  'position',
  new THREE.Float32BufferAttribute([0, 0.35, 0, -0.2, 0, 0, 0, -0.35, 0, 0.2, 0, 0], 3),
);
_warnDiamondGeo.setIndex([0, 1, 2, 0, 2, 3]);
const _warnHaloGeo = new THREE.RingGeometry(0.25, 0.55, 24);
const _warnLineGeo = new THREE.PlaneGeometry(0.06, 1.2);
const MAX_WARNS = 20;

function WarnArrows({ warnRef }: { warnRef: React.MutableRefObject<{ x: number; life: number }[]> }) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const warns = warnRef.current;
    for (let i = 0; i < MAX_WARNS; i++) {
      const g = groupRefs.current[i];
      if (!g) continue;
      if (i >= warns.length) {
        g.visible = false;
        continue;
      }
      const w = warns[i];
      g.visible = true;
      g.position.set(w.x, HALF_H - 0.6, 0);
      const pulse = Math.sin(w.life * 20) * 0.5 + 0.5;
      const fastPulse = Math.sin(w.life * 40) * 0.5 + 0.5;
      // Diamond
      const diamond = g.children[0] as THREE.Mesh;
      if (diamond) {
        (diamond.material as THREE.MeshBasicMaterial).opacity = 0.5 + pulse * 0.5;
        diamond.scale.setScalar(0.7 + pulse * 0.25);
        diamond.rotation.z = w.life * 2;
      }
      // Halo
      const halo = g.children[1] as THREE.Mesh;
      if (halo) {
        (halo.material as THREE.MeshBasicMaterial).opacity = 0.15 + fastPulse * 0.25;
        halo.scale.setScalar(1 + pulse * 0.6);
      }
      // Scan line
      const line = g.children[2] as THREE.Mesh;
      if (line) {
        line.position.y = -0.3 + Math.sin(w.life * 12) * 0.4;
        (line.material as THREE.MeshBasicMaterial).opacity = 0.3 + fastPulse * 0.4;
      }
    }
  });
  return (
    <>
      {Array.from({ length: MAX_WARNS }, (_, i) => (
        <group
          key={i}
          ref={(el) => {
            groupRefs.current[i] = el;
          }}
          visible={false}
        >
          <mesh geometry={_warnDiamondGeo}>
            <meshBasicMaterial
              color="#ff4444"
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh geometry={_warnHaloGeo}>
            <meshBasicMaterial
              color="#ff2222"
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh geometry={_warnLineGeo}>
            <meshBasicMaterial
              color="#ff6666"
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

function addExplosion(pool: SmallExplosion[], x: number, y: number, color: string) {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].active) {
      pool[i].x = x;
      pool[i].y = y;
      pool[i].t = 0;
      pool[i].active = true;
      pool[i].color = color;
      return;
    }
  }
  // Pool full — recycle oldest (smallest t)
  let oldest = 0;
  for (let i = 1; i < pool.length; i++) {
    if (pool[i].t > pool[oldest].t) oldest = i;
  }
  pool[oldest].x = x;
  pool[oldest].y = y;
  pool[oldest].t = 0;
  pool[oldest].active = true;
  pool[oldest].color = color;
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
