/**
 * WebWalletButton — wallet connect control for the web SiteHeader.
 *
 * NOTE: the original file was unrecoverable after the May 2026 disk failure
 * (data-recovery returned a font blob in its place). This is a faithful
 * reconstruction from its single call site (SiteHeader.tsx) and the
 * `.web-wallet-button` / `.is-connected` styling in SiteHeader.css.
 * Uses the standard wallet-adapter modal already mounted in AppShell.
 */
import { useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

function shortAddress(value: string): string {
  return value.length > 9 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

export default function WebWalletButton() {
  const { publicKey, connected, connecting, disconnecting, disconnect, wallet } = useWallet();
  const { visible, setVisible } = useWalletModal();

  const label = useMemo(() => {
    if (connecting) return 'Connecting…';
    if (disconnecting) return 'Disconnecting…';
    if (connected && publicKey) return shortAddress(publicKey.toBase58());
    return 'Connect Wallet';
  }, [connecting, disconnecting, connected, publicKey]);

  const handleClick = useCallback(() => {
    if (connecting || disconnecting) return;
    if (connected) {
      void disconnect().catch(() => {
        /* surfaced by the adapter's error handler */
      });
      return;
    }
    // If an adapter is already selected, the modal connects it; otherwise it
    // lets the user pick one. Either way the modal owns the connect flow.
    setVisible(!visible);
  }, [connecting, disconnecting, connected, disconnect, setVisible, visible]);

  return (
    <button
      type="button"
      className={`web-wallet-button${connected ? ' is-connected' : ''}`}
      onClick={handleClick}
      disabled={connecting || disconnecting}
      title={connected && publicKey ? publicKey.toBase58() : wallet?.adapter.name ?? 'Connect a Solana wallet'}
      aria-label={connected ? 'Wallet menu' : 'Connect wallet'}
    >
      {label}
    </button>
  );
}
