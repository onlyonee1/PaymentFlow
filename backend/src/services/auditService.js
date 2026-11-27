'use strict';

/**
 * auditService — append-only audit log with HMAC hash chain.
 */

const crypto = require('crypto');
const AuditLog = require('../models/auditLogModel');
const logger = require('../utils/logger');
const { paginateList, encodeListCursor, decodeListCursor, CURSOR_TTL_MS } = require('../utils/listCursor');

// HMAC key for entry hashes. Falls back to JWT_SECRET so no new env var is
// required; operators can add AUDIT_HMAC_KEY to isolate the secret.
const HMAC_KEY = process.env.AUDIT_HMAC_KEY || process.env.JWT_SECRET || 'audit-integrity-key';

const SENSITIVE_AUDIT_KEY = /secret|password|token|private.?key|authorization/i;

// In-process failure counter — reset on restart
let _auditFailureCount = 0;

function getAuditHealth() {
  return {
    status: _auditFailureCount === 0 ? 'ok' : 'degraded',
    recentFailures: _auditFailureCount,
  };
}

function _resetAuditFailureCount() {
  _auditFailureCount = 0;
}

function sanitizeAuditValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (typeof value.toObject === 'function') return sanitizeAuditValue(value.toObject());
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    SENSITIVE_AUDIT_KEY.test(key) ? '[REDACTED]' : sanitizeAuditValue(nested),
  ]));
}

/**
 * Compute a deterministic HMAC-SHA256 over the canonical fields of an entry.
 * prevHash is included so any modification to the chain is detectable.
 */
function _computeEntryHash(fields) {
  const canonicalFields = {
    schoolId:     fields.schoolId,
    action:       fields.action,
    performedBy:  fields.performedBy,
    targetId:     fields.targetId,
    targetType:   fields.targetType,
    details:      fields.details,
    result:       fields.result,
    errorMessage: fields.errorMessage ?? null,
    ipAddress:    fields.ipAddress ?? null,
    prevHash:     fields.prevHash ?? null,
    createdAt:    fields.createdAt instanceof Date ? fields.createdAt.toISOString() : fields.createdAt,
  };
  if (fields.before != null) canonicalFields.before = fields.before;
  if (fields.after != null) canonicalFields.after = fields.after;
  const canonical = JSON.stringify(canonicalFields);
  return crypto.createHmac('sha256', HMAC_KEY).update(canonical).digest('hex');
}

/**
 * Fetch the most recent audit entry's entryHash for the given schoolId.
 * Used to link the new entry into the hash chain.
 */
async function _getPrevHash(schoolId, session = null) {
  let query = AuditLog.findOne({ schoolId })
    .sort({ _id: -1 })
    .select('entryHash')
    .lean()
    .bypassTenantScope();
  if (session) query = query.session(session);
  const last = await query;
  return last ? (last.entryHash || null) : null;
}

/**
 * logAudit — append-only audit entry with hash chain.
 *
 * Never throws; audit failure must not break the primary operation.
 */
async function logAudit({
  schoolId,
  action,
  performedBy,
  targetId,
  targetType,
  details = {},
  result = 'success',
  before = details?.before ?? null,
  after = details?.after ?? (result === 'success' ? details : null),
  errorMessage = null,
  ipAddress = null,
  userAgent = null,
  severity = null,
  session = null,
  throwOnFailure = false,
}) {
  try {
    details = sanitizeAuditValue(details);
    before = sanitizeAuditValue(before);
    after = sanitizeAuditValue(after);
    const prevHash = await _getPrevHash(schoolId, session);
    const createdAt = new Date();

    const entryHash = _computeEntryHash({
      schoolId, action, performedBy, targetId, targetType,
      details, before, after, result, errorMessage, ipAddress, prevHash, createdAt,
    });

    const entry = {
      schoolId,
      action,
      performedBy,
      targetId,
      targetType,
      details,
      before,
      after,
      result,
      errorMessage,
      ipAddress,
      userAgent,
      ...(severity ? { severity } : {}),
      prevHash,
      entryHash,
      createdAt,
    };
    if (session) {
      await AuditLog.create([entry], { session });
    } else {
      await AuditLog.create(entry);
    }
  } catch (err) {
    _auditFailureCount += 1;
    logger.error('AUDIT_LOG_FAILURE', { err, schoolId, action });
    if (throwOnFailure) throw err;
  }
}

const MAX_PAGE_SIZE = 200;

// ── Cursor encode / decode ────────────────────────────────────────────────────

function _signCursor(entry, filters) {
  return encodeListCursor(entry, 'audit-logs', filters, 'next');
}

function _verifyCursor(token, filters) {
  const payload = decodeListCursor(token, 'audit-logs', filters);
  return { _id: payload.id, createdAt: payload.ts };
}

