/**
 * Prism Arena — P2P Challenge system.
 * Extracted from NebulaMarket.tsx ChallengesTab.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { invalidateCompositeCache } from '@/hooks/useCompositeScore';
import { PRISM_BALANCE_UPDATED_EVENT, type PrismBalance } from '@/lib/prismCoin';
import { invalidateBalanceCache } from '@/lib/prefetch';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useActiveWalletAddress } from '@/lib/useActiveWalletAddress';
import {
  ArrowLeft,
  Plus,
  X,
  Swords,
  Gamepad2,
  Target,
  Flame,
  CircleDot,
  Clock,
  Check,
  Play,
  Ban,
  Loader2,
  Trophy,
  ArrowUpDown,
  Eye,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import PageShell from '@/components/PageShell';
import ChallengeReadyModal from '@/components/ChallengeReadyModal';
import BattleResultOverlay, { type ChallengeResult } from '@/components/BattleResultOverlay';
import { goBack } from '@/lib/safeNavigate';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
import { trackChallengeCreate, trackChallengeAccept } from '@/lib/analytics';
import {
  getApiBase,
  getCachedJwt,
  obtainJwt,
  setAuthWallet,
  isServerAvailable,
  MiniPlanet,
  formatAddr,
  timeAgo,
} from '@/components/prism/shared';

// ── Toast component (glass-morphism, matches Sonner theme) ──

function ArenaToast({ cover, color, title, sub }: { cover?: string; color: string; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 w-full">
      {cover && (
        <img
          src={cover}
          alt=""
          className="w-10 h-10 rounded-lg object-cover shrink-0"
          style={{ boxShadow: `0 0 12px ${color}33` }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold leading-tight" style={{ color }}>
          {title}
        </div>
        <div className="text-[11px] text-white/40 mt-0.5 leading-tight">{sub}</div>
      </div>
    </div>
  );
}

// ── Challenge types ──

interface Challenge {
  id: string;
  creator: string;
  opponent: string | null;
  type: 'score' | 'game';
  gameMode: string | null;
  stakeType: 'coins';
  stakeAmount: number;
  status: 'open' | 'accepted' | 'playing' | 'completed' | 'cancelled';
  creatorScore: number | null;
  opponentScore: number | null;
  winner: string | null;
  createdAt: number;
  acceptedAt: number | null;
  completedAt: number | null;
  solPayoutStatus?: string;
  solPayoutTx?: string;
}

// ── Status styling ──

const STATUS_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  open: { dot: 'bg-blue-400', text: 'text-blue-400', bg: 'bg-blue-400/10' },
  accepted: { dot: 'bg-cyan-400', text: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  playing: { dot: 'bg-yellow-400', text: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  completed: { dot: 'bg-green-400', text: 'text-green-400', bg: 'bg-green-400/10' },
  cancelled: { dot: 'bg-white/30', text: 'text-white/30', bg: 'bg-white/5' },
  expired: { dot: 'bg-orange-400', text: 'text-orange-400', bg: 'bg-orange-400/10' },
};

const GAME_MODE_LABELS: Record<string, { label: string; color: string; cover: string; glow: string; accent: string }> =
  {
    orbit: {
      label: 'Orbit Survival',
      color: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10',
      cover: '/games/orbit_cover.png',
      glow: '#22d3ee',
      accent: 'rgba(34,211,238,',
    },
    destroyer: {
      label: 'Cosmic Defender',
      color: 'text-red-400 border-red-400/30 bg-red-400/10',
      cover: '/games/wars_cover.png',
      glow: '#f87171',
      accent: 'rgba(248,113,113,',
    },
    gravity: {
      label: 'Gravity Runner',
      color: 'text-purple-400 border-purple-400/30 bg-purple-400/10',
      cover: '/games/gravity_cover.png',
      glow: '#a855f6',
      accent: 'rgba(168,85,246,',
    },
  };

/** Format challenge score with units based on game mode */
function fmtChallengeScore(score: number | null, gameMode: string | null): string {
  if (score === null) return '—';
  if (gameMode === 'orbit') {
    const m = Math.floor(score / 60);
    const s = score % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  if (gameMode === 'destroyer') return `${score.toLocaleString()} pts`;
  // gravity = columns passed, others = plain number
  return `${score}`;
}

function TypeBadge({ challenge }: { challenge: Challenge }) {
  if (challenge.type === 'game' && challenge.gameMode) {
    const mode = GAME_MODE_LABELS[challenge.gameMode];
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full text-[10px] font-bold text-white/50">
        {mode?.cover && <img src={mode.cover} alt="" className="w-5 h-5 rounded object-cover" />}
        <span className="sr-only">{mode?.label ?? challenge.gameMode}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-amber-400 border border-amber-400/30 bg-amber-400/10">
      <Target className="w-3 h-3" />
      Score
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.open;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.text} ${s.bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function PrismArena() {
  const navigate = useNavigate();
  const wallet = useWallet();
  const myAddress = useActiveWalletAddress() || wallet.publicKey?.toBase58() || '';

  useEffect(() => {
    fadeOutTransition();
  }, []);

  // Register wallet for shared JWT auth on this page.
  useEffect(() => {
    setAuthWallet(wallet);
  }, [wallet]);

  const [openChallenges, setOpenChallenges] = useState<Challenge[]>([]);
  const [myChallenges, setMyChallenges] = useState<Challenge[]>([]);
  const [creating, setCreating] = useState(false);
  const [subTab, setSubTab] = useState<'open' | 'mine' | 'top'>(() => {
    // Auto-switch to Mine tab when returning from game or having active challenges
    try {
      if (sessionStorage.getItem('ip_challenge_submitted') || sessionStorage.getItem('ip_active_challenge'))
        return 'mine';
    } catch {}
    return 'open';
  });
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [loadingMine, setLoadingMine] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [formType, setFormType] = useState<'score' | 'game'>('score');
  const [formGameMode, setFormGameMode] = useState<'orbit' | 'destroyer' | 'gravity'>('orbit');
  const [formStake, setFormStake] = useState<number>(10);
  const [formOpponent, setFormOpponent] = useState('');
  const [formExpiry, setFormExpiry] = useState<number>(60);

  const [readyModal, setReadyModal] = useState<{
    challenge: { id: string; gameMode: string | null; stakeAmount: number; stakeType: 'coins' };
    role: 'creator' | 'acceptor';
  } | null>(null);
  const [battleResult, setBattleResult] = useState<ChallengeResult | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [showCoinHistory, setShowCoinHistory] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState<{
    challengeId: string;
    fee: number;
    refund: number;
    feeRate: number;
    unit: string;
  } | null>(null);
  const [weeklyBoard, setWeeklyBoard] = useState<
    {
      address: string;
      wins: number;
      losses: number;
      earned: number;
      played: number;
      reward: number;
      xpReward?: number;
    }[]
  >([]);
  const [allTimeBoard, setAllTimeBoard] = useState<
    { address: string; wins: number; losses: number; earned: number; played: number }[]
  >([]);
  const [nextReset, setNextReset] = useState(0);

  const prevMineRef = useRef<string>('');
  const actionLockRef = useRef(false);

  const base = getApiBase();

  // ── Fetch coin balance (direct, no JWT needed) ──
  const refreshBalance = useCallback(() => {
    if (!myAddress || !base) return;
    fetch(`${base}/api/prism/balance?address=${encodeURIComponent(myAddress)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.balance == null) return;
        setCoinBalance(data.balance);
        try {
          sessionStorage.setItem('ip_prism_balance', JSON.stringify(data));
        } catch {}
        window.dispatchEvent(new CustomEvent<PrismBalance>(PRISM_BALANCE_UPDATED_EVENT, { detail: data }));
      })
      .catch(() => {});
  }, [myAddress, base]);

  // Fetch challenge leaderboard
  useEffect(() => {
    if (subTab !== 'top' || !base) return;
    fetch(`${base}/api/challenge/leaderboard`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          if (d.weekly) setWeeklyBoard(d.weekly);
          if (d.allTime) setAllTimeBoard(d.allTime);
          if (d.nextReset) setNextReset(d.nextReset);
        }
      })
      .catch(() => {});
  }, [subTab, base]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  // ── Fetch open challenges ──
  const fetchOpen = useCallback(async () => {
    if (!(await isServerAvailable(base))) return;
    setLoadingOpen(true);
    try {
      const res = await fetch(`${base}/api/challenge/list`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const data = await res.json();
        setOpenChallenges(Array.isArray(data) ? data : (data.challenges ?? []));
      }
    } catch {
      /* ignore */
    }
    setLoadingOpen(false);
  }, [base]);

  // ── Fetch my challenges ──
  const fetchMine = useCallback(async () => {
    if (!myAddress) return;
    if (!(await isServerAvailable(base))) return;
    setLoadingMine(true);
    try {
      const jwt = getCachedJwt(myAddress);
      const headers: Record<string, string> = {};
      headers['Cache-Control'] = 'no-cache';
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
      const res = await fetch(`${base}/api/challenge/my?address=${encodeURIComponent(myAddress)}`, {
        cache: 'no-store',
        headers,
      });
      // Passive page loads must not trigger a new wallet approval prompt.
      if (res.status === 401) {
        try {
          sessionStorage.removeItem('ip_auth_jwt');
        } catch {}
        const fresh = await obtainJwt(wallet, { forceFresh: true }).catch(() => null);
        if (fresh) {
          const retry = await fetch(`${base}/api/challenge/my?address=${encodeURIComponent(myAddress)}`, {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${fresh}`, 'Cache-Control': 'no-cache' },
          });
          if (retry.ok) {
            const data = await retry.json();
            const list: Challenge[] = Array.isArray(data) ? data : (data.challenges ?? []);
            setMyChallenges(list);
          }
        }
        setLoadingMine(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const list: Challenge[] = Array.isArray(data) ? data : (data.challenges ?? []);
        setMyChallenges(list);

        const newKey = list.map((c) => `${c.id}:${c.status}`).join(',');
        if (prevMineRef.current && prevMineRef.current !== newKey) {
          const prevMap = new Map<string, string>();
          prevMineRef.current.split(',').forEach((entry) => {
            const [id, status] = entry.split(':');
            if (id) prevMap.set(id, status);
          });
          for (const c of list) {
            const prevStatus = prevMap.get(c.id);
            if (prevStatus && prevStatus !== c.status) {
              const gm = GAME_MODE_LABELS[c.gameMode || ''];
              const coverUrl = gm?.cover;
              const gameName = gm?.label || c.gameMode || 'Battle';
              const isCreator = c.creator === myAddress;
              const myS = fmtChallengeScore(isCreator ? c.creatorScore : c.opponentScore, c.gameMode);
              const theirS = fmtChallengeScore(isCreator ? c.opponentScore : c.creatorScore, c.gameMode);

              if (c.status === 'accepted') {
                toast(
                  <ArenaToast
                    cover={coverUrl}
                    color="#22d3ee"
                    title="Challenge Accepted!"
                    sub={`${gameName} — get ready`}
                  />,
                );
              } else if (c.status === 'playing') {
                toast(<ArenaToast cover={coverUrl} color="#facc15" title="Battle in Progress!" sub={gameName} />);
              } else if (c.status === 'completed') {
                const won = c.winner === myAddress;
                const title = won ? `YOU WON! +${c.stakeAmount * 2} Coins` : `YOU LOST -${c.stakeAmount} Coins`;
                toast(
                  <ArenaToast
                    cover={coverUrl}
                    color={won ? '#22c55e' : '#ef4444'}
                    title={title}
                    sub={`${gameName} — ${myS} vs ${theirS}`}
                  />,
                );
                if (myAddress) {
                  invalidateCompositeCache(myAddress);
                  invalidateBalanceCache(myAddress);
                  refreshBalance();
                  // Track arena quests (fallback — primary tracking is in PrismLeague on score submit)
                  import('@/lib/prismQuests')
                    .then(({ getQuestState, incrementQuest }) => {
                      let qs = getQuestState(myAddress);
                      qs = incrementQuest(qs, 'weekly_arena').state;
                      qs = incrementQuest(qs, 'weekly_games5').state;
                      incrementQuest(qs, 'ot_arena_wins');
                    })
                    .catch(() => {});
                }
                setBattleResult(c);
              } else if (c.status === 'cancelled') {
                toast(<ArenaToast color="#94a3b8" title="Challenge Cancelled" sub="Stake refunded" />);
              } else if (c.status === 'expired') {
                toast(<ArenaToast color="#fb923c" title="Challenge Expired" sub="Coins refunded" />);
              }
            }
          }
        }
        prevMineRef.current = newKey;
      }
    } catch {
      /* ignore */
    }
    setLoadingMine(false);
  }, [base, myAddress, wallet]);

  // ── Initial fetch + polling ──
  useEffect(() => {
    fetchOpen();
    fetchMine();
    // If returning from challenge game, force refresh with retries
    if (sessionStorage.getItem('ip_challenge_submitted')) {
      setTimeout(() => fetchMine(), 800);
      setTimeout(() => fetchMine(), 2500); // retry in case first was too early
    }
    const interval = setInterval(() => {
      fetchMine();
      if (subTab === 'open') fetchOpen();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchOpen, fetchMine, subTab]);

  // Show challenge score toast when returning from game
  const shownSubmitToast = useRef(false);
  useEffect(() => {
    const submittedId = sessionStorage.getItem('ip_challenge_submitted');
    if (!submittedId || shownSubmitToast.current || !myChallenges.length) return;
    const c = myChallenges.find((ch) => ch.id === submittedId);
    if (!c) return;
    const isCreator = c.creator === myAddress;
    const myS = isCreator ? c.creatorScore : c.opponentScore;
    if (myS === null || myS === undefined) return;
    shownSubmitToast.current = true;
    const gm = GAME_MODE_LABELS[c.gameMode || ''];
    toast.success(
      <div className="flex items-center gap-3">
        {gm?.cover && <img src={gm.cover} className="w-10 h-10 rounded-lg object-cover" alt="" />}
        <div>
          <div className="font-bold text-sm">Score submitted!</div>
          <div className="text-xs text-white/50">
            {gm?.label || 'Battle'} — {fmtChallengeScore(myS, c.gameMode)}
          </div>
        </div>
      </div>,
    );
  }, [myChallenges, myAddress]);

  // ── Create challenge ──
  const handleCreate = useCallback(async () => {
    if (actionLockRef.current) return;
    if (!myAddress) {
      toast.error('Connect your wallet first');
      return;
    }
    if (formStake < 5 || formStake > 1000) {
      toast.error('Stake must be between 5 and 1000 Coins');
      return;
    }

    actionLockRef.current = true;
    setSubmitting(true);
    try {
      let jwt = getCachedJwt(myAddress);
      if (!jwt) {
        jwt = await obtainJwt(wallet);
        if (!jwt) {
          toast.error('Please sign the message to authenticate');
          return;
        }
      }

      const body: Record<string, unknown> = {
        type: formType,
        stakeAmount: formStake,
        expiresMinutes: formExpiry,
      };
      if (formType === 'game') body.gameMode = formGameMode;
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(formOpponent.trim())) body.opponent = formOpponent.trim();

      const res = await fetch(`${base}/api/challenge/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        trackChallengeCreate();
        const resData = await res.json().catch(() => ({}));
        if (resData?.challenge) {
          setMyChallenges((prev) => {
            if (prev.some((c) => c.id === resData.challenge.id)) return prev;
            return [resData.challenge as Challenge, ...prev];
          });
          prevMineRef.current = `${resData.challenge.id}:${resData.challenge.status}`;
        }
        setCreating(false);
        setFormOpponent('');
        setFormStake(10);
        fetchOpen();
        fetchMine();

        // Refresh balance — coins were deducted server-side
        if (myAddress) invalidateBalanceCache(myAddress);
        refreshBalance();

        // Request notification permission on user gesture (challenge creation)
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
          }
        } catch {
          /* not supported */
        }

        if (formType === 'game') {
          const challengeId = resData.challenge?.id ?? resData.id ?? '';
          toast.success(
            <ArenaToast
              cover={GAME_MODE_LABELS[formGameMode]?.cover}
              color="#22c55e"
              title="Challenge Created!"
              sub={`${formStake} Coins staked — starting game...`}
            />,
          );
          // Navigate directly to game — no intermediate modal
          sessionStorage.setItem(
            'ip_active_challenge',
            JSON.stringify({ id: challengeId, role: 'creator', ts: Date.now() }),
          );
          sessionStorage.removeItem('ip_challenge_submitted');
          startFadeTransition(() => {
            navigate(
              `/game?challengeId=${encodeURIComponent(challengeId)}&mode=${encodeURIComponent(formGameMode)}&role=creator`,
            );
          });
        } else {
          toast.success(<ArenaToast color="#22c55e" title="Challenge Created!" sub={`${formStake} Coins staked`} />);
          setSubTab('mine');
        }
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to create challenge' }));
        toast.error(err.error || 'Failed to create challenge');
      }
    } catch {
      toast.error('Network error — could not create challenge');
    } finally {
      actionLockRef.current = false;
      setSubmitting(false);
    }
  }, [myAddress, formType, formGameMode, formStake, formOpponent, base, wallet, fetchOpen, fetchMine]);

  // ── Accept challenge ──
  const handleAccept = useCallback(
    async (challengeId: string) => {
      if (actionLockRef.current) return;
      if (!myAddress) {
        toast.error('Connect your wallet first');
        return;
      }

      actionLockRef.current = true;
      setAcceptingId(challengeId);
      try {
        let jwt = getCachedJwt(myAddress);
        if (!jwt) {
          jwt = await obtainJwt(wallet);
          if (!jwt) {
            toast.error('Please sign the message to authenticate');
            return;
          }
        }

        const challenge = [...openChallenges, ...myChallenges].find((c) => c.id === challengeId);

        const res = await fetch(`${base}/api/challenge/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ challengeId }),
        });

        if (res.ok) {
          trackChallengeAccept();
          const resData = await res.json().catch(() => ({}));
          if (myAddress) invalidateBalanceCache(myAddress);
          refreshBalance();
          fetchOpen();
          fetchMine();

          if (challenge?.type === 'game' && challenge.gameMode) {
            toast.success('Challenge accepted! Starting game...');
            sessionStorage.setItem(
              'ip_active_challenge',
              JSON.stringify({ id: challenge.id, role: 'acceptor', ts: Date.now() }),
            );
            sessionStorage.removeItem('ip_challenge_submitted');
            startFadeTransition(() => {
              navigate(
                `/game?challengeId=${encodeURIComponent(challenge.id)}&mode=${encodeURIComponent(challenge.gameMode)}&role=acceptor`,
              );
            });
          } else if (resData.challenge?.status === 'completed') {
            setBattleResult(resData.challenge);
          } else {
            toast.success('Challenge accepted! Good luck.');
          }
        } else {
          const err = await res.json().catch(() => ({ error: 'Failed to accept' }));
          toast.error(err.error || 'Failed to accept challenge');
        }
      } catch {
        toast.error('Network error');
      } finally {
        actionLockRef.current = false;
        setAcceptingId(null);
      }
    },
    [myAddress, base, wallet, fetchOpen, fetchMine, openChallenges, myChallenges],
  );

  // ── Cancel challenge ──
  // Show cancel confirm modal
  const promptCancel = useCallback(
    (challengeId: string) => {
      const ch = myChallenges.find((c) => c.id === challengeId);
      if (!ch) return;
      const feeRate = ch.creatorScore !== null && ch.creatorScore !== undefined ? 0.2 : 0.1;
      const fee = Math.ceil(ch.stakeAmount * feeRate);
      const refund = ch.stakeAmount - fee;
      setCancelConfirm({ challengeId, fee, refund, feeRate, unit: 'Coins' });
    },
    [myChallenges],
  );

  const handleCancel = useCallback(
    async (challengeId: string) => {
      if (actionLockRef.current) return;
      setCancelConfirm(null);

      actionLockRef.current = true;
      setCancellingId(challengeId);
      try {
        let jwt = getCachedJwt(myAddress);
        if (!jwt) {
          jwt = await obtainJwt(wallet);
          if (!jwt) {
            toast.error('Please sign the message to authenticate');
            setCancellingId(null);
            actionLockRef.current = false;
            return;
          }
        }

        const res = await fetch(`${base}/api/challenge/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ challengeId }),
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const refunded = data.refunded != null ? data.refunded : '?';
          const fee = data.fee != null ? data.fee : '?';
          toast(
            <ArenaToast
              color="#94a3b8"
              title="Challenge Cancelled"
              sub={`Refunded: ${refunded} Coins (fee: ${fee})`}
            />,
          );
          if (myAddress) invalidateBalanceCache(myAddress);
          refreshBalance();
          fetchOpen();
          fetchMine();
        } else {
          const err = await res.json().catch(() => ({ error: 'Failed to cancel' }));
          toast.error(err.error || 'Failed to cancel challenge');
        }
      } catch {
        toast.error('Network error');
      } finally {
        actionLockRef.current = false;
        setCancellingId(null);
      }
    },
    [myAddress, base, wallet, fetchOpen, fetchMine, myChallenges, refreshBalance],
  );

  return (
    <PageShell>
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => {
              startFadeTransition(() => goBack(navigate));
            }}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-sm font-bold bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent">
            PRISM ARENA
          </h1>
          {coinBalance !== null && (
            <button
              onClick={() => setShowCoinHistory(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-colors cursor-pointer"
            >
              <img src="/tokens/prism-icon.png" alt="" className="w-3 h-3 text-amber-400 object-contain" loading="lazy" />
              <span className="text-xs font-bold text-amber-300">{coinBalance.toLocaleString()}</span>
            </button>
          )}
          {coinBalance === null && <div className="w-16" />}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Header actions */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 bg-white/[0.04] rounded-xl p-0.5 border border-white/[0.06]">
            <button
              onClick={() => setSubTab('open')}
              className={`px-4 py-2 min-h-[36px] rounded-[14px] text-xs font-bold transition-all cursor-pointer ${
                subTab === 'open' ? 'bg-white/[0.1] text-white shadow-sm' : 'text-white/30 hover:text-white/50'
              }`}
            >
              Open
            </button>
            <button
              onClick={() => setSubTab('mine')}
              className={`px-4 py-2 min-h-[36px] rounded-[14px] text-xs font-bold transition-all cursor-pointer ${
                subTab === 'mine' ? 'bg-white/[0.1] text-white shadow-sm' : 'text-white/30 hover:text-white/50'
              }`}
            >
              My Battles
            </button>
            <button
              onClick={() => setSubTab('top')}
              className={`px-4 py-2 min-h-[36px] rounded-[14px] text-xs font-bold transition-all cursor-pointer ${
                subTab === 'top' ? 'bg-white/[0.1] text-white shadow-sm' : 'text-white/30 hover:text-white/50'
              }`}
            >
              Top
            </button>
          </div>
          <button
            onClick={() => setCreating(!creating)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              creating
                ? 'bg-white/[0.05] text-white/50 border border-white/[0.08] hover:bg-white/[0.08]'
                : 'bg-gradient-to-r from-amber-500 to-orange-500 text-black hover:from-amber-400 hover:to-orange-400 shadow-lg shadow-amber-500/20'
            }`}
          >
            {creating ? (
              <>
                <X className="w-3.5 h-3.5" /> Cancel
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" /> New
              </>
            )}
          </button>
        </div>

        {/* ── Create form ── */}
        {creating && (
          <div className="glass-card p-5 border-amber-500/20 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Swords className="w-4 h-4 text-amber-400" />
              Create Challenge
            </h3>

            {/* Type toggle */}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">
                Challenge Type
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setFormType('score')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                    formType === 'score'
                      ? 'bg-amber-400/15 border-amber-400/40 text-amber-400'
                      : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                  }`}
                >
                  <Target className="w-3.5 h-3.5" />
                  Score Battle
                </button>
                <button
                  onClick={() => setFormType('game')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                    formType === 'game'
                      ? 'bg-purple-400/15 border-purple-400/40 text-purple-400'
                      : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5" />
                  Game Battle
                </button>
              </div>
            </div>

            {/* Game mode selector */}
            {formType === 'game' && (
              <div>
                <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">
                  Game Mode
                </label>
                <div className="flex gap-2">
                  {(
                    [
                      {
                        mode: 'orbit' as const,
                        label: 'Orbit Survival',
                        cover: '/games/orbit_cover.png',
                        border: 'border-cyan-400/60',
                        glow: 'shadow-cyan-500/30',
                      },
                      {
                        mode: 'destroyer' as const,
                        label: 'Cosmic Defender',
                        cover: '/games/wars_cover.png',
                        border: 'border-red-400/60',
                        glow: 'shadow-red-500/30',
                      },
                      {
                        mode: 'gravity' as const,
                        label: 'Gravity Runner',
                        cover: '/games/gravity_cover.png',
                        border: 'border-purple-400/60',
                        glow: 'shadow-purple-500/30',
                      },
                    ] as const
                  ).map(({ mode, label, cover, border, glow }) => (
                    <button
                      key={mode}
                      onClick={() => setFormGameMode(mode)}
                      className={`flex-1 rounded-xl overflow-hidden transition-all border-2 ${
                        formGameMode === mode
                          ? `${border} shadow-lg ${glow} scale-[1.02]`
                          : 'border-white/[0.08] opacity-50 hover:opacity-75'
                      }`}
                    >
                      <div className="relative">
                        <img src={cover} alt={label} className="w-full h-20 object-cover" loading="lazy" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                        <span className="absolute bottom-1.5 left-0 right-0 text-center text-[10px] font-bold text-white drop-shadow">
                          {label}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Stake amount (Coins only) */}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">Bet</label>
              <div className="relative">
                <input
                  type="number"
                  min={5}
                  max={1000}
                  step={1}
                  value={formStake}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 0;
                    setFormStake(Math.max(5, Math.min(1000, Math.floor(v))));
                  }}
                  className="w-full px-4 py-3 pr-20 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white font-bold focus:outline-none focus:border-amber-500/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-amber-400/60">
                  Coins
                </span>
              </div>
            </div>

            {/* Opponent (optional) */}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">
                Opponent <span className="text-white/15">(optional — leave empty for open challenge)</span>
              </label>
              <input
                type="text"
                value={formOpponent}
                onChange={(e) => setFormOpponent(e.target.value)}
                placeholder="Solana wallet address..."
                className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white font-mono placeholder-white/15 focus:outline-none focus:border-amber-500/40"
              />
            </div>

            {/* Timer */}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">
                Expires In
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { val: 15, label: '15m' },
                  { val: 30, label: '30m' },
                  { val: 60, label: '1h' },
                  { val: 180, label: '3h' },
                  { val: 360, label: '6h' },
                  { val: 720, label: '12h' },
                  { val: 1440, label: '24h' },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    onClick={() => setFormExpiry(val)}
                    className={`flex-1 min-w-[40px] py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      formExpiry === val
                        ? 'bg-amber-400/15 border-amber-400/40 text-amber-400'
                        : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handleCreate}
              disabled={submitting || !myAddress}
              className="w-full py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black transition-all shadow-lg shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Creating...
                </>
              ) : (
                <>
                  <Swords className="w-4 h-4" /> Create Challenge — {formStake} Coins
                </>
              )}
            </button>
          </div>
        )}

        {/* ── Open Challenges ── */}
        {subTab === 'open' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider">
                Open Challenges
                <span className="ml-2 text-amber-400/60">{openChallenges.length}</span>
              </h3>
              <button onClick={fetchOpen} className="text-[10px] text-white/20 hover:text-white/40 transition-colors">
                {loadingOpen ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
              </button>
            </div>

            {openChallenges.length === 0 && !loadingOpen && (
              <div className="text-center py-12 text-white/20">
                <Swords className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No open challenges yet</p>
                <p className="text-xs text-white/10 mt-1">Be the first to create one</p>
              </div>
            )}

            {loadingOpen && openChallenges.length === 0 && (
              <div className="text-center py-12">
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-white/20" />
              </div>
            )}

            {openChallenges.map((c) => {
              const gm = c.type === 'game' && c.gameMode ? GAME_MODE_LABELS[c.gameMode] : null;
              return (
                <div
                  key={c.id}
                  className="relative flex overflow-hidden rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.1] transition-all"
                >
                  {/* Left accent bar */}
                  {gm && (
                    <div
                      className="w-1 shrink-0 rounded-l-2xl"
                      style={{ background: `linear-gradient(to bottom, ${gm.glow}, transparent)` }}
                    />
                  )}

                  <div className="flex-1 p-3.5 flex gap-3">
                    {/* Cover */}
                    {gm ? (
                      <img
                        src={gm.cover}
                        alt={gm.label}
                        className="w-11 h-11 rounded-xl object-cover shrink-0 mt-0.5"
                        style={{ boxShadow: `0 0 14px ${gm.accent}0.2)` }}
                      />
                    ) : (
                      <MiniPlanet tier="mercury" size={36} />
                    )}

                    {/* Info — vertical: name → wallet → stake */}
                    <div className="flex-1 min-w-0">
                      {gm && (
                        <div className="text-[13px] font-black tracking-wide mb-0.5" style={{ color: gm.glow }}>
                          {gm.label}
                        </div>
                      )}
                      <div className="text-[10px] text-white/30 font-mono truncate mb-1">{formatAddr(c.creator)}</div>
                      <div className="flex items-center gap-1">
                        <img src="/tokens/prism-icon.png" alt="" className="w-3 h-3 text-amber-400 object-contain" loading="lazy" />
                        <span className="text-[11px] font-bold text-amber-400">{c.stakeAmount} Coins</span>
                      </div>
                    </div>

                    {/* Right: accept + time under button */}
                    <div className="flex flex-col items-center shrink-0 gap-1.5">
                      {c.creator !== myAddress && (
                        <button
                          onClick={() => handleAccept(c.id)}
                          disabled={acceptingId === c.id || !myAddress}
                          className="w-10 h-10 rounded-xl flex items-center justify-center bg-green-500/15 text-green-400 border border-green-500/25 hover:bg-green-500/25 hover:border-green-500/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {acceptingId === c.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Swords className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      <span className="text-[8px] text-white/15">{timeAgo(c.createdAt)}</span>
                    </div>
                  </div>

                  {/* Ambient glow */}
                  {gm && (
                    <div
                      className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-32 h-8 rounded-full blur-2xl pointer-events-none"
                      style={{ background: gm.glow, opacity: 0.06 }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── My Challenges ── */}
        {subTab === 'mine' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider">
                My Challenges
                <span className="ml-2 text-amber-400/60">{myChallenges.length}</span>
              </h3>
              <button onClick={fetchMine} className="text-[10px] text-white/20 hover:text-white/40 transition-colors">
                {loadingMine ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
              </button>
            </div>

            {!myAddress && (
              <div className="text-center py-12 text-white/20">
                <img src="/tokens/prism-icon.png" alt="" className="w-10 h-10 mx-auto mb-3 opacity-20 object-contain" loading="lazy" />
                <p className="text-sm">Connect your wallet to see your challenges</p>
              </div>
            )}

            {myAddress && myChallenges.length === 0 && !loadingMine && (
              <div className="text-center py-12 text-white/20">
                <Swords className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No challenges yet</p>
                <p className="text-xs text-white/10 mt-1">Create one or accept an open challenge</p>
              </div>
            )}

            {loadingMine && myChallenges.length === 0 && (
              <div className="text-center py-12">
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-white/20" />
              </div>
            )}

            {myChallenges
              .filter((c) => {
                if (c.status === 'cancelled' || dismissedIds.has(c.id)) return false;
                if (c.status === 'expired') return false;
                // Hide expired: timer ran out, no opponent joined
                if (c.expiresAt && c.expiresAt < Date.now() && !c.opponent) return false;
                return true;
              })
              .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
              .map((c) => {
                const isCreator = c.creator === myAddress;
                const opponentAddr = isCreator ? c.opponent : c.creator;
                const myScore = isCreator ? c.creatorScore : c.opponentScore;
                const theirScore = isCreator ? c.opponentScore : c.creatorScore;
                const didWin = c.winner === myAddress;
                const isFinished = c.status === 'completed' || c.status === 'cancelled' || c.status === 'expired';

                const gm = c.type === 'game' && c.gameMode ? GAME_MODE_LABELS[c.gameMode] : null;
                return (
                  <div
                    key={c.id}
                    className="relative flex overflow-hidden rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.1] transition-all"
                  >
                    {/* Left accent bar */}
                    {gm && (
                      <div
                        className="w-1 shrink-0 rounded-l-2xl"
                        style={{ background: `linear-gradient(to bottom, ${gm.glow}, transparent)` }}
                      />
                    )}

                    <div className="flex-1 p-3.5">
                      {/* Header: cover + info + status */}
                      <div className="flex items-center gap-2.5 mb-3">
                        {gm ? (
                          <img
                            src={gm.cover}
                            alt={gm.label}
                            className="w-10 h-10 rounded-xl object-cover shrink-0"
                            style={{ boxShadow: `0 0 12px ${gm.accent}0.18)` }}
                          />
                        ) : (
                          <MiniPlanet tier="mercury" size={28} />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {gm && (
                              <span
                                className="text-[9px] font-bold uppercase tracking-wider opacity-50"
                                style={{ color: gm.glow }}
                              >
                                {gm.label}
                              </span>
                            )}
                            <span className="text-[10px] text-white/20">·</span>
                            <span className="text-[10px] text-white/30 font-mono truncate">
                              vs {opponentAddr ? formatAddr(opponentAddr) : 'Waiting...'}
                            </span>
                          </div>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xl bg-amber-400/10 border border-amber-400/15 text-[11px] font-bold text-amber-400">
                            <img src="/tokens/prism-icon.png" alt="" className="w-3 h-3 object-contain" loading="lazy" />
                            {c.stakeAmount} Coins
                          </span>
                        </div>
                        <StatusBadge status={c.status} />
                      </div>

                      {(c.status === 'open' || c.status === 'playing' || c.status === 'accepted') &&
                        myScore !== null && (
                          <div className="rounded-xl p-3 mb-3 bg-sky-500/10 border border-sky-500/20">
                            <p className="text-xs font-bold text-sky-400">
                              Your score: {fmtChallengeScore(myScore, c.gameMode)}
                            </p>
                            <p className="text-[10px] text-white/30 mt-0.5">
                              {!c.opponent
                                ? 'Waiting for opponent...'
                                : theirScore === null
                                  ? 'Opponent playing...'
                                  : `Opponent: ${fmtChallengeScore(theirScore, c.gameMode)}`}
                            </p>
                          </div>
                        )}

                      {c.status === 'completed' && (
                        <div
                          className={`rounded-xl p-3 mb-3 ${didWin ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className={`text-xs font-bold ${didWin ? 'text-green-400' : 'text-red-400'}`}>
                                {didWin ? `Won ${c.stakeAmount * 2} Coins` : 'Lost'}
                              </p>
                              {(myScore !== null || theirScore !== null) && (
                                <p className="text-[10px] text-white/30 mt-0.5">
                                  You: {fmtChallengeScore(myScore, c.gameMode)} / Opponent:{' '}
                                  {fmtChallengeScore(theirScore, c.gameMode)}
                                </p>
                              )}
                            </div>
                            <Trophy className={`w-5 h-5 ${didWin ? 'text-green-400' : 'text-white/10'}`} />
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        {(c.status === 'playing' || c.status === 'accepted') &&
                          c.type === 'game' &&
                          c.gameMode &&
                          myScore === null && (
                            <button
                              onClick={() =>
                                startFadeTransition(() =>
                                  navigate(
                                    `/game?challengeId=${encodeURIComponent(c.id)}&mode=${encodeURIComponent(c.gameMode || 'orbit')}&role=${c.creator === myAddress ? 'creator' : 'acceptor'}`,
                                  ),
                                )
                              }
                              className="arena-btn arena-btn-accent"
                            >
                              <Play className="w-3 h-3" />
                              Play
                            </button>
                          )}

                        {c.status === 'completed' && (
                          <button
                            onClick={() => setBattleResult(c)}
                            className={`arena-btn ${didWin ? 'arena-btn-win' : 'arena-btn-lose'}`}
                          >
                            <Eye className="w-3 h-3" />
                            Result
                          </button>
                        )}

                        {(c.status === 'open' || (c.status === 'playing' && !c.opponent)) && isCreator && (
                          <button
                            onClick={() => promptCancel(c.id)}
                            disabled={cancellingId === c.id}
                            className="arena-btn arena-btn-ghost"
                          >
                            {cancellingId === c.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <>
                                <Ban className="w-3 h-3" /> Cancel
                              </>
                            )}
                          </button>
                        )}

                        {isFinished && (
                          <button
                            onClick={() => setDismissedIds((prev) => new Set([...prev, c.id]))}
                            className="arena-btn arena-btn-ghost"
                          >
                            <XCircle className="w-3 h-3" /> Dismiss
                          </button>
                        )}

                        <span className="ml-auto text-[10px] text-white/15">
                          {c.expiresAt && c.status !== 'completed' && c.status !== 'cancelled' && c.status !== 'expired'
                            ? (() => {
                                const mins = Math.max(0, Math.ceil((c.expiresAt - Date.now()) / 60000));
                                return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
                              })()
                            : timeAgo(c.createdAt)}
                        </span>
                      </div>
                    </div>
                    {/* close flex-1 p-3.5 */}
                    {/* Ambient glow */}
                    {gm && (
                      <div
                        className="absolute -bottom-3 left-1/3 w-24 h-6 rounded-full blur-2xl pointer-events-none"
                        style={{ background: gm.glow, opacity: 0.05 }}
                      />
                    )}
                  </div>
                );
              })}
          </div>
        )}

        {/* ── Top Challengers ── */}
        {subTab === 'top' && (
          <div className="space-y-4">
            {/* Weekly countdown */}
            {nextReset > 0 && (
              <div className="glass-card p-3 text-center">
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Weekly rewards reset</div>
                <div className="text-xs font-bold text-amber-400">
                  {(() => {
                    const diff = Math.max(0, nextReset - Date.now());
                    const days = Math.floor(diff / 86400000);
                    const hrs = Math.floor((diff % 86400000) / 3600000);
                    return `${days}d ${hrs}h`;
                  })()}
                </div>
                <div className="text-[9px] text-white/20 mt-1">Min {3} completed battles to qualify</div>
              </div>
            )}

            {/* Weekly leaderboard */}
            <div>
              <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-2 mb-2">
                <Flame className="w-3.5 h-3.5 text-orange-400" />
                This Week
              </h3>
              {weeklyBoard.length === 0 && (
                <div className="text-center py-8 text-white/20">
                  <p className="text-xs">No qualifying challengers this week</p>
                </div>
              )}
              {weeklyBoard.map((p, i) => {
                const isMe = p.address === myAddress;
                const winRate = p.played > 0 ? Math.round((p.wins / p.played) * 100) : 0;
                const medalColor =
                  i === 0
                    ? 'text-amber-400'
                    : i === 1
                      ? 'text-slate-300'
                      : i === 2
                        ? 'text-orange-400'
                        : 'text-white/20';
                return (
                  <div
                    key={p.address}
                    className={`glass-card p-3 flex items-center gap-3 mb-2 ${isMe ? 'border-amber-500/30' : ''}`}
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${
                        i === 0
                          ? 'bg-amber-400/20 text-amber-400'
                          : i === 1
                            ? 'bg-slate-300/20 text-slate-300'
                            : i === 2
                              ? 'bg-orange-400/20 text-orange-400'
                              : 'bg-white/5 text-white/25'
                      }`}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono ${isMe ? 'text-amber-300' : 'text-white/50'}`}>
                          {isMe ? 'You' : formatAddr(p.address)}
                        </span>
                        <span className="text-[10px] text-white/20">{winRate}%</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-green-400">{p.wins}W</span>
                        <span className="text-[10px] text-red-400">{p.losses}L</span>
                        <span className="text-[10px] text-white/15">·</span>
                        <span className="text-[10px] text-amber-400">+{p.earned}</span>
                      </div>
                    </div>
                    {p.reward > 0 && (
                      <div className="text-right shrink-0 space-y-0.5">
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xl bg-amber-400/10 border border-amber-400/20">
                          <img src="/tokens/prism-icon.png" alt="" className="w-3 h-3 text-amber-400 object-contain" loading="lazy" />
                          <span className="text-[10px] font-bold text-amber-300">+{p.reward}</span>
                        </div>
                        {p.xpReward ? (
                          <div className="text-[9px] text-purple-400/60 text-center">+{p.xpReward} XP</div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* All-time leaderboard */}
            <div>
              <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-2 mb-2">
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                All Time
              </h3>
              {allTimeBoard.length === 0 && (
                <div className="text-center py-8 text-white/20">
                  <p className="text-xs">No completed challenges yet</p>
                </div>
              )}
              {allTimeBoard.slice(0, 10).map((p, i) => {
                const isMe = p.address === myAddress;
                const medalColor =
                  i === 0
                    ? 'text-amber-400'
                    : i === 1
                      ? 'text-slate-300'
                      : i === 2
                        ? 'text-orange-400'
                        : 'text-white/20';
                return (
                  <div
                    key={p.address}
                    className={`glass-card p-3 flex items-center gap-3 mb-2 ${isMe ? 'border-amber-500/30' : ''}`}
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${
                        i === 0
                          ? 'bg-amber-400/20 text-amber-400'
                          : i === 1
                            ? 'bg-slate-300/20 text-slate-300'
                            : i === 2
                              ? 'bg-orange-400/20 text-orange-400'
                              : 'bg-white/5 text-white/25'
                      }`}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-mono ${isMe ? 'text-amber-300' : 'text-white/50'}`}>
                        {isMe ? 'You' : formatAddr(p.address)}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-green-400">{p.wins}W</span>
                        <span className="text-[10px] text-red-400">{p.losses}L</span>
                        <span className="text-[10px] text-white/15">·</span>
                        <span className="text-[10px] text-amber-400">+{p.earned}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Challenge flow modals */}
      {readyModal && (
        <ChallengeReadyModal
          isOpen
          challenge={readyModal.challenge}
          onConfirm={() => {
            const { id, gameMode } = readyModal.challenge;
            const role = readyModal.role;
            setReadyModal(null);
            sessionStorage.setItem('ip_active_challenge', JSON.stringify({ id, role, ts: Date.now() }));
            sessionStorage.removeItem('ip_challenge_submitted');
            startFadeTransition(() => {
              navigate(
                `/game?challengeId=${encodeURIComponent(id)}&mode=${encodeURIComponent(gameMode || 'orbit')}&role=${role}`,
              );
            });
          }}
          onCancel={async () => {
            const { id } = readyModal.challenge;
            try {
              const token = getCachedJwt(myAddress);
              if (token) {
                const r = await fetch(`${getApiBase()}/api/challenge/cancel`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ challengeId: id }),
                });
                if (!r.ok) {
                  const err = await r.json().catch(() => ({ error: 'Cannot cancel' }));
                  toast.error(err.error || 'Cannot cancel challenge');
                }
              }
            } catch {}
            setReadyModal(null);
            fetchMine();
          }}
        />
      )}
      {battleResult && (
        <BattleResultOverlay
          challenge={battleResult}
          myAddress={myAddress}
          onReturn={() => {
            setBattleResult(null);
            fetchOpen();
            fetchMine();
          }}
        />
      )}

      {/* ── Cancel Confirm Modal ── */}
      {cancelConfirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setCancelConfirm(null)}
        >
          <div
            className="w-[88%] max-w-sm rounded-2xl bg-[#0a0e1a]/95 backdrop-blur-xl border border-white/[0.08] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-5">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Ban className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-base font-bold text-white/90">Cancel Challenge?</h3>
              <p className="text-xs text-white/30 mt-1">This action cannot be undone</p>
            </div>

            <div className="space-y-2 mb-5">
              <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-red-500/[0.06] border border-red-500/[0.1]">
                <span className="text-xs text-white/40">
                  Cancellation fee ({Math.round(cancelConfirm.feeRate * 100)}%)
                </span>
                <span className="text-xs font-bold text-red-400">
                  -{cancelConfirm.fee} {cancelConfirm.unit}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/[0.1]">
                <span className="text-xs text-white/40">You will receive</span>
                <span className="text-xs font-bold text-emerald-400">
                  +{cancelConfirm.refund} {cancelConfirm.unit}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setCancelConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-white/[0.05] border border-white/[0.08] text-white/50 hover:bg-white/[0.08] hover:text-white/70 transition-all"
              >
                Keep Challenge
              </button>
              <button
                onClick={() => handleCancel(cancelConfirm.challengeId)}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-all"
              >
                Cancel & Refund
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Coin History Modal ── */}
      {showCoinHistory && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowCoinHistory(false)}
        >
          <div
            className="w-full max-w-md max-h-[70vh] rounded-t-2xl sm:rounded-2xl bg-[#0a0e1a]/95 backdrop-blur-xl border border-white/[0.08] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <img src="/tokens/prism-icon.png" alt="" className="w-4 h-4 text-amber-400 object-contain" loading="lazy" />
                <span className="text-sm font-bold text-white">Coin History</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-amber-300">{coinBalance?.toLocaleString() ?? '...'} Coins</span>
                <button onClick={() => setShowCoinHistory(false)} className="text-white/30 hover:text-white/60">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[55vh] p-3 space-y-2">
              {myChallenges.length === 0 && (
                <div className="text-center py-8 text-white/20 text-xs">No challenge transactions yet</div>
              )}
              {myChallenges
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                .map((c) => {
                  const isCreator = c.creator === myAddress;
                  const gm = GAME_MODE_LABELS[c.gameMode || ''];
                  const gameName = gm?.label || 'Score Battle';
                  const didWin = c.winner === myAddress;
                  let label = '';
                  let amount = '';
                  let color = '';
                  if (c.status === 'completed') {
                    label = didWin ? 'Won' : 'Lost';
                    amount = didWin ? `+${(c.stakeAmount * 2 * 0.95) | 0}` : `-${c.stakeAmount}`;
                    color = didWin ? 'text-green-400' : 'text-red-400';
                  } else if (c.status === 'cancelled') {
                    label = 'Cancelled';
                    const fee =
                      c.creatorScore !== null ? Math.ceil(c.stakeAmount * 0.2) : Math.ceil(c.stakeAmount * 0.1);
                    amount = `-${fee} fee`;
                    color = 'text-slate-400';
                  } else if (c.status === 'expired') {
                    label = 'Expired';
                    amount = 'Refunded';
                    color = 'text-orange-400';
                  } else {
                    label = c.status === 'open' ? 'Pending' : 'In Progress';
                    amount = `-${c.stakeAmount}`;
                    color = 'text-cyan-400';
                  }
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05]"
                    >
                      {gm?.cover && <img src={gm.cover} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-white/60">{gameName}</div>
                        <div className="text-[10px] text-white/25">{new Date(c.createdAt).toLocaleDateString()}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-[11px] font-bold ${color}`}>{amount}</div>
                        <div className="text-[9px] text-white/20">{label}</div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
