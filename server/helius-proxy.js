import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createNoopSigner,
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  publicKey,
} from '@metaplex-foundation/umi';
import { create, fetchCollection, mplCore } from '@metaplex-foundation/mpl-core';
import { toWeb3JsInstruction, toWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import { calculateIdentity } from './services/scoring.js';
import { drawBackCard, drawFrontCard, drawFrontCardImage } from './services/cardGenerator.js';

const loadEnvFile = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const splitIndex = trimmed.indexOf('=');
      if (splitIndex <= 0) return;
      const key = trimmed.slice(0, splitIndex).trim();
      if (!key || process.env[key] !== undefined) return;
      let value = trimmed.slice(splitIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    });
  } catch {
    // ignore missing env file
  }
};

loadEnvFile(process.env.ENV_PATH ?? path.join(process.cwd(), '.env'));

const PORT = Number(process.env.PORT ?? 3000);
const HOST = (process.env.HOST ?? '0.0.0.0').trim() || '0.0.0.0';
const HELIUS_RPC_BASE = (process.env.HELIUS_RPC_BASE ?? 'https://mainnet.helius-rpc.com/').trim();
const HELIUS_KEYS = (process.env.HELIUS_API_KEYS ?? process.env.HELIUS_API_KEY ?? '')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
const METADATA_DIR = process.env.METADATA_DIR
  ? path.resolve(process.env.METADATA_DIR)
  : path.join(process.cwd(), 'metadata');
const ASSETS_DIR = path.join(METADATA_DIR, 'assets');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? '').trim();
const COLLECTION_AUTHORITY_SECRET = (process.env.COLLECTION_AUTHORITY_SECRET ?? '').trim();
const TREASURY_SECRET = (process.env.TREASURY_SECRET ?? '').trim();
const TREASURY_SECRET_PATH = (process.env.TREASURY_SECRET_PATH ?? path.join(process.cwd(), 'keys', 'treasury.json')).trim();
const CORE_COLLECTION = (process.env.CORE_COLLECTION ?? '').trim();
const TREASURY_ADDRESS = (process.env.TREASURY_ADDRESS ?? '').trim();
const MINT_PRICE_SOL = Number(process.env.MINT_PRICE_SOL ?? '0.01');
const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const PENDING_MINT_TTL_MS = 10 * 60 * 1000;
const pendingMintSigners = new Map();

const prunePendingMints = () => {
  const now = Date.now();
  for (const [key, entry] of pendingMintSigners.entries()) {
    if (!entry || now - entry.createdAt > PENDING_MINT_TTL_MS) {
      pendingMintSigners.delete(key);
    }
  }
};

const storePendingMint = ({ requestId, owner, assetId, assetSecret, transaction }) => {
  prunePendingMints();
  pendingMintSigners.set(requestId, {
    owner,
    assetId,
    assetSecret,
    transaction,
    createdAt: Date.now(),
  });
};

const consumePendingMint = (requestId) => {
  prunePendingMints();
  const entry = pendingMintSigners.get(requestId);
  if (!entry) return null;
  pendingMintSigners.delete(requestId);
  return entry;
};

if (!fs.existsSync(METADATA_DIR)) {
  fs.mkdirSync(METADATA_DIR, { recursive: true });
}
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

const getHeliusKeyIndex = (seed = '') => {
  if (!HELIUS_KEYS.length) return -1;
  if (!seed) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }
  return Math.abs(hash) % HELIUS_KEYS.length;
};

const pickHeliusKey = (seed) => {
  const index = getHeliusKeyIndex(seed);
  if (index < 0) return null;
  return HELIUS_KEYS[index];
};

const getRpcUrl = (seed) => {
  const apiKey = pickHeliusKey(seed);
  if (!apiKey) return null;
  const targetUrl = new URL(HELIUS_RPC_BASE);
  targetUrl.searchParams.set('api-key', apiKey);
  return targetUrl.toString();
};

const parseSecretKey = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  try {
    if (trimmed.startsWith('[')) {
      return Uint8Array.from(JSON.parse(trimmed));
    }
  } catch {
    // ignore
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded.trim().startsWith('[')) {
      return Uint8Array.from(JSON.parse(decoded));
    }
  } catch {
    // ignore
  }
  return null;
};

const loadSecretKeyFromFile = (filePath) => {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return Uint8Array.from(parsed);
    }
  } catch {
    // ignore
  }
  return null;
};

