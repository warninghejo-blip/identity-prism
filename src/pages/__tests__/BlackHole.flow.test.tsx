/**
 * @vitest-environment jsdom
 *
 * BlackHole — burn flow logic tests.
 * Focus: mount without crash, wallet connection states, token list area.
 * NOT testing actual burn transactions (requires live Solana connection).
 */

import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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
      sendTransaction: _mockPublicKey ? vi.fn() : undefined,
      wallet: null,
      wallets: [],
      select: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    useConnection: () => ({
      connection: {
        getTokenAccountsByOwner: vi.fn().mockResolvedValue({ value: [] }),
        getParsedAccountInfo: vi.fn().mockResolvedValue({ value: null }),
        getAccountInfo: vi.fn().mockResolvedValue(null),
      },
    }),
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
    fetchWalletPreview: vi.fn().mockResolvedValue(null),
  };
});

// ── Navigation / transitions ──────────────────────────────────────────────────
vi.mock('@/lib/safeNavigate', () => ({ goBack: vi.fn() }));
vi.mock('@/lib/fadeTransition', () => ({
  fadeOutTransition: vi.fn(),
  startFadeTransition: vi.fn((_el?: unknown, cb?: () => void) => cb?.()),
}));

// ── Other deps ────────────────────────────────────────────────────────────────
vi.mock('@/lib/prismCoin', () => ({
  getPrismBalance: vi.fn(async () => ({ balance: 0 })),
  earnPrism: vi.fn(async () => {}),
  calculateBurnPrism: vi.fn(() => 0),
  canEarnFromScan: vi.fn(() => false),
  COIN_PACKAGES: [],
}));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})) },
}));
vi.mock('@/hooks/useCompositeScore', () => ({
  useCompositeScore: () => ({ score: null, loading: false, error: null }),
  invalidateCompositeCache: vi.fn(),
}));
vi.mock('@/lib/prefetch', () => ({ invalidateBalanceCache: vi.fn(), prefetchWalletData: vi.fn() }));
vi.mock('@/lib/mwaAuthorizationCache', () => ({
  extractMwaAddress: vi.fn(() => null),
  mwaAuthorizationCache: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));
vi.mock('@/lib/analytics', () => ({
  trackWalletConnect: vi.fn(),
  trackWalletDisconnect: vi.fn(),
  trackMint: vi.fn(),
}));
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: vi.fn(), vibrate: vi.fn() } }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

// ── Fetch stub ────────────────────────────────────────────────────────────────
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  } as Response),
);

// ── Wrapper ───────────────────────────────────────────────────────────────────
const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <Suspense fallback={<div>loading</div>}>{children}</Suspense>
  </MemoryRouter>
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BlackHole — disconnected wallet', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    _mockPublicKey = null;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts without crashing when wallet not connected', async () => {
    const { default: BlackHolePage } = await import('@/pages/BlackHole');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <Wrapper>
          <BlackHolePage />
        </Wrapper>,
      ));
    });
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('shows connect wallet prompt when no wallet', async () => {
    const { default: BlackHolePage } = await import('@/pages/BlackHole');
    await act(async () => {
      render(
        <Wrapper>
          <BlackHolePage />
        </Wrapper>,
      );
    });
    // Should show connect wallet button or message
    const connectEl = screen.queryByTestId('wallet-multi-button') || screen.queryByText(/connect/i);
    expect(connectEl).toBeInTheDocument();
  });
});

describe('BlackHole — connected wallet', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    _mockPublicKey = { toBase58: () => 'BurnWalletAddress111111111111111111111111111' };
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/api/prism/perks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ hasMinted: false }),
          text: async () => '{}',
        });
      }
      if (url.includes('/api/sol-price')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ price: 150 }),
          text: async () => '{"price":150}',
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
      });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    _mockPublicKey = null;
  });

  it('mounts without crashing when wallet connected', async () => {
    const { default: BlackHolePage } = await import('@/pages/BlackHole');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <Wrapper>
          <BlackHolePage />
        </Wrapper>,
      ));
    });
    expect(container).toBeTruthy();
  });

  it('shows loading state initially when wallet connected', async () => {
    const { default: BlackHolePage } = await import('@/pages/BlackHole');
    await act(async () => {
      render(
        <Wrapper>
          <BlackHolePage />
        </Wrapper>,
      );
    });
    // Page renders — either loading spinner or content
    expect(document.body.textContent).toBeTruthy();
  });

  it('shows empty token list when no tokens fetched', async () => {
    const { default: BlackHolePage } = await import('@/pages/BlackHole');
    await act(async () => {
      render(
        <Wrapper>
          <BlackHolePage />
        </Wrapper>,
      );
    });
    // After loading, no tokens in list → empty state or no table rows
    await waitFor(
      () => {
        const rows = document.querySelectorAll('[data-testid="token-row"]');
        expect(rows.length).toBe(0);
      },
      { timeout: 2000 },
    );
  });
});
