/**
 * Tapestry Social Graph integration for Identity Prism.
 * Publishes wallet identity profiles and scan results to the Tapestry protocol,
 * making on-chain reputation composable across the Solana ecosystem.
 *
 * Docs: https://docs.usetapestry.dev/
 */

import { getAppBaseUrl, getHeliusProxyUrl } from '@/constants';

const TAPESTRY_API_KEY = (import.meta.env.VITE_TAPESTRY_API_KEY ?? '').trim();
const TAPESTRY_NAMESPACE = 'identity_prism';

export const isTapestryEnabled = () => Boolean(TAPESTRY_API_KEY);

/**
 * Resolve Tapestry base URL. Prefer server proxy to avoid CORS.
 * Falls back to direct API if no proxy is available.
 */
type TapestryBaseCandidate = {
  baseUrl: string;
  isProxy: boolean;
};

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildTapestryBaseCandidates(): TapestryBaseCandidate[] {
  const out: TapestryBaseCandidate[] = [];
  const seen = new Set<string>();

  const push = (url: string, isProxy: boolean) => {
    const normalized = normalizeBase(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ baseUrl: normalized, isProxy });
  };

  // Only use server-side proxy to avoid CORS issues.
  // Direct calls to api.usetapestry.dev are blocked by CORS from browser.
  const proxy = getHeliusProxyUrl();
  if (proxy) push(`${proxy}/api/tapestry`, true);

  const appBase = getAppBaseUrl();
  if (appBase) push(`${appBase}/api/tapestry`, true);

  if (typeof window !== 'undefined' && window.location?.origin) {
    push(`${window.location.origin}/api/tapestry`, true);
  }

  return out;
}

