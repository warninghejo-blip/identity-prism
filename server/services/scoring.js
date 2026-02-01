const MAX_SCORE = 1400;

const SCORING = {
  SEEKER_GENESIS_BONUS: 200,
  CHAPTER2_PREORDER_BONUS: 150,
  COMBO_BONUS: 200,
  BLUE_CHIP_BONUS: 50,
  MEME_LORD_BONUS: 30,
  DEFI_KING_BONUS: 30,
  DIAMOND_HANDS_BONUS: 50,
  HYPERACTIVE_BONUS: 50,
};

const normalizeTimestamp = (value) => {
  if (!value) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
};

const calculateScore = (traits) => {
  let score = 0;

  const sol = traits.solBalance;
  if (sol >= 10) score += 100;
  else if (sol >= 5) score += 85;
  else if (sol >= 1) score += 60;
  else if (sol >= 0.5) score += 40;
  else if (sol >= 0.1) score += 20;

  const age = traits.walletAgeDays;
  if (age > 730) score += 250;
  else if (age > 365) score += 180;
  else if (age > 180) score += 120;
  else if (age > 90) score += 70;
  else if (age > 30) score += 35;
  else if (age > 7) score += 15;

  const tx = traits.txCount;
  if (tx > 5000) score += 200;
  else if (tx > 2000) score += 160;
  else if (tx > 1000) score += 120;
  else if (tx > 500) score += 80;
  else if (tx > 100) score += 50;
  else if (tx > 50) score += 30;
  else score += Math.min(tx * 0.5, 25);

  const nfts = traits.nftCount;
  if (nfts > 100) score += 80;
  else if (nfts > 50) score += 60;
  else if (nfts > 20) score += 40;
  else if (nfts > 5) score += 20;

  if (traits.hasSeeker) score += SCORING.SEEKER_GENESIS_BONUS;
  if (traits.hasPreorder) score += SCORING.CHAPTER2_PREORDER_BONUS;
  if (traits.hasCombo) score += SCORING.COMBO_BONUS;

  if (traits.isBlueChip) score += SCORING.BLUE_CHIP_BONUS;
  if (traits.isDeFiKing) score += SCORING.DEFI_KING_BONUS;
  if (traits.diamondHands) score += SCORING.DIAMOND_HANDS_BONUS;
  if (traits.hyperactiveDegen) score += SCORING.HYPERACTIVE_BONUS;
  if (traits.isMemeLord) score += SCORING.MEME_LORD_BONUS;

  return Math.min(Math.round(score), MAX_SCORE);
};

export const calculateIdentity = (txCount, firstTxTime, solBalance, tokenCount, nftCount) => {
  const normalizedTimestamp = normalizeTimestamp(firstTxTime);
  const walletAgeDays = normalizedTimestamp
    ? Math.floor((Date.now() - normalizedTimestamp) / (1000 * 60 * 60 * 24))
    : 0;
  const avgTxPerDay30d = txCount / Math.max(1, walletAgeDays);

  const hasSeeker = false;
  const hasPreorder = false;
  const hasCombo = hasSeeker && hasPreorder;

  const isBlueChip = false;
  const isDeFiKing = false;
  const isMemeLord = false;

  const isOGByBalance = solBalance >= 5;
  const isOGByAge = walletAgeDays >= 730;
  const isOGByTransactions = txCount >= 1000;

  const traits = {
    hasSeeker,
    hasPreorder,
    hasCombo,
    isOG: isOGByBalance && isOGByAge && isOGByTransactions,
    isWhale: solBalance >= 50,
    isCollector: nftCount >= 10,
    isEarlyAdopter: walletAgeDays >= 730,
    isTxTitan: txCount > 1000,
    isSolanaMaxi: solBalance >= 100 && txCount > 100,
    isBlueChip,
    isDeFiKing,
    uniqueTokenCount: tokenCount,
    nftCount,
    txCount,
    isMemeLord,
    hyperactiveDegen: avgTxPerDay30d >= 8,
    diamondHands: walletAgeDays >= 60,
    solBalance,
    walletAgeDays,
  };

  const score = calculateScore(traits);

  let tier = 'mercury';
  if (traits.hasCombo) tier = 'binary_sun';
  else if (score >= 1051) tier = 'sun';
  else if (score >= 951) tier = 'jupiter';
  else if (score >= 851) tier = 'saturn';
  else if (score >= 701) tier = 'uranus';
  else if (score >= 551) tier = 'neptune';
  else if (score >= 401) tier = 'earth';
  else if (score >= 251) tier = 'venus';
  else if (score >= 101) tier = 'mars';

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
  if (traits.diamondHands) badges.push('diamond_hands');
  if (traits.hyperactiveDegen) badges.push('degen');
  if (traits.isMemeLord) badges.push('meme_lord');
  if (traits.isDeFiKing) badges.push('defi_king');

  return {
    score,
    tier,
    badges,
  };
};
