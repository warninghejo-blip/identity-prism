/**
 * On-chain score recording for Orbit Survival via Solana Memo transactions.
 * Players can optionally "commit" their score on-chain after game over.
 * Each score is a signed memo transaction that serves as verifiable proof.
 */

import { WalletContextState } from '@solana/wallet-adapter-react';
import { Capacitor } from '@capacitor/core';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { getHeliusProxyHeaders, getHeliusRpcUrl } from '@/constants';
import { SeedVaultAdapter } from '@/lib/SeedVaultAdapter';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const LEADERBOARD_STORAGE_KEY = 'orbit_survival_onchain_scores_v1';

export interface OnchainScore {
  address: string;
  score: number;
  timestamp: string;
  txSignature: string;
  confirmed: boolean;
}

export interface CommitScoreResult {
  success: boolean;
  txSignature?: string;
  explorerUrl?: string;
  error?: string;
}

export interface SessionProofMemoPayload {
  sessionId: string;
  sessionHash: string;
  sessionSeed: string;
  sessionSlot: number;
}

type ScoreWallet = Pick<WalletContextState, 'publicKey' | 'signTransaction' | 'sendTransaction'>;

async function resolveScoreWallet(wallet: WalletContextState, expectedAddress?: string): Promise<ScoreWallet | null> {
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
    signTransaction: seedVault.signTransaction.bind(seedVault) as ScoreWallet['signTransaction'],
    sendTransaction: undefined,
  };
}

function getConnection(address?: string): Connection {
  const rpcUrl = getHeliusRpcUrl() || 'https://api.mainnet-beta.solana.com';
  return new Connection(rpcUrl, {
    commitment: 'confirmed',
    httpHeaders: getHeliusProxyHeaders(address),
  });
}

function buildMemoData(address: string, score: number, sessionProof?: SessionProofMemoPayload): string {
  const payload: Record<string, unknown> = {
    app: 'IdentityPrism:OrbitSurvival',
    v: 2,
    addr: address,
    score,
    ts: Date.now(),
  };
  if (sessionProof) {
    payload.session = {
      id: sessionProof.sessionId,
      hash: sessionProof.sessionHash,
      seed: sessionProof.sessionSeed,
      slot: sessionProof.sessionSlot,
    };
  }
  return JSON.stringify(payload);
}

/**
 * Poll-based transaction confirmation using HTTP (getSignatureStatuses).
 * Unlike connection.confirmTransaction() which relies on WebSocket subscriptions
 * (unreliable on mobile/Capacitor), this polls via standard HTTP requests.
 */
async function pollForConfirmation(
  connection: Connection,
  signature: string,
  maxAttempts = 12,
  intervalMs = 2500,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { value } = await connection.getSignatureStatuses([signature]);
      const status = value?.[0];
      if (status) {
        if (status.err) {
          console.error('[score] tx failed on-chain:', status.err);
          return false;
        }
        // confirmed or finalized
        if (
          status.confirmationStatus === 'confirmed' ||
          status.confirmationStatus === 'finalized'
        ) {
          console.log('[score] tx confirmed:', status.confirmationStatus);
          return true;
        }
      }
    } catch (e) {
      console.warn('[score] poll attempt', attempt, 'error:', e);
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return false;
}

/**
 * Commit a game score on-chain as a signed memo transaction.
 */
