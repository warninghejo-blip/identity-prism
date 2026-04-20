/**
 * Prism Vault — Buy Coins + Staking.
 * Dedicated financial hub page.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { goBack } from '@/lib/safeNavigate';
import { fadeOutTransition, startFadeTransition } from '@/lib/fadeTransition';
import { ArrowLeft, Coins, Loader2, AlertTriangle, Plus, Shield, Clock, TrendingUp, Zap, Check } from 'lucide-react';
import PageShell from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getPrismBalance, COIN_PACKAGES, type PrismBalance } from '@/lib/prismCoin';
import { getApiBase } from '@/components/prism/shared';

// ── Buy Coins Section ──

function BuyCoinsSection({ walletAddress, onPurchased }: { walletAddress: string; onPurchased: () => void }) {
  const wallet = useWallet();
  const [buyingIdx, setBuyingIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [status, setStatus] = useState<{ purchasedToday: number; remainingToday: number } | null>(null);
  const [payWith, setPayWith] = useState<'sol' | 'skr'>('sol');
  const [skrQuotes, setSkrQuotes] = useState<{ coins: number; skrPrice: number }[] | null>(null);

  useEffect(() => {
    if (!walletAddress) return;
    const base = getApiBase();
    fetch(`${base}/api/prism/buy/status?address=${encodeURIComponent(walletAddress)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStatus(d);
      })
      .catch(() => {});
    fetch(`${base}/api/prism/buy/skr-quote`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.quotes) setSkrQuotes(d.quotes);
      })
      .catch(() => {});
  }, [walletAddress]);

  const handleBuy = useCallback(async () => {
    if (selectedIdx === null || buyingIdx !== null || !walletAddress || !wallet.publicKey || !wallet.signTransaction)
      return;
    const pkg = COIN_PACKAGES[selectedIdx];
    setBuyingIdx(selectedIdx);

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out — server may be unavailable')), 30_000),
    );

    try {
      await Promise.race([
        timeout,
        (async () => {
          const { ensureJwt } = await import('@/components/prism/shared');
          const jwt = await ensureJwt();
          if (!jwt) {
            toast.error('Authentication required');
            setBuyingIdx(null);
            return;
          }

          const {
            Connection: SolConn,
            PublicKey: SolPK,
            SystemProgram: SolSP,
            Transaction: SolTx,
          } = await import('@solana/web3.js');
          const base = getApiBase();
          const conn = new SolConn(base.replace(/\/api(\/.*)?$/, '') + '/rpc', 'confirmed');
          const treasuryAddr = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';

          let sig: string;

          if (payWith === 'skr') {
            const skrQuote = skrQuotes?.[selectedIdx];
            if (!skrQuote) {
              toast.error('SKR price unavailable');
              setBuyingIdx(null);
              return;
            }
            const {
              getAssociatedTokenAddress,
              createTransferCheckedInstruction,
              createAssociatedTokenAccountInstruction,
              TOKEN_PROGRAM_ID,
            } = await import('@solana/spl-token');
            const skrMint = new SolPK('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3');
            const ownerKey = new SolPK(walletAddress);
            const treasuryKey = new SolPK(treasuryAddr);
            const mintInfo = await conn.getParsedAccountInfo(skrMint);
            const decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals ?? 6;
            const amountBaseUnits = BigInt(skrQuote.skrPrice) * 10n ** BigInt(decimals);
            const ownerAta = await getAssociatedTokenAddress(skrMint, ownerKey, false, TOKEN_PROGRAM_ID);
            const treasuryAta = await getAssociatedTokenAddress(skrMint, treasuryKey, false, TOKEN_PROGRAM_ID);
            const tx = new SolTx();
            const treasuryAtaInfo = await conn.getAccountInfo(treasuryAta);
            if (!treasuryAtaInfo) {
              tx.add(
                createAssociatedTokenAccountInstruction(ownerKey, treasuryAta, treasuryKey, skrMint, TOKEN_PROGRAM_ID),
              );
            }
            tx.add(
              createTransferCheckedInstruction(
                ownerAta,
                skrMint,
                treasuryAta,
                ownerKey,
                amountBaseUnits,
                decimals,
                [],
                TOKEN_PROGRAM_ID,
              ),
            );
            tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
            tx.feePayer = ownerKey;
            const origSerializeSKR = tx.serialize.bind(tx);
            tx.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
              origSerializeSKR({ ...config, requireAllSignatures: false })) as typeof tx.serialize;
            const signed = await wallet.signTransaction(tx);
            sig = await conn.sendRawTransaction(
              signed.serialize({ requireAllSignatures: false, verifySignatures: false }),
            );
            toast.info('Confirming SKR transaction...');
            await conn.confirmTransaction(sig, 'confirmed');

            const res = await fetch(`${base}/api/prism/buy/skr`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
              body: JSON.stringify({ packageIndex: selectedIdx, txSignature: sig }),
            });
            if (res.ok) {
              toast.success(`Purchased ${pkg.coins} Coins for ${skrQuote.skrPrice} SKR!`);
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
          } else {
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
            } as any);
            if (simulation.value.err)
              throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
            tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
            const origSerializeSOL = tx.serialize.bind(tx);
            tx.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
              origSerializeSOL({ ...config, requireAllSignatures: false })) as typeof tx.serialize;
            const signed = await wallet.signTransaction(tx);
            sig = await conn.sendRawTransaction(
              signed.serialize({ requireAllSignatures: false, verifySignatures: false }),
            );
            toast.info('Confirming transaction...');
            await conn.confirmTransaction(sig, 'confirmed');

            const res = await fetch(`${base}/api/prism/buy`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
              body: JSON.stringify({ packageIndex: selectedIdx, txSignature: sig }),
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
          }
          setSelectedIdx(null);
        })(),
      ]);
    } catch (e: any) {
      if (e?.message?.includes('User rejected')) {
        toast.info('Transaction cancelled');
      } else {
        toast.error(e?.message || 'Purchase failed');
      }
    } finally {
      setBuyingIdx(null);
    }
  }, [walletAddress, wallet, buyingIdx, selectedIdx, status, onPurchased, payWith, skrQuotes]);

  const selectedPkg = selectedIdx !== null ? COIN_PACKAGES[selectedIdx] : null;
  const selectedSkr = selectedIdx !== null ? skrQuotes?.[selectedIdx]?.skrPrice : null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-amber-400" />
          Buy Coins
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white/[0.03] border border-white/10 rounded-full p-1">
            <button
              onClick={() => setPayWith('sol')}
              aria-label="Pay with SOL"
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition-all ${
                payWith === 'sol'
                  ? 'bg-gradient-to-r from-purple-600 to-cyan-500 text-white shadow-lg shadow-purple-500/20'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${payWith === 'sol' ? 'bg-white/60' : 'bg-purple-500/50'}`}
              />
              SOL
            </button>
            <button
              onClick={() => setPayWith('skr')}
              aria-label="Pay with SKR"
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition-all ${
                payWith === 'skr'
                  ? 'bg-gradient-to-r from-amber-600 to-yellow-500 text-white shadow-lg shadow-amber-500/20'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${payWith === 'skr' ? 'bg-white/60' : 'bg-amber-500/50'}`}
              />
              SKR
            </button>
          </div>
          {status && (
            <span className="text-[10px] text-white/20">{status.remainingToday.toLocaleString()} left today</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {COIN_PACKAGES.map((pkg, i) => {
          const skrPrice = skrQuotes?.[i]?.skrPrice;
          const isSelected = selectedIdx === i;
          return (
            <button
              key={i}
              onClick={() => setSelectedIdx(isSelected ? null : i)}
              disabled={buyingIdx !== null}
              className={`relative overflow-hidden rounded-xl p-3 text-left transition-all duration-200 ${
                isSelected
                  ? 'bg-amber-400/[0.08] border-amber-400/30 ring-1 ring-amber-400/20'
                  : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.07]'
              } border disabled:opacity-50`}
            >
              {isSelected && (
                <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-amber-400/20 flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-amber-400" />
                </div>
              )}
              <div className="text-[10px] text-amber-400/60 font-bold uppercase mb-1">{pkg.label}</div>
              <div className="flex items-center gap-1 mb-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v12M8 10h8M8 14h8" stroke="#000" strokeWidth="1.5" />
                </svg>
                <span className="text-lg font-black text-white">{pkg.coins.toLocaleString()}</span>
              </div>
              {payWith === 'sol' ? (
                <div className="text-[11px] font-bold text-purple-400">{pkg.solPrice} SOL</div>
              ) : (
                <div className="text-[11px] font-bold text-cyan-400">
                  {skrPrice ? `${skrPrice.toLocaleString()} SKR` : '...'}
                </div>
              )}
              {buyingIdx === i && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-xl">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Buy confirmation button */}
      {selectedPkg && (
        <Button
          className="w-full h-11 font-bold text-sm"
          style={{
            background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
            color: '#000',
            boxShadow: '0 4px 20px rgba(251,191,36,0.25)',
          }}
          onClick={handleBuy}
          disabled={buyingIdx !== null || (payWith === 'skr' && !selectedSkr)}
        >
          {buyingIdx !== null ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Processing...
            </>
          ) : (
            <>
              Buy {selectedPkg.coins.toLocaleString()} Coins for{' '}
              {payWith === 'sol'
                ? `${selectedPkg.solPrice} SOL`
                : selectedSkr
                  ? `${selectedSkr.toLocaleString()} SKR`
                  : '...'}
            </>
          )}
        </Button>
      )}
    </div>
  );
}

