/**
 * Prism Arena — P2P Challenge system.
 * Extracted from NebulaMarket.tsx ChallengesTab.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  ArrowLeft, Zap, Plus, X, Swords, Gamepad2, Target, Flame,
  CircleDot, Clock, Check, Play, Ban, Shield, Loader2,
  Trophy, ArrowUpDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import PageShell from '@/components/PageShell';
import ChallengeReadyModal from '@/components/ChallengeReadyModal';
import BattleResultOverlay, { type ChallengeResult } from '@/components/BattleResultOverlay';
import { goBack } from '@/lib/safeNavigate';
import { trackChallengeCreate, trackChallengeAccept } from '@/lib/analytics';
import {
  getApiBase,
  getCachedJwt,
  obtainJwt,
  isServerAvailable,
  MiniPlanet,
  formatAddr,
  timeAgo,
} from '@/components/prism/shared';

// ── Challenge types ──

interface Challenge {
  id: string;
  creator: string;
  opponent: string | null;
  type: 'score' | 'game';
  gameMode: string | null;
  stakeType: 'coins' | 'sol';
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
};

const GAME_MODE_LABELS: Record<string, { label: string; color: string }> = {
  orbit: { label: 'Orbit', color: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10' },
  destroyer: { label: 'Destroyer', color: 'text-red-400 border-red-400/30 bg-red-400/10' },
  gravity: { label: 'Gravity', color: 'text-purple-400 border-purple-400/30 bg-purple-400/10' },
};

function TypeBadge({ challenge }: { challenge: Challenge }) {
  if (challenge.type === 'game' && challenge.gameMode) {
    const mode = GAME_MODE_LABELS[challenge.gameMode];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${mode?.color ?? 'text-white/40 border-white/10 bg-white/5'}`}>
        <Gamepad2 className="w-3 h-3" />
        {mode?.label ?? challenge.gameMode}
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
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.text} ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function PrismArena() {
  const navigate = useNavigate();
  const wallet = useWallet();
  const myAddress = wallet.publicKey?.toBase58() || '';

  const [openChallenges, setOpenChallenges] = useState<Challenge[]>([]);
  const [myChallenges, setMyChallenges] = useState<Challenge[]>([]);
  const [creating, setCreating] = useState(false);
  const [subTab, setSubTab] = useState<'open' | 'mine'>('open');
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [loadingMine, setLoadingMine] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [formType, setFormType] = useState<'score' | 'game'>('score');
  const [formGameMode, setFormGameMode] = useState<'orbit' | 'destroyer' | 'gravity'>('orbit');
  const [formStake, setFormStake] = useState<number>(10);
  const [formBetType, setFormBetType] = useState<'coins' | 'sol'>('coins');
  const [formOpponent, setFormOpponent] = useState('');

  const [readyModal, setReadyModal] = useState<{ challenge: { id: string; gameMode: string | null; stakeAmount: number; stakeType: 'coins' | 'sol' }; role: 'creator' | 'acceptor' } | null>(null);
  const [battleResult, setBattleResult] = useState<ChallengeResult | null>(null);

  const prevMineRef = useRef<string>('');
  const actionLockRef = useRef(false);

  const base = getApiBase();

  // ── Fetch open challenges ──
  const fetchOpen = useCallback(async () => {
    if (!(await isServerAvailable(base))) return;
    setLoadingOpen(true);
    try {
      const res = await fetch(`${base}/api/challenge/list`);
      if (res.ok) {
        const data = await res.json();
        setOpenChallenges(Array.isArray(data) ? data : data.challenges ?? []);
      }
    } catch { /* ignore */ }
    setLoadingOpen(false);
  }, [base]);

  // ── Fetch my challenges ──
  const fetchMine = useCallback(async () => {
    if (!myAddress) return;
    if (!(await isServerAvailable(base))) return;
    setLoadingMine(true);
    try {
      const res = await fetch(`${base}/api/challenge/my?address=${encodeURIComponent(myAddress)}`);
      if (res.ok) {
        const data = await res.json();
        const list: Challenge[] = Array.isArray(data) ? data : data.challenges ?? [];
        setMyChallenges(list);

        const newKey = list.map(c => `${c.id}:${c.status}`).join(',');
        if (prevMineRef.current && prevMineRef.current !== newKey) {
          const prevMap = new Map<string, string>();
          prevMineRef.current.split(',').forEach(entry => {
            const [id, status] = entry.split(':');
            if (id) prevMap.set(id, status);
          });
          for (const c of list) {
            const prevStatus = prevMap.get(c.id);
            if (prevStatus && prevStatus !== c.status) {
              if (c.status === 'accepted') toast.info('Challenge accepted! Get ready to battle.');
              else if (c.status === 'playing') toast.info('Challenge is now in play!');
              else if (c.status === 'completed') {
                if (c.winner === myAddress) toast.success(`You won ${c.stakeAmount * 2} ${c.stakeType === 'sol' ? 'SOL' : 'Coins'}!`);
                else toast.error(`You lost the challenge. ${c.stakeAmount} ${c.stakeType === 'sol' ? 'SOL' : 'Coins'} gone.`);
              } else if (c.status === 'cancelled') toast.info('Challenge was cancelled.');
            }
          }
        }
        prevMineRef.current = newKey;
      }
    } catch { /* ignore */ }
    setLoadingMine(false);
  }, [base, myAddress]);

  // ── Initial fetch + polling ──
  useEffect(() => {
    fetchOpen();
    fetchMine();
    const interval = setInterval(() => {
      fetchMine();
      if (subTab === 'open') fetchOpen();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchOpen, fetchMine, subTab]);

  // ── Create challenge ──
  const handleCreate = useCallback(async () => {
    if (actionLockRef.current) return;
    if (!myAddress) { toast.error('Connect your wallet first'); return; }
    const isSol = formBetType === 'sol';
    if (!isSol && (formStake < 1 || formStake > 1000)) { toast.error('Stake must be between 1 and 1000 Coins'); return; }
    if (isSol && (formStake <= 0 || formStake > 10)) { toast.error('SOL stake must be between 0.01 and 10 SOL'); return; }

    actionLockRef.current = true;
    setSubmitting(true);
    try {
      let jwt = getCachedJwt(myAddress);
      if (!jwt) {
        jwt = await obtainJwt(wallet);
        if (!jwt) { toast.error('Please sign the message to authenticate'); setSubmitting(false); actionLockRef.current = false; return; }
      }

      let solTxSignature: string | undefined;
      if (isSol) {
        try {
          const { Connection: SolConn, PublicKey: SolPK, SystemProgram: SolSP, Transaction: SolTx } = await import('@solana/web3.js');
          const conn = new SolConn(base.replace(/\/+$/, '').replace('/api', '') + '/rpc', 'confirmed');
          const treasuryAddr = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
          const tx = new SolTx().add(
            SolSP.transfer({ fromPubkey: new SolPK(myAddress), toPubkey: new SolPK(treasuryAddr), lamports: Math.floor(formStake * 1e9) })
          );
          tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
          tx.feePayer = new SolPK(myAddress);
          const signed = await wallet.signTransaction!(tx);
          const sig = await conn.sendRawTransaction(signed.serialize());
          await conn.confirmTransaction(sig, 'confirmed');
          solTxSignature = sig;
          toast.info('SOL transfer confirmed, creating challenge...');
        } catch (e: any) {
          toast.error(e?.message || 'SOL transfer failed');
          setSubmitting(false); actionLockRef.current = false; return;
        }
      }

      const body: Record<string, unknown> = { type: formType, stakeAmount: formStake, betType: formBetType };
      if (isSol && solTxSignature) body.solTxSignature = solTxSignature;
      if (formType === 'game') body.gameMode = formGameMode;
      if (formOpponent.trim().length >= 32) body.opponent = formOpponent.trim();

      const res = await fetch(`${base}/api/challenge/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        trackChallengeCreate();
        const resData = await res.json().catch(() => ({}));
        setCreating(false);
        setFormOpponent('');
        setFormStake(isSol ? 0.1 : 10);
        fetchOpen();
        fetchMine();

        if (formType === 'game') {
          setReadyModal({
            challenge: { id: resData.challenge?.id ?? resData.id ?? '', gameMode: formGameMode, stakeAmount: formStake, stakeType: formBetType },
            role: 'creator',
          });
        } else {
          toast.success(`Challenge created! ${isSol ? formStake + ' SOL' : formStake + ' Coins'} staked`);
        }
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to create challenge' }));
        toast.error(err.error || 'Failed to create challenge');
      }
    } catch {
      toast.error('Network error — could not create challenge');
    } finally {
      actionLockRef.current = false;
    }
    setSubmitting(false);
  }, [myAddress, formType, formGameMode, formStake, formBetType, formOpponent, base, wallet, fetchOpen, fetchMine]);

  // ── Accept challenge ──
  const handleAccept = useCallback(async (challengeId: string) => {
    if (actionLockRef.current) return;
    if (!myAddress) { toast.error('Connect your wallet first'); return; }

    actionLockRef.current = true;
    setAcceptingId(challengeId);
    try {
      let jwt = getCachedJwt(myAddress);
      if (!jwt) {
        jwt = await obtainJwt(wallet);
        if (!jwt) { toast.error('Please sign the message to authenticate'); setAcceptingId(null); actionLockRef.current = false; return; }
      }

      const challenge = [...openChallenges, ...myChallenges].find(c => c.id === challengeId);
      let solTxSignature: string | undefined;
      if (challenge?.stakeType === 'sol') {
        try {
          const { Connection: SolConn, PublicKey: SolPK, SystemProgram: SolSP, Transaction: SolTx } = await import('@solana/web3.js');
          const conn = new SolConn(base.replace(/\/+$/, '').replace('/api', '') + '/rpc', 'confirmed');
          const treasuryAddr = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
          const tx = new SolTx().add(
            SolSP.transfer({ fromPubkey: new SolPK(myAddress), toPubkey: new SolPK(treasuryAddr), lamports: Math.floor(challenge.stakeAmount * 1e9) })
          );
          tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
          tx.feePayer = new SolPK(myAddress);
          const signed = await wallet.signTransaction!(tx);
          const sig = await conn.sendRawTransaction(signed.serialize());
          await conn.confirmTransaction(sig, 'confirmed');
          solTxSignature = sig;
          toast.info('SOL transfer confirmed, accepting challenge...');
        } catch (e: any) {
          toast.error(e?.message || 'SOL transfer failed');
          setAcceptingId(null); actionLockRef.current = false; return;
        }
      }

      const acceptBody: Record<string, unknown> = { challengeId };
      if (solTxSignature) acceptBody.solTxSignature = solTxSignature;

      const res = await fetch(`${base}/api/challenge/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(acceptBody),
      });

      if (res.ok) {
        trackChallengeAccept();
        const resData = await res.json().catch(() => ({}));
        fetchOpen();
        fetchMine();

        if (challenge?.type === 'game' && challenge.gameMode) {
          setReadyModal({
            challenge: { id: challenge.id, gameMode: challenge.gameMode, stakeAmount: challenge.stakeAmount, stakeType: challenge.stakeType },
            role: 'acceptor',
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
    }
    setAcceptingId(null);
  }, [myAddress, base, wallet, fetchOpen, fetchMine, openChallenges, myChallenges]);

  // ── Cancel challenge ──
  const handleCancel = useCallback(async (challengeId: string) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setCancellingId(challengeId);
    try {
      let jwt = getCachedJwt(myAddress);
      if (!jwt) {
        jwt = await obtainJwt(wallet);
        if (!jwt) { toast.error('Please sign the message to authenticate'); setCancellingId(null); actionLockRef.current = false; return; }
      }

      const res = await fetch(`${base}/api/challenge/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ challengeId }),
      });

      if (res.ok) {
        toast.info('Challenge cancelled. Stake refunded.');
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
    }
    setCancellingId(null);
  }, [myAddress, base, wallet, fetchOpen, fetchMine]);

  return (
    <PageShell>
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => goBack(navigate)}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-sm font-bold bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent">
            PRISM ARENA
          </h1>
          <div className="w-16" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Header actions */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
            <button
              onClick={() => setSubTab('open')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                subTab === 'open' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'
              }`}
            >
              Open
            </button>
            <button
              onClick={() => setSubTab('mine')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                subTab === 'mine' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'
              }`}
            >
              Mine
            </button>
          </div>
          <Button
            onClick={() => setCreating(!creating)}
            size="sm"
            className={creating
              ? 'bg-white/5 hover:bg-white/10 text-white/50 border border-white/10'
              : 'bg-amber-500 hover:bg-amber-400 text-black font-bold'
            }
          >
            {creating ? <><X className="w-3.5 h-3.5 mr-1" /> Cancel</> : <><Plus className="w-3.5 h-3.5 mr-1" /> New Challenge</>}
          </Button>
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
              <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">Challenge Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setFormType('score')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all border ${
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
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all border ${
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
                <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">Game Mode</label>
                <div className="flex gap-2">
                  {([
                    { mode: 'orbit' as const, label: 'Orbit', icon: CircleDot, active: 'bg-cyan-400/15 border-cyan-400/40 text-cyan-400' },
                    { mode: 'destroyer' as const, label: 'Destroyer', icon: Flame, active: 'bg-red-400/15 border-red-400/40 text-red-400' },
                    { mode: 'gravity' as const, label: 'Gravity', icon: ArrowUpDown, active: 'bg-purple-400/15 border-purple-400/40 text-purple-400' },
                  ] as const).map(({ mode, label, icon: Icon, active }) => (
                    <button
                      key={mode}
                      onClick={() => setFormGameMode(mode)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                        formGameMode === mode ? active : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bet type toggle */}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">Bet Currency</label>
              <div className="flex gap-2">
                <button
                  onClick={() => { setFormBetType('coins'); setFormStake(10); }}
                  className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                    formBetType === 'coins' ? 'bg-amber-400/15 border-amber-400/40 text-amber-400' : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                  }`}
                >
                  Coins
                </button>
                <button
                  onClick={() => { setFormBetType('sol'); setFormStake(0.1); }}
                  className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                    formBetType === 'sol' ? 'bg-purple-400/15 border-purple-400/40 text-purple-400' : 'bg-white/[0.03] border-white/[0.06] text-white/30 hover:text-white/50'
                  }`}
                >
                  SOL
                </button>
              </div>
            </div>

            {/* Stake amount */}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1.5 block">
                Stake Amount {formBetType === 'sol' && <span className="text-purple-400/50">(10% fee)</span>}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={formBetType === 'sol' ? 0.01 : 1}
                  max={formBetType === 'sol' ? 10 : 1000}
                  step={formBetType === 'sol' ? 0.01 : 1}
                  value={formStake}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 0;
                    setFormStake(formBetType === 'sol' ? Math.max(0.01, Math.min(10, v)) : Math.max(1, Math.min(1000, Math.floor(v))));
                  }}
                  className="w-full px-4 py-3 pr-20 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white font-bold focus:outline-none focus:border-amber-500/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold ${formBetType === 'sol' ? 'text-purple-400/60' : 'text-amber-400/60'}`}>
                  {formBetType === 'sol' ? 'SOL' : 'Coins'}
                </span>
              </div>
              {formBetType === 'sol' && (
                <p className="text-[10px] text-white/20 mt-1">Winner gets {(formStake * 2 * 0.9).toFixed(3)} SOL (90% of pool)</p>
              )}
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

            {/* Submit */}
            <Button
              onClick={handleCreate}
              disabled={submitting || !myAddress}
              className="w-full h-11 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
              ) : (
                <><Swords className="w-4 h-4 mr-2" /> Create Challenge — {formStake} {formBetType === 'sol' ? 'SOL' : 'Coins'}</>
              )}
            </Button>
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
              <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-white/20" /></div>
            )}

            {openChallenges.map((c) => (
              <div key={c.id} className="glass-card p-4 hover:bg-white/[0.06] transition-all hover:border-white/[0.12]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <MiniPlanet tier="mercury" size={32} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-mono text-white/50">{formatAddr(c.creator)}</span>
                        <TypeBadge challenge={c} />
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20">
                          <Zap className="w-3 h-3" />
                          {c.stakeAmount} {c.stakeType === 'sol' ? 'SOL' : 'Coins'}
                        </span>
                        <span className="text-[10px] text-white/20">
                          <Clock className="w-3 h-3 inline mr-0.5 -mt-0.5" />
                          {timeAgo(c.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {c.creator !== myAddress && (
                    <Button
                      onClick={() => handleAccept(c.id)}
                      disabled={acceptingId === c.id || !myAddress}
                      size="sm"
                      className="bg-green-500 hover:bg-green-400 text-black font-bold shrink-0 min-h-[44px]"
                    >
                      {acceptingId === c.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : c.type === 'game' ? (
                        <><Swords className="w-3.5 h-3.5 mr-1" /> Accept & Play</>
                      ) : (
                        <><Check className="w-3.5 h-3.5 mr-1" /> Accept</>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
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
                <Zap className="w-10 h-10 mx-auto mb-3 opacity-20" />
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
              <div className="text-center py-12"><Loader2 className="w-6 h-6 mx-auto animate-spin text-white/20" /></div>
            )}

            {myChallenges.map((c) => {
              const isCreator = c.creator === myAddress;
              const opponentAddr = isCreator ? c.opponent : c.creator;
              const myScore = isCreator ? c.creatorScore : c.opponentScore;
              const theirScore = isCreator ? c.opponentScore : c.creatorScore;
              const didWin = c.winner === myAddress;

              return (
                <div key={c.id} className="glass-card p-4 hover:bg-white/[0.06] transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <MiniPlanet tier="mercury" size={24} />
                      <span className="text-xs font-mono text-white/40">
                        vs {opponentAddr ? formatAddr(opponentAddr) : 'Open'}
                      </span>
                      <TypeBadge challenge={c} />
                    </div>
                    <StatusBadge status={c.status} />
                  </div>

                  <div className="flex items-center gap-1 text-sm font-bold text-amber-400 mb-3">
                    <Zap className="w-3.5 h-3.5" />
                    {c.stakeAmount} {c.stakeType === 'sol' ? 'SOL' : 'Coins'}
                  </div>

                  {c.status === 'completed' && (
                    <div className={`rounded-lg p-3 mb-3 ${didWin ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className={`text-xs font-bold ${didWin ? 'text-green-400' : 'text-red-400'}`}>
                            {didWin ? `Won ${c.stakeAmount * 2} ${c.stakeType === 'sol' ? 'SOL' : 'Coins'}` : 'Lost'}
                          </p>
                          {(myScore !== null || theirScore !== null) && (
                            <p className="text-[10px] text-white/30 mt-0.5">
                              You: {myScore ?? '—'} / Opponent: {theirScore ?? '—'}
                            </p>
                          )}
                        </div>
                        <Trophy className={`w-5 h-5 ${didWin ? 'text-green-400' : 'text-white/10'}`} />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {(c.status === 'playing' || c.status === 'accepted') && c.type === 'game' && c.gameMode && (
                      <Button
                        onClick={() => navigate(`/game?challengeId=${c.id}&mode=${c.gameMode}`)}
                        size="sm"
                        className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold"
                      >
                        <Play className="w-3.5 h-3.5 mr-1" />
                        Play Now
                      </Button>
                    )}

                    {c.status === 'open' && isCreator && (
                      <Button
                        onClick={() => handleCancel(c.id)}
                        disabled={cancellingId === c.id}
                        size="sm"
                        variant="ghost"
                        className="text-white/30 hover:text-red-400 hover:bg-red-400/10"
                      >
                        {cancellingId === c.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <><Ban className="w-3.5 h-3.5 mr-1" /> Cancel</>
                        )}
                      </Button>
                    )}

                    <span className="ml-auto text-[10px] text-white/15">{timeAgo(c.createdAt)}</span>
                  </div>
                </div>
              );
            })}
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
            setReadyModal(null);
            navigate(`/game?challengeId=${id}&mode=${gameMode}`);
          }}
          onClose={() => setReadyModal(null)}
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
    </PageShell>
  );
}
