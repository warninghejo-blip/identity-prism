const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Scraper, SearchMode } = require('agent-twitter-client');
const { createPuppeteerPoster } = require('./puppeteer_poster');

const envCandidates = [
  path.resolve(__dirname, '..', '.env.scraper'),
  path.resolve(__dirname, '.env.scraper'),
  path.resolve(__dirname, '.env'),
];
const envFile = envCandidates.find((file) => fs.existsSync(file));
require('dotenv').config(envFile ? { path: envFile } : undefined);

const getEnv = (key, fallback = '') => (process.env[key] || fallback).trim();
const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return value.toLowerCase() === 'true';
};

const markPostCooldown = (untilMs) => {
  postCooldownUntil = Math.max(postCooldownUntil, untilMs || 0);
};

const handlePostLimitError = (error) => {
  if (isDailyLimitError(error)) {
    markPostCooldown(getNextDailyResetMs());
    console.warn('[post] Daily limit hit; backing off posts until reset.');
    return true;
  }
  if (isAutomationError(error)) {
    markPostCooldown(Date.now() + 30 * 60 * 1000);
    console.warn('[post] Automation warning hit; backing off posts for 30 minutes.');
    return true;
  }
  return false;
};

const toNumber = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parseList = (value) =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const isRateLimitError = (error) => {
  if (!error) return false;
  if (error?.code === 429 || error?.status === 429) return true;
  const message = String(error?.data?.title || error?.data?.detail || error?.message || error);
  return message.includes('429');
};

const isDailyLimitError = (error) => {
  if (!error) return false;
  const raw = error?.data || error?.message || error;
  const message = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return message.includes('daily limit') || message.includes('code":344');
};

const isAutomationError = (error) => {
  if (!error) return false;
  const raw = error?.data || error?.message || error;
  const message = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return message.includes('code":226') || message.includes('automated') || message.includes('AuthorizationError');
};

const isNotFoundError = (error) => {
  if (!error) return false;
  if (error?.code === 404 || error?.status === 404) return true;
  const message = String(error?.data?.title || error?.data?.detail || error?.message || error);
  return message.includes('404') || message.includes('does not exist');
};

