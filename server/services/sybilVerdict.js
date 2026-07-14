const VERDICT_META = {
  unknown: {
    label: 'Unknown / Thin Data',
    summary: 'Too little on-chain history is available to classify this wallet confidently.',
  },
  clean: {
    label: 'Clean',
    summary: 'No meaningful sybil evidence was found across the scanned history.',
  },
  suspicious: {
    label: 'Suspicious',
    summary: 'Suspicious patterns exist, but the evidence is not yet strong enough for a hard sybil call.',
  },
  cluster_linked: {
    label: 'Cluster Linked',
    summary: 'This wallet is linked to a known sybil cluster.',
  },
  probable_sybil: {
    label: 'Probable Sybil',
    summary: 'Multiple independent signals point to coordinated sybil behavior.',
  },
  confirmed_sybil: {
    label: 'Confirmed Sybil',
    summary: 'Strong network evidence ties this wallet to a flagged sybil cluster.',
  },
};

const LOW_CONTEXT_SIGNAL_IDS = new Set(['no_history', 'wallet_age', 'low_token_diversity', 'no_nft_holdings']);

const SIGNAL_REASON_MAP = {
  graph_intelligence: 'Known sybil graph history matched this wallet',
  hub_spoke: 'A shared funder fans out to many sibling wallets',
  funding_chain: 'Funding is layered through intermediary wallets',
  cluster_similarity: 'Sibling wallets share unusually similar funding behavior',
  temporal_cohort: 'Multiple same-funder wallets were created in the same time window',
  repeated_funder: 'The same non-exchange wallet funds this address repeatedly',
  concentrated_funding: 'Most funding comes from one non-exchange wallet',
  low_counterparty: 'Too many transfers involve too few counterparties',
  timing_pattern: 'Transaction timing looks automated rather than human',
  activity_burst: 'Activity is compressed into a short farming burst',
  one_directional_flow: 'Value mostly moves in one direction',
  dust_transactions: 'A large share of transfers are dust-sized',
  drained_balance: 'Funds are consistently drained after receiving value',
  self_transfers: 'Self-transfers suggest transaction-count inflation',
  hour_distribution: 'Hourly activity looks unnaturally uniform',
  airdrop_farming: 'Protocol usage is shallow and farm-like',
  no_weekends: 'Weekend activity is almost absent',
  failed_tx_ratio: 'The wallet has a bot-like failed transaction rate',
  behavior_drift: 'Behavior changed sharply across the wallet lifetime',
  rapid_cycling: 'Funds are cycled in and out too quickly',
  no_history: 'There is very little transaction history to classify',
};

const COMPOSITE_TRUST_RULES = {
  legacy: { useRaw: true, floor: 0, ceil: 100, recoveryCap: 25, allowBadges: true },
  clean: { useRaw: true, floor: 0, ceil: 100, recoveryCap: 25, allowBadges: true },
  unknown: { useRaw: false, floor: 35, ceil: 55, recoveryCap: 10, allowBadges: false },
  suspicious: { useRaw: false, floor: 30, ceil: 60, recoveryCap: 10, allowBadges: false },
  cluster_linked: { useRaw: false, floor: 35, ceil: 50, recoveryCap: 6, allowBadges: false },
  probable_sybil: { useRaw: false, floor: 15, ceil: 35, recoveryCap: 2, allowBadges: false },
  confirmed_sybil: { useRaw: false, floor: 0, ceil: 20, recoveryCap: 0, allowBadges: false },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNumber = (value, fallback = 0) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const uniqueList = (values, limit = 3) => {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
    if (unique.length >= limit) break;
  }
  return unique;
};

const getPositiveReasons = (metrics) => {
  const walletAgeDays = toNumber(metrics.walletAgeDays);
  const activeDaysRatio = toNumber(metrics.activeDaysRatio);
  const uniquePrograms = toNumber(metrics.uniquePrograms);
  const tokenDiversityCount = toNumber(metrics.tokenDiversityCount);
  const nftCount = toNumber(metrics.nftCount);
  const uniqueSenders = toNumber(metrics.uniqueSenders);
  const defiDepth = toNumber(metrics.defiDepth);
  const hasSolDomain = Boolean(metrics.hasSolDomain);

  return uniqueList([
    walletAgeDays > 730 ? 'Long multi-year wallet history lowers sybil risk' : null,
    walletAgeDays > 365 ? 'Wallet age provides meaningful historical context' : null,
    hasSolDomain ? '.sol ownership is a strong identity anchor' : null,
    activeDaysRatio >= 0.15 ? 'Activity is spread across many separate days' : null,
    uniquePrograms >= 8 ? 'Program usage is broad and looks organic' : null,
    tokenDiversityCount >= 10 ? 'Portfolio diversity looks more human than farm-like' : null,
    nftCount >= 3 ? 'NFT history adds non-farming wallet context' : null,
    uniqueSenders >= 5 ? 'Funding comes from varied sources rather than one relay' : null,
    defiDepth >= 2 ? 'The wallet uses multiple DeFi categories instead of shallow touches' : null,
  ]);
};

