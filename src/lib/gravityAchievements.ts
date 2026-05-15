/**
 * Achievement system for Gravity Rush (survival/endless runner).
 * User will provide custom images later — placeholders used for now.
 */

export interface GravityAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  threshold: number;
  thresholdType:
    | 'survival_time'
    | 'columns_passed'
    | 'crystals_collected'
    | 'best_score'
    | 'total_play_time'
    | 'total_columns'
    | 'total_crystals';
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
  unlocked: boolean;
  unlockedAt?: string;
  claimed: boolean;
  claimedAt?: string;
}

export const GRAVITY_COIN_REWARDS: Record<string, number> = {
  bronze: 50,
  silver: 150,
  gold: 400,
  diamond: 1000,
};

const ACHIEVEMENTS_KEY = 'gravity_rush_achievements_v1';
const STATS_KEY = 'gravity_rush_stats_v1';

export interface GravityStats {
  gamesPlayed: number;
  bestSurvivalTime: number; // seconds
  bestScore: number;
  bestColumns: number;
  totalPlayTime: number; // seconds across all sessions
  totalColumns: number;
  totalCrystals: number;
  lastPlayed: string;
}

export const GRAVITY_ACHIEVEMENT_DEFS: Omit<GravityAchievement, 'unlocked' | 'unlockedAt' | 'claimed' | 'claimedAt'>[] =
  [
    {
      id: 'grav_first_flight',
      name: 'First Flight',
      description: 'Pass 15 columns in a single run',
      icon: '🕊️',
      image: '/achievements/grav_first_flight.png',
      threshold: 15,
      thresholdType: 'survival_time',
      tier: 'bronze',
    },
    {
      id: 'grav_smooth_pilot',
      name: 'Smooth Pilot',
      description: 'Pass 30 columns in a single run',
      icon: '🌀',
      image: '/achievements/grav_smooth_pilot.png',
      threshold: 30,
      thresholdType: 'columns_passed',
      tier: 'bronze',
    },
    {
      id: 'grav_gravity_walker',
      name: 'Gravity Walker',
      description: 'Pass 60 columns in a single run',
      icon: '🌊',
      image: '/achievements/grav_gravity_walker.png',
      threshold: 60,
      thresholdType: 'survival_time',
      tier: 'silver',
    },
    {
      id: 'grav_crystal_hunter',
      name: 'Crystal Hunter',
      description: 'Collect 100 crystals total',
      icon: '💠',
      image: '/achievements/grav_crystal_hunter.png',
      threshold: 100,
      thresholdType: 'total_crystals',
      tier: 'silver',
    },
    {
      id: 'grav_gravity_veteran',
      name: 'Gravity Veteran',
      description: 'Pass 120 columns in a single run',
      icon: '⚡',
      image: '/achievements/grav_gravity_veteran.png',
      threshold: 120,
      thresholdType: 'survival_time',
      tier: 'gold',
    },
    {
      id: 'grav_column_king',
      name: 'Column King',
      description: 'Pass 200 columns total across all runs',
      icon: '👑',
      image: '/achievements/grav_column_king.png',
      threshold: 200,
      thresholdType: 'total_columns',
      tier: 'gold',
    },
    {
      id: 'grav_marathon',
      name: 'Marathon Flyer',
      description: 'Accumulate 30 minutes of total play time',
      icon: '⏱️',
      image: '/achievements/grav_marathon.png',
      threshold: 1800, // 30 minutes in seconds
      thresholdType: 'total_play_time',
      tier: 'gold',
    },
    {
      id: 'grav_gravity_legend',
      name: 'Gravity Legend',
      description: 'Pass 300 columns in a single run',
      icon: '🌌',
      image: '/achievements/grav_gravity_legend.png',
      threshold: 300,
      thresholdType: 'survival_time',
      tier: 'diamond',
    },
    {
      id: 'grav_ace',
      name: 'Gravity Ace',
      description: 'Pass 180+ columns in a single run',
      icon: '💎',
      image: '/achievements/grav_ace.png',
      threshold: 180,
      thresholdType: 'survival_time',
      tier: 'diamond',
    },
  ];

export function getGravityStats(): GravityStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw)
      return {
        gamesPlayed: 0,
        bestSurvivalTime: 0,
        bestScore: 0,
        bestColumns: 0,
        totalPlayTime: 0,
        totalColumns: 0,
        totalCrystals: 0,
        lastPlayed: '',
      };
    return JSON.parse(raw) as GravityStats;
  } catch {
    return {
      gamesPlayed: 0,
      bestSurvivalTime: 0,
      bestScore: 0,
      bestColumns: 0,
      totalPlayTime: 0,
      totalColumns: 0,
      totalCrystals: 0,
      lastPlayed: '',
    };
  }
}

