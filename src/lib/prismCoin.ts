/**
 * Coins — unified in-game currency for Identity Prism.
 * Earned through gameplay, burns, scans, achievements, quests.
 * Spent in Prism Shop on card frames, auras, ship skins, titles.
 *
 * Persistence: server-side via /api/prism/* endpoints (backed by coinBalances).
 * Fallback: localStorage for offline/anonymous use.
 */

import { getHeliusProxyUrl } from '@/constants';

// ── Types ──

export interface PrismBalance {
  address: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  lastUpdated: string;
}

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
  | 'scan_wallet'
  | 'achievement'
  | 'quest_daily'
  | 'quest_weekly'
  | 'quest_milestone'
  | 'challenge_win'
  | 'first_mint'
  | 'referral'
  | 'text_quest';

export type PrismSpendSource =
  | 'forge_frame'
  | 'forge_aura'
  | 'forge_ship_skin'
  | 'forge_title'
  | 'forge_module'
  | 'challenge_entry';

// ── Earn rates ──

export const PRISM_EARN_RATES: Record<PrismEarnSource, number> = {
  game_orbit: 1,           // per 10 seconds survived
  game_defender: 2,        // per level cleared
  game_gravity: 1,         // per 80 points (gravity is harder)
  burn_tokens: 5,          // per token burned
  burn_nfts: 10,           // per NFT burned
  scan_wallet: 3,          // per wallet scan (max 1/hour)
  achievement: 25,         // per achievement unlocked
  quest_daily: 15,         // per daily quest completed
  quest_weekly: 50,        // per weekly quest completed
  quest_milestone: 100,    // per milestone quest completed
  challenge_win: 30,       // per challenge won
  first_mint: 100,         // one-time bonus for first mint
  referral: 20,            // per referred user who scans
  text_quest: 1,           // text quest reward (custom amount)
};

// ── Local storage keys ──

const BALANCE_KEY = 'prism_balance_v1';
const TRANSACTIONS_KEY = 'prism_transactions_v1';

// ── API helpers ──

function getApiBase(): string {
  const proxy = getHeliusProxyUrl();
  if (proxy) return proxy;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

async function apiCall<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
  } catch {}
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
  } catch {}
}

function getLocalTransactions(address: string): PrismTransaction[] {
  try {
    const data = localStorage.getItem(`${TRANSACTIONS_KEY}_${address}`);
    if (data) return JSON.parse(data);
  } catch {}
  return [];
}

function saveLocalTransaction(address: string, tx: PrismTransaction): void {
  try {
    const txs = getLocalTransactions(address);
    txs.unshift(tx);
    // Keep last 200 transactions
    if (txs.length > 200) txs.length = 200;
    localStorage.setItem(`${TRANSACTIONS_KEY}_${address}`, JSON.stringify(txs));
  } catch {}
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
  } catch { return true; }
}

export function markScanEarned(address: string): void {
  try {
    localStorage.setItem(`${SCAN_COOLDOWN_KEY}_${address}`, String(Date.now()));
  } catch {}
}

/**
 * Get PRISM balance for a wallet address.
 * Tries server first, falls back to localStorage.
 */
export async function getPrismBalance(address: string): Promise<PrismBalance> {
  const serverBalance = await apiCall<PrismBalance>(`/api/prism/balance?address=${address}`);
  if (serverBalance) return serverBalance;
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
): Promise<{ balance: PrismBalance; earned: number }> {
  const earned = amount ?? PRISM_EARN_RATES[source] ?? 1;
  const desc = description ?? `Earned ${earned} Coins from ${source.replace(/_/g, ' ')}`;

  // Try server first
  const serverResult = await apiCall<{ balance: PrismBalance; earned: number }>(
    '/api/prism/earn',
    { address, source, amount: earned, description: desc },
  );

  if (serverResult) return serverResult;

  // Fallback: local
  const balance = getLocalBalance(address);
  balance.balance += earned;
  balance.totalEarned += earned;
  balance.lastUpdated = new Date().toISOString();
  saveLocalBalance(balance);

  const tx: PrismTransaction = {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    address,
    amount: earned,
    type: 'earn',
    source,
    description: desc,
    timestamp: new Date().toISOString(),
  };
  saveLocalTransaction(address, tx);

  return { balance, earned };
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
): Promise<{ balance: PrismBalance; spent: number } | null> {
  const desc = description ?? `Spent ${amount} Coins on ${source.replace(/_/g, ' ')}`;

  // Try server first
  const serverResult = await apiCall<{ balance: PrismBalance; spent: number }>(
    '/api/prism/spend',
    { address, source, amount, description: desc },
  );

  if (serverResult) return serverResult;

  // Fallback: local
  const balance = getLocalBalance(address);
  if (balance.balance < amount) return null;

  balance.balance -= amount;
  balance.totalSpent += amount;
  balance.lastUpdated = new Date().toISOString();
  saveLocalBalance(balance);

  const tx: PrismTransaction = {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    address,
    amount,
    type: 'spend',
    source,
    description: desc,
    timestamp: new Date().toISOString(),
  };
  saveLocalTransaction(address, tx);

  return { balance, spent: amount };
}

/**
 * Get transaction history for a wallet.
 */
export async function getPrismTransactions(
  address: string,
  limit = 50,
): Promise<PrismTransaction[]> {
  const serverTxs = await apiCall<PrismTransaction[]>(
    `/api/prism/transactions?address=${address}&limit=${limit}`,
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
  return tokensBurned * PRISM_EARN_RATES.burn_tokens +
         nftsBurned * PRISM_EARN_RATES.burn_nfts;
}
