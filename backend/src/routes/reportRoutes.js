'use strict';

const express = require('express');
const router = express.Router();
const { getReport, getDashboard, getReportJob, downloadReportJob } = require('../controllers/reportController');
const { resolveSchool } = require('../middleware/schoolContext');
const { requireSchoolAuth } = require('../middleware/auth');

// All report endpoints expose full financial data and CSV/accounting exports.
// Gate every route behind the finance permission (fix #887).
const requireFinanceRole = requireSchoolAuth(['owner', 'finance']);

router.use(resolveSchool);

router.get('/dashboard', requireFinanceRole, getDashboard);
router.get('/:jobId/status', requireFinanceRole, getReportJob);
router.get('/:jobId/download', requireFinanceRole, downloadReportJob);
router.get('/jobs/:jobId', requireFinanceRole, getReportJob);
router.get('/jobs/:jobId/download', requireFinanceRole, downloadReportJob);
router.get('/', requireFinanceRole, getReport);

router.post('/', requireFinanceRole, validate(reportQuerySchema), getReport);

module.exports = router;
