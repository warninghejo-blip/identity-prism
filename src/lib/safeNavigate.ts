/**
 * Safe navigation helpers.
 * goBack() navigates to previous page if history exists, otherwise falls back to /app.
 * Also cleans up any lingering wormhole tunnel overlays.
 *
 * Uses a sessionStorage counter to track internal navigation depth instead of
 * window.history.length, which includes external sites and can navigate the user
 * away from the app.
 */
import type { NavigateFunction } from 'react-router-dom';

const NAV_DEPTH_KEY = 'prism_internal_nav_depth';

function getInternalNavDepth(): number {
  try {
    return parseInt(sessionStorage.getItem(NAV_DEPTH_KEY) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

function setInternalNavDepth(depth: number) {
  try {
    sessionStorage.setItem(NAV_DEPTH_KEY, String(Math.max(0, depth)));
  } catch { /* */ }
}

/** Call this when navigating to a sub-page to track internal depth. */
export function trackInternalNavigation() {
  setInternalNavDepth(getInternalNavDepth() + 1);
}

export function goBack(navigate: NavigateFunction, fallback = '/app') {
  // Clean up any lingering wormhole tunnels that might block UI
  cleanupOverlays();

  const depth = getInternalNavDepth();
  // Only go back if we have tracked internal navigation history
  if (depth > 0) {
    setInternalNavDepth(depth - 1);
    navigate(-1);
  } else {
    // Pass state so Index.tsx knows we're returning from a sub-page and shouldn't disconnect wallet
    navigate(fallback, { replace: true, state: { fromSubPage: true } });
  }
}

export function cleanupOverlays() {
  for (const id of ['wormhole-tunnel', 'bh-forward-blackout', 'bh-transition-veil']) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
}
