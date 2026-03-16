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
import type { WalletPreview } from '@/components/prism/shared';
import { getModuleBonuses, type ForgeLoadout } from '@/lib/forgeItems';

// ── Types ──

export interface ShipStats {
  speed: number;      // 0-100: ship movement, evasion
  shield: number;     // 0-100: HP/defense, shield duration
  firepower: number;  // 0-100: damage, fire rate
  luck: number;       // 0-100: bonus drops, crit chance
}

// ── Skin Bonuses ──

export const SKIN_BONUSES: Record<string, Partial<ShipStats>> = {
  // Set A
  cargo:       { shield: 5, luck: 2 },
  crystal:     { speed: 5, shield: 5, luck: 3 },
  fighter:     { speed: 8, firepower: 5, luck: 2 },
  stealth_v2:  { speed: 6, shield: 3, firepower: 6, luck: 4 },
  fortress:    { shield: 8, firepower: 5, luck: 3 },
  manta:       { speed: 8, shield: 8, firepower: 8, luck: 8 },
  // Set B
  cargo_b:     { shield: 6, luck: 2 },
  crystal_b:   { speed: 5, shield: 6, luck: 3 },
  fighter_b:   { speed: 7, firepower: 6, luck: 2 },
  stealth_v2_b:{ speed: 7, shield: 3, firepower: 5, luck: 4 },
  fortress_b:  { shield: 7, firepower: 6, luck: 3 },
  trident:     { speed: 10, shield: 5, firepower: 10, luck: 5 },
};

// ── Frame Bonuses ──

export const FRAME_BONUSES: Record<string, Partial<ShipStats>> = {
  nebula:        { luck: 3 },
  solar_flare:   { firepower: 4 },
  void:          { shield: 5 },
  quantum:       { speed: 5 },
  supernova:     { firepower: 5 },
  event_horizon: { shield: 5, luck: 3 },
};

// ── Aura Bonuses ──

export const AURA_BONUSES: Record<string, Partial<ShipStats>> = {
  frost:        { shield: 3 },
  ember:        { firepower: 3 },
  electric:     { speed: 4 },
  plasma:       { firepower: 4 },
  dark_matter:  { shield: 4 },
  binary_pulse: { speed: 3, luck: 3 },
};

// ── Tier value for achievements bonus ──

const TIER_VALUES: Record<string, number> = {
  mercury: 1, mars: 2, venus: 3, earth: 4, neptune: 5,
  uranus: 6, saturn: 7, jupiter: 8, sun: 9, binary_sun: 10,
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
  } catch { /* ignore */ }
  return count;
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

function deriveBaseStatsFromPreview(preview: WalletPreview): ShipStats {
  const bd = preview.compositeBreakdown;

  const speed     = 5 + (((bd.engagement || 0) + (bd.social || 0)) / 200) * 65;
  const shield    = 5 + ((bd.sybilTrust || 0) / 250) * 65;
  const firepower = 5 + ((bd.onchain || 0) / 400) * 65;
  const luck      = 5 + ((bd.humanProof || 0) / 150) * 65;

  return {
    speed:     Math.round(Math.min(70, Math.max(5, speed))),
    shield:    Math.round(Math.min(70, Math.max(5, shield))),
    firepower: Math.round(Math.min(70, Math.max(5, firepower))),
    luck:      Math.round(Math.min(70, Math.max(5, luck))),
  };
}

// ══════════════════════════════════════════════════════
//  Legacy: Derive base stats from WalletTraits (v1)
//  Only used when WalletPreview is unavailable
// ══════════════════════════════════════════════════════

function deriveBaseStatsLegacy(traits: WalletTraits): ShipStats {
  const speed = Math.min(70,
    (traits.walletAgeDays || 0) / 5 +
    (traits.txCount || 0) / 100 +
    (traits.isEarlyAdopter ? 10 : 0)
  );

  const stakingBonus = traits.solTier === 'whale' ? 35 : traits.solTier === 'dolphin' ? 20 : 10;
  const shield = Math.min(70,
    (traits.solBalance || 0) * 2 +
    stakingBonus
  );

  const firepower = Math.min(70,
    (traits.nftCount || 0) * 3 +
    (traits.uniqueTokenCount || 0) / 2 +
    (traits.isDeFiKing ? 10 : 0)
  );

  const planetVal = TIER_VALUES[traits.planetTier] || 1;
  const achCount = getAchievementCount();
  const luck = Math.min(70,
    planetVal * 8 +
    achCount * 2 +
    (traits.isWhale ? 10 : 0)
  );

  return {
    speed: Math.round(Math.max(5, speed)),
    shield: Math.round(Math.max(5, shield)),
    firepower: Math.round(Math.max(5, firepower)),
    luck: Math.round(Math.max(5, luck)),
  };
}

// ── Apply equipment bonuses ──

interface ForgeLoadoutLike {
  equippedShipSkin: string | null;
  equippedFrame: string | null;
  equippedAura: string | null;
}

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

  if (loadout.equippedFrame) {
    const key = loadout.equippedFrame.replace('frame_', '');
    const bonus = FRAME_BONUSES[key];
    if (bonus) {
      stats.speed += bonus.speed || 0;
      stats.shield += bonus.shield || 0;
      stats.firepower += bonus.firepower || 0;
      stats.luck += bonus.luck || 0;
    }
  }

  if (loadout.equippedAura) {
    const key = loadout.equippedAura.replace('aura_', '');
    const bonus = AURA_BONUSES[key];
    if (bonus) {
      stats.speed += bonus.speed || 0;
      stats.shield += bonus.shield || 0;
      stats.firepower += bonus.firepower || 0;
      stats.luck += bonus.luck || 0;
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
    speed:     Math.min(100, Math.max(0, stats.speed + modBonuses.speed)),
    shield:    Math.min(100, Math.max(0, stats.shield + modBonuses.shield)),
    firepower: Math.min(100, Math.max(0, stats.firepower + modBonuses.firepower)),
    luck:      Math.min(100, Math.max(0, stats.luck + modBonuses.luck)),
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
  const base = deriveBaseStatsFromPreview(preview);
  const withEquip = applyBonuses(base, loadout);
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

/** Get human-readable label for a stat bonus from equipment */
export function getEquipmentBonusLabel(
  equipId: string | null,
  type: 'skin' | 'frame' | 'aura',
): string | null {
  if (!equipId) return null;
  const prefix = type === 'skin' ? 'ship_' : type === 'frame' ? 'frame_' : 'aura_';
  const key = equipId.replace(prefix, '');
  const table = type === 'skin' ? SKIN_BONUSES : type === 'frame' ? FRAME_BONUSES : AURA_BONUSES;
  const bonus = table[key];
  if (!bonus) return null;
  const parts: string[] = [];
  if (bonus.speed) parts.push(`+${bonus.speed} spd`);
  if (bonus.shield) parts.push(`+${bonus.shield} shd`);
  if (bonus.firepower) parts.push(`+${bonus.firepower} fp`);
  if (bonus.luck) parts.push(`+${bonus.luck} lck`);
  return parts.join(', ');
}
