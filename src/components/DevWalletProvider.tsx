/**
 * DevWalletProvider — replaces CustomWalletProvider in dev mode.
 *
 * Provides a fake WalletContext backed by a hardcoded keypair so
 * ADB-driven automated tests never hit Seed Vault biometric prompts.
 *
 * Only renders when DEV_WALLET_ENABLED is true — in production the
 * dead-code elimination (Rollup/Vite) removes this entirely because
 * DEV_WALLET_ENABLED is a compile-time constant (import.meta.env.DEV).
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { WalletContext } from '@solana/wallet-adapter-react';
import { WalletReadyState, WalletNotConnectedError } from '@solana/wallet-adapter-base';
import type { Adapter, WalletError } from '@solana/wallet-adapter-base';
import type { Transaction, VersionedTransaction, Connection, SendOptions } from '@solana/web3.js';
import {
  DEV_PUBLIC_KEY,
  DEV_WALLET_ENABLED,
  DEV_WALLET_INDEX,
  DEV_WALLET_COUNT,
  devSignMessage,
  devSignTransaction,
} from '@/lib/devWallet';

interface DevWalletProviderProps {
  children: React.ReactNode;
}

const DEV_WALLET_NAME = 'DevWallet (ADB)' as const;

// Minimal stub adapter — never actually used for signing, just satisfies WalletContext type
const devAdapterStub = {
  name: DEV_WALLET_NAME,
  url: '',
  icon: '',
  readyState: WalletReadyState.Installed,
  publicKey: DEV_PUBLIC_KEY,
  connected: true,
  connecting: false,
  autoApprove: false,
  supportedTransactionVersions: null,
  on: () => devAdapterStub as unknown as ReturnType<Adapter['on']>,
  off: () => devAdapterStub as unknown as ReturnType<Adapter['off']>,
  emit: () => false,
  connect: async () => {},
  disconnect: async () => {},
  sendTransaction: async () => {
    throw new Error('DevWallet: sendTransaction not supported');
  },
  signMessage: async (msg: Uint8Array) => devSignMessage(msg),
  signTransaction: async (tx: Transaction | VersionedTransaction) => devSignTransaction(tx),
  signAllTransactions: async (txs: (Transaction | VersionedTransaction)[]) => txs.map((tx) => devSignTransaction(tx)),
} as unknown as Adapter;

const devWalletDef = {
  adapter: devAdapterStub,
  readyState: WalletReadyState.Installed,
};

export const DevWalletProvider = ({ children }: DevWalletProviderProps) => {
  const autoConnectedRef = useRef(false);
  const showDebugBar =
    DEV_WALLET_ENABLED &&
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('devWalletBar') === '1' ||
      window.localStorage?.getItem('ip_show_dev_wallet_bar') === 'true');

  // Auto-trigger JWT auth flow on mount (non-blocking)
  useEffect(() => {
    if (autoConnectedRef.current) return;
    autoConnectedRef.current = true;

    // Clear immediately so a fast click after ?wallet= switch cannot reuse the previous wallet's token.
    try {
      sessionStorage.removeItem('ip_auth_jwt');
      localStorage.removeItem('ip_auth_jwt');
    } catch {}

    // Small delay to let React tree settle before triggering auth
    const timer = setTimeout(async () => {
      try {
        const { obtainJwt, setAuthWallet } = await import('@/components/prism/shared');
        setAuthWallet({
          publicKey: DEV_PUBLIC_KEY,
          signMessage: async (msg: Uint8Array) => devSignMessage(msg),
        });
        await obtainJwt({
          publicKey: DEV_PUBLIC_KEY,
          signMessage: async (msg: Uint8Array) => devSignMessage(msg),
        });
        console.debug('[DevWallet] JWT obtained for', DEV_PUBLIC_KEY.toBase58());
      } catch (err) {
        console.debug('[DevWallet] JWT obtain skipped:', err);
      }
    }, 800);

    return () => {
      clearTimeout(timer);
      import('@/components/prism/shared').then(({ setAuthWallet }) => setAuthWallet(null));
    };
  }, []);

  const signMessage = useCallback(async (msg: Uint8Array): Promise<Uint8Array> => {
    return devSignMessage(msg);
  }, []);

  const signTransaction = useCallback(async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
    return devSignTransaction(tx);
  }, []);

  const signAllTransactions = useCallback(
    async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      return txs.map((tx) => devSignTransaction(tx));
    },
    [],
  );

  const sendTransaction = useCallback(
    async (_tx: Transaction | VersionedTransaction, _conn: Connection, _opts?: SendOptions) => {
      throw new WalletNotConnectedError();
    },
    [],
  );

  const noop = useCallback(async () => {}, []);

  const contextValue = useMemo(
    () => ({
      autoConnect: false,
      wallets: [devWalletDef],
      wallet: devWalletDef,
      publicKey: DEV_PUBLIC_KEY,
      connected: true,
      connecting: false,
      disconnecting: false,
      select: (_name: unknown) => {},
      connect: noop,
      disconnect: noop,
      sendTransaction,
      signTransaction,
      signAllTransactions,
      signMessage,
      signIn: undefined,
    }),
    [signMessage, signTransaction, signAllTransactions, sendTransaction, noop],
  );

  return (
    <WalletContext.Provider value={contextValue as Parameters<typeof WalletContext.Provider>[0]['value']}>
      {children}
      {showDebugBar && (
        <div className="fixed bottom-2 right-2 z-[9999] bg-black/80 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 font-mono">
          <span>DEV #{DEV_WALLET_INDEX + 1}</span>
          <span className="text-white/50">{DEV_PUBLIC_KEY.toBase58().slice(0, 8)}...</span>
          {Array.from({ length: DEV_WALLET_COUNT }, (_, i) => (
            <button
              key={i}
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set('wallet', String(i));
                window.location.href = url.toString();
              }}
              className={`px-1.5 py-0.5 rounded ${i === DEV_WALLET_INDEX ? 'bg-emerald-500' : 'bg-white/10 hover:bg-white/20'}`}
            >
              W{i + 1}
            </button>
          ))}
        </div>
      )}
    </WalletContext.Provider>
  );
};
