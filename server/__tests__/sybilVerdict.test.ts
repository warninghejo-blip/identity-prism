import { describe, expect, it } from 'vitest';
import { deriveSybilVerdictFromAnalysis, getCompositeTrustProfile } from '../services/sybilVerdict.js';

type SignalCategory = 'behavioral' | 'financial' | 'network';
type SignalSeverity = 'info' | 'warning' | 'danger';

const makeSignal = (
  id: string,
  category: SignalCategory,
  weight: number,
  severity: SignalSeverity = 'warning',
  detected = true,
) => ({
  id,
  name: id,
  category,
  detected,
  weight,
  severity,
  value: '',
  description: id,
});

const baseMetrics = {
  txCount: 120,
  siblingCount: 0,
  fundingChainDepth: 0,
  topFunderTxCount: 0,
  topFunderPct: 0,
  walletAgeDays: 720,
  activeDaysRatio: 0.22,
  uniquePrograms: 10,
  tokenDiversityCount: 12,
  nftCount: 4,
  uniqueSenders: 6,
  hasSolDomain: true,
  defiDepth: 2,
};

const makeAnalysis = (overrides: Record<string, unknown> = {}) => ({
  riskScore: 18,
  trustScore: 82,
  signals: [] as ReturnType<typeof makeSignal>[],
  metrics: baseMetrics,
  ...overrides,
});

describe('deriveSybilVerdictFromAnalysis', () => {
  it('marks thin-history wallets as unknown instead of bounty-grade sybil', () => {
    const verdict = deriveSybilVerdictFromAnalysis(
      makeAnalysis({
        riskScore: 51,
        trustScore: 49,
        signals: [
          makeSignal('no_history', 'behavioral', 30, 'danger'),
          makeSignal('wallet_age', 'behavioral', 12, 'warning'),
          makeSignal('low_token_diversity', 'financial', 5, 'warning'),
          makeSignal('no_nft_holdings', 'financial', 4, 'info'),
        ],
        metrics: {
          ...baseMetrics,
          txCount: 2,
          walletAgeDays: 2,
          activeDaysRatio: 0.02,
          uniquePrograms: 0,
          tokenDiversityCount: 1,
          nftCount: 0,
          uniqueSenders: 1,
          hasSolDomain: false,
          defiDepth: 0,
        },
      }),
    );

    expect(verdict?.key).toBe('unknown');
    expect(verdict?.bountyEligible).toBe(false);
    expect(verdict?.dataQuality).toBe('thin');
  });

  it('upgrades graph-backed clusters to confirmed sybil', () => {
    const verdict = deriveSybilVerdictFromAnalysis(
      makeAnalysis({
        riskScore: 82,
        trustScore: 18,
        signals: [
          makeSignal('graph_intelligence', 'network', 20, 'danger'),
          makeSignal('hub_spoke', 'network', 15, 'danger'),
          makeSignal('repeated_funder', 'network', 16, 'danger'),
          makeSignal('timing_pattern', 'behavioral', 18, 'danger'),
        ],
        metrics: {
          ...baseMetrics,
          txCount: 240,
          walletAgeDays: 45,
          activeDaysRatio: 0.03,
          uniquePrograms: 2,
          tokenDiversityCount: 1,
          nftCount: 0,
          uniqueSenders: 1,
          hasSolDomain: false,
          defiDepth: 0,
          siblingCount: 12,
          fundingChainDepth: 2,
          topFunderTxCount: 6,
          topFunderPct: 88,
        },
      }),
    );

    expect(verdict?.key).toBe('confirmed_sybil');
    expect(verdict?.networkConfirmed).toBe(true);
    expect(verdict?.rewardPath).toBe('sybil_hunt');
  });

  it('keeps hybrid high-risk wallets bounty-eligible as probable sybil', () => {
    const verdict = deriveSybilVerdictFromAnalysis(
      makeAnalysis({
        riskScore: 58,
        trustScore: 42,
        signals: [
          makeSignal('repeated_funder', 'network', 12, 'warning'),
          makeSignal('timing_pattern', 'behavioral', 18, 'danger'),
          makeSignal('airdrop_farming', 'behavioral', 18, 'danger'),
        ],
        metrics: {
          ...baseMetrics,
          txCount: 110,
          walletAgeDays: 80,
          activeDaysRatio: 0.08,
          uniquePrograms: 3,
          tokenDiversityCount: 2,
          nftCount: 0,
          uniqueSenders: 1,
          hasSolDomain: false,
          defiDepth: 0,
          siblingCount: 2,
          fundingChainDepth: 1,
          topFunderTxCount: 4,
          topFunderPct: 62,
        },
      }),
    );

    expect(verdict?.key).toBe('probable_sybil');
    expect(verdict?.bountyEligible).toBe(true);
  });

  it('surfaces linked clusters as watchlist targets when proof is not strong enough yet', () => {
    const verdict = deriveSybilVerdictFromAnalysis(
      makeAnalysis({
        riskScore: 38,
        trustScore: 62,
        signals: [
          makeSignal('hub_spoke', 'network', 8, 'warning'),
          makeSignal('concentrated_funding', 'network', 10, 'warning'),
        ],
        metrics: {
          ...baseMetrics,
          txCount: 40,
          walletAgeDays: 50,
          activeDaysRatio: 0.07,
          uniquePrograms: 3,
          tokenDiversityCount: 2,
          nftCount: 0,
          uniqueSenders: 2,
          hasSolDomain: false,
          defiDepth: 0,
          siblingCount: 4,
          fundingChainDepth: 1,
          topFunderTxCount: 2,
          topFunderPct: 55,
        },
      }),
    );

    expect(verdict?.key).toBe('cluster_linked');
    expect(verdict?.bountyEligible).toBe(false);
  });

  it('keeps organic rich-history wallets clean', () => {
    const verdict = deriveSybilVerdictFromAnalysis(
      makeAnalysis({
        riskScore: 8,
        trustScore: 92,
        metrics: {
          ...baseMetrics,
          txCount: 520,
          walletAgeDays: 1100,
          activeDaysRatio: 0.28,
          uniquePrograms: 16,
          tokenDiversityCount: 18,
          nftCount: 9,
          uniqueSenders: 9,
          hasSolDomain: true,
          defiDepth: 3,
        },
      }),
    );

    expect(verdict?.key).toBe('clean');
    expect(verdict?.rewardPath).toBe('scan_wallet');
    expect(verdict?.confidence).toBe('high');
  });
});

