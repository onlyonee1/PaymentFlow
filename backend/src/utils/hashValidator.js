'use strict';

const STELLAR_HASH_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Validates transaction hash in hashValidator.
 * @param {boolean} hash - Value used by validateTransactionHash.
 * @returns {*} Result produced by validateTransactionHash.
 */
function validateTransactionHash(hash) {
  if (!hash) return { valid: false, error: 'Transaction hash is required', code: 'MISSING_HASH', normalized: null };
  if (typeof hash !== 'string') return { valid: false, error: 'Transaction hash must be a string', code: 'INVALID_HASH_TYPE', normalized: null };
  const trimmed = hash.trim();
  if (trimmed.length !== 64)
    return { valid: false, error: `Transaction hash must be exactly 64 characters, got ${trimmed.length}`, code: 'INVALID_HASH_LENGTH', normalized: null };
  if (!STELLAR_HASH_REGEX.test(trimmed))
    return { valid: false, error: 'Transaction hash must contain only hexadecimal characters', code: 'INVALID_HASH_FORMAT', normalized: null };
  return { valid: true, error: null, code: null, normalized: trimmed.toLowerCase() };
}

/**
 * Validates hash middleware in hashValidator.
 * @param {string} paramName - Value used by validateHashMiddleware.
 * @returns {*} Result produced by validateHashMiddleware.
 */
function validateHashMiddleware(paramName = 'txHash') {
  return (req, res, next) => {
    const hash = req.params[paramName] || req.body[paramName] || req.query[paramName];
    const v = validateTransactionHash(hash);
    if (!v.valid) return next(Object.assign(new Error(v.error), { code: v.code, status: 400 }));
    if (req.params[paramName]) req.params[paramName] = v.normalized;
    if (req.body[paramName])   req.body[paramName]   = v.normalized;
    if (req.query[paramName])  req.query[paramName]  = v.normalized;
    next();
  };
}

/**
 * Validates transaction hashes in hashValidator.
 * @param {boolean} hashes - Value used by validateTransactionHashes.
 * @returns {*} Result produced by validateTransactionHashes.
 */
function validateTransactionHashes(hashes) {
  if (!Array.isArray(hashes)) return { valid: false, errors: ['Input must be an array'], normalized: [] };
  const results = hashes.map((h, i) => ({ i, ...validateTransactionHash(h) }));
  return {
    valid: results.every((r) => r.valid),
    errors: results.filter((r) => !r.valid).map((r) => `Hash at index ${r.i}: ${r.error}`),
    normalized: results.filter((r) => r.valid).map((r) => r.normalized),
  };
}

/**
 * Provides the sanitize hash operation in hashValidator.
 * @param {boolean} hash - Value used by sanitizeHash.
 * @returns {*} Result produced by sanitizeHash.
 */
function sanitizeHash(hash) {
  const v = validateTransactionHash(hash);
  return v.valid ? v.normalized : null;
}

module.exports = { validateTransactionHash, validateHashMiddleware, validateTransactionHashes, sanitizeHash, STELLAR_HASH_REGEX };
