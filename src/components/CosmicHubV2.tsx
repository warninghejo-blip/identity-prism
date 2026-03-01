/**
 * CosmicHub V2 — Premium 3D orbital menu.
 * 
 * Each module is a unique procedural shader sphere (SeekerSun-level quality):
 *   - Black Hole: gravitational lensing distortion sphere
 *   - Prism League: electric plasma energy ball
 *   - Stellar Forge: molten lava/magma sphere
 *   - Nebula Market: swirling galaxy/nebula sphere
 *   - Constellation: crystalline ice sphere with sparkles
 *   - Scam Shield: red pulsing warning sphere
 *   - Identity Card: center, mini version of user's planet
 *
 * Features:
 *   - Starfield with parallax on camera rotation
 *   - Orbit trails (glowing rings)
 *   - Camera auto-orbit + drag-to-rotate (touch/mouse)
 *   - Bloom + chromatic aberration post-processing
 *   - Nebula fog backdrop
 *   - Zoom-in transition on module select
 *   - Mobile-first touch controls
 */

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber';
import { Stars, Float } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import {
  Vector3, Vector2, Color, Group, Mesh, ShaderMaterial,
  AdditiveBlending, BackSide, DoubleSide, FrontSide,
  SphereGeometry, RingGeometry, MathUtils,
} from 'three';
import { BlendFunction } from 'postprocessing';
import { useNavigate } from 'react-router-dom';
import type { PrismBalance } from '@/lib/prismCoin';

const IS_MOBILE = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

// ── Simplex noise GLSL (shared across all module shaders) ──
const NOISE_GLSL = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p,int oct){
  float v=0.0,a=0.5,f=1.0;
  for(int i=0;i<6;i++){if(i>=oct)break;v+=a*abs(snoise(p*f));f*=2.1;a*=0.48;}
  return v;
}
`;

const SHARED_VERT = `
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vViewPos;
void main(){
  vUv=uv; vPos=position;
  vNormal=normalize(normalMatrix*normal);
  vec4 mv=modelViewMatrix*vec4(position,1.0);
  vViewPos=-mv.xyz;
  gl_Position=projectionMatrix*mv;
}
`;

// ── Module shader fragments — each unique and premium ──

// Black Hole — gravitational distortion, event horizon glow
const FRAG_BLACKHOLE = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;varying vec3 vPos;varying vec3 vNormal;
uniform float uTime;
void main(){
  vec3 p=vPos*2.5;
  float t=uTime*0.3;
  float distort=fbm(p+vec3(t*0.2,-t*0.15,t*0.1),5);
  float hole=1.0-smoothstep(0.0,0.4,length(vUv-0.5));
  float ring=smoothstep(0.35,0.38,length(vUv-0.5))*smoothstep(0.42,0.38,length(vUv-0.5));
  float fresnel=pow(1.0-abs(dot(vNormal,vec3(0,0,1))),3.0);
  vec3 col=vec3(0.15,0.0,0.3)*distort+vec3(0.6,0.2,0.9)*ring*3.0;
  col+=vec3(0.4,0.1,0.8)*fresnel*1.5;
  col+=vec3(0.8,0.4,1.0)*pow(distort,2.0)*0.5;
  float alpha=0.7+fresnel*0.3+ring;
  gl_FragColor=vec4(col,alpha);
}`;

// Prism League — electric plasma energy
const FRAG_LEAGUE = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;varying vec3 vPos;varying vec3 vNormal;
uniform float uTime;
void main(){
  vec3 p=vPos*3.0;
  float t=uTime*0.5;
  float plasma=fbm(p+vec3(t*0.3,t*0.2,-t*0.4),5);
  float bolt=max(0.0,snoise(p*8.0+t*4.0));bolt=step(0.75,bolt)*2.0;
  float fresnel=pow(1.0-abs(dot(vNormal,vec3(0,0,1))),2.5);
  vec3 col=mix(vec3(0.0,0.6,0.9),vec3(0.0,1.0,0.9),plasma);
  col+=vec3(0.5,0.9,1.0)*bolt;
  col+=vec3(0.2,0.8,1.0)*fresnel*2.0;
  float alpha=0.6+plasma*0.3+fresnel*0.3;
  gl_FragColor=vec4(col,alpha);
}`;

// Stellar Forge — molten magma/lava
const FRAG_FORGE = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;varying vec3 vPos;varying vec3 vNormal;
uniform float uTime;
void main(){
  vec3 p=vPos*2.0;
  float t=uTime*0.2;
  float lava1=fbm(p+vec3(t*0.1,t*0.08,-t*0.05),5);
  float lava2=fbm(p*2.5+vec3(-t*0.15,t*0.12,t*0.09),4);
  float cracks=pow(lava1,0.5)*0.7+pow(lava2,0.7)*0.3;
  float fresnel=pow(1.0-abs(dot(vNormal,vec3(0,0,1))),2.0);
  vec3 hot=vec3(1.0,0.4,0.0);
  vec3 cool=vec3(0.3,0.05,0.0);
  vec3 white=vec3(1.0,0.9,0.5);
  vec3 col=mix(cool,hot,cracks);
  col=mix(col,white,pow(cracks,3.0)*0.5);
  col+=vec3(1.0,0.6,0.1)*fresnel*1.5;
  float alpha=0.8+fresnel*0.2;
  gl_FragColor=vec4(col,alpha);
}`;

