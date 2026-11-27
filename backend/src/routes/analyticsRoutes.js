'use strict';

const express = require('express');
const router = express.Router();
const {
  getPaymentVolumeTrend,
  getClassPaymentCompletion,
  getTopUnpaidCohorts,
  getPaymentAnalyticsSummary,
  getCategoryRevenueSplit,
} = require('../controllers/analyticsController');
const { resolveSchool } = require('../middleware/schoolContext');
const { requireAdminAuth } = require('../middleware/auth');

router.use(resolveSchool);
router.use(requireAdminAuth);

router.get('/summary', getPaymentAnalyticsSummary);
router.get('/volume-trend', getPaymentVolumeTrend);
router.get('/class-completion', getClassPaymentCompletion);
router.get('/unpaid-cohorts', getTopUnpaidCohorts);
router.get('/category-split', getCategoryRevenueSplit);

module.exports = router;
