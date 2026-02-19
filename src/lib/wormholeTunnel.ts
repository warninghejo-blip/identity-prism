/**
 * Wormhole tunnel — canvas-based, single compositor layer.
 * No CSS animations on multiple elements; all rendering via one RAF loop.
 */

let _rafId = 0;

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
  // Cap pixel ratio — retina unnecessary for a transition effect
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
  const maxR = Math.hypot(cx, cy) * 1.15;
  const DURATION  = 1100;            // ms for initial rush
  const N_LINES   = mobile ? 32 : 56;
  const N_RINGS   = mobile ? 4  : 6;
  const FRAME_MS  = mobile ? 33 : 16; // 30 fps / 60 fps

  // Pre-compute angles once
  const cos: number[] = new Array(N_LINES);
  const sin: number[] = new Array(N_LINES);
  for (let i = 0; i < N_LINES; i++) {
    const a = (i / N_LINES) * Math.PI * 2;
    cos[i] = Math.cos(a); sin[i] = Math.sin(a);
  }

  const START = performance.now();
  let lastTs = 0;

  function frame(now: number) {
    if (!document.getElementById('wormhole-tunnel')) return;
    if (now - lastTs < FRAME_MS) { _rafId = requestAnimationFrame(frame); return; }
    lastTs = now;

    const elapsed = now - START;
    const t   = Math.min(elapsed / DURATION, 1);   // 0→1 rush phase
    const cruise = t >= 1;
    const ct  = cruise ? ((elapsed - DURATION) / 9000) : 0; // cruise rotation 0→1

    // ── Background ──
    ctx.fillStyle = '#010108';
    ctx.fillRect(0, 0, W, H);

    // ── Nebula ──
    const nebA = Math.min(t * 12, 1);
    const neb = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    neb.addColorStop(0,   `rgba(38,12,82,${(0.92 * nebA).toFixed(2)})`);
    neb.addColorStop(0.45,`rgba(12,4,32,${(0.80 * nebA).toFixed(2)})`);
    neb.addColorStop(1,   'rgba(1,1,8,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W, H);

    // ── Speed lines (batched by 4 opacity buckets) ──
    const rot = cruise ? ct * Math.PI * 2 : 0;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy);
    ctx.lineWidth = 0.8;

    if (cruise) {
      // Steady lines — all same alpha → single path
      ctx.strokeStyle = 'rgba(120,200,255,0.18)';
      ctx.beginPath();
      for (let i = 0; i < N_LINES; i++) {
        ctx.moveTo(cx + cos[i] * maxR * 0.22, cy + sin[i] * maxR * 0.22);
        ctx.lineTo(cx + cos[i] * maxR,        cy + sin[i] * maxR);
      }
      ctx.stroke();
    } else {
      // Rush: 4 buckets to reduce draw calls
      const buckets = 4;
      for (let b = 0; b < buckets; b++) {
        ctx.beginPath();
        const bAlpha = ((buckets - b) / buckets) * 0.55 * Math.min(t * 7, 1);
        ctx.strokeStyle = `rgba(130,205,255,${bAlpha.toFixed(2)})`;
        for (let i = 0; i < N_LINES; i++) {
          const progress = ((t * 2.8 + i / N_LINES + b / buckets) % 1);
          if (Math.floor(progress * buckets) !== b) continue;
          const r1 = maxR * progress * 0.88;
          const r2 = r1 + maxR * 0.14;
          ctx.moveTo(cx + cos[i] * r1, cy + sin[i] * r1);
          ctx.lineTo(cx + cos[i] * r2, cy + sin[i] * r2);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    // ── Tunnel rings (rush only) ──
    if (!cruise) {
      for (let i = 0; i < N_RINGS; i++) {
        const phase = ((t * 3 + i / N_RINGS) % 1);
        const r = phase * maxR;
        const a = (1 - phase) * 0.85 * Math.min(t * 7, 1);
        if (a < 0.01) continue;
        const bright = Math.round(160 + 95 * (1 - phase));
        ctx.strokeStyle = `rgba(${bright},${Math.round(200 + 40 * (1 - phase))},255,${a.toFixed(2)})`;
        ctx.lineWidth = Math.max(0.5, 1.5 * (1 - phase));
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ── Core glow ──
    const coreA = cruise ? 0 : (t < 0.08 ? t / 0.08 : t < 0.7 ? 1 : (1 - t) / 0.3);
    if (coreA > 0.01) {
      const cR = Math.max(4, 90 * t);
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cR);
      cg.addColorStop(0,    `rgba(255,255,255,${coreA.toFixed(2)})`);
      cg.addColorStop(0.28, `rgba(185,225,255,${(coreA * 0.55).toFixed(2)})`);
      cg.addColorStop(1,    'rgba(100,160,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI * 2); ctx.fill();
    }

    // ── Cruise centre glow ──
    if (cruise) {
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.38);
      cg.addColorStop(0, 'rgba(55,110,215,0.22)');
      cg.addColorStop(1, 'rgba(30,60,140,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, W, H);
    }

    // ── Exit flash (t 0.44 → 0.82) ──
    if (!cruise && t > 0.44 && t < 0.82) {
      const ft = (t - 0.44) / 0.38;
      const fo = ft < 0.5 ? ft * 2 * 0.78 : (1 - ft) * 2 * 0.78;
      if (fo > 0.01) {
        const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(cx, cy) * 0.95);
        fg.addColorStop(0,   `rgba(255,255,255,${fo.toFixed(2)})`);
        fg.addColorStop(0.3, `rgba(205,232,255,${(fo * 0.45).toFixed(2)})`);
        fg.addColorStop(1,   'rgba(140,190,255,0)');
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
