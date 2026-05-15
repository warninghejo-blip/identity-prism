import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { getApiBase, getCachedJwt } from '@/components/prism/shared';
import { sfxVictory, sfxGameOver } from '@/lib/gameAudio';
import { hapticSuccess, hapticError } from '@/lib/haptics';
import { invalidateBalanceCache } from '@/lib/prefetch';
import { getPrismBalance } from '@/lib/prismCoin';
import { useActiveWalletAddress } from '@/lib/useActiveWalletAddress';

/* ── Types ── */

interface ChallengeSnapshot {
  id: string;
  status: string;
  type: string;
  gameMode: string | null;
  creator: string;
  winner?: string | null;
  creatorScore: number | null;
  opponentScore: number | null;
  stakeAmount: number;
  stakeType: string;
  payout?: number;
}

/* ── Constants ── */

const POLL_INTERVAL = 20_000;
const STORAGE_KEY = 'ip_challenge_snapshot';
const SUPPRESSED_PATHS = ['/arena', '/market', '/game'];

const GAME_COVERS: Record<string, { label: string; cover: string; glow: string }> = {
  orbit: { label: 'Orbit Survival', cover: '/games/orbit_cover.png', glow: '#22d3ee' },
  destroyer: { label: 'Cosmic Defender', cover: '/games/wars_cover.png', glow: '#f87171' },
  gravity: { label: 'Gravity Runner', cover: '/games/gravity_cover.png', glow: '#a855f6' },
};

/* ── Helpers ── */

function loadSnapshot(): Map<string, ChallengeSnapshot> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as ChallengeSnapshot[];
    return new Map(arr.map((c) => [c.id, c]));
  } catch {
    return new Map();
  }
}

function saveSnapshot(map: Map<string, ChallengeSnapshot>): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...map.values()]));
}

function tryVibrate(pattern: number | number[]) {
  try {
    navigator?.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

function requestNotifPermission() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch {
    /* not supported */
  }
}

function sendBrowserNotification(title: string, body: string, icon?: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!document.hidden) return; // only when tab/app is in background
    new Notification(title, { body, icon: icon || '/logo192.png', badge: '/logo192.png' });
  } catch {
    /* not supported */
  }
}

/* ── Rich Toast ── */

