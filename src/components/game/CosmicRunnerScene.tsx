import React, { useRef, useState, useMemo, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Text, Float, Trail, Stars, Instance, Instances, Environment, Html } from "@react-three/drei";
import * as THREE from "three";
import { EffectComposer, Bloom, ChromaticAberration, Vignette, Noise } from "@react-three/postprocessing";
import { Button } from "@/components/ui/button";
import { WalletTraits } from "@/hooks/useWalletData";

// --- Constants ---
const LANE_WIDTH = 3;
const WORLD_SPEED_BASE = 0.4;
const SPAWN_RATE_OBSTACLE = 0.05;
const SPAWN_RATE_COIN = 0.1;
const GAME_BOUNDS_X = 8;

const TIER_COLORS: Record<string, string> = {
  mercury: "#94a3b8", // Slate 400
  mars: "#ef4444",    // Red 500
  venus: "#f97316",   // Orange 500
  earth: "#10b981",   // Emerald 500
  neptune: "#3b82f6", // Blue 500
  uranus: "#06b6d4",  // Cyan 500
  saturn: "#eab308",  // Yellow 500
  jupiter: "#f59e0b", // Amber 500
  sun: "#facc15",     // Yellow 400
  binary_sun: "#ffffff" // White
};

// --- Types ---
type GameState = "start" | "playing" | "gameover";

interface GameProps {
  onScore: (score: number) => void;
  onGameOver: (finalScore: number) => void;
  gameState: GameState;
  traits: WalletTraits | null;
  walletScore: number;
}

// --- Utils ---
const randomRange = (min: number, max: number) => Math.random() * (max - min) + min;

// --- Components ---

function Ship({ position, targetX, traits }: { position: React.MutableRefObject<THREE.Vector3>, targetX: number, traits: WalletTraits | null }) {
  const meshRef = useRef<THREE.Group>(null);
  
  // Visual traits
  const tierColor = traits?.planetTier ? TIER_COLORS[traits.planetTier] : "#00ffff";
  const isWhale = traits?.isWhale || false;
  const scale = isWhale ? 1.2 : 1.0;
  
  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    // Smooth horizontal movement
    meshRef.current.position.x = THREE.MathUtils.lerp(meshRef.current.position.x, targetX, 0.15);
    
    // Update ref position for collision detection
    position.current.copy(meshRef.current.position);
    
    // Banking animation
    const tilt = (meshRef.current.position.x - targetX) * 2;
    meshRef.current.rotation.z = THREE.MathUtils.lerp(meshRef.current.rotation.z, tilt, 0.1);
    
    // Bobbing
    meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 5) * 0.1;
  });

  return (
    <group ref={meshRef} scale={[scale, scale, scale]}>
      <Float speed={5} rotationIntensity={0.2} floatIntensity={0.2}>
        <Trail width={1.2 * scale} length={6} color={tierColor} attenuation={(t) => t * t}>
          <group rotation={[0, Math.PI, 0]}>
            {/* Main Hull */}
            <mesh>
              <coneGeometry args={[0.6, 2.5, 3]} />
              <meshStandardMaterial color={tierColor} emissive={tierColor} emissiveIntensity={2} toneMapped={false} />
            </mesh>
            {/* Wings */}
            <mesh position={[0, -0.2, 0.5]} rotation={[Math.PI / 2, 0, 0]}>
              <boxGeometry args={[2.5, 0.1, 1]} />
              <meshStandardMaterial color={tierColor} emissive={tierColor} emissiveIntensity={1} wireframe />
            </mesh>
            {/* Engine Glow */}
            <pointLight position={[0, 0, 1.5]} intensity={2} color={tierColor} distance={5} />
          </group>
        </Trail>
      </Float>
    </group>
  );
}

