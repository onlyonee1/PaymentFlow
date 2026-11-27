import { useState, useEffect } from "react";

export function shouldShowBanner(envValue) {
  return envValue === "testnet";
}

const STORAGE_KEY = "stellar_testnet_banner_dismissed";

export default function TestnetBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  const network =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK || process.env.STELLAR_NETWORK;

  useEffect(() => {
    setMounted(true);
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        if (window.sessionStorage.getItem(STORAGE_KEY) === "true") {
          setDismissed(true);
        }
      }
    } catch {
      // sessionStorage unavailable/disabled
    }
  }, []);

  if (!shouldShowBanner(network) || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.setItem(STORAGE_KEY, "true");
      }
    } catch {
      // ignore storage failure
    }
  };

  return (
    <div
      role="alert"
      aria-label="Stellar Testnet notice"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        background: "#F59E0B",
        color: "#78350f",
        padding: "0.4rem 1.5rem",
        textAlign: "center",
        fontWeight: 600,
        fontSize: "0.82rem",
        letterSpacing: "0.01em",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#b45309",
          marginRight: "0.5rem",
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      <span style={{ flex: 1, textAlign: "center" }}>
        You are on Stellar Testnet — funds are not real
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss testnet banner"
        style={{
          background: "transparent",
          border: "none",
          color: "#78350f",
          cursor: "pointer",
          fontSize: "1.1rem",
          lineHeight: 1,
          padding: "0.2rem 0.5rem",
          marginLeft: "0.75rem",
          borderRadius: "4px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ✕
      </button>
    </div>
  );
}
