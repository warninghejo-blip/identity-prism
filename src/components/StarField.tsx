import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const DEFAULT_PALETTE = ['#ffffff', '#dfeefe', '#ffe5b5'];

type StarFieldProps = {
  count?: number;
  radius?: [number, number];
  sizeRange?: [number, number];
  intensityRange?: [number, number];
  twinkleChance?: number;
  twinkleStrength?: number;
  hemisphere?: 'full' | 'back';
  colors?: string[];
};

const starVertexShader = `
precision mediump float;
attribute float size;
attribute vec3 color;
attribute float intensity;
attribute float twinkle;
attribute float seed;
varying vec3 vColor;
varying float vIntensity;
varying float vTwinkle;
varying float vSeed;
uniform float uTime;
uniform float uPixelRatio;

void main() {
  vColor = color;
  vIntensity = intensity;
  vTwinkle = twinkle;
  vSeed = seed;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

  float pointSize = size * uPixelRatio * (32.0 / -mvPosition.z);
  gl_PointSize = clamp(pointSize, 1.0, 7.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const starFragmentShader = `
precision mediump float;
varying vec3 vColor;
varying float vIntensity;
varying float vTwinkle;
varying float vSeed;
uniform float uTime;
uniform float uTwinkleStrength;

void main() {
  vec2 uv = gl_PointCoord.xy - 0.5;
  float r = length(uv);
  
  if (r > 0.5) discard;

  float glow = 1.0 - smoothstep(0.0, 0.5, r);
  glow = pow(glow, 2.2);

  float twinkleWave = sin(uTime * mix(0.3, 0.8, vSeed) + vSeed * 12.0) * 0.5 + 0.5;
  float twinkle = pow(twinkleWave, 7.0) * vTwinkle * uTwinkleStrength;
  float alpha = clamp(glow * (vIntensity + twinkle), 0.0, 1.0);

  gl_FragColor = vec4(vColor, alpha);
}
`;

export function StarField({
  count = 1500,
  radius = [30, 50],
  sizeRange = [0.4, 1.2],
  intensityRange = [0.45, 0.9],
  twinkleChance = 0.06,
  twinkleStrength = 0.35,
  hemisphere = 'full',
  colors,
}: StarFieldProps) {
  const mesh = useRef<THREE.Points>(null);
  const palette = useMemo(() => (colors && colors.length ? colors : DEFAULT_PALETTE), [colors]);
  const radiusMin = radius[0];
  const radiusMax = radius[1];
  const sizeMin = sizeRange[0];
  const sizeMax = sizeRange[1];
  const intensityMin = intensityRange[0];
  const intensityMax = intensityRange[1];
  
  const [positions, colorsAttr, sizes, intensities, twinkles, seeds] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    const intens = new Float32Array(count);
    const twink = new Float32Array(count);
    const seed = new Float32Array(count);
    
    const paletteColors = palette.map((value) => new THREE.Color(value));
    const radiusSpan = radiusMax - radiusMin;
    const sizeSpan = sizeMax - sizeMin;
    const intensitySpan = intensityMax - intensityMin;

    for (let i = 0; i < count; i++) {
      const r = radiusMin + Math.random() * radiusSpan;
      const theta = Math.random() * Math.PI * 2;
      const cosPhi = hemisphere === 'back' ? -Math.random() : 1 - 2 * Math.random();
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      
      pos[i * 3] = r * sinPhi * Math.cos(theta);
      pos[i * 3 + 1] = r * sinPhi * Math.sin(theta);
      pos[i * 3 + 2] = r * cosPhi;
      
      const color = paletteColors[Math.floor(Math.random() * paletteColors.length)];
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;

      sz[i] = sizeMin + Math.random() * sizeSpan;
      intens[i] = intensityMin + Math.random() * intensitySpan;
      twink[i] = Math.random() < twinkleChance ? 1 : 0;
      seed[i] = Math.random();
    }
    
    return [pos, col, sz, intens, twink, seed];
  }, [count, radiusMin, radiusMax, sizeMin, sizeMax, intensityMin, intensityMax, twinkleChance, hemisphere, palette]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
    uTwinkleStrength: { value: twinkleStrength },
  }), [twinkleStrength]);

  useEffect(() => {
    uniforms.uTwinkleStrength.value = twinkleStrength;
  }, [uniforms, twinkleStrength]);

  useFrame((state) => {
    if (mesh.current) {
      mesh.current.rotation.y += 0.00012;
      const material = mesh.current.material as THREE.ShaderMaterial;
      material.uniforms.uTime.value = state.clock.getElapsedTime();
    }
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colorsAttr} itemSize={3} />
        <bufferAttribute attach="attributes-size" count={count} array={sizes} itemSize={1} />
        <bufferAttribute attach="attributes-intensity" count={count} array={intensities} itemSize={1} />
        <bufferAttribute attach="attributes-twinkle" count={count} array={twinkles} itemSize={1} />
        <bufferAttribute attach="attributes-seed" count={count} array={seeds} itemSize={1} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={starVertexShader}
        fragmentShader={starFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
