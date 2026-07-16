import { createBlackHoleOrchestrator } from '../services/blackHoleOrchestrator.js';
import { PublicKey } from '@solana/web3.js';

const BLACKHOLE_METADATA_TIMEOUT_MS = 15000;
const BLACKHOLE_NFT_FLOOR_TIMEOUT_MS = 4500;
const BLACKHOLE_IMAGE_TIMEOUT_MS = 12000;
const BLACKHOLE_IMAGE_ATTEMPT_TIMEOUT_MS = 4500;
const BLACKHOLE_IMAGE_FAST_RESPONSE_MS = 2800;
const BLACKHOLE_IMAGE_RESOLUTION_FAST_RESPONSE_MS = 1800;
const BLACKHOLE_TOKEN_ACCOUNTS_TIMEOUT_MS = 18000;
const BLACKHOLE_TOKEN_ACCOUNTS_ATTEMPT_TIMEOUT_MS = 8000;
const BLACKHOLE_TOKEN_ACCOUNTS_CACHE_TTL_MS = 30 * 1000;
const BLACKHOLE_TOKEN_ACCOUNTS_CACHE_MAX = 256;
const BLACKHOLE_TOKEN_ACCOUNTS_MAX_PARALLEL_RPCS = 4;
const BLACKHOLE_TOKEN_ACCOUNTS_MIN_CACHEABLE_COUNT = 8;
const BLACKHOLE_METADATA_MAX_MINTS = 120;
const BLACKHOLE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const BLACKHOLE_IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BLACKHOLE_IMAGE_CACHE_MAX = 320;
const BLACKHOLE_IMAGE_CACHE_ENTRY_MAX_BYTES = 2 * 1024 * 1024;
// 1x1 transparent PNG served when every upstream image gateway/candidate fails,
// so the UI shows a blank tile instead of a broken-image icon / hard error.
const BLACKHOLE_IMAGE_PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const BLACKHOLE_IMAGE_FLATTEN_BG = { r: 96, g: 104, b: 120, alpha: 1 };
const BLACKHOLE_IMAGE_ALLOWED_HOSTS = [
  'arweave.net',
  'amazonaws.com',
  'assets.blocksmithlabs.io',
  'cdn-2.galxe.com',
  'cdn.dexscreener.com',
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
const BLACKHOLE_JUPITER_TOKEN_CACHE_TTL_MS = 60 * 60 * 1000;
const BLACKHOLE_JUPITER_TOKEN_CACHE_MAX = 512;
const BLACKHOLE_MAGIC_EDEN_TOKEN_CACHE_TTL_MS = 30 * 60 * 1000;
const BLACKHOLE_MAGIC_EDEN_TOKEN_CACHE_MAX = 512;
const BLACKHOLE_IMAGE_RESOLUTION_CACHE_POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BLACKHOLE_IMAGE_RESOLUTION_CACHE_NEGATIVE_TTL_MS = 60 * 60 * 1000;
const BLACKHOLE_IMAGE_RESOLUTION_CACHE_MAX = 1024;
const BLACKHOLE_IMAGE_BACKGROUND_MAX_PARALLEL = 4;
const BLACKHOLE_IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://w3s.link/ipfs/',
  'https://dweb.link/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://4everland.io/ipfs/',
];
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

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
  if (trimmed.startsWith('ar://')) {
    return `https://arweave.net/${trimmed.slice('ar://'.length).replace(/^\/+/, '')}`;
  }
  const heliusCdnMatch = trimmed.match(/^https:\/\/cdn\.helius-rpc\.com\/cdn-cgi\/image\/(?:[^/]+\/)?\/?(https?:\/\/.+)$/i);
  if (heliusCdnMatch?.[1]) return decodeURIComponent(heliusCdnMatch[1]);
  if (/^https:\/\/cdn\.helius-rpc\.com\/cdn-cgi\/image\/+$/i.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.hostname.toLowerCase() === 'i.degencdn.com') {
      const ipfsMatch = url.pathname.match(/^\/ipfs\/(.+)$/i);
      if (ipfsMatch?.[1]) return `https://ipfs.io/ipfs/${ipfsMatch[1]}${url.search || ''}`;
    }
    if (url.hostname.toLowerCase() === 'dd.dexscreener.com') {
      const dexscreenerMatch = url.pathname.match(/^\/ds-data\/tokens\/solana\/([^/]+)$/i);
      if (dexscreenerMatch?.[1]) return `https://cdn.dexscreener.com/tokens/solana/${dexscreenerMatch[1]}${url.search || ''}`;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const isAllowedImageHost = (hostname) => {
  const lower = hostname.toLowerCase();
  return BLACKHOLE_IMAGE_ALLOWED_HOSTS.some((allowed) => lower === allowed || lower.endsWith(`.${allowed}`));
};

const imageCache = new Map();
const imageFetchPending = new Map();
const tokenAccountsCache = new Map();
let sharpModulePromise = null;

const getCachedTokenAccounts = (key) => {
  const cached = tokenAccountsCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > BLACKHOLE_TOKEN_ACCOUNTS_CACHE_TTL_MS) {
    tokenAccountsCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedTokenAccounts = (key, value) => {
  if (tokenAccountsCache.size >= BLACKHOLE_TOKEN_ACCOUNTS_CACHE_MAX) {
    const oldestKey = tokenAccountsCache.keys().next().value;
    if (oldestKey) tokenAccountsCache.delete(oldestKey);
  }
  tokenAccountsCache.set(key, { value, timestamp: Date.now() });
};

const metadataCache = new Map();
const BLACKHOLE_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
const BLACKHOLE_METADATA_CACHE_MAX = 256;
const collectionFloorCache = new Map();
const BLACKHOLE_COLLECTION_FLOOR_CACHE_TTL_MS = 30 * 60 * 1000;
const BLACKHOLE_COLLECTION_FLOOR_CACHE_MAX = 512;
const jupiterTokenCache = new Map();
const magicEdenTokenCache = new Map();
const imageResolutionCache = new Map();
const imageResolutionPending = new Map();
let imageResolutionActive = 0;

const getCachedMetadata = (key) => {
  const cached = metadataCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > BLACKHOLE_METADATA_CACHE_TTL_MS) {
    metadataCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedMetadata = (key, value) => {
  if (metadataCache.size >= BLACKHOLE_METADATA_CACHE_MAX) {
    const oldestKey = metadataCache.keys().next().value;
    if (oldestKey) metadataCache.delete(oldestKey);
  }
  metadataCache.set(key, { value, timestamp: Date.now() });
};

const getCachedCollectionFloor = (key) => {
  const cached = collectionFloorCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > BLACKHOLE_COLLECTION_FLOOR_CACHE_TTL_MS) {
    collectionFloorCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedCollectionFloor = (key, value) => {
  if (collectionFloorCache.size >= BLACKHOLE_COLLECTION_FLOOR_CACHE_MAX) {
    const oldestKey = collectionFloorCache.keys().next().value;
    if (oldestKey) collectionFloorCache.delete(oldestKey);
  }
  collectionFloorCache.set(key, { value, timestamp: Date.now() });
};

const getTimedCacheValue = (cache, key, ttlMs) => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > ttlMs) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setTimedCacheValue = (cache, key, value, maxSize) => {
  if (cache.size >= maxSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { value, timestamp: Date.now() });
};

const getCachedImageResolution = (mint) => {
  const cached = imageResolutionCache.get(mint);
  if (!cached) return undefined;
  const ttl = cached.value ? BLACKHOLE_IMAGE_RESOLUTION_CACHE_POSITIVE_TTL_MS : BLACKHOLE_IMAGE_RESOLUTION_CACHE_NEGATIVE_TTL_MS;
  if (Date.now() - cached.timestamp > ttl) {
    imageResolutionCache.delete(mint);
    return undefined;
  }
  return cached.value;
};

const setCachedImageResolution = (mint, value) => {
  if (imageResolutionCache.size >= BLACKHOLE_IMAGE_RESOLUTION_CACHE_MAX) {
    const oldestKey = imageResolutionCache.keys().next().value;
    if (oldestKey) imageResolutionCache.delete(oldestKey);
  }
  imageResolutionCache.set(mint, { value, timestamp: Date.now() });
};

const runImageResolutionJob = async (asset, candidateUrls) => {
  const mint = asset?.mint;
  if (!mint || imageResolutionPending.has(mint)) return imageResolutionPending.get(mint);
  const job = (async () => {
    while (imageResolutionActive >= BLACKHOLE_IMAGE_BACKGROUND_MAX_PARALLEL) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    imageResolutionActive += 1;
    try {
      await enrichAssetWithFallbackImage(asset, candidateUrls);
      return asset.image ? { image: asset.image, source: asset.imageSource } : null;
    } catch {
      return null;
    } finally {
      imageResolutionActive = Math.max(0, imageResolutionActive - 1);
      imageResolutionPending.delete(mint);
    }
  })();
  imageResolutionPending.set(mint, job);
  return job;
};

const hashMints = (mints) => {
  const sorted = [...mints].sort().join(',');
  let h = 0;
  for (let i = 0; i < sorted.length; i++) { h = ((h << 5) - h + sorted.charCodeAt(i)) | 0; }
  return String(h);
};

const normalizeFloorSol = (value) => {
  const numeric = parseNumber(value);
  if (!numeric || numeric <= 0) return null;
  return numeric > 1000 ? numeric / 1_000_000_000 : numeric;
};

const parseListedCount = (value) => {
  const numeric = parseNumber(value);
  if (numeric === null || numeric === undefined || numeric < 0) return null;
  return Math.floor(numeric);
};

const pickFirstFloorSol = (...values) => {
  for (const value of values) {
    const parsed = normalizeFloorSol(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const pickFirstListedCount = (...values) => {
  for (const value of values) {
    const parsed = parseListedCount(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const slugifyCollectionName = (value) => {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug || null;
};

const uniqueStrings = (values) => [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];

const fetchJsonWithTimeout = async (url, timeoutMs = BLACKHOLE_NFT_FLOOR_TIMEOUT_MS, headers = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'IdentityPrism/1.0 NFT floor lookup',
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status, data: null };
    return { ok: true, status: response.status, data: await response.json() };
  } finally {
    clearTimeout(timeout);
  }
};

const fetchMagicEdenTokenByMint = async (mint) => {
  if (!mint) return null;
  const cached = getTimedCacheValue(magicEdenTokenCache, mint, BLACKHOLE_MAGIC_EDEN_TOKEN_CACHE_TTL_MS);
  if (cached !== null) return cached;
  try {
    const result = await fetchJsonWithTimeout(`https://api-mainnet.magiceden.dev/v2/tokens/${encodeURIComponent(mint)}`);
    const token = result.ok && result.data && typeof result.data === 'object' ? result.data : null;
    setTimedCacheValue(magicEdenTokenCache, mint, token, BLACKHOLE_MAGIC_EDEN_TOKEN_CACHE_MAX);
    return token;
  } catch {
    setTimedCacheValue(magicEdenTokenCache, mint, null, BLACKHOLE_MAGIC_EDEN_TOKEN_CACHE_MAX);
    return null;
  }
};

const fetchMagicEdenLaunchpadImage = async (asset) => {
  const candidates = uniqueStrings([
    asset.collectionSymbol,
    slugifyCollectionName(asset.collectionName),
    asset.collectionName?.toLowerCase().replace(/\s+/g, '_'),
  ]);
  for (const candidate of candidates) {
    try {
      const result = await fetchJsonWithTimeout(`https://api-mainnet.magiceden.dev/v2/launchpad/${encodeURIComponent(candidate)}`);
      const image = normalizeImageUrl(result.data?.image || result.data?.imageUrl || result.data?.bannerImage || result.data?.previewImage);
      if (image) return image;
    } catch {
      continue;
    }
  }
  return null;
};

const fetchBirdeyeTokenImage = async (mint) => {
  const apiKey = (process.env.BIRDEYE_API_KEY || '').trim();
  const headers = apiKey ? { 'X-API-KEY': apiKey } : {};
  try {
    const result = await fetchJsonWithTimeout(
      `https://public-api.birdeye.so/defi/token_metadata?address=${encodeURIComponent(mint)}`,
      BLACKHOLE_NFT_FLOOR_TIMEOUT_MS,
      headers,
    );
    return normalizeImageUrl(result.data?.data?.logo_uri || result.data?.logo_uri || result.data?.data?.image || result.data?.image);
  } catch {
    return null;
  }
};

const fetchMagicEdenSlugByMint = async (mint) => {
  const token = await fetchMagicEdenTokenByMint(mint);
  if (!token) return null;
  return (
    token.collection ||
    token.collectionSymbol ||
    token.collectionId ||
    token?.collectionInfo?.symbol ||
    null
  );
};

const fetchJupiterTokenByMint = async (mint) => {
  if (!mint) return null;
  const cached = getTimedCacheValue(jupiterTokenCache, mint, BLACKHOLE_JUPITER_TOKEN_CACHE_TTL_MS);
  if (cached !== null) return cached;
  try {
    const result = await fetchJsonWithTimeout(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,
      BLACKHOLE_NFT_FLOOR_TIMEOUT_MS,
    );
    const tokens = Array.isArray(result.data) ? result.data : [];
    const token = tokens.find((entry) => entry?.id === mint || entry?.address === mint || entry?.mint === mint) || null;
    setTimedCacheValue(jupiterTokenCache, mint, token, BLACKHOLE_JUPITER_TOKEN_CACHE_MAX);
    return token;
  } catch {
    setTimedCacheValue(jupiterTokenCache, mint, null, BLACKHOLE_JUPITER_TOKEN_CACHE_MAX);
    return null;
  }
};

const fetchMagicEdenFloorStats = async (slug) => {
  if (!slug) return null;
  try {
    const result = await fetchJsonWithTimeout(`https://api-mainnet.magiceden.dev/v2/collections/${encodeURIComponent(slug)}/stats`);
    if (!result.ok) {
      if (result.status === 404) return { status: 'not_listed', floorSol: null, listedCount: 0, source: 'magic_eden' };
      return null;
    }
    const data = result.data || {};
    const floorSol = pickFirstFloorSol(data.floorPrice, data.floor_price, data.floor);
    const listedCount = pickFirstListedCount(data.listedCount, data.listed_count, data.listingCount, data.numListed, data.listed);
    return {
      status: floorSol || (listedCount !== null && listedCount > 0) ? 'listed' : 'not_listed',
      floorSol,
      listedCount,
      source: 'magic_eden',
      meSlug: slug,
      meUrl: `https://magiceden.io/marketplace/${slug}`,
    };
  } catch {
    return null;
  }
};

const fetchTensorFloorStats = async (collectionId, slug) => {
  const ids = uniqueStrings([collectionId, slug]);
  for (const id of ids) {
    const endpoints = [
      `https://api.tensor.so/sol/collections/${encodeURIComponent(id)}/stats`,
      `https://api.tensor.so/sol/collections/${encodeURIComponent(id)}`,
      `https://api.mainnet.tensordev.io/api/v1/collection/${encodeURIComponent(id)}/stats`,
    ];
    for (const endpoint of endpoints) {
      try {
        const result = await fetchJsonWithTimeout(endpoint);
        if (!result.ok) {
          if (result.status === 404) return { status: 'not_listed', floorSol: null, listedCount: 0, source: 'tensor' };
          continue;
        }
        const data = result.data || {};
        const floorSol = pickFirstFloorSol(
          data.floorPrice,
          data.floor_price,
          data.floor,
          data.stats?.floorPrice,
          data.stats?.floor_price,
          data.stats?.floor,
          data.collection?.floorPrice,
          data.collection?.floor,
        );
        const listedCount = pickFirstListedCount(
          data.listedCount,
          data.listed_count,
          data.numListed,
          data.stats?.listedCount,
          data.stats?.numListed,
          data.collection?.listedCount,
        );
        return {
          status: floorSol || (listedCount !== null && listedCount > 0) ? 'listed' : 'not_listed',
          floorSol,
          listedCount,
          source: 'tensor',
          tensorUrl: `https://www.tensor.trade/trade/${id}`,
        };
      } catch {
        continue;
      }
    }
  }
  return null;
};

async function rpcRace(urls, bodyJson, perAttemptTimeoutMs) {
  const controllers = urls.map(() => new AbortController());
  const tasks = urls.map((url, i) => {
    const t = setTimeout(() => controllers[i].abort(), perAttemptTimeoutMs);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyJson,
      signal: controllers[i].signal,
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data?.error) throw new Error(data.error.message || 'rpc error');
        return data;
      })
      .finally(() => clearTimeout(t));
  });
  try {
    const winner = await Promise.any(tasks);
    controllers.forEach((c) => { try { c.abort(); } catch {} });
    return { ok: true, data: winner };
  } catch (err) {
    return { ok: false, error: err?.errors?.[0]?.message || err?.message || 'all rpc failed' };
  }
}

const fetchRpcJson = async (url, bodyJson, perAttemptTimeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), perAttemptTimeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyJson,
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data?.error) throw new Error(data.error.message || 'rpc error');
    return data;
  } finally {
    clearTimeout(timeout);
  }
};

const getTokenAccountValue = (data) => (Array.isArray(data?.result?.value) ? data.result.value : []);

const shouldCacheTokenAccounts = ({ value, counts, attempted }) => {
  if (!counts.length) return false;
  const selectedCount = value.length;
  if (selectedCount >= BLACKHOLE_TOKEN_ACCOUNTS_MIN_CACHEABLE_COUNT) return true;
  if (selectedCount > 0) return false;
  if (attempted <= 1) return true;
  return selectedCount === 0 && counts.length === attempted;
};

async function rpcMostCompleteTokenAccounts(urls, bodyJson, perAttemptTimeoutMs) {
  const attemptedUrls = urls.slice(0, BLACKHOLE_TOKEN_ACCOUNTS_MAX_PARALLEL_RPCS);
  const results = await Promise.allSettled(
    attemptedUrls.map((url) => fetchRpcJson(url, bodyJson, perAttemptTimeoutMs)),
  );
  const successes = [];
  const errors = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const value = getTokenAccountValue(result.value);
      successes.push({ url: attemptedUrls[index], data: result.value, value });
    } else {
      errors.push(result.reason?.message || 'rpc failed');
    }
  });
  if (!successes.length) {
    return {
      ok: false,
      error: errors[0] || 'all rpc failed',
      attempted: attemptedUrls.length,
      counts: [],
    };
  }
  successes.sort((a, b) => b.value.length - a.value.length);
  const counts = successes.map((success) => success.value.length);
  return {
    ok: true,
    data: successes[0].data,
    value: successes[0].value,
    attempted: attemptedUrls.length,
    counts,
    selectedCount: successes[0].value.length,
    providerCount: successes.length,
  };
}

