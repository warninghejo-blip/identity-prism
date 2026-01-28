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
  CylinderGeometry,
  FrontSide
} from 'three';
import { VISUAL_CONFIG } from '@/constants';
import type { StellarProfile } from '@/lib/solarSystemGenerator';
import type { PlanetTier, RarityTier } from '@/hooks/useWalletData';

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
function getProceduralParams(seed: string) {
  const hash = hashString(seed);
  return {
    noiseScale: 2.0 + (hash % 100) / 80,
    turbulence: 0.6 + (hash % 60) / 100,
    pulseSpeed: 0.15 + (hash % 40) / 200,
    sunspotDensity: 0.4 + (hash % 60) / 100,
    hueShift: (hash % 30) / 100, // Subtle color variation
  };
}

// Star archetype configurations based on rarity - HIGH VISIBILITY
const STAR_ARCHETYPES = {
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
  
  // Fractal Brownian Motion - multiple octaves for realistic plasma
  float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for(int i = 0; i < 8; i++) {
      if(i >= octaves) break;
      value += amplitude * snoise(p * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }
  
  void main() {
    vec3 pos = vPosition * uNoiseScale;
    float t = uTime * uPulseSpeed;
    
    // Multi-layered plasma turbulence using FBM
    float plasma1 = fbm(pos + vec3(t * 0.1, t * 0.08, t * 0.05), 6);
    float plasma2 = fbm(pos * 2.0 + vec3(sin(t * 0.3), cos(t * 0.4), t * 0.2), 5) * 0.5;
    float microDetail = snoise(pos * 8.0 + vec3(t * 0.6)) * 0.15;
    
    // Combined boiling plasma
    float plasmaBase = (plasma1 + plasma2 + microDetail) * 0.5 + 0.5;
    
    // Animated sunspots - dark regions that move slowly
    float sunspotNoise = fbm(pos * 1.8 + vec3(t * 0.02), 4);
    float sunspots = smoothstep(0.35, 0.55, sunspotNoise) * uSunspotDensity;
    float darkening = 1.0 - smoothstep(0.15, 0.4, sunspotNoise) * 0.7;
    
    // Solar flares - bright eruptions
    float flareNoise = fbm(pos * 1.2 - vec3(t * 0.15), 3);
    float flares = smoothstep(0.6, 0.9, flareNoise) * 2.0;
    
    // Granulation (small convection cells)
    float granules = snoise(pos * 12.0 + vec3(t * 0.3)) * 0.1 + 0.5;
    
    // Base color with procedural hue variation
    vec3 color1 = uColor1 * (1.0 + uHueShift * 0.3);
    vec3 color2 = uColor2 * (1.0 - uHueShift * 0.2);
    
    // Blend colors based on plasma motion
    vec3 baseColor = mix(color1, color2, plasmaBase * granules);
    
    // Apply sunspot darkening
    baseColor = mix(baseColor, baseColor * 0.15, (1.0 - darkening) * 0.9);
    
    // Add solar flare brightness
    baseColor += color1 * flares * 0.8;
    
    // White-hot core (fixes black center bug)
    vec3 viewDir = normalize(vViewPosition);
    float centerBrightness = pow(max(dot(vNormal, viewDir), 0.0), 0.8);
    vec3 coreColor = vec3(1.3, 1.25, 1.15);
    baseColor = mix(baseColor, coreColor, centerBrightness * 0.6);
    
    // Limb darkening with corona glow
    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 3.0);
    baseColor += color1 * fresnel * 0.4;
    
    // Chromosphere edge glow
    float limbGlow = smoothstep(0.3, 0.9, 1.0 - abs(dot(vNormal, viewDir)));
    baseColor += color1 * limbGlow * 0.3;
    
    gl_FragColor = vec4(baseColor * uIntensity, 1.0);
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
  
  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.5);
    
    // Pulsating corona
    float pulse = 0.85 + 0.15 * sin(uTime * 1.5);
    float glow = fresnel * pulse;
    
    gl_FragColor = vec4(uColor * 1.5, glow * uOpacity);
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
    float pulse = 0.7 + 0.3 * sin(uTime * 4.0 + vUv.y * 10.0);
    
    // Combine for soft volumetric look
    float alpha = radialFade * lengthFade * pulse * uIntensity;
    
    gl_FragColor = vec4(uColor * 2.0, alpha * 0.6);
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
      <sphereGeometry args={[size, 64, 64]} />
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

function SunCore({ color1, color2, size, intensity = 3, params, archetype }: SunCoreProps) {
  const materialRef = useRef<ShaderMaterial>(null);
  const meshRef = useRef<Mesh>(null);
  
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
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.0003; // Very slow majestic rotation
    }
  });

  return (
    <group>
      {/* Single high-quality plasma sphere - no overlapping */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[size, 128, 128]} />
        <shaderMaterial 
          ref={materialRef} 
          vertexShader={plasmaVertexShader} 
          fragmentShader={plasmaFragmentShader} 
          uniforms={uniforms} 
          toneMapped={false}
        />
      </mesh>

      {/* Multi-layer corona for atmospheric scattering */}
      <CoronaLayer size={size} color={color1} opacity={0.5} scale={1.15} />
      <CoronaLayer size={size} color="#ffffff" opacity={0.25} scale={1.3} />
      <CoronaLayer size={size} color={color1} opacity={0.12} scale={archetype.coronaScale} />
      <CoronaLayer size={size} color={color2} opacity={0.05} scale={archetype.coronaScale * 1.5} />
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

  const orbitRadius = 4.5;
  const orbitSpeed = VISUAL_CONFIG.ANIMATION.BINARY_ORBIT * 0.3; // Much slower

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