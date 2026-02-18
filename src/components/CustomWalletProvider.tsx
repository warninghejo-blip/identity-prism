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
import { 
  useConnection, 
  useLocalStorage, 
  WalletContext, 
  WalletNotSelectedError 
} from '@solana/wallet-adapter-react';
import { useStandardWalletAdapters } from '@solana/wallet-standard-wallet-adapter-react';
import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
import type { PublicKey } from '@solana/web3.js';
import { SolanaMobileWalletAdapterWalletName } from '@solana-mobile/wallet-adapter-mobile';

type WalletDef = { adapter: Adapter; readyState: WalletReadyState };

interface CustomWalletProviderProps {
    children: React.ReactNode;
    wallets: Adapter[];
    autoConnect?: boolean | ((adapter: Adapter) => Promise<boolean>);
    localStorageKey?: string;
    onError?: (error: WalletError, adapter?: Adapter) => void;
}

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
        dedupedAdapters.map(adapter => ({
            adapter,
            readyState: adapter.readyState
        }))
        .filter(w => w.readyState !== WalletReadyState.Unsupported || w.adapter.name === SolanaMobileWalletAdapterWalletName)
    );

    useEffect(() => {
        // Reset wallets when list changes — never filter out MWA (it may start Unsupported in Capacitor)
        setWallets(
            dedupedAdapters.map(adapter => ({
                adapter,
                readyState: adapter.readyState
            })).filter(w => w.readyState !== WalletReadyState.Unsupported || w.adapter.name === SolanaMobileWalletAdapterWalletName)
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
                return [
                    ...prevWallets.slice(0, index),
                    { adapter, readyState },
                    ...prevWallets.slice(index + 1),
                ].filter(({ readyState: rs, adapter: a }) => rs !== WalletReadyState.Unsupported || a.name === SolanaMobileWalletAdapterWalletName);
            });
        }

        dedupedAdapters.forEach(adapter => adapter.on('readyStateChange', handleReadyStateChange, adapter));
        return () => {
            dedupedAdapters.forEach(adapter => adapter.off('readyStateChange', handleReadyStateChange, adapter));
        };
    }, [dedupedAdapters]);

    const [walletName, setWalletName] = useLocalStorage<WalletName | null>(localStorageKey, null);
    const adapter = useMemo(() => dedupedAdapters.find((a) => a.name === walletName) ?? null, [dedupedAdapters, walletName]);
    const wallet = useMemo(() => wallets.find(w => w.adapter.name === walletName) ?? null, [wallets, walletName]);

    // Error handling
    const onErrorRef = useRef(onError);
    useEffect(() => { onErrorRef.current = onError; }, [onError]);
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
            setWalletName(null); 
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

    // Handle Unload
    useEffect(() => {
        const handleBeforeUnload = () => { isUnloadingRef.current = true; };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    // Select Wallet
    const select = useCallback((name: WalletName | null) => {
        if (name === walletName) return;
        if (adapter) {
            adapter.disconnect().catch(() => {});
        }
        setWalletName(name);
    }, [walletName, adapter, setWalletName]);

    // Connect
    const connect = useCallback(async () => {
        if (connecting || disconnecting || connected) return;
        if (!adapter) throw handleError(new WalletNotSelectedError());
        
        if (adapter.readyState !== WalletReadyState.Installed && adapter.readyState !== WalletReadyState.Loadable) {
             if (typeof window !== 'undefined' && adapter.url) {
                window.open(adapter.url, '_blank');
            }
            throw handleError(new WalletNotReadyError(), adapter);
        }

        setConnecting(true);
        try {
            await adapter.connect();
        } catch (error: unknown) {
            setWalletName(null);
            throw handleError(error as WalletError, adapter);
        } finally {
            setConnecting(false);
        }
    }, [adapter, connecting, disconnecting, connected, handleError, setWalletName]);

    // Disconnect
    const disconnect = useCallback(async () => {
        if (disconnecting) return;
        if (!adapter) return;
        
        setDisconnecting(true);
        try {
            await adapter.disconnect();
        } finally {
            setWalletName(null);
            setDisconnecting(false);
        }
    }, [adapter, disconnecting, setWalletName]);

    // AutoConnect
    const hasAttemptedAutoConnect = useRef(false);
    useEffect(() => {
        if (hasAttemptedAutoConnect.current) return;
        if (!adapter || connected || connecting) return;
        
        const canAutoConnect = async () => {
             if (adapter.readyState !== WalletReadyState.Installed && adapter.readyState !== WalletReadyState.Loadable) return false;
             if (typeof autoConnect === 'function') {
                 return await autoConnect(adapter);
             }
             return !!autoConnect;
        };

        canAutoConnect().then(shouldConnect => {
            if (shouldConnect) {
                hasAttemptedAutoConnect.current = true;
                connect().catch(() => {});
            }
        });
    }, [adapter, autoConnect, connected, connecting, connect]);

    useEffect(() => { hasAttemptedAutoConnect.current = false; }, [walletName]);

    const sendTransaction = useCallback(async (transaction: Transaction | VersionedTransaction, connection: Connection, options?: SendTransactionOptions) => {
        if (!adapter) throw handleError(new WalletNotSelectedError());
        if (!connected) throw handleError(new WalletNotConnectedError(), adapter);
        return await adapter.sendTransaction(transaction, connection, options);
    }, [adapter, connected, handleError]);

    const signTransaction = useMemo(() => 
        adapter && 'signTransaction' in adapter ? 
        async (txn: Transaction | VersionedTransaction) => {
             if (!connected) throw handleError(new WalletNotConnectedError(), adapter);
             return await ((adapter as Adapter & { signTransaction: (t: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction> }).signTransaction(txn));
        } : undefined, 
    [adapter, connected, handleError]);

    const signAllTransactions = useMemo(() => 
        adapter && 'signAllTransactions' in adapter ? 
        async (txns: (Transaction | VersionedTransaction)[]) => {
             if (!connected) throw handleError(new WalletNotConnectedError(), adapter);
             return await ((adapter as Adapter & { signAllTransactions: (t: (Transaction | VersionedTransaction)[]) => Promise<(Transaction | VersionedTransaction)[]> }).signAllTransactions(txns));
        } : undefined, 
    [adapter, connected, handleError]);

    const signMessage = useMemo(() => 
        adapter && 'signMessage' in adapter ? 
        async (msg: Uint8Array) => {
             if (!connected) throw handleError(new WalletNotConnectedError(), adapter);
             return await ((adapter as Adapter & { signMessage: (m: Uint8Array) => Promise<Uint8Array> }).signMessage(msg));
        } : undefined, 
    [adapter, connected, handleError]);

    const signIn = useMemo(() => 
        adapter && 'signIn' in adapter ?
        async (input: unknown) => await ((adapter as Adapter & { signIn: (i: unknown) => Promise<unknown> }).signIn(input)) : undefined,
    [adapter]);

    return (
        <WalletContext.Provider value={{
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
            signIn
        }}>
            {children}
        </WalletContext.Provider>
    );
};
