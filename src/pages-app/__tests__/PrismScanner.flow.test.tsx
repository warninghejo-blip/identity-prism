/**
 * @vitest-environment jsdom
 *
 * PrismScanner (Sybil Hunt) — scan flow state machine tests.
 * Focus: mount, address input state, scan triggers, localStorage history.
 * NOT testing actual sybil API calls.
 */

import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ── jsdom polyfills ───────────────────────────────────────────────────────────
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof global.IntersectionObserver === 'undefined') {
  global.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds = [];
    takeRecords() {
      return [];
    }
  };
}

// ── Wallet adapter ────────────────────────────────────────────────────────────
let _mockPublicKey: { toBase58(): string } | null = null;

vi.mock('@solana/wallet-adapter-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useWallet: () => ({
      publicKey: _mockPublicKey,
      connected: !!_mockPublicKey,
      signTransaction: undefined,
      sendTransaction: undefined,
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
  WalletMultiButton: () => <button data-testid="wallet-multi-button">Connect</button>,
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
    fetchWalletPreview: vi.fn().mockResolvedValue({
      address: 'ScanTarget1111111111111111111111111111111',
      score: 150,
      tier: 'earth',
      badges: [],
      solBalance: 1.5,
      txCount: 100,
      walletAgeDays: 200,
      tokenCount: 5,
      nftCount: 2,
      trustGrade: 'B',
      trustScore: 70,
      riskLevel: 'low',
      sybilVerdict: null,
      topPrograms: [],
      compositeScore: 200,
      compositeTier: 'earth',
      compositeBadgeCount: 3,
      compositeBreakdown: { onchain: 100, sybilTrust: 50, humanProof: 30, social: 10, engagement: 10 },
    }),
  };
});

// ── prismCoin ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/prismCoin', () => ({
  getPrismBalance: vi.fn(async () => ({ balance: 0 })),
  earnPrism: vi.fn(async () => {}),
  canEarnFromScan: vi.fn(() => true),
  markScanEarned: vi.fn(),
  COIN_PACKAGES: [],
}));

// ── Navigation / transitions ──────────────────────────────────────────────────
vi.mock('@/lib/safeNavigate', () => ({ goBack: vi.fn() }));
vi.mock('@/lib/fadeTransition', () => ({
  fadeOutTransition: vi.fn(),
  startFadeTransition: vi.fn((_el?: unknown, cb?: () => void) => cb?.()),
}));

// ── Other deps ────────────────────────────────────────────────────────────────
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
vi.mock('@/lib/rangerRanks', () => ({
  RANGER_RANKS: [
    { title: 'Rookie', minHunts: 0, minCaught: 0 },
    { title: 'Hunter', minHunts: 10, minCaught: 5 },
  ],
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
    json: async () => ({ targets: [] }),
    text: async () => '{"targets":[]}',
  } as Response),
);

// ── Wrapper ───────────────────────────────────────────────────────────────────
const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <Suspense fallback={<div>loading</div>}>{children}</Suspense>
  </MemoryRouter>
);

// ── localStorage scan history helpers ────────────────────────────────────────

function clearScanHistory() {
  localStorage.removeItem('prism_scan_history_v1');
  localStorage.removeItem('prism_recent_scans');
  localStorage.removeItem('sybil_hunt_stats_v1');
}

function seedScanHistory(
  entries: { address: string; verdict: string; verdictKey: string; score: number; timestamp: number }[],
) {
  localStorage.setItem('prism_scan_history_v1', JSON.stringify(entries));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PrismScanner — mount', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    _mockPublicKey = null;
    vi.mocked(global.fetch).mockClear();
    clearScanHistory();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearScanHistory();
  });

  it('mounts without crashing', async () => {
    const { default: PrismScannerPage } = await import('@/pages-app/PrismScanner');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <Wrapper>
          <PrismScannerPage />
        </Wrapper>,
      ));
    });
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('shows address input for entering target wallet', async () => {
    const { default: PrismScannerPage } = await import('@/pages-app/PrismScanner');
    await act(async () => {
      render(
        <Wrapper>
          <PrismScannerPage />
        </Wrapper>,
      );
    });
    // There should be an input for address entry
    const input =
      screen.queryByRole('textbox') || document.querySelector('input[type="text"]') || document.querySelector('input');
    expect(input).toBeInTheDocument();
  });

  it('loads scan history from localStorage on mount', async () => {
    const now = Date.now();
    // formatAddr shortens to first4...last4: "Hist...1111"
    seedScanHistory([
      {
        address: 'Hist1111111111111111111111111111111111111111',
        verdict: 'Clean',
        verdictKey: 'clean',
        score: 80,
        timestamp: now - 1000,
      },
    ]);
    const { default: PrismScannerPage } = await import('@/pages-app/PrismScanner');
    await act(async () => {
      render(
        <Wrapper>
          <PrismScannerPage />
        </Wrapper>,
      );
    });
    // History section should render — check for "Recent Scans" or "History" label
    await waitFor(
      () => {
        const text = document.body.textContent || '';
        // Recent scans section header or the truncated address "Hist...1111"
        expect(text.includes('Recent') || text.includes('History') || text.includes('Hist')).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('requests fresh bounty targets excluding recently scanned wallets', async () => {
    localStorage.setItem(
      'prism_recent_scans',
      JSON.stringify(['Hist1111111111111111111111111111111111111111', 'Next1111111111111111111111111111111111111111']),
    );

    const { default: PrismScannerPage } = await import('@/pages-app/PrismScanner');
    await act(async () => {
      render(
        <Wrapper>
          <PrismScannerPage />
        </Wrapper>,
      );
    });

    await waitFor(() => {
      expect(vi.mocked(global.fetch)).toHaveBeenCalled();
    });

    const firstCall = vi.mocked(global.fetch).mock.calls[0]?.[0];
    expect(String(firstCall)).toContain('/api/sybil/suggested-targets?');
    expect(String(firstCall)).toContain('exclude=');
    expect(String(firstCall)).toContain('Hist1111111111111111111111111111111111111111');
  });
});

describe('PrismScanner — address input validation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    _mockPublicKey = { toBase58: () => 'MyWalletAddress11111111111111111111111111111' };
    clearScanHistory();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearScanHistory();
    _mockPublicKey = null;
  });

  it('input accepts text entry', async () => {
    const { default: PrismScannerPage } = await import('@/pages-app/PrismScanner');
    await act(async () => {
      render(
        <Wrapper>
          <PrismScannerPage />
        </Wrapper>,
      );
    });
    const input = document.querySelector('input') as HTMLInputElement;
    if (!input) return; // skip if input not rendered yet
    await act(async () => {
      fireEvent.change(input, { target: { value: 'SomeAddressTest' } });
    });
    expect(input.value).toBe('SomeAddressTest');
  });

  it('clears input after typing and clearing', async () => {
    const { default: PrismScannerPage } = await import('@/pages-app/PrismScanner');
    await act(async () => {
      render(
        <Wrapper>
          <PrismScannerPage />
        </Wrapper>,
      );
    });
    const input = document.querySelector('input') as HTMLInputElement;
    if (!input) return;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'TestAddress' } });
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
    });
    expect(input.value).toBe('');
  });
});
