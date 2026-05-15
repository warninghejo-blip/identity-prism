import { describe, it, expect } from 'vitest';
import {
  RANGER_RANKS,
  computeRangerXP,
  getRangerRank,
  getNextRank,
  getRankProgress,
  type RangerXPSources,
} from '../rangerRanks';

// ── Rank definitions ──

describe('RANGER_RANKS catalog', () => {
  it('has 5 ranks in ascending XP order', () => {
    expect(RANGER_RANKS).toHaveLength(5);
    for (let i = 1; i < RANGER_RANKS.length; i++) {
      expect(RANGER_RANKS[i].minXP).toBeGreaterThan(RANGER_RANKS[i - 1].minXP);
    }
  });

  it('cadet starts at 0 XP', () => {
    const cadet = RANGER_RANKS.find((r) => r.id === 'cadet');
    expect(cadet?.minXP).toBe(0);
  });

  it('pilot threshold is 1500', () => {
    const pilot = RANGER_RANKS.find((r) => r.id === 'pilot');
    expect(pilot?.minXP).toBe(1500);
  });

  it('captain threshold is 8000', () => {
    const captain = RANGER_RANKS.find((r) => r.id === 'captain');
    expect(captain?.minXP).toBe(8000);
  });

  it('ace threshold is 25000', () => {
    const ace = RANGER_RANKS.find((r) => r.id === 'ace');
    expect(ace?.minXP).toBe(25000);
  });

  it('legend threshold is 50000', () => {
    const legend = RANGER_RANKS.find((r) => r.id === 'legend');
    expect(legend?.minXP).toBe(50000);
  });
});

// ── getRangerRank ──

describe('getRangerRank', () => {
  it('returns cadet for 0 XP', () => {
    expect(getRangerRank(0).id).toBe('cadet');
  });

  it('returns cadet below pilot threshold', () => {
    expect(getRangerRank(1499).id).toBe('cadet');
  });

  it('returns pilot at exactly 1500 XP', () => {
    expect(getRangerRank(1500).id).toBe('pilot');
  });

  it('returns captain at exactly 8000 XP', () => {
    expect(getRangerRank(8000).id).toBe('captain');
  });

  it('returns ace at exactly 25000 XP', () => {
    expect(getRangerRank(25000).id).toBe('ace');
  });

  it('returns legend at exactly 50000 XP', () => {
    expect(getRangerRank(50000).id).toBe('legend');
  });

  it('returns legend well above 50000', () => {
    expect(getRangerRank(999999).id).toBe('legend');
  });
});

// ── getNextRank ──

describe('getNextRank', () => {
  it('returns pilot as next after 0 XP', () => {
    const next = getNextRank(0);
    expect(next?.rank.id).toBe('pilot');
    expect(next?.xpNeeded).toBe(1500);
  });

  it('returns correct xpNeeded for mid-rank', () => {
    const next = getNextRank(5000); // captain rank (8000), 3000 needed
    expect(next?.rank.id).toBe('captain');
    expect(next?.xpNeeded).toBe(3000);
  });

  it('returns null at legend (max rank)', () => {
    expect(getNextRank(50000)).toBeNull();
    expect(getNextRank(99999)).toBeNull();
  });
});

// ── getRankProgress ──

describe('getRankProgress', () => {
  it('returns 0 at rank start (cadet at 0)', () => {
    expect(getRankProgress(0)).toBe(0);
  });

  it('returns 0.5 at halfway to pilot (750 XP)', () => {
    expect(getRankProgress(750)).toBeCloseTo(0.5);
  });

  it('returns value approaching 1 just before pilot threshold', () => {
    expect(getRankProgress(1499)).toBeCloseTo(1, 0);
  });

  it('returns 1 for legend rank (max)', () => {
    expect(getRankProgress(50000)).toBe(1);
    expect(getRankProgress(100000)).toBe(1);
  });

  it('returns correct progress within captain range', () => {
    // captain: 8000, next (ace): 25000, range = 17000
    // At 16500 (halfway within captain+ace range: 8000 + 8500 = 16500)
    const progress = getRankProgress(8000 + 8500);
    expect(progress).toBeCloseTo(0.5, 1);
  });
});

// ── computeRangerXP ──

describe('computeRangerXP', () => {
  it('returns 0 for empty sources', () => {
    expect(computeRangerXP({})).toBe(0);
  });

  it('computes game best score XP (orbit_survival)', () => {
    const sources: RangerXPSources = {
      gameBestScores: { orbit_survival: 200 }, // 200 * 5 = 1000 XP
    };
    expect(computeRangerXP(sources)).toBe(1000);
  });

  it('caps orbit_survival best score at 2000 XP', () => {
    const sources: RangerXPSources = {
      gameBestScores: { orbit_survival: 99999 }, // would be huge but capped at 2000
    };
    expect(computeRangerXP(sources)).toBe(2000);
  });

  it('computes achievement XP (×200 each)', () => {
    const sources: RangerXPSources = { achievementCount: 5 };
    expect(computeRangerXP(sources)).toBe(1000);
  });

  it('caps challenge wins at 5000 XP', () => {
    const sources: RangerXPSources = { challengeWins: 1000 }; // 1000×300 >> 5000 cap
    expect(computeRangerXP(sources)).toBe(5000);
  });

  it('adds quest XP directly', () => {
    const sources: RangerXPSources = { questXPEarned: 750 };
    expect(computeRangerXP(sources)).toBe(750);
  });

  it('adds text quest XP (×500 each)', () => {
    const sources: RangerXPSources = { completedTextQuests: 3 };
    expect(computeRangerXP(sources)).toBe(1500);
  });

  it('adds coins XP (/200, capped at 1000)', () => {
    const sources: RangerXPSources = { totalCoins: 2000 }; // 2000/200 = 10
    expect(computeRangerXP(sources)).toBe(10);

    const capped: RangerXPSources = { totalCoins: 300000 }; // would be 1500, capped 1000
    expect(computeRangerXP(capped)).toBe(1000);
  });

  it('caps orbit games played at 1000 XP', () => {
    const sources: RangerXPSources = {
      gameStats: {
        orbit: { gamesPlayed: 1000, totalSurvivalTime: 0 },
      },
    };
    expect(computeRangerXP(sources)).toBe(1000); // 1000×5=5000 capped at 1000
  });

  it('adds multiple sources correctly', () => {
    const sources: RangerXPSources = {
      gameBestScores: { orbit_survival: 100 }, // 100×5 = 500
      achievementCount: 2, // 400
      questXPEarned: 300, // 300
    };
    expect(computeRangerXP(sources)).toBe(1200);
  });

  it('never returns negative XP', () => {
    expect(computeRangerXP({ totalCoins: 0, achievementCount: 0 })).toBeGreaterThanOrEqual(0);
  });
});
