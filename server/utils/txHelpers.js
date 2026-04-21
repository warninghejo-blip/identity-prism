const PROGRAM_ADDRESSES = new Set([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'ComputeBudget111111111111111111111111111111',
  'Vote111111111111111111111111111111111111111',
  'Stake11111111111111111111111111111111111111',
  'Config1111111111111111111111111111111111111',
  'BPFLoader2111111111111111111111111111111111',
  'BPFLoaderUpgradeab1e11111111111111111111111',
  'NativeLoader1111111111111111111111111111111',
  'Sysvar1111111111111111111111111111111111111',
  'SysvarRent111111111111111111111111111111111',
  'SysvarC1ock11111111111111111111111111111111',
  'SysvarS1otHashes111111111111111111111111111',
  'SysvarStakeHistory1111111111111111111111111',
  'SysvarRecentB1telephones11111111111111111111',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJBfCR6MNB7C3EUkApJBswJaqzS6vQRHJph4',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  'auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcPX7H',
  'JUP3jqKEFnJHTnQ9pP1bTJjrm3W9RWoWTxJoQGMGifDN',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  '27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',
  'So1endDq2YkqhipRh3WViPa8hFvz0XP1MXF1VZU8Q4Mw',
  'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',
  'mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68',
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY',
  'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1',
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',
  'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
]);

const TX_TYPE_PROGRAMS = {
  defi: new Set([
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcPX7H',
    'JUP3jqKEFnJHTnQ9pP1bTJjrm3W9RWoWTxJoQGMGifDN',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
    'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1',
    'So1endDq2YkqhipRh3WViPa8hFvz0XP1MXF1VZU8Q4Mw',
    'mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68',
    'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY',
    'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',
    'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
    'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
    'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',
  ]),
  nft: new Set([
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
    'auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg',
    'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN',
    'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K',
    'hausS13jsjafwWwGqZTUQRmWyvyxn9EQpqMwV1PBBmk',
    'CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz',
  ]),
  staking: new Set([
    'Stake11111111111111111111111111111111111111',
    'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy',
    'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',
  ]),
};

function isProgramAddress(addr, txProgramIds) {
  if (PROGRAM_ADDRESSES.has(addr)) return true;
  if (txProgramIds && txProgramIds.has(addr)) return true;
  if (addr.startsWith('Sysvar')) return true;
  return false;
}

function classifyTxType(txProgramIdSet) {
  const types = new Set();
  for (const pid of txProgramIdSet) {
    if (TX_TYPE_PROGRAMS.defi.has(pid)) types.add('defi');
    if (TX_TYPE_PROGRAMS.nft.has(pid)) types.add('nft');
    if (TX_TYPE_PROGRAMS.staking.has(pid)) types.add('staking');
  }
  if (types.size === 0) types.add('transfer');
  return [...types];
}

function resolveAccountKey(accKey) {
  if (typeof accKey === 'string') return accKey;
  if (!accKey) return '';
  if (accKey.pubkey?.toBase58) return accKey.pubkey.toBase58();
  if (typeof accKey.pubkey === 'string') return accKey.pubkey;
  return '';
}

