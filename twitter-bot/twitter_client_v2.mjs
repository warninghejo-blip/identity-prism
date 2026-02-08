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
    CreateTweet: 'a1p9RWpkYKBjWv_I3WzS-A',
    SearchTimeline: 'gkjsKepM6gl_HmFWoWKfgg',
};

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class TwitterClientV2 {
    constructor() {
        this.cookies = [];
        this.guestId = process.env.TWITTER_GUEST_TOKEN
            || process.env.TWITTER_GUEST_ID
            || process.env.guest_id
            || process.env.GUEST_ID
            || '177022498227877951';
        this.ct0 = process.env.TWITTER_CT0;
        this.authToken = process.env.TWITTER_AUTH_TOKEN;
        this.cookieHeader = '';
        this.botUsername = (process.env.TWITTER_USER_NAME || process.env.TWITTER_USERNAME || 'IdentityPrism')
            .replace(/^@/, '')
            .toLowerCase();
        
        // Define common features used across endpoints
        this.defaultFeatures = {
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
            rweb_tipjar_consumption_enabled: true,
            communities_web_enable_tweet_community_results_fetch: true,
            creator_subscriptions_quote_tweet_preview_enabled: true,
            articles_preview_enabled: true,
            rweb_video_timestamps_enabled: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
        };

        this.loadCookies();
    }

    loadCookies() {
        const cookiesPath = path.resolve(__dirname, 'cookies.json');
        
        if (fs.existsSync(cookiesPath)) {
            try {
                this.cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
                
                // Filter out __cf_bm and other dynamic cookies if needed
                this.cookieHeader = this.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
                
                const guestTokenCookie = this.cookies.find((c) => c.name === 'gt' || c.name === 'guest_token');
                const guestCookie = this.cookies.find((c) => c.name === 'guest_id');
                if (guestTokenCookie === null || guestTokenCookie === void 0 ? void 0 : guestTokenCookie.value) {
                    this.guestId = guestTokenCookie.value;
                } else if (guestCookie) {
                    const match = decodeURIComponent(guestCookie.value).match(/v1:(\d+)/);
                    if (match) {
                        this.guestId = match[1];
                    } else {
                        this.guestId = guestCookie.value;
                    }
                }
                
                const ct0Cookie = this.cookies.find((c) => c.name === 'ct0');
                if (ct0Cookie) this.ct0 = ct0Cookie.value;

                const authTokenCookie = this.cookies.find((c) => c.name === 'auth_token');
                if (authTokenCookie) this.authToken = authTokenCookie.value;
                
            } catch (e) {
                console.warn('[TwitterClientV2] Failed to read cookies.json:', e.message);
            }
        }

        if (!this.cookieHeader) {
             if (!this.authToken || !this.ct0) {
                 console.warn('[TwitterClientV2] Warning: Missing TWITTER_AUTH_TOKEN or TWITTER_CT0 in env/cookies');
             }
             this.cookieHeader = `auth_token=${this.authToken}; ct0=${this.ct0};`;
        }
    }

    async setCookies(cookieStrings) {
        console.log('[TwitterClientV2] Setting cookies from external source...');
        this.cookies = cookieStrings.map(str => {
            const parts = str.split(';');
            const [name, value] = parts[0].split('=');
            return { name: name.trim(), value: value.trim() };
        });
        
        this.cookieHeader = cookieStrings.join('; ');

        const ct0Cookie = this.cookies.find(c => c.name === 'ct0');
        if (ct0Cookie) this.ct0 = ct0Cookie.value;

        const authCookie = this.cookies.find(c => c.name === 'auth_token');
        if (authCookie) this.authToken = authCookie.value;

        const guestTokenCookie = this.cookies.find((c) => c.name === 'gt' || c.name === 'guest_token');
        const guestCookie = this.cookies.find(c => c.name === 'guest_id');
        if (guestTokenCookie === null || guestTokenCookie === void 0 ? void 0 : guestTokenCookie.value) {
            this.guestId = guestTokenCookie.value;
        } else if (guestCookie) {
            const match = decodeURIComponent(guestCookie.value).match(/v1:(\d+)/);
            this.guestId = match ? match[1] : guestCookie.value;
        }
    }

    async isLoggedIn() {
        return this.cookies.length > 0 && !!this.ct0 && !!this.authToken;
    }

    async login(username, password, email) {
        console.log('[TwitterClientV2] Login called. Relying on loaded cookies/env vars.');
        if (!(await this.isLoggedIn())) {
            console.warn('[TwitterClientV2] No valid cookies found. Login might fail if relying on scraper login flow.');
        }
    }

    async ensureGuestToken() {
        if (this.guestId) return;
        try {
            const response = await fetch('https://api.x.com/1.1/guest/activate.json', {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${BEARER_TOKEN}`,
                    'x-twitter-active-user': 'yes',
                    'x-twitter-client-language': 'en',
                    'user-agent': DEFAULT_USER_AGENT,
                    accept: 'application/json, text/plain, */*',
                },
            });
            const data = await response.json().catch(() => null);
            if (data?.guest_token) {
                this.guestId = String(data.guest_token);
            }
        } catch (error) {
            console.warn('[TwitterClientV2] Failed to fetch guest token:', error?.message || error);
        }
    }

    async request(queryId, endpoint, payload, method = 'POST') {
        await this.ensureGuestToken();
        const url = `https://x.com/i/api/graphql/${queryId}/${endpoint}`;
        
        const baseHeaders = {
            authorization: `Bearer ${BEARER_TOKEN}`,
            'x-csrf-token': this.ct0,
            'x-guest-token': this.guestId,
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'en',
            'x-client-uuid': crypto.randomUUID(),
            'content-type': 'application/json',
            'user-agent': DEFAULT_USER_AGENT,
            accept: 'application/json, text/plain, */*',
            cookie: this.cookieHeader,
            referer: 'https://x.com/compose/tweet',
            origin: 'https://x.com',
        };

        const headerVariants = [baseHeaders];
        if (this.authToken && this.ct0) {
            const noGuestHeaders = { ...baseHeaders };
            delete noGuestHeaders['x-guest-token'];
            headerVariants.push(noGuestHeaders);
        }

        const strategies = [
            { type: 'OAuth2Session' }
        ];

        for (const headers of headerVariants) {
            for (const strategy of strategies) {
                try {
                    const response = await gotScraping({
                        url,
                        method,
                        headers: {
                            ...headers,
                            'x-twitter-auth-type': strategy.type
                        },
                        json: payload,
                        headerGeneratorOptions: {
                            browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
                        },
                        retry: { limit: 0 },
                        throwHttpErrors: false,
                    });

                    if (response.statusCode === 200) {
                        return response.body;
                    }

                    console.warn(`[TwitterClientV2] ${endpoint} failed with ${response.statusCode} (${strategy.type})`);
                    
                    if (![226, 401, 403].includes(response.statusCode)) {
                        return response.body; 
                    }

                } catch (error) {
                    console.error(`[TwitterClientV2] Request error (${strategy.type}):`, error.message);
                }
            }
        }
        
        throw new Error(`[TwitterClientV2] All auth strategies failed for ${endpoint}`);
    }

    async uploadMedia(mediaData, mediaType = 'image/png') {
        await this.ensureGuestToken();
        const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';
        const form = new FormData();
        const blob = mediaData instanceof Buffer
            ? new Blob([mediaData], { type: mediaType })
            : new Blob([mediaData], { type: mediaType });
        const filename = mediaType.startsWith('image/') ? 'image.png' : 'media';
        form.append('media', blob, filename);

        const headers = {
            authorization: `Bearer ${BEARER_TOKEN}`,
            'x-csrf-token': this.ct0,
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'en',
            'x-client-uuid': crypto.randomUUID(),
            'x-twitter-auth-type': 'OAuth2Session',
            'user-agent': DEFAULT_USER_AGENT,
            accept: 'application/json, text/plain, */*',
            origin: 'https://x.com',
            referer: 'https://x.com/compose/tweet',
            cookie: this.cookieHeader,
        };

        if (this.guestId) {
            headers['x-guest-token'] = this.guestId;
        }

        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers,
            body: form,
        });

        const bodyText = await response.text();
        if (!response.ok) {
            throw new Error(`Media upload failed ${response.status}: ${bodyText.slice(0, 200)}`);
        }

        const data = JSON.parse(bodyText);
        if (!data?.media_id_string) {
            throw new Error('Media upload missing media_id_string');
        }
        return data.media_id_string;
    }

    async sendTweet(text, replyToTweetId = undefined, mediaData = undefined) {
        let mediaIds = [];
        if (mediaData && mediaData.length > 0) {
            try {
                for (const entry of mediaData) {
                    if (entry?.mediaId) {
                        mediaIds.push(entry.mediaId);
                        continue;
                    }
                    if (!entry?.data) continue;
                    const uploadedId = await this.uploadMedia(
                        entry.data,
                        entry.mediaType || 'image/png'
                    );
                    mediaIds.push(uploadedId);
                }
            } catch (error) {
                console.warn('[TwitterClientV2] Media upload failed, posting text-only:', error.message || error);
            }
        }

        const variables = {
            tweet_text: text,
            dark_request: false,
            media: { media_entities: [], possibly_sensitive: false },
            semantic_annotation_ids: [],
        };

        if (replyToTweetId) {
            variables.reply = {
                in_reply_to_tweet_id: replyToTweetId,
                exclude_reply_user_ids: []
            };
        }

        if (mediaIds.length > 0) {
            variables.media.media_entities = mediaIds.map((id) => ({
                media_id: id,
                tagged_users: [],
            }));
        }

        const payload = {
            variables,
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

        const result = await this.request(QUERY_IDS.CreateTweet, 'CreateTweet', payload);
        const parsed = typeof result === 'string' ? JSON.parse(result) : result;
        const errors = parsed?.errors || parsed?.data?.create_tweet?.errors;
        if (errors && errors.length > 0) {
            throw new Error(`[TwitterClientV2] CreateTweet error: ${JSON.stringify(errors)}`);
        }
        const createdId = parsed?.data?.create_tweet?.tweet_results?.result?.rest_id;
        return { id: createdId, raw: parsed };
    }

    async sendTweetLegacy(text, replyToTweetId = undefined, mediaData = undefined) {
        await this.ensureGuestToken();
        let mediaIds = [];
        if (mediaData && mediaData.length > 0) {
            try {
                for (const entry of mediaData) {
                    if (entry?.mediaId) {
                        mediaIds.push(entry.mediaId);
                        continue;
                    }
                    if (!entry?.data) continue;
                    const uploadedId = await this.uploadMedia(
                        entry.data,
                        entry.mediaType || 'image/png'
                    );
                    mediaIds.push(uploadedId);
                }
            } catch (error) {
                console.warn('[TwitterClientV2] Legacy media upload failed:', error.message || error);
            }
        }

        const params = new URLSearchParams();
        params.set('status', text);
        params.set('tweet_mode', 'extended');
        if (replyToTweetId) {
            params.set('in_reply_to_status_id', replyToTweetId);
            params.set('auto_populate_reply_metadata', 'true');
        }
        if (mediaIds.length > 0) {
            params.set('media_ids', mediaIds.join(','));
        }

        const baseHeaders = {
            authorization: `Bearer ${BEARER_TOKEN}`,
            'x-csrf-token': this.ct0,
            'x-guest-token': this.guestId,
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'en',
            'x-client-uuid': crypto.randomUUID(),
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': DEFAULT_USER_AGENT,
            accept: 'application/json, text/plain, */*',
            cookie: this.cookieHeader,
            referer: 'https://x.com/compose/tweet',
            origin: 'https://x.com',
        };

        const headerVariants = [baseHeaders];
        if (this.authToken && this.ct0) {
            const noGuestHeaders = { ...baseHeaders };
            delete noGuestHeaders['x-guest-token'];
            headerVariants.push(noGuestHeaders);
        }

        const endpoints = [
            'https://x.com/i/api/1.1/statuses/update.json',
            'https://twitter.com/i/api/1.1/statuses/update.json',
        ];

        const strategies = ['OAuth2Session'];

        for (const url of endpoints) {
            for (const headers of headerVariants) {
                for (const strategy of strategies) {
                    try {
                        const response = await gotScraping({
                            url,
                            method: 'POST',
                            headers: {
                                ...headers,
                                'x-twitter-auth-type': strategy,
                            },
                            body: params.toString(),
                            headerGeneratorOptions: {
                                browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
                            },
                            retry: { limit: 0 },
                            throwHttpErrors: false,
                        });
                        if (response.statusCode === 200) {
                            const body = JSON.parse(response.body);
                            const id = body?.id_str || body?.id;
                            if (id) {
                                return { id: String(id), raw: body };
                            }
                        }
                        console.warn(
                            `[TwitterClientV2] Legacy update failed with ${response.statusCode} (${strategy})`,
                        );
                    } catch (error) {
                        console.warn('[TwitterClientV2] Legacy update error:', error.message || error);
                    }
                }
            }
        }

        return { id: null, raw: null };
    }

    async verifyTweet(tweetId) {
        if (!tweetId) return { ok: false, reason: 'missing_id' };
        await this.ensureGuestToken();
        const baseHeaders = {
            authorization: `Bearer ${BEARER_TOKEN}`,
            'x-csrf-token': this.ct0,
            'x-guest-token': this.guestId,
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'en',
            'x-client-uuid': crypto.randomUUID(),
            'content-type': 'application/json',
            cookie: this.cookieHeader,
            referer: 'https://x.com/home',
            origin: 'https://x.com',
        };

        const headerVariants = [baseHeaders];
        if (this.authToken && this.ct0) {
            const noGuestHeaders = { ...baseHeaders };
            delete noGuestHeaders['x-guest-token'];
            headerVariants.push(noGuestHeaders);
        }

        const endpoints = [
            `https://api.x.com/1.1/statuses/show.json?id=${tweetId}&tweet_mode=extended`,
            `https://x.com/i/api/1.1/statuses/show.json?id=${tweetId}&tweet_mode=extended`,
            `https://twitter.com/i/api/1.1/statuses/show.json?id=${tweetId}&tweet_mode=extended`,
        ];

        const authTypes = ['OAuth2Session', null];

        for (const url of endpoints) {
            for (const base of headerVariants) {
                for (const authType of authTypes) {
                    const headers = authType
                        ? { ...base, 'x-twitter-auth-type': authType }
                        : base;
                try {
                    const response = await gotScraping({
                        url,
                        method: 'GET',
                        headers,
                        headerGeneratorOptions: {
                            browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
                        },
                        retry: { limit: 0 },
                        throwHttpErrors: false,
                    });
                        if (response.statusCode === 200) {
                            const body = JSON.parse(response.body);
                            const id = body?.id_str || body?.id;
                            const screenName =
                                body?.user?.screen_name
                                || body?.core?.user_results?.result?.legacy?.screen_name;
                            if (id) {
                                return { ok: true, id: String(id), url, screenName };
                            }
                        }
                    } catch (error) {
                        console.warn('[TwitterClientV2] verifyTweet error:', error?.message || error);
                    }
                }
            }
        }

        return { ok: false, reason: 'not_found' };
    }

    async searchTweets(query, count = 20, mode = 'Latest') {
        const variables = {
            rawQuery: query,
            count: count,
            querySource: 'typed_query',
            product: mode,
        };

        const features = {
            // Defaults from api.ts
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
            
            // Newly identified missing features from failed tests
            rweb_tipjar_consumption_enabled: true,
            communities_web_enable_tweet_community_results_fetch: true,
            creator_subscriptions_quote_tweet_preview_enabled: true,
            articles_preview_enabled: true,
            rweb_video_timestamps_enabled: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,

            // Search specific overrides
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

        const params = new URLSearchParams();
        params.set('variables', JSON.stringify(variables));
        params.set('features', JSON.stringify(features));
        params.set('fieldToggles', JSON.stringify(fieldToggles));
        
        const urls = [
            `https://x.com/i/api/graphql/${QUERY_IDS.SearchTimeline}/SearchTimeline?${params.toString()}`,
            `https://twitter.com/i/api/graphql/${QUERY_IDS.SearchTimeline}/SearchTimeline?${params.toString()}`,
        ];
        
         const baseHeaders = {
            authorization: `Bearer ${BEARER_TOKEN}`,
            'x-csrf-token': this.ct0,
            'x-guest-token': this.guestId,
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'en',
            'x-client-uuid': crypto.randomUUID(),
            'content-type': 'application/json',
            cookie: this.cookieHeader,
            referer: 'https://x.com/explore',
            origin: 'https://x.com',
        };

        const strategies = [
            { type: 'OAuth2Session' }
        ];

        for (const url of urls) {
            for (const strategy of strategies) {
                try {
                    const response = await gotScraping({
                        url,
                        method: 'GET',
                        headers: {
                            ...baseHeaders,
                            'x-twitter-auth-type': strategy.type
                        },
                        headerGeneratorOptions: {
                            browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
                        },
                        retry: { limit: 0 },
                        throwHttpErrors: false,
                    });

                    if (response.statusCode === 200) {
                        const body = JSON.parse(response.body);
                        return this.normalizeSearchResponse(body);
                    }
                    
                    console.warn(`[TwitterClientV2] SearchTimeline failed with ${response.statusCode} (${strategy.type})`);
                    
                } catch (error) {
                    console.error(`[TwitterClientV2] Search request error (${strategy.type}):`, error.message);
                }
            }
        }
        
        return { tweets: [] };
    }

    async fetchMentions(count = 20) {
        const safeCount = Number.isFinite(Number(count)) ? Math.max(1, Number(count)) : 20;
        const params = new URLSearchParams({
            count: String(safeCount),
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
            include_ext_media_color: 'true',
            include_ext_media_availability: 'true',
            include_ext_sensitive_media_warning: 'true',
            include_ext_trusted_friends_metadata: 'true',
            send_error_codes: 'true',
            simple_quoted_tweet: 'true',
            include_tweet_replies: 'false',
            ext: 'mediaStats,highlightedLabel,hasNftAvatar,voiceInfo,birdwatchPivot,enrichments,superFollowMetadata,unmentionInfo,editControl,collab_control,vibe',
        });

        const endpoints = [
            {
                url: `https://api.twitter.com/2/notifications/mentions.json?${params.toString()}`,
                requireMention: false,
            },
            {
                url: `https://x.com/i/api/2/notifications/mentions.json?${params.toString()}`,
                requireMention: false,
            },
            {
                url: `https://api.twitter.com/2/notifications/all.json?${params.toString()}`,
                requireMention: false,
            },
            {
                url: `https://x.com/i/api/2/notifications/all.json?${params.toString()}`,
                requireMention: false,
            },
        ];

        const baseHeaders = {
            authorization: `Bearer ${BEARER_TOKEN}`,
            'x-csrf-token': this.ct0,
            'x-guest-token': this.guestId,
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'en',
            'x-client-uuid': crypto.randomUUID(),
            'content-type': 'application/json',
            cookie: this.cookieHeader,
        };

        const noGuestHeaders = { ...baseHeaders };
        delete noGuestHeaders['x-guest-token'];

        const headerVariants = [
            {
                ...baseHeaders,
                referer: 'https://x.com/notifications',
                origin: 'https://x.com',
                'x-twitter-auth-type': 'OAuth2Session',
            },
            {
                ...noGuestHeaders,
                referer: 'https://x.com/notifications',
                origin: 'https://x.com',
                'x-twitter-auth-type': 'OAuth2Session',
            },
            {
                ...baseHeaders,
                referer: 'https://twitter.com/notifications',
                origin: 'https://twitter.com',
                'x-twitter-auth-type': 'OAuth2Session',
            },
            {
                ...baseHeaders,
                referer: 'https://twitter.com/notifications',
                origin: 'https://twitter.com',
            },
        ];

        for (const endpoint of endpoints) {
            for (const headers of headerVariants) {
                try {
                    const response = await gotScraping({
                        url: endpoint.url,
                        method: 'GET',
                        headers,
                        headerGeneratorOptions: {
                            browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
                        },
                        retry: { limit: 0 },
                        throwHttpErrors: false,
                    });

                    if (response.statusCode !== 200) {
                        console.warn(`[TwitterClientV2] Mentions failed with ${response.statusCode} (${endpoint.url})`);
                        continue;
                    }

                    const body = typeof response.body === 'string'
                        ? response.body
                        : response.body?.toString?.('utf-8') || '';
                    if (!body) {
                        continue;
                    }

                    const data = JSON.parse(body);
                    const normalized = this.normalizeMentionsResponse(data, {
                        requireMention: endpoint.requireMention,
                        mentionHandle: this.botUsername,
                    });
                    if (normalized.tweets.length > 0) {
                        return normalized;
                    }
                } catch (error) {
                    console.error('[TwitterClientV2] Mentions request error:', error.message);
                }
            }
        }

        return { tweets: [] };
    }

    // Alias for agent-twitter-client compatibility
    async fetchSearchTweets(query, maxTweets, searchMode) {
        let mode = 'Latest';
        // Handle agent-twitter-client enum values or strings
        if (searchMode === 1 || searchMode === 'Latest') mode = 'Latest';
        if (searchMode === 0 || searchMode === 'Top') mode = 'Top';
        if (searchMode === 2 || searchMode === 'Photos') mode = 'Photos';
        if (searchMode === 3 || searchMode === 'Videos') mode = 'Videos';
        if (searchMode === 4 || searchMode === 'Users') mode = 'People';
        
        return this.searchTweets(query, maxTweets, mode);
    }

    normalizeSearchResponse(response) {
        const tweets = [];
        try {
            const instructions = response?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
            
            for (const instruction of instructions) {
                if (instruction.type === 'TimelineAddEntries') {
                    for (const entry of instruction.entries) {
                        if (entry.entryId.startsWith('tweet-')) {
                            const result = entry.content?.itemContent?.tweet_results?.result;
                            if (result) {
                                const legacy = result.legacy;
                                const user = result.core?.user_results?.result?.legacy;
                                if (legacy && user) {
                                    tweets.push({
                                        id: legacy.id_str,
                                        text: legacy.full_text,
                                        username: user.screen_name,
                                        timestamp: new Date(legacy.created_at).getTime(),
                                        raw: result
                                    });
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[TwitterClientV2] Error parsing search response:', e);
        }
        return { tweets };
    }

    normalizeMentionsResponse(response, options = {}) {
        const tweets = [];
        try {
            const tweetsMap = response?.globalObjects?.tweets || {};
            const usersMap = response?.globalObjects?.users || {};
            const mentionHandle = options.mentionHandle ? String(options.mentionHandle).toLowerCase() : null;
            const requireMention = Boolean(options.requireMention && mentionHandle);
            const mentionRegex = mentionHandle
                ? new RegExp(`@${mentionHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
                : null;

            for (const tweet of Object.values(tweetsMap)) {
                const mentions = tweet?.entities?.user_mentions || [];
                const text = tweet.full_text || tweet.text || '';
                const entityMention = mentionHandle
                    ? mentions.some((m) => (m.screen_name || '').toLowerCase() === mentionHandle)
                    : true;
                const textMention = mentionRegex ? mentionRegex.test(text) : true;
                const hasMention = mentionHandle ? entityMention || textMention : true;
                if (requireMention && !hasMention) {
                    continue;
                }

                const user = usersMap[tweet.user_id_str || tweet.user_id] || {};
                const createdAt = tweet.created_at ? Date.parse(tweet.created_at) : 0;
                tweets.push({
                    id: tweet.id_str || tweet.id,
                    text,
                    username: user.screen_name,
                    timestamp: createdAt || 0,
                    raw: tweet,
                });
            }

            tweets.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        } catch (error) {
            console.error('[TwitterClientV2] Error parsing mentions response:', error.message);
        }
        return { tweets };
    }
}
