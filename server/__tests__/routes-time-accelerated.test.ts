import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SERVER_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'helius-proxy.js');
const TEST_JWT_SECRET = 'routes-time-accelerated-test-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

const ADDRESSES = {
  openCreator: '44444444444444444444444444444441',
  gameCreator: '44444444444444444444444444444442',
  tournamentWinner: '44444444444444444444444444444443',
  tournamentLoser: '44444444444444444444444444444444',
  vaultMature: '44444444444444444444444444444445',
  quizCap: '44444444444444444444444444444446',
  nonGameCap: '44444444444444444444444444444447',
  scanCap: '44444444444444444444444444444448',
  huntCap: '44444444444444444444444444444449',
  cleanTarget: '11111111111111111111111111111111',
  sybilTarget: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
};

type JsonResponse = {
  status: number;
  body: unknown;
};

let workspaceDir = '';
let metadataDir = '';
let rateLimitDbPath = '';
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

const loadQuizAnswerMap = () => {
  const source = readFileSync(SERVER_ENTRY, 'utf8');
  const start = source.indexOf('const QUIZ_BANK = [');
  const arrayStart = source.indexOf('[', start);
  let markerIndex = source.indexOf('];\n// Reputation', arrayStart);
  if (markerIndex === -1) markerIndex = source.indexOf('];\r\n// Reputation', arrayStart);
  if (start === -1 || arrayStart === -1 || markerIndex === -1) {
    throw new Error('QUIZ_BANK bounds not found');
  }
  const quizBankLiteral = source.slice(arrayStart, markerIndex + 1);
  const quizBank = Function(`return ${quizBankLiteral}`)() as Array<{ q: string; a: string }>;
  return new Map(quizBank.map((entry) => [entry.q, entry.a]));
};

const answerMap = loadQuizAnswerMap();

const createCleanAnalysis = (now: string) => ({
  trustScore: 92,
  riskScore: 8,
  updatedAt: now,
  signals: [],
  metrics: {
    txCount: 520,
    siblingCount: 0,
    fundingChainDepth: 0,
    topFunderTxCount: 0,
    topFunderPct: 0,
    walletAgeDays: 1100,
    activeDaysRatio: 0.28,
    uniquePrograms: 16,
    tokenDiversityCount: 18,
    nftCount: 9,
    uniqueSenders: 9,
    hasSolDomain: true,
    defiDepth: 3,
  },
});

const createSybilAnalysis = (now: string) => ({
  trustScore: 18,
  riskScore: 82,
  updatedAt: now,
  signals: [
    { id: 'graph_intelligence', name: 'graph_intelligence', category: 'network', detected: true, weight: 20, severity: 'danger', value: '', description: 'graph_intelligence' },
    { id: 'hub_spoke', name: 'hub_spoke', category: 'network', detected: true, weight: 15, severity: 'danger', value: '', description: 'hub_spoke' },
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
});

const createWallet = (address: string, now: string, overrides: Record<string, unknown> = {}) => ({
  address,
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
    walletAgeDays: 200,
    txCount: 120,
    nftCount: 0,
    solBalance: 1.5,
    defiProtocols: [],
    hasSeeker: false,
    hasPreorder: false,
    hasCombo: false,
  },
  stats: { walletAgeDays: 200, transactions: 120, nfts: 0, solBalance: 1.5 },
  sybil: createCleanAnalysis(now),
  socialStats: {},
  lastSeenAt: now,
  ...overrides,
});

