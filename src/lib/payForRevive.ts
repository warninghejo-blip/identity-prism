import { WalletContextState } from '@solana/wallet-adapter-react';
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

const REVIVE_SKR_AMOUNT = 5;
const MIN_SOL_FOR_FEE = 0.003;

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

export async function payForRevive(wallet: WalletContextState): Promise<ReviveResult> {
  if (!wallet.publicKey || (!wallet.signTransaction && !wallet.sendTransaction)) {
    return { success: false, error: { code: 'UNKNOWN', message: 'Wallet not connected' } };
  }

  const payer = wallet.publicKey;
  const address = payer.toBase58();
  const heliusRpcUrl = getHeliusRpcUrl(address);
  if (!heliusRpcUrl) {
    return { success: false, error: { code: 'UNKNOWN', message: 'RPC not configured' } };
  }

  const connection = new Connection(heliusRpcUrl, {
    commitment: 'confirmed',
    httpHeaders: getHeliusProxyHeaders(address),
  });

  const skrMint = new PublicKey(SEEKER_TOKEN.MINT);
  const treasury = new PublicKey(TREASURY_ADDRESS);

  // 1. Find SKR token account and check balance
  let skrBalance = 0;
  let sourceAta: PublicKey | null = null;
  let tokenProgramId: PublicKey = TOKEN_PROGRAM_ID;
  let decimals = 9;

  for (const progId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const ata = await getAssociatedTokenAddress(skrMint, payer, false, progId);
      const info = await connection.getTokenAccountBalance(ata);
      const bal = Number(info.value.uiAmount ?? 0);
      decimals = info.value.decimals;
      if (bal > 0) {
        skrBalance = bal;
        sourceAta = ata;
        tokenProgramId = progId;
        break;
      }
    } catch {
      // ATA doesn't exist under this program
    }
  }

  if (!sourceAta || skrBalance < REVIVE_SKR_AMOUNT) {
    return {
      success: false,
      error: { code: 'INSUFFICIENT_SKR', skrBalance, required: REVIVE_SKR_AMOUNT },
    };
  }

  // 2. Check SOL for fees
  const solBalance = await connection.getBalance(payer);
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

  // 3. Build transaction
  const destAta = await getAssociatedTokenAddress(skrMint, treasury, true, tokenProgramId);
  const amount = BigInt(REVIVE_SKR_AMOUNT) * BigInt(10 ** decimals);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: payer });

  // Only create treasury ATA if it doesn't exist yet (avoids extra instruction in wallet preview)
  let destAtaExists = false;
  try {
    const info = await connection.getAccountInfo(destAta);
    destAtaExists = info !== null;
  } catch {
    /* assume missing */
  }
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

  // 4. Simulate before prompting user to sign (dApp Store requirement)
  try {
    const sim = await connection.simulateTransaction(tx, undefined, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    if (sim.value.err) {
      console.error('[revive] simulation failed', sim.value.err, sim.value.logs);
      return {
        success: false,
        error: { code: 'SIMULATION_FAILED', message: JSON.stringify(sim.value.err) },
      };
    }
  } catch (e) {
    console.warn('[revive] simulation skip', e);
  }

  // 5. Refresh blockhash right before signing — minimises expiry on MWA
  const freshBH = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = freshBH.blockhash;
  tx.lastValidBlockHeight = freshBH.lastValidBlockHeight;

  // Patch serialize to skip signature verification (same pattern as mint/BlackHole/score)
  const origSerialize = tx.serialize.bind(tx);
  tx.serialize = ((config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) =>
    origSerialize({
      ...config,
      requireAllSignatures: false,
      verifySignatures: false,
    })) as typeof tx.serialize;

  // 6. Sign and send (with timeout)
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('USER_REJECTED: Signing timed out')), 120_000),
    );
    const sendOptions = { skipPreflight: true, preflightCommitment: 'confirmed' as const };
    let sig: string;
    if (wallet.signTransaction) {
      const signPromise = wallet.signTransaction(tx);
      const signed = await Promise.race([signPromise, timeoutPromise]);
      sig = await connection.sendRawTransaction(
        signed.serialize({ requireAllSignatures: false, verifySignatures: false }),
        { skipPreflight: true },
      );
    } else if (wallet.sendTransaction) {
      sig = (await Promise.race([wallet.sendTransaction(tx, connection, sendOptions), timeoutPromise])) as string;
    } else {
      return { success: false, error: { code: 'UNKNOWN', message: 'Wallet not connected' } };
    }
    const start = Date.now();
    while (Date.now() - start < 30000) {
      const status = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
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
