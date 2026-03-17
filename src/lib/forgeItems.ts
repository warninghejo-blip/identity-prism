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
  image: string;
  compatibleCategories: ForgeCategory[];
}

export interface ForgeItem {
  id: string;
  name: string;
  category: ForgeCategory;
  price: number; // Coins
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  description: string;
  preview: string; // CSS/shader identifier or image path
  unlockCondition?: string; // optional requirement beyond price
  requiredRank?: string; // minimum Ranger Rank to purchase (cadet/pilot/captain/ace/legend)
  maxModuleSlots?: number; // how many modules can be installed (ship_skin only)
}

// ── Ranger Rank progression helpers ──

export const RANK_ORDER = ['cadet', 'pilot', 'captain', 'ace', 'legend'] as const;

export const RANK_LABELS: Record<string, string> = {
  cadet: 'Cadet',
  pilot: 'Pilot',
  captain: 'Captain',
  ace: 'Ace',
  legend: 'Legend',
};

export function meetsRequiredRank(userRank: string | undefined, requiredRank: string | undefined): boolean {
  if (!requiredRank) return true;
  if (!userRank) return false;
  return (
    RANK_ORDER.indexOf(userRank as (typeof RANK_ORDER)[number]) >=
    RANK_ORDER.indexOf(requiredRank as (typeof RANK_ORDER)[number])
  );
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
  ownedModules: string[]; // bought but not yet installed
}

// ── Item Catalog ──

export const FORGE_FRAMES: ForgeItem[] = [
  // Common (~12 composite pts)
  {
    id: 'frame_nebula',
    name: 'Nebula Frame',
    category: 'frame',
    price: 800,
    rarity: 'common',
    description: 'Soft purple nebula border · +7 Proof, +4 Trust',
    preview: 'nebula',
  },
  {
    id: 'frame_iron_veil',
    name: 'Iron Veil',
    category: 'frame',
    price: 1000,
    rarity: 'common',
    description: 'Steel-forged border plating · +8 Engage, +4 Social',
    preview: 'iron_veil',
  },
  // Rare (~24-35 composite pts)
  {
    id: 'frame_solar_flare',
    name: 'Solar Flare',
    category: 'frame',
    price: 2800,
    rarity: 'rare',
    description: 'Animated golden flare edges · +30 Chain, +5 Proof',
    preview: 'solar_flare',
    requiredRank: 'pilot',
  },
  {
    id: 'frame_ionic_storm',
    name: 'Ionic Storm',
    category: 'frame',
    price: 2800,
    rarity: 'rare',
    description: 'Crackling indigo energy field · +18 Engage, +6 Chain',
    preview: 'ionic_storm',
    requiredRank: 'pilot',
  },
  {
    id: 'frame_basalt',
    name: 'Basalt Fortress',
    category: 'frame',
    price: 3500,
    rarity: 'rare',
    description: 'Bronze volcanic rock border · +18 Trust, +5 Proof',
    preview: 'basalt',
    requiredRank: 'pilot',
  },
  // Epic (~34-44 composite pts)
  {
    id: 'frame_void',
    name: 'Void Edge',
    category: 'frame',
    price: 5500,
    rarity: 'epic',
    description: 'Dark matter distortion border · +27 Trust, +7 Proof',
    preview: 'void',
    requiredRank: 'pilot',
  },
  {
    id: 'frame_quantum',
    name: 'Quantum Lattice',
    category: 'frame',
    price: 6500,
    rarity: 'epic',
    description: 'Glitching holographic wireframe · +22 Engage, +18 Chain',
    preview: 'quantum',
    requiredRank: 'captain',
  },
  {
    id: 'frame_pulsar',
    name: 'Pulsar Grid',
    category: 'frame',
    price: 6000,
    rarity: 'epic',
    description: 'Emerald pulsar energy grid · +20 Trust, +18 Chain, +6 Engage',
    preview: 'pulsar',
    requiredRank: 'captain',
  },
  // Legendary (~52-67 composite pts)
  {
    id: 'frame_supernova',
    name: 'Supernova',
    category: 'frame',
    price: 20000,
    rarity: 'legendary',
    description: 'Explosive radiant border · +50 Chain, +10 Engage, +7 Proof',
    preview: 'supernova',
    requiredRank: 'ace',
  },
  {
    id: 'frame_event_horizon',
    name: 'Event Horizon',
    category: 'frame',
    price: 22000,
    rarity: 'legendary',
    description: 'Warped spacetime distortion · +30 Trust, +10 Proof, +12 Chain',
    preview: 'event_horizon',
    requiredRank: 'ace',
    unlockCondition: 'Burn 100+ tokens in Black Hole',
  },
  {
    id: 'frame_singularity',
    name: 'Singularity Core',
    category: 'frame',
    price: 24000,
    rarity: 'legendary',
    description: 'Collapsing singularity frame · +18 Engage, +25 Chain, +15 Trust',
    preview: 'singularity',
    requiredRank: 'legend',
  },
];

