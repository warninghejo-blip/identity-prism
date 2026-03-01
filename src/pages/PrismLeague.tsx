import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { SolanaMobileWalletAdapterWalletName } from "@solana-mobile/wallet-adapter-mobile";
import { Button } from "@/components/ui/button";
import { useWalletData } from "@/hooks/useWalletData";
import { toast } from "sonner";
import {
  ArrowLeft,
  Trophy,
  Wallet,
  Play,
  RotateCcw,
  Share2,
  Orbit,
  Zap,
  Shield,
  ExternalLink,
  Award,
  Clock,
  Target,
  ChevronDown,
  ChevronUp,
  Coins,
  RotateCw,
} from "lucide-react";
import "./PrismLeague.css";
import { initAudio, startMusic, stopMusic, stopAllAudio, sfxGameOver } from "@/lib/gameAudio";
import { hapticHeavy, hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import OrbitSurvivalScene from "@/components/game/OrbitSurvivalScene";
import AsteroidDestroyerScene from "@/components/game/AsteroidDestroyerScene";
import { FpsOverlay } from "@/components/game/GameShared";

type GameMode = "orbit" | "destroyer";

const GAME_MODES: { id: GameMode; name: string; icon: string; desc: string; controls: string }[] = [
  { id: "orbit", name: "Orbit Survival", icon: "🛸", desc: "Dodge asteroids, survive as long as you can", controls: "Tap/Click to reverse orbit" },
  { id: "destroyer", name: "Cosmic Defender", icon: "💥", desc: "4 sectors of enemies & bosses. Auto-fire, collect powerups!", controls: "WASD/Arrows to move, auto-fire. Touch: drag to move" },
];
import {
  commitScoreOnchain,
  calculateRewardCredits,
  getRankReward,
  getOnchainScores,
  type OnchainScore,
} from "@/lib/onchainLeaderboard";
import {
  checkAchievements,
  updatePlayerStats,
  getPlayerStats,
  getAchievements,
  getAchievementProgress,
  claimAchievementReward,
  ACHIEVEMENT_COIN_REWARDS,
  TIER_COLORS as ACH_TIER_COLORS,
  type Achievement,
  type PlayerStats,
} from "@/lib/gameAchievements";
import { publishGameScore, isTapestryEnabled } from "@/lib/tapestry";
import {
  generateFairSeed,
  verifyGameSessionSeed,
  getMagicBlockHealth,
  MAGICBLOCK_BADGE,
  registerGameSessionProof,
  type GameSessionProof,
} from "@/lib/magicblock";
import { createWormholeTunnel, fadeOutWormholeTunnel } from "@/lib/wormholeTunnel";
import { getHeliusProxyUrl, getHeliusRpcUrl, getCollectionMint, getAppBaseUrl } from "@/constants";
import {
  checkDefenderAchievements,
  updateDefenderStats,
  getDefenderStats,
  getDefenderAchievements,
  getDefenderAchievementProgress,
  claimDefenderReward,
  DEFENDER_COIN_REWARDS,
  type DefenderAchievement,
  type DefenderStats,
} from "@/lib/defenderAchievements";

/* ═══════════════════════════════════════════════════
   Leaderboard types & server sync
   ═══════════════════════════════════════════════════ */

interface LeaderboardEntry {
  id: string;
  address: string;
  score: number;
  playedAt: string;
  txSignature?: string;
}

function getServerBase(): string {
  return getHeliusProxyUrl() || getAppBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "");
}

async function fetchServerLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const base = getServerBase();
    if (!base) return [];
    const res = await fetch(`${base}/api/game/leaderboard`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.entries || []).map((e: { address: string; score: number; playedAt?: string; txSignature?: string }) => ({
      id: `srv-${e.address}-${e.score}`,
      address: e.address,
      score: e.score,
      playedAt: e.playedAt || new Date().toISOString(),
      txSignature: e.txSignature,
    }));
  } catch {
    return [];
  }
}

async function submitToServerLeaderboard(entry: { address: string; score: number; playedAt: string; txSignature?: string }): Promise<void> {
  try {
    const base = getServerBase();
    if (!base) return;
    await fetch(`${base}/api/game/leaderboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
  } catch { /* silent */ }
}

/* ═══════════════════════════════════════════════════
   Coin persistence (per wallet)
   ═══════════════════════════════════════════════════ */

const COINS_STORAGE_KEY = "identity_prism_orbit_coins_v1";

function readWalletCoins(walletAddress: string): number {
  try {
    const raw = window.localStorage.getItem(COINS_STORAGE_KEY);
    if (!raw) return 0;
    const data = JSON.parse(raw) as Record<string, number>;
    return data[walletAddress] ?? 0;
  } catch { return 0; }
}

function writeWalletCoins(walletAddress: string, coins: number) {
  try {
    const raw = window.localStorage.getItem(COINS_STORAGE_KEY);
    const data: Record<string, number> = raw ? JSON.parse(raw) : {};
    data[walletAddress] = coins;
    window.localStorage.setItem(COINS_STORAGE_KEY, JSON.stringify(data));
  } catch { /* */ }
}

/* ═══════════════════════════════════════════════════
   Constants & types
   ═══════════════════════════════════════════════════ */

const LEADERBOARD_STORAGE_KEY = "identity_prism_orbit_survival_board_v3";
const DEFENDER_LEADERBOARD_KEY = "identity_prism_defender_board_v1";
const ONCHAIN_BONUS_MULTIPLIER = 1.5;
const COIN_BONUS = 25;
async function syncCoinsToServer(walletAddress: string, coins: number, delta: number): Promise<void> {
  try {
    const base = getServerBase();
    if (!base) return;
    await fetch(`${base}/api/game/coins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress, coins, delta }),
    });
  } catch { /* silent */ }
}

async function fetchServerCoins(walletAddress: string): Promise<number | null> {
  try {
    const base = getServerBase();
    if (!base) return null;
    const res = await fetch(`${base}/api/game/coins?address=${encodeURIComponent(walletAddress)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.coins === 'number' ? data.coins : null;
  } catch { return null; }
}

async function claimAchievementOnServer(walletAddress: string, achievementId: string, reward: number): Promise<{ ok: boolean; coins?: number }> {
  try {
    const base = getServerBase();
    if (!base) return { ok: true };
    const res = await fetch(`${base}/api/game/achievements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress, achievementId, reward }),
    });
    if (res.status === 409) return { ok: false };
    if (!res.ok) return { ok: true };
    const data = await res.json();
    return { ok: true, coins: data?.coins };
  } catch { return { ok: true }; }
}

async function syncUnlockedToServer(walletAddress: string, unlockedIds: string[]): Promise<void> {
  try {
    const base = getServerBase();
    if (!base || !unlockedIds.length) return;
    await fetch(`${base}/api/game/achievements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress, unlocked: unlockedIds }),
    });
  } catch { /* silent */ }
}

async function fetchServerAchievements(walletAddress: string): Promise<{ unlocked: string[]; claimed: string[] }> {
  try {
    const base = getServerBase();
    if (!base) return { unlocked: [], claimed: [] };
    const res = await fetch(`${base}/api/game/achievements?address=${encodeURIComponent(walletAddress)}`);
    if (!res.ok) return { unlocked: [], claimed: [] };
    const data = await res.json();
    return {
      unlocked: Array.isArray(data?.unlocked) ? data.unlocked : [],
      claimed: Array.isArray(data?.claimed) ? data.claimed : [],
    };
  } catch { return { unlocked: [], claimed: [] }; }
}

async function fetchServerRevives(walletAddress: string, mode: 'orbit' | 'destroyer'): Promise<{ left: number; max: number } | null> {
  try {
    const base = getServerBase();
    if (!base) return null;
    const res = await fetch(`${base}/api/game/revives?address=${encodeURIComponent(walletAddress)}&mode=${mode}`);
    if (!res.ok) return null; // server unavailable — keep localStorage fallback
    const data = await res.json();
    return { left: data?.left ?? 0, max: data?.max ?? 3 };
  } catch { return null; }
}

async function serverRevive(walletAddress: string, mode: 'orbit' | 'destroyer'): Promise<{ success: boolean; left: number }> {
  try {
    const base = getServerBase();
    if (!base) return { success: false, left: 0 };
    const res = await fetch(`${base}/api/game/revives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress, mode }),
    });
    const data = await res.json();
    if (res.ok && data?.success) return { success: true, left: data.left ?? 0 };
    return { success: false, left: data?.left ?? 0 };
  } catch { return { success: false, left: 0 }; }
}

