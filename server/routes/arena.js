import fs from 'node:fs';
import path from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

function registerArenaRoute(ctx) {
  const {
    activeChallenges: challenges,
    gameSessionProofs,
    prismTransactions,
    walletDatabase,
    challengeWeeklyHistory,
    respondJson,
    readBody,
    getClientIp,
    ipRateLimit,
    requireJwt,
    verifyJwt,
    requireAdminKey,
    saveChallenges,
    savePrismDataDebounced: debouncedSavePrism,
    persistGameSessionProofs,
    pushNotification,
    getCoinBalance,
    setCoinBalance,
    addCoinEarned,
    addCoinSpent,
    refundCoinSpent,
    getPrismBalance,
    getRpcUrl,
    calculateCompositeScore,
    buildCompositeInput,
    triggerCompositeUpdate,
    parseSecretKey,
    loadSecretKeyFromFile,
    usedChallengeSolTx,
    totalBurned,
    metadataDir,
    treasuryAddress,
    treasurySecret,
    treasurySecretPath,
    weeklyRewards,
    weeklyXpRewards,
  } = ctx;

  const USED_CHALLENGE_TX_FILE = path.join(metadataDir, 'used-challenge-tx.json');

  return async function handleArenaRoute(req, res, url, pathname) {
    if (pathname === '/api/challenge/create' && req.method === 'POST') {
      if (!ipRateLimit('ch_create', getClientIp(req), 5, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const body = JSON.parse(await readBody(req));
        const { type, gameMode, stakeAmount, opponent, betType, expiresMinutes, solTxSignature } = body;
        const creator = jwtAuth.address;
        if (betType === 'sol') return respondJson(res, 400, { error: 'SOL stakes are temporarily disabled. Use Coins.' });
        const isSolBet = false;

        if (!type || !['score', 'game'].includes(type)) {
          return respondJson(res, 400, { error: 'type must be "score" or "game"' });
        }
        if (type === 'game') {
          if (!gameMode || !['orbit', 'destroyer', 'gravity'].includes(gameMode)) {
            return respondJson(res, 400, { error: 'gameMode must be "orbit", "destroyer", or "gravity" for game challenges' });
          }
        }
        const stake = isSolBet ? Number(stakeAmount) : Math.floor(Number(stakeAmount));
        if (!Number.isFinite(stake) || stake < 5) {
          return respondJson(res, 400, { error: 'Minimum stake is 5 Coins' });
        }
        if (!isSolBet && stake > 1000) {
          return respondJson(res, 400, { error: 'stakeAmount cannot exceed 1000 Coins' });
        }
        if (isSolBet && stake > 10) {
          return respondJson(res, 400, { error: 'SOL stake cannot exceed 10 SOL' });
        }
        if (opponent) {
          if (opponent === creator) {
            return respondJson(res, 400, { error: 'Cannot challenge yourself' });
          }
          try { new PublicKey(opponent); } catch { return respondJson(res, 400, { error: 'Invalid opponent address' }); }
        }

        if (isSolBet) {
          if (!solTxSignature) return respondJson(res, 400, { error: 'solTxSignature required for SOL bets' });
          if (!globalThis._usedChallengeSolTx) {
            const map = new Map();
            try {
              const data = JSON.parse(fs.readFileSync(USED_CHALLENGE_TX_FILE, 'utf8'));
              for (const [key, value] of Object.entries(data)) map.set(key, value);
            } catch {}
            globalThis._usedChallengeSolTx = map;
          }
          if (!globalThis._challengeTxCleanupCounter) globalThis._challengeTxCleanupCounter = 0;
          if (++globalThis._challengeTxCleanupCounter % 500 === 0) {
            const cutoff = Date.now() - 48 * 60 * 60 * 1000;
            for (const [sig, ts] of globalThis._usedChallengeSolTx) {
              if (ts < cutoff) globalThis._usedChallengeSolTx.delete(sig);
            }
            const tempFile = USED_CHALLENGE_TX_FILE + '.tmp';
            const data = {};
            for (const [key, value] of globalThis._usedChallengeSolTx) data[key] = value;
            fs.promises.writeFile(tempFile, JSON.stringify(data), 'utf8')
              .then(() => fs.promises.rename(tempFile, USED_CHALLENGE_TX_FILE))
              .catch(() => {});
          }
          if (globalThis._usedChallengeSolTx.has(solTxSignature)) return respondJson(res, 400, { error: 'This SOL transaction has already been used' });
          globalThis._usedChallengeSolTx.set(solTxSignature, Date.now());
          try {
            const conn = new Connection(getRpcUrl(creator) || 'https://api.mainnet-beta.solana.com', 'confirmed');
            const tx = await conn.getParsedTransaction(solTxSignature, { maxSupportedTransactionVersion: 0 });
            if (!tx) {
              globalThis._usedChallengeSolTx.delete(solTxSignature);
              return respondJson(res, 400, { error: 'Transaction not found. Wait for confirmation and retry.' });
            }
            const treasuryAddr = treasuryAddress || '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
            if (!treasuryAddr) {
              globalThis._usedChallengeSolTx.delete(solTxSignature);
              return respondJson(res, 500, { error: 'Treasury not configured' });
            }
            const instructions = tx.transaction?.message?.instructions || [];
            const validTransfer = instructions.some((ix) => {
              if (ix.programId?.toBase58?.() === '11111111111111111111111111111111' && ix.parsed?.type === 'transfer') {
                const info = ix.parsed.info;
                return info.source === creator && info.destination === treasuryAddr && info.lamports >= Math.floor(stake * 1e9 * 0.99);
              }
              return false;
            });
            if (!validTransfer) {
              globalThis._usedChallengeSolTx.delete(solTxSignature);
              return respondJson(res, 400, { error: 'SOL transfer to treasury not verified' });
            }
          } catch (e) {
            console.error('[challenge] SOL verify failed:', e.message);
            globalThis._usedChallengeSolTx.delete(solTxSignature);
            return respondJson(res, 400, { error: 'SOL transfer verification failed' });
          }
        } else {
          const creatorBal = getPrismBalance(creator);
          if (creatorBal.balance < stake) {
            return respondJson(res, 400, { error: `Insufficient balance. Have ${creatorBal.balance} Coins, need ${stake}` });
          }
          setCoinBalance(creator, creatorBal.balance - stake);
          addCoinSpent(creator, stake);
          const txs = prismTransactions.get(creator) || [];
          txs.unshift({ id: `ch_stake_${Date.now()}`, address: creator, amount: stake, type: 'spend', source: 'challenge_entry', description: `Challenge stake: -${stake} Coins`, timestamp: new Date().toISOString() });
          if (txs.length > 200) txs.length = 200;
          prismTransactions.set(creator, txs);
          debouncedSavePrism();
        }

        const challenge = {
          id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          creator,
          opponent: opponent || null,
          type,
          gameMode: type === 'game' ? gameMode : null,
          stakeType: isSolBet ? 'sol' : 'coins',
          stakeAmount: stake,
          status: type === 'game' ? 'playing' : 'open',
          creatorScore: null,
          opponentScore: null,
          winner: null,
          createdAt: Date.now(),
          expiresAt: expiresMinutes && [15, 30, 60, 180, 360, 720, 1440].includes(Number(expiresMinutes))
            ? Date.now() + Number(expiresMinutes) * 60_000
            : Date.now() + 60 * 60_000,
          acceptedAt: null,
          completedAt: null,
          solTxCreator: isSolBet ? solTxSignature : null,
          solTxAcceptor: null,
        };
        if (challenges.length >= 10000) {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          for (let i = challenges.length - 1; i >= 0; i--) {
            if ((challenges[i].status === 'completed' || challenges[i].status === 'expired' || challenges[i].status === 'cancelled') && challenges[i].createdAt < cutoff) challenges.splice(i, 1);
          }
          if (challenges.length >= 10000) return respondJson(res, 429, { error: 'Too many active challenges' });
        }
        challenges.push(challenge);
        saveChallenges();
        console.log(`[challenges] Created ${challenge.id} by ${creator.slice(0, 8)}... (${type}, ${stake} ${isSolBet ? 'SOL' : 'Coins'})`);
        respondJson(res, 200, { ok: true, challenge });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/challenge/leaderboard' && req.method === 'GET') {
      if (!ipRateLimit('ch_lb', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      try {
        const now = Date.now();
        const d = new Date(now);
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
        const weekStart = d.getTime();
        const weeklyStats = new Map();
        const allTimeStats = new Map();
        const buildEntry = (addr) => ({ address: addr, wins: 0, losses: 0, earned: 0, played: 0 });
        for (const c of challenges) {
          if (c.status !== 'completed' || !c.winner) continue;
          const loser = c.winner === c.creator ? c.opponent : c.creator;
          const prize = Math.floor(c.stakeAmount * 2 * 0.95);
          const isThisWeek = (c.completedAt || c.createdAt) >= weekStart;
          const allTimeWinner = allTimeStats.get(c.winner) || buildEntry(c.winner);
          allTimeWinner.wins++;
          allTimeWinner.earned += prize;
          allTimeWinner.played++;
          allTimeStats.set(c.winner, allTimeWinner);
          if (loser) {
            const allTimeLoser = allTimeStats.get(loser) || buildEntry(loser);
            allTimeLoser.losses++;
            allTimeLoser.played++;
            allTimeStats.set(loser, allTimeLoser);
          }
          if (isThisWeek) {
            const weeklyWinner = weeklyStats.get(c.winner) || buildEntry(c.winner);
            weeklyWinner.wins++;
            weeklyWinner.earned += prize;
            weeklyWinner.played++;
            weeklyStats.set(c.winner, weeklyWinner);
            if (loser) {
              const weeklyLoser = weeklyStats.get(loser) || buildEntry(loser);
              weeklyLoser.losses++;
              weeklyLoser.played++;
              weeklyStats.set(loser, weeklyLoser);
            }
          }
        }
        const MIN_GAMES = 3;
        const weekly = [...weeklyStats.values()].filter((player) => player.played >= MIN_GAMES).sort((a, b) => b.earned - a.earned || b.wins - a.wins).slice(0, 20);
        const allTime = [...allTimeStats.values()].sort((a, b) => b.earned - a.earned || b.wins - a.wins).slice(0, 20);
        const weeklyWithRewards = weekly.map((player, i) => ({ ...player, reward: weeklyRewards[i] || 0, xpReward: weeklyXpRewards[i] || 0 }));
        const nextReset = weekStart + 7 * 24 * 60 * 60 * 1000;
        const lastWeek = challengeWeeklyHistory || globalThis._challengeWeeklyHistory || [];
        respondJson(res, 200, { ok: true, weekly: weeklyWithRewards, allTime, nextReset, lastWeekWinners: lastWeek, minGames: MIN_GAMES });
      } catch {
        respondJson(res, 200, { ok: true, weekly: [], allTime: [], nextReset: 0, lastWeekWinners: [], minGames: 3 });
      }
      return true;
    }

    if (pathname === '/api/challenge/list' && req.method === 'GET') {
      if (!ipRateLimit('ch_list', getClientIp(req), 60, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      try {
        const now = Date.now();
        const open = (challenges || [])
          .filter((c) => c && (c.status === 'open' || (c.status === 'playing' && !c.opponent)))
          .filter((c) => !c.expiresAt || c.expiresAt > now)
          .filter((c) => c.type !== 'game' || c.creatorScore !== null)
          .slice(0, 50);
        respondJson(res, 200, { ok: true, challenges: open });
      } catch (e) {
        console.warn('[challenges] list error', e?.message);
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
        const my = (challenges || [])
          .filter((c) => c && (c.creator === address || c.opponent === address))
          .slice(0, 50);
        respondJson(res, 200, { ok: true, challenges: my });
      } catch (e) {
        console.warn('[challenges] my error', e?.message);
        respondJson(res, 200, { ok: true, challenges: [] });
      }
      return true;
    }

    if (pathname === '/api/challenge/accept' && req.method === 'POST') {
      if (!ipRateLimit('ch_accept', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      let _acceptSolTxSig = null;
      try {
        const { challengeId, solTxSignature } = JSON.parse(await readBody(req));
        _acceptSolTxSig = solTxSignature || null;
        const acceptor = jwtAuth.address;
        if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });

        const challenge = challenges.find((c) => c.id === challengeId);
        if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
        if (challenge.expiresAt && Date.now() > challenge.expiresAt) {
          return respondJson(res, 409, { error: 'Challenge has expired' });
        }
        if (challenge.status !== 'open' && !(challenge.status === 'playing' && !challenge.opponent)) {
          return respondJson(res, 409, { error: 'Challenge no longer available' });
        }
        if (challenge.type === 'game' && challenge.creatorScore === null) {
          return respondJson(res, 400, { error: 'Creator hasn\'t played yet — challenge not ready' });
        }
        if (challenge.creator === acceptor) return respondJson(res, 400, { error: 'Cannot accept your own challenge' });
        if (challenge.opponent && challenge.opponent !== acceptor) {
          return respondJson(res, 403, { error: 'This challenge is for a specific opponent' });
        }

        const isSolBet = challenge.stakeType === 'sol';
        const origOpponent = challenge.opponent;
        const origStatus = challenge.status;
        const origAcceptedAt = challenge.acceptedAt;
        const rollback = () => {
          challenge.status = origStatus;
          challenge.opponent = origOpponent;
          challenge.acceptedAt = origAcceptedAt;
          saveChallenges();
        };

        challenge.status = 'accepted';
        challenge.opponent = acceptor;
        challenge.acceptedAt = Date.now();
        saveChallenges();

        if (isSolBet) {
          if (!solTxSignature) {
            rollback();
            return respondJson(res, 400, { error: 'solTxSignature required for SOL challenges' });
          }
          if (!globalThis._usedChallengeSolTx) globalThis._usedChallengeSolTx = usedChallengeSolTx;
          if (globalThis._usedChallengeSolTx.has(solTxSignature)) {
            rollback();
            return respondJson(res, 400, { error: 'This SOL transaction has already been used' });
          }
          globalThis._usedChallengeSolTx.set(solTxSignature, Date.now());
          try {
            const conn = new Connection(getRpcUrl(acceptor) || 'https://api.mainnet-beta.solana.com', 'confirmed');
            const tx = await conn.getParsedTransaction(solTxSignature, { maxSupportedTransactionVersion: 0 });
            if (!tx) {
              rollback();
              return respondJson(res, 400, { error: 'Transaction not found' });
            }
            const treasuryAddr = treasuryAddress || '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
            const instructions = tx.transaction?.message?.instructions || [];
            const validTransfer = instructions.some((ix) => {
              if (ix.programId?.toBase58?.() === '11111111111111111111111111111111' && ix.parsed?.type === 'transfer') {
                return ix.parsed.info.source === acceptor && ix.parsed.info.destination === treasuryAddr && ix.parsed.info.lamports >= Math.floor(challenge.stakeAmount * 1e9 * 0.99);
              }
              return false;
            });
            if (!validTransfer) {
              globalThis._usedChallengeSolTx.delete(solTxSignature);
              rollback();
              return respondJson(res, 400, { error: 'SOL transfer to treasury not verified' });
            }
            challenge.solTxAcceptor = solTxSignature;
          } catch (e) {
            console.error('[challenge] SOL verify failed:', e.message);
            globalThis._usedChallengeSolTx.delete(solTxSignature);
            rollback();
            return respondJson(res, 400, { error: 'Transfer verification failed' });
          }
        } else {
          const accBal = getCoinBalance(acceptor);
          if (accBal < challenge.stakeAmount) {
            rollback();
            return respondJson(res, 400, { error: `Insufficient balance. Have ${accBal} Coins, need ${challenge.stakeAmount}` });
          }
          setCoinBalance(acceptor, accBal - challenge.stakeAmount);
          addCoinSpent(acceptor, challenge.stakeAmount);
          debouncedSavePrism();
        }

        if (challenge.type === 'score') {
          try {
            triggerCompositeUpdate(challenge.creator);
            triggerCompositeUpdate(acceptor);
            const creatorComposite = (walletDatabase.get(challenge.creator) || {}).composite || calculateCompositeScore(buildCompositeInput(challenge.creator));
            const acceptorComposite = (walletDatabase.get(acceptor) || {}).composite || calculateCompositeScore(buildCompositeInput(acceptor));
            challenge.creatorScore = creatorComposite.compositeScore ?? 0;
            challenge.opponentScore = acceptorComposite.compositeScore ?? 0;

            const totalPot = challenge.stakeAmount * 2;
            const feeRate = 0.10;
            const winnerPrize = Math.floor(totalPot * (1 - feeRate));
            const fee = totalPot - winnerPrize;

            const resolveCoinWinner = (winnerAddr) => {
              setCoinBalance(winnerAddr, getCoinBalance(winnerAddr) + winnerPrize);
              addCoinEarned(winnerAddr, winnerPrize);
              const txs = prismTransactions.get(winnerAddr) || [];
              txs.unshift({ id: `ch_win_${Date.now()}`, address: winnerAddr, amount: winnerPrize, type: 'earn', source: 'challenge_win', description: `Challenge won: +${winnerPrize} Coins`, timestamp: new Date().toISOString() });
              if (txs.length > 200) txs.length = 200;
              prismTransactions.set(winnerAddr, txs);
            };

            const resolveSolWinner = async (winnerAddr) => {
              challenge.solPayoutAddress = winnerAddr;
              challenge.solPayoutAmount = winnerPrize;
              challenge.solPayoutStatus = 'pending';
              try {
                const parsedTreasurySecret = parseSecretKey(treasurySecret) ?? loadSecretKeyFromFile(treasurySecretPath);
                if (parsedTreasurySecret) {
                  const conn = new Connection(getRpcUrl(winnerAddr) || 'https://api.mainnet-beta.solana.com', 'confirmed');
                  const treasuryKeypair = Keypair.fromSecretKey(parsedTreasurySecret);
                  const tx = new Transaction().add(
                    SystemProgram.transfer({ fromPubkey: treasuryKeypair.publicKey, toPubkey: new PublicKey(winnerAddr), lamports: Math.floor(winnerPrize * 1e9) }),
                  );
                  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
                  tx.feePayer = treasuryKeypair.publicKey;
                  tx.sign(treasuryKeypair);
                  const sig = await conn.sendRawTransaction(tx.serialize());
                  challenge.solPayoutTx = sig;
                  challenge.solPayoutStatus = 'sent';
                  console.log(`[challenges] SOL payout ${winnerPrize} SOL → ${winnerAddr.slice(0, 8)}... tx: ${sig}`);
                }
              } catch (e) {
                console.warn('[challenges] SOL payout failed:', e.message);
                challenge.solPayoutStatus = 'failed';
              }
            };

            if (challenge.creatorScore > challenge.opponentScore) {
              challenge.winner = challenge.creator;
              if (isSolBet) await resolveSolWinner(challenge.creator);
              else resolveCoinWinner(challenge.creator);
              pushNotification(challenge.creator, 'challenge_win', `You won the challenge! +${winnerPrize} coins`, { challengeId, payout: winnerPrize });
              pushNotification(acceptor, 'challenge_loss', `Challenge lost against ${challenge.creator.slice(0, 6)}...`, { challengeId });
            } else if (challenge.opponentScore > challenge.creatorScore) {
              challenge.winner = acceptor;
              if (isSolBet) await resolveSolWinner(acceptor);
              else resolveCoinWinner(acceptor);
              pushNotification(acceptor, 'challenge_win', `You won the challenge! +${winnerPrize} coins`, { challengeId, payout: winnerPrize });
              pushNotification(challenge.creator, 'challenge_loss', `Challenge lost against ${acceptor.slice(0, 6)}...`, { challengeId });
            } else {
              challenge.winner = null;
              if (!isSolBet) {
                setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
                refundCoinSpent(challenge.creator, challenge.stakeAmount);
                setCoinBalance(acceptor, getCoinBalance(acceptor) + challenge.stakeAmount);
                refundCoinSpent(acceptor, challenge.stakeAmount);
              } else {
                challenge.solPayoutStatus = 'tie_refund_pending';
              }
            }
            if (!isSolBet && challenge.winner && fee > 0) {
              totalBurned.value += fee;
              debouncedSavePrism();
            }
            challenge.status = 'completed';
            challenge.completedAt = Date.now();
          } catch (scoreErr) {
            console.warn('[challenges] Score fetch failed for', challengeId, scoreErr.message);
            if (!isSolBet) {
              setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
              refundCoinSpent(challenge.creator, challenge.stakeAmount);
              setCoinBalance(acceptor, getCoinBalance(acceptor) + challenge.stakeAmount);
              refundCoinSpent(acceptor, challenge.stakeAmount);
            }
            challenge.status = 'cancelled';
            challenge.completedAt = Date.now();
            debouncedSavePrism();
            saveChallenges();
            return respondJson(res, 500, { ok: false, error: 'Failed to fetch identity scores. Stakes refunded.' });
          }
        } else {
          challenge.status = 'playing';
        }

        debouncedSavePrism();
        saveChallenges();
        console.log(`[challenges] Accepted ${challengeId} by ${acceptor.slice(0, 8)}... → status: ${challenge.status}`);
        respondJson(res, 200, { ok: true, challenge });
      } catch {
        if (_acceptSolTxSig && globalThis._usedChallengeSolTx) globalThis._usedChallengeSolTx.delete(_acceptSolTxSig);
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
        const challenge = challenges.find((c) => c.id === challengeId);
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
      if (!ipRateLimit('ch_submit', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const { challengeId, score, gameSessionId } = JSON.parse(await readBody(req));
        const submitter = jwtAuth.address;
        if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });
        if (typeof score !== 'number' || score < 0 || score > 100000) {
          return respondJson(res, 400, { error: 'Invalid score' });
        }
        const scoreNum = Math.floor(Number(score));
        if (!Number.isFinite(scoreNum) || scoreNum < 0) {
          return respondJson(res, 400, { error: 'score must be a non-negative number' });
        }

        const challenge = challenges.find((c) => c.id === challengeId);
        if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
        if (challenge.type !== 'game') return respondJson(res, 400, { error: 'Score submission is for game challenges only' });
        if (challenge.status !== 'playing' && challenge.status !== 'open') return respondJson(res, 400, { error: 'Challenge is not in playing state' });

        const CH_MAX_SCORES = { orbit: 600, gravity: 600, destroyer: 9999, wars: 600, territory: 600 };
        const chMaxScore = CH_MAX_SCORES[challenge.gameMode] || 600;
        if (scoreNum > chMaxScore) return respondJson(res, 400, { error: 'Score exceeds maximum for this game mode' });

        const NO_PROOF_MAX = 30;
        if (gameSessionId) {
          const cSession = gameSessionProofs.get(gameSessionId);
          if (!cSession || !cSession.verified) {
            if (scoreNum > NO_PROOF_MAX) return respondJson(res, 400, { error: 'Unverified session — score too high' });
          } else {
            if (cSession.walletAddress !== submitter) return respondJson(res, 403, { error: 'Session wallet mismatch' });
            if (Math.abs(cSession.score - scoreNum) > 5) return respondJson(res, 400, { error: 'Score does not match session proof' });
            if (challenge.gameMode && cSession.gameMode !== challenge.gameMode) return respondJson(res, 400, { error: 'Session gameMode does not match challenge' });
            if (cSession.usedForChallenge && cSession.usedForChallenge.challengeId !== challengeId) {
              return respondJson(res, 400, { error: 'Game session already used for another challenge' });
            }
          }
        } else if (scoreNum > NO_PROOF_MAX) {
          return respondJson(res, 400, { error: 'Game session required for this score' });
        }

        const submitKey = `${challengeId}:${submitter}`;
        if (!globalThis._pendingSubmits) globalThis._pendingSubmits = new Set();
        if (globalThis._pendingSubmits.has(submitKey)) return respondJson(res, 409, { error: 'Submission in progress' });
        globalThis._pendingSubmits.add(submitKey);

        if (gameSessionId) {
          const cSession = gameSessionProofs.get(gameSessionId);
          if (cSession) {
            cSession.usedForChallenge = { challengeId, submitter, at: Date.now() };
            persistGameSessionProofs();
          }
        }

        if (submitter === challenge.creator) {
          if (challenge.creatorScore !== null) {
            globalThis._pendingSubmits.delete(submitKey);
            return respondJson(res, 400, { error: 'Score already submitted' });
          }
          challenge.creatorScore = scoreNum;
        } else if (submitter === challenge.opponent) {
          if (challenge.opponentScore !== null) {
            globalThis._pendingSubmits.delete(submitKey);
            return respondJson(res, 400, { error: 'Score already submitted' });
          }
          challenge.opponentScore = scoreNum;
        } else {
          globalThis._pendingSubmits.delete(submitKey);
          return respondJson(res, 403, { error: 'You are not a participant in this challenge' });
        }

        if (challenge.creatorScore !== null && challenge.opponentScore !== null) {
          const isSolBet = challenge.stakeType === 'sol';
          const totalPot = challenge.stakeAmount * 2;
          const feeRate = isSolBet ? 0.10 : 0.05;
          const winnerPrize = isSolBet ? totalPot * (1 - feeRate) : Math.floor(totalPot * (1 - feeRate));
          const fee = totalPot - winnerPrize;

          const awardCoinWinner = (addr) => {
            setCoinBalance(addr, getCoinBalance(addr) + winnerPrize);
            addCoinEarned(addr, winnerPrize);
            const txs = prismTransactions.get(addr) || [];
            txs.unshift({ id: `ch_win_${Date.now()}`, address: addr, amount: winnerPrize, type: 'earn', source: 'challenge_win', description: `Challenge won: +${winnerPrize} Coins`, timestamp: new Date().toISOString() });
            if (txs.length > 200) txs.length = 200;
            prismTransactions.set(addr, txs);
          };

          const awardSolWinner = async (addr) => {
            challenge.solPayoutAddress = addr;
            challenge.solPayoutAmount = winnerPrize;
            challenge.solPayoutStatus = 'pending';
            try {
              const parsedTreasurySecret = parseSecretKey(treasurySecret) ?? loadSecretKeyFromFile(treasurySecretPath);
              if (parsedTreasurySecret) {
                const conn = new Connection(getRpcUrl(addr) || 'https://api.mainnet-beta.solana.com', 'confirmed');
                const kp = Keypair.fromSecretKey(parsedTreasurySecret);
                const tx = new Transaction().add(
                  SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(addr), lamports: Math.floor(winnerPrize * 1e9) }),
                );
                tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
                tx.feePayer = kp.publicKey;
                tx.sign(kp);
                const sig = await conn.sendRawTransaction(tx.serialize());
                challenge.solPayoutTx = sig;
                challenge.solPayoutStatus = 'sent';
              }
            } catch (e) {
              console.warn('[challenges] SOL payout failed:', e.message);
              challenge.solPayoutStatus = 'failed';
            }
          };

          if (challenge.creatorScore > challenge.opponentScore) {
            challenge.winner = challenge.creator;
            if (isSolBet) await awardSolWinner(challenge.creator);
            else awardCoinWinner(challenge.creator);
          } else if (challenge.opponentScore > challenge.creatorScore) {
            challenge.winner = challenge.opponent;
            if (isSolBet) await awardSolWinner(challenge.opponent);
            else awardCoinWinner(challenge.opponent);
          } else {
            challenge.winner = null;
            if (!isSolBet) {
              setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
              refundCoinSpent(challenge.creator, challenge.stakeAmount);
              setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
              refundCoinSpent(challenge.opponent, challenge.stakeAmount);
            }
          }
          if (!isSolBet && fee > 0 && challenge.winner) {
            totalBurned.value += fee;
          }
          debouncedSavePrism();
          challenge.status = 'completed';
          challenge.completedAt = Date.now();
          console.log(`[challenges] Completed ${challengeId}: creator=${challenge.creatorScore}, opponent=${challenge.opponentScore}, winner=${challenge.winner ? challenge.winner.slice(0, 8) + '...' : 'tie'}`);
        }

        debouncedSavePrism();
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
      if (!ipRateLimit('ch_cancel', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const { challengeId } = JSON.parse(await readBody(req));
        const canceller = jwtAuth.address;
        if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });

        const challenge = challenges.find((c) => c.id === challengeId);
        if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });
        if (challenge.creator !== canceller) return respondJson(res, 403, { error: 'Only the creator can cancel a challenge' });
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
        challenge.completedAt = Date.now();
        saveChallenges();

        const feeRate = challenge.creatorScore !== null ? 0.2 : 0.1;
        const fee = Math.ceil(challenge.stakeAmount * feeRate);
        const refundAmount = challenge.stakeAmount - fee;

        if (challenge.stakeType === 'sol') {
          challenge.solPayoutStatus = 'cancel_refund_pending';
          try {
            const parsedTreasurySecret = parseSecretKey(treasurySecret) ?? loadSecretKeyFromFile(treasurySecretPath);
            if (parsedTreasurySecret) {
              const conn = new Connection(getRpcUrl(challenge.creator) || 'https://api.mainnet-beta.solana.com', 'confirmed');
              const kp = Keypair.fromSecretKey(parsedTreasurySecret);
              const tx = new Transaction().add(
                SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(challenge.creator), lamports: Math.floor(refundAmount * 1e9) }),
              );
              tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
              tx.feePayer = kp.publicKey;
              tx.sign(kp);
              const sig = await conn.sendRawTransaction(tx.serialize());
              challenge.solPayoutTx = sig;
              challenge.solPayoutStatus = 'refunded';
            }
          } catch (e) {
            console.warn('[challenges] SOL refund failed:', e.message);
          }
        } else {
          setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + refundAmount);
          refundCoinSpent(challenge.creator, refundAmount);
          totalBurned.value += fee;
          if (challenge.opponent) {
            setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
            refundCoinSpent(challenge.opponent, challenge.stakeAmount);
          }
          debouncedSavePrism();
        }

        saveChallenges();
        console.log(`[challenges] Cancelled ${challengeId} by ${canceller.slice(0, 8)}... — refunded ${refundAmount} (fee: ${fee})`);
        respondJson(res, 200, { ok: true, refunded: refundAmount, fee });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/challenge/abandon' && req.method === 'POST') {
      if (!ipRateLimit('ch_abandon', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const urlToken = url.searchParams.get('token');
      let jwtAuth;
      if (urlToken && typeof urlToken === 'string') {
        try {
          const payload = verifyJwt(urlToken);
          jwtAuth = { ok: true, address: payload.address };
        } catch {
          respondJson(res, 401, { error: 'Invalid or expired auth token' });
          return true;
        }
      } else {
        jwtAuth = requireJwt(req, res);
      }
      if (!jwtAuth.ok) return true;
      try {
        const { challengeId } = JSON.parse(await readBody(req));
        const abandoner = jwtAuth.address;
        if (!challengeId) return respondJson(res, 400, { error: 'challengeId required' });

        const challenge = challenges.find((c) => c.id === challengeId);
        if (!challenge) return respondJson(res, 404, { error: 'Challenge not found' });

        if (challenge.creator !== abandoner && challenge.opponent !== abandoner) {
          return respondJson(res, 403, { error: 'Not a participant of this challenge' });
        }

        if (challenge.status === 'open') {
          if (challenge.creator !== abandoner) return respondJson(res, 403, { error: 'Only the creator can abandon an open challenge' });
        } else if (challenge.status === 'playing') {
          if (challenge.creatorScore !== null || challenge.opponentScore !== null) {
            return respondJson(res, 400, { error: 'Cannot abandon — a score has already been submitted. Finish the game.' });
          }
        } else {
          return respondJson(res, 400, { error: `Cannot abandon a ${challenge.status} challenge` });
        }

        challenge.status = 'cancelled';
        challenge.completedAt = Date.now();
        saveChallenges();

        if (challenge.stakeType === 'sol') {
          challenge.solPayoutStatus = 'cancel_refund_pending';
          try {
            const parsedTreasurySecret = parseSecretKey(treasurySecret) ?? loadSecretKeyFromFile(treasurySecretPath);
            if (parsedTreasurySecret) {
              const conn = new Connection(getRpcUrl(challenge.creator) || 'https://api.mainnet-beta.solana.com', 'confirmed');
              const kp = Keypair.fromSecretKey(parsedTreasurySecret);
              const tx1 = new Transaction().add(
                SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(challenge.creator), lamports: Math.floor(challenge.stakeAmount * 1e9) }),
              );
              tx1.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
              tx1.feePayer = kp.publicKey;
              tx1.sign(kp);
              await conn.sendRawTransaction(tx1.serialize());
              if (challenge.opponent) {
                const tx2 = new Transaction().add(
                  SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(challenge.opponent), lamports: Math.floor(challenge.stakeAmount * 1e9) }),
                );
                tx2.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
                tx2.feePayer = kp.publicKey;
                tx2.sign(kp);
                await conn.sendRawTransaction(tx2.serialize());
              }
              challenge.solPayoutStatus = 'refunded';
            }
          } catch (e) {
            console.warn('[challenges] SOL abandon refund failed:', e.message);
          }
        } else {
          setCoinBalance(challenge.creator, getCoinBalance(challenge.creator) + challenge.stakeAmount);
          refundCoinSpent(challenge.creator, challenge.stakeAmount);
          if (challenge.opponent) {
            setCoinBalance(challenge.opponent, getCoinBalance(challenge.opponent) + challenge.stakeAmount);
            refundCoinSpent(challenge.opponent, challenge.stakeAmount);
          }
          debouncedSavePrism();
        }

        saveChallenges();
        console.log(`[challenges] Abandoned ${challengeId} by ${abandoner.slice(0, 8)}... — stakes refunded`);
        respondJson(res, 200, { ok: true });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/admin/challenge/stale-sol-refunds' && req.method === 'GET') {
      if (!requireAdminKey(req, res)) return true;
      const stale = (challenges || []).filter((c) => c && (c.solPayoutStatus === 'stale_refund_pending' || c.solPayoutStatus === 'cancel_refund_pending'));
      respondJson(res, 200, { ok: true, count: stale.length, challenges: stale.map((c) => ({ id: c.id, creator: c.creator, opponent: c.opponent, stakeAmount: c.stakeAmount, createdAt: c.createdAt, solPayoutStatus: c.solPayoutStatus, status: c.status })) });
      return true;
    }

    if (pathname === '/api/admin/challenge/stale-sol-refunds' && req.method === 'POST') {
      if (!requireAdminKey(req, res)) return true;
      try {
        const body = await readBody(req);
        const { challengeId, action } = JSON.parse(body);
        const ch = (challenges || []).find((c) => c.id === challengeId);
        if (!ch || (ch.solPayoutStatus !== 'stale_refund_pending' && ch.solPayoutStatus !== 'cancel_refund_pending')) return respondJson(res, 404, { error: 'Challenge not found or not pending refund' });
        ch.solPayoutStatus = action === 'refunded' ? 'refunded' : 'rejected';
        saveChallenges();
        respondJson(res, 200, { ok: true, challengeId, status: ch.solPayoutStatus });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    return false;
  };
}

export { registerArenaRoute };
