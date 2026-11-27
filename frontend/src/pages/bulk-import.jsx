import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import PageHero from "../components/PageHero";
import { IconCheck, IconAlertTriangle, IconDownload, IconX } from "../components/Icons";
import { bulkImportStudents } from "../services/api";

// Required CSV columns — must match what the backend validates
const REQUIRED_HEADERS = ["studentId", "name", "class"];

// Match the server-side default from streamingCsvUpload.js (CSV_MAX_SIZE_BYTES, default 5 MB)
const MAX_FILE_SIZE = parseInt(
  process.env.NEXT_PUBLIC_CSV_MAX_SIZE_BYTES || "5242880",
  10
);

/**
 * Build an error-annotated CSV from the original parsed rows and the
 * details array returned by the bulk import API.  Only failed rows are
 * included; each row gets an extra `error_message` column.
 */
function buildErrorCsv(parsedRows, details) {
  const failed = details.filter((d) => d.status !== "created");
  if (!failed.length) return null;

  const headers = parsedRows.length > 0 ? Object.keys(parsedRows[0]) : [];
  const allHeaders = [...headers, "error_message"];

  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const lines = [allHeaders.map(escape).join(",")];
  failed.forEach((d) => {
    // d.row is 1-based with row 1 = header, so data index = d.row - 2
    const original = parsedRows[d.row - 2] || {};
    const values = headers.map((h) => escape(original[h] ?? ""));
    values.push(escape(d.error || "Unknown error"));
    lines.push(values.join(","));
  });

  return lines.join("\n");
}

