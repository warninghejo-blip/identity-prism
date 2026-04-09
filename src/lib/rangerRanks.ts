/**
 * Ranger Ranks — XP-based progression system.
 * XP is computed from game stats, achievements, and other activity.
 * Games are the PRIMARY source of XP (~70% at high ranks).
 * NOTE: Composite score is NOT included — it already powers ship stats.
 */

// ── Types ──

export interface RangerRank {
  id: string;
  name: string;
  minXP: number;
  icon: string;
  image: string;
  color: string;
  perks: string[];
}

// ── Rank Definitions ──
// Legend requires mastery across ALL systems — not achievable in days.

export const RANGER_RANKS: RangerRank[] = [
  {
    id: 'cadet',
    name: 'Cadet',
    minXP: 0,
    icon: '🔰',
    image: '/textures/ranks/rank_cadet.png',
    color: 'text-gray-400',
    perks: [],
  },
  {
    id: 'pilot',
    name: 'Pilot',
    minXP: 1500,
    icon: '✈️',
    image: '/textures/ranks/rank_pilot.png',
    color: 'text-blue-400',
    perks: ['Unlock text quests'],
  },
  {
    id: 'captain',
    name: 'Captain',
    minXP: 8000,
    icon: '⭐',
    image: '/textures/ranks/rank_captain.png',
    color: 'text-yellow-400',
    perks: ['Yellow module slots'],
  },
  {
    id: 'ace',
    name: 'Ace',
    minXP: 25000,
    icon: '💫',
    image: '/textures/ranks/rank_ace.png',
    color: 'text-purple-400',
    perks: ['Red module slots'],
  },
  {
    id: 'legend',
    name: 'Legend',
    minXP: 50000,
    icon: '👑',
    image: '/textures/ranks/rank_legend.png',
    color: 'text-amber-400',
    perks: ['Exclusive title frame'],
  },
];

/*
 * ── XP Budget (theoretical maximums) ──
 *
 * Games (primary):
 *   Best scores:  3 main modes × ~2000 cap = ~6,000
 *   Games played: 3 modes × 200 games × 5 (capped 1000 ea) = 3,000
 *   Total time:   2 survival × 500 + 1 defender kills 500 = 1,500
 *   Subtotal:     ~10,500
 *
 * Achievements:   27 × 200 = 5,400
 * Arena wins:     ×300 each (uncapped — primary Legend grind)
 * Quests (XP):    daily 135/day + weekly 650/week + one-time 1,725
 *   Monthly:      ~135×30 + 650×4 + 1,725 ≈ 8,375 first month, ~6,650/month after
 * Text quests:    16 × 500 = 8,000 (coins reward is separate)
 * Coins earned:   totalEarned / 200, cap 1,000
 *
 * NOT included: composite score (already powers ship stats via computeShipStats)
 *
 * To reach Legend (50,000):
 *   - Games: ~10.5k (scores + volume + time)
 *   - Achievements: 5.4k
 *   - Arena wins: ~56-80 wins × 300 = ~17-24k
 *   - Quests (~2 months): ~15k
 *   - Text quests: ~8k
 *   - Coins: ~1k
 *   Total ≈ 57-64k — Legend reachable in 1-3 months of dedicated play
 */

// ── XP Sources ──

export interface RangerXPSources {
  gameBestScores?: Record<string, number>;
  gameStats?: {
    orbit?: { gamesPlayed: number; totalSurvivalTime: number };
    defender?: { gamesPlayed: number; totalKills: number };
    gravity?: { gamesPlayed: number; totalTime: number };
  };
  totalCoins?: number;
  questXPEarned?: number; // total XP from regular quests (stored in quest state)
  completedTextQuests?: number; // count of completed text quests
  challengeWins?: number;
  achievementCount?: number;
  tournamentXP?: number; // XP earned from tournament placements
  arenaWeeklyXP?: number; // Weekly arena XP from server (socialStats.arenaWeeklyXP)
}

// Per-mode multipliers for best scores (different scoring scales)
const GAME_XP_CONFIG: Record<string, { mult: number; cap: number }> = {
  orbit_survival: { mult: 5, cap: 2000 }, // 300s best → 1500 XP, cap 2000
  cosmic_defender: { mult: 1.5, cap: 2000 }, // 1500 pts → 2250 → capped 2000
  gravity_rush: { mult: 5, cap: 2000 }, // 300s best → 1500 XP, cap 2000
  cosmic_mine: { mult: 3, cap: 1500 }, // less established mode
  cosmic_runner: { mult: 3, cap: 1500 }, // less established mode
};

