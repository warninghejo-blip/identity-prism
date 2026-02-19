import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaDir = path.join(__dirname, '..', 'dapp-store', 'media');

const BASE = 'http://localhost:4174';
const VIEWPORT = { width: 390, height: 844 }; // iPhone 14 size

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });

  // Screenshot 5: Game start menu
  {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/game`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000); // let 3D scene load
    await page.screenshot({ path: path.join(mediaDir, 'screenshot_5_game_start.png'), type: 'png' });
    console.log('✓ screenshot_5_game_start.png');
    await page.close();
  }

  // Screenshot 6: BlackHole page
  {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/blackhole`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(mediaDir, 'screenshot_6_blackhole.png'), type: 'png' });
    console.log('✓ screenshot_6_blackhole.png');
    await page.close();
  }

  // Screenshot 7: Main landing
  {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(mediaDir, 'screenshot_7_home.png'), type: 'png' });
    console.log('✓ screenshot_7_home.png');
    await page.close();
  }

  await browser.close();
  console.log('Done! Screenshots saved to dapp-store/media/');
}

main().catch((e) => { console.error(e); process.exit(1); });
