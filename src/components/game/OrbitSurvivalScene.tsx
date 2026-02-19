import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Trail } from "@react-three/drei";
import * as THREE from "three";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { WalletTraits } from "@/hooks/useWalletData";

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */

type GameState = "start" | "playing" | "gameover";
interface GameProps {
  onScore: (score: number) => void;
  onCoins: (coins: number) => void;
  onGameOver: (finalScore: number, finalCoins: number) => void;
  gameState: GameState;
  traits: WalletTraits | null;
  walletScore: number;
}

interface AsteroidData {
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
}

interface BHole {
  x: number; y: number;
  str: number;
  life: number; maxLife: number;
}

type PwrType = "shield" | "slowmo" | "phase" | "coin";
interface PowerUp {
  id: number;
  x: number; y: number;
  type: PwrType;
  life: number; maxLife: number;
}

/* ═══════════════════════════════════════════════════
   Tuning constants
   ═══════════════════════════════════════════════════ */

const IS_MOBILE = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

const HIT_R = 0.58;
const NEAR_MISS_D = 1.6;
const CAM_Z = 32;
const SPAWN_R = 22;
const DESPAWN_R = 36;

const INIT_SPEED = 4.5;
const MAX_SPEED = 22;
const SPEED_GAIN = 0.18;
const ANG_RATE = 1.2;
const TAP_BOOST = 0.14;

const BH_N = 3;
const BH_STR = 6.0;
const BH_MIN_LIFE = 12;
const BH_MAX_LIFE = 25;
const BH_SPAWN_INTERVAL = 10;
const BH_TURN_K = 4.5;
const BH_CORE_R = 1.6;
const BH_PUSH_STR = 18;
const BH_DEFLECT_K = 5.0;

const EXPLODE_N = 80;
const EXHAUST_N = 60;

const PWR_MAX = 3;
const PWR_SPAWN_INTERVAL = 14;
const PWR_PICKUP_R = 1.5;
const PWR_LIFE = 18;
const SHIELD_DUR = 999;
const SLOWMO_DUR = 6;
const PHASE_DUR = 4;
const COIN_BONUS = 25;
const MAX_ASTEROIDS = 200;

const TIER_COLORS: Record<string, string> = {
  mercury: "#9ca3af", mars: "#ef4444", venus: "#f59e0b", earth: "#22c55e",
  neptune: "#3b82f6", uranus: "#22d3ee", saturn: "#facc15", jupiter: "#fb923c",
  sun: "#fde047", binary_sun: "#ffffff",
};

let aidN = 0;
const rnd = (a: number, b: number) => Math.random() * (b - a) + a;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const slerp = (c: number, t: number, s: number, dt: number) => THREE.MathUtils.lerp(c, t, 1 - Math.exp(-s * dt));
const normAng = (a: number) => { let v = a % (Math.PI * 2); if (v > Math.PI) v -= Math.PI * 2; if (v < -Math.PI) v += Math.PI * 2; return v; };
const seededRng = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

/* ═══════════════════════════════════════════════════
   Rock texture — 512px canvas, 4 palette variants
   ═══════════════════════════════════════════════════ */

