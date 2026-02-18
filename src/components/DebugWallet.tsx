import React, { useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

export const DebugWallet = () => {
  const { wallets, connected, publicKey } = useWallet();

  useEffect(() => {
    console.log('[DebugWallet] Wallets available:', wallets.map(w => w.adapter.name));
    console.log('[DebugWallet] Connected:', connected);
    console.log('[DebugWallet] PublicKey:', publicKey?.toBase58());
  }, [wallets, connected, publicKey]);

  return null;
};
