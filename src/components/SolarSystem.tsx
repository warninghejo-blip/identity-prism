import { 
  Vector3, 
  MathUtils, 
  PerspectiveCamera, 
  EventDispatcher, 
  DoubleSide, 
  AdditiveBlending, 
  Color, 
  FrontSide, 
  NormalBlending, 
  Points, 
  Mesh, 
  Group, 
  LineSegments, 
  CanvasTexture, 
  ACESFilmicToneMapping,
  Texture,
  Vector2,
  BackSide
} from 'three';
import { useRef, useMemo, Suspense, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars, OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom, ChromaticAberration, Vignette, Noise } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { VISUAL_CONFIG } from '@/constants';
import { SeekerSun } from './SeekerSun';
import type { PlanetData, MoonData, SolarSystemData, SpaceDustConfig, NebulaConfig } from '@/lib/solarSystemGenerator';
import { generatePlanetTextures, generateCloudTexture, generateMoonTexture, generateSolarSystem } from '@/lib/solarSystemGenerator';
import type { WalletTraits } from '@/hooks/useWalletData';

interface SolarSystemProps {
  traits: WalletTraits | null;
  walletAddress?: string;
  isWarping?: boolean;
}

// Create soft circular particle texture (fixes square particle bug)
function createCircleTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64; 
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  
  // Radial gradient for soft glow
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.2)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  
  ctx.fillStyle = gradient; 
  ctx.fillRect(0, 0, 64, 64);
  
  const tex = new CanvasTexture(canvas); 
  tex.needsUpdate = true; 
  return tex;
}

