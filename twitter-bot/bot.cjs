const { TwitterApi } = require('twitter-api-v2');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');
require('dotenv').config();

// Configuration
const CONFIG = {
  // Post every 4 hours between 8 AM and 10 PM
  cronSchedule: '0 */4 8-22 * * *', 
  solanaTags: ['@solana', '@solanamobile', '@IdentityPrism'],
  hashtags: ['#Solana', '#Seeker', '#IdentityPrism', '#SolanaMobile', '#Web3'],
  modelName: 'gemini-1.5-flash', // Using stable flash model
};

// Initialize Clients
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: CONFIG.modelName });

// Context for the AI
const PROJECT_CONTEXT = `
You are a social media manager for "Identity Prism", a Solana-based application designed specifically for the Solana Seeker smartphone.
Identity Prism creates a "living identity card" based on a user's on-chain footprint/activity.
Key features:
- Generates a visual "Prism" card based on wallet history.
- Tiers based on activity: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune, Sun, Binary Sun.
- Stats tracked: Transaction count, wallet age, NFT count, token count, diamond hands status, etc.
- It's a "Celestial Identity" for Solana users.

Goal:
- Build hype for the project launch.
- Engage the Solana community.
- Specifically mention the Solana Seeker smartphone synergy.
- Be mysterious but exciting.
- Use crypto-native language (GM, wagmi, degen, etc.) but keep it professional enough for a product launch.
`;

async function generateTweet() {
  try {
    const prompt = `
      ${PROJECT_CONTEXT}
      
      Write a single engaging tweet (max 260 characters) to promote Identity Prism.
      Focus on ONE of the following angles (pick randomly):
      1. The synergy with Solana Seeker mobile.
      2. Your on-chain history defining your digital soul.
      3. The excitement of revealing your "Planet Tier".
      4. A general "GM" or community engagement post about building on Solana.
      
      Requirements:
      - Must tag @solana.
      - Must use 1-2 emojis.
      - Must be under 260 characters (leave room for hashtags).
      - Do NOT include hashtags in your output (I will add them).
      - Do NOT include quotation marks.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let tweetText = response.text().trim();
    
    // Cleanup formatting if necessary
    tweetText = tweetText.replace(/^["']|["']$/g, '');

    // Append hashtags
    const selectedHashtags = CONFIG.hashtags.sort(() => 0.5 - Math.random()).slice(0, 2).join(' ');
    const finalTweet = `${tweetText} ${selectedHashtags}`;

    return finalTweet;
  } catch (error) {
    console.error('Error generating tweet:', error);
    return null;
  }
}

async function postTweet() {
  try {
    console.log('🤖 Generating tweet...');
    const tweetContent = await generateTweet();
    
    if (!tweetContent) {
      console.log('❌ Failed to generate content. Skipping.');
      return;
    }

    console.log(`📝 Content: ${tweetContent}`);
    
    // Post to Twitter
    const { data: createdTweet } = await twitterClient.v2.tweet(tweetContent);
    console.log('✅ Tweet posted successfully!', createdTweet.id);
    
  } catch (error) {
    console.error('❌ Error posting tweet:', error);
  }
}

// Start the bot
console.log('🚀 Identity Prism Bot started...');
console.log(`📅 Schedule: ${CONFIG.cronSchedule}`);

// Run immediately on start to test (optional, commented out for safety in production, but good for first run)
postTweet();

// Schedule cron job
cron.schedule(CONFIG.cronSchedule, () => {
  postTweet();
});
