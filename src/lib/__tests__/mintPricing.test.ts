import { describe, it, expect } from 'vitest';
import { formatMintCost, MINT_COIN_COST } from '../mintPricing';

describe('formatMintCost', () => {
  it('shows the fixed 0.03 SOL price when paying with SOL', () => {
    expect(formatMintCost('SOL', null)).toBe('0.03 SOL');
  });

  it('shows the fixed PRISM-coin cost when paying with COINS', () => {
    expect(MINT_COIN_COST).toBe(10000);
    expect(formatMintCost('COINS', null)).toBe(`${(10000).toLocaleString()} PRISM`);
  });

  it('shows a placeholder for SKR until the live quote loads', () => {
    expect(formatMintCost('SKR', null)).toBe('… SKR');
  });

  it('shows the rounded live SKR quote once loaded', () => {
    expect(formatMintCost('SKR', 1249.6)).toBe(`${(1250).toLocaleString()} SKR`);
  });
});
