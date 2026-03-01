import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, Group, Color, BackSide, CanvasTexture, ClampToEdgeWrapping, PointLight } from 'three';
import type { PlanetTier } from '@/hooks/useWalletData';
import { SunCore, getProceduralParams, STAR_ARCHETYPES } from './SeekerSun';

interface PlanetIdentityProps {
  tier: PlanetTier;
  score: number;
}

// Enhanced FBM noise for hyper-realistic textures
function simplexNoise(x: number, y: number, seed: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const hash = ((X * 374761393 + Y * 668265263 + seed) ^ (seed >> 13)) & 0xFFFFFFFF;
  return ((hash * (hash * hash * 15731 + 789221) + 1376312589) & 0x7FFFFFFF) / 0x7FFFFFFF * 2 - 1;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += simplexNoise(x * frequency, y * frequency, seed + i) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / maxValue;
}

const PLANET_CONFIGS: Record<PlanetTier, {
  size: number;
  color: string;
  atmosphereColor: string;
  surfaceType: 'rocky' | 'ice' | 'terrestrial' | 'gas';
  emissive?: string;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
}> = {
  mercury: {
    size: 1.2,
    color: '#8C7853',
    atmosphereColor: '#4a4a4a',
    surfaceType: 'rocky',
    metalness: 0.3,
    roughness: 0.95,
  },
  mars: {
    size: 1.4,
    color: '#CD5C5C',
    atmosphereColor: '#8B4513',
    surfaceType: 'rocky',
    metalness: 0.2,
    roughness: 0.9,
  },
  venus: {
    size: 1.6,
    color: '#F4D03F',
    atmosphereColor: '#DAA520',
    surfaceType: 'gas',
    metalness: 0.1,
    roughness: 0.6,
  },
  earth: {
    size: 1.8,
    color: '#4169E1',
    atmosphereColor: '#87CEEB',
    surfaceType: 'terrestrial',
    metalness: 0.2,
    roughness: 0.7,
  },
  neptune: {
    size: 2.2,
    color: '#4682B4',
    atmosphereColor: '#5F9EA0',
    surfaceType: 'ice',
    metalness: 0.4,
    roughness: 0.5,
  },
  uranus: {
    size: 2.4,
    color: '#40E0D0',
    atmosphereColor: '#48D1CC',
    surfaceType: 'gas',
    metalness: 0.3,
    roughness: 0.6,
  },
  saturn: {
    size: 2.8,
    color: '#F4A460',
    atmosphereColor: '#DAA520',
    surfaceType: 'gas',
    metalness: 0.2,
    roughness: 0.5,
  },
  jupiter: {
    size: 3.2,
    color: '#D2691E',
    atmosphereColor: '#CD853F',
    surfaceType: 'gas',
    metalness: 0.15,
    roughness: 0.4,
  },
  sun: {
    size: 3.5,
    color: '#FFA500',
    atmosphereColor: '#FFD700',
    surfaceType: 'gas',
    emissive: '#FF8C00',
    emissiveIntensity: 1.5,
    metalness: 0.0,
    roughness: 0.3,
  },
  binary_sun: {
    size: 3.0,
    color: '#00CED1',
    atmosphereColor: '#FFD700',
    surfaceType: 'gas',
    emissive: '#00CED1',
    emissiveIntensity: 2.0,
    metalness: 0.0,
    roughness: 0.2,
  },
};

function generatePlanetTexture(tier: PlanetTier, score: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(1024, 1024);
  const data = imageData.data;
  const config = PLANET_CONFIGS[tier];
  const seed = score + tier.length * 1000;

  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const idx = (y * 1024 + x) * 4;
      const nx = x / 1024;
      const ny = y / 1024;

      const base = fbm(nx * 4, ny * 4, seed, 8) * 0.5 + 0.5;
      const detail = fbm(nx * 16, ny * 16, seed + 100, 6) * 0.5 + 0.5;
      const micro = fbm(nx * 32, ny * 32, seed + 200, 4) * 0.5 + 0.5;

      const combined = base * 0.5 + detail * 0.3 + micro * 0.2;
      const color = new Color(config.color);

      data[idx] = color.r * 255 * (0.7 + combined * 0.6);
      data[idx + 1] = color.g * 255 * (0.7 + combined * 0.6);
      data[idx + 2] = color.b * 255 * (0.7 + combined * 0.6);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  return texture;
}

