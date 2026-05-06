import { WalletContextState } from '@solana/wallet-adapter-react';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── JWT Auth Helper (persisted in sessionStorage — sign once per session) ──
const JWT_STORAGE_KEY = 'ip_auth_jwt';
const scopedJwtStorageKey = (baseUrl: string, address: string) => `${JWT_STORAGE_KEY}:${baseUrl}:${address}`;

function loadCachedJwt(baseUrl: string, address: string): { token: string; address: string; expiresAt: number } | null {
  try {
    const raw = typeof window !== 'undefined' ? sessionStorage.getItem(scopedJwtStorageKey(baseUrl, address)) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; address: string; expiresAt: number };
    if (parsed.address === address && parsed.expiresAt > Date.now() + 60_000) return parsed;
    sessionStorage.removeItem(scopedJwtStorageKey(baseUrl, address));
  } catch {
    /* ignore */
  }
  return null;
}

function saveCachedJwt(baseUrl: string, entry: { token: string; address: string; expiresAt: number }) {
  try {
    sessionStorage.setItem(scopedJwtStorageKey(baseUrl, entry.address), JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

async function getAuthToken(
  wallet: { publicKey?: PublicKey | null; signMessage?: (message: Uint8Array) => Promise<Uint8Array> },
  baseUrl: string,
): Promise<string | null> {
  const address = wallet.publicKey?.toBase58();
  if (!address || !wallet.signMessage) return null;

  // Return cached token (memory or sessionStorage) if still valid
  const cached = loadCachedJwt(baseUrl, address);
  if (cached) return cached.token;

  try {
    // 1. Get challenge
    const challengeRes = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!challengeRes.ok) return null;
    const { nonce, message } = (await challengeRes.json()) as { nonce: string; message: string };

    // 2. Sign the challenge message
    const msgBytes = new TextEncoder().encode(message);
    const signatureBytes = await wallet.signMessage(msgBytes);
    const signatureBase64 = Buffer.from(signatureBytes).toString('base64');

    // 3. Exchange for JWT
    const tokenRes = await fetch(`${baseUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, nonce, signature: signatureBase64 }),
    });
    if (!tokenRes.ok) return null;
    const { token } = (await tokenRes.json()) as { token: string };

    const entry = { token, address, expiresAt: Date.now() + 55 * 60 * 1000 };
    saveCachedJwt(baseUrl, entry);
    console.info('[auth] JWT obtained (cached for session)');
    return token;
  } catch (e) {
    console.warn('[auth] JWT flow failed, proceeding without auth', e);
    return null;
  }
}

const TX_FEE_BUFFER_SOL = 0.003;
const MIN_REQUIRED_SOL = 0.02;

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

  const HARD_TIMEOUT_MS = 120_000;
  const DISMISS_GRACE_MS = 3_000;

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

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    hardTimer = setTimeout(() => {
      settle(() => reject(new Error('USER_REJECTED: Signing timed out')));
    }, HARD_TIMEOUT_MS);

    wallet.signTransaction!(transaction).then(
      (signed) => settle(() => resolve(signed)),
      (err) => settle(() => reject(err)),
    );
  });
}

const logSendTransactionError = async (error: unknown) => {
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

  if (!wallet || !wallet.publicKey || (requiresWalletTx && !wallet.sendTransaction)) {
    throw new Error('Wallet not ready or does not support transactions');
  }

  // Obtain JWT auth token (non-blocking — proceeds without if signMessage unavailable)
  const authToken = await getAuthToken(wallet, coreMintUrl);

  let coinReservationRequestId: string | null = null;

  // ── Coins payment: reserve 10,000 coins before proceeding ──
  if (paidWithCoins) {
    if (!authToken) {
      throw new Error('Authentication required for coins payment. Please try again.');
    }
    const coinsMintRes = await fetch(`${coreMintUrl}/api/prism/mint-for-coins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ address }),
    });
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
    console.info('[mint] coins payment reserved — skipping SOL payment step');
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

  const metadataResponse = await fetch(`${metadataBaseUrl}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    body: JSON.stringify(metadataJson),
  });

  if (!metadataResponse.ok) {
    const errorText = await metadataResponse.text();
    console.error('[mint] metadata upload failed', {
      status: metadataResponse.status,
      statusText: metadataResponse.statusText,
      body: errorText,
      metadataBaseUrl,
    });
    throw new Error(`Metadata upload failed: ${metadataResponse.status} ${errorText || metadataResponse.statusText}`);
  }
  const metadataPayload = (await metadataResponse.json()) as { uri?: string };
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

  const mintPayload = {
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
    ...(coinReservationRequestId ? { requestId: coinReservationRequestId } : {}),
  };
  console.info('[mint] sending mint-cnft payload', {
    coreMintUrl,
    remint,
    paidWithCoins,
    burnAssetId: burnAssetId?.slice(0, 16),
    payloadKeys: Object.keys(mintPayload),
  });

  const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) authHeaders['Authorization'] = `Bearer ${authToken}`;

  const cnftResponse = await fetch(`${coreMintUrl}/mint-cnft`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(mintPayload),
  });

  if (!cnftResponse.ok) {
    const errorText = await cnftResponse.text();
    console.error('[mint] core mint failed', {
      status: cnftResponse.status,
      statusText: cnftResponse.statusText,
      body: errorText,
      coreMintUrl,
    });
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
  };
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
  console.info('[mint] required signers', requiredSigners);
  if (!requestId) {
    throw new Error('Mint requestId missing from server response');
  }

  if (requiresWalletTx) {
    const feeForMessage = await connection.getFeeForMessage(transaction.compileMessage());
    const feeLamports = feeForMessage.value ?? 0;
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
    const balanceLamports = await connection.getBalance(payer);
    if (balanceLamports < requiredLamports) {
      throw buildPreflightError('INSUFFICIENT_SOL', 'Insufficient SOL for transaction', {
        requiredLamports,
        balanceLamports,
        feeLamports,
      });
    }

    try {
      const simulation = await connection.simulateTransaction(transaction, undefined, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      if (simulation.value.err) {
        console.error('[mint] simulation failed', simulation.value.err, simulation.value.logs);
        throw buildPreflightError(
          'SIMULATION_FAILED',
          `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`,
          { simulationError: simulation.value.err, logs: simulation.value.logs },
        );
      }
    } catch (simError) {
      // Re-throw our own preflight errors (simulation failed)
      if (simError instanceof Error && (simError as any).code === 'SIMULATION_FAILED') {
        throw simError;
      }
      // Network / RPC errors — log but allow through (server already validated the tx)
      console.warn('[mint] simulateTransaction network error', simError);
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
    const walletSigner = wallet.publicKey?.toBase58();
    if (walletSigner) {
      const walletSignature = signedTransaction.signatures.find((entry) => entry.publicKey.toBase58() === walletSigner);
      if (!walletSignature?.signature) {
        throw new Error(`Wallet signature missing for ${walletSigner}`);
      }
    }

    const finalizeResponse = await fetch(`${coreMintUrl}/mint-cnft`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        requestId,
        owner: payer.toBase58(),
        signedTransaction: signedTransaction.serialize({ requireAllSignatures: false }).toString('base64'),
      }),
    });
    if (!finalizeResponse.ok) {
      const errorText = await finalizeResponse.text();
      throw new Error(`Mint finalize failed: ${finalizeResponse.status} ${errorText || finalizeResponse.statusText}`);
    }
    const finalizePayload = (await finalizeResponse.json()) as { signature?: string };
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
  console.info('[remint] found asset to burn', { assetId, interface: existingCard.interface });

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

  // Obtain JWT auth token
  const authToken = await getAuthToken(wallet, coreMintUrl);
  const updateAuthHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) updateAuthHeaders['Authorization'] = `Bearer ${authToken}`;

  const heliusRpcUrl = getHeliusRpcUrl(address);
  if (!heliusRpcUrl) throw new Error('Helius API key required');

  // 1. Find existing Core NFT via DAS
  const dasResponse = await fetch(heliusRpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getHeliusProxyHeaders(address) ?? {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'update-find',
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
  const coreAsset = (dasData.result?.items ?? []).find(
    (a) =>
      a.interface === 'MplCoreAsset' &&
      a.grouping?.some((g) => g.group_key === 'collection' && g.group_value === collectionMintAddress),
  );
  if (!coreAsset) {
    throw new Error('No existing Identity Prism Core NFT found. Use regular mint instead.');
  }
  const assetId = coreAsset.id;
  console.info('[update] found Core asset', { assetId });

  // 2. Build metadata and upload
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

  const metadataResponse = await fetch(`${metadataBaseUrl}/metadata`, {
    method: 'POST',
    headers: updateAuthHeaders,
    body: JSON.stringify(metadataJson),
  });
  if (!metadataResponse.ok) {
    const errorText = await metadataResponse.text();
    throw new Error(`Metadata upload failed: ${metadataResponse.status} ${errorText}`);
  }
  const metadataPayload = (await metadataResponse.json()) as { uri?: string };
  const metadataUri = metadataPayload.uri;
  if (!metadataUri) throw new Error('Metadata URI not returned');

  // 3. Phase 1: get partially-signed tx from server
  console.info('[update] requesting tx from /api/update-card', { assetId: assetId.slice(0, 16), name: displayName });
  const prepareResponse = await fetch(`${coreMintUrl}/api/update-card`, {
    method: 'POST',
    headers: updateAuthHeaders,
    body: JSON.stringify({ ownerAddress: address, assetId, metadataUri, name: displayName }),
  });
  if (!prepareResponse.ok) {
    const errorText = await prepareResponse.text();
    throw new Error(`Update prepare failed: ${prepareResponse.status} ${errorText}`);
  }
  const prepareData = (await prepareResponse.json()) as { transaction?: string; feeSol?: number };
  if (!prepareData.transaction) throw new Error('Update transaction missing from server');

  // 4. User signs the transaction (pays service fee + network fee)
  const transaction = Transaction.from(Buffer.from(prepareData.transaction, 'base64'));

  // Simulate before signing (dApp Store compliance)
  const updateConn = new Connection(heliusRpcUrl, 'confirmed');
  const updateSim = await updateConn.simulateTransaction(transaction, undefined, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  if (updateSim.value.err) {
    throw buildPreflightError('SIMULATION_FAILED', `Update simulation failed: ${JSON.stringify(updateSim.value.err)}`);
  }
  transaction.recentBlockhash = (await updateConn.getLatestBlockhash()).blockhash;

  // Patch serialize so wallet adapter doesn't reject due to missing colAuth sig
  // (same pattern as mint-cnft — MWA internally calls serialize())
  const origSerialize = transaction.serialize.bind(transaction);
  transaction.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
    origSerialize({
      ...config,
      requireAllSignatures: false,
      verifySignatures: false,
    })) as typeof transaction.serialize;
  const signed = await signWithDismissDetection(wallet, transaction);

  // 5. Phase 2: send signed tx back to server for co-signing & submission
  const serialized = signed.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const finalizeResponse = await fetch(`${coreMintUrl}/api/update-card`, {
    method: 'POST',
    headers: updateAuthHeaders,
    body: JSON.stringify({
      ownerAddress: address,
      assetId,
      metadataUri,
      name: displayName,
      signedTransaction: serialized,
    }),
  });
  if (!finalizeResponse.ok) {
    const errorText = await finalizeResponse.text();
    throw new Error(`Update finalize failed: ${finalizeResponse.status} ${errorText}`);
  }
  const result = (await finalizeResponse.json()) as { signature?: string; assetId?: string };
  if (!result.signature) throw new Error('Update signature missing');

  return { signature: result.signature, assetId, metadataUri };
}
