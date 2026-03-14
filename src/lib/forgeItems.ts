/**
 * Stellar Forge — item catalog for Identity Prism v5.
 * All purchasable items with Coins.
 */

// ── Types ──

export type ForgeCategory = 'frame' | 'aura' | 'ship_skin' | 'title';

// ── Micromodule Types ──

export interface Micromodule {
  id: string;
  name: string;
  description: string;
  tier: 'blue' | 'yellow' | 'red';
  price: number;
  statBonus: { stat: 'speed' | 'shield' | 'firepower' | 'luck'; value: number };
  tradeoff?: { stat: 'speed' | 'shield' | 'firepower' | 'luck'; value: number };
  icon: string;
  compatibleCategories: ForgeCategory[];
}

export interface ForgeItem {
  id: string;
  name: string;
  category: ForgeCategory;
  price: number;           // Coins
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  description: string;
  preview: string;         // CSS/shader identifier or image path
  unlockCondition?: string; // optional requirement beyond price
  maxModuleSlots?: number; // how many modules can be installed (ship_skin only)
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
  installedModules: Record<string, string[]>; // itemId → moduleId[] (max 3)
}

// ── Item Catalog ──

export const FORGE_FRAMES: ForgeItem[] = [
  { id: 'frame_nebula', name: 'Nebula Frame', category: 'frame', price: 400, rarity: 'common', description: 'Soft purple nebula border around your card', preview: 'nebula' },
  { id: 'frame_solar_flare', name: 'Solar Flare', category: 'frame', price: 1200, rarity: 'rare', description: 'Animated golden flare edges', preview: 'solar_flare' },
  { id: 'frame_void', name: 'Void Edge', category: 'frame', price: 2400, rarity: 'epic', description: 'Dark matter distortion border', preview: 'void' },
  { id: 'frame_quantum', name: 'Quantum Lattice', category: 'frame', price: 3200, rarity: 'epic', description: 'Glitching holographic wireframe', preview: 'quantum' },
  { id: 'frame_supernova', name: 'Supernova', category: 'frame', price: 6000, rarity: 'legendary', description: 'Explosive radiant border with particle trails', preview: 'supernova' },
  { id: 'frame_event_horizon', name: 'Event Horizon', category: 'frame', price: 10000, rarity: 'legendary', description: 'Warped spacetime distortion around the card', preview: 'event_horizon', unlockCondition: 'Burn 100+ tokens in Black Hole' },
];

export const FORGE_AURAS: ForgeItem[] = [
  { id: 'aura_frost', name: 'Frost Aura', category: 'aura', price: 600, rarity: 'common', description: 'Ice crystal particles orbit your planet', preview: 'frost' },
  { id: 'aura_ember', name: 'Ember Aura', category: 'aura', price: 600, rarity: 'common', description: 'Warm fire particles around your planet', preview: 'ember' },
  { id: 'aura_electric', name: 'Electric Storm', category: 'aura', price: 1600, rarity: 'rare', description: 'Lightning arcs around your planet', preview: 'electric' },
  { id: 'aura_plasma', name: 'Plasma Field', category: 'aura', price: 2800, rarity: 'epic', description: 'Swirling plasma energy field', preview: 'plasma' },
  { id: 'aura_dark_matter', name: 'Dark Matter', category: 'aura', price: 4800, rarity: 'legendary', description: 'Gravitational lensing distortion effect', preview: 'dark_matter' },
  { id: 'aura_binary_pulse', name: 'Binary Pulse', category: 'aura', price: 8000, rarity: 'legendary', description: 'Twin energy beams connecting binary suns', preview: 'binary_pulse', unlockCondition: 'Reach Binary Sun tier' },
];

