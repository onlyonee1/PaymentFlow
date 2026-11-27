/**
 * ReceiptDownloadButton — Issue #604
 *
 * Downloads a PDF receipt for a confirmed payment.
 * Uses the backend GET /api/receipts/:txHash?format=pdf endpoint.
 *
 * The PDF is generated server-side by receiptPdfService. This component
 * triggers the download via a temporary <a> tag so it works on mobile
 * (iOS Safari, Android Chrome) without opening in a new tab.
 */
import { useState } from "react";
import { getReceiptDownloadUrl } from "../services/api";

export default function ReceiptDownloadButton({
  txHash,
  disabled = false,
  className = "",
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  async function handleDownload() {
    if (!txHash || downloading) return;
    setDownloading(true);
    setError(null);

    try {
      const url = getReceiptDownloadUrl(txHash);
      // Fetch as blob so the download works on iOS Safari and Android Chrome
      // (anchor[download] alone does not trigger a download cross-origin).
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${
            (typeof localStorage !== "undefined" &&
              localStorage.getItem("adminToken")) ||
            ""
          }`,
        },
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `receipt-${txHash.slice(0, 12)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError("Failed to download receipt. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className={`btn btn-secondary ${className}`}
        onClick={handleDownload}
        disabled={disabled || downloading || !txHash}
        aria-label={
          downloading
            ? "Downloading receipt PDF, please wait"
            : `Download PDF receipt for transaction ${
                txHash ? txHash.slice(0, 8) + "…" : ""
              }`
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          minHeight: "44px",
          minWidth: "44px",
          width: "100%",
          justifyContent: "center",
          padding: "0.5rem 1rem",
          background: "var(--bg-subtle, #f8f9fa)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          color: "var(--text)",
          fontSize: "0.8125rem",
          fontWeight: 600,
          cursor: disabled || downloading || !txHash ? "not-allowed" : "pointer",
          opacity: disabled || !txHash ? 0.6 : 1,
          fontFamily: "inherit",
        }}
      >
        {downloading ? (
          <>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 14,
                height: 14,
                border: "2px solid currentColor",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "receipt-btn-spin 0.7s linear infinite",
                flexShrink: 0,
              }}
            />
            Downloading…
          </>
        ) : (
          <>
            <span aria-hidden="true">⬇</span>
            Download Receipt
          </>
        )}
      </button>
      {error && (
        <p
          role="alert"
          style={{
            color: "var(--danger, #ef4444)",
            fontSize: "0.8rem",
            marginTop: "0.375rem",
            marginBottom: 0,
          }}
        >
          {error}
        </p>
      )}
      <style>{`
        @keyframes receipt-btn-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
