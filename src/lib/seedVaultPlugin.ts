import { registerPlugin } from '@capacitor/core';

export interface SeedVaultPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  // Stage B will add: authorize, signMessage, signTransaction, deauthorize
}

export const SeedVault = registerPlugin<SeedVaultPlugin>('SeedVault');
