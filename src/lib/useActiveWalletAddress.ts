import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { getCachedJwt } from '@/components/prism/shared';
import { isDemoMode } from '@/lib/demoMode';

const looksLikeSolanaAddress = (value: string | null | undefined) =>
  Boolean(value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value));

const readJwtAddress = () => {
  try {
    const raw = sessionStorage.getItem('ip_auth_jwt');
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { address?: string };
    const address = parsed.address ?? '';
    if (looksLikeSolanaAddress(address) && getCachedJwt(address)) return address;
  } catch {
    // ignore sessionStorage failures
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
    if (isDemoMode()) {
      try {
        const demoAddress = sessionStorage.getItem('prism_active_address');
        if (looksLikeSolanaAddress(demoAddress)) return demoAddress ?? '';
      } catch {
        // ignore sessionStorage failures
      }
    }
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
