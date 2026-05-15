import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBlackHoleOrchestrator } from '../services/blackHoleOrchestrator.js';

let mockGetParsedTransaction = vi.fn();

vi.mock('@solana/web3.js', () => ({
  Connection: vi.fn(function () {
    return { getParsedTransaction: mockGetParsedTransaction };
  }),
}));

function mockParsedTx(address: string) {
  return {
    meta: { postBalances: [1000], preBalances: [6000] },
    transaction: {
      message: {
        accountKeys: [{ pubkey: { toBase58: () => address }, signer: true, writable: true }],
      },
    },
  };
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    operations: [
      {
        account: 'account111',
        mint: 'mint111',
        action: 'close',
        closeSignature: 'sig_close_1',
        ...overrides,
      },
    ],
  };
}

function makeCtx() {
  return {
    core: {
      normalizePubkey: vi.fn((a: string) => a),
      getRpcUrl: vi.fn(() => 'https://fake-rpc.com'),
    },
    wallet: {
      mintedAddresses: new Set<string>(),
      getStakingBoost: vi.fn(() => 0),
      getCoinBalance: vi.fn(() => 100),
      setCoinBalance: vi.fn(),
      addCoinEarned: vi.fn(),
      walletDatabase: new Map<string, { coins: number }>(),
      saveWalletDatabaseDebounced: vi.fn(),
      getPrismBalance: vi.fn(() => 0),
    },
    economy: {
      cleanupBlackHoleUsedSignatures: vi.fn(),
      blackHoleUsedSignatures: new Map<string, number>(),
      getIdentityHolderPerks: vi.fn(async () => ({
        isHolder: false,
        blackHoleCommissionRate: 0.1,
        perks: {},
      })),
      verifyBlackHoleCommissionTx: vi.fn(() => true),
      verifyCloseOperationTx: vi.fn(() => true),
      verifyBurnOperationTx: vi.fn(() => true),
      verifySwapOperationTx: vi.fn(() => true),
      inferBlackHoleAssetKind: vi.fn(() => 'nft'),
      getWalletLamportDelta: vi.fn(() => -5000),
      lamportsPerSol: 1_000_000_000,
      calculateBlackHoleReward: vi.fn(() => 10),
      getPrismEarnRateLimit: vi.fn(() => null),
      setPrismEarnRateLimit: vi.fn(),
      dailyBlackHoleCleanupCap: 500,
      getHolderAdjustedCap: vi.fn((cap: number) => cap),
      nonGameDailyEarnCap: 200,
      prismTransactions: new Map<string, unknown[]>(),
      savePrismDataDebounced: vi.fn(),
      feedItems: [] as unknown[],
      persistBlackHoleUsedSignatures: vi.fn(),
      durableClaimSignatures: vi.fn(() => true),
    },
  };
}

const ADDRESS = 'wallet_addr_1';

