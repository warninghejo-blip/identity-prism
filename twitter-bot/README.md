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
