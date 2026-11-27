'use strict';

const express = require('express');
const { registry } = require('../metrics');
const { DailyMetrics, DAILY_METRICS_TTL_SECONDS } = require('../models/metricsModel');
const { metricsAuth, metricsRateLimiter } = require('../middleware/metricsAuth');

const router = express.Router();

router.get('/', metricsRateLimiter, metricsAuth, async (req, res, next) => {
  try {
    const output = await registry.metrics();
    res.set('Content-Type', registry.contentType);
    res.end(output);
  } catch (err) {
    next(err);
  }
});

// The monitoring dashboard uses UTC day boundaries and only reads rollups.
router.get('/payment-history', metricsRateLimiter, metricsAuth, async (req, res, next) => {
  const now = Date.now();
  const to = Number(req.query.to ?? now);
  const from = Number(req.query.from ?? to - 30 * 86400000);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
      from < 0 || to <= from || to > now + 86400000) {
    return res.status(400).json({ error: 'Provide a valid UTC range in epoch milliseconds' });
  }

  try {
    const firstDay = new Date(Math.max(from, now - DAILY_METRICS_TTL_SECONDS * 1000)).toISOString().slice(0, 10);
    const lastDay = new Date(to - 1).toISOString().slice(0, 10);
    const rows = await DailyMetrics.aggregate([
      { $match: { period: { $gte: firstDay, $lte: lastDay } } },
      { $group: { _id: '$period', paymentCount: { $sum: '$paymentCount' } } },
      { $sort: { _id: 1 } },
    ]);
    res.json(rows.map(({ _id, paymentCount }) => ({
      time: `${_id}T00:00:00Z`,
      paymentCount,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
