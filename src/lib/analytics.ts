import { Capacitor } from '@capacitor/core';

// ---------------------------------------------------------------------------
// Unified Analytics Module
// - Native (Capacitor Android/iOS) → @capacitor-firebase/analytics
// - Web browser → firebase/analytics (web SDK)
// - No config / dev mode → all calls silently no-op
// ---------------------------------------------------------------------------

let isNative = false;
let ready = false;

// Capacitor plugin reference (loaded dynamically)
let capFirebase: typeof import('@capacitor-firebase/analytics').FirebaseAnalytics | null = null;

// Web SDK references (loaded dynamically)
let webAnalytics: import('firebase/analytics').Analytics | null = null;
let webLogEvent: typeof import('firebase/analytics').logEvent | null = null;

/** Initialise analytics — call once at app startup. */
export async function initAnalytics(): Promise<void> {
  try {
    isNative = Capacitor.isNativePlatform();

    if (isNative) {
      // Native: Capacitor Firebase plugin handles everything via google-services.json
      const mod = await import('@capacitor-firebase/analytics');
      capFirebase = mod.FirebaseAnalytics;
      await capFirebase.setEnabled({ enabled: true });
      ready = true;
      if (import.meta.env.DEV) console.log('[Analytics] Native Firebase ready');
    } else {
      // Web: needs VITE_FIREBASE_* env vars
      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
      if (!apiKey || !projectId) {
        if (import.meta.env.DEV) console.log('[Analytics] No Firebase config — analytics disabled');
        return;
      }

      const { initializeApp } = await import('firebase/app');
      const { getAnalytics, logEvent, isSupported } = await import('firebase/analytics');

      const supported = await isSupported();
      if (!supported) {
        if (import.meta.env.DEV) console.log('[Analytics] Web analytics not supported in this browser');
        return;
      }

      const app = initializeApp({
        apiKey,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
        measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
      });

      webAnalytics = getAnalytics(app);
      webLogEvent = logEvent;
      ready = true;
      if (import.meta.env.DEV) console.log('[Analytics] Web Firebase ready');
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[Analytics] Init failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** Log a custom event. Silently no-ops when analytics is not initialised. */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (!ready) return;
  try {
    if (isNative && capFirebase) {
      capFirebase.logEvent({ name, params: params as Record<string, string> });
    } else if (webAnalytics && webLogEvent) {
      webLogEvent(webAnalytics, name, params);
    }
  } catch { /* silent */ }
}

/** Log a page/screen view. */
export function trackPageView(path: string): void {
  if (!ready) return;
  try {
    if (isNative && capFirebase) {
      capFirebase.setCurrentScreen({ screenName: path, screenClassOverride: path });
    } else if (webAnalytics && webLogEvent) {
      webLogEvent(webAnalytics, 'page_view', { page_path: path });
    }
  } catch { /* silent */ }
}

// ---------------------------------------------------------------------------
// Named event helpers
// ---------------------------------------------------------------------------

export function trackWalletConnect(method: string): void {
  trackEvent('wallet_connect', { method });
}

export function trackWalletDisconnect(): void {
  trackEvent('wallet_disconnect');
}

export function trackMint(success: boolean, error?: string): void {
  trackEvent('nft_mint', { success, ...(error ? { error } : {}) });
}

export function trackGameStart(game: string): void {
  trackEvent('game_start', { game });
}

export function trackGameOver(game: string, score?: number, victory?: boolean): void {
  trackEvent('game_over', { game, ...(score != null ? { score } : {}), ...(victory != null ? { victory } : {}) });
}

export function trackChallengeCreate(): void {
  trackEvent('challenge_create');
}

export function trackChallengeAccept(): void {
  trackEvent('challenge_accept');
}

export function trackCompare(): void {
  trackEvent('compare_wallets');
}

export function trackForgePurchase(item: string, price: number): void {
  trackEvent('forge_purchase', { item, price });
}

export function trackConstellationSearch(): void {
  trackEvent('constellation_search');
}
