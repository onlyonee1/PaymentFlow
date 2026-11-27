/**
 * @jest-environment jsdom
 */
'use strict';

import { renderHook, act } from '@testing-library/react';
import { usePaymentStream, DEFAULT_POLL_INTERVAL, INITIAL_RECONNECT_DELAY } from '../frontend/src/hooks/usePaymentStream';

describe('usePaymentStream', () => {
  let mockEventSourceInstances = [];
  let originalEventSource;
  let originalFetch;

  class MockEventSource {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.listeners = {};
      this.readyState = 0; // CONNECTING
      mockEventSourceInstances.push(this);
    }

    addEventListener(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
    }

    removeEventListener(event, callback) {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
    }

    simulateOpen() {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }

    simulateMessage(data, event = 'payment') {
      const e = { data: JSON.stringify(data) };
      if (this.listeners[event]) {
        this.listeners[event].forEach((cb) => cb(e));
      }
      if (this.onmessage) {
        this.onmessage(e);
      }
    }

    simulateError() {
      this.readyState = 2; // CLOSED
      if (this.onerror) this.onerror(new Event('error'));
    }

    close() {
      this.readyState = 2; // CLOSED
      this.closed = true;
    }
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockEventSourceInstances = [];
    originalEventSource = window.EventSource;
    window.EventSource = MockEventSource;
    localStorage.setItem('schoolId', 'SCH001');

    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ payments: [{ txHash: 'tx123', status: 'pending' }] }),
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    window.EventSource = originalEventSource;
    global.fetch = originalFetch;
    localStorage.clear();
  });

  it('subscribes to SSE on mount and sets connectionStatus to connected on open', () => {
    const { result } = renderHook(() => usePaymentStream({ schoolId: 'SCH001' }));

    expect(mockEventSourceInstances.length).toBe(1);
    expect(mockEventSourceInstances[0].url).toContain('/payments/stream?schoolId=SCH001');
    expect(mockEventSourceInstances[0].options.withCredentials).toBe(true);

    act(() => {
      mockEventSourceInstances[0].simulateOpen();
    });

    expect(result.current.connectionStatus).toBe('connected');
    expect(result.current.isPolling).toBe(false);
  });

  it('unsubscribes and closes EventSource on unmount', () => {
    const { unmount } = renderHook(() => usePaymentStream({ schoolId: 'SCH001' }));
    const instance = mockEventSourceInstances[0];

    expect(instance.closed).toBeFalsy();
    unmount();
    expect(instance.closed).toBe(true);
  });

  it('updates payment status and calls onPaymentUpdate when payment events arrive', () => {
    const onPaymentUpdate = jest.fn();
    const { result } = renderHook(() => usePaymentStream({ schoolId: 'SCH001', onPaymentUpdate }));

    act(() => {
      mockEventSourceInstances[0].simulateOpen();
    });

    const paymentPending = { txHash: '0xabc123', status: 'pending', amount: '100' };
    act(() => {
      mockEventSourceInstances[0].simulateMessage(paymentPending, 'payment');
    });

    expect(onPaymentUpdate).toHaveBeenCalledWith(paymentPending);
    expect(result.current.lastUpdatedPayment).toEqual(paymentPending);

    const paymentSubmitted = { txHash: '0xabc123', status: 'submitted', amount: '100' };
    act(() => {
      mockEventSourceInstances[0].simulateMessage(paymentSubmitted, 'payment');
    });

    expect(onPaymentUpdate).toHaveBeenCalledWith(paymentSubmitted);
    expect(result.current.lastUpdatedPayment).toEqual(paymentSubmitted);
  });

  it('fires a toast notification and calls onConfirmed when a payment moves to confirmed', () => {
    const onConfirmed = jest.fn();
    const { result } = renderHook(() => usePaymentStream({ schoolId: 'SCH001', onConfirmed }));

    act(() => {
      mockEventSourceInstances[0].simulateOpen();
    });

    const paymentConfirmed = {
      txHash: '0xabc123456789',
      status: 'confirmed',
      amount: '500',
      assetCode: 'USDC',
    };

    act(() => {
      mockEventSourceInstances[0].simulateMessage(paymentConfirmed, 'payment');
    });

    expect(onConfirmed).toHaveBeenCalledWith(paymentConfirmed);
    expect(result.current.toast).toBeDefined();
    expect(result.current.toast.visible).toBe(true);
    expect(result.current.toast.message).toContain('confirmed');
    expect(result.current.toast.txHash).toBe('0xabc123456789');

    // Dismiss toast
    act(() => {
      result.current.dismissToast();
    });
    expect(result.current.toast).toBeNull();
  });

  it('handles connection drops with exponential backoff reconnect', () => {
    const { result } = renderHook(() => usePaymentStream({ schoolId: 'SCH001' }));

    act(() => {
      mockEventSourceInstances[0].simulateOpen();
    });
    expect(result.current.connectionStatus).toBe('connected');

    // Simulate drop
    act(() => {
      mockEventSourceInstances[0].simulateError();
    });

    expect(result.current.connectionStatus).toBe('reconnecting');
    expect(mockEventSourceInstances.length).toBe(1);

    // Fast-forward reconnect delay (1000ms)
    act(() => {
      jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY);
    });

    expect(mockEventSourceInstances.length).toBe(2);

    // Second drop: next delay is 2000ms
    act(() => {
      mockEventSourceInstances[1].simulateError();
    });

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(mockEventSourceInstances.length).toBe(2);

    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(mockEventSourceInstances.length).toBe(3);
  });

  it('falls back to 15s polling when EventSource is unavailable', async () => {
    delete window.EventSource;

    let hookResult;
    await act(async () => {
      hookResult = renderHook(() => usePaymentStream({ schoolId: 'SCH001' }));
    });

    const { result } = hookResult;

    expect(result.current.isPolling).toBe(true);
    expect(result.current.connectionStatus).toBe('polling');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Advance 15 seconds
    await act(async () => {
      jest.advanceTimersByTime(DEFAULT_POLL_INTERVAL);
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
