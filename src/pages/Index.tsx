import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { CelestialCard } from "@/components/CelestialCard";
import type { PlanetTier, WalletData, WalletTraits } from "@/hooks/useWalletData";
import { useWalletData } from "@/hooks/useWalletData";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { SolanaMobileWalletAdapterWalletName } from "@solana-mobile/wallet-adapter-mobile";
import { mintIdentityPrism } from "@/lib/mintIdentityPrism";
import { extractMwaAddress, mwaAuthorizationCache } from "@/lib/mwaAuthorizationCache";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, ChevronDown, ChevronUp, Loader2, LogOut, Share2 } from "lucide-react";
import { getMetadataBaseUrl, MINT_CONFIG } from "@/constants";
import { PublicKey } from "@solana/web3.js";
import { getRandomFunnyFact } from "@/utils/funnyFacts";
import html2canvas from "html2canvas";

type ViewState = "landing" | "scanning" | "ready";

const MWA_AUTH_CACHE_KEY = "SolanaMobileWalletAdapterDefaultAuthorizationCache";
const SCANNING_MESSAGES = [
  "Aligning star maps",
  "Decoding Solana signatures",
  "Synchronizing cosmic ledger",
];

const getCachedMwaAddress = async () => {
  try {
    const cached = await mwaAuthorizationCache.get();
    return extractMwaAddress(cached);
  } catch {
    return undefined;
  }
};

const purgeInvalidMwaCache = async () => {
  try {
    const cached = window.localStorage?.getItem(MWA_AUTH_CACHE_KEY);
    if (!cached) return { cleared: false, reason: "missing" };
    const parsed = JSON.parse(cached);
    const accounts = parsed?.accounts;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      await mwaAuthorizationCache.clear();
      window.localStorage?.removeItem(MWA_AUTH_CACHE_KEY);
      return { cleared: true, reason: "empty_accounts" };
    }
    const firstAccount = accounts[0] as { address?: string; publicKey?: string | Record<string, number> } | undefined;
    const hasAddress = Boolean(firstAccount?.address || firstAccount?.publicKey);
    if (!hasAddress) {
      await mwaAuthorizationCache.clear();
      window.localStorage?.removeItem(MWA_AUTH_CACHE_KEY);
      return { cleared: true, reason: "missing_address" };
    }
    return { cleared: false, reason: "valid" };
  } catch (error) {
    try {
      await mwaAuthorizationCache.clear();
      window.localStorage?.removeItem(MWA_AUTH_CACHE_KEY);
    } catch {
      // ignore
    }
    return { cleared: true, reason: "parse_error" };
  }
};

