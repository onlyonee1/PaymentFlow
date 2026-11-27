'use strict';

const express = require('express');
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

// Anyone with school context can raise or view disputes
// auditContext uses req.admin which may not be present for unauthenticated flagDispute;
// the audit helper in the controller gracefully skips when req.auditContext is absent.
router.post('/',        validateCreateDispute, auditContext, flagDispute);
router.get('/',         validatePagination, getDisputes);
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
