/**
 * Wormhole tunnel — canvas-based, single compositor layer.
 * Eased rush → elliptical rings → particles → cruise glow.
 */

let _rafId = 0;

// Smooth ease-in-out
function eio(x: number) { return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2; }

export function createWormholeTunnel(): HTMLElement {
  cancelAnimationFrame(_rafId);
  for (const id of ['wormhole-tunnel', 'bh-forward-blackout', 'bh-transition-veil']) {
    document.getElementById(id)?.remove();
  }

  const tunnel = document.createElement('div');
  tunnel.id = 'wormhole-tunnel';
  tunnel.style.cssText =
    'position:fixed;inset:0;z-index:999999;overflow:hidden;pointer-events:all;background:#010108';

  const W = window.innerWidth;
  const H = window.innerHeight;
  const mobile = W <= 768;
  const dpr = mobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);

  const canvas = document.createElement('canvas');
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;transform:translateZ(0)';
  tunnel.appendChild(canvas);
  document.body.appendChild(tunnel);

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return tunnel;
  ctx.scale(dpr, dpr);

  const cx = W / 2, cy = H / 2;
  const maxR = Math.hypot(cx, cy) * 1.18;
  const DURATION  = 1800;
  const N_LINES   = mobile ? 30 : 52;
  const N_RINGS   = mobile ? 5  : 7;
  const N_PART    = mobile ? 12 : 22;
  const FRAME_MS  = mobile ? 33 : 16;

  // Pre-compute angles (Float32Array = better cache perf)
  const N_ANG = Math.max(N_LINES, N_PART);
  const COS = new Float32Array(N_ANG);
  const SIN = new Float32Array(N_ANG);
  for (let i = 0; i < N_ANG; i++) {
    const a = (i / N_ANG) * Math.PI * 2;
    COS[i] = Math.cos(a); SIN[i] = Math.sin(a);
  }

  // Particle offsets — golden-ratio spread for even distribution
  const pOff = new Float32Array(N_PART);
  const pSpd = new Float32Array(N_PART);
  for (let i = 0; i < N_PART; i++) {
    pOff[i] = (i * 0.618034) % 1;
    pSpd[i] = 0.45 + (i % 4) * 0.10;
  }

  const START = performance.now();
  let lastTs = 0;

  function frame(now: number) {
    if (!document.getElementById('wormhole-tunnel')) return;
    if (now - lastTs < FRAME_MS) { _rafId = requestAnimationFrame(frame); return; }
    lastTs = now;

    const elapsed = now - START;
    const tRaw = Math.min(elapsed / DURATION, 1);
    const t    = eio(tRaw);              // eased t — smooth accel/decel
    const cruise = tRaw >= 1;
    const ct   = cruise ? (elapsed - DURATION) / 14000 : 0;

    // ── Background ──
    ctx.fillStyle = '#010108';
    ctx.fillRect(0, 0, W, H);

    // ── Nebula ──
    const nebA = Math.min(tRaw * 10, 1);
    const neb = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    neb.addColorStop(0,    `rgba(44,10,92,${(0.94 * nebA).toFixed(2)})`);
    neb.addColorStop(0.32, `rgba(18,4,48,${(0.82 * nebA).toFixed(2)})`);
    neb.addColorStop(0.7,  `rgba(6,1,18,${(0.65 * nebA).toFixed(2)})`);
    neb.addColorStop(1,    'rgba(1,1,8,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W, H);

    // ── Vignette — cinematic dark frame ──
    if (nebA > 0.05) {
      const vig = ctx.createRadialGradient(cx, cy, maxR * 0.38, cx, cy, maxR * 1.05);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, `rgba(0,0,0,${(0.65 * nebA).toFixed(2)})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    }

    // ── Speed lines ──
    const rot = cruise ? ct * Math.PI * 2 : 0;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy);

    if (cruise) {
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = 'rgba(110,192,255,0.16)';
      ctx.beginPath();
      for (let i = 0; i < N_LINES; i++) {
        const r1 = maxR * 0.18;
        const r2 = maxR * (0.72 + (i % 3) * 0.09);
        ctx.moveTo(cx + COS[i] * r1, cy + SIN[i] * r1);
        ctx.lineTo(cx + COS[i] * r2, cy + SIN[i] * r2);
      }
      ctx.stroke();
    } else {
      const fadeIn = Math.min(tRaw * 8, 1);
      for (let b = 0; b < 4; b++) {
        const bA = ((4 - b) / 4) * 0.58 * fadeIn;
        ctx.strokeStyle = `rgba(128,208,255,${bA.toFixed(2)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < N_LINES; i++) {
          const progress = ((t * 2.2 + i / N_LINES + b * 0.25) % 1);
          if (Math.floor(progress * 4) !== b) continue;
          // Lines get longer toward edges = depth illusion
          const len = maxR * (0.07 + progress * 0.2);
          const r1  = Math.max(3, maxR * progress * 0.9 - len * 0.4);
          const r2  = r1 + len;
          ctx.moveTo(cx + COS[i] * r1, cy + SIN[i] * r1);
          ctx.lineTo(cx + COS[i] * r2, cy + SIN[i] * r2);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    // ── Tunnel rings — slightly elliptical for 3-D perspective ──
    if (!cruise) {
      const fadeIn = Math.min(tRaw * 8, 1);
      for (let i = 0; i < N_RINGS; i++) {
        const phase = ((t * 2.4 + i / N_RINGS) % 1);
        const r = phase * maxR;
        const a = (1 - phase) * 0.9 * fadeIn;
        if (a < 0.01 || r < 1) continue;
        // Warm white near center → cyan-blue at edge
        const lum = Math.round(175 + 80 * (1 - phase));
        const grn = Math.round(212 + 38 * (1 - phase));
        ctx.strokeStyle = `rgba(${lum},${grn},255,${a.toFixed(2)})`;
        ctx.lineWidth = Math.max(0.4, 1.9 * (1 - phase));
        ctx.beginPath();
        // Subtle x-stretch simulates receding tunnel perspective
        ctx.ellipse(cx, cy, r * (1 + 0.07 * phase), r, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ── Particles — glowing dots rush outward ──
    if (!cruise && tRaw > 0.04) {
      const fadeIn = Math.min(tRaw * 7, 1);
      for (let i = 0; i < N_PART; i++) {
        const progress = ((t * pSpd[i] * 1.5 + pOff[i]) % 1);
        const r  = progress * maxR;
        const ai = (i / N_PART) * Math.PI * 2 + t * 0.25;
        const px = cx + Math.cos(ai) * r;
        const py = cy + Math.sin(ai) * r;
        const pa = (1 - progress) * 0.8 * fadeIn;
        if (pa < 0.01) continue;
        const sz = Math.max(0.7, 2.8 * (1 - progress * 0.65));
        ctx.fillStyle = `rgba(185,232,255,${pa.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Core glow ──
    const coreA = cruise ? 0
      : tRaw < 0.07 ? tRaw / 0.07
      : tRaw < 0.70 ? 1
      : (1 - tRaw) / 0.30;
    if (coreA > 0.01) {
      const cR = Math.max(5, 115 * t * t);
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cR);
      cg.addColorStop(0,    `rgba(255,255,255,${coreA.toFixed(2)})`);
      cg.addColorStop(0.18, `rgba(210,235,255,${(coreA * 0.82).toFixed(2)})`);
      cg.addColorStop(0.5,  `rgba(150,205,255,${(coreA * 0.38).toFixed(2)})`);
      cg.addColorStop(1,    'rgba(100,160,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI * 2); ctx.fill();
    }

    // ── Cruise centre glow ──
    if (cruise) {
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.42);
      cg.addColorStop(0, 'rgba(58,118,222,0.21)');
      cg.addColorStop(1, 'rgba(28,58,138,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, W, H);
    }

    // ── Exit flash (tRaw 0.46 → 0.82) ──
    if (!cruise && tRaw > 0.46 && tRaw < 0.82) {
      const ft = (tRaw - 0.46) / 0.36;
      const fo = (ft < 0.42 ? ft / 0.42 : (1 - ft) / 0.58) * 0.84;
      if (fo > 0.01) {
        const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(cx, cy) * 0.98);
        fg.addColorStop(0,    `rgba(255,255,255,${fo.toFixed(2)})`);
        fg.addColorStop(0.22, `rgba(215,238,255,${(fo * 0.52).toFixed(2)})`);
        fg.addColorStop(1,    'rgba(140,190,255,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, W, H);
      }
    }

    _rafId = requestAnimationFrame(frame);
  }

  _rafId = requestAnimationFrame(frame);
  return tunnel;
}

export function fadeOutWormholeTunnel(delayMs = 400) {
  setTimeout(() => {
    cancelAnimationFrame(_rafId);
    const tunnel = document.getElementById('wormhole-tunnel');
    if (tunnel) {
      tunnel.style.transition = 'opacity 0.55s ease-out';
      tunnel.style.opacity = '0';
      setTimeout(() => tunnel.remove(), 650);
    }
    for (const id of ['bh-forward-blackout', 'bh-transition-veil']) {
      document.getElementById(id)?.remove();
    }
  }, delayMs);
}
