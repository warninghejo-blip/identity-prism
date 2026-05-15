const ENHANCED_TX_CACHE_TTL_MS = 600_000;
const ENHANCED_TX_CACHE_MAX_ENTRIES = 200;
const ENHANCED_TX_PAGE_SIZE = 100;

const ENHANCED_TX_TYPES = {
  defi: new Set(['SWAP', 'ADD_LIQUIDITY', 'REMOVE_LIQUIDITY', 'REMOVE_FROM_POOL', 'CREATE_POOL', 'CLOSE_POSITION', 'OPEN_POSITION', 'BORROW_FOX', 'LEND_FOX', 'DEPOSIT', 'WITHDRAW']),
  nft: new Set(['NFT_SALE', 'NFT_BID', 'NFT_LISTING', 'NFT_MINT', 'NFT_CANCEL_LISTING', 'NFT_BID_CANCELLED', 'NFT_GLOBAL_BID', 'NFT_AUCTION_CREATED', 'NFT_AUCTION_UPDATED', 'NFT_AUCTION_CANCELLED', 'NFT_PARTICIPATION_REWARD', 'NFT_MINT_REJECTED', 'BURN_NFT', 'TRANSFER']),
  staking: new Set(['STAKE_SOL', 'UNSTAKE_SOL', 'STAKE_TOKEN', 'UNSTAKE_TOKEN', 'INIT_STAKE', 'MERGE_STAKE', 'SPLIT_STAKE']),
};

function classifyEnhancedTxType(type) {
  if (ENHANCED_TX_TYPES.defi.has(type)) return 'defi';
  if (ENHANCED_TX_TYPES.nft.has(type)) return 'nft';
  if (ENHANCED_TX_TYPES.staking.has(type)) return 'staking';
  return 'transfer';
}

function getHeliusKeyIndex(seed = '', heliusKeys = []) {
  if (!heliusKeys.length) return -1;
  if (!seed) return 0;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 2147483647;
  }
  return Math.abs(hash) % heliusKeys.length;
}

function pickHeliusKey(seed, heliusKeys = []) {
  const index = getHeliusKeyIndex(seed, heliusKeys);
  if (index < 0) return null;
  return heliusKeys[index];
}

function parseEnhancedTransactions(txs, address) {
  let swapCount = 0;
  let nftTradeCount = 0;
  let stakingCount = 0;
  const defiProtocols = new Set();
  const edgeTypesMap = new Map();

  for (const tx of txs) {
    if (!tx || !tx.type) continue;
    const classified = classifyEnhancedTxType(tx.type);
    if (tx.signature) edgeTypesMap.set(tx.signature, classified);

    if (classified === 'defi') {
      swapCount += 1;
      if (tx.source) defiProtocols.add(tx.source.toUpperCase());
    } else if (classified === 'nft') {
      nftTradeCount += 1;
    } else if (classified === 'staking') {
      stakingCount += 1;
    }
  }

  const protocolList = [...defiProtocols];
  const isDeFiUser = swapCount >= 1;
  const isDeFiKing = swapCount >= 5 || protocolList.length >= 2;

  return { swapCount, nftTradeCount, stakingCount, defiProtocols: protocolList, isDeFiUser, isDeFiKing, edgeTypesMap };
}

function getEnhancedTxTimestampSeconds(tx) {
  const candidates = [tx?.timestamp, tx?.blockTime, tx?.slotTime];
  for (const value of candidates) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) continue;
    return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num);
  }
  return null;
}

function getEnhancedTxTimestampMs(tx) {
  const seconds = getEnhancedTxTimestampSeconds(tx);
  return seconds ? seconds * 1000 : Date.now();
}

function isEnhancedTxFailed(tx) {
  return Boolean(tx?.transactionError || tx?.meta?.err || tx?.err);
}

function normalizeEnhancedAddress(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed) ? trimmed : '';
}

function getEnhancedTransferAmountSol(transfer) {
  if (!transfer || typeof transfer !== 'object') return 0;
  if (transfer.lamports != null) {
    const lamports = Number(transfer.lamports);
    return Number.isFinite(lamports) ? lamports / 1e9 : 0;
  }
  const raw = Number(transfer.amount ?? transfer.nativeAmount ?? transfer.solAmount ?? 0);
  if (!Number.isFinite(raw)) return 0;
  if (Number.isInteger(raw) && Math.abs(raw) >= 1000) return raw / 1e9;
  return raw;
}

