/**
 * shipStats — extended edge-case tests for getBoostedCompositeScore,
 * applyFrameToBreakdown with unknown frames, title/aura bonus tables,
 * and stat capping behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  getBoostedCompositeScore,
  applyFrameToBreakdown,
  computeShipStats,
  getEquipmentBonusLabel,
  getEquipmentBonusLines,
  DEFAULT_SHIP_STATS,
  FRAME_BONUSES,
  TITLE_BONUSES,
  AURA_BONUSES,
  SKIN_BONUSES,
} from '../shipStats';
import type { CompositeBreakdown } from '@/components/prism/shared';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBreakdown(overrides: Partial<CompositeBreakdown> = {}): CompositeBreakdown {
  return { onchain: 0, sybilTrust: 0, humanProof: 0, social: 0, engagement: 0, ...overrides };
}

function makePreview(bd: CompositeBreakdown, score = 0) {
  return {
    address: 'Addr',
    score: 0,
    tier: 'earth' as const,
    badges: [],
    solBalance: 0,
    txCount: 0,
    walletAgeDays: 0,
    tokenCount: 0,
    nftCount: 0,
    trustGrade: null,
    trustScore: null,
    riskLevel: null,
    topPrograms: [],
    compositeScore: score,
    compositeTier: 'earth' as const,
    compositeBadgeCount: 0,
    compositeBreakdown: bd,
  };
}

// ── getBoostedCompositeScore ──────────────────────────────────────────────────

describe('getBoostedCompositeScore', () => {
  it('returns null for null breakdown', () => {
    expect(getBoostedCompositeScore(null, null)).toBeNull();
  });

  it('sums all breakdown fields without loadout', () => {
    const bd = makeBreakdown({ onchain: 100, sybilTrust: 50, humanProof: 30, social: 20, engagement: 10 });
    const result = getBoostedCompositeScore(bd, null);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(210);
  });

  it('applies frame bonus to score when frame is equipped', () => {
    const bd = makeBreakdown({ onchain: 100 });
    const baseResult = getBoostedCompositeScore(bd, null);
    const boostedResult = getBoostedCompositeScore(bd, {
      equippedFrame: 'frame_solar_flare',
      equippedShipSkin: null,
      equippedAura: null,
    });
    // solar_flare adds to onchain, so boosted score should be higher
    expect(boostedResult!.score).toBeGreaterThan(baseResult!.score);
  });

  it('returns breakdown with all five fields', () => {
    const bd = makeBreakdown({ onchain: 10 });
    const result = getBoostedCompositeScore(bd, null);
    expect(result!.breakdown).toHaveProperty('onchain');
    expect(result!.breakdown).toHaveProperty('sybilTrust');
    expect(result!.breakdown).toHaveProperty('humanProof');
    expect(result!.breakdown).toHaveProperty('social');
    expect(result!.breakdown).toHaveProperty('engagement');
  });
});

// ── applyFrameToBreakdown edge cases ─────────────────────────────────────────

describe('applyFrameToBreakdown — edge cases', () => {
  it('returns original breakdown for unknown frame key', () => {
    const bd = makeBreakdown({ onchain: 50 });
    const result = applyFrameToBreakdown(bd, {
      equippedFrame: 'frame_nonexistent_xyz',
      equippedShipSkin: null,
      equippedAura: null,
    });
    expect(result).toEqual(bd);
  });

  it('does not mutate the original breakdown object', () => {
    const bd = makeBreakdown({ onchain: 100 });
    const frameName = Object.keys(FRAME_BONUSES)[0];
    applyFrameToBreakdown(bd, {
      equippedFrame: `frame_${frameName}`,
      equippedShipSkin: null,
      equippedAura: null,
    });
    expect(bd.onchain).toBe(100); // unchanged
  });

  it('handles all keys defined in FRAME_BONUSES without throwing', () => {
    const bd = makeBreakdown({ onchain: 10, sybilTrust: 10, humanProof: 10, social: 10, engagement: 10 });
    for (const key of Object.keys(FRAME_BONUSES)) {
      expect(() =>
        applyFrameToBreakdown(bd, { equippedFrame: `frame_${key}`, equippedShipSkin: null, equippedAura: null }),
      ).not.toThrow();
    }
  });
});

// ── TITLE_BONUSES integrity ───────────────────────────────────────────────────

describe('TITLE_BONUSES', () => {
  it('ascended has highest luck bonus among all titles', () => {
    const lucks = Object.values(TITLE_BONUSES).map((b) => b.luck ?? 0);
    expect(TITLE_BONUSES.ascended.luck).toBe(Math.max(...lucks));
  });

  it('harbinger has the highest combined stat budget', () => {
    const sum = (b: Partial<Record<string, number>>) => Object.values(b).reduce((a, v) => a + (v ?? 0), 0);
    const harbingerSum = sum(TITLE_BONUSES.harbinger as Record<string, number>);
    for (const [name, bonus] of Object.entries(TITLE_BONUSES)) {
      if (name !== 'harbinger') {
        expect(harbingerSum).toBeGreaterThanOrEqual(sum(bonus as Record<string, number>));
      }
    }
  });

  it('all title bonus values are positive numbers', () => {
    for (const [, bonus] of Object.entries(TITLE_BONUSES)) {
      for (const val of Object.values(bonus)) {
        expect(val).toBeGreaterThan(0);
      }
    }
  });
});

// ── AURA_BONUSES integrity ────────────────────────────────────────────────────

describe('AURA_BONUSES', () => {
  it('all aura bonus values are fractional percentages (0 < val <= 1)', () => {
    for (const [, bonus] of Object.entries(AURA_BONUSES)) {
      for (const val of Object.values(bonus)) {
        expect(val).toBeGreaterThan(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    }
  });

  it('dark_matter has highest shield bonus', () => {
    const shields = Object.values(AURA_BONUSES).map((b) => b.shield ?? 0);
    expect(AURA_BONUSES.dark_matter.shield).toBe(Math.max(...shields));
  });
});

// ── computeShipStats stat capping ────────────────────────────────────────────

describe('computeShipStats — stat capping', () => {
  it('stats never exceed 70 even for extreme breakdown values', () => {
    const bd = makeBreakdown({ onchain: 9999, sybilTrust: 9999, humanProof: 9999, social: 9999, engagement: 9999 });
    const preview = makePreview(bd, 9999);
    const stats = computeShipStats(preview, null);
    expect(stats.speed).toBeLessThanOrEqual(70);
    expect(stats.shield).toBeLessThanOrEqual(70);
    expect(stats.firepower).toBeLessThanOrEqual(70);
    expect(stats.luck).toBeLessThanOrEqual(70);
  });

  it('stats never go below 5 for zero breakdown', () => {
    const bd = makeBreakdown();
    const preview = makePreview(bd, 0);
    // compositeScore must be non-null for computeShipStats to proceed
    const stats = computeShipStats(preview, null);
    // When score is 0, computeShipStats returns DEFAULT_SHIP_STATS
    expect(Object.values(stats).every((v) => v >= 5)).toBe(true);
  });

  it('DEFAULT_SHIP_STATS is symmetric (all stats equal)', () => {
    const vals = Object.values(DEFAULT_SHIP_STATS);
    expect(vals.every((v) => v === vals[0])).toBe(true);
  });
});

// ── getEquipmentBonusLines ────────────────────────────────────────────────────

describe('getEquipmentBonusLines', () => {
  it('returns array with entries for a valid skin', () => {
    const lines = getEquipmentBonusLines('ship_manta', 'skin');
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('returns empty array for unknown equipment', () => {
    const lines = getEquipmentBonusLines('ship_doesnotexist', 'skin');
    expect(lines).toEqual([]);
  });
});
