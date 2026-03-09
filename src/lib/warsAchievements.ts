/**
 * Achievement system for Gravity Wars mode.
 */

export interface WarsAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  threshold: number;
  thresholdType: 'impulse_waves' | 'survival_time' | 'asteroids_pushed' | 'chain_push' | 'best_score';
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
  unlocked: boolean;
  unlockedAt?: string;
  claimed: boolean;
  claimedAt?: string;
}

export const WARS_COIN_REWARDS: Record<string, number> = {
  bronze: 50,
  silver: 150,
  gold: 400,
  diamond: 1000,
};

const ACHIEVEMENTS_KEY = 'gravity_wars_achievements_v1';
const STATS_KEY = 'gravity_wars_stats_v1';

export interface WarsStats {
  gamesPlayed: number;
  totalImpulseWaves: number;
  totalAsteroidsPushed: number;
  bestChainPush: number;
  bestSurvivalTime: number;
  bestScore: number;
  lastPlayed: string;
}

export const WARS_ACHIEVEMENT_DEFS: Omit<WarsAchievement, 'unlocked' | 'unlockedAt' | 'claimed' | 'claimedAt'>[] = [
  { id: 'wars_first_wave', name: 'First Wave', description: 'Use impulse wave 1 time', icon: '🌊', image: '/achievements/wars_first_wave.png', threshold: 1, thresholdType: 'impulse_waves', tier: 'bronze' },
  { id: 'wars_wave_rider', name: 'Wave Rider', description: 'Use 50 impulse waves total', icon: '🏄', image: '/achievements/wars_wave_rider.png', threshold: 50, thresholdType: 'impulse_waves', tier: 'bronze' },
  { id: 'wars_survivor_30', name: 'War Survivor', description: 'Survive 30 seconds', icon: '⚔️', image: '/achievements/wars_survivor_30.png', threshold: 30, thresholdType: 'survival_time', tier: 'silver' },
  { id: 'wars_survivor_60', name: 'Battle Hardened', description: 'Survive 60 seconds', icon: '🛡️', image: '/achievements/wars_survivor_60.png', threshold: 60, thresholdType: 'survival_time', tier: 'silver' },
  { id: 'wars_deflector', name: 'Deflector', description: 'Push away 100 asteroids total', icon: '💨', image: '/achievements/wars_deflector.png', threshold: 100, thresholdType: 'asteroids_pushed', tier: 'gold' },
  { id: 'wars_survivor_120', name: 'War Veteran', description: 'Survive 120 seconds', icon: '🎖️', image: '/achievements/wars_survivor_120.png', threshold: 120, thresholdType: 'survival_time', tier: 'gold' },
  { id: 'wars_chain_master', name: 'Chain Reaction', description: 'Push 5 asteroids with 1 wave', icon: '⛓️', image: '/achievements/wars_chain_master.png', threshold: 5, thresholdType: 'chain_push', tier: 'gold' },
  { id: 'wars_survivor_300', name: 'War Legend', description: 'Survive 300 seconds', icon: '👑', image: '/achievements/wars_survivor_300.png', threshold: 300, thresholdType: 'survival_time', tier: 'diamond' },
  { id: 'wars_grandmaster', name: 'Grandmaster', description: 'Score 3000+', icon: '🏆', image: '/achievements/wars_grandmaster.png', threshold: 3000, thresholdType: 'best_score', tier: 'diamond' },
];

export function getWarsStats(): WarsStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return { gamesPlayed: 0, totalImpulseWaves: 0, totalAsteroidsPushed: 0, bestChainPush: 0, bestSurvivalTime: 0, bestScore: 0, lastPlayed: '' };
}

function saveStats(stats: WarsStats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* */ }
}

export function updateWarsStats(survivalTime: number, score: number, impulseWaves: number, asteroidsPushed: number, bestChain: number): WarsStats {
  const stats = getWarsStats();
  stats.gamesPlayed++;
  stats.totalImpulseWaves += impulseWaves;
  stats.totalAsteroidsPushed += asteroidsPushed;
  if (bestChain > stats.bestChainPush) stats.bestChainPush = bestChain;
  if (survivalTime > stats.bestSurvivalTime) stats.bestSurvivalTime = survivalTime;
  if (score > stats.bestScore) stats.bestScore = score;
  stats.lastPlayed = new Date().toISOString();
  saveStats(stats);
  return stats;
}

export function getWarsAchievements(): WarsAchievement[] {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return WARS_ACHIEVEMENT_DEFS.map(d => ({ ...d, unlocked: false, claimed: false }));
}

function saveAchievements(achievements: WarsAchievement[]) {
  try { localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(achievements)); } catch { /* */ }
}

export function checkWarsAchievements(stats: WarsStats, sessionWaves: number, sessionTime: number, sessionScore: number, sessionChain: number): string[] {
  const achievements = getWarsAchievements();
  const newlyUnlocked: string[] = [];
  for (const ach of achievements) {
    if (ach.unlocked) continue;
    let met = false;
    switch (ach.thresholdType) {
      case 'impulse_waves': met = stats.totalImpulseWaves >= ach.threshold; break;
      case 'survival_time': met = sessionTime >= ach.threshold; break;
      case 'asteroids_pushed': met = stats.totalAsteroidsPushed >= ach.threshold; break;
      case 'chain_push': met = sessionChain >= ach.threshold || stats.bestChainPush >= ach.threshold; break;
      case 'best_score': met = sessionScore >= ach.threshold; break;
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

export function getWarsAchievementProgress(stats: WarsStats): Record<string, { current: number; target: number }> {
  const progress: Record<string, { current: number; target: number }> = {};
  for (const def of WARS_ACHIEVEMENT_DEFS) {
    let current = 0;
    switch (def.thresholdType) {
      case 'impulse_waves': current = stats.totalImpulseWaves; break;
      case 'survival_time': current = stats.bestSurvivalTime; break;
      case 'asteroids_pushed': current = stats.totalAsteroidsPushed; break;
      case 'chain_push': current = stats.bestChainPush; break;
      case 'best_score': current = stats.bestScore; break;
    }
    progress[def.id] = { current, target: def.threshold };
  }
  return progress;
}

export function claimWarsReward(achievementId: string): boolean {
  const achievements = getWarsAchievements();
  const ach = achievements.find(a => a.id === achievementId);
  if (!ach || !ach.unlocked || ach.claimed) return false;
  ach.claimed = true;
  ach.claimedAt = new Date().toISOString();
  saveAchievements(achievements);
  return true;
}
