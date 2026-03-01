/**
 * CosmicHub — 3D orbital menu after wallet scan.
 * Card floats in center, 5 module icons orbit around it.
 * Tap a module → camera zooms in → navigate to page.
 * 
 * Modules:
 *   1. Black Hole (token burner)
 *   2. Prism League (games)
 *   3. Stellar Forge (shop/crafting)
 *   4. Nebula Market (social/leaderboard)
 *   5. Constellation (wallet graph)
 */

import React, { useRef, useState, useCallback, useEffect, useMemo, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Stars, useTexture } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { Vector3, MathUtils, Color, Group, Mesh, AdditiveBlending } from 'three';
import { useNavigate } from 'react-router-dom';
import type { PrismBalance } from '@/lib/prismCoin';

// ── Module definitions ──

export interface HubModule {
  id: string;
  label: string;
  icon: string;
  route: string;
  color: string;
  glowColor: string;
  orbitRadius: number;
  orbitSpeed: number;
  initialAngle: number;
  description: string;
  size: number;
}

const HUB_MODULES: HubModule[] = [
  {
    id: 'blackhole',
    label: 'Black Hole',
    icon: '🕳️',
    route: '/blackhole',
    color: '#8b5cf6',
    glowColor: '#7c3aed',
    orbitRadius: 4.5,
    orbitSpeed: 0.15,
    initialAngle: 0,
    description: 'Burn dust tokens & reclaim SOL',
    size: 0.6,
  },
  {
    id: 'prism-league',
    label: 'Prism League',
    icon: '🎮',
    route: '/game',
    color: '#06b6d4',
    glowColor: '#0891b2',
    orbitRadius: 5.0,
    orbitSpeed: 0.12,
    initialAngle: (2 * Math.PI) / 5,
    description: 'Play games, earn PRISM coins',
    size: 0.65,
  },
  {
    id: 'stellar-forge',
    label: 'Stellar Forge',
    icon: '⚒️',
    route: '/forge',
    color: '#f59e0b',
    glowColor: '#d97706',
    orbitRadius: 4.8,
    orbitSpeed: 0.18,
    initialAngle: (4 * Math.PI) / 5,
    description: 'Craft upgrades with PRISM coins',
    size: 0.55,
  },
  {
    id: 'nebula-market',
    label: 'Nebula Market',
    icon: '🌌',
    route: '/market',
    color: '#ec4899',
    glowColor: '#db2777',
    orbitRadius: 5.2,
    orbitSpeed: 0.1,
    initialAngle: (6 * Math.PI) / 5,
    description: 'Explore wallets & leaderboards',
    size: 0.6,
  },
  {
    id: 'constellation',
    label: 'Constellation',
    icon: '✨',
    route: '/constellation',
    color: '#10b981',
    glowColor: '#059669',
    orbitRadius: 4.6,
    orbitSpeed: 0.14,
    initialAngle: (8 * Math.PI) / 5,
    description: 'Map your wallet connections',
    size: 0.5,
  },
];

// ── Orbiting Module Node ──

interface ModuleNodeProps {
  module: HubModule;
  onSelect: (module: HubModule) => void;
  isSelected: boolean;
  isZooming: boolean;
}

