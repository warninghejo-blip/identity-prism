import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Mesh,
  NormalBlending,
  Points,
  ShaderMaterial,
  Texture,
  TextureLoader,
} from 'three';
import type { PlanetTier } from '@/hooks/useWalletData';

type PlanetTextureConfig = {
  map: string;
  normalMap?: string;
  roughnessMap?: string;
  clouds?: string;
  ring?: string;
  atmosphere?: string;
};

const TEXTURE_PATHS: Record<Exclude<PlanetTier, 'binary_sun'>, PlanetTextureConfig> = {
  mercury: { map: '/textures/mercury_map.jpg' },
  mars: { map: '/textures/mars_map.jpg', normalMap: '/textures/mars_normal.jpg' },
  venus: { map: '/textures/venus_map.jpg', atmosphere: '/textures/venus_atmosphere.jpg' },
  earth: {
    map: '/textures/earth_daymap.jpg',
    normalMap: '/textures/earth_normal.jpg',
    roughnessMap: '/textures/earth_specular.jpg',
    clouds: '/textures/earth_clouds.jpg',
  },
  neptune: { map: '/textures/neptune_map.jpg' },
  uranus: { map: '/textures/uranus_map.jpg' },
  saturn: { map: '/textures/saturn_map.jpg', ring: '/textures/saturn_ring.jpg' },
  jupiter: { map: '/textures/jupiter_map.jpg' },
  sun: { map: '/textures/sun_map.jpg' },
};

const PLANET_SIZES: Record<PlanetTier, number> = {
  mercury: 0.5,
  mars: 0.55,
  venus: 0.6,
  earth: 0.65,
  neptune: 0.7,
  uranus: 0.75,
  saturn: 0.6, 
  jupiter: 0.9,
  sun: 0.95,
  binary_sun: 0.6,
};

const ATMOSPHERE_COLORS: Record<PlanetTier, string> = {
  mercury: '#b4a995',
  mars: '#ff6b4a',
  venus: '#ffd166',
  earth: '#5fa8ff',
  neptune: '#4cc9f0',
  uranus: '#80edff',
  saturn: '#fcbf49',
  jupiter: '#f4a261',
  sun: '#ffdd99',
  binary_sun: '#ffcc33',
};

// Realistic Atmosphere Shader
const atmosphereVertexShader = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const atmosphereFragmentShader = `
varying vec3 vNormal;
uniform vec3 uColor;
void main() {
  float viewDot = dot(vNormal, vec3(0.0, 0.0, 1.0));
  float fresnel = 1.0 - abs(viewDot);
  
  // High-end: Ultra-smooth gradient
  float inner = pow(fresnel, 6.0) * 2.0; // Very sharp rim
  float outer = pow(fresnel, 2.5) * 0.3; // Very subtle haze
  
  float combined = inner + outer;
  // Fade out smoothly at the very edge to prevent hard lines
  float fade = smoothstep(1.0, 0.8, fresnel); 
  
  gl_FragColor = vec4(uColor, combined * fade);
}
`;

// Advanced Star Surface Shader (Pulsing Magma/Plasma)
const starSurfaceVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const starSurfaceFragmentShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uGain;

// Simplex 3D Noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  //   x0 = x0 - 0.0 + 0.0 * C.xxx;
  //   x1 = x0 - i1  + 1.0 * C.xxx;
  //   x2 = x0 - i2  + 2.0 * C.xxx;
  //   x3 = x0 - 1.0 + 3.0 * C.xxx;
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

  // Permutations
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

  // Gradients: 7x7 points over a square, mapped onto an octahedron.
  // The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  //Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix final noise value
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                dot(p2,x2), dot(p3,x3) ) );
}

