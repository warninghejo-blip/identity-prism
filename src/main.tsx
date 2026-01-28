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
import {
  getAppBaseUrl,
  getHeliusRpcUrl,
  getMetadataBaseUrl,
  getMetadataImageUrl,
  MINT_CONFIG,
} from './constants';

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
], {
  future: {
    v7_startTransition: true,
    v7_relativeSplatPath: true,
  } as any,
});

const cluster =
  MINT_CONFIG.NETWORK === 'devnet'
    ? WalletAdapterNetwork.Devnet
    : MINT_CONFIG.NETWORK === 'testnet'
      ? WalletAdapterNetwork.Testnet
      : WalletAdapterNetwork.Mainnet;

const isCapacitor = Boolean((globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
const toHttps = (url?: string | null) => (url && url.startsWith('https://') ? url : null);
const rawAppBaseUrl = getAppBaseUrl();
const rawAppIconUrl = getMetadataImageUrl();
const appBaseUrl = isCapacitor ? rawAppBaseUrl : toHttps(rawAppBaseUrl);
const appIconUrl = isCapacitor ? rawAppIconUrl : toHttps(rawAppIconUrl);
const appIdentityUri = isCapacitor ? 'identityprism://app' : (appBaseUrl ?? 'https://identityprism.xyz');
const appIdentity = {
  name: 'Identity Prism',
  uri: appIdentityUri,
  icon: appIconUrl ?? 'https://identityprism.xyz/phav.png',
};
const isMobileBrowser = /android|iphone|ipad|ipod/i.test(globalThis.navigator?.userAgent ?? '');
const useMobileWallet = isCapacitor;

const mobileWalletAdapter = new SolanaMobileWalletAdapter({
  addressSelector: createDefaultAddressSelector(),
  appIdentity,
  cluster,
  authorizationResultCache: mwaAuthorizationCache,
  onWalletNotFound: createDefaultWalletNotFoundHandler(),
});

const wallets = useMobileWallet
  ? [mobileWalletAdapter]
  : [new PhantomWalletAdapter()];
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
        autoConnect={false}
        localStorageKey={useMobileWallet ? 'walletNameMobile' : 'walletName'}
      >
        <WalletModalProvider>
          <RouterProvider router={router} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);