const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const BLACKHOLE_TOKEN_PROGRAM_IDS = new Set([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);

const getIpfsPath = (imageUrl) => {
  if (!imageUrl || typeof imageUrl !== 'object') return null;
  const hostname = imageUrl.hostname.toLowerCase();
  const subdomainMatch = hostname.match(/^([^./]+)\.ipfs\.(?:dweb\.link|w3s\.link|nftstorage\.link|4everland\.io)$/i);
  if (subdomainMatch?.[1]) {
    return `${subdomainMatch[1]}${imageUrl.pathname || ''}`.replace(/^\/+/, '');
  }
  if (
    hostname === 'ipfs.io' ||
    hostname === 'dweb.link' ||
    hostname === 'nftstorage.link' ||
    hostname === 'w3s.link' ||
    hostname === 'gateway.pinata.cloud' ||
    hostname === '4everland.io' ||
    hostname === 'ipfs.filebase.io'
  ) {
    const match = imageUrl.pathname.match(/^\/ipfs\/(.+)$/i);
    if (match?.[1]) return match[1];
  }
  return null;
};

const getImageFetchCandidates = (imageUrl) => {
  const ipfsPath = getIpfsPath(imageUrl);
  if (!ipfsPath) return [imageUrl.toString()];
  const suffix = `${ipfsPath}${imageUrl.search || ''}`;
  const original = imageUrl.toString();
  const candidates = [original, ...BLACKHOLE_IPFS_GATEWAYS.map((gateway) => `${gateway}${suffix}`)];
  return [...new Set(candidates)];
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
  if (!entry?.buffer || entry.buffer.byteLength > BLACKHOLE_IMAGE_CACHE_ENTRY_MAX_BYTES) return;
  if (imageCache.size >= BLACKHOLE_IMAGE_CACHE_MAX) {
    const oldestKey = imageCache.keys().next().value;
    if (oldestKey) imageCache.delete(oldestKey);
  }
  imageCache.set(key, { ...entry, timestamp: Date.now() });
};

const waitForBackgroundValue = (promise, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, timeout: true });
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: true, value });
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false, error });
      },
    );
  });

