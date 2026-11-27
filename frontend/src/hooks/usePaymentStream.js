import { useState, useEffect, useRef, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
export const DEFAULT_POLL_INTERVAL = 15000;
export const INITIAL_RECONNECT_DELAY = 1000;
export const MAX_RECONNECT_DELAY = 30000;

/**
 * usePaymentStream
 *
 * Real-time SSE stream hook for payment status updates (pending → submitted → confirmed).
 *
 * Features:
 *   - Subscribes to SSE on mount and unsubscribes on unmount.
 *   - Updates payment rows without requiring a full page refresh.
 *   - Fires a toast notification when a payment transitions to confirmed.
 *   - Handles connection drops with exponential backoff (1s -> 2s -> 4s -> ... -> 30s).
 *   - Falls back to 15s polling when EventSource is unavailable.
 *
 * @param {object} options
 * @param {string} [options.schoolId]
 * @param {Function} [options.onPaymentUpdate] - Called with (payment) on status transitions
 * @param {Function} [options.onConfirmed] - Called with (payment) when moving to confirmed
 * @param {boolean} [options.enabled=true]
 * @param {number} [options.pollInterval=15000]
 * @returns {{
 *   connectionStatus: 'connected' | 'reconnecting' | 'disconnected' | 'polling',
 *   isPolling: boolean,
 *   toast: { message: string, txHash: string, visible: boolean } | null,
 *   dismissToast: () => void,
 *   lastUpdatedPayment: object | null
 * }}
 */
export function usePaymentStream({
  schoolId,
  onPaymentUpdate,
  onConfirmed,
  enabled = true,
  pollInterval = DEFAULT_POLL_INTERVAL,
} = {}) {
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isPolling, setIsPolling] = useState(false);
  const [toast, setToast] = useState(null);
  const [lastUpdatedPayment, setLastUpdatedPayment] = useState(null);

  const esRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const pollIntervalRef = useRef(null);
  const onPaymentUpdateRef = useRef(onPaymentUpdate);
  const onConfirmedRef = useRef(onConfirmed);

  useEffect(() => {
    onPaymentUpdateRef.current = onPaymentUpdate;
  }, [onPaymentUpdate]);

  useEffect(() => {
    onConfirmedRef.current = onConfirmed;
  }, [onConfirmed]);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  const handlePaymentEvent = useCallback((payment) => {
    if (!payment) return;
    setLastUpdatedPayment(payment);
    onPaymentUpdateRef.current?.(payment);

    const status = String(payment.status || '').toLowerCase();
    if (status === 'confirmed' || status === 'success') {
      const txSnippet = payment.txHash ? `${payment.txHash.slice(0, 8)}…` : '';
      const amount = payment.amount ? `${payment.amount} ${payment.assetCode || 'XLM'}` : '';
      setToast({
        message: `Payment ${txSnippet} confirmed on blockchain! ${amount}`.trim(),
        txHash: payment.txHash,
        visible: true,
      });
      onConfirmedRef.current?.(payment);
    }
  }, []);

  const pollFallback = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const resolvedSchoolId = schoolId || (typeof localStorage !== 'undefined' ? localStorage.getItem('schoolId') : null);
    if (!resolvedSchoolId) return;

    try {
      const res = await fetch(`${API_URL}/payments/pending?schoolId=${encodeURIComponent(resolvedSchoolId)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.payments || [];
        list.forEach((p) => {
          if (p.status) handlePaymentEvent(p);
        });
      }
    } catch {
      /* non-fatal polling error */
    }
  }, [schoolId, handlePaymentEvent]);

  const connect = useCallback(() => {
    if (typeof window === 'undefined' || !enabled) return;

    const resolvedSchoolId = schoolId || (typeof localStorage !== 'undefined' ? localStorage.getItem('schoolId') : null);
    if (!resolvedSchoolId) return;

    const EventSourceCtor = typeof window !== 'undefined' ? window.EventSource : undefined;

    if (!EventSourceCtor) {
      // Fallback to polling every 15 seconds
      setIsPolling(true);
      setConnectionStatus('polling');
      pollFallback();
      pollIntervalRef.current = setInterval(pollFallback, pollInterval);
      return;
    }

    try {
      const url = `${API_URL}/payments/stream?schoolId=${encodeURIComponent(resolvedSchoolId)}`;
      const es = new EventSourceCtor(url, { withCredentials: true });
      esRef.current = es;

      es.onopen = () => {
        setConnectionStatus('connected');
        setIsPolling(false);
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      };

      const onMessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          handlePaymentEvent(data);
        } catch {
          /* ignore malformed payload */
        }
      };

      es.addEventListener('payment', onMessage);
      es.addEventListener('payment.confirmed', onMessage);
      es.addEventListener('payment.updated', onMessage);
      es.onmessage = onMessage;

      es.onerror = () => {
        setConnectionStatus('reconnecting');
        if (esRef.current) {
          esRef.current.close();
          esRef.current = null;
        }

        const nextDelay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(nextDelay * 2, MAX_RECONNECT_DELAY);
        reconnectTimeoutRef.current = setTimeout(connect, nextDelay);
      };
    } catch {
      setIsPolling(true);
      setConnectionStatus('polling');
      pollIntervalRef.current = setInterval(pollFallback, pollInterval);
    }
  }, [enabled, schoolId, pollInterval, pollFallback, handlePaymentEvent]);

  useEffect(() => {
    if (!enabled) {
      setConnectionStatus('disconnected');
      return;
    }

    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [enabled, connect]);

  return {
    connectionStatus,
    isPolling,
    toast,
    dismissToast,
    lastUpdatedPayment,
  };
}

export default usePaymentStream;
