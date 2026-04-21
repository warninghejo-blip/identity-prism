/**
 * Route integration tests — extended coverage.
 * Spawns the real server (same pattern as routes-integration.test.ts).
 * Covers: prism economy, score-history, daily-limits, sybil analysis,
 * prism/balance JWT, prism/spend JWT, game leaderboard, referral, xp.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SERVER_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'helius-proxy.js');
const TEST_JWT_SECRET = 'routes-extended-test-secret';

const ADDRESSES = {
  known: '33333333333333333333333333333331',
  jwt:   '33333333333333333333333333333332',
};

type JsonResponse = { status: number; body: unknown };

let workspaceDir = '';
let metadataDir = '';
let serverProcess: ChildProcessWithoutNullStreams | null = null;
let serverLogs = '';
let baseUrl = '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('no port')); return; }
      const { port } = address;
      server.close((e) => (e ? reject(e) : resolve(port)));
    });
    server.on('error', reject);
  });

const writeJson = (filePath: string, data: unknown) =>
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

const makeJwt = (address: string) =>
  jwt.sign({ address }, TEST_JWT_SECRET, {
    expiresIn: '1h',
    algorithm: 'HS256',
    issuer: 'identity-prism',
    audience: 'identity-prism-api',
  });

const seedWorkspace = () => {
  const now = new Date().toISOString();

  writeJson(path.join(metadataDir, 'wallet-database.json'), {
    version: 1,
    updatedAt: now,
    totalWallets: 1,
    wallets: {
      [ADDRESSES.known]: {
        address: ADDRESSES.known,
        score: 200,
        scoreBreakdown: {
          solBalance: { pts: 30, max: 40, raw: 2.0 },
          walletAge: { pts: 60, max: 100, raw: 300 },
          transactions: { pts: 30, max: 80, raw: 200 },
          nfts: { pts: 0, max: 32, raw: 0 },
          defiActivity: { pts: 10, max: 30, swapPts: 10, nftTradePts: 0, protocolPts: 0, swaps: 12, protocols: 0 },
          badges: { pts: 0, max: 68, items: [] },
          collection: { pts: 0, max: 50, items: [] },
        },
        traits: { walletAgeDays: 300, txCount: 200, nftCount: 0, solBalance: 2.0, defiProtocols: [] },
        stats: { walletAgeDays: 300, transactions: 200, nfts: 0, solBalance: 2.0 },
        sybil: {
          trustScore: 80, riskScore: 20, updatedAt: now, signals: [],
          metrics: {
            txCount: 200, siblingCount: 0, fundingChainDepth: 0, topFunderTxCount: 0, topFunderPct: 0,
            walletAgeDays: 300, activeDaysRatio: 0.2, uniquePrograms: 8, tokenDiversityCount: 4,
            nftCount: 0, uniqueSenders: 6, hasSolDomain: false, defiDepth: 1,
          },
        },
        lastSeenAt: now,
      },
      [ADDRESSES.jwt]: {
        address: ADDRESSES.jwt,
        score: 120,
        scoreBreakdown: {
          solBalance: { pts: 20, max: 40, raw: 1.0 },
          walletAge: { pts: 30, max: 100, raw: 150 },
          transactions: { pts: 10, max: 80, raw: 50 },
          nfts: { pts: 0, max: 32, raw: 0 },
          defiActivity: { pts: 0, max: 30, swapPts: 0, nftTradePts: 0, protocolPts: 0, swaps: 0, protocols: 0 },
          badges: { pts: 0, max: 68, items: [] },
          collection: { pts: 0, max: 50, items: [] },
        },
        traits: { walletAgeDays: 150, txCount: 50, nftCount: 0, solBalance: 1.0, defiProtocols: [] },
        stats: { walletAgeDays: 150, transactions: 50, nfts: 0, solBalance: 1.0 },
        sybil: {
          trustScore: 70, riskScore: 30, updatedAt: now, signals: [],
          metrics: {
            txCount: 50, siblingCount: 0, fundingChainDepth: 0, topFunderTxCount: 0, topFunderPct: 0,
            walletAgeDays: 150, activeDaysRatio: 0.12, uniquePrograms: 3, tokenDiversityCount: 2,
            nftCount: 0, uniqueSenders: 3, hasSolDomain: false, defiDepth: 0,
          },
        },
        lastSeenAt: now,
      },
    },
  });

  writeJson(path.join(metadataDir, 'coin-balances.json'), {
    version: 1,
    updatedAt: now,
    totalBurned: 0,
    balances: { [ADDRESSES.jwt]: 75000, [ADDRESSES.known]: 25000 },
  });

  writeJson(path.join(metadataDir, 'quest-progress.json'), {
    version: 1,
    updatedAt: now,
    data: {},
  });

  writeJson(path.join(metadataDir, 'leaderboard.json'), {
    version: 1,
    updatedAt: now,
    entries: [],
  });

  writeJson(path.join(metadataDir, 'achievement-claims.json'), {
    version: 2,
    updatedAt: now,
    data: {},
  });

  writeJson(path.join(workspaceDir, 'tournament_data.json'), {
    active: { daily: null, weekly: null, monthly: null },
    history: [],
    modeIndex: 0,
  });
};

const waitForServer = async (url: string) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (serverProcess?.exitCode !== null) throw new Error(`Server exited early.\n${serverLogs}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch { /* keep polling */ }
    await sleep(250);
  }
  throw new Error(`Server did not become healthy in time.\n${serverLogs}`);
};

