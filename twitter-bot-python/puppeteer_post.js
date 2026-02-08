const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const COOKIES_PATH = process.env.COOKIES_PATH || path.resolve(__dirname, 'cookies.json');
const BOT_USERNAME = (process.env.BOT_USERNAME || 'IdentityPrism').replace(/^@/, '');
const POST_TEXT = process.env.POST_TEXT || 'gm from Identity Prism — warming up the new oracle 🤝';
const LOGIN_USER = process.env.LOGIN_USER || '';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || '';
const LOGIN_ONLY = String(process.env.LOGIN_ONLY || '').toLowerCase() === 'true';
const HEADFUL = String(process.env.HEADFUL || '').toLowerCase() === 'true';
const USER_DATA_DIR =
  process.env.PUPPETEER_USER_DATA_DIR || path.resolve(__dirname, 'puppeteer-profile');
const IMAGE_PATH = process.env.IMAGE_PATH || '';
const MEDIA_WAIT = Number(process.env.MEDIA_WAIT || 3000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT || 120000);
const RETRY_COUNT = Number(process.env.NAV_RETRY || 2);
const LOGIN_WAIT = Number(process.env.LOGIN_WAIT || 120000);

const normalizeSameSite = (value) => {
  if (!value) return undefined;
  const lower = String(value).toLowerCase();
  if (lower.includes('lax')) return 'Lax';
  if (lower.includes('strict')) return 'Strict';
  if (lower.includes('none') || lower.includes('no_restriction')) return 'None';
  return undefined;
};

const serializeCookies = (cookies) =>
  cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite || undefined,
    expirationDate: cookie.expires ? Math.floor(cookie.expires) : undefined,
  }));

const saveCookies = async (page) => {
  const cookies = await page.cookies('https://x.com');
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(serializeCookies(cookies), null, 2));
  console.log('[puppeteer] cookies updated:', COOKIES_PATH);
};

