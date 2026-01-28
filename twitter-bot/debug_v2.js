require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

const TOKENS_PATH = path.join(__dirname, 'oauth2_tokens.json');

async function debugAuth() {
    console.log('--- Twitter OAuth2 Debug ---');
    
    if (!fs.existsSync(TOKENS_PATH)) {
        console.error('ERROR: oauth2_tokens.json not found!');
        return;
    }

    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
    const client = new TwitterApi(tokens.accessToken);

    try {
        console.log('Testing v2/me (User Profile)...');
        const me = await client.v2.me();
        console.log('SUCCESS!');
        console.log(`Account: @${me.data.username}`);
        console.log(`Account ID: ${me.data.id}`);
        
        console.log('\nTesting v2/tweets (Text-only Post)...');
        const testTweet = await client.v2.tweet(`Identity Prism Bot Test - ${new Date().toISOString()}`);
        console.log('SUCCESS! Tweet ID:', testTweet.data.id);
        
    } catch (error) {
        console.error('\n--- API ERROR ---');
        console.error(`Status: ${error.code}`);
        console.error(`Title: ${error.data?.title}`);
        console.error(`Detail: ${error.data?.detail}`);
        if (error.data?.type) console.error(`Type: ${error.data.type}`);
        console.log('\nFull Error Data:', JSON.stringify(error.data, null, 2));
    }
}

debugAuth();
