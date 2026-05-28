/**
 * sybilFriendly — plain-language mapping for sybil-scan results.
 * Shared between the web SybilCheckerPage and the APK PrismScanner so the
 * same 6 user-friendly signal headers and verdict text show in both.
 */

export type VerdictTone = 'good' | 'mixed' | 'warn' | 'bad';

export interface FriendlyVerdict {
  title: string;
  sub: string;
  longHelp: string;
  tone: VerdictTone;
}

export function friendlyVerdict(score: number): FriendlyVerdict {
  if (score >= 80) return {
    title: 'Looks like a real person',
    sub: 'No bot-like patterns detected. This wallet behaves like a regular user.',
    longHelp: 'A Sybil check looks at how a wallet behaves to decide whether it’s likely a real person or a bot/farm. Protocols use this when handing out airdrops, voting power, or rewards — so they can give those to humans, not scripts. A higher score means more human-like.',
    tone: 'good',
  };
  if (score >= 60) return {
    title: 'Mostly normal',
    sub: 'Looks mostly real with a few unusual patterns worth a glance.',
    longHelp: 'A Sybil check rates how human-like a wallet behaves. This one mostly passes — a few patterns are slightly off but no strong red flags. Use with normal caution.',
    tone: 'mixed',
  };
  if (score >= 40) return {
    title: 'Some questionable patterns',
    sub: 'Several signals look bot-like. Verify before trusting for rewards or governance.',
    longHelp: 'A Sybil check rates how human-like a wallet behaves. Multiple signals on this wallet don’t match typical human usage — could still be a real user, but worth verification.',
    tone: 'warn',
  };
  if (score >= 20) return {
    title: 'Likely automated',
    sub: 'Strong indicators of bot or sybil behavior across multiple signals.',
    longHelp: 'A Sybil check rates how human-like a wallet behaves. This wallet shows several patterns common to scripts, farms, or sybil clusters. Treat with high suspicion.',
    tone: 'bad',
  };
  return {
    title: 'Almost certainly a bot or sybil',
    sub: 'Almost every behavioral signal points to automation or coordinated farming.',
    longHelp: 'A Sybil check rates how human-like a wallet behaves. This one fails most checks — strong indicators of automated or sybil activity. Reject for human-only allocations.',
    tone: 'bad',
  };
}

export interface FriendlyMetrics {
  walletAgeDays?: number;
  uniquePrograms?: number;
  activeDaysRatio?: number;
  primaryFundingSourceLabel?: string;
  siblingCount?: number;
  clusterSimilarity?: number;
  balance?: number;
  txCount?: number;
}

