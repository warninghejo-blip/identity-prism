import { describe, expect, it, vi } from 'vitest';
import {
  registerReputationInlineRoute,
  registerReputationRoute,
} from '../routes/reputation.js';

const ADDRESS = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
const IDENTITY = {
  score: 317,
  tier: 'binary_sun',
  badges: ['binary'],
};
const COMPOSITE = {
  compositeScore: 597,
  compositeTier: 'neptune',
  breakdown: {
    onchain: 317,
    sybilTrust: 200,
    humanProof: 40,
    social: 20,
    engagement: 20,
  },
  details: null,
};

function createResponse() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: null as any,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    writeHead(statusCode: number, headers: Record<string, string> = {}) {
      this.statusCode = statusCode;
      Object.assign(this.headers, headers);
    },
    end(payload?: string) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
}

function respondJson(res: ReturnType<typeof createResponse>, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.body = body;
  return true;
}

function createInlineContext() {
  const legacyResponse = {
    address: ADDRESS,
    score: IDENTITY.score,
    tier: IDENTITY.tier,
    badges: IDENTITY.badges,
    scoreBreakdown: { walletAge: { pts: 80, max: 100 } },
  };

  return {
    core: {
      ipRateLimit: vi.fn(() => true),
      getClientIp: vi.fn(() => '198.51.100.20'),
      respondJson,
      readBody: vi.fn(),
      getRpcUrl: vi.fn(),
      getBatchRpcUrl: vi.fn(),
      getBaseUrl: vi.fn(() => 'https://identityprism.xyz'),
      batchGetParsedTxs: vi.fn(),
      reputationRateLimit: new Map(),
    },
    wallet: {
      walletDatabase: new Map([[ADDRESS, {
        score: IDENTITY.score,
        tier: IDENTITY.tier,
        badges: IDENTITY.badges,
        composite: COMPOSITE,
        _lastReputation: legacyResponse,
        lastReputationAt: Date.now(),
      }]]),
      saveWalletDatabaseDebounced: vi.fn(),
      updateWalletEntry: vi.fn(),
      triggerCompositeUpdate: vi.fn(),
    },
    economy: {
      getPrismEarnRateLimit: vi.fn(),
      setPrismEarnRateLimit: vi.fn(),
    },
    sybil: {
      sybilCache: new Map(),
      fetchIdentitySnapshot: vi.fn(async () => ({
        identity: IDENTITY,
        walletAgeDays: 900,
        solBalance: 4.2,
        txCount: 500,
        tokenCount: 12,
        nftCount: 3,
      })),
      calculateCompositeScore: vi.fn(() => COMPOSITE),
      buildCompositeInput: vi.fn(() => ({})),
      getSybilVerdict: vi.fn(),
    },
    treasuryAddress: '11111111111111111111111111111111',
    treasurySecret: '',
    treasurySecretPath: '',
    parseSecretKey: vi.fn(),
    loadSecretKeyFromFile: vi.fn(),
  };
}

describe('reputation score semantics', () => {
  it('keeps legacy score fields while adding explicit base and composite fields', async () => {
    const handler = registerReputationInlineRoute(createInlineContext() as any);
    const response = createResponse();
    const url = new URL(`https://identityprism.xyz/api/reputation?address=${ADDRESS}`);

    const handled = await handler({ method: 'GET', headers: {} } as any, response as any, url, url.pathname);

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      score: 317,
      tier: 'binary_sun',
      maxScore: 400,
      baseScore: 317,
      baseTier: 'binary_sun',
      baseMaxScore: 400,
      compositeScore: 597,
      compositeTier: 'neptune',
      compositeMaxScore: 1000,
      identity: {
        score: 317,
        maxScore: 400,
        tier: 'binary_sun',
      },
      compositeBreakdown: COMPOSITE.breakdown,
      scoreBreakdown: { walletAge: { pts: 80, max: 100 } },
    });
  });

  it('returns explicit base and composite scales from v2', async () => {
    const context = {
      core: {
        ipRateLimit: vi.fn(() => true),
        getClientIp: vi.fn(() => '198.51.100.21'),
        respondJson,
        readBody: vi.fn(),
        requireJwt: vi.fn(),
        resolveCorsOrigin: vi.fn(() => '*'),
      },
      wallet: {
        walletDatabase: new Map(),
        getScoreHistory: vi.fn(() => ({ scores: [] })),
        getCoinBalance: vi.fn(() => 0),
        achievements: new Map(),
      },
      sybil: {
        sybilCache: new Map(),
        buildPublicReputationResponse: vi.fn(),
        publicReputationTtlSeconds: 300,
        reputationV2RateLimit: new Map(),
        fetchIdentitySnapshot: vi.fn(async () => ({
          identity: IDENTITY,
          walletAgeDays: 900,
          solBalance: 4.2,
          txCount: 500,
          tokenCount: 12,
          nftCount: 3,
        })),
        calculateCompositeScore: vi.fn(() => COMPOSITE),
        buildCompositeInput: vi.fn(() => ({})),
        getSybilVerdict: vi.fn(),
        getSybilVerdictHistory: vi.fn(),
        submitSybilFeedback: vi.fn(),
      },
    };
    const handler = registerReputationRoute(context as any);
    const response = createResponse();
    const url = new URL(`https://identityprism.xyz/api/v2/reputation?address=${ADDRESS}`);

    const handled = await handler({ method: 'GET', headers: {} } as any, response as any, url, url.pathname);

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      onchainScore: 317,
      baseScore: 317,
      baseTier: 'binary_sun',
      baseMaxScore: 400,
      compositeScore: 597,
      compositeTier: 'neptune',
      compositeMaxScore: 1000,
      identity: {
        score: 317,
        maxScore: 400,
        tier: 'binary_sun',
      },
    });
  });

  it('labels attest action metadata as the base identity score out of 400', async () => {
    const handler = registerReputationInlineRoute(createInlineContext() as any);
    const response = createResponse();
    const url = new URL(`https://identityprism.xyz/api/actions/attest?address=${ADDRESS}`);

    const handled = await handler({ method: 'GET', headers: {} } as any, response as any, url, url.pathname);

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.body.title).toBe('Attest Base Identity Score: 317/400 — BINARY SUN');
    expect(response.body.title).not.toContain('/1000');
    expect(response.body.description).toContain('base identity score');
  });
});
