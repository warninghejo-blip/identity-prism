const puppeteer = require('puppeteer');

const DEMO_WALLET = 'vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg';
const BASE = 'https://identityprism.xyz';
const OUT = '/tmp/demo';

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1400,900'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // 1. Landing page
  console.log('1. Landing page...');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: `${OUT}/01_landing.png`, fullPage: false });

  // 2. With wallet address in URL
  console.log('2. Identity card...');
  await page.goto(`${BASE}/?address=${DEMO_WALLET}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  await page.screenshot({ path: `${OUT}/02_identity_card.png`, fullPage: false });

  // 3. Reputation API response
  console.log('3. Reputation API...');
  await page.goto(`${BASE}/api/reputation?address=${DEMO_WALLET}`, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/03_reputation_api.png`, fullPage: false });

  // 4. Attestation Blink (GET)
  console.log('4. Attestation Blink...');
  await page.goto(`${BASE}/api/actions/attest?address=${DEMO_WALLET}`, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/04_attestation_blink.png`, fullPage: false });

  // 5. Share Blink
  console.log('5. Share Blink...');
  await page.goto(`${BASE}/api/actions/share?address=${DEMO_WALLET}`, { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/05_share_blink.png`, fullPage: false });

  // 6. Verify page (empty)
  console.log('6. Verify page...');
  await page.goto(`${BASE}/verify`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 4000));
  await page.screenshot({ path: `${OUT}/06_verify_page.png`, fullPage: false });

  // 7. Card render (front)
  console.log('7. Card render...');
  await page.goto(`${BASE}/api/actions/render?address=${DEMO_WALLET}&side=front`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: `${OUT}/07_card_front.png`, fullPage: false });

  // 8. Card render (back)
  console.log('8. Card back...');
  await page.goto(`${BASE}/api/actions/render?address=${DEMO_WALLET}&side=back`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: `${OUT}/08_card_back.png`, fullPage: false });

  console.log(`\nDone! Screenshots saved to ${OUT}/`);
  await browser.close();
})();
