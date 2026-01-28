require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

async function testPost() {
  console.log('Testing Twitter Post (Write Access)...');
  
  const client = new TwitterApi({
    appKey: process.env.TWITTER_APP_KEY,
    appSecret: process.env.TWITTER_APP_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });

  try {
    const timestamp = new Date().toISOString();
    const text = `Test tweet from Identity Prism Bot at ${timestamp}`;
    
    // Try to post
    const result = await client.v2.tweet(text);
    console.log('Post Successful!');
    console.log('Tweet ID:', result.data.id);
    
  } catch (error) {
    console.error('Post Failed:', error);
    if (error.data) {
        console.error('Error Data:', JSON.stringify(error.data, null, 2));
    }
  }
}

testPost();
