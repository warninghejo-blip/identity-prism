/**
 * userDataSync — tests for collectLocalData (pure localStorage read logic)
 * and syncToServer debouncing behaviour.
 * No network calls needed — mocked via vi.mock for getApiBase/ensureJwt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the shared module so getApiBase / ensureJwt don't blow up
vi.mock('@/components/prism/shared', () => ({
  getApiBase: () => 'http://localhost:3000',
  ensureJwt: vi.fn().mockResolvedValue('test-jwt'),
}));

// Mock fetch globally (we test debounce, not actual network)
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

import { collectLocalData, syncToServer } from '../userDataSync';

const ADDR = 'TestWallet123';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('collectLocalData', () => {
  it('returns empty object when localStorage is empty', () => {
    const data = collectLocalData(ADDR);
    expect(Object.keys(data)).toHaveLength(0);
  });

  it('includes loadout when present in localStorage', () => {
    const loadout = { equippedFrame: 'frame_solar_flare', equippedShipSkin: null, equippedAura: null };
    localStorage.setItem(`prism_forge_loadout_v1_${ADDR}`, JSON.stringify(loadout));
    const data = collectLocalData(ADDR);
    expect(data.loadout).toEqual(loadout);
  });

  it('does not include loadout for different address', () => {
    localStorage.setItem(`prism_forge_loadout_v1_OtherAddr`, JSON.stringify({ x: 1 }));
    const data = collectLocalData(ADDR);
    expect(data.loadout).toBeUndefined();
  });

  it('includes gameStats when game stat keys are present', () => {
    localStorage.setItem('orbit_survival_stats_v1', JSON.stringify({ kills: 10 }));
    const data = collectLocalData(ADDR);
    expect(data.gameStats).toBeDefined();
    expect((data.gameStats as Record<string, unknown>)['orbit_survival_stats_v1']).toEqual({ kills: 10 });
  });

  it('includes bestScores when a league best score exists', () => {
    const key = `prism_league_best_orbit_survival_${ADDR}`;
    localStorage.setItem(key, '9500');
    const data = collectLocalData(ADDR);
    expect(data.bestScores).toBeDefined();
    expect((data.bestScores as Record<string, unknown>)[key]).toBe('9500');
  });

  it('includes rangerXP when quest progress exists', () => {
    const xp = { totalXP: 250, level: 3 };
    localStorage.setItem(`prism_quests_v1_${ADDR}`, JSON.stringify(xp));
    const data = collectLocalData(ADDR);
    expect(data.rangerXP).toEqual(xp);
  });

  it('includes textQuests saved under the address prefix', () => {
    localStorage.setItem(`text_quest_v1_${ADDR}_quest_forest`, JSON.stringify({ step: 2 }));
    const data = collectLocalData(ADDR);
    expect(data.textQuests).toBeDefined();
    expect((data.textQuests as Record<string, unknown>)['quest_forest']).toEqual({ step: 2 });
  });

  it('ignores corrupt JSON without throwing', () => {
    localStorage.setItem(`prism_forge_loadout_v1_${ADDR}`, 'NOT_JSON{{');
    expect(() => collectLocalData(ADDR)).not.toThrow();
  });
});

describe('syncToServer debounce', () => {
  it('does not call fetch immediately', () => {
    syncToServer({ loadout: { a: 1 } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls fetch after 3 second debounce', async () => {
    syncToServer({ loadout: { a: 1 } });
    vi.advanceTimersByTime(3000);
    // Allow microtasks (promise resolution)
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('debounces multiple rapid calls into a single fetch', async () => {
    syncToServer({ loadout: { a: 1 } });
    syncToServer({ loadout: { a: 2 } });
    syncToServer({ loadout: { a: 3 } });
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