// Nebula Market — swirling galaxy
const FRAG_NEBULA = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;varying vec3 vPos;varying vec3 vNormal;
uniform float uTime;
void main(){
  vec3 p=vPos*2.0;
  float t=uTime*0.15;
  float angle=atan(p.y,p.x);
  float r=length(p.xy);
  float spiral=snoise(vec3(angle*2.0+r*3.0-t*2.0,r*2.0+t,p.z))*0.5+0.5;
  float dust=fbm(p+vec3(t*0.1,t*0.08,-t*0.06),4);
  float fresnel=pow(1.0-abs(dot(vNormal,vec3(0,0,1))),2.5);
  vec3 col=mix(vec3(0.8,0.1,0.5),vec3(0.2,0.1,0.6),spiral);
  col=mix(col,vec3(0.9,0.5,0.8),dust*0.5);
  col+=vec3(0.6,0.2,0.8)*fresnel*1.5;
  float stars=step(0.95,snoise(vPos*30.0))*0.8;
  col+=vec3(1.0)*stars;
  float alpha=0.6+dust*0.3+fresnel*0.2;
  gl_FragColor=vec4(col,alpha);
}`;

// Constellation — crystalline ice with sparkles
const FRAG_CRYSTAL = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;varying vec3 vPos;varying vec3 vNormal;
uniform float uTime;
void main(){
  vec3 p=vPos*4.0;
  float t=uTime*0.3;
  float crystal=abs(snoise(p+t*0.2))*0.5+abs(snoise(p*2.0-t*0.3))*0.3;
  float sparkle=step(0.92,snoise(vPos*25.0+t*3.0))*2.0;
  float fresnel=pow(1.0-abs(dot(vNormal,vec3(0,0,1))),3.0);
  vec3 col=mix(vec3(0.1,0.7,0.5),vec3(0.3,0.9,0.8),crystal);
  col+=vec3(0.8,1.0,0.9)*sparkle;
  col+=vec3(0.4,0.9,0.7)*fresnel*2.0;
  float alpha=0.5+crystal*0.3+fresnel*0.3+sparkle*0.2;
  gl_FragColor=vec4(col,alpha);
}`;