function getEnhancedTxProgramKeys(tx) {
  const keys = new Set();
  for (const ix of Array.isArray(tx?.instructions) ? tx.instructions : []) {
    const pid = typeof ix?.programId === 'string'
      ? ix.programId
      : (typeof ix?.program === 'string' ? ix.program : '');
    if (pid) keys.add(pid);
  }
  if (typeof tx?.source === 'string' && tx.source) keys.add(`source:${tx.source.toUpperCase()}`);
  if (typeof tx?.type === 'string' && tx.type) keys.add(`type:${tx.type.toUpperCase()}`);
  return keys;
}

function recordEnhancedCounterparty(map, addr, amountSol, blockTime, txType, signature) {
  if (!addr || !Number.isFinite(amountSol) || amountSol <= 0) return;
  const existing = map.get(addr) || { totalSol: 0, count: 0, firstTime: blockTime, lastTime: blockTime, txTypeSet: new Set(), signatures: [] };
  existing.totalSol += amountSol;
  existing.count += 1;
  existing.firstTime = Math.min(existing.firstTime, blockTime);
  existing.lastTime = Math.max(existing.lastTime, blockTime);
  existing.txTypeSet.add(txType || 'transfer');
  if (signature) existing.signatures.push(signature);
  map.set(addr, existing);
}

function getEnhancedTokenAmount(transfer) {
  const direct = Number(transfer?.tokenAmount);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const uiAmount = Number(
    transfer?.tokenAmount?.uiAmount
    ?? transfer?.rawTokenAmount?.tokenAmount
    ?? transfer?.amount
    ?? 0,
  );
  if (Number.isFinite(uiAmount) && uiAmount > 0) return uiAmount;

  const rawAmount = Number(transfer?.rawTokenAmount?.tokenAmount ?? transfer?.tokenAmount?.amount ?? 0);
  const decimals = Number(transfer?.rawTokenAmount?.decimals ?? transfer?.tokenAmount?.decimals ?? 0);
  if (Number.isFinite(rawAmount) && Number.isFinite(decimals) && rawAmount > 0) {
    return rawAmount / (10 ** decimals);
  }
  return 0;
}

function recordTokenFundingSource(map, mint, addr, amount, blockTime, signature) {
  if (!mint || !addr || !Number.isFinite(amount) || amount <= 0) return;
  const mintMap = map.get(mint) || new Map();
  const existing = mintMap.get(addr) || { totalAmount: 0, count: 0, firstTime: blockTime, lastTime: blockTime, signatures: [] };
  existing.totalAmount += amount;
  existing.count += 1;
  existing.firstTime = Math.min(existing.firstTime, blockTime);
  existing.lastTime = Math.max(existing.lastTime, blockTime);
  if (signature) existing.signatures.push(signature);
  mintMap.set(addr, existing);
  map.set(mint, mintMap);
}

