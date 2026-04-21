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
        respondJson(res, 500, { usd: null, error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    if (pathname === '/api/market/skr-price' && req.method === 'GET') {
      if (!ipRateLimit('mkt_skr', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      try {
        const price = await getCachedSkrPriceUsd();
        respondJson(res, 200, { usd: price });
      } catch (error) {
        respondJson(res, 500, { usd: null, error: error instanceof Error ? error.message : String(error) });
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
        const jupResp = await fetch(`https://api.jup.ag/price/v2?ids=${encodeURIComponent(ids)}`);
        if (!jupResp.ok) {
          respondJson(res, jupResp.status, { error: `Jupiter API returned ${jupResp.status}` });
          return true;
        }
        respondJson(res, 200, await jupResp.json());
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
        respondJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
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
        const quoteResp = await fetch(quoteUrl.toString());
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
        respondJson(res, 502, { error: error instanceof Error ? error.message : 'Swap quote fetch failed' });
      }
      return true;
    }

    if (pathname === '/api/market/build-swap' && req.method === 'POST') {
      if (!ipRateLimit('mkt_build_swap', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const parsed = JSON.parse(await readBody(req));
        const userPublicKey = normalizePubkey(parsed?.userPublicKey);
        const quoteResponse = parsed?.quoteResponse;
        if (!userPublicKey || userPublicKey !== jwtAuth.address) {
          respondJson(res, 403, { error: 'Wallet address mismatch' });
          return true;
        }
        if (!quoteResponse || quoteResponse.outputMint !== solMint || !normalizePubkey(quoteResponse.inputMint)) {
          respondJson(res, 400, { error: 'Invalid swap quote' });
          return true;
        }

        if (jupiterApiKey && quoteResponse.mode === 'order_execute' && String(quoteResponse.amount || '').trim()) {
          const orderUrl = new URL(`${jupiterSwapApiV2}/order`);
          orderUrl.searchParams.set('inputMint', normalizePubkey(quoteResponse.inputMint));
          orderUrl.searchParams.set('outputMint', solMint);
          orderUrl.searchParams.set('amount', String(quoteResponse.amount));
          orderUrl.searchParams.set('taker', userPublicKey);
          orderUrl.searchParams.set('slippageBps', '100');
          orderUrl.searchParams.set('restrictIntermediateTokens', 'true');
          const orderResp = await fetch(orderUrl.toString(), {
            headers: { 'x-api-key': jupiterApiKey },
          });
          const orderData = await orderResp.json().catch(() => ({}));
          if (orderResp.ok && orderData?.transaction && orderData?.requestId) {
            respondJson(res, 200, {
              swapTransaction: orderData.transaction,
              requestId: orderData.requestId,
              transport: 'order_execute',
            });
            return true;
          }
          console.warn('[market] Jupiter /order build failed, falling back to lite swap', orderData?.error || orderResp.status);
        }

        const swapResp = await fetch(jupiterLiteSwapApi, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteResponse,
            userPublicKey,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
          }),
        });
        const swapData = await swapResp.json().catch(() => ({}));
        if (!swapResp.ok || !swapData?.swapTransaction) {
          respondJson(res, swapResp.status || 502, { error: swapData?.error || 'Failed to build swap transaction' });
          return true;
        }
        respondJson(res, 200, {
          swapTransaction: swapData.swapTransaction,
          lastValidBlockHeight: swapData.lastValidBlockHeight ?? null,
          prioritizationFeeLamports: swapData.prioritizationFeeLamports ?? null,
          transport: 'legacy_raw',
        });
      } catch (error) {
        respondJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/market/execute-swap' && req.method === 'POST') {
      if (!ipRateLimit('mkt_execute_swap', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
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
        });
        const executeData = await executeResp.json().catch(() => ({}));
        if (!executeResp.ok || !executeData?.signature) {
          respondJson(res, executeResp.status || 502, { error: executeData?.error || 'Failed to execute swap' });
          return true;
        }
        respondJson(res, 200, executeData);
      } catch (error) {
        respondJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid request body' });
      }
      return true;
    }

    return false;
  };
}

export { registerMarketRoute };