export function computeRangerXP(sources: RangerXPSources): number {
  let xp = 0;

  // ── Games: Best Scores (primary) ──
  if (sources.gameBestScores) {
    for (const [mode, score] of Object.entries(sources.gameBestScores)) {
      const cfg = GAME_XP_CONFIG[mode] ?? { mult: 2, cap: 1000 };
      xp += Math.min(Math.floor((score || 0) * cfg.mult), cfg.cap);
    }
  }

  // ── Games: Volume (games played + time spent) ──
  if (sources.gameStats) {
    const gs = sources.gameStats;
    // Games played: 5 XP per game, encourages consistent play
    if (gs.orbit) xp += Math.min(gs.orbit.gamesPlayed * 5, 1000);
    if (gs.defender) xp += Math.min(gs.defender.gamesPlayed * 5, 1000);
    if (gs.gravity) xp += Math.min(gs.gravity.gamesPlayed * 5, 1000);
    // Total survival time: 1 XP per 10 seconds of cumulative play
    if (gs.orbit) xp += Math.min(Math.floor(gs.orbit.totalSurvivalTime / 10), 500);
    if (gs.gravity) xp += Math.min(Math.floor((gs.gravity.totalTime || 0) / 10), 500);
    // Defender kills: 1 XP per 5 kills
    if (gs.defender) xp += Math.min(Math.floor((gs.defender.totalKills || 0) / 5), 500);
  }

  // ── Achievements: ×200 each (rewards mastery) ──
  if (sources.achievementCount) {
    xp += sources.achievementCount * 200;
  }

  // ── Arena Challenge Wins: ×300, capped at 5000 XP (≈17 wins) ──
  if (sources.challengeWins) {
    xp += Math.min(sources.challengeWins * 300, 5000);
  }

  // ── Quest XP: earned directly from quest rewards ──
  if (sources.questXPEarned) {
    xp += sources.questXPEarned;
  }

  // ── Text Quests: ×500 (rare, hard content — coins are separate) ──
  if (sources.completedTextQuests) {
    xp += sources.completedTextQuests * 500;
  }

  // ── Tournament XP: earned from prize placements (uncapped) ──
  if (sources.tournamentXP) {
    xp += sources.tournamentXP;
  }

  // ── Arena Weekly XP: from server socialStats.arenaWeeklyXP (uncapped) ──
  if (sources.arenaWeeklyXP) {
    xp += sources.arenaWeeklyXP;
  }

  // ── Total Coins Earned: /200 (minimal, bonus) ──
  if (sources.totalCoins) {
    xp += Math.min(Math.floor(sources.totalCoins / 200), 1000);
  }

  return Math.max(0, Math.floor(xp));
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
 * Fetch XP sources from server (server-authoritative).
 * Returns null on network failure.
 */
export async function fetchServerXP(address: string): Promise<RangerXPSources | null> {
  try {
    const res = await fetch(`/api/xp?address=${encodeURIComponent(address)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.sources as RangerXPSources) ?? null;
  } catch {
    return null;
  }
}

/**
 * Gather XP sources: merges server (authoritative) with localStorage (fallback/supplement).
 * Server fields take max over local, ensuring server data can't be understated by either side.
 */
export async function gatherXPSourcesMerged(address: string): Promise<RangerXPSources> {
  const local = gatherXPSources(address);
  const server = await fetchServerXP(address);
  if (!server) return local; // offline fallback

  const merged: RangerXPSources = { ...local };

  // gameBestScores: merge per-mode, take max
  if (server.gameBestScores) {
    const combined: Record<string, number> = { ...(local.gameBestScores || {}) };
    for (const [mode, score] of Object.entries(server.gameBestScores)) {
      combined[mode] = Math.max(combined[mode] || 0, score);
    }
    merged.gameBestScores = combined;
  }

  // Scalar fields: take max of server vs local
  if (server.challengeWins !== undefined)
    merged.challengeWins = Math.max(local.challengeWins || 0, server.challengeWins);
  if (server.achievementCount !== undefined)
    merged.achievementCount = Math.max(local.achievementCount || 0, server.achievementCount);
  if (server.questXPEarned !== undefined)
    merged.questXPEarned = Math.max(local.questXPEarned || 0, server.questXPEarned);
  if (server.completedTextQuests !== undefined)
    merged.completedTextQuests = Math.max(local.completedTextQuests || 0, server.completedTextQuests);
  if (server.tournamentXP !== undefined) merged.tournamentXP = Math.max(local.tournamentXP || 0, server.tournamentXP);
  if (server.totalCoins !== undefined) merged.totalCoins = Math.max(local.totalCoins || 0, server.totalCoins);

  return merged;
}

/**
 * Gather XP sources from localStorage for a given wallet address.
 * Use gatherXPSourcesMerged() for server-authoritative version.
 */
export function gatherXPSources(address: string): RangerXPSources {
  const sources: RangerXPSources = {};

  try {
    // Game best scores
    const gameModes = ['orbit_survival', 'cosmic_defender', 'gravity_rush', 'cosmic_mine', 'cosmic_runner'];
    const bestScores: Record<string, number> = {};
    for (const mode of gameModes) {
      const raw = localStorage.getItem(`prism_league_best_${mode}_${address}`);
      if (raw) bestScores[mode] = parseInt(raw, 10) || 0;
    }
    if (Object.keys(bestScores).length > 0) sources.gameBestScores = bestScores;

    // Game stats (gamesPlayed, totalTime, totalKills)
    const gameStats: NonNullable<RangerXPSources['gameStats']> = {};
    try {
      const orbitRaw = localStorage.getItem('orbit_survival_stats_v1');
      if (orbitRaw) {
        const p = JSON.parse(orbitRaw);
        gameStats.orbit = { gamesPlayed: p.gamesPlayed || 0, totalSurvivalTime: p.totalSurvivalTime || 0 };
      }
    } catch {
      /* */
    }
    try {
      const defRaw = localStorage.getItem('cosmic_defender_stats_v1');
      if (defRaw) {
        const p = JSON.parse(defRaw);
        gameStats.defender = { gamesPlayed: p.gamesPlayed || 0, totalKills: p.totalKills || 0 };
      }
    } catch {
      /* */
    }
    try {
      const gravRaw = localStorage.getItem('gravity_rush_stats_v1');
      if (gravRaw) {
        const p = JSON.parse(gravRaw);
        gameStats.gravity = { gamesPlayed: p.gamesPlayed || 0, totalTime: p.totalSurvivalTime || p.totalTime || 0 };
      }
    } catch {
      /* */
    }
    if (Object.keys(gameStats).length > 0) sources.gameStats = gameStats;

    // Total coins
    const coinRaw = localStorage.getItem(`prism_balance_v1_${address}`);
    if (coinRaw) {
      const parsed = JSON.parse(coinRaw);
      sources.totalCoins = parsed?.totalEarned || 0;
    }

    // Quest XP: read totalXPEarned from quest state
    const questRaw = localStorage.getItem(`prism_quests_v1_${address}`);
    if (questRaw) {
      const parsed = JSON.parse(questRaw);
      sources.questXPEarned = parsed?.totalXPEarned || 0;
    }

    // Text quests completed (count)
    let textQuestCount = 0;
    const questIds = [
      'abandoned_station',
      'pirate_ambush',
      'dark_matter_anomaly',
      'prison_break',
      'dominator_factory',
      'election_day',
      'alien_zoo',
      'smugglers_run',
      'wormhole_gambit',
      'living_city',
      'galactic_jackpot',
      'jungle_survey',
      'plague_ship',
      'fortress_heist',
      'merc_contract',
      'alien_embassy',
    ];
    for (const qid of questIds) {
      const raw = localStorage.getItem(`text_quest_v1_${address}_${qid}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.completed) textQuestCount++;
      }
    }
    sources.completedTextQuests = textQuestCount;

    // Tournament XP (stored by server in walletDatabase, synced to localStorage)
    const tournamentXPRaw = localStorage.getItem(`prism_tournament_xp_${address}`);
    if (tournamentXPRaw) {
      sources.tournamentXP = parseInt(tournamentXPRaw, 10) || 0;
    }

    // Arena Weekly XP (server socialStats.arenaWeeklyXP, synced to localStorage by useCompositeScore)
    const arenaWeeklyXPRaw = localStorage.getItem(`prism_arena_weekly_xp_${address}`);
    if (arenaWeeklyXPRaw) {
      sources.arenaWeeklyXP = parseInt(arenaWeeklyXPRaw, 10) || 0;
    }

    // Challenge wins
    const arenaRaw = localStorage.getItem(`prism_arena_stats_${address}`);
    if (arenaRaw) {
      const parsed = JSON.parse(arenaRaw);
      sources.challengeWins = parsed?.wins || 0;
    }

    // Achievements
    let achCount = 0;
    const achKeys = [
      'orbit_survival_achievements_v1',
      'cosmic_defender_achievements_v1',
      'gravity_rush_achievements_v1',
    ];
    for (const k of achKeys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) achCount += arr.filter((a: { unlocked?: boolean }) => a.unlocked).length;
      }
    }
    sources.achievementCount = achCount;
  } catch {
    /* ignore localStorage errors */
  }

  return sources;
}