const loadCookies = () => {
  if (!fs.existsSync(COOKIES_PATH)) {
    throw new Error(`cookies.json not found at ${COOKIES_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error('cookies.json must be an array of cookie objects');
  }
  return raw.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    url: 'https://x.com',
    path: cookie.path || '/',
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    sameSite: normalizeSameSite(cookie.sameSite),
    expires: cookie.expirationDate ? Math.floor(cookie.expirationDate) : undefined,
  }));
};

const getLatestTweetUrl = async (page) => {
  const profileUrl = `https://x.com/${BOT_USERNAME}`;
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.waitForSelector('article', { timeout: 15000 }).catch(() => null);
  const href = await page.evaluate(() => {
    const anchor = document.querySelector('article a[href*="/status/"]');
    return anchor ? anchor.getAttribute('href') : null;
  });
  if (!href) return null;
  const match = href.match(/status\/(\d+)/);
  return match ? `https://x.com/${BOT_USERNAME}/status/${match[1]}` : null;
};

const gotoWithRetry = async (page, url) => {
  let lastError;
  for (let attempt = 0; attempt < RETRY_COUNT; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      return;
    } catch (error) {
      lastError = error;
      await sleep(1500);
    }
  }
  throw lastError || new Error(`Navigation failed for ${url}`);
};

const isLoggedIn = async (page) => {
  const selectors = ['[data-testid="SideNav_AccountSwitcher_Button"]', '[data-testid="AppTabBar_Profile_Link"]'];
  for (const selector of selectors) {
    const element = await page.$(selector);
    if (element) return true;
  }
  return false;
};

const performLogin = async (page) => {
  if (!LOGIN_USER || !LOGIN_PASSWORD) {
    throw new Error('LOGIN_USER or LOGIN_PASSWORD not provided');
  }
  const userSelector = 'input[name="text"], input[autocomplete="username"], input[type="text"]';
  await gotoWithRetry(page, 'https://x.com/i/flow/login');
  await page.waitForSelector('body', { timeout: NAV_TIMEOUT });
  await sleep(3000);
  const userInput = await page.waitForSelector(userSelector, { timeout: NAV_TIMEOUT });
  await userInput.click();
  await userInput.type(LOGIN_USER, { delay: 30 });
  await page.keyboard.press('Enter');
  await sleep(2000);
  const passwordInput = await page
    .waitForSelector('input[name="password"]', { timeout: 20000 })
    .catch(async () => {
      const altUser = await page.$('input[name="text"]');
      if (altUser) {
        await altUser.click();
        await altUser.type(LOGIN_USER, { delay: 30 });
        await page.keyboard.press('Enter');
        await sleep(2000);
      }
      return page.waitForSelector('input[name="password"]', { timeout: 20000 });
    });
  await passwordInput.click();
  await passwordInput.type(LOGIN_PASSWORD, { delay: 30 });
  await page.keyboard.press('Enter');
  const start = Date.now();
  while (Date.now() - start < LOGIN_WAIT) {
    await sleep(2000);
    if (await isLoggedIn(page)) {
      return;
    }
  }
  throw new Error('Login appears to have failed or requires additional verification.');
};

(async () => {
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    userDataDir: USER_DATA_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  page.setDefaultTimeout(NAV_TIMEOUT);
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  );
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  console.log('[puppeteer] loading cookies...');
  const cookies = loadCookies();
  await page.setCookie(...cookies);
  await gotoWithRetry(page, 'https://x.com/home');
  await sleep(2000);
  const loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    console.log('[puppeteer] login required, attempting login...');
    await performLogin(page);
  }
  await saveCookies(page);
  if (LOGIN_ONLY) {
    await browser.close();
    console.log('[puppeteer] login-only flow complete.');
    return;
  }
  console.log('[puppeteer] opening compose...');
  await gotoWithRetry(page, 'https://x.com/compose/tweet');
  await sleep(2000);
  if (IMAGE_PATH && fs.existsSync(IMAGE_PATH)) {
    const fileInput = await page.$('input[data-testid="fileInput"], input[type="file"]');
    if (!fileInput) {
      throw new Error('Media file input not found.');
    }
    await fileInput.uploadFile(IMAGE_PATH);
    await sleep(MEDIA_WAIT);
    await page
      .waitForSelector('div[data-testid="attachments"], div[data-testid="attachment"]', { timeout: NAV_TIMEOUT })
      .catch(() => null);
  }
  const textBox = await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: NAV_TIMEOUT });
  await textBox.click();
  await textBox.type(POST_TEXT, { delay: 20 });
  await sleep(1500);
  const buttons = ['[data-testid="tweetButtonInline"]', '[data-testid="tweetButton"]'];
  let clicked = false;
  for (const selector of buttons) {
    const button = await page.$(selector);
    if (!button) continue;
    const disabled = await page.evaluate((el) => el.getAttribute('aria-disabled'), button);
    if (disabled === 'true') continue;
    await button.click();
    clicked = true;
    break;
  }
  if (!clicked) {
    throw new Error('Tweet button not found or disabled');
  }
  await sleep(2500);
  const tweetUrl = await getLatestTweetUrl(page);
  console.log('[puppeteer] post attempted. Latest tweet:', tweetUrl || 'unknown');
  await browser.close();
})().catch(async (error) => {
  try {
    const screenshotPath = path.resolve(__dirname, 'puppeteer-failure.png');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    page.setDefaultTimeout(NAV_TIMEOUT);
    await page.goto('https://x.com/compose/tweet', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(
      () => null,
    );
    await page.screenshot({ path: screenshotPath }).catch(() => null);
    await browser.close();
    console.error('[puppeteer] failed:', error?.message || error, `Screenshot: ${screenshotPath}`);
  } catch (innerError) {
    console.error('[puppeteer] failed:', error?.message || error);
    console.error('[puppeteer] screenshot error:', innerError?.message || innerError);
  }
  process.exit(1);
});
