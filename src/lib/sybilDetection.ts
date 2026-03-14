/**
 * Sybil Detection Engine for Identity Prism v5.
 * Analyzes wallet behavior to detect potential sybil/airdrop-farming wallets.
 * 
 * Signals analyzed:
 * 1. Fund source concentration — did all SOL come from one wallet/CEX?
 * 2. Transaction pattern uniformity — robotic tx spacing/amounts
 * 3. Wallet age vs activity ratio — new wallet with burst activity
 * 4. Token diversity — real users hold diverse tokens, sybils don't
 * 5. NFT interaction depth — mint-and-dump vs genuine collecting
 * 6. DeFi engagement depth — real yield farming vs shallow touches
 * 7. Cluster detection — multiple wallets funded from same source
 */

import { getHeliusProxyUrl } from '@/constants';

// ── Types ──

export interface SybilAnalysis {
  address: string;
  riskScore: number;           // 0-100, higher = more likely sybil
  riskLevel: SybilRiskLevel;
  trustScore: number;          // 100 - riskScore (after trust bonus)
  trustGrade: string;          // A+, A, B, C, D, F
  signals: SybilSignal[];
  fundingSources: FundingSource[];
  clusterInfo: ClusterInfo | null;
  behaviorProfile: BehaviorProfile;
  metrics?: SybilMetrics;
  timestamp: string;
}

export interface SybilMetrics {
  walletAgeDays: number;
  activeDaysCount: number;
  activeDaysRatio: number;
  tokenDiversityCount: number;
  nftCount: number;
  incomingVolume: number;
  outgoingVolume: number;
  flowRatio: number;
  dustRatio: number;
  uniquePrograms: number;
  balance: number;
  historicalMaxBalance: number;
  txCount: number;
  clusterSimilarity: number;
}

export type SybilRiskLevel = 'clean' | 'low' | 'medium' | 'high' | 'critical';

export interface SybilSignal {
  id: string;
  name: string;
  description: string;
  weight: number;       // how much this contributes to risk (0-25)
  severity: 'info' | 'warning' | 'danger';
  detected: boolean;
  details?: string;
  category?: 'behavioral' | 'financial' | 'network';
  value?: string;
}

export interface FundingSource {
  address: string;
  label: string | null;  // "Binance Hot Wallet", "Unknown", etc.
  type: 'cex' | 'dex' | 'wallet' | 'bridge' | 'unknown';
  totalSolReceived: number;
  transactionCount: number;
  firstInteraction: string;
  lastInteraction: string;
  percentage: number;    // % of total funding from this source
}

export interface ClusterInfo {
  clusterId: string;
  clusterSize: number;
  sharedFundingSource: string;
  sharedFundingLabel: string | null;
  siblingWallets: string[];  // other wallets in the cluster (max 10)
  confidence: number;        // 0-100
}

export interface BehaviorProfile {
  txTimingVariance: number;      // low = robotic (0-1, higher is more human)
  txAmountVariance: number;      // low = scripted (0-1)
  protocolDiversity: number;     // 0-1, how many different protocols used
  holdingDuration: number;       // avg days tokens are held
  organicInteractions: number;   // count of "human-like" interactions
  suspiciousPatterns: string[];  // list of detected patterns
}

// ── Known CEX/Bridge addresses ──

const KNOWN_ADDRESSES: Record<string, { label: string; type: FundingSource['type'] }> = {
  // Binance
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': { label: 'Binance', type: 'cex' },
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': { label: 'Binance Hot Wallet', type: 'cex' },
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': { label: 'Binance', type: 'cex' },
  // Coinbase
  'H8sMJSCQxfKbeSTMe3fPaFKBMq3pS3bhVwn9dSjYqYLn': { label: 'Coinbase', type: 'cex' },
  'GJRs4FwHtemZ5ZE9Q3MNTDzoH7VDrKEswLzVRSJNDRLZ': { label: 'Coinbase', type: 'cex' },
  // Kraken
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': { label: 'Kraken', type: 'cex' },
  // FTX (historical)
  'GhFKzVMRdbLiAzoxjnLFGjRQP6Dqt5NJj7X5UkTGjHjB': { label: 'FTX (historical)', type: 'cex' },
  // Jupiter Aggregator
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': { label: 'Jupiter', type: 'dex' },
  // Raydium
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': { label: 'Raydium', type: 'dex' },
  // Wormhole
  'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb': { label: 'Wormhole Bridge', type: 'bridge' },
};

// ── Signal definitions ──