const getOrStartImageFetchJob = (cacheKey, imageUrl, makeSized) => {
  const pendingKey = `${makeSized ? 'sized' : 'raw'}:${cacheKey}`;
  const cachedImage = getCachedImage(cacheKey);
  if (cachedImage) return Promise.resolve(cachedImage);
  const pending = imageFetchPending.get(pendingKey);
  if (pending) return pending;
  const job = (async () => {
    const fetchCandidates = getImageFetchCandidates(imageUrl);
    const imageEntry = await Promise.any(
      fetchCandidates.map((candidateUrl) =>
        fetchImageCandidate(candidateUrl, Math.min(BLACKHOLE_IMAGE_TIMEOUT_MS, BLACKHOLE_IMAGE_ATTEMPT_TIMEOUT_MS * 2)),
      ),
    );
    const responseEntry = makeSized ? await makeThumbnail(imageEntry.buffer, imageEntry.contentType) : imageEntry;
    setCachedImage(cacheKey, responseEntry);
    if (imageEntry.sourceUrl) setCachedImage(imageEntry.sourceUrl, responseEntry);
    return responseEntry;
  })().finally(() => {
    imageFetchPending.delete(pendingKey);
  });
  imageFetchPending.set(pendingKey, job);
  return job;
};

const writeImageResponse = (res, entry) => {
  res.writeHead(200, {
    'Content-Type': entry.contentType,
    'Content-Length': String(entry.buffer.byteLength),
    'Cache-Control': 'public, max-age=604800, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(entry.buffer);
};

// Total upstream failure (every gateway/candidate for this image rejected or timed out): respond
// 200 with a tiny placeholder instead of 502 so the client renders a blank tile, not a broken-image
// icon. Short/no cache so the client retries soon and can pick up a real image once available.
// Never written into imageCache — only genuine 2xx upstream bytes are cached there.
const writeImagePlaceholderResponse = (res) => {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': String(BLACKHOLE_IMAGE_PLACEHOLDER_PNG.byteLength),
    'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
    'X-Image-Placeholder': '1',
  });
  res.end(BLACKHOLE_IMAGE_PLACEHOLDER_PNG);
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
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif';
  const prefix = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  if (prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))) return 'image/svg+xml';
  if (prefix.startsWith('<!doctype') || prefix.startsWith('<html') || prefix.startsWith('{') || prefix.startsWith('[')) return null;
  if (normalized.startsWith('image/') && !/^text\/|application\/json/i.test(normalized)) return headerContentType;
  return null;
};

