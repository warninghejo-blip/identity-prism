import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInitOrchestrator } from '../services/initOrchestrator.js';

vi.mock('../services/walletBackfill.js', () => ({
  backfillWalletDatabaseAsync: vi.fn(async () => {}),
  backfillWalletDatabaseSync: vi.fn(),
}));

import {
  backfillWalletDatabaseAsync,
  backfillWalletDatabaseSync,
} from '../services/walletBackfill.js';

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    migrateFromJson: vi.fn(() => ({ migrated: false, count: 0 })),
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    coinBalanceStore: makeStore(),
    mintedAddressesStore: makeStore(),
    scoreHistoryStore: makeStore(),
    walletStore: makeStore(),
    sybilVerdictStore: makeStore(),
    gameSessionProofStore: makeStore(),
    achievementStore: makeStore(),
    reviveStore: makeStore(),
    questProgressStore: makeStore(),
    notificationsStore: makeStore(),
    challengesStore: makeStore(),
    tournamentStore: makeStore(),
    loadCoinBalances: vi.fn(async () => {}),
    loadMintedAddresses: vi.fn(),
    loadScoreHistory: vi.fn(async () => {}),
    loadWalletDatabase: vi.fn(async () => {}),
    loadGameSessionProofs: vi.fn(() => new Map()),
    loadAchievementData: vi.fn(() => new Map()),
    loadReviveData: vi.fn(() => new Map()),
    loadQuestProgress: vi.fn(() => new Map()),
    loadNotifications: vi.fn(() => new Map()),
    loadChallenges: vi.fn(() => []),
    loadTournaments: vi.fn(() => ({
      activeTournaments: {},
      tournamentHistory: [],
      tournamentModeIndex: 0,
    })),
    normalizeStoredGameSessionEntry: vi.fn((x: unknown) => x),
    gameSessionStoreFile: 'game.json',
    achievementsStoreFile: 'achievements.json',
    revivesStoreFile: 'revives.json',
    questProgressFile: 'quests.json',
    notificationsFile: 'notifications.json',
    challengesFile: 'challenges.json',
    tournamentFile: 'tournament.json',
    tournamentTiers: [],
    saveMintedAddresses: vi.fn(),
    setTournamentModeIndex: vi.fn(),
    fs: {},
    ...overrides,
  };
}

function makeCtx(walletDbEntries: [string, Record<string, unknown>][] = []) {
  return {
    walletDatabase: new Map<string, Record<string, unknown>>(walletDbEntries),
    mintedAddresses: new Set<string>(),
    gameSessionProofs: new Map(),
    pruneGameSessionProofs: vi.fn(),
    achievements: new Map(),
    revives: new Map(),
    quests: new Map(),
    notifications: new Map(),
    activeChallenges: [] as unknown[],
    activeTournaments: {} as Record<string, unknown>,
    completedTournaments: [] as unknown[],
  };
}

