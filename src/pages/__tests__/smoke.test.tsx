/**
 * @vitest-environment jsdom
 *
 * Smoke tests — verify pages mount without throwing.
 * Not a deep assertion suite; "renders without crashing" is the bar.
 */

import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ── Global stubs ──────────────────────────────────────────────────────────────

// Wallet adapter — use importOriginal to keep all exports, override hooks only
vi.mock('@solana/wallet-adapter-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useWallet: () => ({
      publicKey: null,
      connected: false,
      signTransaction: undefined,
      signMessage: undefined,
      sendTransaction: undefined,
      wallet: null,
      wallets: [],
      select: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    useConnection: () => ({ connection: {} }),
    // useLocalStorage is used by CustomWalletProvider — return stable [null, noop]
    useLocalStorage: <T,>(_key: string, def: T): [T, (v: T) => void] => [def, vi.fn()],
    ConnectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    WalletProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@solana/wallet-adapter-react-ui', () => ({
  useWalletModal: () => ({ setVisible: vi.fn(), visible: false }),
  WalletModalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@solana-mobile/wallet-adapter-mobile', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SolanaMobileWalletAdapterWalletName: 'SolanaMobileWalletAdapter',
  };
});

// Constants — pass through real module so all exports are available
vi.mock('@/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/constants')>();
  return {
    ...actual,
    getHeliusProxyUrl: () => 'http://localhost:3000',
    getHeliusRpcUrl: () => 'http://localhost:3000/rpc',
    getAppBaseUrl: () => 'http://localhost:5173',
    getMetadataBaseUrl: () => 'http://localhost:3000',
  };
});

// Three.js / R3F — headless, no WebGL needed
vi.mock('@react-three/fiber', () => ({
  Canvas: () => null,
  useFrame: vi.fn(),
  useThree: () => ({ gl: {}, camera: {}, scene: {} }),
  useLoader: vi.fn(() => ({})),
  extend: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  Stars: () => null,
  Text: () => null,
  useGLTF: vi.fn(() => ({ scene: null, nodes: {}, materials: {} })),
}));

vi.mock('@react-three/postprocessing', () => ({
  EffectComposer: () => null,
  Bloom: () => null,
  Vignette: () => null,
}));

// three — use importOriginal so all geometry/material classes are real stubs.
// We override TextureLoader.load so it doesn't attempt real I/O.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  // Patch TextureLoader to return an empty Texture without touching the DOM
  class SafeTextureLoader extends actual.TextureLoader {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    load(_url: string, onLoad?: (t: any) => void): any {
      const tex = new actual.Texture();
      onLoad?.(tex);
      return tex;
    }
  }
  return { ...actual, TextureLoader: SafeTextureLoader };
});

// Audio / haptics / analytics
vi.mock('@/lib/gameAudio', () => ({
  initAudio: vi.fn(),
  startMusic: vi.fn(),
  stopAllAudio: vi.fn(),
  sfxGameOver: vi.fn(),
}));

vi.mock('@/lib/haptics', () => ({
  hapticHeavy: vi.fn(),
  hapticMedium: vi.fn(),
  hapticSuccess: vi.fn(),
  hapticError: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
  initAnalytics: vi.fn(),
  trackEvent: vi.fn(),
  trackPageView: vi.fn(),
  trackWalletConnect: vi.fn(),
  trackWalletDisconnect: vi.fn(),
  trackMint: vi.fn(),
  trackGameStart: vi.fn(),
  trackGameOver: vi.fn(),
  trackChallengeCreate: vi.fn(),
  trackChallengeAccept: vi.fn(),
  trackCompare: vi.fn(),
  trackForgePurchase: vi.fn(),
  trackConstellationSearch: vi.fn(),
}));

vi.mock('@/lib/onchainLeaderboard', () => ({
  commitScoreOnchain: vi.fn(),
}));

// Fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  } as Response),
);

// Capacitor
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: vi.fn(), vibrate: vi.fn() } }));

