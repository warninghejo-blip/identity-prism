import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export type UnknownTokenResolution = {
  mint: string;
  name: string;
  symbol?: string;
  image?: string;
  source: 'cache' | 'jupiter' | 'registry' | 'fallback';
};

const UNKNOWN_TOKEN_CACHE_KEY = 'identity-prism:unknown-token-resolver:v1';
const UNKNOWN_TOKEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let jupiterTokenListPromise: Promise<Map<string, UnknownTokenResolution>> | null = null;

const readUnknownTokenCache = () => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UNKNOWN_TOKEN_CACHE_KEY) || '{}') as {
      timestamp?: number;
      assets?: Record<string, UnknownTokenResolution>;
    };
    if (!parsed.timestamp || Date.now() - parsed.timestamp > UNKNOWN_TOKEN_CACHE_TTL_MS) return {};
    return parsed.assets ?? {};
  } catch {
    return {};
  }
};

const writeUnknownTokenCache = (assets: Record<string, UnknownTokenResolution>) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UNKNOWN_TOKEN_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), assets }));
  } catch {
    /* ignore cache write failures */
  }
};

const getJupiterTokenList = async () => {
  if (jupiterTokenListPromise) return jupiterTokenListPromise;
  jupiterTokenListPromise = (async () => {
    const response = await fetch('https://token.jup.ag/all');
    if (!response.ok) throw new Error(`Jupiter token list failed: ${response.status}`);
    const list = (await response.json()) as Array<{ address?: string; name?: string; symbol?: string; logoURI?: string }>;
    const map = new Map<string, UnknownTokenResolution>();
    list.forEach((token) => {
      if (!token.address) return;
      map.set(token.address, {
        mint: token.address,
        name: token.name || token.symbol || `Token ${token.address.slice(0, 4)}...`,
        symbol: token.symbol,
        image: token.logoURI,
        source: 'jupiter',
      });
    });
    return map;
  })();
  return jupiterTokenListPromise;
};

export async function resolveUnknownToken(mint: string): Promise<UnknownTokenResolution> {
  const cache = readUnknownTokenCache();
  const cached = cache[mint];
  if (cached) return { ...cached, source: 'cache' };

  try {
    const jupiter = await getJupiterTokenList();
    const match = jupiter.get(mint);
    if (match) {
      writeUnknownTokenCache({ ...cache, [mint]: match });
      return match;
    }
  } catch {
    /* registry fallback below */
  }

  try {
    const response = await fetch('https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json');
    if (response.ok) {
      const registry = (await response.json()) as { tokens?: Array<{ address?: string; name?: string; symbol?: string; logoURI?: string }> };
      const token = registry.tokens?.find((entry) => entry.address === mint);
      if (token?.address) {
        const resolved: UnknownTokenResolution = {
          mint,
          name: token.name || token.symbol || `Token ${mint.slice(0, 4)}...`,
          symbol: token.symbol,
          image: token.logoURI,
          source: 'registry',
        };
        writeUnknownTokenCache({ ...cache, [mint]: resolved });
        return resolved;
      }
    }
  } catch {
    /* fallback below */
  }

  const fallback: UnknownTokenResolution = {
    mint,
    name: `Token ${mint.slice(0, 4)}...`,
    source: 'fallback',
  };
  writeUnknownTokenCache({ ...cache, [mint]: fallback });
  return fallback;
}

export async function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): Promise<PublicKey> {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
    throw new Error('Token owner is off curve');
  }
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId,
  );
  return address;
}

export function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: associatedTokenProgramId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array(),
  });
}

export function createAssociatedTokenAccountIdempotentInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const instruction = createAssociatedTokenAccountInstruction(
    payer,
    associatedToken,
    owner,
    mint,
    programId,
    associatedTokenProgramId,
  );
  instruction.data = new Uint8Array([1]);
  return instruction;
}

function amountInstructionData(instruction: number, amount: bigint | number): Uint8Array {
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  data[0] = instruction;
  view.setBigUint64(1, BigInt(amount), true);
  return data;
}

function ownerKeys(owner: PublicKey, multiSigners: PublicKey[] = []) {
  const signers = multiSigners ?? [];
  return [
    { pubkey: owner, isSigner: signers.length === 0, isWritable: false },
    ...signers.map((pubkey) => ({ pubkey, isSigner: true, isWritable: false })),
  ];
}

export function createTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint | number,
  multiSigners: PublicKey[] = [],
  programId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const signers = multiSigners ?? [];
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      ...ownerKeys(owner, signers),
    ],
    data: amountInstructionData(3, amount),
  });
}

export function createBurnInstruction(
  account: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint | number,
  multiSigners: PublicKey[] = [],
  programId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const signers = multiSigners ?? [];
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      ...ownerKeys(owner, signers),
    ],
    data: amountInstructionData(8, amount),
  });
}

export function createCloseAccountInstruction(
  account: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  multiSigners: PublicKey[] = [],
  programId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const signers = multiSigners ?? [];
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      ...ownerKeys(owner, signers),
    ],
    data: new Uint8Array([9]),
  });
}

export function createTransferCheckedInstruction(
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint | number,
  decimals: number,
  multiSigners: PublicKey[] = [],
  programId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const signers = multiSigners ?? [];
  const data = new Uint8Array(10);
  const view = new DataView(data.buffer);
  data[0] = 12;
  view.setBigUint64(1, BigInt(amount), true);
  data[9] = decimals;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: signers.length === 0, isWritable: false },
      ...signers.map((pubkey) => ({ pubkey, isSigner: true, isWritable: false })),
    ],
    data,
  });
}
