import { gotScraping } from 'got-scraping';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.resolve(__dirname, '.env.scraper');
dotenv.config({ path: envPath });

const QUERY_ID = 'gkjsKepM6gl_HmFWoWKfgg';
const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Cookies setup
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

const variables = {
    rawQuery: '@IdentityPrism',
    count: 20,
    querySource: 'typed_query',
    product: 'Latest',
};

const features = {
    rweb_lists_timeline_redesign_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    longform_notetweets_rich_text_read_enabled: true,
    responsive_web_enhance_cards_enabled: false,
    subscriptions_verification_info_enabled: true,
    subscriptions_verification_info_reason_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    super_follow_badge_privacy_enabled: false,
    super_follow_exclusive_tweet_notifications_enabled: false,
    super_follow_tweet_api_enabled: false,
    super_follow_user_api_enabled: false,
    android_graphql_skip_api_media_color_palette: false,
    creator_subscriptions_subscription_count_enabled: false,
    blue_business_profile_image_shape_enabled: false,
    unified_cards_ad_metadata_container_dynamic_card_content_query_enabled: false,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_media_download_video_enabled: false,
    responsive_web_twitter_article_tweet_consumption_enabled: false,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    interactive_text_enabled: false,
    responsive_web_text_conversations_enabled: false,
    vibe_api_enabled: false,
};

const fieldToggles = {
    withArticleRichContentState: false,
};

async function testVariant(name, url, method, body = null) {
    console.log(`\nTesting ${name}...`);
    console.log(`URL: ${url}`);
    
    try {
        const options = {
            url,
            method,
            headers: {
                ...baseHeaders,
                'x-twitter-auth-type': 'OAuth2Session'
            },
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
            },
            retry: { limit: 0 },
            throwHttpErrors: false,
        };
        
        if (body) {
            options.json = body;
        }

        const response = await gotScraping(options);
        console.log(`Status: ${response.statusCode}`);
        if (response.statusCode === 200) {
            console.log('Success!');
            // console.log(response.body.substring(0, 200));
        } else {
            console.log('Body:', response.body.substring(0, 300));
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

const QUERY_IDS = [
    'gkjsKepM6gl_HmFWoWKfgg', // agent-twitter-client default
    'nK1dw4oV3k4w5TdtcAdSww', // Common alternative
    'MJpyQGqgkhLCVNUibw-i5w', // Another variant
    'lq02A-gEgp3Sj7ngnZ60VQ', 
];

// ... (rest of imports and setup)

async function runTests() {
    const params = new URLSearchParams();
    params.set('variables', JSON.stringify(variables));
    params.set('features', JSON.stringify(features));
    params.set('fieldToggles', JSON.stringify(fieldToggles));
    
    for (const id of QUERY_IDS) {
        console.log(`\n=== Testing QueryID: ${id} ===`);
        
        // Variant 1: GET x.com
        await testVariant(
            'GET x.com/i/api/graphql', 
            `https://x.com/i/api/graphql/${id}/SearchTimeline?${params.toString()}`, 
            'GET'
        );

        // Variant 2: GET api.twitter.com
        // Adjust headers for api.twitter.com
        const originalOrigin = baseHeaders.origin;
        const originalReferer = baseHeaders.referer;
        baseHeaders.origin = 'https://twitter.com';
        baseHeaders.referer = 'https://twitter.com/explore';

        await testVariant(
            'GET api.twitter.com/graphql', 
            `https://api.twitter.com/graphql/${id}/SearchTimeline?${params.toString()}`, 
            'GET'
        );
        
        // Restore headers
        baseHeaders.origin = originalOrigin;
        baseHeaders.referer = originalReferer;
    }
}

runTests();
