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

if (!cookieHeader) {
    cookieHeader = `auth_token=${process.env.TWITTER_AUTH_TOKEN}; ct0=${process.env.TWITTER_CT0}`;
}

const params = new URLSearchParams({
    count: '20',
    tweet_mode: 'extended',
    include_entities: '1',
    include_user_entities: '1',
});

const endpoints = [
    `https://api.twitter.com/1.1/statuses/mentions_timeline.json?${params.toString()}`,
    `https://x.com/i/api/1.1/statuses/mentions_timeline.json?${params.toString()}`,
];

async function testMentionsV1() {
    console.log('Testing v1.1 mentions_timeline...');

    for (const url of endpoints) {
        console.log(`\nEndpoint: ${url}`);
        try {
            const response = await gotScraping({
                url,
                method: 'GET',
                headers: {
                    authorization: `Bearer ${BEARER_TOKEN}`,
                    'x-csrf-token': ct0,
                    'x-guest-token': guestId,
                    'x-twitter-active-user': 'yes',
                    'x-twitter-client-language': 'en',
                    'x-client-uuid': crypto.randomUUID(),
                    'content-type': 'application/json',
                    cookie: cookieHeader,
                    referer: 'https://x.com/notifications',
                    origin: 'https://x.com',
                    'x-twitter-auth-type': 'OAuth2Session',
                },
                responseType: 'buffer',
                headerGeneratorOptions: {
                    browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
                },
                retry: { limit: 0 },
                throwHttpErrors: false,
            });

            const bodyText = response.body ? response.body.toString('utf-8') : '';
            console.log(`Status: ${response.statusCode}, body length: ${bodyText.length}`);
            if (response.statusCode === 200) {
                if (!bodyText) {
                    console.log('Warning: Response body is empty.');
                    continue;
                }
                try {
                    const data = JSON.parse(bodyText);
                    console.log(`Tweets returned: ${Array.isArray(data) ? data.length : 0}`);
                    if (Array.isArray(data) && data.length > 0) {
                        console.log('Sample tweet:', data[0].full_text || data[0].text);
                    }
                } catch (err) {
                    console.error('Failed to parse JSON:', err.message);
                    console.log('Raw body (first 300 chars):', bodyText.substring(0, 300));
                }
            } else {
                console.log('Body:', bodyText.substring(0, 300));
            }
        } catch (error) {
            console.error('Request error:', error.message);
        }
    }
}

testMentionsV1();
