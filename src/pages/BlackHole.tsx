import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
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
} from '@solana/spl-token';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { toast, Toaster as Sonner } from 'sonner';
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
import { api } from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type AssetStatus = 'protected' | 'valuable' | 'burnable';
type ResolutionAction = 'swap' | 'burn' | 'close' | 'skip';

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
  marketSource?: 'magic_eden' | 'tensor' | null;
  marketFloorSol?: number | null;
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
}

interface MarketStats {
  status: 'listed' | 'not_listed' | 'unknown';
  floorSol?: number | null;
  source?: 'magic_eden' | 'tensor';
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
    const response = await fetch(url.toString());
    if (!response.ok) {
      return { status: 'unknown' };
    }
    const data = await response.json();
    const status = data?.status === 'listed' || data?.status === 'not_listed' ? data.status : 'unknown';
    const floorSol = parseNumber(data?.floorSol);
    const source = data?.source === 'magic_eden' || data?.source === 'tensor' ? data.source : undefined;
    return { status, floorSol, source, tensorUrl: data?.tensorUrl ?? null, meUrl: data?.meUrl ?? null };
  } catch {
    return { status: 'unknown' };
  }
};

const fetchSolPriceUsd = async (proxyBase: string | null) => {
  if (!proxyBase) return null;
  try {
    const response = await fetch(`${proxyBase}/api/market/sol-price`);
    if (!response.ok) return null;
    const data = await response.json();
    return parseNumber(data?.solana?.usd) ?? parseNumber(data?.usd) ?? parseNumber(data?.price) ?? null;
  } catch {
    return null;
  }
};