const SIGNAL_DEFS: Omit<SybilSignal, 'detected' | 'details'>[] = [
  { id: 'single_funder', name: 'Single Funding Source', description: 'Over 90% of SOL came from one address', weight: 15, severity: 'danger' },
  { id: 'fresh_wallet', name: 'Fresh Wallet Burst', description: 'Wallet <30 days old with >100 transactions', weight: 10, severity: 'warning' },
  { id: 'robotic_timing', name: 'Robotic Transaction Timing', description: 'Transactions have suspiciously uniform spacing', weight: 12, severity: 'danger' },
  { id: 'uniform_amounts', name: 'Uniform Transaction Amounts', description: 'Most transactions use identical amounts', weight: 8, severity: 'warning' },
  { id: 'low_token_diversity', name: 'Low Token Diversity', description: 'Wallet holds very few unique tokens despite activity', weight: 7, severity: 'warning' },
  { id: 'mint_and_dump', name: 'Mint-and-Dump Pattern', description: 'NFTs minted and immediately transferred/sold', weight: 10, severity: 'danger' },
  { id: 'shallow_defi', name: 'Shallow DeFi Touches', description: 'Minimal DeFi interactions (just enough for airdrops)', weight: 8, severity: 'warning' },
  { id: 'cluster_member', name: 'Cluster Detected', description: 'Wallet is part of a group funded from same source', weight: 15, severity: 'danger' },
  { id: 'no_organic_activity', name: 'No Organic Activity', description: 'No social, governance, or community interactions', weight: 5, severity: 'info' },
  { id: 'circular_flow', name: 'Circular Fund Flow', description: 'Funds cycle between a small set of wallets', weight: 10, severity: 'danger' },
];

// ── API helper ──

function getApiBase(): string {
  const proxy = getHeliusProxyUrl();
  if (proxy) return proxy;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

// ── Core analysis functions ──

/**
 * Analyze funding sources for a wallet.
 * Traces where the wallet's SOL originated from.
 */
export async function analyzeFundingSources(
  address: string,
  recentSignatures: { signature: string; blockTime: number | null }[],
): Promise<FundingSource[]> {
  // Try server-side analysis (has full tx history access)
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/sybil/funding-sources?address=${address}`);
    if (res.ok) {
      const data = await res.json();
      if (data.sources) return data.sources;
    }
  } catch {}

  // Fallback: basic client-side heuristic from signature data
  // In production, server does the heavy lifting
  return [];
}

/**
 * Analyze transaction timing patterns.
 * Human transactions have irregular timing; bots have regular intervals.
 */
export function analyzeTransactionTiming(
  timestamps: number[],
): { variance: number; isRobotic: boolean; avgIntervalMs: number } {
  if (timestamps.length < 10) {
    return { variance: 1, isRobotic: false, avgIntervalMs: 0 };
  }

  const sorted = [...timestamps].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i] - sorted[i - 1]);
  }

  const mean = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
  if (mean === 0) return { variance: 0, isRobotic: true, avgIntervalMs: 0 };

  // Coefficient of variation (CV) — low CV = uniform = robotic
  const stdDev = Math.sqrt(
    intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length,
  );
  const cv = stdDev / mean;

  // Normalize: CV < 0.3 is suspicious, > 1.0 is very human
  const variance = Math.min(1, cv / 1.5);
  const isRobotic = cv < 0.25 && intervals.length > 20;

  return { variance, isRobotic, avgIntervalMs: mean };
}

/**
 * Analyze transaction amount patterns.
 * Bots often use exact same amounts; humans vary.
 */
export function analyzeTransactionAmounts(
  amounts: number[],
): { variance: number; isUniform: boolean } {
  if (amounts.length < 5) {
    return { variance: 1, isUniform: false };
  }

  // Count unique amounts (rounded to 4 decimals)
  const rounded = amounts.map((a) => Math.round(a * 10000) / 10000);
  const unique = new Set(rounded);
  const uniqueRatio = unique.size / rounded.length;

  // If >80% of transactions use the same few amounts, suspicious
  const isUniform = uniqueRatio < 0.15 && amounts.length > 10;
  const variance = Math.min(1, uniqueRatio * 3);

  return { variance, isUniform };
}

/**
 * Check for circular fund flow (A → B → C → A pattern).
 */
export async function detectCircularFlow(
  address: string,
): Promise<{ detected: boolean; cycle: string[] }> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/sybil/circular-flow?address=${address}`);
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return { detected: false, cycle: [] };
}

