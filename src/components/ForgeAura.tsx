/**
 * ForgeAura — procedural Three.js aura effects around the planet.
 * Each aura type uses a different shader/particle approach.
 * Rendered as a child of the planet group in Planet3D.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Mesh,
  DoubleSide,
  BackSide,
} from 'three';

// ── Aura vertex shader (shared) ──
const AURA_VERT = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPos;
uniform float uTime;
uniform float uIntensity;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vUv = uv;
  vPos = position;
  
  // Slight vertex displacement for organic feel
  float displacement = sin(position.x * 3.0 + uTime * 2.0) * 
                       cos(position.y * 2.5 + uTime * 1.5) * 
                       sin(position.z * 2.0 + uTime) * 0.02 * uIntensity;
  vec3 newPos = position + normal * displacement;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
}
`;

// ── Frost Aura — ice crystals, cool blue shimmer ──
const FROST_FRAG = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPos;
uniform float uTime;
uniform float uIntensity;

void main() {
  float fresnel = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
  float ice = pow(fresnel, 2.5) * uIntensity;
  
  // Crystalline sparkle
  float sparkle = sin(vPos.x * 20.0 + uTime * 3.0) * 
                  cos(vPos.y * 15.0 - uTime * 2.0) * 
                  sin(vPos.z * 18.0 + uTime * 1.5);
  sparkle = max(0.0, sparkle) * 0.5;
  
  vec3 color = mix(vec3(0.4, 0.7, 1.0), vec3(0.8, 0.95, 1.0), fresnel);
  float alpha = ice * 0.6 + sparkle * fresnel * 0.3;
  gl_FragColor = vec4(color, alpha);
}
`;

// ── Ember Aura — warm fire particles ──
const EMBER_FRAG = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPos;
uniform float uTime;
uniform float uIntensity;

void main() {
  float fresnel = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
  float fire = pow(fresnel, 2.0) * uIntensity;
  
  // Flickering flames
  float flicker = sin(vPos.y * 8.0 + uTime * 5.0) * 
                  cos(vPos.x * 6.0 + uTime * 3.0) * 0.5 + 0.5;
  
  vec3 innerColor = vec3(1.0, 0.3, 0.05);
  vec3 outerColor = vec3(1.0, 0.7, 0.1);
  vec3 color = mix(innerColor, outerColor, fresnel * flicker);
  float alpha = fire * 0.7 * flicker;
  gl_FragColor = vec4(color, alpha);
}
`;

// ── Electric Storm — lightning arcs ──
const ELECTRIC_FRAG = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPos;
uniform float uTime;
uniform float uIntensity;

float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

void main() {
  float fresnel = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
  
  // Lightning bolts via noise
  float bolt = hash(vPos * 10.0 + uTime * 2.0);
  bolt = step(0.97, bolt) * 3.0; // Sparse bright bolts
  
  // Arc glow
  float arc = sin(vPos.x * 15.0 + uTime * 8.0) * 
              cos(vPos.z * 12.0 - uTime * 6.0);
  arc = max(0.0, arc) * pow(fresnel, 1.5);
  
  vec3 color = mix(vec3(0.2, 0.5, 1.0), vec3(0.6, 0.9, 1.0), bolt);
  float alpha = (pow(fresnel, 2.5) * uIntensity * 0.5 + arc * 0.3 + bolt * fresnel) * uIntensity;
  gl_FragColor = vec4(color, alpha);
}
`;

// ── Plasma Field — swirling energy ──
const PLASMA_FRAG = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPos;
uniform float uTime;
uniform float uIntensity;

void main() {
  float fresnel = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
  
  // Swirling plasma
  float angle = atan(vPos.y, vPos.x);
  float r = length(vPos.xy);
  float swirl = sin(angle * 4.0 + uTime * 3.0 + r * 5.0) * 0.5 + 0.5;
  float pulse = sin(uTime * 2.0 + vPos.z * 3.0) * 0.3 + 0.7;
  
  vec3 color1 = vec3(0.6, 0.1, 0.9);  // purple
  vec3 color2 = vec3(0.1, 0.8, 0.9);  // cyan
  vec3 color = mix(color1, color2, swirl * pulse);
  
  float alpha = pow(fresnel, 2.0) * uIntensity * 0.7 * pulse;
  gl_FragColor = vec4(color, alpha);
}
`;

// ── Dark Matter — gravitational lensing distortion ──
const DARK_MATTER_FRAG = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPos;
uniform float uTime;
uniform float uIntensity;

void main() {
  float fresnel = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
  
  // Gravitational ripples
  float ripple = sin(length(vPos) * 10.0 - uTime * 4.0) * 0.5 + 0.5;
  float warp = sin(vPos.x * 8.0 + vPos.y * 6.0 - uTime * 2.0) * 
               cos(vPos.z * 7.0 + uTime * 1.5);
  
  // Dark with occasional bright distortion edges
  vec3 color = mix(vec3(0.05, 0.0, 0.1), vec3(0.3, 0.1, 0.5), ripple * fresnel);
  color += vec3(0.5, 0.2, 0.8) * max(0.0, warp) * fresnel * 0.5;
  
  float alpha = pow(fresnel, 1.8) * uIntensity * 0.5 * (0.7 + ripple * 0.3);
  gl_FragColor = vec4(color, alpha);
}
`;

// ── Binary Pulse — twin energy beams ──
const BINARY_PULSE_FRAG = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPos;
uniform float uTime;
uniform float uIntensity;

void main() {
  float fresnel = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
  
  // Two energy streams
  float beam1 = smoothstep(0.3, 0.0, abs(vPos.y - sin(uTime * 2.0) * 0.3));
  float beam2 = smoothstep(0.3, 0.0, abs(vPos.y + sin(uTime * 2.0 + 3.14) * 0.3));
  
  float pulse = sin(uTime * 4.0) * 0.3 + 0.7;
  
  vec3 color1 = vec3(0.0, 0.8, 1.0);  // cyan
  vec3 color2 = vec3(1.0, 0.8, 0.0);  // gold
  vec3 color = beam1 * color1 + beam2 * color2;
  color += vec3(0.3, 0.5, 0.8) * pow(fresnel, 3.0) * 0.5;
  
  float alpha = (beam1 + beam2) * uIntensity * pulse * 0.6 + pow(fresnel, 3.0) * uIntensity * 0.3;
  gl_FragColor = vec4(color, alpha);
}
`;

// ── Fragment shader map ──
const AURA_FRAGS: Record<string, string> = {
  aura_frost: FROST_FRAG,
  aura_ember: EMBER_FRAG,
  aura_electric: ELECTRIC_FRAG,
  aura_plasma: PLASMA_FRAG,
  aura_dark_matter: DARK_MATTER_FRAG,
  aura_binary_pulse: BINARY_PULSE_FRAG,
};

// ── Main component ──

interface ForgeAuraProps {
  auraId: string;
  planetSize: number;
}

export function ForgeAura({ auraId, planetSize }: ForgeAuraProps) {
  const meshRef = useRef<Mesh>(null!);
  const fragShader = AURA_FRAGS[auraId];
  
  const material = useMemo(() => {
    if (!fragShader) return null;
    return new ShaderMaterial({
      vertexShader: AURA_VERT,
      fragmentShader: fragShader,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
  }, [fragShader]);

  useFrame(({ clock }) => {
    if (material) {
      material.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  if (!material) return null;

  const auraScale = planetSize * 1.25;

  return (
    <mesh ref={meshRef} material={material}>
      <sphereGeometry args={[auraScale, 48, 48]} />
    </mesh>
  );
}

export function hasForgeAura(auraId: string | null): boolean {
  return Boolean(auraId && AURA_FRAGS[auraId]);
}
