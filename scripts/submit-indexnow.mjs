import { readFile } from 'node:fs/promises';

const HOST = 'identityprism.xyz';
const ORIGIN = `https://${HOST}`;
const KEY = 'd2c9a91817e24bc1a66d59bb9f47e612';
const DIST = new URL('../dist/', import.meta.url);

const verification = (await readFile(new URL(`${KEY}.txt`, DIST), 'utf8')).trim();
if (verification !== KEY) {
  throw new Error('IndexNow verification file is missing or does not match the configured key.');
}

const sitemap = await readFile(new URL('sitemap.xml', DIST), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
if (urlList.length === 0 || urlList.some((url) => new URL(url).host !== HOST)) {
  throw new Error('The built sitemap has no canonical URLs or contains another host.');
}

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `${ORIGIN}/${KEY}.txt`,
    urlList,
  }),
});

if (response.status !== 200 && response.status !== 202) {
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`IndexNow rejected the URL batch (${response.status}): ${detail}`);
}

console.log(`IndexNow accepted ${urlList.length} URLs with status ${response.status}.`);
