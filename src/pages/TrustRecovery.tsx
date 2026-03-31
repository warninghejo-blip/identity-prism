/**
 * Trust Recovery — prove you're human, improve your trust score.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  ArrowLeft,
  Shield,
  Gamepad2,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  Trophy,
  Zap,
  Target,
  Award,
  Lock,
  Star,
} from 'lucide-react';
import PageShell from '@/components/PageShell';
import { goBack } from '@/lib/safeNavigate';
import { fadeOutTransition, startFadeTransition } from '@/lib/fadeTransition';
import { getApiBase } from '@/components/prism/shared';

const BASE = () => getApiBase();

interface RecoveryStatus {
  currentTrustScore: number;
  adjustedTrustScore: number;
  recoveryBonus: number;
  maxRecovery: number;
  breakdown: { activityBonus: number };
  activity: {
    gameTypes: number;
    achievements: number;
    quests: number;
    streak: number;
    scans: number;
    challengeWins: number;
    gamesPlayed: number;
    textQuests: number;
    bonus: number;
  };
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
                  Activity bonus: +{bd?.activityBonus || 0} / {s.maxRecovery} max
                </span>
                <span>{s.maxRecovery - s.recoveryBonus} points available</span>
              </div>
            </div>

            {/* Activity — primary trust method */}
            <div className="rounded-xl border border-purple-500/[0.12] bg-gradient-to-br from-purple-900/[0.06] to-indigo-900/[0.04] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-bold text-white/80">Activity Score</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Star className="w-3 h-3 text-amber-400" />
                  <span className="text-sm font-bold text-amber-300">+{bd?.activityBonus || 0}</span>
                  <span className="text-xs text-white/25 font-mono">/{s.maxRecovery}</span>
                </div>
              </div>

              <p className="text-xs text-white/40 leading-relaxed">
                Your trust score improves as you use the app. Play games, complete quests, hunt sybils, and win
                challenges to prove you're human.
              </p>

              {/* Activity progress bar */}
              <div className="space-y-1">
                <div className="relative h-2 rounded-full bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-purple-500 to-indigo-400 transition-all duration-1000"
                    style={{ width: `${Math.min(((bd?.activityBonus || 0) / s.maxRecovery) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-white/20">
                  <span>0</span>
                  <span>{s.maxRecovery} max</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Game Types', value: s.activity.gameTypes, need: 3, icon: Gamepad2, desc: 'types played' },
                  { label: 'Games Played', value: s.activity.gamesPlayed, need: 10, icon: Trophy, desc: 'total games' },
                  { label: 'Quests Done', value: s.activity.quests, need: 5, icon: Target, desc: 'quests' },
                  { label: 'Text Quests', value: s.activity.textQuests, need: 3, icon: Award, desc: 'completed' },
                  { label: 'Day Streak', value: s.activity.streak, need: 7, icon: Zap, desc: 'days' },
                  { label: 'Wallet Scans', value: s.activity.scans, need: 10, icon: Shield, desc: 'scans' },
                  { label: 'Achievements', value: s.activity.achievements, need: 5, icon: Star, desc: 'earned' },
                  { label: 'Arena Wins', value: s.activity.challengeWins, need: 3, icon: Award, desc: 'wins' },
                ].map((item) => {
                  const done = item.value >= item.need;
                  const pct = Math.min((item.value / item.need) * 100, 100);
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className={`flex flex-col gap-1.5 p-2.5 rounded-xl border transition-colors ${
                        done ? 'bg-emerald-500/[0.07] border-emerald-500/[0.15]' : 'bg-white/[0.02] border-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Icon
                            className={`w-3.5 h-3.5 flex-shrink-0 ${done ? 'text-emerald-400' : 'text-white/20'}`}
                          />
                          <p className={`text-[10px] font-bold ${done ? 'text-emerald-300/80' : 'text-white/35'}`}>
                            {item.label}
                          </p>
                        </div>
                        {done ? (
                          <CheckCircle className="w-3 h-3 text-emerald-400/70 flex-shrink-0" />
                        ) : (
                          <span className={`text-[10px] font-mono ${done ? 'text-emerald-400/60' : 'text-white/20'}`}>
                            {item.value}/{item.need}
                          </span>
                        )}
                      </div>
                      <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${done ? 'bg-emerald-400/60' : 'bg-purple-400/40'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {done && (
                        <p className="text-[9px] text-emerald-400/50">
                          {item.value} {item.desc} ✓
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Info */}
            <p className="text-[10px] text-white/15 text-center">
              Max recovery: +{s.maxRecovery} trust points. On-chain signals remain authoritative.
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
