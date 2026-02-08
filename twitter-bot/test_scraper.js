const path = require('path');
const envCandidates = [
  path.resolve(__dirname, '.env.scraper'),
  path.resolve(__dirname, '..', '.env.scraper'),
  path.resolve(__dirname, '.env'),
];
const envPath = envCandidates.find((file) => require('fs').existsSync(file));
require('dotenv').config(envPath ? { path: envPath } : undefined);
const fs = require('fs');
const { Scraper } = require('agent-twitter-client');

const CONFIG = {
  twitterHost: (process.env.TWITTER_HOST || 'twitter.com').toLowerCase(),
};

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

function mapSameSite(value) {
  if (!value) return '';
  const normalized = String(value).toLowerCase();
  if (normalized === 'no_restriction' || normalized === 'none') return 'None';
  if (normalized === 'lax') return 'Lax';
  if (normalized === 'strict') return 'Strict';
  return '';
}

function buildCookieString(entry, domain) {
  const sameSiteValue = mapSameSite(entry.sameSite);
  const sameSite = sameSiteValue ? `; SameSite=${sameSiteValue}` : '';
  const httpOnly = entry.httpOnly ? '; HttpOnly' : '';
  const secure = entry.secure === false ? '' : '; Secure';
  const pathValue = entry.path || '/';
  return `${entry.name}=${entry.value}; Domain=.${domain}; Path=${pathValue}${secure}${httpOnly}${sameSite}`;
}

function buildCookieStrings(entries, targetHost) {
  const domain = normalizeHost(targetHost || 'twitter.com');
  return entries
    .filter((entry) => entry?.name && entry?.value)
    .map((entry) => buildCookieString(entry, domain));
}

async function seedHostCookies(scraper, host, cookieStrings) {
  const normalized = normalizeHost(host);
  if (normalized === 'twitter.com' || cookieStrings.length === 0) return;
  const jar = scraper?.auth?.cookieJar?.() || scraper?.authTrends?.cookieJar?.();
  if (!jar) return;
  for (const cookie of cookieStrings) {
    await jar.setCookie(cookie, `https://${normalized}`);
  }
}

async function test() {
  console.log('🚀 Запуск теста скрейпера...');

  const scraper = new Scraper(buildScraperOptions());
  const authToken = process.env.TWITTER_AUTH_TOKEN;
  const ct0 = process.env.TWITTER_CT0;
  const username = process.env.TWITTER_USERNAME || process.env.TWITTER_USER_NAME;
  const password = process.env.TWITTER_PASSWORD;
  const email = process.env.TWITTER_EMAIL;

  const cookiesFile = path.resolve(__dirname, 'cookies.json');
  const cookieEntries = fs.existsSync(cookiesFile)
    ? JSON.parse(fs.readFileSync(cookiesFile, 'utf-8'))
    : null;

  try {
    console.log('🍪 Логин через Cookies...');
    if (Array.isArray(cookieEntries) && cookieEntries.length > 0) {
      const cookieStrings = buildCookieStrings(cookieEntries, 'twitter.com');
      await scraper.setCookies(cookieStrings);
      await seedHostCookies(scraper, CONFIG.twitterHost, buildCookieStrings(cookieEntries, CONFIG.twitterHost));
    } else if (authToken && ct0) {
      const fallbackCookies = [
        `auth_token=${authToken}; Domain=.twitter.com; Path=/; Secure; HttpOnly; SameSite=None`,
        `ct0=${ct0}; Domain=.twitter.com; Path=/; Secure; SameSite=None`,
      ];
      await scraper.setCookies(fallbackCookies);
      if (normalizeHost(CONFIG.twitterHost) !== 'twitter.com') {
        await seedHostCookies(scraper, CONFIG.twitterHost, fallbackCookies);
      }
    } else {
      console.error('❌ Нет куков в .env (TWITTER_AUTH_TOKEN, TWITTER_CT0) или cookies.json');
      return;
    }

    console.log('✅ Куки загружены. Проверяем статус...');
    const isLoggedIn = await scraper.isLoggedIn();
    console.log('Статус входа:', isLoggedIn);

    if (!isLoggedIn && username && password) {
      console.warn('⚠️ Куки не сработали, пробуем логин по паролю...');
      await scraper.login(username, password, email || undefined);
    }

    const loggedInAfter = await scraper.isLoggedIn();
    if (!loggedInAfter) {
      console.error('❌ Не удалось залогиниться. Куки/пароль не подошли.');
      return;
    }

    console.log('🔍 Пробуем найти твиты Илона Маска...');
    const tweets = await scraper.getTweets('elonmusk', 2);

    for (const t of tweets) {
      console.log(`\n📄 Твит найден: ${t.text?.substring(0, 50) || ''}...`);
    }

    console.log('\n🎉 Тест пройден! Скрейпер работает.');
  } catch (error) {
    console.error('🔥 Ошибка скрейпера:', error);
  }
}

test();
