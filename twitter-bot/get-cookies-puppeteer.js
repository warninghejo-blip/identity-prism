const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { authenticator } = require('otplib');

const envCandidates = [
  path.resolve(__dirname, '.env.scraper'),
  path.resolve(__dirname, '..', '.env.scraper'),
  path.resolve(__dirname, '.env'),
];
const envPath = envCandidates.find((file) => fs.existsSync(file));
require('dotenv').config(envPath ? { path: envPath } : undefined);

const getEnv = (key, fallback = '') => (process.env[key] || fallback).trim();

const USERNAME = getEnv('TWITTER_USERNAME', getEnv('TWITTER_USER_NAME'));
const PASSWORD = getEnv('TWITTER_PASSWORD');
const EMAIL = getEnv('TWITTER_EMAIL');
const MFA_SECRET = getEnv('TWITTER_2FA_SECRET');
const CHALLENGE_VALUE = getEnv('TWITTER_CHALLENGE_VALUE', USERNAME || EMAIL);
const OUTPUT = path.resolve(__dirname, 'cookies.json');
const LOGIN_URLS = [
  'https://x.com/i/flow/login',
  'https://twitter.com/i/flow/login',
  'https://x.com/login',
  'https://twitter.com/login',
];

const USERNAME_SELECTORS = [
  'input[name="text"]',
  'input[data-testid="ocfEnterTextTextInput"]',
  'input[autocomplete="username"]',
  'input[name="session[username_or_email]"]',
  'input[name="username"]',
];

const PASSWORD_SELECTORS = [
  'input[name="password"]',
  'input[type="password"]',
  'input[name="session[password]"]',
];

const CHALLENGE_SELECTORS = [
  'input[data-testid="ocfEnterTextTextInput"]',
  'input[name="text"]',
  'input[name="challenge_response"]',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForAny(page, selectors, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const selector of selectors) {
      const handle = await page.$(selector);
      if (handle) {
        return { handle, selector };
      }
    }
    await sleep(200);
  }
  throw new Error(`waitForAny timeout. Tried selectors: ${selectors.join(', ')}`);
}

async function queryAny(page, selectors) {
  for (const selector of selectors) {
    const handle = await page.$(selector);
    if (handle) {
      return { handle, selector };
    }
  }
  return null;
}

async function waitFor(page, selector, timeout = 15000) {
  await page.waitForSelector(selector, { timeout });
  return page.$(selector);
}

async function typeInto(page, selector, text) {
  const el = await waitFor(page, selector);
  await el.click({ clickCount: 3 });
  await el.type(text, { delay: 30 });
}

async function submit(page) {
  await page.keyboard.press('Enter');
  await sleep(1200);
}

async function attemptLogin(page, loginUrl) {
  console.log(`[get-cookies-puppeteer] Trying ${loginUrl}`);
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.emulateTimezone('America/New_York');

  await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 90000 });

  const { selector: usernameSelector } = await waitForAny(page, USERNAME_SELECTORS);
  await typeInto(page, usernameSelector, USERNAME);

  const inlinePassword = await queryAny(page, PASSWORD_SELECTORS);
  if (inlinePassword?.selector) {
    await typeInto(page, inlinePassword.selector, PASSWORD);
    await submit(page);
  } else {
    await submit(page);

    await sleep(1500);
    const nextStep = await waitForAny(page, [...PASSWORD_SELECTORS, ...CHALLENGE_SELECTORS], 15000).catch(
      () => null,
    );

    let passwordSelector;
    if (nextStep?.selector && PASSWORD_SELECTORS.includes(nextStep.selector)) {
      passwordSelector = nextStep.selector;
    } else {
      const challengeInput =
        nextStep?.selector && CHALLENGE_SELECTORS.includes(nextStep.selector)
          ? nextStep
          : await waitForAny(page, CHALLENGE_SELECTORS, 10000).catch(() => null);
      if (challengeInput?.selector && CHALLENGE_VALUE) {
        await typeInto(page, challengeInput.selector, CHALLENGE_VALUE);
        await submit(page);
      }
      const passwordStep = await waitForAny(page, PASSWORD_SELECTORS, 15000);
      passwordSelector = passwordStep.selector;
    }

    await typeInto(page, passwordSelector, PASSWORD);
    await submit(page);
  }

  if (MFA_SECRET) {
    await sleep(1500);
    const mfaSelector = 'input[name="text"]';
    const mfaInput = await page.$(mfaSelector);
    if (mfaInput) {
      const token = authenticator.generate(MFA_SECRET);
      await typeInto(page, mfaSelector, token);
      await submit(page);
    }
  }

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await sleep(3000);

  const cookies = await page.cookies();
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error('No cookies captured after login.');
  }

  return cookies.map((cookie) => {
    const domain = cookie.domain?.replace(/^\./, '') || 'twitter.com';
    return { ...cookie, domain: `.${domain}` };
  });
}

async function login() {
  if (!USERNAME || !PASSWORD) {
    throw new Error('Missing TWITTER_USERNAME/TWITTER_PASSWORD in env.');
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (const loginUrl of LOGIN_URLS) {
      const page = await browser.newPage();
      try {
        const normalized = await attemptLogin(page, loginUrl);
        fs.writeFileSync(OUTPUT, JSON.stringify(normalized, null, 2));
        console.log(`[get-cookies-puppeteer] Saved ${normalized.length} cookies to ${OUTPUT}`);
        return;
      } catch (error) {
        console.warn(`[get-cookies-puppeteer] Attempt via ${loginUrl} failed: ${error.message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
    throw new Error('All login attempts failed.');
  } finally {
    await browser.close();
  }
}

login().catch((error) => {
  console.error('[get-cookies-puppeteer] Failed:', error.message || error);
  process.exit(1);
});
