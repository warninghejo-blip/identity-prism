/**
 * Canonical tier colors and labels for Identity Prism.
 * Import from here instead of duplicating across components.
 */

export const TIER_COLORS_TW: Record<string, string> = {
  mercury: 'text-stone-300',
  mars: 'text-orange-400',
  venus: 'text-yellow-300',
  earth: 'text-blue-400',
  neptune: 'text-cyan-400',
  uranus: 'text-sky-300',
  saturn: 'text-amber-300',
  jupiter: 'text-orange-300',
  sun: 'text-yellow-400',
  binary_sun: 'text-amber-400',
};

export const TIER_HEX: Record<string, string> = {
  mercury: '#a8a29e', mars: '#fb923c', venus: '#fde047', earth: '#60a5fa',
  neptune: '#22d3ee', uranus: '#7dd3fc', saturn: '#fcd34d', jupiter: '#fdba74',
  sun: '#facc15', binary_sun: '#fbbf24',
};

export const TIER_LABELS: Record<string, string> = {
  mercury: 'MERCURY', mars: 'MARS', venus: 'VENUS', earth: 'EARTH',
  neptune: 'NEPTUNE', uranus: 'URANUS', saturn: 'SATURN', jupiter: 'JUPITER',
  sun: 'SUN', binary_sun: 'BINARY SUN',
};

export const COMPOSITE_TIER_THRESHOLDS = [
  { min: 0, max: 99, tier: 'mercury', next: 'mars' },
  { min: 100, max: 219, tier: 'mars', next: 'venus' },
  { min: 220, max: 349, tier: 'venus', next: 'earth' },
  { min: 350, max: 479, tier: 'earth', next: 'neptune' },
  { min: 480, max: 599, tier: 'neptune', next: 'uranus' },
  { min: 600, max: 699, tier: 'uranus', next: 'saturn' },
  { min: 700, max: 799, tier: 'saturn', next: 'jupiter' },
  { min: 800, max: 879, tier: 'jupiter', next: 'sun' },
  { min: 880, max: 949, tier: 'sun', next: 'binary_sun' },
  { min: 950, max: Infinity, tier: 'binary_sun', next: null },
] as const;

export function getSybilGradeColor(trustScore: number): string {
  if (trustScore >= 80) return '#22c55e';
  if (trustScore >= 60) return '#3b82f6';
  if (trustScore >= 40) return '#eab308';
  if (trustScore >= 20) return '#f97316';
  return '#ef4444';
}

export const TIER_ICONS: Record<string, string> = {
  mercury: '/textures/tiers/mercury.png',
  mars: '/textures/tiers/mars.png',
  venus: '/textures/tiers/venus.png',
  earth: '/textures/tiers/earth.png',
  neptune: '/textures/tiers/neptune.png',
  uranus: '/textures/tiers/uranus.png',
  saturn: '/textures/tiers/saturn.png',
  jupiter: '/textures/tiers/jupiter.png',
  sun: '/textures/tiers/sun.png',
  binary_sun: '/textures/tiers/binary_sun.png',
};

export function getCompositeTierFromScore(score: number, fallback = 'mercury'): string {
  if (!Number.isFinite(score)) return TIER_LABELS[fallback] ? fallback : 'mercury';
  const safeScore = Math.max(0, Math.round(score));
  const match = COMPOSITE_TIER_THRESHOLDS.find(({ min, max }) => safeScore >= min && safeScore <= max);
  if (match) return match.tier;
  return TIER_LABELS[fallback] ? fallback : 'mercury';
}

export function getTierGrade(tier: string): string {
  switch (tier) {
    case 'binary_sun':
      return 'A+';
    case 'sun':
    case 'jupiter':
      return 'A';
    case 'saturn':
      return 'A-';
    case 'uranus':
      return 'B';
    case 'neptune':
      return 'B-';
    case 'earth':
      return 'C';
    case 'venus':
      return 'C-';
    case 'mars':
      return 'D';
    case 'mercury':
      return 'F';
    default:
      return 'N/A';
  }
}

export function getTierIcon(tier: string): string {
  return TIER_ICONS[tier] || TIER_ICONS.mercury;
}

export function getTierHex(tier: string): string {
  return TIER_HEX[tier] || TIER_HEX.mercury;
}
