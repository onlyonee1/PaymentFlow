'use strict';

const { validateQuery } = require('./validateQuery');
const { validateDecimalAmount } = require('../utils/decimalPrecision');

const {
  createPaymentIntentSchema,
  submitTransactionSchema,
  verifyPaymentSchema,
} = require('./schemas/paymentSchemas');

const {
  getPaymentInstructionsQuerySchema,
} = require('./schemas/paymentQuerySchemas');

const {
  paginationSchema,
  exportPaginationSchema,
  auditQuerySchema,
  registerStudentSchema,
  updateStudentSchema,
  createDisputeSchema,
  createFeeAdjustmentSchema,
  createWebhookEndpointSchema,
  createSchoolSchema,
  updateSchoolSchema,
} = require('./schemas/requestLimitSchemas');

/**
 * Validates the supplied input in validate.
 * @param {*} schema - Value used by validate.
 * @param {*} source - Value used by validate.
 * @returns {*} Result produced by validate.
 */
function validate(schema, source = 'body') {
  if (source === 'query') return validateQuery(schema, { includeDetails: true });
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      convert:    true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field:   detail.context?.key || detail.path.join('.') || 'unknown',
        message: detail.message,
      }));
      return res.status(400).json({ errors });
    }

    req[source] = value;
    return next();
  };
}

const validateCreatePaymentIntent = validate(createPaymentIntentSchema, 'body');
const validateSubmitTransaction = validate(submitTransactionSchema, 'body');
const validateVerifyPayment = validate(verifyPaymentSchema, 'body');

const STUDENT_ID_RE = /^[\w-]{1,28}$/;

function validStudentId(id) {
  return typeof id === 'string' && STUDENT_ID_RE.test(id);
}

function validTxHash(hash) {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
}

/** Middleware: validate :studentId URL param */
function validateStudentIdParam(req, res, next) {
  const { studentId } = req.params;
  if (typeof studentId !== 'string' || !STUDENT_ID_RE.test(studentId)) {
    return res.status(400).json({ error: 'Invalid studentId format', code: 'VALIDATION_ERROR' });
  }
  return next();
}

/** Middleware: validate the query string of GET /payments/instructions/:studentId */
function validatePaymentInstructionsQuery(req, res, next) {
  const { error, value } = getPaymentInstructionsQuerySchema.validate(req.query, {
    abortEarly: false,
    convert:    true,
  });

  if (error) {
    return res.status(400).json({
      error: error.details[0].message,
      code:  'VALIDATION_ERROR',
      errors: error.details.map(detail => ({
        field:   detail.context?.key || detail.path.join('.') || 'unknown',
        message: detail.message,
      })),
    });
  }

  req.query = value;
  return next();
}

/** Middleware: validate :txHash URL param */
function validateTxHashParam(req, res, next) {
  if (!validTxHash(req.params.txHash)) {
    return res.status(400).json({ errors: [{ field: 'txHash', message: 'Invalid txHash format' }] });
  }
  return next();
}

/** Middleware: validate POST /api/students body */
function validateRegisterStudent(req, res, next) {
  const { error, value } = registerStudentSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((detail) => ({
      field: detail.path.join('.') || 'body',
      message: detail.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  if (value.studentId !== undefined && !validStudentId(value.studentId)) {
    return res.status(400).json({
      errors: [{ field: 'studentId', message: 'studentId must be 1-28 alphanumeric, dash, or underscore characters' }],
      code: 'VALIDATION_ERROR',
    });
  }
  req.body = value;
  return next();
}

/**
 * Validates fee structure in validate.
 * @param {object} req - Value used by validateFeeStructure.
 * @param {object} res - Value used by validateFeeStructure.
 * @param {Function} next - Value used by validateFeeStructure.
 * @returns {*} Result produced by validateFeeStructure.
 */
function validateFeeStructure(req, res, next) {
  const { className, feeAmount } = req.body;
  const errors = [];

  if (!className || typeof className !== 'string' || !className.trim()) errors.push('className is required');
  const amount = validateDecimalAmount(feeAmount, { minValue: 0.01 });
  if (!amount.ok) errors.push(amount.error);

  if (errors.length) return res.status(400).json({ errors });
  return next();
}

// ── Request-limit middleware (Issue #41) ──────────────────────────────────────

/**
 * Validate pagination query params (page, limit) before any DB query.
 * Applies to all list endpoints. Allows unknown params through.
 */
const validatePagination = validateQuery(paginationSchema, { includeDetails: true, legacyOffset: true });
const validateExportPagination = validateQuery(exportPaginationSchema, { includeDetails: true });
const validateAuditQuery = validateQuery(auditQuerySchema, { includeDetails: true, legacyOffset: true });

/**
 * Validate PUT /api/students/:studentId body.
 */
function validateUpdateStudent(req, res, next) {
  const { error, value } = updateStudentSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

/**
 * Validate POST /api/disputes body.
 */
function validateCreateDispute(req, res, next) {
  const { error, value } = createDisputeSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

/**
 * Validate POST /api/fee-adjustments body.
 */
function validateCreateFeeAdjustment(req, res, next) {
  const { error, value } = createFeeAdjustmentSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

/**
 * Validate POST /api/webhooks/endpoints body.
 */
function validateCreateWebhookEndpoint(req, res, next) {
  const { error, value } = createWebhookEndpointSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

/**
 * Validate POST /api/schools body.
 */
function validateCreateSchool(req, res, next) {
  const { error, value } = createSchoolSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

/**
 * Validate PUT /api/schools/:id body.
 */
function validateUpdateSchool(req, res, next) {
  const { error, value } = updateSchoolSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

module.exports = {
  validate,
  validateCreatePaymentIntent,
  validateSubmitTransaction,
  validateVerifyPayment,
  validateStudentIdParam,
  validatePaymentInstructionsQuery,
  validateTxHashParam,
  validateRegisterStudent,
  validateFeeStructure,
  // Issue #41 — request body and parameter limits
  validatePagination,
  validateExportPagination,
  validateAuditQuery,
  validateUpdateStudent,
  validateCreateDispute,
  validateCreateFeeAdjustment,
  validateCreateWebhookEndpoint,
  validateCreateSchool,
  validateUpdateSchool,
};
