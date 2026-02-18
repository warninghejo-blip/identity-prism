/**
 * On-chain score recording for Orbit Survival via Solana Memo transactions.
 * Players can optionally "commit" their score on-chain after game over.
 * Each score is a signed memo transaction that serves as verifiable proof.
 */

import { WalletContextState } from '@solana/wallet-adapter-react';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { getHeliusRpcUrl } from '@/constants';

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

function getConnection(): Connection {
  const rpcUrl = getHeliusRpcUrl() || 'https://api.mainnet-beta.solana.com';
  return new Connection(rpcUrl, 'confirmed');
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
 * Commit a game score on-chain as a signed memo transaction.
 */
export async function commitScoreOnchain(
  wallet: WalletContextState,
  score: number,
  sessionProof?: SessionProofMemoPayload,
): Promise<CommitScoreResult> {
  if (!wallet.publicKey || (!wallet.sendTransaction && !wallet.signTransaction)) {
    return { success: false, error: 'Wallet not connected' };
  }

  try {
    const connection = getConnection();
    const address = wallet.publicKey.toBase58();
    const memoData = buildMemoData(address, score, sessionProof);

    const memoIx = new TransactionInstruction({
      keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoData, 'utf-8'),
    });

    const tx = new Transaction().add(memoIx);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    // ── Balance preflight — fail early with clear message ──
    const MIN_LAMPORTS_FOR_MEMO = 10_000; // ~0.00001 SOL covers memo fee + buffer
    try {
      const balanceLamports = await connection.getBalance(wallet.publicKey);
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

    // ── Simulate BEFORE prompting user to sign (dApp Store requirement) ──
    try {
      const simulation = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      if (simulation.value.err) {
        console.error('[score] simulation failed', simulation.value.err, simulation.value.logs);
        return { success: false, error: `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}` };
      }
    } catch (simError) {
      if (simError instanceof Error && simError.message.startsWith('Transaction simulation failed')) {
        return { success: false, error: simError.message };
      }
      // Network / RPC errors — log but allow through
      console.warn('[score] simulateTransaction network error', simError);
    }

    // Patch serialize to skip sig verification (same pattern as mint/BlackHole)
    const origSerialize = tx.serialize.bind(tx);
    tx.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
      origSerialize({
        ...config,
        requireAllSignatures: false,
        verifySignatures: false,
      })) as typeof tx.serialize;

    // Sign & send — prefer signTransaction + sendRaw, fallback to sendTransaction (MWA)
    let txSignature: string;
    if (wallet.signTransaction) {
      const signed = await wallet.signTransaction(tx);
      txSignature = await connection.sendRawTransaction(
        signed.serialize({ requireAllSignatures: false, verifySignatures: false }),
        { skipPreflight: true, preflightCommitment: 'confirmed' },
      );
    } else if (wallet.sendTransaction) {
      txSignature = await wallet.sendTransaction(tx, connection);
    } else {
      return { success: false, error: 'Wallet does not support transaction signing' };
    }

    await connection.confirmTransaction(
      { signature: txSignature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    const entry: OnchainScore = {
      address,
      score,
      timestamp: new Date().toISOString(),
      txSignature,
      confirmed: true,
    };
    saveOnchainScore(entry);

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
      (e) => e.address === entry.address && e.score === entry.score,
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