const getNegativeReasons = (flaggedSignals, verdictKey) => {
  const filtered = flaggedSignals
    .filter((signal) => {
      if (!signal?.detected) return false;
      if (verdictKey === 'cluster_linked') {
        return signal.category === 'network' || signal.weight >= 10;
      }
      if (verdictKey === 'suspicious') {
        return !LOW_CONTEXT_SIGNAL_IDS.has(signal.id) || signal.weight >= 10;
      }
      if (verdictKey === 'unknown') {
        return signal.id === 'no_history';
      }
      return !LOW_CONTEXT_SIGNAL_IDS.has(signal.id);
    })
    .sort((a, b) => toNumber(b.weight) - toNumber(a.weight));

  return uniqueList(filtered.map((signal) => SIGNAL_REASON_MAP[signal.id] || signal.description || signal.name));
};

export function getCompositeTrustProfile({ verdict = null, trustScore = 0, recoveryBonus = 0 } = {}) {
  const rawTrustScore = clamp(toNumber(trustScore), 0, 100);
  const verdictKey = typeof verdict?.key === 'string' && verdict.key ? verdict.key : null;
  const meta = verdictKey ? VERDICT_META[verdictKey] || null : null;
  const rule = COMPOSITE_TRUST_RULES[verdictKey] || COMPOSITE_TRUST_RULES.legacy;
  const baseCompositeTrust = rule.useRaw
    ? rawTrustScore
    : clamp(rawTrustScore, 0, rule.ceil);
  const requestedRecoveryBonus = Math.max(0, toNumber(recoveryBonus));
  const recoveryRoom = Math.max(0, 50 - baseCompositeTrust);
  const appliedRecoveryBonus = Math.min(rule.recoveryCap, requestedRecoveryBonus, recoveryRoom);
  const effectiveTrust = clamp(baseCompositeTrust + appliedRecoveryBonus, 0, 100);

  return {
    verdictKey,
    verdictLabel: verdict?.label || meta?.label || null,
    rawTrustScore,
    baseCompositeTrust,
    verdictAdjustment: baseCompositeTrust - rawTrustScore,
    requestedRecoveryBonus,
    recoveryBonus: appliedRecoveryBonus,
    recoveryCap: rule.recoveryCap,
    effectiveTrust,
    allowBadges: Boolean(rule.allowBadges),
  };
}

export function deriveSybilVerdictFromAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') return null;
  const metrics = analysis.metrics;
  const signals = Array.isArray(analysis.signals) ? analysis.signals : null;
  if (!metrics || !signals) return null;

  const txCount = toNumber(metrics.txCount);
  const siblingCount = toNumber(metrics.siblingCount);
  const fundingChainDepth = toNumber(metrics.fundingChainDepth);
  const topFunderTxCount = toNumber(metrics.topFunderTxCount);
  const topFunderPct = toNumber(metrics.topFunderPct);
  const riskScore = toNumber(analysis.riskScore);
  // Classify on the PRE-bonus trust: the paid ID lifts the displayed score but must
  // not change the sybil verdict (otherwise a $0.03 mint downgrades a real sybil).
  const trustScore = toNumber(analysis.baseTrustScore, toNumber(analysis.trustScore, 100 - riskScore));
  const flaggedSignals = signals.filter((signal) => signal?.detected);
  const strongNetworkCount = flaggedSignals.filter(
    (signal) => signal.category === 'network' && (signal.id === 'graph_intelligence' || signal.severity === 'danger' || toNumber(signal.weight) >= 12),
  ).length;
  const supportingNetworkCount = flaggedSignals.filter((signal) => signal.category === 'network').length;
  const strongBehaviorCount = flaggedSignals.filter(
    (signal) => signal.category !== 'network' && !LOW_CONTEXT_SIGNAL_IDS.has(signal.id) && (signal.severity === 'danger' || toNumber(signal.weight) >= 12),
  ).length;
  const supportingBehaviorCount = flaggedSignals.filter(
    (signal) => signal.category !== 'network' && signal.id !== 'no_history' && toNumber(signal.weight) >= 8,
  ).length;
  const positiveIdentityCount = [
    toNumber(metrics.walletAgeDays) > 365,
    toNumber(metrics.activeDaysRatio) >= 0.15,
    toNumber(metrics.uniquePrograms) >= 8,
    toNumber(metrics.tokenDiversityCount) >= 10,
    toNumber(metrics.nftCount) >= 3,
    toNumber(metrics.uniqueSenders) >= 5,
    Boolean(metrics.hasSolDomain),
    toNumber(metrics.defiDepth) >= 2,
  ].filter(Boolean).length;

  // age + tx + protocol variety are reliable; activeDaysCount is sample-biased (heavy
  // wallets sample few distinct days) and falsely de-established real humans — dropped.
  // For heavy wallets walletAgeDays is an under-estimate (the first-tx walk is time-bounded
  // to keep the scan ≤10s), so a high-volume multi-program wallet is established on the
  // tx-volume proxy regardless of measured age — mirrors scanOrchestrator's looksEstablished.
  const looksEstablished = (toNumber(metrics.walletAgeDays) > 180
    && txCount >= 50
    && toNumber(metrics.uniquePrograms) >= 5)
    || (Boolean(metrics.heavyWallet) && toNumber(metrics.uniquePrograms) >= 8 && txCount >= 500);
  const legacySybilFlag = trustScore < 50;
  const networkConfirmed = flaggedSignals.some((signal) => signal.id === 'graph_intelligence')
    || strongNetworkCount >= 2
    || (strongNetworkCount >= 1 && siblingCount >= 5)
    || (fundingChainDepth >= 2 && supportingNetworkCount >= 1);
  // topFunderPct alone (e.g. 40% of inflow from one exchange) is normal for someone
  // who funds from a single CEX — only treat it as cluster evidence with corroborating
  // siblings, so a thin one-exchange user isn't auto-tagged cluster_linked.
  const clusterLinked = siblingCount >= 2
    || supportingNetworkCount >= 1
    || fundingChainDepth >= 1
    || topFunderTxCount >= 3
    || (topFunderPct >= 40 && siblingCount >= 2);
  const lowRiskOrganicContext = riskScore < 30
    && positiveIdentityCount >= 4
    && siblingCount === 0
    && fundingChainDepth === 0
    && topFunderPct < 40;
  const insufficientData = txCount === 0
    || (txCount < 10 && strongNetworkCount === 0 && strongBehaviorCount === 0 && riskScore < 60);

  let key = 'clean';
  if (lowRiskOrganicContext) {
    key = 'clean';
  } else if (networkConfirmed && riskScore >= 80) {
    key = 'confirmed_sybil';
  } else if (
    riskScore >= 80 &&
    ((legacySybilFlag && (supportingNetworkCount >= 1 || strongBehaviorCount >= 1)) ||
      (supportingNetworkCount >= 1 && strongBehaviorCount >= 1) ||
      strongBehaviorCount >= 2)
  ) {
    key = 'probable_sybil';
  } else if (clusterLinked && !looksEstablished && (riskScore >= 30 || strongBehaviorCount >= 1 || legacySybilFlag)) {
    key = 'cluster_linked';
  } else if (insufficientData) {
    key = 'unknown';
  } else if (riskScore >= 30 || strongBehaviorCount >= 1 || supportingBehaviorCount >= 2 || legacySybilFlag) {
    key = 'suspicious';
  }

  let confidence = 'medium';
  if (key === 'unknown') confidence = 'low';
  else if (key === 'clean') confidence = txCount >= 50 && positiveIdentityCount >= 4 ? 'high' : 'medium';
  else if (key === 'suspicious') confidence = txCount < 10 ? 'low' : 'medium';
  else if (key === 'cluster_linked') confidence = siblingCount >= 5 || supportingNetworkCount >= 2 ? 'medium' : 'low';
  else if (key === 'probable_sybil') confidence = networkConfirmed || strongBehaviorCount >= 2 ? 'high' : 'medium';
  else if (key === 'confirmed_sybil') confidence = txCount >= 50 || networkConfirmed ? 'very_high' : 'high';

  const confidenceScore = {
    low: 35,
    medium: 60,
    high: 78,
    very_high: 92,
  }[confidence];

  let reasons = [];
  if (key === 'clean') {
    reasons = getPositiveReasons(metrics);
    if (reasons.length === 0) reasons = ['No strong sybil signals were detected in the scanned history'];
  } else if (key === 'unknown') {
    reasons = uniqueList([
      SIGNAL_REASON_MAP.no_history,
      txCount < 10 ? 'The scan does not yet have enough transaction depth for a hard verdict' : null,
      supportingNetworkCount === 0 ? 'No strong cluster proof was found in the available history' : null,
    ]);
  } else {
    reasons = getNegativeReasons(flaggedSignals, key);
    if (key === 'cluster_linked' && reasons.length === 0) {
      reasons = ['Funding behavior links this wallet to a suspicious cluster'];
    }
    if ((key === 'probable_sybil' || key === 'confirmed_sybil') && reasons.length === 0) {
      reasons = ['Multiple independent sybil indicators fired on this wallet'];
    }
  }

  const basis = key === 'unknown'
    ? 'insufficient_data'
    : key === 'clean'
      ? 'organic'
      : networkConfirmed
        ? 'network'
        : supportingNetworkCount > 0 && strongBehaviorCount > 0
          ? 'hybrid'
          : supportingNetworkCount > 0
            ? 'network'
            : 'behavioral';

  return {
    key,
    label: VERDICT_META[key].label,
    summary: VERDICT_META[key].summary,
    confidence,
    confidenceScore,
    basis,
    dataQuality: txCount === 0 ? 'none' : txCount < 10 ? 'thin' : txCount < 50 ? 'sampled' : 'rich',
    networkConfirmed,
    legacySybilFlag,
    // Caught/bounty = a clear risk-score line (Risk >= 60 / Trust <= 40), regardless of
    // whether the nuanced key landed on cluster_linked or suspicious. clean/unknown never pay.
    bountyEligible: riskScore >= 60 && key !== 'clean' && key !== 'unknown',
    rewardPath: riskScore >= 60 && key !== 'clean' && key !== 'unknown' ? 'sybil_hunt' : 'scan_wallet',
    reasons,
    evidence: {
      flaggedSignals: flaggedSignals.length,
      strongNetworkCount,
      supportingNetworkCount,
      strongBehaviorCount,
      supportingBehaviorCount,
      positiveIdentityCount,
    },
  };
}

