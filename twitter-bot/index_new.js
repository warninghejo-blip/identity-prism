require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');
const path = require('path');

// Configuration
const CONFIG = {
  // Post every 4 hours at 7 minutes past the hour to avoid conflicts
  cronSchedule: '7 */4 * * *', 
  projectId: 'identity-prism',
  // Use the verified working model
  geminiModel: process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash',
  dryRun: false 
};

// Helper to safely trim env vars
const getEnv = (key) => (process.env[key] || '').trim();

// Initialize Twitter Client with trimmed keys
const twitterClient = new TwitterApi({
  appKey: getEnv('TWITTER_APP_KEY'),
  appSecret: getEnv('TWITTER_APP_SECRET'),
  accessToken: getEnv('TWITTER_ACCESS_TOKEN'),
  accessSecret: getEnv('TWITTER_ACCESS_SECRET'),
});

// Initialize Gemini
const genAI = new GoogleGenerativeAI(getEnv('GEMINI_API_KEY'));
const model = genAI.getGenerativeModel({ model: CONFIG.geminiModel });

// Context for the AI
const PROJECT_CONTEXT = `
You are the official Twitter bot for "Identity Prism", a new project on the Solana blockchain built specifically for the Solana Seeker smartphone.

About Identity Prism:
- It creates a "living Solana identity card" built from a user's on-chain footprint.
- It analyzes wallet history to assign traits, scores, and tiers.
- Traits include: Seeker, Preorder, Combo, Blue Chip, Meme Lord, DeFi King, Hyperactive, Diamond Hands.
- It visualizes stats like: Token count, NFT count, Transaction count, SOL Balance, Wallet Age.
- It's a visual, shareable "flex" of your on-chain reputation.

Goal:
- Generate hype and interest in the project.
- Attract Solana users and Seeker owners.
- Encourage people to follow for updates.
- Tag @solana in relevant contexts.
- Be engaging, slightly "degen" (crypto slang aware) but professional and futuristic.
- Use emojis.
- Keep tweets under 280 characters.

Instructions:
- Write a single engaging tweet.
- Occasionally ask a question to drive engagement (e.g., "What's your on-chain score?").
- Use hashtags like #Solana #IdentityPrism #SolanaSeeker #Web3 #Airdrop (occasionally).
- MENTION @solana in about 50% of tweets.
`;

async function verifyCredentials() {
  try {
    const me = await twitterClient.v2.me();
    console.log(`Authenticated as: @${me.data.username}`);
    return true;
  } catch (error) {
    console.error('Authentication check failed:', error.message);
    if (error.code === 401) {
      console.error('ERROR: 401 Unauthorized. Please check your Access Token and Secret permissions.');
      console.error('Ensure you generated the tokens AFTER setting "Read and Write" permissions in the Twitter Developer Portal.');
    }
    return false;
  }
}

async function generateTweet() {
  try {
    const prompt = `${PROJECT_CONTEXT}\n\nTask: Write a fresh, engaging tweet about Identity Prism. Do not repeat previous tweets exactly. Make it sound exciting about the launch coming soon for Solana Seeker users.`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text().trim();
    
    // Cleanup
    text = text.replace(/^"|"$/g, '');
    
    // Length check
    if (text.length > 280) {
      text = text.substring(0, 277) + '...';
    }
    
    return text;
  } catch (error) {
    console.error('Error generating tweet:', error);
    return null;
  }
}

async function postTweet() {
  console.log(`[${new Date().toISOString()}] Starting tweet process...`);
  
  try {
    const tweetText = await generateTweet();
    
    if (!tweetText) {
      console.log('Failed to generate tweet text.');
      return;
    }

    console.log(`Generated Tweet: ${tweetText}`);

    if (!CONFIG.dryRun) {
      const { data: createdTweet } = await twitterClient.v2.tweet(tweetText);
      console.log('Tweet posted successfully!', createdTweet.id);
    } else {
      console.log('Dry run mode: Tweet not posted.');
    }
    
  } catch (error) {
    console.error('Error posting tweet:', error);
  }
}

// Main execution
(async () => {
  console.log('Identity Prism Twitter Bot Starting...');
  console.log(`Model: ${CONFIG.geminiModel}`);
  console.log(`Schedule: ${CONFIG.cronSchedule}`);

  // Check auth on start
  const isAuthenticated = await verifyCredentials();
  if (!isAuthenticated && !CONFIG.dryRun) {
    console.warn('WARNING: Twitter authentication failed. Bot will continue running but posts may fail.');
  }

  // Attempt one post immediately if argument is provided
  if (process.argv.includes('--post-now')) {
    await postTweet();
  }

  // Schedule
  cron.schedule(CONFIG.cronSchedule, () => {
    // Add a small random delay (0-15 mins) to avoid robotic timing
    const delay = Math.floor(Math.random() * 1000 * 60 * 15); 
    console.log(`Scheduled task triggered. Waiting ${Math.round(delay/1000)}s before posting...`);
    setTimeout(postTweet, delay);
  });
  
  console.log('Bot is running. Press Ctrl+C to stop.');
})();
