require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  // Post every 4 hours at 7 minutes past the hour + random delay
  cronSchedule: '7 */4 * * *', 
  projectId: 'identity-prism',
  dryRun: false // Set to true to test without posting
};

// Initialize Twitter Client
const TOKENS_PATH = path.join(__dirname, 'oauth2_tokens.json');
const OAUTH2_SCOPES = (process.env.TWITTER_OAUTH2_SCOPES || 'tweet.read tweet.write users.read offline.access')
  .split(' ')
  .map((scope) => scope.trim())
  .filter(Boolean);

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const textModel = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash' });
const imageModel = genAI.getGenerativeModel({
  model: process.env.GEMINI_IMAGE_MODEL || 'imagen-3.0-generate-002',
});

function loadOAuth2Tokens() {
  if (!fs.existsSync(TOKENS_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
  } catch (error) {
    console.error('Failed to parse OAuth2 tokens file:', error);
    return null;
  }
}

function saveOAuth2Tokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

async function getOAuth2Client() {
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }

  const tokens = loadOAuth2Tokens();
  if (!tokens?.accessToken) {
    console.error('OAuth2 tokens not found. Run: node oauth2_login.js');
    return null;
  }

  const now = Date.now();
  const expiresAt = tokens.expiresAt || 0;
  if (tokens.refreshToken && expiresAt && now > expiresAt - 60_000) {
    try {
      const refreshClient = new TwitterApi({ clientId, clientSecret });
      const refreshed = await refreshClient.refreshOAuth2Token(tokens.refreshToken);
      const updatedTokens = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || tokens.refreshToken,
        expiresAt: Date.now() + refreshed.expiresIn * 1000,
        scope: refreshed.scope,
        tokenType: refreshed.tokenType,
      };
      saveOAuth2Tokens(updatedTokens);
      return refreshed.client;
    } catch (error) {
      console.error('Failed to refresh OAuth2 token:', error);
      return new TwitterApi(tokens.accessToken);
    }
  }

  return new TwitterApi(tokens.accessToken);
}

async function getTwitterClient() {
  const oauth2Client = await getOAuth2Client();
  if (oauth2Client) {
    return { client: oauth2Client, mode: 'oauth2' };
  }

  if (
    process.env.TWITTER_APP_KEY &&
    process.env.TWITTER_APP_SECRET &&
    process.env.TWITTER_ACCESS_TOKEN &&
    process.env.TWITTER_ACCESS_SECRET
  ) {
    return {
      client: new TwitterApi({
        appKey: process.env.TWITTER_APP_KEY,
        appSecret: process.env.TWITTER_APP_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_SECRET,
      }),
      mode: 'oauth1',
    };
  }

  console.error('No Twitter credentials available. Provide OAuth2 tokens or OAuth1 keys.');
  return null;
}

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

// State file to avoid repetition or conflicts if needed
const STATE_FILE = path.join(__dirname, 'bot_state.json');

async function generateTweet() {
  try {
    const prompt = `${PROJECT_CONTEXT}\n\nTask: Write a fresh, engaging tweet about Identity Prism. Do not repeat previous tweets exactly. Make it sound exciting about the launch coming soon for Solana Seeker users.`;
    
    const result = await textModel.generateContent(prompt);
    const response = await result.response;
    let text = response.text().trim();
    
    // Cleanup: Remove quotes if the AI added them
    text = text.replace(/^"|"$/g, '');
    text = text.replace(/\s+/g, ' ').trim();
    
    // Ensure length is okay (simple check, Twitter counts differently but this is a safeguard)
    if (text.length > 280) {
      text = text.substring(0, 277) + '...';
    }
    
    return text;
  } catch (error) {
    console.error('Error generating tweet:', error);
    return null;
  }
}

async function generateImage() {
  try {
    const prompt = `Create a clean, futuristic graphic for Identity Prism (Solana project for Seeker phone). Include a subtle Solana symbol or gradient, abstract crypto vibe, dark background, neon accents, no text.`;
    const result = await imageModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'image/png' },
    });
    const response = await result.response;
    const inlineData = response?.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData
    )?.inlineData;

    if (!inlineData?.data) {
      console.warn('No image data returned from Gemini.');
      return null;
    }

    return Buffer.from(inlineData.data, 'base64');
  } catch (error) {
    console.error('Error generating image:', error);
    return null;
  }
}

async function postTweet() {
  console.log(`[${new Date().toISOString()}] Starting tweet process...`);
  
  try {
    const clientInfo = await getTwitterClient();
    if (!clientInfo) {
      console.error('Failed to get Twitter client. Check credentials.');
      return;
    }

    console.log(`Authentication Mode: ${clientInfo.mode.toUpperCase()}`);
    
    // Verify who we are
    try {
      const me = await clientInfo.client.v2.me();
      console.log(`Logged in as: @${me.data.username} (ID: ${me.data.id})`);
    } catch (authError) {
      console.error('Failed to fetch user profile (v2.me):', authError.data || authError.message);
    }

    const tweetText = await generateTweet();
    
    if (!tweetText) {
      console.log('Failed to generate tweet text.');
      return;
    }

    console.log(`Generated Tweet: ${tweetText}`);

    if (!CONFIG.dryRun) {
      let mediaId;
      if (process.env.ENABLE_IMAGE !== 'false') {
        const imageBuffer = await generateImage();
        if (imageBuffer) {
          try {
            mediaId = await clientInfo.client.v1.uploadMedia(imageBuffer, { mimeType: 'image/png' });
          } catch (error) {
            console.warn('Media upload failed, posting text-only:', error?.data || error?.message);
          }
        }
      }

      const payload = mediaId
        ? { text: tweetText, media: { media_ids: [mediaId] } }
        : tweetText;
      const { data: createdTweet } = await clientInfo.client.v2.tweet(payload);
      console.log('Tweet posted successfully!', createdTweet.id);
    } else {
      console.log('Dry run mode: Tweet not posted.');
    }
    
  } catch (error) {
    console.error('Error posting tweet:', error);
  }
}

// Start the bot
console.log('Identity Prism Twitter Bot Started.');
console.log('Schedule:', CONFIG.cronSchedule);

const runOnce = process.argv.includes('--post-now');

if (runOnce) {
  postTweet().finally(() => process.exit(0));
} else {
  // Run immediately on start to verify (optional, maybe comment out for prod if needed)
  postTweet();

  // Schedule
  cron.schedule(CONFIG.cronSchedule, () => {
    // Add a small random delay to avoid looking strictly robotic
    const delay = Math.floor(Math.random() * 1000 * 60 * 15); // 0-15 mins delay
    console.log(`Scheduled task triggered. Waiting ${delay/1000}s before posting...`);
    setTimeout(postTweet, delay);
  });

  // Keep process alive
  process.stdin.resume();
}
