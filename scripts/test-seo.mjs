import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  SITE_ORIGIN,
  DEFAULT_IMAGE,
  DEFAULT_IMAGE_HEIGHT,
  DEFAULT_IMAGE_PATH,
  DEFAULT_IMAGE_WIDTH,
  NOINDEX_DESCRIPTION,
  indexableSpaRoutes,
  noindexTitle,
  noindexArtifactPath,
  noindexSpaRoutes,
  routeRedirects,
  sitemapPaths,
  staticPageSeo,
} from './seo-routes.mjs';

const ROOT = new URL('../', import.meta.url);
const DIST = new URL('dist/', ROOT);

const read = (url) => readFile(url, 'utf8');
const count = (html, expression) => [...html.matchAll(expression)].length;
const stripMarkup = (html) =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function routeArtifact(pathname) {
  return new URL(
    pathname === '/' ? 'index.html' : `${pathname.slice(1)}/index.html`,
    DIST,
  );
}

function attrValues(html, tag, attribute, valueAttribute) {
  const tags = html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) ?? [];
  return tags
    .filter((candidate) =>
      new RegExp(`\\b${attribute}=(["'])${valueAttribute}\\1`, 'i').test(candidate),
    );
}

function assertManagedHead(html, expected) {
  const titles = html.match(/<title>[\s\S]*?<\/title>/gi) ?? [];
  const descriptions = attrValues(html, 'meta', 'name', 'description');
  const robots = attrValues(html, 'meta', 'name', 'robots');
  const canonicals = attrValues(html, 'link', 'rel', 'canonical');
  const ogTitles = attrValues(html, 'meta', 'property', 'og:title');
  const ogDescriptions = attrValues(html, 'meta', 'property', 'og:description');
  const ogUrls = attrValues(html, 'meta', 'property', 'og:url');
  const ogImages = attrValues(html, 'meta', 'property', 'og:image');
  const ogImageWidths = attrValues(html, 'meta', 'property', 'og:image:width');
  const ogImageHeights = attrValues(html, 'meta', 'property', 'og:image:height');
  const twitterTitles = attrValues(html, 'meta', 'name', 'twitter:title');
  const twitterImages = attrValues(html, 'meta', 'name', 'twitter:image');

  assert.equal(titles.length, 1, `${expected.path}: expected exactly one title`);
  assert.equal(
    descriptions.length,
    1,
    `${expected.path}: expected exactly one description`,
  );
  assert.equal(robots.length, 1, `${expected.path}: expected exactly one robots tag`);
  assert.equal(
    canonicals.length,
    1,
    `${expected.path}: expected exactly one canonical`,
  );
  assert.equal(ogTitles.length, 1, `${expected.path}: expected exactly one og:title`);
  assert.equal(
    ogDescriptions.length,
    1,
    `${expected.path}: expected exactly one og:description`,
  );
  assert.equal(ogUrls.length, 1, `${expected.path}: expected exactly one og:url`);
  assert.equal(ogImages.length, 1, `${expected.path}: expected exactly one og:image`);
  assert.equal(
    ogImageWidths.length,
    1,
    `${expected.path}: expected exactly one og:image:width`,
  );
  assert.equal(
    ogImageHeights.length,
    1,
    `${expected.path}: expected exactly one og:image:height`,
  );
  assert.equal(
    twitterTitles.length,
    1,
    `${expected.path}: expected exactly one twitter:title`,
  );
  assert.equal(
    twitterImages.length,
    1,
    `${expected.path}: expected exactly one twitter:image`,
  );

  assert.match(
    titles[0],
    new RegExp(`>${escapeRegex(escapeHtml(expected.title))}<`, 'i'),
  );
  assert.ok(
    descriptions[0].includes(`content="${escapeHtml(expected.description)}"`),
    `${expected.path}: description does not match manifest`,
  );
  assert.ok(
    canonicals[0].includes(`href="${expected.canonical}"`),
    `${expected.path}: canonical does not match manifest`,
  );
  assert.ok(
    robots[0].includes(`content="${expected.robots}"`),
    `${expected.path}: robots does not match manifest`,
  );
  assert.ok(
    ogUrls[0].includes(`content="${expected.canonical}"`),
    `${expected.path}: og:url does not match canonical`,
  );
  assert.ok(
    ogImages[0].includes(`content="${DEFAULT_IMAGE}"`),
    `${expected.path}: og:image must reference the stable social image`,
  );
  assert.ok(
    twitterImages[0].includes(`content="${DEFAULT_IMAGE}"`),
    `${expected.path}: twitter:image must reference the stable social image`,
  );
  assert.ok(
    ogImageWidths[0].includes(`content="${DEFAULT_IMAGE_WIDTH}"`),
    `${expected.path}: og:image:width does not match the image manifest`,
  );
  assert.ok(
    ogImageHeights[0].includes(`content="${DEFAULT_IMAGE_HEIGHT}"`),
    `${expected.path}: og:image:height does not match the image manifest`,
  );
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const titles = new Set();
const descriptions = new Set();
for (const route of indexableSpaRoutes) {
  const html = await read(routeArtifact(route.path));
  const canonical = `${SITE_ORIGIN}${route.path}`;
  assertManagedHead(html, {
    path: route.path,
    title: route.title,
    description: route.description,
    canonical,
    robots: 'index, follow, max-image-preview:large, max-snippet:-1',
  });
  assert.equal(
    count(html, /<h1\b[^>]*>/gi),
    1,
    `${route.path}: expected exactly one raw H1`,
  );
  assert.match(
    stripMarkup(html),
    new RegExp(escapeRegex(route.h1), 'i'),
    `${route.path}: raw H1 copy is missing`,
  );
  assert.ok(
    stripMarkup(html).length >= 450,
    `${route.path}: raw body copy is too thin`,
  );
  assert.ok(
    count(html, /<a\b[^>]*href=(["'])\/[^"']*\1/gi) >= 3,
    `${route.path}: expected at least three crawlable internal links`,
  );
  assert.equal(
    count(
      html,
      /<script\b(?=[^>]*type=(["'])application\/ld\+json\1)(?=[^>]*data-ip-route-schema)[^>]*>/gi,
    ),
    1,
    `${route.path}: expected one JSON-LD block`,
  );
  assert.doesNotThrow(() => {
    const script = html.match(
      /<script\b(?=[^>]*type=(["'])application\/ld\+json\1)[^>]*>([\s\S]*?)<\/script>/i,
    );
    JSON.parse(script[2]);
  }, `${route.path}: JSON-LD must be valid JSON`);

  assert.ok(!titles.has(route.title), `${route.path}: duplicate indexable title`);
  assert.ok(
    !descriptions.has(route.description),
    `${route.path}: duplicate indexable description`,
  );
  titles.add(route.title);
  descriptions.add(route.description);
}

for (const pathname of noindexSpaRoutes) {
  const html = await read(new URL(noindexArtifactPath(pathname), DIST));
  const title = noindexTitle(pathname);
  assertManagedHead(html, {
    path: pathname,
    title,
    description: NOINDEX_DESCRIPTION,
    canonical: `${SITE_ORIGIN}${pathname}`,
    robots: 'noindex, follow',
  });
  assert.equal(
    count(html, /data-seo-shell=(["'])noindex\1/gi),
    1,
    `${pathname}: noindex app shell missing`,
  );
}

for (const page of staticPageSeo) {
  const html = await read(new URL(page.path.slice(1), DIST));
  assertManagedHead(html, {
    path: page.path,
    title: page.title,
    description: page.description,
    canonical: `${SITE_ORIGIN}${page.path}`,
    robots: page.robots,
  });
  assert.equal(
    count(html, /<h1\b[^>]*>/gi),
    1,
    `${page.path}: expected exactly one H1`,
  );
  assert.equal(
    count(
      html,
      /<script\b(?=[^>]*type=(["'])application\/ld\+json\1)(?=[^>]*data-ip-route-schema)[^>]*>/gi,
    ),
    page.schema ? 1 : 0,
    `${page.path}: JSON-LD presence must match the static page manifest`,
  );
}

const sitemap = await read(new URL('sitemap.xml', DIST));
const sitemapLocs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(
  (match) => new URL(match[1]).pathname,
);
assert.deepEqual(
  [...sitemapLocs].sort(),
  [...sitemapPaths].sort(),
  'sitemap.xml must match the canonical indexable route inventory exactly',
);
assert.equal(
  count(sitemap, /<lastmod>/gi),
  0,
  'sitemap must not contain unverifiable lastmod values',
);

const notFound = await read(new URL('404.html', DIST));
assert.match(notFound, /<meta name="robots" content="noindex, follow"/i);
assert.match(notFound, /<h1>404 — Page not found<\/h1>/i);

const netlify = await read(new URL('netlify.toml', ROOT));
assert.ok(
  !/from\s*=\s*["']\/\*["'][\s\S]{0,120}status\s*=\s*200/i.test(netlify),
  'netlify.toml must not contain a global 200 SPA catch-all',
);
assert.match(
  netlify,
  /from\s*=\s*"https:\/\/www\.identityprism\.xyz\/\*"[\s\S]{0,160}to\s*=\s*"https:\/\/identityprism\.xyz\/:splat"[\s\S]{0,100}status\s*=\s*301[\s\S]{0,100}force\s*=\s*true/i,
  'www must permanently redirect to the apex and preserve :splat',
);
for (const redirect of routeRedirects) {
  const block = new RegExp(
    `from\\s*=\\s*"${escapeRegex(redirect.from)}"[\\s\\S]{0,100}to\\s*=\\s*"${escapeRegex(redirect.to)}"[\\s\\S]{0,80}status\\s*=\\s*${redirect.status}`,
    'i',
  );
  assert.match(netlify, block, `missing canonical redirect ${redirect.from}`);
}
for (const pathname of [
  ...indexableSpaRoutes.map((route) => route.path).filter((path) => path !== '/'),
  ...noindexSpaRoutes.filter((path) => path !== '/profile'),
]) {
  const target = `${pathname}/index.html`;
  const rewrite = new RegExp(
    `from\\s*=\\s*"${escapeRegex(pathname)}"[\\s\\S]{0,100}to\\s*=\\s*"${escapeRegex(target)}"[\\s\\S]{0,80}status\\s*=\\s*200[\\s\\S]{0,80}force\\s*=\\s*true`,
    'i',
  );
  assert.match(netlify, rewrite, `missing fixed route rewrite ${pathname}`);
}
for (const namespace of ['/app/*', '/preview/:tier', '/profile/:address']) {
  assert.match(
    netlify,
    new RegExp(`from\\s*=\\s*"${escapeRegex(namespace)}"`, 'i'),
    `missing noindex dynamic namespace rewrite ${namespace}`,
  );
}
assert.doesNotMatch(
  netlify,
  /from\s*=\s*"\/preview\/\*"/i,
  'nested /preview/:tier junk must fall through to a real 404',
);
assert.doesNotMatch(
  netlify,
  /from\s*=\s*"\/profile\/\*"/i,
  'nested /profile/:address junk must fall through to a real 404',
);
await assert.rejects(
  read(new URL('profile/index.html', DIST)),
  (error) => error?.code === 'ENOENT',
  'invalid /profile base must not have a static 200 artifact',
);

const socialImage = await readFile(
  new URL(DEFAULT_IMAGE_PATH.replace(/^\//, ''), DIST),
);
assert.equal(
  socialImage.subarray(1, 4).toString('ascii'),
  'PNG',
  'social image must be a PNG file',
);
assert.equal(
  socialImage.readUInt32BE(16),
  DEFAULT_IMAGE_WIDTH,
  'social image width metadata must match the actual PNG',
);
assert.equal(
  socialImage.readUInt32BE(20),
  DEFAULT_IMAGE_HEIGHT,
  'social image height metadata must match the actual PNG',
);

const sourceCopyChecks = [
  ['src/pages/LandingPage.tsx', 'Your reputation,'],
  ['src/pages/WebBlackHole.tsx', 'Recover rent from dust.'],
  ['src/pages/WebIdentityHub.tsx', 'Identity Passport'],
  ['src/pages/SybilCheckerPage.tsx', 'Scan any wallet.'],
  ['src/pages/Leaderboard.tsx', 'Top explorers across the Prism universe'],
];
for (const [relative, marker] of sourceCopyChecks) {
  const source = await read(new URL(relative, ROOT));
  assert.ok(
    source.includes(marker),
    `${relative}: logged-out copy drifted from the prerender manifest marker "${marker}"`,
  );
}

console.log(
  `SEO regression checks passed for ${indexableSpaRoutes.length} indexable SPA routes, ${noindexSpaRoutes.length} noindex SPA routes, ${staticPageSeo.length} static pages, sitemap, redirects, and 404 intent.`,
);
