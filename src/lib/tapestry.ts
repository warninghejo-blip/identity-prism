/**
 * Tapestry Social Graph integration for Identity Prism.
 * Publishes wallet identity profiles and scan results to the Tapestry protocol,
 * making on-chain reputation composable across the Solana ecosystem.
 *
 * Docs: https://docs.usetapestry.dev/
 */

const TAPESTRY_API_URL = 'https://api.usetapestry.dev/v1';
const TAPESTRY_API_KEY = (import.meta.env.VITE_TAPESTRY_API_KEY ?? '').trim();
const TAPESTRY_NAMESPACE = 'identity_prism';

export const isTapestryEnabled = () => Boolean(TAPESTRY_API_KEY);

// ── Types ──

export interface TapestryProfile {
  profile: {
    id: string;
    username: string;
    bio: string;
    walletAddress: string;
    blockchain: string;
    namespace: string;
    customProperties: Record<string, string>;
    createdAt: string;
    updatedAt: string;
  };
  socialCounts: {
    followers: number;
    following: number;
    posts: number;
    likes: number;
  };
}

export interface IdentityData {
  walletAddress: string;
  score: number;
  planetTier: string;
  rarity: string;
  badges: string[];
  walletAgeDays?: number;
  txCount?: number;
  nftCount?: number;
  tokenCount?: number;
}

// ── API helpers ──

async function tapestryFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${TAPESTRY_API_URL}${path}${separator}apiKey=${TAPESTRY_API_KEY}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Tapestry API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Profile ──

function buildBio(data: IdentityData): string {
  const tier = data.planetTier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const badges = data.badges.length > 0 ? ` | Badges: ${data.badges.join(', ')}` : '';
  return `Score: ${data.score} | Tier: ${tier} | Rarity: ${data.rarity}${badges}`;
}

function buildCustomProperties(data: IdentityData): Array<{ key: string; value: string }> {
  return [
    { key: 'score', value: String(data.score) },
    { key: 'planetTier', value: data.planetTier },
    { key: 'rarity', value: data.rarity },
    { key: 'badges', value: data.badges.join(',') },
    { key: 'badgeCount', value: String(data.badges.length) },
    ...(data.walletAgeDays != null ? [{ key: 'walletAgeDays', value: String(data.walletAgeDays) }] : []),
    ...(data.txCount != null ? [{ key: 'txCount', value: String(data.txCount) }] : []),
    ...(data.nftCount != null ? [{ key: 'nftCount', value: String(data.nftCount) }] : []),
    ...(data.tokenCount != null ? [{ key: 'tokenCount', value: String(data.tokenCount) }] : []),
    { key: 'app', value: 'Identity Prism' },
    { key: 'appUrl', value: 'https://identityprism.xyz' },
  ];
}

/**
 * Create or update a Tapestry profile for a scanned wallet.
 */
export async function publishProfile(data: IdentityData): Promise<TapestryProfile> {
  if (!isTapestryEnabled()) throw new Error('Tapestry API key not configured');

  const shortAddr = `${data.walletAddress.slice(0, 4)}..${data.walletAddress.slice(-4)}`;
  const username = `prism_${data.walletAddress.slice(0, 8).toLowerCase()}`;

  const profile = await tapestryFetch<TapestryProfile>('/profiles/findOrCreate', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: data.walletAddress,
      username,
      bio: buildBio(data),
      blockchain: 'SOLANA',
      execution: 'FAST_UNCONFIRMED',
      customProperties: buildCustomProperties(data),
    }),
  });

  return profile;
}

/**
 * Publish a wallet scan result as content on Tapestry.
 */
export async function publishScanContent(
  profileId: string,
  data: IdentityData,
): Promise<{ id: string }> {
  if (!isTapestryEnabled()) throw new Error('Tapestry API key not configured');

  const tier = data.planetTier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const content = `🔮 Identity Prism scan: ${tier} tier wallet (Score: ${data.score}) with ${data.badges.length} badges. Rarity: ${data.rarity}.`;

  const result = await tapestryFetch<{ content: { id: string } }>('/contents/create', {
    method: 'POST',
    body: JSON.stringify({
      profileId,
      content,
      contentType: 'text',
      blockchain: 'SOLANA',
      execution: 'FAST_UNCONFIRMED',
      customProperties: [
        { key: 'type', value: 'wallet_scan' },
        { key: 'walletAddress', value: data.walletAddress },
        { key: 'score', value: String(data.score) },
        { key: 'planetTier', value: data.planetTier },
        { key: 'rarity', value: data.rarity },
        { key: 'badges', value: data.badges.join(',') },
        { key: 'appUrl', value: `https://identityprism.xyz/?address=${data.walletAddress}` },
      ],
    }),
  });

  return { id: result.content?.id ?? 'unknown' };
}

/**
 * Get a Tapestry profile for a wallet address (if it exists).
 */
export async function getProfile(walletAddress: string): Promise<TapestryProfile | null> {
  if (!isTapestryEnabled()) return null;

  const username = `prism_${walletAddress.slice(0, 8).toLowerCase()}`;
  try {
    const profile = await tapestryFetch<TapestryProfile>(`/profiles/${username}`);
    return profile;
  } catch {
    return null;
  }
}

/**
 * Full publish flow: create/update profile + publish scan content.
 * Returns the profile data on success.
 */
export async function publishIdentityToTapestry(data: IdentityData): Promise<{
  profile: TapestryProfile;
  contentId: string;
}> {
  const profile = await publishProfile(data);
  const profileId = profile.profile?.id ?? profile.profile?.username;
  const { id: contentId } = await publishScanContent(profileId, data);
  return { profile, contentId };
}
