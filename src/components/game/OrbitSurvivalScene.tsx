import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree, extend } from '@react-three/fiber';
import * as THREE from 'three';

import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { WalletTraits } from '@/hooks/useWalletData';
import {
  sfxPickup,
  sfxShield,
  sfxExplosion,
  sfxNearMiss,
  sfxTap,
  sfxRevive,
  sfxRumble,
  sfxDebris,
  sfxAsteroidHit,
} from '@/lib/gameAudio';
import { AURA_GAME_COLORS, DEFAULT_SHIP_COLORS } from './GameShared';
import { getShipProfile } from '@/lib/shipProfiles';

extend({ Line_: THREE.Line });

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */

type GameState = 'start' | 'playing' | 'gameover';
interface GameProps {
  onScore: (score: number) => void;
  onCoins: (coins: number) => void;
  onGameOver: (finalScore: number, finalCoins: number) => void;
  onCombo?: (combo: number, pts: number) => void;
  reviveRef?: React.MutableRefObject<boolean>;
  gameState: GameState;
  traits: WalletTraits | null;
  challengeMode?: boolean;
  walletScore: number;
  hasMintedId?: boolean;
  shipSkin?: string | null;
  shipAura?: string | null;
  shipStats?: { speed: number; shield: number; firepower: number; luck: number };
}

interface AsteroidData {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rx: number;
  ry: number;
  rz: number;
  rsx: number;
  rsy: number;
  rsz: number;
  sx: number;
  sy: number;
  sz: number;
  gi: number;
  mi: number;
  small: boolean;
  active: boolean;
  wobbleAmp: number;
  wobbleFreq: number;
  wobblePhase: number;
  spawnTime: number;
  scored: boolean;
}

interface BHole {
  x: number;
  y: number;
  str: number;
  life: number;
  maxLife: number;
}

type PwrType = 'shield' | 'slowmo' | 'phase' | 'coin';
interface PowerUp {
  id: number;
  x: number;
  y: number;
  type: PwrType;
  life: number;
  maxLife: number;
}

/* ═══════════════════════════════════════════════════
   Tuning constants
   ═══════════════════════════════════════════════════ */

const IS_MOBILE = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

const HIT_R = 0.72;
const NEAR_MISS_D = 2.2;
const CAM_Z = 35;
const SPAWN_R = 28;
const DESPAWN_R = 42;

const INIT_SPEED = 4.5;
const MAX_SPEED = 22;
const SPEED_GAIN = 0.18;
// Near-miss scoring
const NEAR_MISS_PTS = 3;
const STREAK_MULT_CAP = 5;
const ANG_RATE = 1.2;
const TAP_BOOST = 0.14;

const BH_N = 3;
const BH_STR = 6.0;
const BH_MIN_LIFE = 12;
const BH_MAX_LIFE = 25;
const BH_SPAWN_INTERVAL = 10;
const BH_TURN_K = 4.5;
const BH_CORE_R = 2.2;
const BH_PUSH_STR = 18;
const BH_DEFLECT_K = 7.0;

const EXPLODE_N = IS_MOBILE ? 25 : 80;
const EXHAUST_N = IS_MOBILE ? 14 : 60;

const PWR_MAX = 3;
const PWR_SPAWN_INTERVAL = 14;
const PWR_PICKUP_R = 1.5;
const PWR_LIFE = 18;
const SHIELD_DUR = 6;
const SLOWMO_DUR = 6;
const PHASE_DUR = 4;
const COIN_BONUS = 25;
const MAX_ASTEROIDS = IS_MOBILE ? 100 : 200;

const TIER_COLORS: Record<string, string> = {
  mercury: '#9ca3af',
  mars: '#ef4444',
  venus: '#f59e0b',
  earth: '#22c55e',
  neptune: '#3b82f6',
  uranus: '#22d3ee',
  saturn: '#facc15',
  jupiter: '#fb923c',
  sun: '#fde047',
  binary_sun: '#ffffff',
};

let aidN = 0;
const rnd = (a: number, b: number) => Math.random() * (b - a) + a;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const slerp = (c: number, t: number, s: number, dt: number) => THREE.MathUtils.lerp(c, t, 1 - Math.exp(-s * dt));
const normAng = (a: number) => {
  let v = a % (Math.PI * 2);
  if (v > Math.PI) v -= Math.PI * 2;
  if (v < -Math.PI) v += Math.PI * 2;
  return v;
};
const seededRng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/* ═══════════════════════════════════════════════════
   Rock textures — real PBR rock textures (Poly Haven CC0)
   Pre-loaded at module scope so they're ready before gameplay
   ═══════════════════════════════════════════════════ */

const _tl = new THREE.TextureLoader();
const _cfgDiff = (t: THREE.Texture) => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
const _cfgNorm = (t: THREE.Texture) => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  return t;
};

const AST_TEX_PAIRS = [
  {
    diffuse: _cfgDiff(_tl.load('/textures/asteroids/rock_ground_diff_1k.jpg')),
    normal: _cfgNorm(_tl.load('/textures/asteroids/rock_ground_nor_gl_1k.jpg')),
  },
  {
    diffuse: _cfgDiff(_tl.load('/textures/asteroids/rock_boulder_dry_diff_1k.jpg')),
    normal: _cfgNorm(_tl.load('/textures/asteroids/rock_boulder_dry_nor_gl_1k.jpg')),
  },
  {
    diffuse: _cfgDiff(_tl.load('/textures/asteroids/brown_mud_rocks_01_diff_1k.jpg')),
    normal: _cfgNorm(_tl.load('/textures/asteroids/brown_mud_rocks_01_nor_gl_1k.jpg')),
  },
  {
    diffuse: _cfgDiff(_tl.load('/textures/asteroids/rock_face_diff_1k.jpg')),
    normal: _cfgNorm(_tl.load('/textures/asteroids/rock_face_nor_gl_1k.jpg')),
  },
];

const AST_NORM_SCALE = new THREE.Vector2(1.6, 1.6);

const AST_M = [
  { met: 0.06, rou: 0.94 }, // rock_ground: dark rocky ground
  { met: 0.1, rou: 0.85 }, // rock_boulder_dry: dry boulder
  { met: 0.08, rou: 0.88 }, // brown_mud_rocks: brown rocky
  { met: 0.14, rou: 0.78 }, // rock_face: exposed rock face
];

// Shared Lambert materials — one per texture pair (avoids 200 duplicate materials)
// Lambert = per-vertex lighting, much cheaper than PBR Standard
// MeshBasicMaterial — no lighting dependence, asteroids always look identical
const AST_SHARED_MATS: THREE.MeshBasicMaterial[] = [];
// Regular rock materials (indices 0..3)
AST_TEX_PAIRS.forEach((pair) => {
  AST_SHARED_MATS.push(
    new THREE.MeshBasicMaterial({
      map: pair.diffuse,
      color: new THREE.Color('#8a8e9a'),
      side: THREE.DoubleSide,
    }),
  );
});
if (!IS_MOBILE) {
  // Ice materials (indices 4..7)
  AST_TEX_PAIRS.forEach((pair) => {
    AST_SHARED_MATS.push(
      new THREE.MeshBasicMaterial({
        map: pair.diffuse,
        color: new THREE.Color('#7898b0'),
        side: THREE.DoubleSide,
      }),
    );
  });
  // Fire materials (indices 8..11)
  AST_TEX_PAIRS.forEach((pair) => {
    AST_SHARED_MATS.push(
      new THREE.MeshBasicMaterial({
        map: pair.diffuse,
        color: new THREE.Color('#9a7860'),
        side: THREE.DoubleSide,
      }),
    );
  });
}
const AST_MAT_COUNT = AST_SHARED_MATS.length; // 4 on mobile, 12 on desktop

/* ═══════════════════════════════════════════════════
   Rock geometry — smooth sphere + gentle displacement
   ═══════════════════════════════════════════════════ */

function makeRockGeo(seg: number, seed: number): THREE.SphereGeometry {
  const geo = new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.75)));
  const R = seededRng(seed);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  // Low-frequency organic shape
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const nx = v.x * 2.5,
      ny = v.y * 2.5,
      nz = v.z * 2.5;
    const lo = Math.sin(nx + seed) * Math.cos(ny + seed * 0.7) * Math.sin(nz + seed * 1.3);
    // High-frequency craggy detail
    const hx = v.x * 7 + seed * 3.1,
      hy = v.y * 7 + seed * 1.7,
      hz = v.z * 7 + seed * 2.3;
    const hi = (Math.sin(hx) * Math.cos(hy + hz) + Math.sin(hy * 1.3) * Math.cos(hz * 0.8)) * 0.5;
    v.multiplyScalar(0.88 + lo * 0.1 + hi * 0.06 + R() * 0.03);
    p.setXYZ(i, v.x, v.y, v.z);
  }

  // Broad bumps and deep craters
  const dir = new THREE.Vector3();
  const bumps = 4 + Math.floor(R() * 5);
  for (let b = 0; b < bumps; b++) {
    dir.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
    const w = 0.2 + R() * 0.5,
      d = (R() < 0.4 ? 1 : -1) * (0.04 + R() * 0.1);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      const ang = Math.acos(clamp(n.dot(dir), -1, 1));
      if (ang < w) {
        const t = 1 - ang / w;
        const smooth = t * t * (3 - 2 * t);
        v.multiplyScalar(1 + d * smooth);
        p.setXYZ(i, v.x, v.y, v.z);
      }
    }
  }

  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* ═══════════════════════════════════════════════════
   Spawners
   ═══════════════════════════════════════════════════ */

