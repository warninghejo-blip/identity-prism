import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  WalletName,
  WalletReadyState,
  WalletNotConnectedError,
  WalletNotReadyError,
  Adapter,
  SendTransactionOptions,
  WalletError,
} from '@solana/wallet-adapter-base';
import { useConnection, useLocalStorage, WalletContext, WalletNotSelectedError } from '@solana/wallet-adapter-react';
import { useStandardWalletAdapters } from '@solana/wallet-standard-wallet-adapter-react';
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { SolanaMobileWalletAdapterWalletName } from '@solana-mobile/wallet-adapter-mobile';
import { Capacitor } from '@capacitor/core';
import { extractMwaAddress, mwaAuthorizationCache } from '@/lib/mwaAuthorizationCache';
import { armExternalWalletReturnGuard } from '@/lib/safeNavigate';

type WalletDef = { adapter: Adapter; readyState: WalletReadyState };

interface CustomWalletProviderProps {
  children: React.ReactNode;
  wallets: Adapter[];
  autoConnect?: boolean | ((adapter: Adapter) => Promise<boolean>);
  localStorageKey?: string;
  onError?: (error: WalletError, adapter?: Adapter) => void;
}

const writeProviderAuthDebug = (event: Record<string, unknown>) => {
  try {
    const prevRaw = sessionStorage.getItem('ip_auth_debug');
    const prev = prevRaw ? JSON.parse(prevRaw) : {};
    sessionStorage.setItem('ip_auth_debug', JSON.stringify({ ...prev, ...event, ts: new Date().toISOString() }));
  } catch {
    /* ignore */
  }
};

const looksLikeSolanaAddress = (value: string | null | undefined) =>
  Boolean(value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value));

const NATIVE_SESSION_RESTORE_KEY = 'ip_native_wallet_session';
const NATIVE_SESSION_RESTORE_WINDOW_MS = 90_000;

type NativeSessionRestoreMarker = {
  armedAt: number;
};

