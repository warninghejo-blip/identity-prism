import crypto from 'node:crypto';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

const isValidPubkey = (s) => { try { new PublicKey(s); return true; } catch { return false; } };

// Swap intent store: requestId → { wallet, amount, inputMint, outputMint, expiresAt, messageHash }
const swapIntents = new Map();
const INTENT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function evictExpiredIntents() {
  const now = Date.now();
  for (const [id, intent] of swapIntents) {
    if (intent.expiresAt < now) swapIntents.delete(id);
  }
}

setInterval(evictExpiredIntents, 5 * 60 * 1000).unref?.();

const MAX_AMOUNT_SOL = 100 * 1e9;   // 100 SOL in lamports
const MAX_AMOUNT_TOKEN = 1e6 * 1e6; // 1M tokens (6-decimal)
const MIN_SLIPPAGE_BPS = 1;
const MAX_SLIPPAGE_BPS = 500;

function registerMarketRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      requireJwt,
      readBody,
      normalizePubkey,
    },
    getCachedSolPriceUsd,
    getCachedSkrPriceUsd,
    getSkrQuote,
    fetchMeSlugByMint,
    fetchMagicEdenCollectionStats,
    fetchTensorCollectionStats,
    fetchMeTokenLastPrice,
    jupiterApiKey,
    jupiterSwapApiV2,
    jupiterLiteQuoteApi,
    jupiterLiteSwapApi,
    mintPriceSol,
    solMint,
  } = ctx;

  return async function handleMarketRoute(req, res, url, pathname) {
    if (pathname === '/api/market/collection-stats' && req.method === 'GET') {
      if (!ipRateLimit('mkt_colstats', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const symbol = String(url.searchParams.get('symbol') ?? '').trim();
      const collectionId = String(url.searchParams.get('collectionId') ?? '').trim();
      const collName = String(url.searchParams.get('name') ?? '').trim();
      const mint = String(url.searchParams.get('mint') ?? '').trim();
      try {
        let meSlug = null;
        if (mint) {
          meSlug = await fetchMeSlugByMint(mint).catch(() => null);
        }

        const candidates = [];
        if (collectionId) candidates.push(collectionId);
        if (symbol) candidates.push(symbol, symbol.toLowerCase());
        if (collName) {
          candidates.push(collName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
          candidates.push(collName.toLowerCase().replace(/\s+/g, '_'));
        }

        let magicStats = null;
        if (meSlug) {
          magicStats = await fetchMagicEdenCollectionStats(meSlug).catch(() => null);
        }
        if (!magicStats?.floorSol) {
          for (const slug of candidates) {
            if (!slug || slug === meSlug) continue;
            const test = await fetchMagicEdenCollectionStats(slug).catch(() => null);
            if (test?.floorSol) {
              magicStats = test;
              meSlug = slug;
              break;
            }
            if (test?.status === 'listed' && !magicStats) {
              magicStats = test;
              meSlug = slug;
            }
          }
        }
        if (!meSlug && candidates.length > 0) meSlug = candidates[0];

        let tensorStats = null;
        if (!magicStats?.floorSol && collectionId) {
          tensorStats = await fetchTensorCollectionStats(collectionId).catch(() => null);
        }

        let tokenLastPrice = null;
        if (!magicStats?.floorSol && !tensorStats?.floorSol && mint) {
          tokenLastPrice = await fetchMeTokenLastPrice(mint).catch(() => null);
        }

        const tensorUrl = collectionId ? `https://www.tensor.trade/trade/${collectionId}` : null;
        const meUrl = meSlug ? `https://magiceden.io/marketplace/${meSlug}` : (mint ? `https://magiceden.io/item-details/${mint}` : null);
        const floorSol = magicStats?.floorSol ?? tensorStats?.floorSol ?? tokenLastPrice ?? null;
        const bestSource = magicStats?.floorSol ? 'magic_eden' : (tensorStats?.floorSol ? 'tensor' : (tokenLastPrice ? 'magic_eden' : null));
        const status = magicStats?.status === 'listed' ? 'listed' : (tensorStats?.status === 'listed' ? 'listed' : (magicStats?.status ?? tensorStats?.status ?? 'unknown'));
        respondJson(res, 200, {
          status,
          floorSol,
          source: bestSource,
          tensorUrl,
          meUrl,
          meSlug: meSlug ?? null,
        });
        return true;
      } catch {
        respondJson(res, 500, { status: 'unknown', floorSol: null, error: 'Failed to fetch collection stats' });
        return true;
      }
    }

    if (pathname === '/api/market/sol-price' && req.method === 'GET') {
      if (!ipRateLimit('mkt_sol', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      try {
        const price = await getCachedSolPriceUsd();
        respondJson(res, 200, { usd: price });
      } catch (error) {
        console.error('[market] operation failed:', error);
        respondJson(res, 500, { usd: null, error: 'Service temporarily unavailable' });
      }
      return true;
    }

    if (pathname === '/api/market/skr-price' && req.method === 'GET') {
      if (!ipRateLimit('mkt_skr', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      try {
        const price = await getCachedSkrPriceUsd();
        respondJson(res, 200, { usd: price });
      } catch (error) {
        console.error('[market] operation failed:', error);
        respondJson(res, 500, { usd: null, error: 'Service temporarily unavailable' });
      }
      return true;
    }

    if (pathname === '/api/market/jupiter-prices' && req.method === 'GET') {
      if (!ipRateLimit('mkt_jup', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const ids = url.searchParams.get('ids') || '';
      if (!ids || ids.length > 2000) {
        respondJson(res, 400, { error: 'Invalid ids parameter' });
        return true;
      }
      try {
        // Jupiter retired api.jup.ag/price/v2; current endpoint is lite-api.jup.ag/price/v3 with a flatter schema.
        // We convert v3 → legacy v2 shape so existing frontend code keeps working unchanged.
        const jupResp = await fetch(`https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(ids)}`, { signal: AbortSignal.timeout(10000) });
        if (!jupResp.ok) {
          respondJson(res, jupResp.status, { error: `Jupiter API returned ${jupResp.status}` });
          return true;
        }
        const v3 = await jupResp.json();
        const data = {};
        for (const [mint, info] of Object.entries(v3 || {})) {
          if (!info || typeof info !== 'object') continue;
          const price = info.usdPrice ?? info.price;
          if (price == null) continue;
          data[mint] = {
            id: mint,
            type: 'derivedPrice',
            price: String(price),
            usdPrice: Number(price),
            liquidity: info.liquidity,
            decimals: info.decimals,
            blockId: info.blockId,
            updatedAt: info.createdAt,
          };
        }
        respondJson(res, 200, { data });
      } catch (error) {
        console.warn('[market] Jupiter price proxy failed', error);
        respondJson(res, 502, { error: 'Jupiter price fetch failed' });
      }
      return true;
    }

    if (pathname === '/api/market/mint-quote' && req.method === 'GET') {
      if (!ipRateLimit('mkt_quote', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      try {
        const quote = await getSkrQuote();
        if (!quote) {
          respondJson(res, 503, { error: 'SKR price unavailable' });
          return true;
        }
        respondJson(res, 200, {
          solUsd: quote.solUsd,
          skrUsd: quote.skrUsd,
          baseSol: mintPriceSol,
          skrAmount: quote.amount,
          skrAmountRaw: quote.rawAmount,
        });
      } catch (error) {
        console.error('[market] operation failed:', error);
        respondJson(res, 500, { error: 'Service temporarily unavailable' });
      }
      return true;
    }

    if (pathname === '/api/market/swap-quote' && req.method === 'GET') {
      if (!ipRateLimit('mkt_swap_quote', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const inputMint = normalizePubkey(url.searchParams.get('inputMint'));
      const amountRaw = String(url.searchParams.get('amount') || '').trim();
      const taker = normalizePubkey(url.searchParams.get('taker'));
      if (!inputMint || !amountRaw) {
        respondJson(res, 400, { error: 'inputMint and amount are required' });
        return true;
      }
      let amount;
      try {
        amount = BigInt(amountRaw);
      } catch {
        respondJson(res, 400, { error: 'Invalid amount' });
        return true;
      }
      if (amount <= 0n) {
        respondJson(res, 400, { error: 'Amount must be positive' });
        return true;
      }
      try {
        if (jupiterApiKey && taker) {
          const orderUrl = new URL(`${jupiterSwapApiV2}/order`);
          orderUrl.searchParams.set('inputMint', inputMint);
          orderUrl.searchParams.set('outputMint', solMint);
          orderUrl.searchParams.set('amount', amount.toString());
          orderUrl.searchParams.set('taker', taker);
          orderUrl.searchParams.set('slippageBps', '100');
          orderUrl.searchParams.set('restrictIntermediateTokens', 'true');
          const orderResp = await fetch(orderUrl.toString(), {
            headers: { 'x-api-key': jupiterApiKey },
            signal: AbortSignal.timeout(10000),
          });
          const orderData = await orderResp.json().catch(() => ({}));
          if (orderResp.ok && orderData?.outAmount) {
            respondJson(res, 200, {
              inputMint,
              outputMint: solMint,
              outAmount: orderData.outAmount,
              priceImpactPct: orderData.priceImpactPct ?? '0',
              transport: 'order_execute',
              quoteResponse: {
                mode: 'order_execute',
                inputMint,
                outputMint: solMint,
                amount: amount.toString(),
              },
            });
            return true;
          }
          console.warn('[market] Jupiter /order quote failed, falling back to lite quote', orderData?.error || orderResp.status);
        }

        const quoteUrl = new URL(jupiterLiteQuoteApi);
        quoteUrl.searchParams.set('inputMint', inputMint);
        quoteUrl.searchParams.set('outputMint', solMint);
        quoteUrl.searchParams.set('amount', amount.toString());
        quoteUrl.searchParams.set('swapMode', 'ExactIn');
        quoteUrl.searchParams.set('slippageBps', '100');
        quoteUrl.searchParams.set('restrictIntermediateTokens', 'true');
        const quoteResp = await fetch(quoteUrl.toString(), { signal: AbortSignal.timeout(10000) });
        const quoteData = await quoteResp.json().catch(() => ({}));
        if (!quoteResp.ok || !quoteData?.outAmount) {
          respondJson(res, quoteResp.status || 502, { error: quoteData?.error || 'Swap quote unavailable' });
          return true;
        }
        respondJson(res, 200, {
          inputMint,
          outputMint: solMint,
          outAmount: quoteData.outAmount,
          priceImpactPct: quoteData.priceImpactPct ?? '0',
          transport: 'legacy_raw',
          quoteResponse: quoteData,
        });
      } catch (error) {
        console.error('[market] operation failed:', error);
        respondJson(res, 502, { error: 'Service temporarily unavailable' });
      }
      return true;
    }

    if (pathname === '/api/market/build-swap' && req.method === 'POST') {
      if (!ipRateLimit('mkt_build_swap', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const parsed = JSON.parse(await readBody(req));

        // FIX 1: Accept only canonical inputs; never trust client-supplied quoteResponse
        const userPublicKey = normalizePubkey(parsed?.userPublicKey);
        const inputMintRaw = String(parsed?.inputMint || '').trim();
        const outputMintRaw = String(parsed?.outputMint || '').trim();
        const amountRaw = String(parsed?.amount || '').trim();
        const slippageBpsRaw = parsed?.slippageBps;

        // Ownership check
        if (!userPublicKey || userPublicKey !== jwtAuth.address) {
          respondJson(res, 403, { error: 'Wallet address mismatch' });
          return true;
        }

        // Validate mints
        if (!isValidPubkey(inputMintRaw) || !isValidPubkey(outputMintRaw)) {
          respondJson(res, 400, { error: 'Invalid inputMint or outputMint' });
          return true;
        }
        const inputMint = normalizePubkey(inputMintRaw);
        const outputMint = normalizePubkey(outputMintRaw);

        // Validate amount
        let amount;
        try { amount = BigInt(amountRaw); } catch { respondJson(res, 400, { error: 'Invalid amount' }); return true; }
        const maxAmount = BigInt(Math.max(MAX_AMOUNT_SOL, MAX_AMOUNT_TOKEN));
        if (amount <= 0n || amount > maxAmount) {
          respondJson(res, 400, { error: 'Amount out of allowed range' });
          return true;
        }

        // Validate slippage
        const slippageBps = Number(slippageBpsRaw);
        if (!Number.isInteger(slippageBps) || slippageBps < MIN_SLIPPAGE_BPS || slippageBps > MAX_SLIPPAGE_BPS) {
          respondJson(res, 400, { error: `slippageBps must be ${MIN_SLIPPAGE_BPS}-${MAX_SLIPPAGE_BPS}` });
          return true;
        }

        evictExpiredIntents();

        // Re-fetch quote server-side using canonical inputs
        if (jupiterApiKey) {
          const orderUrl = new URL(`${jupiterSwapApiV2}/order`);
          orderUrl.searchParams.set('inputMint', inputMint);
          orderUrl.searchParams.set('outputMint', outputMint);
          orderUrl.searchParams.set('amount', amount.toString());
          orderUrl.searchParams.set('taker', userPublicKey);
          orderUrl.searchParams.set('slippageBps', slippageBps.toString());
          orderUrl.searchParams.set('restrictIntermediateTokens', 'true');
          const orderResp = await fetch(orderUrl.toString(), {
            headers: { 'x-api-key': jupiterApiKey },
            signal: AbortSignal.timeout(10000),
          });
          const orderData = await orderResp.json().catch(() => ({}));
          if (orderResp.ok && orderData?.transaction && orderData?.requestId) {
            // Derive messageHash from the transaction message (stable across signing) for FIX 2 binding
            const txBytes = Buffer.from(orderData.transaction, 'base64');
            const messageHash = crypto.createHash('sha256').update(VersionedTransaction.deserialize(txBytes).message.serialize()).digest('hex');
            const requestId = orderData.requestId;
            swapIntents.set(requestId, {
              wallet: userPublicKey,
              amount: amount.toString(),
              inputMint,
              outputMint,
              expiresAt: Date.now() + INTENT_TTL_MS,
              messageHash,
            });
            respondJson(res, 200, {
              swapTransaction: orderData.transaction,
              requestId,
              transport: 'order_execute',
            });
            return true;
          }
          console.warn('[market] Jupiter /order build failed, falling back to lite swap', orderData?.error || orderResp.status);
        }

        // Server-side lite quote
        const quoteUrl = new URL(jupiterLiteQuoteApi);
        quoteUrl.searchParams.set('inputMint', inputMint);
        quoteUrl.searchParams.set('outputMint', outputMint);
        quoteUrl.searchParams.set('amount', amount.toString());
        quoteUrl.searchParams.set('swapMode', 'ExactIn');
        quoteUrl.searchParams.set('slippageBps', slippageBps.toString());
        quoteUrl.searchParams.set('restrictIntermediateTokens', 'true');
        const quoteResp = await fetch(quoteUrl.toString(), { signal: AbortSignal.timeout(10000) });
        const serverQuote = await quoteResp.json().catch(() => ({}));
        if (!quoteResp.ok || !serverQuote?.outAmount) {
          respondJson(res, quoteResp.status || 502, { error: serverQuote?.error || 'Swap quote unavailable' });
          return true;
        }

        const swapResp = await fetch(jupiterLiteSwapApi, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteResponse: serverQuote,
            userPublicKey,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const swapData = await swapResp.json().catch(() => ({}));
        if (!swapResp.ok || !swapData?.swapTransaction) {
          respondJson(res, swapResp.status || 502, { error: swapData?.error || 'Failed to build swap transaction' });
          return true;
        }

        const txBytes = Buffer.from(swapData.swapTransaction, 'base64');
        const messageHash = crypto.createHash('sha256').update(VersionedTransaction.deserialize(txBytes).message.serialize()).digest('hex');
        const requestId = crypto.randomUUID();
        swapIntents.set(requestId, {
          wallet: userPublicKey,
          amount: amount.toString(),
          inputMint,
          outputMint,
          expiresAt: Date.now() + INTENT_TTL_MS,
          messageHash,
        });

        respondJson(res, 200, {
          swapTransaction: swapData.swapTransaction,
          lastValidBlockHeight: swapData.lastValidBlockHeight ?? null,
          prioritizationFeeLamports: swapData.prioritizationFeeLamports ?? null,
          requestId,
          transport: 'legacy_raw',
        });
      } catch (error) {
        console.error('[market] operation failed:', error);
        respondJson(res, 400, { error: 'Service temporarily unavailable' });
      }
      return true;
    }

    if (pathname === '/api/market/execute-swap' && req.method === 'POST') {
      if (!ipRateLimit('mkt_execute_swap', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      // FIX 2: Require JWT — verify caller owns the swap intent
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      if (!jupiterApiKey) {
        respondJson(res, 503, { error: 'Jupiter API key is not configured on the server' });
        return true;
      }
      try {
        const parsed = JSON.parse(await readBody(req));
        const signedTransaction = String(parsed?.signedTransaction || '').trim();
        const requestId = String(parsed?.requestId || '').trim();
        if (!signedTransaction || !requestId) {
          respondJson(res, 400, { error: 'signedTransaction and requestId are required' });
          return true;
        }

        // FIX 2: Look up intent and enforce ownership + expiry
        const intent = swapIntents.get(requestId);
        if (!intent || intent.expiresAt < Date.now()) {
          swapIntents.delete(requestId);
          respondJson(res, 404, { error: 'Swap intent not found or expired' });
          return true;
        }
        if (intent.wallet !== jwtAuth.address) {
          respondJson(res, 403, { error: 'Swap intent belongs to a different wallet' });
          return true;
        }

        // FIX 2: Verify transaction bytes match the server-issued transaction (anti-tampering)
        let txBytes;
        try {
          txBytes = Buffer.from(signedTransaction, 'base64');
        } catch {
          respondJson(res, 400, { error: 'Invalid signedTransaction encoding' });
          return true;
        }
        // Hash the transaction message (same bytes before and after signing) to compare
        // with what was stored at build time — catches substitution of a different transaction.
        const incomingHash = crypto.createHash('sha256').update(VersionedTransaction.deserialize(txBytes).message.serialize()).digest('hex');
        if (incomingHash !== intent.messageHash) {
          respondJson(res, 400, { error: 'Transaction does not match original swap intent' });
          return true;
        }

        // Intent is valid — delete before forwarding (single-use)
        swapIntents.delete(requestId);

        const executeResp = await fetch(`${jupiterSwapApiV2}/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': jupiterApiKey,
          },
          body: JSON.stringify({
            signedTransaction,
            requestId,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const executeData = await executeResp.json().catch(() => ({}));
        if (!executeResp.ok || !executeData?.signature) {
          respondJson(res, executeResp.status || 502, { error: executeData?.error || 'Failed to execute swap' });
          return true;
        }
        respondJson(res, 200, executeData);
      } catch (error) {
        console.error('[market] operation failed:', error);
        respondJson(res, 400, { error: 'Service temporarily unavailable' });
      }
      return true;
    }

    return false;
  };
}

export { registerMarketRoute };