const withTimeout = async (promise, timeoutMs, label) => {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`${label} timed out after ${timeoutMs}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const BOT_USERNAME = getEnv('TWITTER_USER_NAME', 'IdentityPrism').replace(/^@/, '');
const DEFAULT_MENTION_QUERY_BASE = Array.from(
  new Set([
    `@${BOT_USERNAME}`,
    `@${BOT_USERNAME.replace(/_/g, '')}`,
    `@${BOT_USERNAME.replace(/-/g, '')}`,
  ]),
)
  .filter(Boolean)
  .join(' OR ');
const DEFAULT_MENTION_QUERY = DEFAULT_MENTION_QUERY_BASE
  ? `(${DEFAULT_MENTION_QUERY_BASE}) -from:${BOT_USERNAME}`
  : `@${BOT_USERNAME}`;

const repliesPerCycle = Math.max(1, toNumber(getEnv('REPLIES_PER_CYCLE'), 3));

const CONFIG = {
  mentionQuery: getEnv('MENTION_QUERY', DEFAULT_MENTION_QUERY || `@${BOT_USERNAME}`),
  mentionIntervalMs: toNumber(getEnv('MENTION_INTERVAL_MS'), 5 * 60 * 1000),
  mentionBatchSize: toNumber(getEnv('MENTION_BATCH_SIZE'), 20),
  mentionTimeoutMs: Math.max(5000, toNumber(getEnv('MENTION_TIMEOUT_MS'), 30 * 1000)),
  mentionStuckResetMs: Math.max(30 * 1000, toNumber(getEnv('MENTION_STUCK_RESET_MS'), 5 * 60 * 1000)),
  mentionRateLimitCooldownMs: Math.max(
    60 * 1000,
    toNumber(getEnv('MENTION_RATE_LIMIT_COOLDOWN_MS'), 15 * 60 * 1000),
  ),
  replyCooldownMs: Math.max(10 * 60 * 1000, toNumber(getEnv('REPLY_COOLDOWN_MS'), 6 * 60 * 60 * 1000)),
  mentionFallbackEnabled: toBoolean(getEnv('MENTION_FALLBACK_ENABLED'), true),
  mentionSearchEnabled: toBoolean(getEnv('MENTION_SEARCH_ENABLED'), false),
  repliesPerCycle,
  postSchedule: getEnv('POST_CRON', '5 1,5,9,13,17,21 * * *'),
  dryRun: toBoolean(getEnv('DRY_RUN'), false),
  enableImages: toBoolean(getEnv('ENABLE_IMAGES'), true),
  useGeminiImages: toBoolean(getEnv('USE_GEMINI_IMAGES'), true),
  useGeminiText: toBoolean(getEnv('USE_GEMINI_TEXT'), true),
  allowPasswordLogin: toBoolean(getEnv('ALLOW_PASSWORD_LOGIN'), false),
  siteUrl: getEnv('SITE_URL', 'https://identityprism.xyz'),
  postHashtags: parseList(getEnv('POST_HASHTAGS', 'Solana,SolanaMobile,Blinks,Web3')),
  postTickers: parseList(getEnv('POST_TICKERS', 'SOL')),
  postHashtagCount: Math.max(0, toNumber(getEnv('POST_HASHTAG_COUNT'), 2)),
  postTickerCount: Math.max(0, toNumber(getEnv('POST_TICKER_COUNT'), 1)),
  solanaHandles: parseList(getEnv('SOLANA_HANDLES', 'solana')),
  solanaMobileHandles: parseList(getEnv('SOLANA_MOBILE_HANDLES', 'solanamobile')),
  solanaMentionRate: Math.min(1, Math.max(0, Number(getEnv('SOLANA_MENTION_RATE', '0.1')))),
  solanaMobileMentionRate: Math.min(
    1,
    Math.max(0, Number(getEnv('SOLANA_MOBILE_MENTION_RATE', '0.6'))),
  ),
  threadEnabled: toBoolean(getEnv('THREAD_ENABLED'), true),
  threadMaxReplies: Math.max(0, toNumber(getEnv('THREAD_MAX_REPLIES'), 1)),
  engagementEnabled: toBoolean(getEnv('ENGAGEMENT_ENABLED'), true),
  engagementIntervalMs: toNumber(getEnv('ENGAGEMENT_INTERVAL_MS'), 20 * 60 * 1000),
  engagementTimeoutMs: Math.max(5000, toNumber(getEnv('ENGAGEMENT_TIMEOUT_MS'), 30 * 1000)),
  engagementStuckResetMs: Math.max(
    30 * 1000,
    toNumber(getEnv('ENGAGEMENT_STUCK_RESET_MS'), 5 * 60 * 1000),
  ),
  engagementRateLimitCooldownMs: Math.max(
    60 * 1000,
    toNumber(getEnv('ENGAGEMENT_RATE_LIMIT_COOLDOWN_MS'), 15 * 60 * 1000),
  ),
  engagementMaxPerCycle: Math.max(1, toNumber(getEnv('ENGAGEMENT_MAX_PER_CYCLE'), 2)),
  engagementDailyLimit: Math.max(0, toNumber(getEnv('ENGAGEMENT_DAILY_LIMIT'), 10)),
  engagementLookbackMs: toNumber(getEnv('ENGAGEMENT_LOOKBACK_MS'), 24 * 60 * 60 * 1000),
  engagementAccounts: parseList(
    getEnv(
      'ENGAGEMENT_ACCOUNTS',
      'solanamobile,solana',
    ),
  ),
  engagementSearchQueries: parseList(
    getEnv(
      'ENGAGEMENT_SEARCH_QUERIES',
      'solanamobile min_faves:20,solana min_faves:50',
    ),
  ),
  engagementSearchQueryLimit: Math.max(0, toNumber(getEnv('ENGAGEMENT_SEARCH_QUERY_LIMIT'), 0)),
  engagementSearchBatchSize: Math.max(5, toNumber(getEnv('ENGAGEMENT_SEARCH_BATCH_SIZE'), 12)),
  engagementSearchLanguage: getEnv('ENGAGEMENT_SEARCH_LANG', 'en'),
  gmEnabled: toBoolean(getEnv('GM_ENABLED'), true),
  gmIntervalMs: toNumber(getEnv('GM_INTERVAL_MS'), 30 * 60 * 1000),
  gmTimeoutMs: Math.max(5000, toNumber(getEnv('GM_TIMEOUT_MS'), 30 * 1000)),
  gmStuckResetMs: Math.max(30 * 1000, toNumber(getEnv('GM_STUCK_RESET_MS'), 5 * 60 * 1000)),
  gmRateLimitCooldownMs: Math.max(60 * 1000, toNumber(getEnv('GM_RATE_LIMIT_COOLDOWN_MS'), 15 * 60 * 1000)),
  gmDailyLimit: Math.max(0, toNumber(getEnv('GM_DAILY_LIMIT'), 10)),
  gmMaxPerCycle: Math.max(1, toNumber(getEnv('GM_MAX_PER_CYCLE'), 2)),
  gmLookbackMs: toNumber(getEnv('GM_LOOKBACK_MS'), 24 * 60 * 60 * 1000),
  gmSearchQueries: parseList(
    getEnv(
      'GM_SEARCH_QUERIES',
      'gm solana min_faves:20,gm solanamobile min_faves:10,"gm" "solana" min_faves:20',
    ),
  ),
  gmSearchQueryLimit: Math.max(0, toNumber(getEnv('GM_SEARCH_QUERY_LIMIT'), 2)),
  gmSearchBatchSize: Math.max(5, toNumber(getEnv('GM_SEARCH_BATCH_SIZE'), 20)),
  gmSearchLanguage: getEnv('GM_SEARCH_LANG', 'en'),
  gmMinLikes: Math.max(0, toNumber(getEnv('GM_MIN_LIKES'), 20)),
  blinkBaseUrl: getEnv('BLINK_BASE_URL', 'https://identityprism.xyz/?address='),
  statsApiBase: getEnv('STATS_API_BASE', 'https://identityprism.xyz/api/actions/share'),
  botUsername: BOT_USERNAME,
  twitterHost: getEnv('TWITTER_HOST', 'twitter.com').toLowerCase(),
  useLegacyScraper: toBoolean(getEnv('USE_LEGACY_SCRAPER'), false),
  useCookieOverrides: toBoolean(getEnv('USE_COOKIE_OVERRIDES'), false),
  usePuppeteerPoster: toBoolean(getEnv('USE_PUPPETEER_POSTER'), false),
};

const STATE_FILE = path.join(__dirname, 'agent_bot_state.json');
const WALLET_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

let mentionsInFlight = false;
let engagementInFlight = false;
let gmInFlight = false;
let mentionsInFlightAt = 0;
let engagementInFlightAt = 0;
let gmInFlightAt = 0;
let mentionsCooldownUntil = 0;
let engagementCooldownUntil = 0;
let postCooldownUntil = 0;
let puppeteerPoster = null;

const COOKIES_FILE = path.join(__dirname, 'cookies.json');

const getPuppeteerPoster = () => {
  if (!CONFIG.usePuppeteerPoster) return null;
  if (!puppeteerPoster) {
    puppeteerPoster = createPuppeteerPoster({
      getEnv,
      cookiesPath: COOKIES_FILE,
      username: BOT_USERNAME,
    });
  }
  return puppeteerPoster;
};

const genAI = new GoogleGenerativeAI(getEnv('GEMINI_API_KEY'));
const textModel = genAI.getGenerativeModel({
  model: getEnv('GEMINI_MODEL_NAME', 'gemini-2.5-flash'),
});
const IMAGE_MODEL_CANDIDATES = Array.from(
  new Set(
    [
      getEnv('GEMINI_IMAGE_MODEL'),
      'gemini-2.5-flash-image',
      'imagen-3.0-generate-002',
      'imagen-4.0-generate-preview-06-06',
      'imagen-4.0-fast-generate-001',
    ].filter(Boolean),
  ),
);

const POST_TOPICS = [
  'Solana Seeker + AI identity cards',
  'Wallet roasts and score reveals',
  'On-chain reputation as a flex',
  'Solana builders + hackathon energy',
  'Blink-powered sharing (soon)',
];


function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      repliedTweetIds: [],
      engagedTweetIds: [],
      gmTweetIds: [],
      lastEngagementAt: 0,
      lastGmAt: 0,
      engagementDay: '',
      engagementCount: 0,
      gmDay: '',
      gmCount: 0,
    };
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      repliedTweetIds: Array.isArray(parsed.repliedTweetIds)
        ? parsed.repliedTweetIds.map((id) => String(id))
        : [],
      engagedTweetIds: Array.isArray(parsed.engagedTweetIds)
        ? parsed.engagedTweetIds.map((id) => String(id))
        : [],
      gmTweetIds: Array.isArray(parsed.gmTweetIds)
        ? parsed.gmTweetIds.map((id) => String(id))
        : [],
      lastEngagementAt: Number.isFinite(Number(parsed.lastEngagementAt))
        ? Number(parsed.lastEngagementAt)
        : 0,
      lastGmAt: Number.isFinite(Number(parsed.lastGmAt))
        ? Number(parsed.lastGmAt)
        : 0,
      engagementDay: typeof parsed.engagementDay === 'string' ? parsed.engagementDay : '',
      engagementCount: Number.isFinite(Number(parsed.engagementCount))
        ? Number(parsed.engagementCount)
        : 0,
      gmDay: typeof parsed.gmDay === 'string' ? parsed.gmDay : '',
      gmCount: Number.isFinite(Number(parsed.gmCount)) ? Number(parsed.gmCount) : 0,
    };
  } catch (error) {
    console.warn('[state] Failed to parse state file, starting fresh.');
    return {
      repliedTweetIds: [],
      engagedTweetIds: [],
      gmTweetIds: [],
      lastEngagementAt: 0,
      lastGmAt: 0,
      engagementDay: '',
      engagementCount: 0,
      gmDay: '',
      gmCount: 0,
    };
  }
}

function saveState(state) {
  const trimmed = {
    repliedTweetIds: state.repliedTweetIds.slice(-500),
    engagedTweetIds: state.engagedTweetIds.slice(-500),
    gmTweetIds: (state.gmTweetIds || []).slice(-500),
    lastEngagementAt: state.lastEngagementAt || 0,
    lastGmAt: state.lastGmAt || 0,
    engagementDay: state.engagementDay || '',
    engagementCount: state.engagementCount || 0,
    gmDay: state.gmDay || '',
    gmCount: state.gmCount || 0,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(trimmed, null, 2));
}

const getDayKey = () => new Date().toISOString().slice(0, 10);

const getNextDailyResetMs = () => {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5, 0, 0));
  return next.getTime();
};

const ensureDailyCounts = (state) => {
  const today = getDayKey();
  if (state.engagementDay !== today) {
    state.engagementDay = today;
    state.engagementCount = 0;
  }
  if (state.gmDay !== today) {
    state.gmDay = today;
    state.gmCount = 0;
  }
};

// OAuth disabled: scraper-only mode.

function loadCookieOverrides() {
  if (!CONFIG.useCookieOverrides) {
    return {};
  }
  if (!fs.existsSync(COOKIES_FILE)) {
    return {};
  }

  try {
    const raw = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
    const entries = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.cookies)
        ? raw.cookies
        : [];

    if (!Array.isArray(entries)) {
      return {};
    }

    const findValue = (...names) => {
      for (const name of names) {
        const cookie = entries.find(
          (entry) => entry?.name?.toLowerCase?.() === name.toLowerCase(),
        );
        if (cookie?.value) {
          return String(cookie.value).trim();
        }
      }
      return undefined;
    };

    const overrides = {
      authToken: findValue('auth_token'),
      ct0: findValue('ct0', 'csrf_token'),
      twid: findValue('twid'),
      guestId: findValue('guest_id'),
      guestToken: findValue('gt', 'guest_token'),
    };

    if (Object.values(overrides).some(Boolean)) {
      console.log(`[auth] Loaded cookies from ${COOKIES_FILE}`);
    }

    return overrides;
  } catch (error) {
    console.warn(`[auth] Failed to parse ${COOKIES_FILE}:`, error.message);
    return {};
  }
}

function normalizeHost(host) {
  if (!host) return 'twitter.com';
  return host.replace(/^\./, '').toLowerCase();
}

function rewriteHostname(originalHostname, targetHost) {
  const suffix = 'twitter.com';
  if (originalHostname === suffix) return targetHost;
  if (originalHostname.endsWith(`.${suffix}`)) {
    const prefix = originalHostname.slice(0, -suffix.length - 1);
    return `${prefix}.${targetHost}`;
  }
  return originalHostname;
}

function rewriteApiUrl(url, targetHost) {
  const normalized = normalizeHost(targetHost);
  if (normalized !== 'x.com') return null;
  if (url.hostname === 'api.twitter.com' || url.hostname === 'api.x.com') {
    const apiUrl = new URL(url.toString());
    apiUrl.hostname = 'api.x.com';
    return apiUrl.toString();
  }
  return null;
}

function buildCookieStrings(
  { authToken, ct0, twid, guestId, guestToken },
  domains = ['.twitter.com'],
) {
  const cookies = [];
  const base = (key, value, domain, httpOnly = false) => {
    const flags = [httpOnly ? 'HttpOnly' : null, 'Secure', 'SameSite=None']
      .filter(Boolean)
      .join('; ');
    return `${key}=${value}; Domain=${domain}; Path=/; ${flags}`;
  };

  domains.forEach((domain) => {
    if (authToken) cookies.push(base('auth_token', authToken, domain, true));
    if (ct0) cookies.push(base('ct0', ct0, domain));
    if (twid) cookies.push(base('twid', twid, domain));
    if (guestToken) cookies.push(base('gt', guestToken, domain));
    if (guestId) cookies.push(base('guest_id', guestId, domain));
  });

  return cookies;
}

function buildScraperOptions() {
  const host = normalizeHost(CONFIG.twitterHost);
  if (host === 'twitter.com') {
    return undefined;
  }

  return {
    transform: {
      request: (input, init) => {
        try {
          const rawUrl =
            input instanceof URL
              ? input.toString()
              : typeof input === 'string'
                ? input
                : input?.url || input?.toString();
          if (!rawUrl) return [input, init];
          const url = new URL(rawUrl);
          const apiRewrite = rewriteApiUrl(url, host);
          if (apiRewrite) {
            return [apiRewrite, init];
          }
          const rewritten = rewriteHostname(url.hostname, host);
          if (rewritten !== url.hostname) {
            url.hostname = rewritten;
            return [url.toString(), init];
          }
          return [input, init];
        } catch (error) {
          return [input, init];
        }
      },
    },
  };
}

async function seedHostCookies(scraper, host, cookieStrings) {
  const normalizedHost = normalizeHost(host);
  if (normalizedHost === 'twitter.com' || cookieStrings.length === 0) return;
  const jar =
    scraper?.auth?.cookieJar?.() ||
    scraper?.authTrends?.cookieJar?.();
  if (!jar) return;
  for (const cookie of cookieStrings) {
    await jar.setCookie(cookie, `https://${normalizedHost}`);
  }
}