// Mobile-responsive camera with FOV adjustment - Cinematic Composition
// Camera positioned at [0, 8, 25] looking at [0, 5, 0] to push system to top 60%
function CinematicCamera({ isWarping, hasTraits }: { isWarping?: boolean; hasTraits: boolean }) {
  const { camera, size } = useThree();
  // CINEMATIC: Camera at [0, 8, 25], lookAt [0, 5, 0] per spec
  const targetPos = useRef(new Vector3(0, 8, 25));
  const targetFov = useRef(50);
  const currentFov = useRef(50);
  const lookAtPos = useRef(new Vector3(0, 5, 0));
  const isMobile = size.width < 768;
  const isVertical = size.height > size.width;
  const [isTransitioning, setIsTransitioning] = useState(true);
  const userInteracted = useRef(false);
  const controls = useThree((state) => state.controls);

  useEffect(() => {
    if (isWarping) {
      targetPos.current.set(0, 0, 50);
      targetFov.current = 160;
      lookAtPos.current.set(0, 0, 0);
    } else if (hasTraits) {
      // CINEMATIC: Push system to top 60% of screen, leave bottom 40% for UI
      if (isVertical) {
        // Mobile portrait: zoom out more, push system up higher
        targetPos.current.set(0, 10, 32);
        targetFov.current = 72;
        lookAtPos.current.set(0, 6, 0);
      } else if (isMobile) {
        // Mobile landscape
        targetPos.current.set(0, 8, 28);
        targetFov.current = 62;
        lookAtPos.current.set(0, 5, 0);
      } else {
        // Desktop: [0, 8, 25] looking at [0, 5, 0] per spec
        targetPos.current.set(0, 8, 25);
        targetFov.current = 50;
        lookAtPos.current.set(0, 5, 0);
      }
    } else {
      // Landing position - empty starfield view
      if (isVertical) {
        targetPos.current.set(0, 8, 30);
        targetFov.current = 68;
        lookAtPos.current.set(0, 5, 0);
      } else if (isMobile) {
        targetPos.current.set(0, 6, 26);
        targetFov.current = 60;
        lookAtPos.current.set(0, 4, 0);
      } else {
        targetPos.current.set(0, 6, 22);
        targetFov.current = 52;
        lookAtPos.current.set(0, 4, 0);
      }
    }
    
    const timer = setTimeout(() => {
      setIsTransitioning(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, [size, isWarping, hasTraits, isMobile, isVertical]);

  useEffect(() => {
    if (!controls) return;
    const onStart = () => {
      userInteracted.current = true;
      setIsTransitioning(false);
    };
    (controls as unknown as EventDispatcher).addEventListener('start', onStart);
    return () => (controls as unknown as EventDispatcher).removeEventListener('start', onStart);
  }, [controls]);

  useFrame(() => {
    if (isWarping) {
      const intensity = 0.8;
      camera.position.x += (Math.random() - 0.5) * intensity;
      camera.position.y += (Math.random() - 0.5) * intensity;
    } else if (isTransitioning && !userInteracted.current) {
      camera.position.lerp(targetPos.current, 0.015); // Slower, smoother
      currentFov.current = MathUtils.lerp(currentFov.current, targetFov.current, 0.015);
      
      if ('fov' in camera) {
        (camera as PerspectiveCamera).fov = currentFov.current;
      }
      
      camera.lookAt(lookAtPos.current);
      camera.updateProjectionMatrix();
    }
  });
  
  return null;
}

// Ultra-thin orbital path (lineWidth: 0.5 equivalent, very transparent)
function OrbitPath({ radius, color }: { radius: number; color: string }) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={1}>
      <ringGeometry args={[radius - 0.008, radius + 0.008, 128]} />
      <meshBasicMaterial 
        color={color} 
        transparent 
        opacity={0.025} 
        side={DoubleSide} 
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

// Moon component with crater texture
function Moon({ moon }: { moon: MoonData }) {
  const ref = useRef<Mesh>(null);
  
  const craterTexture = useMemo(() => {
    const seed = parseInt(moon.id.replace(/\D/g, '')) || 12345;
    return generateMoonTexture(seed);
  }, [moon.id]);
  
  useFrame((state) => {
    if (ref.current) {
      // 80% slower orbital motion
      const angle = moon.initialAngle + state.clock.elapsedTime * VISUAL_CONFIG.ANIMATION.MOON_ORBIT * 0.2;
      ref.current.position.x = Math.cos(angle) * moon.orbitRadius;
      ref.current.position.y = Math.sin(angle * 0.5) * (moon.inclination || 0);
      ref.current.position.z = Math.sin(angle) * moon.orbitRadius;
      ref.current.rotation.y += 0.001;
    }
  });
  
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[moon.size, 32, 32]} />
      <meshPhysicalMaterial 
        color="#8b8b8b" 
        map={craterTexture}
        bumpMap={craterTexture}
        bumpScale={0.02}
        roughness={0.95} 
        metalness={0.05}
        depthWrite={true}
      />
    </mesh>
  );
}

// Rotating cloud layer for terrestrial planets
interface CloudLayerProps {
  planetSize: number;
  seed: number;
}

function CloudLayer({ planetSize, seed }: CloudLayerProps) {
  const cloudRef = useRef<Mesh>(null);
  const cloudTexture = useMemo(() => generateCloudTexture(seed), [seed]);
  
  useFrame((state, delta) => {
    if (cloudRef.current) {
      cloudRef.current.rotation.y += delta * 0.006; // 80% slower
    }
  });
  
  return (
    <mesh ref={cloudRef} scale={1.03}>
      <sphereGeometry args={[planetSize, 64, 64]} />
      <meshStandardMaterial
        map={cloudTexture}
        transparent
        opacity={0.65}
        depthWrite={false}
        side={FrontSide}
        blending={NormalBlending}
      />
    </mesh>
  );
}

// Saturn-like ring for blue chip planets
function PlanetRing({ planetSize }: { planetSize: number }) {
  const pointsRef = useRef<Points>(null);
  const circleTex = useMemo(() => createCircleTexture(), []);
  
  const { positions, colors, count } = useMemo(() => {
    const particleCount = 6000;
    const pos = new Float32Array(particleCount * 3);
    const col = new Float32Array(particleCount * 3);
    const color = new Color('#ffffff');
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const dist = planetSize * 1.5 + Math.random() * planetSize * 0.7;
      pos[i3] = Math.cos(angle) * dist;
      pos[i3 + 1] = (Math.random() - 0.5) * 0.015;
      pos[i3 + 2] = Math.sin(angle) * dist;
      
      const brightness = 0.4 + Math.random() * 0.6;
      col[i3] = color.r * brightness;
      col[i3 + 1] = color.g * brightness;
      col[i3 + 2] = color.b * brightness;
    }
    return { positions: pos, colors: col, count: particleCount };
  }, [planetSize]);

  useFrame(() => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += 0.0006; // 80% slower
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        map={circleTex}
        size={0.006}
        vertexColors
        transparent
        opacity={0.45}
        blending={AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// Animated satellite orbiting a planet
function Satellite({ planetSize, orbitRadius, speed, seed }: { 
  planetSize: number; 
  orbitRadius: number;
  speed: number;
  seed: number;
}) {
  const ref = useRef<Mesh>(null);
  const initialAngle = useMemo(() => seed * 0.01, [seed]);
  
  useFrame((state) => {
    if (ref.current) {
      const angle = initialAngle + state.clock.elapsedTime * speed;
      ref.current.position.x = Math.cos(angle) * orbitRadius;
      ref.current.position.z = Math.sin(angle) * orbitRadius;
      ref.current.rotation.y += 0.01;
    }
  });
  
  return (
    <mesh ref={ref}>
      <boxGeometry args={[0.02, 0.01, 0.015]} />
      <meshStandardMaterial 
        color="#88ccff" 
        emissive="#4488ff" 
        emissiveIntensity={0.5}
        metalness={0.8}
        roughness={0.2}
      />
    </mesh>
  );
}

// Asteroid belt component - low-poly rocky debris
function AsteroidBelt({ innerRadius, outerRadius, count }: { innerRadius: number; outerRadius: number; count: number }) {
  const asteroidRefs = useRef<Group>(null);
  
  const asteroids = useMemo(() => {
    const items = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = innerRadius + Math.random() * (outerRadius - innerRadius);
      const size = 0.02 + Math.random() * 0.08;
      const rotSpeed = (Math.random() - 0.5) * 0.02;
      const orbitSpeed = (0.02 + Math.random() * 0.02) * 0.2; // 80% slower
      items.push({ 
        id: i, 
        x: Math.cos(angle) * radius, 
        z: Math.sin(angle) * radius, 
        y: (Math.random() - 0.5) * 2,
        size, 
        rotSpeed,
        orbitSpeed,
        angle,
        radius
      });
    }
    return items;
  }, [innerRadius, outerRadius, count]);

  useFrame((state) => {
    if (asteroidRefs.current) {
      asteroidRefs.current.children.forEach((child, i) => {
        const asteroid = asteroids[i];
        const time = state.clock.elapsedTime;
        const angle = asteroid.angle + time * asteroid.orbitSpeed;
        child.position.x = Math.cos(angle) * asteroid.radius;
        child.position.z = Math.sin(angle) * asteroid.radius;
        child.rotation.x += asteroid.rotSpeed;
        child.rotation.y += asteroid.rotSpeed * 0.7;
      });
    }
  });

  return (
    <group ref={asteroidRefs}>
      {asteroids.map((a) => (
        <mesh key={a.id} position={[a.x, a.y, a.z]}>
          <dodecahedronGeometry args={[a.size, 0]} />
          <meshStandardMaterial 
            color="#4a4a4a" 
            roughness={0.95} 
            metalness={0.1}
            transparent={false}
            depthWrite={true}
          />
        </mesh>
      ))}
    </group>
  );
}

// Space rocket/probe flying between planets
function SpaceRocket({ startRadius, endRadius, speed, seed }: { 
  startRadius: number; 
  endRadius: number; 
  speed: number;
  seed: number;
}) {
  const rocketRef = useRef<Group>(null);
  const startAngle = useMemo(() => seed * 0.1, [seed]);
  
  useFrame((state) => {
    if (rocketRef.current) {
      const time = state.clock.elapsedTime * speed * 0.2; // 80% slower
      const progress = (Math.sin(time + startAngle) + 1) / 2;
      const radius = startRadius + progress * (endRadius - startRadius);
      const angle = time * 0.3 + startAngle;
      
      rocketRef.current.position.x = Math.cos(angle) * radius;
      rocketRef.current.position.z = Math.sin(angle) * radius;
      rocketRef.current.position.y = Math.sin(time * 2) * 0.5;
      
      // Point in direction of travel
      rocketRef.current.rotation.y = -angle + Math.PI / 2;
    }
  });
  
  return (
    <group ref={rocketRef}>
      {/* Rocket body */}
      <mesh>
        <coneGeometry args={[0.015, 0.08, 6]} />
        <meshStandardMaterial color="#cccccc" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Engine glow */}
      <mesh position={[0, -0.05, 0]}>
        <sphereGeometry args={[0.012, 8, 8]} />
        <meshBasicMaterial color="#ff6600" toneMapped={false} />
      </mesh>
      {/* Thruster trail */}
      <mesh position={[0, -0.08, 0]}>
        <coneGeometry args={[0.008, 0.04, 6]} />
        <meshBasicMaterial color="#ffaa00" transparent opacity={0.6} toneMapped={false} />
      </mesh>
    </group>
  );
}

// Main planet component with all features
function Planet({ planet, orbitColor }: { planet: PlanetData; orbitColor: string }) {
  const groupRef = useRef<Group>(null);
  const meshRef = useRef<Mesh>(null);
  const atmosphereRef = useRef<Mesh>(null);
  const textures = useMemo(() => generatePlanetTextures(planet.surface, planet.materialSeed), [planet.surface, planet.materialSeed]);
  
  // Determine if this is an active/inhabited world
  const isInhabited = planet.type.name === 'terrestrial';
  
  useFrame((state, delta) => {
    if (groupRef.current) {
      // 80% slower orbital motion
      const angle = planet.initialAngle + state.clock.elapsedTime * VISUAL_CONFIG.ANIMATION.PLANET_ORBIT * 0.2;
      groupRef.current.position.set(
        Math.cos(angle) * planet.orbitRadius, 
        0, 
        Math.sin(angle) * planet.orbitRadius
      );
    }
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.015; // 80% slower rotation
    }
    if (atmosphereRef.current) {
      atmosphereRef.current.rotation.y += delta * 0.02;
    }
  });
  
  return (
    <>
      <OrbitPath radius={planet.orbitRadius} color={orbitColor} />
      <group ref={groupRef}>
        {/* Main Planet Body - CRITICAL: solid, NO transparency, proper depth sorting */}
        <mesh ref={meshRef} renderOrder={10}>
          <sphereGeometry args={[planet.size, 128, 128]} />
          <meshPhysicalMaterial
            color={planet.type.baseColor}
            map={textures.map}
            bumpMap={textures.bumpMap}
            bumpScale={textures.bumpScale}
            roughness={0.8}
            metalness={0.2}
            clearcoat={planet.type.name === 'ice' ? 0.6 : 0.1}
            clearcoatRoughness={0.4}
            emissive={new Color(planet.type.baseColor)}
            emissiveIntensity={planet.type.name === 'volcanic' ? 0.25 : 0.08}
            transparent={false}
            depthWrite={true}
            depthTest={true}
          />
        </mesh>
        
        {/* Subtle atmosphere glow - rendered after planet */}
        <mesh ref={atmosphereRef} scale={1.035} renderOrder={11}>
          <sphereGeometry args={[planet.size, 48, 48]} />
          <meshBasicMaterial
            color={planet.type.name === 'terrestrial' ? '#4488cc' : planet.type.accent}
            transparent
            opacity={0.08}
            side={BackSide}
            blending={AdditiveBlending}
            depthWrite={false}
            depthTest={true}
            toneMapped={false}
          />
        </mesh>

        {/* Cloud layer for terrestrial worlds */}
        {planet.type.name === 'terrestrial' && (
          <CloudLayer planetSize={planet.size} seed={planet.materialSeed} />
        )}
        
        {/* Ring system */}
        {planet.hasRing && <PlanetRing planetSize={planet.size} />}
        
        {/* Satellites for inhabited worlds */}
        {isInhabited && (
          <>
            <Satellite planetSize={planet.size} orbitRadius={planet.size * 1.8} speed={0.3} seed={planet.materialSeed} />
            <Satellite planetSize={planet.size} orbitRadius={planet.size * 2.2} speed={-0.2} seed={planet.materialSeed + 100} />
          </>
        )}
        
        {/* Moons */}
        {planet.moons.map((m: MoonData) => (
          <Moon key={m.id} moon={m} />
        ))}
      </group>
    </>
  );
}

// High-density space dust with soft circular particles
function SpaceDust({ config }: { config: SpaceDustConfig }) {
  const pointsRef = useRef<Points>(null);
  const circleTex = useMemo(() => createCircleTexture(), []);
  
  const { positions, colors, count } = useMemo(() => {
    const targetCount = Math.min(config.particleCount, 2500);
    const pos = new Float32Array(targetCount * 3);
    const col = new Float32Array(targetCount * 3);
    const palette = ['#ffffff', '#e8f4ff', '#d0eaff'];
    
    for (let i = 0; i < targetCount; i++) {
      const i3 = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 8 + Math.random() * config.spreadRadius * 1.2;
      
      pos[i3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i3 + 1] = (Math.random() - 0.5) * 3; // Slight vertical spread
      pos[i3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      
      const swatch = new Color(palette[Math.floor(Math.random() * palette.length)]);
      col[i3] = swatch.r; 
      col[i3 + 1] = swatch.g; 
      col[i3 + 2] = swatch.b;
    }
    return { positions: pos, colors: col, count: targetCount };
  }, [config]);

  useFrame(() => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += 0.00004; // Very slow drift
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        map={circleTex}
        size={0.025}
        vertexColors
        transparent
        opacity={0.12}
        blending={AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// Hyperjump warp effect
function HyperjumpLines() {
  const lineRef = useRef<LineSegments>(null);
  const count = 1200;
  
  const { positions } = useMemo(() => {
    const pos = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 200;
      const y = (Math.random() - 0.5) * 200;
      const z = (Math.random() - 0.5) * 600;
      pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x; pos[i * 6 + 4] = y; pos[i * 6 + 5] = z - 50;
    }
    return { positions: pos };
  }, []);

  useFrame(() => {
    if (lineRef.current) {
      const arr = lineRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < count; i++) {
        arr[i * 6 + 2] += 45; arr[i * 6 + 5] += 45;
        arr[i * 6 + 5] = arr[i * 6 + 2] - 120; 
        if (arr[i * 6 + 2] > 300) {
          const x = (Math.random() - 0.5) * 200; const y = (Math.random() - 0.5) * 200;
          arr[i * 6] = x; arr[i * 6 + 3] = x;
          arr[i * 6 + 1] = y; arr[i * 6 + 4] = y;
          arr[i * 6 + 2] = -300; arr[i * 6 + 5] = -420;
        }
      }
      lineRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <lineSegments ref={lineRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count * 2} array={positions} itemSize={3} />
      </bufferGeometry>
      <lineBasicMaterial color="#ffffff" transparent opacity={1.0} blending={AdditiveBlending} />
    </lineSegments>
  );
}

// High-quality starfield background
function Starfield({ isWarping }: { isWarping?: boolean }) {
  return (
    <Stars 
      radius={VISUAL_CONFIG.STARS.RADIUS} 
      depth={VISUAL_CONFIG.STARS.DEPTH} 
      count={isWarping ? 1000 : VISUAL_CONFIG.STARS.COUNT} 
      factor={VISUAL_CONFIG.STARS.FACTOR} 
      saturation={VISUAL_CONFIG.STARS.SATURATION} 
      fade={VISUAL_CONFIG.STARS.FADE}
    />
  );
}

// Nebula background particles
function Nebula({ config }: { config?: NebulaConfig }) {
  const nebulaRef = useRef<Points>(null);
  const circleTex = useMemo(() => createCircleTexture(), []);
  
  const { positions, colors, count } = useMemo(() => {
    if (!config) return { positions: new Float32Array(0), colors: new Float32Array(0), count: 0 };
    const pointCount = 3000;
    const pos = new Float32Array(pointCount * 3);
    const col = new Float32Array(pointCount * 3);
    const palette = ['#ffffff', '#f0faff', '#e0f0ff'];
    
    for (let i = 0; i < pointCount; i++) {
      const i3 = i * 3;
      const radius = config.radius * (0.4 + Math.random() * 0.6);
      const angle = Math.random() * Math.PI * 2;
      pos[i3] = Math.cos(angle) * radius;
      pos[i3 + 1] = (Math.random() - 0.5) * 2;
      pos[i3 + 2] = Math.sin(angle) * radius;

      const swatch = new Color(palette[Math.floor(Math.random() * palette.length)]);
      col[i3] = swatch.r;
      col[i3 + 1] = swatch.g;
      col[i3 + 2] = swatch.b;
    }
    return { positions: pos, colors: col, count: pointCount };
  }, [config]);

  useFrame(() => {
    if (nebulaRef.current) {
      nebulaRef.current.rotation.y += 0.00002;
    }
  });

  if (!config || count === 0) return null;

  return (
    <points ref={nebulaRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        map={circleTex}
        size={0.035}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.15}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

// Main scene composition
function SolarSystemScene({ traits, walletAddress, isWarping }: SolarSystemProps) {
  const systemData = useMemo(() => traits ? generateSolarSystem(traits, walletAddress) : null, [traits, walletAddress]);
  const hasTraits = !!traits;

  // Calculate asteroid belt position based on outermost planet
  const asteroidBeltRadius = useMemo(() => {
    if (!systemData || systemData.planets.length === 0) return { inner: 35, outer: 45 };
    const outerPlanet = systemData.planets[systemData.planets.length - 1];
    return { 
      inner: outerPlanet.orbitRadius + 3, 
      outer: outerPlanet.orbitRadius + 8 
    };
  }, [systemData]);

  // Determine if we should show rockets (high tx count)
  const showRockets = traits && traits.txCount > 500;

  return (
    <>
      <CinematicCamera isWarping={isWarping} hasTraits={hasTraits} />
      <ambientLight intensity={0.04} />
      <Starfield isWarping={isWarping} />
      
      {isWarping ? <HyperjumpLines /> : systemData && (
        <>
          <Nebula config={systemData.nebula} />
          <SeekerSun 
            profile={systemData.stellarProfile} 
            walletSeed={walletAddress} 
            rarityTier={systemData.rarityTier}
          />
          {systemData.planets.map((p: PlanetData) => (
            <Planet key={p.id} planet={p} orbitColor={systemData.orbitColor} />
          ))}
          
          {/* Asteroid belt for active wallets */}
          {traits && traits.txCount > 100 && (
            <AsteroidBelt 
              innerRadius={asteroidBeltRadius.inner} 
              outerRadius={asteroidBeltRadius.outer} 
              count={Math.min(80, Math.floor(traits.txCount / 50))} 
            />
          )}
          
          {/* Space rockets for highly active wallets */}
          {showRockets && systemData.planets.length >= 2 && (
            <>
              <SpaceRocket 
                startRadius={systemData.planets[0].orbitRadius} 
                endRadius={systemData.planets[Math.min(2, systemData.planets.length - 1)].orbitRadius} 
                speed={0.5} 
                seed={1} 
              />
              {traits.txCount > 1000 && (
                <SpaceRocket 
                  startRadius={systemData.planets[1].orbitRadius} 
                  endRadius={systemData.planets[Math.min(4, systemData.planets.length - 1)].orbitRadius} 
                  speed={0.3} 
                  seed={42} 
                />
              )}
            </>
          )}
          
          <SpaceDust config={systemData.spaceDust} />
          <OrbitControls 
            makeDefault 
            enablePan={false} 
            enableZoom={true} 
            minDistance={10} 
            maxDistance={150} 
            dampingFactor={0.03} 
            enableDamping 
            rotateSpeed={0.3}
            target={[0, 5, 0]}
          />
        </>
      )}

      {/* Optimized post-processing for mobile - Professional Bloom settings */}
      <EffectComposer multisampling={0}>
        <Bloom 
          intensity={2.0}
          radius={0.4}
          luminanceThreshold={0.8}
          luminanceSmoothing={0.9}
          mipmapBlur 
        />
        <ChromaticAberration 
          offset={new Vector2(0.0003, 0.0003)} 
          radialModulation 
          modulationOffset={0.95} 
        />
        <Vignette darkness={0.5} offset={0.3} />
        <Noise opacity={0.012} blendFunction={BlendFunction.SOFT_LIGHT} />
      </EffectComposer>
    </>
  );
}

// Exported component with Canvas setup
export function SolarSystem({ traits, walletAddress, isWarping }: SolarSystemProps) {
  const isConnected = walletAddress && walletAddress !== '0xDemo...Wallet';
  
  return (
    <div className="w-full h-full absolute inset-0 bg-black">
      <Canvas 
        camera={{ position: [0, 0, 150], fov: 60, far: 2000 }} 
        gl={{ 
          antialias: true, 
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
        dpr={[1, 1.5]} // Limit pixel ratio for mobile performance
      >
        <Suspense fallback={null}>
          <SolarSystemScene traits={traits} walletAddress={walletAddress} isWarping={isWarping} />
          {!isConnected && !traits && !isWarping && (
            <>
              <ambientLight intensity={0.01} />
              <Starfield />
              <OrbitControls enablePan={false} enableZoom={false} rotateSpeed={0.2} />
            </>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
}