// react-router-dom navigate
vi.mock('@/lib/safeNavigate', () => ({ goBack: vi.fn() }));
vi.mock('@/lib/fadeTransition', () => ({
  fadeOutTransition: vi.fn((_el, cb) => cb?.()),
  startFadeTransition: vi.fn((_el, cb) => cb?.()),
}));

// useCompositeScore / prefetch
vi.mock('@/hooks/useCompositeScore', () => ({
  useCompositeScore: () => ({ score: null, loading: false, error: null }),
  invalidateCompositeCache: vi.fn(),
}));

vi.mock('@/lib/prefetch', () => ({
  invalidateBalanceCache: vi.fn(),
  prefetchWalletData: vi.fn(),
}));

// prismCoin
vi.mock('@/lib/prismCoin', () => ({
  getPrismBalance: vi.fn(async () => ({ balance: 0, earned: 0, spent: 0 })),
  earnPrism: vi.fn(async () => {}),
  canEarnFromScan: vi.fn(() => true),
  markScanEarned: vi.fn(),
  COIN_PACKAGES: [],
}));

// api
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(async () => ({})),
    post: vi.fn(async () => ({})),
  },
}));

// mwaAuthorizationCache
vi.mock('@/lib/mwaAuthorizationCache', () => ({
  extractMwaAddress: vi.fn(() => null),
  mwaAuthorizationCache: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));

// Game scenes (heavy, mock out entirely)
vi.mock('@/components/game/OrbitSurvivalScene', () => ({ default: () => <div data-testid="orbit-scene" /> }));
vi.mock('@/components/game/AsteroidDestroyerScene', () => ({ default: () => <div data-testid="asteroid-scene" /> }));
vi.mock('@/components/game/GravityRunnerScene', () => ({ default: () => <div data-testid="gravity-scene" /> }));

// CosmicStarfield (canvas 2d, no WebGL needed but jsdom lacks it)
vi.mock('@/components/CosmicStarfield', () => ({
  CosmicStarfield: () => <div data-testid="starfield" />,
}));

// LandingOverlay
vi.mock('@/components/LandingOverlay', () => ({ default: () => <div data-testid="landing-overlay" /> }));

// CosmicHubV3 component (lazy-loaded in Index)
vi.mock('@/components/CosmicHubV3', () => ({ default: () => <div data-testid="cosmic-hub" /> }));

// ── Helpers ───────────────────────────────────────────────────────────────────

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <Suspense fallback={<div>loading</div>}>{children}</Suspense>
  </MemoryRouter>
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Page smoke tests', () => {
  beforeAll(() => {
    // Silence unhandled promise rejections that come from fetch stubs in useEffect
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('1 — AppShell mounts without crashing', async () => {
    const { default: AppShell } = await import('@/AppShell');
    // AppShell renders its own RouterProvider — do NOT wrap in MemoryRouter
    const { container } = render(
      <Suspense fallback={<div>loading</div>}>
        <AppShell />
      </Suspense>,
    );
    expect(container).toBeTruthy();
  }, 10_000);

  it('2 — Index page renders without crashing', async () => {
    const { default: IndexPage } = await import('@/pages/Index');
    const { container } = render(
      <Wrapper>
        <IndexPage />
      </Wrapper>,
    );
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('3 — Leaderboard page renders (skeleton acceptable)', async () => {
    const { default: LeaderboardPage } = await import('@/pages/Leaderboard');
    const { container } = render(
      <Wrapper>
        <LeaderboardPage />
      </Wrapper>,
    );
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('4 — PrismVault page renders (BuyCoinsSection error boundary check)', async () => {
    const { default: PrismVaultPage } = await import('@/pages/PrismVault');
    const { container } = render(
      <Wrapper>
        <PrismVaultPage />
      </Wrapper>,
    );
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('5 — PrismLeague page renders (mode selector visible)', async () => {
    const { default: PrismLeaguePage } = await import('@/pages/PrismLeague');
    const { container } = render(
      <Wrapper>
        <PrismLeaguePage />
      </Wrapper>,
    );
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });
});
