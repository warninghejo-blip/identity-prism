import { useEffect, useState } from 'react';
import {
  getHeliusProxyHeaders,
  getHeliusProxyUrl,
  getHeliusRpcUrls,
  MEME_COIN_MINTS,
  MEME_COIN_PRICES_USD,
  TOKEN_ADDRESSES,
  BLUE_CHIP_COLLECTION_NAMES,
  BLUE_CHIP_COLLECTIONS,
  DEFI_POSITION_HINTS,
  LST_MINTS,
  SCORING,
} from '@/constants';
import { Connection, PublicKey } from '@solana/web3.js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getCompositeTierFromScore } from '@/lib/constants/tierColors';

// ── Scan progress broadcasting ──

export type ScanPhase = 'connecting' | 'balance' | 'transactions' | 'assets' | 'analyzing' | 'scoring' | 'done';

type ScanProgressListener = (phase: ScanPhase, pct: number) => void;
const scanListeners = new Set<ScanProgressListener>();

export function onScanProgress(fn: ScanProgressListener) {
  scanListeners.add(fn);
  return () => {
    scanListeners.delete(fn);
  };
}

function emitScan(phase: ScanPhase, pct: number) {
  scanListeners.forEach((fn) => fn(phase, pct));
}

export type PlanetTier =
  | 'mercury'
  | 'mars'
  | 'venus'
  | 'earth'
  | 'neptune'
  | 'uranus'
  | 'saturn'
  | 'jupiter'
  | 'sun'
  | 'binary_sun';
export type RarityTier = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface WalletTraits {
  hasSeeker: boolean;
  hasPreorder: boolean;
  hasCombo: boolean;
  isOG: boolean;
  isWhale: boolean;
  isCollector: boolean;
  isEarlyAdopter: boolean;
  isTxTitan: boolean;
  isSolanaMaxi: boolean;
  isBlueChip: boolean;
  isDeFiKing: boolean;
  uniqueTokenCount: number;
  nftCount: number;
  txCount: number;
  memeCoinsHeld: string[];
  isMemeLord: boolean;
  hyperactiveDegen: boolean;
  diamondHands: boolean;
  avgTxPerDay30d: number;
  daysSinceLastTx: number | null;
  solBalance: number;
  solBonusApplied: number;
  walletAgeDays: number;
  walletAgeBonus: number;
  planetTier: PlanetTier;
  totalAssetsCount: number;
  solTier: 'shrimp' | 'dolphin' | 'whale' | null;
  totalValueUSD: number;
  cosmicRank: 'stardust' | 'meteor' | 'comet' | 'nebula' | 'supernova' | 'quasar';
  // Enhanced TX data (Helius)
  swapCount?: number;
  nftTradeCount?: number;
  stakingCount?: number;
  defiProtocols?: string[];
  isDeFiUser?: boolean;
}

export interface WalletData {
  address: string;
  score: number;
  tier?: PlanetTier | null;
  traits: WalletTraits | null;
  isLoading: boolean;
  error: string | null;
  isNewWallet?: boolean;
  isMinted?: boolean;
}

export const WALLET_DATA_CACHE_TTL_MS = 15 * 60 * 1000;

type WalletDataCacheKeys = {
  dataKey: string;
  timestampKey: string;
};

const getWalletDataCacheKeys = (address: string): WalletDataCacheKeys[] => [
  {
    dataKey: `walletData_v4_${address}`,
    timestampKey: `walletData_v4_ts_${address}`,
  },
  {
    dataKey: `walletData_v3_${address}`,
    timestampKey: `walletData_v3_ts_${address}`,
  },
  {
    dataKey: `walletData_${address}`,
    timestampKey: `walletData_ts_${address}`,
  },
];

export function readCachedWalletData(address: string): WalletData | null {
  if (!address || typeof sessionStorage === 'undefined') return null;

  for (const { dataKey, timestampKey } of getWalletDataCacheKeys(address)) {
    try {
      const cached = sessionStorage.getItem(dataKey);
      if (!cached) continue;
      const parsed = JSON.parse(cached) as WalletData;
      const ts = Number(sessionStorage.getItem(timestampKey) || 0);
      if (Date.now() - ts >= WALLET_DATA_CACHE_TTL_MS) continue;
      if (!parsed?.traits || parsed.address !== address) continue;
      return {
        ...parsed,
        isLoading: false,
        error: null,
      };
    } catch {
      /* ignore bad cache entry */
    }
  }

  return null;
}

export function writeWalletDataCache(address: string, data: WalletData) {
  if (!address || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(`walletData_v4_${address}`, JSON.stringify(data));
    sessionStorage.setItem(`walletData_v4_ts_${address}`, String(Date.now()));
  } catch {
    /* ignore cache write */
  }
}

