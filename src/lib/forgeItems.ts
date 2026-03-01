/**
 * Stellar Forge — item catalog for Identity Prism v5.
 * All purchasable items with PRISM coins.
 */

// ── Types ──

export type ForgeCategory = 'frame' | 'aura' | 'ship_skin' | 'title';

export interface ForgeItem {
  id: string;
  name: string;
  category: ForgeCategory;
  price: number;           // PRISM coins
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  description: string;
  preview: string;         // CSS/shader identifier or image path
  unlockCondition?: string; // optional requirement beyond price
}

export interface OwnedItem {
  itemId: string;
  purchasedAt: string;
  equipped: boolean;
}

export interface ForgeLoadout {
  address: string;
  equippedFrame: string | null;
  equippedAura: string | null;
  equippedShipSkin: string | null;
  equippedTitle: string | null;
  ownedItems: OwnedItem[];
}

// ── Item Catalog ──

export const FORGE_FRAMES: ForgeItem[] = [
  { id: 'frame_nebula', name: 'Nebula Frame', category: 'frame', price: 50, rarity: 'common', description: 'Soft purple nebula border around your card', preview: 'nebula' },
  { id: 'frame_solar_flare', name: 'Solar Flare', category: 'frame', price: 120, rarity: 'rare', description: 'Animated golden flare edges', preview: 'solar_flare' },
  { id: 'frame_void', name: 'Void Edge', category: 'frame', price: 200, rarity: 'epic', description: 'Dark matter distortion border', preview: 'void' },
  { id: 'frame_quantum', name: 'Quantum Lattice', category: 'frame', price: 300, rarity: 'epic', description: 'Glitching holographic wireframe', preview: 'quantum' },
  { id: 'frame_supernova', name: 'Supernova', category: 'frame', price: 500, rarity: 'legendary', description: 'Explosive radiant border with particle trails', preview: 'supernova' },
  { id: 'frame_event_horizon', name: 'Event Horizon', category: 'frame', price: 750, rarity: 'legendary', description: 'Warped spacetime distortion around the card', preview: 'event_horizon', unlockCondition: 'Burn 100+ tokens in Black Hole' },
];

export const FORGE_AURAS: ForgeItem[] = [
  { id: 'aura_frost', name: 'Frost Aura', category: 'aura', price: 80, rarity: 'common', description: 'Ice crystal particles orbit your planet', preview: 'frost' },
  { id: 'aura_ember', name: 'Ember Aura', category: 'aura', price: 80, rarity: 'common', description: 'Warm fire particles around your planet', preview: 'ember' },
  { id: 'aura_electric', name: 'Electric Storm', category: 'aura', price: 150, rarity: 'rare', description: 'Lightning arcs around your planet', preview: 'electric' },
  { id: 'aura_plasma', name: 'Plasma Field', category: 'aura', price: 250, rarity: 'epic', description: 'Swirling plasma energy field', preview: 'plasma' },
  { id: 'aura_dark_matter', name: 'Dark Matter', category: 'aura', price: 400, rarity: 'legendary', description: 'Gravitational lensing distortion effect', preview: 'dark_matter' },
  { id: 'aura_binary_pulse', name: 'Binary Pulse', category: 'aura', price: 600, rarity: 'legendary', description: 'Twin energy beams connecting binary suns', preview: 'binary_pulse', unlockCondition: 'Reach Binary Sun tier' },
];

export const FORGE_SHIP_SKINS: ForgeItem[] = [
  { id: 'ship_stealth', name: 'Stealth Fighter', category: 'ship_skin', price: 60, rarity: 'common', description: 'Dark matte hull with red accents', preview: 'stealth' },
  { id: 'ship_chrome', name: 'Chrome Viper', category: 'ship_skin', price: 100, rarity: 'rare', description: 'Reflective chrome hull', preview: 'chrome' },
  { id: 'ship_neon', name: 'Neon Racer', category: 'ship_skin', price: 150, rarity: 'rare', description: 'Glowing neon outlines', preview: 'neon' },
  { id: 'ship_phantom', name: 'Phantom Wing', category: 'ship_skin', price: 250, rarity: 'epic', description: 'Semi-transparent ghostly ship', preview: 'phantom' },
  { id: 'ship_prism', name: 'Prism Cruiser', category: 'ship_skin', price: 400, rarity: 'legendary', description: 'Rainbow prismatic hull that shifts color', preview: 'prism' },
  { id: 'ship_golden', name: 'Golden Sovereign', category: 'ship_skin', price: 600, rarity: 'legendary', description: 'Ornate golden ship with particle trail', preview: 'golden', unlockCondition: 'Win 10 Cosmic Defender games' },
];