const parsePublicKey = (value, label) => {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid public key`);
  }
};

const resolveCorsOrigin = (req) => {
  const origin = String(req?.headers?.origin ?? '').trim();
  const configured = String(CORS_ORIGIN ?? '').trim();
  if (!origin) {
    return configured || '*';
  }
  if (!configured || configured === '*') {
    return origin;
  }
  const allowList = configured.split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowList.length) {
    return origin;
  }
  if (allowList.includes('*')) {
    return origin;
  }
  if (allowList.includes(origin)) {
    return origin;
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return origin;
  }
  return allowList[0];
};

const applyCors = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', resolveCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-wallet-address,solana-client,x-action-version,x-blockchain-ids');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Action-Version,X-Blockchain-Ids');
  res.setHeader('X-Action-Version', '2');
  res.setHeader('X-Blockchain-Ids', 'solana:mainnet');
};

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
  });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

const getBaseUrl = (req) => {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
  const proto = forwardedProto || 'http';
  const host = forwardedHost || req.headers.host;
  return host ? `${proto}://${host}` : '';
};

const respondJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const resolveMetadataFile = (rawName) => {
  const trimmed = rawName.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) return null;
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
};

const resolveAssetFile = (rawName) => {
  const trimmed = rawName.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) return null;
  return trimmed;
};

const getContentType = (fileName) => {
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg';
  if (fileName.endsWith('.webp')) return 'image/webp';
  if (fileName.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
};

const sendImageDataUrl = (res, dataUrl) => {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl ?? '');
  if (!match) {
    respondJson(res, 500, { error: 'Invalid image payload' });
    return;
  }
  const [, contentType, data] = match;
  const buffer = Buffer.from(data, 'base64');
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
};

