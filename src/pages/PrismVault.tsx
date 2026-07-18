/**
 * Prism Vault — Buy Coins + Staking.
 * Dedicated financial hub page.
 */

import { useState, useEffect, useCallback, type PointerEvent, type TouchEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { SolanaMobileWalletAdapterWalletName } from '@solana-mobile/wallet-adapter-mobile';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { fadeOutTransition, startFadeTransition } from '@/lib/fadeTransition';
import { Loader2, AlertTriangle, Plus, Shield, Clock, TrendingUp, Zap, Check } from 'lucide-react';
import PageShell from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import HubReturnButton from '@/components/HubReturnButton';
import { getPrismBalance, COIN_PACKAGES, type PrismBalance } from '@/lib/prismCoin';
import { getApiBase, getCachedJwt, obtainJwt, setAuthWallet } from '@/components/prism/shared';
import { useActiveWalletAddress } from '@/lib/useActiveWalletAddress';
import { SEEDVAULT_NAME } from '@/lib/SeedVaultAdapter';
import { isDemoMode } from '@/lib/demoMode';

// ── Buy Coins Section ──

const RPC_STEP_TIMEOUT_MS = 30_000;
const NATIVE_SEND_RAW_TIMEOUT_MS = 90_000;
const CONFIRM_TIMEOUT_MS = 120_000;
const PUBLIC_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const NATIVE_PRE_SIGN_SIMULATION_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof window.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

const vaultWithTimeout = <T,>(label: string, promise: Promise<T>, ms = RPC_STEP_TIMEOUT_MS): Promise<T> => {
  let timeoutId: ReturnType<typeof window.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`[vault] STEP_TIMEOUT ${label} after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
};

// FIX (2026-05-17): Removed AbortController-based fetch wrapper.
// Capacitor backgrounds the WebView when MWA opens → setTimeout fires late on resume,
// aborting the in-flight blockhash fetch with "signal is aborted without reason".
// Use default fetch — web3.js has its own retry. Outer 120s Promise.race covers stalls.
function createRpcFetch(_timeoutMs = RPC_STEP_TIMEOUT_MS): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch;
}

/**
 * Long-running tx confirmation using getSignatureStatuses polling.
 * web3.js conn.confirmTransaction has 30s default that fires before slow mainnet finalization.
 * We poll up to `timeoutMs` (default CONFIRM_TIMEOUT_MS) every 2s. On timeout we throw
 * a non-fatal error so caller can still attempt backend credit (backend re-verifies on-chain).
 */
async function waitForConfirmation(
  conn: { getSignatureStatuses: (sigs: string[]) => Promise<{ value: ({ confirmationStatus?: string; err?: unknown } | null)[] }> },
  sig: string,
  timeoutMs = CONFIRM_TIMEOUT_MS,
): Promise<'confirmed' | 'finalized' | 'timeout'> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await conn.getSignatureStatuses([sig]);
      const status = res?.value?.[0];
      if (status?.err) throw new Error('Transaction failed on-chain');
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        return status.confirmationStatus;
      }
    } catch (e) {
      lastError = e;
      // soft-fail: keep polling; network blip shouldn't kill flow
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  if (lastError instanceof Error && lastError.message === 'Transaction failed on-chain') throw lastError;
  return 'timeout';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function bytesToBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += alphabet[0];
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    result += alphabet[digits[i]];
  }
  return result;
}

function signedTransactionSignature(tx: { signature?: Uint8Array | null }): string | null {
  return tx.signature ? bytesToBase58(new Uint8Array(tx.signature)) : null;
}

function isNativeRpcTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /timeout|timed out|SocketTimeout/i.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function rpcUrlFromApiBase(base: string): string {
  return `${base.replace(/\/api(\/.*)?$/, '')}/rpc`;
}

async function nativeRpcRequest<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs = RPC_STEP_TIMEOUT_MS,
): Promise<T> {
  // Pass body as raw JSON string — CapacitorHttp double-serializes object `data`
  // and Helius/CF can silently drop the request (especially for sendTransaction,
  // where the signature is returned from a stale slot/relay node without an
  // actual broadcast). Forcing string body matches the curl-tested wire format.
  const bodyStr = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
  const response = await CapacitorHttp.post({
    url: rpcUrl,
    headers: { 'Content-Type': 'application/json' },
    data: bodyStr,
    responseType: 'json',
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`RPC ${method} failed (${response.status})`);
  }
  const payload = typeof response.data === 'string' ? JSON.parse(response.data || 'null') : response.data;
  if (payload?.error) {
    throw new Error(payload.error.message || `RPC ${method} error`);
  }
  return payload?.result as T;
}

async function nativeSendRawTransaction(
  rpcUrl: string,
  rawTransaction: Uint8Array,
  options: { skipPreflight: boolean; preflightCommitment: 'confirmed' },
): Promise<string> {
  const params = [
    bytesToBase64(rawTransaction),
    { encoding: 'base64', ...options },
  ];
  // sendTransaction MUST hit a paid RPC. api.mainnet-beta.solana.com silently
  // accepts and drops without broadcasting (returns a valid-looking signature
  // but the tx never lands on chain). Stick to the configured Helius proxy and
  // fail loudly if it's unavailable so the user sees a clear error.
  if (!rpcUrl) throw new Error('RPC URL not configured for sendTransaction');
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await nativeRpcRequest<string>(rpcUrl, 'sendTransaction', params, attempt === 0 ? 45_000 : 30_000);
    } catch (error) {
      lastError = error;
      if (!isNativeRpcTimeout(error)) throw error;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('sendTransaction timed out');
}

async function simulateVaultBeforeSign(
  conn: { simulateTransaction: (...args: any[]) => Promise<{ value: { err: unknown; logs?: string[] | null } }> },
  tx: any,
  label: string,
  isNativePlatform: boolean,
): Promise<void> {
  try {
    // dApp Store compliance: simulate every Vault purchase before Seed Vault
    // signing. On native, bound RPC to avoid the historical WebView hang.
    const sim = await vaultWithTimeout(
      `simulateTransaction(${label})`,
      conn.simulateTransaction(tx, undefined, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      }),
      isNativePlatform ? NATIVE_PRE_SIGN_SIMULATION_TIMEOUT_MS : 12_000,
    );
    if (sim.value.err) {
      console.error(`[vault] ${label} simulation failed`, sim.value.err, sim.value.logs);
      throw new Error(`${label} simulation failed: ${JSON.stringify(sim.value.err)}`);
    }
    console.warn(`[vault] ${label} pre-sign simulation ok`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('simulation failed')) throw error;
    console.warn(`[vault] Could not pre-flight the ${label} transaction`, error);
    toast.warning('Could not pre-flight the transaction', {
      description: 'RPC simulation timed out or was unavailable. Review the wallet preview before signing.',
      duration: 8000,
    });
  }
}

async function nativeGetLatestBlockhash(rpcUrl: string): Promise<string> {
  const rpcUrls = Array.from(new Set([rpcUrl, PUBLIC_SOLANA_RPC_URL].filter(Boolean)));
  let lastError: unknown = null;
  for (const url of rpcUrls) {
    try {
      const result = await nativeRpcRequest<{ value?: { blockhash?: string } }>(
        url,
        'getLatestBlockhash',
        [{ commitment: 'confirmed' }],
        url === rpcUrl ? 8_000 : 20_000,
      );
      const blockhash = result?.value?.blockhash;
      if (!blockhash) throw new Error('Recent blockhash response was invalid');
      return blockhash;
    } catch (error) {
      lastError = error;
      if (!isNativeRpcTimeout(error)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Recent blockhash timed out');
}

async function waitForConfirmationNative(
  rpcUrl: string,
  sig: string,
  timeoutMs = CONFIRM_TIMEOUT_MS,
): Promise<'confirmed' | 'finalized' | 'timeout'> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      let res: { value: ({ confirmationStatus?: string; err?: unknown } | null)[] } | null = null;
      const rpcUrls = Array.from(new Set([rpcUrl, PUBLIC_SOLANA_RPC_URL].filter(Boolean)));
      for (const url of rpcUrls) {
        try {
          res = await nativeRpcRequest<{ value: ({ confirmationStatus?: string; err?: unknown } | null)[] }>(
            url,
            'getSignatureStatuses',
            [[sig]],
            url === rpcUrl ? 8_000 : 20_000,
          );
          break;
        } catch (error) {
          lastError = error;
          if (!isNativeRpcTimeout(error)) throw error;
        }
      }
      if (!res) throw lastError instanceof Error ? lastError : new Error('Signature status unavailable');
      const status = res?.value?.[0];
      if (status?.err) throw new Error('Transaction failed on-chain');
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        return status.confirmationStatus;
      }
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  if (lastError instanceof Error && lastError.message === 'Transaction failed on-chain') throw lastError;
  return 'timeout';
}

async function postPurchaseJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: JSON.stringify(body),
      responseType: 'json',
      connectTimeout: 10_000,
      readTimeout: 12_000,
    });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, data: response.data };
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => null),
  };
}

async function getVaultJson<T = any>(
  url: string,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      headers,
      responseType: 'json',
      connectTimeout: 20_000,
      readTimeout: 30_000,
    });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, data: response.data as T };
  }
  const response = await fetch(url, { headers });
  return {
    ok: response.ok,
    status: response.status,
    data: response.ok ? await response.json().catch(() => null) : null,
  };
}

async function getVaultBalanceAmount(base: string, address: string, headers?: Record<string, string>): Promise<number | null> {
  const res = await getVaultJson<PrismBalance>(`${base}/api/prism/balance?address=${encodeURIComponent(address)}`, headers);
  if (!res.ok || !res.data) return null;
  return Number(res.data.balance ?? 0);
}

function isRetryablePurchaseError(status: number, message: string): boolean {
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true;
  return /not found|wait for confirmation|verification in progress|verification failed|timeout|timed out/i.test(message);
}

async function postPurchaseWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  label: string,
  timeoutMs = 60_000,
): Promise<{ ok: boolean; status: number; data: any }> {
  const startedAt = Date.now();
  let last: { status: number; message: string } | null = null;
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    console.warn(`[vault] step 4/4 — ${label} server verify attempt ${attempt}`);
    let res: { ok: boolean; status: number; data: any };
    try {
      res = await postPurchaseJson(url, headers, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      last = { status: 0, message };
      console.warn(`[vault] ${label} server verify attempt ${attempt} failed`, message);
      if (!isRetryablePurchaseError(0, message)) throw error;
      await sleep(Math.min(4_000, 1_500 * attempt));
      continue;
    }
    if (res.ok) return res;

    const message = String(res.data?.error || `Purchase failed (${res.status})`);
    last = { status: res.status, message };
    if (!isRetryablePurchaseError(res.status, message)) {
      throw new Error(message);
    }
    await sleep(Math.min(4_000, 1_500 * attempt));
  }

  throw new Error(last?.message || `${label} verification timed out`);
}

async function waitForVaultBalanceCredit(
  base: string,
  address: string,
  headers: Record<string, string>,
  balanceBefore: number | null,
  expectedCoins: number,
  timeoutMs = 30_000,
): Promise<PrismBalance | null> {
  const startedAt = Date.now();
  const target = balanceBefore === null ? null : balanceBefore + expectedCoins;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await getVaultJson<PrismBalance>(`${base}/api/prism/balance?address=${encodeURIComponent(address)}`, headers);
      if (res.ok && res.data) {
        const current = Number(res.data.balance ?? 0);
        if (target === null || current >= target) return res.data;
      }
    } catch (error) {
      console.warn('[vault] balance reflection poll failed', error);
    }
    await sleep(2_000);
  }
  return null;
}

async function finalizeVaultPurchaseCredit(
  base: string,
  address: string,
  headers: Record<string, string>,
  balanceBefore: number | null,
  expectedCoins: number,
  verify: () => Promise<{ ok: boolean; status: number; data: any }>,
): Promise<PrismBalance | null> {
  let verifyError: unknown = null;
  try {
    const res = await verify();
    if (!res.ok) {
      const err = res.data || { error: `Purchase failed (${res.status})` };
      throw new Error(err.error || 'Purchase failed');
    }
    if (res.data?.balance) {
      return res.data.balance as PrismBalance;
    }
  } catch (error) {
    verifyError = error;
    console.warn('[vault] server verify did not complete; polling balance reflection', error);
  }

  const credited = await waitForVaultBalanceCredit(base, address, headers, balanceBefore, expectedCoins, 45_000);
  if (credited) return credited;
  if (verifyError) {
    throw verifyError instanceof Error ? verifyError : new Error(String(verifyError));
  }
  return null;
}

function BuyCoinsSection({ walletAddress, onPurchased }: { walletAddress: string; onPurchased: () => void }) {
  const wallet = useWallet();
  const [buyingIdx, setBuyingIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [status, setStatus] = useState<{ purchasedToday: number; remainingToday: number } | null>(null);
  const [payWith, setPayWith] = useState<'sol' | 'skr'>('sol');
  const [skrQuotes, setSkrQuotes] = useState<{ coins: number; skrPrice: number }[] | null>(null);
  const [pendingConnectBuyIdx, setPendingConnectBuyIdx] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const isNativePlatform = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!walletAddress) return;
    const base = getApiBase();
    const jwt = getCachedJwt(walletAddress);
    getVaultJson(`${base}/api/prism/buy/status?address=${encodeURIComponent(walletAddress)}`, {
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    })
      .then((r) => (r.ok ? r.data : null))
      .then((d) => {
        if (d) setStatus(d);
      })
      .catch(() => {});
    getVaultJson(`${base}/api/prism/buy/skr-quote`)
      .then((r) => (r.ok ? r.data : null))
      .then((d) => {
        if (d?.quotes) setSkrQuotes(d.quotes);
      })
      .catch(() => {});
  }, [walletAddress]);

  const handleBuy = useCallback(async () => {
    if (isDemoMode()) {
      toast.info('This is a demo — connect a wallet to do this.');
      return;
    }
    if (selectedIdx === null || buyingIdx !== null) return;
    const signerAddress = wallet.publicKey?.toBase58() || walletAddress;
    const walletReady = Boolean(signerAddress && wallet.connected && (wallet.signTransaction || wallet.sendTransaction));
    if (!walletReady) {
      if (isNativePlatform) {
        setActionMessage('Opening wallet approval...');
        setPendingConnectBuyIdx(selectedIdx);
        const seedVaultWallet = wallet.wallets.find((entry) => entry.adapter.name === SEEDVAULT_NAME);
        if (seedVaultWallet && wallet.wallet?.adapter.name !== SEEDVAULT_NAME) {
          wallet.select(SEEDVAULT_NAME);
          toast.info('Opening Seed Vault...');
          return;
        }
        if (!wallet.wallet) {
          const nativeWallet =
            seedVaultWallet ??
            wallet.wallets.find((entry) => entry.adapter.name === SolanaMobileWalletAdapterWalletName) ??
            wallet.wallets.find(
              (entry) =>
                entry.adapter.name !== SolanaMobileWalletAdapterWalletName &&
                (entry.readyState === WalletReadyState.Installed || entry.readyState === WalletReadyState.Loadable),
            );
          if (nativeWallet) {
            wallet.select(nativeWallet.adapter.name);
          }
          toast.info(nativeWallet?.adapter.name === SEEDVAULT_NAME ? 'Opening Seed Vault...' : 'Opening wallet...');
          return;
        }
        if (!wallet.connecting) {
          toast.info('Opening wallet...');
          try {
            await wallet.connect();
          } catch (error: any) {
            setPendingConnectBuyIdx(null);
            setActionMessage(error?.message || 'Wallet connection cancelled');
            toast.error(error?.message || 'Wallet connection cancelled');
          }
        }
        return;
      }
      const message = !signerAddress ? 'Connect wallet first' : 'Wallet is still restoring — try again in a moment';
      setActionMessage(message);
      toast.error(message);
      return;
    }
    const pkg = COIN_PACKAGES[selectedIdx];
    setActionMessage('Preparing transaction...');
    setBuyingIdx(selectedIdx);

    // 120s timeout covers PIN entry + MWA approval + chain confirmation + POST round-trip.
    // Earlier 30s caused silent fails: SOL was spent but coins not credited when user
    // took longer than 30s to approve in wallet UI.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              'Purchase took longer than 2 minutes — your SOL may still be processing. Check Vault balance or wallet activity before retrying.',
            ),
          ),
        120_000,
      ),
    );

    try {
      await Promise.race([
        timeout,
        (async () => {
          const {
            Connection: SolConn,
            PublicKey: SolPK,
            SystemProgram: SolSP,
            Transaction: SolTx,
          } = await import('@solana/web3.js');
          const base = getApiBase();
          const rpcUrl = rpcUrlFromApiBase(base);
          const conn = new SolConn(base.replace(/\/api(\/.*)?$/, '') + '/rpc', {
            commitment: 'confirmed',
            fetch: createRpcFetch() as any,
          } as any);
          const treasuryAddr = '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN';
          // Treasury self-purchase is allowed (operator request) — no client-side block.

          let sig: string;
          const sendOptions = { skipPreflight: true, preflightCommitment: 'confirmed' as const };
          const authHeader = getCachedJwt(signerAddress) ?? (await obtainJwt(wallet));
          if (!authHeader) {
            throw new Error('Sign-in needed before purchase');
          }
          const jsonHeaders = {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: `Bearer ${authHeader}` } : {}),
          };
          const balanceBefore = await getVaultBalanceAmount(base, signerAddress, jsonHeaders).catch(() => null);

          if (payWith === 'skr') {
            console.warn('[vault] step 1/4 — prepare SKR transaction');
            const skrQuote = skrQuotes?.[selectedIdx];
            if (!skrQuote) {
              toast.error('SKR price unavailable');
              setBuyingIdx(null);
              return;
            }
            const {
              getAssociatedTokenAddress,
              createTransferCheckedInstruction,
              createAssociatedTokenAccountIdempotentInstruction,
              TOKEN_PROGRAM_ID,
              TOKEN_2022_PROGRAM_ID,
            } = await import('@/lib/solanaToken');
            const skrMint = new SolPK('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3');
            const ownerKey = new SolPK(signerAddress);
            const treasuryKey = new SolPK(treasuryAddr);
            // Detect SKR mint owner program (handles Token-2022) and read decimals from on-chain mint.
            // 5s race: if RPC stalls, fall back to legacy TOKEN_PROGRAM_ID + 6 decimals
            // (SKRbvo6... is legacy SPL Token with 6 decimals — verified on-chain).
            const mintAccountInfo = await vaultWithTimeout('getAccountInfo(SKR mint)', conn.getAccountInfo(skrMint), 5_000).catch(
              (error) => {
                console.warn('[vault] SKR mint probe skipped', error);
                return null;
              },
            );
            const activeTokenProgramId = mintAccountInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
              ? TOKEN_2022_PROGRAM_ID
              : TOKEN_PROGRAM_ID;
            // SPL mint layout: decimals at offset 44 (1 byte). Fallback 6 if RPC timed out.
            const decimals = mintAccountInfo?.data?.[44] ?? 6;
            const amountBaseUnits = BigInt(skrQuote.skrPrice) * 10n ** BigInt(decimals);
            const ownerAta = await getAssociatedTokenAddress(skrMint, ownerKey, false, activeTokenProgramId);
            const treasuryAta = await getAssociatedTokenAddress(skrMint, treasuryKey, false, activeTokenProgramId);
            // SKR balance preflight — show a clear "Insufficient SKR" instead of an "account not found"
            // simulation error when the wallet has no SKR token account / not enough SKR.
            {
              let skrBalanceBase = -1n; // -1 = unknown (RPC issue) → don't block, let simulation handle it
              try {
                const bal = await vaultWithTimeout('getTokenAccountBalance(SKR preflight)', conn.getTokenAccountBalance(ownerAta), 8_000);
                skrBalanceBase = BigInt(bal?.value?.amount ?? '0');
              } catch (e) {
                const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
                // ATA missing → no SKR at all (treat as 0); a timeout/RPC error stays "unknown".
                skrBalanceBase = m.includes('could not find') || m.includes('not found') || m.includes('invalid param') ? 0n : -1n;
              }
              if (skrBalanceBase >= 0n && skrBalanceBase < amountBaseUnits) {
                const have = Number(skrBalanceBase) / 10 ** decimals;
                toast.error('Insufficient SKR', { description: `Need ${skrQuote.skrPrice} SKR. You have ${have.toLocaleString()} SKR.` });
                setActionMessage('Insufficient SKR');
                return;
              }
            }
            const tx = new SolTx();
            // Always use idempotent ATA create — safe whether treasury ATA exists or not.
            // (Plain create + getAccountInfo race / proxy null-result caused Custom:1 AccountAlreadyInUse.)
            tx.add(
              createAssociatedTokenAccountIdempotentInstruction(ownerKey, treasuryAta, treasuryKey, skrMint, activeTokenProgramId),
            );
            tx.add(
              createTransferCheckedInstruction(
                ownerAta,
                skrMint,
                treasuryAta,
                ownerKey,
                amountBaseUnits,
                decimals,
                [],
                activeTokenProgramId,
              ),
            );
            console.warn('[vault] step 2/4 — getLatestBlockhash(confirmed)');
            tx.recentBlockhash = isNativePlatform
              ? await vaultWithTimeout('native getLatestBlockhash(confirmed)', nativeGetLatestBlockhash(rpcUrl), 10_000)
              : (await vaultWithTimeout('getLatestBlockhash(confirmed)', conn.getLatestBlockhash('confirmed'), 30_000)).blockhash;
            tx.feePayer = ownerKey;
            await simulateVaultBeforeSign(conn, tx, 'SKR', isNativePlatform);
            const origSerializeSKR = tx.serialize.bind(tx);
            tx.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
              origSerializeSKR({ ...config, requireAllSignatures: false })) as typeof tx.serialize;
            if (wallet.signTransaction) {
              console.warn('[vault] step 3/4 — wallet.signTransaction SKR (popup expected)');
              const signed = await vaultWithTimeout('wallet.signTransaction(SKR)', wallet.signTransaction(tx), 120_000);
              const raw = signed.serialize({ requireAllSignatures: false, verifySignatures: false });
              console.warn('[vault] step 3/4 — signed SKR; sending raw transaction');
              sig = isNativePlatform
                ? await vaultWithTimeout('native sendRawTransaction(SKR)', nativeSendRawTransaction(rpcUrl, raw, sendOptions), NATIVE_SEND_RAW_TIMEOUT_MS)
                : await vaultWithTimeout('sendRawTransaction(SKR)', conn.sendRawTransaction(raw, sendOptions), 45_000);
            } else if (wallet.sendTransaction) {
              console.warn('[vault] step 3/4 — wallet.sendTransaction SKR (popup expected)');
              sig = await vaultWithTimeout('wallet.sendTransaction(SKR)', wallet.sendTransaction(tx, conn, sendOptions), 120_000);
            } else {
              throw new Error('Wallet does not support transaction signing');
            }
            console.warn('[vault] step 4/4 — SKR signature produced', sig);
            if (!isNativePlatform) {
              toast.info('Confirming SKR transaction...');
              const skrConfirmStatus = await waitForConfirmation(conn, sig, CONFIRM_TIMEOUT_MS);
              if (skrConfirmStatus === 'timeout') {
                toast.info('Still confirming — credit will be processed when transaction is verified.');
              }
            } else {
              console.warn('[vault] native confirmation uses server verify + /api/prism/balance polling (skip getSignatureStatuses)');
            }

            const credited = await finalizeVaultPurchaseCredit(
              base,
              signerAddress,
              jsonHeaders,
              balanceBefore,
              pkg.coins,
              () =>
                postPurchaseWithRetry(`${base}/api/prism/buy/skr`, jsonHeaders, {
                  address: signerAddress,
                  packageIndex: selectedIdx,
                  txSignature: sig,
                }, 'SKR purchase'),
            );
            if (credited) {
              toast.success(`Purchased ${pkg.coins} Coins for ${skrQuote.skrPrice} SKR!`);
              if (status)
                setStatus({
                  ...status,
                  purchasedToday: status.purchasedToday + pkg.coins,
                  remainingToday: status.remainingToday - pkg.coins,
                });
              onPurchased();
            } else {
              throw new Error('Purchase verification did not update balance');
            }
          } else {
            console.warn('[vault] step 1/4 — prepare SOL transaction');
            // SOL balance preflight — show a clear "Insufficient SOL" instead of an opaque
            // simulation/RPC error when the wallet can't cover the package price + fees.
            {
              const requiredLamports = Math.floor(pkg.solPrice * 1e9) + 1_000_000; // price + ~0.001 SOL fee reserve
              let solLamports = -1;
              try {
                solLamports = await vaultWithTimeout('getBalance(SOL preflight)', conn.getBalance(new SolPK(signerAddress)), 8_000);
              } catch {
                solLamports = -1; // unknown — don't block, let simulation handle it
              }
              if (solLamports >= 0 && solLamports < requiredLamports) {
                const need = (requiredLamports / 1e9).toFixed(3);
                const have = (solLamports / 1e9).toFixed(3);
                toast.error('Insufficient SOL', { description: `Need ~${need} SOL (incl. fee). You have ${have} SOL.` });
                setActionMessage('Insufficient SOL');
                return;
              }
            }
            const tx = new SolTx().add(
              SolSP.transfer({
                fromPubkey: new SolPK(signerAddress),
                toPubkey: new SolPK(treasuryAddr),
                lamports: Math.floor(pkg.solPrice * 1e9),
              }),
            );
            console.warn('[vault] step 2/4 — getLatestBlockhash(confirmed)');
            tx.recentBlockhash = isNativePlatform
              ? await vaultWithTimeout('native getLatestBlockhash(confirmed)', nativeGetLatestBlockhash(rpcUrl), 10_000)
              : (await vaultWithTimeout('getLatestBlockhash(confirmed)', conn.getLatestBlockhash('confirmed'), 30_000)).blockhash;
            tx.feePayer = new SolPK(signerAddress);
            await simulateVaultBeforeSign(conn, tx, 'SOL', isNativePlatform);
            const origSerializeSOL = tx.serialize.bind(tx);
            tx.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
              origSerializeSOL({ ...config, requireAllSignatures: false })) as typeof tx.serialize;
            if (wallet.signTransaction) {
              console.warn('[vault] step 3/4 — wallet.signTransaction SOL (popup expected)');
              const signed = await vaultWithTimeout('wallet.signTransaction(SOL)', wallet.signTransaction(tx), 120_000);
              const raw = signed.serialize({ requireAllSignatures: false, verifySignatures: false });
              console.warn('[vault] step 3/4 — signed SOL; sending raw transaction');
              sig = isNativePlatform
                ? await vaultWithTimeout('native sendRawTransaction(SOL)', nativeSendRawTransaction(rpcUrl, raw, sendOptions), NATIVE_SEND_RAW_TIMEOUT_MS)
                : await vaultWithTimeout('sendRawTransaction(SOL)', conn.sendRawTransaction(raw, sendOptions), 45_000);
            } else if (wallet.sendTransaction) {
              console.warn('[vault] step 3/4 — wallet.sendTransaction SOL (popup expected)');
              sig = await vaultWithTimeout('wallet.sendTransaction(SOL)', wallet.sendTransaction(tx, conn, sendOptions), 120_000);
            } else {
              throw new Error('Wallet does not support transaction signing');
            }
            console.warn('[vault] step 4/4 — SOL signature produced', sig);
            if (!isNativePlatform) {
              toast.info('Confirming transaction...');
              const solConfirmStatus = await waitForConfirmation(conn, sig, CONFIRM_TIMEOUT_MS);
              if (solConfirmStatus === 'timeout') {
                toast.info('Still confirming — credit will be processed when transaction is verified.');
              }
            } else {
              console.warn('[vault] native confirmation uses server verify + /api/prism/balance polling (skip getSignatureStatuses)');
            }

            const credited = await finalizeVaultPurchaseCredit(
              base,
              signerAddress,
              jsonHeaders,
              balanceBefore,
              pkg.coins,
              () =>
                postPurchaseWithRetry(`${base}/api/prism/buy`, jsonHeaders, {
                  address: signerAddress,
                  packageIndex: selectedIdx,
                  txSignature: sig,
                }, 'SOL purchase'),
            );
            if (credited) {
              toast.success(`Purchased ${pkg.coins} Coins!`);
              if (status)
                setStatus({
                  ...status,
                  purchasedToday: status.purchasedToday + pkg.coins,
                  remainingToday: status.remainingToday - pkg.coins,
                });
              onPurchased();
            } else {
              throw new Error('Purchase verification did not update balance');
            }
          }
          setActionMessage(null);
          setSelectedIdx(null);
        })(),
      ]);
    } catch (e: any) {
      if (e?.message?.includes('User rejected')) {
        setActionMessage('Transaction cancelled');
        toast.info('Transaction cancelled');
      } else {
        const message = e?.name === 'AbortError' ? 'RPC request timed out' : e?.message || 'Purchase failed';
        setActionMessage(message);
        toast.error(message);
      }
    } finally {
      setBuyingIdx(null);
    }
  }, [walletAddress, wallet, buyingIdx, selectedIdx, status, onPurchased, payWith, skrQuotes, isNativePlatform]);

  const handleBuyTouch = useCallback(
    (event: TouchEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void handleBuy();
    },
    [handleBuy],
  );

  useEffect(() => {
    if (pendingConnectBuyIdx === null || !isNativePlatform || buyingIdx !== null) return;
    const seedVaultWallet = wallet.wallets.find((entry) => entry.adapter.name === SEEDVAULT_NAME);
    if (seedVaultWallet && wallet.wallet?.adapter.name !== SEEDVAULT_NAME) {
      wallet.select(SEEDVAULT_NAME);
      return;
    }
    if (!wallet.wallet) return;
    if (wallet.connected && wallet.publicKey && (wallet.signTransaction || wallet.sendTransaction)) {
      setPendingConnectBuyIdx(null);
      setSelectedIdx(pendingConnectBuyIdx);
      window.setTimeout(() => {
        void handleBuy();
      }, 0);
      return;
    }
    if (!wallet.connecting) {
      wallet.connect().catch((error: any) => {
        setPendingConnectBuyIdx(null);
        setActionMessage(error?.message || 'Wallet connection cancelled');
        toast.error(error?.message || 'Wallet connection cancelled');
      });
    }
  }, [pendingConnectBuyIdx, isNativePlatform, buyingIdx, wallet, handleBuy]);

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
              <img src="/textures/Solana.png" alt="" className="w-4 h-4 object-contain shrink-0" loading="lazy" />
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
              <img src="/tokens/skr-icon.png" alt="" className="w-4 h-4 object-contain shrink-0" loading="lazy" />
              SKR
            </button>
          </div>
          {status && (
            <span className="text-[10px] text-white/50">{status.remainingToday.toLocaleString()} left today</span>
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
        <>
          <p className="mb-2 text-[10px] text-white/35 leading-relaxed">
            Wallet approval transfers{' '}
            {payWith === 'sol'
              ? `${selectedPkg.solPrice} SOL`
              : selectedSkr
                ? `${selectedSkr.toLocaleString()} SKR`
                : 'SKR'}{' '}
            to the Identity Prism treasury. Purchases are final after on-chain confirmation. Your wallet may show a rounded total.
          </p>
          <Button
            type="button"
            className="w-full h-11 font-bold text-sm no-select touch-manipulation"
            style={{
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              color: '#000',
              boxShadow: '0 4px 20px rgba(251,191,36,0.25)',
            }}
            onClick={handleBuy}
            onTouchEnd={handleBuyTouch}
            onPointerUp={(event) => {
              if (event.pointerType === 'touch') {
                handleBuyTouch(event);
              }
            }}
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
          {actionMessage && (
            <p className="mt-2 text-center text-[10px] font-semibold text-white/45">{actionMessage}</p>
          )}
        </>
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
    icon: '/icons/tiers/tier_bronze.png',
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
    icon: '/icons/tiers/tier_silver.png',
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
    icon: '/icons/tiers/tier_gold.png',
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

  useEffect(() => {
    setAuthWallet(wallet);
  }, [wallet]);

  const tier = VAULT_TIERS.find((t) => t.id === selectedTier)!;

  useEffect(() => {
    if (!walletAddress) return;
    setLoadingStatus(true);
    const base = getApiBase();
    const jwt = getCachedJwt(walletAddress);
    getVaultJson(`${base}/api/prism/vault/status?address=${encodeURIComponent(walletAddress)}`, {
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    })
      .then((r) => (r.ok ? r.data : null))
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

  const getJwt = useCallback(() => obtainJwt(wallet), [wallet]);

  const handleStake = useCallback(async () => {
    if (isDemoMode()) {
      toast.info('This is a demo — connect a wallet to do this.');
      return;
    }
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
      const { ok, data } = await postPurchaseJson(
        `${base}/api/prism/vault/stake`,
        { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        { amount, tier: selectedTier, lockDays },
      );
      if (!ok) throw new Error(data?.error || 'Stake failed');
      toast.success(`Staked ${amount.toLocaleString()} coins in ${tier.label} Vault!`);
      setVaultStatus(data.status || { staked: true, tier: selectedTier, amount });
      setStakeAmount('');
      onBalanceChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Stake failed');
    } finally {
      setStaking(false);
    }
  }, [stakeAmount, tier, balance, walletAddress, selectedTier, lockDays, onBalanceChange, wallet, getJwt]);

  const handleClaim = useCallback(async () => {
    if (isDemoMode()) {
      toast.info('This is a demo — connect a wallet to do this.');
      return;
    }
    if (!walletAddress) return;
    setClaiming(true);
    try {
      const jwt = await getJwt();
      if (!jwt) {
        toast.error('Authentication failed');
        return;
      }
      const base = getApiBase();
      const { ok, data } = await postPurchaseJson(
        `${base}/api/prism/vault/claim`,
        { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        {},
      );
      if (!ok) throw new Error(data?.error || 'Claim failed');
      toast.success(`Claimed ${data?.claimed ?? ''} coins!`);
      setVaultStatus((v) => (v ? { ...v, unclaimedYield: 0 } : v));
      onBalanceChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Claim failed');
    } finally {
      setClaiming(false);
    }
  }, [walletAddress, onBalanceChange, wallet, getJwt]);

  const handleUnstake = useCallback(async () => {
    if (isDemoMode()) {
      toast.info('This is a demo — connect a wallet to do this.');
      return;
    }
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
      const { ok, data } = await postPurchaseJson(
        `${base}/api/prism/vault/unstake`,
        { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        {},
      );
      if (!ok) throw new Error(data?.error || 'Unstake failed');
      toast.success(
        data?.penalty > 0
          ? `Unstaked: received ${data?.returned?.toLocaleString()} coins (${data?.penalty?.toLocaleString()} burned as penalty)`
          : data?.message || 'Unstaked successfully',
      );
      setVaultStatus({ staked: false });
      onBalanceChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unstake failed');
    } finally {
      setUnstaking(false);
    }
  }, [walletAddress, onBalanceChange, wallet, getJwt]);

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
        <span className="text-[10px] text-white/50">Earn yield on your coins</span>
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
                <img
                  src={stakedTierInfo?.icon ?? '/icons/tiers/tier_gold.png'}
                  alt=""
                  className="w-9 h-9 object-contain"
                  loading="lazy"
                />
              </div>
              <div>
                <p className="text-white font-bold text-sm">{stakedTierInfo?.label ?? vaultStatus.tier} Vault</p>
                <p className="text-white/50 text-[10px]">
                  {vaultStatus.amount?.toLocaleString()} coins ·{' '}
                  {LOCK_OPTIONS.find((o) => o.days === vaultStatus.lockDays)?.label ?? `${vaultStatus.lockDays ?? 7}d`}{' '}
                  lock · {LOCK_OPTIONS.find((o) => o.days === vaultStatus.lockDays)?.mult ?? '1x'} yield
                </p>
                {vaultStatus.unlocksAt && (
                  <p className="text-white/50 text-[9px]">
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
                icon: <img src="/tokens/prism-icon.png" alt="" className="w-4 h-4 text-amber-400 object-contain" loading="lazy" />,
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
                <p className="text-white/50 text-[9px] mt-0.5">{s.label}</p>
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
              {claiming ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <img src="/tokens/prism-icon.png" alt="" className="w-3 h-3 mr-1 object-contain" loading="lazy" />}
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
                  <img src={t.icon} alt="" className="w-12 h-12 mx-auto mb-2 object-contain" loading="lazy" />
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
            <p className="text-[10px] text-white/50 uppercase tracking-wider mb-2">Lock Duration</p>
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
              <span className="text-[10px] text-white/50">Est. daily yield</span>
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
  const walletAddress = useActiveWalletAddress() || publicKey?.toBase58() || '';
  const [balance, setBalance] = useState<PrismBalance | null>(null);

  useEffect(() => {
    fadeOutTransition();
  }, []);

  const fetchBalanceDirect = useCallback(() => {
    if (!walletAddress) return;
    const base = getApiBase();
    if (!base) return;
    getVaultJson<PrismBalance>(`${base}/api/prism/balance?address=${encodeURIComponent(walletAddress)}`)
      .then((r) => (r.ok ? r.data : null))
      .then((d) => {
        if (d) setBalance(d);
      })
      .catch(() => {});
  }, [walletAddress]);

  useEffect(() => {
    fetchBalanceDirect();
  }, [fetchBalanceDirect]);

  // Refetch balance when user returns to the page (window focus / app foreground).
  // Without this, balance stayed stale after buying coins and switching apps.
  useEffect(() => {
    const onFocus = () => {
      fetchBalanceDirect();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchBalanceDirect();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchBalanceDirect]);

  return (
    <PageShell className="text-white">
      <header className="flex-none sticky top-0 z-20 bg-[#050510]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <HubReturnButton aria-label="Go to hub" />
          <img src="/hub/vault.png" alt="" className="w-6 h-6 object-contain" />
          <div className="flex flex-col">
            <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-300 leading-tight">
              Prism Vault
            </h1>
            <span className="text-[10px] text-white/50 leading-none">Buy coins & earn staking yield</span>
          </div>
          <div className="flex-1" />
          {balance && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <img src="/tokens/prism-icon.png" alt="" className="w-4 h-4 object-contain" loading="lazy" />
              <span className="text-xs font-bold text-white/70">{balance.balance.toLocaleString()}</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto max-w-2xl mx-auto w-full px-4 py-6 pb-24">
        {!walletAddress ? (
          <div className="text-center py-20 text-white/50">
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
