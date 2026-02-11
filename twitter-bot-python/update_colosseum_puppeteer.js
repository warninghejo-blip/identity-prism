const puppeteer = require('puppeteer');

const CLAIM_URL = 'https://colosseum.com/agent-hackathon/claim/e2da084e-f34d-4278-b97d-f2fb0cf2b56d';

const NEW_DESC = `Identity Prism is an on-chain reputation and identity layer for Solana. Connect any wallet to get a reputation score (0–1400), celestial tier, achievement badges, and a stunning 3D identity card — all computed from real on-chain data.

Core Features:
• Reputation API (public REST): /api/reputation?address=WALLET — any dApp can integrate for trust scoring, sybil detection, or gating
• On-Chain Attestation: Record reputation permanently on Solana via Memo program, co-signed by authority. Works as a Solana Blink.
• Attestation Verify Page: identityprism.xyz/verify — verify any attestation transaction on-chain
• AI Twitter Agent (@Identity_Prism): Auto-replies with real reputation data when mentioned with a wallet address. Posts threads, trend reactions, quotes with AI-generated images (Gemini Imagen).
• 3D Solar System Visualization: planets=tokens, moons=NFTs, dust=activity (Three.js)
• Multi-Factor Scoring: 14 factors including SOL balance, wallet age, tx count, NFTs, DeFi/LST. 13 badge types, 10 celestial tiers.
• Solana Blinks/Actions: share identity card, mint as NFT, attest reputation — all from any Blink-compatible wallet
• cNFT Minting via Metaplex Core
• Black Hole: Burn unwanted SPL tokens, reclaim rent SOL
• Android app via Capacitor + Solana MWA

Stack: Vite+React+Three.js, Node.js, Helius DAS API, Gemini AI (text+Imagen), Metaplex Core, Solana Actions/Blinks, Solana Memo Program, curl_cffi, Capacitor.
Live: https://identityprism.xyz`;

const NEW_REPO = 'https://github.com/YourIdentityPrism/identity-prism';

const NEW_SOLANA = `1. Helius RPC + DAS API: Wallet tx history, token holdings, NFT collections — fed into 14-factor reputation scoring engine
2. Solana Memo Program: On-chain attestation — writes reputation score as JSON memo, co-signed by treasury authority keypair. Verifiable by any smart contract or dApp.
3. Metaplex Core: Mints identity cards as on-chain NFTs with full collection verification
4. SPL Token: SOL payments for minting, token balance analysis for scoring
5. Solana Actions/Blinks: Three Blink endpoints — share card, mint NFT, attest reputation. Works from Phantom, Backpack, Dialect.
6. Black Hole: Burns SPL tokens (TOKEN_PROGRAM + TOKEN_2022), reclaims rent via closeAccount
7. Reputation API: Public REST endpoints — any Solana dApp can call to assess wallet trust, gate features, or detect sybils`;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    console.log('1. Loading claim page...');
    await page.goto(CLAIM_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.screenshot({ path: '/tmp/colosseum_1_claim.png' });
    console.log('   Page title:', await page.title());
    console.log('   URL:', page.url());

    // Wait for page to fully load
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: '/tmp/colosseum_2_loaded.png' });

    // Check what's on the page
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
    console.log('   Body text preview:', bodyText.substring(0, 500));

    // Look for edit/submit buttons or forms
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a, button')).map(el => ({
        tag: el.tagName,
        text: el.innerText?.trim().substring(0, 50),
        href: el.href || '',
      }));
    });
    console.log('   Links/buttons:', JSON.stringify(links.slice(0, 20), null, 2));

    // Check for any forms
    const forms = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('form, textarea, input[type="text"]')).map(el => ({
        tag: el.tagName,
        name: el.name || el.id || '',
        placeholder: el.placeholder || '',
      }));
    });
    console.log('   Form elements:', JSON.stringify(forms, null, 2));

    // Look for navigation to project edit
    const allUrls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]')).map(a => a.href);
    });
    const projectUrls = allUrls.filter(u => u.includes('project') || u.includes('edit') || u.includes('submit'));
    console.log('   Project-related URLs:', projectUrls);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
