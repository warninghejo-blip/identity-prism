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
import { DEV_PUBLIC_KEY, devSignMessage } from '@/lib/devWallet';

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
  signTransaction: undefined,
  signAllTransactions: undefined,
} as unknown as Adapter;

const devWalletDef = {
  adapter: devAdapterStub,
  readyState: WalletReadyState.Installed,
};

export const DevWalletProvider = ({ children }: DevWalletProviderProps) => {
  const autoConnectedRef = useRef(false);

  // Auto-trigger JWT auth flow on mount (non-blocking)
  useEffect(() => {
    if (autoConnectedRef.current) return;
    autoConnectedRef.current = true;

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
      signTransaction: undefined,
      signAllTransactions: undefined,
      signMessage,
      signIn: undefined,
    }),
    [signMessage, sendTransaction, noop],
  );

  return (
    <WalletContext.Provider value={contextValue as Parameters<typeof WalletContext.Provider>[0]['value']}>
      {children}
    </WalletContext.Provider>
  );
};
