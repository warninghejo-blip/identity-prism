import type { WalletTraits } from "@/hooks/useWalletData";

export type LeagueDifficulty = "rookie" | "pro" | "mythic";

export interface LeagueDifficultyConfig {
  label: string;
  rounds: number;
  startingCapital: number;
  leverage: number;
  volatilityMultiplier: number;
  scoreBonus: number;
}

export const LEAGUE_DIFFICULTIES: Record<LeagueDifficulty, LeagueDifficultyConfig> = {
  rookie: {
    label: "Rookie Orbit",
    rounds: 8,
    startingCapital: 1800,
    leverage: 0.9,
    volatilityMultiplier: 0.75,
    scoreBonus: 40,
  },
  pro: {
    label: "Pro Belt",
    rounds: 10,
    startingCapital: 1500,
    leverage: 1,
    volatilityMultiplier: 1,
    scoreBonus: 90,
  },
  mythic: {
    label: "Mythic Singularity",
    rounds: 12,
    startingCapital: 1300,
    leverage: 1.15,
    volatilityMultiplier: 1.2,
    scoreBonus: 160,
  },
};

export interface LeagueEvent {
  id: string;
  eventKey: string;
  name: string;
  narrative: string;
  trend: number;
  volatility: number;
  shockChance: number;
  shockImpact: number;
  liquidity: number;
}

interface LeagueEventTemplate {
  id: string;
  name: string;
  narrative: string;
  trend: number;
  volatility: number;
  shockChance: number;
  shockImpact: number;
  liquidity: number;
}

export interface StrategyCard {
  id: string;
  name: string;
  summary: string;
  edge: number;
  risk: number;
  protection: number;
  momentum: number;
  unlockScore: number;
}

export interface TraitBoosts {
  alpha: number;
  shield: number;
  liquidity: number;
  execution: number;
}

export interface ResolveLeagueRoundInput {
  seed: string;
  difficulty: LeagueDifficulty;
  round: number;
  capital: number;
  peakCapital: number;
  stakePercent: number;
  strategy: StrategyCard;
  event: LeagueEvent;
  traits: WalletTraits | null;
  score: number;
}

export interface LeagueRoundResult {
  round: number;
  eventKey: string;
  eventName: string;
  strategyId: string;
  strategyName: string;
  stakePercent: number;
  stakeAmount: number;
  returnRate: number;
  pnl: number;
  capitalAfter: number;
  peakCapitalAfter: number;
  drawdown: number;
  shockTriggered: boolean;
  verdict: "loss" | "flat" | "win" | "jackpot";
}

export interface EvaluateLeagueStandingInput {
  initialCapital: number;
  finalCapital: number;
  history: LeagueRoundResult[];
  difficulty: LeagueDifficulty;
  traits: WalletTraits | null;
  score: number;
}

export interface LeagueStanding {
  leaguePoints: number;
  rank: "Initiate" | "Challenger" | "Pro" | "Elite" | "Apex";
  roi: number;
  winRate: number;
  maxDrawdown: number;
  consistency: number;
}

const EVENT_POOL: readonly LeagueEventTemplate[] = [
  {
    id: "validator-upgrade",
    name: "Validator Upgrade Window",
    narrative: "Network throughput is climbing, but execution queues are still fragile.",
    trend: 0.18,
    volatility: 0.22,
    shockChance: 0.18,
    shockImpact: 0.22,
    liquidity: 0.54,
  },
  {
    id: "meme-surge",
    name: "Meme Rotation Frenzy",
    narrative: "Speculative capital floods into volatile pairs across Solana.",
    trend: 0.28,
    volatility: 0.42,
    shockChance: 0.4,
    shockImpact: 0.34,
    liquidity: 0.37,
  },
  {
    id: "macro-fear",
    name: "Macro Fear Candle",
    narrative: "Risk assets retrace after global macro uncertainty spikes.",
    trend: -0.32,
    volatility: 0.36,
    shockChance: 0.48,
    shockImpact: 0.4,
    liquidity: 0.3,
  },
  {
    id: "defi-refuel",
    name: "DeFi TVL Refuel",
    narrative: "Liquidity rotates back into lending and perp markets.",
    trend: 0.24,
    volatility: 0.27,
    shockChance: 0.2,
    shockImpact: 0.24,
    liquidity: 0.74,
  },
  {
    id: "whale-unwind",
    name: "Whale Unwind",
    narrative: "Large wallets distribute inventory into thin books.",
    trend: -0.24,
    volatility: 0.33,
    shockChance: 0.35,
    shockImpact: 0.3,
    liquidity: 0.42,
  },
  {
    id: "ecosystem-grants",
    name: "Ecosystem Grant Momentum",
    narrative: "Builders announce launches and social sentiment turns constructive.",
    trend: 0.2,
    volatility: 0.2,
    shockChance: 0.16,
    shockImpact: 0.2,
    liquidity: 0.62,
  },
  {
    id: "liquidation-wave",
    name: "Perp Liquidation Wave",
    narrative: "Funding flips, stop-hunts trigger, and cascades emerge.",
    trend: -0.18,
    volatility: 0.44,
    shockChance: 0.55,
    shockImpact: 0.48,
    liquidity: 0.26,
  },
  {
    id: "quiet-accumulation",
    name: "Quiet Accumulation",
    narrative: "Low-volume sessions favor patient positioning over leverage.",
    trend: 0.12,
    volatility: 0.12,
    shockChance: 0.1,
    shockImpact: 0.15,
    liquidity: 0.67,
  },
];

