import { useEffect, useState } from 'react';

import {
  computeRangerXP,
  gatherXPSources,
  gatherXPSourcesMerged,
  getNextRank,
  getRangerRank,
  getRankProgress,
  type RangerRank,
} from '@/lib/rangerRanks';

interface RangerProgressSnapshot {
  xp: number;
  rank: RangerRank;
  progress: number;
  next: ReturnType<typeof getNextRank>;
}

function buildSnapshot(address?: string | null): RangerProgressSnapshot {
  const sources = address ? gatherXPSources(address) : {};
  const xp = computeRangerXP(sources);
  return {
    xp,
    rank: getRangerRank(xp),
    progress: getRankProgress(xp),
    next: getNextRank(xp),
  };
}

export function useRangerProgress(address?: string | null): RangerProgressSnapshot {
  const [snapshot, setSnapshot] = useState<RangerProgressSnapshot>(() => buildSnapshot(address));

  useEffect(() => {
    setSnapshot(buildSnapshot(address));
    if (!address) return;

    let cancelled = false;
    gatherXPSourcesMerged(address).then((sources) => {
      if (cancelled) return;
      const xp = computeRangerXP(sources);
      setSnapshot({
        xp,
        rank: getRangerRank(xp),
        progress: getRankProgress(xp),
        next: getNextRank(xp),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return snapshot;
}