export const FORGE_SHIP_SKINS: ForgeItem[] = [
  // ── Set A ──
  { id: 'ship_cargo', name: 'Cargo Hauler', category: 'ship_skin', price: 700, rarity: 'common', description: 'Heavy industrial mining vessel', preview: 'cargo', maxModuleSlots: 1 },
  { id: 'ship_crystal', name: 'Crystal Sentinel', category: 'ship_skin', price: 1000, rarity: 'rare', description: 'Amethyst crystal hull with Solana core', preview: 'crystal', maxModuleSlots: 2 },
  { id: 'ship_fighter', name: 'Starfighter Mk.II', category: 'ship_skin', price: 1400, rarity: 'rare', description: 'Sleek teal interceptor with energy wings', preview: 'fighter', maxModuleSlots: 2 },
  { id: 'ship_stealth_v2', name: 'Shadow Wraith', category: 'ship_skin', price: 2400, rarity: 'epic', description: 'Ultra-dark stealth bomber with purple circuits', preview: 'stealth_v2', maxModuleSlots: 2 },
  { id: 'ship_fortress', name: 'Stellar Fortress', category: 'ship_skin', price: 3600, rarity: 'epic', description: 'Golden cathedral-class capital ship', preview: 'fortress', maxModuleSlots: 2 },
  { id: 'ship_manta', name: 'Void Manta', category: 'ship_skin', price: 5600, rarity: 'legendary', description: 'Bio-organic manta ray with cosmic tentacles', preview: 'manta', maxModuleSlots: 3 },
  // ── Set B — variants ──
  { id: 'ship_cargo_b', name: 'Cargo Titan', category: 'ship_skin', price: 800, rarity: 'common', description: 'Heavy-duty cargo variant with extra thrusters', preview: 'cargo_b', maxModuleSlots: 1 },
  { id: 'ship_crystal_b', name: 'Emerald Sentinel', category: 'ship_skin', price: 1100, rarity: 'rare', description: 'Green crystal variant with dual core', preview: 'crystal_b', maxModuleSlots: 2 },
  { id: 'ship_fighter_b', name: 'Starfighter Mk.III', category: 'ship_skin', price: 1500, rarity: 'rare', description: 'Silver interceptor with reinforced armor', preview: 'fighter_b', maxModuleSlots: 2 },
  { id: 'ship_stealth_v2_b', name: 'Crimson Wraith', category: 'ship_skin', price: 2600, rarity: 'epic', description: 'Red-accented stealth variant with plasma drives', preview: 'stealth_v2_b', maxModuleSlots: 2 },
  { id: 'ship_fortress_b', name: 'Phoenix Citadel', category: 'ship_skin', price: 4000, rarity: 'epic', description: 'Golden winged fortress with jeweled hull', preview: 'fortress_b', maxModuleSlots: 2 },
  { id: 'ship_trident', name: 'Teal Trident', category: 'ship_skin', price: 6400, rarity: 'legendary', description: 'Three-pronged cosmic interceptor', preview: 'trident', maxModuleSlots: 3 },
];

export const FORGE_TITLES: ForgeItem[] = [
  { id: 'title_explorer', name: 'Explorer', category: 'title', price: 300, rarity: 'common', description: 'Title: "Explorer"', preview: 'Explorer' },
  { id: 'title_guardian', name: 'Cosmic Guardian', category: 'title', price: 1000, rarity: 'rare', description: 'Title: "Cosmic Guardian"', preview: 'Cosmic Guardian' },
  { id: 'title_destroyer', name: 'Destroyer of Dust', category: 'title', price: 1600, rarity: 'rare', description: 'Title: "Destroyer of Dust"', preview: 'Destroyer of Dust', unlockCondition: 'Burn 50 tokens' },
  { id: 'title_architect', name: 'Stellar Architect', category: 'title', price: 2400, rarity: 'epic', description: 'Title: "Stellar Architect"', preview: 'Stellar Architect' },
  { id: 'title_sovereign', name: 'Prism Sovereign', category: 'title', price: 4000, rarity: 'epic', description: 'Title: "Prism Sovereign"', preview: 'Prism Sovereign', unlockCondition: 'Own 5+ Forge items' },
  { id: 'title_ascended', name: 'The Ascended', category: 'title', price: 12000, rarity: 'legendary', description: 'Title: "The Ascended"', preview: 'The Ascended', unlockCondition: 'Score 1000+ identity points' },
];

