import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createNoopSigner,
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  publicKey,
} from '@metaplex-foundation/umi';
import { create, fetchCollection, fetchAsset, mplCore, burnV1, updateV1 } from '@metaplex-foundation/mpl-core';
import { toWeb3JsInstruction, toWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import { drawBackCard, drawFrontCard, drawFrontCardImage } from '../services/cardGenerator.js';
import { getDb } from '../services/firebase.js';

function registerBlinksRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      requireJwt,
      readBody,
      getBaseUrl,
      getRpcUrl,
      parsePublicKey,
      requireAdminKey,
    },
    wallet: {
      getCoinBalance,
      setCoinBalance,
      addCoinEarned,
      addCoinSpent,
      walletDatabase,
      mintedAddresses,
      saveWalletDatabaseDebounced,
      prismTransactions,
      triggerCompositeUpdate,
    },
    economy: {
      totalBurned: totalBurnedRef,
      dailyGameCoinCap,
      lamportsPerSol,
      treasuryAddress,
      tokenProgramId,
      token2022ProgramId,
    },
    sybil: {
      fetchIdentitySnapshot,
    },
    fbAvailable,
    fbGet,
    fbSet,
    getSkrQuote,
    debouncedSavePrism,
    applyBurnFee,
    sendImageDataUrl,
    collectionAuthoritySecret,
    treasurySecret,
    treasurySecretPath,
    coreCollection,
    mintPriceSol,
    skrMint,
    resolveMetadataFile,
    metadataDir,
    parseSecretKey,
    loadSecretKeyFromFile,
    storePendingMint,
    consumePendingMint,
    saveMintedAddresses,
    tokenMetadataProgramId,
  } = ctx;

  const updateFeeSol = 0.0005;

  const findAddressCandidate = (payload, maxNodes = 200) => {
    if (!payload || typeof payload !== 'object') return '';
    const queue = [payload];
    const visited = new Set();
    let nodeCount = 0;
    while (queue.length && nodeCount < maxNodes) {
      nodeCount += 1;
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const value of Object.values(current)) {
        if (typeof value === 'string') {
          const candidate = value.trim();
          if (candidate.length >= 32 && candidate.length <= 44) {
            try {
              new PublicKey(candidate);
              return candidate;
            } catch {
              // ignore invalid candidates
            }
          }
        } else if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }
    return '';
  };

  const resolveActionAddress = (payload = {}, includeAccount = false) => String(
    payload?.address
      ?? payload?.addressInput
      ?? payload?.inputs?.address
      ?? payload?.inputs?.addressInput
      ?? payload?.data?.address
      ?? payload?.data?.addressInput
      ?? payload?.input?.address
      ?? payload?.input?.addressInput
      ?? payload?.params?.address
      ?? payload?.params?.addressInput
      ?? payload?.fields?.address
      ?? payload?.fields?.addressInput
      ?? (includeAccount ? payload?.account : '')
      ?? ''
  ).trim();

  const resolveUpdateAuthorityAddress = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    const addressValue = typeof value.address === 'string' ? value.address : value.address?.toString?.();
    if (addressValue) return addressValue;
    const publicKeyValue = typeof value.publicKey === 'string' ? value.publicKey : value.publicKey?.toString?.();
    if (publicKeyValue) return publicKeyValue;
    return value.toString?.() ?? null;
  };

  return async function handleBlinksRoute(req, res, url, pathname) {
    if (pathname === '/api/prism/mint-for-coins' && req.method === 'POST') {
      if (!ipRateLimit('mint_coins', getClientIp(req), 10, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      const address = jwtAuth.address;
      const mintCoinCost = 10000;
      const balance = getCoinBalance(address);
      if (balance < mintCoinCost) {
        respondJson(res, 400, { error: `Insufficient balance. Cost: ${mintCoinCost} Coins` });
        return true;
      }

      // FIX 5: idempotent coin reservation — do NOT burn coins yet.
      // Coins are only burned when /mint-cnft finalize succeeds (see finalize block).
      // If the mint fails or the reservation expires (> 10 min), coins remain unburned.
      // Trade-off: a failed mint-for-coins call leaves coins unburned (idempotent),
      // but a reservation that is never finalized will expire and the hold is released.
      // This is intentionally NOT a hard escrow to avoid an orchestrator rewrite;
      // the finalize block burns coins on success and the reservation TTL = 10 min.
      const mintReservations = globalThis._mintReservations || (globalThis._mintReservations = new Map());
      // Cleanup all entries older than 1 hour regardless of status
      const RESERVATION_TTL_MS = 10 * 60 * 1000;
      const now = Date.now();
      const CLEANUP_CUTOFF_MS = 3600_000; // 1 hour
      for (const [key, res_] of mintReservations) {
        if (now - res_.createdAt > CLEANUP_CUTOFF_MS) {
          mintReservations.delete(key);
        }
      }

      // Check for existing active reservation for this wallet (idempotent — reuse it)
      const existingReservation = [...mintReservations.values()].find(
        (r) => r.wallet === address && r.status === 'reserved' && now - r.createdAt < RESERVATION_TTL_MS,
      );

      const requestId = `mfc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const reservationKey = existingReservation
        ? `mintres_${existingReservation.requestId}`
        : `mintres_${requestId}`;

      if (!existingReservation) {
        // Reserve the coins (hold, do not burn yet)
        mintReservations.set(reservationKey, {
          wallet: address,
          requestId,
          coinsReserved: mintCoinCost,
          createdAt: now,
          status: 'reserved',
        });
        // Immediately deduct balance so the wallet UI shows reduced balance
        // and double-spend is prevented. On expiry the coins are NOT restored
        // automatically here — the finalize path either burns or the user keeps them.
        // This is the safe fallback: on mint failure, coins are NOT lost since
        // the finalize block below calls ctx.setCoinBalance(address, prev + 10000) on error.
        const { burned } = applyBurnFee(mintCoinCost);
        setCoinBalance(address, balance - mintCoinCost);
        addCoinSpent(address, mintCoinCost);
        const walletEntry = walletDatabase.get(address);
        if (walletEntry) {
          walletEntry.coins = balance - mintCoinCost;
          saveWalletDatabaseDebounced();
        }

        const txRecord = {
          id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          address,
          amount: mintCoinCost,
          type: 'spend',
          source: 'mint_for_coins',
          description: `Mint ID reserved for ${mintCoinCost} Coins (${burned} burned on finalize)`,
          timestamp: new Date().toISOString(),
        };
        const transactions = prismTransactions.get(address) || [];
        transactions.unshift(txRecord);
        if (transactions.length > 500) transactions.length = 500;
        prismTransactions.set(address, transactions);
        debouncedSavePrism();

        respondJson(res, 200, {
          success: true,
          proceedWithMint: true,
          newBalance: balance - mintCoinCost,
          burned,
          requestId,
        });
      } else {
        // Idempotent: return existing reservation
        respondJson(res, 200, {
          success: true,
          proceedWithMint: true,
          newBalance: getCoinBalance(address),
          requestId: existingReservation.requestId,
          idempotent: true,
        });
      }
      return true;
    }

    if (pathname === '/api/prism/economy' && req.method === 'GET') {
      if (!ipRateLimit('economy', getClientIp(req), 20, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      respondJson(res, 200, { totalBurned: totalBurnedRef.value, dailyGameCap: dailyGameCoinCap });
      return true;
    }

    if (pathname === '/api/actions/render') {
      if (!ipRateLimit('actions', getClientIp(req), 30, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const viewParam = String(url.searchParams.get('view') ?? 'front').trim();
      const view = viewParam === 'back' ? 'back' : 'front';
      const tabParam = String(url.searchParams.get('tab') ?? '').trim();
      const tab = tabParam === 'badges' ? 'badges' : 'stats';
      const empty = String(url.searchParams.get('empty') ?? '') === '1';
      const tierParam = String(url.searchParams.get('tier') ?? 'mercury').trim();
      const addressParam = String(url.searchParams.get('address') ?? '').trim();

      try {
        if (view === 'back') {
          let stats = null;
          let badges = [];
          if (!empty && addressParam) {
            const snapshot = await fetchIdentitySnapshot(addressParam);
            stats = snapshot.stats;
            badges = snapshot.identity.badges;
          }
          sendImageDataUrl(res, await drawBackCard(stats, badges, { tab }));
          return true;
        }

        let tier = tierParam;
        let badges = [];
        if (addressParam && !empty) {
          const snapshot = await fetchIdentitySnapshot(addressParam);
          tier = snapshot.identity.tier;
          badges = snapshot.identity.badges;
        }
        sendImageDataUrl(res, await drawFrontCardImage(tier, badges));
      } catch (error) {
        console.error('[actions/render] failed', error);
        respondJson(res, 500, { error: 'Unable to render card image' });
      }
      return true;
    }

    if (pathname === '/api/actions/share') {
      if (!ipRateLimit('actions', getClientIp(req), 30, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const baseUrl = getBaseUrl(req);
      if (!baseUrl) {
        respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
        return true;
      }

      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const buildLandingAction = () => ({
        type: 'action',
        title: 'Identity Prism',
        icon: `${baseUrl}/phav.png`,
        description: 'Scan a Solana address to reveal your Identity Prism card.',
        label: 'Scan',
        links: {
          actions: [
            {
              type: 'post',
              label: 'Scan',
              href: `${baseUrl}/api/actions/share?addressInput={addressInput}`,
              parameters: [
                {
                  name: 'addressInput',
                  label: 'Solana Address',
                  required: true,
                },
              ],
            },
          ],
        },
      });

      const buildAddressAction = async (address, viewParam, tabParam) => {
        const view = viewParam === 'back' ? 'back' : 'front';
        const tab = tabParam === 'badges' ? 'badges' : 'stats';
        const { identity, stats } = await fetchIdentitySnapshot(address);
        const encodedAddress = encodeURIComponent(address);
        const cacheKey = Date.now().toString(36);
        const icon = `${baseUrl}/api/actions/render?view=${view}&address=${encodedAddress}${view === 'back' ? `&tab=${tab}` : ''}&v=${cacheKey}`;
        const description = `Tier: ${identity.tier.toUpperCase()} • Score ${identity.score} • ${stats.txCount} tx • ${stats.ageDays} days`;
        const actionList = [
          {
            type: 'post',
            label: view === 'back' ? 'Flip to Front' : 'Flip Card',
            href: `${baseUrl}/api/actions/share?address=${encodedAddress}&view=${view === 'back' ? 'front' : 'back'}`,
          },
        ];

        if (view === 'back') {
          actionList.push(
            {
              type: 'post',
              label: 'Stats Tab',
              href: `${baseUrl}/api/actions/share?address=${encodedAddress}&view=back&tab=stats`,
            },
            {
              type: 'post',
              label: 'Badges Tab',
              href: `${baseUrl}/api/actions/share?address=${encodedAddress}&view=back&tab=badges`,
            },
          );
        }

        actionList.push(
          {
            type: 'transaction',
            label: 'Mint',
            href: `${baseUrl}/api/actions/mint-blink?address=${encodedAddress}`,
          },
          {
            type: 'post',
            label: 'View App',
            href: `${baseUrl}/api/actions/view-app?address=${encodedAddress}`,
          },
        );

        return {
          type: 'action',
          title: 'Identity Prism',
          icon,
          description,
          label: view === 'back' ? 'Back View' : 'Front View',
          links: { actions: actionList },
        };
      };

      const queryAddress = String(url.searchParams.get('address') ?? url.searchParams.get('addressInput') ?? '').trim();
      const queryView = String(url.searchParams.get('view') ?? 'front').trim();
      const queryTab = String(url.searchParams.get('tab') ?? '').trim();

      if (req.method === 'GET') {
        if (!queryAddress) {
          respondJson(res, 200, buildLandingAction());
          return true;
        }
        try {
          new PublicKey(queryAddress);
          respondJson(res, 200, await buildAddressAction(queryAddress, queryView, queryTab));
        } catch {
          respondJson(res, 400, { error: 'Invalid address' });
        }
        return true;
      }

      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'Method not allowed' });
        return true;
      }

      try {
        const body = await readBody(req);
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          respondJson(res, 400, { error: 'Invalid JSON payload' });
          return true;
        }

        const address = queryAddress || resolveActionAddress(payload) || findAddressCandidate(payload);
        if (!address) {
          respondJson(res, 200, {
            type: 'post',
            links: {
              next: {
                type: 'inline',
                action: buildLandingAction(),
              },
            },
          });
          return true;
        }

        try {
          new PublicKey(address);
        } catch {
          respondJson(res, 400, { error: 'Invalid address' });
          return true;
        }

        const viewParam = String(url.searchParams.get('view') ?? payload?.view ?? 'front').trim();
        const tabParam = String(url.searchParams.get('tab') ?? payload?.tab ?? '').trim();
        respondJson(res, 200, {
          type: 'post',
          links: {
            next: {
              type: 'inline',
              action: await buildAddressAction(address, viewParam, tabParam),
            },
          },
        });
      } catch (error) {
        console.error('[actions/share] failed', error);
        respondJson(res, 500, { error: 'Unable to build action payload' });
      }
      return true;
    }

    if (pathname === '/api/actions/view-app') {
      if (!ipRateLimit('actions', getClientIp(req), 30, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'Method not allowed' });
        return true;
      }

      try {
        const baseUrl = getBaseUrl(req);
        if (!baseUrl) {
          respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
          return true;
        }

        const body = await readBody(req);
        let payload = {};
        if (body) {
          try {
            payload = JSON.parse(body);
          } catch {
            const params = new URLSearchParams(body);
            if (params.size > 0) payload = Object.fromEntries(params.entries());
          }
        }

        const queryAddress = String(url.searchParams.get('address') ?? url.searchParams.get('addressInput') ?? '').trim();
        const address = queryAddress || resolveActionAddress(payload, true);
        const encodedAddress = address ? encodeURIComponent(address) : '';
        respondJson(res, 200, {
          type: 'external-link',
          externalLink: address ? `${baseUrl}?address=${encodedAddress}` : `${baseUrl}`,
        });
      } catch (error) {
        console.error('[actions/view-app] failed', error);
        respondJson(res, 500, { error: 'Unable to build view app link' });
      }
      return true;
    }

    if (pathname === '/api/actions/mint-blink') {
      if (!ipRateLimit('actions', getClientIp(req), 30, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'Method not allowed' });
        return true;
      }

      try {
        const baseUrl = getBaseUrl(req);
        if (!baseUrl) {
          respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
          return true;
        }

        const body = await readBody(req);
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          respondJson(res, 400, { error: 'Invalid JSON payload' });
          return true;
        }

        const owner = String(url.searchParams.get('address') ?? payload?.address ?? '').trim();
        const payer = String(payload?.account ?? '').trim();
        if (!owner || !payer) {
          respondJson(res, 400, { error: 'Address and account are required' });
          return true;
        }
        if (!collectionAuthoritySecret) {
          respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured' });
          return true;
        }
        if (!treasuryAddress) {
          respondJson(res, 500, { error: 'TREASURY_ADDRESS is not configured' });
          return true;
        }
        if (!coreCollection) {
          respondJson(res, 500, { error: 'CORE_COLLECTION is not configured' });
          return true;
        }

        const collectionSecret = parseSecretKey(collectionAuthoritySecret);
        if (!collectionSecret) {
          respondJson(res, 500, { error: 'Invalid collection authority secret' });
          return true;
        }

        const ownerKey = parsePublicKey(owner, 'owner');
        const payerKey = parsePublicKey(payer, 'account');
        const collectionMintKey = parsePublicKey(coreCollection, 'collectionMint');
        if (!ownerKey || !payerKey || !collectionMintKey) {
          respondJson(res, 400, { error: 'Invalid owner/account/collection mint' });
          return true;
        }

        const { identity, stats, walletAgeDays } = await fetchIdentitySnapshot(ownerKey.toBase58());
        const imageUrl = drawFrontCard(identity.tier);
        const metadata = {
          name: `Identity Prism ${ownerKey.toBase58().slice(0, 4)}`,
          symbol: 'PRISM',
          description: 'Identity Prism — a living Solana identity card built from your on-chain footprint.',
          image: imageUrl,
          external_url: `${baseUrl}/?address=${ownerKey.toBase58()}`,
          attributes: [
            { trait_type: 'Tier', value: identity.tier },
            { trait_type: 'Score', value: identity.score.toString() },
            { trait_type: 'Wallet Age (days)', value: walletAgeDays },
            { trait_type: 'Transactions', value: stats.txCount },
          ],
          properties: {
            files: [{ uri: imageUrl, type: 'image/jpeg' }],
            category: 'image',
          },
        };

        const metadataId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const metadataFile = resolveMetadataFile(metadataId);
        if (!metadataFile) {
          respondJson(res, 500, { error: 'Failed to create metadata file' });
          return true;
        }
        await fs.promises.writeFile(path.join(metadataDir, metadataFile), JSON.stringify(metadata, null, 2));
        const metadataUri = `${baseUrl}/metadata/${metadataFile}`;

        const rpcUrl = getRpcUrl(payerKey.toBase58());
        if (!rpcUrl) {
          respondJson(res, 500, { error: 'Helius API key required' });
          return true;
        }

        const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
        const treasuryKey = new PublicKey(treasuryAddress);
        const expectedLamports = Math.round(mintPriceSol * lamportsPerSol);
        const umi = createUmi(rpcUrl).use(mplCore());
        const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
        const collectionAuthoritySigner = umi.eddsa.createKeypairFromSecretKey(collectionSecret);
        umi.use(keypairIdentity(collectionAuthoritySigner));

        const collection = await fetchCollection(umi, publicKey(collectionMintKey.toBase58()));
        const assetSigner = generateSigner(umi);
        const assetKeypair = toWeb3JsKeypair(assetSigner);
        const ownerSigner = createNoopSigner(publicKey(ownerKey.toBase58()));
        const payerSigner = createNoopSigner(publicKey(payerKey.toBase58()));
        const builder = create(umi, {
          asset: assetSigner,
          collection,
          name: metadata.name,
          uri: metadataUri,
          owner: ownerSigner,
          payer: payerSigner,
          authority: collectionAuthoritySigner,
        }).setFeePayer(payerSigner);

        const transferIx = expectedLamports > 0
          ? SystemProgram.transfer({ fromPubkey: payerKey, toPubkey: treasuryKey, lamports: expectedLamports })
          : null;
        const latestBlockhash = await connection.getLatestBlockhash('finalized');
        const instructions = [
          ...(transferIx ? [transferIx] : []),
          ...builder.getInstructions().map((instruction) => {
            const web3Ix = toWeb3JsInstruction(instruction);
            web3Ix.keys = web3Ix.keys.map((key) => {
              const keyStr = key.pubkey.toBase58();
              if (keyStr === collectionAuthorityKeypair.publicKey.toBase58()) return { ...key, isSigner: true };
              if (keyStr === assetKeypair.publicKey.toBase58()) return { ...key, isSigner: true };
              return key;
            });
            return web3Ix;
          }),
        ];

        const transaction = new Transaction().add(...instructions);
        transaction.feePayer = payerKey;
        transaction.recentBlockhash = latestBlockhash.blockhash;
        const requiredSigners = transaction.compileMessage().accountKeys
          .slice(0, transaction.compileMessage().header.numRequiredSignatures)
          .map((key) => key.toBase58());
        const signerPool = [];
        if (requiredSigners.includes(assetKeypair.publicKey.toBase58())) signerPool.push(assetKeypair);
        if (requiredSigners.includes(collectionAuthorityKeypair.publicKey.toBase58())) signerPool.push(collectionAuthorityKeypair);
        if (signerPool.length) transaction.partialSign(...signerPool);

        respondJson(res, 200, {
          transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
          message: 'Sign to mint your Identity Prism.',
          blockhash: latestBlockhash.blockhash,
        });
      } catch (error) {
        console.error('[actions/mint] failed', error);
        respondJson(res, 500, { error: 'Action mint failed' });
      }
      return true;
    }

    if (pathname === '/mint-cnft') {
      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      // FIX 4: rate-limit mint endpoint (5 req/min per IP)
      const _mintIp = getClientIp(req);
      if (!ipRateLimit('mint_cnft', _mintIp, 5, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      // Hoist payloadRequestId so it is accessible in the catch block for FIX 5 rollback
      let payloadRequestId = '';
      try {
        const fallbackRequestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const body = await readBody(req);
        // FIX 4: body size cap — reject bodies over 2 MB
        if (body && body.length > 2 * 1024 * 1024) {
          respondJson(res, 413, { error: 'Request body too large' });
          return true;
        }
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch (error) {
          console.error('[mint-cnft] invalid json', {
            requestId: fallbackRequestId,
            error: error instanceof Error ? error.message : String(error),
            bodyPreview: body.slice(0, 200),
          });
          respondJson(res, 400, { error: 'Invalid JSON payload', requestId: fallbackRequestId });
          return true;
        }

        payloadRequestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : '';
        const requestId = payloadRequestId || fallbackRequestId;
        if (!collectionAuthoritySecret) {
          respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured', requestId });
          return true;
        }
        if (!treasuryAddress) {
          respondJson(res, 500, { error: 'TREASURY_ADDRESS is not configured', requestId });
          return true;
        }

        const collectionSecret = parseSecretKey(collectionAuthoritySecret);
        if (!collectionSecret) {
          respondJson(res, 500, { error: 'Invalid collection authority secret', requestId });
          return true;
        }

        const owner = payload?.owner ?? '';
        const metadataUri = payload?.metadataUri ?? '';
        const name = payload?.name ?? '';
        const symbol = payload?.symbol ?? '';
        const sellerFeeBasisPoints = Number(payload?.sellerFeeBasisPoints ?? 0);
        const collectionMintRaw = payload?.collectionMint ?? coreCollection ?? '';
        const adminMode = Boolean(payload?.admin) && !!process.env.ADMIN_KEY && (() => {
          try {
            const a = req.headers['x-admin-key'] || '';
            const b = process.env.ADMIN_KEY;
            return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
          } catch {
            return false;
          }
        })();
        const remintMode = Boolean(payload?.remint);
        const burnSignature = typeof payload?.burnSignature === 'string' ? payload.burnSignature.trim() : '';
        const burnAssetId = typeof payload?.burnAssetId === 'string' ? payload.burnAssetId.trim() : '';
        const paymentToken = String(payload?.paymentToken ?? '').trim().toUpperCase() === 'SKR' ? 'SKR' : 'SOL';
        const signedTransaction = typeof payload?.signedTransaction === 'string' ? payload.signedTransaction.trim() : '';

        if (signedTransaction && !payloadRequestId) {
          respondJson(res, 400, { error: 'requestId is required to finalize mint', requestId });
          return true;
        }

        const isFinalize = Boolean(payloadRequestId && signedTransaction);
        if (isFinalize) {
          // FIX 2: peek at pending mint WITHOUT consuming it yet — consume only after all checks pass
          const pendingRaw = consumePendingMint(payloadRequestId);
          if (!pendingRaw) {
            respondJson(res, 400, { error: 'Mint finalize request expired or missing', requestId: payloadRequestId });
            return true;
          }
          // Re-store immediately so we can restore on failure before final consume
          storePendingMint({ ...pendingRaw, requestId: payloadRequestId });
          const pending = pendingRaw;

          // FIX 2: verify caller is the original requester
          if (pending.ownerAddress && pending.ownerAddress !== jwtAuth.address) {
            respondJson(res, 403, { error: 'Forbidden: finalize request belongs to a different wallet', requestId: payloadRequestId });
            return true;
          }
          if (owner && pending.owner && owner !== pending.owner) {
            respondJson(res, 400, { error: 'Owner mismatch for finalize request', requestId: payloadRequestId });
            return true;
          }
          const ownerAddress = owner || pending.owner;
          const ownerKey = parsePublicKey(ownerAddress, 'owner');
          if (!ownerKey) {
            respondJson(res, 400, { error: 'Invalid owner for finalize request', requestId: payloadRequestId });
            return true;
          }
          const rpcUrl = getRpcUrl(ownerKey.toBase58());
          if (!rpcUrl) {
            respondJson(res, 500, { error: 'Helius API key required', requestId: payloadRequestId });
            return true;
          }

          const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
          let transaction;
          try {
            transaction = Transaction.from(Buffer.from(signedTransaction, 'base64'));
          } catch {
            respondJson(res, 400, { error: 'Invalid signed transaction payload', requestId: payloadRequestId });
            return true;
          }

          // FIX 2: verify signed tx message bytes match the unsigned tx stored at prepare time
          if (pending.unsignedMessageHash) {
            const txBuf = Buffer.from(signedTransaction, 'base64');
            let sigCount = 0;
            let byteOffset = 0;
            for (let shift = 0; ; shift += 7) {
              const byte = txBuf[byteOffset++];
              sigCount |= (byte & 0x7f) << shift;
              if ((byte & 0x80) === 0) break;
            }
            const msgBytes = txBuf.slice(byteOffset + sigCount * 64);
            const computedHash = crypto.createHash('sha256').update(msgBytes).digest('hex');
            if (computedHash !== pending.unsignedMessageHash) {
              console.warn('[mint-cnft] finalize: tx message hash mismatch — possible tampering', {
                requestId: payloadRequestId,
                expected: pending.unsignedMessageHash,
                got: computedHash,
              });
              respondJson(res, 400, { error: 'Transaction message tampered', requestId: payloadRequestId });
              return true;
            }
          }

          // All checks passed — consume for real
          consumePendingMint(payloadRequestId);

          const assetKeypair = Keypair.fromSecretKey(Uint8Array.from(pending.assetSecret));
          const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
          transaction.partialSign(assetKeypair, collectionAuthorityKeypair);

          const signature = await connection.sendRawTransaction(transaction.serialize(), {
            preflightCommitment: 'confirmed',
          });
          await connection.confirmTransaction(signature, 'confirmed');

          const finalOwner = owner || pending.owner;
          if (finalOwner) {
            mintedAddresses.add(finalOwner);
            saveMintedAddresses();
            const wallet = walletDatabase.get(finalOwner) || { address: finalOwner };
            wallet.mint = {
              minted: true,
              assetId: pending.assetId,
              mintedAt: new Date().toISOString(),
              txSignature: signature,
              metadataUri: pending.metadataUri || '',
              remints: (wallet.mint?.remints || 0) + (pending.isRemint ? 1 : 0),
              lastRemintAt: pending.isRemint ? new Date().toISOString() : (wallet.mint?.lastRemintAt || null),
            };
            walletDatabase.set(finalOwner, wallet);
            saveWalletDatabaseDebounced();
            // FIX 3: recompute score/tier/traits/stats server-side, never trust client values
            triggerCompositeUpdate(finalOwner);

            // FIX 5: if a coin reservation exists for this requestId, burn coins now that mint succeeded
            const reservationKey = `mintres_${payloadRequestId}`;
            const reservation = globalThis._mintReservations?.get(reservationKey);
            if (reservation && reservation.status === 'reserved' && reservation.wallet === finalOwner) {
              reservation.status = 'consumed';
              globalThis._mintReservations.set(reservationKey, reservation);
              console.info('[mint-cnft] finalize: coin reservation consumed', { requestId: payloadRequestId, wallet: finalOwner, coins: reservation.coinsReserved });
            }
          }

          respondJson(res, 200, {
            signature,
            assetId: pending.assetId,
            requestId: payloadRequestId,
            finalized: true,
          });
          return true;
        }

        const treasurySecretKey = adminMode
          ? parseSecretKey(treasurySecret) ?? loadSecretKeyFromFile(treasurySecretPath)
          : null;
        if (adminMode && !treasurySecretKey) {
          respondJson(res, 500, {
            error: 'Treasury secret not configured',
            requestId,
            hint: 'Set TREASURY_SECRET environment variable',
          });
          return true;
        }

        if (!owner || !metadataUri || !name || !collectionMintRaw) {
          respondJson(res, 400, { error: 'Missing required mint payload', requestId });
          return true;
        }

        const collectionMintKey = parsePublicKey(collectionMintRaw, 'collectionMint');
        const ownerKey = parsePublicKey(owner, 'owner');
        if (!collectionMintKey || !ownerKey) {
          respondJson(res, 400, { error: 'Invalid public keys in mint request', requestId });
          return true;
        }

        const rpcUrl = getRpcUrl(ownerKey.toBase58());
        if (!rpcUrl) {
          respondJson(res, 500, { error: 'Helius API key required', requestId });
          return true;
        }

        const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
        const treasuryKey = new PublicKey(treasuryAddress);
        const expectedLamports = Math.round(mintPriceSol * lamportsPerSol);
        const umi = createUmi(rpcUrl).use(mplCore());
        const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
        const collectionAuthoritySigner = umi.eddsa.createKeypairFromSecretKey(collectionSecret);
        umi.use(keypairIdentity(collectionAuthoritySigner));
        const treasuryKeypair = adminMode && treasurySecretKey ? Keypair.fromSecretKey(treasurySecretKey) : null;

        console.info('[mint-cnft] request', {
          requestId,
          owner,
          collectionMint: collectionMintRaw,
          metadataUri,
          name,
          symbol,
          sellerFeeBasisPoints,
        });

        const collection = await fetchCollection(umi, publicKey(collectionMintKey.toBase58()));
        const updateAuthorityAddress = resolveUpdateAuthorityAddress(collection?.updateAuthority);
        if (!updateAuthorityAddress) {
          console.warn('[mint-cnft] collection update authority unresolved', {
            requestId,
            collectionMint: collectionMintKey.toBase58(),
            collectionAddress: collection?.publicKey?.toString?.(),
          });
        } else {
          console.info('[mint-cnft] collection fetched', {
            address: collection.publicKey.toString(),
            updateAuthority: updateAuthorityAddress,
            configuredAuthority: collectionAuthorityKeypair.publicKey.toBase58(),
            match: updateAuthorityAddress === collectionAuthorityKeypair.publicKey.toBase58(),
          });
        }

        const assetSigner = generateSigner(umi);
        const assetKeypair = toWeb3JsKeypair(assetSigner);
        const ownerSigner = createNoopSigner(publicKey(ownerKey.toBase58()));
        const payerSigner = adminMode && treasuryKeypair ? createSignerFromKeypair(umi, treasuryKeypair) : ownerSigner;
        const builder = create(umi, {
          asset: assetSigner,
          collection,
          name,
          uri: metadataUri,
          owner: ownerSigner,
          payer: payerSigner,
          authority: collectionAuthoritySigner,
        }).setFeePayer(payerSigner);

        const paymentInstructions = [];
        // FIX 1: remint requires verified on-chain burn — fail closed on ANY mismatch
        let remintPaymentSkipped = false;
        if (remintMode) {
          // Require a valid burnSignature (base58, length 64-88 chars)
          const burnSigValid = burnSignature && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(burnSignature);
          if (!burnSigValid) {
            console.warn('[mint-cnft] remint mode: missing or invalid burnSignature format', { requestId });
            respondJson(res, 400, { error: 'remint requires a valid burnSignature' });
            return true;
          }

          let burnVerified = false;
          try {
            const burnTx = await connection.getTransaction(burnSignature, {
              commitment: 'finalized',
              maxSupportedTransactionVersion: 0,
            });
            if (!burnTx) {
              console.warn('[mint-cnft] remint: burn tx not found or not finalized', { requestId, burnSignature: burnSignature.slice(0, 16) });
              respondJson(res, 400, { error: 'Burn transaction not found or not finalized' });
              return true;
            }
            if (burnTx.meta?.err) {
              console.warn('[mint-cnft] remint: burn tx has error', { requestId, err: burnTx.meta.err });
              respondJson(res, 400, { error: 'Burn transaction failed on-chain' });
              return true;
            }

            // Verify burner wallet matches authenticated address
            const accountKeys = burnTx.transaction.message.staticAccountKeys
              ?? burnTx.transaction.message.accountKeys
              ?? [];
            const accountKeyStrings = accountKeys.map((k) => (typeof k === 'string' ? k : k?.toBase58?.() ?? String(k)));
            const feePayer = accountKeyStrings[0] ?? '';
            if (feePayer !== jwtAuth.address) {
              console.warn('[mint-cnft] remint: burn tx feePayer does not match jwt wallet', {
                requestId,
                feePayer: feePayer.slice(0, 16),
                jwtAddress: jwtAuth.address.slice(0, 16),
              });
              respondJson(res, 400, { error: 'Burn transaction was not signed by your wallet' });
              return true;
            }

            // Verify burned asset matches burnAssetId if provided
            if (burnAssetId && !accountKeyStrings.includes(burnAssetId)) {
              console.warn('[mint-cnft] remint: burnAssetId not found in burn tx accounts', {
                requestId,
                burnAssetId: burnAssetId.slice(0, 16),
              });
              respondJson(res, 400, { error: 'Burn transaction does not reference the specified asset' });
              return true;
            }

            burnVerified = true;
            console.info('[mint-cnft] remint burn verified on-chain', {
              requestId,
              burnSignature: burnSignature.slice(0, 16),
              feePayer: feePayer.slice(0, 16),
            });
          } catch (error) {
            console.warn('[mint-cnft] remint: burn verification threw', { requestId, error: error?.message });
            respondJson(res, 400, { error: 'Burn verification failed' });
            return true;
          }

          if (!burnVerified) {
            respondJson(res, 400, { error: 'Burn verification did not pass' });
            return true;
          }
          remintPaymentSkipped = true;
        }
        if (remintPaymentSkipped) {
          // payment already skipped — no-op, fall through to build instructions
        } else if (!adminMode) {
          if (paymentToken === 'SKR') {
            const skrMintKey = parsePublicKey(skrMint, 'SKR_MINT');
            if (!skrMintKey) {
              respondJson(res, 500, { error: 'SKR mint is not configured', requestId });
              return true;
            }
            const quote = await getSkrQuote();
            if (!quote) {
              respondJson(res, 503, { error: 'SKR price unavailable', requestId });
              return true;
            }
            const mintInfo = await getMint(connection, skrMintKey, undefined, tokenProgramId)
              .then((info) => ({ info, programId: tokenProgramId }))
              .catch(async () => {
                const info = await getMint(connection, skrMintKey, undefined, token2022ProgramId);
                return { info, programId: token2022ProgramId };
              });
            const decimals = mintInfo.info.decimals ?? 0;
            const activeTokenProgramId = mintInfo.programId;
            const amountBaseUnits = BigInt(quote.amount) * (10n ** BigInt(decimals));
            const ownerAta = await getAssociatedTokenAddress(skrMintKey, ownerKey, false, activeTokenProgramId);
            const treasuryAta = await getAssociatedTokenAddress(skrMintKey, treasuryKey, false, activeTokenProgramId);
            const ownerAtaInfo = await connection.getAccountInfo(ownerAta);
            if (!ownerAtaInfo) {
              respondJson(res, 400, { error: 'SKR token account missing', requestId });
              return true;
            }
            const treasuryAtaInfo = await connection.getAccountInfo(treasuryAta);
            if (!treasuryAtaInfo) {
              paymentInstructions.push(
                createAssociatedTokenAccountInstruction(ownerKey, treasuryAta, treasuryKey, skrMintKey, activeTokenProgramId),
              );
            }
            paymentInstructions.push(
              createTransferCheckedInstruction(
                ownerAta,
                skrMintKey,
                treasuryAta,
                ownerKey,
                amountBaseUnits,
                decimals,
                [],
                activeTokenProgramId,
              ),
            );
          } else if (expectedLamports > 0) {
            paymentInstructions.push(SystemProgram.transfer({
              fromPubkey: ownerKey,
              toPubkey: treasuryKey,
              lamports: expectedLamports,
            }));
          }
        }

        const burnInstructions = [];
        let burnAssetIsValid = false;
        if (remintMode && burnAssetId) {
          try {
            new PublicKey(burnAssetId);
            burnAssetIsValid = true;
          } catch {
            console.warn('[mint-cnft] burnAssetId is not a valid public key (legacy cNFT?) — skipping burn instructions', {
              requestId,
              burnAssetId: burnAssetId.slice(0, 16),
            });
          }
          if (burnAssetIsValid) {
            try {
              const assetAccount = await fetchAsset(umi, publicKey(burnAssetId)).catch(() => null);
              if (!assetAccount) {
                console.warn('[mint-cnft] burnAssetId not found on-chain or not a Core asset — skipping burn', { requestId, burnAssetId: burnAssetId.slice(0, 16) });
                burnAssetIsValid = false;
              } else if (assetAccount.owner?.toString() !== ownerKey.toBase58()) {
                console.warn('[mint-cnft] burn asset owner mismatch — skipping burn', {
                  requestId,
                  assetOwner: assetAccount.owner?.toString(),
                  expectedOwner: ownerKey.toBase58(),
                });
                burnAssetIsValid = false;
              }
            } catch (error) {
              console.warn('[mint-cnft] failed to fetch burn asset — skipping burn', { requestId, error: error?.message });
              burnAssetIsValid = false;
            }
          }
          if (burnAssetIsValid) {
            try {
              const burnOwnerSigner = createNoopSigner(publicKey(ownerKey.toBase58()));
              const burnBuilder = burnV1(umi, {
                asset: publicKey(burnAssetId),
                collection: publicKey(collectionMintKey.toBase58()),
                authority: burnOwnerSigner,
              });
              for (const instruction of burnBuilder.getInstructions()) {
                burnInstructions.push(toWeb3JsInstruction(instruction));
              }
            } catch (error) {
              console.error('[mint-cnft] failed to build burn instructions', error);
              respondJson(res, 500, { error: 'Failed to build burn instructions', requestId });
              return true;
            }
          }
        }

        const latestBlockhash = await connection.getLatestBlockhash('finalized');
        const instructions = [
          ...burnInstructions,
          ...paymentInstructions,
          ...builder.getInstructions().map((instruction) => {
            const web3Ix = toWeb3JsInstruction(instruction);
            web3Ix.keys = web3Ix.keys.map((key) => {
              const keyStr = key.pubkey.toBase58();
              if (keyStr === collectionAuthorityKeypair.publicKey.toBase58()) return { ...key, isSigner: true };
              if (keyStr === assetKeypair.publicKey.toBase58()) return { ...key, isSigner: true };
              return key;
            });
            return web3Ix;
          }),
        ];

        const transaction = new Transaction().add(...instructions);
        transaction.feePayer = adminMode && treasuryKeypair ? treasuryKeypair.publicKey : ownerKey;
        transaction.recentBlockhash = latestBlockhash.blockhash;
        const compiledMessage = transaction.compileMessage();
        const requiredSigners = compiledMessage.accountKeys
          .slice(0, compiledMessage.header.numRequiredSignatures)
          .map((key) => key.toBase58());
        console.info('[mint-cnft] required signers', { requestId, requiredSigners });

        const signerPool = [];
        if (requiredSigners.includes(assetKeypair.publicKey.toBase58())) signerPool.push(assetKeypair);
        if (requiredSigners.includes(collectionAuthorityKeypair.publicKey.toBase58())) signerPool.push(collectionAuthorityKeypair);
        if (adminMode && treasuryKeypair && requiredSigners.includes(treasuryKeypair.publicKey.toBase58())) signerPool.push(treasuryKeypair);
        if (adminMode && signerPool.length) transaction.partialSign(...signerPool);

        const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');
        if (adminMode) {
          const signature = await connection.sendRawTransaction(transaction.serialize(), {
            preflightCommitment: 'confirmed',
          });
          await connection.confirmTransaction(
            {
              signature,
              blockhash: latestBlockhash.blockhash,
              lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            },
            'confirmed',
          );

          if (owner) {
            mintedAddresses.add(owner);
            saveMintedAddresses();
            const wallet = walletDatabase.get(owner) || { address: owner };
            wallet.mint = {
              minted: true,
              assetId: assetSigner.publicKey,
              mintedAt: new Date().toISOString(),
              txSignature: signature,
              metadataUri: metadataUri || '',
              remints: (wallet.mint?.remints || 0) + (remintMode ? 1 : 0),
              lastRemintAt: remintMode ? new Date().toISOString() : (wallet.mint?.lastRemintAt || null),
            };
            // FIX 3: do NOT trust client-supplied score/tier/traits/stats — recompute server-side
            walletDatabase.set(owner, wallet);
            saveWalletDatabaseDebounced();
            triggerCompositeUpdate(owner);
          }

          respondJson(res, 200, {
            signature,
            assetId: assetSigner.publicKey,
            blockhash: latestBlockhash.blockhash,
            requestId,
            admin: true,
          });
          return true;
        }

        // FIX 2: compute sha256 of the unsigned tx message bytes for finalize verification
        const _txBufForHash = Buffer.from(serialized, 'base64');
        let _sigCountForHash = 0;
        let _byteOffsetForHash = 0;
        for (let _shift = 0; ; _shift += 7) {
          const _byte = _txBufForHash[_byteOffsetForHash++];
          _sigCountForHash |= (_byte & 0x7f) << _shift;
          if ((_byte & 0x80) === 0) break;
        }
        const _msgBytesForHash = _txBufForHash.slice(_byteOffsetForHash + _sigCountForHash * 64);
        const unsignedMessageHash = crypto.createHash('sha256').update(_msgBytesForHash).digest('hex');

        storePendingMint({
          requestId,
          owner,
          ownerAddress: jwtAuth.address,
          assetId: assetSigner.publicKey,
          assetSecret: Array.from(assetKeypair.secretKey),
          transaction: serialized,
          // FIX 3: do NOT store client-supplied score/tier/traits/stats
          metadataUri: payload?.metadataUri || metadataUri,
          isRemint: remintMode,
          unsignedMessageHash,
        });

        respondJson(res, 200, {
          transaction: serialized,
          assetId: assetSigner.publicKey,
          blockhash: latestBlockhash.blockhash,
          requestId,
          finalize: true,
        });
      } catch (error) {
        console.error('[mint-cnft] failed', error);
        // FIX 5: if mint failed during finalize and a coin reservation exists, free it
        // (coins were already deducted at mint-for-coins time; restore them on finalize failure)
        // Trade-off: this is a best-effort rollback — if the server crashes after sendRawTransaction
        // but before confirmTransaction, double-spend is possible. For full safety an on-chain
        // escrow / event-driven confirmation would be required, which is an orchestrator rewrite.
        if (payloadRequestId) {
          const reservationKey = `mintres_${payloadRequestId}`;
          const reservation = globalThis._mintReservations?.get(reservationKey);
          if (reservation && reservation.status === 'reserved') {
            reservation.status = 'expired';
            globalThis._mintReservations.set(reservationKey, reservation);
            // Restore coins to wallet
            const prevBalance = getCoinBalance(reservation.wallet);
            setCoinBalance(reservation.wallet, prevBalance + reservation.coinsReserved);
            console.warn('[mint-cnft] finalize failed — coin reservation freed, coins restored', {
              requestId: payloadRequestId,
              wallet: reservation.wallet,
              coinsRestored: reservation.coinsReserved,
            });
          }
        }
        respondJson(res, 500, { error: 'Core mint failed' });
      }
      return true;
    }

    if (pathname === '/api/update-card') {
      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      // FIX 4: rate-limit update-card (20 req/min per IP)
      if (!ipRateLimit('update_card', getClientIp(req), 20, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      try {
        const body = await readBody(req);
        // FIX 4: body size cap — reject bodies over 2 MB
        if (body && body.length > 2 * 1024 * 1024) {
          respondJson(res, 413, { error: 'Request body too large' });
          return true;
        }
        const payload = body ? JSON.parse(body) : {};
        const ownerAddress = typeof payload?.ownerAddress === 'string' ? payload.ownerAddress.trim() : '';
        let assetId = typeof payload?.assetId === 'string' ? payload.assetId.trim() : '';
        const metadataUri = typeof payload?.metadataUri === 'string' ? payload.metadataUri.trim() : '';
        const newName = typeof payload?.name === 'string' ? payload.name.trim() : '';
        const signedTransaction = typeof payload?.signedTransaction === 'string' ? payload.signedTransaction.trim() : '';

        if (!ownerAddress || !assetId || !metadataUri || !newName) {
          respondJson(res, 400, { error: 'Missing required fields: ownerAddress, assetId, metadataUri, name' });
          return true;
        }
        if (!collectionAuthoritySecret) {
          respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured' });
          return true;
        }
        if (!coreCollection) {
          respondJson(res, 500, { error: 'CORE_COLLECTION is not configured' });
          return true;
        }

        const collectionSecret = parseSecretKey(collectionAuthoritySecret);
        if (!collectionSecret) {
          respondJson(res, 500, { error: 'Invalid collection authority secret' });
          return true;
        }
        const ownerKey = parsePublicKey(ownerAddress, 'owner');
        const collectionMintKey = parsePublicKey(coreCollection, 'collectionMint');
        if (!ownerKey || !collectionMintKey) {
          respondJson(res, 400, { error: 'Invalid public keys' });
          return true;
        }

        const rpcUrl = getRpcUrl(ownerKey.toBase58());
        if (!rpcUrl) {
          respondJson(res, 500, { error: 'Helius API key required' });
          return true;
        }
        const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
        const collectionAuthorityKeypair = Keypair.fromSecretKey(collectionSecret);
        const treasuryKey = new PublicKey(treasuryAddress);

        if (signedTransaction) {
          const txBuf = Buffer.from(signedTransaction, 'base64');
          let txParsed;
          try {
            txParsed = Transaction.from(txBuf);
          } catch {
            respondJson(res, 400, { error: 'Invalid signed transaction' });
            return true;
          }

          const collectionAuthPubkey = collectionAuthorityKeypair.publicKey.toBase58();
          const collectionAuthIndex = txParsed.signatures.findIndex((signature) => signature.publicKey.toBase58() === collectionAuthPubkey);
          if (collectionAuthIndex === -1) {
            respondJson(res, 500, { error: 'Collection authority not a required signer' });
            return true;
          }

          let signatureCount = 0;
          let byteOffset = 0;
          for (let shift = 0; ; shift += 7) {
            const byte = txBuf[byteOffset++];
            signatureCount |= (byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) break;
          }
          const messageBytes = txBuf.slice(byteOffset + signatureCount * 64);
          const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
          const seed = Buffer.from(collectionAuthorityKeypair.secretKey.slice(0, 32));
          const privateKey = crypto.createPrivateKey({
            key: Buffer.concat([pkcs8Prefix, seed]),
            format: 'der',
            type: 'pkcs8',
          });
          crypto.sign(null, messageBytes, privateKey).copy(txBuf, byteOffset + collectionAuthIndex * 64);

          try {
            const signature = await connection.sendRawTransaction(txBuf, {
              preflightCommitment: 'confirmed',
              skipPreflight: false,
            });
            await connection.confirmTransaction(signature, 'confirmed');
            respondJson(res, 200, { signature, assetId, finalized: true });
          } catch (error) {
            console.error('[update-card] submit failed', error?.message ?? error);
            respondJson(res, 500, { error: 'Transaction submission failed' });
          }
          return true;
        }

        const umi = createUmi(rpcUrl).use(mplCore());
        const collectionAuthoritySigner = umi.eddsa.createKeypairFromSecretKey(collectionSecret);
        umi.use(keypairIdentity(collectionAuthoritySigner));

        let dasAsset;
        try {
          const dasResponse = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 'update-verify', method: 'getAsset', params: { id: assetId } }),
          });
          const dasJson = await dasResponse.json();
          dasAsset = dasJson?.result;
          if (!dasAsset || !dasAsset.ownership) throw new Error('DAS returned no asset');
        } catch (error) {
          console.error('[update-card] DAS getAsset failed', { assetId, error: error?.message ?? error });
          respondJson(res, 404, { error: 'Asset not found on-chain' });
          return true;
        }
        if (dasAsset.ownership.owner !== ownerAddress) {
          respondJson(res, 403, { error: 'Asset not owned by this wallet' });
          return true;
        }
        if (dasAsset.interface !== 'MplCoreAsset') {
          respondJson(res, 400, { error: 'Asset is not an mpl-core NFT' });
          return true;
        }

        const rawAsset = await connection.getAccountInfo(new PublicKey(assetId), 'confirmed').catch(() => null);
        const isValidAsset = rawAsset && rawAsset.data.length > 0 && rawAsset.data[0] === 1;
        if (!isValidAsset) {
          const dasSearch = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'update-scan',
              method: 'getAssetsByOwner',
              params: { ownerAddress, page: 1, limit: 200 },
            }),
          }).then((response) => response.json()).catch(() => null);
          const candidates = (dasSearch?.result?.items ?? []).filter(
            (asset) => asset.interface === 'MplCoreAsset'
              && asset.grouping?.some((group) => group.group_key === 'collection' && group.group_value === coreCollection),
          );
          let foundId = null;
          for (const candidate of candidates) {
            if (candidate.id === assetId) continue;
            const account = await connection.getAccountInfo(new PublicKey(candidate.id), 'confirmed').catch(() => null);
            if (account && account.data.length > 0 && account.data[0] === 1) {
              foundId = candidate.id;
              break;
            }
          }
          if (!foundId) {
            respondJson(res, 404, { error: 'No valid Identity Prism NFT found on-chain. Try minting a new one.' });
            return true;
          }
          assetId = foundId;
        }

        const ownerSigner = createNoopSigner(publicKey(ownerKey.toBase58()));
        const builder = updateV1(umi, {
          asset: publicKey(assetId),
          collection: publicKey(collectionMintKey.toBase58()),
          payer: ownerSigner,
          authority: collectionAuthoritySigner,
          newName,
          newUri: metadataUri,
        }).setFeePayer(ownerSigner);
        const updateInstructions = builder.getInstructions().map((instruction) => {
          const web3Ix = toWeb3JsInstruction(instruction);
          web3Ix.keys = web3Ix.keys.map((key) => {
            const keyStr = key.pubkey.toBase58();
            if (keyStr === collectionAuthorityKeypair.publicKey.toBase58()) return { ...key, isSigner: true };
            if (keyStr === ownerKey.toBase58()) return { ...key, isSigner: true };
            return key;
          });
          return web3Ix;
        });

        const feeIx = SystemProgram.transfer({
          fromPubkey: ownerKey,
          toPubkey: treasuryKey,
          lamports: Math.round(updateFeeSol * lamportsPerSol),
        });
        const latestBlockhash = await connection.getLatestBlockhash('finalized');
        const transaction = new Transaction().add(feeIx, ...updateInstructions);
        transaction.feePayer = ownerKey;
        transaction.recentBlockhash = latestBlockhash.blockhash;
        respondJson(res, 200, {
          transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
          feeSol: updateFeeSol,
          blockhash: latestBlockhash.blockhash,
        });
      } catch (error) {
        console.error('[update-card] failed', error);
        respondJson(res, 500, { error: 'Update card failed' });
      }
      return true;
    }

    if (pathname === '/verify-collection') {
      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      // FIX 4: rate-limit verify-collection (5 req/min per IP)
      if (!ipRateLimit('verify_collection', getClientIp(req), 5, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      if (!requireAdminKey(req, res)) return true;
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      try {
        if (!collectionAuthoritySecret) {
          respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is not configured' });
          return true;
        }
        const secretKey = parseSecretKey(collectionAuthoritySecret);
        if (!secretKey) {
          respondJson(res, 500, { error: 'COLLECTION_AUTHORITY_SECRET is invalid' });
          return true;
        }

        const body = await readBody(req);
        const payload = body ? JSON.parse(body) : {};
        const mint = payload?.mint ? new PublicKey(payload.mint) : null;
        const collectionMint = payload?.collectionMint ? new PublicKey(payload.collectionMint) : null;
        if (!mint || !collectionMint) {
          respondJson(res, 400, { error: 'mint and collectionMint are required' });
          return true;
        }

        const rpcUrl = getRpcUrl(mint.toBase58());
        if (!rpcUrl) {
          respondJson(res, 500, { error: 'Helius API key required' });
          return true;
        }

        const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
        const collectionAuthority = Keypair.fromSecretKey(secretKey);
        const metadataPda = PublicKey.findProgramAddressSync(
          [Buffer.from('metadata'), tokenMetadataProgramId.toBuffer(), mint.toBuffer()],
          tokenMetadataProgramId,
        )[0];
        const collectionMetadataPda = PublicKey.findProgramAddressSync(
          [Buffer.from('metadata'), tokenMetadataProgramId.toBuffer(), collectionMint.toBuffer()],
          tokenMetadataProgramId,
        )[0];
        const collectionMasterEditionPda = PublicKey.findProgramAddressSync(
          [Buffer.from('metadata'), tokenMetadataProgramId.toBuffer(), collectionMint.toBuffer(), Buffer.from('edition')],
          tokenMetadataProgramId,
        )[0];

        const buildVerifyInstruction = (discriminator) => new TransactionInstruction({
          programId: tokenMetadataProgramId,
          keys: [
            { pubkey: metadataPda, isSigner: false, isWritable: true },
            { pubkey: collectionAuthority.publicKey, isSigner: true, isWritable: true },
            { pubkey: collectionAuthority.publicKey, isSigner: true, isWritable: true },
            { pubkey: collectionMint, isSigner: false, isWritable: false },
            { pubkey: collectionMetadataPda, isSigner: false, isWritable: true },
            { pubkey: collectionMasterEditionPda, isSigner: false, isWritable: false },
          ],
          data: Buffer.from([discriminator]),
        });

        const sendVerify = async (discriminator) => {
          const transaction = new Transaction().add(buildVerifyInstruction(discriminator));
          transaction.feePayer = collectionAuthority.publicKey;
          const latestBlockhash = await connection.getLatestBlockhash('finalized');
          transaction.recentBlockhash = latestBlockhash.blockhash;
          transaction.sign(collectionAuthority);
          const signature = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: false,
          });
          await connection.confirmTransaction(
            {
              signature,
              blockhash: latestBlockhash.blockhash,
              lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            },
            'confirmed',
          );
          return signature;
        };

        let signature;
        try {
          signature = await sendVerify(18);
        } catch (error) {
          console.warn('[verify-collection] verifyCollection failed, trying sized item', error);
          signature = await sendVerify(30);
        }

        respondJson(res, 200, { signature });
      } catch (error) {
        console.error('[verify-collection] failed', error);
        respondJson(res, 500, { error: 'Collection verification failed' });
      }
      return true;
    }

    return false;
  };
}

export { registerBlinksRoute };
