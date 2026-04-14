import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams, useLocation } from 'react-router-dom';
const CelestialCard = React.lazy(() =>
  import('@/components/CelestialCard').then((m) => ({ default: m.CelestialCard })),
);
import type { PlanetTier, WalletData, WalletTraits } from '@/hooks/useWalletData';
import { useWalletData } from '@/hooks/useWalletData';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { SolanaMobileWalletAdapterWalletName } from '@solana-mobile/wallet-adapter-mobile';
// mintIdentityPrism loaded dynamically in handleMint()
import { extractMwaAddress, mwaAuthorizationCache } from '@/lib/mwaAuthorizationCache';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowLeft, ChevronDown, ChevronUp, Loader2, Share2 } from 'lucide-react';
import LandingOverlay from '@/components/LandingOverlay';
import { fadeOutTransition, startFadeTransition } from '@/lib/fadeTransition';
import {
  getAppBaseUrl,
  getHeliusProxyUrl,
  getMetadataBaseUrl,
  getHeliusRpcUrl,
  getCollectionMint,
  MINT_CONFIG,
  SEEKER_TOKEN,
} from '@/constants';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getRandomFunnyFact } from '@/utils/funnyFacts';
// html2canvas loaded dynamically in renderCardImage()
const CosmicHub = React.lazy(() => import('@/components/CosmicHubV3'));
import { getPrismBalance, earnPrism, canEarnFromScan, markScanEarned, type PrismBalance } from '@/lib/prismCoin';
import { trackWalletConnect, trackWalletDisconnect, trackMint } from '@/lib/analytics';
const OnboardingModal = React.lazy(() => import('@/components/OnboardingModal'));
const WelcomeBackModal = React.lazy(() => import('@/components/WelcomeBackModal'));

type ViewState = 'landing' | 'scanning' | 'ready' | 'hub';
type PaymentToken = 'SOL' | 'SKR' | 'COINS';

const MWA_AUTH_CACHE_KEY = 'SolanaMobileWalletAdapterDefaultAuthorizationCache';
// SCANNING_MESSAGES moved to LandingOverlay.tsx

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
    if (!cached) return { cleared: false, reason: 'missing' };
    const parsed = JSON.parse(cached);
    const accounts = parsed?.accounts;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      await mwaAuthorizationCache.clear();
      window.localStorage?.removeItem(MWA_AUTH_CACHE_KEY);
      return { cleared: true, reason: 'empty_accounts' };
    }
    const firstAccount = accounts[0] as { address?: string; publicKey?: string | Record<string, number> } | undefined;
    const hasAddress = Boolean(firstAccount?.address || firstAccount?.publicKey);
    if (!hasAddress) {
      await mwaAuthorizationCache.clear();
      window.localStorage?.removeItem(MWA_AUTH_CACHE_KEY);
      return { cleared: true, reason: 'missing_address' };
    }
    return { cleared: false, reason: 'valid' };
  } catch {
    try {
      await mwaAuthorizationCache.clear();
      window.localStorage?.removeItem(MWA_AUTH_CACHE_KEY);
    } catch {
      // ignore
    }
    return { cleared: true, reason: 'parse_error' };
  }
};

