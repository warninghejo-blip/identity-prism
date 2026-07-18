import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { isDemoMode } from '@/lib/demoMode';
import type { WalletName } from '@solana/wallet-adapter-base';
import {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createBurnInstruction,
  createCloseAccountInstruction,
  resolveUnknownToken,
} from '@/lib/solanaToken';
import {
  readBlackHolePrefetch,
  writeBlackHolePrefetch,
  type BlackHolePrefetchCache,
  type BlackHolePrefetchToken,
} from '@/hooks/useBlackHolePrefetch';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { SolanaMobileWalletAdapterWalletName } from '@solana-mobile/wallet-adapter-mobile';
import { toast, Toaster as Sonner } from '@/components/ui/sonner';
import { Loader2, RefreshCw, Shield, AlertTriangle, Flame, Coins } from 'lucide-react';
import {
  getHeliusProxyUrl,
  getHeliusRpcUrl,
  getCollectionMint,
  TOKEN_ADDRESSES,
  SEEKER_TOKEN,
  BLUE_CHIP_COLLECTIONS,
} from '@/constants';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
// burn coin earning disabled server-side (no on-chain verification)
// import { earnPrism, calculateBurnPrism } from '@/lib/prismCoin';
import { ensureJwt, getApiBase, setAuthWallet } from '@/components/prism/shared';
import { api, type IdentityPerkSnapshot } from '@/lib/api';
import SiteHeader from '@/components/SiteHeader';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import HubReturnButton from '@/components/HubReturnButton';

type AssetStatus = 'protected' | 'valuable' | 'burnable';
type ResolutionAction = 'swap' | 'burn' | 'close' | 'skip';
const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

interface TokenAccount {
  pubkey: PublicKey;
  programId: PublicKey;
  mint: string;
  amount: bigint;
  decimals: number;
  uiAmount: number;
  lamports: number;
  rentSol: number;
  symbol?: string;
  name?: string;
  image?: string;
  isNft?: boolean;
  collectionId?: string;
  collectionName?: string;
  collectionSymbol?: string;
  marketStatus?: 'listed' | 'not_listed' | 'unknown';
  marketSource?: 'magic_eden' | 'tensor' | 'helius' | null;
  marketFloorSol?: number | null;
  listedCount?: number | null;
  tensorUrl?: string | null;
  meUrl?: string | null;
  priceUsd?: number | null;
  valueUsd?: number | null;
  valueSol?: number | null;
  netGainSol?: number | null;
  frozen?: boolean;
  closeable?: boolean;
  isCandidate?: boolean;
  assetStatus?: AssetStatus;
  protectReason?: string;
  metadataImageMissing?: boolean;
  metadataPending?: boolean;
}

interface MarketStats {
  status: 'listed' | 'not_listed' | 'unknown';
  floorSol?: number | null;
  source?: 'magic_eden' | 'tensor' | 'helius';
  listedCount?: number | null;
  tensorUrl?: string | null;
  meUrl?: string | null;
}

interface IncinerationToken {
  id: string;
  image?: string;
  label: string;
  delay: number;
  startX: string;
  startY: string;
}

interface SwapQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount?: string;
  outAmount?: string;
  amount?: string;
  mode?: 'legacy_raw' | 'order_execute';
  priceImpactPct?: string;
  routePlan?: unknown[];
  [key: string]: unknown;
}

interface SwapQuoteResult {
  outSol: number;
  outLamports: number;
  priceImpactPct: number;
  quoteResponse: SwapQuoteResponse;
  transport: 'legacy_raw' | 'order_execute';
}

interface ResolutionPlanItem {
  token: TokenAccount;
  action: ResolutionAction;
  reason: string;
  estimatedNetSol: number;
  estimatedBurnNetSol: number | null;
  estimatedSwapNetSol: number | null;
  swapQuote: SwapQuoteResult | null;
}

interface ResolutionOperation {
  account: string;
  mint: string;
  action: Extract<ResolutionAction, 'swap' | 'burn' | 'close'>;
  closeSignature: string;
  swapSignature?: string;
}

interface PreparedSwapTransaction {
  swapTransaction: string;
  transport: 'legacy_raw' | 'order_execute';
  requestId?: string;
}

interface ParsedTokenAccountItem {
  pubkey: string;
  account: {
    lamports: number;
    data: {
      parsed: {
        info: {
          mint: string;
          state?: string;
          extensions?: unknown[];
          tokenAmount?: {
            amount?: string;
            decimals?: number;
            uiAmount?: number | null;
          };
        };
      };
    };
  };
}

interface RpcResponse<T> {
  result?: T;
  error?: { message?: string };
}

const BLACKHOLE_RPC_TIMEOUT_MS = 18_000;
const BLACKHOLE_TOKEN_ACCOUNTS_TIMEOUT_MS = 45_000;
const BLACKHOLE_AUX_TIMEOUT_MS = 7_000;
const BLACKHOLE_METADATA_TIMEOUT_MS = 15_000;
const BLACKHOLE_NATIVE_PRE_SIGN_SIMULATION_TIMEOUT_MS = 5_000;
const BLACKHOLE_METADATA_CACHE_KEY = 'bh_metadata_v4';
const BLACKHOLE_METADATA_LEGACY_CACHE_KEY = 'identity-prism:blackhole-metadata:v4';
const BLACKHOLE_METADATA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BLACKHOLE_IMAGE_CACHE_KEY = 'bh_image_cache_v4';
const BLACKHOLE_IMAGE_URL_CACHE_KEY = 'bh_image_url_cache_v1';
const BLACKHOLE_IMAGE_FAILURE_CACHE_KEY = 'bh_image_failure_cache_v2';
const BLACKHOLE_IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BLACKHOLE_IMAGE_FAILED = '__failed__';
const BLACKHOLE_IMAGE_FAILURE_RETRY_MS = 60 * 60 * 1000;
const BLACKHOLE_IMAGE_MAX_ATTEMPTS = 3;
const BLACKHOLE_METADATA_BATCH_SIZE = 20;
const BLACKHOLE_METADATA_MAX_CONCURRENT = 4;

const parseJsonPayload = <T,>(data: unknown): T => {
  if (typeof data === 'string') return JSON.parse(data) as T;
  return data as T;
};

const fetchJsonWithTimeout = async <T,>(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    data?: unknown;
    timeoutMs?: number;
    transport?: 'native' | 'web';
  } = {},
): Promise<T> => {
  const method = options.method ?? 'GET';
  const headers = { Accept: 'application/json', ...options.headers };
  const timeoutMs = options.timeoutMs ?? BLACKHOLE_AUX_TIMEOUT_MS;
  let abortRequest: (() => void) | null = null;

  const request = (async () => {
    if (Capacitor.isNativePlatform() && options.transport !== 'web') {
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
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }
      return parseJsonPayload<T>(response.data);
    }

    const controller = new AbortController();
    abortRequest = () => controller.abort();
    const response = await fetch(url, {
      method,
      headers,
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  })();

  let timeout: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => {
      abortRequest?.();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeoutPromise]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeout: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
};

const blackholeWithTimeout = <T,>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T> =>
  withTimeout(promise, timeoutMs, `[blackhole] ${label}`);

const simulateBlackHoleBeforeSign = async (
  connection: {
    simulateTransaction: (...args: any[]) => Promise<{ value: { err: unknown; logs?: string[] | null } }>;
  },
  tx: Transaction | VersionedTransaction,
  label: string,
) => {
  try {
    console.warn(`[blackhole] pre-sign simulateTransaction — ${label}`);
    // dApp Store compliance: every burn/close/swap transaction attempts
    // simulation before wallet signing. Native RPC gets a strict timeout so
    // reviewers can see the preflight attempt without reintroducing hangs.
    const simulation = await blackholeWithTimeout(
      `${label} simulateTransaction`,
      tx instanceof Transaction
        ? connection.simulateTransaction(tx, undefined, {
            sigVerify: false,
            replaceRecentBlockhash: true,
          })
        : connection.simulateTransaction(tx, {
            sigVerify: false,
            replaceRecentBlockhash: true,
          }),
      Capacitor.isNativePlatform() ? BLACKHOLE_NATIVE_PRE_SIGN_SIMULATION_TIMEOUT_MS : 12_000,
    );
    if (simulation.value.err) {
      throw new Error(`${label} simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }
    console.warn(`[blackhole] pre-sign simulation ok — ${label}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('simulation failed')) throw error;
    console.warn(`[blackhole] Could not pre-flight ${label}`, error);
    toast.warning('Could not pre-flight the transaction', {
      description: 'RPC simulation timed out or was unavailable. Review the wallet preview before signing.',
      duration: 8000,
    });
  }
};

const fetchIdentityPerksWithTimeout = (address: string) =>
  withTimeout<IdentityPerkSnapshot>(api.getIdentityPerks(address), BLACKHOLE_AUX_TIMEOUT_MS, 'Identity perks');

const postRpcJson = async <T,>(
  url: string,
  payload: unknown,
  timeoutMs = BLACKHOLE_RPC_TIMEOUT_MS,
  options: {
    headers?: Record<string, string>;
    transport?: 'native' | 'web';
  } = {},
) => {
  const response = await fetchJsonWithTimeout<RpcResponse<T>>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    data: payload,
    timeoutMs,
    transport: options.transport,
  });
  if (response.error) {
    throw new Error(response.error.message || 'RPC error');
  }
  return response.result;
};

const fetchParsedTokenAccounts = async (owner: PublicKey, programId: PublicKey) => {
  const ownerBase58 = owner.toBase58();
  const programBase58 = programId.toBase58();
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Backend endpoint is not configured');
  const url = new URL(`${apiBase}/api/blackhole/token-accounts`);
  url.searchParams.set('address', ownerBase58);
  url.searchParams.set('programId', programBase58);
  const data = await fetchJsonWithTimeout<{ value?: ParsedTokenAccountItem[]; selectedCount?: number }>(url.toString(), {
    timeoutMs: BLACKHOLE_TOKEN_ACCOUNTS_TIMEOUT_MS,
  });
  const value = data?.value ?? [];
  console.warn(`[BH scan] ${programBase58} received ${value.length} token accounts`);
  return value;
};

const toBlackHolePrefetchTokens = (items: ParsedTokenAccountItem[], programId: PublicKey): BlackHolePrefetchToken[] =>
  items.map((item) => ({
    pubkey: item.pubkey,
    programId: programId.toBase58(),
    lamports: item.account.lamports,
    data: item.account.data.parsed,
  }));

const formatUsd = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value === 0) return '$0.00';
  const abs = Math.abs(value);
  if (abs < 0.0001) return '<$0.0001';
  if (abs < 0.01) return `$${parseFloat(value.toFixed(4))}`;
  if (abs < 1) return `$${parseFloat(value.toFixed(3))}`;
  return `$${value.toFixed(2)}`;
};

const parseNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const _formatSol = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value === 0) return '0.0000 SOL';
  return `${value.toFixed(4)} SOL`;
};

const _formatSolGain = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(4)} SOL`;
};

const looksLikeSolanaAddress = (value: string | null | undefined) =>
  Boolean(value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value));

const readStoredBlackHoleAddress = () => {
  const readJwtAddress = (raw: string | null) => {
    if (!raw || raw[0] !== '{') return '';
    try {
      const parsed = JSON.parse(raw) as { address?: string };
      return looksLikeSolanaAddress(parsed.address) ? (parsed.address ?? '') : '';
    } catch {
      return '';
    }
  };

  const readMwaAddress = (raw: string | null) => {
    if (!raw || raw[0] !== '{') return '';
    try {
      const parsed = JSON.parse(raw) as {
        accounts?: Array<{ address?: string; publicKey?: string | Record<string, number> | number[] }>;
      };
      const account = parsed.accounts?.[0];
      if (looksLikeSolanaAddress(account?.address)) return account?.address ?? '';
      if (typeof account?.publicKey === 'string' && looksLikeSolanaAddress(account.publicKey)) return account.publicKey;
    } catch {
      return '';
    }
    return '';
  };

  const readers = [
    () => sessionStorage.getItem('prism_active_address'),
    () => localStorage.getItem('prism_active_address'),
    () => readJwtAddress(sessionStorage.getItem('ip_auth_jwt')),
    () => readJwtAddress(localStorage.getItem('ip_auth_jwt')),
    () => readMwaAddress(localStorage.getItem('SolanaMobileWalletAdapterDefaultAuthorizationCache')),
  ];

  for (const read of readers) {
    try {
      const value = read();
      if (looksLikeSolanaAddress(value)) return value ?? '';
    } catch {
      // Storage can be unavailable; fall through to the next source.
    }
  }
  return '';
};

const formatCompact = (value: number): string => {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs < 0.0001 && abs > 0) return '~0';
  if (abs >= 1_000_000) return `${parseFloat((value / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${parseFloat((value / 1_000).toFixed(1))}K`;
  if (abs >= 100) return `${Math.round(value)}`;
  if (abs >= 1) return `${parseFloat(value.toFixed(2))}`;
  return `${parseFloat(value.toFixed(4))}`;
};

const formatSolCompact = (value?: number | null): string | null => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value === 0) return '~0';
  const abs = Math.abs(value);
  if (abs < 0.00005) return '~0';
  if (abs >= 1000) return `${formatCompact(value)}`;
  if (abs >= 1) return `${parseFloat(value.toFixed(2))}`;
  if (abs >= 0.01) return `${parseFloat(value.toFixed(4))}`;
  return `${parseFloat(value.toFixed(6))}`;
};

const getNftFloorLabel = (token: Pick<TokenAccount, 'isNft' | 'marketFloorSol'>, solUsd?: number | null) => {
  if (!token.isNft || token.marketFloorSol === null || token.marketFloorSol === undefined || token.marketFloorSol <= 0) {
    return null;
  }
  const usd = solUsd ? formatUsd(token.marketFloorSol * solUsd) : null;
  return usd ? `Floor ${usd}` : `Floor ${formatSolCompact(token.marketFloorSol)} SOL`;
};

const getAssetDisplayName = (token: Pick<TokenAccount, 'symbol' | 'name' | 'mint'>) => {
  const name = (token.name || token.symbol || '').trim();
  return name || `Token ${token.mint.slice(0, 4)}...`;
};

const getTokenProgramLabel = (token: Pick<TokenAccount, 'programId'>) =>
  token.programId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'SPL';

const getTokenTooltip = (token: TokenAccount) =>
  [
    `Mint: ${token.mint}`,
    `Program: ${getTokenProgramLabel(token)}`,
    `Decimals: ${token.decimals}`,
    token.valueSol !== undefined && token.valueSol !== null ? `Value: ${formatSolCompact(token.valueSol)} SOL` : null,
  ]
    .filter(Boolean)
    .join('\n');

const fetchCollectionMarketStats = async (
  proxyBase: string | null,
  symbol?: string,
  collectionId?: string,
  collectionName?: string,
  sampleMint?: string,
): Promise<MarketStats> => {
  if (!proxyBase || (!symbol && !collectionId && !collectionName && !sampleMint)) {
    return { status: 'unknown' };
  }
  try {
    const url = new URL(`${proxyBase}/api/market/collection-stats`);
    if (symbol) url.searchParams.set('symbol', symbol);
    if (collectionId) url.searchParams.set('collectionId', collectionId);
    if (collectionName) url.searchParams.set('name', collectionName);
    if (sampleMint) url.searchParams.set('mint', sampleMint);
    const data = await fetchJsonWithTimeout<Record<string, unknown>>(url.toString(), {
      timeoutMs: BLACKHOLE_AUX_TIMEOUT_MS,
    });
    const status = data?.status === 'listed' || data?.status === 'not_listed' ? data.status : 'unknown';
    const floorSol = parseNumber(data?.floorSol);
    const source =
      data?.source === 'magic_eden' || data?.source === 'tensor' || data?.source === 'helius'
        ? data.source
        : undefined;
    const listedCount = parseNumber(data?.listedCount);
    return {
      status,
      floorSol,
      source,
      listedCount,
      tensorUrl: data?.tensorUrl ?? null,
      meUrl: data?.meUrl ?? null,
    };
  } catch {
    return { status: 'unknown' };
  }
};

const fetchSolPriceUsd = async (proxyBase: string | null) => {
  if (!proxyBase) return null;
  const request = {
    timeoutMs: BLACKHOLE_AUX_TIMEOUT_MS,
  };
  try {
    const data = await fetchJsonWithTimeout<Record<string, any>>(`${proxyBase}/api/market/sol-price`, {
      ...request,
      transport: 'web',
    });
    return parseNumber(data?.solana?.usd) ?? parseNumber(data?.usd) ?? parseNumber(data?.price) ?? null;
  } catch {
    try {
      const data = await fetchJsonWithTimeout<Record<string, any>>(`${proxyBase}/api/market/sol-price`, {
        timeoutMs: BLACKHOLE_AUX_TIMEOUT_MS,
      });
      return parseNumber(data?.solana?.usd) ?? parseNumber(data?.usd) ?? parseNumber(data?.price) ?? null;
    } catch {
      return null;
    }
  }
};

type BlackHoleMetadataAsset = {
  mint?: string;
  name?: string;
  symbol?: string;
  image?: string | null;
  imageUrl?: string | null;
  imageSource?: 'helius' | 'magic_eden' | 'birdeye' | 'jupiter' | 'metaplex' | 'ipfs_gateway' | null;
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

type BlackHoleMetadataResponse = {
  assets?: Record<string, BlackHoleMetadataAsset>;
};

type CachedBlackHoleMetadata = {
  timestamp: number;
  assets: Record<string, BlackHoleMetadataAsset>;
};

const readBlackHoleMetadataCache = () => {
  if (typeof window === 'undefined') return {};
  try {
    const readCache = (key: string) => {
      const parsed = JSON.parse(window.localStorage.getItem(key) || '{}') as CachedBlackHoleMetadata;
      if (!parsed?.timestamp || Date.now() - parsed.timestamp > BLACKHOLE_METADATA_CACHE_TTL_MS) return {};
      return parsed.assets && typeof parsed.assets === 'object' ? parsed.assets : {};
    };
    return {
      ...readCache(BLACKHOLE_METADATA_LEGACY_CACHE_KEY),
      ...readCache(BLACKHOLE_METADATA_CACHE_KEY),
    };
  } catch {
    return {};
  }
};

const writeBlackHoleMetadataCache = (assets: Record<string, BlackHoleMetadataAsset>) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      BLACKHOLE_METADATA_CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), assets } satisfies CachedBlackHoleMetadata),
    );
    window.localStorage.setItem(
      BLACKHOLE_METADATA_LEGACY_CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), assets } satisfies CachedBlackHoleMetadata),
    );
  } catch {
    /* cache is opportunistic */
  }
};

const fetchBlackHoleMetadataBatch = async (
  address: string,
  mints: string[],
): Promise<BlackHoleMetadataResponse> => {
  const metadataRequest = {
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json' },
    data: { address, mints },
    timeoutMs: BLACKHOLE_METADATA_TIMEOUT_MS,
  };
  const url = `${getApiBase()}/api/blackhole/metadata`;

  if (Capacitor.isNativePlatform()) {
    try {
      return await fetchJsonWithTimeout<BlackHoleMetadataResponse>(url, metadataRequest);
    } catch (nativeMetadataError) {
      console.warn('[BlackHole] native metadata fetch failed, retrying web transport', nativeMetadataError);
      return fetchJsonWithTimeout<BlackHoleMetadataResponse>(url, {
        ...metadataRequest,
        transport: 'web',
      });
    }
  }

  return fetchJsonWithTimeout<BlackHoleMetadataResponse>(url, {
    ...metadataRequest,
    transport: 'web',
  });
};

const fetchBlackHoleMetadata = async (address: string, mints: string[]): Promise<BlackHoleMetadataResponse> => {
  const uniqueMints = [...new Set(mints.filter(Boolean))];
  const cachedAssets = readBlackHoleMetadataCache();
  const assets: Record<string, BlackHoleMetadataAsset> = {};
  const missing: string[] = [];

  uniqueMints.forEach((mint) => {
    const cached = cachedAssets[mint];
    if (cached) {
      assets[mint] = cached;
    } else {
      missing.push(mint);
    }
  });

  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += BLACKHOLE_METADATA_BATCH_SIZE) {
    batches.push(missing.slice(i, i + BLACKHOLE_METADATA_BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i += BLACKHOLE_METADATA_MAX_CONCURRENT) {
    const slice = batches.slice(i, i + BLACKHOLE_METADATA_MAX_CONCURRENT);
    const results = await Promise.allSettled(slice.map((batch) => fetchBlackHoleMetadataBatch(address, batch)));
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        Object.assign(assets, result.value.assets ?? {});
      } else {
        console.warn('[BlackHole] metadata batch skipped', result.reason);
      }
    });
  }

  writeBlackHoleMetadataCache({ ...cachedAssets, ...assets });
  return { assets };
};

const sortTokensForDisplay = (list: TokenAccount[]) => {
  list.sort((a, b) => {
    const aCandidate = a.isCandidate ? 0 : 1;
    const bCandidate = b.isCandidate ? 0 : 1;
    if (aCandidate !== bCandidate) return aCandidate - bCandidate;
    if (a.uiAmount === 0 && b.uiAmount > 0) return -1;
    if (a.uiAmount > 0 && b.uiAmount === 0) return 1;
    return 0;
  });
  return list;
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid data URL')));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });

const getResponseHeader = (headers: Record<string, string> | undefined, name: string) => {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return match?.[1];
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const nativeResponseToDataUrl = async (
  data: unknown,
  contentType = 'image/png',
): Promise<string | null> => {
  if (typeof data === 'string') {
    if (data.startsWith('data:image/')) return data;
    const trimmed = data.trim();
    if (!trimmed) return null;
    return `data:${contentType};base64,${trimmed}`;
  }
  if (data instanceof Blob) {
    if (!data.type.startsWith('image/')) return null;
    return blobToDataUrl(data);
  }
  if (data instanceof ArrayBuffer) {
    return `data:${contentType};base64,${bytesToBase64(new Uint8Array(data))}`;
  }
  if (ArrayBuffer.isView(data)) {
    return `data:${contentType};base64,${bytesToBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))}`;
  }
  if (Array.isArray(data) && data.every((value) => typeof value === 'number')) {
    return `data:${contentType};base64,${bytesToBase64(Uint8Array.from(data))}`;
  }
  return null;
};

const tokenImageDataUrlCache = new Map<string, string>();
const tokenImagePendingCache = new Map<string, Promise<string | null>>();

type CachedBlackHoleImages = {
  timestamp: number;
  images: Record<string, string>;
};

type CachedBlackHoleImageFailures = {
  timestamp: number;
  failures: Record<string, { count: number; lastFailedAt: number }>;
};

const readBlackHoleImageCache = (key = BLACKHOLE_IMAGE_CACHE_KEY): CachedBlackHoleImages => {
  if (typeof window === 'undefined') return { timestamp: 0, images: {} };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}') as CachedBlackHoleImages;
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > BLACKHOLE_IMAGE_CACHE_TTL_MS) {
      window.localStorage.removeItem(key);
      return { timestamp: 0, images: {} };
    }
    const images = parsed.images && typeof parsed.images === 'object' ? parsed.images : {};
    return {
      timestamp: parsed.timestamp,
      images: Object.fromEntries(Object.entries(images).filter(([, value]) => value && value !== BLACKHOLE_IMAGE_FAILED)),
    };
  } catch {
    return { timestamp: 0, images: {} };
  }
};

const readBlackHoleImageFailureCache = (): CachedBlackHoleImageFailures => {
  if (typeof window === 'undefined') return { timestamp: 0, failures: {} };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BLACKHOLE_IMAGE_FAILURE_CACHE_KEY) || '{}') as CachedBlackHoleImageFailures;
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > BLACKHOLE_IMAGE_CACHE_TTL_MS) {
      window.localStorage.removeItem(BLACKHOLE_IMAGE_FAILURE_CACHE_KEY);
      return { timestamp: 0, failures: {} };
    }
    return { timestamp: parsed.timestamp, failures: parsed.failures && typeof parsed.failures === 'object' ? parsed.failures : {} };
  } catch {
    return { timestamp: 0, failures: {} };
  }
};

const writeBlackHoleImageCache = (key: string, images: Record<string, string>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), images } satisfies CachedBlackHoleImages));
};

const readBlackHoleImageCacheEntry = (mint: string) =>
  readBlackHoleImageCache(BLACKHOLE_IMAGE_URL_CACHE_KEY).images[mint] ?? readBlackHoleImageCache(BLACKHOLE_IMAGE_CACHE_KEY).images[mint];

const writeBlackHoleImageCacheEntry = (mint: string, value: string) => {
  if (typeof window === 'undefined' || !mint) return;
  try {
    const currentUrls = readBlackHoleImageCache(BLACKHOLE_IMAGE_URL_CACHE_KEY).images;
    const currentLegacy = readBlackHoleImageCache(BLACKHOLE_IMAGE_CACHE_KEY).images;
    writeBlackHoleImageCache(BLACKHOLE_IMAGE_URL_CACHE_KEY, { ...currentUrls, [mint]: value });
    writeBlackHoleImageCache(BLACKHOLE_IMAGE_CACHE_KEY, { ...currentLegacy, [mint]: value });
    clearBlackHoleImageFailure(mint);
  } catch {
    /* image cache is opportunistic */
  }
};

const isBlackHoleImageFailureCoolingDown = (mint: string) => {
  const entry = readBlackHoleImageFailureCache().failures[mint];
  return Boolean(entry && entry.count >= BLACKHOLE_IMAGE_MAX_ATTEMPTS && Date.now() - entry.lastFailedAt < BLACKHOLE_IMAGE_FAILURE_RETRY_MS);
};

const clearBlackHoleImageFailure = (mint: string) => {
  if (typeof window === 'undefined' || !mint) return;
  try {
    const current = readBlackHoleImageFailureCache().failures;
    if (!current[mint]) return;
    const { [mint]: _removed, ...next } = current;
    window.localStorage.setItem(
      BLACKHOLE_IMAGE_FAILURE_CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), failures: next } satisfies CachedBlackHoleImageFailures),
    );
  } catch {
    /* image cache is opportunistic */
  }
};

const recordBlackHoleImageFailure = (mint: string) => {
  if (typeof window === 'undefined' || !mint) return false;
  try {
    const cache = readBlackHoleImageFailureCache();
    const previous = cache.failures[mint];
    const count = (previous?.count ?? 0) + 1;
    const failures = { ...cache.failures, [mint]: { count, lastFailedAt: Date.now() } };
    window.localStorage.setItem(
      BLACKHOLE_IMAGE_FAILURE_CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), failures } satisfies CachedBlackHoleImageFailures),
    );
    if (count >= BLACKHOLE_IMAGE_MAX_ATTEMPTS) {
      const currentLegacy = readBlackHoleImageCache(BLACKHOLE_IMAGE_CACHE_KEY).images;
      writeBlackHoleImageCache(BLACKHOLE_IMAGE_CACHE_KEY, { ...currentLegacy, [mint]: BLACKHOLE_IMAGE_FAILED });
      return true;
    }
  } catch {
    /* image cache is opportunistic */
  }
  return false;
};

const getMintGradientStyle = (mint: string): React.CSSProperties => {
  let hash = 0;
  for (let i = 0; i < mint.length; i += 1) hash = ((hash << 5) - hash + mint.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 72% 32%), hsl(${(hue + 52) % 360} 78% 18%))`,
  };
};

