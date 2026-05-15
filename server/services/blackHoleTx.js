import { PublicKey } from '@solana/web3.js';

const JUPITER_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

function normalizePubkey(value) {
  try {
    return new PublicKey(String(value)).toBase58();
  } catch {
    return null;
  }
}

function getParsedAccountKeyString(key) {
  if (!key) return null;
  if (typeof key === 'string') return normalizePubkey(key) || key;
  if (typeof key?.pubkey === 'string') return normalizePubkey(key.pubkey) || key.pubkey;
  if (key?.pubkey && typeof key.pubkey.toBase58 === 'function') return key.pubkey.toBase58();
  if (typeof key.toBase58 === 'function') return key.toBase58();
  return null;
}

function getParsedInstructionProgramId(ix) {
  if (!ix?.programId) return '';
  return typeof ix.programId === 'string'
    ? ix.programId
    : ix.programId?.toBase58?.() || ix.programId?.toString?.() || '';
}

function getParsedTxKeys(tx) {
  return Array.isArray(tx?.transaction?.message?.accountKeys) ? tx.transaction.message.accountKeys : [];
}

function getParsedTxInstructions(tx) {
  const outer = Array.isArray(tx?.transaction?.message?.instructions)
    ? tx.transaction.message.instructions
    : [];
  const inner = Array.isArray(tx?.meta?.innerInstructions)
    ? tx.meta.innerInstructions.flatMap((entry) => (Array.isArray(entry?.instructions) ? entry.instructions : []))
    : [];
  return [...outer, ...inner];
}

function findTokenBalanceEntry(tx, account, mint) {
  const accountKeys = getParsedTxKeys(tx);
  const allBalances = [...(tx?.meta?.preTokenBalances || []), ...(tx?.meta?.postTokenBalances || [])];
  return (
    allBalances.find((entry) => {
      const key = accountKeys[entry.accountIndex];
      return getParsedAccountKeyString(key) === account && (!mint || entry.mint === mint);
    }) || null
  );
}

function getTokenAmountRaw(entry) {
  if (!entry?.uiTokenAmount) return null;
  const raw = entry.uiTokenAmount.amount;
  return raw == null ? null : BigInt(raw);
}

function isParsedTokenInstruction(ix, tokenProgramKeyString, token2022ProgramKeyString, types) {
  if (!ix?.parsed || !types.includes(ix.parsed.type)) return false;
  const programId = getParsedInstructionProgramId(ix);
  return programId === tokenProgramKeyString || programId === token2022ProgramKeyString;
}

function inferBlackHoleAssetKind(tx, account, mint) {
  const entry = findTokenBalanceEntry(tx, account, mint);
  if (!entry?.uiTokenAmount) return 'fungible';
  const decimals = Number(entry.uiTokenAmount.decimals || 0);
  const amountRaw = getTokenAmountRaw(entry);
  return decimals === 0 && amountRaw === 1n ? 'nft' : 'fungible';
}

function getWalletLamportDelta(tx, address) {
  const accountKeys = getParsedTxKeys(tx);
  const index = accountKeys.findIndex((key) => getParsedAccountKeyString(key) === address);
  if (index < 0) return 0;
  const pre = tx?.meta?.preBalances?.[index] || 0;
  const post = tx?.meta?.postBalances?.[index] || 0;
  return post - pre;
}

function verifyCloseOperationTx(tx, address, account, tokenProgramKeyString, token2022ProgramKeyString) {
  if (!tx?.meta || tx.meta.err) return false;
  const keys = getParsedTxKeys(tx);
  if (!keys.some((key) => getParsedAccountKeyString(key) === address)) return false;
  return getParsedTxInstructions(tx).some((ix) => {
    if (!isParsedTokenInstruction(ix, tokenProgramKeyString, token2022ProgramKeyString, ['closeAccount'])) return false;
    const info = ix.parsed.info || {};
    return (
      normalizePubkey(info.account) === account &&
      normalizePubkey(info.destination) === address &&
      normalizePubkey(info.owner) === address
    );
  });
}

