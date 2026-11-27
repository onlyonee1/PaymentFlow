'use strict';

const { HourlyMetrics, DailyMetrics, HOURLY_METRICS_TTL_SECONDS } = require('../models/metricsModel');
const logger = require('../utils/logger');

const dayMs = 86400000;
const archiveLeadTime = 2 * dayMs;
let timer;
let running = false;

function archiveCutoff(now = new Date()) {
  return new Date(now.getTime() - HOURLY_METRICS_TTL_SECONDS * 1000 + archiveLeadTime)
    .toISOString().slice(0, 10);
}

async function archiveHourlyMetrics(now = new Date()) {
  const match = { archived: false, period: { $lt: archiveCutoff(now) } };
  const days = HourlyMetrics.aggregate([
    { $match: match },
    { $group: {
      _id: { schoolId: '$schoolId', day: { $substrBytes: ['$period', 0, 10] } },
      paymentCount: { $sum: '$paymentCount' },
      totalAmount: { $sum: '$totalAmount' },
      totalFiatAmount: { $sum: '$totalFiatAmount' },
      fiatCurrency: { $first: '$fiatCurrency' },
      validCount: { $sum: '$validCount' },
      overpaidCount: { $sum: '$overpaidCount' },
      underpaidCount: { $sum: '$underpaidCount' },
    } },
  ]).allowDiskUse(true).cursor();

  let archivedDays = 0;
  for await (const { _id: { schoolId, day }, ...totals } of days) {
    // Existing daily rollups already include these payments, along with any
    // historical corrections and distinct student counts from reconciliation.
    await DailyMetrics.updateOne(
      { schoolId, period: day },
      { $setOnInsert: { ...totals, createdAt: new Date(day) } },
      { upsert: true, timestamps: false, writeConcern: { w: "majority" } },
    );
    await HourlyMetrics.updateMany(
      { schoolId, period: { $gte: day, $lt: `${day}T24` }, archived: false },
      { $set: { archived: true } },
    );
    archivedDays++;
  }
  return archivedDays;
}

function startMetricsArchive() {
  if (timer) return;
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(2, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  timer = setTimeout(async () => {
    timer = null;
    startMetricsArchive();
    if (running) return;
    running = true;
    try {
      const archivedDays = await archiveHourlyMetrics();
      logger.info('Archived hourly payment metrics', { archivedDays });
    } catch (error) {
      logger.error('Hourly payment metric archival failed', { error: error.message });
    } finally {
      running = false;
    }
  }, next - now);
  timer.unref();
}

function stopMetricsArchive() {
  clearTimeout(timer);
  timer = null;
}

module.exports = { archiveCutoff, archiveHourlyMetrics, startMetricsArchive, stopMetricsArchive };
