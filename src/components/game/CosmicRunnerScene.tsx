import React, { useRef, useMemo, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { WalletTraits } from "@/hooks/useWalletData";

const IS_MOBILE = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
const MAX_ASTEROIDS = IS_MOBILE ? 120 : 200;

type GameState = "start" | "playing" | "gameover";
interface GameProps {
  onScore: (score: number) => void;
  onGameOver: (finalScore: number) => void;
  gameState: GameState;
  traits: WalletTraits | null;
  walletScore: number;
}

const TIER_COLORS: Record<string, string> = {
  mercury: "#94a3b8", mars: "#ef4444", venus: "#f97316", earth: "#10b981",
  neptune: "#3b82f6", uranus: "#06b6d4", saturn: "#eab308", jupiter: "#f59e0b",
  sun: "#facc15", binary_sun: "#ffffff",
};

const rand = (a: number, b: number) => Math.random() * (b - a) + a;
const FIELD = 14;
const HIT_R = 0.5;
const WELL_GRAV = 26;
const ASTEROID_R_MIN = 0.3;
const ASTEROID_R_MAX = 0.8;
const WELL_COLORS = ["#22d3ee", "#a855f7", "#f59e0b", "#f43f5e"];

interface Well { x: number; y: number; color: string; }
interface AsteroidData { x: number; y: number; vx: number; vy: number; r: number; rot: number; rotSpeed: number; alive: boolean; }

// ─── Reusable geometry + material (created once, shared) ─────
const _asteroidGeo = new THREE.DodecahedronGeometry(1, 0);
const _asteroidMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.38, 0.32) });
const _dummy = new THREE.Object3D();

// ─── Instanced Asteroids — single draw call for all asteroids ──
function AsteroidInstances({ asteroidsRef }: { asteroidsRef: React.MutableRefObject<AsteroidData[]> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const list = asteroidsRef.current;
    let count = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      _dummy.position.set(a.x, a.y, 0);
      _dummy.rotation.set(a.rot * 0.7, 0, a.rot);
      _dummy.scale.setScalar(a.r);
      _dummy.updateMatrix();
      mesh.setMatrixAt(count, _dummy.matrix);
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={meshRef} args={[_asteroidGeo, _asteroidMat, MAX_ASTEROIDS]} frustumCulled={false} />
  );
}

// ─── Ship visual (reads from refs, zero re-renders) ──
const ShipMesh = React.memo(function ShipMesh({ posRef, angleRef, color }: {
  posRef: React.MutableRefObject<{ x: number; y: number }>;
  angleRef: React.MutableRefObject<number>;
  color: string;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.set(posRef.current.x, posRef.current.y, 0);
    ref.current.rotation.z = angleRef.current - Math.PI / 2;
  });
  return (
    <group ref={ref}>
      <mesh>
        <coneGeometry args={[0.2, 0.7, 3]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, -0.45, 0]}>
        <sphereGeometry args={[0.12, 4, 4]} />
        <meshBasicMaterial color="#ff6b00" />
      </mesh>
      <mesh position={[0.3, -0.15, 0]} rotation={[0, 0, -0.3]}>
        <boxGeometry args={[0.4, 0.06, 0.12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[-0.3, -0.15, 0]} rotation={[0, 0, 0.3]}>
        <boxGeometry args={[0.4, 0.06, 0.12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
});

// ─── Boundary ring with warning ─────────────────────────────
function BoundaryRing({ shipPosRef }: { shipPosRef: React.MutableRefObject<{ x: number; y: number }> }) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (!matRef.current) return;
    const d = Math.sqrt(shipPosRef.current.x ** 2 + shipPosRef.current.y ** 2);
    const danger = Math.max(0, (d - FIELD * 0.65) / (FIELD * 0.35));
    matRef.current.opacity = 0.15 + danger * 0.5;
    matRef.current.color.setStyle(danger > 0.5 ? "#ff2244" : "#1e3a5f");
  });
  return (
    <mesh>
      <ringGeometry args={[FIELD - 0.08, FIELD + 0.08, IS_MOBILE ? 24 : 64]} />
      <meshBasicMaterial ref={matRef} color="#1e3a5f" transparent opacity={0.15} />
    </mesh>
  );
}