function verifyBurnOperationTx(tx, address, account, mint, tokenProgramKeyString, token2022ProgramKeyString) {
  if (!verifyCloseOperationTx(tx, address, account, tokenProgramKeyString, token2022ProgramKeyString)) return false;
  return getParsedTxInstructions(tx).some((ix) => {
    if (!isParsedTokenInstruction(ix, tokenProgramKeyString, token2022ProgramKeyString, ['burn', 'burnChecked'])) return false;
    const info = ix.parsed.info || {};
    return normalizePubkey(info.account) === account && normalizePubkey(info.authority) === address && info.mint === mint;
  });
}

function verifySwapOperationTx(tx, address, account, mint) {
  if (!tx?.meta || tx.meta.err) return false;
  const accountKeys = getParsedTxKeys(tx);
  if (!accountKeys.some((key) => getParsedAccountKeyString(key) === address)) return false;
  if (!accountKeys.some((key) => getParsedAccountKeyString(key) === JUPITER_PROGRAM_ID)) return false;
  const entry = findTokenBalanceEntry(tx, account, mint);
  const postEntry = (tx?.meta?.postTokenBalances || []).find((balance) => {
    const key = accountKeys[balance.accountIndex];
    return getParsedAccountKeyString(key) === account && balance.mint === mint;
  });
  const preAmount = getTokenAmountRaw(entry);
  const postAmount = getTokenAmountRaw(postEntry);
  return preAmount !== null && preAmount > 0n && (!postEntry || postAmount === 0n);
}

function getClosedAccountLamports(tx, address, tokenProgramKeyString, token2022ProgramKeyString) {
  if (!tx?.meta) return 0;
  const keys = getParsedTxKeys(tx);
  const preBalances = Array.isArray(tx.meta.preBalances) ? tx.meta.preBalances : [];
  let total = 0;
  for (const ix of getParsedTxInstructions(tx)) {
    if (!isParsedTokenInstruction(ix, tokenProgramKeyString, token2022ProgramKeyString, ['closeAccount'])) continue;
    const info = ix.parsed.info || {};
    if (normalizePubkey(info.destination) !== address || normalizePubkey(info.owner) !== address) continue;
    const account = normalizePubkey(info.account);
    const accountIndex = keys.findIndex((key) => getParsedAccountKeyString(key) === account);
    if (accountIndex >= 0) total += Number(preBalances[accountIndex] || 0);
  }
  return total;
}

function createBlackHoleTxVerifier({
  treasuryAddress,
  tokenProgramKeyString,
  token2022ProgramKeyString,
}) {
  function verifyClose(tx, address, account) {
    return verifyCloseOperationTx(tx, address, account, tokenProgramKeyString, token2022ProgramKeyString);
  }

  function verifyBurn(tx, address, account, mint) {
    return verifyBurnOperationTx(tx, address, account, mint, tokenProgramKeyString, token2022ProgramKeyString);
  }

  function verifyCommission(tx, address, commissionRate) {
    if (!tx?.meta || tx.meta.err) return false;
    const normalizedAddress = normalizePubkey(address);
    const normalizedTreasuryAddress = normalizePubkey(treasuryAddress);
    if (!normalizedAddress || !normalizedTreasuryAddress) return false;
    if (normalizedAddress === normalizedTreasuryAddress) return true;
    const chunkLamports = getClosedAccountLamports(tx, normalizedAddress, tokenProgramKeyString, token2022ProgramKeyString);
    if (chunkLamports <= 0) return true;
    const requiredCommissionLamports = Math.round(chunkLamports * commissionRate);
    if (requiredCommissionLamports <= 0) return true;

    let transferredLamports = 0;
    for (const ix of tx.transaction?.message?.instructions || []) {
      if (!ix?.parsed || ix.parsed.type !== 'transfer') continue;
      const info = ix.parsed.info || {};
      if (normalizePubkey(info.source) !== normalizedAddress || normalizePubkey(info.destination) !== normalizedTreasuryAddress) continue;
      transferredLamports += Number(info.lamports) || 0;
    }
    return transferredLamports >= requiredCommissionLamports;
  }

  return {
    inferBlackHoleAssetKind,
    getWalletLamportDelta,
    verifyBlackHoleCommissionTx: verifyCommission,
    verifyCloseOperationTx: verifyClose,
    verifyBurnOperationTx: verifyBurn,
    verifySwapOperationTx,
  };
}

export { createBlackHoleTxVerifier };
