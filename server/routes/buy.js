import fs from 'node:fs';
import { Connection } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getMint,
} from '../utils/solanaToken.js';

const pendingBuyRequests = new Set();

function registerBuyRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      requireJwt,
      readBody,
      getRpcUrl,
      parsePublicKey,
    },
    wallet: {
      getCoinBalance,
      setCoinBalance,
      addCoinEarned,
      walletDatabase,
      saveWalletDatabaseDebounced,
      getPrismBalance,
    },
    economy: {
      buyUsedTxFile,
      usedBuyTxSignatures,
      dailyPurchases,
      buyDailyPurchasesFile,
      coinPackages,
      dailyCoinLimit,
      treasuryAddress,
      prismTransactions,
      savePrismDataDebounced,
      getCachedSolPriceUsd,
      getCachedSkrPriceUsd,
      skrMint,
      tokenProgramId,
      token2022ProgramId,
    },
    pushNotification,
  } = ctx;

  return async function handleBuyRoute(req, res, url, pathname) {
    if (!pathname.startsWith('/api/prism/buy')) return false;

    if (pathname === '/api/prism/buy/status' && req.method === 'GET') {
      if (!ipRateLimit('buy_status', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const address = url.searchParams.get('address') || jwtAuth.address;
      if (!address) return respondJson(res, 400, { error: 'address required' });
      if (address !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid address format' });
      const today = new Date().toISOString().slice(0, 10);
      const dayKey = `${address}:${today}`;
      const purchasedToday = dailyPurchases.get(dayKey) || 0;
      respondJson(res, 200, {
        purchasedToday,
        remainingToday: Math.max(0, dailyCoinLimit - purchasedToday),
        packages: coinPackages,
      });
      return true;
    }

    if (pathname === '/api/prism/buy' && req.method === 'POST') {
      if (!ipRateLimit('prism_buy', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const { address: bodyAddress, packageIndex, txSignature } = JSON.parse(await readBody(req));
        const address = typeof bodyAddress === 'string' ? bodyAddress.trim() : jwtAuth.address;
        if (!address) return respondJson(res, 400, { error: 'address required' });
        if (address !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid address format' });

        const pkgIdx = Number(packageIndex);
        if (pkgIdx < 0 || pkgIdx >= coinPackages.length) return respondJson(res, 400, { error: 'Invalid package' });
        const pkg = coinPackages[pkgIdx];

        const today = new Date().toISOString().slice(0, 10);
        const dayKey = `${address}:${today}`;
        const purchasedToday = dailyPurchases.get(dayKey) || 0;
        if (purchasedToday + pkg.coins > dailyCoinLimit) {
          return respondJson(res, 400, { error: `Daily limit reached. Purchased today: ${purchasedToday}/${dailyCoinLimit}` });
        }

        if (!txSignature || typeof txSignature !== 'string') return respondJson(res, 400, { error: 'txSignature required' });
        if (pendingBuyRequests.has(txSignature)) return respondJson(res, 429, { error: 'Transaction verification in progress' });
        if (usedBuyTxSignatures.has(txSignature)) return respondJson(res, 400, { error: 'Transaction already used' });
        pendingBuyRequests.add(txSignature);

        try {
          const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
          const tx = await conn.getParsedTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
          if (!tx) {
            usedBuyTxSignatures.delete(txSignature);
            return respondJson(res, 400, { error: 'Transaction not found. Wait for confirmation and retry.' });
          }
          if (tx.meta?.err) {
            usedBuyTxSignatures.delete(txSignature);
            return respondJson(res, 400, { error: 'Transaction failed on-chain' });
          }
          if (!treasuryAddress) {
            usedBuyTxSignatures.delete(txSignature);
            return respondJson(res, 503, { error: 'Service not configured' });
          }
          const treasuryAddr = treasuryAddress;
          const instructions = tx.transaction?.message?.instructions || [];
          const validTransfer = instructions.some((ix) => {
            if (ix.programId?.toBase58?.() === '11111111111111111111111111111111' && ix.parsed?.type === 'transfer') {
              const info = ix.parsed.info;
              return info.source === address && info.destination === treasuryAddr && info.lamports >= Math.floor(pkg.solPrice * 1e9 * 0.99);
            }
            return false;
          });
          if (!validTransfer) {
            usedBuyTxSignatures.delete(txSignature);
            return respondJson(res, 400, { error: 'SOL transfer to treasury not verified' });
          }
          usedBuyTxSignatures.set(txSignature, Date.now());
        } catch (error) {
          usedBuyTxSignatures.delete(txSignature);
          console.error('[buy] Transaction verification failed:', error.message);
          return respondJson(res, 400, { error: 'Transaction verification failed' });
        } finally {
          pendingBuyRequests.delete(txSignature);
        }

        const currentPurchasedSol = dailyPurchases.get(dayKey) || 0;
        if (currentPurchasedSol + pkg.coins > dailyCoinLimit) {
          return respondJson(res, 429, { error: 'Daily purchase limit reached' });
        }

        const prevBuyBal = getCoinBalance(address);
        setCoinBalance(address, prevBuyBal + pkg.coins);
        addCoinEarned(address, pkg.coins);

        const walletEntry = walletDatabase.get(address);
        if (walletEntry) {
          walletEntry.coins = prevBuyBal + pkg.coins;
          saveWalletDatabaseDebounced();
        }

        dailyPurchases.set(dayKey, currentPurchasedSol + pkg.coins);
        {
          const dpTmp = `${buyDailyPurchasesFile}.tmp`;
          const dpObj = {};
          for (const [key, value] of dailyPurchases) dpObj[key] = value;
          fs.promises.writeFile(dpTmp, JSON.stringify(dpObj), 'utf8')
            .then(() => fs.promises.rename(dpTmp, buyDailyPurchasesFile))
            .catch(() => {});
        }
        {
          const txTmp = `${buyUsedTxFile}.tmp`;
          const txObj = {};
          for (const [key, value] of usedBuyTxSignatures) txObj[key] = value;
          fs.promises.writeFile(txTmp, JSON.stringify(txObj), 'utf8')
            .then(() => fs.promises.rename(txTmp, buyUsedTxFile))
            .catch(() => {});
        }

        const txLog = {
          id: `buy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          address,
          amount: pkg.coins,
          type: 'buy',
          source: 'sol_purchase',
          description: `Purchased ${pkg.coins} Coins for ${pkg.solPrice} SOL`,
          timestamp: new Date().toISOString(),
          solTx: txSignature,
        };
        const txs = prismTransactions.get(address) || [];
        txs.unshift(txLog);
        if (txs.length > 500) txs.length = 500;
        prismTransactions.set(address, txs);
        savePrismDataDebounced();
        pushNotification(address, 'system', `Purchased ${pkg.coins.toLocaleString()} Coins for ${pkg.solPrice} SOL`, {
          source: 'sol_purchase',
          coins: pkg.coins,
          solPaid: pkg.solPrice,
          txSignature,
        });

        respondJson(res, 200, { balance: getPrismBalance(address), purchased: pkg.coins, solPaid: pkg.solPrice });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/prism/buy/skr-quote' && req.method === 'GET') {
      if (!ipRateLimit('buy_skr_quote', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      try {
        const [solUsd, skrUsd] = await Promise.all([getCachedSolPriceUsd(), getCachedSkrPriceUsd()]);
        if (!solUsd || !skrUsd) return respondJson(res, 503, { error: 'Price data unavailable' });
        const quotes = coinPackages.map((pkg) => {
          const pkgUsd = pkg.solPrice * solUsd;
          const skrAmount = Math.max(1, Math.ceil(pkgUsd / skrUsd));
          return { coins: pkg.coins, solPrice: pkg.solPrice, skrPrice: skrAmount };
        });
        respondJson(res, 200, { quotes, solUsd, skrUsd });
      } catch {
        respondJson(res, 500, { error: 'Failed to fetch SKR quote' });
      }
      return true;
    }

    if (pathname === '/api/prism/buy/skr' && req.method === 'POST') {
      if (!ipRateLimit('prism_buy_skr', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const { address: bodyAddress, packageIndex, txSignature } = JSON.parse(await readBody(req));
        const address = typeof bodyAddress === 'string' ? bodyAddress.trim() : jwtAuth.address;
        if (!address) return respondJson(res, 400, { error: 'address required' });
        if (address !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return respondJson(res, 400, { error: 'Invalid address format' });

        const pkgIdx = Number(packageIndex);
        if (pkgIdx < 0 || pkgIdx >= coinPackages.length) return respondJson(res, 400, { error: 'Invalid package' });
        const pkg = coinPackages[pkgIdx];

        const today = new Date().toISOString().slice(0, 10);
        const dayKey = `${address}:${today}`;
        const purchasedToday = dailyPurchases.get(dayKey) || 0;
        if (purchasedToday + pkg.coins > dailyCoinLimit) {
          return respondJson(res, 400, { error: `Daily limit reached. Purchased today: ${purchasedToday}/${dailyCoinLimit}` });
        }

        if (!txSignature || typeof txSignature !== 'string') return respondJson(res, 400, { error: 'txSignature required' });
        if (pendingBuyRequests.has(txSignature)) return respondJson(res, 429, { error: 'Transaction verification in progress' });
        if (usedBuyTxSignatures.has(txSignature)) return respondJson(res, 400, { error: 'Transaction already used' });
        pendingBuyRequests.add(txSignature);

        const [solUsd, skrUsd] = await Promise.all([getCachedSolPriceUsd(), getCachedSkrPriceUsd()]);
        if (!solUsd || !skrUsd) {
          usedBuyTxSignatures.delete(txSignature);
          return respondJson(res, 503, { error: 'Price data unavailable' });
        }
        const pkgUsd = pkg.solPrice * solUsd;
        const expectedSkrAmount = Math.max(1, Math.ceil(pkgUsd / skrUsd));

        try {
          const conn = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
          const tx = await conn.getParsedTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
          if (!tx) {
            usedBuyTxSignatures.delete(txSignature);
            return respondJson(res, 400, { error: 'Transaction not found. Wait for confirmation and retry.' });
          }
          if (tx.meta?.err) {
            usedBuyTxSignatures.delete(txSignature);
            return respondJson(res, 400, { error: 'Transaction failed on-chain' });
          }
          if (!treasuryAddress) {
            usedBuyTxSignatures.delete(txSignature);
            return respondJson(res, 503, { error: 'Service not configured' });
          }
          const treasuryAddr = treasuryAddress;
          const treasuryKey = parsePublicKey(treasuryAddr, 'TREASURY_ADDRESS');
          const skrMintKey = parsePublicKey(skrMint, 'SKR_MINT');
          if (!treasuryKey || !skrMintKey) {
            usedBuyTxSignatures.delete(txSignature);
            return respondJson(res, 500, { error: 'SKR treasury configuration invalid' });
          }
          const mintInfo = await getMint(conn, skrMintKey, undefined, tokenProgramId)
            .then((info) => ({ info, programId: tokenProgramId }))
            .catch(async () => {
              const info = await getMint(conn, skrMintKey, undefined, token2022ProgramId);
              return { info, programId: token2022ProgramId };
            });
          const treasuryAta = await getAssociatedTokenAddress(
            skrMintKey,
            treasuryKey,
            false,
            mintInfo.programId,
          );
          const treasuryAtaStr = treasuryAta.toBase58();
          const instructions = tx.transaction?.message?.instructions || [];
          const skrMintAddr = skrMintKey.toBase58();
          const validTransfer = instructions.some((ix) => {
            const parsed = ix.parsed;
            if (!parsed) return false;
            // Only accept transferChecked which includes mint verification
            if (parsed.type === 'transfer') return false; // Reject non-checked transfers — no mint verification possible
            if (parsed.type === 'transferChecked') {
              const info = parsed.info;
              const authority = String(info.authority || info.multisigAuthority || '');
              const destination = String(info.destination || '');
              if (authority !== address || destination !== treasuryAtaStr) return false;
              const mint = String(info.mint || '');
              if (mint !== skrMintAddr) return false;
              const amount = Number(info.tokenAmount?.uiAmount ?? info.tokenAmount?.uiAmountString ?? 0);
              const minAmount = expectedSkrAmount * 0.95;
              return Number.isFinite(amount) && amount >= minAmount;
            }
            return false;
          });
          if (!validTransfer) {
            usedBuyTxSignatures.delete(txSignature);
            return respondJson(res, 400, { error: 'SKR transfer to treasury not verified' });
          }
          usedBuyTxSignatures.set(txSignature, Date.now());
        } catch (error) {
          usedBuyTxSignatures.delete(txSignature);
          console.error('[buy-skr] Transaction verification failed:', error.message);
          return respondJson(res, 400, { error: 'Transaction verification failed' });
        } finally {
          pendingBuyRequests.delete(txSignature);
        }

        const currentPurchasedSkr = dailyPurchases.get(dayKey) || 0;
        if (currentPurchasedSkr + pkg.coins > dailyCoinLimit) {
          return respondJson(res, 429, { error: 'Daily purchase limit reached' });
        }

        const prevBuyBal = getCoinBalance(address);
        setCoinBalance(address, prevBuyBal + pkg.coins);
        addCoinEarned(address, pkg.coins);

        const walletEntry = walletDatabase.get(address);
        if (walletEntry) {
          walletEntry.coins = prevBuyBal + pkg.coins;
          saveWalletDatabaseDebounced();
        }

        dailyPurchases.set(dayKey, currentPurchasedSkr + pkg.coins);
        {
          const dpTmp = `${buyDailyPurchasesFile}.tmp`;
          const dpObj = {};
          for (const [key, value] of dailyPurchases) dpObj[key] = value;
          fs.promises.writeFile(dpTmp, JSON.stringify(dpObj), 'utf8')
            .then(() => fs.promises.rename(dpTmp, buyDailyPurchasesFile))
            .catch(() => {});
        }
        {
          const txTmp = `${buyUsedTxFile}.tmp`;
          const txObj = {};
          for (const [key, value] of usedBuyTxSignatures) txObj[key] = value;
          fs.promises.writeFile(txTmp, JSON.stringify(txObj), 'utf8')
            .then(() => fs.promises.rename(txTmp, buyUsedTxFile))
            .catch(() => {});
        }

        const txLog = {
          id: `buy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          address,
          amount: pkg.coins,
          type: 'buy',
          source: 'skr_purchase',
          description: `Purchased ${pkg.coins} Coins for ${expectedSkrAmount} SKR`,
          timestamp: new Date().toISOString(),
          solTx: txSignature,
        };
        const txs = prismTransactions.get(address) || [];
        txs.unshift(txLog);
        if (txs.length > 500) txs.length = 500;
        prismTransactions.set(address, txs);
        savePrismDataDebounced();
        pushNotification(address, 'system', `Purchased ${pkg.coins.toLocaleString()} Coins for ${expectedSkrAmount} SKR`, {
          source: 'skr_purchase',
          coins: pkg.coins,
          skrPaid: expectedSkrAmount,
          txSignature,
        });

        respondJson(res, 200, { balance: getPrismBalance(address), purchased: pkg.coins, skrPaid: expectedSkrAmount });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    return false;
  };
}

export { registerBuyRoute };
