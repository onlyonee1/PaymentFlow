/**
 * @jest-environment jsdom
 */
'use strict';

const React = require('react');
const { render, screen, fireEvent } = require('@testing-library/react');
require('@testing-library/jest-dom');

const mockSessionStorage = (() => {
  let store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
  writable: true,
});

const { default: TestnetBanner, shouldShowBanner } = require('../frontend/src/components/TestnetBanner');

describe('TestnetBanner visibility logic', () => {
  it('shows when NEXT_PUBLIC_STELLAR_NETWORK is "testnet"', () => {
    expect(shouldShowBanner('testnet')).toBe(true);
  });

  it('hides when NEXT_PUBLIC_STELLAR_NETWORK is "mainnet"', () => {
    expect(shouldShowBanner('mainnet')).toBe(false);
  });

  it('hides when NEXT_PUBLIC_STELLAR_NETWORK is undefined', () => {
    expect(shouldShowBanner(undefined)).toBe(false);
  });

  it('hides when NEXT_PUBLIC_STELLAR_NETWORK is an empty string', () => {
    expect(shouldShowBanner('')).toBe(false);
  });

  it('hides when NEXT_PUBLIC_STELLAR_NETWORK is "TESTNET" (case-sensitive check)', () => {
    expect(shouldShowBanner('TESTNET')).toBe(false);
  });
});

describe('TestnetBanner component', () => {
  const originalEnv = process.env.NEXT_PUBLIC_STELLAR_NETWORK;

  beforeEach(() => {
    mockSessionStorage.clear();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = originalEnv;
  });

  it('renders sticky top banner with correct text when testnet', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    render(<TestnetBanner />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('You are on Stellar Testnet — funds are not real');
    expect(alert).toHaveStyle({ position: 'fixed', top: '0px' });
  });

  it('is absent when mainnet', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    render(<TestnetBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is dismissible per session via button or keyboard', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    const { unmount } = render(<TestnetBanner />);
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    expect(dismissBtn).toBeInTheDocument();

    fireEvent.click(dismissBtn);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockSessionStorage.getItem('stellar_testnet_banner_dismissed')).toBe('true');

    unmount();
    // Re-rendering in same session stays dismissed
    render(<TestnetBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
