/**
 * Safe navigation helpers.
 * goBack() always returns to the app fallback instead of relying on browser history.
 * Also cleans up any lingering wormhole tunnel overlays.
 *
 * The depth counter is still tracked so callers can reset page state consistently.
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
  } catch {
    /* */
  }
}

/** Call this when navigating to a sub-page to track internal depth. */
export function trackInternalNavigation() {
  setInternalNavDepth(getInternalNavDepth() + 1);
}

export function goBack(navigate: NavigateFunction, fallback = '/') {
  cleanupOverlays();
  try {
    sessionStorage.setItem('returnedFromSubPage', '1');
  } catch {}
  setInternalNavDepth(0);
  navigate(fallback, { replace: true, state: { fromSubPage: true } });
}

export function cleanupOverlays() {
  // Remove legacy transition overlays immediately
  for (const id of ['wormhole-tunnel', 'bh-forward-blackout', 'bh-transition-veil', 'app-preloader']) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
  // fade-overlay: let fadeOutTransition handle it gracefully if present;
  // only force-remove if it's stuck (opacity already 0 or missing transition)
  const fadeEl = document.getElementById('fade-overlay');
  if (fadeEl) {
    const opacity = parseFloat(getComputedStyle(fadeEl).opacity);
    if (opacity < 0.01) fadeEl.remove();
  }
}
