import React, { Component, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { CustomWalletProvider } from './components/CustomWalletProvider';
import { DebugWallet } from './components/DebugWallet';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-adapter-mobile';
import App from './App';
import Index from './pages/Index';
import NotFound from './pages/NotFound';

/** Error boundary that catches lazy-import failures and retries once. */
class LazyErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean; retried: boolean }
> {
  state = { hasError: false, retried: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Dynamic import failures (e.g. after HMR reconnect) — retry once
    if (!this.state.retried && error.message?.includes('dynamically imported module')) {
      this.setState({ hasError: false, retried: true });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
          <p style={{ marginBottom: 12 }}>Page failed to load.</p>
          <button
            onClick={() => { this.setState({ hasError: false, retried: false }); }}
            style={{
              padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Wrap lazy component in error boundary */
function lazyRoute(element: ReactNode) {
  return <LazyErrorBoundary><React.Suspense fallback={null}>{element}</React.Suspense></LazyErrorBoundary>;
}
// wallet-adapter CSS imported eagerly in main.tsx to avoid lazy CSS dep
import { mwaAuthorizationCache } from './lib/mwaAuthorizationCache';
import { BLACKHOLE_ENABLED, getHeliusRpcUrl, MINT_CONFIG } from './constants';

const BlackHole = React.lazy(() => import('./pages/BlackHole'));
const PreviewDeck = React.lazy(() => import('./pages/PreviewDeck'));
const PrismLeague = React.lazy(() => import('./pages/PrismLeague'));
const Verify = React.lazy(() => import('./pages/Verify'));
const Compare = React.lazy(() => import('./pages/Compare'));
const HomePage = React.lazy(() => import('./pages/HomePage'));
const StellarForge = React.lazy(() => import('./pages/StellarForge'));
const NebulaMarket = React.lazy(() => import('./pages/NebulaMarket'));
const ConstellationNetwork = React.lazy(() => import('./pages/ConstellationNetwork'));
const QuestsPage = React.lazy(() => import('./pages/QuestsPage'));
// ScamChecker removed — redirects to /constellation below
// Marketplace merged into StellarForge — redirect below
const Leaderboard = React.lazy(() => import('./pages/Leaderboard'));

const isCapacitorNative = Boolean(
  (globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform?.()
);

// Clear MWA cache on load but keep walletAdapter for session persistence
try {
  localStorage.removeItem('SolanaMobileWalletAdapterDefaultAuthorizationCache');
} catch {}

// Removed: visibilitychange→blur was disconnecting wallet on app minimize

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
      { path: 'home', element: lazyRoute(<HomePage />) },
      { path: 'share', element: <Index /> },
      { path: 'game', element: lazyRoute(<PrismLeague />) },
      { path: 'preview', element: lazyRoute(<PreviewDeck />) },
      { path: 'preview/:tier', element: lazyRoute(<PreviewDeck />) },
      { path: 'verify', element: lazyRoute(<Verify />) },
      { path: 'compare', element: lazyRoute(<Compare />) },
      { path: 'forge', element: lazyRoute(<StellarForge />) },
      { path: 'market', element: lazyRoute(<NebulaMarket />) },
      { path: 'constellation', element: lazyRoute(<ConstellationNetwork />) },
      { path: 'timewarp', element: <Navigate to="/" replace /> },
      { path: 'quests', element: lazyRoute(<QuestsPage />) },
      { path: 'scam-checker', element: <Navigate to="/constellation" replace /> },
      { path: 'marketplace', element: <Navigate to="/forge" replace /> },
      { path: 'leaderboard', element: lazyRoute(<Leaderboard />) },
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

const wallets = [mobileWalletAdapter, new PhantomWalletAdapter(), new SolflareWalletAdapter()];
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

let DebugConsole: React.ComponentType | null = null;
if (debugEnabled) {
  // Only import in debug mode
  DebugConsole = React.lazy(() => import('./components/DebugConsole'));
}

export default function AppShell() {
  return (
    <ConnectionProvider endpoint={endpoint}>
      {DebugConsole && (
        <React.Suspense fallback={null}>
          <DebugConsole />
        </React.Suspense>
      )}
      <CustomWalletProvider
        wallets={wallets}
        autoConnect={false}
        localStorageKey="walletAdapter"
      >
        <DebugWallet />
        <WalletModalProvider>
          <React.Suspense fallback={<div style={{position:'fixed',inset:0,background:'#05070a',zIndex:999998}} />}>
            <RouterProvider router={router} />
          </React.Suspense>
        </WalletModalProvider>
      </CustomWalletProvider>
    </ConnectionProvider>
  );
}