// ── Vault Staking Section ──

type VaultTierId = 'bronze' | 'silver' | 'gold';
interface VaultStatus {
  staked: boolean;
  tier?: string;
  amount?: number;
  unlocksAt?: number;
  unclaimedYield?: number;
  dailyYield?: number;
  effectiveRate?: number;
  lockDays?: number;
  yieldMultiplier?: number;
  earlyPenalty?: number;
}

const LOCK_OPTIONS = [
  { days: 7, label: '1 Week', mult: '1x', penalty: '10%' },
  { days: 30, label: '1 Month', mult: '1.5x', penalty: '15%' },
  { days: 90, label: '3 Months', mult: '2.5x', penalty: '20%' },
  { days: 180, label: '6 Months', mult: '4x', penalty: '25%' },
];

const YIELD_BRACKETS = [
  { upTo: 5000, baseDailyRate: 0.005 },
  { upTo: 20000, baseDailyRate: 0.0035 },
  { upTo: 50000, baseDailyRate: 0.002 },
  { upTo: 100000, baseDailyRate: 0.0012 },
  { upTo: Infinity, baseDailyRate: 0.0008 },
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
  return `${high}–${low}%/day`;
}

const VAULT_TIERS = [
  {
    id: 'bronze' as const,
    label: 'Bronze',
    min: 10000,
    lock: 7,
    rateMultiplier: 0.75,
    boost: 5,
    color: '#cd7f32',
    glow: 'rgba(205,127,50,0.25)',
    icon: '🥉',
  },
  {
    id: 'silver' as const,
    label: 'Silver',
    min: 30000,
    lock: 30,
    rateMultiplier: 1.0,
    boost: 10,
    color: '#c0c0c0',
    glow: 'rgba(192,192,192,0.2)',
    icon: '🥈',
  },
  {
    id: 'gold' as const,
    label: 'Gold',
    min: 75000,
    lock: 90,
    rateMultiplier: 1.25,
    boost: 15,
    color: '#ffd700',
    glow: 'rgba(255,215,0,0.25)',
    icon: '🥇',
  },
];

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'Unlocked';
  const days = Math.floor(ms / 86400000);
  if (days > 0) return `${days}d left`;
  const hrs = Math.floor(ms / 3600000);
  if (hrs > 0) return `${hrs}h left`;
  const mins = Math.floor(ms / 60000);
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
  const [lockDays, setLockDays] = useState(7);
  const [stakeAmount, setStakeAmount] = useState('');
  const [staking, setStaking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [unstaking, setUnstaking] = useState(false);
  const [showUnstakeWarning, setShowUnstakeWarning] = useState(false);
  const [showStakeConfirm, setShowStakeConfirm] = useState(false);

  const tier = VAULT_TIERS.find((t) => t.id === selectedTier)!;

  useEffect(() => {
    if (!walletAddress) return;
    setLoadingStatus(true);
    const base = getApiBase();
    fetch(`${base}/api/prism/vault/status?address=${encodeURIComponent(walletAddress)}`)
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
            lockDays: d.staking.lockDays ?? 7,
            yieldMultiplier: d.staking.yieldMultiplier ?? 1.0,
            earlyPenalty: d.staking.earlyPenalty ?? 0.25,
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
      toast.error(`Minimum stake is ${tier.min.toLocaleString()} coins for ${tier.label}`);
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
        body: JSON.stringify({ amount, tier: selectedTier, lockDays }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stake failed');
      toast.success(`Staked ${amount.toLocaleString()} coins in ${tier.label} Vault!`);
      setVaultStatus(data.status || { staked: true, tier: selectedTier, amount });
      setStakeAmount('');
      onBalanceChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Stake failed');
    } finally {
      setStaking(false);
    }
  }, [stakeAmount, tier, balance, walletAddress, selectedTier, lockDays, onBalanceChange, wallet]);

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
      toast.success(
        data.penalty > 0
          ? `Unstaked: received ${data.returned?.toLocaleString()} coins (${data.penalty?.toLocaleString()} burned as penalty)`
          : data.message || 'Unstaked successfully',
      );
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
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-amber-400" />
          Prism Vault — Staking
        </h3>
        <span className="text-[10px] text-white/20">Earn yield on your coins</span>
      </div>

      {loadingStatus ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-purple-400/40" />
        </div>
      ) : vaultStatus?.staked ? (
        /* ── Active Stake ── */
        <div
          className="rounded-2xl p-5 border"
          style={{
            background: `linear-gradient(135deg, ${stakedTierInfo?.color ?? '#fbbf24'}08, ${stakedTierInfo?.color ?? '#fbbf24'}03)`,
            borderColor: `${stakedTierInfo?.color ?? '#fbbf24'}25`,
            boxShadow: `0 0 30px ${stakedTierInfo?.glow ?? 'rgba(251,191,36,0.1)'}`,
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl"
                style={{
                  background: `${stakedTierInfo?.color ?? '#fbbf24'}15`,
                  border: `1px solid ${stakedTierInfo?.color ?? '#fbbf24'}25`,
                }}
              >
                {stakedTierInfo?.icon ?? '🏆'}
              </div>
              <div>
                <p className="text-white font-bold text-sm">{stakedTierInfo?.label ?? vaultStatus.tier} Vault</p>
                <p className="text-white/30 text-[10px]">
                  {vaultStatus.amount?.toLocaleString()} coins ·{' '}
                  {LOCK_OPTIONS.find((o) => o.days === vaultStatus.lockDays)?.label ?? `${vaultStatus.lockDays ?? 7}d`}{' '}
                  lock · {LOCK_OPTIONS.find((o) => o.days === vaultStatus.lockDays)?.mult ?? '1x'} yield
                </p>
                {vaultStatus.unlocksAt && (
                  <p className="text-white/20 text-[9px]">
                    Unlocks{' '}
                    {new Date(vaultStatus.unlocksAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                )}
              </div>
            </div>
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
              style={{
                background: isLocked ? 'rgba(239,68,68,0.08)' : 'rgba(74,222,128,0.08)',
                border: `1px solid ${isLocked ? 'rgba(239,68,68,0.2)' : 'rgba(74,222,128,0.2)'}`,
              }}
            >
              <Clock className="w-3 h-3" style={{ color: isLocked ? '#f87171' : '#4ade80' }} />
              <span className="text-[10px] font-bold" style={{ color: isLocked ? '#f87171' : '#4ade80' }}>
                {isLocked ? formatTimeLeft(timeLeft) : 'Unlocked'}
              </span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              {
                icon: <TrendingUp className="w-4 h-4" style={{ color: stakedTierInfo?.color ?? '#fbbf24' }} />,
                value: String(vaultStatus.dailyYield ?? 0),
                label: 'coins/day',
              },
              {
                icon: <Coins className="w-4 h-4 text-amber-400" />,
                value: String(Math.floor(vaultStatus.unclaimedYield ?? 0)),
                label: 'unclaimed',
              },
              {
                icon: <Zap className="w-4 h-4 text-purple-400" />,
                value: `+${stakedTierInfo?.boost ?? 0}%`,
                label: 'boost',
              },
            ].map((s, i) => (
              <div key={i} className="rounded-xl p-3 text-center bg-white/[0.03] border border-white/[0.05]">
                <div className="flex justify-center mb-1.5">{s.icon}</div>
                <p className="text-white font-black text-base">{s.value}</p>
                <p className="text-white/25 text-[9px] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              className="flex-1 h-11 text-xs font-bold"
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
              className="h-11 px-5 text-xs font-bold border-red-500/20 text-red-400/70 hover:bg-red-500/10"
              onClick={() => setShowUnstakeWarning(true)}
              disabled={unstaking}
            >
              {unstaking ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Unstake'}
            </Button>
          </div>

          {showUnstakeWarning && (
            <div className="mt-3 p-3 rounded-xl bg-red-500/[0.06] border border-red-500/20">
              {isLocked ? (
                <div className="flex items-center gap-2 text-red-400 text-sm font-bold mb-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>
                    ⚠️ {Math.round((vaultStatus?.earlyPenalty ?? 0.25) * 100)}% early unstake penalty —{' '}
                    {vaultStatus?.amount
                      ? `${Math.floor(vaultStatus.amount * (vaultStatus?.earlyPenalty ?? 0.25)).toLocaleString()} coins will be burned`
                      : 'coins will be burned'}
                  </span>
                </div>
              ) : (
                <div className="text-white/50 text-xs mb-2">Are you sure you want to unstake all coins?</div>
              )}
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
        /* ── Stake UI ── */
        <div>
          {/* Tier selection */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {VAULT_TIERS.map((t) => {
              const active = selectedTier === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedTier(t.id)}
                  className="rounded-xl p-3.5 text-center transition-all duration-300"
                  style={{
                    background: active
                      ? `linear-gradient(135deg, ${t.color}15, ${t.color}08)`
                      : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${active ? t.color + '40' : 'rgba(255,255,255,0.06)'}`,
                    boxShadow: active ? `0 0 20px ${t.glow}` : 'none',
                  }}
                >
                  <div className="text-2xl mb-2">{t.icon}</div>
                  <p className="font-bold text-xs mb-2" style={{ color: active ? t.color : 'rgba(255,255,255,0.6)' }}>
                    {t.label}
                  </p>
                  <div className="space-y-1 text-[9px]">
                    <p style={{ color: active ? t.color + 'bb' : 'rgba(255,255,255,0.25)' }}>
                      Min {t.min.toLocaleString()}
                    </p>
                    <p style={{ color: active ? t.color + 'bb' : 'rgba(255,255,255,0.25)' }}>{t.lock}d lock</p>
                    <p className="font-bold" style={{ color: active ? t.color : 'rgba(255,255,255,0.3)' }}>
                      {rateRangeLabel(t.rateMultiplier)}
                    </p>
                    <p style={{ color: active ? '#c084fc' : 'rgba(192,132,252,0.3)' }}>+{t.boost}% game boost</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Lock duration selector */}
          <div className="mb-4">
            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Lock Duration</p>
            <div className="grid grid-cols-4 gap-2">
              {LOCK_OPTIONS.map((opt) => {
                const active = lockDays === opt.days;
                return (
                  <button
                    key={opt.days}
                    onClick={() => setLockDays(opt.days)}
                    className="rounded-xl p-2.5 text-center transition-all duration-200"
                    style={{
                      background: active
                        ? 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(168,85,247,0.08))'
                        : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${active ? 'rgba(168,85,247,0.45)' : 'rgba(255,255,255,0.06)'}`,
                      boxShadow: active ? '0 0 14px rgba(168,85,247,0.2)' : 'none',
                    }}
                  >
                    <p
                      className="text-[10px] font-bold mb-1"
                      style={{ color: active ? '#c084fc' : 'rgba(255,255,255,0.5)' }}
                    >
                      {opt.label}
                    </p>
                    <p
                      className="text-[9px] font-black"
                      style={{ color: active ? '#e879f9' : 'rgba(255,255,255,0.25)' }}
                    >
                      {opt.mult} yield
                    </p>
                    <p
                      className="text-[8px] mt-0.5"
                      style={{ color: active ? 'rgba(248,113,113,0.8)' : 'rgba(255,255,255,0.18)' }}
                    >
                      {opt.penalty} penalty
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amount input */}
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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold px-3 py-1.5 rounded-xl"
              style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
              onClick={() => setStakeAmount(String(balance))}
            >
              MAX
            </button>
          </div>

          {/* Projected yield */}
          {stakeAmountNum >= tier.min && (
            <div className="mb-4 px-4 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-between">
              <span className="text-[10px] text-white/30">Est. daily yield</span>
              <span className="text-[10px] font-bold" style={{ color: tier.color }}>
                +{calcClientDailyYield(stakeAmountNum, tier.rateMultiplier).toFixed(1)} coins/day
              </span>
            </div>
          )}

          {/* Stake button */}
          <Button
            className="w-full h-12 font-bold text-sm"
            style={
              canStake
                ? {
                    background: `linear-gradient(135deg, ${tier.color}, ${tier.color}cc)`,
                    color: '#000',
                    boxShadow: `0 4px 20px ${tier.glow}`,
                  }
                : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.25)' }
            }
            onClick={() => {
              const amount = Number(stakeAmount);
              if (!amount || amount < tier.min) {
                toast.error(`Minimum stake is ${tier.min.toLocaleString()} coins for ${tier.label}`);
                return;
              }
              if (amount > balance) {
                toast.error('Insufficient balance');
                return;
              }
              setShowStakeConfirm(true);
            }}
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
          {showStakeConfirm && (
            <div className="mt-3 p-3 rounded-xl bg-purple-500/[0.06] border border-purple-500/20">
              <div className="text-white/70 text-xs mb-1">
                Stake <span className="font-bold text-white">{Number(stakeAmount).toLocaleString()}</span> coins in{' '}
                {tier.label} tier?
              </div>
              <div className="text-[10px] text-purple-300/70 mb-1">
                Lock duration:{' '}
                <span className="font-bold">
                  {LOCK_OPTIONS.find((o) => o.days === lockDays)?.label ?? `${lockDays}d`}
                </span>
                {' · '}Yield:{' '}
                <span className="font-bold">{LOCK_OPTIONS.find((o) => o.days === lockDays)?.mult ?? '1x'}</span>
              </div>
              <div className="text-[10px] text-amber-400/60 mb-2">
                Early unstake penalty:{' '}
                <span className="font-bold">{LOCK_OPTIONS.find((o) => o.days === lockDays)?.penalty ?? '25%'}</span>{' '}
                burned
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-[10px] border-white/10 text-white/40"
                  onClick={() => setShowStakeConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="flex-1 h-8 text-[10px] bg-purple-600 hover:bg-purple-500 text-white"
                  onClick={() => {
                    setShowStakeConfirm(false);
                    handleStake();
                  }}
                  disabled={staking}
                >
                  {staking ? 'Staking...' : 'Confirm Stake'}
                </Button>
              </div>
            </div>
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

  return (
    <PageShell className="text-white">
      <header className="flex-none sticky top-0 z-20 bg-[#050510]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => startFadeTransition(() => goBack(navigate))}
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.08] transition-all border border-white/[0.06]"
            aria-label="Go back"
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
            <BuyCoinsSection walletAddress={walletAddress} onPurchased={fetchBalanceDirect} />
            <PrismVaultSection
              walletAddress={walletAddress}
              balance={balance?.balance ?? 0}
              onBalanceChange={fetchBalanceDirect}
            />
          </>
        )}
      </main>
    </PageShell>
  );
}
