import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { SolanaMobileWalletAdapterWalletName } from '@solana-mobile/wallet-adapter-mobile';
import { Button } from '@/components/ui/button';
import { type WalletPreview } from '@/components/prism/shared';
import { invalidateCompositeCache, useCompositeScore } from '@/hooks/useCompositeScore';
import { invalidateBalanceCache } from '@/lib/prefetch';
import { toast } from 'sonner';
import BattleResultOverlay from '@/components/BattleResultOverlay';
import { CosmicStarfield } from '@/components/CosmicStarfield';
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
  ChevronLeft,
  ChevronRight,
  Coins,
  RotateCw,
  Swords,
  BookOpen,
} from 'lucide-react';
import './PrismLeague.css';
import { initAudio, startMusic, stopAllAudio, sfxGameOver } from '@/lib/gameAudio';
import { hapticHeavy, hapticMedium, hapticSuccess, hapticError } from '@/lib/haptics';
import OrbitSurvivalScene from '@/components/game/OrbitSurvivalScene';
import AsteroidDestroyerScene from '@/components/game/AsteroidDestroyerScene';
import GravityRunnerScene from '@/components/game/GravityRunnerScene';

import { FpsOverlay } from '@/components/game/GameShared';
import { computeShipStats, getEquipmentBonusLabel } from '@/lib/shipStats';
import type { ForgeLoadout } from '@/lib/forgeItems';

type GameMode = 'orbit' | 'destroyer' | 'gravity' | 'text_quest';

const GAME_MODES: { id: GameMode; name: string; icon: string; desc: string; controls: string; cover?: string }[] = [
  {
    id: 'orbit',
    name: 'Orbit Survival',
    icon: '🛸',
    desc: 'Dodge asteroids, survive as long as you can',
    controls: 'Tap/Click to reverse orbit',
    cover: '/games/orbit_cover.png',
  },
  {
    id: 'destroyer',
    name: 'Cosmic Defender',
    icon: '💥',
    desc: '4 sectors of enemies & bosses. Auto-fire, collect powerups!',
    controls: 'WASD/Arrows to move, auto-fire. Touch: drag to move',
    cover: '/games/wars_cover.png',
  },
  {
    id: 'gravity',
    name: 'Gravity Runner',
    icon: '🔄',
    desc: 'Tap to fly, collect crystals, dodge asteroid columns!',
    controls: 'Tap/Space to thrust upward',
    cover: '/games/gravity_cover.png',
  },
  {
    id: 'text_quest',
    name: 'Text Adventures',
    icon: '📖',
    desc: 'Daily narrative quests — explore stories, earn Coins',
    controls: 'Read and make choices',
    cover: '/games/quest_cover.png',
  },
];
import { commitScoreOnchain } from '@/lib/onchainLeaderboard';
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
} from '@/lib/gameAchievements';
import {
  generateFairSeed,
  verifyGameSessionSeed,
  getMagicBlockHealth,
  registerGameSessionProof,
  type GameSessionProof,
} from '@/lib/magicblock';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
import { goBack } from '@/lib/safeNavigate';
import { trackGameStart, trackGameOver } from '@/lib/analytics';
// earnPrism removed — unified economy uses coins directly
import { getHeliusProxyUrl, getHeliusRpcUrl, getCollectionMint, getAppBaseUrl } from '@/constants';
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
} from '@/lib/defenderAchievements';
import {
  checkGravityAchievements,
  updateGravityStats,
  getGravityAchievements,
  getGravityAchievementProgress,
  claimGravityReward,
  GRAVITY_COIN_REWARDS,
  type GravityAchievement,
} from '@/lib/gravityAchievements';

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
  return getHeliusProxyUrl() || getAppBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
}

async function fetchServerLeaderboard(gameType?: string): Promise<LeaderboardEntry[]> {
  try {
    const base = getServerBase();
    if (!base) return [];
    const params = gameType ? `?gameType=${gameType}` : '';
    const res = await fetch(`${base}/api/game/leaderboard${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.entries || []).map(
      (e: { address: string; score: number; playedAt?: string; txSignature?: string }) => ({
        id: `srv-${e.address}-${e.score}`,
        address: e.address,
        score: e.score,
        playedAt: e.playedAt || new Date().toISOString(),
        txSignature: e.txSignature,
      }),
    );
  } catch {
    return [];
  }
}

async function submitToServerLeaderboard(entry: {
  address: string;
  score: number;
  playedAt: string;
  txSignature?: string;
  gameType?: string;
  gameSessionId?: string;
}): Promise<void> {
  try {
    const base = getServerBase();
    if (!base) return;
    // JWT required by server — reuse getChallengeJwt (defined below)
    let jwt: string | null = null;
    try {
      const raw = sessionStorage.getItem('ip_auth_jwt');
      if (raw) {
        const parsed = JSON.parse(raw) as { token: string; address: string; expiresAt: number };
        if (parsed.expiresAt > Date.now() + 60_000) jwt = parsed.token;
      }
    } catch {
      /* ignore */
    }
    if (!jwt) return; // no token — server will 401 anyway
    await fetch(`${base}/api/game/leaderboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(entry),
    });
  } catch {
    /* silent */
  }
}

/* ═══════════════════════════════════════════════════
   Coin persistence (per wallet)
   ═══════════════════════════════════════════════════ */

const COINS_STORAGE_KEY = 'identity_prism_orbit_coins_v1';

function readWalletCoins(walletAddress: string): number {
  try {
    const raw = window.localStorage.getItem(COINS_STORAGE_KEY);
    if (!raw) return 0;
    const data = JSON.parse(raw) as Record<string, number>;
    return data[walletAddress] ?? 0;
  } catch {
    return 0;
  }
}

function writeWalletCoins(walletAddress: string, coins: number) {
  try {
    const raw = window.localStorage.getItem(COINS_STORAGE_KEY);
    const data: Record<string, number> = raw ? JSON.parse(raw) : {};
    data[walletAddress] = coins;
    window.localStorage.setItem(COINS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* */
  }
}

/* ═══════════════════════════════════════════════════
   Constants & types
   ═══════════════════════════════════════════════════ */

const LEADERBOARD_STORAGE_KEY = 'identity_prism_orbit_survival_board_v3';
const DEFENDER_LEADERBOARD_KEY = 'identity_prism_defender_board_v1';
const GRAVITY_LEADERBOARD_KEY = 'prism_league_gravity_leaderboard_v1';
const ONCHAIN_BONUS_MULTIPLIER = 1.5;
const COIN_BONUS = 25;
async function syncCoinsToServer(
  walletAddress: string,
  coins: number,
  delta: number,
  mode?: GameMode,
  gameSessionId?: string,
): Promise<void> {
  try {
    const base = getServerBase();
    if (!base) return;
    const jwt = getChallengeJwt();
    if (!jwt) return; // Require JWT to sync coins
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` };
    await fetch(`${base}/api/game/coins`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ address: walletAddress, coins, delta, mode, gameSessionId }),
    });
  } catch {
    /* silent */
  }
}

async function fetchServerCoins(walletAddress: string): Promise<number | null> {
  try {
    const base = getServerBase();
    if (!base) return null;
    const res = await fetch(`${base}/api/game/coins?address=${encodeURIComponent(walletAddress)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.coins === 'number' ? data.coins : null;
  } catch {
    return null;
  }
}

async function claimAchievementOnServer(
  walletAddress: string,
  achievementId: string,
  reward: number,
): Promise<{ ok: boolean; coins?: number }> {
  try {
    const base = getServerBase();
    if (!base) return { ok: true };
    const jwt = getChallengeJwt();
    if (!jwt) return { ok: false }; // Require JWT
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` };
    const res = await fetch(`${base}/api/game/achievements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ address: walletAddress, achievementId, reward }),
    });
    if (res.status === 409) return { ok: false };
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, coins: data?.coins };
  } catch {
    return { ok: false };
  }
}

async function syncUnlockedToServer(walletAddress: string, unlockedIds: string[]): Promise<void> {
  try {
    const base = getServerBase();
    if (!base || !unlockedIds.length) return;
    const jwt = getChallengeJwt();
    if (!jwt) return; // Require JWT
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` };
    await fetch(`${base}/api/game/achievements`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ address: walletAddress, unlocked: unlockedIds }),
    });
  } catch {
    /* silent */
  }
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
  } catch {
    return { unlocked: [], claimed: [] };
  }
}

async function fetchServerRevives(
  walletAddress: string,
  mode: 'orbit' | 'destroyer',
): Promise<{ left: number; max: number } | null> {
  try {
    const base = getServerBase();
    if (!base) return null;
    const res = await fetch(`${base}/api/game/revives?address=${encodeURIComponent(walletAddress)}&mode=${mode}`);
    if (!res.ok) return null; // server unavailable — keep localStorage fallback
    const data = await res.json();
    return { left: data?.left ?? 0, max: data?.max ?? 3 };
  } catch {
    return null;
  }
}

async function serverRevive(
  walletAddress: string,
  mode: 'orbit' | 'destroyer',
): Promise<{ success: boolean; left: number }> {
  try {
    const base = getServerBase();
    if (!base) return { success: false, left: 0 };
    const jwt = getChallengeJwt();
    if (!jwt) return { success: false, left: 0 }; // Require JWT
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` };
    const res = await fetch(`${base}/api/game/revives`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ address: walletAddress, mode }),
    });
    const data = await res.json();
    if (res.ok && data?.success) return { success: true, left: data.left ?? 0 };
    return { success: false, left: data?.left ?? 0 };
  } catch {
    return { success: false, left: 0 };
  }
}