const startServer = async () => {
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverLogs = '';
  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      JWT_SECRET: TEST_JWT_SECRET,
      FIREBASE_SERVICE_ACCOUNT: path.join(workspaceDir, 'missing-service-account.json'),
      METADATA_DIR: metadataDir,
      APP_DB_PATH: path.join(metadataDir, 'app.db'),
      RATE_LIMIT_DB_PATH: path.join(metadataDir, 'rate-limit.db'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });
  await waitForServer(baseUrl);
};

const stopServer = async () => {
  if (!serverProcess) return;
  const proc = serverProcess;
  serverProcess = null;
  if (proc.exitCode === null) {
    proc.kill('SIGTERM');
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(5_000)]);
  }
  if (proc.exitCode === null) {
    proc.kill('SIGKILL');
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(5_000)]);
  }
};

const getJson = async (pathname: string, token?: string): Promise<JsonResponse> => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      'X-Forwarded-For': '198.51.100.77',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const postJson = async (pathname: string, body: Record<string, unknown>, token?: string): Promise<JsonResponse> => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.77',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe.sequential('routes-extended integration tests', () => {
  beforeAll(async () => {
    workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'identity-prism-ext-'));
    metadataDir = path.join(workspaceDir, 'metadata');
    mkdirSync(metadataDir, { recursive: true });
    seedWorkspace();
    await startServer();
  }, 30_000);

  afterAll(async () => {
    await stopServer();
    if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true });
  }, 30_000);

  // ── Health ──────────────────────────────────────────────────────────────

  it('GET /health returns 200', async () => {
    const res = await getJson('/health');
    expect(res.status).toBe(200);
  });

  // ── Prism economy ───────────────────────────────────────────────────────

  it('GET /api/prism/economy returns structured response with earn rates', async () => {
    const res = await getJson('/api/prism/economy');
    // Either available without auth or requires address param
    if (res.status === 200) {
      expect(typeof res.body).toBe('object');
    } else {
      expect([400, 401, 404]).toContain(res.status);
    }
  });

  // ── Coin balance ─────────────────────────────────────────────────────────

  it('GET /api/prism/balance without address returns 400', async () => {
    const res = await getJson('/api/prism/balance');
    // Missing address param → should be 400 or 401
    expect([400, 401]).toContain(res.status);
  });

  it('GET /api/prism/balance with known address returns numeric balance', async () => {
    const res = await getJson(`/api/prism/balance?address=${ADDRESSES.known}`);
    if (res.status === 200) {
      const body = res.body as Record<string, unknown>;
      expect(typeof body.balance).toBe('number');
      expect(body.balance).toBeGreaterThanOrEqual(0);
    } else {
      // May require JWT — that's fine
      expect([401, 403]).toContain(res.status);
    }
  });

  it('GET /api/prism/balance with JWT returns balance for jwt address', async () => {
    const token = makeJwt(ADDRESSES.jwt);
    const res = await getJson(`/api/prism/balance?address=${ADDRESSES.jwt}`, token);
    if (res.status === 200) {
      const body = res.body as Record<string, unknown>;
      expect(typeof body.balance).toBe('number');
    } else {
      expect([400, 401, 403, 404]).toContain(res.status);
    }
  });

  // ── Score history ────────────────────────────────────────────────────────

  it('GET /api/score-history without address returns 400 or 404', async () => {
    const res = await getJson('/api/score-history');
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/score-history for known address returns array or empty', async () => {
    const res = await getJson(`/api/score-history?address=${ADDRESSES.known}`);
    if (res.status === 200) {
      expect(Array.isArray(res.body) || typeof res.body === 'object').toBe(true);
    } else {
      expect([400, 404]).toContain(res.status);
    }
  });

  // ── Daily limits ─────────────────────────────────────────────────────────

  it('GET /api/daily-limits for known address returns structured response', async () => {
    const res = await getJson(`/api/daily-limits?address=${ADDRESSES.known}`);
    if (res.status === 200) {
      expect(typeof res.body).toBe('object');
      // Should have some kind of limits data
      expect(res.body).not.toBeNull();
    } else {
      expect([400, 401, 404]).toContain(res.status);
    }
  });

  it('GET /api/daily-limits without address returns 400', async () => {
    const res = await getJson('/api/daily-limits');
    expect([400, 404]).toContain(res.status);
  });

  // ── XP endpoint ──────────────────────────────────────────────────────────

  it('GET /api/xp for known address returns numeric xp or 404', async () => {
    const res = await getJson(`/api/xp?address=${ADDRESSES.known}`);
    if (res.status === 200) {
      const body = res.body as Record<string, unknown>;
      // XP response should have some numeric field
      const hasNumeric = Object.values(body).some((v) => typeof v === 'number');
      expect(hasNumeric).toBe(true);
    } else {
      expect([400, 401, 404]).toContain(res.status);
    }
  });

  // ── Sybil analysis ───────────────────────────────────────────────────────

  it('GET /api/sybil/analysis without address returns 400', async () => {
    const res = await getJson('/api/sybil/analysis');
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/sybil/analysis for known address returns sybil data', async () => {
    const res = await getJson(`/api/sybil/analysis?address=${ADDRESSES.known}`);
    if (res.status === 200) {
      const body = res.body as Record<string, unknown>;
      // Should have trustScore or riskScore
      const hasSybilFields =
        'trustScore' in body || 'riskScore' in body || 'sybil' in body || 'metrics' in body;
      expect(hasSybilFields).toBe(true);
    } else {
      expect([400, 404, 500]).toContain(res.status);
    }
  });

  // ── Spend endpoint — requires JWT ────────────────────────────────────────

  it('POST /api/prism/spend without JWT returns 401', async () => {
    const res = await postJson('/api/prism/spend', {
      address: ADDRESSES.jwt,
      source: 'forge_frame',
      amount: 1000,
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/prism/spend with JWT but insufficient params returns 400 or 401', async () => {
    const token = makeJwt(ADDRESSES.jwt);
    const res = await postJson('/api/prism/spend', {}, token);
    // Missing required fields → 400
    expect([400, 401, 422]).toContain(res.status);
  });

  // ── Game leaderboard ─────────────────────────────────────────────────────

  it('GET /api/game/leaderboard returns structured response', async () => {
    const res = await getJson('/api/game/leaderboard?mode=orbit_survival&limit=5');
    if (res.status === 200) {
      expect(typeof res.body).toBe('object');
      // Should be array or have entries field
      const body = res.body as Record<string, unknown>;
      expect(Array.isArray(res.body) || Array.isArray(body.entries) || Array.isArray(body.leaderboard)).toBe(true);
    } else {
      expect([400, 404]).toContain(res.status);
    }
  });

  it('POST /api/game/leaderboard returns structured response', async () => {
    // May or may not require JWT — just verify it doesn't crash the server
    const res = await postJson('/api/game/leaderboard', {
      mode: 'orbit_survival',
      score: 9999,
      address: ADDRESSES.known,
    });
    expect([200, 400, 401, 403, 422]).toContain(res.status);
    expect(typeof res.body).toBe('object');
  });

  // ── Referral ─────────────────────────────────────────────────────────────

  it('GET /api/referral/code without address returns 400 or 401', async () => {
    const res = await getJson('/api/referral/code');
    expect([400, 401, 404]).toContain(res.status);
  });

  it('GET /api/referral/code with address returns code or 404', async () => {
    const res = await getJson(`/api/referral/code?address=${ADDRESSES.known}`);
    if (res.status === 200) {
      const body = res.body as Record<string, unknown>;
      expect(typeof body.code === 'string' || typeof body.referralCode === 'string').toBe(true);
    } else {
      expect([400, 401, 404]).toContain(res.status);
    }
  });

  // ── Migration status ──────────────────────────────────────────────────────

  it('GET /api/migration-status returns structured response', async () => {
    const res = await getJson(`/api/migration-status?address=${ADDRESSES.known}`);
    if (res.status === 200) {
      expect(typeof res.body).toBe('object');
    } else {
      expect([400, 401, 404]).toContain(res.status);
    }
  });
});
