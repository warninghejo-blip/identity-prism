/**
 * BlackHoleModule — Token burn visualization.
 * Dark event horizon sphere + toroidal accretion disk + spiral particles + glow shell.
 * Palette: violet (#8b5cf6) → pink → white
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  ShaderMaterial, AdditiveBlending, BackSide, FrontSide, DoubleSide,
  BufferGeometry, Float32BufferAttribute, Points, Mesh, Color,
} from 'three';
import { NOISE_GLSL, SHARED_VERT, IS_MOBILE, type ModuleSceneProps } from './shared';

const PARTICLE_COUNT = IS_MOBILE ? 400 : 1500;

const FRAG_HORIZON = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;varying vec3 vPos;varying vec3 vNormal;
uniform float uTime;
void main(){
  float fresnel=pow(abs(dot(normalize(vNormal),vec3(0,0,1))),2.0);
  float dark=smoothstep(0.0,0.6,fresnel);
  vec3 col=vec3(0.02,0.0,0.05)*dark;
  float rim=pow(1.0-fresnel,4.0);
  col+=vec3(0.55,0.22,0.88)*rim*2.0;
  float alpha=0.95;
  gl_FragColor=vec4(col,alpha);
}`;

const FRAG_DISK = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;varying vec3 vPos;varying vec3 vNormal;
uniform float uTime;
void main(){
  vec2 uv=vUv;
  float angle=atan(uv.y-0.5,uv.x-0.5);
  float r=length(uv-0.5)*2.0;
  float t=uTime*0.5;
  float spiral=fbm(vec3(angle*3.0+r*5.0-t*3.0,r*2.0,t*0.3),4);
  vec3 inner=vec3(1.0,0.9,0.95);
  vec3 mid=vec3(0.9,0.3,0.7);
  vec3 outer=vec3(0.55,0.22,0.88);
  vec3 col=mix(outer,mid,spiral);
  col=mix(col,inner,pow(spiral,3.0)*0.6);
  float falloff=smoothstep(0.0,0.15,r)*smoothstep(1.0,0.6,r);
  float alpha=falloff*0.85*(0.7+spiral*0.3);
  gl_FragColor=vec4(col*1.5,alpha);
}`;

const FRAG_PARTICLES = `
precision highp float;
uniform float uTime;
varying float vAlpha;
void main(){
  float d=length(gl_PointCoord-0.5)*2.0;
  if(d>1.0)discard;
  float a=smoothstep(1.0,0.3,d)*vAlpha;
  vec3 col=mix(vec3(0.55,0.22,0.88),vec3(1.0,0.6,0.9),vAlpha);
  gl_FragColor=vec4(col*2.0,a*0.7);
}`;

const VERT_PARTICLES = `
uniform float uTime;
attribute float aPhase;
attribute float aRadius;
attribute float aSpeed;
varying float vAlpha;
void main(){
  float t=uTime*aSpeed+aPhase;
  float angle=t*2.0;
  float r=aRadius*(1.0-fract(t*0.15)*0.8);
  vec3 pos=vec3(cos(angle)*r,sin(t*3.0)*0.15,sin(angle)*r);
  vAlpha=smoothstep(0.05,0.3,r);
  vec4 mv=modelViewMatrix*vec4(pos,1.0);
  gl_PointSize=max(1.5,(3.0-r*2.0)*(-10.0/mv.z));
  gl_Position=projectionMatrix*mv;
}`;

export default function BlackHoleModule({ size, isMobile, hovered }: ModuleSceneProps) {
  const horizonRef = useRef<Mesh>(null!);
  const diskRef = useRef<Mesh>(null!);
  const particlesRef = useRef<Points>(null!);

  const horizonMat = useMemo(() => new ShaderMaterial({
    vertexShader: SHARED_VERT,
    fragmentShader: FRAG_HORIZON,
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: true,
  }), []);

  const diskMat = useMemo(() => new ShaderMaterial({
    vertexShader: SHARED_VERT,
    fragmentShader: FRAG_DISK,
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false,
    blending: AdditiveBlending, side: DoubleSide,
  }), []);

  const { particleGeo, particleMat } = useMemo(() => {
    const count = PARTICLE_COUNT;
    const phases = new Float32Array(count);
    const radii = new Float32Array(count);
    const speeds = new Float32Array(count);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      phases[i] = Math.random() * Math.PI * 2;
      radii[i] = 0.3 + Math.random() * 0.7;
      speeds[i] = 0.3 + Math.random() * 0.7;
      positions[i * 3] = positions[i * 3 + 1] = positions[i * 3 + 2] = 0;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
    geo.setAttribute('aRadius', new Float32BufferAttribute(radii, 1));
    geo.setAttribute('aSpeed', new Float32BufferAttribute(speeds, 1));

    const mat = new ShaderMaterial({
      vertexShader: VERT_PARTICLES,
      fragmentShader: FRAG_PARTICLES,
      uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false,
      blending: AdditiveBlending,
    });
    return { particleGeo: geo, particleMat: mat };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    horizonMat.uniforms.uTime.value = t;
    diskMat.uniforms.uTime.value = t;
    particleMat.uniforms.uTime.value = t;
    if (diskRef.current) diskRef.current.rotation.y = t * 0.2;
  });

  const s = size * (hovered ? 1.15 : 1);
  const segs = isMobile ? 32 : 48;

  return (
    <group scale={[s, s, s]}>
      {/* Event horizon */}
      <mesh ref={horizonRef} material={horizonMat}>
        <sphereGeometry args={[0.35, segs, segs]} />
      </mesh>

      {/* Accretion disk */}
      <mesh ref={diskRef} rotation={[Math.PI / 2, 0, 0]} material={diskMat}>
        <ringGeometry args={[0.38, 0.95, 64, 1]} />
      </mesh>

      {/* Spiral particles */}
      <points ref={particlesRef} geometry={particleGeo} material={particleMat} />

      {/* Outer glow shell */}
      <mesh>
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshBasicMaterial color="#8b5cf6" transparent opacity={hovered ? 0.04 : 0.012} blending={AdditiveBlending} depthWrite={false} side={BackSide} />
      </mesh>
    </group>
  );
}
