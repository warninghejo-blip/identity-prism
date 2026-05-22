import { WalletContextState } from '@solana/wallet-adapter-react';
import { Capacitor } from '@capacitor/core';
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

  const destAta = await getAssociatedTokenAddress(skrMint, treasury, true, tokenProgramId);
  const amount = BigInt(REVIVE_SKR_AMOUNT) * BigInt(10 ** decimals);

  // Only create treasury ATA if it doesn't exist yet (avoids extra instruction in wallet preview)
  let destAtaExists = false;
  try {
    const info = await connection.getAccountInfo(destAta);
    destAtaExists = info !== null;
  } catch {
    /* assume missing */
  }

  const buildTransaction = async () => {
    // Use finalized blockhashes: mobile signing can return through a different RPC
    // backend than the one that served a fresh confirmed blockhash.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
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
    const tx = await buildTransaction();

    // Simulate before prompting user to sign (dApp Store requirement)
    try {
      const sim = await connection.simulateTransaction(tx, undefined, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      if (sim.value.err) {
        console.error('[revive] simulation failed', sim.value.err, sim.value.logs);
        return { error: { code: 'SIMULATION_FAILED', message: JSON.stringify(sim.value.err) } };
      }
    } catch (e) {
      console.warn('[revive] simulation skip', e);
    }

    // Refresh blockhash right before signing. If the native approval takes too long,
    // sendRawTransaction below retries once with a freshly rebuilt transaction.
    const freshBH = await connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = freshBH.blockhash;
    tx.lastValidBlockHeight = freshBH.lastValidBlockHeight;
    return { tx };
  };

  // 4. Sign and send (with one blockhash-expiry retry)
  try {
    const sendOptions = { skipPreflight: false, preflightCommitment: 'finalized' as const };
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
          const signPromise = reviveWallet.signTransaction(tx);
          const signed = await Promise.race([signPromise, timeoutPromise]);
          sig = await connection.sendRawTransaction(
            signed.serialize({ requireAllSignatures: false, verifySignatures: false }),
            sendOptions,
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
