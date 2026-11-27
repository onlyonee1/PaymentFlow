/**
 * chartTransforms.js
 *
 * Pure data transformation utilities for the analytics dashboard charts.
 * Transforms raw API responses into SVG-friendly coordinate structures
 * and formats chart data for CSV export.
 */

const PALETTE = [
  "#4f46e5", // Indigo
  "#06b6d4", // Cyan
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ef4444", // Rose
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#6b7280", // Gray
];

/**
 * Transforms volume trend data for line charts.
 *
 * @param {Array<{ date: string, totalAmount: number, paymentCount: number }>} data
 * @param {number} [fiatRate=0.12] - Fiat conversion rate (e.g. XLM to USD)
 * @param {number} [width=600]
 * @param {number} [height=240]
 * @param {number} [padding=40]
 */
export function transformVolumeTrend(data = [], fiatRate = 0.12, width = 600, height = 240, padding = 40) {
  if (!Array.isArray(data) || data.length === 0) {
    return {
      items: [],
      maxAmount: 0,
      maxFiat: 0,
      pointsXlm: "",
      pointsFiat: "",
      areaXlm: "",
      areaFiat: "",
      isEmpty: true,
    };
  }

  const items = data.map((d) => {
    const xlm = Number(d.totalAmount) || 0;
    const fiat = parseFloat((xlm * fiatRate).toFixed(2));
    return {
      date: d.date,
      count: d.paymentCount || 0,
      xlm,
      fiat,
    };
  });

  const maxAmount = Math.max(...items.map((i) => i.xlm), 1);
  const maxFiat = Math.max(...items.map((i) => i.fiat), 1);

  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const stepX = items.length > 1 ? plotWidth / (items.length - 1) : plotWidth / 2;

  const coords = items.map((item, idx) => {
    const x = padding + (items.length > 1 ? idx * stepX : plotWidth / 2);
    const yXlm = height - padding - (item.xlm / maxAmount) * plotHeight;
    const yFiat = height - padding - (item.fiat / maxFiat) * plotHeight;
    return { ...item, x, yXlm, yFiat };
  });

  const pointsXlm = coords.map((c) => `${c.x.toFixed(1)},${c.yXlm.toFixed(1)}`).join(" ");
  const pointsFiat = coords.map((c) => `${c.x.toFixed(1)},${c.yFiat.toFixed(1)}`).join(" ");

  const firstX = coords[0].x.toFixed(1);
  const lastX = coords[coords.length - 1].x.toFixed(1);
  const bottomY = (height - padding).toFixed(1);

  const areaXlm = `M ${firstX},${bottomY} L ${pointsXlm.split(" ").join(" L ")} L ${lastX},${bottomY} Z`;
  const areaFiat = `M ${firstX},${bottomY} L ${pointsFiat.split(" ").join(" L ")} L ${lastX},${bottomY} Z`;

  return {
    items: coords,
    maxAmount,
    maxFiat,
    pointsXlm,
    pointsFiat,
    areaXlm,
    areaFiat,
    isEmpty: false,
  };
}

/**
 * Transforms fee category breakdown into pie/donut chart slices.
 *
 * @param {Array<{ category: string, totalAmount: number, count?: number }>} data
 * @param {number} [cx=120]
 * @param {number} [cy=120]
 * @param {number} [radius=90]
 * @param {number} [innerRadius=50]
 */
