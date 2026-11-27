import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { updateStudent } from "../services/api";
import PaymentPlanForm from "./PaymentPlanForm";
import { stripHtml } from "../utils/sanitizeInput";
import { getErrorMessage } from "../utils/errorMessages";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function StudentForm({ student, onClose, onSave, onOptimisticUpdate, onRollback }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: "",
    class: "",
    parentEmail: "",
    parentPhone: "",
    reminderOptOut: false,
    paymentConfirmationOptOut: false,
    disputeUpdateOptOut: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [touchedFields, setTouchedFields] = useState({});

  useEffect(() => {
    if (student) {
      setFormData({
        name: student.name || "",
        class: student.class || "",
        parentEmail: student.parentEmail || "",
        parentPhone: student.parentPhone || "",
        reminderOptOut: Boolean(student.reminderOptOut),
        paymentConfirmationOptOut: Boolean(student.paymentConfirmationOptOut),
        disputeUpdateOptOut: Boolean(student.disputeUpdateOptOut),
      });
    }
  }, [student]);

  function validateField(name, value) {
    if (name === "name") {
      if (!value || !value.trim()) return t("studentForm.nameRequired");
    }
    if (name === "parentEmail") {
      if (value && value.trim() && !EMAIL_RE.test(value.trim())) {
        return t("studentForm.parentEmailInvalid");
      }
    }
    return null;
  }

  function validate() {
    const errs = {};
    const nameErr = validateField("name", formData.name);
    if (nameErr) errs.name = nameErr;
    const emailErr = validateField("parentEmail", formData.parentEmail);
    if (emailErr) errs.parentEmail = emailErr;
    return errs;
  }

  function handleBlur(e) {
    const { name, value } = e.target;
    if (name === "reminderOptOut") return;
    setTouchedFields(prev => ({ ...prev, [name]: true }));
    const err = validateField(name, value);
    setFieldErrors(prev => ({
      ...prev,
      [name]: err || undefined,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      // Mark all validated fields as touched so errors show
      setTouchedFields(prev => ({ ...prev, name: true, parentEmail: true }));
      return;
    }
    setFieldErrors({});
    setLoading(true);

    try {
      const updates = { ...formData };
      for (const field of ["reminderOptOut", "paymentConfirmationOptOut", "disputeUpdateOptOut"]) {
        if (updates[field] === Boolean(student[field])) delete updates[field];
      }
      onOptimisticUpdate?.(student.studentId, updates);
      await updateStudent(student.studentId, updates);
      setSuccess(t("studentForm.updateSuccess"));
      setTimeout(() => {
        if (onSave) onSave();
        if (onClose) onClose();
      }, 1000);
    } catch (err) {
      const data = err.response?.data;
      const message = err.response?.status === 412
        ? t("studentForm.stale", { defaultValue: "Someone else changed this — please refresh" })
        : getErrorMessage(data?.code, data?.error) || t("studentForm.updateFailed");
      setError(message);
      onRollback?.(message);
    } finally {
      setLoading(false);
    }
  }

  const TEXT_FIELDS = new Set(["name", "class"]);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    let nextValue = type === "checkbox" ? checked : value;
    if (TEXT_FIELDS.has(name)) nextValue = stripHtml(nextValue);
    setFormData(prev => ({
      ...prev,
      [name]: nextValue,
    }));
    // If this field already has an error, re-validate immediately so error
    // clears as soon as the value becomes valid.
    if (fieldErrors[name] !== undefined) {
      const err = validateField(name, nextValue);
      setFieldErrors(prev => ({
        ...prev,
        [name]: err || undefined,
      }));
    }
  }

  function fieldBorderColor(name) {
    if (fieldErrors[name]) return "#f87171";
    if (touchedFields[name] && !fieldErrors[name] && formData[name]) return "#22c55e";
    return "var(--border)";
  }

  if (!student) return null;

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "2rem",
        maxWidth: "500px",
        width: "90%",
        maxHeight: "90vh",
        overflowY: "auto",
      }}>
        <h2 style={{ marginTop: 0, marginBottom: "1.5rem" }}>{t("studentForm.editTitle")}</h2>

        {error && (
          <div style={{
            background: "#fee2e2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            padding: "0.75rem 1rem",
            color: "#991b1b",
            marginBottom: "1rem",
            fontSize: "0.875rem",
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            background: "#dcfce7",
            border: "1px solid #bbf7d0",
            borderRadius: "6px",
            padding: "0.75rem 1rem",
            color: "#166534",
            marginBottom: "1rem",
            fontSize: "0.875rem",
          }}>
            ✓ {success}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{
              display: "block",
              fontSize: "0.875rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
              color: "var(--text)",
            }}>
              {t("studentForm.studentId")}
            </label>
            <input
              type="text"
              value={student.studentId}
              disabled
              style={{
                width: "100%",
                padding: "0.75rem",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                background: "var(--muted)",
                color: "var(--text)",
                opacity: 0.6,
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label htmlFor="sf-name" style={{
              display: "block",
              fontSize: "0.875rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
              color: "var(--text)",
            }}>
              {t("studentForm.name")}
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="sf-name"
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? "sf-name-error" : undefined}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  paddingRight: touchedFields.name && !fieldErrors.name && formData.name ? "2.25rem" : "0.75rem",
                  border: `1px solid ${fieldBorderColor("name")}`,
                  borderRadius: "6px",
                  background: "var(--bg)",
                  color: "var(--text)",
                  boxSizing: "border-box",
                }}
              />
              {touchedFields.name && !fieldErrors.name && formData.name && (
                <span
                  aria-hidden="true"
                  style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "#22c55e", fontWeight: 700 }}
                >✓</span>
              )}
            </div>
            {fieldErrors.name && (
              <span
                id="sf-name-error"
                role="alert"
                aria-live="polite"
                style={{ color: "#dc2626", fontSize: "0.78rem" }}
              >{fieldErrors.name}</span>
            )}
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label htmlFor="sf-class" style={{
              display: "block",
              fontSize: "0.875rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
              color: "var(--text)",
            }}>
               {t("studentForm.className")}
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="sf-class"
                type="text"
                name="class"
                value={formData.class}
                onChange={handleChange}
                onBlur={handleBlur}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: `1px solid ${fieldBorderColor("class")}`,
                  borderRadius: "6px",
                  background: "var(--bg)",
                  color: "var(--text)",
                  boxSizing: "border-box",
                }}
              />
              {touchedFields.class && !fieldErrors.class && formData.class && (
                <span
                  aria-hidden="true"
                  style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "#22c55e", fontWeight: 700 }}
                >✓</span>
              )}
            </div>
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label htmlFor="sf-parentEmail" style={{
              display: "block",
              fontSize: "0.875rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
              color: "var(--text)",
            }}>
              {t("studentForm.parentEmail")}
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="sf-parentEmail"
                type="email"
                name="parentEmail"
                value={formData.parentEmail}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!fieldErrors.parentEmail}
                aria-describedby={fieldErrors.parentEmail ? "sf-parentEmail-error" : undefined}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  paddingRight: touchedFields.parentEmail && !fieldErrors.parentEmail && formData.parentEmail ? "2.25rem" : "0.75rem",
                  border: `1px solid ${fieldBorderColor("parentEmail")}`,
                  borderRadius: "6px",
                  background: "var(--bg)",
                  color: "var(--text)",
                  boxSizing: "border-box",
                }}
              />
              {touchedFields.parentEmail && !fieldErrors.parentEmail && formData.parentEmail && (
                <span
                  aria-hidden="true"
                  style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "#22c55e", fontWeight: 700 }}
                >✓</span>
              )}
            </div>
            {fieldErrors.parentEmail && (
              <span
                id="sf-parentEmail-error"
                role="alert"
                aria-live="polite"
                style={{ color: "#dc2626", fontSize: "0.78rem" }}
              >{fieldErrors.parentEmail}</span>
            )}
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label htmlFor="sf-parentPhone" style={{
              display: "block",
              fontSize: "0.875rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
              color: "var(--text)",
            }}>
              {t("studentForm.parentPhone")}
            </label>
            <input
              id="sf-parentPhone"
              type="tel"
              name="parentPhone"
              value={formData.parentPhone}
              onChange={handleChange}
              onBlur={handleBlur}
              style={{
                width: "100%",
                padding: "0.75rem",
                border: `1px solid ${fieldBorderColor("parentPhone")}`,
                borderRadius: "6px",
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            background: "rgba(126,200,227,0.05)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
          }}>
            <label style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              cursor: "pointer",
              fontSize: "0.9rem",
              margin: 0,
            }}>
              <input
                type="checkbox"
                name="reminderOptOut"
                checked={formData.reminderOptOut}
                onChange={handleChange}
                style={{
                  width: "18px",
                  height: "18px",
                  cursor: "pointer",
                }}
              />
              <span>
                <strong>{t("studentForm.receiveReminders")}</strong>
                <div style={{
                  fontSize: "0.8rem",
                  color: "var(--muted)",
                  marginTop: "0.25rem",
                }}>
                  {formData.reminderOptOut
                    ? t("studentForm.remindersDisabled")
                    : t("studentForm.remindersEnabled")}
                </div>
              </span>
            </label>
          </div>

          <fieldset style={{ marginBottom: "1rem" }}>
            <legend>Email preferences</legend>
            <label style={{ display: "block" }}>
              <input type="checkbox" name="paymentConfirmationOptOut" checked={formData.paymentConfirmationOptOut} onChange={handleChange} />
              Disable payment confirmation emails
            </label>
            <label style={{ display: "block" }}>
              <input type="checkbox" name="disputeUpdateOptOut" checked={formData.disputeUpdateOptOut} onChange={handleChange} />
              Disable dispute update emails
            </label>
          </fieldset>

          <PaymentPlanForm
            student={student}
            onClose={onClose}
            onSave={onSave}
          />

          <div style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "flex-end",
            marginTop: "1.5rem",
          }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: "0.75rem 1.5rem",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                background: "var(--bg)",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              {t("actions.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "0.75rem 1.5rem",
                border: "none",
                borderRadius: "6px",
                background: "var(--accent)",
                color: "white",
                cursor: loading ? "default" : "pointer",
                fontSize: "0.9rem",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? t("actions.savingEllipsis") : t("studentForm.saveChanges")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
