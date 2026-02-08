import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const TIERS = [
  'mercury',
  'mars',
  'venus',
  'earth',
  'neptune',
  'uranus',
  'saturn',
  'jupiter',
  'sun',
  'binary_sun',
];

const args = process.argv.slice(2);
const baseArg = args.find((arg) => arg.startsWith('--base='));
const outArg = args.find((arg) => arg.startsWith('--out='));

const baseUrl = baseArg ? baseArg.split('=')[1] : process.env.PREVIEW_BASE_URL || 'http://localhost:5173';
const outputDir = outArg
  ? outArg.split('=')[1]
  : path.resolve(process.cwd(), 'server', 'assets', 'previews');

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 450, height: 450 }, deviceScaleFactor: 1 });

for (const tier of TIERS) {
  const url = `${baseUrl}/preview/${tier}?capture=1&format=blink`;
  console.log(`Capturing ${tier} -> ${url}`);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.celestial-card-shell');
  await page.waitForTimeout(1200);

  const filePath = path.join(outputDir, `${tier}.png`);
  await page.locator('.celestial-card-shell').first().screenshot({ path: filePath });
  console.log(`Saved: ${filePath}`);
}

const captureBack = async (tab) => {
  const backUrl = `${baseUrl}/preview/sun?capture=1&format=blink&view=back&tab=${tab}`;
  console.log(`Capturing back (${tab}) -> ${backUrl}`);
  await page.goto(backUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.celestial-card-shell');
  await page.waitForTimeout(1200);
  const backPath = path.join(outputDir, `back-${tab}.png`);
  await page.locator('.celestial-card-shell').first().screenshot({ path: backPath });
  console.log(`Saved: ${backPath}`);
  return backPath;
};

const extractLayout = async (tab) => {
  const backUrl = `${baseUrl}/preview/sun?capture=1&format=blink&view=back&tab=${tab}`;
  await page.goto(backUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.celestial-card-shell');
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const root = document.querySelector('.celestial-card-shell');
    if (!root) return null;
    const rootRect = root.getBoundingClientRect();
    const getBox = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
      };
    };
    const getStyle = (el) => {
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return {
        fontSize: parseFloat(style.fontSize),
        fontWeight: style.fontWeight,
        fontFamily: style.fontFamily,
        color: style.color,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        textAlign: style.textAlign,
      };
    };

    const scoreEl = root.querySelector('[data-capture="score"]');
    const addressEl = root.querySelector('[data-capture="address"]');
    const statEls = Array.from(root.querySelectorAll('[data-stat-key]'));
    const stats = {};
    statEls.forEach((el) => {
      const key = el.getAttribute('data-stat-key') ?? '';
      if (!key) return;
      stats[key] = { box: getBox(el), style: getStyle(el) };
    });

    const badgeRows = Array.from(root.querySelectorAll('[data-badge-row]'));
    const badges = badgeRows.map((row) => {
      const iconEl = row.querySelector('[data-badge-icon]');
      const labelEl = row.querySelector('[data-badge-label]');
      const descEl = row.querySelector('[data-badge-desc]');
      return {
        box: getBox(row),
        icon: { box: getBox(iconEl), style: getStyle(iconEl) },
        label: { box: getBox(labelEl), style: getStyle(labelEl) },
        desc: { box: getBox(descEl), style: getStyle(descEl) },
      };
    });

    return {
      width: rootRect.width,
      height: rootRect.height,
      score: { box: getBox(scoreEl), style: getStyle(scoreEl) },
      address: { box: getBox(addressEl), style: getStyle(addressEl) },
      stats,
      badges,
    };
  });
};

await captureBack('stats');
await captureBack('badges');
const layoutStats = await extractLayout('stats');
const layoutBadges = await extractLayout('badges');
const layoutPath = path.join(outputDir, 'back-layout.json');
await fs.writeFile(
  layoutPath,
  JSON.stringify({ stats: layoutStats, badges: layoutBadges }, null, 2),
  'utf-8'
);
console.log(`Saved: ${layoutPath}`);

await browser.close();
console.log('Done.');
