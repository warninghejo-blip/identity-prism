/**
 * Lightweight fade transitions replacing the heavy wormhole tunnel.
 * Creates a simple opacity overlay for page navigation.
 */

export function startFadeTransition(onNavigate: () => void, durationMs = 300): void {
  // Remove any existing overlay
  const existing = document.getElementById('fade-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'fade-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999',
    background: '#030308',
    opacity: '0',
    transition: `opacity ${durationMs}ms ease-in-out`,
    pointerEvents: 'all',
  });
  document.body.appendChild(overlay);

  // Force reflow then fade in
  void overlay.offsetHeight;
  overlay.style.opacity = '1';

  setTimeout(() => {
    onNavigate();
  }, durationMs);
}

export function fadeOutTransition(delayMs = 200): void {
  // Wait for page to actually render before removing overlay
  const remove = () => {
    const overlay = document.getElementById('fade-overlay');
    if (!overlay) return;
    overlay.style.transition = 'opacity 300ms ease-in-out';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 320);
  };
  // Use requestAnimationFrame to ensure at least one paint happened
  setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(remove)), delayMs);
}
