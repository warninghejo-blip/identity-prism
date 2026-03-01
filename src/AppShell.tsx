import React from 'react';
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
const TimeWarp = React.lazy(() => import('./pages/TimeWarp'));
const QuestsPage = React.lazy(() => import('./pages/QuestsPage'));

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
      { path: 'home', element: <HomePage /> },
      { path: 'share', element: <Index /> },
      { path: 'game', element: <PrismLeague /> },
      { path: 'preview', element: <PreviewDeck /> },
      { path: 'preview/:tier', element: <PreviewDeck /> },
      { path: 'verify', element: <Verify /> },
      { path: 'compare', element: <Compare /> },
      { path: 'forge', element: <StellarForge /> },
      { path: 'market', element: <NebulaMarket /> },
      { path: 'constellation', element: <ConstellationNetwork /> },
      { path: 'timewarp', element: <TimeWarp /> },
      { path: 'quests', element: <QuestsPage /> },
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
