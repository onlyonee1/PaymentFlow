import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  getFeeStructures,
  createFeeStructure,
  createFeePaymentQr,
  deleteFeeStructure,
  getSchool,
} from "../services/api";
import { getErrorMessage } from "../utils/errorMessages";
import { DEFAULT_CLASS_OPTIONS, loadSchoolClassOptions } from "../utils/classOptions";
import { IconAlertTriangle, IconCheck, IconDollarSign, IconChevronLeft, IconChevronRight } from "../components/Icons";
import PageHero from "../components/PageHero";
import EmptyState from "../components/EmptyState";
import AccessiblePagination from "../components/AccessiblePagination";
import ConfirmDialog from "../components/ConfirmDialog"; // Issue #108
import { SkeletonTable } from "../components/Skeleton";
import { useAbortController } from "../hooks/useAbortController";

const EMPTY_FORM = {
  className: "",
  feeAmount: "",
  academicYear: new Date().getUTCFullYear().toString(),
  description: "",
  activeFrom: "",
  activeTo: "",
  isActive: true,
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FeesPage() {
  const { t } = useTranslation();
  const [paymentQr, setPaymentQr] = useState(null);
  const qrDialog = useRef(null);

  async function showPaymentQr(fee) {
    const label = fee.className;
    setPaymentQr({ label, loading: true });
    qrDialog.current.showModal();
    try {
      const { data } = await createFeePaymentQr(fee._id);
      setPaymentQr({ label, ...data });
    } catch (err) {
      setPaymentQr({ label, error: err.response?.data?.error || "Could not create the payment QR code." });
    }
  }

  const [fees, setFees]             = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [classOptions, setClassOptions] = useState(DEFAULT_CLASS_OPTIONS);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  // Create-form state
  const [form, setForm]             = useState(EMPTY_FORM);
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createSuccess, setCreateSuccess] = useState(false);

  // Delete state
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteError, setDeleteError]     = useState(null);

  // Issue #254 — abort in-flight fee requests when the component unmounts.
  const { signal } = useAbortController();

  const successRef = useRef(null);

  useEffect(() => {
    loadFees();
    loadSchoolClassOptions(getSchool, setClassOptions);
  }, []);

  // Auto-focus success message for screen readers
  useEffect(() => {
    if (createSuccess) {
      successRef.current?.focus();
      const t = setTimeout(() => setCreateSuccess(false), 4000);
      return () => clearTimeout(t);
    }
  }, [createSuccess]);

  function loadFees(page = 1, activeAt = previewDate) {
    setLoading(true);
    setError(null);
    getFeeStructures({ signal, page, limit: pagination.limit, manage: true, activeAt: activeAt || undefined })
      .then(({ data }) => {
        setFees(data.data || data);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      })
      .catch((err) => {
        // Silently ignore requests cancelled on unmount or navigation.
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setError(t("fees.failedToLoad"));
      })
      .finally(() => setLoading(false));
  }

  // ── Create form handlers ──────────────────────────────────────────────────

  function handleFormChange(e) {
    const { name, value, checked, type } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
    setCreateError(null);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(false);

    const feeAmount = parseFloat(form.feeAmount);
    if (!form.className) {
      setCreateError(t("fees.classRequired"));
      return;
    }
    if (!form.feeAmount || isNaN(feeAmount) || feeAmount <= 0) {
      setCreateError(t("fees.amountPositive"));
      return;
    }

    setCreating(true);
    try {
      const payload = {
        className: editing || form.className,
        feeAmount,
        isActive: form.isActive,
        activeFrom: form.activeFrom || null,
        activeTo: form.activeTo || null,
        ...(form.academicYear && { academicYear: form.academicYear }),
        ...(form.description.trim() && { description: form.description.trim() }),
      };
      if (editing) await updateFeeStructure(editing, payload);
      else await createFeeStructure(payload);
      setEditing(null);
      setForm(EMPTY_FORM);
      setCreateSuccess(true);
      loadFees(1);
    } catch (err) {
      setCreateError(
        getErrorMessage(err.response?.data?.code, err.response?.data?.error) ||
          err.response?.data?.errors?.[0] ||
          t("fees.failedToCreate")
      );
    } finally {
      setCreating(false);
    }
  }

  // ── Delete handlers ───────────────────────────────────────────────────────

  function handleDeleteClick(fee) {
    setDeleteError(null);
    setPendingDelete({ fee });
  }

  async function handleConfirmDelete() {
    const { fee } = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteFeeStructure(fee.className);
      loadFees(pagination.page);
    } catch (err) {
      setDeleteError(
        getErrorMessage(err.response?.data?.code, err.response?.data?.error) ||
          t("fees.failedToDelete")
      );
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <dialog ref={qrDialog} aria-labelledby="fee-payment-qr-title" style={{ maxWidth: "min(90vw, 26rem)", padding: "1.25rem" }}>
        <h2 id="fee-payment-qr-title">Payment QR code</h2>
        {paymentQr?.label && <p>{paymentQr.label}</p>}
        {paymentQr?.loading && <p role="status">Creating QR code…</p>}
        {paymentQr?.error && <p role="alert">{paymentQr.error}</p>}
        {paymentQr?.qrImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={paymentQr.qrImage} alt={`Scan to pay ${paymentQr.label}`} width="300" height="300" style={{ maxWidth: "100%", height: "auto" }} />
            <p>Expires {new Date(paymentQr.expiresAt).toLocaleDateString()}</p>
            <p><a href={paymentQr.qrImage} download="payment-qr.png">Download QR code</a></p>
            <p><a href={paymentQr.url} target="_blank" rel="noreferrer">Open payment link</a></p>
          </>
        )}
        <form method="dialog"><button className="btn btn-ghost">Close</button></form>
      </dialog>
      <PageHero
        eyebrow={t("fees.eyebrow")}
        title={t("fees.title")}
        subtitle={t("fees.subtitle")}
      />

      <div className="page-wrap">

        {/* ── Create form ──────────────────────────────────────────────────── */}
        <div className="card" id="create-fee" style={{ marginBottom: "1.5rem" }}>
          <div className="card-header">
            <div
              className="card-title"
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <IconDollarSign size={16} />
              {editing ? "Edit fee" : t("fees.createTitle")}
            </div>
          </div>
          <div className="card-body">
            {createSuccess && (
              <div
                ref={successRef}
                tabIndex="-1"
                role="status"
                aria-live="polite"
                className="alert alert-success"
                style={{ marginBottom: "1rem" }}
              >
                <IconCheck size={15} />
                <span>{t("fees.createSuccess")}</span>
              </div>
            )}
            {createError && (
              <div
                role="alert"
                className="alert alert-danger"
                style={{ marginBottom: "1rem" }}
              >
                <IconAlertTriangle size={15} />
                <span>{createError}</span>
              </div>
            )}

            <form
              onSubmit={handleCreate}
              aria-label={t("fees.createFormAria")}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: "1rem",
                alignItems: "end",
              }}
            >
              {/* Class */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="fee-className">
                  {t("fees.classLabel")} <span aria-hidden="true" style={{ color: "var(--danger)" }}>*</span>
                </label>
                <select
                  id="fee-className"
                  name="className"
                  value={form.className}
                  onChange={handleFormChange}
                  required
                  disabled={creating}
                  className="form-input"
                  aria-required="true"
                >
                  <option value="">{t("fees.selectClass")}</option>
                  {classOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Fee Amount */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="fee-feeAmount">
                  {t("fees.feeAmountLabel")}{" "}
                  <span aria-hidden="true" style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  id="fee-feeAmount"
                  name="feeAmount"
                  type="number"
                  min="0.0000001"
                  step="any"
                  placeholder={t("fees.feePlaceholder")}
                  value={form.feeAmount}
                  onChange={handleFormChange}
                  required
                  disabled={creating}
                  className="form-input"
                  aria-required="true"
                />
              </div>

              {/* Academic Year */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="fee-academicYear">
                  {t("fees.academicYearLabel")}
                </label>
                <input
                  id="fee-academicYear"
                  name="academicYear"
                  type="text"
                  placeholder={new Date().getUTCFullYear().toString()}
                  value={form.academicYear}
                  onChange={handleFormChange}
                  disabled={creating}
                  className="form-input"
                />
              </div>

              {/* Description */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="fee-description">
                  {t("fees.descriptionLabel")}
                </label>
                <input
                  id="fee-description"
                  name="description"
                  type="text"
                  placeholder={t("fees.descriptionPlaceholder")}
                  value={form.description}
                  onChange={handleFormChange}
                  disabled={creating}
                  className="form-input"
                />
              </div>

              <label>
                Active from (UTC)
                <input className="form-input" type="date" name="activeFrom" value={form.activeFrom} onChange={handleFormChange} />
              </label>
              <label>
                Active until (UTC)
                <input className="form-input" type="date" name="activeTo" value={form.activeTo} onChange={handleFormChange} />
              </label>
              <label>
                <input type="checkbox" name="isActive" checked={form.isActive} onChange={handleFormChange} /> Enabled
              </label>
              {editing && (
                <button className="btn btn-ghost" type="button" onClick={() => { setEditing(null); setForm(EMPTY_FORM); }}>
                  Cancel edit
                </button>
              )}

              {/* Submit */}
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button
                  type="submit"
                  disabled={creating}
                  className="btn btn-primary"
                  style={{ width: "100%" }}
                  aria-busy={creating}
                >
                  {creating ? t("fees.creating") : editing ? "Save changes" : t("fees.create")}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* ── Alerts ───────────────────────────────────────────────────────── */}
        {error && (
          <div role="alert" className="alert alert-danger" style={{ marginBottom: "1rem" }}>
            <IconAlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}
        {deleteError && (
          <div role="alert" className="alert alert-danger" style={{ marginBottom: "1rem" }}>
            <IconAlertTriangle size={15} />
            <span>{deleteError}</span>
          </div>
        )}

        <label>
          Preview active fees on (UTC)
          <input className="form-input" type="date" value={previewDate} onChange={(event) => {
            const date = event.target.value;
            setPreviewDate(date);
            loadFees(1, date);
          }} />
        </label>

        {/* ── Fee table ────────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t("fees.existingTitle")}</div>
            {!loading && (
              <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                {t("fees.count", { count: pagination.total })}
              </span>
            )}
          </div>

          {loading ? (
            <div className="card-body"><SkeletonTable columns={[90, 90, 100, "100%", 36]} rows={5} /></div>
          ) : fees.length === 0 ? (
            <div className="card-body">
              <EmptyState
                variant="onboarding"
                title={t("fees.empty")}
                description={t("fees.emptyDesc")}
              />
            </div>
          ) : (
            <>
            <div style={{ overflowX: "auto" }}>
              <table
                className="data-table"
                aria-label={t("fees.tableAria")}
              >
                <thead>
                  <tr>
                    <th scope="col">{t("fees.colClass")}</th>
                    <th scope="col">{t("fees.colFeeAmount")}</th>
                    <th scope="col">{t("fees.colAcademicYear")}</th>
                    <th scope="col">{t("fees.colDescription")}</th>
                    <th scope="col">
                      <span className="sr-only">{t("fees.colActions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fees.map((fee) => (
                    <tr key={fee.className}>
                      <td className="col-mono">{fee.className}</td>
                      <td>
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>
                          {fee.feeAmount}
                        </span>
                        <span
                          style={{
                            marginLeft: "0.3rem",
                            fontSize: "0.72rem",
                            color: "var(--text-muted)",
                            fontWeight: 600,
                          }}
                        >
                          XLM
                        </span>
                      </td>
                      <td>{fee.academicYear || "—"}</td>
                      <td style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                        {fee.description || "—"}
                      </td>
                      <td>
                        {fee._id && (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => showPaymentQr(fee)} aria-label={`Payment QR for ${fee.className}`}>
                            Payment QR
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteClick(fee)}
                          className="btn btn-sm btn-ghost"
                          style={{ color: "var(--danger, #dc2626)" }}
                          aria-label={t("fees.deleteForClass", { className: fee.className })}
                        >
                          {t("actions.delete")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination.totalPages > 1 && (
              <AccessiblePagination
                currentPage={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={(p) => loadFees(p)}
                total={pagination.total}
                rangeStart={(pagination.page - 1) * pagination.limit + 1}
                rangeEnd={Math.min(pagination.page * pagination.limit, pagination.total)}
                loading={loading}
                ariaLabel={t("fees.title")}
                itemLabel={t("fees.title")}
              />
            )}
            </>
          )}
        </div>
      </div>

      {/* ── Delete confirmation dialog — Issue #108 ──────────────────────── */}
      {pendingDelete && (
        <ConfirmDialog
          isOpen={Boolean(pendingDelete)}
          title={t("fees.deleteTitle")}
          description={
            `${t("fees.deleteIntro")} ${pendingDelete.fee.className}.` +
            ` ${t("fees.deleteCannotUndo")}`
          }
          confirmLabel={t("actions.delete")}
          variant="danger"
          requireTyping={pendingDelete.fee.className}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
