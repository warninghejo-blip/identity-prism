import { useEffect, useState } from 'react';
import { MINT_CONFIG } from '@/constants';
import { fetchApiJson, getApiBase } from '@/components/prism/shared';

export type MintPayCurrency = 'SOL' | 'SKR' | 'COINS';

/** PRISM-coin price for an Identity mint — must match server `mintCoinCost` in routes/blinks.js. */
export const MINT_COIN_COST = 10000;

/**
 * Cost to mint an Identity Prism, per payment currency, formatted for the mint button.
 * SOL and PRISM are fixed; SKR is a live server quote (~0.03 SOL worth), so the caller
 * passes the fetched amount (null while it loads → shows a "… SKR" placeholder).
 */
export function formatMintCost(payWith: MintPayCurrency, skrAmount: number | null): string {
  if (payWith === 'SOL') return `${MINT_CONFIG.PRICE_SOL} SOL`;
  if (payWith === 'COINS') return `${MINT_COIN_COST.toLocaleString()} PRISM`;
  // SKR — dynamic quote; placeholder until the live amount resolves.
  if (skrAmount == null) return '… SKR';
  return `${Math.round(skrAmount).toLocaleString()} SKR`;
}

type MintQuote = { skrAmount?: number };

/**
 * Mint-cost label for the active payment currency. When SKR is selected it fetches the
 * live quote from the backend (`/api/market/mint-quote`); SOL/PRISM resolve instantly.
 */
export function useMintCost(payWith: MintPayCurrency): string {
  const [skrAmount, setSkrAmount] = useState<number | null>(null);

  useEffect(() => {
    if (payWith !== 'SKR') return;
    let cancelled = false;
    fetchApiJson<MintQuote>(`${getApiBase()}/api/market/mint-quote`)
      .then((data) => {
        if (!cancelled && typeof data?.skrAmount === 'number') setSkrAmount(data.skrAmount);
      })
      .catch(() => {
        /* leave the "… SKR" placeholder if the quote is unavailable */
      });
    return () => {
      cancelled = true;
    };
  }, [payWith]);

  return formatMintCost(payWith, skrAmount);
}