export function calculateScore(traits: WalletTraits): number {
  let score = 0;

  // SOL Balance (max 40)
  const sol = traits.solBalance;
  if (sol >= 10) score += 40;
  else if (sol >= 5) score += 34;
  else if (sol >= 1) score += 24;
  else if (sol >= 0.5) score += 16;
  else if (sol >= 0.1) score += 8;

  // Wallet Age (max 100)
  const age = traits.walletAgeDays;
  if (age > 730) score += 100;
  else if (age > 365) score += 72;
  else if (age > 180) score += 48;
  else if (age > 90) score += 28;
  else if (age > 30) score += 14;
  else if (age > 7) score += 6;

  // Transactions (max 80)
  const tx = traits.txCount;
  if (tx > 5000) score += 80;
  else if (tx > 2000) score += 64;
  else if (tx > 1000) score += 48;
  else if (tx > 500) score += 32;
  else if (tx > 100) score += 20;
  else if (tx > 50) score += 12;
  else score += Math.min(Math.round(tx * 0.2), 10);

  // NFTs (max 32)
  const nfts = traits.nftCount;
  if (nfts > 100) score += 32;
  else if (nfts > 50) score += 24;
  else if (nfts > 20) score += 16;
  else if (nfts > 5) score += 8;

  // DeFi Activity (max 30)
  const swaps = traits.swapCount ?? 0;
  if (swaps > 100) score += 16;
  else if (swaps > 50) score += 12;
  else if (swaps > 10) score += 8;
  else if (swaps > 0) score += 4;
  score += Math.min(Math.round((traits.nftTradeCount ?? 0) * 0.8), 6);
  const protocols = traits.defiProtocols?.length ?? 0;
  if (protocols >= 3) score += 8;
  else if (protocols >= 2) score += 5;
  else if (protocols >= 1) score += 2;

  // Collection NFTs (max 50)
  if (traits.hasSeeker) score += SCORING.SEEKER_GENESIS_BONUS; // 20
  if (traits.hasPreorder) score += SCORING.CHAPTER2_PREORDER_BONUS; // 15
  if (traits.hasCombo) score += SCORING.COMBO_BONUS; // 15

  // Badges (max 68)
  if (traits.isOG) score += 14;
  if (traits.isTxTitan) score += 8;
  if (traits.isWhale) score += 8;
  if (traits.isCollector) score += 6;
  if (traits.isEarlyAdopter) score += 6;
  if (traits.isSolanaMaxi) score += 6;
  if (traits.isBlueChip) score += SCORING.BLUE_CHIP_BONUS; // 5
  if (traits.diamondHands) score += SCORING.DIAMOND_HANDS_BONUS; // 5
  if (traits.isDeFiKing) score += SCORING.DEFI_KING_BONUS; // 5
  if (traits.isMemeLord) score += SCORING.MEME_LORD_BONUS; // 3
  if (traits.hyperactiveDegen) score += SCORING.HYPERACTIVE_BONUS; // 2

  return Math.min(Math.round(score), 400);
}

const SOL_LAMPORTS = 1_000_000_000;
const _DEMO_WALLET_ADDRESS = '0xDemo...Wallet';
const PLANET_TIERS: PlanetTier[] = [
  'mercury',
  'mars',
  'venus',
  'earth',
  'neptune',
  'uranus',
  'saturn',
  'jupiter',
  'sun',
  'binary_sun',
];
const MEME_MINT_LOOKUP: Record<string, keyof typeof MEME_COIN_MINTS> = Object.entries(MEME_COIN_MINTS).reduce(
  (acc, [symbol, mint]) => {
    acc[mint] = symbol as keyof typeof MEME_COIN_MINTS;
    return acc;
  },
  {} as Record<string, keyof typeof MEME_COIN_MINTS>,
);
const _LST_ADDRESSES = Object.values(LST_MINTS);

const toFiniteNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const isPlanetTier = (value: unknown): value is PlanetTier =>
  typeof value === 'string' && PLANET_TIERS.includes(value as PlanetTier);

const fetchFastProfileJson = async (url: string): Promise<unknown> => {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      responseType: 'json',
      connectTimeout: 3_500,
      readTimeout: 4_500,
      headers: { Accept: 'application/json' },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`FAST_PROFILE_NATIVE_${response.status}`);
    }
    return response.data;
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(4_500),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`FAST_PROFILE_FETCH_${response.status}`);
  }
  return response.json();
};

const getFastProfileStatus = (error: unknown): number | null => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match = message.match(/FAST_PROFILE_(?:NATIVE|FETCH)_(\d{3})/);
  return match ? Number(match[1]) : null;
};

