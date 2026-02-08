import { gotScraping } from 'got-scraping';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env.scraper') });

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Load cookies
const cookiesPath = path.resolve(__dirname, 'cookies.json');
let cookieHeader = '';
let guestId = process.env.guest_id || '177022498227877951';
let ct0 = process.env.TWITTER_CT0;

if (fs.existsSync(cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
    cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const guestCookie = cookies.find((c) => c.name === 'guest_id');
    if (guestCookie) {
         const match = decodeURIComponent(guestCookie.value).match(/v1:(\d+)/);
         guestId = match ? match[1] : guestCookie.value;
    }
    const ct0Cookie = cookies.find((c) => c.name === 'ct0');
    if (ct0Cookie) ct0 = ct0Cookie.value;
}

const baseHeaders = {
    authorization: `Bearer ${BEARER_TOKEN}`,
    'x-csrf-token': ct0,
    'x-guest-token': guestId,
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'x-client-uuid': crypto.randomUUID(),
    'content-type': 'application/json',
    cookie: cookieHeader,
    referer: 'https://x.com/explore',
    origin: 'https://x.com',
};

async function testV1Search() {
    console.log('Testing V1.1 Search (Universal/Adaptive)...');
    
    // V1.1 Search endpoint used by some older clients
    const url = 'https://api.twitter.com/1.1/search/universal.json?q=%40IdentityPrism&count=20&modules=status';
    
    try {
        const response = await gotScraping({
            url,
            method: 'GET',
            headers: {
                ...baseHeaders,
                'x-twitter-auth-type': 'OAuth2Session'
            },
            responseType: 'buffer',
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
            },
            retry: { limit: 0 },
            throwHttpErrors: false,
        });

        console.log(`Status: ${response.statusCode}`);
        if (response.statusCode === 200) {
            console.log('Success! V1.1 Search returned 200.');
            const bodyText = response.body ? response.body.toString('utf-8') : '';
            console.log(`Body length: ${bodyText.length}`);
            if (!bodyText) {
                console.log('Warning: Response body is empty.');
                return;
            }
            try {
                const data = JSON.parse(bodyText);
                const statuses = data.modules ? data.modules.map(m => m.status).filter(Boolean) : [];
                console.log(`Found ${statuses.length} tweets.`);
                if (statuses.length > 0) {
                    console.log('Sample tweet:', statuses[0].text);
                }
            } catch (e) {
                console.error('Failed to parse JSON:', e.message);
                console.log('Raw body (first 500 chars):', bodyText.substring(0, 500));
            }
        } else {
            console.log('V1.1 Search failed:', response.statusCode);
            const bodyText = response.body ? response.body.toString('utf-8') : '';
            console.log('Body:', bodyText.substring(0, 300));
        }
    } catch (error) {
        console.error('V1.1 Search error:', error.message);
    }
}

testV1Search();
