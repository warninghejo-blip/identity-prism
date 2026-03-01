import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { 
  Color, 
  ShaderMaterial, 
  Mesh, 
  AdditiveBlending, 
  BackSide, 
  DoubleSide, 
  Group, 
  PointLight, 
  Vector3,
  Quaternion,
  CylinderGeometry,
  FrontSide
} from 'three';
import { VISUAL_CONFIG } from '@/constants';
import type { StellarProfile } from '@/lib/solarSystemGenerator';
import type { PlanetTier, RarityTier } from '@/hooks/useWalletData';

const IS_MOBILE = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

interface SeekerSunProps {
  profile: StellarProfile;
  walletSeed?: string;
  planetTier?: PlanetTier;
  rarityTier?: RarityTier;
}

// Deterministic hash from wallet address
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// Generate procedural parameters from wallet seed for uniqueness
export function getProceduralParams(seed: string) {
  const hash = hashString(seed);
  return {
    noiseScale: 2.0 + (hash % 100) / 80,
    turbulence: 0.6 + (hash % 60) / 100,
    pulseSpeed: 0.05 + (hash % 30) / 500,
    sunspotDensity: 0.4 + (hash % 60) / 100,
    hueShift: (hash % 30) / 100, // Subtle color variation
  };
}

// Star archetype configurations based on rarity - HIGH VISIBILITY
export const STAR_ARCHETYPES = {
  common: {
    name: 'Orange Dwarf',
    colors: { primary: '#FF6B35', secondary: '#FF9D57' },
    intensity: 5.0,
    coronaScale: 2.2,
  },
  rare: {
    name: 'Blue Giant',
    colors: { primary: '#00B4FF', secondary: '#8CFFE3' },
    intensity: 6.0,
    coronaScale: 2.6,
  },
  epic: {
    name: 'Purple Hypergiant',
    colors: { primary: '#C3A3FF', secondary: '#FF7AE2' },
    intensity: 7.0,
    coronaScale: 3.0,
  },
  legendary: {
    name: 'Binary Star',
    colors: { primary: '#6AD9FF', secondary: '#FFD700' },
    intensity: 8.0,
    coronaScale: 3.2,
  },
  mythic: {
    name: 'Pulsar',
    colors: { primary: '#FF9C6D', secondary: '#7F5BFF' },
    intensity: 10.0,
    coronaScale: 3.8,
  },
};

const PLANET_TIER_TO_ARCHETYPE: Record<PlanetTier, keyof typeof STAR_ARCHETYPES> = {
  mercury: 'common',
  mars: 'common',
  venus: 'rare',
  earth: 'rare',
  neptune: 'epic',
  uranus: 'epic',
  saturn: 'legendary',
  jupiter: 'legendary',
  sun: 'mythic',
  binary_sun: 'mythic',
};

const RARITY_TIER_TO_ARCHETYPE: Record<RarityTier, keyof typeof STAR_ARCHETYPES> = {
  common: 'common',
  rare: 'rare',
  epic: 'epic',
  legendary: 'legendary',
  mythic: 'mythic',
};

// =====================================================================
// GLSL SHADERS - FBM Plasma with Animated Sunspots and Solar Flares
// =====================================================================

