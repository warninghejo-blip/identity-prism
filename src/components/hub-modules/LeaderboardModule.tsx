/**
 * LeaderboardModule — Leaderboard visualization.
 * Trophy (inverted cone cup + cylinder stem + cone base) + 3 podium bars + sparkle particles.
 * Palette: gold (#fbbf24) → white
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  ShaderMaterial, AdditiveBlending, BackSide,
  BufferGeometry, Float32BufferAttribute, Points, Mesh, Group, Color,
} from 'three';
import { NOISE_GLSL, SHARED_VERT, IS_MOBILE, type ModuleSceneProps } from './shared';

const SPARKLE_COUNT = IS_MOBILE ? 150 : 500;

const FRAG_GOLD = `
precision highp float;
${NOISE_GLSL}
varying vec3 vNormal;varying vec3 vPos;
uniform float uTime;
void main(){
  float t=uTime*0.3;
  float n=fbm(vPos*3.0+vec3(t*0.1,t*0.08,-t*0.05),3);
  float fresnel=pow(1.0-abs(dot(normalize(vNormal),vec3(0,0,1))),2.0);
  vec3 gold=vec3(0.98,0.75,0.14);
  vec3 bright=vec3(1.0,0.95,0.7);
  vec3 col=mix(gold,bright,n*0.5+fresnel*0.5);
  col+=vec3(1.0,0.9,0.5)*fresnel*1.2;
  gl_FragColor=vec4(col,0.9);
}`;

const FRAG_PODIUM = `
precision highp float;
varying vec3 vNormal;varying vec3 vPos;
uniform vec3 uColor;
void main(){
  float fresnel=pow(1.0-abs(dot(normalize(vNormal),vec3(0,0,1))),2.0);
  vec3 col=uColor*(0.6+fresnel*0.8);
  gl_FragColor=vec4(col,0.85);
}`;

const VERT_SPARKLE = `
uniform float uTime;
attribute float aPhase;
attribute vec3 aOffset;
varying float vAlpha;
void main(){
  float t=uTime+aPhase;
  float twinkle=sin(t*4.0)*0.5+0.5;
  vAlpha=twinkle;
  vec3 pos=aOffset;
  pos.y+=sin(t*1.5+aPhase*3.0)*0.05;
  vec4 mv=modelViewMatrix*vec4(pos,1.0);
  gl_PointSize=max(1.0,twinkle*3.0*(-8.0/mv.z));
  gl_Position=projectionMatrix*mv;
}`;

const FRAG_SPARKLE = `
precision highp float;
varying float vAlpha;
void main(){
  float d=length(gl_PointCoord-0.5)*2.0;
  if(d>1.0)discard;
  float a=smoothstep(1.0,0.2,d)*vAlpha;
  vec3 col=mix(vec3(0.98,0.75,0.14),vec3(1.0,1.0,0.9),vAlpha);
  gl_FragColor=vec4(col*2.0,a*0.6);
}`;

export default function LeaderboardModule({ size, isMobile, hovered }: ModuleSceneProps) {
  const trophyRef = useRef<Group>(null!);

  const goldMat = useMemo(() => new ShaderMaterial({
    vertexShader: SHARED_VERT, fragmentShader: FRAG_GOLD,
    uniforms: { uTime: { value: 0 } }, transparent: true,
  }), []);

  const podiumMats = useMemo(() => {
    const colors = ['#fbbf24', '#c0c0c0', '#cd7f32']; // gold, silver, bronze
    return colors.map(c => new ShaderMaterial({
      vertexShader: SHARED_VERT, fragmentShader: FRAG_PODIUM,
      uniforms: { uColor: { value: new Color(c) } },
      transparent: true,
    }));
  }, []);

  const { sparkleGeo, sparkleMat } = useMemo(() => {
    const count = SPARKLE_COUNT;
    const phases = new Float32Array(count);
    const offsets = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      phases[i] = Math.random() * 6.28;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const r = 0.3 + Math.random() * 0.5;
      offsets[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      offsets[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r * 0.7 + 0.1;
      offsets[i * 3 + 2] = Math.cos(phi) * r;
      positions[i * 3] = positions[i * 3 + 1] = positions[i * 3 + 2] = 0;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
    geo.setAttribute('aOffset', new Float32BufferAttribute(offsets, 3));

    const mat = new ShaderMaterial({
      vertexShader: VERT_SPARKLE, fragmentShader: FRAG_SPARKLE,
      uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    return { sparkleGeo: geo, sparkleMat: mat };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    goldMat.uniforms.uTime.value = t;
    sparkleMat.uniforms.uTime.value = t;
    if (trophyRef.current) trophyRef.current.rotation.y = t * 0.3;
  });

  const s = size * (hovered ? 1.15 : 1);

  return (
    <group scale={[s, s, s]}>
      <group ref={trophyRef}>
        {/* Trophy cup (inverted cone) */}
        <mesh position={[0, 0.2, 0]} rotation={[Math.PI, 0, 0]} material={goldMat}>
          <coneGeometry args={[0.2, 0.25, 16]} />
        </mesh>
        {/* Trophy stem */}
        <mesh position={[0, 0, 0]} material={goldMat}>
          <cylinderGeometry args={[0.03, 0.03, 0.2, 8]} />
        </mesh>
        {/* Trophy base */}
        <mesh position={[0, -0.12, 0]} material={goldMat}>
          <cylinderGeometry args={[0.12, 0.14, 0.05, 16]} />
        </mesh>
      </group>

      {/* Podium bars behind trophy */}
      <mesh position={[0, -0.28, -0.2]} material={podiumMats[0]}>
        <boxGeometry args={[0.15, 0.35, 0.1]} />
      </mesh>
      <mesh position={[-0.2, -0.33, -0.2]} material={podiumMats[1]}>
        <boxGeometry args={[0.15, 0.25, 0.1]} />
      </mesh>
      <mesh position={[0.2, -0.36, -0.2]} material={podiumMats[2]}>
        <boxGeometry args={[0.15, 0.2, 0.1]} />
      </mesh>

      {/* Sparkle particles */}
      <points geometry={sparkleGeo} material={sparkleMat} />

      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={hovered ? 0.04 : 0.012} blending={AdditiveBlending} depthWrite={false} side={BackSide} />
      </mesh>
    </group>
  );
}
