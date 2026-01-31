import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
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
import PreviewDeck from './pages/PreviewDeck';
import NotFound from './pages/NotFound';
import DebugConsole from './components/DebugConsole';
import './index.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { Buffer } from 'buffer';
import { mwaAuthorizationCache } from './lib/mwaAuthorizationCache';
import { getHeliusRpcUrl, MINT_CONFIG } from './constants';

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
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Index /> },
      { path: 'preview', element: <PreviewDeck /> },
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

const wallets = [new PhantomWalletAdapter(), mobileWalletAdapter];
const heliusRpcUrl = getHeliusRpcUrl();
if (!heliusRpcUrl) {
  console.error('Helius API key missing. Wallet scan requires VITE_HELIUS_API_KEYS.');
}
const endpoint = heliusRpcUrl ?? 'https://api.mainnet-beta.solana.com';

const debugEnabled =
  import.meta.env.DEV ||
  new URLSearchParams(window.location.search).has('debug') ||
  window.localStorage?.getItem('debug') === 'true';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      {debugEnabled && <DebugConsole />}
      <WalletProvider
        wallets={wallets}
        autoConnect={true}
        localStorageKey="walletAdapter"
      >
        <WalletModalProvider>
          <RouterProvider router={router} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);
