import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCompositeOrchestrator } from '../services/compositeOrchestrator.js';

function makeDefaultScore() {
  return {
    score: 75,
    scoreBreakdown: { solBalance: { value: 10, max: 40 } },
    tier: 'diamond',
    badges: [],
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const walletDatabase = new Map<string, Record<string, unknown>>();
  const challenges: unknown[] = [];
  return {
    walletDatabase,
    challenges,
    saveWalletDatabaseDebounced: vi.fn(),
    fbAvailable: vi.fn(() => false),
    fbSet: vi.fn(async () => {}),
    buildCompositeInput: vi.fn(() => ({ mock: 'input' })),
    calculateCompositeScore: vi.fn(() => ({ score: 75, tier: 'diamond' })),
    calculateIdentity: vi.fn(() => ({
      score: 50,
      scoreBreakdown: { solBalance: { value: 10, max: 40 } },
      tier: 'silver',
      badges: [],
    })),
    rebuildTwitterWalletMap: vi.fn(),
    ...overrides,
  };
}

describe('createCompositeOrchestrator', () => {
  describe('triggerCompositeUpdate', () => {
    it('happy path: updates composite on existing entry and calls save', () => {
      const deps = makeDeps();
      const { triggerCompositeUpdate } = createCompositeOrchestrator(deps);
      deps.walletDatabase.set('addr1', { score: 10 });

      triggerCompositeUpdate('addr1');

      expect(deps.buildCompositeInput).toHaveBeenCalledWith('addr1');
      expect(deps.calculateCompositeScore).toHaveBeenCalledWith({ mock: 'input' });
      const entry = deps.walletDatabase.get('addr1');
      expect(entry?.composite).toEqual({ score: 75, tier: 'diamond' });
      expect(deps.saveWalletDatabaseDebounced).toHaveBeenCalledTimes(1);
    });

    it('calls fbSet with correct args when fbAvailable returns true', () => {
      const deps = makeDeps({ fbAvailable: vi.fn(() => true) });
      const { triggerCompositeUpdate } = createCompositeOrchestrator(deps);
      deps.walletDatabase.set('addr1', { score: 10 });

      triggerCompositeUpdate('addr1');

      expect(deps.fbSet).toHaveBeenCalledWith(
        'wallets',
        'addr1',
        expect.objectContaining({ composite: { score: 75, tier: 'diamond' } }),
      );
    });

    it('does NOT call fbSet when fbAvailable returns false', () => {
      const deps = makeDeps({ fbAvailable: vi.fn(() => false) });
      const { triggerCompositeUpdate } = createCompositeOrchestrator(deps);
      deps.walletDatabase.set('addr1', { score: 10 });

      triggerCompositeUpdate('addr1');

      expect(deps.fbSet).not.toHaveBeenCalled();
    });

    it('does not crash and does not update entry when buildCompositeInput throws', () => {
      const deps = makeDeps({
        buildCompositeInput: vi.fn(() => { throw new Error('boom'); }),
      });
      const { triggerCompositeUpdate } = createCompositeOrchestrator(deps);
      deps.walletDatabase.set('addr1', { score: 10 });

      expect(() => triggerCompositeUpdate('addr1')).not.toThrow();
      expect(deps.walletDatabase.get('addr1')?.composite).toBeUndefined();
      expect(deps.saveWalletDatabaseDebounced).not.toHaveBeenCalled();
    });

    it('handles address not in walletDatabase by creating a new entry', () => {
      const deps = makeDeps();
      const { triggerCompositeUpdate } = createCompositeOrchestrator(deps);

      expect(() => triggerCompositeUpdate('unknown')).not.toThrow();
      const entry = deps.walletDatabase.get('unknown');
      expect(entry?.composite).toEqual({ score: 75, tier: 'diamond' });
      expect(deps.saveWalletDatabaseDebounced).toHaveBeenCalledTimes(1);
    });
  });

  describe('backfillCompositeScores', () => {
    it('empty walletDatabase: calls rebuildTwitterWalletMap, no errors', async () => {
      const deps = makeDeps();
      const { backfillCompositeScores } = createCompositeOrchestrator(deps);

      await expect(backfillCompositeScores()).resolves.toBeUndefined();
      expect(deps.rebuildTwitterWalletMap).toHaveBeenCalledTimes(1);
    });

    it('entry with score > 0 and missing scoreBreakdown recalculates identity', async () => {
      const deps = makeDeps();
      const { backfillCompositeScores } = createCompositeOrchestrator(deps);
      deps.walletDatabase.set('addr1', {
        score: 50,
        stats: { transactions: 10, solBalance: 1, tokens: 2, nfts: 0, walletAgeYears: 1 },
      });

      await backfillCompositeScores();

      expect(deps.calculateIdentity).toHaveBeenCalled();
      const entry = deps.walletDatabase.get('addr1');
      expect(entry?.scoreBreakdown).toEqual({ solBalance: { value: 10, max: 40 } });
      expect(entry?.score).toBe(50);
    });

    it('entry with stale scoreBreakdown (solBalance.max !== 40) recalculates identity', async () => {
      const deps = makeDeps();
      const { backfillCompositeScores } = createCompositeOrchestrator(deps);
      deps.walletDatabase.set('addr1', {
        score: 30,
        scoreBreakdown: { solBalance: { value: 5, max: 100 } },
        stats: { transactions: 5, solBalance: 0.5, tokens: 1, nfts: 0, walletAgeYears: 0 },
      });

      await backfillCompositeScores();

      expect(deps.calculateIdentity).toHaveBeenCalled();
    });

    it('entry with score > 400 (legacy) recalculates identity', async () => {
      const deps = makeDeps();
      const { backfillCompositeScores } = createCompositeOrchestrator(deps);
      deps.walletDatabase.set('addr1', {
        score: 500,
        scoreBreakdown: { solBalance: { value: 20, max: 40 } },
        stats: { transactions: 100, solBalance: 10, tokens: 5, nfts: 2, walletAgeYears: 2 },
      });

      await backfillCompositeScores();

      expect(deps.calculateIdentity).toHaveBeenCalled();
    });

    it('socialStats.challengesWon > real wins resets challengesWon', async () => {
      const deps = makeDeps();
      const { backfillCompositeScores } = createCompositeOrchestrator(deps);
      const addr = 'addr1';
      deps.challenges.push({ status: 'completed', winner: addr });
      deps.walletDatabase.set(addr, {
        score: 0,
        socialStats: { challengesWon: 5 },
      });

      await backfillCompositeScores();

      expect(deps.walletDatabase.get(addr)?.socialStats?.challengesWon).toBe(1);
      expect(deps.saveWalletDatabaseDebounced).toHaveBeenCalled();
    });

    it('socialStats.constellationExplored > 20 resets to 0', async () => {
      const deps = makeDeps();
      const { backfillCompositeScores } = createCompositeOrchestrator(deps);
      deps.walletDatabase.set('addr1', {
        score: 0,
        socialStats: { constellationExplored: 25 },
      });

      await backfillCompositeScores();

      expect(deps.walletDatabase.get('addr1')?.socialStats?.constellationExplored).toBe(0);
    });

    it('socialStats.compareCount > 20 resets to 0', async () => {
      const deps = makeDeps();
      const { backfillCompositeScores } = createCompositeOrchestrator(deps);
      deps.walletDatabase.set('addr1', {
        score: 0,
        socialStats: { compareCount: 99 },
      });

      await backfillCompositeScores();

      expect(deps.walletDatabase.get('addr1')?.socialStats?.compareCount).toBe(0);
    });

    it('calls triggerCompositeUpdate for each cleaned entry after socialStats cleanup', async () => {
      const deps = makeDeps();
      const { backfillCompositeScores } = createCompositeOrchestrator(deps);
      deps.walletDatabase.set('addr1', {
        score: 0,
        socialStats: { compareCount: 99 },
      });

      await backfillCompositeScores();

      // triggerCompositeUpdate is called in the main loop once, then again after cleanup
      expect(deps.calculateCompositeScore).toHaveBeenCalledTimes(2);
    });
  });
});
