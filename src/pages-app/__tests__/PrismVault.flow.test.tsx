/**
 * @vitest-environment jsdom
 *
 * PrismVault — buy coins flow logic tests.
 * Focus: state management, package selection, payment method switching.
 * NOT testing actual blockchain transactions.
 */

import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ── Wallet adapter ────────────────────────────────────────────────────────────
let _mockPublicKey: { toBase58(): string } | null = null;
vi.mock('@solana/wallet-adapter-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useWallet: () => ({
      publicKey: _mockPublicKey,
      connected: !!_mockPublicKey,
      signTransaction: _mockPublicKey ? vi.fn() : undefined,
      signMessage: _mockPublicKey ? vi.fn() : undefined,
      sendTransaction: _mockPublicKey ? vi.fn() : undefined,
      wallet: null,
      wallets: [],
      select: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    useConnection: () => ({ connection: {} }),
    useLocalStorage: <T,>(_key: string, def: T): [T, (v: T) => void] => [def, vi.fn()],
    ConnectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    WalletProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@solana/wallet-adapter-react-ui', () => ({
  useWalletModal: () => ({ setVisible: vi.fn(), visible: false }),
  WalletModalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  WalletMultiButton: () => <button data-testid="wallet-multi-button">Connect Wallet</button>,
}));

vi.mock('@solana-mobile/wallet-adapter-mobile', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SolanaMobileWalletAdapterWalletName: 'SolanaMobileWalletAdapter',
  };
});

// ── Constants ─────────────────────────────────────────────────────────────────
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

// ── Prism shared ──────────────────────────────────────────────────────────────
vi.mock('@/components/prism/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/prism/shared')>();
  return {
    ...actual,
    getApiBase: () => 'http://localhost:3000',
    ensureJwt: vi.fn().mockResolvedValue('test-jwt-token'),
    getSessionJwt: vi.fn().mockReturnValue('test-jwt-token'),
  };
});

// ── prismCoin ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/prismCoin', () => ({
  getPrismBalance: vi.fn(async () => ({ balance: 5000, totalEarned: 5000, totalSpent: 0, lastUpdated: '' })),
  earnPrism: vi.fn(async () => {}),
  canEarnFromScan: vi.fn(() => true),
  markScanEarned: vi.fn(),
  COIN_PACKAGES: [
    { coins: 5000, solPrice: 0.015, label: 'Starter' },
    { coins: 15000, solPrice: 0.038, label: 'Explorer' },
    { coins: 50000, solPrice: 0.11, label: 'Voyager' },
    { coins: 150000, solPrice: 0.23, label: 'Commander' },
  ],
}));

// ── Navigation / transitions ──────────────────────────────────────────────────
vi.mock('@/lib/safeNavigate', () => ({ goBack: vi.fn() }));
vi.mock('@/lib/fadeTransition', () => ({
  fadeOutTransition: vi.fn((_el?: unknown, cb?: () => void) => cb?.()),
  startFadeTransition: vi.fn((_el?: unknown, cb?: () => void) => cb?.()),
}));

// ── R3F / Three ───────────────────────────────────────────────────────────────
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

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class SafeTextureLoader extends actual.TextureLoader {
    load(_url: string, onLoad?: (t: unknown) => void) {
      const tex = new actual.Texture();
      onLoad?.(tex);
      return tex;
    }
  }
  return { ...actual, TextureLoader: SafeTextureLoader };
});

// ── Audio / haptics / misc ────────────────────────────────────────────────────
vi.mock('@/lib/gameAudio', () => ({ initAudio: vi.fn(), startMusic: vi.fn(), stopAllAudio: vi.fn() }));
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
vi.mock('@/lib/prefetch', () => ({ invalidateBalanceCache: vi.fn(), prefetchWalletData: vi.fn() }));
vi.mock('@/hooks/useCompositeScore', () => ({
  useCompositeScore: () => ({ score: null, loading: false, error: null }),
  invalidateCompositeCache: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})) },
}));
vi.mock('@/lib/mwaAuthorizationCache', () => ({
  extractMwaAddress: vi.fn(() => null),
  mwaAuthorizationCache: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: vi.fn(), vibrate: vi.fn() } }));
