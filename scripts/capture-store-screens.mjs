import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const baseArg = args.find((arg) => arg.startsWith('--base='));
const outArg = args.find((arg) => arg.startsWith('--out='));

const baseUrl = baseArg ? baseArg.split('=')[1] : process.env.PREVIEW_BASE_URL || 'https://identityprism.xyz';
const outputDir = outArg
  ? outArg.split('=')[1]
  : path.resolve(process.cwd(), 'dapp-store', 'media');

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });

const capturePage = async (slug, url, waitSelector) => {
  console.log(`Capturing ${slug} -> ${url}`);
  await page.goto(url, { waitUntil: 'networkidle' });
  if (waitSelector) {
    await page.waitForSelector(waitSelector);
  }
  await page.waitForTimeout(1500);
  const filePath = path.join(outputDir, `${slug}.png`);
  await page.screenshot({ path: filePath });
  console.log(`Saved: ${filePath}`);
  return filePath;
};

await capturePage('screenshot_1_landing', `${baseUrl}/`, '.identity-shell');
await capturePage('screenshot_2_front', `${baseUrl}/preview/sun?format=store&view=front`, '.celestial-card-shell');
await capturePage('screenshot_3_stats', `${baseUrl}/preview/sun?format=store&view=back&tab=stats`, '.celestial-card-shell');
await capturePage('screenshot_4_badges', `${baseUrl}/preview/sun?format=store&view=back&tab=badges`, '.celestial-card-shell');

await browser.close();
console.log('Done.');