const formatActionAddress = (address) => {
  if (!address) return '';
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

const fetchIdentitySnapshot = async (address) => {
  const rpcUrl = getRpcUrl(address);
  if (!rpcUrl) {
    throw new Error('Helius API key required');
  }
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
  const pubkey = new PublicKey(address);
  const [balance, signatures, tokenAccounts] = await Promise.all([
    connection.getBalance(pubkey),
    connection.getSignaturesForAddress(pubkey, { limit: 1000 }),
    connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
  ]);

  const solBalance = balance / LAMPORTS_PER_SOL;
  const txCount = signatures.length;
  const oldest = signatures[signatures.length - 1];
  const firstTxTime = oldest?.blockTime ?? null;

  let tokenCount = 0;
  let nftCount = 0;
  tokenAccounts.value.forEach((account) => {
    const info = account?.account?.data?.parsed?.info;
    const tokenAmount = info?.tokenAmount;
    const uiAmount = tokenAmount?.uiAmount ?? 0;
    if (!uiAmount || uiAmount <= 0) return;
    if ((tokenAmount?.decimals ?? 0) === 0) {
      nftCount += 1;
    } else {
      tokenCount += 1;
    }
  });

  const walletAgeDays = firstTxTime
    ? Math.floor((Date.now() - firstTxTime * 1000) / (1000 * 60 * 60 * 24))
    : 0;
  const identity = calculateIdentity(txCount, firstTxTime, solBalance, tokenCount, nftCount);
  const stats = {
    score: identity.score,
    address: formatActionAddress(address),
    ageDays: walletAgeDays,
    txCount,
    solBalance,
    tokenCount,
    nftCount,
  };

  return { identity, stats, walletAgeDays, solBalance, txCount, tokenCount, nftCount };
};

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/api/actions/render') {
    const viewParam = String(url.searchParams.get('view') ?? 'front').trim();
    const view = viewParam === 'back' ? 'back' : 'front';
    const empty = String(url.searchParams.get('empty') ?? '') === '1';
    const tierParam = String(url.searchParams.get('tier') ?? 'mercury').trim();
    const addressParam = String(url.searchParams.get('address') ?? '').trim();

    try {
      if (view === 'back') {
        let stats = null;
        let badges = [];
        if (!empty && addressParam) {
          const snapshot = await fetchIdentitySnapshot(addressParam);
          stats = snapshot.stats;
          badges = snapshot.identity.badges;
        }
        const image = await drawBackCard(stats, badges);
        sendImageDataUrl(res, image);
        return;
      }

      let tier = tierParam;
      if (addressParam && !empty) {
        const snapshot = await fetchIdentitySnapshot(addressParam);
        tier = snapshot.identity.tier;
      }
      const image = await drawFrontCardImage(tier);
      sendImageDataUrl(res, image);
      return;
    } catch (error) {
      console.error('[actions/render] failed', error);
      respondJson(res, 500, {
        error: 'Unable to render card image',
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  if (pathname === '/api/actions/share') {
    const baseUrl = getBaseUrl(req);
    if (!baseUrl) {
      respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
      return;
    }

    if (req.method === 'GET') {
      const icon = await drawFrontCardImage('mercury');
      respondJson(res, 200, {
        title: 'Identity Prism',
        icon,
        description: 'Scan a Solana address to reveal your Identity Prism card.',
        label: 'Scan',
        links: {
          actions: [
            {
              label: 'Scan',
              href: `${baseUrl}/api/actions/share?address={address}`,
              parameters: [
                {
                  name: 'address',
                  label: 'Solana Address',
                  required: true,
                },
              ],
            },
          ],
        },
      });
      return;
    }

    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const body = await readBody(req);
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (error) {
        respondJson(res, 400, { error: 'Invalid JSON payload' });
        return;
      }

      const address = String(url.searchParams.get('address') ?? payload?.address ?? '').trim();
      if (!address) {
        respondJson(res, 400, { error: 'Address is required' });
        return;
      }
      try {
        new PublicKey(address);
      } catch {
        respondJson(res, 400, { error: 'Invalid address' });
        return;
      }

      const viewParam = String(url.searchParams.get('view') ?? payload?.view ?? 'front').trim();
      const view = viewParam === 'back' ? 'back' : 'front';
      const { identity, stats } = await fetchIdentitySnapshot(address);

      const icon = view === 'back'
        ? await drawBackCard(stats, identity.badges)
        : await drawFrontCardImage(identity.tier);
      const description = `Tier: ${identity.tier.toUpperCase()} • Score ${identity.score} • ${stats.txCount} tx • ${stats.ageDays} days`;
      const encodedAddress = encodeURIComponent(address);
      const flipView = view === 'back' ? 'front' : 'back';

      respondJson(res, 200, {
        title: 'Identity Prism',
        icon,
        description,
        label: view === 'back' ? 'Back View' : 'Front View',
        links: {
          actions: [
            {
              label: view === 'back' ? 'Flip to Front' : 'Flip Card',
              href: `${baseUrl}/api/actions/share?address=${encodedAddress}&view=${flipView}`,
            },
            {
              label: 'Mint',
              href: `${baseUrl}/api/actions/mint-blink?address=${encodedAddress}`,
            },
            {
              label: 'View App',
              href: `${baseUrl}/?address=${encodedAddress}`,
            },
          ],
        },
      });
    } catch (error) {
      console.error('[actions/share] failed', error);
      respondJson(res, 500, {
        error: 'Unable to build action payload',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === '/api/actions/mint-blink') {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const baseUrl = getBaseUrl(req);
      if (!baseUrl) {
        respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
        return;
      }
      const body = await readBody(req);
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON payload' });
        return;
      }

      const owner = String(url.searchParams.get('address') ?? payload?.address ?? '').trim();
      const payer = String(payload?.account ?? '').trim();
      if (!owner || !payer) {
        respondJson(res, 400, { error: 'Address and account are required' });
        return;
      }

      if (!COLLECTION_AUTHORITY_SECRET) {
        respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured' });
        return;
      }
      if (!TREASURY_ADDRESS) {
        respondJson(res, 500, { error: 'TREASURY_ADDRESS is not configured' });
        return;
      }
      if (!CORE_COLLECTION) {
        respondJson(res, 500, { error: 'CORE_COLLECTION is not configured' });
        return;
      }

      const collectionSecret = parseSecretKey(COLLECTION_AUTHORITY_SECRET);
      if (!collectionSecret) {
        respondJson(res, 500, { error: 'Invalid collection authority secret' });
        return;
      }

      const ownerKey = parsePublicKey(owner, 'owner');
      const payerKey = parsePublicKey(payer, 'account');
      const collectionMintKey = parsePublicKey(CORE_COLLECTION, 'collectionMint');
      if (!ownerKey || !payerKey || !collectionMintKey) {
        respondJson(res, 400, { error: 'Invalid owner/account/collection mint' });
        return;
      }

      const { identity, stats, walletAgeDays } = await fetchIdentitySnapshot(ownerKey.toBase58());
      const imageUrl = drawFrontCard(identity.tier);
      const metadata = {
        name: `Identity Prism ${ownerKey.toBase58().slice(0, 4)}`,
        symbol: 'PRISM',
        description: 'Identity Prism — a living Solana identity card built from your on-chain footprint.',
        image: imageUrl,
        external_url: `${baseUrl}/?address=${ownerKey.toBase58()}`,
        attributes: [
          { trait_type: 'Tier', value: identity.tier },
          { trait_type: 'Score', value: identity.score.toString() },
          { trait_type: 'Wallet Age (days)', value: walletAgeDays },
          { trait_type: 'Transactions', value: stats.txCount },
        ],
        properties: {
          files: [{ uri: imageUrl, type: 'image/jpeg' }],
          category: 'image',
        },
      };

      const metadataId = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const metadataFile = resolveMetadataFile(metadataId);
      if (!metadataFile) {
        respondJson(res, 500, { error: 'Failed to create metadata file' });
        return;
      }
      const metadataPath = path.join(METADATA_DIR, metadataFile);
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      const metadataUri = `${baseUrl}/metadata/${metadataFile}`;

      const rpcUrl = getRpcUrl(payerKey.toBase58());
      if (!rpcUrl) {
        respondJson(res, 500, { error: 'Helius API key required' });
        return;
      }

      const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
      const treasuryKey = new PublicKey(TREASURY_ADDRESS);
      const expectedLamports = Math.round(MINT_PRICE_SOL * LAMPORTS_PER_SOL);
      const umi = createUmi(rpcUrl).use(mplCore());
      const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
      const collectionAuthoritySigner = umi.eddsa.createKeypairFromSecretKey(collectionSecret);
      umi.use(keypairIdentity(collectionAuthoritySigner));

      const collection = await fetchCollection(umi, publicKey(collectionMintKey.toBase58()));
      const assetSigner = generateSigner(umi);
      const assetKeypair = toWeb3JsKeypair(assetSigner);
      const ownerSigner = createNoopSigner(publicKey(ownerKey.toBase58()));
      const payerSigner = createNoopSigner(publicKey(payerKey.toBase58()));
      const builder = create(umi, {
        asset: assetSigner,
        collection,
        name: metadata.name,
        uri: metadataUri,
        owner: ownerSigner,
        payer: payerSigner,
        authority: collectionAuthoritySigner,
      }).setFeePayer(payerSigner);

      const transferIx = expectedLamports > 0
        ? SystemProgram.transfer({
            fromPubkey: payerKey,
            toPubkey: treasuryKey,
            lamports: expectedLamports,
          })
        : null;
      const latestBlockhash = await connection.getLatestBlockhash('finalized');
      const instructions = [
        ...(transferIx ? [transferIx] : []),
        ...builder.getInstructions().map((instruction) => {
          const web3Ix = toWeb3JsInstruction(instruction);
          web3Ix.keys = web3Ix.keys.map((key) => {
            const keyStr = key.pubkey.toBase58();
            if (keyStr === collectionAuthorityKeypair.publicKey.toBase58()) {
              return { ...key, isSigner: true };
            }
            if (keyStr === assetKeypair.publicKey.toBase58()) {
              return { ...key, isSigner: true };
            }
            return key;
          });
          return web3Ix;
        }),
      ];

      const transaction = new Transaction().add(...instructions);
      transaction.feePayer = payerKey;
      transaction.recentBlockhash = latestBlockhash.blockhash;
      const compiledMessage = transaction.compileMessage();
      const requiredSigners = compiledMessage.accountKeys
        .slice(0, compiledMessage.header.numRequiredSignatures)
        .map((key) => key.toBase58());
      const signerPool = [];
      if (requiredSigners.includes(assetKeypair.publicKey.toBase58())) {
        signerPool.push(assetKeypair);
      }
      if (requiredSigners.includes(collectionAuthorityKeypair.publicKey.toBase58())) {
        signerPool.push(collectionAuthorityKeypair);
      }
      if (signerPool.length) {
        transaction.partialSign(...signerPool);
      }

      const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');
      respondJson(res, 200, {
        transaction: serialized,
        message: 'Sign to mint your Identity Prism.',
        blockhash: latestBlockhash.blockhash,
      });
    } catch (error) {
      console.error('[actions/mint] failed', error);
      respondJson(res, 500, {
        error: 'Action mint failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === '/mint-cnft') {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const fallbackRequestId = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const body = await readBody(req);
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (error) {
        console.error('[mint-cnft] invalid json', {
          requestId: fallbackRequestId,
          error: error instanceof Error ? error.message : String(error),
          bodyPreview: body.slice(0, 200),
        });
        respondJson(res, 400, { error: 'Invalid JSON payload', requestId: fallbackRequestId });
        return;
      }

      const payloadRequestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : '';
      const requestId = payloadRequestId || fallbackRequestId;
      if (!COLLECTION_AUTHORITY_SECRET) {
        respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured', requestId });
        return;
      }
      if (!TREASURY_ADDRESS) {
        respondJson(res, 500, { error: 'TREASURY_ADDRESS is not configured', requestId });
        return;
      }

      const collectionSecret = parseSecretKey(COLLECTION_AUTHORITY_SECRET);
      if (!collectionSecret) {
        respondJson(res, 500, { error: 'Invalid collection authority secret', requestId });
        return;
      }

      const owner = payload?.owner ?? '';
      const metadataUri = payload?.metadataUri ?? '';
      const name = payload?.name ?? '';
      const symbol = payload?.symbol ?? '';
      const sellerFeeBasisPoints = Number(payload?.sellerFeeBasisPoints ?? 0);
      const collectionMintRaw = payload?.collectionMint ?? CORE_COLLECTION ?? '';
      const adminMode = Boolean(payload?.admin);
      const signedTransaction = typeof payload?.signedTransaction === 'string' ? payload.signedTransaction.trim() : '';
      if (signedTransaction && !payloadRequestId) {
        respondJson(res, 400, { error: 'requestId is required to finalize mint', requestId });
        return;
      }
      const isFinalize = Boolean(payloadRequestId && signedTransaction);
      if (isFinalize) {
        const pending = consumePendingMint(payloadRequestId);
        if (!pending) {
          respondJson(res, 400, { error: 'Mint finalize request expired or missing', requestId: payloadRequestId });
          return;
        }
        if (owner && pending.owner && owner !== pending.owner) {
          respondJson(res, 400, { error: 'Owner mismatch for finalize request', requestId: payloadRequestId });
          return;
        }
        const ownerAddress = owner || pending.owner;
        const ownerKey = parsePublicKey(ownerAddress, 'owner');
        if (!ownerKey) {
          respondJson(res, 400, { error: 'Invalid owner for finalize request', requestId: payloadRequestId });
          return;
        }
        const rpcUrl = getRpcUrl(ownerKey.toBase58());
        if (!rpcUrl) {
          respondJson(res, 500, { error: 'Helius API key required', requestId: payloadRequestId });
          return;
        }
        const connection = new Connection(rpcUrl, { commitment: 'confirmed' });

        let transaction;
        try {
          transaction = Transaction.from(Buffer.from(signedTransaction, 'base64'));
        } catch (error) {
          respondJson(res, 400, { error: 'Invalid signed transaction payload', requestId: payloadRequestId });
          return;
        }

        const assetKeypair = Keypair.fromSecretKey(Uint8Array.from(pending.assetSecret));
        const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
        transaction.partialSign(assetKeypair, collectionAuthorityKeypair);

        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          preflightCommitment: 'confirmed',
        });
        await connection.confirmTransaction(signature, 'confirmed');
        respondJson(res, 200, {
          signature,
          assetId: pending.assetId,
          requestId: payloadRequestId,
          finalized: true,
        });
        return;
      }

      const treasurySecret = adminMode
        ? parseSecretKey(TREASURY_SECRET) ?? loadSecretKeyFromFile(TREASURY_SECRET_PATH)
        : null;
      if (adminMode && !treasurySecret) {
        respondJson(res, 500, {
          error: 'Treasury secret not configured',
          requestId,
          hint: `Set TREASURY_SECRET or place key at ${TREASURY_SECRET_PATH}`,
        });
        return;
      }

      console.info('[mint-cnft] request', {
        requestId,
        owner,
        collectionMint: collectionMintRaw,
        metadataUri,
        name,
        symbol,
        sellerFeeBasisPoints,
      });

      if (!owner || !metadataUri || !name || !collectionMintRaw) {
        respondJson(res, 400, { error: 'Missing required mint payload', requestId });
        return;
      }

      const collectionMintKey = parsePublicKey(collectionMintRaw, 'collectionMint');
      const ownerKey = parsePublicKey(owner, 'owner');
      if (!collectionMintKey || !ownerKey) {
        respondJson(res, 400, { error: 'Invalid public keys in mint request', requestId });
        return;
      }

      const rpcUrl = getRpcUrl(ownerKey.toBase58());
      if (!rpcUrl) {
        respondJson(res, 500, { error: 'Helius API key required', requestId });
        return;
      }

      const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
      const treasuryKey = new PublicKey(TREASURY_ADDRESS);
      const expectedLamports = Math.round(MINT_PRICE_SOL * LAMPORTS_PER_SOL);
      const umi = createUmi(rpcUrl).use(mplCore());
      const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
      const collectionAuthoritySigner = umi.eddsa.createKeypairFromSecretKey(collectionSecret);
      umi.use(keypairIdentity(collectionAuthoritySigner));
      const treasuryKeypair = adminMode && treasurySecret ? Keypair.fromSecretKey(treasurySecret) : null;

      const collection = await fetchCollection(umi, publicKey(collectionMintKey.toBase58()));
      const resolveUpdateAuthorityAddress = (value) => {
        if (!value) return null;
        if (typeof value === 'string') return value;
        const addressValue =
          typeof value.address === 'string'
            ? value.address
            : value.address?.toString?.();
        if (addressValue) return addressValue;
        const publicKeyValue =
          typeof value.publicKey === 'string'
            ? value.publicKey
            : value.publicKey?.toString?.();
        if (publicKeyValue) return publicKeyValue;
        return value.toString?.() ?? null;
      };
      const updateAuthorityAddress = resolveUpdateAuthorityAddress(collection?.updateAuthority);
      if (!updateAuthorityAddress) {
        console.warn('[mint-cnft] collection update authority unresolved', {
          requestId,
          collectionMint: collectionMintKey.toBase58(),
          collectionAddress: collection?.publicKey?.toString?.(),
        });
      } else {
        console.info('[mint-cnft] collection fetched', {
          address: collection.publicKey.toString(),
          updateAuthority: updateAuthorityAddress,
          configuredAuthority: collectionAuthorityKeypair.publicKey.toBase58(),
          match: updateAuthorityAddress === collectionAuthorityKeypair.publicKey.toBase58()
        });
      }

      const assetSigner = generateSigner(umi);
      const assetKeypair = toWeb3JsKeypair(assetSigner);
      const ownerSigner = createNoopSigner(publicKey(ownerKey.toBase58()));
      const payerSigner = adminMode && treasuryKeypair
        ? createSignerFromKeypair(umi, treasuryKeypair)
        : ownerSigner;
      const builder = create(umi, {
        asset: assetSigner,
        collection,
        name,
        uri: metadataUri,
        owner: ownerSigner,
        payer: payerSigner,
        authority: collectionAuthoritySigner,
      }).setFeePayer(payerSigner);

      const transferIx = adminMode
        ? null
        : SystemProgram.transfer({
            fromPubkey: ownerKey,
            toPubkey: treasuryKey,
            lamports: expectedLamports,
          });
      const latestBlockhash = await connection.getLatestBlockhash('finalized');
      const instructions = [
        ...(transferIx ? [transferIx] : []),
        ...builder.getInstructions().map((instruction) => {
          const web3Ix = toWeb3JsInstruction(instruction);
          // Ensure collection authority and asset are signers
          let foundCollectionAuth = false;
          let foundAsset = false;
          
          web3Ix.keys = web3Ix.keys.map((key) => {
            const keyStr = key.pubkey.toBase58();
            if (keyStr === collectionAuthorityKeypair.publicKey.toBase58()) {
              foundCollectionAuth = true;
              return { ...key, isSigner: true };
            }
            if (keyStr === assetKeypair.publicKey.toBase58()) {
              foundAsset = true;
              return { ...key, isSigner: true };
            }
            return key;
          });
          
          console.info(`[mint-cnft] ix processed`, {
             programId: web3Ix.programId.toBase58(),
             foundCollectionAuth,
             foundAsset,
             collectionAuth: collectionAuthorityKeypair.publicKey.toBase58(),
             asset: assetKeypair.publicKey.toBase58()
          });
          
          return web3Ix;
        }),
      ];
      
      // Log instruction keys for debugging
      instructions.forEach((ix, i) => {
        console.info(`[mint-cnft] instruction ${i} keys`, ix.keys.map(k => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable
        })));
      });

      const transaction = new Transaction().add(...instructions);
      transaction.feePayer = adminMode && treasuryKeypair ? treasuryKeypair.publicKey : ownerKey;
      transaction.recentBlockhash = latestBlockhash.blockhash;
      const compiledMessage = transaction.compileMessage();
      const requiredSigners = compiledMessage.accountKeys
        .slice(0, compiledMessage.header.numRequiredSignatures)
        .map((key) => key.toBase58());
      console.info('[mint-cnft] required signers', { requestId, requiredSigners });

      const signerPool = [];
      if (requiredSigners.includes(assetKeypair.publicKey.toBase58())) {
        signerPool.push(assetKeypair);
      }
      if (requiredSigners.includes(collectionAuthorityKeypair.publicKey.toBase58())) {
        signerPool.push(collectionAuthorityKeypair);
      }
      if (adminMode && treasuryKeypair && requiredSigners.includes(treasuryKeypair.publicKey.toBase58())) {
        signerPool.push(treasuryKeypair);
      }
      if (adminMode && signerPool.length) {
        transaction.partialSign(...signerPool);
      }

      const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');

      if (adminMode) {
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          preflightCommitment: 'confirmed',
        });
        await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          'confirmed'
        );
        respondJson(res, 200, {
          signature,
          assetId: assetSigner.publicKey,
          blockhash: latestBlockhash.blockhash,
          requestId,
          admin: true,
        });
        return;
      }

      storePendingMint({
        requestId,
        owner,
        assetId: assetSigner.publicKey,
        assetSecret: Array.from(assetKeypair.secretKey),
        transaction: serialized,
      });

      respondJson(res, 200, {
        transaction: serialized,
        assetId: assetSigner.publicKey,
        blockhash: latestBlockhash.blockhash,
        requestId,
        finalize: true,
      });
    } catch (error) {
      console.error('[mint-cnft] failed', error);
      respondJson(res, 500, {
        error: 'Core mint failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (pathname === '/verify-collection') {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      if (!COLLECTION_AUTHORITY_SECRET) {
        respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured' });
        return;
      }

      const secretKey = parseSecretKey(COLLECTION_AUTHORITY_SECRET);
      if (!secretKey) {
        respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is invalid' });
        return;
      }

      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const mint = payload?.mint ? new PublicKey(payload.mint) : null;
      const collectionMint = payload?.collectionMint ? new PublicKey(payload.collectionMint) : null;
      if (!mint || !collectionMint) {
        respondJson(res, 400, { error: 'mint and collectionMint are required' });
        return;
      }

      const rpcUrl = getRpcUrl(mint.toBase58());
      if (!rpcUrl) {
        respondJson(res, 500, { error: 'Helius API key required' });
        return;
      }

      const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
      const collectionAuthority = Keypair.fromSecretKey(secretKey);
      const metadataPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )[0];
      const collectionMetadataPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          collectionMint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )[0];
      const collectionMasterEditionPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          collectionMint.toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )[0];

      const buildVerifyInstruction = (discriminator) =>
        new TransactionInstruction({
          programId: TOKEN_METADATA_PROGRAM_ID,
          keys: [
            { pubkey: metadataPda, isSigner: false, isWritable: true },
            { pubkey: collectionAuthority.publicKey, isSigner: true, isWritable: true },
            { pubkey: collectionAuthority.publicKey, isSigner: true, isWritable: true },
            { pubkey: collectionMint, isSigner: false, isWritable: false },
            { pubkey: collectionMetadataPda, isSigner: false, isWritable: true },
            { pubkey: collectionMasterEditionPda, isSigner: false, isWritable: false },
          ],
          data: Buffer.from([discriminator]),
        });

      const sendVerify = async (discriminator) => {
        const transaction = new Transaction().add(buildVerifyInstruction(discriminator));
        transaction.feePayer = collectionAuthority.publicKey;
        const latestBlockhash = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = latestBlockhash.blockhash;
        transaction.sign(collectionAuthority);

        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
        });
        await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          'confirmed'
        );
        return signature;
      };

      let signature;
      try {
        signature = await sendVerify(18);
      } catch (error) {
        console.warn('[verify-collection] verifyCollection failed, trying sized item', error);
        signature = await sendVerify(30);
      }

      respondJson(res, 200, { signature });
    } catch (error) {
      console.error('[verify-collection] failed', error);
      respondJson(res, 500, { error: 'Collection verification failed' });
    }
    return;
  }

  const isAssetUpload =
    pathname === '/assets' ||
    pathname === '/assets/' ||
    pathname === '/metadata/assets' ||
    pathname === '/metadata/assets/';
  if (isAssetUpload) {
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      const body = await readBody(req);
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (error) {
        console.error('[assets] invalid json', {
          error: error instanceof Error ? error.message : String(error),
          bodyPreview: body.slice(0, 200),
        });
        respondJson(res, 400, { error: 'Invalid JSON payload' });
        return;
      }
      const imageValue = payload?.image ?? payload?.dataUrl ?? payload?.imageBase64 ?? '';
      if (!imageValue || typeof imageValue !== 'string') {
        respondJson(res, 400, { error: 'Missing image payload' });
        return;
      }
      let base64 = imageValue.trim();
      let contentType = typeof payload?.contentType === 'string' ? payload.contentType : '';
      const dataMatch = base64.match(/^data:([^;]+);base64,(.+)$/);
      if (dataMatch) {
        contentType = dataMatch[1];
        base64 = dataMatch[2];
      }
      if (!base64) {
        respondJson(res, 400, { error: 'Invalid image payload' });
        return;
      }
      let extension = 'png';
      if (contentType.includes('jpeg') || contentType.includes('jpg')) {
        extension = 'jpg';
      } else if (contentType.includes('webp')) {
        extension = 'webp';
      } else if (contentType.includes('gif')) {
        extension = 'gif';
      }
      const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const fileName = resolveAssetFile(`${id}.${extension}`);
      if (!fileName) {
        respondJson(res, 500, { error: 'Failed to create asset file' });
        return;
      }
      const filePath = path.join(ASSETS_DIR, fileName);
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      const baseUrl = getBaseUrl(req);
      if (!baseUrl) {
        respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
        return;
      }
      respondJson(res, 200, { url: `${baseUrl}/metadata/assets/${fileName}` });
    } catch (error) {
      console.error('[assets] upload failed', error);
      respondJson(res, 500, { error: 'Asset upload failed' });
    }
    return;
  }

  const isAssetFetch = pathname.startsWith('/assets/') || pathname.startsWith('/metadata/assets/');
  if (isAssetFetch) {
    if (req.method !== 'GET') {
      respondJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    const parts = pathname.split('/').filter(Boolean);
    const rawName = parts[parts.length - 1] ?? '';
    const fileName = resolveAssetFile(rawName);
    if (!fileName) {
      respondJson(res, 404, { error: 'Asset not found' });
      return;
    }
    const filePath = path.join(ASSETS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      respondJson(res, 404, { error: 'Asset not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': getContentType(fileName) });
    res.end(fs.readFileSync(filePath));
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname.startsWith('/metadata')) {
    if (req.method === 'POST' && (pathname === '/metadata' || pathname === '/metadata/')) {
      try {
        const body = await readBody(req);
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch (error) {
          console.error('[metadata] invalid json', {
            error: error instanceof Error ? error.message : String(error),
            bodyPreview: body.slice(0, 200),
          });
          respondJson(res, 400, { error: 'Invalid JSON payload' });
          return;
        }
        const wrappedMetadata = payload?.metadata;
        const metadata =
          wrappedMetadata && typeof wrappedMetadata === 'object'
            ? wrappedMetadata
            : payload && typeof payload === 'object'
              ? payload
              : null;
        if (!metadata || Array.isArray(metadata)) {
          respondJson(res, 400, { error: 'Missing metadata payload' });
          return;
        }

        const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const fileName = resolveMetadataFile(id);
        if (!fileName) {
          respondJson(res, 500, { error: 'Failed to create metadata file' });
          return;
        }
        const filePath = path.join(METADATA_DIR, fileName);
        fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
        const baseUrl = getBaseUrl(req);
        if (!baseUrl) {
          respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
          return;
        }
        respondJson(res, 200, { uri: `${baseUrl}/metadata/${fileName}` });
      } catch (error) {
        console.error('[metadata] write failed', error);
        respondJson(res, 500, { error: 'Metadata write failed' });
      }
      return;
    }

    if (req.method === 'GET') {
      const parts = pathname.split('/').filter(Boolean);
      const rawName = parts[1] ?? '';
      const fileName = resolveMetadataFile(rawName);
      if (!fileName) {
        respondJson(res, 404, { error: 'Metadata not found' });
        return;
      }
      const filePath = path.join(METADATA_DIR, fileName);
      if (!fs.existsSync(filePath)) {
        respondJson(res, 404, { error: 'Metadata not found' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(filePath, 'utf-8'));
      return;
    }

    respondJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!pathname.startsWith('/rpc')) {
    respondJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!HELIUS_KEYS.length) {
    respondJson(res, 500, { error: 'Helius API key required' });
    return;
  }

  try {
    const body = await readBody(req);
    const seed = String(req.headers['x-wallet-address'] ?? '');
    const apiKey = pickHeliusKey(seed);

    if (!apiKey) {
      respondJson(res, 500, { error: 'Helius API key required' });
      return;
    }

    const targetUrl = new URL(HELIUS_RPC_BASE);
    targetUrl.searchParams.set('api-key', apiKey);

    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body || '{}',
    });

    const responseText = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    });
    res.end(responseText);
  } catch (error) {
    console.error('[helius-proxy] upstream error', error);
    respondJson(res, 502, { error: 'Upstream request failed' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[helius-proxy] listening on ${HOST}:${PORT}`);
});
