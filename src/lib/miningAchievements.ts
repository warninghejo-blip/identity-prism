/**
 * Achievement system for Cosmic Mine idle clicker mode.
 */

export interface MiningAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  threshold: number;
  thresholdType: 'total_taps' | 'total_ore' | 'total_coins' | 'ore_per_sec' | 'upgrades_bought' | 'prestiges' | 'dark_matter_found' | 'active_time';
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

const ACHIEVEMENTS_KEY = 'cosmic_mine_achievements_v2';
const STATS_KEY = 'cosmic_mine_stats_v2';

export interface MiningStats {
  gamesPlayed: number;
  totalTaps: number;
  totalOre: number;
  totalCoins: number;
  totalDarkMatter: number;
  totalPrestiges: number;
  totalUpgradesBought: number;
  bestOrePerSec: number;
  totalActiveTime: number;
  bestScore: number;
  lastPlayed: string;
}

export const MINING_ACHIEVEMENT_DEFS: Omit<MiningAchievement, 'unlocked' | 'unlockedAt' | 'claimed' | 'claimedAt'>[] = [
  { id: 'mine_first_ore', name: 'First Ore', description: 'Mine 1 ore', icon: '⛏️', image: '/achievements/mine_first_ore.png', threshold: 1, thresholdType: 'total_taps', tier: 'bronze' },
  { id: 'mine_prospector', name: 'Prospector', description: 'Mine 10,000 ore total', icon: '🔍', image: '/achievements/mine_prospector.png', threshold: 10000, thresholdType: 'total_ore', tier: 'bronze' },
  { id: 'mine_gold_rush', name: 'Gold Rush', description: 'Earn 50,000 coins', icon: '💰', image: '/achievements/mine_gold_rush.png', threshold: 50000, thresholdType: 'total_coins', tier: 'silver' },
  { id: 'mine_survivor', name: 'Mining Veteran', description: 'Play 30 minutes total', icon: '⏱️', image: '/achievements/mine_survivor.png', threshold: 1800, thresholdType: 'active_time', tier: 'silver' },
  { id: 'mine_dark_matter', name: 'Dark Matter Hunter', description: 'Find 10 dark matter', icon: '🌑', image: '/achievements/mine_dark_matter.png', threshold: 10, thresholdType: 'dark_matter_found', tier: 'gold' },
  { id: 'mine_efficient', name: 'Efficient Miner', description: 'Reach 100 ore/sec', icon: '💎', image: '/achievements/mine_efficient.png', threshold: 100, thresholdType: 'ore_per_sec', tier: 'gold' },
  { id: 'mine_pirate_slayer', name: 'Upgrade Master', description: 'Buy all 10 upgrade types', icon: '🏴‍☠️', image: '/achievements/mine_pirate_slayer.png', threshold: 10, thresholdType: 'upgrades_bought', tier: 'gold' },
  { id: 'mine_tycoon', name: 'Mining Tycoon', description: 'Earn 1M coins lifetime', icon: '👑', image: '/achievements/mine_tycoon.png', threshold: 1000000, thresholdType: 'total_coins', tier: 'diamond' },
  { id: 'mine_deep_space', name: 'Warp Veteran', description: 'Prestige 3 times', icon: '🌌', image: '/achievements/mine_deep_space.png', threshold: 3, thresholdType: 'prestiges', tier: 'diamond' },
];

export function getMiningStats(): MiningStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return { gamesPlayed: 0, totalTaps: 0, totalOre: 0, totalCoins: 0, totalDarkMatter: 0, totalPrestiges: 0, totalUpgradesBought: 0, bestOrePerSec: 0, totalActiveTime: 0, bestScore: 0, lastPlayed: '' };
}

function saveStats(stats: MiningStats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* */ }
}

export function updateMiningStats(
  sessionTime: number, score: number, sessionCoins: number,
  taps: number, darkMatter: number, _piratesDestroyed: number,
  orePerSec?: number, upgradesBought?: number, prestiges?: number, totalOre?: number
): MiningStats {
  const stats = getMiningStats();
  stats.gamesPlayed++;
  stats.totalTaps += taps;
  stats.totalOre += (totalOre ?? 0);
  stats.totalCoins += sessionCoins;
  stats.totalDarkMatter += darkMatter;
  stats.totalActiveTime += sessionTime;
  if (orePerSec && orePerSec > stats.bestOrePerSec) stats.bestOrePerSec = orePerSec;
  if (upgradesBought && upgradesBought > stats.totalUpgradesBought) stats.totalUpgradesBought = upgradesBought;
  if (prestiges) stats.totalPrestiges += prestiges;
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

export function checkMiningAchievements(stats: MiningStats, _sessionTime: number, _sessionCoins: number): string[] {
  const achievements = getMiningAchievements();
  const newlyUnlocked: string[] = [];
  for (const ach of achievements) {
    if (ach.unlocked) continue;
    let met = false;
    switch (ach.thresholdType) {
      case 'total_taps': met = stats.totalTaps >= ach.threshold; break;
      case 'total_ore': met = stats.totalOre >= ach.threshold; break;
      case 'total_coins': met = stats.totalCoins >= ach.threshold; break;
      case 'ore_per_sec': met = stats.bestOrePerSec >= ach.threshold; break;
      case 'upgrades_bought': met = stats.totalUpgradesBought >= ach.threshold; break;
      case 'prestiges': met = stats.totalPrestiges >= ach.threshold; break;
      case 'dark_matter_found': met = stats.totalDarkMatter >= ach.threshold; break;
      case 'active_time': met = stats.totalActiveTime >= ach.threshold; break;
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
      case 'total_taps': current = stats.totalTaps; break;
      case 'total_ore': current = stats.totalOre; break;
      case 'total_coins': current = stats.totalCoins; break;
      case 'ore_per_sec': current = stats.bestOrePerSec; break;
      case 'upgrades_bought': current = stats.totalUpgradesBought; break;
      case 'prestiges': current = stats.totalPrestiges; break;
      case 'dark_matter_found': current = stats.totalDarkMatter; break;
      case 'active_time': current = stats.totalActiveTime; break;
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
