/**
 * StellarForgeModule — Craft / Upgrades.
 * Anvil + floating crystal + spark particles + lava glow base.
 * Palette: orange (#f59e0b) → white-hot
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  ShaderMaterial, AdditiveBlending, BackSide, DoubleSide,
  BufferGeometry, Float32BufferAttribute, Points, Mesh, Group,
} from 'three';
import { NOISE_GLSL, SHARED_VERT, IS_MOBILE, type ModuleSceneProps } from './shared';

const SPARK_COUNT = IS_MOBILE ? 200 : 800;

const FRAG_CRYSTAL = `
precision highp float;
${NOISE_GLSL}
varying vec3 vNormal;varying vec3 vPos;
uniform float uTime;
void main(){
  float t=uTime*0.5;
  float crystal=abs(snoise(vPos*6.0+t*0.3))*0.6+abs(snoise(vPos*12.0-t*0.2))*0.3;
  float fresnel=pow(1.0-abs(dot(normalize(vNormal),vec3(0,0,1))),3.0);
  vec3 col=mix(vec3(1.0,0.6,0.1),vec3(1.0,0.95,0.7),crystal);
  col+=vec3(1.0,0.8,0.4)*fresnel*2.0;
  col+=vec3(1.0,1.0,0.9)*pow(crystal,3.0)*0.5;
  gl_FragColor=vec4(col,0.9);
}`;

const FRAG_ANVIL = `
precision highp float;
${NOISE_GLSL}
varying vec3 vNormal;varying vec3 vPos;
uniform float uTime;
void main(){
  float n=fbm(vPos*4.0+uTime*0.05,3)*0.3+0.4;
  float fresnel=pow(1.0-abs(dot(normalize(vNormal),vec3(0,0,1))),2.0);
  vec3 col=vec3(0.15,0.1,0.08)*n;
  col+=vec3(1.0,0.4,0.1)*fresnel*0.8;
  gl_FragColor=vec4(col,0.95);
}`;

const FRAG_LAVA = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;
uniform float uTime;
void main(){
  float t=uTime*0.2;
  float lava=fbm(vec3(vUv*4.0,t),4);
  vec3 col=mix(vec3(0.8,0.2,0.0),vec3(1.0,0.7,0.1),lava);
  col=mix(col,vec3(1.0,0.95,0.7),pow(lava,3.0));
  float r=length(vUv-0.5)*2.0;
  float alpha=smoothstep(1.0,0.3,r)*0.6*(0.5+lava*0.5);
  gl_FragColor=vec4(col*1.5,alpha);
}`;

const VERT_SPARKS = `
uniform float uTime;
attribute float aPhase;
attribute vec3 aVelocity;
varying float vLife;
void main(){
  float t=mod(uTime*1.5+aPhase,2.0);
  vLife=1.0-t/2.0;
  vec3 pos=aVelocity*t+vec3(0,-0.5*t*t*0.3,0);
  pos.y+=0.1;
  vec4 mv=modelViewMatrix*vec4(pos,1.0);
  gl_PointSize=max(1.0,vLife*4.0*(-8.0/mv.z));
  gl_Position=projectionMatrix*mv;
}`;

const FRAG_SPARKS = `
precision highp float;
varying float vLife;
void main(){
  float d=length(gl_PointCoord-0.5)*2.0;
  if(d>1.0)discard;
  float a=smoothstep(1.0,0.2,d)*vLife;
  vec3 col=mix(vec3(1.0,0.3,0.0),vec3(1.0,0.9,0.5),vLife);
  gl_FragColor=vec4(col*2.0,a*0.8);
}`;

export default function StellarForgeModule({ size, isMobile, hovered }: ModuleSceneProps) {
  const crystalRef = useRef<Mesh>(null!);

  const crystalMat = useMemo(() => new ShaderMaterial({
    vertexShader: SHARED_VERT, fragmentShader: FRAG_CRYSTAL,
    uniforms: { uTime: { value: 0 } }, transparent: true,
  }), []);

  const anvilMat = useMemo(() => new ShaderMaterial({
    vertexShader: SHARED_VERT, fragmentShader: FRAG_ANVIL,
    uniforms: { uTime: { value: 0 } }, transparent: true,
  }), []);

  const lavaMat = useMemo(() => new ShaderMaterial({
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: FRAG_LAVA,
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  }), []);

  const { sparkGeo, sparkMat } = useMemo(() => {
    const count = SPARK_COUNT;
    const phases = new Float32Array(count);
    const velocities = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      phases[i] = Math.random() * 6.28;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.1 + Math.random() * 0.3;
      velocities[i * 3] = Math.cos(angle) * speed * 0.4;
      velocities[i * 3 + 1] = 0.2 + Math.random() * 0.4;
      velocities[i * 3 + 2] = Math.sin(angle) * speed * 0.4;
      positions[i * 3] = positions[i * 3 + 1] = positions[i * 3 + 2] = 0;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
    geo.setAttribute('aVelocity', new Float32BufferAttribute(velocities, 3));

    const mat = new ShaderMaterial({
      vertexShader: VERT_SPARKS, fragmentShader: FRAG_SPARKS,
      uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    return { sparkGeo: geo, sparkMat: mat };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    crystalMat.uniforms.uTime.value = t;
    anvilMat.uniforms.uTime.value = t;
    lavaMat.uniforms.uTime.value = t;
    sparkMat.uniforms.uTime.value = t;
    if (crystalRef.current) {
      crystalRef.current.rotation.y = t * 0.6;
      crystalRef.current.position.y = 0.35 + Math.sin(t * 1.5) * 0.06;
    }
  });

  const s = size * (hovered ? 1.15 : 1);

  return (
    <group scale={[s, s, s]}>
      {/* Anvil body */}
      <mesh position={[0, -0.15, 0]} material={anvilMat}>
        <boxGeometry args={[0.5, 0.15, 0.3]} />
      </mesh>
      {/* Anvil horn */}
      <mesh position={[0.3, -0.08, 0]} rotation={[0, 0, -Math.PI / 2]} material={anvilMat}>
        <coneGeometry args={[0.08, 0.2, 8]} />
      </mesh>
      {/* Anvil base */}
      <mesh position={[0, -0.3, 0]} material={anvilMat}>
        <boxGeometry args={[0.35, 0.12, 0.25]} />
      </mesh>

      {/* Floating crystal */}
      <mesh ref={crystalRef} position={[0, 0.35, 0]} material={crystalMat}>
        <octahedronGeometry args={[0.15, 1]} />
      </mesh>

      {/* Spark particles */}
      <points geometry={sparkGeo} material={sparkMat} />

      {/* Lava glow base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.37, 0]} material={lavaMat}>
        <planeGeometry args={[1.2, 1.2]} />
      </mesh>

      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={hovered ? 0.04 : 0.012} blending={AdditiveBlending} depthWrite={false} side={BackSide} />
      </mesh>
    </group>
  );
}
