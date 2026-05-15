import { useEffect } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import type { ParsedAccountData, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@/lib/solanaToken';

export type BlackHolePrefetchToken = {
  pubkey: string;
  programId: string;
  lamports: number;
  data: ParsedAccountData['parsed'];
};

export type BlackHolePrefetchCache = {
  tokenAccounts: BlackHolePrefetchToken[];
  timestamp: number;
};

const TTL_MS = 5 * 60 * 1000;

export const getBlackHolePrefetchKey = (address: string) => `bh_prefetch_${address}`;

export function readBlackHolePrefetch(address: string): BlackHolePrefetchCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(getBlackHolePrefetchKey(address)) || 'null') as BlackHolePrefetchCache | null;
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > TTL_MS || !Array.isArray(parsed.tokenAccounts)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function useBlackHolePrefetch(publicKey: PublicKey | null) {
  const { connection } = useConnection();

  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    const address = publicKey.toBase58();

    void (async () => {
      try {
        if (readBlackHolePrefetch(address)) return;
        const [spl, token2022] = await Promise.allSettled([
          connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
          connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
        ]);
        if (cancelled) return;
        const tokenAccounts: BlackHolePrefetchToken[] = [];
        if (spl.status === 'fulfilled') {
          tokenAccounts.push(
            ...spl.value.value.map((account) => ({
              pubkey: account.pubkey.toBase58(),
              programId: TOKEN_PROGRAM_ID.toBase58(),
              lamports: account.account.lamports,
              data: (account.account.data as ParsedAccountData).parsed,
            })),
          );
        }
        if (token2022.status === 'fulfilled') {
          tokenAccounts.push(
            ...token2022.value.value.map((account) => ({
              pubkey: account.pubkey.toBase58(),
              programId: TOKEN_2022_PROGRAM_ID.toBase58(),
              lamports: account.account.lamports,
              data: (account.account.data as ParsedAccountData).parsed,
            })),
          );
        }
        sessionStorage.setItem(
          getBlackHolePrefetchKey(address),
          JSON.stringify({ tokenAccounts, timestamp: Date.now() } satisfies BlackHolePrefetchCache),
        );
      } catch (error) {
        console.warn('[BH prefetch]', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);
}
