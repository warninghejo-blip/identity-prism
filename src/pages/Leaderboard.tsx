import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { goBack } from "@/lib/safeNavigate";
import {
  ArrowLeft,
  Trophy,
  RefreshCw,
  Loader2,
  Coins,
  Crosshair,
  Orbit,
  Rocket,
  Swords,
  ChevronDown,
  ChevronUp,
  Clock,
  Users,
  Star,
} from "lucide-react";
import { getHeliusProxyUrl, getAppBaseUrl } from "@/constants";
import PageShell from "@/components/PageShell";

// ── Types ──

type TabKey = "overall" | "orbit" | "destroyer" | "gravity" | "tournament";

interface OverallEntry {
  address: string;
  totalCoins: number;
  score: number;
  tier: string;
  isMinted: boolean;
  prismBalance: number;
  badges: number;
  rank: number;
}

interface GameEntry {
  address: string;
  score: number;
  playedAt: string;
  txSignature?: string;
  gameType: string;
}

// ── Tournament Types ──

interface TournamentEntry {
  address: string;
  score: number;
  submittedAt: string;
  rank: number;
}

interface ActiveTournament {
  id: string;
  mode: string;
  endsAt: string;
  prizePool: number;
  entryCount: number;
  entries: TournamentEntry[];
  isEnded: boolean;
  winners?: TournamentEntry[];
  userJoined?: boolean;
}

interface TournamentHistoryItem {
  id: string;
  mode: string;
  endedAt: string;
  prizePool: number;
  entryCount: number;
  winners: TournamentEntry[];
}

// ── Tab config ──

interface TabConfig {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
  color: string;
}

const TABS: TabConfig[] = [
  {
    key: "overall",
    label: "Overall",
    icon: <Trophy className="w-3.5 h-3.5" />,
    color: "#FFD700",
  },
  {
    key: "orbit",
    label: "Orbit",
    icon: <Orbit className="w-3.5 h-3.5" />,
    color: "#73C2FB",
  },
  {
    key: "destroyer",
    label: "Destroyer",
    icon: <Crosshair className="w-3.5 h-3.5" />,
    color: "#C1440E",
  },
  {
    key: "gravity",
    label: "Gravity",
    icon: <Rocket className="w-3.5 h-3.5" />,
    color: "#22D3EE",
  },
  {
    key: "tournament",
    label: "Tournament",
    icon: <Swords className="w-3.5 h-3.5" />,
    color: "#A855F7",
  },
];

// ── Tier colors (matches the rest of the app) ──

const TIER_COLORS: Record<string, string> = {
  mercury: "#8B8B8B",
  venus: "#E8CDA0",
  earth: "#4B9CD3",
  mars: "#C1440E",
  jupiter: "#C88B3A",
  saturn: "#E8D191",
  uranus: "#73C2FB",
  neptune: "#3F54BE",
  sun: "#FFD700",
  binary_sun: "#22D3EE",
  "binary sun": "#22D3EE",
};

// ── Helpers ──

function getServerBase(): string {
  return (
    getHeliusProxyUrl() ||
    getAppBaseUrl() ||
    (typeof window !== "undefined" ? window.location.origin : "")
  );
}

function formatAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function tierDisplayName(tier: string): string {
  if (!tier) return "\u2014";
  const t = tier.toLowerCase().replace("_", " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function getTierColor(tier: string): string {
  const key = tier?.toLowerCase() || "";
  return TIER_COLORS[key] || TIER_COLORS[key.replace(" ", "_")] || "#888";
}

/** Format game score: orbit & gravity are time-based (seconds survived), destroyer is points */
function formatGameScore(score: number, gameType: TabKey): string {
  if (gameType === "destroyer") {
    return formatNumber(score) + " pts";
  }
  // Orbit & Gravity: score = seconds survived
  if (score >= 60) {
    const min = Math.floor(score / 60);
    const sec = Math.round(score % 60);
    return `${min}m ${sec < 10 ? "0" : ""}${sec}s`;
  }
  return `${Math.round(score)}s`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "\u2014";
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "\u2014";
  }
}

