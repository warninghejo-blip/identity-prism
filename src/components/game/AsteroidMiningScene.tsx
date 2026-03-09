/**
 * Asteroid Mining — Idle/action hybrid.
 * Ship follows cursor, auto-fires laser at nearest asteroid to mine resources.
 * Resource types: Iron (1), Gold (3), Crystal (5), Dark Matter (10).
 * Dangers: explosive asteroids, pirate drones, radiation zones.
 * Stats: Speed=movement, Shield=HP, Firepower=laser speed, Luck=rare drops.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import {
  type GameProps, type GameState,
  IS_MOBILE, CAM_Z,
  rnd, clamp, slerp,
  SpaceBG, Dust, FX, GameCanvas,
  getShipTexturePath,
} from "./GameShared";

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */

type ResourceType = "iron" | "gold" | "crystal" | "dark_matter";
type AsteroidKind = "normal" | "explosive";

interface MineAsteroid {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  resource: ResourceType;
  kind: AsteroidKind;
  hp: number; maxHp: number;
  active: boolean;
  pulse: number;
  rx: number; ry: number; rz: number;
  rsx: number; rsy: number; rsz: number;
}

interface PirateDrone {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  hp: number;
  active: boolean;
}

/* ═══════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════ */

const PLAY_R = 20;
const SHIP_SPEED_BASE = 12;
const LASER_RANGE = 8;
const LASER_DPS_BASE = 1.5;  // damage per second
const MAX_ASTEROIDS = 40;
const MAX_PIRATES = 10;
const BASE_HP = 5;
const SPAWN_INTERVAL = 2.0;
const PIRATE_SPAWN_START = 90; // seconds before pirates appear
const PIRATE_SPEED = 5;
const PIRATE_HP = 2;
const PIRATE_DMG = 1;
const EXPLOSIVE_DMG = 2;

const RESOURCE_VALUES: Record<ResourceType, number> = {
  iron: 1, gold: 3, crystal: 5, dark_matter: 10,
};
const RESOURCE_COLORS: Record<ResourceType, string> = {
  iron: "#9ca3af", gold: "#fbbf24", crystal: "#22d3ee", dark_matter: "#a855f7",
};
const EXPLOSIVE_COLOR = "#ef4444";

let _aid = 0;
let _pid = 0;

/* ═══════════════════════════════════════════════════
   Ship Component (Mining variant)
   ═══════════════════════════════════════════════════ */

function MiningShip({ posRef, skinId }: {
  posRef: React.MutableRefObject<{ x: number; y: number }>;
  skinId?: string | null;
}) {
  const gRef = useRef<THREE.Group>(null);
  const texPath = getShipTexturePath(skinId);
  const shipTex = useLoader(THREE.TextureLoader, texPath);
  if (shipTex.minFilter !== THREE.LinearFilter) {
    shipTex.minFilter = THREE.LinearFilter;
    shipTex.magFilter = THREE.LinearFilter;
    shipTex.generateMipmaps = false;
    shipTex.needsUpdate = true;
  }

  useFrame((_, delta) => {
    if (!gRef.current) return;
    const dt = Math.min(delta, .033);
    gRef.current.position.x = slerp(gRef.current.position.x, posRef.current.x, 12, dt);
    gRef.current.position.y = slerp(gRef.current.position.y, posRef.current.y, 12, dt);
  });

  return (
    <group ref={gRef}>
      <mesh>
        <planeGeometry args={[1.6, 2.2]} />
        <meshBasicMaterial map={shipTex} transparent alphaTest={0.01} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, .15, .03]}>
        <sphereGeometry args={[.15, 8, 8]} />
        <meshBasicMaterial color="#00eeff" transparent opacity={.25} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {!IS_MOBILE && <pointLight intensity={3} color="#0088ff" distance={8} />}
    </group>
  );
}

/* ═══════════════════════════════════════════════════
   Laser Beam
   ═══════════════════════════════════════════════════ */

function LaserBeam({ from, to, active, color }: {
  from: React.MutableRefObject<{ x: number; y: number }>;
  to: React.MutableRefObject<{ x: number; y: number }>;
  active: React.MutableRefObject<boolean>;
  color: string;
}) {
  const lineObj = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    return line;
  }, [color]);

  useFrame(() => {
    lineObj.visible = active.current;
    if (active.current) {
      const pos = lineObj.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      arr[0] = from.current.x; arr[1] = from.current.y; arr[2] = 0;
      arr[3] = to.current.x; arr[4] = to.current.y; arr[5] = 0;
      pos.needsUpdate = true;
    }
  });

  useEffect(() => () => { lineObj.geometry.dispose(); (lineObj.material as THREE.Material).dispose(); }, [lineObj]);

  return <primitive object={lineObj} />;
}

