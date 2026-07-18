/**
 * Game anti-cheat integration tests — spawns the actual server and exercises
 * the token-gated game session flow (/api/v2/game/session/*, /api/v2/game/revives,
 * /api/v2/game/leaderboard) end-to-end over HTTP.
 *
 * Pattern mirrors routes-integration.test.ts / routes-time-accelerated.test.ts:
 * real server process, real HTTP calls, real SQLite-backed state. Where a test
 * needs elapsed wall-clock time (e.g. to prove the server derives coin credit
 * from ACTIVE session duration, not the client's report), it opens a second
 * better-sqlite3 connection to the same APP_DB_PATH the server writes to and
 * backdates the security_events row for the session token's issuedAtMs — the
 * exact technique routes-time-accelerated.test.ts uses against the rate-limit
 * DB. All money-path formulas are re-derived from services/gameRules.js
 * (the same pure functions the server uses) rather than hardcoded, so
 * assertions track the server's authoritative math instead of guessing it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activeSeconds,
  calculateEconomicDurationMs,
  getScoreCeiling,
  MAX_DELTA_PER_GAME,
} from '../services/gameRules.js';

const SERVER_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'helius-proxy.js');
const TEST_JWT_SECRET = 'game-anticheat-test-secret';

type JsonResponse = { status: number; body: unknown };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (!address || typeof address === 'string') {
        srv.close();
        reject(new Error('Failed to allocate free port'));
        return;
      }
      const { port } = address;
      srv.close((error) => (error ? reject(error) : resolve(port)));
    });
    srv.on('error', reject);
  });

const writeJson = (filePath: string, data: unknown) => {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

const makeJwt = (address: string) =>
  jwt.sign({ address }, TEST_JWT_SECRET, {
    expiresIn: '1h',
    algorithm: 'HS256',
    issuer: 'identity-prism',
    audience: 'identity-prism-api',
  });

const seedMinimalWorkspace = (metadataDir: string, workspaceDir: string) => {
  const now = new Date().toISOString();
  writeJson(path.join(metadataDir, 'wallet-database.json'), { version: 1, updatedAt: now, totalWallets: 0, wallets: {} });
  writeJson(path.join(metadataDir, 'coin-balances.json'), { version: 1, updatedAt: now, totalBurned: 0, balances: {} });
  writeJson(path.join(metadataDir, 'quest-progress.json'), { version: 1, updatedAt: now, data: {} });
  writeJson(path.join(metadataDir, 'leaderboard.json'), { version: 1, updatedAt: now, entries: [] });
  writeJson(path.join(metadataDir, 'achievement-claims.json'), { version: 2, updatedAt: now, data: {} });
  writeJson(path.join(workspaceDir, 'tournament_data.json'), {
    active: { daily: null, weekly: null, monthly: null },
    history: [],
    modeIndex: 0,
  });
};

// ── A driveable server instance (used twice: default env, and again with
//    GAME_SESSION_REQUIRE_TOKEN=true) ────────────────────────────────────────
class ServerHandle {
  workspaceDir = '';
  metadataDir = '';
  appDbPath = '';
  serverProcess: ChildProcessWithoutNullStreams | null = null;
  serverLogs = '';
  baseUrl = '';

  async start(extraEnv: Record<string, string> = {}) {
    this.workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'identity-prism-anticheat-'));
    this.metadataDir = path.join(this.workspaceDir, 'metadata');
    mkdirSync(this.metadataDir, { recursive: true });
    this.appDbPath = path.join(this.metadataDir, 'app.db');
    seedMinimalWorkspace(this.metadataDir, this.workspaceDir);

    const port = await getFreePort();
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.serverLogs = '';
    this.serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: this.workspaceDir,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        JWT_SECRET: TEST_JWT_SECRET,
        FIREBASE_SERVICE_ACCOUNT: path.join(this.workspaceDir, 'missing-service-account.json'),
        METADATA_DIR: this.metadataDir,
        APP_DB_PATH: this.appDbPath,
        RATE_LIMIT_DB_PATH: path.join(this.metadataDir, 'rate-limit.db'),
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.serverProcess.stdout.on('data', (chunk) => { this.serverLogs += chunk.toString(); });
    this.serverProcess.stderr.on('data', (chunk) => { this.serverLogs += chunk.toString(); });
    await this.waitForServer();
  }

  async waitForServer() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20_000) {
      if (this.serverProcess?.exitCode !== null) {
        throw new Error(`Server exited early.\n${this.serverLogs}`);
      }
      try {
        const response = await fetch(`${this.baseUrl}/health`);
        if (response.ok) return;
      } catch { /* keep polling */ }
      await sleep(250);
    }
    throw new Error(`Server did not become healthy in time.\n${this.serverLogs}`);
  }

  async stop() {
    const proc = this.serverProcess;
    this.serverProcess = null;
    if (!proc) return;
    if (proc.exitCode === null) {
      proc.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => proc.once('exit', resolve)), sleep(5_000)]);
    }
    if (proc.exitCode === null) {
      proc.kill('SIGKILL');
      await Promise.race([new Promise((resolve) => proc.once('exit', resolve)), sleep(5_000)]);
    }
    if (this.workspaceDir) rmSync(this.workspaceDir, { recursive: true, force: true });
  }

  async getJson(pathname: string, token?: string): Promise<JsonResponse> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      headers: {
        'X-Forwarded-For': '198.51.100.60',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async postJson(pathname: string, body: Record<string, unknown>, token?: string): Promise<JsonResponse> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.60',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  // Backdates the server-side session-token record's issuedAtMs by deltaMs,
  // simulating real elapsed active play time without sleeping the test. Reads
  // the tokenId straight out of the (unverified, we only need the payload)
  // JWT session token and rewrites the matching security_events row via a
  // second connection to the same SQLite file the server has open (WAL mode,
  // busy_timeout=5000 — same cross-process technique as
  // routes-time-accelerated.test.ts against RATE_LIMIT_DB_PATH).
  backdateSessionIssuedAt(sessionToken: string, deltaMs: number) {
    const decoded = jwt.decode(sessionToken) as { tokenId?: string } | null;
    if (!decoded?.tokenId) throw new Error('Could not decode tokenId from session token');
    const key = `game-session-token:${decoded.tokenId}`;
    const db = new Database(this.appDbPath);
    try {
      const row = db.prepare('SELECT data FROM security_events WHERE event_key = ?').get(key) as { data: string } | undefined;
      if (!row) throw new Error(`No security_events row for ${key}`);
      const record = JSON.parse(row.data);
      record.issuedAtMs = Number(record.issuedAtMs) - deltaMs;
      db.prepare('UPDATE security_events SET data = ? WHERE event_key = ?').run(JSON.stringify(record), key);
    } finally {
      db.close();
    }
  }
}