const Index = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const isNftMode = searchParams.get('mode') === 'nft';
  const urlAddress = searchParams.get('address');
  const storedReturn = sessionStorage.getItem('fromBlackHole') === '1';
  const [storedSubPageReturn] = useState(() => {
    const val = sessionStorage.getItem('returnedFromSubPage') === '1';
    if (val)
      try {
        sessionStorage.removeItem('returnedFromSubPage');
      } catch {
        /* empty */
      }
    return val;
  });
  const locState = location.state as Record<string, unknown> | null;
  const shouldResumeFromBlackHole = Boolean(urlAddress) && (Boolean(locState?.fromBlackHole) || storedReturn);
  const shouldResumeFromGameJump = Boolean(locState?.fromGameJump);
  const shouldResumeFromSubPage = Boolean(locState?.fromSubPage) || storedSubPageReturn;
  const shouldOpenCard = Boolean(locState?.openCard);
  const [fromBlackHole, setFromBlackHole] = useState(shouldResumeFromBlackHole);
  const returningFromBH = useRef(shouldResumeFromBlackHole);
  const returningFromGameJump = useRef(shouldResumeFromGameJump);
  const returningFromSubPage = useRef(shouldResumeFromSubPage);
  const suppressLoadingRef = useRef(shouldResumeFromBlackHole || shouldResumeFromGameJump);

  // Fade out transition overlay — always attempt removal on mount.
  // Instant (delay=0) for returns; short delay for other arrivals (e.g. openCard).
  // fadeOutTransition is a no-op if no overlay exists.
  useEffect(() => {
    const isReturn = returningFromSubPage.current || returningFromBH.current || returningFromGameJump.current;
    fadeOutTransition(isReturn ? 0 : 50);
  }, []);

  // Referral claim — check for ?ref= param on first load
  useEffect(() => {
    const refCode = searchParams.get('ref');
    if (!refCode) return;
    // Store ref code, claim when wallet connects
    sessionStorage.setItem('pending_referral', refCode);
    // Clean URL
    const next = new URLSearchParams(searchParams);
    next.delete('ref');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isWarping, setIsWarping] = useState(false);
  const [prismBalance, setPrismBalance] = useState<PrismBalance | null>(() => {
    try {
      const cached = sessionStorage.getItem('ip_prism_balance');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [welcomeBackData, setWelcomeBackData] = useState<import('@/components/WelcomeBackModal').MigrationData | null>(
    null,
  );
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  const [viewState, _setViewState] = useState<ViewState>(
    shouldOpenCard && urlAddress
      ? 'ready'
      : returningFromBH.current || returningFromGameJump.current || returningFromSubPage.current
        ? 'hub'
        : urlAddress
          ? 'scanning'
          : 'landing',
  );
  const setViewState = useCallback((v: ViewState) => {
    viewStateRef.current = v;
    _setViewState(v);
  }, []);
  const [scanningMessageIndex, setScanningMessageIndex] = useState(0);
  const [jwtSigning, setJwtSigning] = useState(false);
  const [jwtDeclined, setJwtDeclined] = useState(false);
  const cardCaptureRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mwaErrorRef = useRef<string | null>(null);
  const isDisconnectingRef = useRef(false);
  const viewStateRef = useRef(viewState);
  const hasReachedHub = useRef(false); // once we reach hub/ready, stop state machine from re-triggering

  const wallet = useWallet();
  const {
    publicKey: connectedAddress,
    connected: isConnected,
    disconnect,
    select,
    connect,
    wallets: availableWallets,
    wallet: _selectedWallet,
  } = wallet;
  const { setVisible: setWalletModalVisible } = useWalletModal();

  // When returning from a sub-page, initialize from the connected wallet
  // so the hub renders immediately (prevents blank frame behind fade overlay).
  // Fallback to sessionStorage when connectedAddress is not yet available (race condition fix).
  const [activeAddress, setActiveAddress] = useState<string | undefined>(
    urlAddress ||
      (shouldResumeFromSubPage || shouldResumeFromBlackHole || shouldResumeFromGameJump
        ? connectedAddress?.toBase58() ||
          (() => {
            try {
              return sessionStorage.getItem('prism_active_address') || undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined),
  );
  // Persist activeAddress so it survives component remounts on sub-page returns
  useEffect(() => {
    try {
      if (activeAddress) sessionStorage.setItem('prism_active_address', activeAddress);
      else sessionStorage.removeItem('prism_active_address');
    } catch {
      /* ignore */
    }
  }, [activeAddress]);

  const didForceDisconnect = useRef(false);
  const [walletStable, setWalletStable] = useState(
    Boolean(urlAddress) || returningFromBH.current || returningFromGameJump.current || returningFromSubPage.current,
  );

  // On fresh app open (no URL address, not returning from BlackHole),
  // force-disconnect any auto-connected wallet so user must choose manually.
  // Keep walletStable=false until disconnect settles to prevent connected UI flash.
  // Re-runs on isConnected to catch Phantom eager-connect that fires AFTER first render.
  useEffect(() => {
    // If user explicitly disconnected, force-disconnect any auto-reconnect
    if (isDisconnectingRef.current && isConnected) {
      disconnect().catch(() => {});
      return;
    }
    if (urlAddress || returningFromBH.current || returningFromGameJump.current || returningFromSubPage.current) {
      setWalletStable(true);
      return;
    }
    if (isConnected && !didForceDisconnect.current) {
      didForceDisconnect.current = true;
      disconnect()
        .catch(() => {})
        .finally(() => setTimeout(() => setWalletStable(true), 100));
      return;
    }
    if (!isConnected && !didForceDisconnect.current) {
      didForceDisconnect.current = true;
      setWalletStable(true);
    }
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // When returning from game/BlackHole with connected wallet but no URL address,
  // sync activeAddress from wallet so card + Update button stay visible.
  useEffect(() => {
    if (!(returningFromBH.current || returningFromGameJump.current || returningFromSubPage.current)) return;
    if (activeAddress) {
      // Address already resolved (e.g. from URL or initialized from wallet).
      // Update URL if needed so refresh works, but don't clear returning flags —
      // the state machine needs them to prevent scanning flash while data loads.
      if (!searchParams.get('address') && activeAddress) {
        const next = new URLSearchParams(searchParams);
        next.set('address', activeAddress);
        setSearchParams(next, { replace: true });
      }
      return;
    }
    if (isConnected && connectedAddress) {
      const addr = connectedAddress.toBase58();
      setActiveAddress(addr);
      setViewState('hub');
      // Also update URL so refresh works
      const next = new URLSearchParams(searchParams);
      next.set('address', addr);
      setSearchParams(next, { replace: true });
    }
  }, [isConnected, connectedAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh coin balance when returning to hub (e.g. after challenge/game)
  // Direct server fetch — bypasses prefetch cache to always show real balance
  useEffect(() => {
    if (viewState !== 'hub' || !activeAddress) return;
    const base = getHeliusProxyUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!base) return;
    fetch(`${base}/api/prism/balance?address=${encodeURIComponent(activeAddress)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.balance != null) {
          setPrismBalance(data);
          try {
            sessionStorage.setItem('ip_prism_balance', JSON.stringify(data));
          } catch {}
        }
      })
      .catch(() => {});
  }, [viewState, activeAddress]);

  // If app was reopened with a stale BlackHole flag but no address,
  // clear it immediately so loading overlay is not suppressed.
  useEffect(() => {
    if (urlAddress) return;
    if (sessionStorage.getItem('fromBlackHole') === '1') {
      sessionStorage.removeItem('fromBlackHole');
    }
  }, [urlAddress]);

  // Dismiss HTML preloader. For scanning flow (address exists), keep preloader
  // visible until curtains are ready — it has its own scanning animation.
  // For landing flow (no address), dismiss after React overlay paints.
  const preloaderDismissed = useRef(false);
  const dismissPreloader = useCallback(() => {
    if (preloaderDismissed.current) return;
    preloaderDismissed.current = true;
    const el = document.getElementById('app-preloader');
    if (!el) return;
    // Instant removal — no opacity fade. Both preloader and React overlay share
    // the same #05070a background, so removing the preloader instantly reveals
    // the overlay underneath with zero visible gap (no black flash).
    el.style.transition = 'none';
    el.remove();
  }, []);

  // Dismiss preloader once React overlay is painted on screen.
  // We wait 3 rAF frames (guarantees at least one real paint) + a small
  // safety timeout to ensure the overlay is fully composited, even on
  // slow Seeker GPUs. Only then we remove the preloader instantly.
  useEffect(() => {
    if (preloaderDismissed.current) return;
    if (returningFromBH.current || returningFromGameJump.current) return;
    if (suppressLoadingRef.current) return;
    if (!shellRef.current) return;
    if (viewState !== 'landing' && viewState !== 'scanning') return;

    let cancelled = false;
    requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          // Extra 80ms ensures the overlay is composited on slow devices
          setTimeout(() => {
            if (!cancelled) dismissPreloader();
          }, 80);
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [dismissPreloader, viewState]);
  // Safety: always dismiss preloader after 20s max
  useEffect(() => {
    const t = setTimeout(dismissPreloader, 20_000);
    return () => clearTimeout(t);
  }, [dismissPreloader]);

  useEffect(() => {
    if (!urlAddress) return;
    try {
      new PublicKey(urlAddress);
      if (activeAddress !== urlAddress) {
        setActiveAddress(urlAddress);
      }
      if (viewState === 'landing') {
        setViewState('ready');
      }
    } catch (error) {
      console.error('Invalid address in URL', error);
      if (activeAddress === urlAddress) {
        setActiveAddress(undefined);
        setViewState('landing');
      }
    }
  }, [urlAddress, activeAddress, viewState]);

  const userAgent = globalThis.navigator?.userAgent ?? '';
  const isCapacitor = Boolean(
    (
      globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.(),
  );
  const isAndroidDevice = /android/i.test(userAgent);
  const isMobileBrowser = /android|iphone|ipad|ipod/i.test(userAgent);
  const isIosDevice = /iphone|ipad|ipod/i.test(userAgent);
  const isSeekerDevice = /seeker/i.test(userAgent);
  const useMobileWallet = isCapacitor || isMobileBrowser;

  const mobileWallet = useMemo(
    () => availableWallets.find((w) => w.adapter.name === SolanaMobileWalletAdapterWalletName),
    [availableWallets],
  );
  const phantomWallet = useMemo(() => availableWallets.find((w) => w.adapter.name === 'Phantom'), [availableWallets]);
  const nonMwaWallets = useMemo(
    () => availableWallets.filter((w) => w.adapter.name !== SolanaMobileWalletAdapterWalletName),
    [availableWallets],
  );
  const isWalletUsable = (candidate?: typeof mobileWallet) =>
    candidate?.readyState === WalletReadyState.Installed || candidate?.readyState === WalletReadyState.Loadable;
  const preferredMobileWallet = useMemo(() => {
    if (mobileWallet) return mobileWallet;
    const installed = nonMwaWallets.find((wallet) => wallet.readyState === WalletReadyState.Installed);
    if (installed) return installed;
    const loadable = nonMwaWallets.find((wallet) => wallet.readyState === WalletReadyState.Loadable);
    if (loadable) return loadable;
    return undefined;
  }, [nonMwaWallets, mobileWallet]);
  const mobileWalletReady = isWalletUsable(mobileWallet);
  const preferredMobileWalletReady = isWalletUsable(preferredMobileWallet);
  // On Capacitor Android or Seeker device, always allow mobile wallet connect.
  // MWA adapter may start as Unsupported in WebView and change later.
  const mobileConnectReady =
    (isCapacitor && isAndroidDevice) || isSeekerDevice || preferredMobileWalletReady || mobileWalletReady;
  const preferredDesktopWallet = useMemo(() => {
    if (phantomWallet?.readyState === WalletReadyState.Installed) return phantomWallet;
    const installed = nonMwaWallets.find((w) => w.readyState === WalletReadyState.Installed);
    if (installed) return installed;
    return phantomWallet ?? nonMwaWallets[0];
  }, [phantomWallet, nonMwaWallets]);
  const desktopWalletReady = isWalletUsable(preferredDesktopWallet);
  const shouldNudgeMwaAssociation = isCapacitor && isAndroidDevice && !isSeekerDevice;

  const startMwaAssociationNudge = useCallback(() => {
    if (!shouldNudgeMwaAssociation) {
      return () => {};
    }
    let ticks = 0;
    let intervalId: number | null = null;
    const dispatchBlur = () => {
      window.dispatchEvent(new Event('blur'));
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
          // eslint-disable-next-line no-console
          if (import.meta.env.DEV) console.log('[MobileConnect] Adapter connect event:', resolved);
          setActiveAddress(resolved);
          setViewState('scanning');
        }
      }
    };

    const handleError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error ?? '');
      console.warn('[MobileConnect] Adapter error event:', error);
      mwaErrorRef.current = message;
    };

    adapter.on?.('connect', handleConnect);
    adapter.on?.('error', handleError);
    return () => {
      adapter.off?.('connect', handleConnect);
      adapter.off?.('error', handleError);
    };
  }, [mobileWallet?.adapter, activeAddress]);

  useEffect(() => {
    if (viewState === 'scanning') {
      setScanningMessageIndex(0);
    }
  }, [viewState]);

  useEffect(() => {
    if (viewState !== 'scanning') return;
    const interval = window.setInterval(() => {
      setScanningMessageIndex((prev) => (prev + 1) % 3); // 3 messages in LandingOverlay
    }, 1600);
    return () => window.clearInterval(interval);
  }, [viewState]);

  const handleMobileConnect = useCallback(async () => {
    let targetWallet = preferredMobileWallet;
    let targetReady = preferredMobileWalletReady;

    // On Capacitor Android or Seeker device, fallback to raw MWA adapter even if not detected as ready
    if ((!targetWallet || !targetReady) && ((isCapacitor && isAndroidDevice) || isSeekerDevice)) {
      const rawMwa = availableWallets.find((w) => w.adapter.name === SolanaMobileWalletAdapterWalletName);
      if (rawMwa) {
        targetWallet = rawMwa;
        targetReady = true;
      }
    }

    if (!targetWallet || !targetReady) {
      toast.error('Wallet not detected');
      return;
    }

    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.log('[MobileConnect] Using wallet:', targetWallet.adapter.name);

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
        setViewState('scanning');
        return;
      }

      select(targetWallet.adapter.name);
      // eslint-disable-next-line no-console
      if (import.meta.env.DEV) console.log('[MobileConnect] Calling adapter.connect()...');
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
          setViewState('scanning');
          trackWalletConnect('mobile');
          toast.success('Wallet Connected');
          return;
        }
        if (targetWallet.readyState === WalletReadyState.Loadable) {
          return;
        }
        throw new Error(`${targetWallet.adapter.name} connected but public key is missing.`);
      }

      if (import.meta.env.DEV)
        // eslint-disable-next-line no-console
        console.log('[MobileConnect] Adapter state after connect():', {
          connected: targetWallet.adapter.connected,
          publicKey: targetWallet.adapter.publicKey?.toBase58(),
          readyState: targetWallet.readyState,
        });

      let attempts = 0;
      const maxAttempts = 60;
      const pollIntervalMs = 200;
      let resolvedAddress: string | undefined;
      while (!resolvedAddress && attempts < maxAttempts) {
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.log(`[MobileConnect] Waiting for public key... attempt ${attempts + 1}`);
        resolvedAddress = targetWallet.adapter.publicKey?.toBase58();

        if (!resolvedAddress && targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName) {
          const mwaAdapter = targetWallet.adapter as { _authorizationResult?: unknown };
          const internalAddress = extractMwaAddress(mwaAdapter._authorizationResult);
          if (internalAddress) {
            if (import.meta.env.DEV)
              // eslint-disable-next-line no-console
              console.log('[MobileConnect] Using MWA authorization result address:', internalAddress);
            resolvedAddress = internalAddress;
          }
        }

        if (!resolvedAddress && targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName) {
          const message = mwaErrorRef.current ?? '';
          if (message.includes('mobile wallet protocol') || message.includes('ERROR_WALLET_NOT_FOUND')) {
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
            // eslint-disable-next-line no-console
            if (import.meta.env.DEV) console.log('[MobileConnect] Using cached MWA address:', cachedAddress);
            resolvedAddress = cachedAddress;
          }
        }

        if (!resolvedAddress) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        attempts++;
      }

      if (resolvedAddress) {
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.log('[MobileConnect] Success! Resolved Address:', resolvedAddress);
        setActiveAddress(resolvedAddress);
        setViewState('scanning');
        trackWalletConnect('mwa');
        toast.success('Wallet Connected');
      } else {
        console.error('[MobileConnect] Failure: No public key and no cache.');
        try {
          const cacheResult = await purgeInvalidMwaCache();
          if (cacheResult.cleared) {
            // eslint-disable-next-line no-console
            if (import.meta.env.DEV) console.log('[MobileConnect] Cleared invalid MWA cache:', cacheResult.reason);
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
            ? 'No public key received. Make sure a Solana Mobile-compatible wallet is installed and approve the request.'
            : 'Wallet connected but Public Key is missing. Please try again.';
        throw new Error(hint);
      }
    } catch (err) {
      if (targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName) {
        const message = err instanceof Error ? err.message : String(err ?? '');
        if (message.includes('mobile wallet protocol') || message.includes('ERROR_WALLET_NOT_FOUND')) {
          if (openPhantomDeepLink()) {
            return;
          }
        }
      }
      console.error('[MobileConnect] Connection error detail:', err);
      toast.error('Connection failed', {
        description: err instanceof Error ? err.message : String(err),
      });
      // Reset adapter state so next connect attempt starts fresh
      try {
        await targetWallet.adapter.disconnect();
      } catch {
        /* empty */
      }
      try {
        select(null);
      } catch {
        /* empty */
      }
    }
  }, [
    preferredMobileWallet,
    preferredMobileWalletReady,
    availableWallets,
    isCapacitor,
    isAndroidDevice,
    isSeekerDevice,
    select,
    isConnected,
    connectedAddress,
    disconnect,
    isIosDevice,
    startMwaAssociationNudge,
  ]);

  const handleDesktopConnect = useCallback(async () => {
    const targetWallet = preferredDesktopWallet;
    if (!targetWallet) {
      toast.error('Wallet not detected');
      return;
    }

    try {
      isDisconnectingRef.current = false; // Clear disconnect flag on new connect
      if (isConnected && connectedAddress) {
        setActiveAddress(connectedAddress.toBase58());
        setViewState('scanning');
        return;
      }

      if (!desktopWalletReady) {
        setWalletModalVisible(true);
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
        setViewState('scanning');
        trackWalletConnect('desktop');
      }
    } catch (err) {
      console.error('[DesktopConnect] Connection error:', err);
      toast.error('Connection failed', {
        description: err instanceof Error ? err.message : String(err),
      });
      // Reset adapter state so next connect attempt starts fresh
      try {
        await targetWallet.adapter.disconnect();
      } catch {
        /* empty */
      }
      try {
        select(null);
      } catch {
        /* empty */
      }
    }
  }, [
    preferredDesktopWallet,
    desktopWalletReady,
    isConnected,
    connectedAddress,
    select,
    connect,
    setWalletModalVisible,
  ]);

  const previewMode = import.meta.env.DEV && searchParams.has('preview');
  const resolvedAddress = activeAddress;
  const walletData = useWalletData(resolvedAddress);
  const { traits, score, address, isLoading } = walletData;

  // Pre-warm JWT right after wallet connects — one signature at connect time, not later in hub
  const jwtPrewarmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!resolvedAddress || !wallet.publicKey || !wallet.signMessage) return;
    if (jwtPrewarmedRef.current === resolvedAddress) return;
    // Address changed — clear stale JWT from previous wallet before issuing a new one
    if (jwtPrewarmedRef.current !== null) {
      try {
        sessionStorage.removeItem('ip_auth_jwt');
      } catch {
        /* ignore */
      }
    }
    jwtPrewarmedRef.current = resolvedAddress;
    import('@/components/prism/shared').then(async ({ getCachedJwt, obtainJwt, setAuthWallet }) => {
      setAuthWallet(wallet);
      const cached = getCachedJwt(resolvedAddress);
      if (import.meta.env.DEV) {
        const raw = sessionStorage.getItem('ip_auth_jwt');
        // eslint-disable-next-line no-console
        console.log(
          '[JWT debug] cached:',
          !!cached,
          'raw:',
          raw ? JSON.parse(raw).address?.slice(0, 8) : 'none',
          'resolved:',
          resolvedAddress?.slice(0, 8),
        );
      }
      if (!cached) {
        setJwtSigning(true);
        try {
          await obtainJwt(wallet);
        } catch {
          setJwtDeclined(true);
        }
        setJwtSigning(false);
      }
    });
    // Prefetch all data pages will need (balance, tokens, leaderboard)
    import('@/lib/prefetch').then(({ runPrefetch }) => runPrefetch(resolvedAddress));
    // Restore server-backed user data (loadout, scores, quests) into localStorage
    import('@/lib/userDataSync').then(({ loadFromServer }) => loadFromServer(resolvedAddress));
  }, [resolvedAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 0: Return from Prism League via wormhole jump
  const gameJumpTunnelFaded = useRef(false);
  useEffect(() => {
    if (!returningFromGameJump.current) return;
    suppressLoadingRef.current = true;
    dismissPreloader();

    const fadeTunnel = () => {
      if (gameJumpTunnelFaded.current) return;
      gameJumpTunnelFaded.current = true;
      const tunnel = document.getElementById('wormhole-tunnel');
      if (tunnel) {
        tunnel.style.transition = 'opacity 0.45s ease-out';
        tunnel.style.opacity = '0';
        setTimeout(() => tunnel.remove(), 520);
      }
    };

    // Wait enough for card 3D scene to render before revealing
    const delay = !isLoading && traits ? 600 : 1500;
    const t = setTimeout(fadeTunnel, delay);
    const safety = setTimeout(fadeTunnel, 2500);
    return () => {
      clearTimeout(t);
      clearTimeout(safety);
    };
  }, [isLoading, traits, dismissPreloader]);

  useEffect(() => {
    if (!returningFromGameJump.current) return;

    const releaseTransitionState = () => {
      returningFromGameJump.current = false;
      suppressLoadingRef.current = false;
      window.history.replaceState({}, '');
    };

    if (!resolvedAddress) {
      const t = setTimeout(releaseTransitionState, 280);
      return () => clearTimeout(t);
    }

    if (!isLoading && traits) {
      const t = setTimeout(releaseTransitionState, 260);
      return () => clearTimeout(t);
    }

    const safety = setTimeout(releaseTransitionState, 8000);
    return () => clearTimeout(safety);
  }, [isLoading, traits, resolvedAddress]);

  // Phase 1: Fade wormhole tunnel (max 800ms) to reveal page
  useEffect(() => {
    if (!fromBlackHole) return;
    suppressLoadingRef.current = true;
    dismissPreloader();

    const fadeTunnel = () => {
      const tunnel = document.getElementById('wormhole-tunnel');
      if (tunnel) {
        tunnel.style.transition = 'opacity 0.5s ease-out';
        tunnel.style.opacity = '0';
        setTimeout(() => tunnel.remove(), 600);
      }
      const veil = document.getElementById('bh-transition-veil');
      if (veil) {
        veil.style.transition = 'opacity 0.4s ease-out';
        veil.style.opacity = '0';
        setTimeout(() => veil.remove(), 500);
      }
    };

    // Fade when data ready or max 1400ms
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    const maxTimer = setTimeout(fadeTunnel, 1400);
    if (!isLoading && traits) {
      readyTimer = setTimeout(fadeTunnel, 400);
    }

    return () => {
      clearTimeout(maxTimer);
      if (readyTimer) clearTimeout(readyTimer);
    };
  }, [fromBlackHole, isLoading, traits, dismissPreloader]);

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
    // During disconnect, don't let state machine override landing state
    if (isDisconnectingRef.current) return;

    // When returning from BlackHole/Game/SubPage, skip scanning and go straight to hub
    if ((returningFromBH.current || suppressLoadingRef.current || returningFromSubPage.current) && resolvedAddress) {
      setViewState('hub');
      return;
    }

    if (!resolvedAddress) {
      // Don't flash landing screen while sub-page return is syncing wallet address
      // BUT if wallet is stable (settled) and still no address — wallet not connected, show landing
      if (returningFromSubPage.current && !walletStable) return;
      if (returningFromSubPage.current) returningFromSubPage.current = false;
      setViewState('landing');
      return;
    }

    if (isWarping) {
      setViewState('scanning');
      return;
    }

    if (!traits) {
      // When returning from sub-page, suppress scanning flash — stay on hub
      if (returningFromSubPage.current || returningFromGameJump.current) return;
      // Skip scan animation if we have fresh cached data for this address
      // (handles browser back button which bypasses safeNavigate flags)
      if (resolvedAddress) {
        try {
          const cached = sessionStorage.getItem(`walletData_${resolvedAddress}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed?.traits && parsed.address === resolvedAddress) {
              // Data is in cache — useWalletData will restore it momentarily; don't flash scan
              return;
            }
          }
        } catch {
          /* ignore */
        }
      }
      setViewState('scanning');
    } else {
      // After scan → go to Hub. But only once — don't re-trigger on background trait updates.
      if (!hasReachedHub.current) {
        hasReachedHub.current = true;
        if (viewStateRef.current !== 'ready' && viewStateRef.current !== 'hub') {
          setViewState('hub');
        }
      }
      // Clear one-shot returning flags now that data is loaded
      if (returningFromSubPage.current) returningFromSubPage.current = false;
      if (returningFromGameJump.current) returningFromGameJump.current = false;
      // Show onboarding for first-time users
      if (!localStorage.getItem('ip_onboarding_v1')) {
        setShowOnboarding(true);
      }
      // Show Welcome Back modal for v1→v2 migrated users (once per address)
      if (resolvedAddress && !localStorage.getItem(`prism_welcome_shown_${resolvedAddress}`)) {
        const base = getHeliusProxyUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
        if (base) {
          fetch(`${base}/api/v2/migration-status?address=${encodeURIComponent(resolvedAddress)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data?.migrated && data.migrationData) {
                setWelcomeBackData(data.migrationData);
                setShowWelcomeBack(true);
              }
            })
            .catch(() => {});
        }
      }
      // Load Coin balance + earn scan reward (rate-limited: 1/hour)
      if (resolvedAddress) {
        getPrismBalance(resolvedAddress)
          .then((b) => {
            setPrismBalance(b);
            try {
              sessionStorage.setItem('ip_prism_balance', JSON.stringify(b));
            } catch {}
          })
          .catch(() => {});
        // Claim pending referral
        const pendingRef = sessionStorage.getItem('pending_referral');
        if (pendingRef) {
          sessionStorage.removeItem('pending_referral');
          const base = getHeliusProxyUrl() || window.location.origin;
          const jwt = (() => {
            try {
              const r = sessionStorage.getItem('ip_auth_jwt');
              if (!r) return null;
              const p = JSON.parse(r);
              return p.expiresAt > Date.now() + 60000 ? p.token : null;
            } catch {
              return null;
            }
          })();
          if (jwt) {
            fetch(`${base}/api/referral/claim`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
              body: JSON.stringify({ code: pendingRef }),
            })
              .then((r) => r.json())
              .then((d) => {
                if (d.success) toast.success('Referral bonus! +50 Coins');
              })
              .catch(() => {});
          }
        }
        if (canEarnFromScan(resolvedAddress)) {
          import('@/components/prism/shared')
            .then(({ fetchSybilAnalysis }) => fetchSybilAnalysis(resolvedAddress))
            .then((analysis) => {
              if (!analysis) return null;
              return earnPrism(resolvedAddress, 'scan_wallet', undefined, undefined, undefined, {
                scanTarget: resolvedAddress,
              });
            })
            .then((reward) => {
              if (!reward || reward.earned <= 0) return;
              markScanEarned(resolvedAddress);
              return import('@/lib/prismQuests').then(({ getQuestState, incrementQuest }) => {
                const qs = getQuestState(resolvedAddress);
                incrementQuest(qs, 'daily_scan');
                incrementQuest(qs, 'ot_first_scan');
              });
            })
            .catch(() => {});
        }
      }
    }
  }, [resolvedAddress, isWarping, traits, fromBlackHole, walletStable]);

  // Removed auto-warp effect

  const warpTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleEnter = () => {
    if (connectedAddress) {
      isDisconnectingRef.current = false; // Clear disconnect flag on new connect
      setActiveAddress(connectedAddress.toBase58());
      setIsWarping(true);
      setViewState('scanning'); // Immediate — prevents one-frame flash
      clearTimeout(warpTimerRef.current);
      warpTimerRef.current = setTimeout(() => setIsWarping(false), 900);
    }
  };
  useEffect(() => () => clearTimeout(warpTimerRef.current), []);

  const handleDisconnect = async () => {
    // Set flag BEFORE async disconnect so state machine doesn't override viewState
    isDisconnectingRef.current = true;
    // Fallback: always clear flag after 3s to prevent state machine lockup
    setTimeout(() => {
      isDisconnectingRef.current = false;
    }, 3000);
    // Clear returning refs so effects don't re-set activeAddress after disconnect
    returningFromSubPage.current = false;
    returningFromBH.current = false;
    returningFromGameJump.current = false;
    hasReachedHub.current = false;
    setActiveAddress(undefined);
    jwtPrewarmedRef.current = null;
    setViewState('landing');
    // Clear URL ?address= param so the urlAddress sync effect (line ~264) doesn't
    // immediately re-set activeAddress from the stale URL
    const next = new URLSearchParams(searchParams);
    if (next.has('address')) {
      next.delete('address');
      next.delete('mode');
      setSearchParams(next, { replace: true });
    }
    // Reset force-disconnect ref so next auto-connect will be force-disconnected
    didForceDisconnect.current = false;
    // Clear wallet session data
    try {
      sessionStorage.removeItem('ip_auth_jwt');
    } catch {
      /* ignore */
    }
    // Clear localStorage BEFORE disconnect to prevent auto-reconnect race
    try {
      localStorage.removeItem('walletAdapter');
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem('walletName');
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(MWA_AUTH_CACHE_KEY);
    } catch {
      /* ignore */
    }
    try {
      await disconnect();
    } catch {
      /* ignore */
    }
    mwaAuthorizationCache.clear().catch(() => {});
    trackWalletDisconnect();
    // Clear disconnect flag after disconnect completes — URL is already cleaned,
    // so the urlAddress sync effect won't re-set activeAddress.
    isDisconnectingRef.current = false;
  };

  const [mintState, setMintState] = useState<'idle' | 'minting' | 'success' | 'error'>('idle');
  const [remintState, setRemintState] = useState<'idle' | 'updating' | 'success' | 'error'>('idle');
  const [hasExistingId, setHasExistingId] = useState<boolean | null>(null);
  const [isMintPanelOpen, setIsMintPanelOpen] = useState(true);
  const [paymentToken, setPaymentToken] = useState<PaymentToken>('SOL');
  const [skrQuote, setSkrQuote] = useState<{ skrAmount: number } | null>(null);
  const [skrQuoteError, setSkrQuoteError] = useState<string | null>(null);
  const [skrQuoteLoading, setSkrQuoteLoading] = useState(false);
  const proxyBase = getHeliusProxyUrl();

  // Check if the wallet already owns an Identity Prism (to gate Update button)
  useEffect(() => {
    const addr = wallet?.publicKey?.toBase58();
    if (!addr) {
      setHasExistingId(null);
      return;
    }
    const heliusUrl = getHeliusRpcUrl(addr);
    const collectionMint = getCollectionMint();
    if (!heliusUrl || !collectionMint) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(heliusUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'check-id',
            method: 'getAssetsByOwner',
            params: { ownerAddress: addr, page: 1, limit: 1000 },
          }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          result?: { items: Array<{ grouping?: Array<{ group_key: string; group_value: string }> }> };
        };
        const owns = (data.result?.items ?? []).some((a) =>
          a.grouping?.some((g) => g.group_key === 'collection' && g.group_value === collectionMint),
        );
        if (!cancelled) setHasExistingId(owns);
      } catch {
        if (!cancelled) setHasExistingId(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet?.publicKey]);

  const fetchSkrQuote = useCallback(async () => {
    if (!proxyBase) {
      setSkrQuoteError('SKR pricing unavailable');
      return;
    }
    setSkrQuoteLoading(true);
    const MAX_RETRIES = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1500));
        const response = await fetch(`${proxyBase}/api/market/mint-quote`);
        if (!response.ok) {
          throw new Error(`SKR quote unavailable (${response.status})`);
        }
        const data = await response.json();
        const skrAmount = Number(data?.skrAmount);
        if (!Number.isFinite(skrAmount)) {
          throw new Error('Invalid SKR quote');
        }
        setSkrQuote({ skrAmount });
        setSkrQuoteError(null);
        setSkrQuoteLoading(false);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    console.warn('[mint] SKR quote fetch failed after retries', lastError);
    // Keep previous successful quote as fallback — only clear error text
    setSkrQuoteError('SKR pricing unavailable — retrying...');
    setSkrQuoteLoading(false);
    // Schedule one more background retry after 10s
    skrRetryTimerRef.current = window.setTimeout(() => {
      fetchSkrQuote();
    }, 10_000);
  }, [proxyBase]);

  const skrRetryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    fetchSkrQuote();
    const interval = window.setInterval(fetchSkrQuote, 60_000);
    return () => {
      window.clearInterval(interval);
      if (skrRetryTimerRef.current) window.clearTimeout(skrRetryTimerRef.current);
    };
  }, [fetchSkrQuote]);

  // Re-fetch SKR quote when entering hub or ready state (e.g. after scan or BlackHole)
  useEffect(() => {
    if ((viewState === 'ready' || viewState === 'hub') && !skrQuote) {
      fetchSkrQuote();
    }
  }, [viewState, skrQuote, fetchSkrQuote]);
  const renderCardImage = useCallback(async (scale: number, quality: number) => {
    if (!cardCaptureRef.current) {
      throw new Error('Card preview is not ready yet');
    }

    if (document?.fonts?.ready) await document.fonts.ready;

    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(cardCaptureRef.current as HTMLDivElement, {
      backgroundColor: '#0a1420',
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

    return canvas.toDataURL('image/jpeg', quality);
  }, []);

  const uploadCardImage = useCallback(async (dataUrl: string) => {
    const metadataBaseUrl = getMetadataBaseUrl();
    if (!metadataBaseUrl) throw new Error('Metadata URL missing');

    const response = await fetch(`${metadataBaseUrl}/metadata/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, contentType: 'image/jpeg' }),
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(
        `Upload failed: ${response.status}. Please check Nginx client_max_body_size or check log: ${text.slice(0, 120)}`,
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const payload = JSON.parse(text);
    if (!payload?.url) {
      throw new Error('Card image URL missing from upload response');
    }
    return payload.url as string;
  }, []);

  const captureCardImage = useCallback(async () => {
    const dataUrl = await renderCardImage(1.5, 0.85);
    try {
      return await uploadCardImage(dataUrl);
    } catch (error) {
      console.warn('[mint] Card image upload failed, retrying smaller payload', error);
      const fallbackDataUrl = await renderCardImage(1.1, 0.72);
      return await uploadCardImage(fallbackDataUrl);
    }
  }, [renderCardImage, uploadCardImage]);
  const handleMint = useCallback(async () => {
    if (!wallet || !wallet.publicKey || !traits) return;

    if (paymentToken === 'SKR' && !skrQuote) {
      toast.error('SKR price unavailable', {
        description: 'Please try again in a moment.',
      });
      return;
    }

    setMintState('minting');
    let succeeded = false;
    // Safety: auto-reset spinner if wallet promise hangs (e.g. Seeker silently drops request)
    // 30s to allow for card capture + wallet signing + finalize
    const safetyTimer = setTimeout(() => {
      if (!succeeded) {
        setMintState('idle');
        toast.info('Transaction timed out — please try again');
      }
    }, 30_000);
    try {
      const cardImageUrl = await captureCardImage();
      const { mintIdentityPrism } = await import('@/lib/mintIdentityPrism');
      const result = await mintIdentityPrism({
        wallet,
        address: wallet.publicKey.toBase58(),
        traits,
        score,
        cardImageUrl,
        paymentToken: paymentToken as 'SOL' | 'SKR',
      });

      // eslint-disable-next-line no-console
      if (import.meta.env.DEV) console.log('Mint success:', result);
      succeeded = true;
      trackMint(true);
      setMintState('success');
      setTimeout(() => setMintState('idle'), 4000);
      toast.success('Identity minted!', {
        description: `Tx: ${result.signature.slice(0, 8)}...`,
      });
    } catch (err) {
      trackMint(false, (err as Error)?.message);
      const error = err as Error & {
        code?: string;
        requiredLamports?: number;
        balanceLamports?: number;
        feeLamports?: number;
      };
      if (error?.code === 'INSUFFICIENT_SOL') {
        const requiredSol =
          typeof error.requiredLamports === 'number' ? error.requiredLamports / LAMPORTS_PER_SOL : null;
        const balanceSol = typeof error.balanceLamports === 'number' ? error.balanceLamports / LAMPORTS_PER_SOL : null;
        toast.error('Insufficient SOL for transaction', {
          description:
            requiredSol !== null && balanceSol !== null
              ? `Need ~${requiredSol.toFixed(4)} SOL (including fee). Available ${balanceSol.toFixed(4)} SOL.`
              : 'Please top up your wallet and try again.',
        });
      } else if (error?.code === 'INSUFFICIENT_SKR') {
        toast.error(`Insufficient ${SEEKER_TOKEN.SYMBOL} tokens`, {
          description: `You need ${SEEKER_TOKEN.SYMBOL} tokens in your wallet to mint with this option. Buy ${SEEKER_TOKEN.SYMBOL} or switch to SOL payment.`,
        });
      } else if (error?.code === 'SIMULATION_FAILED') {
        toast.error('Transaction simulation failed', {
          description: 'Try again later or switch RPC.',
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string })?.code ?? '';
        const errName = (err as { name?: string })?.name ?? '';
        console.error('Mint error:', { message: msg, code, name: errName, raw: err });
        const isUserCancel =
          /reject|cancel|denied|abort|dismiss|decline|user.?reject|user.?decline|4001|USER_REJECTED/i.test(
            msg + ' ' + code,
          ) ||
          errName === 'WalletSignTransactionError' ||
          errName === 'WalletSendTransactionError' ||
          msg === 'Unknown error' ||
          msg === '';
        if (isUserCancel) {
          toast.info('Transaction cancelled');
        } else {
          toast.error('Mint failed', { description: msg });
        }
      }
    } finally {
      clearTimeout(safetyTimer);
      // Guarantee spinner always stops (handles hung promises, unexpected errors)
      if (!succeeded) setMintState('idle');
    }
  }, [wallet, traits, score, captureCardImage, paymentToken, skrQuote]);

  const handleMintWithCoins = useCallback(async () => {
    if (!wallet || !wallet.publicKey || !traits) return;
    setMintState('minting');
    let succeeded = false;
    const safetyTimer = setTimeout(() => {
      if (!succeeded) {
        setMintState('idle');
        toast.info('Transaction timed out — please try again');
      }
    }, 60_000);
    try {
      const cardImageUrl = await captureCardImage();
      const { mintIdentityPrism } = await import('@/lib/mintIdentityPrism');
      const result = await mintIdentityPrism({
        wallet,
        address: wallet.publicKey.toBase58(),
        traits,
        score,
        cardImageUrl,
        paymentToken: 'SOL',
        paidWithCoins: true,
      });
      // eslint-disable-next-line no-console
      if (import.meta.env.DEV) console.log('Mint-for-coins success:', result);
      succeeded = true;
      trackMint(true);
      setMintState('success');
      setTimeout(() => setMintState('idle'), 4000);
      // Refresh coin balance after spending
      getPrismBalance(wallet.publicKey.toBase58())
        .then((b) => {
          setPrismBalance(b);
          try {
            sessionStorage.setItem('ip_prism_balance', JSON.stringify(b));
          } catch {}
        })
        .catch(() => {});
      toast.success('Identity minted!', {
        description: `Tx: ${result.signature.slice(0, 8)}... · 10,000 coins spent`,
      });
    } catch (err) {
      trackMint(false, (err as Error)?.message);
      const error = err as Error & { code?: string };
      const msg = error?.message ?? String(err);
      const code = error?.code ?? '';
      const errName = (err as { name?: string })?.name ?? '';
      console.error('Mint-for-coins error:', { message: msg, code, name: errName });
      const isUserCancel =
        /reject|cancel|denied|abort|dismiss|decline|user.?reject|user.?decline|4001|USER_REJECTED/i.test(
          msg + ' ' + code,
        ) ||
        errName === 'WalletSignTransactionError' ||
        errName === 'WalletSendTransactionError' ||
        msg === 'Unknown error' ||
        msg === '';
      if (isUserCancel) {
        toast.info('Transaction cancelled');
      } else {
        toast.error('Mint failed', { description: msg });
      }
    } finally {
      clearTimeout(safetyTimer);
      if (!succeeded) setMintState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, traits, score, captureCardImage, prismBalance]);

  const handleRemint = useCallback(async () => {
    if (!wallet || !wallet.publicKey || !traits) return;
    setRemintState('updating');
    let succeeded = false;
    const safetyTimer = setTimeout(() => {
      if (!succeeded) {
        setRemintState('idle');
        toast.info('Update timed out — please try again');
      }
    }, 60_000);
    try {
      toast.info('Updating card...', {
        description: 'Updates metadata on existing NFT — only 0.0005 SOL.',
      });
      const cardImageUrl = await captureCardImage();
      const { updateIdentityPrism } = await import('@/lib/mintIdentityPrism');
      const result = await updateIdentityPrism({
        wallet,
        address: wallet.publicKey.toBase58(),
        traits,
        score,
        cardImageUrl,
      });
      succeeded = true;
      setRemintState('success');
      setTimeout(() => setRemintState('idle'), 4000);
      setHasExistingId(true);
      toast.success('Card updated!', {
        description: `NFT metadata updated: ${result.signature.slice(0, 8)}...`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isUserCancel = /reject|cancel|denied|abort|dismiss|decline|user.?reject|4001|USER_REJECTED/i.test(msg);
      if (isUserCancel) {
        toast.info('Update cancelled');
      } else {
        toast.error('Update failed', { description: msg });
      }
    } finally {
      clearTimeout(safetyTimer);
      if (!succeeded) setRemintState('idle');
    }
  }, [wallet, traits, score, captureCardImage]);

  const shareInsight = useMemo(() => {
    if (!traits) return 'Cosmic insight pending... 🔮';
    const insight = getRandomFunnyFact(traits);
    return insight.length > 120 ? `${insight.slice(0, 117)}...` : insight;
  }, [traits]);

  const handleShare = useCallback(() => {
    if (!traits || !address) {
      toast.error('Card is not ready yet');
      return;
    }

    // Format text with emojis and key stats
    const tierLabel = traits.planetTier.replace('_', ' ').toUpperCase();
    const tierEmoji =
      {
        mercury: '☄️',
        venus: '💛',
        mars: '🔴',
        earth: '🌍',
        neptune: '🔵',
        uranus: '🧊',
        saturn: '🪐',
        jupiter: '🪐',
        sun: '☀️',
        binary_sun: '☀️',
      }[traits.planetTier] ?? '✨';

    const appBaseUrl = (getAppBaseUrl() ?? 'https://identityprism.xyz').replace(/\/+$/, '');
    const shareUrl = `${appBaseUrl}/share`;
    const shareText = [
      '🔮 Identity Prism',
      `${tierEmoji} Tier: ${tierLabel} • 💎 Score: ${score}`,
      `🔮 Insight: ${shareInsight}`,
      '⚡ Powered by Solana Blinks',
      '',
      'Scan your wallet to reveal your Identity Prism on @solana',
      shareUrl,
    ].join('\n');

    const encodedText = encodeURIComponent(shareText);
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;

    if (isCapacitor || isMobileBrowser) {
      window.location.href = twitterUrl;
      return;
    }

    const popup = window.open(twitterUrl, '_blank', 'noopener,noreferrer');
    if (!popup) {
      toast.error('Popup blocked. Allow popups to share on X.');
    }
  }, [address, score, shareInsight, traits, isCapacitor, isMobileBrowser]);

  const showReadyView = previewMode || viewState === 'ready';
  const cardDataReady = !!traits;
  const isScrollEnabled = showReadyView && !previewMode && !isNftMode;

  // sceneReady: true once CelestialCard's Canvas has rendered real frames.
  const [sceneReady, setSceneReady] = useState(false);
  const handleSceneReady = useCallback(() => setSceneReady(true), []);

  // Curtain transition — STICKY: once triggered, never resets (except back to landing).
  // When returning from BlackHole/Game, skip curtains entirely — show card immediately.
  const isReturning = returningFromBH.current || returningFromGameJump.current || returningFromSubPage.current;
  // Skip curtain animation when returning from hub (data already loaded & canvas rendered)
  const hasVisitedHub = useRef(false);
  useEffect(() => {
    if (viewState === 'hub') hasVisitedHub.current = true;
  }, [viewState]);
  const skipCurtain = isReturning || hasVisitedHub.current;
  const [curtainOpen, setCurtainOpen] = useState(skipCurtain);
  const [curtainDone, setCurtainDone] = useState(skipCurtain);

  const everythingReady = showReadyView && sceneReady;

  useEffect(() => {
    // Once curtains have started, never reset them here
    if (!curtainOpen && everythingReady) {
      setCurtainOpen(true);
      // Dismiss HTML preloader AFTER curtains mount (next frames) so they cover the gap
      requestAnimationFrame(() => requestAnimationFrame(() => dismissPreloader()));
    }
  }, [everythingReady, curtainOpen, dismissPreloader]);

  useEffect(() => {
    if (!curtainOpen || curtainDone) return;
    // Overlay fade-out takes ~400ms
    const t = setTimeout(() => setCurtainDone(true), 500);
    return () => clearTimeout(t);
  }, [curtainOpen, curtainDone]);

  // Only reset everything when explicitly going back to landing
  useEffect(() => {
    if (viewState === 'landing') {
      setSceneReady(false);
      setCurtainOpen(false);
      setCurtainDone(false);
    }
  }, [viewState]);

  const showOverlay = !curtainDone && !suppressLoadingRef.current;

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
      document.documentElement.style.setProperty('--shell-scrollbar-width', `${Math.max(width, 0)}px`);
    };

    updateScrollbarWidth();
    const raf = window.requestAnimationFrame(updateScrollbarWidth);
    window.addEventListener('resize', updateScrollbarWidth);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateScrollbarWidth);
    };
  }, [isScrollEnabled, viewState, isMintPanelOpen, isNftMode]);

  return (
    <div
      ref={shellRef}
      className={`identity-shell relative min-h-screen ${previewMode && !isNftMode ? 'preview-scroll' : ''} ${isScrollEnabled ? 'scrollable-shell' : ''} ${isNftMode ? 'is-nft-view nft-kiosk-mode' : ''}`}
    >
      {viewState === 'hub' && !activeAddress ? (
        // Transitional: hub state but wallet address not synced yet.
        // Show dark bg — preloader or fade overlay covers this briefly.
        <div style={{ position: 'fixed', inset: 0, background: '#050510' }} />
      ) : viewState === 'hub' && activeAddress ? (
        <React.Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#050510' }} />}>
          <CosmicHub
            walletAddress={activeAddress}
            prismBalance={prismBalance}
            onNavigateToCard={() => {
              // Standardize navigation effect
              startFadeTransition(() => {
                setCurtainOpen(true);
                setCurtainDone(true);
                setViewState('ready');
                fadeOutTransition(100);
              });
            }}
            onDisconnect={handleDisconnect}
            identityScore={walletData.score}
            planetTier={walletData.traits?.planetTier}
            jwtDeclined={jwtDeclined}
            onRequestSign={() => {
              setJwtDeclined(false);
              if (!wallet.publicKey || !wallet.signMessage) return;
              import('@/components/prism/shared').then(async ({ obtainJwt, setAuthWallet }) => {
                setAuthWallet(wallet);
                setJwtSigning(true);
                try {
                  await obtainJwt(wallet);
                } catch {
                  setJwtDeclined(true);
                }
                setJwtSigning(false);
              });
            }}
          />
        </React.Suspense>
      ) : isNftMode ? (
        <>
          <div className="absolute inset-0 bg-[#05070a] background-base" />
          <div className="nebula-layer nebula-one" />
          <div className="identity-gradient" />
          <div className="flex items-center justify-center w-full h-screen p-0 overflow-hidden relative z-10">
            {walletData.traits ? (
              <React.Suspense
                fallback={
                  <div className="flex flex-col items-center gap-4">
                    <img src="/phav.png" className="w-16 h-16 animate-pulse opacity-50" alt="" />
                    <div className="text-cyan-500/50 text-xs font-bold tracking-[0.3em] uppercase animate-pulse">
                      Loading...
                    </div>
                  </div>
                }
              >
                <CelestialCard data={walletData} />
              </React.Suspense>
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
              <React.Suspense fallback={null}>
                <CelestialCard ref={cardCaptureRef} data={walletData} captureMode />
              </React.Suspense>
            </div>
          )}
          <div className="absolute inset-0 bg-[#05070a] background-base" />
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
                <div
                  className={`card-stage relative z-20 ${isMintPanelOpen ? 'controls-open' : 'controls-closed'}${!showReadyView ? ' hidden' : ''}`}
                >
                  {/* Transition handled by wormhole tunnel — no black overlays */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: everythingReady ? 1 : 0, scale: everythingReady ? 1 : 0.95 }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <React.Suspense
                      fallback={<div style={{ position: 'absolute', inset: 0, background: '#05070a' }} />}
                    >
                      <CelestialCard data={walletData} fromBlackHole={fromBlackHole} onSceneReady={handleSceneReady} />
                    </React.Suspense>
                  </motion.div>
                  {!previewMode && (
                    <div className={`mint-panel ${isMintPanelOpen ? 'open' : 'closed'}`}>
                      <button type="button" className="mint-toggle" onClick={() => setIsMintPanelOpen((prev) => !prev)}>
                        {isMintPanelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                        <span>{isMintPanelOpen ? 'Hide controls' : 'Show controls'}</span>
                      </button>
                      <div className="mint-panel-content">
                        <div className="mint-payment">
                          <span className="mint-payment-label">Pay with</span>
                          <div className="mint-payment-options">
                            <button
                              type="button"
                              className={`mint-payment-option ${paymentToken === 'SOL' ? 'is-active' : ''}`}
                              onClick={() => setPaymentToken('SOL')}
                            >
                              SOL
                            </button>
                            <button
                              type="button"
                              className={`mint-payment-option ${paymentToken === 'SKR' ? 'is-active' : ''}`}
                              onClick={() => setPaymentToken('SKR')}
                              disabled={!skrQuote && !skrQuoteLoading}
                            >
                              {SEEKER_TOKEN.SYMBOL} −50%
                            </button>
                            {isConnected && (
                              <button
                                type="button"
                                className={`mint-payment-option ${paymentToken === 'COINS' ? 'is-active' : ''}`}
                                onClick={() => setPaymentToken('COINS')}
                                disabled={false}
                                style={
                                  paymentToken === 'COINS'
                                    ? { borderColor: 'rgba(234,179,8,0.5)', color: 'rgba(234,179,8,0.9)' }
                                    : {}
                                }
                              >
                                COINS
                              </button>
                            )}
                          </div>
                          {paymentToken === 'SKR' && (
                            <span className={`mint-payment-note ${skrQuoteError ? 'is-error' : ''}`}>
                              {skrQuoteError ? skrQuoteError : `Pay with ${SEEKER_TOKEN.SYMBOL}`}
                            </span>
                          )}
                          {paymentToken === 'COINS' && (
                            <span
                              className={`mint-payment-note ${prismBalance && prismBalance.balance < 10000 ? 'is-error' : ''}`}
                            >
                              {!prismBalance
                                ? 'Loading...'
                                : prismBalance.balance < 10000
                                  ? `Not enough Coins: ${prismBalance.balance.toLocaleString()} / 10,000`
                                  : `Balance: ${prismBalance.balance.toLocaleString()} Coins`}
                            </span>
                          )}
                        </div>
                        <div className="mint-action-row">
                          <Button
                            onClick={paymentToken === 'COINS' ? handleMintWithCoins : handleMint}
                            disabled={
                              mintState === 'minting' ||
                              isLoading ||
                              !isConnected ||
                              (paymentToken === 'SKR' && !skrQuote) ||
                              (paymentToken === 'COINS' && (!prismBalance || prismBalance.balance < 10000))
                            }
                            className="mint-primary-btn"
                            style={
                              paymentToken === 'COINS'
                                ? {
                                    background: 'linear-gradient(135deg, rgba(234,179,8,0.2), rgba(234,179,8,0.1))',
                                    borderColor: 'rgba(234,179,8,0.35)',
                                  }
                                : {}
                            }
                          >
                            {mintState === 'idle' && (
                              <span>
                                {paymentToken === 'COINS'
                                  ? 'MINT · 10,000 COINS'
                                  : paymentToken === 'SKR'
                                    ? `MINT · ${skrQuote ? skrQuote.skrAmount : '—'} ${SEEKER_TOKEN.SYMBOL}`
                                    : `MINT · ${MINT_CONFIG.PRICE_SOL.toFixed(2)} SOL`}
                              </span>
                            )}
                            {mintState === 'minting' && <Loader2 className="h-5 w-5 animate-spin" />}
                            {mintState === 'success' && <span>IDENTITY SECURED</span>}
                          </Button>
                        </div>
                        {isConnected && (
                          <div className="mint-action-row" style={{ marginTop: '0.25rem' }}>
                            <Button
                              onClick={handleRemint}
                              disabled={
                                remintState === 'updating' || mintState === 'minting' || isLoading || !isConnected
                              }
                              variant="outline"
                              className="mint-primary-btn"
                              style={{
                                background: 'rgba(168,85,247,0.08)',
                                borderColor: 'rgba(168,85,247,0.25)',
                              }}
                              title="Updates metadata on existing NFT"
                            >
                              {remintState === 'idle' && <span>♻ UPDATE CARD · 0.0005 SOL</span>}
                              {remintState === 'updating' && (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                  UPDATING...
                                </>
                              )}
                              {remintState === 'success' && <span>✓ CARD UPDATED</span>}
                            </Button>
                          </div>
                        )}
                        <Button variant="ghost" onClick={handleShare} className="mint-share-btn">
                          <Share2 className="h-4 w-4 mr-2" />
                          SHARE ON X
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            startFadeTransition(() => {
                              setViewState('hub');
                              fadeOutTransition(100);
                            });
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

          {/* Scanning overlay — stays mounted until curtainDone but hidden instantly behind curtains */}
          {showOverlay && (
            <LandingOverlay
              isScanning={viewState === 'scanning'}
              fadeOut={curtainOpen}
              passthrough={curtainOpen}
              isConnected={walletStable && isConnected}
              onEnter={handleEnter}
              onDisconnect={handleDisconnect}
              connectedAddress={walletStable ? connectedAddress?.toBase58() : undefined}
              useMobileWallet={useMobileWallet}
              onMobileConnect={handleMobileConnect}
              mobileWalletReady={mobileConnectReady}
              onDesktopConnect={handleDesktopConnect}
              desktopWalletReady={desktopWalletReady}
              scanningMessageIndex={scanningMessageIndex}
              jwtSigning={jwtSigning}
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

      {/* Welcome Back modal for v1→v2 migrated users */}
      {showWelcomeBack && welcomeBackData && (
        <React.Suspense fallback={null}>
          <WelcomeBackModal
            open={showWelcomeBack}
            migrationData={welcomeBackData}
            onClose={() => {
              setShowWelcomeBack(false);
              if (resolvedAddress) {
                try {
                  localStorage.setItem(`prism_welcome_shown_${resolvedAddress}`, '1');
                } catch {
                  /* ignore */
                }
              }
            }}
          />
        </React.Suspense>
      )}
    </div>
  );
};

export default Index;

const PREVIEW_TIERS: PlanetTier[] = [
  'mercury',
  'mars',
  'venus',
  'earth',
  'neptune',
  'uranus',
  'saturn',
  'jupiter',
  'sun',
  'binary_sun',
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
    hasSeeker: tier !== 'mercury',
    hasPreorder: tier === 'sun' || tier === 'binary_sun',
    hasCombo: tier === 'binary_sun',
    isOG: tier !== 'mercury',
    isWhale: tier === 'sun' || tier === 'binary_sun',
    isCollector: tier !== 'mercury',
    isEarlyAdopter: tier === 'sun' || tier === 'binary_sun',
    isTxTitan: tier === 'jupiter' || tier === 'sun' || tier === 'binary_sun',
    isSolanaMaxi: tier === 'binary_sun',
    isBlueChip: tier === 'jupiter' || tier === 'sun' || tier === 'binary_sun',
    isDeFiKing: tier === 'saturn' || tier === 'jupiter' || tier === 'sun' || tier === 'binary_sun',
    uniqueTokenCount: 40,
    nftCount: 12,
    txCount: 800,
    memeCoinsHeld: [],
    isMemeLord: tier === 'venus' || tier === 'earth',
    hyperactiveDegen: tier === 'mars' || tier === 'venus',
    diamondHands: tier === 'sun' || tier === 'binary_sun',
    avgTxPerDay30d: 3.4,
    daysSinceLastTx: 1,
    solBalance: tier === 'binary_sun' ? 18 : tier === 'sun' ? 12 : tier === 'jupiter' ? 8 : 2.5,
    solBonusApplied: 0,
    walletAgeDays: tier === 'binary_sun' ? 900 : tier === 'sun' ? 700 : tier === 'jupiter' ? 500 : 200,
    walletAgeBonus: 0,
    planetTier: tier,
    totalAssetsCount: 42,
    solTier: tier === 'binary_sun' || tier === 'sun' ? 'whale' : tier === 'jupiter' ? 'dolphin' : 'shrimp',
    totalValueUSD: tier === 'binary_sun' ? 50000 : 500,
    cosmicRank: 'quasar',
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
            <React.Suspense fallback={<div style={{ height: 400, background: '#05070a' }} />}>
              <CelestialCard data={buildPreviewWalletData(tier)} />
            </React.Suspense>
          </div>
        ))}
      </div>
    </div>
  );
}
