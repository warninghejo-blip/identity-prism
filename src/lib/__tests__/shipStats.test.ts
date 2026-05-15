import { describe, it, expect } from 'vitest';
import {
  computeShipStats,
  applyFrameToBreakdown,
  getEquipmentBonusLabel,
  DEFAULT_SHIP_STATS,
  FRAME_BONUSES,
  SKIN_BONUSES,
} from '../shipStats';
import type { WalletPreview, CompositeBreakdown } from '@/components/prism/shared';

// ── Helpers ──

function makeBreakdown(overrides: Partial<CompositeBreakdown> = {}): CompositeBreakdown {
  return { onchain: 0, sybilTrust: 0, humanProof: 0, social: 0, engagement: 0, ...overrides };
}

function makePreview(breakdown: CompositeBreakdown, score = 100): WalletPreview {
  return {
    address: 'TestAddr',
    score: 0,
    tier: 'earth',
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
    compositeTier: 'earth',
    compositeBadgeCount: 0,
    compositeBreakdown: breakdown,
  };
}

// ── Tests ──

describe('computeShipStats', () => {
  it('returns DEFAULT_SHIP_STATS for null preview', () => {
    expect(computeShipStats(null, null)).toEqual(DEFAULT_SHIP_STATS);
  });

  it('returns DEFAULT_SHIP_STATS when compositeScore is null', () => {
    const preview = makePreview(makeBreakdown(), 0);
    (preview as Record<string, unknown>).compositeScore = null;
    expect(computeShipStats(preview, null)).toEqual(DEFAULT_SHIP_STATS);
  });

  it('derives base stats from known breakdown (no equipment)', () => {
    const bd = makeBreakdown({ onchain: 200, sybilTrust: 125, engagement: 100, social: 100, humanProof: 75 });
    const preview = makePreview(bd, 600);
    const stats = computeShipStats(preview, null);

    // Speed: 5 + (100+100)/200 * 65 = 5 + 65 = 70
    expect(stats.speed).toBe(70);
    // Shield: 5 + 125/250 * 65 = 5 + 32.5 = 38 (rounded)
    expect(stats.shield).toBe(38);
    // Firepower: 5 + 200/400 * 65 = 5 + 32.5 = 38
    expect(stats.firepower).toBe(38);
    // Luck: 5 + 75/150 * 65 = 5 + 32.5 = 38
    expect(stats.luck).toBe(38);
  });

  it('clamps stats to 0-100 range', () => {
    // Max out all breakdown values well beyond caps
    const bd = makeBreakdown({ onchain: 9999, sybilTrust: 9999, engagement: 9999, social: 9999, humanProof: 9999 });
    const preview = makePreview(bd, 9999);
    const stats = computeShipStats(preview, null);

    expect(stats.speed).toBeLessThanOrEqual(100);
    expect(stats.shield).toBeLessThanOrEqual(100);
    expect(stats.firepower).toBeLessThanOrEqual(100);
    expect(stats.luck).toBeLessThanOrEqual(100);
  });

  it('applies skin bonuses correctly', () => {
    const bd = makeBreakdown(); // all zero → base = 5 each
    const preview = makePreview(bd, 0);
    const loadout = { equippedShipSkin: 'ship_manta', equippedFrame: null, equippedAura: null, equippedTitle: null };
    const stats = computeShipStats(preview, loadout);

    // manta: +8 spd, +8 shd, +8 fp, +8 lck → base 5 + 8 = 13 each
    expect(stats.speed).toBe(13);
    expect(stats.shield).toBe(13);
    expect(stats.firepower).toBe(13);
    expect(stats.luck).toBe(13);
  });
});

describe('applyFrameToBreakdown', () => {
  it('returns original breakdown when no frame equipped', () => {
    const bd = makeBreakdown({ onchain: 50 });
    expect(applyFrameToBreakdown(bd, null)).toEqual(bd);
    expect(applyFrameToBreakdown(bd, { equippedShipSkin: null, equippedFrame: null, equippedAura: null })).toEqual(bd);
  });

  it('applies solar_flare frame bonus to onchain and humanProof', () => {
    const bd = makeBreakdown({ onchain: 100, humanProof: 10 });
    const loadout = { equippedShipSkin: null, equippedFrame: 'frame_solar_flare', equippedAura: null };
    const result = applyFrameToBreakdown(bd, loadout);

    expect(result.onchain).toBe(100 + FRAME_BONUSES.solar_flare.onchain!);
    expect(result.humanProof).toBe(10 + FRAME_BONUSES.solar_flare.humanProof!);
    // Unchanged categories
    expect(result.sybilTrust).toBe(0);
    expect(result.social).toBe(0);
    expect(result.engagement).toBe(0);
  });
});

describe('getEquipmentBonusLabel', () => {
  it('returns null for null equipId', () => {
    expect(getEquipmentBonusLabel(null, 'skin')).toBeNull();
  });

  it('returns correct label for manta skin', () => {
    const label = getEquipmentBonusLabel('ship_manta', 'skin');
    expect(label).toBe('+8 spd, +8 shd, +8 fp, +8 lck');
  });

  it('returns correct label for solar_flare frame (composite format)', () => {
    const label = getEquipmentBonusLabel('frame_solar_flare', 'frame');
    expect(label).toContain('+30 Chain');
    expect(label).toContain('+5 Proof');
  });

  it('returns percentage format for aura bonuses', () => {
    const label = getEquipmentBonusLabel('aura_frost', 'aura');
    expect(label).toBe('+10% shd');
  });

  it('returns null for unknown equipment', () => {
    expect(getEquipmentBonusLabel('ship_nonexistent', 'skin')).toBeNull();
  });
});
