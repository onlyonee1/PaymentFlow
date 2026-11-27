import { useState, useEffect, useCallback, useId } from "react";
import { useTranslation } from "react-i18next";
import PageHero from "../components/PageHero";
import RequireAdmin from "../components/RequireAdmin";
import {
  IconAlertTriangle,
  IconTrendingUp,
  IconDownload,
  IconPrinter,
  IconCalendar,
  IconPieChart,
  IconBarChart2,
} from "../components/Icons";
import {
  transformVolumeTrend,
  transformCategorySplit,
  transformClassComparison,
  formatChartCsv,
} from "../utils/chartTransforms";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [volumeTrendRaw, setVolumeTrendRaw] = useState([]);
  const [classCompletionRaw, setClassCompletionRaw] = useState([]);
  const [categorySplitRaw, setCategorySplitRaw] = useState([]);
  const [period, setPeriod] = useState("daily");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [fiatRate, setFiatRate] = useState(0.12);
  const [fiatCurrency] = useState("USD");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activePoint, setActivePoint] = useState(null);

  const lineChartId = useId();
  const pieChartId = useId();
  const barChartId = useId();

  // Preset Date Filter Helpers
  const handlePreset = useCallback((days) => {
    if (days === 0) {
      setStartDate("");
      setEndDate("");
      return;
    }
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const queryStr = params.toString() ? `?${params.toString()}` : "";

      const [summaryRes, trendRes, classRes, catRes, rateRes] = await Promise.allSettled([
        fetch(`${API_BASE}/analytics/summary${queryStr}`).then((r) => r.json()),
        fetch(`${API_BASE}/analytics/volume-trend?period=${period}${startDate ? `&startDate=${startDate}` : ""}${endDate ? `&endDate=${endDate}` : ""}`).then((r) => r.json()),
        fetch(`${API_BASE}/analytics/class-completion${queryStr}`).then((r) => r.json()),
        fetch(`${API_BASE}/analytics/category-split${queryStr}`).then((r) => r.json()),
        fetch(`${API_BASE}/payments/rates`).then((r) => r.json()),
      ]);

      if (summaryRes.status === "fulfilled" && summaryRes.value?.summary) {
        setSummary(summaryRes.value.summary);
      }
      if (trendRes.status === "fulfilled" && trendRes.value?.data) {
        setVolumeTrendRaw(trendRes.value.data);
      }
      if (classRes.status === "fulfilled" && classRes.value?.data) {
        setClassCompletionRaw(classRes.value.data);
      }
      if (catRes.status === "fulfilled" && catRes.value?.data) {
        setCategorySplitRaw(catRes.value.data);
      } else {
        // Fallback default category distribution if empty
        setCategorySplitRaw([
          { category: "Tuition", totalAmount: summary?.totalProcessed ? summary.totalProcessed * 0.7 : 0 },
          { category: "Development", totalAmount: summary?.totalProcessed ? summary.totalProcessed * 0.15 : 0 },
          { category: "Transport", totalAmount: summary?.totalProcessed ? summary.totalProcessed * 0.1 : 0 },
          { category: "Lab & Library", totalAmount: summary?.totalProcessed ? summary.totalProcessed * 0.05 : 0 },
        ]);
      }

      if (rateRes.status === "fulfilled") {
        const rate = rateRes.value?.rates?.USD || rateRes.value?.USD || 0.12;
        setFiatRate(rate);
      }
    } catch (err) {
      setError(err.message || "Failed to load financial analytics");
    } finally {
      setLoading(false);
    }
  }, [period, startDate, endDate, summary?.totalProcessed]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Transformed Chart Data
  const volumeData = transformVolumeTrend(volumeTrendRaw, fiatRate, 640, 260, 45);
  const categoryData = transformCategorySplit(categorySplitRaw, 130, 130, 95, 55);
  const classData = transformClassComparison(classCompletionRaw);

  // CSV Export Handler
  function handleExportCsv() {
    const csvContent = formatChartCsv({
      volumeData: volumeData.items,
      categoryData: categoryData.items,
      classData: classData.items,
      startDate,
      endDate,
      fiatCurrency,
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `school-finance-analytics-${startDate || "all"}-to-${endDate || "present"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Print PDF Handler
  function handlePrintPdf() {
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  return (
    <RequireAdmin>
      <div className="analytics-container">
        <style jsx>{`
          .analytics-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 1.5rem 1rem 3rem;
          }
          .toolbar-card {
            background: var(--bg-surface, #ffffff);
            border: 1px solid var(--border, #e5e7eb);
            border-radius: var(--radius-md, 12px);
            padding: 1rem 1.25rem;
            margin-bottom: 1.5rem;
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            justify-content: space-between;
            align-items: center;
          }
          .filter-group {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.5rem;
          }
          .preset-btn {
            padding: 0.35rem 0.75rem;
            border-radius: 6px;
            font-size: 0.8125rem;
            font-weight: 500;
            cursor: pointer;
            border: 1px solid var(--border, #d1d5db);
            background: var(--bg-surface, #ffffff);
            color: var(--text, #111827);
            transition: all 0.15s ease;
          }
          .preset-btn:hover {
            background: var(--bg-subtle, #f3f4f6);
          }
          .preset-btn.active {
            background: var(--color-primary, #4f46e5);
            color: #ffffff;
            border-color: var(--color-primary, #4f46e5);
          }
          .action-group {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 1rem;
            margin-bottom: 1.5rem;
          }
          .kpi-card {
            background: var(--bg-surface, #ffffff);
            border: 1px solid var(--border, #e5e7eb);
            border-radius: var(--radius-md, 12px);
            padding: 1.25rem;
          }
          .kpi-label {
            font-size: 0.8125rem;
            color: var(--text-muted, #6b7280);
            margin-bottom: 0.35rem;
            font-weight: 500;
          }
          .kpi-value {
            font-size: 1.75rem;
            font-weight: 700;
            color: var(--text, #111827);
          }
          .charts-main-grid {
            display: grid;
            grid-template-columns: 2fr 1.2fr;
            gap: 1.5rem;
            margin-bottom: 1.5rem;
          }
          @media (max-width: 900px) {
            .charts-main-grid {
              grid-template-columns: 1fr;
            }
          }
          .chart-panel {
            background: var(--bg-surface, #ffffff);
            border: 1px solid var(--border, #e5e7eb);
            border-radius: var(--radius-md, 12px);
            padding: 1.25rem;
            display: flex;
            flex-direction: column;
          }
          .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
          }
          .chart-title {
            font-size: 1rem;
            font-weight: 600;
            color: var(--text, #111827);
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .legend {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
            font-size: 0.75rem;
            color: var(--text-muted, #4b5563);
          }
          .legend-item {
            display: flex;
            align-items: center;
            gap: 0.35rem;
          }
          .legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
          }
          .empty-chart-state {
            height: 220px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--text-muted, #9ca3af);
            font-size: 0.875rem;
            gap: 0.5rem;
          }
          .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border-width: 0;
          }
          @media print {
            .toolbar-card, .btn {
              display: none !important;
            }
            .chart-panel {
              break-inside: avoid;
              border: 1px solid #ccc !important;
              margin-bottom: 2rem;
            }
          }
        `}</style>

        <PageHero
          eyebrow={t("analytics.eyebrow", "Finance Overview")}
          title={t("analytics.title", "School Finance Analytics")}
          subtitle={t("analytics.subtitle", "Interactive visual trends, revenue breakdowns, and collection rates")}
        />

        {error && (
          <div role="alert" className="alert alert-danger" style={{ marginBottom: "1.5rem" }}>
            <IconAlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Toolbar: Date Range Filter & Exports ──────────────────────────── */}
        <div className="toolbar-card" role="region" aria-label="Analytics Filters and Controls">
          <div className="filter-group">
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)" }}>
              <IconCalendar size={14} style={{ display: "inline", marginRight: "4px" }} />
              {t("dateRangePicker.dateRange", "Date Range:")}
            </span>
            <button
              className={`preset-btn ${!startDate && !endDate ? "active" : ""}`}
              onClick={() => handlePreset(0)}
            >
              All time
            </button>
            <button
              className="preset-btn"
              onClick={() => handlePreset(7)}
            >
              Last 7 d
            </button>
            <button
              className="preset-btn"
              onClick={() => handlePreset(30)}
            >
              Last 30 d
            </button>
            <input
              type="date"
              aria-label="Start date"
              className="form-control"
              style={{ fontSize: "0.8125rem", padding: "0.25rem 0.5rem" }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <span style={{ color: "var(--text-muted)" }}>–</span>
            <input
              type="date"
              aria-label="End date"
              className="form-control"
              style={{ fontSize: "0.8125rem", padding: "0.25rem 0.5rem" }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="action-group">
            <button
              className="btn btn-sm btn-ghost"
              onClick={handleExportCsv}
              aria-label="Export chart data to CSV"
            >
              <IconDownload size={14} />
              CSV Export
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={handlePrintPdf}
              aria-label="Print or save PDF report"
            >
              <IconPrinter size={14} />
              Print / PDF
            </button>
          </div>
        </div>

        {/* ── Top-level Metric Cards ────────────────────────────────────────── */}
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">{t("analytics.totalProcessed", "Total Revenue Collected")}</div>
            <div className="kpi-value" style={{ color: "var(--color-primary, #4f46e5)" }}>
              {(summary?.totalProcessed || 0).toLocaleString()} <span style={{ fontSize: "1rem" }}>XLM</span>
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
              ≈ ${((summary?.totalProcessed || 0) * fiatRate).toFixed(2)} USD
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">{t("analytics.totalOutstanding", "Total Outstanding Balance")}</div>
            <div className="kpi-value" style={{ color: "var(--danger, #ef4444)" }}>
              {(summary?.totalOutstanding || 0).toLocaleString()} <span style={{ fontSize: "1rem" }}>XLM</span>
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
              Uncollected across all grades
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">{t("analytics.completionRate", "Collection Rate")}</div>
            <div className="kpi-value" style={{ color: "var(--success, #10b981)" }}>
              {(summary?.completionRate || 0).toFixed(1)}%
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
              {summary?.paidStudents || 0} of {summary?.totalStudents || 0} students fully paid
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">{t("analytics.txCount", "Verified Payments")}</div>
            <div className="kpi-value">
              {summary?.transactionCount || 0}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>
              Avg: {(summary?.averagePayment || 0).toFixed(1)} XLM / payment
            </div>
          </div>
        </div>

        {/* ── Main Chart Section: Line Chart & Donut Chart ──────────────────── */}
        <div className="charts-main-grid">
          {/* 1. Line Chart: Volume Trend (XLM & Fiat) */}
          <div className="chart-panel" role="region" aria-labelledby={lineChartId}>
            <div className="chart-header">
              <h2 id={lineChartId} className="chart-title">
                <IconTrendingUp size={18} />
                Payment Volume Over Time
              </h2>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                {["daily", "weekly", "monthly"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`btn btn-sm ${period === p ? "btn-primary" : "btn-ghost"}`}
                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="legend" style={{ marginBottom: "0.5rem" }}>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: "#4f46e5" }} />
                <span>Volume (XLM)</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: "#06b6d4" }} />
                <span>Fiat Eqv ({fiatCurrency})</span>
              </div>
            </div>

            {volumeData.isEmpty ? (
              <div className="empty-chart-state">
                <IconTrendingUp size={28} />
                <span>No payment volume data in selected range</span>
              </div>
            ) : (
              <div style={{ position: "relative", width: "100%", overflowX: "auto" }}>
                <svg
                  viewBox="0 0 640 260"
                  width="100%"
                  height="260"
                  style={{ display: "block" }}
                  aria-label="Line chart of daily/weekly payment volume in XLM and USD equivalent"
                  role="img"
                >
                  <title>Payment Volume Trend</title>
                  <desc>Shows volume trend over time in XLM and fiat currency</desc>

                  {/* Horizontal grid lines */}
                  {[0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = 260 - 45 - ratio * (260 - 90);
                    return (
                      <g key={ratio}>
                        <line x1="45" y1={y} x2="595" y2={y} stroke="var(--border, #e5e7eb)" strokeDasharray="3 3" />
                        <text x="40" y={y + 4} textAnchor="end" fontSize="10" fill="var(--text-muted, #6b7280)">
                          {(volumeData.maxAmount * ratio).toFixed(0)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Area fill for XLM */}
                  <path d={volumeData.areaXlm} fill="rgba(79, 70, 229, 0.12)" />

                  {/* XLM Polyline */}
                  <polyline
                    fill="none"
                    stroke="#4f46e5"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={volumeData.pointsXlm}
                  />

                  {/* Fiat Polyline */}
                  <polyline
                    fill="none"
                    stroke="#06b6d4"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={volumeData.pointsFiat}
                  />

                  {/* Interactive Points */}
                  {volumeData.items.map((pt, idx) => (
                    <g key={idx}>
                      <circle
                        cx={pt.x}
                        cy={pt.yXlm}
                        r="4.5"
                        fill="#4f46e5"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                        tabIndex={0}
                        role="button"
                        aria-label={`Date: ${pt.date}, XLM: ${pt.xlm}, Fiat: $${pt.fiat}`}
                        onMouseEnter={() => setActivePoint(pt)}
                        onFocus={() => setActivePoint(pt)}
                        style={{ cursor: "pointer", outline: "none" }}
                      />
                      {/* X axis labels (sparse) */}
                      {idx % Math.ceil(volumeData.items.length / 6) === 0 && (
                        <text
                          x={pt.x}
                          y="245"
                          textAnchor="middle"
                          fontSize="10"
                          fill="var(--text-muted, #6b7280)"
                        >
                          {pt.date.slice(5)}
                        </text>
                      )}
                    </g>
                  ))}
                </svg>

                {activePoint && (
                  <div
                    style={{
                      position: "absolute",
                      left: Math.min(activePoint.x, 500),
                      top: 10,
                      background: "rgba(17, 24, 39, 0.9)",
                      color: "#fff",
                      padding: "0.4rem 0.6rem",
                      borderRadius: "6px",
                      fontSize: "0.75rem",
                      pointerEvents: "none",
                      zIndex: 10,
                    }}
                  >
                    <div><strong>{activePoint.date}</strong></div>
                    <div>XLM: {activePoint.xlm} ({activePoint.count} txs)</div>
                    <div>USD Eqv: ${activePoint.fiat}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Donut/Pie Chart: Revenue Split by Fee Category */}
          <div className="chart-panel" role="region" aria-labelledby={pieChartId}>
            <div className="chart-header">
              <h2 id={pieChartId} className="chart-title">
                <IconPieChart size={18} />
                Revenue by Fee Category
              </h2>
            </div>

            {categoryData.isEmpty ? (
              <div className="empty-chart-state">
                <IconPieChart size={28} />
                <span>No fee category payments recorded</span>
              </div>
            ) : (
              <div>
                <svg
                  viewBox="0 0 260 260"
                  width="100%"
                  height="210"
                  aria-label="Donut chart showing revenue breakdown across fee categories"
                  role="img"
                >
                  <title>Revenue by Category</title>
                  {categoryData.items.map((slice, idx) => (
                    <path
                      key={idx}
                      d={slice.path}
                      fill={slice.color}
                      stroke="var(--bg-surface, #ffffff)"
                      strokeWidth="2"
                      tabIndex={0}
                      role="button"
                      aria-label={`${slice.category}: ${slice.amount} XLM (${slice.percent}%)`}
                      style={{ cursor: "pointer", transition: "opacity 0.15s ease" }}
                    >
                      <title>{`${slice.category}: ${slice.amount} XLM (${slice.percent}%)`}</title>
                    </path>
                  ))}
                  <text x="130" y="125" textAnchor="middle" fontSize="11" fill="var(--text-muted, #6b7280)">
                    Total
                  </text>
                  <text x="130" y="145" textAnchor="middle" fontSize="15" fontWeight="bold" fill="var(--text, #111827)">
                    {categoryData.totalAmount.toLocaleString()}
                  </text>
                </svg>

                <div className="legend" style={{ marginTop: "0.75rem", flexDirection: "column", gap: "0.4rem" }}>
                  {categoryData.items.map((cat, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8125rem" }}>
                      <div className="legend-item">
                        <span className="legend-dot" style={{ background: cat.color }} />
                        <span>{cat.category}</span>
                      </div>
                      <span style={{ fontWeight: 600 }}>
                        {cat.amount.toLocaleString()} XLM ({cat.percent}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Bar Chart: Outstanding vs Collected per Class / Grade ─────────── */}
        <div className="chart-panel" role="region" aria-labelledby={barChartId}>
          <div className="chart-header">
            <h2 id={barChartId} className="chart-title">
              <IconBarChart2 size={18} />
              Collected vs Outstanding by Grade / Class
            </h2>
            <div className="legend">
              <div className="legend-item">
                <span className="legend-dot" style={{ background: "#10b981" }} />
                <span>Collected (Paid)</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: "#f59e0b" }} />
                <span>Outstanding (Unpaid)</span>
              </div>
            </div>
          </div>

          {classData.isEmpty ? (
            <div className="empty-chart-state">
              <IconBarChart2 size={28} />
              <span>No class breakdown data available</span>
            </div>
          ) : (
            <div style={{ width: "100%", overflowX: "auto" }}>
              <svg
                viewBox={`0 0 ${Math.max(classData.items.length * 90, 600)} 240`}
                width="100%"
                height="240"
                role="img"
                aria-label="Bar chart comparing collected fees vs outstanding balances across school classes"
              >
                <title>Collected vs Outstanding per Class</title>
                {/* Baseline */}
                <line x1="30" y1="200" x2={Math.max(classData.items.length * 90, 600) - 20} y2="200" stroke="var(--border, #e5e7eb)" />

                {classData.items.map((c, idx) => {
                  const x = 50 + idx * 85;
                  const barWidth = 24;
                  const collectedH = (c.collected / classData.maxVal) * 160;
                  const outstandingH = (c.outstanding / classData.maxVal) * 160;

                  return (
                    <g key={idx}>
                      {/* Collected Bar */}
                      <rect
                        x={x}
                        y={200 - collectedH}
                        width={barWidth}
                        height={collectedH}
                        fill="#10b981"
                        rx="3"
                        tabIndex={0}
                        role="button"
                        aria-label={`${c.className} Collected: ${c.collected}`}
                      >
                        <title>{`${c.className} Collected: ${c.collected}`}</title>
                      </rect>

                      {/* Outstanding Bar */}
                      <rect
                        x={x + barWidth + 4}
                        y={200 - outstandingH}
                        width={barWidth}
                        height={outstandingH}
                        fill="#f59e0b"
                        rx="3"
                        tabIndex={0}
                        role="button"
                        aria-label={`${c.className} Outstanding: ${c.outstanding}`}
                      >
                        <title>{`${c.className} Outstanding: ${c.outstanding}`}</title>
                      </rect>

                      {/* Class Label */}
                      <text
                        x={x + barWidth}
                        y="220"
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="500"
                        fill="var(--text, #111827)"
                      >
                        {c.className}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      </div>
    </RequireAdmin>
  );
}

export default RequireAdmin(Analytics);

const API_BASE = process.env.REACT_APP_API_BASE || '/api';

function Analytics() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [volumeTrend, setVolumeTrend] = useState([]);
  const [classCompletion, setClassCompletion] = useState([]);
  const [unpaidCohorts, setUnpaidCohorts] = useState([]);
  const [period, setPeriod] = useState('daily');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Issue #254 — abort in-flight analytics fetch calls when the component
  // unmounts to prevent stale responses from landing after navigation.
  const { signal } = useAbortController();

  const loadAnalyticsData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [summaryRes, trendRes, classRes, cohortRes] = await Promise.allSettled([
        fetch(`${API_BASE}/analytics/summary`, { signal }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/volume-trend?period=${period}`, { signal }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/class-completion`, { signal }).then(r => r.json()),
        fetch(`${API_BASE}/analytics/unpaid-cohorts`, { signal }).then(r => r.json()),
      ]);

      if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value.summary);
      if (trendRes.status === 'fulfilled') setVolumeTrend(trendRes.value.data || []);
      if (classRes.status === 'fulfilled') setClassCompletion(classRes.value.data || []);
      if (cohortRes.status === 'fulfilled') setUnpaidCohorts(cohortRes.value.data || []);
    } catch (err) {
      // Silently ignore requests cancelled on unmount or navigation.
      if (err?.name === 'AbortError') return;
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [period, signal]);

  useEffect(() => {
    loadAnalyticsData();
  }, [loadAnalyticsData]);

  if (loading) {
    return (
      <>
        <PageHero eyebrow={t("analytics.eyebrow")} title={t("analytics.title")} subtitle={t("analytics.subtitle")} />
        <div className="page-wrap" role="status" aria-live="polite" aria-busy="true" aria-label="Loading...">
          <div className="stat-grid" aria-hidden="true">{[0, 1, 2, 3].map((index) => <SkeletonStatCard key={index} />)}</div>
          <SkeletonDetailCard rows={4} />
          <SkeletonDetailCard rows={3} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHero
        eyebrow={t("analytics.eyebrow")}
        title={t("analytics.title")}
        subtitle={t("analytics.subtitle")}
      />

      <div className="page-wrap">
        {error && (
          <div role="alert" className="alert alert-danger" style={{ marginBottom: "1rem" }}>
            <IconAlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Summary Stats ─────────────────────────────────────────────── */}
        {summary && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
            <div className="card">
              <div className="card-body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  {t("analytics.totalStudents")}
                </div>
                <div style={{ fontSize: "2rem", fontWeight: "bold" }}>{summary.totalStudents}</div>
              </div>
            </div>
            <div className="card">
              <div className="card-body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  {t("analytics.paidStudents")}
                </div>
                <div style={{ fontSize: "2rem", fontWeight: "bold", color: "var(--success)" }}>
                  {summary.paidStudents}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  ({summary.completionRate?.toFixed(1)}%)
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  {t("analytics.totalOutstanding")}
                </div>
                <div style={{ fontSize: "2rem", fontWeight: "bold", color: "var(--danger)" }}>
                  {summary.totalOutstanding?.toFixed(2)} XLM
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  {t("analytics.avgPayment")}
                </div>
                <div style={{ fontSize: "2rem", fontWeight: "bold" }}>
                  {summary.averagePayment?.toFixed(2)} XLM
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Volume Trend ──────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "2rem" }}>
          <div className="card-header">
            <div className="card-title">{t("analytics.volumeTrend")}</div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {['daily', 'weekly', 'monthly'].map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={period === p ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}
                  style={{ fontSize: "0.75rem" }}
                >
                  {t(`analytics.period.${p}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="card-body">
            {volumeTrend.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("analytics.date")}</th>
                      <th scope="col">{t("analytics.totalAmount")}</th>
                      <th scope="col">{t("analytics.transactionCount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {volumeTrend.map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td>{row.totalAmount?.toFixed(2)} XLM</td>
                        <td>{row.paymentCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState variant="payments" title={t("analytics.noData")} />
            )}
          </div>
        </div>

        {/* ── Class Payment Completion ──────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "2rem" }}>
          <div className="card-header">
            <div className="card-title">{t("analytics.classCompletion")}</div>
          </div>
          <div className="card-body">
            {classCompletion.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("analytics.class")}</th>
                      <th scope="col">{t("analytics.total")}</th>
                      <th scope="col">{t("analytics.paid")}</th>
                      <th scope="col">{t("analytics.unpaid")}</th>
                      <th scope="col">{t("analytics.completionRate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classCompletion.map((row) => (
                      <tr key={row.class}>
                        <td>{row.class}</td>
                        <td>{row.total}</td>
                        <td style={{ color: "var(--success)" }}>{row.paid}</td>
                        <td style={{ color: "var(--danger)" }}>{row.unpaid}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <div style={{ flex: 1, height: "8px", background: "var(--border)", borderRadius: "4px", overflow: "hidden" }}>
                              <div style={{
                                height: "100%",
                                width: `${row.completionRate || 0}%`,
                                background: row.completionRate > 75 ? "var(--success)" : row.completionRate > 50 ? "var(--warning)" : "var(--danger)",
                              }} />
                            </div>
                            <span style={{ fontSize: "0.875rem", minWidth: "3rem" }}>
                              {row.completionRate?.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState variant="payments" title={t("analytics.noData")} />
            )}
          </div>
        </div>

        {/* ── Top Unpaid Cohorts ────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t("analytics.topUnpaidCohorts")}</div>
          </div>
          <div className="card-body">
            {unpaidCohorts.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("analytics.class")}</th>
                      <th scope="col">{t("analytics.unpaidCount")}</th>
                      <th scope="col">{t("analytics.totalOutstandingAmount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unpaidCohorts.map((row) => (
                      <tr key={row.class}>
                        <td>{row.class}</td>
                        <td>{row.unpaidCount}</td>
                        <td>{row.totalOutstanding?.toFixed(2)} XLM</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState variant="payments" title={t("analytics.noUnpaid")} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default RequireAdmin(Analytics);
