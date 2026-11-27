import { useState } from "react";
import { flagDispute, uploadDisputeAttachment } from "../services/api";
import { getErrorMessage } from "../utils/errorMessages";
import { useTranslation } from "react-i18next";
import DisputeStatusTracker from "./DisputeStatusTracker";

const REASON_OPTIONS = [
  "Payment not matched",
  "Incorrect amount",
  "Duplicate charge",
  "Wrong student account",
  "Other",
];

/**
 * DisputeForm — lets a parent raise a dispute for a confirmed payment.
 *
 * Props:
 *   txHash    {string}   — transaction hash of the payment being disputed
 *   studentId {string}   — student ID associated with the payment
 *   onSuccess {function} — called with the created dispute object on success
 *   onCancel  {function} — called when the user dismisses the form
 */
export default function DisputeForm({ txHash, studentId, onSuccess, onCancel }) {
  const { t } = useTranslation();
  const [raisedBy, setRaisedBy] = useState("");
  const [reasonOption, setReasonOption] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [existingDisputeId, setExistingDisputeId] = useState(null);

  function handleReasonSelect(val) {
    setReasonOption(val);
    if (val && val !== "Other") {
      setReason(val);
    } else if (val === "Other") {
      setReason("");
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0] || null;
    setAttachment(file);
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setErrors((prev) => ({ ...prev, attachment: "Attachment must be 5 MB or less." }));
      } else {
        const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
        if (!allowed.includes(file.type)) {
          setErrors((prev) => ({ ...prev, attachment: "Only images and PDF documents are allowed." }));
        } else {
          setErrors((prev) => {
            const next = { ...prev };
            delete next.attachment;
            return next;
          });
        }
      }
    }
  }

  function validate() {
    const e = {};
    if (!raisedBy || !raisedBy.trim()) {
      e.raisedBy = t("disputeForm.nameRequired", { defaultValue: "Your name is required." });
    } else if (raisedBy.trim().length > 200) {
      e.raisedBy = t("disputeForm.nameTooLong", { defaultValue: "Must be 200 characters or fewer." });
    }

    if (!reason || !reason.trim()) {
      e.reason = t("disputeForm.reasonRequired", { defaultValue: "Reason is required." });
    } else if (reason.trim().length > 1000) {
      e.reason = t("disputeForm.reasonTooLong", { defaultValue: "Must be 1000 characters or fewer." });
    }

    if (notes && notes.length > 500) {
      e.notes = t("disputeForm.notesTooLong", { defaultValue: "Notes must be 500 characters or fewer." });
    }

    if (attachment) {
      if (attachment.size > 5 * 1024 * 1024) {
        e.attachment = t("disputeForm.fileTooLarge", { defaultValue: "Attachment must be 5 MB or less." });
      } else {
        const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
        if (!allowed.includes(attachment.type)) {
          e.attachment = t("disputeForm.fileInvalidType", { defaultValue: "Only images and PDF documents are allowed." });
        }
      }
    }

    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError(null);
    setExistingDisputeId(null);

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      const res = await flagDispute({
        txHash,
        studentId,
        raisedBy: raisedBy.trim(),
        reason: reason.trim(),
        notes: notes ? notes.trim() : undefined,
      });

      const dispute = res.data;

      // If an attachment was chosen, upload it to POST /api/disputes/:id/attachments
      if (attachment && dispute?._id) {
        try {
          const formData = new FormData();
          formData.append("file", attachment);
          if (notes) formData.append("notes", notes.trim());
          await uploadDisputeAttachment(dispute._id, formData);
        } catch (uploadErr) {
          console.warn("Attachment upload warning:", uploadErr);
        }
      }

      onSuccess && onSuccess(dispute);
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.disputeId) {
        setExistingDisputeId(data.disputeId);
      } else {
        setServerError(getErrorMessage(data?.code, data?.error) || t("disputeForm.failedToSubmit", { defaultValue: "Failed to submit dispute" }));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispute-form-title"
      style={{
        background: "var(--bg, #0f172a)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "1.5rem",
        maxWidth: 480,
      }}
    >
      <h3 id="dispute-form-title" style={{ marginBottom: "0.25rem", fontSize: "1rem" }}>
        {t("disputeForm.title", { defaultValue: "Raise Payment Dispute" })}
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
        {t("disputeForm.transactionPrefix", { defaultValue: "Transaction: " })}
        <code style={{ fontFamily: "monospace" }}>{txHash?.slice(0, 16)}…</code>
      </p>

      {/* Dispute Status Tracker indicator */}
      <DisputeStatusTracker status="open" />

      {existingDisputeId && (
        <div role="alert" style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 6, padding: "0.75rem", fontSize: "0.85rem", color: "#854d0e", marginBottom: "1rem" }}>
          {t("disputeForm.alreadyOpen", { defaultValue: "A dispute is already open for this transaction:" })}{" "}
          <strong>{t("disputeForm.disputeIdLabel", { defaultValue: "Dispute ID" })}</strong> <code>{existingDisputeId}</code>
        </div>
      )}

      {serverError && (
        <div role="alert" style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 6, padding: "0.75rem", fontSize: "0.85rem", color: "#991b1b", marginBottom: "1rem" }}>
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* Name / RaisedBy input */}
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="df-raisedBy" style={{ display: "block", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: "0.3rem" }}>
            {t("disputeForm.nameLabel", { defaultValue: "Your Name" })}
          </label>
          <input
            id="df-raisedBy"
            type="text"
            value={raisedBy}
            onChange={(e) => setRaisedBy(e.target.value)}
            maxLength={200}
            aria-describedby={errors.raisedBy ? "df-raisedBy-err" : undefined}
            aria-invalid={!!errors.raisedBy}
            style={{ width: "100%", padding: "0.6rem 0.75rem", border: `1px solid ${errors.raisedBy ? "#f87171" : "var(--border)"}`, borderRadius: 6, background: "var(--bg, #0f172a)", color: "var(--text, #fff)", fontSize: "0.9rem", boxSizing: "border-box" }}
          />
          {errors.raisedBy && (
            <span id="df-raisedBy-err" role="alert" style={{ color: "#dc2626", fontSize: "0.78rem", display: "block", marginTop: 4 }}>{errors.raisedBy}</span>
          )}
        </div>

        {/* Reason Dropdown & details */}
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="df-reason-select" style={{ display: "block", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: "0.3rem" }}>
            {t("disputeForm.reasonDropdownLabel", { defaultValue: "Dispute Reason" })}
          </label>
          <select
            id="df-reason-select"
            value={reasonOption}
            onChange={(e) => handleReasonSelect(e.target.value)}
            style={{
              width: "100%",
              padding: "0.6rem 0.75rem",
              border: `1px solid ${errors.reason ? "#f87171" : "var(--border)"}`,
              borderRadius: 6,
              background: "var(--bg, #0f172a)",
              color: "var(--text, #fff)",
              fontSize: "0.9rem",
              boxSizing: "border-box",
              marginBottom: "0.5rem",
            }}
          >
            <option value="">{t("disputeForm.selectReason", { defaultValue: "-- Select Reason --" })}</option>
            {REASON_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>

          <label htmlFor="df-reason" style={{ display: "block", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: "0.3rem" }}>
            {t("disputeForm.reasonLabel", { defaultValue: "Reason Details" })} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({reason.length}/1000)</span>
          </label>
          <textarea
            id="df-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={t("disputeForm.reasonPlaceholder", { defaultValue: "Describe the reason for the dispute..." })}
            aria-describedby={errors.reason ? "df-reason-err" : undefined}
            aria-invalid={!!errors.reason}
            style={{ width: "100%", padding: "0.6rem 0.75rem", border: `1px solid ${errors.reason ? "#f87171" : "var(--border)"}`, borderRadius: 6, background: "var(--bg, #0f172a)", color: "var(--text, #fff)", fontSize: "0.9rem", resize: "vertical", boxSizing: "border-box" }}
          />
          {errors.reason && (
            <span id="df-reason-err" role="alert" style={{ color: "#dc2626", fontSize: "0.78rem", display: "block", marginTop: 4 }}>{errors.reason}</span>
          )}
        </div>

        {/* Notes (max 500 chars) */}
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="df-notes" style={{ display: "block", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: "0.3rem" }}>
            {t("disputeForm.notesLabel", { defaultValue: "Additional Notes" })} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({notes.length}/500)</span>
          </label>
          <textarea
            id="df-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={t("disputeForm.notesPlaceholder", { defaultValue: "Any additional details or context (optional)..." })}
            aria-describedby={errors.notes ? "df-notes-err" : undefined}
            aria-invalid={!!errors.notes}
            style={{ width: "100%", padding: "0.6rem 0.75rem", border: `1px solid ${errors.notes ? "#f87171" : "var(--border)"}`, borderRadius: 6, background: "var(--bg, #0f172a)", color: "var(--text, #fff)", fontSize: "0.9rem", resize: "vertical", boxSizing: "border-box" }}
          />
          {errors.notes && (
            <span id="df-notes-err" role="alert" style={{ color: "#dc2626", fontSize: "0.78rem", display: "block", marginTop: 4 }}>{errors.notes}</span>
          )}
        </div>

        {/* Attachment (Screenshot or PDF <= 5MB) */}
        <div style={{ marginBottom: "1.25rem" }}>
          <label htmlFor="df-attachment" style={{ display: "block", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: "0.3rem" }}>
            {t("disputeForm.attachmentLabel", { defaultValue: "Attachment (Screenshot or PDF ≤ 5 MB)" })}
          </label>
          <input
            id="df-attachment"
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileChange}
            aria-describedby={errors.attachment ? "df-attachment-err" : undefined}
            aria-invalid={!!errors.attachment}
            style={{
              width: "100%",
              padding: "0.4rem 0",
              fontSize: "0.85rem",
              color: "var(--text, #fff)",
            }}
          />
          {errors.attachment && (
            <span id="df-attachment-err" role="alert" style={{ color: "#dc2626", fontSize: "0.78rem", display: "block", marginTop: 4 }}>{errors.attachment}</span>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: "0.5rem 1rem", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--text, #fff)", cursor: "pointer", fontSize: "0.875rem" }}
          >
            {t("actions.cancel", { defaultValue: "Cancel" })}
          </button>
          <button
            type="submit"
            disabled={submitting}
            style={{ padding: "0.5rem 1.25rem", border: "none", borderRadius: 6, background: "var(--primary, #3b82f6)", color: "#fff", cursor: submitting ? "not-allowed" : "pointer", fontSize: "0.875rem", opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? t("disputeForm.submitting", { defaultValue: "Submitting…" }) : t("disputeForm.submitDispute", { defaultValue: "Submit Dispute" })}
          </button>
        </div>
      </form>
    </div>
  );
}