export const FORGE_AURAS: ForgeItem[] = [
  // Common
  {
    id: 'aura_frost',
    name: 'Frost Aura',
    category: 'aura',
    price: 3000,
    rarity: 'common',
    description: 'Ice crystal shield matrix · +10% Shield',
    preview: 'frost',
  },
  {
    id: 'aura_ember',
    name: 'Ember Aura',
    category: 'aura',
    price: 3000,
    rarity: 'common',
    description: 'Ember energy amplifier · +10% Firepower',
    preview: 'ember',
  },
  {
    id: 'aura_solar_wind',
    name: 'Solar Wind',
    category: 'aura',
    price: 3000,
    rarity: 'common',
    description: 'Golden solar stream · +10% Speed',
    preview: 'solar_wind',
  },
  {
    id: 'aura_fortune_mist',
    name: 'Fortune Mist',
    category: 'aura',
    price: 3000,
    rarity: 'common',
    description: 'Violet luck mist · +12% Luck',
    preview: 'fortune_mist',
  },
  // Rare
  {
    id: 'aura_electric',
    name: 'Electric Storm',
    category: 'aura',
    price: 7000,
    rarity: 'rare',
    description: 'Lightning charge field · +15% Speed',
    preview: 'electric',
    requiredRank: 'pilot',
  },
  {
    id: 'aura_crimson_tide',
    name: 'Crimson Tide',
    category: 'aura',
    price: 6000,
    rarity: 'rare',
    description: 'Blood-red firepower surge · +15% FP',
    preview: 'crimson_tide',
    requiredRank: 'pilot',
  },
  {
    id: 'aura_void_shell',
    name: 'Void Shell',
    category: 'aura',
    price: 8000,
    rarity: 'rare',
    description: 'Indigo void barrier · +15% Shield',
    preview: 'void_shell',
    requiredRank: 'pilot',
  },
  // Epic
  {
    id: 'aura_plasma',
    name: 'Plasma Field',
    category: 'aura',
    price: 14000,
    rarity: 'epic',
    description: 'Plasma energy vortex · +15% FP, +8% Speed',
    preview: 'plasma',
    requiredRank: 'captain',
  },
  {
    id: 'aura_stellar_tide',
    name: 'Stellar Tide',
    category: 'aura',
    price: 15000,
    rarity: 'epic',
    description: 'Emerald stellar flow · +12% Shield, +10% Luck',
    preview: 'stellar_tide',
    requiredRank: 'captain',
  },
  // Legendary
  {
    id: 'aura_dark_matter',
    name: 'Dark Matter',
    category: 'aura',
    price: 20000,
    rarity: 'legendary',
    description: 'Dark matter gravity well · +20% Shield, +8% FP',
    preview: 'dark_matter',
    requiredRank: 'ace',
  },
  {
    id: 'aura_binary_pulse',
    name: 'Binary Pulse',
    category: 'aura',
    price: 32000,
    rarity: 'legendary',
    description: 'Binary star resonance · +15% Speed, +15% Luck',
    preview: 'binary_pulse',
    requiredRank: 'legend',
    unlockCondition: 'Reach Binary Sun tier',
  },
];

