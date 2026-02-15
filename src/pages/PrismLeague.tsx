import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
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
  Gamepad2
} from "lucide-react";
import "./PrismLeague.css";
import CosmicRunnerScene from "@/components/game/CosmicRunnerScene";

const LEADERBOARD_STORAGE_KEY = "identity_prism_runner_board_v1";

interface LeaderboardEntry {
  id: string;
  address: string;
  score: number;
  playedAt: string;
}

const formatAddress = (address?: string) => {
  if (!address) return "Not connected";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
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
  } catch {
    // Ignore storage write failures
  }
};

const PrismLeague = () => {
  const { publicKey, connected } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const address = publicKey?.toBase58();
  const { traits } = useWalletData(address);

  const [gameState, setGameState] = useState<"start" | "playing" | "gameover">("start");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => readLeaderboard());

  // Load user's high score from leaderboard
  useEffect(() => {
    if (address) {
      const userBest = leaderboard.find(e => e.address === address)?.score || 0;
      setHighScore(userBest);
    }
  }, [address, leaderboard]);

  const handleStart = () => {
    if (!connected) {
      setWalletModalVisible(true);
      return;
    }
    setScore(0);
    setGameState("playing");
  };

  const handleGameOver = useCallback((finalScore: number) => {
    setGameState("gameover");
    setScore(finalScore);

    if (address) {
      const newEntry: LeaderboardEntry = {
        id: Date.now().toString(),
        address,
        score: finalScore,
        playedAt: new Date().toISOString()
      };

      setLeaderboard(prev => {
        const existing = prev.findIndex(e => e.address === address);
        let next = [...prev];
        
        if (existing !== -1) {
          if (finalScore > next[existing].score) {
            next[existing] = newEntry; // Update if better
          }
        } else {
          next.push(newEntry);
        }
        
        // Sort by score desc
        next.sort((a, b) => b.score - a.score);
        writeLeaderboard(next);
        return next;
      });

      if (finalScore > highScore) {
        setHighScore(finalScore);
        toast.success(`New High Score: ${finalScore}!`);
      }
    }
  }, [address, highScore]);

  const handleShare = () => {
    const text = `I just scored ${score} in Prism League! 🚀\n\nCan you beat my high score of ${highScore}?\n\nPlay now on Identity Prism.`;
    const url = "https://identityprism.xyz/game";
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank");
  };

  return (
    <div className="prism-league-page relative w-full h-screen overflow-hidden bg-black">
      {/* 3D Game Background/Foreground */}
      <CosmicRunnerScene 
        gameState={gameState} 
        onScore={setScore} 
        onGameOver={handleGameOver} 
        traits={traits}
        walletScore={score}
      />

      {/* UI Overlay */}
      <div className="absolute inset-0 pointer-events-none z-10 flex flex-col">
        {/* Top Bar */}
        <header className="flex items-center justify-between p-4 md:p-6 bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
          <Link to="/app" className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 transition-colors uppercase text-sm font-bold tracking-widest">
            <ArrowLeft className="w-4 h-4" /> Back to Base
          </Link>

          <div className="flex flex-col items-center">
             <h1 className="text-2xl md:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500 uppercase tracking-tighter filter drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]">
               Prism League
             </h1>
             <span className="text-xs text-cyan-200/60 tracking-[0.2em] uppercase">Cosmic Runner</span>
          </div>

          <div className="flex items-center gap-3">
            {connected && (
               <div className="hidden md:flex flex-col items-end mr-2">
                 <span className="text-[10px] uppercase tracking-wider text-cyan-500/80">Current Pilot</span>
                 <span className="text-xs font-bold text-cyan-100 font-mono">{formatAddress(address)}</span>
               </div>
            )}
            <Button 
              size="sm" 
              variant="outline" 
              className="bg-cyan-950/50 border-cyan-800 text-cyan-400 hover:bg-cyan-900/80 hover:text-cyan-200 backdrop-blur-md"
              onClick={() => setWalletModalVisible(true)}
            >
              <Wallet className="w-4 h-4 mr-2" />
              {connected ? "Wallet" : "Connect"}
            </Button>
          </div>
        </header>

        {/* HUD (Heads Up Display) */}
        <div className="flex-1 relative">
          {/* Score Display (Top Center) */}
          {(gameState === "playing" || gameState === "gameover") && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center">
              <span className="text-4xl md:text-6xl font-black text-white italic tracking-tighter drop-shadow-[0_0_15px_rgba(255,255,255,0.6)]">
                {score.toLocaleString()}
              </span>
              <span className="text-xs text-cyan-300/80 uppercase tracking-widest font-bold">Current Score</span>
            </div>
          )}

          {/* Start Screen */}
          {gameState === "start" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-auto bg-black/40 backdrop-blur-[2px]">
              <div className="max-w-md w-full p-8 rounded-2xl border border-cyan-500/30 bg-black/80 backdrop-blur-xl shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col items-center text-center">
                <Gamepad2 className="w-16 h-16 text-cyan-400 mb-6 animate-pulse" />
                <h2 className="text-3xl font-bold text-white mb-2">Ready to Fly?</h2>
                <p className="text-cyan-200/70 mb-8">
                  Navigate the quantum tunnels, collect data prisms, and avoid the void glitches.
                  <br/>
                  <span className="text-xs opacity-50 mt-2 block">(Connect wallet to save high scores)</span>
                </p>
                
                <Button 
                  size="lg" 
                  className="w-full h-14 text-lg bg-cyan-500 hover:bg-cyan-400 text-black font-bold uppercase tracking-widest shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all transform hover:scale-105"
                  onClick={handleStart}
                >
                  <Play className="w-5 h-5 mr-2 fill-current" />
                  Launch Ship
                </Button>

                <div className="mt-8 w-full">
                  <div className="flex items-center justify-between text-xs text-cyan-500/50 uppercase tracking-widest mb-4">
                    <span>Local Aces</span>
                    <Trophy className="w-3 h-3" />
                  </div>
                  <div className="space-y-2">
                    {leaderboard.slice(0, 3).map((entry, i) => (
                      <div key={entry.id} className="flex justify-between items-center text-sm p-2 rounded bg-white/5 border border-white/5">
                        <span className="font-mono text-cyan-300">{formatAddress(entry.address)}</span>
                        <span className="font-bold text-white">{entry.score.toLocaleString()}</span>
                      </div>
                    ))}
                    {leaderboard.length === 0 && (
                      <div className="text-xs text-white/20 italic">No records yet. Be the first.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Game Over Screen */}
          {gameState === "gameover" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-auto bg-red-950/10 backdrop-blur-sm">
              <div className="max-w-sm w-full p-8 rounded-2xl border border-red-500/30 bg-black/90 backdrop-blur-xl shadow-[0_0_60px_rgba(239,68,68,0.2)] flex flex-col items-center text-center">
                <div className="text-red-500 font-black text-5xl mb-2 tracking-tighter uppercase drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]">
                  Crashed
                </div>
                <div className="text-lg text-white mb-6 font-mono">
                  Final Score: <span className="text-yellow-400 font-bold">{score.toLocaleString()}</span>
                </div>

                <div className="flex gap-3 w-full">
                  <Button 
                    className="flex-1 bg-white text-black hover:bg-gray-200 font-bold"
                    onClick={() => setGameState("start")}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                  <Button 
                    variant="outline"
                    className="flex-1 border-cyan-800 text-cyan-400 hover:bg-cyan-950"
                    onClick={handleShare}
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Share
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrismLeague;
