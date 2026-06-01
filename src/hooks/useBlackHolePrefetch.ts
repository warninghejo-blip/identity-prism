import { useEffect } from 'react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { ParsedAccountData, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@/lib/solanaToken';
import { getHeliusProxyUrl } from '@/constants';

export type BlackHolePrefetchToken = {
  pubkey: string;
  programId: string;
  lamports: number;
  data: ParsedAccountData['parsed'];
};

export type BlackHolePrefetchMetadata = {
  mint?: string;
  name?: string;
  symbol?: string;
  image?: string;
  isNft?: boolean;
  collectionId?: string;
  collectionName?: string;
  collectionSymbol?: string;
  priceUsd?: number | null;
  floorSol?: number | null;
  marketFloorSol?: number | null;
  marketStatus?: 'listed' | 'not_listed' | 'unknown';
  marketSource?: 'magic_eden' | 'tensor' | 'helius' | null;
  listedCount?: number | null;
  tensorUrl?: string | null;
  meUrl?: string | null;
};

export type BlackHolePrefetchCache = {
  tokenAccounts: BlackHolePrefetchToken[];
  timestamp: number;
  complete?: boolean;
  programCounts?: Record<string, number>;
  metadataStatus?: 'ready' | 'failed' | 'partial' | string;
  metadata?: Record<string, BlackHolePrefetchMetadata>;
  solUsd?: number | null;
  identityPerks?: any;
};

type ParsedTokenAccountItem = {
  pubkey: string;
  account: {
    lamports: number;
    data: {
      parsed: ParsedAccountData['parsed'];
    };
  };
};

const TTL_MS = 10 * 60 * 1000;
const PREFETCH_TIMEOUT_MS = 30_000;
const METADATA_TIMEOUT_MS = 15_000;
const METADATA_BATCH_SIZE = 20;
const METADATA_CACHE_KEY = 'bh_metadata_v3';
const METADATA_LEGACY_CACHE_KEY = 'identity-prism:blackhole-metadata:v3';
const METADATA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const inflightPrefetch = new Map<string, Promise<BlackHolePrefetchCache | null>>();

export const getBlackHolePrefetchKey = (address: string) => `bh_prefetch_${address}`;

const parseJsonPayload = <T,>(data: unknown): T => {
  if (typeof data === 'string') return JSON.parse(data) as T;
  return data as T;
};

const fetchJson = async <T,>(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    data?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<T> => {
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? PREFETCH_TIMEOUT_MS;
  const headers = { Accept: 'application/json', ...options.headers };

  if (Capacitor.isNativePlatform()) {
    const response =
      method === 'POST'
        ? await CapacitorHttp.post({
            url,
            headers,
            data: options.data,
            responseType: 'text',
            connectTimeout: timeoutMs,
            readTimeout: timeoutMs,
          })
        : await CapacitorHttp.get({
            url,
            headers,
            responseType: 'text',
            connectTimeout: timeoutMs,
            readTimeout: timeoutMs,
          });
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    return parseJsonPayload<T>(response.data);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
};

export function readBlackHolePrefetch(address: string): BlackHolePrefetchCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = getBlackHolePrefetchKey(address);
    const parseCache = (raw: string | null) => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as BlackHolePrefetchCache | null;
      } catch {
        return null;
      }
    };
    const parsed = [window.localStorage.getItem(key), window.sessionStorage.getItem(key)]
      .map(parseCache)
      .filter((cache): cache is BlackHolePrefetchCache => Boolean(cache))
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > TTL_MS || !Array.isArray(parsed.tokenAccounts)) {
      return null;
    }
    const splCount = parsed.programCounts?.[TOKEN_PROGRAM_ID.toBase58()];
    const token2022Count = parsed.programCounts?.[TOKEN_2022_PROGRAM_ID.toBase58()];
    if (parsed.complete !== true && parsed.tokenAccounts.length > 0 && parsed.tokenAccounts.length < 8) return null;
    if ((splCount ?? 0) === 0 && (token2022Count ?? 0) > 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBlackHolePrefetch(address: string, cache: BlackHolePrefetchCache) {
  if (typeof window === 'undefined') return;
  const payload = JSON.stringify(cache);
  const key = getBlackHolePrefetchKey(address);
  try {
    window.localStorage.setItem(key, payload);
  } catch {
    /* storage can be unavailable */
  }
  try {
    window.sessionStorage.setItem(key, payload);
  } catch {
    /* storage can be unavailable */
  }
}

const readPersistentMetadataCache = () => {
  if (typeof window === 'undefined') return {};
  try {
    const readCache = (key: string) => {
      const parsed = JSON.parse(window.localStorage.getItem(key) || '{}') as {
        timestamp?: number;
        assets?: Record<string, BlackHolePrefetchMetadata>;
      };
      if (!parsed.timestamp || Date.now() - parsed.timestamp > METADATA_CACHE_TTL_MS) return {};
      return parsed.assets && typeof parsed.assets === 'object' ? parsed.assets : {};
    };
    return {
      ...readCache(METADATA_LEGACY_CACHE_KEY),
      ...readCache(METADATA_CACHE_KEY),
    };
  } catch {
    return {};
  }
};

const writePersistentMetadataCache = (assets: Record<string, BlackHolePrefetchMetadata>) => {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify({ timestamp: Date.now(), assets });
    window.localStorage.setItem(METADATA_CACHE_KEY, payload);
    window.localStorage.setItem(METADATA_LEGACY_CACHE_KEY, payload);
  } catch {
    /* cache is opportunistic */
  }
};

