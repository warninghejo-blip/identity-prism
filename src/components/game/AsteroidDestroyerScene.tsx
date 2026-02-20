import React, { Suspense, useEffect, useMemo, useRef } from "react";
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
   Projectile system
   ═══════════════════════════════════════════════════ */

interface Projectile {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  active: boolean;
}

const MAX_PROJECTILES = 20;
const PROJ_SPEED = 35;
const PROJ_LIFE = 1.8;
const PROJ_HIT_R = 0.5;
const FIRE_COOLDOWN = 0.25;
const AMMO_MAX = 8;
const AMMO_REGEN = 0.6; // seconds per ammo regen

/* ═══════════════════════════════════════════════════
   Projectile visuals
   ═══════════════════════════════════════════════════ */

function ProjectileVisuals({ poolRef, color }: { poolRef: React.MutableRefObject<Projectile[]>; color: string }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const m = refs.current[i];
      const g = glowRefs.current[i];
      const p = poolRef.current[i];
      if (!m || !g) continue;
      if (!p || !p.active) { m.visible = false; g.visible = false; continue; }
      m.visible = true; g.visible = true;
      m.position.set(p.x, p.y, 0);
      g.position.set(p.x, p.y, 0);
      const fade = Math.min(1, p.life * 4);
      (m.material as THREE.MeshBasicMaterial).opacity = fade;
      (g.material as THREE.MeshBasicMaterial).opacity = fade * .3 * (.7 + Math.sin(t * 12 + i) * .3);
      g.scale.setScalar(1 + Math.sin(t * 8 + i * 2) * .15);
    }
  });

  return (<>{Array.from({ length: MAX_PROJECTILES }).map((_, i) => (
    <React.Fragment key={i}>
      <mesh ref={el => { refs.current[i] = el; }} visible={false}>
        <sphereGeometry args={[.18, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={1} />
      </mesh>
      <mesh ref={el => { glowRefs.current[i] = el; }} visible={false}>
        <sphereGeometry args={[.5, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </React.Fragment>
  ))}</>);
}

/* ═══════════════════════════════════════════════════
   Game World — Asteroid Destroyer
   ═══════════════════════════════════════════════════ */

function DestroyerWorld({ gameState, onGameOver, onScore, onCoins, traits }: GameProps) {
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

  // Destroyer-specific state
  const projectiles = useRef<Projectile[]>(Array.from({ length: MAX_PROJECTILES }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, active: false })));
  const fireCooldown = useRef(0);
  const ammo = useRef(AMMO_MAX);
  const ammoRegen = useRef(0);
  const combo = useRef(0);
  const comboTimer = useRef(0);
  const killCount = useRef(0);
  const smallExplosions = useRef<SmallExplosion[]>([]);

  const sCol = traits?.planetTier ? TIER_COLORS[traits.planetTier] || "#22d3ee" : "#22d3ee";
  const sSc = traits?.planetTier === "binary_sun" ? 1.08 : 1;
  const geos = useMemo(createGeos, []);
  useEffect(() => () => { geos.forEach(g => g.dispose()); }, [geos]);

  // Controls: tap/click = fire, NOT reverse direction
  // Double-tap / right-click = reverse direction
  useEffect(() => {
    if (gameState !== "playing") return;
    let lastTap = 0;

    const fire = () => {
      if (fireCooldown.current > 0 || ammo.current <= 0) return;
      const h = shipHead.current;
      const px = shipPos.current.x, py = shipPos.current.y;
      for (let i = 0; i < MAX_PROJECTILES; i++) {
        const p = projectiles.current[i];
        if (!p.active) {
          p.x = px + Math.cos(h) * 1.2;
          p.y = py + Math.sin(h) * 1.2;
          p.vx = Math.cos(h) * PROJ_SPEED;
          p.vy = Math.sin(h) * PROJ_SPEED;
          p.life = PROJ_LIFE;
          p.active = true;
          break;
        }
      }
      fireCooldown.current = FIRE_COOLDOWN;
      ammo.current--;
    };

    const rev = () => {
      orbDir.current = orbDir.current === 1 ? -1 : 1;
      headingBoost.current = TAP_BOOST * orbDir.current;
    };

    const onK = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") { e.preventDefault(); fire(); }
      else if (e.code === "KeyD" || e.code === "ArrowRight" || e.code === "ArrowLeft" || e.code === "KeyA") { rev(); }
    };
    const onM = (e: MouseEvent) => {
      if (e.button === 0) fire();
      else if (e.button === 2) { e.preventDefault(); rev(); }
    };
    const onT = (e: TouchEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastTap < 300) { rev(); lastTap = 0; }
      else { fire(); lastTap = now; }
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

  // Reset on game start
  useEffect(() => {
    if (gameState !== "playing") return;
    resetAidN(); resetPwIdN();
    asteroidPool.current.forEach(a => { a.active = false; });
    projectiles.current.forEach(p => { p.active = false; });
    smallExplosions.current = [];
    shipPos.current = { x: 5, y: 0 }; shipHead.current = Math.PI / 2;
    orbDir.current = 1; curSpeed.current = INIT_SPEED; nearMiss.current = 0; headingBoost.current = 0;
    bhs.current = [spawnBH(5, 0)]; bhTimer.current = 0;
    pws.current = []; pwTimer.current = 0;
    shieldT.current = 0; slowmoT.current = 0; phaseT.current = 0;
    bonusPoints.current = 0; coinBank.current = 0; coinAccum.current = 0;
    ammo.current = AMMO_MAX; ammoRegen.current = 0; fireCooldown.current = 0;
    combo.current = 0; comboTimer.current = 0; killCount.current = 0;
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
      if (fireCooldown.current > 0) fireCooldown.current -= dt;

      // Ammo regen
      if (ammo.current < AMMO_MAX) {
        ammoRegen.current += dt;
        if (ammoRegen.current >= AMMO_REGEN) { ammo.current = Math.min(AMMO_MAX, ammo.current + 1); ammoRegen.current = 0; }
      }

      // Combo decay
      if (comboTimer.current > 0) {
        comboTimer.current -= dt;
        if (comboTimer.current <= 0) combo.current = 0;
      }

      const tSpeed = clamp(INIT_SPEED + el * SPEED_GAIN, INIT_SPEED, MAX_SPEED);
      curSpeed.current = slerp(curSpeed.current, tSpeed, 3, dt);

      let heading = shipHead.current;
      let px = shipPos.current.x, py = shipPos.current.y;

      if (headingBoost.current !== 0) { heading += headingBoost.current; headingBoost.current = 0; }
      heading += ANG_RATE * orbDir.current * dt;

      // BH spawning & physics
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
          const awayX = (px - bh.x) / safeD, awayY = (py - bh.y) / safeD;
          px += awayX * BH_PUSH_STR * (1 - dist / BH_CORE_R) * dt;
          py += awayY * BH_PUSH_STR * (1 - dist / BH_CORE_R) * dt;
          heading += normAng(Math.atan2(awayY, awayX) - heading) * Math.min(1, 6 * dt);
          curSpeed.current = Math.min(curSpeed.current + bh.str * .5 * dt, MAX_SPEED * 1.25);
          shake.current = Math.max(shake.current, .4);
        } else {
          const angleToBH = Math.atan2(dy, dx);
          const cross = Math.cos(heading) * dy - Math.sin(heading) * dx;
          const deflectDir = cross >= 0 ? 1 : -1;
          const perpAngle = angleToBH + deflectDir * Math.PI * 0.5;
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

    // Frame-rate dependent updates
    const dt = frameDt;
    const el = elapsed.current;
    const px = shipPos.current.x, py = shipPos.current.y;
    const heading = shipHead.current;

    // Score: kills * combo multiplier + survival time
    const sc = Math.floor(el) + bonusPoints.current;
    if (sc !== scoreRef.current) { scoreRef.current = sc; onScore(sc); }

    // Coin accumulation
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

    // Asteroid spawning
    spawnT.current += dt;
    const si = Math.max(.3, 1.45 - el * .012);
    if (spawnT.current >= si) {
      spawnT.current = 0;
      const wc = el > 35 && Math.random() < .35 ? 2 : 1;
      let spawned = 0;
      for (let i = 0; i < asteroidPool.current.length; i++) {
        if (spawned >= wc) break;
        const a = asteroidPool.current[i];
        if (!a.active) {
          const newData = spawnAst(el, px, py);
          Object.assign(a, { ...newData, active: true, hp: newData.small ? 1 : 2 });
          spawned++;
        }
      }
    }

    // Projectile updates
    for (const p of projectiles.current) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      // BH gravity on projectiles
      for (const bh of bhs.current) {
        const dx = bh.x - p.x, dy = bh.y - p.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const f = bh.str * 3 / (d * d);
        p.vx += (dx / d) * f * dt;
        p.vy += (dy / d) * f * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }

    // Collision: projectiles vs asteroids
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

      // BH gravity on asteroids
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

      // Despawn
      const dsx = a.x - sx, dsy = a.y - sy;
      const dd2 = dsx * dsx + dsy * dsy;
      if (dd2 > DESPAWN_R2) { a.active = false; continue; }

      // Projectile hit check
      let wasHit = false;
      for (const p of projectiles.current) {
        if (!p.active) continue;
        const phx = p.x - a.x, phy = p.y - a.y;
        const phd2 = phx * phx + phy * phy;
        const hitR = PROJ_HIT_R + a.r * .88;
        if (phd2 < hitR * hitR) {
          p.active = false;
          a.hp = (a.hp ?? 1) - 1;
          if (a.hp! <= 0) {
            wasHit = true;
            a.active = false;

            // Spawn small explosion
            const newExp: SmallExplosion = { x: a.x, y: a.y, t: 0, active: true, color: "#ff8844" };
            const idx = smallExplosions.current.findIndex(e => !e.active);
            if (idx >= 0) smallExplosions.current[idx] = newExp;
            else if (smallExplosions.current.length < 10) smallExplosions.current.push(newExp);

            // Combo + score
            combo.current++;
            comboTimer.current = 2.5;
            const comboMult = Math.min(combo.current, 10);
            const killScore = (a.small ? 5 : 15) * comboMult;
            bonusPoints.current += killScore;
            killCount.current++;

            // Coin bonus for kills
            coinBank.current += comboMult;
            onCoins(coinBank.current);

            // Split large asteroids into 2 small ones
            if (!a.small) {
              for (let s = 0; s < 2; s++) {
                for (let j = 0; j < asteroidPool.current.length; j++) {
                  const child = asteroidPool.current[j];
                  if (!child.active) {
                    const ang = rnd(0, 6.28);
                    const sp = rnd(4, 8);
                    Object.assign(child, {
                      active: true, id: ++child.id,
                      x: a.x + Math.cos(ang) * a.r, y: a.y + Math.sin(ang) * a.r,
                      vx: Math.cos(ang) * sp + a.vx * .5, vy: Math.sin(ang) * sp + a.vy * .5,
                      r: rnd(.3, .6), small: true, hp: 1,
                      rx: rnd(0, 6.28), ry: rnd(0, 6.28), rz: rnd(0, 6.28),
                      rsx: rnd(-2, 2), rsy: rnd(-2, 2), rsz: rnd(-2, 2),
                      sx: rnd(.9, 1.1), sy: rnd(.9, 1.1), sz: rnd(.9, 1.1),
                      gi: Math.floor(rnd(0, 6)), mi: Math.floor(rnd(0, 4)),
                      wobbleAmp: rnd(.5, 2), wobbleFreq: rnd(2, 5), wobblePhase: rnd(0, 6.28),
                      spawnTime: el,
                    });
                    break;
                  }
                }
              }
            }

            shake.current = Math.max(shake.current, a.small ? .15 : .4);
          } else {
            shake.current = Math.max(shake.current, .1);
          }
          break;
        }
      }
      if (wasHit) continue;

      // Ship collision
      const cd = HIT_R + a.r * .88;
      const cd2sq = cd * cd;
      const nmOuter = cd + NEAR_MISS_D;
      if (dd2 < nmOuter * nmOuter && !isPhase) {
        if (dd2 < cd2sq) {
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
      <ProjectileVisuals poolRef={projectiles} color={sCol} />
      <SmallExplosions poolRef={smallExplosions} />
      <Explosion pRef={explPos} actRef={explAct} />
      <FX />
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════ */

export default function AsteroidDestroyerScene(props: GameProps) {
  return (
    <GameCanvas>
      <DestroyerWorld {...props} />
    </GameCanvas>
  );
}
