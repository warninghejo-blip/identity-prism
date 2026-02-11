/**
 * Cosmic wormhole tunnel transition.
 * Creates a proper tunnel/corridor-of-light feeling — elongated radial
 * light streaks rush past the camera like flying through hyperspace.
 * No geometric shapes. Pure light, depth, and motion.
 */

export function createWormholeTunnel(): HTMLElement {
  // Remove any existing tunnel / legacy overlays
  document.getElementById('wormhole-tunnel')?.remove();
  document.getElementById('bh-forward-blackout')?.remove();
  document.getElementById('bh-transition-veil')?.remove();

  const tunnel = document.createElement('div');
  tunnel.id = 'wormhole-tunnel';
  tunnel.className = 'wormhole-tunnel';

  // Layer 1: Deep space backdrop
  const nebula = document.createElement('div');
  nebula.className = 'wt-nebula';
  tunnel.appendChild(nebula);

  // Layer 2: Tunnel vignette — darker at edges, lighter in center = depth
  const vignette = document.createElement('div');
  vignette.className = 'wt-vignette';
  tunnel.appendChild(vignette);

  // Layer 3: Depth layers — reduced to 3 for mobile performance
  for (let i = 0; i < 3; i++) {
    const layer = document.createElement('div');
    layer.className = 'wt-depth';
    const delay = 0.15 + i * 0.4;
    const hue = 210 + i * 30;
    const alpha = 0.22 - i * 0.04;
    layer.style.background = `radial-gradient(ellipse at center, 
      hsla(${hue}, 55%, 72%, ${alpha}) 0%, 
      hsla(${hue}, 45%, 55%, ${alpha * 0.35}) 35%, 
      transparent 60%)`;
    layer.style.animation = `wt-depth-rush 2.4s ${delay}s ease-in-out forwards`;
    tunnel.appendChild(layer);
  }

  // Layer 4: Nebula color wash
  const glow = document.createElement('div');
  glow.className = 'wt-glow';
  tunnel.appendChild(glow);

  // Layer 5: Central vanishing point — where the tunnel converges
  const core = document.createElement('div');
  core.className = 'wt-core';
  tunnel.appendChild(core);

  // Layer 8: Exit bloom — bright wash as you emerge
  const flash = document.createElement('div');
  flash.className = 'wt-flash';
  tunnel.appendChild(flash);

  document.body.appendChild(tunnel);
  return tunnel;
}

export function fadeOutWormholeTunnel(delayMs = 400) {
  setTimeout(() => {
    const tunnel = document.getElementById('wormhole-tunnel');
    if (tunnel) {
      tunnel.style.transition = 'opacity 1s ease-out';
      tunnel.style.opacity = '0';
      setTimeout(() => tunnel.remove(), 1100);
    }
    // Also clean legacy overlays
    for (const id of ['bh-forward-blackout', 'bh-transition-veil']) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
  }, delayMs);
}