async function initScraper() {
  if (!CONFIG.useLegacyScraper) {
    try {
      console.log('[oracle] Initializing TLS-resistant TwitterClientV2...');
      const { TwitterClientV2 } = await import('./twitter_client_v2.mjs');
      const scraper = new TwitterClientV2();

      if (await scraper.isLoggedIn()) {
        console.log('[oracle] TwitterClientV2 ready.');
      } else {
        console.warn('[oracle] TwitterClientV2 initialized but might lack valid cookies.');
      }
      return scraper;
    } catch (err) {
      console.warn('[oracle] Failed to load TwitterClientV2, falling back to legacy scraper:', err);
    }
  } else {
    console.log('[oracle] Using legacy scraper (USE_LEGACY_SCRAPER=true).');
  }

  const scraper = new Scraper(buildScraperOptions());
  const overrides = loadCookieOverrides();
  const authToken = overrides.authToken || getEnv('TWITTER_AUTH_TOKEN');
  const ct0 = overrides.ct0 || getEnv('TWITTER_CT0');
  const twid = overrides.twid || getEnv('TWITTER_TWID');
  const guestId = overrides.guestId || getEnv('TWITTER_GUEST_ID');
  const guestToken =
    overrides.guestToken ||
    getEnv('TWITTER_GUEST_TOKEN') ||
    getEnv('TWITTER_GUEST_ID') ||
    getEnv('GT') ||
    getEnv('gt');

  const normalizedHost = normalizeHost(CONFIG.twitterHost);
  const cookieDomains = Array.from(new Set([`.${normalizedHost}`])).filter(Boolean);

  const cookies = buildCookieStrings({ authToken, ct0, twid, guestId, guestToken }, cookieDomains);
  if (cookies.length > 0) {
    await scraper.setCookies(cookies);
  }

  if (normalizedHost !== 'twitter.com' && cookies.length > 0) {
    const hostCookies = cookies.map((cookie) =>
      cookie.replace(/Domain=\.twitter\.com/gi, `Domain=.${normalizedHost}`),
    );
    await seedHostCookies(scraper, normalizedHost, hostCookies);
  }

  let loggedIn = false;
  try {
    loggedIn = await scraper.isLoggedIn();
  } catch (error) {
    console.warn('[auth] Cookie login check failed, retrying auth flow.');
  }

  if (loggedIn) {
    return scraper;
  }

  if (!CONFIG.allowPasswordLogin) {
    throw new Error('Scraper login failed. Cookies invalid and password login disabled.');
  }

  const username = getEnv('TWITTER_USERNAME', getEnv('TWITTER_USER_NAME'));
  const password = getEnv('TWITTER_PASSWORD');
  const email = getEnv('TWITTER_EMAIL');

  if (!username || !password) {
    throw new Error('Missing TWITTER_USERNAME/TWITTER_PASSWORD for password login.');
  }

  await scraper.login(username, password, email || undefined);
  if (!(await scraper.isLoggedIn())) {
    throw new Error('Password login failed.');
  }

  return scraper;
}

