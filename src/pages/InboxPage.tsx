import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Trophy, XCircle, Clock, Award, Star, Coins, Bell, Trash2, CheckCheck, ArrowLeft } from 'lucide-react';
import PageShell from '@/components/PageShell';
import { getApiBase } from '@/components/prism/shared';
import { getSessionJwt } from '@/components/prism/shared';
import { useNavigate } from 'react-router-dom';

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

interface Notification {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  read: boolean;
  meta?: Record<string, unknown>;
}

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

function authHeaders(): Record<string, string> {
  const jwt = getSessionJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

export default function InboxPage() {
  const { publicKey } = useWallet();
  const navigate = useNavigate();
  const address = publicKey?.toBase58() ?? '';
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const base = getApiBase();

  const fetchNotifications = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${base}/api/notifications?address=${address}`, {
        headers: { ...authHeaders() },
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [address, base]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markRead = useCallback(
    async (ids: string[]) => {
      setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
      try {
        await fetch(`${base}/api/notifications/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ ids }),
        });
      } catch {}
    },
    [base],
  );

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch(`${base}/api/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ all: true }),
      });
    } catch {}
  }, [base]);

  const deleteNotif = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      try {
        await fetch(`${base}/api/notifications/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ ids: [id] }),
        });
      } catch {}
    },
    [base],
  );

  const deleteAll = useCallback(async () => {
    setNotifications([]);
    try {
      await fetch(`${base}/api/notifications/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ all: true }),
      });
    } catch {}
  }, [base]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <PageShell className="text-white">
      <div className="min-h-screen bg-[#05070a] flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/[0.06]">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-white/50" />
          </button>
          <div className="flex-1">
            <h1 className="text-sm font-bold text-white/90 tracking-wide">Notifications</h1>
            {unreadCount > 0 && <p className="text-[10px] text-cyan-400/70">{unreadCount} unread</p>}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors text-cyan-400 text-[10px] font-semibold"
              >
                <CheckCheck className="w-3 h-3" />
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={deleteAll}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors text-red-400 text-[10px] font-semibold"
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
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-white/20 border-t-cyan-400 rounded-full animate-spin" />
            </div>
          )}

          {!loading && notifications.length === 0 && (
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
                  className={`flex items-start gap-3 px-4 py-3 border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.02] transition-colors ${n.read ? 'opacity-50' : ''}`}
                  onClick={() => {
                    if (!n.read) markRead([n.id]);
                  }}
                >
                  {/* Unread dot */}
                  <div
                    className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 bg-cyan-400"
                    style={{ opacity: n.read ? 0 : 1 }}
                  />
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${colorClass}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/80 leading-relaxed">{n.message}</p>
                    <p className="text-[10px] text-white/30 mt-0.5">{timeAgo(n.timestamp)}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotif(n.id);
                    }}
                    className="p-1 text-white/20 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </PageShell>
  );
}
