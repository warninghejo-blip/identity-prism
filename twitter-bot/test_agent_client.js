const { Scraper, SearchMode } = require('agent-twitter-client');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env.scraper') });

async function testAgentClient() {
    try {
        console.log('Initializing agent-twitter-client Scraper...');
        const scraper = new Scraper();
        
        // Load cookies
        const cookiesPath = path.resolve(__dirname, 'cookies.json');
        if (fs.existsSync(cookiesPath)) {
            const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
            const cookieStrings = cookies.map(c => `${c.name}=${c.value}; Domain=.twitter.com; Path=/; Secure; SameSite=None`);
            await scraper.setCookies(cookieStrings);
            console.log('Cookies loaded.');
        }

        const isLoggedIn = await scraper.isLoggedIn();
        console.log('isLoggedIn:', isLoggedIn);

        if (isLoggedIn) {
            console.log('Testing fetchSearchTweets...');
            const tweets = await scraper.fetchSearchTweets('IdentityPrism', 5, SearchMode.Latest);
            console.log(`Found ${tweets.tweets.length} tweets.`);
            if (tweets.tweets.length > 0) {
                console.log('First tweet:', tweets.tweets[0].text);
            }
        }
    } catch (error) {
        console.error('Agent Client Test Failed:', error);
    }
}

testAgentClient();
