function registerQuestRoute(ctx) {
  const {
    ipRateLimit,
    getClientIp,
    requireJwt,
    readBody,
    respondJson,
    quests,
    getQuestProgressSnapshot,
    getQuestPeriodKey,
    questSourceIds,
    getToday,
    saveQuestProgressDebounced,
    triggerCompositeUpdate,
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
          const serverQuest = serverSnapshot[key] || { progress: 0, completed: false, periodKey: getQuestPeriodKey(key) };
          const periodChanged = (prev.periodKey || 'all_time') !== serverQuest.periodKey;
          const stickyClaim = (questSourceIds.quest_daily.has(key) || questSourceIds.quest_weekly.has(key))
            ? (!periodChanged && prev.claimed === true)
            : (prev.claimed === true);

          sanitized[key] = {
            progress: serverQuest.progress,
            completed: serverQuest.completed,
            claimed: stickyClaim,
            periodKey: serverQuest.periodKey,
            completedAt: serverQuest.completed ? (prev.completedAt || new Date().toISOString()) : null,
            claimedAt: stickyClaim ? (prev.claimedAt || new Date().toISOString()) : null,
          };
        }

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
          streakDays,
          lastStreakDate: streakDate,
          updatedAt: new Date().toISOString(),
        });

        saveQuestProgressDebounced();
        triggerCompositeUpdate(addr);
        respondJson(res, 200, { ok: true });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      }
      return true;
    }

    if (pathname === '/api/quest/progress' && req.method === 'GET') {
      if (!ipRateLimit('quest_get', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const addr = url.searchParams.get('address');
      if (!addr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return respondJson(res, 400, { error: 'Valid address required' });
      const qp = quests.get(addr) || { quests: {} };
      respondJson(res, 200, qp);
      return true;
    }

    return false;
  };
}

export { registerQuestRoute };