export interface FriendlySignal {
  label: string;     // e.g. "Wallet age"
  headline: string;  // e.g. "Active for over a year"
  valueText: string; // e.g. "412 days"
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function describeAge(days: number): { headline: string; valueText: string } {
  if (days >= 1095) return { headline: 'Active for over 3 years', valueText: `${fmt(days)} days` };
  if (days >= 365) return { headline: 'Active for over a year', valueText: `${fmt(days)} days` };
  if (days >= 90) return { headline: `Active for ${Math.round(days / 30)} months`, valueText: `${fmt(days)} days` };
  if (days >= 30) return { headline: 'Active for a few weeks', valueText: `${fmt(days)} days` };
  return { headline: 'Brand new wallet', valueText: `${fmt(days)} days` };
}

export function describeVariety(uniquePrograms: number): { headline: string; valueText: string } {
  if (uniquePrograms >= 20) return { headline: 'Uses many different apps', valueText: `${uniquePrograms} protocols` };
  if (uniquePrograms >= 8) return { headline: 'Uses a healthy app variety', valueText: `${uniquePrograms} protocols` };
  if (uniquePrograms >= 3) return { headline: 'Limited app variety', valueText: `${uniquePrograms} protocols` };
  return { headline: 'Barely uses anything', valueText: `${uniquePrograms} protocols` };
}

export function describeTiming(activeRatio: number): { headline: string; valueText: string } {
  const pct = Math.round(activeRatio * 100);
  if (pct >= 60) return { headline: 'Always-on (suspicious)', valueText: `${pct}% active days` };
  if (pct >= 12) return { headline: 'Irregular, human-like timing', valueText: 'Natural' };
  if (pct >= 4) return { headline: 'Sporadic activity', valueText: `${pct}% active days` };
  return { headline: 'Dormant most days', valueText: `${pct}% active days` };
}

export function describeFunding(primary: string): { headline: string; valueText: string } {
  if (!primary || primary === 'unknown') return { headline: 'Funding source unclear', valueText: 'Unknown' };
  if (/binance|coinbase|kraken|bybit|okx|kucoin|gate|huobi|cex/i.test(primary))
    return { headline: 'Funded from a major exchange', valueText: 'CEX origin' };
  if (/airdrop|claim/i.test(primary))
    return { headline: 'Funded from an airdrop', valueText: 'Airdrop' };
  if (/bot|farm|sybil/i.test(primary))
    return { headline: 'Funded from a known bot cluster', valueText: 'Cluster origin' };
  return { headline: `Funded from ${primary}`, valueText: 'On-chain origin' };
}

export function describeLinks(siblings: number, similarity: number): { headline: string; valueText: string } {
  if (siblings === 0) return { headline: 'No suspicious clusters', valueText: '0 matches' };
  if (siblings < 3 && similarity < 40) return { headline: 'A few weak overlaps', valueText: `${siblings} matches` };
  if (siblings >= 5 || similarity >= 70) return { headline: 'Strong cluster ties', valueText: `${siblings} matches` };
  return { headline: 'Some cluster overlap', valueText: `${siblings} matches` };
}

export function describeValue(balanceSol: number, txCount: number): { headline: string; valueText: string } {
  if (balanceSol > 5 && txCount > 50) return { headline: 'Real balances held over time', valueText: `~${balanceSol.toFixed(2)} SOL` };
  if (balanceSol > 0.5) return { headline: 'Modest balances held', valueText: `~${balanceSol.toFixed(2)} SOL` };
  if (balanceSol > 0.05) return { headline: 'Mostly empty wallet', valueText: `~${balanceSol.toFixed(2)} SOL` };
  return { headline: 'Wallet is empty', valueText: `~${balanceSol.toFixed(2)} SOL` };
}

/** Returns the 6 friendly signals in the canonical order used by both surfaces. */
export function buildFriendlySignals(m: FriendlyMetrics): FriendlySignal[] {
  return [
    { label: 'Wallet age',         ...describeAge(m.walletAgeDays || 0) },
    { label: 'Activity variety',   ...describeVariety(m.uniquePrograms || 0) },
    { label: 'Transaction timing', ...describeTiming(m.activeDaysRatio || 0) },
    { label: 'Funding source',     ...describeFunding(m.primaryFundingSourceLabel || '') },
    { label: 'Linked wallets',     ...describeLinks(m.siblingCount || 0, m.clusterSimilarity || 0) },
    { label: 'On-chain value',     ...describeValue(m.balance || 0, m.txCount || 0) },
  ];
}

export function nextStepsForTone(tone: VerdictTone): string[] {
  if (tone === 'good') return [
    "You're in good shape — most protocols will recognize this wallet as a real user.",
    'Keep using a variety of apps to maintain a strong signal.',
  ];
  if (tone === 'mixed') return [
    'A few unusual patterns — keep using the wallet naturally over time to strengthen the signal.',
    'Consider diversifying activity across more apps and protocols.',
  ];
  if (tone === 'warn') return [
    'Investigate the flagged patterns before trusting this wallet for human-only allocations.',
    'Open the advanced view to see which specific checks failed.',
  ];
  return [
    'Treat as suspicious for airdrops, voting, and rewards.',
    'Open the advanced view to inspect all 23 sybil signals and the cluster graph.',
  ];
}
