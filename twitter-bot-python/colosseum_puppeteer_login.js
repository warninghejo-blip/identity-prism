const puppeteer = require('puppeteer');
const fs = require('fs');

// Load Twitter cookies from the bot
let twitterCookies = [];
try {
  const raw = fs.readFileSync('/opt/identityprism-bot/cookies.json', 'utf8');
  const parsed = JSON.parse(raw);
  // Convert to Puppeteer format
  if (Array.isArray(parsed)) {
    twitterCookies = parsed;
  } else if (typeof parsed === 'object') {
    // might be {name: value} format
    twitterCookies = Object.entries(parsed).map(([name, value]) => ({
      name, value: String(value), domain: '.x.com',
    }));
  }
} catch (e) {
  console.error('Failed to load cookies:', e.message);
  // Try alternative cookie format (ct0=xxx; auth_token=xxx)
  try {
    const raw = fs.readFileSync('/opt/identityprism-bot/cookies.json', 'utf8');
    console.log('Raw cookie data (first 200 chars):', raw.substring(0, 200));
  } catch (e2) {}
}

console.log(`Loaded ${twitterCookies.length} cookies`);

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Step 1: Set Twitter cookies
  console.log('1. Setting Twitter cookies...');
  const xCookies = twitterCookies
    .filter(c => c.name && c.value)
    .map(c => ({
      name: c.name,
      value: String(c.value),
      domain: c.domain || '.x.com',
      path: c.path || '/',
      httpOnly: c.httpOnly !== undefined ? c.httpOnly : true,
      secure: c.secure !== undefined ? c.secure : true,
    }));
  
  // Also set for twitter.com
  const twitterDotComCookies = xCookies.map(c => ({...c, domain: '.twitter.com'}));
  
  if (xCookies.length > 0) {
    await page.setCookie(...xCookies, ...twitterDotComCookies);
    console.log(`   Set ${xCookies.length} cookies for x.com + twitter.com`);
  }

  // Step 2: Go to Colosseum and click Sign in with X
  console.log('2. Loading Colosseum...');
  await page.goto('https://colosseum.com/agent-hackathon/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: '/tmp/col_01_home.png' });

  // Find and click sign in
  console.log('3. Clicking Sign in...');
  const signInBtn = await page.$('button:has-text("Sign in")');
  if (signInBtn) {
    await signInBtn.click();
    await new Promise(r => setTimeout(r, 2000));
  } else {
    // Try to find by text content
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.innerText, btn);
      if (text.includes('Sign in')) {
        await btn.click();
        console.log('   Clicked:', text);
        await new Promise(r => setTimeout(r, 2000));
        break;
      }
    }
  }
  await page.screenshot({ path: '/tmp/col_02_signin_popup.png' });

  // Find "Sign in with X" button
  console.log('4. Looking for Sign in with X...');
  const allButtons = await page.$$('button, a');
  for (const btn of allButtons) {
    const text = await page.evaluate(el => el.innerText?.trim(), btn);
    if (text && text.includes('Sign in with X')) {
      console.log('   Found "Sign in with X" button, clicking...');
      
      // This will navigate to Twitter OAuth
      const [popup] = await Promise.all([
        new Promise(resolve => {
          browser.once('targetcreated', async (target) => {
            const p = await target.page();
            resolve(p);
          });
          // If no popup, resolve after timeout
          setTimeout(() => resolve(null), 5000);
        }),
        btn.click(),
      ]);

      if (popup) {
        console.log('   OAuth popup opened:', popup.url());
        await popup.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        await popup.screenshot({ path: '/tmp/col_03_oauth_popup.png' });
        console.log('   Popup URL:', popup.url());
      } else {
        // No popup — might navigate in same page
        await new Promise(r => setTimeout(r, 5000));
        console.log('   Current URL after click:', page.url());
        await page.screenshot({ path: '/tmp/col_03_after_signin.png' });
      }
      break;
    }
  }

  // Check current state
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/col_04_current.png' });
  console.log('5. Current URL:', page.url());
  
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('   Body:', bodyText.substring(0, 300));

  // List all pages/tabs
  const pages = await browser.pages();
  for (let i = 0; i < pages.length; i++) {
    console.log(`   Tab ${i}: ${pages[i].url()}`);
  }

  await browser.close();
})();
