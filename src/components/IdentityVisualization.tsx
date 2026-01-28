import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Stars, OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { ACESFilmicToneMapping, Vector2 } from 'three';
import { PlanetIdentity } from './PlanetIdentity';
import type { WalletTraits } from '@/hooks/useWalletData';

interface IdentityVisualizationProps {
  traits: WalletTraits | null;
  score: number;
}

function Scene({ traits, score }: IdentityVisualizationProps) {
  if (!traits) {
    return (
      <>
        <ambientLight intensity={0.02} />
        <Stars radius={100} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />
      </>
    );
  }

  return (
    <>
      <ambientLight intensity={0.1} />
      <directionalLight position={[10, 10, 5]} intensity={0.5} />
      <Stars radius={150} depth={60} count={5000} factor={4.5} saturation={0} fade speed={0.5} />
      
      {/* Single Planet in Center */}
      <PlanetIdentity tier={traits.planetTier} score={score} />
      
      {/* Soft Nebula Background */}
      <Nebula />
      
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={5}
        maxDistance={15}
        dampingFactor={0.05}
        enableDamping
        rotateSpeed={0.4}
        autoRotate
        autoRotateSpeed={0.5}
      />

      {/* Post-processing Effects */}
      <EffectComposer multisampling={0}>
        <Bloom
          intensity={traits.planetTier === 'sun' || traits.planetTier === 'binary_sun' ? 3.0 : 1.5}
          radius={0.5}
          luminanceThreshold={0.7}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
        <Vignette darkness={0.6} offset={0.4} />
        <Noise opacity={0.015} blendFunction={BlendFunction.SOFT_LIGHT} />
      </EffectComposer>
    </>
  );
}

function Nebula() {
  return (
    <mesh position={[0, 0, -50]}>
      <sphereGeometry args={[80, 32, 32]} />
      <meshBasicMaterial
        color="#0a0a1a"
        transparent
        opacity={0.3}
        depthWrite={false}
      />
    </mesh>
  );
}

export function IdentityVisualization({ traits, score }: IdentityVisualizationProps) {
  return (
    <div className="w-full h-full absolute inset-0 bg-black">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50, far: 200 }}
        gl={{
          antialias: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Scene traits={traits} score={score} />
        </Suspense>
      </Canvas>
    </div>
  );
}
