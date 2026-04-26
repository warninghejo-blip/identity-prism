/**
 * DEV WALLET — ADB/automated testing bypass for Seed Vault.
 *
 * Activates ONLY when:
 *   - import.meta.env.DEV is true (Vite dev server)
 *   - VITE_DEV_WALLET=true is set in .env.local
 *
 * Never included in production builds.
 *
 * Multi-wallet: select via URL param ?wallet=0 or ?wallet=1
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

// Random test seeds — no real SOL, safe to commit
const DEV_SEEDS = [
  // Wallet 1 (original)
  new Uint8Array([
    108, 59, 172, 133, 209, 215, 233, 105, 121, 162, 83, 253, 173, 32, 206, 172, 114, 100, 33, 38, 42, 153, 123, 150,
    240, 200, 209, 88, 196, 188, 154, 62,
  ]),
  // Wallet 2
  new Uint8Array([
    108, 200, 45, 12, 187, 33, 99, 156, 78, 201, 144, 55, 233, 67, 189, 23, 90, 178, 134, 211, 56, 145, 77, 198, 123,
    34, 167, 89, 245, 100, 156, 43,
  ]),
];

function getDevWalletIndex(): number {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const idx = parseInt(params.get('wallet') || '0', 10);
    if (idx >= 0 && idx < DEV_SEEDS.length) return idx;
  }
  return 0;
}

const walletIndex = getDevWalletIndex();

const DEV_KEYPAIR: Keypair = (() => {
  try {
    return Keypair.fromSeed(DEV_SEEDS[walletIndex]);
  } catch {
    return Keypair.generate();
  }
})();

export const DEV_WALLET_ENABLED: boolean = import.meta.env.DEV === true && import.meta.env.VITE_DEV_WALLET === 'true';

export const DEV_WALLET_INDEX: number = walletIndex;
export const DEV_WALLET_COUNT: number = DEV_SEEDS.length;
export const DEV_PUBLIC_KEY: PublicKey = DEV_KEYPAIR.publicKey;

/**
 * Signs a message with the dev keypair (nacl detached signature).
 * Returns a Uint8Array compatible with Solana wallet adapter's signMessage output.
 */
export function devSignMessage(message: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, DEV_KEYPAIR.secretKey);
}
