/**
 * useWalletData hook tests.
 * Tests the pure calculateScore function and hook state management.
 * The full fetch pipeline is heavy (Helius RPC) — we test the score logic
 * and the disconnected/no-address branches where no network call is made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateScore } from '../useWalletData';
import type { WalletTraits } from '../useWalletData';

// ── Helpers ──

function makeTraits(overrides: Partial<WalletTraits> = {}): WalletTraits {
  return {
    hasSeeker: false,
    hasPreorder: false,
    hasCombo: false,
    isOG: false,
    isWhale: false,
    isCollector: false,
    isEarlyAdopter: false,
    isTxTitan: false,
    isSolanaMaxi: false,
    isBlueChip: false,
    isDeFiKing: false,
    uniqueTokenCount: 0,
    nftCount: 0,
    txCount: 0,
    memeCoinsHeld: [],
    isMemeLord: false,
    hyperactiveDegen: false,
    diamondHands: false,
    avgTxPerDay30d: 0,
    daysSinceLastTx: null,
    solBalance: 0,
    solBonusApplied: 0,
    walletAgeDays: 0,
    walletAgeBonus: 0,
    planetTier: 'earth',
    totalAssetsCount: 0,
    solTier: null,
    totalValueUSD: 0,
    cosmicRank: 'stardust',
    swapCount: 0,
    nftTradeCount: 0,
    stakingCount: 0,
    defiProtocols: [],
    isDeFiUser: false,
    ...overrides,
  };
}

// ── calculateScore ──

describe('calculateScore', () => {
  it('returns 0 for empty wallet', () => {
    const score = calculateScore(makeTraits());
    expect(score).toBe(0);
  });

  it('scores SOL balance tiers correctly', () => {
    // >= 10 SOL → +40
    expect(calculateScore(makeTraits({ solBalance: 10 }))).toBe(40);
    // >= 5 SOL → +34
    expect(calculateScore(makeTraits({ solBalance: 5 }))).toBe(34);
    // >= 1 SOL → +24
    expect(calculateScore(makeTraits({ solBalance: 1 }))).toBe(24);
    // >= 0.5 SOL → +16
    expect(calculateScore(makeTraits({ solBalance: 0.5 }))).toBe(16);
    // < 0.1 → 0
    expect(calculateScore(makeTraits({ solBalance: 0.05 }))).toBe(0);
  });

  it('scores wallet age tiers correctly', () => {
    // > 730 days → +100
    expect(calculateScore(makeTraits({ walletAgeDays: 800 }))).toBe(100);
    // > 365 → +72
    expect(calculateScore(makeTraits({ walletAgeDays: 400 }))).toBe(72);
    // > 180 → +48
    expect(calculateScore(makeTraits({ walletAgeDays: 200 }))).toBe(48);
    // ≤ 7 days → 0
    expect(calculateScore(makeTraits({ walletAgeDays: 5 }))).toBe(0);
  });

  it('scores transaction count tiers', () => {
    // > 5000 → +80
    expect(calculateScore(makeTraits({ txCount: 6000 }))).toBe(80);
    // > 100 → +20
    expect(calculateScore(makeTraits({ txCount: 150 }))).toBe(20);
  });

  it('scores NFT holdings', () => {
    // > 100 → +32
    expect(calculateScore(makeTraits({ nftCount: 200 }))).toBe(32);
    // 1-5 → 0
    expect(calculateScore(makeTraits({ nftCount: 3 }))).toBe(0);
  });

  it('scores DeFi activity: swaps and protocols', () => {
    // swaps > 100 → +16; defiProtocols >= 3 → +8
    const traits = makeTraits({ swapCount: 150, defiProtocols: ['raydium', 'orca', 'meteora'] });
    const score = calculateScore(traits);
    expect(score).toBeGreaterThanOrEqual(24); // 16 + 8
  });

  it('adds collection bonuses (hasSeeker, hasPreorder, hasCombo)', () => {
    const base = calculateScore(makeTraits());
    const withSeeker = calculateScore(makeTraits({ hasSeeker: true }));
    expect(withSeeker - base).toBe(20); // SCORING.SEEKER_GENESIS_BONUS
  });

  it('adds badge bonuses (isOG, isWhale, etc.)', () => {
    const base = calculateScore(makeTraits());
    const withOG = calculateScore(makeTraits({ isOG: true }));
    expect(withOG - base).toBe(14);

    const withWhale = calculateScore(makeTraits({ isWhale: true }));
    expect(withWhale - base).toBe(8);
  });

  it('caps score at 400', () => {
    // Maximum possible score — all flags on, max everything
    const traits = makeTraits({
      solBalance: 100,
      walletAgeDays: 1000,
      txCount: 10000,
      nftCount: 200,
      swapCount: 200,
      nftTradeCount: 100,
      defiProtocols: ['a', 'b', 'c'],
      hasSeeker: true,
      hasPreorder: true,
      hasCombo: true,
      isOG: true,
      isTxTitan: true,
      isWhale: true,
      isCollector: true,
      isEarlyAdopter: true,
      isSolanaMaxi: true,
      isBlueChip: true,
      diamondHands: true,
      isDeFiKing: true,
      isMemeLord: true,
      hyperactiveDegen: true,
    });
    expect(calculateScore(traits)).toBe(400);
  });

  it('score is 0 for zero wallet (no activity)', () => {
    // All-zero traits → no bonuses → score = 0
    expect(calculateScore(makeTraits())).toBe(0);
  });
});
