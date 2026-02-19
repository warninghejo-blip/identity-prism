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
} from "lucide-react";
import "./PrismLeague.css";
import OrbitSurvivalScene from "@/components/game/OrbitSurvivalScene";
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
import { getHeliusProxyUrl, getAppBaseUrl } from "@/constants";

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
        }
      } else {
        setWalletModalVisible(true);
      }
    } else {
      setWalletModalVisible(true);
    }
  }, [connected, useMobileWallet, isCapacitor, isAndroid, availableWallets, select, connect, setWalletModalVisible]);

  const [gameState, setGameState] = useState<"start" | "playing" | "gameover">("start");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => readLeaderboard());
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

  /* MagicBlock state */
  const [mbHealthy, setMbHealthy] = useState<boolean | null>(null);
  const [mbLatency, setMbLatency] = useState<number>(0);
  const [mbSeed, setMbSeed] = useState<string | null>(null);
  const [mbSlot, setMbSlot] = useState<number>(0);
  const [mbVerified, setMbVerified] = useState<boolean>(false);

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
    setScore(0);
    setCoins(0);
    setLastTxSignature(null);
    setOnchainBonusApplied(false);
    setSessionProof(null);
    setNewAchievements([]);
    setMbVerified(false);
    setMbSeed(null);
    setMbSlot(0);
    runStartedAtRef.current = Date.now();

    /* Start game immediately — fetch MagicBlock seed in background (non-blocking) */
    setGameState("playing");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    generateFairSeed().then((seedResult) => {
      clearTimeout(timeout);
      if (seedResult) {
        setMbSeed(seedResult.seed);
        setMbSlot(seedResult.slot);
      }
    }).catch(() => { clearTimeout(timeout); });
  };

  const handleGameOver = useCallback(
    (finalScore: number, finalCoins: number) => {
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
        if (mbSeed && mbSlot > 0) {
          try {
            proof = await registerGameSessionProof({
              walletAddress: address,
              score: finalScore,
              survivalTime: formatTime(finalScore),
              seed: mbSeed,
              slot: mbSlot,
              startedAtMs,
              endedAtMs,
            });
          } catch {
            proof = null;
          }
        }

        if (proof) {
          setSessionProof(proof);
          setMbVerified(Boolean(proof.verified));
        } else if (mbSeed) {
          verifyGameSessionSeed(mbSeed, mbSlot).then((ok) => setMbVerified(ok));
        }

        // Auto-publish to Tapestry social graph for connected wallets
        if (isTapestryEnabled() && address && finalScore > 0) {
          publishGameScore({
            walletAddress: address,
            score: finalScore,
            survivalTime: formatTime(finalScore),
            sessionProofId: proof?.id,
            sessionProofHash: proof?.hash,
            sessionSeed: proof?.seed ?? mbSeed ?? undefined,
            sessionSlot: proof?.slot ?? (mbSlot > 0 ? mbSlot : undefined),
            sessionProofUrl: proof?.proofUrl ?? undefined,
          }).catch(() => {
            /* Tapestry publish is best-effort */
          });
        }
      };

      void verifyAndPublish();

      const stats = updatePlayerStats(finalScore);
      setPlayerStats(stats);

      const { newlyUnlocked, all } = checkAchievements(finalScore);
      setAchievements(all);
      if (newlyUnlocked.length > 0) {
        setNewAchievements(newlyUnlocked);
        newlyUnlocked.forEach((a) => {
          toast.success(`Achievement Unlocked: ${a.icon} ${a.name}!`);
        });
        // Push all currently unlocked achievements to server (idempotent)
        const walletAddr = address || "anonymous";
        const allUnlockedIds = all.filter((a) => a.unlocked).map((a) => a.id);
        syncUnlockedToServer(walletAddr, allUnlockedIds);
      }

      const playerAddr = address || "anonymous";
      const newEntry: LeaderboardEntry = {
        id: Date.now().toString(),
        address: playerAddr,
        score: finalScore,
        playedAt: new Date().toISOString(),
      };

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

      // Persist to server leaderboard
      submitToServerLeaderboard({ address: playerAddr, score: finalScore, playedAt: newEntry.playedAt });

      if (finalScore > highScore) {
        setHighScore(finalScore);
        toast.success(`New High Score: ${formatTime(finalScore)}!`);
      }
    },
    [address, highScore, mbSeed, mbSlot]
  );

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

        setLeaderboard((prev) => {
          const playerAddr = address!;
          const idx = prev.findIndex((e) => e.address === playerAddr);
          if (idx !== -1) {
            prev[idx].txSignature = result.txSignature;
            const next = [...prev];
            writeLeaderboard(next);
            // Sync txSignature to server
            submitToServerLeaderboard({ address: playerAddr, score: next[idx].score, playedAt: next[idx].playedAt, txSignature: result.txSignature });
            return next;
          }
          return prev;
        });

        if (isTapestryEnabled() && address) {
          try {
            await publishGameScore({
              walletAddress: address,
              score,
              survivalTime: formatTime(score),
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
    // Validate with server first (prevents double-claiming across devices)
    const ach = achievements.find((a) => a.id === achId);
    if (!ach || !ach.unlocked || ach.claimed) return;
    const reward = ACHIEVEMENT_COIN_REWARDS[ach.tier] ?? 0;
    if (reward <= 0) return;
    const serverResult = await claimAchievementOnServer(walletAddr, achId, reward);
    if (!serverResult.ok) {
      // Already claimed on server — mark locally as claimed too
      const { all } = claimAchievementReward(achId);
      setAchievements(all);
      toast.error('Achievement already claimed!');
      return;
    }
    const { all } = claimAchievementReward(achId);
    setAchievements(all);
    // Use server coin balance if available, otherwise compute locally
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
  };

  const handleShare = () => {
    const text = `I survived ${formatTime(score)} in Orbit Survival on @IdentityPrism!${lastTxSignature ? `\n\nVerified on-chain: solscan.io/tx/${lastTxSignature.slice(0, 16)}...` : ""}\n\nCan you beat me? Play now:`;
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
      createWormholeTunnel();
    }, 240));

    const returnAddress = locationState?.returnAddress || address;
    const target = returnAddress ? `/app?address=${encodeURIComponent(returnAddress)}` : '/app';
    transitionTimersRef.current.push(window.setTimeout(() => {
      navigate(target, { state: { fromGameJump: true } });
    }, 1500));
  }, [isJumpingBack, clearTransitionTimers, locationState?.returnAddress, address, navigate]);

  return (
    <div className="prism-league-page relative w-full h-screen overflow-hidden bg-black">
      <div className="league-aurora league-aurora--a" aria-hidden="true" />
      <div className="league-aurora league-aurora--b" aria-hidden="true" />

      {/* 3D Scene */}
      <div className="absolute inset-0 z-0">
        <OrbitSurvivalScene
          gameState={gameState}
          onScore={setScore}
          onCoins={setCoins}
          onGameOver={handleGameOver}
          traits={traits}
          walletScore={score}
        />
      </div>

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
            <div className="absolute top-2 left-1/2 -translate-x-1/2 flex flex-col items-center">
              <span className="text-4xl md:text-5xl font-black text-white tabular-nums tracking-tight drop-shadow-[0_0_20px_rgba(255,255,255,0.5)]">
                {formatTime(score)}
              </span>
              {highScore > 0 && (
                <span className="text-[10px] text-cyan-400/60 uppercase tracking-widest font-semibold mt-0.5">
                  Best: {formatTime(highScore)}
                </span>
              )}

              {/* Coins + Score HUD */}
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm border border-yellow-500/20">
                  <Coins className="w-3 h-3 text-yellow-400" />
                  <span className="text-[10px] text-yellow-400/80 font-bold tabular-nums">
                    {coins}
                  </span>
                </div>
                {totalCoins > 0 && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm border border-white/10">
                    <span className="text-[10px] text-white/40 font-bold tabular-nums">
                      Total: {totalCoins}
                    </span>
                  </div>
                )}
              </div>

              {mbSeed && (
                <div className="flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm border border-purple-500/20">
                  <span className="text-[9px]">⚡</span>
                  <span className="text-[9px] text-purple-300/60 font-mono">
                    MagicBlock Seed: {mbSeed.slice(0, 8)}… · Slot #{mbSlot}
                  </span>
                </div>
              )}

              <span className="text-[10px] text-white/20 mt-2 uppercase tracking-widest">
                {isMobile ? "Tap to reverse orbit" : "Click / Space to reverse orbit"}
              </span>
            </div>
          )}

          {/* ═══ START SCREEN ═══ */}
          {gameState === "start" && (
            <div className="absolute inset-0 pointer-events-auto flex flex-col items-center pt-2 pb-4">
              <div className="max-w-md w-full mx-4 rounded-2xl overflow-hidden border border-cyan-500/20 bg-black/85 backdrop-blur-xl shadow-[0_0_80px_rgba(6,182,212,0.1)]">
              <div className="league-scroll p-6 md:p-8 flex flex-col items-center text-center league-menu-shell overflow-y-auto" style={{maxHeight:'calc(100svh - 112px)'}}>
                {/* Hero Title */}
                <div className="relative mb-4 w-full">
                  <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-purple-500/5 to-transparent blur-2xl rounded-3xl" />
                  <div className="relative flex flex-col items-center pt-2">
                    <div className="relative mb-3">
                      <div className="absolute -inset-6 bg-gradient-to-r from-cyan-500/30 via-purple-500/20 to-pink-500/30 blur-2xl rounded-full animate-pulse" />
                      <Orbit className="w-14 h-14 text-cyan-400 relative drop-shadow-[0_0_12px_rgba(34,211,238,0.6)]" />
                    </div>
                    <h2 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-purple-300 tracking-tight mb-1">
                      Orbit Survival
                    </h2>
                    <p className="text-cyan-200/40 text-xs max-w-[260px]">
                      Dodge asteroids, collect coins, save on-chain for bonus rewards
                    </p>
                  </div>
                </div>

                {/* Coin Balance + Stats Row */}
                <div className="w-full mb-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-gradient-to-br from-yellow-500/10 to-orange-500/5 border border-yellow-500/20 p-3 text-center">
                    <div className="flex items-center justify-center gap-1.5 mb-1">
                      <Coins className="w-4 h-4 text-yellow-400" />
                      <span className="text-[10px] text-yellow-400/80 uppercase tracking-widest font-bold">Coins</span>
                    </div>
                    <div className="text-2xl font-black text-yellow-300 tabular-nums">{totalCoins}</div>
                    <div className="text-[9px] text-yellow-500/50 mt-0.5">
                      {connected ? `On-chain = ×${ONCHAIN_BONUS_MULTIPLIER}` : "Connect wallet to save"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-center">
                    <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Stats</div>
                    <div className="text-lg font-bold text-cyan-400 tabular-nums">{playerStats.gamesPlayed > 0 ? formatTime(playerStats.bestScore) : "--:--"}</div>
                    <div className="text-[9px] text-white/30 mt-0.5">
                      {playerStats.gamesPlayed > 0 ? `${playerStats.gamesPlayed} games` : "No games yet"}
                    </div>
                  </div>
                </div>

                {/* Token conversion hint */}
                <div className="w-full mb-3 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500/5 to-cyan-500/5 border border-purple-500/10 text-center">
                  <span className="text-[10px] text-purple-300/60">
                    Coins will convert to <strong className="text-purple-300/80">$PRISM</strong> tokens at TGE
                  </span>
                </div>

                {/* How to play — compact */}
                <div className="w-full mb-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.05] text-left">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Target className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                      <span className="text-white/60">{isMobile ? "Tap" : "Click"} — reverse orbit</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                      <span className="text-white/60">Shield — block 1 hit</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                      <span className="text-white/60">Clock — slow time</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Coins className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                      <span className="text-white/60">Coin — +{COIN_BONUS} coins</span>
                    </div>
                  </div>
                </div>

                {/* MagicBlock — minimal */}
                <div className="w-full mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/5 border border-purple-500/15">
                  <span className="text-sm">⚡</span>
                  <span className="text-[10px] text-purple-300/60 flex-1">MagicBlock — provably fair seeds</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      mbHealthy ? "bg-green-400" : mbHealthy === false ? "bg-red-400" : "bg-yellow-400 animate-pulse"
                    }`}
                  />
                </div>

                <Button
                  size="lg"
                  className="w-full max-w-xs h-14 text-lg bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-black font-bold uppercase tracking-widest shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all transform hover:scale-[1.02] active:scale-[0.98]"
                  onClick={handleStart}
                >
                  <Play className="w-5 h-5 mr-2 fill-current" />
                  {connected ? "Launch" : "Play as Guest"}
                </Button>

                {!connected && (
                  <button
                    className="mt-3 text-xs text-cyan-400/60 hover:text-cyan-300 transition-colors"
                    onClick={handleWalletConnect}
                  >
                    Connect wallet for on-chain leaderboard
                  </button>
                )}

                {/* Achievements toggle — always visible */}
                {(() => {
                  const claimable = achievements.filter((a) => a.unlocked && !a.claimed).length;
                  return (
                    <button
                      className="mt-4 flex items-center gap-1.5 text-xs text-yellow-400/60 hover:text-yellow-300 transition-colors"
                      onClick={() => setShowAchievements(!showAchievements)}
                    >
                      <Award className="w-3.5 h-3.5" />
                      Achievements ({achievements.filter((a) => a.unlocked).length}/{achievements.length})
                      {claimable > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 text-[9px] font-bold animate-pulse">
                          {claimable} to claim
                        </span>
                      )}
                      {showAchievements ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  );
                })()}
                {showAchievements && (
                  <div className="w-full mt-2 space-y-1.5">
                    {achievements.map((ach) => {
                      const progress = getAchievementProgress(ach);
                      const reward = ACHIEVEMENT_COIN_REWARDS[ach.tier] ?? 0;
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
                            className={`w-10 h-10 rounded-md object-cover border ${ach.unlocked ? 'border-white/20' : 'border-white/5 grayscale'}`}
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

                {/* On-Chain Leaderboard */}
                {leaderboard.length > 0 && (
                  <>
                    <button
                      className="mt-4 flex items-center gap-1.5 text-xs text-cyan-500/60 hover:text-cyan-300 transition-colors"
                      onClick={() => setShowLeaderboard(!showLeaderboard)}
                    >
                      <Trophy className="w-3.5 h-3.5" />
                      On-Chain Leaderboard ({leaderboard.length})
                      {showLeaderboard ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    <div className={`w-full mt-2 ${showLeaderboard ? "" : "hidden"}`}>
                      <div className="rounded-xl border border-cyan-500/10 bg-gradient-to-b from-white/[0.03] to-transparent overflow-hidden">
                        <div className="px-3 py-2 border-b border-white/[0.05] flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wider text-cyan-400/50 font-bold">Rank</span>
                          <div className="flex items-center gap-4">
                            <span className="text-[10px] uppercase tracking-wider text-cyan-400/50 font-bold">Time</span>
                            <span className="text-[10px] uppercase tracking-wider text-cyan-400/50 font-bold w-12 text-right">Status</span>
                          </div>
                        </div>
                        <div className="divide-y divide-white/[0.03]">
                          {leaderboard.slice(0, 10).map((entry, i) => {
                            const isCurrentPlayer = entry.address === (address || "anonymous");
                            const rankMedal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                            return (
                              <div
                                key={entry.id}
                                className={`flex justify-between items-center text-xs px-3 py-2 transition-colors ${
                                  isCurrentPlayer ? "bg-cyan-500/[0.06]" : "hover:bg-white/[0.02]"
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
                                  <span className="font-bold text-white/80 tabular-nums">{formatTime(entry.score)}</span>
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
                        {leaderboard.some((e) => e.txSignature) && (
                          <div className="px-3 py-1.5 border-t border-white/[0.05] flex items-center gap-1 text-[9px] text-green-400/40">
                            <Shield className="w-2.5 h-2.5" />
                            Scores verified via Solana Memo transactions
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              </div>
            </div>
          )}

          {/* ═══ GAME OVER SCREEN ═══ */}
          {gameState === "gameover" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-auto animate-in fade-in duration-300">
              <div className="league-scroll max-w-sm w-full mx-4 p-6 md:p-8 rounded-2xl border border-red-500/20 bg-black/90 backdrop-blur-xl shadow-[0_0_80px_rgba(239,68,68,0.15)] flex flex-col items-center text-center max-h-[85vh] overflow-y-auto league-menu-shell league-menu-shell--danger">
                <div className="text-red-400 font-black text-4xl md:text-5xl mb-1 tracking-tighter uppercase">
                  Orbit Broken
                </div>
                <div className="text-sm text-white/40 mb-4">Asteroids took you out of orbit…</div>

                <div className="text-3xl font-black text-white mb-1 tabular-nums">
                  {formatTime(score)}
                </div>
                {score > highScore && score > 0 && (
                  <div className="text-xs text-yellow-400 font-bold uppercase tracking-widest mb-2 animate-pulse">
                    New Personal Best!
                  </div>
                )}
                {highScore > 0 && score <= highScore && (
                  <div className="text-xs text-white/30 mb-2">Best: {formatTime(highScore)}</div>
                )}

                {/* Coins earned this round + rank */}
                <div className="flex items-center gap-3 mb-4">
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

                {/* MagicBlock verification badge */}
                {mbSeed && (
                  <div
                    className={`w-full mb-3 flex items-center gap-2 px-3 py-2 rounded-lg border ${
                      mbVerified
                        ? "bg-purple-500/10 border-purple-500/25"
                        : "bg-white/[0.02] border-white/[0.06]"
                    }`}
                  >
                    <span className="text-lg">{MAGICBLOCK_BADGE.icon}</span>
                    <div className="text-left flex-1">
                      <div className={`text-xs font-bold ${mbVerified ? "text-purple-300" : "text-white/40"}`}>
                        {MAGICBLOCK_BADGE.name}
                      </div>
                      <div className="text-[10px] text-white/30">
                        {mbVerified
                          ? `Session verified · Seed ${mbSeed.slice(0, 8)}… · Slot #${mbSlot}`
                          : "Verifying session..."}
                      </div>
                    </div>
                    {mbVerified && <span className="text-green-400 text-xs">✓</span>}
                  </div>
                )}

                {sessionProof && (
                  <div className="w-full mb-3 px-3 py-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 text-left">
                    <div className="text-[10px] uppercase tracking-widest text-cyan-300/70 mb-1">Session Proof</div>
                    <div className="text-[10px] font-mono text-cyan-200/70 break-all">{sessionProof.id}</div>
                    {sessionProof.proofUrl && (
                      <a
                        href={sessionProof.proofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[10px] text-cyan-300/80 hover:text-cyan-200"
                      >
                        Open verification endpoint
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}

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
                            className="w-12 h-12 rounded-md object-cover border border-yellow-500/40"
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

                {/* On-chain commit button */}
                {connected && !lastTxSignature && (
                  <Button
                    className="w-full h-10 mb-2 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white font-bold text-sm uppercase tracking-wider"
                    onClick={handleCommitOnchain}
                    disabled={isCommitting}
                  >
                    {isCommitting ? (
                      <>
                        <Clock className="w-4 h-4 mr-1.5 animate-spin" />
                        Committing...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-1.5" />
                        Save On-Chain
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-green-500/30 text-green-300 font-black">+{Math.round((ONCHAIN_BONUS_MULTIPLIER - 1) * 100)}%</span>
                      </>
                    )}
                  </Button>
                )}

                {lastTxSignature && (
                  <div className="w-full mb-3 px-3 py-2 rounded-lg border border-green-500/25 bg-green-500/5 flex flex-col items-center gap-1">
                    <div className="flex items-center gap-2 text-xs text-green-400 font-bold">
                      <Shield className="w-3.5 h-3.5" />
                      On-Chain Verified — {Math.round((ONCHAIN_BONUS_MULTIPLIER - 1) * 100)}% Bonus Applied
                    </div>
                    <a
                      href={`https://solscan.io/tx/${lastTxSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-green-400/60 hover:text-green-300 transition-colors"
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      View on Solscan
                    </a>
                  </div>
                )}

                <div className="flex gap-2.5 w-full mt-1">
                  <Button
                    className="flex-1 h-12 bg-white text-black hover:bg-gray-200 font-bold text-sm"
                    onClick={handleStart}
                  >
                    <RotateCcw className="w-4 h-4 mr-1.5" />
                    Play Again
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-12 border-cyan-800/60 text-cyan-400 hover:bg-cyan-950/50 text-sm"
                    onClick={handleShare}
                  >
                    <Share2 className="w-4 h-4 mr-1.5" />
                    Share
                  </Button>
                </div>
                <button
                  className="mt-3 px-4 py-2 text-sm font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/15 hover:border-white/30 rounded-lg transition-all duration-200"
                  onClick={() => setGameState("start")}
                >
                  ← Back to menu
                </button>
                <button
                  className="league-return-jump"
                  onClick={handleJumpBackToPrism}
                  disabled={isJumpingBack}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  {isJumpingBack ? "Jumping..." : "Hyperjump to Identity Prism"}
                </button>
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
