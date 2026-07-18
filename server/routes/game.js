import crypto from 'node:crypto';
import { Connection, PublicKey } from '@solana/web3.js';
import { appDb } from '../services/appDb.js';
import { getAssociatedTokenAddress, getMint } from '../utils/solanaToken.js';
import {
  CHALLENGE_SUBMIT_GRACE_MS,
  MAX_FREE_REVIVES_PER_RUN,
  MAX_PAID_REVIVES_PER_RUN,
  MAX_PAUSE_FOR_GRANT_MS,
  MAX_REVIVES_PER_RUN,
  activeSeconds,
  calculateAuthoritativeTiming,
  calculateEconomicDurationMs,
  formatMMSS,
  getScoreCeiling,
} from '../services/gameRules.js';

const GAME_SESSION_RESULT_PURPOSE = 'game_result';
const REQUIRE_SESSION_TOKEN = process.env.GAME_SESSION_REQUIRE_TOKEN === 'true';
const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const REVIVE_AMOUNT_RAW = 5_000_000n; // 5 SKR — SKR mint is 6 decimals (5 * 10^6), NOT 9
const REVIVE_INTENT_TTL_MS = 10 * 60 * 1000;
const GAME_MODES = new Set(['orbit', 'destroyer', 'gravity']);

const selectSecurityEvent = appDb.prepare('SELECT data FROM security_events WHERE event_key = ?');
const updateSecurityEvent = appDb.prepare('UPDATE security_events SET data = ? WHERE event_key = ?');
const selectProofRow = appDb.prepare('SELECT data FROM game_session_proofs WHERE session_id = ?');
const upsertProofRow = appDb.prepare(`INSERT INTO game_session_proofs (session_id, data) VALUES (?, ?)
  ON CONFLICT(session_id) DO UPDATE SET data = excluded.data`);
const selectCoinBalance = appDb.prepare('SELECT balance, earned FROM coin_balances WHERE address = ?');
const upsertCoinBalance = appDb.prepare(`INSERT INTO coin_balances (address, balance, earned) VALUES (?, ?, ?)
  ON CONFLICT(address) DO UPDATE SET balance = excluded.balance, earned = excluded.earned`);
const selectDailyCoins = appDb.prepare('SELECT earned FROM game_coin_daily WHERE address = ? AND day = ?');
const upsertDailyCoins = appDb.prepare(`INSERT INTO game_coin_daily (address, day, earned) VALUES (?, ?, ?)
  ON CONFLICT(address, day) DO UPDATE SET earned = excluded.earned`);
