import { useEffect, useState } from 'react';

export interface GlobalStats {
  idsMinted: number;
  walletsScanned: number;
  sybilsCaught: number;
  blackHoleOps: number;
  sybilsReported: number;
  clusters: number;
  updatedAt: string;
  cacheTtlSec?: number;
}

export function useGlobalStats(refreshMs = 30_000) {
  const [stats, setStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = () => {
      fetch('/api/stats/global', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!cancelled && data) setStats(data);
        })
        .catch(() => {});
    };

    fetchStats();
    const intervalId = window.setInterval(fetchStats, refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [refreshMs]);

  return stats;
}