export async function commitScoreOnchain(
  wallet: WalletContextState,
  score: number,
  sessionProof?: SessionProofMemoPayload,
  expectedAddress?: string,
): Promise<CommitScoreResult> {
  let scoreWallet: ScoreWallet | null = null;
  try {
    scoreWallet = await resolveScoreWallet(wallet, expectedAddress);
  } catch (err: any) {
    const message = err?.message || 'Wallet not connected';
    if (/reject|cancel|denied|abort|dismiss|decline|user.?reject|4001|USER_REJECTED/i.test(message)) {
      return { success: false, error: 'Transaction cancelled by user' };
    }
    return { success: false, error: message };
  }

  if (!scoreWallet?.publicKey || (!scoreWallet.sendTransaction && !scoreWallet.signTransaction)) {
    return { success: false, error: 'Wallet not connected' };
  }

  try {
    const address = scoreWallet.publicKey.toBase58();
    const connection = getConnection(address);
    const memoData = buildMemoData(address, score, sessionProof);

    const memoIx = new TransactionInstruction({
      keys: [{ pubkey: scoreWallet.publicKey, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: new TextEncoder().encode(memoData),
    });

    // ── Balance preflight — fail early with clear message ──
    const MIN_LAMPORTS_FOR_MEMO = 10_000; // ~0.00001 SOL covers memo fee + buffer
    try {
      const balanceLamports = await connection.getBalance(scoreWallet.publicKey);
      if (balanceLamports < MIN_LAMPORTS_FOR_MEMO) {
        const balanceSol = (balanceLamports / LAMPORTS_PER_SOL).toFixed(6);
        const requiredSol = (MIN_LAMPORTS_FOR_MEMO / LAMPORTS_PER_SOL).toFixed(6);
        return {
          success: false,
          error: `INSUFFICIENT_FUNDS:Insufficient SOL for transaction fee. Balance: ${balanceSol} SOL, need ~${requiredSol} SOL.`,
        };
      }
    } catch (balErr) {
      console.warn('[score] balance check failed', balErr);
    }

    const buildTransaction = async () => {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
      const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: scoreWallet!.publicKey! }).add(memoIx);

      // Patch serialize to skip sig verification (same pattern as mint/BlackHole/revive)
      const origSerialize = tx.serialize.bind(tx);
      tx.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
        origSerialize({
          ...config,
          requireAllSignatures: false,
          verifySignatures: false,
        })) as typeof tx.serialize;

      return tx;
    };

    // ── Simulate BEFORE prompting user to sign (dApp Store requirement) ──
    const prepareTransaction = async () => {
      const tx = await buildTransaction();
      try {
        const simulation = await connection.simulateTransaction(tx, undefined, {
          sigVerify: false,
          replaceRecentBlockhash: true,
        });
        if (simulation.value.err) {
          console.error('[score] simulation failed', simulation.value.err, simulation.value.logs);
          return { error: `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}` };
        }
      } catch (simError) {
        if (simError instanceof Error && simError.message.startsWith('Transaction simulation failed')) {
          return { error: simError.message };
        }
        console.warn('[score] simulateTransaction network error', simError);
      }

      const freshBH = await connection.getLatestBlockhash('finalized');
      tx.recentBlockhash = freshBH.blockhash;
      tx.lastValidBlockHeight = freshBH.lastValidBlockHeight;
      return { tx };
    };

    // ── Sign & send (with timeout and one stale-blockhash retry) ──
    let txSignature: string | null = null;
    const signTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('User rejected the request.')), 120_000)
    );

    for (let attempt = 0; attempt < 2; attempt++) {
      const prepared = await prepareTransaction();
      if (prepared.error) return { success: false, error: prepared.error };
      const tx = prepared.tx!;

      try {
        if (scoreWallet.signTransaction) {
          const signed = await Promise.race([scoreWallet.signTransaction(tx), signTimeout]);
          txSignature = await connection.sendRawTransaction(
            signed.serialize({ requireAllSignatures: false, verifySignatures: false }),
            { skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 3 },
          );
        } else if (scoreWallet.sendTransaction) {
          txSignature = (await Promise.race([
            scoreWallet.sendTransaction(tx, connection, {
              skipPreflight: false,
              preflightCommitment: 'finalized',
              maxRetries: 3,
            }),
            signTimeout,
          ])) as string;
        } else {
          return { success: false, error: 'Wallet does not support transaction signing' };
        }
        break;
      } catch (sendErr: any) {
        const message = sendErr?.message || String(sendErr);
        if (attempt === 0 && /blockhash not found|Blockhash not found|block height exceeded|expired/i.test(message)) {
          console.warn('[score] retrying with fresh blockhash after stale signing flow', message);
          continue;
        }
        throw sendErr;
      }
    }

    if (!txSignature) {
      return { success: false, error: 'Transaction not sent' };
    }

    console.log('[score] tx sent:', txSignature);

    // ── Save optimistically right after send succeeds ──
    // Memo txs are near-guaranteed to land once accepted by the RPC node.
    const entry: OnchainScore = {
      address,
      score,
      timestamp: new Date().toISOString(),
      txSignature,
      confirmed: false,
    };
    saveOnchainScore(entry);

    // ── Confirm via HTTP polling (NOT WebSocket — WebSocket is broken on mobile) ──
    // Poll getSignatureStatuses every 2.5s for up to 30s
    const confirmed = await pollForConfirmation(connection, txSignature, 12, 2500);
    if (confirmed) {
      entry.confirmed = true;
      saveOnchainScore(entry);
    } else {
      // Transaction was sent but confirmation timed out.
      // This does NOT mean it failed — it's likely still processing.
      // We already saved it optimistically, so return success with the signature.
      console.warn('[score] confirmation poll timed out, but tx was sent successfully');
    }

    const explorerUrl = `https://solscan.io/tx/${txSignature}`;
    return { success: true, txSignature, explorerUrl };
  } catch (err: any) {
    const message = err?.message || 'Transaction failed';
    if (message.includes('User rejected') || message.includes('rejected')) {
      return { success: false, error: 'Transaction cancelled by user' };
    }
    return { success: false, error: message };
  }
}

/**
 * Read locally cached on-chain scores.
 */
export function getOnchainScores(): OnchainScore[] {
  try {
    const raw = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OnchainScore[];
  } catch {
    return [];
  }
}

function saveOnchainScore(entry: OnchainScore) {
  try {
    const existing = getOnchainScores();
    const idx = existing.findIndex(
      (e) => e.txSignature && e.txSignature === entry.txSignature,
    );
    if (idx !== -1) {
      existing[idx] = entry;
    } else {
      existing.push(entry);
    }
    existing.sort((a, b) => b.score - a.score);
    const trimmed = existing.slice(0, 50);
    localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* silent */
  }
}

/**
 * Get explorer URL for a transaction signature.
 */
export function getExplorerUrl(txSignature: string): string {
  return `https://solscan.io/tx/${txSignature}`;
}

/**
 * Очки для отображения (используется как score).
 */
export function calculateRewardCredits(score: number): number {
  return score;
}

/**
 * Get rank label for display (no fixed rewards — топ будет награждён токеном).
 */
export function getRankReward(rank: number): { tokens: number; label: string } {
  if (rank === 1) return { tokens: 0, label: '1st Place' };
  if (rank === 2) return { tokens: 0, label: '2nd Place' };
  if (rank === 3) return { tokens: 0, label: '3rd Place' };
  if (rank <= 5) return { tokens: 0, label: 'Top 5' };
  if (rank <= 10) return { tokens: 0, label: 'Top 10' };
  if (rank <= 20) return { tokens: 0, label: 'Top 20' };
  return { tokens: 0, label: 'Participant' };
}