export const ALL_FORGE_ITEMS: ForgeItem[] = [
  ...FORGE_FRAMES,
  ...FORGE_AURAS,
  ...FORGE_SHIP_SKINS,
  ...FORGE_TITLES,
];

// ── Shared frame styles (used by StellarForge preview + CelestialCard render) ──

export interface FrameStyle {
  gradient: string;           // CSS gradient for the border wrapper background
  boxShadow: string;          // glow around the card
  animation?: string;         // CSS animation name (defined in index.css)
}

export const FRAME_STYLES: Record<string, FrameStyle> = {
  frame_nebula: {
    gradient: 'linear-gradient(135deg, rgba(147,51,234,0.85), rgba(88,28,135,0.7), rgba(147,51,234,0.85))',
    boxShadow: '0 0 30px -2px rgba(147,51,234,0.5), inset 0 0 20px -10px rgba(147,51,234,0.3)',
  },
  frame_solar_flare: {
    gradient: 'linear-gradient(135deg, rgba(251,191,36,0.9), rgba(245,158,11,0.8), rgba(234,88,12,0.85))',
    boxShadow: '0 0 35px -2px rgba(251,191,36,0.5), inset 0 0 20px -10px rgba(251,191,36,0.3)',
  },
  frame_void: {
    gradient: 'linear-gradient(135deg, rgba(139,92,246,0.9), rgba(76,29,149,0.75), rgba(139,92,246,0.9))',
    boxShadow: '0 0 35px -2px rgba(139,92,246,0.5), inset 0 0 20px -10px rgba(139,92,246,0.3)',
  },
  frame_quantum: {
    gradient: 'linear-gradient(135deg, rgba(34,211,238,0.85), rgba(6,182,212,0.7), rgba(34,211,238,0.85))',
    boxShadow: '0 0 35px -2px rgba(34,211,238,0.5), inset 0 0 20px -10px rgba(34,211,238,0.3)',
    animation: 'quantum-march 8s linear infinite',
  },
  frame_supernova: {
    gradient: 'linear-gradient(135deg, rgba(245,158,11,0.95), rgba(239,68,68,0.8), rgba(245,158,11,0.95))',
    boxShadow: '0 0 40px -2px rgba(245,158,11,0.6), inset 0 0 20px -10px rgba(245,158,11,0.3)',
    animation: 'supernova-rotate 4s linear infinite',
  },
  frame_event_horizon: {
    gradient: 'linear-gradient(135deg, rgba(168,85,247,0.95), rgba(88,28,135,0.85), rgba(168,85,247,0.95))',
    boxShadow: '0 0 45px -2px rgba(168,85,247,0.6), inset 0 0 25px -10px rgba(168,85,247,0.3)',
    animation: 'event-horizon-pulse 3s ease-in-out infinite',
  },
};

export const AURA_GLOW_MAP: Record<string, string> = {
  aura_frost: '0 0 30px -4px rgba(96,165,250,0.4), inset 0 0 20px -8px rgba(96,165,250,0.15)',
  aura_ember: '0 0 30px -4px rgba(239,68,68,0.4), inset 0 0 20px -8px rgba(239,68,68,0.15)',
  aura_electric: '0 0 30px -4px rgba(59,130,246,0.4), inset 0 0 20px -8px rgba(59,130,246,0.15)',
  aura_plasma: '0 0 35px -4px rgba(168,85,247,0.45), inset 0 0 20px -8px rgba(168,85,247,0.15)',
  aura_dark_matter: '0 0 40px -4px rgba(126,34,206,0.45), inset 0 0 25px -8px rgba(126,34,206,0.2)',
  aura_binary_pulse: '0 0 40px -4px rgba(34,211,238,0.45), inset 0 0 25px -8px rgba(34,211,238,0.2)',
};

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
    installedModules: {},
  };
}

export function saveLocalLoadout(loadout: ForgeLoadout): void {
  try {
    localStorage.setItem(`${LOADOUT_KEY}_${loadout.address}`, JSON.stringify(loadout));
  } catch {}
}