// Scam Shield — pulsing red warning
const FRAG_SHIELD = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;varying vec3 vPos;varying vec3 vNormal;
uniform float uTime;
void main(){
  vec3 p=vPos*3.0;
  float t=uTime*0.4;
  float pulse=sin(t*3.0)*0.3+0.7;
  float scan=fbm(p+vec3(0,t*0.5,0),4);
  float hexGrid=abs(snoise(vPos*8.0))*0.5;
  float fresnel=pow(1.0-abs(dot(vNormal,vec3(0,0,1))),2.0);
  vec3 col=mix(vec3(0.6,0.05,0.05),vec3(1.0,0.2,0.1),scan*pulse);
  col+=vec3(1.0,0.4,0.2)*hexGrid*0.3;
  col+=vec3(1.0,0.3,0.2)*fresnel*1.5*pulse;
  float alpha=0.6+fresnel*0.3+scan*0.1;
  gl_FragColor=vec4(col,alpha);
}`;

// ── Module definitions ──
interface HubModuleDef {
  id: string;
  label: string;
  route: string;
  frag: string;
  color: string;
  emissive: string;
  orbitRadius: number;
  orbitSpeed: number;
  startAngle: number;
  size: number;
  lightIntensity: number;
  description: string;
}

const MODULES: HubModuleDef[] = [
  { id: 'blackhole', label: 'Black Hole', route: '/blackhole', frag: FRAG_BLACKHOLE, color: '#8b5cf6', emissive: '#7c3aed', orbitRadius: 5.0, orbitSpeed: 0.12, startAngle: 0, size: 0.7, lightIntensity: 3, description: 'Burn dust tokens · Reclaim SOL' },
  { id: 'league', label: 'Prism League', route: '/game', frag: FRAG_LEAGUE, color: '#06b6d4', emissive: '#0891b2', orbitRadius: 5.5, orbitSpeed: 0.1, startAngle: Math.PI * 2 / 6, size: 0.75, lightIntensity: 4, description: '3 game modes · Earn PRISM' },
  { id: 'forge', label: 'Stellar Forge', route: '/forge', frag: FRAG_FORGE, color: '#f59e0b', emissive: '#d97706', orbitRadius: 5.2, orbitSpeed: 0.14, startAngle: Math.PI * 4 / 6, size: 0.65, lightIntensity: 5, description: 'Craft upgrades · Ship skins' },
  { id: 'market', label: 'Nebula Market', route: '/market', frag: FRAG_NEBULA, color: '#ec4899', emissive: '#db2777', orbitRadius: 5.8, orbitSpeed: 0.08, startAngle: Math.PI * 6 / 6, size: 0.7, lightIntensity: 3, description: 'Leaderboards · Challenges' },
  { id: 'constellation', label: 'Constellation', route: '/constellation', frag: FRAG_CRYSTAL, color: '#10b981', emissive: '#059669', orbitRadius: 5.0, orbitSpeed: 0.13, startAngle: Math.PI * 8 / 6, size: 0.6, lightIntensity: 3, description: 'Wallet connection graph' },
  { id: 'shield', label: 'Scam Shield', route: '/scam-checker', frag: FRAG_SHIELD, color: '#ef4444', emissive: '#dc2626', orbitRadius: 5.4, orbitSpeed: 0.11, startAngle: Math.PI * 10 / 6, size: 0.6, lightIntensity: 4, description: 'Check contracts · Dark pool' },
];

// ── Procedural Module Orb ──
function ModuleOrb({ mod, onSelect, selected }: { mod: HubModuleDef; onSelect: (m: HubModuleDef) => void; selected: boolean }) {
  const groupRef = useRef<Group>(null!);
  const matRef = useRef<ShaderMaterial>(null!);
  const [hovered, setHovered] = useState(false);

  const material = useMemo(() => new ShaderMaterial({
    vertexShader: SHARED_VERT,
    fragmentShader: mod.frag,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: FrontSide,
  }), [mod.frag]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    material.uniforms.uTime.value = t;

    if (!groupRef.current) return;
    const angle = mod.startAngle + t * mod.orbitSpeed;
    const r = mod.orbitRadius;
    groupRef.current.position.x = Math.cos(angle) * r;
    groupRef.current.position.z = Math.sin(angle) * r;
    groupRef.current.position.y = Math.sin(t * 0.4 + mod.startAngle) * 0.4;
  });

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    onSelect(mod);
  }, [mod, onSelect]);

  const scale = hovered ? 1.15 : 1;

  return (
    <group ref={groupRef}>
      {/* Point light for local illumination */}
      <pointLight color={mod.emissive} intensity={mod.lightIntensity * (hovered ? 1.5 : 1)} distance={4} />

      {/* Outer glow shell */}
      <mesh>
        <sphereGeometry args={[mod.size * 1.6, 24, 24]} />
        <meshBasicMaterial color={mod.color} transparent opacity={hovered ? 0.12 : 0.04} blending={AdditiveBlending} depthWrite={false} side={BackSide} />
      </mesh>

      {/* Main procedural sphere */}
      <mesh
        scale={scale}
        material={material}
        onClick={handleClick}
        onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default'; }}
      >
        <sphereGeometry args={[mod.size, IS_MOBILE ? 32 : 48, IS_MOBILE ? 32 : 48]} />
      </mesh>

      {/* Inner core glow */}
      <mesh>
        <sphereGeometry args={[mod.size * 0.5, 16, 16]} />
        <meshBasicMaterial color={mod.color} transparent opacity={0.6} blending={AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Label — HTML overlay */}
      {/* Using drei Html causes perf issues on mobile with 6 modules, so use a simple sprite approach */}
    </group>
  );
}

// ── Orbit trail rings ──
function OrbitRings() {
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      {MODULES.map((mod) => (
        <mesh key={mod.id}>
          <ringGeometry args={[mod.orbitRadius - 0.015, mod.orbitRadius + 0.015, 128]} />
          <meshBasicMaterial color={mod.color} transparent opacity={0.06} side={DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// ── Nebula backdrop ──
function NebulaBackdrop() {
  const matRef = useRef<ShaderMaterial>(null!);
  const mat = useMemo(() => new ShaderMaterial({
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      ${NOISE_GLSL}
      void main(){
        vec2 uv=vUv-0.5;
        float r=length(uv);
        float a=atan(uv.y,uv.x);
        float n1=snoise(vec3(uv*3.0,uTime*0.03))*0.5+0.5;
        float n2=snoise(vec3(uv*5.0+2.0,uTime*0.02))*0.5+0.5;
        vec3 c1=vec3(0.05,0.0,0.15)*n1;
        vec3 c2=vec3(0.1,0.02,0.08)*n2;
        vec3 col=c1+c2;
        col*=smoothstep(0.7,0.2,r);
        gl_FragColor=vec4(col,1.0);
      }
    `,
    uniforms: { uTime: { value: 0 } },
    depthWrite: false,
    transparent: false,
  }), []);

  useFrame(({ clock }) => { mat.uniforms.uTime.value = clock.getElapsedTime(); });

  return (
    <mesh position={[0, 0, -30]} material={mat}>
      <planeGeometry args={[80, 80]} />
    </mesh>
  );
}