// Addresses just need to satisfy the server's base58-ish balance/route regex
// (^[1-9A-HJ-NP-Za-km-z]{32,44}$). Distinct per scenario so per-address daily
// coin caps / session state never bleed across test cases.
const ADDR = {
  tokenGated: '77777777777777777777777777777791',
  tokenless: '77777777777777777777777777777792',
  idempotent: '77777777777777777777777777777793',
  revive: '77777777777777777777777777777794',
  timingOk: '77777777777777777777777777777795',
  timingOver: '77777777777777777777777777777796',
  hardGate: '77777777777777777777777777777797',
};

const getBalance = async (server: ServerHandle, address: string) => {
  const res = await server.getJson(`/api/prism/balance?address=${address}`);
  expect(res.status).toBe(200);
  return (res.body as { coins?: number; balance?: number }).coins
    ?? (res.body as { coins?: number; balance?: number }).balance ?? 0;
};

// ── Suite 1: default env (GAME_SESSION_REQUIRE_TOKEN unset/false) ─────────────

describe.sequential('game anti-cheat: token-gated economy (session flow)', () => {
  const server = new ServerHandle();

  beforeAll(async () => { await server.start(); }, 30_000);
  afterAll(async () => { await server.stop(); }, 30_000);

  it('1. token-gated session/start issues a bearer session', async () => {
    const token = makeJwt(ADDR.tokenGated);
    const res = await server.postJson('/api/v2/game/session/start', { gameMode: 'orbit' }, token);
    expect(res.status).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(typeof body.sessionToken).toBe('string');
    expect(typeof body.seed).toBe('string');
    expect(typeof body.slot).toBe('number');
    expect(typeof body.expiresAtMs).toBe('number');
  });

  it('1b. final submit derives credit server-side from active time, ignoring client coinsDelta (Variant B)', async () => {
    const token = makeJwt(ADDR.tokenGated);
    const start = await server.postJson('/api/v2/game/session/start', { gameMode: 'orbit' }, token);
    expect(start.status).toBe(201);
    const { sessionToken, seed, slot } = start.body as { sessionToken: string; seed: string; slot: number };

    // Simulate ~2 minutes of real active play without sleeping the test.
    server.backdateSessionIssuedAt(sessionToken, 120_000);

    const now = Date.now();
    const submit = await server.postJson('/api/v2/game/session', {
      walletAddress: ADDR.tokenGated,
      sessionToken,
      gameMode: 'orbit',
      seed,
      slot,
      score: 500,
      startedAtMs: now - 2000,
      endedAtMs: now,
      survivalTime: '2:00',
      coinsDelta: 999999, // must NOT influence credit.earned
    }, token);

    expect(submit.status).toBe(200);
    const body = submit.body as { session: Record<string, unknown>; credit: Record<string, unknown> };
    expect(body.session.economyEligible).toBe(true);
    expect(body.session.timingVerified).toBe(true);
    expect(body.session.competitiveEligible).toBe(true);

    // Re-derive the expected credit from the server's own authoritative
    // durationMs (returned in the proof) using the exact pure functions the
    // server uses — this is what proves coinsDelta=999999 was ignored.
    const durationMs = Number(body.session.durationMs);
    expect(durationMs).toBeGreaterThan(0);
    const economicDurationMs = calculateEconomicDurationMs({ activeDurationMs: durationMs, validGrantCount: 0 });
    const expectedBaseAward = Math.min(activeSeconds(economicDurationMs), MAX_DELTA_PER_GAME.orbit);
    // Non-holder wallet (not minted, no CORE_COLLECTION configured in test env)
    // => holderMultiplier=1, stakingBoost=0, so earned === dailyApplied === baseAward,
    // capped by the fresh 1000/day allowance (won't bind for a ~2min run).
    expect(expectedBaseAward).toBeGreaterThan(0);
    expect(expectedBaseAward).toBeLessThanOrEqual(1000);
    expect(body.credit.earned).toBe(expectedBaseAward);
    expect(body.credit.baseAward).toBe(expectedBaseAward);
    expect(body.credit.earned).not.toBe(999999);
  });

  it('2. tokenless (legacy) submit is not economy- or competitive-eligible, and its leaderboard submit is rejected', async () => {
    const token = makeJwt(ADDR.tokenless);
    const now = Date.now();
    const submit = await server.postJson('/api/v2/game/session', {
      // no sessionToken -> legacy path (GAME_SESSION_REQUIRE_TOKEN=false in this suite)
      walletAddress: ADDR.tokenless,
      gameMode: 'orbit',
      seed: 'a'.repeat(32),
      slot: 123456,
      score: 500,
      startedAtMs: now - 60_000,
      endedAtMs: now,
      survivalTime: '1:00',
    }, token);
    expect(submit.status).toBe(200);
    const body = submit.body as { session: Record<string, unknown> };
    expect(body.session.economyEligible).toBe(false);
    expect(body.session.competitiveEligible).toBe(false);
    const sessionId = body.session.id as string;

    const lb = await server.postJson('/api/v2/game/leaderboard', {
      score: 500,
      gameType: 'orbit',
      gameSessionId: sessionId,
    }, token);
    expect(lb.status).toBe(400);
    expect((lb.body as { error?: string }).error).toBeTruthy();
  });

  it('3. resubmitting the same session (same token+fingerprint) is idempotent and does not double-credit', async () => {
    const token = makeJwt(ADDR.idempotent);
    const start = await server.postJson('/api/v2/game/session/start', { gameMode: 'orbit' }, token);
    expect(start.status).toBe(201);
    const { sessionToken, seed, slot } = start.body as { sessionToken: string; seed: string; slot: number };
    server.backdateSessionIssuedAt(sessionToken, 60_000);

    const now = Date.now();
    const payload = {
      walletAddress: ADDR.idempotent,
      sessionToken,
      gameMode: 'orbit',
      seed,
      slot,
      score: 300,
      startedAtMs: now - 1000,
      endedAtMs: now,
      survivalTime: '1:00',
    };

    const first = await server.postJson('/api/v2/game/session', payload, token);
    expect(first.status).toBe(200);
    const firstBody = first.body as { credit: Record<string, unknown> };
    const firstEarned = Number(firstBody.credit.earned);
    expect(firstEarned).toBeGreaterThan(0);

    const balanceAfterFirst = await getBalance(server, ADDR.idempotent);

    const second = await server.postJson('/api/v2/game/session', payload, token);
    expect(second.status).toBe(200);
    const secondBody = second.body as { credit: Record<string, unknown> };
    expect(Number(secondBody.credit.earned)).toBe(firstEarned);
    expect(secondBody.credit.alreadyCredited).toBe(true);

    const balanceAfterSecond = await getBalance(server, ADDR.idempotent);
    expect(balanceAfterSecond).toBe(balanceAfterFirst);
  });

  it('4. free revive: pause + grant is holder-gated (non-holder wallet is rejected)', async () => {
    const token = makeJwt(ADDR.revive);
    const start = await server.postJson('/api/v2/game/session/start', { gameMode: 'orbit' }, token);
    expect(start.status).toBe(201);
    const { sessionToken } = start.body as { sessionToken: string };

    const pause = await server.postJson('/api/v2/game/session/pause', {
      sessionToken, gameMode: 'orbit', reviveIndex: 1,
    }, token);
    expect(pause.status).toBe(200);
    expect((pause.body as Record<string, unknown>).paused).toBe(true);

    // Test wallet is neither minted nor holds a CORE_COLLECTION asset
    // (unconfigured in this harness) -> free-revive grant must be rejected.
    // This does NOT positively exercise the holder-eligible grant path.
    const revive = await server.postJson('/api/v2/game/revives', {
      sessionToken, gameMode: 'orbit', reviveIndex: 1,
    }, token);
    expect(revive.status).toBe(403);
    expect((revive.body as { reason?: string }).reason).toBe('holder_required');
  });

  it('5a. timing within the allowed window verifies', async () => {
    const token = makeJwt(ADDR.timingOk);
    const start = await server.postJson('/api/v2/game/session/start', { gameMode: 'orbit' }, token);
    expect(start.status).toBe(201);
    const { sessionToken, seed, slot } = start.body as { sessionToken: string; seed: string; slot: number };
    // ~5 minutes active — well inside base 15min run + grace.
    server.backdateSessionIssuedAt(sessionToken, 5 * 60_000);
    const now = Date.now();
    const submit = await server.postJson('/api/v2/game/session', {
      walletAddress: ADDR.timingOk,
      sessionToken, gameMode: 'orbit', seed, slot, score: 100,
      startedAtMs: now - 2000, endedAtMs: now, survivalTime: '5:00',
    }, token);
    expect(submit.status).toBe(200);
    const body = submit.body as { session: Record<string, unknown> };
    expect(body.session.timingVerified).toBe(true);
    expect(body.session.economyEligible).toBe(true);
  });

  it('5b. timing grossly over the wall-clock ceiling (80min) is rejected (timingVerified=false, earned=0)', async () => {
    const token = makeJwt(ADDR.timingOver);
    const start = await server.postJson('/api/v2/game/session/start', { gameMode: 'orbit' }, token);
    expect(start.status).toBe(201);
    const { sessionToken, seed, slot } = start.body as { sessionToken: string; seed: string; slot: number };
    // 80 minutes of wall time > MAX_SERVER_GAME_WALL_MS (70min). The CLIENT-reported
    // startedAtMs/endedAtMs must stay within normalizeGameSessionPayload's own 70min
    // sanity bound (independent check), so we keep those small and only blow the
    // SERVER-authoritative wall time via the backdated token issuedAtMs.
    server.backdateSessionIssuedAt(sessionToken, 80 * 60_000);
    const now = Date.now();
    const submit = await server.postJson('/api/v2/game/session', {
      walletAddress: ADDR.timingOver,
      sessionToken, gameMode: 'orbit', seed, slot, score: 100,
      startedAtMs: now - 2000, endedAtMs: now, survivalTime: '2:00',
    }, token);
    expect(submit.status).toBe(200);
    const body = submit.body as { session: Record<string, unknown>; credit: Record<string, unknown> };
    expect(body.session.timingVerified).toBe(false);
    expect(body.session.economyEligible).toBe(false);
    expect(Number(body.credit.earned)).toBe(0);
  });

  it('6. leaderboard submit succeeds for a token-backed, timing-verified, economy-eligible session', async () => {
    const token = makeJwt(ADDR.hardGate); // reuse address unused elsewhere in this suite
    const start = await server.postJson('/api/v2/game/session/start', { gameMode: 'orbit' }, token);
    expect(start.status).toBe(201);
    const { sessionToken, seed, slot } = start.body as { sessionToken: string; seed: string; slot: number };
    server.backdateSessionIssuedAt(sessionToken, 60_000);
    const now = Date.now();
    const submit = await server.postJson('/api/v2/game/session', {
      walletAddress: ADDR.hardGate,
      sessionToken, gameMode: 'orbit', seed, slot, score: 250,
      startedAtMs: now - 1000, endedAtMs: now, survivalTime: '1:00',
    }, token);
    expect(submit.status).toBe(200);
    const submitBody = submit.body as { session: Record<string, unknown> };
    expect(submitBody.session.economyEligible).toBe(true);
    expect(submitBody.session.competitiveEligible).toBe(true);

    const lb = await server.postJson('/api/v2/game/leaderboard', {
      score: 250,
      gameType: 'orbit',
      gameSessionId: submitBody.session.id,
    }, token);
    expect(lb.status).toBe(200);
    const lbBody = lb.body as { entry: Record<string, unknown> };
    expect(lbBody.entry).toBeTruthy();
    expect((lbBody.entry as { address?: string }).address).toBe(ADDR.hardGate);
  });
});