const plasmaVertexShader = `
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  
  void main() {
    vUv = uv;
    vPosition = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const plasmaFragmentShader = `
  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform float uIntensity;
  uniform float uNoiseScale;
  uniform float uTurbulence;
  uniform float uPulseSpeed;
  uniform float uSunspotDensity;
  uniform float uHueShift;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  
  // Simplex noise helpers
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  
  // Turbulence noise - absolute value of FBM for fire-like look
  float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for(int i = 0; i < 6; i++) {
      if(i >= octaves) break;
      value += amplitude * abs(snoise(p * frequency));
      frequency *= 2.1;
      amplitude *= 0.48;
    }
    return value;
  }
  
  float turbulence(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for(int i = 0; i < 6; i++) {
      if(i >= octaves) break;
      value += amplitude * abs(snoise(p * frequency));
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }
  
  void main() {
    vec3 pos = vPosition * uNoiseScale;
    float t = uTime * uPulseSpeed;
    
    // --- Layer 1: Large-scale fire structure ---
    float fire1 = turbulence(pos * 1.0 + vec3(t * 0.06, t * 0.04, t * 0.03), 5);
    float fire2 = turbulence(pos * 2.2 + vec3(-t * 0.04, t * 0.07, -t * 0.02), 4);
    float fire3 = turbulence(pos * 4.5 + vec3(t * 0.09, -t * 0.05, t * 0.06), 3);
    
    // --- Sharp fire ridges with deep dark valleys ---
    float rawFire = fire1 * 0.55 + fire2 * 0.3 + fire3 * 0.15;
    // Sharpen: pow creates deep dark crevices between bright flames
    float sharpFire = pow(rawFire, 0.55);
    
    // --- Dark convection cells (granulation) ---
    float cells = abs(snoise(pos * 5.0 + vec3(t * 0.12, -t * 0.08, t * 0.05)));
    float cellDark = smoothstep(0.0, 0.4, cells) * 0.35;
    
    // --- Sunspots: slow large dark patches ---
    float spotNoise = fbm(pos * 0.8 + vec3(t * 0.01), 4);
    float spots = smoothstep(0.15, 0.5, spotNoise) * uSunspotDensity;
    
    // --- Combine: high contrast fire ---
    float fireIntensity = sharpFire * (1.0 - spots * 0.7) * (1.0 - cellDark);
    // Remap for maximum contrast: dark=0.05, bright=1.2
    fireIntensity = 0.05 + fireIntensity * 1.15;
    
    // --- View-dependent: limb darkening ---
    vec3 viewDir = normalize(vViewPosition);
    float NdotV = max(dot(vNormal, viewDir), 0.0);
    float limb = pow(NdotV, 0.35);
    
    // --- Color palette: deep red/orange darks → bright yellow/white peaks ---
    vec3 darkColor = uColor1 * 0.15; // very deep dark
    vec3 midColor = uColor1 * 0.7 + uColor2 * 0.3;
    vec3 brightColor = uColor2 * 1.2 + vec3(0.2, 0.15, 0.0);
    vec3 hotWhite = vec3(1.5, 1.3, 0.9);
    
    // 4-stop color ramp — smooth without branching to avoid seam artifacts
    float t1 = smoothstep(0.0, 0.3, fireIntensity);
    float t2 = smoothstep(0.3, 0.7, fireIntensity);
    float t3 = smoothstep(0.7, 1.2, fireIntensity);
    vec3 fireColor = mix(darkColor, midColor, t1);
    fireColor = mix(fireColor, brightColor, t2);
    fireColor = mix(fireColor, hotWhite, t3);
    
    // Apply limb darkening — edges darker, center brighter
    fireColor *= (0.4 + limb * 0.7);
    
    // --- Bright eruption flares ---
    float flareNoise = turbulence(pos * 3.0 + vec3(t * 0.15, -t * 0.1, t * 0.08), 3);
    float flare = smoothstep(0.6, 0.85, flareNoise);
    fireColor += brightColor * flare * 0.6;
    
    // --- Hot spots (very bright small areas) ---
    float hotSpot = smoothstep(0.75, 0.95, fire3);
    fireColor += hotWhite * hotSpot * 0.4 * limb;
    
    // --- Edge glow (corona bleed) ---
    float fresnel = pow(1.0 - NdotV, 3.5);
    fireColor += uColor1 * fresnel * 0.8;
    
    gl_FragColor = vec4(fireColor * uIntensity, 1.0);
  }
`;

// Corona glow shader for atmospheric scattering
const coronaVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const coronaFragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  // Inline simple hash noise for corona flames
  float hash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float noise3d(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float NdotV = abs(dot(vNormal, viewDir));
    float fresnel = pow(1.0 - NdotV, 2.2);

    // Fire-structured corona using noise on the normal direction
    vec3 noisePos = vNormal * 3.0 + vec3(uTime * 0.15, -uTime * 0.1, uTime * 0.08);
    float flame = noise3d(noisePos) * 0.5 + noise3d(noisePos * 2.5) * 0.3 + noise3d(noisePos * 5.0) * 0.2;
    flame = pow(flame, 0.7);

    // Flame tendrils that extend outward at edges
    float tendril = smoothstep(0.2, 0.8, flame) * fresnel;

    // Pulsating base
    float pulse = 0.8 + 0.2 * sin(uTime * 0.5 + flame * 4.0);

    float glow = (fresnel * 0.6 + tendril * 1.2) * pulse;

    gl_FragColor = vec4(uColor * 2.0, glow * uOpacity);
  }
`;

// Volumetric beam shader for pulsar jets
const beamVertexShader = `
  varying vec2 vUv;
  varying vec3 vPosition;
  void main() {
    vUv = uv;
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const beamFragmentShader = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  varying vec3 vPosition;
  
  void main() {
    // Radial falloff from center
    float radialDist = length(vec2(vUv.x - 0.5, 0.0)) * 2.0;
    float radialFade = 1.0 - smoothstep(0.0, 0.5, radialDist);
    
    // Fade along beam length
    float lengthFade = 1.0 - pow(vUv.y, 0.5);
    
    // Pulsating energy
    float pulse = 0.7 + 0.3 * sin(uTime * 1.2 + vUv.y * 6.0);
    
    // Combine for soft volumetric look
    float alpha = radialFade * lengthFade * pulse * uIntensity;
    
    gl_FragColor = vec4(uColor * 2.0, alpha * 0.6);
  }
`;

// God-ray glow shader — radial light rays emanating from the sun
const godRayVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const godRayFragmentShader = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453); }
  // 1D noise for smooth per-angle variation
  float noise1(float x) {
    float i = floor(x); float f = fract(x);
    f = f*f*(3.0-2.0*f);
    return mix(hash(i), hash(i+1.0), f);
  }
  // 2D hash for spatial noise
  float hash2(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise2(vec2 p) {
    vec2 i=floor(p); vec2 f=fract(p);
    f=f*f*(3.0-2.0*f);
    return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),
               mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float dist = length(uv);
    float angle = atan(uv.y, uv.x);
    float t = uTime;

    // --- Organic angular offset — breaks perfect symmetry ---
    float angShift = noise1(angle * 1.8 + t * 0.07) * 0.35
                   - noise1(angle * 3.1 - t * 0.05 + 50.0) * 0.20;

    float a = angle + angShift;

    // --- Three ray layers with different frequencies, phases, speeds ---
    float r0 = pow(max(0.0, 0.5 + 0.5 * sin(a * 7.0  + t * 0.12)), 5.0) * 0.55;
    float r1 = pow(max(0.0, 0.5 + 0.5 * sin(a * 13.0 - t * 0.09 + 1.3)), 9.0) * 0.40;
    float r2 = pow(max(0.0, 0.5 + 0.5 * sin(a * 21.0 + t * 0.06 + 2.7)), 15.0) * 0.28;

    float rays = r0 + r1 + r2;

    // --- Amplitude shimmer via noise per angle ---
    float shimmer = 0.70 + 0.30 * noise1(angle * 5.0 + t * 0.18);
    rays *= shimmer;

    // --- Per-ray reach: some rays extend further than others ---
    float reach = 0.60 + 0.32 * noise1(angle * 2.3 + t * 0.04);

    // --- Slow global pulse ---
    float pulse = 0.85 + 0.15 * noise2(vec2(t * 0.11, 0.5));

    // --- Radial falloff with organic boundary ---
    float outerFade = smoothstep(reach, 0.18, dist);
    float innerMask = smoothstep(0.16, 0.28, dist);
    float rayGlow   = rays * outerFade * innerMask * pulse;

    // --- Soft halo ring ---
    float halo = exp(-dist * 3.2) * 0.50;
    float haloMask = smoothstep(0.12, 0.25, dist);

    // --- Wide faint scatter ---
    float scatter = exp(-dist * 1.6) * 0.08;

    float total = (rayGlow + halo * haloMask + scatter) * uIntensity;

    // --- Warm white core → sun color at tips ---
    vec3 col = mix(vec3(1.0, 0.97, 0.88), uColor * 1.15, smoothstep(0.20, 0.65, dist));
    float alpha = total * smoothstep(1.0, 0.82, dist);

    gl_FragColor = vec4(col * 1.85, alpha);
  }
