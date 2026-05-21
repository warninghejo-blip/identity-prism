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
    let controller: AbortController | null = null;

    const fetchStats = () => {
      controller?.abort();
      controller = new AbortController();
      fetch(`/api/stats/global?t=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!cancelled && data) setStats(data);
        })
        .catch((error) => {
          if (error?.name !== 'AbortError') {
            console.warn('[global-stats] refresh failed', error);
          }
        });
    };

    fetchStats();
    const intervalId = window.setInterval(fetchStats, refreshMs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchStats();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      controller?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [refreshMs]);

  return stats;
}
