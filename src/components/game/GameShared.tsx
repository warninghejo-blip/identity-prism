import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";

import * as THREE from "three";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { WalletTraits } from "@/hooks/useWalletData";
import type { ShipStats } from "@/lib/shipStats";

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */

export type GameState = "start" | "playing" | "gameover";
export interface ActiveBonus { type: string; label: string; icon: string; color: string; t: number; max: number }
export interface GameProps {
  onScore: (score: number) => void;
  onCoins: (coins: number) => void;
  onGameOver: (finalScore: number, finalCoins: number, isVictory?: boolean) => void;
  onLevel?: (level: number, wave: number, name: string, banner: boolean) => void;
  onActiveBonuses?: (bonuses: ActiveBonus[]) => void;
  reviveRef?: React.MutableRefObject<boolean>;
  gameState: GameState;
  traits: WalletTraits | null;
  walletScore: number;
  hasMintedId?: boolean;
  shipSkin?: string | null;
  shipStats?: ShipStats;
}

export interface AsteroidData {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  rx: number; ry: number; rz: number;
  rsx: number; rsy: number; rsz: number;
  sx: number; sy: number; sz: number;
  gi: number; mi: number;
  small: boolean;
  active: boolean;
  wobbleAmp: number; wobbleFreq: number; wobblePhase: number;
  spawnTime: number;
  hp?: number;
}

export interface BHole {
  x: number; y: number;
  str: number;
  life: number; maxLife: number;
}

export type PwrType = "shield" | "slowmo" | "phase" | "coin";
export interface PowerUp {
  id: number;
  x: number; y: number;
  type: PwrType;
  life: number; maxLife: number;
}

/* ═══════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════ */

export const IS_MOBILE = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

export const HIT_R = 0.58;
export const NEAR_MISS_D = 1.6;
export const CAM_Z = 32;
export const SPAWN_R = 22;
export const DESPAWN_R = 36;

export const INIT_SPEED = 4.5;
export const MAX_SPEED = 22;
export const SPEED_GAIN = 0.18;
export const ANG_RATE = 1.2;
export const TAP_BOOST = 0.14;

export const BH_N = 3;
export const BH_STR = 6.0;
export const BH_MIN_LIFE = 12;
export const BH_MAX_LIFE = 25;
export const BH_SPAWN_INTERVAL = 10;
export const BH_TURN_K = 4.5;
export const BH_CORE_R = 1.6;
export const BH_PUSH_STR = 18;
export const BH_DEFLECT_K = 5.0;

export const EXPLODE_N = IS_MOBILE ? 25 : 80;
export const EXHAUST_N = IS_MOBILE ? 14 : 60;

export const PWR_MAX = 3;
export const PWR_SPAWN_INTERVAL = 14;
export const PWR_PICKUP_R = 1.5;
export const PWR_LIFE = 18;
export const SHIELD_DUR = 6;
export const SLOWMO_DUR = 6;
export const PHASE_DUR = 4;
export const COIN_BONUS = 25;
export const MAX_ASTEROIDS = IS_MOBILE ? 100 : 200;

export const TIER_COLORS: Record<string, string> = {
  mercury: "#9ca3af", mars: "#ef4444", venus: "#f59e0b", earth: "#22c55e",
  neptune: "#3b82f6", uranus: "#22d3ee", saturn: "#facc15", jupiter: "#fb923c",
  sun: "#fde047", binary_sun: "#ffffff",
};

/* ═══════════════════════════════════════════════════
   Utility functions
   ═══════════════════════════════════════════════════ */

export let aidN = 0;
export const resetAidN = () => { aidN = 0; };
export const rnd = (a: number, b: number) => Math.random() * (b - a) + a;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const slerp = (c: number, t: number, s: number, dt: number) => THREE.MathUtils.lerp(c, t, 1 - Math.exp(-s * dt));
export const normAng = (a: number) => { let v = a % (Math.PI * 2); if (v > Math.PI) v -= Math.PI * 2; if (v < -Math.PI) v += Math.PI * 2; return v; };
export const seededRng = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

/* ═══════════════════════════════════════════════════
   Rock textures — PBR (Poly Haven CC0)
   ═══════════════════════════════════════════════════ */

const _tl = new THREE.TextureLoader();
const _cfgDiff = (t: THREE.Texture) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; };
const _cfgNorm = (t: THREE.Texture) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.LinearSRGBColorSpace; return t; };

export const AST_TEX_PAIRS = [
  { diffuse: _cfgDiff(_tl.load('/textures/asteroids/rock_ground_diff_1k.jpg')), normal: _cfgNorm(_tl.load('/textures/asteroids/rock_ground_nor_gl_1k.jpg')) },
  { diffuse: _cfgDiff(_tl.load('/textures/asteroids/rock_boulder_dry_diff_1k.jpg')), normal: _cfgNorm(_tl.load('/textures/asteroids/rock_boulder_dry_nor_gl_1k.jpg')) },
  { diffuse: _cfgDiff(_tl.load('/textures/asteroids/brown_mud_rocks_01_diff_1k.jpg')), normal: _cfgNorm(_tl.load('/textures/asteroids/brown_mud_rocks_01_nor_gl_1k.jpg')) },
  { diffuse: _cfgDiff(_tl.load('/textures/asteroids/rock_face_diff_1k.jpg')), normal: _cfgNorm(_tl.load('/textures/asteroids/rock_face_nor_gl_1k.jpg')) },
];

export const AST_NORM_SCALE = new THREE.Vector2(1.6, 1.6);