const primeCompositeCache = (address: string, wallet: any) => {
  if (!wallet || typeof wallet !== 'object') return;
  const fallbackScore = toFiniteNumber(wallet.score);
  const fallbackTier = typeof wallet.tier === 'string' && wallet.tier ? wallet.tier : 'mercury';
  const composite = wallet.composite ?? null;
  const breakdown = composite?.breakdown ??
    wallet.breakdown ?? {
      onchain: Math.max(0, Math.min(Math.round(fallbackScore), 400)),
      sybilTrust: 0,
      humanProof: 0,
      social: 0,
      engagement: 0,
    };
  const details = wallet.scoreDetails ?? composite?.details ?? null;
  if (details?.onchain && !details.onchain.scoreBreakdown && wallet.scoreBreakdown) {
    details.onchain.scoreBreakdown = wallet.scoreBreakdown;
  }
  const data = {
    score: toFiniteNumber(composite?.compositeScore, fallbackScore),
    tier: getCompositeTierFromScore(
      toFiniteNumber(composite?.compositeScore, fallbackScore),
      typeof composite?.compositeTier === 'string' && composite.compositeTier ? composite.compositeTier : fallbackTier,
    ),
    breakdown,
    details,
    hasComposite: Boolean(composite),
  };
  try {
    sessionStorage.setItem(`ip_composite_v3_${address}`, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* ignore cache write */
  }
};

const buildTraitsFromWalletDatabase = (address: string, wallet: any): WalletData | null => {
  if (!wallet || typeof wallet !== 'object') return null;

  const onchain = wallet.scoreDetails?.onchain ?? wallet.composite?.details?.onchain ?? {};
  const scoreBreakdown = wallet.scoreBreakdown ?? onchain.scoreBreakdown ?? {};
  const badges = Array.isArray(wallet.badges) ? wallet.badges.map((b: unknown) => String(b).toLowerCase()) : [];
  const solBalance = toFiniteNumber(onchain.solBalance ?? scoreBreakdown.solBalance?.raw);
  const txCount = toFiniteNumber(onchain.txCount ?? scoreBreakdown.transactions?.raw);
  const nftCount = toFiniteNumber(onchain.nftCount ?? scoreBreakdown.nfts?.raw);
  const walletAgeDays = toFiniteNumber(onchain.walletAgeDays || scoreBreakdown.walletAge?.raw);
  const defiProtocols = Array.isArray(onchain.defiProtocols) ? onchain.defiProtocols : [];
  const swapCount = toFiniteNumber(scoreBreakdown.defiActivity?.swaps);
  const compositeScore = toFiniteNumber(wallet.composite?.compositeScore ?? wallet.score);
  const baseScore = toFiniteNumber(onchain.identityScore ?? wallet.score);
  const mappedCompositeTier = getCompositeTierFromScore(compositeScore, wallet.composite?.compositeTier ?? wallet.tier);
  const tier = isPlanetTier(mappedCompositeTier) ? mappedCompositeTier : 'earth';

  const traits: WalletTraits = {
    hasSeeker: Boolean(onchain.hasSeeker),
    hasPreorder: Boolean(onchain.hasPreorder),
    hasCombo: Boolean(onchain.hasCombo),
    isOG: badges.includes('og') || (walletAgeDays >= 730 && txCount > 5000 && solBalance >= 1),
    isWhale: solBalance >= 10,
    isCollector: badges.includes('collector') || nftCount > 20,
    isEarlyAdopter: badges.includes('early') || walletAgeDays >= 730,
    isTxTitan: txCount > 5000,
    isSolanaMaxi: solBalance >= 5,
    isBlueChip: Boolean(onchain.isBlueChip),
    isDeFiKing: Boolean(onchain.isDeFiKing) || defiProtocols.length >= 3 || swapCount > 100,
    uniqueTokenCount: toFiniteNumber(wallet.uniqueTokenCount),
    nftCount,
    txCount,
    memeCoinsHeld: [],
    isMemeLord: Boolean(onchain.isMemeLord),
    hyperactiveDegen: txCount / Math.max(1, Math.min(30, walletAgeDays || 30)) >= 8,
    diamondHands: walletAgeDays >= 365,
    avgTxPerDay30d: txCount / Math.max(1, Math.min(30, walletAgeDays || 30)),
    daysSinceLastTx: null,
    solBalance,
    solBonusApplied: toFiniteNumber(scoreBreakdown.solBalance?.pts),
    walletAgeDays,
    walletAgeBonus: toFiniteNumber(scoreBreakdown.walletAge?.pts),
    planetTier: tier,
    totalAssetsCount: toFiniteNumber(wallet.totalAssetsCount || nftCount),
    solTier: solBalance >= 10 ? 'whale' : solBalance >= 1 ? 'dolphin' : solBalance > 0 ? 'shrimp' : null,
    totalValueUSD: toFiniteNumber(wallet.totalValueUSD),
    cosmicRank:
      compositeScore >= 850
        ? 'quasar'
        : compositeScore >= 700
          ? 'supernova'
          : compositeScore >= 520
            ? 'nebula'
            : compositeScore >= 320
              ? 'comet'
              : compositeScore >= 140
                ? 'meteor'
                : 'stardust',
    swapCount,
    nftTradeCount: toFiniteNumber(scoreBreakdown.defiActivity?.nftTradePts),
    stakingCount: toFiniteNumber(scoreBreakdown.defiActivity?.stakingCount),
    defiProtocols,
    isDeFiUser: defiProtocols.length > 0 || swapCount > 0,
  };

  return {
    address,
    traits,
    score: compositeScore || Math.max(baseScore, calculateScore(traits)),
    tier,
    isLoading: false,
    error: null,
    isMinted: Boolean(wallet.mint?.minted),
  };
};

export function useWalletData(address?: string) {
  const [walletData, setWalletData] = useState<WalletData>(() =>
    address ? (readCachedWalletData(address) ?? buildDisconnectedWalletData()) : buildDisconnectedWalletData(),
  );
  const _isLowEndDevice =
    typeof navigator !== 'undefined' &&
    /android/i.test(navigator.userAgent) &&
    (navigator.hardwareConcurrency ?? 4) <= 4;
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    if (isDev) {
      console.info('[useWalletData] effect fired', { address, hasAddress: Boolean(address) });
    }
    // Immediate reset when address changes or is removed
    if (!address) {
      setWalletData(buildDisconnectedWalletData());
      return;
    }

    // Check for cached data so planet renders immediately on return from BlackHole
    const cachedWalletData = readCachedWalletData(address);
    if (cachedWalletData) {
      setWalletData(cachedWalletData);
      writeWalletDataCache(address, cachedWalletData);
      emitScan('done', 100);
      return;
    }
    setWalletData({
      address,
      traits: null,
      score: 0,
      isLoading: true,
      error: null,
    });

    let cancelled = false;

    const fetchData = async () => {
      let fastProfileAllNotFound = false;
      try {
        const heliusRpcUrls = getHeliusRpcUrls(address);
        if (!heliusRpcUrls.length) {
          setWalletData({ address, traits: null, score: 0, isLoading: false, error: 'Helius API key required.' });
          return;
        }

        emitScan('connecting', 5);
        if (isDev) {
          // eslint-disable-next-line no-console
          console.log('%c[Scan] Starting wallet scan', 'color: #22d3ee;');
        }
        let publicKey: PublicKey;
        try {
          publicKey = new PublicKey(address);
        } catch (error) {
          console.error('Invalid wallet address:', error);
          setWalletData({ address, traits: null, score: 0, isLoading: false, error: 'Invalid wallet address' });
          return;
        }
        // setWalletData already set to loading above

        const proxyBase = getHeliusProxyUrl();
        const isNativeProfileOnly = Capacitor.isNativePlatform();
        if (proxyBase) {
          const fastProfilePaths = [
            `/api/prism/summary?address=${encodeURIComponent(address)}`,
            `/api/wallet-database?address=${encodeURIComponent(address)}`,
          ];
          const fastProfileStatuses: Array<number | null> = [];

          for (const path of fastProfilePaths) {
            try {
              emitScan('analyzing', 52);
              const databaseWallet = await fetchFastProfileJson(`${proxyBase}${path}`);
              const fastWalletData = buildTraitsFromWalletDatabase(address, databaseWallet);
              if (!fastWalletData) continue;
              if (cancelled) return;
              primeCompositeCache(address, databaseWallet);

              setWalletData(fastWalletData);
              writeWalletDataCache(address, fastWalletData);
              emitScan('done', 100);
              return;
            } catch (error) {
              fastProfileStatuses.push(getFastProfileStatus(error));
              if (isDev) console.warn('[Wallet Database] Fast profile endpoint failed, trying fallback.', error);
            }
          }
          fastProfileAllNotFound =
            fastProfileStatuses.length === fastProfilePaths.length && fastProfileStatuses.every((status) => status === 404);
          if (isNativeProfileOnly) {
            if (fastProfileAllNotFound) {
              if (isDev) console.warn('[Wallet Database] Wallet not registered; using new wallet profile.');
              const fallbackData = buildNewWalletData(address);
              if (cancelled) return;
              emitScan('done', 100);
              setWalletData(fallbackData);
              writeWalletDataCache(address, fallbackData);
              return;
            } else {
              if (!cancelled) {
                setWalletData({
                  address,
                  traits: null,
                  score: 0,
                  isLoading: false,
                  error: 'Identity profile is temporarily unavailable.',
                });
              }
              return;
            }
          }
        }

        const proxyHeaders = getHeliusProxyHeaders(address);
        const withHeliusRpc = async <T>(runner: (conn: Connection) => Promise<T>) => {
          let lastError: unknown = null;
          for (const [index, rpcUrl] of heliusRpcUrls.entries()) {
            try {
              const conn = new Connection(rpcUrl, {
                commitment: 'confirmed',
                httpHeaders: proxyHeaders,
              });
              return await runner(conn);
            } catch (error) {
              lastError = error;
              if (isDev) {
                console.warn(`[Helius RPC] Attempt ${index + 1}/${heliusRpcUrls.length} failed.`, error);
              }
            }
          }
          throw lastError ?? new Error('All Helius RPC endpoints failed.');
        };

        // 1. Fast first page + DAS in parallel
        //    RPC batch (balance/sigs/tokens) and DAS getAssetsByOwner are independent
        //    → run concurrently to cut scan time roughly in half.
        //    Remaining tx pages (2-10) load in background → update score silently.

        interface DASAsset {
          id: string;
          content?: {
            metadata?: {
              name?: string;
              symbol?: string;
            };
            links?: {
              image?: string;
            };
          };
          authorities?: { address: string }[];
          creators?: { address: string; verified?: boolean }[];
          burnt?: boolean;
          grouping?: { group_key: string; group_value: string }[];
          interface?: string;
          token_info?: {
            decimals?: number;
            supply?: number;
            balance?: number | string;
            amount?: number | string;
            price_info?: {
              price_per_token?: number;
              total_price?: number;
              currency?: string;
            };
          };
          compression?: {
            compressed: boolean;
          };
        }
        const PREORDER_MINT = '2DMMamkkxQ6zDMBtkFp8KH7FoWzBMBA1CGTYwom4QH6Z';
        const PREORDER_COLLECTION = '3uejyD3ZwHDGwT8n6KctN3Stnjn9Nih79oXES9VqA38D';

        // DAS fetch helper (independent of RPC connection)
        const fetchDasAssets = async (): Promise<DASAsset[]> => {
          let dasError: unknown = null;
          for (const [index, rpcUrl] of heliusRpcUrls.entries()) {
            try {
              if (isDev) {
                // eslint-disable-next-line no-console
                console.log(`%c[DAS Request] Fetching assets for ${address}`, 'color: #fbbf24;');
              }
              const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(proxyHeaders ?? {}),
                },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 'identity-prism-scan',
                  method: 'getAssetsByOwner',
                  params: {
                    ownerAddress: address,
                    page: 1,
                    limit: 1000,
                    displayOptions: {
                      showCollectionMetadata: true,
                      showFungible: true,
                    },
                  },
                }),
              });

              if (!response.ok) {
                if (response.status === 429) throw new Error('DAS rate limited');
                console.error(`%c[DAS Error] HTTP ${response.status}`, 'color: #ef4444;');
                throw new Error(`DAS API returned ${response.status}`);
              }

              const dasResponse = (await response.json()) as {
                result?: { items: DASAsset[] };
                error?: { message?: string };
              };
              if (dasResponse.error) {
                console.error(`%c[DAS Error]`, 'color: #ef4444;', dasResponse.error);
                throw new Error(dasResponse.error.message || 'DAS API error');
              }
              return (dasResponse.result?.items as DASAsset[]) || [];
            } catch (error) {
              dasError = error;
              if (isDev) {
                console.warn(`[Helius DAS] Attempt ${index + 1}/${heliusRpcUrls.length} failed.`, error);
              }
            }
          }
          throw dasError ?? new Error('All DAS endpoints failed');
        };

        // Run RPC batch and DAS concurrently, emitting progress as each resolves
        emitScan('connecting', 5);

        const rpcResultPromise = withHeliusRpc(async (conn) => {
          const balancePromise = conn.getBalance(publicKey).then((b) => {
            emitScan('balance', 12);
            return b;
          });
          const sigsPromise = conn.getSignaturesForAddress(publicKey, { limit: 1000 }).then((s) => {
            emitScan('transactions', 22);
            return s;
          });
          const tokenAccountsPromise = conn
            .getParsedTokenAccountsByOwner(publicKey, {
              programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            })
            .then((t) => {
              emitScan('analyzing', 30);
              return t;
            });
          const [balance, firstPageSigs, tokenAccountsResponse] = await Promise.all([
            balancePromise,
            sigsPromise,
            tokenAccountsPromise,
          ]);
          return { balance, firstPageSigs, tokenAccountsResponse, conn };
        });

        const assetsPromise = fetchDasAssets().then((a) => {
          emitScan('assets', 40);
          return a;
        });

        const [rpcResult, assets] = await Promise.all([rpcResultPromise, assetsPromise]);

        const { balance, firstPageSigs, tokenAccountsResponse, conn: usedConn } = rpcResult;

        // Use first page for initial render
        const signatures = firstPageSigs;
        const needsDeepScan = firstPageSigs.length === 1000; // more pages exist

        const solBalance = balance / SOL_LAMPORTS;
        const txCount = signatures.length;
        let firstTxDate = new Date();
        if (signatures.length > 0) {
          const oldest = signatures[signatures.length - 1];
          if (oldest.blockTime) firstTxDate = new Date(oldest.blockTime * 1000);
        }
        const walletAgeDays = Math.floor((Date.now() - firstTxDate.getTime()) / (1000 * 60 * 60 * 24));
        const avgTxPerDay30d = txCount / Math.max(1, Math.min(30, walletAgeDays));

        emitScan('assets', 60);
        const totalAssetsCount = assets.length;

        if (isDev) {
          // eslint-disable-next-line no-console
          console.log(`%c[DAS Success] ${totalAssetsCount} assets found.`, 'color: #22d3ee; font-weight: bold;');
        }

        const foundAsset = assets.find((a: DASAsset) => {
          const id = a.id || '';
          const name = a.content?.metadata?.name || '';
          const grouping = a.grouping || [];

          const isPreorderId = id === PREORDER_MINT;
          const isPreorderName = name.includes('Chapter 2') || name.includes('Seeker Preorder');
          const isPreorderGroup = grouping.some((g) => g.group_value === PREORDER_COLLECTION);

          return isPreorderId || isPreorderName || isPreorderGroup;
        });

        if (isDev && foundAsset) {
          // eslint-disable-next-line no-console
          console.log('%c[DAS] Preorder asset found', 'color: #10b981;');
        }

        let nftCount = 0;
        let uniqueTokenCount = 0;
        let hasSeeker = false;
        let hasPreorder = !!foundAsset;
        let isBlueChip = false;
        let hasLstExposure = false;
        let defiProtocolExposure = false;
        let memeValueUSD = 0;
        const memeHoldingsSet = new Set<string>();

        // 3. Analysis Loop
        assets.forEach((asset: DASAsset) => {
          const content = asset.content || {};
          const metadata = content.metadata || {};
          const rawName = metadata.name || content.metadata?.name || asset.id || '';
          const name = rawName.toLowerCase();
          const _symbol = (metadata.symbol || content.metadata?.symbol || '').toLowerCase();

          const mint = asset.id;

          // Seeker Genesis Detection
          const grouping = asset.grouping || [];
          const collectionGroup = grouping.find((g) => g.group_key === 'collection');
          const authorities = asset.authorities || [];
          const creators = asset.creators || [];

          const isSeekerGenesis =
            collectionGroup?.group_value === TOKEN_ADDRESSES.SEEKER_GENESIS_COLLECTION ||
            authorities.some((auth) => auth.address === TOKEN_ADDRESSES.SEEKER_MINT_AUTHORITY) ||
            creators.some((c) => c.address === TOKEN_ADDRESSES.SEEKER_MINT_AUTHORITY) ||
            (name.includes('seeker') && (name.includes('genesis') || name.includes('citizen')));

          if (isSeekerGenesis) hasSeeker = true;

          // Extra Chapter 2 Preorder check within the loop (Nuclear)
          const isChapter2Preorder =
            mint === PREORDER_MINT ||
            rawName.includes('Chapter 2') ||
            rawName.includes('Seeker Preorder') ||
            grouping.some((g) => g.group_value === PREORDER_COLLECTION);

          if (isChapter2Preorder) hasPreorder = true;

          // NFT Logic (Decimals 0)
          const iface = (asset.interface || '').toUpperCase();
          const tokenInfo = asset.token_info || {};
          const decimals = tokenInfo.decimals ?? (isFungibleAsset(asset) ? 9 : 0);

          const isExplicitNFT =
            iface === 'V1_NFT' ||
            iface === 'V2_NFT' ||
            iface === 'PROGRAMMABLENFT' ||
            iface === 'LEGACY_NFT' ||
            asset.compression?.compressed === true;
          const supply = tokenInfo.supply !== undefined ? tokenInfo.supply : -1;
          const hasCollection = grouping.some((g: { group_key: string }) => g.group_key === 'collection');
          const isLikelyNFT = decimals === 0 && hasCollection && supply === 1;
          const isKnownFungible =
            iface === 'FUNGIBLETOKEN' ||
            iface === 'FUNGIBLEASSET' ||
            iface === 'FUNGIBLE_TOKEN' ||
            iface === 'FUNGIBLE_ASSET' ||
            (supply > 1 && decimals >= 0);

          // Skip burnt assets
          if (asset.burnt) return;

          const hasVerifiedCreator = creators.some((c) => c.verified === true);
          const _isCompressedNFT = asset.compression?.compressed === true;
          // Strict NFT filter:
          // 1. Must be verified creator + collection (Core assets: collection only)
          // 2. Must have royalties >= 1% (100 bps) — filters spam/airdrop NFTs with 0 royalties
          const isMplCore = iface === 'MPLCOREASSET' || iface === 'MPLBUBBLEGUMV2';
          const isRealNFT = isMplCore ? hasCollection : hasVerifiedCreator && hasCollection;
          const royaltyBps = (asset as unknown as { royalty?: { basis_points?: number } }).royalty?.basis_points ?? 0;
          const hasRoyalty = royaltyBps >= 100;
          if ((isExplicitNFT || isMplCore || (isLikelyNFT && !isKnownFungible)) && isRealNFT && hasRoyalty) {
            nftCount++;
            const collectionValue = collectionGroup?.group_value || '';
            if (BLUE_CHIP_COLLECTIONS.includes(collectionValue as (typeof BLUE_CHIP_COLLECTIONS)[number])) {
              isBlueChip = true;
            }
            // Also check by collection name
            if (!isBlueChip && name) {
              const lowerName = name.toLowerCase();
              if (BLUE_CHIP_COLLECTION_NAMES.some((bcn) => lowerName.includes(bcn))) {
                isBlueChip = true;
              }
            }
          } else {
            uniqueTokenCount++;
          }

          if (DEFI_POSITION_HINTS.some((hint) => name.includes(hint))) {
            defiProtocolExposure = true;
          }

          if (Object.values(LST_MINTS).some((m) => m === mint)) {
            hasLstExposure = true;
          }

          const memeSymbol = MEME_MINT_LOOKUP[mint];
          if (memeSymbol) {
            const balanceRaw = tokenInfo.balance ?? tokenInfo.amount ?? 0;
            const numericBalance = typeof balanceRaw === 'number' ? balanceRaw : parseFloat(balanceRaw || '0');
            const uiAmount = decimals > 0 ? numericBalance / Math.pow(10, decimals) : numericBalance;
            if (uiAmount > 0) {
              memeHoldingsSet.add(memeSymbol);
              memeValueUSD += uiAmount * (MEME_COIN_PRICES_USD[memeSymbol] || 0);
            }
          }
        });

        // 4. SPL Fallback Check
        tokenAccountsResponse.value.forEach(
          (ta: {
            account: {
              data: {
                parsed: {
                  info: {
                    mint: string;
                    tokenAmount: { uiAmount: number; decimals: number };
                  };
                };
              };
            };
          }) => {
            const info = ta.account.data.parsed.info;
            if (info.tokenAmount.uiAmount > 0) {
              const mint = info.mint;
              const isPreorderMint = mint === TOKEN_ADDRESSES.CHAPTER2_PREORDER;
              if (isPreorderMint) hasPreorder = true;
              if (Object.values(LST_MINTS).some((m: string) => m === mint)) hasLstExposure = true;
              if (!assets.some((a: { id: string }) => a.id === mint)) {
                // Only count meme value from SPL fallback if NOT already counted from DAS
                const memeSymbol = MEME_MINT_LOOKUP[mint];
                if (memeSymbol) {
                  const amount = info.tokenAmount.uiAmount || 0;
                  if (amount > 0) {
                    memeHoldingsSet.add(memeSymbol);
                    memeValueUSD += amount * (MEME_COIN_PRICES_USD[memeSymbol] || 0);
                  }
                }
              }
              if (!assets.some((a: { id: string }) => a.id === mint)) {
                // Only use SPL fallback for special token detection, not for counting
                if (info.tokenAmount.decimals === 0) {
                  if (mint === '2DMMamkkxQ6zDMBtkFp8KH7FoWzBMBA1CGTYwom4QH6Z') hasPreorder = true;
                }
              }
            }
          },
        );

        const hasCombo = hasSeeker && hasPreorder;
        const memeCoinsHeld = Array.from(memeHoldingsSet);
        const isMemeLord = memeCoinsHeld.length >= 3 && memeValueUSD >= 10;
        // DeFi King: must have LST or DeFi protocol exposure AND meaningful wallet value
        const isDeFiKing = (hasLstExposure || defiProtocolExposure) && (solBalance >= 0.1 || memeValueUSD >= 10);

        const solTier = solBalance >= 10 ? 'whale' : solBalance >= 1 ? 'dolphin' : solBalance >= 0.1 ? 'shrimp' : null;

        // Total wallet value: sum all token price_info from DAS + SOL balance
        let allTokenValueUSD = 0;
        assets.forEach((asset: DASAsset) => {
          const pi = asset.token_info?.price_info;
          if (pi?.total_price && pi.total_price > 0) {
            allTokenValueUSD += pi.total_price;
          }
        });
        // Also add from SPL fallback for tokens not in DAS
        // SOL price: use DAS native SOL price if available, else estimate
        const solAsset = assets.find((a: DASAsset) => a.id === 'So11111111111111111111111111111111111111112');
        const solPrice = solAsset?.token_info?.price_info?.price_per_token || 150;
        const solValueUSD = solBalance * solPrice;
        const totalValueUSD = solValueUSD + allTokenValueUSD;
        const cosmicRank: WalletTraits['cosmicRank'] =
          totalValueUSD >= 50000
            ? 'quasar'
            : totalValueUSD >= 10000
              ? 'supernova'
              : totalValueUSD >= 2000
                ? 'nebula'
                : totalValueUSD >= 500
                  ? 'comet'
                  : totalValueUSD >= 50
                    ? 'meteor'
                    : 'stardust';

        const solBonusApplied =
          solBalance >= 10
            ? 100
            : solBalance >= 5
              ? 85
              : solBalance >= 1
                ? 60
                : solBalance >= 0.5
                  ? 40
                  : solBalance >= 0.1
                    ? 20
                    : 0;
        const walletAgeBonus =
          walletAgeDays > 730
            ? 250
            : walletAgeDays > 365
              ? 180
              : walletAgeDays > 180
                ? 120
                : walletAgeDays > 90
                  ? 70
                  : walletAgeDays > 30
                    ? 35
                    : walletAgeDays > 7
                      ? 15
                      : 0;

        const isTxTitan = txCount > 5000;
        const diamondHands = walletAgeDays >= 365 && solBalance >= 1;
        const isOG = walletAgeDays >= 730 && isTxTitan && diamondHands;
        const isWhale = solBalance >= 50;
        const isCollector = nftCount >= 10;
        const isEarlyAdopter = walletAgeDays >= 730;
        const isSolanaMaxi = solBalance >= 100 && txCount > 100;

        const traits: WalletTraits = {
          hasSeeker,
          hasPreorder,
          hasCombo,
          isOG,
          isWhale,
          isCollector,
          isEarlyAdopter,
          isTxTitan,
          isSolanaMaxi,
          isBlueChip,
          isDeFiKing,
          uniqueTokenCount,
          nftCount,
          txCount,
          memeCoinsHeld,
          isMemeLord,
          hyperactiveDegen: avgTxPerDay30d >= 8,
          diamondHands,
          avgTxPerDay30d,
          daysSinceLastTx:
            signatures.length > 0 && signatures[0].blockTime
              ? Math.floor((Date.now() - signatures[0].blockTime * 1000) / (1000 * 60 * 60 * 24))
              : null,
          solBalance,
          solBonusApplied,
          walletAgeDays,
          walletAgeBonus,
          planetTier: 'mercury',
          totalAssetsCount,
          solTier,
          totalValueUSD,
          cosmicRank,
        };

        emitScan('scoring', 80);
        const score = fastProfileAllNotFound ? 0 : calculateScore(traits);

        // Enhanced TX data — fire-and-forget, updates state in background
        const enhancedTxPromise = fetch(`${getHeliusProxyUrl()}/api/enhanced-tx?address=${address}`, {
          headers: getHeliusProxyHeaders(),
          signal: AbortSignal.timeout(8000),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);

        // 9-Tier Planet System + Binary Sun for Combo holders (0-400 scale)
        if (fastProfileAllNotFound) {
          traits.planetTier = 'mercury';
        } else if (traits.hasCombo) {
          traits.planetTier = 'binary_sun';
        } else if (score >= 352) {
          traits.planetTier = 'sun';
        } else if (score >= 320) {
          traits.planetTier = 'jupiter';
        } else if (score >= 280) {
          traits.planetTier = 'saturn';
        } else if (score >= 240) {
          traits.planetTier = 'uranus';
        } else if (score >= 192) {
          traits.planetTier = 'neptune';
        } else if (score >= 140) {
          traits.planetTier = 'earth';
        } else if (score >= 88) {
          traits.planetTier = 'venus';
        } else if (score >= 40) {
          traits.planetTier = 'mars';
        } else {
          traits.planetTier = 'mercury';
        }

        emitScan('done', 100);
        if (cancelled) return;
        const finalData: WalletData = {
          address,
          traits,
          score,
          tier: fastProfileAllNotFound ? null : traits.planetTier,
          isLoading: false,
          error: null,
          isNewWallet: fastProfileAllNotFound || undefined,
        };
        setWalletData(finalData);
        writeWalletDataCache(address, finalData);
        if (isDev)
          // eslint-disable-next-line no-console
          console.log(
            `%c[Scan Final] NFTs: ${nftCount} | Tx: ${txCount} | Score: ${score}`,
            'color: #fff; background: #22d3ee; padding: 4px; border-radius: 4px;',
          );

        // ── Background merges (don't block initial render) ──

        // A) Deep scan: fetch remaining tx pages (2-10) if first page was full
        const deepScanPromise = needsDeepScan
          ? (async () => {
              try {
                let allSigs = [...firstPageSigs];
                let lastSig = firstPageSigs[firstPageSigs.length - 1].signature;
                for (let page = 1; page < 10; page++) {
                  if (cancelled) return null;
                  const sigs = await usedConn.getSignaturesForAddress(publicKey, { limit: 1000, before: lastSig });
                  if (sigs.length === 0) break;
                  allSigs = [...allSigs, ...sigs];
                  lastSig = sigs[sigs.length - 1].signature;
                  if (sigs.length < 1000) break;
                }
                return allSigs;
              } catch {
                return null;
              }
            })()
          : Promise.resolve(null);

        // B) Enhanced TX data
        const enhancedPromise = enhancedTxPromise;

        // Merge both in background
        Promise.all([deepScanPromise, enhancedPromise]).then(([deepSigs, etx]) => {
          if (cancelled) return;
          let changed = false;

          // Merge deep scan — update txCount + walletAge
          if (deepSigs && deepSigs.length > signatures.length) {
            traits.txCount = deepSigs.length;
            const oldest = deepSigs[deepSigs.length - 1];
            if (oldest.blockTime) {
              traits.walletAgeDays = Math.floor((Date.now() - oldest.blockTime * 1000) / (1000 * 60 * 60 * 24));
              traits.walletAgeBonus =
                traits.walletAgeDays > 730
                  ? 250
                  : traits.walletAgeDays > 365
                    ? 180
                    : traits.walletAgeDays > 180
                      ? 120
                      : traits.walletAgeDays > 90
                        ? 70
                        : traits.walletAgeDays > 30
                          ? 35
                          : traits.walletAgeDays > 7
                            ? 15
                            : 0;
            }
            traits.isTxTitan = traits.txCount > 5000;
            traits.isEarlyAdopter = traits.walletAgeDays >= 730;
            traits.isOG =
              traits.walletAgeDays >= 730 && traits.isTxTitan && traits.walletAgeDays >= 365 && traits.solBalance >= 1;
            traits.avgTxPerDay30d = traits.txCount / Math.max(1, Math.min(30, traits.walletAgeDays));
            traits.hyperactiveDegen = traits.avgTxPerDay30d >= 8;
            changed = true;
            // eslint-disable-next-line no-console
            if (isDev) console.log(`%c[Deep Scan] Total tx: ${deepSigs.length}`, 'color: #a855f7;');
          }

          // Merge enhanced TX
          if (etx) {
            if (etx.swapCount != null) {
              traits.swapCount = etx.swapCount;
              changed = true;
            }
            if (etx.nftTradeCount != null) {
              traits.nftTradeCount = etx.nftTradeCount;
              changed = true;
            }
            if (etx.stakingCount != null) {
              traits.stakingCount = etx.stakingCount;
              changed = true;
            }
            if (Array.isArray(etx.defiProtocols)) {
              traits.defiProtocols = etx.defiProtocols;
              changed = true;
            }
            if (etx.isDeFiUser != null) {
              traits.isDeFiUser = etx.isDeFiUser;
              changed = true;
            }
            if (etx.isDeFiKing) {
              traits.isDeFiKing = true;
              changed = true;
            }
          }

          if (changed) {
            // Recalculate planet tier
            const updatedScore = fastProfileAllNotFound ? 0 : calculateScore(traits);
            if (fastProfileAllNotFound) traits.planetTier = 'mercury';
            else if (traits.hasCombo) traits.planetTier = 'binary_sun';
            else if (updatedScore >= 352) traits.planetTier = 'sun';
            else if (updatedScore >= 320) traits.planetTier = 'jupiter';
            else if (updatedScore >= 280) traits.planetTier = 'saturn';
            else if (updatedScore >= 240) traits.planetTier = 'uranus';
            else if (updatedScore >= 192) traits.planetTier = 'neptune';
            else if (updatedScore >= 140) traits.planetTier = 'earth';
            else if (updatedScore >= 88) traits.planetTier = 'venus';
            else if (updatedScore >= 40) traits.planetTier = 'mars';
            else traits.planetTier = 'mercury';

            const updated: WalletData = {
              address,
              traits,
              score: updatedScore,
              tier: fastProfileAllNotFound ? null : traits.planetTier,
              isLoading: false,
              error: null,
              isNewWallet: fastProfileAllNotFound || undefined,
            };
            setWalletData(updated);
            writeWalletDataCache(address, updated);
          }
        });
      } catch (error) {
        console.error('Scan Error:', error);
        if (cancelled) return;
        if (cachedWalletData) {
          setWalletData({
            ...cachedWalletData,
            isLoading: false,
            error: null,
          });
          return;
        }
        if (Capacitor.isNativePlatform() && fastProfileAllNotFound) {
          const fallbackData = buildNewWalletData(address || '');
          emitScan('done', 100);
          setWalletData(fallbackData);
          writeWalletDataCache(address, fallbackData);
          return;
        }
        setWalletData({
          address: address || '',
          traits: null,
          score: 0,
          isLoading: false,
          error: 'Cosmic synchronization failed.',
        });
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  return walletData;
}

