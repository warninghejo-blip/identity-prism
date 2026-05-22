import {
  BaseSignerWalletAdapter,
  WalletName,
  WalletReadyState,
  WalletNotConnectedError,
  WalletSignMessageError,
  WalletSignTransactionError,
  WalletConnectionError,
  WalletDisconnectionError,
} from '@solana/wallet-adapter-base';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Capacitor } from '@capacitor/core';
import nacl from 'tweetnacl';
import { SeedVault } from './seedVaultPlugin';
import { readPreferredMobileWalletAddress } from './mobileWalletAddressPreference';

export const SEEDVAULT_NAME = 'Seed Vault' as WalletName<'Seed Vault'>;

// Minimal Solana SVG mark as data URI (placeholder brand icon)
const SEEDVAULT_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="#9945FF"/><stop offset="100%" stop-color="#14F195"/>` +
      `</linearGradient></defs>` +
      `<rect width="64" height="64" rx="14" fill="url(#g)"/>` +
      `<path fill="#fff" d="M16 22h28l-6 6H10zM16 32h28l-6 6H10zM16 42h28l-6 6H10z"/>` +
      `</svg>`,
  );

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type AuthorizedSeedVaultAccount = {
  authToken?: number | string;
  address: string;
  derivationPath: string;
  isUserWallet?: boolean;
  isValid?: boolean;
};

function normalizeAuthToken(value: unknown): number | null {
  const token = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(token) ? token : null;
}

function getPreferredSeedWalletIndex(maxExclusive?: number): number {
  try {
    const params = new URLSearchParams(window.location.search);
    const rawIndex = params.get('seedWallet') ?? window.localStorage?.getItem('ip_seed_wallet_index') ?? '';
    const parsed = Number.parseInt(rawIndex, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    if (maxExclusive != null && parsed >= maxExclusive) return 0;
    return parsed;
  } catch {
    return 0;
  }
}

function getPreferredAuthorizedAccount(accounts: AuthorizedSeedVaultAccount[]): AuthorizedSeedVaultAccount | null {
  const withAddress = accounts.filter(
    (account) => account.address && account.derivationPath && normalizeAuthToken(account.authToken) !== null,
  );
  const usable = withAddress.filter((account) => account.isValid !== false);
  const candidates = usable.length ? usable : withAddress;
  if (!candidates.length) return null;
  const preferredAddress = readPreferredMobileWalletAddress();
  if (preferredAddress) {
    const preferredAccount = candidates.find((account) => account.address === preferredAddress);
    if (preferredAccount) return preferredAccount;
  }

  const preferredIndex = getPreferredSeedWalletIndex(candidates.length);

  return candidates[preferredIndex] ?? candidates.find((account) => account.isUserWallet) ?? candidates[0] ?? null;
}

export class SeedVaultAdapter extends BaseSignerWalletAdapter {
  name = SEEDVAULT_NAME;
  url = 'https://solanamobile.com/seedvault';
  icon = SEEDVAULT_ICON;
  readyState: WalletReadyState = WalletReadyState.Unsupported;
  supportedTransactionVersions = null;

  private _publicKey: PublicKey | null = null;
  private _authToken: number | null = null;
  private _derivationPath: string | null = null;
  private _connecting = false;

  constructor() {
    super();
    if (Capacitor.isNativePlatform()) {
      // Eagerly mark Installed on native — the OS-level Wallet Provider is part of Solana
      // Mobile devices (Seeker). The async probe below corrects this if it's missing.
      this.readyState = WalletReadyState.Installed;
      SeedVault.isAvailable()
        .then(({ available }) => {
          const next = available ? WalletReadyState.Installed : WalletReadyState.Unsupported;
          if (next !== this.readyState) {
            this.readyState = next;
            this.emit('readyStateChange', this.readyState);
          }
        })
        .catch(() => {
          // Keep Installed — let connect() surface errors instead of suppressing the option.
        });
    }
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connected(): boolean {
    return this._publicKey !== null;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  async connect(): Promise<void> {
    if (this.connected || this._connecting) return;
    if (this.readyState !== WalletReadyState.Installed) {
      throw new WalletConnectionError('Seed Vault unavailable on this device');
    }
    this._connecting = true;
    try {
      const authorized = await SeedVault.getAuthorizedAccounts().catch(() => null);
      const account = authorized ? getPreferredAuthorizedAccount(authorized.accounts) : null;
      if (account) {
        this._authToken = normalizeAuthToken(account.authToken);
        if (this._authToken === null) throw new Error('Seed Vault account is missing auth token');
        this._derivationPath = account.derivationPath;
        this._publicKey = new PublicKey(account.address);
        this.emit('connect', this._publicKey);
        return;
      }

      const { authToken, address, derivationPath } = await SeedVault.authorize({
        accountIndex: getPreferredSeedWalletIndex(),
      });
      this._authToken = normalizeAuthToken(authToken);
      if (this._authToken === null) throw new Error('Seed Vault authorize returned no auth token');
      this._derivationPath = derivationPath;
      this._publicKey = new PublicKey(address);
      this.emit('connect', this._publicKey);
    } catch (e: any) {
      const err = new WalletConnectionError(e?.message || 'Seed Vault authorize failed', e);
      this.emit('error', err);
      throw err;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const token = this._authToken;
    this._publicKey = null;
    this._authToken = null;
    this._derivationPath = null;
    if (token !== null) {
      try {
        await SeedVault.deauthorize({ authToken: token });
      } catch (e: any) {
        this.emit('error', new WalletDisconnectionError(e?.message, e));
      }
    }
    this.emit('disconnect');
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (this._authToken === null) throw new WalletNotConnectedError();
    try {
      const messageB64 = bytesToBase64(message);
      const { signature } = await SeedVault.signMessage({
        authToken: this._authToken,
        message: messageB64,
        derivationPath: this._derivationPath || undefined,
      });
      return base64ToBytes(signature);
    } catch (e: any) {
      throw new WalletSignMessageError(e?.message || 'Seed Vault signMessage failed', e);
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    if (this._authToken === null) throw new WalletNotConnectedError();
    if (!this._publicKey) throw new WalletNotConnectedError();
    try {
      const messageBytes = transaction instanceof VersionedTransaction
        ? transaction.message.serialize()
        : (transaction as Transaction).serializeMessage();
      const txB64 = bytesToBase64(new Uint8Array(messageBytes));
      const { signature } = await SeedVault.signTransaction({
        authToken: this._authToken,
        transaction: txB64,
        derivationPath: this._derivationPath || undefined,
      });
      const signatureBytes = base64ToBytes(signature);
      if (signatureBytes.length !== 64) {
        throw new Error(`Invalid Seed Vault signature length: ${signatureBytes.length}`);
      }
      const isValidSignature = nacl.sign.detached.verify(
        new Uint8Array(messageBytes),
        signatureBytes,
        this._publicKey.toBytes(),
      );
      if (!isValidSignature) {
        throw new Error('Seed Vault returned a signature that does not verify for this transaction');
      }
      if (transaction instanceof VersionedTransaction) {
        const signerIndex = transaction.message.staticAccountKeys.findIndex((key) => key.equals(this._publicKey!));
        if (signerIndex < 0 || signerIndex >= transaction.message.header.numRequiredSignatures) {
          throw new Error('Seed Vault signer is not required for this transaction');
        }
        transaction.signatures[signerIndex] = signatureBytes;
        return transaction;
      }
      transaction.addSignature(this._publicKey, Buffer.from(signatureBytes));
      return transaction;
    } catch (e: any) {
      throw new WalletSignTransactionError(e?.message || 'Seed Vault signTransaction failed', e);
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    const out: T[] = [];
    for (const tx of transactions) {
      out.push(await this.signTransaction(tx));
    }
    return out;
  }

  /**
   * SIWS-like sign-in flow. Builds a canonical SIWS message and signs it via Seed Vault.
   * Returns the shape expected by @solana/wallet-standard-features `signIn`.
   */
  async signIn(
    input: { address?: string; domain?: string; nonce?: string; statement?: string; uri?: string; version?: string } = {},
  ): Promise<{
    account: { address: string; publicKey: Uint8Array };
    signedMessage: Uint8Array;
    signature: Uint8Array;
  }> {
    if (!this._publicKey) await this.connect();
    const address = this._publicKey!.toBase58();
    const domain = input.domain || 'identityprism.xyz';
    const nonce = input.nonce || Math.random().toString(36).slice(2, 10);
    const issuedAt = new Date().toISOString();
    const statement = input.statement || 'Sign in to Identity Prism';
    const uri = input.uri || `https://${domain}`;
    const version = input.version || '1';
    const messageText =
      `${domain} wants you to sign in with your Solana account:\n${address}\n\n` +
      `${statement}\n\n` +
      `URI: ${uri}\nVersion: ${version}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
    const messageBytes = new TextEncoder().encode(messageText);
    const signature = await this.signMessage(messageBytes);
    return {
      account: { address, publicKey: this._publicKey!.toBytes() },
      signedMessage: messageBytes,
      signature,
    };
  }
}
