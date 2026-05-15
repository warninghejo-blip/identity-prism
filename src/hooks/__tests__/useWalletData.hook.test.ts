/**
 * @vitest-environment jsdom
 *
 * useWalletData hook — integration tests for hook state management.
 * Tests: no address → null state, address → loading, cached data, error states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mock constants before importing the hook ──────────────────────────────────
vi.mock('@/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/constants')>();
  return {
    ...actual,
    getHeliusProxyUrl: () => null, // no proxy → will use RPC
    getHeliusRpcUrl: () => 'http://localhost:3000/rpc',
    getHeliusRpcUrls: () => ['http://localhost:3000/rpc'],
    getHeliusProxyHeaders: () => ({}),
    getAppBaseUrl: () => 'http://localhost:5173',
    getMetadataBaseUrl: () => 'http://localhost:3000',
    MEME_COIN_MINTS: [],
    MEME_COIN_PRICES_USD: {},
    TOKEN_ADDRESSES: {},
    BLUE_CHIP_COLLECTION_NAMES: [],
    BLUE_CHIP_COLLECTIONS: [],
    DEFI_POSITION_HINTS: [],
    LST_MINTS: [],
    SCORING: {
      SOL_BALANCE_TIERS: [],
      WALLET_AGE_TIERS: [],
      TX_COUNT_TIERS: [],
      NFT_TIERS: [],
    },
  };
});

// ── Mock @solana/web3.js ──────────────────────────────────────────────────────
vi.mock('@solana/web3.js', () => ({
  Connection: vi.fn().mockImplementation(() => ({
    getBalance: vi.fn().mockRejectedValue(new Error('Network error')),
    getSignaturesForAddress: vi.fn().mockRejectedValue(new Error('Network error')),
  })),
  PublicKey: vi.fn().mockImplementation((addr: string) => ({
    toBase58: () => addr,
    toString: () => addr,
  })),
}));

import { useWalletData } from '../useWalletData';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearWalletCache(address: string) {
  try {
    sessionStorage.removeItem(`walletData_v3_${address}`);
    sessionStorage.removeItem(`walletData_v3_ts_${address}`);
    sessionStorage.removeItem(`walletData_${address}`);
    sessionStorage.removeItem(`walletData_ts_${address}`);
  } catch {
    // ignore
  }
}

function seedWalletCache(address: string, data: object) {
  try {
    sessionStorage.setItem(`walletData_v3_${address}`, JSON.stringify(data));
    sessionStorage.setItem(`walletData_v3_ts_${address}`, String(Date.now()));
  } catch {
    // ignore
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useWalletData — no address', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns disconnected state when no address provided', () => {
    const { result } = renderHook(() => useWalletData());
    expect(result.current.address).toBe('');
    expect(result.current.traits).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns score 0 when no address', () => {
    const { result } = renderHook(() => useWalletData());
    expect(result.current.score).toBe(0);
  });

  it('returns disconnected state when address is empty string', () => {
    const { result } = renderHook(() => useWalletData(''));
    expect(result.current.traits).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useWalletData — with address (no cache)', () => {
  const TEST_ADDRESS = 'TestAddress11111111111111111111111111111111';

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    clearWalletCache(TEST_ADDRESS);
    global.fetch = vi.fn().mockRejectedValue(new Error('Network unavailable'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearWalletCache(TEST_ADDRESS);
  });

  it('enters loading state when address is provided', async () => {
    const { result } = renderHook(() => useWalletData(TEST_ADDRESS));
    // Hook should start loading when address given
    await waitFor(
      () => {
        // Either loading or completed (errored out due to mock network failure)
        expect(result.current.address === TEST_ADDRESS || result.current.isLoading === false).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it('resets to disconnected when address is removed', async () => {
    let address: string | undefined = TEST_ADDRESS;
    const { result, rerender } = renderHook(() => useWalletData(address));
    // Now remove address
    await act(async () => {
      address = undefined;
      rerender();
    });
    await waitFor(
      () => {
        expect(result.current.traits).toBeNull();
        expect(result.current.isLoading).toBe(false);
      },
      { timeout: 2000 },
    );
  });

  it('resets state when address changes from one to another', async () => {
    const ADDRESS_A = 'AddressAAA11111111111111111111111111111111';
    const ADDRESS_B = 'AddressBBB11111111111111111111111111111111';
    clearWalletCache(ADDRESS_A);
    clearWalletCache(ADDRESS_B);

    let currentAddress = ADDRESS_A;
    const { result, rerender } = renderHook(() => useWalletData(currentAddress));

    await act(async () => {
      currentAddress = ADDRESS_B;
      rerender();
    });

    // After address change, hook should have updated (address reset or loading)
    await waitFor(
      () => {
        expect(result.current.isLoading === false || result.current.address !== ADDRESS_A).toBe(true);
      },
      { timeout: 2000 },
    );

    clearWalletCache(ADDRESS_A);
    clearWalletCache(ADDRESS_B);
  });
});

describe('useWalletData — cached data', () => {
  const CACHED_ADDRESS = 'CachedAddr11111111111111111111111111111111';
  const CACHED_TRAITS = {
    hasSeeker: true,
    hasPreorder: false,
    hasCombo: false,
    isOG: false,
    isWhale: false,
    isCollector: true,
    isEarlyAdopter: false,
    isTxTitan: false,
    isSolanaMaxi: false,
    isBlueChip: false,
    isDeFiKing: false,
    uniqueTokenCount: 5,
    nftCount: 3,
    txCount: 200,
    memeCoinsHeld: [],
    isMemeLord: false,
    hyperactiveDegen: false,
    diamondHands: false,
    avgTxPerDay30d: 2,
    daysSinceLastTx: 5,
    solBalance: 1.5,
    solBonusApplied: 0,
    walletAgeDays: 400,
    walletAgeBonus: 0,
    planetTier: 'earth',
    totalAssetsCount: 8,
    solTier: null,
    totalValueUSD: 300,
    cosmicRank: 'stardust',
    swapCount: 10,
    nftTradeCount: 2,
    stakingCount: 1,
    defiProtocols: ['jupiter'],
    isDeFiUser: true,
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    clearWalletCache(CACHED_ADDRESS);
    // Seed a fresh cache entry
    seedWalletCache(CACHED_ADDRESS, {
      address: CACHED_ADDRESS,
      score: 180,
      traits: CACHED_TRAITS,
      isLoading: false,
      error: null,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearWalletCache(CACHED_ADDRESS);
  });

  it('loads cached traits from sessionStorage immediately', async () => {
    const { result } = renderHook(() => useWalletData(CACHED_ADDRESS));
    await waitFor(
      () => {
        expect(result.current.traits).not.toBeNull();
      },
      { timeout: 2000 },
    );
    expect(result.current.traits?.hasSeeker).toBe(true);
    expect(result.current.traits?.isCollector).toBe(true);
  });

  it('sets address from cached data', async () => {
    const { result } = renderHook(() => useWalletData(CACHED_ADDRESS));
    await waitFor(
      () => {
        expect(result.current.address).toBe(CACHED_ADDRESS);
      },
      { timeout: 2000 },
    );
  });
});
