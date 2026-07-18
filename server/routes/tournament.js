import { getScoreCeiling } from '../services/gameRules.js';

function registerTournamentRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      verifyJwt,
      requireJwt,
      readBody,
    },
    wallet: {
      getCoinBalance,
      setCoinBalance,
      addCoinSpent,
      gameSessionProofs,
      persistGameSessionProofs,
    },
    economy: {
      totalBurned,
    },
    tournament: {
      checkTournaments,
      tournamentTiers,
      tournamentModes = ['orbit', 'destroyer', 'gravity'],
      tournamentResponseModes,
      activeTournaments,
      getTournamentBasePrizes,
      tournamentXpRewards,
      saveTournament,
      completedTournaments,
    },
    game: {
      verifyMagicBlockSeedSlot,
    } = {},
    pushNotification,
  } = ctx;

  const playableModes = Array.isArray(tournamentModes) && tournamentModes.length > 0
    ? tournamentModes
    : ['orbit', 'destroyer', 'gravity'];
  const responseModes = Array.isArray(tournamentResponseModes) && tournamentResponseModes.length > 0
    ? tournamentResponseModes
    : Array.from(new Set([...playableModes, 'wars']));
  const normalizeTournamentMode = (mode) => {
    if (mode === 'defender') return 'destroyer';
    return playableModes.includes(mode) ? mode : null;
  };
  const capitalize = (value) => value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
  const getTierModeMap = (tier) => {
    const value = activeTournaments[tier];
    if (!value || typeof value !== 'object') return {};
    if (typeof value.id === 'string') {
      const mode = normalizeTournamentMode(value.mode) || playableModes[0];
      return { [mode]: value };
    }
    return value;
  };
  const getActiveTournament = (tier, mode) => {
    const normalizedMode = normalizeTournamentMode(mode);
    if (!normalizedMode) return null;
    return getTierModeMap(tier)?.[normalizedMode] || null;
  };
  const serializeTournament = (tier, mode, tournament, userAddr) => {
    if (!tournament) return null;
    const entries = tournament.entries && typeof tournament.entries === 'object' ? tournament.entries : {};
    const userJoined = !!(userAddr && entries[userAddr]);
    const entriesArr = Object.entries(entries)
      .map(([address, data]) => ({ address, score: data.score, submittedAt: data.submittedAt }))
      .sort((a, b) => b.score - a.score);
    const participantCount = entriesArr.length;
    return {
      id: tournament.id,
      tier,
      mode,
      entryFee: tournament.entryFee,
      label: tournament.label || tournamentTiers[tier].label,
      prizePool: tournament.prizePool,
      basePrizes: getTournamentBasePrizes(tier, participantCount),
      startTime: tournament.startTime,
      endTime: tournament.endTime,
      status: tournament.status,
      entriesCount: participantCount,
      endsAt: tournament.endTime,
      entryCount: participantCount,
      isEnded: tournament.status === 'ended',
      userJoined,
      xpRewards: tournamentXpRewards[tier] || [],
      entries: userJoined ? entriesArr.slice(0, 50) : [],
      resultsHidden: !userJoined,
    };
  };

  async function reverifySession(session) {
    if (!session || typeof verifyMagicBlockSeedSlot !== 'function') return session;
    if (session.verified) return session;
    if (!session.seed || !session.slot) return session;
    try {
      const verification = await Promise.race([
        verifyMagicBlockSeedSlot(session.seed, session.slot),
        new Promise((resolve) => setTimeout(() => resolve({ rpcHealthy: false, seedMatchesSlot: false, reason: 'reverify_timeout' }), 4000)),
      ]);
      if (!verification || !verification.rpcHealthy) return session;
      const modeScoreValid = session.score <= getScoreCeiling(session.gameMode, session.durationMs);
      const maxSeedStartDriftMs = 120_000;
      const seedStartDeltaMs = Number.isFinite(Number(verification.slotBlockTimeMs))
        ? Math.abs((session.startedAtMs || 0) - Number(verification.slotBlockTimeMs))
        : session.seedStartDeltaMs ?? 0;
      const seedTimeValid = !Number.isFinite(Number(verification.slotBlockTimeMs)) || seedStartDeltaMs <= maxSeedStartDriftMs;
      const verified =
        verification.seedMatchesSlot && seedTimeValid && modeScoreValid;
      if (verified !== session.verified) {
        const refreshed = {
          ...session,
          verified,
          seedStartDeltaMs,
          verification: { ...verification, reason: verified ? 'Re-verified at tournament submit' : (verification.reason || 'reverify_failed') },
          lastVerifiedAt: new Date().toISOString(),
        };
        gameSessionProofs.set(session.id, refreshed);
        persistGameSessionProofs();
        return refreshed;
      }
    } catch {}
    return session;
  }

  return async function handleTournamentRoute(req, res, url, pathname) {
    if (pathname === '/api/tournament/active' && req.method === 'GET') {
      if (!ipRateLimit('tourney_active', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      checkTournaments();
      let userAddr = null;
      try {
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const decoded = verifyJwt(authHeader.slice(7));
          if (decoded.address) userAddr = decoded.address;
        }
      } catch {}
      const tournaments = {};
      for (const tier of Object.keys(tournamentTiers)) {
        const byMode = getTierModeMap(tier);
        tournaments[tier] = {};
        for (const mode of responseModes) {
          const normalizedMode = normalizeTournamentMode(mode);
          const tournament = normalizedMode ? byMode[normalizedMode] : null;
          tournaments[tier][mode] = serializeTournament(tier, normalizedMode || mode, tournament, userAddr);
        }
      }
      respondJson(res, 200, { tournaments, tournament: tournaments.daily?.orbit || null });
      return true;
    }

    if (pathname === '/api/tournament/join' && req.method === 'POST') {
      if (!ipRateLimit('tourn_join', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      checkTournaments();
      let tier = 'daily';
      let requestedMode = null;
      try {
        const body = JSON.parse(await readBody(req));
        if (body.tier) tier = body.tier;
        if (body.mode) requestedMode = body.mode;
      } catch {}
      if (!tournamentTiers[tier]) return respondJson(res, 400, { error: 'Invalid tier' });
      if (!requestedMode) return respondJson(res, 400, { error: 'mode required', reason: 'mode_required' });
      const mode = normalizeTournamentMode(requestedMode);
      if (!mode) return respondJson(res, 400, { error: 'Invalid mode', reason: 'invalid_mode' });
      const tournament = getActiveTournament(tier, mode);
      if (!tournament) return respondJson(res, 400, { error: 'No active tournament for this tier/mode' });
      const addr = jwtAuth.address;
      if (tournament.entries[addr]) {
        const msg = `You already joined the ${tier} tournament (${capitalize(mode)}).`;
        return respondJson(res, 400, { error: msg, reason: 'already_joined' });
      }
      tournament.entries[addr] = { score: 0, submittedAt: null };
      const fee = tournament.entryFee;
      const bal = getCoinBalance(addr);
      if (bal < fee) {
        delete tournament.entries[addr];
        return respondJson(res, 400, { error: `Insufficient balance. Entry fee: ${fee} Coins` });
      }
      const burnAmt = Math.max(1, Math.floor(fee * tournamentTiers[tier].burnRate));
      const net = fee - burnAmt;
      totalBurned.value += burnAmt;
      setCoinBalance(addr, bal - fee);
      addCoinSpent(addr, fee);
      tournament.prizePool += net;
      saveTournament();
      pushNotification(
        addr,
        'tournament_result',
        `Joined ${tier} ${mode} tournament — ${fee} coins entry`,
        { tier, mode, entryFee: fee, prizePool: tournament.prizePool },
      );
      respondJson(res, 200, { success: true, tier, mode, prizePool: tournament.prizePool, newBalance: bal - fee, burned: burnAmt });
      return true;
    }

    if (pathname === '/api/tournament/submit' && req.method === 'POST') {
      if (!ipRateLimit('tourn_submit', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests', reason: 'rate_limited' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      checkTournaments();
      try {
        const body = JSON.parse(await readBody(req));
        const { score, tier: reqTier, gameSessionId, mode: bodyMode } = body;
        const tier = reqTier || 'daily';
        if (!tournamentTiers[tier]) return respondJson(res, 400, { error: 'Invalid tier', reason: 'invalid_tier' });
        const addr = jwtAuth.address;
        if (typeof score !== 'number' || score <= 0) return respondJson(res, 400, { error: 'Valid score required', reason: 'invalid_score' });
        if (!gameSessionId) return respondJson(res, 400, { error: 'gameSessionId required for tournament', reason: 'session_id_required' });
        let tSession = gameSessionProofs.get(gameSessionId);
        if (!tSession || !tSession.sessionTokenId || tSession.timingVerified !== true || tSession.economyEligible !== true || tSession.competitiveEligible !== true) {
          return respondJson(res, 400, { error: 'Token-backed, timing-verified game session required', reason: 'session_not_found' });
        }
        if (!tSession.verified) {
          tSession = await reverifySession(tSession);
          if (!tSession.verified) {
            return respondJson(res, 400, { error: 'Game session not yet verified — try again in a few seconds', reason: 'unverified_session' });
          }
        }
        if (tSession.walletAddress !== addr) return respondJson(res, 403, { error: 'Session wallet mismatch', reason: 'wallet_mismatch' });
        if (tSession.score !== score) return respondJson(res, 400, { error: 'Score does not match session proof', reason: 'score_proof_mismatch' });
        const requestedMode = bodyMode || tSession.gameMode;
        if (!requestedMode) return respondJson(res, 400, { error: 'mode required', reason: 'mode_required' });
        const mode = normalizeTournamentMode(requestedMode);
        if (!mode) return respondJson(res, 400, { error: 'Invalid mode', reason: 'invalid_mode' });
        if (tSession.gameMode && tSession.gameMode !== mode) {
          return respondJson(res, 400, {
            error: 'Session gameMode does not match submitted mode',
            reason: 'mode_mismatch',
            expected: mode,
            got: tSession.gameMode,
          });
        }
        const tournament = getActiveTournament(tier, mode);
        if (!tournament || tournament.status === 'ended' || Date.now() > tournament.endTime) return respondJson(res, 400, { error: 'Tournament has ended', reason: 'tournament_ended' });
        if (!tournament.entries[addr]) return respondJson(res, 400, { error: 'Not joined', reason: 'not_joined' });
        if (tSession.usedForTournament) return respondJson(res, 400, { error: 'Session already used for a tournament submission', reason: 'session_used' });
        const scoreCeiling = Number(tSession.scoreCeiling);
        if (!Number.isFinite(scoreCeiling) || scoreCeiling !== getScoreCeiling(mode, tSession.durationMs) || score > scoreCeiling) {
          return respondJson(res, 400, { error: 'Score exceeds maximum', reason: 'score_too_high' });
        }
        tSession.usedForTournament = { tier, mode, addr, at: Date.now() };
        persistGameSessionProofs();
        const previousScore = tournament.entries[addr].score || 0;
        const improved = score > previousScore;
        if (improved) {
          tournament.entries[addr] = { score, submittedAt: new Date().toISOString() };
          saveTournament();
        }
        respondJson(res, 200, { success: true, tier, mode, score: tournament.entries[addr].score, previousScore, improved });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body', reason: 'invalid_json' });
      }
      return true;
    }

    if (pathname === '/api/tournament/history' && req.method === 'GET') {
      if (!ipRateLimit('t_hist', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      respondJson(res, 200, { tournaments: completedTournaments.slice(0, 20) });
      return true;
    }

    return false;
  };
}

export { registerTournamentRoute };
