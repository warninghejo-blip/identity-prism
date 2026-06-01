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
    const refresh = async (attempt = 0): Promise<void> => {
      const sources = await gatherXPSourcesMerged(address);
      if (cancelled) return;
      const xp = computeRangerXP(sources);
      const local = buildSnapshot(address).xp;
      setSnapshot({
        xp,
        rank: getRangerRank(xp),
        progress: getRankProgress(xp),
        next: getNextRank(xp),
      });
      // If we got only the local snapshot (server fetch failed) and we have
      // more attempts left, retry after a short delay. Typical cause: JWT
      // wasn't cached yet when we mounted right after wallet connect.
      if (xp === local && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        if (!cancelled) await refresh(attempt + 1);
      }
    };
    void refresh();

    return () => {
      cancelled = true;
    };
  }, [address]);

  return snapshot;
}
