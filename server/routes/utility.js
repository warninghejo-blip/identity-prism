import { Connection, PublicKey } from '@solana/web3.js';

function registerUtilityRoute(ctx) {
  const {
    core: {
      getClientIp,
      respondJson,
      readBody,
      getRpcUrl,
      requireJwt,
      normalizePubkey,
      ipRateLimit,
    },
    wallet: {
      walletDatabase,
      saveWalletDatabaseDebounced,
    },
    economy: {
      getPrismEarnRateLimit,
      setPrismEarnRateLimit,
    },
    knownScamAddresses,
  } = ctx;

  return async function handleUtilityRoute(req, res, url, pathname) {
    if (pathname === '/api/migration-status' && req.method === 'GET') {
      // FIX 3: require authentication; caller may only read their own migration record.
      if (!ipRateLimit('migration_status', getClientIp(req), 20, 60000)) {
        return respondJson(res, 429, { error: 'Too many requests' });
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      const address = String(url.searchParams.get('address') ?? '').trim();
      if (!address) return respondJson(res, 400, { error: 'address required' });

      // Enforce: authenticated wallet may only query its own migration record.
      if (normalizePubkey(address) !== normalizePubkey(jwtAuth.address)) {
        return respondJson(res, 403, { error: 'Forbidden' });
      }

      const walletEntry = walletDatabase.get(address);
      if (!walletEntry || !walletEntry._v2MigrationResult) {
        return respondJson(res, 200, { migrated: false });
      }
      const result = walletEntry._v2MigrationResult;
      delete walletEntry._v2MigrationResult;
      walletDatabase.set(address, walletEntry);
      saveWalletDatabaseDebounced();
      return respondJson(res, 200, { migrated: true, migrationData: result });
    }

    if (pathname === '/api/scam-check' && req.method === 'POST') {
      const scamClientIp = getClientIp(req);
      const scamRateLimitKey = `scam:${scamClientIp}`;
      const lastScam = getPrismEarnRateLimit(scamRateLimitKey) || 0;
      if (Date.now() - lastScam < 10_000) return respondJson(res, 429, { error: 'Rate limited' });
      setPrismEarnRateLimit(scamRateLimitKey, Date.now());
      try {
        const { address } = JSON.parse(await readBody(req));
        if (!address) return respondJson(res, 400, { error: 'contract address required' });
        const isKnownScam = knownScamAddresses.has(address);
        let programInfo = null;
        try {
          const connection = new Connection(getRpcUrl(address) || 'https://api.mainnet-beta.solana.com', 'confirmed');
          const info = await connection.getAccountInfo(new PublicKey(address));
          if (info) {
            programInfo = {
              executable: info.executable,
              owner: info.owner?.toBase58(),
              lamports: info.lamports,
              dataSize: info.data?.length || 0,
            };
          }
        } catch {}
        respondJson(res, 200, {
          address,
          isKnownScam,
          isExecutable: programInfo?.executable || false,
          programInfo,
          verdict: isKnownScam ? 'FLAGGED — Known scam contract' : programInfo?.executable ? 'Program found — not in blocklist' : 'Not a program account',
        });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    return false;
  };
}

export { registerUtilityRoute };