export function getSybilVerdict(analysis) {
  const hasAnalysis = analysis && typeof analysis === 'object';
  let result = analysis?.verdict?.key
    ? analysis.verdict
    : deriveSybilVerdictFromAnalysis(analysis);
  // Sanity guard — remap stale severe verdicts when riskScore doesn't justify them
  const rs = typeof analysis?.riskScore === 'number' ? analysis.riskScore : null;
  if (rs !== null && result?.key) {
    const staleSevereVerdict =
      (result.key === 'confirmed_sybil' && rs < 90) ||
      (result.key === 'probable_sybil' && rs < 80);
    const staleLowRiskClusterVerdict = result.key === 'cluster_linked' && rs < 30;
    if (staleSevereVerdict || staleLowRiskClusterVerdict) {
      const derived = hasAnalysis ? deriveSybilVerdictFromAnalysis({ ...analysis, verdict: null }) : null;
      result = derived || {
        ...result,
        key: 'cluster_linked',
        label: VERDICT_META.cluster_linked.label,
        summary: VERDICT_META.cluster_linked.summary,
        bountyEligible: false,
        rewardPath: 'scan_wallet',
      };
    }
  }
  // Recompute the bounty gate from the current risk-score threshold so that
  // already-cached verdicts (baked before the threshold change) credit catches
  // consistently — and so the client's verdict matches what earn.js will approve.
  if (rs !== null && result?.key) {
    const bounty = rs >= 60 && result.key !== 'clean' && result.key !== 'unknown';
    if (result.bountyEligible !== bounty || result.rewardPath !== (bounty ? 'sybil_hunt' : 'scan_wallet')) {
      result = { ...result, bountyEligible: bounty, rewardPath: bounty ? 'sybil_hunt' : 'scan_wallet' };
    }
  }
  return result;
}

export function getSybilRewardPath(analysis) {
  const verdict = getSybilVerdict(analysis);
  if (verdict?.rewardPath) return verdict.rewardPath;
  const trustScore = toNumber(analysis?.trustScore, null);
  if (trustScore !== null) {
    return trustScore < 50 ? 'sybil_hunt' : 'scan_wallet';
  }
  return 'scan_wallet';
}

