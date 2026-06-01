/**
 * WebWalletButton — wallet connect control for the web SiteHeader.
 *
 * Diagnostic build: forces pointer-events/z-index so the click can't be
 * swallowed by surrounding layers, logs every click so the user can see in
 * DevTools whether the handler fires, and opens the standard wallet-adapter
 * modal via setVisible(true). The modal itself is mounted in AppShell via
 * <WalletModalProvider>.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

function shortAddress(value: string): string {
  return value.length > 9 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

export default function WebWalletButton() {
  const { publicKey, connected, connecting, disconnecting, disconnect, wallet, connect } = useWallet();
  const { setVisible, visible } = useWalletModal();

  // CustomWalletProvider has autoConnect=false, so picking a wallet in the modal
  // only SELECTS it — connect() must be called separately. Trigger connect()
  // whenever the modal goes from open→closed AND a wallet ended up selected,
  // regardless of which button opened it (header chip OR in-page CTA).
  const wasVisibleRef = useRef(false);
  const handleClick = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[WebWalletButton] click', {
      connected,
      connecting,
      disconnecting,
      hasSetVisible: typeof setVisible === 'function',
      pubkey: publicKey?.toBase58() ?? null,
    });
    if (connecting || disconnecting) return;
    if (connected) {
      void disconnect().catch((error) => {
        // eslint-disable-next-line no-console
        console.warn('[WebWalletButton] disconnect failed', error);
      });
      return;
    }
    try {
      setVisible(true);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[WebWalletButton] setVisible threw', error);
    }
  }, [connected, connecting, disconnecting, disconnect, setVisible, publicKey]);

  useEffect(() => {
    if (visible) {
      wasVisibleRef.current = true;
      return;
    }
    // Modal just closed. Trigger connect if a wallet got selected but isn't
    // connected yet. This handles header-button AND in-page CTA opens uniformly.
    if (!wasVisibleRef.current) return;
    wasVisibleRef.current = false;
    if (!wallet) return;
    if (connected || connecting) return;
    // eslint-disable-next-line no-console
    console.log('[WebWalletButton] auto-connect after modal close', { adapter: wallet.adapter.name });
    void connect().catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[WebWalletButton] connect failed', error);
    });
  }, [wallet, visible, connected, connecting, connect]);

  const label = connecting
    ? 'Connecting…'
    : disconnecting
      ? 'Disconnecting…'
      : connected && publicKey
        ? shortAddress(publicKey.toBase58())
        : 'Connect Wallet';

  return (
    <button
      type="button"
      className={`web-wallet-button${connected ? ' is-connected' : ''}`}
      onClick={handleClick}
      // Force clickability — overrides any pointer-events:none / display issues
      // from surrounding layers without touching their CSS.
      style={{ pointerEvents: 'auto', position: 'relative', zIndex: 50 }}
      title={connected && publicKey ? publicKey.toBase58() : 'Connect a Solana wallet'}
    >
      {label}
    </button>
  );
}
