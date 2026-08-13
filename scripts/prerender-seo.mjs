import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  DEFAULT_IMAGE,
  DEFAULT_IMAGE_HEIGHT,
  DEFAULT_IMAGE_WIDTH,
  NOINDEX_DESCRIPTION,
  SITE_ORIGIN,
  indexableSpaRoutes,
  noindexTitle,
  noindexArtifactPath,
  noindexSpaRoutes,
  staticPageSeo,
} from './seo-routes.mjs';

const DIST = new URL('../dist/', import.meta.url);
const indexPath = new URL('index.html', DIST);
const baseHtml = await readFile(indexPath, 'utf8');

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function removeTagByAttribute(html, tag, attribute, value) {
  const expression = new RegExp(
    `<${tag}\\b(?=[^>]*\\b${attribute}=(["'])${escapeRegex(value)}\\1)[^>]*>\\s*`,
    'gi',
  );
  return html.replace(expression, '');
}

function clearManagedHead(html) {
  let result = html.replace(/<title>[\s\S]*?<\/title>\s*/gi, '');
  for (const name of [
    'description',
    'robots',
    'twitter:card',
    'twitter:site',
    'twitter:title',
    'twitter:description',
    'twitter:image',
  ]) {
    result = removeTagByAttribute(result, 'meta', 'name', name);
  }
  for (const property of [
    'og:title',
    'og:description',
    'og:type',
    'og:site_name',
    'og:url',
    'og:image',
    'og:image:width',
    'og:image:height',
  ]) {
    result = removeTagByAttribute(result, 'meta', 'property', property);
  }
  result = removeTagByAttribute(result, 'link', 'rel', 'canonical');
  result = result.replace(/<link\b(?=[^>]*\bdata-ip-hreflang(?:=(['"])[^'"]*\1)?)[^>]*>\s*/gi, '');
  result = result.replace(
    /<script\b(?=[^>]*\btype=(["'])application\/ld\+json\1)[^>]*>[\s\S]*?<\/script>\s*/gi,
    '',
  );
  return result;
}

function managedHead({ title, description, canonical, robots, schema, type = 'website', alternates = [] }) {
  const jsonLd = schema
    ? `\n    <script type="application/ld+json" data-ip-route-schema>${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`
    : '';
  const alternateLinks = alternates
    .map(({ hreflang, href }) => `\n    <link rel="alternate" hreflang="${escapeHtml(hreflang)}" href="${escapeHtml(href)}" data-ip-hreflang />`)
    .join('');
  return `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${escapeHtml(robots)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />${alternateLinks}
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="${escapeHtml(type)}" />
    <meta property="og:site_name" content="Identity Prism" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${DEFAULT_IMAGE}" />
    <meta property="og:image:width" content="${DEFAULT_IMAGE_WIDTH}" />
    <meta property="og:image:height" content="${DEFAULT_IMAGE_HEIGHT}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@Identity_Prism" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DEFAULT_IMAGE}" />${jsonLd}
  `;
}

function replaceHead(html, metadata) {
  const cleaned = clearManagedHead(html);
  return cleaned.replace('</head>', `${managedHead(metadata)}\n  </head>`);
}

function replaceDocumentLanguage(html, language = 'en') {
  return html.replace(/<html\b([^>]*)\blang=(['"])[^'"]*\2([^>]*)>/i, `<html$1lang="${escapeHtml(language)}"$3>`);
}

function renderLinks(links) {
  return links
    .map(
      ({ href, label }) =>
        `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`,
    )
    .join('');
}

function indexableShell(route) {
  return `<main data-seo-shell="indexable" aria-label="${escapeHtml(route.h1)}" style="max-width:72rem;margin:0 auto;padding:7rem 1.5rem 3rem;color:#f4f4f5;font-family:system-ui,sans-serif">
      <p style="text-transform:uppercase;letter-spacing:.16em;color:#67e8f9">Identity Prism · Solana</p>
      <h1>${escapeHtml(route.h1)}</h1>
      ${route.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
      <nav aria-label="Explore Identity Prism"><ul>${renderLinks(route.links)}</ul></nav>
    </main>`;
}

function noindexShell(pathname) {
  const label = pathname
    .split('/')
    .filter(Boolean)
    .join(' ')
    .replaceAll('-', ' ') || 'application';
  return `<main data-seo-shell="noindex" style="max-width:48rem;margin:0 auto;padding:7rem 1.5rem 3rem;color:#f4f4f5;font-family:system-ui,sans-serif">
      <h1>${escapeHtml(`Identity Prism ${label}`)}</h1>
      <p>This interactive Identity Prism application route may depend on a connected wallet, route parameters, or live account state.</p>
      <p><a href="/">Return to the public Identity Prism overview</a></p>
    </main>`;
}

function replaceRoot(html, shell) {
  const rootPattern = /<div id="root"([^>]*)>[\s\S]*?<\/div>/i;
  if (!rootPattern.test(html)) {
    throw new Error('Could not find the Vite #root element while prerendering.');
  }
  return html.replace(
    rootPattern,
    `<div id="root"$1>${shell}</div><noscript><style>#app-preloader{display:none!important}</style></noscript>`,
  );
}

async function writeArtifact(relative, html) {
  const output = new URL(relative, DIST);
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, html);
}

async function writeRoute(pathname, html) {
  const relative = pathname === '/' ? 'index.html' : `${pathname.slice(1)}/index.html`;
  await writeArtifact(relative, html);
}

for (const route of indexableSpaRoutes) {
  const canonical = `${SITE_ORIGIN}${route.path}`;
  const html = replaceDocumentLanguage(replaceRoot(
    replaceHead(baseHtml, {
      title: route.title,
      description: route.description,
      canonical,
      robots: 'index, follow, max-image-preview:large, max-snippet:-1',
      schema: route.schema,
      alternates: route.alternates,
    }),
    indexableShell(route),
  ), route.language);
  await writeRoute(route.path, html);
}

for (const pathname of noindexSpaRoutes) {
  const canonical = `${SITE_ORIGIN}${pathname}`;
  const html = replaceRoot(
    replaceHead(baseHtml, {
      title: noindexTitle(pathname),
      description: NOINDEX_DESCRIPTION,
      canonical,
      robots: 'noindex, follow',
    }),
    noindexShell(pathname),
  );
  await writeArtifact(noindexArtifactPath(pathname), html);
}

for (const page of staticPageSeo) {
  const relative = page.path.slice(1);
  const output = new URL(relative, DIST);
  let html = await readFile(output, 'utf8');
  html = replaceHead(html, {
    title: page.title,
    description: page.description,
    canonical: `${SITE_ORIGIN}${page.path}`,
    robots: page.robots,
    schema: page.schema,
    type: page.ogType,
  });
  await writeFile(output, html);
}

const notFoundHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page Not Found | Identity Prism</title>
    <meta name="description" content="The requested Identity Prism page could not be found." />
    <meta name="robots" content="noindex, follow" />
    <link rel="icon" type="image/png" href="/phav.png" />
  </head>
  <body style="margin:0;background:#05070a;color:#f4f4f5;font-family:system-ui,sans-serif">
    <main style="max-width:42rem;margin:0 auto;padding:7rem 1.5rem;text-align:center">
      <h1>404 — Page not found</h1>
      <p>The requested page does not exist.</p>
      <p><a href="/" style="color:#67e8f9">Return to Identity Prism</a></p>
    </main>
  </body>
</html>`;
await writeFile(new URL('404.html', DIST), notFoundHtml);

console.log(
  `SEO prerender complete: ${indexableSpaRoutes.length} indexable SPA routes, ${noindexSpaRoutes.length} noindex SPA routes, ${staticPageSeo.length} static pages, and 404.html.`,
);
