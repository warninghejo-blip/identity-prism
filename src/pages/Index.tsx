import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams, useLocation } from 'react-router-dom';
const CelestialCard = React.lazy(() =>
  import('@/components/CelestialCard').then((m) => ({ default: m.CelestialCard })),
);
import type { PlanetTier, WalletData, WalletTraits } from '@/hooks/useWalletData';
import { readCachedWalletData, useWalletData } from '@/hooks/useWalletData';
import { useBlackHolePrefetch } from '@/hooks/useBlackHolePrefetch';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { SolanaMobileWalletAdapterWalletName } from '@solana-mobile/wallet-adapter-mobile';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
// mintIdentityPrism loaded dynamically in handleMint()
import { extractMwaAddress, mwaAuthorizationCache } from '@/lib/mwaAuthorizationCache';
import { SEEDVAULT_NAME } from '@/lib/SeedVaultAdapter';
import { writePreferredMobileWalletAddress } from '@/lib/mobileWalletAddressPreference';
import SeedVaultAccountPicker from '@/components/SeedVaultAccountPicker';
import '@/components/SeedVaultAccountPicker.css';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AlertCircle, ChevronRight, Coins, Loader2, RefreshCw, Share2 } from 'lucide-react';
import LandingOverlay from '@/components/LandingOverlay';
import HubReturnButton from '@/components/HubReturnButton';
import { fadeOutTransition, startFadeTransition } from '@/lib/fadeTransition';
import { hasRecentExternalWalletBackground } from '@/lib/safeNavigate';
import {
  getAppBaseUrl,
  getHeliusProxyUrl,
  getMetadataBaseUrl,
  getHeliusRpcUrl,
  getHeliusProxyHeaders,
  getCollectionMint,
  MINT_CONFIG,
  SEEKER_TOKEN,
} from '@/constants';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getRandomFunnyFact } from '@/utils/funnyFacts';
// html2canvas loaded dynamically in renderCardImage()
const CosmicHub = React.lazy(() => import('@/components/CosmicHubV3'));
import { fetchApiJson, getApiBase, getCachedJwt } from '@/components/prism/shared';
import {
  PRISM_BALANCE_UPDATED_EVENT,
  getPrismBalance,
  earnPrism,
  canEarnFromScan,
  markScanEarned,
  type PrismBalance,
} from '@/lib/prismCoin';
import { trackWalletConnect, trackWalletDisconnect, trackMint } from '@/lib/analytics';
import { formatMintCost } from '@/lib/mintPricing';
const OnboardingModal = React.lazy(() => import('@/components/OnboardingModal'));
const WelcomeBackModal = React.lazy(() => import('@/components/WelcomeBackModal'));

type ViewState = 'landing' | 'scanning' | 'ready' | 'hub';
type PaymentToken = 'SOL' | 'SKR' | 'COINS';
type AuthSignatureResult =
  | Uint8Array
  | ArrayBuffer
  | number[]
  | {
      signature?: Uint8Array | ArrayBuffer | number[];
      signedMessage?: Uint8Array | ArrayBuffer | number[];
    };
type AuthSignInInput = {
  domain?: string;
  address?: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
};
type AuthSignInResult = {
  account?: { address?: string };
  signature?: Uint8Array | ArrayBuffer | number[];
  signedMessage?: Uint8Array | ArrayBuffer | number[];
};
type AuthWalletLike = {
  publicKey?: { toBase58(): string } | null;
  signMessage?: (msg: Uint8Array) => Promise<AuthSignatureResult>;
  signIn?: (input?: AuthSignInInput) => Promise<AuthSignInResult>;
  preferSignMessage?: boolean;
  authDelayMs?: number;
};

type AuthCapableAdapter = {
  name?: string;
  signMessage?: (msg: Uint8Array) => Promise<AuthSignatureResult>;
  signIn?: (input?: AuthSignInInput) => Promise<AuthSignInResult>;
};

type MobileAuthorizationAdapter = AuthCapableAdapter & {
  connect?: () => Promise<void>;
  performAuthorization?: () => Promise<unknown>;
};

const makeAdapterAuthWallet = (adapter: AuthCapableAdapter, address: string): AuthWalletLike | null => {
  const authWallet: AuthWalletLike = {
    publicKey: { toBase58: () => address },
  };
  if (typeof adapter.signMessage === 'function') {
    authWallet.signMessage = (msg: Uint8Array) => adapter.signMessage!(msg);
  }
  if (typeof adapter.signIn === 'function') {
    authWallet.signIn = (input?: AuthSignInInput) => adapter.signIn!(input);
  }
  if (adapter.name === SolanaMobileWalletAdapterWalletName) {
    // SIWS one-shot fix: only prefer signMessage if signIn is unavailable.
    // signIn() runs in the same MWA transact session as authorize, so it shows
    // a single biometric prompt instead of two.
    authWallet.preferSignMessage = !authWallet.signIn;
    authWallet.authDelayMs = 350;
  }
  return authWallet.signMessage || authWallet.signIn ? authWallet : null;
};

const looksLikeSolanaAddress = (value: string | null | undefined) =>
  Boolean(value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value));

const MWA_AUTH_CACHE_KEY = 'SolanaMobileWalletAdapterDefaultAuthorizationCache';
const LAST_CONNECTED_WALLET_KEY = 'ip_last_connected_wallet';
const NATIVE_SESSION_RESTORE_KEY = 'ip_native_wallet_session';
const NATIVE_SESSION_RESTORE_WINDOW_MS = 90_000;
const SEED_WALLET_INDEX_KEY = 'ip_seed_wallet_index';
// SCANNING_MESSAGES moved to LandingOverlay.tsx

const readSeedWalletIndex = () => {
  try {
    const parsed = Number.parseInt(localStorage.getItem(SEED_WALLET_INDEX_KEY) || '0', 10);
    return Number.isFinite(parsed) && parsed === 1 ? 1 : 0;
  } catch {
    return 0;
  }
};

const writeSeedWalletIndex = (index: number) => {
  try {
    localStorage.setItem(SEED_WALLET_INDEX_KEY, String(index === 1 ? 1 : 0));
  } catch {
    /* ignore */
  }
};

const readLastConnectedWalletName = () => {
  try {
    const raw = localStorage.getItem(LAST_CONNECTED_WALLET_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
};

const rememberLastConnectedWalletName = (name?: string | null) => {
  if (!name) return;
  try {
    localStorage.setItem(LAST_CONNECTED_WALLET_KEY, name);
  } catch {
    /* ignore */
  }
};

const hasRecentNativeWalletRestore = () => {
  const isFresh = (raw: string | null) => {
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { armedAt?: number };
      return Boolean(parsed?.armedAt && Date.now() - parsed.armedAt <= NATIVE_SESSION_RESTORE_WINDOW_MS);
    } catch {
      return false;
    }
  };

  try {
    localStorage.removeItem(NATIVE_SESSION_RESTORE_KEY);
    return isFresh(sessionStorage.getItem(NATIVE_SESSION_RESTORE_KEY));
  } catch {
    return false;
  }
};

const clearStoredAuthJwt = () => {
  try {
    sessionStorage.removeItem('ip_auth_jwt');
    sessionStorage.removeItem('prism_active_address');
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem('ip_auth_jwt');
    localStorage.removeItem('prism_active_address');
  } catch {
    /* ignore */
  }
};

const persistActiveWalletAddress = (address: string) => {
  try {
    sessionStorage.setItem('prism_active_address', address);
    localStorage.setItem('prism_active_address', address);
  } catch {
    /* ignore */
  }
};

const getJwtBackedAddress = (address: string | null | undefined) =>
  looksLikeSolanaAddress(address) && getCachedJwt(address ?? '') ? (address ?? undefined) : undefined;

const getReturnAddress = (address: string | null | undefined) =>
  looksLikeSolanaAddress(address) ? (address ?? undefined) : undefined;

const readPersistedActiveAddress = () => {
  try {
    const sessionAddress = sessionStorage.getItem('prism_active_address');
    if (sessionAddress) return sessionAddress;
  } catch {
    /* ignore */
  }
  for (const raw of [
    (() => {
      try {
        return sessionStorage.getItem('ip_auth_jwt');
      } catch {
        return null;
      }
    })(),
    (() => {
      try {
        return localStorage.getItem('ip_auth_jwt');
      } catch {
        return null;
      }
    })(),
  ]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { address?: string };
      if (parsed.address) return parsed.address;
    } catch {
      /* ignore */
    }
  }
  try {
    const localAddress = localStorage.getItem('prism_active_address');
    if (localAddress) return localAddress;
  } catch {
    /* ignore */
  }
  return '';
};

const isQuietMwaConnectError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes('No public key') ||
    message.includes('public key is missing') ||
    message.includes('Connection timed out') ||
    message.includes('User rejected') ||
    message.includes('ERROR_CANCELED') ||
    message.includes('authorization request failed')
  );
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

const writeAuthFlowDebug = (event: Record<string, unknown>) => {
  try {
    const prevRaw = sessionStorage.getItem('ip_auth_debug');
    const prev = prevRaw ? JSON.parse(prevRaw) : {};
    sessionStorage.setItem(
      'ip_auth_debug',
      JSON.stringify({
        ...prev,
        ...event,
        ts: new Date().toISOString(),
      }),
    );
  } catch {
    /* ignore */
  }
};

