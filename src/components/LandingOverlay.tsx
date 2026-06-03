import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { CosmicStarfield } from '@/components/CosmicStarfield';
import ScanProgress from '@/components/ScanProgress';
import LegalModal from '@/components/LegalModal';

export interface LandingOverlayProps {
  fadeOut?: boolean;
  passthrough?: boolean;
  isScanning: boolean;
  isConnected?: boolean;
  onEnter?: () => void;
  onDisconnect?: () => void;
  connectedAddress?: string;
  useMobileWallet?: boolean;
  onMobileConnect?: () => void;
  mobileWalletReady?: boolean;
  onDesktopConnect?: () => void;
  desktopWalletReady?: boolean;
  scanningMessageIndex?: number;
  jwtSigning?: boolean;
}

export default function LandingOverlay({
  fadeOut,
  passthrough,
  isScanning,
  isConnected,
  onEnter,
  onDisconnect,
  connectedAddress,
  useMobileWallet,
  onMobileConnect,
  mobileWalletReady,
  onDesktopConnect,
  desktopWalletReady,
  scanningMessageIndex: _scanningMessageIndex,
  jwtSigning,
}: LandingOverlayProps) {
  const showScanning = isScanning;
  const showContent = !isScanning;
  const [legalSlug, setLegalSlug] = useState<string | null>(null);

  return (
    <div className={`landing-persistent-shell${passthrough ? ' passthrough' : ''}${fadeOut ? ' fade-out' : ''}`}>
      {/* Canvas starfield — always drift, never vortex */}
      <CosmicStarfield mode="drift" />

      {/* Cosmic nebulae background (CSS) */}
      <div className="landing-cosmos-bg">
        <div className="landing-nebula landing-nebula-1" />
        <div className="landing-nebula landing-nebula-2" />
        <div className="landing-nebula landing-nebula-3" />
      </div>

      {/* Center content — visible when not scanning */}
      <div className={`landing-center-content${showContent ? ' content-visible' : ' content-hidden'}`}>
        <img src="/phav.png" alt="Identity Prism" className="landing-v3-logo" />
        <p className="landing-v3-eyebrow">IDENTITY PRISM</p>
        <h1 className="landing-v3-title">
          Your Solana identity,
          <br />
          reimagined
        </h1>

        <div className={`landing-v3-actions${isConnected ? ' connected' : ''}`}>
          {isConnected && onEnter ? (
            <div className="landing-v3-connected">
              <div className="landing-v3-wallet-badge">
                <span className="landing-v3-dot" />
                <span className="landing-v3-addr">
                  {connectedAddress?.slice(0, 4)}...{connectedAddress?.slice(-4)}
                </span>
              </div>
              <Button className="landing-v3-enter-btn" onClick={onEnter}>
                ENTER COSMOS
              </Button>
              <button type="button" className="landing-v3-disconnect" onClick={onDisconnect}>
                <LogOut className="w-3 h-3" />
                Disconnect
              </button>
            </div>
          ) : (
            <div className="landing-v3-connect">
              {useMobileWallet && mobileWalletReady ? (
                <Button className="landing-v3-connect-btn" onClick={onMobileConnect}>
                  CONNECT WALLET
                </Button>
              ) : useMobileWallet && !mobileWalletReady && desktopWalletReady ? (
                <Button className="landing-v3-connect-btn" onClick={onDesktopConnect}>
                  CONNECT WALLET
                </Button>
              ) : useMobileWallet ? (
                <Button className="landing-v3-connect-btn" onClick={onMobileConnect} disabled={!mobileWalletReady}>
                  {mobileWalletReady ? 'CONNECT WALLET' : 'GET WALLET'}
                </Button>
              ) : (
                <Button className="landing-v3-connect-btn" onClick={onDesktopConnect}>
                  {desktopWalletReady ? 'CONNECT WALLET' : 'GET WALLET'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer — always at bottom of screen. Legal links open IN-APP (LegalModal),
          not the external browser (which auto-translated them on the APK). */}
      <div className="landing-v3-footer">
        <a href="#privacy" className="landing-v3-link" onClick={(e) => { e.preventDefault(); setLegalSlug('privacy'); }}>
          Privacy
        </a>
        <span className="landing-v3-sep" />
        <a href="#terms" className="landing-v3-link" onClick={(e) => { e.preventDefault(); setLegalSlug('terms'); }}>
          Terms
        </a>
        <span className="landing-v3-sep" />
        <a href="#copyright" className="landing-v3-link" onClick={(e) => { e.preventDefault(); setLegalSlug('copyright'); }}>
          Copyright
        </a>
        <span className="landing-v3-sep" />
        <a href="https://x.com/Identity_Prism" target="_blank" rel="noreferrer" className="landing-v3-link">
          Twitter
        </a>
      </div>

      <LegalModal slug={legalSlug} onClose={() => setLegalSlug(null)} />

      {/* Scan progress overlay */}
      <div className={`vortex-overlay${showScanning ? ' visible' : ''}`}>
        <ScanProgress active={showScanning} authenticating={jwtSigning} />
      </div>
    </div>
  );
}
