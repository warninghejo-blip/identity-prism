import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScanOrchestrator } from '../services/scanOrchestrator.js';

// Shared mutable mock methods — re-usable across tests
const mockGetBalance = vi.fn(async () => 1_000_000_000);
const mockGetTokenAccounts = vi.fn(async () => ({ value: [] }));
const mockGetSignatures = vi.fn(async () => []);
const mockGetProgramAccounts = vi.fn(async () => []);

vi.mock('@solana/web3.js', () => ({
  Connection: vi.fn(function () {
    return {
      getBalance: mockGetBalance,
      getParsedTokenAccountsByOwner: mockGetTokenAccounts,
      getSignaturesForAddress: mockGetSignatures,
      getProgramAccounts: mockGetProgramAccounts,
    };
  }),
  PublicKey: vi.fn(function (addr: string) {
    return { toBase58: () => addr, toString: () => addr };
  }),
}));

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    getRpcUrl: vi.fn(() => 'https://fake-rpc.example.com'),
    getBatchRpcUrl: vi.fn(() => 'https://fake-batch.example.com'),
    batchGetParsedTxs: vi.fn(async () => []),
    resolveAccountKey: vi.fn((a: unknown) => a),
    walletDatabase: new Map(),
    updateWalletEntry: vi.fn(),
    triggerCompositeUpdate: vi.fn(),
    getSybilVerdict: vi.fn(() => null),
    sybilGraph: { nodes: new Map(), edges: [], flaggedClusters: [] },
    saveSybilGraph: vi.fn(),
    updateSybilGraphNode: vi.fn(),
    checkGraphForKnownSybils: vi.fn(() => ({ graphRisk: 0, graphDetails: [] })),
    loadSybilCacheEntry: vi.fn(() => null),
    refreshCachedSybilAnalysis: vi.fn(),
    persistSybilAnalysis: vi.fn(),
    persistAutoDetectedScanClusters: vi.fn(),
    fetchSybilSampleFor: vi.fn(async () => null),
    findFirstTxTime: vi.fn(async () => null),
    getDominantFundingSource: vi.fn(() => ({ address: null, amount: 0, count: 0, share: 0 })),
    getDominantTokenFundingSource: vi.fn(() => ({ address: null, amount: 0, count: 0, share: 0, mints: [] })),
    summarizeEnhancedTxHistory: vi.fn(() => ({})),
    fetchEnhancedTxHistory: vi.fn(async () => null),
    fetchDominantEnhancedFunder: vi.fn(async () => null),
    isProgramAddress: vi.fn(() => false),
    extractSolTransfers: vi.fn(() => ({ incoming: new Map(), outgoing: new Map() })),
    detectTemporalFundingCohort: vi.fn(() => ({ score: 0 })),
    persistFundingEdge: vi.fn(),
    persistFundingEdgesForTarget: vi.fn(),
    sybilScanVersion: 1,
    solMint: 'So11111111111111111111111111111111111111112',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    programLabels: {} as Record<string, string>,
    treasuryWallets: new Set<string>(),
    knownLabels: {} as Record<string, { label: string; type: string }>,
    ...overrides,
  };
}

const TEST_ADDR = 'TestWallet11111111111111111111111111111111';

function makeEnhancedSummary(overrides = {}) {
  return {
    totalTxs: 50,
    firstTxBlockTime: 1600000000,
    timestamps: [] as number[],
    failedTxCount: 0,
    incomingVolume: 0,
    outgoingVolume: 0,
    incomingCount: 0,
    outgoingCount: 0,
    dustTxCount: 0,
    totalSolTxCount: 0,
    historicalMaxBalance: 1,
    allProgramIds: [] as string[],
    incomingSenders: [] as string[],
    outgoingRecipients: [] as string[],
    ...overrides,
  };
}

beforeEach(() => {
  mockGetBalance.mockReset().mockResolvedValue(1_000_000_000);
  mockGetTokenAccounts.mockReset().mockResolvedValue({ value: [] });
  mockGetSignatures.mockReset().mockResolvedValue([]);
  mockGetProgramAccounts.mockReset().mockResolvedValue([]);
});

