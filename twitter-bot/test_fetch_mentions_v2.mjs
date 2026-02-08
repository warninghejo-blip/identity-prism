import { TwitterClientV2 } from './twitter_client_v2.mjs';

async function run() {
    const client = new TwitterClientV2();
    const result = await client.fetchMentions(20);
    const tweets = result?.tweets || [];
    console.log(`Fetched ${tweets.length} tweets.`);
    if (tweets.length > 0) {
        const walletRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
        for (const tweet of tweets.slice(0, 5)) {
            const matches = tweet.text ? tweet.text.match(walletRegex) : null;
            console.log(`- ${tweet.id}: ${tweet.text}`);
            console.log(`  wallet matches: ${matches ? matches.join(', ') : 'none'}`);
        }
    }
}

run().catch((err) => {
    console.error('fetchMentions error:', err.message);
});
