import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { useTranslation } from "react-i18next";
import { SkeletonTable } from "../components/Skeleton";
import { getFeeHistory } from "../services/api";

const PAGE_SIZES = [10, 25, 50];
const DEFAULT_LIMIT = 25;

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function formatAmount(amount) {
  if (amount == null) return "—";
  return Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function downloadCSV(rows, studentId) {
  const headers = ["Date", "Category", "Amount", "Paid", "Total Paid", "Remaining Balance", "Status"];
  const lines = [
    headers.join(","),
    ...rows.map((r) => [
      formatDate(r.archivedAt),
      `"${(r.category || "").replace(/"/g, '""')}"`,
      r.amount,
      r.paid ? "Yes" : "No",
      r.totalPaid ?? "",
      r.remainingBalance ?? "",
      r.paid ? "Paid" : "Unpaid",
    ].join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fee-history-${studentId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FeeHistoryPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { studentId, from, to, status: statusParam, page: pageParam, limit: limitParam } = router.query;

  const [history, setHistory] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [fromDate, setFromDate] = useState(from || "");
  const [toDate, setToDate] = useState(to || "");
  const [statusFilter, setStatusFilter] = useState(statusParam || "all");
  const [page, setPage] = useState(Number(pageParam) || 1);
  const [limit, setLimit] = useState(Number(limitParam) || DEFAULT_LIMIT);
  const [sortOrder, setSortOrder] = useState("desc");

  // Sync state from URL on mount/query change
  useEffect(() => {
    if (!router.isReady) return;
    setFromDate(from || "");
    setToDate(to || "");
    setStatusFilter(statusParam || "all");
    setPage(Number(pageParam) || 1);
    setLimit(Number(limitParam) || DEFAULT_LIMIT);
  }, [router.isReady, from, to, statusParam, pageParam, limitParam]);

  const fetchHistory = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit };
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;
      const { data } = await getFeeHistory(studentId, params);
      let rows = data.history || [];
      // Client-side sort by date
      rows = [...rows].sort((a, b) => {
        const da = new Date(a.archivedAt), db = new Date(b.archivedAt);
        return sortOrder === "desc" ? db - da : da - db;
      });
      setHistory(rows);
      setPagination(data.pagination);
    } catch (err) {
      setError("Failed to load fee history. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [studentId, page, limit, fromDate, toDate, statusFilter, sortOrder]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  function applyFilters(newFilters) {
    const q = { studentId, page: 1, limit };
    if (newFilters.fromDate) q.from = newFilters.fromDate;
    if (newFilters.toDate) q.to = newFilters.toDate;
    if (newFilters.statusFilter && newFilters.statusFilter !== "all") q.status = newFilters.statusFilter;
    router.push({ pathname: router.pathname, query: q }, undefined, { shallow: true });
  }

  function handleFilterChange(key, value) {
    const updates = { fromDate, toDate, statusFilter, [key]: value };
    if (key === "fromDate") setFromDate(value);
    if (key === "toDate") setToDate(value);
    if (key === "statusFilter") setStatusFilter(value);
    setPage(1);
    applyFilters(updates);
  }

  function handlePageChange(newPage) {
    setPage(newPage);
    router.push({ pathname: router.pathname, query: { ...router.query, page: newPage } }, undefined, { shallow: true });
  }

  function handleLimitChange(newLimit) {
    setLimit(newLimit);
    setPage(1);
    router.push({ pathname: router.pathname, query: { ...router.query, limit: newLimit, page: 1 } }, undefined, { shallow: true });
  }

  if (!studentId && router.isReady) {
    return (
      <div className="page-wrap">
        <div className="card">
          <p>No student ID provided. <a href="/dashboard">Go to Dashboard</a></p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Fee History {studentId ? `— ${studentId}` : ""} | StellarEduPay</title>
      </Head>

      <style>{`
        .fee-history-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          align-items: flex-end;
          margin-bottom: 1.25rem;
        }
        .fee-history-toolbar label {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-muted);
        }
        .fee-history-toolbar input,
        .fee-history-toolbar select {
          padding: 0.4rem 0.6rem;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--text);
          font-size: 0.875rem;
          min-height: 36px;
        }
        .fee-history-actions {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 1rem;
        }
        .sort-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 0.75rem;
          padding: 0 0.25rem;
        }
        .sort-btn:hover { color: var(--accent); }
        .pagination-row {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
          justify-content: space-between;
          margin-top: 1rem;
        }
        .pagination-controls {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .pagination-controls button {
          min-width: 44px;
          min-height: 44px;
          padding: 0 0.75rem;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--text);
          cursor: pointer;
          font-size: 0.875rem;
        }
        .pagination-controls button:disabled { opacity: 0.4; cursor: default; }
        .pagination-controls button:hover:not(:disabled) { background: var(--accent-subtle); }
        .empty-history {
          text-align: center;
          padding: 3rem 1rem;
          color: var(--text-muted);
        }
        .empty-history h3 { margin-bottom: 0.5rem; }
        .status-badge-paid {
          display: inline-flex; align-items: center; padding: 0.2rem 0.5rem;
          border-radius: 20px; font-size: 0.75rem; font-weight: 600;
          background: rgba(52,211,153,0.15); color: #34d399;
        }
        .status-badge-unpaid {
          display: inline-flex; align-items: center; padding: 0.2rem 0.5rem;
          border-radius: 20px; font-size: 0.75rem; font-weight: 600;
          background: rgba(239,68,68,0.15); color: #ef4444;
        }
      `}</style>

      <div className="page-wrap">
        <div className="page-header" style={{ marginBottom: "1.5rem" }}>
          <h1 className="page-title">
            Fee History
            {studentId && (
              <span style={{ fontFamily: "monospace", fontSize: "0.75em", marginLeft: "0.75rem", opacity: 0.6 }}>
                {studentId}
              </span>
            )}
          </h1>
          <p className="page-subtitle">Archived fee records for this student, newest first.</p>
        </div>

        <div className="card">
          {/* Filter toolbar */}
          <div className="fee-history-toolbar">
            <label>
              From date
              <input
                type="date"
                value={fromDate}
                onChange={(e) => handleFilterChange("fromDate", e.target.value)}
                aria-label="Filter from date"
              />
            </label>
            <label>
              To date
              <input
                type="date"
                value={toDate}
                onChange={(e) => handleFilterChange("toDate", e.target.value)}
                aria-label="Filter to date"
              />
            </label>
            <label>
              Status
              <select
                value={statusFilter}
                onChange={(e) => handleFilterChange("statusFilter", e.target.value)}
                aria-label="Filter by payment status"
              >
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </label>
            <label>
              Per page
              <select
                value={limit}
                onChange={(e) => handleLimitChange(Number(e.target.value))}
                aria-label="Rows per page"
              >
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="fee-history-actions">
            <button
              className="btn btn-secondary"
              onClick={() => downloadCSV(history, studentId)}
              disabled={loading || history.length === 0}
              aria-label="Export fee history as CSV"
            >
              ⬇ Export CSV
            </button>
            {pagination && (
              <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                {pagination.total === 0
                  ? "No records"
                  : `${((page - 1) * limit) + 1}–${Math.min(page * limit, pagination.total)} of ${pagination.total} entries`}
              </span>
            )}
          </div>

          {error && (
            <div className="alert alert-danger" role="alert">{error}</div>
          )}

          {loading ? (
            <SkeletonTable
              columns={[80, 120, 80, 50, 80, 100, 70]}
              rows={limit > 10 ? 10 : limit}
            />
          ) : history.length === 0 ? (
            <div className="empty-history" role="status">
              <h3>No fee history found</h3>
              <p>
                {fromDate || toDate || statusFilter !== "all"
                  ? "No records match the current filters. Try adjusting or clearing filters."
                  : "This student has no archived fee history yet."}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" aria-label="Fee history">
                <thead>
                  <tr>
                    <th>
                      Date
                      <button
                        className="sort-btn"
                        onClick={() => setSortOrder((o) => (o === "desc" ? "asc" : "desc"))}
                        aria-label={`Sort by date ${sortOrder === "desc" ? "ascending" : "descending"}`}
                      >
                        {sortOrder === "desc" ? " ↓" : " ↑"}
                      </button>
                    </th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Paid</th>
                    <th>Total Paid</th>
                    <th>Remaining</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, i) => (
                    <tr key={row._id || i}>
                      <td style={{ fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>
                        {formatDate(row.archivedAt)}
                      </td>
                      <td>{row.category || "—"}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{formatAmount(row.amount)}</td>
                      <td>{row.paid ? "✓" : "✗"}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>
                        {row.totalPaid != null ? formatAmount(row.totalPaid) : "—"}
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>
                        {row.remainingBalance != null ? formatAmount(row.remainingBalance) : "—"}
                      </td>
                      <td>
                        <span className={row.paid ? "status-badge-paid" : "status-badge-unpaid"}>
                          {row.paid ? "Paid" : "Unpaid"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="pagination-row">
              <div className="pagination-controls">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={!pagination.hasPrev}
                  aria-label="Previous page"
                >
                  ← Prev
                </button>
                <span style={{ fontSize: "0.875rem" }}>
                  Page {page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={!pagination.hasNext}
                  aria-label="Next page"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