export const FORGE_SHIP_SKINS: ForgeItem[] = [
  // ── Common (budget 10) ──
  {
    id: 'ship_cargo',
    name: 'Cargo Hauler',
    category: 'ship_skin',
    price: 4000,
    rarity: 'common',
    description: 'Heavy industrial mining vessel',
    preview: 'cargo',
    maxModuleSlots: 1,
  },
  {
    id: 'ship_cargo_b',
    name: 'Cargo Titan',
    category: 'ship_skin',
    price: 5000,
    rarity: 'common',
    description: 'Heavy-duty cargo variant with extra thrusters',
    preview: 'cargo_b',
    maxModuleSlots: 1,
  },
  // ── Rare (budget 16) ──
  {
    id: 'ship_crystal',
    name: 'Crystal Sentinel',
    category: 'ship_skin',
    price: 9000,
    rarity: 'rare',
    description: 'Amethyst crystal hull with Solana core',
    preview: 'crystal',
    maxModuleSlots: 2,
    requiredRank: 'pilot',
  },
  {
    id: 'ship_crystal_b',
    name: 'Emerald Sentinel',
    category: 'ship_skin',
    price: 9000,
    rarity: 'rare',
    description: 'Green crystal variant with dual core',
    preview: 'crystal_b',
    maxModuleSlots: 2,
    requiredRank: 'pilot',
  },
  {
    id: 'ship_chrome',
    name: 'Chrome Sentinel',
    category: 'ship_skin',
    price: 9500,
    rarity: 'rare',
    description: 'Mirror-plated heavy defender',
    preview: 'chrome',
    maxModuleSlots: 2,
    requiredRank: 'pilot',
  },
  {
    id: 'ship_fortress',
    name: 'Stellar Fortress',
    category: 'ship_skin',
    price: 10000,
    rarity: 'rare',
    description: 'Golden cathedral-class capital ship',
    preview: 'fortress',
    maxModuleSlots: 2,
    requiredRank: 'pilot',
  },
  {
    id: 'ship_fighter',
    name: 'Starfighter Mk.II',
    category: 'ship_skin',
    price: 10000,
    rarity: 'rare',
    description: 'Sleek teal interceptor with energy wings',
    preview: 'fighter',
    maxModuleSlots: 2,
    requiredRank: 'pilot',
  },
  {
    id: 'ship_fighter_b',
    name: 'Starfighter Mk.III',
    category: 'ship_skin',
    price: 10000,
    rarity: 'rare',
    description: 'Silver interceptor with reinforced armor',
    preview: 'fighter_b',
    maxModuleSlots: 2,
    requiredRank: 'pilot',
  },
  {
    id: 'ship_neon',
    name: 'Neon Racer',
    category: 'ship_skin',
    price: 11000,
    rarity: 'rare',
    description: 'Ultra-fast neon-lit speedster',
    preview: 'neon',
    maxModuleSlots: 2,
    requiredRank: 'pilot',
  },
  // ── Epic (budget 22) ──
  {
    id: 'ship_stealth_v2',
    name: 'Shadow Wraith',
    category: 'ship_skin',
    price: 18000,
    rarity: 'epic',
    description: 'Ultra-dark stealth bomber with purple circuits',
    preview: 'stealth_v2',
    maxModuleSlots: 2,
    requiredRank: 'captain',
  },
  {
    id: 'ship_stealth',
    name: 'Ghost Protocol',
    category: 'ship_skin',
    price: 19000,
    rarity: 'epic',
    description: 'Stealth interceptor with radar-absorbing hull',
    preview: 'stealth',
    maxModuleSlots: 2,
    requiredRank: 'captain',
  },
  {
    id: 'ship_stealth_v2_b',
    name: 'Crimson Wraith',
    category: 'ship_skin',
    price: 19000,
    rarity: 'epic',
    description: 'Red-accented stealth variant with plasma drives',
    preview: 'stealth_v2_b',
    maxModuleSlots: 2,
    requiredRank: 'captain',
  },
  {
    id: 'ship_phantom',
    name: 'Phantom Striker',
    category: 'ship_skin',
    price: 19500,
    rarity: 'epic',
    description: 'Devastating firepower platform',
    preview: 'phantom',
    maxModuleSlots: 2,
    requiredRank: 'captain',
  },
  {
    id: 'ship_fortress_b',
    name: 'Phoenix Citadel',
    category: 'ship_skin',
    price: 21000,
    rarity: 'epic',
    description: 'Golden winged fortress with jeweled hull',
    preview: 'fortress_b',
    maxModuleSlots: 2,
    requiredRank: 'captain',
  },
  // ── Legendary (budget 32) ──
  {
    id: 'ship_prism',
    name: 'Prism Ascendant',
    category: 'ship_skin',
    price: 45000,
    rarity: 'legendary',
    description: 'Refracted-light crystal warship',
    preview: 'prism',
    maxModuleSlots: 3,
    requiredRank: 'ace',
  },
  {
    id: 'ship_manta',
    name: 'Void Manta',
    category: 'ship_skin',
    price: 40000,
    rarity: 'legendary',
    description: 'Bio-organic manta ray with cosmic tentacles',
    preview: 'manta',
    maxModuleSlots: 3,
    requiredRank: 'ace',
  },
  {
    id: 'ship_trident',
    name: 'Teal Trident',
    category: 'ship_skin',
    price: 44000,
    rarity: 'legendary',
    description: 'Three-pronged cosmic interceptor',
    preview: 'trident',
    maxModuleSlots: 3,
    requiredRank: 'ace',
  },
  {
    id: 'ship_golden',
    name: 'Solar Sovereign',
    category: 'ship_skin',
    price: 50000,
    rarity: 'legendary',
    description: 'Golden flagship of the solar court',
    preview: 'golden',
    maxModuleSlots: 3,
    requiredRank: 'ace',
  },
];