export function getSybilQuickVerdict(node) {
  if (!node || typeof node !== 'object' || !Number.isFinite(Number(node.riskScore))) return null;
  if (node.verdictKey) {
    const meta = VERDICT_META[node.verdictKey];
    if (meta) {
      const confidence = node.confidence || (node.bountyEligible ? 'medium' : 'low');
      return {
        key: node.verdictKey,
        label: meta.label,
        summary: meta.summary,
        confidence,
        confidenceScore: confidence === 'medium' ? 60 : 35,
        basis: node.networkConfirmed ? 'network' : 'behavioral',
        dataQuality: 'thin',
        networkConfirmed: Boolean(node.networkConfirmed),
        legacySybilFlag: Boolean(node.bountyEligible),
        bountyEligible: Boolean(node.bountyEligible),
        rewardPath: node.bountyEligible ? 'sybil_hunt' : 'scan_wallet',
        reasons: ['Graph intelligence has partial evidence for this wallet, but no fresh full scan is cached'],
        evidence: {
          flaggedSignals: 0,
          strongNetworkCount: node.networkConfirmed ? 1 : 0,
          supportingNetworkCount: toNumber(node.siblings?.length) >= 2 ? 1 : 0,
          strongBehaviorCount: 0,
          supportingBehaviorCount: 0,
          positiveIdentityCount: 0,
        },
      };
    }
  }
  const riskScore = clamp(toNumber(node.riskScore), 0, 100);
  if (riskScore >= 80) {
    return {
      key: 'probable_sybil',
      label: VERDICT_META.probable_sybil.label,
      summary: 'Graph data marks this wallet as high risk, but it has not been rescanned with the full analyzer yet.',
      confidence: 'medium',
      confidenceScore: 60,
      basis: 'network',
      dataQuality: 'thin',
      networkConfirmed: Boolean(node.networkConfirmed),
      legacySybilFlag: Boolean(node.bountyEligible),
      bountyEligible: Boolean(node.bountyEligible),
      rewardPath: node.bountyEligible ? 'sybil_hunt' : 'scan_wallet',
      reasons: ['High graph risk exists, but this wallet needs a fresh full scan for stronger evidence'],
      evidence: {
        flaggedSignals: 0,
        strongNetworkCount: 1,
        supportingNetworkCount: toNumber(node.siblings?.length) >= 2 ? 1 : 0,
        strongBehaviorCount: 0,
        supportingBehaviorCount: 0,
        positiveIdentityCount: 0,
      },
    };
  }
  if (node.inferredFromCluster || toNumber(node.siblings?.length) >= 2) {
    return {
      key: 'cluster_linked',
      label: VERDICT_META.cluster_linked.label,
      summary: 'Graph data links this wallet to a suspicious cluster, but direct evidence is incomplete.',
      confidence: 'low',
      confidenceScore: 35,
      basis: 'network',
      dataQuality: 'thin',
      networkConfirmed: false,
      legacySybilFlag: false,
      bountyEligible: false,
      rewardPath: 'scan_wallet',
      reasons: ['Cluster links exist in the graph, but this wallet has not been fully rescanned yet'],
      evidence: {
        flaggedSignals: 0,
        strongNetworkCount: 0,
        supportingNetworkCount: 1,
        strongBehaviorCount: 0,
        supportingBehaviorCount: 0,
        positiveIdentityCount: 0,
      },
    };
  }
  if (riskScore >= 40) {
    return {
      key: 'suspicious',
      label: VERDICT_META.suspicious.label,
      summary: VERDICT_META.suspicious.summary,
      confidence: 'low',
      confidenceScore: 35,
      basis: 'behavioral',
      dataQuality: 'thin',
      networkConfirmed: false,
      legacySybilFlag: false,
      bountyEligible: false,
      rewardPath: 'scan_wallet',
      reasons: ['Graph-only risk is elevated, but direct scan evidence is missing'],
      evidence: {
        flaggedSignals: 0,
        strongNetworkCount: 0,
        supportingNetworkCount: 0,
        strongBehaviorCount: 0,
        supportingBehaviorCount: 1,
        positiveIdentityCount: 0,
      },
    };
  }
  return {
    key: 'clean',
    label: VERDICT_META.clean.label,
    summary: VERDICT_META.clean.summary,
    confidence: 'low',
    confidenceScore: 35,
    basis: 'organic',
    dataQuality: 'thin',
    networkConfirmed: false,
    legacySybilFlag: false,
    bountyEligible: false,
    rewardPath: 'scan_wallet',
    reasons: ['No strong graph-based sybil evidence is cached for this wallet'],
    evidence: {
      flaggedSignals: 0,
      strongNetworkCount: 0,
      supportingNetworkCount: 0,
      strongBehaviorCount: 0,
      supportingBehaviorCount: 0,
      positiveIdentityCount: 0,
    },
  };
}
