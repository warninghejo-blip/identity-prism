import { WalletContextState } from '@solana/wallet-adapter-react';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@/lib/solanaToken';
import { cleanupWalletModals } from '@/lib/safeNavigate';

const headersToRecord = (input?: HeadersInit): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (!input) return headers;
  if (input instanceof Headers) {
    input.forEach((v, k) => { headers[k] = v; });
  } else if (Array.isArray(input)) {
    for (const [k, v] of input) headers[k] = v;
  } else {
    Object.assign(headers, input);
  }
  return headers;
};

const isNativeHttpRetryableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /timeout|timed\s*out|SocketTimeoutException|ECONN|ETIMEDOUT|network|connection|Failed to fetch/i.test(message);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const onAbort = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort();
    else upstreamSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const fetchPromise = (async () => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const bodyText = await response.text();
      return new Response(bodyText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    })();
    fetchPromise.catch(() => undefined);
    return await Promise.race([
      fetchPromise,
      new Promise<Response>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`fetch timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (upstreamSignal) upstreamSignal.removeEventListener('abort', onAbort);
  }
}

// Drop-in fetch replacement that routes through CapacitorHttp on native, then
// falls back to WebView fetch when the native connection pool times out.
async function nativeAwareFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!Capacitor.isNativePlatform()) return fetch(url, init);
  const method = (init?.method || 'GET').toUpperCase();
  const headers = headersToRecord(init?.headers);
  // Pass the body as a raw string and force JSON Content-Type. CapacitorHttp
  // double-serializes object `data` which silently breaks large mint payloads.
  const bodyStr = typeof init?.body === 'string' ? init.body : init?.body ? JSON.stringify(init.body) : undefined;
  if (bodyStr && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  const isMetadataPost = method === 'POST' && /\/metadata(?:$|[/?#])/.test(url);
  const isMintCnftPost = method === 'POST' && /\/mint-cnft(?:$|[/?#])/.test(url);
  const t0 = Date.now();
  console.warn('[nativeAwareFetch] →', method, url, `bodyLen=${bodyStr?.length ?? 0}`);
  if (isMintCnftPost) {
    const fetchInit: RequestInit = {
      ...init,
      method,
      headers,
      body: bodyStr,
    };
    try {
      const response = await fetchWithTimeout(url, fetchInit, 30_000);
      console.warn('[nativeAwareFetch] fetch-first ←', response.status, url, `${Date.now() - t0}ms`);
      return response;
    } catch (fetchFirstError) {
      console.warn(
        '[nativeAwareFetch] fetch-first FAIL; falling back to CapacitorHttp',
        url,
        fetchFirstError instanceof Error ? fetchFirstError.message : String(fetchFirstError),
        `${Date.now() - t0}ms`,
      );
      if (!isNativeHttpRetryableError(fetchFirstError)) throw fetchFirstError;
    }
  }
  try {
    const response = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: bodyStr,
      responseType: 'json',
      connectTimeout: isMetadataPost ? 5_000 : 15_000,
      readTimeout: isMetadataPost ? 12_000 : 60_000,
    });
    console.warn('[nativeAwareFetch] ←', response.status, url, `${Date.now() - t0}ms`);
    const bodyText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    return new Response(bodyText, {
      status: response.status,
      statusText: '',
      headers: response.headers as Record<string, string>,
    });
  } catch (e) {
    console.error('[nativeAwareFetch] FAIL', url, e instanceof Error ? e.message : String(e), `${Date.now() - t0}ms`);
    if (!isNativeHttpRetryableError(e)) throw e;
    await sleep(100 + Math.floor(Math.random() * 250));
    const fallbackInit: RequestInit = {
      ...init,
      method,
      headers,
      body: bodyStr,
    };
    const fallbackStart = Date.now();
    console.warn('[nativeAwareFetch] fallback fetch →', method, url, `bodyLen=${bodyStr?.length ?? 0}`);
    try {
      const fallbackResponse = await fetchWithTimeout(url, fallbackInit, 60_000);
      console.warn('[nativeAwareFetch] fallback fetch ←', fallbackResponse.status, url, `${Date.now() - fallbackStart}ms`);
      return fallbackResponse;
    } catch (fallbackError) {
      console.error(
        '[nativeAwareFetch] fallback fetch FAIL',
        url,
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        `${Date.now() - fallbackStart}ms`,
      );
      throw e;
    }
  }
}
import { Buffer } from 'buffer';
import {
  getAppBaseUrl,
  getHeliusProxyHeaders,
  getHeliusRpcUrl,
  getMetadataBaseUrl,
  getMetadataImageUrl,
  getCollectionMint,
  getCnftMintUrl,
  MINT_CONFIG,
  SEEKER_TOKEN,
} from '@/constants';
import type { WalletTraits } from '@/hooks/useWalletData';
import { toast } from '@/components/ui/sonner';

export interface MintMetadata {
  collection: string;
  collectionMint?: string;
  network: string;
  score: number;
  planetTier: WalletTraits['planetTier'];
  traits: {
    seeker: boolean;
    preorder: boolean;
    combo: boolean;
    blueChip: boolean;
    memeLord: boolean;
    defiKing: boolean;
    hyperactive: boolean;
    diamondHands: boolean;
  };
  stats: {
    tokens: number;
    nfts: number;
    transactions: number;
    solBalance: number;
    walletAgeYears: number;
  };
  timestamp: string;
  address: string;
}

export interface MintIdentityPrismArgs {
  wallet: WalletContextState;
  address: string;
  traits: WalletTraits;
  score: number;
  cardImageUrl?: string;
  paymentToken?: 'SOL' | 'SKR';
  paidWithCoins?: boolean;
  remint?: boolean;
  burnSignature?: string;
  burnAssetId?: string;
}

export interface MintIdentityPrismResult {
  signature: string;
  mint: string;
  metadataUri: string;
  metadata: MintMetadata;
  metadataBase64: string;
}

function encodeBase64(value: string): string {
  if (typeof window !== 'undefined' && window.btoa) {
    return window.btoa(unescape(encodeURIComponent(value)));
  }
  return Buffer.from(value, 'utf-8').toString('base64');
}

const TX_FEE_BUFFER_SOL = 0.003;
const MIN_REQUIRED_SOL = 0.02;
const NATIVE_PRE_SIGN_SIMULATION_TIMEOUT_MS = 5_000;

const stringifyLog = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const describeTransactionSignatures = (transaction: Transaction) =>
  transaction.signatures.map((entry) => ({
    publicKey: entry.publicKey.toBase58(),
    hasSignature: Boolean(entry.signature),
    signaturePrefix: entry.signature ? Buffer.from(entry.signature).toString('base64').slice(0, 18) : null,
  }));

const buildPreflightError = (
  code: 'INSUFFICIENT_SOL' | 'INSUFFICIENT_SKR' | 'SIMULATION_FAILED',
  message: string,
  details?: Record<string, unknown>,
) => {
  const error = new Error(message) as Error & { code?: string } & Record<string, unknown>;
  error.code = code;
  if (details) Object.assign(error, details);
  return error;
};

/**
 * Throw the right error for a failed server-side simulation. Insufficient-funds failures
 * (the most common, e.g. not enough SOL to cover the fee/transfer) are surfaced as the
 * friendly INSUFFICIENT_SOL code instead of a raw SIMULATION_FAILED JSON dump.
 */
const throwSimulationError = (sim: { err: unknown; logs: string[] | null }): never => {
  const haystack = `${JSON.stringify(sim.err ?? '')} ${(sim.logs ?? []).join(' ')}`.toLowerCase();
  if (
    haystack.includes('insufficient')
    || haystack.includes('debit an account but found no record of a prior credit')
  ) {
    throw buildPreflightError('INSUFFICIENT_SOL', 'Insufficient SOL for transaction', {
      simulationError: sim.err,
      logs: sim.logs ?? undefined,
    });
  }
  throw buildPreflightError(
    'SIMULATION_FAILED',
    `Transaction simulation failed: ${JSON.stringify(sim.err)}`,
    { simulationError: sim.err, logs: sim.logs ?? undefined },
  );
};

async function simulateBeforeWalletSign(
  label: string,
  connection: Connection,
  transaction: Transaction,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const simulation = await Promise.race([
      connection.simulateTransaction(transaction, undefined, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('PRE_SIGN_SIMULATION_TIMEOUT')), timeoutMs);
      }),
    ]);
    if (simulation.value.err) {
      console.error(`[${label}] simulation failed`, simulation.value.err, simulation.value.logs);
      throw buildPreflightError(
        'SIMULATION_FAILED',
        `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`,
        { simulationError: simulation.value.err, logs: simulation.value.logs },
      );
    }
    console.warn(`[${label}] pre-sign simulation ok`);
  } catch (simError) {
    if (simError instanceof Error && (simError as any).code === 'SIMULATION_FAILED') {
      throw simError;
    }
    // dApp Store compliance fallback: attempt pre-sign simulation on native too,
    // but allow signing if RPC preflight itself times out or is unavailable.
    console.warn(`[${label}] Could not pre-flight the transaction`, simError);
    toast.warning('Could not pre-flight the transaction', {
      description: 'RPC simulation timed out or was unavailable. Review the wallet preview before signing.',
      duration: 8000,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function confirmTransactionWithPolling(
  connection: Connection,
  signature: string,
  timeoutMs = 60000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const statusResponse = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statusResponse?.value?.[0];
    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return;
    }
    await sleep(2000);
  }
  throw new Error('Transaction confirmation timed out');
}

const isAdminModeEnabled = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('admin') === 'false' || params.has('noadmin')) {
    return false;
  }
  return params.get('admin') === 'true' || params.has('admin');
};

/**
 * Wraps wallet.signTransaction with dismiss detection for mobile wallets (Seeker/MWA).
 * When user swipes away the wallet approval dialog, the app returns to foreground
 * (visibilitychange fires). After a short grace period, we reject if sign hasn't resolved.
 * Also includes a hard timeout as fallback.
 */
async function signWithDismissDetection(
  wallet: { signTransaction?: (tx: Transaction) => Promise<Transaction> },
  transaction: Transaction,
): Promise<Transaction> {
  if (!wallet.signTransaction) {
    throw new Error('Wallet does not support signTransaction');
  }

  const HARD_TIMEOUT_MS = Capacitor.isNativePlatform() ? 300_000 : 120_000;
  const DISMISS_GRACE_MS = Capacitor.isNativePlatform() ? 2_000 : 20_000;

  return new Promise<Transaction>((resolve, reject) => {
    let settled = false;
    let wentToBackground = false;
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (dismissTimer) clearTimeout(dismissTimer);
      if (hardTimer) clearTimeout(hardTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('identityprism:nativeResume', onNativeResume);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const startDismissTimer = () => {
      if (settled || dismissTimer) return;
      dismissTimer = setTimeout(() => {
        settle(() => reject(new Error('USER_REJECTED: Wallet dialog dismissed')));
      }, DISMISS_GRACE_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wentToBackground = true;
      }
      if (document.visibilityState === 'visible' && wentToBackground && !settled) {
        startDismissTimer();
      }
    };

    const onFocus = () => {
      if (wentToBackground && !settled) {
        startDismissTimer();
      }
    };

    const onNativeResume = () => {
      if (!wentToBackground || settled) return;
      setTimeout(() => {
        if (!settled) {
          settle(() => reject(new Error('USER_REJECTED: Wallet dialog dismissed')));
          cleanupWalletModals();
        }
      }, 1_000);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('identityprism:nativeResume', onNativeResume);

    hardTimer = setTimeout(() => {
      settle(() => reject(new Error('USER_REJECTED: Signing timed out')));
    }, HARD_TIMEOUT_MS);

    console.warn('[mint] signTransaction request dispatched');
    wallet.signTransaction!(transaction).then(
      (signed) => {
        console.warn('[mint] signTransaction resolved');
        settle(() => resolve(signed));
      },
      (err) => {
        console.error('[mint] signTransaction rejected', err);
        settle(() => reject(err));
      },
    );
  });
}

const logSendTransactionError = async (error: unknown) => {
  const printable =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: (error as { code?: unknown }).code,
          cause: (error as { cause?: unknown }).cause,
        }
      : error;
  try {
    console.error('[mint] error detail', JSON.stringify(printable));
  } catch {
    console.error('[mint] error detail', printable);
  }
  const candidate = error as { getLogs?: () => Promise<string[] | null> };
  if (candidate?.getLogs) {
    try {
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
      const logs = await Promise.race([candidate.getLogs(), timeout]);
      if (logs?.length) {
        console.error('[mint] transaction logs', logs);
      }
    } catch (logError) {
      console.warn('[mint] failed to read transaction logs', logError);
    }
  }
};

export async function mintIdentityPrism({
  wallet,
  address,
  traits,
  score,
  cardImageUrl,
  paymentToken = 'SOL',
  paidWithCoins = false,
  remint,
  burnSignature,
  burnAssetId,
}: MintIdentityPrismArgs): Promise<MintIdentityPrismResult> {
  const wantsAdminMode = isAdminModeEnabled();
  const heliusRpcUrl = getHeliusRpcUrl(address);
  if (!heliusRpcUrl) {
    throw new Error('Helius API key required for minting');
  }
  const connection = new Connection(heliusRpcUrl, {
    commitment: 'confirmed',
    httpHeaders: getHeliusProxyHeaders(address),
  });
  const payer = wallet.publicKey;
  const metadataBaseUrl = getMetadataBaseUrl();
  if (!metadataBaseUrl) {
    throw new Error('Metadata service URL not configured');
  }
  const imageUrl = getMetadataImageUrl();
  const appBaseUrl = getAppBaseUrl();
  const resolveBaseUrl = (value?: string | null) => (value ? value.replace(/\/+$/, '') : null);
  const resolvedImageUrl = (() => {
    if (cardImageUrl) return cardImageUrl;
    if (imageUrl) return imageUrl;
    const fallbackBase = resolveBaseUrl(appBaseUrl) ?? resolveBaseUrl(metadataBaseUrl) ?? 'https://identityprism.xyz';
    return `${fallbackBase}/phav.png`;
  })();
  const resolvedAppBaseUrl = resolveBaseUrl(appBaseUrl);
  const resolvedExternalUrl = resolvedAppBaseUrl ? `${resolvedAppBaseUrl}/?address=${address}` : undefined;
  const resolvedAnimationUrl = resolvedAppBaseUrl ? `${resolvedAppBaseUrl}/?address=${address}&mode=nft` : undefined;
  const resolveImageContentType = (url: string) => {
    const normalized = url.split('?')[0]?.toLowerCase() ?? '';
    if (normalized.endsWith('.gif')) return 'image/gif';
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
    if (normalized.endsWith('.webp')) return 'image/webp';
    return 'image/png';
  };
  const resolvedImageContentType = resolveImageContentType(resolvedImageUrl);
  const shortAddress = address.slice(0, 4);
  const displayName = `Identity Prism ${shortAddress}`;
  const metadataAppUrl = resolvedAnimationUrl ?? resolvedExternalUrl ?? resolvedAppBaseUrl ?? undefined;
  const collectionMintAddress = getCollectionMint();
  const coreMintUrl = getCnftMintUrl() ?? metadataBaseUrl;
  if (!coreMintUrl) {
    throw new Error('Core mint endpoint is not configured');
  }
  const adminMode = wantsAdminMode;
  const requiresWalletTx = !adminMode;

  if (!wallet || !wallet.publicKey || (requiresWalletTx && !wallet.signTransaction)) {
    throw new Error('Wallet not ready or does not support transactions');
  }

  // For SOL/SKR minting auth is optional. Do not auto-request a fresh JWT here:
  // on Seeker/MWA a second auth/signMessage popup can hang after approval.
  const { ensureJwt, getCachedJwt } = await import('@/components/prism/shared');
  const authToken = paidWithCoins ? await ensureJwt() : getCachedJwt(address);

  let coinReservationRequestId: string | null = null;

  // ── Coins payment: reserve 10,000 coins before proceeding ──
  if (paidWithCoins) {
    if (!authToken) {
      throw new Error('Authentication required for coins payment. Please try again.');
    }
    console.warn('[mint-for-coins] sending request', { address, baseUrl: coreMintUrl, ts: Date.now() });
    const t0 = performance.now();
    const coinsMintRes = await nativeAwareFetch(`${coreMintUrl}/api/prism/mint-for-coins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ address }),
    });
    const elapsed = Math.round(performance.now() - t0);
    console.warn('[mint-for-coins] response', { status: coinsMintRes.status, ok: coinsMintRes.ok, elapsedMs: elapsed });
    if (!coinsMintRes.ok) {
      const errorText = await coinsMintRes.text();
      let errorMessage = `Coins deduction failed: ${coinsMintRes.status}`;
      try {
        const errorJson = JSON.parse(errorText) as { error?: string; message?: string };
        errorMessage = errorJson.error ?? errorJson.message ?? errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    const coinsPayload = (await coinsMintRes.json()) as {
      proceedWithMint?: boolean;
      error?: string;
      requestId?: string;
    };
    if (!coinsPayload.proceedWithMint) {
      throw new Error(coinsPayload.error ?? 'Coins deduction rejected by server. Please check your balance.');
    }
    if (!coinsPayload.requestId) {
      throw new Error('Coins reservation missing requestId');
    }
    coinReservationRequestId = coinsPayload.requestId;
    console.warn('[mint] coins payment reserved — skipping SOL payment step');
  }

  const parseOptionalPublicKey = (value: string | null, label: string) => {
    if (!value) return null;
    try {
      return new PublicKey(value);
    } catch {
      throw new Error(`${label} is not a valid public key`);
    }
  };

  const collectionMint = parseOptionalPublicKey(collectionMintAddress, 'VITE_COLLECTION_MINT');
  const metadata: MintMetadata = {
    collection: MINT_CONFIG.COLLECTION,
    collectionMint: collectionMint?.toBase58(),
    network: MINT_CONFIG.NETWORK,
    score,
    planetTier: traits.planetTier,
    traits: {
      seeker: traits.hasSeeker,
      preorder: traits.hasPreorder,
      combo: traits.hasCombo,
      blueChip: traits.isBlueChip,
      memeLord: traits.isMemeLord,
      defiKing: traits.isDeFiKing,
      hyperactive: traits.hyperactiveDegen,
      diamondHands: traits.diamondHands,
    },
    stats: {
      tokens: traits.uniqueTokenCount,
      nfts: traits.nftCount,
      transactions: traits.txCount,
      solBalance: traits.solBalance,
      walletAgeYears: Math.floor(traits.walletAgeDays / 365),
    },
    timestamp: new Date().toISOString(),
    address,
  };

  const metadataJson = {
    name: displayName,
    symbol: MINT_CONFIG.SYMBOL ?? 'PRISM',
    description: 'Identity Prism — a living Solana identity card built from your on-chain footprint.',
    image: resolvedImageUrl,
    external_url: resolvedExternalUrl ?? metadataAppUrl,
    animation_url: resolvedAnimationUrl ?? metadataAppUrl,
    attributes: [
      { trait_type: 'Tier', value: traits.planetTier },
      { trait_type: 'Score', value: score.toString() },
      { trait_type: 'Origin', value: 'Identity Prism' },
      { trait_type: 'NFTs', value: traits.nftCount },
      { trait_type: 'Tokens', value: traits.uniqueTokenCount },
      { trait_type: 'Transactions', value: traits.txCount },
      { trait_type: 'Wallet Age (days)', value: traits.walletAgeDays },
    ],
    properties: {
      files: [
        { uri: resolvedImageUrl, type: resolvedImageContentType },
        ...(metadataAppUrl ? [{ uri: metadataAppUrl, type: 'text/html' }] : []),
      ],
      category: 'html',
    },
  };

  const metadataUploadStartedAt = performance.now();
  console.warn(
    '[mint] metadata upload start',
    stringifyLog({
      metadataBaseUrl,
      name: metadataJson.name,
      hasAuthToken: Boolean(authToken),
    }),
  );
  const metadataResponse = await nativeAwareFetch(`${metadataBaseUrl}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    body: JSON.stringify(metadataJson),
  });

  if (!metadataResponse.ok) {
    const errorText = await metadataResponse.text();
    console.error(
      '[mint] metadata upload failed',
      stringifyLog({
        status: metadataResponse.status,
        statusText: metadataResponse.statusText,
        elapsedMs: Math.round(performance.now() - metadataUploadStartedAt),
        body: errorText,
        metadataBaseUrl,
      }),
    );
    throw new Error(`Metadata upload failed: ${metadataResponse.status} ${errorText || metadataResponse.statusText}`);
  }
  const metadataPayload = (await metadataResponse.json()) as { uri?: string };
  console.warn(
    '[mint] metadata upload response',
    stringifyLog({
      elapsedMs: Math.round(performance.now() - metadataUploadStartedAt),
      hasUri: Boolean(metadataPayload.uri),
    }),
  );
  const metadataUri = metadataPayload.uri;
  if (!metadataUri) {
    throw new Error('Metadata URI not returned');
  }

  if (!collectionMint) {
    throw new Error('Collection mint is required for core minting');
  }

  // SKR balance preflight check — fail early before opening wallet
  if (paymentToken === 'SKR' && requiresWalletTx) {
    const skrMintKey = new PublicKey(SEEKER_TOKEN.MINT);
    let skrBalance = 0;
    for (const progId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      try {
        const ata = await getAssociatedTokenAddress(skrMintKey, payer, false, progId);
        const info = await connection.getTokenAccountBalance(ata);
        skrBalance = Number(info.value.uiAmount ?? 0);
        break;
      } catch {
        // ATA doesn't exist under this program, try next
      }
    }
    // We don't know the exact SKR amount until the server computes the quote,
    // but we can at least check the user has *some* SKR.
    if (skrBalance <= 0) {
      throw buildPreflightError('INSUFFICIENT_SKR', 'No SKR tokens in wallet', {
        skrBalance,
        requiredSkr: 1,
      });
    }
  }

  const prepareRequestId = coinReservationRequestId
    || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `mint_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  const mintPayload = {
    requestId: prepareRequestId,
    owner: address,
    metadataUri,
    name: metadataJson.name,
    symbol: metadataJson.symbol,
    sellerFeeBasisPoints: MINT_CONFIG.SELLER_FEE_BASIS_POINTS ?? 0,
    collectionMint: collectionMint.toBase58(),
    admin: adminMode,
    paymentToken,
    score: metadata.score,
    tier: metadata.planetTier,
    traits: metadata.traits,
    stats: metadata.stats,
    ...(remint
      ? { remint: true, ...(burnSignature ? { burnSignature } : {}), ...(burnAssetId ? { burnAssetId } : {}) }
      : {}),
    ...(paidWithCoins ? { paidWithCoins: true } : {}),
  };
  console.warn(
    '[mint] sending mint-cnft payload',
    stringifyLog({
      coreMintUrl,
      remint,
      paidWithCoins,
      burnAssetId: burnAssetId?.slice(0, 16),
      owner: mintPayload.owner,
      collectionMint: mintPayload.collectionMint,
      paymentToken: mintPayload.paymentToken,
      payloadKeys: Object.keys(mintPayload),
    }),
  );

  const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) authHeaders['Authorization'] = `Bearer ${authToken}`;

  const cnftResponse = await nativeAwareFetch(`${coreMintUrl}/mint-cnft`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(mintPayload),
  });

  if (!cnftResponse.ok) {
    const errorText = await cnftResponse.text();
    console.error(
      '[mint] core mint failed',
      stringifyLog({
        status: cnftResponse.status,
        statusText: cnftResponse.statusText,
        body: errorText,
        coreMintUrl,
      }),
    );
    throw new Error(`Core mint failed: ${cnftResponse.status} ${errorText || cnftResponse.statusText}`);
  }

  const cnftPayload = (await cnftResponse.json()) as {
    transaction?: string;
    assetId?: string;
    signature?: string;
    signatures?: Record<string, string>;
    admin?: boolean;
    requestId?: string;
    finalize?: boolean;
    finalized?: boolean;
    simulation?: { ok: boolean; err: unknown; logs: string[] | null };
  };
  console.warn(
    '[mint] mint-cnft response',
    stringifyLog({
      requestId: cnftPayload.requestId,
      assetId: cnftPayload.assetId,
      hasTransaction: Boolean(cnftPayload.transaction),
      transactionLength: cnftPayload.transaction?.length ?? 0,
      admin: cnftPayload.admin,
      finalize: cnftPayload.finalize,
      finalized: cnftPayload.finalized,
      serverSignatureKeys: cnftPayload.signatures ? Object.keys(cnftPayload.signatures) : [],
    }),
  );
  if (adminMode && cnftPayload.signature) {
    return {
      signature: cnftPayload.signature,
      mint: cnftPayload.assetId ?? cnftPayload.signature,
      metadataUri,
      metadata,
      metadataBase64: encodeBase64(JSON.stringify(metadata)),
    };
  }
  if (!cnftPayload.transaction) {
    throw new Error('Core mint transaction missing');
  }

  const transaction = Transaction.from(Buffer.from(cnftPayload.transaction, 'base64'));

  if (!wallet.signTransaction) {
    throw new Error('Wallet does not support signTransaction required for core minting');
  }

  const requestId = cnftPayload.requestId;
  const compiledMessage = transaction.compileMessage();
  const requiredSigners = compiledMessage.accountKeys
    .slice(0, compiledMessage.header.numRequiredSignatures)
    .map((key) => key.toBase58());
  const signatureMap = new Map(transaction.signatures.map((entry) => [entry.publicKey.toBase58(), entry.signature]));
  transaction.signatures = requiredSigners.map((signer) => ({
    publicKey: new PublicKey(signer),
    signature: signatureMap.get(signer) ?? null,
  }));
  console.warn(
    '[mint] prepared transaction',
    stringifyLog({
      requestId,
      feePayer: transaction.feePayer?.toBase58() ?? null,
      recentBlockhash: transaction.recentBlockhash,
      requiredSigners,
      signatures: describeTransactionSignatures(transaction),
      instructionCount: transaction.instructions.length,
    }),
  );
  if (!requestId) {
    throw new Error('Mint requestId missing from server response');
  }

  if (requiresWalletTx) {
    {
      // SOL balance preflight — runs on web AND native so an empty wallet gets a clear
      // "Insufficient SOL" toast instead of an opaque RPC/simulation error. getFeeForMessage is
      // slow/unreliable on the throttled native WebView, so use a fixed fee estimate there.
      const isNative = Capacitor.isNativePlatform();
      let feeLamports = 5000;
      if (!isNative) {
        try {
          const feeForMessage = await connection.getFeeForMessage(transaction.compileMessage());
          feeLamports = feeForMessage.value ?? 5000;
        } catch {
          feeLamports = 5000;
        }
      }
      // Remint and coins-paid modes have no SOL payment — only rent + tx fee are required
      const configuredLamports =
        remint || paidWithCoins ? 0 : paymentToken === 'SOL' ? Math.round(MINT_CONFIG.PRICE_SOL * LAMPORTS_PER_SOL) : 0;
      const transferLamports = transaction.instructions.reduce((total, instruction) => {
        if (!instruction.programId.equals(SystemProgram.programId)) return total;
        try {
          const type = SystemInstruction.decodeInstructionType(instruction);
          if (type === 'Transfer') {
            const decoded = SystemInstruction.decodeTransfer(instruction);
            return decoded.fromPubkey.equals(payer) ? total + decoded.lamports : total;
          }
          if (type === 'TransferWithSeed') {
            const decoded = SystemInstruction.decodeTransferWithSeed(instruction);
            return decoded.fromPubkey.equals(payer) ? total + decoded.lamports : total;
          }
          if (type === 'CreateAccount') {
            const decoded = SystemInstruction.decodeCreateAccount(instruction);
            return decoded.fromPubkey.equals(payer) ? total + decoded.lamports : total;
          }
          if (type === 'CreateAccountWithSeed') {
            const decoded = SystemInstruction.decodeCreateAccountWithSeed(instruction);
            return decoded.fromPubkey.equals(payer) ? total + decoded.lamports : total;
          }
        } catch {
          return total;
        }
        return total;
      }, 0);
      const baseLamports = Math.max(configuredLamports, transferLamports);
      const bufferedLamports = baseLamports + feeLamports + Math.round(TX_FEE_BUFFER_SOL * LAMPORTS_PER_SOL);
      const minRequiredLamports = Math.round(MIN_REQUIRED_SOL * LAMPORTS_PER_SOL);
      const requiredLamports = Math.max(bufferedLamports, minRequiredLamports);
      let balanceLamports = -1;
      try {
        balanceLamports = await connection.getBalance(payer);
      } catch {
        balanceLamports = -1; // balance unknown (RPC failed) → don't block, let simulation handle it
      }
      if (balanceLamports >= 0 && balanceLamports < requiredLamports) {
        throw buildPreflightError('INSUFFICIENT_SOL', 'Insufficient SOL for transaction', {
          requiredLamports,
          balanceLamports,
          feeLamports,
        });
      }
    }

    // Prefer the server-side simulation verdict (the on-device simulate times out on throttled
    // mobile networks); fall back to an on-device simulate only if the server didn't supply one.
    if (cnftPayload.simulation) {
      if (!cnftPayload.simulation.ok) {
        throwSimulationError(cnftPayload.simulation);
      }
      console.warn('[mint] server-side simulation OK; skipping client preflight');
    } else {
      await simulateBeforeWalletSign(
        'mint',
        connection,
        transaction,
        Capacitor.isNativePlatform() ? NATIVE_PRE_SIGN_SIMULATION_TIMEOUT_MS : 20_000,
      );
    }
  }

  let signature = '';
  try {
    const serializeTransaction = transaction.serialize.bind(transaction);
    transaction.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
      serializeTransaction({
        ...config,
        requireAllSignatures: false,
        verifySignatures: false,
      })) as typeof transaction.serialize;
    const signedTransaction = await signWithDismissDetection(wallet, transaction);
    const signedSignatures = describeTransactionSignatures(signedTransaction);
    const signatureVerify =
      typeof signedTransaction.verifySignatures === 'function' ? signedTransaction.verifySignatures(false) : null;
    console.warn(
      '[mint] wallet signature returned',
      stringifyLog({
        requestId,
        walletSigner: wallet.publicKey?.toBase58() ?? null,
        signatureCount: signedTransaction.signatures.length,
        signatures: signedSignatures,
        verifySignaturesFalse: signatureVerify,
      }),
    );
    const walletSigner = wallet.publicKey?.toBase58();
    if (walletSigner) {
      const walletSignature = signedTransaction.signatures.find((entry) => entry.publicKey.toBase58() === walletSigner);
      if (!walletSignature?.signature) {
        throw new Error(`Wallet signature missing for ${walletSigner}`);
      }
    }

    const signedTransactionBase64 = signedTransaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');
    console.warn(
      '[mint] finalize submit',
      stringifyLog({
        requestId,
        owner: payer.toBase58(),
        signedTransactionLength: signedTransactionBase64.length,
        signatures: signedSignatures,
      }),
    );
    const finalizeResponse = await nativeAwareFetch(`${coreMintUrl}/mint-cnft`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        requestId,
        owner: payer.toBase58(),
        signedTransaction: signedTransactionBase64,
      }),
    });
    if (!finalizeResponse.ok) {
      const errorText = await finalizeResponse.text();
      console.error(
        '[mint] finalize failed',
        stringifyLog({
          requestId,
          status: finalizeResponse.status,
          statusText: finalizeResponse.statusText,
          body: errorText,
        }),
      );
      throw new Error(`Mint finalize failed: ${finalizeResponse.status} ${errorText || finalizeResponse.statusText}`);
    }
    const finalizePayload = (await finalizeResponse.json()) as { signature?: string };
    console.warn('[mint] finalize response', stringifyLog({ requestId, ...finalizePayload }));
    if (!finalizePayload.signature) {
      throw new Error('Mint finalize response missing signature');
    }
    signature = finalizePayload.signature;
  } catch (error) {
    await logSendTransactionError(error);
    throw error;
  }
  await confirmTransactionWithPolling(connection, signature);

  return {
    signature,
    mint: cnftPayload.assetId ?? signature,
    metadataUri,
    metadata,
    metadataBase64: encodeBase64(JSON.stringify(metadata)),
  };
}