function assignAst(a: AsteroidData, el: number, sx: number, sy: number): void {
  const small = Math.random() < 0.6;
  const r = small ? rnd(0.4, 0.9) : rnd(1, 2);
  const ang = rnd(0, 6.28),
    dist = SPAWN_R + rnd(2, 5);
  const ca = ang + Math.PI + rnd(-0.55, 0.55);
  const speedRoll = Math.random();
  const speedMult = speedRoll < 0.2 ? rnd(1.8, 2.5) : speedRoll > 0.8 ? rnd(0.3, 0.55) : 1;
  const sp = (small ? rnd(5, 8.5) : rnd(2.2, 4.8)) * (1 + el * 0.018) * speedMult;
  const td = rnd(-1.8, 1.8) * (small ? 1 : 0.6);
  const roll = Math.random();
  a.id = ++aidN;
  a.x = sx + Math.cos(ang) * dist;
  a.y = sy + Math.sin(ang) * dist;
  a.vx = Math.cos(ca) * sp - Math.sin(ang) * td;
  a.vy = Math.sin(ca) * sp + Math.cos(ang) * td;
  a.r = r;
  a.rx = rnd(0, 6.28);
  a.ry = rnd(0, 6.28);
  a.rz = rnd(0, 6.28);
  a.rsx = rnd(-1.5, 1.5);
  a.rsy = rnd(-2, 2);
  a.rsz = rnd(-1.8, 1.8);
  a.sx = rnd(0.88, 1.15);
  a.sy = rnd(0.88, 1.15);
  a.sz = rnd(0.88, 1.15);
  a.gi = Math.floor(rnd(0, 8));
  a.mi = roll < 0.2 ? Math.floor(rnd(4, 8)) : roll < 0.35 ? Math.floor(rnd(8, 12)) : Math.floor(rnd(0, 4));
  a.small = small;
  a.active = true;
  a.wobbleAmp = rnd(0.3, 1.8);
  a.wobbleFreq = rnd(1.5, 4);
  a.wobblePhase = rnd(0, 6.28);
  a.spawnTime = el;
  a.scored = false;
}

function splitAsteroid(pool: AsteroidData[], parent: AsteroidData, el: number): void {
  if (parent.small || parent.r < 0.7) return;
  const count = 2 + (Math.random() < 0.4 ? 1 : 0);
  let spawned = 0;
  for (let i = 0; i < pool.length && spawned < count; i++) {
    if (pool[i].active) continue;
    const f = pool[i];
    const ang = ((Math.PI * 2) / count) * spawned + (Math.random() - 0.5) * 0.8;
    const sp = 3.5 + Math.random() * 4;
    f.id = ++aidN;
    f.x = parent.x + Math.cos(ang) * 0.4;
    f.y = parent.y + Math.sin(ang) * 0.4;
    f.vx = parent.vx * 0.4 + Math.cos(ang) * sp;
    f.vy = parent.vy * 0.4 + Math.sin(ang) * sp;
    f.r = parent.r * (0.35 + Math.random() * 0.15);
    f.rx = Math.random() * 6.28;
    f.ry = Math.random() * 6.28;
    f.rz = Math.random() * 6.28;
    f.rsx = (Math.random() - 0.5) * 5;
    f.rsy = (Math.random() - 0.5) * 5;
    f.rsz = (Math.random() - 0.5) * 5;
    f.sx = 0.85 + Math.random() * 0.3;
    f.sy = 0.85 + Math.random() * 0.3;
    f.sz = 0.85 + Math.random() * 0.3;
    f.gi = Math.floor(Math.random() * 6);
    f.mi = Math.floor(Math.random() * 4);
    f.small = true;
    f.active = true;
    f.wobbleAmp = 0.5 + Math.random() * 1.2;
    f.wobbleFreq = 2.5 + Math.random() * 3;
    f.wobblePhase = Math.random() * 6.28;
    f.spawnTime = el;
    f.scored = false;
    spawned++;
  }
}

function spawnBH(sx: number, sy: number): BHole {
  const a = rnd(0, 6.28),
    d = rnd(SPAWN_R - 4, SPAWN_R + 2);
  return {
    x: sx + Math.cos(a) * d,
    y: sy + Math.sin(a) * d,
    str: rnd(0.6, 1) * BH_STR,
    life: 0,
    maxLife: rnd(BH_MIN_LIFE, BH_MAX_LIFE),
  };
}

let pwIdN = 0;
const PWR_TYPES: PwrType[] = ['shield', 'slowmo', 'phase', 'coin'];
function spawnPowerUp(sx: number, sy: number, heading: number): PowerUp {
  const spread = rnd(-1.2, 1.2);
  const dist = rnd(6, 14);
  return {
    id: ++pwIdN,
    x: sx + Math.cos(heading + spread) * dist,
    y: sy + Math.sin(heading + spread) * dist,
    type: PWR_TYPES[Math.floor(Math.random() * PWR_TYPES.length)],
    life: 0,
    maxLife: PWR_LIFE,
  };
}

/* ═══════════════════════════════════════════════════
   Camera
   ═══════════════════════════════════════════════════ */

function Cam({
  sPos,
  shake,
  gs,
}: {
  sPos: React.MutableRefObject<{ x: number; y: number }>;
  shake: React.MutableRefObject<number>;
  gs: GameState;
}) {
  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.033);
    const tx = gs === 'playing' ? sPos.current.x : 0;
    const ty = gs === 'playing' ? sPos.current.y : 0;
    let sx = 0,
      sy = 0;
    if (shake.current > 0.01) {
      const shakeScale = IS_MOBILE ? 0.42 : 0.6;
      sx = (Math.random() - 0.5) * shake.current * shakeScale;
      sy = (Math.random() - 0.5) * shake.current * shakeScale;
      shake.current = Math.max(0, shake.current - dt * 4);
    }
    camera.position.x = slerp(camera.position.x, tx + sx, 10, dt);
    camera.position.y = slerp(camera.position.y, ty + sy, 10, dt);
    camera.position.z = CAM_Z;
    camera.lookAt(camera.position.x, camera.position.y, 0);
  });
  return null;
}

/* ═══════════════════════════════════════════════════
   SPACE BACKGROUND — cinematic starfield + nebula
   No drei Stars! Pure shader with proper star rendering.
   ═══════════════════════════════════════════════════ */