// ── Suite 2: GAME_SESSION_REQUIRE_TOKEN=true (hard-gate tokenless submits) ────

describe.sequential('game anti-cheat: GAME_SESSION_REQUIRE_TOKEN=true hard-gates tokenless submits', () => {
  const server = new ServerHandle();

  beforeAll(async () => { await server.start({ GAME_SESSION_REQUIRE_TOKEN: 'true' }); }, 30_000);
  afterAll(async () => { await server.stop(); }, 30_000);

  it('rejects a submit with no sessionToken with 428 GAME_SESSION_START_REQUIRED', async () => {
    const address = '77777777777777777777777777777798';
    const token = makeJwt(address);
    const now = Date.now();
    const res = await server.postJson('/api/v2/game/session', {
      walletAddress: address,
      gameMode: 'orbit',
      seed: 'a'.repeat(32),
      slot: 123456,
      score: 100,
      startedAtMs: now - 1000,
      endedAtMs: now,
      survivalTime: '1:00',
    }, token);
    expect(res.status).toBe(428);
    expect((res.body as { code?: string }).code).toBe('GAME_SESSION_START_REQUIRED');
  });

  it('still allows the token-backed flow to earn', async () => {
    const address = '77777777777777777777777777777799';
    const token = makeJwt(address);
    const start = await server.postJson('/api/v2/game/session/start', { gameMode: 'orbit' }, token);
    expect(start.status).toBe(201);
    const { sessionToken, seed, slot } = start.body as { sessionToken: string; seed: string; slot: number };
    server.backdateSessionIssuedAt(sessionToken, 60_000);
    const now = Date.now();
    const submit = await server.postJson('/api/v2/game/session', {
      walletAddress: address,
      sessionToken, gameMode: 'orbit', seed, slot, score: 100,
      startedAtMs: now - 1000, endedAtMs: now, survivalTime: '1:00',
    }, token);
    expect(submit.status).toBe(200);
    const body = submit.body as { session: Record<string, unknown>; credit: Record<string, unknown> };
    expect(body.session.economyEligible).toBe(true);
    expect(Number(body.credit.earned)).toBeGreaterThan(0);
  });
});
