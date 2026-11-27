import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import RequireAdmin from "../components/RequireAdmin";
import ErrorBoundary from "../components/ErrorBoundary";
import { getStudents, getSchool } from "../services/api";
import { DEFAULT_CLASS_OPTIONS, loadSchoolClassOptions } from "../utils/classOptions";
import {
  IconSearch, IconChevronLeft, IconChevronRight, IconAlertTriangle,
} from "../components/Icons";

const PAGE_SIZE = 20;
const MAX_BULK_SELECT = 500;

const STATUS_BADGE = {
  paid:    { cls: "badge badge-success", label: "Paid" },
  partial: { cls: "badge badge-warning", label: "Partial" },
  unpaid:  { cls: "badge badge-danger",  label: "Unpaid" },
};

function StudentListPage() {
  const router = useRouter();
  const { query } = router;

  // ── State ──────────────────────────────────────────────────────────────────
  const [search, setSearch]               = useState("");
  const [statusFilter, setStatusFilter]   = useState("all");
  const [classFilter, setClassFilter]     = useState("");
  const [page, setPage]                   = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [students, setStudents]           = useState([]);
  const [total, setTotal]                 = useState(0);
  const [pages, setPages]                 = useState(1);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [classOptions, setClassOptions]   = useState(DEFAULT_CLASS_OPTIONS);

  // Bulk select
  const [selectedIds, setSelectedIds]           = useState(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  const abortRef    = useRef(null);
  const debounceRef = useRef(null);
  const initialised = useRef(false);

  // ── Sync URL → state on first ready ───────────────────────────────────────
  useEffect(() => {
    if (!router.isReady || initialised.current) return;
    initialised.current = true;
    const q = router.query;
    if (q.search)  setSearch(q.search);
    if (q.search)  setDebouncedSearch(q.search);
    if (q.status)  setStatusFilter(q.status);
    if (q.class)   setClassFilter(q.class);
    if (q.page)    setPage(Number(q.page) || 1);
  }, [router.isReady, router.query]);

  // ── Debounce search input ──────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // ── Fetch students ─────────────────────────────────────────────────────────
  const fetchStudents = useCallback((p, srch, st, cls) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    setSelectAllMatching(false);

    getStudents(p, PAGE_SIZE, { search: srch, status: st, className: cls }, { signal: controller.signal })
      .then(({ data }) => {
        setStudents(data.students || []);
        setTotal(data.total || 0);
        setPages(data.pages || 1);
      })
      .catch((err) => {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setError("Failed to load students. Please try again.");
      })
      .finally(() => {
        if (abortRef.current === controller) setLoading(false);
      });
  }, []);

  // ── Re-fetch + push URL whenever filters/page change ──────────────────────
  useEffect(() => {
    if (!router.isReady) return;

    const q = {};
    if (debouncedSearch)                   q.search = debouncedSearch;
    if (statusFilter && statusFilter !== "all") q.status = statusFilter;
    if (classFilter)                       q.class  = classFilter;
    if (page > 1)                          q.page   = page;

    router.replace(
      { pathname: router.pathname, query: q },
      undefined,
      { shallow: true },
    );
    fetchStudents(page, debouncedSearch, statusFilter, classFilter);
  }, [page, debouncedSearch, statusFilter, classFilter, router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadSchoolClassOptions(getSchool, setClassOptions);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filter helpers ─────────────────────────────────────────────────────────
  function changeFilter(setter) {
    return (val) => { setter(val); setPage(1); };
  }

  // ── Bulk-select helpers ────────────────────────────────────────────────────
  const allPageSelected =
    students.length > 0 && students.every((s) => selectedIds.has(s.studentId));

  function toggleSelectAll() {
    if (allPageSelected) {
      setSelectedIds(new Set());
      setSelectAllMatching(false);
    } else {
      setSelectedIds(new Set(students.map((s) => s.studentId)));
    }
  }

  function toggleOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setSelectAllMatching(false);
  }

  const effectiveCount = selectAllMatching
    ? Math.min(total, MAX_BULK_SELECT)
    : selectedIds.size;

  function handleBulkAction(action) {
    if (!action || effectiveCount === 0) return;
    // Placeholder — real implementation would call backend APIs
    window.alert(`${action}: ${effectiveCount} student(s) selected`);
  }

  // ── Active filter chips ────────────────────────────────────────────────────
  const chips = [];
  if (debouncedSearch)
    chips.push({ key: "search", label: `"${debouncedSearch}"`,        clear: () => { setSearch(""); setPage(1); } });
  if (statusFilter !== "all")
    chips.push({ key: "status", label: `Status: ${statusFilter}`,     clear: () => changeFilter(setStatusFilter)("all") });
  if (classFilter)
    chips.push({ key: "class",  label: `Class: ${classFilter}`,       clear: () => changeFilter(setClassFilter)("") });

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd   = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <Head><title>Students | StellarEduPay</title></Head>
      <style>{`
        .students-page { animation: fadeUp 0.3s ease both; }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .students-heading { font-size: 1.5rem; font-weight: 700; color: var(--text); margin-bottom: 0.2rem; }
        .students-sub     { font-size: 0.875rem; color: var(--text-muted); margin-bottom: 1.25rem; }

        .students-toolbar {
          display: flex; align-items: center; gap: 0.625rem; flex-wrap: wrap;
          margin-bottom: 0.75rem;
        }
        .s-search-wrap    { position: relative; }
        .s-search-icon    {
          position: absolute; left: 0.65rem; top: 50%;
          transform: translateY(-50%); color: var(--text-muted);
          pointer-events: none; display: flex;
        }
        .s-search-input {
          padding: 0.4rem 0.75rem 0.4rem 2.1rem;
          border: 1.5px solid var(--border); border-radius: var(--radius-sm);
          font-size: 0.8125rem; font-family: inherit;
          color: var(--text); background: var(--card-bg); outline: none; width: 210px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .s-search-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-subtle);
        }
        .s-filter-select {
          padding: 0.4rem 0.7rem;
          border: 1.5px solid var(--border); border-radius: var(--radius-sm);
          font-size: 0.8125rem; font-family: inherit;
          color: var(--text); background: var(--card-bg); outline: none; cursor: pointer;
        }

        .filter-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.875rem; min-height: 0; }
        .chip {
          display: inline-flex; align-items: center; gap: 0.3rem;
          padding: 0.2rem 0.5rem 0.2rem 0.65rem;
          background: var(--accent-subtle); color: var(--accent);
          border-radius: 999px; font-size: 0.75rem; font-weight: 600;
          border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
        }
        .chip-remove {
          background: none; border: none; cursor: pointer; padding: 0;
          color: inherit; display: flex; align-items: center;
          opacity: 0.65; font-size: 0.85rem; line-height: 1;
        }
        .chip-remove:hover { opacity: 1; }

        .bulk-bar {
          display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
          margin-bottom: 0.875rem; padding: 0.5rem 0.875rem;
          background: var(--accent-subtle);
          border-radius: var(--radius-sm);
          border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
        }
        .bulk-label { font-size: 0.8125rem; font-weight: 600; color: var(--accent); flex: 1; }
        .bulk-match-btn {
          background: none; border: none; cursor: pointer; padding: 0;
          color: var(--accent); font-size: 0.8rem; text-decoration: underline;
          white-space: nowrap;
        }
        .bulk-action-select {
          padding: 0.3rem 0.6rem;
          border: 1.5px solid var(--accent); border-radius: var(--radius-sm);
          font-size: 0.8125rem; font-family: inherit;
          color: var(--accent); background: var(--card-bg); cursor: pointer;
        }
        .bulk-action-select:disabled { opacity: 0.4; cursor: not-allowed; }

        .cb-col { width: 36px; }
        input[type="checkbox"] { cursor: pointer; accent-color: var(--accent); width: 15px; height: 15px; }

        .skel-block {
          border-radius: 4px; background: var(--border);
          animation: skel-pulse 1.4s ease-in-out infinite;
        }
        @keyframes skel-pulse { 0%,100%{ opacity:1 } 50%{ opacity:0.5 } }
      `}</style>

      <div className="page-wrap students-page">
        <div className="students-heading">Students</div>
        <div className="students-sub">
          {!loading && `${total.toLocaleString()} student${total !== 1 ? "s" : ""}`}
        </div>

        {/* ── Toolbar ──────────────────────────────────────────── */}
        <div className="students-toolbar" role="search" aria-label="Filter students">
          <div className="s-search-wrap">
            <span className="s-search-icon"><IconSearch size={14} /></span>
            <input
              type="search"
              className="s-search-input"
              placeholder="Search name, ID, or class…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search students"
            />
          </div>
          <select
            className="s-filter-select"
            value={statusFilter}
            onChange={(e) => changeFilter(setStatusFilter)(e.target.value)}
            aria-label="Filter by payment status"
          >
            <option value="all">All statuses</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
          </select>
          <select
            className="s-filter-select"
            value={classFilter}
            onChange={(e) => changeFilter(setClassFilter)(e.target.value)}
            aria-label="Filter by class"
          >
            <option value="">All classes</option>
            {classOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* ── Active filter chips ───────────────────────────────── */}
        {chips.length > 0 && (
          <div className="filter-chips" aria-label="Active filters">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.label}
                <button
                  className="chip-remove"
                  onClick={chip.clear}
                  aria-label={`Remove ${chip.key} filter`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* ── Bulk action bar ───────────────────────────────────── */}
        {effectiveCount > 0 && (
          <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
            <span className="bulk-label">
              {selectAllMatching
                ? `All ${effectiveCount} matching students selected`
                : `${effectiveCount} student${effectiveCount !== 1 ? "s" : ""} selected`}
            </span>
            {allPageSelected && !selectAllMatching && total > students.length && (
              <button className="bulk-match-btn" onClick={() => setSelectAllMatching(true)}>
                Select all {Math.min(total, MAX_BULK_SELECT)} matching (up to {MAX_BULK_SELECT})
              </button>
            )}
            <select
              className="bulk-action-select"
              defaultValue=""
              onChange={(e) => { handleBulkAction(e.target.value); e.target.value = ""; }}
              aria-label="Bulk action"
              disabled={effectiveCount === 0}
            >
              <option value="" disabled>Bulk actions…</option>
              <option value="Send Reminder">Send Reminder</option>
              <option value="Export Selected">Export Selected</option>
              <option value="Assign Fee Plan">Assign Fee Plan</option>
            </select>
          </div>
        )}

        {/* ── Table card ────────────────────────────────────────── */}
        <div className="card">
          {error ? (
            <div className="card-body">
              <div role="alert" className="alert alert-danger">
                <IconAlertTriangle size={16} />
                <span style={{ flex: 1 }}>{error}</span>
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ color: "inherit", borderColor: "currentColor", opacity: 0.8 }}
                  onClick={() => fetchStudents(page, debouncedSearch, statusFilter, classFilter)}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <ErrorBoundary>
              <div style={{ overflowX: "auto" }} aria-busy={loading} aria-label="Student list">
                <table className="data-table" aria-label="Student list">
                  <thead>
                    <tr>
                      <th scope="col" className="cb-col">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={toggleSelectAll}
                          aria-label="Select all on page"
                          disabled={loading || students.length === 0}
                        />
                      </th>
                      <th scope="col">Student ID</th>
                      <th scope="col">Name</th>
                      <th scope="col">Class</th>
                      <th scope="col">Fee (XLM)</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} aria-hidden="true">
                          <td><div className="skel-block" style={{ height: 15, width: 15 }} /></td>
                          <td><div className="skel-block" style={{ height: 12, width: 72 }} /></td>
                          <td><div className="skel-block" style={{ height: 12, width: 130 }} /></td>
                          <td><div className="skel-block" style={{ height: 12, width: 44 }} /></td>
                          <td><div className="skel-block" style={{ height: 12, width: 56 }} /></td>
                          <td><div className="skel-block" style={{ height: 20, width: 52, borderRadius: 20 }} /></td>
                        </tr>
                      ))
                    ) : students.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <div className="empty-state">
                            <div className="empty-state-icon"><IconSearch size={26} /></div>
                            <div className="empty-state-title">No students found</div>
                            <div className="empty-state-desc">
                              {chips.length > 0
                                ? "Try adjusting or removing the active filters."
                                : "No students have been registered yet."}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : students.map((s) => {
                      const st    = (s.status || "unpaid").toLowerCase();
                      const badge = STATUS_BADGE[st] || STATUS_BADGE.unpaid;
                      const checked = selectedIds.has(s.studentId);
                      return (
                        <tr
                          key={s.studentId}
                          style={checked ? { background: "var(--accent-subtle)" } : {}}
                        >
                          <td className="cb-col">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOne(s.studentId)}
                              aria-label={`Select ${s.name}`}
                            />
                          </td>
                          <td className="col-mono">{s.studentId}</td>
                          <td style={{ fontWeight: 500 }}>{s.name}</td>
                          <td style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>{s.class}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>
                            {s.feeAmount}
                            <span style={{ marginLeft: "0.25rem", fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>XLM</span>
                          </td>
                          <td><span className={badge.cls}>{badge.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ErrorBoundary>
          )}

          {/* Pagination */}
          {total > 0 && (
            <div style={{
              padding: "0.875rem 1.25rem",
              borderTop: "1px solid var(--border)",
              display: "flex", alignItems: "center",
              justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem",
            }}>
              <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }} aria-live="polite" aria-atomic="true">
                {loading ? "Loading…" : `${rangeStart}–${rangeEnd} of ${total.toLocaleString()}`}
              </span>
              <nav className="pagination-controls" aria-label="Pagination">
                <button
                  className="page-btn"
                  disabled={page === 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                  aria-label="Previous page"
                  style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
                >
                  <IconChevronLeft size={15} /> Prev
                </button>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", padding: "0 0.25rem" }} aria-current="page">
                  {page} / {pages}
                </span>
                <button
                  className="page-btn"
                  disabled={page === pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                  style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
                >
                  Next <IconChevronRight size={15} />
                </button>
              </nav>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function StudentsPage() {
  return (
    <RequireAdmin>
      <StudentListPage />
    </RequireAdmin>
  );
}
