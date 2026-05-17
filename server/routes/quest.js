function registerQuestRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      requireJwt,
      readBody,
      respondJson,
      getToday,
    },
    wallet: {
      triggerCompositeUpdate,
    },
    economy: {
      quests,
      getQuestProgressSnapshot,
      invalidateQuestProgressCache = () => {},
      getQuestPeriodKey,
      questSourceIds,
      questXpRewards = {},
      saveQuestProgressDebounced,
    },
  } = ctx;

  const validQuestIds = new Set([
    'daily_scan', 'daily_game', 'daily_burn', 'daily_explore', 'daily_highscore',
    'weekly_burn5', 'weekly_games5', 'weekly_arena', 'weekly_streak', 'weekly_forge',
    'ot_first_scan', 'ot_first_mint', 'ot_first_burn', 'ot_first_game',
    'ot_reach_sun', 'ot_burn100', 'ot_score1000', 'ot_forge5', 'ot_arena_wins', 'ot_text_quest',
  ]);

  return async function handleQuestRoute(req, res, url, pathname) {
    if (pathname === '/api/quest/sync' && req.method === 'POST') {
      if (!ipRateLimit('quest_sync', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const { address, quests: incomingQuests } = JSON.parse(await readBody(req));
        if (address && address !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
        const addr = jwtAuth.address;
        if (!incomingQuests || typeof incomingQuests !== 'object' || Array.isArray(incomingQuests)) return respondJson(res, 400, { error: 'quests object required' });

        const existing = quests.get(addr) || { quests: {}, streakDays: 0, lastStreakDate: '' };
        const existingQuests = existing.quests || {};
        const serverSnapshot = getQuestProgressSnapshot(addr);
        const sanitized = {};

        for (const key of validQuestIds) {
          const prev = existingQuests[key] || {};
          const incomingQuest = incomingQuests[key] && typeof incomingQuests[key] === 'object' ? incomingQuests[key] : {};
          const serverQuest = serverSnapshot[key] || { progress: 0, completed: false, periodKey: getQuestPeriodKey(key) };
          const periodChanged = (prev.periodKey || 'all_time') !== serverQuest.periodKey;
          const alreadyClaimedThisPeriod = prev.claimed === true && !periodChanged;
          const incomingClaimed = incomingQuest.claimed === true || Boolean(incomingQuest.claimedAt);
          const newlyClaimed = !alreadyClaimedThisPeriod && incomingClaimed && serverQuest.completed;
          const stickyClaim = (questSourceIds.quest_daily.has(key) || questSourceIds.quest_weekly.has(key))
            ? (alreadyClaimedThisPeriod || newlyClaimed)
            : (prev.claimed === true || newlyClaimed);

          sanitized[key] = {
            progress: serverQuest.progress,
            completed: serverQuest.completed,
            claimed: stickyClaim,
            periodKey: serverQuest.periodKey,
            completedAt: serverQuest.completed ? (prev.completedAt || new Date().toISOString()) : null,
            claimedAt: stickyClaim ? (prev.claimedAt || incomingQuest.claimedAt || new Date().toISOString()) : null,
          };
        }

        const prevClaimedKeys = new Set(
          Object.entries(existingQuests)
            .filter(([, quest]) => quest?.claimed === true)
            .map(([questId, quest]) => `${questId}:${quest?.periodKey || 'all_time'}`),
        );
        const newlyClaimedXp = Object.entries(sanitized)
          .filter(([questId, quest]) => quest.claimed === true && !prevClaimedKeys.has(`${questId}:${quest.periodKey || 'all_time'}`))
          .reduce((sum, [questId]) => sum + (questXpRewards[questId] || 0), 0);

        const today = getToday();
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const hasCompletedDailyQuest = ['daily_scan', 'daily_game', 'daily_burn', 'daily_explore', 'daily_highscore']
          .some((questId) => sanitized[questId]?.completed);

        let streakDays = existing.streakDays || 0;
        if (existing.lastStreakDate === today) {
          // same day — keep streak as-is
        } else if (!hasCompletedDailyQuest) {
          if (existing.lastStreakDate && existing.lastStreakDate !== yesterday) streakDays = 0;
        } else {
          streakDays = existing.lastStreakDate === yesterday ? streakDays + 1 : 1;
        }

        sanitized.weekly_streak = {
          ...sanitized.weekly_streak,
          progress: Math.min(5, streakDays),
          completed: streakDays >= 5,
        };

        const streakDate = hasCompletedDailyQuest ? today : (existing.lastStreakDate || today);

        quests.set(addr, {
          ...existing,
          quests: sanitized,
          totalXPEarned: Math.max(0, Number(existing.totalXPEarned) || 0) + newlyClaimedXp,
          streakDays,
          lastStreakDate: streakDate,
          updatedAt: new Date().toISOString(),
        });

        invalidateQuestProgressCache(addr);
        saveQuestProgressDebounced();
        triggerCompositeUpdate(addr);
        const result = {};
        for (const key of validQuestIds) {
          const sani = sanitized[key];
          const serverQ = serverSnapshot[key] || { completed: false, progress: 0 };
          const incomingQuest = incomingQuests[key] && typeof incomingQuests[key] === 'object' ? incomingQuests[key] : {};
          const incomingClaimed = incomingQuest.claimed === true || Boolean(incomingQuest.claimedAt);
          result[key] = {
            serverCompleted: serverQ.completed,
            serverProgress: serverQ.progress,
            accepted: incomingClaimed ? (sani.claimed === true && serverQ.completed) : true,
          };
        }
        respondJson(res, 200, { ok: true, result });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      }
      return true;
    }

    if (pathname === '/api/quest/progress' && req.method === 'GET') {
      if (!ipRateLimit('quest_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const addr = url.searchParams.get('address') || jwtAuth.address;
      if (!addr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return respondJson(res, 400, { error: 'Valid address required' });
      if (addr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      const qp = quests.get(addr) || { quests: {} };
      respondJson(res, 200, qp);
      return true;
    }

    return false;
  };
}

export { registerQuestRoute };
