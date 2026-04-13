/**
 * Typed API client for Identity Prism.
 * New code should use api.* methods. Legacy fetch calls migrated gradually.
 */

import { getSessionJwt } from '@/components/prism/shared';

const BASE = import.meta.env.VITE_HELIUS_PROXY_URL || '';

// New APK uses /api/v2/ for all breaking endpoints (old APK ≤1.0.32 uses /api/)
const API_V2 = '/api/v2';

export interface IdentityPerkSnapshot {
  address?: string;
  hasIdentityPrism: boolean;
  gameCoinMultiplier: number;
  freeRevivesPerDay: number;
  blackHoleCommissionRate: number;
  standardBlackHoleCommissionRate: number;
  holderBlackHoleCommissionRate: number;
}

function getAuthHeaders(): Record<string, string> {
  const jwt = getSessionJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json();
}

export const api = {
  getWalletData: (addr: string) => apiFetch<Record<string, unknown>>(`/api/wallet-database?address=${addr}`),

  getSybil: (addr: string) => apiFetch<Record<string, unknown>>(`/api/sybil/analysis?address=${addr}`),

  getLeaderboard: (gameType?: string) =>
    apiFetch<{ entries: unknown[] }>(`${API_V2}/game/leaderboard${gameType ? `?gameType=${gameType}` : ''}`),

  getReputation: (addr: string) => apiFetch<Record<string, unknown>>(`/api/v2/reputation?address=${addr}`),

  getIdentityPerks: (addr: string) =>
    apiFetch<IdentityPerkSnapshot>(`/api/identity/perks?address=${encodeURIComponent(addr)}`),

  postCoins: (delta: number) =>
    apiFetch<{ address: string; coins: number }>(`${API_V2}/game/coins`, {
      method: 'POST',
      body: JSON.stringify({ delta }),
    }),

  postLeaderboard: (data: { address: string; score: number; gameType: string }) =>
    apiFetch(`${API_V2}/game/leaderboard`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  postScoreHistory: (data: { address: string; score: number; tier: string }) =>
    apiFetch('/api/score-history', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  syncQuests: (address: string, quests: Record<string, unknown>) =>
    apiFetch('/api/quest/sync', {
      method: 'POST',
      body: JSON.stringify({ address, quests }),
    }),

  getQuestProgress: (addr: string) => apiFetch<Record<string, unknown>>(`/api/quest/progress?address=${addr}`),
};
