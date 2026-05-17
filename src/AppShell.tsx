import React, { Component, type ReactNode, useEffect } from 'react';
import { createBrowserRouter, createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { CustomWalletProvider } from './components/CustomWalletProvider';
import { DebugWallet } from './components/DebugWallet';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import {
  SolanaMobileWalletAdapter,
  SolanaMobileWalletAdapterWalletName,
  createDefaultAddressSelector,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-adapter-mobile';
import { Capacitor } from '@capacitor/core';
import { SeedVaultAdapter } from './lib/SeedVaultAdapter';
import App from './App';
import Index from './pages/Index';
import NotFound from './pages/NotFound';
import BlackHole from './pages/BlackHole';
import InboxPage from './pages/InboxPage';
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
import { extractMwaAddress, mwaAuthorizationCache } from './lib/mwaAuthorizationCache';
import { BLACKHOLE_ENABLED, getHeliusRpcUrl, MINT_CONFIG } from './constants';
import { DEV_WALLET_ENABLED } from './lib/devWallet';
import { DevWalletProvider } from './components/DevWalletProvider';

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
// Landing pages
const LandingPage = React.lazy(() => import('./pages/LandingPage'));
const IdentityHub = React.lazy(() => import('./pages/IdentityHub'));
const SybilHunt = React.lazy(() => import('./pages/SybilHunt'));
const CardDemoPage = React.lazy(() => import('./pages/CardDemoPage'));
const SybilCheckerPage = React.lazy(() => import('./pages/SybilCheckerPage'));

const isCapacitorNative = Capacitor.isNativePlatform();

// Removed: visibilitychange→blur was disconnecting wallet on app minimize

const routerOptions: Parameters<typeof createBrowserRouter>[1] = {
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
        { index: true, element: isCapacitorNative ? <Index /> : lazyRoute(<LandingPage />) },
        { path: 'app', element: <Index /> },
        { path: 'app/*', element: <Index /> },
        { path: 'landing', element: lazyRoute(<LandingPage />) },
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

const router = (isCapacitorNative ? createHashRouter : createBrowserRouter)(appRoutes, routerOptions);

const cluster =
  MINT_CONFIG.NETWORK === 'devnet'
    ? WalletAdapterNetwork.Devnet
    : MINT_CONFIG.NETWORK === 'testnet'
      ? WalletAdapterNetwork.Testnet
      : WalletAdapterNetwork.Mainnet;

// MWA `appIdentity`: wallet renders this in the Verify dialog. The Wallet
// Standard spec requires `icon` to be a relative URI resolved against `uri`,
// so we host the icon at https://identityprism.xyz/icon-192.png and reference
// it relatively. Anchor `uri` at the public site so wallets can fetch the
// icon even on native (custom-scheme URIs cannot be dereferenced).
const appIdentity = {
  name: 'Identity Prism',
  uri: (
    isCapacitorNative ? 'https://identityprism.xyz' : import.meta.env.VITE_APP_BASE_URL || 'https://identityprism.xyz'
  ).replace(/\/+$/, ''),
  icon: 'icon-192.png',
};

// Patch: Capacitor WebView never fires window.blur on intent launch,
// causing MWA browser-build to throw ERROR_WALLET_NOT_FOUND after 3s timeout.
// Force-resolve blur detection on native platforms by synthesizing blur event.
try {
  if (typeof window !== 'undefined' && Capacitor?.isNativePlatform?.()) {
    const originalAssign = window.location.assign.bind(window.location);
    (window.location as any).assign = (url: string | URL) => {
      try {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.startsWith('solana-wallet:')) {
          originalAssign(urlStr);
          setTimeout(() => {
            try { window.dispatchEvent(new Event('blur')); } catch {}
          }, 50);
          return;
        }
      } catch {}
      return originalAssign(url as any);
    };
  }
} catch (e) {
  console.error('[BlurPatch] init failed:', e);
}

const mobileWalletAdapter = new SolanaMobileWalletAdapter({
  addressSelector: createDefaultAddressSelector(),
  appIdentity,
  cluster,
  authorizationResultCache: mwaAuthorizationCache,
  onWalletNotFound: createDefaultWalletNotFoundHandler(),
});

// MWA primary on native — Solana Mobile Wallet (com.solanamobile.wallet) provides
// system bottom-sheet picker exposing Genesis Seed + all signers plug-and-play.
// SeedVaultAdapter registered last as manual fallback.
const wallets = [
  mobileWalletAdapter,
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  ...(isCapacitorNative ? [new SeedVaultAdapter()] : []),
];
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
  useEffect(() => {
    if (!isCapacitorNative) return;

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
    if (!isCapacitorNative) return;

    // Push a sentinel entry so there's always something to pop back to
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
        // Re-push sentinel so next back also minimizes
        window.history.pushState({ __appHub: true }, '', window.location.href);
        // Minimize app via Capacitor if available
        appPlugin?.minimizeApp?.();
      } else {
        // Go to hub instead of browser history back
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
    <CustomWalletProvider
      wallets={wallets}
      autoConnect={async (adapter) => {
        if (adapter.name === SolanaMobileWalletAdapterWalletName) {
          try {
            const cached = await mwaAuthorizationCache.get();
            return Boolean(extractMwaAddress(cached));
          } catch {
            return false;
          }
        }
        try {
          return Boolean(localStorage.getItem('walletAdapter'));
        } catch {
          return false;
        }
      }}
      localStorageKey="walletAdapter"
    >
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