// ── Camera controller — auto-orbit + drag/touch rotate ──
function CameraRig({ zoomTarget, isZooming, onZoomDone }: { zoomTarget: Vector3 | null; isZooming: boolean; onZoomDone: () => void }) {
  const { camera, gl } = useThree();
  const angleRef = useRef(0);
  const dragRef = useRef({ active: false, startX: 0, angleStart: 0 });
  const zoomProgress = useRef(0);
  const homePos = useRef(new Vector3());

  useEffect(() => {
    const canvas = gl.domElement;
    const onDown = (e: PointerEvent) => {
      dragRef.current = { active: true, startX: e.clientX, angleStart: angleRef.current };
    };
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      angleRef.current = dragRef.current.angleStart + dx * 0.005;
    };
    const onUp = () => { dragRef.current.active = false; };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [gl]);

  useFrame((_, delta) => {
    if (isZooming && zoomTarget) {
      zoomProgress.current = Math.min(1, zoomProgress.current + delta * 1.5);
      const ease = 1 - Math.pow(1 - zoomProgress.current, 3);
      const dest = zoomTarget.clone().add(new Vector3(0, 0.5, 2));
      camera.position.lerpVectors(homePos.current, dest, ease);
      camera.lookAt(zoomTarget);
      if (zoomProgress.current >= 1) onZoomDone();
      return;
    }

    zoomProgress.current = 0;

    // Auto-rotate slowly when not dragging
    if (!dragRef.current.active) {
      angleRef.current += delta * 0.08;
    }

    const radius = IS_MOBILE ? 14 : 12;
    const height = IS_MOBILE ? 4 : 3.5;
    const a = angleRef.current;
    camera.position.set(Math.cos(a) * radius, height, Math.sin(a) * radius);
    camera.lookAt(0, 0, 0);
    homePos.current.copy(camera.position);
  });

  return null;
}

