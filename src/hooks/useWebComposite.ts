/**
 * useWebComposite — web-only composite score.
 * Web users don't earn the Seeker-only signals (humanProof / social / engagement),
 * so the web score depends only on onchain + sybilTrust, re-normalised to the
 * 0-1000 tier ladder. If the wallet does NOT hold a Seeker Genesis NFT, the
 * score is capped at 899 so the binary_sun tier (≥ 950) is gated behind Seeker.
 *
 * Used only by Web* components — APK paths keep the original composite untouched.
 */
import { useMemo } from 'react';
import { useCompositeScore } from './useCompositeScore';
import { useWalletData } from './useWalletData';
import { getCompositeTierFromScore } from '@/lib/constants/tierColors';

// Per server: MAX_ONCHAIN=400 (server/services/scoring.js),
// sybilTrust is clamped to 0..250 (server/services/compositeScore.js).
const MAX_ONCHAIN = 400;
const MAX_SYBIL_TRUST = 250;
const WEB_RAW_MAX = MAX_ONCHAIN + MAX_SYBIL_TRUST; // 650
const TIER_SCALE_MAX = 1000;
const NO_SEEKER_CAP = 899; // max tier without Seeker = "sun" (880-949)

export interface WebComposite {
  score: number;            // 0..1000, capped to 899 if no Seeker
  tier: string;             // mercury..binary_sun
  hasSeeker: boolean;       // whether the wallet holds a Seeker Genesis NFT
  raw: number;              // raw onchain + sybilTrust sum
  rawMax: number;           // ceiling for raw
  normalizedFull: number;   // 0..1000 before Seeker cap
  cappedByNoSeeker: boolean;
  isLoading: boolean;
}

export function useWebComposite(address: string | null): WebComposite {
  const composite = useCompositeScore(address);
  const wallet = useWalletData(address);

  return useMemo(() => {
    const onchain = composite.breakdown?.onchain ?? 0;
    const sybilTrust = composite.breakdown?.sybilTrust ?? 0;
    const raw = Math.max(0, onchain + sybilTrust);
    const normalizedFull = Math.min(
      TIER_SCALE_MAX,
      Math.round((raw / WEB_RAW_MAX) * TIER_SCALE_MAX),
    );
    const hasSeeker = Boolean(wallet?.traits?.hasSeeker);
    const score = hasSeeker
      ? normalizedFull
      : Math.min(normalizedFull, NO_SEEKER_CAP);
    return {
      score,
      tier: getCompositeTierFromScore(score),
      hasSeeker,
      raw,
      rawMax: WEB_RAW_MAX,
      normalizedFull,
      cappedByNoSeeker: !hasSeeker && normalizedFull > NO_SEEKER_CAP,
      isLoading: Boolean(composite.isLoading || wallet?.isLoading),
    };
  }, [composite.breakdown, composite.isLoading, wallet?.traits?.hasSeeker, wallet?.isLoading]);
}
