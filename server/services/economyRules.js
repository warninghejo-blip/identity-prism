export const PRISM_EARN_MAX_PER_CALL = Object.freeze({
  game_orbit: 50,
  game_defender: 50,
  game_gravity: 50,
  scan_wallet: 5,
  achievement: 50,
  quest_daily: 15,
  quest_weekly: 50,
  quest_milestone: 100,
  challenge_win: 30,
  first_mint: 1000,
  text_quest: 1200,
  sybil_hunt: 70,
});

export const getHolderAdjustedCap = (baseCap, isHolder) => (
  isHolder ? baseCap : Math.floor(baseCap / 2)
);

export const applyStakingBoostAfterCap = (baseEarned, boost) => (
  boost > 0 ? Math.floor(baseEarned * (1 + boost)) : baseEarned
);

export const canAwardQuizReward = ({
  dailyCount,
  maxDailyAnswers,
  ngEarned,
  reward,
  nonGameCap,
}) => dailyCount < maxDailyAnswers && ngEarned + reward <= nonGameCap;
