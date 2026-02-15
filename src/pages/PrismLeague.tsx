import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { getHeliusRpcUrl } from "@/constants";
import { useWalletData } from "@/hooks/useWalletData";
import {
  LEAGUE_DIFFICULTIES,
  STRATEGY_CARDS,
  buildSeasonId,
  evaluateLeagueStanding,
  getUnlockedStrategies,
  resolveLeagueRound,
  rollLeagueEvents,
  type LeagueDifficulty,
  type LeagueRoundResult,
  type LeagueStanding,
} from "@/lib/prismLeagueEngine";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  Loader2,
  Shield,
  Share2,
  Sparkles,
  Trophy,
  Wallet,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./PrismLeague.css";

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const LEADERBOARD_STORAGE_KEY = "identity_prism_league_board_v1";

interface LeagueSeasonState {
  id: string;
  difficulty: LeagueDifficulty;
  initialCapital: number;
  capital: number;
  peakCapital: number;
  roundIndex: number;
  events: ReturnType<typeof rollLeagueEvents>;
  history: LeagueRoundResult[];
  standing: LeagueStanding | null;
  committedTx: string | null;
  createdAt: string;
}

interface LeaderboardEntry {
  seasonId: string;
  address: string;
  difficulty: LeagueDifficulty;
  rank: LeagueStanding["rank"];
  leaguePoints: number;
  roi: number;
  finalCapital: number;
  playedAt: string;
  txSignature?: string;
}

