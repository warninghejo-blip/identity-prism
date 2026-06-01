import { useState, useEffect, useCallback } from 'react';
import { Trophy, XCircle, Clock, Award, Star, Coins, Bell, Trash2, CheckCheck } from 'lucide-react';
import PageShell from '@/components/PageShell';
import { fetchApiJson, getApiBase, getCachedJwt } from '@/components/prism/shared';
import {
  clearCachedNotifications,
  readCachedNotifications,
  writeCachedNotifications,
  type CachedNotification,
} from '@/lib/notificationCache';
import { useNavigate } from 'react-router-dom';
import { useActiveWalletAddress } from '@/lib/useActiveWalletAddress';
import { goBack } from '@/lib/safeNavigate';
import HubReturnButton from '@/components/HubReturnButton';

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  challenge_win: Trophy,
  challenge_loss: XCircle,
  challenge_expired: Clock,
  tournament_result: Award,
  quest_milestone: Star,
  weekly_payout: Coins,
  yield_available: Coins,
  system: Bell,
};

const TYPE_COLORS: Record<string, string> = {
  challenge_win: 'text-green-400',
  challenge_loss: 'text-red-400',
  challenge_expired: 'text-amber-400',
  tournament_result: 'text-purple-400',
  quest_milestone: 'text-cyan-400',
  weekly_payout: 'text-yellow-400',
  yield_available: 'text-emerald-400',
  system: 'text-white/50',
};

type Notification = CachedNotification;

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function authHeaders(address: string): Record<string, string> {
  const jwt = getCachedJwt(address);
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

export default function InboxPage() {
  const navigate = useNavigate();
  const address = useActiveWalletAddress();
  const [notifications, setNotifications] = useState<Notification[]>(() =>
    address ? (readCachedNotifications(address) ?? []) : [],
  );
  const [loading, setLoading] = useState(() => Boolean(address && !readCachedNotifications(address)));
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const base = getApiBase();

  const fetchNotifications = useCallback(async () => {
    if (!address) {
      setLoading(false);
      setNeedsSignIn(true);
      setError(null);
      return;
    }
    const cached = readCachedNotifications(address);
    if (cached) {
      setNotifications(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    const jwt = getCachedJwt(address);
    if (!jwt) {
      setNeedsSignIn(true);
      setError(null);
      setLoading(false);
      return;
    }
    setNeedsSignIn(false);
    setError(null);
    try {
      const data = await fetchApiJson<{
        error?: string;
        notifications?: Notification[];
      }>(`${base}/api/notifications?address=${address}`, {
        headers: { Authorization: `Bearer ${jwt}` },
        timeoutMs: 3_500,
      });
      const nextNotifications = Array.isArray(data.notifications) ? data.notifications : [];
      setNotifications(nextNotifications);
      writeCachedNotifications(address, nextNotifications);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Notifications failed to load.';
      if (message.includes('401') || message.includes('403')) {
        setNeedsSignIn(true);
        setError('Sign wallet to load notifications.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [address, base]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markRead = useCallback(
    async (ids: string[]) => {
      setNotifications((prev) => {
        const next = prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n));
        if (address) writeCachedNotifications(address, next);
        return next;
      });
      try {
        await fetch(`${base}/api/notifications/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders(address) },
          body: JSON.stringify({ ids }),
        });
      } catch {}
    },
    [address, base],
  );

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      if (address) writeCachedNotifications(address, next);
      return next;
    });
    try {
      await fetch(`${base}/api/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(address) },
        body: JSON.stringify({ all: true }),
      });
    } catch {}
  }, [address, base]);

  const deleteNotif = useCallback(
    async (id: string) => {
      setNotifications((prev) => {
        const next = prev.filter((n) => n.id !== id);
        if (address) writeCachedNotifications(address, next);
        return next;
      });
      try {
        await fetch(`${base}/api/notifications/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders(address) },
          body: JSON.stringify({ ids: [id] }),
        });
      } catch {}
    },
    [address, base],
  );

  const deleteAll = useCallback(async () => {
    setNotifications([]);
    if (address) clearCachedNotifications(address);
    try {
      await fetch(`${base}/api/notifications/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(address) },
        body: JSON.stringify({ all: true }),
      });
    } catch {}
  }, [address, base]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <PageShell className="text-white">
      <div className="min-h-screen bg-[#05070a] flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/[0.06]">
          <HubReturnButton fallback={address ? `/app?address=${encodeURIComponent(address)}` : '/app'} />
          <div className="flex-1">
            <h1 className="text-sm font-bold text-white/90 tracking-wide">Notifications</h1>
            {unreadCount > 0 && <p className="text-[10px] text-cyan-400/70">{unreadCount} unread</p>}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors text-cyan-400 text-[10px] font-semibold"
              >
                <CheckCheck className="w-3 h-3" />
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={deleteAll}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 transition-colors text-red-400 text-[10px] font-semibold"
              >
                <Trash2 className="w-3 h-3" />
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1">
          {loading && (
            <div className="space-y-2 px-4 py-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-16 rounded-2xl bg-white/[0.04] motion-safe:animate-pulse" />
              ))}
            </div>
          )}

          {!loading && (needsSignIn || error) && notifications.length === 0 && (
            <div className="mx-4 mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-5 text-center">
              <Bell className="mx-auto h-8 w-8 text-amber-300/60" />
              <p className="mt-3 text-sm font-semibold text-white/80">
                {needsSignIn ? 'Wallet signature needed' : "Couldn't load notifications"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                {error ?? 'Return to the hub and sign once to load your inbox instantly.'}
              </p>
              {needsSignIn ? (
                <HubReturnButton className="mt-4" fallback={address ? `/app?address=${encodeURIComponent(address)}` : '/app'} />
              ) : (
                <button
                  type="button"
                  onClick={() => void fetchNotifications()}
                  className="mt-4 h-10 rounded-xl bg-white px-4 text-xs font-bold text-zinc-950 transition-colors hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {!loading && !needsSignIn && !error && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Bell className="w-10 h-10 text-white/10" />
              <p className="text-sm text-white/30">No notifications yet</p>
            </div>
          )}

          {!loading &&
            notifications.map((n) => {
              const Icon = TYPE_ICONS[n.type] ?? Bell;
              const colorClass = TYPE_COLORS[n.type] ?? 'text-white/50';
              return (
                <div
                  key={n.id}
                  className={`flex items-center gap-2 border-b border-white/[0.04] px-4 py-2 transition-colors hover:bg-white/[0.02] ${n.read ? 'opacity-50' : ''}`}
                >
                  <button
                    type="button"
                    className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-xl py-1 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-inset"
                    onClick={() => {
                      if (!n.read) markRead([n.id]);
                    }}
                  >
                    <div
                      className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400"
                      style={{ opacity: n.read ? 0 : 1 }}
                    />
                    <Icon className={`h-4 w-4 flex-shrink-0 ${colorClass}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-relaxed text-white/80">{n.message}</p>
                      <p className="mt-0.5 text-[10px] text-white/30">{timeAgo(n.timestamp)}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotif(n.id);
                    }}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-white/20 transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
                    aria-label="Delete notification"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </PageShell>
  );
}