// ─── Gravity tether (line from ship to active well) ──
function GravityTether({ shipPosRef, wellsRef, activeWellRef }: {
  shipPosRef: React.MutableRefObject<{ x: number; y: number }>;
  wellsRef: React.MutableRefObject<Well[]>;
  activeWellRef: React.MutableRefObject<number>;
}) {
  const posAttr = useRef<THREE.BufferAttribute>(null);
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const positions = useMemo(() => new Float32Array(6), []);
  useFrame(() => {
    if (!posAttr.current || !matRef.current) return;
    const w = wellsRef.current[activeWellRef.current];
    if (!w) return;
    const arr = posAttr.current.array as Float32Array;
    arr[0] = shipPosRef.current.x; arr[1] = shipPosRef.current.y; arr[2] = 0;
    arr[3] = w.x; arr[4] = w.y; arr[5] = 0;
    posAttr.current.needsUpdate = true;
    matRef.current.color.setStyle(w.color);
  });
  return (
    // @ts-expect-error – R3F line primitive
    <line>
      <bufferGeometry>
        <bufferAttribute ref={posAttr} attach="attributes-position" args={[positions, 3]} count={2} />
      </bufferGeometry>
      <lineBasicMaterial ref={matRef} color="#22d3ee" transparent opacity={0.12} />
    </line>
  );
}

