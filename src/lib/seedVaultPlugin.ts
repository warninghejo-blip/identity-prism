import { registerPlugin } from '@capacitor/core';

export interface SeedVaultPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  authorize(opts?: { accountIndex?: number }): Promise<{ authToken: number; address: string; derivationPath: string }>;
  getAuthorizedAccounts(): Promise<{
    accounts: Array<{
      authToken: number;
      seedName?: string;
      accountName?: string;
      address: string;
      derivationPath: string;
      isUserWallet?: boolean;
      isValid?: boolean;
    }>;
  }>;
  signMessage(opts: { authToken: number; message: string; derivationPath?: string }): Promise<{ signature: string }>;
  signTransaction(opts: { authToken: number; transaction: string; derivationPath?: string }): Promise<{ signature: string }>;
  deauthorize(opts: { authToken: number }): Promise<void>;
}

export const SeedVault = registerPlugin<SeedVaultPlugin>('SeedVault');
