import crypto from 'node:crypto';

function registerReferralRoute(ctx) {
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
      addCoinEarned,
    },
    fbAvailable,
    fbGet,
    fbSet,
    fbGetAll,
    referralSalt,
  } = ctx;

  return async function handleReferralRoute(req, res, url, pathname) {
    if (pathname === '/api/referral/code' && req.method === 'GET') {
      if (!ipRateLimit('referral_code', getClientIp(req), 10, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      const address = jwtAuth.address;
      if (fbAvailable()) {
        const existing = await fbGet('referralCodes', address);
        if (existing?.code) {
          respondJson(res, 200, { code: existing.code });
          return true;
        }
      }

      const hash = crypto.createHash('sha256').update(address + referralSalt).digest();
      const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let code = '';
      for (let index = 0; index < 6; index += 1) code += alphabet[hash[index] % 58];

      if (fbAvailable()) {
        await fbSet('referralCodes', address, { code, createdAt: Date.now() });
        await fbSet('referralCodes', `code_${code}`, { address });
      }
      respondJson(res, 200, { code });
      return true;
    }

    if (pathname === '/api/referral/claim' && req.method === 'POST') {
      if (!ipRateLimit('ref_claim', getClientIp(req), 10, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      const claimer = jwtAuth.address;
      let refClaimKey;
      try {
        const { code } = JSON.parse(await readBody(req));
        if (!code || typeof code !== 'string') {
          respondJson(res, 400, { error: 'Code required' });
          return true;
        }
        if (!fbAvailable()) {
          respondJson(res, 503, { error: 'Firebase unavailable' });
          return true;
        }

        const codeDoc = await fbGet('referralCodes', `code_${code}`);
        if (!codeDoc?.address) {
          respondJson(res, 400, { error: 'Invalid referral code' });
          return true;
        }
        const referrer = codeDoc.address;
        if (referrer === claimer) {
          respondJson(res, 400, { error: 'Cannot use your own code' });
          return true;
        }

        if (!globalThis._pendingReferralClaims) globalThis._pendingReferralClaims = new Set();
        refClaimKey = `${referrer}_${claimer}`;
        const claimerKey = `claimer_${claimer}`;
        if (globalThis._pendingReferralClaims.has(refClaimKey) || globalThis._pendingReferralClaims.has(claimerKey)) {
          respondJson(res, 409, { error: 'Claim in progress' });
          return true;
        }
        globalThis._pendingReferralClaims.add(refClaimKey);
        globalThis._pendingReferralClaims.add(claimerKey);

        const claimerGlobal = await fbGet('referralClaimers', claimer);
        if (claimerGlobal) {
          globalThis._pendingReferralClaims.delete(refClaimKey);
          globalThis._pendingReferralClaims.delete(claimerKey);
          respondJson(res, 400, { error: 'Already claimed a referral' });
          return true;
        }

        const existingClaim = await fbGet('referrals', refClaimKey);
        if (existingClaim) {
          globalThis._pendingReferralClaims.delete(refClaimKey);
          globalThis._pendingReferralClaims.delete(claimerKey);
          respondJson(res, 400, { error: 'Already claimed a referral' });
          return true;
        }

        const referrerStats = await fbGet('referralStats', referrer);
        if (referrerStats && referrerStats.totalReferred >= 50) {
          globalThis._pendingReferralClaims.delete(refClaimKey);
          globalThis._pendingReferralClaims.delete(claimerKey);
          respondJson(res, 400, { error: 'Referrer has reached maximum referrals' });
          return true;
        }

        // Idempotent 2-phase claim:
        // Phase 1 — write claim marker (pending). If step 2 fails, retry sees this and can resume or skip.
        await fbSet('referralClaimers', claimer, { referrer, code, claimedAt: Date.now(), status: 'pending' });
        await fbSet('referrals', refClaimKey, {
          referrer,
          claimer,
          code,
          timestamp: Date.now(),
          mintBonus: false,
          status: 'pending',
        });

        // Phase 2 — apply balance updates (in-memory, non-transactional; safe to re-apply if idempotent markers are checked)
        setCoinBalance(claimer, getCoinBalance(claimer) + 50);
        addCoinEarned(claimer, 50);
        setCoinBalance(referrer, getCoinBalance(referrer) + 20);
        addCoinEarned(referrer, 20);

        await fbSet('referralStats', referrer, {
          totalReferred: (referrerStats?.totalReferred || 0) + 1,
          totalEarned: (referrerStats?.totalEarned || 0) + 20,
        });

        // Phase 3 — mark complete. If this write fails the client already got a success;
        // on next request the duplicate-check on referralClaimers (status: pending) will reject re-claim,
        // so the worst case is the stats counter is off by 1 (not a balance risk).
        await fbSet('referralClaimers', claimer, { referrer, code, claimedAt: Date.now(), status: 'complete' });
        await fbSet('referrals', refClaimKey, { referrer, claimer, code, timestamp: Date.now(), mintBonus: false, status: 'complete' });

        globalThis._pendingReferralClaims.delete(refClaimKey);
        globalThis._pendingReferralClaims.delete(claimerKey);
        respondJson(res, 200, { success: true, claimerBonus: 50, referrerBonus: 20 });
      } catch {
        if (typeof refClaimKey !== 'undefined') {
          globalThis._pendingReferralClaims?.delete(refClaimKey);
          globalThis._pendingReferralClaims?.delete(`claimer_${claimer}`);
        }
        respondJson(res, 400, { error: 'Invalid request' });
      }
      return true;
    }

    if (pathname === '/api/referral/stats' && req.method === 'GET') {
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      const address = jwtAuth.address;
      if (!fbAvailable()) {
        respondJson(res, 200, { code: null, totalReferred: 0, totalEarned: 0, referrals: [] });
        return true;
      }

      const codeDoc = await fbGet('referralCodes', address);
      const statsDoc = await fbGet('referralStats', address);
      const referrals = [];
      if (statsDoc?.totalReferred > 0) {
        // Use fbGetAll + in-memory filter to avoid direct getDb() dependency
        const allReferrals = await fbGetAll('referrals');
        for (const [, data] of allReferrals) {
          if (data.referrer === address) {
            referrals.push({
              address: data.claimer,
              timestamp: data.timestamp,
              mintBonus: data.mintBonus || false,
            });
          }
        }
        referrals.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        referrals.splice(50);
      }

      respondJson(res, 200, {
        code: codeDoc?.code || null,
        totalReferred: statsDoc?.totalReferred || 0,
        totalEarned: statsDoc?.totalEarned || 0,
        referrals,
      });
      return true;
    }

    return false;
  };
}

export { registerReferralRoute };