function extractWallet(text) {
  if (!text) return null;
  const matches = text.match(WALLET_REGEX);
  return matches?.[0] || null;
}

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWalletStats(wallet) {
  const baseCandidates = [
    CONFIG.statsApiBase,
    'https://identityprism.xyz/api/actions/stats',
    'https://identityprism.xyz/api/actions/share',
    'https://188.137.250.160/api/actions/stats',
    'https://188.137.250.160/api/actions/share',
    'http://188.137.250.160/api/actions/stats',
    'http://188.137.250.160/api/actions/share',
  ];

  const seen = new Set();
  for (const base of baseCandidates) {
    if (!base) continue;
    const normalized = base.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    const url = `${normalized}?address=${wallet}`;
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`Stats API error ${response.status}`);
      }
      const data = await response.json();
      if (data?.error) {
        throw new Error(`Stats API error: ${data.error}`);
      }

      const parsed = parseWalletStatsPayload(data);
      if (!parsed) {
        throw new Error('Stats payload missing required fields');
      }
      return parsed;
    } catch (error) {
      console.warn(`[stats] Stats API failed (${normalized}):`, error.message || error);
    }
  }

  console.warn('[stats] Falling back to placeholder stats.');
  return {
    score: 'unknown',
    tier: 'unknown',
    txCount: 'unknown',
  };
}

function sanitizeText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function parseActionDescription(description) {
  if (!description) return null;
  const tierMatch = description.match(/Tier:\s*([A-Z_]+)/i);
  const scoreMatch = description.match(/Score\s*([0-9]+)/i);
  const txMatch = description.match(/([0-9]+)\s*tx/i);
  if (!tierMatch || !scoreMatch || !txMatch) return null;
  return {
    tier: String(tierMatch[1]).toLowerCase(),
    score: Number(scoreMatch[1]),
    txCount: Number(txMatch[1]),
  };
}

function parseWalletStatsPayload(data) {
  if (!data) return null;
  const stats = data.stats || data;
  const score = stats?.score ?? data?.identity?.score;
  const tier = stats?.tier ?? data?.identity?.tier;
  const txCount = stats?.txCount ?? data?.stats?.txCount;
  if (score != null && tier != null && txCount != null) {
    return { score, tier, txCount };
  }
  const parsedFromAction = parseActionDescription(data?.description);
  if (parsedFromAction) return parsedFromAction;
  return null;
}

function clampText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

const BOT_MENTION_VARIANTS = Array.from(
  new Set([
    CONFIG.botUsername,
    CONFIG.botUsername.replace(/_/g, ''),
    CONFIG.botUsername.replace(/-/g, ''),
  ]),
).filter(Boolean);

const normalizeHandle = (value) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const BOT_HANDLE_NORMALIZED = normalizeHandle(CONFIG.botUsername);
const isSelfHandle = (handle) => normalizeHandle(handle) === BOT_HANDLE_NORMALIZED;

const isMentioned = (text) => {
  const lower = (text || '').toLowerCase();
  return BOT_MENTION_VARIANTS.some((variant) => lower.includes(`@${variant.toLowerCase()}`));
};

const isGmTweet = (text) => /(^|\s)gm([!?.:,]|\s|$)/i.test(text || '');

const getTweetLikeCount = (tweet) => {
  const raw = tweet?.raw;
  const legacy = raw?.legacy || raw;
  const likes = legacy?.favorite_count ?? legacy?.favoriteCount ?? raw?.favorite_count ?? raw?.favoriteCount;
  const parsed = Number(likes);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pickRandom = (items) => {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
};

const sampleItems = (items, count) => {
  if (!items || items.length === 0 || count <= 0) return [];
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
};

const normalizeHashtag = (tag) => {
  if (!tag) return '';
  return tag.startsWith('#') ? tag : `#${tag}`;
};

const normalizeTicker = (ticker) => {
  if (!ticker) return '';
  const normalized = ticker.startsWith('$') ? ticker : `$${ticker}`;
  return normalized.toUpperCase();
};

const buildPostTokens = () => {
  const hashtags = sampleItems(CONFIG.postHashtags, CONFIG.postHashtagCount).map(normalizeHashtag);
  const tickers = sampleItems(CONFIG.postTickers, CONFIG.postTickerCount).map(normalizeTicker);
  const mentions = [];
  if (hashtags.length === 0 && CONFIG.postHashtags.length > 0) {
    const fallback = pickRandom(CONFIG.postHashtags);
    if (fallback) hashtags.push(normalizeHashtag(fallback));
  }
  if (tickers.length === 0 && CONFIG.postTickers.length > 0) {
    const fallback = pickRandom(CONFIG.postTickers);
    if (fallback) tickers.push(normalizeTicker(fallback));
  }

  const roll = Math.random();
  if (roll < CONFIG.solanaMobileMentionRate && CONFIG.solanaMobileHandles.length > 0) {
    const handle = pickRandom(CONFIG.solanaMobileHandles);
    if (handle) mentions.push(`@${handle.replace(/^@/, '')}`);
  } else if (
    roll < CONFIG.solanaMobileMentionRate + CONFIG.solanaMentionRate &&
    CONFIG.solanaHandles.length > 0
  ) {
    const handle = pickRandom(CONFIG.solanaHandles);
    if (handle) mentions.push(`@${handle.replace(/^@/, '')}`);
  }
  return [...mentions, ...tickers, ...hashtags].filter(Boolean);
};

const buildThreadTokens = () => {
  const hashtags = sampleItems(CONFIG.postHashtags, CONFIG.postHashtagCount).map(normalizeHashtag);
  const tickers = sampleItems(CONFIG.postTickers, CONFIG.postTickerCount).map(normalizeTicker);
  return [...tickers, ...hashtags].filter(Boolean);
};

const joinParts = (parts) =>
  parts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const composeTweet = (baseText, { tokens = [], link = '' } = {}) => {
  const initial = joinParts([baseText, ...tokens, link]);
  if (initial.length <= 280) return initial;

  const trimmedTokens = [...tokens];
  let candidate = joinParts([baseText, ...trimmedTokens, link]);
  while (trimmedTokens.length > 0 && candidate.length > 280) {
    trimmedTokens.pop();
    candidate = joinParts([baseText, ...trimmedTokens, link]);
  }
  if (candidate.length <= 280) return candidate;

  const suffix = joinParts([...trimmedTokens, link]);
  const maxBase = 280 - (suffix.length ? suffix.length + 1 : 0);
  return joinParts([clampText(baseText, Math.max(0, maxBase)), ...trimmedTokens, link]);
};

const generateGeminiText = async (prompt, label, maxLength, attempts = 2) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await textModel.generateContent(prompt);
      const response = await result.response;
      const text = clampText(sanitizeText(response.text()), maxLength);
      if (/[а-яё]/i.test(text)) {
        console.warn(`[oracle] Gemini ${label} produced non-English text, retrying.`);
        continue;
      }
      if (text) return text;
    } catch (error) {
      console.warn(`[oracle] Gemini ${label} generation failed:`, error?.message || error);
    }
  }
  return null;
};

const generateOraclePostText = async (topic) => {
  const prompt = `You are the Identity Prism Oracle. Write either a single tweet or a short thread of 2-3 tweets in English about: ${topic}. Separate tweets with "///". Each tweet <=200 chars and has 1-2 emojis. You MUST include both $SOL and #Solana in the overall output (not necessarily every tweet). Other hashtags/mentions are optional and should be used only if relevant for reach. Do NOT include links.`;
  return generateGeminiText(prompt, 'post', 600);
};