const formatAddress = (address?: string) => {
  if (!address) return "Not connected";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

const formatCredits = (value: number) => `${Math.round(value).toLocaleString("en-US")} CR`;
const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const readLeaderboard = (): LeaderboardEntry[] => {
  try {
    const raw = window.localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as LeaderboardEntry[];
  } catch {
    return [];
  }
};

const writeLeaderboard = (entries: LeaderboardEntry[]) => {
  try {
    window.localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage write failures.
  }
};

const upsertLeaderboard = (
  previous: LeaderboardEntry[],
  entry: LeaderboardEntry,
  keep = 12,
) => {
  const merged = [entry, ...previous.filter((item) => item.seasonId !== entry.seasonId)]
    .sort((a, b) => b.leaguePoints - a.leaguePoints || b.roi - a.roi)
    .slice(0, keep);
  writeLeaderboard(merged);
  return merged;
};

const buildTraitTags = (traits: ReturnType<typeof useWalletData>["traits"]) => {
  if (!traits) return [];
  const tags: string[] = [];
  if (traits.isDeFiKing) tags.push("DeFi King");
  if (traits.diamondHands) tags.push("Diamond Hands");
  if (traits.isWhale) tags.push("Liquidity Whale");
  if (traits.isTxTitan) tags.push("Tx Titan");
  if (traits.isBlueChip) tags.push("Blue Chip");
  if (traits.hasCombo) tags.push("Binary Signal");
  if (tags.length === 0) tags.push("Rising Trader");
  return tags.slice(0, 5);
};

const PrismLeague = () => {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const address = publicKey?.toBase58();
  const walletData = useWalletData(address);
  const { traits, score, isLoading } = walletData;

  const [difficulty, setDifficulty] = useState<LeagueDifficulty>("pro");
  const [selectedStrategyId, setSelectedStrategyId] = useState(STRATEGY_CARDS[0].id);
  const [stakePercent, setStakePercent] = useState(36);
  const [season, setSeason] = useState<LeagueSeasonState | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => readLeaderboard());
  const [commitPending, setCommitPending] = useState(false);

  const isMobile = /android|iphone|ipad|ipod/i.test(globalThis.navigator?.userAgent ?? "");

  const unlockedStrategies = useMemo(() => {
    const unlocked = getUnlockedStrategies(score);
    return unlocked.length ? unlocked : [STRATEGY_CARDS[0]];
  }, [score]);

  useEffect(() => {
    if (!unlockedStrategies.some((strategy) => strategy.id === selectedStrategyId)) {
      setSelectedStrategyId(unlockedStrategies[0].id);
    }
  }, [selectedStrategyId, unlockedStrategies]);

  const selectedStrategy =
    unlockedStrategies.find((strategy) => strategy.id === selectedStrategyId) ?? unlockedStrategies[0];

  const seasonLocked = Boolean(season && !season.standing);
  const currentEvent = seasonLocked && season ? season.events[season.roundIndex] : null;

  const seasonProgress = season
    ? Math.round((season.roundIndex / Math.max(season.events.length, 1)) * 100)
    : 0;

  const traitTags = useMemo(() => buildTraitTags(traits), [traits]);

  const equitySeries = useMemo(() => {
    if (!season) return [];
    const points = [{ round: 0, capital: season.initialCapital }];
    season.history.forEach((entry, index) => {
      points.push({ round: index + 1, capital: Math.round(entry.capitalAfter) });
    });
    return points;
  }, [season]);

  const recentRounds = useMemo(() => {
    if (!season) return [];
    return [...season.history].reverse().slice(0, 7);
  }, [season]);

  const persistSeasonResult = useCallback(
    (finishedSeason: LeagueSeasonState) => {
      if (!address || !finishedSeason.standing) return;
      const entry: LeaderboardEntry = {
        seasonId: finishedSeason.id,
        address,
        difficulty: finishedSeason.difficulty,
        rank: finishedSeason.standing.rank,
        leaguePoints: finishedSeason.standing.leaguePoints,
        roi: finishedSeason.standing.roi,
        finalCapital: finishedSeason.capital,
        playedAt: finishedSeason.createdAt,
      };
      setLeaderboard((prev) => upsertLeaderboard(prev, entry));
    },
    [address],
  );

  const startSeason = useCallback(() => {
    if (!connected || !address) {
      setWalletModalVisible(true);
      toast.info("Connect wallet to launch Prism League.");
      return;
    }

    if (isLoading || !traits) {
      toast.info("Wallet telemetry still syncing. Try again in a moment.");
      return;
    }

    const difficultyConfig = LEAGUE_DIFFICULTIES[difficulty];
    const seasonCore = buildSeasonId(address);
    const seasonId = `${seasonCore}-${difficulty}-${Date.now().toString(36)}`;
    const events = rollLeagueEvents(seasonId, difficultyConfig.rounds);
    const walletBoost = Math.min(score * 0.32, 480);
    const initialCapital = Math.round(difficultyConfig.startingCapital + walletBoost);

    setSeason({
      id: seasonId,
      difficulty,
      initialCapital,
      capital: initialCapital,
      peakCapital: initialCapital,
      roundIndex: 0,
      events,
      history: [],
      standing: null,
      committedTx: null,
      createdAt: new Date().toISOString(),
    });

    setStakePercent(36);
    toast.success(`${difficultyConfig.label} initialized. Pilot ready.`);
  }, [connected, address, isLoading, traits, difficulty, score, setWalletModalVisible]);

  const playRound = useCallback(() => {
    if (!season || season.standing || !currentEvent || !selectedStrategy) return;

    const outcome = resolveLeagueRound({
      seed: season.id,
      difficulty: season.difficulty,
      round: season.roundIndex + 1,
      capital: season.capital,
      peakCapital: season.peakCapital,
      stakePercent,
      strategy: selectedStrategy,
      event: currentEvent,
      traits,
      score,
    });

    const history = [...season.history, outcome];
    const nextRoundIndex = season.roundIndex + 1;
    const isFinished =
      nextRoundIndex >= season.events.length || outcome.capitalAfter <= Math.max(200, season.initialCapital * 0.22);

    const standing = isFinished
      ? evaluateLeagueStanding({
          initialCapital: season.initialCapital,
          finalCapital: outcome.capitalAfter,
          history,
          difficulty: season.difficulty,
          traits,
          score,
        })
      : null;

    const nextSeason: LeagueSeasonState = {
      ...season,
      history,
      roundIndex: nextRoundIndex,
      capital: outcome.capitalAfter,
      peakCapital: outcome.peakCapitalAfter,
      standing,
    };

    setSeason(nextSeason);

    if (isFinished && standing) {
      persistSeasonResult(nextSeason);
      toast.success(`Season completed: ${standing.rank} (${standing.leaguePoints} pts)`);
      return;
    }

    if (outcome.verdict === "jackpot") {
      toast.success(`Jackpot round: +${formatCredits(outcome.pnl)}`);
    } else if (outcome.verdict === "loss") {
      toast.error(`Drawdown hit: ${formatCredits(outcome.pnl)}`);
    } else {
      toast.message(`Round ${outcome.round} closed: ${formatCredits(outcome.pnl)}`);
    }
  }, [season, currentEvent, selectedStrategy, stakePercent, traits, score, persistSeasonResult]);

  const resetSeason = useCallback(() => {
    setSeason(null);
  }, []);

  const updateLeaderboardTx = useCallback((seasonId: string, signature: string) => {
    setLeaderboard((prev) => {
      const next = prev.map((entry) =>
        entry.seasonId === seasonId
          ? {
              ...entry,
              txSignature: signature,
            }
          : entry,
      );
      writeLeaderboard(next);
      return next;
    });
  }, []);

  const commitSeasonOnChain = useCallback(async () => {
    if (!season?.standing || !publicKey || !connected) {
      toast.error("Finish a season with a connected wallet first.");
      return;
    }

    if (season.committedTx) {
      toast.info("This season is already committed on-chain.");
      return;
    }

    if (!sendTransaction) {
      toast.error("Wallet cannot sign transactions right now.");
      return;
    }

    setCommitPending(true);

    try {
      const rpcUrl = getHeliusRpcUrl(publicKey.toBase58()) ?? "https://api.mainnet-beta.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");
      const payload = JSON.stringify({
        protocol: "identity-prism-league",
        version: 1,
        seasonId: season.id,
        wallet: publicKey.toBase58(),
        difficulty: season.difficulty,
        leaguePoints: season.standing.leaguePoints,
        roi: Number((season.standing.roi * 100).toFixed(2)),
        rank: season.standing.rank,
        ts: new Date().toISOString(),
      });

      const memoInstruction = new TransactionInstruction({
        keys: [],
        programId: new PublicKey(MEMO_PROGRAM_ID),
        data: new TextEncoder().encode(payload),
      });

      const transaction = new Transaction().add(memoInstruction);
      const signature = await sendTransaction(transaction, connection, {
        skipPreflight: false,
        maxRetries: 3,
      });

      await connection.confirmTransaction(signature, "confirmed");

      setSeason((prev) => (prev ? { ...prev, committedTx: signature } : prev));
      updateLeaderboardTx(season.id, signature);

      toast.success("Season committed on-chain", {
        description: `${signature.slice(0, 8)}...${signature.slice(-6)}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("On-chain commit failed", { description: message });
    } finally {
      setCommitPending(false);
    }
  }, [season, publicKey, connected, sendTransaction, updateLeaderboardTx]);

  const shareSeason = useCallback(() => {
    if (!season?.standing || !address) {
      toast.error("Complete a season first.");
      return;
    }

    const shareText = [
      "Prism League - Identity Prism",
      `Rank: ${season.standing.rank}`,
      `League points: ${season.standing.leaguePoints}`,
      `ROI: ${(season.standing.roi * 100).toFixed(1)}%`,
      `Final capital: ${formatCredits(season.capital)}`,
      "Built on Solana.",
      "https://identityprism.xyz/game",
    ].join("\n");

    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

    if (isMobile) {
      window.location.href = intentUrl;
      return;
    }

    const popup = window.open(intentUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      toast.error("Popup blocked. Allow popups to share your run.");
    }
  }, [season, address, isMobile]);

  const roundHint = currentEvent
    ? `${currentEvent.name} - trend ${(currentEvent.trend * 100).toFixed(0)} bps`
    : "Start a season to receive your first market pulse.";

  return (
    <div className="prism-league-page">
      <div className="league-aurora league-aurora--a" aria-hidden="true" />
      <div className="league-aurora league-aurora--b" aria-hidden="true" />

      <div className="league-shell">
        <header className="league-topbar">
          <Link to="/app" className="league-back-link">
            <ArrowLeft className="h-4 w-4" /> Back to Prism
          </Link>

          <div className="league-brand">
            <span className="league-brand-eyebrow">Season Arena</span>
            <h1 className="league-brand-title">Prism League</h1>
          </div>

          <div className="league-wallet-actions">
            {connected && address && (
              <div className="league-wallet-chip">
                <span>Pilot Wallet</span>
                <strong>{formatAddress(address)}</strong>
              </div>
            )}
            <Button
              className="bg-cyan-400 text-black hover:bg-cyan-300"
              onClick={() => setWalletModalVisible(true)}
            >
              <Wallet className="h-4 w-4" />
              {connected ? "Switch Wallet" : "Connect Wallet"}
            </Button>
          </div>
        </header>

        <div className="league-grid">
          <section className="league-panel">
            <div className="league-panel-header">
              <h2 className="league-panel-title">
                <Sparkles className="h-4 w-4" /> Command Deck
              </h2>
              <p className="league-muted">{roundHint}</p>
            </div>

            <div className="league-divider" />

            <div className="league-difficulty-grid">
              {(Object.keys(LEAGUE_DIFFICULTIES) as LeagueDifficulty[]).map((difficultyKey) => {
                const config = LEAGUE_DIFFICULTIES[difficultyKey];
                return (
                  <button
                    key={difficultyKey}
                    type="button"
                    className={`league-difficulty-btn ${difficultyKey === difficulty ? "is-active" : ""}`}
                    onClick={() => setDifficulty(difficultyKey)}
                    disabled={seasonLocked}
                  >
                    <strong>{config.label}</strong>
                    <div className="league-difficulty-meta">
                      {config.rounds} rounds | x{config.leverage.toFixed(2)} leverage
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="league-divider" />

            <div className="league-signal-grid">
              <div className="league-signal">
                <span className="league-signal-label">Prism score</span>
                <span className="league-signal-value">{score}</span>
              </div>
              <div className="league-signal">
                <span className="league-signal-label">Planet tier</span>
                <span className="league-signal-value">{traits?.planetTier ?? "pending"}</span>
              </div>
              <div className="league-signal">
                <span className="league-signal-label">Capital</span>
                <span className="league-signal-value">
                  {season ? formatCredits(season.capital) : formatCredits(LEAGUE_DIFFICULTIES[difficulty].startingCapital)}
                </span>
              </div>
              <div className="league-signal">
                <span className="league-signal-label">Status</span>
                <span className="league-signal-value">
                  {isLoading ? "Scanning" : season?.standing ? "Season done" : season ? "Live" : "Ready"}
                </span>
              </div>
            </div>

            <div className="league-tag-row">
              {traitTags.map((tag) => (
                <span className="league-tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>

            <div className="league-divider" />

            <div className="league-event-card">
              <div className="league-event-head">
                <div>
                  <p className="league-event-title">{currentEvent?.name ?? "Awaiting season start"}</p>
                  <p className="league-muted">{currentEvent?.narrative ?? "Select difficulty and ignite your season."}</p>
                </div>
                <span className="league-event-pill">
                  Round {season ? Math.min(season.roundIndex + 1, season.events.length) : 1}
                </span>
              </div>
            </div>

            <div className="league-strategy-grid">
              {STRATEGY_CARDS.map((strategy) => {
                const unlocked = strategy.unlockScore <= score;
                const active = selectedStrategyId === strategy.id;
                return (
                  <button
                    key={strategy.id}
                    type="button"
                    className={`league-strategy-card ${active ? "is-active" : ""} ${unlocked ? "" : "is-locked"}`}
                    onClick={() => {
                      if (unlocked) setSelectedStrategyId(strategy.id);
                    }}
                  >
                    <p className="league-strategy-name">{strategy.name}</p>
                    <p className="league-strategy-summary">
                      {unlocked ? strategy.summary : `Unlock at score ${strategy.unlockScore}`}
                    </p>
                    <div className="league-strategy-stats">
                      <span>Edge {(strategy.edge * 100).toFixed(0)}</span>
                      <span>Risk {(strategy.risk * 100).toFixed(0)}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="league-stake-row">
              <div className="league-stake-label">
                <span>Risk allocation</span>
                <span className="league-stake-value">{stakePercent}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={90}
                value={stakePercent}
                onChange={(event) => setStakePercent(Number(event.target.value))}
                className="league-stake-slider"
                disabled={!seasonLocked}
              />
              <div className="league-progress-bar" aria-hidden="true">
                <div className="league-progress-fill" style={{ width: `${seasonProgress}%` }} />
              </div>
            </div>

            <div className="league-action-row">
              <Button
                className="bg-amber-400 text-black hover:bg-amber-300"
                onClick={startSeason}
                disabled={isLoading || Boolean(season && !season.standing)}
              >
                <Zap className="h-4 w-4" />
                {season ? "Start new season" : "Launch season"}
              </Button>
              <Button
                className="bg-cyan-500 text-black hover:bg-cyan-400"
                onClick={playRound}
                disabled={!seasonLocked || !selectedStrategy}
              >
                <Shield className="h-4 w-4" />
                Execute round
              </Button>
              {season && (
                <Button variant="ghost" onClick={resetSeason}>
                  Reset board
                </Button>
              )}
            </div>
          </section>

          <section className="league-panel">
            <div className="league-panel-header">
              <h2 className="league-panel-title">
                <Trophy className="h-4 w-4" /> Telemetry + Ranking
              </h2>
              <p className="league-muted">
                {season
                  ? `Round ${Math.min(season.roundIndex, season.events.length)}/${season.events.length}`
                  : "No active season yet"}
              </p>
            </div>

            <div className="league-chart-wrap">
              {equitySeries.length >= 2 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equitySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(126, 177, 205, 0.25)" />
                    <XAxis dataKey="round" tick={{ fill: "#8bb6ce", fontSize: 11 }} />
                    <YAxis
                      tick={{ fill: "#8bb6ce", fontSize: 11 }}
                      tickFormatter={(value: number) => `${Math.round(value / 100) / 10}k`}
                    />
                    <Tooltip
                      formatter={(value: number) => [formatCredits(Number(value)), "Capital"]}
                      contentStyle={{
                        background: "rgba(6, 20, 34, 0.95)",
                        border: "1px solid rgba(117,177,210,0.35)",
                        borderRadius: "10px",
                      }}
                      labelStyle={{ color: "#bce6ff" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="capital"
                      stroke="#f59e0b"
                      strokeWidth={2.4}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="league-empty-state">Play your first two rounds to reveal the capital curve.</div>
              )}
            </div>

            <div className="league-divider" />

            {season?.standing && (
              <>
                <div className="league-summary-grid">
                  <div className="league-summary-tile">
                    <span className="league-summary-label">League points</span>
                    <span className="league-summary-value">{season.standing.leaguePoints}</span>
                  </div>
                  <div className="league-summary-tile">
                    <span className="league-summary-label">Rank</span>
                    <span className="league-summary-value">{season.standing.rank}</span>
                  </div>
                  <div className="league-summary-tile">
                    <span className="league-summary-label">ROI</span>
                    <span className="league-summary-value">{formatPercent(season.standing.roi)}</span>
                  </div>
                  <div className="league-summary-tile">
                    <span className="league-summary-label">Max drawdown</span>
                    <span className="league-summary-value">{formatPercent(season.standing.maxDrawdown)}</span>
                  </div>
                </div>

                <div className="league-cta-row">
                  <Button
                    className="bg-emerald-400 text-black hover:bg-emerald-300"
                    onClick={commitSeasonOnChain}
                    disabled={commitPending || Boolean(season.committedTx)}
                  >
                    {commitPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                    {season.committedTx ? "Committed" : "Commit on-chain"}
                  </Button>
                  <Button variant="ghost" onClick={shareSeason}>
                    <Share2 className="h-4 w-4" /> Share result
                  </Button>
                </div>

                {season.committedTx && (
                  <p className="league-muted">
                    Memo signature: {season.committedTx.slice(0, 12)}...{season.committedTx.slice(-8)}
                  </p>
                )}

                <div className="league-divider" />
              </>
            )}

            <h3 className="league-panel-title">
              <Shield className="h-4 w-4" /> Recent rounds
            </h3>
            <div className="league-log-list">
              {recentRounds.length > 0 ? (
                recentRounds.map((entry) => (
                  <div
                    key={`${entry.eventKey}-${entry.round}`}
                    className={`league-log-row ${
                      entry.verdict === "jackpot"
                        ? "is-jackpot"
                        : entry.verdict === "win"
                          ? "is-win"
                          : entry.verdict === "loss"
                            ? "is-loss"
                            : ""
                    }`}
                  >
                    <div>
                      <p className="league-log-title">R{entry.round} - {entry.eventName}</p>
                      <p className="league-log-sub">
                        {entry.strategyName} | stake {entry.stakePercent}% | capital {formatCredits(entry.capitalAfter)}
                      </p>
                    </div>
                    <span
                      className={`league-pill ${
                        entry.verdict === "jackpot"
                          ? "jackpot"
                          : entry.verdict === "win"
                            ? "win"
                            : entry.verdict === "loss"
                              ? "loss"
                              : ""
                      }`}
                    >
                      {entry.pnl >= 0 ? "+" : ""}
                      {formatCredits(entry.pnl)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="league-empty-state">No executed rounds yet.</div>
              )}
            </div>

            <div className="league-divider" />

            <h3 className="league-panel-title">
              <Trophy className="h-4 w-4" /> Local leaderboard
            </h3>
            <div className="league-leaderboard">
              {leaderboard.length > 0 ? (
                leaderboard.map((entry, index) => (
                  <div className="league-leaderboard-row" key={entry.seasonId}>
                    <span className="league-leaderboard-rank">{index + 1}</span>
                    <div className="league-leaderboard-main">
                      <strong>{entry.rank} - {formatAddress(entry.address)}</strong>
                      <span className="league-leaderboard-meta">
                        {entry.difficulty} | ROI {(entry.roi * 100).toFixed(1)}% | {formatCredits(entry.finalCapital)}
                      </span>
                    </div>
                    <span className="league-pill">{entry.leaguePoints} pts</span>
                  </div>
                ))
              ) : (
                <div className="league-empty-state">Complete your first season to seed the leaderboard.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrismLeague;
