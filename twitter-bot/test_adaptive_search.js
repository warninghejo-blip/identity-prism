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
    'accept': 'application/json',
    cookie: cookieHeader,
    referer: 'https://x.com/explore',
    origin: 'https://x.com',
};

async function testAdaptiveSearch() {
    console.log('Testing adaptive search endpoint...');

    const params = new URLSearchParams({
        q: '@IdentityPrism',
        count: '20',
        query_source: 'typed_query',
        pc: '1',
        spelling_corrections: '1',
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
        skip_status: '1',
        cards_platform: 'Web-12',
        include_cards: '1',
        include_ext_alt_text: 'true',
        include_ext_limited_action_results: 'false',
        include_quote_count: 'true',
        include_reply_count: '1',
        tweet_mode: 'extended',
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

    const url = `https://api.twitter.com/2/search/adaptive.json?${params.toString()}`;

    try {
        const response = await gotScraping({
            url,
            method: 'GET',
            headers: baseHeaders,
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
            },
            retry: { limit: 0 },
            throwHttpErrors: false,
        });

        console.log(`Status: ${response.statusCode}`);
        if (response.statusCode === 200) {
            if (!response.body) {
                console.log('Warning: Response body is empty.');
                return;
            }
            try {
                const data = JSON.parse(response.body);
                const tweets = data?.globalObjects?.tweets || {};
                const firstTweet = Object.values(tweets)[0];
                console.log(`Found ${Object.keys(tweets).length} tweets.`);
                if (firstTweet) {
                    console.log('Sample tweet:', firstTweet.full_text || firstTweet.text);
                }
            } catch (err) {
                console.error('Failed to parse JSON:', err.message);
                console.log('Raw body (first 500 chars):', response.body.substring(0, 500));
            }
        } else {
            console.log('Adaptive search failed:', response.statusCode);
            console.log('Body:', response.body.substring(0, 300));
        }
    } catch (error) {
        console.error('Adaptive search error:', error.message);
    }
}

testAdaptiveSearch();