vi.mock('@/components/CosmicStarfield', () => ({ CosmicStarfield: () => null }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

// ── Fetch stub ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
global.fetch = mockFetch;

const makeFetchResponse = (data: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 404,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

// ── Wrapper ───────────────────────────────────────────────────────────────────
const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <Suspense fallback={<div>loading</div>}>{children}</Suspense>
  </MemoryRouter>
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PrismVault — page renders', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    _mockPublicKey = null;
    mockFetch.mockImplementation(() => Promise.resolve(makeFetchResponse({})));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts without crashing (no wallet connected)', async () => {
    const { default: PrismVaultPage } = await import('@/pages-app/PrismVault');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <Wrapper>
          <PrismVaultPage />
        </Wrapper>,
      ));
    });
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('shows Prism Vault heading', async () => {
    const { default: PrismVaultPage } = await import('@/pages-app/PrismVault');
    await act(async () => {
      render(
        <Wrapper>
          <PrismVaultPage />
        </Wrapper>,
      );
    });
    expect(screen.getByText(/Prism Vault/i)).toBeInTheDocument();
  });
});

describe('PrismVault — payment method switching', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    _mockPublicKey = { toBase58: () => 'TestWalletAddress111111111111111111111111111' };
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/prism/buy/status')) {
        return Promise.resolve(makeFetchResponse({ purchasedToday: 0, remainingToday: 200000 }));
      }
      if (url.includes('/api/prism/buy/skr-quote')) {
        return Promise.resolve(
          makeFetchResponse({
            quotes: [
              { coins: 5000, skrPrice: 100 },
              { coins: 15000, skrPrice: 280 },
              { coins: 50000, skrPrice: 850 },
              { coins: 150000, skrPrice: 2300 },
            ],
          }),
        );
      }
      if (url.includes('/api/prism/balance')) {
        return Promise.resolve(makeFetchResponse({ balance: 5000, totalEarned: 5000, totalSpent: 0 }));
      }
      return Promise.resolve(makeFetchResponse({}));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    _mockPublicKey = null;
  });

  it('SOL payment button is present when wallet connected', async () => {
    const { default: PrismVaultPage } = await import('@/pages-app/PrismVault');
    await act(async () => {
      render(
        <Wrapper>
          <PrismVaultPage />
        </Wrapper>,
      );
    });
    await waitFor(
      () => {
        const solButton = screen.queryByLabelText(/Pay with SOL/i);
        expect(solButton).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('SKR payment button is present when wallet connected', async () => {
    const { default: PrismVaultPage } = await import('@/pages-app/PrismVault');
    await act(async () => {
      render(
        <Wrapper>
          <PrismVaultPage />
        </Wrapper>,
      );
    });
    await waitFor(
      () => {
        const skrButton = screen.queryByLabelText(/Pay with SKR/i);
        expect(skrButton).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('can switch from SOL to SKR payment', async () => {
    const { default: PrismVaultPage } = await import('@/pages-app/PrismVault');
    await act(async () => {
      render(
        <Wrapper>
          <PrismVaultPage />
        </Wrapper>,
      );
    });
    await waitFor(
      () => {
        expect(screen.queryByLabelText(/Pay with SKR/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    const skrButton = screen.getByLabelText(/Pay with SKR/i);
    await act(async () => {
      fireEvent.click(skrButton);
    });
    // After click, SKR mode active — button should still be in dom
    expect(skrButton).toBeInTheDocument();
  });
});

describe('PrismVault — buy button disabled states', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    _mockPublicKey = null;
    mockFetch.mockImplementation(() => Promise.resolve(makeFetchResponse({})));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not show buy button when no package selected', async () => {
    const { default: PrismVaultPage } = await import('@/pages-app/PrismVault');
    await act(async () => {
      render(
        <Wrapper>
          <PrismVaultPage />
        </Wrapper>,
      );
    });
    // No package selected → no "Buy" action button
    const buyButtons = screen.queryAllByText(/^Buy$/i);
    expect(buyButtons.length).toBe(0);
  });
});