export const FORGE_TITLES: ForgeItem[] = [
  // Common (budget 2, ~300/pt)
  {
    id: 'title_explorer',
    name: 'Void Wanderer',
    category: 'title',
    price: 600,
    rarity: 'common',
    description: 'Drifting through the cosmic unknown · +2 Luck',
    preview: 'Void Wanderer',
  },
  {
    id: 'title_starborn',
    name: 'Child of Starfire',
    category: 'title',
    price: 600,
    rarity: 'common',
    description: 'Born from stellar flame · +2 FP',
    preview: 'Child of Starfire',
  },
  // Rare (budget 4, ~600-800/pt)
  {
    id: 'title_guardian',
    name: 'Celestial Warden',
    category: 'title',
    price: 2400,
    rarity: 'rare',
    description: 'Sworn protector of the stellar realm · +3 Luck, +1 Shield',
    preview: 'Celestial Warden',
    requiredRank: 'pilot',
  },
  {
    id: 'title_destroyer',
    name: 'Annihilator of Worlds',
    category: 'title',
    price: 3200,
    rarity: 'rare',
    description: 'Leaves nothing but stardust in their wake · +3 Luck, +1 FP',
    preview: 'Annihilator of Worlds',
    requiredRank: 'pilot',
    unlockCondition: 'Burn 50 tokens',
  },
  {
    id: 'title_voidrunner',
    name: 'Voidrunner',
    category: 'title',
    price: 2400,
    rarity: 'rare',
    description: 'Swift shadow of the void · +3 Luck, +1 Speed',
    preview: 'Voidrunner',
    requiredRank: 'pilot',
  },
  // Epic (budget 6, ~1000-1200/pt)
  {
    id: 'title_architect',
    name: 'Architect of Galaxies',
    category: 'title',
    price: 6000,
    rarity: 'epic',
    description: 'Reshaping the cosmos with every command · +4 Luck, +2 Speed',
    preview: 'Architect of Galaxies',
    requiredRank: 'captain',
  },
  {
    id: 'title_sovereign',
    name: 'Sovereign of the Nebula',
    category: 'title',
    price: 8000,
    rarity: 'epic',
    description: 'Ruling over infinite stellar domains · +4 Luck, +2 Shield',
    preview: 'Sovereign of the Nebula',
    requiredRank: 'captain',
    unlockCondition: 'Own 5+ Forge items',
  },
  {
    id: 'title_dreadnought',
    name: 'Dreadnought',
    category: 'title',
    price: 6000,
    rarity: 'epic',
    description: 'Immovable war machine · +4 Shield, +2 FP',
    preview: 'Dreadnought',
    requiredRank: 'captain',
  },
  {
    id: 'title_phantom_hand',
    name: 'Phantom Hand',
    category: 'title',
    price: 7000,
    rarity: 'epic',
    description: 'Unseen manipulator of fate · +3 Speed, +3 Luck',
    preview: 'Phantom Hand',
    requiredRank: 'captain',
  },
  // Legendary (budget 10, ~2400-2800/pt)
  {
    id: 'title_ascended',
    name: 'Omega Transcendent',
    category: 'title',
    price: 24000,
    rarity: 'legendary',
    description: 'Beyond mortal comprehension · +8 Luck, +2 Speed',
    preview: 'Omega Transcendent',
    requiredRank: 'legend',
    unlockCondition: 'Score 1000+ identity points',
  },
  {
    id: 'title_harbinger',
    name: 'Harbinger of Void',
    category: 'title',
    price: 28000,
    rarity: 'legendary',
    description: 'Herald of cosmic annihilation · +5 FP, +3 Speed, +2 Shield',
    preview: 'Harbinger of Void',
    requiredRank: 'ace',
  },
];