export function purchaseItem(loadout: ForgeLoadout, itemId: string, prismBalance: number): ForgeLoadout | null {
  if (loadout.ownedItems.some((o) => o.itemId === itemId)) return loadout;

  // Validate PRISM balance — always required
  const item = getItemById(itemId);
  if (!item) return null;
  if (prismBalance < item.price) return null;

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

  updated.ownedItems = updated.ownedItems.map((o) => {
    const oDef = getItemById(o.itemId);
    return {
      ...o,
      equipped: o.itemId === itemId
        ? true
        : (oDef && oDef.category === item.category ? false : o.equipped),
    };
  });

  return updated;
}

export function unequipItem(loadout: ForgeLoadout, category: ForgeCategory): ForgeLoadout {
  const updated = { ...loadout };
  switch (category) {
    case 'frame': updated.equippedFrame = null; break;
    case 'aura': updated.equippedAura = null; break;
    case 'ship_skin': updated.equippedShipSkin = null; break;
    case 'title': updated.equippedTitle = null; break;
  }
  updated.ownedItems = updated.ownedItems.map((o) => {
    const oDef = getItemById(o.itemId);
    return { ...o, equipped: oDef?.category === category ? false : o.equipped };
  });
  return updated;
}

// ── Micromodule Catalog ──

export const MICROMODULE_DEFS: Micromodule[] = [
  // Speed modules
  { id: 'mod_speed_1', name: 'Thruster Boost',  description: 'Basic engine enhancement',           tier: 'blue',   price: 4000,  statBonus: { stat: 'speed', value: 5 },     icon: '🔥', compatibleCategories: ['frame', 'aura', 'ship_skin'] },
  { id: 'mod_speed_2', name: 'Warp Coils',      description: 'Advanced warp drive components',      tier: 'yellow', price: 16000, statBonus: { stat: 'speed', value: 12 },    tradeoff: { stat: 'shield', value: 3 },    icon: '⚡', compatibleCategories: ['frame', 'aura', 'ship_skin'] },
  { id: 'mod_speed_3', name: 'Quantum Engine',   description: 'Experimental quantum propulsion',     tier: 'red',    price: 60000, statBonus: { stat: 'speed', value: 25 },    tradeoff: { stat: 'shield', value: 8 },    icon: '🌀', compatibleCategories: ['frame', 'ship_skin'] },
  // Shield modules
  { id: 'mod_shield_1', name: 'Plating Mk.I',    description: 'Reinforced hull plating',            tier: 'blue',   price: 4000,  statBonus: { stat: 'shield', value: 5 },    icon: '🛡️', compatibleCategories: ['frame', 'aura', 'ship_skin'] },
  { id: 'mod_shield_2', name: 'Deflector Array',  description: 'Energy deflection system',            tier: 'yellow', price: 16000, statBonus: { stat: 'shield', value: 12 },   tradeoff: { stat: 'speed', value: 3 },     icon: '🔷', compatibleCategories: ['frame', 'aura', 'ship_skin'] },
  { id: 'mod_shield_3', name: 'Fortress Core',    description: 'Impenetrable defense matrix',         tier: 'red',    price: 60000, statBonus: { stat: 'shield', value: 25 },   tradeoff: { stat: 'speed', value: 8 },     icon: '🏰', compatibleCategories: ['frame', 'ship_skin'] },
  // Firepower modules
  { id: 'mod_fire_1', name: 'Targeting Chip',    description: 'Enhanced targeting computer',         tier: 'blue',   price: 4000,  statBonus: { stat: 'firepower', value: 5 }, icon: '🎯', compatibleCategories: ['aura', 'frame', 'ship_skin'] },
  { id: 'mod_fire_2', name: 'Arsenal Pack',      description: 'Expanded weapons array',              tier: 'yellow', price: 16000, statBonus: { stat: 'firepower', value: 12 },tradeoff: { stat: 'luck', value: 3 },      icon: '💥', compatibleCategories: ['aura', 'frame', 'ship_skin'] },
  { id: 'mod_fire_3', name: 'Devastator Core',   description: 'Planet-cracking weapon system',       tier: 'red',    price: 60000, statBonus: { stat: 'firepower', value: 25 },tradeoff: { stat: 'luck', value: 8 },      icon: '☢️', compatibleCategories: ['aura', 'ship_skin'] },
  // Luck modules
  { id: 'mod_luck_1', name: 'Scanner Lens',      description: 'Improved anomaly detection',          tier: 'blue',   price: 4000,  statBonus: { stat: 'luck', value: 5 },      icon: '🔍', compatibleCategories: ['aura', 'frame', 'ship_skin'] },
  { id: 'mod_luck_2', name: 'Probability Matrix', description: 'Quantum probability manipulation',    tier: 'yellow', price: 16000, statBonus: { stat: 'luck', value: 12 },     tradeoff: { stat: 'firepower', value: 3 }, icon: '🎲', compatibleCategories: ['aura', 'frame', 'ship_skin'] },
  { id: 'mod_luck_3', name: 'Quantum Oracle',     description: 'Prescient decision engine',           tier: 'red',    price: 60000, statBonus: { stat: 'luck', value: 25 },     tradeoff: { stat: 'firepower', value: 8 }, icon: '🔮', compatibleCategories: ['aura', 'ship_skin'] },
];