`;

// =====================================================================
// COMPONENTS
// =====================================================================

interface CoronaLayerProps {
  size: number;
  color: string;
  opacity?: number;
  scale?: number;
}

function CoronaLayer({ size, color, opacity = 0.15, scale = 1.5 }: CoronaLayerProps) {
  const materialRef = useRef<ShaderMaterial>(null);
  
  const uniforms = useMemo(() => ({
    uColor: { value: new Color(color) },
    uOpacity: { value: opacity },
    uTime: { value: 0 },
  }), [color, opacity]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <mesh scale={scale}>
      <sphereGeometry args={[size, IS_MOBILE ? 32 : 48, IS_MOBILE ? 32 : 48]} />
      <shaderMaterial 
        ref={materialRef}
        vertexShader={coronaVertexShader} 
        fragmentShader={coronaFragmentShader} 
        uniforms={uniforms} 
        transparent 
        blending={AdditiveBlending} 
        side={BackSide}
        depthWrite={false} 
        toneMapped={false}
      />
    </mesh>
  );
}

interface SunCoreProps {
  color1: string;
  color2: string;
  size: number;
  intensity?: number;
  params: ReturnType<typeof getProceduralParams>;
  archetype: typeof STAR_ARCHETYPES[keyof typeof STAR_ARCHETYPES];
}

export function SunGlow({ size, color, intensity = 1.0 }: { size: number; color: string; intensity?: number }) {
  const matRef = useRef<ShaderMaterial>(null);
  const meshRef = useRef<Mesh>(null);
  const parentWorldQuat = useMemo(() => new Quaternion(), []);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new Color(color) },
    uIntensity: { value: intensity },
  }), [color, intensity]);

  useFrame((state) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    // Billboard: always face camera regardless of parent group rotation
    if (meshRef.current) {
      const parent = meshRef.current.parent;
      if (parent) {
        parent.getWorldQuaternion(parentWorldQuat);
        parentWorldQuat.invert();
        meshRef.current.quaternion.copy(parentWorldQuat).multiply(state.camera.quaternion);
      } else {
        meshRef.current.quaternion.copy(state.camera.quaternion);
      }
    }
  });

  const planeSize = size * 5;

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[planeSize, planeSize]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={godRayVertexShader}
        fragmentShader={godRayFragmentShader}
        uniforms={uniforms}
        transparent
        blending={AdditiveBlending}
        depthWrite={false}
        depthTest={true}
        toneMapped={false}
        side={DoubleSide}
      />
    </mesh>
  );
}

export function SunCore({ color1, color2, size, intensity = 3, params, archetype }: SunCoreProps) {
  const materialRef = useRef<ShaderMaterial>(null);
  const meshRef = useRef<Mesh>(null);
  const groupRef = useRef<Group>(null);
  
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor1: { value: new Color(color1) },
    uColor2: { value: new Color(color2) },
    uIntensity: { value: intensity },
    uNoiseScale: { value: params.noiseScale },
    uTurbulence: { value: params.turbulence },
    uPulseSpeed: { value: params.pulseSpeed },
    uSunspotDensity: { value: params.sunspotDensity },
    uHueShift: { value: params.hueShift },
  }), [color1, color2, intensity, params]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = time;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.0003; // Very slow majestic rotation — synced for sphere + rays
    }
  });

  return (
    <group ref={groupRef}>
      {/* God-ray glow renders FIRST — sphere paints over center intersection */}
      <SunGlow size={size} color={color1} intensity={0.7} />
      <mesh ref={meshRef}>
        <sphereGeometry args={[size, IS_MOBILE ? 48 : 96, IS_MOBILE ? 48 : 96]} />
        <shaderMaterial 
          ref={materialRef} 
          vertexShader={plasmaVertexShader} 
          fragmentShader={plasmaFragmentShader} 
          uniforms={uniforms} 
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// Volumetric light beam for pulsar
function VolumetricBeam({ color, length, position, rotation }: { 
  color: string; 
  length: number; 
  position: [number, number, number];
  rotation: [number, number, number];
}) {
  const materialRef = useRef<ShaderMaterial>(null);
  
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new Color(color) },
    uIntensity: { value: 1.0 },
  }), [color]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <mesh position={position} rotation={rotation}>
      <coneGeometry args={[1.5, length, 32, 1, true]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={beamVertexShader}
        fragmentShader={beamFragmentShader}
        uniforms={uniforms}
        transparent
        blending={AdditiveBlending}
        side={DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// Binary Star System (Legendary tier)
interface BinaryStarSystemProps {
  palette: StellarProfile['palette'];
  intensity: number;
  params: ReturnType<typeof getProceduralParams>;
}

function BinaryStarSystem({ palette, intensity, params }: BinaryStarSystemProps) {
  const primaryRef = useRef<Group>(null);
  const secondaryRef = useRef<Group>(null);
  const primaryLightRef = useRef<PointLight>(null);
  const secondaryLightRef = useRef<PointLight>(null);

  const bridgeRef = useRef<Mesh>(null);
  const bridgeMatRef = useRef<ShaderMaterial>(null);
  const orbitRadius = 2.5;
  const orbitSpeed = VISUAL_CONFIG.ANIMATION.BINARY_ORBIT * 0.3; // Much slower

  const bridgeUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor1: { value: new Color(palette.primary) },
    uColor2: { value: new Color(palette.secondary) },
  }), [palette.primary, palette.secondary]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const angle = time * orbitSpeed;
    
    if (primaryRef.current) {
      primaryRef.current.position.x = Math.cos(angle) * orbitRadius;
      primaryRef.current.position.z = Math.sin(angle) * orbitRadius;
    }
    if (secondaryRef.current) {
      secondaryRef.current.position.x = Math.cos(angle + Math.PI) * orbitRadius;
      secondaryRef.current.position.z = Math.sin(angle + Math.PI) * orbitRadius;
    }
    if (primaryLightRef.current && primaryRef.current) {
      primaryLightRef.current.position.copy(primaryRef.current.position);
    }
    if (secondaryLightRef.current && secondaryRef.current) {
      secondaryLightRef.current.position.copy(secondaryRef.current.position);
    }
    // Update bridge position/rotation to connect both stars
    if (bridgeRef.current && primaryRef.current && secondaryRef.current) {
      const p1 = primaryRef.current.position;
      const p2 = secondaryRef.current.position;
      bridgeRef.current.position.set((p1.x+p2.x)/2, 0, (p1.z+p2.z)/2);
      bridgeRef.current.lookAt(p2.x, 0, p2.z);
      bridgeRef.current.rotateY(Math.PI / 2);
      const dist = p1.distanceTo(p2);
      bridgeRef.current.scale.set(1, 1, dist);
    }
    if (bridgeMatRef.current) {
      bridgeMatRef.current.uniforms.uTime.value = time;
    }
  });

  const archetype = STAR_ARCHETYPES.legendary;

  return (
    <group>
      <group ref={primaryRef}>
        <SunCore
          color1={palette.primary}
          color2={palette.secondary}
          size={VISUAL_CONFIG.SUN.BASE_SIZE * 0.75}
          intensity={intensity}
          params={params}
          archetype={archetype}
        />
      </group>
      <group ref={secondaryRef}>
        <SunCore
          color1={palette.secondary}
          color2={palette.primary}
          size={VISUAL_CONFIG.SUN.BASE_SIZE * 0.6}
          intensity={intensity * 0.85}
          params={{ ...params, hueShift: -params.hueShift }}
          archetype={archetype}
        />
      </group>
      {/* Energy bridge between stars */}
      <mesh ref={bridgeRef}>
        <cylinderGeometry args={[0.15, 0.15, 1, 16, 1, true]} />
        <shaderMaterial
          ref={bridgeMatRef}
          vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            uniform float uTime;
            uniform vec3 uColor1;
            uniform vec3 uColor2;
            varying vec2 vUv;
            void main() {
              float flow = fract(vUv.y * 3.0 - uTime * 1.5);
              float pulse = 0.5 + 0.5 * sin(uTime * 4.0 + vUv.y * 12.0);
              float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
              vec3 col = mix(uColor1, uColor2, vUv.y);
              float alpha = edge * (0.15 + 0.25 * pulse) * smoothstep(0.0, 0.15, flow) * smoothstep(1.0, 0.85, flow);
              gl_FragColor = vec4(col * 2.0, alpha);
            }
          `}
          uniforms={bridgeUniforms}
          transparent
          blending={AdditiveBlending}
          side={DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <pointLight ref={primaryLightRef} color={palette.primary} intensity={intensity * 25} distance={300} decay={2} />
      <pointLight ref={secondaryLightRef} color={palette.secondary} intensity={intensity * 20} distance={300} decay={2} />
    </group>
  );
}