const appendImageRetryParam = (url: string, attempt: number) => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('retry', String(attempt));
    parsed.searchParams.set('t', String(Date.now()));
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}retry=${attempt}&t=${Date.now()}`;
  }
};

function GenericAssetAvatar({
  mint,
  isNft,
  className,
  title,
}: {
  mint: string;
  isNft?: boolean;
  className: string;
  title: string;
}) {
  return (
    <div
      className={`${className} blackhole-token-avatar--missing`}
      title={title}
      style={getMintGradientStyle(mint)}
      aria-label={title}
    >
      <svg viewBox="0 0 32 32" className="h-[70%] w-[70%]" aria-hidden="true">
        {isNft ? (
          <>
            <rect x="7" y="6" width="18" height="20" rx="3" fill="none" stroke="rgba(255,255,255,.78)" strokeWidth="2" />
            <path d="M11 20l3.5-4 3 3 2-2.3L23 20" fill="none" stroke="rgba(255,255,255,.72)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="20.5" cy="11.5" r="1.8" fill="rgba(255,255,255,.72)" />
          </>
        ) : (
          <>
            <path d="M8.5 11.5h13.8a2.4 2.4 0 0 1 1.7 4.1l-6.2 6.2a2.4 2.4 0 0 1-1.7.7H2.3a2.4 2.4 0 0 1-1.7-4.1l6.2-6.2a2.4 2.4 0 0 1 1.7-.7Z" transform="translate(3 1)" fill="rgba(20,241,149,.82)" />
            <path d="M9.7 6.5h13.8a2.4 2.4 0 0 1 1.7 4.1L19 16.8a2.4 2.4 0 0 1-1.7.7H3.5a2.4 2.4 0 0 1-1.7-4.1L8 7.2a2.4 2.4 0 0 1 1.7-.7Z" transform="translate(2 1)" fill="rgba(153,69,255,.82)" />
            <path d="M8.5 16.5h13.8a2.4 2.4 0 0 1 1.7 4.1l-6.2 6.2a2.4 2.4 0 0 1-1.7.7H2.3a2.4 2.4 0 0 1-1.7-4.1l6.2-6.2a2.4 2.4 0 0 1 1.7-.7Z" transform="translate(3 -1)" fill="rgba(0,194,255,.82)" />
          </>
        )}
      </svg>
    </div>
  );
}

const fetchTokenImageDataUrl = async (url: string, timeoutMs = 5000) => {
  const cached = tokenImageDataUrlCache.get(url);
  if (cached) return cached;
  const pending = tokenImagePendingCache.get(url);
  if (pending) return pending;

  const request = (async () => {
    try {
      let dataUrl: string | null = null;
      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.get({
          url,
          responseType: 'blob',
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
        });
        if (response.status < 200 || response.status >= 300) return null;
        const contentType = getResponseHeader(response.headers, 'content-type') ?? 'image/png';
        if (!contentType.startsWith('image/')) return null;
        dataUrl = await nativeResponseToDataUrl(response.data, contentType);
      } else {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, { signal: controller.signal });
        window.clearTimeout(timeoutId);
        if (!response.ok) return null;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) return null;
        dataUrl = await blobToDataUrl(blob);
      }
      if (!dataUrl) return null;
      tokenImageDataUrlCache.set(url, dataUrl);
      return dataUrl;
    } catch {
      return null;
    } finally {
      tokenImagePendingCache.delete(url);
    }
  })();

  tokenImagePendingCache.set(url, request);
  return request;
};

function TokenAvatar({
  mint,
  imageUrl,
  alt,
  className,
  isNft,
  onFail,
  onLoad,
}: {
  mint: string;
  imageUrl?: string;
  alt: string;
  className: string;
  isNft?: boolean;
  onFail: () => boolean;
  onLoad: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const effectiveImageUrl = imageUrl && attempt > 0 ? appendImageRetryParam(imageUrl, attempt) : imageUrl;
  const [dataUrl, setDataUrl] = useState<string | null>(() => (effectiveImageUrl ? tokenImageDataUrlCache.get(effectiveImageUrl) ?? null : null));
  const [showFallback, setShowFallback] = useState(false);
  const retryTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (retryTimeoutRef.current !== undefined) window.clearTimeout(retryTimeoutRef.current);
    setAttempt(0);
    setShowFallback(false);
    retryTimeoutRef.current = undefined;
  }, [imageUrl]);

  useEffect(
    () => () => {
      if (retryTimeoutRef.current !== undefined) window.clearTimeout(retryTimeoutRef.current);
    },
    [],
  );

  const handleFail = useCallback(() => {
    if (attempt < BLACKHOLE_IMAGE_MAX_ATTEMPTS - 1) {
      setAttempt((value) => value + 1);
      return;
    }
    console.warn('[BlackHole image] failed after retries', { mint, imageUrl });
    setShowFallback(true);
    const coolingDown = onFail();
    if (!coolingDown) {
      retryTimeoutRef.current = window.setTimeout(() => {
        setAttempt(0);
        setShowFallback(false);
      }, 10_000);
    }
  }, [attempt, imageUrl, mint, onFail]);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(effectiveImageUrl ? tokenImageDataUrlCache.get(effectiveImageUrl) ?? null : null);
    if (!effectiveImageUrl) return;
    const cached = tokenImageDataUrlCache.get(effectiveImageUrl);
    if (cached) {
      setDataUrl(cached);
      onLoad();
      return;
    }
    void fetchTokenImageDataUrl(effectiveImageUrl).then((nextUrl) => {
      if (cancelled) return;
      if (nextUrl) {
        setDataUrl(nextUrl);
        console.info('[BlackHole image] loaded', { mint, imageUrl: effectiveImageUrl, attempt: attempt + 1 });
        onLoad();
      } else {
        console.warn('[BlackHole image] attempt failed', { mint, imageUrl: effectiveImageUrl, attempt: attempt + 1 });
        handleFail();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, effectiveImageUrl, handleFail, imageUrl, mint, onLoad]);

  if (!imageUrl) return null;

  if (showFallback) {
    return <GenericAssetAvatar mint={mint} isNft={isNft} className={className} title={alt} />;
  }

  return (
    <div className={className} style={getMintGradientStyle(mint)}>
      {dataUrl ? (
        <img
          key={`${mint}:${effectiveImageUrl}`}
          src={dataUrl}
          alt={alt}
          className="blackhole-token-avatar__image"
          loading="lazy"
          decoding="async"
          onError={handleFail}
        />
      ) : (
        <div className="blackhole-token-avatar__loading" aria-hidden="true">
          <div className="blackhole-token-avatar__spinner" />
        </div>
      )}
    </div>
  );
}

const normalizeBlackHoleImageUrl = (image?: string | null) => {
  if (!image || typeof image !== 'string') return undefined;
  const trimmed = image.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '')}`;
  }
  const heliusCdnMatch = trimmed.match(/^https:\/\/cdn\.helius-rpc\.com\/cdn-cgi\/image\/(?:[^/]+\/)?\/?(https?:\/\/.+)$/i);
  if (heliusCdnMatch?.[1]) {
    return heliusCdnMatch[1];
  }
  return trimmed;
};

const getBlackHoleImageUrl = (image?: string | null, mint?: string | null) => {
  const normalized = normalizeBlackHoleImageUrl(image);
  const base = getApiBase();
  if (!normalized) {
    return base && mint ? `${base}/api/blackhole/image?size=96&v=pngmatte4&mint=${encodeURIComponent(mint)}` : undefined;
  }
  if (!base) return normalized;
  return `${base}/api/blackhole/image?size=96&v=pngmatte4&url=${encodeURIComponent(normalized)}`;
};

const getRawBlackHoleImageUrl = (image?: string | null) => {
  const normalized = normalizeBlackHoleImageUrl(image);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    if (url.pathname === '/api/blackhole/image') {
      return url.searchParams.get('url') ?? normalized;
    }
  } catch {
    return normalized;
  }
  return normalized;
};

const fetchFallbackPrices = async (mints: string[]): Promise<Map<string, number>> => {
  const prices = new Map<string, number>();
  if (mints.length === 0) return prices;

  // 1) Jupiter proxy — batched through our backend to avoid CORS/native transport quirks.
  try {
    const base = getApiBase();
    const JUPITER_BATCH = 100;
    const batches: string[][] = [];
    for (let i = 0; i < mints.length; i += JUPITER_BATCH) {
      batches.push(mints.slice(i, i + JUPITER_BATCH));
    }
    const results = await Promise.allSettled(
      batches.map((batch) =>
        fetchJsonWithTimeout<Record<string, any>>(
          `${base}/api/market/jupiter-prices?ids=${encodeURIComponent(batch.join(','))}`,
          { timeoutMs: BLACKHOLE_AUX_TIMEOUT_MS },
        ),
      ),
    );
    results.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const data = result.value?.data && typeof result.value.data === 'object' ? result.value.data : {};
      Object.entries(data).forEach(([mint, entry]) => {
        const price = parseNumber((entry as Record<string, unknown>)?.price);
        if (price && price > 0) prices.set(mint, price);
      });
    });
  } catch {
    /* empty */
  }

  // 2) DexScreener — free, no auth, max ~30 addresses per request
  try {
    const remainingForDex = mints.filter((m) => !prices.has(m));
    const batches: string[][] = [];
    for (let i = 0; i < remainingForDex.length; i += 30) {
      batches.push(remainingForDex.slice(i, i + 30));
    }
    const results = await Promise.allSettled(
      batches.map((batch) => {
        const url = `https://api.dexscreener.com/tokens/v1/solana/${batch.join(',')}`;
        return fetchJsonWithTimeout<any[]>(url, { timeoutMs: BLACKHOLE_AUX_TIMEOUT_MS });
      }),
    );
    results.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const data = result.value;
      if (Array.isArray(data)) {
        for (const pair of data) {
          const mint = pair.baseToken?.address;
          const p = parseFloat(pair.priceUsd);
          if (mint && !isNaN(p) && p > 0 && !prices.has(mint)) {
            prices.set(mint, p);
          }
        }
      }
    });
  } catch {
    /* empty */
  }

  // 3) Raydium fallback for anything DexScreener missed
  const remaining = mints.filter((m) => !prices.has(m));
  if (remaining.length > 0) {
    try {
      const RAYDIUM_BATCH = 100;
      for (let i = 0; i < remaining.length; i += RAYDIUM_BATCH) {
        const batch = remaining.slice(i, i + RAYDIUM_BATCH);
        const url = `https://api-v3.raydium.io/mint/price?mints=${batch.join(',')}`;
        const json = await fetchJsonWithTimeout<Record<string, any>>(url, {
          timeoutMs: BLACKHOLE_AUX_TIMEOUT_MS,
        });
        const data = json?.data;
        if (data && typeof data === 'object') {
          for (const [mint, priceStr] of Object.entries(data) as [string, unknown][]) {
            const p = parseFloat(String(priceStr));
            if (!isNaN(p) && p > 0) prices.set(mint, p);
          }
        }
      }
    } catch {
      /* empty */
    }
  }

  return prices;
};