function createHeliusEnhancedService({
  heliusKeys,
  trackedFundingTokenMints,
  stablecoinFundingMints,
  treasuryWallets,
  isProgramAddress,
  cache = new Map(),
  cacheTtlMs = ENHANCED_TX_CACHE_TTL_MS,
  cacheMaxEntries = ENHANCED_TX_CACHE_MAX_ENTRIES,
  fetchImpl = fetch,
}) {
  function normalizeFundingMint(mint) {
    if (typeof mint !== 'string') return '';
    const trimmed = mint.trim();
    return trackedFundingTokenMints.has(trimmed) ? trimmed : '';
  }

  function summarizeEnhancedTxHistory(txs, address, currentBalance = 0) {
    const incoming = new Map();
    const outgoing = new Map();
    const tokenFundingSources = new Map();
    const allProgramIds = new Set();
    const programInteractionCounts = new Map();
    const incomingSenders = new Set();
    const outgoingRecipients = new Set();
    const timestamps = [];
    const netSolChanges = [];
    const trackedTokenMints = new Set();

    let incomingVolume = 0;
    let outgoingVolume = 0;
    let incomingCount = 0;
    let outgoingCount = 0;
    let dustTxCount = 0;
    let totalSolTxCount = 0;
    let failedTxCount = 0;
    let selfTransferCount = 0;

    const recentTxs = txs.slice(0, 200);
    const earlyTxs = txs.length > 300 ? txs.slice(-100) : [];

    for (const tx of txs) {
      if (!tx) continue;
      if (isEnhancedTxFailed(tx)) failedTxCount += 1;

      const signature = typeof tx.signature === 'string' ? tx.signature : '';
      const blockTime = getEnhancedTxTimestampMs(tx);
      const blockTimeSeconds = Math.floor(blockTime / 1000);
      if (blockTimeSeconds > 1584000000) timestamps.push(blockTime);

      const txType = classifyEnhancedTxType(tx?.type || '');
      const txPrograms = getEnhancedTxProgramKeys(tx);
      if (txPrograms.size === 0) txPrograms.add('type:TRANSFER');
      for (const key of txPrograms) allProgramIds.add(key);
      for (const key of txPrograms) {
        programInteractionCounts.set(key, (programInteractionCounts.get(key) || 0) + 1);
      }

      const nativeTransfers = Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : [];
      let netSol = 0;
      for (const transfer of nativeTransfers) {
        const from = normalizeEnhancedAddress(transfer?.fromUserAccount ?? transfer?.from ?? transfer?.source);
        const to = normalizeEnhancedAddress(transfer?.toUserAccount ?? transfer?.to ?? transfer?.destination);
        const amountSol = getEnhancedTransferAmountSol(transfer);
        if (!amountSol) continue;

        if (from === address && to === address) selfTransferCount += 1;
        if (to === address && from && from !== address && !treasuryWallets.has(from) && !isProgramAddress(from, txPrograms)) {
          recordEnhancedCounterparty(incoming, from, amountSol, blockTime, txType, signature);
          incomingSenders.add(from);
          netSol += amountSol;
        }
        if (from === address && to && to !== address && !treasuryWallets.has(to) && !isProgramAddress(to, txPrograms)) {
          recordEnhancedCounterparty(outgoing, to, amountSol, blockTime, txType, signature);
          outgoingRecipients.add(to);
          netSol -= amountSol;
        }
      }

      const tokenTransfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
      for (const transfer of tokenTransfers) {
        const mint = normalizeFundingMint(transfer?.mint);
        const amount = getEnhancedTokenAmount(transfer);
        const from = normalizeEnhancedAddress(transfer?.fromUserAccount ?? transfer?.from ?? transfer?.source);
        const to = normalizeEnhancedAddress(transfer?.toUserAccount ?? transfer?.to ?? transfer?.destination);
        if (!mint || amount <= 0) continue;
        trackedTokenMints.add(mint);
        if (to === address && from && from !== address && !treasuryWallets.has(from) && !isProgramAddress(from, txPrograms)) {
          recordTokenFundingSource(tokenFundingSources, mint, from, amount, blockTime, signature);
        }
      }
      if (tokenTransfers.length > 0 && Math.abs(netSol) < 0.01) {
        for (const transfer of tokenTransfers) {
          const from = normalizeEnhancedAddress(transfer?.fromUserAccount ?? transfer?.from ?? transfer?.source);
          const to = normalizeEnhancedAddress(transfer?.toUserAccount ?? transfer?.to ?? transfer?.destination);
          if (from === address && to === address) selfTransferCount += 1;
          if (to === address && from && from !== address && !treasuryWallets.has(from) && !isProgramAddress(from, txPrograms)) {
            recordEnhancedCounterparty(incoming, from, 0.05, blockTime, txType, signature);
            incomingSenders.add(from);
          }
        }
      }

      if (Math.abs(netSol) >= 0.0001) {
        totalSolTxCount += 1;
        if (netSol > 0) {
          incomingVolume += netSol;
          incomingCount += 1;
        } else {
          outgoingVolume += Math.abs(netSol);
          outgoingCount += 1;
        }
        if (Math.abs(netSol) < 0.001) dustTxCount += 1;
      }
      netSolChanges.push({ blockTime: blockTimeSeconds, netSol });
    }

    let historicalMaxBalance = currentBalance;
    let runningBalance = currentBalance;
    for (const item of netSolChanges) {
      runningBalance -= item.netSol;
      if (runningBalance > historicalMaxBalance) historicalMaxBalance = runningBalance;
    }

    let shallowProtocols = 0;
    let deepProtocols = 0;
    for (const [, count] of programInteractionCounts) {
      if (count <= 2) shallowProtocols += 1;
      if (count >= 5) deepProtocols += 1;
    }
    const farmingRatio = programInteractionCounts.size > 3 ? shallowProtocols / programInteractionCounts.size : 0;

    const byTime = [...netSolChanges].filter((item) => item.blockTime).sort((a, b) => a.blockTime - b.blockTime);
    let rapidCycleCount = 0;
    for (let index = 0; index < byTime.length - 1; index += 1) {
      const tx1 = byTime[index];
      const tx2 = byTime[index + 1];
      if (tx1.netSol > 0.01 && tx2.netSol < -0.01 && (tx2.blockTime - tx1.blockTime) < 60) {
        const ratio = Math.abs(tx2.netSol) / tx1.netSol;
        if (ratio > 0.8 && ratio < 1.2) rapidCycleCount += 1;
      }
    }

    const toProgramSet = (list) => {
      const set = new Set();
      for (const tx of list) {
        for (const key of getEnhancedTxProgramKeys(tx)) {
          if (key !== '11111111111111111111111111111111' && key !== 'ComputeBudget111111111111111111111111111111') set.add(key);
        }
      }
      return set;
    };
    const earlyProgramSet = toProgramSet(earlyTxs);
    const recentProgramSet = toProgramSet(recentTxs.slice(0, 50));
    let behaviorDriftDetected = false;
    let behaviorDriftValue = '';
    if (earlyProgramSet.size >= 3 && recentProgramSet.size >= 3) {
      const intersection = [...earlyProgramSet].filter((programId) => recentProgramSet.has(programId)).length;
      const union = new Set([...earlyProgramSet, ...recentProgramSet]).size;
      const jaccard = union > 0 ? intersection / union : 1;
      if (jaccard < 0.1) {
        behaviorDriftDetected = true;
        behaviorDriftValue = `${(jaccard * 100).toFixed(0)}% overlap (${earlyProgramSet.size} early → ${recentProgramSet.size} recent programs)`;
      }
    }

    const firstTxBlockTime = timestamps.length > 0 ? Math.floor(Math.min(...timestamps) / 1000) : null;

    return {
      totalTxs: txs.length,
      timestamps,
      firstTxBlockTime,
      failedTxCount,
      recentTxs,
      earlyTxs,
      incoming,
      outgoing,
      incomingVolume,
      outgoingVolume,
      incomingCount,
      outgoingCount,
      dustTxCount,
      totalSolTxCount,
      historicalMaxBalance,
      allProgramIds,
      programInteractionCounts,
      incomingSenders,
      outgoingRecipients,
      tokenFundingSources,
      trackedTokenMints: [...trackedTokenMints],
      splFlowDetected: trackedTokenMints.size > 0,
      shallowProtocols,
      deepProtocols,
      farmingRatio,
      selfTransferCount,
      rapidCycleCount,
      behaviorDriftDetected,
      behaviorDriftValue,
    };
  }

  async function fetchEnhancedTxHistory(address, { limit = 1000, before = null } = {}) {
    const requestedLimit = Math.min(10_000, Math.max(1, Number(limit) || 1000));
    const normalizedBefore = typeof before === 'string' && before.trim() ? before.trim() : null;
    const cacheKey = normalizedBefore ? `${address}:${normalizedBefore}:${requestedLimit}` : address;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < cacheTtlMs && Array.isArray(cached.data?.txs)) {
      if (normalizedBefore) return cached.data;
      const exhausted = Boolean(cached.data?.historyExhausted);
      if (cached.data.txs.length >= requestedLimit || exhausted) {
        return {
          ...cached.data,
          txs: cached.data.txs.slice(0, requestedLimit),
        };
      }
    }

    const key = pickHeliusKey(address, heliusKeys);
    if (!key) return null;

    const allTxs = [];
    const maxPages = Math.ceil(requestedLimit / ENHANCED_TX_PAGE_SIZE);
    let lastSignature = normalizedBefore || undefined;
    let exhausted = false;

    for (let page = 0; page < maxPages; page += 1) {
      try {
        let url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${key}&limit=${ENHANCED_TX_PAGE_SIZE}`;
        if (lastSignature) url += `&before=${lastSignature}`;

        const resp = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (!resp.ok) break;
        const txs = await resp.json();
        if (!Array.isArray(txs) || txs.length === 0) {
          exhausted = true;
          break;
        }

        allTxs.push(...txs);
        lastSignature = txs[txs.length - 1]?.signature;
        if (!lastSignature || txs.length < ENHANCED_TX_PAGE_SIZE) {
          exhausted = true;
          break;
        }
      } catch {
        break;
      }
    }

    if (allTxs.length === 0) return null;

    const parsed = parseEnhancedTransactions(allTxs, address);
    const result = {
      ...parsed,
      txs: allTxs,
      historyExhausted: exhausted || allTxs.length < requestedLimit,
    };

    if (cache.size >= cacheMaxEntries) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(cacheKey, { data: result, ts: Date.now() });

    return {
      ...result,
      txs: result.txs.slice(0, requestedLimit),
    };
  }

  return {
    enhancedTxCache: cache,
    fetchEnhancedTxHistory,
    parseEnhancedTransactions,
    summarizeEnhancedTxHistory,
    getEnhancedTxTimestampSeconds,
    getEnhancedTxTimestampMs,
  };
}

export {
  ENHANCED_TX_CACHE_MAX_ENTRIES,
  ENHANCED_TX_CACHE_TTL_MS,
  createHeliusEnhancedService,
  getEnhancedTxTimestampMs,
  getEnhancedTxTimestampSeconds,
  parseEnhancedTransactions,
  pickHeliusKey,
};
