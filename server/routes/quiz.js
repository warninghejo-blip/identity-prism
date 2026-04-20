import crypto from 'node:crypto';

function registerQuizRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      requireJwt,
      readBody,
      getToday,
    },
    wallet: {
      mintedAddresses,
      getCoinBalance,
      setCoinBalance,
      addCoinEarned,
    },
    economy: {
      quizAnswers,
      getPrismEarnRateLimit,
      setPrismEarnRateLimit,
      dailyQuizCap,
      quizCorrectReward,
      getHolderAdjustedCap,
      nonGameDailyEarnCap,
      canAwardQuizReward,
      prismTransactions,
      savePrismDataDebounced,
      QUIZ_BANK,
    },
  } = ctx;

  return async function handleQuizRoute(req, res, url, pathname) {
    if (pathname === '/api/quiz/question' && req.method === 'GET') {
      if (!ipRateLimit('quiz', getClientIp(req), 10, 5000)) return respondJson(res, 429, { error: 'Rate limited' });
      const q = QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)];
      const qId = crypto.createHash('sha256').update(q.q + q.a).digest('hex').slice(0, 12);
      quizAnswers.set(qId, { correct: q.a, expiresAt: Date.now() + 60_000 });
      const options = [...q.options].sort(() => Math.random() - 0.5);
      respondJson(res, 200, { id: qId, question: q.q, options, category: q.cat, difficulty: q.diff || 'medium' });
      return true;
    }

    if (pathname === '/api/quiz/answer' && req.method === 'POST') {
      if (!ipRateLimit('quiz_ans', getClientIp(req), 10, 3000)) return respondJson(res, 429, { error: 'Rate limited' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const body = JSON.parse(await readBody(req));
        const { id, answer, address: bodyAddress } = body;
        const address = jwtAuth.address;
        if (bodyAddress && bodyAddress !== address) return respondJson(res, 403, { error: 'Address mismatch' });
        if (!id || !answer) return respondJson(res, 400, { error: 'id and answer required' });

        const stored = quizAnswers.get(id);
        if (!stored) return respondJson(res, 400, { error: 'Question expired or invalid' });
        quizAnswers.delete(id);
        if (Date.now() > stored.expiresAt) return respondJson(res, 400, { error: 'Time expired' });

        const isCorrect = answer === stored.correct;
        let earned = 0;

        if (isCorrect) {
          const today = getToday();
          const dailyKey = `quiz:${address}:${today}`;
          const dailyCount = getPrismEarnRateLimit(dailyKey) || 0;
          const maxDailyAnswers = Math.floor(dailyQuizCap / quizCorrectReward);

          const ngKey = `nongame_daily:${address}`;
          const ngEntry = getPrismEarnRateLimit(ngKey);
          const ngEarned = (ngEntry && typeof ngEntry === 'object' && ngEntry.date === today) ? (ngEntry.total || 0) : 0;
          const isHolder = mintedAddresses.has(address);
          const nonGameCap = getHolderAdjustedCap(nonGameDailyEarnCap, isHolder);

          if (canAwardQuizReward({
            dailyCount,
            maxDailyAnswers,
            ngEarned,
            reward: quizCorrectReward,
            nonGameCap,
          })) {
            setPrismEarnRateLimit(dailyKey, dailyCount + 1);
            setPrismEarnRateLimit(ngKey, { date: today, total: ngEarned + quizCorrectReward });
            earned = quizCorrectReward;

            const prevBal = getCoinBalance(address);
            setCoinBalance(address, prevBal + earned);
            addCoinEarned(address, earned);

            const txRecord = {
              id: `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              address,
              amount: earned,
              type: 'earn',
              source: 'quiz',
              description: 'Quiz correct answer',
              timestamp: new Date().toISOString(),
            };
            const txs = prismTransactions.get(address) || [];
            txs.unshift(txRecord);
            if (txs.length > 500) txs.length = 500;
            prismTransactions.set(address, txs);
            savePrismDataDebounced();
          }
        }

        respondJson(res, 200, { correct: isCorrect, correctAnswer: stored.correct, earned });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    return false;
  };
}

export { registerQuizRoute };