export function updateGravityStats(
  survivalTime: number,
  columns: number,
  crystals: number,
  score: number,
): GravityStats {
  const stats = getGravityStats();
  stats.gamesPlayed += 1;
  stats.bestSurvivalTime = Math.max(stats.bestSurvivalTime, survivalTime);
  stats.bestScore = Math.max(stats.bestScore, score);
  stats.bestColumns = Math.max(stats.bestColumns, columns);
  stats.totalPlayTime += survivalTime;
  stats.totalColumns += columns;
  stats.totalCrystals += crystals;
  stats.lastPlayed = new Date().toISOString();
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* */
  }
  import('@/lib/userDataSync')
    .then(({ syncToServer }) => {
      syncToServer({ gameStats: { [STATS_KEY]: stats } });
    })
    .catch(() => {});
  return stats;
}

export function getGravityAchievements(): GravityAchievement[] {
  let stored: Partial<GravityAchievement>[] = [];
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<GravityAchievement>[];
  } catch {
    /* */
  }
  return GRAVITY_ACHIEVEMENT_DEFS.map((def) => {
    const saved = stored.find((s) => s.id === def.id);
    return {
      ...def,
      unlocked: saved?.unlocked ?? false,
      unlockedAt: saved?.unlockedAt,
      claimed: saved?.claimed ?? false,
      claimedAt: saved?.claimedAt,
    };
  });
}

function saveGravityAchievements(achievements: GravityAchievement[]) {
  try {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(achievements));
  } catch {
    /* */
  }
}

export interface GravitySessionParams {
  survivalTime: number; // seconds survived this session
  columns: number; // columns passed this session
  crystals: number; // crystals collected this session
  score: number; // score this session
  totalPlayTime: number; // cumulative seconds across all sessions (after update)
  totalColumns: number; // cumulative columns across all sessions (after update)
  totalCrystals: number; // cumulative crystals across all sessions (after update)
}

export function checkGravityAchievements(params: GravitySessionParams): {
  newlyUnlocked: GravityAchievement[];
  all: GravityAchievement[];
} {
  const stats = getGravityStats();
  const achievements = getGravityAchievements();
  const newlyUnlocked: GravityAchievement[] = [];

  // Use the higher of passed session values vs stored stats so achievements
  // unlock even if stats haven't been persisted yet for the current game session
  const effectiveSurvivalTime = Math.max(params.survivalTime, stats.bestSurvivalTime);
  const effectiveBestScore = Math.max(params.score, stats.bestScore);
  const effectiveColumns = Math.max(params.columns, stats.bestColumns);
  const effectiveTotalPlayTime = Math.max(params.totalPlayTime, stats.totalPlayTime);
  const effectiveTotalColumns = Math.max(params.totalColumns, stats.totalColumns);
  const effectiveTotalCrystals = Math.max(params.totalCrystals, stats.totalCrystals);

  for (const ach of achievements) {
    if (ach.unlocked) continue;

    let met = false;
    switch (ach.thresholdType) {
      case 'survival_time':
        met = effectiveSurvivalTime >= ach.threshold;
        break;
      case 'columns_passed':
        met = effectiveColumns >= ach.threshold;
        break;
      case 'crystals_collected':
        met = effectiveTotalCrystals >= ach.threshold;
        break;
      case 'best_score':
        met = effectiveBestScore >= ach.threshold;
        break;
      case 'total_play_time':
        met = effectiveTotalPlayTime >= ach.threshold;
        break;
      case 'total_columns':
        met = effectiveTotalColumns >= ach.threshold;
        break;
      case 'total_crystals':
        met = effectiveTotalCrystals >= ach.threshold;
        break;
    }

    if (met) {
      ach.unlocked = true;
      ach.unlockedAt = new Date().toISOString();
      newlyUnlocked.push(ach);
    }
  }

  if (newlyUnlocked.length > 0) {
    saveGravityAchievements(achievements);
  }

  return { newlyUnlocked, all: achievements };
}

export function claimGravityReward(achievementId: string): { reward: number; all: GravityAchievement[] } {
  const achievements = getGravityAchievements();
  const ach = achievements.find((a) => a.id === achievementId);
  if (!ach || !ach.unlocked || ach.claimed) return { reward: 0, all: achievements };
  ach.claimed = true;
  ach.claimedAt = new Date().toISOString();
  saveGravityAchievements(achievements);
  return { reward: GRAVITY_COIN_REWARDS[ach.tier] ?? 0, all: achievements };
}

export function getGravityAchievementProgress(achievement: GravityAchievement): number {
  const stats = getGravityStats();
  switch (achievement.thresholdType) {
    case 'survival_time':
      return Math.min(1, stats.bestSurvivalTime / achievement.threshold);
    case 'columns_passed':
      return Math.min(1, stats.bestColumns / achievement.threshold);
    case 'crystals_collected':
      return Math.min(1, stats.totalCrystals / achievement.threshold);
    case 'best_score':
      return Math.min(1, stats.bestScore / achievement.threshold);
    case 'total_play_time':
      return Math.min(1, stats.totalPlayTime / achievement.threshold);
    case 'total_columns':
      return Math.min(1, stats.totalColumns / achievement.threshold);
    case 'total_crystals':
      return Math.min(1, stats.totalCrystals / achievement.threshold);
    default:
      return 0;
  }
}
