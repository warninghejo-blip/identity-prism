/**
 * Ship Stats System — derives 4 gameplay stats (0-100) from composite breakdown + forge loadout.
 * Stats affect speed, shield, firepower, and luck across all Prism League games.
 *
 * V2: Each stat maps to composite categories:
 *   Speed     ← engagement (0-100) + social (0-100)    → max 200 → 0-70
 *   Shield    ← sybilTrust (0-250)                     → max 250 → 0-70
 *   Firepower ← onchain (0-400)                        → max 400 → 0-70
 *   Luck      ← humanProof (0-150)                     → max 150 → 0-70
 *
 * Legacy system: based on WalletTraits (kept for backwards compat).
 */

import type { WalletTraits } from '@/hooks/useWalletData';
import type { WalletPreview, CompositeBreakdown } from '@/components/prism/shared';
import { getModuleBonuses, type ForgeLoadout } from '@/lib/forgeItems';

// ── Types ──

export interface ShipStats {
  speed: number; // 0-100: ship movement, evasion
  shield: number; // 0-100: HP/defense, shield duration
  firepower: number; // 0-100: damage, fire rate
  luck: number; // 0-100: bonus drops, crit chance
}

// ── Skin Bonuses ──

// Flat bonus to ALL stats based on rarity: common +3, rare +4, epic +6, legendary +8
const SKIN_RARITY_BONUS: Record<string, number> = { common: 3, rare: 4, epic: 6, legendary: 8 };
export { SKIN_RARITY_BONUS };

export const SKIN_BONUSES: Record<string, Partial<ShipStats>> = {
  // Common (+3 all, total 12)
  cargo: { speed: 3, shield: 3, firepower: 3, luck: 3 },
  cargo_b: { speed: 3, shield: 3, firepower: 3, luck: 3 },
  // Rare (+4 all, total 16)
  crystal: { speed: 4, shield: 4, firepower: 4, luck: 4 },
  crystal_b: { speed: 4, shield: 4, firepower: 4, luck: 4 },
  fighter: { speed: 4, shield: 4, firepower: 4, luck: 4 },
  fighter_b: { speed: 4, shield: 4, firepower: 4, luck: 4 },
  fortress: { speed: 4, shield: 4, firepower: 4, luck: 4 },
  chrome: { speed: 4, shield: 4, firepower: 4, luck: 4 },
  neon: { speed: 4, shield: 4, firepower: 4, luck: 4 },
  // Epic (+6 all, total 24)
  stealth_v2: { speed: 6, shield: 6, firepower: 6, luck: 6 },
  stealth_v2_b: { speed: 6, shield: 6, firepower: 6, luck: 6 },
  stealth: { speed: 6, shield: 6, firepower: 6, luck: 6 },
  fortress_b: { speed: 6, shield: 6, firepower: 6, luck: 6 },
  phantom: { speed: 6, shield: 6, firepower: 6, luck: 6 },
  // Legendary (+8 all, total 32)
  manta: { speed: 8, shield: 8, firepower: 8, luck: 8 },
  trident: { speed: 8, shield: 8, firepower: 8, luck: 8 },
  prism: { speed: 8, shield: 8, firepower: 8, luck: 8 },
  golden: { speed: 8, shield: 8, firepower: 8, luck: 8 },
};

// ── Frame Bonuses (composite breakdown points, not flat stats) ──

export const FRAME_BONUSES: Record<string, Partial<CompositeBreakdown>> = {
  // Common (composite ~12 pts → ~4 stat)
  nebula: { humanProof: 7, sybilTrust: 4 },
  iron_veil: { engagement: 8, social: 4 },
  // Rare (composite ~24-35 pts → ~7 stat)
  solar_flare: { onchain: 30, humanProof: 5 },
  ionic_storm: { engagement: 18, onchain: 6 },
  basalt: { sybilTrust: 18, humanProof: 5 },
  // Epic (composite ~34-44 pts → ~10 stat)
  void: { sybilTrust: 27, humanProof: 7 },
  quantum: { engagement: 22, onchain: 18 },
  pulsar: { sybilTrust: 20, onchain: 18, engagement: 6 },
  // Legendary (composite ~52-67 pts → ~14 stat)
  supernova: { onchain: 50, engagement: 10, humanProof: 7 },
  event_horizon: { sybilTrust: 30, humanProof: 10, onchain: 12 },
  singularity: { engagement: 18, onchain: 25, sybilTrust: 15 },
};

