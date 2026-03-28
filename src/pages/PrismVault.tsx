/**
 * Prism Vault — Buy Coins + Staking.
 * Extracted from StellarForge for dedicated financial hub.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import { fadeOutTransition, startFadeTransition } from '@/lib/fadeTransition';
import { ArrowLeft, Coins, Loader2, AlertTriangle, Plus, Shield, Clock, TrendingUp, Zap } from 'lucide-react';
import PageShell from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getPrismBalance, COIN_PACKAGES, type PrismBalance } from '@/lib/prismCoin';
import { getApiBase } from '@/components/prism/shared';

// COIN_PACKAGES imported from prismCoin.ts

function BuyCoinsSection({ walletAddress, onPurchased }: { walletAddress: string; onPurchased: () => void }) {
  const wallet = useWallet();
  const [buyingIdx, setBuyingIdx] = useState<number | null>(null);
  const [status, setStatus] = useState<{ purchasedToday: number; remainingToday: number } | null>(null);

  useEffect(() => {
    if (!walletAddress) return;
    const base = getApiBase();
    fetch(`${base}/api/prism/buy/status?address=${walletAddress}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStatus(d);
      })
      .catch(() => {});
  }, [walletAddress]);

  const handleBuy = useCallback(
    async (pkgIndex: number) => {
      if (buyingIdx !== null || !walletAddress || !wallet.publicKey || !wallet.signTransaction) return;
      const pkg = COIN_PACKAGES[pkgIndex];
      setBuyingIdx(pkgIndex);

      try {
        const {
          Connection: SolConn,
          PublicKey: SolPK,
          SystemProgram: SolSP,
          Transaction: SolTx,
        } = await import('@solana/web3.js');
        const base = getApiBase();
        const conn = new SolConn(base.replace(/\/+$/, '').replace('/api', '') + '/rpc', 'confirmed');
        const treasuryAddr = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
        const tx = new SolTx().add(
          SolSP.transfer({
            fromPubkey: new SolPK(walletAddress),
            toPubkey: new SolPK(treasuryAddr),
            lamports: Math.floor(pkg.solPrice * 1e9),
          }),
        );
        tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
        tx.feePayer = new SolPK(walletAddress);
        const simulation = await conn.simulateTransaction(tx, undefined, {
          sigVerify: false,
          replaceRecentBlockhash: true,
        });
        if (simulation.value.err)
          throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
        tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
        const signed = await wallet.signTransaction(tx);
        const sig = await conn.sendRawTransaction(signed.serialize());
        toast.info('Confirming transaction...');
        await conn.confirmTransaction(sig, 'confirmed');

        const { ensureJwt } = await import('@/components/prism/shared');
        const jwt = await ensureJwt();
        if (!jwt) {
          toast.error('Authentication failed');
          setBuyingIdx(null);
          return;
        }

        const res = await fetch(`${base}/api/prism/buy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ packageIndex: pkgIndex, txSignature: sig }),
        });

        if (res.ok) {
          toast.success(`Purchased ${pkg.coins} Coins!`);
          if (status)
            setStatus({
              ...status,
              purchasedToday: status.purchasedToday + pkg.coins,
              remainingToday: status.remainingToday - pkg.coins,
            });
          onPurchased();
        } else {
          const err = await res.json().catch(() => ({ error: 'Purchase failed' }));
          toast.error(err.error || 'Purchase failed');
        }
      } catch (e: any) {
        if (e?.message?.includes('User rejected')) {
          toast.info('Transaction cancelled');
        } else {
          toast.error(e?.message || 'Purchase failed');
        }
      }
      setBuyingIdx(null);
    },
    [walletAddress, wallet, buyingIdx, status, onPurchased],
  );

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-amber-400" />
          Buy Coins
        </h3>
        {status && (
          <span className="text-[10px] text-white/20">{status.remainingToday.toLocaleString()} remaining today</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {COIN_PACKAGES.map((pkg, i) => (
          <button
            key={i}
            onClick={() => handleBuy(i)}
            disabled={buyingIdx !== null || !walletAddress}
            className="relative overflow-hidden rounded-xl bg-white/[0.04] border border-white/[0.08] p-3 text-left hover:bg-white/[0.07] hover:border-amber-400/20 transition-all duration-300 disabled:opacity-50"
          >
            <div className="text-[10px] text-amber-400/60 font-bold uppercase mb-1">{pkg.label}</div>
            <div className="flex items-center gap-1 mb-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5" />
              </svg>
              <span className="text-lg font-black text-white">{pkg.coins.toLocaleString()}</span>
            </div>
            <div className="text-[11px] font-bold text-purple-400">{pkg.solPrice} SOL</div>
            {buyingIdx === i && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-xl">
                <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Prism Vault (Staking) ──

const YIELD_BRACKETS = [
  { upTo: 5000, baseDailyRate: 0.01 },
  { upTo: 20000, baseDailyRate: 0.007 },
  { upTo: 50000, baseDailyRate: 0.005 },
  { upTo: 100000, baseDailyRate: 0.0035 },
  { upTo: Infinity, baseDailyRate: 0.002 },
];

function calcClientDailyYield(amount: number, tierMultiplier: number): number {
  let remaining = amount;
  let daily = 0;
  let prevUpTo = 0;
  for (const b of YIELD_BRACKETS) {
    const sliceMax = b.upTo - prevUpTo;
    const slice = Math.min(remaining, sliceMax);
    if (slice <= 0) break;
    daily += slice * b.baseDailyRate * tierMultiplier;
    remaining -= slice;
    prevUpTo = b.upTo;
  }
  return daily;
}

function rateRangeLabel(mult: number): string {
  const high = (YIELD_BRACKETS[0].baseDailyRate * mult * 100).toFixed(1);
  const low = (YIELD_BRACKETS[YIELD_BRACKETS.length - 1].baseDailyRate * mult * 100).toFixed(1);
  return `${high}\u2013${low}%/day`;
}

const VAULT_TIERS = [
  {
    id: 'bronze',
    label: 'Bronze',
    min: 10000,
    lock: 7,
    rateMultiplier: 1.0,
    boost: 10,
    color: '#cd7f32',
    glow: 'rgba(205,127,50,0.25)',
    icon: '\u{1F949}',
  },
  {
    id: 'silver',
    label: 'Silver',
    min: 30000,
    lock: 30,
    rateMultiplier: 1.4,
    boost: 20,
    color: '#c0c0c0',
    glow: 'rgba(192,192,192,0.2)',
    icon: '\u{1F948}',
  },
  {
    id: 'gold',
    label: 'Gold',
    min: 75000,
    lock: 90,
    rateMultiplier: 2.0,
    boost: 35,
    color: '#fbbf24',
    glow: 'rgba(251,191,36,0.3)',
    icon: '\u{1F947}',
  },
] as const;

type VaultTierId = 'bronze' | 'silver' | 'gold';

interface VaultStatus {
  staked: boolean;
  tier?: VaultTierId;
  amount?: number;
  stakedAt?: number;
  lockDays?: number;
  unlocksAt?: number;
  unclaimedYield?: number;
  earlyUnstakePenalty?: number;
  dailyYield?: number;
  effectiveRate?: number;
}

function formatVaultTimeLeft(ms: number): string {
  if (ms <= 0) return 'Unlocked';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function PrismVaultSection({
  walletAddress,
  balance,
  onBalanceChange,
}: {
  walletAddress: string;
  balance: number;
  onBalanceChange: () => void;
}) {
  const wallet = useWallet();
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [selectedTier, setSelectedTier] = useState<VaultTierId>('bronze');
  const [stakeAmount, setStakeAmount] = useState('');
  const [staking, setStaking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [unstaking, setUnstaking] = useState(false);
  const [showUnstakeWarning, setShowUnstakeWarning] = useState(false);

  const tier = VAULT_TIERS.find((t) => t.id === selectedTier)!;

  useEffect(() => {
    if (!walletAddress) return;
    setLoadingStatus(true);
    const base = getApiBase();
    fetch(`${base}/api/prism/vault/status?address=${walletAddress}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.staking) {
          setVaultStatus({
            staked: true,
            tier: d.staking.tier,
            amount: d.staking.amount,
            unlocksAt: d.staking.lockEnd,
            unclaimedYield: d.unclaimedYield ?? 0,
            dailyYield: d.dailyYield ?? 0,
            effectiveRate: d.effectiveRate ?? 0,
          });
        } else {
          setVaultStatus({ staked: false });
        }
      })
      .catch(() => setVaultStatus({ staked: false }))
      .finally(() => setLoadingStatus(false));
  }, [walletAddress]);

  const getJwt = async () => {
    const { ensureJwt } = await import('@/components/prism/shared');
    return ensureJwt();
  };

  const handleStake = useCallback(async () => {
    const amount = Number(stakeAmount);
    if (!amount || amount < tier.min) {
      toast.error(`Minimum stake is ${tier.min} coins for ${tier.label}`);
      return;
    }
    if (amount > balance) {
      toast.error('Insufficient balance');
      return;
    }
    if (!walletAddress) {
      toast.error('Connect wallet first');
      return;
    }
    setStaking(true);
    try {
      const jwt = await getJwt();
      if (!jwt) {
        toast.error('Authentication failed');
        return;
      }
      const base = getApiBase();
      const res = await fetch(`${base}/api/prism/vault/stake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ amount, tier: selectedTier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stake failed');
      toast.success(`Staked ${amount} coins in ${tier.label} Vault!`);
      setVaultStatus(data.status || { staked: true, tier: selectedTier, amount });
      setStakeAmount('');
      onBalanceChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Stake failed');
    } finally {
      setStaking(false);
    }
  }, [stakeAmount, tier, balance, walletAddress, selectedTier, onBalanceChange, wallet]);

  const handleClaim = useCallback(async () => {
    if (!walletAddress) return;
    setClaiming(true);
    try {
      const jwt = await getJwt();
      if (!jwt) {
        toast.error('Authentication failed');
        return;
      }
      const base = getApiBase();
      const res = await fetch(`${base}/api/prism/vault/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Claim failed');
      toast.success(`Claimed ${data.claimed ?? ''} coins!`);
      setVaultStatus((v) => (v ? { ...v, unclaimedYield: 0 } : v));
      onBalanceChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Claim failed');
    } finally {
      setClaiming(false);
    }
  }, [walletAddress, onBalanceChange, wallet]);

  const handleUnstake = useCallback(async () => {
    if (!walletAddress) return;
    setUnstaking(true);
    setShowUnstakeWarning(false);
    try {
      const jwt = await getJwt();
      if (!jwt) {
        toast.error('Authentication failed');
        return;
      }
      const base = getApiBase();
      const res = await fetch(`${base}/api/prism/vault/unstake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unstake failed');
      toast.success(data.message || 'Unstaked successfully');
      setVaultStatus({ staked: false });
      onBalanceChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unstake failed');
    } finally {
      setUnstaking(false);
    }
  }, [walletAddress, onBalanceChange, wallet]);

  const stakedTierInfo = vaultStatus?.tier ? VAULT_TIERS.find((t) => t.id === vaultStatus.tier) : null;
  const isLocked = vaultStatus?.unlocksAt ? Date.now() < vaultStatus.unlocksAt : false;
  const timeLeft = vaultStatus?.unlocksAt ? vaultStatus.unlocksAt - Date.now() : 0;
  const stakeAmountNum = Number(stakeAmount);
  const canStake = stakeAmountNum >= tier.min && stakeAmountNum <= balance && !staking;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-amber-400" />
          Prism Vault
        </h3>
        <span className="text-[10px] text-white/20">Earn yield on your coins</span>
      </div>

      {loadingStatus ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-purple-400/40" />
        </div>
      ) : vaultStatus?.staked ? (
        <div
          className="rounded-2xl p-4 border"
          style={{
            background: `linear-gradient(135deg, ${stakedTierInfo?.color ?? '#fbbf24'}08, ${stakedTierInfo?.color ?? '#fbbf24'}03)`,
            borderColor: `${stakedTierInfo?.color ?? '#fbbf24'}25`,
            boxShadow: `0 0 30px ${stakedTierInfo?.glow ?? 'rgba(251,191,36,0.1)'}`,
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                style={{
                  background: `${stakedTierInfo?.color ?? '#fbbf24'}15`,
                  border: `1px solid ${stakedTierInfo?.color ?? '#fbbf24'}25`,
                }}
              >
                {stakedTierInfo?.icon ?? '\u{1F3C6}'}
              </div>
              <div>
                <p className="text-white font-bold text-sm">{stakedTierInfo?.label ?? vaultStatus.tier} Vault</p>
                <p className="text-white/30 text-[10px]">{vaultStatus.amount?.toLocaleString()} coins staked</p>
              </div>
            </div>
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl"
              style={{
                background: isLocked ? 'rgba(239,68,68,0.08)' : 'rgba(74,222,128,0.08)',
                border: `1px solid ${isLocked ? 'rgba(239,68,68,0.2)' : 'rgba(74,222,128,0.2)'}`,
              }}
            >
              <Clock className="w-3 h-3" style={{ color: isLocked ? '#f87171' : '#4ade80' }} />
              <span className="text-[10px] font-bold" style={{ color: isLocked ? '#f87171' : '#4ade80' }}>
                {isLocked ? formatVaultTimeLeft(timeLeft) : 'Unlocked'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <div
              className="rounded-xl p-2.5 text-center"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <TrendingUp className="w-3.5 h-3.5 mx-auto mb-1" style={{ color: stakedTierInfo?.color ?? '#fbbf24' }} />
              <p className="text-white font-black text-sm">{vaultStatus.dailyYield ?? 0}</p>
              <p className="text-white/25 text-[9px]">coins/day</p>
            </div>
            <div
              className="rounded-xl p-2.5 text-center"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <Coins className="w-3.5 h-3.5 mx-auto mb-1 text-amber-400" />
              <p className="text-white font-black text-sm">{Math.floor(vaultStatus.unclaimedYield ?? 0)}</p>
              <p className="text-white/25 text-[9px]">unclaimed</p>
            </div>
            <div
              className="rounded-xl p-2.5 text-center"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <Zap className="w-3.5 h-3.5 mx-auto mb-1 text-purple-400" />
              <p className="text-white font-black text-sm">+{stakedTierInfo?.boost ?? 0}%</p>
              <p className="text-white/25 text-[9px]">boost</p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1 h-10 text-xs font-bold"
              style={{
                background: `linear-gradient(135deg, ${stakedTierInfo?.color ?? '#fbbf24'}, ${stakedTierInfo?.color ?? '#fbbf24'}cc)`,
                color: '#000',
                boxShadow: `0 4px 15px ${stakedTierInfo?.glow ?? 'rgba(251,191,36,0.3)'}`,
              }}
              onClick={handleClaim}
              disabled={claiming || (vaultStatus.unclaimedYield ?? 0) < 1}
            >
              {claiming ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Coins className="w-3 h-3 mr-1" />}
              Claim Yield
            </Button>
            <Button
              variant="outline"
              className="h-10 px-4 text-xs font-bold border-red-500/20 text-red-400/70 hover:bg-red-500/10"
              onClick={() => {
                if (isLocked) setShowUnstakeWarning(true);
                else handleUnstake();
              }}
              disabled={unstaking}
            >
              {unstaking ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Unstake'}
            </Button>
          </div>

          {showUnstakeWarning && (
            <div
              className="mt-3 p-3 rounded-xl flex flex-col gap-2"
              style={{
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.2)',
              }}
            >
              <div className="flex items-center gap-2 text-red-400 text-xs font-bold">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                25% penalty will be burned on early unstake
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-[10px] border-white/10 text-white/40"
                  onClick={() => setShowUnstakeWarning(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="flex-1 h-8 text-[10px] bg-red-600 hover:bg-red-500 text-white"
                  onClick={handleUnstake}
                  disabled={unstaking}
                >
                  {unstaking ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm Unstake'}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {VAULT_TIERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTier(t.id)}
                className="rounded-xl p-3 text-left transition-all duration-300 hover:scale-[1.02]"
                style={{
                  background:
                    selectedTier === t.id
                      ? `linear-gradient(135deg, ${t.color}18, ${t.color}08)`
                      : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${selectedTier === t.id ? t.color + '35' : 'rgba(255,255,255,0.06)'}`,
                  boxShadow: selectedTier === t.id ? `0 0 20px ${t.glow}` : 'none',
                }}
              >
                <div className="text-xl mb-1.5">{t.icon}</div>
                <p
                  className="text-white font-bold text-xs mb-1"
                  style={{ color: selectedTier === t.id ? t.color : 'rgba(255,255,255,0.7)' }}
                >
                  {t.label}
                </p>
                <div className="space-y-0.5">
                  <p
                    className="text-[9px]"
                    style={{ color: selectedTier === t.id ? t.color + 'cc' : 'rgba(255,255,255,0.25)' }}
                  >
                    Min: {t.min.toLocaleString()}
                  </p>
                  <p
                    className="text-[9px]"
                    style={{ color: selectedTier === t.id ? t.color + 'cc' : 'rgba(255,255,255,0.25)' }}
                  >
                    {t.lock}d lock
                  </p>
                  <p
                    className="text-[9px] font-bold"
                    style={{ color: selectedTier === t.id ? t.color : 'rgba(255,255,255,0.3)' }}
                  >
                    {rateRangeLabel(t.rateMultiplier)}
                  </p>
                  <p
                    className="text-[9px]"
                    style={{ color: selectedTier === t.id ? '#c084fc' : 'rgba(192,132,252,0.4)' }}
                  >
                    +{t.boost}% boost
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="relative mb-3">
            <input
              type="number"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              placeholder={`Stake amount (min ${tier.min.toLocaleString()})`}
              min={tier.min}
              max={balance}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40 pr-20"
              style={{ fontSize: 16 }}
            />
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold px-3 py-1.5 rounded-xl transition-colors"
              style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
              onClick={() => setStakeAmount(String(balance))}
            >
              MAX
            </button>
          </div>

          {stakeAmountNum >= tier.min && (
            <div
              className="mb-3 px-3 py-2 rounded-xl flex items-center justify-between"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <span className="text-[10px] text-white/30">Est. daily yield</span>
              <span className="text-[10px] font-bold" style={{ color: tier.color }}>
                +{calcClientDailyYield(stakeAmountNum, tier.rateMultiplier).toFixed(1)} coins/day
              </span>
            </div>
          )}

          <Button
            className="w-full h-12 font-bold text-sm"
            style={
              canStake
                ? {
                    background: `linear-gradient(135deg, ${tier.color}, ${tier.color}cc)`,
                    color: '#000',
                    boxShadow: `0 4px 20px ${tier.glow}`,
                  }
                : {
                    background: 'rgba(255,255,255,0.05)',
                    color: 'rgba(255,255,255,0.25)',
                  }
            }
            onClick={handleStake}
            disabled={!canStake || staking}
          >
            {staking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Staking...
              </>
            ) : (
              <>
                <Shield className="w-4 h-4 mr-2" /> Stake{' '}
                {stakeAmountNum >= tier.min ? stakeAmountNum.toLocaleString() : ''} coins
              </>
            )}
          </Button>
          {stakeAmountNum > 0 && stakeAmountNum < tier.min && (
            <p className="text-red-400/60 text-[10px] mt-2 text-center">
              Minimum for {tier.label} is {tier.min.toLocaleString()} coins
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──

export default function PrismVault() {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() || '';
  const [balance, setBalance] = useState<PrismBalance | null>(null);

  useEffect(() => {
    fadeOutTransition();
  }, []);

  const fetchBalanceDirect = useCallback(() => {
    if (!walletAddress) return;
    const base = getApiBase();
    if (!base) return;
    fetch(`${base}/api/prism/balance?address=${encodeURIComponent(walletAddress)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setBalance(d);
      })
      .catch(() => {});
  }, [walletAddress]);

  useEffect(() => {
    fetchBalanceDirect();
  }, [fetchBalanceDirect]);

  const refreshBalance = fetchBalanceDirect;

  return (
    <PageShell className="text-white">
      <header className="flex-none sticky top-0 z-20 bg-[#050510]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => {
              startFadeTransition(() => goBack(navigate));
            }}
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.08] transition-all border border-white/[0.06]"
          >
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </button>
          <img src="/hub/vault.png" alt="" className="w-6 h-6 object-contain" />
          <div className="flex flex-col">
            <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-300 leading-tight">
              Prism Vault
            </h1>
            <span className="text-[10px] text-white/30 leading-none">Buy coins & earn staking yield</span>
          </div>
          <div className="flex-1" />
          {balance && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-white/70">{balance.balance.toLocaleString()}</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto max-w-2xl mx-auto w-full px-4 py-6 pb-24">
        {!walletAddress ? (
          <div className="text-center py-20 text-white/20">
            <Shield className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">Connect your wallet to access the Vault</p>
          </div>
        ) : (
          <>
            <BuyCoinsSection walletAddress={walletAddress} onPurchased={refreshBalance} />
            <PrismVaultSection
              walletAddress={walletAddress}
              balance={balance?.balance ?? 0}
              onBalanceChange={refreshBalance}
            />
          </>
        )}
      </main>
    </PageShell>
  );
}