const fetchImageCandidate = async (candidateUrl, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(candidateUrl, {
      headers: {
        Accept: 'image/png,image/webp,image/jpeg,image/apng,image/gif,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36 IdentityPrism/1.0',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!upstream.ok) throw new Error(`Image provider returned ${upstream.status}`);
    const upstreamContentType = upstream.headers.get('content-type') || '';
    const contentLength = Number(upstream.headers.get('content-length') || '0');
    if (contentLength > BLACKHOLE_IMAGE_MAX_BYTES) throw new Error('Image too large');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > BLACKHOLE_IMAGE_MAX_BYTES) throw new Error('Image too large');
    const contentType = detectImageContentType(buffer, upstreamContentType);
    if (!contentType) throw new Error('URL did not return an image');
    return { buffer, contentType, sourceUrl: candidateUrl };
  } finally {
    clearTimeout(timeout);
  }
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
  const nativeFloorSol = pickFirstFloorSol(
    collectionMeta.floorPrice,
    collectionMeta.floor_price,
    collectionMeta.floor,
    collectionMeta.stats?.floorPrice,
    collectionMeta.stats?.floor_price,
    collectionMeta.stats?.floor,
  );
  const nativeListedCount = pickFirstListedCount(
    collectionMeta.listedCount,
    collectionMeta.listed_count,
    collectionMeta.listingCount,
    collectionMeta.numListed,
    collectionMeta.listed,
    collectionMeta.stats?.listedCount,
    collectionMeta.stats?.listed_count,
    collectionMeta.stats?.numListed,
  );
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
  const collectionImage = normalizeImageUrl(collectionMeta.image || collectionMeta.imageUrl || collectionMeta.image_url);
  const image =
    normalizeImageUrl(imageFile?.cdn_uri) ||
    normalizeImageUrl(links.image) ||
    normalizeImageUrl(imageFile?.uri) ||
    collectionImage ||
    undefined;
  return {
    mint,
    name:
      (typeof metadata.name === 'string' && metadata.name.trim()) ||
      (jsonUri ? jsonUri.split('/').pop() : undefined),
    symbol: typeof metadata.symbol === 'string' ? metadata.symbol : undefined,
    image: image ?? null,
    imageUrl: image ?? null,
    imageSource: image ? 'helius' : null,
    isNft,
    collectionId: collectionGroup?.group_value,
    collectionName: collectionGroup?.group_value ? collectionMeta.name || metadata.name : undefined,
    collectionSymbol: collectionGroup?.group_value ? collectionMeta.symbol || metadata.symbol : undefined,
    priceUsd,
    floorSol: nativeFloorSol,
    marketFloorSol: nativeFloorSol,
    marketStatus: nativeFloorSol || (nativeListedCount !== null && nativeListedCount > 0) ? 'listed' : 'unknown',
    marketSource: nativeFloorSol ? 'helius' : null,
    listedCount: nativeListedCount,
  };
};

