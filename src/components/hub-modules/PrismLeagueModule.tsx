/**
 * PrismLeagueModule — Games / Arena.
 * Glowing arena ring + 3 orbital mini-objects + energy discharges.
 * Palette: cyan (#06b6d4) → white
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  ShaderMaterial, AdditiveBlending, BackSide, DoubleSide,
  Mesh, Group, Color,
} from 'three';
import { NOISE_GLSL, SHARED_VERT, IS_MOBILE, type ModuleSceneProps } from './shared';

const FRAG_PLASMA_RING = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;varying vec3 vPos;varying vec3 vNormal;
uniform float uTime;
void main(){
  float t=uTime*0.8;
  float angle=atan(vPos.y,vPos.x);
  float plasma=fbm(vec3(angle*4.0+t*2.0,vPos.z*6.0+t,t*0.3),4);
  float bolt=step(0.8,snoise(vPos*12.0+t*5.0))*1.5;
  float fresnel=pow(1.0-abs(dot(normalize(vNormal),vec3(0,0,1))),2.0);
  vec3 col=mix(vec3(0.02,0.6,0.85),vec3(0.4,0.95,1.0),plasma);
  col+=vec3(0.8,1.0,1.0)*bolt;
  col+=vec3(0.1,0.7,0.9)*fresnel*1.5;
  float alpha=0.7+plasma*0.2+fresnel*0.2+bolt*0.3;
  gl_FragColor=vec4(col,alpha);
}`;

const FRAG_OBJECT = `
precision highp float;
${NOISE_GLSL}
varying vec3 vNormal;varying vec3 vPos;
uniform float uTime;
uniform vec3 uColor;
void main(){
  float fresnel=pow(1.0-abs(dot(normalize(vNormal),vec3(0,0,1))),2.5);
  float shimmer=snoise(vPos*8.0+uTime*2.0)*0.3+0.7;
  vec3 col=uColor*shimmer+vec3(0.8,1.0,1.0)*fresnel*1.5;
  gl_FragColor=vec4(col,0.85);
}`;

export default function PrismLeagueModule({ size, isMobile, hovered }: ModuleSceneProps) {
  const groupRef = useRef<Group>(null!);
  const ringMatRef = useRef<ShaderMaterial>(null!);

  const ringMat = useMemo(() => new ShaderMaterial({
    vertexShader: SHARED_VERT,
    fragmentShader: FRAG_PLASMA_RING,
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false,
    blending: AdditiveBlending, side: DoubleSide,
  }), []);

  const objMats = useMemo(() => [
    new ShaderMaterial({ vertexShader: SHARED_VERT, fragmentShader: FRAG_OBJECT, uniforms: { uTime: { value: 0 }, uColor: { value: new Color('#06b6d4') } }, transparent: true }),
    new ShaderMaterial({ vertexShader: SHARED_VERT, fragmentShader: FRAG_OBJECT, uniforms: { uTime: { value: 0 }, uColor: { value: new Color('#22d3ee') } }, transparent: true }),
    new ShaderMaterial({ vertexShader: SHARED_VERT, fragmentShader: FRAG_OBJECT, uniforms: { uTime: { value: 0 }, uColor: { value: new Color('#67e8f9') } }, transparent: true }),
  ], []);

  const objRefs = [useRef<Mesh>(null!), useRef<Mesh>(null!), useRef<Mesh>(null!)];

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    ringMat.uniforms.uTime.value = t;
    objMats.forEach(m => { m.uniforms.uTime.value = t; });

    const orbR = 0.65;
    for (let i = 0; i < 3; i++) {
      const mesh = objRefs[i].current;
      if (!mesh) continue;
      const angle = t * 1.2 + (i * Math.PI * 2 / 3);
      mesh.position.set(Math.cos(angle) * orbR, Math.sin(t * 2 + i) * 0.08, Math.sin(angle) * orbR);
      mesh.rotation.set(t * 1.5, t * 0.8, t * 1.1 + i);
    }
  });

  const s = size * (hovered ? 1.15 : 1);

  return (
    <group ref={groupRef} scale={[s, s, s]}>
      {/* Arena ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]} material={ringMat}>
        <torusGeometry args={[0.55, 0.08, 16, isMobile ? 32 : 64]} />
      </mesh>

      {/* Orbital objects */}
      <mesh ref={objRefs[0]} material={objMats[0]}>
        <icosahedronGeometry args={[0.1, 1]} />
      </mesh>
      <mesh ref={objRefs[1]} material={objMats[1]}>
        <octahedronGeometry args={[0.09, 0]} />
      </mesh>
      <mesh ref={objRefs[2]} material={objMats[2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.18, 6]} />
      </mesh>

      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={hovered ? 0.04 : 0.012} blending={AdditiveBlending} depthWrite={false} side={BackSide} />
      </mesh>
    </group>
  );
}
