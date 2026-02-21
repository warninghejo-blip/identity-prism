/**
 * Achievement system for Cosmic Defender (level-based).
 * User will provide custom images later — placeholders used for now.
 */

export interface DefenderAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  threshold: number;
  thresholdType: 'level_reached' | 'games_played' | 'total_kills';
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
  unlocked: boolean;
  unlockedAt?: string;
  claimed: boolean;
  claimedAt?: string;
}

export const DEFENDER_COIN_REWARDS: Record<string, number> = {
  bronze: 20,
  silver: 50,
  gold: 100,
  diamond: 200,
};

const ACHIEVEMENTS_KEY = 'cosmic_defender_achievements_v1';
const STATS_KEY = 'cosmic_defender_stats_v1';

export interface DefenderStats {
  gamesPlayed: number;
  bestLevel: number;
  bestScore: number;
  totalKills: number;
  lastPlayed: string;
}

export const DEFENDER_ACHIEVEMENT_DEFS: Omit<DefenderAchievement, 'unlocked' | 'unlockedAt' | 'claimed' | 'claimedAt'>[] = [
  {
    id: 'def_first_blood',
    name: 'First Blood',
    description: 'Complete Level 1',
    icon: '⚔️',
    image: '/achievements/def_first_blood.png',
    threshold: 1,
    thresholdType: 'level_reached',
    tier: 'bronze',
  },
  {
    id: 'def_frontline',
    name: 'Frontline',
    description: 'Complete Level 3',
    icon: '🛡️',
    image: '/achievements/def_frontline.png',
    threshold: 3,
    thresholdType: 'level_reached',
    tier: 'bronze',
  },
  {
    id: 'def_commander',
    name: 'Commander',
    description: 'Complete Level 5',
    icon: '🎖️',
    image: '/achievements/def_commander.png',
    threshold: 5,
    thresholdType: 'level_reached',
    tier: 'silver',
  },
  {
    id: 'def_war_hero',
    name: 'War Hero',
    description: 'Complete Level 7',
    icon: '⭐',
    image: '/achievements/def_war_hero.png',
    threshold: 7,
    thresholdType: 'level_reached',
    tier: 'silver',
  },
  {
    id: 'def_galactic_defender',
    name: 'Galactic Defender',
    description: 'Complete Level 9',
    icon: '🏆',
    image: '/achievements/def_galactic_defender.png',
    threshold: 9,
    thresholdType: 'level_reached',
    tier: 'gold',
  },
  {
    id: 'def_legend',
    name: 'Cosmic Legend',
    description: 'Complete all 9 levels in one run',
    icon: '💎',
    image: '/achievements/def_legend.png',
    threshold: 9,
    thresholdType: 'level_reached',
    tier: 'diamond',
  },
  {
    id: 'def_recruit',
    name: 'Recruit',
    description: 'Play 10 Defender games',
    icon: '🔁',
    image: '/achievements/def_recruit.png',
    threshold: 10,
    thresholdType: 'games_played',
    tier: 'bronze',
  },
  {
    id: 'def_veteran',
    name: 'Veteran Pilot',
    description: 'Play 50 Defender games',
    icon: '🎯',
    image: '/achievements/def_veteran.png',
    threshold: 50,
    thresholdType: 'games_played',
    tier: 'silver',
  },
  {
    id: 'def_exterminator',
    name: 'Exterminator',
    description: 'Destroy 500 enemies total',
    icon: '💀',
    image: '/achievements/def_exterminator.png',
    threshold: 500,
    thresholdType: 'total_kills',
    tier: 'gold',
  },
];

export function getDefenderStats(): DefenderStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { gamesPlayed: 0, bestLevel: 0, bestScore: 0, totalKills: 0, lastPlayed: '' };
    return JSON.parse(raw) as DefenderStats;
  } catch {
    return { gamesPlayed: 0, bestLevel: 0, bestScore: 0, totalKills: 0, lastPlayed: '' };
  }
}

export function updateDefenderStats(score: number, levelReached: number, kills: number): DefenderStats {
  const stats = getDefenderStats();
  stats.gamesPlayed += 1;
  stats.bestScore = Math.max(stats.bestScore, score);
  stats.bestLevel = Math.max(stats.bestLevel, levelReached);
  stats.totalKills += kills;
  stats.lastPlayed = new Date().toISOString();
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch { /* */ }
  return stats;
}

export function getDefenderAchievements(): DefenderAchievement[] {
  let stored: Partial<DefenderAchievement>[] = [];
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<DefenderAchievement>[];
  } catch { /* */ }
  return DEFENDER_ACHIEVEMENT_DEFS.map((def) => {
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

function saveDefenderAchievements(achievements: DefenderAchievement[]) {
  try {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(achievements));
  } catch { /* */ }
}

export function checkDefenderAchievements(score: number, levelReached: number): { newlyUnlocked: DefenderAchievement[]; all: DefenderAchievement[] } {
  const stats = getDefenderStats();
  const achievements = getDefenderAchievements();
  const newlyUnlocked: DefenderAchievement[] = [];

  for (const ach of achievements) {
    if (ach.unlocked) continue;

    let met = false;
    switch (ach.thresholdType) {
      case 'level_reached':
        met = stats.bestLevel >= ach.threshold;
        break;
      case 'games_played':
        met = stats.gamesPlayed >= ach.threshold;
        break;
      case 'total_kills':
        met = stats.totalKills >= ach.threshold;
        break;
    }

    if (met) {
      ach.unlocked = true;
      ach.unlockedAt = new Date().toISOString();
      newlyUnlocked.push(ach);
    }
  }

  if (newlyUnlocked.length > 0) {
    saveDefenderAchievements(achievements);
  }

  return { newlyUnlocked, all: achievements };
}

export function claimDefenderReward(achievementId: string): { reward: number; all: DefenderAchievement[] } {
  const achievements = getDefenderAchievements();
  const ach = achievements.find((a) => a.id === achievementId);
  if (!ach || !ach.unlocked || ach.claimed) return { reward: 0, all: achievements };
  ach.claimed = true;
  ach.claimedAt = new Date().toISOString();
  saveDefenderAchievements(achievements);
  return { reward: DEFENDER_COIN_REWARDS[ach.tier] ?? 0, all: achievements };
}

export function getDefenderAchievementProgress(achievement: DefenderAchievement): number {
  const stats = getDefenderStats();
  switch (achievement.thresholdType) {
    case 'level_reached':
      return Math.min(1, stats.bestLevel / achievement.threshold);
    case 'games_played':
      return Math.min(1, stats.gamesPlayed / achievement.threshold);
    case 'total_kills':
      return Math.min(1, stats.totalKills / achievement.threshold);
    default:
      return 0;
  }
}