describe('scanOrchestrator', () => {
  describe('Group 1: Incremental/cached path', () => {
    it('returns cached analysis when incremental=true + reuseCached=true + cachedBaseline.analysis exists', async () => {
      const cachedAnalysis = { trustScore: 77, riskScore: 23, signals: [] };
      const ctx = makeCtx({
        loadSybilCacheEntry: vi.fn(() => ({
          analysis: cachedAnalysis,
          lastSeenSignature: 'sig123',
          firstSeenSignature: 'sig001',
          estimatedTxCount: 50,
          firstTxBlockTime: 1600000000,
        })),
        fetchSybilSampleFor: vi.fn(async () => ({ incremental: true, reuseCached: true })),
        refreshCachedSybilAnalysis: vi.fn(() => ({ analysis: cachedAnalysis })),
      });
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      expect(ctx.refreshCachedSybilAnalysis).toHaveBeenCalledOnce();
      expect(result).toEqual(cachedAnalysis);
      // persistSybilAnalysis should NOT be called on early return
      expect(ctx.persistSybilAnalysis).not.toHaveBeenCalled();
    });

    it('does NOT early return when incremental=true but reuseCached=false', async () => {
      const ctx = makeCtx({
        fetchSybilSampleFor: vi.fn(async () => ({ incremental: true, reuseCached: false, summary: null })),
      });
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      expect(ctx.refreshCachedSybilAnalysis).not.toHaveBeenCalled();
      expect(result).toHaveProperty('trustScore');
      expect(ctx.persistSybilAnalysis).toHaveBeenCalledOnce();
    });
  });

  describe('Group 2: Empty/minimal wallet', () => {
    it('returns trustScore=0 when zero transactions', async () => {
      const ctx = makeCtx();
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      expect(result.trustScore).toBe(0);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
    });

    it('caps trustScore at 10 for 1-2 transactions', async () => {
      mockGetSignatures.mockResolvedValue([
        { signature: 'sig1', blockTime: 1600000000, err: null },
        { signature: 'sig2', blockTime: 1600000001, err: null },
      ]);
      const ctx = makeCtx();
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      // totalSigCount < 3 → trustScore capped at min(10, 100-riskScore)
      expect(result.trustScore).toBeLessThanOrEqual(10);
    });
  });

  describe('Group 3: Enhanced path', () => {
    it('takes enhanced path (no getSignaturesForAddress) when sampledHistory has summary', async () => {
      const ctx = makeCtx({
        fetchSybilSampleFor: vi.fn(async () => ({
          incremental: false,
          reuseCached: false,
          summary: makeEnhancedSummary({ totalTxs: 120 }),
          estimatedTxCount: 120,
          firstTxBlockTime: 1580000000,
          firstSeenSignature: 'sig001',
          lastSeenSignature: 'sig999',
        })),
      });
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      // enhanced path → getSignaturesForAddress should NOT be called
      expect(mockGetSignatures).not.toHaveBeenCalled();
      expect(result.scanMeta?.strategy).toBe('enhanced_stratified_sampling');
      expect(result.metrics.txCount).toBeGreaterThanOrEqual(120);
    });

    it('enhanced path with healthy metrics produces reasonable trustScore', async () => {
      const oldBlockTime = Math.floor(Date.now() / 1000) - 2 * 365 * 86400;
      const now = Date.now();
      // Spread 50 timestamps across 2 years
      const timestamps = Array.from({ length: 50 }, (_, i) =>
        now - 2 * 365 * 86400_000 + i * (2 * 365 * 86400_000 / 50),
      );

      const ctx = makeCtx({
        fetchSybilSampleFor: vi.fn(async () => ({
          summary: makeEnhancedSummary({
            totalTxs: 200,
            firstTxBlockTime: oldBlockTime,
            timestamps,
            incomingVolume: 20,
            outgoingVolume: 18,
            incomingCount: 40,
            outgoingCount: 38,
            totalSolTxCount: 78,
            historicalMaxBalance: 25,
            allProgramIds: Array.from({ length: 8 }, (_, i) => `prog${i}`),
            incomingSenders: Array.from({ length: 6 }, (_, i) => `sender${i}`),
          }),
          estimatedTxCount: 200,
          firstTxBlockTime: oldBlockTime,
        })),
      });
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      expect(result.trustScore).toBeGreaterThan(10);
      expect(result.riskScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Group 4: Risk signals', () => {
    it('no_history signal detected for zero sig count', async () => {
      const ctx = makeCtx();
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);
      const sig = result.signals.find((s: { id: string }) => s.id === 'no_history');
      expect(sig?.detected).toBe(true);
      expect(sig?.severity).toBe('danger');
    });

    it('wallet_age signal detected for very recent wallet', async () => {
      const recentBlockTime = Math.floor(Date.now() / 1000) - 5 * 86400;
      const ctx = makeCtx({
        fetchSybilSampleFor: vi.fn(async () => ({
          summary: makeEnhancedSummary({
            totalTxs: 30,
            firstTxBlockTime: recentBlockTime,
            timestamps: [Date.now() - 86400_000, Date.now() - 43200_000],
            totalSolTxCount: 2,
          }),
          estimatedTxCount: 30,
          firstTxBlockTime: recentBlockTime,
        })),
      });
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);
      const sig = result.signals.find((s: { id: string }) => s.id === 'wallet_age');
      expect(sig?.detected).toBe(true);
    });

    it('no_nft_holdings signal detected when zero NFTs', async () => {
      // mockGetTokenAccounts returns [] by default → nftCount = 0
      const ctx = makeCtx({
        fetchSybilSampleFor: vi.fn(async () => ({
          summary: makeEnhancedSummary({ totalTxs: 50 }),
          estimatedTxCount: 50,
        })),
      });
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);
      const sig = result.signals.find((s: { id: string }) => s.id === 'no_nft_holdings');
      expect(sig?.detected).toBe(true);
      expect(result.metrics.nftCount).toBe(0);
    });

    it('graph_intelligence signal added when checkGraphForKnownSybils returns graphRisk > 0', async () => {
      const ctx = makeCtx({
        checkGraphForKnownSybils: vi.fn(() => ({ graphRisk: 20, graphDetails: ['matched known cluster'] })),
        fetchSybilSampleFor: vi.fn(async () => ({
          summary: makeEnhancedSummary({
            totalTxs: 50,
            incomingVolume: 2,
            incomingCount: 2,
            totalSolTxCount: 3,
            incomingSenders: ['funder1'],
          }),
          estimatedTxCount: 50,
        })),
      });
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);
      const graphSig = result.signals.find((s: { id: string }) => s.id === 'graph_intelligence');
      expect(graphSig?.detected).toBe(true);
      expect(result.riskScore).toBeGreaterThan(0);
    });
  });

  describe('Group 5: Trust bonus', () => {
    it('old wallet with many tokens/programs gets non-zero trust bonus', async () => {
      const oldTime = Math.floor(Date.now() / 1000) - 3 * 365 * 86400;
      // 15 token accounts: 5 NFTs (decimals=0, amount=1), 10 fungible
      const richTokenAccounts = Array.from({ length: 15 }, (_, i) => ({
        account: {
          data: {
            parsed: {
              info: {
                mint: `mint${i}`,
                tokenAmount: {
                  uiAmountString: i < 5 ? '1' : '100',
                  decimals: i < 5 ? 0 : 6,
                },
              },
            },
          },
        },
      }));
      mockGetTokenAccounts.mockResolvedValue({ value: richTokenAccounts });
      mockGetBalance.mockResolvedValue(5_000_000_000);

      const ctx = makeCtx({
        fetchSybilSampleFor: vi.fn(async () => ({
          summary: makeEnhancedSummary({
            totalTxs: 500,
            firstTxBlockTime: oldTime,
            timestamps: Array.from({ length: 30 }, (_, i) => Date.now() - i * 30 * 86400_000),
            incomingVolume: 50,
            outgoingVolume: 45,
            incomingCount: 100,
            outgoingCount: 90,
            totalSolTxCount: 190,
            historicalMaxBalance: 60,
            allProgramIds: Array.from({ length: 20 }, (_, i) => `prog${i}`),
            incomingSenders: Array.from({ length: 10 }, (_, i) => `sender${i}`),
          }),
          estimatedTxCount: 500,
          firstTxBlockTime: oldTime,
        })),
      });
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      expect(result.metrics.trustBonus).toBeGreaterThan(5);
      expect(result.trustScore).toBeGreaterThan(20);
    });
  });

  describe('Group 6: Error handling', () => {
    it('falls back to legacy path when fetchSybilSampleFor throws', async () => {
      const ctx = makeCtx({
        fetchSybilSampleFor: vi.fn(async () => { throw new Error('RPC timeout'); }),
      });
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      // Should still return a valid analysis despite the throw
      expect(result).toHaveProperty('trustScore');
      expect(result).toHaveProperty('riskScore');
      expect(result.scanMeta?.strategy).toBe('legacy_signature_scan');
    });

    it('handles getBalance throwing — still returns valid result with balance=0', async () => {
      mockGetBalance.mockRejectedValue(new Error('connection refused'));

      const ctx = makeCtx();
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      expect(result).toHaveProperty('trustScore');
      expect(result.metrics.balance).toBe(0);
    });
  });

  describe('Group 7: Result shape', () => {
    it('result contains all required top-level fields', async () => {
      const ctx = makeCtx();
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      expect(result).toHaveProperty('trustScore');
      expect(result).toHaveProperty('riskScore');
      expect(result).toHaveProperty('signals');
      expect(result).toHaveProperty('walletType');
      expect(result).toHaveProperty('metrics');
      expect(result).toHaveProperty('riskLevel');
      expect(result).toHaveProperty('trustGrade');
      expect(Array.isArray(result.signals)).toBe(true);
    });

    it('trustScore and riskScore are both in [0, 100]', async () => {
      const ctx = makeCtx({
        fetchSybilSampleFor: vi.fn(async () => ({
          summary: makeEnhancedSummary({
            totalTxs: 80,
            allProgramIds: ['p1', 'p2'],
          }),
          estimatedTxCount: 80,
        })),
      });
      const result = await createScanOrchestrator(ctx)(TEST_ADDR);

      expect(result.trustScore).toBeGreaterThanOrEqual(0);
      expect(result.trustScore).toBeLessThanOrEqual(100);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
    });
  });
});
