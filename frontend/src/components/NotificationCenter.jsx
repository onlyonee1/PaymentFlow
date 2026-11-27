import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useAdminAuthContext } from '../hooks/AdminAuthContext';
import { DISPLAY_MODE, formatTimestamp } from '../utils/dateTime';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

const SEVERITY_META = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', label: 'Critical' },
  warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Warning' },
  info:     { color: '#34d399', bg: 'rgba(52,211,153,0.12)', label: 'Info' },
};

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function NotificationTypeIcon({ type }) {
  if (type === 'payment.confirmed') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }
  if (type === 'payment.failed') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  }
  if (type === 'dispute.created' || type === 'dispute.updated') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    );
  }
  if (type === 'admin.broadcast') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function TimeAgo({ date, timeZone }) {
  const d = new Date(date);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);

  let label;
  if (diff < 60)        label = 'Just now';
  else if (diff < 3600) label = `${Math.floor(diff / 60)}m ago`;
  else if (diff < 86400) label = `${Math.floor(diff / 3600)}h ago`;
  else label = new Intl.DateTimeFormat(undefined, { timeZone, month: 'short', day: 'numeric' }).format(d);

  const formatted = formatTimestamp(d.toISOString(), { mode: DISPLAY_MODE.LOCAL, timeZone });

  return (
    <time
      dateTime={d.toISOString()}
      title={`${formatted.formatted} ${formatted.label}`}
      style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}
    >
      {label}
    </time>
  );
}

/**
 * NotificationCenter
 *
 * Renders a bell icon with unread badge in the navbar. On click it opens a
 * dropdown panel showing paginated notifications with severity indicators,
 * deep-link navigation, and mark-as-read controls.
 *
 * Accessibility:
 *   - The trigger button has aria-label, aria-expanded, and aria-haspopup.
 *   - The panel uses role="dialog" with aria-label.
 *   - Keyboard focus trap is enforced when the dropdown is open.
 *   - Focus returns to the trigger when the panel closes.
 *   - Keyboard: Escape closes the panel.
 */
