import React, { Component, type ReactNode, useEffect } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { CustomWalletProvider } from './components/CustomWalletProvider';
import { DebugWallet } from './components/DebugWallet';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-adapter-mobile';
import App from './App';
import Index from './pages-app/Index';
import NotFound from './pages-app/NotFound';
import BlackHole from './pages-app/BlackHole';
import InboxPage from './pages-app/InboxPage';
import { consumeExternalWalletReturnGuard, getAppHubFallback, markExternalWalletBackground } from './lib/safeNavigate';
import { resolveNativeAppPath } from './lib/nativeAppUrl';

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
    console.error('[LazyErrorBoundary] componentDidCatch error:', error);
    console.error('[LazyErrorBoundary] componentDidCatch errorInfo:', info?.componentStack);
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

const LazyFallback = () => <div className="fixed inset-0 bg-[#05070a] z-[999]" />;

function lazyRoute(element: ReactNode) {
  return (
    <LazyErrorBoundary>
      <React.Suspense fallback={<LazyFallback />}>{element}</React.Suspense>
    </LazyErrorBoundary>
  );
}

import { mwaAuthorizationCache } from './lib/mwaAuthorizationCache';
import { BLACKHOLE_ENABLED, getHeliusRpcUrl, MINT_CONFIG } from './constants';
import { DEV_WALLET_ENABLED } from './lib/devWallet';
import { DevWalletProvider } from './components/DevWalletProvider';

const PreviewDeck = React.lazy(() => import('./pages-web/PreviewDeck'));
const PrismLeague = React.lazy(() => import('./pages-app/PrismLeague'));
const Verify = React.lazy(() => import('./pages-app/Verify'));
const Compare = React.lazy(() => import('./pages-web/Compare'));
const HomePage = React.lazy(() => import('./pages-app/HomePage'));
const StellarForge = React.lazy(() => import('./pages-app/StellarForge'));
const PrismScanner = React.lazy(() => import('./pages-app/PrismScanner'));
const PrismArena = React.lazy(() => import('./pages-app/PrismArena'));
const PrismVault = React.lazy(() => import('./pages-app/PrismVault'));
const QuestsPage = React.lazy(() => import('./pages-app/QuestsPage'));
const ProfilePage = React.lazy(() => import('./pages-app/ProfilePage'));
const WalletRequired = React.lazy(() => import('./components/WalletRequired'));
const Leaderboard = React.lazy(() => import('./pages-app/Leaderboard'));
const TrustRecovery = React.lazy(() => import('./pages-app/TrustRecovery'));
const TextQuestPage = React.lazy(() => import('./pages-app/TextQuestPage'));
const IdentityHub = React.lazy(() => import('./pages-app/IdentityHub'));
const SybilHunt = React.lazy(() => import('./pages-app/SybilHunt'));
const CardDemoPage = React.lazy(() => import('./pages-app/CardDemoPage'));
const SybilCheckerPage = React.lazy(() => import('./pages-web/SybilCheckerPage'));

const routerOptions: Parameters<typeof createHashRouter>[1] = {
  future: {
    v7_relativeSplatPath: true,
  },
};

type CapacitorAppPlugin = {
  addListener?: (
    eventName: string,
    listenerFunc: (event: { url?: string; canGoBack?: boolean }) => void,
  ) => Promise<{ remove: () => Promise<void> | void }> | { remove: () => Promise<void> | void };
  getLaunchUrl?: () => Promise<{ url?: string } | undefined>;
  minimizeApp?: () => void;
};

const getCapacitorAppPlugin = () =>
  (
    globalThis as typeof globalThis & {
      Capacitor?: { Plugins?: { App?: CapacitorAppPlugin } };
    }
  ).Capacitor?.Plugins?.App;

const navigateFromNativeUrl = (rawUrl?: string | null) => {
  const target = resolveNativeAppPath(rawUrl);
  if (!target) return;

  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === target) return;

  router.navigate(target, { replace: true }).catch(() => {
    window.location.replace(target);
  });
};

