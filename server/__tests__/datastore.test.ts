import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initAppDbSchema } from '../services/dbSchema.js';
import { DataStore } from '../services/datastore.js';

type WalletEntry = { address: string; score: number; tier?: string };
type ScoreHistoryEntry = { scores: Array<{ score: number; tier: string; date: string }>; lastUpdated?: string | null };

let workspaceDir = '';
let db: Database.Database;

const readJsonFile = (filePath: string) => JSON.parse(readFileSync(filePath, 'utf8'));

const createWalletStore = (jsonPath: string, debounceMs = 5) => {
  const selectOne = db.prepare('SELECT data FROM wallets WHERE address = ?');
  const selectAll = db.prepare('SELECT address, data FROM wallets');
  const upsert = db.prepare(`
    INSERT INTO wallets (address, data, updated_at)
    VALUES (@address, @data, @updated_at)
    ON CONFLICT(address) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at
  `);
  const deleteRow = db.prepare('DELETE FROM wallets WHERE address = ?');
  const clearRows = db.prepare('DELETE FROM wallets');
  const countRows = db.prepare('SELECT COUNT(*) AS count FROM wallets');

  return new DataStore({
    db,
    jsonPath,
    tableName: 'wallets',
    primaryKey: 'address',
    readJson: (parsed: any) => Object.entries(parsed?.wallets || {}),
    writeJson: (entries: Map<string, WalletEntry>) => ({
      version: 1,
      updatedAt: new Date().toISOString(),
      totalWallets: entries.size,
      wallets: Object.fromEntries(entries),
    }),
    listSqlEntries: () => selectAll.all().map((row: any) => [row.address, JSON.parse(row.data)]),
    getSqlValue: (address: string) => {
      const row = selectOne.get(address) as { data: string } | undefined;
      return row ? JSON.parse(row.data) : undefined;
    },
    upsertSqlValue: (address: string, value: WalletEntry) => {
      upsert.run({ address, data: JSON.stringify(value), updated_at: Date.now() });
    },
    deleteSqlValue: (address: string) => deleteRow.run(address),
    clearSql: () => clearRows.run(),
    countSql: () => (countRows.get() as { count: number }).count,
    debounceMs,
    logLabel: 'wallet-db-test',
  });
};

const createScoreHistoryStore = (jsonPath: string, failAfterFirstInsert = false) => {
  const selectAddress = db.prepare(`
    SELECT score, tier, date
    FROM score_history
    WHERE address = ?
    ORDER BY entry_idx ASC
  `);
  const selectAll = db.prepare(`
    SELECT address, entry_idx, score, tier, date
    FROM score_history
    ORDER BY address ASC, entry_idx ASC
  `);
  const clearRows = db.prepare('DELETE FROM score_history');
  const deleteAddress = db.prepare('DELETE FROM score_history WHERE address = ?');
  const countRows = db.prepare('SELECT COUNT(*) AS count FROM score_history');
  const insertEntry = db.prepare(`
    INSERT INTO score_history (address, entry_idx, score, tier, date)
    VALUES (@address, @entry_idx, @score, @tier, @date)
  `);

  const toEntry = (rows: Array<any>): ScoreHistoryEntry => ({
    scores: rows.map((row) => ({ score: row.score, tier: row.tier, date: row.date })),
    lastUpdated: rows[0]?.date || null,
  });

  return new DataStore({
    db,
    jsonPath,
    tableName: 'score_history',
    primaryKey: 'address',
    readJson: (parsed: any) => Object.entries(parsed?.data || {}),
    writeJson: (entries: Map<string, ScoreHistoryEntry>) => ({
      version: 1,
      updatedAt: new Date().toISOString(),
      data: Object.fromEntries(entries),
    }),
    listSqlEntries: () => {
      const grouped = new Map<string, Array<any>>();
      for (const row of selectAll.all() as Array<any>) {
        if (!grouped.has(row.address)) grouped.set(row.address, []);
        grouped.get(row.address)!.push(row);
      }
      return Array.from(grouped.entries()).map(([address, rows]) => [address, toEntry(rows)]);
    },
    getSqlValue: (address: string) => {
      const rows = selectAddress.all(address) as Array<any>;
      return rows.length > 0 ? toEntry(rows) : undefined;
    },
    upsertSqlValue: (address: string, value: ScoreHistoryEntry) => {
      deleteAddress.run(address);
      value.scores.forEach((entry, index) => {
        insertEntry.run({ address, entry_idx: index, score: entry.score, tier: entry.tier, date: entry.date });
        if (failAfterFirstInsert && index === 0) {
          throw new Error('forced-write-failure');
        }
      });
    },
    deleteSqlValue: (address: string) => deleteAddress.run(address),
    clearSql: () => clearRows.run(),
    countSql: () => (countRows.get() as { count: number }).count,
    debounceMs: 5,
    logLabel: 'score-history-test',
  });
};

