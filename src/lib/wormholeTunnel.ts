/**
 * Cosmic wormhole tunnel transition.
 * Lightweight hyperspace corridor — radial light streaks + soft glow.
 * Uses only CSS animations, no canvas/WebGL.
 */

export function createWormholeTunnel(): HTMLElement {
  // Remove any existing tunnel / legacy overlays
  for (const id of ['wormhole-tunnel', 'bh-forward-blackout', 'bh-transition-veil']) {
    document.getElementById(id)?.remove();
  }

  const tunnel = document.createElement('div');
  tunnel.id = 'wormhole-tunnel';
  tunnel.className = 'wormhole-tunnel';

  // Layer 1: Deep space backdrop with subtle nebula
  const nebula = document.createElement('div');
  nebula.className = 'wt-nebula';
  tunnel.appendChild(nebula);

  // Layer 2: Radial light streaks — the "hyperspace lines" effect
  const streaks = document.createElement('div');
  streaks.className = 'wt-streaks';
  tunnel.appendChild(streaks);

  // Layer 3: Central bright core that expands outward
  const core = document.createElement('div');
  core.className = 'wt-core';
  tunnel.appendChild(core);

  // Layer 4: Exit flash — bright bloom as you arrive
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
