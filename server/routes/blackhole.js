import { createBlackHoleOrchestrator } from '../services/blackHoleOrchestrator.js';
import { PublicKey } from '@solana/web3.js';

const BLACKHOLE_METADATA_TIMEOUT_MS = 12000;
const BLACKHOLE_IMAGE_TIMEOUT_MS = 12000;
const BLACKHOLE_IMAGE_ATTEMPT_TIMEOUT_MS = 4500;
const BLACKHOLE_TOKEN_ACCOUNTS_TIMEOUT_MS = 18000;
const BLACKHOLE_METADATA_MAX_MINTS = 120;
const BLACKHOLE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const BLACKHOLE_IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BLACKHOLE_IMAGE_CACHE_MAX = 320;
const BLACKHOLE_IMAGE_FLATTEN_BG = { r: 96, g: 104, b: 120, alpha: 1 };
const BLACKHOLE_IMAGE_ALLOWED_HOSTS = [
  'arweave.net',
  'amazonaws.com',
  'assets.blocksmithlabs.io',
  'cdn-2.galxe.com',
  'dweb.link',
  'gateway.irys.xyz',
  'i.imgur.com',
  'imagedelivery.net',
  'imgur.com',
  'ipfs.io',
  'metadata.jito.network',
  'mypinata.cloud',
  'nftstorage.link',
  'raw.githubusercontent.com',
  'shdw-drive.genesysgo.net',
  'storage.googleapis.com',
  'w3s.link',
  'www.arweave.net',
];

const parseNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeImageUrl = (image) => {
  if (typeof image !== 'string') return undefined;
  const trimmed = image.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '')}`;
  }
  const heliusCdnMatch = trimmed.match(/^https:\/\/cdn\.helius-rpc\.com\/cdn-cgi\/image\/(?:[^/]+\/)?\/?(https?:\/\/.+)$/i);
  if (heliusCdnMatch?.[1]) return heliusCdnMatch[1];
  return trimmed;
};

const isAllowedImageHost = (hostname) => {
  const lower = hostname.toLowerCase();
  return BLACKHOLE_IMAGE_ALLOWED_HOSTS.some((allowed) => lower === allowed || lower.endsWith(`.${allowed}`));
};

const imageCache = new Map();
let sharpModulePromise = null;

const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const BLACKHOLE_TOKEN_PROGRAM_IDS = new Set([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);

const getIpfsPath = (imageUrl) => {
  if (!imageUrl || typeof imageUrl !== 'object') return null;
  const hostname = imageUrl.hostname.toLowerCase();
  if (hostname === 'ipfs.io' || hostname === 'dweb.link' || hostname === 'nftstorage.link' || hostname === 'w3s.link') {
    const match = imageUrl.pathname.match(/^\/ipfs\/(.+)$/i);
    if (match?.[1]) return match[1];
  }
  return null;
};

const getImageFetchCandidates = (imageUrl) => {
  const ipfsPath = getIpfsPath(imageUrl);
  if (!ipfsPath) return [imageUrl.toString()];
  const suffix = `${ipfsPath}${imageUrl.search || ''}`;
  return [
    `https://dweb.link/ipfs/${suffix}`,
    `https://nftstorage.link/ipfs/${suffix}`,
    `https://w3s.link/ipfs/${suffix}`,
    `https://ipfs.io/ipfs/${suffix}`,
  ];
};

const getSharp = async () => {
  if (!sharpModulePromise) {
    sharpModulePromise = import('sharp').then((mod) => mod.default ?? mod);
  }
  return sharpModulePromise;
};

const getCachedImage = (key) => {
  const cached = imageCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > BLACKHOLE_IMAGE_CACHE_TTL_MS) {
    imageCache.delete(key);
    return null;
  }
  return cached;
};

const setCachedImage = (key, entry) => {
  if (imageCache.size >= BLACKHOLE_IMAGE_CACHE_MAX) {
    const oldestKey = imageCache.keys().next().value;
    if (oldestKey) imageCache.delete(oldestKey);
  }
  imageCache.set(key, { ...entry, timestamp: Date.now() });
};