const Index = () => {
  const [searchParams] = useSearchParams();
  const isNftMode = searchParams.get("mode") === "nft";
  const urlAddress = searchParams.get("address");
  const [isWarping, setIsWarping] = useState(false);
  const [viewState, setViewState] = useState<ViewState>(urlAddress ? "ready" : "landing");
  const [scanningMessageIndex, setScanningMessageIndex] = useState(0);
  const cardCaptureRef = useRef<HTMLDivElement | null>(null);

  const wallet = useWallet();
  const {
    publicKey: connectedAddress,
    connected: isConnected,
    disconnect,
    select,
    connect,
    wallets: availableWallets,
    wallet: selectedWallet,
  } = wallet;
  const { setVisible: setWalletModalVisible } = useWalletModal();

  const [activeAddress, setActiveAddress] = useState<string | undefined>(urlAddress || undefined);

  useEffect(() => {
    if (!urlAddress) return;
    try {
      new PublicKey(urlAddress);
      if (activeAddress !== urlAddress) {
        setActiveAddress(urlAddress);
      }
      if (viewState === "landing") {
        setViewState("ready");
      }
    } catch (error) {
      console.error("Invalid address in URL", error);
      if (activeAddress === urlAddress) {
        setActiveAddress(undefined);
        setViewState("landing");
      }
    }
  }, [urlAddress, activeAddress, viewState]);

  const isCapacitor = Boolean((globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
  const isMobileBrowser = /android|iphone|ipad|ipod/i.test(globalThis.navigator?.userAgent ?? '');
  const useMobileWallet = isCapacitor || isMobileBrowser;

  const mobileWallet = useMemo(
    () => availableWallets.find((w) => w.adapter.name === SolanaMobileWalletAdapterWalletName),
    [availableWallets]
  );
  const phantomWallet = useMemo(
    () => availableWallets.find((w) => w.adapter.name === "Phantom"),
    [availableWallets]
  );
  const isWalletUsable = (candidate?: typeof mobileWallet) =>
    candidate?.readyState === WalletReadyState.Installed ||
    candidate?.readyState === WalletReadyState.Loadable;
  const mobileWalletReady = isWalletUsable(mobileWallet);
  const phantomWalletReady = isWalletUsable(phantomWallet);
  const isPhantomInstalled = phantomWallet?.readyState === WalletReadyState.Installed;
  const mobileConnectReady = isPhantomInstalled ? phantomWalletReady : mobileWalletReady;
  const preferredDesktopWallet = phantomWallet ?? availableWallets[0];
  const desktopWalletReady = isWalletUsable(preferredDesktopWallet);

  useEffect(() => {
    const adapter = mobileWallet?.adapter;
    if (!adapter) return;

    const handleConnect = (pubKey: PublicKey) => {
      if (!activeAddress) {
        const resolved = pubKey?.toBase58?.();
        if (resolved) {
          console.log("[MobileConnect] Adapter connect event:", resolved);
          setActiveAddress(resolved);
          setViewState("scanning");
        }
      }
    };

    const handleError = (error: unknown) => {
      console.warn("[MobileConnect] Adapter error event:", error);
    };

    adapter.on?.("connect", handleConnect);
    adapter.on?.("error", handleError);
    return () => {
      adapter.off?.("connect", handleConnect);
      adapter.off?.("error", handleError);
    };
  }, [mobileWallet?.adapter, activeAddress]);

  useEffect(() => {
    if (viewState !== "scanning") return;
    const interval = window.setInterval(() => {
      setScanningMessageIndex((prev) => (prev + 1) % SCANNING_MESSAGES.length);
    }, 2200);
    return () => window.clearInterval(interval);
  }, [viewState]);

  useEffect(() => {
    if (viewState !== "scanning") {
      setScanningMessageIndex(0);
    }
  }, [viewState]);

  const [debugClicks, setDebugClicks] = useState(0);
  const handleDebugTrigger = () => {
    const newCount = debugClicks + 1;
    if (newCount >= 5) {
      try {
        window.localStorage?.setItem('debug', 'true');
      } catch {
        // ignore storage failures
      }
      window.location.search = "debug=true";
    } else {
      setDebugClicks(newCount);
      if (newCount > 1) toast.info(`Debug mode in ${5 - newCount} clicks...`);
    }
  };

  const handleMobileConnect = useCallback(async () => {
    const isPhantomAvailable = phantomWallet?.readyState === WalletReadyState.Installed;
    const targetWallet = isPhantomAvailable ? phantomWallet : mobileWallet;

    if (!targetWallet) {
      toast.error("Wallet not detected");
      return;
    }

    console.log("[MobileConnect] Using wallet:", targetWallet.adapter.name);

    try {
      if (isConnected && connectedAddress) {
        setActiveAddress(connectedAddress.toBase58());
        setViewState("scanning");
        return;
      }

      select(targetWallet.adapter.name);
      console.log("[MobileConnect] Calling adapter.connect()...");
      await targetWallet.adapter.connect();

      if (isPhantomAvailable) {
        const resolved = targetWallet.adapter.publicKey?.toBase58();
        if (resolved) {
          setActiveAddress(resolved);
          setViewState("scanning");
          toast.success("Wallet Connected");
          return;
        }
        throw new Error("Phantom connected but public key is missing.");
      }

      console.log("[MobileConnect] Adapter state after connect():", {
        connected: targetWallet.adapter.connected,
        publicKey: targetWallet.adapter.publicKey?.toBase58(),
        readyState: targetWallet.readyState,
      });

      let attempts = 0;
      const maxAttempts = 20;
      let resolvedAddress: string | undefined;
      while (!resolvedAddress && attempts < maxAttempts) {
        console.log(`[MobileConnect] Waiting for public key... attempt ${attempts + 1}`);
        resolvedAddress = targetWallet.adapter.publicKey?.toBase58();

        if (!resolvedAddress && targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName) {
          const mwaAdapter = targetWallet.adapter as { _authorizationResult?: unknown };
          const internalAddress = extractMwaAddress(mwaAdapter._authorizationResult);
          if (internalAddress) {
            console.log("[MobileConnect] Using MWA authorization result address:", internalAddress);
            resolvedAddress = internalAddress;
          }
        }

        if (!resolvedAddress) {
          const cachedAddress = await getCachedMwaAddress();
          if (cachedAddress) {
            console.log("[MobileConnect] Using cached MWA address:", cachedAddress);
            resolvedAddress = cachedAddress;
          }
        }

        if (!resolvedAddress) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        attempts++;
      }

      if (resolvedAddress) {
        console.log("[MobileConnect] Success! Resolved Address:", resolvedAddress);
        setActiveAddress(resolvedAddress);
        setViewState("scanning");
        toast.success("Wallet Connected");
      } else {
        console.error("[MobileConnect] Failure: No public key and no cache.");
        try {
          const cacheResult = await purgeInvalidMwaCache();
          if (cacheResult.cleared) {
            console.log("[MobileConnect] Cleared invalid MWA cache:", cacheResult.reason);
          }
        } catch {
          // ignore cache cleanup failures
        }
        if (isConnected) {
          await disconnect();
        }
        const hint =
          targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName
            ? "No public key received. Make sure a Solana Mobile-compatible wallet is installed and approve the request."
            : "Wallet connected but Public Key is missing. Please try again.";
        throw new Error(hint);
      }
    } catch (err) {
      console.error("[MobileConnect] Connection error detail:", err);
      toast.error("Connection failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [phantomWallet, mobileWallet, select, isConnected, connectedAddress, disconnect]);

  const handleDesktopConnect = useCallback(async () => {
    const targetWallet = preferredDesktopWallet;
    if (!targetWallet) {
      toast.error("Wallet not detected");
      return;
    }

    try {
      if (isConnected && connectedAddress) {
        setActiveAddress(connectedAddress.toBase58());
        setViewState("scanning");
        return;
      }

      if (!desktopWalletReady) {
        if (targetWallet.adapter.name === "Phantom") {
          window.open("https://phantom.app/", "_blank", "noopener,noreferrer");
        } else {
          setWalletModalVisible(true);
        }
        return;
      }

      select(targetWallet.adapter.name);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (targetWallet.adapter.connect) {
        await targetWallet.adapter.connect();
      } else {
        await connect();
      }

      const resolved = targetWallet.adapter.publicKey?.toBase58();
      if (resolved) {
        setActiveAddress(resolved);
        setViewState("scanning");
      }
    } catch (err) {
      console.error("[DesktopConnect] Connection error:", err);
      toast.error("Connection failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [preferredDesktopWallet, desktopWalletReady, isConnected, connectedAddress, select, connect, setWalletModalVisible, selectedWallet]);

  // Reset active address if wallet disconnects (keep this for cleanup)
  useEffect(() => {
    if (!isConnected && !activeAddress) {
       // Only reset if we don't have an active address (or if provider confirms disconnect)
    }
  }, [isConnected, activeAddress]);

  const previewMode = import.meta.env.DEV && searchParams.has("preview");
  const resolvedAddress = activeAddress;
  const walletData = useWalletData(resolvedAddress);
  const { traits, score, address, isLoading, error: dataError } = walletData;

  // Unified State Machine for UI
  useEffect(() => {
    if (!resolvedAddress) {
      setViewState("landing");
      return;
    }

    if (isWarping) {
      setViewState("scanning");
      return;
    }

    if (isLoading || !traits) {
      setViewState("scanning");
    } else {
      // Delay to ensure smooth transition
      const timer = setTimeout(() => setViewState("ready"), 300);
      return () => clearTimeout(timer);
    }
  }, [resolvedAddress, isWarping, isLoading, traits]);

  // Removed auto-warp effect
  
  const handleEnter = () => {
    if (connectedAddress) {
      setActiveAddress(connectedAddress.toBase58());
      setIsWarping(true);
      setTimeout(() => setIsWarping(false), 1400);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setActiveAddress(undefined);
    setViewState("landing");
  };

  const [mintState, setMintState] = useState<"idle" | "minting" | "success" | "error">("idle");
  const [isMintPanelOpen, setIsMintPanelOpen] = useState(true);
  const captureCardImage = useCallback(async () => {
    if (!cardCaptureRef.current) {
      throw new Error("Card preview is not ready yet");
    }
    const metadataBaseUrl = getMetadataBaseUrl();
    if (!metadataBaseUrl) throw new Error("Metadata URL missing");

    if (document?.fonts?.ready) await document.fonts.ready;

    const canvas = await html2canvas(cardCaptureRef.current as HTMLDivElement, {
      backgroundColor: "#020408",
      scale: 1.5,
      useCORS: true,
      allowTaint: true,
      logging: false,
      onclone: (doc) => {
        const canvases = doc.getElementsByTagName('canvas');
        for (let i = 0; i < canvases.length; i++) {
          canvases[i].getContext('2d', { willReadFrequently: true });
        }
        const cardFace = doc.querySelector('.celestial-card-face') as HTMLElement | null;
        if (cardFace) {
          cardFace.style.borderRadius = '0px';
          cardFace.style.boxShadow = 'none';
        }
      },
      ignoreElements: (el) => el.classList?.contains('mint-panel') ?? false,
    });

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const response = await fetch(`${metadataBaseUrl}/metadata/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl, contentType: "image/jpeg" }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}. Please check Nginx client_max_body_size or check log: ${text.slice(0, 100)}`);
    }
    const payload = JSON.parse(text);
    if (!payload?.url) {
      throw new Error("Card image URL missing from upload response");
    }
    return payload.url as string;
  }, []);
  const handleMint = useCallback(async () => {
    if (!wallet || !wallet.publicKey || !traits) return;
    
    setMintState("minting");
    try {
      const cardImageUrl = await captureCardImage();
      const result = await mintIdentityPrism({
        wallet,
        address: wallet.publicKey.toBase58(),
        traits,
        score,
        cardImageUrl,
      });
      
      console.log("Mint success:", result);
      setMintState("success");
      toast.success("Identity Secured!", {
        description: `Tx: ${result.signature.slice(0, 8)}...`,
      });
    } catch (err) {
      console.error("Mint error:", err);
      setMintState("error");
      toast.error("Deployment failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setTimeout(() => setMintState("idle"), 3000);
    }
  }, [wallet, traits, score, captureCardImage]);

  const shareInsight = useMemo(() => {
    if (!traits) return "Cosmic insight pending... 🔮";
    const insight = getRandomFunnyFact(traits);
    return insight.length > 120 ? `${insight.slice(0, 117)}...` : insight;
  }, [traits]);

  const handleShare = useCallback(() => {
    if (!traits || !address) {
      toast.error("Card is not ready yet");
      return;
    }

    // Format text with emojis and key stats
    const tierLabel = traits.planetTier.replace("_", " ").toUpperCase();
    const tierEmoji = {
      mercury: "☄️",
      venus: "💛",
      mars: "🔴",
      earth: "🌍",
      neptune: "🔵",
      uranus: "🧊",
      saturn: "🪐",
      jupiter: "🪐",
      sun: "☀️",
      binary_sun: "☀️",
    }[traits.planetTier] ?? "✨";

    const shareText = `🌌 Identity Prism\n\n${tierEmoji} Тир: ${tierLabel}\n💎 Скор: ${score}\n⏳ Возраст: ${traits.walletAgeDays} дней\n\n🔮 Инсайт: ${shareInsight}`;

    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
    const popup = window.open(twitterUrl, "_blank", "noopener,noreferrer");

    if (!popup) {
      toast.error("Popup blocked. Allow popups to share on X.");
    }
  }, [address, score, shareInsight, traits]);

  const showReadyView = previewMode || viewState === "ready";
  const isScrollEnabled = showReadyView && !previewMode && isMintPanelOpen && !isNftMode;

  return (
    <div
      className={`identity-shell relative min-h-screen ${previewMode && !isNftMode ? 'preview-scroll' : ''} ${isScrollEnabled ? 'scrollable-shell' : ''} ${isNftMode ? 'is-nft-view nft-kiosk-mode' : ''}`}
    >
      {isNftMode ? (
        <>
          <div className="absolute inset-0 bg-[#050505] background-base" />
          <div className="nebula-layer nebula-one" />
          <div className="identity-gradient" />
          <div className="flex items-center justify-center w-full h-screen p-0 overflow-hidden relative z-10">
            {walletData.traits ? (
              <CelestialCard data={walletData} />
            ) : (
              <div className="flex flex-col items-center gap-4">
                <img src="/phav.png" className="w-16 h-16 animate-pulse opacity-50" alt="Identity Prism" />
                <div className="text-cyan-500/50 text-xs font-bold tracking-[0.3em] uppercase animate-pulse">
                  Decyphering...
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {traits && (
            <div className="nft-capture" aria-hidden="true">
              <CelestialCard ref={cardCaptureRef} data={walletData} captureMode />
            </div>
          )}
          <div className="absolute inset-0 bg-[#050505] background-base" />
          <div className="nebula-layer nebula-one" />
          <div className="nebula-layer nebula-two" />
          <div className="nebula-layer nebula-three" />
          <div className="identity-gradient" />

          {!showReadyView ? (
            <LandingOverlay
              isScanning={viewState === "scanning"}
              isConnected={isConnected}
              onEnter={handleEnter}
              onDisconnect={handleDisconnect}
              connectedAddress={connectedAddress?.toBase58()}
              useMobileWallet={useMobileWallet}
              onMobileConnect={handleMobileConnect}
              mobileWalletReady={mobileConnectReady}
              onDesktopConnect={handleDesktopConnect}
              desktopWalletReady={desktopWalletReady}
              onDebugTrigger={handleDebugTrigger}
              scanningMessageIndex={scanningMessageIndex}
            />
          ) : (
            <>
              {/* Celestial Card - Center of Screen */}
              {previewMode ? (
                <PreviewGallery />
              ) : (
                <div className={`card-stage ${isMintPanelOpen ? 'controls-open' : 'controls-closed'}`}>
                  <CelestialCard data={walletData} />
                  {!previewMode && (
                    <div className={`mint-panel ${isMintPanelOpen ? 'open' : 'closed'}`}>
                      <button
                        type="button"
                        className="mint-toggle"
                        onClick={() => setIsMintPanelOpen((prev) => !prev)}
                      >
                        {isMintPanelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                        <span>{isMintPanelOpen ? 'Hide controls' : 'Show controls'}</span>
                      </button>
                      <div className="mint-panel-content">
                        <div className="mint-action-row">
                          <Button
                            onClick={handleMint}
                            disabled={mintState === "minting" || isLoading || !isConnected}
                            className="mint-primary-btn"
                          >
                            {mintState === "idle" && <span>MINT IDENTITY</span>}
                            {mintState === "minting" && <Loader2 className="h-5 w-5 animate-spin" />}
                            {mintState === "success" && <span>IDENTITY SECURED</span>}
                          </Button>
                        </div>
                        <div className="mint-meta">
                          <span>MINT COST {MINT_CONFIG.PRICE_SOL.toFixed(2)} SOL</span>
                        </div>
                        <Button variant="ghost" onClick={handleShare} className="mint-share-btn">
                          <Share2 className="h-4 w-4 mr-2" />
                          SHARE TO TWITTER
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setActiveAddress(undefined);
                            setViewState("landing");
                          }}
                          className="mint-secondary-btn"
                        >
                          <ArrowLeft className="h-4 w-4 mr-2" />
                          BACK
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {walletData?.error && !showReadyView && (
            <div className="prism-error-toast">
              <AlertCircle className="h-4 w-4" />
              <span>{walletData.error}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};

function LandingOverlay({ 
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
  onDebugTrigger,
  scanningMessageIndex
}: { 
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
  onDebugTrigger?: () => void;
  scanningMessageIndex?: number;
}) {
  if (isScanning) {
    const activeMessage = SCANNING_MESSAGES[scanningMessageIndex ?? 0] ?? SCANNING_MESSAGES[0];
    return (
      <div className="warp-overlay scanning-overlay">
        <div className="warp-content">
          <img src="/phav.png" alt="Identity Prism" className="scanning-logo" />
          <div className="scanning-progress">
            <div className="scanning-bar"></div>
          </div>
          <div className="scanning-status">
            <span key={activeMessage} className="scanning-status-line">
              {activeMessage}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="landing-wrap-v2">
      <div className="landing-card-v2 glass-panel">
        <div className="landing-header-v2">
          <div className="glow-icon-container">
            <img src="/phav.png" alt="Identity Prism" className="h-24 w-24 mx-auto mb-6 glow-logo" />
          </div>
          <p 
            className="landing-eyebrow cursor-pointer select-none"
            onClick={onDebugTrigger}
          >
            Identity Prism v3.2
          </p>
          <h1 className="landing-title-v2">Decode your cosmic signature.</h1>
        </div>
        
        <div className="landing-actions-v2">
          {isConnected && onEnter ? (
             <div className="w-full flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-500">
                <div className="w-full p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-center">
                   <p className="text-cyan-200 text-[10px] mb-1 uppercase tracking-widest font-bold">Wallet Connected</p>
                   <p className="text-white font-mono text-sm font-medium truncate max-w-[200px] mx-auto">
                      {connectedAddress?.slice(0, 4)}...{connectedAddress?.slice(-4)}
                   </p>
                </div>
                
                <Button 
                  className="w-full h-12 bg-cyan-500 hover:bg-cyan-400 text-black font-bold tracking-[0.2em] text-sm shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all hover:scale-105"
                  onClick={onEnter}
                >
                  ENTER COSMOS
                </Button>
                
                <div className="flex items-center gap-3 text-white/30 text-[10px] uppercase tracking-widest mt-2">
                  <div className="h-px w-12 bg-white/10" />
                  <span>or</span>
                  <div className="h-px w-12 bg-white/10" />
                </div>

                <Button 
                  variant="ghost" 
                  className="text-red-400/60 hover:text-red-300 hover:bg-red-500/10 text-xs uppercase tracking-wider h-8 gap-2"
                  onClick={onDisconnect}
                >
                  <LogOut className="w-3 h-3" />
                  Disconnect
                </Button>
             </div>
          ) : (
            <div className="flex justify-center w-full">
              {useMobileWallet ? (
                <Button
                  className="w-full h-12 bg-cyan-500 hover:bg-cyan-400 text-black font-bold tracking-[0.2em] text-sm shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all hover:scale-105"
                  onClick={onMobileConnect}
                  disabled={!mobileWalletReady}
                >
                  {mobileWalletReady ? "CONNECT WALLET" : "GET WALLET"}
                </Button>
              ) : (
                <Button
                  className="w-full h-12 bg-cyan-500 hover:bg-cyan-400 text-black font-bold tracking-[0.2em] text-sm shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all hover:scale-105"
                  onClick={onDesktopConnect}
                >
                  {desktopWalletReady ? "CONNECT WALLET" : "GET WALLET"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Index;

const PREVIEW_TIERS: PlanetTier[] = [
  "mercury",
  "mars",
  "venus",
  "earth",
  "neptune",
  "uranus",
  "saturn",
  "jupiter",
  "sun",
  "binary_sun",
];

const PREVIEW_SCORE: Record<PlanetTier, number> = {
  mercury: 50,
  mars: 150,
  venus: 300,
  earth: 450,
  neptune: 600,
  uranus: 760,
  saturn: 900,
  jupiter: 1000,
  sun: 1150,
  binary_sun: 1300,
};

function buildPreviewTraits(tier: PlanetTier): WalletTraits {
  const base: WalletTraits = {
    hasSeeker: tier !== "mercury",
    hasPreorder: tier === "sun" || tier === "binary_sun",
    hasCombo: tier === "binary_sun",
    isOG: tier !== "mercury",
    isWhale: tier === "sun" || tier === "binary_sun",
    isCollector: tier !== "mercury",
    isEarlyAdopter: tier === "sun" || tier === "binary_sun",
    isTxTitan: tier === "jupiter" || tier === "sun" || tier === "binary_sun",
    isSolanaMaxi: tier === "binary_sun",
    isBlueChip: tier === "jupiter" || tier === "sun" || tier === "binary_sun",
    isDeFiKing: tier === "saturn" || tier === "jupiter" || tier === "sun" || tier === "binary_sun",
    uniqueTokenCount: 40,
    nftCount: 12,
    txCount: 800,
    memeCoinsHeld: [],
    isMemeLord: tier === "venus" || tier === "earth",
    hyperactiveDegen: tier === "mars" || tier === "venus",
    diamondHands: tier === "sun" || tier === "binary_sun",
    avgTxPerDay30d: 3.4,
    daysSinceLastTx: 1,
    solBalance: tier === "binary_sun" ? 18 : tier === "sun" ? 12 : tier === "jupiter" ? 8 : 2.5,
    solBonusApplied: 0,
    walletAgeDays: tier === "binary_sun" ? 900 : tier === "sun" ? 700 : tier === "jupiter" ? 500 : 200,
    walletAgeBonus: 0,
    planetTier: tier,
    totalAssetsCount: 42,
    solTier:
      tier === "binary_sun" || tier === "sun"
        ? "whale"
        : tier === "jupiter"
          ? "dolphin"
          : "shrimp",
  };

  return base;
}

function buildPreviewWalletData(tier: PlanetTier): WalletData {
  return {
    address: `Preview-${tier}`,
    score: PREVIEW_SCORE[tier],
    traits: buildPreviewTraits(tier),
    isLoading: false,
    error: null,
  };
}

function PreviewGallery() {
  return (
    <div className="relative z-10 w-full px-6 pt-24 pb-32">
      <div className="text-center mb-12">
        <p className="text-xs tracking-[0.4em] uppercase text-cyan-200/60">Preview Deck</p>
        <h2 className="text-3xl font-black text-white mt-3">All Planet Tiers</h2>
      </div>
      <div className="preview-grid">
        {PREVIEW_TIERS.map((tier) => (
          <div key={tier} className="preview-card">
            <CelestialCard data={buildPreviewWalletData(tier)} />
          </div>
        ))}
      </div>
    </div>
  );
}