const COMPOSITE_MAXIMA: CompositeBreakdown = {
  onchain: 400,
  sybilTrust: 250,
  humanProof: 150,
  social: 100,
  engagement: 100,
};

function clampCompositeValue(value: number | undefined, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value)));
}

export function normalizeCompositeBreakdown(bd: CompositeBreakdown): CompositeBreakdown {
  return {
    onchain: clampCompositeValue(bd.onchain, COMPOSITE_MAXIMA.onchain),
    sybilTrust: clampCompositeValue(bd.sybilTrust, COMPOSITE_MAXIMA.sybilTrust),
    humanProof: clampCompositeValue(bd.humanProof, COMPOSITE_MAXIMA.humanProof),
    social: clampCompositeValue(bd.social, COMPOSITE_MAXIMA.social),
    engagement: clampCompositeValue(bd.engagement, COMPOSITE_MAXIMA.engagement),
  };
}

// ── Aura Bonuses ──

// ── Title Bonuses (flat, luck-focused) ──

export const TITLE_BONUSES: Record<string, Partial<ShipStats>> = {
  // Common (budget 2)
  explorer: { luck: 2 },
  // Rare (budget 4)
  guardian: { luck: 3, shield: 1 },
  destroyer: { luck: 3, firepower: 1 },
  // Epic (budget 6)
  architect: { luck: 4, speed: 2 },
  sovereign: { luck: 4, shield: 2 },
  // Legendary (budget 10)
  ascended: { luck: 8, speed: 2 },
  // ── New titles ──
  // Common (budget 2)
  starborn: { firepower: 2 },
  // Rare (budget 4)
  voidrunner: { luck: 3, speed: 1 },
  // Epic (budget 6)
  dreadnought: { shield: 4, firepower: 2 },
  phantom_hand: { speed: 3, luck: 3 },
  // Legendary (budget 10)
  harbinger: { firepower: 5, speed: 3, shield: 2 },
};

/** Aura bonuses are percentage multipliers (0.10 = +10%), applied multiplicatively AFTER flat bonuses */
export const AURA_BONUSES: Record<string, Partial<ShipStats>> = {
  frost: { shield: 0.1 },
  ember: { firepower: 0.1 },
  electric: { speed: 0.15 },
  plasma: { firepower: 0.15, speed: 0.08 },
  dark_matter: { shield: 0.2, firepower: 0.08 },
  binary_pulse: { speed: 0.15, luck: 0.15 },
  // ── New auras ──
  solar_wind: { speed: 0.1 },
  fortune_mist: { luck: 0.12 },
  crimson_tide: { firepower: 0.15 },
  void_shell: { shield: 0.15 },
  stellar_tide: { shield: 0.12, luck: 0.1 },
};

// ── Tier value for achievements bonus ──

const TIER_VALUES: Record<string, number> = {
  mercury: 1,
  mars: 2,
  venus: 3,
  earth: 4,
  neptune: 5,
  uranus: 6,
  saturn: 7,
  jupiter: 8,
  sun: 9,
  binary_sun: 10,
};

// ── Achievement count from localStorage ──

function getAchievementCount(): number {
  let count = 0;
  try {
    const keys = ['orbit_survival_achievements_v1', 'cosmic_defender_achievements_v1', 'gravity_rush_achievements_v1'];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) count += arr.filter((a: { unlocked?: boolean }) => a.unlocked).length;
      }
    }
  } catch {
    /* ignore */
  }
  return count;
}