const generateThreadFollowupText = async () => {
  const prompt = `You are the Identity Prism Oracle. Write one short follow-up line in English for a thread (<=200 chars) about Identity Prism or Solana identity. Add 1 emoji. Ensure either $SOL or #Solana appears if it wasn't already in the thread. Other hashtags/mentions are optional and only if relevant. Do NOT include links.`;
  return generateGeminiText(prompt, 'thread', 200);
};

const generateEngagementReplyText = async (tweetText) => {
  const prompt = `You are the Identity Prism Oracle. Write a concise supportive reply in English (<=160 chars) to this tweet. Keep it positive and relevant to Solana ecosystem. Avoid hashtags, tickers, and links. Tweet: "${tweetText}"`;
  return generateGeminiText(prompt, 'engagement reply', 160);
};

const generateGmReplyText = async (tweetText) => {
  const prompt = `You are the Identity Prism Oracle. Write a short original GM reply in English (<=160 chars) to this tweet. Keep it friendly, Solana ecosystem vibe, and include "gm" or "GM". Avoid hashtags, tickers, and links. 1-2 emojis max. Tweet: "${tweetText}"`;
  return generateGeminiText(prompt, 'gm reply', 160);
};

const generateNoWalletReplyText = async (tweetText) => {
  const prompt = `You are the Identity Prism Oracle. Someone tagged you without a wallet. If they asked a question, answer it briefly first. Then invite them to drop a Solana wallet to check their Identity Prism stats. Keep it friendly and concise (<=180 chars). No hashtags or tickers. Tweet: "${tweetText}"`;
  return generateGeminiText(prompt, 'mention no-wallet', 180);
};

async function generateRoast(stats) {
  const prompt = `You are a sharp crypto oracle. Here are the wallet stats: ${JSON.stringify(
    stats
  )}. Write a short witty roast in English (<=200 chars). Avoid hashtags and links.`;
  return generateGeminiText(prompt, 'roast', 200);
}

async function sendReply(scraper, tweetId, replyText, label = 'Reply') {
  if (!replyText) return null;
  if (Date.now() < mentionsCooldownUntil || Date.now() < engagementCooldownUntil) {
    console.warn(`[mentions] ${label} skipped; cooldown active.`);
    return null;
  }
  if (CONFIG.dryRun) {
    console.log(`[dry-run] ${label}:`, replyText);
    return null;
  }

  const poster = getPuppeteerPoster();
  if (poster) {
    try {
      const result = await poster.postTweet(replyText, [], tweetId);
      if (result?.id) {
        console.log(`[mentions] ${label} posted via Puppeteer (${result.id}).`);
        return result.id;
      }
    } catch (error) {
      console.warn(`[mentions] ${label} Puppeteer failed:`, error?.message || error);
    }
  }

  try {
    const result = await scraper.sendTweet(replyText, tweetId);
    if (result?.id) {
      console.log(`[mentions] ${label} posted with id ${result.id}.`);
    }
    return result?.id || null;
  } catch (error) {
    if (isDailyLimitError(error)) {
      const cooldownUntil = Date.now() + CONFIG.replyCooldownMs;
      mentionsCooldownUntil = Math.max(mentionsCooldownUntil, cooldownUntil);
      engagementCooldownUntil = Math.max(engagementCooldownUntil, cooldownUntil);
      console.warn('[mentions] Daily limit hit; backing off replies.');
    } else if (isAutomationError(error)) {
      const cooldownUntil = Date.now() + 30 * 60 * 1000;
      mentionsCooldownUntil = Math.max(mentionsCooldownUntil, cooldownUntil);
      engagementCooldownUntil = Math.max(engagementCooldownUntil, cooldownUntil);
      console.warn('[mentions] Automation warning hit; backing off for 30 minutes.');
    }
    console.warn(`[mentions] ${label} failed via scraper:`, error?.message || error);
  }

  if (typeof scraper.sendTweetLegacy === 'function') {
    try {
      const legacyResult = await scraper.sendTweetLegacy(replyText, tweetId);
      if (legacyResult?.id) {
        console.log(`[mentions] ${label} posted via legacy endpoint (${legacyResult.id}).`);
        return legacyResult.id;
      }
    } catch (legacyError) {
      console.warn(`[mentions] ${label} legacy fallback failed:`, legacyError?.message || legacyError);
    }
  }
  return null;
}

async function replyToMention(scraper, tweet, wallet, stats) {
  const username = tweet.username ? `@${tweet.username}` : '';
  const roast = await generateRoast(stats);
  if (!roast) {
    console.warn('[mentions] Gemini roast failed, skipping reply.');
    return null;
  }
  const baseReply = `${username} ${roast}`.trim();
  const blinkUrl = `${CONFIG.blinkBaseUrl}${wallet}`;
  const replyText = composeTweet(baseReply, { link: blinkUrl });
  return sendReply(scraper, tweet.id, replyText, 'Reply');
}

async function replyToMentionNoWallet(scraper, tweet) {
  const username = tweet.username ? `@${tweet.username}` : '';
  const promptText = await generateNoWalletReplyText(tweet.text || '');
  if (!promptText) {
    console.warn('[mentions] Gemini no-wallet reply failed, skipping.');
    return null;
  }
  const baseReply = `${username} ${promptText}`.trim();
  const replyText = composeTweet(baseReply, { link: CONFIG.siteUrl });
  return sendReply(scraper, tweet.id, replyText, 'No-wallet reply');
}