/**
 * Detect wallet cluster — group of wallets funded from the same source.
 */
export async function detectCluster(
  address: string,
): Promise<ClusterInfo | null> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/sybil/cluster?address=${address}`);
    if (res.ok) {
      const data = await res.json();
      if (data.clusterId) return data;
    }
  } catch {}
  return null;
}

/**
 * Calculate protocol diversity score.
 * How many different Solana protocols has this wallet interacted with?
 */
export function calculateProtocolDiversity(
  programIds: string[],
): number {
  const KNOWN_PROTOCOLS = new Set([
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',   // Orca
    'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',   // Marinade
    'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ',   // Saber
    'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1',  // Orca (Whirlpool)
    '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',  // Serum DEX
    'So1endDq2YkqhipRh3WViPa8hFvz0XP1MXF1VZU8Q4Mw',  // Solend
    'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',   // Kamino
    'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',   // Drift
    'mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68',   // Marginfi
    'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY',   // Phoenix
    'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN',   // Tensor
    'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K',   // Magic Eden
    'hausS13jsjafwWwGqZTUQRmWyvyxn9EQpqMwV1PBBmk',   // ME Auction House
  ]);

  const uniqueProtocols = new Set(programIds.filter((id) => KNOWN_PROTOCOLS.has(id)));
  // Normalize: 0 protocols = 0, 8+ = 1.0
  return Math.min(1, uniqueProtocols.size / 8);
}

/**
 * Full sybil analysis combining all signals.
 * This is the main entry point.
 */
export async function runSybilAnalysis(
  address: string,
  traits: {
    walletAgeDays: number;
    txCount: number;
    uniqueTokenCount: number;
    nftCount: number;
    solBalance: number;
    avgTxPerDay30d: number;
  },
  txTimestamps?: number[],
  txAmounts?: number[],
  programIds?: string[],
): Promise<SybilAnalysis> {
  const signals: SybilSignal[] = [];

  // 1. Funding source analysis (server-side)
  const fundingSources = await analyzeFundingSources(address, []);

  // Check single-funder signal
  const topFunder = fundingSources.length > 0 ? fundingSources[0] : null;
  const singleFunderDetected = topFunder ? topFunder.percentage > 90 : false;
  signals.push({
    ...SIGNAL_DEFS.find((s) => s.id === 'single_funder')!,
    detected: singleFunderDetected,
    details: topFunder
      ? `${topFunder.label ?? topFunder.address.slice(0, 8)}... provided ${topFunder.percentage.toFixed(0)}% of funds`
      : undefined,
  });

  // 2. Fresh wallet burst
  const isFreshBurst = traits.walletAgeDays < 30 && traits.txCount > 100;
  signals.push({
    ...SIGNAL_DEFS.find((s) => s.id === 'fresh_wallet')!,
    detected: isFreshBurst,
    details: isFreshBurst
      ? `${traits.walletAgeDays} days old with ${traits.txCount} transactions`
      : undefined,
  });

  // 3. Robotic timing
  const timingAnalysis = txTimestamps
    ? analyzeTransactionTiming(txTimestamps)
    : { variance: 1, isRobotic: false, avgIntervalMs: 0 };
  signals.push({
    ...SIGNAL_DEFS.find((s) => s.id === 'robotic_timing')!,
    detected: timingAnalysis.isRobotic,
    details: timingAnalysis.isRobotic
      ? `Timing variance: ${(timingAnalysis.variance * 100).toFixed(0)}% (avg interval: ${(timingAnalysis.avgIntervalMs / 1000).toFixed(0)}s)`
      : undefined,
  });

  // 4. Uniform amounts
  const amountAnalysis = txAmounts
    ? analyzeTransactionAmounts(txAmounts)
    : { variance: 1, isUniform: false };
  signals.push({
    ...SIGNAL_DEFS.find((s) => s.id === 'uniform_amounts')!,
    detected: amountAnalysis.isUniform,
  });

  // 5. Low token diversity
  const lowDiversity = traits.txCount > 50 && traits.uniqueTokenCount < 3;
  signals.push({
    ...SIGNAL_DEFS.find((s) => s.id === 'low_token_diversity')!,
    detected: lowDiversity,
    details: lowDiversity
      ? `${traits.uniqueTokenCount} unique tokens despite ${traits.txCount} transactions`
      : undefined,
  });

  // 6. Mint-and-dump (heuristic: many NFTs transacted but few held)
  const mintDump = traits.txCount > 100 && traits.nftCount < 2;
  signals.push({
    ...SIGNAL_DEFS.find((s) => s.id === 'mint_and_dump')!,
    detected: mintDump,
  });

  // 7. Shallow DeFi
  const protocolDiv = programIds ? calculateProtocolDiversity(programIds) : 0.5;
  const shallowDefi = protocolDiv < 0.15 && traits.txCount > 50;
  signals.push({
    ...SIGNAL_DEFS.find((s) => s.id === 'shallow_defi')!,
    detected: shallowDefi,
    details: shallowDefi
      ? `Protocol diversity: ${(protocolDiv * 100).toFixed(0)}%`
      : undefined,
  });

  // 8. Cluster detection (server-side)
  const clusterInfo = await detectCluster(address);
  signals.push({
    ...SIGNAL_DEFS.find((s) => s.id === 'cluster_member')!,
    detected: Boolean(clusterInfo),
    details: clusterInfo
      ? `Part of cluster of ${clusterInfo.clusterSize} wallets from ${clusterInfo.sharedFundingLabel ?? 'same source'}`
      : undefined,
  });

  // 9. No organic activity
  const noOrganic = traits.txCount > 30 && protocolDiv < 0.1 && traits.uniqueTokenCount < 5;
  signals.push({
    ...SIGNAL_DEFS.find((s) => s.id === 'no_organic_activity')!,
    detected: noOrganic,
  });

  // 10. Circular flow (server-side)
  const circularFlow = await detectCircularFlow(address);
  signals.push({
    ...SIGNAL_DEFS.find((s) => s.id === 'circular_flow')!,
    detected: circularFlow.detected,
    details: circularFlow.detected
      ? `Cycle: ${circularFlow.cycle.map((a) => a.slice(0, 6)).join(' → ')}`
      : undefined,
  });

  // Calculate risk score
  let riskScore = 0;
  for (const signal of signals) {
    if (signal.detected) riskScore += signal.weight;
  }
  riskScore = Math.min(100, riskScore);

  // Determine risk level
  let riskLevel: SybilRiskLevel;
  if (riskScore >= 75) riskLevel = 'critical';
  else if (riskScore >= 50) riskLevel = 'high';
  else if (riskScore >= 30) riskLevel = 'medium';
  else if (riskScore >= 10) riskLevel = 'low';
  else riskLevel = 'clean';

  // Build behavior profile
  const behaviorProfile: BehaviorProfile = {
    txTimingVariance: timingAnalysis.variance,
    txAmountVariance: amountAnalysis.variance,
    protocolDiversity: protocolDiv,
    holdingDuration: 0, // TODO: calculate from token history
    organicInteractions: 0, // TODO: count governance votes, social txs
    suspiciousPatterns: signals.filter((s) => s.detected).map((s) => s.name),
  };

  const trustScore = Math.max(0, 100 - riskScore);
  const trustGrade = trustScore >= 90 ? 'A+' : trustScore >= 80 ? 'A' : trustScore >= 65 ? 'B' : trustScore >= 50 ? 'C' : trustScore >= 35 ? 'D' : 'F';

  return {
    address,
    riskScore,
    riskLevel,
    trustScore,
    trustGrade,
    signals,
    fundingSources,
    clusterInfo,
    behaviorProfile,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get a human-readable sybil risk summary.
 */
export function getSybilRiskSummary(analysis: SybilAnalysis): string {
  const { riskLevel, riskScore, signals } = analysis;
  const detected = signals.filter((s) => s.detected);

  if (riskLevel === 'clean') return 'No sybil indicators detected. Wallet appears genuine.';
  if (riskLevel === 'low') return `Minor concerns (${riskScore}/100): ${detected.map((s) => s.name).join(', ')}`;
  if (riskLevel === 'medium') return `Moderate risk (${riskScore}/100): ${detected.map((s) => s.name).join(', ')}`;
  if (riskLevel === 'high') return `High sybil risk (${riskScore}/100): ${detected.map((s) => s.name).join(', ')}`;
  return `Critical sybil risk (${riskScore}/100): ${detected.map((s) => s.name).join(', ')}`;
}

/**
 * Get color for risk level (for UI rendering).
 */
export function getSybilRiskColor(level: SybilRiskLevel): string {
  switch (level) {
    case 'clean': return '#22c55e';   // green
    case 'low': return '#84cc16';     // lime
    case 'medium': return '#f59e0b';  // amber
    case 'high': return '#ef4444';    // red
    case 'critical': return '#dc2626'; // dark red
  }
}

export { KNOWN_ADDRESSES };
