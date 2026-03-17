/**
 * Text Quest Page — SR2-inspired branching narrative adventures.
 * Typewriter text effect, glass-card choices, quest list with status.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import { startFadeTransition, fadeOutTransition } from '@/lib/fadeTransition';
import { ArrowLeft, RotateCcw, ChevronRight, Lock, Trophy, Clock, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import PageShell from '@/components/PageShell';
import {
  TEXT_QUEST_DATA,
  getQuestSave,
  saveQuestState,
  resetQuest,
  startQuest,
  processChoice,
  getVisibleChoices,
  getCompletedQuests,
  type TextQuest,
  type QuestSaveState,
} from '@/lib/textQuests';
import { getHeliusRpcUrl, getCollectionMint } from '@/constants';
import { computeShipStats, DEFAULT_SHIP_STATS, type ShipStats } from '@/lib/shipStats';
import { getLocalLoadout } from '@/lib/forgeItems';
import { earnPrism } from '@/lib/prismCoin';
import { fetchWalletPreview, type WalletPreview } from '@/components/prism/shared';

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: '#4ade80',
  medium: '#fbbf24',
  hard: '#ef4444',
};

const STAT_LABELS: Record<string, string> = {
  speed: 'Speed',
  shield: 'Shield',
  firepower: 'Firepower',
  luck: 'Luck',
};

function getRandomQuestIndex(walletAddress: string): number {
  // Pick random quest, avoiding the last 2 played
  const storageKey = `quest_last_two_${walletAddress}`;
  let lastTwo: string[] = [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) lastTwo = JSON.parse(raw);
  } catch {
    /* ignore */
  }

  const available = TEXT_QUEST_DATA.map((q, i) => ({ id: q.id, idx: i })).filter((q) => !lastTwo.includes(q.id));
  // fallback if all filtered out
  const pool = available.length > 0 ? available : TEXT_QUEST_DATA.map((q, i) => ({ id: q.id, idx: i }));
  return pool[Math.floor(Math.random() * pool.length)].idx;
}

function recordQuestPlayed(walletAddress: string, questId: string) {
  const storageKey = `quest_last_two_${walletAddress}`;
  let lastTwo: string[] = [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) lastTwo = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  lastTwo.push(questId);
  if (lastTwo.length > 2) lastTwo = lastTwo.slice(-2);
  try {
    localStorage.setItem(storageKey, JSON.stringify(lastTwo));
  } catch {
    /* ignore */
  }
}

function isImagePath(src?: string): boolean {
  return !!src && src.startsWith('/quests/');
}

// ── Typewriter Hook ──
function useTypewriter(text: string, speed = 25) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const idxRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    idxRef.current = 0;
    if (!text) {
      setDone(true);
      return;
    }

    intervalRef.current = setInterval(() => {
      idxRef.current++;
      if (idxRef.current >= text.length) {
        setDisplayed(text);
        setDone(true);
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        setDisplayed(text.slice(0, idxRef.current));
      }
    }, speed);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [text, speed]);

  const skip = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setDisplayed(text);
    setDone(true);
    idxRef.current = text.length;
  }, [text]);

  return { displayed, done, skip };
}

