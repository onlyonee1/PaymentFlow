'use strict';

const express = require('express');
const router = express.Router();
const {
  registerStudent,
  getAllStudents,
  getStudent,
  getPublicStudentInfo,
  updateStudent,
  deleteStudent,
  restoreStudent,
  getDeletedStudentPayments,
  getPaymentSummary,
  bulkImportStudents,
  getOverdueStudents,
  resetPayment,
  reconcileStudent,
  getFeeHistory,
  exportStudents,
  getStudentExport,
  adjustStudentCredit,
} = require('../controllers/studentController');
const { resubscribeReminders } = require('../controllers/reminderController');
const { getImportJobStatus } = require('../controllers/importJobController');
const { validateRegisterStudent, validateStudentIdParam, validatePagination, validateUpdateStudent } = require('../middleware/validate');
const { resolveSchool } = require('../middleware/schoolContext');
const { requireAdminAuth, requireSchoolAuth } = require('../middleware/auth');
const { auditContext } = require('../middleware/auditContext');
const { bulkImportLimiter } = require('../middleware/rateLimiter');
const streamingCsvUpload = require('../middleware/streamingCsvUpload');
const { contractPaused } = require('../middleware/contractPaused');
const {
  eraseStudentPiiHandler,
  exportStudentDataHandler,
} = require('../controllers/retentionController');

const School = require('../models/schoolModel');
const { withStudentQuotaLock } = require('../services/studentQuotaService');

function quotaWrite(handler) {
  return async (req, res, next) => {
    try {
      await withStudentQuotaLock(req.schoolId, async () => {
        const school = await School.findOne({ schoolId: req.schoolId }).lean();
        if (!school?.isActive) {
          return res.status(403).json({ error: 'School is deactivated.', code: 'SCHOOL_INACTIVE' });
        }
        req.school = school;
        return handler(req, res, next);
      });
    } catch (err) {
      next(err);
    }
  };
}

router.use(resolveSchool);

/**
 * @swagger
 * /api/students:
 *   post:
 *     summary: Register a new student
 *     operationId: registerStudent
 *     tags:
 *       - Students
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - studentId
 *               - name
 *               - feeAmount
 *             properties:
 *               studentId:
 *                 type: string
 *               name:
 *                 type: string
 *               class:
 *                 type: string
 *               feeAmount:
 *                 type: number
 *               contactEmail:
 *                 type: string
 *                 format: email
 *     responses:
 *       201:
 *         description: Student registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Student'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Student ID already exists
 *   get:
 *     summary: List all students (paginated)
 *     operationId: getAllStudents
 *     tags:
 *       - Students
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
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated student list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 students:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Student'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 pages:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/students/{studentId}:
 *   get:
 *     summary: Get a student by ID
 *     operationId: getStudent
 *     tags:
 *       - Students
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Student'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Student not found
 *   put:
 *     summary: Update a student record
 *     operationId: updateStudent
 *     tags:
 *       - Students
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               class:
 *                 type: string
 *               feeAmount:
 *                 type: number
 *               contactEmail:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Updated student record
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Student not found
 *   delete:
 *     summary: Soft-delete a student
 *     operationId: deleteStudent
 *     tags:
 *       - Students
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Student not found
 */

/**
 * @swagger
 * /api/students/public/{studentId}:
 *   get:
 *     summary: Get public student info (no auth required)
 *     operationId: getPublicStudentInfo
 *     tags:
 *       - Students
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Public student info (no PII)
 *       404:
 *         description: Student not found
 */

// Admin-only routes
router.post('/', requireAdminAuth, auditContext, validateRegisterStudent, quotaWrite(registerStudent));
router.post('/bulk', requireAdminAuth, auditContext, bulkImportLimiter, express.json({ limit: '1mb' }), streamingCsvUpload({ requiredHeaders: ['studentId', 'name', 'class'] }), quotaWrite(bulkImportStudents));
router.get('/', requireAdminAuth, validatePagination, getAllStudents);
router.get('/export', requireSchoolAuth(), exportStudents);
router.get('/export/:jobId', requireSchoolAuth(), getStudentExport);

// Import job status — registered BEFORE /:studentId so Express does not
// capture the literal segment 'import' as a studentId parameter.
router.get('/import/:jobId', requireAdminAuth, getImportJobStatus);

// Authentication-required routes (Issue #1040: all student financial data requires auth)
router.get('/summary', requireSchoolAuth(), getPaymentSummary);
router.get('/overdue', requireSchoolAuth(), getOverdueStudents);

// Public routes
router.get('/public/:studentId', validateStudentIdParam, getPublicStudentInfo);
router.get('/:studentId', requireAdminAuth, validateStudentIdParam, getStudent);
router.put('/:studentId', requireAdminAuth, auditContext, validateStudentIdParam, validateUpdateStudent, updateStudent);
router.delete('/:studentId', requireAdminAuth, auditContext, validateStudentIdParam, deleteStudent);
router.post('/:studentId/restore', requireAdminAuth, auditContext, validateStudentIdParam, quotaWrite(restoreStudent));
router.get('/:studentId/payments/audit', requireAdminAuth, validateStudentIdParam, getDeletedStudentPayments);
router.post('/:studentId/reset-payment', requireAdminAuth, auditContext, validateStudentIdParam, resetPayment);
router.post('/:studentId/reconcile', requireAdminAuth, auditContext, validateStudentIdParam, reconcileStudent);
router.post('/:studentId/reminders/resubscribe', requireAdminAuth, auditContext, validateStudentIdParam, resubscribeReminders);
router.get('/:studentId/fee-history', requireAdminAuth, validateStudentIdParam, getFeeHistory);
router.post('/:studentId/credit-adjustments', requireAdminAuth, validateStudentIdParam, auditContext, contractPaused, adjustStudentCredit);
router.delete('/:studentId/pii', requireAdminAuth, validateStudentIdParam, auditContext, eraseStudentPiiHandler);
router.get('/:studentId/data-export', requireAdminAuth, validateStudentIdParam, exportStudentDataHandler);

module.exports = router;