describe('createInitOrchestrator', () => {
  beforeEach(() => {
    vi.mocked(backfillWalletDatabaseAsync).mockResolvedValue(undefined);
    vi.mocked(backfillWalletDatabaseSync).mockReturnValue(undefined);
  });

  describe('initialize', () => {
    it('no migration logs when all migrations return migrated: false', async () => {
      const deps = makeDeps();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { initialize } = createInitOrchestrator(deps);
      const ctx = makeCtx();

      await initialize(ctx);

      const sqliteLogs = consoleSpy.mock.calls.filter(([msg]) => String(msg).includes('[sqlite]'));
      expect(sqliteLogs).toHaveLength(0);
      consoleSpy.mockRestore();
    });

    it('logs migration when one store returns migrated: true with count > 0', async () => {
      const deps = makeDeps({
        walletStore: makeStore({ migrateFromJson: vi.fn(() => ({ migrated: true, count: 5 })) }),
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { initialize } = createInitOrchestrator(deps);
      const ctx = makeCtx();

      await initialize(ctx);

      const sqliteLogs = consoleSpy.mock.calls.filter(([msg]) => String(msg).includes('[sqlite]'));
      expect(sqliteLogs).toHaveLength(1);
      expect(sqliteLogs[0][0]).toMatch(/wallet-db.*5/);
      consoleSpy.mockRestore();
    });

    it('calls load functions in order', async () => {
      const calls: string[] = [];
      const deps = makeDeps({
        loadCoinBalances: vi.fn(async () => { calls.push('coins'); }),
        loadMintedAddresses: vi.fn(() => { calls.push('minted'); }),
        loadScoreHistory: vi.fn(async () => { calls.push('scoreHistory'); }),
        loadWalletDatabase: vi.fn(async () => { calls.push('walletDb'); }),
      });
      const { initialize } = createInitOrchestrator(deps);
      const ctx = makeCtx();

      await initialize(ctx);

      expect(calls.indexOf('coins')).toBeLessThan(calls.indexOf('minted'));
      expect(calls.indexOf('minted')).toBeLessThan(calls.indexOf('scoreHistory'));
      expect(calls.indexOf('scoreHistory')).toBeLessThan(calls.indexOf('walletDb'));
    });

    it('replaceMap clears and repopulates target Maps from load results', async () => {
      const sourceMap = new Map([['key1', { val: 1 }], ['key2', { val: 2 }]]);
      const deps = makeDeps({
        loadGameSessionProofs: vi.fn(() => sourceMap),
      });
      const { initialize } = createInitOrchestrator(deps);
      const ctx = makeCtx();
      ctx.gameSessionProofs.set('stale', { old: true });

      await initialize(ctx);

      expect(ctx.gameSessionProofs.has('stale')).toBe(false);
      expect(ctx.gameSessionProofs.get('key1')).toEqual({ val: 1 });
      expect(ctx.gameSessionProofs.get('key2')).toEqual({ val: 2 });
    });

    it('backfills mintedAddresses: adds entry.mint address not yet in set', async () => {
      const deps = makeDeps();
      const { initialize } = createInitOrchestrator(deps);
      const ctx = makeCtx([['addr1', { mint: true }]]);

      await initialize(ctx);

      expect(ctx.mintedAddresses.has('addr1')).toBe(true);
      expect(deps.saveMintedAddresses).toHaveBeenCalled();
    });

    it('backfills mintedAddresses: does not duplicate address already in set', async () => {
      const deps = makeDeps();
      const { initialize } = createInitOrchestrator(deps);
      const ctx = makeCtx([['addr1', { mint: true }]]);
      ctx.mintedAddresses.add('addr1');

      const sizeBefore = ctx.mintedAddresses.size;
      await initialize(ctx);

      expect(ctx.mintedAddresses.size).toBe(sizeBefore);
      expect(deps.saveMintedAddresses).not.toHaveBeenCalled();
    });

    it('calls backfillWalletDatabaseSync with ctx', async () => {
      const deps = makeDeps();
      const { initialize } = createInitOrchestrator(deps);
      const ctx = makeCtx();

      await initialize(ctx);

      expect(backfillWalletDatabaseSync).toHaveBeenCalledWith(ctx);
    });
  });

  describe('startBackgroundBackfills', () => {
    it('resolves normally when backfillWalletDatabaseAsync succeeds', async () => {
      const deps = makeDeps();
      const { startBackgroundBackfills } = createInitOrchestrator(deps);
      const ctx = makeCtx();

      await expect(startBackgroundBackfills(ctx)).resolves.toBeUndefined();
      expect(backfillWalletDatabaseAsync).toHaveBeenCalledWith(ctx);
    });

    it('catches error from backfillWalletDatabaseAsync, warns, does not crash', async () => {
      vi.mocked(backfillWalletDatabaseAsync).mockRejectedValueOnce(new Error('async fail'));
      const deps = makeDeps();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { startBackgroundBackfills } = createInitOrchestrator(deps);
      const ctx = makeCtx();

      await expect(startBackgroundBackfills(ctx)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith('[wallet-db] Async backfill error', 'async fail');
      warnSpy.mockRestore();
    });
  });
});
