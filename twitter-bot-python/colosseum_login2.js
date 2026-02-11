const puppeteer = require('puppeteer');
const fs = require('fs');

// Load Twitter cookies
let twitterCookies = [];
try {
  const raw = fs.readFileSync('/opt/identityprism-bot/cookies.json', 'utf8');
  twitterCookies = JSON.parse(raw);
  console.log(`Loaded ${twitterCookies.length} cookies`);
} catch (e) {
  console.error('Cookie load failed:', e.message);
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Set Twitter cookies for x.com and twitter.com
  const xCookies = twitterCookies.map(c => ({
    name: c.name, value: String(c.value),
    domain: c.domain || '.x.com', path: c.path || '/',
    httpOnly: c.httpOnly ?? true, secure: c.secure ?? true,
  }));
  const twCookies = xCookies.map(c => ({...c, domain: '.twitter.com'}));
  await page.setCookie(...xCookies, ...twCookies);

  // Go to Colosseum
  console.log('1. Loading Colosseum...');
  await page.goto('https://colosseum.com/agent-hackathon/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: '/tmp/col_01.png' });

  // Click Sign in button by evaluating all buttons
  console.log('2. Clicking Sign in...');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.innerText.trim() === 'Sign in') { b.click(); break; }
    }
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '/tmp/col_02.png' });

  // Click "Sign in with X" — this triggers Twitter OAuth redirect
  console.log('3. Clicking Sign in with X...');
  
  // Listen for new pages (OAuth popup) or navigation
  const navPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null);
  
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button, a');
    for (const b of btns) {
      if (b.innerText.includes('Sign in with X')) { b.click(); break; }
    }
  });

  await navPromise;
  await new Promise(r => setTimeout(r, 3000));
  
  // Check all tabs
  const pages = await browser.pages();
  console.log(`   ${pages.length} tabs open`);
  for (let i = 0; i < pages.length; i++) {
    console.log(`   Tab ${i}: ${pages[i].url()}`);
  }

  // Find the Twitter auth page
  let authPage = null;
  for (const p of pages) {
    const url = p.url();
    if (url.includes('twitter.com') || url.includes('x.com')) {
      authPage = p;
      break;
    }
  }

  if (!authPage) {
    // Check if we're on the auth page in the main tab
    const currentUrl = page.url();
    console.log('   Main page URL:', currentUrl);
    if (currentUrl.includes('twitter.com') || currentUrl.includes('x.com')) {
      authPage = page;
    }
  }

  if (authPage) {
    console.log('4. On Twitter OAuth page:', authPage.url());
    await authPage.screenshot({ path: '/tmp/col_03_oauth.png' });
    
    const oauthBody = await authPage.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('   OAuth body:', oauthBody.substring(0, 300));

    // Look for "Authorize app" or "Allow" button
    const authButtons = await authPage.evaluate(() => {
      return Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => ({
        text: b.innerText?.trim() || b.value?.trim() || '',
        id: b.id,
        type: b.type,
      }));
    });
    console.log('   Auth buttons:', JSON.stringify(authButtons));

    // Click authorize/allow
    await authPage.evaluate(() => {
      const btns = document.querySelectorAll('button, input[type="submit"]');
      for (const b of btns) {
        const txt = (b.innerText || b.value || '').toLowerCase();
        if (txt.includes('authorize') || txt.includes('allow') || txt.includes('sign in') || txt.includes('log in')) {
          b.click();
          return true;
        }
      }
      return false;
    });

    await new Promise(r => setTimeout(r, 5000));
    
    // Check where we ended up
    const allPages = await browser.pages();
    for (const p of allPages) {
      if (p.url().includes('colosseum')) {
        console.log('5. Back on Colosseum:', p.url());
        await p.screenshot({ path: '/tmp/col_04_loggedin.png' });
        const body = await p.evaluate(() => document.body.innerText.substring(0, 500));
        console.log('   Body:', body.substring(0, 300));
        break;
      }
    }
  } else {
    console.log('4. No Twitter OAuth page found');
    await page.screenshot({ path: '/tmp/col_03_noauth.png' });
    console.log('   Current URL:', page.url());
    const body = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('   Body:', body.substring(0, 300));
  }

  await browser.close();
})();
