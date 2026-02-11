import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useLocation } from "react-router-dom";
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
import { getAppBaseUrl, getHeliusProxyUrl, getMetadataBaseUrl, MINT_CONFIG, SEEKER_TOKEN } from "@/constants";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getRandomFunnyFact } from "@/utils/funnyFacts";
// html2canvas loaded dynamically in renderCardImage()

type ViewState = "landing" | "scanning" | "ready";
type PaymentToken = "SOL" | "SKR";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const storedReturn = sessionStorage.getItem('fromBlackHole') === '1';
  const [fromBlackHole, setFromBlackHole] = useState(Boolean((location.state as any)?.fromBlackHole) || storedReturn);
  const returningFromBH = useRef(Boolean((location.state as any)?.fromBlackHole) || storedReturn);
  const suppressLoadingRef = useRef(Boolean((location.state as any)?.fromBlackHole) || storedReturn);
  const isNftMode = searchParams.get("mode") === "nft";
  const urlAddress = searchParams.get("address");

  const [isWarping, setIsWarping] = useState(false);
  const [viewState, setViewState] = useState<ViewState>(
    returningFromBH.current && urlAddress ? "ready" : (urlAddress ? "scanning" : "landing")
  );
  const [scanningMessageIndex, setScanningMessageIndex] = useState(0);
  const cardCaptureRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mwaErrorRef = useRef<string | null>(null);

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

  const userAgent = globalThis.navigator?.userAgent ?? "";
  const isCapacitor = Boolean(
    (globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  );
  const isAndroidDevice = /android/i.test(userAgent);
  const isMobileBrowser = /android|iphone|ipad|ipod/i.test(userAgent);
  const isIosDevice = /iphone|ipad|ipod/i.test(userAgent);
  const isSeekerDevice = /seeker/i.test(userAgent);
  const isWebView = /(WebView|Version\/.+(Chrome)\/(\d+)\.(\d+)\.(\d+)\.(\d+)|; wv\).+(Chrome)\/(\d+)\.(\d+)\.(\d+)\.(\d+))/i.test(
    userAgent
  );
  const useMobileWallet = isCapacitor || isMobileBrowser;

  const mobileWallet = useMemo(
    () => availableWallets.find((w) => w.adapter.name === SolanaMobileWalletAdapterWalletName),
    [availableWallets]
  );
  const phantomWallet = useMemo(
    () => availableWallets.find((w) => w.adapter.name === "Phantom"),
    [availableWallets]
  );
  const nonMwaWallets = useMemo(
    () => availableWallets.filter((w) => w.adapter.name !== SolanaMobileWalletAdapterWalletName),
    [availableWallets]
  );
  const isWalletUsable = (candidate?: typeof mobileWallet) =>
    candidate?.readyState === WalletReadyState.Installed ||
    candidate?.readyState === WalletReadyState.Loadable;
  const preferredMobileWallet = useMemo(() => {
    const installed = nonMwaWallets.find((wallet) => wallet.readyState === WalletReadyState.Installed);
    if (installed) return installed;
    const loadable = nonMwaWallets.find((wallet) => wallet.readyState === WalletReadyState.Loadable);
    if (loadable) return loadable;
    return mobileWallet;
  }, [nonMwaWallets, mobileWallet]);
  const mobileWalletReady = isWalletUsable(mobileWallet);
  const preferredMobileWalletReady = isWalletUsable(preferredMobileWallet);
  const mobileConnectReady = preferredMobileWalletReady || mobileWalletReady;
  const preferredDesktopWallet = phantomWallet ?? availableWallets[0];
  const desktopWalletReady = isWalletUsable(preferredDesktopWallet);
  const shouldNudgeMwaAssociation = isCapacitor && isAndroidDevice && !isSeekerDevice;

  const startMwaAssociationNudge = useCallback(() => {
    if (!shouldNudgeMwaAssociation) {
      return () => {};
    }
    let ticks = 0;
    let intervalId: number | null = null;
    const dispatchBlur = () => {
      window.dispatchEvent(new Event("blur"));
      ticks += 1;
      if (ticks >= 12 && intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
    intervalId = window.setInterval(dispatchBlur, 250);
    dispatchBlur();
    return () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [shouldNudgeMwaAssociation]);

  useEffect(() => {
    const adapter = mobileWallet?.adapter;
    if (!adapter) return;

    const handleConnect = (pubKey: PublicKey) => {
      if (!activeAddress) {
        const resolved = pubKey?.toBase58?.();
        if (resolved) {
          if (import.meta.env.DEV) console.log("[MobileConnect] Adapter connect event:", resolved);
          setActiveAddress(resolved);
          setViewState("scanning");
        }
      }
    };

    const handleError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error ?? "");
      console.warn("[MobileConnect] Adapter error event:", error);
      mwaErrorRef.current = message;
    };

    adapter.on?.("connect", handleConnect);
    adapter.on?.("error", handleError);
    return () => {
      adapter.off?.("connect", handleConnect);
      adapter.off?.("error", handleError);
    };
  }, [mobileWallet?.adapter, activeAddress]);

  useEffect(() => {
    if (viewState === "scanning") {
      setScanningMessageIndex(0);
    }
  }, [viewState]);

  useEffect(() => {
    if (viewState !== "scanning") return;
    const interval = window.setInterval(() => {
      setScanningMessageIndex((prev) => (prev + 1) % SCANNING_MESSAGES.length);
    }, 1600);
    return () => window.clearInterval(interval);
  }, [viewState]);

  const handleMobileConnect = useCallback(async () => {
    const targetWallet = preferredMobileWallet;
    const targetReady = preferredMobileWalletReady;

    if (!targetWallet || !targetReady) {
      toast.error("Wallet not detected");
      return;
    }

    if (import.meta.env.DEV) console.log("[MobileConnect] Using wallet:", targetWallet.adapter.name);

    const openPhantomDeepLink = () => {
      if (!isIosDevice) {
        return false;
      }
      const encodedUrl = encodeURIComponent(window.location.href);
      const encodedRef = encodeURIComponent(window.location.origin);
      window.location.href = `https://phantom.app/ul/browse/${encodedUrl}?ref=${encodedRef}`;
      return true;
    };

    try {
      mwaErrorRef.current = null;
      if (isConnected && connectedAddress) {
        setActiveAddress(connectedAddress.toBase58());
        setViewState("scanning");
        return;
      }

      select(targetWallet.adapter.name);
      if (import.meta.env.DEV) console.log("[MobileConnect] Calling adapter.connect()...");
      const stopMwaNudge =
        targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName ? startMwaAssociationNudge() : undefined;
      try {
        await targetWallet.adapter.connect();
      } finally {
        stopMwaNudge?.();
      }

      if (targetWallet.adapter.name !== SolanaMobileWalletAdapterWalletName) {
        const resolved = targetWallet.adapter.publicKey?.toBase58();
        if (resolved) {
          setActiveAddress(resolved);
          setViewState("scanning");
          toast.success("Wallet Connected");
          return;
        }
        if (targetWallet.readyState === WalletReadyState.Loadable) {
          return;
        }
        throw new Error(`${targetWallet.adapter.name} connected but public key is missing.`);
      }

      if (import.meta.env.DEV) console.log("[MobileConnect] Adapter state after connect():", {
        connected: targetWallet.adapter.connected,
        publicKey: targetWallet.adapter.publicKey?.toBase58(),
        readyState: targetWallet.readyState,
      });

      let attempts = 0;
      const maxAttempts = 60;
      const pollIntervalMs = 200;
      let resolvedAddress: string | undefined;
      while (!resolvedAddress && attempts < maxAttempts) {
        if (import.meta.env.DEV) console.log(`[MobileConnect] Waiting for public key... attempt ${attempts + 1}`);
        resolvedAddress = targetWallet.adapter.publicKey?.toBase58();

        if (!resolvedAddress && targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName) {
          const mwaAdapter = targetWallet.adapter as { _authorizationResult?: unknown };
          const internalAddress = extractMwaAddress(mwaAdapter._authorizationResult);
          if (internalAddress) {
            if (import.meta.env.DEV) console.log("[MobileConnect] Using MWA authorization result address:", internalAddress);
            resolvedAddress = internalAddress;
          }
        }

        if (!resolvedAddress && targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName) {
          const message = mwaErrorRef.current ?? "";
          if (message.includes("mobile wallet protocol") || message.includes("ERROR_WALLET_NOT_FOUND")) {
            if (isConnected) {
              await disconnect();
            }
            if (openPhantomDeepLink()) {
              return;
            }
          }
        }

        if (!resolvedAddress) {
          const cachedAddress = await getCachedMwaAddress();
          if (cachedAddress) {
            if (import.meta.env.DEV) console.log("[MobileConnect] Using cached MWA address:", cachedAddress);
            resolvedAddress = cachedAddress;
          }
        }

        if (!resolvedAddress) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        attempts++;
      }

      if (resolvedAddress) {
        if (import.meta.env.DEV) console.log("[MobileConnect] Success! Resolved Address:", resolvedAddress);
        setActiveAddress(resolvedAddress);
        setViewState("scanning");
        toast.success("Wallet Connected");
      } else {
        console.error("[MobileConnect] Failure: No public key and no cache.");
        try {
          const cacheResult = await purgeInvalidMwaCache();
          if (cacheResult.cleared) {
            if (import.meta.env.DEV) console.log("[MobileConnect] Cleared invalid MWA cache:", cacheResult.reason);
          }
        } catch {
          // ignore cache cleanup failures
        }
        if (isConnected) {
          await disconnect();
        }
        if (targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName && openPhantomDeepLink()) {
          return;
        }
        const hint =
          targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName
            ? "No public key received. Make sure a Solana Mobile-compatible wallet is installed and approve the request."
            : "Wallet connected but Public Key is missing. Please try again.";
        throw new Error(hint);
      }
    } catch (err) {
      if (targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName) {
        const message = err instanceof Error ? err.message : String(err ?? "");
        if (message.includes("mobile wallet protocol") || message.includes("ERROR_WALLET_NOT_FOUND")) {
          if (openPhantomDeepLink()) {
            return;
          }
        }
      }
      console.error("[MobileConnect] Connection error detail:", err);
      toast.error("Connection failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [preferredMobileWallet, preferredMobileWalletReady, select, isConnected, connectedAddress, disconnect, isIosDevice]);

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
  const { traits, score, address, isLoading } = walletData;

  // Phase 1: Fade wormhole tunnel (max 800ms) to reveal page
  useEffect(() => {
    if (!fromBlackHole) return;
    suppressLoadingRef.current = true;

    const fadeTunnel = () => {
      // Wormhole tunnel overlay
      const tunnel = document.getElementById('wormhole-tunnel');
      if (tunnel) {
        tunnel.style.transition = 'opacity 0.8s ease-out';
        tunnel.style.opacity = '0';
        setTimeout(() => tunnel.remove(), 900);
      }
      // Legacy veil fallback
      const veil = document.getElementById('bh-transition-veil');
      if (veil) {
        veil.style.transition = 'opacity 0.6s ease-out';
        veil.style.opacity = '0';
        setTimeout(() => veil.remove(), 700);
      }
    };

    // Fade when data ready (with buffer for WebGL init) or max 1800ms
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    const maxTimer = setTimeout(fadeTunnel, 1800);
    if (!isLoading && traits) {
      readyTimer = setTimeout(fadeTunnel, 600);
    }

    return () => {
      clearTimeout(maxTimer);
      if (readyTimer) clearTimeout(readyTimer);
    };
  }, [fromBlackHole, isLoading, traits]);

  // Phase 2: Clear suppression only when data IS loaded (prevents loading overlay flash)
  useEffect(() => {
    if (!fromBlackHole) return;
    if (!isLoading && traits) {
      const t = setTimeout(() => {
        setFromBlackHole(false);
        returningFromBH.current = false;
        suppressLoadingRef.current = false;
        sessionStorage.removeItem('fromBlackHole');
        window.history.replaceState({}, '');
      }, 400);
      return () => clearTimeout(t);
    }
    // Safety: clear after 12s max if data never loads
    const safety = setTimeout(() => {
      setFromBlackHole(false);
      returningFromBH.current = false;
      suppressLoadingRef.current = false;
      sessionStorage.removeItem('fromBlackHole');
      window.history.replaceState({}, '');
    }, 12000);
    return () => clearTimeout(safety);
  }, [fromBlackHole, isLoading, traits]);

  // Unified State Machine for UI
  useEffect(() => {
    // When returning from BlackHole, skip scanning and go straight to ready
    // Use ref so this persists across re-renders from isLoading/traits changes
    if ((returningFromBH.current || suppressLoadingRef.current) && resolvedAddress) {
      setViewState("ready");
      return;
    }

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
      setViewState("ready");
    }
  }, [resolvedAddress, isWarping, isLoading, traits, fromBlackHole]);

  // Removed auto-warp effect
  
  const handleEnter = () => {
    if (connectedAddress) {
      setActiveAddress(connectedAddress.toBase58());
      setIsWarping(true);
      setViewState("scanning"); // Immediate — prevents one-frame flash
      setTimeout(() => setIsWarping(false), 900);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setActiveAddress(undefined);
    setViewState("landing");
  };

  const [mintState, setMintState] = useState<"idle" | "minting" | "success" | "error">("idle");
  const [isMintPanelOpen, setIsMintPanelOpen] = useState(true);
  const [paymentToken, setPaymentToken] = useState<PaymentToken>("SOL");
  const [skrQuote, setSkrQuote] = useState<{ skrAmount: number; discount: number } | null>(null);
  const [skrQuoteError, setSkrQuoteError] = useState<string | null>(null);
  const [skrQuoteLoading, setSkrQuoteLoading] = useState(false);
  const proxyBase = getHeliusProxyUrl();

  const fetchSkrQuote = useCallback(async () => {
    if (!proxyBase) {
      setSkrQuote(null);
      setSkrQuoteError("SKR pricing unavailable");
      return;
    }
    setSkrQuoteLoading(true);
    const MAX_RETRIES = 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 2000));
        const response = await fetch(`${proxyBase}/api/market/mint-quote`);
        if (!response.ok) {
          throw new Error(`SKR quote unavailable (${response.status})`);
        }
        const data = await response.json();
        const skrAmount = Number(data?.skrAmount);
        const discount = Number(data?.discount ?? SEEKER_TOKEN.DISCOUNT);
        if (!Number.isFinite(skrAmount)) {
          throw new Error("Invalid SKR quote");
        }
        setSkrQuote({ skrAmount, discount: Number.isFinite(discount) ? discount : SEEKER_TOKEN.DISCOUNT });
        setSkrQuoteError(null);
        setSkrQuoteLoading(false);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    console.warn("[mint] SKR quote fetch failed after retries", lastError);
    setSkrQuote(null);
    setSkrQuoteError("SKR pricing unavailable");
    setSkrQuoteLoading(false);
  }, [proxyBase]);

  useEffect(() => {
    fetchSkrQuote();
    const interval = window.setInterval(fetchSkrQuote, 60_000);
    return () => window.clearInterval(interval);
  }, [fetchSkrQuote]);
  const renderCardImage = useCallback(async (scale: number, quality: number) => {
    if (!cardCaptureRef.current) {
      throw new Error("Card preview is not ready yet");
    }

    if (document?.fonts?.ready) await document.fonts.ready;

    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(cardCaptureRef.current as HTMLDivElement, {
      backgroundColor: "#020408",
      scale,
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

    return canvas.toDataURL("image/jpeg", quality);
  }, []);

  const uploadCardImage = useCallback(async (dataUrl: string) => {
    const metadataBaseUrl = getMetadataBaseUrl();
    if (!metadataBaseUrl) throw new Error("Metadata URL missing");

    const response = await fetch(`${metadataBaseUrl}/metadata/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl, contentType: "image/jpeg" }),
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(
        `Upload failed: ${response.status}. Please check Nginx client_max_body_size or check log: ${text.slice(0, 120)}`
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const payload = JSON.parse(text);
    if (!payload?.url) {
      throw new Error("Card image URL missing from upload response");
    }
    return payload.url as string;
  }, []);

  const captureCardImage = useCallback(async () => {
    const dataUrl = await renderCardImage(1.5, 0.85);
    try {
      return await uploadCardImage(dataUrl);
    } catch (error) {
      console.warn("[mint] Card image upload failed, retrying smaller payload", error);
      const fallbackDataUrl = await renderCardImage(1.1, 0.72);
      return await uploadCardImage(fallbackDataUrl);
    }
  }, [renderCardImage, uploadCardImage]);
  const handleMint = useCallback(async () => {
    if (!wallet || !wallet.publicKey || !traits) return;

    if (paymentToken === "SKR" && !skrQuote) {
      toast.error("SKR price unavailable", {
        description: "Please try again in a moment.",
      });
      return;
    }
    
    setMintState("minting");
    let succeeded = false;
    try {
      const cardImageUrl = await captureCardImage();
      const result = await mintIdentityPrism({
        wallet,
        address: wallet.publicKey.toBase58(),
        traits,
        score,
        cardImageUrl,
        paymentToken,
      });
      
      if (import.meta.env.DEV) console.log("Mint success:", result);
      succeeded = true;
      setMintState("success");
      toast.success("Identity Secured!", {
        description: `Tx: ${result.signature.slice(0, 8)}...`,
      });
    } catch (err) {
      const error = err as Error & {
        code?: string;
        requiredLamports?: number;
        balanceLamports?: number;
        feeLamports?: number;
      };
      if (error?.code === "INSUFFICIENT_SOL") {
        const requiredSol =
          typeof error.requiredLamports === "number"
            ? error.requiredLamports / LAMPORTS_PER_SOL
            : null;
        const balanceSol =
          typeof error.balanceLamports === "number"
            ? error.balanceLamports / LAMPORTS_PER_SOL
            : null;
        toast.error("Insufficient SOL for transaction", {
          description:
            requiredSol !== null && balanceSol !== null
              ? `Need ~${requiredSol.toFixed(4)} SOL (including fee). Available ${balanceSol.toFixed(4)} SOL.`
              : "Please top up your wallet and try again.",
        });
      } else if (error?.code === "INSUFFICIENT_SKR") {
        toast.error(`Insufficient ${SEEKER_TOKEN.SYMBOL} tokens`, {
          description: `You need ${SEEKER_TOKEN.SYMBOL} tokens in your wallet to mint with this option. Buy ${SEEKER_TOKEN.SYMBOL} or switch to SOL payment.`,
        });
      } else if (error?.code === "SIMULATION_FAILED") {
        toast.error("Transaction simulation failed", {
          description: "Try again later or switch RPC.",
        });
      } else {
        console.error("Mint error:", err);
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string })?.code ?? "";
        const isUserCancel = /reject|cancel|denied|abort|dismiss|decline|user.?reject|user.?decline/i.test(msg + " " + code);
        if (isUserCancel) {
          toast.info("Transaction cancelled");
        } else {
          toast.error("Deployment failed", { description: msg });
        }
      }
    } finally {
      // Guarantee spinner always stops (handles hung promises, unexpected errors)
      if (!succeeded) setMintState("idle");
    }
  }, [wallet, traits, score, captureCardImage, paymentToken, skrQuote]);

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

    const appBaseUrl = (getAppBaseUrl() ?? "https://identityprism.xyz").replace(/\/+$/, "");
    const shareUrl = `${appBaseUrl}/share`;
    const shareText = [
      "🔮 Identity Prism",
      `${tierEmoji} Tier: ${tierLabel} • 💎 Score: ${score}`,
      `🔮 Insight: ${shareInsight}`,
      "⚡ Powered by Solana Blinks",
      "",
      "Scan your wallet to reveal your Identity Prism on @solana",
      shareUrl,
    ].join("\n");

    const encodedText = encodeURIComponent(shareText);
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;

    if (isCapacitor || isMobileBrowser) {
      window.location.href = twitterUrl;
      return;
    }

    const popup = window.open(twitterUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      toast.error("Popup blocked. Allow popups to share on X.");
    }
  }, [address, score, shareInsight, traits, isCapacitor, isMobileBrowser]);

  const showReadyView = previewMode || viewState === "ready" || returningFromBH.current || suppressLoadingRef.current;
  const cardDataReady = !!traits;
  const isScrollEnabled = showReadyView && !previewMode && !isNftMode;

  // Latch: once overlay is dismissed, it stays dismissed until user disconnects.
  // Prevents any single-frame state flicker from causing a black screen flash.
  const overlayDismissedRef = useRef(false);
  if (viewState === "landing") overlayDismissedRef.current = false;
  else if (showReadyView) overlayDismissedRef.current = true;

  const overlayMounted = true;
  const overlayFading = overlayDismissedRef.current;

  // Prevent accidental auto-scroll on main page
  useEffect(() => {
    if (shellRef.current && !isScrollEnabled) {
      shellRef.current.scrollTop = 0;
    }
  }, [viewState, isScrollEnabled]);

  useEffect(() => {
    const updateScrollbarWidth = () => {
      const shell = shellRef.current;
      const width = shell ? shell.offsetWidth - shell.clientWidth : 0;
      document.documentElement.style.setProperty(
        "--shell-scrollbar-width",
        `${Math.max(width, 0)}px`
      );
    };

    updateScrollbarWidth();
    const raf = window.requestAnimationFrame(updateScrollbarWidth);
    window.addEventListener("resize", updateScrollbarWidth);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateScrollbarWidth);
    };
  }, [isScrollEnabled, viewState, isMintPanelOpen, isNftMode]);

  return (
    <div
      ref={shellRef}
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

          {/* Card stage — pre-renders when data available, revealed when ready */}
          {(showReadyView || cardDataReady) && (
            <>
              {previewMode ? (
                <PreviewGallery />
              ) : (
                <div className={`card-stage ${isMintPanelOpen ? 'controls-open' : 'controls-closed'}${!showReadyView ? ' card-stage-hidden' : ''}`}>
                  {/* Supernova + blackout overlays — outside card shell to escape transform containment */}
                  <div className="bh-supernova" />
                  <div className="bh-blackout-overlay" />
                  <CelestialCard data={walletData} fromBlackHole={fromBlackHole} />
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
                        <div className="mint-payment">
                          <span className="mint-payment-label">Pay with</span>
                          <div className="mint-payment-options">
                            <button
                              type="button"
                              className={`mint-payment-option ${paymentToken === "SOL" ? "is-active" : ""}`}
                              onClick={() => setPaymentToken("SOL")}
                            >
                              SOL
                            </button>
                            <button
                              type="button"
                              className={`mint-payment-option ${paymentToken === "SKR" ? "is-active" : ""}`}
                              onClick={() => setPaymentToken("SKR")}
                              disabled={!skrQuote && !skrQuoteLoading}
                            >
                              {SEEKER_TOKEN.SYMBOL} −50%
                            </button>
                          </div>
                          {paymentToken === "SKR" && (
                            <span className={`mint-payment-note ${skrQuoteError ? "is-error" : ""}`}>
                              {skrQuoteError
                                ? skrQuoteError
                                : `50% discount with ${SEEKER_TOKEN.SYMBOL}`}
                            </span>
                          )}
                        </div>
                        <div className="mint-action-row">
                          <Button
                            onClick={handleMint}
                            disabled={
                              mintState === "minting" ||
                              isLoading ||
                              !isConnected ||
                              (paymentToken === "SKR" && !skrQuote)
                            }
                            className="mint-primary-btn"
                          >
                            {mintState === "idle" && <span>MINT IDENTITY</span>}
                            {mintState === "minting" && <Loader2 className="h-5 w-5 animate-spin" />}
                            {mintState === "success" && <span>IDENTITY SECURED</span>}
                          </Button>
                        </div>
                        <div className="mint-meta">
                          {paymentToken === "SKR" ? (
                            <>
                              <span>
                                MINT COST {skrQuote ? skrQuote.skrAmount : "—"} {SEEKER_TOKEN.SYMBOL}
                              </span>
                              <span>{`50% discount with ${SEEKER_TOKEN.SYMBOL}`}</span>
                            </>
                          ) : (
                            <span>MINT COST {MINT_CONFIG.PRICE_SOL.toFixed(2)} SOL</span>
                          )}
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
                            // Clear URL address param so the useEffect doesn't re-set it
                            const next = new URLSearchParams(searchParams);
                            next.delete('address');
                            setSearchParams(next, { replace: true });
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

          {/* Scanning/Landing overlay — fades out smoothly after card renders */}
          {(!showReadyView || overlayMounted) && (
            <LandingOverlay
              fadeOut={overlayFading && showReadyView}
              passthrough={showReadyView}
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
              scanningMessageIndex={scanningMessageIndex}
            />
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
  scanningMessageIndex
}: { 
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
}) {
  const activeMessage = SCANNING_MESSAGES[scanningMessageIndex ?? 0] ?? SCANNING_MESSAGES[0];

  return (
    <div className={`landing-persistent-shell${passthrough ? ' passthrough' : ''}${fadeOut ? ' fade-out' : ''}`}>
      {/* Scanning overlay — absolutely positioned on top */}
      <div className={`warp-overlay scanning-overlay scanning-layer${isScanning ? ' visible' : ''}`}>
        <div className="warp-content">
          <img src="/phav.png" alt="Identity Prism" className="scanning-logo" />
          <div className="scanning-progress">
            <div className="scanning-bar"></div>
          </div>
          <div className="scanning-status">
            <span key={`scan-${scanningMessageIndex ?? 0}`} className="scanning-status-line">
              {activeMessage}
            </span>
          </div>
        </div>
      </div>

      {/* Landing content — underneath, hidden when scanning */}
      <div className={`landing-wrap-v2${isScanning ? ' landing-hidden' : ''}`}>
      <div className="landing-main">
        <div className="landing-card-v2 glass-panel">
        <div className="landing-header-v2">
          <div className="glow-icon-container">
            <img src="/phav.png" alt="Identity Prism" className="h-24 w-24 mx-auto mb-6 glow-logo" />
          </div>
          <p className="landing-eyebrow select-none">
            Identity Prism v3.2
          </p>
          <h1 className="landing-title-v2">Decode your cosmic signature</h1>
        </div>
        
        <div className="landing-actions-v2">
          {isConnected && onEnter ? (
             <div className="w-full flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-500">
                <div className="wallet-connected-banner mx-auto max-w-[320px] p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-center">
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
      <div className="landing-footer">
        <p className="landing-footer-copy">
          Identity Prism is a Solana dApp that transforms wallet activity into a cosmic identity card
        </p>
        <div className="landing-footer-panel">
          <div className="landing-footer-column">
            <span className="landing-footer-title">Legal</span>
            <a className="landing-footer-link" href="/privacy.html">
              Privacy Policy
            </a>
            <a className="landing-footer-link" href="/terms.html">
              Terms of Use
            </a>
          </div>
          <div className="landing-footer-column">
            <span className="landing-footer-title">Connect</span>
            <a className="landing-footer-link" href="mailto:support@identityprism.xyz">
              support@identityprism.xyz
            </a>
            <a
              className="landing-footer-link"
              href="https://x.com/Identity_Prism"
              target="_blank"
              rel="noreferrer"
            >
              Twitter
            </a>
          </div>
        </div>
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