/* ═══════════════════════════════════════════════════
   Asteroid Visuals (instanced)
   ═══════════════════════════════════════════════════ */

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

function MineAsteroidVisuals({ poolRef }: { poolRef: React.MutableRefObject<MineAsteroid[]> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3, transparent: false }), []);

  useFrame((s) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = s.clock.elapsedTime;
    let count = 0;
    for (const a of poolRef.current) {
      if (!a.active) continue;
      _dummy.position.set(a.x, a.y, 0);
      _dummy.rotation.set(a.rx, a.ry, a.rz);
      _dummy.scale.setScalar(a.r);
      _dummy.updateMatrix();
      mesh.setMatrixAt(count, _dummy.matrix);
      const col = a.kind === "explosive"
        ? EXPLOSIVE_COLOR
        : RESOURCE_COLORS[a.resource];
      const pulse = a.kind === "explosive" ? 0.5 + Math.sin(t * 4 + a.id) * 0.5 : 1;
      _color.set(col).multiplyScalar(pulse);
      mesh.setColorAt(count, _color);
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geo, mat, MAX_ASTEROIDS]} frustumCulled={false} />;
}

/* ═══════════════════════════════════════════════════
   Pirate Visuals
   ═══════════════════════════════════════════════════ */

function PirateVisuals({ poolRef }: { poolRef: React.MutableRefObject<PirateDrone[]> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.OctahedronGeometry(0.5, 0), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ff4444", roughness: 0.5, metalness: 0.6, emissive: "#ff2222", emissiveIntensity: 0.3 }), []);

  useFrame((s) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = s.clock.elapsedTime;
    let count = 0;
    for (const p of poolRef.current) {
      if (!p.active) continue;
      _dummy.position.set(p.x, p.y, 0);
      _dummy.rotation.set(0, t * 2 + p.id, 0);
      _dummy.scale.setScalar(0.6);
      _dummy.updateMatrix();
      mesh.setMatrixAt(count, _dummy.matrix);
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geo, mat, MAX_PIRATES]} frustumCulled={false} />;
}

/* ═══════════════════════════════════════════════════
   Game World
   ═══════════════════════════════════════════════════ */

export interface MiningSessionStats {
  asteroidsMined: number;
  darkMatter: number;
  piratesDestroyed: number;
}

interface MiningWorldProps extends Omit<GameProps, 'onGameOver'> {
  onGameOver: (score: number, coins: number, extraStats?: MiningSessionStats) => void;
}

function MiningWorld({ gameState, onScore, onCoins, onGameOver, traits, hasMintedId, shipSkin, shipStats }: MiningWorldProps) {
  const coinMult = hasMintedId ? 2 : 1;
  const shipPos = useRef({ x: 0, y: 0 });
  const targetPos = useRef({ x: 0, y: 0 });
  const laserTarget = useRef({ x: 0, y: 0 });
  const laserActive = useRef(false);
  const asteroids = useRef<MineAsteroid[]>([]);
  const pirates = useRef<PirateDrone[]>([]);
  const elapsed = useRef(0);
  const spawnTimer = useRef(0);
  const pirateSpawnTimer = useRef(0);
  const overRef = useRef(false);
  const scoreRef = useRef(0);
  const coinBank = useRef(0);
  const coinAccum = useRef(0);
  const hpRef = useRef(BASE_HP);
  const miningTarget = useRef<number>(-1);
  const sessionMined = useRef(0);
  const sessionDarkMatter = useRef(0);
  const sessionPirates = useRef(0);

  // Stats-derived values
  const shipSpeed = SHIP_SPEED_BASE * (1 + (shipStats?.speed || 0) / 200);
  const maxHp = BASE_HP + Math.floor((shipStats?.shield || 0) / 20);
  const laserDps = LASER_DPS_BASE * (1 + (shipStats?.firepower || 0) / 150);
  const luckMult = 1 + (shipStats?.luck || 0) / 100; // affects resource type rolls

  // Mouse/touch tracking
  useEffect(() => {
    if (gameState !== "playing") return;
    const onMove = (e: MouseEvent) => {
      // Convert screen coords to world coords (approximate)
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      targetPos.current.x = nx * 16;
      targetPos.current.y = ny * 12;
    };
    const onTouch = (e: TouchEvent) => {
      e.preventDefault();
      const canvas = document.querySelector('canvas');
      if (!canvas || !e.touches[0]) return;
      const rect = canvas.getBoundingClientRect();
      const nx = ((e.touches[0].clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.touches[0].clientY - rect.top) / rect.height) * 2 + 1;
      targetPos.current.x = nx * 16;
      targetPos.current.y = ny * 12;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onTouch, { passive: false });
    window.addEventListener("touchstart", onTouch, { passive: false });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchstart", onTouch);
    };
  }, [gameState]);

  // Reset
  useEffect(() => {
    if (gameState !== "playing") return;
    _aid = 0; _pid = 0;
    asteroids.current = [];
    pirates.current = [];
    shipPos.current = { x: 0, y: 0 };
    targetPos.current = { x: 0, y: 0 };
    elapsed.current = 0; spawnTimer.current = 0; pirateSpawnTimer.current = 0;
    overRef.current = false; scoreRef.current = 0; coinBank.current = 0; coinAccum.current = 0;
    hpRef.current = maxHp;
    miningTarget.current = -1;
    sessionMined.current = 0; sessionDarkMatter.current = 0; sessionPirates.current = 0;
    laserActive.current = false;
    onScore(0); onCoins(0);
  }, [gameState]);

  useFrame((_, delta) => {
    if (gameState !== "playing" || overRef.current) return;
    const dt = Math.min(delta, .05);
    elapsed.current += dt;
    const el = elapsed.current;

    // Move ship toward target
    const dx = targetPos.current.x - shipPos.current.x;
    const dy = targetPos.current.y - shipPos.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.5) {
      const moveAmt = Math.min(shipSpeed * dt, dist);
      shipPos.current.x += (dx / dist) * moveAmt;
      shipPos.current.y += (dy / dist) * moveAmt;
    }

    // Clamp to play area
    const pLen = Math.sqrt(shipPos.current.x ** 2 + shipPos.current.y ** 2);
    if (pLen > PLAY_R) {
      shipPos.current.x *= PLAY_R / pLen;
      shipPos.current.y *= PLAY_R / pLen;
    }

    // Spawn asteroids
    spawnTimer.current += dt;
    const spawnInt = Math.max(0.5, SPAWN_INTERVAL - el * 0.005);
    if (spawnTimer.current >= spawnInt && asteroids.current.filter(a => a.active).length < MAX_ASTEROIDS) {
      const angle = rnd(0, Math.PI * 2);
      const spawnDist = PLAY_R + 3;

      // Resource type based on luck + time
      const roll = Math.random() * 100;
      const rareBoost = luckMult;
      let resource: ResourceType;
      if (roll < 2 * rareBoost && el > 60) resource = "dark_matter";
      else if (roll < 10 * rareBoost) resource = "crystal";
      else if (roll < 30 * rareBoost) resource = "gold";
      else resource = "iron";

      // Explosive asteroids (appear after 30s)
      const isExplosive = el > 30 && Math.random() < Math.min(0.25, 0.05 + el * 0.001);

      asteroids.current.push({
        id: ++_aid,
        x: Math.cos(angle) * spawnDist,
        y: Math.sin(angle) * spawnDist,
        vx: -Math.cos(angle) * rnd(0.5, 2),
        vy: -Math.sin(angle) * rnd(0.5, 2),
        r: rnd(0.5, 1.2),
        resource,
        kind: isExplosive ? "explosive" : "normal",
        hp: isExplosive ? 1 : (resource === "dark_matter" ? 5 : resource === "crystal" ? 3 : resource === "gold" ? 2 : 1),
        maxHp: isExplosive ? 1 : (resource === "dark_matter" ? 5 : resource === "crystal" ? 3 : resource === "gold" ? 2 : 1),
        active: true,
        pulse: 0,
        rx: rnd(0, 6.28), ry: rnd(0, 6.28), rz: rnd(0, 6.28),
        rsx: rnd(-1, 1), rsy: rnd(-1, 1), rsz: rnd(-1, 1),
      });
      spawnTimer.current = 0;
    }

    // Spawn pirates
    if (el > PIRATE_SPAWN_START) {
      pirateSpawnTimer.current += dt;
      const pirateInt = Math.max(3, 8 - (el - PIRATE_SPAWN_START) * 0.02);
      if (pirateSpawnTimer.current >= pirateInt && pirates.current.filter(p => p.active).length < MAX_PIRATES) {
        const angle = rnd(0, Math.PI * 2);
        pirates.current.push({
          id: ++_pid,
          x: Math.cos(angle) * (PLAY_R + 5),
          y: Math.sin(angle) * (PLAY_R + 5),
          vx: 0, vy: 0,
          hp: PIRATE_HP,
          active: true,
        });
        pirateSpawnTimer.current = 0;
      }
    }

    // Update asteroids
    for (const a of asteroids.current) {
      if (!a.active) continue;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rx += a.rsx * dt;
      a.ry += a.rsy * dt;
      a.rz += a.rsz * dt;
      a.pulse += dt;
      // Despawn far asteroids
      if (Math.sqrt(a.x * a.x + a.y * a.y) > PLAY_R + 10) a.active = false;
    }

    // Update pirates — chase ship
    const sx = shipPos.current.x, sy = shipPos.current.y;
    for (const p of pirates.current) {
      if (!p.active) continue;
      const pdx = sx - p.x, pdy = sy - p.y;
      const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
      if (pDist > 0.5) {
        p.x += (pdx / pDist) * PIRATE_SPEED * dt;
        p.y += (pdy / pDist) * PIRATE_SPEED * dt;
      }
      // Pirate hits ship
      if (pDist < 1.2) {
        p.active = false;
        hpRef.current -= PIRATE_DMG;
        if (hpRef.current <= 0) {
          overRef.current = true;
          onGameOver(scoreRef.current, coinBank.current, { asteroidsMined: sessionMined.current, darkMatter: sessionDarkMatter.current, piratesDestroyed: sessionPirates.current });
          return;
        }
      }
    }

    // Auto-laser: find nearest minable asteroid within range
    let nearestId = -1;
    let nearestDist = LASER_RANGE;
    for (const a of asteroids.current) {
      if (!a.active) continue;
      const adx = a.x - sx, ady = a.y - sy;
      const aDist = Math.sqrt(adx * adx + ady * ady);
      if (aDist < nearestDist) {
        nearestDist = aDist;
        nearestId = a.id;
      }
    }

    // Also target pirates if in range
    for (const p of pirates.current) {
      if (!p.active) continue;
      const pdx = p.x - sx, pdy = p.y - sy;
      const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
      if (pDist < nearestDist) {
        nearestDist = pDist;
        nearestId = -p.id; // negative = pirate
      }
    }

    if (nearestId > 0) {
      // Mining asteroid
      const target = asteroids.current.find(a => a.id === nearestId && a.active);
      if (target) {
        laserTarget.current = { x: target.x, y: target.y };
        laserActive.current = true;
        target.hp -= laserDps * dt;

        if (target.hp <= 0) {
          target.active = false;
          sessionMined.current++;

          if (target.kind === "explosive") {
            // Explosive asteroid damages player
            hpRef.current -= EXPLOSIVE_DMG;
            if (hpRef.current <= 0) {
              overRef.current = true;
              onGameOver(scoreRef.current, coinBank.current, { asteroidsMined: sessionMined.current, darkMatter: sessionDarkMatter.current, piratesDestroyed: sessionPirates.current });
              return;
            }
          } else {
            // Collect resources
            const value = RESOURCE_VALUES[target.resource] * coinMult;
            coinBank.current += value;
            onCoins(coinBank.current);
            if (target.resource === "dark_matter") sessionDarkMatter.current++;
          }
        }
      } else {
        laserActive.current = false;
      }
    } else if (nearestId < 0) {
      // Attack pirate
      const target = pirates.current.find(p => p.id === -nearestId && p.active);
      if (target) {
        laserTarget.current = { x: target.x, y: target.y };
        laserActive.current = true;
        target.hp -= laserDps * 1.5 * dt; // laser is effective against pirates

        if (target.hp <= 0) {
          target.active = false;
          sessionPirates.current++;
          coinBank.current += 5 * coinMult;
          onCoins(coinBank.current);
        }
      } else {
        laserActive.current = false;
      }
    } else {
      laserActive.current = false;
    }

    // Score = survival time
    const sc = Math.floor(el);
    if (sc !== scoreRef.current) {
      scoreRef.current = sc;
      onScore(sc);
    }

    // Passive coin accumulation
    const coinsPerSec = (0.5 + Math.floor(el / 30) * 0.5) * coinMult;
    coinAccum.current += coinsPerSec * dt;
    const wholeCoins = Math.floor(coinAccum.current);
    if (wholeCoins > 0) {
      coinBank.current += wholeCoins;
      coinAccum.current -= wholeCoins;
      onCoins(coinBank.current);
    }

    // Cleanup inactive
    asteroids.current = asteroids.current.filter(a => a.active);
    pirates.current = pirates.current.filter(p => p.active);
  });

  return (
    <>
      <color attach="background" args={["#060812"]} />
      <ambientLight intensity={0.4} />
      <directionalLight intensity={0.6} color="#93c5fd" position={[8, 10, 14]} />
      <SpaceBG />
      <Dust />
      <MiningShip posRef={shipPos} skinId={shipSkin} />
      <LaserBeam from={shipPos} to={laserTarget} active={laserActive} color="#00ff88" />
      <MineAsteroidVisuals poolRef={asteroids} />
      <PirateVisuals poolRef={pirates} />
      <FX />
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════ */

export interface AsteroidMiningSceneProps extends Omit<GameProps, 'onGameOver'> {
  onGameOver: (score: number, coins: number, extraStats?: MiningSessionStats) => void;
}

export default function AsteroidMiningScene(props: AsteroidMiningSceneProps) {
  return (
    <GameCanvas>
      <MiningWorld {...props} />
    </GameCanvas>
  );
}