const appRoutes = [
  {
    path: '/blackhole',
    element: BLACKHOLE_ENABLED ? lazyRoute(<BlackHole />) : <Navigate to="/" replace />,
  },
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Index /> },
      { path: 'app', element: <Index /> },
      { path: 'app/*', element: <Index /> },
      { path: 'identity', element: lazyRoute(<IdentityHub />) },
      { path: 'sybil-hunt', element: <Navigate to="/sybil-check" replace /> },
      { path: 'demo', element: lazyRoute(<CardDemoPage />) },
      { path: 'sybil-check', element: lazyRoute(<SybilCheckerPage />) },
      { path: 'home', element: lazyRoute(<HomePage />) },
      { path: 'share', element: <Index /> },
      {
        path: 'game',
        element: lazyRoute(
          <WalletRequired>
            <PrismLeague />
          </WalletRequired>,
        ),
      },
      { path: 'preview', element: lazyRoute(<PreviewDeck />) },
      { path: 'preview/:tier', element: lazyRoute(<PreviewDeck />) },
      { path: 'verify', element: lazyRoute(<Verify />) },
      { path: 'compare', element: lazyRoute(<Compare />) },
      {
        path: 'forge',
        element: lazyRoute(
          <WalletRequired>
            <StellarForge />
          </WalletRequired>,
        ),
      },
      {
        path: 'scan',
        element: lazyRoute(
          <WalletRequired>
            <PrismScanner />
          </WalletRequired>,
        ),
      },
      {
        path: 'arena',
        element: lazyRoute(
          <WalletRequired>
            <PrismArena />
          </WalletRequired>,
        ),
      },
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
        element: lazyRoute(<TrustRecovery />),
      },
      {
        path: 'text-quest',
        element: lazyRoute(
          <WalletRequired>
            <TextQuestPage />
          </WalletRequired>,
        ),
      },
      {
        path: 'inbox',
        element: lazyRoute(
          <WalletRequired>
            <InboxPage />
          </WalletRequired>,
        ),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];

const router = createHashRouter(appRoutes, routerOptions);

const cluster =
  MINT_CONFIG.NETWORK === 'devnet'
    ? WalletAdapterNetwork.Devnet
    : MINT_CONFIG.NETWORK === 'testnet'
      ? WalletAdapterNetwork.Testnet
      : WalletAdapterNetwork.Mainnet;

const appIdentity = {
  name: 'Identity Prism',
  uri: 'https://identityprism.xyz',
  icon: 'icon-192.png',
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

const DebugConsole: React.ComponentType | null = null;

export default function AppShellApp() {
  useEffect(() => {
    const appPlugin = getCapacitorAppPlugin();
    if (!appPlugin) return;

    let isActive = true;
    let removeListener: (() => Promise<void> | void) | undefined;

    void appPlugin
      .getLaunchUrl?.()
      ?.then((launch) => {
        if (!isActive) return;
        navigateFromNativeUrl(launch?.url);
      })
      .catch(() => {});

    Promise.resolve(
      appPlugin.addListener?.('appUrlOpen', ({ url }) => {
        navigateFromNativeUrl(url);
      }),
    )
      .then((handle) => {
        removeListener = handle?.remove?.bind(handle);
      })
      .catch(() => {});

    return () => {
      isActive = false;
      if (removeListener) {
        void removeListener();
      }
    };
  }, []);

  // Android hardware back button: prevent going to landing page, minimize instead
  useEffect(() => {
    window.history.pushState({ __appHub: true }, '', window.location.href);
    const appPlugin = getCapacitorAppPlugin();
    let removeBackButtonListener: (() => Promise<void> | void) | undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markExternalWalletBackground();
      }
    };

    const handler = () => {
      if (consumeExternalWalletReturnGuard()) {
        window.history.pushState({ __appHub: true }, '', window.location.href);
        return;
      }
      const path = router.state.location.pathname.replace(/\/+$/, '') || '/';
      const isHub = path === '/' || path === '/app' || path === '';
      if (isHub) {
        window.history.pushState({ __appHub: true }, '', window.location.href);
        appPlugin?.minimizeApp?.();
      } else {
        router.navigate(getAppHubFallback(), { replace: false, state: { fromSubPage: true } });
      }
    };
    const nativeBackHandler = () => {
      handler();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('popstate', handler);
    window.addEventListener('identityprism:nativeBack', nativeBackHandler);
    Promise.resolve(appPlugin?.addListener?.('backButton', handler))
      .then((handle) => {
        removeBackButtonListener = handle?.remove?.bind(handle);
      })
      .catch(() => {});
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('popstate', handler);
      window.removeEventListener('identityprism:nativeBack', nativeBackHandler);
      if (removeBackButtonListener) {
        void removeBackButtonListener();
      }
    };
  }, []);

  const walletContent = DEV_WALLET_ENABLED ? (
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
