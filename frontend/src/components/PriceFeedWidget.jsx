import { useState, useEffect, useRef, useCallback } from 'react';
import { getConversionRates } from '../services/api';

const REFRESH_MS    = 60_000; // 60 s auto-refresh
const STALE_MS      = 2 * 60_000; // amber warning after 2 min without data

// ─── Sparkline ──────────────────────────────────────────────────────────────
/**
 * Lightweight inline SVG sparkline — zero external dependencies, < 1 kB.
 */
function Sparkline({ data, width = 200, height = 40, color = 'var(--accent, #10b981)' }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', width: '100%', height: `${height}px` }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── PriceTicker (compact nav bar widget) ───────────────────────────────────
/**
 * Displays "1 XLM = $0.1234 USD" in the top nav.
 * Auto-refreshes every 60 s. Shows an amber warning icon when data is > 2 min old.
 */
export function PriceTicker() {
  const [rate, setRate]           = useState(null);
  const [stale, setStale]         = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const timerRef  = useRef(null);
  const staleRef  = useRef(null);

  const fetchRate = useCallback(() => {
    getConversionRates()
      .then(({ data }) => {
        const r = data?.rates?.USD ?? data?.USD ?? null;
        if (r != null) {
          setRate(r);
          setLastFetch(Date.now());
          setStale(false);
        }
      })
      .catch(() => {
        // Keep the last known rate; staleness check runs on its own interval.
      });
  }, []);

  useEffect(() => {
    fetchRate();
    timerRef.current = setInterval(fetchRate, REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchRate]);

  useEffect(() => {
    staleRef.current = setInterval(() => {
      setStale((prev) => {
        if (lastFetch && Date.now() - lastFetch > STALE_MS) return true;
        return prev;
      });
    }, 10_000);
    return () => clearInterval(staleRef.current);
  }, [lastFetch]);

  if (rate == null) return null;

  return (
    <span
      aria-label={`XLM price: 1 XLM = $${rate.toFixed(4)} USD${stale ? ' (stale)' : ''}`}
      title={
        stale
          ? 'Rate data is stale — last refresh was more than 2 minutes ago'
          : `Last refreshed: ${lastFetch ? new Date(lastFetch).toLocaleTimeString() : 'N/A'}`
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        fontSize: '0.78rem',
        fontFamily: 'monospace',
        fontWeight: 600,
        color: stale ? '#f59e0b' : 'rgba(255,255,255,0.8)',
        background: 'rgba(255,255,255,0.06)',
        border: `1px solid ${stale ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: '6px',
        padding: '0.3rem 0.6rem',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        cursor: 'default',
        transition: 'color 0.2s, border-color 0.2s',
      }}
    >
      {stale && (
        <span aria-hidden="true" style={{ fontSize: '0.9rem' }}>⚠</span>
      )}
      1 XLM = ${rate.toFixed(4)} USD
    </span>
  );
}

// ─── PriceFeedCard (dashboard widget) ───────────────────────────────────────
/**
 * Dashboard card showing the current XLM/USD rate, 24 h change, and a
 * sparkline of recent data points. Clicking opens a 7-day chart modal.
 * Data auto-refreshes every 60 s. Stale data (> 2 min) triggers an amber icon.
 */
export function PriceFeedCard() {
  const [rate, setRate]           = useState(null);
  const [history, setHistory]     = useState([]);
  const [change24h, setChange24h] = useState(null);
  const [stale, setStale]         = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const timerRef = useRef(null);

  const fetchRate = useCallback(() => {
    getConversionRates()
      .then(({ data }) => {
        const r = data?.rates?.USD ?? data?.USD ?? null;
        if (r != null) {
          setRate(r);
          setLastFetch(Date.now());
          setStale(false);
          setHistory((prev) => [...prev, r].slice(-168)); // keep up to 168 points (7 d × 24 h)
          if (data?.change24h != null) setChange24h(data.change24h);
        }
      })
      .catch(() => {/* stale check handles the warning */});
  }, []);

  useEffect(() => {
    fetchRate();
    timerRef.current = setInterval(fetchRate, REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchRate]);

  useEffect(() => {
    const id = setInterval(() => {
      setStale((prev) => {
        if (lastFetch && Date.now() - lastFetch > STALE_MS) return true;
        return prev;
      });
    }, 10_000);
    return () => clearInterval(id);
  }, [lastFetch]);

  const up = change24h != null && change24h >= 0;

  return (
    <>
      <style>{`
        .pfc-wrap {
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 1rem 1.25rem;
          cursor: pointer;
          transition: box-shadow 0.15s;
        }
        .pfc-wrap:hover { box-shadow: 0 4px 18px -4px rgba(0,0,0,0.18); }
        .pfc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
        .pfc-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
        .pfc-stale-badge { font-size: 0.75rem; color: #f59e0b; display: flex; align-items: center; gap: 0.2rem; }
        .pfc-rate { font-size: 1.5rem; font-weight: 800; font-family: monospace; color: var(--text); line-height: 1.1; }
        .pfc-change { font-size: 0.8rem; font-weight: 600; margin-top: 0.2rem; }
        .pfc-sparkline-wrap { margin-top: 0.75rem; line-height: 0; }

        .pfc-modal-overlay {
          position: fixed; inset: 0; z-index: 500;
          background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
        }
        .pfc-modal {
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 1.5rem;
          width: min(480px, 92vw);
          position: relative;
        }
        .pfc-modal-title { font-size: 1rem; font-weight: 700; margin-bottom: 1rem; color: var(--text); }
        .pfc-modal-close {
          position: absolute; top: 0.75rem; right: 0.875rem;
          background: none; border: none; cursor: pointer;
          color: var(--text-muted); font-size: 1.1rem; line-height: 1;
        }
        .pfc-modal-close:hover { color: var(--text); }
        .pfc-chart-area {
          width: 100%; border-radius: 8px; overflow: hidden;
          background: var(--bg-subtle, var(--border));
          padding: 0.5rem;
        }
        .pfc-modal-footer { margin-top: 0.875rem; font-size: 0.75rem; color: var(--text-muted); }
      `}</style>

      <div
        className="pfc-wrap"
        role="button"
        tabIndex={0}
        aria-label="Open XLM/USD 7-day price chart"
        onClick={() => setShowModal(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowModal(true); } }}
      >
        <div className="pfc-header">
          <span className="pfc-label">XLM / USD</span>
          {stale && <span className="pfc-stale-badge">⚠ Stale</span>}
        </div>

        <div className="pfc-rate">
          {rate != null ? `$${rate.toFixed(4)}` : '—'}
        </div>

        {change24h != null && (
          <div className="pfc-change" style={{ color: up ? '#10b981' : '#ef4444' }}>
            {up ? '▲' : '▼'} {Math.abs(change24h).toFixed(2)}% 24 h
          </div>
        )}

        {history.length > 1 && (
          <div className="pfc-sparkline-wrap" aria-hidden="true">
            <Sparkline data={history} height={40} />
          </div>
        )}
      </div>

      {showModal && (
        <div
          className="pfc-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="XLM/USD 7-day price chart"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="pfc-modal">
            <button
              className="pfc-modal-close"
              onClick={() => setShowModal(false)}
              aria-label="Close chart modal"
            >
              ✕
            </button>
            <div className="pfc-modal-title">XLM / USD — 7-day history</div>

            <div className="pfc-chart-area">
              {history.length > 1 ? (
                <Sparkline data={history} height={130} />
              ) : (
                <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  Collecting data…
                </div>
              )}
            </div>

            <div className="pfc-modal-footer">
              Rate refreshes every 60 s · Source: /api/fx/rates
              {stale && ' · ⚠ Data may be stale (more than 2 min old)'}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default PriceFeedCard;