function isFungibleAsset(asset: { interface?: string; token_info?: { supply?: number; decimals?: number } }): boolean {
  const iface = (asset.interface || '').toUpperCase();
  if (iface === 'FUNGIBLETOKEN' || iface === 'FUNGIBLEASSET') return true;
  const supply = asset.token_info?.supply || 0;
  const decimals = asset.token_info?.decimals || 0;
  return decimals > 0 || supply > 1;
}

function buildDisconnectedWalletData(): WalletData {
  return { address: '', traits: null, score: 0, isLoading: false, error: null };
}

function buildNewWalletData(address: string): WalletData {
  const traits: WalletTraits = {
    hasSeeker: false,
    hasPreorder: false,
    hasCombo: false,
    isOG: false,
    isWhale: false,
    isCollector: false,
    isEarlyAdopter: false,
    isTxTitan: false,
    isSolanaMaxi: false,
    isBlueChip: false,
    isDeFiKing: false,
    uniqueTokenCount: 0,
    nftCount: 0,
    txCount: 0,
    memeCoinsHeld: [],
    isMemeLord: false,
    hyperactiveDegen: false,
    diamondHands: false,
    avgTxPerDay30d: 0,
    daysSinceLastTx: null,
    solBalance: 0,
    solBonusApplied: 0,
    walletAgeDays: 0,
    walletAgeBonus: 0,
    planetTier: 'mercury',
    totalAssetsCount: 0,
    solTier: null,
    totalValueUSD: 0,
    cosmicRank: 'stardust',
  };

  return {
    address,
    traits,
    score: 0,
    tier: null,
    isLoading: false,
    error: null,
    isNewWallet: true,
  };
}
