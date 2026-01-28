const HELIUS_PROXY_URL = (import.meta.env.VITE_HELIUS_PROXY_URL ?? '').trim();
const METADATA_BASE_URL = (import.meta.env.VITE_METADATA_BASE_URL ?? '').trim();
const METADATA_IMAGE_URL = (import.meta.env.VITE_METADATA_IMAGE_URL ?? '').trim();
const APP_BASE_URL = (import.meta.env.VITE_APP_BASE_URL ?? '').trim();
const HELIUS_KEYS = (import.meta.env.VITE_HELIUS_API_KEYS ?? import.meta.env.VITE_HELIUS_API_KEY ?? '')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);

const normalizeProxyUrl = (url: string) => url.replace(/\/+$/, '');

export const getHeliusProxyUrl = () => (HELIUS_PROXY_URL ? normalizeProxyUrl(HELIUS_PROXY_URL) : null);
export const getMetadataBaseUrl = () => (METADATA_BASE_URL ? normalizeProxyUrl(METADATA_BASE_URL) : null);
export const getMetadataImageUrl = () => {
  if (METADATA_IMAGE_URL) return METADATA_IMAGE_URL;
  const baseUrl = getMetadataBaseUrl();
  return baseUrl ? `${baseUrl}/assets/identity-prism.png` : null;
};
export const getAppBaseUrl = () => (APP_BASE_URL ? normalizeProxyUrl(APP_BASE_URL) : null);

const getHeliusKeyIndex = (seed?: string) => {
  if (!HELIUS_KEYS.length) return -1;
  if (!seed) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }
  return Math.abs(hash) % HELIUS_KEYS.length;
};

export const getHeliusRpcUrl = (seed?: string) => {
  const proxyUrl = getHeliusProxyUrl();
  if (proxyUrl) return `${proxyUrl}/rpc`;
  const index = getHeliusKeyIndex(seed);
  if (index < 0) return null;
  return `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEYS[index]}`;
};

export const getHeliusRpcUrls = (seed?: string) => {
  const proxyUrl = getHeliusProxyUrl();
  if (proxyUrl) return [`${proxyUrl}/rpc`];
  if (!HELIUS_KEYS.length) return [];
  const startIndex = Math.max(0, getHeliusKeyIndex(seed));
  return HELIUS_KEYS.map((_, index) => {
    const key = HELIUS_KEYS[(startIndex + index) % HELIUS_KEYS.length];
    return `https://mainnet.helius-rpc.com/?api-key=${key}`;
  });
};

export const getHeliusProxyHeaders = (seed?: string) => {
  const proxyUrl = getHeliusProxyUrl();
  if (!proxyUrl) return undefined;
  if (!seed) return undefined;
  return { 'x-wallet-address': seed } as const;
};

export const HELIUS_CONFIG = {
  API_KEYS: HELIUS_KEYS,
  REST_URL: 'https://api.helius.xyz/v0',
};

export const MINT_CONFIG = {
  PRICE_SOL: 0.01,
  NETWORK: 'mainnet-beta',
  COLLECTION: 'Identity Prism',
  SYMBOL: 'PRISM',
  SELLER_FEE_BASIS_POINTS: 0,
};

// Scoring + rarity system (Identity Prism 3.0)
export const SCORING = {
  SEEKER_GENESIS_BONUS: 200,
  CHAPTER2_PREORDER_BONUS: 150,
  COMBO_BONUS: 200,
  BLUE_CHIP_BONUS: 50,
  MEME_LORD_BONUS: 30,
  DEFI_KING_BONUS: 30,
  HYPERACTIVE_THRESHOLD_30D: 8, // tx/day
  DIAMOND_HANDS_DAYS: 60,
  DIAMOND_HANDS_BONUS: 50,
  HYPERACTIVE_BONUS: 50,

  SOL_BALANCE_THRESHOLDS: {
    MINOR: { amount: 0.1, bonus: 15 },
    MAJOR: { amount: 1, bonus: 35 },
    LEGEND: { amount: 5, bonus: 75 },
  },

  WALLET_AGE_PER_YEAR: 50,
  WALLET_AGE_MAX: 150,

  TX_COUNT_MULTIPLIER: 0.2,
  TX_COUNT_CAP: 100,

  MAX_SCORE: 1200,
  BLUE_CHIP_THRESHOLD: 10,
} as const;