function extractSolTransfers(parsed, targetAddress, treasuryWallets) {
  const incoming = new Map();
  const outgoing = new Map();
  const programIds = new Set();

  for (const tx of parsed) {
    if (!tx?.meta || !tx?.transaction) continue;
    if (tx.meta.err) continue;
    const blockTime = tx.blockTime ? tx.blockTime * 1000 : Date.now();

    const txProgramIds = new Set();
    const ixs = tx.transaction.message?.instructions || [];
    for (const ix of ixs) {
      if (ix.programId) {
        const pid = typeof ix.programId === 'string' ? ix.programId : (ix.programId?.toBase58?.() || ix.programId?.toString?.() || '');
        if (pid) {
          txProgramIds.add(pid);
          programIds.add(pid);
        }
      }
    }
    const innerIxs = tx.meta.innerInstructions || [];
    for (const inner of innerIxs) {
      for (const iix of inner.instructions || []) {
        if (iix.programId) {
          const pid = typeof iix.programId === 'string' ? iix.programId : (iix.programId?.toBase58?.() || iix.programId?.toString?.() || '');
          if (pid) {
            txProgramIds.add(pid);
            programIds.add(pid);
          }
        }
      }
    }

    const accounts = tx.transaction.message?.accountKeys || [];
    const pre = tx.meta.preBalances || [];
    const post = tx.meta.postBalances || [];

    const signerAddresses = new Set();
    for (const acc of accounts) {
      if (typeof acc === 'object' && acc?.signer) {
        const addr = resolveAccountKey(acc);
        if (addr) signerAddresses.add(addr);
      }
    }

    let targetIdx = -1;
    let targetDiff = 0;
    for (let index = 0; index < accounts.length; index += 1) {
      const acc = resolveAccountKey(accounts[index]);
      if (acc === targetAddress) {
        targetIdx = index;
        targetDiff = ((post[index] || 0) - (pre[index] || 0)) / 1e9;
        break;
      }
    }
    if (targetIdx === -1) continue;

    if (Math.abs(targetDiff) >= 0.0003) {
      const candidates = [];
      for (let index = 0; index < accounts.length; index += 1) {
        if (index === targetIdx) continue;
        const acc = resolveAccountKey(accounts[index]);
        if (!acc) continue;
        const diff = ((post[index] || 0) - (pre[index] || 0)) / 1e9;
        const isSigner = typeof accounts[index] === 'object' ? !!accounts[index]?.signer : signerAddresses.has(acc);
        candidates.push({ addr: acc, diff, isSigner, isProgram: isProgramAddress(acc, txProgramIds) });
      }

      if (targetDiff > 0.0003) {
        const senders = candidates
          .filter((candidate) => candidate.diff < -0.0003 && !candidate.isProgram)
          .sort((left, right) => {
            if (left.isSigner && !right.isSigner) return -1;
            if (!left.isSigner && right.isSigner) return 1;
            return left.diff - right.diff;
          });
        const sender = senders[0];
        if (sender && !treasuryWallets.has(sender.addr)) {
          const existing = incoming.get(sender.addr) || { totalSol: 0, count: 0, firstTime: blockTime, lastTime: blockTime, txTypeSet: new Set(), signatures: [] };
          existing.totalSol += Math.abs(targetDiff);
          existing.count += 1;
          existing.firstTime = Math.min(existing.firstTime, blockTime);
          existing.lastTime = Math.max(existing.lastTime, blockTime);
          for (const type of classifyTxType(txProgramIds)) existing.txTypeSet.add(type);
          const sig = tx.transaction.signatures?.[0];
          if (sig) existing.signatures.push(sig);
          incoming.set(sender.addr, existing);
        }
      } else if (targetDiff < -0.0003) {
        const receivers = candidates
          .filter((candidate) => candidate.diff > 0.0003 && !candidate.isProgram)
          .sort((left, right) => {
            if (left.isSigner && !right.isSigner) return -1;
            if (!left.isSigner && right.isSigner) return 1;
            return right.diff - left.diff;
          });
        const receiver = receivers[0];
        if (receiver && !treasuryWallets.has(receiver.addr)) {
          const existing = outgoing.get(receiver.addr) || { totalSol: 0, count: 0, firstTime: blockTime, lastTime: blockTime, txTypeSet: new Set(), signatures: [] };
          existing.totalSol += Math.abs(receiver.diff);
          existing.count += 1;
          existing.firstTime = Math.min(existing.firstTime, blockTime);
          existing.lastTime = Math.max(existing.lastTime, blockTime);
          for (const type of classifyTxType(txProgramIds)) existing.txTypeSet.add(type);
          const sig = tx.transaction.signatures?.[0];
          if (sig) existing.signatures.push(sig);
          outgoing.set(receiver.addr, existing);
        }
      }
    }

    const preTok = tx.meta.preTokenBalances || [];
    const postTok = tx.meta.postTokenBalances || [];
    if (preTok.length > 0 || postTok.length > 0) {
      const preMap = new Map();
      for (const tb of preTok) {
        if (tb.owner) preMap.set(`${tb.owner}:${tb.mint}`, tb.uiTokenAmount?.uiAmount || 0);
      }
      const postMap = new Map();
      for (const tb of postTok) {
        if (tb.owner) postMap.set(`${tb.owner}:${tb.mint}`, tb.uiTokenAmount?.uiAmount || 0);
      }

      let targetGainedToken = false;
      for (const [key, postAmt] of postMap) {
        if (!key.startsWith(`${targetAddress}:`)) continue;
        const preAmt = preMap.get(key) || 0;
        if (postAmt > preAmt + 0.001) {
          targetGainedToken = true;
          break;
        }
      }

      if (targetGainedToken && Math.abs(targetDiff) < 0.01) {
        for (const [key, preAmt] of preMap) {
          const [owner] = key.split(':');
          if (owner === targetAddress) continue;
          const postAmt = postMap.get(key) || 0;
          if (preAmt > postAmt + 0.001 && !isProgramAddress(owner, txProgramIds)) {
            const existing = incoming.get(owner) || { totalSol: 0, count: 0, firstTime: blockTime, lastTime: blockTime, txTypeSet: new Set(), signatures: [] };
            existing.totalSol += 0.05;
            existing.count += 1;
            existing.firstTime = Math.min(existing.firstTime, blockTime);
            existing.lastTime = Math.max(existing.lastTime, blockTime);
            existing.txTypeSet.add('token_transfer');
            const sig = tx.transaction.signatures?.[0];
            if (sig) existing.signatures.push(sig);
            incoming.set(owner, existing);
            break;
          }
        }
      }
    }
  }

  return { incoming, outgoing, programIds };
}

export {
  PROGRAM_ADDRESSES,
  TX_TYPE_PROGRAMS,
  isProgramAddress,
  resolveAccountKey,
  extractSolTransfers,
};