const fetchSwapQuote = async (
  inputMint: string,
  rawAmount: bigint,
  taker?: string,
): Promise<SwapQuoteResult | null> => {
  if (rawAmount <= 0n) return null;
  const base = getApiBase();
  const url = new URL(`${base}/api/market/swap-quote`);
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('amount', rawAmount.toString());
  if (taker) url.searchParams.set('taker', taker);
  try {
    const data = await fetchJsonWithTimeout<Record<string, unknown>>(url.toString(), {
      timeoutMs: BLACKHOLE_AUX_TIMEOUT_MS,
    });
    const outLamports = Number(data?.outAmount ?? 0);
    if (!Number.isFinite(outLamports) || outLamports <= 0) return null;
    return {
      outLamports,
      outSol: outLamports / LAMPORTS_PER_SOL,
      priceImpactPct: Number(data?.priceImpactPct ?? 0),
      quoteResponse: data?.quoteResponse as SwapQuoteResponse,
      transport: data?.transport === 'order_execute' ? 'order_execute' : 'legacy_raw',
    };
  } catch {
    return null;
  }
};

const buildSwapTransaction = async (userPublicKey: string, quoteResponse: SwapQuoteResponse) => {
  const jwt = await ensureJwt();
  if (!jwt) throw new Error('Wallet authorization required');
  const base = getApiBase();
  // Server expects canonical inputs (inputMint/outputMint/amount/slippageBps) per market.js:277-311.
  // Extract from quoteResponse — supports both synthetic order_execute ({mode,inputMint,outputMint,amount})
  // and full Jupiter legacy_raw response ({inputMint,outputMint,inAmount,...}).
  const amountStr = String(quoteResponse?.amount ?? quoteResponse?.inAmount ?? '');
  return fetchJsonWithTimeout<PreparedSwapTransaction>(`${base}/api/market/build-swap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    data: {
      userPublicKey,
      inputMint: quoteResponse?.inputMint,
      outputMint: quoteResponse?.outputMint,
      amount: amountStr,
      slippageBps: 100,
    },
    timeoutMs: BLACKHOLE_RPC_TIMEOUT_MS,
  });
};

const executeSwapTransaction = async (signedTransaction: string, requestId: string) => {
  const jwt = await ensureJwt();
  if (!jwt) throw new Error('Wallet authorization required');
  const base = getApiBase();
  const payload = await fetchJsonWithTimeout<{ signature?: string; status?: string }>(`${base}/api/market/execute-swap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    data: { signedTransaction, requestId },
    timeoutMs: BLACKHOLE_RPC_TIMEOUT_MS,
  });
  if (!payload?.signature) throw new Error('Failed to execute swap transaction');
  return payload as { signature: string; status?: string };
};

