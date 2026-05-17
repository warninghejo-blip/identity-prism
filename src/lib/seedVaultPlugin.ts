import { registerPlugin } from '@capacitor/core';

export interface SeedVaultPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  authorize(): Promise<{ authToken: number; address: string; derivationPath: string }>;
  signMessage(opts: { authToken: number; message: string; derivationPath?: string }): Promise<{ signature: string }>;
  signTransaction(opts: { authToken: number; transaction: string; derivationPath?: string }): Promise<{ signature: string }>;
  deauthorize(opts: { authToken: number }): Promise<void>;
}

export const SeedVault = registerPlugin<SeedVaultPlugin>('SeedVault');
