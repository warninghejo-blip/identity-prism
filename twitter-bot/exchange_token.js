require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

async function exchange() {
    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    const redirectUri = process.env.TWITTER_OAUTH2_REDIRECT_URI;
    const code = process.argv[2];

    if (!code) {
        console.error('Usage: node exchange_token.js <code>');
        process.exit(1);
    }

    const verifierPath = path.join(__dirname, '.code_verifier.tmp');
    if (!fs.existsSync(verifierPath)) {
        console.error('Error: .code_verifier.tmp not found. Run oauth2_login.js first to generate a link.');
        process.exit(1);
    }

    const codeVerifier = fs.readFileSync(verifierPath, 'utf-8').trim();
    const client = new TwitterApi({ clientId, clientSecret });

    try {
        console.log('Exchanging code for tokens...');
        const loginResult = await client.loginWithOAuth2({
            code: code.trim(),
            codeVerifier,
            redirectUri,
        });

        const tokens = {
            accessToken: loginResult.accessToken,
            refreshToken: loginResult.refreshToken,
            expiresAt: Date.now() + loginResult.expiresIn * 1000,
            scope: loginResult.scope,
            tokenType: loginResult.tokenType,
        };

        const tokensPath = path.join(__dirname, 'oauth2_tokens.json');
        fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
        console.log('SUCCESS: OAuth2 tokens saved to oauth2_tokens.json');
        fs.unlinkSync(verifierPath); // Clean up
    } catch (error) {
        console.error('Exchange failed:', error.data || error.message);
    }
}

exchange();
