'use strict';

const express = require('express');
const { validateQuery } = require('../middleware/validateQuery');
const queries = require('../middleware/schemas/routeQuerySchemas');
const router = express.Router();
const {
  getPaymentVolumeTrend,
  getClassPaymentCompletion,
  getTopUnpaidCohorts,
  getPaymentAnalyticsSummary,
} = require('../controllers/analyticsController');
const { resolveSchool } = require('../middleware/schoolContext');
const { requireAdminAuth } = require('../middleware/auth');

router.use(resolveSchool);
router.use(requireAdminAuth);

router.get('/summary', getPaymentAnalyticsSummary);
router.get('/volume-trend', validateQuery(queries.analyticsTrend), getPaymentVolumeTrend);
router.get('/class-completion', getClassPaymentCompletion);
router.get('/unpaid-cohorts', validateQuery(queries.limitOnly), getTopUnpaidCohorts);

module.exports = router;