// ── Types ──

interface ForgeLoadoutLike {
  equippedShipSkin: string | null;
  equippedFrame: string | null;
  equippedAura: string | null;
  equippedTitle?: string | null;
}

// ══════════════════════════════════════════════════════
//  V2: Derive base stats from composite breakdown categories
//  Each stat maps directly to its composite categories:
//    Speed     ← engagement(100) + social(100)  → /200 * 65 + 5
//    Shield    ← sybilTrust(250)                → /250 * 65 + 5
//    Firepower ← onchain(400)                   → /400 * 65 + 5
//    Luck      ← humanProof(150)                → /150 * 65 + 5
//  Result: 5-70 per stat before equipment
// ══════════════════════════════════════════════════════

/** Apply frame bonus to composite breakdown (before stat derivation). */
export function applyFrameToBreakdown(bd: CompositeBreakdown, loadout: ForgeLoadoutLike | null): CompositeBreakdown {
  const normalized = normalizeCompositeBreakdown(bd);
  if (!loadout?.equippedFrame) return normalized;
  const key = loadout.equippedFrame.replace('frame_', '');
  const bonus = FRAME_BONUSES[key];
  if (!bonus) return normalized;
  return normalizeCompositeBreakdown({
    onchain: normalized.onchain + (bonus.onchain || 0),
    sybilTrust: normalized.sybilTrust + (bonus.sybilTrust || 0),
    humanProof: normalized.humanProof + (bonus.humanProof || 0),
    social: normalized.social + (bonus.social || 0),
    engagement: normalized.engagement + (bonus.engagement || 0),
  });
}

function deriveBaseStatsFromBreakdown(bd: CompositeBreakdown): ShipStats {
  const speed = 5 + (((bd.engagement || 0) + (bd.social || 0)) / 200) * 65;
  const shield = 5 + ((bd.sybilTrust || 0) / 250) * 65;
  const firepower = 5 + ((bd.onchain || 0) / 400) * 65;
  const luck = 5 + ((bd.humanProof || 0) / 150) * 65;

  return {
    speed: Math.round(Math.min(70, Math.max(5, speed))),
    shield: Math.round(Math.min(70, Math.max(5, shield))),
    firepower: Math.round(Math.min(70, Math.max(5, firepower))),
    luck: Math.round(Math.min(70, Math.max(5, luck))),
  };
}

// ══════════════════════════════════════════════════════
//  Legacy: Derive base stats from WalletTraits (v1)
//  Only used when WalletPreview is unavailable
// ══════════════════════════════════════════════════════

function deriveBaseStatsLegacy(traits: WalletTraits): ShipStats {
  const speed = Math.min(
    70,
    (traits.walletAgeDays || 0) / 5 + (traits.txCount || 0) / 100 + (traits.isEarlyAdopter ? 10 : 0),
  );

  const stakingBonus = traits.solTier === 'whale' ? 35 : traits.solTier === 'dolphin' ? 20 : 10;
  const shield = Math.min(70, (traits.solBalance || 0) * 2 + stakingBonus);

  const firepower = Math.min(
    70,
    (traits.nftCount || 0) * 3 + (traits.uniqueTokenCount || 0) / 2 + (traits.isDeFiKing ? 10 : 0),
  );

  const planetVal = TIER_VALUES[traits.planetTier] || 1;
  const achCount = getAchievementCount();
  const luck = Math.min(70, planetVal * 8 + achCount * 2 + (traits.isWhale ? 10 : 0));

  return {
    speed: Math.round(Math.max(5, speed)),
    shield: Math.round(Math.max(5, shield)),
    firepower: Math.round(Math.max(5, firepower)),
    luck: Math.round(Math.max(5, luck)),
  };
}

// ── Apply equipment bonuses ──

