/**
 * Coins — unified in-game currency for Identity Prism.
 * Earned through gameplay, burns, scans, achievements, quests.
 * Spent in Prism Shop on card frames, auras, ship skins, titles.
 *
 * Persistence: server-side via /api/prism/* endpoints (backed by coinBalances).
 * Fallback: localStorage for offline/anonymous use.
 */

import { getApiBase, ensureJwt } from '@/components/prism/shared';
import { toast } from 'sonner';

// ── Types ──

export interface PrismBalance {
  address: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  lastUpdated: string;
}

// ── Coin Packages (shared between StellarForge and PrismVault) ──

export const COIN_PACKAGES = [
  { coins: 5000, solPrice: 0.015, label: 'Starter' },
  { coins: 15000, solPrice: 0.038, label: 'Explorer' },
  { coins: 50000, solPrice: 0.11, label: 'Voyager' },
  { coins: 150000, solPrice: 0.23, label: 'Commander' },
] as const;

export interface PrismTransaction {
  id: string;
  address: string;
  amount: number;
  type: 'earn' | 'spend';
  source: PrismEarnSource | PrismSpendSource;
  description: string;
  timestamp: string;
}

export type PrismEarnSource =
  | 'game_orbit'
  | 'game_defender'
  | 'game_gravity'
  | 'burn_tokens'
  | 'burn_nfts'
  | 'blackhole_cleanup'
  | 'scan_wallet'
  | 'achievement'
  | 'quest_daily'
  | 'quest_weekly'
  | 'quest_milestone'
  | 'challenge_win'
  | 'first_mint'
  | 'referral'
  | 'text_quest'
  | 'sybil_hunt'
  | 'quiz';

export type PrismSpendSource =
  | 'forge_frame'
  | 'forge_aura'
  | 'forge_ship_skin'
  | 'forge_title'
  | 'forge_module'
  | 'challenge_entry';

export interface PrismSpendMetadata {
  itemId?: string;
  moduleId?: string;
}

export interface PrismEarnMetadata {
  scanTarget?: string;
}

// ── Earn rates ──

export const PRISM_EARN_RATES: Record<PrismEarnSource, number> = {
  game_orbit: 1, // per 10 seconds survived
  game_defender: 2, // per level cleared
  game_gravity: 1, // per 80 points (gravity is harder)
  burn_tokens: 5, // per token burned
  burn_nfts: 10, // per NFT burned
  blackhole_cleanup: 0, // server-calculated from verified net cleanup
  scan_wallet: 5, // per wallet scan in sybil hunt
  achievement: 25, // per achievement unlocked
  quest_daily: 15, // per daily quest completed
  quest_weekly: 50, // per weekly quest completed
  quest_milestone: 100, // per milestone quest completed
  challenge_win: 30, // per challenge won
  first_mint: 1000, // one-time bonus for first mint
  referral: 20, // per referred user who scans
  text_quest: 1, // text quest reward (custom amount)
  sybil_hunt: 20, // server-validated bounty for high-confidence sybil catches
  quiz: 5, // per correct quiz answer
};

// ── Local storage keys ──

const BALANCE_KEY = 'prism_balance_v1';
const TRANSACTIONS_KEY = 'prism_transactions_v1';

// ── API helpers ──

async function apiCall<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const base = getApiBase();
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    const jwt = await ensureJwt();
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
    const res = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Local storage fallback ──

function getLocalBalance(address: string): PrismBalance {
  try {
    const data = localStorage.getItem(`${BALANCE_KEY}_${address}`);
    if (data) return JSON.parse(data);
  } catch {
    /* localStorage unavailable */
  }
  return {
    address,
    balance: 0,
    totalEarned: 0,
    totalSpent: 0,
    lastUpdated: new Date().toISOString(),
  };
}

function saveLocalBalance(balance: PrismBalance): void {
  try {
    localStorage.setItem(`${BALANCE_KEY}_${balance.address}`, JSON.stringify(balance));
  } catch {
    /* localStorage unavailable */
  }
}

function getLocalTransactions(address: string): PrismTransaction[] {
  try {
    const data = localStorage.getItem(`${TRANSACTIONS_KEY}_${address}`);
    if (data) return JSON.parse(data);
  } catch {
    /* localStorage unavailable */
  }
  return [];
}

function saveLocalTransaction(address: string, tx: PrismTransaction): void {
  try {
    const txs = getLocalTransactions(address);
    txs.unshift(tx);
    // Keep last 200 transactions
    if (txs.length > 200) txs.length = 200;
    localStorage.setItem(`${TRANSACTIONS_KEY}_${address}`, JSON.stringify(txs));
  } catch {
    /* localStorage unavailable */
  }
}

// ── Public API ──

// ── Scan cooldown (1 earn per hour per wallet) ──