export function PlanetIdentity({ tier, score }: PlanetIdentityProps) {
  const groupRef = useRef<Group>(null);
  const planetRef = useRef<Mesh>(null);

  const config = PLANET_CONFIGS[tier];
  const texture = useMemo(() => generatePlanetTexture(tier, score), [tier, score]);
  const atmosphereScale = tier === 'sun' ? 1.05 : 1.08;
  const atmosphereOpacity = tier === 'sun' ? 0.12 : 0.15;

  useFrame((state, delta) => {
    if (planetRef.current) {
      planetRef.current.rotation.y += delta * 0.05;
    }
  });

  if (tier === 'binary_sun') {
    return <BinarySunIdentity score={score} />;
  }

  if (tier === 'sun') {
    return <SingleSunIdentity score={score} />;
  }

  return (
    <group ref={groupRef}>
      {/* Main Planet */}
      <mesh ref={planetRef}>
        <sphereGeometry args={[config.size, 256, 256]} />
        <meshPhysicalMaterial
          map={texture}
          color={config.color}
          metalness={config.metalness || 0.2}
          roughness={config.roughness || 0.7}
          clearcoat={config.surfaceType === 'ice' ? 0.8 : 0.2}
          clearcoatRoughness={0.3}
          emissive={config.emissive ? new Color(config.emissive) : undefined}
          emissiveIntensity={config.emissiveIntensity || 0}
        />
      </mesh>

      <mesh scale={atmosphereScale}>
        <sphereGeometry args={[config.size, 64, 64]} />
        <meshBasicMaterial
          color={config.atmosphereColor}
          transparent
          opacity={atmosphereOpacity}
          side={BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Saturn Rings */}
      {tier === 'saturn' && <SaturnRings planetSize={config.size} />}
    </group>
  );
}

function SaturnRings({ planetSize }: { planetSize: number }) {
  return (
    <mesh rotation={[Math.PI / 2.5, 0, 0]}>
      <ringGeometry args={[planetSize * 1.4, planetSize * 2.2, 128]} />
      <meshBasicMaterial
        color="#C9B037"
        transparent
        opacity={0.7}
        side={2}
      />
    </mesh>
  );
}

function SingleSunIdentity({ score }: { score: number }) {
  const params = useMemo(() => getProceduralParams(`sun-${score}`), [score]);
  const archetype = STAR_ARCHETYPES.rare;

  return (
    <>
      <SunCore
        color1="#FF6B00"
        color2="#FFD700"
        size={3.0}
        intensity={archetype.intensity}
        params={params}
        archetype={archetype}
      />
      <pointLight color="#FFA500" intensity={archetype.intensity * 25} distance={200} decay={2} />
    </>
  );
}

function BinarySunIdentity({ score }: { score: number }) {
  const group1Ref = useRef<Group>(null);
  const group2Ref = useRef<Group>(null);
  const light1Ref = useRef<PointLight>(null);
  const light2Ref = useRef<PointLight>(null);

  const params = useMemo(() => getProceduralParams(`binary-${score}`), [score]);
  const archetype = STAR_ARCHETYPES.legendary;

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (group1Ref.current && group2Ref.current) {
      group1Ref.current.position.x = Math.cos(time * 0.3) * 4;
      group1Ref.current.position.z = Math.sin(time * 0.3) * 4;
      group2Ref.current.position.x = Math.cos(time * 0.3 + Math.PI) * 4;
      group2Ref.current.position.z = Math.sin(time * 0.3 + Math.PI) * 4;
    }
    if (light1Ref.current && group1Ref.current) light1Ref.current.position.copy(group1Ref.current.position);
    if (light2Ref.current && group2Ref.current) light2Ref.current.position.copy(group2Ref.current.position);
  });

  return (
    <>
      {/* Sun 1 - Orange/Gold — shader-based fire surface */}
      <group ref={group1Ref}>
        <SunCore
          color1="#FF6B00"
          color2="#FFD700"
          size={2.2}
          intensity={archetype.intensity}
          params={params}
          archetype={archetype}
        />
      </group>

      {/* Sun 2 - Cyan/Blue — shader-based fire surface */}
      <group ref={group2Ref}>
        <SunCore
          color1="#00B4FF"
          color2="#8CFFE3"
          size={1.8}
          intensity={archetype.intensity * 0.85}
          params={{ ...params, hueShift: -params.hueShift }}
          archetype={archetype}
        />
      </group>

      <pointLight ref={light1Ref} color="#FFA500" intensity={archetype.intensity * 25} distance={200} decay={2} />
      <pointLight ref={light2Ref} color="#00CED1" intensity={archetype.intensity * 20} distance={200} decay={2} />

      {/* Plasma Bridge */}
      <PlasmaBridge />
    </>
  );
}

function PlasmaBridge() {
  const lineRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (lineRef.current) {
      lineRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 2) * 0.1;
    }
  });

  return (
    <mesh ref={lineRef}>
      <cylinderGeometry args={[0.08, 0.08, 8, 32]} />
      <meshStandardMaterial
        color="#FFD700"
        transparent
        opacity={0.4}
        emissive="#FFA500"
        emissiveIntensity={1.5}
      />
    </mesh>
  );
}