const fetchFallbackPrices = async (mints: string[]): Promise<Map<string, number>> => {
  const prices = new Map<string, number>();
  if (mints.length === 0) return prices;

  // 1) DexScreener — free, no auth, max ~30 addresses per request
  try {
    for (let i = 0; i < mints.length; i += 30) {
      const batch = mints.slice(i, i + 30);
      const url = `https://api.dexscreener.com/tokens/v1/solana/${batch.join(',')}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const pair of data) {
          const mint = pair.baseToken?.address;
          const p = parseFloat(pair.priceUsd);
          if (mint && !isNaN(p) && p > 0 && !prices.has(mint)) {
            prices.set(mint, p);
          }
        }
      }
    }
  } catch {
    /* empty */
  }

  // 2) Raydium fallback for anything DexScreener missed
  const remaining = mints.filter((m) => !prices.has(m));
  if (remaining.length > 0) {
    try {
      const RAYDIUM_BATCH = 100;
      for (let i = 0; i < remaining.length; i += RAYDIUM_BATCH) {
        const batch = remaining.slice(i, i + RAYDIUM_BATCH);
        const url = `https://api-v3.raydium.io/mint/price?mints=${batch.join(',')}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        const data = json?.data;
        if (data && typeof data === 'object') {
          for (const [mint, priceStr] of Object.entries(data) as [string, unknown][]) {
            const p = parseFloat(priceStr);
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
    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const data = await response.json();
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
  const response = await fetch(`${base}/api/market/build-swap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ userPublicKey, quoteResponse }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.swapTransaction) {
    throw new Error(payload?.error || 'Failed to build swap transaction');
  }
  return payload as PreparedSwapTransaction;
};

const executeSwapTransaction = async (signedTransaction: string, requestId: string) => {
  const jwt = await ensureJwt();
  if (!jwt) throw new Error('Wallet authorization required');
  const base = getApiBase();
  const response = await fetch(`${base}/api/market/execute-swap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ signedTransaction, requestId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.signature) {
    throw new Error(payload?.error || 'Failed to execute swap transaction');
  }
  return payload as { signature: string; status?: string };
};

const claimBlackHoleReward = async (operations: ResolutionOperation[]) => {
  if (operations.length === 0) return { earned: 0 };
  const jwt = await ensureJwt();
  if (!jwt) return { earned: 0 };
  const base = getApiBase();
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
  if (netResolvedSol <= 0) return 0;
  return Math.min(
    BLACKHOLE_PRISM_REWARD_CAP,
    fungibleResolved * 8 + nftResolved * 15 + Math.floor(netResolvedSol / 0.001) * 8,
  );
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
  if (token.isNft && token.marketStatus === 'listed') {
    return { status: 'protected', reason: 'Listed on marketplace' };
  }
  if (token.isNft && token.marketFloorSol && token.marketFloorSol > 0.1) {
    return { status: 'valuable', reason: `Floor ~${token.marketFloorSol.toFixed(2)} SOL` };
  }
  if (token.valueSol !== null && token.valueSol !== undefined && token.valueSol > VALUE_THRESHOLD_SOL) {
    return { status: 'valuable', reason: `Worth ~${token.valueSol.toFixed(4)} SOL` };
  }
  return { status: 'burnable' };
};

const BlackHole = () => {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, signTransaction, sendTransaction } = wallet;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    setAuthWallet(wallet);
  }, [wallet]);

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
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [incinerationTokens, setIncinerationTokens] = useState<IncinerationToken[]>([]);
  const [_wormholeBack, _setWormholeBack] = useState(false);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const collectionMarketCache = useRef(new Map<string, MarketStats>());
  const lastOwnerRef = useRef<string | null>(null);
  const addressErrorShown = useRef(false);
  const connectionRef = useRef(connection);
  const publicKeyRef = useRef(publicKey);
  connectionRef.current = connection;
  publicKeyRef.current = publicKey;
  const addressParam = searchParams.get('address');
  const [ownerPublicKey, setOwnerPublicKey] = useState<PublicKey | null>(publicKey ?? null);
  const [sortField, setSortField] = useState<'value' | 'return' | 'status' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [assetFilter, setAssetFilter] = useState<'all' | 'nft' | 'token'>('all');
  const swapQuoteCache = useRef(new Map<string, SwapQuoteResult | null>());
  const [resolutionPlan, setResolutionPlan] = useState<Record<string, ResolutionPlanItem>>({});
  const [isPlanning, setIsPlanning] = useState(false);

  const isSelectableToken = useCallback((token: TokenAccount) => {
    if (token.closeable === false || token.assetStatus === 'protected') return false;
    if (token.isNft && token.assetStatus === 'valuable') return false;
    return true;
  }, []);

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
    if (!addressParam) {
      setOwnerPublicKey(null);
      return;
    }
    try {
      setOwnerPublicKey(new PublicKey(addressParam));
    } catch {
      setOwnerPublicKey(null);
      if (!addressErrorShown.current) {
        addressErrorShown.current = true;
        toast.error('Invalid address in link');
      }
    }
  }, [publicKey, addressParam]);

  useEffect(() => {
    swapQuoteCache.current.clear();
    setResolutionPlan({});
  }, [ownerPublicKey?.toBase58(), publicKey?.toBase58()]);

  useEffect(() => {
    if (incinerationTokens.length === 0) return;
    const timeout = window.setTimeout(() => {
      setIncinerationTokens([]);
    }, 3600);
    return () => window.clearTimeout(timeout);
  }, [incinerationTokens.length]);

  const getVisibleTokens = useCallback(
    (list: TokenAccount[] = tokens, showAll = showAllAssets) => {
      let closeable = list.filter((token) => token.closeable !== false);
      if (!showAll) closeable = closeable.filter((token) => token.isCandidate);
      if (assetFilter === 'nft') closeable = closeable.filter((token) => token.isNft);
      else if (assetFilter === 'token') closeable = closeable.filter((token) => !token.isNft);
      return closeable;
    },
    [showAllAssets, tokens, assetFilter],
  );

  // Total recoverable SOL from all burnable tokens (shown at top before selection)
  const totalRecoverableSol = useMemo(() => {
    return tokens
      .filter((t) => t.closeable !== false && t.assetStatus === 'burnable')
      .reduce((sum, t) => sum + (t.rentSol || 0), 0);
  }, [tokens]);

  const cancelledRef = useRef(false);

  const fetchTokens = useCallback(async (owner?: PublicKey | null) => {
    const targetOwner = owner ?? publicKeyRef.current;
    if (!targetOwner) return;

    setIsLoading(true);
    setSelectedTokens(new Set());

    let fetchStep = 'init';
    try {
      fetchStep = 'getParsedTokenAccounts';
      const conn = connectionRef.current;
      const [splTokens, token2022Tokens] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(targetOwner, { programId: TOKEN_PROGRAM_ID }),
        conn.getParsedTokenAccountsByOwner(targetOwner, { programId: TOKEN_2022_PROGRAM_ID }),
      ]);

      const parsedTokens: TokenAccount[] = [
        ...splTokens.value.map((item) => {
          const info = item.account.data.parsed.info;
          const isFrozen = info.state === 'frozen';
          return {
            pubkey: item.pubkey,
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
        ...token2022Tokens.value.map((item) => {
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
            pubkey: item.pubkey,
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

      fetchStep = 'fetchSolPrice';
      const proxyBase = getHeliusProxyUrl();
      const solUsd = await fetchSolPriceUsd(proxyBase);
      setSolPriceUsd(solUsd);

      fetchStep = 'getAssetBatch';
      const heliusUrl = getHeliusRpcUrl(targetOwner.toBase58());
      let resolvedCommissionRate = COMMISSION_RATE_DEFAULT;
      if (heliusUrl && parsedTokens.length > 0) {
        const mints = [...new Set(parsedTokens.map((t) => t.mint))];
        const BATCH_SIZE = 100;
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
          }
        >();

        for (let i = 0; i < mints.length; i += BATCH_SIZE) {
          const batch = mints.slice(i, i + BATCH_SIZE);
          try {
            const dasResponse = await fetch(heliusUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'blackhole-metadata',
                method: 'getAssetBatch',
                params: { ids: batch },
              }),
            });

            const data = await dasResponse.json();
            if (data.result) {
              data.result.forEach((asset: Record<string, unknown>) => {
                if (!asset) return;
                const content = (asset.content as Record<string, unknown>) || {};
                const metadata = (content.metadata as Record<string, unknown>) || {};
                const grouping = (asset.grouping as Record<string, unknown>[]) || [];
                const collectionGroup = grouping.find((group) => group.group_key === 'collection');
                const collectionMeta = collectionGroup?.collection_metadata || {};
                const tokenInfo = asset.token_info || {};
                const priceInfo = tokenInfo.price_info || {};
                const decimals = tokenInfo.decimals ?? null;
                const supply = parseNumber(tokenInfo.supply);
                const iface = String(asset.interface || '').toUpperCase();
                const isNft =
                  iface.includes('NFT') ||
                  iface.includes('PROGRAMMABLE') ||
                  asset.compression?.compressed === true ||
                  (decimals === 0 && (supply === 1 || supply === null));

                const priceUsd =
                  parseNumber(priceInfo.price_per_token ?? priceInfo.price_per_token_usd) ??
                  parseNumber(priceInfo.floor_price ?? priceInfo.floorPrice ?? priceInfo.price) ??
                  null;

                const hasCollection = !!collectionGroup?.group_value;
                metadataMap.set(asset.id, {
                  name: metadata.name || content.json_uri?.split('/').pop(),
                  symbol: metadata.symbol,
                  image: content.links?.image || content.files?.[0]?.uri,
                  isNft,
                  collectionId: hasCollection ? collectionGroup.group_value : undefined,
                  collectionName: hasCollection ? collectionMeta.name || metadata.name : undefined,
                  collectionSymbol: hasCollection ? collectionMeta.symbol || metadata.symbol : undefined,
                  priceUsd,
                });
              });
            }
          } catch {
            // silently ignore metadata batch errors
          }
        }

        parsedTokens.forEach((t) => {
          const meta = metadataMap.get(t.mint);
          if (!meta) return;
          t.name = meta.name;
          t.symbol = meta.symbol;
          t.image = meta.image;
          t.isNft = meta.isNft;
          t.collectionId = meta.collectionId;
          t.collectionName = meta.collectionName;
          t.collectionSymbol = meta.collectionSymbol;
          t.priceUsd = meta.priceUsd ?? null;
        });

        // Resolve holder perks from the backend first so fee UX matches server verification.
        let ownsCard = false;
        resolvedCommissionRate = COMMISSION_RATE_DEFAULT;
        let resolvedHolderCommissionRate = COMMISSION_RATE_MINTED;
        let resolvedStandardCommissionRate = COMMISSION_RATE_DEFAULT;
        let perksFetched = false;

        try {
          const perks = await api.getIdentityPerks(targetOwner.toBase58());
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
                const dasSearch = await fetch(heliusUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'check-prism-card',
                    method: 'searchAssets',
                    params: {
                      ownerAddress: targetOwner.toBase58(),
                      grouping: ['collection', ourCollection],
                      page: 1,
                      limit: 1,
                    },
                  }),
                });
                const dasData = await dasSearch.json();
                ownsCard = (dasData?.result?.total ?? 0) > 0;
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
          const perks = await api.getIdentityPerks(targetOwner.toBase58());
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

      fetchStep = 'jupiterPriceFallback';
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

      fetchStep = 'collectionMarketStats';
      const collectionLookups = new Map<
        string,
        { symbol?: string; collectionId?: string; collectionName?: string; sampleMint?: string }
      >();
      parsedTokens
        .filter((token) => token.isNft && token.collectionId)
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
          token.marketStatus = stats?.status ?? 'unknown';
          token.marketFloorSol = stats?.floorSol ?? null;
          token.marketSource = stats?.source ?? null;
          token.tensorUrl = stats?.tensorUrl ?? null;
          token.meUrl = stats?.meUrl ?? null;
        });
      } else {
        parsedTokens.forEach((token) => {
          if (token.isNft) token.marketStatus = 'unknown';
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
              const isUnnamed = !token.symbol && !token.name;
              token.isCandidate = isDust || isUnnamed;
            }
          }
        }
      });

      parsedTokens.sort((a, b) => {
        const aCandidate = a.isCandidate ? 0 : 1;
        const bCandidate = b.isCandidate ? 0 : 1;
        if (aCandidate !== bCandidate) return aCandidate - bCandidate;
        if (a.uiAmount === 0 && b.uiAmount > 0) return -1;
        if (a.uiAmount > 0 && b.uiAmount === 0) return 1;
        return 0;
      });

      if (cancelledRef.current) return;
      setTokens(parsedTokens);
      toast.success(`Found ${parsedTokens.length} token accounts`);
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      console.error(`[BlackHole] fetchTokens error at step "${fetchStep}":`, err);
      toast.error(`Failed to fetch tokens (${fetchStep}): ${(err as Error)?.message ?? String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ownerBase58 = ownerPublicKey?.toBase58() ?? null;
    if (!ownerBase58 || lastOwnerRef.current === ownerBase58) return;
    lastOwnerRef.current = ownerBase58;
    cancelledRef.current = false;
    fetchTokens(ownerPublicKey);
    return () => {
      cancelledRef.current = true;
    };
  }, [ownerPublicKey, fetchTokens]);

  useEffect(() => {
    const selected = tokens.filter((token) => selectedTokens.has(token.pubkey.toBase58()));
    if (selected.length === 0) {
      setResolutionPlan({});
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

        if (token.assetStatus === 'burnable' && closeNet >= MIN_NET_RETURN_SOL) {
          nextPlan[key] = {
            token,
            action: 'burn',
            reason: quote
              ? 'Burn beats the current swap route after fees'
              : 'No route found — burn is the best recovery path',
            estimatedNetSol: closeNet,
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
            reason: `Valuable token — route available for ~${swapNet.toFixed(4)} SOL net`,
            estimatedNetSol: swapNet,
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
        setResolutionPlan(nextPlan);
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

  const handleShowAllToggle = (value: boolean | 'indeterminate') => {
    const next = Boolean(value);
    setShowAllAssets(next);
    if (!next) {
      const candidateKeys = new Set(
        tokens.filter((token) => token.isCandidate && isSelectableToken(token)).map((token) => token.pubkey.toBase58()),
      );
      setSelectedTokens((prev) => new Set([...prev].filter((key) => candidateKeys.has(key))));
    }
  };

  const waitForSignatureConfirmation = useCallback(
    async (signature: string, label: string) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const status = await connection.getSignatureStatus(signature);
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

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = publicKey;

      try {
        const simulation = await connection.simulateTransaction(tx, undefined, {
          sigVerify: false,
          replaceRecentBlockhash: true,
        });
        if (simulation.value.err) {
          throw new Error(`${label} simulation failed: ${JSON.stringify(simulation.value.err)}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('simulation failed')) throw error;
        console.warn(`[BlackHole] ${label} simulation skipped`, error);
      }

      const origSerialize = tx.serialize.bind(tx);
      tx.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
        origSerialize({
          ...config,
          requireAllSignatures: false,
          verifySignatures: false,
        })) as typeof tx.serialize;

      const signPromise = signTransaction
        ? signTransaction(tx).then(async (signed) =>
            connection.sendRawTransaction(
              (signed as Transaction).serialize({ requireAllSignatures: false, verifySignatures: false }),
              { skipPreflight: true, preflightCommitment: 'confirmed' },
            ),
          )
        : sendTransaction(tx, connection, { skipPreflight: true, preflightCommitment: 'confirmed' });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Wallet signing timed out — please approve or reject in your wallet')),
          30_000,
        ),
      );
      const signature = await Promise.race([signPromise, timeoutPromise]);
      await waitForSignatureConfirmation(signature, label);
      return signature;
    },
    [connection, publicKey, sendTransaction, signTransaction, waitForSignatureConfirmation],
  );

  const signAndSendVersionedTransaction = useCallback(
    async (tx: VersionedTransaction, label: string) => {
      try {
        const simulation = await connection.simulateTransaction(tx, {
          sigVerify: false,
          replaceRecentBlockhash: true,
        });
        if (simulation.value.err) {
          throw new Error(`${label} simulation failed: ${JSON.stringify(simulation.value.err)}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('simulation failed')) throw error;
        console.warn(`[BlackHole] ${label} simulation skipped`, error);
      }

      const signPromise = signTransaction
        ? signTransaction(tx).then(async (signed) =>
            connection.sendRawTransaction((signed as VersionedTransaction).serialize(), {
              skipPreflight: true,
              preflightCommitment: 'confirmed',
            }),
          )
        : sendTransaction(tx, connection, { skipPreflight: true, preflightCommitment: 'confirmed' });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Wallet signing timed out — please approve or reject in your wallet')),
          30_000,
        ),
      );
      const signature = await Promise.race([signPromise, timeoutPromise]);
      await waitForSignatureConfirmation(signature, label);
      return signature;
    },
    [connection, sendTransaction, signTransaction, waitForSignatureConfirmation],
  );

  const signAndExecuteOrderedTransaction = useCallback(
    async (tx: VersionedTransaction, requestId: string, label: string) => {
      try {
        const simulation = await connection.simulateTransaction(tx, {
          sigVerify: false,
          replaceRecentBlockhash: true,
        });
        if (simulation.value.err) {
          throw new Error(`${label} simulation failed: ${JSON.stringify(simulation.value.err)}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('simulation failed')) throw error;
        console.warn(`[BlackHole] ${label} simulation skipped`, error);
      }

      if (!signTransaction) {
        throw new Error('Current wallet does not support direct transaction signing for Jupiter execution');
      }

      const signPromise = signTransaction(tx).then((signed) =>
        executeSwapTransaction(encodeVersionedTransaction(signed as VersionedTransaction), requestId),
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Wallet signing timed out — please approve or reject in your wallet')),
          30_000,
        ),
      );
      const result = await Promise.race([signPromise, timeoutPromise]);
      await waitForSignatureConfirmation(result.signature, label);
      return result.signature;
    },
    [connection, signTransaction, waitForSignatureConfirmation],
  );

  const handleIncinerate = async () => {
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
      const burnPlans = executablePlans.filter((plan) => plan.action === 'burn');
      const closePlans = executablePlans.filter((plan) => plan.action === 'close');
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
        description: `${swapPlans.length} swap · ${burnPlans.length} burn · ${closePlans.length} close · ~${estimatedNetSol.toFixed(4)} SOL · ~${estimatedReward} PRISM`,
      });

      const operationMap = new Map<string, ResolutionOperation>();
      const isTreasury = publicKey.toBase58() === TREASURY_ADDRESS;
      const createBatches = (plans: ResolutionPlanItem[], mode: 'burn' | 'close') => {
        const perTx = mode === 'burn' ? 6 : 10;
        const chunks: ResolutionPlanItem[][] = [];
        for (let i = 0; i < plans.length; i += perTx) {
          chunks.push(plans.slice(i, i + perTx));
        }

        return chunks.map((chunk) => {
          const tx = new Transaction();
          tx.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: mode === 'burn' ? 240_000 : 180_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }),
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

      for (let index = 0; index < swapPlans.length; index += 1) {
        const plan = swapPlans[index];
        if (publicKey.toBase58() !== initialWallet) {
          throw new Error('Wallet changed — remaining transactions cancelled');
        }
        if (!plan.swapQuote?.quoteResponse) {
          throw new Error(
            `Missing swap route for ${plan.token.name || plan.token.symbol || plan.token.mint.slice(0, 6)}`,
          );
        }

        toast.info(`Swap ${index + 1}/${swapPlans.length}`, {
          description: `${plan.token.name || plan.token.symbol || plan.token.mint.slice(0, 6)} → SOL`,
        });

        const preparedSwap = await buildSwapTransaction(publicKey.toBase58(), plan.swapQuote.quoteResponse);
        const { swapTransaction } = preparedSwap;
        const versionedTx = decodeVersionedTransaction(swapTransaction);
        if (preparedSwap.transport === 'order_execute' && !preparedSwap.requestId) {
          throw new Error('Missing Jupiter requestId for swap execution');
        }
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
      }

      const burnBatches = createBatches(burnPlans, 'burn');
      for (let index = 0; index < burnBatches.length; index += 1) {
        const batch = burnBatches[index];
        const signature = await signAndSendLegacyTransaction(batch.tx, `Burn batch ${index + 1}/${burnBatches.length}`);
        batch.chunk.forEach((plan) => {
          operationMap.set(plan.token.pubkey.toBase58(), {
            account: plan.token.pubkey.toBase58(),
            mint: plan.token.mint,
            action: 'burn',
            closeSignature: signature,
          });
        });
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
      toast.success('Resolution complete!', {
        description: `Resolved ${resolvedCount} asset${resolvedCount === 1 ? '' : 's'} · ~${(claimedNetResolvedSol || estimatedNetSol).toFixed(4)} SOL · ${earnedPrism} PRISM`,
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
  const selectedVisibleCount = useMemo(
    () => selectableVisibleTokens.filter((token) => selectedTokens.has(token.pubkey.toBase58())).length,
    [selectableVisibleTokens, selectedTokens],
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

  const handleReturnToCard = useCallback(() => {
    if (returning) return;
    setReturning(true);

    const addr = ownerPublicKey?.toBase58() ?? addressParam ?? '';
    const target = addr ? `/app?address=${encodeURIComponent(addr)}` : '/app';
    startFadeTransition(() => {
      sessionStorage.setItem('fromBlackHole', '1');
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
    <div className={`identity-shell blackhole-shell ${returning ? 'bh-returning' : ''}`}>
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
        <p className="blackhole-hero__sub">Resolve junk assets &middot; Route value into SOL &middot; Earn PRISM</p>

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
          onClick={handleReturnToCard}
          role="button"
          tabIndex={0}
          aria-label="Return to card"
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
          <div className="bh-return-hint">Return</div>
        </div>
      </div>

      {/* ══ Content below the black hole ══ */}
      <div className="blackhole-content">
        {/* If no wallet and no address param — show connect prompt */}
        {!ownerPublicKey ? (
          <div className="blackhole-panel flex flex-col items-center gap-6 py-12 text-center">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.15em] text-red-400/50 font-bold">
                Mission Available
              </span>
            </div>
            <p className="text-zinc-400 text-sm max-w-md leading-relaxed">
              Your wallet is contaminated with dust tokens and abandoned NFTs.
              <br />
              Connect to scan the threat level, route what still has value, and purge the rest for SOL salvage.
            </p>
            <WalletMultiButton className="!bg-gradient-to-r !from-red-600 !to-orange-600 hover:!from-red-500 hover:!to-orange-500 !rounded-xl !h-12 !px-8 !text-base !font-bold !shadow-lg !shadow-red-900/30" />
            <p className="text-zinc-600 text-xs">
              Protected assets (Seeker, Identity Prism, blue chips) are shielded automatically.
            </p>
          </div>
        ) : (
          <div className="blackhole-panel space-y-6">
            {/* Mission Status Header */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pb-4 border-b border-red-500/[0.08]">
              <div className="text-center sm:text-left max-w-lg">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  <span className="text-[10px] uppercase tracking-[0.12em] text-red-400/50 font-bold">
                    Active Mission
                  </span>
                </div>
                <p className="text-zinc-500 text-sm leading-relaxed">
                  Scan for contamination — dust tokens and dead NFTs locking your SOL. Black Hole now routes swappable
                  fungibles into SOL, burns only when that is the better path, and quarantines protected assets.
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
                      Salvage fee: {(standardCommissionRate * 100).toFixed(0)}% ·{' '}
                      <span className="text-cyan-400/70">
                        Mint Identity Prism ID for only {(holderCommissionRate * 100).toFixed(0)}%
                      </span>
                    </span>
                  )}
                </p>
              </div>
              <WalletMultiButton className="!bg-zinc-900/80 !border !border-zinc-800 hover:!bg-zinc-800 !rounded-xl !h-10 !text-sm shrink-0 hidden sm:inline-flex" />
            </div>

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
            {selectedTokens.size > 0 && (
              <div className="bg-gradient-to-r from-red-950/30 to-zinc-900/40 border border-red-900/20 rounded-xl p-3 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Flame className="w-3.5 h-3.5 text-red-400/60" />
                  <span className="text-[10px] uppercase tracking-[0.12em] text-red-400/50 font-bold">
                    Resolution Manifest
                  </span>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 sm:gap-4 text-center">
                    <div>
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Resolved</div>
                      <div className="text-lg font-bold text-red-400 mt-1">{summary.totalAccounts}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Swap</div>
                      <div className="text-lg font-bold text-cyan-300 mt-1">{summary.swapCount}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Burn</div>
                      <div className="text-lg font-bold text-orange-300 mt-1">{summary.burnCount}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Close</div>
                      <div className="text-lg font-bold text-zinc-200 mt-1">{summary.closeCount}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Skipped</div>
                      <div className="text-lg font-bold text-zinc-500 mt-1">{summary.skippedCount}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Rent</div>
                      <div className="text-lg font-bold font-mono text-zinc-200 mt-1">
                        {parseFloat(summary.grossReclaim.toFixed(4))} <span className="text-xs text-zinc-500">SOL</span>
                      </div>
                    </div>
                    {summary.totalValueLost > 0.001 && (
                      <div className="bg-red-950/30 rounded-lg p-2">
                        <div className="text-[11px] text-red-400 uppercase tracking-wider flex items-center justify-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Value Lost
                        </div>
                        <div className="text-lg font-bold font-mono text-red-400 mt-1">
                          ~{parseFloat(summary.totalValueLost.toFixed(4))} <span className="text-xs">SOL</span>
                        </div>
                        {solPriceUsd && (
                          <div className="text-[11px] text-red-500/70">
                            {formatUsd(summary.totalValueLost * solPriceUsd)}
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider">
                        Fee ({(commissionRate * 100).toFixed(0)}%)
                      </div>
                      <div className="text-lg font-mono text-zinc-400 mt-1">
                        -{parseFloat(summary.commission.toFixed(4))} <span className="text-xs text-zinc-500">SOL</span>
                      </div>
                    </div>
                    <div className="bg-emerald-950/30 rounded-lg p-2">
                      <div className="text-[11px] text-emerald-500 uppercase tracking-wider">Est. Return</div>
                      <div className="text-xl font-black font-mono text-emerald-400 mt-1">
                        ~{parseFloat(summary.netReturn.toFixed(4))} <span className="text-xs">SOL</span>
                      </div>
                      {solPriceUsd && (
                        <div className="text-[11px] text-emerald-600">{formatUsd(summary.netReturn * solPriceUsd)}</div>
                      )}
                    </div>
                    <div className="bg-cyan-950/30 rounded-lg p-2">
                      <div className="text-[11px] text-cyan-400 uppercase tracking-wider">Est. PRISM</div>
                      <div className="text-xl font-black font-mono text-cyan-300 mt-1">~{summary.estimatedReward}</div>
                      <div className="text-[11px] text-cyan-500/70">Reward is verified on-chain after cleanup</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2 text-[11px] text-zinc-400">
                    <span className="inline-flex items-center gap-1 text-cyan-300">
                      <Coins className="h-3.5 w-3.5" /> Swap if routed
                    </span>
                    <span className="inline-flex items-center gap-1 text-orange-300">
                      <Flame className="h-3.5 w-3.5" /> Burn if optimal
                    </span>
                    <span className="inline-flex items-center gap-1 text-zinc-300">
                      <RefreshCw className="h-3.5 w-3.5" /> Close empties
                    </span>
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <Shield className="h-3.5 w-3.5" /> Shield valuables
                    </span>
                    {isPlanning && <span className="text-zinc-500">Analyzing live routes…</span>}
                  </div>
                  <div className="flex justify-center">
                    <Button
                      onClick={handleIncinerate}
                      disabled={isBurning || isPlanning || summary.totalAccounts === 0}
                      className="w-full bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white font-bold px-8 h-12 text-base shadow-lg shadow-red-900/30 transition-all duration-200"
                    >
                      {isBurning ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      ) : isPlanning ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      ) : (
                        <Flame className="mr-2 h-5 w-5" />
                      )}
                      <span className="hidden sm:inline">
                        EXECUTE {summary.totalAccounts} action{summary.totalAccounts !== 1 ? 's' : ''} &rarr;{' '}
                      </span>
                      <span className="sm:hidden">EXECUTE {summary.totalAccounts} &rarr; </span>~
                      {parseFloat(summary.netReturn.toFixed(4))} SOL
                    </Button>
                  </div>
                </div>
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
                    Select assets to route, burn, or close for net SOL recovery
                  </div>
                </div>
                <Flame className="h-8 w-8 text-emerald-600/40" />
              </div>
            )}

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => fetchTokens(ownerPublicKey)}
                disabled={!ownerPublicKey || isLoading}
                variant="outline"
                size="sm"
                className="border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              >
                {isLoading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Re-scan
              </Button>

              {/* Quick Filters */}
              <div className="flex rounded-lg border border-zinc-800/60 overflow-hidden">
                {(['all', 'nft', 'token'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setAssetFilter(f)}
                    className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${assetFilter === f ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/30' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50'}`}
                  >
                    {f === 'all' ? 'All' : f === 'nft' ? 'NFTs' : 'Tokens'}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                <Checkbox
                  checked={showAllAssets}
                  onCheckedChange={handleShowAllToggle}
                  className="border-zinc-600 data-[state=checked]:bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:text-cyan-400 h-4 w-4"
                />
                Show all
              </label>
            </div>

            {/* ═══ Mobile Token List (< 640px) ═══ */}
            <div className="sm:hidden">
              {/* Header row — CSS grid for perfect alignment */}
              <div
                className="grid items-center rounded-lg bg-zinc-900/30 text-[10px] text-zinc-500 py-1.5 mb-0.5"
                style={{ gridTemplateColumns: '24px minmax(0, 1fr) 46px 72px 46px' }}
              >
                <div className="flex justify-center">
                  <Checkbox
                    checked={
                      selectableVisibleTokens.length > 0 && selectedVisibleCount === selectableVisibleTokens.length
                    }
                    onCheckedChange={selectAll}
                    disabled={selectableVisibleTokens.length === 0}
                    className="border-zinc-600 data-[state=checked]:bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:text-cyan-400"
                  />
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
                    ? 'Scanning for threats...'
                    : 'No threats detected. Toggle "Show all" to review all assets.'}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {sortedTokens.map((token) => {
                    const key = token.pubkey.toBase58();
                    const plan = resolutionPlan[key];
                    const decision = getTokenDecision(token);
                    const selectable = isSelectableToken(token);
                    const netEst = selectedTokens.has(key) && plan ? plan.estimatedNetSol : (token.netGainSol ?? 0);
                    const rawName = token.name || token.symbol || '???';
                    const displayName = rawName.length > 10 ? rawName.slice(0, 9) + '…' : rawName;
                    const StatusIcon = decision.icon;
                    return (
                      <div
                        key={key}
                        className={`grid items-center py-1.5 px-1 rounded-xl border transition-colors ${
                          selectedTokens.has(key)
                            ? 'bg-cyan-950/15 border-cyan-900/30'
                            : selectable
                              ? 'bg-zinc-900/20 border-zinc-800/30 cursor-pointer'
                              : 'bg-zinc-950/40 border-zinc-900/40 opacity-75'
                        }`}
                        style={{ gridTemplateColumns: '24px minmax(0, 1fr) 46px 72px 46px' }}
                        onClick={() => selectable && toggleSelection(key)}
                      >
                        <div className="flex justify-center">
                          <Checkbox
                            checked={selectedTokens.has(key)}
                            onCheckedChange={() => toggleSelection(key)}
                            disabled={!selectable}
                            className="border-zinc-600 data-[state=checked]:bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:text-cyan-400"
                          />
                        </div>
                        {/* Asset */}
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden pr-1">
                          <div className="w-7 h-7 rounded-md bg-zinc-900 border border-zinc-800/50 flex items-center justify-center overflow-hidden shrink-0">
                            {token.image ? (
                              <img
                                src={token.image}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <div className="w-3 h-3 rounded-full bg-zinc-800" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium text-zinc-200 leading-none truncate">
                              {displayName}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span
                                className={`text-[7px] uppercase font-bold ${token.isNft ? 'text-purple-400' : 'text-zinc-600'}`}
                              >
                                {token.isNft ? 'NFT' : 'TKN'}
                              </span>
                              <span className="text-[8px] text-zinc-600 font-mono">
                                {formatSolCompact(token.valueSol) ? `${formatSolCompact(token.valueSol)}◎` : ''}
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
                    <TableHead className="w-12 min-w-[48px] max-w-[48px] text-center align-middle px-0">
                      <div className="flex items-center justify-center w-full">
                        <Checkbox
                          checked={
                            selectableVisibleTokens.length > 0 &&
                            selectedVisibleCount === selectableVisibleTokens.length
                          }
                          onCheckedChange={selectAll}
                          disabled={selectableVisibleTokens.length === 0}
                          className="border-zinc-600 data-[state=checked]:bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:text-cyan-400"
                        />
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
                          ? 'Scanning for threats...'
                          : 'No threats detected. Toggle "Show all" to review all assets.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedTokens.map((token) => {
                      const key = token.pubkey.toBase58();
                      const plan = resolutionPlan[key];
                      const decision = getTokenDecision(token);
                      const selectable = isSelectableToken(token);
                      const StatusIcon = decision.icon;
                      const netEst = selectedTokens.has(key) && plan ? plan.estimatedNetSol : (token.netGainSol ?? 0);
                      return (
                        <TableRow key={key} className="hover:bg-zinc-900/40 border-zinc-800/40">
                          <TableCell className="align-middle text-center w-12 min-w-[48px] max-w-[48px] px-0">
                            <div className="flex items-center justify-center w-full">
                              <Checkbox
                                checked={selectedTokens.has(key)}
                                onCheckedChange={() => toggleSelection(key)}
                                disabled={!selectable}
                                className="border-zinc-600 data-[state=checked]:bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:text-cyan-400"
                              />
                            </div>
                          </TableCell>
                          <TableCell className="align-middle text-left w-[180px] min-w-[180px]">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-md bg-zinc-900 border border-zinc-800/50 flex items-center justify-center overflow-hidden shrink-0">
                                {token.image ? (
                                  <img
                                    src={token.image}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      const img = e.currentTarget;
                                      img.style.display = 'none';
                                      const fallback = document.createElement('div');
                                      fallback.className = 'w-3 h-3 rounded-full bg-zinc-700';
                                      img.parentElement?.appendChild(fallback);
                                    }}
                                  />
                                ) : (
                                  <div className="w-3 h-3 rounded-full bg-zinc-800" />
                                )}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="font-medium text-zinc-200 text-[12px] leading-tight truncate max-w-[90px]">
                                    {token.name || 'Unknown'}
                                  </span>
                                  <span
                                    className={`text-[8px] px-1 py-px rounded leading-none shrink-0 ${token.isNft ? 'bg-purple-900/30 text-purple-400' : 'bg-zinc-800/60 text-zinc-500'}`}
                                  >
                                    {token.isNft ? 'NFT' : 'TKN'}
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
                                </span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-center font-mono text-zinc-400 text-sm whitespace-nowrap">
                            {token.uiAmount > 0 ? formatCompact(token.uiAmount) : '0'}
                          </TableCell>
                          <TableCell className="text-center text-sm whitespace-nowrap max-w-[90px]">
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
                          <TableCell className="text-center text-sm font-mono">
                            <span className={netEst >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}>
                              {netEst >= 0 ? `+${parseFloat(netEst.toFixed(4))}` : parseFloat(netEst.toFixed(4))}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
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
