import { WalletContextState } from '@solana/wallet-adapter-react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@/lib/solanaToken';
import { SEEKER_TOKEN, TREASURY_ADDRESS, getHeliusRpcUrl, getHeliusProxyHeaders } from '@/constants';
import { SeedVaultAdapter } from '@/lib/SeedVaultAdapter';
import { toast } from 'sonner';

const REVIVE_SKR_AMOUNT = 5;
const MIN_SOL_FOR_FEE = 0.003;
const PUBLIC_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const NATIVE_PRE_SIGN_SIMULATION_TIMEOUT_MS = 5_000;

export type ReviveError =
  | { code: 'INSUFFICIENT_SKR'; skrBalance: number; required: number }
  | { code: 'INSUFFICIENT_SOL'; solBalance: number; required: number }
  | { code: 'SIMULATION_FAILED'; message: string }
  | { code: 'USER_CANCELLED' }
  | { code: 'UNKNOWN'; message: string };

export interface ReviveResult {
  success: boolean;
  signature?: string;
  error?: ReviveError;
}

type ReviveWallet = Pick<WalletContextState, 'publicKey' | 'signTransaction' | 'sendTransaction'>;

async function resolveReviveWallet(wallet: WalletContextState, expectedAddress?: string): Promise<ReviveWallet | null> {
  if (wallet.publicKey && (wallet.signTransaction || wallet.sendTransaction)) {
    return wallet;
  }

  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  const seedVault = new SeedVaultAdapter();
  await seedVault.connect();
  if (!seedVault.publicKey) {
    return null;
  }

  const actualAddress = seedVault.publicKey.toBase58();
  if (expectedAddress && actualAddress !== expectedAddress) {
    throw new Error(`Connected Seed Vault account ${actualAddress} does not match active wallet ${expectedAddress}`);
  }

  return {
    publicKey: seedVault.publicKey,
    signTransaction: seedVault.signTransaction.bind(seedVault) as ReviveWallet['signTransaction'],
    sendTransaction: undefined,
  };
}

