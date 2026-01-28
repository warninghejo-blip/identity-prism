require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

async function testAuth() {
  console.log('Testing Twitter Authentication...');
  
  const client = new TwitterApi({
    appKey: process.env.TWITTER_APP_KEY,
    appSecret: process.env.TWITTER_APP_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });

  try {
    // Attempt to get the authenticated user's details
    const me = await client.v2.me();
    console.log('Authentication Successful!');
    console.log('User:', me.data);
    
    // Check permissions by trying a read-only action vs write action
    // If this passes, the credentials are valid.
    // If the previous post failed, it might be scope related.
    
  } catch (error) {
    console.error('Authentication Failed:', error);
    if (error.data) {
        console.error('Error Data:', JSON.stringify(error.data, null, 2));
    }
  }
}

testAuth();
