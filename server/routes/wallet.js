import { Connection, PublicKey } from '@solana/web3.js';

function deriveTrustGrade(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 90) return 'A+';
  if (n >= 80) return 'A';
  if (n >= 70) return 'B';
  if (n >= 60) return 'C';
  if (n >= 50) return 'D';
  return 'F';
}

function registerWalletRoute(ctx) {
  const {
    core: {
      requireAdminKey,
      respondJson,
      ipRateLimit,
      getClientIp,
      reputationRateLimit,
      getRpcUrl,
      getBatchRpcUrl,
      batchGetParsedTxs,
      resolveAccountKey,
    },
    wallet: {
      walletDatabase,
      getCoinBalance,
    },
  } = ctx;

  return async function handleWalletRoute(req, res, url, pathname) {
    if (pathname === '/api/wallet/summary' && req.method === 'GET') {
      if (!ipRateLimit('wallet_summary', getClientIp(req), 60, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const address = url.searchParams.get('address');
      if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
      const wallet = walletDatabase.get(address);
      if (!wallet) return respondJson(res, 404, { error: 'Wallet not found' });

      const compositeScore = Number(wallet.composite?.compositeScore);
      const compositeTier = typeof wallet.composite?.compositeTier === 'string' ? wallet.composite.compositeTier : '';
      const details = wallet.composite?.details || null;
      return respondJson(res, 200, {
        address,
        score: Number.isFinite(compositeScore) ? compositeScore : (wallet.score || 0),
        tier: compositeTier || wallet.tier || 'mercury',
        badges: wallet.badges || [],
        composite: wallet.composite
          ? {
              compositeScore: wallet.composite.compositeScore,
              compositeTier: wallet.composite.compositeTier,
              breakdown: wallet.composite.breakdown,
              details,
            }
          : null,
        scoreDetails: details,
        scoreBreakdown: details?.onchain?.scoreBreakdown || wallet.scoreBreakdown || null,
        tournamentXP: wallet.tournamentXP || 0,
      });
    }

    if (pathname === '/api/wallet/tokens' && req.method === 'GET') {
      const rlIp = getClientIp(req);
      const rlKey = `walletTokens:${rlIp}`;
      const lastWT = reputationRateLimit.get(rlKey) || 0;
      if (Date.now() - lastWT < 10000) {
        return respondJson(res, 429, { error: 'Rate limited — 10s cooldown' });
      }
      reputationRateLimit.set(rlKey, Date.now());
      const address = url.searchParams.get('address');
      if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
      try {
        const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
        const pubkey = new PublicKey(address);
        const [balResult, tokenResult] = await Promise.allSettled([
          conn.getBalance(pubkey),
          conn.getParsedTokenAccountsByOwner(pubkey, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }),
        ]);
        const solBalance = balResult.status === 'fulfilled' ? balResult.value / 1e9 : 0;
        const tokenAccounts = tokenResult.status === 'fulfilled' ? tokenResult.value?.value || [] : [];
        const tokens = [];
        for (const acc of tokenAccounts) {
          const info = acc.account?.data?.parsed?.info;
          if (!info) continue;
          const amount = parseFloat(info.tokenAmount?.uiAmountString || '0');
          if (amount <= 0) continue;
          const decimals = info.tokenAmount?.decimals ?? 0;
          tokens.push({
            mint: info.mint,
            amount,
            decimals,
            isNft: decimals === 0 && amount === 1,
          });
        }
        tokens.sort((a, b) => b.amount - a.amount);
        respondJson(res, 200, {
          solBalance: Math.round(solBalance * 10000) / 10000,
          tokens: tokens.slice(0, 30),
          totalTokens: tokens.filter((token) => !token.isNft).length,
          totalNfts: tokens.filter((token) => token.isNft).length,
        });
      } catch {
        respondJson(res, 500, { error: 'Failed to fetch tokens' });
      }
      return true;
    }

    if (pathname === '/api/wallet/recent-txs' && req.method === 'GET') {
      const rlIp = getClientIp(req);
      const rlKey = `walletTxs:${rlIp}`;
      const lastWTx = reputationRateLimit.get(rlKey) || 0;
      if (Date.now() - lastWTx < 10000) {
        return respondJson(res, 429, { error: 'Rate limited — 10s cooldown' });
      }
      reputationRateLimit.set(rlKey, Date.now());
      const address = url.searchParams.get('address');
      if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid Solana address' });
      try {
        const rpcUrl = getRpcUrl(address) || 'https://api.mainnet-beta.solana.com';
        const conn = new Connection(rpcUrl, 'confirmed');
        const pubkey = new PublicKey(address);
        const sigs = await conn.getSignaturesForAddress(pubkey, { limit: 15 });
        const sigBatch = sigs.map((sig) => sig.signature);
        const parsed = sigBatch.length > 0
          ? (await batchGetParsedTxs(getBatchRpcUrl(address), sigBatch, { batchSize: 15 })).filter(Boolean)
          : [];
        const txs = [];
        for (let i = 0; i < parsed.length; i++) {
          const tx = parsed[i];
          if (!tx?.meta || !tx?.transaction) continue;
          const accounts = tx.transaction.message?.accountKeys || [];
          const pre = tx.meta.preBalances || [];
          const post = tx.meta.postBalances || [];
          let targetIdx = -1;
          for (let j = 0; j < accounts.length; j++) {
            const acc = resolveAccountKey(accounts[j]);
            if (acc === address) {
              targetIdx = j;
              break;
            }
          }
          const balChange = targetIdx >= 0 ? ((post[targetIdx] || 0) - (pre[targetIdx] || 0)) / 1e9 : 0;
          const ixs = tx.transaction.message?.instructions || [];
          let txType = 'unknown';
          for (const ix of ixs) {
            const pid = ix.programId?.toBase58?.() || (typeof ix.programId === 'string' ? ix.programId : '');
            if (pid === '11111111111111111111111111111111') txType = 'transfer';
            else if (pid.startsWith('JUP')) txType = 'swap';
            else if (['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'].includes(pid)) txType = 'swap';
            else if (['M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K', 'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN', 'hadeK9DLv9eA7ya5KnRSb4dTSitisSCRoB68Y8hmjtR'].includes(pid)) txType = 'nft_trade';
            else if (['So1endDq2YkqhipRh3WViPa8hFb7GVEtcEMF3CBAK8h', 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', 'KLend2g3cP87ber41GXWsSZQz9R1hGT2bVBaeEdnKHR'].includes(pid)) txType = 'lending';
            else if (['CgDG2CLNqR2ypE3CXTMEq5R6J8FaqVjChn9Tfmwocs4Y', 'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy'].includes(pid)) txType = 'staking';
            else if (txType === 'unknown') txType = 'contract';
          }
          txs.push({
            signature: sigs[i]?.signature || '',
            blockTime: tx.blockTime || sigs[i]?.blockTime || null,
            balanceChange: Math.round(balChange * 10000) / 10000,
            fee: (tx.meta.fee || 0) / 1e9,
            type: txType,
            success: !tx.meta.err,
            programCount: new Set(ixs.map((ix) => ix.programId?.toBase58?.() || '')).size,
          });
        }
        respondJson(res, 200, { transactions: txs });
      } catch {
        respondJson(res, 500, { error: 'Failed to fetch transactions' });
      }
      return true;
    }

    if (pathname === '/api/wallet-database/stats' && req.method === 'GET') {
      if (!requireAdminKey(req, res)) return true;
      let totalMinted = 0;
      let totalScore = 0;
      let scoreCount = 0;
      const tierDist = {};
      const sybilDist = { clean: 0, low: 0, medium: 0, high: 0, critical: 0 };
      let totalSybilRisk = 0;
      let sybilCount = 0;
      for (const wallet of walletDatabase.values()) {
        if (wallet.mint?.minted) totalMinted++;
        if (typeof wallet.score === 'number') {
          totalScore += wallet.score;
          scoreCount++;
        }
        if (wallet.tier) tierDist[wallet.tier] = (tierDist[wallet.tier] || 0) + 1;
        if (wallet.sybil?.riskLevel) {
          sybilDist[wallet.sybil.riskLevel] = (sybilDist[wallet.sybil.riskLevel] || 0) + 1;
          totalSybilRisk += wallet.sybil.riskScore || 0;
          sybilCount++;
        }
      }
      respondJson(res, 200, {
        totalWallets: walletDatabase.size,
        totalMinted,
        avgScore: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
        tierDistribution: tierDist,
        sybilDistribution: sybilDist,
        avgSybilRisk: sybilCount > 0 ? Math.round(totalSybilRisk / sybilCount) : 0,
      });
      return true;
    }

    if (pathname === '/api/wallet-database/export' && req.method === 'GET') {
      if (!requireAdminKey(req, res)) return true;
      const wallets = {};
      for (const [key, value] of walletDatabase) wallets[key] = value;
      respondJson(res, 200, {
        version: 1,
        exportedAt: new Date().toISOString(),
        totalWallets: walletDatabase.size,
        wallets,
      });
      return true;
    }

    if (pathname === '/api/wallet-database' && req.method === 'GET') {
      if (!ipRateLimit('wallet_db', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const address = url.searchParams.get('address');
      if (address) {
        const wallet = walletDatabase.get(address);
        if (!wallet) return respondJson(res, 404, { error: 'Wallet not found' });
        const compositeScore = Number(wallet.composite?.compositeScore);
        const compositeTier = typeof wallet.composite?.compositeTier === 'string' ? wallet.composite.compositeTier : '';
        const details = wallet.composite?.details || null;
        const sybilDetails = details?.sybilTrust || null;
        const trustScore = Number(sybilDetails?.trustScore ?? sybilDetails?.effectiveTrust);
        const publicScore = Number.isFinite(compositeScore) ? compositeScore : (wallet.score || 0);
        const publicTier = compositeTier || wallet.tier || 'mercury';
        const publicData = {
          address,
          tier: publicTier,
          score: publicScore,
          coins: typeof getCoinBalance === 'function' ? getCoinBalance(address) : (wallet.coins || 0),
          scanCount: Number(wallet.scanCount) || Number(details?.engagement?.scanCount) || 0,
          sybil: sybilDetails
            ? {
                trustScore: Number.isFinite(trustScore) ? trustScore : undefined,
                trustGrade: sybilDetails.trustGrade || deriveTrustGrade(trustScore),
                verdictLabel: sybilDetails.verdictLabel || null,
              }
            : null,
          stats: details?.onchain
            ? {
                transactions: details.onchain.txCount,
                nfts: details.onchain.nftCount,
                solBalance: details.onchain.solBalance,
              }
            : null,
          badges: wallet.badges || [],
          composite: wallet.composite ? { compositeScore: wallet.composite.compositeScore, compositeTier: wallet.composite.compositeTier, breakdown: wallet.composite.breakdown, details } : null,
          scoreBreakdown: wallet.scoreBreakdown || null,
          scoreDetails: details,
          joinedAt: wallet.joinedAt || null,
          lastSeenAt: wallet.lastSeenAt || null,
          tournamentXP: wallet.tournamentXP || 0,
        };
        respondJson(res, 200, publicData);
        return true;
      }

      if (!requireAdminKey(req, res)) return true;
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 500);
      const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
      const sort = url.searchParams.get('sort') || 'lastSeenAt';
      const entries = [...walletDatabase.values()];
      entries.sort((a, b) => {
        if (sort === 'score') return (b.score || 0) - (a.score || 0);
        if (sort === 'scanCount') return (b.scanCount || 0) - (a.scanCount || 0);
        if (sort === 'coins') return (b.coins || 0) - (a.coins || 0);
        return (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '');
      });
      const page = entries.slice(offset, offset + limit);
      respondJson(res, 200, { total: entries.length, limit, offset, wallets: page });
      return true;
    }

    return false;
  };
}

export { registerWalletRoute };