export const RARITY_THRESHOLDS = {
  COMMON: 0,
  RARE: 201,
  EPIC: 451,
  LEGENDARY: 651,
  MYTHIC: 851,
} as const;

export const MAX_SCORE_CAP = 1200;

export const TOKEN_ADDRESSES = {
  SEEKER_GENESIS_COLLECTION: 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te',
  SEEKER_MINT_AUTHORITY: 'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4',
  CHAPTER2_PREORDER: '2DMMamkkxQ6zDMBtkFp8KH7FoWzBMBA1CGTYwom4QH6Z',
} as const;

export const MEME_COIN_MINTS = {
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  POPCAT: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
  MEW: 'MEW1VNoNHn99uH86fUvYvU42o9YkS9uH9Tst6t2291',
} as const;

export const LST_MINTS = {
  JITOSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  MSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  BSOL: 'BSo13v7qDMGWCM1cW8wwfsfZ7vQLZKxHCiNSN2B7Mq2u',
} as const;

export const DEFI_POSITION_HINTS = ['kamino', 'drift', 'marginfi', 'mango', 'jito', 'solend', 'zeta'];

export const BLUE_CHIP_COLLECTIONS = [
  'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w', // Mad Lads
  'SMBH3wF6pdt967Y62N7S5mB4tJSTH3KAsdJ82D3L2nd', // SMB Gen2
  'SMB3ndYpSXY97H8MhpxYit3pD8TzYJ5v6ndP4D2L2nd', // SMB Gen3
  '6v9UWGmEB5Hthst9KqEAgXW6XF6R6yv4t7Yf3YfD3A7t', // Claynosaurz
  'BUjZjAS2vbbb9p56fAun4sFmPAt8W6JURG5L3AkVvHP9', // Famous Fox Federation
  '4S8L8L1M5E1X5vM1Y1M1X5vM1Y1M1X5vM1Y1M1X5vM1Y', // Tensorians
  '7TENEKwBnkpENuefriGPg4hBDR4WJ2Gyfw5AhdkMA4rq', // Okay Bears
  '9uBX3ASuCtv6S5o56yq7F9n7U6o9o7o9o7o9o7o9o7o9', // Degen Ape Academy
  'GGSGP689TGoX6WJ9mSj2S8mH78S8S8S8S8S8S8S8S8S8S', // Galactic Geckos
  'CDgbhX61QFADQAeeYKP5BQ7nnzDyMkkR3NEhYF2ETn1k', // Taiyo Robotics
  'Port7uDYB3P8meS5m7Yv62222222222222222222222', // Portals
  'CocMmG5v88888888888888888888888888888888888', // Cets on Creck
  'y00t9S9mD9mD9mD9mD9mD9mD9mD9mD9mD9mD9mD9mD', // y00ts
  'abc777777777777777777777777777777777777777', // ABC
  'LILY5555555555555555555555555555555555555', // LILY
  'PRM77777777777777777777777777777777777777', // Primates
  'Jelly8888888888888888888888888888888888888', // Jelly Rascals
  '4Q2C5S930M9c9e96b', // Froganas (prefix match suggested)
  'TFF77777777777777777777777777777777777777', // TFF
  'DTP77777777777777777777777777777777777777', // DTP
];

export const BLUE_CHIP_COLLECTION_NAMES = ['mad lads', 'solana monkey business', 'claynosaurz'];

export const TREASURY_ADDRESS = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';

