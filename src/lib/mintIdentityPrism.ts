import { WalletContextState } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
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

async function confirmTransactionWithPolling(
  connection: Connection,
  signature: string,
  timeoutMs = 60000
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

const logSendTransactionError = async (error: unknown) => {
  const candidate = error as { getLogs?: () => Promise<string[] | null> };
  if (candidate?.getLogs) {
    try {
      const logs = await candidate.getLogs();
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
    return `${fallbackBase}/assets/identity-prism.png`;
  })();
  const resolvedAppBaseUrl = resolveBaseUrl(appBaseUrl);
  const resolvedExternalUrl = resolvedAppBaseUrl
    ? `${resolvedAppBaseUrl}/?address=${address}`
    : undefined;
  const resolvedAnimationUrl = resolvedAppBaseUrl
    ? `${resolvedAppBaseUrl}/?address=${address}&mode=nft`
    : undefined;
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
      category: 'image',
    },
  };

  const metadataResponse = await fetch(`${metadataBaseUrl}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const cnftResponse = await fetch(`${coreMintUrl}/mint-cnft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner: address,
      metadataUri,
      name: metadataJson.name,
      symbol: metadataJson.symbol,
      sellerFeeBasisPoints: MINT_CONFIG.SELLER_FEE_BASIS_POINTS ?? 0,
      collectionMint: collectionMint.toBase58(),
      admin: adminMode,
    }),
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
  const signatureMap = new Map(
    transaction.signatures.map((entry) => [entry.publicKey.toBase58(), entry.signature])
  );
  transaction.signatures = requiredSigners.map((signer) => ({
    publicKey: new PublicKey(signer),
    signature: signatureMap.get(signer) ?? null,
  }));
  console.info('[mint] required signers', requiredSigners);
  if (!requestId) {
    throw new Error('Mint requestId missing from server response');
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
    const signedTransaction = await wallet.signTransaction(transaction);
    const walletSigner = wallet.publicKey?.toBase58();
    if (walletSigner) {
      const walletSignature = signedTransaction.signatures.find(
        (entry) => entry.publicKey.toBase58() === walletSigner
      );
      if (!walletSignature?.signature) {
        throw new Error(`Wallet signature missing for ${walletSigner}`);
      }
    }

    const finalizeResponse = await fetch(`${coreMintUrl}/mint-cnft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
