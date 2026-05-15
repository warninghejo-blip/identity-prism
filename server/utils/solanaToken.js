import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export async function getAssociatedTokenAddress(
  mint,
  owner,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
) {
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
  payer,
  associatedToken,
  owner,
  mint,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
) {
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
    data: Buffer.alloc(0),
  });
}

export function createTransferCheckedInstruction(
  source,
  mint,
  destination,
  owner,
  amount,
  decimals,
  multiSigners = [],
  programId = TOKEN_PROGRAM_ID,
) {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(BigInt(amount), 1);
  data.writeUInt8(decimals, 9);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: multiSigners.length === 0, isWritable: false },
      ...multiSigners.map((signer) => ({ pubkey: signer.publicKey ?? signer, isSigner: true, isWritable: false })),
    ],
    data,
  });
}

export async function getMint(connection, address, commitment, programId = TOKEN_PROGRAM_ID) {
  const accountInfo = await connection.getAccountInfo(address, commitment);
  if (!accountInfo) throw new Error('Mint account not found');
  if (!accountInfo.owner.equals(programId)) throw new Error('Mint account owner mismatch');
  if (!accountInfo.data || accountInfo.data.length < 82) throw new Error('Invalid mint account data');
  const data = accountInfo.data;
  return {
    address,
    mintAuthority: data.readUInt32LE(0) === 0 ? null : new PublicKey(data.subarray(4, 36)),
    supply: data.readBigUInt64LE(36),
    decimals: data.readUInt8(44),
    isInitialized: data.readUInt8(45) !== 0,
    freezeAuthority: data.readUInt32LE(46) === 0 ? null : new PublicKey(data.subarray(50, 82)),
  };
}
