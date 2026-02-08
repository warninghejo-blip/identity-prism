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

const QUERY_IDS = {
    UserByScreenName: 'G3KGOASz96M-Qu0nwmGXNg',
    UserTweets: 'E3opETHurmVJflFsUBVuUQ',
    SearchTimeline: 'gkjsKepM6gl_HmFWoWKfgg'
};

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

async function testGet(name, url) {
    console.log(`\nTesting ${name}...`);
    // console.log(`URL: ${url}`);
    
    try {
        const response = await gotScraping({
            url,
            method: 'GET',
            headers: {
                ...baseHeaders,
                'x-twitter-auth-type': 'OAuth2Session'
            },
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
            },
            retry: { limit: 0 },
            throwHttpErrors: false,
        });

        console.log(`Status: ${response.statusCode}`);
        if (response.statusCode === 200) {
            console.log('Success!');
            // console.log('Body Preview:', response.body.substring(0, 200));
            return JSON.parse(response.body);
        } else {
            console.log('Body:', response.body.substring(0, 300));
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
    return null;
}

async function runReadTests() {
    // Test 1: UserByScreenName
    const userVariables = {
        screen_name: 'solana',
        withSafetyModeUserFields: true,
    };
    const userFeatures = {
        hidden_profile_likes_enabled: false,
        hidden_profile_subscriptions_enabled: false,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        subscriptions_verification_info_is_identity_verified_enabled: false,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
    };

    const userParams = new URLSearchParams();
    userParams.set('variables', JSON.stringify(userVariables));
    userParams.set('features', JSON.stringify(userFeatures));

    const userResponse = await testGet(
        'UserByScreenName (x.com)',
        `https://x.com/i/api/graphql/${QUERY_IDS.UserByScreenName}/UserByScreenName?${userParams.toString()}`
    );

    if (userResponse && userResponse.data && userResponse.data.user && userResponse.data.user.result) {
        const userId = userResponse.data.user.result.rest_id;
        console.log('Found User ID:', userId);

        // Test 2: UserTweets
        const tweetsVariables = {
            userId: userId,
            count: 20,
            includePromotedContent: false,
            withQuickPromoteEligibilityTweetFields: true,
            withVoice: true,
            withV2Timeline: true,
        };
        const tweetsFeatures = {
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
            // Newly added
            rweb_tipjar_consumption_enabled: true,
            communities_web_enable_tweet_community_results_fetch: true,
            creator_subscriptions_quote_tweet_preview_enabled: true,
            articles_preview_enabled: true,
            rweb_video_timestamps_enabled: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
        };

        const tweetsParams = new URLSearchParams();
        tweetsParams.set('variables', JSON.stringify(tweetsVariables));
        tweetsParams.set('features', JSON.stringify(tweetsFeatures));

        await testGet(
            'UserTweets (x.com)',
            `https://x.com/i/api/graphql/${QUERY_IDS.UserTweets}/UserTweets?${tweetsParams.toString()}`
        );
    }
}

runReadTests();
