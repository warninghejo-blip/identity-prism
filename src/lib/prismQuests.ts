/**
 * Quests — daily/weekly challenges for Identity Prism v5.
 * Complete quests to earn XP. Creates daily engagement loop.
 */

// ── Types ──

export type QuestFrequency = 'daily' | 'weekly' | 'one_time';
export type QuestCategory = 'transaction' | 'burn' | 'game' | 'social' | 'identity' | 'explore';

export interface Quest {
  id: string;
  name: string;
  description: string;
  category: QuestCategory;
  frequency: QuestFrequency;
  reward: number; // XP earned on claim
  target: number; // e.g., "burn 3 tokens" → target = 3
  icon: string;
}

export interface QuestProgress {
  questId: string;
  current: number;
  completed: boolean;
  completedAt: string | null;
  claimedAt: string | null;
}

export interface QuestState {
  address: string;
  dailyResetAt: string; // ISO timestamp of next daily reset
  weeklyResetAt: string; // ISO timestamp of next weekly reset
  progress: QuestProgress[];
  totalCompleted: number;
  totalXPEarned: number; // running total of XP earned from quests
  currentStreak: number; // consecutive days with ≥1 quest completed
}

// ── Quest Catalog ──

export const DAILY_QUESTS: Quest[] = [
  {
    id: 'daily_scan',
    name: 'Daily Scan',
    description: 'Scan your wallet once',
    category: 'identity',
    frequency: 'daily',
    reward: 15,
    target: 1,
    icon: '🔬',
  },
  {
    id: 'daily_game',
    name: 'Daily Player',
    description: 'Play one game in Prism League',
    category: 'game',
    frequency: 'daily',
    reward: 30,
    target: 1,
    icon: '🎮',
  },
  {
    id: 'daily_burn',
    name: 'Dust Collector',
    description: 'Burn 1 token in Black Hole',
    category: 'burn',
    frequency: 'daily',
    reward: 25,
    target: 1,
    icon: '🔥',
  },
  {
    id: 'daily_explore',
    name: 'Sybil Hunter',
    description: 'Scan a wallet in Sybil Hunt',
    category: 'explore',
    frequency: 'daily',
    reward: 15,
    target: 1,
    icon: '🎯',
  },
  {
    id: 'daily_highscore',
    name: 'Beat Yourself',
    description: 'Set a new personal best in any game',
    category: 'game',
    frequency: 'daily',
    reward: 50,
    target: 1,
    icon: '🏆',
  },
];

export const WEEKLY_QUESTS: Quest[] = [
  {
    id: 'weekly_burn5',
    name: 'Purge Week',
    description: 'Burn 5 tokens in Black Hole',
    category: 'burn',
    frequency: 'weekly',
    reward: 150,
    target: 5,
    icon: '🕳️',
  },
  {
    id: 'weekly_games5',
    name: 'Marathon Runner',
    description: 'Play 5 games in Prism League',
    category: 'game',
    frequency: 'weekly',
    reward: 120,
    target: 5,
    icon: '🏃',
  },
  {
    id: 'weekly_arena',
    name: 'Arena Fighter',
    description: 'Complete 3 arena challenges',
    category: 'game',
    frequency: 'weekly',
    reward: 100,
    target: 3,
    icon: '⚔️',
  },
  {
    id: 'weekly_streak',
    name: 'Dedication',
    description: 'Complete daily quests 5 days in a row',
    category: 'identity',
    frequency: 'weekly',
    reward: 200,
    target: 5,
    icon: '🔥',
  },
  {
    id: 'weekly_forge',
    name: 'Forge Apprentice',
    description: 'Purchase 1 item from Stellar Forge',
    category: 'explore',
    frequency: 'weekly',
    reward: 100,
    target: 1,
    icon: '⚒️',
  },
];

