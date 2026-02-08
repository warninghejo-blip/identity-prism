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

const QUERY_ID = 'a1p9RWpkYKBjWv_I3WzS-A'; // CreateTweet Operation ID
const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

async function sendTweet(text) {
  const cookiesPath = path.resolve(__dirname, 'cookies.json');
  let cookieHeader = '';
  let guestId = process.env.guest_id;
  let ct0 = process.env.TWITTER_CT0;

  if (fs.existsSync(cookiesPath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
      cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const guestCookie = cookies.find((c) => c.name === 'guest_id');
      if (guestCookie) {
        // Extract numeric part from v1%3A1234567890 or v1:1234567890
        const match = decodeURIComponent(guestCookie.value).match(/v1:(\d+)/);
        if (match) {
          guestId = match[1];
        } else {
          guestId = guestCookie.value;
        }
      }
      const ct0Cookie = cookies.find((c) => c.name === 'ct0');
      if (ct0Cookie) ct0 = ct0Cookie.value;
    } catch (e) {
      console.warn('Failed to read cookies.json:', e.message);
    }
  }

  if (!cookieHeader) {
    const authToken = process.env.TWITTER_AUTH_TOKEN;
    ct0 = process.env.TWITTER_CT0;

    if (!authToken || !ct0) {
      console.error('Error: Missing TWITTER_AUTH_TOKEN or TWITTER_CT0 in .env.scraper');
      process.exit(1);
    }

    cookieHeader = `auth_token=${authToken}; ct0=${ct0};`;
  }

  // Fallback if not found in cookies (use numeric part)
  if (!guestId) guestId = '177022498227877951';

  console.log('--- Debug Info ---');
  console.log('Guest ID:', guestId);
  console.log('CT0:', ct0 ? ct0.substring(0, 10) + '...' : 'Missing');
  console.log('Cookie Header Length:', cookieHeader.length);
  console.log('------------------');

  const url = `https://x.com/i/api/graphql/${QUERY_ID}/CreateTweet`;

  const payload = {
    variables: {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    },
    features: {
      interactive_text_enabled: true,
      longform_notetweets_inline_media_enabled: false,
      responsive_web_text_conversations_enabled: false,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
      vibe_api_enabled: false,
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
      rweb_video_timestamps_enabled: false,
      c9s_tweet_anatomy_moderator_badge_enabled: false,
      responsive_web_twitter_article_tweet_consumption_enabled: false,
    },
    fieldToggles: {},
  };

  try {
    console.log(`Sending tweet: "${text}"`);
    console.log(`Target URL: ${url}`);

    // Try with OAuth2Session first (Browser-like)
    let response = await gotScraping({
      url,
      method: 'POST',
      headers: {
        authorization: `Bearer ${BEARER_TOKEN}`,
        'x-csrf-token': ct0,
        'x-guest-token': guestId,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en',
        'x-client-uuid': crypto.randomUUID(),
        'content-type': 'application/json',
        cookie: cookieHeader,
        referer: 'https://x.com/compose/tweet',
        origin: 'https://x.com',
      },
      json: payload,
      headerGeneratorOptions: {
        browsers: [
          {
            name: 'chrome',
            minVersion: 120,
            maxVersion: 124,
          },
        ],
      },
      retry: {
        limit: 0,
      },
      throwHttpErrors: false, 
    });

    console.log('Response Status:', response.statusCode);
    
    if (response.statusCode === 226 || response.statusCode === 401 || response.statusCode === 403) {
         console.warn(`Got ${response.statusCode}, retrying with OAuth2Client...`);
         
         // Retry with OAuth2Client (mimicking agent-twitter-client)
         response = await gotScraping({
            url,
            method: 'POST',
            headers: {
              authorization: `Bearer ${BEARER_TOKEN}`,
              'x-csrf-token': ct0,
              'x-guest-token': guestId,
              'x-twitter-auth-type': 'OAuth2Client', // Changed to OAuth2Client
              'x-twitter-active-user': 'yes',
              'x-twitter-client-language': 'en',
              'content-type': 'application/json',
              cookie: cookieHeader,
              // 'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Nokia G20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.88 Mobile Safari/537.36', // Optional: match mobile UA
            },
            json: payload,
             headerGeneratorOptions: {
                browsers: [
                  {
                    name: 'chrome',
                    minVersion: 120,
                    maxVersion: 124,
                  },
                ],
             },
            retry: {
              limit: 0,
            },
            throwHttpErrors: false,
         });
         console.log('Retry Response Status:', response.statusCode);
    }

    console.log('Response Body:', response.body);
  } catch (error) {
    if (error.response) {
      console.error('Request Failed:', error.response.statusCode);
      console.error('Response Body:', error.response.body);
    } else {
      console.error('Error:', error.message);
    }
  }
}

const tweetText = process.argv[2];
if (!tweetText) {
  console.log('Usage: node tls_agent.js "Your tweet text here"');
  process.exit(1);
}

sendTweet(tweetText);
