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

/* ═══════════════════════════════════════════════════
   Constants & types
   ═══════════════════════════════════════════════════ */

const LEADERBOARD_STORAGE_KEY = "identity_prism_orbit_survival_board_v3";

interface LeaderboardEntry {
  id: string;
  address: string;
  score: number;
  playedAt: string;
  txSignature?: string;
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
               (w.readyState === 1 || w.readyState === 2)
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

  const handleStart = async () => {
    setScore(0);
    setLastTxSignature(null);
    setSessionProof(null);
    setNewAchievements([]);
    setMbVerified(false);
    runStartedAtRef.current = Date.now();

    /* Fetch provably fair seed from MagicBlock Ephemeral Rollup */
    const seedResult = await generateFairSeed();
    if (seedResult) {
      setMbSeed(seedResult.seed);
      setMbSlot(seedResult.slot);
    } else {
      setMbSeed(null);
      setMbSlot(0);
    }

    setGameState("playing");
  };

  const handleGameOver = useCallback(
    (finalScore: number) => {
      setGameState("gameover");
      setScore(finalScore);
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
        toast.success("Score committed on-chain!");

        setLeaderboard((prev) => {
          const playerAddr = address!;
          const idx = prev.findIndex((e) => e.address === playerAddr);
          if (idx !== -1) {
            prev[idx].txSignature = result.txSignature;
            const next = [...prev];
            writeLeaderboard(next);
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
    } catch (err: any) {
      toast.error(err?.message || "Transaction failed");
    } finally {
      setIsCommitting(false);
    }
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

          <h1 className="text-sm sm:text-xl md:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 uppercase tracking-tight leading-tight text-center min-w-0 shrink">
            Prism<br className="sm:hidden" />{" "}League
          </h1>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* MagicBlock status indicator */}
            <div
              className="flex items-center gap-1 px-1.5 py-1 rounded-full bg-black/40 backdrop-blur-sm border border-white/10"
              title={
                mbHealthy === null
                  ? "Checking MagicBlock..."
                  : mbHealthy
                  ? `MagicBlock connected (${mbLatency}ms)`
                  : "MagicBlock offline"
              }
            >
              <span className="text-[10px]">⚡</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  mbHealthy === null
                    ? "bg-yellow-400 animate-pulse"
                    : mbHealthy
                    ? "bg-green-400"
                    : "bg-red-400"
                }`}
              />
            </div>
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

        {/* In-Game HUD */}
        <div className="flex-1 relative">
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

              {/* Speed / Reward HUD */}
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm border border-white/10">
                  <Coins className="w-3 h-3 text-yellow-400" />
                  <span className="text-[10px] text-yellow-400/80 font-bold tabular-nums">
                    {calculateRewardCredits(score)} pts
                  </span>
                </div>
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
            <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
              <div className="league-scroll max-w-md w-full mx-4 p-6 md:p-8 rounded-2xl border border-cyan-500/20 bg-black/85 backdrop-blur-xl shadow-[0_0_80px_rgba(6,182,212,0.1)] flex flex-col items-center text-center max-h-[85vh] overflow-y-auto league-menu-shell">
                {/* Title */}
                <div className="relative mb-5">
                  <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20 blur-xl rounded-full" />
                  <Orbit className="w-12 h-12 text-cyan-400 relative animate-pulse" />
                </div>
                <h2 className="text-2xl md:text-3xl font-bold text-white mb-1">Orbit Survival</h2>
                <p className="text-cyan-200/50 text-sm mb-3">
                  Dodge asteroid storms, earn PRISM tokens, and climb the on-chain leaderboard.
                </p>

                {/* Rewards */}
                <div className="w-full mb-4 p-3 rounded-lg bg-gradient-to-r from-yellow-500/10 via-orange-500/10 to-yellow-500/10 border border-yellow-500/20">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Coins className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-[10px] text-yellow-400 uppercase tracking-widest font-bold">Rewards</span>
                  </div>
                  <p className="text-xs text-white/70">
                    Top users will be rewarded with the project token in the future.
                  </p>
                </div>

                {/* How to play */}
                <div className="w-full mb-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-left text-xs text-white/50 space-y-1.5">
                  <div className="text-cyan-400/70 uppercase tracking-widest text-[10px] font-bold mb-2">
                    How to play
                  </div>
                  <div className="flex items-start gap-2">
                    <Target className="w-3 h-3 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-white/70">{isMobile ? "Tap" : "Click / Space"} — reverse orbit</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Orbit className="w-3 h-3 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-white/70">Dodge asteroids, collect power-ups</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Shield className="w-3 h-3 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-white/70">Shield — blocks 1 hit. Clock — slowdown. Ghost — pass through. Coin — +25 pts</span>
                  </div>
                </div>

                {/* MagicBlock integration badge */}
                <div className="w-full mb-4 p-3 rounded-lg bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-purple-500/10 border border-purple-500/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">⚡</span>
                      <span className="text-[10px] text-purple-400 uppercase tracking-widest font-bold">
                        MagicBlock Powered
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          mbHealthy ? "bg-green-400" : mbHealthy === false ? "bg-red-400" : "bg-yellow-400 animate-pulse"
                        }`}
                      />
                      <span className="text-[10px] text-white/40">
                        {mbHealthy ? "Connected" : mbHealthy === false ? "Offline" : "Checking..."}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-purple-200/40 mt-1.5">
                    Provably fair asteroid spawning via MagicBlock Ephemeral Rollups. 
                    Each game session is seeded from on-chain entropy and verified after play.
                  </p>
                </div>

                {/* Player stats */}
                {playerStats.gamesPlayed > 0 && (
                  <div className="w-full mb-4 grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2 text-center">
                      <div className="text-[10px] text-white/40 uppercase">Games</div>
                      <div className="text-sm font-bold text-white">{playerStats.gamesPlayed}</div>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2 text-center">
                      <div className="text-[10px] text-white/40 uppercase">Best</div>
                      <div className="text-sm font-bold text-cyan-400">{formatTime(playerStats.bestScore)}</div>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2 text-center">
                      <div className="text-[10px] text-white/40 uppercase">Total Time</div>
                      <div className="text-sm font-bold text-white">{formatTime(playerStats.totalSurvivalTime)}</div>
                    </div>
                  </div>
                )}

                <Button
                  size="lg"
                  className="w-full h-14 text-lg bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-black font-bold uppercase tracking-widest shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all transform hover:scale-[1.02] active:scale-[0.98]"
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

                {/* Achievements toggle */}
                {achievements.some((a) => a.unlocked) && (
                  <button
                    className="mt-4 flex items-center gap-1.5 text-xs text-yellow-400/60 hover:text-yellow-300 transition-colors"
                    onClick={() => setShowAchievements(!showAchievements)}
                  >
                    <Award className="w-3.5 h-3.5" />
                    Achievements ({achievements.filter((a) => a.unlocked).length}/{achievements.length})
                    {showAchievements ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                )}
                {showAchievements && (
                  <div className="w-full mt-2 space-y-1.5">
                    {achievements.map((ach) => {
                      const progress = getAchievementProgress(ach);
                      return (
                        <div
                          key={ach.id}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                            ach.unlocked
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
                          {ach.unlocked && <span className="text-green-400 text-[10px]">✓</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Leaderboard toggle */}
                {leaderboard.length > 0 && (
                  <>
                    <button
                      className="mt-4 flex items-center gap-1.5 text-xs text-cyan-500/60 hover:text-cyan-300 transition-colors"
                      onClick={() => setShowLeaderboard(!showLeaderboard)}
                    >
                      <Trophy className="w-3.5 h-3.5" />
                      Top Pilots ({leaderboard.length})
                      {showLeaderboard ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    <div className={`w-full mt-2 space-y-1.5 ${showLeaderboard ? "" : "hidden"}`}>
                      {leaderboard.slice(0, 10).map((entry, i) => (
                        <div
                          key={entry.id}
                          className="flex justify-between items-center text-xs px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05]"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                                i === 0
                                  ? "border-yellow-500/60 text-yellow-400"
                                  : i === 1
                                  ? "border-gray-400/40 text-gray-300"
                                  : i === 2
                                  ? "border-orange-500/40 text-orange-400"
                                  : "border-white/10 text-white/30"
                              }`}
                            >
                              {i + 1}
                            </span>
                            <span className="font-mono text-cyan-300/70">{formatAddress(entry.address)}</span>
                            {entry.txSignature && (
                              <a
                                href={`https://solscan.io/tx/${entry.txSignature}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-green-400/60 hover:text-green-300"
                                title="Verified on-chain"
                              >
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white/80 tabular-nums">{formatTime(entry.score)}</span>
                            <span className="text-[9px] text-yellow-400/50">{calculateRewardCredits(entry.score)} pts</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
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

                {/* Reward credits earned */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/25">
                    <Coins className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-sm font-bold text-yellow-300">{rewardCredits} pts</span>
                  </div>
                  {playerRank <= 20 && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/25">
                      <Trophy className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="text-sm font-bold text-cyan-300">#{playerRank}</span>
                    </div>
                  )}
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

                {/* Newly unlocked achievements */}
                {newAchievements.length > 0 && (
                  <div className="w-full mb-4 space-y-1.5">
                    {newAchievements.map((ach) => (
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
                        <Award className="w-4 h-4 text-yellow-400 ml-auto" />
                      </div>
                    ))}
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
                        Save Score On-Chain
                      </>
                    )}
                  </Button>
                )}

                {lastTxSignature && (
                  <a
                    href={`https://solscan.io/tx/${lastTxSignature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 mb-3 text-xs text-green-400/80 hover:text-green-300 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Score verified on-chain — View on Solscan
                  </a>
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
  );
};

export default PrismLeague;