export const ONE_TIME_QUESTS: Quest[] = [
  {
    id: 'ot_first_scan',
    name: 'First Contact',
    description: 'Scan your wallet for the first time',
    category: 'identity',
    frequency: 'one_time',
    reward: 50,
    target: 1,
    icon: '🌟',
  },
  {
    id: 'ot_first_mint',
    name: 'Minted!',
    description: 'Mint your Identity Prism NFT',
    category: 'identity',
    frequency: 'one_time',
    reward: 250,
    target: 1,
    icon: '💎',
  },
  {
    id: 'ot_first_burn',
    name: 'Into the Void',
    description: 'Burn your first token in Black Hole',
    category: 'burn',
    frequency: 'one_time',
    reward: 50,
    target: 1,
    icon: '🕳️',
  },
  {
    id: 'ot_first_game',
    name: 'Player One',
    description: 'Play your first game',
    category: 'game',
    frequency: 'one_time',
    reward: 75,
    target: 1,
    icon: '🎮',
  },
  {
    id: 'ot_reach_sun',
    name: 'Solar Ascension',
    description: 'Reach Sun tier or higher',
    category: 'identity',
    frequency: 'one_time',
    reward: 500,
    target: 1,
    icon: '☀️',
  },
  {
    id: 'ot_burn100',
    name: 'Black Hole Master',
    description: 'Burn 100 tokens total',
    category: 'burn',
    frequency: 'one_time',
    reward: 300,
    target: 100,
    icon: '🌀',
  },
  {
    id: 'ot_score1000',
    name: 'Cosmic Legend',
    description: 'Score 1000+ in any game',
    category: 'game',
    frequency: 'one_time',
    reward: 150,
    target: 1000,
    icon: '🏅',
  },
  {
    id: 'ot_forge5',
    name: 'Collector',
    description: 'Own 5 items from Stellar Forge',
    category: 'explore',
    frequency: 'one_time',
    reward: 200,
    target: 5,
    icon: '🗃️',
  },
  {
    id: 'ot_arena_wins',
    name: 'Champion',
    description: 'Win 10 arena challenges',
    category: 'game',
    frequency: 'one_time',
    reward: 200,
    target: 10,
    icon: '🏆',
  },
  {
    id: 'ot_text_quest',
    name: 'Story Explorer',
    description: 'Complete a text quest adventure',
    category: 'explore',
    frequency: 'one_time',
    reward: 100,
    target: 1,
    icon: '📖',
  },
];

export const ALL_QUESTS: Quest[] = [...DAILY_QUESTS, ...WEEKLY_QUESTS, ...ONE_TIME_QUESTS];

// ── State management ──

const QUEST_STATE_KEY = 'prism_quests_v1';