async function postThreadFollowups(scraper, rootTweetId) {
  if (!CONFIG.threadEnabled || CONFIG.threadMaxReplies <= 0) return;
  let parentId = rootTweetId;
  for (let i = 0; i < CONFIG.threadMaxReplies; i += 1) {
    const followupText = await generateThreadFollowupText();
    if (!followupText) {
      console.warn('[thread] Gemini follow-up failed, stopping thread.');
      return;
    }
    const replyText = composeTweet(followupText);
    const replyId = await sendReply(scraper, parentId, replyText, 'Thread reply');
    if (!replyId) {
      console.warn('[thread] Failed to post thread reply, stopping thread.');
      return;
    }
    parentId = replyId;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function runEngagement(scraper) {
  if (!CONFIG.engagementEnabled) return;
  const now = Date.now();
  if (engagementInFlight) {
    if (
      engagementInFlightAt &&
      now - engagementInFlightAt > CONFIG.engagementStuckResetMs
    ) {
      console.warn('[engagement] Previous run stuck; resetting lock.');
      engagementInFlight = false;
    } else {
      console.log('[engagement] Skipping cycle; previous run still in progress.');
      return;
    }
  }
  if (now < engagementCooldownUntil) {
    console.log('[engagement] Skipping cycle; cooldown active.');
    return;
  }
  engagementInFlight = true;
  engagementInFlightAt = now;
  const state = loadState();
  try {
    ensureDailyCounts(state);
    if (now - state.lastEngagementAt < CONFIG.engagementIntervalMs) return;
    const remainingDaily = Math.max(0, CONFIG.engagementDailyLimit - state.engagementCount);
    if (remainingDaily <= 0) {
      console.log('[engagement] Daily limit reached; skipping.');
      return;
    }
    const maxThisCycle = Math.min(CONFIG.engagementMaxPerCycle, remainingDaily);
    state.lastEngagementAt = now;

    const cutoff = now - CONFIG.engagementLookbackMs;
    let engaged = 0;
    const seenTweets = new Set();

    const buildQuery = (raw) => {
      if (!raw) return '';
      const base = raw.includes('-filter:retweets') ? raw : `${raw} -filter:retweets -filter:replies`;
      if (CONFIG.engagementSearchLanguage) {
        return `${base} lang:${CONFIG.engagementSearchLanguage}`;
      }
      return base;
    };

    const processTweets = async (tweets) => {
      for (const tweet of tweets || []) {
        if (engaged >= maxThisCycle) break;
        if (Date.now() < engagementCooldownUntil) break;
        if (!tweet?.id || !tweet?.text) continue;
        const tweetId = String(tweet.id);
        if (seenTweets.has(tweetId)) continue;
        seenTweets.add(tweetId);
        if (isSelfHandle(tweet.username)) continue;
        if (state.engagedTweetIds.includes(tweetId)) continue;
        if (tweet.timestamp && tweet.timestamp < cutoff) continue;

        const replyText = await generateEngagementReplyText(tweet.text);
        if (!replyText) {
          console.warn('[engagement] Gemini reply failed, skipping.');
          continue;
        }
        const finalReply = composeTweet(replyText);
        const replyId = await sendReply(scraper, tweetId, finalReply, 'Engagement reply');
        if (replyId) {
          state.engagedTweetIds.push(tweetId);
          state.engagementCount += 1;
          saveState(state);
          engaged += 1;
        }
      }
    };

    let rateLimitedHit = false;
    const fetchQueryTweets = async (query) => {
      if (!query) return [];
      try {
        const response = await withTimeout(
          scraper.fetchSearchTweets(query, CONFIG.engagementSearchBatchSize, SearchMode.Latest),
          CONFIG.engagementTimeoutMs,
          'engagement search',
        );
        return response?.tweets || [];
      } catch (error) {
        if (isRateLimitError(error)) {
          engagementCooldownUntil = Date.now() + CONFIG.engagementRateLimitCooldownMs;
          rateLimitedHit = true;
          console.warn('[engagement] Rate limited; backing off.');
        } else if (isNotFoundError(error)) {
          engagementCooldownUntil = Date.now() + CONFIG.engagementRateLimitCooldownMs;
          rateLimitedHit = true;
          console.warn('[engagement] Search endpoint unavailable; backing off.');
        }
        console.warn('[engagement] Search failed:', error.message || error);
        return [];
      }
    };

    for (const account of CONFIG.engagementAccounts) {
      if (engaged >= maxThisCycle) break;
      const handle = account.replace(/^@/, '');
      if (!handle) continue;
      const query = buildQuery(`from:${handle}`);
      const tweets = await fetchQueryTweets(query);
      await processTweets(tweets);
      if (rateLimitedHit) break;
    }

    let searchQueries = CONFIG.engagementSearchQueries;
    if (
      CONFIG.engagementSearchQueryLimit > 0 &&
      searchQueries.length > CONFIG.engagementSearchQueryLimit
    ) {
      searchQueries = sampleItems(searchQueries, CONFIG.engagementSearchQueryLimit);
    }
    for (const rawQuery of searchQueries) {
      if (engaged >= maxThisCycle) break;
      const query = buildQuery(rawQuery);
      const tweets = await fetchQueryTweets(query);
      await processTweets(tweets);
    }
  } finally {
    saveState(state);
    engagementInFlight = false;
    engagementInFlightAt = 0;
  }
}

async function runGmOutreach(scraper) {
  if (!CONFIG.gmEnabled) return;
  const now = Date.now();
  if (gmInFlight) {
    if (gmInFlightAt && now - gmInFlightAt > CONFIG.gmStuckResetMs) {
      console.warn('[gm] Previous run stuck; resetting lock.');
      gmInFlight = false;
    } else {
      console.log('[gm] Skipping cycle; previous run still in progress.');
      return;
    }
  }
  if (now < engagementCooldownUntil) {
    console.log('[gm] Skipping cycle; cooldown active.');
    return;
  }
  gmInFlight = true;
  gmInFlightAt = now;
  const state = loadState();
  try {
    ensureDailyCounts(state);
    if (now - state.lastGmAt < CONFIG.gmIntervalMs) return;
    const remainingDaily = Math.max(0, CONFIG.gmDailyLimit - state.gmCount);
    if (remainingDaily <= 0) {
      console.log('[gm] Daily limit reached; skipping.');
      return;
    }
    const maxThisCycle = Math.min(CONFIG.gmMaxPerCycle, remainingDaily);
    state.lastGmAt = now;

    const cutoff = now - CONFIG.gmLookbackMs;
    let sent = 0;
    const seenTweets = new Set();

    const buildQuery = (raw) => {
      if (!raw) return '';
      const base = raw.includes('-filter:retweets') ? raw : `${raw} -filter:retweets -filter:replies`;
      if (CONFIG.gmSearchLanguage) {
        return `${base} lang:${CONFIG.gmSearchLanguage}`;
      }
      return base;
    };

    const processTweets = async (tweets) => {
      for (const tweet of tweets || []) {
        if (sent >= maxThisCycle) break;
        if (Date.now() < engagementCooldownUntil) break;
        if (!tweet?.id || !tweet?.text) continue;
        const tweetId = String(tweet.id);
        if (seenTweets.has(tweetId)) continue;
        seenTweets.add(tweetId);
        if (isSelfHandle(tweet.username)) continue;
        if (state.gmTweetIds.includes(tweetId)) continue;
        if (state.engagedTweetIds.includes(tweetId)) continue;
        if (tweet.timestamp && tweet.timestamp < cutoff) continue;
        if (!isGmTweet(tweet.text)) continue;
        if (CONFIG.gmMinLikes > 0 && getTweetLikeCount(tweet) < CONFIG.gmMinLikes) continue;

        const replyText = await generateGmReplyText(tweet.text);
        if (!replyText) {
          console.warn('[gm] Gemini reply failed, skipping.');
          continue;
        }
        const finalReply = composeTweet(replyText);
        const replyId = await sendReply(scraper, tweetId, finalReply, 'GM reply');
        if (replyId) {
          state.gmTweetIds.push(tweetId);
          state.gmCount += 1;
          saveState(state);
          sent += 1;
        }
      }
    };

    let rateLimitedHit = false;
    const fetchQueryTweets = async (query) => {
      if (!query) return [];
      try {
        const response = await withTimeout(
          scraper.fetchSearchTweets(query, CONFIG.gmSearchBatchSize, SearchMode.Latest),
          CONFIG.gmTimeoutMs,
          'gm search',
        );
        return response?.tweets || [];
      } catch (error) {
        if (isRateLimitError(error)) {
          engagementCooldownUntil = Date.now() + CONFIG.gmRateLimitCooldownMs;
          rateLimitedHit = true;
          console.warn('[gm] Rate limited; backing off.');
        } else if (isNotFoundError(error)) {
          engagementCooldownUntil = Date.now() + CONFIG.gmRateLimitCooldownMs;
          rateLimitedHit = true;
          console.warn('[gm] Search endpoint unavailable; backing off.');
        }
        console.warn('[gm] Search failed:', error.message || error);
        return [];
      }
    };

    let searchQueries = CONFIG.gmSearchQueries;
    if (CONFIG.gmSearchQueryLimit > 0 && searchQueries.length > CONFIG.gmSearchQueryLimit) {
      searchQueries = sampleItems(searchQueries, CONFIG.gmSearchQueryLimit);
    }
    for (const rawQuery of searchQueries) {
      if (sent >= maxThisCycle) break;
      const query = buildQuery(rawQuery);
      const tweets = await fetchQueryTweets(query);
      await processTweets(tweets);
      if (rateLimitedHit) break;
    }
  } finally {
    saveState(state);
    gmInFlight = false;
    gmInFlightAt = 0;
  }
}

async function handleMentions(scraper) {
  const now = Date.now();
  if (mentionsInFlight) {
    if (mentionsInFlightAt && now - mentionsInFlightAt > CONFIG.mentionStuckResetMs) {
      console.warn('[mentions] Previous run stuck; resetting lock.');
      mentionsInFlight = false;
    } else {
      console.log('[mentions] Skipping cycle; previous run still in progress.');
      return;
    }
  }
  if (now < mentionsCooldownUntil) {
    console.log('[mentions] Skipping cycle; cooldown active.');
    return;
  }
  mentionsInFlight = true;
  mentionsInFlightAt = now;
  const state = loadState();
  try {
    console.log(`[mentions] repliesPerCycle=${CONFIG.repliesPerCycle}`);
    let response;
    let tweets = [];
    let fallbackRateLimited = false;
    let fallbackAttempted = false;
    if (CONFIG.mentionFallbackEnabled && typeof scraper.fetchMentions === 'function') {
      fallbackAttempted = true;
      try {
        const mentionsResponse = await withTimeout(
          scraper.fetchMentions(CONFIG.mentionBatchSize),
          CONFIG.mentionTimeoutMs,
          'mention fallback',
        );
        tweets = (mentionsResponse?.tweets || []).filter((tweet) => tweet?.id);
        console.log(`[mentions] Fallback fetched ${tweets.length} tweets.`);
      } catch (error) {
        if (isRateLimitError(error)) {
          mentionsCooldownUntil = Date.now() + CONFIG.mentionRateLimitCooldownMs;
          fallbackRateLimited = true;
          console.warn('[mentions] Rate limited on fallback; backing off.');
        }
        console.warn('[mentions] Mentions fallback failed:', error.message || error);
      }
    }
    if (fallbackRateLimited) {
      return;
    }
    if (!CONFIG.mentionSearchEnabled) {
      if (tweets.length === 0) {
        console.log('[mentions] Search disabled; no mentions found via fallback.');
        return;
      }
    }
    try {
      if (tweets.length === 0) {
        response = await withTimeout(
          scraper.fetchSearchTweets(CONFIG.mentionQuery, CONFIG.mentionBatchSize, SearchMode.Latest),
          CONFIG.mentionTimeoutMs,
          'mention search',
        );
      }
    } catch (error) {
      if (isRateLimitError(error)) {
        mentionsCooldownUntil = Date.now() + CONFIG.mentionRateLimitCooldownMs;
        console.warn('[mentions] Rate limited; backing off.');
      } else if (isNotFoundError(error)) {
        mentionsCooldownUntil = Date.now() + CONFIG.mentionRateLimitCooldownMs;
        console.warn('[mentions] Search endpoint unavailable; backing off.');
      }
      if (CONFIG.mentionFallbackEnabled) {
        console.warn('[mentions] SearchTimeline failed, trying mentions fallback:', error.message || error);
      } else {
        console.warn('[mentions] SearchTimeline failed:', error.message || error);
      }
    }

    if (tweets.length === 0) {
      tweets = (response?.tweets || []).filter((tweet) => tweet?.id);
    }
    if (
      tweets.length === 0 &&
      CONFIG.mentionFallbackEnabled &&
      typeof scraper.fetchMentions === 'function' &&
      !fallbackAttempted
    ) {
      try {
        const mentionsResponse = await withTimeout(
          scraper.fetchMentions(CONFIG.mentionBatchSize),
          CONFIG.mentionTimeoutMs,
          'mention fallback',
        );
        tweets = (mentionsResponse?.tweets || []).filter((tweet) => tweet?.id);
        console.log(`[mentions] Fallback fetched ${tweets.length} tweets.`);
      } catch (error) {
        if (isRateLimitError(error)) {
          mentionsCooldownUntil = Date.now() + CONFIG.mentionRateLimitCooldownMs;
          console.warn('[mentions] Rate limited; backing off.');
        }
        console.warn('[mentions] Mentions fallback failed:', error.message || error);
      }
    }

    if (tweets.length > 0) {
      console.log(`[mentions] Retrieved ${tweets.length} tweets before filtering.`);
    }

    if (tweets.length > 0) {
      if (!CONFIG.mentionQuery.includes('@')) {
        tweets = tweets.filter((tweet) => isMentioned(tweet.text));
        console.log(`[mentions] ${tweets.length} tweets after mention filter.`);
      } else {
        console.log('[mentions] Skipping mention text filter (query already targets @mentions).');
      }
      if (tweets.length > 0) {
        console.log(`[mentions] Sample tweet ${tweets[0].id}: ${tweets[0].text}`);
      }
    }

    const uniqueTweets = new Map();
    for (const tweet of tweets) {
      if (tweet?.id && !uniqueTweets.has(tweet.id)) {
        uniqueTweets.set(tweet.id, tweet);
      }
    }

    const orderedTweets = Array.from(uniqueTweets.values()).sort(
      (a, b) => (a.timestamp || 0) - (b.timestamp || 0),
    );

    let processed = 0;
    for (const tweet of orderedTweets) {
      console.log(`[mentions] Processing tweet ${tweet.id} from ${tweet.username || 'unknown'}.`);
      if (processed >= CONFIG.repliesPerCycle) break;
      if (!tweet.text || !tweet.id) continue;
      const tweetId = String(tweet.id);
      if (isSelfHandle(tweet.username)) {
        continue;
      }
      if (state.repliedTweetIds.includes(tweetId)) continue;

      const wallet = extractWallet(tweet.text);
      if (!wallet) {
        console.log(`[mentions] No wallet found in tweet ${tweetId}. Sending no-wallet reply.`);
        try {
          const replyId = await replyToMentionNoWallet(scraper, tweet);
          if (replyId) {
            state.repliedTweetIds.push(tweetId);
            saveState(state);
            processed += 1;
          }
        } catch (error) {
          console.warn('[mentions] Failed to reply (no-wallet):', error.message || error);
        }
        continue;
      }
      console.log(`[mentions] Extracted wallet ${wallet} from tweet ${tweetId}.`);

      try {
        console.log(`[mentions] Fetching stats for ${wallet}...`);
        const stats = await fetchWalletStats(wallet);
        const replyId = await replyToMention(scraper, tweet, wallet, stats);
        if (replyId) {
          console.log(`[mentions] Replied to tweet ${tweetId}.`);
          state.repliedTweetIds.push(tweetId);
          saveState(state);
          processed += 1;
        }
      } catch (error) {
        console.warn('[mentions] Failed to reply:', error.message || error);
      }
    }
  } finally {
    saveState(state);
    mentionsInFlight = false;
    mentionsInFlightAt = 0;
  }
}

const splitThreadParts = (text) => {
  if (!text) return [];
  const cleaned = text.replace(/^"|"$/g, '').trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/\n?\s*\/\/\/\s*\n?/)
    .map((part) => sanitizeText(part))
    .filter(Boolean);
  return parts.length ? parts : [cleaned];
};

async function generateOraclePost() {
  const topic = POST_TOPICS[Math.floor(Math.random() * POST_TOPICS.length)];
  if (!CONFIG.useGeminiText) {
    console.warn('[oracle] Gemini text disabled; skipping post generation.');
    return null;
  }

  const baseText = await generateOraclePostText(topic);
  if (!baseText) return null;
  return splitThreadParts(baseText);
}

function loadFallbackImage() {
  const candidates = [
    getEnv('ORACLE_IMAGE_PATH'),
    path.resolve(__dirname, 'assets', 'identity-prism.png'),
    '/var/www/identityprism/assets/identity-prism.png',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        console.log(`[images] Using fallback image at ${candidate}.`);
        return fs.readFileSync(candidate);
      }
    } catch (error) {
      console.warn('[images] Failed to read fallback image:', error?.message || error);
    }
  }

  return null;
}

