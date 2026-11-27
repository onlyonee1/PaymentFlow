'use strict';

// #885 — Archive-instead-of-delete: records are never hard-deleted.
// The scheduler marks old entries as archived=true so they can be offloaded
// to cold storage without losing forensic/compliance value.

const { archiveAuditLogs } = require('./auditService');

const INTERVAL_MS = 10 * 60 * 1000;
const RETENTION_DAYS = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS, 10) || 730;
let _timer = null;

/**
 * Manages audit log cleanup scheduler for auditLogCleanupService.
 * @returns {void} Completes without a return value.
 */
function startAuditLogCleanupScheduler() {
  if (_timer) return;
  _timer = setInterval(() => archiveAuditLogs(RETENTION_DAYS), INTERVAL_MS);
  _timer.unref();
}

/**
 * Manages audit log cleanup scheduler for auditLogCleanupService.
 * @returns {void} Completes without a return value.
 */
function stopAuditLogCleanupScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startAuditLogCleanupScheduler, stopAuditLogCleanupScheduler };