const isLikelyUnusableTokenImageUrl = (image) => {
  if (!image) return true;
  try {
    const url = new URL(image);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'cdn.helius-rpc.com' && /^\/cdn-cgi\/image\/+$/i.test(url.pathname)) return true;
    if (hostname === 'shdw-drive.genesysgo.net') return true;
    return false;
  } catch {
    return true;
  }
};

const setAssetImage = (asset, image, source) => {
  const normalized = normalizeImageUrl(image);
  asset.image = normalized ?? null;
  asset.imageUrl = normalized ?? null;
  asset.imageSource = normalized ? source : null;
};

const readMetadataString = (buffer, offset) => {
  if (offset + 4 > buffer.length) return { value: null, offset: buffer.length };
  const length = buffer.readUInt32LE(offset);
  offset += 4;
  if (length < 0 || length > 1000 || offset + length > buffer.length) return { value: null, offset: buffer.length };
  return {
    value: buffer.subarray(offset, offset + length).toString('utf8').replace(/\0/g, '').trim(),
    offset: offset + length,
  };
};

const fetchMetaplexMetadataImage = async (mint, candidateUrls) => {
  if (!mint || !candidateUrls?.length) return null;
  let mintKey;
  try {
    mintKey = new PublicKey(mint);
  } catch {
    return null;
  }
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintKey.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const bodyJson = JSON.stringify({
    jsonrpc: '2.0',
    id: `blackhole-metaplex-${mint.slice(0, 6)}`,
    method: 'getAccountInfo',
    params: [metadataPda.toBase58(), { encoding: 'base64', commitment: 'confirmed' }],
  });
  const result = await rpcRace(candidateUrls.slice(0, 3), bodyJson, BLACKHOLE_NFT_FLOOR_TIMEOUT_MS);
  const encoded = result.ok ? result.data?.result?.value?.data?.[0] : null;
  if (!encoded) return null;
  try {
    const buffer = Buffer.from(encoded, 'base64');
    let offset = 1 + 32 + 32;
    const name = readMetadataString(buffer, offset);
    offset = name.offset;
    const symbol = readMetadataString(buffer, offset);
    offset = symbol.offset;
    const uri = readMetadataString(buffer, offset).value;
    if (!uri || !/^https?:\/\//i.test(uri)) return null;
    const json = await fetchJsonWithTimeout(uri, BLACKHOLE_NFT_FLOOR_TIMEOUT_MS);
    return normalizeImageUrl(json.data?.image || json.data?.image_url || json.data?.properties?.files?.find?.((file) => file?.uri)?.uri);
  } catch {
    return null;
  }
};

const preferIpfsGatewayImage = (image) => {
  const normalized = normalizeImageUrl(image);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const ipfsPath = getIpfsPath(url);
    if (!ipfsPath) return { image: normalized, source: null };
    return { image: `${BLACKHOLE_IPFS_GATEWAYS[0]}${ipfsPath}${url.search || ''}`, source: 'ipfs_gateway' };
  } catch {
    return { image: normalized, source: null };
  }
};