function applyBonuses(base: ShipStats, loadout: ForgeLoadoutLike | null): ShipStats {
  if (!loadout) return base;

  const stats = { ...base };

  if (loadout.equippedShipSkin) {
    const key = loadout.equippedShipSkin.replace('ship_', '');
    const bonus = SKIN_BONUSES[key];
    if (bonus) {
      stats.speed += bonus.speed || 0;
      stats.shield += bonus.shield || 0;
      stats.firepower += bonus.firepower || 0;
      stats.luck += bonus.luck || 0;
    }
  }

  // Frame bonuses are now applied to composite breakdown (before stat derivation)

  if (loadout.equippedTitle) {
    const key = loadout.equippedTitle.replace('title_', '');
    const bonus = TITLE_BONUSES[key];
    if (bonus) {
      stats.speed += bonus.speed || 0;
      stats.shield += bonus.shield || 0;
      stats.firepower += bonus.firepower || 0;
      stats.luck += bonus.luck || 0;
    }
  }

  // Aura: multiplicative AFTER flat bonuses
  if (loadout.equippedAura) {
    const key = loadout.equippedAura.replace('aura_', '');
    const bonus = AURA_BONUSES[key];
    if (bonus) {
      stats.speed = Math.round(stats.speed * (1 + (bonus.speed || 0)));
      stats.shield = Math.round(stats.shield * (1 + (bonus.shield || 0)));
      stats.firepower = Math.round(stats.firepower * (1 + (bonus.firepower || 0)));
      stats.luck = Math.round(stats.luck * (1 + (bonus.luck || 0)));
    }
  }

  stats.speed = Math.min(100, Math.max(0, stats.speed));
  stats.shield = Math.min(100, Math.max(0, stats.shield));
  stats.firepower = Math.min(100, Math.max(0, stats.firepower));
  stats.luck = Math.min(100, Math.max(0, stats.luck));

  return stats;
}

// ── Apply module bonuses ──

function applyModules(stats: ShipStats, loadout: ForgeLoadoutLike | null): ShipStats {
  if (!loadout || !('installedModules' in loadout)) return stats;
  const modBonuses = getModuleBonuses(loadout as ForgeLoadout);
  return {
    speed: Math.min(100, Math.max(0, stats.speed + modBonuses.speed)),
    shield: Math.min(100, Math.max(0, stats.shield + modBonuses.shield)),
    firepower: Math.min(100, Math.max(0, stats.firepower + modBonuses.firepower)),
    luck: Math.min(100, Math.max(0, stats.luck + modBonuses.luck)),
  };
}

// ══════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════

/**
 * V2: Compute ship stats from WalletPreview (compositeScore-based).
 * Use this in Hangar, games, and anywhere WalletPreview is available.
 */
export function computeShipStats(preview: WalletPreview | null, loadout: ForgeLoadoutLike | null): ShipStats {
  if (!preview || preview.compositeScore == null || !preview.compositeBreakdown) return DEFAULT_SHIP_STATS;
  const boostedBd = applyFrameToBreakdown(preview.compositeBreakdown, loadout);
  const base = deriveBaseStatsFromBreakdown(boostedBd);
  const withEquip = applyBonuses(base, loadout); // skin + title + aura (no frame)
  return applyModules(withEquip, loadout);
}

/**
 * Legacy: Compute ship stats from WalletTraits.
 * Still works, but prefer computeShipStats(preview, loadout) when possible.
 */
export function deriveShipStats(traits: WalletTraits | null, loadout: ForgeLoadoutLike | null): ShipStats {
  if (!traits) return DEFAULT_SHIP_STATS;
  const base = deriveBaseStatsLegacy(traits);
  const withEquip = applyBonuses(base, loadout);
  return applyModules(withEquip, loadout);
}

/** Default stats for unauthenticated players */
export const DEFAULT_SHIP_STATS: ShipStats = { speed: 15, shield: 15, firepower: 15, luck: 15 };