async function generateOracleImage() {
  if (!CONFIG.useGeminiImages) {
    return loadFallbackImage();
  }
  const prompt = 'Futuristic Solana oracle vibe, neon gradients, abstract crypto aura, dark background, no text.';
  for (const modelName of IMAGE_MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      const response = await result.response;
      const inlineData = response?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
      if (inlineData?.data) {
        return Buffer.from(inlineData.data, 'base64');
      }
      console.warn(`[images] Gemini ${modelName} returned no inline image data.`);
    } catch (error) {
      console.warn(
        `[images] Gemini image generation failed (${modelName}):`,
        error?.data || error?.message || error,
      );
    }
  }
  console.warn('[images] Gemini image generation failed for all models; skipping image.');
  return null;
}

async function postScheduledUpdate(scraper) {
  const parts = await generateOraclePost();
  if (!parts || parts.length === 0) {
    console.warn('[post] Gemini text unavailable; skipping scheduled update.');
    return;
  }
  if (Date.now() < postCooldownUntil) {
    console.log('[post] Skipping scheduled update; cooldown active.');
    return;
  }
  const finalText = parts[0];

  if (CONFIG.dryRun) {
    console.log('[dry-run] Post:', finalText);
    return;
  }

  let mediaData;
  let imageBuffer;
  if (CONFIG.enableImages) {
    try {
      imageBuffer = await generateOracleImage();
      if (imageBuffer) {
        mediaData = [{ data: imageBuffer, mediaType: 'image/png' }];
      }
    } catch (error) {
      console.warn('[images] Failed to generate image, posting text-only.');
    }
  }

  const rootText = composeTweet(finalText, { link: CONFIG.siteUrl });
  let tweetId = null;
  let verifiedUrl = null;
  const poster = getPuppeteerPoster();
  if (poster) {
    try {
      const result = await poster.postTweet(rootText, mediaData);
      tweetId = result?.id || null;
      verifiedUrl = result?.url || null;
    } catch (error) {
      console.warn('[post] Puppeteer post failed:', error?.message || error);
    }
  }

  if (tweetId) {
    if (verifiedUrl) {
      console.log(`[post] Scheduled update verified. ${verifiedUrl}`);
    } else {
      const fallbackUrls = [
        `https://x.com/i/web/status/${tweetId}`,
        `https://twitter.com/i/web/status/${tweetId}`,
        `https://x.com/${BOT_USERNAME}/status/${tweetId}`,
      ];
      console.log(
        `[post] Scheduled update posted, not yet verified. Check: ${fallbackUrls.join(' | ')}`,
      );
    }
    if (parts.length > 1) {
      let parentId = tweetId;
      for (const followup of parts.slice(1)) {
        const replyText = composeTweet(followup);
        const replyId = await sendReply(scraper, parentId, replyText, 'Thread reply');
        if (!replyId) break;
        parentId = replyId;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      return { rootId: tweetId, usedThread: true };
    }
    return { rootId: tweetId, usedThread: false };
  }

  try {
    const result = await scraper.sendTweet(rootText, undefined, mediaData);
    tweetId = result?.id || null;
  } catch (error) {
    if (handlePostLimitError(error)) {
      return { rootId: null, usedThread: false };
    }
    console.warn('[post] Scraper post failed:', error?.message || error);
  }

  if (!tweetId) {
    console.log('[post] Scheduled update failed (no id returned).');
    return { rootId: null, usedThread: false };
  }

  const verifyTweetUrl = async (id) => {
    if (typeof scraper.verifyTweet !== 'function') return null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const verification = await scraper.verifyTweet(id);
      if (verification?.ok) {
        const handle = verification.screenName || BOT_USERNAME;
        return `https://x.com/${handle}/status/${id}`;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return null;
  };

  verifiedUrl = await verifyTweetUrl(tweetId);
  if (!verifiedUrl && typeof scraper.sendTweetLegacy === 'function') {
    console.warn('[post] Scraper tweet not yet visible; retrying via legacy endpoint.');
    const legacyResult = await scraper.sendTweetLegacy(finalText, undefined, mediaData);
    if (legacyResult?.id) {
      tweetId = legacyResult.id;
      verifiedUrl = await verifyTweetUrl(tweetId);
    }
  }

  if (verifiedUrl) {
    console.log(`[post] Scheduled update verified. ${verifiedUrl}`);
  } else {
    const fallbackUrls = [
      `https://x.com/i/web/status/${tweetId}`,
      `https://twitter.com/i/web/status/${tweetId}`,
      `https://x.com/${BOT_USERNAME}/status/${tweetId}`,
    ];
    console.log(
      `[post] Scheduled update posted, not yet verified. Check: ${fallbackUrls.join(' | ')}`,
    );
  }

  if (parts.length > 1) {
    let parentId = tweetId;
    for (const followup of parts.slice(1)) {
      const replyText = composeTweet(followup);
      const replyId = await sendReply(scraper, parentId, replyText, 'Thread reply');
      if (!replyId) break;
      parentId = replyId;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return { rootId: tweetId, usedThread: true };
  }
  return { rootId: tweetId, usedThread: false };
}

async function start() {
  const runOnce = process.argv.includes('--once');
  const scraper = await initScraper();
  console.log('[oracle] Bot ready (scraper-only). Query:', CONFIG.mentionQuery);
  console.log(
    `[oracle] intervals: mentions=${CONFIG.mentionIntervalMs}ms, engagement=${CONFIG.engagementIntervalMs}ms`,
  );

  if (runOnce) {
    await handleMentions(scraper);
    await runEngagement(scraper);
    await runGmOutreach(scraper);
    const postResult = await postScheduledUpdate(scraper);
    if (postResult?.rootId && !postResult.usedThread) {
      await postThreadFollowups(scraper, postResult.rootId);
    }
    return;
  }

  await handleMentions(scraper);
  await runEngagement(scraper);
  await runGmOutreach(scraper);
  setInterval(() => {
    handleMentions(scraper).catch((error) =>
      console.warn('[mentions] cycle error:', error.message || error),
    );
  }, CONFIG.mentionIntervalMs);

  setInterval(() => {
    runEngagement(scraper).catch((error) =>
      console.warn('[engagement] cycle error:', error.message || error),
    );
  }, CONFIG.engagementIntervalMs);

  setInterval(() => {
    runGmOutreach(scraper).catch((error) =>
      console.warn('[gm] cycle error:', error.message || error),
    );
  }, CONFIG.gmIntervalMs);

  cron.schedule(CONFIG.postSchedule, () => {
    const delayMs = Math.floor(Math.random() * 10 * 60 * 1000);
    setTimeout(() => {
      postScheduledUpdate(scraper)
        .then((postResult) => {
          if (postResult?.rootId && !postResult.usedThread) {
            return postThreadFollowups(scraper, postResult.rootId);
          }
          return null;
        })
        .catch((error) => console.warn('[post] error:', error.message || error));
    }, delayMs);
  });

  process.stdin.resume();
}

start().catch((error) => {
  console.error('[oracle] Fatal error:', error.message || error);
  process.exit(1);
});
