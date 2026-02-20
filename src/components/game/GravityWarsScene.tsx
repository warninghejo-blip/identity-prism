import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  type GameProps, type GameState, type AsteroidData, type BHole, type PowerUp, type PwrType,
  type SmallExplosion,
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
  Explosion, PowerUpVisuals, PickupEffect, SmallExplosions, FX, GameCanvas,
} from "./GameShared";

/* ═══════════════════════════════════════════════════
   Impulse Wave system
   ═══════════════════════════════════════════════════ */

interface ImpulseWave {
  x: number; y: number;
  radius: number;
  maxRadius: number;
  strength: number;
  life: number;
  active: boolean;
}

const IMPULSE_COOLDOWN = 2.5;
const IMPULSE_STRENGTH = 28;
const IMPULSE_MAX_RADIUS = 14;
const IMPULSE_SPEED = 35;
const AST_COLLISION_R_MULT = 1.2;
const MAX_WAVES = 5;

/* ═══════════════════════════════════════════════════
   Impulse Wave Visuals — expanding ring
   ═══════════════════════════════════════════════════ */

function ImpulseWaveVisuals({ wavesRef, color }: { wavesRef: React.MutableRefObject<ImpulseWave[]>; color: string }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(() => {
    for (let i = 0; i < MAX_WAVES; i++) {
      const ring = refs.current[i];
      const glow = glowRefs.current[i];
      const w = wavesRef.current[i];
      if (!ring || !glow) continue;
      if (!w || !w.active) { ring.visible = false; glow.visible = false; continue; }
      ring.visible = true; glow.visible = true;
      ring.position.set(w.x, w.y, 0);
      glow.position.set(w.x, w.y, 0);
      const progress = w.radius / w.maxRadius;
      const fade = 1 - progress;
      ring.scale.setScalar(w.radius);
      glow.scale.setScalar(w.radius * 1.2);
      (ring.material as THREE.MeshBasicMaterial).opacity = fade * .6;
      (glow.material as THREE.MeshBasicMaterial).opacity = fade * .15;
    }
  });

  return (<>{Array.from({ length: MAX_WAVES }).map((_, i) => (
    <React.Fragment key={i}>
      <mesh ref={el => { refs.current[i] = el; }} visible={false}>
        <ringGeometry args={[.9, 1, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={el => { glowRefs.current[i] = el; }} visible={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </React.Fragment>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Chain reaction visual — line between colliding asteroids
   ═══════════════════════════════════════════════════ */

interface ChainFlash {
  x1: number; y1: number; x2: number; y2: number;
  t: number; active: boolean;
}

function ChainFlashVisuals({ poolRef }: { poolRef: React.MutableRefObject<ChainFlash[]> }) {
  const MAX = 8;
  const refs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, .033);
    for (let i = 0; i < MAX; i++) {
      const m = refs.current[i];
      const c = poolRef.current[i];
      if (!m) continue;
      if (!c || !c.active) { m.visible = false; continue; }
      c.t += dt;
      if (c.t > .5) { c.active = false; m.visible = false; continue; }
      m.visible = true;
      const mx = (c.x1 + c.x2) / 2, my = (c.y1 + c.y2) / 2;
      const dx = c.x2 - c.x1, dy = c.y2 - c.y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      m.position.set(mx, my, .1);
      m.rotation.z = angle;
      m.scale.set(len, .15 + (1 - c.t / .5) * .3, 1);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - c.t / .4);
    }
  });

  return (<>{Array.from({ length: MAX }).map((_, i) => (
    <mesh key={i} ref={el => { refs.current[i] = el; }} visible={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color="#ffaa44" transparent opacity={1} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Game World — Gravity Wars
   ═══════════════════════════════════════════════════ */

function GravityWorld({ gameState, onGameOver, onScore, onCoins, traits }: GameProps) {
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

  // Gravity Wars specific
  const impulseWaves = useRef<ImpulseWave[]>([]);
  const impulseCooldown = useRef(0);
  const chainFlashes = useRef<ChainFlash[]>([]);
  const chainCount = useRef(0);
  const chainTimer = useRef(0);
  const smallExplosions = useRef<SmallExplosion[]>([]);
  const totalDestroyed = useRef(0);

  const sCol = traits?.planetTier ? TIER_COLORS[traits.planetTier] || "#22d3ee" : "#22d3ee";
  const sSc = traits?.planetTier === "binary_sun" ? 1.08 : 1;
  const geos = useMemo(createGeos, []);
  useEffect(() => () => { geos.forEach(g => g.dispose()); }, [geos]);

  // Controls: tap = impulse wave, double-tap = reverse direction
  useEffect(() => {
    if (gameState !== "playing") return;
    let lastTap = 0;

    const fireImpulse = () => {
      if (impulseCooldown.current > 0) return;
      const wave: ImpulseWave = {
        x: shipPos.current.x, y: shipPos.current.y,
        radius: 0, maxRadius: IMPULSE_MAX_RADIUS,
        strength: IMPULSE_STRENGTH,
        life: 0, active: true,
      };
      const idx = impulseWaves.current.findIndex(w => !w.active);
      if (idx >= 0) impulseWaves.current[idx] = wave;
      else if (impulseWaves.current.length < MAX_WAVES) impulseWaves.current.push(wave);
      impulseCooldown.current = IMPULSE_COOLDOWN;
      shake.current = Math.max(shake.current, .3);
    };

    const rev = () => {
      orbDir.current = orbDir.current === 1 ? -1 : 1;
      headingBoost.current = TAP_BOOST * orbDir.current;
    };

    const onK = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") { e.preventDefault(); fireImpulse(); }
      else if (e.code === "KeyD" || e.code === "ArrowRight" || e.code === "ArrowLeft" || e.code === "KeyA") { rev(); }
    };
    const onM = (e: MouseEvent) => {
      if (e.button === 0) fireImpulse();
      else if (e.button === 2) { e.preventDefault(); rev(); }
    };
    const onT = (e: TouchEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastTap < 300) { rev(); lastTap = 0; }
      else { fireImpulse(); lastTap = now; }
    };
    const onCtx = (e: Event) => e.preventDefault();

    window.addEventListener("keydown", onK);
    window.addEventListener("mousedown", onM);
    window.addEventListener("touchstart", onT, { passive: false });
    window.addEventListener("contextmenu", onCtx);
    return () => {
      window.removeEventListener("keydown", onK);
      window.removeEventListener("mousedown", onM);
      window.removeEventListener("touchstart", onT);
      window.removeEventListener("contextmenu", onCtx);
    };
  }, [gameState]);

  // Reset
  useEffect(() => {
    if (gameState !== "playing") return;
    resetAidN(); resetPwIdN();
    asteroidPool.current.forEach(a => { a.active = false; });
    impulseWaves.current = [];
    chainFlashes.current = [];
    smallExplosions.current = [];
    shipPos.current = { x: 5, y: 0 }; shipHead.current = Math.PI / 2;
    orbDir.current = 1; curSpeed.current = INIT_SPEED; nearMiss.current = 0; headingBoost.current = 0;
    bhs.current = [spawnBH(5, 0)]; bhTimer.current = 0;
    pws.current = []; pwTimer.current = 0;
    shieldT.current = 0; slowmoT.current = 0; phaseT.current = 0;
    bonusPoints.current = 0; coinBank.current = 0; coinAccum.current = 0;
    impulseCooldown.current = 0; chainCount.current = 0; chainTimer.current = 0; totalDestroyed.current = 0;
    onCoins(0); elapsed.current = 0; spawnT.current = 0; physAccum.current = 0;
    overRef.current = false; scoreRef.current = -1; shake.current = 0; explAct.current = false;
    pickupEffect.current.active = false;
    onScore(0);
  }, [gameState]);

  const physAccum = useRef(0);
  const PHYS_DT = 1 / 90;

  useFrame((_, delta) => {
    if (gameState !== "playing" || overRef.current) return;
    const frameDt = Math.min(delta, .1);
    physAccum.current += frameDt;
    if (physAccum.current > PHYS_DT * 6) physAccum.current = PHYS_DT * 6;

    while (physAccum.current >= PHYS_DT) {
      physAccum.current -= PHYS_DT;
      const dt = PHYS_DT;
      elapsed.current += dt;
      const el = elapsed.current;

      if (shieldT.current > 0) shieldT.current -= dt;
      if (slowmoT.current > 0) slowmoT.current -= dt;
      if (phaseT.current > 0) phaseT.current -= dt;
      if (impulseCooldown.current > 0) impulseCooldown.current -= dt;

      // Chain combo decay
      if (chainTimer.current > 0) {
        chainTimer.current -= dt;
        if (chainTimer.current <= 0) chainCount.current = 0;
      }

      const tSpeed = clamp(INIT_SPEED + el * SPEED_GAIN, INIT_SPEED, MAX_SPEED);
      curSpeed.current = slerp(curSpeed.current, tSpeed, 3, dt);

      let heading = shipHead.current;
      let px = shipPos.current.x, py = shipPos.current.y;

      if (headingBoost.current !== 0) { heading += headingBoost.current; headingBoost.current = 0; }
      heading += ANG_RATE * orbDir.current * dt;

      // BH spawning & ship physics
      bhTimer.current += dt;
      if (bhTimer.current >= BH_SPAWN_INTERVAL && bhs.current.length < BH_N) {
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

      // Impulse wave expansion
      for (const w of impulseWaves.current) {
        if (!w.active) continue;
        w.radius += IMPULSE_SPEED * dt;
        w.life += dt;
        if (w.radius >= w.maxRadius) { w.active = false; }
      }

      // Impulse wave → asteroid push
      for (const w of impulseWaves.current) {
        if (!w.active) continue;
        const waveInner = Math.max(0, w.radius - 2);
        const waveOuter = w.radius;
        for (let i = 0; i < asteroidPool.current.length; i++) {
          const a = asteroidPool.current[i];
          if (!a.active) continue;
          const dx = a.x - w.x, dy = a.y - w.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= waveInner && d <= waveOuter + 1) {
            const falloff = 1 - clamp((d - waveInner) / (waveOuter - waveInner + 1), 0, 1);
            const force = w.strength * falloff * dt;
            const nd = Math.max(.1, d);
            a.vx += (dx / nd) * force;
            a.vy += (dy / nd) * force;
          }
        }
      }
    }

    // Frame-rate dependent
    const dt = frameDt;
    const el = elapsed.current;
    const px = shipPos.current.x, py = shipPos.current.y;
    const heading = shipHead.current;

    const sc = Math.floor(el) + bonusPoints.current;
    if (sc !== scoreRef.current) { scoreRef.current = sc; onScore(sc); }

    const coinsPerSec = 1 + Math.floor(el / 30);
    coinAccum.current += coinsPerSec * dt;
    const wholeCoins = Math.floor(coinAccum.current);
    if (wholeCoins > 0) { coinBank.current += wholeCoins; coinAccum.current -= wholeCoins; onCoins(coinBank.current); }

    nearMiss.current = Math.max(0, nearMiss.current - dt * 3);

    // Power-up spawning
    pwTimer.current += dt;
    if (pwTimer.current >= PWR_SPAWN_INTERVAL && pws.current.length < PWR_MAX) {
      pws.current.push(spawnPowerUp(px, py, heading)); pwTimer.current = 0;
    }
    const nextPW: PowerUp[] = [];
    for (const pw of pws.current) {
      pw.life += dt;
      if (pw.life >= pw.maxLife) continue;
      const pdx = pw.x - px, pdy = pw.y - py;
      if (Math.sqrt(pdx * pdx + pdy * pdy) < PWR_PICKUP_R) {
        if (pw.type === "shield") shieldT.current = SHIELD_DUR;
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

    // Asteroid spawning — slightly denser for gravity wars
    spawnT.current += dt;
    const si = Math.max(.25, 1.2 - el * .014);
    if (spawnT.current >= si) {
      spawnT.current = 0;
      const wc = el > 20 && Math.random() < .4 ? 2 : 1;
      let spawned = 0;
      for (let i = 0; i < asteroidPool.current.length; i++) {
        if (spawned >= wc) break;
        const a = asteroidPool.current[i];
        if (!a.active) {
          const newData = spawnAst(el, px, py);
          Object.assign(a, { ...newData, active: true, hp: 1 });
          spawned++;
        }
      }
    }

    // Asteroid physics + asteroid-asteroid collision
    const currentBHs = bhs.current;
    const isSlowMo = slowmoT.current > 0;
    const isPhase = phaseT.current > 0;
    const hasShield = shieldT.current > 0;
    const timeFactor = isSlowMo ? 0.45 : 1.0;
    const dtf = dt * timeFactor;
    const DESPAWN_R2 = DESPAWN_R * DESPAWN_R;
    const sx = shipPos.current.x, sy = shipPos.current.y;

    // First pass: update positions
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
      if (dsx * dsx + dsy * dsy > DESPAWN_R2) { a.active = false; }
    }

    // Second pass: asteroid-asteroid collisions
    const pool = asteroidPool.current;
    for (let i = 0; i < pool.length; i++) {
      const a = pool[i];
      if (!a.active) continue;
      // Only check high-speed asteroids (pushed by impulse) — velocity > 12
      const aspd2 = a.vx * a.vx + a.vy * a.vy;
      if (aspd2 < 144) continue; // 12^2

      for (let j = i + 1; j < pool.length; j++) {
        const b = pool[j];
        if (!b.active) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const collR = (a.r + b.r) * AST_COLLISION_R_MULT;
        if (d2 < collR * collR) {
          // Both destroyed!
          a.active = false; b.active = false;
          totalDestroyed.current += 2;

          // Chain scoring
          chainCount.current++;
          chainTimer.current = 3;
          const chainMult = Math.min(chainCount.current, 15);
          const pts = 10 * chainMult;
          bonusPoints.current += pts;
          coinBank.current += chainMult * 2;
          onCoins(coinBank.current);

          // Visual: small explosions at both
          for (const pos of [{ x: a.x, y: a.y }, { x: b.x, y: b.y }]) {
            const exp: SmallExplosion = { x: pos.x, y: pos.y, t: 0, active: true, color: chainMult > 5 ? "#ff4444" : "#ffaa44" };
            const idx = smallExplosions.current.findIndex(e => !e.active);
            if (idx >= 0) smallExplosions.current[idx] = exp;
            else if (smallExplosions.current.length < 10) smallExplosions.current.push(exp);
          }

          // Chain flash line
          const flash: ChainFlash = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, t: 0, active: true };
          const cfIdx = chainFlashes.current.findIndex(f => !f.active);
          if (cfIdx >= 0) chainFlashes.current[cfIdx] = flash;
          else if (chainFlashes.current.length < 8) chainFlashes.current.push(flash);

          shake.current = Math.max(shake.current, .2 + chainMult * .05);
          break;
        }
      }
    }

    // Asteroid pushed into BH = bonus
    for (let i = 0; i < pool.length; i++) {
      const a = pool[i];
      if (!a.active) continue;
      for (const bh of currentBHs) {
        const dx = a.x - bh.x, dy = a.y - bh.y;
        if (dx * dx + dy * dy < BH_CORE_R * BH_CORE_R * .5) {
          a.active = false;
          totalDestroyed.current++;
          bonusPoints.current += 20;
          chainCount.current++;
          chainTimer.current = 3;
          const exp: SmallExplosion = { x: a.x, y: a.y, t: 0, active: true, color: "#8844ff" };
          const idx = smallExplosions.current.findIndex(e => !e.active);
          if (idx >= 0) smallExplosions.current[idx] = exp;
          else if (smallExplosions.current.length < 10) smallExplosions.current.push(exp);
          break;
        }
      }
    }

    // Ship collision with asteroids
    for (let i = 0; i < pool.length; i++) {
      const a = pool[i];
      if (!a.active) continue;
      const dsx = a.x - sx, dsy = a.y - sy;
      const dd2 = dsx * dsx + dsy * dsy;
      const cd = HIT_R + a.r * .88;
      const nmOuter = cd + NEAR_MISS_D;
      if (dd2 < nmOuter * nmOuter && !isPhase) {
        if (dd2 < cd * cd) {
          if (hasShield) { shieldT.current = 0; shake.current = Math.max(shake.current, 1); a.active = false; continue; }
          overRef.current = true; shake.current = 2;
          explPos.current = { x: sx, y: sy }; explAct.current = true;
          onGameOver(Math.floor(el) + bonusPoints.current, coinBank.current);
          return;
        }
        nearMiss.current = Math.max(nearMiss.current, 1 - (Math.sqrt(dd2) - cd) / NEAR_MISS_D);
      }
    }
  });

  return (
    <>
      <color attach="background" args={["#010208"]} />
      <ambientLight intensity={.35} />
      <directionalLight intensity={.65} color="#93c5fd" position={[8, 10, 14]} />
      <directionalLight intensity={.32} color="#f8fafc" position={[-12, -8, 12]} />
      <Cam sPos={shipPos} shake={shake} gs={gameState} />
      <SpaceBG />
      <Dust />
      <BHVisuals bhRef={bhs} />
      <Ship posRef={shipPos} headRef={shipHead} color={sCol} scale={sSc} nearRef={nearMiss} shieldRef={shieldT} phaseRef={phaseT} />
      <PowerUpVisuals pwRef={pws} />
      <PickupEffect pickupRef={pickupEffect} />
      <AsteroidInstances pool={asteroidPool} geos={geos} />
      <ImpulseWaveVisuals wavesRef={impulseWaves} color={sCol} />
      <ChainFlashVisuals poolRef={chainFlashes} />
      <SmallExplosions poolRef={smallExplosions} />
      <Explosion pRef={explPos} actRef={explAct} />
      <FX />
    </>
  );
}

export default function GravityWarsScene(props: GameProps) {
  return (
    <GameCanvas>
      <GravityWorld {...props} />
    </GameCanvas>
  );
}
