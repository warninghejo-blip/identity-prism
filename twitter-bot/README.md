# Identity Prism Twitter Bot

This bot automatically generates and posts tweets for the Identity Prism project using Google Gemini AI and the Twitter API.

## Setup

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Configuration**:
    The `.env` file contains your API keys.
    
    **Important:** If you see a `401 Unauthorized` error, you likely need to regenerate your Twitter Access Token and Secret *after* ensuring your App has "Read and Write" permissions in the Twitter Developer Portal.

3.  **Run the bot**:
    ```bash
    npm start
    ```

## Oracle Bot (agent_bot.js)

The Oracle bot uses `agent-twitter-client` with cookie-based auth to monitor mentions, roast wallets, and post scheduled updates.

**Run:**
```bash
node agent_bot.js
```

**Run once (single mention check + one scheduled post):**
```bash
node agent_bot.js --once
```

### Required environment (.env.scraper)
- `GEMINI_API_KEY`
- `TWITTER_AUTH_TOKEN`
- `TWITTER_CT0`

### Optional environment
- `GEMINI_MODEL_NAME` (default: `gemini-2.5-flash`)
- `GEMINI_IMAGE_MODEL` (default: `imagen-3.0-generate-002`)
- `TWITTER_TWID`
- `TWITTER_USERNAME` / `TWITTER_PASSWORD` / `TWITTER_EMAIL` (only if `ALLOW_PASSWORD_LOGIN=true`)
- `MENTION_QUERY` (default: `@IdentityPrism`)
- `MENTION_INTERVAL_MS` (default: `120000`)
- `MENTION_BATCH_SIZE` (default: `20`)
- `REPLIES_PER_CYCLE` (default: `3`)
- `POST_CRON` (default: `5 9,13,17,21 * * *`)
- `ENABLE_IMAGES` (default: `true`)
- `DRY_RUN` (default: `false`)
- `ALLOW_PASSWORD_LOGIN` (default: `false`)
- `TWITTER_HOST` (default: `twitter.com`, set to `x.com` if needed)
- `STATS_API_BASE` (default: `https://identityprism.xyz/api/actions/share`)
- `BLINK_BASE_URL` (default: `https://identityprism.xyz/?address=`)

**Notes**:
- Requires Node.js 18+ for built-in `fetch`.
- The bot stores reply IDs in `twitter-bot/agent_bot_state.json` to avoid duplicate replies.

## Features

-   **AI Generation**: Uses `gemini-2.5-flash` to generate engaging content.
-   **Context Aware**: Knows about Solana Seeker, Identity Prism traits, and project goals.
-   **Scheduling**: Posts every 4 hours (offset by 7 minutes) with a random delay to act more human-like.
-   **Collision Avoidance**: Scheduled to not interfere with other bots on the system.

## Troubleshooting

-   **401 Unauthorized**: 
    1. Go to [Twitter Developer Portal](https://developer.twitter.com/en/portal/dashboard).
    2. Select your Project/App.
    3. Go to "User authentication settings".
    4. Ensure "App permissions" is set to "Read and Write".
    5. **CRITICAL**: Go back to "Keys and tokens" and **regenerate** the Access Token and Secret. The old ones won't inherit the new permissions.
    6. Update `.env` with the new keys.

-   **Gemini Model Error**:
    If the model is deprecated, update `GEMINI_MODEL_NAME` in `.env`.
