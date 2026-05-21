import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Loader2, ShieldCheck, Wallet } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { SolanaMobileWalletAdapterWalletName } from '@solana-mobile/wallet-adapter-mobile';
import { useActiveWalletAddress } from '@/lib/useActiveWalletAddress';
import { getCachedJwt, obtainJwt, setAuthWallet } from '@/components/prism/shared';

interface WalletRequiredProps {
  children: ReactNode;
}

export default function WalletRequired({ children }: WalletRequiredProps) {
  const wallet = useWallet();
  const { publicKey } = wallet;
  const activeAddress = useActiveWalletAddress();
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [authTick, setAuthTick] = useState(0);
  const liveAddress = publicKey?.toBase58();
  const liveHasJwt = useMemo(
    () => Boolean(liveAddress && getCachedJwt(liveAddress)),
    [liveAddress, authTick],
  );
  const canSign = Boolean(publicKey && (wallet.signMessage || wallet.signIn));

  const signWallet = useCallback(async () => {
    if (!publicKey || !canSign) return;
    setSigning(true);
    setSignError(null);
    try {
      const isMwa = wallet.wallet?.adapter.name === SolanaMobileWalletAdapterWalletName;
      const authWallet = {
        publicKey,
        signMessage: wallet.signMessage,
        signIn: wallet.signIn,
        preferSignMessage: isMwa,
        authDelayMs: isMwa ? 350 : 0,
      };
      setAuthWallet(authWallet);
      const jwt = await obtainJwt(authWallet, { forceFresh: true });
      if (!jwt) {
        setSignError('Wallet signature was not approved.');
        return;
      }
      setAuthTick((value) => value + 1);
    } catch (error) {
      setSignError(error instanceof Error ? error.message : 'Wallet signature failed.');
    } finally {
      setSigning(false);
    }
  }, [canSign, publicKey, wallet]);

  if (activeAddress || liveHasJwt) {
    return <>{children}</>;
  }

  if (publicKey) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
        <ShieldCheck className="h-10 w-10 text-cyan-300/70" aria-hidden />
        <h2 className="text-xl font-semibold text-white">Sign wallet to continue</h2>
        <p className="max-w-md text-white/50">
          This area needs a fresh wallet signature so protected checks, coins, and saved progress use the right wallet.
        </p>
        <button
          type="button"
          onClick={signWallet}
          disabled={!canSign || signing}
          className="inline-flex min-h-10 items-center justify-center rounded-xl bg-cyan-400 px-5 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          {signing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Signing...
            </>
          ) : (
            'Sign wallet'
          )}
        </button>
        {signError && <p className="max-w-md text-xs text-red-300/80">{signError}</p>}
      </div>
    );
  }

  if (!activeAddress) {
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
