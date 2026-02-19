/**
 * Game achievement system for Orbit Survival.
 * Tracks milestones and can trigger cNFT minting for achievements.
 */

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  threshold: number;
  thresholdType: 'survival_time' | 'games_played' | 'total_time';
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
  unlocked: boolean;
  unlockedAt?: string;
  claimed: boolean;
  claimedAt?: string;
  mintTxSignature?: string;
}

export const ACHIEVEMENT_COIN_REWARDS: Record<string, number> = {
  bronze: 20,
  silver: 50,
  gold: 100,
  diamond: 200,
};

const ACHIEVEMENTS_KEY = 'orbit_survival_achievements_v1';
const STATS_KEY = 'orbit_survival_stats_v1';

export interface PlayerStats {
  gamesPlayed: number;
  totalSurvivalTime: number;
  bestScore: number;
  lastPlayed: string;
}

export const ACHIEVEMENT_DEFS: Omit<Achievement, 'unlocked' | 'unlockedAt' | 'mintTxSignature'>[] = [
  {
    id: 'first_orbit',
    name: 'First Orbit',
    description: 'Survive for 15 seconds',
    icon: '🌀',
    image: '/achievements/first_orbit.png',
    threshold: 15,
    thresholdType: 'survival_time',
    tier: 'bronze',
  },
  {
    id: 'space_cadet',
    name: 'Space Cadet',
    description: 'Survive for 30 seconds',
    icon: '🚀',
    image: '/achievements/space_cadet.png',
    threshold: 30,
    thresholdType: 'survival_time',
    tier: 'bronze',
  },
  {
    id: 'orbit_walker',
    name: 'Orbit Walker',
    description: 'Survive for 60 seconds',
    icon: '🛸',
    image: '/achievements/orbit_walker.png',
    threshold: 60,
    thresholdType: 'survival_time',
    tier: 'silver',
  },
  {
    id: 'cosmic_veteran',
    name: 'Cosmic Veteran',
    description: 'Survive for 2 minutes',
    icon: '⭐',
    image: '/achievements/cosmic_veteran.png',
    threshold: 120,
    thresholdType: 'survival_time',
    tier: 'silver',
  },
  {
    id: 'asteroid_dancer',
    name: 'Asteroid Dancer',
    description: 'Survive for 3 minutes',
    icon: '💫',
    image: '/achievements/asteroid_dancer.png',
    threshold: 180,
    thresholdType: 'survival_time',
    tier: 'gold',
  },
  {
    id: 'orbit_legend',
    name: 'Orbit Legend',
    description: 'Survive for 5 minutes',
    icon: '🏆',
    image: '/achievements/orbit_legend.png',
    threshold: 300,
    thresholdType: 'survival_time',
    tier: 'diamond',
  },
  {
    id: 'persistent_pilot',
    name: 'Persistent Pilot',
    description: 'Play 10 games',
    icon: '🔁',
    image: '/achievements/persistent_pilot.png',
    threshold: 10,
    thresholdType: 'games_played',
    tier: 'bronze',
  },
  {
    id: 'dedicated_captain',
    name: 'Dedicated Captain',
    description: 'Play 50 games',
    icon: '🎖️',
    image: '/achievements/dedicated_captain.png',
    threshold: 50,
    thresholdType: 'games_played',
    tier: 'silver',
  },
  {
    id: 'marathon_runner',
    name: 'Marathon Runner',
    description: 'Accumulate 30 minutes of total survival time',
    icon: '⏱️',
    image: '/achievements/marathon_runner.png',
    threshold: 1800,
    thresholdType: 'total_time',
    tier: 'gold',
  },
];

export function getPlayerStats(): PlayerStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { gamesPlayed: 0, totalSurvivalTime: 0, bestScore: 0, lastPlayed: '' };
    return JSON.parse(raw) as PlayerStats;
  } catch {
    return { gamesPlayed: 0, totalSurvivalTime: 0, bestScore: 0, lastPlayed: '' };
  }
}

export function updatePlayerStats(score: number): PlayerStats {
  const stats = getPlayerStats();
  stats.gamesPlayed += 1;
  stats.totalSurvivalTime += score;
  stats.bestScore = Math.max(stats.bestScore, score);
  stats.lastPlayed = new Date().toISOString();
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch { /* */ }
  return stats;
}

export function getAchievements(): Achievement[] {
  let stored: Partial<Achievement>[] = [];
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<Achievement>[];
  } catch { /* */ }
  return ACHIEVEMENT_DEFS.map((def) => {
    const saved = stored.find((s) => s.id === def.id);
    return {
      ...def,
      unlocked: saved?.unlocked ?? false,
      unlockedAt: saved?.unlockedAt,
      claimed: saved?.claimed ?? false,
      claimedAt: saved?.claimedAt,
      mintTxSignature: saved?.mintTxSignature,
    };
  });
}

function saveAchievements(achievements: Achievement[]) {
  try {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(achievements));
  } catch { /* */ }
}

/**
 * Check and unlock any newly earned achievements.
 * Returns an array of newly unlocked achievement IDs.
 */
export function checkAchievements(score: number): { newlyUnlocked: Achievement[]; all: Achievement[] } {
  const stats = getPlayerStats();
  const achievements = getAchievements();
  const newlyUnlocked: Achievement[] = [];

  for (const ach of achievements) {
    if (ach.unlocked) continue;

    let met = false;
    switch (ach.thresholdType) {
      case 'survival_time':
        met = score >= ach.threshold;
        break;
      case 'games_played':
        met = stats.gamesPlayed >= ach.threshold;
        break;
      case 'total_time':
        met = stats.totalSurvivalTime >= ach.threshold;
        break;
    }

    if (met) {
      ach.unlocked = true;
      ach.unlockedAt = new Date().toISOString();
      newlyUnlocked.push(ach);
    }
  }

  if (newlyUnlocked.length > 0) {
    saveAchievements(achievements);
  }

  return { newlyUnlocked, all: achievements };
}

/**
 * Claim an achievement reward. Returns the coin reward amount, or 0 if already claimed.
 */
export function claimAchievementReward(achievementId: string): { reward: number; all: Achievement[] } {
  const achievements = getAchievements();
  const ach = achievements.find((a) => a.id === achievementId);
  if (!ach || !ach.unlocked || ach.claimed) return { reward: 0, all: achievements };
  ach.claimed = true;
  ach.claimedAt = new Date().toISOString();
  saveAchievements(achievements);
  return { reward: ACHIEVEMENT_COIN_REWARDS[ach.tier] ?? 0, all: achievements };
}

export function getAchievementProgress(achievement: Achievement): number {
  const stats = getPlayerStats();
  switch (achievement.thresholdType) {
    case 'survival_time':
      return Math.min(1, stats.bestScore / achievement.threshold);
    case 'games_played':
      return Math.min(1, stats.gamesPlayed / achievement.threshold);
    case 'total_time':
      return Math.min(1, stats.totalSurvivalTime / achievement.threshold);
    default:
      return 0;
  }
}

export const TIER_COLORS: Record<string, string> = {
  bronze: '#cd7f32',
  silver: '#c0c0c0',
  gold: '#ffd700',
  diamond: '#b9f2ff',
};