describe('blackHoleOrchestrator', () => {
  let ctx: ReturnType<typeof makeCtx>;
  let orchestrator: ReturnType<typeof createBlackHoleOrchestrator>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetParsedTransaction = vi.fn().mockResolvedValue(mockParsedTx(ADDRESS));
    ctx = makeCtx();
    orchestrator = createBlackHoleOrchestrator(ctx);
  });

  describe('validation', () => {
    it('empty operations array returns error', async () => {
      const result = await orchestrator.claim({ address: ADDRESS, payload: { operations: [] } });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/operations/i);
    });

    it('operations > 64 returns error', async () => {
      const ops = Array.from({ length: 65 }, (_, i) => ({
        account: `acc${i}`,
        mint: `mint${i}`,
        action: 'close',
        closeSignature: `sig${i}`,
      }));
      const result = await orchestrator.claim({ address: ADDRESS, payload: { operations: ops } });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/operations/i);
    });

    it('missing account returns error', async () => {
      ctx.core.normalizePubkey.mockImplementation((a: string) => (a === 'account111' ? '' : a));
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/invalid/i);
    });

    it('missing mint returns error', async () => {
      ctx.core.normalizePubkey.mockImplementation((a: string) => (a === 'mint111' ? '' : a));
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/invalid/i);
    });

    it('missing closeSignature returns error', async () => {
      const result = await orchestrator.claim({
        address: ADDRESS,
        payload: makePayload({ closeSignature: '' }),
      });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/invalid/i);
    });

    it('invalid action returns error', async () => {
      const result = await orchestrator.claim({
        address: ADDRESS,
        payload: makePayload({ action: 'hack' }),
      });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/action/i);
    });

    it('swap action without swapSignature returns error', async () => {
      const result = await orchestrator.claim({
        address: ADDRESS,
        payload: makePayload({ action: 'swap', swapSignature: null }),
      });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/swapSignature/i);
    });
  });

  describe('replay protection', () => {
    it('in-memory duplicate signature returns 400 already claimed', async () => {
      ctx.economy.blackHoleUsedSignatures.set('sig_close_1', Date.now());
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/already claimed/i);
    });

    it('durableClaimSignatures returning false returns 400', async () => {
      ctx.economy.durableClaimSignatures.mockReturnValue(false);
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/already claimed/i);
    });
  });

  describe('RPC', () => {
    it('getParsedTransaction returns null returns 400 transaction not found', async () => {
      mockGetParsedTransaction = vi.fn().mockResolvedValue(null);
      orchestrator = createBlackHoleOrchestrator(ctx);
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/not found/i);
    });

    it('getParsedTransaction throws propagates error and releases lock', async () => {
      mockGetParsedTransaction = vi.fn().mockRejectedValue(new Error('rpc down'));
      orchestrator = createBlackHoleOrchestrator(ctx);
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result).toMatchObject({ status: 400, body: { error: 'rpc down' } });
      expect(ctx.economy.blackHoleUsedSignatures.has('sig_close_1')).toBe(false);
    });
  });

  describe('identity holder perks', () => {
    it('getIdentityHolderPerks throws returns 503', async () => {
      ctx.economy.getIdentityHolderPerks.mockRejectedValue(new Error('lookup failed'));
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(503);
      expect(result.body.error).toMatch(/unavailable/i);
    });
  });

  describe('verification', () => {
    it('verifyBlackHoleCommissionTx returns false → 400', async () => {
      ctx.economy.verifyBlackHoleCommissionTx.mockReturnValue(false);
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/commission/i);
    });

    it('verifyCloseOperationTx returns false → 400', async () => {
      ctx.economy.verifyCloseOperationTx.mockReturnValue(false);
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/close/i);
    });

    it('verifyBurnOperationTx returns false for burn action → 400', async () => {
      ctx.economy.verifyBurnOperationTx.mockReturnValue(false);
      const result = await orchestrator.claim({
        address: ADDRESS,
        payload: makePayload({ action: 'burn' }),
      });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/burn/i);
    });

    it('verifySwapOperationTx returns false for swap action → 400', async () => {
      mockGetParsedTransaction = vi.fn().mockResolvedValue(mockParsedTx(ADDRESS));
      orchestrator = createBlackHoleOrchestrator(ctx);
      ctx.economy.verifySwapOperationTx.mockReturnValue(false);
      const result = await orchestrator.claim({
        address: ADDRESS,
        payload: makePayload({ action: 'swap', swapSignature: 'sig_swap_1' }),
      });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/swap/i);
    });
  });

  describe('rate limiting', () => {
    it('daily blackhole cap already exhausted → earned = 0, no coins credited', async () => {
      ctx.economy.calculateBlackHoleReward.mockReturnValue(10);
      ctx.economy.getPrismEarnRateLimit.mockImplementation((key: string) => {
        if (key.startsWith('blackhole_cleanup:')) return 500;
        return null;
      });
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(200);
      expect(result.body.earned).toBe(0);
      expect(ctx.wallet.setCoinBalance).not.toHaveBeenCalled();
    });

    it('partial cap remaining → earned capped to remaining', async () => {
      ctx.economy.calculateBlackHoleReward.mockReturnValue(100);
      ctx.economy.getPrismEarnRateLimit.mockImplementation((key: string) => {
        if (key.startsWith('blackhole_cleanup:')) return 490;
        return null;
      });
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(200);
      expect(result.body.earned).toBe(10);
    });
  });

  describe('staking boost', () => {
    it('earnBoost > 0 → credited = floor(earned * (1 + boost))', async () => {
      ctx.economy.calculateBlackHoleReward.mockReturnValue(10);
      ctx.wallet.getStakingBoost.mockReturnValue(0.5);
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(200);
      expect(result.body.earned).toBe(15);
    });

    it('earnBoost = 0 → credited = earned', async () => {
      ctx.economy.calculateBlackHoleReward.mockReturnValue(10);
      ctx.wallet.getStakingBoost.mockReturnValue(0);
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(200);
      expect(result.body.earned).toBe(10);
    });
  });

  describe('crediting', () => {
    it('credited > 0 → setCoinBalance, addCoinEarned, walletDatabase updated, prismTransactions entry added', async () => {
      ctx.economy.calculateBlackHoleReward.mockReturnValue(10);
      ctx.wallet.getCoinBalance.mockReturnValue(100);
      ctx.wallet.walletDatabase.set(ADDRESS, { coins: 100 });

      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(200);
      expect(ctx.wallet.setCoinBalance).toHaveBeenCalledWith(ADDRESS, 110);
      expect(ctx.wallet.addCoinEarned).toHaveBeenCalledWith(ADDRESS, 10);
      expect(ctx.wallet.walletDatabase.get(ADDRESS)?.coins).toBe(110);
      expect(ctx.economy.prismTransactions.get(ADDRESS)).toHaveLength(1);
    });

    it('credited = 0 → no balance changes', async () => {
      ctx.economy.calculateBlackHoleReward.mockReturnValue(0);
      const result = await orchestrator.claim({ address: ADDRESS, payload: makePayload() });
      expect(result.status).toBe(200);
      expect(result.body.earned).toBe(0);
      expect(ctx.wallet.setCoinBalance).not.toHaveBeenCalled();
      expect(ctx.wallet.addCoinEarned).not.toHaveBeenCalled();
    });
  });

  describe('deduplication', () => {
    it('duplicate operations are deduped by key', async () => {
      const dupOp = {
        account: 'account111',
        mint: 'mint111',
        action: 'close',
        closeSignature: 'sig_close_1',
      };
      ctx.economy.calculateBlackHoleReward.mockReturnValue(10);

      const result = await orchestrator.claim({
        address: ADDRESS,
        payload: { operations: [dupOp, dupOp, dupOp] },
      });

      expect(result.status).toBe(200);
      expect(ctx.economy.calculateBlackHoleReward).toHaveBeenCalledWith(0, 1, expect.any(Number));
    });
  });
});
