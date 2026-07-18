import { PublicKey } from '@solana/web3.js';
import { CHALLENGE_SUBMIT_GRACE_MS, getScoreCeiling } from '../services/gameRules.js';

function registerArenaRoute(ctx) {
  const { core, wallet, economy, sybil, auth, arena, game } = ctx;
  const { respondJson, readBody, getClientIp, ipRateLimit, requireJwt } = core;
  const { verifyJwt } = auth;
  const {
    walletDatabase,
    getCoinBalance,
    setCoinBalance,
    addCoinEarned,
    addCoinSpent,
    pushNotification,
    prismTransactions,
    savePrismDataDebounced: debouncedSavePrism,
  } = wallet;
  const {
    refundCoinSpent,
    invalidateQuestProgressCache = () => {},
    totalBurned,
  } = economy;
  const { calculateCompositeScore, buildCompositeInput, triggerCompositeUpdate } = sybil;
  const { gameSessionProofs, persistGameSessionProofs } = game;
  const {
    activeChallenges: challenges,
    challengeWeeklyHistory,
    saveChallenges,
    weeklyRewards,
    weeklyXpRewards,
  } = arena;

  // Legacy SOL challenge cleanup moved to scheduler startup (purgeLegacySolChallenges)

  const recordChallengeWin = (address, amount) => {
    setCoinBalance(address, getCoinBalance(address) + amount);
    addCoinEarned(address, amount);
    const txs = prismTransactions.get(address) || [];
    txs.unshift({
      id: `ch_win_${Date.now()}`,
      address,
      amount,
      type: 'earn',
      source: 'challenge_win',
      description: `Challenge won: +${amount} Coins`,
      timestamp: new Date().toISOString(),
    });
    if (txs.length > 200) txs.length = 200;
    prismTransactions.set(address, txs);
  };
  const getChallengePayout = (challenge) => {
    if (!challenge || !challenge.winner) return 0;
    const feeRate = challenge.type === 'score' ? 0.10 : 0.05;
    return Math.floor((Number(challenge.stakeAmount) || 0) * 2 * (1 - feeRate));
  };
  const invalidateChallengeParticipants = (challenge) => {
    if (!challenge) return;
    invalidateQuestProgressCache(challenge.creator);
    if (challenge.opponent) invalidateQuestProgressCache(challenge.opponent);
  };

  const pendingAccepts = new Set();

  return async function handleArenaRoute(req, res, url, pathname) {
    if (pathname === '/api/challenge/create' && req.method === 'POST') {
      if (!ipRateLimit('ch_create', getClientIp(req), 5, 60000)) {
        return respondJson(res, 429, { error: 'Too many requests' });
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const body = JSON.parse(await readBody(req));
        const { type, gameMode, stakeAmount, opponent, expiresMinutes } = body;
        const creator = jwtAuth.address;

        if (!type || !['score', 'game'].includes(type)) {
          return respondJson(res, 400, { error: 'type must be "score" or "game"' });
        }
        if (type === 'game' && (!gameMode || !['orbit', 'destroyer', 'gravity'].includes(gameMode))) {
          return respondJson(res, 400, {
            error: 'gameMode must be "orbit", "destroyer", or "gravity" for game challenges',
          });
        }

        const stake = Math.floor(Number(stakeAmount));
        if (!Number.isFinite(stake) || stake < 5) {
          return respondJson(res, 400, { error: 'Minimum stake is 5 Coins' });
        }
        if (stake > 1000) {
          return respondJson(res, 400, { error: 'stakeAmount cannot exceed 1000 Coins' });
        }
        if (opponent) {
          if (opponent === creator) {
            return respondJson(res, 400, { error: 'Cannot challenge yourself' });
          }
          try {
            new PublicKey(opponent);
          } catch {
            return respondJson(res, 400, { error: 'Invalid opponent address' });
          }
        }

        if (challenges.length >= 10000) {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          for (let i = challenges.length - 1; i >= 0; i -= 1) {
            const challengeAtIndex = challenges[i];
            if (
              (challengeAtIndex.status === 'completed' ||
                challengeAtIndex.status === 'expired' ||
                challengeAtIndex.status === 'cancelled') &&
              challengeAtIndex.createdAt < cutoff
            ) {
              challenges.splice(i, 1);
            }
          }
          if (challenges.length >= 10000) {
            return respondJson(res, 429, { error: 'Too many active challenges' });
          }
        }

        const creatorBal = getCoinBalance(creator);
        if (creatorBal < stake) {
          return respondJson(res, 400, {
            error: `Insufficient balance. Have ${creatorBal} Coins, need ${stake}`,
          });
        }
        setCoinBalance(creator, creatorBal - stake);
        addCoinSpent(creator, stake);
        const txs = prismTransactions.get(creator) || [];
        txs.unshift({
          id: `ch_stake_${Date.now()}`,
          address: creator,
          amount: stake,
          type: 'spend',
          source: 'challenge_entry',
          description: `Challenge stake: -${stake} Coins`,
          timestamp: new Date().toISOString(),
        });
        if (txs.length > 200) txs.length = 200;
        prismTransactions.set(creator, txs);
        debouncedSavePrism();

        const challenge = {
          id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          creator,
          opponent: opponent || null,
          type,
          gameMode: type === 'game' ? gameMode : null,
          stakeType: 'coins',
          stakeAmount: stake,
          status: type === 'game' ? 'playing' : 'open',
          creatorScore: null,
          opponentScore: null,
          winner: null,
          createdAt: Date.now(),
          expiresAt:
            expiresMinutes && [15, 30, 60, 180, 360, 720, 1440].includes(Number(expiresMinutes))
              ? Date.now() + Number(expiresMinutes) * 60_000
              : Date.now() + 60 * 60_000,
          acceptedAt: null,
          completedAt: null,
        };

        challenges.push(challenge);
        saveChallenges();
        console.log(
          `[challenges] Created ${challenge.id} by ${creator.slice(0, 8)}... (${type}, ${stake} Coins)`,
        );
        respondJson(res, 200, { ok: true, challenge });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/challenge/leaderboard' && req.method === 'GET') {
      if (!ipRateLimit('ch_lb', getClientIp(req), 30, 60000)) {
        return respondJson(res, 429, { error: 'Too many requests' });
      }
      try {
        const now = Date.now();
        const d = new Date(now);
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
        const weekStart = d.getTime();
        const weeklyStats = new Map();
        const allTimeStats = new Map();
        const buildEntry = (address) => ({ address, wins: 0, losses: 0, earned: 0, played: 0 });

        for (const challenge of challenges) {
          if (!challenge || challenge.status !== 'completed' || !challenge.winner) continue;
          const loser = challenge.winner === challenge.creator ? challenge.opponent : challenge.creator;
          const prize = Math.floor(challenge.stakeAmount * 2 * 0.95);
          const isThisWeek = (challenge.completedAt || challenge.createdAt) >= weekStart;
          const allTimeWinner = allTimeStats.get(challenge.winner) || buildEntry(challenge.winner);
          allTimeWinner.wins += 1;
          allTimeWinner.earned += prize;
          allTimeWinner.played += 1;
          allTimeStats.set(challenge.winner, allTimeWinner);
          if (loser) {
            const allTimeLoser = allTimeStats.get(loser) || buildEntry(loser);
            allTimeLoser.losses += 1;
            allTimeLoser.played += 1;
            allTimeStats.set(loser, allTimeLoser);
          }
          if (isThisWeek) {
            const weeklyWinner = weeklyStats.get(challenge.winner) || buildEntry(challenge.winner);
            weeklyWinner.wins += 1;
            weeklyWinner.earned += prize;
            weeklyWinner.played += 1;
            weeklyStats.set(challenge.winner, weeklyWinner);
            if (loser) {
              const weeklyLoser = weeklyStats.get(loser) || buildEntry(loser);
              weeklyLoser.losses += 1;
              weeklyLoser.played += 1;
              weeklyStats.set(loser, weeklyLoser);
            }
          }
        }

        const minGames = 3;
        const weekly = [...weeklyStats.values()]
          .filter((player) => player.played >= minGames)
          .sort((a, b) => b.earned - a.earned || b.wins - a.wins)
          .slice(0, 20);
        const allTime = [...allTimeStats.values()]
          .sort((a, b) => b.earned - a.earned || b.wins - a.wins)
          .slice(0, 20);
        const weeklyWithRewards = weekly.map((player, index) => ({
          ...player,
          reward: weeklyRewards[index] || 0,
          xpReward: weeklyXpRewards[index] || 0,
        }));
        const nextReset = weekStart + 7 * 24 * 60 * 60 * 1000;
        const lastWeek = challengeWeeklyHistory || globalThis._challengeWeeklyHistory || [];

        respondJson(res, 200, {
          ok: true,
          weekly: weeklyWithRewards,
          allTime,
          nextReset,
          lastWeekWinners: lastWeek,
          minGames,
        });
      } catch {
        respondJson(res, 200, {
          ok: true,
          weekly: [],
          allTime: [],
          nextReset: 0,
          lastWeekWinners: [],
          minGames: 3,
        });
      }
      return true;
    }

    if (pathname === '/api/challenge/list' && req.method === 'GET') {
      if (!ipRateLimit('ch_list', getClientIp(req), 60, 60000)) {
        return respondJson(res, 429, { error: 'Too many requests' });
      }
      try {
        const now = Date.now();
        const open = (challenges || [])
          .filter((challenge) => challenge && (challenge.status === 'open' || (challenge.status === 'playing' && !challenge.opponent)))
          .filter((challenge) => !challenge.expiresAt || challenge.expiresAt > now)
          .filter((challenge) => challenge.type !== 'game' || challenge.creatorScore !== null)
          .slice(0, 50);
        respondJson(res, 200, { ok: true, challenges: open });
      } catch (error) {
        console.warn('[challenges] list error', error?.message);
        respondJson(res, 200, { ok: true, challenges: [] });
      }
      return true;
    }

    if (pathname === '/api/challenge/my' && req.method === 'GET') {
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const address = jwtAuth.address;
      if (!address) return respondJson(res, 400, { error: 'Authentication required' });
      try {
        const mine = (challenges || [])
          .filter((challenge) => challenge && (challenge.creator === address || challenge.opponent === address))
          .map((challenge) => ({
            ...challenge,
            payout: challenge.status === 'completed' && challenge.winner ? getChallengePayout(challenge) : 0,
          }))
          .slice(0, 50);
        respondJson(res, 200, { ok: true, challenges: mine });
      } catch (error) {
        console.warn('[challenges] my error', error?.message);
        respondJson(res, 200, { ok: true, challenges: [] });
      }
      return true;
    }

    if (pathname === '/api/challenge/accept' && req.method === 'POST') {
      if (!ipRateLimit('ch_accept', getClientIp(req), 10, 60000)) {
        return respondJson(res, 429, { error: 'Too many requests' });
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const { challengeId } = JSON.parse(await readBody(req));
        const acceptor = jwtAuth.address;
        if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });

        if (pendingAccepts.has(challengeId)) return respondJson(res, 429, { error: 'Accept in progress' });
        pendingAccepts.add(challengeId);
        try {

        const challenge = challenges.find((entry) => entry.id === challengeId);
        if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
        if (challenge.expiresAt && Date.now() > challenge.expiresAt) {
          return respondJson(res, 409, { error: 'Challenge has expired' });
        }
        const canAcceptOpenChallenge = challenge.status === 'open';
        const canAcceptOpenGameAfterCreatorPlayed = challenge.status === 'playing' && !challenge.opponent;
        const canAcceptDirectGameAfterCreatorPlayed =
          challenge.type === 'game' &&
          challenge.status === 'playing' &&
          challenge.opponent === acceptor &&
          !challenge.acceptedAt;
        if (!canAcceptOpenChallenge && !canAcceptOpenGameAfterCreatorPlayed && !canAcceptDirectGameAfterCreatorPlayed) {
          return respondJson(res, 409, { error: 'Challenge no longer available' });
        }
        if (challenge.type === 'game' && challenge.creatorScore === null) {
          return respondJson(res, 400, { error: "Creator hasn't played yet — challenge not ready" });
        }
        if (challenge.creator === acceptor) {
          return respondJson(res, 400, { error: 'Cannot accept your own challenge' });
        }
        if (challenge.opponent && challenge.opponent !== acceptor) {
          return respondJson(res, 403, { error: 'This challenge is for a specific opponent' });
        }

        const acceptorBalance = getCoinBalance(acceptor);
        if (acceptorBalance < challenge.stakeAmount) {
          return respondJson(res, 400, {
            error: `Insufficient balance. Have ${acceptorBalance} Coins, need ${challenge.stakeAmount}`,
          });
        }

        challenge.status = 'accepted';
        challenge.opponent = acceptor;
        challenge.acceptedAt = Date.now();
        setCoinBalance(acceptor, acceptorBalance - challenge.stakeAmount);
        addCoinSpent(acceptor, challenge.stakeAmount);
        debouncedSavePrism();

        if (challenge.type === 'score') {
          try {
            triggerCompositeUpdate(challenge.creator);
            triggerCompositeUpdate(acceptor);
            const creatorComposite =
              (walletDatabase.get(challenge.creator) || {}).composite ||
              calculateCompositeScore(buildCompositeInput(challenge.creator));
            const acceptorComposite =
              (walletDatabase.get(acceptor) || {}).composite ||
              calculateCompositeScore(buildCompositeInput(acceptor));
            challenge.creatorScore = creatorComposite.compositeScore ?? 0;
            challenge.opponentScore = acceptorComposite.compositeScore ?? 0;

            const totalPot = challenge.stakeAmount * 2;
            const feeRate = 0.1;
            const winnerPrize = Math.floor(totalPot * (1 - feeRate));
            const fee = totalPot - winnerPrize;

            if (challenge.creatorScore > challenge.opponentScore) {
              challenge.winner = challenge.creator;
              recordChallengeWin(challenge.creator, winnerPrize);
              pushNotification(challenge.creator, 'challenge_win', `You won the challenge! +${winnerPrize} coins`, {
                challengeId,
                payout: winnerPrize,
              });
              pushNotification(acceptor, 'challenge_loss', `Challenge lost against ${challenge.creator.slice(0, 6)}...`, {
                challengeId,
              });
            } else if (challenge.opponentScore > challenge.creatorScore) {
              challenge.winner = acceptor;
              recordChallengeWin(acceptor, winnerPrize);
              pushNotification(acceptor, 'challenge_win', `You won the challenge! +${winnerPrize} coins`, {
                challengeId,
                payout: winnerPrize,
              });
              pushNotification(challenge.creator, 'challenge_loss', `Challenge lost against ${acceptor.slice(0, 6)}...`, {
                challengeId,
              });
            } else {
              challenge.winner = null;
              setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
              refundCoinSpent(challenge.creator, challenge.stakeAmount);
              setCoinBalance(acceptor, getCoinBalance(acceptor) + challenge.stakeAmount);
              refundCoinSpent(acceptor, challenge.stakeAmount);
            }

            if (challenge.winner && fee > 0) {
              totalBurned.value += fee;
              debouncedSavePrism();
            }
            challenge.status = 'completed';
            challenge.completedAt = new Date().toISOString();
          } catch (scoreError) {
            console.warn('[challenges] Score fetch failed for', challengeId, scoreError.message);
            setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
            refundCoinSpent(challenge.creator, challenge.stakeAmount);
            setCoinBalance(acceptor, getCoinBalance(acceptor) + challenge.stakeAmount);
            refundCoinSpent(acceptor, challenge.stakeAmount);
            challenge.status = 'cancelled';
            challenge.completedAt = new Date().toISOString();
            debouncedSavePrism();
            invalidateChallengeParticipants(challenge);
            saveChallenges();
            return respondJson(res, 500, {
              ok: false,
              error: 'Failed to fetch identity scores. Stakes refunded.',
            });
          }
        } else {
          challenge.status = 'playing';
        }

        debouncedSavePrism();
        invalidateChallengeParticipants(challenge);
        saveChallenges();
        console.log(
          `[challenges] Accepted ${challengeId} by ${acceptor.slice(0, 8)}... → status: ${challenge.status}`,
        );
        respondJson(res, 200, { ok: true, challenge });

        } finally {
          pendingAccepts.delete(challengeId);
        }
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/challenge/start' && req.method === 'POST') {
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const { challengeId } = JSON.parse(await readBody(req));
        const player = jwtAuth.address;
        const challenge = challenges.find((entry) => entry.id === challengeId);
        if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
        if (player === challenge.creator) {
          challenge.creatorStartedAt = Date.now();
        } else if (player === challenge.opponent) {
          challenge.acceptorStartedAt = Date.now();
        }
        saveChallenges();
        respondJson(res, 200, { ok: true });
      } catch {
        respondJson(res, 400, { error: 'Invalid request' });
      }
      return true;
    }

    if (pathname === '/api/challenge/submit' && req.method === 'POST') {
      if (!ipRateLimit('ch_submit', getClientIp(req), 15, 60000)) {
        return respondJson(res, 429, { error: 'Too many requests' });
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      let submitKey;
      try {
        const { challengeId, score, gameSessionId } = JSON.parse(await readBody(req));
        const submitter = jwtAuth.address;
        if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });
        if (typeof score !== 'number' || score < 0) {
          return respondJson(res, 400, { error: 'Invalid score' });
        }
        const scoreNum = Math.floor(Number(score));
        if (!Number.isFinite(scoreNum) || scoreNum < 0) {
          return respondJson(res, 400, { error: 'score must be a non-negative number' });
        }

        const challenge = challenges.find((entry) => entry.id === challengeId);
        if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
        if (challenge.type !== 'game') {
          return respondJson(res, 400, { error: 'Score submission is for game challenges only' });
        }
        if (challenge.status !== 'playing' && challenge.status !== 'open') {
          return respondJson(res, 400, { error: 'Challenge is not in playing state' });
        }
        const challengeExpiresAtMs = Number(challenge.expiresAt);
        if (!Number.isFinite(challengeExpiresAtMs) || challengeExpiresAtMs + CHALLENGE_SUBMIT_GRACE_MS < Date.now()) {
          return respondJson(res, 409, { error: 'Challenge deadline has passed' });
        }

        if (!gameSessionId) return respondJson(res, 400, { error: 'Token-backed game session required for game challenges' });
        const challengeSession = gameSessionProofs.get(gameSessionId);
        if (!challengeSession || !challengeSession.verified || !challengeSession.sessionTokenId || challengeSession.timingVerified !== true || challengeSession.economyEligible !== true || challengeSession.competitiveEligible !== true) {
          return respondJson(res, 400, { error: 'Token-backed, timing-verified game session required' });
        }
        if (challengeSession.walletAddress !== submitter) return respondJson(res, 403, { error: 'Session wallet mismatch' });
        if (challengeSession.sessionReferenceId !== challengeId) return respondJson(res, 400, { error: 'Session is not bound to this challenge' });
        if (submitter === challenge.opponent) {
          const acceptedAtMs = Number(challenge.acceptedAt);
          const sessionStartedAtMs = Number(challengeSession.startedAtMs);
          if (!Number.isFinite(acceptedAtMs) || !Number.isFinite(sessionStartedAtMs) || sessionStartedAtMs < acceptedAtMs) {
            return respondJson(res, 409, { error: 'Opponent proof must start after challenge acceptance' });
          }
        }
        if (challengeSession.score !== scoreNum) return respondJson(res, 400, { error: 'Score does not match session proof' });
        if (challenge.gameMode && challengeSession.gameMode !== challenge.gameMode) return respondJson(res, 400, { error: 'Session gameMode does not match challenge' });
        const scoreCeiling = Number(challengeSession.scoreCeiling);
        if (!Number.isFinite(scoreCeiling) || scoreCeiling !== getScoreCeiling(challengeSession.gameMode, challengeSession.durationMs) || scoreNum > scoreCeiling) return respondJson(res, 400, { error: 'Score exceeds maximum for this game mode' });
        if (challengeSession.usedForChallenge && challengeSession.usedForChallenge.challengeId !== challengeId) return respondJson(res, 400, { error: 'Game session already used for another challenge' });
        if (Number(challengeSession.coinsCredited) > 0) return respondJson(res, 400, { error: 'Game session already used for coin earnings' });

        submitKey = `${challengeId}:${submitter}`;
        if (!globalThis._pendingSubmits) globalThis._pendingSubmits = new Set();
        if (globalThis._pendingSubmits.has(submitKey)) {
          return respondJson(res, 409, { error: 'Submission in progress' });
        }
        globalThis._pendingSubmits.add(submitKey);

        if (submitter === challenge.creator) {
          if (challenge.creatorScore !== null) {
            globalThis._pendingSubmits.delete(submitKey);
            return respondJson(res, 400, { error: 'Score already submitted' });
          }
          challenge.creatorScore = scoreNum;
        } else if (submitter === challenge.opponent) {
          if (!challenge.acceptedAt) {
            globalThis._pendingSubmits.delete(submitKey);
            return respondJson(res, 400, { error: 'Challenge must be accepted before opponent submits a score' });
          }
          if (challenge.opponentScore !== null) {
            globalThis._pendingSubmits.delete(submitKey);
            return respondJson(res, 400, { error: 'Score already submitted' });
          }
          challenge.opponentScore = scoreNum;
        } else {
          globalThis._pendingSubmits.delete(submitKey);
          return respondJson(res, 403, { error: 'You are not a participant in this challenge' });
        }

        if (gameSessionId) {
          const challengeSession = gameSessionProofs.get(gameSessionId);
          if (challengeSession) {
            challengeSession.usedForChallenge = { challengeId, submitter, at: Date.now() };
            persistGameSessionProofs();
          }
        }

        if (challenge.creatorScore !== null && challenge.opponentScore !== null) {
          const totalPot = challenge.stakeAmount * 2;
          const winnerPrize = Math.floor(totalPot * 0.95);
          const fee = totalPot - winnerPrize;

          if (challenge.creatorScore > challenge.opponentScore) {
            challenge.winner = challenge.creator;
            recordChallengeWin(challenge.creator, winnerPrize);
            pushNotification(challenge.creator, 'challenge_win', `You won the challenge: +${winnerPrize} Coins`, {
              challengeId,
              payout: winnerPrize,
              gameMode: challenge.gameMode,
            });
            if (challenge.opponent) {
              pushNotification(challenge.opponent, 'challenge_loss', `Challenge lost: ${challenge.creatorScore} vs ${challenge.opponentScore}`, {
                challengeId,
                gameMode: challenge.gameMode,
              });
            }
          } else if (challenge.opponentScore > challenge.creatorScore) {
            challenge.winner = challenge.opponent;
            recordChallengeWin(challenge.opponent, winnerPrize);
            if (challenge.opponent) {
              pushNotification(challenge.opponent, 'challenge_win', `You won the challenge: +${winnerPrize} Coins`, {
                challengeId,
                payout: winnerPrize,
                gameMode: challenge.gameMode,
              });
            }
            pushNotification(challenge.creator, 'challenge_loss', `Challenge lost: ${challenge.creatorScore} vs ${challenge.opponentScore}`, {
              challengeId,
              gameMode: challenge.gameMode,
            });
          } else {
            challenge.winner = null;
            setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
            refundCoinSpent(challenge.creator, challenge.stakeAmount);
            if (challenge.opponent) {
              setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
              refundCoinSpent(challenge.opponent, challenge.stakeAmount);
            }
            pushNotification(challenge.creator, 'challenge_expired', `Challenge tied: stakes refunded`, {
              challengeId,
              gameMode: challenge.gameMode,
            });
            if (challenge.opponent) {
              pushNotification(challenge.opponent, 'challenge_expired', `Challenge tied: stakes refunded`, {
                challengeId,
                gameMode: challenge.gameMode,
              });
            }
          }

          if (fee > 0 && challenge.winner) {
            totalBurned.value += fee;
          }
          debouncedSavePrism();
          challenge.status = 'completed';
          challenge.completedAt = new Date().toISOString();
          console.log(
            `[challenges] Completed ${challengeId}: creator=${challenge.creatorScore}, opponent=${challenge.opponentScore}, winner=${challenge.winner ? `${challenge.winner.slice(0, 8)}...` : 'tie'}`,
          );
        }

        debouncedSavePrism();
        invalidateChallengeParticipants(challenge);
        saveChallenges();
        globalThis._pendingSubmits.delete(submitKey);
        respondJson(res, 200, { ok: true, challenge });
      } catch {
        if (typeof submitKey !== 'undefined') globalThis._pendingSubmits?.delete(submitKey);
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/challenge/cancel' && req.method === 'POST') {
      if (!ipRateLimit('ch_cancel', getClientIp(req), 10, 60000)) {
        return respondJson(res, 429, { error: 'Too many requests' });
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const { challengeId } = JSON.parse(await readBody(req));
        const canceller = jwtAuth.address;
        if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });

        const challenge = challenges.find((entry) => entry.id === challengeId);
        if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
        if (challenge.creator !== canceller) {
          return respondJson(res, 403, { error: 'Only the creator can cancel a challenge' });
        }
        if (challenge.status === 'completed' || challenge.status === 'cancelled' || challenge.status === 'expired') {
          return respondJson(res, 400, { error: 'Challenge already finished' });
        }
        if (challenge.status === 'accepted') {
          return respondJson(res, 409, { error: 'Opponent has accepted — challenge cannot be cancelled' });
        }
        if (challenge.status === 'playing' && challenge.opponent) {
          return respondJson(res, 409, { error: 'Opponent is playing — challenge cannot be cancelled' });
        }

        challenge.status = 'cancelled';
        challenge.completedAt = new Date().toISOString();
        saveChallenges();

        const feeRate = challenge.creatorScore !== null ? 0.2 : 0.1;
        const fee = Math.ceil(challenge.stakeAmount * feeRate);
        const refundAmount = challenge.stakeAmount - fee;

        setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + refundAmount);
        refundCoinSpent(challenge.creator, refundAmount);
        totalBurned.value += fee;
        if (challenge.opponent) {
          setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
          refundCoinSpent(challenge.opponent, challenge.stakeAmount);
        }
        debouncedSavePrism();
        invalidateChallengeParticipants(challenge);

        saveChallenges();
        console.log(
          `[challenges] Cancelled ${challengeId} by ${canceller.slice(0, 8)}... — refunded ${refundAmount} (fee: ${fee})`,
        );
        respondJson(res, 200, { ok: true, refunded: refundAmount, fee });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/challenge/abandon' && req.method === 'POST') {
      if (!ipRateLimit('ch_abandon', getClientIp(req), 10, 60000)) {
        return respondJson(res, 429, { error: 'Too many requests' });
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const { challengeId } = JSON.parse(await readBody(req));
        const abandoner = jwtAuth.address;
        if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });

        const challenge = challenges.find((entry) => entry.id === challengeId);
        if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
        if (challenge.creator !== abandoner && challenge.opponent !== abandoner) {
          return respondJson(res, 403, { error: 'Not a participant of this challenge' });
        }

        if (challenge.status === 'open') {
          if (challenge.creator !== abandoner) {
            return respondJson(res, 403, { error: 'Only the creator can abandon an open challenge' });
          }
        } else if (challenge.status === 'playing') {
          if (challenge.creatorScore !== null || challenge.opponentScore !== null) {
            return respondJson(res, 400, {
              error: 'Cannot abandon — a score has already been submitted. Finish the game.',
            });
          }
        } else {
          return respondJson(res, 400, { error: `Cannot abandon a ${challenge.status} challenge` });
        }

        challenge.status = 'cancelled';
        challenge.completedAt = new Date().toISOString();
        saveChallenges();

        setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
        refundCoinSpent(challenge.creator, challenge.stakeAmount);
        if (challenge.opponent) {
          setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
          refundCoinSpent(challenge.opponent, challenge.stakeAmount);
        }
        debouncedSavePrism();
        invalidateChallengeParticipants(challenge);

        saveChallenges();
        console.log(
          `[challenges] Abandoned ${challengeId} by ${abandoner.slice(0, 8)}... — stakes refunded`,
        );
        respondJson(res, 200, { ok: true });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    return false;
  };
}

export { registerArenaRoute };