export const ALL_FORGE_ITEMS: ForgeItem[] = [...FORGE_FRAMES, ...FORGE_AURAS, ...FORGE_SHIP_SKINS, ...FORGE_TITLES];

// ── Shared frame styles (used by StellarForge preview + CelestialCard render) ──

export interface FrameStyle {
  gradient: string; // CSS gradient for the border wrapper background
  boxShadow: string; // glow around the card
  animation?: string; // CSS animation name (defined in index.css)
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
  frame_iron_veil: {
    gradient: 'linear-gradient(135deg, rgba(107,114,128,0.85), rgba(75,85,99,0.7), rgba(107,114,128,0.85))',
    boxShadow: '0 0 25px -2px rgba(107,114,128,0.4), inset 0 0 15px -10px rgba(107,114,128,0.2)',
  },
  frame_ionic_storm: {
    gradient: 'linear-gradient(135deg, rgba(99,102,241,0.9), rgba(67,56,202,0.75), rgba(99,102,241,0.9))',
    boxShadow: '0 0 35px -2px rgba(99,102,241,0.5), inset 0 0 20px -10px rgba(99,102,241,0.3)',
    animation: 'ionic-flicker 2s ease-in-out infinite',
  },
  frame_basalt: {
    gradient: 'linear-gradient(135deg, rgba(180,83,9,0.9), rgba(120,53,15,0.75), rgba(180,83,9,0.9))',
    boxShadow: '0 0 30px -2px rgba(180,83,9,0.5), inset 0 0 20px -10px rgba(180,83,9,0.3)',
  },
  frame_pulsar: {
    gradient: 'linear-gradient(135deg, rgba(16,185,129,0.9), rgba(5,150,105,0.75), rgba(16,185,129,0.9))',
    boxShadow: '0 0 35px -2px rgba(16,185,129,0.5), inset 0 0 20px -10px rgba(16,185,129,0.3)',
    animation: 'pulsar-ping 2.5s ease-in-out infinite',
  },
  frame_singularity: {
    gradient: 'linear-gradient(135deg, rgba(99,102,241,0.95), rgba(30,27,75,0.85), rgba(99,102,241,0.95))',
    boxShadow: '0 0 45px -2px rgba(99,102,241,0.6), inset 0 0 25px -10px rgba(99,102,241,0.3)',
    animation: 'singularity-collapse 4s ease-in-out infinite',
  },
};

