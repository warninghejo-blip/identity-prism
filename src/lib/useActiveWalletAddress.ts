import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { getCachedJwt } from '@/components/prism/shared';

const AUTH_JWT_KEY = 'ip_auth_jwt';

const looksLikeSolanaAddress = (value: string | null | undefined) =>
  Boolean(value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value));

const parseJwtAddress = (raw: string | null) => {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as { address?: string };
    return looksLikeSolanaAddress(parsed.address) ? (parsed.address ?? '') : '';
  } catch {
    return '';
  }
};

const readJwtAddress = () => {
  try {
    const sessionRaw = sessionStorage.getItem(AUTH_JWT_KEY);
    const sessionAddress = parseJwtAddress(sessionRaw);
    if (sessionAddress && getCachedJwt(sessionAddress)) return sessionAddress;
  } catch {
    // ignore sessionStorage failures
  }
  try {
    const localRaw = localStorage.getItem(AUTH_JWT_KEY);
    const localAddress = parseJwtAddress(localRaw);
    if (localAddress && getCachedJwt(localAddress)) return localAddress;
  } catch {
    // ignore localStorage failures
  }
  return '';
};

export function useActiveWalletAddress() {
  const { publicKey } = useWallet();
  const [searchParams] = useSearchParams();
  const addressParam = searchParams.get('address');
  const searchKey = searchParams.toString();

  return useMemo(() => {
    const connectedAddress = publicKey?.toBase58();
    if (looksLikeSolanaAddress(connectedAddress) && getCachedJwt(connectedAddress ?? '')) return connectedAddress;
    if (looksLikeSolanaAddress(addressParam) && getCachedJwt(addressParam ?? '')) return addressParam ?? '';
    try {
      const stored = sessionStorage.getItem('prism_active_address');
      if (looksLikeSolanaAddress(stored) && getCachedJwt(stored ?? '')) return stored ?? '';
    } catch {
      // ignore storage failures
    }
    try {
      const stored = localStorage.getItem('prism_active_address');
      if (looksLikeSolanaAddress(stored) && getCachedJwt(stored ?? '')) return stored ?? '';
    } catch {
      // ignore storage failures
    }
    return readJwtAddress();
  }, [publicKey, addressParam, searchKey]);
}
