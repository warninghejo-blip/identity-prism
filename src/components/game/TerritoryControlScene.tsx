import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  type GameProps, type GameState, type AsteroidData, type BHole, type PowerUp, type PwrType,
  IS_MOBILE, HIT_R, NEAR_MISS_D, CAM_Z, SPAWN_R, DESPAWN_R,
  INIT_SPEED, MAX_SPEED, SPEED_GAIN, ANG_RATE, TAP_BOOST,
  BH_N, BH_STR, BH_CORE_R, BH_PUSH_STR, BH_DEFLECT_K, BH_SPAWN_INTERVAL,
  PWR_MAX, PWR_SPAWN_INTERVAL, PWR_PICKUP_R,
  SHIELD_DUR, SLOWMO_DUR, PHASE_DUR, COIN_BONUS, MAX_ASTEROIDS,
  TIER_COLORS, AST_TEX_PAIRS,
  resetAidN, resetPwIdN, rnd, clamp, slerp, normAng,
  spawnAst, spawnBH, spawnPowerUp,
  createAsteroidPool, createGeos,
  Cam, SpaceBG, Dust, BHVisuals, Ship, AsteroidInstances,
  Explosion, PowerUpVisuals, PickupEffect, FX, GameCanvas,
} from "./GameShared";

/* ═══════════════════════════════════════════════════
   Zone system
   ═══════════════════════════════════════════════════ */

interface CaptureZone {
  x: number; y: number;
  radius: number;
  life: number;
  maxLife: number;
  captureProgress: number; // 0-1, how much has been captured
  active: boolean;
  color: string;
  pointsPerSec: number;
}

const MAX_ZONES = 4;
const ZONE_RADIUS = 4;
const ZONE_MIN_LIFE = 12;
const ZONE_MAX_LIFE = 20;
const ZONE_SPAWN_INTERVAL = 6;
const ZONE_BASE_PPS = 3; // base points per second while inside
const ZONE_COLORS = ["#22d3ee", "#a855f7", "#22c55e", "#f59e0b"];

function spawnZone(sx: number, sy: number, idx: number): CaptureZone {
  const angle = rnd(0, 6.28);
  const dist = rnd(6, 16);
  return {
    x: sx + Math.cos(angle) * dist,
    y: sy + Math.sin(angle) * dist,
    radius: ZONE_RADIUS + rnd(-1, 1.5),
    life: 0,
    maxLife: rnd(ZONE_MIN_LIFE, ZONE_MAX_LIFE),
    captureProgress: 0,
    active: true,
    color: ZONE_COLORS[idx % ZONE_COLORS.length],
    pointsPerSec: ZONE_BASE_PPS + Math.floor(idx / MAX_ZONES),
  };
}

/* ═══════════════════════════════════════════════════
   Zone Visuals
   ═══════════════════════════════════════════════════ */