export const AURA_GLOW_MAP: Record<string, string> = {
  aura_frost: '0 0 30px -4px rgba(96,165,250,0.4), inset 0 0 20px -8px rgba(96,165,250,0.15)',
  aura_ember: '0 0 30px -4px rgba(239,68,68,0.4), inset 0 0 20px -8px rgba(239,68,68,0.15)',
  aura_electric: '0 0 30px -4px rgba(59,130,246,0.4), inset 0 0 20px -8px rgba(59,130,246,0.15)',
  aura_plasma: '0 0 35px -4px rgba(168,85,247,0.45), inset 0 0 20px -8px rgba(168,85,247,0.15)',
  aura_dark_matter: '0 0 40px -4px rgba(126,34,206,0.45), inset 0 0 25px -8px rgba(126,34,206,0.2)',
  aura_binary_pulse: '0 0 40px -4px rgba(34,211,238,0.45), inset 0 0 25px -8px rgba(34,211,238,0.2)',
  aura_solar_wind: '0 0 30px -4px rgba(253,224,71,0.4), inset 0 0 20px -8px rgba(253,224,71,0.15)',
  aura_fortune_mist: '0 0 30px -4px rgba(167,139,250,0.4), inset 0 0 20px -8px rgba(167,139,250,0.15)',
  aura_crimson_tide: '0 0 30px -4px rgba(248,113,113,0.4), inset 0 0 20px -8px rgba(248,113,113,0.15)',
  aura_void_shell: '0 0 30px -4px rgba(129,140,248,0.4), inset 0 0 20px -8px rgba(129,140,248,0.15)',
  aura_stellar_tide: '0 0 35px -4px rgba(52,211,153,0.45), inset 0 0 20px -8px rgba(52,211,153,0.15)',
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
  aura: 'Ship Auras',
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
    if (data) {
      const parsed = JSON.parse(data);
      if (!parsed.ownedModules) parsed.ownedModules = [];
      return parsed;
    }
  } catch {}
  return {
    address,
    equippedFrame: null,
    equippedAura: null,
    equippedShipSkin: null,
    equippedTitle: null,
    ownedItems: [],
    installedModules: {},
    ownedModules: [],
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
    ownedItems: [...loadout.ownedItems, { itemId, purchasedAt: new Date().toISOString(), equipped: false }],
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
      equipped: o.itemId === itemId ? true : oDef && oDef.category === item.category ? false : o.equipped,
    };
  });

  return updated;
}

export function unequipItem(loadout: ForgeLoadout, category: ForgeCategory): ForgeLoadout {
  const updated = { ...loadout };
  switch (category) {
    case 'frame':
      updated.equippedFrame = null;
      break;
    case 'aura':
      updated.equippedAura = null;
      break;
    case 'ship_skin':
      updated.equippedShipSkin = null;
      break;
    case 'title':
      updated.equippedTitle = null;
      break;
  }
  updated.ownedItems = updated.ownedItems.map((o) => {
    const oDef = getItemById(o.itemId);
    return { ...o, equipped: oDef?.category === category ? false : o.equipped };
  });
  return updated;
}

// ── Micromodule Catalog ──