export const AST_M = [
  { met: .06, rou: .94 },
  { met: .10, rou: .85 },
  { met: .08, rou: .88 },
  { met: .14, rou: .78 },
];

export const AST_SHARED_MATS = AST_TEX_PAIRS.map((pair, i) => {
  return new THREE.MeshStandardMaterial({
    map: pair.diffuse,
    normalMap: pair.normal,
    normalScale: AST_NORM_SCALE,
    roughness: Math.min(AST_M[i].rou + .05, 1),
    metalness: Math.max(AST_M[i].met - .02, 0),
    color: new THREE.Color('#d8dce8'),
  });
});

/* ═══════════════════════════════════════════════════
   Rock geometry
   ═══════════════════════════════════════════════════ */

export function makeRockGeo(seg: number, seed: number): THREE.SphereGeometry {
  const geo = new THREE.SphereGeometry(1, seg, seg);
  const R = seededRng(seed);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(.9 + R() * .2);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const dir = new THREE.Vector3();
  const bumps = 2 + Math.floor(R() * 4);
  for (let b = 0; b < bumps; b++) {
    dir.set(R() - .5, R() - .5, R() - .5).normalize();
    const w = .2 + R() * .35, d = .03 + R() * .07;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      const ang = Math.acos(clamp(n.dot(dir), -1, 1));
      if (ang < w) { const t = 1 - ang / w; v.multiplyScalar(1 - d * t * t); p.setXYZ(i, v.x, v.y, v.z); }
    }
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* ═══════════════════════════════════════════════════
   Spawners
   ═══════════════════════════════════════════════════ */

export function spawnAst(el: number, sx: number, sy: number): AsteroidData {
  const small = Math.random() < .6;
  const r = small ? rnd(.4, .9) : rnd(1, 2);
  const a = rnd(0, 6.28), dist = SPAWN_R + rnd(2, 5);
  const ca = a + Math.PI + rnd(-.55, .55);
  const speedRoll = Math.random();
  const speedMult = speedRoll < .2 ? rnd(1.8, 2.5) : speedRoll > .8 ? rnd(.3, .55) : 1;
  const sp = (small ? rnd(5, 8.5) : rnd(2.2, 4.8)) * (1 + el * .018) * speedMult;
  const td = rnd(-1.8, 1.8) * (small ? 1 : .6);
  return {
    id: ++aidN,
    x: sx + Math.cos(a) * dist, y: sy + Math.sin(a) * dist,
    vx: Math.cos(ca) * sp - Math.sin(a) * td,
    vy: Math.sin(ca) * sp + Math.cos(a) * td,
    r,
    rx: rnd(0, 6.28), ry: rnd(0, 6.28), rz: rnd(0, 6.28),
    rsx: rnd(-1.5, 1.5), rsy: rnd(-2, 2), rsz: rnd(-1.8, 1.8),
    sx: rnd(.88, 1.15), sy: rnd(.88, 1.15), sz: rnd(.88, 1.15),
    gi: Math.floor(rnd(0, 6)), mi: Math.floor(rnd(0, 4)), small,
    active: true,
    wobbleAmp: rnd(.3, 1.8), wobbleFreq: rnd(1.5, 4), wobblePhase: rnd(0, 6.28),
    spawnTime: el,
    hp: small ? 1 : 2,
  };
}

export function spawnBH(sx: number, sy: number): BHole {
  const a = rnd(0, 6.28), d = rnd(SPAWN_R - 2, SPAWN_R + 4);
  return { x: sx + Math.cos(a) * d, y: sy + Math.sin(a) * d, str: rnd(.6, 1) * BH_STR, life: 0, maxLife: rnd(BH_MIN_LIFE, BH_MAX_LIFE) };
}

let pwIdN = 0;
export const resetPwIdN = () => { pwIdN = 0; };
const PWR_TYPES: PwrType[] = ["shield", "slowmo", "phase", "coin"];
export function spawnPowerUp(sx: number, sy: number, heading: number): PowerUp {
  const spread = rnd(-1.2, 1.2);
  const dist = rnd(6, 14);
  return {
    id: ++pwIdN,
    x: sx + Math.cos(heading + spread) * dist,
    y: sy + Math.sin(heading + spread) * dist,
    type: PWR_TYPES[Math.floor(Math.random() * PWR_TYPES.length)],
    life: 0, maxLife: PWR_LIFE,
  };
}

/* ═══════════════════════════════════════════════════
   Camera
   ═══════════════════════════════════════════════════ */

export function Cam({ sPos, shake, gs }: {
  sPos: React.MutableRefObject<{ x: number; y: number }>;
  shake: React.MutableRefObject<number>;
  gs: GameState;
}) {
  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, .033);
    const tx = gs === "playing" ? sPos.current.x : 0;
    const ty = gs === "playing" ? sPos.current.y : 0;
    let sx = 0, sy = 0;
    if (shake.current > .01) {
      sx = (Math.random() - .5) * shake.current * .6;
      sy = (Math.random() - .5) * shake.current * .6;
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
   Space Background
   ═══════════════════════════════════════════════════ */

export function SpaceBG() {
  const ref = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (ref.current) ref.current.uniforms.uTime.value = s.clock.elapsedTime;
    if (meshRef.current) {
      meshRef.current.position.x = s.camera.position.x;
      meshRef.current.position.y = s.camera.position.y;
    }
  });

  const shader = useMemo(() => ({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      #define FBM_ITER ${IS_MOBILE ? 3 : 7}
      #define STAR_LAYERS ${IS_MOBILE ? 2 : 4}
      uniform float uTime;
      varying vec2 vUv;
      vec2 hash22(vec2 p) { p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
      float hash21(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p) { vec2 i=floor(p), f=fract(p); float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1)); vec2 u=f*f*(3.-2.*f); return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y; }
      float fbm(vec2 p) { float v=0., a=.5; mat2 rot=mat2(.8,-.6,.6,.8); for(int i=0; i<FBM_ITER; i++) { v+=a*noise(p); p=rot*p*2.05; a*=.47; } return v; }
      vec3 renderStars(vec2 uv, float cellSize, float density, float sizeMin, float sizeMax) {
        vec3 col = vec3(0.); vec2 id = floor(uv * cellSize); vec2 gv = fract(uv * cellSize);
        for(int dy=-1; dy<=1; dy++) { for(int dx=-1; dx<=1; dx++) {
          vec2 offset = vec2(float(dx), float(dy)); vec2 cellId = id + offset; vec2 rh = hash22(cellId);
          if(rh.x > density) continue; vec2 starPos = offset + rh - gv; float d = length(starPos);
          float size = sizeMin + (sizeMax - sizeMin) * hash21(cellId + 42.); float brightness = smoothstep(size, size * .1, d);
          float twinkle = .65 + .35 * sin(uTime * (1. + hash21(cellId + 99.) * 4.) + hash21(cellId) * 6.28); brightness *= twinkle;
          float temp = hash21(cellId + 55.); vec3 starCol;
          if(temp < .2) starCol = vec3(.7, .8, 1.); else if(temp < .5) starCol = vec3(.95, .95, 1.); else if(temp < .8) starCol = vec3(1., .95, .85); else starCol = vec3(1., .85, .7);
          float glow = exp(-d * d / (size * size * 8.)) * .3; col += starCol * (brightness + glow);
        }} return col;
      }
      void main() {
        vec2 uv = vUv; vec2 cuv = (uv - .5) * 2.; float r = length(cuv);
        vec3 col = vec3(.10, .08, .22);
        float n1 = fbm(cuv * 1.5 + vec2(uTime*.008, -uTime*.005));
        float n2 = fbm(cuv * 3.0 + vec2(-uTime*.004, uTime*.01));
        float n3 = fbm(cuv * 2.0 + vec2(uTime*.003, uTime*.003));
        col = mix(col, vec3(.28, .12, .38), smoothstep(.22, .55, n1) * .7);
        col = mix(col, vec3(.12, .15, .38), smoothstep(.28, .6, n2) * .6);
        col = mix(col, vec3(.10, .20, .35), smoothstep(.35, .68, n3) * .5);
        float glow = exp(-r * 1.5) * .22; col += vec3(.12, .10, .28) * glow;
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
  }), []);

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

export function Dust() {
  const N = IS_MOBILE ? 80 : 500;
  const ref = useRef<THREE.Points>(null);
  const frameSkip = useRef(0);
  const { pos, col } = useMemo(() => {
    const p = new Float32Array(N * 3), c = new Float32Array(N * 3);
    const cs = [[.2, .3, .55], [.35, .2, .45], [.1, .4, .45], [.3, .25, .5]];
    for (let i = 0; i < N; i++) {
      p[i * 3] = (Math.random() - .5) * 140; p[i * 3 + 1] = (Math.random() - .5) * 140; p[i * 3 + 2] = (Math.random() - .5) * 26 - 5;
      const cc = cs[Math.floor(Math.random() * cs.length)];
      c[i * 3] = cc[0]; c[i * 3 + 1] = cc[1]; c[i * 3 + 2] = cc[2];
    }
    return { pos: p, col: c };
  }, []);
  useFrame((s, d) => {
    if (!ref.current) return;
    ref.current.position.x = s.camera.position.x;
    ref.current.position.y = s.camera.position.y;
    // On mobile, update dust positions every 3rd frame to save CPU
    if (IS_MOBILE) { frameSkip.current++; if (frameSkip.current % 4 !== 0) return; }
    const dt = Math.min(d, .033) * (IS_MOBILE ? 4 : 1);
    ref.current.rotation.z += dt * .0015;
    const a = ref.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < N; i++) { a[i * 3] += dt * .2; a[i * 3 + 1] += dt * .07; if (a[i * 3] > 70) a[i * 3] = -70; if (a[i * 3 + 1] > 70) a[i * 3 + 1] = -70; }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
        <bufferAttribute attach="attributes-color" args={[col, 3]} />
      </bufferGeometry>
      <pointsMaterial size={.08} vertexColors transparent opacity={.22} blending={THREE.AdditiveBlending} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/* ═══════════════════════════════════════════════════
   Black Hole Visuals
   ═══════════════════════════════════════════════════ */

const _bhCircleGeo = new THREE.CircleGeometry(1, IS_MOBILE ? 24 : 48);
const _bhRingGeo = new THREE.RingGeometry(.92, 1.05, IS_MOBILE ? 24 : 64);
const _bhGlowGeo = new THREE.CircleGeometry(2, IS_MOBILE ? 24 : 32);

const BH_SPIRAL_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const BH_SPIRAL_FS = `
  uniform float uTime; uniform float uFade; varying vec2 vUv;
  void main(){
    vec2 c = vUv - .5; float r = length(c); float a = atan(c.y, c.x);
    float spiral = sin(a * 3. - r * 12. + uTime * 2.) * .5 + .5;
    spiral *= smoothstep(.5, .15, r); spiral *= smoothstep(.0, .08, r);
    float alpha = spiral * uFade * .55;
    vec3 col = mix(vec3(.15, .08, .25), vec3(.4, .2, .6), spiral);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function BHVisuals({ bhRef }: { bhRef: React.MutableRefObject<BHole[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const spiralMats = useRef<(THREE.ShaderMaterial | null)[]>([]);
  const _warm = useRef(0);
  useFrame((state) => {
    _warm.current++;
    if (_warm.current <= 2) return; // shader warmup: let materials compile first 2 frames
    const t = state.clock.elapsedTime;
    for (let i = 0; i < BH_N; i++) {
      const g = refs.current[i]; const w = bhRef.current[i];
      if (!g) continue;
      if (!w) { g.visible = false; continue; }
      const fadeIn = Math.min(1, w.life * 1.2); const fadeOut = Math.min(1, (w.maxLife - w.life) * 1.2); const fade = Math.min(fadeIn, fadeOut);
      g.visible = fade > .02; g.position.set(w.x, w.y, 0);
      const sc = 1.2 + w.str / BH_STR * .4; g.scale.setScalar(sc);
      (g.children[0] as THREE.Mesh).material && ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity !== undefined && ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity !== fade && (((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = fade);
      ((g.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = fade * .5;
      const sm = spiralMats.current[i];
      if (sm) { sm.uniforms.uTime.value = t; sm.uniforms.uFade.value = fade; }
      const spiralMesh = g.children[2] as THREE.Mesh;
      if (spiralMesh) spiralMesh.rotation.z = t * (.6 + i * .15);
      ((g.children[3] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = fade * .1 * (.8 + Math.sin(t * 1.5 + i) * .2);
    }
  });
  return (<>{Array.from({ length: BH_N }).map((_, i) => (
    <group key={i} ref={el => { refs.current[i] = el; }}>
      <mesh geometry={_bhCircleGeo}><meshBasicMaterial color="#000000" transparent opacity={0} /></mesh>
      <mesh geometry={_bhRingGeo}><meshBasicMaterial color="#6633aa" transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh geometry={_bhCircleGeo} position={[0, 0, .01]}>
        <shaderMaterial ref={el => { spiralMats.current[i] = el; }} uniforms={{ uTime: { value: 0 }, uFade: { value: 0 } }} vertexShader={BH_SPIRAL_VS} fragmentShader={BH_SPIRAL_FS} transparent depthWrite={false} />
      </mesh>
      <mesh geometry={_bhGlowGeo}><meshBasicMaterial color="#4422aa" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </group>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Ship
   ═══════════════════════════════════════════════════ */

/** Resolve ship texture path from skin id */
export function getShipTexturePath(skinId?: string | null): string {
  if (!skinId) return '/textures/ship.png';
  const key = skinId.replace('ship_', '');
  return `/textures/ships/ship_${key}.png`;
}

export function Ship({ posRef, headRef, color, scale, nearRef, shieldRef, phaseRef, skinId }: {
  posRef: React.MutableRefObject<{ x: number; y: number }>;
  headRef: React.MutableRefObject<number>;
  color: string; scale: number;
  nearRef: React.MutableRefObject<number>;
  shieldRef: React.MutableRefObject<number>;
  phaseRef: React.MutableRefObject<number>;
  skinId?: string | null;
}) {
  const gRef = useRef<THREE.Group>(null);
  const shRef = useRef<THREE.Mesh>(null);
  const shieldBub = useRef<THREE.Mesh>(null);
  const phaseGlow = useRef<THREE.Mesh>(null);
  const exRef = useRef<THREE.Points>(null);
  const shipMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const N = EXHAUST_N;
  const texPath = getShipTexturePath(skinId);
  const shipTex = useLoader(THREE.TextureLoader, texPath);
  if (shipTex.minFilter !== THREE.LinearFilter) { shipTex.minFilter = THREE.LinearFilter; shipTex.magFilter = THREE.LinearFilter; shipTex.generateMipmaps = false; shipTex.needsUpdate = true; }
  const exSt = useMemo(() => {
    const p = new Float32Array(N * 3);
    const d: { l: number; ml: number; sp: number; ox: number }[] = [];
    for (let i = 0; i < N; i++) {
      const side = i < N / 2 ? -.24 : .24;
      d.push({ l: Math.random() * .5, ml: .2 + Math.random() * .35, sp: 1.2 + Math.random() * 2.5, ox: side + (Math.random() - .5) * .06 });
      p[i * 3] = d[i].ox; p[i * 3 + 1] = -0.95; p[i * 3 + 2] = 0;
    }
    return { p, d };
  }, []);
  useFrame((s, delta) => {
    if (!gRef.current) return;
    const dt = Math.min(delta, .033); const t = s.clock.elapsedTime;
    gRef.current.position.x = slerp(gRef.current.position.x, posRef.current.x, 8, dt);
    gRef.current.position.y = slerp(gRef.current.position.y, posRef.current.y, 8, dt);
    const targetRot = headRef.current - Math.PI / 2;
    const curRot = gRef.current.rotation.z;
    let rotDiff = targetRot - curRot;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    gRef.current.rotation.z = curRot + rotDiff * (1 - Math.exp(-10 * dt));
    if (shRef.current) { const m = shRef.current.material as THREE.MeshBasicMaterial; m.opacity = slerp(m.opacity, nearRef.current > .1 ? .25 * nearRef.current : 0, 10, dt); }
    if (shieldBub.current) {
      const on = shieldRef.current > 0; shieldBub.current.visible = on;
      if (on) { (shieldBub.current.material as THREE.MeshBasicMaterial).opacity = .12 + Math.sin(t * 4) * .05; shieldBub.current.scale.setScalar(1 + Math.sin(t * 3) * .05); }
    }
    if (phaseGlow.current) {
      const on = phaseRef.current > 0; phaseGlow.current.visible = on;
      if (on) { (phaseGlow.current.material as THREE.MeshBasicMaterial).opacity = .15 + Math.sin(t * 6) * .08; }
    }
    // Phase effect on ship sprite
    if (shipMatRef.current) {
      shipMatRef.current.opacity = phaseRef.current > 0 ? .2 + Math.sin(t * 10) * .1 : 1;
    }
    if (exRef.current) {
      const a = exRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < N; i++) { const d = exSt.d[i]; d.l -= dt; if (d.l <= 0) { d.l = d.ml; a[i * 3] = d.ox; a[i * 3 + 1] = -0.95; a[i * 3 + 2] = (Math.random() - .5) * .05; } else { a[i * 3 + 1] -= d.sp * dt; a[i * 3] += (Math.random() - .5) * dt * .6; a[i * 3 + 2] += (Math.random() - .5) * dt * .3; } }
      exRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  const shipBody = (
    <>
      {/* Shadow layer */}
      <mesh position={[.04, -.04, -.05]}>
        <planeGeometry args={[1.6, 2.2]} />
        <meshBasicMaterial map={shipTex} transparent alphaTest={0.01} depthWrite={false} color="#000000" opacity={.35} />
      </mesh>
      {/* Main ship sprite */}
      <mesh>
        <planeGeometry args={[1.6, 2.2]} />
        <meshBasicMaterial ref={shipMatRef} map={shipTex} transparent alphaTest={0.01} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* Rim light */}
      <mesh position={[-.02, .02, .02]}>
        <planeGeometry args={[1.6, 2.2]} />
        <meshBasicMaterial map={shipTex} transparent alphaTest={0.05} depthWrite={false} color="#88ccff" opacity={.12} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* Cockpit glow */}
      <mesh position={[0, .15, .03]}><sphereGeometry args={[.15, 8, 8]} /><meshBasicMaterial color="#00eeff" transparent opacity={.25} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </>
  );

  return (
    <group ref={gRef} scale={[scale, scale, scale]}>
      <group>{shipBody}</group>
      <mesh ref={shRef}><ringGeometry args={[1, 1.15, 32]} /><meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh ref={shieldBub} visible={false}><sphereGeometry args={[1.6, 24, 24]} /><meshBasicMaterial color="#22d3ee" transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh ref={phaseGlow} visible={false}><sphereGeometry args={[1.3, 16, 16]} /><meshBasicMaterial color="#a855f7" transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <points ref={exRef}><bufferGeometry><bufferAttribute attach="attributes-position" args={[exSt.p, 3]} /></bufferGeometry><pointsMaterial size={.1} color="#00bbff" transparent opacity={.85} blending={THREE.AdditiveBlending} sizeAttenuation depthWrite={false} /></points>
      <pointLight intensity={4} color="#00aaff" distance={12} />
    </group>
  );
}

/* ═══════════════════════════════════════════════════
   Explosion
   ═══════════════════════════════════════════════════ */

export function Explosion({ pRef, actRef }: { pRef: React.MutableRefObject<{ x: number; y: number }>; actRef: React.MutableRefObject<boolean> }) {
  const ptRef = useRef<THREE.Points>(null);
  const tRef = useRef(0);
  const st = useMemo(() => {
    const p = new Float32Array(EXPLODE_N * 3), v = new Float32Array(EXPLODE_N * 3), c = new Float32Array(EXPLODE_N * 3);
    for (let i = 0; i < EXPLODE_N; i++) { const a = Math.random() * 6.28, s = 3 + Math.random() * 14; v[i * 3] = Math.cos(a) * s; v[i * 3 + 1] = Math.sin(a) * s; v[i * 3 + 2] = (Math.random() - .5) * 4; c[i * 3] = .9 + Math.random() * .1; c[i * 3 + 1] = .2 + Math.random() * .4; c[i * 3 + 2] = Math.random() * .15; p[i * 3] = 0; p[i * 3 + 1] = 0; p[i * 3 + 2] = -500; }
    return { p, v, c };
  }, []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, .033);
    if (!actRef.current) { if (ptRef.current) ptRef.current.visible = false; return; }
    tRef.current += dt; const t = tRef.current;
    if (t > 2.2) { actRef.current = false; return; }
    if (ptRef.current && ptRef.current.geometry?.attributes?.position) {
      ptRef.current.visible = true;
      const a = ptRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < EXPLODE_N; i++) { if (t < .02) { a[i * 3] = pRef.current.x; a[i * 3 + 1] = pRef.current.y; a[i * 3 + 2] = 0; } else { a[i * 3] += st.v[i * 3] * dt; a[i * 3 + 1] += st.v[i * 3 + 1] * dt; a[i * 3 + 2] += st.v[i * 3 + 2] * dt; st.v[i * 3] *= .97; st.v[i * 3 + 1] *= .97; st.v[i * 3 + 2] *= .97; } }
      ptRef.current.geometry.attributes.position.needsUpdate = true;
      const m = ptRef.current.material as THREE.PointsMaterial; m.opacity = Math.max(0, 1 - t / 1.9); m.size = .18 + t * .08;
    }
  });
  return (<>
    <points ref={ptRef} visible={false}><bufferGeometry><bufferAttribute attach="attributes-position" args={[st.p, 3]} /><bufferAttribute attach="attributes-color" args={[st.c, 3]} /></bufferGeometry><pointsMaterial size={.18} vertexColors transparent opacity={1} blending={THREE.AdditiveBlending} sizeAttenuation depthWrite={false} /></points>
  </>);
}

/* ═══════════════════════════════════════════════════
   Power-up visuals
   ═══════════════════════════════════════════════════ */

export const PWR_COL: Record<PwrType, string> = { shield: "#22d3ee", slowmo: "#facc15", phase: "#a855f7", coin: "#fbbf24" };

export function PowerUpVisuals({ pwRef }: { pwRef: React.MutableRefObject<PowerUp[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const iconRefs = useRef<(THREE.Group | null)[]>([]);
  const haloRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const _warm = useRef(0);
  useFrame((s) => {
    _warm.current++;
    if (_warm.current <= 2) return; // shader warmup
    const t = s.clock.elapsedTime;
    for (let i = 0; i < PWR_MAX; i++) {
      const g = refs.current[i]; const pw = pwRef.current[i]; const icons = iconRefs.current[i];
      if (!g || !icons) continue;
      if (!pw) { g.visible = false; continue; }
      const fadeIn = Math.min(1, pw.life * 2); const fadeOut = Math.min(1, (pw.maxLife - pw.life) * 2); const fade = Math.min(fadeIn, fadeOut);
      g.visible = fade > .02;
      g.position.set(pw.x, pw.y, Math.sin(t * 2.5 + i * 3) * .2);
      g.rotation.y = t * 1.8; g.scale.setScalar(1 + Math.sin(t * 3.5 + i * 2) * .08);
      const typeIdx = pw.type === "shield" ? 0 : pw.type === "slowmo" ? 1 : pw.type === "phase" ? 2 : 3;
      const col = PWR_COL[pw.type];
      for (let ci = 0; ci < icons.children.length; ci++) {
        const ch = icons.children[ci] as THREE.Mesh;
        ch.visible = ci === typeIdx;
        if (ci === typeIdx) { const m = ch.material as THREE.MeshBasicMaterial; m.color.set(col); m.opacity = fade; }
      }
      const halo = haloRefs.current[i];
      if (halo) { const m = halo.material as THREE.MeshBasicMaterial; m.color.set(col); m.opacity = fade * .2 * (.6 + Math.sin(t * 4) * .4); }
      const ring = ringRefs.current[i];
      if (ring) { ring.rotation.x = t * 1.2 + i; ring.rotation.z = t * .8; const rm = ring.material as THREE.MeshBasicMaterial; rm.color.set(col); rm.opacity = fade * .45; }
    }
  });
  return (<>{Array.from({ length: PWR_MAX }).map((_, i) => (
    <group key={i} ref={el => { refs.current[i] = el; }}>
      <group ref={el => { iconRefs.current[i] = el; }}>
        <mesh><octahedronGeometry args={[.42, 1]} /><meshBasicMaterial toneMapped={false} transparent opacity={0} /></mesh>
        <mesh><torusGeometry args={[.32, .14, 16, 24]} /><meshBasicMaterial toneMapped={false} transparent opacity={0} /></mesh>
        <mesh><icosahedronGeometry args={[.38, 1]} /><meshBasicMaterial toneMapped={false} transparent opacity={0} /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.35, .35, .1, 24]} /><meshBasicMaterial toneMapped={false} transparent opacity={0} /></mesh>
      </group>
      <mesh ref={el => { ringRefs.current[i] = el; }}><torusGeometry args={[.6, .03, 8, 32]} /><meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} /></mesh>
      <mesh ref={el => { haloRefs.current[i] = el; }}><sphereGeometry args={[.7, 14, 14]} /><meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
      {!IS_MOBILE && <pointLight intensity={2.2} distance={5} />}
    </group>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Pickup effect
   ═══════════════════════════════════════════════════ */

const PICKUP_PARTICLES = 24;

export function PickupEffect({ pickupRef }: { pickupRef: React.MutableRefObject<{ active: boolean; type: PwrType; x: number; y: number; t: number }> }) {
  const ptsRef = useRef<THREE.Points>(null);
  const st = useMemo(() => {
    const p = new Float32Array(PICKUP_PARTICLES * 3);
    const v = new Float32Array(PICKUP_PARTICLES * 3);
    const v0 = new Float32Array(PICKUP_PARTICLES * 3);
    for (let i = 0; i < PICKUP_PARTICLES; i++) {
      const a = (i / PICKUP_PARTICLES) * 6.28, s = 2 + Math.random() * 6;
      v[i * 3] = v0[i * 3] = Math.cos(a) * s;
      v[i * 3 + 1] = v0[i * 3 + 1] = Math.sin(a) * s;
      v[i * 3 + 2] = v0[i * 3 + 2] = (Math.random() - .5) * 2;
    }
    return { p, v, v0 };
  }, []);
  useFrame((_, dt) => {
    const r = pickupRef.current;
    if (!r?.active || !ptsRef.current) return;
    r.t += dt;
    if (r.t > 1.4) { r.active = false; return; }
    ptsRef.current.visible = true;
    ptsRef.current.position.set(r.x, r.y, 0);
    const a = ptsRef.current.geometry.attributes.position.array as Float32Array;
    if (r.t < .02) { for (let i = 0; i < PICKUP_PARTICLES; i++) { a[i * 3] = a[i * 3 + 1] = a[i * 3 + 2] = 0; st.v[i * 3] = st.v0[i * 3]; st.v[i * 3 + 1] = st.v0[i * 3 + 1]; st.v[i * 3 + 2] = st.v0[i * 3 + 2]; } }
    else { for (let i = 0; i < PICKUP_PARTICLES; i++) { a[i * 3] += st.v[i * 3] * dt; a[i * 3 + 1] += st.v[i * 3 + 1] * dt; a[i * 3 + 2] += st.v[i * 3 + 2] * dt; st.v[i * 3] *= .92; st.v[i * 3 + 1] *= .92; st.v[i * 3 + 2] *= .92; } }
    ptsRef.current.geometry.attributes.position.needsUpdate = true;
    const m = ptsRef.current.material as THREE.PointsMaterial; m.color.set(PWR_COL[r.type]); m.opacity = Math.max(0, 1 - r.t / 1.2);
  });
  return (
    <points ref={ptsRef} visible={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[st.p, 3]} /></bufferGeometry>
      <pointsMaterial size={.14} transparent sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

/* ═══════════════════════════════════════════════════
   Post-processing FX
   ═══════════════════════════════════════════════════ */

export function FX() {
  if (IS_MOBILE) return null;
  return (
    <EffectComposer enableNormalPass={false} multisampling={0}>
      <Bloom luminanceThreshold={.3} mipmapBlur intensity={1.6} radius={.6} />
      <Vignette eskil={false} offset={.08} darkness={1.15} />
    </EffectComposer>
  );
}

/* ═══════════════════════════════════════════════════
   FPS Counter (HTML overlay)
   ═══════════════════════════════════════════════════ */

export function FpsCounter() {
  const ref = useRef<HTMLDivElement>(null);
  const frames = useRef(0);
  const last = useRef(performance.now());
  useFrame(() => {
    frames.current++;
    const now = performance.now();
    if (now - last.current >= 500) {
      const fps = Math.round(frames.current / ((now - last.current) / 1000));
      if (ref.current) ref.current.textContent = `${fps} FPS`;
      frames.current = 0;
      last.current = now;
    }
  });
  return null;
}

export function FpsOverlay() {
  const [fps, setFps] = useState('--');
  const frames = useRef(0);
  const last = useRef(performance.now());
  useEffect(() => {
    let raf: number;
    const tick = () => {
      frames.current++;
      const now = performance.now();
      if (now - last.current >= 500) {
        setFps(`${Math.round(frames.current / ((now - last.current) / 1000))}`);
        frames.current = 0;
        last.current = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 100, background: 'rgba(0,0,0,0.5)', color: '#0f0', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace', pointerEvents: 'none' }}>
      {fps} FPS
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Instanced Asteroid Renderer
   ═══════════════════════════════════════════════════ */

const _dummy = new THREE.Object3D();

export function AsteroidInstances({ pool, geos }: {
  pool: React.MutableRefObject<AsteroidData[]>;
  geos: THREE.SphereGeometry[];
}) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useFrame(() => {
    const counts = new Array(AST_TEX_PAIRS.length).fill(0);
    const poolArr = pool.current;
    for (let i = 0; i < poolArr.length; i++) {
      const a = poolArr[i];
      if (!a.active) continue;
      const texIdx = a.mi % AST_TEX_PAIRS.length;
      const im = refs.current[texIdx];
      if (!im) continue;
      const idx = counts[texIdx];
      _dummy.position.set(a.x, a.y, 0);
      _dummy.rotation.set(a.rx, a.ry, a.rz);
      _dummy.scale.set(a.r * a.sx, a.r * a.sy, a.r * a.sz);
      _dummy.updateMatrix();
      im.setMatrixAt(idx, _dummy.matrix);
      counts[texIdx]++;
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
          ref={(el: THREE.InstancedMesh | null) => { refs.current[texIdx] = el; }}
          args={[geos[texIdx % geos.length], mat, MAX_ASTEROIDS]}
          frustumCulled={false}
        />
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Asteroid splitting — large asteroid → 2-3 small fragments
   ═══════════════════════════════════════════════════ */

export function splitAsteroid(pool: AsteroidData[], parent: AsteroidData, elapsedTime: number): void {
  if (parent.small || parent.r < 0.7) return; // only large asteroids split
  const count = 2 + (Math.random() < 0.4 ? 1 : 0); // 2 or 3 fragments
  let spawned = 0;
  for (let i = 0; i < pool.length && spawned < count; i++) {
    if (pool[i].active) continue;
    const frag = pool[i];
    const angle = (Math.PI * 2 / count) * spawned + (Math.random() - 0.5) * 0.8;
    const speed = 3.5 + Math.random() * 4;
    frag.id = ++aidN;
    frag.x = parent.x + Math.cos(angle) * 0.4;
    frag.y = parent.y + Math.sin(angle) * 0.4;
    frag.vx = parent.vx * 0.4 + Math.cos(angle) * speed;
    frag.vy = parent.vy * 0.4 + Math.sin(angle) * speed;
    frag.r = parent.r * (0.35 + Math.random() * 0.15);
    frag.rx = Math.random() * 6.28; frag.ry = Math.random() * 6.28; frag.rz = Math.random() * 6.28;
    frag.rsx = (Math.random() - 0.5) * 5; frag.rsy = (Math.random() - 0.5) * 5; frag.rsz = (Math.random() - 0.5) * 5;
    frag.sx = 0.85 + Math.random() * 0.3; frag.sy = 0.85 + Math.random() * 0.3; frag.sz = 0.85 + Math.random() * 0.3;
    frag.gi = Math.floor(Math.random() * 6); frag.mi = Math.floor(Math.random() * 4);
    frag.small = true;
    frag.active = true;
    frag.wobbleAmp = 0.5 + Math.random() * 1.2;
    frag.wobbleFreq = 2.5 + Math.random() * 3;
    frag.wobblePhase = Math.random() * 6.28;
    frag.spawnTime = elapsedTime;
    frag.hp = 1;
    spawned++;
  }
}

/* ═══════════════════════════════════════════════════
   Small asteroid explosion (for destroy modes)
   ═══════════════════════════════════════════════════ */

const SMALL_EXPLODE_N = IS_MOBILE ? 4 : 20;
export interface SmallExplosion { x: number; y: number; t: number; active: boolean; color: string }

export function SmallExplosions({ poolRef }: { poolRef: React.MutableRefObject<SmallExplosion[]> }) {
  const MAX_POOL = IS_MOBILE ? 6 : 12;
  const refs = useRef<(THREE.Points | null)[]>([]);
  const initFlags = useRef<boolean[]>(Array(MAX_POOL).fill(false));
  const _warm = useRef(0);
  const data = useMemo(() => {
    const positions: Float32Array[] = [];
    const velocities: Float32Array[] = [];
    for (let p = 0; p < MAX_POOL; p++) {
      positions.push(new Float32Array(SMALL_EXPLODE_N * 3));
      const v = new Float32Array(SMALL_EXPLODE_N * 3);
      for (let i = 0; i < SMALL_EXPLODE_N; i++) {
        const a = Math.random() * 6.28, s = 2 + Math.random() * 8;
        v[i * 3] = Math.cos(a) * s; v[i * 3 + 1] = Math.sin(a) * s; v[i * 3 + 2] = (Math.random() - .5) * 2;
      }
      velocities.push(v);
    }
    return { positions, velocities };
  }, []);

  useFrame((_, delta) => {
    _warm.current++;
    if (_warm.current <= 2) return;
    const dt = Math.min(delta, .033);
    for (let p = 0; p < Math.min(poolRef.current.length, MAX_POOL); p++) {
      const e = poolRef.current[p];
      const pts = refs.current[p];
      if (!pts || !e || !e.active) { if (pts) pts.visible = false; initFlags.current[p] = false; continue; }
      e.t += dt;
      if (e.t > (IS_MOBILE ? 0.5 : 1.0)) { e.active = false; pts.visible = false; initFlags.current[p] = false; continue; }
      pts.visible = true;
      const arr = data.positions[p];
      const vel = data.velocities[p];
      if (!initFlags.current[p]) {
        initFlags.current[p] = true;
        for (let i = 0; i < SMALL_EXPLODE_N; i++) {
          const a = Math.random() * 6.28, s = 3 + Math.random() * 10;
          vel[i * 3] = Math.cos(a) * s; vel[i * 3 + 1] = Math.sin(a) * s; vel[i * 3 + 2] = (Math.random() - .5) * 2;
          arr[i * 3] = e.x; arr[i * 3 + 1] = e.y; arr[i * 3 + 2] = 0;
        }
      } else {
        for (let i = 0; i < SMALL_EXPLODE_N; i++) { arr[i * 3] += vel[i * 3] * dt; arr[i * 3 + 1] += vel[i * 3 + 1] * dt; arr[i * 3 + 2] += vel[i * 3 + 2] * dt; vel[i * 3] *= .93; vel[i * 3 + 1] *= .93; vel[i * 3 + 2] *= .93; }
      }
      const attr = pts.geometry.attributes.position;
      (attr.array as Float32Array).set(arr);
      attr.needsUpdate = true;
      const m = pts.material as THREE.PointsMaterial;
      m.opacity = Math.max(0, 1 - e.t / .8);
      m.size = .18 + e.t * .06;
      m.color.set(e.color);
    }
  });

  return (<>{data.positions.map((pos, i) => (
    <points key={i} ref={el => { refs.current[i] = el; }} visible={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry>
      <pointsMaterial size={.18} transparent opacity={1} blending={THREE.AdditiveBlending} sizeAttenuation depthWrite={false} />
    </points>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Canvas wrapper (shared by all modes)
   ═══════════════════════════════════════════════════ */

export function GameCanvas({ children }: { children: React.ReactNode }) {
  const isMobile = useMemo(() => typeof window !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent), []);
  return (
    <div className="absolute inset-0 w-full h-full" style={{ touchAction: "none" }} onTouchMove={(e) => e.preventDefault()}>
      <Suspense fallback={null}>
        <Canvas
          camera={{ fov: isMobile ? 62 : 50, position: [0, 0, CAM_Z], near: .1, far: 400 }}
          gl={{ antialias: false, powerPreference: "high-performance", alpha: false }}
          dpr={isMobile ? 1 : [1, 1.5]}
          frameloop="always"
        >
          {children}
        </Canvas>
      </Suspense>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Shared pool initializer
   ═══════════════════════════════════════════════════ */

export function createAsteroidPool(): AsteroidData[] {
  return Array.from({ length: MAX_ASTEROIDS }, (_, i) => ({
    id: i, x: 0, y: 0, vx: 0, vy: 0, r: 0,
    rx: 0, ry: 0, rz: 0, rsx: 0, rsy: 0, rsz: 0,
    sx: 1, sy: 1, sz: 1, gi: 0, mi: 0, small: false,
    active: false, wobbleAmp: 0, wobbleFreq: 0, wobblePhase: 0, spawnTime: 0, hp: 1,
  }));
}

export function createGeos(): THREE.SphereGeometry[] {
  const s = IS_MOBILE ? 0.6 : 1;
  return [
    makeRockGeo(Math.round(22 * s), 41), makeRockGeo(Math.round(20 * s), 67), makeRockGeo(Math.round(24 * s), 89),
    makeRockGeo(Math.round(22 * s), 97), makeRockGeo(Math.round(20 * s), 131), makeRockGeo(Math.round(24 * s), 157),
  ];
}
