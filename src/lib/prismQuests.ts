/**
 * Prism Quests — daily/weekly on-chain challenges for Identity Prism v5.
 * Complete quests to earn PRISM coins. Creates daily engagement loop.
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
  reward: number;             // PRISM coins
  target: number;             // e.g., "burn 3 tokens" → target = 3
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
  dailyResetAt: string;       // ISO timestamp of next daily reset
  weeklyResetAt: string;      // ISO timestamp of next weekly reset
  progress: QuestProgress[];
  totalCompleted: number;
  currentStreak: number;      // consecutive days with ≥1 quest completed
}

// ── Quest Catalog ──

export const DAILY_QUESTS: Quest[] = [
  { id: 'daily_scan', name: 'Daily Scan', description: 'Scan your wallet once', category: 'identity', frequency: 'daily', reward: 5, target: 1, icon: '🔬' },
  { id: 'daily_game', name: 'Daily Player', description: 'Play one game in Prism League', category: 'game', frequency: 'daily', reward: 10, target: 1, icon: '🎮' },
  { id: 'daily_burn', name: 'Dust Collector', description: 'Burn 1 token in Black Hole', category: 'burn', frequency: 'daily', reward: 8, target: 1, icon: '🔥' },
  { id: 'daily_explore', name: 'Curious Mind', description: 'View another wallet in Nebula Market', category: 'explore', frequency: 'daily', reward: 5, target: 1, icon: '🔭' },
  { id: 'daily_highscore', name: 'Beat Yourself', description: 'Set a new personal best in any game', category: 'game', frequency: 'daily', reward: 15, target: 1, icon: '🏆' },
];

export const WEEKLY_QUESTS: Quest[] = [
  { id: 'weekly_burn5', name: 'Purge Week', description: 'Burn 5 tokens in Black Hole', category: 'burn', frequency: 'weekly', reward: 40, target: 5, icon: '🕳️' },
  { id: 'weekly_games5', name: 'Marathon Runner', description: 'Play 5 games in Prism League', category: 'game', frequency: 'weekly', reward: 35, target: 5, icon: '🏃' },
  { id: 'weekly_compare3', name: 'Social Butterfly', description: 'Compare wallets 3 times', category: 'social', frequency: 'weekly', reward: 25, target: 3, icon: '🦋' },
  { id: 'weekly_streak', name: 'Dedication', description: 'Complete daily quests 5 days in a row', category: 'identity', frequency: 'weekly', reward: 50, target: 5, icon: '🔥' },
  { id: 'weekly_forge', name: 'Forge Apprentice', description: 'Purchase 1 item from Stellar Forge', category: 'explore', frequency: 'weekly', reward: 30, target: 1, icon: '⚒️' },
];

export const ONE_TIME_QUESTS: Quest[] = [
  { id: 'ot_first_scan', name: 'First Contact', description: 'Scan your wallet for the first time', category: 'identity', frequency: 'one_time', reward: 25, target: 1, icon: '🌟' },
  { id: 'ot_first_mint', name: 'Minted!', description: 'Mint your Identity Prism NFT', category: 'identity', frequency: 'one_time', reward: 100, target: 1, icon: '💎' },
  { id: 'ot_first_burn', name: 'Into the Void', description: 'Burn your first token in Black Hole', category: 'burn', frequency: 'one_time', reward: 15, target: 1, icon: '🕳️' },
  { id: 'ot_first_game', name: 'Player One', description: 'Play your first game', category: 'game', frequency: 'one_time', reward: 20, target: 1, icon: '🎮' },
  { id: 'ot_reach_sun', name: 'Solar Ascension', description: 'Reach Sun tier or higher', category: 'identity', frequency: 'one_time', reward: 200, target: 1, icon: '☀️' },
  { id: 'ot_burn100', name: 'Black Hole Master', description: 'Burn 100 tokens total', category: 'burn', frequency: 'one_time', reward: 150, target: 100, icon: '🌀' },
  { id: 'ot_score1000', name: 'Cosmic Legend', description: 'Score 1000+ in any game', category: 'game', frequency: 'one_time', reward: 75, target: 1000, icon: '🏅' },
  { id: 'ot_forge5', name: 'Collector', description: 'Own 5 items from Stellar Forge', category: 'explore', frequency: 'one_time', reward: 100, target: 5, icon: '🗃️' },
  { id: 'ot_compare10', name: 'Analyst', description: 'Compare 10 different wallets', category: 'social', frequency: 'one_time', reward: 50, target: 10, icon: '📊' },
  { id: 'ot_constellation', name: 'Star Mapper', description: 'View your Constellation Network', category: 'explore', frequency: 'one_time', reward: 25, target: 1, icon: '🗺️' },
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
      // Check resets
      const now = new Date().toISOString();
      let needsSave = false;

      if (now >= state.dailyResetAt) {
        // Reset daily quests
        state.progress = state.progress.filter(
          (p) => !DAILY_QUESTS.some((q) => q.id === p.questId),
        );
        state.dailyResetAt = getNextDailyReset();
        needsSave = true;
      }

      if (now >= state.weeklyResetAt) {
        // Reset weekly quests
        state.progress = state.progress.filter(
          (p) => !WEEKLY_QUESTS.some((q) => q.id === p.questId),
        );
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
    currentStreak: 0,
  };
  saveQuestState(defaultState);
  return defaultState;
}

export function saveQuestState(state: QuestState): void {
  try {
    localStorage.setItem(`${QUEST_STATE_KEY}_${state.address}`, JSON.stringify(state));
  } catch {}
}

export function getQuestProgress(state: QuestState, questId: string): QuestProgress {
  return state.progress.find((p) => p.questId === questId) ?? {
    questId,
    current: 0,
    completed: false,
    completedAt: null,
    claimedAt: null,
  };
}

/**
 * Increment progress on a quest. Returns updated state and whether it was just completed.
 */
export function incrementQuest(
  state: QuestState,
  questId: string,
  amount = 1,
): { state: QuestState; justCompleted: boolean } {
  const quest = ALL_QUESTS.find((q) => q.id === questId);
  if (!quest) return { state, justCompleted: false };

  let progress = state.progress.find((p) => p.questId === questId);
  if (!progress) {
    progress = { questId, current: 0, completed: false, completedAt: null, claimedAt: null };
    state.progress.push(progress);
  }

  if (progress.completed) return { state, justCompleted: false };

  progress.current = Math.min(progress.current + amount, quest.target);
  const justCompleted = progress.current >= quest.target && !progress.completed;

  if (justCompleted) {
    progress.completed = true;
    progress.completedAt = new Date().toISOString();
    state.totalCompleted += 1;
  }

  saveQuestState(state);
  return { state, justCompleted };
}

/**
 * Mark a quest reward as claimed.
 */
export function claimQuestReward(state: QuestState, questId: string): QuestState {
  const progress = state.progress.find((p) => p.questId === questId);
  if (!progress || !progress.completed || progress.claimedAt) return state;

  progress.claimedAt = new Date().toISOString();
  saveQuestState(state);
  return state;
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