// Visual Configuration
export const VISUAL_CONFIG = {
  // Sun configurations
  SUN: {
    BASE_SIZE: 2,
    SEEKER_COLOR: '#00D4FF', // Cyan/Teal
    PREORDER_COLOR: '#FFD700', // Gold
    COMBO_PRIMARY: '#00D4FF', // Cyan
    COMBO_SECONDARY: '#FFD700', // Gold
    DEFAULT_COLOR: '#FF6B35', // Orange
    EMISSIVE_INTENSITY: 20,
    RARE_COLOR: '#8CFFE3',
    RARE_ACCENT: '#FFD19A',
    EPIC_COLOR: '#C3A3FF',
    EPIC_ACCENT: '#FF7AE2',
    LEGENDARY_COLOR: '#6AD9FF',
    MYTHIC_PRIMARY: '#FF9C6D',
    MYTHIC_SECONDARY: '#7F5BFF',
  },
  
  // Planet generation
  PLANETS: {
    TOKENS_PER_PLANET: 10, // 1 planet per 10 unique tokens
    MAX_PLANETS: 10,
    MIN_ORBIT_RADIUS: 6,
    ORBIT_SPACING: 2.5,
    SIZE_RANGE: { min: 0.3, max: 0.8 },
  },
  
  // Moon generation
  MOONS: {
    NFTS_PER_MOON: 50, // 1 moon per 50 NFTs
    MAX_MOONS_PER_PLANET: 4,
    SIZE_RANGE: { min: 0.05, max: 0.15 },
    ORBIT_RADIUS: { min: 0.8, max: 1.5 },
  },
  
  // Space dust density based on activity
  DUST: {
    BASE_COUNT: 150,
    TX_MULTIPLIER: 4, // Additional particles per 100 tx
    MAX_PARTICLES: 1500, // Reduced for mobile performance
  },
  
  // Animation speeds (Dramatically slowed down for a majestic cinematic feel)
  ANIMATION: {
    SUN_ROTATION: 0.001,
    PLANET_ORBIT: 0.02,
    PLANET_ROTATION: 0.075,
    MOON_ORBIT: 0.1,
    BINARY_ORBIT: 0.01,
  },
  
  // Post-processing (High-Clarity Cinematic - Mobile Optimized)
  POST_PROCESSING: {
    BLOOM_INTENSITY: 1.1,
    BLOOM_LUMINANCE_THRESHOLD: 0.88,
    BLOOM_LUMINANCE_SMOOTHING: 0.85,
    CHROMATIC_ABERRATION: 0.0003, // Very subtle, edge-only
    VIGNETTE_DARKNESS: 0.3,
    NOISE_OPACITY: 0.008,
  },
  
  // Starfield configuration
  STARS: {
    RADIUS: 300,
    DEPTH: 50,
    COUNT: 3000,
    FACTOR: 4,
    SATURATION: 0,
    FADE: false,
  },
  
  ORBITS: {
    DEFAULT: '#4488ff',
    GOLDEN: '#ffd479',
  },
  
  NEBULA: {
    COLORS: ['#2b1055', '#7a00ff', '#ff8e53'],
    INTENSITY: 0.45,
  },
} as const;

export type RarityTier = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

// Planet types for visual variety
export const PLANET_TYPES = [
  { name: 'terrestrial', baseColor: '#1a4d2e', accent: '#4ade80', surface: 'terrestrial', roughness: 0.8, metalness: 0.2, emissiveIntensity: 0.35 },
  { name: 'volcanic', baseColor: '#7c2d12', accent: '#ef4444', surface: 'volcanic', roughness: 0.9, metalness: 0.2, emissiveIntensity: 0.4 },
  { name: 'gas', baseColor: '#92400e', accent: '#f59e0b', surface: 'gas', roughness: 0.5, metalness: 0.2, emissiveIntensity: 0.25 },
  { name: 'ice', baseColor: '#bae6fd', accent: '#ffffff', surface: 'ice', roughness: 0.2, metalness: 0.5, emissiveIntensity: 0.3 },
] as const;

export const MEME_COIN_PRICES_USD: Record<keyof typeof MEME_COIN_MINTS, number> = {
  BONK: 0.000002,
  WIF: 3.5,
  POPCAT: 0.35,
  MEW: 0.003,
};