const Index = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [seedAccountIndex, setSeedAccountIndex] = useState(readSeedWalletIndex);
  const isNftMode = searchParams.get('mode') === 'nft';
  const urlAddress = searchParams.get('address');
  const forceIdentityCardRoute = location.pathname.replace(/\/+$/, '') === '/identity';
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
  const suppressPassiveAuthRef = useRef(
    shouldResumeFromBlackHole || shouldResumeFromGameJump || shouldResumeFromSubPage,
  );
  const suppressLoadingRef = useRef(shouldResumeFromBlackHole || shouldResumeFromGameJump);

  // Fade out transition overlay — always attempt removal on mount.
  // Instant (delay=0) for returns; short delay for other arrivals (e.g. openCard).
  // fadeOutTransition is a no-op if no overlay exists.
  useEffect(() => {
    const isReturn = returningFromSubPage.current || returningFromBH.current || returningFromGameJump.current;
    fadeOutTransition(isReturn ? 0 : 50);
  }, []);

  const [isWarping, setIsWarping] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [skrBalance, setSkrBalance] = useState<number | null>(null);
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
  const [showCardHint, setShowCardHint] = useState(false);
  const cardHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewState, _setViewState] = useState<ViewState>(
    // Only init to the card view for a LIVE in-app "open card" nav. On a cold reopen the
    // /identity route + stale ?address= used to flash the ID card before the connection
    // check reset it to landing — gate that out (the route still reaches 'ready' after
    // connect via the post-scan logic).
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
  const [walletHandoffActive, setWalletHandoffActive] = useState(false);
  const [jwtDeclined, setJwtDeclined] = useState(false);
  const [pendingAutoEnterAddress, setPendingAutoEnterAddress] = useState<string | null>(null);
  const cardCaptureRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mwaErrorRef = useRef<string | null>(null);
  const isDisconnectingRef = useRef(false);
  const viewStateRef = useRef(viewState);
  const hasReachedHub = useRef(false); // once we reach hub/ready, stop state machine from re-triggering
  const allowUnsignedHubRef = useRef(shouldResumeFromBlackHole);
  const jwtPrewarmedRef = useRef<string | null>(null);
  const jwtAttemptedRef = useRef<string | null>(null);
  const jwtPrewarmInFlightAddressRef = useRef<string | null>(null);
  const jwtPrewarmPromiseRef = useRef<Promise<boolean> | null>(null);
  // True while the SIWS one-shot adapter.signIn() call is in flight. The MWA adapter
  // can fire its 'connect' event BEFORE signIn() resolves — which would queue a
  // redundant prewarmJwt(forceFresh) that re-signs the message and immediately hits
  // the server's 5s rate-limit on /api/auth/token (429), surfacing a spurious
  // "Sign-in needed" toast on Seeker even though sign-in just succeeded.
  const siwsInProgressRef = useRef(false);
  const autoEnterAttemptedRef = useRef<string | null>(null);
  const coldLaunchPickerAttemptedRef = useRef(false);
  const walletHandoffTimeoutRef = useRef<number | null>(null);
  const warpTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const setWalletHandoff = useCallback((active: boolean) => {
    if (walletHandoffTimeoutRef.current !== null) {
      window.clearTimeout(walletHandoffTimeoutRef.current);
      walletHandoffTimeoutRef.current = null;
    }
    setWalletHandoffActive(active);
    if (active) {
      walletHandoffTimeoutRef.current = window.setTimeout(() => {
        setWalletHandoffActive(false);
        walletHandoffTimeoutRef.current = null;
      }, 18_000);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (walletHandoffTimeoutRef.current !== null) {
        window.clearTimeout(walletHandoffTimeoutRef.current);
      }
    };
  }, []);

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
  useBlackHolePrefetch(connectedAddress ?? wallet.publicKey ?? null);
  const { setVisible: setWalletModalVisible } = useWalletModal();
  // Custom Seed Vault address picker (replaces the generic wallet-adapter modal
  // on Capacitor native — shows actual authorized addresses instead of one
  // abstract "Seed Vault Detected" entry).
  const [seedPickerVisible, setSeedPickerVisible] = useState(false);
  // On the native (Seeker) build, always present the wallet picker on launch instead of silently
  // resuming the last session — one seed can hold several wallets and the user wants to choose.
  // (We can't cheaply count wallets without launching a Seed Vault activity, so we don't gate on it.)
  // true = resume the last session (web); false = always show the picker (native).
  const [resumeAllowed] = useState<boolean>(() => !Capacitor.isNativePlatform());
  const isNativeRef = useRef(false);
  isNativeRef.current = Capacitor.isNativePlatform();
  const openConnectPicker = useCallback(() => {
    if (isNativeRef.current) {
      setSeedPickerVisible(true);
    } else {
      setWalletModalVisible(true);
    }
  }, [setWalletModalVisible]);

  // Handle pick from custom Seed Vault picker — set preferred address, select
  // Seed Vault adapter, trigger connect (Seed Vault is already authorized for
  // this account so no fresh PIN prompt is expected).
  const handleSeedAccountPicked = useCallback(
    async (address: string) => {
      setSeedPickerVisible(false);
      // Deliberate pick → re-arm auto-enter so we go straight to the scan (no intermediate
      // "ENTER COSMOS" tap) and drop any prior declined-sign flag. (NOTE: do NOT queue
      // pendingAutoEnterAddress here — that effect prefers the MWA adapter and fires before
      // the Seed Vault wallet is ready, which breaks the SeedVault connect with an MWA
      // "can't find a wallet" error. The passive auto-enter below uses the SeedVault `wallet`
      // once it's stable, which is the correct path.)
      autoEnterAttemptedRef.current = null;
      setJwtDeclined(false);
      try {
        writePreferredMobileWalletAddress(address);
        select(SEEDVAULT_NAME);
        await new Promise((r) => setTimeout(r, 0));
        await connect();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[index] seed-vault connect after pick failed', e);
      }
    },
    [select, connect],
  );

  const prewarmJwt = useCallback(
    async (authWallet: AuthWalletLike, targetAddress: string, options?: { forceFresh?: boolean }) => {
      if (jwtPrewarmPromiseRef.current && jwtPrewarmInFlightAddressRef.current === targetAddress) {
        return jwtPrewarmPromiseRef.current;
      }

      jwtAttemptedRef.current = targetAddress;
      const run = (async () => {
        writeAuthFlowDebug({
          stage: 'index_prewarm_start',
          address: targetAddress.slice(0, 8),
          hasPublicKey: Boolean(authWallet.publicKey),
          hasSignMessage: Boolean(authWallet.signMessage),
        });
        if (!authWallet.publicKey || !authWallet.signMessage) {
          setJwtDeclined(true);
          writeAuthFlowDebug({ stage: 'index_prewarm_missing_wallet_api' });
          return false;
        }

        const { getCachedJwt, obtainJwt, setAuthWallet } = await import('@/components/prism/shared');
        setAuthWallet(authWallet);
        // Defense-in-depth against SIWS-one-shot/legacy-prewarm race: even when callers
        // ask for forceFresh, honor a JWT that the SIWS path stored in the same render
        // tick. Skipping this would re-sign the message and immediately hit the server's
        // 5-second per-IP rate-limit on /api/auth/token (429), surfacing a spurious
        // "Sign-in needed" toast on Seeker right after a successful sign-in.
        if (options?.forceFresh && getCachedJwt(targetAddress)) {
          jwtPrewarmedRef.current = targetAddress;
          setJwtDeclined(false);
          writeAuthFlowDebug({ stage: 'index_prewarm_force_fresh_skipped_cached' });
          return true;
        }
        if (options?.forceFresh) {
          clearStoredAuthJwt();
          jwtPrewarmedRef.current = null;
        }
        if (!options?.forceFresh && getCachedJwt(targetAddress)) {
          jwtPrewarmedRef.current = targetAddress;
          setJwtDeclined(false);
          writeAuthFlowDebug({ stage: 'index_prewarm_cached' });
          return true;
        }

        setJwtDeclined(false);
        setJwtSigning(true);
        try {
          const jwt = await obtainJwt(authWallet, { forceFresh: options?.forceFresh });
          if (jwt) {
            jwtPrewarmedRef.current = targetAddress;
            setJwtDeclined(false);
            writeAuthFlowDebug({ stage: 'index_prewarm_signed' });
            return true;
          }
          setJwtDeclined(true);
          writeAuthFlowDebug({ stage: 'index_prewarm_no_jwt' });
          toast.error('Sign-in needed — tap wallet icon to retry', { duration: 5000 });
          return false;
        } catch (error) {
          setJwtDeclined(true);
          writeAuthFlowDebug({
            stage: 'index_prewarm_exception',
            message: error instanceof Error ? error.message : String(error ?? ''),
          });
          toast.error('Sign-in failed — try reconnecting wallet', { duration: 5000 });
          return false;
        } finally {
          setJwtSigning(false);
        }
      })();

      jwtPrewarmInFlightAddressRef.current = targetAddress;
      jwtPrewarmPromiseRef.current = run;
      return run.finally(() => {
        if (jwtPrewarmPromiseRef.current === run) {
          jwtPrewarmPromiseRef.current = null;
          jwtPrewarmInFlightAddressRef.current = null;
        }
      });
    },
    [],
  );

  // When returning from a sub-page, initialize from the connected wallet
  // so the hub renders immediately (prevents blank frame behind fade overlay).
  // Fallback to sessionStorage when connectedAddress is not yet available (race condition fix).
  const [activeAddress, setActiveAddress] = useState<string | undefined>(
    getJwtBackedAddress(urlAddress) ||
      (shouldResumeFromSubPage || shouldResumeFromBlackHole || shouldResumeFromGameJump
        ? getJwtBackedAddress(connectedAddress?.toBase58()) ||
          getJwtBackedAddress(
            (() => {
              try {
                return sessionStorage.getItem('prism_active_address') || undefined;
              } catch {
                return undefined;
              }
            })(),
          ) ||
          (shouldResumeFromBlackHole ? getReturnAddress(urlAddress) : undefined)
        : undefined),
  );
  // Persist activeAddress so it survives component remounts on sub-page returns
  useEffect(() => {
    try {
      if (activeAddress) {
        sessionStorage.setItem('prism_active_address', activeAddress);
        localStorage.setItem('prism_active_address', activeAddress);
      } else {
        sessionStorage.removeItem('prism_active_address');
      }
    } catch {
      /* ignore */
    }
  }, [activeAddress]);

  useEffect(() => {
    if (!activeAddress || jwtSigning || isDisconnectingRef.current) return;
    if (getCachedJwt(activeAddress)) return;
    // SIWS one-shot just stored JWT для этого address — trust prewarm refs; не reset
    if (jwtPrewarmedRef.current === activeAddress || jwtAttemptedRef.current === activeAddress) {
      setJwtDeclined(false);
      return;
    }
    setJwtDeclined(true);
    if (allowUnsignedHubRef.current || returningFromBH.current) {
      setViewState('hub');
      return;
    }
    setActiveAddress(undefined);
    setViewState('landing');
  }, [activeAddress, jwtSigning, setViewState]);

  useEffect(() => {
    if (activeAddress || !isConnected || jwtSigning || isDisconnectingRef.current) return;
    const liveAddress = connectedAddress?.toBase58() ?? wallet.publicKey?.toBase58();
    const restoredAddress = liveAddress || readPersistedActiveAddress();
    if (!looksLikeSolanaAddress(restoredAddress)) return;

    if (!getCachedJwt(restoredAddress)) return;
    setPendingAutoEnterAddress(null);
    setJwtDeclined(false);
    setActiveAddress(restoredAddress);
    if (viewStateRef.current === 'landing') {
      setViewState(forceIdentityCardRoute ? 'ready' : 'scanning');
    }
  }, [activeAddress, isConnected, jwtSigning, connectedAddress, wallet.publicKey, forceIdentityCardRoute, setViewState]);

  useEffect(() => {
    // Only auto-resume the last session when the seed exposes ≤1 wallet. With 2+ wallets
    // (resumeAllowed === false) skip the resume so the cold-launch picker lets the user choose.
    // null = wallet count not yet resolved → hold off until it is.
    if (resumeAllowed !== true) return;
    if (activeAddress || jwtSigning || isDisconnectingRef.current) return;
    const restoredAddress = readPersistedActiveAddress();
    if (!looksLikeSolanaAddress(restoredAddress) || !getCachedJwt(restoredAddress)) return;
    setPendingAutoEnterAddress(null);
    setJwtDeclined(false);
    persistActiveWalletAddress(restoredAddress);
    setActiveAddress(restoredAddress);
    if (viewStateRef.current === 'landing') {
      setViewState(forceIdentityCardRoute ? 'ready' : 'scanning');
    }
  }, [activeAddress, jwtSigning, forceIdentityCardRoute, setViewState, resumeAllowed]);

  const recentWalletRestoreRef = useRef(hasRecentExternalWalletBackground() || hasRecentNativeWalletRestore());
  const [walletStable, setWalletStable] = useState(
    Boolean(urlAddress) ||
      returningFromBH.current ||
      returningFromGameJump.current ||
      returningFromSubPage.current ||
      recentWalletRestoreRef.current,
  );

  // Keep wallet state stable across route changes and reloads. Do not auto-disconnect
  // an eager-restored wallet; only explicit user disconnect should do that.
  useEffect(() => {
    if (isDisconnectingRef.current && isConnected) {
      disconnect().catch(() => {});
      return;
    }
    setWalletStable(true);
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
      if (!getCachedJwt(addr)) {
        setJwtDeclined(true);
        setViewState('landing');
        return;
      }
      setActiveAddress(addr);
      setViewState(forceIdentityCardRoute ? 'ready' : 'hub');
      // Also update URL so refresh works
      const next = new URLSearchParams(searchParams);
      next.set('address', addr);
      setSearchParams(next, { replace: true });
    }
  }, [isConnected, connectedAddress, forceIdentityCardRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  const balanceAddress = activeAddress ? (wallet.publicKey?.toBase58() ?? activeAddress) : null;

  // Fetch SOL and SKR balances for the active wallet address.
  // Use the live adapter key when available, but fall back to the persisted
  // active address so balances still render if the mobile adapter drops state.
  useEffect(() => {
    // Reset immediately on ANY change (including wallet→wallet switches, not just
    // full disconnect) so the previous wallet's balance never renders stale while
    // the new one is being fetched.
    setSolBalance(null);
    setSkrBalance(null);
    if (!balanceAddress) return;
    let cancelled = false;

    // Native-only JSON-RPC POST via CapacitorHttp — raw web3.js Connection uses the
    // global fetch(), which is unreliable on the native Android WebView (see
    // fetchFastProfileJson in useWalletData.ts). Retries a couple of times before
    // giving up, so a single transient flake / proxy rate-limit blip doesn't
    // permanently blank the balance.
    const rpcCallNative = async (method: string, params: unknown[]): Promise<unknown> => {
      const url = getHeliusRpcUrl(balanceAddress) || 'https://api.mainnet-beta.solana.com';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const proxyHeaders = getHeliusProxyHeaders(balanceAddress);
      if (proxyHeaders) Object.assign(headers, proxyHeaders);
      const attempts = 2;
      let lastError: unknown;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const response = await CapacitorHttp.post({
            url,
            headers,
            data: { jsonrpc: '2.0', id: method, method, params },
            responseType: 'json',
            connectTimeout: 3_500,
            readTimeout: 4_500,
          });
          if (response.status < 200 || response.status >= 300) {
            throw new Error(`RPC_${method}_${response.status}`);
          }
          const data =
            typeof response.data === 'string' ? JSON.parse(response.data || 'null') : response.data;
          if (data?.error) throw new Error(`RPC_${method}_ERROR`);
          return data?.result;
        } catch (error) {
          lastError = error;
          if (attempt < attempts - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 600));
          }
        }
      }
      throw lastError;
    };

    const fetchNative = async () => {
      try {
        const result = (await rpcCallNative('getBalance', [balanceAddress])) as { value?: number } | undefined;
        if (!cancelled && typeof result?.value === 'number') setSolBalance(result.value / 1e9);
        else if (!cancelled) setSolBalance(null);
      } catch {
        if (!cancelled) setSolBalance(null);
      }
      try {
        const result = (await rpcCallNative('getTokenAccountsByOwner', [
          balanceAddress,
          { mint: SEEKER_TOKEN.MINT },
          { encoding: 'jsonParsed' },
        ])) as { value?: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }> } | undefined;
        const amount = result?.value?.[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
        if (!cancelled) setSkrBalance(amount);
      } catch {
        if (!cancelled) setSkrBalance(null);
      }
    };

    const fetchWeb = () => {
      const owner = new PublicKey(balanceAddress);
      const conn = new Connection(
        getHeliusRpcUrl(balanceAddress) || 'https://api.mainnet-beta.solana.com',
        { commitment: 'confirmed', httpHeaders: getHeliusProxyHeaders(balanceAddress) },
      );
      conn
        .getBalance(owner)
        .then((lamports) => {
          if (!cancelled) setSolBalance(lamports / 1e9);
        })
        .catch(() => {
          if (!cancelled) setSolBalance(null);
        });
      try {
        const skrMint = new PublicKey(SEEKER_TOKEN.MINT);
        conn
          .getParsedTokenAccountsByOwner(owner, { mint: skrMint })
          .then((res) => {
            const amount = res.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
            if (!cancelled) setSkrBalance(amount);
          })
          .catch(() => {
            if (!cancelled) setSkrBalance(null);
          });
      } catch {
        setSkrBalance(null);
      }
    };

    const timer = window.setTimeout(() => {
      if (Capacitor.isNativePlatform()) {
        fetchNative();
      } else {
        fetchWeb();
      }
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [balanceAddress]);

  // Reset PRISM balance immediately on wallet/address change so the PRISM tab
  // doesn't keep showing the previous wallet's stale balance while the fresh
  // one is fetched below. Kept as its own effect (keyed only on activeAddress)
  // so it doesn't fire — and flicker the balance — on every viewState change.
  useEffect(() => {
    setPrismBalance(null);
  }, [activeAddress]);

  // Refresh coin balance when returning to hub/card (e.g. after challenge/game)
  // Direct server fetch — bypasses prefetch cache to always show real balance
  useEffect(() => {
    if ((viewState !== 'hub' && viewState !== 'ready') || !activeAddress) return;
    const base = getApiBase();
    if (!base) return;
    let cancelled = false;
    const requestedAddress = activeAddress;
    fetchApiJson<PrismBalance>(`${base}/api/prism/balance?address=${encodeURIComponent(activeAddress)}`, {
      timeoutMs: 4_500,
    })
      .then((data) => {
        // Guard against a stale response: if the wallet changed while this
        // request was in flight, don't overwrite the new wallet's balance.
        if (cancelled || data?.address !== requestedAddress) return;
        if (data?.balance != null) {
          setPrismBalance(data);
          try {
            sessionStorage.setItem('ip_prism_balance', JSON.stringify(data));
          } catch {}
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewState, activeAddress]);

  useEffect(() => {
    if (!activeAddress || typeof window === 'undefined') return;
    const handlePrismBalanceUpdate = (event: Event) => {
      const detail = (event as CustomEvent<PrismBalance>).detail;
      if (!detail || detail.address !== activeAddress) return;
      setPrismBalance(detail);
      try {
        sessionStorage.setItem('ip_prism_balance', JSON.stringify(detail));
      } catch {}
    };
    window.addEventListener(PRISM_BALANCE_UPDATED_EVENT, handlePrismBalanceUpdate as EventListener);
    return () => {
      window.removeEventListener(PRISM_BALANCE_UPDATED_EVENT, handlePrismBalanceUpdate as EventListener);
    };
  }, [activeAddress]);

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
      if (!getCachedJwt(urlAddress)) {
        setJwtDeclined(true);
        if (activeAddress === urlAddress) setActiveAddress(undefined);
        if (!jwtSigning) setViewState('landing');
        return;
      }
      if (activeAddress !== urlAddress) {
        setActiveAddress(urlAddress);
      }
      if (viewState === 'landing') {
        if (returningFromSubPage.current || returningFromBH.current || returningFromGameJump.current) {
          setViewState(forceIdentityCardRoute ? 'ready' : 'hub');
        } else if (shouldOpenCard || forceIdentityCardRoute) {
          setViewState('ready');
        } else {
          setViewState('scanning');
        }
      }
    } catch (error) {
      console.error('Invalid address in URL', error);
      if (activeAddress === urlAddress) {
        setActiveAddress(undefined);
        setViewState('landing');
      }
    }
  }, [urlAddress, activeAddress, viewState, jwtSigning, forceIdentityCardRoute]);

  const userAgent = globalThis.navigator?.userAgent ?? '';
  const isCapacitor = Capacitor.isNativePlatform();
  const isNativeRuntime =
    isCapacitor ||
    (typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      window.location.hostname === 'localhost');
  const shouldSkipMintCardCapture = isNativeRuntime || /android/i.test(userAgent);
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
  const lastConnectedWalletName = useMemo(() => readLastConnectedWalletName(), []);
  const isWalletUsable = (candidate?: typeof mobileWallet) =>
    candidate?.readyState === WalletReadyState.Installed || candidate?.readyState === WalletReadyState.Loadable;
  const preferredMobileWallet = useMemo(() => {
    const remembered = lastConnectedWalletName
      ? availableWallets.find((wallet) => wallet.adapter.name === lastConnectedWalletName)
      : undefined;
    if (remembered && isWalletUsable(remembered)) return remembered;
    const installed = nonMwaWallets.find((wallet) => wallet.readyState === WalletReadyState.Installed);
    if ((isCapacitor || isSeekerDevice) && installed) return installed;
    if (mobileWallet && isWalletUsable(mobileWallet)) return mobileWallet;
    if (installed) return installed;
    const loadable = nonMwaWallets.find((wallet) => wallet.readyState === WalletReadyState.Loadable);
    if (loadable) return loadable;
    if (mobileWallet) return mobileWallet;
    return undefined;
  }, [availableWallets, lastConnectedWalletName, nonMwaWallets, mobileWallet, isCapacitor, isSeekerDevice]);
  const mobileWalletReady = isWalletUsable(mobileWallet);
  const preferredMobileWalletReady = isWalletUsable(preferredMobileWallet);
  // On Capacitor Android or Seeker device, always allow mobile wallet connect.
  // MWA adapter may start as Unsupported in WebView and change later.
  const mobileConnectReady =
    isCapacitor || isSeekerDevice || preferredMobileWalletReady || mobileWalletReady;
  const preferredDesktopWallet = useMemo(() => {
    const remembered = lastConnectedWalletName
      ? nonMwaWallets.find((wallet) => wallet.adapter.name === lastConnectedWalletName)
      : undefined;
    if (remembered && isWalletUsable(remembered)) return remembered;
    if (phantomWallet?.readyState === WalletReadyState.Installed) return phantomWallet;
    const installed = nonMwaWallets.find((w) => w.readyState === WalletReadyState.Installed);
    if (installed) return installed;
    return phantomWallet ?? nonMwaWallets[0];
  }, [lastConnectedWalletName, phantomWallet, nonMwaWallets]);
  const desktopWalletReady = isWalletUsable(preferredDesktopWallet);
  const shouldNudgeMwaAssociation = isAndroidDevice;

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

    const handleConnect = async (pubKey: PublicKey) => {
      if (!activeAddress) {
        const resolved = pubKey?.toBase58?.();
        if (resolved) {
          // SIWS one-shot race fix: handleMobileConnect's SIWS path stores JWT and sets
          // jwtPrewarmedRef synchronously, but setActiveAddress is async. The MWA adapter
          // fires its 'connect' event mid-signIn() (BEFORE the promise resolves) — at that
          // microtask activeAddress and jwtPrewarmedRef are both still empty, and we'd
          // queue a redundant prewarmJwt(forceFresh) that re-signs the message AND hits the
          // 5s /api/auth/token rate-limit (429), surfacing the "Sign-in needed" toast even
          // though sign-in just succeeded.
          if (
            siwsInProgressRef.current ||
            jwtPrewarmedRef.current === resolved ||
            jwtAttemptedRef.current === resolved
          ) {
            writeAuthFlowDebug({
              stage: 'connect_event_skipped_siws_in_progress_or_done',
              address: resolved.slice(0, 8),
              siwsInProgress: siwsInProgressRef.current,
            });
            return;
          }
          // eslint-disable-next-line no-console
          if (import.meta.env.DEV) console.log('[MobileConnect] Adapter connect event:', resolved);
          writeAuthFlowDebug({ stage: 'connect_event_auto_enter_pending', address: resolved.slice(0, 8) });
          setJwtDeclined(false);
          setPendingAutoEnterAddress(resolved);
          // Do NOT set viewState('scanning') here. It causes the dark bouncy dots overlay
          // to appear prematurely while the user is still signing the message via MWA.
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
  }, [mobileWallet?.adapter, activeAddress, prewarmJwt]);

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

  const handleMobileConnect = useCallback(async (options?: { forceWalletPicker?: boolean }) => {
    let targetWallet = options?.forceWalletPicker ? (mobileWallet ?? availableWallets[0]) : preferredMobileWallet;
    let targetReady = options?.forceWalletPicker ? Boolean(mobileWallet ?? availableWallets[0]) : preferredMobileWalletReady;

    // On Capacitor Android or Seeker device, fallback to raw MWA — system MWA bottom sheet
    // (com.solanamobile.wallet/.MWABottomSheetActivity) handles the wallet picker plug-and-play.
    if ((!targetWallet || !targetReady) && (isCapacitor || isAndroidDevice || isSeekerDevice)) {
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
      hasReachedHub.current = false;
      jwtPrewarmedRef.current = null;
      jwtAttemptedRef.current = null;
      setPendingAutoEnterAddress(null);
      setJwtDeclined(false);
      clearStoredAuthJwt();
      if (isConnected && connectedAddress) {
        const connectedResolved = connectedAddress.toBase58();
        writeAuthFlowDebug({ stage: 'already_connected_auto_enter_pending', address: connectedResolved.slice(0, 8) });
        setJwtDeclined(false);
        setPendingAutoEnterAddress(connectedResolved);
        setViewState('scanning');
        return;
      }

      const isMwaTarget = targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName;
      if (options?.forceWalletPicker && isMwaTarget) {
        await mwaAuthorizationCache.clear();
        try {
          await targetWallet.adapter.disconnect();
        } catch {
          /* ignore stale adapter state cleanup failures */
        }
      }

      if (isMwaTarget) {
        setWalletHandoff(true);
      }

      select(targetWallet.adapter.name);
      // eslint-disable-next-line no-console
      if (import.meta.env.DEV) console.log('[MobileConnect] Calling adapter.connect()...');
      const stopMwaNudge = isMwaTarget ? startMwaAssociationNudge() : undefined;
      let siwsResult: { token: string; address: string } | null = null;
      try {
        const authorizationAdapter = targetWallet.adapter as MobileAuthorizationAdapter;
        if (isMwaTarget && typeof (authorizationAdapter as AuthCapableAdapter).signIn === 'function') {
          // SIWS one-shot: authorize + sign-in message in a SINGLE wallet popup.
          // Fixes the Seeker 64%-freeze where a second wallet popup never surfaced.
          writeAuthFlowDebug({ stage: 'mwa_siws_oneshot_start' });
          const { obtainJwtViaAdapterSignIn } = await import('@/components/prism/shared');
          siwsInProgressRef.current = true;
          try {
            siwsResult = await obtainJwtViaAdapterSignIn(authorizationAdapter as AuthCapableAdapter & {
              publicKey?: { toBase58(): string } | null;
            });
          } finally {
            // Keep the sentinel set for one extra microtask so that any
            // adapter 'connect' event that fires synchronously right after
            // signIn() resolves still sees us in the SIWS path.
            queueMicrotask(() => {
              siwsInProgressRef.current = false;
            });
          }
          if (!siwsResult) {
            writeAuthFlowDebug({ stage: 'mwa_siws_oneshot_failed_fallback' });
            // Fallback to legacy authorize-only path (will trigger separate signMessage popup later).
            if (typeof authorizationAdapter.performAuthorization === 'function') {
              await authorizationAdapter.performAuthorization();
            } else {
              await targetWallet.adapter.connect();
            }
          } else {
            writeAuthFlowDebug({ stage: 'mwa_siws_oneshot_signed', address: siwsResult.address.slice(0, 8) });
          }
        // SIWS one-shot success — JWT already stored by obtainJwtViaAdapterSignIn().
        // Skip the legacy poll + pendingAutoEnter path (which would call prewarmJwt
        // with forceFresh: true and trigger the dreaded second-MWA-popup that never
        // surfaces on Seeker). Just hand the resolved address straight to the hub.
        if (siwsResult) {
          jwtPrewarmedRef.current = siwsResult.address;
          jwtAttemptedRef.current = siwsResult.address;
          setJwtDeclined(false);
          setPendingAutoEnterAddress(null);
          persistActiveWalletAddress(siwsResult.address);
          setActiveAddress(siwsResult.address);
          setIsWarping(true);
          clearTimeout(warpTimerRef.current);
          warpTimerRef.current = setTimeout(() => setIsWarping(false), 900);
          setViewState('scanning');
          rememberLastConnectedWalletName(targetWallet.adapter.name);
          trackWalletConnect('mwa-siws');
          toast.success('Wallet Connected');
          setWalletHandoff(false);
          return;
        }
        } else if (isMwaTarget && typeof authorizationAdapter.performAuthorization === 'function') {
          await authorizationAdapter.performAuthorization();
        } else {
          await targetWallet.adapter.connect();
        }
      } finally {
        if (isMwaTarget) {
          window.setTimeout(() => stopMwaNudge?.(), 3_500);
        } else {
          stopMwaNudge?.();
        }
      }

      if (targetWallet.adapter.name !== SolanaMobileWalletAdapterWalletName) {
        const resolved = targetWallet.adapter.publicKey?.toBase58();
        if (resolved) {
          setViewState('scanning');
          const authWallet = makeAdapterAuthWallet(targetWallet.adapter as AuthCapableAdapter, resolved);
          if (!authWallet) {
            writeAuthFlowDebug({ stage: 'mobile_non_mwa_no_signer', address: resolved.slice(0, 8) });
            setJwtDeclined(true);
            setViewState('landing');
            return;
          }
          const signed = await prewarmJwt(authWallet, resolved, { forceFresh: true });
          if (!signed) {
            setJwtDeclined(true);
            setViewState('landing');
            return;
          }
          persistActiveWalletAddress(resolved);
          setActiveAddress(resolved);
          setViewState('scanning');
          rememberLastConnectedWalletName(targetWallet.adapter.name);
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
          const internalAddress =
            extractMwaAddress(mwaAdapter._authorizationResult) || extractMwaAddress(await mwaAuthorizationCache.get());
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
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        attempts++;
      }

      if (resolvedAddress) {
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.log('[MobileConnect] Success! Resolved Address:', resolvedAddress);
        setWalletHandoff(false);
        writeAuthFlowDebug({
          stage: 'mobile_resolved',
          address: resolvedAddress.slice(0, 8),
          hasSignMessage: 'signMessage' in targetWallet.adapter,
          adapterName: targetWallet.adapter.name,
        });
        setJwtDeclined(false);
        setPendingAutoEnterAddress(resolvedAddress);
        setViewState('scanning');
        rememberLastConnectedWalletName(targetWallet.adapter.name);
        trackWalletConnect('mwa');
        toast.success('Wallet Connected');
      } else {
        if (targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName) {
          console.warn('[MobileConnect] MWA did not return a public key yet; keeping connect flow quiet.');
          return;
        }
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
      setWalletHandoff(false);
      if (targetWallet.adapter.name === SolanaMobileWalletAdapterWalletName) {
        const message = err instanceof Error ? err.message : String(err ?? '');
        if (message.includes('mobile wallet protocol') || message.includes('ERROR_WALLET_NOT_FOUND')) {
          if (openPhantomDeepLink()) {
            return;
          }
        }
        if (isQuietMwaConnectError(err)) {
          console.warn('[MobileConnect] Quiet MWA connect failure:', err);
          try {
            select(null);
          } catch {
            /* empty */
          }
          return;
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
    mobileWallet,
    availableWallets,
    isCapacitor,
    isAndroidDevice,
    isSeekerDevice,
    select,
    isConnected,
    connectedAddress,
    wallet,
    disconnect,
    isIosDevice,
    startMwaAssociationNudge,
    setWalletHandoff,
    prewarmJwt,
  ]);

  useEffect(() => {
    if (coldLaunchPickerAttemptedRef.current) return;
    if (!(isCapacitor || isAndroidDevice || isSeekerDevice) || !useMobileWallet || !mobileConnectReady) return;
    if (availableWallets.length === 0) return;
    if (isConnected || activeAddress || jwtSigning || viewState !== 'landing') return;
    // Cold-launch auto-pop REMOVED — the landing screen now shows a CONNECT WALLET
    // button first; tapping it opens the picker (no duplicate picker+ENTER COSMOS gate).
    coldLaunchPickerAttemptedRef.current = true;
  }, [
    isCapacitor,
    isAndroidDevice,
    isSeekerDevice,
    useMobileWallet,
    mobileConnectReady,
    isConnected,
    activeAddress,
    jwtSigning,
    viewState,
    availableWallets,
    setWalletModalVisible,
  ]);

  const handleDesktopConnect = useCallback(async () => {
    const targetWallet = preferredDesktopWallet;
    if (!targetWallet) {
      toast.error('Wallet not detected');
      return;
    }

    try {
      isDisconnectingRef.current = false; // Clear disconnect flag on new connect
      hasReachedHub.current = false;
      jwtPrewarmedRef.current = null;
      jwtAttemptedRef.current = null;
      setJwtDeclined(false);
      clearStoredAuthJwt();
      if (isConnected && connectedAddress) {
        const connectedResolved = connectedAddress.toBase58();
        setViewState('scanning');
        const authWallet =
          wallet.publicKey && (wallet.signMessage || wallet.signIn)
            ? wallet
            : makeAdapterAuthWallet(targetWallet.adapter as AuthCapableAdapter, connectedResolved);
        if (!authWallet) {
          writeAuthFlowDebug({ stage: 'desktop_already_connected_no_signer', address: connectedResolved.slice(0, 8) });
          setJwtDeclined(true);
          setViewState('landing');
          return;
        }
        const signed = await prewarmJwt(authWallet, connectedResolved, { forceFresh: true });
        if (!signed) {
          setJwtDeclined(true);
          setViewState('landing');
          return;
        }
        setActiveAddress(connectedResolved);
        setViewState('scanning');
        return;
      }

      if (!desktopWalletReady) {
        if (Capacitor.isNativePlatform()) {
          void handleMobileConnect();
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
        setViewState('scanning');
        const authWallet = makeAdapterAuthWallet(targetWallet.adapter as AuthCapableAdapter, resolved);
        if (!authWallet) {
          writeAuthFlowDebug({ stage: 'desktop_resolved_no_signer', address: resolved.slice(0, 8) });
          setJwtDeclined(true);
          setViewState('landing');
          return;
        }
        const signed = await prewarmJwt(authWallet, resolved, { forceFresh: true });
        if (!signed) {
          setJwtDeclined(true);
          setViewState('landing');
          return;
        }
        setActiveAddress(resolved);
        setViewState('scanning');
        rememberLastConnectedWalletName(targetWallet.adapter.name);
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
    wallet,
    prewarmJwt,
  ]);

  const previewMode = import.meta.env.DEV && searchParams.has('preview');
  const resolvedAddress = activeAddress;
  const walletAddress = wallet.publicKey?.toBase58();
  const walletSignMessage = wallet.signMessage;
  const walletSignIn = wallet.signIn;
  const walletData = useWalletData(resolvedAddress);
  const { traits, score, address, isLoading } = walletData;
  const isNewWallet = Boolean(walletData.isNewWallet);

  useEffect(() => {
    if (!balanceAddress || address !== balanceAddress || !traits) return;
    setSolBalance(traits.solBalance);
  }, [address, balanceAddress, traits]);

  useEffect(() => {
    if (!resolvedAddress) return;
    if (suppressPassiveAuthRef.current) return;
    // Always re-check the JWT cache on resolvedAddress change. The early-return
    // guard that used to live here masked a Seeker SIWS race where the prewarm
    // ref was set but jwtDeclined had already been flipped to true by the state
    // machine, leaving the amber "Sign wallet to earn coins" banner stuck even
    // after a successful sign-in. Cheap to re-check, costs only one storage read.
    import('@/components/prism/shared').then(({ getCachedJwt }) => {
      if (getCachedJwt(resolvedAddress)) {
        jwtPrewarmedRef.current = resolvedAddress;
        setJwtDeclined(false);
        return;
      }
      if (jwtAttemptedRef.current === resolvedAddress || jwtPrewarmedRef.current === resolvedAddress) {
        // Already attempted via SIWS one-shot path; do not flip back to declined.
        return;
      }
      writeAuthFlowDebug({ stage: 'active_address_no_cached_jwt', address: resolvedAddress.slice(0, 8) });
      setJwtDeclined(true);
    });
  }, [resolvedAddress]);

  // Pre-warm JWT right after wallet connects — one signature at connect time, not later in hub
  useEffect(() => {
    if (!resolvedAddress || !walletAddress || (!walletSignMessage && !walletSignIn)) return;
    if (suppressPassiveAuthRef.current) return;
    if (jwtPrewarmedRef.current === resolvedAddress) return;
    if (jwtAttemptedRef.current === resolvedAddress) return;
    import('@/components/prism/shared').then(({ getCachedJwt }) => {
      if (getCachedJwt(resolvedAddress)) {
        jwtPrewarmedRef.current = resolvedAddress;
        setJwtDeclined(false);
      } else {
        setJwtDeclined(true);
      }
    });
    // Prefetch all data pages will need (balance, tokens, leaderboard)
    import('@/lib/prefetch').then(({ runPrefetch }) => runPrefetch(resolvedAddress));
    // Restore server-backed user data (loadout, scores, quests) into localStorage
    import('@/lib/userDataSync').then(({ loadFromServer }) => loadFromServer(resolvedAddress));
  }, [resolvedAddress, walletAddress, walletSignMessage, walletSignIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset hasReachedHub when address changes (new wallet / reconnect)
  useEffect(() => {
    hasReachedHub.current = false;
  }, [resolvedAddress]);

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

    if (jwtSigning) {
      setViewState('scanning');
      return;
    }

    if (resolvedAddress && !getCachedJwt(resolvedAddress)) {
      // Guard: SIWS one-shot may have just stored the JWT in the same render tick,
      // before getCachedJwt sees it. If our prewarm ref points to this address we
      // trust that the JWT exists and skip the declined fallback (otherwise the
      // amber "Sign wallet to earn coins" banner sticks even after a successful
      // SIWS sign-in on Seeker).
      if (jwtPrewarmedRef.current === resolvedAddress) {
        return;
      }
      setJwtDeclined(true);
      if (allowUnsignedHubRef.current || returningFromBH.current) {
        setViewState(forceIdentityCardRoute ? 'ready' : 'hub');
        return;
      }
      setActiveAddress(undefined);
      setViewState('landing');
      return;
    }

    // When returning from BlackHole/Game/SubPage, skip scanning and go straight to hub
    if ((returningFromBH.current || suppressLoadingRef.current || returningFromSubPage.current) && resolvedAddress) {
      setViewState(forceIdentityCardRoute ? 'ready' : 'hub');
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
          if (readCachedWalletData(resolvedAddress)) {
            // Data is in cache — useWalletData will restore it momentarily; don't flash scan
            return;
          }
        } catch {
          /* ignore */
        }
      }
      setViewState('scanning');
    } else {
      if (forceIdentityCardRoute) {
        hasReachedHub.current = true;
        setViewState('ready');
        if (returningFromSubPage.current) returningFromSubPage.current = false;
        if (returningFromGameJump.current) returningFromGameJump.current = false;
        return;
      }
      // After scan → go to Hub. But only once — don't re-trigger on background trait updates.
      if (viewStateRef.current === 'scanning') {
        // Traits loaded (from cache or fresh) while still in scanning — go to hub
        hasReachedHub.current = true;
        setViewState(isNewWallet ? 'ready' : 'hub');
      } else if (!hasReachedHub.current) {
        hasReachedHub.current = true;
        if (viewStateRef.current !== 'ready' && viewStateRef.current !== 'hub') {
          setViewState(isNewWallet ? 'ready' : 'hub');
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
      if (resolvedAddress) {
        const token = getCachedJwt(resolvedAddress);
        const base = getApiBase();
        if (token && base) {
          fetchApiJson<{
            migrated?: boolean;
            migrationRev?: number;
            migrationData?: import('@/components/WelcomeBackModal').MigrationData;
          }>(`${base}/api/v2/migration-status?address=${encodeURIComponent(resolvedAddress)}`, {
            headers: { Authorization: `Bearer ${token}` },
            timeoutMs: 5_000,
          })
            .then((data) => {
              const migrationRev = String(data?.migrationData?.migrationRev ?? data?.migrationRev ?? 'legacy');
              const shownKey = `welcome_back_shown_${resolvedAddress}`;
              try {
                if (sessionStorage.getItem(shownKey) === migrationRev || localStorage.getItem(shownKey) === migrationRev) return;
              } catch {
                /* ignore */
              }
              if (data?.migrated && data.migrationData) {
                // Persist the "shown" flag immediately on display, not only on
                // dismissal, so an unclean close (app killed / WebView reclaimed)
                // can't leave the gate open and reshow the modal next launch.
                try { localStorage.setItem(shownKey, migrationRev); } catch { /* ignore */ }
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
  }, [resolvedAddress, isWarping, traits, fromBlackHole, walletStable, jwtSigning, forceIdentityCardRoute, isNewWallet]);

  // Removed auto-warp effect

  useEffect(() => {
    if (!pendingAutoEnterAddress) return;
    if (suppressPassiveAuthRef.current) return;
    if (siwsInProgressRef.current) return;
    const connectedResolved = connectedAddress?.toBase58() ?? wallet.publicKey?.toBase58();
    const adapterAuthWallet = mobileWallet?.adapter
      ? makeAdapterAuthWallet(mobileWallet.adapter as AuthCapableAdapter, pendingAutoEnterAddress)
      : null;
    const authWallet = wallet.publicKey && (wallet.signMessage || wallet.signIn) ? wallet : adapterAuthWallet;
    if (!authWallet) return;
    if (jwtPrewarmInFlightAddressRef.current === pendingAutoEnterAddress) return;

    let cancelled = false;
    const run = async () => {
      writeAuthFlowDebug({ stage: 'auto_enter_sign_start', address: pendingAutoEnterAddress.slice(0, 8) });
      setJwtDeclined(false);
      
      // Android Intent Collision Fix:
      // If we just finished a connection (e.g. via MWA performAuthorization), the MWA intent is still closing.
      // We must delay slightly before requesting the signature to ensure the second popup can open.
      if (Capacitor.isNativePlatform() || /android/i.test(navigator.userAgent)) {
        await new Promise((r) => setTimeout(r, 600));
      }
      
      const signed = await prewarmJwt(authWallet, pendingAutoEnterAddress, { forceFresh: true });
      if (cancelled) return;
      if (!signed) {
        writeAuthFlowDebug({ stage: 'auto_enter_sign_failed', address: pendingAutoEnterAddress.slice(0, 8) });
        setJwtDeclined(true);
        setPendingAutoEnterAddress(null);
        setViewState('landing');
        return;
      }

      writeAuthFlowDebug({ stage: 'auto_enter_signed', address: pendingAutoEnterAddress.slice(0, 8) });
      setPendingAutoEnterAddress(null);
      setActiveAddress(pendingAutoEnterAddress);
      setIsWarping(true);
      setViewState('scanning');
      clearTimeout(warpTimerRef.current);
      warpTimerRef.current = setTimeout(() => setIsWarping(false), 900);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [pendingAutoEnterAddress, connectedAddress, wallet, mobileWallet?.adapter, prewarmJwt, setViewState]);

  useEffect(() => {
    if (activeAddress || !walletStable || !isConnected || jwtDeclined) return;
    if (suppressPassiveAuthRef.current) return;
    if (siwsInProgressRef.current) return;
    const connectedResolved = connectedAddress?.toBase58() ?? wallet.publicKey?.toBase58();
    if (!connectedResolved) return;
    if (autoEnterAttemptedRef.current === connectedResolved) return;
    if (jwtPrewarmInFlightAddressRef.current === connectedResolved) return;

    let cancelled = false;
    autoEnterAttemptedRef.current = connectedResolved;
    const run = async () => {
      const { getCachedJwt } = await import('@/components/prism/shared');
      if (cancelled) return;
      if (getCachedJwt(connectedResolved)) {
        writeAuthFlowDebug({ stage: 'auto_enter_fallback_cached', address: connectedResolved.slice(0, 8) });
        setPendingAutoEnterAddress(null);
        setActiveAddress(connectedResolved);
        setIsWarping(true);
        setViewState('scanning');
        clearTimeout(warpTimerRef.current);
        warpTimerRef.current = setTimeout(() => setIsWarping(false), 900);
        return;
      }

      // No cached JWT — auto-trigger the Enter Cosmos flow so the user goes
      // straight from wallet pick → SIWS approve → hub, skipping the
      // intermediate "ENTER COSMOS" landing screen.
      writeAuthFlowDebug({ stage: 'auto_enter_invoke_handle_enter', address: connectedResolved.slice(0, 8) });
      void handleEnter();
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    activeAddress,
    walletStable,
    isConnected,
    jwtDeclined,
    connectedAddress,
    wallet,
    mobileWallet?.adapter,
    prewarmJwt,
    setViewState,
  ]);

  const handleEnter = async () => {
    if (!connectedAddress) return;

    const nextAddress = connectedAddress.toBase58();
    isDisconnectingRef.current = false; // Clear disconnect flag on new connect
    setJwtDeclined(false);
    setViewState('scanning');

    const cachedJwt = getCachedJwt(nextAddress);
    if (cachedJwt) {
      jwtPrewarmedRef.current = nextAddress;
      writeAuthFlowDebug({ stage: 'enter_cached_jwt', address: nextAddress.slice(0, 8) });
    }

    if (!cachedJwt && jwtPrewarmedRef.current !== nextAddress) {
      const authWallet =
        wallet.publicKey && (wallet.signMessage || wallet.signIn)
          ? wallet
          : _selectedWallet?.adapter
            ? makeAdapterAuthWallet(_selectedWallet.adapter as AuthCapableAdapter, nextAddress)
            : mobileWallet?.adapter
              ? makeAdapterAuthWallet(mobileWallet.adapter as AuthCapableAdapter, nextAddress)
              : null;

      if (!authWallet) {
        writeAuthFlowDebug({ stage: 'enter_no_signer', address: nextAddress.slice(0, 8) });
        setJwtDeclined(true);
        setViewState('landing');
        return;
      }

      const signed = await prewarmJwt(authWallet, nextAddress, { forceFresh: true });
      if (!signed) {
        setJwtDeclined(true);
        setViewState('landing');
        return;
      }
    }

    setActiveAddress(nextAddress);
    setIsWarping(true);
    setViewState('scanning'); // Immediate — prevents one-frame flash
    clearTimeout(warpTimerRef.current);
    warpTimerRef.current = setTimeout(() => setIsWarping(false), 900);
  };
  useEffect(() => () => clearTimeout(warpTimerRef.current), []);

  const handleDisconnect = async () => {
    // Set flag BEFORE async disconnect so state machine doesn't override viewState
    isDisconnectingRef.current = true;
    // Fallback: always clear flag after 500ms to prevent state machine lockup on fast reconnect
    setTimeout(() => {
      isDisconnectingRef.current = false;
    }, 500);
    // Clear returning refs so effects don't re-set activeAddress after disconnect
    returningFromSubPage.current = false;
    returningFromBH.current = false;
    returningFromGameJump.current = false;
    hasReachedHub.current = false;
    setActiveAddress(undefined);
    setPendingAutoEnterAddress(null);
    jwtPrewarmedRef.current = null;
    setViewState('landing');
    // Re-arm the cold-launch account picker and forget the preferred address so that
    // CONNECT after logout lets the user RE-SELECT any Seed Vault account instead of
    // silently resuming the last one. This is the account-switch path now that the
    // in-hub S1/S2 switcher was removed.
    coldLaunchPickerAttemptedRef.current = false;
    // NOTE: do NOT re-arm autoEnterAttemptedRef here — doing so makes auto-enter fire during the
    // disconnect window (while isConnected is still true), which silently re-connects the last
    // wallet instead of returning to the landing/picker. Re-arming happens on a deliberate pick
    // (handleSeedAccountPicked) instead.
    writePreferredMobileWalletAddress(null);
    // Clear URL ?address= param so the urlAddress sync effect (line ~264) doesn't
    // immediately re-set activeAddress from the stale URL
    const next = new URLSearchParams(searchParams);
    if (next.has('address')) {
      next.delete('address');
      next.delete('mode');
      setSearchParams(next, { replace: true });
    }
    // Clear wallet session data
    clearStoredAuthJwt();
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

  const handleSwitchSeedAccount = async () => {
    const nextIndex = readSeedWalletIndex() === 0 ? 1 : 0;
    writeSeedWalletIndex(nextIndex);
    writePreferredMobileWalletAddress(null);
    setSeedAccountIndex(nextIndex);
    await handleDisconnect();
  };

  const [mintState, setMintState] = useState<'idle' | 'minting' | 'success' | 'error'>('idle');
  const [remintState, setRemintState] = useState<'idle' | 'updating' | 'success' | 'error'>('idle');
  const [hasExistingId, setHasExistingId] = useState<boolean | null>(null);
  const [paymentToken, setPaymentToken] = useState<PaymentToken>('SOL');
  const [skrQuote, setSkrQuote] = useState<{ skrAmount: number } | null>(null);
  const [skrQuoteError, setSkrQuoteError] = useState<string | null>(null);
  const [, setSkrQuoteLoading] = useState(false);
  const proxyBase = getHeliusProxyUrl();

  // Check if the wallet already owns an Identity Prism (to gate Update button)
  useEffect(() => {
    const addr = wallet?.publicKey?.toBase58();
    if (!addr || !activeAddress || activeAddress !== addr) {
      setHasExistingId(null);
      return;
    }
    const heliusUrl = getHeliusRpcUrl(addr);
    const collectionMint = getCollectionMint();
    if (!proxyBase && (!heliusUrl || !collectionMint)) return;
    let cancelled = false;
    (async () => {
      try {
        // Authoritative mint check via the prism summary endpoint. Use fetchApiJson
        // (CapacitorHttp-backed + retrying) — raw fetch() is unreliable from the native WebView,
        // which left owners undetected so the MINT button wrongly showed for ID holders.
        const summary = await fetchApiJson<{ mint?: { minted?: boolean } }>(
          `${getApiBase()}/api/prism/summary?address=${encodeURIComponent(addr)}`,
        ).catch(() => null);
        if (cancelled) return;
        if (summary?.mint?.minted === true) {
          setHasExistingId(true);
          return;
        }
        if (summary?.mint && summary.mint.minted === false) {
          setHasExistingId(false);
          return;
        }
        if (!heliusUrl || !collectionMint) return;
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
        if (!cancelled) setHasExistingId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet?.publicKey, activeAddress, proxyBase]);

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

  const obtainScopedJwt = useCallback(
    async (baseUrl: string): Promise<string | null> => {
      const address = wallet.publicKey?.toBase58();
      if (!address || !wallet.signMessage) return null;
      const cacheKey = `ip_auth_jwt:${baseUrl}:${address}`;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw) as { token?: string; expiresAt?: number };
          if (cached.token && typeof cached.expiresAt === 'number' && cached.expiresAt > Date.now() + 60_000) {
            return cached.token;
          }
          sessionStorage.removeItem(cacheKey);
        }
      } catch {
        /* ignore */
      }

      const challengeRes = await fetch(`${baseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!challengeRes.ok) return null;
      const { nonce, message } = (await challengeRes.json()) as { nonce: string; message: string };
      const signatureBytes = await wallet.signMessage(new TextEncoder().encode(message));
      const signatureHex = Array.from(signatureBytes, (b) => b.toString(16).padStart(2, '0')).join('');
      const tokenRes = await fetch(`${baseUrl}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, nonce, signature: signatureHex }),
      });
      if (!tokenRes.ok) return null;
      const { token } = (await tokenRes.json()) as { token: string };
      try {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({ token, address, expiresAt: Date.now() + 23 * 60 * 60 * 1000 }),
        );
      } catch {
        /* ignore */
      }
      return token;
    },
    [wallet],
  );

  const uploadCardImage = useCallback(
    async (dataUrl: string) => {
      const metadataBaseUrl = getMetadataBaseUrl();
      if (!metadataBaseUrl) throw new Error('Metadata URL missing');
      const jwt = await obtainScopedJwt(metadataBaseUrl);
      if (!jwt) throw new Error('Wallet authorization required for card image upload');

      const response = await fetch(`${metadataBaseUrl}/metadata/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
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
    },
    [obtainScopedJwt],
  );

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
    const signerAddress = wallet.publicKey?.toBase58?.();
    console.warn(
      `[handleMint] start paymentToken=${paymentToken} signer=${signerAddress ?? 'none'} active=${
        resolvedAddress ?? 'none'
      } data=${address ?? 'none'} hasWallet=${Boolean(wallet)} hasPublicKey=${Boolean(
        wallet.publicKey,
      )} hasTraits=${Boolean(traits)} skrQuoteReady=${Boolean(skrQuote)}`,
    );
    if (!wallet.publicKey || !traits) {
      console.warn(
        `[handleMint] guard failed signer=${signerAddress ?? 'none'} active=${resolvedAddress ?? 'none'} data=${
          address ?? 'none'
        } view=${viewState} isLoading=${Boolean(isLoading)} hasTraits=${Boolean(traits)}`,
      );
      toast.error('Mint unavailable', {
        description: !wallet.publicKey
          ? 'Wallet signer is not ready. Reconnect wallet and try again.'
          : 'Identity data is still loading. Wait a moment and retry.',
      });
      return;
    }

    if (paymentToken === 'SKR' && !skrQuote) {
      toast.error('SKR price unavailable', {
        description: 'Please try again in a moment.',
      });
      return;
    }

    setMintState('minting');
    let succeeded = false;
    // Safety: auto-reset spinner if wallet promise hangs (e.g. Seeker silently drops request)
    // Native mint can take minutes on Seeker: card capture/upload, backend prepare,
    // wallet approval, and finalize all happen in sequence.
    const safetyTimer = setTimeout(() => {
      if (!succeeded) {
        setMintState('idle');
        toast.info('Transaction timed out — please try again');
      }
    }, 420_000);
    try {
      const cardImageUrl = shouldSkipMintCardCapture ? undefined : await captureCardImage();
      console.warn('[handleMint] card image ready', { skipped: shouldSkipMintCardCapture, hasCardImageUrl: !!cardImageUrl });
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
      setHasExistingId(true);
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
        try {
          const rawKeys = err && typeof err === 'object' ? Object.getOwnPropertyNames(err) : [];
          const rawDump: Record<string, unknown> = {};
          for (const k of rawKeys) rawDump[k] = String((err as Record<string, unknown>)[k]).slice(0, 400);
          const stack = err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : '';
          console.error('Mint error detail:', JSON.stringify({ message: msg, code, name: errName, rawKeys, rawDump, stack }));
        } catch (logErr) {
          console.error('Mint error detail (raw):', msg, '| logErr:', String(logErr));
        }
        const isUserCancel =
          /reject|cancel|denied|abort|dismiss|decline|user.?reject|user.?decline|4001|USER_REJECTED|SIGN_TIMEOUT/i.test(
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
  }, [
    wallet,
    traits,
    score,
    captureCardImage,
    paymentToken,
    skrQuote,
    shouldSkipMintCardCapture,
    resolvedAddress,
    address,
    viewState,
    isLoading,
  ]);

  const handleMintWithCoins = useCallback(async () => {
    const signerAddress = wallet.publicKey?.toBase58?.();
    console.warn(
      `[handleMintWithCoins] start paymentToken=${paymentToken} signer=${signerAddress ?? 'none'} active=${
        resolvedAddress ?? 'none'
      } data=${address ?? 'none'} hasPublicKey=${Boolean(wallet.publicKey)} hasTraits=${Boolean(traits)}`,
    );
    if (!wallet.publicKey || !traits) {
      console.warn(
        `[handleMintWithCoins] guard failed signer=${signerAddress ?? 'none'} active=${
          resolvedAddress ?? 'none'
        } data=${address ?? 'none'} view=${viewState} isLoading=${Boolean(isLoading)} hasTraits=${Boolean(traits)}`,
      );
      toast.error('Mint unavailable', {
        description: !wallet.publicKey
          ? 'Wallet signer is not ready. Reconnect wallet and try again.'
          : 'Identity data is still loading. Wait a moment and retry.',
      });
      return;
    }
    setMintState('minting');
    let succeeded = false;
    const safetyTimer = setTimeout(() => {
      if (!succeeded) {
        setMintState('idle');
        toast.info('Transaction timed out — please try again');
      }
    }, 300_000);
    try {
      const cardImageUrl = shouldSkipMintCardCapture ? undefined : await captureCardImage();
      console.warn('[handleMintWithCoins] card image ready', { skipped: shouldSkipMintCardCapture, hasCardImageUrl: !!cardImageUrl });
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
      console.warn('[handleMintWithCoins] mintIdentityPrism returned', { signature: result?.signature });
      // eslint-disable-next-line no-console
      if (import.meta.env.DEV) console.log('Mint-for-coins success:', result);
      succeeded = true;
      trackMint(true);
      setMintState('success');
      setHasExistingId(true);
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
        /reject|cancel|denied|abort|dismiss|decline|user.?reject|user.?decline|4001|USER_REJECTED|SIGN_TIMEOUT/i.test(
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
  }, [
    wallet,
    traits,
    score,
    captureCardImage,
    prismBalance,
    shouldSkipMintCardCapture,
    paymentToken,
    resolvedAddress,
    address,
    viewState,
    isLoading,
  ]);

  useEffect(() => {
    if (walletData.isMinted) setHasExistingId(true);
  }, [walletData.isMinted]);

  const hasMintedIdentity = hasExistingId === true || walletData.isMinted === true;
  const isMintStatusChecking =
    Boolean(resolvedAddress && walletData.traits) && hasExistingId === null && walletData.isMinted !== true;

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
      const cardImageUrl = shouldSkipMintCardCapture ? undefined : await captureCardImage();
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
  }, [wallet, traits, score, captureCardImage, shouldSkipMintCardCapture]);

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
    // When we land in the hub with an active address, clear the "Sign wallet to
    // earn coins" banner if a JWT is already cached. This unbreaks the Seeker
    // SIWS one-shot flow where the JWT exists but jwtDeclined was flipped to
    // true earlier in the render cycle.
    if (viewState === 'hub' && activeAddress) {
      import('@/components/prism/shared').then(({ getCachedJwt }) => {
        if (getCachedJwt(activeAddress)) {
          jwtPrewarmedRef.current = activeAddress;
          setJwtDeclined(false);
        }
      });
    }
  }, [viewState, activeAddress]);

  // One-time coach-mark pointing at the mini-passport, for returning users who
  // already completed onboarding (`ip_onboarding_v1`) but never got a nudge
  // toward "tap the passport to open the full card". Separate flag so it fires
  // once independently of the onboarding flow, and never overlaps it.
  useEffect(() => {
    if (viewState !== 'hub' || !activeAddress || showOnboarding) return;
    let alreadySeen = true;
    try {
      alreadySeen = Boolean(localStorage.getItem('ip_card_hint_v1'));
    } catch {
      /* ignore */
    }
    if (alreadySeen) return;
    const showTimer = setTimeout(() => setShowCardHint(true), 700);
    return () => clearTimeout(showTimer);
  }, [viewState, activeAddress, showOnboarding]);

  const dismissCardHint = useCallback(() => {
    setShowCardHint(false);
    if (cardHintTimerRef.current) {
      clearTimeout(cardHintTimerRef.current);
      cardHintTimerRef.current = null;
    }
    try {
      localStorage.setItem('ip_card_hint_v1', '1');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!showCardHint) return;
    cardHintTimerRef.current = setTimeout(() => dismissCardHint(), 5500);
    return () => {
      if (cardHintTimerRef.current) {
        clearTimeout(cardHintTimerRef.current);
        cardHintTimerRef.current = null;
      }
    };
  }, [showCardHint, dismissCardHint]);

  // Safety net: if new-user onboarding kicks in after the hint was already
  // shown (race), hide the hint without burning the flag — it can still show
  // on a later hub visit.
  useEffect(() => {
    if (showOnboarding && showCardHint) {
      setShowCardHint(false);
      if (cardHintTimerRef.current) {
        clearTimeout(cardHintTimerRef.current);
        cardHintTimerRef.current = null;
      }
    }
  }, [showOnboarding, showCardHint]);

  const skipCurtain = isReturning || hasVisitedHub.current;
  const [curtainOpen, setCurtainOpen] = useState(skipCurtain);
  const [curtainDone, setCurtainDone] = useState(skipCurtain);

  // Additive: existing-wallet path routes scanning -> hub, skipping 'ready', so
  // also treat reaching 'hub' as readiness. Does not remove the original condition.
  const everythingReady = (showReadyView && sceneReady) || viewState === 'hub';

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

  // Safety net: never leave the loading curtain (the 3 bouncing dots) up forever.
  // Some paths (e.g. a freshly-minted wallet routing scanning -> 'ready' where the 3D
  // scene never signals sceneReady) never satisfy everythingReady, so force-dismiss
  // after a bounded timeout. Gated on viewState !== 'landing': on landing the same
  // overlay renders the CONNECT WALLET screen and must stay (forcing it there blanks
  // the landing). This only fires on scanning/ready/hub, where a stuck curtain is a bug.
  useEffect(() => {
    if (curtainDone || viewState === 'landing') return;
    const t = setTimeout(() => {
      // Guard against a stale closure: if the app transitioned to 'landing'
      // while this timeout was queued, don't force-dismiss — that would
      // re-blank the CONNECT WALLET screen after the landing-reset effect ran.
      if (viewStateRef.current === 'landing') return;
      setCurtainOpen(true);
      setCurtainDone(true);
    }, 8000);
    return () => clearTimeout(t);
  }, [curtainDone, viewState]);

  // Only reset everything when explicitly going back to landing
  useEffect(() => {
    if (viewState === 'landing') {
      setSceneReady(false);
      setCurtainOpen(false);
      setCurtainDone(false);
    }
  }, [viewState]);

  const showOverlay = !curtainDone && !suppressLoadingRef.current;
  // Wallet balance of the selected currency — shown in the .identity-pay-price row above the button.
  // (SOL/SKR are fetched via CapacitorHttp with retry on the native shell — see the
  // balanceAddress effect above — so "—" here just means the fetch hasn't resolved yet.)
  const activePaymentAmount =
    paymentToken === 'SOL'
      ? `${solBalance == null ? '—' : Number(solBalance).toFixed(3)} SOL`
      : paymentToken === 'SKR'
        ? `${skrBalance == null ? '—' : Math.floor(skrBalance).toLocaleString()} SKR`
        : `${prismBalance?.balance == null ? '—' : Math.floor(Number(prismBalance.balance)).toLocaleString()} PRISM`;
  // Cost to mint with the selected currency — shown on the mint button (SKR = live ~0.03 SOL quote).
  const mintCost = formatMintCost(paymentToken, skrQuote?.skrAmount ?? null);

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
  }, [isScrollEnabled, viewState, isNftMode]);

  return (
    <div
      ref={shellRef}
      className={`identity-shell relative min-h-screen ${previewMode && !isNftMode ? 'preview-scroll' : ''} ${isScrollEnabled ? 'scrollable-shell' : ''} ${isNftMode ? 'is-nft-view nft-kiosk-mode' : ''}`}
    >
      <SeedVaultAccountPicker
        visible={seedPickerVisible}
        onClose={() => setSeedPickerVisible(false)}
        onSelect={(addr) => { void handleSeedAccountPicked(addr); }}
      />
      {viewState === 'hub' && !activeAddress ? (
        // Transitional: hub state but wallet address not synced yet.
        // Show dark bg — preloader or fade overlay covers this briefly.
        <div style={{ position: 'fixed', inset: 0, background: '#050510' }} />
      ) : viewState === 'hub' && activeAddress ? (
        <React.Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#050510' }} />}>
          {showCardHint && !showOnboarding && (
            <div
              className="fixed left-1/2 z-40 w-full max-w-xs -translate-x-1/2 px-4 pointer-events-none"
              style={{ top: 'calc(env(safe-area-inset-top, 0px) + 68px)' }}
            >
              <button
                type="button"
                onClick={dismissCardHint}
                className="pointer-events-auto flex w-full items-center gap-2 rounded-xl border border-cyan-300/30 bg-[#0b1220]/95 px-3 py-2.5 text-left shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
              >
                <ChevronRight className="h-4 w-4 flex-shrink-0 animate-pulse text-cyan-300" aria-hidden="true" />
                <span className="text-[11px] font-medium text-cyan-50">
                  Tap your passport to open your Identity card
                </span>
              </button>
            </div>
          )}
          <CosmicHub
            walletAddress={activeAddress}
            prismBalance={prismBalance}
            onNavigateToCard={() => {
              setCurtainOpen(true);
              setCurtainDone(true);
              setViewState('ready');
              fadeOutTransition(0);
            }}
            onDisconnect={handleDisconnect}
            onSwitchSeedAccount={handleSwitchSeedAccount}
            seedAccountIndex={seedAccountIndex}
            identityScore={walletData.score}
            planetTier={walletData.traits?.planetTier}
            jwtDeclined={jwtDeclined}
            onRequestSign={() => {
              setJwtDeclined(false);
              import('@/components/prism/shared').then(async ({ obtainJwt, setAuthWallet }) => {
                const authWallet =
                  wallet.publicKey && (wallet.signMessage || wallet.signIn)
                    ? wallet
                    : activeAddress && mobileWallet?.adapter
                      ? makeAdapterAuthWallet(mobileWallet.adapter as AuthCapableAdapter, activeAddress)
                      : null;
                if (!authWallet) {
                  setJwtDeclined(true);
                  return;
                }
                setAuthWallet(authWallet);
                setJwtSigning(true);
                try {
                  const jwt = await obtainJwt(authWallet, { forceFresh: true });
                  setJwtDeclined(!jwt);
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
                  className={`card-stage relative z-20 controls-closed${!showReadyView ? ' hidden' : ''}`}
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
                    <div className="mint-panel open">
                      <div className="mint-panel-content">
                        {/* Pay-selector — chips with icon, shows balance for active currency */}
                        <div className="identity-pay-selector" role="group" aria-label="Select payment currency">
                          {([
                            { key: 'SOL', label: 'SOL', iconUrl: '/tokens/sol-icon.png' },
                            { key: 'SKR', label: 'SKR', iconUrl: '/tokens/skr-icon.png' },
                            { key: 'COINS', label: 'PRISM', iconUrl: '/tokens/prism-icon.png' },
                          ] as const).map((opt) => {
                            const active = paymentToken === opt.key;
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                className={`identity-pay-chip${active ? ' active' : ''}`}
                                onClick={() => setPaymentToken(opt.key as PaymentToken)}
                                aria-pressed={active}
                                aria-label={opt.label}
                                title={opt.label}
                              >
                                {'iconUrl' in opt && opt.iconUrl ? (
                                  <img
                                    src={opt.iconUrl}
                                    className="identity-pay-icon"
                                    alt=""
                                    onError={(e) => {
                                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <span className="identity-pay-emoji" aria-hidden="true">{('emoji' in opt) ? opt.emoji : ''}</span>
                                )}
                                <span className="identity-pay-label">{opt.label}</span>
                              </button>
                            );
                          })}
                          <div className="identity-pay-price" aria-live="polite">
                            {activePaymentAmount}
                          </div>
                        </div>

                        {/* MINT button — only when the wallet does NOT already own an identity (owners get UPDATE instead) */}
                        {!hasMintedIdentity && (
                        <Button
                          variant="ghost"
                          onClick={paymentToken === 'COINS' ? handleMintWithCoins : handleMint}
                          className="mint-primary-btn"
                          disabled={isMintStatusChecking || mintState === 'minting' || remintState === 'updating'}
                        >
                          {mintState === 'minting' ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              MINTING
                            </>
                          ) : isMintStatusChecking ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              CHECKING IDENTITY
                            </>
                          ) : (
                            <>
                              <Coins className="h-4 w-4 mr-2" />
                              {isNewWallet ? `Mint to Activate · ${mintCost}` : `MINT IDENTITY · ${mintCost}`}
                            </>
                          )}
                        </Button>
                        )}

                        {/* Update existing card — shown when the wallet already owns an identity */}
                        {hasMintedIdentity && (
                          <Button
                            variant="ghost"
                            onClick={handleRemint}
                            className="mint-secondary-btn"
                            disabled={isMintStatusChecking || mintState === 'minting' || remintState === 'updating'}
                          >
                            {remintState === 'updating' ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                UPDATING
                              </>
                            ) : (
                              <>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                UPDATE IDENTITY
                              </>
                            )}
                          </Button>
                        )}

                        <Button variant="ghost" onClick={handleShare} className="mint-share-btn">
                          <Share2 className="h-4 w-4 mr-2" />
                          SHARE ON X
                        </Button>
                        <HubReturnButton
                          onClick={() => {
                            startFadeTransition(() => {
                              setViewState('hub');
                              fadeOutTransition(100);
                            });
                          }}
                          className="mint-secondary-btn"
                        />
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
              onMobileConnect={() => {
                void handleMobileConnect();
              }}
              mobileWalletReady={mobileConnectReady}
              onDesktopConnect={handleDesktopConnect}
              desktopWalletReady={desktopWalletReady}
              scanningMessageIndex={scanningMessageIndex}
              jwtSigning={jwtSigning}
            />
          )}

          {walletHandoffActive && (
            <div className="wallet-handoff-shield" aria-live="polite">
              <div className="wallet-handoff-card">
                <div className="wallet-handoff-orb">
                  <Loader2 className="h-6 w-6 animate-spin text-cyan-100" />
                </div>
                <p className="wallet-handoff-eyebrow">Opening secure wallet</p>
                <h2 className="wallet-handoff-title">Choose your Identity Prism account</h2>
                <p className="wallet-handoff-copy">Keep this screen open while Solana Wallet prepares the approval.</p>
              </div>
            </div>
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
                  sessionStorage.setItem(
                    `welcome_back_shown_${resolvedAddress}`,
                    String(welcomeBackData.migrationRev ?? 'legacy'),
                  );
                  localStorage.setItem(
                    `welcome_back_shown_${resolvedAddress}`,
                    String(welcomeBackData.migrationRev ?? 'legacy'),
                  );
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