const seedWorkspace = () => {
  const now = new Date().toISOString();
  const nowMs = Date.now();

  writeJson(path.join(metadataDir, 'wallet-database.json'), {
    version: 1,
    updatedAt: now,
    totalWallets: Object.keys(ADDRESSES).length,
    wallets: {
      [ADDRESSES.openCreator]: createWallet(ADDRESSES.openCreator, now, { coins: 900 }),
      [ADDRESSES.gameCreator]: createWallet(ADDRESSES.gameCreator, now, { coins: 950 }),
      [ADDRESSES.tournamentWinner]: createWallet(ADDRESSES.tournamentWinner, now, { coins: 2000 }),
      [ADDRESSES.tournamentLoser]: createWallet(ADDRESSES.tournamentLoser, now, { coins: 1000 }),
      [ADDRESSES.vaultMature]: createWallet(ADDRESSES.vaultMature, now, {
        coins: 5000,
        staking: {
          amount: 10000,
          tier: 'bronze',
          startTime: nowMs - 8 * DAY_MS,
          lastClaimTime: nowMs - 2 * DAY_MS,
          lockEnd: nowMs - DAY_MS,
          lockDays: 7,
          yieldMultiplier: 1,
          earlyPenalty: 0.1,
        },
      }),
      [ADDRESSES.quizCap]: createWallet(ADDRESSES.quizCap, now, { coins: 100 }),
      [ADDRESSES.nonGameCap]: createWallet(ADDRESSES.nonGameCap, now, { coins: 100 }),
      [ADDRESSES.scanCap]: createWallet(ADDRESSES.scanCap, now, { coins: 100 }),
      [ADDRESSES.huntCap]: createWallet(ADDRESSES.huntCap, now, { coins: 100 }),
      [ADDRESSES.cleanTarget]: createWallet(ADDRESSES.cleanTarget, now, { score: 210, sybil: createCleanAnalysis(now) }),
      [ADDRESSES.sybilTarget]: createWallet(ADDRESSES.sybilTarget, now, { score: 40, sybil: createSybilAnalysis(now) }),
    },
  });

  writeJson(path.join(metadataDir, 'coin-balances.json'), {
    version: 1,
    updatedAt: now,
    totalBurned: 0,
    balances: {
      [ADDRESSES.openCreator]: 900,
      [ADDRESSES.gameCreator]: 950,
      [ADDRESSES.tournamentWinner]: 2000,
      [ADDRESSES.tournamentLoser]: 1000,
      [ADDRESSES.vaultMature]: 5000,
      [ADDRESSES.quizCap]: 100,
      [ADDRESSES.nonGameCap]: 100,
      [ADDRESSES.scanCap]: 100,
      [ADDRESSES.huntCap]: 100,
      [ADDRESSES.cleanTarget]: 0,
      [ADDRESSES.sybilTarget]: 0,
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

  writeJson(path.join(metadataDir, 'notifications.json'), {});

  writeJson(path.join(metadataDir, 'challenges.json'), {
    version: 1,
    updatedAt: now,
    challenges: [
      {
        id: 'ch_expired_open_fixture',
        creator: ADDRESSES.openCreator,
        opponent: null,
        type: 'score',
        gameMode: null,
        stakeType: 'coins',
        stakeAmount: 100,
        status: 'open',
        creatorScore: null,
        opponentScore: null,
        winner: null,
        createdAt: nowMs - 10 * 60 * 1000,
        expiresAt: nowMs - 2_000,
        acceptedAt: null,
        completedAt: null,
      },
      {
        id: 'ch_expired_game_fixture',
        creator: ADDRESSES.gameCreator,
        opponent: null,
        type: 'game',
        gameMode: 'orbit',
        stakeType: 'coins',
        stakeAmount: 50,
        status: 'playing',
        creatorScore: 123,
        opponentScore: null,
        winner: null,
        createdAt: nowMs - 10 * 60 * 1000,
        expiresAt: nowMs - 2_000,
        acceptedAt: null,
        completedAt: null,
      },
    ],
  });

  writeJson(path.join(workspaceDir, 'tournament_data.json'), {
    active: {
      daily: {
        id: 't_daily_fast_fixture',
        tier: 'daily',
        mode: 'orbit',
        entryFee: 1000,
        prizePool: 1800,
        startTime: nowMs - DAY_MS,
        endTime: nowMs + 1_200,
        entries: {
          [ADDRESSES.tournamentWinner]: { score: 500, submittedAt: now },
          [ADDRESSES.tournamentLoser]: { score: 120, submittedAt: now },
        },
        status: 'active',
        label: 'Daily',
      },
      weekly: null,
      monthly: null,
    },
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
  rateLimitDbPath = path.join(metadataDir, 'rate-limit.db');
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
      RATE_LIMIT_DB_PATH: rateLimitDbPath,
      PRISM_SCHEDULER_TOURNAMENT_CHECK_MS: '50',
      PRISM_SCHEDULER_CHALLENGE_EXPIRY_MS: '50',
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
      'X-Forwarded-For': '198.51.100.90',
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
      'X-Forwarded-For': '198.51.100.90',
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

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 6_000, intervalMs = 75) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Condition not met in time.\n${serverLogs}`);
};

const getBalance = async (address: string, token?: string) => {
  const response = await getJson(`/api/prism/balance?address=${address}`, token);
  expect(response.status).toBe(200);
  return (response.body as Record<string, number>).balance;
};

const getComputedXp = async (address: string) => {
  const response = await getJson(`/api/xp?address=${address}`, makeJwt(address));
  expect(response.status).toBe(200);
  return (response.body as { computedXP: number }).computedXP;
};

const setRateLimit = (key: string, value: unknown, ttlSeconds = 86_400) => {
  const db = new Database(rateLimitDbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO rate_limits (key, value, expires_at)
    VALUES (@key, @value, @expires_at)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      expires_at = excluded.expires_at
  `).run({
    key,
    value: JSON.stringify(value),
    expires_at: Date.now() + ttlSeconds * 1000,
  });
  db.close();
};

describe.sequential('time-accelerated route integration tests', () => {
  beforeAll(async () => {
    workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'identity-prism-fast-'));
    metadataDir = path.join(workspaceDir, 'metadata');
    mkdirSync(metadataDir, { recursive: true });
    seedWorkspace();
    await startServer();
  }, 30_000);

  afterAll(async () => {
    await stopServer();
    if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true });
  }, 30_000);

  it('fast scheduler expires arena challenges, refunds balances, and pushes notifications', async () => {
    const openToken = makeJwt(ADDRESSES.openCreator);
    const gameToken = makeJwt(ADDRESSES.gameCreator);

    await waitFor(async () => {
      const [openMine, gameMine] = await Promise.all([
        getJson('/api/challenge/my', openToken),
        getJson('/api/challenge/my', gameToken),
      ]);
      const openChallenge = (openMine.body as { challenges: Array<Record<string, unknown>> }).challenges.find((challenge) => challenge.id === 'ch_expired_open_fixture');
      const gameChallenge = (gameMine.body as { challenges: Array<Record<string, unknown>> }).challenges.find((challenge) => challenge.id === 'ch_expired_game_fixture');
      return openChallenge?.status === 'expired' && gameChallenge?.status === 'expired';
    });

    expect(await getBalance(ADDRESSES.openCreator, openToken)).toBe(1000);
    expect(await getBalance(ADDRESSES.gameCreator, gameToken)).toBe(1000);

    const [openInbox, gameInbox] = await Promise.all([
      getJson('/api/notifications', openToken),
      getJson('/api/notifications', gameToken),
    ]);
    const openNotification = (openInbox.body as { notifications: Array<Record<string, unknown>> }).notifications.find(
      (notification) => notification.type === 'challenge_expired' && notification.meta?.challengeId === 'ch_expired_open_fixture',
    );
    const gameNotification = (gameInbox.body as { notifications: Array<Record<string, unknown>> }).notifications.find(
      (notification) => notification.type === 'challenge_expired' && notification.meta?.challengeId === 'ch_expired_game_fixture',
    );
    expect(openNotification).toMatchObject({ type: 'challenge_expired', meta: { refunded: 100 } });
    expect(gameNotification).toMatchObject({ type: 'challenge_expired', meta: { refunded: 50 } });
  });

  it('auto-finalizes tournament on the fast scheduler and awards payout plus XP', async () => {
    const winnerToken = makeJwt(ADDRESSES.tournamentWinner);
    const beforeBalance = await getBalance(ADDRESSES.tournamentWinner, winnerToken);
    const beforeXp = await getComputedXp(ADDRESSES.tournamentWinner);

    await waitFor(async () => {
      const history = await getJson('/api/tournament/history');
      const completed = (history.body as { tournaments: Array<Record<string, unknown>> }).tournaments;
      return completed.some((tournament) => tournament.id === 't_daily_fast_fixture');
    }, 8_000, 100);

    const afterBalance = await getBalance(ADDRESSES.tournamentWinner, winnerToken);
    const afterXp = await getComputedXp(ADDRESSES.tournamentWinner);
    expect(afterBalance).toBeGreaterThanOrEqual(beforeBalance);
    expect(afterXp).toBeGreaterThanOrEqual(beforeXp);

    const active = await getJson('/api/tournament/active', winnerToken);
    expect(active.status).toBe(200);
    expect((active.body as { tournaments: { daily: { id: string } } }).tournaments.daily.id).not.toBe('t_daily_fast_fixture');

    const inbox = await getJson('/api/notifications', winnerToken);
    const payout = (inbox.body as { notifications: Array<Record<string, unknown>> }).notifications.find(
      (notification) => notification.type === 'tournament_result' && notification.meta?.tier === 'daily',
    );
    expect(payout).toBeTruthy();
    expect(payout?.meta).toMatchObject({ placement: 1 });
    expect((payout?.meta as Record<string, number>).prize).toBeGreaterThan(0);
  });

  it('handles matured vault claim and unstake without penalty', async () => {
    const token = makeJwt(ADDRESSES.vaultMature);
    const statusBefore = await getJson(`/api/prism/vault/status?address=${ADDRESSES.vaultMature}`, token);
    expect(statusBefore.status).toBe(200);
    expect((statusBefore.body as { staking: { amount: number }; unclaimedYield: number }).staking.amount).toBe(10000);
    expect((statusBefore.body as { unclaimedYield: number }).unclaimedYield).toBeGreaterThan(0);

    const beforeBalance = await getBalance(ADDRESSES.vaultMature, token);
    const claim = await postJson('/api/prism/vault/claim', {}, token);
    expect(claim.status).toBe(200);
    expect((claim.body as { claimed: number }).claimed).toBeGreaterThan(0);

    const unstake = await postJson('/api/prism/vault/unstake', {}, token);
    expect(unstake.status).toBe(200);
    expect(unstake.body).toMatchObject({ returned: 10000, penalty: 0, early: false });

    const afterBalance = await getBalance(ADDRESSES.vaultMature, token);
    expect(afterBalance).toBeGreaterThan(beforeBalance);

    const statusAfter = await getJson(`/api/prism/vault/status?address=${ADDRESSES.vaultMature}`, token);
    expect(statusAfter.status).toBe(200);
    expect((statusAfter.body as { staking: unknown }).staking).toBeNull();

    const inbox = await getJson('/api/notifications', token);
    const notifications = (inbox.body as { notifications: Array<Record<string, unknown>> }).notifications;
    expect(notifications.some((notification) => notification.meta?.source === 'vault_claim')).toBe(true);
    expect(notifications.some((notification) => notification.meta?.source === 'vault_unstake')).toBe(true);
  });

  it('stops quiz rewards when the quiz-specific daily cap is already full', async () => {
    const token = makeJwt(ADDRESSES.quizCap);
    const today = new Date().toISOString().slice(0, 10);
    setRateLimit(`quiz:${ADDRESSES.quizCap}:${today}`, 100);
    setRateLimit(`nongame_daily:${ADDRESSES.quizCap}`, { date: today, total: 500 });

    const beforeBalance = await getBalance(ADDRESSES.quizCap, token);
    const question = await getJson('/api/quiz/question');
    expect(question.status).toBe(200);
    const qBody = question.body as { id: string; question: string };
    const answer = answerMap.get(qBody.question);
    expect(answer).toBeTruthy();

    const result = await postJson('/api/quiz/answer', { id: qBody.id, answer, address: ADDRESSES.quizCap }, token);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ correct: true, earned: 0 });
    expect(await getBalance(ADDRESSES.quizCap, token)).toBe(beforeBalance);

    const limits = await getJson(`/api/daily-limits?address=${ADDRESSES.quizCap}`, token);
    expect(limits.status).toBe(200);
    expect(limits.body).toMatchObject({
      quiz: { earned: 500, cap: 500 },
      nonGame: { earned: 500, cap: 750 },
    });
  });

  it('stops quiz rewards when the non-game daily cap is already full', async () => {
    const token = makeJwt(ADDRESSES.nonGameCap);
    const today = new Date().toISOString().slice(0, 10);
    setRateLimit(`nongame_daily:${ADDRESSES.nonGameCap}`, { date: today, total: 750 });

    const beforeBalance = await getBalance(ADDRESSES.nonGameCap, token);
    const question = await getJson('/api/quiz/question');
    expect(question.status).toBe(200);
    const qBody = question.body as { id: string; question: string };
    const answer = answerMap.get(qBody.question);
    expect(answer).toBeTruthy();

    const result = await postJson('/api/quiz/answer', { id: qBody.id, answer, address: ADDRESSES.nonGameCap }, token);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ correct: true, earned: 0 });
    expect(await getBalance(ADDRESSES.nonGameCap, token)).toBe(beforeBalance);

    const limits = await getJson(`/api/daily-limits?address=${ADDRESSES.nonGameCap}`, token);
    expect(limits.status).toBe(200);
    expect(limits.body).toMatchObject({
      nonGame: { earned: 750, cap: 750 },
      quiz: { earned: 0, cap: 500 },
    });
  });

  it('rejects further scan and sybil rewards once their daily subcaps are reached', async () => {
    const today = new Date().toISOString().slice(0, 10);
    setRateLimit(`subcap:${ADDRESSES.scanCap}:scan_wallet:${today}`, 100);
    setRateLimit(`subcap:${ADDRESSES.huntCap}:sybil_hunt:${today}`, 500);

    const scanToken = makeJwt(ADDRESSES.scanCap);
    const huntToken = makeJwt(ADDRESSES.huntCap);

    const scanRes = await postJson('/api/prism/earn', {
      address: ADDRESSES.scanCap,
      source: 'scan_wallet',
      amount: 5,
      description: 'Scan cap fixture',
      scanTarget: ADDRESSES.cleanTarget,
    }, scanToken);
    expect(scanRes.status).toBe(429);
    expect(scanRes.body).toMatchObject({ dailyRemaining: 0 });

    const huntRes = await postJson('/api/prism/earn', {
      address: ADDRESSES.huntCap,
      source: 'sybil_hunt',
      amount: 70,
      description: 'Hunt cap fixture',
      scanTarget: ADDRESSES.sybilTarget,
    }, huntToken);
    expect(huntRes.status).toBe(429);
    expect(huntRes.body).toMatchObject({ dailyRemaining: 0 });

    const [scanLimits, huntLimits] = await Promise.all([
      getJson(`/api/daily-limits?address=${ADDRESSES.scanCap}`, makeJwt(ADDRESSES.scanCap)),
      getJson(`/api/daily-limits?address=${ADDRESSES.huntCap}`, makeJwt(ADDRESSES.huntCap)),
    ]);
    expect(scanLimits.body).toMatchObject({ scan: { earned: 100, cap: 100 } });
    expect(huntLimits.body).toMatchObject({ hunt: { earned: 500, cap: 500 } });
  });
});