const formatAddress = (address?: string) => {
  if (!address || address === 'anonymous') return 'Anon';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatPoints = (pts: number) => pts.toLocaleString();

/** Format score by game mode: orbit=time, destroyer=points, gravity=columns */
const fmtScore = (s: number, mode: string) =>
  mode === 'destroyer' ? `${formatPoints(s)} pts` : mode === 'gravity' ? `${s}` : formatTime(s);

const readDefenderLeaderboard = (): LeaderboardEntry[] => {
  try {
    const raw = window.localStorage.getItem(DEFENDER_LEADERBOARD_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LeaderboardEntry[];
  } catch {
    return [];
  }
};

const writeDefenderLeaderboard = (entries: LeaderboardEntry[]) => {
  try {
    window.localStorage.setItem(DEFENDER_LEADERBOARD_KEY, JSON.stringify(entries));
  } catch {
    /* */
  }
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
    /* */
  }
};

const readGravityLeaderboard = (): LeaderboardEntry[] => {
  try {
    const raw = window.localStorage.getItem(GRAVITY_LEADERBOARD_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};
const writeGravityLeaderboard = (lb: LeaderboardEntry[]) => {
  try {
    window.localStorage.setItem(GRAVITY_LEADERBOARD_KEY, JSON.stringify(lb));
  } catch {
    /* storage full */
  }
};

const isMobileDevice = () => typeof window !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

const isCapacitorNative = () =>
  Boolean(
    (
      globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.(),
  );

const isSeekerBrowser = () => typeof navigator !== 'undefined' && /seeker/i.test(navigator.userAgent);

/* ═══════════════════════════════════════════════════
   Challenge helpers (JWT + score submission)
   ═══════════════════════════════════════════════════ */

interface ChallengeResult {
  id: string;
  status: string;
  creator: string;
  opponent: string | null;
  creatorScore: number | null;
  opponentScore: number | null;
  winner: string | null;
  stakeAmount: number;
  stakeType?: 'coins' | 'sol';
  gameMode?: string;
}

function getChallengeJwt(): string | null {
  try {
    const raw = sessionStorage.getItem('ip_auth_jwt');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; address: string; expiresAt: number };
    if (parsed.expiresAt > Date.now() + 60_000) return parsed.token;
    sessionStorage.removeItem('ip_auth_jwt');
  } catch {
    /* ignore */
  }
  return null;
}

async function submitChallengeScore(
  challengeId: string,
  score: number,
  gameSessionId?: string,
): Promise<{ ok: boolean; challenge?: ChallengeResult; error?: string }> {
  const jwt = getChallengeJwt();
  if (!jwt) return { ok: false, error: 'Not authenticated — sign in from Prism Arena first' };
  try {
    const base = getServerBase();
    if (!base) return { ok: false, error: 'Server unavailable' };
    const res = await fetch(`${base}/api/challenge/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ challengeId, score, gameSessionId }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || 'Failed to submit score' };
    return { ok: true, challenge: data?.challenge };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/* ── Waiting for Opponent Banner with polling ── */
function WaitingForOpponentBanner({
  challengeId,
  address,
  onResultReceived,
}: {
  challengeId: string;
  address: string;
  onResultReceived: (ch: ChallengeResult) => void;
}) {
  const [dots, setDots] = useState('');
  const receivedRef = useRef(false);

  useEffect(() => {
    const dotInterval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(dotInterval);
  }, []);

  useEffect(() => {
    if (!address || receivedRef.current) return;
    const base = getServerBase();
    if (!base) return;

    const controller = new AbortController();
    const poll = async () => {
      try {
        const jwt = getChallengeJwt();
        if (!jwt) return;
        const res = await fetch(`${base}/api/challenge/my`, {
          headers: { Authorization: `Bearer ${jwt}` },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        const list: ChallengeResult[] = Array.isArray(data) ? data : (data.challenges ?? []);
        const ch = list.find((c) => c.id === challengeId);
        if (ch && ch.status === 'completed' && !receivedRef.current) {
          receivedRef.current = true;
          if (address) invalidateBalanceCache(address);
          onResultReceived(ch);
        }
      } catch {
        /* ignore */
      }
    };

    const interval = setInterval(poll, 5000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, [challengeId, address, onResultReceived]);

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-cyan-400/30 bg-cyan-500/8">
      <Swords className="w-4 h-4 text-cyan-400 animate-pulse" />
      <span className="text-sm text-cyan-300 font-medium">Waiting for opponent{dots}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Tournament types
   ═══════════════════════════════════════════════════ */

type PlayMode = 'free' | 'tournament';
type TournamentTierKey = 'daily' | 'weekly' | 'monthly';

interface TournamentEntry {
  address: string;
  score: number;
  submittedAt: string;
  rank: number;
}

interface ActiveTournament {
  id: string;
  tier?: string;
  mode: string;
  label?: string;
  entryFee?: number;
  endsAt: string;
  prizePool: number;
  basePrizes?: number[];
  entryCount: number;
  entries: TournamentEntry[];
  isEnded: boolean;
  winners?: TournamentEntry[];
  userJoined?: boolean;
  resultsHidden?: boolean;
  xpRewards?: number[];
}

const TOURNAMENT_TIERS: { key: TournamentTierKey; label: string; fee: number; shortLabel: string }[] = [
  { key: 'daily', label: 'Daily 1k', fee: 1000, shortLabel: 'Daily' },
  { key: 'weekly', label: 'Weekly 5k', fee: 5000, shortLabel: 'Weekly' },
  { key: 'monthly', label: 'Monthly 25k', fee: 25000, shortLabel: 'Monthly' },
];

const PRIZE_DIST: Record<TournamentTierKey, { place: string; pct: string; xp: number; base: number }[]> = {
  daily: [
    { place: '1st', pct: '50%', xp: 300, base: 1000 },
    { place: '2nd', pct: '30%', xp: 200, base: 700 },
    { place: '3rd', pct: '20%', xp: 100, base: 400 },
  ],
  weekly: [
    { place: '1st', pct: '35%', xp: 600, base: 5000 },
    { place: '2nd', pct: '22%', xp: 500, base: 4200 },
    { place: '3rd', pct: '15%', xp: 400, base: 3400 },
    { place: '4th', pct: '10%', xp: 300, base: 2600 },
    { place: '5th', pct: '10%', xp: 200, base: 1800 },
    { place: '6th', pct: '8%', xp: 100, base: 1000 },
  ],
  monthly: [
    { place: '1st', pct: '30%', xp: 1000, base: 25000 },
    { place: '2nd', pct: '18%', xp: 900, base: 22500 },
    { place: '3rd', pct: '12%', xp: 800, base: 20000 },
    { place: '4th', pct: '9%', xp: 700, base: 17500 },
    { place: '5th', pct: '8%', xp: 600, base: 15000 },
    { place: '6th', pct: '6%', xp: 500, base: 12500 },
    { place: '7th', pct: '5%', xp: 400, base: 10000 },
    { place: '8th', pct: '4%', xp: 300, base: 7500 },
    { place: '9th', pct: '4%', xp: 200, base: 5000 },
    { place: '10th', pct: '4%', xp: 100, base: 2500 },
  ],
};

function formatTournamentTimeLeft(endsAt: string): string {
  try {
    const diff = new Date(endsAt).getTime() - Date.now();
    if (diff <= 0) return 'Ended';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s < 10 ? '0' : ''}${s}s`;
    return `${s}s`;
  } catch {
    return '—';
  }
}

/* ═══════════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════════ */

const PrismLeague = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const locationState = location.state as { fromAppJump?: boolean; returnAddress?: string } | null;
  const fromAppJump = Boolean(locationState?.fromAppJump);

  // ── Challenge integration ──
  const rawChallengeId = searchParams.get('challengeId');
  const urlChallengeId = rawChallengeId && /^[a-zA-Z0-9_-]{1,64}$/.test(rawChallengeId) ? rawChallengeId : null;
  const urlMode = (() => {
    const raw = searchParams.get('mode');
    const VALID_GAME_MODES: GameMode[] = ['orbit', 'destroyer', 'gravity', 'text_quest'];
    return raw && VALID_GAME_MODES.includes(raw as GameMode) ? (raw as GameMode) : null;
  })();
  const [activeChallengeId, _setActiveChallengeId] = useState<string | null>(urlChallengeId);
  const [challengeResult, setChallengeResult] = useState<ChallengeResult | null>(null);
  const [challengeSubmitting, setChallengeSubmitting] = useState(false);
  // Persist across page refresh via sessionStorage
  const challengeSubmittedRef = useRef(
    urlChallengeId ? sessionStorage.getItem('ip_challenge_submitted') === urlChallengeId : false,
  );
  const [showBattleResult, setShowBattleResult] = useState(false);

  // Warn on tab close / refresh if challenge active and not submitted
  useEffect(() => {
    if (!activeChallengeId || challengeSubmittedRef.current) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (challengeSubmittedRef.current) return;
      // Show browser "Leave page?" confirmation — no auto-abandon
      // (user might just be refreshing; server auto-cleanup handles truly abandoned games)
      e.preventDefault();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeChallengeId]);

  // Cleanup submitted marker when leaving the page entirely
  useEffect(() => {
    return () => {
      if (!activeChallengeId) sessionStorage.removeItem('ip_challenge_submitted');
    };
  }, [activeChallengeId]);

  const wallet = useWallet();
  const { publicKey, connected, wallets: availableWallets, select, connect, disconnect } = wallet;
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const address = publicKey?.toBase58();

  // Composite score — cached in sessionStorage, loads instantly on revisit
  const composite = useCompositeScore(address || null);

  // Build WalletPreview from composite data (instant — no extra HTTP calls for ship stats)
  const walletPreview = useMemo<WalletPreview | null>(() => {
    if (!address || (composite.isLoading && !composite.breakdown)) return null;
    if (!composite.breakdown || (composite.score === 0 && !composite.breakdown.onchain)) return null;
    return {
      address,
      score: composite.score,
      tier: composite.tier,
      badges: [],
      solBalance: 0,
      txCount: 0,
      walletAgeDays: 0,
      tokenCount: 0,
      nftCount: 0,
      trustGrade: null,
      trustScore: null,
      riskLevel: null,
      topPrograms: [],
      compositeScore: composite.score,
      compositeTier: composite.tier,
      compositeBadgeCount: 0,
      compositeBreakdown: composite.breakdown,
    };
  }, [address, composite.score, composite.tier, composite.breakdown, composite.isLoading]);

  // Load forge loadout from localStorage (re-reads on focus/visibility change)
  const [forgeLoadout, setForgeLoadout] = useState<ForgeLoadout | null>(null);
  useEffect(() => {
    const load = () => {
      if (!address) {
        setForgeLoadout(null);
        return;
      }
      try {
        const raw = localStorage.getItem(`prism_forge_loadout_v1_${address}`);
        setForgeLoadout(raw ? JSON.parse(raw) : null);
      } catch {
        setForgeLoadout(null);
      }
    };
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [address]);

  // Derive ship stats from compositeScore + forge loadout
  const shipStats = useMemo(() => computeShipStats(walletPreview, forgeLoadout), [walletPreview, forgeLoadout]);

  // Minimal traits adapter for game scenes (they only use planetTier)
  const traits = useMemo(
    () => (walletPreview ? ({ planetTier: walletPreview.compositeTier } as unknown) : null),
    [walletPreview],
  );
  const equippedSkin = forgeLoadout?.equippedShipSkin || null;
  const equippedAura = forgeLoadout?.equippedAura || null;

  const isMobile = useMemo(isMobileDevice, []);
  const isCapacitor = useMemo(isCapacitorNative, []);
  const _isSeeker = useMemo(isSeekerBrowser, []);
  const useMobileWallet = isCapacitor || isMobile;

  const isAndroid = useMemo(() => /android/i.test(navigator.userAgent), []);

  /* Mobile wallet connection logic matching main app */
  const handleWalletConnect = useCallback(async () => {
    if (connected) return;

    if (useMobileWallet) {
      const mwaWallet = availableWallets.find((w) => w.adapter.name === SolanaMobileWalletAdapterWalletName);
      const installedNonMwa = availableWallets.find(
        (w) =>
          w.adapter.name !== SolanaMobileWalletAdapterWalletName &&
          (w.readyState === 'Installed' || w.readyState === 'Loadable'),
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
          const message = err instanceof Error ? err.message : String(err ?? '');
          if (message.includes('wallet not found') || message.includes('ERROR_WALLET_NOT_FOUND')) {
            const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
            if (isIos) {
              window.location.href = 'https://phantom.app/ul/browse/' + encodeURIComponent(window.location.href);
              return;
            }
          }
          toast.error('Wallet connection failed');
          // Reset adapter state so next connect attempt starts fresh
          try {
            await finalTarget.adapter.disconnect();
          } catch {
            /* empty */
          }
          try {
            select(null as unknown as Parameters<typeof select>[0]);
          } catch {
            /* empty */
          }
        }
      } else {
        setWalletModalVisible(true);
      }
    } else {
      setWalletModalVisible(true);
    }
  }, [connected, useMobileWallet, isCapacitor, isAndroid, availableWallets, select, connect, setWalletModalVisible]);

  const [gameMode, setGameMode] = useState<GameMode>('orbit');
  // Auto-select game mode from URL param (challenge)
  useEffect(() => {
    if (urlMode && GAME_MODES.some((m) => m.id === urlMode)) {
      setGameMode(urlMode);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [gameState, setGameState] = useState<'start' | 'countdown' | 'playing' | 'gameover'>('start');
  const [countdownNum, setCountdownNum] = useState(3);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);

  // Live score/coins — direct DOM updates during gameplay to avoid React re-renders
  const _liveScore = useRef(0);
  const _liveCoins = useRef(0);
  const _scoreDomRef = useRef<HTMLSpanElement>(null);
  const _coinsDomRef = useRef<HTMLSpanElement>(null);
  const throttledSetScore = useCallback(
    (v: number) => {
      _liveScore.current = v;
      if (_scoreDomRef.current)
        _scoreDomRef.current.textContent =
          gameMode === 'destroyer' ? formatPoints(v) : gameMode === 'gravity' ? `${v}` : formatTime(v);
    },
    [gameMode],
  );
  const throttledSetCoins = useCallback((v: number) => {
    _liveCoins.current = v;
    if (_coinsDomRef.current) _coinsDomRef.current.textContent = String(v);
  }, []);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => readLeaderboard());
  const [defenderLeaderboard, setDefenderLeaderboard] = useState<LeaderboardEntry[]>(() => readDefenderLeaderboard());
  const [gravityLeaderboard, setGravityLeaderboard] = useState<LeaderboardEntry[]>(() => readGravityLeaderboard());
  const [showAchievements, setShowAchievements] = useState(false);
  const [isJumpingBack, setIsJumpingBack] = useState(false);
  const transitionTimersRef = useRef<number[]>([]);
  const runStartedAtRef = useRef<number>(Date.now());

  const [isCommitting, setIsCommitting] = useState(false);
  const [lastTxSignature, setLastTxSignature] = useState<string | null>(null);
  const [onchainBonusApplied, setOnchainBonusApplied] = useState(false);
  const [coins, setCoins] = useState(0);
  const [totalCoins, setTotalCoins] = useState(() => readWalletCoins(address || 'anonymous'));

  // Reset totalCoins on wallet change
  useEffect(() => {
    setTotalCoins(readWalletCoins(address || 'anonymous'));
  }, [address]);

  // Sync coins & achievements from server when wallet connects
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    fetchServerCoins(address).then((srv) => {
      if (cancelled || srv === null) return;
      // Server is source of truth — always use server balance
      writeWalletCoins(address, srv);
      setTotalCoins(srv);
    });
    // Sync unlocked + claimed achievements from server
    fetchServerAchievements(address).then(({ unlocked: srvUnlocked, claimed: srvClaimed }) => {
      if (cancelled || (!srvUnlocked.length && !srvClaimed.length)) return;
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
    return () => {
      cancelled = true;
    };
  }, [address]);
  const [sessionProof, setSessionProof] = useState<GameSessionProof | null>(null);
  const [newAchievements, setNewAchievements] = useState<Achievement[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStats>(() => getPlayerStats());
  const [achievements, setAchievements] = useState<Achievement[]>(() => getAchievements());

  // Defender-specific state
  const [defenderAchievements, setDefenderAchievements] = useState<DefenderAchievement[]>(() =>
    getDefenderAchievements(),
  );
  const [defenderStats, setDefenderStats] = useState<DefenderStats>(() => getDefenderStats());

  // Gravity-specific state
  const [gravityAchievements, setGravityAchievements] = useState<GravityAchievement[]>(() => getGravityAchievements());
  const defenderKills = useRef(0);
  const defenderLevel = useRef(0);
  const [defLevelInfo, setDefLevelInfo] = useState<{ level: number; wave: number; name: string; banner: boolean }>({
    level: 1,
    wave: 0,
    name: '',
    banner: false,
  });
  const _pendingDefLevel = useRef<{ level: number; wave: number; name: string; banner: boolean } | null>(null);
  const _defLevelRaf = useRef(0);
  const handleDefLevel = useCallback((lv: number, wv: number, name: string, banner: boolean) => {
    // Only count completed levels: next level banner (lv>1) means previous was completed
    if (banner && lv > 1) {
      const completed = lv - 1;
      if (completed > defenderLevel.current) defenderLevel.current = completed;
    }
    _pendingDefLevel.current = { level: lv, wave: wv, name, banner };
    if (!_defLevelRaf.current)
      _defLevelRaf.current = requestAnimationFrame(() => {
        _defLevelRaf.current = 0;
        if (_pendingDefLevel.current) {
          setDefLevelInfo(_pendingDefLevel.current);
          _pendingDefLevel.current = null;
        }
      });
  }, []);

  // Gravity session stats — populated by GravityRunnerScene via onGameOver extraStats
  const gravitySessionStatsRef = useRef<{ columns: number; crystals: number }>({ columns: 0, crystals: 0 });

  // ── Play Mode & Tournament state ──
  const [playMode, setPlayMode] = useState<PlayMode>('free');
  const [tournamentTier, setTournamentTier] = useState<TournamentTierKey>('daily');
  const [tournaments, setTournaments] = useState<Record<TournamentTierKey, ActiveTournament | null>>({
    daily: null,
    weekly: null,
    monthly: null,
  });
  const [tournamentLoading, setTournamentLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState('');
  const tournamentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derived: currently selected tournament & backward-compat alias
  const activeTournament = tournaments[tournamentTier];

  const fetchTournaments = useCallback(async () => {
    const base = getServerBase();
    if (!base) return;
    setTournamentLoading(true);
    try {
      const headers: Record<string, string> = {};
      const jwt = getChallengeJwt();
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
      const res = await fetch(`${base}/api/tournament/active`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data?.tournaments) {
          setTournaments({
            daily: data.tournaments.daily || null,
            weekly: data.tournaments.weekly || null,
            monthly: data.tournaments.monthly || null,
          });
        } else if (data?.tournament) {
          setTournaments((prev) => ({ ...prev, daily: data.tournament }));
        }
      }
    } catch {
      /* silent */
    }
    setTournamentLoading(false);
  }, []);

  // Fetch tournaments on mount & when address changes
  useEffect(() => {
    fetchTournaments();
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-poll tournaments every 30s when in tournament mode
  useEffect(() => {
    if (playMode !== 'tournament') {
      if (tournamentPollRef.current) {
        clearInterval(tournamentPollRef.current);
        tournamentPollRef.current = null;
      }
      return;
    }
    fetchTournaments();
    tournamentPollRef.current = setInterval(fetchTournaments, 30_000);
    return () => {
      if (tournamentPollRef.current) clearInterval(tournamentPollRef.current);
    };
  }, [playMode, fetchTournaments]);

  // Countdown ticker
  useEffect(() => {
    const t = tournaments[tournamentTier];
    if (t && !t.isEnded) {
      setTimeLeft(formatTournamentTimeLeft(t.endsAt));
      countdownRef.current = setInterval(() => setTimeLeft(formatTournamentTimeLeft(t.endsAt)), 1000);
    } else {
      setTimeLeft('');
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [tournaments, tournamentTier]);

  // Clear join message on tier switch
  useEffect(() => {
    setJoinMessage(null);
  }, [tournamentTier]);

  const handleJoinTournament = useCallback(
    async (tier: TournamentTierKey = tournamentTier) => {
      const base = getServerBase();
      const jwt = getChallengeJwt();
      if (!base || !address || !jwt) {
        toast.error('Connect wallet & sign in first');
        return;
      }
      setJoinLoading(true);
      setJoinMessage(null);
      try {
        const res = await fetch(`${base}/api/tournament/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ tier }),
        });
        const data = await res.json();
        if (res.ok) {
          setJoinMessage('Joined successfully!');
          fetchTournaments();
        } else {
          setJoinMessage(data?.error || 'Failed to join tournament');
        }
      } catch {
        setJoinMessage('Network error — could not join');
      }
      setJoinLoading(false);
    },
    [address, tournamentTier, fetchTournaments],
  );

  const submitToTournament = useCallback(
    async (score: number, gameSessionId?: string) => {
      try {
        const base = getServerBase();
        const jwt = getChallengeJwt();
        if (!base || !jwt) return;
        await fetch(`${base}/api/tournament/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ score, tier: tournamentTier, gameSessionId }),
        });
      } catch {
        /* silent */
      }
    },
    [tournamentTier],
  );

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
    } catch {
      return 0;
    }
  }, []);
  const setDailyReviveUsed = useCallback(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const used = getDailyRevivesUsed() + 1;
      localStorage.setItem('free_revives_daily', JSON.stringify({ date: today, used }));
    } catch {
      /* ignore */
    }
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
  const handleActiveBonuses = useCallback((bonuses: import('@/components/game/GameShared').ActiveBonus[]) => {
    const el = _bonusesDomRef.current;
    if (!el) return;
    if (bonuses.length === 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';
    // Sanitize: only allow known values, escape any user-controllable text
    const esc = (s: string) =>
      s.replace(/[<>"'&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' })[c] || c);
    const safeColor = (c: string) => (/^#[0-9a-fA-F]{3,8}$/.test(c) || /^[a-z]{3,20}$/.test(c) ? c : '#fff');
    el.innerHTML = bonuses
      .map((b) => {
        const pct = Math.max(0, Math.min(100, Math.round((b.t / b.max) * 100)));
        const rawImg = _pwrImgMap[b.type] || '';
        const img = /^\/textures\/powerups\/[a-z0-9_]+\.png$/.test(rawImg) ? rawImg : '';
        const color = safeColor(b.color);
        return (
          `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">` +
          `<span style="font-size:7px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:0.4px;text-shadow:0 0 6px ${color}88;white-space:nowrap">${esc(b.label)}</span>` +
          `<img src="${esc(img)}" width="22" height="22" style="filter:drop-shadow(0 0 5px ${color}80);image-rendering:pixelated" />` +
          `<div style="width:26px;height:4px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,0.4)">` +
          `<div style="width:${pct}%;height:100%;border-radius:3px;background:linear-gradient(90deg,${color}cc,${color});box-shadow:0 0 6px ${color}88;transition:width 0.12s linear"></div>` +
          `</div>` +
          `</div>`
        );
      })
      .join('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const _comboDomRef = useRef<HTMLDivElement>(null);
  const _comboHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCombo = useCallback((combo: number, pts: number) => {
    const el = _comboDomRef.current;
    if (!el) return;
    el.style.display = 'flex';
    el.style.opacity = '1';
    // combo and pts are numbers — safe, but coerce to int for defense
    const safeCombo = Math.floor(Number(combo) || 0);
    const safePts = Math.floor(Number(pts) || 0);
    el.innerHTML = `<span class="text-xs font-black text-orange-300 tabular-nums">&times;${safeCombo}</span><span class="text-[9px] text-orange-400/70 ml-1 font-bold">+${safePts}</span>`;
    if (_comboHideTimer.current) clearTimeout(_comboHideTimer.current);
    _comboHideTimer.current = setTimeout(() => {
      if (el) {
        el.style.opacity = '0';
        setTimeout(() => {
          el.style.display = 'none';
        }, 300);
      }
    }, 1800);
  }, []);

  // Cleanup combo hide timer on unmount
  useEffect(
    () => () => {
      if (_comboHideTimer.current) clearTimeout(_comboHideTimer.current);
    },
    [],
  );

  const [hasMintedId, setHasMintedId] = useState(false);
  useEffect(() => {
    if (!address) return;
    const heliusUrl = getHeliusRpcUrl();
    const collectionMint = getCollectionMint();
    if (!heliusUrl || !collectionMint) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(heliusUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'mint-check',
            method: 'searchAssets',
            params: { ownerAddress: address, grouping: ['collection', collectionMint], page: 1, limit: 1 },
          }),
        });
        const data = await res.json();
        if (!cancelled) setHasMintedId((data?.result?.total ?? 0) > 0);
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Update freeRevivesLeft when hasMintedId resolves late (e.g. challenge auto-start)
  useEffect(() => {
    if (hasMintedId && freeRevivesLeft.current === 0) {
      freeRevivesLeft.current = Math.max(0, FREE_REVIVES_PER_DAY - getDailyRevivesUsed());
      if (address) {
        const mode = gameMode === 'destroyer' ? 'destroyer' : 'orbit';
        fetchServerRevives(address, mode)
          .then((result) => {
            if (result) freeRevivesLeft.current = result.left;
          })
          .catch(() => {});
      }
    }
  }, [hasMintedId, address, gameMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* MagicBlock state */
  const [mbHealthy, setMbHealthy] = useState<boolean | null>(null);
  const [_mbLatency, setMbLatency] = useState<number>(0);
  const [mbSeed, setMbSeed] = useState<string | null>(null);
  const [mbSlot, setMbSlot] = useState<number>(0);
  const [mbVerified, setMbVerified] = useState<boolean>(false);
  const mbSeedRef = useRef<string | null>(null);
  const mbSlotRef = useRef<number>(0);
  mbSeedRef.current = mbSeed;
  mbSlotRef.current = mbSlot;

  /* Fetch server leaderboard when gameMode changes and merge with local */
  useEffect(() => {
    let cancelled = false;
    fetchServerLeaderboard(gameMode).then((serverEntries) => {
      if (cancelled || !serverEntries.length) return;
      const mergeInto = (
        prev: LeaderboardEntry[],
        writeFn: (entries: LeaderboardEntry[]) => void,
      ): LeaderboardEntry[] => {
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
        const sorted = Array.from(merged.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, 20);
        writeFn(sorted);
        return sorted;
      };
      if (gameMode === 'destroyer') {
        setDefenderLeaderboard((prev) => mergeInto(prev, writeDefenderLeaderboard));
      } else if (gameMode === 'gravity') {
        setGravityLeaderboard((prev) => mergeInto(prev, writeGravityLeaderboard));
      } else {
        setLeaderboard((prev) => mergeInto(prev, writeLeaderboard));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gameMode]);

  /* Check MagicBlock health on mount */
  useEffect(() => {
    let cancelled = false;
    getMagicBlockHealth().then(({ healthy, latency }) => {
      if (cancelled) return;
      setMbHealthy(healthy);
      setMbLatency(latency);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Dismiss HTML preloader if landing directly on this page
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.getElementById('app-preloader');
          if (el) {
            el.style.transition = 'none';
            el.remove();
          }
        }),
      ),
    );
  }, []);

  useEffect(() => {
    fadeOutTransition();
    if (fromAppJump) window.history.replaceState({}, '');
  }, [fromAppJump]);

  const clearTransitionTimers = useCallback(() => {
    transitionTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    transitionTimersRef.current = [];
  }, []);

  useEffect(() => () => clearTransitionTimers(), [clearTransitionTimers]);

  // Cleanup audio on unmount
  useEffect(
    () => () => {
      stopAllAudio();
    },
    [],
  );

  const playerRank = useMemo(() => {
    const board =
      gameMode === 'destroyer' ? defenderLeaderboard : gameMode === 'gravity' ? gravityLeaderboard : leaderboard;
    const idx = board.findIndex((e) => e.address === (address || 'anonymous'));
    return idx >= 0 ? idx + 1 : board.length + 1;
  }, [leaderboard, defenderLeaderboard, gravityLeaderboard, gameMode, address]);

  useEffect(() => {
    const playerAddr = address || 'anonymous';
    const lb =
      gameMode === 'destroyer' ? defenderLeaderboard : gameMode === 'gravity' ? gravityLeaderboard : leaderboard;
    const currentBest = lb.find((e) => e.address === playerAddr)?.score || 0;
    setHighScore(currentBest);
  }, [address, leaderboard, defenderLeaderboard, gravityLeaderboard, gameMode]);

  const handleStart = () => {
    if (gameMode === 'text_quest') {
      startFadeTransition(() => navigate('/text-quest'));
      return;
    }
    // Tournament mode: must join first
    if (playMode === 'tournament' && !activeTournament?.userJoined) {
      toast.error('Join the tournament first!');
      return;
    }
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
    defenderLevel.current = 0;
    defenderKills.current = 0;
    // Init free revives from localStorage as immediate fallback
    freeRevivesLeft.current = hasMintedId ? Math.max(0, FREE_REVIVES_PER_DAY - getDailyRevivesUsed()) : 0;
    pendingGameOver.current = null;
    setIsVictory(false);
    // Only reset challenge submitted if not already submitted for this challenge
    if (!activeChallengeId || sessionStorage.getItem('ip_challenge_submitted') !== activeChallengeId) {
      challengeSubmittedRef.current = false;
    }
    setChallengeResult(null);
    setChallengeSubmitting(false);
    // Then fetch authoritative count from server (async, overrides local)
    if (hasMintedId && address) {
      const mode = gameMode === 'destroyer' ? 'destroyer' : 'orbit';
      fetchServerRevives(address, mode)
        .then((result) => {
          if (result) freeRevivesLeft.current = result.left;
        })
        .catch(() => {});
    }
    setShowContinue(false);
    setMbVerified(false);
    setMbSeed(null);
    setMbSlot(0);
    // Reset refs immediately (don't wait for re-render)
    mbSeedRef.current = null;
    mbSlotRef.current = 0;
    runStartedAtRef.current = Date.now();

    /* Start game — countdown for challenges, instant for normal play */
    trackGameStart(gameMode);
    if (activeChallengeId) {
      setCountdownNum(3);
      setGameState('countdown');
    } else {
      setGameState('playing');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    generateFairSeed()
      .then((seedResult) => {
        clearTimeout(timeout);
        if (seedResult) {
          // Update refs immediately so finalizeDeath always sees latest values
          mbSeedRef.current = seedResult.seed;
          mbSlotRef.current = seedResult.slot;
          setMbSeed(seedResult.seed);
          setMbSlot(seedResult.slot);
        }
      })
      .catch(() => {
        clearTimeout(timeout);
      });
  };

  // Countdown 3-2-1 for challenge mode
  useEffect(() => {
    if (gameState !== 'countdown') return;
    if (countdownNum <= 0) {
      setGameState('playing');
      return;
    }
    const t = setTimeout(() => setCountdownNum((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [gameState, countdownNum]);

  // Auto-start for challenge mode — wait for wallet + hasMintedId before calling handleStart
  const challengeAutoStarted = useRef(false);
  useEffect(() => {
    if (!urlChallengeId || !urlMode) return;
    if (challengeAutoStarted.current) return;
    if (!connected || !address) return; // wait for wallet
    // hasMintedId is loaded — either true or false (fetch completed when address changes)
    challengeAutoStarted.current = true;
    // Notify server that player started playing (prevents opponent from cancelling)
    const jwt = getChallengeJwt();
    if (jwt) {
      fetch(`${getServerBase()}/api/challenge/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ challengeId: urlChallengeId }),
      }).catch(() => {});
    }
    handleStart();
  }, [urlChallengeId, urlMode, connected, address, hasMintedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const finalizeDeath = useCallback(
    (finalScore: number, finalCoins: number, victory = false) => {
      stopAllAudio();
      if (victory) {
        hapticSuccess();
      } else {
        sfxGameOver();
        hapticHeavy();
      }
      setShowContinue(false);
      setIsVictory(victory);
      trackGameOver(gameMode, finalScore, victory);
      setGameState('gameover');
      setScore(finalScore);
      setCoins(finalCoins);

      // Persist coins to local wallet balance immediately (server sync happens in verifyAndPublish after proof)
      // Skip coin earning when playing a challenge — earnings come from challenge result
      const walletAddr = address || 'anonymous';
      if (finalCoins > 0 && !activeChallengeId) {
        const prev = readWalletCoins(walletAddr);
        const next = prev + finalCoins;
        writeWalletCoins(walletAddr, next);
        setTotalCoins(next);
      }
      // Quest auto-tracking (coins already earned during gameplay above)
      if (walletAddr !== 'anonymous') {
        // Quest auto-tracking
        import('@/lib/prismQuests')
          .then(({ getQuestState, incrementQuest }) => {
            let qs = getQuestState(walletAddr);
            qs = incrementQuest(qs, 'daily_game').state;
            qs = incrementQuest(qs, 'ot_first_game').state;
            qs = incrementQuest(qs, 'weekly_games5').state;
            // ot_score1000: only for orbit/destroyer (gravity score = seconds, not points)
            if (gameMode !== 'gravity' && finalScore >= 1000) {
              qs = incrementQuest(qs, 'ot_score1000', finalScore).state;
            }
            if (finalScore > highScore) {
              void incrementQuest(qs, 'daily_highscore');
            }
          })
          .catch(() => {});
        invalidateCompositeCache(walletAddr);
      }
      const startedAtMs = runStartedAtRef.current || Date.now();
      const endedAtMs = Date.now();
      const playerAddr = address || 'anonymous';
      const newEntry: LeaderboardEntry = {
        id: Date.now().toString(),
        address: playerAddr,
        score: finalScore,
        playedAt: new Date().toISOString(),
      };

      const verifyAndPublish = async () => {
        let proof: GameSessionProof | null = null;
        const actualDurationSec = Math.round((endedAtMs - startedAtMs) / 1000);
        const sessionSurvivalTime = gameMode === 'destroyer' ? formatTime(actualDurationSec) : formatTime(finalScore);
        // Wait for seed if not ready yet (up to 4s — covers short Defender games)
        let curSeed = mbSeedRef.current;
        let curSlot = mbSlotRef.current;
        if (!curSeed || curSlot <= 0) {
          for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 100));
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
          // Server-side proof is the real verification — mark verified
          setMbVerified(true);
        } else if (curSeed) {
          // Verify seed against MagicBlock — timeout fallback to false
          const verifyTimeout = setTimeout(() => setMbVerified(false), 6000);
          verifyGameSessionSeed(curSeed, curSlot)
            .then((ok) => {
              clearTimeout(verifyTimeout);
              setMbVerified(ok);
            })
            .catch(() => {
              clearTimeout(verifyTimeout);
              setMbVerified(false);
            });
        } else {
          // No seed was generated — unverified
          setMbVerified(false);
        }

        // Sync coins to server with verified session proof
        // Skip coin earning when playing a challenge — earnings come from challenge result
        if (proof?.id && finalCoins > 0 && !activeChallengeId) {
          const walletAddr = playerAddr;
          const prev = readWalletCoins(walletAddr);
          syncCoinsToServer(walletAddr, prev, finalCoins, gameMode, proof.id);
        }

        // Submit to server leaderboard with verified session proof (skip for challenges)
        if (proof?.id && !activeChallengeId) {
          submitToServerLeaderboard({
            address: playerAddr,
            score: finalScore,
            playedAt: newEntry.playedAt,
            gameType: gameMode,
            gameSessionId: proof.id,
          });
        }

        // Submit to tournament only when in tournament mode and joined
        if (playMode === 'tournament' && activeTournament?.userJoined) {
          submitToTournament(finalScore, proof?.id ?? undefined);
        }

        // Challenge submit — must be inside verifyAndPublish to have proof.id
        if (activeChallengeId && !challengeSubmittedRef.current) {
          challengeSubmittedRef.current = true;
          sessionStorage.setItem('ip_challenge_submitted', activeChallengeId);
          setChallengeSubmitting(true);
          submitChallengeScore(activeChallengeId, finalScore, proof?.id)
            .then((result) => {
              setChallengeSubmitting(false);
              sessionStorage.removeItem('ip_active_challenge');
              if (result.ok && result.challenge) {
                setChallengeResult(result.challenge);
                if (result.challenge.status === 'completed') {
                  if (playerAddr) invalidateBalanceCache(playerAddr);
                  setTimeout(() => setShowBattleResult(true), 1500);
                  if (result.challenge.winner === playerAddr) hapticSuccess();
                  else hapticError();
                } else {
                  toast.success('Score submitted! Waiting for opponent...');
                }
              } else {
                toast.error(result.error || 'Failed to submit challenge score');
              }
            })
            .catch(() => {
              setChallengeSubmitting(false);
              toast.error('Failed to submit challenge score');
            });
        }
      };

      void verifyAndPublish();

      if (gameMode === 'orbit') {
        const stats = updatePlayerStats(finalScore);
        setPlayerStats(stats);
        const { newlyUnlocked, all } = checkAchievements(finalScore);
        setAchievements(all);
        if (newlyUnlocked.length > 0) {
          setNewAchievements(newlyUnlocked);
          newlyUnlocked.forEach((a) => {
            toast.success(`Achievement Unlocked: ${a.icon} ${a.name}!`);
          });
          const walletAddr = address || 'anonymous';
          const allUnlockedIds = all.filter((a) => a.unlocked).map((a) => a.id);
          syncUnlockedToServer(walletAddr, allUnlockedIds);
        }
      } else if (gameMode === 'destroyer') {
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
      } else if (gameMode === 'gravity') {
        const sessionColumns = gravitySessionStatsRef.current.columns;
        const sessionCrystals = gravitySessionStatsRef.current.crystals;
        const survivalTime = finalScore; // gravity score = seconds survived
        const gStats = updateGravityStats(survivalTime, sessionColumns, sessionCrystals, finalScore);
        const { newlyUnlocked: gravNew, all: gravAll } = checkGravityAchievements({
          survivalTime,
          columns: sessionColumns,
          crystals: sessionCrystals,
          score: finalScore,
          totalPlayTime: gStats.totalPlayTime,
          totalColumns: gStats.totalColumns,
          totalCrystals: gStats.totalCrystals,
        });
        setGravityAchievements(gravAll);
        if (gravNew.length > 0) {
          gravNew.forEach((a) => {
            toast.success(`Achievement Unlocked: ${a.icon} ${a.name}!`);
          });
        }
        // Reset session stats ref for next run
        gravitySessionStatsRef.current = { columns: 0, crystals: 0 };
      }

      if (gameMode === 'destroyer') {
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
      } else if (gameMode === 'gravity') {
        setGravityLeaderboard((prev) => {
          const existing = prev.findIndex((e) => e.address === playerAddr);
          let next = [...prev];
          if (existing !== -1) {
            if (finalScore > next[existing].score) next[existing] = newEntry;
          } else {
            next.push(newEntry);
          }
          next.sort((a, b) => b.score - a.score);
          next = next.slice(0, 20);
          writeGravityLeaderboard(next);
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

      // Challenge submit moved into verifyAndPublish (with gameSessionId proof)

      // Tournament submit moved into verifyAndPublish (with gameSessionId)

      if (finalScore > highScore) {
        setIsNewBest(true);
        setHighScore(finalScore);
        toast.success(`New High Score: ${fmtScore(finalScore, gameMode)}!`);
      } else {
        setIsNewBest(false);
      }
    },
    [address, gameMode, highScore, activeChallengeId, activeTournament, submitToTournament, playMode],
  );

  const handleGameOver = useCallback(
    (finalScore: number, finalCoins: number, victory?: boolean) => {
      // Victory — no revive, go straight to game over
      if (victory) {
        finalizeDeath(finalScore, finalCoins, true);
        return;
      }
      // Gravity mode does not support revive — go straight to game over
      if (gameMode === 'gravity') {
        finalizeDeath(finalScore, finalCoins, false);
        return;
      }
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
    [finalizeDeath, connected, gameMode],
  );

  // Gravity-specific game over handler — captures extra session stats then calls shared handler
  const handleGravityGameOver = useCallback(
    (finalScore: number, finalCoins: number, extraStats?: { columns: number; crystals: number }) => {
      if (extraStats) {
        gravitySessionStatsRef.current = extraStats;
      }
      handleGameOver(finalScore, finalCoins, undefined);
    },
    [handleGameOver],
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
          toast.error(`Insufficient SKR`, {
            description: `Need ${e.required} SKR, you have ${e.skrBalance.toFixed(1)} SKR.`,
          });
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
      toast.error('Connect wallet to save score on-chain');
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
        toast.error('Insufficient SOL', { description: detail || 'Top up your wallet and try again.' });
        return;
      }
      if (result.success && result.txSignature) {
        setLastTxSignature(result.txSignature);
        setOnchainBonusApplied(true);

        // Apply on-chain bonus to coins and persist (use current state, not stale localStorage)
        const bonusCoins = Math.round(coins * (ONCHAIN_BONUS_MULTIPLIER - 1));
        if (bonusCoins > 0 && address) {
          setTotalCoins((prev) => {
            const next = prev + bonusCoins;
            writeWalletCoins(address, next);
            syncCoinsToServer(address, next, bonusCoins);
            return next;
          });
        }

        toast.success(`Score on-chain! +${bonusCoins} bonus coins (×${ONCHAIN_BONUS_MULTIPLIER})`);
        hapticSuccess();

        // Update the correct leaderboard per mode
        if (gameMode === 'destroyer') {
          setDefenderLeaderboard((prev) => {
            const playerAddr = address!;
            const idx = prev.findIndex((e) => e.address === playerAddr);
            if (idx !== -1) {
              const next = prev.map((e, i) => (i === idx ? { ...e, txSignature: result.txSignature } : e));
              writeDefenderLeaderboard(next);
              submitToServerLeaderboard({
                address: playerAddr,
                score: next[idx].score,
                playedAt: next[idx].playedAt,
                txSignature: result.txSignature,
                gameType: 'destroyer',
              });
              return next;
            }
            return prev;
          });
        } else if (gameMode === 'gravity') {
          setGravityLeaderboard((prev) => {
            const playerAddr = address!;
            const idx = prev.findIndex((e) => e.address === playerAddr);
            if (idx !== -1) {
              const next = prev.map((e, i) => (i === idx ? { ...e, txSignature: result.txSignature } : e));
              writeGravityLeaderboard(next);
              submitToServerLeaderboard({
                address: playerAddr,
                score: next[idx].score,
                playedAt: next[idx].playedAt,
                txSignature: result.txSignature,
                gameType: 'gravity',
              });
              return next;
            }
            return prev;
          });
        } else {
          setLeaderboard((prev) => {
            const playerAddr = address!;
            const idx = prev.findIndex((e) => e.address === playerAddr);
            if (idx !== -1) {
              const next = prev.map((e, i) => (i === idx ? { ...e, txSignature: result.txSignature } : e));
              writeLeaderboard(next);
              submitToServerLeaderboard({
                address: playerAddr,
                score: next[idx].score,
                playedAt: next[idx].playedAt,
                txSignature: result.txSignature,
                gameType: gameMode,
              });
              return next;
            }
            return prev;
          });
        }
      } else {
        toast.error(result.error || 'Failed to commit score');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsCommitting(false);
    }
  };

  const claimingAchRef = useRef(false);
  const handleClaimAchievement = async (achId: string) => {
    if (!address) {
      toast.error('Connect wallet to claim');
      return;
    }
    if (claimingAchRef.current) return;
    claimingAchRef.current = true;
    try {
      const walletAddr = address;
      const orbitAch = achievements.find((a) => a.id === achId);
      const defAch = defenderAchievements.find((a) => a.id === achId);
      const gravAch = gravityAchievements.find((a) => a.id === achId);
      const ach = orbitAch || defAch || gravAch;
      if (!ach || !ach.unlocked || ach.claimed) return;
      const isDefAch = !!defAch && !orbitAch;
      const isGravAch = !!gravAch && !orbitAch && !defAch;
      const reward = isGravAch
        ? (GRAVITY_COIN_REWARDS[ach.tier] ?? 0)
        : isDefAch
          ? (DEFENDER_COIN_REWARDS[ach.tier] ?? 0)
          : (ACHIEVEMENT_COIN_REWARDS[ach.tier] ?? 0);
      if (reward <= 0) return;
      const serverResult = await claimAchievementOnServer(walletAddr, achId, reward);
      if (!serverResult.ok) {
        if (isGravAch) {
          const { all } = claimGravityReward(achId);
          setGravityAchievements(all);
        } else if (isDefAch) {
          const { all } = claimDefenderReward(achId);
          setDefenderAchievements(all);
        } else {
          const { all } = claimAchievementReward(achId);
          setAchievements(all);
        }
        toast.error('Achievement already claimed!');
        return;
      }
      if (isGravAch) {
        const { all } = claimGravityReward(achId);
        setGravityAchievements(all);
      } else if (isDefAch) {
        const { all } = claimDefenderReward(achId);
        setDefenderAchievements(all);
      } else {
        const { all } = claimAchievementReward(achId);
        setAchievements(all);
      }
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
    } catch {
      toast.error('Failed to claim achievement');
    } finally {
      claimingAchRef.current = false;
    }
  };

  const handleShare = () => {
    const isDefMode = gameMode === 'destroyer';
    const isGravity = gameMode === 'gravity';
    const scoreText = isDefMode ? `${formatPoints(score)} pts` : isGravity ? `${score} columns` : formatTime(score);
    const gameName = isDefMode ? 'Cosmic Defender' : isGravity ? 'Gravity Runner' : 'Orbit Survival';
    // AI-style fun commentary based on performance
    let lines: string[];
    if (isDefMode) {
      if (score >= 50000)
        lines = ['The cosmos trembles before me!', 'Is this even legal?!', 'Galactic domination achieved!'];
      else if (score >= 20000)
        lines = ['Getting dangerous out here!', "Enemies didn't stand a chance!", 'On fire today!'];
      else if (score >= 5000)
        lines = ['Warming up the lasers!', 'The force is strong with this one!', 'Not bad for a space cadet!'];
      else lines = ['First steps to galactic glory!', 'Every legend starts somewhere!', 'Loading skill module...'];
    } else {
      if (score >= 300)
        lines = ['5+ min dodging asteroids like a boss!', 'Gravity who?!', 'Orbital deity status unlocked!'];
      else if (score >= 120)
        lines = ['Dancing with asteroids!', '2+ minutes in the chaos zone!', 'Black holes fear me!'];
      else if (score >= 60) lines = ['1 minute club!', 'Asteroid ballet in progress!', 'Getting the hang of zero-G!'];
      else lines = ['Quick orbit, big dreams!', 'Asteroids: 1, Me: loading...', 'Next run is THE run!'];
    }
    const comment = lines[Math.floor(Math.random() * lines.length)];
    let rankText = '';
    if (playerRank <= 3) rankText = `\n\nTOP ${playerRank} on the leaderboard!`;
    else if (playerRank <= 10) rankText = `\n\nBroke into the TOP 10! (#${playerRank})`;
    else if (playerRank <= 20) rankText = `\n\nRanked #${playerRank} globally`;
    const onchain = lastTxSignature ? `\nVerified on-chain: solscan.io/tx/${lastTxSignature.slice(0, 16)}...` : '';
    const text = `${comment}\n\n${scoreText} in ${gameName} on @IdentityPrism!${rankText}${onchain}\n\nCan you beat me?`;
    const url = 'https://identityprism.xyz/game';
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    if (isCapacitor || isMobile) {
      window.location.href = twitterUrl;
    } else {
      window.open(twitterUrl, '_blank');
    }
  };

  const [showChallengeExitWarning, setShowChallengeExitWarning] = useState(false);

  const handleAbandonChallenge = useCallback(async () => {
    if (!activeChallengeId) return;
    try {
      const jwt = getChallengeJwt();
      if (jwt) {
        const base = getServerBase();
        await fetch(`${base}/api/challenge/abandon`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ challengeId: activeChallengeId }),
        });
      }
    } catch {
      /* ignore */
    }
    setShowChallengeExitWarning(false);
    sessionStorage.removeItem('ip_active_challenge');
    sessionStorage.removeItem('ip_challenge_submitted');
    startFadeTransition(() => goBack(navigate));
  }, [activeChallengeId, navigate]);

  const handleJumpBackToPrism = useCallback(() => {
    if (isJumpingBack) return;

    // If playing → return to game menu (start screen)
    if (gameState === 'playing') {
      stopAllAudio();
      setGameState('start');
      return;
    }

    // If game over → go back to hub (main menu)
    if (gameState === 'gameover') {
      stopAllAudio();
      setIsJumpingBack(true);
      clearTransitionTimers();
      transitionTimersRef.current.push(
        window.setTimeout(() => {
          startFadeTransition(() => goBack(navigate));
        }, 200),
      );
      return;
    }

    // Challenge exit protection — warn if leaving without playing
    if (activeChallengeId && !challengeSubmittedRef.current) {
      setShowChallengeExitWarning(true);
      return;
    }

    // If on start screen → go back to hub
    setIsJumpingBack(true);
    clearTransitionTimers();

    const jumpGate = document.querySelector('.league-jumpgate') as HTMLElement | null;
    if (jumpGate) {
      jumpGate.style.animation = 'league-jumpgate-open 0.45s cubic-bezier(0.22,1,0.36,1) forwards';
      jumpGate.style.zIndex = '40';
    }

    transitionTimersRef.current.push(
      window.setTimeout(() => {
        startFadeTransition(() => goBack(navigate));
      }, 240),
    );
  }, [isJumpingBack, clearTransitionTimers, navigate, gameState, activeChallengeId]);

  return (
    <div className="prism-league-page relative w-full h-screen overflow-hidden">
      {/* Moving starfield background — always visible, parallax via CSS var */}
      <div id="game-bg-parallax" className="absolute inset-0 z-0 pointer-events-none">
        <CosmicStarfield
          mode="drift"
          driftDirection={
            gameState !== 'playing' && gameState !== 'countdown'
              ? 'right'
              : gameMode === 'gravity'
                ? 'left'
                : gameMode === 'destroyer'
                  ? 'down'
                  : 'right'
          }
          paused={gameState === 'gameover'}
        />
      </div>
      <div className="league-aurora league-aurora--a" aria-hidden="true" />
      <div className="league-aurora league-aurora--b" aria-hidden="true" />

      {/* 3D Scene — switches based on selected game mode */}
      <div className="absolute inset-0 z-0">
        {gameMode === 'orbit' && (
          <OrbitSurvivalScene
            gameState={gameState}
            onScore={throttledSetScore}
            onCoins={throttledSetCoins}
            onGameOver={handleGameOver}
            onCombo={handleCombo}
            reviveRef={reviveRef}
            traits={traits}
            walletScore={0}
            hasMintedId={hasMintedId}
            shipSkin={equippedSkin}
            shipAura={equippedAura}
            shipStats={shipStats}
            challengeMode={!!activeChallengeId}
          />
        )}
        {gameMode === 'destroyer' && (
          <AsteroidDestroyerScene
            gameState={gameState}
            onScore={throttledSetScore}
            onCoins={throttledSetCoins}
            onGameOver={handleGameOver}
            onLevel={handleDefLevel}
            onActiveBonuses={handleActiveBonuses}
            reviveRef={reviveRef}
            traits={traits}
            walletScore={0}
            hasMintedId={hasMintedId}
            shipSkin={equippedSkin}
            shipAura={equippedAura}
            shipStats={shipStats}
            challengeMode={!!activeChallengeId}
          />
        )}
        {gameMode === 'gravity' && (
          <GravityRunnerScene
            gameState={gameState}
            onScore={throttledSetScore}
            onCoins={throttledSetCoins}
            onGameOver={handleGravityGameOver}
            reviveRef={reviveRef}
            traits={traits}
            walletScore={0}
            hasMintedId={hasMintedId}
            shipSkin={equippedSkin}
            shipAura={equippedAura}
            shipStats={shipStats}
            challengeMode={!!activeChallengeId}
          />
        )}
      </div>

      {/* FPS overlay */}
      {gameState === 'playing' && <FpsOverlay />}

      {/* Challenge countdown overlay */}
      {gameState === 'countdown' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="text-center">
            <div
              key={countdownNum}
              className="text-8xl font-black text-white"
              style={{
                textShadow: '0 0 40px rgba(56,189,248,0.6), 0 0 80px rgba(56,189,248,0.3)',
                animation: 'countdown-pop 0.9s ease-out forwards',
              }}
            >
              {countdownNum > 0 ? countdownNum : 'GO!'}
            </div>
            <p className="text-sm text-white/40 mt-6 font-bold tracking-widest uppercase">Challenge Mode</p>
          </div>
        </div>
      )}

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
            className={`league-jumpgate shrink-0 ${isJumpingBack ? 'is-active' : ''}`}
            onClick={handleJumpBackToPrism}
            disabled={isJumpingBack}
          >
            <span className="league-jumpgate__halo" />
            <span className="league-jumpgate__ship" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M12 2C12 2 8.1 6.1 8.1 12.1C8.1 15.9 9.5 18.8 10.1 20L12 22L13.9 20C14.5 18.8 15.9 15.9 15.9 12.1C15.9 6.1 12 2 12 2Z"
                  fill="url(#leagueShipGrad)"
                  stroke="rgba(56,189,248,0.55)"
                  strokeWidth="0.6"
                />
                <path d="M8.2 12L4.2 15L8.2 14Z" fill="rgba(56,189,248,0.4)" />
                <path d="M15.8 12L19.8 15L15.8 14Z" fill="rgba(56,189,248,0.4)" />
                <circle cx="12" cy="8.8" r="1.6" fill="rgba(34,211,238,0.95)" />
                <path d="M10.8 18.2L12 20.6L13.2 18.2" fill="rgba(251,146,60,0.95)" />
                <defs>
                  <linearGradient id="leagueShipGrad" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="rgba(34,211,238,0.95)" />
                    <stop offset="0.45" stopColor="rgba(148,163,184,0.95)" />
                    <stop offset="1" stopColor="rgba(100,116,139,0.9)" />
                  </linearGradient>
                </defs>
              </svg>
            </span>
            <span className="league-jumpgate__text hidden sm:inline-flex">
              <strong>{gameState === 'playing' ? 'Game Menu' : gameState === 'gameover' ? 'Home' : 'Home'}</strong>
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
              {connected ? formatAddress(address) : 'Connect'}
            </Button>
          </div>
        </header>

        {/* Main content area (title + game area) */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Title — centered in the gap above the card, hidden during play/countdown */}
          {gameState !== 'playing' && gameState !== 'countdown' && (
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
            {gameState === 'playing' && (
              <div className="absolute top-1 left-1/2 -translate-x-1/2 flex flex-col items-center">
                {gameMode === 'gravity' ? (
                  /* Gravity mode: SCORE (columns) and COINS side by side */
                  <>
                    <div className="flex items-center gap-4 sm:gap-6">
                      {/* SCORE display */}
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] uppercase tracking-widest text-cyan-400/60 font-semibold">
                          Score
                        </span>
                        <span
                          ref={_scoreDomRef}
                          className="text-3xl sm:text-4xl md:text-5xl font-black text-white tabular-nums tracking-tight drop-shadow-[0_0_20px_rgba(255,255,255,0.5)]"
                        >
                          {score}
                        </span>
                      </div>
                      {/* Divider */}
                      <div className="w-px h-10 sm:h-12 bg-white/15" />
                      {/* COINS display */}
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] uppercase tracking-widest text-yellow-400/60 font-semibold">
                          Coins
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Coins className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-400" />
                          <span
                            ref={_coinsDomRef}
                            className="text-2xl sm:text-3xl md:text-4xl font-black text-yellow-400 tabular-nums tracking-tight drop-shadow-[0_0_16px_rgba(234,179,8,0.4)]"
                          >
                            {coins}
                          </span>
                        </div>
                      </div>
                    </div>
                    {highScore > 0 && (
                      <span className="text-[9px] sm:text-[10px] text-cyan-400/60 uppercase tracking-widest font-semibold mt-0.5">
                        Best: {fmtScore(highScore, gameMode)}
                      </span>
                    )}
                    {totalCoins > 0 && (
                      <span className="text-[9px] text-white/30 font-bold tabular-nums">Total: {totalCoins}</span>
                    )}
                  </>
                ) : (
                  /* Orbit / Destroyer mode: original layout */
                  <>
                    <span
                      ref={_scoreDomRef}
                      className="text-3xl sm:text-4xl md:text-5xl font-black text-white tabular-nums tracking-tight drop-shadow-[0_0_20px_rgba(255,255,255,0.5)]"
                    >
                      {fmtScore(score, gameMode)}
                    </span>
                    {highScore > 0 && (
                      <span className="text-[9px] sm:text-[10px] text-cyan-400/60 uppercase tracking-widest font-semibold">
                        Best: {fmtScore(highScore, gameMode)}
                      </span>
                    )}

                    {/* Coins + Level/Wave — single compact row */}
                    <div className="flex items-center gap-1.5 sm:gap-3 mt-1">
                      <div className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full bg-black/40 border border-yellow-500/20">
                        <Coins className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-yellow-400" />
                        <span
                          ref={_coinsDomRef}
                          className="text-[9px] sm:text-[10px] text-yellow-400/80 font-bold tabular-nums"
                        >
                          {coins}
                        </span>
                      </div>
                      {totalCoins > 0 && (
                        <span className="text-[9px] text-white/30 font-bold tabular-nums">Total: {totalCoins}</span>
                      )}
                      {gameMode === 'destroyer' && defLevelInfo.name && (
                        <span className="text-[9px] sm:text-[10px] font-bold text-cyan-300/70 uppercase">
                          Lv.{defLevelInfo.level}
                        </span>
                      )}
                      {gameMode === 'destroyer' && defLevelInfo.wave > 0 && (
                        <span className="text-[9px] sm:text-[10px] font-bold text-white/40 uppercase">
                          W{defLevelInfo.wave}/4
                        </span>
                      )}
                    </div>
                  </>
                )}

                {/* Combo Counter — DOM-driven, no React re-render */}
                {gameMode === 'orbit' && (
                  <div
                    ref={_comboDomRef}
                    className="mt-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-orange-500/20 to-yellow-500/20 border border-orange-400/30 items-center"
                    style={{ display: 'none', opacity: 0, transition: 'opacity 0.3s' }}
                  />
                )}

                {/* Difficulty (orbit) — compact */}
                {gameMode === 'orbit' && score > 0 && (
                  <div className="flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full bg-black/40 border border-white/10">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => {
                        const level = Math.min(5, Math.floor(score / 20) + 1);
                        return (
                          <div
                            key={i}
                            className={`w-1 h-2 sm:w-1.5 sm:h-3 rounded-sm transition-colors duration-500 ${i < level ? (level <= 2 ? 'bg-green-400/80' : level <= 3 ? 'bg-yellow-400/80' : 'bg-red-400/80') : 'bg-white/10'}`}
                          />
                        );
                      })}
                    </div>
                    <span className="text-[8px] sm:text-[9px] text-white/30 font-bold uppercase">
                      {score < 20
                        ? 'Easy'
                        : score < 40
                          ? 'Normal'
                          : score < 60
                            ? 'Hard'
                            : score < 80
                              ? 'Insane'
                              : 'Cosmic'}
                    </span>
                  </div>
                )}

                {hasMintedId && (
                  <div className="flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                    <Coins className="w-2.5 h-2.5 text-yellow-400" />
                    <span className="text-[8px] sm:text-[9px] text-yellow-300/80 font-bold uppercase">
                      ×2 Coin Bonus
                    </span>
                  </div>
                )}

                {mbSeed && (
                  <div className="hidden sm:flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full bg-black/40 border border-purple-500/20">
                    <span className="text-[8px]">⚡</span>
                    <span className="text-[8px] text-purple-300/60 font-mono">MB: {mbSeed.slice(0, 6)}…</span>
                  </div>
                )}

                {/* Challenge Mode banner */}
                {activeChallengeId && (
                  <div
                    className="mt-1 flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-400/40 bg-amber-500/10"
                    style={{ boxShadow: '0 0 12px rgba(245,158,11,0.2)', animation: 'pulse 2s ease-in-out infinite' }}
                  >
                    <Swords className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
                      Challenge Mode
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Active bonuses bar — bottom of screen (Defender) — DOM-driven */}
            {gameMode === 'destroyer' && (
              <div
                ref={_bonusesDomRef}
                className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none"
                style={{
                  display: 'none',
                  bottom: 'max(6px, env(safe-area-inset-bottom, 4px))',
                  flexDirection: 'row',
                  flexWrap: 'nowrap',
                  gap: '10px',
                  justifyContent: 'center',
                  alignItems: 'flex-end',
                }}
              />
            )}

            {/* Level transition banner overlay */}
            {gameState === 'playing' && gameMode === 'destroyer' && defLevelInfo.banner && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-500">
                  <span className="text-lg font-bold text-cyan-400/60 uppercase tracking-[0.3em]">
                    Level {defLevelInfo.level}
                  </span>
                  <span className="text-3xl md:text-4xl font-black text-white drop-shadow-[0_0_30px_rgba(6,182,212,0.6)]">
                    {defLevelInfo.name}
                  </span>
                </div>
              </div>
            )}

            {/* ═══ START SCREEN ═══ */}
            {gameState === 'start' && (
              <div className="absolute inset-0 pointer-events-auto flex flex-col items-center pt-2 pb-4">
                {/* Floating carousel arrows — outside card, on screen edges */}
                <button
                  className="fixed left-2 top-1/2 -translate-y-1/2 z-30 w-11 h-11 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-md border border-white/15 text-white/60 hover:text-white hover:bg-white/15 active:scale-90 transition-all shadow-lg"
                  onClick={() => {
                    const idx = GAME_MODES.findIndex((m) => m.id === gameMode);
                    const prev = (idx - 1 + GAME_MODES.length) % GAME_MODES.length;
                    setGameMode(GAME_MODES[prev].id);
                  }}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  className="fixed right-2 top-1/2 -translate-y-1/2 z-30 w-11 h-11 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-md border border-white/15 text-white/60 hover:text-white hover:bg-white/15 active:scale-90 transition-all shadow-lg"
                  onClick={() => {
                    const idx = GAME_MODES.findIndex((m) => m.id === gameMode);
                    const next = (idx + 1) % GAME_MODES.length;
                    setGameMode(GAME_MODES[next].id);
                  }}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div
                  className="max-w-md w-full mx-4 rounded-[32px] border border-white/10 bg-[#020408]/95 backdrop-blur-xl shadow-[0_0_60px_-8px_rgba(0,150,255,0.25),0_0_120px_-20px_rgba(100,200,255,0.1)] overflow-y-auto league-scroll"
                  style={{ maxHeight: 'calc(100svh - 16px)' }}
                >
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
                          Prism League
                        </h2>
                        <p className="text-cyan-200/40 text-xs max-w-[260px]">Earn coins & climb the ranks</p>
                      </div>
                    </div>

                    {/* Game Mode Carousel — swipeable */}
                    <div
                      className="w-full mb-4 relative touch-pan-y"
                      onTouchStart={(e) => {
                        const touch = e.touches[0];
                        (e.currentTarget as unknown as Record<string, number>)._swipeStartX = touch.clientX;
                        (e.currentTarget as unknown as Record<string, number>)._swipeStartY = touch.clientY;
                      }}
                      onTouchEnd={(e) => {
                        const startX = (e.currentTarget as unknown as Record<string, number>)._swipeStartX;
                        const startY = (e.currentTarget as unknown as Record<string, number>)._swipeStartY;
                        if (startX == null) return;
                        const touch = e.changedTouches[0];
                        const dx = touch.clientX - startX;
                        const dy = touch.clientY - startY;
                        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
                          const idx = GAME_MODES.findIndex((m) => m.id === gameMode);
                          if (dx < 0) {
                            setGameMode(GAME_MODES[(idx + 1) % GAME_MODES.length].id);
                          } else {
                            setGameMode(GAME_MODES[(idx - 1 + GAME_MODES.length) % GAME_MODES.length].id);
                          }
                        }
                      }}
                    >
                      {/* Current game card */}
                      {(() => {
                        const mode = GAME_MODES.find((m) => m.id === gameMode)!;
                        return (
                          <div className="relative rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/15 via-cyan-500/5 to-purple-500/10 px-5 py-4 text-center transition-all duration-300 shadow-[0_0_24px_rgba(6,182,212,0.15)]">
                            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-purple-500/5 rounded-2xl" />
                            <div className="relative">
                              {mode.cover ? (
                                <img
                                  src={mode.cover}
                                  alt={mode.name}
                                  className="w-full h-24 object-cover rounded-lg mb-2 opacity-80"
                                  loading="lazy"
                                />
                              ) : (
                                <span className="text-3xl mb-2 block">{mode.icon}</span>
                              )}
                              <div className="text-sm font-black text-cyan-200 tracking-wide mb-1">{mode.name}</div>
                              <div className="text-[11px] text-white/40 leading-relaxed">{mode.desc}</div>
                              <div className="mt-2 text-[10px] text-cyan-400/50 font-medium">{mode.controls}</div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Dot indicators */}
                      <div className="flex justify-center gap-1.5 mt-2.5">
                        {GAME_MODES.map((mode) => (
                          <button
                            key={mode.id}
                            className="p-2 -m-2 flex items-center justify-center"
                            onClick={() => setGameMode(mode.id)}
                          >
                            <span
                              className={`w-2 h-2 rounded-full transition-all duration-300 block ${
                                gameMode === mode.id
                                  ? 'bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.6)] scale-125'
                                  : 'bg-white/20 hover:bg-white/40'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* ═══ PLAY MODE SELECTOR ═══ */}
                    {gameMode !== 'text_quest' && (
                      <>
                        <div className="w-full mb-4 flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                          <button
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
                              playMode === 'free'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : 'text-white/40 hover:text-white/60 border border-transparent'
                            }`}
                            onClick={() => setPlayMode('free')}
                          >
                            <Play className="w-3.5 h-3.5 fill-current" /> Free Play
                          </button>
                          <button
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
                              playMode === 'tournament'
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                : 'text-white/40 hover:text-white/60 border border-transparent'
                            }`}
                            onClick={() => setPlayMode('tournament')}
                          >
                            <Trophy className="w-3.5 h-3.5" /> Tournament
                          </button>
                        </div>

                        {/* ═══ TOURNAMENT SECTION ═══ */}
                        {playMode === 'tournament' && (
                          <div className="w-full mb-4 space-y-3">
                            {/* Tier sub-tabs */}
                            <div className="flex gap-1 rounded-xl bg-white/[0.03] p-1 border border-white/[0.06]">
                              {TOURNAMENT_TIERS.map((t) => (
                                <button
                                  key={t.key}
                                  onClick={() => setTournamentTier(t.key)}
                                  className={`flex-1 py-2 px-2 rounded-xl text-[11px] font-bold transition-all ${
                                    tournamentTier === t.key
                                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                      : 'text-white/40 hover:text-white/60 border border-transparent'
                                  }`}
                                >
                                  <div>{t.shortLabel}</div>
                                  <div
                                    className={`text-[9px] mt-0.5 ${tournamentTier === t.key ? 'text-purple-400/70' : 'text-white/20'}`}
                                  >
                                    {t.fee.toLocaleString()} coins
                                  </div>
                                </button>
                              ))}
                            </div>

                            {/* Tournament card */}
                            {tournamentLoading ? (
                              <div className="flex items-center justify-center py-8 text-white/30">
                                <Orbit className="w-5 h-5 animate-spin mr-2" /> Loading tournaments...
                              </div>
                            ) : activeTournament && !activeTournament.isEnded ? (
                              <div className="rounded-xl border border-purple-500/25 bg-purple-500/[0.06] overflow-hidden">
                                {/* Header */}
                                <div className="px-4 py-2.5 flex items-center gap-2 border-b border-purple-500/15">
                                  <Swords className="w-4 h-4 text-purple-400" />
                                  <span className="text-sm font-bold text-purple-300">
                                    {activeTournament.label ||
                                      TOURNAMENT_TIERS.find((t) => t.key === tournamentTier)?.shortLabel}{' '}
                                    Tournament
                                  </span>
                                  <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                                    LIVE
                                  </span>
                                </div>
                                {/* Stats row */}
                                <div className="grid grid-cols-3 divide-x divide-white/[0.05] border-b border-white/[0.05]">
                                  <div className="flex flex-col items-center py-2.5">
                                    <Clock className="w-3.5 h-3.5 text-white/30 mb-0.5" />
                                    <span className="text-[10px] text-white/30">Time Left</span>
                                    <span className="text-xs font-bold text-purple-300">{timeLeft || '—'}</span>
                                  </div>
                                  <div className="flex flex-col items-center py-2.5">
                                    <Coins className="w-3.5 h-3.5 text-yellow-400/60 mb-0.5" />
                                    <span className="text-[10px] text-white/30">Prize Pool</span>
                                    <span className="text-xs font-bold text-yellow-300">
                                      {activeTournament.prizePool.toLocaleString()}
                                    </span>
                                    <span className="text-[8px] text-emerald-400/60">+base prizes</span>
                                  </div>
                                  <div className="flex flex-col items-center py-2.5">
                                    <Target className="w-3.5 h-3.5 text-white/30 mb-0.5" />
                                    <span className="text-[10px] text-white/30">Entries</span>
                                    <span className="text-xs font-bold text-white/70">
                                      {activeTournament.entryCount}
                                    </span>
                                  </div>
                                </div>
                                {/* Prize distribution */}
                                <div className="px-4 py-2 border-b border-white/[0.05]">
                                  <p className="text-[9px] text-white/30 uppercase tracking-wider font-bold mb-1">
                                    Prize Distribution (15% burn)
                                  </p>
                                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                                    {PRIZE_DIST[tournamentTier].map((r) => (
                                      <div key={r.place} className="flex justify-between text-[10px] gap-1">
                                        <span
                                          className={
                                            r.place === '1st'
                                              ? 'text-yellow-400'
                                              : r.place === '2nd'
                                                ? 'text-gray-300'
                                                : r.place === '3rd'
                                                  ? 'text-amber-600'
                                                  : 'text-white/40'
                                          }
                                        >
                                          {r.place}
                                        </span>
                                        <span className="text-white/50 font-mono text-[9px]">
                                          {r.pct}
                                          <span className="text-emerald-400/70"> +{(r.base / 1000).toFixed(1)}k</span>
                                          <span className="text-cyan-400/50"> +{r.xp}xp</span>
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                {/* Standings (if joined) */}
                                {activeTournament.userJoined &&
                                  activeTournament.entries &&
                                  activeTournament.entries.length > 0 && (
                                    <div className="border-b border-white/[0.05]">
                                      <p className="px-4 py-1.5 text-[9px] uppercase tracking-wider font-bold text-white/30">
                                        Top Standings
                                      </p>
                                      {activeTournament.entries.slice(0, 5).map((entry, idx) => {
                                        const isMine = entry.address === address;
                                        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                                        return (
                                          <div
                                            key={`${entry.address}-${idx}`}
                                            className={`flex items-center gap-2 px-4 py-1.5 text-xs ${isMine ? 'bg-purple-500/10' : ''}`}
                                          >
                                            {medal ? (
                                              <span className="w-5 text-center">{medal}</span>
                                            ) : (
                                              <span className="w-5 text-center text-[10px] text-white/30">
                                                {idx + 1}
                                              </span>
                                            )}
                                            <span
                                              className={`font-mono flex-1 ${isMine ? 'text-purple-300' : 'text-white/60'}`}
                                            >
                                              {entry.address.slice(0, 4)}...{entry.address.slice(-4)}
                                              {isMine && (
                                                <span className="ml-1 text-[8px] px-1 py-px rounded bg-purple-500/20 text-purple-300 font-bold">
                                                  you
                                                </span>
                                              )}
                                            </span>
                                            <span className="font-bold text-white/70 tabular-nums">
                                              {entry.score.toLocaleString()}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                {/* Join / Joined */}
                                <div className="px-4 py-3 flex flex-col gap-2">
                                  {activeTournament.userJoined ? (
                                    <div className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-center bg-purple-500/15 text-purple-300">
                                      Joined — good luck!
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => handleJoinTournament(tournamentTier)}
                                      disabled={joinLoading || !connected}
                                      className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2 text-white"
                                      style={{ backgroundColor: '#A855F7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}
                                    >
                                      {joinLoading ? (
                                        <Orbit className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <>
                                          <Coins className="w-4 h-4" /> Join —{' '}
                                          {TOURNAMENT_TIERS.find((t) => t.key === tournamentTier)!.fee.toLocaleString()}{' '}
                                          coins
                                        </>
                                      )}
                                    </button>
                                  )}
                                  {!connected && (
                                    <p className="text-center text-[10px] text-white/30">Connect wallet to join</p>
                                  )}
                                  {joinMessage && (
                                    <p
                                      className={`text-center text-[10px] ${joinMessage.includes('fail') || joinMessage.includes('error') || joinMessage.includes('Error') ? 'text-red-400/70' : 'text-green-400/70'}`}
                                    >
                                      {joinMessage}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ) : activeTournament?.isEnded ? (
                              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
                                <Trophy className="w-8 h-8 mx-auto mb-2 text-yellow-400/30" />
                                <p className="text-xs text-white/40">Tournament ended. Next one starts soon!</p>
                              </div>
                            ) : (
                              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
                                <Swords className="w-8 h-8 mx-auto mb-2 text-white/10" />
                                <p className="text-xs text-white/30">
                                  No active{' '}
                                  {TOURNAMENT_TIERS.find((t) => t.key === tournamentTier)?.shortLabel.toLowerCase()}{' '}
                                  tournament right now.
                                </p>
                                <p className="text-[10px] text-white/20 mt-1">Check back soon!</p>
                              </div>
                            )}

                            {/* Score submission note */}
                            <div className="px-3 py-2 rounded-xl bg-purple-500/[0.06] border border-purple-500/15 flex items-start gap-2">
                              <Zap className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
                              <p className="text-[10px] text-white/40 leading-relaxed">
                                Scores are submitted automatically when your game ends. Your best run during the
                                tournament window counts.
                              </p>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Coin Balance + Stats Row */}
                    <div className="w-full mb-4 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-gradient-to-br from-yellow-500/10 to-orange-500/5 border border-yellow-500/20 px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <Coins className="w-5 h-5 text-yellow-400" />
                          <span className="text-[11px] text-yellow-400/70 uppercase tracking-[0.15em] font-bold">
                            Coins
                          </span>
                        </div>
                        <div className="text-3xl font-black text-yellow-300 tabular-nums leading-none">
                          {totalCoins}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] px-4 py-4 text-center">
                        <div className="text-[11px] text-white/40 uppercase tracking-[0.15em] font-bold mb-2">
                          Best Score
                        </div>
                        <div className="text-2xl font-black text-cyan-400 tabular-nums leading-none">
                          {gameMode === 'destroyer'
                            ? defenderStats.gamesPlayed > 0
                              ? formatPoints(defenderStats.bestScore)
                              : '0'
                            : gameMode === 'gravity'
                              ? gravityLeaderboard.length > 0
                                ? String(
                                    gravityLeaderboard.find((e) => e.address === (address || 'anonymous'))?.score || 0,
                                  )
                                : '0'
                              : playerStats.gamesPlayed > 0
                                ? formatTime(playerStats.bestScore)
                                : '--:--'}
                        </div>
                        <div className="text-[10px] text-white/30 mt-1.5">
                          {gameMode === 'destroyer'
                            ? defenderStats.gamesPlayed > 0
                              ? `${defenderStats.gamesPlayed} games played`
                              : 'No games yet'
                            : gameMode === 'gravity'
                              ? gravityLeaderboard.length > 0
                                ? `${gravityLeaderboard.length} entries`
                                : 'No games yet'
                              : playerStats.gamesPlayed > 0
                                ? `${playerStats.gamesPlayed} games played`
                                : 'No games yet'}
                        </div>
                      </div>
                    </div>

                    {/* Coins info */}
                    <div className="w-full mb-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500/8 via-cyan-500/5 to-purple-500/8 border border-purple-500/15 text-center">
                      <span className="text-[11px] text-purple-200/50 font-medium">
                        Earn Coins by playing → spend in the <strong className="text-purple-300/80">Prism Shop</strong>{' '}
                        or wager in Challenges
                      </span>
                    </div>

                    {/* How to play + Power-ups — mode-aware */}
                    <div className="w-full mb-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                      <div className="text-sm text-cyan-400 uppercase tracking-[0.2em] font-black mb-3 text-center w-full">
                        Controls & Power-ups
                      </div>
                      {gameMode === 'destroyer' ? (
                        <div className="flex flex-col gap-2.5 text-[13px] text-left">
                          <div className="flex items-center gap-2.5">
                            <Target className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                            <span className="text-white/70 flex-1">
                              {isMobile ? 'Drag' : 'WASD'} — move ship, auto-fire
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <img src="/textures/powerups/powerup_shield.png" className="w-5 h-5 flex-shrink-0" alt="" />
                            <span className="text-white/70 flex-1">Shield — blocks enemy hits</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <img
                              src="/textures/powerups/powerup_photon_burst.png"
                              className="w-5 h-5 flex-shrink-0"
                              alt=""
                            />
                            <span className="text-white/70 flex-1">Dual Shot — fires 2× bullets</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <img
                              src="/textures/powerups/powerup_quantum_core.png"
                              className="w-5 h-5 flex-shrink-0"
                              alt=""
                            />
                            <span className="text-white/70 flex-1">Rapid Fire — faster fire rate</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <img
                              src="/textures/powerups/powerup_nova_rockets.png"
                              className="w-5 h-5 flex-shrink-0"
                              alt=""
                            />
                            <span className="text-white/70 flex-1">Rockets — homing missiles</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <img
                              src="/textures/powerups/powerup_nebula_bomb.png"
                              className="w-5 h-5 flex-shrink-0"
                              alt=""
                            />
                            <span className="text-white/70 flex-1">Nuke — destroys all enemies</span>
                          </div>
                          {/* ID Holder Perks */}
                          <div
                            className={`mt-1.5 pt-2 border-t ${hasMintedId ? 'border-green-500/20' : 'border-white/[0.06]'}`}
                          >
                            <div
                              className={`text-[10px] uppercase tracking-[0.15em] font-bold mb-2 ${hasMintedId ? 'text-green-400' : 'text-white/30'}`}
                            >
                              {hasMintedId ? '✓ ID Holder Perks' : 'ID Holder Perks (mint to unlock)'}
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2.5">
                                <Coins
                                  className={`w-4 h-4 flex-shrink-0 ${hasMintedId ? 'text-yellow-400' : 'text-white/25'}`}
                                />
                                <span
                                  className={`text-[12px] flex-1 ${hasMintedId ? 'text-yellow-300/80' : 'text-white/30'}`}
                                >
                                  ×2 Coin Multiplier
                                </span>
                              </div>
                              <div className="flex items-center gap-2.5">
                                <RotateCw
                                  className={`w-4 h-4 flex-shrink-0 ${hasMintedId ? 'text-green-400' : 'text-white/25'}`}
                                />
                                <span
                                  className={`text-[12px] flex-1 ${hasMintedId ? 'text-green-400/80' : 'text-white/30'}`}
                                >
                                  3 Free Revives / day
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : gameMode === 'gravity' ? (
                        <div className="flex flex-col gap-2.5 text-[13px] text-left">
                          <div className="flex items-center gap-2.5">
                            <Target className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                            <span className="text-white/70 flex-1">{isMobile ? 'Tap' : 'Click'} — thrust upward</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <img src="/textures/powerups/powerup_shield.png" className="w-5 h-5 flex-shrink-0" alt="" />
                            <span className="text-white/70 flex-1">Navigate — pass through asteroid columns</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <img src="/textures/powerups/powerup_coin.png" className="w-5 h-5 flex-shrink-0" alt="" />
                            <span className="text-white/70 flex-1">Crystals — collect for +5 coins</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <Coins className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                            <span className="text-white/70 flex-1">Columns — +3 coins per column passed</span>
                          </div>
                          {/* ID Holder Perks */}
                          <div
                            className={`mt-1.5 pt-2 border-t ${hasMintedId ? 'border-green-500/20' : 'border-white/[0.06]'}`}
                          >
                            <div
                              className={`text-[10px] uppercase tracking-[0.15em] font-bold mb-2 ${hasMintedId ? 'text-green-400' : 'text-white/30'}`}
                            >
                              {hasMintedId ? '✓ ID Holder Perks' : 'ID Holder Perks (mint to unlock)'}
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2.5">
                                <Coins
                                  className={`w-4 h-4 flex-shrink-0 ${hasMintedId ? 'text-yellow-400' : 'text-white/25'}`}
                                />
                                <span
                                  className={`text-[12px] flex-1 ${hasMintedId ? 'text-yellow-300/80' : 'text-white/30'}`}
                                >
                                  ×2 Coin Multiplier
                                </span>
                              </div>
                              <div className="flex items-center gap-2.5">
                                <RotateCw
                                  className={`w-4 h-4 flex-shrink-0 ${hasMintedId ? 'text-green-400' : 'text-white/25'}`}
                                />
                                <span
                                  className={`text-[12px] flex-1 ${hasMintedId ? 'text-green-400/80' : 'text-white/30'}`}
                                >
                                  3 Free Revives / day
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2.5 text-[13px] text-left">
                          <div className="flex items-center gap-2.5">
                            <Target className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                            <span className="text-white/70 flex-1">
                              {isMobile ? 'Tap' : 'Click'} — reverse orbit direction
                            </span>
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
                          <div
                            className={`mt-1.5 pt-2 border-t ${hasMintedId ? 'border-green-500/20' : 'border-white/[0.06]'}`}
                          >
                            <div
                              className={`text-[10px] uppercase tracking-[0.15em] font-bold mb-2 ${hasMintedId ? 'text-green-400' : 'text-white/30'}`}
                            >
                              {hasMintedId ? '✓ ID Holder Perks' : 'ID Holder Perks (mint to unlock)'}
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2.5">
                                <Coins
                                  className={`w-4 h-4 flex-shrink-0 ${hasMintedId ? 'text-yellow-400' : 'text-white/25'}`}
                                />
                                <span
                                  className={`text-[12px] flex-1 ${hasMintedId ? 'text-yellow-300/80' : 'text-white/30'}`}
                                >
                                  ×2 Coin Multiplier
                                </span>
                              </div>
                              <div className="flex items-center gap-2.5">
                                <RotateCw
                                  className={`w-4 h-4 flex-shrink-0 ${hasMintedId ? 'text-green-400' : 'text-white/25'}`}
                                />
                                <span
                                  className={`text-[12px] flex-1 ${hasMintedId ? 'text-green-400/80' : 'text-white/30'}`}
                                >
                                  3 Free Revives / day
                                </span>
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
                        <div className="text-[10px] text-purple-200/40 mt-0.5">
                          On-chain randomness for every session
                        </div>
                      </div>
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${mbHealthy ? 'bg-green-400' : mbHealthy === false ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'}`}
                      />
                    </div>

                    {/* Challenge banner on start screen */}
                    {activeChallengeId && (
                      <div className="w-full mb-3 px-4 py-3 rounded-xl border border-amber-400/30 bg-amber-500/8 text-center">
                        <div className="flex items-center justify-center gap-2 mb-1">
                          <Swords className="w-4 h-4 text-amber-400" />
                          <span className="text-sm font-bold text-amber-300 uppercase tracking-wider">
                            Challenge Mode
                          </span>
                        </div>
                        <p className="text-[11px] text-amber-200/50">
                          Your score will be submitted to the challenge when the game ends.
                        </p>
                      </div>
                    )}

                    {/* ═══ SHIP STATS PANEL ═══ */}
                    <div className="w-full mb-3 p-3 rounded-xl bg-white/[0.03] border border-white/10 backdrop-blur-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm">🚀</span>
                        <span className="text-xs font-bold text-white/80 uppercase tracking-wider">Ship Stats</span>
                      </div>
                      <div className="space-y-1.5">
                        {(
                          [
                            { key: 'speed', label: 'Speed', icon: '⚡', color: '#22d3ee', value: shipStats.speed },
                            { key: 'shield', label: 'Shield', icon: '🛡️', color: '#3b82f6', value: shipStats.shield },
                            {
                              key: 'firepower',
                              label: 'Firepower',
                              icon: '🔥',
                              color: '#ef4444',
                              value: shipStats.firepower,
                            },
                            { key: 'luck', label: 'Luck', icon: '🍀', color: '#22c55e', value: shipStats.luck },
                          ] as const
                        ).map((stat) => (
                          <div key={stat.key} className="flex items-center gap-2">
                            <span className="text-[10px] w-3 text-center">{stat.icon}</span>
                            <span className="text-[10px] text-white/50 w-14">{stat.label}</span>
                            <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${stat.value}%`,
                                  background: stat.color,
                                  boxShadow: `0 0 6px ${stat.color}40`,
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-white/40 w-6 text-right font-mono">{stat.value}</span>
                          </div>
                        ))}
                      </div>
                      {(forgeLoadout?.equippedShipSkin ||
                        forgeLoadout?.equippedFrame ||
                        forgeLoadout?.equippedAura) && (
                        <div className="mt-2 pt-2 border-t border-white/5 space-y-0.5">
                          {forgeLoadout.equippedShipSkin && (
                            <div className="text-[9px] text-cyan-300/50">
                              Ship: {forgeLoadout.equippedShipSkin.replace('ship_', '')} (
                              {getEquipmentBonusLabel(forgeLoadout.equippedShipSkin, 'skin')})
                            </div>
                          )}
                          {forgeLoadout.equippedFrame && (
                            <div className="text-[9px] text-blue-300/50">
                              Frame: {forgeLoadout.equippedFrame.replace('frame_', '')} (
                              {getEquipmentBonusLabel(forgeLoadout.equippedFrame, 'frame')})
                            </div>
                          )}
                          {forgeLoadout.equippedAura && (
                            <div className="text-[9px] text-purple-300/50">
                              Aura: {forgeLoadout.equippedAura.replace('aura_', '')} (
                              {getEquipmentBonusLabel(forgeLoadout.equippedAura, 'aura')})
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        onClick={() => startFadeTransition(() => navigate('/forge'))}
                        className="mt-2 w-full text-[10px] text-cyan-400/50 hover:text-cyan-300 transition-colors text-center"
                      >
                        Customize in Armory →
                      </button>
                    </div>

                    {/* ═══ PLAY BUTTON — above achievements ═══ */}
                    <Button
                      size="lg"
                      className={`w-full h-14 text-lg font-black uppercase tracking-[0.2em] transition-all duration-300 transform hover:scale-[1.03] active:scale-[0.97] rounded-xl mb-2 shrink-0 ${
                        activeChallengeId
                          ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400 hover:from-amber-400 hover:via-amber-300 hover:to-yellow-300 text-black shadow-[0_0_40px_rgba(245,158,11,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] border border-amber-300/30'
                          : playMode === 'tournament'
                            ? 'bg-gradient-to-r from-purple-500 via-purple-400 to-fuchsia-400 hover:from-purple-400 hover:via-purple-300 hover:to-fuchsia-300 text-white shadow-[0_0_40px_rgba(168,85,247,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] border border-purple-300/30'
                            : 'bg-gradient-to-r from-cyan-500 via-cyan-400 to-teal-400 hover:from-cyan-400 hover:via-cyan-300 hover:to-teal-300 text-black shadow-[0_0_40px_rgba(6,182,212,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] border border-cyan-300/30'
                      }`}
                      onClick={handleStart}
                    >
                      {activeChallengeId ? (
                        <>
                          <Swords className="w-5 h-5 mr-2" /> Start Challenge
                        </>
                      ) : playMode === 'tournament' ? (
                        <>
                          <Trophy className="w-5 h-5 mr-2" />{' '}
                          {activeTournament?.userJoined ? 'Enter Tournament' : 'Join First'}
                        </>
                      ) : gameMode === 'text_quest' ? (
                        <>
                          <BookOpen className="w-5 h-5 mr-2" /> Explore
                        </>
                      ) : (
                        <>
                          <Play className="w-5 h-5 mr-2 fill-current" /> {connected ? 'Play' : 'Play as Guest'}
                        </>
                      )}
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
                      const isDefMode = gameMode === 'destroyer';
                      const isGravMode = gameMode === 'gravity';
                      const achList = isDefMode
                        ? defenderAchievements
                        : isGravMode
                          ? gravityAchievements
                          : achievements;
                      const claimable = achList.filter((a) => a.unlocked && !a.claimed).length;
                      const modeLabel = isDefMode ? 'Defender' : isGravMode ? 'Gravity' : 'Orbit';
                      return (
                        <>
                          <button
                            className="mt-4 flex items-center gap-1.5 text-xs text-yellow-400/60 hover:text-yellow-300 transition-colors"
                            onClick={() => setShowAchievements(!showAchievements)}
                          >
                            <Award className="w-3.5 h-3.5" />
                            {modeLabel} Achievements ({achList.filter((a) => a.unlocked).length}/{achList.length})
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
                                const progress = isDefMode
                                  ? getDefenderAchievementProgress(ach as DefenderAchievement)
                                  : isGravMode
                                    ? getGravityAchievementProgress(ach as GravityAchievement)
                                    : getAchievementProgress(ach as Achievement);
                                const reward = isDefMode
                                  ? (DEFENDER_COIN_REWARDS[(ach as DefenderAchievement).tier] ?? 0)
                                  : isGravMode
                                    ? (GRAVITY_COIN_REWARDS[(ach as GravityAchievement).tier] ?? 0)
                                    : (ACHIEVEMENT_COIN_REWARDS[(ach as Achievement).tier] ?? 0);
                                const canClaim = ach.unlocked && !ach.claimed;
                                return (
                                  <div
                                    key={ach.id}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs ${
                                      canClaim
                                        ? 'bg-yellow-500/[0.06] border-yellow-500/25'
                                        : ach.unlocked
                                          ? 'bg-white/[0.04] border-white/[0.1]'
                                          : 'bg-white/[0.01] border-white/[0.04] opacity-50'
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
                                            borderColor: ACH_TIER_COLORS[ach.tier] + '60',
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
                                        className="shrink-0 px-3 py-2 rounded-xl bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 text-[10px] font-bold uppercase hover:bg-yellow-500/30 transition-colors"
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
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ CONTINUE SCREEN ═══ */}
            {showContinue && gameState === 'playing' && (
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
                      <>
                        <span className="w-4 h-4 mr-2 border-2 border-black/30 border-t-black rounded-full animate-spin inline-block" />{' '}
                        Processing...
                      </>
                    ) : freeRevivesLeft.current > 0 ? (
                      <>
                        <Shield className="w-4 h-4 mr-1.5" /> Free Revive ({freeRevivesLeft.current} left)
                      </>
                    ) : (
                      <>
                        <Coins className="w-4 h-4 mr-1.5" /> Revive for 5 SKR
                      </>
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
            {gameState === 'gameover' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-auto animate-in fade-in duration-500">
                <div
                  className="league-scroll max-w-sm w-full mx-4 rounded-[40px] overflow-hidden flex flex-col max-h-[96vh]"
                  style={{
                    background: 'linear-gradient(160deg, #08080f 0%, #020408 60%, #060310 100%)',
                    border: `1px solid ${isVictory ? 'rgba(250,204,21,0.4)' : 'rgba(6,182,212,0.25)'}`,
                    boxShadow: isVictory
                      ? '0 0 40px -8px rgba(250,204,21,0.3), 0 0 80px -20px rgba(250,204,21,0.15), inset 0 1px 0 rgba(255,255,255,0.06)'
                      : '0 0 40px -8px rgba(239,68,68,0.2), 0 0 80px -20px rgba(6,182,212,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
                  }}
                >
                  {/* Header strip — always visible, no shift */}
                  <div
                    className="shrink-0 px-6 pt-7 pb-4 flex flex-col items-center text-center"
                    style={{
                      background: isVictory
                        ? 'linear-gradient(180deg,rgba(250,204,21,0.08) 0%,transparent 100%)'
                        : 'linear-gradient(180deg,rgba(239,68,68,0.06) 0%,transparent 100%)',
                    }}
                  >
                    {isVictory ? (
                      <>
                        <div className="text-4xl mb-1">🏆</div>
                        <div
                          className="font-black text-4xl tracking-tight uppercase mb-0.5"
                          style={{
                            background: 'linear-gradient(135deg,#fde68a,#fbbf24,#f59e0b)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                          }}
                        >
                          VICTORY!
                        </div>
                        <div className="text-sm text-yellow-300/60 mb-1">All 4 sectors conquered — legendary run!</div>
                      </>
                    ) : (
                      <>
                        <div
                          className="font-black text-4xl md:text-5xl tracking-tighter uppercase mb-0.5"
                          style={{
                            background:
                              gameMode === 'destroyer'
                                ? 'linear-gradient(135deg,#f87171,#ef4444)'
                                : gameMode === 'gravity'
                                  ? 'linear-gradient(135deg,#f97316,#ef4444)'
                                  : 'linear-gradient(135deg,#fb923c,#ef4444)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                          }}
                        >
                          {gameMode === 'destroyer'
                            ? 'Mission Failed'
                            : gameMode === 'gravity'
                              ? 'Crashed!'
                              : 'Orbit Broken'}
                        </div>
                        <div className="text-xs text-white/35 mb-1">
                          {gameMode === 'destroyer'
                            ? 'Your ship was destroyed…'
                            : gameMode === 'gravity'
                              ? 'You hit an asteroid column…'
                              : 'Asteroids took you out of orbit…'}
                        </div>
                      </>
                    )}

                    {gameMode === 'gravity' ? (
                      /* Gravity mode: TIME and COINS side by side */
                      <div className="flex items-center gap-4 mt-2 mb-0.5">
                        <div className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-white/5 border border-white/10">
                          <span className="text-[10px] uppercase tracking-widest text-cyan-400/60 font-semibold">
                            Score
                          </span>
                          <span className="text-2xl font-black text-white tabular-nums">{score}</span>
                        </div>
                        <div className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-yellow-500/5 border border-yellow-500/15">
                          <span className="text-[10px] uppercase tracking-widest text-yellow-400/60 font-semibold">
                            Coins
                          </span>
                          <div className="flex items-center gap-1">
                            <Coins className="w-4 h-4 text-yellow-400" />
                            <span className="text-2xl font-black text-yellow-400 tabular-nums">{coins}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-3xl font-black text-white mt-2 mb-0.5 tabular-nums">
                        {fmtScore(score, gameMode)}
                      </div>
                    )}
                    {isNewBest && score > 0 && (
                      <div className="text-[10px] text-yellow-400 font-bold uppercase tracking-widest animate-pulse">
                        ✦ New Personal Best ✦
                      </div>
                    )}
                    {!isNewBest && highScore > 0 && (
                      <div className="text-[10px] text-white/25">Best: {fmtScore(highScore, gameMode)}</div>
                    )}
                  </div>
                  {/* Scrollable content */}
                  <div className="flex-1 overflow-y-auto px-5 pb-2 flex flex-col items-center w-full">
                    {/* ── Challenge status ── */}
                    {activeChallengeId && (
                      <div className="w-full mb-3">
                        {challengeSubmitting ? (
                          <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-amber-400/30 bg-amber-500/8">
                            <span className="w-4 h-4 border-2 border-amber-400/40 border-t-amber-400 rounded-full animate-spin" />
                            <span className="text-sm text-amber-300 font-medium">Submitting challenge score...</span>
                          </div>
                        ) : challengeResult && challengeResult.status !== 'completed' ? (
                          <WaitingForOpponentBanner
                            challengeId={activeChallengeId}
                            address={address || ''}
                            onResultReceived={(ch) => {
                              setChallengeResult(ch);
                              setShowBattleResult(true);
                            }}
                          />
                        ) : null}
                      </div>
                    )}

                    {/* Coins earned this round + rank */}
                    <div className="flex items-center gap-3 mb-4 mt-1">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/25">
                        <Coins className="w-3.5 h-3.5 text-yellow-400" />
                        <span className="text-sm font-bold text-yellow-300">
                          {activeChallengeId
                            ? 'Challenge'
                            : `+${onchainBonusApplied ? Math.round(coins * ONCHAIN_BONUS_MULTIPLIER) : coins}`}
                        </span>
                        {onchainBonusApplied && (
                          <span className="text-[10px] font-bold text-green-400 animate-in fade-in slide-in-from-left-2 duration-500">
                            ×{ONCHAIN_BONUS_MULTIPLIER}
                          </span>
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
                              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/25 animate-in slide-in-from-bottom duration-500"
                            >
                              <img src={ach.image} alt={ach.name} className="w-12 h-12 rounded-md object-cover" />
                              <div className="text-left flex-1">
                                <div className="text-xs font-bold text-yellow-300">{ach.name}</div>
                                <div className="text-[10px] text-yellow-200/50">{ach.description}</div>
                              </div>
                              {!isClaimed ? (
                                <button
                                  className="shrink-0 px-3 py-2 rounded-xl bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 text-[10px] font-bold uppercase hover:bg-yellow-500/30 transition-colors animate-pulse"
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
                    <div
                      className={`w-full mb-2 flex items-center gap-1.5 px-3 py-2 rounded-xl border ${mbVerified ? 'bg-purple-500/8 border-purple-500/20' : 'bg-white/[0.02] border-white/[0.06]'}`}
                    >
                      <span className="text-xs">⚡</span>
                      <span
                        className={`text-[10px] font-medium ${mbVerified ? 'text-purple-300/80' : 'text-white/30'}`}
                      >
                        MagicBlock
                      </span>
                      <span className={`text-[10px] flex-1 ${mbVerified ? 'text-purple-300/60' : 'text-white/20'}`}>
                        {mbVerified && mbSeed
                          ? `Seed ${mbSeed.slice(0, 6)}… · #${mbSlot}`
                          : mbSeed
                            ? 'verifying…'
                            : 'pending…'}
                      </span>
                      {mbVerified && <span className="text-green-400 text-[10px]">✓</span>}
                    </div>

                    {/* Session Proof — separate line with color */}
                    <div
                      className={`w-full mb-2 flex items-center gap-1.5 px-3 py-2 rounded-xl border ${sessionProof ? 'border-cyan-500/15 bg-cyan-500/5' : 'border-white/[0.06] bg-white/[0.02]'}`}
                    >
                      <Shield
                        className={`w-3 h-3 flex-shrink-0 ${sessionProof ? 'text-cyan-400/60' : 'text-white/20'}`}
                      />
                      <span
                        className={`text-[10px] font-medium ${sessionProof ? 'text-cyan-300/70' : 'text-white/30'}`}
                      >
                        Session Proof
                      </span>
                      {sessionProof ? (
                        <>
                          <span className="text-[10px] font-mono text-cyan-200/50 flex-1 truncate">
                            {sessionProof.id}
                          </span>
                          {sessionProof.proofUrl && /^https?:\/\//.test(sessionProof.proofUrl) && (
                            <a
                              href={sessionProof.proofUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-300/60 hover:text-cyan-200 flex-shrink-0"
                            >
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
                        style={{
                          background: 'linear-gradient(135deg, #7c3aed, #9333ea)',
                          color: '#fff',
                          boxShadow: '0 0 20px rgba(147,51,234,0.3)',
                        }}
                        onClick={handleCommitOnchain}
                        disabled={isCommitting}
                      >
                        {isCommitting ? (
                          <>
                            <Clock className="w-4 h-4 animate-spin" /> Committing...
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4" /> Save On-Chain{' '}
                            <span className="text-[10px] px-1.5 py-0.5 rounded ml-1 bg-green-500/30 text-green-300 font-black">
                              +{Math.round((ONCHAIN_BONUS_MULTIPLIER - 1) * 100)}%
                            </span>
                          </>
                        )}
                      </button>
                    )}

                    {lastTxSignature && (
                      <div className="w-full mb-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-green-500/20 bg-green-500/5">
                        <Shield className="w-3 h-3 text-green-400 flex-shrink-0" />
                        <span className="text-[10px] text-green-400 font-bold flex-1">
                          On-Chain ✓ +{Math.round((ONCHAIN_BONUS_MULTIPLIER - 1) * 100)}%
                        </span>
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
                  <div
                    className="shrink-0 px-5 pb-5 pt-2 w-full flex flex-col items-center gap-2"
                    style={{ background: 'linear-gradient(0deg,#020408 70%,transparent)' }}
                  >
                    {activeChallengeId ? (
                      /* Challenge mode — only "Back to Arena" */
                      <>
                        <button
                          className="w-full h-14 rounded-2xl font-black text-base uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95"
                          style={{
                            background: 'linear-gradient(135deg,#f59e0b,#d97706)',
                            color: '#000',
                            boxShadow: '0 0 24px rgba(245,158,11,0.4)',
                          }}
                          onClick={() => startFadeTransition(() => navigate('/arena'))}
                        >
                          <Swords className="w-5 h-5" />
                          Back to Arena
                        </button>
                        <button
                          className="w-full h-12 rounded-2xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-95"
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: 'rgba(255,255,255,0.75)',
                          }}
                          onClick={handleShare}
                        >
                          <Share2 className="w-4 h-4" />
                          Share Result
                        </button>
                      </>
                    ) : (
                      /* Normal mode — full controls */
                      <>
                        <button
                          className="w-full h-14 rounded-2xl font-black text-base uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95"
                          style={{
                            background: 'linear-gradient(135deg,#22d3ee,#0ea5e9)',
                            color: '#000',
                            boxShadow: '0 0 24px rgba(34,211,238,0.4)',
                          }}
                          onClick={handleStart}
                        >
                          <RotateCcw className="w-5 h-5" />
                          Play Again
                        </button>
                        <button
                          className="w-full h-12 rounded-2xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-95"
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: 'rgba(255,255,255,0.75)',
                          }}
                          onClick={handleShare}
                        >
                          <Share2 className="w-4 h-4" />
                          Share Result
                        </button>
                        <div className="flex gap-2 w-full">
                          <button
                            className="flex-1 h-10 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95"
                            style={{
                              background: 'rgba(255,255,255,0.04)',
                              border: '1px solid rgba(255,255,255,0.08)',
                              color: 'rgba(255,255,255,0.5)',
                            }}
                            onClick={() => {
                              stopAllAudio();
                              setGameState('start');
                            }}
                          >
                            <ArrowLeft className="w-3.5 h-3.5" />
                            Menu
                          </button>
                          <button
                            className="flex-1 h-10 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95"
                            style={{
                              background: 'rgba(6,182,212,0.06)',
                              border: '1px solid rgba(6,182,212,0.2)',
                              color: 'rgba(34,211,238,0.7)',
                            }}
                            onClick={() => {
                              stopAllAudio();
                              const idx = GAME_MODES.findIndex((m) => m.id === gameMode);
                              let ni = (idx + 1) % GAME_MODES.length;
                              if (GAME_MODES[ni].id === 'text_quest') ni = (ni + 1) % GAME_MODES.length;
                              setGameMode(GAME_MODES[ni].id);
                              setGameState('start');
                            }}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Next Mode
                          </button>
                          <button
                            className="flex-1 h-10 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95"
                            style={{
                              background: 'rgba(168,85,247,0.06)',
                              border: '1px solid rgba(168,85,247,0.2)',
                              color: 'rgba(196,148,255,0.7)',
                            }}
                            onClick={handleJumpBackToPrism}
                            disabled={isJumpingBack}
                          >
                            <ArrowLeft className="w-3.5 h-3.5" />
                            {isJumpingBack ? '...' : 'Home'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Challenge Exit Warning */}
      {showChallengeExitWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-yellow-500/40 rounded-2xl p-6 max-w-sm mx-4 text-center space-y-4">
            <Swords className="w-10 h-10 text-yellow-400 mx-auto" />
            <h3 className="text-lg font-bold text-white">Leave Challenge?</h3>
            <p className="text-sm text-gray-300">
              You haven&apos;t played yet. Leaving will abandon the challenge and refund all stakes.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleAbandonChallenge}
                className="flex-1 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
              >
                Abandon &amp; Leave
              </button>
              <button
                onClick={() => setShowChallengeExitWarning(false)}
                className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
              >
                Stay &amp; Play
              </button>
            </div>
          </div>
        </div>
      )}
      {/* BattleResultOverlay */}
      {showBattleResult && challengeResult && challengeResult.status === 'completed' && (
        <BattleResultOverlay
          challenge={{
            id: challengeResult.id,
            creator: challengeResult.creator,
            opponent: challengeResult.opponent,
            creatorScore: challengeResult.creatorScore,
            opponentScore: challengeResult.opponentScore,
            winner: challengeResult.winner,
            stakeAmount: challengeResult.stakeAmount,
            stakeType: challengeResult.stakeType ?? 'coins',
            status: challengeResult.status,
          }}
          myAddress={address || ''}
          onReturn={() => startFadeTransition(() => navigate('/arena?tab=challenges'))}
        />
      )}
    </div>
  );
};

export default PrismLeague;
