// On-chain score: directly 0–400 (composite on-chain component)
// No intermediate scaling — this IS the final on-chain score.
const MAX_ONCHAIN = 400;

const calculateScore = (traits) => {
  // SOL Balance (max 40)
  let solPts = 0;
  const sol = traits.solBalance;
  if (sol >= 10) solPts = 40;
  else if (sol >= 5) solPts = 34;
  else if (sol >= 1) solPts = 24;
  else if (sol >= 0.5) solPts = 16;
  else if (sol >= 0.1) solPts = 8;

  // Wallet Age (max 100)
  let agePts = 0;
  const age = traits.walletAgeDays;
  if (age >= 730) agePts = 100;
  else if (age >= 365) agePts = 72;
  else if (age >= 180) agePts = 48;
  else if (age >= 90) agePts = 28;
  else if (age >= 30) agePts = 14;
  else if (age >= 7) agePts = 6;

  // Transaction Count (max 80)
  let txPts = 0;
  const tx = traits.txCount;
  if (tx > 5000) txPts = 80;
  else if (tx > 2000) txPts = 64;
  else if (tx > 1000) txPts = 48;
  else if (tx > 500) txPts = 32;
  else if (tx > 100) txPts = 20;
  else if (tx > 50) txPts = 12;
  else txPts = Math.min(Math.round(tx * 0.2), 10);

  // NFT Count (max 32)
  let nftPts = 0;
  const nfts = traits.nftCount;
  if (nfts > 100) nftPts = 32;
  else if (nfts > 50) nftPts = 24;
  else if (nfts > 20) nftPts = 16;
  else if (nfts > 5) nftPts = 8;

  // DeFi Activity (max 30)
  let swapPts = 0;
  const swaps = traits.swapCount ?? 0;
  if (swaps > 100) swapPts = 16;
  else if (swaps > 50) swapPts = 12;
  else if (swaps > 10) swapPts = 8;
  else if (swaps > 0) swapPts = 4;

  const nftTradePts = Math.min(Math.round((traits.nftTradeCount ?? 0) * 0.8), 6);

  let protocolPts = 0;
  const protocolCount = Array.isArray(traits.defiProtocols) ? traits.defiProtocols.length : 0;
  if (protocolCount >= 3) protocolPts = 8;
  else if (protocolCount >= 2) protocolPts = 5;
  else if (protocolCount >= 1) protocolPts = 2;

  // Collection NFTs (max 50)
  const seekerPts = traits.hasSeeker ? 20 : 0;
  const preorderPts = traits.hasPreorder ? 15 : 0;
  const comboPts = traits.hasCombo ? 15 : 0;

  // Badges (max 68)
  const ogPts = traits.isOG ? 14 : 0;
  const titanPts = traits.isTxTitan ? 8 : 0;
  const whalePts = traits.isWhale ? 8 : 0;
  const collectorPts = traits.isCollector ? 6 : 0;
  const earlyPts = traits.isEarlyAdopter ? 6 : 0;
  const maxiPts = traits.isSolanaMaxi ? 6 : 0;
  const blueChipPts = traits.isBlueChip ? 5 : 0;
  const diamondPts = traits.diamondHands ? 5 : 0;
  const defiKingPts = traits.isDeFiKing ? 5 : 0;
  const memeLordPts = traits.isMemeLord ? 3 : 0;
  const hyperactivePts = traits.hyperactiveDegen ? 2 : 0;

  const rawTotal = solPts + agePts + txPts + nftPts
    + swapPts + nftTradePts + protocolPts
    + seekerPts + preorderPts + comboPts
    + ogPts + titanPts + whalePts + collectorPts + earlyPts + maxiPts
    + blueChipPts + diamondPts + defiKingPts + memeLordPts + hyperactivePts;

  const score = Math.min(Math.round(rawTotal), MAX_ONCHAIN);

  const breakdown = {
    solBalance: { pts: solPts, max: 40, raw: sol },
    walletAge: { pts: agePts, max: 100, raw: age },
    transactions: { pts: txPts, max: 80, raw: tx },
    nfts: { pts: nftPts, max: 32, raw: nfts },
    defiActivity: { pts: swapPts + nftTradePts + protocolPts, max: 30, swapPts, nftTradePts, protocolPts, swaps, protocols: protocolCount },
    badges: {
      pts: ogPts + titanPts + whalePts + collectorPts + earlyPts + maxiPts + blueChipPts + diamondPts + defiKingPts + memeLordPts + hyperactivePts,
      max: 68,
      items: [
        ...(ogPts ? ['OG +14'] : []),
        ...(titanPts ? ['TX Titan +8'] : []),
        ...(whalePts ? ['Whale +8'] : []),
        ...(maxiPts ? ['Solana Maxi +6'] : []),
        ...(collectorPts ? ['Collector +6'] : []),
        ...(earlyPts ? ['Early Adopter +6'] : []),
        ...(blueChipPts ? ['Blue Chip +5'] : []),
        ...(diamondPts ? ['Diamond Hands +5'] : []),
        ...(defiKingPts ? ['DeFi King +5'] : []),
        ...(memeLordPts ? ['Meme Lord +3'] : []),
        ...(hyperactivePts ? ['Hyperactive +2'] : []),
      ],
    },
    collection: {
      pts: seekerPts + preorderPts + comboPts,
      max: 50,
      items: [
        ...(seekerPts ? ['Seeker +20'] : []),
        ...(preorderPts ? ['Visionary +15'] : []),
        ...(comboPts ? ['Binary Sun +15'] : []),
      ],
    },
  };

  return { score, breakdown };
};

