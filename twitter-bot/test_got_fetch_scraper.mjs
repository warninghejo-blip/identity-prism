import { Scraper, SearchMode } from 'agent-twitter-client';
import { gotFetch } from './got_fetch.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env.scraper') });

async function testGotFetchScraper() {
    try {
        console.log('Initializing Scraper with gotFetch...');
        const scraper = new Scraper({
            fetch: gotFetch
        });

        // Load cookies for twitter.com domain
        const cookiesPath = path.resolve(__dirname, 'cookies.json');
        if (fs.existsSync(cookiesPath)) {
            const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
            const cookieStrings = cookies.map(c => `${c.name}=${c.value}; Domain=.twitter.com; Path=/; Secure; SameSite=None`);
            
            await scraper.setCookies(cookieStrings);
            console.log(`Loaded ${cookies.length} cookies for domain: .twitter.com`);
        }

        console.log('Checking login status (via gotFetch)...');
        const loggedIn = await scraper.isLoggedIn();
        console.log('isLoggedIn:', loggedIn);

        if (loggedIn) {
            console.log('Testing search (via gotFetch)...');
            const searchResults = await scraper.fetchSearchTweets('solana', 5, SearchMode.Latest);
            console.log(`Found ${searchResults.tweets.length} tweets.`);
            if (searchResults.tweets.length > 0) {
                console.log('Sample tweet:', searchResults.tweets[0].text);
            }
        } else {
            console.warn('Scraper not logged in. Search test may fail or return guest results.');
            // Try guest search anyway
            try {
                const searchResults = await scraper.fetchSearchTweets('solana', 2, SearchMode.Top);
                 console.log(`Guest Search Results: ${searchResults.tweets.length} tweets.`);
            } catch (e) {
                console.warn('Guest search failed:', e.message);
            }
        }

    } catch (error) {
        console.error('Test failed:', error);
    }
}

testGotFetchScraper();
