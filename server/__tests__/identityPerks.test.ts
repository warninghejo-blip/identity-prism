import { describe, expect, it } from 'vitest';
import {
  BLACKHOLE_HOLDER_COMMISSION_RATE,
  BLACKHOLE_STANDARD_COMMISSION_RATE,
  buildIdentityHolderPerks,
  GAME_SESSION_ONCHAIN_BONUS_MULTIPLIER,
  IDENTITY_GAME_COIN_MULTIPLIER,
  normalizeGameCoinDeltaForCap,
  scaleAppliedGameCoinDelta,
} from '../services/identityPerks.js';

describe('identity perks helpers', () => {
  it('builds holder perks with game multiplier and reduced Black Hole commission', () => {
    const perks = buildIdentityHolderPerks(true, 3);

    expect(perks.hasIdentityPrism).toBe(true);
    expect(perks.gameCoinMultiplier).toBe(IDENTITY_GAME_COIN_MULTIPLIER);
    expect(perks.freeRevivesPerDay).toBe(3);
    expect(perks.blackHoleCommissionRate).toBe(BLACKHOLE_HOLDER_COMMISSION_RATE);
    expect(perks.standardBlackHoleCommissionRate).toBe(BLACKHOLE_STANDARD_COMMISSION_RATE);
  });

  it('builds non-holder perks with neutral multiplier and standard commission', () => {
    const perks = buildIdentityHolderPerks(false, 3);

    expect(perks.hasIdentityPrism).toBe(false);
    expect(perks.gameCoinMultiplier).toBe(1);
    expect(perks.freeRevivesPerDay).toBe(0);
    expect(perks.blackHoleCommissionRate).toBe(BLACKHOLE_STANDARD_COMMISSION_RATE);
  });

  it('normalizes holder deltas for cap tracking without dropping positive odd bonuses to zero', () => {
    expect(normalizeGameCoinDeltaForCap(202, IDENTITY_GAME_COIN_MULTIPLIER)).toBe(101);
    expect(normalizeGameCoinDeltaForCap(101, IDENTITY_GAME_COIN_MULTIPLIER)).toBe(50);
    expect(normalizeGameCoinDeltaForCap(1, IDENTITY_GAME_COIN_MULTIPLIER)).toBe(1);
    expect(normalizeGameCoinDeltaForCap(300, 1)).toBe(300);
  });

  it('scales applied deltas down proportionally when normalized allowance is clipped', () => {
    expect(scaleAppliedGameCoinDelta(202, 101, 50)).toBe(100);
    expect(scaleAppliedGameCoinDelta(101, 50, 50)).toBe(101);
    expect(scaleAppliedGameCoinDelta(300, 150, 0)).toBe(0);
  });

  it('keeps the documented 1.5x session allowance for on-chain game bonus on base earnings', () => {
    expect(GAME_SESSION_ONCHAIN_BONUS_MULTIPLIER).toBe(1.5);
  });
});
