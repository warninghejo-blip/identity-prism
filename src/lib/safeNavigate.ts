/**
 * Safe navigation helpers.
 * goBack() always returns to the app hub fallback instead of relying on browser history.
 * Also cleans up any lingering wormhole tunnel overlays.
 *
 * The depth counter is still tracked so callers can reset page state consistently.
 */
import type { NavigateFunction } from 'react-router-dom';

const NAV_DEPTH_KEY = 'prism_internal_nav_depth';
const AUTH_JWT_KEY = 'ip_auth_jwt';
const EXTERNAL_WALLET_RETURN_GUARD_KEY = 'ip_external_wallet_return_guard';
const EXTERNAL_WALLET_RETURN_GUARD_TTL_MS = 5 * 60 * 1000;
const NATIVE_SESSION_RESTORE_KEY = 'ip_native_wallet_session';
const NATIVE_SESSION_RESTORE_WINDOW_MS = 90_000;

type ExternalWalletReturnGuard = {
  armedAt: number;
  sawBackground: boolean;
};

type NativeSessionRestoreMarker = {
  armedAt: number;
};

function looksLikeSolanaAddress(value: string | null | undefined): value is string {
  return Boolean(value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value));
}

function parseStoredJwtAddress(raw: string | null): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as { address?: string };
    return looksLikeSolanaAddress(parsed.address) ? parsed.address : '';
  } catch {
    return '';
  }
}

function hasRecentNativeSessionRestore(): boolean {
  const isFresh = (raw: string | null) => {
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as NativeSessionRestoreMarker;
      return Boolean(parsed?.armedAt && Date.now() - parsed.armedAt <= NATIVE_SESSION_RESTORE_WINDOW_MS);
    } catch {
      return false;
    }
  };

  try {
    return isFresh(sessionStorage.getItem(NATIVE_SESSION_RESTORE_KEY)) || isFresh(localStorage.getItem(NATIVE_SESSION_RESTORE_KEY));
  } catch {
    return false;
  }
}

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

function readExternalWalletReturnGuard(): ExternalWalletReturnGuard | null {
  try {
    const raw = sessionStorage.getItem(EXTERNAL_WALLET_RETURN_GUARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExternalWalletReturnGuard;
    if (!parsed?.armedAt || Date.now() - parsed.armedAt > EXTERNAL_WALLET_RETURN_GUARD_TTL_MS) {
      sessionStorage.removeItem(EXTERNAL_WALLET_RETURN_GUARD_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeExternalWalletReturnGuard(guard: ExternalWalletReturnGuard | null) {
  try {
    if (!guard) {
      sessionStorage.removeItem(EXTERNAL_WALLET_RETURN_GUARD_KEY);
      return;
    }
    sessionStorage.setItem(EXTERNAL_WALLET_RETURN_GUARD_KEY, JSON.stringify(guard));
  } catch {
    /* ignore */
  }
}

/** Call this when navigating to a sub-page to track internal depth. */
export function trackInternalNavigation() {
  setInternalNavDepth(getInternalNavDepth() + 1);
}

/** Arm before handing off to an external wallet sheet so the next synthetic native back can be ignored. */
export function armExternalWalletReturnGuard() {
  writeExternalWalletReturnGuard({
    armedAt: Date.now(),
    sawBackground: false,
  });
}

/** Mark that the app really left the foreground while a wallet sheet handoff was armed. */
export function markExternalWalletBackground() {
  const guard = readExternalWalletReturnGuard();
  if (!guard || guard.sawBackground) return;
  writeExternalWalletReturnGuard({ ...guard, sawBackground: true });
}

/** True only during the short post-handoff window after the app really returned from an external wallet. */
export function hasRecentExternalWalletBackground(): boolean {
  return Boolean(readExternalWalletReturnGuard()?.sawBackground);
}

/** Consume the one-shot guard when the app receives the stray back/popstate on wallet return. */
export function consumeExternalWalletReturnGuard(): boolean {
  const guard = readExternalWalletReturnGuard();
  if (!guard?.sawBackground) return false;
  writeExternalWalletReturnGuard(null);
  return true;
}

export function getAppHubFallback(): string {
  let address = '';
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const searchAddress = searchParams.get('address');
    if (looksLikeSolanaAddress(searchAddress)) address = searchAddress;
  } catch {
    /* ignore */
  }

  if (!address) {
    try {
      const storedAddress = sessionStorage.getItem('prism_active_address');
      if (looksLikeSolanaAddress(storedAddress)) address = storedAddress;
    } catch {
      /* ignore */
    }
  }

  if (!address && hasRecentNativeSessionRestore()) {
    try {
      const storedAddress = localStorage.getItem('prism_active_address');
      if (looksLikeSolanaAddress(storedAddress)) address = storedAddress;
    } catch {
      /* ignore */
    }
  }

  if (!address) {
    try {
      address = parseStoredJwtAddress(sessionStorage.getItem(AUTH_JWT_KEY));
    } catch {
      /* ignore */
    }
  }

  if (!address && hasRecentNativeSessionRestore()) {
    try {
      address = parseStoredJwtAddress(localStorage.getItem(AUTH_JWT_KEY));
    } catch {
      /* ignore */
    }
  }

  return address ? `/app?address=${encodeURIComponent(address)}` : '/app';
}

export function goBack(navigate: NavigateFunction, fallback = getAppHubFallback()) {
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
