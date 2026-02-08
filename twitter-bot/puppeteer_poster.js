const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildEnvCookies = (getEnv) => {
  const domains = ['.x.com', '.twitter.com'];
  const cookies = [];
  const pushCookie = (name, value, httpOnly = false) => {
    if (!value) return;
    domains.forEach((domain) => {
      cookies.push({
        name,
        value,
        domain,
        path: '/',
        httpOnly,
        secure: true,
        sameSite: 'None',
      });
    });
  };

  pushCookie('auth_token', getEnv('TWITTER_AUTH_TOKEN'), true);
  pushCookie('ct0', getEnv('TWITTER_CT0'));
  pushCookie('twid', getEnv('TWITTER_TWID'));
  pushCookie('gt', getEnv('TWITTER_GUEST_TOKEN') || getEnv('GT') || getEnv('gt'));
  pushCookie(
    'guest_id',
    getEnv('TWITTER_GUEST_ID') || getEnv('GUEST_ID') || getEnv('guest_id'),
  );

  return cookies;
};

const readCookieFile = (cookiesPath) => {
  if (!cookiesPath || !fs.existsSync(cookiesPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw.map((cookie) => {
      const domain = cookie.domain?.startsWith('.') ? cookie.domain : `.${cookie.domain || 'x.com'}`;
      return { ...cookie, domain };
    });
  } catch (error) {
    console.warn('[puppeteer] Failed to parse cookies.json:', error.message || error);
    return null;
  }
};

const writeTempFile = (buffer, ext = '.png') => {
  const name = `tweet-media-${crypto.randomUUID()}${ext}`;
  const filePath = path.join(os.tmpdir(), name);
  fs.writeFileSync(filePath, buffer);
  return filePath;
};

class PuppeteerPoster {
  constructor({ getEnv, cookiesPath, username }) {
    this.getEnv = getEnv;
    this.cookiesPath = cookiesPath;
    this.username = username;
    this.browser = null;
    this.page = null;
    this.inFlight = false;
  }

  async init() {
    if (this.browser) return;
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.page = await this.browser.newPage();
    await this.page.setUserAgent(DEFAULT_UA);
    await this.page.setViewport({ width: 1280, height: 900 });
    await this.applyCookies();
  }

  async applyCookies() {
    const cookieFileCookies = readCookieFile(this.cookiesPath);
    const cookies = cookieFileCookies || buildEnvCookies(this.getEnv);
    if (!cookies || cookies.length === 0) return;
    await this.page.setCookie(...cookies);
  }

  async ensureLoggedIn() {
    await this.page.goto('https://x.com/home', { waitUntil: 'networkidle2' });
    const loggedIn =
      (await this.page.$('[data-testid="SideNav_AccountSwitcher_Button"]')) ||
      (await this.page.$('[data-testid="AppTabBar_Profile_Link"]')) ||
      (await this.page.$('a[aria-label="Profile"]'));
    if (!loggedIn) {
      throw new Error('Puppeteer not logged in. Refresh cookies first.');
    }
  }

  async focusComposer() {
    const selector = '[data-testid="tweetTextarea_0"]';
    await this.page.waitForSelector(selector, { timeout: 15000 });
    const box = await this.page.$(selector);
    if (!box) throw new Error('Composer not found');
    await box.click();
    return box;
  }

  async attachMedia(mediaData = []) {
    if (!mediaData || mediaData.length === 0) return [];
    const fileInput = await this.page.$('input[data-testid="fileInput"]');
    if (!fileInput) {
      console.warn('[puppeteer] Media input not found; skipping attachments.');
      return [];
    }
    const files = [];
    for (const entry of mediaData) {
      if (!entry?.data) continue;
      const filePath = writeTempFile(entry.data, '.png');
      files.push(filePath);
    }
    if (files.length > 0) {
      await fileInput.uploadFile(...files);
      await sleep(1200);
    }
    return files;
  }

  async clickTweetButton() {
    const buttons = [
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]',
    ];
    for (const selector of buttons) {
      const button = await this.page.$(selector);
      if (!button) continue;
      const disabled = await this.page.evaluate((el) => el.getAttribute('aria-disabled'), button);
      if (disabled === 'true') continue;
      await button.click();
      return true;
    }
    return false;
  }

  async getLatestTweetId() {
    const profileUrl = `https://x.com/${this.username}`;
    await this.page.goto(profileUrl, { waitUntil: 'networkidle2' });
    await this.page.waitForSelector('article', { timeout: 15000 }).catch(() => null);
    const href = await this.page.evaluate(() => {
      const anchor = document.querySelector('article a[href*="/status/"]');
      return anchor ? anchor.getAttribute('href') : null;
    });
    if (!href) return null;
    const match = href.match(/status\/(\d+)/);
    return match ? match[1] : null;
  }

  async postTweet(text, mediaData = [], replyTo = null) {
    if (this.inFlight) throw new Error('Puppeteer poster busy');
    this.inFlight = true;
    try {
      await this.init();
      await this.ensureLoggedIn();

      if (replyTo) {
        await this.page.goto(`https://x.com/i/web/status/${replyTo}`, { waitUntil: 'networkidle2' });
        const replyButton = await this.page.$('[data-testid="reply"]');
        if (!replyButton) throw new Error('Reply button not found');
        await replyButton.click();
      } else {
        await this.page.goto('https://x.com/compose/tweet', { waitUntil: 'networkidle2' });
      }

      const box = await this.focusComposer();
      await box.type(text, { delay: 20 });

      await this.attachMedia(mediaData);

      const clicked = await this.clickTweetButton();
      if (!clicked) throw new Error('Tweet button not available');
      await sleep(2500);

      const tweetId = await this.getLatestTweetId();
      const url = tweetId ? `https://x.com/${this.username}/status/${tweetId}` : null;
      return { id: tweetId, url };
    } finally {
      this.inFlight = false;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

const createPuppeteerPoster = ({ getEnv, cookiesPath, username }) =>
  new PuppeteerPoster({ getEnv, cookiesPath, username });

module.exports = { createPuppeteerPoster };
