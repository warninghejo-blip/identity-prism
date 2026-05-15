import { describe, it, expect, beforeEach } from 'vitest';
import {
  ALL_FORGE_ITEMS,
  FORGE_FRAMES,
  FORGE_AURAS,
  FORGE_SHIP_SKINS,
  FORGE_TITLES,
  MICROMODULE_DEFS,
  meetsRequiredRank,
  getItemById,
  getItemsByCategory,
  purchaseItem,
  equipItem,
  unequipItem,
  getModuleBonuses,
  purchaseModule,
  installModule,
  type ForgeLoadout,
} from '../forgeItems';

// ── Helpers ──

function makeLoadout(overrides: Partial<ForgeLoadout> = {}): ForgeLoadout {
  return {
    address: 'TestAddr',
    equippedFrame: null,
    equippedAura: null,
    equippedShipSkin: null,
    equippedTitle: null,
    ownedItems: [],
    installedModules: {},
    ownedModules: [],
    ...overrides,
  };
}

// ── Catalog integrity ──

describe('Forge catalog integrity', () => {
  it('ALL_FORGE_ITEMS contains all sub-catalogs', () => {
    expect(ALL_FORGE_ITEMS.length).toBe(
      FORGE_FRAMES.length + FORGE_AURAS.length + FORGE_SHIP_SKINS.length + FORGE_TITLES.length,
    );
  });

  it('every item has a unique id', () => {
    const ids = ALL_FORGE_ITEMS.map((i) => i.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every item has a positive price', () => {
    for (const item of ALL_FORGE_ITEMS) {
      expect(item.price).toBeGreaterThan(0);
    }
  });

  it('frame_nebula exists with expected price and rarity', () => {
    const item = getItemById('frame_nebula');
    expect(item).toBeDefined();
    expect(item?.price).toBe(800);
    expect(item?.rarity).toBe('common');
    expect(item?.category).toBe('frame');
  });

  it('frame_singularity requires legend rank', () => {
    const item = getItemById('frame_singularity');
    expect(item?.requiredRank).toBe('legend');
    expect(item?.rarity).toBe('legendary');
  });

  it('aura_frost exists with correct price', () => {
    const item = getItemById('aura_frost');
    expect(item?.price).toBe(3000);
    expect(item?.rarity).toBe('common');
    expect(item?.category).toBe('aura');
  });

  it('ship_cargo exists and has maxModuleSlots=1', () => {
    const item = getItemById('ship_cargo');
    expect(item).toBeDefined();
    expect(item?.maxModuleSlots).toBe(1);
    expect(item?.category).toBe('ship_skin');
  });

  it('getItemsByCategory returns only items of that category', () => {
    const frames = getItemsByCategory('frame');
    expect(frames.every((i) => i.category === 'frame')).toBe(true);
    expect(frames.length).toBe(FORGE_FRAMES.length);
  });

  it('MICROMODULE_DEFS has both blue and yellow and red tiers', () => {
    const tiers = new Set(MICROMODULE_DEFS.map((m) => m.tier));
    expect(tiers.has('blue')).toBe(true);
    expect(tiers.has('yellow')).toBe(true);
    expect(tiers.has('red')).toBe(true);
  });
});

// ── meetsRequiredRank ──

describe('meetsRequiredRank', () => {
  it('returns true when no rank required', () => {
    expect(meetsRequiredRank('cadet', undefined)).toBe(true);
    expect(meetsRequiredRank(undefined, undefined)).toBe(true);
  });

  it('returns false when user has no rank but item requires one', () => {
    expect(meetsRequiredRank(undefined, 'pilot')).toBe(false);
  });

  it('returns false when user rank is below required', () => {
    expect(meetsRequiredRank('cadet', 'pilot')).toBe(false);
    expect(meetsRequiredRank('pilot', 'captain')).toBe(false);
  });

  it('returns true when user rank meets requirement exactly', () => {
    expect(meetsRequiredRank('pilot', 'pilot')).toBe(true);
    expect(meetsRequiredRank('legend', 'legend')).toBe(true);
  });

  it('returns true when user rank exceeds requirement', () => {
    expect(meetsRequiredRank('ace', 'pilot')).toBe(true);
    expect(meetsRequiredRank('legend', 'cadet')).toBe(true);
  });
});

// ── purchaseItem ──

describe('purchaseItem', () => {
  it('returns null when item does not exist', () => {
    const loadout = makeLoadout();
    expect(purchaseItem(loadout, 'nonexistent_item', 99999)).toBeNull();
  });

  it('returns null when balance is insufficient', () => {
    const loadout = makeLoadout();
    // frame_nebula costs 800
    expect(purchaseItem(loadout, 'frame_nebula', 500)).toBeNull();
  });

  it('adds item when balance is sufficient', () => {
    const loadout = makeLoadout();
    const result = purchaseItem(loadout, 'frame_nebula', 800);
    expect(result).not.toBeNull();
    expect(result!.ownedItems).toHaveLength(1);
    expect(result!.ownedItems[0].itemId).toBe('frame_nebula');
  });

  it('returns same loadout if already owned (no duplicate)', () => {
    const loadout = makeLoadout({
      ownedItems: [{ itemId: 'frame_nebula', purchasedAt: new Date().toISOString(), equipped: false }],
    });
    const result = purchaseItem(loadout, 'frame_nebula', 99999);
    // returns the same loadout (not null, no duplicate)
    expect(result!.ownedItems).toHaveLength(1);
  });
});

// ── equipItem / unequipItem ──

describe('equipItem', () => {
  it('returns unchanged loadout for unowned item', () => {
    const loadout = makeLoadout();
    const result = equipItem(loadout, 'frame_nebula');
    expect(result.equippedFrame).toBeNull();
  });

  it('equips a frame correctly', () => {
    const loadout = makeLoadout({
      ownedItems: [{ itemId: 'frame_nebula', purchasedAt: new Date().toISOString(), equipped: false }],
    });
    const result = equipItem(loadout, 'frame_nebula');
    expect(result.equippedFrame).toBe('frame_nebula');
  });

  it('equips ship_skin correctly', () => {
    const loadout = makeLoadout({
      ownedItems: [{ itemId: 'ship_cargo', purchasedAt: new Date().toISOString(), equipped: false }],
    });
    const result = equipItem(loadout, 'ship_cargo');
    expect(result.equippedShipSkin).toBe('ship_cargo');
  });

  it('switches equipped frame when a new one is equipped', () => {
    const loadout = makeLoadout({
      equippedFrame: 'frame_nebula',
      ownedItems: [
        { itemId: 'frame_nebula', purchasedAt: new Date().toISOString(), equipped: true },
        { itemId: 'frame_iron_veil', purchasedAt: new Date().toISOString(), equipped: false },
      ],
    });
    const result = equipItem(loadout, 'frame_iron_veil');
    expect(result.equippedFrame).toBe('frame_iron_veil');
  });
});

describe('unequipItem', () => {
  it('removes equipped frame and sets equippedFrame to null', () => {
    const loadout = makeLoadout({
      equippedFrame: 'frame_nebula',
      ownedItems: [{ itemId: 'frame_nebula', purchasedAt: new Date().toISOString(), equipped: true }],
    });
    const result = unequipItem(loadout, 'frame');
    expect(result.equippedFrame).toBeNull();
    expect(result.ownedItems[0].equipped).toBe(false);
  });

  it('removes equipped aura', () => {
    const loadout = makeLoadout({
      equippedAura: 'aura_frost',
      ownedItems: [{ itemId: 'aura_frost', purchasedAt: new Date().toISOString(), equipped: true }],
    });
    const result = unequipItem(loadout, 'aura');
    expect(result.equippedAura).toBeNull();
  });
});

// ── getModuleBonuses ──

describe('getModuleBonuses', () => {
  it('returns zeros when no modules installed', () => {
    const loadout = makeLoadout({
      equippedShipSkin: 'ship_cargo',
      ownedItems: [{ itemId: 'ship_cargo', purchasedAt: new Date().toISOString(), equipped: true }],
    });
    const bonuses = getModuleBonuses(loadout);
    expect(bonuses).toEqual({ speed: 0, shield: 0, firepower: 0, luck: 0 });
  });

  it('sums bonuses from installed modules', () => {
    // Find a blue speed module
    const speedMod = MICROMODULE_DEFS.find((m) => m.statBonus.stat === 'speed' && m.tier === 'blue');
    expect(speedMod).toBeDefined();

    const loadout = makeLoadout({
      equippedShipSkin: 'ship_cargo',
      ownedItems: [{ itemId: 'ship_cargo', purchasedAt: new Date().toISOString(), equipped: true }],
      ownedModules: [speedMod!.id],
      installedModules: { ship_cargo: [speedMod!.id] },
    });

    const bonuses = getModuleBonuses(loadout);
    expect(bonuses.speed).toBe(speedMod!.statBonus.value);
  });

  it('applies tradeoff penalty correctly', () => {
    const modWithTradeoff = MICROMODULE_DEFS.find((m) => m.tradeoff !== undefined);
    if (!modWithTradeoff) return; // skip if none found

    const loadout = makeLoadout({
      equippedShipSkin: 'ship_cargo',
      ownedItems: [{ itemId: 'ship_cargo', purchasedAt: new Date().toISOString(), equipped: true }],
      ownedModules: [modWithTradeoff.id],
      installedModules: { ship_cargo: [modWithTradeoff.id] },
    });

    const bonuses = getModuleBonuses(loadout);
    expect(bonuses[modWithTradeoff.tradeoff!.stat]).toBeLessThan(0);
  });
});
