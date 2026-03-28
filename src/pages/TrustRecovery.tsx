/**
 * Trust Recovery — prove you're human, improve your trust score.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  ArrowLeft,
  Shield,
  Twitter,
  Gamepad2,
  Link2,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  Trophy,
  Zap,
  Target,
  Award,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageShell from '@/components/PageShell';
import { goBack } from '@/lib/safeNavigate';
import { fadeOutTransition, startFadeTransition } from '@/lib/fadeTransition';
import { getApiBase, ensureJwt } from '@/components/prism/shared';

const BASE = () => getApiBase();

interface RecoveryStatus {
  currentTrustScore: number;
  adjustedTrustScore: number;
  recoveryBonus: number;
  maxRecovery: number;
  breakdown: { twitterBonus: number; activityBonus: number; crossVerifBonus: number };
  twitter: {
    verified: boolean;
    username: string;
    displayName: string;
    photoURL: string | null;
    accountAgeDays: number;
    followers: number;
    bonus: number;
  } | null;
  activity: {
    gameTypes: number;
    achievements: number;
    quests: number;
    streak: number;
    scans: number;
    challengeWins: number;
    bonus: number;
  };
  cooldownUntil: number | null;
}

function TrustGauge({ current, adjusted, max }: { current: number; adjusted: number; max: number }) {
  const currentPct = (current / max) * 100;
  const adjustedPct = (adjusted / max) * 100;
  const bonusPct = adjustedPct - currentPct;
  return (
    <div className="relative h-4 rounded-full bg-white/[0.04] border border-white/[0.06] overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 transition-all duration-1000"
        style={{ width: `${currentPct}%`, opacity: 0.4 }}
      />
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 transition-all duration-1000"
        style={{ width: `${adjustedPct}%`, opacity: 0.8 }}
      />
      {bonusPct > 0 && (
        <div
          className="absolute inset-y-0 rounded-full bg-cyan-400/30 border-r-2 border-cyan-400 transition-all duration-1000"
          style={{ left: `${currentPct}%`, width: `${bonusPct}%` }}
        />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-bold text-white/80 drop-shadow">
          {current}
          {adjusted > current ? ` → ${adjusted}` : ''} / {max}
        </span>
      </div>
    </div>
  );
}

function GradeLabel({ score }: { score: number }) {
  const grade =
    score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score >= 50 ? 'D' : 'F';
  const color = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
  return <span className={`font-bold ${color}`}>{grade}</span>;
}

export default function TrustRecovery() {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() || '';
  useEffect(() => {
    fadeOutTransition();
  }, []);

  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [twitterLoading, setTwitterLoading] = useState(false);
  const [error, setError] = useState('');
  const [manualUsername, setManualUsername] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!address) return;
    try {
      const r = await fetch(`${BASE()}/api/recovery/status?address=${address}`);
      if (r.ok) setStatus(await r.json());
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [address]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Handle Twitter OAuth callback (after redirect from Twitter back to /recovery)
  useEffect(() => {
    if (!address) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) return;

    // Clean URL immediately so refresh doesn't re-trigger
    window.history.replaceState({}, '', '/recovery');

    (async () => {
      setTwitterLoading(true);
      setError('');
      try {
        const r = await fetch(`${BASE()}/api/recovery/twitter/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });
        const data = await r.json();
        if (data.success) {
          await fetchStatus();
        } else if (data.oauth_only) {
          // OAuth succeeded but API can't fetch profile — ask for manual username
          setShowManualInput(true);
          setError('');
        } else {
          setError(data.error || 'Failed to link Twitter');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Twitter link failed');
      }
      setTwitterLoading(false);
    })();
  }, [address, fetchStatus]);

  const handleTwitterLink = async () => {
    if (!address) return;
    setTwitterLoading(true);
    setError('');
    try {
      const jwt = await ensureJwt();
      if (!jwt) {
        setError('Wallet auth required. Reconnect wallet.');
        setTwitterLoading(false);
        return;
      }
      // Get Twitter OAuth URL from our server
      const r = await fetch(`${BASE()}/api/recovery/twitter/auth`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const data = await r.json();
      if (!data.url) {
        setError(data.error || 'Failed to start Twitter auth');
        setTwitterLoading(false);
        return;
      }
      // Redirect current page to Twitter (no popup, no Firebase — just works)
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Twitter authentication failed');
      setTwitterLoading(false);
    }
  };

  const handleManualTwitterLink = async () => {
    const username = manualUsername.replace(/^@/, '').trim();
    if (!username || !address) return;
    setTwitterLoading(true);
    setError('');
    try {
      const jwt = await ensureJwt();
      if (!jwt) {
        setError('Wallet auth required.');
        setTwitterLoading(false);
        return;
      }
      const r = await fetch(`${BASE()}/api/recovery/twitter/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          twitterUserId: `oauth_verified_${username}`,
          twitterUsername: username,
          displayName: username,
          photoURL: null,
        }),
      });
      const data = await r.json();
      if (r.ok && data.success) {
        setShowManualInput(false);
        setManualUsername('');
        await fetchStatus();
      } else {
        setError(data.error || 'Failed to link Twitter');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Link failed');
    }
    setTwitterLoading(false);
  };

  const handleTwitterUnlink = async () => {
    if (!address) return;
    if (!confirm('Unlink Twitter? 30-day cooldown before re-linking.')) return;
    try {
      const jwt = await ensureJwt();
      await fetch(`${BASE()}/api/recovery/twitter/unlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
      });
      await fetchStatus();
    } catch {
      /* ignore */
    }
  };

  if (!address) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Lock className="w-12 h-12 text-white/10" />
          <p className="text-white/30 text-sm">Connect wallet to access Trust Recovery</p>
        </div>
      </PageShell>
    );
  }

  const s = status;
  const bd = s?.breakdown;

  return (
    <PageShell>
      <div className="max-w-lg mx-auto px-4 pb-20 pt-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => goBack(navigate)}
            className="p-2.5 rounded-xl hover:bg-white/5 transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5 text-white/40" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white/90 flex items-center gap-2">
              <Shield className="w-5 h-5 text-cyan-400" /> Trust Recovery
            </h1>
            <p className="text-xs text-white/30">Prove you're human, improve your score</p>
          </div>
          <button
            onClick={() => {
              startFadeTransition();
              navigate('/');
            }}
            className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white/30 text-xs hover:bg-white/[0.06] hover:text-white/50 transition-colors"
          >
            Home
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 text-cyan-400/30 animate-spin" />
          </div>
        ) : s ? (
          <>
            {/* Trust Score Overview */}
            <div className="rounded-xl border border-cyan-500/[0.1] bg-gradient-to-br from-cyan-900/[0.06] to-blue-900/[0.04] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40 font-bold uppercase tracking-wider">Trust Score</span>
                <div className="flex items-center gap-2">
                  <GradeLabel score={s.currentTrustScore} />
                  {s.recoveryBonus > 0 && (
                    <>
                      <ChevronRight className="w-3 h-3 text-white/20" />
                      <GradeLabel score={s.adjustedTrustScore} />
                    </>
                  )}
                </div>
              </div>
              <TrustGauge current={s.currentTrustScore} adjusted={s.adjustedTrustScore} max={100} />
              <div className="flex justify-between text-[10px] text-white/25">
                <span>
                  Recovery: +{s.recoveryBonus} / {s.maxRecovery} max
                </span>
                <span>{s.maxRecovery - s.recoveryBonus} points available</span>
              </div>
            </div>

            {/* Twitter Verification */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Twitter className="w-4 h-4 text-sky-400" />
                  <span className="text-sm font-bold text-white/80">Twitter Verification</span>
                </div>
                <span className="text-xs text-cyan-400/70 font-mono">+{bd?.twitterBonus || 0}/12</span>
              </div>

              {s.twitter ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 p-2 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/[0.1]">
                    {s.twitter.photoURL && <img src={s.twitter.photoURL} alt="" className="w-8 h-8 rounded-full" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white/80 truncate">{s.twitter.displayName}</p>
                      <p className="text-[10px] text-white/30">
                        @{s.twitter.username} · {Math.round(s.twitter.accountAgeDays / 365)}y · {s.twitter.followers}{' '}
                        followers
                      </p>
                    </div>
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  </div>
                  <button
                    onClick={handleTwitterUnlink}
                    className="text-[10px] text-red-400/40 hover:text-red-400/70 transition-colors p-2 -m-1"
                  >
                    Unlink (30d cooldown)
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-white/30">
                    Link your Twitter/X account to prove identity. Older accounts with followers get more bonus.
                  </p>
                  {s.cooldownUntil && Date.now() < s.cooldownUntil ? (
                    <p className="text-xs text-amber-400/60">
                      Cooldown: {Math.ceil((s.cooldownUntil - Date.now()) / 86400000)} days remaining
                    </p>
                  ) : (
                    <Button
                      onClick={handleTwitterLink}
                      disabled={twitterLoading}
                      className="w-full bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 text-sky-300"
                    >
                      {twitterLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Twitter className="w-4 h-4 mr-2" />
                      )}
                      Link Twitter Account
                    </Button>
                  )}
                  {error && <p className="text-xs text-red-400">{error}</p>}
                  {showManualInput && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-amber-400/80">OAuth verified. Enter your X username:</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={manualUsername}
                          onChange={(e) => setManualUsername(e.target.value)}
                          placeholder="@username"
                          className="flex-1 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-sky-500/40"
                        />
                        <Button
                          onClick={handleManualTwitterLink}
                          disabled={twitterLoading || !manualUsername.replace(/^@/, '').trim()}
                          className="bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/30 text-sky-300 text-sm"
                        >
                          {twitterLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Link'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="text-[10px] text-white/15 space-y-0.5">
                <p>+3 base · +4 account 3y+ · +3 followers 500+ · +2 tweets 1000+</p>
              </div>
            </div>

            {/* In-App Activity */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-bold text-white/80">In-App Activity</span>
                </div>
                <span className="text-xs text-cyan-400/70 font-mono">+{bd?.activityBonus || 0}/8</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Game Types', value: s.activity.gameTypes, need: 3, icon: Gamepad2 },
                  { label: 'Achievements', value: s.activity.achievements, need: 5, icon: Trophy },
                  { label: 'Quests Done', value: s.activity.quests, need: 5, icon: Target },
                  { label: 'Day Streak', value: s.activity.streak, need: 7, icon: Zap },
                  { label: 'Wallet Scans', value: s.activity.scans, need: 10, icon: Shield },
                  { label: 'Arena Wins', value: s.activity.challengeWins, need: 3, icon: Award },
                ].map((item) => {
                  const done = item.value >= item.need;
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className={`flex items-center gap-2 p-2 rounded-xl border transition-colors ${
                        done ? 'bg-emerald-500/[0.06] border-emerald-500/[0.1]' : 'bg-white/[0.01] border-white/[0.04]'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${done ? 'text-emerald-400' : 'text-white/15'}`} />
                      <div className="min-w-0">
                        <p className={`text-[10px] font-bold ${done ? 'text-emerald-300/70' : 'text-white/30'}`}>
                          {item.label}
                        </p>
                        <p className={`text-[10px] ${done ? 'text-emerald-400/50' : 'text-white/15'}`}>
                          {item.value}/{item.need}
                        </p>
                      </div>
                      {done && <CheckCircle className="w-3 h-3 text-emerald-400/60 ml-auto flex-shrink-0" />}
                    </div>
                  );
                })}
              </div>

              <p className="text-[10px] text-white/15">
                Earn bonus by playing games, completing quests, and using the app
              </p>
            </div>

            {/* Cross-Verification */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-bold text-white/80">Cross-Verification</span>
                </div>
                <span className="text-xs text-cyan-400/70 font-mono">+{bd?.crossVerifBonus || 0}/5</span>
              </div>
              <p className="text-xs text-white/30">
                {(bd?.crossVerifBonus || 0) >= 3
                  ? 'Twitter + Activity verified — full cross-bonus active!'
                  : 'Combine Twitter verification with in-app activity for extra bonus'}
              </p>
              <div className="flex gap-2">
                <div
                  className={`flex-1 text-center p-1.5 rounded-lg text-[10px] ${s.twitter ? 'bg-emerald-500/10 text-emerald-300/70' : 'bg-white/[0.02] text-white/15'}`}
                >
                  Twitter {s.twitter ? '✓' : '—'}
                </div>
                <div
                  className={`flex-1 text-center p-1.5 rounded-lg text-[10px] ${(bd?.activityBonus || 0) >= 3 ? 'bg-emerald-500/10 text-emerald-300/70' : 'bg-white/[0.02] text-white/15'}`}
                >
                  Activity {(bd?.activityBonus || 0) >= 3 ? '✓' : '—'}
                </div>
              </div>
            </div>

            {/* Info */}
            <p className="text-[10px] text-white/15 text-center">
              Max recovery: +25 trust points. On-chain signals remain authoritative.
            </p>
          </>
        ) : (
          <div className="text-center py-20">
            <XCircle className="w-8 h-8 text-red-400/20 mx-auto mb-2" />
            <p className="text-xs text-white/20">Failed to load recovery status</p>
          </div>
        )}
      </div>
    </PageShell>
  );
}
