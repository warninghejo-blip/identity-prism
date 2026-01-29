import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const DEFAULT_PALETTE = ['#ffffff', '#dfeefe', '#ffe5b5'];

type StarFieldProps = {
  count?: number;
  radius?: [number, number];
  sizeRange?: [number, number];
  intensityRange?: [number, number];
  hemisphere?: 'full' | 'back';
  colors?: string[];
};

const starVertexShader = `
precision mediump float;
attribute float size;
attribute vec3 color;
attribute float intensity;
varying vec3 vColor;
varying float vIntensity;
uniform float uPixelRatio;

void main() {
  vColor = color;
  vIntensity = intensity;
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

void main() {
  vec2 uv = gl_PointCoord.xy - 0.5;
  float r = length(uv);
  
  if (r > 0.5) discard;

  float glow = 1.0 - smoothstep(0.0, 0.5, r);
  glow = pow(glow, 2.2);

  float alpha = clamp(glow * vIntensity, 0.0, 1.0);

  gl_FragColor = vec4(vColor, alpha);
}
`;

export function StarField({
  count = 1500,
  radius = [30, 50],
  sizeRange = [0.4, 1.2],
  intensityRange = [0.45, 0.9],
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
  
  const [positions, colorsAttr, sizes, intensities] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    const intens = new Float32Array(count);
    
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

      const sizeValue = sizeMin + Math.random() * sizeSpan;
      sz[i] = sizeValue;
      intens[i] = intensityMin + Math.random() * intensitySpan;
    }
    
    return [pos, col, sz, intens];
  }, [count, radiusMin, radiusMax, sizeMin, sizeMax, intensityMin, intensityMax, hemisphere, palette]);

  const uniforms = useMemo(() => ({
    uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
  }), []);

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colorsAttr} itemSize={3} />
        <bufferAttribute attach="attributes-size" count={count} array={sizes} itemSize={1} />
        <bufferAttribute attach="attributes-intensity" count={count} array={intensities} itemSize={1} />
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
