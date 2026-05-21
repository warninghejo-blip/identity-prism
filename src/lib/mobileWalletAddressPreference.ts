import { PublicKey } from '@solana/web3.js';

export const MOBILE_WALLET_ADDRESS_STORAGE_KEY = 'ip_mwa_preferred_address';
const MOBILE_WALLET_ADDRESS_QUERY_KEYS = ['mwaAddress', 'walletAddress', 'wallet'];

export function base64AddressToBase58(address: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(address), (char) => char.charCodeAt(0));
    return new PublicKey(bytes).toBase58();
  } catch {
    return null;
  }
}

function persistPreferredAddress(address: string): string {
  try {
    localStorage.setItem(MOBILE_WALLET_ADDRESS_STORAGE_KEY, address);
  } catch {
    /* ignore localStorage failures */
  }
  return address;
}

function readAddressFromParams(params: URLSearchParams): string | null {
  return (
    MOBILE_WALLET_ADDRESS_QUERY_KEYS
      .map((key) => params.get(key)?.trim())
      .find((value): value is string => Boolean(value)) ?? null
  );
}

function extractAddressFromUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const requested = readAddressFromParams(parsed.searchParams);
    if (requested) return requested;
  } catch {
    /* fall through to loose query parsing */
  }

  const query = rawUrl.split('?')[1]?.split('#')[0];
  if (!query) return null;
  try {
    return readAddressFromParams(new URLSearchParams(query));
  } catch {
    return null;
  }
}

export function capturePreferredMobileWalletAddressFromUrl(rawUrl?: string | null): string | null {
  const requested = extractAddressFromUrl(rawUrl);
  return requested ? persistPreferredAddress(requested) : null;
}

export function readPreferredMobileWalletAddress(): string | null {
  const requested =
    capturePreferredMobileWalletAddressFromUrl(window.location.search) ||
    capturePreferredMobileWalletAddressFromUrl(window.location.href) ||
    capturePreferredMobileWalletAddressFromUrl(window.location.hash);
  if (requested) return requested;

  try {
    return localStorage.getItem(MOBILE_WALLET_ADDRESS_STORAGE_KEY);
  } catch {
    return null;
  }
}
