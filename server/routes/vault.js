function registerVaultRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      requireJwt,
      readBody,
    },
    wallet: {
      walletDatabase,
      getCoinBalance,
      setCoinBalance,
      addCoinSpent,
      addCoinEarned,
      saveWalletDatabaseDebounced,
    },
    economy: {
      pendingStakingOps,
      totalBurned,
      stakingTiers,
      getLockTier,
      calcUnclaimedYield,
      bracketsDeployTs,
      calcDailyYieldForAmount,
      getEffectiveRate,
      getRateSchedule,
      refundCoinSpent = () => {},
    },
    pushNotification,
  } = ctx;

  return async function handleVaultRoute(req, res, url, pathname) {
    if (pathname === '/api/prism/vault/stake' && req.method === 'POST') {
      if (!ipRateLimit('vault_stake', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const addr = jwtAuth.address;
      if (pendingStakingOps.has(addr)) return respondJson(res, 429, { error: 'Staking operation in progress' });
      pendingStakingOps.add(addr);
      try {
        const body = JSON.parse(await readBody(req));
        const { amount, tier } = body;
        const lockDays = Number.isInteger(body.lockDays) && body.lockDays > 0 ? body.lockDays : 7;
        const tierConfig = stakingTiers[tier];
        if (!tierConfig) return respondJson(res, 400, { error: 'Invalid tier. Use: bronze, silver, gold' });
        if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < tierConfig.minStake) {
          return respondJson(res, 400, { error: `Minimum stake for ${tier}: ${tierConfig.minStake} Coins (integer)` });
        }
        const MAX_STAKE_PER_WALLET = 500_000;
        if (amount > MAX_STAKE_PER_WALLET) {
          return respondJson(res, 400, { error: `Maximum stake: ${MAX_STAKE_PER_WALLET} Coins` });
        }
        const bal = getCoinBalance(addr);
        if (bal < amount) return respondJson(res, 400, { error: 'Insufficient balance' });
        const w = walletDatabase.get(addr) || { address: addr };
        if (w.staking && w.staking.amount > 0) {
          return respondJson(res, 400, { error: 'Already staking. Unstake first to change tier.' });
        }
        const lockTier = getLockTier(lockDays);
        setCoinBalance(addr, bal - amount);
        addCoinSpent(addr, amount);
        w.staking = {
          amount, tier,
          startTime: Date.now(), lastClaimTime: Date.now(),
          lockEnd: Date.now() + lockTier.days * 24 * 60 * 60 * 1000,
          lockDays: lockTier.days,
          yieldMultiplier: lockTier.yieldMultiplier,
          earlyPenalty: lockTier.earlyPenalty,
        };
        w.coins = bal - amount;
        walletDatabase.set(addr, w);
        saveWalletDatabaseDebounced();
        pushNotification(addr, 'system', `Vault stake started — ${amount.toLocaleString()} Coins locked for ${lockTier.days} days`, {
          source: 'vault_stake',
          amount,
          tier,
          lockDays: lockTier.days,
        });
        respondJson(res, 200, { success: true, staking: w.staking, newBalance: bal - amount });
      } catch {
        respondJson(res, 400, { error: 'Invalid JSON body' });
      } finally {
        pendingStakingOps.delete(addr);
      }
      return true;
    }

    if (pathname === '/api/prism/vault/claim' && req.method === 'POST') {
      if (!ipRateLimit('vault_claim', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const addr = jwtAuth.address;
      if (pendingStakingOps.has(addr)) return respondJson(res, 429, { error: 'Staking operation in progress' });
      pendingStakingOps.add(addr);
      try {
        const w = walletDatabase.get(addr);
        if (!w?.staking || !w.staking.amount) {
          respondJson(res, 400, { error: 'No active stake' });
          return true;
        }
        const yieldAmount = calcUnclaimedYield(w.staking);
        if (yieldAmount <= 0) {
          respondJson(res, 200, { success: true, claimed: 0, message: 'No yield to claim yet' });
          return true;
        }
        const bal = getCoinBalance(addr);
        setCoinBalance(addr, bal + yieldAmount);
        addCoinEarned(addr, yieldAmount);
        w.staking.lastClaimTime = Date.now();
        w.coins = bal + yieldAmount;
        walletDatabase.set(addr, w);
        saveWalletDatabaseDebounced();
        pushNotification(addr, 'system', `Vault yield claimed — +${yieldAmount.toLocaleString()} Coins`, {
          source: 'vault_claim',
          claimed: yieldAmount,
          tier: w.staking.tier,
          stakedAmount: w.staking.amount,
        });
        respondJson(res, 200, { success: true, claimed: yieldAmount, newBalance: bal + yieldAmount });
      } finally {
        pendingStakingOps.delete(addr);
      }
      return true;
    }

    if (pathname === '/api/prism/vault/unstake' && req.method === 'POST') {
      if (!ipRateLimit('vault_unstake', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const addr = jwtAuth.address;
      if (pendingStakingOps.has(addr)) return respondJson(res, 429, { error: 'Staking operation in progress' });
      pendingStakingOps.add(addr);
      try {
        const w = walletDatabase.get(addr);
        if (!w?.staking || !w.staking.amount) {
          respondJson(res, 400, { error: 'No active stake' });
          return true;
        }
        const stake = w.staking;
        const now = Date.now();
        const isEarly = now < stake.lockEnd;
        let returnAmount = stake.amount;
        let penalty = 0;
        let burned = 0;
        const yieldAmount = calcUnclaimedYield(stake);
        if (isEarly) {
          const penaltyRate = stake.earlyPenalty != null
            ? stake.earlyPenalty
            : getLockTier(stake.lockDays || 7).earlyPenalty;
          penalty = Math.floor(stake.amount * penaltyRate);
          burned = penalty;
          totalBurned.value += burned;
          returnAmount = stake.amount - penalty;
        }
        const total = returnAmount + yieldAmount;
        const bal = getCoinBalance(addr);
        setCoinBalance(addr, bal + total);
        refundCoinSpent(addr, returnAmount);
        addCoinEarned(addr, yieldAmount);
        w.staking = null;
        w.coins = bal + total;
        walletDatabase.set(addr, w);
        saveWalletDatabaseDebounced();
        pushNotification(
          addr,
          'system',
          isEarly
            ? `Vault unstaked early — ${returnAmount.toLocaleString()} Coins returned, ${penalty.toLocaleString()} burned`
            : `Vault unstaked — ${returnAmount.toLocaleString()} Coins returned${yieldAmount > 0 ? `, +${yieldAmount.toLocaleString()} yield` : ''}`,
          {
            source: 'vault_unstake',
            stakedAmount: stake.amount,
            returned: returnAmount,
            yield: yieldAmount,
            penalty,
            burned,
            early: isEarly,
            tier: stake.tier,
          },
        );
        respondJson(res, 200, { success: true, returned: returnAmount, yield: yieldAmount, penalty, burned, early: isEarly, newBalance: bal + total });
      } finally {
        pendingStakingOps.delete(addr);
      }
      return true;
    }

      if (pathname === '/api/prism/vault/status' && req.method === 'GET') {
      if (!ipRateLimit('vault_st', getClientIp(req), 30, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      const addr = url.searchParams.get('address') || jwtAuth.address;
      if (!addr) return respondJson(res, 400, { error: 'address required' });
      if (addr !== jwtAuth.address) return respondJson(res, 403, { error: 'Address mismatch' });
      const w = walletDatabase.get(addr);
      const stake = w?.staking;
      if (!stake || !stake.amount) return respondJson(res, 200, { staking: null, boostRate: 0 });
      const tierConfig = stakingTiers[stake.tier] || {};
      const unclaimedYield = calcUnclaimedYield(stake);
      const timeLeft = Math.max(0, (stake.lockEnd || 0) - Date.now());
      const lockMult = stake.yieldMultiplier != null ? stake.yieldMultiplier : 1.0;
      const dailyYield = stake.startTime < bracketsDeployTs
        ? Math.floor((tierConfig.rateMultiplier ? calcDailyYieldForAmount(stake.amount, tierConfig.rateMultiplier) : 0))
        : Math.floor(calcDailyYieldForAmount(stake.amount, (tierConfig.rateMultiplier || 1) * lockMult));
      const effectiveRate = getEffectiveRate(stake.amount, (tierConfig.rateMultiplier || 1) * lockMult);
      respondJson(res, 200, {
        staking: {
          amount: stake.amount,
          tier: stake.tier,
          startTime: stake.startTime,
          lockEnd: stake.lockEnd,
          lastClaimTime: stake.lastClaimTime,
          lockDays: stake.lockDays || 7,
          yieldMultiplier: stake.yieldMultiplier || 1.0,
          earlyPenalty: stake.earlyPenalty != null ? stake.earlyPenalty : 0.25,
        },
        unclaimedYield, timeLeft, boostRate: tierConfig.boostRate || 0,
        dailyYield,
        effectiveRate: +(effectiveRate * 100).toFixed(3),
        rateSchedule: getRateSchedule(tierConfig.rateMultiplier || 1),
      });
      return true;
    }

    return false;
  };
}

export { registerVaultRoute };
