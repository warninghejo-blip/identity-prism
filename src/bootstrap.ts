import { Buffer } from 'buffer';
import * as Sentry from '@sentry/react';
import { initAnalytics } from './lib/analytics';
import { installMwaLoopbackPatch } from './lib/mwaLoopback';

declare global {
  interface Window {
    Buffer: typeof Buffer;
  }
}

let initialized = false;

/**
 * Bootstrap shared initialisation for both web and app targets.
 * Polyfills Buffer, installs MWA loopback patch, initialises Sentry + analytics.
 * Safe to call multiple times — runs only once.
 */
export function init() {
  if (initialized) return;
  initialized = true;

  const SENTRY_DSN_CLIENT = import.meta.env.VITE_SENTRY_DSN;
  if (SENTRY_DSN_CLIENT) {
    Sentry.init({
      dsn: SENTRY_DSN_CLIENT,
      tracesSampleRate: 0.1,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_APP_VERSION || 'dev',
    });
  }

  if (!window.Buffer) window.Buffer = Buffer;
  if (!globalThis.Buffer) globalThis.Buffer = Buffer;
  installMwaLoopbackPatch();

  initAnalytics();
  console.log('[IdentityPrism] v2.0.1');
}
