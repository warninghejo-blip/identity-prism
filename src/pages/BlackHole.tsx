import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  TOKEN_2022_PROGRAM_ID,
  createBurnInstruction, 
  createCloseAccountInstruction 
} from '@solana/spl-token';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { toast } from 'sonner';
import { Loader2, Trash2, RefreshCw, Shield, AlertTriangle, Flame, Info, ArrowLeft, ExternalLink, ArrowUpDown } from 'lucide-react';
import { getHeliusProxyUrl, getHeliusRpcUrl, TOKEN_ADDRESSES, SEEKER_TOKEN, BLUE_CHIP_COLLECTIONS } from '@/constants';
import { useSearchParams, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Toaster } from '@/components/ui/sonner';

type AssetStatus = 'protected' | 'valuable' | 'burnable';

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

const formatUsd = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value === 0) return '$0.00';
  if (value < 0.01) return '<$0.01';
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

const formatSol = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value === 0) return '0.0000 SOL';
  return `${value.toFixed(4)} SOL`;
};

const formatSolGain = (value?: number | null) => {
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
  if (abs >= 0.01) return `${parseFloat(value.toFixed(4))}`;
  return `${parseFloat(value.toFixed(6))}`;
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
  sampleMint?: string
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
    return (
      parseNumber(data?.solana?.usd) ??
      parseNumber(data?.usd) ??
      parseNumber(data?.price) ??
      null
    );
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
  } catch {}

  // 2) Raydium fallback for anything DexScreener missed
  const remaining = mints.filter(m => !prices.has(m));
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
          for (const [mint, priceStr] of Object.entries(data) as [string, any][]) {
            const p = parseFloat(priceStr);
            if (!isNaN(p) && p > 0) prices.set(mint, p);
          }
        }
      }
    } catch {}
  }

  return prices;
};

const RENT_RECLAIM_SOL = 0.002;
const VALUE_THRESHOLD_SOL = 0.0015;
const COMMISSION_RATE = 0.10;
const ESTIMATED_FEE_SOL = 0.00015; // conservative estimate for base + priority fee
const MIN_NET_RETURN_SOL = 0.0005; // minimum net return to show as burnable
const TREASURY_ADDRESS = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';

const PROTECTED_MINTS = new Set<string>([
  SEEKER_TOKEN.MINT,
  TOKEN_ADDRESSES.CHAPTER2_PREORDER,
]);

const PROTECTED_COLLECTIONS = new Set<string>([
  TOKEN_ADDRESSES.SEEKER_GENESIS_COLLECTION,
  TOKEN_ADDRESSES.CHAPTER2_PREORDER,
  '4JAq5D5qYMU5RtRuQj4eotQErWvTMKrMYGK87vtbJqJD', // Identity Prism
  ...BLUE_CHIP_COLLECTIONS,
]);