export const MICROMODULE_DEFS: Micromodule[] = [
  // Speed modules (blue: 800/pt, yellow: 1780/pt, red: 2940/pt)
  {
    id: 'mod_speed_1',
    name: 'Thruster Boost',
    description: 'Basic engine enhancement',
    tier: 'blue',
    price: 4000,
    statBonus: { stat: 'speed', value: 5 },
    icon: '🔥',
    image: '/textures/modules/mod_speed_1.png',
    compatibleCategories: ['ship_skin'],
  },
  {
    id: 'mod_speed_2',
    name: 'Warp Coils',
    description: 'Advanced warp drive components',
    tier: 'yellow',
    price: 16000,
    statBonus: { stat: 'speed', value: 12 },
    tradeoff: { stat: 'shield', value: 3 },
    icon: '⚡',
    image: '/textures/modules/mod_speed_2.png',
    compatibleCategories: ['ship_skin'],
  },
  {
    id: 'mod_speed_3',
    name: 'Quantum Engine',
    description: 'Experimental quantum propulsion',
    tier: 'red',
    price: 50000,
    statBonus: { stat: 'speed', value: 25 },
    tradeoff: { stat: 'shield', value: 8 },
    icon: '🌀',
    image: '/textures/modules/mod_speed_3.png',
    compatibleCategories: ['ship_skin'],
  },
  // Shield modules
  {
    id: 'mod_shield_1',
    name: 'Plating Mk.I',
    description: 'Reinforced hull plating',
    tier: 'blue',
    price: 4000,
    statBonus: { stat: 'shield', value: 5 },
    icon: '🛡️',
    image: '/textures/modules/mod_shield_1.png',
    compatibleCategories: ['ship_skin'],
  },
  {
    id: 'mod_shield_2',
    name: 'Deflector Array',
    description: 'Energy deflection system',
    tier: 'yellow',
    price: 16000,
    statBonus: { stat: 'shield', value: 12 },
    tradeoff: { stat: 'speed', value: 3 },
    icon: '🔷',
    image: '/textures/modules/mod_shield_2.png',
    compatibleCategories: ['ship_skin'],
  },
  {
    id: 'mod_shield_3',
    name: 'Fortress Core',
    description: 'Impenetrable defense matrix',
    tier: 'red',
    price: 50000,
    statBonus: { stat: 'shield', value: 25 },
    tradeoff: { stat: 'speed', value: 8 },
    icon: '🏰',
    image: '/textures/modules/mod_shield_3.png',
    compatibleCategories: ['ship_skin'],
  },
  // Firepower modules
  {
    id: 'mod_fire_1',
    name: 'Targeting Chip',
    description: 'Enhanced targeting computer',
    tier: 'blue',
    price: 4000,
    statBonus: { stat: 'firepower', value: 5 },
    icon: '🎯',
    image: '/textures/modules/mod_fire_1.png',
    compatibleCategories: ['ship_skin'],
  },
  {
    id: 'mod_fire_2',
    name: 'Arsenal Pack',
    description: 'Expanded weapons array',
    tier: 'yellow',
    price: 16000,
    statBonus: { stat: 'firepower', value: 12 },
    tradeoff: { stat: 'luck', value: 3 },
    icon: '💥',
    image: '/textures/modules/mod_fire_2.png',
    compatibleCategories: ['ship_skin'],
  },
  {
    id: 'mod_fire_3',
    name: 'Devastator Core',
    description: 'Planet-cracking weapon system',
    tier: 'red',
    price: 50000,
    statBonus: { stat: 'firepower', value: 25 },
    tradeoff: { stat: 'luck', value: 8 },
    icon: '☢️',
    image: '/textures/modules/mod_fire_3.png',
    compatibleCategories: ['ship_skin'],
  },
  // Luck modules
  {
    id: 'mod_luck_1',
    name: 'Scanner Lens',
    description: 'Improved anomaly detection',
    tier: 'blue',
    price: 4000,
    statBonus: { stat: 'luck', value: 5 },
    icon: '🔍',
    image: '/textures/modules/mod_luck_1.png',
    compatibleCategories: ['ship_skin'],
  },
  {
    id: 'mod_luck_2',
    name: 'Probability Matrix',
    description: 'Quantum probability manipulation',
    tier: 'yellow',
    price: 16000,
    statBonus: { stat: 'luck', value: 12 },
    tradeoff: { stat: 'firepower', value: 3 },
    icon: '🎲',
    image: '/textures/modules/mod_luck_2.png',
    compatibleCategories: ['ship_skin'],
  },
  {
    id: 'mod_luck_3',
    name: 'Quantum Oracle',
    description: 'Prescient decision engine',
    tier: 'red',
    price: 50000,
    statBonus: { stat: 'luck', value: 25 },
    tradeoff: { stat: 'firepower', value: 8 },
    icon: '🔮',
    image: '/textures/modules/mod_luck_3.png',
    compatibleCategories: ['ship_skin'],
  },
];