const isImageFetchable = async (image) => {
  const normalized = normalizeImageUrl(image);
  if (!normalized) return false;
  try {
    const imageUrl = new URL(normalized);
    if (imageUrl.protocol !== 'https:' && imageUrl.protocol !== 'http:') return false;
    await Promise.any(
      getImageFetchCandidates(imageUrl).map((candidateUrl) =>
        fetchImageCandidate(candidateUrl, Math.min(BLACKHOLE_IMAGE_ATTEMPT_TIMEOUT_MS, 5000)),
      ),
    );
    return true;
  } catch {
    return false;
  }
};

const enrichAssetWithFallbackImage = async (asset, candidateUrls) => {
  if (!asset?.mint) return;
  const cached = getCachedImageResolution(asset.mint);
  if (cached !== undefined) {
    if (cached?.image) setAssetImage(asset, cached.image, cached.source);
    return;
  }

  const current = preferIpfsGatewayImage(asset.image);
  if (current?.image && !isLikelyUnusableTokenImageUrl(current.image)) {
    setAssetImage(asset, current.image, current.source || asset.imageSource || 'helius');
    setCachedImageResolution(asset.mint, { image: asset.image, source: asset.imageSource });
    return;
  }

  const candidates = [];
  const meToken = await fetchMagicEdenTokenByMint(asset.mint);
  const meFiles = Array.isArray(meToken?.properties?.files) ? meToken.properties.files : [];
  candidates.push({ image: meToken?.image || meFiles.find((file) => file?.uri)?.uri, source: 'magic_eden' });
  candidates.push({ image: await fetchMagicEdenLaunchpadImage(asset), source: 'magic_eden' });
  candidates.push({ image: await fetchBirdeyeTokenImage(asset.mint), source: 'birdeye' });
  const jupiterToken = await fetchJupiterTokenByMint(asset.mint);
  candidates.push({ image: jupiterToken?.icon || jupiterToken?.logoURI || jupiterToken?.logo, source: 'jupiter' });
  candidates.push({ image: await fetchMetaplexMetadataImage(asset.mint, candidateUrls), source: 'metaplex' });

  for (const candidate of candidates) {
    const normalized = preferIpfsGatewayImage(candidate.image);
    if (!normalized?.image || isLikelyUnusableTokenImageUrl(normalized.image)) continue;
    if (!(await isImageFetchable(normalized.image))) continue;
    setAssetImage(asset, normalized.image, normalized.source || candidate.source);
    setCachedImageResolution(asset.mint, { image: asset.image, source: asset.imageSource });
    return;
  }
  setCachedImageResolution(asset.mint, null);
};

const enrichAssetsWithFallbackImages = async (assets, candidateUrls) => {
  const entries = Object.values(assets);
  await Promise.allSettled(entries.map((asset) => enrichAssetWithFallbackImage(asset, candidateUrls)));
  return assets;
};

const hydrateAssetsWithCachedImages = (assets) => {
  Object.values(assets).forEach((asset) => {
    const cached = getCachedImageResolution(asset.mint);
    if (cached?.image) {
      setAssetImage(asset, cached.image, cached.source);
      return;
    }
    const current = preferIpfsGatewayImage(asset.image);
    if (current?.image && !isLikelyUnusableTokenImageUrl(current.image)) {
      setAssetImage(asset, current.image, current.source || asset.imageSource || 'helius');
    }
  });
  return assets;
};

const scheduleFallbackImageResolution = (assets, candidateUrls) => {
  Object.values(assets).forEach((asset) => {
    if (!asset?.mint) return;
    if (getCachedImageResolution(asset.mint) !== undefined) return;
    if (!isLikelyUnusableTokenImageUrl(asset.image)) return;
    const backgroundAsset = { ...asset };
    setImmediate(() => {
      void runImageResolutionJob(backgroundAsset, candidateUrls);
    });
  });
};

const getCollectionLookupKey = (asset) => {
  const collectionParts = uniqueStrings([asset.collectionId, asset.collectionSymbol, asset.collectionName]);
  return collectionParts.length ? collectionParts.join('|') : (asset.mint || '');
};

const getMagicEdenCandidates = async (asset) => {
  const slugFromMint = await fetchMagicEdenSlugByMint(asset.mint);
  return uniqueStrings([
    slugFromMint,
    asset.collectionSymbol,
    slugifyCollectionName(asset.collectionName),
    asset.collectionName?.toLowerCase().replace(/\s+/g, '_'),
  ]);
};

const resolveCollectionFloor = async (asset) => {
  if (!asset?.isNft) return null;
  const key = getCollectionLookupKey(asset);
  if (!key) return null;
  const cached = getCachedCollectionFloor(key);
  if (cached) return cached;

  if (asset.marketFloorSol || (asset.listedCount !== null && asset.listedCount > 0)) {
    const nativeStats = {
      status: 'listed',
      floorSol: asset.marketFloorSol ?? null,
      listedCount: asset.listedCount ?? null,
      source: asset.marketSource ?? 'helius',
      tensorUrl: asset.collectionId ? `https://www.tensor.trade/trade/${asset.collectionId}` : null,
      meUrl: asset.mint ? `https://magiceden.io/item-details/${asset.mint}` : null,
    };
    setCachedCollectionFloor(key, nativeStats);
    return nativeStats;
  }

  let best = null;
  let meSlug = null;
  const meCandidates = await getMagicEdenCandidates(asset);
  for (const candidate of meCandidates) {
    const stats = await fetchMagicEdenFloorStats(candidate);
    if (!stats) continue;
    if (stats.floorSol || (stats.listedCount !== null && stats.listedCount > 0)) {
      best = stats;
      meSlug = stats.meSlug ?? candidate;
      break;
    }
    if (!best) {
      best = stats;
      meSlug = stats.meSlug ?? candidate;
    }
  }

  if (!best?.floorSol) {
    const tensorStats = await fetchTensorFloorStats(asset.collectionId, meSlug || asset.collectionSymbol || slugifyCollectionName(asset.collectionName));
    if (tensorStats?.floorSol || (tensorStats?.listedCount !== null && tensorStats?.listedCount > 0)) {
      best = {
        ...tensorStats,
        meUrl: meSlug ? `https://magiceden.io/marketplace/${meSlug}` : (asset.mint ? `https://magiceden.io/item-details/${asset.mint}` : null),
      };
    } else if (!best && tensorStats) {
      best = tensorStats;
    }
  }

  const resolved = best || {
    status: 'unknown',
    floorSol: null,
    listedCount: null,
    source: null,
    tensorUrl: asset.collectionId ? `https://www.tensor.trade/trade/${asset.collectionId}` : null,
    meUrl: asset.mint ? `https://magiceden.io/item-details/${asset.mint}` : null,
  };
  if (!resolved.tensorUrl && asset.collectionId) resolved.tensorUrl = `https://www.tensor.trade/trade/${asset.collectionId}`;
  if (!resolved.meUrl) resolved.meUrl = meSlug ? `https://magiceden.io/marketplace/${meSlug}` : (asset.mint ? `https://magiceden.io/item-details/${asset.mint}` : null);
  setCachedCollectionFloor(key, resolved);
  return resolved;
};