function ChallengeToast({
  title,
  subtitle,
  color,
  gameMode,
}: {
  title: string;
  subtitle: string;
  color: string;
  gameMode?: string | null;
}) {
  const game = gameMode ? GAME_COVERS[gameMode] : null;

  return (
    <div className="flex items-center gap-3 w-full">
      {game && (
        <img
          src={game.cover}
          alt=""
          className="w-10 h-10 rounded-lg object-cover shrink-0"
          style={{ boxShadow: `0 0 12px ${game.glow}33` }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold leading-tight" style={{ color }}>
          {title}
        </div>
        <div className="text-[11px] text-white/40 mt-0.5 leading-tight">{subtitle}</div>
      </div>
    </div>
  );
}

/* ── Hook ── */

export function useChallengeNotifier(): void {
  const activeAddress = useActiveWalletAddress();
  const address = activeAddress || null;
  const location = useLocation();
  const prevSnapshot = useRef<Map<string, ChallengeSnapshot>>(loadSnapshot());
  const permissionRequested = useRef(false);

  // Request notification permission on mount (once)
  useEffect(() => {
    if (!permissionRequested.current) {
      permissionRequested.current = true;
      requestNotifPermission();
    }
  }, []);

  useEffect(() => {
    if (!address) return;

    const poll = async () => {
      const jwt = getCachedJwt(address);
      if (!jwt) return;

      // Don't show notifications on pages that have their own polling
      const suppressed = SUPPRESSED_PATHS.some((p) => location.pathname.startsWith(p));

      try {
        const base = getApiBase();
        if (!base) return;
        const res = await fetch(`${base}/api/challenge/my`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const challenges: ChallengeSnapshot[] = (data.challenges || []).map((c: Record<string, unknown>) => ({
          id: c.id as string,
          status: c.status as string,
          type: (c.type as string) || 'score',
          gameMode: (c.gameMode as string) || null,
          creator: (c.creator as string) || '',
          winner: c.winner as string | null,
          creatorScore: (c.creatorScore as number) ?? null,
          opponentScore: (c.opponentScore as number) ?? null,
          stakeAmount: c.stakeAmount as number,
          stakeType: c.stakeType as string,
        }));

        const newMap = new Map(challenges.map((c) => [c.id, c]));
        const prev = prevSnapshot.current;

        if (!suppressed) {
          for (const c of challenges) {
            const old = prev.get(c.id);
            if (!old || old.status === c.status) continue;

            if (c.status === 'completed' || c.status === 'cancelled' || c.status === 'expired') {
              invalidateBalanceCache(address);
              void getPrismBalance(address).catch(() => {});
            }

            if (c.status === 'accepted') {
              const game = c.gameMode ? GAME_COVERS[c.gameMode] : null;
              toast(
                <ChallengeToast
                  title="Challenge Accepted!"
                  subtitle={`${game?.label ?? 'Battle'} — get ready`}
                  color="#22d3ee"
                  gameMode={c.gameMode}
                />,
              );
            } else if (c.status === 'completed') {
              const isCreator = c.creator.toLowerCase() === address.toLowerCase();
              const myScore = isCreator ? (c.creatorScore ?? 0) : (c.opponentScore ?? 0);
              const oppScore = isCreator ? (c.opponentScore ?? 0) : (c.creatorScore ?? 0);
              const amount = c.payout && c.payout > 0 ? c.payout : Math.floor(c.stakeAmount * 2 * 0.95);
              const unit = c.stakeType === 'sol' ? 'SOL' : 'Coins';
              const won = c.winner?.toLowerCase() === address.toLowerCase();
              const draw = c.winner === null;
              const game = c.gameMode ? GAME_COVERS[c.gameMode] : null;

              const resultTitle = draw ? 'DRAW' : won ? 'YOU WON!' : 'YOU LOST';
              const resultColor = draw ? '#fbbf24' : won ? '#22c55e' : '#ef4444';
              const stakeText = draw ? 'Stake returned' : won ? `+${amount} ${unit}` : `-${c.stakeAmount} ${unit}`;
              const scoreText = `${game?.label ?? 'Battle'} — ${myScore} vs ${oppScore}`;

              toast(
                <ChallengeToast
                  title={`${resultTitle} ${stakeText}`}
                  subtitle={scoreText}
                  color={resultColor}
                  gameMode={c.gameMode}
                />,
              );

              // Sound
              if (won) {
                sfxVictory();
              } else if (!draw) {
                sfxGameOver();
              }

              // Haptics (Capacitor native) + Vibration API fallback
              if (won) {
                hapticSuccess();
                tryVibrate([50, 30, 50]);
              } else if (!draw) {
                hapticError();
                tryVibrate([100, 50, 100, 50, 100]);
              }

              // Browser notification when in background
              const notifBody = `${scoreText} — ${stakeText}`;
              sendBrowserNotification(resultTitle, notifBody, game?.cover);
            } else if (c.status === 'cancelled') {
              toast(
                <ChallengeToast
                  title="Challenge Cancelled"
                  subtitle="Stake refunded"
                  color="#94a3b8"
                  gameMode={c.gameMode}
                />,
              );
            } else if (c.status === 'expired') {
              toast(
                <ChallengeToast
                  title="Challenge Expired"
                  subtitle={`Stake refunded: +${c.stakeAmount} Coins`}
                  color="#fbbf24"
                  gameMode={c.gameMode}
                />,
              );

              sendBrowserNotification('Challenge Expired', `Stake refunded: +${c.stakeAmount} Coins`, '/hub/arena.png');
            }
          }
        }

        prevSnapshot.current = newMap;
        saveSnapshot(newMap);
      } catch {
        /* ignore network errors */
      }
    };

    // Initial poll
    void poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [address, location.pathname]);
}