const withNativeWalletDismissDetection = async <T,>(operation: () => Promise<T>, label: string): Promise<T> => {
  const hardTimeoutMs = 120_000;
  const dismissGraceMs = Capacitor.isNativePlatform() ? 30_000 : 15_000;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let wentToBackground = false;
    let dismissTimer: ReturnType<typeof window.setTimeout> | null = null;
    let hardTimer: ReturnType<typeof window.setTimeout> | null = null;

    const cleanup = () => {
      if (dismissTimer) window.clearTimeout(dismissTimer);
      if (hardTimer) window.clearTimeout(hardTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('identityprism:nativePause', onNativePause);
      window.removeEventListener('identityprism:nativeResume', onNativeResume);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const startDismissTimer = () => {
      if (settled || dismissTimer) return;
      dismissTimer = window.setTimeout(() => {
        settle(() => reject(new Error(`USER_REJECTED: ${label} dismissed`)));
      }, dismissGraceMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') wentToBackground = true;
      if (document.visibilityState === 'visible' && wentToBackground && !settled) startDismissTimer();
    };
    const onBlur = () => {
      wentToBackground = true;
    };
    const onFocus = () => {
      if (Capacitor.isNativePlatform()) return;
      if (wentToBackground && !settled) startDismissTimer();
    };
    const onNativePause = () => {
      wentToBackground = true;
    };
    const onNativeResume = () => {
      if (!wentToBackground || settled) return;
      window.setTimeout(() => {
        if (!settled && document.visibilityState === 'visible') startDismissTimer();
      }, 1_500);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('identityprism:nativePause', onNativePause);
    window.addEventListener('identityprism:nativeResume', onNativeResume);

    hardTimer = window.setTimeout(() => {
      settle(() => reject(new Error(`USER_REJECTED: ${label} timed out`)));
    }, hardTimeoutMs);

    operation().then(
      (result) => settle(() => resolve(result)),
      (error) => settle(() => reject(error)),
    );
  });
};

const readPersistedAddress = (includeLocal = false) => {
  const storageReaders = [
    () => sessionStorage.getItem('prism_active_address'),
    () => sessionStorage.getItem('ip_auth_jwt'),
    ...(includeLocal
      ? [() => localStorage.getItem('prism_active_address'), () => localStorage.getItem('ip_auth_jwt')]
      : []),
  ];
  for (const read of storageReaders) {
    try {
      const raw = read();
      if (looksLikeSolanaAddress(raw)) return raw ?? '';
      if (!raw || raw[0] !== '{') continue;
      const parsed = JSON.parse(raw) as { address?: string };
      if (looksLikeSolanaAddress(parsed.address)) return parsed.address ?? '';
    } catch {
      /* ignore */
    }
  }
  return '';
};

const parseNativeSessionRestoreMarker = (raw: string | null): NativeSessionRestoreMarker | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as NativeSessionRestoreMarker;
    if (!parsed?.armedAt) return null;
    if (Date.now() - parsed.armedAt > NATIVE_SESSION_RESTORE_WINDOW_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const hasNativeSessionRestoreMarker = () => {
  try {
    const sessionMarker = parseNativeSessionRestoreMarker(sessionStorage.getItem(NATIVE_SESSION_RESTORE_KEY));
    if (sessionMarker) return true;

    const localMarker = parseNativeSessionRestoreMarker(localStorage.getItem(NATIVE_SESSION_RESTORE_KEY));
    if (localMarker) {
      sessionStorage.setItem(NATIVE_SESSION_RESTORE_KEY, JSON.stringify(localMarker));
      return true;
    }

    sessionStorage.removeItem(NATIVE_SESSION_RESTORE_KEY);
    localStorage.removeItem(NATIVE_SESSION_RESTORE_KEY);
    return false;
  } catch {
    return false;
  }
};

const setNativeSessionRestoreMarker = () => {
  try {
    const marker = JSON.stringify({ armedAt: Date.now() });
    sessionStorage.setItem(NATIVE_SESSION_RESTORE_KEY, marker);
    localStorage.setItem(NATIVE_SESSION_RESTORE_KEY, marker);
  } catch {
    /* ignore */
  }
};

const clearNativeSessionRestoreMarker = () => {
  try {
    localStorage.removeItem(NATIVE_SESSION_RESTORE_KEY);
    sessionStorage.removeItem(NATIVE_SESSION_RESTORE_KEY);
  } catch {
    /* ignore */
  }
};

export const CustomWalletProvider = ({
  children,
  wallets: initialAdapters,
  autoConnect,
  localStorageKey = 'walletName',
  onError,
}: CustomWalletProviderProps) => {
  // 1. Get standard adapters + provided adapters
  const adaptersWithStandard = useStandardWalletAdapters(initialAdapters);

  // 2. Dedup adapters by name
  const dedupedAdapters = useMemo(() => {
    const seen = new Set<string>();
    const unique: Adapter[] = [];
    for (const adapter of adaptersWithStandard) {
      if (seen.has(adapter.name)) continue;
      seen.add(adapter.name);
      unique.push(adapter);
    }
    return unique;
  }, [adaptersWithStandard]);

  // 3. Track Ready State
  const [wallets, setWallets] = useState<WalletDef[]>(() =>
    dedupedAdapters
      .map((adapter) => ({
        adapter,
        readyState: adapter.readyState,
      }))
      .filter(
        (w) => w.readyState !== WalletReadyState.Unsupported || w.adapter.name === SolanaMobileWalletAdapterWalletName,
      ),
  );

  useEffect(() => {
    // Reset wallets when list changes — never filter out MWA (it may start Unsupported in Capacitor)
    setWallets(
      dedupedAdapters
        .map((adapter) => ({
          adapter,
          readyState: adapter.readyState,
        }))
        .filter(
          (w) =>
            w.readyState !== WalletReadyState.Unsupported || w.adapter.name === SolanaMobileWalletAdapterWalletName,
        ),
    );

    function handleReadyStateChange(this: Adapter, readyState: WalletReadyState) {
      setWallets((prevWallets) => {
        const index = prevWallets.findIndex(({ adapter }) => adapter.name === this.name);
        if (index === -1) {
          // Wallet was previously filtered out (e.g. was Unsupported).
          // If it's now usable, add it back.
          if (readyState !== WalletReadyState.Unsupported) {
            return [...prevWallets, { adapter: this, readyState }];
          }
          return prevWallets;
        }
        const { adapter } = prevWallets[index];
        return [...prevWallets.slice(0, index), { adapter, readyState }, ...prevWallets.slice(index + 1)].filter(
          ({ readyState: rs, adapter: a }) =>
            rs !== WalletReadyState.Unsupported || a.name === SolanaMobileWalletAdapterWalletName,
        );
      });
    }

    dedupedAdapters.forEach((adapter) => adapter.on('readyStateChange', handleReadyStateChange, adapter));
    return () => {
      dedupedAdapters.forEach((adapter) => adapter.off('readyStateChange', handleReadyStateChange, adapter));
    };
  }, [dedupedAdapters]);

  const [walletName, setWalletName] = useLocalStorage<WalletName | null>(localStorageKey, null);
  const adapter = useMemo(
    () => dedupedAdapters.find((a) => a.name === walletName) ?? null,
    [dedupedAdapters, walletName],
  );
  const mobileWalletAdapter = useMemo(
    () => dedupedAdapters.find((a) => a.name === SolanaMobileWalletAdapterWalletName) ?? null,
    [dedupedAdapters],
  );
  const wallet = useMemo(() => wallets.find((w) => w.adapter.name === walletName) ?? null, [wallets, walletName]);

  // Error handling
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  const handleError = useCallback((error: WalletError, adapter?: Adapter) => {
    if (onErrorRef.current) {
      onErrorRef.current(error, adapter);
    } else {
      console.error(error, adapter);
    }
    return error;
  }, []);

  // State
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState(adapter?.publicKey ?? null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const isUnloadingRef = useRef(false);
  const isNativePlatform = Capacitor.isNativePlatform();
  const nativeRestoreArmed = hasNativeSessionRestoreMarker();
  const nativeRestoreAllowed = !isNativePlatform || nativeRestoreArmed || Boolean(readPersistedAddress());
  const armWalletReturnGuard = useCallback(() => {
    if (isNativePlatform) {
      armExternalWalletReturnGuard();
    }
  }, [isNativePlatform]);

  const startNativeMwaAssociationNudge = useCallback(() => {
    if (!isNativePlatform || adapter?.name !== SolanaMobileWalletAdapterWalletName) {
      return () => {};
    }
    let ticks = 0;
    const intervalId = window.setInterval(() => {
      window.dispatchEvent(new Event('blur'));
      ticks += 1;
      if (ticks >= 12) {
        window.clearInterval(intervalId);
      }
    }, 250);
    window.dispatchEvent(new Event('blur'));
    return () => window.clearInterval(intervalId);
  }, [adapter?.name, isNativePlatform]);

  const ensureNativeMwaAdapterReady = useCallback(async () => {
    if (!isNativePlatform || adapter?.name !== SolanaMobileWalletAdapterWalletName || adapter.connected) return;
    try {
      await Promise.race([
        (adapter as Adapter & { autoConnect?: () => Promise<void> }).autoConnect?.() ?? Promise.resolve(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 2_500)),
      ]);
      for (let i = 0; i < 20 && !adapter.connected && !adapter.publicKey; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
    } catch {
      /* adapter call below will surface the real wallet error */
    }
  }, [adapter, isNativePlatform]);

  const clearTransientAuthState = useCallback(() => {
    try {
      localStorage.removeItem('ip_auth_jwt');
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.removeItem('ip_auth_jwt');
      sessionStorage.removeItem('prism_active_address');
    } catch {
      /* ignore */
    }
  }, []);

  const clearStoredWalletSession = useCallback(async () => {
    try {
      localStorage.removeItem(localStorageKey);
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem('walletName');
      localStorage.removeItem('ip_auth_jwt');
      localStorage.removeItem('prism_active_address');
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.removeItem('ip_auth_jwt');
      sessionStorage.removeItem('prism_active_address');
    } catch {
      /* ignore */
    }
    clearNativeSessionRestoreMarker();
    try {
      await mwaAuthorizationCache.clear();
    } catch {
      /* ignore */
    }
  }, [localStorageKey]);

  useEffect(() => {
    if (!isNativePlatform || nativeRestoreAllowed || (!walletName && !connected && !publicKey)) return;
    setWalletName(null);
    setConnected(false);
    setPublicKey(null);
    setConnecting(false);
    setDisconnecting(false);
  }, [isNativePlatform, nativeRestoreAllowed, walletName, connected, publicKey, setWalletName]);

  const restoreMobileWalletSession = useCallback(async () => {
    if (!adapter || adapter.name !== SolanaMobileWalletAdapterWalletName || disconnecting) return null;
    const adapterAuthorization = extractMwaAddress(
      (adapter as Adapter & { _authorizationResult?: unknown })._authorizationResult,
    );
    const cachedAuthorization = await mwaAuthorizationCache.get();
    const internalAddress =
      adapterAuthorization || extractMwaAddress(cachedAuthorization) || readPersistedAddress(nativeRestoreArmed);
    const resolvedPublicKey = adapter.publicKey ?? (internalAddress ? new PublicKey(internalAddress) : null);
    if (!resolvedPublicKey) return null;
    writeProviderAuthDebug({
      stage: 'provider_restore_mobile_wallet',
      address: resolvedPublicKey.toBase58().slice(0, 8),
      source: adapter.publicKey
        ? 'adapter_public_key'
        : adapterAuthorization
          ? 'adapter_authorization'
          : 'recent_wallet_return_cache',
    });
    setConnected(true);
    setPublicKey(resolvedPublicKey);
    setConnecting(false);
    setDisconnecting(false);
    return resolvedPublicKey;
  }, [adapter, disconnecting]);

  // Sync adapter state
  useEffect(() => {
    if (!adapter) {
      setConnected(false);
      setPublicKey(null);
      return;
    }

    const handleConnect = (pk: PublicKey) => {
      setConnected(true);
      setPublicKey(pk);
      setConnecting(false);
      setDisconnecting(false);
    };
    const handleDisconnect = () => {
      if (isUnloadingRef.current) return;
      setConnected(false);
      setPublicKey(null);
      setConnecting(false);
      setDisconnecting(false);
      // Don't clear walletName here — let autoConnect re-establish
      // walletName is cleared only on explicit disconnect() call
    };
    const handleErrorEvent = (error: WalletError) => handleError(error, adapter);

    adapter.on('connect', handleConnect);
    adapter.on('disconnect', handleDisconnect);
    adapter.on('error', handleErrorEvent);

    if (adapter.connected) {
      setConnected(true);
      setPublicKey(adapter.publicKey);
    }

    return () => {
      adapter.off('connect', handleConnect);
      adapter.off('disconnect', handleDisconnect);
      adapter.off('error', handleErrorEvent);
    };
  }, [adapter, handleError, setWalletName]);

  useEffect(() => {
    if (!nativeRestoreAllowed || !adapter || adapter.name !== SolanaMobileWalletAdapterWalletName || disconnecting)
      return;

    let cancelled = false;
    const syncFromAuthorization = async () => {
      if (disconnecting || cancelled) return;
      await restoreMobileWalletSession();
    };

    syncFromAuthorization();
    const intervalId = window.setInterval(syncFromAuthorization, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [adapter, disconnecting, restoreMobileWalletSession, nativeRestoreAllowed]);

  useEffect(() => {
    if (!nativeRestoreAllowed || !isNativePlatform || walletName || connecting || disconnecting || !mobileWalletAdapter)
      return;

    let cancelled = false;
    const restoreWalletSelection = async () => {
      const cachedAuthorization = await mwaAuthorizationCache.get();
      const hasMwaAddress = Boolean(extractMwaAddress(cachedAuthorization));
      const persistedAddress = readPersistedAddress(nativeRestoreArmed);
      if (cancelled || (!hasMwaAddress && !persistedAddress)) return;
      setWalletName(SolanaMobileWalletAdapterWalletName);
    };

    restoreWalletSelection().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    isNativePlatform,
    walletName,
    connecting,
    disconnecting,
    mobileWalletAdapter,
    setWalletName,
    nativeRestoreAllowed,
  ]);

  // Preserve wallet selection across reloads/navigation. Explicit Disconnect is the
  // only path that should clear wallet session state.
  useEffect(() => {
    if (isNativePlatform) return;

    const handleBeforeUnload = () => {
      isUnloadingRef.current = true;
    };
    const handlePageHide = (e: PageTransitionEvent) => {
      if (!e.persisted) {
        isUnloadingRef.current = true;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [isNativePlatform, localStorageKey]);

  // Select Wallet
  const select = useCallback(
    (name: WalletName | null) => {
      if (name === walletName) return;
      // Reset connection state before switching so stale state can't block autoConnect
      setConnecting(false);
      setConnected(false);
      setPublicKey(null);
      if (adapter && (connected || adapter.connected || publicKey)) {
        adapter.disconnect().catch(() => {});
      }
      if (name) {
        clearTransientAuthState();
      } else {
        clearStoredWalletSession().catch(() => {});
      }
      import('@/components/prism/shared')
        .then(({ setAuthWallet }) => {
          setAuthWallet(null);
        })
        .catch(() => {});
      if (isNativePlatform && name) setNativeSessionRestoreMarker();
      if (!name) clearNativeSessionRestoreMarker();
      setWalletName(name);
    },
    [
      walletName,
      adapter,
      connected,
      publicKey,
      clearTransientAuthState,
      clearStoredWalletSession,
      setWalletName,
      isNativePlatform,
    ],
  );

  // Connect
  const connect = useCallback(async () => {
    if (connecting || disconnecting || connected) return;
    if (!adapter) throw handleError(new WalletNotSelectedError());

    if (adapter.readyState !== WalletReadyState.Installed && adapter.readyState !== WalletReadyState.Loadable) {
      if (!isNativePlatform && typeof window !== 'undefined' && adapter.url) {
        window.open(adapter.url, '_blank');
      }
      throw handleError(new WalletNotReadyError(), adapter);
    }

    setConnecting(true);
    if (isNativePlatform) setNativeSessionRestoreMarker();
    armWalletReturnGuard();
    // Timeout guard: if adapter.connect() hangs (e.g. user dismissed the popup), unblock after 15s
    let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const connectTimeout = new Promise<never>((_, reject) => {
      connectTimeoutId = setTimeout(() => reject(new Error('Connection timed out')), 15_000);
    });
    try {
      await Promise.race([adapter.connect(), connectTimeout]);
    } catch (error: unknown) {
      await clearStoredWalletSession();
      setWalletName(null);
      throw handleError(error as WalletError, adapter);
    } finally {
      if (connectTimeoutId !== null) clearTimeout(connectTimeoutId);
      setConnecting(false);
    }
  }, [
    adapter,
    connecting,
    disconnecting,
    connected,
    handleError,
    setWalletName,
    clearStoredWalletSession,
    isNativePlatform,
    armWalletReturnGuard,
  ]);

  // Disconnect
  const disconnect = useCallback(async () => {
    if (disconnecting) return;

    setDisconnecting(true);
    setConnected(false);
    setPublicKey(null);
    try {
      await clearStoredWalletSession();
      if (adapter) {
        try {
          (adapter as Adapter & { _authorizationResult?: unknown })._authorizationResult = undefined;
        } catch {
          /* ignore */
        }
        await Promise.race([
          adapter.disconnect(),
          new Promise<void>((resolve) => window.setTimeout(resolve, 1_200)),
        ]);
      }
    } finally {
      await clearStoredWalletSession();
      setWalletName(null);
      setConnected(false);
      setPublicKey(null);
      setDisconnecting(false);
    }
  }, [adapter, disconnecting, clearStoredWalletSession, setWalletName]);

  // AutoConnect
  const hasAttemptedAutoConnect = useRef(false);
  useEffect(() => {
    if (hasAttemptedAutoConnect.current) return;
    if (!adapter || connected || connecting) return;

    const canAutoConnect = async () => {
      if (adapter.readyState !== WalletReadyState.Installed && adapter.readyState !== WalletReadyState.Loadable)
        return false;
      if (typeof autoConnect === 'function') {
        return await autoConnect(adapter);
      }
      return !!autoConnect;
    };

    canAutoConnect().then((shouldConnect) => {
      if (shouldConnect) {
        hasAttemptedAutoConnect.current = true;
        connect().catch(() => {});
      }
    });
  }, [adapter, autoConnect, connected, connecting, connect]);

  useEffect(() => {
    hasAttemptedAutoConnect.current = false;
  }, [walletName]);

  const sendTransaction = useCallback(
    async (
      transaction: Transaction | VersionedTransaction,
      connection: Connection,
      options?: SendTransactionOptions,
    ) => {
      if (!adapter) throw handleError(new WalletNotSelectedError());
      if (!connected) throw handleError(new WalletNotConnectedError(), adapter);
      await ensureNativeMwaAdapterReady();
      armWalletReturnGuard();
      const stopNudge = startNativeMwaAssociationNudge();
      try {
        return await withNativeWalletDismissDetection(
          () => adapter.sendTransaction(transaction, connection, options),
          'Wallet transaction',
        );
      } finally {
        window.setTimeout(stopNudge, 3_500);
      }
    },
    [adapter, connected, handleError, armWalletReturnGuard, startNativeMwaAssociationNudge, ensureNativeMwaAdapterReady],
  );

  const signTransaction = useMemo(
    () =>
      adapter && 'signTransaction' in adapter
        ? async (txn: Transaction | VersionedTransaction) => {
            if (!connected) throw handleError(new WalletNotConnectedError(), adapter);
            await ensureNativeMwaAdapterReady();
            armWalletReturnGuard();
            const stopNudge = startNativeMwaAssociationNudge();
            try {
              return await withNativeWalletDismissDetection(
                () =>
                  (
                    adapter as Adapter & {
                      signTransaction: (
                        t: Transaction | VersionedTransaction,
                      ) => Promise<Transaction | VersionedTransaction>;
                    }
                  ).signTransaction(txn),
                'Wallet signing',
              );
            } finally {
              window.setTimeout(stopNudge, 3_500);
            }
          }
        : undefined,
    [adapter, connected, handleError, armWalletReturnGuard, startNativeMwaAssociationNudge, ensureNativeMwaAdapterReady],
  );

  const signAllTransactions = useMemo(
    () =>
      adapter && 'signAllTransactions' in adapter
        ? async (txns: (Transaction | VersionedTransaction)[]) => {
            if (!connected) throw handleError(new WalletNotConnectedError(), adapter);
            await ensureNativeMwaAdapterReady();
            armWalletReturnGuard();
            const stopNudge = startNativeMwaAssociationNudge();
            try {
              return await withNativeWalletDismissDetection(
                () =>
                  (
                    adapter as Adapter & {
                      signAllTransactions: (
                        t: (Transaction | VersionedTransaction)[],
                      ) => Promise<(Transaction | VersionedTransaction)[]>;
                    }
                  ).signAllTransactions(txns),
                'Wallet batch signing',
              );
            } finally {
              window.setTimeout(stopNudge, 3_500);
            }
          }
        : undefined,
    [adapter, connected, handleError, armWalletReturnGuard, startNativeMwaAssociationNudge, ensureNativeMwaAdapterReady],
  );

  const signMessage = useMemo(
    () =>
      adapter && 'signMessage' in adapter
        ? async (msg: Uint8Array) => {
            if (!connected) throw handleError(new WalletNotConnectedError(), adapter);
            await ensureNativeMwaAdapterReady();
            armWalletReturnGuard();
            const stopNudge = startNativeMwaAssociationNudge();
            try {
              return await withNativeWalletDismissDetection(
                () =>
                  (adapter as Adapter & { signMessage: (m: Uint8Array) => Promise<Uint8Array> }).signMessage(msg),
                'Wallet message signing',
              );
            } finally {
              window.setTimeout(stopNudge, 3_500);
            }
          }
        : undefined,
    [adapter, connected, handleError, armWalletReturnGuard, startNativeMwaAssociationNudge, ensureNativeMwaAdapterReady],
  );

  const signIn = useMemo(
    () =>
      adapter && 'signIn' in adapter
        ? async (input: unknown) => {
            await ensureNativeMwaAdapterReady();
            armWalletReturnGuard();
            const stopNudge = startNativeMwaAssociationNudge();
            try {
              return await withNativeWalletDismissDetection(
                () => (adapter as Adapter & { signIn: (i: unknown) => Promise<unknown> }).signIn(input),
                'Wallet sign-in',
              );
            } finally {
              window.setTimeout(stopNudge, 3_500);
            }
          }
        : undefined,
    [adapter, armWalletReturnGuard, startNativeMwaAssociationNudge, ensureNativeMwaAdapterReady],
  );

  useEffect(() => {
    const address = publicKey?.toBase58();
    let cancelled = false;
    writeProviderAuthDebug({
      stage: 'provider_auth_effect',
      connected,
      address: address?.slice(0, 8) ?? null,
      hasSignMessage: Boolean(signMessage),
      adapterName: adapter?.name ?? null,
    });

    import('@/components/prism/shared')
      .then(({ setAuthWallet }) => {
        if (cancelled) return;
        if (!connected || !address || !signMessage) {
          setAuthWallet(null);
          return;
        }

        const isMwa = adapter?.name === SolanaMobileWalletAdapterWalletName;
        const authWallet = {
          publicKey,
          signMessage,
          signIn,
          preferSignMessage: isMwa,
          authDelayMs: isMwa ? 350 : 0,
        };
        setAuthWallet(authWallet);
        // Keep the shared auth wallet current, but do not auto-start JWT signing here.
        // For MWA/Seed Vault, firing signMessage from the provider races the app↔wallet
        // transition and can leave the JS promise hanging after biometric approval.
        writeProviderAuthDebug({ stage: 'provider_auth_registered', address: address.slice(0, 8) });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, signMessage, signIn]);

  return (
    <WalletContext.Provider
      value={{
        autoConnect: !!autoConnect,
        wallets,
        wallet,
        publicKey,
        connected,
        connecting,
        disconnecting,
        select,
        connect,
        disconnect,
        sendTransaction,
        signTransaction,
        signAllTransactions,
        signMessage,
        signIn,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};
