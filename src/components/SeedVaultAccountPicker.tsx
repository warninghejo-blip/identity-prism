/**
 * SeedVaultAccountPicker — replaces the generic wallet-adapter modal on
 * Solana Seeker. Shows the actual list of authorized Seed Vault addresses
 * so the user picks a specific wallet, not just the abstract "Seed Vault"
 * adapter. Falls through to SeedVault.authorize() when there are no
 * authorized accounts yet (first-time use) or when the user taps
 * "Add another wallet".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet, Loader2, Plus, X } from 'lucide-react';
import { SeedVault } from '@/lib/seedVaultPlugin';
import { writePreferredMobileWalletAddress } from '@/lib/mobileWalletAddressPreference';
import LegalModal from '@/components/LegalModal';

interface AuthorizedAccount {
  authToken: number;
  seedName?: string;
  accountName?: string;
  address: string;
  derivationPath: string;
  isUserWallet?: boolean;
  isValid?: boolean;
}

interface SeedVaultAccountPickerProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the picked address. Caller should set the preferred address,
   * select the SeedVault adapter, and trigger connect. */
  onSelect: (address: string) => void;
}

const shortAddress = (address: string) =>
  address.length > 9 ? `${address.slice(0, 5)}…${address.slice(-5)}` : address;

export default function SeedVaultAccountPicker({
  visible,
  onClose,
  onSelect,
}: SeedVaultAccountPickerProps) {
  const [accounts, setAccounts] = useState<AuthorizedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legalSlug, setLegalSlug] = useState<string | null>(null);

  // Guard against React effect re-runs re-triggering authorize() in a loop.
  const autoAuthInFlightRef = useRef(false);
  const sessionAutoAuthRef = useRef(false);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await SeedVault.getAuthorizedAccounts();
      const usable = (res?.accounts ?? []).filter(
        (a) => a.address && a.derivationPath && a.isValid !== false,
      );
      setAccounts(usable);
      // First-time use (no accounts yet): auto-trigger native authorize so the
      // user reaches the seed-vault prompt in one tap instead of two. The
      // system Seed Vault "Choose a seed" sheet is unavoidable on first auth
      // (Android security model), but we shouldn't make the user tap an extra
      // intermediate button to get to it.
      if (usable.length === 0 && !sessionAutoAuthRef.current && !autoAuthInFlightRef.current) {
        sessionAutoAuthRef.current = true;
        autoAuthInFlightRef.current = true;
        setAuthorizing(true);
        try {
          const { address } = await SeedVault.authorize();
          writePreferredMobileWalletAddress(address);
          onSelect(address);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[SeedVaultPicker] auto-authorize failed', e);
          setError('Authorization cancelled or failed');
        } finally {
          setAuthorizing(false);
          autoAuthInFlightRef.current = false;
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[SeedVaultPicker] getAuthorizedAccounts failed', e);
      setError('Failed to read Seed Vault accounts');
    } finally {
      setLoading(false);
    }
  }, [onSelect]);

  useEffect(() => {
    if (!visible) {
      sessionAutoAuthRef.current = false;
      return;
    }
    void loadAccounts();
  }, [visible, loadAccounts]);

  const handlePick = (account: AuthorizedAccount) => {
    // eslint-disable-next-line no-console
    console.log('[SeedVaultPicker] handlePick fired', account.address);
    writePreferredMobileWalletAddress(account.address);
    onSelect(account.address);
  };

  const handleAuthorize = async () => {
    setAuthorizing(true);
    setError(null);
    try {
      const { address } = await SeedVault.authorize();
      writePreferredMobileWalletAddress(address);
      // After authorize, re-read accounts so the picker shows both Account 1 + 2
      // (the next time the picker mounts). Pass the picked address up immediately.
      onSelect(address);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[SeedVaultPicker] authorize failed', e);
      setError('Authorization cancelled or failed');
    } finally {
      setAuthorizing(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      className="seed-picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="seed-picker-title"
    >
      <div className="seed-picker-card">
        <button
          type="button"
          className="seed-picker-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <header className="seed-picker-head">
          <Wallet size={22} aria-hidden="true" />
          <h2 id="seed-picker-title">Choose your wallet</h2>
          <p>Pick a Seed Vault address to connect.</p>
        </header>

        {loading || authorizing ? (
          <div className="seed-picker-loading">
            <Loader2 className="animate-spin" size={22} aria-hidden="true" />
            <span>{authorizing ? 'Awaiting Seed Vault…' : 'Loading accounts…'}</span>
          </div>
        ) : error && accounts.length === 0 ? (
          <div className="seed-picker-empty">
            <span>{error}</span>
            <button type="button" onClick={() => void loadAccounts()}>Retry</button>
          </div>
        ) : accounts.length === 0 && error ? (
          <div className="seed-picker-empty">
            <button
              type="button"
              className="seed-picker-add"
              onClick={handleAuthorize}
              disabled={authorizing}
            >
              <Wallet size={14} aria-hidden="true" />
              Retry connect
            </button>
            {error && <div className="seed-picker-error">{error}</div>}
          </div>
        ) : (
          <>
            <ul className="seed-picker-list">
              {accounts.map((acc) => (
                <li key={`${acc.address}-${acc.authToken}`}>
                  <button type="button" onClick={() => handlePick(acc)}>
                    <span className="seed-picker-acc-icon" aria-hidden="true">
                      <Wallet size={14} />
                    </span>
                    <span className="seed-picker-acc-meta">
                      <strong>{acc.accountName || acc.seedName || 'Seed Vault account'}</strong>
                      <span className="seed-picker-acc-addr">{shortAddress(acc.address)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="seed-picker-add"
              onClick={handleAuthorize}
              disabled={authorizing}
            >
              <Plus size={14} aria-hidden="true" />
              Add another wallet
            </button>
            {error && <div className="seed-picker-error">{error}</div>}
          </>
        )}
        <div className="seed-picker-legal">
          <span>By connecting, you agree to our</span>
          <span className="seed-picker-legal-links">
            <button type="button" onClick={() => setLegalSlug('terms')}>Terms</button>
            <span className="dot" aria-hidden="true">·</span>
            <button type="button" onClick={() => setLegalSlug('privacy')}>Privacy</button>
            <span className="dot" aria-hidden="true">·</span>
            <button type="button" onClick={() => setLegalSlug('cookies')}>Cookies</button>
            <span className="dot" aria-hidden="true">·</span>
            <button type="button" onClick={() => setLegalSlug('disclaimer')}>Disclaimer</button>
          </span>
        </div>
      </div>

      <LegalModal slug={legalSlug} onClose={() => setLegalSlug(null)} />
    </div>
  );
}