function ModuleNode({ module, onSelect, isSelected, isZooming }: ModuleNodeProps) {
  const groupRef = useRef<Group>(null!);
  const meshRef = useRef<Mesh>(null!);
  const glowRef = useRef<Mesh>(null!);
  const [hovered, setHovered] = useState(false);

  useFrame(({ clock }) => {
    if (!groupRef.current || isZooming) return;

    const t = clock.getElapsedTime();
    const angle = module.initialAngle + t * module.orbitSpeed;

    groupRef.current.position.x = Math.cos(angle) * module.orbitRadius;
    groupRef.current.position.z = Math.sin(angle) * module.orbitRadius;
    groupRef.current.position.y = Math.sin(t * 0.3 + module.initialAngle) * 0.3;

    // Gentle rotation
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.005;
    }

    // Pulse glow on hover
    if (glowRef.current) {
      const scale = hovered ? 1.8 + Math.sin(t * 4) * 0.2 : 1.4;
      glowRef.current.scale.setScalar(scale);
    }
  });

  const handleClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelect(module);
    },
    [module, onSelect],
  );

  const color = new Color(module.color);
  const glowColor = new Color(module.glowColor);

  return (
    <group ref={groupRef}>
      {/* Glow sphere */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[module.size * 1.2, 16, 16]} />
        <meshBasicMaterial
          color={glowColor}
          transparent
          opacity={hovered ? 0.25 : 0.1}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Main sphere */}
      <mesh
        ref={meshRef}
        onClick={handleClick}
        onPointerEnter={() => { setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'default'; }}
      >
        <sphereGeometry args={[module.size, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 1.5 : 0.6}
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>

      {/* Orbit ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <ringGeometry args={[module.size * 0.9, module.size * 1.1, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={hovered ? 0.4 : 0.15}
          side={2}
        />
      </mesh>

      {/* HTML label */}
      <Html
        position={[0, module.size + 0.5, 0]}
        center
        distanceFactor={8}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          style={{
            color: 'white',
            fontSize: '14px',
            fontWeight: 700,
            textAlign: 'center',
            textShadow: `0 0 10px ${module.color}, 0 0 20px ${module.color}`,
            whiteSpace: 'nowrap',
            opacity: hovered ? 1 : 0.7,
            transition: 'opacity 0.3s',
          }}
        >
          <span style={{ fontSize: '20px', display: 'block' }}>{module.icon}</span>
          {module.label}
        </div>
      </Html>
    </group>
  );
}

// ── Orbit path rings ──

function OrbitRings() {
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      {HUB_MODULES.map((mod) => (
        <mesh key={mod.id}>
          <ringGeometry args={[mod.orbitRadius - 0.01, mod.orbitRadius + 0.01, 128]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.04} side={2} />
        </mesh>
      ))}
    </group>
  );
}

// ── Center card placeholder ──

function CenterCard({ onClick }: { onClick: () => void }) {
  const meshRef = useRef<Mesh>(null!);
  const [hovered, setHovered] = useState(false);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.3) * 0.1;
    meshRef.current.position.y = Math.sin(clock.getElapsedTime() * 0.5) * 0.15;
  });

  return (
    <mesh
      ref={meshRef}
      onClick={onClick}
      onPointerEnter={() => { setHovered(true); document.body.style.cursor = 'pointer'; }}
      onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'default'; }}
    >
      <boxGeometry args={[2.2, 3.2, 0.08]} />
      <meshStandardMaterial
        color="#0e1627"
        emissive={hovered ? '#22d3ee' : '#0e7490'}
        emissiveIntensity={hovered ? 0.8 : 0.3}
        roughness={0.1}
        metalness={0.9}
      />
    </mesh>
  );
}

// ── Camera controller with zoom ──

interface CameraControllerProps {
  target: Vector3 | null;
  isZooming: boolean;
  onZoomComplete: () => void;
}

function CameraController({ target, isZooming, onZoomComplete }: CameraControllerProps) {
  const { camera } = useThree();
  const targetPos = useRef(new Vector3(0, 2, 12));
  const targetLookAt = useRef(new Vector3(0, 0, 0));
  const zoomProgress = useRef(0);

  useFrame((_, delta) => {
    if (isZooming && target) {
      zoomProgress.current = Math.min(1, zoomProgress.current + delta * 1.2);
      const ease = 1 - Math.pow(1 - zoomProgress.current, 3); // ease-out cubic

      const zoomedPos = target.clone().add(new Vector3(0, 0.5, 2.5));
      camera.position.lerpVectors(targetPos.current, zoomedPos, ease);
      camera.lookAt(target);

      if (zoomProgress.current >= 1) {
        onZoomComplete();
      }
    } else {
      // Idle orbit: gentle circular movement
      zoomProgress.current = 0;
      targetPos.current.copy(camera.position);

      const defaultPos = new Vector3(0, 2, 12);
      camera.position.lerp(defaultPos, 0.02);
      camera.lookAt(0, 0, 0);
    }
  });

  return null;
}

// ── Ambient particles ──

function AmbientParticles() {
  const ref = useRef<any>(null!);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.01;
    }
  });

  return (
    <Stars
      ref={ref}
      radius={100}
      depth={50}
      count={3000}
      factor={3}
      saturation={0}
      fade
      speed={0.5}
    />
  );
}

