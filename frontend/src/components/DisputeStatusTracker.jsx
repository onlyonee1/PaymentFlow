import React from "react";
import { useTranslation } from "react-i18next";

const STEPS = [
  { key: "open", labelKey: "status.dispute.open", defaultLabel: "Opened" },
  { key: "under_review", labelKey: "status.dispute.under_review", defaultLabel: "Under Review" },
  { key: "resolved", labelKey: "status.dispute.resolved", defaultLabel: "Resolved / Rejected" },
];

/**
 * DisputeStatusTracker — Visual tracker for dispute progress:
 * Opened → Under Review → Resolved / Rejected
 */
export default function DisputeStatusTracker({ status = "open" }) {
  const { t } = useTranslation();
  const normalizedStatus = (status || "open").toLowerCase();
  const isRejected = normalizedStatus === "rejected";
  const isResolved = normalizedStatus === "resolved";
  const isClosed = isResolved || isRejected;

  const currentStepIndex =
    normalizedStatus === "open"
      ? 0
      : normalizedStatus === "under_review"
      ? 1
      : 2;

  return (
    <div
      role="region"
      aria-label="Dispute progress"
      style={{
        margin: "1rem 0",
        padding: "1rem",
        background: "rgba(255, 255, 255, 0.03)",
        borderRadius: 8,
        border: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        {/* Background track line */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 20,
            right: 20,
            height: 3,
            background: "var(--border)",
            zIndex: 0,
          }}
        />
        {/* Active track line */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 20,
            width: `${(currentStepIndex / 2) * 100}%`,
            height: 3,
            background: isRejected ? "#ef4444" : "var(--primary, #3b82f6)",
            zIndex: 1,
            transition: "width 0.3s ease",
          }}
        />

        {STEPS.map((step, idx) => {
          const isDone = idx < currentStepIndex;
          const isCurrent = idx === currentStepIndex;
          let stepLabel = t(step.labelKey, { defaultValue: step.defaultLabel });
          if (idx === 2) {
            if (isResolved) stepLabel = t("status.dispute.resolved", { defaultValue: "Resolved" });
            else if (isRejected) stepLabel = t("status.dispute.rejected", { defaultValue: "Rejected" });
          }

          let circleBg = "var(--card-bg, #1e293b)";
          let circleBorder = "var(--border)";
          let textColor = "var(--text-muted)";

          if (isDone) {
            circleBg = "var(--primary, #3b82f6)";
            circleBorder = "var(--primary, #3b82f6)";
            textColor = "var(--text)";
          } else if (isCurrent) {
            circleBg = isRejected ? "#ef4444" : "var(--primary, #3b82f6)";
            circleBorder = isRejected ? "#ef4444" : "var(--primary, #3b82f6)";
            textColor = isRejected ? "#ef4444" : "var(--primary, #3b82f6)";
          }

          return (
            <div
              key={step.key}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                zIndex: 2,
                position: "relative",
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: circleBg,
                  border: `2px solid ${circleBorder}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isDone || isCurrent ? "#fff" : "var(--text-muted)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  transition: "all 0.2s ease",
                }}
              >
                {isDone ? "✓" : idx + 1}
              </div>
              <span
                style={{
                  marginTop: 6,
                  fontSize: "0.75rem",
                  fontWeight: isCurrent ? 600 : 400,
                  color: textColor,
                  whiteSpace: "nowrap",
                }}
              >
                {stepLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
