/**
 * Lightweight fade transitions for page navigation.
 * Creates a simple opacity overlay that fades in before navigate,
 * then fades out after the new page mounts.
 */

export function startFadeTransition(onNavigate: () => void, durationMs = 250): void {
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
    try {
      onNavigate();
    } catch (e) {
      console.error('[fadeTransition] onNavigate failed:', e);
      // Remove stuck overlay so app is not blocked
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => overlay.remove(), 300);
    }
  }, durationMs);
}

export function fadeOutTransition(delayMs = 50): void {
  const doFadeOut = () => {
    const overlay = document.getElementById('fade-overlay');
    if (!overlay) return;
    overlay.style.transition = 'opacity 250ms ease-in-out';
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    setTimeout(() => overlay.remove(), 270);
  };

  // Single rAF after short delay — enough for React to paint
  setTimeout(() => requestAnimationFrame(doFadeOut), delayMs);
}
