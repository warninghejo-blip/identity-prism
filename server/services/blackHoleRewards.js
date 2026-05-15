export const BLACKHOLE_REWARD_CAP = 500;
export const BLACKHOLE_REWARD_PER_FUNGIBLE = 8;
export const BLACKHOLE_REWARD_PER_NFT = 15;
export const BLACKHOLE_REWARD_PER_NET_MILLI_SOL = 8;

const toSafeInteger = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
};

const toSafeNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
};

export function calculateBlackHoleReward(fungibleResolved, nftResolved, netResolvedSol) {
  const fungibleReward = toSafeInteger(fungibleResolved) * BLACKHOLE_REWARD_PER_FUNGIBLE;
  const nftReward = toSafeInteger(nftResolved) * BLACKHOLE_REWARD_PER_NFT;
  const solReward = Math.max(0, Math.floor(toSafeNumber(netResolvedSol) / 0.001)) * BLACKHOLE_REWARD_PER_NET_MILLI_SOL;

  return Math.min(BLACKHOLE_REWARD_CAP, fungibleReward + nftReward + solReward);
}
