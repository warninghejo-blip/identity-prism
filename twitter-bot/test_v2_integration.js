const { SearchMode } = require('agent-twitter-client');

async function testIntegration() {
    try {
        console.log('Testing import of twitter_client_v2.mjs...');
        const { TwitterClientV2 } = await import('./twitter_client_v2.mjs');
        
        console.log('Initializing client...');
        const client = new TwitterClientV2();
        
        console.log('Checking login status...');
        const isLoggedIn = await client.isLoggedIn();
        console.log('isLoggedIn:', isLoggedIn);
        
        if (isLoggedIn) {
            console.log('Testing searchTweets alias...');
            // Test compatibility with agent-twitter-client SearchMode
            // SearchMode.Latest is 1
            const results = await client.fetchSearchTweets('IdentityPrism', 5, SearchMode.Latest);
            console.log(`Found ${results.tweets.length} tweets.`);
            if (results.tweets.length > 0) {
                console.log('First tweet:', results.tweets[0].text);
            }
        } else {
            console.log('Skipping search test (not logged in/no cookies)');
        }
        
    } catch (error) {
        console.error('Integration test failed:', error);
    }
}

testIntegration();