export const STRATEGY_CARDS: readonly StrategyCard[] = [
  {
    id: "delta-shield",
    name: "Delta Shield",
    summary: "Capital preservation with controlled upside.",
    edge: 0.46,
    risk: 0.36,
    protection: 0.64,
    momentum: 0.24,
    unlockScore: 0,
  },
  {
    id: "orion-carry",
    name: "Orion Carry",
    summary: "Balanced carry strategy for steady compounding.",
    edge: 0.58,
    risk: 0.55,
    protection: 0.42,
    momentum: 0.38,
    unlockScore: 120,
  },
  {
    id: "gamma-arb",
    name: "Gamma Arb",
    summary: "Event-driven micro-arbitrage around volatility pivots.",
    edge: 0.68,
    risk: 0.67,
    protection: 0.34,
    momentum: 0.54,
    unlockScore: 420,
  },
  {
    id: "singularity-long",
    name: "Singularity Long",
    summary: "Conviction-heavy leverage with asymmetric upside.",
    edge: 0.82,
    risk: 0.84,
    protection: 0.18,
    momentum: 0.7,
    unlockScore: 760,
  },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hashSeed = (seed: string) => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createRng = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

const standardDeviation = (values: number[]) => {
  if (values.length <= 1) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

export const buildSeasonId = (walletAddress: string, now = new Date()) => {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${walletAddress.slice(0, 6)}-${walletAddress.slice(-4)}-${year}${month}${day}`;
};

export const rollLeagueEvents = (seed: string, rounds: number) => {
  const rng = createRng(hashSeed(seed));
  const events: LeagueEvent[] = [];

  for (let index = 0; index < rounds; index += 1) {
    const template = EVENT_POOL[Math.floor(rng() * EVENT_POOL.length)] ?? EVENT_POOL[0];
    const trendDrift = (rng() - 0.5) * 0.24;
    const volatilityDrift = (rng() - 0.5) * 0.2;
    const shockDrift = (rng() - 0.5) * 0.14;

    events.push({
      ...template,
      trend: clamp(template.trend + trendDrift, -0.8, 0.8),
      volatility: clamp(template.volatility + volatilityDrift, 0.1, 0.9),
      shockChance: clamp(template.shockChance + shockDrift, 0.06, 0.72),
      eventKey: `${template.id}-${index + 1}-${Math.floor(rng() * 1_000_000).toString(36)}`,
    });
  }

  return events;
};

export const deriveTraitBoosts = (traits: WalletTraits | null, score: number): TraitBoosts => {
  const scoreFactor = clamp(score / 1200, 0, 1);
  const baseBoosts: TraitBoosts = {
    alpha: 0.05 + scoreFactor * 0.06,
    shield: 0.06 + scoreFactor * 0.03,
    liquidity: 0.08 + scoreFactor * 0.04,
    execution: 0.09 + scoreFactor * 0.05,
  };

  if (!traits) {
    return baseBoosts;
  }

  return {
    alpha:
      baseBoosts.alpha +
      (traits.isDeFiKing ? 0.09 : 0) +
      (traits.isBlueChip ? 0.06 : 0) +
      (traits.isSolanaMaxi ? 0.04 : 0),
    shield:
      baseBoosts.shield +
      (traits.diamondHands ? 0.12 : 0) +
      (traits.hasPreorder ? 0.06 : 0) +
      (traits.isCollector ? 0.03 : 0),
    liquidity:
      baseBoosts.liquidity +
      clamp(Math.log10(Math.max(traits.solBalance, 0.01) + 1) * 0.07, 0, 0.18) +
      (traits.isWhale ? 0.07 : 0),
    execution:
      baseBoosts.execution +
      (traits.isTxTitan ? 0.1 : 0) +
      (traits.hyperactiveDegen ? 0.07 : 0) +
      (traits.hasCombo ? 0.05 : 0),
  };
};

export const resolveLeagueRound = ({
  seed,
  difficulty,
  round,
  capital,
  peakCapital,
  stakePercent,
  strategy,
  event,
  traits,
  score,
}: ResolveLeagueRoundInput): LeagueRoundResult => {
  const difficultyConfig = LEAGUE_DIFFICULTIES[difficulty];
  const boosts = deriveTraitBoosts(traits, score);
  const safeStakePercent = clamp(stakePercent, 10, 90);
  const stakeAmount = capital * (safeStakePercent / 100);

  const rng = createRng(hashSeed(`${seed}|${event.eventKey}|${strategy.id}|${round}|${safeStakePercent}`));

  const directionalSignal = event.trend * (0.72 + strategy.edge + boosts.alpha);
  const randomSwing =
    (rng() - 0.5) *
    2 *
    event.volatility *
    (0.45 + strategy.risk * difficultyConfig.volatilityMultiplier);
  const executionPulse = (rng() - 0.38) * strategy.momentum * (0.35 + boosts.execution);
  const liquidityTailwind = event.liquidity * boosts.liquidity * 0.08;

  const shockTriggered = rng() < event.shockChance;
  const defense = clamp(strategy.protection + boosts.shield, 0, 0.9);
  const shockPenalty = shockTriggered
    ? event.shockImpact * (1 - defense) * (0.55 + rng() * 0.55)
    : 0;

  let returnRate = directionalSignal + randomSwing + executionPulse + liquidityTailwind - shockPenalty;
  returnRate *= difficultyConfig.leverage;
  returnRate = clamp(returnRate, -0.92, 1.55);

  const pnl = stakeAmount * returnRate;
  const capitalAfter = Math.max(0, capital + pnl);
  const peakCapitalAfter = Math.max(peakCapital, capitalAfter);
  const drawdown = peakCapitalAfter > 0 ? (peakCapitalAfter - capitalAfter) / peakCapitalAfter : 0;

  const verdict: LeagueRoundResult["verdict"] =
    returnRate >= 0.28 ? "jackpot" : returnRate >= 0.02 ? "win" : returnRate <= -0.02 ? "loss" : "flat";

  return {
    round,
    eventKey: event.eventKey,
    eventName: event.name,
    strategyId: strategy.id,
    strategyName: strategy.name,
    stakePercent: safeStakePercent,
    stakeAmount,
    returnRate,
    pnl,
    capitalAfter,
    peakCapitalAfter,
    drawdown,
    shockTriggered,
    verdict,
  };
};

export const evaluateLeagueStanding = ({
  initialCapital,
  finalCapital,
  history,
  difficulty,
  traits,
  score,
}: EvaluateLeagueStandingInput): LeagueStanding => {
  const rounds = Math.max(history.length, 1);
  const wins = history.filter((round) => round.pnl > 0).length;
  const winRate = wins / rounds;
  const roi = initialCapital > 0 ? (finalCapital - initialCapital) / initialCapital : 0;
  const maxDrawdown = history.reduce((maxValue, round) => Math.max(maxValue, round.drawdown), 0);
  const returns = history.map((round) => round.returnRate);
  const volatility = standardDeviation(returns);
  const consistency = clamp(1 - volatility * 1.8, 0, 1);
  const boosts = deriveTraitBoosts(traits, score);

  const basePoints =
    roi * 620 +
    winRate * 240 +
    clamp(1 - maxDrawdown, 0, 1) * 200 +
    consistency * 130 +
    LEAGUE_DIFFICULTIES[difficulty].scoreBonus;

  const traitPoints = (boosts.alpha + boosts.execution + boosts.shield) * 120;
  const survivalBonus = finalCapital > initialCapital ? 70 : finalCapital > initialCapital * 0.7 ? 25 : 0;
  const leaguePoints = Math.max(0, Math.round(basePoints + traitPoints + survivalBonus));

  const rank: LeagueStanding["rank"] =
    leaguePoints >= 920
      ? "Apex"
      : leaguePoints >= 720
        ? "Elite"
        : leaguePoints >= 520
          ? "Pro"
          : leaguePoints >= 320
            ? "Challenger"
            : "Initiate";

  return {
    leaguePoints,
    rank,
    roi,
    winRate,
    maxDrawdown,
    consistency,
  };
};

export const getUnlockedStrategies = (score: number) =>
  STRATEGY_CARDS.filter((strategy) => score >= strategy.unlockScore);