// Per-step timeout so any hung Connection RPC call fails fast with a clear
// label, instead of stalling the UI on PROCESSING and never reaching signTransaction.
const reviveWithTimeout = <T,>(label: string, p: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`[revive] STEP_TIMEOUT ${label} after ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

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

function signedTransactionSignature(tx: Transaction): string | null {
  return tx.signature ? bytesToBase58(new Uint8Array(tx.signature)) : null;
}

const isReviveRpcTimeout = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /timeout|timed out|SocketTimeout/i.test(message);
};

const reviveSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function reviveNativeRpcRequest<T>(
  rpcUrl: string,
  headers: Record<string, string>,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<T> {
  const response = await CapacitorHttp.post({
    url: rpcUrl,
    headers: { 'Content-Type': 'application/json', ...headers },
    data: { jsonrpc: '2.0', id: Date.now(), method, params },
    responseType: 'json',
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`[revive] RPC ${method} failed (${response.status})`);
  }
  const payload = response.data;
  if (payload?.error) {
    throw new Error(payload.error.message || `[revive] RPC ${method} error`);
  }
  return payload?.result as T;
}

async function reviveNativeGetLatestBlockhash(
  rpcUrl: string,
  headers: Record<string, string>,
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const result = await reviveNativeRpcRequest<{ value?: { blockhash?: string; lastValidBlockHeight?: number } }>(
    rpcUrl,
    headers,
    'getLatestBlockhash',
    [{ commitment: 'confirmed' }],
    8_000,
  );
  const blockhash = result?.value?.blockhash;
  const lastValidBlockHeight = Number(result?.value?.lastValidBlockHeight);
  if (!blockhash || !Number.isFinite(lastValidBlockHeight)) {
    throw new Error('[revive] invalid getLatestBlockhash response');
  }
  return { blockhash, lastValidBlockHeight };
}

async function reviveNativeGetTokenAccountBalance(
  rpcUrl: string,
  headers: Record<string, string>,
  ata: PublicKey,
) {
  return reviveNativeRpcRequest<{ value: { uiAmount: number | null; decimals: number } }>(
    rpcUrl,
    headers,
    'getTokenAccountBalance',
    [ata.toBase58()],
    8_000,
  );
}

async function reviveNativeGetBalance(
  rpcUrl: string,
  headers: Record<string, string>,
  owner: PublicKey,
) {
  const result = await reviveNativeRpcRequest<{ value?: number }>(
    rpcUrl,
    headers,
    'getBalance',
    [owner.toBase58(), { commitment: 'confirmed' }],
    8_000,
  );
  const lamports = Number(result?.value);
  if (!Number.isFinite(lamports)) {
    throw new Error('[revive] invalid getBalance response');
  }
  return lamports;
}

async function reviveNativeSendRawTransaction(
  rpcUrl: string,
  headers: Record<string, string>,
  rawTransaction: Uint8Array,
  options: { skipPreflight: boolean; preflightCommitment: 'confirmed' | 'finalized' },
  localSignature?: string | null,
) {
  const params = [bytesToBase64(rawTransaction), { encoding: 'base64', ...options }];
  const rpcUrls = Array.from(new Set([rpcUrl, PUBLIC_SOLANA_RPC_URL].filter(Boolean)));
  let lastError: unknown = null;

  for (const url of rpcUrls) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        console.warn(`[revive] broadcast via ${url === rpcUrl ? 'proxy' : 'public'} attempt ${attempt + 1}`);
        return await reviveNativeRpcRequest<string>(
          url,
          url === rpcUrl ? headers : {},
          'sendTransaction',
          params,
          url === rpcUrl ? 12_000 : 20_000,
        );
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (localSignature && /already been processed|already processed|Transaction was already processed/i.test(message)) {
          console.warn('[revive] broadcast reports already processed; using local signature');
          return localSignature;
        }
        if (!isReviveRpcTimeout(error)) throw error;
        console.warn('[revive] broadcast timeout', message);
        await reviveSleep(600 * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('[revive] sendTransaction timed out');
}

async function reviveNativeGetSignatureStatuses(
  rpcUrl: string,
  headers: Record<string, string>,
  sig: string,
) {
  const rpcUrls = Array.from(new Set([rpcUrl, PUBLIC_SOLANA_RPC_URL].filter(Boolean)));
  let lastError: unknown = null;
  for (const url of rpcUrls) {
    try {
      return await reviveNativeRpcRequest<{ value: ({ confirmationStatus?: string; err?: unknown } | null)[] }>(
        url,
        url === rpcUrl ? headers : {},
        'getSignatureStatuses',
        [[sig], { searchTransactionHistory: true }],
        url === rpcUrl ? 8_000 : 20_000,
      );
    } catch (error) {
      lastError = error;
      if (!isReviveRpcTimeout(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('[revive] signature status unavailable');
}

export async function payForRevive(wallet: WalletContextState, expectedAddress?: string): Promise<ReviveResult> {
  let reviveWallet: ReviveWallet | null = null;
  try {
    reviveWallet = await resolveReviveWallet(wallet, expectedAddress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isCancel = /reject|cancel|denied|abort|dismiss|decline|user.?reject|4001|USER_REJECTED/i.test(msg);
    return { success: false, error: isCancel ? { code: 'USER_CANCELLED' } : { code: 'UNKNOWN', message: msg } };
  }

  if (!reviveWallet?.publicKey || (!reviveWallet.signTransaction && !reviveWallet.sendTransaction)) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Wallet not connected' } };
  }

  const payer = reviveWallet.publicKey;
  const address = payer.toBase58();
  const heliusRpcUrl = getHeliusRpcUrl(address);
  if (!heliusRpcUrl) {
    return { success: false, error: { code: 'UNKNOWN', message: 'RPC not configured' } };
  }

  const rpcHeaders = getHeliusProxyHeaders(address);
  const connection = new Connection(heliusRpcUrl, {
    commitment: 'confirmed',
    httpHeaders: rpcHeaders,
  });

  const skrMint = new PublicKey(SEEKER_TOKEN.MINT);
  const treasury = new PublicKey(TREASURY_ADDRESS);

  // 1. Find SKR token account and check balance
  let skrBalance = 0;
  let sourceAta: PublicKey | null = null;
  let tokenProgramId: PublicKey = TOKEN_PROGRAM_ID;
  let decimals = 9;

  console.warn('[revive] step 1/4 — find SKR ATA');
  const t1 = Date.now();
  for (const progId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const ata = await getAssociatedTokenAddress(skrMint, payer, false, progId);
      const info = Capacitor.isNativePlatform()
        ? await reviveNativeGetTokenAccountBalance(heliusRpcUrl, rpcHeaders, ata)
        : await reviveWithTimeout(
            `getTokenAccountBalance(${progId.toBase58().slice(0, 4)})`,
            connection.getTokenAccountBalance(ata),
            8000,
          );
      const bal = Number(info.value.uiAmount ?? 0);
      decimals = info.value.decimals;
      if (bal > 0) {
        skrBalance = bal;
        sourceAta = ata;
        tokenProgramId = progId;
        break;
      }
    } catch (e) {
      // ATA doesn't exist OR timed out
      console.warn('[revive] skr-ata probe issue', (e as Error).message);
    }
  }
  console.warn('[revive] step 1/4 done in', Date.now() - t1, 'ms; balance', skrBalance);

  if (!sourceAta || skrBalance < REVIVE_SKR_AMOUNT) {
    return {
      success: false,
      error: { code: 'INSUFFICIENT_SKR', skrBalance, required: REVIVE_SKR_AMOUNT },
    };
  }

  // 2. Check SOL for fees
  console.warn('[revive] step 2/4 — getBalance');
  const t2 = Date.now();
  const solBalance = Capacitor.isNativePlatform()
    ? await reviveNativeGetBalance(heliusRpcUrl, rpcHeaders, payer)
    : await reviveWithTimeout('getBalance', connection.getBalance(payer), 8000);
  console.warn('[revive] step 2/4 SOL', solBalance, 'lamports in', Date.now() - t2, 'ms');
  const minLamports = Math.round(MIN_SOL_FOR_FEE * LAMPORTS_PER_SOL);
  if (solBalance < minLamports) {
    return {
      success: false,
      error: {
        code: 'INSUFFICIENT_SOL',
        solBalance: solBalance / LAMPORTS_PER_SOL,
        required: MIN_SOL_FOR_FEE,
      },
    };
  }

  const destAta = await getAssociatedTokenAddress(skrMint, treasury, true, tokenProgramId);
  const amount = BigInt(REVIVE_SKR_AMOUNT) * BigInt(10 ** decimals);

  // Only create treasury ATA if it doesn't exist yet (avoids extra instruction in wallet preview)
  let destAtaExists = false;
  if (!Capacitor.isNativePlatform()) {
    try {
      const info = await reviveWithTimeout('getAccountInfo(destAta)', connection.getAccountInfo(destAta), 6000);
      destAtaExists = info !== null;
    } catch (e) {
      console.warn('[revive] dest ATA probe issue', (e as Error).message);
      /* assume missing */
    }
  } else {
    console.warn('[revive] native dest ATA probe skipped (idempotent create is safe)');
  }

  const buildTransaction = async () => {
    // On Capacitor native, use 'confirmed' commitment instead of 'finalized'
    // — finalized RPC calls can hang on Seeker WebView and there's no fallback.
    const commitment: 'finalized' | 'confirmed' = Capacitor.isNativePlatform() ? 'confirmed' : 'finalized';
    const { blockhash, lastValidBlockHeight } = Capacitor.isNativePlatform()
      ? await reviveWithTimeout(
          'native getLatestBlockhash(confirmed)',
          reviveNativeGetLatestBlockhash(heliusRpcUrl, rpcHeaders),
          10_000,
        )
      : await reviveWithTimeout(
          `getLatestBlockhash(${commitment})`,
          connection.getLatestBlockhash(commitment),
          8000,
        );
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: payer });

    if (!destAtaExists) {
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          destAta,
          treasury,
          skrMint,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    }
    tx.add(createTransferInstruction(sourceAta, destAta, payer, amount, [], tokenProgramId));

    // Patch serialize to skip signature verification (same pattern as mint/BlackHole/score)
    const origSerialize = tx.serialize.bind(tx);
    tx.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
      origSerialize({
        ...config,
        requireAllSignatures: false,
        verifySignatures: false,
      })) as typeof tx.serialize;

    return tx;
  };

  const prepareTransaction = async (): Promise<{ tx?: Transaction; error?: ReviveError }> => {
    console.warn('[revive] step 3/4 — buildTransaction');
    const t3 = Date.now();
    const tx = await buildTransaction();
    console.warn('[revive] step 3/4 build done in', Date.now() - t3, 'ms');

    try {
      // dApp Store compliance: every signed transaction attempts simulation
      // before wallet signing. Native RPC is bounded so a WebView stall warns
      // the user but does not prevent the Seed Vault approval flow.
      const sim = await reviveWithTimeout(
        'simulate',
        connection.simulateTransaction(tx, undefined, {
          sigVerify: false,
          replaceRecentBlockhash: true,
        }),
        Capacitor.isNativePlatform() ? NATIVE_PRE_SIGN_SIMULATION_TIMEOUT_MS : 10_000,
      );
      if (sim.value.err) {
        console.error('[revive] simulation failed', sim.value.err, sim.value.logs);
        return { error: { code: 'SIMULATION_FAILED', message: JSON.stringify(sim.value.err) } };
      }
      console.warn('[revive] pre-sign simulation ok');
    } catch (e) {
      console.warn('[revive] Could not pre-flight the transaction', e);
      toast.warning('Could not pre-flight the transaction', {
        description: 'RPC simulation timed out or was unavailable. Review the wallet preview before signing.',
        duration: 8000,
      });
    }

    if (Capacitor.isNativePlatform()) {
      console.warn('[revive] native second blockhash refresh skipped after bounded pre-sign simulate');
      return { tx };
    }

    // Off-native: refresh blockhash right before signing.
    const freshBH = await reviveWithTimeout('getLatestBlockhash(finalized) refresh', connection.getLatestBlockhash('finalized'), 8000);
    tx.recentBlockhash = freshBH.blockhash;
    tx.lastValidBlockHeight = freshBH.lastValidBlockHeight;
    return { tx };
  };

  // 4. Sign and send (with one blockhash-expiry retry)
  try {
    const sendOptions = Capacitor.isNativePlatform()
      ? ({ skipPreflight: true, preflightCommitment: 'confirmed' as const })
      : ({ skipPreflight: false, preflightCommitment: 'finalized' as const });
    let sig: string | null = null;
    let lastSendError: unknown = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const prepared = await prepareTransaction();
      if (prepared.error) {
        return { success: false, error: prepared.error };
      }
      const tx = prepared.tx!;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('USER_REJECTED: Signing timed out')), 120_000),
      );

      try {
        if (reviveWallet.signTransaction) {
          console.warn('[revive] step 4/4 — wallet.signTransaction (popup expected)');
          const t4 = Date.now();
          const signPromise = reviveWallet.signTransaction(tx);
          const signed = await Promise.race([signPromise, timeoutPromise]);
          console.warn('[revive] step 4/4 signed in', Date.now() - t4, 'ms');
          const raw = signed.serialize({ requireAllSignatures: false, verifySignatures: false });
          const localSig = signedTransactionSignature(signed);
          sig = Capacitor.isNativePlatform()
            ? await reviveNativeSendRawTransaction(heliusRpcUrl, rpcHeaders, raw, sendOptions, localSig)
            : await reviveWithTimeout(
                'sendRawTransaction',
                connection.sendRawTransaction(raw, sendOptions),
                30_000,
              );
        } else if (reviveWallet.sendTransaction) {
          sig = (await Promise.race([reviveWallet.sendTransaction(tx, connection, sendOptions), timeoutPromise])) as string;
        } else {
          return { success: false, error: { code: 'UNKNOWN', message: 'Wallet not connected' } };
        }
        break;
      } catch (err) {
        lastSendError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && /blockhash not found|Blockhash not found|block height exceeded|expired/i.test(msg)) {
          console.warn('[revive] retrying with fresh blockhash after stale signing flow', msg);
          continue;
        }
        throw err;
      }
    }

    if (!sig) {
      const msg = lastSendError instanceof Error ? lastSendError.message : String(lastSendError ?? 'Transaction not sent');
      return { success: false, error: { code: 'UNKNOWN', message: msg } };
    }

    const start = Date.now();
    while (Date.now() - start < 30000) {
      const status = await (Capacitor.isNativePlatform()
        ? reviveNativeGetSignatureStatuses(heliusRpcUrl, rpcHeaders, sig)
        : reviveWithTimeout(
            'getSignatureStatuses',
            connection.getSignatureStatuses([sig], { searchTransactionHistory: true }),
            8_000,
          )).catch((error) => {
        console.warn('[revive] signature status poll skipped', error);
        return null;
      });
      const s = status?.value?.[0];
      if (s?.err) {
        return { success: false, error: { code: 'SIMULATION_FAILED', message: JSON.stringify(s.err) } };
      }
      if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
        return { success: true, signature: sig };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { success: true, signature: sig };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isCancel = /reject|cancel|denied|abort|dismiss|decline|user.?reject|4001|USER_REJECTED/i.test(msg);
    if (isCancel) {
      return { success: false, error: { code: 'USER_CANCELLED' } };
    }
    return { success: false, error: { code: 'UNKNOWN', message: msg } };
  }
}

export { REVIVE_SKR_AMOUNT };