export const FORGE_TITLES: ForgeItem[] = [
  { id: 'title_explorer', name: 'Explorer', category: 'title', price: 30, rarity: 'common', description: 'Title: "Explorer"', preview: 'Explorer' },
  { id: 'title_guardian', name: 'Cosmic Guardian', category: 'title', price: 100, rarity: 'rare', description: 'Title: "Cosmic Guardian"', preview: 'Cosmic Guardian' },
  { id: 'title_destroyer', name: 'Destroyer of Dust', category: 'title', price: 150, rarity: 'rare', description: 'Title: "Destroyer of Dust"', preview: 'Destroyer of Dust', unlockCondition: 'Burn 50 tokens' },
  { id: 'title_architect', name: 'Stellar Architect', category: 'title', price: 200, rarity: 'epic', description: 'Title: "Stellar Architect"', preview: 'Stellar Architect' },
  { id: 'title_sovereign', name: 'Prism Sovereign', category: 'title', price: 350, rarity: 'epic', description: 'Title: "Prism Sovereign"', preview: 'Prism Sovereign', unlockCondition: 'Own 5+ Forge items' },
  { id: 'title_ascended', name: 'The Ascended', category: 'title', price: 1000, rarity: 'legendary', description: 'Title: "The Ascended"', preview: 'The Ascended', unlockCondition: 'Score 1000+ identity points' },
];

export const ALL_FORGE_ITEMS: ForgeItem[] = [
  ...FORGE_FRAMES,
  ...FORGE_AURAS,
  ...FORGE_SHIP_SKINS,
  ...FORGE_TITLES,
];

export function getItemById(id: string): ForgeItem | undefined {
  return ALL_FORGE_ITEMS.find((item) => item.id === id);
}

export function getItemsByCategory(category: ForgeCategory): ForgeItem[] {
  return ALL_FORGE_ITEMS.filter((item) => item.category === category);
}

export const RARITY_COLORS: Record<ForgeItem['rarity'], string> = {
  common: '#9ca3af',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
};

export const CATEGORY_LABELS: Record<ForgeCategory, string> = {
  frame: 'Card Frames',
  aura: 'Planet Auras',
  ship_skin: 'Ship Skins',
  title: 'Titles',
};

export const CATEGORY_ICONS: Record<ForgeCategory, string> = {
  frame: '🖼️',
  aura: '✨',
  ship_skin: '🚀',
  title: '🏷️',
};

// ── Loadout persistence ──

const LOADOUT_KEY = 'prism_forge_loadout_v1';

export function getLocalLoadout(address: string): ForgeLoadout {
  try {
    const data = localStorage.getItem(`${LOADOUT_KEY}_${address}`);
    if (data) return JSON.parse(data);
  } catch {}
  return {
    address,
    equippedFrame: null,
    equippedAura: null,
    equippedShipSkin: null,
    equippedTitle: null,
    ownedItems: [],
  };
}

export function saveLocalLoadout(loadout: ForgeLoadout): void {
  try {
    localStorage.setItem(`${LOADOUT_KEY}_${loadout.address}`, JSON.stringify(loadout));
  } catch {}
}

export function purchaseItem(loadout: ForgeLoadout, itemId: string): ForgeLoadout {
  if (loadout.ownedItems.some((o) => o.itemId === itemId)) return loadout;
  return {
    ...loadout,
    ownedItems: [
      ...loadout.ownedItems,
      { itemId, purchasedAt: new Date().toISOString(), equipped: false },
    ],
  };
}

export function equipItem(loadout: ForgeLoadout, itemId: string): ForgeLoadout {
  const item = getItemById(itemId);
  if (!item) return loadout;
  if (!loadout.ownedItems.some((o) => o.itemId === itemId)) return loadout;

  const updated = { ...loadout };

  // Unequip previous in same category
  switch (item.category) {
    case 'frame':
      updated.equippedFrame = itemId;
      break;
    case 'aura':
      updated.equippedAura = itemId;
      break;
    case 'ship_skin':
      updated.equippedShipSkin = itemId;
      break;
    case 'title':
      updated.equippedTitle = itemId;
      break;
  }

  updated.ownedItems = updated.ownedItems.map((o) => ({
    ...o,
    equipped: o.itemId === itemId
      ? true
      : (getItemById(o.itemId)?.category === item.category ? false : o.equipped),
  }));

  return updated;
}
