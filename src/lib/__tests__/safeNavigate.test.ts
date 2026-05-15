/**
 * safeNavigate — unit tests for internal nav depth tracking and goBack logic.
 * Uses jsdom (via vitest config) — sessionStorage and document are available.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  armExternalWalletReturnGuard,
  cleanupOverlays,
  consumeExternalWalletReturnGuard,
  getAppHubFallback,
  goBack,
  markExternalWalletBackground,
  trackInternalNavigation,
} from '../safeNavigate';

const NAV_DEPTH_KEY = 'prism_internal_nav_depth';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  // Clean up any overlays left from previous test
  ['wormhole-tunnel', 'bh-forward-blackout', 'bh-transition-veil', 'app-preloader', 'fade-overlay'].forEach((id) => {
    document.getElementById(id)?.remove();
  });
});

describe('trackInternalNavigation', () => {
  it('starts at 0 and increments on first call', () => {
    trackInternalNavigation();
    expect(sessionStorage.getItem(NAV_DEPTH_KEY)).toBe('1');
  });

  it('increments correctly on multiple calls', () => {
    trackInternalNavigation();
    trackInternalNavigation();
    trackInternalNavigation();
    expect(sessionStorage.getItem(NAV_DEPTH_KEY)).toBe('3');
  });

  it('reads existing depth and increments', () => {
    sessionStorage.setItem(NAV_DEPTH_KEY, '5');
    trackInternalNavigation();
    expect(sessionStorage.getItem(NAV_DEPTH_KEY)).toBe('6');
  });
});

describe('goBack', () => {
  it('calls navigate with "/app" and replace:true by default', () => {
    const navigate = vi.fn();
    goBack(navigate);
    expect(navigate).toHaveBeenCalledWith('/app', { replace: true, state: { fromSubPage: true } });
  });

  it('preserves active wallet address in the app fallback', () => {
    sessionStorage.setItem('prism_active_address', '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN');
    const navigate = vi.fn();
    goBack(navigate);
    expect(navigate).toHaveBeenCalledWith('/app?address=2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN', {
      replace: true,
      state: { fromSubPage: true },
    });
  });

  it('resets nav depth to 0', () => {
    sessionStorage.setItem(NAV_DEPTH_KEY, '4');
    const navigate = vi.fn();
    goBack(navigate);
    expect(sessionStorage.getItem(NAV_DEPTH_KEY)).toBe('0');
  });

  it('sets returnedFromSubPage flag in sessionStorage', () => {
    const navigate = vi.fn();
    goBack(navigate);
    expect(sessionStorage.getItem('returnedFromSubPage')).toBe('1');
  });
});

describe('getAppHubFallback', () => {
  it('uses jwt address when active address is absent', () => {
    sessionStorage.setItem(
      'ip_auth_jwt',
      JSON.stringify({
        token: 'token',
        address: '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN',
        expiresAt: Date.now() + 1000,
      }),
    );
    expect(getAppHubFallback()).toBe('/app?address=2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN');
  });

  it('ignores legacy localStorage auth restore on cold start', () => {
    localStorage.setItem(
      'ip_auth_jwt',
      JSON.stringify({
        token: 'token',
        address: '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN',
        expiresAt: Date.now() + 1000,
      }),
    );
    localStorage.setItem('prism_active_address', '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN');

    expect(getAppHubFallback()).toBe('/app');
  });
});

describe('external wallet return guard', () => {
  it('does not consume before the app actually backgrounds', () => {
    armExternalWalletReturnGuard();
    expect(consumeExternalWalletReturnGuard()).toBe(false);
  });

  it('consumes exactly once after a wallet background handoff', () => {
    armExternalWalletReturnGuard();
    markExternalWalletBackground();
    expect(consumeExternalWalletReturnGuard()).toBe(true);
    expect(consumeExternalWalletReturnGuard()).toBe(false);
  });
});

describe('cleanupOverlays', () => {
  it('removes known overlay elements by id', () => {
    ['wormhole-tunnel', 'bh-forward-blackout', 'bh-transition-veil', 'app-preloader'].forEach((id) => {
      const el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    });

    cleanupOverlays();

    ['wormhole-tunnel', 'bh-forward-blackout', 'bh-transition-veil', 'app-preloader'].forEach((id) => {
      expect(document.getElementById(id)).toBeNull();
    });
  });

  it('does not throw when overlays are absent', () => {
    expect(() => cleanupOverlays()).not.toThrow();
  });

  it('removes a stuck fade-overlay (opacity=0)', () => {
    const el = document.createElement('div');
    el.id = 'fade-overlay';
    el.style.opacity = '0';
    document.body.appendChild(el);

    cleanupOverlays();

    // opacity is 0 in jsdom → element should be removed
    expect(document.getElementById('fade-overlay')).toBeNull();
  });
});
