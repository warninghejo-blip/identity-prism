import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { goBack } from "@/lib/safeNavigate";
import { startFadeTransition, fadeOutTransition } from "@/lib/fadeTransition";
import {
  ArrowLeft,
  Trophy,
  RefreshCw,
  Loader2,
  Coins,
  Crosshair,
  Orbit,
  Rocket,
} from "lucide-react";
import { getHeliusProxyUrl, getAppBaseUrl } from "@/constants";
import { getTierIcon } from "@/lib/constants/tierColors";
import PageShell from "@/components/PageShell";

// ── Types ──

type TabKey = "overall" | "orbit" | "destroyer" | "gravity";

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


// ── Component ──

export default function Leaderboard() {
  const navigate = useNavigate();
  const wallet = useWallet();
  const myAddress = wallet.publicKey?.toBase58() || "";

  useEffect(() => { fadeOutTransition(); }, []);

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


  useEffect(() => {
    fetchEntries(activeTab);
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = (tab: TabKey) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
  };

  const activeTabConfig = TABS.find((t) => t.key === activeTab)!;

  const currentGameEntries =
    activeTab !== "overall"
      ? gameEntries[activeTab] || []
      : [];
  const isEmpty =
    activeTab === "overall"
      ? overallEntries.length === 0
      : currentGameEntries.length === 0;

  const handleRefresh = () => {
    fetchEntries(activeTab);
  };

  return (
    <PageShell className="text-white">
      {/* Header */}
      <header className="flex-none sticky top-0 z-20 bg-[#050510]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => { startFadeTransition(() => goBack(navigate)); }}
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
            disabled={loading}
            className="text-white/40 hover:text-white/70 transition-colors disabled:opacity-30"
          >
            <RefreshCw
              className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
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
        {loading && isEmpty ? (
          <div className="flex items-center justify-center py-20 text-white/30">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading...
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-400/60">
            <Trophy className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">{error}</p>
            <button
              onClick={() => fetchEntries(activeTab)}
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
                <span className="flex items-center gap-0.5" style={{ color: tierColor }}>
                  <img src={getTierIcon(entry.tier)} alt="" className="w-3 h-3 object-contain" />
                  <span className="font-semibold">{tierDisplayName(entry.tier)}</span>
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
              className="hidden sm:flex items-center justify-end gap-1 text-xs font-semibold"
              style={{ color: tierColor }}
            >
              <img src={getTierIcon(entry.tier)} alt="" className="w-4 h-4 object-contain" />
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