// ── Quest List Card ──
function QuestListCard({
  quest,
  save,
  onStart,
  onResume,
  onReplay,
  canReplay = false,
}: {
  quest: TextQuest;
  save: QuestSaveState | null;
  onStart: () => void;
  onResume: () => void;
  onReplay: () => void;
  canReplay?: boolean;
}) {
  const diffColor = DIFFICULTY_COLORS[quest.difficulty];
  const isCompleted = save?.completed;
  const isInProgress = save && !save.completed;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm overflow-hidden hover:bg-white/[0.05] transition-all">
      {/* Header with image */}
      <div className="p-4 pb-2 flex items-start gap-3">
        {isImagePath(quest.image) ? (
          <img
            src={quest.image}
            alt={quest.title}
            className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
            style={{ border: `1px solid ${diffColor}30` }}
          />
        ) : (
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl flex-shrink-0"
            style={{
              background: `${diffColor}10`,
              border: `1px solid ${diffColor}20`,
            }}
          >
            {quest.image}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-bold text-sm">{quest.title}</h3>
            <span
              className="text-[8px] font-black px-1.5 py-0.5 rounded uppercase"
              style={{
                color: diffColor,
                background: `${diffColor}15`,
              }}
            >
              {quest.difficulty}
            </span>
          </div>
          <p className="text-white/30 text-[11px] leading-relaxed line-clamp-2">{quest.description}</p>
        </div>
      </div>
      {/* Footer */}
      <div className="px-4 pb-3 pt-1 flex items-center justify-between">
        <div className="flex items-center gap-3 text-white/20 text-[10px]">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> {quest.estimatedTime}
          </span>
          {isCompleted && (
            <span className="flex items-center gap-1 text-green-400/70">
              <Trophy className="w-3 h-3" /> Completed
            </span>
          )}
        </div>
        {isCompleted && canReplay ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] border-white/10 text-white/40"
            onClick={onReplay}
          >
            <RotateCcw className="w-3 h-3 mr-1" /> Retry
          </Button>
        ) : isCompleted ? (
          <span className="text-[10px] text-green-400/50 flex items-center gap-1">
            <Trophy className="w-3 h-3" /> Done
          </span>
        ) : isInProgress ? (
          <Button size="sm" className="h-7 text-[10px] bg-purple-600 hover:bg-purple-500" onClick={onResume}>
            Continue <ChevronRight className="w-3 h-3 ml-0.5" />
          </Button>
        ) : (
          <Button size="sm" className="h-7 text-[10px] bg-cyan-600 hover:bg-cyan-500" onClick={onStart}>
            Start <ChevronRight className="w-3 h-3 ml-0.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──

export default function TextQuestPage() {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() || '';

  const [activeQuest, setActiveQuest] = useState<TextQuest | null>(null);
  const [questState, setQuestState] = useState<QuestSaveState | null>(null);
  const [rewardClaimed, setRewardClaimed] = useState(false);
  const [claimingReward, setClaimingReward] = useState(false);
  const [hasMintedId, setHasMintedId] = useState(false);

  useEffect(() => {
    fadeOutTransition();
  }, []);

  // Check minted ID
  useEffect(() => {
    if (!walletAddress) return;
    const heliusUrl = getHeliusRpcUrl();
    const collectionMint = getCollectionMint();
    if (!heliusUrl || !collectionMint) return;
    (async () => {
      try {
        const res = await fetch(heliusUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'mint-check',
            method: 'searchAssets',
            params: { ownerAddress: walletAddress, grouping: ['collection', collectionMint], page: 1, limit: 1 },
          }),
        });
        const data = await res.json();
        setHasMintedId((data?.result?.total ?? 0) > 0);
      } catch {
        /* silent */
      }
    })();
  }, [walletAddress]);

  // Ship stats for skill checks (compositeScore-based)
  const [walletPreview, setWalletPreview] = useState<WalletPreview | null>(null);
  useEffect(() => {
    if (!walletAddress) {
      setWalletPreview(null);
      return;
    }
    fetchWalletPreview(walletAddress).then(setWalletPreview);
  }, [walletAddress]);
  const shipStats: ShipStats = useMemo(() => {
    if (!walletAddress) return DEFAULT_SHIP_STATS;
    const loadout = getLocalLoadout(walletAddress);
    return computeShipStats(walletPreview, loadout);
  }, [walletAddress, walletPreview]);

  // Current node
  const currentNode = activeQuest && questState ? activeQuest.nodes[questState.currentNode] : null;
  const visibleChoices = activeQuest && questState ? getVisibleChoices(activeQuest, questState, shipStats) : [];

  // Typewriter
  const { displayed, done, skip } = useTypewriter(currentNode?.text || '', 20);

  // Steps count
  const totalSteps = activeQuest ? Object.keys(activeQuest.nodes).length : 0;
  const currentStep = questState ? questState.choices.length + 1 : 0;

  const handleStart = useCallback(
    (quest: TextQuest) => {
      const existing = walletAddress ? getQuestSave(quest.id, walletAddress) : null;
      if (existing && !existing.completed) {
        setActiveQuest(quest);
        setQuestState(existing);
        setRewardClaimed(false);
      } else {
        const state = startQuest(quest);
        setActiveQuest(quest);
        setQuestState(state);
        setRewardClaimed(false);
        if (walletAddress) {
          saveQuestState(state, walletAddress);
          recordQuestPlayed(walletAddress, quest.id);
        }
      }
    },
    [walletAddress],
  );

  const handleReplay = useCallback(
    (quest: TextQuest) => {
      if (!walletAddress) return;
      // Mark replay as used in localStorage
      try {
        localStorage.setItem(`quest_replay_v1_${walletAddress}_${quest.id}`, '1');
      } catch {}
      resetQuest(quest.id, walletAddress);
      const state = startQuest(quest);
      setActiveQuest(quest);
      setQuestState(state);
      setRewardClaimed(false);
      saveQuestState(state, walletAddress);
    },
    [walletAddress],
  );

  // canReplay: only if has minted ID, quest completed, first attempt earned nothing, and replay not yet used
  const getCanReplay = useCallback(
    (questId: string, save: QuestSaveState | null): boolean => {
      if (!hasMintedId || !save?.completed || !walletAddress) return false;
      // Already replayed?
      try {
        if (localStorage.getItem(`quest_replay_v1_${walletAddress}_${questId}`)) return false;
      } catch {}
      // Only allow replay if first attempt earned no reward (failed ending)
      return !save.reward || (save.reward.coins ?? 0) === 0;
    },
    [hasMintedId, walletAddress],
  );

  const handleChoice = useCallback(
    (choiceIndex: number) => {
      if (!activeQuest || !questState) return;
      const newState = processChoice(activeQuest, questState, choiceIndex, shipStats);
      setQuestState(newState);
      if (walletAddress) saveQuestState(newState, walletAddress);
    },
    [activeQuest, questState, shipStats, walletAddress],
  );

  const handleClaimReward = useCallback(async () => {
    if (!questState?.reward || !walletAddress || rewardClaimed || claimingReward) return;
    setClaimingReward(true);
    try {
      await earnPrism(walletAddress, 'text_quest', questState.reward.coins, `Quest: ${activeQuest?.title}`);
      setRewardClaimed(true);
      toast.success(`+${questState.reward.coins} Coins!`);
    } catch {
      toast.error('Failed to claim reward');
    } finally {
      setClaimingReward(false);
    }
  }, [questState, walletAddress, rewardClaimed, claimingReward, activeQuest]);

  const handleBack = useCallback(() => {
    startFadeTransition(() => navigate('/game'));
  }, [navigate]);

  // Auto-start random quest on mount (if no active quest)
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || activeQuest) return;
    // Check if any quest is in-progress first
    if (walletAddress) {
      for (const q of TEXT_QUEST_DATA) {
        const save = getQuestSave(q.id, walletAddress);
        if (save && !save.completed) {
          autoStarted.current = true;
          handleStart(q);
          return;
        }
      }
    }
    // No in-progress quest — pick random
    const idx = getRandomQuestIndex(walletAddress || 'anonymous');
    autoStarted.current = true;
    handleStart(TEXT_QUEST_DATA[idx]);
  }, [walletAddress, activeQuest, handleStart]);

  // Load saves for quest list
  const questSaves = useMemo(() => {
    if (!walletAddress) return {};
    const saves: Record<string, QuestSaveState | null> = {};
    for (const q of TEXT_QUEST_DATA) {
      saves[q.id] = getQuestSave(q.id, walletAddress);
    }
    return saves;
  }, [walletAddress, activeQuest]); // re-check after returning from quest

  return (
    <PageShell className="text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={handleBack} className="flex items-center gap-2 text-white/50 hover:text-white text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          {activeQuest && questState && (
            <div className="text-white/20 text-[10px] font-mono">
              Step {currentStep} / ~{totalSteps}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* ═══ LOADING (auto-start picks quest) ═══ */}
        {!activeQuest && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin" />
            <p className="text-white/30 text-xs">Loading quest...</p>
          </div>
        )}

        {/* ═══ ACTIVE QUEST ═══ */}
        {activeQuest && questState && currentNode && (
          <div key={questState.currentNode} className="space-y-5">
            {/* Quest title */}
            <div className="text-center mb-2">
              <h2 className="text-lg font-bold">{activeQuest.title}</h2>
              <span
                className="text-[10px] px-2 py-0.5 rounded"
                style={{
                  color: DIFFICULTY_COLORS[activeQuest.difficulty],
                  background: `${DIFFICULTY_COLORS[activeQuest.difficulty]}15`,
                }}
              >
                {activeQuest.difficulty}
              </span>
            </div>

            {/* Text + image layout */}
            <div className={`flex gap-4 ${currentNode.image && isImagePath(currentNode.image) ? '' : ''}`}>
              <div
                className="flex-1 p-5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white/80 text-sm leading-relaxed min-h-[120px] cursor-pointer"
                onClick={() => !done && skip()}
              >
                {/* Emoji image inline */}
                {currentNode.image && !isImagePath(currentNode.image) && (
                  <div
                    className="float-left mr-3 mb-2 w-16 h-16 rounded-xl flex items-center justify-center text-3xl flex-shrink-0"
                    style={{
                      background: 'radial-gradient(ellipse at center, rgba(168,85,247,0.1), rgba(5,7,10,0.95))',
                      border: '1px solid rgba(168,85,247,0.15)',
                    }}
                  >
                    {currentNode.image}
                  </div>
                )}
                {displayed}
                {!done && <span className="animate-pulse text-purple-400">|</span>}
              </div>
              {currentNode.image && isImagePath(currentNode.image) && (
                <img
                  src={currentNode.image}
                  alt=""
                  className="w-36 h-36 rounded-2xl object-cover flex-shrink-0 self-start"
                  style={{
                    border: '1px solid rgba(168,85,247,0.15)',
                    boxShadow: '0 0 40px rgba(168,85,247,0.1)',
                  }}
                />
              )}
            </div>

            {/* Variables */}
            {Object.keys(questState.variables).length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {Object.entries(questState.variables).map(([key, value]) => (
                  <div
                    key={key}
                    className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[10px]"
                  >
                    <span className="text-white/30 uppercase">{key}:</span>{' '}
                    <span className="text-white font-bold">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Choices */}
            {!currentNode.isEnding && done && (
              <div className="space-y-2">
                {visibleChoices.map((choice, i) => {
                  const locked = !choice.passesSkillCheck;
                  return (
                    <button
                      key={i}
                      onClick={() => !locked && handleChoice(i)}
                      disabled={locked}
                      className="w-full text-left p-4 rounded-xl border transition-all duration-300 group"
                      style={{
                        background: locked ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.03)',
                        borderColor: locked ? 'rgba(255,255,255,0.04)' : 'rgba(168,85,247,0.15)',
                        opacity: locked ? 0.4 : 1,
                        cursor: locked ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <ChevronRight
                          className={`w-4 h-4 flex-shrink-0 ${locked ? 'text-white/10' : 'text-purple-400/50 group-hover:text-purple-400 group-hover:translate-x-0.5'} transition-all`}
                        />
                        <div className="flex-1">
                          <span className="text-white/80 text-sm">{choice.text}</span>
                          {choice.skillCheck && (
                            <span
                              className={`ml-2 text-[9px] px-1.5 py-0.5 rounded ${locked ? 'text-red-400/60 bg-red-500/10' : 'text-green-400/60 bg-green-500/10'}`}
                            >
                              {locked ? (
                                <Lock className="w-2.5 h-2.5 inline mr-0.5" />
                              ) : (
                                <Zap className="w-2.5 h-2.5 inline mr-0.5" />
                              )}
                              {STAT_LABELS[choice.skillCheck.stat]} {choice.skillCheck.min}+
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Ending */}
            {currentNode.isEnding && done && (
              <div className="space-y-4">
                <div className="text-center p-4 rounded-xl bg-gradient-to-b from-purple-500/10 to-transparent border border-purple-500/20">
                  <Trophy className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                  <p className="text-white font-bold text-sm mb-1">Quest Complete!</p>
                  <p className="text-white/30 text-xs">
                    Ending: {currentNode.id.replace('ending_', '').replace(/_/g, ' ')}
                  </p>
                  {currentNode.reward && (
                    <p className="text-amber-400 font-bold text-lg mt-2">+{currentNode.reward.coins} Coins</p>
                  )}
                </div>
                {currentNode.reward && walletAddress && !rewardClaimed && (
                  <Button
                    className="w-full h-12 bg-amber-500 hover:bg-amber-400 text-black font-bold"
                    onClick={handleClaimReward}
                    disabled={claimingReward}
                  >
                    {claimingReward ? 'Claiming...' : 'Claim Reward'}
                  </Button>
                )}
                {rewardClaimed && <p className="text-center text-green-400/60 text-xs">Reward claimed!</p>}
                <div className="flex gap-3">
                  {getCanReplay(activeQuest.id, questState) && (
                    <Button
                      variant="outline"
                      className="flex-1 h-10 text-xs border-white/10"
                      onClick={() => handleReplay(activeQuest)}
                    >
                      <RotateCcw className="w-3 h-3 mr-1" /> Retry
                    </Button>
                  )}
                  <Button variant="outline" className="flex-1 h-10 text-xs border-white/10" onClick={handleBack}>
                    Back
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
