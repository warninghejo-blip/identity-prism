import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Wallet } from 'lucide-react';
import type { ReactNode } from 'react';

interface WalletRequiredProps {
  children: ReactNode;
}

export default function WalletRequired({ children }: WalletRequiredProps) {
  const { publicKey } = useWallet();

  if (!publicKey) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4 text-center">
        <Wallet className="w-10 h-10 text-purple-400/60" />
        <h2 className="text-xl font-semibold text-white">Connect Your Wallet</h2>
        <p className="text-white/50 max-w-md">
          Connect your Solana wallet to access this feature and track your identity score.
        </p>
        <WalletMultiButton />
      </div>
    );
  }

  return <>{children}</>;
}
