/**
 * prismCoin — unit tests for pure/synchronous exports:
 * PRISM_EARN_RATES, COIN_PACKAGES, calculateGamePrism, calculateBurnPrism.
 * No network or wallet mocking needed.
 */

import { describe, it, expect } from 'vitest';
import {
  PRISM_EARN_RATES,
  COIN_PACKAGES,
  calculateGamePrism,
  calculateBurnPrism,
  type PrismEarnSource,
} from '../prismCoin';

describe('PRISM_EARN_RATES', () => {
  it('has a numeric rate for every earn source', () => {
    const sources: PrismEarnSource[] = [
      'game_orbit',
      'game_defender',
      'game_gravity',
      'burn_tokens',
      'burn_nfts',
      'blackhole_cleanup',
      'scan_wallet',
      'achievement',
      'quest_daily',
      'quest_weekly',
      'quest_milestone',
      'challenge_win',
      'first_mint',
      'text_quest',
      'sybil_hunt',
      'quiz',
    ];
    for (const src of sources) {
      expect(typeof PRISM_EARN_RATES[src]).toBe('number');
    }
  });

  it('first_mint rate is 1000 (one-time bonus)', () => {
    expect(PRISM_EARN_RATES.first_mint).toBe(1000);
  });

  it('achievement rate is greater than quest_daily rate (25 vs 15)', () => {
    expect(PRISM_EARN_RATES.achievement).toBeGreaterThan(PRISM_EARN_RATES.quest_daily);
  });

  it('quest_milestone rate is highest quest rate', () => {
    expect(PRISM_EARN_RATES.quest_milestone).toBeGreaterThan(PRISM_EARN_RATES.quest_weekly);
    expect(PRISM_EARN_RATES.quest_weekly).toBeGreaterThan(PRISM_EARN_RATES.quest_daily);
  });

  it('burn_nfts rate > burn_tokens rate', () => {
    expect(PRISM_EARN_RATES.burn_nfts).toBeGreaterThan(PRISM_EARN_RATES.burn_tokens);
  });
});

describe('COIN_PACKAGES', () => {
  it('has 4 packages', () => {
    expect(COIN_PACKAGES.length).toBe(4);
  });

  it('packages are sorted by ascending coin count', () => {
    for (let i = 1; i < COIN_PACKAGES.length; i++) {
      expect(COIN_PACKAGES[i].coins).toBeGreaterThan(COIN_PACKAGES[i - 1].coins);
    }
  });

  it('packages are sorted by ascending sol price', () => {
    for (let i = 1; i < COIN_PACKAGES.length; i++) {
      expect(COIN_PACKAGES[i].solPrice).toBeGreaterThan(COIN_PACKAGES[i - 1].solPrice);
    }
  });

  it('all packages have positive coin count and positive sol price', () => {
    for (const pkg of COIN_PACKAGES) {
      expect(pkg.coins).toBeGreaterThan(0);
      expect(pkg.solPrice).toBeGreaterThan(0);
      expect(typeof pkg.label).toBe('string');
    }
  });
});

describe('calculateGamePrism', () => {
  it('orbit: 1 PRISM per 100 points', () => {
    expect(calculateGamePrism('orbit', 100)).toBe(1);
    expect(calculateGamePrism('orbit', 500)).toBe(5);
    expect(calculateGamePrism('orbit', 1000)).toBe(10);
  });

  it('orbit: minimum 1 even for 0 score', () => {
    expect(calculateGamePrism('orbit', 0)).toBe(1);
  });

  it('orbit: floors partial points', () => {
    expect(calculateGamePrism('orbit', 150)).toBe(1); // 1.5 → floor 1
    expect(calculateGamePrism('orbit', 250)).toBe(2);
  });

  it('gravity: 1 PRISM per 80 points, min 1', () => {
    expect(calculateGamePrism('gravity', 0)).toBe(1);
    expect(calculateGamePrism('gravity', 80)).toBe(1);
    expect(calculateGamePrism('gravity', 160)).toBe(2);
    expect(calculateGamePrism('gravity', 800)).toBe(10);
  });

  it('destroyer: 2 PRISM per level + score bonus per 500', () => {
    // level=1, score=0 → 2 + 0 = 2
    expect(calculateGamePrism('destroyer', 0, 1)).toBe(2);
    // level=3, score=1000 → 6 + 2 = 8
    expect(calculateGamePrism('destroyer', 1000, 3)).toBe(8);
  });

  it('destroyer defaults to level 1 when level is omitted', () => {
    expect(calculateGamePrism('destroyer', 0)).toBe(2);
  });
});

describe('calculateBurnPrism', () => {
  it('returns 0 for no burns', () => {
    expect(calculateBurnPrism(0, 0)).toBe(0);
  });

  it('calculates token burns correctly', () => {
    expect(calculateBurnPrism(3, 0)).toBe(3 * PRISM_EARN_RATES.burn_tokens);
  });

  it('calculates nft burns correctly', () => {
    expect(calculateBurnPrism(0, 2)).toBe(2 * PRISM_EARN_RATES.burn_nfts);
  });

  it('combines token and nft burns', () => {
    const expected = 5 * PRISM_EARN_RATES.burn_tokens + 3 * PRISM_EARN_RATES.burn_nfts;
    expect(calculateBurnPrism(5, 3)).toBe(expected);
  });

  it('nfts contribute more per unit than tokens', () => {
    expect(calculateBurnPrism(0, 1)).toBeGreaterThan(calculateBurnPrism(1, 0));
  });
});