// ─── Gravity Well visual (simplified for mobile) ─────────────
function WellVisuals({ wellsRef, activeWellRef }: {
  wellsRef: React.MutableRefObject<Well[]>;
  activeWellRef: React.MutableRefObject<number>;
}) {
  const MAX_WELLS = 4;
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const coreMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const ringMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const outerMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  useFrame((state) => {
    const wells = wellsRef.current;
    const active = activeWellRef.current;
    for (let i = 0; i < MAX_WELLS; i++) {
      const g = groupRefs.current[i];
      if (!g) continue;
      if (i >= wells.length) { g.visible = false; continue; }
      g.visible = true;
      const w = wells[i];
      const isActive = i === active;
      g.position.set(w.x, w.y, 0);
      const s = isActive ? 1.0 + Math.sin(state.clock.elapsedTime * 5) * 0.12 : 0.5;
      g.scale.setScalar(s);
      const ring = ringRefs.current[i];
      if (ring) ring.rotation.z += isActive ? 0.03 : 0.005;
      const cm = coreMats.current[i];
      if (cm) { cm.color.setStyle(w.color); cm.opacity = isActive ? 1.0 : 0.2; }
      const rm = ringMats.current[i];
      if (rm) { rm.color.setStyle(w.color); rm.opacity = isActive ? 0.6 : 0.1; }
      const om = outerMats.current[i];
      if (om) { om.color.setStyle(w.color); om.opacity = isActive ? 0.25 : 0.05; }
    }
  });

  const segs = IS_MOBILE ? 12 : 32;
  return (
    <>
      {Array.from({ length: MAX_WELLS }, (_, i) => (
        <group key={i} ref={el => { groupRefs.current[i] = el; }} visible={false}>
          <mesh>
            <circleGeometry args={[0.4, segs]} />
            <meshBasicMaterial ref={el => { coreMats.current[i] = el; }} transparent />
          </mesh>
          <mesh ref={el => { ringRefs.current[i] = el; }}>
            <ringGeometry args={[0.6, 0.75, 6]} />
            <meshBasicMaterial ref={el => { ringMats.current[i] = el; }} transparent wireframe />
          </mesh>
          <mesh>
            <ringGeometry args={[1.0, 1.15, segs]} />
            <meshBasicMaterial ref={el => { outerMats.current[i] = el; }} transparent />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ─── Static star field (simple points, no drei Stars overhead) ──
function SimpleStars({ count }: { count: number }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 20 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = -5 - Math.random() * 25;
    }
    return arr;
  }, [count]);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
      </bufferGeometry>
      <pointsMaterial color="#aaccff" size={IS_MOBILE ? 0.15 : 0.1} transparent opacity={0.5} sizeAttenuation />
    </points>
  );
}

// ─── Background nebula grid (desktop only) ───────────────────
function NebulaGrid() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  useFrame((state) => { if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.elapsedTime; });
  const args = useMemo(() => ({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 20.0;
        float gx = step(0.95, fract(p.x));
        float gy = step(0.95, fract(p.y));
        float grid = max(gx, gy);
        float d = length(vUv - 0.5) * 2.0;
        float fade = 1.0 - smoothstep(0.3, 1.0, d);
        float pulse = 0.5 + 0.5 * sin(uTime * 0.3 + d * 3.0);
        float alpha = grid * fade * 0.06 * pulse;
        gl_FragColor = vec4(0.2, 0.5, 0.8, alpha);
      }`,
    transparent: true,
  }), []);
  return (
    <mesh position={[0, 0, -1]}>
      <planeGeometry args={[40, 40]} />
      <shaderMaterial ref={matRef} {...args} depthWrite={false} />
    </mesh>
  );
}

// ─── Main Game World (all physics in ONE useFrame, zero React state for per-frame data) ──
function GameWorld({ gameState, onGameOver, onScore, traits }: GameProps) {
  const shipPos = useRef({ x: 4, y: 0 });
  const shipVel = useRef({ x: 0, y: 6 });
  const shipAngle = useRef(Math.PI / 2);

  // Object Pool for asteroids to prevent GC
  // We allocate a fixed array of objects once and toggle 'alive' flag
  const poolSize = MAX_ASTEROIDS;
  const asteroidPool = useRef<AsteroidData[]>([]);
  // Initialize pool once
  useMemo(() => {
    asteroidPool.current = Array.from({ length: poolSize }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, r: 0, rot: 0, rotSpeed: 0, alive: false
    }));
  }, [poolSize]);

  // Wells also in refs
  const wellsRef = useRef<Well[]>([
    { x: -3.5, y: 0, color: WELL_COLORS[0] },
    { x: 4, y: 3, color: WELL_COLORS[1] },
  ]);
  const activeWellRef = useRef(0);

  const tierColor = traits?.planetTier ? TIER_COLORS[traits.planetTier] || "#06b6d4" : "#06b6d4";
  const scoreMult = useMemo(() => {
    let m = 1.0;
    if (traits?.isWhale) m += 0.15;
    if (traits?.isBlueChip) m += 0.1;
    if (traits?.planetTier === "binary_sun") m += 0.3;
    return m;
  }, [traits]);

  const gs = useRef({
    score: 0, elapsed: 0, gameOver: false,
    spawnTimer: 0, wellTimer: 0, difficulty: 1,
    wellMoveCount: 0, lastReportedScore: -1,
  });

  // Click/tap/space to switch gravity well
  useEffect(() => {
    if (gameState !== "playing") return;
    const handler = () => {
      activeWellRef.current = (activeWellRef.current + 1) % wellsRef.current.length;
    };
    const onKey = (e: KeyboardEvent) => { if (e.code === "Space" || e.key === " ") { e.preventDefault(); handler(); } };
    const onMouse = () => handler();
    const onTouch = () => handler();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("touchstart", onTouch, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("touchstart", onTouch);
    };
  }, [gameState]);

  // Reset
  useEffect(() => {
    if (gameState === "playing") {
      shipPos.current = { x: 4, y: 0 };
      shipVel.current = { x: 0, y: 6 };
      shipAngle.current = Math.PI / 2;
      
      // Reset pool
      for (const a of asteroidPool.current) a.alive = false;
      
      activeWellRef.current = 0;
      wellsRef.current = [
        { x: -3.5, y: 0, color: WELL_COLORS[0] },
        { x: 4, y: 3, color: WELL_COLORS[1] },
      ];
      gs.current = {
        score: 0, elapsed: 0, gameOver: false,
        spawnTimer: 0, wellTimer: 0, difficulty: 1,
        wellMoveCount: 0, lastReportedScore: -1,
      };
      onScore(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  // Store callbacks in refs to avoid stale closures
  const onScoreRef = useRef(onScore);
  onScoreRef.current = onScore;
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  // ─── SINGLE useFrame for ALL physics + asteroid management ───
  useFrame((_, delta) => {
    if (gameState !== "playing" || gs.current.gameOver) return;
    const dt = Math.min(delta, 0.033);
    const s = gs.current;
    s.elapsed += dt;
    s.difficulty = 1 + s.elapsed * 0.018;

    // Score = survival time (throttle reporting to ~4x/sec)
    s.score += dt * 10 * s.difficulty * scoreMult;
    const flooredScore = Math.floor(s.score);
    if (flooredScore !== s.lastReportedScore) {
      s.lastReportedScore = flooredScore;
      onScoreRef.current(flooredScore);
    }

    // Gravity pull toward active well
    const w = wellsRef.current[activeWellRef.current];
    if (w) {
      const dx = w.x - shipPos.current.x;
      const dy = w.y - shipPos.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.15) {
        const force = WELL_GRAV / Math.max(dist * dist, 0.8);
        shipVel.current.x += (dx / dist) * force * dt;
        shipVel.current.y += (dy / dist) * force * dt;
      }
    }

    // Damping + speed cap
    const damp = 0.9985;
    shipVel.current.x *= damp;
    shipVel.current.y *= damp;
    const spd = Math.sqrt(shipVel.current.x ** 2 + shipVel.current.y ** 2);
    const maxSpd = 15 + s.elapsed * 0.05;
    if (spd > maxSpd) {
      const ratio = maxSpd / spd;
      shipVel.current.x *= ratio;
      shipVel.current.y *= ratio;
    }

    // Move ship
    shipPos.current.x += shipVel.current.x * dt;
    shipPos.current.y += shipVel.current.y * dt;
    shipAngle.current = Math.atan2(shipVel.current.y, shipVel.current.x);

    // Boundary check
    const shipDist = Math.sqrt(shipPos.current.x ** 2 + shipPos.current.y ** 2);
    if (shipDist > FIELD) {
      s.gameOver = true;
      onGameOverRef.current(Math.floor(s.score));
      return;
    }

    // Spawn asteroids (using Object Pool)
    s.spawnTimer += dt;
    const spawnRate = Math.max(0.3, 1.8 - s.elapsed * 0.012);
    if (s.spawnTimer > spawnRate) {
      s.spawnTimer = 0;
      const count = s.elapsed > 40 ? (Math.random() < 0.3 ? 2 : 1) : 1;
      const pool = asteroidPool.current;
      let spawned = 0;
      for (let i = 0; i < pool.length && spawned < count; i++) {
        if (!pool[i].alive) {
          const angle = rand(0, Math.PI * 2);
          const spawnDist = FIELD + 2;
          const speed = rand(1.5, 3.5) * Math.sqrt(s.difficulty);
          const targetAngle = angle + Math.PI + rand(-0.6, 0.6);
          
          // Re-hydrate object in place
          const a = pool[i];
          a.x = Math.cos(angle) * spawnDist;
          a.y = Math.sin(angle) * spawnDist;
          a.vx = Math.cos(targetAngle) * speed;
          a.vy = Math.sin(targetAngle) * speed;
          a.r = rand(ASTEROID_R_MIN, ASTEROID_R_MAX);
          a.rot = 0;
          a.rotSpeed = rand(1, 4);
          a.alive = true;
          
          spawned++;
        }
      }
    }

    // Move wells periodically
    s.wellTimer += dt;
    const wellInterval = Math.max(5, 10 - s.elapsed * 0.04);
    if (s.wellTimer > wellInterval) {
      s.wellTimer = 0;
      s.wellMoveCount++;
      const safeRange = FIELD * 0.55;
      const wls = wellsRef.current;
      for (let i = 0; i < wls.length; i++) {
        wls[i].x = rand(-safeRange, safeRange);
        wls[i].y = rand(-safeRange, safeRange);
      }
      if (s.wellMoveCount >= 3 && wls.length < 3) {
        wls.push({ x: rand(-safeRange, safeRange), y: rand(-safeRange, safeRange), color: WELL_COLORS[2] });
      }
      if (s.wellMoveCount >= 6 && wls.length < 4) {
        wls.push({ x: rand(-safeRange, safeRange), y: rand(-safeRange, safeRange), color: WELL_COLORS[3] });
      }
    }

    // Move asteroids & check collisions
    const pool = asteroidPool.current;
    for (let i = 0; i < pool.length; i++) {
      const a = pool[i];
      if (!a.alive) continue;
      
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot += dt * a.rotSpeed;
      
      // Cull out-of-bounds (deactivate)
      if (a.x * a.x + a.y * a.y > (FIELD + 5) * (FIELD + 5)) {
        a.alive = false;
        continue;
      }
      
      // Collision check
      const cdx = a.x - shipPos.current.x;
      const cdy = a.y - shipPos.current.y;
      if (cdx * cdx + cdy * cdy < (HIT_R + a.r) * (HIT_R + a.r)) {
        s.gameOver = true;
        onGameOverRef.current(Math.floor(s.score));
        return;
      }
    }
  });

  return (
    <>
      <color attach="background" args={["#050510"]} />
      <ambientLight intensity={0.4} />
      <SimpleStars count={IS_MOBILE ? 150 : 2000} />
      {!IS_MOBILE && <NebulaGrid />}
      <BoundaryRing shipPosRef={shipPos} />
      <WellVisuals wellsRef={wellsRef} activeWellRef={activeWellRef} />
      <GravityTether shipPosRef={shipPos} wellsRef={wellsRef} activeWellRef={activeWellRef} />
      <ShipMesh posRef={shipPos} angleRef={shipAngle} color={tierColor} />
      <AsteroidInstances asteroidsRef={asteroidPool} />
    </>
  );
}

// ─── Limit frame rate on mobile to save battery & reduce heat ──
function FrameLimiter() {
  const { invalidate, gl } = useThree();
  useEffect(() => {
    if (!IS_MOBILE) return;
    // On mobile, cap to 30fps by using manual frame loop
    gl.setAnimationLoop(null);
    let raf = 0;
    let last = 0;
    const FPS = 30;
    const interval = 1000 / FPS;
    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      if (time - last < interval) return;
      last = time - ((time - last) % interval);
      invalidate();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [gl, invalidate]);
  return null;
}

const CosmicRunnerScene = React.memo(function CosmicRunnerScene(props: GameProps) {
  return (
    <div className="absolute inset-0 w-full h-full">
      <Suspense fallback={null}>
        <Canvas
          orthographic
          camera={{ zoom: 28, position: [0, 0, 50], near: 0.1, far: 100 }}
          gl={{ antialias: false, powerPreference: "high-performance", alpha: false }}
          dpr={IS_MOBILE ? [1, 1] : [1, 1.5]}
          frameloop="always"
        >
          <GameWorld {...props} />
        </Canvas>
      </Suspense>
    </div>
  );
});

export default CosmicRunnerScene;