const claimBlackHoleReward = async (operations: ResolutionOperation[]) => {
  if (operations.length === 0) return { earned: 0 };
  const jwt = await ensureJwt();
  if (!jwt) return { earned: 0 };
  const base = getApiBase();
  // FIX (2026-05-17): Removed AbortController (MWA-background-resume abort bug).
  const response = await fetch(`${base}/api/blackhole/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ operations }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Failed to claim Black Hole reward');
  }
  return payload as { earned: number; netResolvedSol: number; fungibleResolved: number; nftResolved: number };
};

const decodeVersionedTransaction = (base64: string) => {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return VersionedTransaction.deserialize(bytes);
};

const encodeVersionedTransaction = (tx: VersionedTransaction) => {
  const bytes = tx.serialize();
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const _RENT_RECLAIM_SOL = 0.002;
const VALUE_THRESHOLD_SOL = 0.0015;
const COMMISSION_RATE_DEFAULT = 0.1;
const COMMISSION_RATE_MINTED = 0.02;
const ESTIMATED_FEE_SOL = 0.00015; // conservative estimate for base + priority fee
const ESTIMATED_SWAP_FEE_SOL = 0.00025;
const MIN_NET_RETURN_SOL = 0.0005; // minimum net return to show as burnable
const BLACKHOLE_PRISM_REWARD_CAP = 500;
const SWAP_ADVANTAGE_BUFFER_SOL = 0.00005;
const TREASURY_ADDRESS = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const BH_BURN_MEMO = 'IP_BLACKHOLE_RESOLVE_V2';
const BH_CLOSE_MEMO = 'IP_BLACKHOLE_CLOSE_V2';

const buildMemoInstruction = (memo: string) =>
  new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: new TextEncoder().encode(memo),
  });

const estimateBlackHoleReward = (fungibleResolved: number, nftResolved: number, netResolvedSol: number) => {
  return Math.min(
    BLACKHOLE_PRISM_REWARD_CAP,
    fungibleResolved * 8 + nftResolved * 15 + Math.max(0, Math.floor(netResolvedSol / 0.001)) * 8,
  );
};

const areResolutionPlansEqual = (
  current: Record<string, ResolutionPlanItem>,
  next: Record<string, ResolutionPlanItem>,
) => {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (currentKeys.length !== nextKeys.length) return false;

  return nextKeys.every((key) => {
    const currentPlan = current[key];
    const nextPlan = next[key];
    if (!currentPlan || !nextPlan) return false;
    return (
      currentPlan.token.pubkey.toBase58() === nextPlan.token.pubkey.toBase58() &&
      currentPlan.token.mint === nextPlan.token.mint &&
      currentPlan.token.amount === nextPlan.token.amount &&
      currentPlan.token.rentSol === nextPlan.token.rentSol &&
      currentPlan.action === nextPlan.action &&
      currentPlan.reason === nextPlan.reason &&
      currentPlan.estimatedNetSol === nextPlan.estimatedNetSol &&
      currentPlan.estimatedBurnNetSol === nextPlan.estimatedBurnNetSol &&
      currentPlan.estimatedSwapNetSol === nextPlan.estimatedSwapNetSol &&
      currentPlan.swapQuote?.outLamports === nextPlan.swapQuote?.outLamports &&
      currentPlan.swapQuote?.transport === nextPlan.swapQuote?.transport
    );
  });
};

const isWalletRejectError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /reject|cancel|denied|abort|dismiss|decline|user.?reject|4001|USER_REJECTED/i.test(message);
};

const PROTECTED_MINTS = new Set<string>([SEEKER_TOKEN.MINT, TOKEN_ADDRESSES.CHAPTER2_PREORDER]);

const PROTECTED_COLLECTIONS = new Set<string>([
  TOKEN_ADDRESSES.SEEKER_GENESIS_COLLECTION,
  TOKEN_ADDRESSES.CHAPTER2_PREORDER,
  '4JAq5D5qYMU5RtRuQj4eotQErWvTMKrMYGK87vtbJqJD', // Identity Prism
  ...BLUE_CHIP_COLLECTIONS,
]);

const PROTECTED_SYMBOLS = new Set<string>(['SKR', 'SeekerGT', 'SAGA']);

const PROTECTED_NAME_PATTERNS = [
  /seeker\s*genesis/i,
  /saga\s*(genesis|token)/i,
  /chapter\s*2/i,
  /solana\s*mobile/i,
  /identity\s*prism/i,
];

const hasRecognizedCollection = (token: TokenAccount) =>
  Boolean(token.collectionId || token.collectionName || token.collectionSymbol);

const classifyAsset = (token: TokenAccount): { status: AssetStatus; reason?: string } => {
  if (token.closeable === false) {
    return { status: 'protected', reason: token.frozen ? 'Account is frozen' : 'Account cannot be closed' };
  }
  if (PROTECTED_MINTS.has(token.mint)) {
    return { status: 'protected', reason: 'Core ecosystem token' };
  }
  if (token.collectionId && PROTECTED_COLLECTIONS.has(token.collectionId)) {
    return { status: 'protected', reason: 'Valuable collection NFT' };
  }
  if (token.symbol && PROTECTED_SYMBOLS.has(token.symbol)) {
    return { status: 'protected', reason: 'Ecosystem token' };
  }
  if (token.name && PROTECTED_NAME_PATTERNS.some((p) => p.test(token.name!))) {
    return { status: 'protected', reason: 'Ecosystem asset' };
  }
  if (token.isNft && token.marketFloorSol !== null && token.marketFloorSol !== undefined && token.marketFloorSol >= 0.05) {
    return { status: 'protected', reason: `Floor ~${token.marketFloorSol.toFixed(2)} SOL` };
  }
  if (token.isNft && (token.marketStatus === 'listed' || (token.listedCount !== null && token.listedCount !== undefined && token.listedCount > 0))) {
    return { status: 'protected', reason: 'Listed on marketplace' };
  }
  if (token.valueSol !== null && token.valueSol !== undefined && token.valueSol > VALUE_THRESHOLD_SOL) {
    return { status: 'valuable', reason: `Worth ~${token.valueSol.toFixed(4)} SOL` };
  }
  if (token.isNft && hasRecognizedCollection(token)) {
    return { status: 'valuable', reason: 'Collection NFT needs review' };
  }
  return { status: 'burnable' };
};

const applyPrefetchClassification = (cache: BlackHolePrefetchCache): TokenAccount[] => {
  const solUsd = parseNumber(cache.solUsd);
  const commissionRate =
    parseNumber(cache.identityPerks?.blackHoleCommissionRate) ??
    (cache.identityPerks?.hasIdentityPrism ? COMMISSION_RATE_MINTED : COMMISSION_RATE_DEFAULT);
  const persistentMetadata = readBlackHoleMetadataCache();

  return cache.tokenAccounts
    .map((item): TokenAccount | null => {
      try {
        const info = item.data?.info;
        if (!info?.mint) return null;
        const programId = item.programId === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const isFrozen = info.state === 'frozen';
        const exts: unknown[] = info.extensions ?? [];
        let hasWithheldFees = false;
        try {
          hasWithheldFees = exts.some((e: unknown) => {
            const ext = e as Record<string, unknown>;
            return (
              ext.extension === 'transferFeeAmount' &&
              (ext.state as Record<string, unknown>)?.withheldAmount &&
              BigInt(String((ext.state as Record<string, unknown>).withheldAmount)) > 0n
            );
          });
        } catch {
          /* best effort */
        }
        const canClose = !isFrozen && !hasWithheldFees;
        const meta = cache.metadata?.[info.mint] ?? persistentMetadata[info.mint];
        const amount = BigInt(info.tokenAmount?.amount ?? '0');
        const uiAmount = Number(info.tokenAmount?.uiAmount ?? 0);
        const token: TokenAccount = {
          pubkey: new PublicKey(item.pubkey),
          programId,
          mint: info.mint,
          amount,
          decimals: info.tokenAmount?.decimals ?? 0,
          uiAmount,
          lamports: item.lamports,
          rentSol: item.lamports / LAMPORTS_PER_SOL,
          frozen: isFrozen,
          closeable: canClose,
          name: meta?.name,
          symbol: meta?.symbol,
          image: getBlackHoleImageUrl(meta?.image ?? meta?.imageUrl, info.mint),
          isNft: meta?.isNft ?? (info.tokenAmount?.decimals === 0 && uiAmount <= 1),
          collectionId: meta?.collectionId,
          collectionName: meta?.collectionName,
          collectionSymbol: meta?.collectionSymbol,
          priceUsd: meta?.priceUsd ?? null,
          marketFloorSol: meta?.marketFloorSol ?? meta?.floorSol ?? null,
          marketStatus: meta?.marketStatus ?? undefined,
          marketSource: meta?.marketSource ?? null,
          listedCount: meta?.listedCount ?? null,
          tensorUrl: meta?.tensorUrl ?? null,
          meUrl: meta?.meUrl ?? null,
          metadataImageMissing: !(meta?.image ?? meta?.imageUrl),
          metadataPending: !meta?.name && !meta?.symbol,
        };

        if (token.isNft && token.marketFloorSol !== null && token.marketFloorSol !== undefined && token.marketFloorSol > 0) {
          token.valueSol = token.marketFloorSol;
          if (solUsd) token.valueUsd = token.marketFloorSol * solUsd;
        } else if (!token.isNft && token.priceUsd != null) {
          token.valueUsd = token.priceUsd * token.uiAmount;
          if (solUsd) token.valueSol = token.valueUsd / solUsd;
        } else if (token.isNft && token.priceUsd != null && solUsd) {
          token.valueUsd = token.priceUsd;
          token.valueSol = token.priceUsd / solUsd;
        }

        const rentAfterFees = token.rentSol * (1 - commissionRate) - ESTIMATED_FEE_SOL;
        token.netGainSol =
          token.valueSol !== null && token.valueSol !== undefined ? rentAfterFees - token.valueSol : rentAfterFees;

        const classification = classifyAsset(token);
        token.assetStatus = classification.status;
        token.protectReason = classification.reason;

        if (classification.status !== 'burnable') {
          token.isCandidate = false;
        } else if (token.closeable === false) {
          token.isCandidate = false;
        } else if (token.uiAmount === 0) {
          token.isCandidate = rentAfterFees >= MIN_NET_RETURN_SOL;
        } else if (token.isNft) {
          const hasCollection = Boolean(token.collectionId || token.collectionSymbol);
          const valueKnown = token.valueSol !== null && token.valueSol !== undefined;
          const valueLow = valueKnown ? token.valueSol! <= VALUE_THRESHOLD_SOL : false;
          const netGainPositive = token.netGainSol !== null && token.netGainSol !== undefined && token.netGainSol >= 0;
          token.isCandidate = (!hasCollection && (netGainPositive || !valueKnown)) || valueLow;
        } else if (token.valueSol !== null && token.valueSol !== undefined) {
          token.isCandidate = token.netGainSol != null && (token.netGainSol >= 0 || token.valueSol <= VALUE_THRESHOLD_SOL);
        } else {
          token.isCandidate = token.uiAmount > 0 && token.uiAmount < 0.0001;
        }

        return token;
      } catch {
        return null;
      }
    })
    .filter((token): token is TokenAccount => Boolean(token));
};

const getDisplayedScanCount = (list: TokenAccount[], filter: 'all' | 'nft' | 'token') => {
  let closeable = [...list];
  if (filter === 'nft') closeable = closeable.filter((token) => token.isNft);
  else if (filter === 'token') closeable = closeable.filter((token) => !token.isNft);
  return closeable.length;
};

const BlackHole = () => {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, signTransaction, sendTransaction, wallets, select, connect, connecting } = wallet;
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [pendingNativeConnect, setPendingNativeConnect] = useState(false);
  useEffect(() => {
    setAuthWallet(wallet);
  }, [wallet]);

  const handleConnectWallet = useCallback(async () => {
    if (connecting || pendingNativeConnect) return;
    const mobileWallet = wallets.find((entry) => entry.adapter.name === SolanaMobileWalletAdapterWalletName);
    if (Capacitor.isNativePlatform() && mobileWallet) {
      setPendingNativeConnect(true);
      select(SolanaMobileWalletAdapterWalletName as WalletName);
      return;
    }
    setWalletModalVisible(true);
  }, [connecting, pendingNativeConnect, select, setWalletModalVisible, wallets]);

  useEffect(() => {
    if (!pendingNativeConnect || connecting || publicKey) return;
    if (wallet.wallet?.adapter.name !== SolanaMobileWalletAdapterWalletName) return;

    setPendingNativeConnect(false);
    connect().catch((error) => {
      console.error('[BlackHole] wallet connect failed', error);
      toast.error('Wallet connection failed. Try again.');
    });
  }, [connect, connecting, pendingNativeConnect, publicKey, wallet.wallet]);

  // Fade out wormhole tunnel (from Card→BH transition) + remove preloader
  useEffect(() => {
    fadeOutTransition(50);
    // Also handle legacy forward-blackout overlay
    const fwdOverlay = document.getElementById('bh-forward-blackout');
    if (fwdOverlay) {
      setTimeout(() => {
        fwdOverlay.style.transition = 'opacity 0.5s ease-out';
        fwdOverlay.style.opacity = '0';
        setTimeout(() => fwdOverlay.remove(), 600);
      }, 200);
    }
    // HTML preloader (BlackHole is outside App, so needs its own removal)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const preloader = document.getElementById('app-preloader');
        if (preloader) {
          preloader.style.opacity = '0';
          setTimeout(() => preloader.remove(), 400);
        }
      });
    });
  }, []);
  const [tokens, setTokens] = useState<TokenAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [isBurning, setIsBurning] = useState(false);
  const [hasMintedCard, setHasMintedCard] = useState(false);
  const [commissionRate, setCommissionRate] = useState(COMMISSION_RATE_DEFAULT);
  const [holderCommissionRate, setHolderCommissionRate] = useState(COMMISSION_RATE_MINTED);
  const [standardCommissionRate, setStandardCommissionRate] = useState(COMMISSION_RATE_DEFAULT);
  const [incinerationTokens, setIncinerationTokens] = useState<IncinerationToken[]>([]);
  const [_wormholeBack, _setWormholeBack] = useState(false);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [scanStep, setScanStep] = useState('Preparing scan');
  const [failedImageMints, setFailedImageMints] = useState<Set<string>>(new Set());
  const tokensRef = useRef<TokenAccount[]>([]);
  const collectionMarketCache = useRef(new Map<string, MarketStats>());
  const lastOwnerRef = useRef<string | null>(null);
  const scanRequestIdRef = useRef(0);
  const addressErrorShown = useRef(false);
  const publicKeyRef = useRef(publicKey);
  publicKeyRef.current = publicKey;
  tokensRef.current = tokens;
  const addressParam = searchParams.get('address');
  const [ownerPublicKey, setOwnerPublicKey] = useState<PublicKey | null>(() => {
    if (publicKey) return publicKey;
    const initialAddress = looksLikeSolanaAddress(addressParam) ? addressParam : readStoredBlackHoleAddress();
    if (initialAddress) {
      try {
        return new PublicKey(initialAddress);
      } catch {
        return null;
      }
    }
    return null;
  });
  const scannedAddress = ownerPublicKey?.toBase58() ?? null;
  const connectedAddress = publicKey?.toBase58() ?? null;
  const connectedMatchesScan = Boolean(scannedAddress && connectedAddress && scannedAddress === connectedAddress);
  const isReadOnlyScan = Boolean(scannedAddress && !connectedMatchesScan);
  const canResolveScan = Boolean(scannedAddress && connectedMatchesScan);
  const [sortField, setSortField] = useState<'value' | 'return' | 'status' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [assetFilter, setAssetFilter] = useState<'all' | 'nft' | 'token'>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<(typeof PER_PAGE_OPTIONS)[number]>(25);
  const [perPageMenuOpen, setPerPageMenuOpen] = useState(false);
  const swapQuoteCache = useRef(new Map<string, SwapQuoteResult | null>());
  const [resolutionPlan, setResolutionPlan] = useState<Record<string, ResolutionPlanItem>>({});
  const [isPlanning, setIsPlanning] = useState(false);

  const isResolvableSelectionTarget = useCallback((token: TokenAccount) => {
    if (token.closeable === false || token.assetStatus === 'protected') return false;
    if (token.isNft && token.assetStatus === 'valuable') return false;
    return true;
  }, []);

  const isSelectableToken = useCallback((token: TokenAccount) => {
    if (!canResolveScan) return false;
    return isResolvableSelectionTarget(token);
  }, [canResolveScan, isResolvableSelectionTarget]);

  const estimateCloseNetSol = useCallback(
    (token: TokenAccount, txFeeSol: number = ESTIMATED_FEE_SOL) =>
      Math.max(0, token.rentSol * (1 - commissionRate) - txFeeSol),
    [commissionRate],
  );

  const getSwapQuoteCached = useCallback(
    async (token: TokenAccount) => {
      if (token.isNft || token.amount <= 0n) return null;
      const cacheKey = `${token.mint}:${token.amount.toString()}`;
      if (swapQuoteCache.current.has(cacheKey)) {
        return swapQuoteCache.current.get(cacheKey) ?? null;
      }
      const quote = await fetchSwapQuote(token.mint, token.amount, publicKey?.toBase58() ?? ownerPublicKey?.toBase58());
      swapQuoteCache.current.set(cacheKey, quote);
      return quote;
    },
    [ownerPublicKey, publicKey],
  );

  useEffect(() => {
    if (addressParam) {
      addressErrorShown.current = false;
    }
  }, [addressParam]);

  useEffect(() => {
    if (publicKey) {
      setOwnerPublicKey(publicKey);
      return;
    }
    const storedAddress = readStoredBlackHoleAddress();
    const fallbackAddress = looksLikeSolanaAddress(addressParam) ? addressParam : storedAddress;
    if (fallbackAddress) {
      try {
        setOwnerPublicKey(new PublicKey(fallbackAddress));
      } catch {
        setOwnerPublicKey(null);
        if (!addressErrorShown.current) {
          addressErrorShown.current = true;
          toast.error('Invalid address in link');
        }
      }
      return;
    }
    setOwnerPublicKey(null);
  }, [publicKey, addressParam]);

  useEffect(() => {
    swapQuoteCache.current.clear();
    setResolutionPlan({});
  }, [ownerPublicKey?.toBase58(), publicKey?.toBase58()]);

  useEffect(() => {
    if (!canResolveScan && selectedTokens.size > 0) {
      setSelectedTokens(new Set());
    }
  }, [canResolveScan, selectedTokens.size]);

  useEffect(() => {
    if (incinerationTokens.length === 0) return;
    const timeout = window.setTimeout(() => {
      setIncinerationTokens([]);
    }, 3600);
    return () => window.clearTimeout(timeout);
  }, [incinerationTokens.length]);

  const getVisibleTokens = useCallback(
    (list: TokenAccount[] = tokens) => {
      let closeable = [...list];
      if (assetFilter === 'nft') closeable = closeable.filter((token) => token.isNft);
      else if (assetFilter === 'token') closeable = closeable.filter((token) => !token.isNft);
      return closeable;
    },
    [tokens, assetFilter],
  );

  // Total recoverable SOL from all burnable tokens (shown at top before selection)
  const totalRecoverableSol = useMemo(() => {
    return tokens
      .filter((t) => t.closeable !== false && t.assetStatus === 'burnable')
      .reduce((sum, t) => sum + (t.rentSol || 0), 0);
  }, [tokens]);

  const fetchTokens = useCallback(async (owner?: PublicKey | null) => {
    const targetOwner = owner ?? publicKeyRef.current;
    if (!targetOwner) return;

    const requestId = scanRequestIdRef.current + 1;
    scanRequestIdRef.current = requestId;
    const isStaleRequest = () => requestId !== scanRequestIdRef.current;
    setSelectedTokens(new Set());
    setFailedImageMints(new Set());
    tokenImagePendingCache.clear();
    setFetchError(null);

    let fetchStep = 'init';
    let renderedUsefulCache = false;
    const updateScanStep = (step: string, label: string) => {
      fetchStep = step;
      setScanStep(label);
    };
    try {
      updateScanStep('getParsedTokenAccounts', 'Reading token accounts');
      const prefetched = readBlackHolePrefetch(targetOwner.toBase58());
      if (prefetched?.tokenAccounts.length) {
        const cachedTokens = applyPrefetchClassification(prefetched);
        if (cachedTokens.length && !isStaleRequest()) {
          const cachedPerks = prefetched.identityPerks;
          const ownsCard = Boolean(cachedPerks?.hasIdentityPrism);
          const cachedCommissionRate =
            parseNumber(cachedPerks?.blackHoleCommissionRate) ??
            (ownsCard ? COMMISSION_RATE_MINTED : COMMISSION_RATE_DEFAULT);
          setHasMintedCard(ownsCard);
          setCommissionRate(cachedCommissionRate);
          setHolderCommissionRate(parseNumber(cachedPerks?.holderBlackHoleCommissionRate) ?? COMMISSION_RATE_MINTED);
          setStandardCommissionRate(parseNumber(cachedPerks?.standardBlackHoleCommissionRate) ?? COMMISSION_RATE_DEFAULT);
          if (prefetched.solUsd != null) setSolPriceUsd(prefetched.solUsd);
          setTokens(sortTokensForDisplay(cachedTokens));
          setFetchError(null);
          renderedUsefulCache = cachedTokens.length > 0;
          console.warn(
            `[BH scan] cache received ${cachedTokens.length} tokens, displayed ${getDisplayedScanCount(
              cachedTokens,
              assetFilter,
            )}`,
          );
          updateScanStep('getParsedTokenAccounts', 'Refreshing cached scan');
        }
      }
      setIsLoading(!renderedUsefulCache);
      const [splTokensResult, token2022TokensResult] = await Promise.allSettled([
        fetchParsedTokenAccounts(targetOwner, TOKEN_PROGRAM_ID),
        fetchParsedTokenAccounts(targetOwner, TOKEN_2022_PROGRAM_ID),
      ]);
      if (splTokensResult.status === 'rejected') {
        throw new Error(
          `SPL scan failed; refusing partial Token-2022-only result: ${
            splTokensResult.reason instanceof Error ? splTokensResult.reason.message : String(splTokensResult.reason)
          }`,
        );
      }
      const splTokens = splTokensResult.value;
      const token2022Tokens = token2022TokensResult.status === 'fulfilled' ? token2022TokensResult.value : [];
      if (token2022TokensResult.status === 'rejected') {
        console.warn('[BH scan] Token-2022 scan failed; continuing with SPL result', token2022TokensResult.reason);
      }
      console.warn(
        `[BH scan] combined received ${splTokens.length + token2022Tokens.length} token accounts ` +
          `(SPL ${splTokens.length}, Token-2022 ${token2022Tokens.length})`,
      );

      const parsedTokens: TokenAccount[] = [
        ...splTokens.map((item) => {
          const info = item.account.data.parsed.info;
          const isFrozen = info.state === 'frozen';
          return {
            pubkey: new PublicKey(item.pubkey),
            programId: TOKEN_PROGRAM_ID,
            mint: info.mint,
            amount: BigInt(info.tokenAmount?.amount ?? '0'),
            decimals: info.tokenAmount?.decimals ?? 0,
            uiAmount: Number(info.tokenAmount?.uiAmount ?? 0),
            lamports: item.account.lamports,
            rentSol: item.account.lamports / LAMPORTS_PER_SOL,
            frozen: isFrozen,
            closeable: !isFrozen,
          };
        }),
        ...token2022Tokens.map((item) => {
          const info = item.account.data.parsed.info;
          const isFrozen = info.state === 'frozen';
          // Check Token-2022 extensions that prevent closing
          const exts: unknown[] = info.extensions ?? [];
          let hasWithheldFees = false;
          try {
            hasWithheldFees = exts.some((e: unknown) => {
              const ext = e as Record<string, unknown>;
              return (
                ext.extension === 'transferFeeAmount' &&
                (ext.state as Record<string, unknown>)?.withheldAmount &&
                BigInt(String((ext.state as Record<string, unknown>).withheldAmount)) > 0n
              );
            });
          } catch {
            /* empty */
          }
          let hasConfidentialPending = false;
          try {
            hasConfidentialPending = exts.some((e: unknown) => {
              const ext = e as Record<string, unknown>;
              const state = ext.state as Record<string, unknown> | undefined;
              return (
                ext.extension === 'confidentialTransferAccount' &&
                ((state?.pending_balance_lo as number) > 0 || (state?.pending_balance_hi as number) > 0)
              );
            });
          } catch {
            /* empty */
          }
          const canClose = !isFrozen && !hasWithheldFees && !hasConfidentialPending;
          return {
            pubkey: new PublicKey(item.pubkey),
            programId: TOKEN_2022_PROGRAM_ID,
            mint: info.mint,
            amount: BigInt(info.tokenAmount?.amount ?? '0'),
            decimals: info.tokenAmount?.decimals ?? 0,
            uiAmount: Number(info.tokenAmount?.uiAmount ?? 0),
            lamports: item.account.lamports,
            rentSol: item.account.lamports / LAMPORTS_PER_SOL,
            frozen: isFrozen,
            closeable: canClose,
          };
        }),
      ];

      parsedTokens.forEach((token) => {
        const defaultNetGainSol = token.rentSol * (1 - COMMISSION_RATE_DEFAULT) - ESTIMATED_FEE_SOL;
        token.netGainSol = token.uiAmount === 0 ? defaultNetGainSol : null;
        if (token.closeable === false) {
          token.assetStatus = 'protected';
          token.isCandidate = false;
          token.protectReason = token.frozen ? 'Frozen account cannot be closed' : 'Account cannot be closed';
          return;
        }
        if (token.uiAmount === 0 && defaultNetGainSol >= MIN_NET_RETURN_SOL) {
          token.assetStatus = 'burnable';
          token.isCandidate = true;
          return;
        }
        token.isCandidate = false;
      });

      if (isStaleRequest()) return;
      if (!renderedUsefulCache) {
        setTokens(sortTokensForDisplay([...parsedTokens]));
        setFetchError(null);
      }
      console.warn(
        `[BH scan] received ${parsedTokens.length} tokens, displayed ${getDisplayedScanCount(
          parsedTokens,
          assetFilter,
        )} before metadata`,
      );

      updateScanStep('fetchSolPrice', 'Pricing SOL');
      const proxyBase = getHeliusProxyUrl();
      const solUsd = await fetchSolPriceUsd(proxyBase);
      setSolPriceUsd(solUsd);

      updateScanStep('getAssetBatch', 'Classifying assets');
      const heliusUrl = getHeliusRpcUrl(targetOwner.toBase58());
      let resolvedCommissionRate = COMMISSION_RATE_DEFAULT;
      let prefetchIdentityPerks: IdentityPerkSnapshot | null = null;
      if (heliusUrl && parsedTokens.length > 0) {
        const mints = [...new Set(parsedTokens.map((t) => t.mint))];
        const metadataMap = new Map<
          string,
          {
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
          }
        >();

        try {
          const metadataResponse = await fetchBlackHoleMetadata(targetOwner.toBase58(), mints);
          Object.entries(metadataResponse.assets ?? {}).forEach(([mint, metadata]) => {
            metadataMap.set(mint, metadata);
            if (typeof metadata?.mint === 'string') {
              metadataMap.set(metadata.mint, metadata);
            }
          });
          const missingImages = mints.filter((mint) => {
            const metadata = metadataMap.get(mint);
            return !(metadata?.image ?? metadata?.imageUrl);
          });
          missingImages.forEach((mint) => {
            const metadata = metadataMap.get(mint);
            if (metadata) metadataMap.set(mint, { ...metadata, image: undefined, imageUrl: undefined });
          });
        } catch (metadataError) {
          console.warn('[BlackHole] metadata fetch failed', metadataError);
          throw metadataError instanceof Error ? metadataError : new Error('Metadata fetch failed');
        }

        parsedTokens.forEach((t) => {
          const meta = metadataMap.get(t.mint);
          if (!meta) return;
          t.name = meta.name;
          t.symbol = meta.symbol;
          t.image = meta.image ?? meta.imageUrl ?? undefined;
          t.isNft = meta.isNft;
          t.collectionId = meta.collectionId;
          t.collectionName = meta.collectionName;
          t.collectionSymbol = meta.collectionSymbol;
          t.priceUsd = meta.priceUsd ?? null;
          t.marketFloorSol = meta.marketFloorSol ?? meta.floorSol ?? null;
          t.marketStatus = meta.marketStatus ?? undefined;
          t.marketSource = meta.marketSource ?? null;
          t.listedCount = meta.listedCount ?? null;
          t.tensorUrl = meta.tensorUrl ?? null;
          t.meUrl = meta.meUrl ?? null;
          t.image = getBlackHoleImageUrl(meta.image ?? meta.imageUrl, t.mint);
          t.metadataImageMissing = !t.image;
          t.metadataPending = false;
        });

        const unknownTokens = parsedTokens.filter((token) => !token.name && !token.symbol);
        if (unknownTokens.length > 0) {
          const resolved = await Promise.allSettled(
            [...new Set(unknownTokens.map((token) => token.mint))].map((mint) => resolveUnknownToken(mint)),
          );
          const resolvedMap = new Map<string, Awaited<ReturnType<typeof resolveUnknownToken>>>();
          resolved.forEach((result) => {
            if (result.status === 'fulfilled') resolvedMap.set(result.value.mint, result.value);
          });
          parsedTokens.forEach((token) => {
            if (token.name || token.symbol) return;
            const meta = resolvedMap.get(token.mint);
            token.name = meta?.name ?? `Token ${token.mint.slice(0, 4)}...`;
            token.symbol = meta?.symbol;
            token.image = getBlackHoleImageUrl(meta?.image ?? meta?.imageUrl, token.mint);
            token.metadataImageMissing = !token.image;
            token.metadataPending = !meta || meta.source === 'fallback';
          });
        }

        // Resolve holder perks from the backend first so fee UX matches server verification.
        let ownsCard = false;
        resolvedCommissionRate = COMMISSION_RATE_DEFAULT;
        let resolvedHolderCommissionRate = COMMISSION_RATE_MINTED;
        let resolvedStandardCommissionRate = COMMISSION_RATE_DEFAULT;
        let perksFetched = false;

        try {
          const perks = await fetchIdentityPerksWithTimeout(targetOwner.toBase58());
          prefetchIdentityPerks = perks;
          perksFetched = true;
          ownsCard = Boolean(perks?.hasIdentityPrism);
          resolvedCommissionRate =
            parseNumber(perks?.blackHoleCommissionRate) ??
            (ownsCard ? COMMISSION_RATE_MINTED : COMMISSION_RATE_DEFAULT);
          resolvedHolderCommissionRate = parseNumber(perks?.holderBlackHoleCommissionRate) ?? COMMISSION_RATE_MINTED;
          resolvedStandardCommissionRate =
            parseNumber(perks?.standardBlackHoleCommissionRate) ?? COMMISSION_RATE_DEFAULT;
        } catch {
          // Fall back to direct DAS ownership check below if the perk endpoint is unavailable.
        }

        if (!perksFetched) {
          const ourCollection = getCollectionMint();
          if (ourCollection) {
            ownsCard = parsedTokens.some((t) => t.collectionId === ourCollection);
            if (!ownsCard && heliusUrl) {
              try {
                const dasData = await postRpcJson<{ total?: number }>(
                  heliusUrl,
                  {
                    jsonrpc: '2.0',
                    id: 'check-prism-card',
                    method: 'searchAssets',
                    params: {
                      ownerAddress: targetOwner.toBase58(),
                      grouping: ['collection', ourCollection],
                      page: 1,
                      limit: 1,
                    },
                  },
                  BLACKHOLE_AUX_TIMEOUT_MS,
                );
                ownsCard = (dasData?.total ?? 0) > 0;
              } catch {
                // silently ignore — standard fee remains in place
              }
            }
          }
          resolvedCommissionRate = ownsCard ? COMMISSION_RATE_MINTED : COMMISSION_RATE_DEFAULT;
        }

        setHasMintedCard(ownsCard);
        setCommissionRate(resolvedCommissionRate);
        setHolderCommissionRate(resolvedHolderCommissionRate);
        setStandardCommissionRate(resolvedStandardCommissionRate);
      } else {
        try {
          const perks = await fetchIdentityPerksWithTimeout(targetOwner.toBase58());
          prefetchIdentityPerks = perks;
          const ownsCard = Boolean(perks?.hasIdentityPrism);
          const resolvedCommissionRate =
            parseNumber(perks?.blackHoleCommissionRate) ??
            (ownsCard ? COMMISSION_RATE_MINTED : COMMISSION_RATE_DEFAULT);
          const resolvedHolderCommissionRate =
            parseNumber(perks?.holderBlackHoleCommissionRate) ?? COMMISSION_RATE_MINTED;
          const resolvedStandardCommissionRate =
            parseNumber(perks?.standardBlackHoleCommissionRate) ?? COMMISSION_RATE_DEFAULT;
          setHasMintedCard(ownsCard);
          setCommissionRate(resolvedCommissionRate);
          setHolderCommissionRate(resolvedHolderCommissionRate);
          setStandardCommissionRate(resolvedStandardCommissionRate);
        } catch {
          setHasMintedCard(false);
          setCommissionRate(COMMISSION_RATE_DEFAULT);
          setHolderCommissionRate(COMMISSION_RATE_MINTED);
          setStandardCommissionRate(COMMISSION_RATE_DEFAULT);
        }
      }

      // Tokens without Helius DAS price data are treated as zero-value dust
      parsedTokens.forEach((token) => {
        if (token.isNft === undefined) {
          const isMaybeNft = token.decimals === 0 && token.uiAmount <= 1;
          token.isNft = isMaybeNft;
        }
      });

      updateScanStep('jupiterPriceFallback', 'Checking dust prices');
      // Jupiter price fallback for fungible tokens without DAS price
      const noPriceMints = parsedTokens
        .filter((t) => !t.isNft && t.priceUsd == null && t.uiAmount > 0)
        .map((t) => t.mint);
      if (noPriceMints.length > 0) {
        const jupPrices = await fetchFallbackPrices([...new Set(noPriceMints)]);
        parsedTokens.forEach((t) => {
          if (!t.isNft && t.priceUsd == null) {
            const p = jupPrices.get(t.mint);
            if (p) t.priceUsd = p;
          }
        });
      }

      updateScanStep('collectionMarketStats', 'Checking NFT floors');
      const collectionLookups = new Map<
        string,
        { symbol?: string; collectionId?: string; collectionName?: string; sampleMint?: string }
      >();
      parsedTokens
        .filter(
          (token) =>
            token.isNft &&
            token.collectionId &&
            token.marketStatus !== 'listed' &&
            !(token.marketFloorSol !== null && token.marketFloorSol !== undefined && token.marketFloorSol > 0),
        )
        .forEach((token) => {
          const key = `${token.collectionSymbol ?? ''}|${token.collectionId}`;
          if (!collectionLookups.has(key)) {
            collectionLookups.set(key, {
              symbol: token.collectionSymbol,
              collectionId: token.collectionId,
              collectionName: token.collectionName,
              sampleMint: token.mint,
            });
          }
        });

      if (collectionLookups.size > 0) {
        const statuses = await Promise.all(
          Array.from(collectionLookups.entries()).map(async ([key, lookup]) => {
            const cached = collectionMarketCache.current.get(key);
            if (cached) return [key, cached] as const;
            const stats = await fetchCollectionMarketStats(
              proxyBase,
              lookup.symbol,
              lookup.collectionId,
              lookup.collectionName,
              lookup.sampleMint,
            );
            collectionMarketCache.current.set(key, stats);
            return [key, stats] as const;
          }),
        );
        const statusMap = new Map(statuses);
        parsedTokens.forEach((token) => {
          if (!token.isNft || !token.collectionId) return;
          const key = `${token.collectionSymbol ?? ''}|${token.collectionId}`;
          const stats = statusMap.get(key);
          token.marketStatus = stats?.status ?? token.marketStatus ?? 'unknown';
          token.marketFloorSol = stats?.floorSol ?? token.marketFloorSol ?? null;
          token.marketSource = stats?.source ?? token.marketSource ?? null;
          token.listedCount = stats?.listedCount ?? token.listedCount ?? null;
          token.tensorUrl = stats?.tensorUrl ?? token.tensorUrl ?? null;
          token.meUrl = stats?.meUrl ?? token.meUrl ?? null;
        });
      } else {
        parsedTokens.forEach((token) => {
          if (token.isNft) token.marketStatus = token.marketStatus ?? 'unknown';
        });
      }

      fetchStep = 'valueCalculation';
      parsedTokens.forEach((token) => {
        // For NFTs: prefer marketFloorSol, fall back to DAS priceUsd
        if (token.isNft) {
          if (token.marketFloorSol !== null && token.marketFloorSol !== undefined && token.marketFloorSol > 0) {
            token.valueSol = token.marketFloorSol;
            if (solUsd) {
              token.valueUsd = token.marketFloorSol * solUsd;
            }
          } else if (token.priceUsd !== null && token.priceUsd !== undefined && token.priceUsd > 0) {
            // Fallback: use DAS price_info when no floor data available
            token.valueUsd = token.priceUsd;
            if (solUsd) {
              token.valueSol = token.priceUsd / solUsd;
            }
          }
        } else {
          const priceKnown = token.priceUsd !== null && token.priceUsd !== undefined;
          if (priceKnown) {
            token.valueUsd = token.priceUsd * token.uiAmount;
          }
          if (solUsd && token.valueUsd !== null && token.valueUsd !== undefined) {
            token.valueSol = token.valueUsd / solUsd;
          }
        }

        const actualRent = token.rentSol;
        const effectiveRate = resolvedCommissionRate;
        const rentAfterFees = actualRent * (1 - effectiveRate) - ESTIMATED_FEE_SOL;
        if (token.valueSol !== null && token.valueSol !== undefined) {
          token.netGainSol = rentAfterFees - token.valueSol;
        } else if (token.uiAmount === 0) {
          token.netGainSol = rentAfterFees;
        } else {
          token.netGainSol = rentAfterFees;
        }

        const classification = classifyAsset(token);
        token.assetStatus = classification.status;
        token.protectReason = classification.reason;

        if (classification.status === 'protected') {
          token.isCandidate = false;
        } else if (classification.status === 'valuable') {
          token.isCandidate = false;
        } else {
          const valueKnown = token.valueSol !== null && token.valueSol !== undefined;
          const valueLow = valueKnown ? token.valueSol! <= VALUE_THRESHOLD_SOL : false;
          const netGainPositive = token.netGainSol !== null && token.netGainSol !== undefined && token.netGainSol >= 0;
          const hasCollection = Boolean(token.collectionId || token.collectionSymbol);

          if (token.isNft) {
            if (token.marketStatus === 'not_listed') {
              token.isCandidate = true;
            } else {
              token.isCandidate = (!hasCollection && (netGainPositive || !valueKnown)) || valueLow;
            }
          } else {
            if (token.uiAmount === 0 && rentAfterFees >= MIN_NET_RETURN_SOL) {
              token.isCandidate = true;
            } else if (token.uiAmount === 0 && rentAfterFees < MIN_NET_RETURN_SOL) {
              token.isCandidate = false;
            } else if (valueKnown) {
              token.isCandidate = netGainPositive || valueLow;
            } else {
              const isDust = token.uiAmount > 0 && token.uiAmount < 0.0001;
              token.isCandidate = isDust;
            }
          }
        }
      });

      const prefetchMetadata = Object.fromEntries(
        parsedTokens.map((token) => [
          token.mint,
          {
            mint: token.mint,
            name: token.name,
            symbol: token.symbol,
            image: getRawBlackHoleImageUrl(token.image),
            isNft: token.isNft,
            collectionId: token.collectionId,
            collectionName: token.collectionName,
            collectionSymbol: token.collectionSymbol,
            priceUsd: token.priceUsd ?? null,
            floorSol: token.marketFloorSol ?? null,
            marketFloorSol: token.marketFloorSol ?? null,
            marketStatus: token.marketStatus ?? 'unknown',
            marketSource: token.marketSource ?? null,
            listedCount: token.listedCount ?? null,
            tensorUrl: token.tensorUrl ?? null,
            meUrl: token.meUrl ?? null,
          },
        ]),
      );
      writeBlackHoleMetadataCache({ ...readBlackHoleMetadataCache(), ...prefetchMetadata });
      writeBlackHolePrefetch(targetOwner.toBase58(), {
        tokenAccounts: [
          ...toBlackHolePrefetchTokens(splTokens, TOKEN_PROGRAM_ID),
          ...toBlackHolePrefetchTokens(token2022Tokens, TOKEN_2022_PROGRAM_ID),
        ],
        timestamp: Date.now(),
        complete: token2022TokensResult.status === 'fulfilled',
        programCounts: {
          [TOKEN_PROGRAM_ID.toBase58()]: splTokens.length,
          [TOKEN_2022_PROGRAM_ID.toBase58()]: token2022Tokens.length,
        },
        metadataStatus: Object.keys(prefetchMetadata).length > 0 && solUsd != null ? 'ready' : 'partial',
        metadata: prefetchMetadata,
        solUsd,
        identityPerks: prefetchIdentityPerks,
      });

      sortTokensForDisplay(parsedTokens);

      if (isStaleRequest()) return;
      setTokens([...parsedTokens]);
      setFetchError(null);
      console.warn(
        `[BH scan] received ${parsedTokens.length} tokens, displayed ${getDisplayedScanCount(
          parsedTokens,
          assetFilter,
        )}; buckets shielded=${parsedTokens.filter((t) => t.assetStatus === 'protected').length}, caution=${parsedTokens.filter(
          (t) => t.assetStatus === 'valuable',
        ).length}, cleanup=${parsedTokens.filter((t) => t.assetStatus === 'burnable').length}`,
      );
      toast.success(`Found ${parsedTokens.length} token accounts`);
    } catch (err: unknown) {
      if (isStaleRequest()) return;
      const message = (err as Error)?.message ?? String(err);
      console.error(`[BlackHole] fetchTokens error at step "${fetchStep}":`, err);
      const hasUsefulRenderedTokens = renderedUsefulCache || tokensRef.current.length >= 10;
      if (hasUsefulRenderedTokens) {
        console.warn(`[BlackHole] suppressed scan error after rendering cache (${tokensRef.current.length} tokens)`, err);
      } else {
        setFetchError(`Failed during ${fetchStep}: ${message}`);
        toast.error(`Failed to fetch tokens (${fetchStep}): ${message}`);
      }
    } finally {
      if (!isStaleRequest()) {
        setIsLoading(false);
        setScanStep('Preparing scan');
      }
    }
  }, [assetFilter]);

  useEffect(() => {
    const ownerBase58 = ownerPublicKey?.toBase58() ?? null;
    if (!ownerBase58 || lastOwnerRef.current === ownerBase58) return;
    lastOwnerRef.current = ownerBase58;
    fetchTokens(ownerPublicKey);
  }, [ownerPublicKey, fetchTokens]);

  useEffect(() => {
    const selected = tokens.filter((token) => selectedTokens.has(token.pubkey.toBase58()));
    if (selected.length === 0) {
      setResolutionPlan((current) => (Object.keys(current).length === 0 ? current : {}));
      setIsPlanning(false);
      return;
    }

    let cancelled = false;
    setIsPlanning(true);

    (async () => {
      const nextPlan: Record<string, ResolutionPlanItem> = {};

      for (const token of selected) {
        const key = token.pubkey.toBase58();
        const closeNet = estimateCloseNetSol(token);

        if (!isSelectableToken(token)) {
          nextPlan[key] = {
            token,
            action: 'skip',
            reason:
              token.assetStatus === 'protected' ? 'Protected asset' : token.protectReason || 'Manual review required',
            estimatedNetSol: 0,
            estimatedBurnNetSol: token.uiAmount > 0 ? closeNet : null,
            estimatedSwapNetSol: null,
            swapQuote: null,
          };
          continue;
        }

        if (token.uiAmount === 0) {
          nextPlan[key] = {
            token,
            action: closeNet >= MIN_NET_RETURN_SOL ? 'close' : 'skip',
            reason:
              closeNet >= MIN_NET_RETURN_SOL
                ? 'Empty account — close and reclaim rent'
                : 'Return is below the minimum useful threshold',
            estimatedNetSol: closeNet >= MIN_NET_RETURN_SOL ? closeNet : 0,
            estimatedBurnNetSol: null,
            estimatedSwapNetSol: null,
            swapQuote: null,
          };
          continue;
        }

        if (token.isNft) {
          const shouldBurn = token.assetStatus === 'burnable' && closeNet >= MIN_NET_RETURN_SOL;
          nextPlan[key] = {
            token,
            action: shouldBurn ? 'burn' : 'skip',
            reason: shouldBurn
              ? 'Unlisted NFT dust — burn and reclaim rent'
              : token.protectReason || 'NFT kept in quarantine',
            estimatedNetSol: shouldBurn ? closeNet : 0,
            estimatedBurnNetSol: shouldBurn ? closeNet : null,
            estimatedSwapNetSol: null,
            swapQuote: null,
          };
          continue;
        }

        const quote = await getSwapQuoteCached(token);
        if (cancelled) return;

        const swapNet = quote
          ? Math.max(
              0,
              quote.outSol + token.rentSol * (1 - commissionRate) - ESTIMATED_SWAP_FEE_SOL - ESTIMATED_FEE_SOL,
            )
          : null;

        if (quote && swapNet !== null && swapNet > closeNet + SWAP_ADVANTAGE_BUFFER_SOL) {
          nextPlan[key] = {
            token,
            action: 'swap',
            reason: `Swap returns ~${swapNet.toFixed(4)} SOL net`,
            estimatedNetSol: swapNet,
            estimatedBurnNetSol: closeNet,
            estimatedSwapNetSol: swapNet,
            swapQuote: quote,
          };
          continue;
        }

        if (quote && swapNet !== null && swapNet > 0) {
          nextPlan[key] = {
            token,
            action: 'swap',
            reason: `Route value to SOL first (~${swapNet.toFixed(4)} SOL net)`,
            estimatedNetSol: swapNet,
            estimatedBurnNetSol: closeNet,
            estimatedSwapNetSol: swapNet,
            swapQuote: quote,
          };
          continue;
        }

        if (token.assetStatus === 'burnable' && closeNet >= MIN_NET_RETURN_SOL) {
          nextPlan[key] = {
            token,
            action: 'burn',
            reason: 'No positive route found — burn is the best recovery path',
            estimatedNetSol: closeNet,
            estimatedBurnNetSol: closeNet,
            estimatedSwapNetSol: swapNet,
            swapQuote: quote,
          };
          continue;
        }

        nextPlan[key] = {
          token,
          action: 'skip',
          reason: token.protectReason || 'No profitable route found',
          estimatedNetSol: 0,
          estimatedBurnNetSol: closeNet,
          estimatedSwapNetSol: swapNet,
          swapQuote: quote,
        };
      }

      if (!cancelled) {
        setResolutionPlan((current) => (areResolutionPlansEqual(current, nextPlan) ? current : nextPlan));
        setIsPlanning(false);
      }
    })().catch(() => {
      if (!cancelled) setIsPlanning(false);
    });

    return () => {
      cancelled = true;
    };
  }, [commissionRate, estimateCloseNetSol, getSwapQuoteCached, isSelectableToken, selectedTokens, tokens]);

  const toggleSelection = (pubkey: string) => {
    if (!canResolveScan) return;
    const token = tokens.find((entry) => entry.pubkey.toBase58() === pubkey);
    if (token && !isSelectableToken(token)) return;
    const newSelection = new Set(selectedTokens);
    if (newSelection.has(pubkey)) {
      newSelection.delete(pubkey);
    } else {
      newSelection.add(pubkey);
    }
    setSelectedTokens(newSelection);
  };

  const selectAll = () => {
    if (!canResolveScan) return;
    const selectableVisibleTokens = getVisibleTokens().filter(isSelectableToken);
    const selectedVisibleCount = selectableVisibleTokens.filter((token) =>
      selectedTokens.has(token.pubkey.toBase58()),
    ).length;

    if (selectableVisibleTokens.length > 0 && selectedVisibleCount === selectableVisibleTokens.length) {
      setSelectedTokens(new Set());
    } else {
      setSelectedTokens(new Set(selectableVisibleTokens.map((token) => token.pubkey.toBase58())));
    }
  };

  const waitForSignatureConfirmation = useCallback(
    async (signature: string, label: string) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const status = await blackholeWithTimeout(
          `${label} getSignatureStatus attempt ${attempt + 1}`,
          connection.getSignatureStatus(signature),
          8_000,
        );
        const confirmation = status?.value?.confirmationStatus;
        if (status?.value?.err) {
          throw new Error(`${label} failed: ${JSON.stringify(status.value.err)}`);
        }
        if (confirmation === 'confirmed' || confirmation === 'finalized') {
          return;
        }
      }
      throw new Error(`${label} confirmation timed out`);
    },
    [connection],
  );

  const signAndSendLegacyTransaction = useCallback(
    async (tx: Transaction, label: string) => {
      if (!publicKey) throw new Error('Wallet not connected');

      console.warn(`[blackhole] step 1/4 — ${label} getLatestBlockhash(confirmed)`);
      const { blockhash, lastValidBlockHeight } = await blackholeWithTimeout(
        `${label} getLatestBlockhash(confirmed)`,
        connection.getLatestBlockhash('confirmed'),
        8_000,
      );
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = publicKey;

      await simulateBlackHoleBeforeSign(connection, tx, label);

      const origSerialize = tx.serialize.bind(tx);
      tx.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
        origSerialize({
          ...config,
          requireAllSignatures: false,
          verifySignatures: false,
        })) as typeof tx.serialize;

      console.warn(`[blackhole] step 3/4 — ${label} wallet signing (popup expected)`);
      const signPromise = signTransaction
        ? signTransaction(tx).then(async (signed) => {
            console.warn(`[BlackHole] ${label} signed — broadcasting`, {
              feePayer: publicKey?.toBase58().slice(0, 8),
              blockhash: blockhash?.slice(0, 8),
            });
            const sig = await blackholeWithTimeout(
              `${label} sendRawTransaction`,
              connection.sendRawTransaction(
                (signed as Transaction).serialize({ requireAllSignatures: false, verifySignatures: false }),
                { skipPreflight: true, preflightCommitment: 'confirmed' },
              ),
              30_000,
            );
            console.warn(`[BlackHole] ${label} broadcast → ${sig}`);
            return sig;
          })
        : sendTransaction(tx, connection, { skipPreflight: true, preflightCommitment: 'confirmed' });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Wallet signing timed out — please approve or reject in your wallet')),
          120_000,
        ),
      );
      const signature = await Promise.race([signPromise, timeoutPromise]);
      console.warn(`[blackhole] step 4/4 — ${label} signature produced; confirming`);
      await waitForSignatureConfirmation(signature, label);
      return signature;
    },
    [connection, publicKey, sendTransaction, signTransaction, waitForSignatureConfirmation],
  );

  const signAndSendVersionedTransaction = useCallback(
    async (tx: VersionedTransaction, label: string) => {
      await simulateBlackHoleBeforeSign(connection, tx, label);

      console.warn(`[blackhole] step 2/3 — ${label} wallet signing (popup expected)`);
      const signPromise = signTransaction
        ? signTransaction(tx).then(async (signed) =>
            blackholeWithTimeout(
              `${label} sendRawTransaction`,
              connection.sendRawTransaction((signed as VersionedTransaction).serialize(), {
                skipPreflight: true,
                preflightCommitment: 'confirmed',
              }),
              30_000,
            ),
          )
        : sendTransaction(tx, connection, { skipPreflight: true, preflightCommitment: 'confirmed' });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Wallet signing timed out — please approve or reject in your wallet')),
          120_000,
        ),
      );
      const signature = await Promise.race([signPromise, timeoutPromise]);
      console.warn(`[blackhole] step 3/3 — ${label} signature produced; confirming`);
      await waitForSignatureConfirmation(signature, label);
      return signature;
    },
    [connection, sendTransaction, signTransaction, waitForSignatureConfirmation],
  );

  const signAndExecuteOrderedTransaction = useCallback(
    async (tx: VersionedTransaction, requestId: string, label: string) => {
      await simulateBlackHoleBeforeSign(connection, tx, label);

      if (!signTransaction) {
        throw new Error('Current wallet does not support direct transaction signing for Jupiter execution');
      }

      console.warn(`[blackhole] step 2/3 — ${label} wallet signing (popup expected)`);
      const signPromise = signTransaction(tx).then((signed) =>
        executeSwapTransaction(encodeVersionedTransaction(signed as VersionedTransaction), requestId),
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Wallet signing timed out — please approve or reject in your wallet')),
          120_000,
        ),
      );
      const result = await Promise.race([signPromise, timeoutPromise]);
      console.warn(`[blackhole] step 3/3 — ${label} signature produced; confirming`);
      await waitForSignatureConfirmation(result.signature, label);
      return result.signature;
    },
    [connection, signTransaction, waitForSignatureConfirmation],
  );

  const handleIncinerate = async () => {
    if (isDemoMode()) {
      toast.info('This is a demo — connect a wallet to do this.');
      return;
    }
    if (!publicKey) {
      toast.error('Connect wallet to resolve assets');
      return;
    }
    if (ownerPublicKey && ownerPublicKey.toBase58() !== publicKey.toBase58()) {
      toast.error('Connected wallet does not match scanned address');
      return;
    }
    if (selectedTokens.size === 0) return;

    const selectedPlans = tokens
      .filter((token) => selectedTokens.has(token.pubkey.toBase58()))
      .map((token) => resolutionPlan[token.pubkey.toBase58()])
      .filter((plan): plan is ResolutionPlanItem => Boolean(plan));

    const executablePlans = selectedPlans.filter((plan) => plan.action !== 'skip');
    const skippedCount = selectedPlans.length - executablePlans.length;
    if (executablePlans.length === 0) {
      toast.error('No profitable cleanup actions selected');
      return;
    }

    setIsBurning(true);
    try {
      const initialWallet = publicKey.toBase58();
      const swapPlans = executablePlans.filter((plan) => plan.action === 'swap');
      let burnPlans = executablePlans.filter((plan) => plan.action === 'burn');
      let closePlans = executablePlans.filter((plan) => plan.action === 'close');
      const unsafeBurn = burnPlans.find(
        (plan) => plan.token.assetStatus === 'valuable' || (plan.token.valueSol ?? 0) > VALUE_THRESHOLD_SOL,
      );
      if (unsafeBurn) {
        throw new Error(
          `${unsafeBurn.token.name || unsafeBurn.token.symbol || unsafeBurn.token.mint.slice(0, 6)} has value and will not be burned`,
        );
      }

      const validateTokenPlans = async (plans: ResolutionPlanItem[], mode: 'burn' | 'close') => {
        if (Capacitor.isNativePlatform()) {
          console.warn(`[blackhole] validate ${mode} — native RPC validation skipped before signing`);
          return plans;
        }
        const checks = await Promise.allSettled(
          plans.map(async (plan) => {
            const token = plan.token;
            console.warn(`[blackhole] validate ${mode} — getParsedAccountInfo ${token.pubkey.toBase58().slice(0, 8)}`);
            const account = await blackholeWithTimeout(
              `${mode} validate getParsedAccountInfo(${token.pubkey.toBase58().slice(0, 8)})`,
              connection.getParsedAccountInfo(token.pubkey, 'confirmed'),
              8_000,
            );
            const value = account.value;
            if (!value) throw new Error('account no longer exists');
            if (!value.owner.equals(token.programId)) throw new Error('token program changed');
            const parsed = (value.data as any)?.parsed;
            const info = parsed?.info;
            if (!info) throw new Error('account is not parsed token data');
            if (String(info.owner) !== initialWallet) throw new Error('wallet no longer owns token account');
            if (String(info.mint) !== token.mint) throw new Error('mint changed');
            const state = String(info.state ?? '').toLowerCase();
            if (state === 'frozen') throw new Error('account is frozen');
            const currentAmount = BigInt(info.tokenAmount?.amount ?? '0');
            if (mode === 'burn' && currentAmount < token.amount) throw new Error('token amount changed');
            if (mode === 'close' && currentAmount > 0n) throw new Error('non-empty account requires burn or swap first');
            return plan;
          }),
        );
        const valid: ResolutionPlanItem[] = [];
        let rejected = 0;
        checks.forEach((result, index) => {
          if (result.status === 'fulfilled') valid.push(result.value);
          else {
            rejected += 1;
            const token = plans[index].token;
            console.warn('[BlackHole] skipping stale cleanup plan', {
              mode,
              account: token.pubkey.toBase58(),
              mint: token.mint,
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
          }
        });
        if (rejected > 0) {
          toast.warning(`${rejected} stale asset${rejected === 1 ? '' : 's'} skipped`, {
            description: 'Wallet inventory changed after scan. Re-scan after cleanup.',
          });
        }
        return valid;
      };

      burnPlans = await validateTokenPlans(burnPlans, 'burn');
      closePlans = await validateTokenPlans(closePlans, 'close');
      // Hard guard: if validation killed every plan, abort loudly. Previously would silent-succeed.
      if (swapPlans.length === 0 && burnPlans.length === 0 && closePlans.length === 0) {
        console.error('[BlackHole] handleIncinerate aborted — all plans invalidated post-scan', {
          initialExecutable: executablePlans.length,
          swap: 0, burn: 0, close: 0,
        });
        toast.error('Wallet state changed — please rescan and try again', {
          description: 'All selected assets were modified between scan and execute. Nothing was broadcast.',
        });
        return;
      }
      const estimatedNetSol = executablePlans.reduce((sum, plan) => sum + plan.estimatedNetSol, 0);
      const estimatedReward = estimateBlackHoleReward(
        executablePlans.filter((plan) => !plan.token.isNft).length,
        executablePlans.filter((plan) => plan.token.isNft).length,
        estimatedNetSol,
      );

      if (skippedCount > 0) {
        toast.warning(`${skippedCount} asset(s) kept out of the resolution plan`);
      }

      const shell = document.querySelector('.blackhole-shell');
      if (shell) shell.scrollTo({ top: 0, behavior: 'smooth' });

      const animationTargets: IncinerationToken[] = executablePlans.map(({ token }, index) => ({
        id: token.pubkey.toBase58(),
        image: token.image,
        label: token.name || token.symbol || token.mint.slice(0, 6),
        delay: index * 120,
        startX: `${Math.random() * 60 - 30}vw`,
        startY: `${25 + Math.random() * 45}vh`,
      }));
      setIncinerationTokens(animationTargets);

      toast.info(`Preparing ${executablePlans.length} cleanup action${executablePlans.length > 1 ? 's' : ''}...`, {
        description: `${swapPlans.length} swap · ${burnPlans.length} burn · ${closePlans.length} reclaim rent · ~${estimatedNetSol.toFixed(4)} SOL · ~${estimatedReward} PRISM`,
      });

      const operationMap = new Map<string, ResolutionOperation>();
      const isTreasury = publicKey.toBase58() === TREASURY_ADDRESS;
      const createBatches = (plans: ResolutionPlanItem[], mode: 'burn' | 'close') => {
        const perTx = mode === 'burn' ? 2 : 8;
        const chunks: ResolutionPlanItem[][] = [];
        for (let i = 0; i < plans.length; i += perTx) {
          chunks.push(plans.slice(i, i + perTx));
        }

        return chunks.map((chunk) => {
          const tx = new Transaction();
          tx.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: mode === 'burn' ? 240_000 : 180_000 }),
            // Bumped 5_000 → 50_000 — 5_000 frequently lost to mempool drop on current mainnet load.
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
            buildMemoInstruction(mode === 'burn' ? BH_BURN_MEMO : BH_CLOSE_MEMO),
          );

          for (const plan of chunk) {
            const token = plan.token;
            if (mode === 'burn' && token.amount > 0n) {
              tx.add(
                createBurnInstruction(
                  token.pubkey,
                  new PublicKey(token.mint),
                  publicKey,
                  token.amount,
                  undefined,
                  token.programId,
                ),
              );
            }
            tx.add(createCloseAccountInstruction(token.pubkey, publicKey, publicKey, undefined, token.programId));
          }

          const chunkLamports = chunk.reduce((sum, plan) => sum + plan.token.lamports, 0);
          const commissionLamports = isTreasury ? 0 : Math.round(chunkLamports * commissionRate);
          if (commissionLamports > 0) {
            tx.add(
              SystemProgram.transfer({
                fromPubkey: publicKey,
                toPubkey: new PublicKey(TREASURY_ADDRESS),
                lamports: commissionLamports,
              }),
            );
          }

          return { tx, chunk };
        });
      };

      let swapSkippedCount = 0;
      for (let index = 0; index < swapPlans.length; index += 1) {
        const plan = swapPlans[index];
        if (publicKey.toBase58() !== initialWallet) {
          throw new Error('Wallet changed — remaining transactions cancelled');
        }
        const tokenLabel = plan.token.name || plan.token.symbol || plan.token.mint.slice(0, 6);
        if (!plan.swapQuote?.quoteResponse) {
          console.warn('[BlackHole] swap skipped — missing quote', { mint: plan.token.mint });
          swapSkippedCount += 1;
          toast.warning(`Swap skipped: ${tokenLabel}`, { description: 'No liquid route available' });
          continue;
        }

        try {
          toast.info(`Swap ${index + 1}/${swapPlans.length}`, {
            description: `${tokenLabel} → SOL`,
          });

          console.warn(`[blackhole] step 1/4 — Swap ${index + 1}/${swapPlans.length} build-swap`);
          const preparedSwap = await blackholeWithTimeout(
            `Swap ${index + 1}/${swapPlans.length} build-swap`,
            buildSwapTransaction(publicKey.toBase58(), plan.swapQuote.quoteResponse),
            BLACKHOLE_RPC_TIMEOUT_MS + 2_000,
          );
          const { swapTransaction } = preparedSwap;
          if (!swapTransaction) throw new Error('Failed to build swap transaction');
          console.warn(
            `[blackhole] step 2/4 — Swap ${index + 1}/${swapPlans.length} decode transaction (${preparedSwap.transport})`,
          );
          const versionedTx = decodeVersionedTransaction(swapTransaction);
          if (preparedSwap.transport === 'order_execute' && !preparedSwap.requestId) {
            throw new Error('Missing Jupiter requestId for swap execution');
          }
          console.warn(`[blackhole] step 3/4 — Swap ${index + 1}/${swapPlans.length} sign path ready`);
          const swapSignature =
            preparedSwap.transport === 'order_execute'
              ? await signAndExecuteOrderedTransaction(
                  versionedTx,
                  preparedSwap.requestId || '',
                  `Swap ${index + 1}/${swapPlans.length}`,
                )
              : await signAndSendVersionedTransaction(versionedTx, `Swap ${index + 1}/${swapPlans.length}`);
          const closeBatch = createBatches([plan], 'close')[0];
          const closeSignature = await signAndSendLegacyTransaction(
            closeBatch.tx,
            `Close swapped account ${index + 1}/${swapPlans.length}`,
          );

          operationMap.set(plan.token.pubkey.toBase58(), {
            account: plan.token.pubkey.toBase58(),
            mint: plan.token.mint,
            action: 'swap',
            swapSignature,
            closeSignature,
          });
        } catch (swapError) {
          // Wallet rejection / disconnect / chain timeout = abort whole flow
          if (isWalletRejectError(swapError)) throw swapError;
          if (swapError instanceof Error && swapError.message.includes('Wallet changed')) throw swapError;
          // Per-asset failure (build-swap 400, route unavailable, sim fail) — skip and continue
          console.warn('[BlackHole] swap asset skipped', {
            mint: plan.token.mint,
            error: swapError instanceof Error ? swapError.message : String(swapError),
          });
          swapSkippedCount += 1;
          toast.warning(`Swap skipped: ${tokenLabel}`, {
            description: swapError instanceof Error ? swapError.message : 'Unsupported asset',
          });
        }
      }

      const burnBatches = createBatches(burnPlans, 'burn');
      for (let index = 0; index < burnBatches.length; index += 1) {
        const batch = burnBatches[index];
        try {
          const signature = await signAndSendLegacyTransaction(batch.tx, `Burn batch ${index + 1}/${burnBatches.length}`);
          batch.chunk.forEach((plan) => {
            operationMap.set(plan.token.pubkey.toBase58(), {
              account: plan.token.pubkey.toBase58(),
              mint: plan.token.mint,
              action: 'burn',
              closeSignature: signature,
            });
          });
        } catch (batchError) {
          // User rejected the signature / disconnected / switched wallets → abort the ENTIRE flow.
          // Retrying here re-opened the wallet sign sheet after the user explicitly cancelled.
          if (isWalletRejectError(batchError)) throw batchError;
          if (batchError instanceof Error && batchError.message.includes('Wallet changed')) throw batchError;
          console.warn('[BlackHole] burn batch failed, retrying individual assets', batchError);
          for (let retryIndex = 0; retryIndex < batch.chunk.length; retryIndex += 1) {
            const retryPlan = batch.chunk[retryIndex];
            try {
              const retryBatch = createBatches([retryPlan], 'burn')[0];
              const signature = await signAndSendLegacyTransaction(
                retryBatch.tx,
                `Burn ${index + 1}.${retryIndex + 1}/${burnBatches.length}`,
              );
              operationMap.set(retryPlan.token.pubkey.toBase58(), {
                account: retryPlan.token.pubkey.toBase58(),
                mint: retryPlan.token.mint,
                action: 'burn',
                closeSignature: signature,
              });
            } catch (assetError) {
              if (isWalletRejectError(assetError)) throw assetError;
              console.warn('[BlackHole] burn asset skipped after retry', {
                account: retryPlan.token.pubkey.toBase58(),
                mint: retryPlan.token.mint,
                error: assetError instanceof Error ? assetError.message : String(assetError),
              });
              toast.warning('One burn asset was skipped', {
                description: assetError instanceof Error ? assetError.message : retryPlan.token.mint,
              });
            }
          }
        }
      }

      const closeBatches = createBatches(closePlans, 'close');
      for (let index = 0; index < closeBatches.length; index += 1) {
        const batch = closeBatches[index];
        const signature = await signAndSendLegacyTransaction(
          batch.tx,
          `Close batch ${index + 1}/${closeBatches.length}`,
        );
        batch.chunk.forEach((plan) => {
          const existing = operationMap.get(plan.token.pubkey.toBase58());
          if (existing) {
            existing.closeSignature = signature;
            operationMap.set(plan.token.pubkey.toBase58(), existing);
          } else {
            operationMap.set(plan.token.pubkey.toBase58(), {
              account: plan.token.pubkey.toBase58(),
              mint: plan.token.mint,
              action: 'close',
              closeSignature: signature,
            });
          }
        });
      }

      const completedOperations = [...operationMap.values()].filter((operation) => operation.closeSignature);
      let earnedPrism = 0;
      let claimedNetResolvedSol = 0;
      if (completedOperations.length > 0) {
        try {
          const claim = await claimBlackHoleReward(completedOperations);
          earnedPrism = claim.earned ?? 0;
          claimedNetResolvedSol = claim.netResolvedSol ?? 0;
        } catch (error) {
          console.warn('[BlackHole] reward claim failed', error);
          toast.warning('Cleanup completed, but PRISM reward is pending verification');
        }
      }

      const resolvedCount = completedOperations.length;
      const skippedSuffix = swapSkippedCount > 0 ? ` · ${swapSkippedCount} skipped (unsupported)` : '';
      toast.success('Resolution complete!', {
        description: `Resolved ${resolvedCount} asset${resolvedCount === 1 ? '' : 's'}${skippedSuffix} · ~${(claimedNetResolvedSol || estimatedNetSol).toFixed(4)} SOL · ${earnedPrism} PRISM`,
      });

      if (publicKey) {
        const addr = publicKey.toBase58();
        import('@/lib/prismQuests')
          .then(({ getQuestState, incrementQuest }) => {
            const qs = getQuestState(addr);
            const onComplete = (q: { name: string }) =>
              toast.success(`Quest completed: ${q.name}!`, { duration: 4000 });
            incrementQuest(qs, 'daily_burn', resolvedCount, onComplete);
            incrementQuest(qs, 'ot_first_burn', 1, onComplete);
            incrementQuest(qs, 'weekly_burn5', resolvedCount, onComplete);
            incrementQuest(qs, 'ot_burn100', resolvedCount, onComplete);
          })
          .catch(() => {});
      }

      setSelectedTokens(new Set());
      fetchTokens(ownerPublicKey);
    } catch (error) {
      if (isWalletRejectError(error)) {
        toast.info('Cleanup cancelled');
      } else if (error instanceof Error && error.message.includes('timed out')) {
        toast.error('Wallet did not respond — please try again', {
          description: 'The signature request timed out after 30 seconds.',
        });
      } else {
        toast.error('Resolution failed', {
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } finally {
      setIsBurning(false);
    }
  };

  const visibleTokens = getVisibleTokens();
  const selectableVisibleTokens = useMemo(
    () => visibleTokens.filter(isSelectableToken),
    [isSelectableToken, visibleTokens],
  );
  const resolvableVisibleTokens = useMemo(
    () => visibleTokens.filter(isResolvableSelectionTarget),
    [isResolvableSelectionTarget, visibleTokens],
  );
  const selectedVisibleCount = useMemo(
    () => selectableVisibleTokens.filter((token) => selectedTokens.has(token.pubkey.toBase58())).length,
    [selectableVisibleTokens, selectedTokens],
  );
  const missingImageCount = useMemo(
    () => tokens.filter((token) => token.metadataImageMissing).length,
    [tokens],
  );

  const handleSort = useCallback(
    (field: 'value' | 'return' | 'status') => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('desc');
      }
    },
    [sortField],
  );

  const sortedTokens = useMemo(() => {
    if (!sortField) return visibleTokens;
    return [...visibleTokens].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'status': {
          const order: Record<string, number> = { protected: 0, valuable: 1, burnable: 2 };
          cmp = (order[a.assetStatus ?? 'burnable'] ?? 2) - (order[b.assetStatus ?? 'burnable'] ?? 2);
          break;
        }
        case 'value':
          cmp = (a.valueSol ?? 0) - (b.valueSol ?? 0);
          break;
        case 'return': {
          cmp = (a.netGainSol ?? 0) - (b.netGainSol ?? 0);
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [visibleTokens, sortField, sortDir]);
  const totalPages = Math.max(1, Math.ceil(sortedTokens.length / perPage));
  const paginatedTokens = useMemo(() => {
    const start = (page - 1) * perPage;
    return sortedTokens.slice(start, start + perPage);
  }, [page, perPage, sortedTokens]);
  const showPagination = sortedTokens.length > perPage;

  useEffect(() => {
    setPage(1);
  }, [assetFilter, perPage]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const selectedPlanItems = useMemo(
    () =>
      tokens
        .filter((token) => selectedTokens.has(token.pubkey.toBase58()))
        .map((token) => resolutionPlan[token.pubkey.toBase58()])
        .filter((plan): plan is ResolutionPlanItem => Boolean(plan)),
    [resolutionPlan, selectedTokens, tokens],
  );

  const summary = useMemo(() => {
    const executable = selectedPlanItems.filter((plan) => plan.action !== 'skip');
    const totalAccounts = executable.length;
    const grossReclaim = executable.reduce((sum, plan) => sum + plan.token.rentSol, 0);
    const commission = grossReclaim * commissionRate;
    const netReturn = executable.reduce((sum, plan) => sum + plan.estimatedNetSol, 0);
    const totalValueLost = executable
      .filter((plan) => plan.action === 'burn')
      .reduce(
        (sum, plan) =>
          sum + (plan.token.valueSol && plan.token.valueSol > VALUE_THRESHOLD_SOL ? plan.token.valueSol : 0),
        0,
      );
    const protectedCount = tokens.filter((t) => t.assetStatus === 'protected').length;
    const valuableCount = tokens.filter((t) => t.assetStatus === 'valuable').length;
    const burnableCount = tokens.filter((t) => t.assetStatus === 'burnable').length;
    const swapCount = executable.filter((plan) => plan.action === 'swap').length;
    const burnCount = executable.filter((plan) => plan.action === 'burn').length;
    const closeCount = executable.filter((plan) => plan.action === 'close').length;
    const skippedCount = selectedPlanItems.length - executable.length;
    const estimatedReward = estimateBlackHoleReward(
      executable.filter((plan) => !plan.token.isNft).length,
      executable.filter((plan) => plan.token.isNft).length,
      netReturn,
    );
    return {
      totalAccounts,
      grossReclaim,
      commission,
      netReturn,
      totalValueLost,
      protectedCount,
      valuableCount,
      burnableCount,
      swapCount,
      burnCount,
      closeCount,
      skippedCount,
      estimatedReward,
    };
  }, [commissionRate, selectedPlanItems, tokens]);
  const getTokenDecision = useCallback(
    (token: TokenAccount) => {
      const key = token.pubkey.toBase58();
      const plan = resolutionPlan[key];

      if (selectedTokens.has(key) && plan) {
        if (plan.action === 'swap') {
          return { label: 'Swap', detail: plan.reason, className: 'bg-cyan-950/30 text-cyan-300', icon: Coins };
        }
        if (plan.action === 'burn') {
          return { label: 'Burn', detail: plan.reason, className: 'bg-red-950/20 text-red-400/80', icon: Flame };
        }
        if (plan.action === 'close') {
          return { label: 'Close', detail: plan.reason, className: 'bg-zinc-900/80 text-zinc-300', icon: RefreshCw };
        }
        return {
          label: 'Quarantine',
          detail: plan.reason,
          className: 'bg-amber-950/20 text-amber-400',
          icon: AlertTriangle,
        };
      }

      if (!isSelectableToken(token)) {
        if (token.assetStatus === 'protected') {
          return {
            label: 'Protected',
            detail: token.protectReason || 'Shielded from Black Hole',
            className: 'bg-emerald-900/20 text-emerald-400',
            icon: Shield,
          };
        }
        return {
          label: 'Quarantine',
          detail: token.protectReason || 'Manual review required',
          className: 'bg-amber-950/20 text-amber-400',
          icon: AlertTriangle,
        };
      }

      if (token.uiAmount === 0) {
        return {
          label: 'Close',
          detail: 'Empty account can be closed',
          className: 'bg-zinc-900/80 text-zinc-300',
          icon: RefreshCw,
        };
      }

      if (!token.isNft && token.assetStatus === 'valuable') {
        return {
          label: 'Swap?',
          detail: 'Select to check live route',
          className: 'bg-cyan-950/20 text-cyan-300',
          icon: Coins,
        };
      }

      return {
        label: 'Burn',
        detail: 'Dust / dead asset',
        className: 'bg-red-950/20 text-red-400/80',
        icon: Flame,
      };
    },
    [isSelectableToken, resolutionPlan, selectedTokens],
  );

  const debrisParticles = useMemo(() => {
    const particles: { key: number; style: React.CSSProperties }[] = [];
    for (let i = 0; i < 14; i++) {
      const hue = 15 + ((i * 7) % 40);
      const size = 2 + (i % 4) * 1.5;
      particles.push({
        key: i,
        style: {
          width: `${size}px`,
          height: `${size}px`,
          left: '50%',
          top: '50%',
          ['--start' as string]: `${i * 26}deg`,
          ['--radius' as string]: `${55 + (i % 6) * 22}px`,
          ['--dur' as string]: `${3.5 + (i % 5) * 1.8}s`,
          ['--delay' as string]: `${i * 0.4}s`,
          ['--color' as string]: `hsla(${hue}, 80%, 65%, 0.8)`,
        } as React.CSSProperties,
      });
    }
    return particles;
  }, []);

  const [returning, setReturning] = useState(false);
  const isNativeBlackHole = Capacitor.isNativePlatform();

  const handleReturnToCard = useCallback(() => {
    if (returning) return;
    setReturning(true);

    const addr = ownerPublicKey?.toBase58() ?? addressParam ?? '';
    const target = addr ? `/app?address=${encodeURIComponent(addr)}` : '/app';
    startFadeTransition(() => {
      try {
        sessionStorage.setItem('fromBlackHole', '1');
        if (addr) {
          sessionStorage.setItem('prism_active_address', addr);
          localStorage.setItem('prism_active_address', addr);
        }
      } catch {
        /* storage can be unavailable */
      }
      try {
        navigate(target, { state: { fromBlackHole: true }, replace: true });
      } catch {
        // Fallback for environments where navigate() throws
      }
      // Safety: if still on /blackhole after 600ms, force a full redirect
      // (Capacitor WebView can silently drop react-router navigate between route trees)
      setTimeout(() => {
        if (window.location.pathname.includes('blackhole')) {
          window.location.replace(target);
        }
      }, 600);
    });

    // Safety: reset returning flag after generous timeout so user can retry
    setTimeout(() => {
      setReturning(false);
    }, 2000);
  }, [returning, ownerPublicKey, addressParam, navigate]);

  return (
    <div className={`identity-shell blackhole-shell ${isNativeBlackHole ? 'blackhole-shell--native' : ''} ${returning ? 'bh-returning' : ''}`}>
      {!isNativeBlackHole && <SiteHeader />}
      {/* Wormhole tunnel handles transition — no void overlay needed */}
      {/* Background layers */}
      <div className="absolute inset-0 background-base" style={{ background: 'transparent' }} />
      <div className="constellation-bg" />
      <div className="nebula-layer nebula-one" style={{ opacity: 0.25 }} />
      <div className="nebula-layer nebula-two" style={{ opacity: 0.15 }} />
      <div className="identity-gradient" />

      {/* Incineration animation overlay */}
      <div className="blackhole-incineration-layer" aria-hidden>
        {incinerationTokens.map((token) => {
          const style = {
            ['--start-x' as string]: token.startX,
            ['--start-y' as string]: token.startY,
            animationDelay: `${token.delay}ms`,
          } as React.CSSProperties;
          return (
            <div key={token.id} className="incineration-token" style={style}>
              {token.image ? (
                <img
                  src={token.image}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className="incineration-dot" />
              )}
            </div>
          );
        })}
      </div>

      {/* ══ Hero: Title + Cinematic Black Hole ══ */}
      <div className="blackhole-hero">
        <h1 className="blackhole-hero__title">Black Hole</h1>
        <p className="blackhole-hero__sub">Recover rent from dust. Swap what still has value. Protected assets stay untouched.</p>

        <div
          className="blackhole-visual"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
            const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
            e.currentTarget.style.setProperty('--mx', `${x * 10}px`);
            e.currentTarget.style.setProperty('--my', `${y * 10}px`);
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.setProperty('--mx', '0px');
            e.currentTarget.style.setProperty('--my', '0px');
          }}
        >
          <div className="blackhole-glow" />
          <div className="blackhole-warp" />
          <div className="blackhole-jet blackhole-jet--north" />
          <div className="blackhole-jet blackhole-jet--south" />
          <div className="blackhole-accretion" />
          <div className="blackhole-ring" />
          <div className="blackhole-photon" />
          <div className="blackhole-lens" />
          <div className="blackhole-shadow" />
          <div className="blackhole-core" />
          {/* Debris particles being sucked in */}
          <div className="blackhole-debris">
            {debrisParticles.map((p) => (
              <div key={p.key} className="bh-debris-particle" style={p.style} />
            ))}
          </div>
        </div>
        <div className="flex w-full justify-center mt-4">
          <HubReturnButton onClick={handleReturnToCard} disabled={returning} aria-label="Go to hub" />
        </div>
      </div>

      {/* ══ Content below the black hole ══ */}
      <div className="blackhole-content">
        {/* If no wallet and no address param — show connect prompt */}
        {!ownerPublicKey ? (
          <div className="blackhole-panel flex flex-col items-center gap-5 py-8 text-center sm:gap-6 sm:py-12">
            <div className="mb-1 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-cyan-400 motion-safe:animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-cyan-300/70">
                Wallet required
              </span>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Scan dust. Keep the good stuff.</h2>
              <p className="max-w-md text-sm leading-relaxed text-zinc-400">
                Black Hole reviews token accounts, protects Identity Prism and other high-signal assets, then suggests the
                safest cleanup path for the rest.
              </p>
            </div>
            <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
              <Button
                type="button"
                data-testid="wallet-multi-button"
                onClick={handleConnectWallet}
                disabled={connecting || pendingNativeConnect}
                className="h-12 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 px-8 text-base font-semibold text-slate-950 shadow-lg shadow-cyan-900/20 hover:from-cyan-400 hover:to-violet-400 disabled:opacity-70"
              >
                {connecting || pendingNativeConnect ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting
                  </>
                ) : (
                  'Connect wallet'
                )}
              </Button>
            </div>
            <p className="text-xs text-zinc-500">
              Nothing is touched automatically. Connect first, review the plan, then approve cleanup.
            </p>
            <div className="grid w-full max-w-xl gap-2 text-left sm:grid-cols-3">
              <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/50 p-3">
                <Shield className="mb-2 h-4 w-4 text-emerald-400" />
                <p className="text-xs font-medium text-zinc-200">Protected assets stay locked</p>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">Seeker, Identity Prism, and valuable collections are excluded.</p>
              </div>
              <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/50 p-3">
                <Coins className="mb-2 h-4 w-4 text-cyan-300" />
                <p className="text-xs font-medium text-zinc-200">Swap before burn</p>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">Fungible dust gets routed to SOL whenever the live quote is better.</p>
              </div>
              <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/50 p-3">
                <RefreshCw className="mb-2 h-4 w-4 text-zinc-300" />
                <p className="text-xs font-medium text-zinc-200">Recover rent cleanly</p>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">Empty accounts can be closed without touching healthy inventory.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="blackhole-panel space-y-6">
            {/* Mission Status Header */}
            <div className="flex flex-col gap-4 border-b border-red-500/[0.08] pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-lg text-left">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {isReadOnlyScan && (
                    <span className="rounded-full border border-cyan-500/20 bg-cyan-950/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-200/80">
                      Read-only scan
                    </span>
                  )}
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  <span className="text-[10px] uppercase tracking-[0.12em] text-red-400/50 font-bold">
                    Active Mission
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-zinc-400">
                  Black Hole separated protected assets, caution assets, and cleanup candidates. Nothing moves until the
                  connected wallet signs.
                </p>
                <p className="text-[11px] mt-1.5 leading-relaxed">
                  {hasMintedCard ? (
                    <span className="text-emerald-400/80">
                      <Shield className="inline w-3 h-3 mr-0.5 -mt-0.5" />
                      ID Holder — salvage fee: <strong>{(commissionRate * 100).toFixed(0)}%</strong> (vs{' '}
                      {(standardCommissionRate * 100).toFixed(0)}% standard)
                    </span>
                  ) : (
                    <span className="text-zinc-500">
                      Standard salvage fee: {(standardCommissionRate * 100).toFixed(0)}% · ID holder fee:{' '}
                      {(holderCommissionRate * 100).toFixed(0)}%
                    </span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {!connectedMatchesScan && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleConnectWallet}
                    disabled={connecting || pendingNativeConnect}
                    className="h-10 rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 text-xs text-zinc-100 hover:bg-zinc-800 disabled:opacity-70"
                  >
                    {connecting || pendingNativeConnect ? 'Connecting' : isReadOnlyScan ? 'Connect matching wallet' : 'Connect'}
                  </Button>
                )}
              </div>
            </div>

            {fetchError && (
              <div className="rounded-2xl border border-red-500/20 bg-red-950/10 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                  <div className="space-y-2">
                    <div>
                      <p className="text-sm font-medium text-zinc-100">Couldn't load wallet assets</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{fetchError}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => fetchTokens(ownerPublicKey)}
                        className="h-9 rounded-xl bg-zinc-100 px-4 text-xs font-medium text-zinc-950 hover:bg-white"
                      >
                        Try again
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isLoading && tokens.length === 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="rounded-2xl border border-zinc-800/70 bg-zinc-950/40 p-4 motion-safe:animate-pulse"
                  >
                    <div className="h-3 w-24 rounded-full bg-zinc-800/80" />
                    <div className="mt-4 h-8 w-16 rounded-full bg-zinc-800/70" />
                    <div className="mt-3 h-2 w-full rounded-full bg-zinc-900/80" />
                  </div>
                ))}
              </div>
            )}

            {!isLoading && !fetchError && visibleTokens.length === 0 && (
              <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/45 p-5 text-center">
                <p className="text-sm font-medium text-zinc-100">
                  {tokens.length === 0 ? 'No token accounts found yet' : 'Nothing to clean up right now'}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  {tokens.length === 0
                    ? 'Try rescanning after the wallet finishes loading, or open this view with a wallet address.'
                    : 'Switch between All, NFTs, and Tokens to inspect the scanned assets.'}
                </p>
              </div>
            )}

            {/* Threat Assessment */}
            {tokens.length > 0 &&
              (() => {
                const contaminationPct =
                  tokens.length > 0 ? Math.round((summary.burnableCount / tokens.length) * 100) : 0;
                const threatLevel =
                  contaminationPct >= 70
                    ? 'CRITICAL'
                    : contaminationPct >= 40
                      ? 'HIGH'
                      : contaminationPct >= 15
                        ? 'MODERATE'
                        : 'LOW';
                const threatColor =
                  contaminationPct >= 70
                    ? '#ef4444'
                    : contaminationPct >= 40
                      ? '#f97316'
                      : contaminationPct >= 15
                        ? '#eab308'
                        : '#22c55e';
                return (
                  <div className="space-y-3">
                    {/* Contamination meter */}
                    <div className="rounded-xl border border-red-500/[0.1] bg-gradient-to-r from-red-950/[0.15] to-zinc-900/30 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-500 font-bold">
                          Contamination Level
                        </span>
                        <span className="text-xs font-black font-mono" style={{ color: threatColor }}>
                          {threatLevel}
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full bg-zinc-900/80 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${contaminationPct}%`,
                            background: `linear-gradient(90deg, ${threatColor}90, ${threatColor})`,
                          }}
                        />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[10px] text-zinc-600 font-mono">{contaminationPct}% contaminated</span>
                        <span className="text-[10px] text-zinc-600">
                          {summary.burnableCount} threats / {tokens.length} total
                        </span>
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-2.5 text-center">
                        <div className="text-lg font-bold text-zinc-100">{tokens.length}</div>
                        <div className="text-[9px] text-zinc-500 mt-0.5 uppercase tracking-wider">Scanned</div>
                      </div>
                      <div className="bg-emerald-950/20 border border-emerald-900/20 rounded-xl p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Shield className="h-3 w-3 text-emerald-400" />
                          <span className="text-lg font-bold text-emerald-400">{summary.protectedCount}</span>
                        </div>
                        <div className="text-[9px] text-emerald-600/80 mt-0.5 uppercase tracking-wider">Shielded</div>
                      </div>
                      <div className="bg-amber-950/20 border border-amber-900/20 rounded-xl p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <AlertTriangle className="h-3 w-3 text-amber-400" />
                          <span className="text-lg font-bold text-amber-400">{summary.valuableCount}</span>
                        </div>
                        <div className="text-[9px] text-amber-600/80 mt-0.5 uppercase tracking-wider">Caution</div>
                      </div>
                      <div className="bg-red-950/20 border border-red-900/20 rounded-xl p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Flame className="h-3 w-3 text-red-400" />
                          <span className="text-lg font-bold text-red-400">{summary.burnableCount}</span>
                        </div>
                        <div className="text-[9px] text-red-600/80 mt-0.5 uppercase tracking-wider">Threats</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

            {/* Resolution Manifest */}
            {canResolveScan && (
              <div className="manifest-card blackhole-resolution-manifest rounded-2xl border border-zinc-800/70 bg-zinc-950/45 p-3 shadow-[0_14px_36px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Flame className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
                      <span className="truncate text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">
                        Resolution Manifest
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-400">
                      {selectedTokens.size} selected, {summary.totalAccounts} executable, ~
                      {parseFloat(summary.netReturn.toFixed(4))} SOL salvage
                      {solPriceUsd ? ` (${formatUsd(summary.netReturn * solPriceUsd)})` : ''}.
                    </p>
                  </div>
                  {isPlanning && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-cyan-200">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Planning
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-1.5 text-center sm:grid-cols-4">
                  {[
                    {
                      label: 'Swap',
                      displayLabel: 'Swap',
                      value: summary.swapCount,
                      tone: 'text-cyan-300',
                      title: 'Swap liquid tokens to SOL before closing their token accounts.',
                    },
                    {
                      label: 'Burn',
                      displayLabel: 'Burn',
                      value: summary.burnCount,
                      tone: 'text-orange-300',
                      title: 'Burn dust tokens or unlisted NFTs, then reclaim the account rent.',
                    },
                    {
                      label: 'Reclaim rent',
                      displayLabel: 'Reclaim rent',
                      value: summary.closeCount,
                      tone: 'text-zinc-200',
                      title: 'Close empty token accounts and return rent to your wallet.',
                    },
                    {
                      label: 'Skipped',
                      displayLabel: 'Skipped',
                      value: summary.skippedCount,
                      tone: 'text-emerald-300',
                      title: 'Selected assets kept out of execution because they are shielded or not profitable.',
                    },
                  ].map(({ label, displayLabel, value, tone, title }) => (
                    <div key={label} title={title} className="rounded-xl border border-zinc-800/70 bg-zinc-950/35 px-2 py-2">
                      <div className={`font-mono text-base font-black leading-none ${tone}`}>{value}</div>
                      <div className="mt-1 text-[9px] font-bold uppercase leading-tight tracking-[0.08em] text-zinc-500">{displayLabel}</div>
                    </div>
                  ))}
                </div>

                {selectedTokens.size === 0 && (
                  <div className="mt-3 rounded-xl border border-zinc-800/60 bg-zinc-950/35 px-3 py-2 text-[11px] text-zinc-500">
                    Select assets below to preview your cleanup plan.
                  </div>
                )}

                <div
                  className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-3 py-2 text-[11px] text-amber-100"
                  title="Estimated Prism Coins credited after the cleanup is verified. Daily caps and staking boosts can change the final amount."
                >
                  <Coins className="mr-1 inline h-3 w-3 text-amber-300" aria-hidden="true" />
                  Prism reward: ~{summary.estimatedReward} 🜨
                </div>

                {summary.totalValueLost > 0.001 && (
                  <div className="mt-3 rounded-xl border border-red-400/20 bg-red-950/24 px-3 py-2 text-[11px] text-red-300">
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    Value at risk: ~{parseFloat(summary.totalValueLost.toFixed(4))} SOL
                  </div>
                )}

                <Button
                  onClick={handleIncinerate}
                  disabled={isBurning || isPlanning || summary.totalAccounts === 0}
                  title={summary.totalAccounts === 0 ? 'Select assets to execute' : undefined}
                  className={`mt-3 h-12 w-full rounded-full px-5 text-sm font-black transition-all duration-200 ${
                    summary.totalAccounts === 0
                      ? 'border border-zinc-800/70 bg-zinc-900/45 text-zinc-500 shadow-none hover:bg-zinc-900/45 disabled:opacity-100'
                      : 'bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500 text-slate-950 shadow-[0_14px_38px_rgba(34,211,238,0.18)] hover:from-cyan-300 hover:via-violet-400 hover:to-fuchsia-400 disabled:opacity-50'
                  }`}
                >
                  {isBurning || isPlanning ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Flame className="mr-2 h-4 w-4" />
                  )}
                  EXECUTE {summary.totalAccounts} {'->'} ~{parseFloat(summary.netReturn.toFixed(4))} SOL
                </Button>
              </div>
            )}

            {/* Salvage Reward */}
            {tokens.length > 0 && totalRecoverableSol > 0 && selectedTokens.size === 0 && (
              <div className="bg-gradient-to-r from-emerald-950/30 via-emerald-950/20 to-zinc-900/30 border border-emerald-800/30 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-emerald-500/80 uppercase tracking-[0.12em] font-bold">
                    Salvage Reward
                  </div>
                  <div className="text-xl font-black font-mono text-emerald-400 mt-0.5">
                    ~{parseFloat(totalRecoverableSol.toFixed(4))} <span className="text-sm text-emerald-600">SOL</span>
                    {solPriceUsd && (
                      <span className="text-sm text-emerald-600/70 ml-2">
                        {formatUsd(totalRecoverableSol * solPriceUsd)}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-600 mt-0.5">
                    {canResolveScan
                      ? 'Select assets to route, burn, or close for net SOL recovery'
                      : isReadOnlyScan
                        ? 'Read-only scan only: connect the matching wallet before any asset can move'
                        : 'Connect the matching wallet to review and approve cleanup'}
                  </div>
                </div>
                <Flame className="h-8 w-8 text-emerald-600/40" />
              </div>
            )}

            {/* Metadata notice */}
            {missingImageCount > 0 && (
              <div className="blackhole-metadata-note">
                <span>
                  {missingImageCount} asset{missingImageCount === 1 ? '' : 's'} have no metadata image — no generated icons.
                </span>
              </div>
            )}

            {/* Controls */}
            <div className="blackhole-controls">
              <button
                type="button"
                onClick={() => fetchTokens(ownerPublicKey)}
                disabled={!ownerPublicKey || isLoading}
                className="blackhole-filter-tab blackhole-rescan-button"
              >
                {isLoading ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3 w-3" />
                )}
                Re-scan
              </button>

              {/* Quick Filters */}
              <div className="blackhole-filter-tabs" role="tablist" aria-label="Asset filter">
                {(['all', 'nft', 'token'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={assetFilter === f}
                    data-state={assetFilter === f ? 'active' : 'inactive'}
                    onClick={() => setAssetFilter(f)}
                    className="blackhole-filter-tab"
                  >
                    {f === 'all' ? 'All' : f === 'nft' ? 'NFTs' : 'Tokens'}
                  </button>
                ))}
              </div>
            </div>

            {/* ═══ Mobile Token List (< 640px) ═══ */}
            <div className="sm:hidden">
              {/* Header row — CSS grid for perfect alignment */}
              <div
                className="grid items-center rounded-lg bg-zinc-900/30 px-1 py-1 text-[10px] text-zinc-500"
                style={{ gridTemplateColumns: '28px minmax(0, 1fr) 46px 72px 46px' }}
              >
                <div className="flex items-center justify-center">
                  {canResolveScan ? (
                    <Checkbox
                      aria-label="Select all cleanup candidates"
                      checked={
                        selectableVisibleTokens.length > 0 && selectedVisibleCount === selectableVisibleTokens.length
                      }
                      onCheckedChange={selectAll}
                      disabled={selectableVisibleTokens.length === 0}
                      className="h-4 w-4 rounded-[12px] border-zinc-600 bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:bg-cyan-500/15 data-[state=checked]:text-cyan-300"
                    />
                  ) : resolvableVisibleTokens.length > 0 ? (
                    <Checkbox
                      aria-label="Connect matching wallet to select cleanup candidates"
                      checked={false}
                      disabled
                      className="h-4 w-4 rounded-[12px] border-zinc-700 bg-transparent opacity-50"
                    />
                  ) : (
                    <Shield className="h-3.5 w-3.5 text-zinc-700" aria-label="Protected assets only" />
                  )}
                </div>
                <span className="text-center">Asset</span>
                <span
                  className="text-center cursor-pointer hover:text-zinc-300 py-1.5 px-1"
                  onClick={() => handleSort('value')}
                >
                  Bal{sortField === 'value' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </span>
                <span
                  className="text-center cursor-pointer hover:text-zinc-300 py-1.5 px-1"
                  onClick={() => handleSort('return')}
                >
                  Return{sortField === 'return' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </span>
                <span
                  className="text-center cursor-pointer hover:text-zinc-300 py-1.5 px-1"
                  onClick={() => handleSort('status')}
                >
                  Status
                </span>
              </div>

              {visibleTokens.length === 0 ? (
                <div className="py-4 text-center text-zinc-600 text-sm">
                  {isLoading
                      ? `${scanStep}...`
                      : fetchError
                        ? 'Scan failed. Use Re-scan above to try again.'
                      : 'No assets found for this filter.'}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {paginatedTokens.map((token) => {
                    const key = token.pubkey.toBase58();
                    const plan = resolutionPlan[key];
                    const decision = getTokenDecision(token);
                    const selectable = isSelectableToken(token);
                    const selectionTarget = isResolvableSelectionTarget(token);
                    const netEst = selectedTokens.has(key) && plan ? plan.estimatedNetSol : (token.netGainSol ?? 0);
                     const rawName = getAssetDisplayName(token);
                     const displayName = rawName.length > 10 ? rawName.slice(0, 9) + '…' : rawName;
                     const StatusIcon = decision.icon;
                     const cachedImage = readBlackHoleImageCacheEntry(token.mint);
                     const imageFailed = failedImageMints.has(token.mint) || isBlackHoleImageFailureCoolingDown(token.mint);
                     const resolvedImage = imageFailed ? undefined : (cachedImage || token.image);
                     const metadataLoading = token.metadataPending || (!token.name && !token.symbol);
                     const floorLabel = getNftFloorLabel(token, solPriceUsd);
                     return (
                       <div
                         key={key}
                         className={`grid min-h-10 items-center rounded-lg border px-1 py-1 transition-colors ${
                           selectedTokens.has(key)
                             ? 'bg-cyan-950/15 border-cyan-900/30'
                             : selectable
                               ? 'bg-zinc-900/20 border-zinc-800/30 cursor-pointer'
                               : 'bg-zinc-950/35 border-zinc-800/35'
                          }`}
                          style={{ gridTemplateColumns: '28px minmax(0, 1fr) 46px 72px 46px' }}
                          onClick={() => selectable && toggleSelection(key)}
                        >
                          <div className="flex items-center justify-center" onClick={(event) => event.stopPropagation()}>
                            {canResolveScan ? (
                              <Checkbox
                                aria-label={`Select ${rawName}`}
                                checked={selectedTokens.has(key)}
                                onCheckedChange={() => toggleSelection(key)}
                                disabled={!selectable}
                                className="h-4 w-4 rounded-[12px] border-zinc-600 bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:bg-cyan-500/15 data-[state=checked]:text-cyan-300"
                              />
                           ) : selectionTarget ? (
                             <Checkbox
                               aria-label={`Connect matching wallet to select ${rawName}`}
                               checked={false}
                               disabled
                               className="h-4 w-4 rounded-[12px] border-zinc-700 bg-transparent opacity-50"
                             />
                           ) : (
                             <Shield className="h-3.5 w-3.5 text-zinc-500/80" aria-label={`${rawName} is protected`} />
                           )}
                         </div>
                        {/* Asset */}
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden pr-1">
                           {resolvedImage && !imageFailed ? (
                              <TokenAvatar
                                mint={token.mint}
                                imageUrl={resolvedImage}
                                alt={`${getAssetDisplayName(token)} icon`}
                                className="blackhole-token-avatar h-6 w-6 rounded-lg"
                                isNft={token.isNft}
                               onFail={() => {
                                 const coolingDown = recordBlackHoleImageFailure(token.mint);
                                 if (!coolingDown) return false;
                                 setFailedImageMints((prev) => {
                                   if (prev.has(token.mint)) return prev;
                                   const next = new Set(prev);
                                   next.add(token.mint);
                                   return next;
                                 });
                                 return true;
                               }}
                               onLoad={() => {
                                 writeBlackHoleImageCacheEntry(token.mint, resolvedImage);
                                 setFailedImageMints((prev) => {
                                   if (!prev.has(token.mint)) return prev;
                                   const next = new Set(prev);
                                   next.delete(token.mint);
                                   return next;
                                 });
                               }}
                             />
                           ) : (
                             <div
                               className="contents"
                             >
                              <GenericAssetAvatar
                                mint={token.mint}
                                isNft={token.isNft}
                                className="blackhole-token-avatar h-6 w-6 rounded-lg"
                                title={getTokenTooltip(token)}
                              />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium text-zinc-200 leading-none truncate">
                              {displayName}
                              {metadataLoading && (
                                <Loader2 className="ml-1 inline h-2.5 w-2.5 animate-spin text-zinc-500" aria-label="Loading metadata" />
                              )}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span
                                 className={`text-[7px] uppercase font-bold ${token.isNft ? 'text-purple-300' : token.programId.equals(TOKEN_2022_PROGRAM_ID) ? 'text-cyan-300' : 'text-zinc-500'}`}
                              >
                                {token.isNft ? 'NFT' : getTokenProgramLabel(token)}
                              </span>
                              <span className="text-[8px] text-zinc-600 font-mono">
                                {floorLabel ?? (formatSolCompact(token.valueSol) ? `${formatSolCompact(token.valueSol)}◎` : '')}
                              </span>
                            </div>
                          </div>
                        </div>
                        {/* Balance */}
                        <span className="text-[11px] font-mono text-zinc-400 text-center pr-1">
                          {token.uiAmount > 0 ? formatCompact(token.uiAmount) : '0'}
                        </span>
                        {/* Return */}
                        <div className="text-center">
                          <span
                            className={`text-[10px] font-mono block ${netEst >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}
                          >
                            {netEst >= 0 ? `+${parseFloat(netEst.toFixed(4))}` : parseFloat(netEst.toFixed(4))}
                          </span>
                        </div>
                        {/* Status */}
                        <div className="flex justify-center">
                          <StatusIcon
                            className={`h-3.5 w-3.5 ${
                              decision.label === 'Swap'
                                ? 'text-cyan-300'
                                : decision.label === 'Close'
                                  ? 'text-zinc-300'
                                  : decision.label === 'Protected'
                                    ? 'text-emerald-400'
                                    : decision.label === 'Quarantine'
                                      ? 'text-amber-400'
                                      : 'text-red-400/70'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ═══ Desktop Token Table (≥ 640px) ═══ */}
            <div className="hidden sm:block rounded-xl border border-zinc-800/50 bg-zinc-950/40 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-zinc-800/50">
                    <TableHead className="w-7 min-w-7 max-w-7 px-0 text-center align-middle">
                      <div className="flex items-center justify-center">
                        {canResolveScan ? (
                          <Checkbox
                            checked={
                              selectableVisibleTokens.length > 0 &&
                              selectedVisibleCount === selectableVisibleTokens.length
                            }
                            onCheckedChange={selectAll}
                            disabled={selectableVisibleTokens.length === 0}
                            className="h-4 w-4 rounded-[12px] border-zinc-600 bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:bg-cyan-500/15 data-[state=checked]:text-cyan-300"
                          />
                        ) : resolvableVisibleTokens.length > 0 ? (
                          <Checkbox
                            aria-label="Connect matching wallet to select cleanup candidates"
                            checked={false}
                            disabled
                            className="h-4 w-4 rounded-[12px] border-zinc-700 bg-transparent opacity-50"
                          />
                        ) : (
                          <Shield className="h-3.5 w-3.5 text-zinc-500/80" aria-label="Protected assets only" />
                        )}
                      </div>
                    </TableHead>
                    <TableHead className="text-left text-zinc-500 text-xs w-[180px] min-w-[180px]">Asset</TableHead>
                    <TableHead className="text-center text-zinc-500 text-xs whitespace-nowrap">Balance</TableHead>
                    <TableHead
                      className="text-center text-zinc-500 text-xs whitespace-nowrap cursor-pointer select-none hover:text-zinc-300 transition-colors"
                      onClick={() => handleSort('value')}
                    >
                      Value {sortField === 'value' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </TableHead>
                    <TableHead
                      className="text-center text-zinc-500 text-xs whitespace-nowrap cursor-pointer select-none hover:text-zinc-300 transition-colors"
                      onClick={() => handleSort('return')}
                    >
                      Return {sortField === 'return' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </TableHead>
                    <TableHead
                      className="text-center text-zinc-500 text-xs whitespace-nowrap cursor-pointer select-none hover:text-zinc-300 transition-colors"
                      onClick={() => handleSort('status')}
                    >
                      Status {sortField === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTokens.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-20 text-center text-zinc-600 text-sm">
                        {isLoading
                          ? `${scanStep}...`
                          : fetchError
                            ? 'Scan failed. Use Re-scan above to try again.'
                            : 'No assets found for this filter.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedTokens.map((token) => {
                      const key = token.pubkey.toBase58();
                      const plan = resolutionPlan[key];
                      const decision = getTokenDecision(token);
                      const selectable = isSelectableToken(token);
                      const selectionTarget = isResolvableSelectionTarget(token);
                      const StatusIcon = decision.icon;
                      const cachedImage = readBlackHoleImageCacheEntry(token.mint);
                      const imageFailed = failedImageMints.has(token.mint) || isBlackHoleImageFailureCoolingDown(token.mint);
                      const resolvedImage = imageFailed ? undefined : (cachedImage || token.image);
                      const metadataLoading = token.metadataPending || (!token.name && !token.symbol);
                      const floorLabel = getNftFloorLabel(token, solPriceUsd);
                      const netEst = selectedTokens.has(key) && plan ? plan.estimatedNetSol : (token.netGainSol ?? 0);
                      return (
                        <TableRow key={key} className="h-[58px] border-zinc-800/40 hover:bg-zinc-900/40">
                          <TableCell className="w-7 min-w-7 max-w-7 px-0 py-2 align-middle text-center">
                            <div className="flex items-center justify-center">
                              {canResolveScan ? (
                                <Checkbox
                                  checked={selectedTokens.has(key)}
                                  onCheckedChange={() => toggleSelection(key)}
                                  disabled={!selectable}
                                  className="h-4 w-4 rounded-[12px] border-zinc-600 bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:bg-cyan-500/15 data-[state=checked]:text-cyan-300"
                                />
                              ) : selectionTarget ? (
                                <Checkbox
                                  aria-label={`Connect matching wallet to select ${getAssetDisplayName(token)}`}
                                  checked={false}
                                  disabled
                                  className="h-4 w-4 rounded-[12px] border-zinc-700 bg-transparent opacity-50"
                                />
                              ) : (
                                <Shield className="h-3.5 w-3.5 text-zinc-700" aria-label={`${getAssetDisplayName(token)} is protected`} />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="w-[180px] min-w-[180px] py-2 align-middle text-left">
                            <div className="flex items-center gap-2">
                              {resolvedImage && !imageFailed ? (
                                <TokenAvatar
                                  mint={token.mint}
                                  imageUrl={resolvedImage}
                                  alt={`${getAssetDisplayName(token)} icon`}
                                  className="blackhole-token-avatar h-7 w-7 rounded-lg"
                                  isNft={token.isNft}
                                  onFail={() => {
                                    const coolingDown = recordBlackHoleImageFailure(token.mint);
                                    if (!coolingDown) return false;
                                    setFailedImageMints((prev) => {
                                      if (prev.has(token.mint)) return prev;
                                      const next = new Set(prev);
                                      next.add(token.mint);
                                      return next;
                                    });
                                    return true;
                                  }}
                                  onLoad={() => {
                                    writeBlackHoleImageCacheEntry(token.mint, resolvedImage);
                                    setFailedImageMints((prev) => {
                                      if (!prev.has(token.mint)) return prev;
                                      const next = new Set(prev);
                                      next.delete(token.mint);
                                      return next;
                                    });
                                  }}
                                />
                              ) : (
                                <div
                                  className="contents"
                                >
                                  <GenericAssetAvatar
                                    mint={token.mint}
                                    isNft={token.isNft}
                                    className="blackhole-token-avatar h-7 w-7 rounded-lg"
                                    title={getTokenTooltip(token)}
                                  />
                                </div>
                              )}
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="font-medium text-zinc-200 text-[12px] leading-tight truncate max-w-[90px]">
                                    {getAssetDisplayName(token)}
                                  </span>
                                  {metadataLoading && (
                                    <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-zinc-500" aria-label="Loading metadata" />
                                  )}
                                  <span
                                    className={`text-[8px] px-1 py-px rounded leading-none shrink-0 ${token.isNft ? 'bg-purple-900/30 text-purple-400' : token.programId.equals(TOKEN_2022_PROGRAM_ID) ? 'bg-cyan-950/40 text-cyan-300' : 'bg-zinc-800/60 text-zinc-500'}`}
                                  >
                                    {token.isNft ? 'NFT' : getTokenProgramLabel(token)}
                                  </span>
                                  {token.isNft && (
                                    <>
                                      <a
                                        href={token.meUrl || `https://magiceden.io/item-details/${token.mint}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[9px] text-purple-500/70 hover:text-purple-400 transition-colors shrink-0"
                                        onClick={(e) => e.stopPropagation()}
                                        title="Magic Eden"
                                      >
                                        ME
                                      </a>
                                      {token.tensorUrl && (
                                        <a
                                          href={token.tensorUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-[9px] text-blue-500/70 hover:text-blue-400 transition-colors shrink-0"
                                          onClick={(e) => e.stopPropagation()}
                                          title="Tensor"
                                        >
                                          T
                                        </a>
                                      )}
                                    </>
                                  )}
                                </div>
                                <span className="text-[10px] text-zinc-600 font-mono">
                                  {token.symbol ? `${token.symbol} · ` : ''}
                                  {token.mint.slice(0, 4)}...{token.mint.slice(-4)}
                                  {token.isNft && token.collectionName ? ` · ${token.collectionName}` : ''}
                                  {floorLabel ? ` · ${floorLabel}` : ''}
                                </span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap py-2 text-center font-mono text-sm text-zinc-400">
                            {token.uiAmount > 0 ? formatCompact(token.uiAmount) : '0'}
                          </TableCell>
                          <TableCell className="max-w-[90px] whitespace-nowrap py-2 text-center text-sm">
                            <div className="flex flex-col items-center leading-tight">
                              <span className="font-mono text-zinc-300 text-[12px]">
                                {formatSolCompact(token.valueSol) ??
                                  (token.priceUsd != null ? formatUsd(token.priceUsd) : '—')}
                              </span>
                              {token.valueSol != null && token.valueSol > 0 && (
                                <span className="text-[9px] text-zinc-600">SOL</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-center text-sm font-mono">
                            <span className={netEst >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}>
                              {netEst >= 0 ? `+${parseFloat(netEst.toFixed(4))}` : parseFloat(netEst.toFixed(4))}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${decision.className}`}
                              >
                                <StatusIcon className="h-2.5 w-2.5" /> {decision.label}
                              </span>
                              <span className="text-[9px] text-zinc-600 max-w-[120px] leading-tight">
                                {decision.detail}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="blackhole-pagination" aria-label="Asset pagination">
              <div className="blackhole-per-page">
                <span>Per page</span>
                <div className="blackhole-page-select-wrap" onBlur={() => setPerPageMenuOpen(false)}>
                  <button
                    type="button"
                    className="blackhole-page-select"
                    aria-label="Rows per page"
                    aria-haspopup="listbox"
                    aria-expanded={perPageMenuOpen}
                    onClick={() => setPerPageMenuOpen((open) => !open)}
                  >
                    {perPage}
                  </button>
                  {perPageMenuOpen && (
                    <div className="blackhole-page-select-menu" role="listbox" aria-label="Rows per page options">
                    {PER_PAGE_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={perPage === option}
                        className="blackhole-page-select-item"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setPerPage(option);
                          setPerPageMenuOpen(false);
                        }}
                      >
                        {option}
                      </button>
                    ))}
                    </div>
                  )}
                </div>
              </div>
              {showPagination && (
                <div className="blackhole-page-nav">
                  <button
                    type="button"
                    className="blackhole-page-button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1}
                  >
                    ‹ Prev
                  </button>
                  <span className="blackhole-page-status">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="blackhole-page-button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={page >= totalPages}
                  >
                    Next ›
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Sonner
        position="bottom-center"
        expand={false}
        closeButton
        offset={{ bottom: 16 }}
        mobileOffset={{ bottom: 12, left: 16, right: 16 }}
      />
    </div>
  );
};

export default BlackHole;