/** Retrieve a school-scoped page of audit logs. */
async function getAuditLogs(filters = {}) {
  const {
    schoolId, action, targetType, performedBy, result, search,
    startDate, endDate, cursor, limit = 50,
  } = filters;

  const baseQuery = { schoolId };
  if (action)      baseQuery.action      = action;
  if (targetType)  baseQuery.targetType  = targetType;
  if (performedBy) baseQuery.performedBy = performedBy;
  if (result)      baseQuery.result      = result;
  if (search)      baseQuery.$text       = { $search: search };
  if (startDate || endDate) {
    baseQuery.createdAt = {};
    if (startDate) baseQuery.createdAt.$gte = new Date(startDate);
    if (endDate)   baseQuery.createdAt.$lte = new Date(endDate);
  }

  const actualLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), MAX_PAGE_SIZE);
  const { items: logs, pagination } = await paginateList({
    find: (query) => AuditLog.find(query).lean(),
    scope: 'audit-logs',
    filter: baseQuery,
    cursor,
    limit: actualLimit,
  });
  const cursorExpiry = pagination.nextCursor
    ? new Date(decodeListCursor(pagination.nextCursor, 'audit-logs', baseQuery).expiresAt).toISOString()
    : null;
  return { logs, ...pagination, cursorExpiry };
}

async function getRecentAuditLogs(schoolId, limit = 10) {
  return AuditLog.find({ schoolId }).sort({ createdAt: -1 }).limit(limit).lean();
}

/**
 * verifyAuditChain — walks the chain for a school and reports broken links.
 *
 * Returns { ok: boolean, scanned: number, broken: Array<{ _id, reason }> }
 *
 * Broken entries are those where:
 *   (a) recomputed entryHash !== stored entryHash, or
 *   (b) stored prevHash !== entryHash of the prior record.
 */
async function verifyAuditChain(schoolId, { limit = 1000 } = {}) {
  const entries = await AuditLog.find({ schoolId })
    .sort({ _id: 1 })
    .limit(limit)
    .lean()
    .bypassTenantScope();

  const broken = [];
  let prevHash = null;

  for (const entry of entries) {
    // (a) Recompute hash to detect field-level tampering
    const recomputed = _computeEntryHash({
      schoolId:     entry.schoolId,
      action:       entry.action,
      performedBy:  entry.performedBy,
      targetId:     entry.targetId,
      targetType:   entry.targetType,
      details:      entry.details,
      before:       entry.before,
      after:        entry.after,
      result:       entry.result,
      errorMessage: entry.errorMessage,
      ipAddress:    entry.ipAddress,
      prevHash:     entry.prevHash,
      createdAt:    entry.createdAt,
    });

    if (recomputed !== entry.entryHash) {
      broken.push({ _id: entry._id, reason: 'entryHash_mismatch' });
    } else if (entry.prevHash !== prevHash) {
      // (b) Chain link broken: this entry doesn't point to the previous one
      broken.push({ _id: entry._id, reason: 'chain_link_broken' });
    }

    prevHash = entry.entryHash;
  }

  return { ok: broken.length === 0, scanned: entries.length, broken };
}

/** Maximum number of rows that may be exported in a single request. */
const MAX_EXPORT_ROWS = 10000;

/**
 * exportAuditLogs — fetch up to MAX_EXPORT_ROWS matching records and return
 * them as a flat array suitable for CSV or JSON serialisation.
 *
 * Accepts the same filter parameters as getAuditLogs (minus pagination).
 * Sorted oldest-first so the export is chronologically readable.
 *
 * @param {object} filters - { schoolId, action, targetType, performedBy,
 *                             result, startDate, endDate, limit? }
 * @returns {Promise<Array>}  array of plain audit log objects
 */
async function exportAuditLogs(filters = {}) {
  const {
    schoolId, action, targetType, performedBy, result,
    startDate, endDate,
    limit: requestedLimit,
  } = filters;

  const query = { schoolId };
  if (action)      query.action      = action;
  if (targetType)  query.targetType  = targetType;
  if (performedBy) query.performedBy = performedBy;
  if (result)      query.result      = result;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate)   query.createdAt.$lte = new Date(endDate);
  }

  const rowLimit = Math.min(
    Math.max(parseInt(requestedLimit, 10) || MAX_EXPORT_ROWS, 1),
    MAX_EXPORT_ROWS,
  );

  return AuditLog.find(query)
    .sort({ createdAt: 1 })
    .limit(rowLimit)
    .lean();
}

/**
 * archiveAuditLogs — marks records older than retentionDays as archived=true.
 * Records are never deleted; archiving signals they can be exported to cold storage.
 */
async function archiveAuditLogs(retentionDays = 90, { batchSize = 500 } = {}) {
  const expiry = new Date(Date.now() - retentionDays * 86400000);
  const filter = { createdAt: { $lt: expiry }, archived: false };
  let archivedCount = 0;
  while (true) {
    const entries = await AuditLog.find(filter)
      .bypassTenantScope()
      .select('_id')
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();
    if (!entries.length) break;
    const result = await AuditLog.updateMany(
      { _id: { $in: entries.map((entry) => entry._id) } },
      { $set: { archived: true } },
    ).bypassTenantScope();
    archivedCount += result.modifiedCount || 0;
  }
  if (archivedCount > 0) logger.info('AUDIT_LOG_ARCHIVE', { archivedCount });
  return archivedCount;
}

module.exports = {
  logAudit,
  getAuditLogs,
  getRecentAuditLogs,
  exportAuditLogs,
  getAuditHealth,
  verifyAuditChain,
  archiveAuditLogs,
  _resetAuditFailureCount,
  // Exported for testing
  _computeEntryHash,
  _signCursor,
  _verifyCursor,
  CURSOR_TTL_MS,
  MAX_EXPORT_ROWS,
};
