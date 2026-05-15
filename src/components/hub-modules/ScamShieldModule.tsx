/**
 * ScamShieldModule — Security scanner.
 * Hexagonal shield + hex-grid shader + scanning beam.
 * Color: blue-green (safety = trust), NOT red.
 * Palette: blue (#3b82f6) → green (#10b981)
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  ShaderMaterial, AdditiveBlending, BackSide, DoubleSide,
  Mesh, Group,
} from 'three';
import { NOISE_GLSL, SHARED_VERT, type ModuleSceneProps } from './shared';

const FRAG_SHIELD = `
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;varying vec3 vPos;varying vec3 vNormal;
uniform float uTime;
void main(){
  float t=uTime*0.4;
  // Hex grid pattern
  vec2 p=vPos.xy*6.0;
  vec2 h=vec2(1.0,1.732);
  vec2 a=mod(p,h)-h*0.5;
  vec2 b=mod(p+h*0.5,h)-h*0.5;
  float hexDist=min(dot(a,a),dot(b,b));
  float hexLine=smoothstep(0.08,0.05,sqrt(hexDist));

  float pulse=sin(t*3.0)*0.2+0.8;
  float scan=smoothstep(0.4,0.42,sin(vPos.y*4.0+t*2.0))*0.5;
  float fresnel=pow(1.0-abs(dot(normalize(vNormal),vec3(0,0,1))),2.5);

  vec3 colBase=mix(vec3(0.23,0.51,0.96),vec3(0.06,0.73,0.5),vUv.y);
  vec3 col=colBase*pulse;
  col+=vec3(0.3,0.8,0.6)*hexLine*0.6;
  col+=vec3(0.4,0.9,0.7)*scan;
  col+=vec3(0.2,0.6,0.9)*fresnel*1.5;
  float alpha=0.5+hexLine*0.2+fresnel*0.3+scan*0.2;
  gl_FragColor=vec4(col,alpha);
}`;

const FRAG_SCAN_BEAM = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
void main(){
  float t=uTime;
  float beam=smoothstep(0.0,0.05,sin(vUv.y*20.0-t*4.0))*0.6;
  float fade=smoothstep(0.0,0.2,vUv.x)*smoothstep(1.0,0.8,vUv.x);
  fade*=smoothstep(0.0,0.3,vUv.y)*smoothstep(1.0,0.7,vUv.y);
  vec3 col=mix(vec3(0.23,0.51,0.96),vec3(0.06,0.73,0.5),vUv.y);
  float alpha=beam*fade*0.4;
  gl_FragColor=vec4(col*1.5,alpha);
}`;

export default function ScamShieldModule({ size, isMobile, hovered }: ModuleSceneProps) {
  const shieldRef = useRef<Mesh>(null!);
  const scanRef = useRef<Mesh>(null!);

  const shieldMat = useMemo(() => new ShaderMaterial({
    vertexShader: SHARED_VERT, fragmentShader: FRAG_SHIELD,
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  }), []);

  const scanMat = useMemo(() => new ShaderMaterial({
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: FRAG_SCAN_BEAM,
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  }), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    shieldMat.uniforms.uTime.value = t;
    scanMat.uniforms.uTime.value = t;
    if (shieldRef.current) shieldRef.current.rotation.y = t * 0.15;
    if (scanRef.current) scanRef.current.rotation.y = t * 0.8;
  });

  const s = size * (hovered ? 1.15 : 1);

  return (
    <group scale={[s, s, s]}>
      {/* Hexagonal shield */}
      <mesh ref={shieldRef} material={shieldMat}>
        <cylinderGeometry args={[0.55, 0.55, 0.12, 6]} />
      </mesh>

      {/* Scan beam plane */}
      <mesh ref={scanRef} position={[0, 0, 0.1]} material={scanMat}>
        <planeGeometry args={[0.9, 1.2]} />
      </mesh>

      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={hovered ? 0.04 : 0.012} blending={AdditiveBlending} depthWrite={false} side={BackSide} />
      </mesh>
    </group>
  );
}
