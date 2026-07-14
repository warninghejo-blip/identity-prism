import crypto from 'node:crypto';

const GAME_SESSION_RESULT_PURPOSE = 'game_result';
const MAX_SERVER_GAME_DURATION_MS = 15 * 60 * 1000;
const MAX_GAME_WINDOW_MS = 20 * 60 * 1000;
const LEGACY_DURATION_GRACE_MS = 120_000; // = maxSeedStartDriftMs
const REQUIRE_SESSION_TOKEN = process.env.GAME_SESSION_REQUIRE_TOKEN === 'true';

function registerGameV1Route(ctx) {
  const { core, auth, wallet, game } = ctx;
  const { ipRateLimit, getClientIp, respondJson, readBody, requireJwt } = core;
  const { optionalJwt } = auth;
  const {
    getCoinBalance,
    setCoinBalance,
    addCoinEarned,
    addCoinSpent,
    mintedAddresses,
    getStakingBoost,
  } = wallet;
  const {
    getGameCoinsToday,
    addGameCoinsToday,
    dailyGameCoinCap,
    getRevivesLeft,
    freeRevivesPerDay,
    useRevive,
    gameSessionProofs,
    persistGameSessionProofs,
    normalizeGameCoinDeltaForCap,
    maxDeltaPerGame,
    gameSessionOnchainBonusMultiplier,
  } = game;

  return async function handleGameV1Route(req, res, url, pathname) {
    if (pathname === '/api/game/coins' && req.method === 'POST') {
      if (!ipRateLimit('game_coins_post', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      try {
        const jwtV1 = requireJwt(req, res);
        if (!jwtV1.ok) return true;
        const raw = await readBody(req);
        const parsed = JSON.parse(raw);
        const { address: bodyAddr, delta, mode } = parsed;
        const addr = jwtV1.address;
        if (bodyAddr && bodyAddr !== addr) return respondJson(res, 403, { error: 'Address mismatch' });
        if (!addr || typeof addr !== 'string') return respondJson(res, 400, { error: 'address required' });
        if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0 || !Number.isInteger(delta)) {
          return respondJson(res, 400, { error: 'delta (non-zero integer) required' });
        }
        if (delta > 0) {
          const gameSessionId = parsed.gameSessionId;
          if (!gameSessionId) return respondJson(res, 400, { error: 'gameSessionId required for earning coins' });
          const session = gameSessionProofs?.get(gameSessionId);
          if (!session || !session.verified || !session.timingVerified || !session.sessionTokenId) {
            return respondJson(res, 400, { error: 'Invalid or unverified game session timing' });
          }
          if (session.walletAddress !== addr) return respondJson(res, 403, { error: 'Session wallet mismatch' });
          if (session.usedForChallenge) return respondJson(res, 400, { error: 'Challenge game — coins earned from challenge result' });

          const gameMode = mode || session.gameMode || 'orbit';
          if (session.gameMode && session.gameMode !== gameMode) {
            return respondJson(res, 400, { error: 'Session mode mismatch', reason: 'mode_mismatch' });
          }
          const idMultiplier = Math.max(1, Math.floor(Number(session.identityGameCoinMultiplier) || 1));
          const normalizedRequestedDelta = normalizeGameCoinDeltaForCap(delta, idMultiplier);
          const maxDelta = Math.round((maxDeltaPerGame[gameMode] || 500) * gameSessionOnchainBonusMultiplier);
          if (normalizedRequestedDelta > maxDelta) {
            return respondJson(res, 400, { error: 'Delta exceeds maximum for game mode' });
          }
          const alreadyCredited = Number(session.coinsCredited) || 0;
          const remainingSessionAllowance = Math.max(0, Math.floor(maxDelta - alreadyCredited));
          if (remainingSessionAllowance <= 0) {
            return respondJson(res, 400, { error: 'Session coin allowance exhausted', reason: 'session_allowance_exhausted' });
          }
          const todayCoins = getGameCoinsToday(addr);
          const isHolder = mintedAddresses.has(addr);
          const gameCap = isHolder ? dailyGameCoinCap : Math.floor(dailyGameCoinCap / 2);
          if (todayCoins >= gameCap) {
            return respondJson(res, 200, { address: addr, coins: getCoinBalance(addr), earned: 0, capped: true, reason: 'daily_cap_exceeded', dailyRemaining: 0 });
          }
          let baseDelta = Math.min(delta, remainingSessionAllowance * idMultiplier, gameCap - todayCoins);
          addGameCoinsToday(addr, baseDelta);
          session.coinsCredited = alreadyCredited + Math.ceil(baseDelta / idMultiplier);
          gameSessionProofs.set(gameSessionId, session);
          persistGameSessionProofs();
          const boost = getStakingBoost(addr);
          const effectiveDelta = boost > 0 ? Math.floor(baseDelta * (1 + boost)) : baseDelta;
          const newBalance = getCoinBalance(addr) + effectiveDelta;
          setCoinBalance(addr, newBalance);
          addCoinEarned(addr, effectiveDelta);
          return respondJson(res, 200, {
            address: addr,
            coins: newBalance,
            earned: effectiveDelta,
            dailyRemaining: Math.max(0, gameCap - getGameCoinsToday(addr)),
          });
        }

        const absDelta = Math.abs(delta);
        const current = getCoinBalance(addr);
        if (current < absDelta) return respondJson(res, 400, { error: 'Insufficient balance' });
        setCoinBalance(addr, current - absDelta);
        addCoinSpent(addr, absDelta);
        return respondJson(res, 200, { address: addr, coins: getCoinBalance(addr) });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      }
      return true;
    }

    if (pathname === '/api/game/revives' && req.method === 'GET') {
      if (!ipRateLimit('game_rev', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const addr = url.searchParams.get('address') || '';
      const mode = url.searchParams.get('mode') || 'orbit';
      if (!addr) return respondJson(res, 400, { error: 'address query param required' });
      if (mode !== 'orbit' && mode !== 'destroyer' && mode !== 'gravity') {
        return respondJson(res, 400, { error: 'mode must be orbit, destroyer, or gravity' });
      }
      const left = getRevivesLeft(addr, mode);
      respondJson(res, 200, { address: addr, mode, left, max: freeRevivesPerDay, eligible: true });
      return true;
    }

    if (pathname === '/api/game/revives' && req.method === 'POST') {
      if (!ipRateLimit('revive_post', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtV1Rev = requireJwt(req, res);
      if (!jwtV1Rev.ok) return true;
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw);
        const { address: bodyAddrRev, mode } = parsed;
        const addr = jwtV1Rev.address;
        if (bodyAddrRev && bodyAddrRev !== addr) return respondJson(res, 403, { error: 'Address mismatch' });
        if (!addr || typeof addr !== 'string') return respondJson(res, 400, { error: 'address (string) required' });
        if (mode !== 'orbit' && mode !== 'destroyer' && mode !== 'gravity') {
          return respondJson(res, 400, { error: 'mode must be orbit, destroyer, or gravity' });
        }
        const success = useRevive(addr, mode);
        if (!success) {
          const left = getRevivesLeft(addr, mode);
          return respondJson(res, 429, { error: 'No free revives left today', left, max: freeRevivesPerDay });
        }
        const left = getRevivesLeft(addr, mode);
        respondJson(res, 200, { address: addr, mode, success: true, left, max: freeRevivesPerDay });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      }
      return true;
    }

    return false;
  };
}

function registerGameRoute(ctx) {
  const { core, wallet, economy, game } = ctx;
  const { ipRateLimit, getClientIp, respondJson, requireJwt, readBody, safeParseJson, getBaseUrl } = core;
  const { mintedAddresses, getStakingBoost, getCoinBalance, setCoinBalance, addCoinEarned, addCoinSpent } = wallet;
  const { getPrismEarnRateLimit, setPrismEarnRateLimit, nonGameDailyEarnCap } = economy;
  const {
    normalizeGameSessionPayload,
    pruneGameSessionProofs,
    createGameSessionProofId,
    verifyMagicBlockSeedSlot,
    gameSessionProofs,
    maxGameSessionProofs,
    persistGameSessionProofs,
    toPublicGameSessionProof,
    getIdentityHolderPerks,
    normalizeGameCoinDeltaForCap,
    maxDeltaPerGame,
    gameSessionOnchainBonusMultiplier,
    dailyGameCoinCap,
    getGameCoinsToday,
    addGameCoinsToday,
    getWalletAchievements,
    claimAchievement,
    achievementRewardsById,
    isAchievementUnlockVerified,
    markAchievementsUnlocked,
    hasCoreCollectionAsset,
    getRevivesLeft,
    freeRevivesPerDay,
    useRevive,
    issueGameSessionToken,
    verifyGameSessionToken,
    bindGameSessionTokenProof,
    redeemGameSessionToken,
  } = game;

  return async function handleGameRoute(req, res, url, pathname) {
    if (pathname === '/api/game/session/start' && req.method === 'POST') {
      if (!ipRateLimit('game_session_start', getClientIp(req), 15, 60000)) {
        return respondJson(res, 429, { error: 'Too many game session starts' });
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const raw = await readBody(req);
        const parsed = safeParseJson(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return respondJson(res, 400, { error: 'Invalid JSON' });
        }

        const walletAddress = typeof parsed.walletAddress === 'string' && parsed.walletAddress.trim()
          ? parsed.walletAddress.trim()
          : jwtAuth.address;
        if (walletAddress !== jwtAuth.address) {
          return respondJson(res, 403, { error: 'Wallet address mismatch' });
        }
        const validGameModes = new Set(['orbit', 'destroyer', 'gravity']);
        const gameMode = typeof parsed.gameMode === 'string' ? parsed.gameMode.trim() : 'orbit';
        if (!validGameModes.has(gameMode)) {
          return respondJson(res, 400, { error: 'invalid gameMode' });
        }
        const seed = String(parsed.seed ?? '').trim();
        const slot = Number(parsed.slot);
        if (!seed || seed.length < 16) {
          return respondJson(res, 400, { error: 'seed is required' });
        }
        if (!Number.isInteger(slot) || slot <= 0) {
          return respondJson(res, 400, { error: 'slot must be a positive integer' });
        }

        const issued = issueGameSessionToken({
          walletAddress,
          gameMode,
          purpose: GAME_SESSION_RESULT_PURPOSE,
          seed,
          slot,
        });
        respondJson(res, 201, {
          sessionToken: issued.token,
          startedAtMs: issued.issuedAtMs,
          expiresAtMs: issued.expiresAtMs,
          seed,
          slot,
          gameMode,
        });
      } catch {
        respondJson(res, 500, { error: 'Failed to start game session' });
      }
      return true;
    }

    if (pathname === '/api/game/session' && req.method === 'POST') {
      if (!ipRateLimit('game_session', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many session registrations' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const raw = await readBody(req);
        const parsed = safeParseJson(raw);
        if (!parsed) {
          respondJson(res, 400, { error: 'Invalid JSON' });
          return true;
        }
        const submittedAtMs = Date.now();
        const sessionToken = typeof parsed.sessionToken === 'string' ? parsed.sessionToken.trim() : '';
        if (!sessionToken && REQUIRE_SESSION_TOKEN) {
          return respondJson(res, 428, {
            error: 'sessionToken required; call /api/game/session/start before the game',
            code: 'GAME_SESSION_START_REQUIRED',
          });
        }
        const legacyMode = !sessionToken;

        let payload;
        try {
          payload = normalizeGameSessionPayload(parsed);
        } catch (error) {
          respondJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
          return true;
        }
        if (payload.walletAddress !== jwtAuth.address) {
          return respondJson(res, 403, { error: 'Wallet address mismatch' });
        }

        let tokenRecord = null;
        if (!legacyMode) {
          const tokenVerification = verifyGameSessionToken(sessionToken);
          if (!tokenVerification.ok) {
            return respondJson(res, 409, {
              error: 'Invalid, expired, or already used game session token',
              reason: tokenVerification.reason,
            });
          }
          tokenRecord = tokenVerification.record;
          if (
            tokenRecord.walletAddress !== jwtAuth.address
            || tokenRecord.gameMode !== payload.gameMode
            || tokenRecord.purpose !== GAME_SESSION_RESULT_PURPOSE
            || tokenRecord.seed !== payload.seed
            || tokenRecord.slot !== payload.slot
          ) {
            return respondJson(res, 403, { error: 'Game session token does not match submitted result' });
          }
        }

        pruneGameSessionProofs();

        const verification = await verifyMagicBlockSeedSlot(payload.seed, payload.slot);

        let serverStartedAtMs;
        let serverEndedAtMs;
        let durationMs;
        let timingVerified;
        if (!legacyMode) {
          serverStartedAtMs = tokenRecord.issuedAtMs;
          serverEndedAtMs = submittedAtMs;
          durationMs = Math.max(0, serverEndedAtMs - serverStartedAtMs);
          timingVerified = serverEndedAtMs >= serverStartedAtMs && durationMs <= MAX_SERVER_GAME_DURATION_MS;
        } else {
          serverStartedAtMs = payload.startedAtMs;
          serverEndedAtMs = payload.endedAtMs;
          const serverReceiptMs = Date.now();
          const clientDurationMs = payload.endedAtMs - payload.startedAtMs; // normalize guarantees >=0
          durationMs = clientDurationMs;
          if (Number.isFinite(Number(verification.slotBlockTimeMs))) {
            const slotMs = Number(verification.slotBlockTimeMs);
            const authElapsedMs = Math.min(payload.endedAtMs, serverReceiptMs) - slotMs;
            const windowValid = (serverReceiptMs - slotMs) <= MAX_GAME_WINDOW_MS && authElapsedMs > 0;
            const durationValid = clientDurationMs <= authElapsedMs + LEGACY_DURATION_GRACE_MS;
            timingVerified = windowValid && durationValid;
          } else {
            timingVerified = true; // fail-open like existing seedTimeValid; attacker doesn't control missing blockTime
          }
        }

        const canonical = JSON.stringify({
          walletAddress: payload.walletAddress,
          score: payload.score,
          survivalTime: payload.survivalTime,
          seed: payload.seed,
          slot: payload.slot,
          startedAtMs: serverStartedAtMs,
          endedAtMs: serverEndedAtMs,
          txSignature: payload.txSignature,
          gameMode: payload.gameMode,
          sessionTokenId: legacyMode ? null : tokenRecord.tokenId,
        });
        const hash = crypto.createHash('sha256').update(canonical).digest('hex');
        const id = createGameSessionProofId(payload.slot, hash);
        const isDestroyerMode = payload.gameMode === 'destroyer';
        const isGravityMode = payload.gameMode === 'gravity';
        const durationSec = Math.max(1, durationMs / 1000);
        const expectedScore = Math.floor(durationSec);
        const maxDestroyerScore = Math.floor(Math.max(1, durationSec) * 100);
        const maxGravityScore = Math.floor(Math.max(1, durationSec) * 10);
        let scoreDelta = 0;
        let modeScoreValid = true;
        if (isDestroyerMode) {
          modeScoreValid = payload.score <= maxDestroyerScore;
        } else if (isGravityMode) {
          modeScoreValid = payload.score <= maxGravityScore;
        } else if (!legacyMode) {
          scoreDelta = Math.max(0, payload.score - expectedScore); // only over-claim is penalized
        } else {
          scoreDelta = Math.abs(expectedScore - payload.score);
        }
        const scoreDeltaToleranceSec = 8;
        const maxSeedStartDriftMs = 120_000;
        const seedStartDeltaMs = Number.isFinite(Number(verification.slotBlockTimeMs))
          ? Math.abs(serverStartedAtMs - Number(verification.slotBlockTimeMs))
          : 0;
        const seedTimeValid = !Number.isFinite(Number(verification.slotBlockTimeMs)) || seedStartDeltaMs <= maxSeedStartDriftMs;
        const verified =
          timingVerified && verification.seedMatchesSlot && seedTimeValid && scoreDelta <= scoreDeltaToleranceSec && modeScoreValid;
        const nowIso = new Date().toISOString();
        const baseUrl = getBaseUrl(req);
        const proofUrl = baseUrl ? `${baseUrl}/api/game/session/${encodeURIComponent(id)}` : null;

        const seedDeltaReason = seedTimeValid ? '' : `; seed/start delta=${Math.round(seedStartDeltaMs / 1000)}s`;
        const timingReason = timingVerified ? '' : '; server-timed duration exceeds maximum';
        const reason = verified
          ? 'Seed matches MagicBlock slot and score is valid for server-authoritative duration'
          : `${verification.reason}; score delta=${scoreDelta}s${seedDeltaReason}${timingReason}`;

        for (const [key, prev] of gameSessionProofs) {
          if (prev && prev.walletAddress === payload.walletAddress && prev.slot === payload.slot && key !== id) {
            if ((Number(prev.coinsCredited) || 0) > 0 || prev.usedForTournament || prev.usedForChallenge || prev.usedForLeaderboard) {
              return respondJson(res, 409, { error: 'A session for this slot was already registered and used', reason: 'slot_already_used' });
            }
            gameSessionProofs.delete(key); // honest retry / re-register of an UNUSED session — replace it
          }
        }

        const existingSession = gameSessionProofs.get(id);
        if (existingSession && (existingSession.usedForTournament || existingSession.usedForChallenge || existingSession.usedForLeaderboard)) {
          return respondJson(res, 409, { error: 'Session already registered and used competitively' });
        }

        if (!legacyMode) {
          const tokenBinding = bindGameSessionTokenProof({ token: sessionToken, proofId: id });
          if (!tokenBinding.ok) {
            return respondJson(res, 409, { error: 'Game session token cannot be bound to this result', reason: tokenBinding.reason });
          }
          const tokenRedemption = redeemGameSessionToken({
            token: sessionToken,
            proofId: id,
            walletAddress: payload.walletAddress,
            gameMode: payload.gameMode,
            purpose: GAME_SESSION_RESULT_PURPOSE,
            seed: payload.seed,
            slot: payload.slot,
          });
          if (!tokenRedemption.ok) {
            return respondJson(res, 409, { error: 'Game session token was already used', reason: tokenRedemption.reason });
          }
        }

        const entry = {
          id,
          hash,
          walletAddress: payload.walletAddress,
          score: payload.score,
          survivalTime: payload.survivalTime,
          seed: payload.seed,
          slot: payload.slot,
          startedAtMs: serverStartedAtMs,
          endedAtMs: serverEndedAtMs,
          durationMs,
          scoreDelta,
          seedStartDeltaMs,
          verified,
          timingVerified,
          gameMode: payload.gameMode,
          proofUrl,
          verification: {
            ...verification,
            reason,
          },
          createdAt: nowIso,
          lastVerifiedAt: nowIso,
          createdAtMs: Date.now(),
          coinsCredited: existingSession?.coinsCredited ?? 0,
          identityGameCoinMultiplier: Number.isFinite(Number(existingSession?.identityGameCoinMultiplier))
            ? Math.max(1, Math.floor(Number(existingSession.identityGameCoinMultiplier)))
            : null,
          usedForTournament: existingSession?.usedForTournament ?? null,
          usedForChallenge: existingSession?.usedForChallenge ?? null,
          usedForLeaderboard: existingSession?.usedForLeaderboard ?? null,
          sessionTokenId: legacyMode ? null : tokenRecord.tokenId,
          sessionPurpose: legacyMode ? null : tokenRecord.purpose,
          sessionReferenceId: legacyMode ? null : tokenRecord.referenceId,
          sessionTokenExpiresAtMs: legacyMode ? null : tokenRecord.expiresAtMs,
        };

        if (gameSessionProofs.size >= maxGameSessionProofs) {
          let evicted = false;
          for (const [key, val] of gameSessionProofs) {
            if (!val?.usedForTournament && !val?.usedForChallenge && !val?.usedForLeaderboard) {
              gameSessionProofs.delete(key);
              evicted = true;
              break;
            }
          }
          if (!evicted) {
            const oldest = gameSessionProofs.keys().next().value;
            if (oldest) gameSessionProofs.delete(oldest);
          }
        }
        gameSessionProofs.set(id, entry);
        persistGameSessionProofs();
        respondJson(res, 200, { session: toPublicGameSessionProof(entry) });
      } catch {
        respondJson(res, 500, { error: 'Failed to register game session' });
      }
      return true;
    }

    if (pathname.startsWith('/api/game/session/') && req.method === 'GET') {
      if (!ipRateLimit('sess_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Rate limited' });
      pruneGameSessionProofs();
      const rawId = pathname.slice('/api/game/session/'.length);
      let sessionId = '';
      try {
        sessionId = decodeURIComponent(rawId).trim();
      } catch {
        sessionId = rawId.trim();
      }
      if (!sessionId) {
        respondJson(res, 400, { error: 'Session id is required' });
        return true;
      }

      const existing = gameSessionProofs.get(sessionId);
      if (!existing) {
        respondJson(res, 404, { error: 'Session proof not found' });
        return true;
      }
      const jwtSession = requireJwt(req, res);
      if (!jwtSession.ok) return true;
      if (jwtSession.address !== existing.walletAddress) {
        respondJson(res, 403, { error: 'Session wallet mismatch' });
        return true;
      }

      try {
        const verification = await verifyMagicBlockSeedSlot(existing.seed, existing.slot);
        if (!verification.rpcHealthy) {
          respondJson(res, 200, {
            session: toPublicGameSessionProof(existing),
            verificationWarning: 'MagicBlock RPC unavailable; using cached verification',
          });
          return true;
        }
        let modeScoreValid = true;
        const exDurationSec = Math.max(1, (existing.durationMs || 0) / 1000);
        if (existing.gameMode === 'destroyer') {
          modeScoreValid = existing.score <= Math.floor(exDurationSec * 100);
        } else if (existing.gameMode === 'gravity') {
          modeScoreValid = existing.score <= Math.floor(exDurationSec * 10);
        }
        const scoreDeltaToleranceSec = 8;
        const maxSeedStartDriftMs = 120_000;
        const seedStartDeltaMs = Number.isFinite(Number(verification.slotBlockTimeMs))
          ? Math.abs((existing.startedAtMs || 0) - Number(verification.slotBlockTimeMs))
          : existing.seedStartDeltaMs ?? 0;
        const seedTimeValid = !Number.isFinite(Number(verification.slotBlockTimeMs)) || seedStartDeltaMs <= maxSeedStartDriftMs;
        const verified =
          existing.timingVerified !== false
          && verification.seedMatchesSlot
          && seedTimeValid
          && existing.scoreDelta <= scoreDeltaToleranceSec
          && modeScoreValid;
        const seedDeltaReason = seedTimeValid ? '' : `; seed/start delta=${Math.round(seedStartDeltaMs / 1000)}s`;
        const reason = verified
          ? 'Seed matches MagicBlock slot and score delta is within tolerance'
          : `${verification.reason}; score delta=${existing.scoreDelta}s${seedDeltaReason}`;

        const refreshed = {
          ...existing,
          verified,
          seedStartDeltaMs,
          verification: {
            ...verification,
            reason,
          },
          lastVerifiedAt: new Date().toISOString(),
        };
        const verifiedChanged = refreshed.verified !== existing.verified;
        gameSessionProofs.set(sessionId, refreshed);
        if (verifiedChanged) persistGameSessionProofs();
        respondJson(res, 200, { session: toPublicGameSessionProof(refreshed) });
      } catch {
        respondJson(res, 200, {
          session: toPublicGameSessionProof(existing),
          verificationWarning: 'Verification temporarily unavailable',
        });
      }
      return true;
    }

    if (pathname === '/api/game/coins' && req.method === 'GET') {
      if (!ipRateLimit('coins_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const addr = url.searchParams.get('address') || '';
      if (!addr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
        respondJson(res, 400, { error: 'valid address required' });
        return true;
      }
      const coins = getCoinBalance(addr);
      respondJson(res, 200, { address: addr, coins });
      return true;
    }

    if (pathname === '/api/game/coins' && req.method === 'POST') {
      if (!ipRateLimit('game_coins_post', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw);
        const { address: bodyAddr, delta, mode } = parsed;
        const addr = jwtAuth.address;
        if (bodyAddr && bodyAddr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
        if (!addr || typeof addr !== 'string') {
          respondJson(res, 400, { error: 'address (string) required' });
          return true;
        }
        if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0 || !Number.isInteger(delta)) {
          respondJson(res, 400, { error: 'delta (non-zero integer) required' });
          return true;
        }
        if (delta > 0) {
          const gameSessionId = parsed.gameSessionId;
          if (!gameSessionId) return respondJson(res, 400, { error: 'gameSessionId required for earning coins' });
          const session = gameSessionProofs.get(gameSessionId);
          if (!session || !session.verified || !session.timingVerified) {
            return respondJson(res, 400, { error: 'Invalid or unverified game session timing' });
          }
          if (session.walletAddress !== addr) return respondJson(res, 403, { error: 'Session wallet mismatch' });
          if (session.usedForChallenge) return respondJson(res, 400, { error: 'Challenge game — coins earned from challenge result' });
          const VALID_GAME_MODES = new Set(['orbit', 'destroyer', 'gravity', 'wars', 'territory']);
          const requestedMode = mode || session.gameMode || 'orbit';
          const gameMode = VALID_GAME_MODES.has(requestedMode) ? requestedMode : 'orbit';
          if (session.gameMode && session.gameMode !== gameMode) {
            return respondJson(res, 400, { error: 'Session mode mismatch', reason: 'mode_mismatch' });
          }
          let pinnedIdentityGameCoinMultiplier = Number.isFinite(Number(session.identityGameCoinMultiplier))
            ? Math.max(1, Math.floor(Number(session.identityGameCoinMultiplier)))
            : null;
          if (!pinnedIdentityGameCoinMultiplier) {
            const holderPerks = await getIdentityHolderPerks(addr);
            pinnedIdentityGameCoinMultiplier = Math.max(1, Math.floor(Number(holderPerks.gameCoinMultiplier) || 1));
            session.identityGameCoinMultiplier = pinnedIdentityGameCoinMultiplier;
          }
          const normalizedRequestedDelta = normalizeGameCoinDeltaForCap(delta, pinnedIdentityGameCoinMultiplier);
          const maxDelta = Math.round((maxDeltaPerGame[gameMode] || 500) * gameSessionOnchainBonusMultiplier);
          if (normalizedRequestedDelta > maxDelta) {
            return respondJson(res, 400, { error: 'Delta exceeds maximum for game mode' });
          }
          const alreadyCredited = Number(session.coinsCredited) || 0;
          const remainingSessionAllowance = Math.max(0, Math.floor(maxDelta - alreadyCredited));
          if (remainingSessionAllowance <= 0) {
            return respondJson(res, 400, { error: 'Session coin allowance exhausted', reason: 'session_allowance_exhausted' });
          }
          const todayCoins = getGameCoinsToday(addr);
          const isHolder = mintedAddresses.has(addr);
          const gameCap = isHolder ? dailyGameCoinCap : Math.floor(dailyGameCoinCap / 2);
          if (todayCoins >= gameCap) {
            return respondJson(res, 200, { address: addr, coins: getCoinBalance(addr), earned: 0, capped: true, reason: 'daily_cap_exceeded', dailyRemaining: 0 });
          }
          const requestedDelta = Math.min(delta, remainingSessionAllowance * pinnedIdentityGameCoinMultiplier);
          let appliedDelta = requestedDelta;
          if (todayCoins + requestedDelta > gameCap) {
            appliedDelta = gameCap - todayCoins;
          }
          addGameCoinsToday(addr, appliedDelta);
          session.coinsCredited = alreadyCredited + Math.ceil(appliedDelta / pinnedIdentityGameCoinMultiplier);
          gameSessionProofs.set(gameSessionId, session);
          persistGameSessionProofs();
          const boost = getStakingBoost(addr);
          const effectiveDelta = boost > 0 ? Math.floor(appliedDelta * (1 + boost)) : appliedDelta;
          const current = getCoinBalance(addr);
          const newBalance = current + effectiveDelta;
          setCoinBalance(addr, newBalance);
          addCoinEarned(addr, effectiveDelta);
          respondJson(res, 200, {
            address: addr,
            coins: newBalance,
            earned: effectiveDelta,
            dailyRemaining: Math.max(0, gameCap - getGameCoinsToday(addr)),
            boost: boost > 0 ? boost : undefined,
            idMultiplier: pinnedIdentityGameCoinMultiplier > 1 ? pinnedIdentityGameCoinMultiplier : undefined,
          });
        } else {
          const absDelta = Math.abs(delta);
          const current = getCoinBalance(addr);
          if (current < absDelta) return respondJson(res, 400, { error: 'Insufficient balance' });
          setCoinBalance(addr, current - absDelta);
          addCoinSpent(addr, absDelta);
          respondJson(res, 200, { address: addr, coins: getCoinBalance(addr) });
        }
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      }
      return true;
    }

    if (pathname === '/api/game/achievements' && req.method === 'GET') {
      if (!ipRateLimit('game_ach', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const addr = url.searchParams.get('address') || '';
      if (!addr) {
        respondJson(res, 400, { error: 'address query param required' });
        return true;
      }
      let entry = getWalletAchievements(addr);
      if (entry.unlocked.size === 0 && entry.claimed.size === 0) {
        const verifiedIds = Object.keys(achievementRewardsById).filter((id) => isAchievementUnlockVerified(addr, id));
        if (verifiedIds.length > 0) {
          markAchievementsUnlocked(addr, verifiedIds);
          entry = getWalletAchievements(addr);
        }
      }
      respondJson(res, 200, { address: addr, unlocked: [...entry.unlocked], claimed: [...entry.claimed] });
      return true;
    }

    if (pathname === '/api/game/achievements' && req.method === 'POST') {
      if (!ipRateLimit('ach_post', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw);
        const { address: addr, achievementId } = parsed;
        if (addr && addr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
        if (!addr || typeof addr !== 'string' || !achievementId || typeof achievementId !== 'string') {
          respondJson(res, 400, { error: 'address (string) and achievementId (string) required' });
          return true;
        }
        const success = claimAchievement(addr, achievementId);
        if (!success) {
          respondJson(res, 409, { error: 'Achievement already claimed', achievementId });
          return true;
        }
        const serverReward = achievementRewardsById[achievementId] || 0;
        if (serverReward > 0) {
          const ngKey = `nongame_daily:${addr}`;
          const ngToday = new Date().toISOString().slice(0, 10);
          const ngEntry = getPrismEarnRateLimit(ngKey);
          let ngEarned = (ngEntry && typeof ngEntry === 'object' && ngEntry.date === ngToday) ? (ngEntry.total || 0) : 0;
          const remaining = Math.max(0, nonGameDailyEarnCap - ngEarned);
          const capped = Math.min(serverReward, remaining);
          if (capped > 0) {
            setCoinBalance(addr, getCoinBalance(addr) + capped);
            addCoinEarned(addr, capped);
            setPrismEarnRateLimit(ngKey, { date: ngToday, total: ngEarned + capped });
          }
        }
        const entry = getWalletAchievements(addr);
        const coins = getCoinBalance(addr);
        respondJson(res, 200, { address: addr, achievementId, unlocked: [...entry.unlocked], claimed: [...entry.claimed], coins });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      }
      return true;
    }

    if (pathname === '/api/game/achievements' && req.method === 'PUT') {
      if (!ipRateLimit('ach_put', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw);
        const { address: addr, unlocked: ids } = parsed;
        if (!addr || typeof addr !== 'string' || !Array.isArray(ids)) {
          respondJson(res, 400, { error: 'address (string) and unlocked (array) required' });
          return true;
        }
        if (addr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
        const verifiedIds = ids.filter((id) => typeof id === 'string' && isAchievementUnlockVerified(addr, id));
        if (verifiedIds.length > 0) {
          markAchievementsUnlocked(addr, verifiedIds);
        }
        const entry = getWalletAchievements(addr);
        respondJson(res, 200, { address: addr, unlocked: [...entry.unlocked], claimed: [...entry.claimed] });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      }
      return true;
    }

    if (pathname === '/api/game/revives' && req.method === 'GET') {
      if (!ipRateLimit('game_rev', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const addr = url.searchParams.get('address') || '';
      const mode = url.searchParams.get('mode') || 'orbit';
      if (!addr) {
        respondJson(res, 400, { error: 'address query param required' });
        return true;
      }
      if (mode !== 'orbit' && mode !== 'destroyer' && mode !== 'gravity') {
        respondJson(res, 400, { error: 'mode must be orbit, destroyer, or gravity' });
        return true;
      }
      const eligible = mintedAddresses.has(addr) || await hasCoreCollectionAsset(addr);
      if (!eligible) {
        respondJson(res, 200, { address: addr, mode, left: 0, max: freeRevivesPerDay, eligible: false });
        return true;
      }
      const left = getRevivesLeft(addr, mode);
      respondJson(res, 200, { address: addr, mode, left, max: freeRevivesPerDay, eligible: true });
      return true;
    }

    if (pathname === '/api/game/revives' && req.method === 'POST') {
      if (!ipRateLimit('revive_post', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw);
        const { address: addr, mode } = parsed;
        if (addr && addr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
        if (!addr || typeof addr !== 'string') {
          respondJson(res, 400, { error: 'address (string) required' });
          return true;
        }
        if (mode !== 'orbit' && mode !== 'destroyer' && mode !== 'gravity') {
          respondJson(res, 400, { error: 'mode must be orbit, destroyer, or gravity' });
          return true;
        }
        const eligible = mintedAddresses.has(addr) || await hasCoreCollectionAsset(addr);
        if (!eligible) {
          respondJson(res, 403, { error: 'Identity Prism holder perk required for free revives', left: 0, max: freeRevivesPerDay });
          return true;
        }
        const success = useRevive(addr, mode);
        if (!success) {
          const left = getRevivesLeft(addr, mode);
          respondJson(res, 429, { error: 'No free revives left today', left, max: freeRevivesPerDay });
          return true;
        }
        const left = getRevivesLeft(addr, mode);
        respondJson(res, 200, { address: addr, mode, success: true, left, max: freeRevivesPerDay });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      }
      return true;
    }

    return false;
  };
}

export { registerGameRoute, registerGameV1Route };
