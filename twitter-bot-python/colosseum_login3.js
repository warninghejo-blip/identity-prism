const puppeteer = require('puppeteer');
const fs = require('fs');

const twitterCookies = JSON.parse(fs.readFileSync('/opt/identityprism-bot/cookies.json', 'utf8'));
console.log(`Loaded ${twitterCookies.length} cookies`);

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Set cookies
  const xCookies = twitterCookies.map(c => ({
    name: c.name, value: String(c.value),
    domain: c.domain || '.x.com', path: c.path || '/',
    httpOnly: c.httpOnly ?? true, secure: c.secure ?? true,
  }));
  await page.setCookie(...xCookies);
  await page.setCookie(...xCookies.map(c => ({...c, domain: '.twitter.com'})));

  // Intercept all requests to find OAuth URL
  const oauthUrls = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('oauth') || url.includes('authorize') || url.includes('twitter.com/i/oauth') || url.includes('api.twitter.com')) {
      oauthUrls.push(url);
      console.log('   INTERCEPTED:', url);
    }
  });

  // Also listen for popup windows
  browser.on('targetcreated', async (target) => {
    console.log('   NEW TARGET:', target.type(), target.url());
  });

  // Load page
  console.log('1. Loading Colosseum...');
  await page.goto('https://colosseum.com/agent-hackathon/', { waitUntil: 'networkidle2', timeout: 30000 });

  // Click Sign in
  console.log('2. Clicking Sign in...');
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.innerText.trim() === 'Sign in') { b.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '/tmp/col3_02.png' });

  // Get the HTML of the sign-in modal/dropdown
  const modalHtml = await page.evaluate(() => {
    // Find modal or dropdown
    const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dropdown"], [class*="popup"], [class*="overlay"]');
    let html = '';
    for (const m of modals) html += m.outerHTML.substring(0, 1000) + '\n';
    if (!html) {
      // Get all visible buttons/links
      const els = document.querySelectorAll('button, a');
      for (const el of els) {
        if (el.offsetParent !== null && el.innerText.includes('Sign in')) {
          html += el.outerHTML.substring(0, 500) + '\n';
        }
      }
    }
    return html;
  });
  console.log('   Modal HTML:', modalHtml.substring(0, 800));

  // Try clicking "Sign in with X" with navigation wait
  console.log('3. Clicking Sign in with X...');
  
  // Override window.open to capture the URL
  await page.evaluate(() => {
    window.__openedUrls = [];
    const origOpen = window.open;
    window.open = function(url, ...args) {
      window.__openedUrls.push(url);
      console.log('window.open called with:', url);
      return origOpen.call(this, url, ...args);
    };
  });

  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button, a')) {
      const txt = b.innerText || '';
      if (txt.includes('Sign in with X') || txt.includes('Sign in with Twitter')) {
        console.log('Clicking:', txt, b.tagName, b.href || '');
        b.click();
        return;
      }
    }
  });

  await new Promise(r => setTimeout(r, 3000));

  // Check if window.open was called
  const openedUrls = await page.evaluate(() => window.__openedUrls || []);
  console.log('   window.open URLs:', openedUrls);
  console.log('   OAuth URLs intercepted:', oauthUrls);

  // Check all tabs
  const allPages = await browser.pages();
  for (let i = 0; i < allPages.length; i++) {
    const url = allPages[i].url();
    console.log(`   Tab ${i}: ${url}`);
    if (url.includes('twitter') || url.includes('x.com/i/oauth')) {
      console.log('   >>> Found OAuth tab!');
      await allPages[i].screenshot({ path: '/tmp/col3_oauth.png' });
      const body = await allPages[i].evaluate(() => document.body.innerText.substring(0, 500));
      console.log('   OAuth body:', body.substring(0, 300));
    }
  }

  // Check current page URL (might have redirected)
  console.log('4. Current URL:', page.url());
  await page.screenshot({ path: '/tmp/col3_04.png' });

  await browser.close();
})();