// ── Main CosmicHub component ──

interface CosmicHubProps {
  walletAddress: string;
  prismBalance?: PrismBalance | null;
  onNavigateToCard: () => void;
}

export default function CosmicHub({ walletAddress, prismBalance, onNavigateToCard }: CosmicHubProps) {
  const navigate = useNavigate();
  const [selectedModule, setSelectedModule] = useState<HubModule | null>(null);
  const [isZooming, setIsZooming] = useState(false);
  const [zoomTarget, setZoomTarget] = useState<Vector3 | null>(null);

  const handleModuleSelect = useCallback((module: HubModule) => {
    setSelectedModule(module);
    setIsZooming(true);
    // We'll compute the target position from the module's current orbit position
    // For now, use a fixed direction based on initial angle
    const x = Math.cos(module.initialAngle) * module.orbitRadius;
    const z = Math.sin(module.initialAngle) * module.orbitRadius;
    setZoomTarget(new Vector3(x, 0, z));
  }, []);

  const handleZoomComplete = useCallback(() => {
    if (selectedModule) {
      // Small delay for visual effect
      setTimeout(() => {
        navigate(selectedModule.route + (walletAddress ? `?address=${walletAddress}` : ''));
      }, 200);
    }
  }, [selectedModule, navigate, walletAddress]);

  const handleCardClick = useCallback(() => {
    onNavigateToCard();
  }, [onNavigateToCard]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#050510' }}>
      {/* PRISM balance overlay */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(139,92,246,0.3)',
          borderRadius: 12,
          padding: '8px 16px',
          backdropFilter: 'blur(8px)',
        }}
      >
        <span style={{ fontSize: 18 }}>💎</span>
        <span style={{ color: '#c084fc', fontWeight: 700, fontSize: 16, fontFamily: 'monospace' }}>
          {prismBalance?.balance ?? 0}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600, letterSpacing: 2 }}>
          PRISM
        </span>
      </div>

      {/* Wallet address */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 10,
          color: 'rgba(255,255,255,0.4)',
          fontSize: 11,
          fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.4)',
          padding: '6px 12px',
          borderRadius: 8,
        }}
      >
        {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
      </div>

      {/* Title */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: 0,
          right: 0,
          zIndex: 10,
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, letterSpacing: 4, textTransform: 'uppercase' }}>
          Identity Prism v5.0 — Cosmic Hub
        </p>
      </div>

      {/* Selected module info */}
      {selectedModule && !isZooming && (
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            textAlign: 'center',
            color: 'white',
            background: 'rgba(0,0,0,0.7)',
            border: `1px solid ${selectedModule.color}40`,
            borderRadius: 16,
            padding: '12px 24px',
            backdropFilter: 'blur(8px)',
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 700 }}>
            {selectedModule.icon} {selectedModule.label}
          </p>
          <p style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
            {selectedModule.description}
          </p>
        </div>
      )}

      {/* Three.js Canvas */}
      <Canvas
        camera={{ position: [0, 2, 12], fov: 50, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.15} />
        <pointLight position={[0, 5, 0]} intensity={1} color="#22d3ee" distance={20} />
        <pointLight position={[5, -2, 5]} intensity={0.5} color="#8b5cf6" distance={15} />

        <CameraController
          target={zoomTarget}
          isZooming={isZooming}
          onZoomComplete={handleZoomComplete}
        />

        <AmbientParticles />
        <OrbitRings />

        {/* Center: Identity Card */}
        <CenterCard onClick={handleCardClick} />

        {/* Orbiting modules */}
        {HUB_MODULES.map((mod) => (
          <ModuleNode
            key={mod.id}
            module={mod}
            onSelect={handleModuleSelect}
            isSelected={selectedModule?.id === mod.id}
            isZooming={isZooming}
          />
        ))}

        {/* Post-processing */}
        <EffectComposer>
          <Bloom
            intensity={0.8}
            luminanceThreshold={0.6}
            luminanceSmoothing={0.9}
          />
          <Vignette darkness={0.4} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}

export { HUB_MODULES };
export type { CosmicHubProps };
