import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const durationMs = Number(process.env.DEMO_DURATION_MS || 12000);
const outputDir = path.resolve(process.cwd(), 'videos');
const outputFile = path.join(outputDir, process.env.DEMO_OUTPUT || 'agent-demo.webm');
const demoPath = path.resolve(process.cwd(), 'public', 'agent-demo.html');
const fallbackDemoUrl = pathToFileURL(demoPath).href;
const getEnv = (key) => (process.env[key] || '').trim();

const loadEnvFile = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index === -1) return;
      const key = trimmed.slice(0, index).trim();
      if (!key || process.env[key]) return;
      let value = trimmed.slice(index + 1).trim();
      value = value.replace(/^['"]|['"]$/g, '');
      process.env[key] = value;
    });
  } catch {
    // Ignore missing files.
  }
};

const envFiles = [
  path.resolve(process.cwd(), 'twitter-bot', '.env.scraper'),
  path.resolve(process.cwd(), 'twitter-bot', '.env'),
];
for (const envFile of envFiles) {
  await loadEnvFile(envFile);
}

const botUsername = (getEnv('TWITTER_USER_NAME') || getEnv('TWITTER_USERNAME') || 'IdentityPrism').replace(
  /^@/,
  '',
);
const twitterHost = (getEnv('TWITTER_HOST') || 'twitter.com').toLowerCase();
const demoUrl =
  getEnv('DEMO_TWITTER_URL') ||
  getEnv('DEMO_URL') ||
  (getEnv('DEMO_USE_TWITTER') === 'true' ? `https://${twitterHost}/${botUsername}` : fallbackDemoUrl);
const isTwitterUrl = /^https?:\/\/(x|twitter)\.com/i.test(demoUrl);

const buildTwitterCookies = () => {
  const cookies = [];
  const domains = ['.twitter.com', '.x.com'];
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

await fs.mkdir(outputDir, { recursive: true });

const viewport = { width: 1920, height: 1080 };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 1,
  recordVideo: { dir: outputDir, size: viewport },
});

if (isTwitterUrl) {
  const cookies = buildTwitterCookies();
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }
}

const page = await context.newPage();

await page.goto(demoUrl, { waitUntil: 'domcontentloaded' });
if (isTwitterUrl) {
  await page
    .waitForSelector('article, [data-testid="tweet"]', { timeout: 15000 })
    .catch(() => null);
  await page.waitForTimeout(1200);
  try {
    await page.keyboard.press('Escape');
  } catch {
    // Ignore if no overlay.
  }
  const scrollSteps = Number(process.env.DEMO_SCROLL_STEPS || 2);
  const scrollDistance = Number(process.env.DEMO_SCROLL_DISTANCE || 700);
  const scrollDelayMs = Number(process.env.DEMO_SCROLL_DELAY_MS || 1200);
  for (let step = 0; step < scrollSteps; step += 1) {
    await page.mouse.wheel(0, scrollDistance);
    await page.waitForTimeout(scrollDelayMs);
  }
} else {
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(durationMs);

const video = page.video();
await context.close();
await browser.close();

if (video) {
  const recordedPath = await video.path();
  if (recordedPath && recordedPath !== outputFile) {
    try {
      await fs.rename(recordedPath, outputFile);
    } catch {
      await fs.copyFile(recordedPath, outputFile);
    }
  }
}

console.log(`Saved demo video: ${outputFile}`);
console.log(`Demo URL: ${demoUrl}`);
