import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyStakingBoostAfterCap,
  canAwardQuizReward,
  getHolderAdjustedCap,
} from '../services/economyRules.js';

const TEST_JWT_SECRET = 'economy-test-secret';
const SERVER_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'helius-proxy.js');
const ADDRESSES = {
  jwt: '11111111111111111111111111111111',
  unknown: '11111111111111111111111111111112',
  max: '11111111111111111111111111111113',
  achievement: '11111111111111111111111111111114',
  referral: '11111111111111111111111111111115',
  firstMint: '11111111111111111111111111111116',
  quiz: '11111111111111111111111111111117',
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

const makeJwt = (address: string) => jwt.sign(
  { address },
  TEST_JWT_SECRET,
  {
    expiresIn: '1h',
    algorithm: 'HS256',
    issuer: 'identity-prism',
    audience: 'identity-prism-api',
  },
);

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

const restartServer = async () => {
  await stopServer();
  await startServer();
};

const postJson = async (pathname: string, body: Record<string, unknown>, token?: string): Promise<JsonResponse> => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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

describe.sequential('economy guards', () => {
  beforeAll(async () => {
    workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'identity-prism-economy-'));
    metadataDir = path.join(workspaceDir, 'metadata');
    mkdirSync(metadataDir, { recursive: true });
    await startServer();
  }, 30_000);

  afterAll(async () => {
    await stopServer();
    if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true });
  }, 30_000);

  it('requires JWT on POST /api/prism/earn', async () => {
    const response = await postJson('/api/prism/earn', {
      address: ADDRESSES.jwt,
      source: 'first_mint',
      amount: 1000,
    });

    expect(response.status).toBe(401);
  });

  it('rejects unknown prism earn sources', async () => {
    const response = await postJson('/api/prism/earn', {
      address: ADDRESSES.unknown,
      source: 'made_up_source',
      amount: 1,
    }, makeJwt(ADDRESSES.unknown));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid earn source' });
  });

  it('rejects prism earn amounts above MAX_EARN_PER_CALL', async () => {
    const response = await postJson('/api/prism/earn', {
      address: ADDRESSES.max,
      source: 'first_mint',
      amount: 1001,
    }, makeJwt(ADDRESSES.max));

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Max 1000 Coins');
  });

  it('blocks achievement rewards on /api/prism/earn', async () => {
    const response = await postJson('/api/prism/earn', {
      address: ADDRESSES.achievement,
      source: 'achievement',
      amount: 50,
    }, makeJwt(ADDRESSES.achievement));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Use POST /api/game/achievements for achievement rewards' });
  });

  it('blocks referral rewards on /api/prism/earn', async () => {
    const response = await postJson('/api/prism/earn', {
      address: ADDRESSES.referral,
      source: 'referral',
      amount: 20,
    }, makeJwt(ADDRESSES.referral));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Use POST /api/referral/claim for referral rewards' });
  });

  it('applies the non-game cap at half for non-holders and full for holders', () => {
    expect(getHolderAdjustedCap(1500, false)).toBe(750);
    expect(getHolderAdjustedCap(1500, true)).toBe(1500);
  });

  it('applies staking boost only after the cap-clipped amount is chosen', () => {
    expect(applyStakingBoostAfterCap(750, 0.5)).toBe(1125);
    expect(applyStakingBoostAfterCap(0, 1)).toBe(0);
  });

  it('keeps quiz rewards inside the non-game daily cap umbrella', () => {
    expect(canAwardQuizReward({
      dailyCount: 0,
      maxDailyAnswers: 100,
      ngEarned: 745,
      reward: 5,
      nonGameCap: 750,
    })).toBe(true);

    expect(canAwardQuizReward({
      dailyCount: 0,
      maxDailyAnswers: 100,
      ngEarned: 750,
      reward: 5,
      nonGameCap: 750,
    })).toBe(false);
  });

  it('requires JWT on POST /api/quiz/answer', async () => {
    const response = await postJson('/api/quiz/answer', {
      id: 'missing',
      answer: 'A',
      address: ADDRESSES.quiz,
    });

    expect(response.status).toBe(401);
  });

  it('rejects duplicate first_mint claims across server restarts', async () => {
    const token = makeJwt(ADDRESSES.firstMint);
    const firstResponse = await postJson('/api/prism/earn', {
      address: ADDRESSES.firstMint,
      source: 'first_mint',
      amount: 1000,
    }, token);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.earned).toBe(750);

    await sleep(800);
    await restartServer();

    const secondResponse = await postJson('/api/prism/earn', {
      address: ADDRESSES.firstMint,
      source: 'first_mint',
      amount: 1000,
    }, token);

    expect(secondResponse.status).toBe(400);
    expect(secondResponse.body).toMatchObject({ error: 'first_mint already claimed' });
  }, 40_000);
});