// ── HUD overlays (pure HTML, not Three.js Html for performance) ──
function HubHUD({ prismBalance, walletAddress, selectedModule, onModuleSelect, modules }: {
  prismBalance: number;
  walletAddress: string;
  selectedModule: HubModuleDef | null;
  onModuleSelect: (m: HubModuleDef | null) => void;
  modules: HubModuleDef[];
}) {
  return (
    <>
      {/* Top bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'max(env(safe-area-inset-top, 8px), 8px) 12px 8px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)' }}>
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontFamily: 'monospace' }}>
          {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 10, padding: '4px 12px' }}>
          <span style={{ fontSize: 14 }}>💎</span>
          <span style={{ color: '#c084fc', fontWeight: 700, fontSize: 14, fontFamily: 'monospace' }}>{prismBalance}</span>
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, fontWeight: 600, letterSpacing: 2 }}>PRISM</span>
        </div>
      </div>

      {/* Bottom module labels — scrollable horizontal strip */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        paddingBottom: 'max(env(safe-area-inset-bottom, 8px), 8px)',
        background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
      }}>
        {/* Selected module info */}
        {selectedModule && (
          <div style={{ textAlign: 'center', padding: '0 16px 8px', animation: 'fadeIn 0.3s' }}>
            <p style={{ color: selectedModule.color, fontSize: 16, fontWeight: 800, textShadow: `0 0 20px ${selectedModule.color}` }}>
              {selectedModule.label}
            </p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>
              {selectedModule.description}
            </p>
          </div>
        )}

        {/* Module strip */}
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', padding: '4px 12px',
          WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        }}>
          {/* Identity Card button */}
          <button
            onClick={() => onModuleSelect(null)}
            style={{
              flexShrink: 0, padding: '8px 14px', borderRadius: 10,
              background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.2)',
              color: '#22d3ee', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
              minHeight: 44,
            }}
          >
            🪐 Identity Card
          </button>
          {modules.map((m) => (
            <button
              key={m.id}
              onClick={() => onModuleSelect(m)}
              style={{
                flexShrink: 0, padding: '8px 14px', borderRadius: 10,
                background: selectedModule?.id === m.id ? `${m.color}20` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${selectedModule?.id === m.id ? `${m.color}40` : 'rgba(255,255,255,0.06)'}`,
                color: selectedModule?.id === m.id ? m.color : 'rgba(255,255,255,0.5)',
                fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', minHeight: 44,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.12)', fontSize: 8, letterSpacing: 3, marginTop: 4, textTransform: 'uppercase' }}>
          Drag to rotate · Tap module to enter
        </p>
      </div>
    </>
  );
}

// ── Main Component ──

interface CosmicHubProps {
  walletAddress: string;
  prismBalance?: PrismBalance | null;
  onNavigateToCard: () => void;
}

export default function CosmicHub({ walletAddress, prismBalance, onNavigateToCard }: CosmicHubProps) {
  const navigate = useNavigate();
  const [selectedModule, setSelectedModule] = useState<HubModuleDef | null>(null);
  const [isZooming, setIsZooming] = useState(false);
  const [zoomTarget, setZoomTarget] = useState<Vector3 | null>(null);

  const handleModuleSelect = useCallback((mod: HubModuleDef) => {
    setSelectedModule(mod);
    setIsZooming(true);
    const angle = mod.startAngle;
    setZoomTarget(new Vector3(Math.cos(angle) * mod.orbitRadius, 0, Math.sin(angle) * mod.orbitRadius));
  }, []);

  const handleZoomDone = useCallback(() => {
    if (!selectedModule) return;
    setTimeout(() => {
      navigate(selectedModule.route + (walletAddress ? `?address=${walletAddress}` : ''));
    }, 150);
  }, [selectedModule, navigate, walletAddress]);

  const handleHUDSelect = useCallback((mod: HubModuleDef | null) => {
    if (!mod) { onNavigateToCard(); return; }
    handleModuleSelect(mod);
  }, [handleModuleSelect, onNavigateToCard]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#030308', touchAction: 'none' }}>
      <HubHUD
        prismBalance={prismBalance?.balance ?? 0}
        walletAddress={walletAddress}
        selectedModule={selectedModule}
        onModuleSelect={handleHUDSelect}
        modules={MODULES}
      />

      <Canvas
        camera={{ position: [0, 3.5, 12], fov: IS_MOBILE ? 55 : 48, near: 0.1, far: 200 }}
        dpr={[1, IS_MOBILE ? 1.5 : 2]}
        gl={{ antialias: !IS_MOBILE, alpha: false }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#030308']} />

        {/* Ambient */}
        <ambientLight intensity={0.08} />
        <pointLight position={[0, 3, 0]} intensity={2} color="#22d3ee" distance={15} />

        {/* Camera controller */}
        <CameraRig zoomTarget={zoomTarget} isZooming={isZooming} onZoomDone={handleZoomDone} />

        {/* Starfield with parallax */}
        <Stars radius={120} depth={60} count={IS_MOBILE ? 2000 : 4000} factor={IS_MOBILE ? 3 : 4} saturation={0.1} fade speed={0.3} />

        {/* Nebula backdrop */}
        <NebulaBackdrop />

        {/* Orbit rings */}
        <OrbitRings />

        {/* Center glow beacon */}
        <mesh>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.4} blending={AdditiveBlending} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.8, 16, 16]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.06} blending={AdditiveBlending} depthWrite={false} />
        </mesh>

        {/* Module orbs */}
        {MODULES.map((mod) => (
          <ModuleOrb key={mod.id} mod={mod} onSelect={handleModuleSelect} selected={selectedModule?.id === mod.id} />
        ))}

        {/* Post-processing */}
        <EffectComposer multisampling={0}>
          <Bloom intensity={1.2} luminanceThreshold={0.4} luminanceSmoothing={0.9} mipmapBlur />
          <ChromaticAberration offset={new Vector2(0.0004, 0.0004)} blendFunction={BlendFunction.NORMAL} />
          <Vignette darkness={0.5} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}

export { MODULES as HUB_MODULES };
export type { CosmicHubProps };