function ZoneVisuals({ zonesRef }: { zonesRef: React.MutableRefObject<CaptureZone[]> }) {
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const fillRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRefs = useRef<(THREE.Mesh | null)[]>([]);
  const pulseRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let i = 0; i < MAX_ZONES; i++) {
      const ring = ringRefs.current[i];
      const fill = fillRefs.current[i];
      const glow = glowRefs.current[i];
      const pulse = pulseRefs.current[i];
      const z = zonesRef.current[i];
      if (!ring || !fill || !glow || !pulse) continue;
      if (!z || !z.active) {
        ring.visible = false; fill.visible = false; glow.visible = false; pulse.visible = false;
        continue;
      }

      const fadeIn = Math.min(1, z.life * 1.5);
      const fadeOut = Math.min(1, (z.maxLife - z.life) * 1.5);
      const fade = Math.min(fadeIn, fadeOut);

      ring.visible = true; fill.visible = true; glow.visible = true; pulse.visible = true;
      ring.position.set(z.x, z.y, -.1);
      fill.position.set(z.x, z.y, -.15);
      glow.position.set(z.x, z.y, -.2);
      pulse.position.set(z.x, z.y, -.12);

      ring.scale.setScalar(z.radius);
      fill.scale.setScalar(z.radius * z.captureProgress);
      glow.scale.setScalar(z.radius * 1.3);

      const pulseScale = z.radius * (1 + Math.sin(t * 3 + i * 2) * .08);
      pulse.scale.setScalar(pulseScale);

      const col = z.color;
      (ring.material as THREE.MeshBasicMaterial).color.set(col);
      (ring.material as THREE.MeshBasicMaterial).opacity = fade * .5;
      (fill.material as THREE.MeshBasicMaterial).color.set(col);
      (fill.material as THREE.MeshBasicMaterial).opacity = fade * .08 * (1 + z.captureProgress * 2);
      (glow.material as THREE.MeshBasicMaterial).color.set(col);
      (glow.material as THREE.MeshBasicMaterial).opacity = fade * .04;
      (pulse.material as THREE.MeshBasicMaterial).color.set(col);
      (pulse.material as THREE.MeshBasicMaterial).opacity = fade * .12 * (.5 + Math.sin(t * 4 + i) * .5);
    }
  });

  return (<>{Array.from({ length: MAX_ZONES }).map((_, i) => (
    <React.Fragment key={i}>
      {/* Ring border */}
      <mesh ref={el => { ringRefs.current[i] = el; }} visible={false}>
        <ringGeometry args={[.92, 1, 64]} />
        <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Fill (grows with capture) */}
      <mesh ref={el => { fillRefs.current[i] = el; }} visible={false}>
        <circleGeometry args={[1, 48]} />
        <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Outer glow */}
      <mesh ref={el => { glowRefs.current[i] = el; }} visible={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Pulse ring */}
      <mesh ref={el => { pulseRefs.current[i] = el; }} visible={false}>
        <ringGeometry args={[.96, 1.02, 48]} />
        <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </React.Fragment>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Spawn asteroids TOWARD zones (directional targeting)
   ═══════════════════════════════════════════════════ */

function spawnAstTowardZone(el: number, zone: CaptureZone, sx: number, sy: number): AsteroidData | null {
  const small = Math.random() < .5;
  const r = small ? rnd(.4, .8) : rnd(1, 1.8);
  // Spawn from edge, aim toward zone
  const fromAngle = rnd(0, 6.28);
  const dist = SPAWN_R + rnd(2, 4);
  const startX = sx + Math.cos(fromAngle) * dist;
  const startY = sy + Math.sin(fromAngle) * dist;
  const toAngle = Math.atan2(zone.y - startY, zone.x - startX) + rnd(-.3, .3);
  const sp = (small ? rnd(5, 9) : rnd(3, 5.5)) * (1 + el * .015);
  return {
    id: 0, // will be assigned by pool
    x: startX, y: startY,
    vx: Math.cos(toAngle) * sp, vy: Math.sin(toAngle) * sp,
    r,
    rx: rnd(0, 6.28), ry: rnd(0, 6.28), rz: rnd(0, 6.28),
    rsx: rnd(-1.5, 1.5), rsy: rnd(-2, 2), rsz: rnd(-1.8, 1.8),
    sx: rnd(.88, 1.15), sy: rnd(.88, 1.15), sz: rnd(.88, 1.15),
    gi: Math.floor(rnd(0, 6)), mi: Math.floor(rnd(0, 4)), small,
    active: true,
    wobbleAmp: rnd(.3, 1.2), wobbleFreq: rnd(1.5, 3), wobblePhase: rnd(0, 6.28),
    spawnTime: el,
    hp: 1,
  };
}

/* ═══════════════════════════════════════════════════
   Game World — Territory Control
   ═══════════════════════════════════════════════════ */

export interface TerritorySessionStats {
  zonesCaptured: number;
  zonesDefended: number;
  maxSimultaneous: number;
}

interface TerritoryWorldProps extends Omit<GameProps, 'onGameOver'> {
  onGameOver: (score: number, coins: number, extraStats?: TerritorySessionStats) => void;
}

function TerritoryWorld({ gameState, onGameOver, onScore, onCoins, traits, shipSkin, shipStats }: TerritoryWorldProps) {
  const asteroidPool = useRef<AsteroidData[]>([]);
  useMemo(() => { asteroidPool.current = createAsteroidPool(); }, []);

  const shipPos = useRef({ x: 5, y: 0 });
  const shipHead = useRef(Math.PI / 2);
  const orbDir = useRef<1 | -1>(1);
  const headingBoost = useRef(0);
  const curSpeed = useRef(INIT_SPEED);
  const nearMiss = useRef(0);
  const bhs = useRef<BHole[]>([]);
  const bhTimer = useRef(0);
  const pws = useRef<PowerUp[]>([]);
  const pwTimer = useRef(0);
  const shieldT = useRef(0);
  const slowmoT = useRef(0);
  const phaseT = useRef(0);
  const elapsed = useRef(0);
  const spawnT = useRef(0);
  const overRef = useRef(false);
  const scoreRef = useRef(-1);
  const shake = useRef(0);
  const explPos = useRef({ x: 0, y: 0 });
  const explAct = useRef(false);
  const bonusPoints = useRef(0);
  const coinBank = useRef(0);
  const coinAccum = useRef(0);
  const pickupEffect = useRef({ active: false, type: "shield" as PwrType, x: 0, y: 0, t: 0 });

  // Territory-specific
  const zones = useRef<CaptureZone[]>([]);
  const zoneSpawnTimer = useRef(0);
  const zoneIdx = useRef(0);
  const captureAccum = useRef(0);
  const zonesFullyCaptured = useRef(0);
  // Session tracking for achievements
  const sessionCaptures = useRef(0);
  const sessionDefended = useRef(0);
  const maxSimultaneous = useRef(0);

  const sCol = traits?.planetTier ? TIER_COLORS[traits.planetTier] || "#22d3ee" : "#22d3ee";
  const sSc = traits?.planetTier === "binary_sun" ? 1.08 : 1;
  const geos = useMemo(createGeos, []);
  useEffect(() => () => { geos.forEach(g => g.dispose()); }, [geos]);

  // Controls: same as original Orbit Survival — tap to reverse direction
  useEffect(() => {
    if (gameState !== "playing") return;
    const rev = () => {
      orbDir.current = orbDir.current === 1 ? -1 : 1;
      headingBoost.current = TAP_BOOST * orbDir.current;
    };
    const onK = (e: KeyboardEvent) => { if (e.code === "Space" || e.key === " ") { e.preventDefault(); rev(); } };
    const onM = (e: MouseEvent) => { if (e.button === 0) rev(); };
    const onT = (e: TouchEvent) => { e.preventDefault(); rev(); };
    window.addEventListener("keydown", onK);
    window.addEventListener("mousedown", onM);
    window.addEventListener("touchstart", onT, { passive: false });
    return () => {
      window.removeEventListener("keydown", onK);
      window.removeEventListener("mousedown", onM);
      window.removeEventListener("touchstart", onT);
    };
  }, [gameState]);

  // Reset
  useEffect(() => {
    if (gameState !== "playing") return;
    resetAidN(); resetPwIdN();
    asteroidPool.current.forEach(a => { a.active = false; });
    zones.current = [];
    shipPos.current = { x: 5, y: 0 }; shipHead.current = Math.PI / 2;
    orbDir.current = 1; curSpeed.current = INIT_SPEED; nearMiss.current = 0; headingBoost.current = 0;
    bhs.current = [spawnBH(5, 0)]; bhTimer.current = 0;
    pws.current = []; pwTimer.current = 0;
    shieldT.current = 0; slowmoT.current = 0; phaseT.current = 0;
    bonusPoints.current = 0; coinBank.current = 0; coinAccum.current = 0;
    zoneSpawnTimer.current = 0; zoneIdx.current = 0; captureAccum.current = 0; zonesFullyCaptured.current = 0;
    sessionCaptures.current = 0; sessionDefended.current = 0; maxSimultaneous.current = 0;
    onCoins(0); elapsed.current = 0; spawnT.current = 0; physAccum.current = 0;
    overRef.current = false; scoreRef.current = -1; shake.current = 0; explAct.current = false;
    pickupEffect.current.active = false;
    onScore(0);

    // Spawn initial zone
    const firstZone = spawnZone(5, 0, 0);
    zones.current.push(firstZone);
    zoneIdx.current = 1;
  }, [gameState]);

  const physAccum = useRef(0);
  const PHYS_DT = IS_MOBILE ? 1 / 60 : 1 / 90;

  useFrame((_, delta) => {
    if (gameState !== "playing" || overRef.current) return;
    const frameDt = Math.min(delta, .1);
    physAccum.current += frameDt;
    if (physAccum.current > PHYS_DT * 4) physAccum.current = PHYS_DT * 4;

    while (physAccum.current >= PHYS_DT) {
      physAccum.current -= PHYS_DT;
      const dt = PHYS_DT;
      elapsed.current += dt;
      const el = elapsed.current;

      if (shieldT.current > 0) shieldT.current -= dt;
      if (slowmoT.current > 0) slowmoT.current -= dt;
      if (phaseT.current > 0) phaseT.current -= dt;

      const speedMult = 1 + (shipStats?.speed || 0) / 200;
      const tSpeed = clamp((INIT_SPEED + el * SPEED_GAIN * .8) * speedMult, INIT_SPEED, MAX_SPEED * .85 * speedMult);
      curSpeed.current = slerp(curSpeed.current, tSpeed, 3, dt);

      let heading = shipHead.current;
      let px = shipPos.current.x, py = shipPos.current.y;

      if (headingBoost.current !== 0) { heading += headingBoost.current; headingBoost.current = 0; }
      heading += ANG_RATE * orbDir.current * dt;

      // BH spawning & ship physics
      bhTimer.current += dt;
      if (bhTimer.current >= BH_SPAWN_INTERVAL * 1.5 && bhs.current.length < BH_N) {
        bhs.current.push(spawnBH(px, py)); bhTimer.current = 0;
      }
      const nextBH: BHole[] = [];
      for (const bh of bhs.current) {
        bh.life += dt;
        if (bh.life >= bh.maxLife) continue;
        const fadeIn = Math.min(1, bh.life * 1.2), fadeOut = Math.min(1, (bh.maxLife - bh.life) * 1.2), fade = Math.min(fadeIn, fadeOut);
        const dx = bh.x - px, dy = bh.y - py, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < BH_CORE_R) {
          const safeD = Math.max(0.05, dist);
          px += ((px - bh.x) / safeD) * BH_PUSH_STR * (1 - dist / BH_CORE_R) * dt;
          py += ((py - bh.y) / safeD) * BH_PUSH_STR * (1 - dist / BH_CORE_R) * dt;
          heading += normAng(Math.atan2((py - bh.y) / safeD, (px - bh.x) / safeD) - heading) * Math.min(1, 6 * dt);
          curSpeed.current = Math.min(curSpeed.current + bh.str * .5 * dt, MAX_SPEED * 1.25);
          shake.current = Math.max(shake.current, .4);
        } else {
          const angleToBH = Math.atan2(dy, dx);
          const cross = Math.cos(heading) * dy - Math.sin(heading) * dx;
          const perpAngle = angleToBH + (cross >= 0 ? 1 : -1) * Math.PI * 0.5;
          const safeDist = Math.max(2, dist);
          heading += normAng(perpAngle - heading) * bh.str * BH_DEFLECT_K / (safeDist * safeDist) * fade * dt;
          if (dist < 6) curSpeed.current = Math.min(curSpeed.current + bh.str * .08 * dt, MAX_SPEED * 1.1);
        }
        nextBH.push(bh);
      }
      bhs.current = nextBH;

      px += Math.cos(heading) * curSpeed.current * dt;
      py += Math.sin(heading) * curSpeed.current * dt;
      shipHead.current = heading; shipPos.current.x = px; shipPos.current.y = py;
    }

    // Frame-rate dependent
    const dt = frameDt;
    const el = elapsed.current;
    const px = shipPos.current.x, py = shipPos.current.y;
    const heading = shipHead.current;

    nearMiss.current = Math.max(0, nearMiss.current - dt * 3);

    // Zone spawning
    zoneSpawnTimer.current += dt;
    const activeZones = zones.current.filter(z => z.active).length;
    if (zoneSpawnTimer.current >= ZONE_SPAWN_INTERVAL && activeZones < MAX_ZONES) {
      const newZone = spawnZone(px, py, zoneIdx.current);
      const idx = zones.current.findIndex(z => !z.active);
      if (idx >= 0) zones.current[idx] = newZone;
      else if (zones.current.length < MAX_ZONES) zones.current.push(newZone);
      zoneIdx.current++;
      zoneSpawnTimer.current = 0;
    }

    // Zone lifecycle + capture logic
    let insideAnyZone = false;
    for (const z of zones.current) {
      if (!z.active) continue;
      z.life += dt;
      if (z.life >= z.maxLife) { z.active = false; continue; }

      // Check if ship is inside
      const dx = px - z.x, dy = py - z.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < z.radius) {
        insideAnyZone = true;
        const capSpeedBonus = 1 + (shipStats?.speed || 0) / 200; // faster capture with speed
        z.captureProgress = Math.min(1, z.captureProgress + dt * .15 * capSpeedBonus);

        // Points while inside
        const pps = z.pointsPerSec * (1 + z.captureProgress * 2);
        captureAccum.current += pps * dt;
        const wholePts = Math.floor(captureAccum.current);
        if (wholePts > 0) {
          bonusPoints.current += wholePts;
          captureAccum.current -= wholePts;
        }

        // Coins while capturing
        coinAccum.current += (1 + z.captureProgress * 3) * dt;
        const wholeCoins = Math.floor(coinAccum.current);
        if (wholeCoins > 0) {
          coinBank.current += wholeCoins;
          coinAccum.current -= wholeCoins;
          onCoins(coinBank.current);
        }

        // Fully captured bonus
        if (z.captureProgress >= 1 && z.life < z.maxLife - 1) {
          zonesFullyCaptured.current++;
          sessionCaptures.current++;
          bonusPoints.current += 50;
          coinBank.current += 20;
          onCoins(coinBank.current);
          z.active = false; // consumed
        }
      } else {
        // Slow decay when outside
        z.captureProgress = Math.max(0, z.captureProgress - dt * .05);
      }
    }

    // Track max simultaneous captured zones
    const capturedNow = zones.current.filter(z => z.active && z.captureProgress >= 0.8).length;
    if (capturedNow > maxSimultaneous.current) maxSimultaneous.current = capturedNow;

    // Score
    const sc = Math.floor(el) + bonusPoints.current;
    if (sc !== scoreRef.current) { scoreRef.current = sc; onScore(sc); }

    // Power-up spawning (luck = faster spawns)
    const luckFactor = 1 + (shipStats?.luck || 0) / 150;
    pwTimer.current += dt;
    if (pwTimer.current >= PWR_SPAWN_INTERVAL / luckFactor && pws.current.length < PWR_MAX) {
      pws.current.push(spawnPowerUp(px, py, heading)); pwTimer.current = 0;
    }
    const nextPW: PowerUp[] = [];
    for (const pw of pws.current) {
      pw.life += dt;
      if (pw.life >= pw.maxLife) continue;
      const pdx = pw.x - px, pdy = pw.y - py;
      if (Math.sqrt(pdx * pdx + pdy * pdy) < PWR_PICKUP_R) {
        const shdMult = 1 + (shipStats?.shield || 0) / 100;
        if (pw.type === "shield") shieldT.current = SHIELD_DUR * shdMult;
        else if (pw.type === "slowmo") slowmoT.current = SLOWMO_DUR;
        else if (pw.type === "phase") phaseT.current = PHASE_DUR;
        else if (pw.type === "coin") { bonusPoints.current += COIN_BONUS; coinBank.current += COIN_BONUS; onCoins(coinBank.current); onScore(Math.floor(el) + bonusPoints.current); }
        pickupEffect.current = { active: true, type: pw.type, x: px, y: py, t: 0 };
        shake.current = Math.max(shake.current, .3);
        continue;
      }
      nextPW.push(pw);
    }
    pws.current = nextPW;

    // Asteroid spawning — mix of random + zone-targeted
    spawnT.current += dt;
    const si = Math.max(.35, 1.6 - el * .01);
    if (spawnT.current >= si) {
      spawnT.current = 0;
      const activeZ = zones.current.filter(z => z.active);
      let spawned = 0;

      // 60% chance to target a zone, 40% random
      const targetZone = activeZ.length > 0 && Math.random() < .6;

      for (let i = 0; i < asteroidPool.current.length; i++) {
        if (spawned >= 1) break;
        const a = asteroidPool.current[i];
        if (!a.active) {
          if (targetZone) {
            const zone = activeZ[Math.floor(Math.random() * activeZ.length)];
            const newData = spawnAstTowardZone(el, zone, px, py);
            if (newData) { Object.assign(a, { ...newData, active: true }); spawned++; }
          } else {
            const newData = spawnAst(el, px, py);
            Object.assign(a, { ...newData, active: true });
            spawned++;
          }
        }
      }
    }

    // Asteroid physics
    const currentBHs = bhs.current;
    const isSlowMo = slowmoT.current > 0;
    const isPhase = phaseT.current > 0;
    const hasShield = shieldT.current > 0;
    const timeFactor = isSlowMo ? 0.45 : 1.0;
    const dtf = dt * timeFactor;
    const DESPAWN_R2 = DESPAWN_R * DESPAWN_R;
    const sx = shipPos.current.x, sy = shipPos.current.y;

    for (let i = 0; i < asteroidPool.current.length; i++) {
      const a = asteroidPool.current[i];
      if (!a.active) continue;

      let nvx = a.vx, nvy = a.vy;
      for (const bh of currentBHs) {
        const bdx = bh.x - a.x, bdy = bh.y - a.y, bd = Math.max(1, Math.sqrt(bdx * bdx + bdy * bdy));
        const bfadeIn = Math.min(1, bh.life * .6), bfadeOut = Math.min(1, (bh.maxLife - bh.life) * .6);
        const bf = bh.str * 6 / (bd * bd) * Math.min(bfadeIn, bfadeOut);
        nvx += (bdx / bd) * bf * dt; nvy += (bdy / bd) * bf * dt;
      }
      a.vx = nvx; a.vy = nvy;
      const age = el - a.spawnTime;
      const wob = a.wobbleAmp * Math.sin(age * a.wobbleFreq + a.wobblePhase);
      const spd2 = nvx * nvx + nvy * nvy;
      const invSpd = spd2 > .001 ? 1 / Math.sqrt(spd2) : 1;
      a.x += (nvx + (-nvy * invSpd) * wob) * dtf;
      a.y += (nvy + (nvx * invSpd) * wob) * dtf;
      a.rx += a.rsx * dtf; a.ry += a.rsy * dtf; a.rz += a.rsz * dtf;

      const dsx = a.x - sx, dsy = a.y - sy;
      const dd2 = dsx * dsx + dsy * dsy;
      if (dd2 > DESPAWN_R2) { a.active = false; continue; }

      // Ship collision
      const cd = HIT_R + a.r * .88;
      const nmOuter = cd + NEAR_MISS_D;
      if (dd2 < nmOuter * nmOuter && !isPhase) {
        if (dd2 < cd * cd) {
          if (hasShield) { shieldT.current = 0; shake.current = Math.max(shake.current, 1); a.active = false; continue; }
          overRef.current = true; shake.current = 2;
          explPos.current = { x: sx, y: sy }; explAct.current = true;
          onGameOver(Math.floor(el) + bonusPoints.current, coinBank.current, { zonesCaptured: sessionCaptures.current, zonesDefended: sessionCaptures.current, maxSimultaneous: maxSimultaneous.current });
          return;
        }
        nearMiss.current = Math.max(nearMiss.current, 1 - (Math.sqrt(dd2) - cd) / NEAR_MISS_D);
      }
    }
  });

  return (
    <>
      <color attach="background" args={["#080c1a"]} />
      <ambientLight intensity={.35} />
      <directionalLight intensity={.65} color="#93c5fd" position={[8, 10, 14]} />
      <directionalLight intensity={.32} color="#f8fafc" position={[-12, -8, 12]} />
      <Cam sPos={shipPos} shake={shake} gs={gameState} />
      <SpaceBG />
      <Dust />
      <BHVisuals bhRef={bhs} />
      <ZoneVisuals zonesRef={zones} />
      <Ship posRef={shipPos} headRef={shipHead} color={sCol} scale={sSc} nearRef={nearMiss} shieldRef={shieldT} phaseRef={phaseT} skinId={shipSkin} />
      <PowerUpVisuals pwRef={pws} />
      <PickupEffect pickupRef={pickupEffect} />
      <AsteroidInstances pool={asteroidPool} geos={geos} />
      <Explosion pRef={explPos} actRef={explAct} />
      <FX />
    </>
  );
}

export interface TerritoryControlSceneProps extends Omit<GameProps, 'onGameOver'> {
  onGameOver: (score: number, coins: number, extraStats?: TerritorySessionStats) => void;
}

export default function TerritoryControlScene(props: TerritoryControlSceneProps) {
  return (
    <GameCanvas>
      <TerritoryWorld {...props} />
    </GameCanvas>
  );
}