export const MODULE_TIER_COLORS: Record<Micromodule['tier'], string> = {
  blue: '#3b82f6',
  yellow: '#eab308',
  red: '#ef4444',
};

export function getModuleById(id: string): Micromodule | undefined {
  return MICROMODULE_DEFS.find((m) => m.id === id);
}

/** Purchase a module — adds to ownedModules (not yet installed). */
export function purchaseModule(loadout: ForgeLoadout, moduleId: string, prismBalance: number): ForgeLoadout | null {
  const mod = getModuleById(moduleId);
  if (!mod) return null;
  if (prismBalance < mod.price) return null;
  // Already owned (in inventory or installed somewhere)
  if (loadout.ownedModules.includes(moduleId)) return null;
  const alreadyInstalled = Object.values(loadout.installedModules).some((mods) => mods.includes(moduleId));
  if (alreadyInstalled) return null;
  return { ...loadout, ownedModules: [...loadout.ownedModules, moduleId] };
}

/** Install a module from ownedModules into a ship slot. */
export function installModule(
  loadout: ForgeLoadout,
  itemId: string,
  moduleId: string,
  hasIdentityCard = false,
): ForgeLoadout | null {
  const item = getItemById(itemId);
  const mod = getModuleById(moduleId);
  if (!item || !mod) return null;

  // Ship skins require identity card
  if (item.category === 'ship_skin' && !hasIdentityCard) return null;

  // Check compatibility
  if (!mod.compatibleCategories.includes(item.category)) return null;

  // Check ownership of item
  if (!loadout.ownedItems.some((o) => o.itemId === itemId)) return null;

  // Module must be in ownedModules
  if (!loadout.ownedModules.includes(moduleId)) return null;

  const currentModules = loadout.installedModules[itemId] || [];

  // Slot limit: use item's maxModuleSlots (default 3)
  const maxSlots = item.maxModuleSlots ?? 3;
  if (currentModules.length >= maxSlots) return null;

  // No duplicate module on same item
  if (currentModules.includes(moduleId)) return null;

  // No duplicate module across ALL items (prevent stacking same module on multiple items)
  const alreadyInstalledElsewhere = Object.entries(loadout.installedModules).some(
    ([key, mods]) => key !== itemId && mods.includes(moduleId),
  );
  if (alreadyInstalledElsewhere) return null;

  return {
    ...loadout,
    ownedModules: loadout.ownedModules.filter((id) => id !== moduleId),
    installedModules: {
      ...loadout.installedModules,
      [itemId]: [...currentModules, moduleId],
    },
  };
}

/** Remove a module from an item — returns it to ownedModules. */
export function uninstallModule(loadout: ForgeLoadout, itemId: string, moduleId: string): ForgeLoadout | null {
  const currentModules = loadout.installedModules[itemId] || [];
  const idx = currentModules.indexOf(moduleId);
  if (idx === -1) return null;
  return {
    ...loadout,
    ownedModules: [...loadout.ownedModules, moduleId],
    installedModules: { ...loadout.installedModules, [itemId]: currentModules.filter((_, i) => i !== idx) },
  };
}

/** Get modules installed on an item. */
export function getItemModules(loadout: ForgeLoadout, itemId: string): Micromodule[] {
  const ids = loadout.installedModules[itemId] || [];
  return ids.map(getModuleById).filter((m): m is Micromodule => m != null);
}

/** Get total stat bonuses from all installed modules across equipped items. */
export function getModuleBonuses(loadout: ForgeLoadout): {
  speed: number;
  shield: number;
  firepower: number;
  luck: number;
} {
  const bonuses = { speed: 0, shield: 0, firepower: 0, luck: 0 };
  const equippedItems = [
    loadout.equippedFrame,
    loadout.equippedAura,
    loadout.equippedShipSkin,
    loadout.equippedTitle,
  ].filter(Boolean) as string[];

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