const writeImageResponse = (res, entry) => {
  res.writeHead(200, {
    'Content-Type': entry.contentType,
    'Content-Length': String(entry.buffer.byteLength),
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(entry.buffer);
};

const makeThumbnail = async (buffer, contentType) => {
  if (contentType.toLowerCase().includes('svg')) {
    return { buffer, contentType };
  }
  const sharp = await getSharp();
  let pipeline = sharp(buffer, { animated: false }).rotate().resize(96, 96, {
    fit: 'contain',
    background: BLACKHOLE_IMAGE_FLATTEN_BG,
    withoutEnlargement: false,
  });
  const metadata = await pipeline.metadata();
  if (metadata.hasAlpha) {
    pipeline = pipeline.flatten({ background: BLACKHOLE_IMAGE_FLATTEN_BG });
  }
  const thumb = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
  return { buffer: thumb, contentType: 'image/png' };
};

const detectImageContentType = (buffer, headerContentType) => {
  const normalized = String(headerContentType || '').toLowerCase();
  if (normalized.startsWith('image/')) return headerContentType;
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif';
  const prefix = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  if (prefix.startsWith('<svg') || prefix.startsWith('<?xml')) return 'image/svg+xml';
  return null;
};

const normalizeAsset = (asset, fallbackMint) => {
  if (!asset || typeof asset !== 'object') return null;
  const mint = typeof asset.id === 'string' ? asset.id : fallbackMint;
  if (!mint) return null;
  const content = asset.content && typeof asset.content === 'object' ? asset.content : {};
  const metadata = content.metadata && typeof content.metadata === 'object' ? content.metadata : {};
  const links = content.links && typeof content.links === 'object' ? content.links : {};
  const files = Array.isArray(content.files) ? content.files : [];
  const grouping = Array.isArray(asset.grouping) ? asset.grouping : [];
  const collectionGroup = grouping.find((group) => group?.group_key === 'collection');
  const collectionMeta =
    collectionGroup?.collection_metadata && typeof collectionGroup.collection_metadata === 'object'
      ? collectionGroup.collection_metadata
      : {};
  const tokenInfo = asset.token_info && typeof asset.token_info === 'object' ? asset.token_info : {};
  const priceInfo = tokenInfo.price_info && typeof tokenInfo.price_info === 'object' ? tokenInfo.price_info : {};
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
  const jsonUri = typeof content.json_uri === 'string' ? content.json_uri : '';
  const imageFile = files.find((file) => {
    const mime = typeof file?.mime === 'string' ? file.mime.toLowerCase() : '';
    return mime.startsWith('image/') && (file.cdn_uri || file.uri);
  }) || files.find((file) => file?.cdn_uri || file?.uri);
  const image =
    normalizeImageUrl(imageFile?.uri) ||
    normalizeImageUrl(links.image) ||
    normalizeImageUrl(imageFile?.cdn_uri) ||
    undefined;
  return {
    mint,
    name:
      (typeof metadata.name === 'string' && metadata.name.trim()) ||
      (jsonUri ? jsonUri.split('/').pop() : undefined),
    symbol: typeof metadata.symbol === 'string' ? metadata.symbol : undefined,
    image,
    isNft,
    collectionId: collectionGroup?.group_value,
    collectionName: collectionGroup?.group_value ? collectionMeta.name || metadata.name : undefined,
    collectionSymbol: collectionGroup?.group_value ? collectionMeta.symbol || metadata.symbol : undefined,
    priceUsd,
  };
};

function registerBlackholeRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      requireJwt,
      readBody,
      getRpcUrl,
    },
  } = ctx;
  const blackHoleOrchestrator = createBlackHoleOrchestrator(ctx);

  return async function handleBlackholeRoute(req, res, url, pathname) {
    if (pathname === '/api/blackhole/image' && req.method === 'GET') {
      if (!ipRateLimit('blackhole_image', getClientIp(req), 240, 60000)) {
        return respondJson(res, 429, { error: 'Too many image requests' });
      }

      const rawUrl = normalizeImageUrl(url.searchParams.get('url'));
      let imageUrl;
      try {
        imageUrl = new URL(rawUrl);
      } catch {
        respondJson(res, 400, { error: 'Invalid image URL' });
        return true;
      }
      if (imageUrl.protocol !== 'https:' || !isAllowedImageHost(imageUrl.hostname)) {
        respondJson(res, 400, { error: 'Image host not allowed' });
        return true;
      }

      const cacheKey = imageUrl.toString();
      const cachedImage = getCachedImage(cacheKey);
      if (cachedImage) {
        writeImageResponse(res, cachedImage);
        return true;
      }

      const fetchCandidates = getImageFetchCandidates(imageUrl);
      const deadline = Date.now() + BLACKHOLE_IMAGE_TIMEOUT_MS;
      let lastError = 'Image fetch failed';
      try {
        for (const candidateUrl of fetchCandidates) {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) break;
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            Math.min(BLACKHOLE_IMAGE_ATTEMPT_TIMEOUT_MS, remainingMs),
          );
          try {
            const upstream = await fetch(candidateUrl, {
              headers: {
                Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36 IdentityPrism/1.0',
              },
              redirect: 'follow',
              signal: controller.signal,
            });
            if (!upstream.ok) {
              lastError = `Image provider returned ${upstream.status}`;
              continue;
            }
            const upstreamContentType = upstream.headers.get('content-type') || '';
            const contentLength = Number(upstream.headers.get('content-length') || '0');
            if (contentLength > BLACKHOLE_IMAGE_MAX_BYTES) {
              lastError = 'Image too large';
              continue;
            }
            const buffer = Buffer.from(await upstream.arrayBuffer());
            if (buffer.byteLength > BLACKHOLE_IMAGE_MAX_BYTES) {
              lastError = 'Image too large';
              continue;
            }
            const contentType = detectImageContentType(buffer, upstreamContentType);
            if (!contentType) {
              lastError = 'URL did not return an image';
              continue;
            }
            const imageEntry = await makeThumbnail(buffer, contentType);
            setCachedImage(cacheKey, imageEntry);
            writeImageResponse(res, imageEntry);
            return true;
          } catch (error) {
            lastError = error?.name === 'AbortError' ? 'Image provider timeout' : 'Image fetch failed';
          } finally {
            clearTimeout(timeout);
          }
        }
        respondJson(res, 504, { error: lastError });
      } catch (error) {
        respondJson(res, 504, { error: error?.name === 'AbortError' ? 'Image provider timeout' : 'Image fetch failed' });
      }
      return true;
    }

    if (pathname === '/api/blackhole/metadata' && req.method === 'POST') {
      if (!ipRateLimit('blackhole_metadata', getClientIp(req), 60, 60000)) {
        return respondJson(res, 429, { error: 'Too many requests' });
      }
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
        return true;
      }
      const address = typeof payload?.address === 'string' ? payload.address.trim() : '';
      const mints = Array.isArray(payload?.mints)
        ? [...new Set(payload.mints.filter((mint) => typeof mint === 'string').map((mint) => mint.trim()))]
        : [];
      try {
        new PublicKey(address);
        mints.forEach((mint) => new PublicKey(mint));
      } catch {
        respondJson(res, 400, { error: 'Invalid Solana address or mint' });
        return true;
      }
      if (mints.length === 0 || mints.length > BLACKHOLE_METADATA_MAX_MINTS) {
        respondJson(res, 400, { error: `Expected 1-${BLACKHOLE_METADATA_MAX_MINTS} mints` });
        return true;
      }
      const rpcUrl = getRpcUrl(address);
      if (!rpcUrl) {
        respondJson(res, 503, { error: 'RPC endpoint unavailable' });
        return true;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BLACKHOLE_METADATA_TIMEOUT_MS);
      try {
        const upstream = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'blackhole-metadata',
            method: 'getAssetBatch',
            params: { ids: mints },
          }),
          signal: controller.signal,
        });
        if (!upstream.ok) {
          respondJson(res, 502, { error: `Metadata provider returned ${upstream.status}` });
          return true;
        }
        const data = await upstream.json();
        if (data?.error) {
          respondJson(res, 502, { error: data.error.message || 'Metadata provider error' });
          return true;
        }
        const assets = {};
        (Array.isArray(data?.result) ? data.result : []).forEach((asset, index) => {
          const normalized = normalizeAsset(asset, mints[index]);
          if (normalized?.mint) assets[normalized.mint] = normalized;
        });
        respondJson(res, 200, { assets });
      } catch (error) {
        respondJson(res, 504, { error: error?.name === 'AbortError' ? 'Metadata provider timeout' : 'Metadata fetch failed' });
      } finally {
        clearTimeout(timeout);
      }
      return true;
    }

    if (pathname === '/api/blackhole/token-accounts' && req.method === 'GET') {
      if (!ipRateLimit('blackhole_token_accounts', getClientIp(req), 45, 60000)) {
        return respondJson(res, 429, { error: 'Too many token account scans' });
      }
      const address = String(url.searchParams.get('address') || '').trim();
      const programId = String(url.searchParams.get('programId') || SPL_TOKEN_PROGRAM_ID).trim();
      try {
        new PublicKey(address);
        new PublicKey(programId);
      } catch {
        respondJson(res, 400, { error: 'Invalid Solana address or token program' });
        return true;
      }
      if (!BLACKHOLE_TOKEN_PROGRAM_IDS.has(programId)) {
        respondJson(res, 400, { error: 'Unsupported token program' });
        return true;
      }
      const rpcUrl = getRpcUrl(address);
      if (!rpcUrl) {
        respondJson(res, 503, { error: 'RPC endpoint unavailable' });
        return true;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BLACKHOLE_TOKEN_ACCOUNTS_TIMEOUT_MS);
      try {
        const upstream = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `blackhole-token-accounts-${programId.slice(0, 6)}`,
            method: 'getTokenAccountsByOwner',
            params: [address, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
          }),
          signal: controller.signal,
        });
        if (!upstream.ok) {
          respondJson(res, 502, { error: `Token account provider returned ${upstream.status}` });
          return true;
        }
        const data = await upstream.json();
        if (data?.error) {
          if (programId === TOKEN_2022_PROGRAM_ID && /unrecognized Token program id/i.test(data.error.message || '')) {
            respondJson(res, 200, { value: [] });
            return true;
          }
          respondJson(res, 502, { error: data.error.message || 'Token account provider error' });
          return true;
        }
        respondJson(res, 200, { value: Array.isArray(data?.result?.value) ? data.result.value : [] });
      } catch (error) {
        respondJson(res, 504, { error: error?.name === 'AbortError' ? 'Token account provider timeout' : 'Token account scan failed' });
      } finally {
        clearTimeout(timeout);
      }
      return true;
    }

    if (pathname !== '/api/blackhole/claim' || req.method !== 'POST') return false;

    if (!ipRateLimit('blackhole_claim', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return true;
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      respondJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    const result = await blackHoleOrchestrator.claim({ address: jwtAuth.address, payload });
    respondJson(res, result.status, result.body);
    return true;
  };
}

export { registerBlackholeRoute };