void main() {
  // Rotate noise over time
  float noiseLarge = snoise(vPosition * 2.2 + vec3(uTime * 0.25));
  float noiseMid = snoise(vPosition * 6.5 - vec3(uTime * 0.35));
  float noiseFine = snoise(vPosition * 12.0 + vec3(uTime * 0.6));
  
  float combined = noiseLarge * 0.55 + noiseMid * 0.3 + noiseFine * 0.15;
  float flare = smoothstep(0.15, 0.8, combined);
  float lava = mix(combined, flare, 0.5);
  
  // Mix colors based on noise
  vec3 finalColor = mix(uColorA, uColorB, lava * uGain + 0.5);
  finalColor += uColorB * pow(flare, 3.0) * 0.25;

  float viewDot = max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
  float core = pow(viewDot, 2.6);
  float rim = pow(1.0 - viewDot, 1.5);
  finalColor += uColorB * core * 0.35;
  finalColor += uColorB * rim * 0.25;
  
  // Add fresnel rim - REMOVED per user request
  // float viewDot = dot(vNormal, vec3(0.0, 0.0, 1.0));
  // float fresnel = pow(1.0 - abs(viewDot), 2.5);
  // finalColor += uColorB * fresnel * 0.1; 

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

// Prominence Shader (Edge Flares)
const prominenceVertexShader = `
varying vec3 vNormal;
varying float vRim;
uniform float uTime;

// Simplex 3D Noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  // Permutations
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 )));

  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                dot(p2,x2), dot(p3,x3) ) );
}

void main() {
  vNormal = normalize(normalMatrix * normal);
  float rim = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 1.6);
  float noiseVal = snoise(position * 3.4 + vec3(uTime * 0.55));
  float displacement = (0.06 + noiseVal * 0.12) * rim;
  vec3 newPosition = position + normal * displacement;
  vRim = rim;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
`;

const prominenceFragmentShader = `
varying vec3 vNormal;
varying float vRim;
uniform float uTime;
uniform vec3 uColor;

void main() {
  float flicker = 0.6 + 0.4 * sin(uTime * 6.2 + vNormal.y * 12.0 + vNormal.x * 6.0);
  float alpha = smoothstep(0.15, 1.0, vRim) * flicker;
  gl_FragColor = vec4(uColor, alpha);
}
`;

// Energy Bridge Shader
const bridgeVertexShader = `
varying vec2 vUv;
varying vec3 vPosition;
void main() {
  vUv = uv;
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const bridgeFragmentShader = `
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColorCore;
uniform vec3 uColorGlow;

void main() {
  // Flowing energy effect
  float flow = sin(vUv.x * 10.0 - uTime * 2.2) * 0.3 + 0.7;
  
  // Beam profile: Premium soft core + glow
  float pulse = 1.0 + sin(uTime * 6.0) * 0.04;
  float ripple = sin(uTime * 3.4 + vUv.x * 16.0) * 0.07;
  float jitter = sin(uTime * 8.5 + vUv.x * 42.0 + vUv.y * 10.0) * 0.045;
  float centerShift = sin(uTime * 1.8 + vUv.x * 12.0) * 0.06 + sin(uTime * 0.9 + vUv.x * 20.0) * 0.03;
  float wobble = 1.0 + ripple + jitter;
  float dist = abs(vUv.y - (0.5 + centerShift)) * 2.0 * pulse * wobble;
  float beam = 1.0 - smoothstep(0.0, 1.0, dist);
  float core = 1.0 - smoothstep(0.0, 0.25, dist);
  float glow = pow(beam, 2.2);
  
  float filamentA = pow(max(0.0, sin(vUv.x * 9.0 + uTime * 3.6 + vUv.y * 28.0)), 3.0);
  float filamentB = pow(max(0.0, sin(vUv.x * 6.0 - uTime * 2.4 + vUv.y * 41.0)), 4.0);
  float filamentC = pow(max(0.0, sin(vUv.x * 12.0 + uTime * 2.2 - vUv.y * 18.0)), 3.0);
  float filaments = (filamentA + filamentB * 0.8 + filamentC * 0.6) * (0.35 + beam * 0.65);
  float strandA = pow(max(0.0, sin(vUv.x * 5.5 + uTime * 4.8 + vUv.y * 22.0)), 5.0);
  float strandB = pow(max(0.0, sin(vUv.x * 8.5 - uTime * 3.9 + vUv.y * 17.0)), 4.0);
  float arcA = pow(max(0.0, sin(vUv.x * 16.0 + uTime * 6.2 + vUv.y * 78.0)), 6.0);
  float arcB = pow(max(0.0, sin(vUv.x * 11.0 - uTime * 5.4 + vUv.y * 64.0)), 5.0);
  float plasmaA = pow(max(0.0, sin(vUv.x * 20.0 + uTime * 7.5 + vUv.y * 92.0)), 6.0);
  float plasmaB = pow(max(0.0, sin(vUv.x * 14.0 - uTime * 6.0 + vUv.y * 70.0)), 5.0);
  float sparks = (strandA + strandB) * 0.22 + (arcA + arcB) * 0.12 + (plasmaA + plasmaB) * 0.08;
  float opacity = (core * 0.78 + glow * 0.18 + filaments * 0.52 + sparks) * flow;
  float ends = 1.0 - smoothstep(0.7, 1.0, abs(vUv.x - 0.5) * 2.0);
  float streak = 0.75 + 0.25 * sin(uTime * 3.1 + vUv.x * 12.0 + vUv.y * 6.0);
  float shimmer = 0.85 + 0.15 * sin(uTime * 12.0 + vUv.x * 48.0 + vUv.y * 14.0);
  opacity *= ends * streak * shimmer;

  float colorPulse = 0.45 + 0.55 * sin(uTime * 1.6 + vUv.x * 4.0 + vUv.y * 5.0);
  vec3 col = mix(uColorGlow, uColorCore, clamp(core + colorPulse * 0.18 + filaments * 0.14 + sparks * 0.12, 0.0, 1.0));
  
  gl_FragColor = vec4(col, opacity);
}
`;

interface Planet3DProps {
  tier: PlanetTier;
}

export function Planet3D({ tier }: Planet3DProps) {
  const groupRef = useRef<Group>(null);
  const cloudsRef = useRef<Mesh>(null);
  const ringsRef = useRef<Group>(null);
  const ringBaseRef = useRef<Points>(null);
  const saturnCoreRef = useRef<Group>(null);
  const size = PLANET_SIZES[tier];
  const isBinary = tier === 'binary_sun';
  const textureTier = isBinary ? 'sun' : tier;

  useFrame((state, delta) => {
    if (groupRef.current && tier !== 'saturn') groupRef.current.rotation.y += delta * 0.08;
    if (saturnCoreRef.current) saturnCoreRef.current.rotation.y += delta * 0.08;
    if (cloudsRef.current) cloudsRef.current.rotation.y += delta * 0.12;
    if (ringsRef.current) ringsRef.current.rotation.y -= delta * 0.022;
    
    // Update shader uniforms
    if (groupRef.current) {
      groupRef.current.traverse((child) => {
        if (child instanceof Mesh && child.material instanceof ShaderMaterial) {
          if (child.material.uniforms.uTime) {
            child.material.uniforms.uTime.value = state.clock.elapsedTime;
          }
        }
      });
    }
  });

  const paths = TEXTURE_PATHS[textureTier];
  const textureKeys = useMemo(() => {
    const keys: Record<string, string> = { map: paths.map };
    if (paths.normalMap) keys.normalMap = paths.normalMap;
    if (paths.roughnessMap) keys.roughnessMap = paths.roughnessMap;
    if (paths.clouds) keys.clouds = paths.clouds;
    if (paths.ring) keys.ring = paths.ring;
    if (paths.atmosphere) keys.atmosphere = paths.atmosphere;
    return keys;
  }, [paths]);

  const fallbackTexture = useMemo(() => {
    const data = new Uint8Array([255, 255, 255, 255]);
    const texture = new DataTexture(data, 1, 1);
    texture.needsUpdate = true;
    return texture;
  }, []);

  const [textures, setTextures] = useState<Record<string, Texture>>({});

  useEffect(() => {
    let mounted = true;
    const loader = new TextureLoader();
    const entries = Object.entries(textureKeys);

    Promise.all(
      entries.map(([key, url]) =>
        new Promise<[string, Texture]>((resolve) => {
          loader.load(
            url,
            (texture) => resolve([key, texture]),
            undefined,
            () => resolve([key, fallbackTexture])
          );
        })
      )
    ).then((loaded) => {
      if (!mounted) return;
      const next: Record<string, Texture> = {};
      loaded.forEach(([key, texture]) => {
        next[key] = texture;
      });
      setTextures(next);
    });

    return () => {
      mounted = false;
    };
  }, [textureKeys, fallbackTexture]);

  const mapTexture = textures.map ?? fallbackTexture;
  const normalTexture = textures.normalMap !== fallbackTexture ? textures.normalMap : undefined;
  const roughnessTexture = textures.roughnessMap !== fallbackTexture ? textures.roughnessMap : undefined;
  const cloudsTexture = textures.clouds !== fallbackTexture ? textures.clouds : undefined;
  const atmosphereTexture = textures.atmosphere !== fallbackTexture ? textures.atmosphere : undefined;

  const emissive = textureTier === 'sun' ? new Color('#ffb703') : new Color('#000000');
  const emissiveIntensity = textureTier === 'sun' ? 2.4 : 0;

  const atmosphereUniforms = useMemo(() => ({
    uColor: { value: new Color(ATMOSPHERE_COLORS[tier]) }
  }), [tier]);

  const binaryCoronaUniforms = useMemo(() => ({
    uColor: { value: new Color('#ffaa00') }
  }), []);

  // NEW: Animated shader uniforms for Binary Stars
  const sun1ShaderUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColorA: { value: new Color('#ffaa00') }, // Deep Orange
    uColorB: { value: new Color('#ffea00') }, // Bright Yellow
    uGain: { value: 1.35 } // Increased for epicness
  }), []);

  const sun2ShaderUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColorA: { value: new Color('#2d8cff') }, // Deep Blue
    uColorB: { value: new Color('#b8f0ff') }, // Bright Cyan
    uGain: { value: 1.35 } // Increased for epicness
  }), []);

  const singleSunUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColorA: { value: new Color('#ff9f1c') }, // Orange
    uColorB: { value: new Color('#fff3b0') }, // Yellow/White
    uGain: { value: 1.25 }
  }), []);

  const prominenceWarmUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new Color('#ff8c2b') }
  }), []);

  const prominenceBrightUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new Color('#ffd08a') }
  }), []);

  const prominenceCoolUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new Color('#79cfff') }
  }), []);

  const bridgeCoreUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColorCore: { value: new Color('#fff6e6') },
    uColorGlow: { value: new Color('#ffd6a5') }
  }), []);

  const bridgeGlowUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColorCore: { value: new Color('#9ad5ff') },
    uColorGlow: { value: new Color('#3f6bff') }
  }), []);

  const filamentWarmUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColorCore: { value: new Color('#fff0db') },
    uColorGlow: { value: new Color('#ffb870') }
  }), []);

  const filamentCoolUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColorCore: { value: new Color('#dfefff') },
    uColorGlow: { value: new Color('#7dbbff') }
  }), []);

  const ringParticleTexture = useMemo(() => {
    const texSize = 32;
    const data = new Uint8Array(texSize * texSize * 4);
    const radius = texSize / 2;

    for (let y = 0; y < texSize; y += 1) {
      for (let x = 0; x < texSize; x += 1) {
        const dx = x - radius + 0.5;
        const dy = y - radius + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy) / radius;
        const alpha = dist <= 1 ? Math.pow(1 - dist, 2.2) : 0;
        const idx = (y * texSize + x) * 4;
        data[idx] = 226;
        data[idx + 1] = 206;
        data[idx + 2] = 176;
        data[idx + 3] = Math.floor(alpha * 255);
      }
    }

    const texture = new DataTexture(data, texSize, texSize);
    texture.needsUpdate = true;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    return texture;
  }, []);

  const saturnRingLayers = useMemo(() => {
    if (tier !== 'saturn') return null;

    const buildLayer = (
      count: number,
      innerRadius: number,
      outerRadius: number,
      height: number,
      colorA: string,
      colorB: string,
      gapMin?: number,
      gapMax?: number,
      gapDrop = 0,
      bandFreq = 0,
      bandInfluence = 0
    ) => {
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const c1 = new Color(colorA);
      const c2 = new Color(colorB);
      let i = 0;

      while (i < count) {
        const t = Math.random();
        const radius = Math.sqrt(t * (outerRadius * outerRadius - innerRadius * innerRadius) + innerRadius * innerRadius);
        if (gapMin && gapMax && radius > gapMin && radius < gapMax && Math.random() < gapDrop) {
          continue;
        }

        const angle = Math.random() * Math.PI * 2;
        if (bandFreq > 0) {
          const banding = Math.abs(Math.sin(angle * bandFreq + radius * 1.6));
          const density = 0.45 + bandInfluence * banding;
          if (Math.random() > density) {
            continue;
          }
        }
        const y = (Math.random() - 0.5) * height;
        const idx = i * 3;

        positions[idx] = Math.cos(angle) * radius;
        positions[idx + 1] = y;
        positions[idx + 2] = Math.sin(angle) * radius;

        const radialMix = (radius - innerRadius) / (outerRadius - innerRadius);
        const gradient = Math.pow(radialMix, 0.7);
        const jitter = (Math.random() - 0.5) * 0.08;
        const mix = Math.min(1, Math.max(0, gradient + jitter));
        colors[idx] = c1.r + (c2.r - c1.r) * mix;
        colors[idx + 1] = c1.g + (c2.g - c1.g) * mix;
        colors[idx + 2] = c1.b + (c2.b - c1.b) * mix;

        i += 1;
      }

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      return geometry;
    };

    return buildLayer(
      22000,
      size * 1.48,
      size * 2.75,
      size * 0.26,
      '#e8d6b8',
      '#b48a5f',
      size * 2.1,
      size * 2.25,
      0.22,
      2.6,
      0.6
    );
  }, [size, tier]);

  if (isBinary) {
    return (
      <group ref={groupRef}>
        <pointLight intensity={5} color="#ffb703" distance={25} />
        <pointLight intensity={3.5} color="#0077b6" distance={25} position={[3, 0, 0]} />
        
        {/* Sun 1 - Yellow/Orange (Pulsing Shader) */}
        <mesh position={[-1.0, 0, 0]}>
          <sphereGeometry args={[0.65, 64, 64]} />
          <shaderMaterial
            vertexShader={starSurfaceVertexShader}
            fragmentShader={starSurfaceFragmentShader}
            uniforms={sun1ShaderUniforms}
          />
        </mesh>
        {/* Sun 1 Atmosphere */}
        <mesh position={[-1.0, 0, 0]} scale={[1.18, 1.18, 1.18]}>
          <sphereGeometry args={[0.65, 32, 32]} />
          <shaderMaterial
            vertexShader={atmosphereVertexShader}
            fragmentShader={atmosphereFragmentShader}
            uniforms={{ uColor: { value: new Color('#fff1cc') } }}
            blending={AdditiveBlending}
            side={BackSide}
            transparent
            opacity={0.32}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[-1.0, 0, 0]} scale={[1.34, 1.34, 1.34]}>
          <sphereGeometry args={[0.65, 32, 32]} />
          <shaderMaterial
            vertexShader={atmosphereVertexShader}
            fragmentShader={atmosphereFragmentShader}
            uniforms={{ uColor: { value: new Color('#ffb347') } }}
            blending={AdditiveBlending}
            side={BackSide}
            transparent
            opacity={0.25}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[-1.0, 0, 0]} scale={[1.08, 1.08, 1.08]}>
          <sphereGeometry args={[0.65, 48, 48]} />
          <shaderMaterial
            vertexShader={prominenceVertexShader}
            fragmentShader={prominenceFragmentShader}
            uniforms={prominenceWarmUniforms}
            blending={AdditiveBlending}
            transparent
            opacity={0.7}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
        
        {/* Sun 2 - Blue/Cyan (Pulsing Shader) */}
        <mesh position={[1.0, 0, 0]}>
          <sphereGeometry args={[0.6, 64, 64]} />
          <shaderMaterial
            vertexShader={starSurfaceVertexShader}
            fragmentShader={starSurfaceFragmentShader}
            uniforms={sun2ShaderUniforms}
          />
        </mesh>
        {/* Sun 2 Atmosphere */}
        <mesh position={[1.0, 0, 0]} scale={[1.18, 1.18, 1.18]}>
          <sphereGeometry args={[0.6, 32, 32]} />
          <shaderMaterial
            vertexShader={atmosphereVertexShader}
            fragmentShader={atmosphereFragmentShader}
            uniforms={{ uColor: { value: new Color('#cfeeff') } }}
            blending={AdditiveBlending}
            side={BackSide}
            transparent
            opacity={0.32}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[1.0, 0, 0]} scale={[1.32, 1.32, 1.32]}>
          <sphereGeometry args={[0.6, 32, 32]} />
          <shaderMaterial
            vertexShader={atmosphereVertexShader}
            fragmentShader={atmosphereFragmentShader}
            uniforms={{ uColor: { value: new Color('#6fb4ff') } }}
            blending={AdditiveBlending}
            side={BackSide}
            transparent
            opacity={0.24}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[1.0, 0, 0]} scale={[1.07, 1.07, 1.07]}>
          <sphereGeometry args={[0.6, 48, 48]} />
          <shaderMaterial
            vertexShader={prominenceVertexShader}
            fragmentShader={prominenceFragmentShader}
            uniforms={prominenceCoolUniforms}
            blending={AdditiveBlending}
            transparent
            opacity={0.65}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Energy Bridge (Hyper Beam) */}
        <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.055, 0.055, 2.0, 64, 1, true]} /> 
          <shaderMaterial
            vertexShader={bridgeVertexShader}
            fragmentShader={bridgeFragmentShader}
            uniforms={bridgeCoreUniforms}
            blending={AdditiveBlending}
            transparent
            opacity={1}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* Filament overlays */}
        <mesh position={[0, 0.035, 0.02]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.02, 2.0, 48, 1, true]} />
          <shaderMaterial
            vertexShader={bridgeVertexShader}
            fragmentShader={bridgeFragmentShader}
            uniforms={filamentWarmUniforms}
            blending={AdditiveBlending}
            transparent
            opacity={0.65}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, -0.03, -0.02]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.016, 0.016, 2.0, 48, 1, true]} />
          <shaderMaterial
            vertexShader={bridgeVertexShader}
            fragmentShader={bridgeFragmentShader}
            uniforms={filamentCoolUniforms}
            blending={AdditiveBlending}
            transparent
            opacity={0.55}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, 0.01, -0.04]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.014, 0.014, 2.0, 48, 1, true]} />
          <shaderMaterial
            vertexShader={bridgeVertexShader}
            fragmentShader={bridgeFragmentShader}
            uniforms={filamentWarmUniforms}
            blending={AdditiveBlending}
            transparent
            opacity={0.45}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, -0.05, 0.05]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.012, 2.0, 48, 1, true]} />
          <shaderMaterial
            vertexShader={bridgeVertexShader}
            fragmentShader={bridgeFragmentShader}
            uniforms={bridgeGlowUniforms}
            blending={AdditiveBlending}
            transparent
            opacity={0.4}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, 0.06, -0.06]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.011, 0.011, 2.0, 48, 1, true]} />
          <shaderMaterial
            vertexShader={bridgeVertexShader}
            fragmentShader={bridgeFragmentShader}
            uniforms={filamentCoolUniforms}
            blending={AdditiveBlending}
            transparent
            opacity={0.36}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }

  // Single Sun - Special Shader Treatment
  if (tier === 'sun') {
    return (
      <group ref={groupRef}>
        <pointLight intensity={4} color="#ffb703" distance={20} />
        
        {/* Sun Surface */}
        <mesh>
          <sphereGeometry args={[size, 96, 96]} />
          <shaderMaterial
            vertexShader={starSurfaceVertexShader}
            fragmentShader={starSurfaceFragmentShader}
            uniforms={singleSunUniforms}
          />
        </mesh>

        {/* Sun Prominences */}
        <mesh scale={[1.06, 1.06, 1.06]}>
          <sphereGeometry args={[size, 64, 64]} />
          <shaderMaterial
            vertexShader={prominenceVertexShader}
            fragmentShader={prominenceFragmentShader}
            uniforms={prominenceWarmUniforms}
            blending={AdditiveBlending}
            transparent
            opacity={0.7}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Sun Atmosphere */}
        <mesh scale={[1.22, 1.22, 1.22]}>
          <sphereGeometry args={[size, 64, 64]} />
          <shaderMaterial
            vertexShader={atmosphereVertexShader}
            fragmentShader={atmosphereFragmentShader}
            uniforms={{ uColor: { value: new Color('#ffd9a3') } }}
            blending={AdditiveBlending}
            side={BackSide}
            transparent
            opacity={0.38}
            depthWrite={false}
          />
        </mesh>
        <mesh scale={[1.42, 1.42, 1.42]}>
          <sphereGeometry args={[size, 64, 64]} />
          <shaderMaterial
            vertexShader={atmosphereVertexShader}
            fragmentShader={atmosphereFragmentShader}
            uniforms={{ uColor: { value: new Color('#ffb347') } }}
            blending={AdditiveBlending}
            side={BackSide}
            transparent
            opacity={0.28}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }

  return (
    <group ref={groupRef}>
      {tier === 'saturn' ? (
        <group ref={saturnCoreRef}>
          <mesh>
            <sphereGeometry args={[size, 96, 96]} />
            <meshStandardMaterial
              map={mapTexture}
              normalMap={normalTexture}
              roughnessMap={roughnessTexture}
              roughness={0.85}
              metalness={0.05}
              emissive={emissive}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>

          <mesh scale={[1.2, 1.2, 1.2]}>
            <sphereGeometry args={[size, 64, 64]} />
            <shaderMaterial
              vertexShader={atmosphereVertexShader}
              fragmentShader={atmosphereFragmentShader}
              uniforms={atmosphereUniforms}
              blending={AdditiveBlending}
              side={BackSide}
              transparent
              depthWrite={false}
            />
          </mesh>

          {paths.atmosphere && atmosphereTexture && (
            <mesh scale={[1.2, 1.2, 1.2]}>
              <sphereGeometry args={[size, 64, 64]} />
              <shaderMaterial
                vertexShader={atmosphereVertexShader}
                fragmentShader={atmosphereFragmentShader}
                uniforms={atmosphereUniforms}
                blending={AdditiveBlending}
                side={BackSide}
                transparent
                depthWrite={false}
              />
            </mesh>
          )}
        </group>
      ) : (
        <>
          <mesh>
            <sphereGeometry args={[size, 96, 96]} />
            <meshStandardMaterial
              map={mapTexture}
              normalMap={normalTexture}
              roughnessMap={roughnessTexture}
              roughness={tier === 'earth' ? 0.55 : 0.85}
              metalness={tier === 'earth' ? 0.15 : 0.05}
              emissive={emissive}
              emissiveIntensity={emissiveIntensity}
            />
          </mesh>

          <mesh scale={[1.2, 1.2, 1.2]}>
            <sphereGeometry args={[size, 64, 64]} />
            <shaderMaterial
              vertexShader={atmosphereVertexShader}
              fragmentShader={atmosphereFragmentShader}
              uniforms={atmosphereUniforms}
              blending={AdditiveBlending}
              side={BackSide}
              transparent
              depthWrite={false}
            />
          </mesh>

          {paths.atmosphere && atmosphereTexture && (
            <mesh scale={[1.2, 1.2, 1.2]}>
              <sphereGeometry args={[size, 64, 64]} />
              <shaderMaterial
                vertexShader={atmosphereVertexShader}
                fragmentShader={atmosphereFragmentShader}
                uniforms={atmosphereUniforms}
                blending={AdditiveBlending}
                side={BackSide}
                transparent
                depthWrite={false}
              />
            </mesh>
          )}
        </>
      )}

      {tier === 'earth' && cloudsTexture && (
        <mesh ref={cloudsRef} scale={[1.02, 1.02, 1.02]}>
          <sphereGeometry args={[size, 64, 64]} />
          <meshStandardMaterial
            map={cloudsTexture}
            transparent
            opacity={0.8}
            side={DoubleSide}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}

      {tier === 'saturn' && saturnRingLayers && (
        <group ref={ringsRef} rotation={[0.12, 0, 0]}>
          {/* Volumetric particulate ring system */}
          <points ref={ringBaseRef} geometry={saturnRingLayers}>
            <pointsMaterial
              map={ringParticleTexture}
              size={0.095}
              sizeAttenuation
              transparent
              opacity={0.99}
              vertexColors
              blending={NormalBlending}
              depthWrite
              alphaTest={0.1}
            />
          </points>
        </group>
      )}
    </group>
  );
}
