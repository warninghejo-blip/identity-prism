function registerSpendRoute(ctx) {
  const {
    requireJwt,
    readBody,
    respondJson,
    ipRateLimit,
    getClientIp,
    walletDatabase,
    getCoinBalance,
    setCoinBalance,
    addCoinSpent,
    updateWalletEntry,
    prismTransactions,
    getPrismBalance,
    getOrCreateForgeState,
    mergeForgeEntries,
    getServerRangerSnapshot,
    meetsForgeRequiredRank,
    isForgeUnlockSatisfied,
    applyBurnFee,
    forgeItemMap,
    forgeModuleMap,
    debouncedSavePrism,
  } = ctx;

  return async function handleSpendRoute(req, res, url, pathname) {
      if (pathname === '/api/prism/spend' && req.method === 'POST') {
    if (!ipRateLimit('prism_spend', getClientIp(req), 20, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return true;
    try {
      const {
        address: bodyAddress,
        source,
        amount,
        description,
        itemId: rawItemId,
        moduleId: rawModuleId,
      } = JSON.parse(await readBody(req));
      const address = jwtAuth.address;
      if (bodyAddress && bodyAddress !== address) return respondJson(res, 403, { error: 'Address mismatch' });
      if (!address || !amount) return respondJson(res, 400, { error: 'address and amount required' });
      if (!Number.isFinite(Number(amount))) return respondJson(res, 400, { error: 'invalid amount' });
      const spent = Math.max(0, Math.floor(Number(amount)));
      if (spent <= 0 || spent > 1_000_000) return respondJson(res, 400, { error: 'amount out of range' });
      const sanitizedSource = typeof source === 'string' ? source.slice(0, 50) : 'unknown';
      const itemId = typeof rawItemId === 'string' ? rawItemId.trim() : '';
      const moduleId = typeof rawModuleId === 'string' ? rawModuleId.trim() : '';
      const walletEntry = walletDatabase.get(address) || { address };
      const { forgeState, changed: forgeStateChanged } = getOrCreateForgeState(address, walletEntry);
      const purchaseTimestamp = new Date().toISOString();

      if (sanitizedSource === 'forge_module') {
        const moduleDef = forgeModuleMap.get(moduleId);
        if (!moduleDef) return respondJson(res, 400, { error: 'Valid moduleId required for forge module purchase' });
        if (spent !== Number(moduleDef.price)) return respondJson(res, 400, { error: 'Forge module price mismatch' });
        if (forgeState.modules.some((entry) => entry.moduleId === moduleId)) {
          return respondJson(res, 400, { error: 'Forge module already owned' });
        }
        forgeState.modules = mergeForgeEntries(forgeState.modules, [{ moduleId, purchasedAt: purchaseTimestamp }], 'moduleId');
      } else if (sanitizedSource.startsWith('forge_')) {
        const itemDef = forgeItemMap.get(itemId);
        if (!itemDef) return respondJson(res, 400, { error: 'Valid itemId required for forge purchase' });
        if (sanitizedSource !== `forge_${itemDef.category}`) return respondJson(res, 400, { error: 'Forge item source mismatch' });
        if (spent !== Number(itemDef.price)) return respondJson(res, 400, { error: 'Forge item price mismatch' });
        if (forgeState.items.some((entry) => entry.itemId === itemId)) {
          return respondJson(res, 400, { error: 'Forge item already owned' });
        }
        const rangerSnapshot = getServerRangerSnapshot(address, walletEntry);
        if (!meetsForgeRequiredRank(rangerSnapshot.rank, itemDef.requiredRank)) {
          return respondJson(res, 400, { error: `Requires ${itemDef.requiredRank} rank` });
        }
        if (!isForgeUnlockSatisfied(address, itemId, walletEntry, forgeState)) {
          return respondJson(res, 400, { error: 'Forge unlock condition not met' });
        }
        forgeState.items = mergeForgeEntries(forgeState.items, [{ itemId, purchasedAt: purchaseTimestamp }], 'itemId');
      }

      const currentBal = getCoinBalance(address);
      if (currentBal < spent) return respondJson(res, 400, { error: 'insufficient balance' });
      // Apply 2% burn fee
      const { burned } = applyBurnFee(spent);
      const newBal = currentBal - spent;
      setCoinBalance(address, newBal);
      addCoinSpent(address, spent);
      updateWalletEntry(address, {
        coins: newBal,
        ...(forgeStateChanged || sanitizedSource.startsWith('forge_') ? { forgeState } : {}),
      });
      const tx = {
        id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        address, amount: spent, type: 'spend',
        source: sanitizedSource,
        description: (typeof description === 'string' ? description.slice(0, 200) : `Spent ${spent} Coins (${burned} burned)`),
        timestamp: purchaseTimestamp,
      };
      const txs = prismTransactions.get(address) || [];
      txs.unshift(tx);
      if (txs.length > 500) txs.length = 500;
      prismTransactions.set(address, txs);
      debouncedSavePrism();
      respondJson(res, 200, { balance: getPrismBalance(address), spent });
    } catch (e) { respondJson(res, 400, { error: 'Invalid request body' }); }
    return true;
  }

    return false;
  };
}

export { registerSpendRoute };
