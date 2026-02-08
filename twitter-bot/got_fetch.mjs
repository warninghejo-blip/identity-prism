import { gotScraping } from 'got-scraping';
import { Headers } from 'headers-polyfill';

const WORKING_BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/**
 * A fetch-compatible wrapper for got-scraping to be used with agent-twitter-client
 */
export async function gotFetch(url, init = {}) {
    try {
        const method = init.method || 'GET';
        const headers = {};
        
        // Convert Headers object to plain object
        if (init.headers) {
            if (typeof init.headers.forEach === 'function') {
                init.headers.forEach((value, key) => {
                    headers[key.toLowerCase()] = value;
                });
            } else if (init.headers instanceof Object) {
                for (const [key, value] of Object.entries(init.headers)) {
                    headers[key.toLowerCase()] = value;
                }
            }
        }

        let urlString = url.toString();
        
        // Rewrite GraphQL domain to match what's working in tls_agent.mjs
        if (urlString.includes('api.twitter.com/graphql/')) {
            urlString = urlString.replace('api.twitter.com/graphql/', 'x.com/i/api/graphql/');
        }

        const isTwitterApi = urlString.includes('twitter.com') || urlString.includes('x.com');
        const isGraphQl = urlString.includes('/graphql/');
        const isV1 = urlString.includes('/1.1/');
        
        const requestHeaders = {};
        if (headers) {
            for (const [key, value] of Object.entries(headers)) {
                if (key.startsWith(':')) continue;
                requestHeaders[key.toLowerCase()] = value;
            }
        }

        // Inject working headers for Twitter API
        if (isTwitterApi) {
            // Force the proven bearer token for ALL Twitter API calls
            // This token is known to work with the user's current session/cookies
            requestHeaders['authorization'] = `Bearer ${WORKING_BEARER_TOKEN}`;

            // Basic browser-like headers if missing
            if (isGraphQl) {
                if (!requestHeaders['x-twitter-auth-type']) {
                    requestHeaders['x-twitter-auth-type'] = 'OAuth2Session';
                }
            }
            
            if (!requestHeaders['x-twitter-active-user']) {
                requestHeaders['x-twitter-active-user'] = 'yes';
            }
            if (!requestHeaders['x-twitter-client-language']) {
                requestHeaders['x-twitter-client-language'] = 'en';
            }
            
            // Extract guest_id from cookie if x-guest-token is missing
            if (!requestHeaders['x-guest-token'] && requestHeaders['cookie']) {
                const match = requestHeaders['cookie'].match(/guest_id=([^;]+)/);
                if (match) {
                    const guestId = decodeURIComponent(match[1]);
                    const numericMatch = guestId.match(/v1:(\d+)/);
                    requestHeaders['x-guest-token'] = numericMatch ? numericMatch[1] : guestId;
                }
            }

            // Ensure CSRF token is present in headers if in cookies
            if (!requestHeaders['x-csrf-token'] && requestHeaders['cookie']) {
                const match = requestHeaders['cookie'].match(/ct0=([^;]+)/);
                if (match) {
                    requestHeaders['x-csrf-token'] = match[1];
                }
            }
        }

        if (isTwitterApi && !urlString.includes('verify_credentials')) {
            // console.log(`[gotFetch] ${method} ${urlString}`);
        }

        // got-scraping specific options
        const gotOptions = {
            url: urlString,
            method,
            headers: requestHeaders,
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
        };

        if (init.body) {
            gotOptions.body = init.body;
        }

        const response = await gotScraping(gotOptions);
        
        if (response.statusCode !== 200 && isTwitterApi) {
            console.warn(`[gotFetch] Twitter API Error: ${response.statusCode} for ${urlString.split('?')[0]}`);
            if (response.statusCode === 401 || response.statusCode === 403 || response.statusCode === 404) {
                try {
                    const errorBody = JSON.parse(response.body);
                    console.warn(`[gotFetch] Error Body:`, JSON.stringify(errorBody, null, 2));
                } catch (e) {
                    console.warn(`[gotFetch] Raw Error Body (first 100 chars): ${response.body.substring(0, 100)}`);
                }
            }
        }
        
        // Convert got headers (which might be arrays) to strings for Headers polyfill
        const responseHeaders = {};
        if (response.headers) {
            for (const [key, value] of Object.entries(response.headers)) {
                if (value !== undefined) {
                    // Only include standard header names (alpha-numeric and hyphens)
                    // This avoids issues with pseudo-headers or malformed headers that headers-polyfill rejects
                    if (/^[a-zA-Z0-9-]+$/.test(key)) {
                        responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value);
                    }
                }
            }
        }

        return {
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            statusText: response.statusMessage,
            headers: new Headers(responseHeaders),
            json: async () => JSON.parse(response.body),
            text: async () => response.body,
            body: response.body,
        };
    } catch (error) {
        console.error('[gotFetch] Fatal Error:', error.message, error.stack);
        throw error;
    }
}
