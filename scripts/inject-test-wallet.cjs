/**
 * Inject full test profile for both DEV wallets — max rank, all items, max coins.
 * Usage: node scripts/inject-test-wallet.cjs
 *
 * Seeds are identical to src/lib/devWallet.ts DEV_SEEDS.
 */
const fs = require('fs');
const path = require('path');
const { Keypair } = require('@solana/web3.js');

// Mirrors DEV_SEEDS from src/lib/devWallet.ts exactly
const DEV_SEEDS = [
  // Wallet 1 (original)
  new Uint8Array([
    108, 59, 172, 133, 209, 215, 233, 105, 121, 162, 83, 253, 173, 32, 206, 172, 114, 100, 33, 38, 42, 153, 123, 150,
    240, 200, 209, 88, 196, 188, 154, 62,
  ]),
  // Wallet 2
  new Uint8Array([
    108, 200, 45, 12, 187, 33, 99, 156, 78, 201, 144, 55, 233, 67, 189, 23, 90, 178, 134, 211, 56, 145, 77, 198, 123,
    34, 167, 89, 245, 100, 156, 43,
  ]),
];

const addrs = DEV_SEEDS.map(s => Keypair.fromSeed(s).publicKey.toBase58());

const DB_FILE = path.join(__dirname, '..', 'metadata', 'wallet-database.json');

const raw = fs.readFileSync(DB_FILE, 'utf8');
const parsed = JSON.parse(raw);

if (typeof parsed.wallets !== 'object' || parsed.wallets === null) {
  parsed.wallets = {};
}

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

// Arena stats per wallet: W1 strong, W2 weaker
const ARENA_STATS = [
  { wins: 200, losses: 10, draws: 5 },   // addr[0] W1 — ranking-dominant
  { wins: 50, losses: 100, draws: 5 },   // addr[1] W2 — weaker opponent
];

for (let i = 0; i < addrs.length; i++) {
  const ADDR = addrs[i];
  const existing = parsed.wallets[ADDR] || {};

  const ownedItems = ALL_ITEMS.map(id => ({ itemId: id, purchasedAt: now, equipped: false }));

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

  const textQuests = {};
  for (const qid of QUEST_IDS) {
    textQuests[qid] = { questId: qid, completed: true, currentNodeId: 'end', reward: { coins: 100 }, completedAt: now };
  }

  const gameStats = {
    orbit_survival_stats_v1: { gamesPlayed: 200, totalSurvivalTime: 50000, bestTime: 600 },
    cosmic_defender_stats_v1: { gamesPlayed: 200, totalKills: 10000, bestScore: 2000 },
    gravity_rush_stats_v1: { gamesPlayed: 200, totalSurvivalTime: 50000, totalTime: 50000, bestTime: 600 }
  };

  const bestScores = {};
  bestScores['prism_league_best_orbit_survival_' + ADDR] = 600;
  bestScores['prism_league_best_cosmic_defender_' + ADDR] = 2000;
  bestScores['prism_league_best_gravity_rush_' + ADDR] = 600;

  const achievements = {};
  for (const a of [...ORBIT_ACHIEVEMENTS, ...DEFENDER_ACHIEVEMENTS]) {
    achievements[a] = { id: a, unlocked: true, unlockedAt: now, claimed: true, claimedAt: now };
  }

  const rangerXP = { totalXPEarned: 15000, questsCompleted: 100 };

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
      arenaStats: ARENA_STATS[i],
      lastSyncAt: now
    }
  };

  parsed.wallets[ADDR] = wallet;
}

parsed.updatedAt = now;

// Write atomically
const tmp = DB_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2));
fs.renameSync(tmp, DB_FILE);

console.log('Done! Seeded 2 dev wallets:');
for (let i = 0; i < addrs.length; i++) {
  const w = parsed.wallets[addrs[i]];
  console.log(`\n  [W${i + 1}] ${addrs[i]}`);
  console.log(`    Coins: ${w.coins}, Score: ${w.score}, Tier: ${w.tier}`);
  console.log(`    Arena: ${w.userData.arenaStats.wins}W / ${w.userData.arenaStats.losses}L / ${w.userData.arenaStats.draws}D`);
  console.log(`    Items: ${w.userData.loadout.ownedItems.length}, Quests: ${QUEST_IDS.length}, Achievements: ${Object.keys(w.userData.achievements).length}`);
}
console.log('\nNOTE: Restart the server to reload the database.');