const fetchProgramAccounts = async (base: string, address: string, programId: string) => {
  const url = new URL(`${base}/api/blackhole/token-accounts`);
  url.searchParams.set('address', address);
  url.searchParams.set('programId', programId);
  const data = await fetchJson<{ value?: ParsedTokenAccountItem[] }>(url.toString(), {
    timeoutMs: PREFETCH_TIMEOUT_MS,
  });
  return data.value ?? [];
};

const toPrefetchTokens = (items: ParsedTokenAccountItem[], programId: string): BlackHolePrefetchToken[] =>
  items
    .map((item) => ({
      pubkey: item.pubkey,
      programId,
      lamports: item.account.lamports,
      data: item.account.data.parsed,
    }))
    .filter((item) => Boolean(item.pubkey && item.data?.info?.mint));

const fetchMetadata = async (base: string, address: string, mints: string[]) => {
  const cachedMetadata = readPersistentMetadataCache();
  const metadata: Record<string, BlackHolePrefetchMetadata> = {};
  const missing: string[] = [];
  const uniqueMints = [...new Set(mints.filter(Boolean))];
  uniqueMints.forEach((mint) => {
    const cached = cachedMetadata[mint];
    if (cached) metadata[mint] = cached;
    else missing.push(mint);
  });

  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += METADATA_BATCH_SIZE) {
    batches.push(missing.slice(i, i + METADATA_BATCH_SIZE));
  }
  const results = await Promise.allSettled(
    batches.map((batch) =>
      fetchJson<{ assets?: Record<string, BlackHolePrefetchMetadata> }>(`${base}/api/blackhole/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: { address, mints: batch },
        timeoutMs: METADATA_TIMEOUT_MS,
      }),
    ),
  );
  results.forEach((result) => {
    if (result.status === 'fulfilled') Object.assign(metadata, result.value.assets ?? {});
    else console.warn('[BH prefetch] metadata batch failed', result.reason);
  });
  writePersistentMetadataCache({ ...cachedMetadata, ...metadata });
  return metadata;
};

const fetchSolUsd = async (base: string) => {
  try {
    const data = await fetchJson<Record<string, any>>(`${base}/api/market/sol-price`, { timeoutMs: 7_000 });
    const value = data?.solana?.usd ?? data?.usd ?? data?.price;
    const parsed = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const fetchIdentityPerks = async (base: string, address: string) => {
  try {
    return await fetchJson<any>(`${base}/api/identity/perks?address=${encodeURIComponent(address)}`, { timeoutMs: 7_000 });
  } catch {
    return null;
  }
};

export async function prefetchBlackHoleForAddress(
  address: string,
  options: { force?: boolean; source?: string } = {},
): Promise<BlackHolePrefetchCache | null> {
  if (!address || typeof window === 'undefined') return null;
  const existing = readBlackHolePrefetch(address);
  if (!options.force && existing?.complete && existing.metadataStatus === 'ready') return existing;

  const currentInflight = inflightPrefetch.get(address);
  if (currentInflight) return currentInflight;

  const request = (async () => {
    const base = getHeliusProxyUrl();
    if (!base) return null;

    const splProgram = TOKEN_PROGRAM_ID.toBase58();
    const token2022Program = TOKEN_2022_PROGRAM_ID.toBase58();
    const [splResult, token2022Result] = await Promise.allSettled([
      fetchProgramAccounts(base, address, splProgram),
      fetchProgramAccounts(base, address, token2022Program),
    ]);

    if (splResult.status !== 'fulfilled') {
      console.warn('[BH prefetch] SPL token scan failed; not caching partial Token-2022-only result', splResult.reason);
      return null;
    }

    const spl = splResult.value;
    const token2022 = token2022Result.status === 'fulfilled' ? token2022Result.value : [];
    if (token2022Result.status === 'rejected') {
      console.warn('[BH prefetch] Token-2022 scan failed; caching SPL result only', token2022Result.reason);
    }

    const tokenAccounts = [
      ...toPrefetchTokens(spl, splProgram),
      ...toPrefetchTokens(token2022, token2022Program),
    ];
    if (tokenAccounts.length === 0) return null;

    const mints = tokenAccounts.map((account) => account.data.info?.mint).filter(Boolean);
    const [metadataResult, solUsd, identityPerks] = await Promise.all([
      fetchMetadata(base, address, mints).then(
        (metadata) => ({ status: 'ready' as const, metadata }),
        (error) => {
          console.warn('[BH prefetch] metadata failed', error);
          return { status: 'failed' as const, metadata: {} };
        },
      ),
      fetchSolUsd(base),
      fetchIdentityPerks(base, address),
    ]);

    const cache: BlackHolePrefetchCache = {
      tokenAccounts,
      timestamp: Date.now(),
      complete: token2022Result.status === 'fulfilled',
      programCounts: {
        [splProgram]: spl.length,
        [token2022Program]: token2022.length,
      },
      metadataStatus: metadataResult.status,
      metadata: metadataResult.metadata,
      solUsd,
      identityPerks,
    };
    writeBlackHolePrefetch(address, cache);
    console.warn(
      `[BH prefetch] ${options.source ?? 'prefetch'} cached ${tokenAccounts.length} tokens ` +
        `(SPL ${spl.length}, Token-2022 ${token2022.length}, metadata ${Object.keys(metadataResult.metadata).length})`,
    );
    return cache;
  })().finally(() => {
    inflightPrefetch.delete(address);
  });

  inflightPrefetch.set(address, request);
  return request;
}

export function useBlackHolePrefetch(publicKey: PublicKey | null) {
  useEffect(() => {
    if (!publicKey) return;
    const address = publicKey.toBase58();
    const timeout = window.setTimeout(() => {
      void prefetchBlackHoleForAddress(address, { source: 'site-header' }).catch((error) => {
        console.warn('[BH prefetch]', error);
      });
    }, 100);
    return () => window.clearTimeout(timeout);
  }, [publicKey]);
}