// Pulsar with volumetric jets (Mythic tier)
function PulsarSystem({ palette, intensity, params }: BinaryStarSystemProps) {
  const groupRef = useRef<Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.002; // Slow rotation
    }
  });

  const archetype = STAR_ARCHETYPES.mythic;
  const beamLength = 25;

  return (
    <group ref={groupRef}>
      <SunCore
        color1={palette.primary}
        color2={palette.secondary}
        size={VISUAL_CONFIG.SUN.BASE_SIZE * 0.9}
        intensity={intensity}
        params={params}
        archetype={archetype}
      />
      
      {/* Top beam */}
      <VolumetricBeam 
        color={palette.primary}
        length={beamLength}
        position={[0, beamLength / 2, 0]}
        rotation={[0, 0, 0]}
      />
      
      {/* Bottom beam */}
      <VolumetricBeam 
        color={palette.secondary}
        length={beamLength}
        position={[0, -beamLength / 2, 0]}
        rotation={[Math.PI, 0, 0]}
      />
      
      <pointLight color={palette.primary} intensity={intensity * 35} distance={400} decay={2} />
    </group>
  );
}

// Main export component
export function SeekerSun({ profile, walletSeed = 'default', planetTier = 'mercury', rarityTier }: SeekerSunProps) {
  const params = useMemo(() => getProceduralParams(walletSeed), [walletSeed]);
  const { palette, mode, intensity } = profile;

  // Get archetype based on rarity tier
  const archetypeKey = rarityTier
    ? RARITY_TIER_TO_ARCHETYPE[rarityTier]
    : PLANET_TIER_TO_ARCHETYPE[planetTier] || 'common';
  
  const archetype = STAR_ARCHETYPES[archetypeKey];

  // Single star (Common/Rare/Epic)
  if (mode === 'single') {
    return (
      <group>
        <SunCore 
          color1={palette.primary} 
          color2={palette.secondary} 
          size={VISUAL_CONFIG.SUN.BASE_SIZE} 
          intensity={archetype.intensity} 
          params={params}
          archetype={archetype}
        />
        <pointLight color={palette.primary} intensity={archetype.intensity * 30} distance={200} decay={2} />
      </group>
    );
  }

  // Binary system (Legendary)
  if (mode === 'binary') {
    return <BinaryStarSystem palette={palette} intensity={intensity} params={params} />;
  }

  // Pulsar system (Mythic)
  if (mode === 'binaryPulsar') {
    return <PulsarSystem palette={palette} intensity={intensity} params={params} />;
  }

  // Fallback to single star
  return (
    <group>
      <SunCore 
        color1={palette.primary} 
        color2={palette.secondary} 
        size={VISUAL_CONFIG.SUN.BASE_SIZE} 
        intensity={intensity} 
        params={params}
        archetype={archetype}
      />
      <pointLight color={palette.primary} intensity={intensity * 30} distance={200} decay={2} />
    </group>
  );
}