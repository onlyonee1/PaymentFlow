'use strict';

const express = require('express');
const router = express.Router();
const { getAuditLogsEndpoint, getRecentAuditLogsEndpoint, verifyChainEndpoint, exportAuditLogsEndpoint } = require('../controllers/auditController');
const { resolveSchool } = require('../middleware/schoolContext');
const { requireAdminAuth } = require('../middleware/auth');
const { validateAuditQuery, validatePagination, validateExportPagination } = require('../middleware/validate');

router.use(resolveSchool);
router.use(requireAdminAuth);

/**
 * @swagger
 * /api/audit:
 *   get:
 *     summary: List audit log entries (paginated, filterable)
 *     operationId: getAuditLogs
 *     tags:
 *       - Audit
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated audit log entries
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/audit/recent:
 *   get:
 *     summary: Get the most recent audit log entries
 *     operationId: getRecentAuditLogs
 *     tags:
 *       - Audit
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Recent audit log entries
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/audit/export:
 *   get:
 *     summary: Export audit logs as CSV or JSON
 *     operationId: exportAuditLogs
 *     tags:
 *       - Audit
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *     responses:
 *       200:
 *         description: Exported audit log file
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/audit/verify-chain:
 *   get:
 *     summary: Verify audit log hash-chain integrity
 *     operationId: verifyAuditChain
 *     tags:
 *       - Audit
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Chain integrity verified
 *       401:
 *         description: Unauthorized
 *       422:
 *         description: Chain integrity violation detected
 */
router.get('/recent',        validatePagination, getRecentAuditLogsEndpoint);
// #1370 — CSV / JSON export for compliance and handover use-cases
router.get('/export',        validateExportPagination, exportAuditLogsEndpoint);
// #885 — verify hash-chain integrity
router.get('/verify-chain',  verifyChainEndpoint);

module.exports = router;
