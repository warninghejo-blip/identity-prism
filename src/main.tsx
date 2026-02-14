import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-adapter-mobile';
import App from './App';
import Index from './pages/Index';
import NotFound from './pages/NotFound';

const BlackHole = React.lazy(() => import('./pages/BlackHole'));
const PreviewDeck = React.lazy(() => import('./pages/PreviewDeck'));
const Verify = React.lazy(() => import('./pages/Verify'));
import DebugConsole from './components/DebugConsole';
import './index.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { Buffer } from 'buffer';
import { mwaAuthorizationCache } from './lib/mwaAuthorizationCache';
import { BLACKHOLE_ENABLED, getHeliusRpcUrl, MINT_CONFIG } from './constants';

declare global {
  interface Window {
    Buffer: typeof Buffer;
  }
}

if (!window.Buffer) {
  window.Buffer = Buffer;
}

if (!globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

const isCapacitorNative = Boolean(
  (globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform?.()
);
const isMobileUserAgent = /android|iphone|ipad|ipod/i.test(globalThis.navigator?.userAgent ?? "");

// Always clear stored wallet on page load so user picks wallet manually each time
try {
  localStorage.removeItem('walletAdapter');
  localStorage.removeItem('SolanaMobileWalletAdapterDefaultAuthorizationCache');
} catch {}

if (isCapacitorNative && typeof document !== 'undefined') {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      window.dispatchEvent(new Event('blur'));
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
}

const routerOptions: Parameters<typeof createBrowserRouter>[1] = {
  future: {
    v7_relativeSplatPath: true,
  },
};

const router = createBrowserRouter([
  {
    path: '/blackhole',
    element: BLACKHOLE_ENABLED ? <BlackHole /> : <Navigate to="/" replace />,
  },
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Index /> },
      { path: 'app', element: <Index /> },
      { path: 'app/*', element: <Index /> },
      { path: 'share', element: <Index /> },
      { path: 'preview', element: <PreviewDeck /> },
      { path: 'preview/:tier', element: <PreviewDeck /> },
      { path: 'verify', element: <Verify /> },
      { path: '*', element: <NotFound /> },
    ],
  },
], routerOptions);

const cluster =
  MINT_CONFIG.NETWORK === 'devnet'
    ? WalletAdapterNetwork.Devnet
    : MINT_CONFIG.NETWORK === 'testnet'
      ? WalletAdapterNetwork.Testnet
      : WalletAdapterNetwork.Mainnet;

const appIdentity = {
  name: 'Identity Prism',
  uri: 'https://identityprism.xyz',
};

const mobileWalletAdapter = new SolanaMobileWalletAdapter({
  addressSelector: createDefaultAddressSelector(),
  appIdentity,
  cluster,
  authorizationResultCache: mwaAuthorizationCache,
  onWalletNotFound: createDefaultWalletNotFoundHandler(),
});

const wallets = [mobileWalletAdapter, new PhantomWalletAdapter()];
const heliusRpcUrl = getHeliusRpcUrl();
if (!heliusRpcUrl) {
  console.error('Helius API key missing. Wallet scan requires VITE_HELIUS_API_KEYS.');
}
const endpoint = heliusRpcUrl ?? 'https://api.mainnet-beta.solana.com';

const searchParams = new URLSearchParams(window.location.search);
const isCaptureMode = searchParams.has('capture');
const debugEnabled =
  !isCaptureMode &&
  !import.meta.env.PROD &&
  (import.meta.env.DEV ||
    searchParams.has('debug') ||
    window.localStorage?.getItem('debug') === 'true');

console.log("[IdentityPrism] v2.0.1");
const root = document.getElementById("root");
ReactDOM.createRoot(root!).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      {debugEnabled && <DebugConsole />}
      <WalletProvider
        wallets={wallets}
        autoConnect={false}
        localStorageKey="walletAdapter"
      >
        <WalletModalProvider>
          <React.Suspense fallback={<div className="fixed inset-0 bg-[#050505]" />}>
            <RouterProvider router={router} />
          </React.Suspense>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);
