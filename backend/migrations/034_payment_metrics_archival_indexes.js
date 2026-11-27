'use strict';

const mongoose = require('mongoose');
const { HourlyMetrics, DailyMetrics, DAILY_METRICS_TTL_SECONDS } = require('../src/models/metricsModel');

function setDailyTtl(expireAfterSeconds) {
  return mongoose.connection.db.command({
    collMod: 'dailymetrics',
    index: { keyPattern: { createdAt: 1 }, expireAfterSeconds },
  });
}

module.exports = {
  version: '034_payment_metrics_archival_indexes',
  async up() {
    await HourlyMetrics.createIndexes();
    await setDailyTtl(DAILY_METRICS_TTL_SECONDS);
    await DailyMetrics.createIndexes();
  },
  async down() {
    await setDailyTtl(Number(process.env.DAILY_METRICS_TTL_SECONDS) || 400 * 86400);
  },
};