const formatAddress = (address?: string) => {
  if (!address || address === "anonymous") return "Anon";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const formatPoints = (pts: number) => pts.toLocaleString();

const readDefenderLeaderboard = (): LeaderboardEntry[] => {
  try {
    const raw = window.localStorage.getItem(DEFENDER_LEADERBOARD_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LeaderboardEntry[];
  } catch { return []; }
};

const writeDefenderLeaderboard = (entries: LeaderboardEntry[]) => {
  try { window.localStorage.setItem(DEFENDER_LEADERBOARD_KEY, JSON.stringify(entries)); } catch { /* */ }
};

const readLeaderboard = (): LeaderboardEntry[] => {
  try {
    const raw = window.localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LeaderboardEntry[];
  } catch {
    return [];
  }
};

const writeLeaderboard = (entries: LeaderboardEntry[]) => {
  try {
    window.localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(entries));
  } catch { /* */ }
};

const isMobileDevice = () =>
  typeof window !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

const isCapacitorNative = () =>
  Boolean(
    (globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.()
  );

const isSeekerBrowser = () =>
  typeof navigator !== "undefined" && /seeker/i.test(navigator.userAgent);

/* ═══════════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════════ */

const PrismLeague = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as { fromAppJump?: boolean; returnAddress?: string } | null;
  const fromAppJump = Boolean(locationState?.fromAppJump);

  const wallet = useWallet();
  const { publicKey, connected, wallets: availableWallets, select, connect, disconnect } = wallet;
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const address = publicKey?.toBase58();
  const { traits } = useWalletData(address);
  const isMobile = useMemo(isMobileDevice, []);
  const isCapacitor = useMemo(isCapacitorNative, []);
  const isSeeker = useMemo(isSeekerBrowser, []);
  const useMobileWallet = isCapacitor || isMobile;

  const isAndroid = useMemo(() => /android/i.test(navigator.userAgent), []);

  /* Mobile wallet connection logic matching main app */
  const handleWalletConnect = useCallback(async () => {
    if (connected) return;

    if (useMobileWallet) {
      const mwaWallet = availableWallets.find(
        (w) => w.adapter.name === SolanaMobileWalletAdapterWalletName
      );
      const installedNonMwa = availableWallets.find(
        (w) => w.adapter.name !== SolanaMobileWalletAdapterWalletName &&
               (w.readyState === "Installed" || w.readyState === "Loadable")
      );
      // On Capacitor Android (Seeker), always try MWA even if readyState not detected
      const target = mwaWallet || installedNonMwa;

      if (target || (isCapacitor && isAndroid)) {
        const finalTarget = target || mwaWallet;
        if (!finalTarget) {
          setWalletModalVisible(true);
          return;
        }
        try {
          select(finalTarget.adapter.name);
          await new Promise((r) => setTimeout(r, 200));
          await connect();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err ?? "");
          if (message.includes("wallet not found") || message.includes("ERROR_WALLET_NOT_FOUND")) {
            const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
            if (isIos) {
              window.location.href = "https://phantom.app/ul/browse/" + encodeURIComponent(window.location.href);
              return;
            }
          }
          toast.error("Wallet connection failed");
          // Reset adapter state so next connect attempt starts fresh
          try { await finalTarget.adapter.disconnect(); } catch {}
          try { select(null as any); } catch {}
        }
      } else {
        setWalletModalVisible(true);
      }
    } else {
      setWalletModalVisible(true);
    }
  }, [connected, useMobileWallet, isCapacitor, isAndroid, availableWallets, select, connect, setWalletModalVisible]);

  const [gameMode, setGameMode] = useState<GameMode>("orbit");
  const [gameState, setGameState] = useState<"start" | "playing" | "gameover">("start");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);

  // Live score/coins — direct DOM updates during gameplay to avoid React re-renders
  const _liveScore = useRef(0);
  const _liveCoins = useRef(0);
  const _scoreDomRef = useRef<HTMLSpanElement>(null);
  const _coinsDomRef = useRef<HTMLSpanElement>(null);
  const throttledSetScore = useCallback((v: number) => {
    _liveScore.current = v;
    if (_scoreDomRef.current) _scoreDomRef.current.textContent = gameMode === 'destroyer' ? formatPoints(v) : formatTime(v);
  }, [gameMode]);
  const throttledSetCoins = useCallback((v: number) => {
    _liveCoins.current = v;
    if (_coinsDomRef.current) _coinsDomRef.current.textContent = String(v);
  }, []);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => readLeaderboard());
  const [defenderLeaderboard, setDefenderLeaderboard] = useState<LeaderboardEntry[]>(() => readDefenderLeaderboard());
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [isJumpingBack, setIsJumpingBack] = useState(false);
  const transitionTimersRef = useRef<number[]>([]);
  const runStartedAtRef = useRef<number>(Date.now());

  const [isCommitting, setIsCommitting] = useState(false);
  const [lastTxSignature, setLastTxSignature] = useState<string | null>(null);
  const [onchainBonusApplied, setOnchainBonusApplied] = useState(false);
  const [coins, setCoins] = useState(0);
  const [totalCoins, setTotalCoins] = useState(() => readWalletCoins(address || "anonymous"));

  // Sync coins & achievements from server when wallet connects
  useEffect(() => {
    if (!address) return;
    fetchServerCoins(address).then((srv) => {
      if (srv === null) return;
      const local = readWalletCoins(address);
      const best = Math.max(srv, local);
      if (best !== local) writeWalletCoins(address, best);
      setTotalCoins(best);
    });
    // Sync unlocked + claimed achievements from server
    fetchServerAchievements(address).then(({ unlocked: srvUnlocked, claimed: srvClaimed }) => {
      if (!srvUnlocked.length && !srvClaimed.length) return;
      const current = getAchievements();
      let changed = false;
      const now = new Date().toISOString();
      for (const id of srvUnlocked) {
        const ach = current.find((a) => a.id === id);
        if (ach && !ach.unlocked) {
          ach.unlocked = true;
          ach.unlockedAt = ach.unlockedAt || now;
          changed = true;
        }
      }
      for (const id of srvClaimed) {
        const ach = current.find((a) => a.id === id);
        if (ach && !ach.claimed) {
          ach.unlocked = true;
          ach.unlockedAt = ach.unlockedAt || now;
          ach.claimed = true;
          ach.claimedAt = ach.claimedAt || now;
          changed = true;
        }
      }
      if (changed) {
        const key = 'orbit_survival_achievements_v1';
        localStorage.setItem(key, JSON.stringify(current));
        setAchievements([...current]);
      }
    });
  }, [address]);
  const [sessionProof, setSessionProof] = useState<GameSessionProof | null>(null);
  const [newAchievements, setNewAchievements] = useState<Achievement[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStats>(() => getPlayerStats());
  const [achievements, setAchievements] = useState<Achievement[]>(() => getAchievements());
  const [onchainScores] = useState<OnchainScore[]>(() => getOnchainScores());

  // Defender-specific state
  const [defenderAchievements, setDefenderAchievements] = useState<DefenderAchievement[]>(() => getDefenderAchievements());
  const [defenderStats, setDefenderStats] = useState<DefenderStats>(() => getDefenderStats());
  const defenderKills = useRef(0);
  const defenderLevel = useRef(0);
  const [defLevelInfo, setDefLevelInfo] = useState<{ level: number; wave: number; name: string; banner: boolean }>({ level: 1, wave: 0, name: "", banner: false });
  const _pendingDefLevel = useRef<{ level: number; wave: number; name: string; banner: boolean } | null>(null);
  const _defLevelRaf = useRef(0);
  const handleDefLevel = useCallback((lv: number, wv: number, name: string, banner: boolean) => {
    // Only count completed levels: next level banner (lv>1) means previous was completed
    if (banner && lv > 1) {
      const completed = lv - 1;
      if (completed > defenderLevel.current) defenderLevel.current = completed;
    }
    _pendingDefLevel.current = { level: lv, wave: wv, name, banner };
    if (!_defLevelRaf.current) _defLevelRaf.current = requestAnimationFrame(() => {
      _defLevelRaf.current = 0;
      if (_pendingDefLevel.current) { setDefLevelInfo(_pendingDefLevel.current); _pendingDefLevel.current = null; }
    });
  }, []);

  // Continue/Revive feature — free revives for ID holders: 3 per DAY (persisted)
  const FREE_REVIVES_PER_DAY = 3;
  const reviveRef = useRef(false);
  const continueUsed = useRef(false);
  const freeRevivesLeft = useRef(0);
  const [showContinue, setShowContinue] = useState(false);
  const [revivePaying, setRevivePaying] = useState(false);
  const [isVictory, setIsVictory] = useState(false);
  const pendingGameOver = useRef<{ score: number; coins: number; isVictory?: boolean } | null>(null);

  // Helper: read/write daily free revives from localStorage
  const getDailyRevivesUsed = useCallback(() => {
    try {
      const raw = localStorage.getItem('free_revives_daily');
      if (!raw) return 0;
      const data = JSON.parse(raw);
      const today = new Date().toISOString().slice(0, 10);
      return data.date === today ? (data.used ?? 0) : 0;
    } catch { return 0; }
  }, []);
  const setDailyReviveUsed = useCallback(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const used = getDailyRevivesUsed() + 1;
      localStorage.setItem('free_revives_daily', JSON.stringify({ date: today, used }));
    } catch { /* ignore */ }
  }, [getDailyRevivesUsed]);

  // Minted ID check → 2x score multiplier
  // Active bonuses display (Defender) — DOM-driven, no re-render
  const _bonusesDomRef = useRef<HTMLDivElement>(null);
  const _pwrImgMap: Record<string, string> = {
    prism_shield: '/textures/powerups/powerup_shield.png',
    photon_burst: '/textures/powerups/powerup_photon_burst.png',
    quantum_core: '/textures/powerups/powerup_quantum_core.png',
    nova_rockets: '/textures/powerups/powerup_nova_rockets.png',
    nebula_bomb: '/textures/powerups/powerup_nebula_bomb.png',
    invuln: '/textures/powerups/powerup_shield.png',
  };
  const handleActiveBonuses = useCallback((bonuses: import("@/components/game/GameShared").ActiveBonus[]) => {
    const el = _bonusesDomRef.current;
    if (!el) return;
    if (bonuses.length === 0) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.innerHTML = bonuses.map(b => {
      const pct = Math.max(0, Math.min(100, Math.round((b.t / b.max) * 100)));
      const img = _pwrImgMap[b.type] || '';
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">` +
        `<span style="font-size:7px;font-weight:800;color:${b.color};text-transform:uppercase;letter-spacing:0.4px;text-shadow:0 0 6px ${b.color}88;white-space:nowrap">${b.label}</span>` +
        `<img src="${img}" width="22" height="22" style="filter:drop-shadow(0 0 5px ${b.color}80);image-rendering:pixelated" />` +
        `<div style="width:26px;height:4px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,0.4)">` +
          `<div style="width:${pct}%;height:100%;border-radius:3px;background:linear-gradient(90deg,${b.color}cc,${b.color});box-shadow:0 0 6px ${b.color}88;transition:width 0.12s linear"></div>` +
        `</div>` +
      `</div>`;
    }).join('');
  }, []);

  const _comboDomRef = useRef<HTMLDivElement>(null);
  const _comboHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCombo = useCallback((combo: number, pts: number) => {
    const el = _comboDomRef.current;
    if (!el) return;
    el.style.display = 'flex';
    el.style.opacity = '1';
    el.innerHTML = `<span class="text-xs font-black text-orange-300 tabular-nums">&times;${combo}</span><span class="text-[9px] text-orange-400/70 ml-1 font-bold">+${pts}</span>`;
    if (_comboHideTimer.current) clearTimeout(_comboHideTimer.current);
    _comboHideTimer.current = setTimeout(() => { if (el) { el.style.opacity = '0'; setTimeout(() => { el.style.display = 'none'; }, 300); } }, 1800);
  }, []);

  const [hasMintedId, setHasMintedId] = useState(false);
  useEffect(() => {
    if (!address) return;
    const heliusUrl = getHeliusRpcUrl();
    const collectionMint = getCollectionMint();
    if (!heliusUrl || !collectionMint) return;
    (async () => {
      try {
        const res = await fetch(heliusUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 'mint-check', method: 'searchAssets',
            params: { ownerAddress: address, grouping: ['collection', collectionMint], page: 1, limit: 1 },
          }),
        });
        const data = await res.json();
        setHasMintedId((data?.result?.total ?? 0) > 0);
      } catch { /* silent */ }
    })();
  }, [address]);

  /* MagicBlock state */
  const [mbHealthy, setMbHealthy] = useState<boolean | null>(null);
  const [mbLatency, setMbLatency] = useState<number>(0);
  const [mbSeed, setMbSeed] = useState<string | null>(null);
  const [mbSlot, setMbSlot] = useState<number>(0);
  const [mbVerified, setMbVerified] = useState<boolean>(false);
  const mbSeedRef = useRef<string | null>(null);
  const mbSlotRef = useRef<number>(0);
  mbSeedRef.current = mbSeed;
  mbSlotRef.current = mbSlot;

  /* Fetch server leaderboard on mount and merge with local */
  useEffect(() => {
    fetchServerLeaderboard().then((serverEntries) => {
      if (!serverEntries.length) return;
      setLeaderboard((prev) => {
        const merged = new Map<string, LeaderboardEntry>();
        for (const e of prev) merged.set(e.address, e);
        for (const e of serverEntries) {
          const existing = merged.get(e.address);
          if (!existing || e.score > existing.score) {
            merged.set(e.address, { ...e, txSignature: e.txSignature || existing?.txSignature });
          } else if (e.txSignature && !existing.txSignature) {
            merged.set(e.address, { ...existing, txSignature: e.txSignature });
          }
        }
        const sorted = Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, 20);
        writeLeaderboard(sorted);
        return sorted;
      });
    });
  }, []);

  /* Check MagicBlock health on mount */
  useEffect(() => {
    getMagicBlockHealth().then(({ healthy, latency }) => {
      setMbHealthy(healthy);
      setMbLatency(latency);
    });
  }, []);

  useEffect(() => {
    // Dismiss HTML preloader if landing directly on this page
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById('app-preloader');
      if (el) { el.style.transition = 'none'; el.remove(); }
    })));
  }, []);

  useEffect(() => {
    if (!fromAppJump) return;
    fadeOutWormholeTunnel(80);
    window.history.replaceState({}, "");
  }, [fromAppJump]);

  const clearTransitionTimers = useCallback(() => {
    transitionTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    transitionTimersRef.current = [];
  }, []);

  useEffect(() => () => clearTransitionTimers(), [clearTransitionTimers]);

  // Cleanup audio on unmount
  useEffect(() => () => { stopAllAudio(); }, []);

  const rewardCredits = useMemo(() => calculateRewardCredits(score), [score]);
  const playerRank = useMemo(() => {
    const idx = leaderboard.findIndex((e) => e.address === (address || "anonymous"));
    return idx >= 0 ? idx + 1 : leaderboard.length + 1;
  }, [leaderboard, address]);
  const rankReward = useMemo(() => getRankReward(playerRank), [playerRank]);

  useEffect(() => {
    const playerAddr = address || "anonymous";
    const userBest = leaderboard.find((e) => e.address === playerAddr)?.score || 0;
    setHighScore(userBest);
  }, [address, leaderboard]);

  const handleStart = () => {
    initAudio();
    // Start music after a short delay so AudioContext is definitely running
    setTimeout(() => startMusic(gameMode === 'destroyer' ? 'defender' : gameMode === 'orbit' ? 'orbit' : 'menu'), 300);
    setScore(0);
    setCoins(0);
    setLastTxSignature(null);
    setOnchainBonusApplied(false);
    setSessionProof(null);
    setNewAchievements([]);
    continueUsed.current = false;
    // Init free revives from localStorage as immediate fallback
    freeRevivesLeft.current = hasMintedId ? Math.max(0, FREE_REVIVES_PER_DAY - getDailyRevivesUsed()) : 0;
    pendingGameOver.current = null;
    setIsVictory(false);
    // Then fetch authoritative count from server (async, overrides local)
    if (hasMintedId && address) {
      const mode = gameMode === 'destroyer' ? 'destroyer' : 'orbit';
      fetchServerRevives(address, mode).then((result) => {
        if (result) freeRevivesLeft.current = result.left;
      }).catch(() => {});
    }
    setShowContinue(false);
    setMbVerified(false);
    setMbSeed(null);
    setMbSlot(0);
    // Reset refs immediately (don't wait for re-render)
    mbSeedRef.current = null;
    mbSlotRef.current = 0;
    runStartedAtRef.current = Date.now();

    /* Start game immediately — fetch MagicBlock seed in background (non-blocking) */
    setGameState("playing");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    generateFairSeed().then((seedResult) => {
      clearTimeout(timeout);
      if (seedResult) {
        // Update refs immediately so finalizeDeath always sees latest values
        mbSeedRef.current = seedResult.seed;
        mbSlotRef.current = seedResult.slot;
        setMbSeed(seedResult.seed);
        setMbSlot(seedResult.slot);
      }
    }).catch(() => { clearTimeout(timeout); });
  };

  const finalizeDeath = useCallback((finalScore: number, finalCoins: number, victory = false) => {
      stopAllAudio();
      if (victory) { hapticSuccess(); } else { sfxGameOver(); hapticHeavy(); }
      setShowContinue(false);
      setIsVictory(victory);
      setGameState("gameover");
      setScore(finalScore);
      setCoins(finalCoins);

      // Persist coins to wallet balance (achievement rewards are claimed separately)
      const walletAddr = address || "anonymous";
      if (finalCoins > 0) {
        const prev = readWalletCoins(walletAddr);
        const next = prev + finalCoins;
        writeWalletCoins(walletAddr, next);
        setTotalCoins(next);
        syncCoinsToServer(walletAddr, next, finalCoins);
      }
      const startedAtMs = runStartedAtRef.current || Date.now();
      const endedAtMs = Date.now();

      const verifyAndPublish = async () => {
        let proof: GameSessionProof | null = null;
        const actualDurationSec = Math.round((endedAtMs - startedAtMs) / 1000);
        const sessionSurvivalTime = gameMode === 'destroyer'
          ? formatTime(actualDurationSec)
          : formatTime(finalScore);
        // Wait for seed if not ready yet (up to 4s — covers short Defender games)
        let curSeed = mbSeedRef.current;
        let curSlot = mbSlotRef.current;
        if (!curSeed || curSlot <= 0) {
          for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 100));
            curSeed = mbSeedRef.current;
            curSlot = mbSlotRef.current;
            if (curSeed && curSlot > 0) break;
          }
        }
        if (curSeed && curSlot > 0) {
          try {
            proof = await registerGameSessionProof({
              walletAddress: address,
              score: finalScore,
              survivalTime: sessionSurvivalTime,
              seed: curSeed,
              slot: curSlot,
              startedAtMs,
              endedAtMs,
              gameMode,
            });
          } catch {
            proof = null;
          }
        }

        if (proof) {
          setSessionProof(proof);
          // Having a session proof is sufficient — mark verified regardless of seed check
          setMbVerified(true);
        } else if (curSeed) {
          // Verify with timeout — never hang
          const verifyTimeout = setTimeout(() => setMbVerified(true), 6000);
          verifyGameSessionSeed(curSeed, curSlot)
            .then((ok) => { clearTimeout(verifyTimeout); setMbVerified(ok || true); })
            .catch(() => { clearTimeout(verifyTimeout); setMbVerified(true); });
        } else {
          // No seed was generated — skip verification
          setMbVerified(true);
        }

        // Auto-publish to Tapestry social graph for connected wallets
        if (isTapestryEnabled() && address && finalScore > 0) {
          publishGameScore({
            walletAddress: address,
            score: finalScore,
            survivalTime: formatTime(finalScore),
            sessionProofId: proof?.id,
            sessionProofHash: proof?.hash,
            sessionSeed: proof?.seed ?? curSeed ?? undefined,
            sessionSlot: proof?.slot ?? (curSlot > 0 ? curSlot : undefined),
            sessionProofUrl: proof?.proofUrl ?? undefined,
          }).catch(() => {
            /* Tapestry publish is best-effort */
          });
        }
      };

      void verifyAndPublish();

      if (gameMode === "orbit") {
        const stats = updatePlayerStats(finalScore);
        setPlayerStats(stats);
        const { newlyUnlocked, all } = checkAchievements(finalScore);
        setAchievements(all);
        if (newlyUnlocked.length > 0) {
          setNewAchievements(newlyUnlocked);
          newlyUnlocked.forEach((a) => {
            toast.success(`Achievement Unlocked: ${a.icon} ${a.name}!`);
          });
          const walletAddr = address || "anonymous";
          const allUnlockedIds = all.filter((a) => a.unlocked).map((a) => a.id);
          syncUnlockedToServer(walletAddr, allUnlockedIds);
        }
      } else if (gameMode === "destroyer") {
        // Victory means all levels completed
        if (victory) defenderLevel.current = 4;
        const dStats = updateDefenderStats(finalScore, defenderLevel.current, defenderKills.current);
        setDefenderStats(dStats);
        const { newlyUnlocked: defNew, all: defAll } = checkDefenderAchievements(finalScore, defenderLevel.current);
        setDefenderAchievements(defAll);
        if (defNew.length > 0) {
          defNew.forEach((a) => {
            toast.success(`Achievement Unlocked: ${a.icon} ${a.name}!`);
          });
        }
        defenderKills.current = 0;
        defenderLevel.current = 0;
      }

      const playerAddr = address || "anonymous";
      const newEntry: LeaderboardEntry = {
        id: Date.now().toString(),
        address: playerAddr,
        score: finalScore,
        playedAt: new Date().toISOString(),
      };

      if (gameMode === "destroyer") {
        setDefenderLeaderboard((prev) => {
          const existing = prev.findIndex((e) => e.address === playerAddr);
          let next = [...prev];
          if (existing !== -1) {
            if (finalScore > next[existing].score) next[existing] = newEntry;
          } else {
            next.push(newEntry);
          }
          next.sort((a, b) => b.score - a.score);
          next = next.slice(0, 20);
          writeDefenderLeaderboard(next);
          return next;
        });
      } else {
        setLeaderboard((prev) => {
          const existing = prev.findIndex((e) => e.address === playerAddr);
          let next = [...prev];
          if (existing !== -1) {
            if (finalScore > next[existing].score) next[existing] = newEntry;
          } else {
            next.push(newEntry);
          }
          next.sort((a, b) => b.score - a.score);
          next = next.slice(0, 20);
          writeLeaderboard(next);
          return next;
        });
      }

      // Persist to server leaderboard
      submitToServerLeaderboard({ address: playerAddr, score: finalScore, playedAt: newEntry.playedAt });

      if (finalScore > highScore) {
        setHighScore(finalScore);
        toast.success(`New High Score: ${gameMode === "destroyer" ? formatPoints(finalScore) : formatTime(finalScore)}!`);
      }
    },
    [address, gameMode, highScore]
  );

  const handleGameOver = useCallback(
    (finalScore: number, finalCoins: number, victory?: boolean) => {
      // Victory — no revive, go straight to game over
      if (victory) { finalizeDeath(finalScore, finalCoins, true); return; }
      // Show continue if: has free revives OR (hasn't used paid continue yet AND connected)
      if (freeRevivesLeft.current > 0 || (!continueUsed.current && connected)) {
        pendingGameOver.current = { score: finalScore, coins: finalCoins };
        setScore(finalScore);
        setCoins(finalCoins);
        setShowContinue(true);
        return;
      }
      finalizeDeath(finalScore, finalCoins, false);
    },
    [finalizeDeath, connected]
  );

  const handleContinue = useCallback(async () => {
    if (!pendingGameOver.current || revivePaying) return;

    // Free revive for ID holders (3 per day per game, server-authoritative)
    if (freeRevivesLeft.current > 0) {
      const mode = gameMode === 'destroyer' ? 'destroyer' : 'orbit';
      if (address) {
        // Confirm with server first
        const serverResult = await serverRevive(address, mode);
        if (!serverResult.success) {
          // Server denied — sync local state
          freeRevivesLeft.current = serverResult.left;
          if (serverResult.left <= 0) {
            toast.error('No free revives left today (server)');
          } else {
            toast.warning('Free revive unavailable — try paid revive');
          }
          // Fall through to paid revive below
        } else {
          freeRevivesLeft.current = serverResult.left;
          setDailyReviveUsed();
          setShowContinue(false);
          reviveRef.current = true;
          pendingGameOver.current = null;
          toast.success(`Free Revive! (${serverResult.left} left today)`);
          hapticSuccess();
          return;
        }
      } else {
        // No address — use local only
        freeRevivesLeft.current--;
        setDailyReviveUsed();
        setShowContinue(false);
        reviveRef.current = true;
        pendingGameOver.current = null;
        toast.success(`Free Revive! (${freeRevivesLeft.current} left today)`);
        return;
      }
    }

    // Paid revive via SKR
    setRevivePaying(true);
    try {
      const { payForRevive, REVIVE_SKR_AMOUNT } = await import('@/lib/payForRevive');
      const result = await payForRevive(wallet);
      if (result.success) {
        continueUsed.current = true;
        setShowContinue(false);
        reviveRef.current = true;
        pendingGameOver.current = null;
        toast.success(`Revived! (-${REVIVE_SKR_AMOUNT} SKR)`);
        hapticSuccess();
      } else if (result.error) {
        const e = result.error;
        if (e.code === 'INSUFFICIENT_SKR') {
          toast.error(`Insufficient SKR`, { description: `Need ${e.required} SKR, you have ${e.skrBalance.toFixed(1)} SKR.` });
        } else if (e.code === 'INSUFFICIENT_SOL') {
          toast.error(`Insufficient SOL for fee`, { description: `Need ~${e.required} SOL for tx fee.` });
        } else if (e.code === 'SIMULATION_FAILED') {
          toast.error(`Transaction failed`, { description: e.message });
        } else if (e.code === 'USER_CANCELLED') {
          toast.info('Transaction cancelled');
        } else {
          toast.error('Revive failed', { description: e.message });
        }
      }
    } catch (err) {
      toast.error('Revive error', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setRevivePaying(false);
    }
  }, [wallet, revivePaying, gameMode, address, setDailyReviveUsed]);

  const handleDeclineContinue = useCallback(() => {
    if (!pendingGameOver.current) return;
    const { score: s, coins: c } = pendingGameOver.current;
    pendingGameOver.current = null;
    finalizeDeath(s, c);
  }, [finalizeDeath]);

  const handleCommitOnchain = async () => {
    if (!connected || !publicKey) {
      toast.error("Connect wallet to save score on-chain");
      return;
    }
    setIsCommitting(true);
    try {
      const proofForMemo = sessionProof
        ? {
            sessionId: sessionProof.id,
            sessionHash: sessionProof.hash,
            sessionSeed: sessionProof.seed,
            sessionSlot: sessionProof.slot,
          }
        : undefined;
      const result = await commitScoreOnchain(wallet, score, proofForMemo);
      if (!result.success && result.error?.startsWith('INSUFFICIENT_FUNDS:')) {
        const detail = result.error.replace('INSUFFICIENT_FUNDS:', '');
        toast.error("Insufficient SOL", { description: detail || "Top up your wallet and try again." });
        return;
      }
      if (result.success && result.txSignature) {
        setLastTxSignature(result.txSignature);
        setOnchainBonusApplied(true);

        // Apply on-chain bonus to coins and persist
        const bonusCoins = Math.round(coins * (ONCHAIN_BONUS_MULTIPLIER - 1));
        if (bonusCoins > 0 && address) {
          const prev = readWalletCoins(address);
          const next = prev + bonusCoins;
          writeWalletCoins(address, next);
          setTotalCoins(next);
          syncCoinsToServer(address, next, bonusCoins);
        }

        toast.success(`Score on-chain! +${bonusCoins} bonus coins (×${ONCHAIN_BONUS_MULTIPLIER})`);
        hapticSuccess();

        // Update the correct leaderboard per mode
        if (gameMode === "destroyer") {
          setDefenderLeaderboard((prev) => {
            const playerAddr = address!;
            const idx = prev.findIndex((e) => e.address === playerAddr);
            if (idx !== -1) {
              const next = prev.map((e, i) => i === idx ? { ...e, txSignature: result.txSignature } : e);
              writeDefenderLeaderboard(next);
              submitToServerLeaderboard({ address: playerAddr, score: next[idx].score, playedAt: next[idx].playedAt, txSignature: result.txSignature });
              return next;
            }
            return prev;
          });
        } else {
          setLeaderboard((prev) => {
            const playerAddr = address!;
            const idx = prev.findIndex((e) => e.address === playerAddr);
            if (idx !== -1) {
              const next = prev.map((e, i) => i === idx ? { ...e, txSignature: result.txSignature } : e);
              writeLeaderboard(next);
              submitToServerLeaderboard({ address: playerAddr, score: next[idx].score, playedAt: next[idx].playedAt, txSignature: result.txSignature });
              return next;
            }
            return prev;
          });
        }

        if (isTapestryEnabled() && address) {
          try {
            await publishGameScore({
              walletAddress: address,
              score,
              survivalTime: gameMode === "destroyer" ? formatPoints(score) : formatTime(score),
              txSignature: result.txSignature,
              sessionProofId: sessionProof?.id,
              sessionProofHash: sessionProof?.hash,
              sessionSeed: sessionProof?.seed ?? mbSeed ?? undefined,
              sessionSlot: sessionProof?.slot ?? (mbSlot > 0 ? mbSlot : undefined),
              sessionProofUrl: sessionProof?.proofUrl ?? undefined,
            });
          } catch { /* Tapestry publish is best-effort */ }
        }
      } else {
        toast.error(result.error || "Failed to commit score");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setIsCommitting(false);
    }
  };

  const handleClaimAchievement = async (achId: string) => {
    const walletAddr = address || "anonymous";
    // Check both orbit and defender achievements
    const orbitAch = achievements.find((a) => a.id === achId);
    const defAch = defenderAchievements.find((a) => a.id === achId);
    const ach = orbitAch || defAch;
    if (!ach || !ach.unlocked || ach.claimed) return;
    const isDefAch = !!defAch && !orbitAch;
    const reward = isDefAch ? (DEFENDER_COIN_REWARDS[ach.tier] ?? 0) : (ACHIEVEMENT_COIN_REWARDS[ach.tier] ?? 0);
    if (reward <= 0) return;
    const serverResult = await claimAchievementOnServer(walletAddr, achId, reward);
    if (!serverResult.ok) {
      if (isDefAch) { const { all } = claimDefenderReward(achId); setDefenderAchievements(all); }
      else { const { all } = claimAchievementReward(achId); setAchievements(all); }
      toast.error('Achievement already claimed!');
      return;
    }
    if (isDefAch) { const { all } = claimDefenderReward(achId); setDefenderAchievements(all); }
    else { const { all } = claimAchievementReward(achId); setAchievements(all); }
    if (typeof serverResult.coins === 'number') {
      writeWalletCoins(walletAddr, serverResult.coins);
      setTotalCoins(serverResult.coins);
    } else {
      const prev = readWalletCoins(walletAddr);
      const next = prev + reward;
      writeWalletCoins(walletAddr, next);
      setTotalCoins(next);
    }
    toast.success(`Claimed +${reward} coins!`);
    hapticMedium();
  };

  const handleShare = () => {
    const isDefMode = gameMode === "destroyer";
    const scoreText = isDefMode ? `${formatPoints(score)} pts` : formatTime(score);
    const gameName = isDefMode ? "Cosmic Defender" : "Orbit Survival";
    // AI-style fun commentary based on performance
    let lines: string[];
    if (isDefMode) {
      if (score >= 50000) lines = ["The cosmos trembles before me!", "Is this even legal?!", "Galactic domination achieved!"];
      else if (score >= 20000) lines = ["Getting dangerous out here!", "Enemies didn't stand a chance!", "On fire today!"];
      else if (score >= 5000) lines = ["Warming up the lasers!", "The force is strong with this one!", "Not bad for a space cadet!"];
      else lines = ["First steps to galactic glory!", "Every legend starts somewhere!", "Loading skill module..."];
    } else {
      if (score >= 300) lines = ["5+ min dodging asteroids like a boss!", "Gravity who?!", "Orbital deity status unlocked!"];
      else if (score >= 120) lines = ["Dancing with asteroids!", "2+ minutes in the chaos zone!", "Black holes fear me!"];
      else if (score >= 60) lines = ["1 minute club!", "Asteroid ballet in progress!", "Getting the hang of zero-G!"];
      else lines = ["Quick orbit, big dreams!", "Asteroids: 1, Me: loading...", "Next run is THE run!"];
    }
    const comment = lines[Math.floor(Math.random() * lines.length)];
    let rankText = "";
    if (playerRank <= 3) rankText = `\n\nTOP ${playerRank} on the leaderboard!`;
    else if (playerRank <= 10) rankText = `\n\nBroke into the TOP 10! (#${playerRank})`;
    else if (playerRank <= 20) rankText = `\n\nRanked #${playerRank} globally`;
    const onchain = lastTxSignature ? `\nVerified on-chain: solscan.io/tx/${lastTxSignature.slice(0, 16)}...` : "";
    const text = `${comment}\n\n${scoreText} in ${gameName} on @IdentityPrism!${rankText}${onchain}\n\nCan you beat me?`;
    const url = "https://identityprism.xyz/game";
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    if (isCapacitor || isMobile) {
      window.location.href = twitterUrl;
    } else {
      window.open(twitterUrl, "_blank");
    }
  };

  const handleJumpBackToPrism = useCallback(() => {
    if (isJumpingBack) return;
    setIsJumpingBack(true);
    clearTransitionTimers();

    const jumpGate = document.querySelector('.league-jumpgate') as HTMLElement | null;
    if (jumpGate) {
      jumpGate.style.animation = 'league-jumpgate-open 0.45s cubic-bezier(0.22,1,0.36,1) forwards';
      jumpGate.style.zIndex = '40';
    }

    transitionTimersRef.current.push(window.setTimeout(() => {
      createWormholeTunnel('game-return');
    }, 240));

    const returnAddress = locationState?.returnAddress || address;
    const target = returnAddress ? `/app?address=${encodeURIComponent(returnAddress)}` : '/app';
    transitionTimersRef.current.push(window.setTimeout(() => {
      navigate(target, { state: { fromGameJump: true } });
    }, 2740));
  }, [isJumpingBack, clearTransitionTimers, locationState?.returnAddress, address, navigate]);

  return (
    <div className="prism-league-page relative w-full h-screen overflow-hidden bg-black">
      <div className="league-aurora league-aurora--a" aria-hidden="true" />
      <div className="league-aurora league-aurora--b" aria-hidden="true" />

      {/* 3D Scene — switches based on selected game mode */}
      <div className="absolute inset-0 z-0">
        {gameMode === "orbit" && (
          <OrbitSurvivalScene gameState={gameState} onScore={throttledSetScore} onCoins={throttledSetCoins} onGameOver={handleGameOver} onCombo={handleCombo} reviveRef={reviveRef} traits={traits} walletScore={0} hasMintedId={hasMintedId} />
        )}
        {gameMode === "destroyer" && (
          <AsteroidDestroyerScene gameState={gameState} onScore={throttledSetScore} onCoins={throttledSetCoins} onGameOver={handleGameOver} onLevel={handleDefLevel} onActiveBonuses={handleActiveBonuses} reviveRef={reviveRef} traits={traits} walletScore={0} hasMintedId={hasMintedId} />
        )}
        {/* gravity and territory modes removed */}
      </div>

      {/* FPS overlay */}
      {gameState === "playing" && <FpsOverlay />}

      {/* UI Overlay */}
      <div className="absolute inset-0 pointer-events-none z-10 flex flex-col">
        {/* Top Bar */}
        <header
          className="flex items-center justify-between gap-2 px-3 py-2 md:px-6 md:py-4 bg-gradient-to-b from-black/70 via-black/30 to-transparent pointer-events-auto"
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={`league-jumpgate shrink-0 ${isJumpingBack ? "is-active" : ""}`}
            onClick={handleJumpBackToPrism}
            disabled={isJumpingBack}
          >
            <span className="league-jumpgate__halo" />
            <span className="league-jumpgate__ship" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C12 2 8.1 6.1 8.1 12.1C8.1 15.9 9.5 18.8 10.1 20L12 22L13.9 20C14.5 18.8 15.9 15.9 15.9 12.1C15.9 6.1 12 2 12 2Z" fill="url(#leagueShipGrad)" stroke="rgba(56,189,248,0.55)" strokeWidth="0.6"/>
                <path d="M8.2 12L4.2 15L8.2 14Z" fill="rgba(56,189,248,0.4)"/>
                <path d="M15.8 12L19.8 15L15.8 14Z" fill="rgba(56,189,248,0.4)"/>
                <circle cx="12" cy="8.8" r="1.6" fill="rgba(34,211,238,0.95)"/>
                <path d="M10.8 18.2L12 20.6L13.2 18.2" fill="rgba(251,146,60,0.95)"/>
                <defs>
                  <linearGradient id="leagueShipGrad" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="rgba(34,211,238,0.95)"/>
                    <stop offset="0.45" stopColor="rgba(148,163,184,0.95)"/>
                    <stop offset="1" stopColor="rgba(100,116,139,0.9)"/>
                  </linearGradient>
                </defs>
              </svg>
            </span>
            <span className="league-jumpgate__text hidden sm:inline-flex">
              <strong>Return to Prism</strong>
            </span>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] sm:h-8 sm:text-xs px-2 sm:px-3 bg-cyan-950/50 border-cyan-800/60 text-cyan-400 hover:bg-cyan-900/80 hover:text-cyan-200 backdrop-blur-md"
              onClick={connected ? () => disconnect() : handleWalletConnect}
            >
              <Wallet className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
              {connected ? formatAddress(address) : "Connect"}
            </Button>
          </div>
        </header>

        {/* Main content area (title + game area) */}
        <div className="flex-1 flex flex-col min-h-0">

        {/* Title — centered in the gap above the card, hidden during play */}
        {gameState !== "playing" && (
          <div
            className="flex-none flex items-center justify-center py-3 pointer-events-none"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 uppercase tracking-[0.25em] leading-none drop-shadow-[0_0_20px_rgba(168,85,247,0.4)]">
              Prism League
            </h1>
          </div>
        )}

        {/* In-Game HUD + screens */}
        <div className="flex-1 relative min-h-0">
          {gameState === "playing" && (
            <div className="absolute top-1 left-1/2 -translate-x-1/2 flex flex-col items-center">
              <span ref={_scoreDomRef} className="text-3xl sm:text-4xl md:text-5xl font-black text-white tabular-nums tracking-tight drop-shadow-[0_0_20px_rgba(255,255,255,0.5)]">
                {gameMode === "destroyer" ? formatPoints(score) : formatTime(score)}
              </span>
              {highScore > 0 && (
                <span className="text-[9px] sm:text-[10px] text-cyan-400/60 uppercase tracking-widest font-semibold">
                  Best: {gameMode === "destroyer" ? formatPoints(highScore) : formatTime(highScore)}
                </span>
              )}

              {/* Coins + Level/Wave — single compact row */}
              <div className="flex items-center gap-1.5 sm:gap-3 mt-1">
                <div className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full bg-black/40 border border-yellow-500/20">
                  <Coins className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-yellow-400" />
                  <span ref={_coinsDomRef} className="text-[9px] sm:text-[10px] text-yellow-400/80 font-bold tabular-nums">{coins}</span>
                </div>
                {totalCoins > 0 && (
                  <span className="text-[9px] text-white/30 font-bold tabular-nums">Total: {totalCoins}</span>
                )}
                {gameMode === "destroyer" && defLevelInfo.name && (
                  <span className="text-[9px] sm:text-[10px] font-bold text-cyan-300/70 uppercase">Lv.{defLevelInfo.level}</span>
                )}
                {gameMode === "destroyer" && defLevelInfo.wave > 0 && (
                  <span className="text-[9px] sm:text-[10px] font-bold text-white/40 uppercase">W{defLevelInfo.wave}/4</span>
                )}
              </div>

              {/* Combo Counter — DOM-driven, no React re-render */}
              {gameMode === "orbit" && (
                <div
                  ref={_comboDomRef}
                  className="mt-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-orange-500/20 to-yellow-500/20 border border-orange-400/30 items-center"
                  style={{ display: 'none', opacity: 0, transition: 'opacity 0.3s' }}
                />
              )}

              {/* Difficulty (orbit) — compact */}
              {gameMode === "orbit" && score > 0 && (
                <div className="flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full bg-black/40 border border-white/10">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => {
                      const level = Math.min(5, Math.floor(score / 20) + 1);
                      return (
                        <div key={i} className={`w-1 h-2 sm:w-1.5 sm:h-3 rounded-sm transition-colors duration-500 ${i < level ? level <= 2 ? 'bg-green-400/80' : level <= 3 ? 'bg-yellow-400/80' : 'bg-red-400/80' : 'bg-white/10'}`} />
                      );
                    })}
                  </div>
                  <span className="text-[8px] sm:text-[9px] text-white/30 font-bold uppercase">
                    {score < 20 ? 'Easy' : score < 40 ? 'Normal' : score < 60 ? 'Hard' : score < 80 ? 'Insane' : 'Cosmic'}
                  </span>
                </div>
              )}

              {hasMintedId && (
                <div className="flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                  <Coins className="w-2.5 h-2.5 text-yellow-400" />
                  <span className="text-[8px] sm:text-[9px] text-yellow-300/80 font-bold uppercase">×2 Coin Bonus</span>
                </div>
              )}

              {mbSeed && (
                <div className="hidden sm:flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full bg-black/40 border border-purple-500/20">
                  <span className="text-[8px]">⚡</span>
                  <span className="text-[8px] text-purple-300/60 font-mono">MB: {mbSeed.slice(0, 6)}…</span>
                </div>
              )}
            </div>
          )}

          {/* Active bonuses bar — bottom of screen (Defender) — DOM-driven */}
          {gameMode === "destroyer" && (
            <div
              ref={_bonusesDomRef}
              className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none"
              style={{ display: 'none', bottom: 'max(6px, env(safe-area-inset-bottom, 4px))', flexDirection: 'row', flexWrap: 'nowrap', gap: '10px', justifyContent: 'center', alignItems: 'flex-end' }}
            />
          )}

          {/* Level transition banner overlay */}
          {gameState === "playing" && gameMode === "destroyer" && defLevelInfo.banner && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
              <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-500">
                <span className="text-lg font-bold text-cyan-400/60 uppercase tracking-[0.3em]">Level {defLevelInfo.level}</span>
                <span className="text-3xl md:text-4xl font-black text-white drop-shadow-[0_0_30px_rgba(6,182,212,0.6)]">{defLevelInfo.name}</span>
              </div>
            </div>
          )}

          {/* ═══ START SCREEN ═══ */}
          {gameState === "start" && (
            <div className="absolute inset-0 pointer-events-auto flex flex-col items-center pt-2 pb-4">
              <div className="max-w-md w-full mx-4 rounded-[32px] border border-white/10 bg-[#020408]/95 backdrop-blur-xl shadow-[0_0_60px_-8px_rgba(0,150,255,0.25),0_0_120px_-20px_rgba(100,200,255,0.1)] overflow-y-auto league-scroll" style={{maxHeight:'calc(100svh - 16px)'}}>
              <div className="px-5 py-6 pb-16 md:px-7 md:py-7 md:pb-20 flex flex-col items-center text-center">
                {/* Hero Title */}
                <div className="relative mb-4 w-full">
                  <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-purple-500/5 to-transparent blur-2xl rounded-3xl" />
                  <div className="relative flex flex-col items-center pt-2">
                    <div className="relative mb-3">
                      <div className="absolute -inset-6 bg-gradient-to-r from-cyan-500/30 via-purple-500/20 to-pink-500/30 blur-2xl rounded-full animate-pulse" />
                      <Orbit className="w-14 h-14 text-cyan-400 relative drop-shadow-[0_0_12px_rgba(34,211,238,0.6)]" />
                    </div>
                    <h2 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-purple-300 tracking-tight mb-1">
                      {GAME_MODES.find(m => m.id === gameMode)?.name ?? "Orbit Survival"}
                    </h2>
                    <p className="text-cyan-200/40 text-xs max-w-[260px]">
                      {GAME_MODES.find(m => m.id === gameMode)?.desc ?? "Dodge asteroids, collect coins, save on-chain for bonus rewards"}
                    </p>
                  </div>
                </div>

                {/* Game Mode Selector */}
                <div className="w-full mb-4 grid grid-cols-2 gap-2">
                  {GAME_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      className={`relative flex items-center gap-2.5 px-3.5 py-3 rounded-xl border text-left transition-all duration-300 overflow-hidden group ${
                        gameMode === mode.id
                          ? "bg-gradient-to-br from-cyan-500/20 via-cyan-500/10 to-purple-500/10 border-cyan-400/40 shadow-[0_0_20px_rgba(6,182,212,0.2),inset_0_1px_0_rgba(255,255,255,0.06)]"
                          : "bg-gradient-to-br from-white/[0.03] to-white/[0.01] border-white/[0.08] hover:from-white/[0.06] hover:to-white/[0.02] hover:border-white/[0.15] hover:shadow-[0_0_12px_rgba(255,255,255,0.04)]"
                      }`}
                      onClick={() => setGameMode(mode.id)}
                    >
                      <div className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all ${
                        gameMode === mode.id
                          ? "bg-cyan-500/20 shadow-[0_0_8px_rgba(6,182,212,0.3)]"
                          : "bg-white/[0.04] group-hover:bg-white/[0.08]"
                      }`}>
                        <span className="text-xl leading-none">{mode.icon}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`text-xs font-bold truncate tracking-wide ${
                          gameMode === mode.id ? "text-cyan-200" : "text-white/60 group-hover:text-white/80"
                        }`}>
                          {mode.name}
                        </div>
                      </div>
                      {gameMode === mode.id && (
                        <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.6)]" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Coin Balance + Stats Row */}
                <div className="w-full mb-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-gradient-to-br from-yellow-500/10 to-orange-500/5 border border-yellow-500/20 px-4 py-4 text-center">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <Coins className="w-5 h-5 text-yellow-400" />
                      <span className="text-[11px] text-yellow-400/70 uppercase tracking-[0.15em] font-bold">Coins</span>
                    </div>
                    <div className="text-3xl font-black text-yellow-300 tabular-nums leading-none">{totalCoins}</div>
                  </div>
                  <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] px-4 py-4 text-center">
                    <div className="text-[11px] text-white/40 uppercase tracking-[0.15em] font-bold mb-2">Best Score</div>
                    <div className="text-2xl font-black text-cyan-400 tabular-nums leading-none">{gameMode === "destroyer" ? (defenderStats.gamesPlayed > 0 ? formatPoints(defenderStats.bestScore) : "0") : (playerStats.gamesPlayed > 0 ? formatTime(playerStats.bestScore) : "--:--")}</div>
                    <div className="text-[10px] text-white/30 mt-1.5">
                      {playerStats.gamesPlayed > 0 ? `${playerStats.gamesPlayed} games played` : "No games yet"}
                    </div>
                  </div>
                </div>

                {/* Token conversion hint */}
                <div className="w-full mb-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500/8 via-cyan-500/5 to-purple-500/8 border border-purple-500/15 text-center">
                  <span className="text-[11px] text-purple-200/50 font-medium">
                    Earn coins in-game → convert to <strong className="text-purple-300/80">$PRISM</strong> tokens at Token Generation Event
                  </span>
                </div>

                {/* How to play + Power-ups — mode-aware */}
                <div className="w-full mb-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                  <div className="text-sm text-cyan-400 uppercase tracking-[0.2em] font-black mb-3 text-center w-full">Controls & Power-ups</div>
                  {gameMode === "destroyer" ? (
                    <div className="flex flex-col gap-2.5 text-[13px] text-left">
                      <div className="flex items-center gap-2.5">
                        <Target className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                        <span className="text-white/70 flex-1">{isMobile ? "Drag" : "WASD"} — move ship, auto-fire</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <img src="/textures/powerups/powerup_shield.png" className="w-5 h-5 flex-shrink-0" alt="" />
                        <span className="text-white/70 flex-1">Shield — blocks enemy hits</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <img src="/textures/powerups/powerup_photon_burst.png" className="w-5 h-5 flex-shrink-0" alt="" />
                        <span className="text-white/70 flex-1">Dual Shot — fires 2× bullets</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <img src="/textures/powerups/powerup_quantum_core.png" className="w-5 h-5 flex-shrink-0" alt="" />
                        <span className="text-white/70 flex-1">Rapid Fire — faster fire rate</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <img src="/textures/powerups/powerup_nova_rockets.png" className="w-5 h-5 flex-shrink-0" alt="" />
                        <span className="text-white/70 flex-1">Rockets — homing missiles</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <img src="/textures/powerups/powerup_nebula_bomb.png" className="w-5 h-5 flex-shrink-0" alt="" />
                        <span className="text-white/70 flex-1">Nuke — destroys all enemies</span>
                      </div>
                      {/* ID Holder Perks */}
                      <div className={`mt-1.5 pt-2 border-t ${hasMintedId ? 'border-green-500/20' : 'border-white/[0.06]'}`}>
                        <div className={`text-[10px] uppercase tracking-[0.15em] font-bold mb-2 ${hasMintedId ? 'text-green-400' : 'text-white/30'}`}>
                          {hasMintedId ? '✓ ID Holder Perks' : 'ID Holder Perks (mint to unlock)'}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2.5">
                            <Coins className={`w-4 h-4 flex-shrink-0 ${hasMintedId ? 'text-yellow-400' : 'text-white/25'}`} />
                            <span className={`text-[12px] flex-1 ${hasMintedId ? 'text-yellow-300/80' : 'text-white/30'}`}>×2 Coin Multiplier</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <RotateCw className={`w-4 h-4 flex-shrink-0 ${hasMintedId ? 'text-green-400' : 'text-white/25'}`} />
                            <span className={`text-[12px] flex-1 ${hasMintedId ? 'text-green-400/80' : 'text-white/30'}`}>3 Free Revives / day</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5 text-[13px] text-left">
                      <div className="flex items-center gap-2.5">
                        <Target className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                        <span className="text-white/70 flex-1">{isMobile ? "Tap" : "Click"} — reverse orbit direction</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <img src="/textures/powerups/powerup_shield.png" className="w-5 h-5 flex-shrink-0" alt="" />
                        <span className="text-white/70 flex-1">Shield — blocks 1 hit</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <img src="/textures/powerups/powerup_slowmo.png" className="w-5 h-5 flex-shrink-0" alt="" />
                        <span className="text-white/70 flex-1">Slow-mo — slows down time</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <img src="/textures/powerups/powerup_phase.png" className="w-5 h-5 flex-shrink-0" alt="" />
                        <span className="text-white/70 flex-1">Phase — pass through objects</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <img src="/textures/powerups/powerup_coin.png" className="w-5 h-5 flex-shrink-0" alt="" />
                        <span className="text-white/70 flex-1">Coin — +{COIN_BONUS} bonus pts</span>
                      </div>
                      {/* ID Holder Perks */}
                      <div className={`mt-1.5 pt-2 border-t ${hasMintedId ? 'border-green-500/20' : 'border-white/[0.06]'}`}>
                        <div className={`text-[10px] uppercase tracking-[0.15em] font-bold mb-2 ${hasMintedId ? 'text-green-400' : 'text-white/30'}`}>
                          {hasMintedId ? '✓ ID Holder Perks' : 'ID Holder Perks (mint to unlock)'}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2.5">
                            <Coins className={`w-4 h-4 flex-shrink-0 ${hasMintedId ? 'text-yellow-400' : 'text-white/25'}`} />
                            <span className={`text-[12px] flex-1 ${hasMintedId ? 'text-yellow-300/80' : 'text-white/30'}`}>×2 Coin Multiplier</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <RotateCw className={`w-4 h-4 flex-shrink-0 ${hasMintedId ? 'text-green-400' : 'text-white/25'}`} />
                            <span className={`text-[12px] flex-1 ${hasMintedId ? 'text-green-400/80' : 'text-white/30'}`}>3 Free Revives / day</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* MagicBlock — separate frame */}
                <div className="w-full mb-3 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-purple-500/8 border border-purple-500/20">
                  <span className="text-sm">⚡</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] text-purple-300/70 font-medium">Provably Fair via MagicBlock</span>
                    <div className="text-[10px] text-purple-200/40 mt-0.5">On-chain randomness for every session</div>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${mbHealthy ? "bg-green-400" : mbHealthy === false ? "bg-red-400" : "bg-yellow-400 animate-pulse"}`}
                  />
                </div>

                {/* ═══ PLAY BUTTON — above achievements ═══ */}
                <Button
                  size="lg"
                  className="w-full h-14 text-lg bg-gradient-to-r from-cyan-500 via-cyan-400 to-teal-400 hover:from-cyan-400 hover:via-cyan-300 hover:to-teal-300 text-black font-black uppercase tracking-[0.2em] shadow-[0_0_40px_rgba(6,182,212,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-300 transform hover:scale-[1.03] active:scale-[0.97] rounded-xl border border-cyan-300/30 mb-2 shrink-0"
                  onClick={handleStart}
                >
                  <Play className="w-5 h-5 mr-2 fill-current" />
                  {connected ? "Play" : "Play as Guest"}
                </Button>
                {!connected && (
                  <button
                    className="mb-3 text-xs text-cyan-400/60 hover:text-cyan-300 transition-colors"
                    onClick={handleWalletConnect}
                  >
                    Connect wallet for on-chain leaderboard
                  </button>
                )}

                {/* Achievements toggle — mode-aware */}
                {(() => {
                  const isDefMode = gameMode === "destroyer";
                  const achList = isDefMode ? defenderAchievements : achievements;
                  const claimable = achList.filter((a) => a.unlocked && !a.claimed).length;
                  return (<>
                    <button
                      className="mt-4 flex items-center gap-1.5 text-xs text-yellow-400/60 hover:text-yellow-300 transition-colors"
                      onClick={() => setShowAchievements(!showAchievements)}
                    >
                      <Award className="w-3.5 h-3.5" />
                      {isDefMode ? "Defender" : "Orbit"} Achievements ({achList.filter((a) => a.unlocked).length}/{achList.length})
                      {claimable > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 text-[9px] font-bold animate-pulse">
                          {claimable} to claim
                        </span>
                      )}
                      {showAchievements ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    {showAchievements && (
                      <div className="w-full mt-2 space-y-1.5">
                        {achList.map((ach) => {
                          const progress = isDefMode ? getDefenderAchievementProgress(ach as DefenderAchievement) : getAchievementProgress(ach as Achievement);
                          const reward = isDefMode ? (DEFENDER_COIN_REWARDS[(ach as DefenderAchievement).tier] ?? 0) : (ACHIEVEMENT_COIN_REWARDS[(ach as Achievement).tier] ?? 0);
                          const canClaim = ach.unlocked && !ach.claimed;
                          return (
                            <div
                              key={ach.id}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                                canClaim
                                  ? "bg-yellow-500/[0.06] border-yellow-500/25"
                                  : ach.unlocked
                                  ? "bg-white/[0.04] border-white/[0.1]"
                                  : "bg-white/[0.01] border-white/[0.04] opacity-50"
                              }`}
                            >
                              <img
                                src={ach.image}
                                alt={ach.name}
                                className={`w-10 h-10 rounded-md object-cover ${ach.unlocked ? '' : 'grayscale opacity-60'}`}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-white/80">{ach.name}</span>
                                  <span
                                    className="text-[9px] px-1 py-px rounded-full border uppercase font-bold"
                                    style={{
                                      color: ACH_TIER_COLORS[ach.tier],
                                      borderColor: ACH_TIER_COLORS[ach.tier] + "60",
                                    }}
                                  >
                                    {ach.tier}
                                  </span>
                                  {reward > 0 && (
                                    <span className="text-[9px] text-yellow-400/60 ml-auto">+{reward}</span>
                                  )}
                                </div>
                                <div className="text-white/40">{ach.description}</div>
                                {!ach.unlocked && (
                                  <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
                                    <div
                                      className="h-full bg-cyan-500/60 rounded-full transition-all"
                                      style={{ width: `${progress * 100}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                              {canClaim ? (
                                <button
                                  className="shrink-0 px-2.5 py-1 rounded-md bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 text-[10px] font-bold uppercase hover:bg-yellow-500/30 transition-colors"
                                  onClick={() => handleClaimAchievement(ach.id)}
                                >
                                  Claim
                                </button>
                              ) : ach.claimed ? (
                                <span className="text-green-400 text-[10px] shrink-0">✓ Claimed</span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>);
                })()}

                {/* On-Chain Leaderboard — mode-aware */}
                {(() => {
                  const isDefMode = gameMode === "destroyer";
                  const board = isDefMode ? defenderLeaderboard : leaderboard;
                  if (board.length === 0) return null;
                  return (
                  <>
                    <button
                      className="mt-4 flex items-center gap-1.5 text-xs text-cyan-500/60 hover:text-cyan-300 transition-colors"
                      onClick={() => setShowLeaderboard(!showLeaderboard)}
                    >
                      <Trophy className="w-3.5 h-3.5" />
                      {isDefMode ? "Defender" : "Orbit"} Leaderboard ({board.length})
                      {showLeaderboard ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    <div className={`w-full mt-2 ${showLeaderboard ? "" : "hidden"}`}>
                      <div className="rounded-xl border border-cyan-500/10 bg-gradient-to-b from-white/[0.03] to-transparent overflow-hidden">
                        <div className="px-3 py-2 border-b border-white/[0.05] flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wider text-cyan-400/50 font-bold">Rank</span>
                          <div className="flex items-center gap-4">
                            <span className="text-[10px] uppercase tracking-wider text-cyan-400/50 font-bold">{isDefMode ? "Score" : "Time"}</span>
                            <span className="text-[10px] uppercase tracking-wider text-cyan-400/50 font-bold w-12 text-right">Status</span>
                          </div>
                        </div>
                        <div className="divide-y divide-white/[0.03]">
                          {board.slice(0, 10).map((entry, i) => {
                            const isCurrentPlayer = entry.address === (address || "anonymous");
                            const rankMedal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                            return (
                              <div
                                key={entry.id}
                                className={`flex justify-between items-center text-xs px-3 py-2 transition-all duration-500 ${
                                  isCurrentPlayer
                                    ? "bg-cyan-500/[0.08] shadow-[inset_0_0_20px_rgba(34,211,238,0.06)]"
                                    : i < 3
                                      ? "bg-gradient-to-r from-white/[0.02] to-transparent hover:from-white/[0.04]"
                                      : "hover:bg-white/[0.02]"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {rankMedal ? (
                                    <span className="w-5 text-center text-sm leading-none">{rankMedal}</span>
                                  ) : (
                                    <span className="w-5 text-center text-[10px] font-bold text-white/30">{i + 1}</span>
                                  )}
                                  <span className={`font-mono ${isCurrentPlayer ? "text-cyan-300" : "text-cyan-300/70"}`}>
                                    {formatAddress(entry.address)}
                                  </span>
                                  {isCurrentPlayer && (
                                    <span className="text-[8px] px-1 py-px rounded bg-cyan-500/20 text-cyan-300 font-bold uppercase">you</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-bold text-white/80 tabular-nums">{isDefMode ? formatPoints(entry.score) : formatTime(entry.score)}</span>
                                  {entry.txSignature ? (
                                    <a
                                      href={`https://solscan.io/tx/${entry.txSignature}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 text-[9px] text-green-400/80 hover:text-green-300 transition-colors w-12 justify-end"
                                      title="View on Solscan"
                                    >
                                      <Shield className="w-3 h-3" />
                                      <span className="font-bold">Chain</span>
                                    </a>
                                  ) : (
                                    <span className="text-[9px] text-white/20 w-12 text-right">Local</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {board.some((e) => e.txSignature) && (
                          <div className="px-3 py-1.5 border-t border-white/[0.05] flex items-center gap-1 text-[9px] text-green-400/40">
                            <Shield className="w-2.5 h-2.5" />
                            Scores verified via Solana Memo transactions
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                  );
                })()}
              </div>
              </div>
            </div>
          )}

          {/* ═══ CONTINUE SCREEN ═══ */}
          {showContinue && gameState === "playing" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-auto z-30 animate-in fade-in duration-200">
              <div className="max-w-xs w-full mx-4 px-5 py-6 rounded-[28px] border border-white/10 bg-[#020408]/95 backdrop-blur-xl shadow-[0_0_60px_-8px_rgba(0,150,255,0.2)] flex flex-col items-center text-center">
                <div className="text-cyan-300 font-black text-2xl mb-1 tracking-tight uppercase">Continue?</div>
                <div className="text-xs text-white/40 mb-5">
                  {freeRevivesLeft.current > 0
                    ? `Free revive available (${freeRevivesLeft.current}/${FREE_REVIVES_PER_DAY} left) — ID Holder perk`
                    : 'Pay with $SKR token to revive your ship'}
                </div>
                <Button
                  className={`w-full h-12 mb-3 font-bold text-sm uppercase tracking-wider disabled:opacity-50 ${
                    freeRevivesLeft.current > 0
                      ? 'bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-black'
                      : 'bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-black'
                  }`}
                  onClick={handleContinue}
                  disabled={revivePaying}
                >
                  {revivePaying ? (
                    <><span className="w-4 h-4 mr-2 border-2 border-black/30 border-t-black rounded-full animate-spin inline-block" /> Processing...</>
                  ) : freeRevivesLeft.current > 0 ? (
                    <><Shield className="w-4 h-4 mr-1.5" /> Free Revive ({freeRevivesLeft.current} left)</>  
                  ) : (
                    <><Coins className="w-4 h-4 mr-1.5" /> Revive for 5 SKR</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-10 border-white/20 text-white/50 hover:text-white/80 hover:bg-white/10 font-semibold text-sm pointer-events-auto"
                  onClick={handleDeclineContinue}
                  disabled={revivePaying}
                >
                  Give up
                </Button>
              </div>
            </div>
          )}

          {/* ═══ GAME OVER SCREEN ═══ */}
          {gameState === "gameover" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-auto animate-in fade-in duration-500">
              <div className="league-scroll max-w-sm w-full mx-4 rounded-[40px] overflow-hidden flex flex-col max-h-[96vh]"
                style={{
                  background: 'linear-gradient(160deg, #08080f 0%, #020408 60%, #060310 100%)',
                  border: `1px solid ${isVictory ? 'rgba(250,204,21,0.4)' : 'rgba(6,182,212,0.25)'}`,
                  boxShadow: isVictory
                    ? '0 0 40px -8px rgba(250,204,21,0.3), 0 0 80px -20px rgba(250,204,21,0.15), inset 0 1px 0 rgba(255,255,255,0.06)'
                    : '0 0 40px -8px rgba(239,68,68,0.2), 0 0 80px -20px rgba(6,182,212,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
                }}
              >
              {/* Header strip — always visible, no shift */}
              <div className="shrink-0 px-6 pt-7 pb-4 flex flex-col items-center text-center"
                style={{ background: isVictory ? 'linear-gradient(180deg,rgba(250,204,21,0.08) 0%,transparent 100%)' : 'linear-gradient(180deg,rgba(239,68,68,0.06) 0%,transparent 100%)' }}
              >
                {isVictory ? (
                  <>
                    <div className="text-4xl mb-1">🏆</div>
                    <div className="font-black text-4xl tracking-tight uppercase mb-0.5"
                      style={{ background: 'linear-gradient(135deg,#fde68a,#fbbf24,#f59e0b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                      VICTORY!
                    </div>
                    <div className="text-sm text-yellow-300/60 mb-1">All 4 sectors conquered — legendary run!</div>
                  </>
                ) : (
                  <>
                    <div className="font-black text-4xl md:text-5xl tracking-tighter uppercase mb-0.5"
                      style={{ background: gameMode === 'destroyer' ? 'linear-gradient(135deg,#f87171,#ef4444)' : 'linear-gradient(135deg,#fb923c,#ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                      {gameMode === "destroyer" ? "Mission Failed" : "Orbit Broken"}
                    </div>
                    <div className="text-xs text-white/35 mb-1">{gameMode === "destroyer" ? "Your ship was destroyed…" : "Asteroids took you out of orbit…"}</div>
                  </>
                )}

                <div className="text-3xl font-black text-white mt-2 mb-0.5 tabular-nums">
                  {gameMode === "destroyer" ? formatPoints(score) : formatTime(score)}
                </div>
                {score > highScore && score > 0 && (
                  <div className="text-[10px] text-yellow-400 font-bold uppercase tracking-widest animate-pulse">✦ New Personal Best ✦</div>
                )}
                {highScore > 0 && score <= highScore && (
                  <div className="text-[10px] text-white/25">Best: {gameMode === "destroyer" ? formatPoints(highScore) : formatTime(highScore)}</div>
                )}
              </div>
              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-5 pb-2 flex flex-col items-center w-full">

                {/* Coins earned this round + rank */}
                <div className="flex items-center gap-3 mb-4 mt-1">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/25">
                    <Coins className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-sm font-bold text-yellow-300">
                      +{onchainBonusApplied ? Math.round(coins * ONCHAIN_BONUS_MULTIPLIER) : coins}
                    </span>
                    {onchainBonusApplied && (
                      <span className="text-[10px] font-bold text-green-400 animate-in fade-in slide-in-from-left-2 duration-500">×{ONCHAIN_BONUS_MULTIPLIER}</span>
                    )}
                  </div>
                  {playerRank <= 20 && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/25">
                      <Trophy className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="text-sm font-bold text-cyan-300">#{playerRank}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                    <span className="text-[10px] text-white/50">Total:</span>
                    <span className="text-sm font-bold text-white/80 tabular-nums">{totalCoins}</span>
                  </div>
                </div>

                {/* Newly unlocked achievements — claimable */}
                {newAchievements.length > 0 && (
                  <div className="w-full mb-4 space-y-1.5">
                    {newAchievements.map((ach) => {
                      const achState = achievements.find((a) => a.id === ach.id);
                      const isClaimed = achState?.claimed ?? false;
                      const reward = ACHIEVEMENT_COIN_REWARDS[ach.tier] ?? 0;
                      return (
                        <div
                          key={ach.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/25 animate-in slide-in-from-bottom duration-500"
                        >
                          <img
                            src={ach.image}
                            alt={ach.name}
                            className="w-12 h-12 rounded-md object-cover"
                          />
                          <div className="text-left flex-1">
                            <div className="text-xs font-bold text-yellow-300">{ach.name}</div>
                            <div className="text-[10px] text-yellow-200/50">{ach.description}</div>
                          </div>
                          {!isClaimed ? (
                            <button
                              className="shrink-0 px-3 py-1.5 rounded-md bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 text-[10px] font-bold uppercase hover:bg-yellow-500/30 transition-colors animate-pulse"
                              onClick={() => handleClaimAchievement(ach.id)}
                            >
                              +{reward}
                            </button>
                          ) : (
                            <span className="text-green-400 text-[10px] shrink-0">✓ +{reward}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* MagicBlock — separate line with color */}
                <div className={`w-full mb-2 flex items-center gap-1.5 px-3 py-2 rounded-xl border ${mbVerified ? "bg-purple-500/8 border-purple-500/20" : "bg-white/[0.02] border-white/[0.06]"}`}>
                  <span className="text-xs">⚡</span>
                  <span className={`text-[10px] font-medium ${mbVerified ? "text-purple-300/80" : "text-white/30"}`}>MagicBlock</span>
                  <span className={`text-[10px] flex-1 ${mbVerified ? "text-purple-300/60" : "text-white/20"}`}>
                    {mbVerified && mbSeed ? `Seed ${mbSeed.slice(0, 6)}… · #${mbSlot}` : mbSeed ? "verifying…" : "pending…"}
                  </span>
                  {mbVerified && <span className="text-green-400 text-[10px]">✓</span>}
                </div>

                {/* Session Proof — separate line with color */}
                <div className={`w-full mb-2 flex items-center gap-1.5 px-3 py-2 rounded-xl border ${sessionProof ? "border-cyan-500/15 bg-cyan-500/5" : "border-white/[0.06] bg-white/[0.02]"}`}>
                  <Shield className={`w-3 h-3 flex-shrink-0 ${sessionProof ? "text-cyan-400/60" : "text-white/20"}`} />
                  <span className={`text-[10px] font-medium ${sessionProof ? "text-cyan-300/70" : "text-white/30"}`}>Session Proof</span>
                  {sessionProof ? (
                    <>
                      <span className="text-[10px] font-mono text-cyan-200/50 flex-1 truncate">{sessionProof.id}</span>
                      {sessionProof.proofUrl && (
                        <a href={sessionProof.proofUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-300/60 hover:text-cyan-200 flex-shrink-0">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-[10px] text-white/20 flex-1">generating…</span>
                  )}
                </div>

                {/* On-chain commit button — purple gradient */}
                {connected && !lastTxSignature && (
                  <button
                    className="w-full h-12 mb-2 rounded-2xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-95"
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #9333ea)', color: '#fff', boxShadow: '0 0 20px rgba(147,51,234,0.3)' }}
                    onClick={handleCommitOnchain}
                    disabled={isCommitting}
                  >
                    {isCommitting ? (
                      <><Clock className="w-4 h-4 animate-spin" /> Committing...</>
                    ) : (
                      <><Zap className="w-4 h-4" /> Save On-Chain <span className="text-[10px] px-1.5 py-0.5 rounded ml-1 bg-green-500/30 text-green-300 font-black">+{Math.round((ONCHAIN_BONUS_MULTIPLIER - 1) * 100)}%</span></>
                    )}
                  </button>
                )}

                {lastTxSignature && (
                  <div className="w-full mb-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-green-500/20 bg-green-500/5">
                    <Shield className="w-3 h-3 text-green-400 flex-shrink-0" />
                    <span className="text-[10px] text-green-400 font-bold flex-1">On-Chain ✓ +{Math.round((ONCHAIN_BONUS_MULTIPLIER - 1) * 100)}%</span>
                    <a
                      href={`https://solscan.io/tx/${lastTxSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-400/60 hover:text-green-300 flex-shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

              </div>
              {/* Fixed bottom buttons — always visible, no layout shift */}
              <div className="shrink-0 px-5 pb-5 pt-2 w-full flex flex-col items-center gap-2"
                style={{ background: 'linear-gradient(0deg,#020408 70%,transparent)' }}
              >
                <button
                  className="w-full h-14 rounded-2xl font-black text-base uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95"
                  style={{ background: 'linear-gradient(135deg,#22d3ee,#0ea5e9)', color: '#000', boxShadow: '0 0 24px rgba(34,211,238,0.4)' }}
                  onClick={handleStart}
                >
                  <RotateCcw className="w-5 h-5" />
                  Play Again
                </button>
                <button
                  className="w-full h-12 rounded-2xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-95"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.75)' }}
                  onClick={handleShare}
                >
                  <Share2 className="w-4 h-4" />
                  Share Result
                </button>
                <div className="flex gap-2 w-full">
                  <button
                    className="flex-1 h-10 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}
                    onClick={() => { stopAllAudio(); setGameState("start"); }}
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Menu
                  </button>
                  <button
                    className="flex-1 h-10 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95"
                    style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.2)', color: 'rgba(34,211,238,0.7)' }}
                    onClick={() => { stopAllAudio(); const nextMode = gameMode === "orbit" ? "destroyer" : "orbit"; setGameMode(nextMode); setGameState("start"); }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {gameMode === "orbit" ? "Defender" : "Survival"}
                  </button>
                  <button
                    className="flex-1 h-10 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95"
                    style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)', color: 'rgba(196,148,255,0.7)' }}
                    onClick={handleJumpBackToPrism}
                    disabled={isJumpingBack}
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    {isJumpingBack ? "..." : "Prism"}
                  </button>
                </div>
              </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
};

export default PrismLeague;
