import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import { initAnalytics } from './lib/analytics';
import { installMwaLoopbackPatch } from './lib/mwaLoopback';
import * as Sentry from '@sentry/react';
import AppShell from './AppShell';
import './index.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import './styles/wallet-adapter-local.css';

const SENTRY_DSN_CLIENT = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN_CLIENT) {
  Sentry.init({
    dsn: SENTRY_DSN_CLIENT,
    tracesSampleRate: 0.1,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION || 'dev',
  });
}

declare global {
  interface Window {
    Buffer: typeof Buffer;
  }
}

if (!window.Buffer) window.Buffer = Buffer;
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
installMwaLoopbackPatch();

initAnalytics();
console.log('[IdentityPrism] v2.0.1');
const root = document.getElementById('root');
ReactDOM.createRoot(root!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