const normalizeTimestamp = (value) => {
  if (!value) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
};

export const calculateIdentity = (txCount, firstTxTime, solBalance, tokenCount, nftCount, extraTraits = {}) => {
  const normalizedTimestamp = normalizeTimestamp(firstTxTime);
  const walletAgeDays = normalizedTimestamp
    ? Math.max(0, Math.round((Date.now() - normalizedTimestamp) / (1000 * 60 * 60 * 24)))
    : 0;
  const avgTxPerDay = txCount / Math.max(1, walletAgeDays);

  const {
    hasSeeker = false, hasPreorder = false, isBlueChip = false,
    isDeFiKing = false, isMemeLord = false, uniqueTokenCount = tokenCount,
    swapCount = 0, nftTradeCount = 0, stakingCount = 0, defiProtocols = [],
  } = extraTraits ?? {};
  const hasCombo = hasSeeker && hasPreorder;

  const isTxTitan = txCount > 5000;
  const diamondHands = walletAgeDays >= 365 && solBalance >= 1;
  const isOG = walletAgeDays >= 730 && isTxTitan && diamondHands;

  const traits = {
    hasSeeker, hasPreorder, hasCombo, isOG,
    isWhale: solBalance >= 50, isCollector: nftCount >= 10,
    isEarlyAdopter: walletAgeDays >= 730, isTxTitan,
    isSolanaMaxi: solBalance >= 100 && txCount > 100,
    isBlueChip, isDeFiKing, uniqueTokenCount, nftCount, txCount,
    isMemeLord, hyperactiveDegen: avgTxPerDay >= 8,
    diamondHands, solBalance, walletAgeDays,
    swapCount, nftTradeCount, stakingCount, defiProtocols,
  };

  const { score, breakdown } = calculateScore(traits);

  // Tier from on-chain score (0-400)
  let tier = 'mercury';
  if (traits.hasCombo) tier = 'binary_sun';
  else if (score >= 352) tier = 'sun';
  else if (score >= 320) tier = 'jupiter';
  else if (score >= 280) tier = 'saturn';
  else if (score >= 240) tier = 'uranus';
  else if (score >= 192) tier = 'neptune';
  else if (score >= 140) tier = 'earth';
  else if (score >= 88) tier = 'venus';
  else if (score >= 40) tier = 'mars';

  const badges = [];
  if (traits.isOG) badges.push('og');
  if (traits.isWhale) badges.push('whale');
  if (traits.isCollector) badges.push('collector');
  if (traits.hasCombo) badges.push('binary');
  if (traits.isEarlyAdopter) badges.push('early');
  if (traits.isTxTitan) badges.push('titan');
  if (traits.isSolanaMaxi) badges.push('maxi');
  if (traits.hasSeeker) badges.push('seeker');
  if (traits.hasPreorder) badges.push('visionary');

  return { score, tier, badges, scoreBreakdown: breakdown };
};
