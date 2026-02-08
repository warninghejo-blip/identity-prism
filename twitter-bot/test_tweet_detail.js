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
const TWEET_ID = '2019143055471939812';
const QUERY_ID = 'xOhkmRac04YFZmOzU9PJHg';

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

const variables = {
    focalTweetId: TWEET_ID,
    with_rux_injections: false,
    includePromotedContent: true,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
    withV2Timeline: true,
};

const features = {
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
    responsive_web_twitter_article_tweet_consumption_enabled: false,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_media_download_video_enabled: false,
    responsive_web_enhance_cards_enabled: false,
};

const fieldToggles = {
    withArticleRichContentState: false,
};

const params = new URLSearchParams();
params.set('variables', JSON.stringify(variables));
params.set('features', JSON.stringify(features));
params.set('fieldToggles', JSON.stringify(fieldToggles));

const url = `https://x.com/i/api/graphql/${QUERY_ID}/TweetDetail?${params.toString()}`;

async function testTweetDetail() {
    console.log(`Testing TweetDetail for ${TWEET_ID}...`);

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
                referer: `https://x.com/PolyFantasys/status/${TWEET_ID}`,
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
        if (!bodyText) {
            console.log('Empty body.');
            return;
        }

        const data = JSON.parse(bodyText);
        const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];
        const entries = instructions
            .flatMap((instruction) => instruction?.entries || [])
            .filter(Boolean);
        const focalEntry = entries.find((entry) => entry?.entryId?.startsWith('tweet-'));
        const result =
            focalEntry?.content?.itemContent?.tweet_results?.result ||
            focalEntry?.content?.itemContent?.tweet_results?.result?.tweet ||
            null;
        const legacy = result?.legacy || result?.tweet?.legacy;
        const text = legacy?.full_text || legacy?.text || '';
        const mentions = legacy?.entities?.user_mentions || [];

        console.log(`Tweet text: ${text}`);
        console.log(`Mentions in tweet: ${mentions.map((m) => `@${m.screen_name}`).join(', ') || 'none'}`);
    } catch (error) {
        console.error('TweetDetail error:', error.message);
    }
}

testTweetDetail();
