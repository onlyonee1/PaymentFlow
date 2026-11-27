'use strict';

const express = require('express');
const { validateQuery } = require('../middleware/validateQuery');
const queries = require('../middleware/schemas/routeQuerySchemas');
const router  = express.Router();

const { flagDispute, getDisputes, getDisputeById, resolveDispute, addEvidence, addAttachment } = require('../controllers/dispute.controller');
const { resolveSchool } = require('../middleware/schoolContext');
const { requireAdminAuth } = require('../middleware/auth');
const { auditContext } = require('../middleware/auditContext');
const { validateCreateDispute, validatePagination } = require('../middleware/validate');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error('Only image and PDF files are allowed');
      err.code = 'INVALID_FILE_TYPE';
      cb(err, false);
    }
  },
});

// All dispute routes require school context
router.use(resolveSchool);

/**
 * @swagger
 * /api/disputes:
 *   post:
 *     summary: Raise a payment dispute
 *     operationId: flagDispute
 *     tags:
 *       - Disputes
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - txHash
 *               - reason
 *             properties:
 *               txHash:
 *                 type: string
 *               reason:
 *                 type: string
 *               evidence:
 *                 type: string
 *     responses:
 *       201:
 *         description: Dispute raised
 *       400:
 *         description: Validation error
 *       404:
 *         description: Transaction not found
 *   get:
 *     summary: List disputes (paginated)
 *     operationId: getDisputes
 *     tags:
 *       - Disputes
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, resolved, dismissed]
 *     responses:
 *       200:
 *         description: Paginated dispute list
 */

/**
 * @swagger
 * /api/disputes/{id}:
 *   get:
 *     summary: Get a dispute by ID
 *     operationId: getDisputeById
 *     tags:
 *       - Disputes
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dispute record
 *       404:
 *         description: Dispute not found
 */

/**
 * @swagger
 * /api/disputes/{id}/resolve:
 *   patch:
 *     summary: Resolve a dispute (admin only)
 *     operationId: resolveDispute
 *     tags:
 *       - Disputes
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - resolution
 *             properties:
 *               resolution:
 *                 type: string
 *                 enum: [approved, dismissed]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Dispute resolved
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Dispute not found
 */

// Anyone with school context can raise or view disputes
// auditContext uses req.admin which may not be present for unauthenticated flagDispute;
// the audit helper in the controller gracefully skips when req.auditContext is absent.
router.post('/',        validateCreateDispute, auditContext, flagDispute);
router.get('/',         validateQuery(queries.disputeList, { includeDetails: true }), getDisputes);
router.get('/:id',      getDisputeById);
router.post(
  '/:id/attachments',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size exceeds 5MB limit', code: 'FILE_TOO_LARGE' });
        }
        return res.status(400).json({ error: err.message, code: err.code || 'UPLOAD_ERROR' });
      }
      next();
    });
  },
  auditContext,
  addAttachment
);

// Only admins can update dispute status / resolve / add evidence
router.patch('/:id/resolve', requireAdminAuth, auditContext, resolveDispute);
router.post('/:id/sync', requireAdminAuth, auditContext, (req, res, next) => {
  req.disputeSync = true;
  return resolveDispute(req, res, next);
});
router.post('/:id/evidence', requireAdminAuth, auditContext, addEvidence);

module.exports = router;