function getNextDailyReset(): string {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function getNextWeeklyReset(): string {
  const now = new Date();
  const next = new Date(now);
  const dayOfWeek = next.getUTCDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  next.setUTCDate(next.getUTCDate() + daysUntilMonday);
  next.setUTCHours(0, 0, 0, 0);
  return next.toISOString();
}

export function getQuestState(address: string): QuestState {
  try {
    const raw = localStorage.getItem(`${QUEST_STATE_KEY}_${address}`);
    if (raw) {
      const state: QuestState = JSON.parse(raw);
      // Migrate: add totalXPEarned if missing
      if (state.totalXPEarned == null) state.totalXPEarned = 0;
      // Check resets
      const now = new Date().toISOString();
      let needsSave = false;

      if (now >= state.dailyResetAt) {
        // Calculate how many days were missed since last reset
        const resetTime = new Date(state.dailyResetAt).getTime();
        const nowTime = new Date(now).getTime();
        const daysMissed = Math.floor((nowTime - resetTime) / (24 * 60 * 60 * 1000));

        // Streak logic: check if any daily quest was completed before reset
        const hadDailyComplete = state.progress.some(
          (p) => DAILY_QUESTS.some((q) => q.id === p.questId) && p.completed,
        );

        if (daysMissed > 1) {
          // Skipped more than 1 day — streak is broken regardless
          state.currentStreak = 0;
        } else if (hadDailyComplete) {
          state.currentStreak = (state.currentStreak || 0) + 1;
        } else {
          // Missed yesterday — reset streak
          state.currentStreak = 0;
        }

        // Reset daily quests
        state.progress = state.progress.filter((p) => !DAILY_QUESTS.some((q) => q.id === p.questId));
        state.dailyResetAt = getNextDailyReset();
        needsSave = true;
      }

      if (now >= state.weeklyResetAt) {
        // Reset weekly quests
        state.progress = state.progress.filter((p) => !WEEKLY_QUESTS.some((q) => q.id === p.questId));
        state.weeklyResetAt = getNextWeeklyReset();
        needsSave = true;
      }

      if (needsSave) saveQuestState(state);
      return state;
    }
  } catch {}

  const defaultState: QuestState = {
    address,
    dailyResetAt: getNextDailyReset(),
    weeklyResetAt: getNextWeeklyReset(),
    progress: [],
    totalCompleted: 0,
    totalXPEarned: 0,
    currentStreak: 0,
  };
  saveQuestState(defaultState);
  return defaultState;
}

export function saveQuestState(state: QuestState): void {
  try {
    localStorage.setItem(`${QUEST_STATE_KEY}_${state.address}`, JSON.stringify(state));
  } catch {}
  // Sync quest progress to server (debounced)
  import('@/lib/userDataSync')
    .then(({ syncToServer }) => {
      syncToServer({ rangerXP: state });
    })
    .catch(() => {});
}

export function getQuestProgress(state: QuestState, questId: string): QuestProgress {
  return (
    state.progress.find((p) => p.questId === questId) ?? {
      questId,
      current: 0,
      completed: false,
      completedAt: null,
      claimedAt: null,
    }
  );
}

/**
 * Sync quest progress to server (fire-and-forget).
 */
export function syncQuestsToServer(address: string, quests: Record<string, QuestProgress>): void {
  const proxyUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_HELIUS_PROXY_URL) || '';
  const jwt = (() => {
    try {
      const r = sessionStorage.getItem('ip_auth_jwt');
      if (!r) return '';
      const p = JSON.parse(r);
      return p.expiresAt > Date.now() + 60000 ? p.token : '';
    } catch {
      return '';
    }
  })();
  fetch(`${proxyUrl}/api/quest/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ address, quests }),
  }).catch(() => {}); // fire-and-forget
}

/**
 * Increment progress on a quest. Returns updated state and whether it was just completed.
 * Optional onComplete callback fires when quest is first completed.
 */
export function incrementQuest(
  state: QuestState,
  questId: string,
  amount = 1,
  onComplete?: (quest: Quest) => void,
): { state: QuestState; justCompleted: boolean } {
  const quest = ALL_QUESTS.find((q) => q.id === questId);
  if (!quest) return { state, justCompleted: false };

  const existing = state.progress.find((p) => p.questId === questId);
  if (existing?.completed) return { state, justCompleted: false };

  const prev: QuestProgress = existing ?? { questId, current: 0, completed: false, completedAt: null, claimedAt: null };
  const newCurrent = Math.min(prev.current + amount, quest.target);
  const justCompleted = newCurrent >= quest.target && !prev.completed;

  const updatedProgress: QuestProgress = {
    ...prev,
    current: newCurrent,
    completed: justCompleted ? true : prev.completed,
    completedAt: justCompleted ? new Date().toISOString() : prev.completedAt,
  };

  const newProgress = existing
    ? state.progress.map((p) => (p.questId === questId ? updatedProgress : p))
    : [...state.progress, updatedProgress];

  const newState: QuestState = {
    ...state,
    progress: newProgress,
    totalCompleted: state.totalCompleted + (justCompleted ? 1 : 0),
  };

  saveQuestState(newState);
  if (justCompleted) {
    if (onComplete && quest) onComplete(quest);
    // Invalidate composite cache so score reflects quest completion
    if (newState.address) {
      import('@/hooks/useCompositeScore')
        .then(({ invalidateCompositeCache }) => {
          invalidateCompositeCache(newState.address);
        })
        .catch(() => {});
    }
  }
  return { state: newState, justCompleted };
}

/**
 * Mark a quest reward as claimed.
 */
export function claimQuestReward(state: QuestState, questId: string): QuestState {
  const progress = state.progress.find((p) => p.questId === questId);
  if (!progress || !progress.completed || progress.claimedAt) return state;

  const quest = ALL_QUESTS.find((q) => q.id === questId);
  const xpReward = quest?.reward ?? 0;

  const newState: QuestState = {
    ...state,
    totalXPEarned: (state.totalXPEarned || 0) + xpReward,
    progress: state.progress.map((p) => (p.questId === questId ? { ...p, claimedAt: new Date().toISOString() } : p)),
  };
  saveQuestState(newState);
  // Sync to server after claim
  const questMap: Record<string, QuestProgress> = {};
  for (const p of newState.progress) questMap[p.questId] = p;
  syncQuestsToServer(newState.address, questMap);
  return newState;
}

/**
 * Retroactively sync milestone quest progress from localStorage/game data.
 * Fixes quests that weren't tracked when the action originally happened.
 */
export function syncMilestoneProgress(state: QuestState, address: string): QuestState {
  let s = state;

  // ot_first_mint — check if user has minted
  const hasMinted =
    localStorage.getItem(`prism_minted_${address}`) === 'true' ||
    localStorage.getItem(`hasMintedIdCard_${address}`) === 'true';
  if (hasMinted) {
    const r = incrementQuest(s, 'ot_first_mint');
    s = r.state;
  }

  // ot_first_scan — check if any scan happened
  const scanCount = parseInt(localStorage.getItem(`prism_scan_count_${address}`) || '0', 10);
  if (scanCount > 0) {
    const r = incrementQuest(s, 'ot_first_scan', scanCount);
    s = r.state;
  }

  // ot_first_game — check game stats
  const gameModes = ['orbit_survival_stats_v1', 'cosmic_defender_stats_v1', 'gravity_rush_stats_v1'];
  let totalGames = 0;
  for (const key of gameModes) {
    try {
      const p = JSON.parse(localStorage.getItem(key) || '{}');
      totalGames += p.gamesPlayed || 0;
    } catch {}
  }
  if (totalGames > 0) {
    const r = incrementQuest(s, 'ot_first_game', totalGames);
    s = r.state;
  }

  // ot_reach_sun — check tier from composite cache
  try {
    const compositeRaw = sessionStorage.getItem(`composite_score_${address}`);
    if (compositeRaw) {
      const cd = JSON.parse(compositeRaw);
      const tier = cd?.tier || cd?.compositeTier || '';
      const highTiers = ['sun', 'binary_sun', 'neutron', 'pulsar', 'black_hole'];
      if (highTiers.includes(tier)) {
        const r = incrementQuest(s, 'ot_reach_sun');
        s = r.state;
      }
    }
  } catch {}

  // ot_first_burn — check burn stats
  const burnStats = localStorage.getItem(`blackhole_stats_${address}`);
  if (burnStats) {
    try {
      const p = JSON.parse(burnStats);
      const totalBurned = (p.tokensBurned || 0) + (p.nftsBurned || 0);
      if (totalBurned > 0) {
        let r = incrementQuest(s, 'ot_first_burn', totalBurned);
        s = r.state;
        r = incrementQuest(s, 'ot_burn100', totalBurned);
        s = r.state;
      }
    } catch {}
  }

  // ot_forge5 — check owned items from forge loadout
  const loadoutRaw = localStorage.getItem(`prism_forge_loadout_v1_${address}`);
  if (loadoutRaw) {
    try {
      const loadout = JSON.parse(loadoutRaw);
      const count = Array.isArray(loadout?.ownedItems) ? loadout.ownedItems.length : 0;
      if (count > 0) {
        const r = incrementQuest(s, 'ot_forge5', count);
        s = r.state;
      }
    } catch {}
  }

  // ot_score1000 — check best scores
  const scoreKeys = ['orbit_survival', 'cosmic_defender', 'gravity_rush'];
  for (const mode of scoreKeys) {
    const best = parseInt(localStorage.getItem(`prism_league_best_${mode}_${address}`) || '0', 10);
    if (best >= 1000) {
      const r = incrementQuest(s, 'ot_score1000', best);
      s = r.state;
      break;
    }
  }

  // ot_text_quest — check completed text quests
  const textQuestIds = [
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
  let textQuestsDone = 0;
  for (const qid of textQuestIds) {
    try {
      const raw = localStorage.getItem(`text_quest_v1_${address}_${qid}`);
      if (raw && JSON.parse(raw)?.completed) textQuestsDone++;
    } catch {}
  }
  if (textQuestsDone > 0) {
    const r = incrementQuest(s, 'ot_text_quest', textQuestsDone);
    s = r.state;
  }

  return s;
}

/**
 * Get active quests (not yet completed) with progress.
 */
export function getActiveQuests(state: QuestState): { quest: Quest; progress: QuestProgress }[] {
  return ALL_QUESTS.map((quest) => ({
    quest,
    progress: getQuestProgress(state, quest.id),
  })).filter(({ progress }) => !progress.completed || !progress.claimedAt);
}

/**
 * Get count of unclaimed rewards.
 */
export function getUnclaimedCount(state: QuestState): number {
  return state.progress.filter((p) => p.completed && !p.claimedAt).length;
}