/**
 * Find and burn an existing Identity Prism NFT, then mint a new one for free.
 * Combined burn+mint in a single transaction — user signs once.
 * Steps:
 * 1. Query DAS for existing Identity Prism in wallet (by collection)
 * 2. Send burnAssetId to server — server builds combined burn+mint tx
 * 3. User signs the combined tx once
 */
export async function remintIdentityPrism(
  args: MintIdentityPrismArgs,
): Promise<MintIdentityPrismResult & { burnedAssetId: string }> {
  const { wallet, address } = args;
  if (!wallet.publicKey || !wallet.signTransaction || !wallet.sendTransaction) {
    throw new Error('Wallet not connected or does not support required transaction methods');
  }

  const heliusRpcUrl = getHeliusRpcUrl(address);
  if (!heliusRpcUrl) throw new Error('Helius API key required');

  const collectionMintAddress = getCollectionMint();
  if (!collectionMintAddress) throw new Error('Collection mint not configured');

  // 1. Find existing Identity Prism NFT via DAS
  const dasResponse = await fetch(heliusRpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getHeliusProxyHeaders(address) ?? {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'remint-find',
      method: 'getAssetsByOwner',
      params: { ownerAddress: address, page: 1, limit: 1000 },
    }),
  });
  if (!dasResponse.ok) throw new Error(`DAS API error: ${dasResponse.status}`);
  const dasData = (await dasResponse.json()) as {
    result?: {
      items: Array<{ id: string; interface?: string; grouping?: Array<{ group_key: string; group_value: string }> }>;
    };
  };
  const assets = dasData.result?.items ?? [];
  const matchingAssets = assets.filter((a) =>
    a.grouping?.some((g) => g.group_key === 'collection' && g.group_value === collectionMintAddress),
  );
  // Prefer Core assets (burnV1 only works with MplCoreAsset); fall back to any matching asset
  const coreAsset = matchingAssets.find((a) => a.interface === 'MplCoreAsset');
  const existingCard = coreAsset ?? matchingAssets[0];
  if (!existingCard) {
    throw new Error('No existing Identity Prism card found in this wallet. Use regular mint instead.');
  }
  if (!coreAsset && existingCard) {
    console.warn('[remint] found legacy cNFT instead of Core asset — burn may fail', {
      id: existingCard.id,
      interface: existingCard.interface,
    });
  }

  const assetId = existingCard.id;
  console.warn('[remint] found asset to burn', { assetId, interface: existingCard.interface });

  // 2. Combined burn+mint in one transaction — server builds both instructions
  const mintResult = await mintIdentityPrism({
    ...args,
    remint: true,
    burnAssetId: assetId,
  });

  return {
    ...mintResult,
    burnedAssetId: assetId,
  };
}

