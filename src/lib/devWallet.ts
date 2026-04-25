/**
 * DEV WALLET — ADB/automated testing bypass for Seed Vault.
 *
 * Activates ONLY when:
 *   - import.meta.env.DEV is true (Vite dev server)
 *   - VITE_DEV_WALLET=true is set in .env.local
 *
 * Never included in production builds.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

// Random test seed — no real SOL, safe to commit
const DEV_SEED = new Uint8Array([
  108, 59, 172, 133, 209, 215, 233, 105, 121, 162, 83, 253, 173, 32, 206, 172, 114, 100, 33, 38, 42, 153, 123, 150, 240,
  200, 209, 88, 196, 188, 154, 62,
]);

const DEV_KEYPAIR: Keypair = (() => {
  try {
    return Keypair.fromSeed(DEV_SEED);
  } catch {
    return Keypair.generate();
  }
})();

export const DEV_WALLET_ENABLED: boolean = import.meta.env.DEV === true && import.meta.env.VITE_DEV_WALLET === 'true';

export const DEV_PUBLIC_KEY: PublicKey = DEV_KEYPAIR.publicKey;

/**
 * Signs a message with the dev keypair (nacl detached signature).
 * Returns a Uint8Array compatible with Solana wallet adapter's signMessage output.
 */
export function devSignMessage(message: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, DEV_KEYPAIR.secretKey);
}
