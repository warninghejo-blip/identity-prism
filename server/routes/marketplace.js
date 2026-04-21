import fs from 'node:fs';
import path from 'node:path';

function registerMarketplaceRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      requireJwt,
      readBody,
    },
    wallet: {
      getCoinBalance,
      setCoinBalance,
      addCoinSpent,
      walletDatabase,
      saveWalletDatabaseDebounced,
    },
    economy: {
      totalBurned: totalBurnedRef,
    },
    marketplaceListings,
    marketplacePurchases,
    saveMarketplace,
    debouncedSavePrism,
    applyBurnFee,
  } = ctx;

  return async function handleMarketplaceRoute(req, res, url, pathname) {
    if (pathname === '/api/marketplace/listings' && req.method === 'GET') {
      if (!ipRateLimit('mkt_list', getClientIp(req), 30, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const category = url.searchParams.get('category');
      const listings = [...marketplaceListings.values()]
        .filter((listing) => listing.status === 'approved' && (!category || listing.category === category))
        .sort((a, b) => b.createdAt - a.createdAt);
      respondJson(res, 200, { listings });
      return true;
    }

    if (pathname === '/api/marketplace/my-purchases' && req.method === 'GET') {
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      const address = jwtAuth.address;
      if (!address) {
        respondJson(res, 400, { error: 'address required' });
        return true;
      }

      const purchases = [];
      for (const [key] of marketplacePurchases) {
        if (!key.startsWith(`${address}:`)) continue;
        const listingId = key.split(':')[1];
        const listing = marketplaceListings.get(listingId);
        if (listing) purchases.push(listing);
      }
      respondJson(res, 200, { purchases });
      return true;
    }

    if (pathname === '/api/marketplace/upload' && req.method === 'POST') {
      if (!ipRateLimit('mkt_upload', getClientIp(req), 5, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      try {
        const { address, name, description, category, price, modelData, modelFormat, previewImage } = JSON.parse(await readBody(req));
        if (address && address !== jwtAuth.address) {
          respondJson(res, 403, { error: 'Address mismatch' });
          return true;
        }
        if (!address || !name || !modelData || !price) {
          respondJson(res, 400, { error: 'address, name, modelData, price required' });
          return true;
        }

        const format = String(modelFormat || '').toLowerCase();
        if (!['glb', 'gltf', 'obj'].includes(format)) {
          respondJson(res, 400, { error: 'Invalid format. Supported: GLB, GLTF, OBJ' });
          return true;
        }
        if (modelData.length > 5 * 1024 * 1024 * 1.37) {
          respondJson(res, 400, { error: 'Model too large. Max 5MB.' });
          return true;
        }

        const priceNum = Math.max(1, Math.floor(Number(price)));
        if (priceNum > 10000) {
          respondJson(res, 400, { error: 'Price too high. Max 10000 Coins.' });
          return true;
        }

        let modelBuffer;
        try {
          modelBuffer = Buffer.from(modelData.split(',').pop() || modelData, 'base64');
        } catch {
          respondJson(res, 400, { error: 'Invalid base64 encoding' });
          return true;
        }
        if (format === 'glb') {
          if (modelBuffer.length < 12) {
            respondJson(res, 400, { error: 'GLB file too small' });
            return true;
          }
          if (modelBuffer.readUInt32LE(0) !== 0x46546C67) {
            respondJson(res, 400, { error: 'Invalid GLB file — magic bytes mismatch.' });
            return true;
          }
          const version = modelBuffer.readUInt32LE(4);
          if (version !== 2) {
            respondJson(res, 400, { error: `Unsupported GLB version ${version}. Only glTF 2.0 supported.` });
            return true;
          }
        }

        const listingFee = 10;
        const balance = getCoinBalance(address);
        if (balance < listingFee) {
          respondJson(res, 400, { error: `Insufficient balance. Listing fee: ${listingFee} Coins` });
          return true;
        }

        applyBurnFee(listingFee);
        setCoinBalance(address, balance - listingFee);
        addCoinSpent(address, listingFee);
        const wallet = walletDatabase.get(address);
        if (wallet) {
          wallet.coins = balance - listingFee;
          saveWalletDatabaseDebounced();
        }

        const id = `model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const modelsDir = path.join(process.cwd(), 'marketplace_models');
        if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
        await fs.promises.writeFile(path.join(modelsDir, `${id}.${format}`), modelBuffer);

        let safePreview = null;
        if (previewImage) {
          if (!/^data:image\/(png|jpe?g|gif|webp);base64,/.test(previewImage)) {
            respondJson(res, 400, { error: 'previewImage must be a valid image data URL (png, jpg, gif, webp)' });
            return true;
          }
          safePreview = previewImage.slice(0, 100000);
        }

        const listing = {
          id,
          seller: jwtAuth.address,
          name: name.slice(0, 60),
          description: String(description || '').slice(0, 200),
          category: ['ship', 'planet', 'badge', 'decoration'].includes(category) ? category : 'ship',
          price: priceNum,
          format,
          modelUrl: `/marketplace_models/${id}.${format}`,
          previewImage: safePreview,
          status: 'pending',
          purchaseCount: 0,
          createdAt: Date.now(),
        };
        marketplaceListings.set(id, listing);
        saveMarketplace();
        respondJson(res, 200, { listing, message: 'Model uploaded successfully!' });
      } catch (error) {
        console.error('[marketplace] Upload failed:', error?.message ?? error);
        respondJson(res, 500, { error: 'Upload failed' });
      }
      return true;
    }

    if (pathname === '/api/marketplace/purchase' && req.method === 'POST') {
      if (!ipRateLimit('mkt_purchase', getClientIp(req), 10, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      try {
        const { address, listingId } = JSON.parse(await readBody(req));
        if (address && address !== jwtAuth.address) {
          respondJson(res, 403, { error: 'Address mismatch' });
          return true;
        }
        if (!address || !listingId) {
          respondJson(res, 400, { error: 'address and listingId required' });
          return true;
        }

        const purchaseKey = `${address}:${listingId}`;
        if (marketplacePurchases.has(purchaseKey)) {
          respondJson(res, 400, { error: 'Already purchased' });
          return true;
        }

        marketplacePurchases.set(purchaseKey, true);
        const listing = marketplaceListings.get(listingId);
        if (!listing) {
          marketplacePurchases.delete(purchaseKey);
          respondJson(res, 404, { error: 'Listing not found' });
          return true;
        }
        if (listing.status !== 'approved') {
          marketplacePurchases.delete(purchaseKey);
          respondJson(res, 400, { error: 'Listing is not available for purchase' });
          return true;
        }
        if (listing.seller === address) {
          marketplacePurchases.delete(purchaseKey);
          respondJson(res, 400, { error: 'Cannot purchase your own listing' });
          return true;
        }

        const buyerBalance = getCoinBalance(address);
        if (buyerBalance < listing.price) {
          marketplacePurchases.delete(purchaseKey);
          respondJson(res, 400, { error: 'Insufficient Coin balance' });
          return true;
        }

        setCoinBalance(address, buyerBalance - listing.price);
        addCoinSpent(address, listing.price);
        totalBurnedRef.value += listing.price;
        listing.purchaseCount = (listing.purchaseCount || 0) + 1;
        marketplaceListings.set(listingId, listing);
        debouncedSavePrism();
        saveMarketplace();
        respondJson(res, 200, {
          success: true,
          listing,
          newBalance: getCoinBalance(address),
          message: `Purchased "${listing.name}" for ${listing.price} Coins`,
        });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    return false;
  };
}

export { registerMarketplaceRoute };
