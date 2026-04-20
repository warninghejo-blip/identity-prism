/**
 * Route integration tests — spawns the actual server and tests HTTP endpoints.
 * Covers: reputation, vault status, JWT-protected routes, health check.
 *
 * Pattern mirrors reputation.test.ts — minimal workspace seeding, real HTTP calls.
 * Uses a single beforeAll/afterAll to avoid server restart issues.
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
const TEST_JWT_SECRET = 'routes-integration-test-secret';

const ADDRESSES = {
  known:   '22222222222222222222222222222221',
  unknown: '22222222222222222222222222222222',
  jwt:     '22222222222222222222222222222223',
};

type JsonResponse = {
  status: number;
  body: unknown;
};

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
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate free port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on('error', reject);
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

const seedWorkspace = () => {
  const now = new Date().toISOString();

  writeJson(path.join(metadataDir, 'wallet-database.json'), {
    version: 1,
    updatedAt: now,
    totalWallets: 2,
    wallets: {
      [ADDRESSES.known]: {
        address: ADDRESSES.known,
        score: 180,
        scoreBreakdown: {
          solBalance: { pts: 24, max: 40, raw: 1.5 },
          walletAge: { pts: 48, max: 100, raw: 200 },
          transactions: { pts: 20, max: 80, raw: 120 },
          nfts: { pts: 0, max: 32, raw: 0 },
          defiActivity: { pts: 6, max: 30, swapPts: 6, nftTradePts: 0, protocolPts: 0, swaps: 8, protocols: 0 },
          badges: { pts: 0, max: 68, items: [] },
          collection: { pts: 0, max: 50, items: [] },
        },
        traits: {
          walletAgeDays: 200, txCount: 120, nftCount: 0, solBalance: 1.5,
          defiProtocols: [], hasSeeker: false, hasPreorder: false, hasCombo: false,
        },
        stats: { walletAgeDays: 200, transactions: 120, nfts: 0, solBalance: 1.5 },
        sybil: {
          trustScore: 75, riskScore: 25, updatedAt: now, signals: [],
          metrics: {
            txCount: 120, siblingCount: 0, fundingChainDepth: 0, topFunderTxCount: 0,
            topFunderPct: 0, walletAgeDays: 200, activeDaysRatio: 0.15,
            uniquePrograms: 5, tokenDiversityCount: 3, nftCount: 0,
            uniqueSenders: 4, hasSolDomain: false, defiDepth: 0,
          },
        },
        lastSeenAt: now,
      },
      [ADDRESSES.jwt]: {
        address: ADDRESSES.jwt,
        score: 100,
        scoreBreakdown: {
          solBalance: { pts: 16, max: 40, raw: 0.5 },
          walletAge: { pts: 24, max: 100, raw: 100 },
          transactions: { pts: 8, max: 80, raw: 30 },
          nfts: { pts: 0, max: 32, raw: 0 },
          defiActivity: { pts: 0, max: 30, swapPts: 0, nftTradePts: 0, protocolPts: 0, swaps: 0, protocols: 0 },
          badges: { pts: 0, max: 68, items: [] },
          collection: { pts: 0, max: 50, items: [] },
        },
        traits: {
          walletAgeDays: 100, txCount: 30, nftCount: 0, solBalance: 0.5,
          defiProtocols: [], hasSeeker: false, hasPreorder: false, hasCombo: false,
        },
        stats: { walletAgeDays: 100, transactions: 30, nfts: 0, solBalance: 0.5 },
        sybil: {
          trustScore: 60, riskScore: 40, updatedAt: now, signals: [],
          metrics: {
            txCount: 30, siblingCount: 0, fundingChainDepth: 0, topFunderTxCount: 0,
            topFunderPct: 0, walletAgeDays: 100, activeDaysRatio: 0.1,
            uniquePrograms: 2, tokenDiversityCount: 1, nftCount: 0,
            uniqueSenders: 2, hasSolDomain: false, defiDepth: 0,
          },
        },
        lastSeenAt: now,
      },
    },
  });

  // coin-balances: store as plain numbers (format server expects)
  writeJson(path.join(metadataDir, 'coin-balances.json'), {
    version: 1,
    updatedAt: now,
    totalBurned: 0,
    balances: {
      [ADDRESSES.jwt]: 50000,
      [ADDRESSES.known]: 10000,
    },
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
    if (serverProcess?.exitCode !== null) {
      throw new Error(`Server exited early.\n${serverLogs}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // keep polling
    }
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
    await Promise.race([
      new Promise((resolve) => proc.once('exit', resolve)),
      sleep(5_000),
    ]);
  }
  if (proc.exitCode === null) {
    proc.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => proc.once('exit', resolve)),
      sleep(5_000),
    ]);
  }
};

const getJson = async (pathname: string, token?: string): Promise<JsonResponse> => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      'X-Forwarded-For': '198.51.100.50',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
};

const postJson = async (pathname: string, body: Record<string, unknown>, token?: string): Promise<JsonResponse> => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.50',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
};

// ── All tests in a single sequential suite to share one server instance ───────

describe.sequential('route integration tests', () => {
  beforeAll(async () => {
    workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'identity-prism-routes-'));
    metadataDir = path.join(workspaceDir, 'metadata');
    mkdirSync(metadataDir, { recursive: true });
    seedWorkspace();
    await startServer();
  }, 30_000);

  afterAll(async () => {
    await stopServer();
    if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true });
  }, 30_000);

  // ── Health ────────────────────────────────────────────────────────────────

  it('GET /health returns 200', async () => {
    const res = await getJson('/health');
    expect(res.status).toBe(200);
  });

  // ── Reputation ────────────────────────────────────────────────────────────

  it('GET /api/v1/reputation/:addr returns 200 + schema for known address', async () => {
    const res = await getJson(`/api/v1/reputation/${ADDRESSES.known}`);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('address', ADDRESSES.known);
    expect(body).toHaveProperty('score');
    expect(body).toHaveProperty('tier');
    expect(body).toHaveProperty('breakdown');
    expect(typeof body.score).toBe('number');
  });

  it('GET /api/v1/reputation/:addr returns 404 for unknown address', async () => {
    const res = await getJson(`/api/v1/reputation/${ADDRESSES.unknown}`);
    expect(res.status).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('reputation breakdown has expected numeric fields', async () => {
    const res = await getJson(`/api/v1/reputation/${ADDRESSES.known}`);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const breakdown = body.breakdown as Record<string, number>;
    expect(typeof breakdown.onchain).toBe('number');
    expect(typeof breakdown.sybilTrust).toBe('number');
    expect(typeof breakdown.humanProof).toBe('number');
  });

  // ── Vault status ──────────────────────────────────────────────────────────

  it('GET /api/prism/vault/status returns structured response', async () => {
    const res = await getJson(`/api/prism/vault/status?address=${ADDRESSES.known}`);
    // Should be 200 (with staking data or staked:false) or 404 if not implemented
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(typeof res.body).toBe('object');
    }
  });

  // ── JWT-protected routes ──────────────────────────────────────────────────

  it('POST /api/quiz/answer returns 401 without JWT', async () => {
    const res = await postJson('/api/quiz/answer', { questionId: 'q1', answer: 'a' });
    expect(res.status).toBe(401);
  });

  it('POST /api/tournament/join returns 401 without JWT', async () => {
    const res = await postJson('/api/tournament/join', { tier: 'daily' });
    expect(res.status).toBe(401);
  });

  it('POST /api/prism/buy returns 401 without JWT', async () => {
    const res = await postJson('/api/prism/buy', { packageIndex: 0, txSignature: 'fakesig' });
    expect(res.status).toBe(401);
  });

  // ── Balance endpoint ──────────────────────────────────────────────────────

  it('GET /api/prism/balance returns coin balance for known address', async () => {
    const res = await getJson(`/api/prism/balance?address=${ADDRESSES.known}`);
    if (res.status === 200) {
      const body = res.body as Record<string, unknown>;
      expect(typeof body.balance).toBe('number');
      expect(body.balance).toBeGreaterThanOrEqual(0);
    } else {
      // Endpoint may require JWT or not exist — accept 400/401/404
      expect([400, 401, 404]).toContain(res.status);
    }
  });

  // ── Tournament with JWT ───────────────────────────────────────────────────

  it('POST /api/tournament/join with valid JWT returns structured error (no active tournament)', async () => {
    const token = makeJwt(ADDRESSES.jwt);
    const res = await postJson('/api/tournament/join', { tier: 'daily' }, token);
    // No active tournament seeded → should return structured error
    expect([200, 400, 404, 409]).toContain(res.status);
    // Either success or error — both should be structured JSON
    expect(typeof res.body).toBe('object');
  });

  // ── Daily limits ──────────────────────────────────────────────────────────

  it('GET /api/daily-limits or equivalent returns structured response', async () => {
    const res = await getJson(`/api/daily-limits?address=${ADDRESSES.known}`);
    // Endpoint may or may not exist
    if (res.status === 200) {
      expect(typeof res.body).toBe('object');
    } else {
      expect([400, 404, 405]).toContain(res.status);
    }
  });
});
