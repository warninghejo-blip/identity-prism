/**
 * PrismArenaModule — Social hub / Challenges.
 * 3 nebula nodes in triangle + energy bridges + central hologram ring.
 * Palette: pink (#ec4899) → purple
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  ShaderMaterial, AdditiveBlending, BackSide, DoubleSide,
  Mesh, Group, Color,
} from 'three';
import { NOISE_GLSL, SHARED_VERT, type ModuleSceneProps } from './shared';

const FRAG_NEBULA_NODE = `
precision highp float;
${NOISE_GLSL}
varying vec3 vNormal;varying vec3 vPos;
uniform float uTime;
uniform float uPhase;
void main(){
  float t=uTime*0.3+uPhase;
  float n=fbm(vPos*3.0+vec3(t*0.2,-t*0.15,t*0.1),4);
  float spiral=snoise(vec3(atan(vPos.y,vPos.x)*2.0+t,length(vPos.xy)*3.0,t*0.2))*0.5+0.5;
  float fresnel=pow(1.0-abs(dot(normalize(vNormal),vec3(0,0,1))),2.5);
  vec3 col=mix(vec3(0.93,0.28,0.6),vec3(0.5,0.15,0.7),spiral);
  col=mix(col,vec3(0.95,0.6,0.85),n*0.5);
  col+=vec3(0.7,0.2,0.8)*fresnel*1.5;
  float alpha=0.75+n*0.2+fresnel*0.2;
  gl_FragColor=vec4(col,alpha);
}`;

const FRAG_BRIDGE = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;
uniform float uTime;
void main(){
  float t=uTime*0.8;
  float n=snoise(vec3(vUv.x*8.0+t*3.0,vUv.y*2.0,t*0.5))*0.5+0.5;
  float edge=smoothstep(0.0,0.3,vUv.y)*smoothstep(1.0,0.7,vUv.y);
  vec3 col=mix(vec3(0.93,0.28,0.6),vec3(0.6,0.2,0.9),n);
  float alpha=edge*n*0.5;
  gl_FragColor=vec4(col*1.5,alpha);
}`;

const FRAG_HOLO = `
precision highp float;
${NOISE_GLSL}
varying vec3 vNormal;varying vec3 vPos;
uniform float uTime;
void main(){
  float t=uTime;
  float scan=step(0.0,sin(vPos.y*30.0+t*5.0))*0.3+0.7;
  float fresnel=pow(1.0-abs(dot(normalize(vNormal),vec3(0,0,1))),2.0);
  vec3 col=vec3(0.93,0.28,0.6)*scan;
  col+=vec3(0.8,0.4,0.9)*fresnel;
  float alpha=0.4*scan+fresnel*0.3;
  gl_FragColor=vec4(col,alpha);
}`;

const NODE_POSITIONS: [number, number, number][] = [
  [0, 0.45, 0],
  [-0.4, -0.25, 0],
  [0.4, -0.25, 0],
];

export default function NebulaMarketModule({ size, isMobile, hovered }: ModuleSceneProps) {
  const groupRef = useRef<Group>(null!);
  const holoRef = useRef<Mesh>(null!);

  const nodeMats = useMemo(() =>
    NODE_POSITIONS.map((_, i) => new ShaderMaterial({
      vertexShader: SHARED_VERT, fragmentShader: FRAG_NEBULA_NODE,
      uniforms: { uTime: { value: 0 }, uPhase: { value: i * 2.1 } },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    }))
  , []);

  const bridgeMat = useMemo(() => new ShaderMaterial({
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: FRAG_BRIDGE,
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  }), []);

  const holoMat = useMemo(() => new ShaderMaterial({
    vertexShader: SHARED_VERT, fragmentShader: FRAG_HOLO,
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  }), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    nodeMats.forEach(m => { m.uniforms.uTime.value = t; });
    bridgeMat.uniforms.uTime.value = t;
    holoMat.uniforms.uTime.value = t;
    if (holoRef.current) holoRef.current.rotation.y = t * 1.5;
  });

  const s = size * (hovered ? 1.15 : 1);
  const segs = isMobile ? 24 : 32;

  return (
    <group ref={groupRef} scale={[s, s, s]}>
      {/* 3 Nebula nodes */}
      {NODE_POSITIONS.map((pos, i) => (
        <mesh key={i} position={pos} material={nodeMats[i]}>
          <sphereGeometry args={[0.14, segs, segs]} />
        </mesh>
      ))}

      {/* Energy bridges (thin cylinders between nodes) */}
      {[[0, 1], [1, 2], [2, 0]].map(([a, b], i) => {
        const pa = NODE_POSITIONS[a];
        const pb = NODE_POSITIONS[b];
        const mx = (pa[0] + pb[0]) / 2;
        const my = (pa[1] + pb[1]) / 2;
        const dx = pb[0] - pa[0];
        const dy = pb[1] - pa[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dx, dy);
        return (
          <mesh key={i} position={[mx, my, 0]} rotation={[0, 0, -angle]} material={bridgeMat}>
            <planeGeometry args={[0.03, len]} />
          </mesh>
        );
      })}

      {/* Central hologram ring */}
      <mesh ref={holoRef} position={[0, 0, 0]} material={holoMat}>
        <torusGeometry args={[0.12, 0.02, 8, 24]} />
      </mesh>

      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial color="#ec4899" transparent opacity={hovered ? 0.04 : 0.012} blending={AdditiveBlending} depthWrite={false} side={BackSide} />
      </mesh>
    </group>
  );
}