function SpaceBG() {
  const ref = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (ref.current) ref.current.uniforms.uTime.value = s.clock.elapsedTime;
    if (meshRef.current) {
      meshRef.current.position.x = s.camera.position.x;
      meshRef.current.position.y = s.camera.position.y;
    }
  });

  const shader = useMemo(
    () => ({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
      #define FBM_ITER ${IS_MOBILE ? 3 : 7}
      #define STAR_LAYERS ${IS_MOBILE ? 2 : 4}
      uniform float uTime;
      varying vec2 vUv;

      vec2 hash22(vec2 p) {
        p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
        return fract(sin(p)*43758.5453);
      }
      float hash21(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p);
        float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
        vec2 u=f*f*(3.-2.*f);
        return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
      }

      float fbm(vec2 p) {
        float v=0., a=.5;
        mat2 rot=mat2(.8,-.6,.6,.8);
        for(int i=0; i<FBM_ITER; i++) { v+=a*noise(p); p=rot*p*2.05; a*=.47; }
        return v;
      }

      vec3 renderStars(vec2 uv, float cellSize, float density, float sizeMin, float sizeMax) {
        vec3 col = vec3(0.);
        vec2 id = floor(uv * cellSize);
        vec2 gv = fract(uv * cellSize);

        for(int dy=-1; dy<=1; dy++) {
          for(int dx=-1; dx<=1; dx++) {
            vec2 offset = vec2(float(dx), float(dy));
            vec2 cellId = id + offset;
            vec2 rh = hash22(cellId);

            if(rh.x > density) continue;

            vec2 starPos = offset + rh - gv;
            float d = length(starPos);

            float size = sizeMin + (sizeMax - sizeMin) * hash21(cellId + 42.);
            float brightness = smoothstep(size, size * .1, d);

            float twinkle = .65 + .35 * sin(uTime * (1. + hash21(cellId + 99.) * 4.) + hash21(cellId) * 6.28);
            brightness *= twinkle;

            float temp = hash21(cellId + 55.);
            vec3 starCol;
            if(temp < .2) starCol = vec3(.7, .8, 1.);
            else if(temp < .5) starCol = vec3(.95, .95, 1.);
            else if(temp < .8) starCol = vec3(1., .95, .85);
            else starCol = vec3(1., .85, .7);

            float glow = exp(-d * d / (size * size * 8.)) * .3;
            col += starCol * (brightness + glow);
          }
        }
        return col;
      }

      void main() {
        vec2 uv = vUv;
        vec2 cuv = (uv - .5) * 2.;
        float r = length(cuv);

        vec3 col = vec3(.10, .08, .22);

        float n1 = fbm(cuv * 1.5 + vec2(uTime*.008, -uTime*.005));
        float n2 = fbm(cuv * 3.0 + vec2(-uTime*.004, uTime*.01));
        float n3 = fbm(cuv * 2.0 + vec2(uTime*.003, uTime*.003));

        col = mix(col, vec3(.28, .12, .38), smoothstep(.22, .55, n1) * .7);
        col = mix(col, vec3(.12, .15, .38), smoothstep(.28, .6, n2) * .6);
        col = mix(col, vec3(.10, .20, .35), smoothstep(.35, .68, n3) * .5);

        float glow = exp(-r * 1.5) * .22;
        col += vec3(.12, .10, .28) * glow;

        col += renderStars(uv, 40., .55, .015, .03) * .18;
        col += renderStars(uv, 100., .60, .008, .02) * .14;
#if STAR_LAYERS > 2
        col += renderStars(uv, 250., .65, .005, .012) * .08;
        col += renderStars(uv, 600., .70, .003, .008) * .06;
#endif

        float vig = 1. - smoothstep(.85, 1.55, r);
        gl_FragColor = vec4(col, vig);
      }
    `,
      transparent: true,
    }),
    [],
  );

  return (
    <mesh ref={meshRef} position={[0, 0, -14]}>
      <planeGeometry args={[200, 200]} />
      <shaderMaterial ref={ref} {...shader} depthWrite={false} />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════
   Dust particles
   ═══════════════════════════════════════════════════ */

function Dust() {
  const N = IS_MOBILE ? 80 : 500;
  const ref = useRef<THREE.Points>(null);
  const frameSkip = useRef(0);
  const { pos, col } = useMemo(() => {
    const p = new Float32Array(N * 3),
      c = new Float32Array(N * 3);
    const cs = [
      [0.2, 0.3, 0.55],
      [0.35, 0.2, 0.45],
      [0.1, 0.4, 0.45],
      [0.3, 0.25, 0.5],
    ];
    for (let i = 0; i < N; i++) {
      p[i * 3] = (Math.random() - 0.5) * 140;
      p[i * 3 + 1] = (Math.random() - 0.5) * 140;
      p[i * 3 + 2] = (Math.random() - 0.5) * 26 - 5;
      const cc = cs[Math.floor(Math.random() * cs.length)];
      c[i * 3] = cc[0];
      c[i * 3 + 1] = cc[1];
      c[i * 3 + 2] = cc[2];
    }
    return { pos: p, col: c };
  }, []);

  useFrame((s, d) => {
    if (!ref.current) return;
    ref.current.position.x = s.camera.position.x;
    ref.current.position.y = s.camera.position.y;
    if (IS_MOBILE) {
      frameSkip.current++;
      if (frameSkip.current % 4 !== 0) return;
    }
    const dt = Math.min(d, 0.033) * (IS_MOBILE ? 4 : 1);
    ref.current.rotation.z += dt * 0.0015;
    const a = ref.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < N; i++) {
      a[i * 3] += dt * 0.2;
      a[i * 3 + 1] += dt * 0.07;
      if (a[i * 3] > 70) a[i * 3] = -70;
      if (a[i * 3 + 1] > 70) a[i * 3 + 1] = -70;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
        <bufferAttribute attach="attributes-color" args={[col, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        vertexColors
        transparent
        opacity={0.22}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

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
    // Spawn new comet periodically
    if (timer.current > (IS_MOBILE ? 3.5 : 2.0)) {
      timer.current = 0;
      for (let ci = 0; ci < data.current.length; ci++) {
        const c = data.current[ci];
        if (!c.active) {
          // Spawn from random edge: 0=top, 1=right, 2=bottom, 3=left
          const edge = Math.floor(Math.random() * 4);
          const speed = 20 + Math.random() * 40;
          const spread = 60;
          if (edge === 0) {
            c.x = cx + (Math.random() - 0.5) * spread;
            c.y = cy + 25 + Math.random() * 10;
          } else if (edge === 1) {
            c.x = cx + 30 + Math.random() * 10;
            c.y = cy + (Math.random() - 0.5) * spread;
          } else if (edge === 2) {
            c.x = cx + (Math.random() - 0.5) * spread;
            c.y = cy - 25 - Math.random() * 10;
          } else {
            c.x = cx - 30 - Math.random() * 10;
            c.y = cy + (Math.random() - 0.5) * spread;
          }
          // Aim roughly toward center with randomness
          const toCx = cx - c.x + (Math.random() - 0.5) * 30;
          const toCy = cy - c.y + (Math.random() - 0.5) * 30;
          const ang = Math.atan2(toCy, toCx);
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
      const angle = Math.atan2(c.vy, c.vx);
      m.rotation.z = angle;
      const fade = Math.min(1, c.life * 3) * Math.min(1, (c.maxLife - c.life) * 2);
      (m.material as THREE.MeshBasicMaterial).opacity = fade * 0.35;
      m.scale.set(1, 1, 1);
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

/* OrbitRings and CoreBeacon removed — no fixed center */
/* ═══════════════════════════════════════════════════
   BLACK HOLES — event horizon + accretion disk + corona
   ═══════════════════════════════════════════════════ */

// Pre-created BH geometries (medium size)
const _bhCircleGeo = new THREE.CircleGeometry(1.0, IS_MOBILE ? 48 : 64);
const _bhRingGeo = new THREE.RingGeometry(1.0, 1.3, IS_MOBILE ? 48 : 64);
const _bhGlowGeo = new THREE.CircleGeometry(2.2, IS_MOBILE ? 48 : 64);
const _bhOuterGeo = new THREE.CircleGeometry(3.0, IS_MOBILE ? 48 : 64);
const _bhAccretionGeo = new THREE.RingGeometry(1.2, 2.8, IS_MOBILE ? 48 : 96);

const BH_SPIRAL_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const BH_SPIRAL_FS = IS_MOBILE
  ? `
  uniform float uTime; uniform float uFade; varying vec2 vUv;
  void main(){
    float t = mod(uTime, 62.83);
    vec2 c = vUv - .5; float r = length(c); float a = atan(c.y, c.x);
    float hole = smoothstep(.12, .08, r);
    float arm = sin(a * 2.0 - r * 14.0 + t * 2.5) * .5 + .5;
    float disk = arm * smoothstep(.5, .13, r) * smoothstep(.08, .15, r);
    float ring = exp(-pow((r - .13) * 25.0, 2.0)) * 1.0;
    float alpha = (disk * .6 + ring) * uFade * (1.0 - hole * .9);
    vec3 col = mix(vec3(.3, .1, .7), vec3(.7, .8, 1.), smoothstep(.3, .12, r)) * disk + vec3(.8, .85, 1.) * ring;
    col *= (1.0 - hole * .85);
    gl_FragColor = vec4(col, alpha);
  }
`
  : `
  uniform float uTime; uniform float uFade; varying vec2 vUv;
  void main(){
    float t = mod(uTime, 62.83);
    vec2 c = vUv - .5; float r = length(c); float a = atan(c.y, c.x);
    float hole = smoothstep(.12, .08, r);
    float arm1 = sin(a * 2.0 - r * 18.0 + t * 3.0) * .5 + .5;
    float arm2 = sin(a * 3.0 + r * 14.0 - t * 2.2 + 1.5) * .5 + .5;
    float disk = max(arm1, arm2 * .7) * smoothstep(.5, .13, r) * smoothstep(.08, .15, r);
    float photonRing = exp(-pow((r - .13) * 30.0, 2.0)) * 1.2;
    float corona = smoothstep(.5, .1, r) * .3 * (1.0 + sin(t * 1.8 + a * 2.0) * .15);
    float lensRing = exp(-pow((r - .42) * 8.0, 2.0)) * .18;
    float alpha = (disk * .8 + photonRing + corona + lensRing) * uFade * (1.0 - hole * .95);
    vec3 hotColor = mix(vec3(.3, .1, .7), vec3(.7, .8, 1.), smoothstep(.3, .12, r));
    vec3 coreColor = vec3(.8, .85, 1.) * photonRing;
    vec3 outerColor = vec3(.2, .1, .5) * corona;
    vec3 lensColor = vec3(.3, .5, 1.) * lensRing;
    vec3 col = hotColor * disk + coreColor + outerColor + lensColor;
    col *= (1.0 - hole * .9);
    gl_FragColor = vec4(col, alpha);
  }
`;

function BHVisuals({ bhRef }: { bhRef: React.MutableRefObject<BHole[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const spiralMats = useRef<(THREE.ShaderMaterial | null)[]>([]);
  const warmFrames = useRef(0);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Warm-up pass: render ALL BH groups for 3 frames to fully warm GPU pipeline
    if (warmFrames.current < 3) {
      warmFrames.current++;
      for (let i = 0; i < BH_N; i++) {
        const g = refs.current[i];
        if (g) {
          g.visible = true;
          g.scale.setScalar(0.001);
          g.position.set(9999, 9999, 0);
        }
        const sm = spiralMats.current[i];
        if (sm) {
          sm.uniforms.uFade.value = 0.01;
          sm.uniforms.uTime.value = t;
        }
      }
      if (warmFrames.current < 3) return;
    }
    for (let i = 0; i < BH_N; i++) {
      const g = refs.current[i];
      const w = bhRef.current[i];
      if (!g) continue;
      if (!w) {
        g.visible = false;
        continue;
      }
      const fadeIn = Math.min(1, w.life * 1.5);
      const fadeOut = Math.min(1, (w.maxLife - w.life) * 1.5);
      const fade = Math.min(fadeIn, fadeOut);
      g.visible = fade > 0.02;
      g.position.set(w.x, w.y, 0);
      const sc = (1.2 + (w.str / BH_STR) * 0.4) * 0.7;
      g.scale.setScalar(sc);

      // [0] Event horizon — pure black core
      const coreMat = (g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (coreMat) coreMat.opacity = fade;

      // [1] Shader spiral disk
      const sm = spiralMats.current[i];
      if (sm) {
        sm.uniforms.uTime.value = t;
        sm.uniforms.uFade.value = fade * 0.8;
      }
      (g.children[1] as THREE.Mesh).rotation.z = (t % 62.83) * (0.3 + i * 0.05);

      // [2] Soft glow (smooth continuous pulse)
      const glowM = (g.children[2] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (glowM) {
        glowM.opacity = fade * (0.12 + Math.sin(t * 0.8 + i * 2.1) * 0.04);
      }

      // [3] Point light — very tight radius to avoid lighting asteroids
      const light = g.children[3] as THREE.PointLight;
      if (light) {
        light.intensity = fade * 1.2;
        light.distance = 3;
      }
    }
  });

  return (
    <>
      {Array.from({ length: BH_N }).map((_, i) => (
        <group
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          visible={false}
        >
          {/* [0] Event horizon — pure black core */}
          <mesh geometry={_bhCircleGeo}>
            <meshBasicMaterial color="#000000" transparent opacity={0} />
          </mesh>
          {/* [1] Shader spiral disk */}
          <mesh geometry={_bhCircleGeo} position={[0, 0, 0.01]} scale={[3.2, 3.2, 1]}>
            <shaderMaterial
              ref={(el) => {
                spiralMats.current[i] = el;
              }}
              uniforms={{ uTime: { value: 0 }, uFade: { value: 0 } }}
              vertexShader={BH_SPIRAL_VS}
              fragmentShader={BH_SPIRAL_FS}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          {/* [2] Soft glow */}
          <mesh geometry={_bhGlowGeo} position={[0, 0, -0.01]}>
            <meshBasicMaterial
              color="#4422aa"
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          {/* [3] Point light */}
          <pointLight color="#6633cc" intensity={0} distance={10} />
        </group>
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Ship
   ═══════════════════════════════════════════════════ */

function Ship({
  posRef,
  headRef,
  color,
  scale,
  nearRef,
  shieldRef,
  phaseRef,
  skinId,
  shipAura,
}: {
  posRef: React.MutableRefObject<{ x: number; y: number }>;
  headRef: React.MutableRefObject<number>;
  color: string;
  scale: number;
  nearRef: React.MutableRefObject<number>;
  shieldRef: React.MutableRefObject<number>;
  phaseRef: React.MutableRefObject<number>;
  skinId?: string | null;
  shipAura?: string | null;
}) {
  const ac = (shipAura && AURA_GAME_COLORS[shipAura]) || DEFAULT_SHIP_COLORS;
  const profile = useMemo(() => getShipProfile(skinId), [skinId]);
  const gRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const shRef = useRef<THREE.Mesh>(null);
  const shieldBub = useRef<THREE.Group>(null);
  const shipMatRef = useRef<THREE.MeshBasicMaterial>(null);
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
  const _shieldEdgeGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.66, 1)), []);
  const trailRef = useRef<THREE.InstancedMesh>(null);
  const TRAIL_N = IS_MOBILE ? 60 : 100;
  const TRAIL_LIFE = 2.0;
  const trailData = useRef<{ x: number; y: number; age: number; sz: number }[]>([]);
  const trailIdx = useRef(0);
  const trailTimer = useRef(0);
  const _trailDummy = useMemo(() => new THREE.Object3D(), []);
  const _trailColor = useMemo(() => new THREE.Color(), []);
  const _trailGeo = useMemo(() => new THREE.CircleGeometry(0.12, 6), []);
  const _trailMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  if (trailData.current.length === 0) {
    for (let i = 0; i < TRAIL_N; i++) trailData.current.push({ x: 0, y: 0, age: 999, sz: 0 });
  }
  // Hide all instances on first mount to prevent white flash
  useEffect(() => {
    const mesh = trailRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    dummy.position.set(0, 0, -5000);
    dummy.scale.setScalar(0.001);
    dummy.updateMatrix();
    for (let i = 0; i < TRAIL_N; i++) mesh.setMatrixAt(i, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }, []);
  const texPath = skinId ? `/textures/ships/ship_${skinId.replace('ship_', '')}.png` : '/textures/ship.png';
  const shipTex = useLoader(THREE.TextureLoader, texPath);
  shipTex.colorSpace = THREE.SRGBColorSpace;
  shipTex.minFilter = THREE.LinearMipmapLinearFilter;
  shipTex.anisotropy = 16;

  useFrame((s, delta) => {
    if (!gRef.current) return;
    const dt = Math.min(delta, 0.033);
    const t = s.clock.elapsedTime;
    const tx = posRef.current.x,
      ty = posRef.current.y;
    gRef.current.position.x = slerp(gRef.current.position.x, tx, 8, dt);
    gRef.current.position.y = slerp(gRef.current.position.y, ty, 8, dt);
    const targetRot = headRef.current - Math.PI / 2;
    const curRot = gRef.current.rotation.z;
    let rotDiff = targetRot - curRot;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    gRef.current.rotation.z = curRot + rotDiff * (1 - Math.exp(-10 * dt));
    if (shRef.current) {
      const m = shRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = slerp(m.opacity, nearRef.current > 0.1 ? 0.15 * nearRef.current : 0, 10, dt);
    }
    if (shipMatRef.current) {
      shipMatRef.current.opacity = phaseRef.current > 0 ? 0.2 + Math.sin(t * 10) * 0.1 : 1;
    }
    // Aura pulse
    if (auraMat.current) {
      auraMat.current.opacity = 0.65 + 0.15 * Math.sin(t * 2.0);
    }
    const shieldOn = shieldRef.current > 0;
    if (shieldBub.current) {
      shieldBub.current.visible = shieldOn;
      if (shieldOn) {
        shieldBub.current.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
        shieldBub.current.rotation.y = t * 1.5;
      }
    }
    // InstancedMesh trail — scattered dot trail in world space
    const rot = gRef.current.rotation.z;
    const cx = gRef.current.position.x,
      cy = gRef.current.position.y;
    const cosR = Math.cos(rot),
      sinR = Math.sin(rot);
    trailTimer.current += dt;
    const spawnInterval = IS_MOBILE ? 0.025 : 0.018;
    const exhs = profile.exhausts;
    const isBio = profile.trailStyle === 'bio';
    const exhSpread = (isBio ? 0.7 : 0.35) * scale;
    while (trailTimer.current >= spawnInterval) {
      trailTimer.current -= spawnInterval;
      const exh = exhs[Math.floor(Math.random() * exhs.length)];
      const exhScale = scale * 1.4;
      const lx = exh.x * exhScale;
      const ly = exh.y * exhScale;
      const wx = cx + (lx * cosR - ly * sinR) + (Math.random() - 0.5) * exhSpread;
      const wy = cy + (lx * sinR + ly * cosR) + (Math.random() - 0.5) * exhSpread;
      const i = trailIdx.current % TRAIL_N;
      trailData.current[i].x = wx;
      trailData.current[i].y = wy;
      trailData.current[i].age = 0;
      trailData.current[i].sz = isBio ? 0.25 + Math.random() * 0.25 : 0.15 + Math.random() * 0.15;
      trailIdx.current++;
    }
    const mesh = trailRef.current;
    const [tcR, tcG, tcB] = profile.trailColor;
    if (mesh) {
      for (let i = 0; i < TRAIL_N; i++) {
        const d = trailData.current[i];
        d.age += dt;
        // Bio trail: strong sinusoidal wave + vertical drift
        if (isBio) {
          d.x += Math.sin(d.age * 4 + i * 1.2) * 1.2 * scale * dt;
          d.y += Math.cos(d.age * 3 + i * 0.9) * 0.6 * scale * dt;
        }
        const life = d.age / TRAIL_LIFE;
        if (life >= 1 || d.sz === 0) {
          _trailDummy.position.set(0, 0, -9999);
          _trailDummy.scale.setScalar(0.001);
          _trailColor.setRGB(0, 0, 0);
          mesh.setColorAt(i, _trailColor);
        } else {
          const fade = Math.pow(1 - life, isBio ? 0.6 : 1.2);
          const pulse = isBio ? 0.5 + 0.5 * Math.sin(d.age * 6 + i * 0.8) : 1;
          const sz = d.sz * (0.5 + 0.5 * fade) * pulse;
          _trailDummy.position.set(d.x, d.y, 0.2);
          _trailDummy.scale.setScalar(Math.max(sz, 0.01));
          if (isBio) {
            // Color shifts green↔teal with age
            const hueShift = Math.sin(d.age * 3 + i) * 0.3;
            _trailColor.setRGB(tcR * fade + hueShift * 0.1, tcG * fade, (tcB + hueShift * 0.2) * fade);
          } else {
            _trailColor.setRGB(tcR * fade, tcG * fade, tcB * fade);
          }
          mesh.setColorAt(i, _trailColor);
        }
        _trailDummy.updateMatrix();
        mesh.setMatrixAt(i, _trailDummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  const shipBody = (
    <>
      {/* Ship sprite */}
      <mesh>
        <planeGeometry args={[1.6, 2.2]} />
        <meshBasicMaterial ref={shipMatRef} map={shipTex} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );

  return (
    <>
      <group ref={gRef} scale={[scale, scale, scale]}>
        <group ref={bodyRef} position-y={profile.spriteYOff || 0}>
          {shipBody}
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
              opacity={0.5}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )}
        <mesh ref={shRef}>
          <ringGeometry args={[1, 1.15, 32]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* Shield — hex-panel geodesic */}
        <group ref={shieldBub} visible={false}>
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
          {/* Shield glow — no pointLight to avoid illuminating asteroids */}
        </group>
      </group>
      {/* World-space instancedMesh trail */}
      <instancedMesh ref={trailRef} args={[_trailGeo, _trailMat, TRAIL_N]} frustumCulled={false} renderOrder={10} />
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Asteroid mesh
   ═══════════════════════════════════════════════════ */

function AstMesh({ a, geos }: { a: AsteroidData; geos: THREE.SphereGeometry[] }) {
  const geo = geos[a.gi % geos.length];
  const pair = AST_TEX_PAIRS[a.mi % AST_TEX_PAIRS.length];
  const m = AST_M[a.mi % AST_M.length];
  return (
    <mesh
      geometry={geo}
      position={[a.x, a.y, 0]}
      rotation={[a.rx, a.ry, a.rz]}
      scale={[a.r * a.sx, a.r * a.sy, a.r * a.sz]}
    >
      <meshLambertMaterial map={pair.diffuse} color="#d8dce8" side={THREE.DoubleSide} />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════
   Explosion
   ═══════════════════════════════════════════════════ */

function Explosion({
  pRef,
  actRef,
}: {
  pRef: React.MutableRefObject<{ x: number; y: number }>;
  actRef: React.MutableRefObject<boolean>;
}) {
  const ptRef = useRef<THREE.Points>(null);
  const tRef = useRef(0);
  const st = useMemo(() => {
    const p = new Float32Array(EXPLODE_N * 3),
      v = new Float32Array(EXPLODE_N * 3),
      c = new Float32Array(EXPLODE_N * 3);
    for (let i = 0; i < EXPLODE_N; i++) {
      const a = Math.random() * 6.28,
        s = 3 + Math.random() * 14;
      v[i * 3] = Math.cos(a) * s;
      v[i * 3 + 1] = Math.sin(a) * s;
      v[i * 3 + 2] = (Math.random() - 0.5) * 4;
      c[i * 3] = 0.9 + Math.random() * 0.1;
      c[i * 3 + 1] = 0.2 + Math.random() * 0.4;
      c[i * 3 + 2] = Math.random() * 0.15;
      p[i * 3] = 0;
      p[i * 3 + 1] = 0;
      p[i * 3 + 2] = -500;
    }
    return { p, v, c };
  }, []);
  const wasActive = useRef(false);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.033);
    if (!actRef.current) {
      wasActive.current = false;
      if (ptRef.current) ptRef.current.visible = false;
      return;
    }
    // Reset on fresh explosion
    if (!wasActive.current) {
      wasActive.current = true;
      tRef.current = 0;
      for (let i = 0; i < EXPLODE_N; i++) {
        const a = Math.random() * 6.28,
          s = 3 + Math.random() * 14;
        st.v[i * 3] = Math.cos(a) * s;
        st.v[i * 3 + 1] = Math.sin(a) * s;
        st.v[i * 3 + 2] = (Math.random() - 0.5) * 4;
      }
    }
    tRef.current += dt;
    const t = tRef.current;
    if (t > 2.5) {
      actRef.current = false;
      return;
    }
    if (ptRef.current) {
      ptRef.current.visible = true;
      ptRef.current.renderOrder = 999;
      const a = ptRef.current.geometry.attributes.position.array as Float32Array;
      const px = pRef.current.x,
        py = pRef.current.y;
      for (let i = 0; i < EXPLODE_N; i++) {
        if (t < 0.05) {
          a[i * 3] = px;
          a[i * 3 + 1] = py;
          a[i * 3 + 2] = 0;
        } else {
          a[i * 3] += st.v[i * 3] * dt;
          a[i * 3 + 1] += st.v[i * 3 + 1] * dt;
          a[i * 3 + 2] += st.v[i * 3 + 2] * dt;
          st.v[i * 3] *= 0.97;
          st.v[i * 3 + 1] *= 0.97;
          st.v[i * 3 + 2] *= 0.97;
        }
      }
      ptRef.current.geometry.attributes.position.needsUpdate = true;
      const m = ptRef.current.material as THREE.PointsMaterial;
      m.opacity = Math.max(0, 1 - t / 2.2);
      m.size = 0.35 + t * 0.12;
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
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Power-up pickups — shield, clock, ghost, coin icons
   ═══════════════════════════════════════════════════ */

const PWR_COL: Record<PwrType, string> = { shield: '#22d3ee', slowmo: '#facc15', phase: '#a855f7', coin: '#fbbf24' };

const S_PWR_TEX_PATHS: Record<PwrType, string> = {
  shield: '/textures/powerups/powerup_shield.png',
  slowmo: '/textures/powerups/powerup_slowmo.png',
  phase: '/textures/powerups/powerup_phase.png',
  coin: '/textures/powerups/powerup_coin.png',
};
const S_PWR_TYPE_LIST: PwrType[] = ['shield', 'slowmo', 'phase', 'coin'];
const _sPwrDiscGeo = new THREE.CircleGeometry(0.5, 64);
const _sPwrEdgeGeo = new THREE.TorusGeometry(0.48, 0.018, 16, 64);

function PowerUpVisuals({ pwRef }: { pwRef: React.MutableRefObject<PowerUp[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const lastTypes = useRef<(PwrType | null)[]>(Array(PWR_MAX).fill(null));
  const faceMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const edgeMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const sPwrTexMap = useRef<Record<string, THREE.Texture>>({});
  const allSPwrTexPaths = useMemo(() => S_PWR_TYPE_LIST.map((t) => S_PWR_TEX_PATHS[t]), []);
  const allSPwrTextures = useLoader(THREE.TextureLoader, allSPwrTexPaths);
  useMemo(() => {
    for (let i = 0; i < S_PWR_TYPE_LIST.length; i++) {
      const tex = allSPwrTextures[i];
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 16;
      tex.generateMipmaps = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      sPwrTexMap.current[S_PWR_TYPE_LIST[i]] = tex;
    }
  }, [allSPwrTextures]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let i = 0; i < PWR_MAX; i++) {
      const g = refs.current[i];
      const pw = pwRef.current[i];
      if (!g) continue;
      if (!pw) {
        g.visible = false;
        lastTypes.current[i] = null;
        continue;
      }
      const fadeIn = Math.min(1, pw.life * 2);
      const fadeOut = Math.min(1, (pw.maxLife - pw.life) * 2);
      const fade = Math.min(fadeIn, fadeOut);
      g.visible = fade > 0.02;
      g.position.set(pw.x, pw.y, Math.sin(t * 2.5 + i * 3) * 0.15);
      g.rotation.y = t * 1.8 + i * 1.5;
      g.scale.setScalar(1.3);

      if (pw.type !== lastTypes.current[i]) {
        lastTypes.current[i] = pw.type;
        const tex = sPwrTexMap.current[pw.type];
        const mat = faceMats.current[i];
        if (tex && mat) {
          mat.map = tex;
          mat.needsUpdate = true;
        }
      }
      // Always sync edge color + fade every frame
      const mat = faceMats.current[i];
      if (mat) {
        mat.opacity = fade;
      }
      const eMat = edgeMats.current[i];
      if (eMat) {
        eMat.color.set(PWR_COL[pw.type]);
        eMat.opacity = fade * 0.7;
      }
    }
  });

  return (
    <>
      {Array.from({ length: PWR_MAX }).map((_, i) => {
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
            <mesh geometry={_sPwrDiscGeo} material={faceMats.current[i]} position={[0, 0, 0.03]} />
            <mesh
              geometry={_sPwrDiscGeo}
              material={faceMats.current[i]}
              position={[0, 0, -0.03]}
              rotation={[0, Math.PI, 0]}
            />
            <mesh geometry={_sPwrEdgeGeo} material={edgeMats.current[i]} />
          </group>
        );
      })}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Pickup effect — particles on power-up collect
   ═══════════════════════════════════════════════════ */

const PICKUP_PARTICLES = 24;
function PickupEffect({
  pickupRef,
}: {
  pickupRef: React.MutableRefObject<{ active: boolean; type: PwrType; x: number; y: number; t: number }>;
}) {
  const ptsRef = useRef<THREE.Points>(null);
  const st = useMemo(() => {
    const p = new Float32Array(PICKUP_PARTICLES * 3);
    const v = new Float32Array(PICKUP_PARTICLES * 3);
    const v0 = new Float32Array(PICKUP_PARTICLES * 3);
    for (let i = 0; i < PICKUP_PARTICLES; i++) {
      const a = (i / PICKUP_PARTICLES) * 6.28,
        s = 2 + Math.random() * 6;
      v[i * 3] = v0[i * 3] = Math.cos(a) * s;
      v[i * 3 + 1] = v0[i * 3 + 1] = Math.sin(a) * s;
      v[i * 3 + 2] = v0[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }
    return { p, v, v0 };
  }, []);

  useFrame((_, dt) => {
    const r = pickupRef.current;
    if (!r?.active || !ptsRef.current) return;
    r.t += dt;
    if (r.t > 1.4) {
      r.active = false;
      return;
    }
    ptsRef.current.visible = true;
    ptsRef.current.position.set(r.x, r.y, 0);
    const a = ptsRef.current.geometry.attributes.position.array as Float32Array;
    if (r.t < 0.02) {
      for (let i = 0; i < PICKUP_PARTICLES; i++) {
        a[i * 3] = a[i * 3 + 1] = a[i * 3 + 2] = 0;
        st.v[i * 3] = st.v0[i * 3];
        st.v[i * 3 + 1] = st.v0[i * 3 + 1];
        st.v[i * 3 + 2] = st.v0[i * 3 + 2];
      }
    } else {
      for (let i = 0; i < PICKUP_PARTICLES; i++) {
        a[i * 3] += st.v[i * 3] * dt;
        a[i * 3 + 1] += st.v[i * 3 + 1] * dt;
        a[i * 3 + 2] += st.v[i * 3 + 2] * dt;
        st.v[i * 3] *= 0.92;
        st.v[i * 3 + 1] *= 0.92;
        st.v[i * 3 + 2] *= 0.92;
      }
    }
    ptsRef.current.geometry.attributes.position.needsUpdate = true;
    const m = ptsRef.current.material as THREE.PointsMaterial;
    m.color.set(PWR_COL[r.type]);
    m.opacity = Math.max(0, 1 - r.t / 1.2);
  });

  return (
    <points ref={ptsRef} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[st.p, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.14} transparent sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

/* ═══════════════════════════════════════════════════
   Post-processing — CLEAN, not blurry
   ═══════════════════════════════════════════════════ */

function FX() {
  return null;
}

/* ═══════════════════════════════════════════════════
   Instanced asteroid renderer — 4 draw calls total
   ═══════════════════════════════════════════════════ */

const _dummy = new THREE.Object3D();

function AsteroidInstances({
  pool,
  geos,
}: {
  pool: React.MutableRefObject<AsteroidData[]>;
  geos: THREE.SphereGeometry[];
}) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);

  const _counts = useMemo(() => new Array(AST_MAT_COUNT).fill(0), []);
  useFrame(() => {
    const counts = _counts;
    for (let ci = 0; ci < counts.length; ci++) counts[ci] = 0;
    const poolArr = pool.current;
    for (let i = 0; i < poolArr.length; i++) {
      const a = poolArr[i];
      if (!a.active) continue;
      const matIdx = a.mi % AST_MAT_COUNT;
      const im = refs.current[matIdx];
      if (!im) continue;
      const idx = counts[matIdx];
      _dummy.position.set(a.x, a.y, 0);
      _dummy.rotation.set(a.rx, a.ry, a.rz);
      _dummy.scale.set(a.r * a.sx, a.r * a.sy, a.r * a.sz);
      _dummy.updateMatrix();
      im.setMatrixAt(idx, _dummy.matrix);
      counts[matIdx]++;
    }
    for (let i = 0; i < refs.current.length; i++) {
      const im = refs.current[i];
      if (!im) continue;
      im.count = counts[i];
      im.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {AST_SHARED_MATS.map((mat, texIdx) => (
        <instancedMesh
          key={texIdx}
          ref={(el: THREE.InstancedMesh | null) => {
            refs.current[texIdx] = el;
          }}
          args={[geos[texIdx % geos.length], mat, MAX_ASTEROIDS]}
          frustumCulled={false}
        />
      ))}
    </>
  );
}

function GameWorld({
  gameState,
  onGameOver,
  onScore,
  onCoins,
  onCombo,
  reviveRef,
  traits,
  hasMintedId,
  shipSkin,
  shipAura,
  shipStats,
  challengeMode,
}: GameProps) {
  const coinMult = hasMintedId ? 2 : 1;
  const asteroidPool = useRef<AsteroidData[]>([]);

  useMemo(() => {
    asteroidPool.current = Array.from({ length: MAX_ASTEROIDS }, (_, i) => ({
      id: i,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      rsx: 0,
      rsy: 0,
      rsz: 0,
      sx: 1,
      sy: 1,
      sz: 1,
      gi: 0,
      mi: 0,
      small: false,
      active: false,
      wobbleAmp: 0,
      wobbleFreq: 0,
      wobblePhase: 0,
      spawnTime: 0,
      scored: false,
    }));
  }, []);

  const shipPos = useRef({ x: 5, y: 0 });
  const shipHead = useRef(Math.PI / 2);
  const orbDir = useRef<1 | -1>(1);
  const headingBoost = useRef(0);
  const curSpeed = useRef(INIT_SPEED);
  const nearMiss = useRef(0);
  const bhs = useRef<BHole[]>([]);
  const bhTimer = useRef(0);
  const pws = useRef<PowerUp[]>([]);
  const pwTimer = useRef(0);
  const shieldT = useRef(0);
  const slowmoT = useRef(0);
  const phaseT = useRef(0);
  const elapsed = useRef(0);
  const spawnT = useRef(0);
  const overRef = useRef(false);
  const tabHiddenRef = useRef(false);
  const scoreRef = useRef(-1);
  const shake = useRef(0);
  const explPos = useRef({ x: 0, y: 0 });
  const explAct = useRef(false);
  const bonusPoints = useRef(0);
  const coinBank = useRef(0);
  const coinAccum = useRef(0);
  const streak = useRef(0);
  const streakTimer = useRef(0);
  const pickupEffect = useRef({ active: false, type: 'shield' as PwrType, x: 0, y: 0, t: 0 });
  const _activeIdx = useRef(new Int32Array(MAX_ASTEROIDS));

  const sCol = traits?.planetTier ? TIER_COLORS[traits.planetTier] || '#22d3ee' : '#22d3ee';
  const sSc = traits?.planetTier === 'binary_sun' ? 1.05 : 1.0;

  const geos = useMemo(() => {
    const s = IS_MOBILE ? 0.7 : 1;
    const seg = (n: number) => Math.max(16, Math.round(n * s));
    return [
      makeRockGeo(seg(28), 41),
      makeRockGeo(seg(26), 67),
      makeRockGeo(seg(30), 89),
      makeRockGeo(seg(28), 97),
      makeRockGeo(seg(26), 131),
      makeRockGeo(seg(30), 157),
      makeRockGeo(seg(24), 211),
      makeRockGeo(seg(32), 263),
    ];
  }, []);

  useEffect(
    () => () => {
      geos.forEach((g) => g.dispose());
    },
    [geos],
  );

  useEffect(() => {
    if (gameState !== 'playing') return;
    const rev = () => {
      orbDir.current = orbDir.current === 1 ? -1 : 1;
      headingBoost.current = TAP_BOOST * orbDir.current;
      sfxTap();
    };
    const onK = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        rev();
      }
    };
    const onM = (e: MouseEvent) => {
      if (e.button === 0) rev();
    };
    const onT = (e: TouchEvent) => {
      if (overRef.current) return;
      e.preventDefault();
      rev();
    };
    window.addEventListener('keydown', onK);
    window.addEventListener('mousedown', onM);
    window.addEventListener('touchstart', onT, { passive: false });
    return () => {
      window.removeEventListener('keydown', onK);
      window.removeEventListener('mousedown', onM);
      window.removeEventListener('touchstart', onT);
    };
  }, [gameState]);

  useEffect(() => {
    if (gameState !== 'playing') return;
    aidN = 0;
    pwIdN = 0;

    // Reset pool
    asteroidPool.current.forEach((a) => {
      a.active = false;
    });

    shipPos.current = { x: 5, y: 0 };
    shipHead.current = Math.PI / 2;
    orbDir.current = 1;
    curSpeed.current = INIT_SPEED;
    nearMiss.current = 0;
    headingBoost.current = 0;
    bhs.current = [spawnBH(5, 0)];
    bhTimer.current = 0;
    pws.current = [];
    pwTimer.current = 0;
    shieldT.current = 0;
    slowmoT.current = 0;
    phaseT.current = 0;
    bonusPoints.current = 0;
    coinBank.current = 0;
    coinAccum.current = 0;
    onCoins(0);
    elapsed.current = 0;
    spawnT.current = 0;
    physAccum.current = 0;
    overRef.current = false;
    scoreRef.current = -1;
    shake.current = 0;
    explAct.current = false;
    pickupEffect.current.active = false;
    onScore(0);
  }, [gameState]);

  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        if (challengeMode && gameState === 'playing' && !overRef.current) {
          // Challenge anti-abuse: instant game over on tab hide
          overRef.current = true;
          onGameOver(Math.floor(elapsed.current) + (bonusPoints?.current ?? 0), coinBank.current);
          return;
        }
        tabHiddenRef.current = true;
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [challengeMode, gameState, onGameOver]);

  const physAccum = useRef(0);
  const PHYS_DT = IS_MOBILE ? 1 / 60 : 1 / 90; // fixed physics timestep

  useFrame((_, delta) => {
    // Revive check
    if (reviveRef?.current && overRef.current) {
      overRef.current = false;
      reviveRef.current = false;
      phaseT.current = 3; // 3 seconds of invulnerability on revive (semi-transparent)
      explAct.current = false; // clear explosion visual
      sfxRevive();
      shake.current = 0;
      physAccum.current = 0;
      // Clear ALL nearby asteroids (large radius)
      for (const a of asteroidPool.current) {
        if (!a.active) continue;
        const dx = a.x - shipPos.current.x,
          dy = a.y - shipPos.current.y;
        if (dx * dx + dy * dy < 64) a.active = false;
      }
    }
    if (gameState !== 'playing' || overRef.current) {
      // Clear visuals when not playing
      pws.current.length = 0;
      return;
    }
    // Tab was hidden — skip this frame to prevent time jump
    if (tabHiddenRef.current) {
      if (!document.hidden) {
        tabHiddenRef.current = false;
        physAccum.current = 0;
      }
      return;
    }
    const frameDt = Math.min(delta, 0.1);
    physAccum.current += frameDt;
    // Cap max sub-steps to prevent spiral of death
    if (physAccum.current > PHYS_DT * 4) physAccum.current = PHYS_DT * 4;

    // Per-frame audio guards — prevent multiple sfx calls from physics sub-steps
    let _rumbleThisFrame = false;
    let _debrisThisFrame = false;

    while (physAccum.current >= PHYS_DT) {
      physAccum.current -= PHYS_DT;
      const dt = PHYS_DT;
      elapsed.current += dt;
      const el = elapsed.current;

      if (shieldT.current > 0) shieldT.current -= dt;
      if (slowmoT.current > 0) slowmoT.current -= dt;
      if (phaseT.current > 0) phaseT.current -= dt;

      const speedMult = 1 + (shipStats?.speed || 0) / 200; // x1.0 to x1.5
      const tSpeed = clamp((INIT_SPEED + el * SPEED_GAIN) * speedMult, INIT_SPEED, MAX_SPEED * speedMult);
      curSpeed.current = slerp(curSpeed.current, tSpeed, 3, dt);

      let heading = shipHead.current;
      let px = shipPos.current.x;
      let py = shipPos.current.y;

      // Apply instant heading boost from tap, then continuous turn
      if (headingBoost.current !== 0) {
        heading += headingBoost.current;
        headingBoost.current = 0;
      }
      heading += ANG_RATE * orbDir.current * dt;

      bhTimer.current += dt;
      if (bhTimer.current >= BH_SPAWN_INTERVAL && bhs.current.length < BH_N) {
        bhs.current.push(spawnBH(px, py));
        bhTimer.current = 0;
      }

      // In-place filter — zero allocation per tick
      let writeIdx = 0;
      for (let bi = 0; bi < bhs.current.length; bi++) {
        const bh = bhs.current[bi];
        bh.life += dt;
        if (bh.life >= bh.maxLife) continue;
        const fadeIn = Math.min(1, bh.life * 1.2);
        const fadeOut = Math.min(1, (bh.maxLife - bh.life) * 1.2);
        const fade = Math.min(fadeIn, fadeOut);

        const dx = bh.x - px,
          dy = bh.y - py;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < BH_CORE_R) {
          const coreFactor = 1 - dist / BH_CORE_R;
          const deflect = (Math.random() - 0.5) * Math.PI * 2.0 * coreFactor;
          heading += deflect * Math.min(1, 12 * dt);
          curSpeed.current = Math.min(curSpeed.current + bh.str * 4 * dt * coreFactor, MAX_SPEED * 1.6);
          shake.current = Math.max(shake.current, 0.8 * coreFactor);
          if (!_rumbleThisFrame) {
            _rumbleThisFrame = true;
            sfxRumble(1.0);
          }
        } else {
          const angleToBH = Math.atan2(dy, dx);
          const cross = Math.cos(heading) * dy - Math.sin(heading) * dx;
          const deflectDir = cross >= 0 ? 1 : -1;
          const perpAngle = angleToBH + deflectDir * Math.PI * 0.5;
          const deflectDiff = normAng(perpAngle - heading);
          const safeDist = Math.max(2, dist);
          const deflectStr = ((bh.str * BH_DEFLECT_K) / (safeDist * safeDist)) * fade;
          heading += deflectDiff * deflectStr * dt;
          if (dist < 6) {
            curSpeed.current = Math.min(curSpeed.current + bh.str * 0.08 * dt, MAX_SPEED * 1.1);
          }
          if (dist < 10) {
            const rumbleIntensity = (1 - dist / 10) * fade;
            if (!_rumbleThisFrame && Math.random() < rumbleIntensity * 0.15) {
              _rumbleThisFrame = true;
              sfxRumble(rumbleIntensity);
            }
          }
        }
        bhs.current[writeIdx++] = bh;
      }
      bhs.current.length = writeIdx;

      px += Math.cos(heading) * curSpeed.current * dt;
      py += Math.sin(heading) * curSpeed.current * dt;

      shipHead.current = heading;
      shipPos.current.x = px;
      shipPos.current.y = py;
    }

    const dt = frameDt;
    const el = elapsed.current;

    const sc = Math.floor(el) + bonusPoints.current;
    if (sc !== scoreRef.current) {
      scoreRef.current = sc;
      onScore(sc);
    }

    // Time-based coin accumulation: 1/sec base, +1/sec every 30s, ×coinMult for minted ID
    const coinsPerSec = Math.min(10, 1 + Math.floor(el / 30)) * coinMult;
    coinAccum.current += coinsPerSec * dt;
    const wholeCoins = Math.floor(coinAccum.current);
    if (wholeCoins > 0) {
      coinBank.current += wholeCoins;
      coinAccum.current -= wholeCoins;
      onCoins(coinBank.current);
    }

    const px = shipPos.current.x,
      py = shipPos.current.y;
    const heading = shipHead.current;

    nearMiss.current = Math.max(0, nearMiss.current - dt * 3);

    const luckFactor = 1 + (shipStats?.luck || 0) / 150; // x1.0 to x1.67
    const pwInterval = PWR_SPAWN_INTERVAL / luckFactor; // shorter interval = more spawns
    pwTimer.current += dt;
    if (pwTimer.current >= pwInterval && pws.current.length < PWR_MAX) {
      pws.current.push(spawnPowerUp(px, py, heading));
      pwTimer.current = 0;
    }

    // In-place filter — zero allocation per tick
    let pwWrite = 0;
    for (let pi = 0; pi < pws.current.length; pi++) {
      const pw = pws.current[pi];
      pw.life += dt;
      if (pw.life >= pw.maxLife) continue;
      const pdx = pw.x - px,
        pdy = pw.y - py;
      if (Math.sqrt(pdx * pdx + pdy * pdy) < PWR_PICKUP_R) {
        const shieldMult = 1 + (shipStats?.shield || 0) / 100; // x1.0 to x2.0
        if (pw.type === 'shield') shieldT.current = SHIELD_DUR * shieldMult;
        else if (pw.type === 'slowmo') slowmoT.current = SLOWMO_DUR;
        else if (pw.type === 'phase') phaseT.current = PHASE_DUR;
        else if (pw.type === 'coin') {
          const coinPwrBonus = COIN_BONUS * coinMult;
          bonusPoints.current += coinPwrBonus;
          coinBank.current += coinPwrBonus;
          onCoins(coinBank.current);
          const newSc = Math.floor(el) + bonusPoints.current;
          scoreRef.current = newSc;
          onScore(newSc);
        }
        pickupEffect.current = { active: true, type: pw.type, x: px, y: py, t: 0 };
        shake.current = Math.max(shake.current, 0.3);
        if (pw.type === 'shield') sfxShield();
        else sfxPickup();
        continue;
      }
      pws.current[pwWrite++] = pw;
    }
    pws.current.length = pwWrite;

    // SPAWNING
    spawnT.current += dt;
    const si = Math.max(0.3, 1.45 - el * 0.012);
    if (spawnT.current >= si) {
      spawnT.current = 0;
      const wc = el > 35 && Math.random() < 0.35 ? 2 : 1;

      let spawned = 0;
      for (let i = 0; i < asteroidPool.current.length; i++) {
        if (spawned >= wc) break;
        const a = asteroidPool.current[i];
        if (!a.active) {
          assignAst(a, el, px, py);
          spawned++;
        }
      }
    }

    const currentBHs = bhs.current;
    const isSlowMo = slowmoT.current > 0;
    const isPhase = phaseT.current > 0;
    const hasShield = shieldT.current > 0;
    const timeFactor = isSlowMo ? 0.45 : 1.0;
    const dtf = dt * timeFactor;
    const DESPAWN_R2 = DESPAWN_R * DESPAWN_R;

    // PHYSICS & COLLISION LOOP (rendering handled by AsteroidInstances)
    const sx = shipPos.current.x,
      sy = shipPos.current.y;

    for (let i = 0; i < asteroidPool.current.length; i++) {
      const a = asteroidPool.current[i];
      if (!a.active) continue;

      // Physics — BH gravity on asteroids (strong pull + deflect near core)
      let nvx = a.vx,
        nvy = a.vy;
      const destroyed = false;
      for (let bi = 0; bi < currentBHs.length; bi++) {
        const bh = currentBHs[bi];
        const bdx = bh.x - a.x,
          bdy = bh.y - a.y;
        const bd = Math.sqrt(bdx * bdx + bdy * bdy);
        if (bd < 1.5) {
          // Strong deflect — push asteroid OUT of BH core so it doesn't get stuck
          const safeD = Math.max(0.1, bd);
          const pushStr = bh.str * 28;
          nvx += -(bdx / safeD) * pushStr * dt;
          nvy += -(bdy / safeD) * pushStr * dt;
          // Lateral kick for variety
          const lateralAngle = Math.atan2(bdy, bdx) + (Math.random() - 0.5) * Math.PI;
          nvx += Math.cos(lateralAngle) * pushStr * 0.6 * dt;
          nvy += Math.sin(lateralAngle) * pushStr * 0.6 * dt;
          // Enforce minimum outward speed to escape
          const outSpd = Math.sqrt(nvx * nvx + nvy * nvy);
          if (outSpd < 6) {
            const sc = 6 / Math.max(0.1, outSpd);
            nvx *= sc;
            nvy *= sc;
          }
          if (!_debrisThisFrame && Math.random() < 0.15) {
            _debrisThisFrame = true;
            sfxDebris();
          }
        } else {
          // Normal gravity pull (only outside core)
          const bsd = Math.max(1, bd);
          const bfadeIn = Math.min(1, bh.life * 0.6);
          const bfadeOut = Math.min(1, (bh.maxLife - bh.life) * 0.6);
          const bfade = Math.min(bfadeIn, bfadeOut);
          const bf = ((bh.str * 25) / (bsd * bsd)) * bfade;
          nvx += (bdx / bsd) * bf * dt;
          nvy += (bdy / bsd) * bf * dt;
        }
      }
      if (destroyed) {
        a.active = false;
        continue;
      }

      a.vx = nvx;
      a.vy = nvy;
      const age = el - a.spawnTime;
      const wob = a.wobbleAmp * Math.sin(age * a.wobbleFreq + a.wobblePhase);
      const spd2 = nvx * nvx + nvy * nvy;
      const invSpd = spd2 > 0.001 ? 1 / Math.sqrt(spd2) : 1;
      const perpX = -nvy * invSpd,
        perpY = nvx * invSpd;
      const nx = a.x + (nvx + perpX * wob) * dtf;
      const ny = a.y + (nvy + perpY * wob) * dtf;
      a.x = nx;
      a.y = ny;

      // Rotation update
      a.rx += a.rsx * dtf;
      a.ry += a.rsy * dtf;
      a.rz += a.rsz * dtf;

      // Despawn check (squared distance — no sqrt)
      const dsx = nx - sx,
        dsy = ny - sy;
      const dd2 = dsx * dsx + dsy * dsy;
      if (dd2 > DESPAWN_R2) {
        a.active = false;
        continue;
      }

      // Collision + near-miss
      const cd = HIT_R + a.r * 0.95;
      const cd2sq = cd * cd;
      const nmOuter = cd + NEAR_MISS_D;
      if (dd2 < nmOuter * nmOuter && !isPhase) {
        if (dd2 < cd2sq) {
          if (hasShield) {
            shieldT.current = 0;
            shake.current = Math.max(shake.current, 1);
            splitAsteroid(asteroidPool.current, a, el);
            a.active = false;
            streak.current = 0;
            streakTimer.current = 0;
            continue;
          }
          splitAsteroid(asteroidPool.current, a, el);
          overRef.current = true;
          shake.current = 2;
          explPos.current = { x: sx, y: sy };
          explAct.current = true;
          sfxExplosion();
          onGameOver(Math.floor(el) + bonusPoints.current, coinBank.current);
          return;
        }
        const hd = Math.sqrt(dd2);
        const inten = 1 - (hd - cd) / NEAR_MISS_D;
        nearMiss.current = Math.max(nearMiss.current, inten);
        // Near-miss scoring: award points for close dodges (once per asteroid)
        if (inten > 0.4 && !a.scored) {
          a.scored = true;
          streak.current++;
          streakTimer.current = 2;
          const mult = Math.min(streak.current, STREAK_MULT_CAP);
          const pts = NEAR_MISS_PTS * mult;
          bonusPoints.current += pts;
          coinBank.current += Math.max(1, Math.floor(pts / 3)) * coinMult;
          const newSc = Math.floor(el) + bonusPoints.current;
          scoreRef.current = newSc;
          onScore(newSc);
          onCoins(coinBank.current);
          onCombo?.(streak.current, pts);
          sfxNearMiss();
        }
      }
    }

    // Inter-asteroid collision & repulsion — active-only index list (pre-allocated)
    const pool = asteroidPool.current;
    const aidx = _activeIdx.current;
    let aN = 0;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].active) aidx[aN++] = i;
    }
    for (let ai = 0; ai < aN; ai++) {
      const a = pool[aidx[ai]];
      for (let aj = ai + 1; aj < aN; aj++) {
        const b = pool[aidx[aj]];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const minD = (a.r + b.r) * 0.97;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d,
          ny = dy / d;
        const overlap = minD - d;
        const tm = a.r * a.r + b.r * b.r;
        const aR = (b.r * b.r) / tm,
          bR = (a.r * a.r) / tm;
        a.x -= nx * overlap * aR;
        a.y -= ny * overlap * aR;
        b.x += nx * overlap * bR;
        b.y += ny * overlap * bR;
        const rvx = a.vx - b.vx,
          rvy = a.vy - b.vy;
        const rdn = rvx * nx + rvy * ny;
        if (rdn > 0) {
          const imp = rdn * 0.75;
          a.vx -= imp * nx * aR;
          a.vy -= imp * ny * aR;
          b.vx += imp * nx * bR;
          b.vy += imp * ny * bR;
          // Collision sound if within player visibility (~18 units)
          const mx = (a.x + b.x) * 0.5,
            my = (a.y + b.y) * 0.5;
          const vdx = mx - sx,
            vdy = my - sy;
          if (vdx * vdx + vdy * vdy < 324) {
            // 18^2
            sfxAsteroidHit(Math.min(1, rdn * 0.15));
          }
          // Enforce minimum speed so asteroids don't stall and just spin
          const MIN_SPD = 1.5;
          const sa2 = a.vx * a.vx + a.vy * a.vy;
          if (sa2 > 0.001 && sa2 < MIN_SPD * MIN_SPD) {
            const f = MIN_SPD / Math.sqrt(sa2);
            a.vx *= f;
            a.vy *= f;
          }
          const sb2 = b.vx * b.vx + b.vy * b.vy;
          if (sb2 > 0.001 && sb2 < MIN_SPD * MIN_SPD) {
            const f = MIN_SPD / Math.sqrt(sb2);
            b.vx *= f;
            b.vy *= f;
          }
        }
      }
    }

    // Streak decay
    if (streakTimer.current > 0) {
      streakTimer.current -= frameDt;
      if (streakTimer.current <= 0) {
        streak.current = 0;
      }
    }
  });

  return (
    <>
      {/* No scene background — transparent, CosmicStarfield shows through */}
      <ambientLight intensity={IS_MOBILE ? 0.6 : 0.5} />
      <directionalLight intensity={0.65} color="#93c5fd" position={[8, 10, 14]} />
      <directionalLight intensity={0.32} color="#f8fafc" position={[-12, -8, 12]} />

      <Cam sPos={shipPos} shake={shake} gs={gameState} />

      <BHVisuals bhRef={bhs} />
      <Ship
        posRef={shipPos}
        headRef={shipHead}
        color={sCol}
        scale={sSc}
        nearRef={nearMiss}
        shieldRef={shieldT}
        phaseRef={phaseT}
        skinId={shipSkin}
        shipAura={shipAura}
      />
      <PowerUpVisuals pwRef={pws} />
      <PickupEffect pickupRef={pickupEffect} />

      <AsteroidInstances pool={asteroidPool} geos={geos} />

      <Explosion pRef={explPos} actRef={explAct} />
      <FX />
      <ShaderPreWarm />
    </>
  );
}

/* Pre-compile all shaders & upload textures on mount to prevent mid-game lag */
function ShaderPreWarm() {
  const { gl, scene, camera } = useThree();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    // Temporarily make all hidden objects visible so shaders compile
    const hidden: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if (!obj.visible) {
        obj.visible = true;
        hidden.push(obj);
      }
    });
    gl.compile(scene, camera);
    // Restore visibility
    hidden.forEach((obj) => {
      obj.visible = false;
    });
    // Force-upload asteroid textures to GPU
    for (const pair of AST_TEX_PAIRS) {
      if (pair.diffuse.image) gl.initTexture(pair.diffuse);
      if (pair.normal.image) gl.initTexture(pair.normal);
    }
    // Force-upload power-up textures to GPU (prevents micro-lag on first spawn)
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).material) {
        const mat = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (mat.map?.image) gl.initTexture(mat.map);
      }
    });
  }, [gl, scene, camera]);
  return null;
}

/* ═══════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════ */

export default function OrbitSurvivalScene(props: GameProps) {
  const isMobile = useMemo(
    () => typeof window !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent),
    [],
  );
  return (
    <div
      className="absolute inset-0 w-full h-full"
      style={{ touchAction: 'none' }}
      onTouchMove={(e) => e.preventDefault()}
    >
      <Suspense fallback={null}>
        <Canvas
          camera={{ fov: isMobile ? 62 : 50, position: [0, 0, CAM_Z], near: 0.1, far: 400 }}
          gl={{ antialias: false, powerPreference: 'high-performance', alpha: true }}
          dpr={isMobile ? 1 : [1, 1.5]}
          frameloop="always"
        >
          <GameWorld {...props} />
        </Canvas>
      </Suspense>
    </div>
  );
}
