/**
 * Achievement system for Territory Control mode.
 */

export interface TerritoryAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  threshold: number;
  thresholdType: 'zones_captured' | 'survival_time' | 'zones_defended' | 'simultaneous_zones' | 'best_score';
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
  unlocked: boolean;
  unlockedAt?: string;
  claimed: boolean;
  claimedAt?: string;
}

export const TERRITORY_COIN_REWARDS: Record<string, number> = {
  bronze: 50,
  silver: 150,
  gold: 400,
  diamond: 1000,
};

const ACHIEVEMENTS_KEY = 'territory_control_achievements_v1';
const STATS_KEY = 'territory_control_stats_v1';

export interface TerritoryStats {
  gamesPlayed: number;
  totalZonesCaptured: number;
  totalZonesDefended: number;
  bestSimultaneousZones: number;
  bestSurvivalTime: number;
  bestScore: number;
  lastPlayed: string;
}

export const TERRITORY_ACHIEVEMENT_DEFS: Omit<TerritoryAchievement, 'unlocked' | 'unlockedAt' | 'claimed' | 'claimedAt'>[] = [
  { id: 'terr_first_capture', name: 'First Claim', description: 'Capture 1 zone', icon: '🏴', image: '', threshold: 1, thresholdType: 'zones_captured', tier: 'bronze' },
  { id: 'terr_explorer', name: 'Territory Explorer', description: 'Capture 5 zones total', icon: '🗺️', image: '', threshold: 5, thresholdType: 'zones_captured', tier: 'bronze' },
  { id: 'terr_holder_30', name: 'Zone Holder', description: 'Hold 3 zones simultaneously', icon: '🏰', image: '', threshold: 3, thresholdType: 'simultaneous_zones', tier: 'silver' },
  { id: 'terr_survivor_60', name: 'Territory Survivor', description: 'Survive 60 seconds', icon: '⏱️', image: '', threshold: 60, thresholdType: 'survival_time', tier: 'silver' },
  { id: 'terr_defender', name: 'Zone Defender', description: 'Defend 20 zones from asteroids', icon: '🛡️', image: '', threshold: 20, thresholdType: 'zones_defended', tier: 'gold' },
  { id: 'terr_dominator', name: 'Dominator', description: 'Hold all zones simultaneously', icon: '👑', image: '', threshold: 5, thresholdType: 'simultaneous_zones', tier: 'gold' },
  { id: 'terr_survivor_120', name: 'Territory Veteran', description: 'Survive 120 seconds', icon: '🎖️', image: '', threshold: 120, thresholdType: 'survival_time', tier: 'gold' },
  { id: 'terr_survivor_300', name: 'Territory Legend', description: 'Survive 300 seconds', icon: '🌟', image: '', threshold: 300, thresholdType: 'survival_time', tier: 'diamond' },
  { id: 'terr_supreme', name: 'Supreme Commander', description: 'Score 3000+', icon: '🏆', image: '', threshold: 3000, thresholdType: 'best_score', tier: 'diamond' },
];

export function getTerritoryStats(): TerritoryStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return { gamesPlayed: 0, totalZonesCaptured: 0, totalZonesDefended: 0, bestSimultaneousZones: 0, bestSurvivalTime: 0, bestScore: 0, lastPlayed: '' };
}

function saveStats(stats: TerritoryStats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* */ }
}

export function updateTerritoryStats(survivalTime: number, score: number, zonesCaptured: number, zonesDefended: number, maxSimultaneous: number): TerritoryStats {
  const stats = getTerritoryStats();
  stats.gamesPlayed++;
  stats.totalZonesCaptured += zonesCaptured;
  stats.totalZonesDefended += zonesDefended;
  if (maxSimultaneous > stats.bestSimultaneousZones) stats.bestSimultaneousZones = maxSimultaneous;
  if (survivalTime > stats.bestSurvivalTime) stats.bestSurvivalTime = survivalTime;
  if (score > stats.bestScore) stats.bestScore = score;
  stats.lastPlayed = new Date().toISOString();
  saveStats(stats);
  return stats;
}

export function getTerritoryAchievements(): TerritoryAchievement[] {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return TERRITORY_ACHIEVEMENT_DEFS.map(d => ({ ...d, unlocked: false, claimed: false }));
}

function saveAchievements(achievements: TerritoryAchievement[]) {
  try { localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(achievements)); } catch { /* */ }
}

export function checkTerritoryAchievements(stats: TerritoryStats, sessionTime: number, sessionScore: number, sessionCaptures: number, sessionSimultaneous: number): string[] {
  const achievements = getTerritoryAchievements();
  const newlyUnlocked: string[] = [];
  for (const ach of achievements) {
    if (ach.unlocked) continue;
    let met = false;
    switch (ach.thresholdType) {
      case 'zones_captured': met = stats.totalZonesCaptured >= ach.threshold; break;
      case 'survival_time': met = sessionTime >= ach.threshold; break;
      case 'zones_defended': met = stats.totalZonesDefended >= ach.threshold; break;
      case 'simultaneous_zones': met = sessionSimultaneous >= ach.threshold || stats.bestSimultaneousZones >= ach.threshold; break;
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

export function getTerritoryAchievementProgress(stats: TerritoryStats): Record<string, { current: number; target: number }> {
  const progress: Record<string, { current: number; target: number }> = {};
  for (const def of TERRITORY_ACHIEVEMENT_DEFS) {
    let current = 0;
    switch (def.thresholdType) {
      case 'zones_captured': current = stats.totalZonesCaptured; break;
      case 'survival_time': current = stats.bestSurvivalTime; break;
      case 'zones_defended': current = stats.totalZonesDefended; break;
      case 'simultaneous_zones': current = stats.bestSimultaneousZones; break;
      case 'best_score': current = stats.bestScore; break;
    }
    progress[def.id] = { current, target: def.threshold };
  }
  return progress;
}

export function claimTerritoryReward(achievementId: string): boolean {
  const achievements = getTerritoryAchievements();
  const ach = achievements.find(a => a.id === achievementId);
  if (!ach || !ach.unlocked || ach.claimed) return false;
  ach.claimed = true;
  ach.claimedAt = new Date().toISOString();
  saveAchievements(achievements);
  return true;
}
