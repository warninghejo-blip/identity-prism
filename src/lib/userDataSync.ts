/**
 * User Data Sync — persists client-only data to server.
 * Syncs: loadout, game stats, best scores, text quest saves, ranger XP.
 *
 * Flow:
 *  1. On wallet connect: loadFromServer() → restore any missing localStorage data
 *  2. On every local save: syncToServer() (debounced) → push to server
 *
 * Server endpoint: POST /api/user-data (JWT required)
 */

import { getApiBase, ensureJwt, fetchApiJson, postApiJson } from '@/components/prism/shared';

// ── Debounced sync ──

let _syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE = 3000; // 3 sec debounce

async function postUserData(data: Record<string, unknown>): Promise<boolean> {
  try {
    const base = getApiBase();
    const jwt = await ensureJwt();
    if (!jwt) return false;
    await postApiJson(`${base}/api/user-data`, data, { headers: { Authorization: `Bearer ${jwt}` }, timeoutMs: 8_000 });
    return true;
  } catch {
    return false;
  }
}

/** Push specific fields to server (debounced). */
export function syncToServer(data: Record<string, unknown>): void {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    postUserData(data).catch(() => {});
  }, SYNC_DEBOUNCE);
}

/** Push immediately (for important saves like purchases). */
export async function syncToServerNow(data: Record<string, unknown>): Promise<boolean> {
  if (_syncTimer) clearTimeout(_syncTimer);
  return postUserData(data);
}

// ── Load from server & restore localStorage ──

interface ServerUserData {
  loadout?: unknown;
  gameStats?: unknown;
  bestScores?: Record<string, unknown>;
  textQuests?: Record<string, unknown>;
  rangerXP?: unknown;
  achievements?: unknown;
  lastSyncAt?: string;
}

/**
 * Load user data from server and restore missing localStorage entries.
 * Called once on wallet connect. Does NOT overwrite existing localStorage
 * (client is always fresher if present).
 */
export async function loadFromServer(address: string): Promise<void> {
  try {
    const base = getApiBase();
    const jwt = await ensureJwt();
    if (!jwt) return;
    const { userData } = await fetchApiJson<{ userData: ServerUserData | null }>(`${base}/api/user-data`, {
      headers: { Authorization: `Bearer ${jwt}` },
      timeoutMs: 8_000,
    });
    if (!userData) return;

    // Restore loadout from server authoritatively
    if (userData.loadout) {
      const key = `prism_forge_loadout_v1_${address}`;
      localStorage.setItem(key, JSON.stringify(userData.loadout));
    }

    // Restore game stats if missing locally
    if (userData.gameStats && typeof userData.gameStats === 'object') {
      const stats = userData.gameStats as Record<string, unknown>;
      for (const [key, value] of Object.entries(stats)) {
        if (!localStorage.getItem(key) && value) {
          localStorage.setItem(key, JSON.stringify(value));
        }
      }
    }

    // Restore best scores if missing locally
    if (userData.bestScores && typeof userData.bestScores === 'object') {
      for (const [key, value] of Object.entries(userData.bestScores)) {
        if (!localStorage.getItem(key) && value !== undefined) {
          localStorage.setItem(key, String(value));
        }
      }
    }

    // Restore text quest saves if missing locally
    if (userData.textQuests && typeof userData.textQuests === 'object') {
      for (const [key, value] of Object.entries(userData.textQuests)) {
        const lsKey = `text_quest_v1_${address}_${key}`;
        if (!localStorage.getItem(lsKey) && value) {
          localStorage.setItem(lsKey, JSON.stringify(value));
        }
      }
    }

    // Restore quest progress if missing locally
    if (userData.rangerXP) {
      const key = `prism_quests_v1_${address}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(userData.rangerXP));
      }
    }

    // Restore achievement snapshots if missing locally
    if (userData.achievements && typeof userData.achievements === 'object') {
      const achievements = userData.achievements as Record<string, unknown>;
      for (const [key, value] of Object.entries(achievements)) {
        if (!localStorage.getItem(key) && value) {
          localStorage.setItem(key, JSON.stringify(value));
        }
      }
    }
  } catch {
    // Silent fail — localStorage is the primary, server is backup
  }
}

// ── Convenience: collect all local data for a wallet ──

export function collectLocalData(address: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  // Loadout
  try {
    const raw = localStorage.getItem(`prism_forge_loadout_v1_${address}`);
    if (raw) data.loadout = JSON.parse(raw);
  } catch {
    /* ignore */
  }

  // Game stats
  const gameStatsKeys = [
    'orbit_survival_stats_v1',
    'cosmic_defender_stats_v1',
    'gravity_rush_stats_v1',
    'cosmic_mine_stats_v1',
  ];
  const gameStats: Record<string, unknown> = {};
  for (const key of gameStatsKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) gameStats[key] = JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }
  if (Object.keys(gameStats).length > 0) data.gameStats = gameStats;

  // Best scores
  const modes = ['orbit_survival', 'cosmic_defender', 'gravity_rush', 'cosmic_mine', 'cosmic_runner'];
  const bestScores: Record<string, unknown> = {};
  for (const mode of modes) {
    const key = `prism_league_best_${mode}_${address}`;
    const val = localStorage.getItem(key);
    if (val) bestScores[key] = val;
  }
  if (Object.keys(bestScores).length > 0) data.bestScores = bestScores;

  // Text quest saves
  const textQuests: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(`text_quest_v1_${address}_`)) {
      const questId = key.replace(`text_quest_v1_${address}_`, '');
      try {
        textQuests[questId] = JSON.parse(localStorage.getItem(key) || '');
      } catch {
        /* ignore */
      }
    }
  }
  if (Object.keys(textQuests).length > 0) data.textQuests = textQuests;

  // Quest/XP progress
  try {
    const raw = localStorage.getItem(`prism_quests_v1_${address}`);
    if (raw) data.rangerXP = JSON.parse(raw);
  } catch {
    /* ignore */
  }

  // Achievements
  const achievementKeys = [
    'orbit_survival_achievements_v1',
    'cosmic_defender_achievements_v1',
    'gravity_rush_achievements_v1',
  ];
  const achievements: Record<string, unknown> = {};
  for (const key of achievementKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) achievements[key] = JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }
  if (Object.keys(achievements).length > 0) data.achievements = achievements;

  return data;
}

/**
 * Full sync: collect all local data and push to server.
 * Call after any significant user action or periodically.
 */
export function fullSync(address: string): void {
  const data = collectLocalData(address);
  if (Object.keys(data).length > 0) {
    syncToServer(data);
  }
}
