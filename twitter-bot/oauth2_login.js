require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const clientId = process.env.TWITTER_CLIENT_ID;
const clientSecret = process.env.TWITTER_CLIENT_SECRET;
const redirectUri = process.env.TWITTER_OAUTH2_REDIRECT_URI;
const scopes = (process.env.TWITTER_OAUTH2_SCOPES || 'tweet.read tweet.write users.read offline.access')
  .split(' ')
  .map((scope) => scope.trim())
  .filter(Boolean);

if (!clientId || !clientSecret || !redirectUri) {
  console.error('Missing TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, or TWITTER_OAUTH2_REDIRECT_URI in .env');
  process.exit(1);
}

const client = new TwitterApi({ clientId, clientSecret });
const { url, codeVerifier, state } = client.generateOAuth2AuthLink(redirectUri, { scope: scopes });

// Save verifier for non-interactive recovery
fs.writeFileSync(path.join(__dirname, '.code_verifier.tmp'), codeVerifier);

console.log('Open this URL to authorize the app:');
console.log(url);
console.log('\nAfter approving, copy the "code" parameter from the redirect URL and paste it below.');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Paste code or full redirect URL here: ', async (answer) => {
  try {
    const codeMatch = answer.match(/code=([^&]+)/);
    const code = codeMatch ? codeMatch[1] : answer.trim();

    const loginResult = await client.loginWithOAuth2({
      code,
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
    console.log('OAuth2 tokens saved to oauth2_tokens.json');
    console.log('You can now run the bot normally.');
  } catch (error) {
    console.error('OAuth2 login failed:', error);
  } finally {
    rl.close();
  }
});