function Obstacle({ position, onHit }: { position: THREE.Vector3, onHit: () => void }) {
  const ref = useRef<THREE.Mesh>(null);
  
  useFrame((state, delta) => {
    if (ref.current) {
        ref.current.rotation.x += delta;
        ref.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <mesh ref={ref} position={position}>
      <dodecahedronGeometry args={[0.8, 0]} />
      <meshStandardMaterial color="#ff0055" emissive="#ff0055" emissiveIntensity={2} wireframe />
    </mesh>
  );
}

function Coin({ position }: { position: THREE.Vector3 }) {
  const ref = useRef<THREE.Group>(null);
  
  useFrame((state, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 3;
    }
  });

  return (
    <group ref={ref} position={position}>
      <mesh rotation={[Math.PI / 4, Math.PI / 4, 0]}>
        <octahedronGeometry args={[0.5, 0]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffaa00" emissiveIntensity={2} toneMapped={false} />
      </mesh>
    </group>
  );
}

function MovingGrid({ speed }: { speed: number }) {
    const materialRef = useRef<THREE.ShaderMaterial>(null);
    useFrame((state, delta) => {
        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value += delta * speed * 5;
        }
    });

    const shaderArgs = useMemo(() => ({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color("#00ffff") }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uColor;
            varying vec2 vUv;
            
            void main() {
                float grid = step(0.98, fract(vUv.x * 20.0)) + step(0.98, fract(vUv.y * 20.0 + uTime));
                float fade = 1.0 - vUv.y;
                vec3 color = uColor * grid * fade;
                gl_FragColor = vec4(color, grid * fade * 0.5);
            }
        `,
        transparent: true,
    }), []);

    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, -10]}>
            <planeGeometry args={[40, 60]} />
            <shaderMaterial ref={materialRef} {...shaderArgs} />
        </mesh>
    );
}

function GameWorld({ gameState, onGameOver, onScore, traits, walletScore }: GameProps) {
  const { viewport, mouse } = useThree();
  const shipPos = useRef(new THREE.Vector3(0, 0, 5));
  
  // Game Entities
  const [obstacles, setObstacles] = useState<{ id: number, pos: THREE.Vector3 }[]>([]);
  const [coins, setCoins] = useState<{ id: number, pos: THREE.Vector3 }[]>([]);
  
  // Gameplay modifiers from traits
  const baseSpeed = useMemo(() => {
    let speed = WORLD_SPEED_BASE;
    if (traits?.hyperactiveDegen) speed *= 1.2; // Faster start for degens
    return speed;
  }, [traits]);

  const scoreMultiplier = useMemo(() => {
    let mult = 1.0;
    if (traits?.isWhale) mult += 0.2;
    if (traits?.isBlueChip) mult += 0.1;
    if (traits?.planetTier === 'binary_sun') mult += 0.5;
    return mult;
  }, [traits]);
  
  // Refs for logic loop
  const stateRef = useRef({
    score: 0,
    speed: baseSpeed,
    lastSpawn: 0,
    gameOver: false
  });

  // Reset logic
  useEffect(() => {
    if (gameState === "start") {
      setObstacles([]);
      setCoins([]);
      stateRef.current = { score: 0, speed: baseSpeed, lastSpawn: 0, gameOver: false };
      onScore(0);
    }
  }, [gameState, baseSpeed]);

  useFrame((state, delta) => {
    if (gameState !== "playing") return;

    const time = state.clock.getElapsedTime();
    const s = stateRef.current;
    
    // Increase speed over time (difficulty curve)
    s.speed = baseSpeed + (s.score * 0.00005);

    // Spawn Logic
    // Faster speed = faster spawning to keep density consistent-ish
    if (time - s.lastSpawn > (1.0 / s.speed) * 0.6) {
      s.lastSpawn = time;
      
      const spawnX = randomRange(-GAME_BOUNDS_X, GAME_BOUNDS_X);
      const spawnZ = -30;
      
      // Coin spawn rate increases slightly with wallet score (luck)
      const luckBonus = Math.min((walletScore || 0) / 5000, 0.1); 
      if (Math.random() < (0.3 + luckBonus)) {
        // Spawn Coin
        setCoins(prev => [...prev, { id: Date.now(), pos: new THREE.Vector3(spawnX, 0, spawnZ) }]);
      } else {
        // Spawn Obstacle
        setObstacles(prev => [...prev, { id: Date.now(), pos: new THREE.Vector3(spawnX, 0, spawnZ) }]);
      }
    }

    // Move Entities & Collision Detection
    setObstacles(prev => prev.map(o => {
      o.pos.z += s.speed * 20 * delta;
      return o;
    }).filter(o => {
      // Collision
      if (o.pos.z > 3 && o.pos.z < 7) {
        if (Math.abs(o.pos.x - shipPos.current.x) < 1.2) {
          if (!s.gameOver) {
            s.gameOver = true;
            onGameOver(Math.floor(s.score));
          }
        }
      }
      return o.pos.z < 10;
    }));

    setCoins(prev => prev.map(c => {
      c.pos.z += s.speed * 20 * delta;
      return c;
    }).filter(c => {
      // Collection
      if (c.pos.z > 3 && c.pos.z < 7) {
        if (Math.abs(c.pos.x - shipPos.current.x) < 1.5) {
            // Score calculation
            const basePoints = 100;
            s.score += basePoints * scoreMultiplier;
            onScore(Math.floor(s.score));
            return false; // Remove
        }
      }
      return c.pos.z < 10;
    }));
    
    // Passive score accumulation for surviving
    s.score += s.speed * 10 * delta * scoreMultiplier;
    onScore(Math.floor(s.score));
  });

  const targetX = (mouse.x * viewport.width) / 2;

  return (
    <>
      <color attach="background" args={["#050505"]} />
      <fog attach="fog" args={["#050505", 5, 40]} />
      
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      
      <MovingGrid speed={stateRef.current.speed} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />

      <Ship position={shipPos} targetX={targetX} traits={traits} />
      
      {obstacles.map(o => <Obstacle key={o.id} position={o.pos} onHit={() => {}} />)}
      {coins.map(c => <Coin key={c.id} position={c.pos} />)}
      
      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={0.2} mipmapBlur intensity={1.5} radius={0.5} />
        <ChromaticAberration offset={new THREE.Vector2(0.002, 0.002)} />
        <Noise opacity={0.05} />
        <Vignette eskil={false} offset={0.1} darkness={1.1} />
      </EffectComposer>
    </>
  );
}

export default function CosmicRunnerScene(props: GameProps) {
  return (
    <div className="absolute inset-0 w-full h-full">
      <Canvas shadows camera={{ position: [0, 2, 10], fov: 45 }}>
        <GameWorld {...props} />
      </Canvas>
    </div>
  );
}
