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
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'x-client-uuid': crypto.randomUUID(),
    'content-type': 'application/json',
    accept: 'application/json',
    cookie: cookieHeader,
    referer: 'https://x.com/notifications',
    origin: 'https://x.com',
};

const params = new URLSearchParams({
    count: '20',
    include_entities: '1',
    include_user_entities: '1',
    tweet_mode: 'extended',
    include_profile_interstitial_type: '1',
    include_blocking: '1',
    include_blocked_by: '1',
    include_followed_by: '1',
    include_want_retweets: '1',
    include_mute_edge: '1',
    include_can_dm: '1',
    include_can_media_tag: '1',
    include_ext_has_nft_avatar: '1',
    include_ext_is_blue_verified: '1',
    include_ext_verified_type: '1',
    skip_status: '0',
    cards_platform: 'Web-12',
    include_cards: '1',
    include_ext_alt_text: 'true',
    include_ext_limited_action_results: 'false',
    include_quote_count: 'true',
    include_reply_count: '1',
    include_ext_collab_control: 'true',
    include_ext_views: 'true',
    include_entities: 'true',
    include_user_entities: 'true',
    include_ext_media_color: 'true',
    include_ext_media_availability: 'true',
    include_ext_sensitive_media_warning: 'true',
    include_ext_trusted_friends_metadata: 'true',
    send_error_codes: 'true',
    simple_quoted_tweet: 'true',
    include_tweet_replies: 'false',
    ext: 'mediaStats,highlightedLabel,hasNftAvatar,voiceInfo,birdwatchPivot,enrichments,superFollowMetadata,unmentionInfo,editControl,collab_control,vibe'
});

const endpoints = [
    `https://api.twitter.com/2/notifications/mentions.json?${params.toString()}`,
    `https://x.com/i/api/2/notifications/mentions.json?${params.toString()}`,
    `https://api.twitter.com/2/notifications/all.json?${params.toString()}`,
    `https://x.com/i/api/2/notifications/all.json?${params.toString()}`,
];

async function fetchMentionsPage(url) {
    const response = await gotScraping({
        url,
        method: 'GET',
        headers: baseHeaders,
        responseType: 'buffer',
        headerGeneratorOptions: {
            browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
        },
        retry: { limit: 0 },
        throwHttpErrors: false,
    });

    const bodyText = response.body ? response.body.toString('utf-8') : '';
    return { response, bodyText };
}

function extractBottomCursor(data) {
    const instructions = data?.timeline?.instructions || [];
    for (const instruction of instructions) {
        const entries = instruction?.addEntries?.entries || [];
        for (const entry of entries) {
            if (entry?.entryId?.startsWith('cursor-bottom-')) {
                return entry?.content?.operation?.cursor?.value;
            }
        }
    }
    return null;
}

async function testMentionsNotifications() {
    console.log('Testing notifications mentions endpoint...');

    for (const url of endpoints) {
        console.log(`\nEndpoint: ${url}`);
        try {
            const { response, bodyText } = await fetchMentionsPage(url);

            console.log(`Status: ${response.statusCode}, body length: ${bodyText.length}`);
            if (response.statusCode === 200) {
                if (!bodyText) {
                    console.log('Warning: Response body is empty.');
                    continue;
                }
                try {
                    const data = JSON.parse(bodyText);
                    console.log('Top-level keys:', Object.keys(data || {}));
                    const globalTweets = data?.globalObjects?.tweets || {};
                    const globalUsers = data?.globalObjects?.users || {};
                    const botHandle = (process.env.TWITTER_USER_NAME || process.env.TWITTER_USERNAME || 'IdentityPrism')
                        .replace(/^@/, '')
                        .toLowerCase();
                    const timelineEntries = data?.timeline?.instructions || [];
                    console.log(`Found ${Object.keys(globalTweets).length} tweets, ${Object.keys(globalUsers).length} users.`);
                    console.log(`Timeline instructions: ${timelineEntries.length}`);
                    if (timelineEntries.length > 0) {
                        console.log('First instruction keys:', Object.keys(timelineEntries[0] || {}));
                    }

                    const tweetValues = Object.values(globalTweets);
                    if (tweetValues.length > 0) {
                        const samples = tweetValues.slice(0, 3);
                        for (const tweet of samples) {
                            const text = tweet.full_text || tweet.text || '';
                            const mentions = tweet?.entities?.user_mentions || [];
                            const hasMention = mentions.some((m) => (m.screen_name || '').toLowerCase() === botHandle);
                            console.log(`Sample tweet: ${text}`);
                            console.log(`Mentions bot: ${hasMention}`);
                        }
                    }

                    const bottomCursor = extractBottomCursor(data);
                    if (bottomCursor) {
                        const cursorUrl = `${url}&cursor=${encodeURIComponent(bottomCursor)}`;
                        console.log(`Fetching cursor page...`);
                        const { response: cursorResponse, bodyText: cursorBody } = await fetchMentionsPage(cursorUrl);
                        console.log(`Cursor status: ${cursorResponse.statusCode}, body length: ${cursorBody.length}`);
                        if (cursorResponse.statusCode === 200 && cursorBody) {
                            const cursorData = JSON.parse(cursorBody);
                            const cursorTweets = cursorData?.globalObjects?.tweets || {};
                            console.log(`Cursor page tweets: ${Object.keys(cursorTweets).length}`);
                        }
                    }

                    if (Object.keys(globalTweets).length === 0 && bodyText) {
                        console.log('Raw body (first 500 chars):', bodyText.substring(0, 500));
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

testMentionsNotifications();