/** Format a future timestamp as "Xh Ym Zs" countdown */
function formatTimeLeft(endsAt: string): string {
  try {
    const end = new Date(endsAt).getTime();
    const now = Date.now();
    const diff = end - now;
    if (diff <= 0) return "Ended";
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s < 10 ? "0" : ""}${s}s`;
    return `${s}s`;
  } catch {
    return "\u2014";
  }
}

function getJwt(): string {
  return localStorage.getItem("ip_jwt") || "";
}

// ── Component ──

export default function Leaderboard() {
  const navigate = useNavigate();
  const wallet = useWallet();
  const myAddress = wallet.publicKey?.toBase58() || "";

  const [activeTab, setActiveTab] = useState<TabKey>("overall");

  // Overall tab data
  const [overallEntries, setOverallEntries] = useState<OverallEntry[]>([]);
  // Game tab data (keyed by gameType)
  const [gameEntries, setGameEntries] = useState<Record<string, GameEntry[]>>({
    orbit: [],
    destroyer: [],
    gravity: [],
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tournament state
  const [tournament, setTournament] = useState<ActiveTournament | null>(null);
  const [tournamentLoading, setTournamentLoading] = useState(false);
  const [tournamentError, setTournamentError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<TournamentHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string>("");
  const tournamentIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEntries = useCallback(
    async (tab?: TabKey) => {
      const currentTab = tab ?? activeTab;
      setLoading(true);
      setError(null);
      try {
        const base = getServerBase();
        if (!base) {
          setLoading(false);
          return;
        }

        if (currentTab === "overall") {
          const res = await fetch(`${base}/api/leaderboard?limit=50`);
          if (res.ok) {
            const data = await res.json();
            setOverallEntries(data?.entries || []);
          } else {
            setError("Failed to load leaderboard");
          }
        } else if (currentTab !== "tournament") {
          const res = await fetch(
            `${base}/api/game/leaderboard?gameType=${currentTab}`
          );
          if (res.ok) {
            const data = await res.json();
            setGameEntries((prev) => ({
              ...prev,
              [currentTab]: data?.entries || [],
            }));
          } else {
            setError("Failed to load leaderboard");
          }
        }
      } catch {
        setError("Network error \u2014 check your connection");
      }
      setLoading(false);
    },
    [activeTab]
  );

  const fetchTournament = useCallback(async () => {
    const base = getServerBase();
    if (!base) return;
    setTournamentLoading(true);
    setTournamentError(null);
    try {
      const res = await fetch(`${base}/api/tournament/active`);
      if (res.ok) {
        const data = await res.json();
        setTournament(data?.tournament || null);
      } else if (res.status === 404) {
        setTournament(null);
      } else {
        setTournamentError("Failed to load tournament data");
      }
    } catch {
      setTournamentError("Network error \u2014 check your connection");
    }
    setTournamentLoading(false);
  }, []);

  const fetchHistory = useCallback(async () => {
    const base = getServerBase();
    if (!base) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`${base}/api/tournament/history`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data?.tournaments || []);
      }
    } catch {
      // silently fail for history
    }
    setHistoryLoading(false);
  }, []);

  const handleJoin = async () => {
    const base = getServerBase();
    if (!base || !myAddress) return;
    setJoinLoading(true);
    setJoinMessage(null);
    try {
      const jwt = getJwt();
      const res = await fetch(`${base}/api/tournament/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({ address: myAddress }),
      });
      const data = await res.json();
      if (res.ok) {
        setJoinMessage(data?.message || "Joined successfully!");
        fetchTournament();
      } else {
        setJoinMessage(data?.error || "Failed to join tournament");
      }
    } catch {
      setJoinMessage("Network error \u2014 could not join");
    }
    setJoinLoading(false);
  };

  useEffect(() => {
    if (activeTab !== "tournament") {
      fetchEntries(activeTab);
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tournament: fetch on mount when tab is active + refresh every 30s
  useEffect(() => {
    if (activeTab !== "tournament") {
      if (tournamentIntervalRef.current) {
        clearInterval(tournamentIntervalRef.current);
        tournamentIntervalRef.current = null;
      }
      return;
    }
    fetchTournament();
    tournamentIntervalRef.current = setInterval(fetchTournament, 30_000);
    return () => {
      if (tournamentIntervalRef.current) {
        clearInterval(tournamentIntervalRef.current);
        tournamentIntervalRef.current = null;
      }
    };
  }, [activeTab, fetchTournament]);

  // Countdown ticker
  useEffect(() => {
    if (tournament && !tournament.isEnded) {
      setTimeLeft(formatTimeLeft(tournament.endsAt));
      countdownRef.current = setInterval(() => {
        setTimeLeft(formatTimeLeft(tournament.endsAt));
      }, 1000);
    } else {
      setTimeLeft("");
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [tournament]);

  const handleTabChange = (tab: TabKey) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
  };

  const activeTabConfig = TABS.find((t) => t.key === activeTab)!;

  const currentGameEntries =
    activeTab !== "overall" && activeTab !== "tournament"
      ? gameEntries[activeTab] || []
      : [];
  const isEmpty =
    activeTab === "overall"
      ? overallEntries.length === 0
      : activeTab === "tournament"
      ? false // tournament tab has its own empty states
      : currentGameEntries.length === 0;

  const handleRefresh = () => {
    if (activeTab === "tournament") {
      fetchTournament();
    } else {
      fetchEntries();
    }
  };

  return (
    <PageShell className="text-white">
      {/* Header */}
      <header className="flex-none sticky top-0 z-20 bg-[#050510]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => goBack(navigate)}
            className="text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Trophy className="w-5 h-5 text-yellow-400" />
          <div className="flex flex-col">
            <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-300 leading-tight">
              Leaderboard
            </h1>
            <span className="text-[10px] text-white/30 leading-none">
              Top explorers across the Prism universe
            </span>
          </div>
          <div className="flex-1" />
          <button
            onClick={handleRefresh}
            disabled={loading || tournamentLoading}
            className="text-white/40 hover:text-white/70 transition-colors disabled:opacity-30"
          >
            <RefreshCw
              className={`w-4 h-4 ${loading || tournamentLoading ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {/* Tab pills */}
        <div className="max-w-3xl mx-auto px-4 pb-2 flex gap-1.5 overflow-x-auto scrollbar-hide">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
                  whitespace-nowrap transition-all duration-200 shrink-0
                  ${
                    isActive
                      ? "text-white shadow-lg"
                      : "text-white/40 hover:text-white/60 bg-white/[0.03] hover:bg-white/[0.06]"
                  }
                `}
                style={
                  isActive
                    ? {
                        backgroundColor: tab.color + "22",
                        borderColor: tab.color + "44",
                        border: `1px solid ${tab.color}44`,
                        color: tab.color,
                        boxShadow: `0 0 12px ${tab.color}18`,
                      }
                    : { border: "1px solid transparent" }
                }
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full px-4 py-4 pb-24">
        {activeTab === "tournament" ? (
          <TournamentPanel
            tournament={tournament}
            loading={tournamentLoading}
            error={tournamentError}
            timeLeft={timeLeft}
            myAddress={myAddress}
            joinLoading={joinLoading}
            joinMessage={joinMessage}
            onJoin={handleJoin}
            history={history}
            historyLoading={historyLoading}
            historyOpen={historyOpen}
            onToggleHistory={() => {
              setHistoryOpen((o) => {
                if (!o) fetchHistory();
                return !o;
              });
            }}
          />
        ) : loading && isEmpty ? (
          <div className="flex items-center justify-center py-20 text-white/30">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading...
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-400/60">
            <Trophy className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">{error}</p>
            <button
              onClick={() => fetchEntries()}
              className="mt-4 text-xs text-white/40 hover:text-white/70 underline transition-colors"
            >
              Retry
            </button>
          </div>
        ) : isEmpty ? (
          <div className="text-center py-20 text-white/20">
            <Trophy className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">
              No entries yet
              {activeTab !== "overall"
                ? ` for ${activeTabConfig.label} mode`
                : ""}
              . Be the first!
            </p>
          </div>
        ) : activeTab === "overall" ? (
          <OverallTable entries={overallEntries} myAddress={myAddress} />
        ) : (
          <GameTable
            entries={currentGameEntries}
            myAddress={myAddress}
            gameType={activeTab}
            accentColor={activeTabConfig.color}
          />
        )}
      </main>
    </PageShell>
  );
}

// ── Tournament Panel ──

const TOURNAMENT_COLOR = "#A855F7";

function TournamentPanel({
  tournament,
  loading,
  error,
  timeLeft,
  myAddress,
  joinLoading,
  joinMessage,
  onJoin,
  history,
  historyLoading,
  historyOpen,
  onToggleHistory,
}: {
  tournament: ActiveTournament | null;
  loading: boolean;
  error: string | null;
  timeLeft: string;
  myAddress: string;
  joinLoading: boolean;
  joinMessage: string | null;
  onJoin: () => void;
  history: TournamentHistoryItem[];
  historyLoading: boolean;
  historyOpen: boolean;
  onToggleHistory: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-white/30">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading tournament...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20 text-red-400/60">
        <Swords className="w-12 h-12 mx-auto mb-4 opacity-20" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Active / ended tournament card */}
      {tournament ? (
        tournament.isEnded ? (
          <EndedTournamentCard tournament={tournament} myAddress={myAddress} />
        ) : (
          <ActiveTournamentCard
            tournament={tournament}
            timeLeft={timeLeft}
            myAddress={myAddress}
            joinLoading={joinLoading}
            joinMessage={joinMessage}
            onJoin={onJoin}
          />
        )
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-white/30 flex flex-col items-center gap-3">
          <Swords className="w-10 h-10 opacity-20" />
          <p className="text-sm">No active tournament right now.</p>
          <p className="text-xs text-white/20">Check back soon!</p>
        </div>
      )}

      {/* Score submit note */}
      <div
        className="rounded-xl border px-4 py-3 flex items-start gap-3"
        style={{
          borderColor: TOURNAMENT_COLOR + "30",
          backgroundColor: TOURNAMENT_COLOR + "0A",
        }}
      >
        <Star className="w-4 h-4 mt-0.5 shrink-0" style={{ color: TOURNAMENT_COLOR }} />
        <p className="text-xs text-white/50 leading-relaxed">
          Scores are submitted automatically when you finish a game session.
          Just play normally — your best run during the tournament window counts.
        </p>
      </div>

      {/* Tournament history accordion */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <button
          onClick={onToggleHistory}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
        >
          <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Tournament History
          </span>
          {historyLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-white/30" />
          ) : historyOpen ? (
            <ChevronUp className="w-4 h-4 text-white/30" />
          ) : (
            <ChevronDown className="w-4 h-4 text-white/30" />
          )}
        </button>

        {historyOpen && !historyLoading && (
          <div className="border-t border-white/[0.05]">
            {history.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-white/20">
                No past tournaments yet
              </p>
            ) : (
              history.map((h) => (
                <HistoryItem key={h.id} item={h} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Active Tournament Card ──

function ActiveTournamentCard({
  tournament,
  timeLeft,
  myAddress,
  joinLoading,
  joinMessage,
  onJoin,
}: {
  tournament: ActiveTournament;
  timeLeft: string;
  myAddress: string;
  joinLoading: boolean;
  joinMessage: string | null;
  onJoin: () => void;
}) {
  const alreadyJoined = tournament.userJoined;
  const canJoin = !!myAddress && !alreadyJoined;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: TOURNAMENT_COLOR + "33",
        backgroundColor: TOURNAMENT_COLOR + "08",
      }}
    >
      {/* Card header */}
      <div
        className="px-4 py-3 flex items-center gap-2 border-b"
        style={{ borderColor: TOURNAMENT_COLOR + "20" }}
      >
        <Swords className="w-4 h-4" style={{ color: TOURNAMENT_COLOR }} />
        <span
          className="text-sm font-bold"
          style={{ color: TOURNAMENT_COLOR }}
        >
          Active Tournament
        </span>
        <span
          className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: TOURNAMENT_COLOR + "20",
            color: TOURNAMENT_COLOR,
          }}
        >
          LIVE
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-white/[0.05] border-b border-white/[0.05]">
        <StatCell
          icon={<Swords className="w-3.5 h-3.5" />}
          label="Mode"
          value={tournament.mode}
        />
        <StatCell
          icon={<Clock className="w-3.5 h-3.5" />}
          label="Time Left"
          value={timeLeft || "\u2014"}
          highlight
        />
        <StatCell
          icon={<Users className="w-3.5 h-3.5" />}
          label="Entries"
          value={String(tournament.entryCount)}
        />
      </div>

      {/* Prize pool */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.05]">
        <Coins className="w-4 h-4 text-yellow-400/70" />
        <span className="text-xs text-white/40">Prize Pool</span>
        <span className="ml-auto text-sm font-bold text-yellow-300">
          {formatNumber(tournament.prizePool)} coins
        </span>
      </div>

      {/* Join button */}
      <div className="px-4 py-3 flex flex-col gap-2">
        {alreadyJoined ? (
          <div
            className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-center"
            style={{
              backgroundColor: TOURNAMENT_COLOR + "18",
              color: TOURNAMENT_COLOR,
            }}
          >
            Joined — good luck!
          </div>
        ) : (
          <button
            onClick={onJoin}
            disabled={joinLoading || !canJoin}
            className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              backgroundColor: TOURNAMENT_COLOR,
              color: "#fff",
              boxShadow: `0 0 20px ${TOURNAMENT_COLOR}40`,
            }}
          >
            {joinLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Coins className="w-4 h-4" />
                Join Tournament — 50 coins
              </>
            )}
          </button>
        )}
        {!myAddress && (
          <p className="text-center text-xs text-white/30">
            Connect wallet to join
          </p>
        )}
        {joinMessage && (
          <p
            className={`text-center text-xs ${
              joinMessage.toLowerCase().includes("fail") ||
              joinMessage.toLowerCase().includes("error")
                ? "text-red-400/70"
                : "text-green-400/70"
            }`}
          >
            {joinMessage}
          </p>
        )}
      </div>

      {/* Leaderboard */}
      {tournament.entries && tournament.entries.length > 0 && (
        <div className="border-t border-white/[0.05]">
          <p className="px-4 py-2 text-[10px] uppercase tracking-wider font-bold text-white/30">
            Current Standings
          </p>
          {tournament.entries.map((entry, idx) => (
            <TournamentEntryRow
              key={`${entry.address}-${idx}`}
              entry={entry}
              rank={entry.rank || idx + 1}
              myAddress={myAddress}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ended Tournament Card ──

function EndedTournamentCard({
  tournament,
  myAddress,
}: {
  tournament: ActiveTournament;
  myAddress: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-white/[0.05]">
        <Trophy className="w-4 h-4 text-yellow-400" />
        <span className="text-sm font-bold text-yellow-300">
          Tournament Ended — Winners
        </span>
      </div>

      {tournament.winners && tournament.winners.length > 0 ? (
        tournament.winners.map((w, idx) => (
          <TournamentEntryRow
            key={`${w.address}-${idx}`}
            entry={w}
            rank={w.rank || idx + 1}
            myAddress={myAddress}
            isWinner
          />
        ))
      ) : (
        <p className="px-4 py-6 text-center text-xs text-white/20">
          No winners recorded
        </p>
      )}
    </div>
  );
}

// ── Tournament Entry Row ──

function TournamentEntryRow({
  entry,
  rank,
  myAddress,
  isWinner,
}: {
  entry: TournamentEntry;
  rank: number;
  myAddress: string;
  isWinner?: boolean;
}) {
  const isMine = entry.address === myAddress;

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.03] transition-colors
        ${isMine ? "border-l-2" : ""}
        ${rank % 2 === 0 ? "bg-white/[0.01]" : ""}
      `}
      style={
        isMine
          ? { borderLeftColor: TOURNAMENT_COLOR, backgroundColor: TOURNAMENT_COLOR + "0F" }
          : undefined
      }
    >
      <RankBadge rank={rank} color={TOURNAMENT_COLOR} />

      <span
        className={`flex-1 text-xs font-mono truncate ${
          isMine ? "font-bold" : "text-white/60"
        }`}
        style={isMine ? { color: TOURNAMENT_COLOR } : undefined}
      >
        {formatAddr(entry.address)}
        {isMine && (
          <span className="ml-1 text-[9px] opacity-60" style={{ color: TOURNAMENT_COLOR }}>
            (you)
          </span>
        )}
        {isWinner && rank === 1 && (
          <span className="ml-1 text-yellow-400 text-[10px]">&#9733;</span>
        )}
      </span>

      <span
        className="text-xs font-bold tabular-nums"
        style={{ color: TOURNAMENT_COLOR }}
      >
        {formatNumber(entry.score)} pts
      </span>

      {entry.submittedAt && (
        <span className="hidden sm:block text-[10px] text-white/25 shrink-0">
          {formatDate(entry.submittedAt)}
        </span>
      )}
    </div>
  );
}

// ── History Item ──

function HistoryItem({ item }: { item: TournamentHistoryItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-white/[0.04] last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white/60">
            {item.mode} Tournament
          </p>
          <p className="text-[10px] text-white/25 mt-0.5">
            {formatDate(item.endedAt)} &middot; {item.entryCount} entries &middot;{" "}
            {formatNumber(item.prizePool)} coins prize
          </p>
        </div>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-white/20 shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-white/20 shrink-0" />
        )}
      </button>

      {open && (
        <div className="bg-black/20 border-t border-white/[0.04]">
          {item.winners && item.winners.length > 0 ? (
            item.winners.slice(0, 3).map((w, idx) => (
              <div
                key={`${w.address}-${idx}`}
                className="flex items-center gap-3 px-5 py-2 border-b border-white/[0.03] last:border-0"
              >
                <RankBadge rank={w.rank || idx + 1} color={TOURNAMENT_COLOR} />
                <span className="flex-1 text-xs font-mono text-white/50 truncate">
                  {formatAddr(w.address)}
                </span>
                <span
                  className="text-xs font-bold tabular-nums"
                  style={{ color: TOURNAMENT_COLOR }}
                >
                  {formatNumber(w.score)} pts
                </span>
              </div>
            ))
          ) : (
            <p className="px-5 py-4 text-xs text-white/20">No winners data</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stat Cell ──

function StatCell({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-3 px-2">
      <span
        className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-white/30"
      >
        <span style={highlight ? { color: TOURNAMENT_COLOR + "99" } : undefined}>
          {icon}
        </span>
        {label}
      </span>
      <span
        className={`text-sm font-bold ${highlight ? "" : "text-white/70"}`}
        style={highlight ? { color: TOURNAMENT_COLOR } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

// ── Overall Table ──

function OverallTable({
  entries,
  myAddress,
}: {
  entries: OverallEntry[];
  myAddress: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Table header */}
      <div className="hidden sm:grid grid-cols-[48px_1fr_100px_80px_90px] px-4 py-2 border-b border-white/[0.05] text-[10px] uppercase tracking-wider font-bold text-white/30">
        <span>#</span>
        <span>Address</span>
        <span className="text-right">Coins</span>
        <span className="text-right">Score</span>
        <span className="text-right">Tier</span>
      </div>

      {/* Rows */}
      {entries.map((entry, idx) => {
        const rank = entry.rank || idx + 1;
        const isMine = entry.address === myAddress;
        const tierColor = getTierColor(entry.tier);

        return (
          <div
            key={entry.address}
            onClick={() => navigate(`/profile/${entry.address}`)}
            className={`
              grid grid-cols-[36px_1fr] sm:grid-cols-[48px_1fr_100px_80px_90px]
              px-4 py-2.5 border-b border-white/[0.03] items-center gap-y-0.5 cursor-pointer hover:bg-white/[0.04] transition-colors
              ${isMine ? "bg-yellow-400/[0.06] border-l-2 border-l-yellow-400" : ""}
              ${rank % 2 === 0 ? "bg-white/[0.01]" : ""}
            `}
          >
            {/* Rank */}
            <RankBadge rank={rank} />

            {/* Address + minted badge */}
            <div className="flex flex-col sm:flex-row sm:items-center min-w-0">
              <span
                className={`text-xs font-mono truncate ${
                  isMine ? "text-yellow-300 font-bold" : "text-white/60"
                }`}
              >
                {formatAddr(entry.address)}
                {entry.isMinted && (
                  <span
                    className="ml-1 text-yellow-400"
                    title="Minted Identity"
                  >
                    &#10022;
                  </span>
                )}
                {isMine && (
                  <span className="ml-1 text-[9px] text-yellow-400/60">
                    (you)
                  </span>
                )}
              </span>

              {/* Mobile-only: coins, score, tier inline */}
              <div className="flex items-center gap-3 mt-0.5 sm:hidden text-[10px]">
                <span className="flex items-center gap-0.5 text-white/50">
                  <Coins className="w-3 h-3 text-yellow-400/60" />
                  {formatNumber(entry.totalCoins)}
                </span>
                <span className="text-white/40">
                  Score: {formatNumber(entry.score)}
                </span>
                <span style={{ color: tierColor }} className="font-semibold">
                  {tierDisplayName(entry.tier)}
                </span>
              </div>
            </div>

            {/* Total Coins — desktop */}
            <span className="hidden sm:flex items-center justify-end gap-1 text-xs tabular-nums font-bold text-white/80">
              <Coins className="w-3.5 h-3.5 text-yellow-400/70" />
              {formatNumber(entry.totalCoins)}
            </span>

            {/* Score — desktop */}
            <span className="hidden sm:block text-xs text-right tabular-nums font-bold text-white/80">
              {formatNumber(entry.score)}
            </span>

            {/* Tier — desktop */}
            <span
              className="hidden sm:block text-xs text-right font-semibold"
              style={{ color: tierColor }}
            >
              {tierDisplayName(entry.tier)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Game Table ──

function GameTable({
  entries,
  myAddress,
  gameType,
  accentColor,
}: {
  entries: GameEntry[];
  myAddress: string;
  gameType: TabKey;
  accentColor: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Table header */}
      <div className="hidden sm:grid grid-cols-[48px_1fr_120px_100px] px-4 py-2 border-b border-white/[0.05] text-[10px] uppercase tracking-wider font-bold text-white/30">
        <span>#</span>
        <span>Address</span>
        <span className="text-right">
          {gameType === "destroyer" ? "Score" : "Time"}
        </span>
        <span className="text-right">Date</span>
      </div>

      {/* Rows */}
      {entries.map((entry, idx) => {
        const rank = idx + 1;
        const isMine = entry.address === myAddress;

        return (
          <div
            key={`${entry.address}-${idx}`}
            onClick={() => navigate(`/profile/${entry.address}`)}
            className={`
              grid grid-cols-[36px_1fr] sm:grid-cols-[48px_1fr_120px_100px]
              px-4 py-2.5 border-b border-white/[0.03] items-center gap-y-0.5 cursor-pointer hover:bg-white/[0.04] transition-colors
              ${isMine ? "border-l-2" : ""}
              ${rank % 2 === 0 ? "bg-white/[0.01]" : ""}
            `}
            style={isMine ? { borderLeftColor: accentColor, backgroundColor: accentColor + "0F" } : undefined}
          >
            {/* Rank */}
            <RankBadge rank={rank} color={accentColor} />

            {/* Address */}
            <div className="flex flex-col sm:flex-row sm:items-center min-w-0">
              <span
                className={`text-xs font-mono truncate ${
                  isMine ? "font-bold" : "text-white/60"
                }`}
                style={isMine ? { color: accentColor } : undefined}
              >
                {formatAddr(entry.address)}
                {isMine && (
                  <span
                    className="ml-1 text-[9px] opacity-60"
                    style={{ color: accentColor }}
                  >
                    (you)
                  </span>
                )}
              </span>

              {/* Mobile-only: score + date inline */}
              <div className="flex items-center gap-3 mt-0.5 sm:hidden text-[10px]">
                <span className="font-bold" style={{ color: accentColor }}>
                  {formatGameScore(entry.score, gameType)}
                </span>
                {entry.playedAt && (
                  <span className="text-white/30">
                    {formatDate(entry.playedAt)}
                  </span>
                )}
              </div>
            </div>

            {/* Score — desktop */}
            <span
              className="hidden sm:block text-xs text-right tabular-nums font-bold"
              style={{ color: accentColor }}
            >
              {formatGameScore(entry.score, gameType)}
            </span>

            {/* Date — desktop */}
            <span className="hidden sm:block text-xs text-right text-white/30">
              {entry.playedAt ? formatDate(entry.playedAt) : "\u2014"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Rank Badge ──

function RankBadge({ rank, color }: { rank: number; color?: string }) {
  const defaultColors: Record<number, string> = {
    1: "#FFD700",
    2: "#C0C0C0",
    3: "#CD7F32",
  };
  const c = rank <= 3 ? defaultColors[rank] : undefined;

  return (
    <span
      className={`text-sm font-bold ${rank > 3 ? "text-white/30" : ""}`}
      style={c ? { color: c } : color ? undefined : undefined}
    >
      {rank <= 3 ? (
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px]"
          style={{
            backgroundColor: (c || color) + "20",
            color: c || color,
          }}
        >
          {rank}
        </span>
      ) : (
        `#${rank}`
      )}
    </span>
  );
}