const enrichAssetsWithCollectionFloors = async (assets) => {
  const representativeByKey = new Map();
  Object.values(assets).forEach((asset) => {
    if (!asset?.isNft) return;
    const key = getCollectionLookupKey(asset);
    if (key && !representativeByKey.has(key)) representativeByKey.set(key, asset);
  });
  if (!representativeByKey.size) return assets;

  const entries = await Promise.allSettled(
    Array.from(representativeByKey.entries()).map(async ([key, asset]) => [key, await resolveCollectionFloor(asset)]),
  );
  const statsByKey = new Map();
  entries.forEach((entry) => {
    if (entry.status === 'fulfilled') statsByKey.set(entry.value[0], entry.value[1]);
  });

  Object.values(assets).forEach((asset) => {
    if (!asset?.isNft) return;
    const stats = statsByKey.get(getCollectionLookupKey(asset));
    if (!stats) return;
    const floorSol = stats.floorSol ?? asset.marketFloorSol ?? asset.floorSol ?? null;
    asset.floorSol = floorSol;
    asset.marketFloorSol = floorSol;
    asset.marketStatus = stats.status ?? asset.marketStatus ?? 'unknown';
    asset.marketSource = stats.source ?? asset.marketSource ?? null;
    asset.listedCount = stats.listedCount ?? asset.listedCount ?? null;
    asset.tensorUrl = stats.tensorUrl ?? asset.tensorUrl ?? null;
    asset.meUrl = stats.meUrl ?? asset.meUrl ?? null;
  });
  return assets;
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
      getRpcUrls,
    },
  } = ctx;
  const blackHoleOrchestrator = createBlackHoleOrchestrator(ctx);

  return async function handleBlackholeRoute(req, res, url, pathname) {
    if (pathname === '/api/blackhole/image' && req.method === 'GET') {
      const startedAt = Date.now();
      if (!ipRateLimit('blackhole_image', getClientIp(req), 240, 60000)) {
        return respondJson(res, 429, { error: 'Too many image requests' });
      }

      const rawMint = typeof url.searchParams.get('mint') === 'string' ? url.searchParams.get('mint').trim() : '';
      const rawUrl = normalizeImageUrl(url.searchParams.get('url'));
      let imageUrl;
      try {
        if (rawMint && !rawUrl) {
          new PublicKey(rawMint);
          const cachedResolution = getCachedImageResolution(rawMint);
          let resolved = cachedResolution?.image ? cachedResolution : undefined;
          if (cachedResolution === null) {
            respondJson(res, 502, { error: 'No image available for mint' });
            return true;
          }
          if (!resolved) {
            const rpcUrls = typeof getRpcUrls === 'function' ? getRpcUrls(rawMint) : null;
            const candidateUrls = Array.isArray(rpcUrls) && rpcUrls.length ? rpcUrls : [getRpcUrl(rawMint)].filter(Boolean);
            const asset = { mint: rawMint, image: null, imageUrl: null, imageSource: null };
            const resolutionJob = runImageResolutionJob(asset, candidateUrls);
            const resolutionResult = await waitForBackgroundValue(resolutionJob, BLACKHOLE_IMAGE_RESOLUTION_FAST_RESPONSE_MS);
            if (resolutionResult.ok) {
              resolved = resolutionResult.value;
            } else {
              console.warn('[blackhole-image] warming resolution', {
                mint: rawMint,
                elapsedMs: Date.now() - startedAt,
                timeout: Boolean(resolutionResult.timeout),
              });
              respondJson(res, 502, { error: 'Image lookup warming; retry shortly' });
              return true;
            }
          }
          if (!resolved?.image) {
            console.warn('[blackhole-image] no resolved image', { mint: rawMint, elapsedMs: Date.now() - startedAt });
            respondJson(res, 502, { error: 'No image available for mint' });
            return true;
          }
          imageUrl = new URL(resolved.image);
        } else {
          imageUrl = new URL(rawUrl);
        }
      } catch {
        respondJson(res, 400, { error: 'Invalid image URL' });
        return true;
      }
      if (imageUrl.protocol !== 'https:' && imageUrl.protocol !== 'http:') {
        respondJson(res, 400, { error: 'Image URL must be http or https' });
        return true;
      }

      const cacheKey = imageUrl.toString();
      const cachedImage = getCachedImage(cacheKey);
      if (cachedImage) {
        console.info('[blackhole-image] cache hit', { mint: rawMint || undefined, elapsedMs: Date.now() - startedAt });
        writeImageResponse(res, cachedImage);
        return true;
      }

      try {
        const remainingMs = Math.max(500, BLACKHOLE_IMAGE_FAST_RESPONSE_MS - (Date.now() - startedAt));
        const imageJob = getOrStartImageFetchJob(cacheKey, imageUrl, url.searchParams.has('size'));
        const imageResult = await waitForBackgroundValue(imageJob, remainingMs);
        if (!imageResult.ok) {
          const reason = imageResult.error?.errors?.find?.((entry) => entry?.message)?.message || imageResult.error?.message;
          console.warn('[blackhole-image] warming image bytes', {
            mint: rawMint || undefined,
            elapsedMs: Date.now() - startedAt,
            timeout: Boolean(imageResult.timeout),
            reason,
          });
          // All gateway candidates failed/timed out (or the fast-response window elapsed while the
          // background job is still racing them) — serve a placeholder instead of a hard 502 so the
          // UI never shows a broken-image icon. The background job (if still running) will populate
          // imageCache on success and a later request will get the real bytes.
          writeImagePlaceholderResponse(res);
          return true;
        }
        const responseEntry = imageResult.value;
        console.info('[blackhole-image] served', { mint: rawMint || undefined, elapsedMs: Date.now() - startedAt });
        writeImageResponse(res, responseEntry);
      } catch (error) {
        const reason = error?.errors?.find?.((entry) => entry?.message)?.message || error?.message;
        console.warn('[blackhole-image] failed', { mint: rawMint || undefined, elapsedMs: Date.now() - startedAt, reason });
        writeImagePlaceholderResponse(res);
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
      const cacheKey = `${address}:${hashMints(mints)}`;
      const cachedAssets = getCachedMetadata(cacheKey);
      if (cachedAssets) {
        respondJson(res, 200, { assets: hydrateAssetsWithCachedImages({ ...cachedAssets }), cached: true });
        return true;
      }
      const rpcUrls = typeof getRpcUrls === 'function' ? getRpcUrls(address) : null;
      const candidateUrls = Array.isArray(rpcUrls) && rpcUrls.length ? rpcUrls : [getRpcUrl(address)].filter(Boolean);
      if (!candidateUrls.length) {
        respondJson(res, 503, { error: 'RPC endpoint unavailable' });
        return true;
      }
      const bodyJson = JSON.stringify({ jsonrpc: '2.0', id: 'blackhole-metadata', method: 'getAssetBatch', params: { ids: mints } });
      try {
        const raceResult = await rpcRace(candidateUrls.slice(0, 2), bodyJson, BLACKHOLE_METADATA_TIMEOUT_MS);
        if (!raceResult.ok) {
          respondJson(res, 504, { error: raceResult.error });
          return true;
        }
        const data = raceResult.data;
        const assets = {};
        (Array.isArray(data?.result) ? data.result : []).forEach((asset, index) => {
          const normalized = normalizeAsset(asset, mints[index]);
          if (normalized?.mint) assets[normalized.mint] = normalized;
        });
        hydrateAssetsWithCachedImages(assets);
        scheduleFallbackImageResolution(assets, candidateUrls);
        await enrichAssetsWithCollectionFloors(assets);
        setCachedMetadata(cacheKey, assets);
        respondJson(res, 200, { assets });
      } catch (error) {
        respondJson(res, 504, { error: error?.name === 'AbortError' ? 'Metadata provider timeout' : 'Metadata fetch failed' });
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

      const cacheKey = `${address}:${programId}`;
      const cachedValue = getCachedTokenAccounts(cacheKey);
      if (cachedValue) {
        respondJson(res, 200, { value: cachedValue, cached: true });
        return true;
      }

      const rpcUrls = typeof getRpcUrls === 'function' ? getRpcUrls(address) : null;
      const candidateUrls = Array.isArray(rpcUrls) && rpcUrls.length ? rpcUrls : [getRpcUrl(address)].filter(Boolean);
      if (!candidateUrls.length) {
        respondJson(res, 503, { error: 'RPC endpoint unavailable' });
        return true;
      }

      const bodyJson = JSON.stringify({
        jsonrpc: '2.0',
        id: `blackhole-token-accounts-${programId.slice(0, 6)}`,
        method: 'getTokenAccountsByOwner',
        params: [address, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
      });
      const attemptTimeoutMs = BLACKHOLE_TOKEN_ACCOUNTS_ATTEMPT_TIMEOUT_MS;
      const tokenAccountsResult = await rpcMostCompleteTokenAccounts(candidateUrls, bodyJson, attemptTimeoutMs);
      if (tokenAccountsResult.ok) {
        const value = tokenAccountsResult.value;
        const cacheable = shouldCacheTokenAccounts({
          value,
          counts: tokenAccountsResult.counts,
          attempted: tokenAccountsResult.attempted,
        });
        if (cacheable) setCachedTokenAccounts(cacheKey, value);
        respondJson(res, 200, {
          value,
          selectedCount: tokenAccountsResult.selectedCount,
          providerCounts: tokenAccountsResult.counts,
          providerCount: tokenAccountsResult.providerCount,
          cacheable,
        });
        return true;
      }
      let lastError = tokenAccountsResult.error || 'Token account scan failed';
      let lastStatus = 504;
      for (const url of candidateUrls.slice(BLACKHOLE_TOKEN_ACCOUNTS_MAX_PARALLEL_RPCS)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
        try {
          const upstream = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyJson, signal: controller.signal });
          if (!upstream.ok) { lastStatus = 502; lastError = `provider ${upstream.status}`; continue; }
          const data = await upstream.json();
          if (data?.error) { lastStatus = 502; lastError = data.error.message || 'rpc error'; continue; }
          const value = Array.isArray(data?.result?.value) ? data.result.value : [];
          if (shouldCacheTokenAccounts({ value, counts: [value.length], attempted: 1 })) {
            setCachedTokenAccounts(cacheKey, value);
          }
          respondJson(res, 200, { value, selectedCount: value.length, providerCounts: [value.length], providerCount: 1, cacheable: true });
          return true;
        } catch (e) {
          lastStatus = 504;
          lastError = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'fetch failed');
        } finally { clearTimeout(timeout); }
      }
      respondJson(res, lastStatus, { error: lastError });
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
