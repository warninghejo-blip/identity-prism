import crypto from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

function createAuthRouteHandler({
  getClientIp,
  getPrismEarnRateLimit,
  setPrismEarnRateLimit,
  readBody,
  safeParseJson,
  respondJson,
  authChallenges,
  authChallengeTtlMs,
  reputationRateLimit,
  verifyWalletSignature,
  createJwt,
  jwtTtl,
}) {
  const getAuthParam = (parsed, url, key) => {
    const value = parsed?.[key];
    if (typeof value === 'string') return value.trim();
    return (url.searchParams.get(key) ?? '').trim();
  };

  return async function handleAuthRoute(req, res, url, pathname) {
    // ── Auth: issue challenge nonce ──
    if (pathname === '/api/auth/challenge' && (req.method === 'POST' || req.method === 'GET')) {
      // Rate limit: 6 challenges per minute per IP
      const challengeIp = getClientIp(req);
      const challengeRlKey = `authChallenge:${challengeIp}`;
      const lastChallengeTs = getPrismEarnRateLimit(challengeRlKey) || 0;
      if (Date.now() - lastChallengeTs < 3_000) return respondJson(res, 429, { error: 'Too many auth challenges, try again later' }) ?? true;
      setPrismEarnRateLimit(challengeRlKey, Date.now());
      try {
        const body = req.method === 'GET' ? '' : await readBody(req);
        const parsed = safeParseJson(body);
        const address = getAuthParam(parsed, url, 'address');
        if (!address) { respondJson(res, 400, { error: 'address required' }); return true; }
        try { new PublicKey(address); } catch { respondJson(res, 400, { error: 'Invalid address' }); return true; }
        const nonce = crypto.randomBytes(16).toString('hex');
        const message = `Identity Prism auth\nAddress: ${address}\nNonce: ${nonce}`;
        authChallenges.set(nonce, { address, message, expiresAt: Date.now() + authChallengeTtlMs });
        respondJson(res, 200, { nonce, message });
      } catch (e) {
        respondJson(res, 500, { error: 'Challenge failed' });
      }
      return true;
    }

    // ── Auth: verify signature, issue JWT ──
    if (pathname === '/api/auth/token' && (req.method === 'POST' || req.method === 'GET')) {
      const rlIp = getClientIp(req);
      const rlKey = `authToken:${rlIp}`;
      const lastAuth = reputationRateLimit.get(rlKey) || 0;
      if (Date.now() - lastAuth < 5000) {
        respondJson(res, 429, { error: 'Rate limited — 5s cooldown' });
        return true;
      }
      reputationRateLimit.set(rlKey, Date.now());
      try {
        const parsed = safeParseJson(req.method === 'GET' ? '' : await readBody(req));
        const address = getAuthParam(parsed, url, 'address');
        const nonce = getAuthParam(parsed, url, 'nonce');
        const signature = getAuthParam(parsed, url, 'signature');
        const signedMessage = getAuthParam(parsed, url, 'signedMessage') || undefined;
        if (!address || !nonce || !signature) {
          respondJson(res, 400, { error: 'address, nonce, and signature required' }); return true;
        }
        const challenge = authChallenges.get(nonce);
        if (!challenge) {
          console.warn('[auth:token] nonce not found in authChallenges. Map size:', authChallenges.size);
          respondJson(res, 401, { error: 'Invalid or expired nonce' }); return true;
        }
        if (challenge.address !== address) {
          console.warn('[auth:token] address mismatch:', { expected: challenge.address.slice(0, 8), got: address.slice(0, 8) });
          respondJson(res, 401, { error: 'Address mismatch' }); return true;
        }
        if (challenge.expiresAt < Date.now()) {
          authChallenges.delete(nonce);
          respondJson(res, 401, { error: 'Challenge expired' }); return true;
        }
        let verified = false;
        let messagesMatch = true;
        let challengeMessage = challenge.message;

        if (typeof signedMessage === 'string' && signedMessage.trim()) {
          const signedMessageBytes = Buffer.from(signedMessage, 'base64');
          const signedMessageText = signedMessageBytes.toString('utf8');
          const hasNonce = signedMessageText.includes(String(nonce));
          const hasAddress = signedMessageText.includes(address);
          const hasIdentity = /identity\s+prism|identityprism/i.test(signedMessageText);
          if (!hasNonce || !hasAddress || !hasIdentity) {
            console.warn('[auth] SIWS message missing required fields', {
              address: address.slice(0, 8),
              nonce: String(nonce).slice(0, 8),
              hasNonce,
              hasAddress,
              hasIdentity,
            });
            respondJson(res, 401, { error: 'Invalid sign-in message' }); return true;
          }
          challengeMessage = signedMessageText;
          verified = verifyWalletSignature(address, signedMessageBytes, signature);
        } else {
          // Use the STORED challenge message (the one wallet actually signed)
          challengeMessage = challenge.message;
          // Also reconstruct for comparison logging
          const reconstructed = `Identity Prism auth\nAddress: ${address}\nNonce: ${nonce}`;
          messagesMatch = challengeMessage === reconstructed;

          // Try stored message first (wallet signed THIS), then reconstructed as fallback
          verified = verifyWalletSignature(address, challengeMessage, signature);
          if (!verified && !messagesMatch) {
            console.warn('[auth] Stored message failed, trying reconstructed...');
            verified = verifyWalletSignature(address, reconstructed, signature);
          }
        }
        if (!verified) {
          // Log detailed info for debugging
          console.warn('[auth] Signature verification failed', {
            address: address.slice(0, 8),
            nonce: nonce.slice(0, 8),
            sigLen: signature?.length,
            sigType: typeof signature,
            sigPreview: typeof signature === 'string' ? signature.slice(0, 16) + '...' : 'N/A',
            messagesMatch,
            challengeMsgLen: challengeMessage.length,
          });
          respondJson(res, 401, { error: 'Invalid signature' }); return true;
        }
        authChallenges.delete(nonce); // one-time use
        const token = createJwt({ address });
        console.info('[auth] JWT issued', { address: address.slice(0, 8) });
        respondJson(res, 200, { token, expiresIn: jwtTtl });
      } catch (e) {
        respondJson(res, 500, { error: 'Auth failed' });
      }
      return true;
    }

    return false;
  };
}

function resolveAuthRouteConfig(ctx) {
  if (!ctx?.core || !ctx?.economy || !ctx?.auth) return ctx;

  const {
    core: {
      getClientIp,
      readBody,
      safeParseJson,
      respondJson,
    },
    economy: {
      getPrismEarnRateLimit,
      setPrismEarnRateLimit,
    },
    auth: {
      authChallenges,
      authChallengeTtlMs,
      reputationRateLimit,
      verifyWalletSignature,
      createJwt,
      jwtTtl,
    },
  } = ctx;

  return {
    getClientIp,
    getPrismEarnRateLimit,
    setPrismEarnRateLimit,
    readBody,
    safeParseJson,
    respondJson,
    authChallenges,
    authChallengeTtlMs,
    reputationRateLimit,
    verifyWalletSignature,
    createJwt,
    jwtTtl,
  };
}

function registerAuthRoute(...args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    return createAuthRouteHandler(resolveAuthRouteConfig(args[0]));
  }

  const [req, res, url, pathname, ctx] = args;
  return createAuthRouteHandler(resolveAuthRouteConfig(ctx))(req, res, url, pathname);
}

export { registerAuthRoute };
