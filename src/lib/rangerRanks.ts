/**
 * Ranger Ranks — XP-based progression system inspired by Space Rangers 2.
 * XP is computed from existing activity data (not stored separately).
 */

// ── Types ──

export interface RangerRank {
  id: string;
  name: string;
  minXP: number;
  icon: string;
  color: string;
  perks: string[];
}

// ── Rank Definitions ──

export const RANGER_RANKS: RangerRank[] = [
  { id: 'cadet',   name: 'Cadet',   minXP: 0,     icon: '🔰', color: 'text-gray-400',   perks: [] },
  { id: 'pilot',   name: 'Pilot',   minXP: 500,   icon: '✈️',  color: 'text-blue-400',   perks: ['Unlock text quests'] },
  { id: 'captain', name: 'Captain', minXP: 2000,  icon: '⭐',  color: 'text-yellow-400', perks: ['Yellow module slots'] },
  { id: 'ace',     name: 'Ace',     minXP: 5000,  icon: '💫',  color: 'text-purple-400', perks: ['Red module slots'] },
  { id: 'legend',  name: 'Legend',  minXP: 15000, icon: '👑',  color: 'text-amber-400',  perks: ['Exclusive title frame'] },
];

// ── XP Sources (computed from existing data) ──

export interface RangerXPSources {
  compositeScore?: number;
  gameBestScores?: Record<string, number>; // mode → best score
  totalCoins?: number;
  completedQuests?: number;
  completedTextQuests?: number;
  challengeWins?: number;
  achievementCount?: number;
}

export function computeRangerXP(sources: RangerXPSources): number {
  let xp = 0;

  // Composite score: ×2
  if (sources.compositeScore) {
    xp += sources.compositeScore * 2;
  }

  // Games: best score × 10 per mode
  if (sources.gameBestScores) {
    for (const score of Object.values(sources.gameBestScores)) {
      xp += (score || 0) * 10;
    }
  }

  // Mining: totalCoins / 100
  if (sources.totalCoins) {
    xp += Math.floor(sources.totalCoins / 100);
  }

  // Quests completed: ×50
  if (sources.completedQuests) {
    xp += sources.completedQuests * 50;
  }

  // Text quests: ×200
  if (sources.completedTextQuests) {
    xp += sources.completedTextQuests * 200;
  }

  // Challenge wins: ×100
  if (sources.challengeWins) {
    xp += sources.challengeWins * 100;
  }

  // Achievements: ×30
  if (sources.achievementCount) {
    xp += sources.achievementCount * 30;
  }

  return Math.floor(xp);
}

export function getRangerRank(xp: number): RangerRank {
  let rank = RANGER_RANKS[0];
  for (const r of RANGER_RANKS) {
    if (xp >= r.minXP) rank = r;
  }
  return rank;
}

export function getNextRank(xp: number): { rank: RangerRank; xpNeeded: number } | null {
  const current = getRangerRank(xp);
  const idx = RANGER_RANKS.indexOf(current);
  if (idx >= RANGER_RANKS.length - 1) return null;
  const next = RANGER_RANKS[idx + 1];
  return { rank: next, xpNeeded: next.minXP - xp };
}

export function getRankProgress(xp: number): number {
  const current = getRangerRank(xp);
  const idx = RANGER_RANKS.indexOf(current);
  if (idx >= RANGER_RANKS.length - 1) return 1;
  const next = RANGER_RANKS[idx + 1];
  const range = next.minXP - current.minXP;
  if (range <= 0) return 1;
  return Math.min(1, Math.max(0, (xp - current.minXP) / range));
}

/**
 * Gather XP sources from localStorage for a given wallet address.
 * This reads from the same keys used by other systems.
 */
export function gatherXPSources(address: string): RangerXPSources {
  const sources: RangerXPSources = {};

  try {
    // Composite score (cached by useCompositeScore in sessionStorage)
    const scoreRaw = sessionStorage.getItem(`ip_composite_v2_${address}`);
    if (scoreRaw) {
      const cached = JSON.parse(scoreRaw);
      sources.compositeScore = cached?.data?.score || 0;
    }

    // Game best scores
    const gameModes = ['orbit_survival', 'cosmic_defender', 'gravity_rush', 'cosmic_mine', 'cosmic_runner'];
    const bestScores: Record<string, number> = {};
    for (const mode of gameModes) {
      const raw = localStorage.getItem(`prism_league_best_${mode}_${address}`);
      if (raw) bestScores[mode] = parseInt(raw, 10) || 0;
    }
    if (Object.keys(bestScores).length > 0) sources.gameBestScores = bestScores;

    // Total coins
    const coinRaw = localStorage.getItem(`prism_balance_v1_${address}`);
    if (coinRaw) {
      const parsed = JSON.parse(coinRaw);
      sources.totalCoins = parsed?.totalEarned || 0;
    }

    // Quests completed
    const questRaw = localStorage.getItem(`prism_quests_v1_${address}`);
    if (questRaw) {
      const parsed = JSON.parse(questRaw);
      sources.completedQuests = parsed?.totalCompleted || 0;
    }

    // Text quests completed
    let textQuestCount = 0;
    const questIds = ['abandoned_station', 'pirate_ambush', 'dark_matter_anomaly'];
    for (const qid of questIds) {
      const raw = localStorage.getItem(`text_quest_v1_${address}_${qid}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.completed) textQuestCount++;
      }
    }
    sources.completedTextQuests = textQuestCount;

    // Challenge wins
    const arenaRaw = localStorage.getItem(`prism_arena_stats_${address}`);
    if (arenaRaw) {
      const parsed = JSON.parse(arenaRaw);
      sources.challengeWins = parsed?.wins || 0;
    }

    // Achievements
    let achCount = 0;
    const achKeys = ['orbit_survival_achievements_v1', 'cosmic_defender_achievements_v1', 'gravity_rush_achievements_v1'];
    for (const k of achKeys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) achCount += arr.filter((a: { unlocked?: boolean }) => a.unlocked).length;
      }
    }
    sources.achievementCount = achCount;
  } catch { /* ignore localStorage errors */ }

  return sources;
}
