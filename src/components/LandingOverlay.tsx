import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { CosmicStarfield } from "@/components/CosmicStarfield";

const SCANNING_MESSAGES = [
  "Aligning star maps",
  "Decoding Solana signatures",
  "Synchronizing cosmic ledger",
];

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
  scanningMessageIndex,
}: LandingOverlayProps) {
  const startedScanning = useRef(isScanning);
  const showScanning = isScanning || startedScanning.current;
  const msgIndexRef = useRef(0);
  const [localMsgIndex, setLocalMsgIndex] = useState(0);

  // Cycle scanning messages
  useEffect(() => {
    if (!showScanning) return;
    const interval = setInterval(() => {
      msgIndexRef.current = (msgIndexRef.current + 1) % SCANNING_MESSAGES.length;
      setLocalMsgIndex(msgIndexRef.current);
    }, 2800);
    return () => clearInterval(interval);
  }, [showScanning]);

  const activeMsgIdx = scanningMessageIndex ?? localMsgIndex;
  const activeMessage = SCANNING_MESSAGES[activeMsgIdx] ?? SCANNING_MESSAGES[0];

  const showContent = !isScanning;

  return (
    <div
      className={`landing-persistent-shell${passthrough ? " passthrough" : ""}${fadeOut ? " fade-out" : ""}`}
    >
      {/* Canvas starfield — always drift, never vortex */}
      <CosmicStarfield mode="drift" />

      {/* Cosmic nebulae background (CSS) */}
      <div className="landing-cosmos-bg">
        <div className="landing-nebula landing-nebula-1" />
        <div className="landing-nebula landing-nebula-2" />
        <div className="landing-nebula landing-nebula-3" />
      </div>

      {/* Center content — visible when not scanning */}
      <div className={`landing-center-content${showContent ? " content-visible" : " content-hidden"}`}>
        <img src="/phav.png" alt="Identity Prism" className="landing-v3-logo" />
        <p className="landing-v3-eyebrow">IDENTITY PRISM</p>
        <h1 className="landing-v3-title">
          Your Solana identity,
          <br />
          reimagined
        </h1>

        <div className={`landing-v3-actions${isConnected ? " connected" : ""}`}>
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
              <button className="landing-v3-disconnect" onClick={onDisconnect}>
                <LogOut className="w-3 h-3" />
                Disconnect
              </button>
            </div>
          ) : (
            <div className="landing-v3-connect">
              {useMobileWallet ? (
                <Button
                  className="landing-v3-connect-btn"
                  onClick={onMobileConnect}
                  disabled={!mobileWalletReady}
                >
                  {mobileWalletReady ? "CONNECT WALLET" : "GET WALLET"}
                </Button>
              ) : (
                <Button
                  className="landing-v3-connect-btn"
                  onClick={onDesktopConnect}
                >
                  {desktopWalletReady ? "CONNECT WALLET" : "GET WALLET"}
                </Button>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Footer — always at bottom of screen */}
      <div className="landing-v3-footer">
        <a href="/privacy.html" className="landing-v3-link">Privacy</a>
        <span className="landing-v3-sep" />
        <a href="/terms.html" className="landing-v3-link">Terms</a>
        <span className="landing-v3-sep" />
        <a
          href="https://x.com/Identity_Prism"
          target="_blank"
          rel="noreferrer"
          className="landing-v3-link"
        >
          Twitter
        </a>
      </div>

      {/* Star spinner overlay — small centered spinner during scanning */}
      <div className={`vortex-overlay${showScanning ? " visible" : ""}`}>
        <div className="star-spinner">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <span
              key={i}
              className="star-spinner-dot"
              style={{
                transform: `rotate(${i * 45}deg) translateY(-24px)`,
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </div>
        <span key={`vortex-msg-${activeMsgIdx}`} className="vortex-message">
          {activeMessage}
        </span>
      </div>
    </div>
  );
}
