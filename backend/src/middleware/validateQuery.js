'use strict';

function validateQuery(schema, { includeDetails = false, legacyOffset = false } = {}) {
  return (req, res, next) => {
    const query = req.query || {};
    const { error, value } = schema.validate(query, { abortEarly: false, convert: true });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.') || 'query',
        message: detail.message,
      }));
      const first = errors[0];
      const message = first.message.replace(/^"([^"]+)"/, '$1');
      return res.status(400).json({
        error: `Invalid query parameter: ${message.startsWith(first.field) ? message : `${first.field} (${message})`}`,
        ...(includeDetails && { errors, code: 'VALIDATION_ERROR' }),
      });
    }

    if (legacyOffset) req.legacyOffsetPagination = req.legacyOffsetPagination ?? query.page !== undefined;
    req.query = value;
    return next();
  };
}

module.exports = { validateQuery };
