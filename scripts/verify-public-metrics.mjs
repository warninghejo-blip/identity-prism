import { readFile } from 'node:fs/promises';

const DEFAULT_ORIGIN = 'https://identityprism.xyz';
const originIndex = process.argv.indexOf('--origin');
const origin = new URL(originIndex >= 0 ? process.argv[originIndex + 1] : DEFAULT_ORIGIN);
const timeoutMs = 30_000;

function requiredMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match?.[1]) throw new Error(`Unable to read ${label} from tracked configuration`);
  return match[1];
}

function parseStoreConfig(text) {
  const appBlock = requiredMatch(text, /^app:\r?\n([\s\S]*?)^release:/m, 'dApp Store app block');
  const releaseBlock = requiredMatch(text, /^release:\r?\n([\s\S]*?)^solana_mobile_dapp_publisher_portal:/m, 'dApp Store release block');
  return {
    packageId: requiredMatch(appBlock, /^\s{2}android_package:\s*(\S+)/m, 'Android package'),
    appAddress: requiredMatch(appBlock, /^\s{2}address:\s*(\S+)/m, 'app address'),
    releaseAddress: requiredMatch(releaseBlock, /^\s{2}address:\s*(\S+)/m, 'release address'),
  };
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function rpc(method, params, id = method) {
  const payload = await fetchJson(new URL('/rpc', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  if (payload?.error) throw new Error(`${method} returned RPC error ${payload.error.code ?? 'unknown'}`);
  return payload?.result;
}

const uniqueCount = (items) => new Set(items.filter(Boolean)).size;
const isCanonicalAsset = (asset, collection) =>
  asset?.grouping?.some((group) => group.group_key === 'collection' && group.group_value === collection);

const [constantsText, currentStoreText, legacyStoreText] = await Promise.all([
  readFile(new URL('../src/constants.ts', import.meta.url), 'utf8'),
  readFile(new URL('../dapp-store/config.yaml', import.meta.url), 'utf8'),
  readFile(new URL('../publishing/config.yaml', import.meta.url), 'utf8'),
]);

const collection = requiredMatch(
  constantsText,
  /PRODUCTION_CORE_COLLECTION\s*=\s*['"]([1-9A-HJ-NP-Za-km-z]{32,44})['"]/,
  'canonical collection',
);
const currentStore = parseStoreConfig(currentStoreText);
const legacyStore = parseStoreConfig(legacyStoreText);

const [stats, collectionAsset, groupedResult] = await Promise.all([
  fetchJson(new URL('/api/stats/global', origin)),
  rpc('getAsset', { id: collection }, 'canonical-collection'),
  rpc('getAssetsByGroup', {
    groupKey: 'collection',
    groupValue: collection,
    page: 1,
    limit: 1000,
  }, 'canonical-assets'),
]);

const grouped = groupedResult?.items ?? [];
if (Number(groupedResult?.total ?? grouped.length) > grouped.length) {
  throw new Error('Canonical collection exceeds the verifier page limit; pagination must be added');
}

const live = grouped.filter((asset) => !asset.burnt);
const burnt = grouped.filter((asset) => asset.burnt);
const authority = collectionAsset?.authorities?.[0]?.address;
if (!authority) throw new Error('Canonical collection has no discoverable authority');

const authorityResult = await rpc('getAssetsByAuthority', {
  authorityAddress: authority,
  page: 1,
  limit: 1000,
}, 'authority-assets');
const authorityAssets = authorityResult?.items ?? [];
if (Number(authorityResult?.total ?? authorityAssets.length) > authorityAssets.length) {
  throw new Error('Authority inventory exceeds the verifier page limit; pagination must be added');
}

const knownStoreIds = new Set([
  currentStore.appAddress,
  currentStore.releaseAddress,
  legacyStore.appAddress,
  legacyStore.releaseAddress,
]);
const legacyIdentityCandidates = authorityAssets.filter((asset) =>
  asset.id !== collection
  && !isCanonicalAsset(asset, collection)
  && !knownStoreIds.has(asset.id)
  && asset.interface === 'V1_NFT'
  && /^Identity Prism/i.test(asset.content?.metadata?.name ?? ''),
);

const storeIds = [...knownStoreIds];
const storeAssets = await Promise.all(storeIds.map((id) => rpc('getAsset', { id }, `store-${id.slice(0, 6)}`)));
const storeById = Object.fromEntries(storeAssets.map((asset, index) => [storeIds[index], asset]));

const accountResults = await Promise.all([collection, ...storeIds].map((address) =>
  rpc('getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }], `account-${address.slice(0, 6)}`)
    .then((value) => ({ address, exists: Boolean(value), ownerProgram: value?.owner ?? null })),
));

const summarizeStore = (config) => ({
  packageId: config.packageId,
  appAddress: config.appAddress,
  releaseAddress: config.releaseAddress,
  appDiscoverable: Boolean(storeById[config.appAddress]),
  releaseDiscoverable: Boolean(storeById[config.releaseAddress]),
  releaseGroupedToApp: Boolean(
    storeById[config.releaseAddress]?.grouping?.some(
      (group) => group.group_key === 'collection' && group.group_value === config.appAddress,
    ),
  ),
});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  origin: origin.origin,
  definitions: {
    recordedMintWallets: 'COUNT(*) from minted_addresses, whose address column is the primary key',
    cumulativeMintEvents: 'not exposed by the public API or reconstructable from the presence table',
    canonicalAssets: 'DAS getAssetsByGroup records for the tracked production collection',
    legacyIdentityCandidates: 'authority-visible, noncanonical V1_NFT records named Identity Prism; not a global historical total',
  },
  server: {
    recordedMintWallets: stats.idsMinted,
    cumulativeMintEvents: null,
    scannedWalletVerdicts: stats.walletsScanned,
    sybilsCaught: stats.sybilsCaught,
    sybilsReported: stats.sybilsReported,
    blackHoleOperations: stats.blackHoleOps,
    clusters: stats.clusters,
    updatedAt: stats.updatedAt,
  },
  canonicalCollection: {
    address: collection,
    interface: collectionAsset?.interface ?? null,
    authority,
    discoverableAssets: grouped.length,
    liveAssets: live.length,
    burntAssets: burnt.length,
    allUniqueOwners: uniqueCount(grouped.map((asset) => asset.ownership?.owner)),
    liveUniqueOwners: uniqueCount(live.map((asset) => asset.ownership?.owner)),
  },
  legacyIdentityCandidates: {
    count: legacyIdentityCandidates.length,
    assetIds: legacyIdentityCandidates.map((asset) => asset.id).sort(),
  },
  dappStore: {
    current: summarizeStore(currentStore),
    legacy: summarizeStore(legacyStore),
  },
  solanaAccounts: accountResults,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
