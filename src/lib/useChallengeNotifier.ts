import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { toast } from 'sonner';
import { getApiBase } from '@/components/prism/shared';

interface ChallengeSnapshot {
  id: string;
  status: string;
  winner?: string | null;
  stakeAmount: number;
  stakeType: string;
}

const POLL_INTERVAL = 20_000;
const STORAGE_KEY = 'ip_challenge_snapshot';
const SUPPRESSED_PATHS = ['/arena', '/market', '/game'];

function getJwt(): string | null {
  try {
    const raw = sessionStorage.getItem('ip_auth_jwt');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; expiresAt: number };
    if (parsed.expiresAt > Date.now() + 60_000) return parsed.token;
  } catch {
    /* ignore */
  }
  return null;
}

function loadSnapshot(): Map<string, ChallengeSnapshot> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as ChallengeSnapshot[];
    return new Map(arr.map((c) => [c.id, c]));
  } catch {
    return new Map();
  }
}

function saveSnapshot(map: Map<string, ChallengeSnapshot>): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...map.values()]));
}

export function useChallengeNotifier(): void {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const location = useLocation();
  const prevSnapshot = useRef<Map<string, ChallengeSnapshot>>(loadSnapshot());

  useEffect(() => {
    if (!address) return;

    const poll = async () => {
      const jwt = getJwt();
      if (!jwt) return;

      // Don't show notifications on pages that have their own polling
      const suppressed = SUPPRESSED_PATHS.some((p) => location.pathname.startsWith(p));

      try {
        const base = getApiBase();
        if (!base) return;
        const res = await fetch(`${base}/api/challenge/my`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const challenges: ChallengeSnapshot[] = (data.challenges || []).map((c: Record<string, unknown>) => ({
          id: c.id as string,
          status: c.status as string,
          winner: c.winner as string | null,
          stakeAmount: c.stakeAmount as number,
          stakeType: c.stakeType as string,
        }));

        const newMap = new Map(challenges.map((c) => [c.id, c]));
        const prev = prevSnapshot.current;

        if (!suppressed) {
          for (const c of challenges) {
            const old = prev.get(c.id);
            if (!old || old.status === c.status) continue;

            if (c.status === 'accepted') {
              toast.info('Your challenge was accepted!');
            } else if (c.status === 'completed') {
              const amount = c.stakeAmount * 2;
              const unit = c.stakeType === 'sol' ? 'SOL' : 'Coins';
              if (c.winner === address) {
                toast.success(`You won! +${amount} ${unit}`);
              } else {
                toast.error(`You lost. -${c.stakeAmount} ${unit}`);
              }
            } else if (c.status === 'cancelled') {
              toast.info('Challenge was cancelled');
            }
          }
        }

        prevSnapshot.current = newMap;
        saveSnapshot(newMap);
      } catch {
        /* ignore network errors */
      }
    };

    // Initial poll
    void poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [address, location.pathname]);
}
