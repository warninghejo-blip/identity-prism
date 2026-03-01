/**
 * Quests Page — Daily/Weekly/One-time challenges for Identity Prism v5.
 * Complete quests to earn PRISM coins.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { ArrowLeft, Gift, Check, Clock, Flame, Star, ChevronRight } from 'lucide-react';
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
  type Quest,
  type QuestProgress,
  type QuestState,
} from '@/lib/prismQuests';
import { earnPrism, getPrismBalance, type PrismBalance } from '@/lib/prismCoin';

type QuestTab = 'daily' | 'weekly' | 'milestones';

const TABS: { id: QuestTab; label: string; icon: string }[] = [
  { id: 'daily', label: 'Daily', icon: '☀️' },
  { id: 'weekly', label: 'Weekly', icon: '📅' },
  { id: 'milestones', label: 'Milestones', icon: '⭐' },
];

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
  const pct = quest.target > 0 ? Math.min(100, (progress.current / quest.target) * 100) : 0;
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
        <span className="text-2xl">{quest.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-bold text-sm">{quest.name}</h3>
            {isClaimed && <Check className="w-4 h-4 text-green-400" />}
          </div>
          <p className="text-white/40 text-xs mb-3">{quest.description}</p>

          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background: isComplete
                    ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                    : 'linear-gradient(90deg, #8b5cf6, #a78bfa)',
                }}
              />
            </div>
            <span className="text-white/30 text-[10px] font-mono whitespace-nowrap">
              {progress.current}/{quest.target}
            </span>
          </div>
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
              <p className="text-purple-300 font-bold text-sm font-mono">+{quest.reward}</p>
              <p className="text-white/20 text-[9px]">PRISM</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QuestsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const address = searchParams.get('address');
  const { publicKey } = useWallet();
  const walletAddress = address || publicKey?.toBase58() || '';

  const [activeTab, setActiveTab] = useState<QuestTab>('daily');
  const [questState, setQuestState] = useState<QuestState | null>(null);
  const [balance, setBalance] = useState<PrismBalance | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    if (!walletAddress) return;
    setQuestState(getQuestState(walletAddress));
    getPrismBalance(walletAddress).then(setBalance);
  }, [walletAddress]);

  const quests = useMemo(() => {
    switch (activeTab) {
      case 'daily': return DAILY_QUESTS;
      case 'weekly': return WEEKLY_QUESTS;
      case 'milestones': return ONE_TIME_QUESTS;
    }
  }, [activeTab]);

  const handleClaim = useCallback(async (quest: Quest) => {
    if (!walletAddress || !questState) return;
    setClaiming(quest.id);

    const result = await earnPrism(walletAddress, `quest_${quest.frequency}` as any, quest.reward, `Quest: ${quest.name}`);
    const updatedState = claimQuestReward(questState, quest.id);
    setQuestState({ ...updatedState });
    setBalance(result.balance);
    setClaiming(null);

    toast.success(`+${quest.reward} PRISM`, { description: quest.name });
  }, [walletAddress, questState]);

  const unclaimedCount = questState ? getUnclaimedCount(questState) : 0;

  // Time until daily reset
  const dailyReset = questState?.dailyResetAt;
  const [timeLeft, setTimeLeft] = useState('');
  useEffect(() => {
    if (!dailyReset) return;
    const tick = () => {
      const diff = new Date(dailyReset).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft('Resetting...'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(`${h}h ${m}m`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [dailyReset]);

  return (
    <div className="min-h-screen bg-[#050510] text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-white/50 hover:text-white text-sm">
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
              <span className="text-lg">💎</span>
              <span className="text-purple-300 font-bold font-mono">{balance?.balance ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Title + streak */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-black">🎯 Prism Quests</h1>
            <p className="text-white/30 text-xs mt-1">Complete challenges, earn PRISM</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-amber-400">
              <Flame className="w-4 h-4" />
              <span className="font-bold text-sm">{questState?.currentStreak ?? 0}</span>
            </div>
            <p className="text-white/20 text-[9px]">day streak</p>
          </div>
        </div>

        {/* Timer */}
        {activeTab === 'daily' && timeLeft && (
          <div className="flex items-center gap-2 text-white/20 text-xs mb-4">
            <Clock className="w-3 h-3" />
            <span>Resets in {timeLeft}</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white/5 rounded-xl p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === tab.id
                  ? 'bg-white/10 text-white'
                  : 'text-white/30 hover:text-white/50'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Quest list */}
        <div className="space-y-3">
          {quests.map((quest) => (
            <QuestCard
              key={quest.id}
              quest={quest}
              progress={questState ? getQuestProgress(questState, quest.id) : { questId: quest.id, current: 0, completed: false, completedAt: null, claimedAt: null }}
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
              <p className="text-white/20 text-[10px] uppercase tracking-wider">Completed</p>
            </div>
            <div>
              <p className="text-purple-300 font-bold text-lg">{balance?.totalEarned ?? 0}</p>
              <p className="text-white/20 text-[10px] uppercase tracking-wider">Total Earned</p>
            </div>
            <div>
              <p className="text-amber-400 font-bold text-lg">{questState?.currentStreak ?? 0}d</p>
              <p className="text-white/20 text-[10px] uppercase tracking-wider">Best Streak</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