export default function NotificationCenter() {
  const router = useRouter();
  const { timeZone } = useAdminAuthContext();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const LIMIT = 20;

  // ── Fetch helpers ────────────────────────────────────────────────────────

  const fetchNotifications = useCallback(async (pg = 1, unreadFilter = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(pg),
        limit: String(LIMIT),
        ...(unreadFilter ? { unreadOnly: 'true' } : {}),
      });
      const res = await fetch(`${API_URL}/notifications?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount ?? 0);
      setTotal(data.total ?? 0);
      setPage(pg);
    } catch (err) {
      setError('Could not load notifications. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/notifications/unread-count`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(data.unreadCount ?? 0);
    } catch { /* non-fatal */ }
  }, []);

  // ── Poll unread count every 30 s when panel is closed ────────────────────

  useEffect(() => {
    fetchUnreadCount();
    if (open) return;
    const id = setInterval(fetchUnreadCount, 30_000);
    return () => clearInterval(id);
  }, [open, fetchUnreadCount]);

  // ── Push delivery via SSE ────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const schoolId = localStorage.getItem('schoolId');
    if (!schoolId) return;

    let es;
    try {
      es = new EventSource(`${API_URL}/payments/events?schoolId=${encodeURIComponent(schoolId)}`, {
        withCredentials: true,
      });

      const handlePush = () => {
        fetchUnreadCount();
        if (open) fetchNotifications(1, unreadOnly);
      };

      es.addEventListener('payment', handlePush);
      es.addEventListener('dispute.created', handlePush);
      es.addEventListener('dispute.updated', handlePush);
      es.addEventListener('notification.created', handlePush);
    } catch { /* non-fatal */ }

    return () => {
      if (es) es.close();
    };
  }, [fetchUnreadCount, fetchNotifications, open, unreadOnly]);

  // ── Open / close panel ───────────────────────────────────────────────────

  const openPanel = useCallback(() => {
    setOpen(true);
    fetchNotifications(1, unreadOnly);
  }, [fetchNotifications, unreadOnly]);

  const closePanel = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // ── Focus trap & keyboard accessibility ─────────────────────────────────

  useEffect(() => {
    if (!open) return;

    // Auto-focus first focusable inside panel
    const timer = setTimeout(() => {
      if (panelRef.current) {
        const focusable = panelRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) focusable[0].focus();
      }
    }, 50);

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        closePanel();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const elements = panelRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (elements.length === 0) return;
        const first = elements[0];
        const last = elements[elements.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, closePanel]);

  // Click-outside closes the panel
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        closePanel();
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, closePanel]);

  // ── Mark as read (Optimistic) ─────────────────────────────────────────────

  const markRead = useCallback(async (ids) => {
    // Instant optimistic update
    setNotifications((prev) =>
      prev.map((n) => ids.includes(String(n._id)) ? { ...n, read: true } : n)
    );
    setUnreadCount((c) => Math.max(0, c - ids.length));

    try {
      if (ids.length === 1) {
        await fetch(`${API_URL}/notifications/${ids[0]}/read`, {
          method: 'PATCH',
          credentials: 'include',
        }).catch(() => {});
      }
      await fetch(`${API_URL}/notifications/read`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: ids }),
      });
    } catch { /* non-fatal */ }
  }, []);

  const markAllRead = useCallback(async () => {
    // Instant optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);

    try {
      await fetch(`${API_URL}/notifications/read-all`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch { /* non-fatal */ }
  }, []);

  // ── Navigate via deep-link ───────────────────────────────────────────────

  const handleNotificationClick = useCallback(async (notif) => {
    if (!notif.read) await markRead([String(notif._id)]);
    closePanel();
    if (notif.deepLink) router.push(notif.deepLink);
  }, [markRead, closePanel, router]);

  // ── Filter toggle ────────────────────────────────────────────────────────

  const toggleFilter = () => {
    const next = !unreadOnly;
    setUnreadOnly(next);
    fetchNotifications(1, next);
  };

  const hasMore = page * LIMIT < total;
  const badgeDisplay = unreadCount > 99 ? '99+' : unreadCount;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <style>{`
        .nc-trigger {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px; height: 32px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          color: rgba(255,255,255,0.65);
          cursor: pointer;
          position: relative;
          transition: background 0.12s, border-color 0.12s, color 0.12s;
        }
        .nc-trigger:hover, .nc-trigger[aria-expanded="true"] {
          background: rgba(255,255,255,0.12);
          border-color: rgba(255,255,255,0.22);
          color: #fff;
        }
        .nc-badge {
          position: absolute;
          top: -4px; right: -6px;
          min-width: 18px; height: 18px;
          padding: 0 4px;
          background: #ef4444;
          color: #fff;
          border-radius: 9999px;
          border: 2px solid #0e1424;
          font-size: 0.65rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .nc-panel {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 360px;
          max-height: 480px;
          background: #111827;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          z-index: 9999;
        }
        .nc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.875rem 1rem 0.75rem;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          flex-shrink: 0;
        }
        .nc-title {
          font-size: 0.875rem;
          font-weight: 700;
          color: #f1f5f9;
        }
        .nc-header-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .nc-btn {
          background: none;
          border: none;
          cursor: pointer;
          font: 500 0.75rem/1 inherit;
          padding: 0.25rem 0.5rem;
          border-radius: 5px;
          color: rgba(255,255,255,0.45);
          transition: color 0.12s, background 0.12s;
        }
        .nc-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
        .nc-filter-btn {
          font-size: 0.72rem;
          padding: 0.2rem 0.55rem;
          border-radius: 99px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.5);
          cursor: pointer;
          transition: all 0.12s;
        }
        .nc-filter-btn.active {
          background: rgba(52,211,153,0.15);
          border-color: rgba(52,211,153,0.3);
          color: #34d399;
        }
        .nc-list {
          flex: 1;
          overflow-y: auto;
          padding: 0.375rem;
        }
        .nc-list::-webkit-scrollbar { width: 4px; }
        .nc-list::-webkit-scrollbar-track { background: transparent; }
        .nc-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
        .nc-item {
          display: flex;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.1s;
          position: relative;
        }
        .nc-item:hover { background: rgba(255,255,255,0.05); }
        .nc-item.unread { background: rgba(255,255,255,0.04); }
        .nc-item.unread::before {
          content: '';
          position: absolute;
          left: 0; top: 50%;
          transform: translateY(-50%);
          width: 3px; height: 60%;
          background: #34d399;
          border-radius: 0 2px 2px 0;
        }
        .nc-dot {
          width: 24px; height: 24px;
          border-radius: 6px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.06);
          margin-top: 2px;
        }
        .nc-body { flex: 1; min-width: 0; }
        .nc-item-title {
          font-size: 0.8125rem;
          font-weight: 600;
          color: #f1f5f9;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .nc-item-msg {
          font-size: 0.775rem;
          color: rgba(255,255,255,0.5);
          margin-top: 2px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .nc-item-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 4px;
        }
        .nc-severity-tag {
          font-size: 0.68rem;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 99px;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .nc-empty {
          padding: 2.5rem 1rem;
          text-align: center;
          color: rgba(255,255,255,0.4);
          font-size: 0.85rem;
        }
        .nc-footer {
          padding: 0.5rem 0.75rem;
          border-top: 1px solid rgba(255,255,255,0.07);
          display: flex;
          justify-content: center;
          flex-shrink: 0;
        }
        .nc-load-more {
          background: none;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px;
          color: rgba(255,255,255,0.5);
          font: 500 0.78rem/1 inherit;
          padding: 0.35rem 1rem;
          cursor: pointer;
          transition: all 0.12s;
          width: 100%;
        }
        .nc-load-more:hover { color: #fff; border-color: rgba(255,255,255,0.25); background: rgba(255,255,255,0.06); }
        .nc-error {
          color: #f87171;
          font-size: 0.8rem;
          padding: 0.75rem 1rem;
          text-align: center;
        }
        @media (max-width: 480px) {
          .nc-panel { width: calc(100vw - 1rem); right: -0.5rem; }
        }
      `}</style>

      {/* Bell trigger */}
      <button
        ref={triggerRef}
        className="nc-trigger"
        onClick={open ? closePanel : openPanel}
        aria-label={
          unreadCount > 0
            ? `Notifications — ${badgeDisplay} unread`
            : 'Notifications — no unread'
        }
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="nc-badge" aria-hidden="true">
            {badgeDisplay}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className="nc-panel"
          role="dialog"
          aria-label="Notification center"
          aria-modal="true"
        >
          {/* Header */}
          <div className="nc-header">
            <span className="nc-title">
              Notifications
              {unreadCount > 0 && (
                <span
                  style={{
                    marginLeft: '0.4rem',
                    background: '#ef4444',
                    color: '#fff',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '99px',
                    verticalAlign: 'middle',
                  }}
                  aria-label={`${badgeDisplay} unread`}
                >
                  {badgeDisplay}
                </span>
              )}
            </span>
            <div className="nc-header-actions">
              <button
                className={`nc-filter-btn${unreadOnly ? ' active' : ''}`}
                onClick={toggleFilter}
                aria-pressed={unreadOnly}
              >
                Unread only
              </button>
              {unreadCount > 0 && (
                <button className="nc-btn" onClick={markAllRead}>
                  Mark all as read
                </button>
              )}
              <button
                className="nc-btn"
                onClick={closePanel}
                aria-label="Close notifications"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Live region for status updates */}
          <div aria-live="polite" aria-atomic="true" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
            {loading ? 'Loading notifications…' : ''}
          </div>

          {/* List */}
          <div className="nc-list" role="list" aria-label="Notifications list">
            {loading && notifications.length === 0 ? (
              <div className="nc-empty" aria-busy="true">Loading…</div>
            ) : error ? (
              <div className="nc-error" role="alert">{error}</div>
            ) : notifications.length === 0 ? (
              <div className="nc-empty">No notifications</div>
            ) : (
              notifications.map((notif) => {
                const sev = SEVERITY_META[notif.severity] || SEVERITY_META.info;
                return (
                  <div
                    key={notif._id}
                    className={`nc-item${!notif.read ? ' unread' : ''}`}
                    role="listitem"
                    onClick={() => handleNotificationClick(notif)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleNotificationClick(notif);
                      }
                    }}
                    tabIndex={0}
                    aria-label={`${notif.title}: ${notif.message}${!notif.read ? ' — unread' : ''}`}
                  >
                    <div className="nc-dot" aria-hidden="true">
                      <NotificationTypeIcon type={notif.type} />
                    </div>
                    <div className="nc-body">
                      <div className="nc-item-title">{notif.title}</div>
                      <div className="nc-item-msg">{notif.message}</div>
                      <div className="nc-item-footer">
                        <span
                          className="nc-severity-tag"
                          style={{ background: sev.bg, color: sev.color }}
                        >
                          {sev.label}
                        </span>
                        <TimeAgo date={notif.createdAt} timeZone={timeZone} />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Load more */}
          {hasMore && !loading && (
            <div className="nc-footer">
              <button
                className="nc-load-more"
                onClick={() => fetchNotifications(page + 1, unreadOnly)}
                aria-label="Load more notifications"
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