describe('DataStore', () => {
  beforeEach(() => {
    workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'identity-prism-datastore-'));
    db = new Database(path.join(workspaceDir, 'app.db'));
    initAppDbSchema(db);
  });

  afterEach(() => {
    db.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('returns undefined on a fresh DB', () => {
    const store = createWalletStore(path.join(workspaceDir, 'wallet-database.json'));
    expect(store.get('missing')).toBeUndefined();
    expect(store.entries().size).toBe(0);
  });

  it('writes to SQLite immediately and JSON on flush', async () => {
    const jsonPath = path.join(workspaceDir, 'wallet-database.json');
    const store = createWalletStore(jsonPath);

    store.set('wallet-a', { address: 'wallet-a', score: 42 });
    expect(store.get('wallet-a')).toEqual({ address: 'wallet-a', score: 42 });
    expect((db.prepare('SELECT COUNT(*) AS count FROM wallets').get() as { count: number }).count).toBe(1);

    await store.flushJson();
    expect(readJsonFile(jsonPath).wallets['wallet-a']).toEqual({ address: 'wallet-a', score: 42 });
  });

  it('migrates existing JSON into an empty SQLite DB', () => {
    const jsonPath = path.join(workspaceDir, 'wallet-database.json');
    writeFileSync(jsonPath, JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      totalWallets: 2,
      wallets: {
        alpha: { address: 'alpha', score: 10 },
        beta: { address: 'beta', score: 20 },
      },
    }, null, 2));

    const store = createWalletStore(jsonPath);
    expect(store.migrateFromJson()).toEqual({ migrated: true, count: 2 });
    expect(store.entries().size).toBe(2);
    expect(store.get('beta')).toEqual({ address: 'beta', score: 20 });
  });

  it('skips migration when SQLite already has rows', () => {
    const jsonPath = path.join(workspaceDir, 'wallet-database.json');
    writeFileSync(jsonPath, JSON.stringify({
      wallets: {
        alpha: { address: 'alpha', score: 10 },
      },
    }, null, 2));

    const store = createWalletStore(jsonPath);
    store.set('sqlite-only', { address: 'sqlite-only', score: 99 });

    expect(store.migrateFromJson()).toEqual({ migrated: false, count: 0 });
    expect(store.get('sqlite-only')?.score).toBe(99);
  });

  it('returns a merged view with SQLite overriding JSON duplicates', () => {
    const jsonPath = path.join(workspaceDir, 'wallet-database.json');
    writeFileSync(jsonPath, JSON.stringify({
      wallets: {
        overlap: { address: 'overlap', score: 10 },
        jsonOnly: { address: 'jsonOnly', score: 11 },
      },
    }, null, 2));

    const store = createWalletStore(jsonPath);
    store.set('overlap', { address: 'overlap', score: 99 });

    const entries = store.entries();
    expect(entries.get('overlap')?.score).toBe(99);
    expect(entries.get('jsonOnly')?.score).toBe(11);
  });

  it('replaceAll removes stale SQLite rows and updates JSON fallback', async () => {
    const jsonPath = path.join(workspaceDir, 'wallet-database.json');
    const store = createWalletStore(jsonPath);

    store.set('alpha', { address: 'alpha', score: 1 });
    store.replaceAll(new Map([
      ['beta', { address: 'beta', score: 2 }],
    ]));

    await store.flushJson();
    expect(store.get('alpha')).toBeUndefined();
    expect(store.get('beta')?.score).toBe(2);
    expect(Object.keys(readJsonFile(jsonPath).wallets)).toEqual(['beta']);
  });

  it('deletes from both SQLite and JSON fallback', async () => {
    const jsonPath = path.join(workspaceDir, 'wallet-database.json');
    const store = createWalletStore(jsonPath);

    store.set('wallet-a', { address: 'wallet-a', score: 7 });
    store.delete('wallet-a');

    await store.flushJson();
    expect(store.get('wallet-a')).toBeUndefined();
    expect((db.prepare('SELECT COUNT(*) AS count FROM wallets').get() as { count: number }).count).toBe(0);
    expect(readJsonFile(jsonPath).wallets).toEqual({});
  });

  it('keeps writes consistent under concurrent update bursts', async () => {
    const jsonPath = path.join(workspaceDir, 'wallet-database.json');
    const store = createWalletStore(jsonPath);

    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        Promise.resolve().then(() => {
          store.set(`wallet-${index}`, { address: `wallet-${index}`, score: index });
        })),
    );

    await store.flushJson();
    expect(store.entries().size).toBe(25);
    expect(readJsonFile(jsonPath).totalWallets).toBe(25);
  });

  it('rolls back a partial multi-row write when a transaction fails', () => {
    const jsonPath = path.join(workspaceDir, 'score-history.json');
    const stableStore = createScoreHistoryStore(jsonPath);
    stableStore.set('wallet-a', {
      scores: [
        { score: 20, tier: 'daily', date: '2026-01-01T00:00:00.000Z' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });

    const flakyStore = createScoreHistoryStore(jsonPath, true);
    expect(() => flakyStore.set('wallet-a', {
      scores: [
        { score: 30, tier: 'daily', date: '2026-02-01T00:00:00.000Z' },
        { score: 10, tier: 'weekly', date: '2026-02-02T00:00:00.000Z' },
      ],
      lastUpdated: '2026-02-01T00:00:00.000Z',
    })).toThrow('forced-write-failure');

    expect(stableStore.get('wallet-a')).toEqual({
      scores: [
        { score: 20, tier: 'daily', date: '2026-01-01T00:00:00.000Z' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });
  });

  it('supports cold-start reads from JSON before migration', () => {
    const jsonPath = path.join(workspaceDir, 'wallet-database.json');
    writeFileSync(jsonPath, JSON.stringify({
      wallets: {
        fallback: { address: 'fallback', score: 5 },
      },
    }, null, 2));

    const store = createWalletStore(jsonPath);
    expect(store.get('fallback')).toEqual({ address: 'fallback', score: 5 });
    expect(store.hasRows()).toBe(false);
  });
});
