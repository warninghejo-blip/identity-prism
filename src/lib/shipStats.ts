/**
 * Ship Stats System — derives 4 gameplay stats (0-100) from wallet traits + forge loadout.
 * Stats affect speed, shield, firepower, and luck across all Prism League games.
 */

import type { WalletTraits } from '@/hooks/useWalletData';

// ── Types ──

export interface ShipStats {
  speed: number;      // 0-100: ship movement, evasion
  shield: number;     // 0-100: HP/defense, shield duration
  firepower: number;  // 0-100: damage, fire rate
  luck: number;       // 0-100: bonus drops, crit chance
}

// ── Skin Bonuses ──

export const SKIN_BONUSES: Record<string, Partial<ShipStats>> = {
  stealth:  { speed: 8, shield: 3, firepower: 5 },
  chrome:   { speed: 5, shield: 8, firepower: 3 },
  neon:     { speed: 10, firepower: 3, luck: 3 },
  phantom:  { speed: 3, shield: 5, firepower: 3, luck: 8 },
  prism:    { speed: 5, shield: 5, firepower: 5, luck: 5 },
  golden:   { speed: 8, shield: 8, firepower: 8, luck: 8 },
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

// ── Staking tier → shield bonus ──

const STAKING_SHIELD: Record<string, number> = {
  bronze: 10,
  silver: 20,
  gold: 35,
};

// ── Planet tier → luck multiplier ──

const PLANET_TIER_VALUES: Record<string, number> = {
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

// ── Derive base stats from wallet traits (0-70 each) ──

function deriveBaseStats(traits: WalletTraits | null): ShipStats {
  if (!traits) return { speed: 10, shield: 10, firepower: 10, luck: 10 };

  const speed = Math.min(70,
    (traits.walletAgeDays || 0) / 5 +
    (traits.txCount || 0) / 100 +
    (traits.isEarlyAdopter ? 10 : 0)
  );

  // stakingTier comes from external state; use solTier as proxy for now
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

  const planetVal = PLANET_TIER_VALUES[traits.planetTier] || 1;
  // Count achievements from localStorage (approximate)
  let achCount = 0;
  try {
    const keys = ['orbit_survival_achievements_v1', 'defender_achievements_v1', 'gravity_rush_achievements_v1'];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) achCount += arr.filter((a: { unlocked?: boolean }) => a.unlocked).length;
      }
    }
  } catch { /* ignore */ }

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

  // Ship skin bonus (strip "ship_" prefix to match bonus keys)
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

  // Frame bonus (strip "frame_" prefix)
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

  // Aura bonus (strip "aura_" prefix)
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

  // Clamp all stats to 0-100
  stats.speed = Math.min(100, Math.max(0, stats.speed));
  stats.shield = Math.min(100, Math.max(0, stats.shield));
  stats.firepower = Math.min(100, Math.max(0, stats.firepower));
  stats.luck = Math.min(100, Math.max(0, stats.luck));

  return stats;
}

// ── Main export ──

export function deriveShipStats(traits: WalletTraits | null, loadout: ForgeLoadoutLike | null): ShipStats {
  const base = deriveBaseStats(traits);
  return applyBonuses(base, loadout);
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