export function transformCategorySplit(data = [], cx = 120, cy = 120, radius = 90, innerRadius = 50) {
  if (!Array.isArray(data) || data.length === 0) {
    return { items: [], totalAmount: 0, isEmpty: true };
  }

  const valid = data.filter((d) => (Number(d.totalAmount) || 0) > 0);
  if (valid.length === 0) {
    return { items: [], totalAmount: 0, isEmpty: true };
  }

  const totalAmount = valid.reduce((acc, d) => acc + (Number(d.totalAmount) || 0), 0);

  let currentAngle = -Math.PI / 2;

  const items = valid.map((d, idx) => {
    const amount = Number(d.totalAmount) || 0;
    const percent = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;
    const angle = totalAmount > 0 ? (amount / totalAmount) * 2 * Math.PI : 0;

    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    // Outer arc coordinates
    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);

    // Inner arc coordinates
    const ix1 = cx + innerRadius * Math.cos(endAngle);
    const iy1 = cy + innerRadius * Math.sin(endAngle);
    const ix2 = cx + innerRadius * Math.cos(startAngle);
    const iy2 = cy + innerRadius * Math.sin(startAngle);

    const largeArc = angle > Math.PI ? 1 : 0;

    const path = [
      `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      `L ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)}`,
      "Z",
    ].join(" ");

    return {
      category: d.category || "General",
      amount,
      percent: parseFloat(percent.toFixed(1)),
      color: PALETTE[idx % PALETTE.length],
      path,
      count: d.count || 0,
    };
  });

  return {
    items,
    totalAmount: parseFloat(totalAmount.toFixed(2)),
    isEmpty: false,
  };
}

/**
 * Transforms class completion and outstanding data for bar chart comparison.
 *
 * @param {Array<{ class?: string, className?: string, paid?: number, unpaid?: number, totalCollected?: number, totalOutstanding?: number }>} data
 */
export function transformClassComparison(data = []) {
  if (!Array.isArray(data) || data.length === 0) {
    return { items: [], maxVal: 0, isEmpty: true };
  }

  const items = data.map((d) => {
    const className = d.class || d.className || "Unknown";
    const collected = Number(d.totalCollected ?? d.paid) || 0;
    const outstanding = Number(d.totalOutstanding ?? d.unpaid) || 0;
    const total = collected + outstanding;
    const rate = total > 0 ? (collected / total) * 100 : 0;
    return {
      className,
      collected,
      outstanding,
      total,
      rate: parseFloat(rate.toFixed(1)),
    };
  });

  const maxVal = Math.max(...items.map((i) => Math.max(i.collected, i.outstanding)), 1);

  return {
    items,
    maxVal,
    isEmpty: items.length === 0,
  };
}

/**
 * Generates CSV string from analytics data for board reports.
 *
 * @param {object} params
 * @param {Array} [params.volumeData]
 * @param {Array} [params.categoryData]
 * @param {Array} [params.classData]
 * @param {string} [params.startDate]
 * @param {string} [params.endDate]
 * @param {string} [params.fiatCurrency='USD']
 * @returns {string}
 */
export function formatChartCsv({
  volumeData = [],
  categoryData = [],
  classData = [],
  startDate = "",
  endDate = "",
  fiatCurrency = "USD",
} = {}) {
  const lines = [];

  // Header & Date filter
  lines.push("PAYMENTFLOW SCHOOL FINANCE ANALYTICS REPORT");
  lines.push(`Exported at,"${new Date().toISOString()}"`);
  lines.push(`Date Filter,"${startDate || "All time"} to ${endDate || "Present"}"`);
  lines.push("");

  // Section 1: Volume Trend
  lines.push(`--- PAYMENT VOLUME TREND (${fiatCurrency}) ---`);
  lines.push(`Date,Transactions,Volume (XLM),Volume (${fiatCurrency} Eqv)`);
  if (volumeData.length === 0) {
    lines.push("No data recorded for this range");
  } else {
    for (const row of volumeData) {
      lines.push(`"${row.date}",${row.count || row.paymentCount || 0},${(row.xlm ?? row.totalAmount ?? 0).toFixed(2)},${(row.fiat ?? 0).toFixed(2)}`);
    }
  }
  lines.push("");

  // Section 2: Fee Category Split
  lines.push("--- REVENUE BY FEE CATEGORY ---");
  lines.push("Category,Amount (XLM),Share (%)");
  if (categoryData.length === 0) {
    lines.push("No data recorded for this range");
  } else {
    for (const cat of categoryData) {
      lines.push(`"${cat.category}",${(cat.amount ?? cat.totalAmount ?? 0).toFixed(2)},${(cat.percent ?? 0).toFixed(1)}%`);
    }
  }
  lines.push("");

  // Section 3: Class Collection vs Outstanding
  lines.push("--- COLLECTION STATUS BY GRADE / CLASS ---");
  lines.push("Class / Grade,Collected (XLM),Outstanding (XLM),Collection Rate (%)");
  if (classData.length === 0) {
    lines.push("No data recorded for this range");
  } else {
    for (const c of classData) {
      lines.push(`"${c.className || c.class}",${(c.collected ?? c.paid ?? 0).toFixed(2)},${(c.outstanding ?? c.unpaid ?? 0).toFixed(2)},${(c.rate ?? c.completionRate ?? 0).toFixed(1)}%`);
    }
  }

  return lines.join("\r\n");
}
