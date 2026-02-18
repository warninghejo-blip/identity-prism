import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import './index.css';
import '@solana/wallet-adapter-react-ui/styles.css';

declare global {
  interface Window {
    Buffer: typeof Buffer;
  }
}

if (!window.Buffer) window.Buffer = Buffer;
if (!globalThis.Buffer) globalThis.Buffer = Buffer;

// Lazy-load the entire app shell (wallet providers + router + pages).
// This keeps vendor-solana (~580KB) OFF the critical render path so
// React can mount and show the Suspense fallback almost instantly.
const AppShell = React.lazy(() => import('./AppShell'));

console.log("[IdentityPrism] v2.0.1");
const root = document.getElementById("root");
ReactDOM.createRoot(root!).render(
  <React.StrictMode>
    <React.Suspense fallback={<div style={{position:'fixed',inset:0,background:'#05070a',zIndex:999998}} />}>
      <AppShell />
    </React.Suspense>
  </React.StrictMode>
);
