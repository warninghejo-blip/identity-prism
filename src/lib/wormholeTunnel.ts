/**
 * Cosmic wormhole tunnel transition.
 * Lightweight hyperspace corridor — radial light streaks + soft glow.
 * Uses only CSS animations, no canvas/WebGL.
 */

export function createWormholeTunnel(): HTMLElement {
  for (const id of ['wormhole-tunnel', 'bh-forward-blackout', 'bh-transition-veil']) {
    document.getElementById(id)?.remove();
  }

  const tunnel = document.createElement('div');
  tunnel.id = 'wormhole-tunnel';
  tunnel.className = 'wormhole-tunnel';

  // Layer 1: Deep space nebula
  const nebula = document.createElement('div');
  nebula.className = 'wt-nebula';
  tunnel.appendChild(nebula);

  // Layer 2: Staggered tunnel rings — 12 rings rushing from center outward
  const rings = document.createElement('div');
  rings.className = 'wt-rings';
  for (let i = 0; i < 12; i++) {
    const ring = document.createElement('div');
    ring.className = 'wt-ring';
    ring.style.animationDelay = `${i * 65}ms`;
    rings.appendChild(ring);
  }
  tunnel.appendChild(rings);

  // Layer 3: Speed streaks (conic-gradient, persistent rotation after rush)
  const streaks = document.createElement('div');
  streaks.className = 'wt-streaks';
  tunnel.appendChild(streaks);

  // Layer 4: Central vanishing-point core
  const core = document.createElement('div');
  core.className = 'wt-core';
  tunnel.appendChild(core);

  // Layer 5: Sustained cruise glow (visible if page takes time to load)
  const cruise = document.createElement('div');
  cruise.className = 'wt-cruise';
  tunnel.appendChild(cruise);

  // Layer 6: Exit flash bloom
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
      tunnel.style.transition = 'opacity 0.6s ease-out';
      tunnel.style.opacity = '0';
      setTimeout(() => tunnel.remove(), 700);
    }
    for (const id of ['bh-forward-blackout', 'bh-transition-veil']) {
      document.getElementById(id)?.remove();
    }
  }, delayMs);
}