/**
 * Update existing Identity Prism NFT in-place (no burn/create).
 * Server signs with collection authority — user pays nothing.
 * Metadata (name, URI, image) is updated on the same NFT account.
 */
export interface UpdateIdentityPrismArgs {
  wallet: WalletContextState;
  address: string;
  traits: WalletTraits;
  score: number;
  cardImageUrl?: string;
}

export interface UpdateIdentityPrismResult {
  signature: string;
  assetId: string;
  metadataUri: string;
}

export async function updateIdentityPrism({
  wallet,
  address,
  traits,
  score,
  cardImageUrl,
}: UpdateIdentityPrismArgs): Promise<UpdateIdentityPrismResult> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Wallet not connected or does not support signTransaction');
  }

  const metadataBaseUrl = getMetadataBaseUrl();
  if (!metadataBaseUrl) throw new Error('Metadata service URL not configured');
  const appBaseUrl = (getAppBaseUrl() ?? 'https://identityprism.xyz').replace(/\/+$/, '');
  const collectionMintAddress = getCollectionMint();
  if (!collectionMintAddress) throw new Error('Collection mint not configured');
  const coreMintUrl = getCnftMintUrl() ?? metadataBaseUrl;
  if (!coreMintUrl) throw new Error('Core mint endpoint is not configured');

  // /api/update-card now REQUIRES a JWT bound to the owner address (the server
  // co-signs with the collection authority — anonymous access was a security
  // hole). Prefer the cached token to avoid a fresh SIWS popup on Seeker/MWA;
  // fall back to ensureJwt() only when no cached token exists.
  const { ensureJwt, fetchApiJson, getCachedJwt, postApiJson } = await import('@/components/prism/shared');
  const authToken = getCachedJwt(address) ?? (await ensureJwt());
  if (!authToken) {
    throw new Error('Authentication required to update your card. Please reconnect your wallet and try again.');
  }
  const updateAuthHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };

  const heliusRpcUrl = getHeliusRpcUrl(address);
  if (!heliusRpcUrl) throw new Error('Helius API key required');

  // Per-step timeout helper — any hung step throws after N seconds with a clear
  // tag so the UI surfaces which step failed instead of sitting on UPDATING.
  const withTimeout = async <T,>(label: string, p: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const result = await Promise.race([
        p,
        new Promise<T>((_, rej) => {
          timer = setTimeout(() => rej(new Error(`[update] STEP_TIMEOUT ${label} after ${ms}ms`)), ms);
        }),
      ]);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // 1. Find existing Core NFT. On Seeker WebView, the direct client DAS
  // fetch can hang indefinitely even when the same RPC succeeds off-device.
  // Use the server summary as the fast path; /api/update-card still verifies
  // ownership with DAS before preparing the transaction.
  console.warn('[update] step 1/5 — GET /api/prism/summary');
  const t0 = Date.now();
  const summaryData = await withTimeout(
    'summary_fetch',
    fetchApiJson<{ mint?: { minted?: boolean; assetId?: string | null; metadataUri?: string | null } }>(
      `${coreMintUrl}/api/prism/summary?address=${encodeURIComponent(address)}`,
      {
        headers: updateAuthHeaders,
        timeoutMs: 20_000,
      },
    ),
    22_000,
  );
  console.warn('[update] step 1/5 summary responded in', Date.now() - t0, 'ms status 200');
  const assetId = summaryData.mint?.assetId;
  if (!summaryData.mint?.minted || !assetId) {
    console.warn('[update] summary had no minted Core asset', stringifyLog(summaryData.mint));
    throw new Error('No existing Identity Prism Core NFT found. Use regular mint instead.');
  }
  console.warn('[update] found Core asset from summary', { assetId });

  // 2. Upload fresh metadata so the in-place Core update changes metadataUri
  // and reflects current score/traits in the NFT JSON.
  const resolvedImageUrl = cardImageUrl || `${appBaseUrl}/phav.png`;
  const resolvedExternalUrl = `${appBaseUrl}/?address=${address}`;
  const resolvedAnimationUrl = `${appBaseUrl}/?address=${address}&mode=nft`;
  const resolveImageContentType = (url: string) => {
    const n = url.split('?')[0]?.toLowerCase() ?? '';
    if (n.endsWith('.gif')) return 'image/gif';
    if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
    if (n.endsWith('.webp')) return 'image/webp';
    return 'image/png';
  };
  const shortAddress = address.slice(0, 4);
  const displayName = `Identity Prism ${shortAddress}`;
  const metadataJson = {
    name: displayName,
    symbol: MINT_CONFIG.SYMBOL ?? 'PRISM',
    description: 'Identity Prism — a living Solana identity card built from your on-chain footprint.',
    image: resolvedImageUrl,
    external_url: resolvedExternalUrl,
    animation_url: resolvedAnimationUrl,
    attributes: [
      { trait_type: 'Tier', value: traits.planetTier },
      { trait_type: 'Score', value: score.toString() },
      { trait_type: 'Origin', value: 'Identity Prism' },
      { trait_type: 'NFTs', value: traits.nftCount },
      { trait_type: 'Tokens', value: traits.uniqueTokenCount },
      { trait_type: 'Transactions', value: traits.txCount },
      { trait_type: 'Wallet Age (days)', value: traits.walletAgeDays },
    ],
    properties: {
      files: [
        { uri: resolvedImageUrl, type: resolveImageContentType(resolvedImageUrl) },
        { uri: resolvedAnimationUrl, type: 'text/html' },
      ],
      category: 'html',
    },
  };

  console.warn('[update] step 2/5 — POST /metadata');
  const t2 = Date.now();
  const metadataUpload = await withTimeout(
    'metadata_upload',
    postApiJson<{ uri?: string }>(`${metadataBaseUrl}/metadata`, metadataJson, {
      headers: updateAuthHeaders,
      timeoutMs: 30_000,
    }),
    45_000,
  );
  const metadataUri = metadataUpload.uri;
  if (!metadataUri) throw new Error('Metadata URI not returned');
  console.warn('[update] step 2/5 metadata URI ready in', Date.now() - t2, 'ms', metadataUri);

  // 3. Phase 1: get partially-signed tx from server
  console.warn('[update] step 3/5 — POST /api/update-card prepare', { assetId: assetId.slice(0, 16), name: displayName });
  const t3 = Date.now();
  const prepareData = await withTimeout(
    'prepare_fetch',
    postApiJson<{ transaction?: string; feeSol?: number; simulation?: { ok: boolean; err: unknown; logs: string[] | null } }>(
      `${coreMintUrl}/api/update-card`,
      { ownerAddress: address, assetId, metadataUri, name: displayName },
      { headers: updateAuthHeaders, timeoutMs: 30_000 },
    ),
    45_000,
  );
  console.warn('[update] step 3/5 prepare responded in', Date.now() - t3, 'ms status 200');
  if (!prepareData.transaction) throw new Error('Update transaction missing from server');

  // 4. User signs the transaction (pays service fee + network fee)
  const transaction = Transaction.from(Buffer.from(prepareData.transaction, 'base64'));

  // Simulate before signing (dApp Store compliance)
  console.warn('[update] step 4/5 — simulate + getLatestBlockhash');
  const t4 = Date.now();
  const updateConn = new Connection(heliusRpcUrl, 'confirmed');
  // Prefer the server-side simulation verdict: the on-device web3.js simulate goes over the
  // WebView fetch on a throttled mobile network and times out (PRE_SIGN_SIMULATION_TIMEOUT),
  // so it can never actually validate. The server simulated this exact tx with its fast RPC.
  // Only fall back to an on-device simulate if the server didn't include a result.
  if (prepareData.simulation) {
    if (!prepareData.simulation.ok) {
      throwSimulationError(prepareData.simulation);
    }
    console.warn('[update] step 4/5 server-side simulation OK; skipping client preflight');
  } else {
    await simulateBeforeWalletSign(
      'update',
      updateConn,
      transaction,
      Capacitor.isNativePlatform() ? NATIVE_PRE_SIGN_SIMULATION_TIMEOUT_MS : 20_000,
    );
  }
  // IMPORTANT: keep the server-prepared blockhash on ALL platforms. The server
  // binds the finalize co-signing step to the exact message it prepared (hash
  // check) — mutating the blockhash here would change the message and the
  // server would rightly reject the finalize as tampered.
  console.warn('[update] step 4/5 simulate done in', Date.now() - t4, 'ms; calling signTransaction next');

  // Patch serialize so wallet adapter doesn't reject due to missing colAuth sig
  // (same pattern as mint-cnft — MWA internally calls serialize())
  const origSerialize = transaction.serialize.bind(transaction);
  transaction.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
    origSerialize({
      ...config,
      requireAllSignatures: false,
      verifySignatures: false,
    })) as typeof transaction.serialize;
  console.warn('[update] step 5/5 — wallet.signTransaction (popup expected)');
  const t5 = Date.now();
  const signed = await signWithDismissDetection(wallet, transaction);
  console.warn('[update] step 5/5 signed in', Date.now() - t5, 'ms; finalizing');

  // 5. Phase 2: send signed tx back to server for co-signing & submission
  const serialized = signed.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const result = await withTimeout(
    'finalize_fetch',
    postApiJson<{ signature?: string; assetId?: string }>(
      `${coreMintUrl}/api/update-card`,
      {
      ownerAddress: address,
      assetId,
      metadataUri,
      name: displayName,
      signedTransaction: serialized,
      },
      { headers: updateAuthHeaders, timeoutMs: 35_000 },
    ),
    55_000,
  );
  if (!result.signature) throw new Error('Update signature missing');

  return { signature: result.signature, assetId, metadataUri };
}
