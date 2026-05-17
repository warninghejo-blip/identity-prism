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
        // SIWS one-shot path: client supplied a self-generated nonce + signedMessage from
        // wallet.signIn() — there is no server-stored challenge. Verify by trusting the signed
        // message itself (it must contain address + "Identity Prism" keyword + the supplied nonce)
        // and burning the nonce against an in-memory used-nonces set inside authChallenges.
        const siwsParamRaw = getAuthParam(parsed, url, 'siws');
        const siwsFlag = siwsParamRaw === '1' || siwsParamRaw === 'true' || parsed?.siws === true;
        let siwsMode = false;
        let challenge = authChallenges.get(nonce);
        if (!challenge && siwsFlag && typeof signedMessage === 'string' && signedMessage.trim()) {
          if (!/^[0-9a-fA-F\-]{8,128}$/.test(nonce)) {
            respondJson(res, 400, { error: 'Invalid nonce format' }); return true;
          }
          // Anti-replay: reject nonces already used.
          const usedKey = `siws:${nonce}`;
          if (authChallenges.has(usedKey)) {
            respondJson(res, 401, { error: 'Replay detected' }); return true;
          }
          // Register synthetically so the burn at end of flow marks it used.
          challenge = { address, message: '', expiresAt: Date.now() + authChallengeTtlMs, siws: true };
          authChallenges.set(nonce, challenge);
          authChallenges.set(usedKey, { burnedAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
          siwsMode = true;
        }
        if (!challenge) {
          console.warn('[auth:token] nonce not found in authChallenges. Map size:', authChallenges.size);
          respondJson(res, 401, { error: 'Invalid or expired nonce' }); return true;
        }
        if (!siwsMode && challenge.address !== address) {
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
          // MWA-compliant wallets (e.g. Seed Vault) IGNORE client-supplied nonce and inject
          // their own. Extract the wallet's actual nonce from the SIWS message and treat it
          // as the authoritative anti-replay token. Falls back to client nonce for wallets
          // that do honour the input.
          const nonceMatch = signedMessageText.match(/^Nonce:\s*([A-Za-z0-9_-]+)\s*$/m);
          const walletNonce = nonceMatch ? nonceMatch[1] : null;
          const effectiveNonce = walletNonce || String(nonce);
          const hasNonce = Boolean(walletNonce) || signedMessageText.includes(String(nonce));
          const hasAddress = signedMessageText.includes(address);
          const hasIdentity = /identity\s+prism|identityprism/i.test(signedMessageText);
          if (!hasNonce || !hasAddress || !hasIdentity) {
            console.warn('[auth] SIWS message missing required fields', {
              address: address.slice(0, 8),
              nonce: String(nonce).slice(0, 8),
              nonceFull: String(nonce),
              walletNonce,
              hasNonce,
              hasAddress,
              hasIdentity,
              msgLen: signedMessageText.length,
              msgPreview: signedMessageText.slice(0, 400),
            });
            respondJson(res, 401, { error: 'Invalid sign-in message' }); return true;
          }
          // Anti-replay using the EFFECTIVE nonce (wallet-generated if present)
          if (siwsMode && walletNonce && walletNonce !== String(nonce)) {
            const walletUsedKey = `siws:${walletNonce}`;
            if (authChallenges.has(walletUsedKey)) {
              respondJson(res, 401, { error: 'Replay detected' }); return true;
            }
            authChallenges.set(walletUsedKey, { burnedAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
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
