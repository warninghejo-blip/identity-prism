/**
 * prismQuests — unit tests for quest state management.
 * All storage-dependent functions are tested via mocked localStorage/sessionStorage.
 * saveQuestState triggers dynamic imports (userDataSync, shared) — those are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dynamic imports used by saveQuestState/syncQuestsToServer
vi.mock('@/lib/userDataSync', () => ({
  syncToServer: vi.fn(),
}));

vi.mock('@/components/prism/shared', () => ({
  getApiBase: vi.fn(() => null), // no API base → skips fetch
  ensureJwt: vi.fn(() => Promise.resolve('')),
}));

vi.mock('@/hooks/useCompositeScore', () => ({
  invalidateCompositeCache: vi.fn(),
}));

import {
  DAILY_QUESTS,
  WEEKLY_QUESTS,
  ONE_TIME_QUESTS,
  ALL_QUESTS,
  incrementQuest,
  claimQuestReward,
  getQuestProgress,
  getActiveQuests,
  getUnclaimedCount,
  type QuestState,
} from '../prismQuests';

// ── Helpers ──

function makeFutureDate(daysAhead = 1): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function makeState(overrides: Partial<QuestState> = {}): QuestState {
  return {
    address: 'TestAddr',
    dailyResetAt: makeFutureDate(1),
    weeklyResetAt: makeFutureDate(7),
    progress: [],
    totalCompleted: 0,
    totalXPEarned: 0,
    currentStreak: 0,
    ...overrides,
  };
}

// ── Catalog checks ──

describe('Quest catalog', () => {
  it('has 5 daily quests', () => {
    expect(DAILY_QUESTS).toHaveLength(5);
  });

  it('has 5 weekly quests', () => {
    expect(WEEKLY_QUESTS).toHaveLength(5);
  });

  it('has 10 one-time quests', () => {
    expect(ONE_TIME_QUESTS).toHaveLength(10);
  });

  it('ALL_QUESTS combines all three lists', () => {
    expect(ALL_QUESTS).toHaveLength(DAILY_QUESTS.length + WEEKLY_QUESTS.length + ONE_TIME_QUESTS.length);
  });

  it('every quest has positive reward and target', () => {
    for (const q of ALL_QUESTS) {
      expect(q.reward).toBeGreaterThan(0);
      expect(q.target).toBeGreaterThan(0);
    }
  });

  it('every quest id is unique', () => {
    const ids = ALL_QUESTS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('daily_scan quest has reward=15 and target=1', () => {
    const q = DAILY_QUESTS.find((x) => x.id === 'daily_scan');
    expect(q?.reward).toBe(15);
    expect(q?.target).toBe(1);
  });
});

// ── getQuestProgress ──

describe('getQuestProgress', () => {
  it('returns default zero progress for unknown questId', () => {
    const state = makeState();
    const progress = getQuestProgress(state, 'nonexistent_quest');
    expect(progress.current).toBe(0);
    expect(progress.completed).toBe(false);
    expect(progress.completedAt).toBeNull();
  });

  it('returns existing progress when present', () => {
    const state = makeState({
      progress: [{ questId: 'daily_scan', current: 1, completed: true, completedAt: '2024-01-01', claimedAt: null }],
    });
    const progress = getQuestProgress(state, 'daily_scan');
    expect(progress.current).toBe(1);
    expect(progress.completed).toBe(true);
  });
});

// ── incrementQuest ──

describe('incrementQuest', () => {
  beforeEach(() => {
    // localStorage/sessionStorage are provided by jsdom
    localStorage.clear();
    sessionStorage.clear();
  });

  it('returns unchanged state for unknown questId', () => {
    const state = makeState();
    const { state: next, justCompleted } = incrementQuest(state, 'nonexistent_quest');
    expect(next).toBe(state); // same reference
    expect(justCompleted).toBe(false);
  });

  it('increments progress by 1 (default)', () => {
    const state = makeState();
    const { state: next } = incrementQuest(state, 'daily_scan');
    const p = getQuestProgress(next, 'daily_scan');
    expect(p.current).toBe(1);
  });

  it('marks quest completed when target reached', () => {
    const state = makeState();
    const { state: next, justCompleted } = incrementQuest(state, 'daily_scan', 1);
    // daily_scan has target=1, so one increment should complete it
    expect(justCompleted).toBe(true);
    expect(getQuestProgress(next, 'daily_scan').completed).toBe(true);
    expect(next.totalCompleted).toBe(1);
  });

  it('does not double-increment already completed quest', () => {
    const state = makeState({
      progress: [{ questId: 'daily_scan', current: 1, completed: true, completedAt: '2024-01-01', claimedAt: null }],
      totalCompleted: 1,
    });
    const { state: next, justCompleted } = incrementQuest(state, 'daily_scan');
    expect(justCompleted).toBe(false);
    expect(next.totalCompleted).toBe(1); // unchanged
  });

  it('clamps progress to quest target (no over-progress)', () => {
    const state = makeState();
    const { state: next } = incrementQuest(state, 'daily_scan', 999);
    const p = getQuestProgress(next, 'daily_scan');
    expect(p.current).toBe(1); // target is 1
  });

  it('fires onComplete callback when quest is first completed', () => {
    const onComplete = vi.fn();
    const state = makeState();
    incrementQuest(state, 'daily_scan', 1, onComplete);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0].id).toBe('daily_scan');
  });

  it('increments progress by custom amount', () => {
    const state = makeState();
    // weekly_burn5 has target=5
    const { state: next } = incrementQuest(state, 'weekly_burn5', 3);
    expect(getQuestProgress(next, 'weekly_burn5').current).toBe(3);
    expect(getQuestProgress(next, 'weekly_burn5').completed).toBe(false);
  });
});

// ── claimQuestReward ──

describe('claimQuestReward', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('does nothing if quest not in progress', () => {
    const state = makeState();
    const next = claimQuestReward(state, 'daily_scan');
    expect(next).toBe(state);
  });

  it('does nothing if quest not completed', () => {
    const state = makeState({
      progress: [{ questId: 'daily_scan', current: 0, completed: false, completedAt: null, claimedAt: null }],
    });
    const next = claimQuestReward(state, 'daily_scan');
    expect(next.totalXPEarned).toBe(0);
  });

  it('adds quest XP to totalXPEarned on claim', () => {
    const state = makeState({
      progress: [{ questId: 'daily_scan', current: 1, completed: true, completedAt: '2024-01-01', claimedAt: null }],
    });
    const next = claimQuestReward(state, 'daily_scan');
    // daily_scan reward = 15
    expect(next.totalXPEarned).toBe(15);
    expect(next.progress[0].claimedAt).not.toBeNull();
  });

  it('does nothing if already claimed', () => {
    const state = makeState({
      progress: [
        {
          questId: 'daily_scan',
          current: 1,
          completed: true,
          completedAt: '2024-01-01',
          claimedAt: '2024-01-01T01:00:00Z',
        },
      ],
      totalXPEarned: 15,
    });
    const next = claimQuestReward(state, 'daily_scan');
    expect(next.totalXPEarned).toBe(15); // unchanged
  });
});

// ── getActiveQuests / getUnclaimedCount ──

describe('getActiveQuests', () => {
  it('returns all quests when none completed', () => {
    const state = makeState();
    const active = getActiveQuests(state);
    expect(active).toHaveLength(ALL_QUESTS.length);
  });

  it('excludes quests that are completed AND claimed', () => {
    const state = makeState({
      progress: [
        {
          questId: 'daily_scan',
          current: 1,
          completed: true,
          completedAt: '2024-01-01',
          claimedAt: '2024-01-01T01:00:00Z',
        },
      ],
    });
    const active = getActiveQuests(state);
    expect(active).toHaveLength(ALL_QUESTS.length - 1);
  });

  it('includes completed-but-unclaimed quests (reward pending)', () => {
    const state = makeState({
      progress: [{ questId: 'daily_scan', current: 1, completed: true, completedAt: '2024-01-01', claimedAt: null }],
    });
    const active = getActiveQuests(state);
    expect(active.find((a) => a.quest.id === 'daily_scan')).toBeDefined();
  });
});

describe('getUnclaimedCount', () => {
  it('returns 0 when nothing completed', () => {
    expect(getUnclaimedCount(makeState())).toBe(0);
  });

  it('counts completed-unclaimed entries', () => {
    const state = makeState({
      progress: [
        { questId: 'daily_scan', current: 1, completed: true, completedAt: '2024-01-01', claimedAt: null },
        { questId: 'daily_game', current: 1, completed: true, completedAt: '2024-01-01', claimedAt: null },
        {
          questId: 'daily_burn',
          current: 1,
          completed: true,
          completedAt: '2024-01-01',
          claimedAt: '2024-01-01T02:00:00Z',
        }, // claimed
      ],
    });
    expect(getUnclaimedCount(state)).toBe(2);
  });
});
