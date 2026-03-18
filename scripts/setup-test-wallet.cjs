/**
 * Set up full test wallet profile via admin API.
 * Usage: node scripts/setup-test-wallet.cjs
 */
const http = require('http');

const ADDR = 'D1mzmpBP5ZFG3Mrc1dTdbRdAYKV927zAUjzmdcnR2SFY';
const ADMIN_KEY = 'test_admin_key_2024';
const BASE = 'http://127.0.0.1:3000';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, BASE);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-Admin-Key': ADMIN_KEY,
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const now = new Date().toISOString();

const QUEST_IDS = [
  'abandoned_station','pirate_ambush','dark_matter_anomaly','prison_break',
  'dominator_factory','election_day','alien_zoo','smugglers_run',
  'wormhole_gambit','living_city','galactic_jackpot','jungle_survey',
  'plague_ship','fortress_heist','merc_contract','alien_embassy'
];

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

async function main() {
  // 1. Set coins
  console.log('Setting coins...');
  const coinRes = await post('/api/admin/set-coins', { address: ADDR, coins: 100000 });
  console.log('  Coins:', coinRes.status, coinRes.data);

  // 2. Set full wallet data
  console.log('Setting wallet data...');

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

  const achievementIds = [
    'first_orbit','minute_mark','three_minutes','five_minutes','ten_minutes','asteroid_dodger',
    'near_miss_master','combo_king','shield_master','perfect_orbit','survivor','veteran',
    'legend','marathon_runner','untouchable','coin_collector','big_spender','speed_demon',
    'zen_master','no_shield_run','point_hoarder',
    'first_blood','level_5','level_10','alien_slayer','boss_killer','marksman',
    'shield_breaker','combo_5','no_damage_level','speed_killer'
  ];
  const achievements = {};
  for (const a of achievementIds) {
    achievements[a] = { id: a, unlocked: true, unlockedAt: now, claimed: true, claimedAt: now };
  }

  const walletRes = await post('/api/admin/set-wallet', {
    address: ADDR,
    data: {
      score: 1200,
      tier: 'S',
      scanCount: 50,
      socialStats: { challengesWon: 200, constellationExplored: 50, compareCount: 100 },
      _completedTextQuests: Object.fromEntries(QUEST_IDS.map(q => [q, Date.now()])),
      userData: {
        loadout,
        gameStats,
        bestScores,
        textQuests,
        rangerXP: { totalXPEarned: 15000, questsCompleted: 100 },
        achievements,
        arenaStats: { wins: 200, losses: 10, draws: 5 },
        lastSyncAt: now
      }
    }
  });
  console.log('  Wallet:', walletRes.status, JSON.stringify(walletRes.data));

  if (walletRes.status === 200) {
    console.log('\n=== SUCCESS ===');
    console.log('Wallet:', ADDR);
    console.log('Coins: 100,000');
    console.log('Score: 1200 (S tier)');
    console.log('Rank: Legend (100k+ XP)');
    console.log('All 51 forge items owned');
    console.log('All 12 modules available');
    console.log('All 16 text quests completed');
    console.log('200 challenge wins');
    console.log('31 achievements unlocked + claimed');
    console.log('\nTo test: connect wallet in the app');
    console.log('Note: clear localStorage first for clean sync from server');
  }
}

main().catch(console.error);
