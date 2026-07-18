const BASE_ACTIVE_RUN_MS = 15 * 60 * 1000;
// Absorbs normal start/finish RTT at the run boundary. It is part of both the
// timing allowance and the score-ceiling duration, never an extra revive.
const START_GRACE_MS = 90 * 1000;
const REVIVE_ACTIVE_EXTENSION_MS = 5 * 60 * 1000;
const MAX_FREE_REVIVES_PER_RUN = 3;
const MAX_PAID_REVIVES_PER_RUN = 3;
const MAX_REVIVES_PER_RUN = 6;
const MAX_ACTIVE_GAME_DURATION_MS = 45 * 60 * 1000;
const MAX_PAUSE_FOR_GRANT_MS = 3 * 60 * 1000;
// A challenge proof must settle by its deadline, but the follow-up arena
// submission gets this short transport grace. Scheduler expiry uses the same
// value so a valid proof cannot be refunded between those two requests.
const CHALLENGE_SUBMIT_GRACE_MS = 60 * 1000;
const MAX_SERVER_GAME_WALL_MS = 70 * 60 * 1000;
const GAME_START_TOKEN_TTL_MS = 70 * 60 * 1000;
const GAME_START_TOKEN_TTL_MAX_MS = 75 * 60 * 1000;
const MAX_SESSION_AGE_MS = 70 * 60 * 1000;
const MAX_SESSION_DURATION_MS = 70 * 60 * 1000;
const MAX_GAME_WINDOW_MS = 70 * 60 * 1000;
const MAX_SESSION_SCORE = 300_000;

const MAX_DELTA_PER_GAME = Object.freeze({ orbit: 1000, gravity: 1200, destroyer: 1800 });
const ABSOLUTE_SCORE_CEILINGS = Object.freeze({ orbit: 288_908, gravity: 27_008, destroyer: 270_100 });

const activeSeconds = (activeDurationMs) => Math.max(0, Math.floor(Math.max(0, Number(activeDurationMs) || 0) / 1000));

// START_GRACE_MS only absorbs honest timing jitter at the start/finish boundary.
// It must never create extra coin-earning seconds: economic duration is capped at
// the base run plus server-authorized revive extensions, without that grace.
function calculateEconomicDurationMs({ activeDurationMs, validGrantCount = 0 }) {
  const authorizedActiveMs = Math.min(
    MAX_ACTIVE_GAME_DURATION_MS,
    BASE_ACTIVE_RUN_MS + (Math.min(MAX_REVIVES_PER_RUN, Math.max(0, Number(validGrantCount) || 0)) * REVIVE_ACTIVE_EXTENSION_MS),
  );
  return Math.min(Math.max(0, Number(activeDurationMs) || 0), authorizedActiveMs);
}

function getScoreCeiling(gameMode, activeDurationMs) {
  const seconds = activeSeconds(activeDurationMs);
  if (gameMode === 'orbit') return Math.min(ABSOLUTE_SCORE_CEILINGS.orbit, (107 * seconds) + 8);
  if (gameMode === 'gravity') return Math.min(ABSOLUTE_SCORE_CEILINGS.gravity, (10 * seconds) + 8);
  if (gameMode === 'destroyer') return Math.min(ABSOLUTE_SCORE_CEILINGS.destroyer, (100 * seconds) + 100);
  return 0;
}

function formatMMSS(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function calculateAuthoritativeTiming({ issuedAtMs, submittedAtMs, pausedMs = 0, openPauseStartedAtMs = null, validGrantCount = 0 }) {
  const wallDurationMs = Math.max(0, Number(submittedAtMs) - Number(issuedAtMs));
  const hasOpenPause = openPauseStartedAtMs !== null && openPauseStartedAtMs !== undefined;
  const openPauseMs = hasOpenPause && Number.isFinite(Number(openPauseStartedAtMs))
    ? Math.max(0, Number(submittedAtMs) - Number(openPauseStartedAtMs))
    : 0;
  const totalPausedMs = Math.max(0, Number(pausedMs) || 0) + openPauseMs;
  const activeDurationMs = Math.max(0, wallDurationMs - totalPausedMs);
  const allowedActiveMs = Math.min(MAX_ACTIVE_GAME_DURATION_MS,
    BASE_ACTIVE_RUN_MS + (Math.min(MAX_REVIVES_PER_RUN, Math.max(0, validGrantCount)) * REVIVE_ACTIVE_EXTENSION_MS))
    + START_GRACE_MS;
  const scoreCeilingDurationMs = Math.min(activeDurationMs, allowedActiveMs);
  return {
    wallDurationMs,
    pausedMs: totalPausedMs,
    activeDurationMs,
    allowedActiveMs,
    scoreCeilingDurationMs,
    timingVerified: wallDurationMs <= MAX_SERVER_GAME_WALL_MS && activeDurationMs <= allowedActiveMs,
  };
}

export {
  ABSOLUTE_SCORE_CEILINGS,
  BASE_ACTIVE_RUN_MS,
  CHALLENGE_SUBMIT_GRACE_MS,
  GAME_START_TOKEN_TTL_MAX_MS,
  GAME_START_TOKEN_TTL_MS,
  MAX_ACTIVE_GAME_DURATION_MS,
  MAX_FREE_REVIVES_PER_RUN,
  MAX_GAME_WINDOW_MS,
  MAX_PAID_REVIVES_PER_RUN,
  MAX_PAUSE_FOR_GRANT_MS,
  MAX_REVIVES_PER_RUN,
  MAX_SERVER_GAME_WALL_MS,
  MAX_SESSION_AGE_MS,
  MAX_SESSION_DURATION_MS,
  MAX_SESSION_SCORE,
  MAX_DELTA_PER_GAME,
  REVIVE_ACTIVE_EXTENSION_MS,
  START_GRACE_MS,
  activeSeconds,
  calculateAuthoritativeTiming,
  calculateEconomicDurationMs,
  formatMMSS,
  getScoreCeiling,
};
