/**
 * ErrorBoundary — Issue #9
 *
 * Enhancements over the original:
 *
 * 1. Correlation ID — generated via crypto.randomUUID() (with a Math.random
 *    fallback for environments that lack the Web Crypto API) so operators can
 *    correlate a user-visible reference with server logs.
 *
 * 2. Sensitive detail suppression — raw error.message and stack traces are
 *    never rendered in the UI; only the correlation ID is surfaced.
 *
 * 3. Retry button — resets the boundary's own state (hasError → false) so the
 *    child tree is re-mounted without a full page reload.
 *
 * 4. Reload button — retained for cases where a full reload is needed.
 *
 * 5. Accepts an optional `onError` prop for external logging hooks.
 *
 * Security note: error.message and componentStack are intentionally kept out
 * of the rendered output to avoid leaking implementation details (stack paths,
 * internal state values, etc.) to end users.  Only the correlation ID is shown.
 */

import { Component } from "react";
import Link from "next/link";
import { withTranslation } from "react-i18next";
import { reportRenderError } from "../services/errorTracker";

/**
 * Generate a short, URL-safe correlation ID.
 * Uses the Web Crypto API when available; falls back to Math.random().
 */
function generateCorrelationId() {
  try {
    if (
      typeof globalThis !== "undefined" &&
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === "function"
    ) {
      // Full UUID — trim to the first segment for display brevity.
      return globalThis.crypto.randomUUID().split("-")[0].toUpperCase();
    }
  } catch {
    // Ignore — fall through to the Math.random fallback.
  }
  // Fallback: 8 hex chars from Math.random.
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0")
    .toUpperCase();
}

/**
 * ErrorBoundary — full-page boundary wrapping the entire app.
 *
 * Catches unhandled render errors that bubble past widget-level boundaries.
 * Distinguishes fatal errors (missing auth context) which redirect to /login,
 * from recoverable errors which show a retry/reload fallback UI.
 *
 * Usage: wrap the top-level <Component> in _app.jsx.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      correlationId: null,
    };
    this._handleRetry = this._handleRetry.bind(this);
  }

  static getDerivedStateFromError() {
    // Do NOT store the raw error object in state — it would leak to the renderer.
    return {
      hasError: true,
      correlationId: generateCorrelationId(),
    };
  }

  componentDidCatch(error, info) {
    const { correlationId } = this.state;
    const { onError, sectionName = "Application" } = this.props;
    const componentStack = info?.componentStack || "";

    reportRenderError(error, componentStack, { correlationId, section: sectionName });

    if (typeof onError === "function") {
      onError({ error, componentStack, correlationId, section: sectionName });
    }
  }

  _handleRetry() {
    // Reset boundary state so children are re-mounted without a page reload.
    this.setState({ hasError: false, correlationId: null });
  }

  render() {
    const { t, children, sectionName = "Application" } = this.props;
    const { hasError, correlationId } = this.state;

    if (hasError) {
      return (
        <div
          role="alert"
          style={{
            minHeight: "60vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            padding: "2rem",
            textAlign: "center",
            fontFamily: "Inter, sans-serif",
            color: "var(--text, #0f172a)",
          }}
        >
          <div style={{ fontSize: "3rem" }} aria-hidden="true">⚠️</div>

          <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
            {t("errorBoundary.sectionTitle", { section: sectionName })}
          </h2>

          <p
            style={{
              margin: 0,
              color: "var(--text-muted, #64748b)",
              maxWidth: "360px",
            }}
          >
            {t("errorBoundary.body")}
          </p>

          {/* Correlation ID — shown to users so support teams can locate the event. */}
          {correlationId && (
            <p
              style={{
                margin: 0,
                fontSize: "0.75rem",
                color: "var(--text-muted, #94a3b8)",
                fontFamily: "monospace",
              }}
              aria-label={t("errorBoundary.correlationId", { id: correlationId })}
            >
              {t("errorBoundary.correlationId", { id: correlationId })}
            </p>
          )}

          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {/* Retry — resets boundary state, re-mounts the failed subtree */}
            <button
              onClick={this._handleRetry}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "8px",
                border: "none",
                background: "var(--grad-brand, #059669)",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("errorBoundary.retry")}
            </button>

            {/* Reload — full page reload as last resort */}
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "8px",
                border: "1px solid var(--border, #e7e9f3)",
                background: "var(--card-bg, #fff)",
                color: "var(--text, #0f172a)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("errorBoundary.reload")}
            </button>

            {/* Go Back — navigates to the previous history entry */}
            <button
              onClick={() => {
                // Navigate back; the parent will re-render a fresh boundary
                // instance because the page component changes.
                window.history.back();
              }}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "8px",
                border: "1px solid var(--border, #e7e9f3)",
                background: "var(--card-bg, #fff)",
                color: "var(--text, #0f172a)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("errorBoundary.goBack")}
            </button>

            <Link
              href="/"
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "8px",
                border: "1px solid var(--border, #e7e9f3)",
                background: "var(--card-bg, #fff)",
                color: "var(--text, #0f172a)",
                fontWeight: 600,
                textDecoration: "none",
                lineHeight: "1.5",
              }}
            >
              {t("errorBoundary.goHome")}
            </Link>
          </div>
        </div>
      );
    }

    return children;
  }
}

export default withTranslation()(ErrorBoundary);

/**
 * WidgetErrorBoundary — lightweight boundary for individual dashboard widgets
 * and page sections.
 *
 * A thrown error in a child component shows a compact fallback with a retry
 * button that re-mounts the failed subtree, without crashing the rest of the
 * page.
 *
 * Usage:
 *   <WidgetErrorBoundary label="Payment Summary">
 *     <PaymentSummaryWidget />
 *   </WidgetErrorBoundary>
 */
export class WidgetErrorBoundary extends Component {
  state = { hasError: false, error: null, retryKey: 0 };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(
      `[WidgetErrorBoundary] Error in "${this.props.label || "widget"}":`,
      error,
      info.componentStack
    );
  }

  retry() {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryKey: prev.retryKey + 1,
    }));
  }

  render() {
    if (this.state.hasError) {
      const label = this.props.label || "this section";
      return (
        <div
          role="alert"
          style={{
            padding: "1.25rem",
            borderRadius: 8,
            border: "1px solid var(--border, #e7e9f3)",
            background: "var(--card-bg, #fff)",
            textAlign: "center",
            color: "var(--text-muted, #64748b)",
            fontSize: "0.875rem",
          }}
        >
          <div style={{ marginBottom: "0.5rem" }}>⚠️</div>
          <p style={{ margin: "0 0 0.75rem" }}>
            Something went wrong loading {label}. Try refreshing this section.
          </p>
          <button
            onClick={() => this.retry()}
            style={{
              padding: "0.375rem 1rem",
              borderRadius: "6px",
              border: "none",
              background: "var(--grad-brand, #059669)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.8125rem",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    // retryKey forces a full re-mount of children when retrying
    return (
      <div key={this.state.retryKey}>
        {this.props.children}
      </div>
    );
  }
}
