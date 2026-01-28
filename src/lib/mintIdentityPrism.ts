import { WalletContextState } from '@solana/wallet-adapter-react';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  getAppBaseUrl,
  getHeliusProxyHeaders,
  getHeliusRpcUrl,
  getMetadataBaseUrl,
  getMetadataImageUrl,
  getCollectionMint,
  getCollectionVerifyUrl,
  getUpdateAuthorityAddress,
  getCnftMintUrl,
  MINT_CONFIG,
  TREASURY_ADDRESS,
} from '@/constants';
import type { WalletTraits } from '@/hooks/useWalletData';
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  createCreateMasterEditionV3Instruction,
  createCreateMetadataAccountV3Instruction,
  PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID,
} from '@metaplex-foundation/mpl-token-metadata';

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

export async function mintIdentityPrism({
  wallet,
  address,
  traits,
  score,
}: MintIdentityPrismArgs): Promise<MintIdentityPrismResult> {
  if (!wallet || !wallet.publicKey || !wallet.sendTransaction) {
    throw new Error('Wallet not ready or does not support transactions');
  }

  const heliusRpcUrl = getHeliusRpcUrl(address);
  if (!heliusRpcUrl) {
    throw new Error('Helius API key required for minting');
  }
  const connection = new Connection(heliusRpcUrl, {
    commitment: 'confirmed',
    httpHeaders: getHeliusProxyHeaders(address),
  });
  const payer = wallet.publicKey;
  const treasury = new PublicKey(TREASURY_ADDRESS);
  const priceLamports = Math.round(MINT_CONFIG.PRICE_SOL * LAMPORTS_PER_SOL);
  const metadataBaseUrl = getMetadataBaseUrl();
  if (!metadataBaseUrl) {
    throw new Error('Metadata service URL not configured');
  }
  const imageUrl = getMetadataImageUrl();
  if (!imageUrl) {
    throw new Error('Metadata image URL not configured');
  }
  const appBaseUrl = getAppBaseUrl();
  const shortAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;
  const collectionMintAddress = getCollectionMint();
  const updateAuthorityAddress = getUpdateAuthorityAddress();
  const collectionVerifyUrl = getCollectionVerifyUrl();
  const cnftMintUrl = getCnftMintUrl();

  const parseOptionalPublicKey = (value: string | null, label: string) => {
    if (!value) return null;
    try {
      return new PublicKey(value);
    } catch {
      throw new Error(`${label} is not a valid public key`);
    }
  };

  const collectionMint = parseOptionalPublicKey(collectionMintAddress, 'VITE_COLLECTION_MINT');
  const updateAuthority = parseOptionalPublicKey(updateAuthorityAddress, 'VITE_UPDATE_AUTHORITY') ?? payer;

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
    name: `${MINT_CONFIG.COLLECTION} #${shortAddress}`,
    symbol: MINT_CONFIG.SYMBOL ?? 'PRISM',
    description: 'Identity Prism — a living Solana identity card built from your on-chain footprint.',
    image: imageUrl,
    external_url: appBaseUrl ? `${appBaseUrl}/?address=${address}` : undefined,
    animation_url: appBaseUrl ? `${appBaseUrl}/?address=${address}` : undefined,
    attributes: [
      { trait_type: 'Tier', value: traits.planetTier },
      { trait_type: 'Score', value: score },
      { trait_type: 'NFTs', value: traits.nftCount },
      { trait_type: 'Tokens', value: traits.uniqueTokenCount },
      { trait_type: 'Transactions', value: traits.txCount },
      { trait_type: 'Wallet Age (days)', value: traits.walletAgeDays },
    ],
    properties: {
      files: [{ uri: imageUrl, type: 'image/png' }],
      category: 'image',
    },
  };

  const metadataResponse = await fetch(`${metadataBaseUrl}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: metadataJson }),
  });

  if (!metadataResponse.ok) {
    throw new Error('Metadata upload failed');
  }
  const metadataPayload = (await metadataResponse.json()) as { uri?: string };
  const metadataUri = metadataPayload.uri;
  if (!metadataUri) {
    throw new Error('Metadata URI not returned');
  }

  if (cnftMintUrl) {
    if (!collectionMint) {
      throw new Error('Collection mint is required for compressed minting');
    }
    const cnftResponse = await fetch(`${cnftMintUrl}/mint-cnft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner: address,
        metadataUri,
        name: metadataJson.name,
        symbol: metadataJson.symbol,
        sellerFeeBasisPoints: MINT_CONFIG.SELLER_FEE_BASIS_POINTS ?? 0,
        collectionMint: collectionMint.toBase58(),
      }),
    });

    if (!cnftResponse.ok) {
      throw new Error('Core mint failed');
    }

    const cnftPayload = (await cnftResponse.json()) as {
      transaction?: string;
      assetId?: string;
    };
    if (!cnftPayload.transaction) {
      throw new Error('Core mint transaction missing');
    }

    const transaction = Transaction.from(Buffer.from(cnftPayload.transaction, 'base64'));
    const signature = await wallet.sendTransaction(transaction, connection);
    await connection.confirmTransaction(signature, 'confirmed');

    return {
      signature,
      mint: cnftPayload.assetId ?? signature,
      metadataUri,
      metadata,
      metadataBase64: encodeBase64(JSON.stringify(metadata)),
    };
  }

  const mintKeypair = Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const ata = await getAssociatedTokenAddress(mintKeypair.publicKey, payer);
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mintKeypair.publicKey.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  const [masterEditionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mintKeypair.publicKey.toBuffer(),
      Buffer.from('edition'),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  const createMintIx = SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: mintKeypair.publicKey,
    lamports: mintRent,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  });
  const initMintIx = createInitializeMintInstruction(mintKeypair.publicKey, 0, payer, payer);
  const createAtaIx = createAssociatedTokenAccountInstruction(
    payer,
    ata,
    payer,
    mintKeypair.publicKey
  );
  const mintToIx = createMintToInstruction(mintKeypair.publicKey, ata, payer, 1);
  const metadataIx = createCreateMetadataAccountV3Instruction(
    {
      metadata: metadataPda,
      mint: mintKeypair.publicKey,
      mintAuthority: payer,
      payer,
      updateAuthority,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    },
    {
      createMetadataAccountArgsV3: {
        data: {
          name: metadataJson.name,
          symbol: metadataJson.symbol,
          uri: metadataUri,
          sellerFeeBasisPoints: MINT_CONFIG.SELLER_FEE_BASIS_POINTS ?? 0,
          creators: null,
          collection: collectionMint
            ? {
                verified: false,
                key: collectionMint,
              }
            : null,
          uses: null,
        },
        isMutable: true,
        collectionDetails: null,
      },
    }
  );
  const masterEditionIx = createCreateMasterEditionV3Instruction(
    {
      edition: masterEditionPda,
      mint: mintKeypair.publicKey,
      updateAuthority,
      mintAuthority: payer,
      payer,
      metadata: metadataPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    },
    {
      createMasterEditionArgs: {
        maxSupply: 0,
      },
    }
  );

  const transferIx = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: treasury,
    lamports: priceLamports,
  });

  const transaction = new Transaction().add(
    createMintIx,
    initMintIx,
    createAtaIx,
    mintToIx,
    metadataIx,
    masterEditionIx,
    transferIx
  );
  
  const signature = await wallet.sendTransaction(transaction, connection, {
    signers: [mintKeypair],
  });
  
  const latestBlockhash = await connection.getLatestBlockhash('finalized');
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    'confirmed'
  );

  if (collectionMint && collectionVerifyUrl) {
    try {
      await fetch(`${collectionVerifyUrl}/verify-collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mint: mintKeypair.publicKey.toBase58(),
          collectionMint: collectionMint.toBase58(),
          signature,
        }),
      });
    } catch (error) {
      console.warn('[mint] collection verify request failed', error);
    }
  }

  return {
    signature,
    mint: mintKeypair.publicKey.toBase58(),
    metadataUri,
    metadata,
    metadataBase64: encodeBase64(JSON.stringify(metadata)),
  };
}
