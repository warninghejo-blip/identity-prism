import { useRef, useEffect, useCallback, type RefObject } from 'react';

const IS_MOBILE = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

const STAR_COUNT = IS_MOBILE ? 180 : 300;
const DPR = Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, 2);

// 3 colour families
const COLORS = [
  [255, 255, 255], // white
  [34, 211, 238], // cyan
  [255, 225, 180], // warm
] as const;
const RAD_TO_DEG = 180 / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface Star {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  depth: number;
  r: number;
  color: readonly [number, number, number];
  alpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
  // vortex
  angle: number;
  dist: number;
  origDist: number; // original distance for respawn
  speed: number; // individual speed multiplier
}

export interface CosmicStarfieldProps {
  mode: 'drift' | 'vortex';
  variant?: 'default' | 'card';
  /** Called once when vortex spin reaches peak speed */
  onVortexPeak?: () => void;
  /** Pause star movement (stars stay in place) */
  paused?: boolean;
  /** Drift direction: 'right' (default), 'left', 'up', 'down' */
  driftDirection?: 'right' | 'left' | 'up' | 'down';
  /** External rotation offset in radians (mutable ref — no re-render) */
  rotationOffsetRef?: RefObject<number>;
  /** Optional OrbitControls camera angles so the background can react to both axes. */
  cameraAnglesRef?: RefObject<{ azimuth: number; polar: number }>;
}

// Background comets — lightweight canvas streaks
const COMET_MAX = IS_MOBILE ? 2 : 4;
interface BgComet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  active: boolean;
  len: number;
}

