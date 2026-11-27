'use strict';

/**
 * Standardized API Response Envelope Helper (Issue #298)
 *
 * Provides a canonical response envelope structure:
 * {
 *   success: boolean,
 *   data: any,
 *   meta: { page?, limit?, total?, totalPages?, hasNext?, hasPrev?, nextCursor? },
 *   error: { message, code, details? } | null
 * }
 */

const API_VERSION = process.env.API_VERSION || '1.0.0';

/**
 * Provides the format envelope operation in responseHelper.
 * @param {object} options - Value used by formatEnvelope.
 * @returns {*} Result produced by formatEnvelope.
 */
function formatEnvelope({ data = null, meta = {}, error = null, success = true }) {
  const envelope = {
    success: Boolean(success),
    data: data !== undefined ? data : null,
    meta: Object.keys(meta || {}).length > 0 ? meta : {},
    error: error || null,
  };
  return envelope;
}

/**
 * Dispatches envelope through responseHelper.
 * @param {object} res - Value used by sendEnvelope.
 * @param {object} options - Value used by sendEnvelope.
 * @returns {*} Result produced by sendEnvelope.
 */
function sendEnvelope(res, { data = null, meta = {}, error = null, statusCode = 200 }) {
  res.setHeader('X-API-Version', API_VERSION);
  const success = statusCode >= 200 && statusCode < 400;
  return res.status(statusCode).json(formatEnvelope({ data, meta, error, success }));
}

/**
 * Dispatches success through responseHelper.
 * @param {object} res - Value used by sendSuccess.
 * @param {object} data - Value used by sendSuccess.
 * @param {string} message - Value used by sendSuccess.
 * @param {number} statusCode - Value used by sendSuccess.
 * @param {*} meta - Value used by sendSuccess.
 * @returns {*} Result produced by sendSuccess.
 */
function sendSuccess(res, data, message = null, statusCode = 200, meta = {}) {
  res.setHeader('X-API-Version', API_VERSION);
  const response = { success: true, data };
  if (message) response.message = message;
  if (meta && Object.keys(meta).length > 0) response.meta = meta;
  return res.status(statusCode).json(response);
}

/**
 * Dispatches error through responseHelper.
 * @param {object} res - Value used by sendError.
 * @param {string} message - Value used by sendError.
 * @param {string} code - Value used by sendError.
 * @param {number} statusCode - Value used by sendError.
 * @param {object} details - Value used by sendError.
 * @returns {*} Result produced by sendError.
 */
function sendError(res, message, code = 'INTERNAL_ERROR', statusCode = 500, details = null) {
  res.setHeader('X-API-Version', API_VERSION);
  const response = { success: false, error: { message, code } };
  if (details) response.error.details = details;
  return res.status(statusCode).json(response);
}

/**
 * Dispatches paginated through responseHelper.
 * @param {object} res - Value used by sendPaginated.
 * @param {object} data - Value used by sendPaginated.
 * @param {number} page - Value used by sendPaginated.
 * @param {number} limit - Value used by sendPaginated.
 * @param {number} total - Value used by sendPaginated.
 * @param {Function} nextCursor - Value used by sendPaginated.
 * @returns {*} Result produced by sendPaginated.
 */
function sendPaginated(res, data, page, limit, total, nextCursor = null) {
  res.setHeader('X-API-Version', API_VERSION);
  const totalPages = Math.ceil(total / limit);
  const pagination = {
    page: Number(page),
    limit: Number(limit),
    total: Number(total),
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    ...(nextCursor ? { nextCursor } : {}),
  };
  return sendSuccess(res, data, null, 200, {
    pagination,
    page: Number(page),
    limit: Number(limit),
    total: Number(total),
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    ...(nextCursor ? { nextCursor } : {}),
  });
}

module.exports = {
  formatEnvelope,
  sendEnvelope,
  sendSuccess,
  sendError,
  sendPaginated,
  API_VERSION,
};
