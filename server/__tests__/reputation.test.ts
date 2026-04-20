import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SERVER_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'helius-proxy.js');
const ADDRESSES = {
  known: '11111111111111111111111111111121',
  flagged: '11111111111111111111111111111122',
  unknown: '11111111111111111111111111111123',
};

type JsonResponse = {
  status: number;
  body: any;
};

let workspaceDir = '';
let metadataDir = '';
let serverProcess: ChildProcessWithoutNullStreams | null = null;
let serverLogs = '';
let baseUrl = '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getFreePort = () => new Promise<number>((resolve, reject) => {
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

const seedWorkspace = () => {
  const now = new Date().toISOString();

  writeJson(path.join(metadataDir, 'wallet-database.json'), {
    version: 1,
    updatedAt: now,
    totalWallets: 2,
    wallets: {
      [ADDRESSES.known]: {
        address: ADDRESSES.known,
        score: 210,
        scoreBreakdown: {
          solBalance: { pts: 24, max: 40, raw: 1.7 },
          walletAge: { pts: 72, max: 100, raw: 420 },
          transactions: { pts: 20, max: 80, raw: 180 },
          nfts: { pts: 8, max: 32, raw: 8 },
          defiActivity: { pts: 10, max: 30, swapPts: 8, nftTradePts: 0, protocolPts: 2, swaps: 12, protocols: 1 },
          badges: { pts: 6, max: 68, items: ['Collector +6'] },
          collection: { pts: 0, max: 50, items: [] },
        },
        traits: {
          walletAgeDays: 420,
          txCount: 180,
          nftCount: 8,
          solBalance: 1.7,
          defiProtocols: ['jupiter'],
          hasSeeker: false,
          hasPreorder: false,
          hasCombo: false,
        },
        stats: {
          walletAgeDays: 420,
          transactions: 180,
          nfts: 8,
          solBalance: 1.7,
        },
        socialStats: {
          compareCount: 2,
          constellationExplored: 3,
        },
        sybil: {
          trustScore: 88,
          riskScore: 12,
          updatedAt: now,
          signals: [],
          metrics: {
            txCount: 180,
            siblingCount: 0,
            fundingChainDepth: 0,
            topFunderTxCount: 0,
            topFunderPct: 0,
            walletAgeDays: 420,
            activeDaysRatio: 0.24,
            uniquePrograms: 9,
            tokenDiversityCount: 8,
            nftCount: 8,
            uniqueSenders: 6,
            hasSolDomain: true,
            defiDepth: 2,
          },
        },
        lastSeenAt: now,
      },
      [ADDRESSES.flagged]: {
        address: ADDRESSES.flagged,
        score: 60,
        scoreBreakdown: {
          solBalance: { pts: 8, max: 40, raw: 0.2 },
          walletAge: { pts: 14, max: 100, raw: 45 },
          transactions: { pts: 12, max: 80, raw: 90 },
          nfts: { pts: 0, max: 32, raw: 0 },
          defiActivity: { pts: 2, max: 30, swapPts: 2, nftTradePts: 0, protocolPts: 0, swaps: 1, protocols: 0 },
          badges: { pts: 0, max: 68, items: [] },
          collection: { pts: 0, max: 50, items: [] },
        },
        traits: {
          walletAgeDays: 45,
          txCount: 240,
          nftCount: 0,
          solBalance: 0.2,
          defiProtocols: [],
          hasSeeker: false,
          hasPreorder: false,
          hasCombo: false,
        },
        stats: {
          walletAgeDays: 45,
          transactions: 240,
          nfts: 0,
          solBalance: 0.2,
        },
        sybil: {
          trustScore: 18,
          riskScore: 82,
          updatedAt: now,
          signals: [
            { id: 'graph_intelligence', name: 'graph_intelligence', category: 'network', detected: true, weight: 20, severity: 'danger', value: '', description: 'graph_intelligence' },
            { id: 'hub_spoke', name: 'hub_spoke', category: 'network', detected: true, weight: 15, severity: 'danger', value: '', description: 'hub_spoke' },
            { id: 'repeated_funder', name: 'repeated_funder', category: 'network', detected: true, weight: 16, severity: 'danger', value: '', description: 'repeated_funder' },
            { id: 'timing_pattern', name: 'timing_pattern', category: 'behavioral', detected: true, weight: 18, severity: 'danger', value: '', description: 'timing_pattern' },
          ],
          metrics: {
            txCount: 240,
            siblingCount: 12,
            fundingChainDepth: 2,
            topFunderTxCount: 6,
            topFunderPct: 88,
            walletAgeDays: 45,
            activeDaysRatio: 0.03,
            uniquePrograms: 2,
            tokenDiversityCount: 1,
            nftCount: 0,
            uniqueSenders: 1,
            hasSolDomain: false,
            defiDepth: 0,
          },
        },
        lastSeenAt: now,
      },
    },
  });

  writeJson(path.join(metadataDir, 'quest-progress.json'), {
    version: 1,
    updatedAt: now,
    data: {
      [ADDRESSES.known]: {
        quests: {
          daily_scan: { completed: true, progress: 1 },
          ot_first_game: { completed: true, progress: 1 },
        },
        streakDays: 4,
        updatedAt: now,
      },
      [ADDRESSES.flagged]: {
        quests: {},
        streakDays: 0,
        updatedAt: now,
      },
    },
  });

  writeJson(path.join(metadataDir, 'leaderboard.json'), {
    version: 1,
    updatedAt: now,
    entries: [
      { address: ADDRESSES.known, score: 220, gameType: 'orbit', playedAt: now },
      { address: ADDRESSES.known, score: 180, gameType: 'gravity', playedAt: now },
      { address: ADDRESSES.flagged, score: 50, gameType: 'orbit', playedAt: now },
    ],
  });

  writeJson(path.join(metadataDir, 'achievement-claims.json'), {
    version: 2,
    updatedAt: now,
    data: {
      [ADDRESSES.known]: {
        unlocked: ['og_scan', 'pilot_ready', 'quest_hunter'],
        claimed: ['og_scan'],
      },
    },
  });

  writeJson(path.join(workspaceDir, 'tournament_data.json'), {
    active: {
      daily: {
        id: 't_daily_known',
        tier: 'daily',
        mode: 'orbit',
        entryFee: 1000,
        prizePool: 0,
        startTime: Date.now(),
        endTime: Date.now() + 86_400_000,
        entries: {
          [ADDRESSES.known]: { score: 10, submittedAt: now },
        },
        status: 'active',
        label: 'Daily',
      },
      weekly: null,
      monthly: null,
    },
    history: [
      {
        id: 't_weekly_history',
        tier: 'weekly',
        mode: 'gravity',
        entryFee: 5000,
        prizePool: 0,
        startTime: Date.now() - 604_800_000,
        endTime: Date.now() - 86_400_000,
        entries: {
          [ADDRESSES.known]: { score: 55, submittedAt: now },
          [ADDRESSES.flagged]: { score: 5, submittedAt: now },
        },
        status: 'ended',
        label: 'Weekly',
        winners: [],
      },
    ],
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

const getJson = async (pathname: string, forwardedFor: string): Promise<JsonResponse> => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      'X-Forwarded-For': forwardedFor,
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
};

describe.sequential('public reputation endpoint', () => {
  beforeAll(async () => {
    workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'identity-prism-reputation-'));
    metadataDir = path.join(workspaceDir, 'metadata');
    mkdirSync(metadataDir, { recursive: true });
    seedWorkspace();
    await startServer();
  }, 30_000);

  afterAll(async () => {
    await stopServer();
    if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true });
  }, 30_000);

  it('GET /api/v1/reputation/:address returns the public schema for a known address', async () => {
    const response = await getJson(`/api/v1/reputation/${ADDRESSES.known}`, '198.51.100.10');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      address: ADDRESSES.known,
      tier: expect.any(String),
      sybilRisk: 'low',
      breakdown: {
        onchain: expect.any(Number),
        sybilTrust: expect.any(Number),
        humanProof: expect.any(Number),
        social: expect.any(Number),
        engagement: expect.any(Number),
      },
      behavioralProof: {
        rank: 'Pilot',
        gamesPlayed: 2,
        questsCompleted: 2,
        tournamentsPlayed: 2,
      },
      ttl: 300,
    });
    expect(response.body.score).toBeGreaterThan(0);
    expect(response.body.sybilConfidence).toBeGreaterThanOrEqual(0);
    expect(response.body.sybilConfidence).toBeLessThanOrEqual(1);
    expect(new Date(response.body.updatedAt).toISOString()).toBe(response.body.updatedAt);
  });

  it('returns 404 for an unknown address', async () => {
    const response = await getJson(`/api/v1/reputation/${ADDRESSES.unknown}`, '198.51.100.11');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'address not found' });
  });

  it('respects the 60 req/min public rate limit', async () => {
    for (let index = 0; index < 60; index += 1) {
      const response = await getJson(`/api/v1/reputation/${ADDRESSES.known}`, '198.51.100.12');
      expect(response.status).toBe(200);
    }

    const blocked = await getJson(`/api/v1/reputation/${ADDRESSES.known}`, '198.51.100.12');
    expect(blocked.status).toBe(429);
  });

  it('returns high sybil risk for flagged addresses', async () => {
    const response = await getJson(`/api/v1/reputation/${ADDRESSES.flagged}`, '198.51.100.13');

    expect(response.status).toBe(200);
    expect(response.body.sybilRisk).toBe('high');
    expect(response.body.sybilConfidence).toBeGreaterThan(0.75);
  });
});