const SCAN_COOLDOWN_KEY = 'prism_scan_cooldown_v1';
const SCAN_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export function canEarnFromScan(address: string): boolean {
  try {
    const lastScan = localStorage.getItem(`${SCAN_COOLDOWN_KEY}_${address}`);
    if (!lastScan) return true;
    return Date.now() - Number(lastScan) >= SCAN_COOLDOWN_MS;
  } catch {
    return true;
  }
}

export function markScanEarned(address: string): void {
  try {
    localStorage.setItem(`${SCAN_COOLDOWN_KEY}_${address}`, String(Date.now()));
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * Get PRISM balance for a wallet address.
 * Tries server first, falls back to localStorage.
 */
export async function getPrismBalance(address: string): Promise<PrismBalance> {
  // Check prefetch cache first
  try {
    const { getCachedBalance } = await import('@/lib/prefetch');
    const cached = getCachedBalance(address);
    if (cached) {
      saveLocalBalance(cached as PrismBalance);
      return cached as PrismBalance;
    }
  } catch {
    /* ignore */
  }
  const serverBalance = await apiCall<PrismBalance>(`/api/prism/balance?address=${encodeURIComponent(address)}`);
  if (serverBalance) {
    // Persist to localStorage so gatherXPSources can read totalEarned without async calls
    saveLocalBalance(serverBalance);
    return serverBalance;
  }
  return getLocalBalance(address);
}

/**
 * Earn PRISM coins.
 * Returns the new balance after earning.
 */
export async function earnPrism(
  address: string,
  source: PrismEarnSource,
  amount?: number,
  description?: string,
  questId?: string,
  metadata?: PrismEarnMetadata,
): Promise<{ balance: PrismBalance; earned: number }> {
  const earned = Math.max(0, amount ?? PRISM_EARN_RATES[source] ?? 1);
  const desc = description ?? `Earned ${earned} Coins from ${source.replace(/_/g, ' ')}`;

  // Check JWT — show toast if not signed
  const jwt = await ensureJwt();
  if (!jwt) {
    toast.error('Sign your wallet to earn coins', { id: 'jwt-required' });
    const balance = await getPrismBalance(address);
    return { balance, earned: 0 };
  }

  // Try server first
  const serverResult = await apiCall<{ balance: PrismBalance; earned: number }>('/api/v2/prism/earn', {
    address,
    source,
    amount: earned,
    description: desc,
    ...(questId ? { questId } : {}),
    ...(metadata?.scanTarget ? { scanTarget: metadata.scanTarget } : {}),
  });

  if (serverResult) return serverResult;

  // Server failed — return zero earned (no localStorage fallback to prevent fake balances)
  const balance = await getPrismBalance(address);
  return { balance, earned: 0 };
}

/**
 * Spend PRISM coins.
 * Returns the new balance if successful, or null if insufficient funds.
 */
export async function spendPrism(
  address: string,
  source: PrismSpendSource,
  amount: number,
  description?: string,
  metadata?: PrismSpendMetadata,
): Promise<{ balance: PrismBalance; spent: number } | null> {
  const desc = description ?? `Spent ${amount} Coins on ${source.replace(/_/g, ' ')}`;

  // Try server first
  const serverResult = await apiCall<{ balance: PrismBalance; spent: number }>('/api/prism/spend', {
    address,
    source,
    amount,
    description: desc,
    ...(metadata?.itemId ? { itemId: metadata.itemId } : {}),
    ...(metadata?.moduleId ? { moduleId: metadata.moduleId } : {}),
  });

  // Spending MUST be server-authoritative — no local fallback (prevents free purchases when server is down)
  return serverResult;
}

/**
 * Get transaction history for a wallet.
 */
export async function getPrismTransactions(address: string, limit = 50): Promise<PrismTransaction[]> {
  const serverTxs = await apiCall<PrismTransaction[]>(
    `/api/prism/transactions?address=${encodeURIComponent(address)}&limit=${limit}`,
  );
  if (serverTxs) return serverTxs;
  return getLocalTransactions(address).slice(0, limit);
}

/**
 * Calculate PRISM earned from a game score.
 */
export function calculateGamePrism(gameMode: 'orbit' | 'destroyer' | 'gravity', score: number, level?: number): number {
  if (gameMode === 'orbit') {
    // 1 PRISM per 100 points, min 1
    return Math.max(1, Math.floor(score / 100));
  }
  if (gameMode === 'gravity') {
    // 1 PRISM per 80 points, min 1 (gravity is harder)
    return Math.max(1, Math.floor(score / 80));
  }
  if (gameMode === 'destroyer') {
    // 2 PRISM per level + bonus for score
    const levelBonus = (level ?? 1) * 2;
    const scoreBonus = Math.floor(score / 500);
    return levelBonus + scoreBonus;
  }
  return 0;
}

/**
 * Calculate PRISM earned from burning tokens in Black Hole.
 */
export function calculateBurnPrism(tokensBurned: number, nftsBurned: number): number {
  return tokensBurned * PRISM_EARN_RATES.burn_tokens + nftsBurned * PRISM_EARN_RATES.burn_nfts;
}