describe('getCompositeTrustProfile', () => {
  it('keeps unknown wallets neutral in composite without granting clean-wallet badges', () => {
    const profile = getCompositeTrustProfile({
      verdict: { key: 'unknown', label: 'Unknown / Thin Data' },
      trustScore: 12,
      recoveryBonus: 25,
    });

    expect(profile.baseCompositeTrust).toBe(50);
    expect(profile.recoveryBonus).toBe(10);
    expect(profile.effectiveTrust).toBe(60);
    expect(profile.allowBadges).toBe(false);
  });

  it('preserves clean-wallet upside for composite trust', () => {
    const profile = getCompositeTrustProfile({
      verdict: { key: 'clean', label: 'Clean' },
      trustScore: 82,
      recoveryBonus: 12,
    });

    expect(profile.baseCompositeTrust).toBe(82);
    expect(profile.recoveryBonus).toBe(12);
    expect(profile.effectiveTrust).toBe(94);
    expect(profile.allowBadges).toBe(true);
  });

  it('keeps confirmed sybils heavily penalized even if recovery signals exist', () => {
    const profile = getCompositeTrustProfile({
      verdict: { key: 'confirmed_sybil', label: 'Confirmed Sybil' },
      trustScore: 12,
      recoveryBonus: 10,
    });

    expect(profile.baseCompositeTrust).toBe(12);
    expect(profile.recoveryBonus).toBe(0);
    expect(profile.effectiveTrust).toBe(12);
    expect(profile.allowBadges).toBe(false);
  });
});