const PROTECTED_SYMBOLS = new Set<string>([
  'SKR', 'SeekerGT', 'SAGA',
]);

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
  if (token.name && PROTECTED_NAME_PATTERNS.some(p => p.test(token.name!))) {
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
  const { publicKey, sendTransaction } = useWallet();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Remove HTML preloader + forward blackout overlay
  useEffect(() => {
    // Forward blackout: created by CelestialCard to bridge Card→BH route change
    const fwdOverlay = document.getElementById('bh-forward-blackout');
    if (fwdOverlay) {
      // Small delay so BH void-intro is rendered behind it first
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
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [incinerationTokens, setIncinerationTokens] = useState<IncinerationToken[]>([]);
  const [wormholeBack, setWormholeBack] = useState(false);
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
    if (incinerationTokens.length === 0) return;
    const timeout = window.setTimeout(() => {
      setIncinerationTokens([]);
    }, 3600);
    return () => window.clearTimeout(timeout);
  }, [incinerationTokens.length]);

  const getVisibleTokens = useCallback(
    (list: TokenAccount[] = tokens, showAll = showAllAssets) => {
      const closeable = list.filter(token => token.closeable !== false);
      return showAll ? closeable : closeable.filter(token => token.isCandidate);
    },
    [showAllAssets, tokens]
  );

  const fetchTokens = useCallback(async (owner?: PublicKey | null) => {
    const targetOwner = owner ?? publicKeyRef.current;
    if (!targetOwner) return;
    
    setIsLoading(true);
    setSelectedTokens(new Set());

    try {
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
            amount: BigInt(info.tokenAmount.amount),
            decimals: info.tokenAmount.decimals,
            uiAmount: Number(info.tokenAmount.uiAmount ?? 0),
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
          const exts: any[] = info.extensions ?? [];
          const hasWithheldFees = exts.some(
            (e: any) => e.extension === 'transferFeeAmount' &&
              e.state?.withheldAmount && BigInt(e.state.withheldAmount) > 0n
          );
          const hasConfidentialPending = exts.some(
            (e: any) => e.extension === 'confidentialTransferAccount' &&
              (e.state?.pending_balance_lo > 0 || e.state?.pending_balance_hi > 0)
          );
          const canClose = !isFrozen && !hasWithheldFees && !hasConfidentialPending;
          return {
            pubkey: item.pubkey,
            programId: TOKEN_2022_PROGRAM_ID,
            mint: info.mint,
            amount: BigInt(info.tokenAmount.amount),
            decimals: info.tokenAmount.decimals,
            uiAmount: Number(info.tokenAmount.uiAmount ?? 0),
            lamports: item.account.lamports,
            rentSol: item.account.lamports / LAMPORTS_PER_SOL,
            frozen: isFrozen,
            closeable: canClose,
          };
        }),
      ];

      const proxyBase = getHeliusProxyUrl();
      const solUsd = await fetchSolPriceUsd(proxyBase);
      setSolPriceUsd(solUsd);

      const heliusUrl = getHeliusRpcUrl(targetOwner.toBase58());
      if (heliusUrl && parsedTokens.length > 0) {
        const mints = [...new Set(parsedTokens.map(t => t.mint))];
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
              data.result.forEach((asset: any) => {
                if (!asset) return;
                const content = asset.content || {};
                const metadata = content.metadata || {};
                const grouping = asset.grouping || [];
                const collectionGroup = grouping.find((group: any) => group.group_key === 'collection');
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
                  collectionName: hasCollection ? (collectionMeta.name || metadata.name) : undefined,
                  collectionSymbol: hasCollection ? (collectionMeta.symbol || metadata.symbol) : undefined,
                  priceUsd,
                });
              });
            }
          } catch {
            // silently ignore metadata batch errors
          }
        }

        parsedTokens.forEach(t => {
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
      }

      // Tokens without Helius DAS price data are treated as zero-value dust
      parsedTokens.forEach(token => {
        if (token.isNft === undefined) {
          const isMaybeNft = token.decimals === 0 && token.uiAmount <= 1;
          token.isNft = isMaybeNft;
        }
      });

      // Jupiter price fallback for fungible tokens without DAS price
      const noPriceMints = parsedTokens
        .filter(t => !t.isNft && t.priceUsd == null && t.uiAmount > 0)
        .map(t => t.mint);
      if (noPriceMints.length > 0) {
        const jupPrices = await fetchFallbackPrices([...new Set(noPriceMints)]);
        parsedTokens.forEach(t => {
          if (!t.isNft && t.priceUsd == null) {
            const p = jupPrices.get(t.mint);
            if (p) t.priceUsd = p;
          }
        });
      }

      const collectionLookups = new Map<string, { symbol?: string; collectionId?: string; collectionName?: string; sampleMint?: string }>();
      parsedTokens
        .filter(token => token.isNft && token.collectionId)
        .forEach(token => {
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
            const stats = await fetchCollectionMarketStats(proxyBase, lookup.symbol, lookup.collectionId, lookup.collectionName, lookup.sampleMint);
            collectionMarketCache.current.set(key, stats);
            return [key, stats] as const;
          })
        );
        const statusMap = new Map(statuses);
        parsedTokens.forEach(token => {
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
        parsedTokens.forEach(token => {
          if (token.isNft) token.marketStatus = 'unknown';
        });
      }

      parsedTokens.forEach(token => {
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
        const rentAfterFees = actualRent * (1 - COMMISSION_RATE) - ESTIMATED_FEE_SOL;
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

      setTokens(parsedTokens);
      toast.success(`Found ${parsedTokens.length} token accounts`);
    } catch {
      toast.error('Failed to fetch tokens');
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ownerBase58 = ownerPublicKey?.toBase58() ?? null;
    if (!ownerBase58 || lastOwnerRef.current === ownerBase58) return;
    lastOwnerRef.current = ownerBase58;
    fetchTokens(ownerPublicKey);
  }, [ownerPublicKey, fetchTokens]);

  const toggleSelection = (pubkey: string) => {
    const newSelection = new Set(selectedTokens);
    if (newSelection.has(pubkey)) {
      newSelection.delete(pubkey);
    } else {
      newSelection.add(pubkey);
    }
    setSelectedTokens(newSelection);
  };

  const selectAll = () => {
    const visibleTokens = getVisibleTokens();
    const selectedVisibleCount = visibleTokens.filter(token =>
      selectedTokens.has(token.pubkey.toBase58())
    ).length;

    if (visibleTokens.length > 0 && selectedVisibleCount === visibleTokens.length) {
      setSelectedTokens(new Set());
    } else {
      setSelectedTokens(new Set(visibleTokens.map(token => token.pubkey.toBase58())));
    }
  };

  const handleShowAllToggle = (value: boolean | 'indeterminate') => {
    const next = Boolean(value);
    setShowAllAssets(next);
    if (!next) {
      const candidateKeys = new Set(
        tokens.filter(token => token.isCandidate).map(token => token.pubkey.toBase58())
      );
      setSelectedTokens(prev => new Set([...prev].filter(key => candidateKeys.has(key))));
    }
  };

  const handleIncinerate = async () => {
    if (!publicKey) {
      toast.error('Connect wallet to incinerate');
      return;
    }
    if (ownerPublicKey && ownerPublicKey.toBase58() !== publicKey.toBase58()) {
      toast.error('Connected wallet does not match scanned address');
      return;
    }
    if (selectedTokens.size === 0) return;

    setIsBurning(true);
    try {
      const transaction = new Transaction();
      // Set compute budget to prevent wallet from adding excessive priority fees
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 })
      );
      let instructionCount = 0;
      
      const targets = tokens.filter(t => selectedTokens.has(t.pubkey.toBase58()));
      const safeTargets = targets.filter(t => t.assetStatus !== 'protected' && t.closeable !== false);
      if (safeTargets.length < targets.length) {
        const blocked = targets.length - safeTargets.length;
        toast.warning(`${blocked} protected asset(s) excluded from burn`);
      }
      if (safeTargets.length === 0) {
        toast.error('No burnable assets selected');
        setIsBurning(false);
        return;
      }

      // Scroll to top so user sees tokens spiral into the BH visual
      const shell = document.querySelector('.blackhole-shell');
      if (shell) shell.scrollTo({ top: 0, behavior: 'smooth' });

      const animationTargets: IncinerationToken[] = safeTargets.map((token, index) => ({
        id: token.pubkey.toBase58(),
        image: token.image,
        label: token.name || token.symbol || token.mint.slice(0, 6),
        delay: index * 120,
        startX: `${Math.random() * 60 - 30}vw`,
        startY: `${25 + Math.random() * 45}vh`,
      }));
      setIncinerationTokens(animationTargets);
      
      for (const token of safeTargets) {
        if (token.amount > 0n) {
          transaction.add(
            createBurnInstruction(
              token.pubkey,
              new PublicKey(token.mint),
              publicKey,
              token.amount,
              undefined,
              token.programId
            )
          );
          instructionCount++;
        }
        transaction.add(
          createCloseAccountInstruction(
            token.pubkey,
            publicKey,
            publicKey,
            undefined,
            token.programId
          )
        );
        instructionCount++;
      }

      // 10% commission to treasury (based on actual rent in each account)
      const totalReclaimLamports = safeTargets.reduce((sum, t) => sum + t.lamports, 0);
      const commissionLamports = Math.round(totalReclaimLamports * COMMISSION_RATE);
      if (commissionLamports > 0) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(TREASURY_ADDRESS),
            lamports: commissionLamports,
          })
        );
        instructionCount++;
      }

      if (instructionCount === 0) {
        toast.info("Nothing to do");
        return;
      }

      const signature = await sendTransaction(transaction, connection);
      
      const netReclaim = (totalReclaimLamports - commissionLamports) / LAMPORTS_PER_SOL;
      toast.info("Incineration started...", {
        description: `Burning ${safeTargets.length} accounts · returning ~${netReclaim.toFixed(4)} SOL`
      });

      // Poll for confirmation instead of WebSocket to avoid WSS proxy issues
      let confirmed = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const status = await connection.getSignatureStatus(signature);
          const conf = status?.value?.confirmationStatus;
          if (conf === 'confirmed' || conf === 'finalized') {
            if (status.value?.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
            }
            confirmed = true;
            break;
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('Transaction failed')) throw e;
        }
      }
      if (!confirmed) {
        toast.warning("Transaction sent but confirmation timed out. Check your wallet.");
      } else {
        toast.success("Incineration complete!", {
          description: `Reclaimed ~${netReclaim.toFixed(4)} SOL (after ${(COMMISSION_RATE * 100).toFixed(0)}% fee)`
        });
      }
      
      // Refresh
      fetchTokens();

    } catch (error) {
      toast.error("Incineration failed", {
        description: error instanceof Error ? error.message : "Unknown error"
      });
    } finally {
      setIsBurning(false);
    }
  };

  const visibleTokens = getVisibleTokens();

  const handleSort = useCallback((field: 'value' | 'return' | 'status') => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }, [sortField]);

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

  const summary = useMemo(() => {
    const selected = tokens.filter(t => selectedTokens.has(t.pubkey.toBase58()));
    const burnable = selected.filter(t => t.assetStatus !== 'protected');
    const totalAccounts = burnable.length;
    const grossReclaim = burnable.reduce((sum, t) => sum + t.rentSol, 0);
    const commission = grossReclaim * COMMISSION_RATE;
    const netReturn = Math.max(0, grossReclaim - commission - ESTIMATED_FEE_SOL);
    const protectedCount = tokens.filter(t => t.assetStatus === 'protected').length;
    const valuableCount = tokens.filter(t => t.assetStatus === 'valuable').length;
    const burnableCount = tokens.filter(t => t.assetStatus === 'burnable').length;
    return { totalAccounts, grossReclaim, commission, netReturn, protectedCount, valuableCount, burnableCount };
  }, [tokens, selectedTokens]);

  const debrisParticles = useMemo(() => {
    const particles: { key: number; style: React.CSSProperties }[] = [];
    for (let i = 0; i < 14; i++) {
      const hue = 15 + (i * 7) % 40;
      const size = 2 + (i % 4) * 1.5;
      particles.push({
        key: i,
        style: {
          width: `${size}px`,
          height: `${size}px`,
          left: '50%',
          top: '50%',
          ['--start' as any]: `${i * 26}deg`,
          ['--radius' as any]: `${55 + (i % 6) * 22}px`,
          ['--dur' as any]: `${3.5 + (i % 5) * 1.8}s`,
          ['--delay' as any]: `${i * 0.4}s`,
          ['--color' as any]: `hsla(${hue}, 80%, 65%, 0.8)`,
        } as React.CSSProperties,
      });
    }
    return particles;
  }, []);

  const [returning, setReturning] = useState(false);

  const handleReturnToCard = useCallback(() => {
    if (returning) return;
    setReturning(true);

    // Scroll to top so the BH visual is visible during suck-in
    const shell = document.querySelector('.blackhole-shell');
    if (shell) shell.scrollTo({ top: 0, behavior: 'smooth' });

    const addr = ownerPublicKey?.toBase58() ?? addressParam ?? '';
    const target = addr ? `/?address=${encodeURIComponent(addr)}` : '/';

    // After suck-in animations finish (~1.3s), screen is already dark.
    // Create opaque veil at that moment (no transition = no flash), then navigate.
    setTimeout(() => {
      let veil = document.getElementById('bh-transition-veil');
      if (!veil) {
        veil = document.createElement('div');
        veil.id = 'bh-transition-veil';
        veil.style.cssText = 'position:fixed;inset:0;background:#050505;z-index:999999;pointer-events:none;opacity:1;';
        document.body.appendChild(veil);
      } else {
        veil.style.opacity = '1';
      }
      sessionStorage.setItem('fromBlackHole', '1');
      navigate(target, { state: { fromBlackHole: true }, replace: true });
    }, 1400);
  }, [returning, ownerPublicKey, addressParam, navigate]);

  return (
    <div className={`identity-shell blackhole-shell ${returning ? 'bh-returning' : ''}`}>
      {/* Wormhole exit: start in darkness then fade out */}
      <div className="blackhole-void-overlay bh-void-intro" />
      {/* Same background layers as card page */}
      <div className="absolute inset-0 bg-[#050505] background-base" />
      <div className="nebula-layer nebula-one" />
      <div className="nebula-layer nebula-two" />
      <div className="nebula-layer nebula-three" />
      <div className="identity-gradient" />

      {/* Incineration animation overlay */}
      <div className="blackhole-incineration-layer" aria-hidden>
        {incinerationTokens.map((token) => {
          const style = {
            ['--start-x' as any]: token.startX,
            ['--start-y' as any]: token.startY,
            animationDelay: `${token.delay}ms`,
          } as React.CSSProperties;
          return (
            <div key={token.id} className="incineration-token" style={style}>
              {token.image ? (
                <img src={token.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
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
        <p className="blackhole-hero__sub">Feed the void &middot; Reclaim your SOL</p>

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
        {/* If wallet not connected — prominent connect prompt */}
        {!publicKey ? (
          <div className="blackhole-panel flex flex-col items-center gap-6 py-12 text-center">
            <p className="text-zinc-400 text-sm max-w-md leading-relaxed">
              Connect your wallet to scan for dust tokens and abandoned NFTs.<br />
              Burn them to reclaim locked SOL rent.
            </p>
            <WalletMultiButton className="!bg-gradient-to-r !from-red-600 !to-orange-600 hover:!from-red-500 hover:!to-orange-500 !rounded-xl !h-12 !px-8 !text-base !font-bold !shadow-lg !shadow-red-900/30" />
            <p className="text-zinc-600 text-xs">
              Valuable assets (Seeker, preorder, blue chips) are automatically protected.
            </p>
          </div>
        ) : (
        <div className="blackhole-panel space-y-6">

          {/* Wallet row */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-white/6">
            <p className="text-zinc-500 text-sm max-w-lg leading-relaxed">
              Burn dust tokens and abandoned NFTs to reclaim locked SOL rent.
              Valuable assets are automatically protected.
            </p>
            <WalletMultiButton className="!bg-zinc-900/80 !border !border-zinc-800 hover:!bg-zinc-800 !rounded-lg !h-10 !text-sm shrink-0" />
          </div>

          {/* Asset Summary Stats */}
          {tokens.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-zinc-100">{tokens.length}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Total Accounts</div>
              </div>
              <div className="bg-emerald-950/20 border border-emerald-900/20 rounded-xl p-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-xl font-bold text-emerald-400">{summary.protectedCount}</span>
                </div>
                <div className="text-[11px] text-emerald-600/80 mt-0.5">Protected</div>
              </div>
              <div className="bg-amber-950/20 border border-amber-900/20 rounded-xl p-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xl font-bold text-amber-400">{summary.valuableCount}</span>
                </div>
                <div className="text-[11px] text-amber-600/80 mt-0.5">Valuable</div>
              </div>
              <div className="bg-red-950/20 border border-red-900/20 rounded-xl p-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <Flame className="h-3.5 w-3.5 text-red-400" />
                  <span className="text-xl font-bold text-red-400">{summary.burnableCount}</span>
                </div>
                <div className="text-[11px] text-red-600/80 mt-0.5">Burnable</div>
              </div>
            </div>
          )}

          {/* Selection & Burn Summary */}
          {selectedTokens.size > 0 && (
            <div className="bg-gradient-to-r from-red-950/30 to-zinc-900/40 border border-red-900/20 rounded-xl p-5">
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Accounts</div>
                    <div className="text-lg font-bold text-red-400 mt-1">{summary.totalAccounts}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Rent Reclaim</div>
                    <div className="text-lg font-bold font-mono text-zinc-200 mt-1">{parseFloat(summary.grossReclaim.toFixed(4))} <span className="text-xs text-zinc-500">SOL</span></div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Fee ({(COMMISSION_RATE * 100).toFixed(0)}%)</div>
                    <div className="text-lg font-mono text-zinc-400 mt-1">-{parseFloat(summary.commission.toFixed(4))} <span className="text-xs text-zinc-500">SOL</span></div>
                  </div>
                  <div className="bg-emerald-950/30 rounded-lg p-2">
                    <div className="text-[11px] text-emerald-500 uppercase tracking-wider">Est. Return</div>
                    <div className="text-xl font-black font-mono text-emerald-400 mt-1">~{parseFloat(summary.netReturn.toFixed(4))} <span className="text-xs">SOL</span></div>
                    {solPriceUsd && (
                      <div className="text-[11px] text-emerald-600">{formatUsd(summary.netReturn * solPriceUsd)}</div>
                    )}
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleIncinerate}
                    disabled={isBurning || summary.totalAccounts === 0}
                    className="bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white font-bold px-8 h-11 text-base shadow-lg shadow-red-900/30"
                  >
                    {isBurning ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Flame className="mr-2 h-5 w-5" />}
                    <span className="hidden sm:inline">Incinerate {summary.totalAccounts} account{summary.totalAccounts !== 1 ? 's' : ''} &rarr; </span>
                    <span className="sm:hidden">Burn {summary.totalAccounts} &rarr; </span>
                    ~{parseFloat(summary.netReturn.toFixed(4))} SOL
                  </Button>
                </div>
              </div>
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
              {isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Rescan
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
              <Checkbox
                checked={showAllAssets}
                onCheckedChange={handleShowAllToggle}
                className="border-zinc-600 data-[state=checked]:bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:text-cyan-400 h-3.5 w-3.5"
              />
              Show all
            </label>
          </div>

          {/* ═══ Mobile Token List (< 640px) ═══ */}
          <div className="sm:hidden space-y-1">
            {/* Select-all header */}
            <div className="flex items-center px-2 py-2 rounded-lg bg-zinc-900/30">
              <Checkbox
                checked={visibleTokens.length > 0 && selectedTokens.size === visibleTokens.length}
                onCheckedChange={selectAll}
                className="border-zinc-600 data-[state=checked]:bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:text-cyan-400 shrink-0 mr-2"
              />
              <span className="text-[11px] text-zinc-500 mr-auto">Select all</span>
              <span className="text-[10px] text-zinc-600 w-[52px] text-right cursor-pointer hover:text-zinc-300" onClick={() => handleSort('value')}>Bal {sortField === 'value' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
              <span className="text-[10px] text-zinc-600 w-[58px] text-right cursor-pointer hover:text-zinc-300" onClick={() => handleSort('return')}>Return {sortField === 'return' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
              <span className="text-[10px] text-zinc-600 w-[24px] text-center cursor-pointer hover:text-zinc-300" onClick={() => handleSort('status')}></span>
            </div>

            {visibleTokens.length === 0 ? (
              <div className="py-10 text-center text-zinc-600 text-sm">
                {isLoading ? 'Scanning event horizon...' : 'No burn candidates found. Toggle "Show all" to review.'}
              </div>
            ) : (
              sortedTokens.map((token) => {
                const netEst = token.netGainSol ?? 0;
                const shortName = (token.name || token.symbol || 'Unknown');
                const displayName = shortName.length > 14 ? shortName.slice(0, 13) + '…' : shortName;
                return (
                  <div
                    key={token.pubkey.toBase58()}
                    className={`flex items-center px-2 py-1.5 rounded-lg border transition-colors ${
                      selectedTokens.has(token.pubkey.toBase58())
                        ? 'bg-cyan-950/15 border-cyan-900/30'
                        : 'bg-zinc-900/20 border-zinc-800/30'
                    }`}
                    onClick={() => toggleSelection(token.pubkey.toBase58())}
                  >
                    <Checkbox
                      checked={selectedTokens.has(token.pubkey.toBase58())}
                      onCheckedChange={() => toggleSelection(token.pubkey.toBase58())}
                      className="border-zinc-600 data-[state=checked]:bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:text-cyan-400 shrink-0 mr-2"
                    />
                    {/* Icon with name above and badge below */}
                    <div className="flex flex-col items-center shrink-0 mr-2" style={{ width: 52 }}>
                      <span className="text-[9px] font-medium text-zinc-300 leading-tight truncate w-full text-center mb-0.5">{displayName}</span>
                      <div className="w-8 h-8 rounded-md bg-zinc-900 border border-zinc-800/50 flex items-center justify-center overflow-hidden">
                        {token.image ? (
                          <img src={token.image} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                        ) : (
                          <div className="w-3 h-3 rounded-full bg-zinc-800" />
                        )}
                      </div>
                      <span className={`text-[7px] mt-px uppercase font-bold tracking-wider ${token.isNft ? 'text-purple-400' : 'text-zinc-600'}`}>
                        {token.isNft ? 'NFT' : 'TKN'}
                      </span>
                    </div>
                    {/* Value info */}
                    <span className="text-[10px] text-zinc-600 font-mono mr-auto truncate" style={{ maxWidth: 64 }}>
                      {formatSolCompact(token.valueSol) ? `${formatSolCompact(token.valueSol)} SOL` : (token.priceUsd != null ? `$${formatCompact(token.priceUsd)}` : '')}
                    </span>
                    {/* Balance */}
                    <span className="text-[12px] font-mono text-zinc-400 w-[52px] text-right shrink-0">{token.uiAmount > 0 ? formatCompact(token.uiAmount) : '0'}</span>
                    {/* Net return */}
                    <span className="text-[10px] font-mono text-emerald-400/80 w-[58px] text-right shrink-0">
                      {netEst > 0 ? `+${parseFloat(netEst.toFixed(4))}` : ''}
                    </span>
                    {/* Status */}
                    <div className="shrink-0 w-[24px] flex justify-center">
                      {token.assetStatus === 'protected' ? (
                        <Shield className="h-3.5 w-3.5 text-emerald-400" />
                      ) : token.assetStatus === 'valuable' ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      ) : (
                        <Flame className="h-3.5 w-3.5 text-red-400/70" />
                      )}
                    </div>
                  </div>
                );
              })
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
                          checked={visibleTokens.length > 0 && selectedTokens.size === visibleTokens.length}
                          onCheckedChange={selectAll}
                          className="border-zinc-600 data-[state=checked]:bg-transparent data-[state=checked]:border-cyan-500 data-[state=checked]:text-cyan-400"
                        />
                      </div>
                    </TableHead>
                    <TableHead className="text-left text-zinc-500 text-xs w-[180px] min-w-[180px]">Asset</TableHead>
                    <TableHead className="text-center text-zinc-500 text-xs whitespace-nowrap">Balance</TableHead>
                    <TableHead className="text-center text-zinc-500 text-xs whitespace-nowrap cursor-pointer select-none hover:text-zinc-300 transition-colors" onClick={() => handleSort('value')}>Value {sortField === 'value' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</TableHead>
                    <TableHead className="text-center text-zinc-500 text-xs whitespace-nowrap cursor-pointer select-none hover:text-zinc-300 transition-colors" onClick={() => handleSort('return')}>Return {sortField === 'return' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</TableHead>
                    <TableHead className="text-center text-zinc-500 text-xs whitespace-nowrap cursor-pointer select-none hover:text-zinc-300 transition-colors" onClick={() => handleSort('status')}>Status {sortField === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTokens.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-20 text-center text-zinc-600 text-sm">
                        {isLoading ? 'Scanning event horizon...' : 'No burn candidates found. Toggle "Show all" to review.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedTokens.map((token) => (
                      <TableRow key={token.pubkey.toBase58()} className="hover:bg-zinc-900/40 border-zinc-800/40">
                        <TableCell className="align-middle text-center w-12 min-w-[48px] max-w-[48px] px-0">
                          <div className="flex items-center justify-center w-full">
                            <Checkbox
                              checked={selectedTokens.has(token.pubkey.toBase58())}
                              onCheckedChange={() => toggleSelection(token.pubkey.toBase58())}
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
                                <span className={`text-[8px] px-1 py-px rounded leading-none shrink-0 ${token.isNft ? 'bg-purple-900/30 text-purple-400' : 'bg-zinc-800/60 text-zinc-500'}`}>
                                  {token.isNft ? 'NFT' : 'TKN'}
                                </span>
                                {token.isNft && (
                                  <>
                                    <a href={token.meUrl || `https://magiceden.io/item-details/${token.mint}`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-purple-500/70 hover:text-purple-400 transition-colors shrink-0" onClick={e => e.stopPropagation()} title="Magic Eden">ME</a>
                                    {token.tensorUrl && (
                                      <a href={token.tensorUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500/70 hover:text-blue-400 transition-colors shrink-0" onClick={e => e.stopPropagation()} title="Tensor">T</a>
                                    )}
                                  </>
                                )}
                              </div>
                              <span className="text-[10px] text-zinc-600 font-mono">
                                {token.symbol ? `${token.symbol} · ` : ''}{token.mint.slice(0, 4)}...{token.mint.slice(-4)}
                                {token.isNft && token.collectionName ? ` · ${token.collectionName}` : ''}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-mono text-zinc-400 text-sm whitespace-nowrap">
                          {token.uiAmount > 0 ? formatCompact(token.uiAmount) : '0'}
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          <div className="flex flex-col items-center leading-tight">
                            <span className="font-mono text-zinc-300">{formatSolCompact(token.valueSol) ?? (token.priceUsd != null ? `$${formatCompact(token.priceUsd)}` : '—')}</span>
                            {token.valueSol != null && token.valueSol > 0 && (
                              <span className="text-[9px] text-zinc-600">SOL</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-sm font-mono">
                          {(() => {
                            const netEst = token.netGainSol ?? 0;
                            if (netEst <= 0) {
                              return <span className="text-zinc-600">—</span>;
                            }
                            return (
                              <div className="flex flex-col items-center">
                                <span className="text-emerald-400/80">~{parseFloat(netEst.toFixed(4))}</span>
                                <span className="text-[9px] text-zinc-600">est. net</span>
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-center">
                          {token.assetStatus === 'protected' ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-900/20 text-emerald-400">
                                <Shield className="h-2.5 w-2.5" /> Protected
                              </span>
                              {token.protectReason && <span className="text-[9px] text-emerald-700">{token.protectReason}</span>}
                            </div>
                          ) : token.assetStatus === 'valuable' ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-900/20 text-amber-400">
                                <AlertTriangle className="h-2.5 w-2.5" /> Valuable
                              </span>
                              {token.protectReason && <span className="text-[9px] text-amber-700">{token.protectReason}</span>}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-900/15 text-red-400/80">
                              <Flame className="h-2.5 w-2.5" /> Burnable
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

        </div>
        )}
      </div>

      <Toaster
        position="bottom-center"
        theme="dark"
        expand={false}
        richColors
        closeButton
        offset={16}
      />
    </div>
  );
};

export default BlackHole;
