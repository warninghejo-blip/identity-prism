import React, { Component, type ReactNode, useEffect } from 'react';
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

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // DIAGNOSTIC: log full error to see crash root cause
    console.error('[LazyErrorBoundary] componentDidCatch error:', error);
    console.error('[LazyErrorBoundary] componentDidCatch errorInfo:', info?.componentStack);
    // DIAGNOSTIC: persist to localStorage for ADB extraction
    try {
      localStorage.setItem(
        '__diag_last_error',
        JSON.stringify({
          message: error?.message,
          stack: error?.stack,
          componentStack: info?.componentStack,
          ts: Date.now(),
        }),
      );
    } catch {}
    // Dynamic import failures (e.g. after HMR reconnect) — retry once
    if (!this.state.retried && error.message?.includes('dynamically imported module')) {
      this.setState({ hasError: false, retried: true });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
            <p style={{ marginBottom: 12 }}>Page failed to load.</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, retried: false });
              }}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.05)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

/** Wrap lazy component in error boundary */
const LazyFallback = () => <div className="fixed inset-0 bg-[#05070a] z-[999]" />;

function lazyRoute(element: ReactNode) {
  return (
    <LazyErrorBoundary>
      <React.Suspense fallback={<LazyFallback />}>{element}</React.Suspense>
    </LazyErrorBoundary>
  );
}
// wallet-adapter CSS imported eagerly in main.tsx to avoid lazy CSS dep
import { mwaAuthorizationCache } from './lib/mwaAuthorizationCache';
import { BLACKHOLE_ENABLED, getHeliusRpcUrl, MINT_CONFIG } from './constants';
import { DEV_WALLET_ENABLED } from './lib/devWallet';
import { DevWalletProvider } from './components/DevWalletProvider';

const BlackHole = React.lazy(() => import('./pages/BlackHole'));
const PreviewDeck = React.lazy(() => import('./pages/PreviewDeck'));
const PrismLeague = React.lazy(() => import('./pages/PrismLeague'));
const Verify = React.lazy(() => import('./pages/Verify'));
const Compare = React.lazy(() => import('./pages/Compare'));
const HomePage = React.lazy(() => import('./pages/HomePage'));
const StellarForge = React.lazy(() => import('./pages/StellarForge'));
const PrismScanner = React.lazy(() => import('./pages/PrismScanner'));
const PrismArena = React.lazy(() => import('./pages/PrismArena'));
const PrismVault = React.lazy(() => import('./pages/PrismVault'));
// ConstellationNetwork removed — redirects to /scan below
const QuestsPage = React.lazy(() => import('./pages/QuestsPage'));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));
const WalletRequired = React.lazy(() => import('./components/WalletRequired'));
// ScamChecker removed — redirects to /constellation below
const Leaderboard = React.lazy(() => import('./pages/Leaderboard'));
const TrustRecovery = React.lazy(() => import('./pages/TrustRecovery'));
const TextQuestPage = React.lazy(() => import('./pages/TextQuestPage'));
const InboxPage = React.lazy(() => import('./pages/InboxPage'));

const isCapacitorNative = Boolean(
  (
    globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor?.isNativePlatform?.(),
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

const router = createBrowserRouter(
  [
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
        { path: 'scan', element: lazyRoute(<PrismScanner />) },
        { path: 'arena', element: lazyRoute(<PrismArena />) },
        {
          path: 'vault',
          element: lazyRoute(
            <WalletRequired>
              <PrismVault />
            </WalletRequired>,
          ),
        },
        { path: 'market', element: <Navigate to="/arena" replace /> },
        { path: 'constellation', element: <Navigate to="/scan" replace /> },
        {
          path: 'quests',
          element: lazyRoute(
            <WalletRequired>
              <QuestsPage />
            </WalletRequired>,
          ),
        },
        { path: 'profile/:address', element: lazyRoute(<ProfilePage />) },
        { path: 'scam-checker', element: <Navigate to="/scan" replace /> },
        { path: 'leaderboard', element: lazyRoute(<Leaderboard />) },
        {
          path: 'recovery',
          element: lazyRoute(
            <WalletRequired>
              <TrustRecovery />
            </WalletRequired>,
          ),
        },
        {
          path: 'text-quest',
          element: lazyRoute(
            <WalletRequired>
              <TextQuestPage />
            </WalletRequired>,
          ),
        },

        { path: 'inbox', element: lazyRoute(<InboxPage />) },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  routerOptions,
);

const cluster =
  MINT_CONFIG.NETWORK === 'devnet'
    ? WalletAdapterNetwork.Devnet
    : MINT_CONFIG.NETWORK === 'testnet'
      ? WalletAdapterNetwork.Testnet
      : WalletAdapterNetwork.Mainnet;

const appIdentity = {
  name: 'Identity Prism',
  uri: (import.meta.env.VITE_APP_BASE_URL || 'https://identityprism.xyz').replace(/\/+$/, ''),
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
  console.warn('Helius proxy URL missing. Wallet RPC will fall back to the public Solana endpoint.');
}
const endpoint = heliusRpcUrl ?? 'https://api.mainnet-beta.solana.com';

const searchParams = new URLSearchParams(window.location.search);
const isCaptureMode = searchParams.has('capture');
const debugEnabled =
  !isCaptureMode &&
  !import.meta.env.PROD &&
  (import.meta.env.DEV || searchParams.has('debug') || window.localStorage?.getItem('debug') === 'true');

// Debug console disabled — too intrusive
const DebugConsole: React.ComponentType | null = null;

export default function AppShell() {
  // Android hardware back button: prevent going to landing page, minimize instead
  useEffect(() => {
    if (!isCapacitorNative) return;

    // Push a sentinel entry so there's always something to pop back to
    window.history.pushState({ __appHub: true }, '', window.location.href);

    const handler = () => {
      const path = window.location.pathname.replace(/\/+$/, '') || '/';
      const isHub = path === '/' || path === '/app' || path === '';
      if (isHub) {
        // Re-push sentinel so next back also minimizes
        window.history.pushState({ __appHub: true }, '', window.location.href);
        // Minimize app via Capacitor if available
        const cap = (
          globalThis as typeof globalThis & { Capacitor?: { Plugins?: { App?: { minimizeApp?: () => void } } } }
        ).Capacitor;
        cap?.Plugins?.App?.minimizeApp?.();
      } else {
        // Go to hub instead of browser history back
        router.navigate('/app', { replace: false });
      }
    };

    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const walletContent = DEV_WALLET_ENABLED ? (
    // Dev mode: bypass Seed Vault entirely — use hardcoded test keypair
    <DevWalletProvider>
      <WalletModalProvider>
        <React.Suspense
          fallback={<div style={{ position: 'fixed', inset: 0, background: '#05070a', zIndex: 999998 }} />}
        >
          <RouterProvider router={router} />
        </React.Suspense>
      </WalletModalProvider>
    </DevWalletProvider>
  ) : (
    <CustomWalletProvider wallets={wallets} autoConnect={false} localStorageKey="walletAdapter">
      <DebugWallet />
      <WalletModalProvider>
        <React.Suspense
          fallback={<div style={{ position: 'fixed', inset: 0, background: '#05070a', zIndex: 999998 }} />}
        >
          <RouterProvider router={router} />
        </React.Suspense>
      </WalletModalProvider>
    </CustomWalletProvider>
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      {DebugConsole && (
        <React.Suspense fallback={null}>
          <DebugConsole />
        </React.Suspense>
      )}
      {walletContent}
    </ConnectionProvider>
  );
}
