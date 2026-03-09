/**
 * Achievement system for Asteroid Mining mode.
 */

export interface MiningAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  threshold: number;
  thresholdType: 'asteroids_mined' | 'survival_time' | 'dark_matter' | 'session_coins' | 'pirates_destroyed' | 'best_score';
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
  unlocked: boolean;
  unlockedAt?: string;
  claimed: boolean;
  claimedAt?: string;
}

export const MINING_COIN_REWARDS: Record<string, number> = {
  bronze: 50,
  silver: 150,
  gold: 400,
  diamond: 1000,
};

const ACHIEVEMENTS_KEY = 'asteroid_mining_achievements_v1';
const STATS_KEY = 'asteroid_mining_stats_v1';

export interface MiningStats {
  gamesPlayed: number;
  totalAsteroidsMined: number;
  totalDarkMatter: number;
  totalPiratesDestroyed: number;
  bestSessionCoins: number;
  bestSurvivalTime: number;
  bestScore: number;
  lastPlayed: string;
}

export const MINING_ACHIEVEMENT_DEFS: Omit<MiningAchievement, 'unlocked' | 'unlockedAt' | 'claimed' | 'claimedAt'>[] = [
  { id: 'mine_first_ore', name: 'First Ore', description: 'Mine 1 asteroid', icon: '⛏️', image: '/achievements/mine_first_ore.png', threshold: 1, thresholdType: 'asteroids_mined', tier: 'bronze' },
  { id: 'mine_prospector', name: 'Prospector', description: 'Mine 50 asteroids total', icon: '🔍', image: '/achievements/mine_prospector.png', threshold: 50, thresholdType: 'asteroids_mined', tier: 'bronze' },
  { id: 'mine_gold_rush', name: 'Gold Rush', description: 'Mine 10 gold asteroids in 1 session', icon: '💰', image: '/achievements/mine_gold_rush.png', threshold: 200, thresholdType: 'session_coins', tier: 'silver' },
  { id: 'mine_survivor', name: 'Mining Survivor', description: 'Survive 120 seconds', icon: '⏱️', image: '/achievements/mine_survivor.png', threshold: 120, thresholdType: 'survival_time', tier: 'silver' },
  { id: 'mine_dark_matter', name: 'Dark Matter Collector', description: 'Mine 5 dark matter total', icon: '🌑', image: '/achievements/mine_dark_matter.png', threshold: 5, thresholdType: 'dark_matter', tier: 'gold' },
  { id: 'mine_efficient', name: 'Efficient Miner', description: '500+ coins in 1 session', icon: '💎', image: '/achievements/mine_efficient.png', threshold: 500, thresholdType: 'session_coins', tier: 'gold' },
  { id: 'mine_pirate_slayer', name: 'Pirate Slayer', description: 'Destroy 30 pirate drones total', icon: '🏴‍☠️', image: '/achievements/mine_pirate_slayer.png', threshold: 30, thresholdType: 'pirates_destroyed', tier: 'gold' },
  { id: 'mine_tycoon', name: 'Mining Tycoon', description: '1000+ coins in 1 session', icon: '👑', image: '/achievements/mine_tycoon.png', threshold: 1000, thresholdType: 'session_coins', tier: 'diamond' },
  { id: 'mine_deep_space', name: 'Deep Space Miner', description: 'Survive 300 seconds', icon: '🌌', image: '/achievements/mine_deep_space.png', threshold: 300, thresholdType: 'survival_time', tier: 'diamond' },
];

export function getMiningStats(): MiningStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return { gamesPlayed: 0, totalAsteroidsMined: 0, totalDarkMatter: 0, totalPiratesDestroyed: 0, bestSessionCoins: 0, bestSurvivalTime: 0, bestScore: 0, lastPlayed: '' };
}

function saveStats(stats: MiningStats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* */ }
}

export function updateMiningStats(survivalTime: number, score: number, sessionCoins: number, asteroidsMined: number, darkMatter: number, piratesDestroyed: number): MiningStats {
  const stats = getMiningStats();
  stats.gamesPlayed++;
  stats.totalAsteroidsMined += asteroidsMined;
  stats.totalDarkMatter += darkMatter;
  stats.totalPiratesDestroyed += piratesDestroyed;
  if (sessionCoins > stats.bestSessionCoins) stats.bestSessionCoins = sessionCoins;
  if (survivalTime > stats.bestSurvivalTime) stats.bestSurvivalTime = survivalTime;
  if (score > stats.bestScore) stats.bestScore = score;
  stats.lastPlayed = new Date().toISOString();
  saveStats(stats);
  return stats;
}

export function getMiningAchievements(): MiningAchievement[] {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return MINING_ACHIEVEMENT_DEFS.map(d => ({ ...d, unlocked: false, claimed: false }));
}

function saveAchievements(achievements: MiningAchievement[]) {
  try { localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(achievements)); } catch { /* */ }
}

export function checkMiningAchievements(stats: MiningStats, sessionTime: number, sessionCoins: number): string[] {
  const achievements = getMiningAchievements();
  const newlyUnlocked: string[] = [];
  for (const ach of achievements) {
    if (ach.unlocked) continue;
    let met = false;
    switch (ach.thresholdType) {
      case 'asteroids_mined': met = stats.totalAsteroidsMined >= ach.threshold; break;
      case 'survival_time': met = sessionTime >= ach.threshold; break;
      case 'dark_matter': met = stats.totalDarkMatter >= ach.threshold; break;
      case 'session_coins': met = sessionCoins >= ach.threshold; break;
      case 'pirates_destroyed': met = stats.totalPiratesDestroyed >= ach.threshold; break;
      case 'best_score': met = stats.bestScore >= ach.threshold; break;
    }
    if (met) {
      ach.unlocked = true;
      ach.unlockedAt = new Date().toISOString();
      newlyUnlocked.push(ach.id);
    }
  }
  if (newlyUnlocked.length > 0) saveAchievements(achievements);
  return newlyUnlocked;
}

export function getMiningAchievementProgress(stats: MiningStats): Record<string, { current: number; target: number }> {
  const progress: Record<string, { current: number; target: number }> = {};
  for (const def of MINING_ACHIEVEMENT_DEFS) {
    let current = 0;
    switch (def.thresholdType) {
      case 'asteroids_mined': current = stats.totalAsteroidsMined; break;
      case 'survival_time': current = stats.bestSurvivalTime; break;
      case 'dark_matter': current = stats.totalDarkMatter; break;
      case 'session_coins': current = stats.bestSessionCoins; break;
      case 'pirates_destroyed': current = stats.totalPiratesDestroyed; break;
      case 'best_score': current = stats.bestScore; break;
    }
    progress[def.id] = { current, target: def.threshold };
  }
  return progress;
}

export function claimMiningReward(achievementId: string): boolean {
  const achievements = getMiningAchievements();
  const ach = achievements.find(a => a.id === achievementId);
  if (!ach || !ach.unlocked || ach.claimed) return false;
  ach.claimed = true;
  ach.claimedAt = new Date().toISOString();
  saveAchievements(achievements);
  return true;
}