/** Get boosted composite score + breakdown with frame bonus applied. */
export function getBoostedCompositeScore(
  breakdown: CompositeBreakdown | null,
  loadout: ForgeLoadoutLike | null,
): { score: number; breakdown: CompositeBreakdown } | null {
  if (!breakdown) return null;
  const boosted = applyFrameToBreakdown(breakdown, loadout);
  const score =
    (boosted.onchain || 0) +
    (boosted.sybilTrust || 0) +
    (boosted.humanProof || 0) +
    (boosted.social || 0) +
    (boosted.engagement || 0);
  return { score, breakdown: boosted };
}

/** Short category labels for frame composite bonuses */
const COMPOSITE_SHORT_LABELS: Record<string, string> = {
  onchain: 'Chain',
  sybilTrust: 'Trust',
  humanProof: 'Proof',
  social: 'Social',
  engagement: 'Engage',
};

/** Get human-readable label for a stat bonus from equipment */
export function getEquipmentBonusLabel(
  equipId: string | null,
  type: 'skin' | 'frame' | 'aura' | 'title',
): string | null {
  if (!equipId) return null;
  const prefix = type === 'skin' ? 'ship_' : type === 'frame' ? 'frame_' : type === 'title' ? 'title_' : 'aura_';
  const key = equipId.replace(prefix, '');

  // Frame bonuses are composite breakdown points, not flat stats
  if (type === 'frame') {
    const bonus = FRAME_BONUSES[key];
    if (!bonus) return null;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(bonus)) {
      if (v) parts.push(`+${v} ${COMPOSITE_SHORT_LABELS[k] || k}`);
    }
    return parts.join(', ');
  }

  const table = type === 'skin' ? SKIN_BONUSES : type === 'title' ? TITLE_BONUSES : AURA_BONUSES;
  const bonus = table[key];
  if (!bonus) return null;
  const parts: string[] = [];
  if (type === 'aura') {
    if (bonus.speed) parts.push(`+${Math.round(bonus.speed * 100)}% spd`);
    if (bonus.shield) parts.push(`+${Math.round(bonus.shield * 100)}% shd`);
    if (bonus.firepower) parts.push(`+${Math.round(bonus.firepower * 100)}% fp`);
    if (bonus.luck) parts.push(`+${Math.round(bonus.luck * 100)}% lck`);
  } else {
    if (bonus.speed) parts.push(`+${bonus.speed} spd`);
    if (bonus.shield) parts.push(`+${bonus.shield} shd`);
    if (bonus.firepower) parts.push(`+${bonus.firepower} fp`);
    if (bonus.luck) parts.push(`+${bonus.luck} lck`);
  }
  return parts.join(', ');
}

const STAT_LABELS: Record<string, string> = { speed: 'Speed', shield: 'Shield', firepower: 'Firepower', luck: 'Luck' };

/** Get bonus lines as array for shop display: [{ label, value, pct? }] */
export function getEquipmentBonusLines(
  equipId: string,
  type: 'skin' | 'frame' | 'aura' | 'title',
): { label: string; value: string }[] {
  const prefix = type === 'skin' ? 'ship_' : type === 'frame' ? 'frame_' : type === 'title' ? 'title_' : 'aura_';
  const key = equipId.replace(prefix, '');

  if (type === 'frame') {
    const bonus = FRAME_BONUSES[key];
    if (!bonus) return [];
    return Object.entries(bonus)
      .filter(([, v]) => v)
      .map(([k, v]) => ({ label: COMPOSITE_SHORT_LABELS[k] || k, value: `+${v}` }));
  }

  const table = type === 'skin' ? SKIN_BONUSES : type === 'title' ? TITLE_BONUSES : AURA_BONUSES;
  const bonus = table[key];
  if (!bonus) return [];

  if (type === 'aura') {
    return Object.entries(bonus)
      .filter(([, v]) => v)
      .map(([k, v]) => ({ label: STAT_LABELS[k] || k, value: `+${Math.round((v as number) * 100)}%` }));
  }
  return Object.entries(bonus)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: STAT_LABELS[k] || k, value: `+${v}` }));
}
