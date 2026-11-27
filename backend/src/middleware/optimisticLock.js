'use strict';

function withVersion(res, document) {
  res.setHeader('ETag', `W/"${document.__v ?? 0}"`);
  return res;
}

function requireVersion(req, res, next) {
  const header = req.get('If-Match');
  if (!header) {
    return res.status(428).json({ code: 'PRECONDITION_REQUIRED', error: 'If-Match is required' });
  }
  const match = /^(?:W\/)?"(0|[1-9]\d*)"$/.exec(header);
  const version = Number(match?.[1]);
  if (!Number.isSafeInteger(version)) {
    return res.status(400).json({ code: 'INVALID_IF_MATCH', error: 'If-Match must contain one version ETag' });
  }
  req.expectedVersion = version;
  return next();
}

function versionFilter(version) {
  return version === 0
    ? { $or: [{ __v: 0 }, { __v: { $exists: false } }] }
    : { __v: version };
}

async function staleOrMissing(res, next, query) {
  const current = await query;
  if (!current) {
    return next(Object.assign(new Error('Resource not found'), { code: 'NOT_FOUND' }));
  }
  return withVersion(res, current).status(412).json({
    code: 'STALE_RESOURCE',
    error: 'Someone else changed this — please refresh',
    current,
  });
}

module.exports = { withVersion, requireVersion, versionFilter, staleOrMissing };