function shouldRetryWithNextCandidate(status: number, bodyPreview: string, isProxy: boolean): boolean {
  if (!isProxy) return false;
  // Don't retry on 500 — that's the upstream Tapestry error, retrying won't help
  if ([404, 405, 408, 429, 502, 503, 504].includes(status)) return true;
  return /^\s*</.test(bodyPreview);
}

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
  const method = String(options?.method ?? 'GET').toUpperCase();
  const candidates = buildTapestryBaseCandidates();
  let lastError: Error | null = null;

  for (let idx = 0; idx < candidates.length; idx += 1) {
    const candidate = candidates[idx];
    const isLast = idx === candidates.length - 1;
    const url = candidate.isProxy
      ? `${candidate.baseUrl}${path}`
      : `${candidate.baseUrl}${path}${path.includes('?') ? '&' : '?'}apiKey=${TAPESTRY_API_KEY}`;

    const hasBody = options?.body !== undefined && options?.body !== null;
    const requestHeaders = new Headers(options?.headers ?? undefined);
    if (hasBody && !requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json');
    }
    if (!hasBody && requestHeaders.has('Content-Type')) {
      requestHeaders.delete('Content-Type');
    }

    let requestOptions: RequestInit = {
      ...options,
      method,
      headers: requestHeaders,
    };

    // If a local build is calling a remote proxy URL, make POST a simple CORS request
    // (text/plain) to avoid brittle OPTIONS preflight failures in edge deploy setups.
    if (candidate.isProxy && method === 'POST' && typeof window !== 'undefined') {
      const requestOrigin = new URL(url, window.location.origin).origin;
      const isCrossOrigin = requestOrigin !== window.location.origin;
      if (isCrossOrigin) {
        requestOptions = {
          ...requestOptions,
          headers: {
            'Content-Type': 'text/plain;charset=UTF-8',
          },
          body: typeof options?.body === 'string' ? options.body : JSON.stringify(options?.body ?? {}),
        };
      }
    }

    try {
      const res = await fetch(url, requestOptions);
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        const preview = text.slice(0, 240);
        if (!isLast && shouldRetryWithNextCandidate(res.status, preview, candidate.isProxy)) {
          lastError = new Error(`Tapestry API ${res.status}: ${preview}`);
          continue;
        }
        throw new Error(`Tapestry API ${res.status}: ${text}`);
      }
      return res.json() as Promise<T>;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!isLast) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('Tapestry request failed');
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
      id: data.walletAddress,
      walletAddress: data.walletAddress,
      username,
      bio: buildBio(data),
      blockchain: 'SOLANA',
      execution: 'FAST_UNCONFIRMED',
      properties: buildCustomProperties(data),
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
      properties: [
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

// ── Game Score Publishing (Orbit Survival) ──

export interface GameScoreData {
  walletAddress: string;
  score: number;
  survivalTime: string;
  txSignature?: string;
  sessionProofId?: string;
  sessionProofHash?: string;
  sessionSeed?: string;
  sessionSlot?: number;
  sessionProofUrl?: string;
}

/**
 * Publish a game high score to Tapestry social graph.
 */
export async function publishGameScore(data: GameScoreData): Promise<{ contentId: string }> {
  if (!isTapestryEnabled()) throw new Error('Tapestry API key not configured');

  const username = `prism_${data.walletAddress.slice(0, 8).toLowerCase()}`;

  let profile: TapestryProfile;
  try {
    profile = await tapestryFetch<TapestryProfile>('/profiles/findOrCreate', {
      method: 'POST',
      body: JSON.stringify({
        id: data.walletAddress,
        walletAddress: data.walletAddress,
        username,
        bio: `Orbit Survival pilot | Best: ${data.survivalTime}`,
        blockchain: 'SOLANA',
        execution: 'FAST_UNCONFIRMED',
      }),
    });
  } catch {
    throw new Error('Failed to create Tapestry profile');
  }

  const profileId = profile.profile?.id ?? profile.profile?.username;
  const content = `🛸 Survived ${data.survivalTime} in Orbit Survival! Score: ${data.score}s${data.txSignature ? ` | Verified on-chain ✅` : ''}${data.sessionProofId ? ' | MagicBlock session proof 🔐' : ''} | Can you beat me? #OrbitSurvival #IdentityPrism`;

  const properties = [
    { key: 'type', value: 'game_score' },
    { key: 'game', value: 'orbit_survival' },
    { key: 'walletAddress', value: data.walletAddress },
    { key: 'score', value: String(data.score) },
    { key: 'survivalTime', value: data.survivalTime },
    ...(data.txSignature ? [{ key: 'txSignature', value: data.txSignature }] : []),
    ...(data.sessionProofId ? [{ key: 'sessionProofId', value: data.sessionProofId }] : []),
    ...(data.sessionProofHash ? [{ key: 'sessionProofHash', value: data.sessionProofHash }] : []),
    ...(data.sessionSeed ? [{ key: 'sessionSeed', value: data.sessionSeed }] : []),
    ...(data.sessionSlot != null ? [{ key: 'sessionSlot', value: String(data.sessionSlot) }] : []),
    ...(data.sessionProofUrl ? [{ key: 'sessionProofUrl', value: data.sessionProofUrl }] : []),
    { key: 'appUrl', value: 'https://identityprism.xyz/game' },
  ];

  const result = await tapestryFetch<{ content: { id: string } }>('/contents/create', {
    method: 'POST',
    body: JSON.stringify({
      profileId,
      content,
      contentType: 'text',
      blockchain: 'SOLANA',
      execution: 'FAST_UNCONFIRMED',
      properties,
    }),
  });

  return { contentId: result.content?.id ?? 'unknown' };
}

/**
 * Challenge a friend by posting a score and tagging another wallet.
 */
export async function challengeFriend(
  senderAddress: string,
  friendAddress: string,
  score: number,
  survivalTime: string,
): Promise<{ contentId: string }> {
  if (!isTapestryEnabled()) throw new Error('Tapestry API key not configured');

  const username = `prism_${senderAddress.slice(0, 8).toLowerCase()}`;
  const friendShort = `${friendAddress.slice(0, 4)}...${friendAddress.slice(-4)}`;

  const profile = await tapestryFetch<TapestryProfile>('/profiles/findOrCreate', {
    method: 'POST',
    body: JSON.stringify({
      id: senderAddress,
      walletAddress: senderAddress,
      username,
      bio: `Orbit Survival pilot`,
      blockchain: 'SOLANA',
      execution: 'FAST_UNCONFIRMED',
    }),
  });

  const profileId = profile.profile?.id ?? profile.profile?.username;
  const content = `🎯 I challenge ${friendShort} to beat my ${survivalTime} in Orbit Survival! Think you can survive longer? #OrbitSurvival #Challenge`;

  const result = await tapestryFetch<{ content: { id: string } }>('/contents/create', {
    method: 'POST',
    body: JSON.stringify({
      profileId,
      content,
      contentType: 'text',
      blockchain: 'SOLANA',
      execution: 'FAST_UNCONFIRMED',
      properties: [
        { key: 'type', value: 'game_challenge' },
        { key: 'game', value: 'orbit_survival' },
        { key: 'challenger', value: senderAddress },
        { key: 'challenged', value: friendAddress },
        { key: 'score', value: String(score) },
        { key: 'survivalTime', value: survivalTime },
      ],
    }),
  });

  return { contentId: result.content?.id ?? 'unknown' };
}