const insertCoinLedger = appDb.prepare(`INSERT INTO coin_ledger
  (event_key, address, delta, balance_after, source, session_token_id, proof_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const selectGrant = appDb.prepare('SELECT * FROM revive_grants WHERE grant_id = ?');
const selectGrantByTokenIndex = appDb.prepare('SELECT * FROM revive_grants WHERE session_token_id = ? AND revive_index = ?');
const selectGrantsForToken = appDb.prepare('SELECT * FROM revive_grants WHERE session_token_id = ? ORDER BY revive_index ASC');
const insertGrant = appDb.prepare(`INSERT INTO revive_grants
  (grant_id, session_token_id, wallet, game_mode, revive_index, grant_type, tx_signature, payment_intent_id, issued_at)
  VALUES (@grant_id, @session_token_id, @wallet, @game_mode, @revive_index, @grant_type, @tx_signature, @payment_intent_id, @issued_at)`);
const consumeGrant = appDb.prepare('UPDATE revive_grants SET consumed_at = ?, consumed_proof_id = ? WHERE grant_id = ? AND consumed_at IS NULL');
const selectIntent = appDb.prepare('SELECT * FROM revive_payment_intents WHERE intent_id = ?');
const selectIntentForIndex = appDb.prepare('SELECT * FROM revive_payment_intents WHERE session_token_id = ? AND revive_index = ? ORDER BY expires_at DESC LIMIT 1');
const insertIntent = appDb.prepare(`INSERT INTO revive_payment_intents
  (intent_id, session_token_id, wallet, game_mode, revive_index, memo, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const updateIntentSignature = appDb.prepare('UPDATE revive_payment_intents SET tx_signature = ? WHERE intent_id = ? AND tx_signature IS NULL');
const updateIntentExpiry = appDb.prepare('UPDATE revive_payment_intents SET expires_at = ? WHERE intent_id = ?');
const selectPaymentClaim = appDb.prepare('SELECT * FROM onchain_payment_claims WHERE tx_signature = ?');
const insertPaymentClaim = appDb.prepare('INSERT INTO onchain_payment_claims (tx_signature, purpose, wallet, reference_id, claimed_at) VALUES (?, ?, ?, ?, ?)');
const selectGrantByTx = appDb.prepare('SELECT * FROM revive_grants WHERE tx_signature = ?');
const selectReviveUsage = appDb.prepare('SELECT data FROM revives WHERE address = ?');
const upsertReviveUsage = appDb.prepare(`INSERT INTO revives (address, data) VALUES (?, ?)
  ON CONFLICT(address) DO UPDATE SET data = excluded.data`);

const parseDbJson = (row) => {
  try { return row ? JSON.parse(row.data) : null; } catch { return null; }
};
const dayKey = (nowMs = Date.now()) => new Date(nowMs).toISOString().slice(0, 10);
const tokenKey = (tokenId) => `game-session-token:${tokenId}`;
const stableFingerprint = ({ tokenId, wallet, mode, seed, slot, score, reviveGrantIds, challengeReferenceId }) => crypto
  .createHash('sha256')
  .update(JSON.stringify({ tokenId, wallet, mode, seed, slot, score, reviveGrantIds: [...reviveGrantIds].sort(), challengeReferenceId: challengeReferenceId || null }))
  .digest('hex');

function publicReviveGrant(row, left = undefined) {
  return {
    reviveGrantId: row.grant_id,
    reviveIndex: Number(row.revive_index),
    type: row.grant_type,
    ...(left === undefined ? {} : { left }),
  };
}

// The only money-bearing game settlement.  All state that authorizes the
// result, consumes grants, credits the wallet and records the proof commits in
// this one IMMEDIATE SQLite transaction; JSON/Firebase callers update mirrors
// only after this returns successfully.
const settleGameSessionTx = appDb.transaction((input) => {
  const nowMs = input.submittedAtMs;
  const tokenRecord = parseDbJson(selectSecurityEvent.get(tokenKey(input.tokenId)));
  if (!tokenRecord || tokenRecord.tokenHash !== input.tokenHash) return { ok: false, status: 409, reason: 'invalid_token' };
  if (
    tokenRecord.walletAddress !== input.wallet || tokenRecord.gameMode !== input.mode
    || tokenRecord.purpose !== GAME_SESSION_RESULT_PURPOSE || tokenRecord.seed !== input.seed
    || Number(tokenRecord.slot) !== Number(input.slot)
  ) return { ok: false, status: 403, reason: 'token_binding_mismatch' };

  if (tokenRecord.redeemedAt) {
    if (tokenRecord.settlementFingerprint !== input.fingerprint) return { ok: false, status: 409, reason: 'token_redeemed' };
    const prior = parseDbJson(selectProofRow.get(tokenRecord.proofId));
    return prior ? { ok: true, idempotent: true, entry: prior, credit: prior.creditResult?.body || null, tokenRecord } : { ok: false, status: 409, reason: 'settlement_missing' };
  }
  if (!Number.isFinite(Number(tokenRecord.expiresAtMs)) || Number(tokenRecord.expiresAtMs) <= nowMs) {
    return { ok: false, status: 409, reason: 'expired_token' };
  }
  if (tokenRecord.referenceId) {
    // New records carry the hard proof deadline separately from their submit
    // grace. Older records used expiresAtMs as that deadline, so retain that
    // safe interpretation while they age out.
    const challengeDeadlineMs = Number(tokenRecord.challengeDeadlineMs ?? tokenRecord.expiresAtMs);
    if (!Number.isFinite(challengeDeadlineMs)) return { ok: false, status: 409, reason: 'invalid_challenge_deadline' };
    if (challengeDeadlineMs < nowMs) return { ok: false, status: 409, reason: 'challenge_proof_deadline_passed' };
  }

  const requestedGrantIds = [...new Set(input.reviveGrantIds)];
  if (requestedGrantIds.length > MAX_REVIVES_PER_RUN) {
    return { ok: false, status: 400, reason: 'invalid_revive_grants' };
  }
  const grants = requestedGrantIds.map((id) => selectGrant.get(id));
  if (grants.some((grant) => !grant)) return { ok: false, status: 400, reason: 'unknown_revive_grant' };
  grants.sort((left, right) => Number(left.revive_index) - Number(right.revive_index));
  let freeCount = 0;
  let paidCount = 0;
  for (let i = 0; i < grants.length; i += 1) {
    const grant = grants[i];
    if (
      grant.session_token_id !== tokenRecord.tokenId || grant.wallet !== input.wallet || grant.game_mode !== input.mode
      || Number(grant.revive_index) !== i + 1 || (grant.consumed_proof_id && grant.consumed_proof_id !== input.proofId)
    ) return { ok: false, status: 400, reason: 'invalid_revive_grant' };
    if (grant.grant_type === 'free') freeCount += 1;
    if (grant.grant_type === 'paid') paidCount += 1;
  }
  if (freeCount > MAX_FREE_REVIVES_PER_RUN || paidCount > MAX_PAID_REVIVES_PER_RUN) {
    return { ok: false, status: 400, reason: 'revive_limit_exceeded' };
  }
  // Step 4: consume grants before deriving the settlement.  The surrounding
  // transaction rolls this back with every later validation/write failure.
  for (const grant of grants) {
    if (!grant.consumed_at) consumeGrant.run(nowMs, input.proofId, grant.grant_id);
  }

  const timing = calculateAuthoritativeTiming({
    issuedAtMs: tokenRecord.issuedAtMs,
    submittedAtMs: nowMs,
    pausedMs: tokenRecord.pausedMs,
    openPauseStartedAtMs: tokenRecord.pauseStartedAtMs,
    validGrantCount: grants.length,
  });
  const scoreCeiling = getScoreCeiling(input.mode, timing.scoreCeilingDurationMs);
  const scoreValid = input.score <= scoreCeiling;
  const verified = Boolean(input.seedVerified && timing.timingVerified && scoreValid);
  const survivalTime = formatMMSS(activeSeconds(timing.activeDurationMs));

  const day = dayKey(nowMs);
  const existingDaily = Number(selectDailyCoins.get(input.wallet, day)?.earned || 0);
  const holderMultiplier = Math.max(1, Math.floor(Number(tokenRecord.identityGameCoinMultiplier) || 1));
  const stakingBoost = Math.max(0, Number(tokenRecord.stakingBoost) || 0);
  const challengeRun = Boolean(tokenRecord.referenceId);
  const economicDurationMs = calculateEconomicDurationMs({
    activeDurationMs: timing.activeDurationMs,
    validGrantCount: grants.length,
  });
  const baseAward = Math.min(activeSeconds(economicDurationMs), input.maxDeltaPerGame[input.mode] || 0);
  const requestedAward = baseAward * holderMultiplier;
  const dailyCap = holderMultiplier > 1 ? 2000 : 1000;
  const dailyApplied = verified && !challengeRun ? Math.max(0, Math.min(requestedAward, dailyCap - existingDaily)) : 0;
  const balanceDelta = Math.floor(dailyApplied * (1 + stakingBoost));
  const balanceRow = selectCoinBalance.get(input.wallet);
  const balanceBefore = Number(balanceRow?.balance || 0);
  const balanceAfter = balanceBefore + balanceDelta;
  const creditBody = {
    address: input.wallet,
    coins: balanceAfter,
    earned: balanceDelta,
    dailyRemaining: Math.max(0, dailyCap - (existingDaily + dailyApplied)),
    baseAward,
    dailyApplied,
    ...(challengeRun ? { challengeRun: true } : {}),
  };

  const entry = {
    ...input.entry,
    survivalTime,
    clientReportedSurvivalTime: input.entry.clientReportedSurvivalTime,
    durationMs: timing.activeDurationMs,
    economicDurationMs,
    wallDurationMs: timing.wallDurationMs,
    pausedMs: timing.pausedMs,
    allowedActiveMs: timing.allowedActiveMs,
    scoreCeilingDurationMs: timing.scoreCeilingDurationMs,
    scoreCeiling,
    scoreDelta: Math.max(0, input.score - scoreCeiling),
    timingVerified: timing.timingVerified,
    verified,
    economyEligible: verified,
    competitiveEligible: verified,
    coinsCredited: balanceDelta,
    reviveGrantIds: grants.map((grant) => grant.grant_id),
    challengeReferenceId: tokenRecord.referenceId || null,
    settlementFingerprint: input.fingerprint,
    challengeRun,
    creditResult: { status: 200, body: creditBody },
  };

  const updatedToken = {
    ...tokenRecord,
    proofId: input.proofId,
    redeemedAt: nowMs,
    redeemedPurpose: GAME_SESSION_RESULT_PURPOSE,
    settlementFingerprint: input.fingerprint,
    pausedMs: timing.pausedMs,
    pauseStartedAtMs: null,
    pendingReviveIndex: null,
  };
  updateSecurityEvent.run(JSON.stringify(updatedToken), tokenKey(input.tokenId));
  upsertProofRow.run(input.proofId, JSON.stringify(entry));
  upsertDailyCoins.run(input.wallet, day, existingDaily + dailyApplied);
  upsertCoinBalance.run(input.wallet, balanceAfter, Number(balanceRow?.earned || 0) + balanceDelta);
  insertCoinLedger.run(`game-session:${input.tokenId}`, input.wallet, balanceDelta, balanceAfter, 'game_session', input.tokenId, input.proofId, nowMs);
  return { ok: true, idempotent: false, entry, credit: creditBody, tokenRecord: updatedToken, dailyApplied, balanceAfter };
});

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
          return respondJson(res, 426, { error: 'Client game credit is retired; update required', code: 'CLIENT_UPDATE_REQUIRED' });
          /* legacy implementation intentionally unreachable: client deltas are
             not an economy authority. */
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
      return respondJson(res, 426, { error: 'Secure revive grant requires the v2 session flow', code: 'CLIENT_UPDATE_REQUIRED' });
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
  const { core, wallet, economy, game, arena } = ctx;
  const { ipRateLimit, getClientIp, respondJson, requireJwt, readBody, safeParseJson, getBaseUrl, getRpcUrl, parsePublicKey } = core;
  const { mintedAddresses, getStakingBoost, getCoinBalance, setCoinBalance, addCoinEarned, addCoinSpent } = wallet;
  const { getPrismEarnRateLimit, setPrismEarnRateLimit, nonGameDailyEarnCap, treasuryAddress, skrMint, tokenProgramId, token2022ProgramId } = economy;
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
    getServerIssuedGameSeed,
    reviveData,
    persistReviveData,
  } = game;
  const { activeChallenges } = arena;

  // S4: shared coin-credit core, used by both POST /api/game/coins (v1/v2 legacy earn call)
  // and the S4 same-request credit path in POST /api/game/session. Never calls respondJson —
  // callers translate { status, body } into their own response shape.
  async function creditGameCoins(addr, delta, mode, session) {
    // NTH-6: session.id keys the allowance ledger write below (gameSessionProofs.set(id, ...)).
    // Guard against an old/legacy persisted record missing `id` — without this, a falsy id
    // would silently write the credited-allowance update under an undefined key instead of the
    // real session, letting coinsCredited accounting for that session go unrecorded (and
    // potentially clobber whatever else lives under the `undefined` key in the map).
    const sessionId = session?.id;
    if (!sessionId) {
      return { status: 500, body: { error: 'Invalid session record (missing id)' } };
    }
    if (session.usedForChallenge) {
      return { status: 400, body: { error: 'Challenge game — coins earned from challenge result' } };
    }
    const VALID_GAME_MODES = new Set(['orbit', 'destroyer', 'gravity', 'wars', 'territory']);
    const requestedMode = mode || session.gameMode || 'orbit';
    const gameMode = VALID_GAME_MODES.has(requestedMode) ? requestedMode : 'orbit';
    if (session.gameMode && session.gameMode !== gameMode) {
      return { status: 400, body: { error: 'Session mode mismatch', reason: 'mode_mismatch' } };
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
      return { status: 400, body: { error: 'Delta exceeds maximum for game mode' } };
    }
    const alreadyCredited = Number(session.coinsCredited) || 0;
    const remainingSessionAllowance = Math.max(0, Math.floor(maxDelta - alreadyCredited));
    if (remainingSessionAllowance <= 0) {
      return { status: 400, body: { error: 'Session coin allowance exhausted', reason: 'session_allowance_exhausted' } };
    }
    const todayCoins = getGameCoinsToday(addr);
    const isHolder = mintedAddresses.has(addr);
    const gameCap = isHolder ? dailyGameCoinCap : Math.floor(dailyGameCoinCap / 2);
    if (todayCoins >= gameCap) {
      return {
        status: 200,
        body: { address: addr, coins: getCoinBalance(addr), earned: 0, capped: true, reason: 'daily_cap_exceeded', dailyRemaining: 0 },
      };
    }
    const requestedDelta = Math.min(delta, remainingSessionAllowance * pinnedIdentityGameCoinMultiplier);
    let appliedDelta = requestedDelta;
    if (todayCoins + requestedDelta > gameCap) {
      appliedDelta = gameCap - todayCoins;
    }
    addGameCoinsToday(addr, appliedDelta);
    session.coinsCredited = alreadyCredited + Math.ceil(appliedDelta / pinnedIdentityGameCoinMultiplier);
    gameSessionProofs.set(sessionId, session);
    persistGameSessionProofs();
    const boost = getStakingBoost(addr);
    const effectiveDelta = boost > 0 ? Math.floor(appliedDelta * (1 + boost)) : appliedDelta;
    const current = getCoinBalance(addr);
    const newBalance = current + effectiveDelta;
    setCoinBalance(addr, newBalance);
    addCoinEarned(addr, effectiveDelta);
    return {
      status: 200,
      body: {
        address: addr,
        coins: newBalance,
        earned: effectiveDelta,
        dailyRemaining: Math.max(0, gameCap - getGameCoinsToday(addr)),
        boost: boost > 0 ? boost : undefined,
        idMultiplier: pinnedIdentityGameCoinMultiplier > 1 ? pinnedIdentityGameCoinMultiplier : undefined,
      },
    };
  }

  const getTokenForRevive = (sessionToken, walletAddress, gameMode) => {
    const verified = verifyGameSessionToken(sessionToken);
    if (!verified.ok) return { ok: false, status: 409, reason: verified.reason };
    const record = verified.record;
    if (record.redeemedAt || record.walletAddress !== walletAddress || record.gameMode !== gameMode || record.purpose !== GAME_SESSION_RESULT_PURPOSE) {
      return { ok: false, status: record.walletAddress !== walletAddress ? 403 : 409, reason: 'token_binding_mismatch' };
    }
    return { ok: true, record };
  };

  const pauseSessionTx = appDb.transaction(({ tokenId, tokenHash, wallet, gameMode, reviveIndex, nowMs }) => {
    const record = parseDbJson(selectSecurityEvent.get(tokenKey(tokenId)));
    if (!record || record.tokenHash !== tokenHash || record.walletAddress !== wallet || record.gameMode !== gameMode || record.redeemedAt || !Number.isFinite(Number(record.expiresAtMs)) || Number(record.expiresAtMs) <= nowMs) return { ok: false, reason: 'invalid_token' };
    if (record.pauseStartedAtMs) {
      return Number(record.pendingReviveIndex) === reviveIndex
        ? { ok: true, idempotent: true, record }
        : { ok: false, reason: 'pause_already_open' };
    }
    const updated = { ...record, pauseStartedAtMs: nowMs, pendingReviveIndex: reviveIndex };
    updateSecurityEvent.run(JSON.stringify(updated), tokenKey(tokenId));
    return { ok: true, idempotent: false, record: updated };
  });

  const freeReviveGrantTx = appDb.transaction(({ tokenId, tokenHash, wallet, gameMode, reviveIndex, nowMs, holderEligible }) => {
    const record = parseDbJson(selectSecurityEvent.get(tokenKey(tokenId)));
    if (!record || record.tokenHash !== tokenHash || record.walletAddress !== wallet || record.gameMode !== gameMode || record.redeemedAt || !Number.isFinite(Number(record.expiresAtMs)) || Number(record.expiresAtMs) <= nowMs) return { ok: false, reason: 'invalid_token' };
    const existing = selectGrantByTokenIndex.get(tokenId, reviveIndex);
    if (existing) return existing.grant_type === 'free' ? { ok: true, idempotent: true, grant: existing, record } : { ok: false, reason: 'revive_index_already_paid' };
    if (!record.pauseStartedAtMs || Number(record.pendingReviveIndex) !== reviveIndex) return { ok: false, reason: 'pause_required' };
    if (nowMs - Number(record.pauseStartedAtMs) > MAX_PAUSE_FOR_GRANT_MS) return { ok: false, reason: 'pause_expired' };
    if (!holderEligible) return { ok: false, reason: 'holder_required' };
    const prior = selectGrantsForToken.all(tokenId);
    if (reviveIndex !== prior.length + 1 || reviveIndex > MAX_REVIVES_PER_RUN || prior.filter((row) => row.grant_type === 'free').length >= MAX_FREE_REVIVES_PER_RUN) return { ok: false, reason: 'revive_limit_exceeded' };
    const usage = parseDbJson(selectReviveUsage.get(wallet)) || {};
    const today = dayKey(nowMs);
    const modeUsage = usage[gameMode]?.date === today ? Number(usage[gameMode].used || 0) : 0;
    if (modeUsage >= 3) return { ok: false, reason: 'daily_free_revive_limit' };
    usage[gameMode] = { date: today, used: modeUsage + 1 };
    upsertReviveUsage.run(wallet, JSON.stringify(usage));
    const grant = { grant_id: crypto.randomUUID(), session_token_id: tokenId, wallet, game_mode: gameMode, revive_index: reviveIndex, grant_type: 'free', tx_signature: null, payment_intent_id: null, issued_at: nowMs };
    insertGrant.run(grant);
    const pausedMs = Math.max(0, Number(record.pausedMs) || 0) + (nowMs - Number(record.pauseStartedAtMs));
    const updated = { ...record, pausedMs, pauseStartedAtMs: null, pendingReviveIndex: null };
    updateSecurityEvent.run(JSON.stringify(updated), tokenKey(tokenId));
    return { ok: true, idempotent: false, grant, usage, record: updated };
  });

  const paidReviveConfirmTx = appDb.transaction(({ intentId, txSignature, nowMs }) => {
    const intent = selectIntent.get(intentId);
    if (!intent) return { ok: false, reason: 'intent_not_found' };
    const existingGrant = selectGrantByTx.get(txSignature);
    const existingClaim = selectPaymentClaim.get(txSignature);
    if (existingClaim) {
      if (existingClaim.purpose !== 'revive' || existingClaim.wallet !== intent.wallet || existingClaim.reference_id !== intentId) return { ok: false, reason: 'TX_REPLAY' };
      if (!existingGrant) return { ok: false, reason: 'claim_without_grant' };
      const grants = selectGrantsForToken.all(intent.session_token_id);
      const paidRevivesUsed = grants.filter((grant) => grant.grant_type === 'paid').length;
      return { ok: true, idempotent: true, grant: existingGrant, paidRevivesUsed, left: Math.max(0, MAX_PAID_REVIVES_PER_RUN - paidRevivesUsed) };
    }
    if (intent.tx_signature && intent.tx_signature !== txSignature) return { ok: false, reason: 'TX_REPLAY' };
    const record = parseDbJson(selectSecurityEvent.get(tokenKey(intent.session_token_id)));
    const recordExpiresAtMs = Number(record?.expiresAtMs);
    if (!record || !Number.isFinite(recordExpiresAtMs)) return { ok: false, reason: 'session_token_invalid' };
    // This transaction runs after on-chain verification, so this distinct code
    // tells the caller a landed payment cannot produce a usable revive. Do not
    // claim the signature or create a grant on this path.
    if (recordExpiresAtMs <= nowMs) return { ok: false, reason: 'session_token_expired_after_payment' };
    if (record.redeemedAt) return { ok: false, reason: 'session_token_redeemed_after_payment' };
    if (record.walletAddress !== intent.wallet || record.gameMode !== intent.game_mode || !record.pauseStartedAtMs || Number(record.pendingReviveIndex) !== Number(intent.revive_index)) return { ok: false, reason: 'pause_required' };
    if (nowMs - Number(record.pauseStartedAtMs) > MAX_PAUSE_FOR_GRANT_MS) return { ok: false, reason: 'pause_expired' };
    const indexedGrant = selectGrantByTokenIndex.get(intent.session_token_id, intent.revive_index);
    if (indexedGrant) {
      if (indexedGrant.tx_signature !== txSignature) return { ok: false, reason: 'revive_index_already_used' };
      const grants = selectGrantsForToken.all(intent.session_token_id);
      const paidRevivesUsed = grants.filter((grant) => grant.grant_type === 'paid').length;
      return { ok: true, idempotent: true, grant: indexedGrant, paidRevivesUsed, left: Math.max(0, MAX_PAID_REVIVES_PER_RUN - paidRevivesUsed) };
    }
    const prior = selectGrantsForToken.all(intent.session_token_id);
    if (Number(intent.revive_index) !== prior.length + 1 || prior.filter((row) => row.grant_type === 'paid').length >= MAX_PAID_REVIVES_PER_RUN || prior.length >= MAX_REVIVES_PER_RUN) return { ok: false, reason: 'revive_limit_exceeded' };
    insertPaymentClaim.run(txSignature, 'revive', intent.wallet, intentId, nowMs);
    const grant = { grant_id: crypto.randomUUID(), session_token_id: intent.session_token_id, wallet: intent.wallet, game_mode: intent.game_mode, revive_index: Number(intent.revive_index), grant_type: 'paid', tx_signature: txSignature, payment_intent_id: intentId, issued_at: nowMs };
    insertGrant.run(grant);
    updateIntentSignature.run(txSignature, intentId);
    const pausedMs = Math.max(0, Number(record.pausedMs) || 0) + (nowMs - Number(record.pauseStartedAtMs));
    updateSecurityEvent.run(JSON.stringify({ ...record, pausedMs, pauseStartedAtMs: null, pendingReviveIndex: null }), tokenKey(intent.session_token_id));
    const grants = selectGrantsForToken.all(intent.session_token_id);
    const paidRevivesUsed = grants.filter((row) => row.grant_type === 'paid').length;
    return { ok: true, idempotent: false, grant, paidRevivesUsed, left: Math.max(0, MAX_PAID_REVIVES_PER_RUN - paidRevivesUsed) };
  });

  const verifyPaidReviveTransaction = async ({ txSignature, intent }) => {
    const treasuryKey = parsePublicKey?.(treasuryAddress, 'TREASURY_ADDRESS') || new PublicKey(treasuryAddress);
    const mintKey = new PublicKey(SKR_MINT);
    if (!treasuryAddress) throw new Error('treasury_not_configured');
    // 'confirmed' (not 'finalized') so a paid revive is granted in ~1-2s instead of ~13-30s.
    // Anti-replay holds via the unique txSignature claim + intent window + net-delta checks; a
    // confirmed-then-rolled-back tx is effectively impossible on mainnet and the amount (5 SKR) is small.
    const conn = new Connection(getRpcUrl?.(intent.wallet) || 'https://api.mainnet-beta.solana.com', 'confirmed');
    const tx = await conn.getParsedTransaction(txSignature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) return { pending: true };
    if (tx.meta?.err) return { ok: false, reason: 'transaction_failed' };
    const blockTimeMs = Number(tx.blockTime || 0) * 1000;
    const issuedAtMs = Number(intent.expires_at) - REVIVE_INTENT_TTL_MS;
    if (!blockTimeMs || blockTimeMs < issuedAtMs - 30_000 || blockTimeMs > Number(intent.expires_at) + 30_000) return { ok: false, reason: 'transaction_outside_intent_window' };
    let mintInfo;
    try { mintInfo = { programId: tokenProgramId, info: await getMint(conn, mintKey, 'confirmed', tokenProgramId) }; }
    catch { mintInfo = { programId: token2022ProgramId, info: await getMint(conn, mintKey, 'confirmed', token2022ProgramId) }; }
    const treasuryAta = await getAssociatedTokenAddress(mintKey, treasuryKey, false, mintInfo.programId);
    const accountKeys = tx.transaction.message.accountKeys || [];
    const keyAt = (index) => String(accountKeys[index]?.pubkey || accountKeys[index] || '');
    const feePayer = keyAt(0);
    if (feePayer !== intent.wallet || !accountKeys[0]?.signer) return { ok: false, reason: 'fee_payer_mismatch' };
    const allInstructions = [
      ...(tx.transaction.message.instructions || []),
      ...((tx.meta?.innerInstructions || []).flatMap((group) => group.instructions || [])),
    ];
    const transfer = allInstructions.find((ix) => {
      const info = ix.parsed?.info;
      return (ix.parsed?.type === 'transferChecked' || ix.parsed?.type === 'transfer')
        && String(ix.programId) === mintInfo.programId.toBase58()
        && String(info?.authority || info?.multisigAuthority || '') === intent.wallet
        && String(info?.destination || '') === treasuryAta.toBase58()
        && (ix.parsed?.type !== 'transferChecked' || String(info?.mint || '') === SKR_MINT);
    });
    if (!transfer) return { ok: false, reason: 'transfer_not_found' };
    const source = String(transfer.parsed.info.source || '');
    const tokenAmounts = (rows, account) => (rows || []).find((row) => keyAt(row.accountIndex) === account && row.mint === SKR_MINT)?.uiTokenAmount?.amount || '0';
    const srcPre = BigInt(tokenAmounts(tx.meta?.preTokenBalances, source));
    const srcPost = BigInt(tokenAmounts(tx.meta?.postTokenBalances, source));
    const dstPre = BigInt(tokenAmounts(tx.meta?.preTokenBalances, treasuryAta.toBase58()));
    const dstPost = BigInt(tokenAmounts(tx.meta?.postTokenBalances, treasuryAta.toBase58()));
    const sourceOwner = (tx.meta?.preTokenBalances || []).find((row) => keyAt(row.accountIndex) === source && row.mint === SKR_MINT)?.owner
      || (tx.meta?.postTokenBalances || []).find((row) => keyAt(row.accountIndex) === source && row.mint === SKR_MINT)?.owner;
    if (sourceOwner !== intent.wallet || srcPre - srcPost < REVIVE_AMOUNT_RAW || dstPost - dstPre < REVIVE_AMOUNT_RAW) return { ok: false, reason: 'token_balance_delta_invalid' };
    const memoFound = allInstructions.some((ix) => {
      const program = `${String(ix.program || '')}:${String(ix.programId || ix.programId?.toBase58?.() || '')}`.toLowerCase();
      return (program.includes('memo') || program.includes('memoo') || program.includes('memop'))
        && (ix.parsed === intent.memo || ix.parsed?.memo === intent.memo || ix.parsed?.info?.memo === intent.memo);
    });
    if (!memoFound) return { ok: false, reason: 'memo_mismatch' };
    return { ok: true, treasuryAta: treasuryAta.toBase58() };
  };

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
        let challengeReferenceId = null;
        const getPlayableChallenge = () => {
          const challenge = activeChallenges.find((entry) => entry.id === challengeReferenceId);
          if (!challenge) return { ok: false, status: 404, error: 'Challenge not found' };
          const expiresAtMs = Number(challenge.expiresAt);
          if (
            challenge.type !== 'game'
            || challenge.status !== 'playing'
            || !Number.isFinite(expiresAtMs)
            || expiresAtMs <= Date.now()
          ) {
            return { ok: false, status: 409, error: 'Challenge is not playable' };
          }
          if (challenge.creator !== walletAddress && challenge.opponent !== walletAddress) {
            return { ok: false, status: 403, error: 'Wallet is not a challenge participant' };
          }
          // The creator funds and authorizes the challenge at creation. A direct
          // opponent has no run authorization until their accept transaction sets
          // acceptedAt and locks their stake.
          if (challenge.opponent === walletAddress && !Number.isFinite(Number(challenge.acceptedAt))) {
            return { ok: false, status: 409, error: 'Challenge opponent must accept before starting a bound run' };
          }
          if (challenge.gameMode !== gameMode) return { ok: false, status: 400, error: 'gameMode does not match challenge' };
          return { ok: true, challenge, expiresAtMs };
        };
        if (parsed.challengeReferenceId !== undefined) {
          if (typeof parsed.challengeReferenceId !== 'string' || !parsed.challengeReferenceId.trim()) {
            return respondJson(res, 400, { error: 'challengeReferenceId must be a non-empty string' });
          }
          challengeReferenceId = parsed.challengeReferenceId.trim();
          const playable = getPlayableChallenge();
          if (!playable.ok) return respondJson(res, playable.status, { error: playable.error });
        }
        // S1: seed/slot are now OPTIONAL. Legacy clients that still send both keep the
        // exact old behavior (client-supplied seed, byte-for-byte). If omitted, the server
        // issues its own seed via getServerIssuedGameSeed() (RPC blockhash, 2s cache, 3s
        // timeout, synthetic crypto-random fallback on RPC failure).
        let seed;
        let slot;
        let seedSource;
        if (parsed.seed !== undefined || parsed.slot !== undefined) {
          seed = String(parsed.seed ?? '').trim();
          slot = Number(parsed.slot);
          if (!seed || seed.length < 16) {
            return respondJson(res, 400, { error: 'seed is required' });
          }
          if (!Number.isInteger(slot) || slot <= 0) {
            return respondJson(res, 400, { error: 'slot must be a positive integer' });
          }
          seedSource = 'client';
        } else {
          const serverSeed = await getServerIssuedGameSeed();
          seed = serverSeed.seed;
          slot = serverSeed.slot;
          seedSource = serverSeed.seedSource; // 'server' or 'synthetic' (RPC fallback)
        }

        const holderPerks = await getIdentityHolderPerks(walletAddress);
        // Seed/holder lookups above await. Re-check the mutable challenge state at
        // the last possible point before a challenge-bound token is minted.
        let challengeExpiresAtMs = null;
        if (challengeReferenceId) {
          const playable = getPlayableChallenge();
          if (!playable.ok) return respondJson(res, playable.status, { error: playable.error });
          challengeExpiresAtMs = playable.expiresAtMs;
        }
        const issued = issueGameSessionToken({
          walletAddress,
          gameMode,
          purpose: GAME_SESSION_RESULT_PURPOSE,
          referenceId: challengeReferenceId,
          seed,
          slot,
          seedSource,
          identityGameCoinMultiplier: holderPerks.gameCoinMultiplier,
          stakingBoost: getStakingBoost(walletAddress),
          expiresAtMs: challengeExpiresAtMs === null ? null : challengeExpiresAtMs + CHALLENGE_SUBMIT_GRACE_MS,
          challengeDeadlineMs: challengeExpiresAtMs,
        });
        respondJson(res, 201, {
          sessionToken: issued.token,
          startedAtMs: issued.issuedAtMs,
          expiresAtMs: issued.expiresAtMs,
          seed: issued.seed,
          slot: issued.slot,
          gameMode,
          seedSource: issued.seedSource,
          challengeReferenceId,
          // Real per-day free-revive remaining for this wallet/mode, so the client shows the
          // true count instead of resetting to the daily max every run. Holder-gated client-side.
          freeRevivesLeft: getRevivesLeft(walletAddress, gameMode),
        });
      } catch (error) {
        if (error?.code === 'challenge_session_already_issued' || error?.code === 'challenge_not_playable') {
          return respondJson(res, 409, { error: 'Challenge session token already issued or no longer playable' });
        }
        respondJson(res, 500, { error: 'Failed to start game session' });
      }
      return true;
    }

    if (pathname === '/api/game/session/pause' && req.method === 'POST') {
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const body = safeParseJson(await readBody(req));
        const sessionToken = typeof body?.sessionToken === 'string' ? body.sessionToken.trim() : '';
        const gameMode = typeof body?.gameMode === 'string' ? body.gameMode : '';
        const reviveIndex = Number(body?.reviveIndex);
        if (!sessionToken || !GAME_MODES.has(gameMode) || !Number.isInteger(reviveIndex) || reviveIndex < 1 || reviveIndex > MAX_REVIVES_PER_RUN) return respondJson(res, 400, { error: 'sessionToken, gameMode and reviveIndex are required' });
        const token = getTokenForRevive(sessionToken, jwtAuth.address, gameMode);
        if (!token.ok) return respondJson(res, token.status, { error: 'Invalid game session token', reason: token.reason });
        const result = pauseSessionTx.immediate({ tokenId: token.record.tokenId, tokenHash: token.record.tokenHash, wallet: jwtAuth.address, gameMode, reviveIndex, nowMs: Date.now() });
        if (!result.ok) return respondJson(res, 409, { error: 'Unable to pause session', reason: result.reason });
        return respondJson(res, 200, { paused: true, reviveIndex, idempotent: result.idempotent === true });
      } catch { return respondJson(res, 400, { error: 'Invalid JSON body' }); }
    }

    if (pathname === '/api/game/revives' && req.method === 'POST') {
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const body = safeParseJson(await readBody(req));
        const sessionToken = typeof body?.sessionToken === 'string' ? body.sessionToken.trim() : '';
        const gameMode = typeof body?.gameMode === 'string' ? body.gameMode : '';
        const reviveIndex = Number(body?.reviveIndex);
        if (!sessionToken || !GAME_MODES.has(gameMode) || !Number.isInteger(reviveIndex)) return respondJson(res, 400, { error: 'sessionToken, gameMode and reviveIndex are required' });
        const token = getTokenForRevive(sessionToken, jwtAuth.address, gameMode);
        if (!token.ok) return respondJson(res, token.status, { error: 'Invalid game session token', reason: token.reason });
        const eligible = mintedAddresses.has(jwtAuth.address) || await hasCoreCollectionAsset(jwtAuth.address);
        const result = freeReviveGrantTx.immediate({ tokenId: token.record.tokenId, tokenHash: token.record.tokenHash, wallet: jwtAuth.address, gameMode, reviveIndex, nowMs: Date.now(), holderEligible: eligible });
        if (!result.ok) return respondJson(res, result.reason === 'holder_required' ? 403 : (result.reason === 'daily_free_revive_limit' ? 429 : 409), { error: 'Unable to grant free revive', reason: result.reason });
        if (result.usage && reviveData) {
          reviveData.set(jwtAuth.address, result.usage);
          persistReviveData?.();
        }
        const currentUsage = result.usage || parseDbJson(selectReviveUsage.get(jwtAuth.address)) || {};
        return respondJson(res, 200, publicReviveGrant(result.grant, Math.max(0, 3 - Number(currentUsage?.[gameMode]?.used || 0))));
      } catch { return respondJson(res, 400, { error: 'Invalid JSON body' }); }
    }

    if (pathname === '/api/game/revives/paid/prepare' && req.method === 'POST') {
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const body = safeParseJson(await readBody(req));
        const sessionToken = typeof body?.sessionToken === 'string' ? body.sessionToken.trim() : '';
        const gameMode = typeof body?.gameMode === 'string' ? body.gameMode : '';
        const reviveIndex = Number(body?.reviveIndex);
        if (!sessionToken || !GAME_MODES.has(gameMode) || !Number.isInteger(reviveIndex)) return respondJson(res, 400, { error: 'sessionToken, gameMode and reviveIndex are required' });
        const token = getTokenForRevive(sessionToken, jwtAuth.address, gameMode);
        if (!token.ok) return respondJson(res, token.status, { error: 'Invalid game session token', reason: token.reason });
        const existing = selectIntentForIndex.get(token.record.tokenId, reviveIndex);
        const nowMs = Date.now();
        const sessionExpiresAtMs = Number(token.record.expiresAtMs);
        let intent = existing && Number(existing.expires_at) >= nowMs ? existing : null;
        if (intent && Number(intent.expires_at) > sessionExpiresAtMs) {
          updateIntentExpiry.run(sessionExpiresAtMs, intent.intent_id);
          intent = { ...intent, expires_at: sessionExpiresAtMs };
        }
        if (!intent) {
          const opened = token.record.pauseStartedAtMs && Number(token.record.pendingReviveIndex) === reviveIndex;
          if (!opened || nowMs - Number(token.record.pauseStartedAtMs) > MAX_PAUSE_FOR_GRANT_MS) return respondJson(res, 409, { error: 'Active pause required for paid revive', reason: 'pause_required' });
          const prior = selectGrantsForToken.all(token.record.tokenId);
          if (reviveIndex !== prior.length + 1 || prior.length >= MAX_REVIVES_PER_RUN || prior.filter((row) => row.grant_type === 'paid').length >= MAX_PAID_REVIVES_PER_RUN) return respondJson(res, 409, { error: 'Revive limit reached', reason: 'revive_limit_exceeded' });
          const intentId = crypto.randomUUID();
          const intentExpiresAtMs = Math.min(nowMs + REVIVE_INTENT_TTL_MS, sessionExpiresAtMs);
          if (intentExpiresAtMs <= nowMs) return respondJson(res, 409, { error: 'Game session token expired', reason: 'expired_token' });
          intent = { intent_id: intentId, session_token_id: token.record.tokenId, wallet: jwtAuth.address, game_mode: gameMode, revive_index: reviveIndex, memo: `identity-prism:revive:${intentId}`, expires_at: intentExpiresAtMs, tx_signature: null };
          insertIntent.run(intent.intent_id, intent.session_token_id, intent.wallet, intent.game_mode, intent.revive_index, intent.memo, intent.expires_at);
        }
        const treasuryKey = parsePublicKey?.(treasuryAddress, 'TREASURY_ADDRESS') || new PublicKey(treasuryAddress);
        const mintKey = new PublicKey(SKR_MINT);
        const conn = new Connection(getRpcUrl?.(jwtAuth.address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
        let mintProgram = tokenProgramId;
        try { await getMint(conn, mintKey, 'confirmed', mintProgram); } catch { mintProgram = token2022ProgramId; }
        const treasuryAta = await getAssociatedTokenAddress(mintKey, treasuryKey, false, mintProgram);
        return respondJson(res, 200, { paymentIntentId: intent.intent_id, memo: intent.memo, mint: SKR_MINT, amountRaw: REVIVE_AMOUNT_RAW.toString(), treasury: treasuryAddress, treasuryAta: treasuryAta.toBase58(), expiresAtMs: Number(intent.expires_at) });
      } catch (error) { return respondJson(res, 400, { error: 'Unable to prepare paid revive', reason: error?.message || 'invalid_request' }); }
    }

    if (pathname === '/api/game/revives/paid/confirm' && req.method === 'POST') {
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const body = safeParseJson(await readBody(req));
        const paymentIntentId = typeof body?.paymentIntentId === 'string' ? body.paymentIntentId : '';
        const txSignature = typeof body?.txSignature === 'string' ? body.txSignature : '';
        const intent = selectIntent.get(paymentIntentId);
        if (!intent || !txSignature) return respondJson(res, 400, { error: 'paymentIntentId and txSignature are required' });
        if (intent.wallet !== jwtAuth.address) return respondJson(res, 403, { error: 'Wallet address mismatch' });
        if (Number(intent.expires_at) < Date.now() && intent.tx_signature !== txSignature) return respondJson(res, 409, { error: 'Payment intent expired' });
        const verification = await verifyPaidReviveTransaction({ txSignature, intent });
        if (verification.pending) return respondJson(res, 202, { status: 'PAYMENT_PENDING' });
        if (!verification.ok) return respondJson(res, 400, { error: 'Payment verification failed', reason: verification.reason });
        const result = paidReviveConfirmTx.immediate({ intentId: paymentIntentId, txSignature, nowMs: Date.now() });
        if (!result.ok) {
          if (result.reason === 'session_token_expired_after_payment') {
            return respondJson(res, 409, { error: 'Game session expired; confirmed payment cannot grant a revive', code: 'SESSION_TOKEN_EXPIRED_AFTER_PAYMENT', reason: result.reason });
          }
          return respondJson(res, result.reason === 'TX_REPLAY' ? 409 : 400, { error: 'Unable to grant paid revive', reason: result.reason });
        }
        return respondJson(res, 200, { ...publicReviveGrant(result.grant, result.left), paymentIntentId, txSignature, idempotent: result.idempotent === true, paidRevivesUsed: result.paidRevivesUsed });
      } catch (error) { return respondJson(res, 400, { error: 'Payment verification failed', reason: error?.message || 'invalid_request' }); }
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
          // Token-backed sessions derive their authoritative window from the
          // server token. Let a settled retry carry its original client times
          // past that window; an unsettled expired token is still rejected.
          payload = normalizeGameSessionPayload(parsed, { allowStaleTimestamps: !legacyMode });
        } catch (error) {
          respondJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
          return true;
        }
        if (payload.walletAddress !== jwtAuth.address) {
          return respondJson(res, 403, { error: 'Wallet address mismatch' });
        }
        const reviveGrantIds = Array.isArray(parsed.reviveGrantIds)
          ? [...new Set(parsed.reviveGrantIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))]
          : [];

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

        const settlementFingerprint = !legacyMode
          ? stableFingerprint({
            tokenId: tokenRecord.tokenId,
            wallet: payload.walletAddress,
            mode: payload.gameMode,
            seed: payload.seed,
            slot: payload.slot,
            score: payload.score,
            reviveGrantIds,
            challengeReferenceId: tokenRecord.referenceId,
          })
          : null;

        pruneGameSessionProofs();

        // S2: token-mode with a server-issued (or synthetic-fallback) seed skips the
        // MagicBlock RPC wait entirely — the seed's authenticity is already guaranteed by
        // the token binding (tokenRecord.seed/slot === payload.seed/slot, checked above),
        // not by an RPC round-trip. Legacy mode and token-mode with a client-supplied seed
        // are UNCHANGED (still await verifyMagicBlockSeedSlot) for byte-for-byte compat.
        const serverIssuedFastPath = !legacyMode && (tokenRecord.seedSource === 'server' || tokenRecord.seedSource === 'synthetic');
        const verification = serverIssuedFastPath
          ? {
              rpcHealthy: false,
              slotFound: false,
              seedMatchesSlot: false, // honest: not RPC-checked synchronously; NOT claimed true
              slotBlockhash: null,
              slotBlockTimeMs: null,
              seedIssuedByServer: true,
              reason: 'unverified',
            }
          : await verifyMagicBlockSeedSlot(payload.seed, payload.slot);

        let serverStartedAtMs;
        let serverEndedAtMs;
        let durationMs;
        let timingVerified;
        if (!legacyMode) {
          serverStartedAtMs = tokenRecord.issuedAtMs;
          serverEndedAtMs = submittedAtMs;
          const preliminaryTiming = calculateAuthoritativeTiming({
            issuedAtMs: serverStartedAtMs,
            submittedAtMs: serverEndedAtMs,
            pausedMs: tokenRecord.pausedMs,
            openPauseStartedAtMs: tokenRecord.pauseStartedAtMs,
            validGrantCount: reviveGrantIds.length,
          });
          durationMs = preliminaryTiming.activeDurationMs;
          timingVerified = preliminaryTiming.timingVerified;
        } else {
          serverStartedAtMs = payload.startedAtMs;
          serverEndedAtMs = payload.endedAtMs;
          const serverReceiptMs = Date.now();
          const clientDurationMs = payload.endedAtMs - payload.startedAtMs; // normalize guarantees >=0
          durationMs = clientDurationMs;
          if (Number.isFinite(Number(verification.slotBlockTimeMs))) {
            const slotMs = Number(verification.slotBlockTimeMs);
            const authElapsedMs = Math.min(payload.endedAtMs, serverReceiptMs) - slotMs;
            const windowValid = (serverReceiptMs - slotMs) <= 70 * 60 * 1000 && authElapsedMs > 0;
            const durationValid = clientDurationMs <= authElapsedMs + 120_000;
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

        // A retry is keyed by the signed token plus its order-independent
        // fingerprint. It deliberately precedes all new-settlement expiry work.
        if (!legacyMode && tokenRecord.redeemedAt && tokenRecord.proofId) {
          const savedEntry = gameSessionProofs.get(tokenRecord.proofId) || parseDbJson(selectProofRow.get(tokenRecord.proofId));
          if (savedEntry && tokenRecord.settlementFingerprint === settlementFingerprint) {
            const idempotentBody = { session: toPublicGameSessionProof(savedEntry) };
            if (savedEntry.creditResult?.body) {
              idempotentBody.credit = { ...savedEntry.creditResult.body, alreadyCredited: true };
            }
            respondJson(res, 200, idempotentBody);
            return true;
          }
        }

        const preliminaryScoreDurationMs = !legacyMode
          ? Math.min(durationMs, calculateAuthoritativeTiming({
            issuedAtMs: tokenRecord.issuedAtMs,
            submittedAtMs: submittedAtMs,
            pausedMs: tokenRecord.pausedMs,
            openPauseStartedAtMs: tokenRecord.pauseStartedAtMs,
            validGrantCount: reviveGrantIds.length,
          }).scoreCeilingDurationMs)
          : durationMs;
        const preliminaryScoreCeiling = getScoreCeiling(payload.gameMode, preliminaryScoreDurationMs);
        const scoreDelta = Math.max(0, payload.score - preliminaryScoreCeiling);
        const modeScoreValid = payload.score <= preliminaryScoreCeiling;
        const maxSeedStartDriftMs = 120_000;
        const seedStartDeltaMs = Number.isFinite(Number(verification.slotBlockTimeMs))
          ? Math.abs(serverStartedAtMs - Number(verification.slotBlockTimeMs))
          : 0;
        const seedTimeValid = !Number.isFinite(Number(verification.slotBlockTimeMs)) || seedStartDeltaMs <= maxSeedStartDriftMs;
        const nowIso = new Date().toISOString();
        const baseUrl = getBaseUrl(req);
        const proofUrl = baseUrl ? `${baseUrl}/api/game/session/${encodeURIComponent(id)}` : null;

        let verified;
        let reason;
        if (serverIssuedFastPath) {
          // Seed is authentic by construction (server issued it and bound it to the token);
          // local, server-authoritative checks only — no RPC round-trip on the money path.
          verified = timingVerified && modeScoreValid;
          const timingReason = timingVerified ? '' : '; server-timed duration exceeds maximum';
          reason = verified
            ? 'Server-issued seed; server-authoritative timing verified'
            : `Server-issued seed; server-authoritative timing verified but result rejected; score exceeds ceiling=${preliminaryScoreCeiling}${timingReason}`;
        } else {
          verified =
            timingVerified && verification.seedMatchesSlot && seedTimeValid && modeScoreValid;
          const seedDeltaReason = seedTimeValid ? '' : `; seed/start delta=${Math.round(seedStartDeltaMs / 1000)}s`;
          const timingReason = timingVerified ? '' : '; server-timed duration exceeds maximum';
          reason = verified
            ? 'Seed matches MagicBlock slot and score is valid for server-authoritative duration'
            : `${verification.reason}; score delta=${scoreDelta}s${seedDeltaReason}${timingReason}`;
        }

        // S2: slot-dedup only applies to legacy submissions. Token-mode single-use is
        // already guaranteed by the bind/redeem below; applying this here too would give
        // false 'slot_already_used' on fast restarts against the 2s server-seed cache
        // (two legitimate sessions could share a cached seed/slot pair).
        if (legacyMode) {
          for (const [key, prev] of gameSessionProofs) {
            if (prev && prev.walletAddress === payload.walletAddress && prev.slot === payload.slot && key !== id) {
              if ((Number(prev.coinsCredited) || 0) > 0 || prev.usedForTournament || prev.usedForChallenge || prev.usedForLeaderboard) {
                return respondJson(res, 409, { error: 'A session for this slot was already registered and used', reason: 'slot_already_used' });
              }
              gameSessionProofs.delete(key); // honest retry / re-register of an UNUSED session — replace it
            }
          }
        }

        const existingSession = gameSessionProofs.get(id);
        if (existingSession && (existingSession.usedForTournament || existingSession.usedForChallenge || existingSession.usedForLeaderboard)) {
          return respondJson(res, 409, { error: 'Session already registered and used competitively' });
        }

        const entry = {
          id,
          hash,
          walletAddress: payload.walletAddress,
          score: payload.score,
          survivalTime: legacyMode ? payload.survivalTime : formatMMSS(activeSeconds(durationMs)),
          clientReportedSurvivalTime: payload.survivalTime,
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
          txSignature: payload.txSignature ?? null, // MF-2: needed to compare stable fields on idempotent replay
          proofUrl,
          verification: {
            ...verification,
            reason,
          },
          createdAt: nowIso,
          lastVerifiedAt: nowIso,
          createdAtMs: Date.now(),
          coinsCredited: existingSession?.coinsCredited ?? 0,
          identityGameCoinMultiplier: legacyMode
            ? null
            : Math.max(1, Math.floor(Number(tokenRecord.identityGameCoinMultiplier) || 1)),
          usedForTournament: existingSession?.usedForTournament ?? null,
          usedForChallenge: existingSession?.usedForChallenge ?? null,
          usedForLeaderboard: existingSession?.usedForLeaderboard ?? null,
          sessionTokenId: legacyMode ? null : tokenRecord.tokenId,
          sessionPurpose: legacyMode ? null : tokenRecord.purpose,
          sessionReferenceId: legacyMode ? null : tokenRecord.referenceId,
          sessionTokenExpiresAtMs: legacyMode ? null : tokenRecord.expiresAtMs,
          seedSource: legacyMode ? 'client' : (tokenRecord.seedSource || 'client'),
          economyEligible: false,
          competitiveEligible: false,
          creditResult: null, // S4: filled below on first creation only; replay returns this saved value
        };

        let committedEntry = entry;
        let creditResult = null;
        if (!legacyMode) {
          const settled = settleGameSessionTx.immediate({
            tokenId: tokenRecord.tokenId,
            tokenHash: tokenRecord.tokenHash,
            wallet: payload.walletAddress,
            mode: payload.gameMode,
            seed: payload.seed,
            slot: payload.slot,
            score: payload.score,
            proofId: id,
            fingerprint: settlementFingerprint,
            reviveGrantIds,
            submittedAtMs,
            seedVerified: serverIssuedFastPath || (verification.seedMatchesSlot && seedTimeValid),
            entry,
            maxDeltaPerGame,
          });
          if (!settled.ok) return respondJson(res, settled.status || 409, { error: 'Game session cannot be settled', reason: settled.reason });
          committedEntry = settled.entry;
          creditResult = settled.credit;
          // coinsDelta is intentionally telemetry-only; the transaction derives credit
          // solely from server wall/paused time and values pinned at session start.
        }
        if (gameSessionProofs.size >= maxGameSessionProofs && !gameSessionProofs.has(committedEntry.id)) {
          const evict = [...gameSessionProofs.entries()].find(([, value]) => !value?.usedForTournament && !value?.usedForChallenge && !value?.usedForLeaderboard)
            || gameSessionProofs.entries().next().value;
          if (evict?.[0]) gameSessionProofs.delete(evict[0]);
        }
        // Mirror updates happen only after settleGameSessionTx committed.
        gameSessionProofs.set(committedEntry.id, committedEntry);
        persistGameSessionProofs();
        if (!legacyMode && creditResult) {
          setCoinBalance(payload.walletAddress, creditResult.coins);
          if (creditResult.earned > 0) addCoinEarned(payload.walletAddress, creditResult.earned);
        }
        const responseBody = { session: toPublicGameSessionProof(committedEntry) };
        if (creditResult) responseBody.credit = { ...creditResult };
        respondJson(res, 200, responseBody);

        // S2: fire-and-forget MagicBlock decoration. Only for a genuine server-issued seed
        // (seedSource === 'server' — a synthetic seed has nothing real to check against RPC).
        // Purely cosmetic: updates entry.verification for the next GET /api/game/session/:id
        // badge read; NEVER touches verified/coinsCredited/credit — money is already settled.
        if (!legacyMode && tokenRecord.seedSource === 'server') {
          verifyMagicBlockSeedSlot(payload.seed, payload.slot)
            .then((decoration) => {
              const current = gameSessionProofs.get(committedEntry.id);
              if (!current) return;
              gameSessionProofs.set(committedEntry.id, {
                ...current,
                verification: { ...current.verification, ...decoration },
                lastVerifiedAt: new Date().toISOString(),
              });
              persistGameSessionProofs();
            })
            .catch(() => {});
        }
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
        const modeScoreValid = existing.score <= getScoreCeiling(existing.gameMode, existing.durationMs);
        const maxSeedStartDriftMs = 120_000;
        const seedStartDeltaMs = Number.isFinite(Number(verification.slotBlockTimeMs))
          ? Math.abs((existing.startedAtMs || 0) - Number(verification.slotBlockTimeMs))
          : existing.seedStartDeltaMs ?? 0;
        const seedTimeValid = !Number.isFinite(Number(verification.slotBlockTimeMs)) || seedStartDeltaMs <= maxSeedStartDriftMs;
        const recomputedVerified =
          existing.timingVerified !== false
          && verification.seedMatchesSlot
          && seedTimeValid
          && modeScoreValid;
        // NTH-1: server/synthetic-issued seeds (seedSource !== 'client') were never picked by
        // the client from a live MagicBlock block — their slot is a server-issued value (or
        // Date.now() for the synthetic fallback), so this periodic getBlock re-check can
        // legitimately fail to match even though the original submission was correctly
        // verified server-side via the S2 fast path. Never let this re-verify DOWNGRADE an
        // already-verified non-client-seed session (that would wrongly strip on-chain bonus
        // eligibility); still allow an upgrade (false -> true) for any session.
        const isNonClientSeed = Boolean(existing.seedSource) && existing.seedSource !== 'client';
        const downgradeGuarded = isNonClientSeed && existing.verified === true && !recomputedVerified;
        const verified = downgradeGuarded ? true : recomputedVerified;
        const seedDeltaReason = seedTimeValid ? '' : `; seed/start delta=${Math.round(seedStartDeltaMs / 1000)}s`;
        const reason = downgradeGuarded
          ? 'Server-issued seed; keeping prior verified result (RPC re-check is not authoritative for non-client seeds)'
          : verified
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
          return respondJson(res, 410, { error: 'Gameplay credit is settled only by POST /api/v2/game/session', code: 'CLIENT_GAME_CREDIT_DISABLED' });
          const gameSessionId = parsed.gameSessionId;
          if (!gameSessionId) return respondJson(res, 400, { error: 'gameSessionId required for earning coins' });
          const session = gameSessionProofs.get(gameSessionId);
          if (!session || !session.verified || !session.timingVerified) {
            return respondJson(res, 400, { error: 'Invalid or unverified game session timing' });
          }
          if (session.walletAddress !== addr) return respondJson(res, 403, { error: 'Session wallet mismatch' });
          // S4: shared allowance core (also used by POST /api/game/session's same-request
          // credit). session.coinsCredited is the single allowance ledger for this session
          // id, so a same-request S4 credit and a follow-up /api/game/coins call (e.g. the
          // on-chain ×1.5 bonus) can never double-spend — both draw from the same field.
          const creditResult = await creditGameCoins(addr, delta, mode, session);
          respondJson(res, creditResult.status, creditResult.body);
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