export const MODULE_TIER_COLORS: Record<Micromodule['tier'], string> = {
  blue: '#3b82f6',
  yellow: '#eab308',
  red: '#ef4444',
};

export function getModuleById(id: string): Micromodule | undefined {
  return MICROMODULE_DEFS.find((m) => m.id === id);
}

/** Install a module into an item slot (permanent, limited by maxModuleSlots). */
export function installModule(loadout: ForgeLoadout, itemId: string, moduleId: string, hasIdentityCard = false): ForgeLoadout | null {
  const item = getItemById(itemId);
  const mod = getModuleById(moduleId);
  if (!item || !mod) return null;

  // Ship skins require identity card
  if (item.category === 'ship_skin' && !hasIdentityCard) return null;

  // Check compatibility
  if (!mod.compatibleCategories.includes(item.category)) return null;

  // Check ownership
  if (!loadout.ownedItems.some((o) => o.itemId === itemId)) return null;

  const currentModules = loadout.installedModules[itemId] || [];

  // Slot limit: use item's maxModuleSlots (default 3)
  const maxSlots = item.maxModuleSlots ?? 3;
  if (currentModules.length >= maxSlots) return null;

  // No duplicate module on same item
  if (currentModules.includes(moduleId)) return null;

  return {
    ...loadout,
    installedModules: {
      ...loadout.installedModules,
      [itemId]: [...currentModules, moduleId],
    },
  };
}

/** Remove a module from an item. Returns updated loadout or null if not found. */
export function uninstallModule(loadout: ForgeLoadout, itemId: string, moduleId: string): ForgeLoadout | null {
  const currentModules = loadout.installedModules[itemId] || [];
  const idx = currentModules.indexOf(moduleId);
  if (idx === -1) return null;
  return { ...loadout, installedModules: { ...loadout.installedModules, [itemId]: currentModules.filter((_, i) => i !== idx) } };
}

/** Get modules installed on an item. */
export function getItemModules(loadout: ForgeLoadout, itemId: string): Micromodule[] {
  const ids = loadout.installedModules[itemId] || [];
  return ids.map(getModuleById).filter((m): m is Micromodule => m != null);
}

/** Get total stat bonuses from all installed modules across equipped items. */
export function getModuleBonuses(loadout: ForgeLoadout): { speed: number; shield: number; firepower: number; luck: number } {
  const bonuses = { speed: 0, shield: 0, firepower: 0, luck: 0 };
  const equippedItems = [loadout.equippedFrame, loadout.equippedAura, loadout.equippedShipSkin, loadout.equippedTitle].filter(Boolean) as string[];

  for (const itemId of equippedItems) {
    const modules = getItemModules(loadout, itemId);
    for (const mod of modules) {
      bonuses[mod.statBonus.stat] += mod.statBonus.value;
      if (mod.tradeoff) {
        bonuses[mod.tradeoff.stat] -= mod.tradeoff.value;
      }
    }
  }

  return bonuses;
}
