const fs = require('fs');
const path = require('path');
const { Scraper } = require('agent-twitter-client');

const envCandidates = [
  path.resolve(__dirname, '..', '.env.scraper'),
  path.resolve(__dirname, '.env.scraper'),
  path.resolve(__dirname, '.env'),
];
const envFile = envCandidates.find((file) => fs.existsSync(file));
require('dotenv').config(envFile ? { path: envFile } : undefined);

const getEnv = (key, fallback = '') => (process.env[key] || fallback).trim();

async function main() {
  const username = getEnv('TWITTER_USERNAME', getEnv('TWITTER_USER_NAME'));
  const password = getEnv('TWITTER_PASSWORD');
  const email = getEnv('TWITTER_EMAIL');
  const twoFactorSecret = getEnv('TWITTER_2FA_SECRET');
  const timeoutMs = Number(getEnv('LOGIN_TIMEOUT_MS', '30000'));

  if (!username || !password) {
    throw new Error('Missing TWITTER_USERNAME/TWITTER_PASSWORD in .env.scraper');
  }

  const scraper = new Scraper();
  const loginPromise = scraper.login(
    username,
    password,
    email || undefined,
    twoFactorSecret || undefined,
  );
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Login timed out.')), timeoutMs);
  });

  await Promise.race([loginPromise, timeout]);

  const cookies = await scraper.getCookies();
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error('No cookies returned after login.');
  }

  const fixedCookies = cookies.map((cookie) => ({
    ...cookie,
    domain: '.twitter.com',
  }));

  const outPath = path.join(__dirname, 'cookies.json');
  fs.writeFileSync(outPath, JSON.stringify(fixedCookies, null, 2));
  console.log(`Cookies saved to ${outPath}`);
}

main().catch((error) => {
  console.error('[get-cookies] Failed:', error.message || error);
  process.exit(1);
});
