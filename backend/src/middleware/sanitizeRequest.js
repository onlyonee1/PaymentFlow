'use strict';

const sanitizeHtml = require('sanitize-html');

const FORMATTING_TAGS = new Set(['b', 'br', 'em', 'i', 'p', 'strong', 'u']);
const MARKUP = /<(?:\/?[a-z]|!|\?)/i;

function sanitizeBody(req, res, next) {
  let rejected = false;

  function clean(value) {
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        value[key] = clean(value[key]);
      }
      return value;
    }
    if (typeof value !== 'string' || !MARKUP.test(value)) return value;

    return sanitizeHtml(value, {
      allowedTags: [],
      allowedAttributes: {},
      transformTags: {
        '*': (tagName, attribs) => {
          if (!FORMATTING_TAGS.has(tagName) || Object.keys(attribs).length) rejected = true;
          return { tagName, attribs };
        },
      },
    });
  }

  req.body = clean(req.body);
  if (rejected) {
    return res.status(400).json({
      code: 'INVALID_BODY_MARKUP',
      errors: [{ field: 'body', message: 'Request body contains disallowed HTML markup' }],
    });
  }
  return next();
}

const MAX_DEPTH        = parseInt(process.env.JSON_MAX_DEPTH         || '10', 10);
const MAX_ARRAY_LENGTH = parseInt(process.env.JSON_MAX_ARRAY_LENGTH  || '100', 10);

// ── Depth / array-length checker ──────────────────────────────────────────────

function collectComplexityErrors(value, currentDepth, path, errors) {
  if (currentDepth > MAX_DEPTH) {
    errors.push({ field: path || 'body', message: `must not exceed ${MAX_DEPTH} levels of nesting` });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      errors.push({ field: path || 'body', message: `must not contain more than ${MAX_ARRAY_LENGTH} items` });
      return;
    }
    value.forEach((item, index) => collectComplexityErrors(item, currentDepth + 1, `${path}[${index}]`, errors));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectComplexityErrors(child, currentDepth + 1, path ? `${path}.${key}` : key, errors);
    }
  }
}

/**
 * Provides the json depth guard operation in sanitizeRequest.
 * @param {object} req - Value used by jsonDepthGuard.
 * @param {object} res - Value used by jsonDepthGuard.
 * @param {Function} next - Value used by jsonDepthGuard.
 * @returns {*} Result produced by jsonDepthGuard.
 */
function jsonDepthGuard(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    const errors = [];
    collectComplexityErrors(req.body, 1, '', errors);
    if (errors.length) {
      return res.status(400).json({ errors, code: 'PAYLOAD_TOO_COMPLEX' });
    }
  }
  return next();
}

// ── Query-param de-pollution ───────────────────────────────────────────────────
// When Express parses ?a=1&a=2 it produces { a: ['1','2'] }.
// Collapse arrays to their last value so downstream code always gets a scalar.

/**
 * Provides the deduplicate query params operation in sanitizeRequest.
 * @param {object} req - Value used by deduplicateQueryParams.
 * @param {object} res - Value used by deduplicateQueryParams.
 * @param {Function} next - Value used by deduplicateQueryParams.
 * @returns {*} Result produced by deduplicateQueryParams.
 */
function deduplicateQueryParams(req, res, next) {
  if (req.query && typeof req.query === 'object') {
    for (const [key, val] of Object.entries(req.query)) {
      if (Array.isArray(val)) {
        req.query[key] = val[val.length - 1];
      }
    }
  }
  return next();
}

module.exports = { jsonDepthGuard, sanitizeBody, deduplicateQueryParams };
