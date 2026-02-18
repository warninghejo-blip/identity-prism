import React, { useMemo } from "react";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { WalletProvider } from "@solana/wallet-adapter-react";

interface WalletProviderWithDedupProps {
  children: React.ReactNode;
  wallets: Adapter[];
  autoConnect?: boolean | ((adapter: Adapter) => Promise<boolean>);
  localStorageKey?: string;
  onError?: (error: WalletError, adapter?: Adapter) => void;
}

const dedupeAdaptersByName = (adapters: Adapter[]) => {
  const seen = new Set<string>();
  const result: Adapter[] = [];
  for (const adapter of adapters) {
    if (seen.has(adapter.name)) continue;
    seen.add(adapter.name);
    result.push(adapter);
  }
  return result;
};

export const WalletProviderWithDedup = ({
  children,
  wallets,
  autoConnect,
  localStorageKey = "walletName",
  onError,
}: WalletProviderWithDedupProps) => {
  const dedupedAdapters = useMemo(() => dedupeAdaptersByName(wallets), [wallets]);

  return (
    <WalletProvider
      wallets={dedupedAdapters}
      autoConnect={autoConnect}
      localStorageKey={localStorageKey}
      onError={onError}
    >
      {children}
    </WalletProvider>
  );
};
