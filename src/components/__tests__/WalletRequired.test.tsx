/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

let mockPublicKey: { toBase58(): string } | null = null;
let mockSignMessage: ((msg: Uint8Array) => Promise<Uint8Array>) | undefined;

vi.mock('@solana/wallet-adapter-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useWallet: () => ({
      publicKey: mockPublicKey,
      signMessage: mockSignMessage,
    }),
  };
});

vi.mock('@solana/wallet-adapter-react-ui', () => ({
  WalletMultiButton: () => <button data-testid="wallet-multi-button">Connect Wallet</button>,
}));

import WalletRequired from '../WalletRequired';

const TEST_ADDRESS = '11111111111111111111111111111111';

function renderGuard() {
  return render(
    <MemoryRouter>
      <WalletRequired>
        <div>Guarded content</div>
      </WalletRequired>
    </MemoryRouter>,
  );
}

describe('WalletRequired', () => {
  beforeEach(() => {
    mockPublicKey = null;
    mockSignMessage = undefined;
    sessionStorage.clear();
    localStorage.clear();
  });

  it('keeps guarded content visible when the live wallet key drops but a stored JWT still resolves the address', () => {
    sessionStorage.setItem(
      'ip_auth_jwt',
      JSON.stringify({
        token: 'test-token',
        address: TEST_ADDRESS,
        expiresAt: Date.now() + 60 * 60 * 1000,
      }),
    );

    renderGuard();

    expect(screen.getByText('Guarded content')).toBeInTheDocument();
    expect(screen.queryByText('Connect Your Wallet')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('ip_auth_jwt')).toContain(TEST_ADDRESS);
  });

  it('accepts a persisted localStorage JWT when the native WebView session is restored', () => {
    localStorage.setItem(
      'ip_auth_jwt',
      JSON.stringify({
        token: 'legacy-token',
        address: TEST_ADDRESS,
        expiresAt: Date.now() + 60 * 60 * 1000,
      }),
    );

    renderGuard();

    expect(screen.getByText('Guarded content')).toBeInTheDocument();
    expect(screen.queryByText('Connect Your Wallet')).not.toBeInTheDocument();
  });

  it('requires a wallet signature when a live wallet has no cached JWT', () => {
    mockPublicKey = { toBase58: () => TEST_ADDRESS };
    mockSignMessage = vi.fn(async (msg: Uint8Array) => msg);

    renderGuard();

    expect(screen.getByText('Sign wallet to continue')).toBeInTheDocument();
    expect(screen.queryByText('Guarded content')).not.toBeInTheDocument();
  });

  it('shows the wallet gate when neither a live key nor a stored address exists', () => {
    renderGuard();

    expect(screen.getByText('Connect Your Wallet')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-multi-button')).toBeInTheDocument();
  });
});