export function CosmicStarfield({
  mode,
  variant = 'default',
  onVortexPeak,
  paused,
  driftDirection = 'right',
  rotationOffsetRef,
  cameraAnglesRef,
}: CosmicStarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>([]);
  const cometsRef = useRef<BgComet[]>(
    Array.from({ length: COMET_MAX }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, active: false, len: 0 })),
  );
  const cometTimer = useRef(0);
  const rafRef = useRef(0);
  const vortexProgressRef = useRef(0); // 0→1 over ~2.5s
  const peakFiredRef = useRef(false);
  const modeRef = useRef(mode);
  const onVortexPeakRef = useRef(onVortexPeak);
  const pausedRef = useRef(paused);
  const driftDirRef = useRef(driftDirection);
  const variantRef = useRef(variant);
  const rotationOffsetRefInternal = useRef(rotationOffsetRef);
  const cameraAnglesRefInternal = useRef(cameraAnglesRef);
  const sizeRef = useRef({ w: 0, h: 0 });

  modeRef.current = mode;
  onVortexPeakRef.current = onVortexPeak;
  pausedRef.current = paused;
  driftDirRef.current = driftDirection;
  variantRef.current = variant;
  rotationOffsetRefInternal.current = rotationOffsetRef;
  cameraAnglesRefInternal.current = cameraAnglesRef;

  // Reset vortex state when switching back to drift
  useEffect(() => {
    if (mode === 'drift') {
      vortexProgressRef.current = 0;
      peakFiredRef.current = false;
    }
  }, [mode]);

  const initStars = useCallback((w: number, h: number) => {
    const stars: Star[] = [];
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    const isCardVariant = variantRef.current === 'card';
    const starCount = isCardVariant ? (IS_MOBILE ? 110 : 170) : STAR_COUNT;
    for (let i = 0; i < starCount; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const depth = 0.2 + Math.random() * 0.8;
      stars.push({
        x,
        y,
        baseX: x,
        baseY: y,
        depth,
        r: isCardVariant ? 0.25 + depth * 0.9 : 0.4 + Math.random() * 1.2,
        color,
        alpha: isCardVariant ? 0.18 + depth * 0.42 : 0.3 + Math.random() * 0.7,
        twinkleSpeed: 0.5 + Math.random() * 1.5,
        twinklePhase: Math.random() * Math.PI * 2,
        angle: Math.atan2(dy, dx),
        dist,
        origDist: maxR * (0.3 + Math.random() * 0.7), // for respawning
        speed: 0.6 + Math.random() * 0.8, // individual variation
      });
    }
    starsRef.current = stars;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      sizeRef.current = { w, h };
      canvas.width = w * DPR;
      canvas.height = h * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (starsRef.current.length === 0) initStars(w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    let lastTime = 0;
    let hidden = false;

    const onVis = () => {
      hidden = document.hidden;
      if (!hidden) lastTime = 0;
    };
    document.addEventListener('visibilitychange', onVis);

    const loop = (time: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (hidden) return;
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0.016;
      lastTime = time;

      const { w, h } = sizeRef.current;
      ctx.clearRect(0, 0, w, h);

      const stars = starsRef.current;
      const curMode = modeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.sqrt(cx * cx + cy * cy);
      const rotOffset = rotationOffsetRefInternal.current?.current ?? 0;
      const cameraAngles = cameraAnglesRefInternal.current?.current;
      const isCardVariant = variantRef.current === 'card';

      if (cameraAngles && !isCardVariant) {
        const yawDeg = clamp(-cameraAngles.azimuth * RAD_TO_DEG * 0.34, -18, 18);
        const pitchDeg = clamp((cameraAngles.polar - Math.PI / 2) * RAD_TO_DEG * 0.42, -14, 14);
        const rollDeg = clamp(-rotOffset * RAD_TO_DEG * 0.12, -6, 6);
        const shiftX = clamp(yawDeg * -1.1, -18, 18);
        const shiftY = clamp(pitchDeg * 1.15, -14, 14);
        canvas.style.transformOrigin = '50% 50%';
        canvas.style.willChange = 'transform';
        canvas.style.transform =
          `perspective(1200px) translate3d(${shiftX}px, ${shiftY}px, 0) ` +
          `rotateX(${pitchDeg}deg) rotateY(${yawDeg}deg) rotateZ(${rollDeg}deg) scale(1.08)`;
      } else {
        canvas.style.transform = '';
        canvas.style.willChange = 'auto';
      }

      if (curMode === 'vortex') {
        // Advance vortex progress: 0→1 over 2.5s
        vortexProgressRef.current = Math.min(vortexProgressRef.current + dt / 2.5, 1);
        const p = vortexProgressRef.current;
        // Global speed ramp: 1→6
        const globalSpeed = 1 + p * 5;

        if (p >= 1 && !peakFiredRef.current) {
          peakFiredRef.current = true;
          onVortexPeakRef.current?.();
        }

        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          const spd = globalSpeed * s.speed;

          // Each star spirals individually toward center
          s.angle += spd * 1.2 * dt;
          s.dist -= spd * 50 * dt;

          // Respawn at edge when reaching center
          if (s.dist <= 2) {
            s.dist = maxR * (0.8 + Math.random() * 0.4);
            s.angle = Math.random() * Math.PI * 2;
            s.speed = 0.6 + Math.random() * 0.8;
          }

          s.x = cx + Math.cos(s.angle) * s.dist;
          s.y = cy + Math.sin(s.angle) * s.dist;

          // Streak length based on speed
          const streakLen = Math.min(spd * 2.5, 20);
          const tailX = s.x - Math.cos(s.angle) * streakLen;
          const tailY = s.y - Math.sin(s.angle) * streakLen;
          const alpha = s.alpha * (0.4 + 0.6 * p);

          // Draw streak tail
          if (streakLen > 1.5) {
            const grad = ctx.createLinearGradient(tailX, tailY, s.x, s.y);
            grad.addColorStop(0, `rgba(${s.color[0]},${s.color[1]},${s.color[2]},0)`);
            grad.addColorStop(1, `rgba(${s.color[0]},${s.color[1]},${s.color[2]},${alpha})`);
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(s.x, s.y);
            ctx.strokeStyle = grad;
            ctx.lineWidth = s.r * 1.5;
            ctx.stroke();
          }

          // Draw star dot
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * (0.8 + 0.4 * p), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${s.color[0]},${s.color[1]},${s.color[2]},${alpha})`;
          ctx.fill();
        }
      } else {
        // Drift mode — gentle parallax + twinkle
        const drawRotation = cameraAngles || isCardVariant ? 0 : rotOffset;
        if (drawRotation !== 0) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(drawRotation);
          ctx.translate(-cx, -cy);
        }
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          if (!pausedRef.current) {
            const spd = dt * 3 * (0.5 + s.r * 0.3);
            const dir = driftDirRef.current;
            // Direction = where STARS drift visually
            if (dir === 'left') {
              s.baseX -= spd;
              s.baseY -= dt * 0.2;
            } else if (dir === 'up') {
              s.baseY -= spd;
              s.baseX += dt * 0.2;
            } else if (dir === 'down') {
              s.baseY += spd;
              s.baseX -= dt * 0.2;
            } else /* right */ {
              s.baseX += spd;
              s.baseY -= dt * 0.3;
            }
          }
          if (s.baseX > w + 5) s.baseX = -5;
          if (s.baseX < -5) s.baseX = w + 5;
          if (s.baseY < -5) s.baseY = h + 5;
          if (s.baseY > h + 5) s.baseY = -5;

          if (isCardVariant) {
            const yawShift = cameraAngles ? clamp(-cameraAngles.azimuth * (4 + s.depth * 14), -14, 14) : 0;
            const pitchShift = cameraAngles
              ? clamp((cameraAngles.polar - Math.PI / 2) * (6 + s.depth * 16), -12, 12)
              : 0;
            const rollShiftX = Math.sin(rotOffset + s.twinklePhase) * (0.8 + s.depth * 2.2);
            const rollShiftY = Math.cos(rotOffset * 0.85 + s.twinklePhase) * (0.6 + s.depth * 1.6);
            s.x = s.baseX + yawShift + rollShiftX;
            s.y = s.baseY + pitchShift + rollShiftY;
          } else {
            s.x = s.baseX;
            s.y = s.baseY;
          }

          // Keep vortex geometry synced for smooth transition
          const dx = s.x - cx;
          const dy = s.y - cy;
          s.angle = Math.atan2(dy, dx);
          s.dist = Math.sqrt(dx * dx + dy * dy);

          // Twinkle
          s.twinklePhase += s.twinkleSpeed * dt;
          const flicker = 0.5 + 0.5 * Math.sin(s.twinklePhase);
          const alpha = s.alpha * (0.35 + 0.65 * flicker);

          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${s.color[0]},${s.color[1]},${s.color[2]},${alpha})`;
          ctx.fill();
        }
        if (drawRotation !== 0) ctx.restore();
      }

      // ── Background comets ──
      if (!pausedRef.current && !isCardVariant) {
        const comets = cometsRef.current;
        cometTimer.current += dt;
        if (cometTimer.current > (IS_MOBILE ? 14.0 : 9.0)) {
          cometTimer.current = 0;
          for (const cm of comets) {
            if (cm.active) continue;
            // Spawn from random edge
            const edge = Math.floor(Math.random() * 4);
            const speed = 150 + Math.random() * 250;
            if (edge === 0) {
              cm.x = Math.random() * w;
              cm.y = -10;
            } else if (edge === 1) {
              cm.x = w + 10;
              cm.y = Math.random() * h;
            } else if (edge === 2) {
              cm.x = Math.random() * w;
              cm.y = h + 10;
            } else {
              cm.x = -10;
              cm.y = Math.random() * h;
            }
            const ang = Math.atan2(
              h / 2 - cm.y + (Math.random() - 0.5) * h * 0.6,
              w / 2 - cm.x + (Math.random() - 0.5) * w * 0.6,
            );
            cm.vx = Math.cos(ang) * speed;
            cm.vy = Math.sin(ang) * speed;
            cm.maxLife = 1.2 + Math.random() * 1.5;
            cm.life = 0;
            cm.len = 30 + Math.random() * 50;
            cm.active = true;
            break;
          }
        }
        for (const cm of comets) {
          if (!cm.active) continue;
          cm.life += dt;
          if (cm.life > cm.maxLife) {
            cm.active = false;
            continue;
          }
          cm.x += cm.vx * dt;
          cm.y += cm.vy * dt;
          const fade = Math.min(1, cm.life * 4) * Math.min(1, (cm.maxLife - cm.life) * 3);
          const ang = Math.atan2(cm.vy, cm.vx);
          const tx = cm.x - Math.cos(ang) * cm.len;
          const ty = cm.y - Math.sin(ang) * cm.len;
          const grad = ctx.createLinearGradient(tx, ty, cm.x, cm.y);
          grad.addColorStop(0, `rgba(170,200,255,0)`);
          grad.addColorStop(1, `rgba(170,200,255,${fade * 0.3})`);
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(cm.x, cm.y);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // Head glow
          ctx.beginPath();
          ctx.arc(cm.x, cm.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200,220,255,${fade * 0.5})`;
          ctx.fill();
        }
      }
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.style.transform = '';
      canvas.style.willChange = 'auto';
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [initStars]);

  return <canvas ref={canvasRef} className="landing-starfield-canvas" aria-hidden="true" />;
}