export default function BulkImportPage() {
  const { t } = useTranslation();

  const [dragOver, setDragOver]       = useState(false);
  const [file, setFile]               = useState(null);
  const [headerError, setHeaderError] = useState(null);
  const [sizeError, setSizeError]     = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [progress, setProgress]       = useState(0);
  const [result, setResult]           = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [parsedRows, setParsedRows]   = useState([]);

  const abortRef    = useRef(null);
  const fileInputRef = useRef(null);

  // ── File validation ────────────────────────────────────────────────────────

  const validateAndSetFile = useCallback((f) => {
    setHeaderError(null);
    setSizeError(null);
    setResult(null);
    setUploadError(null);
    setFile(null);
    setParsedRows([]);

    if (!f) return;

    if (f.size > MAX_FILE_SIZE) {
      setSizeError(
        `File is ${(f.size / 1024 / 1024).toFixed(1)} MB — maximum is ${(
          MAX_FILE_SIZE /
          1024 /
          1024
        ).toFixed(0)} MB.`
      );
      return;
    }

    // Read just enough to validate headers and parse rows for the error report
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const firstLine = lines[0] || "";
      const headers = firstLine
        .split(",")
        .map((h) => h.trim().replace(/^"|"$/g, "").trim());

      const missing = REQUIRED_HEADERS.filter((r) => !headers.includes(r));
      if (missing.length > 0) {
        setHeaderError(
          `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Required: ${REQUIRED_HEADERS.join(", ")}.`
        );
        return;
      }

      // Pre-parse rows so we can annotate the error report CSV later
      const rows = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        const row = {};
        headers.forEach((h, i) => {
          row[h] = values[i] ?? "";
        });
        return row;
      });

      setParsedRows(rows);
      setFile(f);
    };
    // Read first 64 KB — enough to parse headers and a reasonable chunk of rows
    reader.readAsText(f.slice(0, 65536));
    // Keep a reference to the full file for the actual upload
    setFile(f);
  }, []);

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) validateAndSetFile(f);
    },
    [validateAndSetFile]
  );

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f) validateAndSetFile(f);
  };

  // ── Upload ─────────────────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!file || headerError || sizeError) return;

    setUploading(true);
    setProgress(0);
    setResult(null);
    setUploadError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const { data } = await bulkImportStudents(formData, {
        onUploadProgress: (evt) => {
          if (evt.total) {
            setProgress(Math.round((evt.loaded / evt.total) * 100));
          }
        },
        signal: controller.signal,
      });
      setResult(data);
      setProgress(100);
    } catch (err) {
      const isCancelled =
        err.name === "CanceledError" ||
        err.name === "AbortError" ||
        err.code === "ERR_CANCELED";
      setUploadError(
        isCancelled
          ? "Upload cancelled."
          : err.response?.data?.error || err.message || "Upload failed. Please try again."
      );
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  // ── Error report download ──────────────────────────────────────────────────

  const handleDownloadErrors = () => {
    if (!result?.details) return;
    const csv = buildErrorCsv(parsedRows, result.details);
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-errors.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setFile(null);
    setHeaderError(null);
    setSizeError(null);
    setResult(null);
    setUploadError(null);
    setProgress(0);
    setParsedRows([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const failedRows = result?.details?.filter((d) => d.status !== "created") ?? [];
  const hasErrors  = failedRows.length > 0;
  const canUpload  = file && !headerError && !sizeError && !uploading;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <PageHero
        eyebrow="Students"
        title="Bulk Import"
        subtitle="Upload a CSV file to import multiple students at once."
      />

      <div className="page-wrap">

        {/* ── Upload card ─────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="card-header">
            <div className="card-title">Upload CSV File</div>
          </div>
          <div className="card-body">

            {/* Drop zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (!uploading && (e.key === "Enter" || e.key === " ")) {
                  fileInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Drop a CSV file here or press Enter to browse"
              style={{
                border: `2px dashed ${
                  dragOver
                    ? "var(--grad-brand, #059669)"
                    : "var(--border, #e7e9f3)"
                }`,
                borderRadius: 8,
                padding: "2.5rem 1rem",
                textAlign: "center",
                cursor: uploading ? "not-allowed" : "pointer",
                background: dragOver
                  ? "rgba(5,150,105,0.05)"
                  : "var(--card-bg, #fff)",
                transition: "border-color 0.15s, background 0.15s",
                marginBottom: "1rem",
                userSelect: "none",
              }}
            >
              <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📁</div>
              {file ? (
                <p style={{ margin: 0, fontWeight: 600 }}>{file.name}</p>
              ) : (
                <>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    Drag &amp; drop a CSV file here
                  </p>
                  <p
                    style={{
                      margin: "0.25rem 0 0",
                      fontSize: "0.875rem",
                      color: "var(--text-muted, #64748b)",
                    }}
                  >
                    or click to browse — max{" "}
                    {(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB
                  </p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={handleFileChange}
                disabled={uploading}
              />
            </div>

            {/* Required columns hint */}
            <p
              style={{
                fontSize: "0.8125rem",
                color: "var(--text-muted, #64748b)",
                margin: "0 0 1rem",
              }}
            >
              Required columns:{" "}
              {REQUIRED_HEADERS.map((h, i) => (
                <span key={h}>
                  <code>{h}</code>
                  {i < REQUIRED_HEADERS.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>

            {/* Validation errors */}
            {(headerError || sizeError) && (
              <div
                role="alert"
                className="alert alert-danger"
                style={{ marginBottom: "1rem" }}
              >
                <IconAlertTriangle size={15} />
                <span>{headerError || sizeError}</span>
              </div>
            )}

            {/* Upload error */}
            {uploadError && (
              <div
                role="alert"
                className="alert alert-danger"
                style={{ marginBottom: "1rem" }}
              >
                <IconAlertTriangle size={15} />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Progress bar */}
            {uploading && (
              <div style={{ marginBottom: "1rem" }}>
                <div
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Upload progress"
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: "var(--border, #e7e9f3)",
                    overflow: "hidden",
                    marginBottom: "0.4rem",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${progress}%`,
                      background: "var(--grad-brand, #059669)",
                      transition: "width 0.2s ease",
                      borderRadius: 4,
                    }}
                  />
                </div>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text-muted)",
                    margin: 0,
                  }}
                >
                  Uploading… {progress}%
                </p>
              </div>
            )}

            {/* Result summary */}
            {result && !uploading && (
              <div
                role="status"
                aria-live="polite"
                className={`alert ${hasErrors ? "alert-danger" : "alert-success"}`}
                style={{ marginBottom: "1rem" }}
              >
                <IconCheck size={15} />
                <span>
                  Import complete: <strong>{result.created ?? 0}</strong> imported,{" "}
                  <strong>{result.failed ?? 0}</strong> failed
                  {result.total ? ` out of ${result.total} rows` : ""}.
                </span>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={!canUpload}
                aria-busy={uploading}
              >
                {uploading ? "Uploading…" : "Upload CSV"}
              </button>

              {uploading && (
                <button
                  className="btn btn-ghost"
                  onClick={handleCancel}
                  style={{ color: "var(--danger, #dc2626)" }}
                >
                  <IconX size={14} />
                  {" "}Cancel
                </button>
              )}

              {result && hasErrors && !uploading && (
                <button className="btn btn-ghost" onClick={handleDownloadErrors}>
                  <IconDownload size={14} />
                  {" "}Download Error Report
                </button>
              )}

              {(file || result) && !uploading && (
                <button className="btn btn-ghost" onClick={handleReset}>
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Error detail table ───────────────────────────────────────────── */}
        {result && hasErrors && (
          <div className="card">
            <div className="card-header">
              <div
                className="card-title"
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <IconAlertTriangle size={15} />
                Failed Rows ({failedRows.length})
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table
                className="data-table"
                aria-label="Import error details"
              >
                <thead>
                  <tr>
                    <th scope="col">CSV Row</th>
                    <th scope="col">Student ID</th>
                    <th scope="col">Error</th>
                    <th scope="col">Code</th>
                  </tr>
                </thead>
                <tbody>
                  {failedRows.map((d, i) => (
                    <tr key={i}>
                      <td>{d.row}</td>
                      <td className="col-mono">{d.studentId || "—"}</td>
                      <td
                        style={{
                          color: "var(--danger, #dc2626)",
                          fontSize: "0.875rem",
                        }}
                      >
                        {d.error}
                      </td>
                      <td>
                        <code style={{ fontSize: "0.75rem" }}>{d.code}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
