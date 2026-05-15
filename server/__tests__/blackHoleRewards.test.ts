import { describe, expect, it } from 'vitest';
import {
  BLACKHOLE_REWARD_CAP,
  calculateBlackHoleReward,
} from '../services/blackHoleRewards.js';

describe('Black Hole reward calculation', () => {
  it('keeps count-based rewards even when net SOL is negative after fees', () => {
    expect(calculateBlackHoleReward(2, 1, -0.0004)).toBe(31);
  });

  it('adds SOL-derived reward only for positive net SOL', () => {
    expect(calculateBlackHoleReward(1, 0, 0.0034)).toBe(32);
  });

  it('respects the global reward cap', () => {
    expect(calculateBlackHoleReward(100, 100, 1)).toBe(BLACKHOLE_REWARD_CAP);
  });
});