function makeRockTex(seed: number, hue: number, sat: number, lBase: number): THREE.CanvasTexture {
  if (typeof document === "undefined") return new THREE.CanvasTexture(document.createElement("canvas"));
  const S = IS_MOBILE ? 256 : 512, c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d")!;
  const R = seededRng(seed);

  g.fillStyle = `hsl(${hue},${sat}%,${lBase}%)`;
  g.fillRect(0, 0, S, S);

  const grd = g.createRadialGradient(S * .35, S * .28, S * .04, S * .5, S * .5, S * .72);
  grd.addColorStop(0, `hsla(${hue},${sat + 5}%,${lBase + 14}%,.5)`);
  grd.addColorStop(.5, `hsla(${hue},${sat}%,${lBase}%,.12)`);
  grd.addColorStop(1, `hsla(${hue},${sat}%,${lBase - 12}%,.55)`);
  g.fillStyle = grd; g.fillRect(0, 0, S, S);

  // Surface noise dots
  const dotCount = IS_MOBILE ? 8000 : 22000;
  for (let i = 0; i < dotCount; i++) {
    const x = R() * S, y = R() * S;
    const l = lBase - 15 + R() * 30, a = .02 + R() * .07, r = .3 + R() * 1.5;
    g.fillStyle = `hsla(${hue + (R() - .5) * 20},${sat * .5}%,${l}%,${a})`;
    g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill();
  }
  // Surface veins / cracks
  const veinCount = IS_MOBILE ? 80 : 240;
  for (let i = 0; i < veinCount; i++) {
    let x = R() * S, y = R() * S;
    g.strokeStyle = `hsla(${hue},${sat * .3}%,${lBase - 22}%,${.06 + R() * .18})`;
    g.lineWidth = .3 + R() * 1.3;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 4 + Math.floor(R() * 8); s++) { x += (R() - .5) * 30; y += (R() - .5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  // Craters with bright rims and dark interiors
  const craterCount = IS_MOBILE ? 8 : 14 + Math.floor(R() * 8);
  for (let i = 0; i < craterCount; i++) {
    const cx = R() * S, cy = R() * S, cr = 4 + R() * (S * .06);
    // Dark crater interior
    const crG = g.createRadialGradient(cx, cy, cr * .05, cx, cy, cr);
    crG.addColorStop(0, `hsla(${hue},${sat * .5}%,${lBase - 25}%,${.25 + R() * .2})`);
    crG.addColorStop(.6, `hsla(${hue},${sat * .4}%,${lBase - 15}%,${.12 + R() * .08})`);
    crG.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = crG; g.beginPath(); g.arc(cx, cy, cr, 0, 6.28); g.fill();
    // Bright rim (top-left lit)
    g.strokeStyle = `hsla(${hue},${sat + 10}%,${lBase + 18}%,${.12 + R() * .15})`;
    g.lineWidth = .8 + R() * 1.5;
    g.beginPath(); g.arc(cx - cr * .15, cy - cr * .15, cr * .85, Math.PI * .8, Math.PI * 1.8); g.stroke();
  }
  // Specular highlight (top-left)
  const specG = g.createRadialGradient(S * .28, S * .22, S * .02, S * .4, S * .35, S * .55);
  specG.addColorStop(0, `hsla(${hue},${sat + 15}%,${lBase + 28}%,.18)`);
  specG.addColorStop(.5, `hsla(${hue},${sat}%,${lBase + 10}%,.04)`);
  specG.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = specG; g.fillRect(0, 0, S, S);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = IS_MOBILE ? 2 : 8; t.needsUpdate = true;
  return t;
}

/* ═══════════════════════════════════════════════════
   Rock geometry — smooth sphere + gentle displacement
   ═══════════════════════════════════════════════════ */

function makeRockGeo(seg: number, seed: number): THREE.SphereGeometry {
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

function spawnAst(el: number, sx: number, sy: number): AsteroidData {
  const small = Math.random() < .6;
  const r = small ? rnd(.4, .9) : rnd(1, 2);
  const a = rnd(0, 6.28), dist = SPAWN_R + rnd(2, 5);
  const ca = a + Math.PI + rnd(-.55, .55);
  // Speed variation: 20% fast, 20% slow, 60% normal
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
  };
}

function spawnBH(sx: number, sy: number): BHole {
  const a = rnd(0, 6.28), d = rnd(8, 18);
  return { x: sx + Math.cos(a) * d, y: sy + Math.sin(a) * d, str: rnd(.6, 1) * BH_STR, life: 0, maxLife: rnd(BH_MIN_LIFE, BH_MAX_LIFE) };
}

let pwIdN = 0;
const PWR_TYPES: PwrType[] = ["shield", "slowmo", "phase", "coin"];
function spawnPowerUp(sx: number, sy: number, heading: number): PowerUp {
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

function Cam({ sPos, shake, gs }: {
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

  const shader = useMemo(() => ({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      #define FBM_ITER ${IS_MOBILE ? 4 : 7}
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

        vec3 col = vec3(.002, .003, .012);

        float n1 = fbm(cuv * 1.5 + vec2(uTime*.008, -uTime*.005));
        float n2 = fbm(cuv * 3.0 + vec2(-uTime*.004, uTime*.01));
        float n3 = fbm(cuv * 2.0 + vec2(uTime*.003, uTime*.003));

        col = mix(col, vec3(.06, .01, .10), smoothstep(.22, .55, n1) * .55);
        col = mix(col, vec3(.01, .03, .12), smoothstep(.28, .6, n2) * .40);
        col = mix(col, vec3(.005, .06, .08), smoothstep(.35, .68, n3) * .30);

        float glow = exp(-r * 1.8) * .04;
        col += vec3(.015, .03, .08) * glow;

        col += renderStars(uv, 40., .55, .015, .03) * .12;
        col += renderStars(uv, 100., .60, .008, .02) * .10;
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

function Dust() {
  const N = IS_MOBILE ? 250 : 500;
  const ref = useRef<THREE.Points>(null);
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
    const dt = Math.min(d, .033);
    ref.current.position.x = s.camera.position.x;
    ref.current.position.y = s.camera.position.y;
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

/* OrbitRings and CoreBeacon removed — no fixed center */

/* ═══════════════════════════════════════════════════
   BLACK HOLES — clean black circle with rotating spiral arms
   ═══════════════════════════════════════════════════ */

const BH_SPIRAL_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const BH_SPIRAL_FS = `
  uniform float uTime;
  uniform float uFade;
  varying vec2 vUv;
  void main(){
    vec2 c = vUv - .5;
    float r = length(c);
    float a = atan(c.y, c.x);
    float spiral = sin(a * 3. - r * 12. + uTime * 2.) * .5 + .5;
    spiral *= smoothstep(.5, .15, r);
    spiral *= smoothstep(.0, .08, r);
    float alpha = spiral * uFade * .55;
    vec3 col = mix(vec3(.15, .08, .25), vec3(.4, .2, .6), spiral);
    gl_FragColor = vec4(col, alpha);
  }
`;

function BHVisuals({ bhRef }: { bhRef: React.MutableRefObject<BHole[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const spiralMats = useRef<(THREE.ShaderMaterial | null)[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < BH_N; i++) {
      const g = refs.current[i];
      const w = bhRef.current[i];
      if (!g) continue;
      if (!w) { g.visible = false; continue; }
      const fadeIn = Math.min(1, w.life * 1.2);
      const fadeOut = Math.min(1, (w.maxLife - w.life) * 1.2);
      const fade = Math.min(fadeIn, fadeOut);
      g.visible = fade > .02;
      g.position.set(w.x, w.y, 0);
      const sc = 1.2 + w.str / BH_STR * .4;
      g.scale.setScalar(sc);

      const core = g.children[0] as THREE.Mesh;
      (core.material as THREE.MeshBasicMaterial).opacity = fade;

      const ring = g.children[1] as THREE.Mesh;
      (ring.material as THREE.MeshBasicMaterial).opacity = fade * .5;

      const sm = spiralMats.current[i];
      if (sm) {
        sm.uniforms.uTime.value = t;
        sm.uniforms.uFade.value = fade;
      }
      const spiralMesh = g.children[2] as THREE.Mesh;
      if (spiralMesh) spiralMesh.rotation.z = t * (.6 + i * .15);

      const glow = g.children[3] as THREE.Mesh;
      (glow.material as THREE.MeshBasicMaterial).opacity = fade * .1 * (.8 + Math.sin(t * 1.5 + i) * .2);
    }
  });

  return (<>{Array.from({ length: BH_N }).map((_, i) => (
    <group key={i} ref={el => { refs.current[i] = el; }} visible={false}>
      <mesh><circleGeometry args={[1, 48]} /><meshBasicMaterial color="#000000" transparent opacity={0} /></mesh>
      <mesh><ringGeometry args={[.92, 1.05, 64]} /><meshBasicMaterial color="#6633aa" transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh position={[0, 0, .01]}>
        <circleGeometry args={[1, 48]} />
        <shaderMaterial
          ref={el => { spiralMats.current[i] = el; }}
          uniforms={{ uTime: { value: 0 }, uFade: { value: 0 } }}
          vertexShader={BH_SPIRAL_VS}
          fragmentShader={BH_SPIRAL_FS}
          transparent
          depthWrite={false}
        />
      </mesh>
      <mesh><circleGeometry args={[2, 32]} /><meshBasicMaterial color="#4422aa" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </group>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Ship
   ═══════════════════════════════════════════════════ */

function Ship({ posRef, headRef, color, scale, nearRef, shieldRef, phaseRef }: {
  posRef: React.MutableRefObject<{ x: number; y: number }>;
  headRef: React.MutableRefObject<number>;
  color: string; scale: number;
  nearRef: React.MutableRefObject<number>;
  shieldRef: React.MutableRefObject<number>;
  phaseRef: React.MutableRefObject<number>;
}) {
  const gRef = useRef<THREE.Group>(null);
  const shRef = useRef<THREE.Mesh>(null);
  const shieldBub = useRef<THREE.Mesh>(null);
  const phaseGlow = useRef<THREE.Mesh>(null);
  const exRef = useRef<THREE.Points>(null);
  const N = EXHAUST_N;

  const exSt = useMemo(() => {
    const p = new Float32Array(N * 3);
    const d: { l: number; ml: number; sp: number; ox: number }[] = [];
    for (let i = 0; i < N; i++) { d.push({ l: Math.random() * .5, ml: .2 + Math.random() * .35, sp: 1.2 + Math.random() * 2.5, ox: (Math.random() - .5) * .12 }); p[i * 3] = 0; p[i * 3 + 1] = -.85; p[i * 3 + 2] = 0; }
    return { p, d };
  }, []);

  useFrame((s, delta) => {
    if (!gRef.current) return;
    const dt = Math.min(delta, .033);
    const t = s.clock.elapsedTime;
    const tx = posRef.current.x, ty = posRef.current.y;
    gRef.current.position.x = slerp(gRef.current.position.x, tx, 8, dt);
    gRef.current.position.y = slerp(gRef.current.position.y, ty, 8, dt);
    const targetRot = headRef.current - Math.PI / 2;
    const curRot = gRef.current.rotation.z;
    let rotDiff = targetRot - curRot;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    gRef.current.rotation.z = curRot + rotDiff * (1 - Math.exp(-10 * dt));
    if (shRef.current) { const m = shRef.current.material as THREE.MeshBasicMaterial; m.opacity = slerp(m.opacity, nearRef.current > .1 ? .25 * nearRef.current : 0, 10, dt); }
    if (shieldBub.current) {
      const on = shieldRef.current > 0;
      shieldBub.current.visible = on;
      if (on) { (shieldBub.current.material as THREE.MeshBasicMaterial).opacity = .12 + Math.sin(t * 4) * .05; shieldBub.current.scale.setScalar(1 + Math.sin(t * 3) * .05); }
    }
    if (phaseGlow.current) {
      const on = phaseRef.current > 0;
      phaseGlow.current.visible = on;
      if (on) { (phaseGlow.current.material as THREE.MeshBasicMaterial).opacity = .15 + Math.sin(t * 6) * .08; }
    }
    if (exRef.current) {
      const a = exRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < N; i++) { const d = exSt.d[i]; d.l -= dt; if (d.l <= 0) { d.l = d.ml; a[i * 3] = d.ox; a[i * 3 + 1] = -.82; a[i * 3 + 2] = (Math.random() - .5) * .05; } else { a[i * 3 + 1] -= d.sp * dt; a[i * 3] += (Math.random() - .5) * dt * .6; a[i * 3 + 2] += (Math.random() - .5) * dt * .3; } }
      exRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <group ref={gRef} scale={[scale, scale, scale]}>
      <Trail width={.6 * scale} length={28} color={color} attenuation={t => Math.pow(t, 1.5)}>
        <group>
          {/* Nose cone */}
          <mesh position={[0, .42, 0]}><coneGeometry args={[.17, .82, 16]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.7} metalness={.92} roughness={.06} toneMapped={false} /></mesh>
          {/* Fuselage */}
          <mesh position={[0, -.1, 0]}><cylinderGeometry args={[.21, .27, .72, 16]} /><meshStandardMaterial color="#e8ecf0" metalness={.94} roughness={.04} emissive="#111820" emissiveIntensity={.15} /></mesh>
          {/* Fuselage accent stripe */}
          <mesh position={[0, -.05, .22]}><boxGeometry args={[.08, .55, .01]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} toneMapped={false} transparent opacity={.7} /></mesh>
          {/* Cockpit canopy */}
          <mesh position={[0, .15, .21]}><sphereGeometry args={[.15, 16, 12, 0, 6.28, 0, Math.PI * .55]} /><meshStandardMaterial color="#67e8f9" emissive="#22d3ee" emissiveIntensity={2.5} toneMapped={false} transparent opacity={.88} /></mesh>
          {/* Cockpit inner glow */}
          <mesh position={[0, .14, .18]}><sphereGeometry args={[.09, 12, 10, 0, 6.28, 0, Math.PI * .5]} /><meshBasicMaterial color="#22d3ee" transparent opacity={.3} blending={THREE.AdditiveBlending} /></mesh>
          {/* Wings — swept delta */}
          <mesh position={[.42, -.08, 0]} rotation={[0, 0, -.3]}><boxGeometry args={[.6, .035, .14]} /><meshStandardMaterial color="#cbd5e1" metalness={.82} roughness={.15} /></mesh>
          <mesh position={[-.42, -.08, 0]} rotation={[0, 0, .3]}><boxGeometry args={[.6, .035, .14]} /><meshStandardMaterial color="#cbd5e1" metalness={.82} roughness={.15} /></mesh>
          {/* Wing tip lights */}
          <mesh position={[.68, -.15, 0]}><sphereGeometry args={[.04, 8, 8]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={3} toneMapped={false} /></mesh>
          <mesh position={[-.68, -.15, 0]}><sphereGeometry args={[.04, 8, 8]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={3} toneMapped={false} /></mesh>
          {/* Engine nacelles */}
          <mesh position={[.2, -.52, 0]}><cylinderGeometry args={[.06, .08, .28, 10]} /><meshStandardMaterial color="#94a3b8" metalness={.94} roughness={.06} /></mesh>
          <mesh position={[-.2, -.52, 0]}><cylinderGeometry args={[.06, .08, .28, 10]} /><meshStandardMaterial color="#94a3b8" metalness={.94} roughness={.06} /></mesh>
          {/* Engine glow rings */}
          <mesh position={[.2, -.66, 0]}><ringGeometry args={[.04, .075, 16]} /><meshBasicMaterial color="#ff8844" transparent opacity={.8} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} /></mesh>
          <mesh position={[-.2, -.66, 0]}><ringGeometry args={[.04, .075, 16]} /><meshBasicMaterial color="#ff8844" transparent opacity={.8} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} /></mesh>
          {/* Engine flames */}
          <mesh position={[.2, -.72, 0]}><sphereGeometry args={[.07, 8, 8]} /><meshStandardMaterial color="#fb923c" emissive="#f97316" emissiveIntensity={6} toneMapped={false} /></mesh>
          <mesh position={[-.2, -.72, 0]}><sphereGeometry args={[.07, 8, 8]} /><meshStandardMaterial color="#fb923c" emissive="#f97316" emissiveIntensity={6} toneMapped={false} /></mesh>
          {/* Antenna */}
          <mesh position={[0, .82, 0]}><cylinderGeometry args={[.008, .008, .12, 4]} /><meshStandardMaterial color="#94a3b8" metalness={.9} roughness={.1} /></mesh>
          <mesh position={[0, .89, 0]}><sphereGeometry args={[.018, 6, 6]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={4} toneMapped={false} /></mesh>
        </group>
      </Trail>
      <mesh ref={shRef}><ringGeometry args={[.85, 1, 32]} /><meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh ref={shieldBub} visible={false}><sphereGeometry args={[1.3, 24, 24]} /><meshBasicMaterial color="#22d3ee" transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh ref={phaseGlow} visible={false}><sphereGeometry args={[1.1, 20, 20]} /><meshBasicMaterial color="#a855f7" transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <points ref={exRef}><bufferGeometry><bufferAttribute attach="attributes-position" args={[exSt.p, 3]} /></bufferGeometry><pointsMaterial size={.06} color="#ffaa55" transparent opacity={.7} blending={THREE.AdditiveBlending} sizeAttenuation depthWrite={false} /></points>
      <pointLight intensity={2.8} color={color} distance={8} />
    </group>
  );
}

/* ═══════════════════════════════════════════════════
   Asteroid mesh
   ═══════════════════════════════════════════════════ */

const AST_M = [
  { col: "#b0b0c8", met: .35, rou: .5 },
  { col: "#ddd0c0", met: .06, rou: .8 },
  { col: "#b8b8d0", met: .4, rou: .35 },
  { col: "#c0dde8", met: .1, rou: .5 },
];

function AstMesh({ a, texs, geos }: { a: AsteroidData; texs: THREE.Texture[]; geos: THREE.SphereGeometry[] }) {
  const geo = geos[a.gi % geos.length];
  const tex = texs[a.mi % texs.length];
  const m = AST_M[a.mi % AST_M.length];
  return (
    <mesh geometry={geo} position={[a.x, a.y, 0]} rotation={[a.rx, a.ry, a.rz]} scale={[a.r * a.sx, a.r * a.sy, a.r * a.sz]}>
      <meshStandardMaterial map={tex} color={m.col} emissive="#444466" emissiveIntensity={.5} roughness={m.rou} metalness={m.met} />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════
   Explosion
   ═══════════════════════════════════════════════════ */

function Explosion({ pRef, actRef }: { pRef: React.MutableRefObject<{ x: number; y: number }>; actRef: React.MutableRefObject<boolean> }) {
  const ptRef = useRef<THREE.Points>(null);
  const rgRef = useRef<THREE.Mesh>(null);
  const tRef = useRef(0);
  const st = useMemo(() => {
    const p = new Float32Array(EXPLODE_N * 3), v = new Float32Array(EXPLODE_N * 3), c = new Float32Array(EXPLODE_N * 3);
    for (let i = 0; i < EXPLODE_N; i++) { const a = Math.random() * 6.28, s = 3 + Math.random() * 14; v[i * 3] = Math.cos(a) * s; v[i * 3 + 1] = Math.sin(a) * s; v[i * 3 + 2] = (Math.random() - .5) * 4; c[i * 3] = .9 + Math.random() * .1; c[i * 3 + 1] = .2 + Math.random() * .4; c[i * 3 + 2] = Math.random() * .15; p[i * 3] = 0; p[i * 3 + 1] = 0; p[i * 3 + 2] = -500; }
    return { p, v, c };
  }, []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, .033);
    if (!actRef.current) { if (ptRef.current) ptRef.current.visible = false; if (rgRef.current) rgRef.current.visible = false; return; }
    tRef.current += dt; const t = tRef.current;
    if (t > 2.2) { actRef.current = false; return; }
    if (ptRef.current) {
      ptRef.current.visible = true;
      const a = ptRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < EXPLODE_N; i++) { if (t < .02) { a[i * 3] = pRef.current.x; a[i * 3 + 1] = pRef.current.y; a[i * 3 + 2] = 0; } else { a[i * 3] += st.v[i * 3] * dt; a[i * 3 + 1] += st.v[i * 3 + 1] * dt; a[i * 3 + 2] += st.v[i * 3 + 2] * dt; st.v[i * 3] *= .97; st.v[i * 3 + 1] *= .97; st.v[i * 3 + 2] *= .97; } }
      ptRef.current.geometry.attributes.position.needsUpdate = true;
      const m = ptRef.current.material as THREE.PointsMaterial; m.opacity = Math.max(0, 1 - t / 1.9); m.size = .18 + t * .08;
    }
    if (rgRef.current) { rgRef.current.visible = true; rgRef.current.position.set(pRef.current.x, pRef.current.y, 0); rgRef.current.scale.setScalar(1 + t * 7); (rgRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, .55 - t / 1.6); }
  });
  return (<>
    <points ref={ptRef} visible={false}><bufferGeometry><bufferAttribute attach="attributes-position" args={[st.p, 3]} /><bufferAttribute attach="attributes-color" args={[st.c, 3]} /></bufferGeometry><pointsMaterial size={.18} vertexColors transparent opacity={1} blending={THREE.AdditiveBlending} sizeAttenuation depthWrite={false} /></points>
    <mesh ref={rgRef} visible={false}><ringGeometry args={[.9, 1.5, 48]} /><meshBasicMaterial color="#ff6633" transparent opacity={.6} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} /></mesh>
  </>);
}

/* ═══════════════════════════════════════════════════
   Power-up pickups — shield, clock, ghost, coin icons
   ═══════════════════════════════════════════════════ */

const PWR_COL: Record<PwrType, string> = { shield: "#22d3ee", slowmo: "#facc15", phase: "#a855f7", coin: "#fbbf24" };

function PowerUpVisuals({ pwRef }: { pwRef: React.MutableRefObject<PowerUp[]> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const iconRefs = useRef<(THREE.Group | null)[]>([]);
  const haloRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let i = 0; i < PWR_MAX; i++) {
      const g = refs.current[i];
      const pw = pwRef.current[i];
      const icons = iconRefs.current[i];
      if (!g || !icons) continue;
      if (!pw) { g.visible = false; continue; }
      const fadeIn = Math.min(1, pw.life * 2);
      const fadeOut = Math.min(1, (pw.maxLife - pw.life) * 2);
      const fade = Math.min(fadeIn, fadeOut);
      g.visible = fade > .02;
      const bob = Math.sin(t * 2.5 + i * 3) * .2;
      const pulse = 1 + Math.sin(t * 3.5 + i * 2) * .08;
      g.position.set(pw.x, pw.y, bob);
      g.rotation.y = t * 1.8;
      g.scale.setScalar(pulse);

      const typeIdx = pw.type === "shield" ? 0 : pw.type === "slowmo" ? 1 : pw.type === "phase" ? 2 : 3;
      icons.children.forEach((c, idx) => { (c as THREE.Mesh).visible = idx === typeIdx; });
      const col = PWR_COL[pw.type];
      icons.children.forEach((c) => {
        const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        m.color.set(col); m.emissive.set(col); m.opacity = fade;
      });
      const halo = haloRefs.current[i];
      if (halo) { const m = halo.material as THREE.MeshBasicMaterial; m.color.set(col); m.opacity = fade * .2 * (.6 + Math.sin(t * 4) * .4); }
      const ring = ringRefs.current[i];
      if (ring) {
        ring.rotation.x = t * 1.2 + i;
        ring.rotation.z = t * .8;
        const rm = ring.material as THREE.MeshBasicMaterial;
        rm.color.set(col); rm.opacity = fade * .45;
      }
    }
  });

  return (<>{Array.from({ length: PWR_MAX }).map((_, i) => (
    <group key={i} ref={el => { refs.current[i] = el; }} visible={false}>
      <group ref={el => { iconRefs.current[i] = el; }}>
        {/* Shield: hexagonal gem */}
        <mesh><octahedronGeometry args={[.42, 1]} /><meshStandardMaterial emissiveIntensity={2.5} toneMapped={false} transparent opacity={0} metalness={.8} roughness={.1} /></mesh>
        {/* Slowmo: torus (clock ring) */}
        <mesh><torusGeometry args={[.32, .14, 16, 24]} /><meshStandardMaterial emissiveIntensity={2.5} toneMapped={false} transparent opacity={0} metalness={.7} roughness={.15} /></mesh>
        {/* Phase: icosahedron (ghostly) */}
        <mesh><icosahedronGeometry args={[.38, 1]} /><meshStandardMaterial emissiveIntensity={3} toneMapped={false} transparent opacity={0} metalness={.3} roughness={.4} /></mesh>
        {/* Coin: cylinder */}
        <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.35, .35, .1, 24]} /><meshStandardMaterial emissiveIntensity={2.5} toneMapped={false} transparent opacity={0} metalness={.9} roughness={.05} /></mesh>
      </group>
      {/* Orbiting ring */}
      <mesh ref={el => { ringRefs.current[i] = el; }}>
        <torusGeometry args={[.6, .03, 8, 32]} />
        <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Inner glow */}
      <mesh ref={el => { haloRefs.current[i] = el; }}>
        <sphereGeometry args={[.7, 14, 14]} />
        <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <pointLight intensity={2.2} distance={5} />
    </group>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Pickup effect — particles on power-up collect
   ═══════════════════════════════════════════════════ */

const PICKUP_PARTICLES = 24;
function PickupEffect({ pickupRef }: { pickupRef: React.MutableRefObject<{ active: boolean; type: PwrType; x: number; y: number; t: number }> }) {
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
    if (r.t < .02) {
      for (let i = 0; i < PICKUP_PARTICLES; i++) {
        a[i * 3] = a[i * 3 + 1] = a[i * 3 + 2] = 0;
        st.v[i * 3] = st.v0[i * 3]; st.v[i * 3 + 1] = st.v0[i * 3 + 1]; st.v[i * 3 + 2] = st.v0[i * 3 + 2];
      }
    } else {
      for (let i = 0; i < PICKUP_PARTICLES; i++) {
        a[i * 3] += st.v[i * 3] * dt; a[i * 3 + 1] += st.v[i * 3 + 1] * dt; a[i * 3 + 2] += st.v[i * 3 + 2] * dt;
        st.v[i * 3] *= .92; st.v[i * 3 + 1] *= .92; st.v[i * 3 + 2] *= .92;
      }
    }
    ptsRef.current.geometry.attributes.position.needsUpdate = true;
    const m = ptsRef.current.material as THREE.PointsMaterial;
    m.color.set(PWR_COL[r.type]); m.opacity = Math.max(0, 1 - r.t / 1.2);
  });

  return (
    <points ref={ptsRef} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[st.p, 3]} />
      </bufferGeometry>
      <pointsMaterial size={.14} transparent sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

/* ═══════════════════════════════════════════════════
   Post-processing — CLEAN, not blurry
   ═══════════════════════════════════════════════════ */

function FX() {
  return (
    <EffectComposer disableNormalPass multisampling={IS_MOBILE ? 0 : 2}>
      <Bloom luminanceThreshold={IS_MOBILE ? .4 : .3} mipmapBlur intensity={IS_MOBILE ? 1.2 : 1.6} radius={IS_MOBILE ? .4 : .6} />
      {!IS_MOBILE && <Vignette eskil={false} offset={.08} darkness={1.15} />}
    </EffectComposer>
  );
}

function PooledAsteroid({ index, texs, geos, meshRefs }: { 
  index: number; 
  texs: THREE.Texture[]; 
  geos: THREE.SphereGeometry[];
  meshRefs: React.MutableRefObject<(THREE.Mesh | null)[]>;
}) {
  const geo = geos[index % geos.length];
  const tex = texs[index % texs.length];
  const m = AST_M[index % AST_M.length];
  return (
    <mesh ref={el => { meshRefs.current[index] = el; }} geometry={geo} visible={false}>
      <meshStandardMaterial map={tex} color={m.col} emissive="#444466" emissiveIntensity={.5} roughness={m.rou} metalness={m.met} />
    </mesh>
  );
}

function GameWorld({ gameState, onGameOver, onScore, onCoins, traits }: GameProps) {
  const asteroidPool = useRef<AsteroidData[]>([]);
  const asteroidMeshRefs = useRef<(THREE.Mesh | null)[]>([]);

  useMemo(() => {
    asteroidPool.current = Array.from({ length: MAX_ASTEROIDS }, (_, i) => ({
      id: i,
      x: 0, y: 0,
      vx: 0, vy: 0,
      r: 0,
      rx: 0, ry: 0, rz: 0,
      rsx: 0, rsy: 0, rsz: 0,
      sx: 1, sy: 1, sz: 1,
      gi: 0, mi: 0,
      small: false,
      active: false,
      wobbleAmp: 0, wobbleFreq: 0, wobblePhase: 0,
      spawnTime: 0,
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
  const scoreRef = useRef(-1);
  const shake = useRef(0);
  const explPos = useRef({ x: 0, y: 0 });
  const explAct = useRef(false);
  const bonusPoints = useRef(0);
  const coinBank = useRef(0);
  const coinAccum = useRef(0);
  const pickupEffect = useRef({ active: false, type: "shield" as PwrType, x: 0, y: 0, t: 0 });

  const sCol = traits?.planetTier ? TIER_COLORS[traits.planetTier] || "#22d3ee" : "#22d3ee";
  const sSc = traits?.planetTier === "binary_sun" ? 1.08 : 1;

  const texs = useMemo(() => [
    makeRockTex(17, 220, 14, 58), makeRockTex(29, 30, 16, 70),
    makeRockTex(53, 240, 18, 62), makeRockTex(71, 195, 22, 68),
  ], []);
  const geos = useMemo(() => {
    const s = IS_MOBILE ? 0.6 : 1;
    return [
      makeRockGeo(Math.round(22 * s), 41), makeRockGeo(Math.round(20 * s), 67), makeRockGeo(Math.round(24 * s), 89),
      makeRockGeo(Math.round(22 * s), 97), makeRockGeo(Math.round(20 * s), 131), makeRockGeo(Math.round(24 * s), 157),
    ];
  }, []);

  useEffect(() => () => { texs.forEach(t => t.dispose()); geos.forEach(g => g.dispose()); }, [texs, geos]);

  useEffect(() => {
    if (gameState !== "playing") return;
    const rev = () => {
      orbDir.current = orbDir.current === 1 ? -1 : 1;
      // Instant heading bump so tap feels immediate
      headingBoost.current = TAP_BOOST * orbDir.current;
    };
    const onK = (e: KeyboardEvent) => { if (e.code === "Space" || e.key === " ") { e.preventDefault(); rev(); } };
    const onM = (e: MouseEvent) => { if (e.button === 0) rev(); };
    const onT = (e: TouchEvent) => { e.preventDefault(); rev(); };
    window.addEventListener("keydown", onK);
    window.addEventListener("mousedown", onM);
    window.addEventListener("touchstart", onT, { passive: false });
    return () => {
      window.removeEventListener("keydown", onK);
      window.removeEventListener("mousedown", onM);
      window.removeEventListener("touchstart", onT);
    };
  }, [gameState]);

  useEffect(() => {
    if (gameState !== "playing") return;
    aidN = 0; pwIdN = 0;
    
    // Reset pool
    asteroidPool.current.forEach(a => { a.active = false; });
    asteroidMeshRefs.current.forEach(m => { if (m) m.visible = false; });

    shipPos.current = { x: 5, y: 0 }; shipHead.current = Math.PI / 2;
    orbDir.current = 1; curSpeed.current = INIT_SPEED; nearMiss.current = 0; headingBoost.current = 0;
    bhs.current = [spawnBH(5, 0)]; bhTimer.current = 0;
    pws.current = []; pwTimer.current = 0;
    shieldT.current = 0; slowmoT.current = 0; phaseT.current = 0;
    bonusPoints.current = 0;
    coinBank.current = 0;
    coinAccum.current = 0;
    onCoins(0);
    elapsed.current = 0; spawnT.current = 0; physAccum.current = 0;
    overRef.current = false; scoreRef.current = -1; shake.current = 0; explAct.current = false;
    pickupEffect.current.active = false;
    onScore(0);
  }, [gameState]);

  const physAccum = useRef(0);
  const PHYS_DT = 1 / 90; // fixed physics timestep

  useFrame((_, delta) => {
    if (gameState !== "playing" || overRef.current) return;
    const frameDt = Math.min(delta, .1);
    physAccum.current += frameDt;
    // Cap max sub-steps to prevent spiral of death
    if (physAccum.current > PHYS_DT * 6) physAccum.current = PHYS_DT * 6;

    while (physAccum.current >= PHYS_DT) {
      physAccum.current -= PHYS_DT;
      const dt = PHYS_DT;
      elapsed.current += dt;
      const el = elapsed.current;

      if (shieldT.current > 0) shieldT.current -= dt;
      if (slowmoT.current > 0) slowmoT.current -= dt;
      if (phaseT.current > 0) phaseT.current -= dt;

      const tSpeed = clamp(INIT_SPEED + el * SPEED_GAIN, INIT_SPEED, MAX_SPEED);
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

      const nextBH: BHole[] = [];
      for (const bh of bhs.current) {
        bh.life += dt;
        if (bh.life >= bh.maxLife) continue;
        const fadeIn = Math.min(1, bh.life * 1.2);
        const fadeOut = Math.min(1, (bh.maxLife - bh.life) * 1.2);
        const fade = Math.min(fadeIn, fadeOut);

        const dx = bh.x - px, dy = bh.y - py;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < BH_CORE_R) {
          const safeD = Math.max(0.05, dist);
          const awayX = (px - bh.x) / safeD, awayY = (py - bh.y) / safeD;
          const pushStr = BH_PUSH_STR * (1 - dist / BH_CORE_R) * dt;
          px += awayX * pushStr;
          py += awayY * pushStr;
          const exitAng = Math.atan2(awayY, awayX);
          const diff = normAng(exitAng - heading);
          heading += diff * Math.min(1, 6 * dt);
          curSpeed.current = Math.min(curSpeed.current + bh.str * .5 * dt, MAX_SPEED * 1.25);
          shake.current = Math.max(shake.current, .4);
        } else {
          const angleToBH = Math.atan2(dy, dx);
          const cross = Math.cos(heading) * dy - Math.sin(heading) * dx;
          const deflectDir = cross >= 0 ? 1 : -1;
          const perpAngle = angleToBH + deflectDir * Math.PI * 0.5;
          const deflectDiff = normAng(perpAngle - heading);
          const safeDist = Math.max(2, dist);
          const deflectStr = bh.str * BH_DEFLECT_K / (safeDist * safeDist) * fade;
          heading += deflectDiff * deflectStr * dt;
          if (dist < 6) {
            curSpeed.current = Math.min(curSpeed.current + bh.str * .08 * dt, MAX_SPEED * 1.1);
          }
        }
        nextBH.push(bh);
      }
      bhs.current = nextBH;

      px += Math.cos(heading) * curSpeed.current * dt;
      py += Math.sin(heading) * curSpeed.current * dt;

      shipHead.current = heading;
      shipPos.current.x = px;
      shipPos.current.y = py;
    }

    const dt = frameDt;
    const el = elapsed.current;

    const sc = Math.floor(el) + bonusPoints.current;
    if (sc !== scoreRef.current) { scoreRef.current = sc; onScore(sc); }

    // Time-based coin accumulation: 1/sec base, +1/sec every 30s
    const coinsPerSec = 1 + Math.floor(el / 30);
    coinAccum.current += coinsPerSec * dt;
    const wholeCoins = Math.floor(coinAccum.current);
    if (wholeCoins > 0) {
      coinBank.current += wholeCoins;
      coinAccum.current -= wholeCoins;
      onCoins(coinBank.current);
    }

    const px = shipPos.current.x, py = shipPos.current.y;
    const heading = shipHead.current;

    nearMiss.current = Math.max(0, nearMiss.current - dt * 3);

    pwTimer.current += dt;
    if (pwTimer.current >= PWR_SPAWN_INTERVAL && pws.current.length < PWR_MAX) {
      pws.current.push(spawnPowerUp(px, py, heading));
      pwTimer.current = 0;
    }

    const nextPW: PowerUp[] = [];
    for (const pw of pws.current) {
      pw.life += dt;
      if (pw.life >= pw.maxLife) continue;
      const pdx = pw.x - px, pdy = pw.y - py;
      if (Math.sqrt(pdx * pdx + pdy * pdy) < PWR_PICKUP_R) {
        if (pw.type === "shield") shieldT.current = SHIELD_DUR;
        else if (pw.type === "slowmo") slowmoT.current = SLOWMO_DUR;
        else if (pw.type === "phase") phaseT.current = PHASE_DUR;
        else if (pw.type === "coin") {
          bonusPoints.current += COIN_BONUS;
          coinBank.current += COIN_BONUS;
          onCoins(coinBank.current);
          const newSc = Math.floor(el) + bonusPoints.current;
          scoreRef.current = newSc;
          onScore(newSc);
        }
        pickupEffect.current = { active: true, type: pw.type, x: px, y: py, t: 0 };
        shake.current = Math.max(shake.current, .3);
        continue;
      }
      nextPW.push(pw);
    }
    pws.current = nextPW;

    // SPAWNING
    spawnT.current += dt;
    const si = Math.max(.3, 1.45 - el * .012);
    if (spawnT.current >= si) {
      spawnT.current = 0;
      const wc = el > 35 && Math.random() < .35 ? 2 : 1;
      
      let spawned = 0;
      for (let i = 0; i < asteroidPool.current.length; i++) {
        if (spawned >= wc) break;
        const a = asteroidPool.current[i];
        if (!a.active) {
          const newData = spawnAst(el, px, py);
          Object.assign(a, { ...newData, active: true });
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

    // PHYSICS & RENDER UPDATE LOOP
    const sx = shipPos.current.x, sy = shipPos.current.y;
    
    for (let i = 0; i < asteroidPool.current.length; i++) {
      const a = asteroidPool.current[i];
      const mesh = asteroidMeshRefs.current[i];
      if (!mesh) continue;

      if (!a.active) {
        if (mesh.visible) mesh.visible = false;
        continue;
      }

      // Physics
      let nvx = a.vx, nvy = a.vy;
      for (const bh of currentBHs) {
        const bdx = bh.x - a.x, bdy = bh.y - a.y;
        const bd = Math.sqrt(bdx * bdx + bdy * bdy);
        const bsd = Math.max(1, bd);
        const bfadeIn = Math.min(1, bh.life * .6);
        const bfadeOut = Math.min(1, (bh.maxLife - bh.life) * .6);
        const bfade = Math.min(bfadeIn, bfadeOut);
        const bf = bh.str * 6 / (bsd * bsd) * bfade;
        nvx += (bdx / bsd) * bf * dt;
        nvy += (bdy / bsd) * bf * dt;
      }

      a.vx = nvx; a.vy = nvy;
      // Wobble: sinusoidal perpendicular drift for unpredictable movement
      const age = el - a.spawnTime;
      const wob = a.wobbleAmp * Math.sin(age * a.wobbleFreq + a.wobblePhase);
      const spd2 = nvx * nvx + nvy * nvy;
      const invSpd = spd2 > .001 ? 1 / Math.sqrt(spd2) : 1;
      const perpX = -nvy * invSpd, perpY = nvx * invSpd;
      const nx = a.x + (nvx + perpX * wob) * dtf;
      const ny = a.y + (nvy + perpY * wob) * dtf;
      a.x = nx; a.y = ny;

      // Despawn check (squared distance — no sqrt)
      const dsx = nx - sx, dsy = ny - sy;
      const dd2 = dsx * dsx + dsy * dsy;
      if (dd2 > DESPAWN_R2) {
        a.active = false;
        mesh.visible = false;
        continue;
      }

      // Collision + near-miss (squared distance — one sqrt only when close)
      const cd = HIT_R + a.r * .88;
      const cd2sq = cd * cd;
      const nmOuter = cd + NEAR_MISS_D;
      if (dd2 < nmOuter * nmOuter && !isPhase) {
        if (dd2 < cd2sq) {
          if (hasShield) { 
            shieldT.current = 0; 
            shake.current = Math.max(shake.current, 1); 
            a.active = false;
            mesh.visible = false;
            continue; 
          }
          overRef.current = true; 
          shake.current = 2; 
          explPos.current = { x: sx, y: sy }; 
          explAct.current = true;
          onGameOver(Math.floor(el) + bonusPoints.current, coinBank.current); 
          return;
        }
        const hd = Math.sqrt(dd2);
        const inten = 1 - (hd - cd) / NEAR_MISS_D;
        nearMiss.current = Math.max(nearMiss.current, inten);
      }

      // Update Mesh
      mesh.visible = true;
      mesh.position.set(a.x, a.y, 0);
      mesh.rotation.set(a.rx, a.ry, a.rz);
      mesh.scale.set(a.r * a.sx, a.r * a.sy, a.r * a.sz);
      a.rx += a.rsx * dtf;
      a.ry += a.rsy * dtf;
      a.rz += a.rsz * dtf;
    }
  });

  return (
    <>
      <color attach="background" args={["#010208"]} />
      <ambientLight intensity={.35} />
      <directionalLight intensity={.65} color="#93c5fd" position={[8, 10, 14]} />
      <directionalLight intensity={.32} color="#f8fafc" position={[-12, -8, 12]} />

      <Cam sPos={shipPos} shake={shake} gs={gameState} />
      <SpaceBG />
      <Dust />

      <BHVisuals bhRef={bhs} />
      <Ship posRef={shipPos} headRef={shipHead} color={sCol} scale={sSc} nearRef={nearMiss} shieldRef={shieldT} phaseRef={phaseT} />
      <PowerUpVisuals pwRef={pws} />
      <PickupEffect pickupRef={pickupEffect} />

      {Array.from({ length: MAX_ASTEROIDS }).map((_, i) => (
        <PooledAsteroid 
          key={i} 
          index={i} 
          texs={texs} 
          geos={geos} 
          meshRefs={asteroidMeshRefs} 
        />
      ))}

      <Explosion pRef={explPos} actRef={explAct} />
      <FX />
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════ */

export default function OrbitSurvivalScene(props: GameProps) {
  const isMobile = useMemo(() => typeof window !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent), []);
  return (
    <div
      className="absolute inset-0 w-full h-full"
      style={{ touchAction: "none" }}
      onTouchMove={(e) => e.preventDefault()}
    >
      <Suspense fallback={null}>
        <Canvas
          camera={{ fov: isMobile ? 62 : 50, position: [0, 0, CAM_Z], near: .1, far: 400 }}
          gl={{ antialias: !isMobile, powerPreference: "high-performance", alpha: false }}
          dpr={isMobile ? [1, 1.2] : [1, 2]}
          frameloop="always"
        >
          <GameWorld {...props} />
        </Canvas>
      </Suspense>
    </div>
  );
}
