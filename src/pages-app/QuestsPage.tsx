/**
 * Quests Page — Daily/Weekly/One-time challenges for Identity Prism v5.
 * Complete quests to earn XP toward Ranger Ranks.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useActiveWalletAddress } from '@/lib/useActiveWalletAddress';
import { goBack } from '@/lib/safeNavigate';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
import { ArrowLeft, Gift, Check, Clock, Flame, Star, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  DAILY_QUESTS,
  WEEKLY_QUESTS,
  ONE_TIME_QUESTS,
  getQuestState,
  getQuestProgress,
  claimQuestReward,
  getUnclaimedCount,
  syncMilestoneProgress,
  incrementQuest,
  type Quest,
  type QuestProgress,
  type QuestState,
} from '@/lib/prismQuests';
import type { PrismBalance } from '@/lib/prismCoin';
import PageShell from '@/components/PageShell';
import { getApiBase } from '@/components/prism/shared';
import { getHeliusRpcUrl, getCollectionMint } from '@/constants';
import { useRangerProgress } from '@/hooks/useRangerProgress';
import { getCompletedQuests } from '@/lib/textQuests';

type QuestTab = 'daily' | 'weekly' | 'milestones';

const TABS: { id: QuestTab; label: string; icon: string }[] = [
  { id: 'daily', label: 'Daily', icon: '/icons/tabs/quest_tab_daily.svg' },
  { id: 'weekly', label: 'Weekly', icon: '/icons/tabs/quest_tab_weekly.svg' },
  { id: 'milestones', label: 'Milestones', icon: '/icons/tabs/quest_tab_milestones.svg' },
];

function IconAsset({ icon, className = 'w-6 h-6' }: { icon: string; className?: string }) {
  if (icon.startsWith('/')) {
    return <img src={icon} alt="" className={`${className} object-contain shrink-0`} loading="lazy" />;
  }
  return <span className="text-2xl">{icon}</span>;
}

function QuestCard({
  quest,
  progress,
  onClaim,
  claiming,
}: {
  quest: Quest;
  progress: QuestProgress;
  onClaim: () => void;
  claiming: boolean;
}) {
  const current = Number.isFinite(Number(progress.current)) ? Math.max(0, Number(progress.current)) : 0;
  const target = Number.isFinite(Number(quest.target)) ? Math.max(0, Number(quest.target)) : 0;
  const reward = Number.isFinite(Number(quest.reward)) ? Math.max(0, Number(quest.reward)) : 0;
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const isComplete = progress.completed;
  const isClaimed = Boolean(progress.claimedAt);

  return (
    <div
      className={`p-4 rounded-xl border transition-all ${
        isClaimed
          ? 'bg-white/[0.02] border-white/5 opacity-50'
          : isComplete
            ? 'bg-green-500/5 border-green-500/20'
            : 'bg-white/[0.03] border-white/8 hover:bg-white/[0.05]'
      }`}
    >
      <div className="flex items-start gap-3">
        <IconAsset icon={quest.icon} className="w-10 h-10" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-bold text-sm">{quest.name}</h3>
            {isClaimed && <Check className="w-4 h-4 text-green-400" />}
          </div>
          <p className="text-white/40 text-xs mb-1">{quest.description}</p>

          {/* Progress bar — hide when complete */}
          {!isComplete && (
            <div className="flex items-center gap-3 mt-2">
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)',
                  }}
                />
              </div>
              <span className="text-white/50 text-[10px] font-mono whitespace-nowrap">
                {current}/{target}
              </span>
            </div>
          )}
        </div>

        {/* Reward / Claim button */}
        <div className="text-right flex-shrink-0">
          {isClaimed ? (
            <span className="text-green-400/50 text-xs">Claimed</span>
          ) : isComplete ? (
            <Button
              size="sm"
              className="bg-green-500 hover:bg-green-400 text-black font-bold text-xs h-8 px-3"
              onClick={onClaim}
              disabled={claiming}
            >
              <Gift className="w-3 h-3 mr-1" />
              Claim
            </Button>
          ) : (
            <div className="text-right">
              <p className="text-cyan-300 font-bold text-sm font-mono">+{reward}</p>
              <p className="text-white/50 text-[9px]">XP</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QuestsPage() {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const walletAddress = useActiveWalletAddress() || publicKey?.toBase58() || '';
  const rangerProgress = useRangerProgress(walletAddress || null);

  const [activeTab, setActiveTab] = useState<QuestTab>('daily');
  const [questState, setQuestState] = useState<QuestState | null>(null);
  const [balance, setBalance] = useState<PrismBalance | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    fadeOutTransition();
  }, []);

  useEffect(() => {
    if (!walletAddress) return;
    let s = getQuestState(walletAddress);
    s = syncMilestoneProgress(s, walletAddress);
    setQuestState(s);

    const base = getApiBase();
    if (!base) return;

    // Fetch balance
    fetch(`${base}/api/prism/balance?address=${encodeURIComponent(walletAddress)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setBalance(d);
      })
      .catch(() => {});

    // Async: check mint + inventory via wallet-database for milestone quests
    fetch(`${base}/api/wallet-database?address=${encodeURIComponent(walletAddress)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((wallet) => {
        if (!wallet) return;
        let updated = getQuestState(walletAddress); // re-read fresh
        let changed = false;

        // Mint check — wallet exists in DB means they were scanned, check badges/tier for minted
        if (wallet.badges?.length > 0 || wallet.tier !== 'mercury') {
          const r = incrementQuest(updated, 'ot_first_scan');
          updated = r.state;
          if (r.justCompleted) changed = true;
        }

        // Check arena wins
        const arenaRaw = localStorage.getItem(`prism_arena_stats_${walletAddress}`);
        if (arenaRaw) {
          try {
            const wins = JSON.parse(arenaRaw)?.wins || 0;
            if (wins > 0) {
              const r = incrementQuest(updated, 'ot_arena_wins', wins);
              updated = r.state;
              if (r.justCompleted) changed = true;
            }
          } catch {}
        }

        if (changed) setQuestState({ ...updated });
      })
      .catch(() => {});

    // Async: check if minted via DAS (searchAssets)
    const heliusUrl = getHeliusRpcUrl();
    const collectionMint = getCollectionMint();
    if (heliusUrl && collectionMint) {
      fetch(heliusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'qm',
          method: 'searchAssets',
          params: { ownerAddress: walletAddress, grouping: ['collection', collectionMint], page: 1, limit: 1 },
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if ((data?.result?.total ?? 0) > 0) {
            // Cache for sync functions
            localStorage.setItem(`prism_minted_${walletAddress}`, 'true');
            const st = getQuestState(walletAddress);
            const r = incrementQuest(st, 'ot_first_mint');
            if (r.justCompleted) setQuestState({ ...r.state });
          }
        })
        .catch(() => {});
    }
  }, [walletAddress]);

  const quests = useMemo(() => {
    switch (activeTab) {
      case 'daily':
        return DAILY_QUESTS;
      case 'weekly':
        return WEEKLY_QUESTS;
      case 'milestones':
        return ONE_TIME_QUESTS;
    }
  }, [activeTab]);

  const handleClaim = useCallback(
    (quest: Quest) => {
      if (!walletAddress || !questState || claiming) return;
      // Mark as claimed locally — XP is stored in quest state
      const updatedState = claimQuestReward(questState, quest.id);
      if (updatedState === questState) return; // already claimed — no change
      const prevState = questState;
      setQuestState({ ...updatedState });
      setClaiming(quest.id);
      toast.success(`+${quest.reward} XP`, { description: quest.name });
      setClaiming(null);
      // Verify server accepted the claim — refetch within 2s, revert if rejected
      (async () => {
        try {
          const base = getApiBase();
          if (!base) return;
          await new Promise((r) => setTimeout(r, 1500));
          const resp = await fetch(`${base}/api/quest/progress?address=${encodeURIComponent(walletAddress)}`);
          if (!resp.ok) return;
          const data = await resp.json();
          const serverQ = data?.quests?.[quest.id];
          if (serverQ && !serverQ.claimedAt) {
            console.warn(`[quests] handleClaim: server did not record claim for ${quest.id}, reverting`);
            setQuestState(prevState);
            toast.warning('Quest not yet synced with server');
          }
        } catch (err) {
          console.warn('[quests] handleClaim verify failed:', err);
        }
      })();
    },
    [walletAddress, questState, claiming],
  );

  const unclaimedCount = questState ? getUnclaimedCount(questState) : 0;

  // Time until daily reset
  const dailyReset = questState?.dailyResetAt;
  const [timeLeft, setTimeLeft] = useState('');
  useEffect(() => {
    if (!dailyReset) return;
    const tick = () => {
      const diff = new Date(dailyReset).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('Resetting...');
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(`${h}h ${m}m`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [dailyReset]);

  return (
    <PageShell className="text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => {
              startFadeTransition(() => goBack(navigate));
            }}
            className="flex items-center gap-2 text-white/50 hover:text-white text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-3">
            {unclaimedCount > 0 && (
              <span className="bg-green-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full">
                {unclaimedCount} to claim
              </span>
            )}
            <div className="flex items-center gap-1.5">
              <img src="/textures/powerups/powerup_coin.png" alt="" className="w-5 h-5 object-contain" loading="lazy" />
              <span className="text-amber-300 font-bold font-mono">{balance?.balance ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Ranger Rank */}
        {walletAddress &&
          (() => {
            const { xp, rank, progress, next } = rangerProgress;
            const safeXp = Number.isFinite(Number(xp)) ? Math.max(0, Math.floor(Number(xp))) : 0;
            const safeRankProgress = Number.isFinite(Number(progress)) ? Math.min(1, Math.max(0, Number(progress))) : 0;
            const safeXpNeeded = Number.isFinite(Number(next?.xpNeeded))
              ? Math.max(0, Math.floor(Number(next?.xpNeeded)))
              : 0;
            return (
              <div className="mb-5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <img
                      src={rank.image}
                      alt={rank.name}
                      className="w-7 h-7 object-contain"
                      style={
                        rank.id === 'ace' || rank.id === 'legend'
                          ? { filter: `drop-shadow(0 0 5px ${rank.id === 'legend' ? '#f59e0b' : '#a855f7'})` }
                          : undefined
                      }
                    />
                    <div>
                      <span className={`text-sm font-bold ${rank.color}`}>{rank.name}</span>
                      <span className="text-white/50 text-[10px] ml-2">{safeXp} XP</span>
                    </div>
                  </div>
                  {next && (
                    <span className="text-white/50 text-[10px]">
                      {safeXpNeeded} XP to {next.rank.name}
                    </span>
                  )}
                </div>
                <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-400 transition-all"
                    style={{ width: `${safeRankProgress * 100}%` }}
                  />
                </div>
                {rank.perks.length > 0 && (
                  <div className="mt-1.5 flex gap-2 flex-wrap">
                    {rank.perks.map((p, i) => (
                      <span key={i} className="text-[9px] text-purple-300/50 px-1.5 py-0.5 bg-purple-500/5 rounded">
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

        {/* Title + streak */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black">
              <IconAsset icon="/icons/quests/quest_explore.png" className="w-8 h-8" />
              Daily Quests
            </h1>
            <p className="text-white/50 text-xs mt-1">Complete challenges, earn Coins</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-amber-400">
              <Flame className="w-4 h-4" />
              <span className="font-bold text-sm">{questState?.currentStreak ?? 0}</span>
            </div>
            <p className="text-white/50 text-[9px]">day streak</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-3 bg-white/5 rounded-xl p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === tab.id ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'
              }`}
            >
              <IconAsset icon={tab.icon} className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Timer — fixed height to prevent jumping */}
        <div className="h-5 mb-4 flex items-center">
          {activeTab === 'daily' && timeLeft && (
            <div className="flex items-center gap-2 text-white/50 text-xs">
              <Clock className="w-3 h-3" />
              <span>Resets in {timeLeft}</span>
            </div>
          )}
          {activeTab === 'weekly' && questState?.weeklyResetAt && (
            <div className="flex items-center gap-2 text-white/50 text-xs">
              <Clock className="w-3 h-3" />
              <span>
                Resets{' '}
                {(() => {
                  const diff = new Date(questState.weeklyResetAt).getTime() - Date.now();
                  if (diff <= 0) return 'soon';
                  const d = Math.floor(diff / 86400000);
                  const h = Math.floor((diff % 86400000) / 3600000);
                  return `in ${d}d ${h}h`;
                })()}
              </span>
            </div>
          )}
        </div>

        {/* Quest list */}
        <div className="space-y-3">
          {quests.map((quest) => (
            <QuestCard
              key={quest.id}
              quest={quest}
              progress={
                questState
                  ? getQuestProgress(questState, quest.id)
                  : { questId: quest.id, current: 0, completed: false, completedAt: null, claimedAt: null }
              }
              onClaim={() => handleClaim(quest)}
              claiming={claiming === quest.id}
            />
          ))}
        </div>

        {/* Stats */}
        <div className="mt-8 p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-white font-bold text-lg">{questState?.totalCompleted ?? 0}</p>
              <p className="text-white/50 text-[10px] uppercase tracking-wider">Completed</p>
            </div>
            <div>
              <p className="text-cyan-300 font-bold text-lg">{questState?.totalXPEarned ?? 0}</p>
              <p className="text-white/50 text-[10px] uppercase tracking-wider">XP Earned</p>
            </div>
            <div>
              <p className="text-amber-400 font-bold text-lg">{questState?.currentStreak ?? 0}d</p>
              <p className="text-white/50 text-[10px] uppercase tracking-wider">Day Streak</p>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
