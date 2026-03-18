/**
 * Inject full test profile for a wallet — max rank, all items, max coins.
 * Usage: node scripts/inject-test-wallet.js
 */
const fs = require('fs');
const path = require('path');

const ADDR = 'D1mzmpBP5ZFG3Mrc1dTdbRdAYKV927zAUjzmdcnR2SFY';
const DB_FILE = path.join(__dirname, '..', 'metadata', 'wallet-database.json');

const raw = fs.readFileSync(DB_FILE, 'utf8');
const parsed = JSON.parse(raw);

const existing = (parsed.wallets && parsed.wallets[ADDR]) || {};
const now = new Date().toISOString();

// All forge item IDs
const ALL_ITEMS = [
  'frame_nebula','frame_iron_veil','frame_solar_flare','frame_ionic_storm','frame_basalt',
  'frame_void','frame_quantum','frame_pulsar','frame_supernova','frame_event_horizon','frame_singularity',
  'aura_frost','aura_ember','aura_solar_wind','aura_fortune_mist','aura_electric','aura_crimson_tide',
  'aura_void_shell','aura_plasma','aura_stellar_tide','aura_dark_matter','aura_binary_pulse',
  'ship_cargo','ship_cargo_b','ship_crystal','ship_crystal_b','ship_chrome','ship_fortress',
  'ship_fighter','ship_fighter_b','ship_neon','ship_stealth_v2','ship_stealth','ship_stealth_v2_b',
  'ship_phantom','ship_fortress_b','ship_prism','ship_manta','ship_trident','ship_golden',
  'title_explorer','title_starborn','title_guardian','title_destroyer','title_voidrunner',
  'title_architect','title_sovereign','title_dreadnought','title_phantom_hand','title_ascended','title_harbinger'
];

const ALL_MODULES = [
  'mod_speed_1','mod_speed_2','mod_speed_3',
  'mod_shield_1','mod_shield_2','mod_shield_3',
  'mod_fire_1','mod_fire_2','mod_fire_3',
  'mod_luck_1','mod_luck_2','mod_luck_3'
];

const QUEST_IDS = [
  'abandoned_station','pirate_ambush','dark_matter_anomaly','prison_break',
  'dominator_factory','election_day','alien_zoo','smugglers_run',
  'wormhole_gambit','living_city','galactic_jackpot','jungle_survey',
  'plague_ship','fortress_heist','merc_contract','alien_embassy'
];

// Build owned items
const ownedItems = ALL_ITEMS.map(id => ({ itemId: id, purchasedAt: now, equipped: false }));

// Build loadout
const loadout = {
  address: ADDR,
  equippedFrame: 'frame_event_horizon',
  equippedAura: 'aura_binary_pulse',
  equippedShipSkin: 'ship_golden',
  equippedTitle: 'title_ascended',
  ownedItems,
  installedModules: {},
  ownedModules: ALL_MODULES
};

// Text quest saves
const textQuests = {};
for (const qid of QUEST_IDS) {
  textQuests[qid] = { questId: qid, completed: true, currentNodeId: 'end', reward: { coins: 100 }, completedAt: now };
}

// Game stats (localStorage key → value)
const gameStats = {
  orbit_survival_stats_v1: { gamesPlayed: 200, totalSurvivalTime: 50000, bestTime: 600 },
  cosmic_defender_stats_v1: { gamesPlayed: 200, totalKills: 10000, bestScore: 2000 },
  gravity_rush_stats_v1: { gamesPlayed: 200, totalSurvivalTime: 50000, totalTime: 50000, bestTime: 600 }
};

// Best scores
const bestScores = {};
bestScores['prism_league_best_orbit_survival_' + ADDR] = 600;
bestScores['prism_league_best_cosmic_defender_' + ADDR] = 2000;
bestScores['prism_league_best_gravity_rush_' + ADDR] = 600;

// Achievements (orbit + defender)
const ORBIT_ACHIEVEMENTS = [
  'first_orbit','minute_mark','three_minutes','five_minutes','ten_minutes','asteroid_dodger',
  'near_miss_master','combo_king','shield_master','perfect_orbit','survivor','veteran',
  'legend','marathon_runner','untouchable','coin_collector','big_spender','speed_demon',
  'zen_master','no_shield_run','point_hoarder'
];
const DEFENDER_ACHIEVEMENTS = [
  'first_blood','level_5','level_10','alien_slayer','boss_killer','marksman',
  'shield_breaker','combo_5','no_damage_level','speed_killer'
];
const achievements = {};
for (const a of [...ORBIT_ACHIEVEMENTS, ...DEFENDER_ACHIEVEMENTS]) {
  achievements[a] = { id: a, unlocked: true, unlockedAt: now, claimed: true, claimedAt: now };
}

// Ranger XP / Quest state
const rangerXP = { totalXPEarned: 15000, questsCompleted: 100 };

// Build wallet entry
const wallet = {
  ...existing,
  address: ADDR,
  coins: 100000,
  score: 1200,
  tier: 'S',
  source: 'admin',
  firstSeenAt: existing.firstSeenAt || now,
  lastSeenAt: now,
  scanCount: 50,
  socialStats: { challengesWon: 200, constellationExplored: 50, compareCount: 100 },
  _completedTextQuests: Object.fromEntries(QUEST_IDS.map(q => [q, Date.now()])),
  userData: {
    loadout,
    gameStats,
    bestScores,
    textQuests,
    rangerXP,
    achievements,
    arenaStats: { wins: 200, losses: 10, draws: 5 },
    lastSyncAt: now
  }
};

// Update database
if (typeof parsed.wallets !== 'object' || parsed.wallets === null) {
  parsed.wallets = {};
}
parsed.wallets[ADDR] = wallet;
parsed.updatedAt = now;

// Write atomically
const tmp = DB_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2));
fs.renameSync(tmp, DB_FILE);

console.log('Done! Wallet entry created/updated:');
console.log('  Address:', ADDR);
console.log('  Coins:', wallet.coins);
console.log('  Score:', wallet.score);
console.log('  Tier:', wallet.tier);
console.log('  Owned items:', ownedItems.length);
console.log('  Modules:', ALL_MODULES.length);
console.log('  Text quests completed:', QUEST_IDS.length);
console.log('  Challenge wins:', wallet.socialStats.challengesWon);
console.log('  Achievements:', Object.keys(achievements).length);
console.log('');
console.log('XP breakdown (approx):');
console.log('  Game scores: ~6000 (orbit 600*5=3000 cap2000 + defender 2000*1.5=3000 cap2000 + gravity 600*5=3000 cap2000)');
console.log('  Game volume: ~4500 (200 games × 5 × 3 modes + survival time + kills)');
console.log('  Achievements: ~6200 (31 × 200)');
console.log('  Arena wins: 60000 (200 × 300)');
console.log('  Quest XP: 15000');
console.log('  Text quests: 8000 (16 × 500)');
console.log('  Coins: 1000 (100000/200 cap 1000)');
console.log('  TOTAL: ~100000+ XP → Legend rank');
console.log('');
console.log('NOTE: Restart the server to reload the database.');
