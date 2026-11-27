'use strict';

// #881 — Materialized aggregates for dashboard / trend queries.
// Each document holds pre-rolled-up totals for one school per day or month.
// Updated incrementally on payment.saved and reconciled by a scheduled job.

const mongoose = require('mongoose');

const HOURLY_METRICS_TTL_SECONDS = 90 * 86400;
const configuredDailyTtl = Number(process.env.DAILY_METRICS_TTL_SECONDS);
const DAILY_METRICS_TTL_SECONDS = Number.isSafeInteger(configuredDailyTtl) && configuredDailyTtl > 0
  ? configuredDailyTtl
  : 3 * 365 * 86400;

const metricsShape = {
  schoolId:      { type: String, required: true },
  // UTC period key, with precision matching the collection.
  period:        { type: String, required: true },
  paymentCount:  { type: Number, default: 0 },
  totalAmount:   { type: Number, default: 0 },   // crypto
  totalFiatAmount: { type: Number, default: 0 }, // fiat (from stored snapshots)
  fiatCurrency:  { type: String, default: null },
  validCount:    { type: Number, default: 0 },
  overpaidCount: { type: Number, default: 0 },
  underpaidCount:{ type: Number, default: 0 },
  uniqueStudents:{ type: Number, default: 0 },
  reconciledAt:  { type: Date, default: null },  // last full reconciliation
};

const dailyMetricsSchema = new mongoose.Schema(metricsShape, { timestamps: true });
dailyMetricsSchema.index({ schoolId: 1, period: 1 }, { unique: true });
dailyMetricsSchema.index({ period: 1 });
dailyMetricsSchema.index({ createdAt: 1 }, { expireAfterSeconds: DAILY_METRICS_TTL_SECONDS });

const hourlyMetricsSchema = new mongoose.Schema({
  ...metricsShape,
  archived: { type: Boolean, default: false },
}, { timestamps: true });
hourlyMetricsSchema.index({ schoolId: 1, period: 1 }, { unique: true });
hourlyMetricsSchema.index({ archived: 1, period: 1 });
hourlyMetricsSchema.index({ createdAt: 1 }, {
  expireAfterSeconds: HOURLY_METRICS_TTL_SECONDS,
  partialFilterExpression: { archived: true },
});

const monthlyMetricsSchema = new mongoose.Schema(metricsShape, { timestamps: true });
monthlyMetricsSchema.index({ schoolId: 1, period: 1 }, { unique: true });

const HourlyMetrics = mongoose.model('HourlyMetrics', hourlyMetricsSchema);
const DailyMetrics   = mongoose.model('DailyMetrics',   dailyMetricsSchema);
const MonthlyMetrics = mongoose.model('MonthlyMetrics', monthlyMetricsSchema);

module.exports = {
  HourlyMetrics, DailyMetrics, MonthlyMetrics,
  HOURLY_METRICS_TTL_SECONDS, DAILY_METRICS_TTL_SECONDS,
};
