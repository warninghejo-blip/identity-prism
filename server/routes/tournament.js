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
      activeTournaments,
      getTournamentBasePrizes,
      tournamentXpRewards,
      saveTournament,
      completedTournaments,
    },
  } = ctx;

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
        const tournament = activeTournaments[tier];
        if (!tournament) {
          tournaments[tier] = null;
          continue;
        }
        const userJoined = !!(userAddr && tournament.entries[userAddr]);
        const entriesArr = Object.entries(tournament.entries)
          .map(([address, data]) => ({ address, score: data.score, submittedAt: data.submittedAt }))
          .sort((a, b) => b.score - a.score);
        const participantCount = entriesArr.length;
        tournaments[tier] = {
          id: tournament.id,
          tier,
          mode: tournament.mode,
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
      }
      respondJson(res, 200, { tournaments, tournament: tournaments.daily });
      return true;
    }

    if (pathname === '/api/tournament/join' && req.method === 'POST') {
      if (!ipRateLimit('tourn_join', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      checkTournaments();
      let tier = 'daily';
      try {
        const body = JSON.parse(await readBody(req));
        if (body.tier) tier = body.tier;
      } catch {}
      if (!tournamentTiers[tier]) return respondJson(res, 400, { error: 'Invalid tier' });
      const tournament = activeTournaments[tier];
      if (!tournament) return respondJson(res, 400, { error: 'No active tournament for this tier' });
      const addr = jwtAuth.address;
      if (tournament.entries[addr]) return respondJson(res, 400, { error: 'Already joined' });
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
      respondJson(res, 200, { success: true, tier, prizePool: tournament.prizePool, newBalance: bal - fee, burned: burnAmt });
      return true;
    }

    if (pathname === '/api/tournament/submit' && req.method === 'POST') {
      if (!ipRateLimit('tourn_submit', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      checkTournaments();
      try {
        const body = JSON.parse(await readBody(req));
        const { score, tier: reqTier, gameSessionId } = body;
        const tier = reqTier || 'daily';
        if (!tournamentTiers[tier]) return respondJson(res, 400, { error: 'Invalid tier' });
        const tournament = activeTournaments[tier];
        if (!tournament || tournament.status === 'ended' || Date.now() > tournament.endTime) return respondJson(res, 400, { error: 'Tournament has ended' });
        const addr = jwtAuth.address;
        if (!tournament.entries[addr]) return respondJson(res, 400, { error: 'Not joined' });
        if (typeof score !== 'number' || score <= 0) return respondJson(res, 400, { error: 'Valid score required' });
        if (!gameSessionId) return respondJson(res, 400, { error: 'gameSessionId required for tournament' });
        const tSession = gameSessionProofs.get(gameSessionId);
        if (!tSession || !tSession.verified) return respondJson(res, 400, { error: 'Invalid or unverified game session' });
        if (tSession.walletAddress !== addr) return respondJson(res, 403, { error: 'Session wallet mismatch' });
        if (Math.abs(tSession.score - score) > 5) return respondJson(res, 400, { error: 'Score does not match session proof' });
        if (!tournament.mode) return respondJson(res, 500, { error: 'Tournament mode not configured' });
        if (tSession.gameMode !== tournament.mode) return respondJson(res, 400, { error: 'Session gameMode does not match tournament mode' });
        if (tSession.usedForTournament) return respondJson(res, 400, { error: 'Session already used for a tournament submission' });
        const maxTournamentScores = { orbit: 600, gravity: 600, destroyer: 9999 };
        const maxTournamentScore = maxTournamentScores[tournament.mode] || 9999;
        if (score > maxTournamentScore) return respondJson(res, 400, { error: 'Score exceeds maximum' });
        tSession.usedForTournament = { tier, addr, at: Date.now() };
        persistGameSessionProofs();
        if (score > (tournament.entries[addr].score || 0)) {
          tournament.entries[addr] = { score, submittedAt: new Date().toISOString() };
          saveTournament();
        }
        respondJson(res, 200, { success: true, tier, score: tournament.entries[addr].score });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
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
