'use strict';

/**
 * Instalment Reminder Service (#622)
 *
 * Runs on a configurable cron-like schedule (REMINDER_CRON env var, default
 * daily at 08:00) and dispatches due-date notifications for payment plan
 * instalments.
 *
 * Windows:
 *   - 3 days before due date → early warning notification
 *   - 1 day before due date  → final reminder notification
 *
 * Partial payments: an instalment whose paidAmount > 0 but < amount is
 * "partially paid". Reminders include the outstanding balance
 * (amount - paidAmount) rather than the full instalment amount.
 *
 * Grace period: instalments that become overdue (past dueDate, unpaid) are
 * flagged and trigger a grace-period notification rather than a standard
 * reminder. The grace period length is configurable via GRACE_PERIOD_DAYS
 * (default 3).
 *
 * Config (all via environment variables):
 *   REMINDER_CRON        — cron expression (default '0 8 * * *' = daily 08:00)
 *   INSTALMENT_REMINDER_WINDOW_DAYS — comma-separated days before due date to
 *                                     send reminders (default '3,1')
 *   GRACE_PERIOD_DAYS    — days after due date before escalating overdue
 *                          (default 3)
 */

const PaymentPlan = require('../models/paymentPlanModel');
const School      = require('../models/schoolModel');
const Student     = require('../models/studentModel');
const logger = require('../utils/logger').child ? require('../utils/logger').child('InstalmentReminderService') : require('../utils/logger');

// Lazily required inside processInstalmentReminders() so that test suites
// which mock reminderService (but not instalmentReminderService) don't get a
// MODULE_NOT_FOUND error when app.js is loaded.
function getSendFeeReminder() {
  return require('./notificationService').sendFeeReminder;
}

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_REMINDER_WINDOWS = [3, 1]; // days before due date
const GRACE_PERIOD_DAYS = parseInt(process.env.GRACE_PERIOD_DAYS || '3', 10);

function getReminderWindowDays() {
  const raw = process.env.INSTALMENT_REMINDER_WINDOW_DAYS;
  if (!raw) return DEFAULT_REMINDER_WINDOWS;
  return raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n > 0);
}

// ── Scheduler state ───────────────────────────────────────────────────────────

let _timer    = null;
let _lastRunAt = null;
let _lastRunSummary = null;

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Compute the outstanding balance for a single instalment.
 * Partial payments reduce the balance without closing the instalment.
 *
 * @param {{ amount: number, paidAmount: number }} instalment
 * @returns {number}
 */
function outstandingBalance(instalment) {
  return Math.max(0, (instalment.amount || 0) - (instalment.paidAmount || 0));
}

/**
 * Decide whether a given instalment is due within the specified window
 * (windowDays days from now) and is not yet fully paid.
 *
 * @param {{ dueDate: Date, paid: boolean }} instalment
 * @param {number} windowDays
 * @returns {boolean}
 */
function isDueWithinWindow(instalment, windowDays) {
  if (instalment.paid) return false;
  const now     = Date.now();
  const dueMs   = new Date(instalment.dueDate).getTime();
  const diffMs  = dueMs - now;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  // Within [windowDays-1, windowDays] window (approximate ±12h tolerance)
  return diffDays > (windowDays - 1 - 0.5) && diffDays <= (windowDays + 0.5);
}

/**
 * Decide whether an instalment is in the grace period (overdue but within
 * GRACE_PERIOD_DAYS of its due date).
 *
 * @param {{ dueDate: Date, paid: boolean }} instalment
 * @returns {boolean}
 */
function isInGracePeriod(instalment) {
  if (instalment.paid) return false;
  const now     = Date.now();
  const dueMs   = new Date(instalment.dueDate).getTime();
  const diffDays = (now - dueMs) / (1000 * 60 * 60 * 24);
  return diffDays > 0 && diffDays <= GRACE_PERIOD_DAYS;
}

/**
 * Process instalment reminders for all active schools.
 *
 * Returns a summary object: { plans, reminders, graceNotices, failed, skipped }
 */
async function processInstalmentReminders() {
  const reminderWindows = getReminderWindowDays();
  const sendFeeReminder = getSendFeeReminder();
  const summary = { plans: 0, reminders: 0, graceNotices: 0, failed: 0, skipped: 0 };

  let schools;
  try {
    schools = await School.find({ isActive: true }).lean();
  } catch (err) {
    logger.error('[InstalmentReminder] Failed to fetch schools', { error: err.message });
    return summary;
  }

  for (const school of schools) {
    let plans;
    try {
      plans = await PaymentPlan.find({
        schoolId:  school.schoolId,
        status:    'active',
        deletedAt: null,
      });
    } catch (err) {
      logger.error('[InstalmentReminder] Failed to fetch plans for school', {
        schoolId: school.schoolId, error: err.message,
      });
      continue;
    }

    summary.plans += plans.length;

    for (const plan of plans) {
      let student;
      try {
        student = await Student.findOne({ schoolId: school.schoolId, studentId: plan.studentId });
      } catch (_) { /* non-critical — skip this plan */ }

      for (let i = 0; i < plan.installments.length; i++) {
        const instalment = plan.installments[i];
        if (instalment.paid) { summary.skipped++; continue; }

        const balance = outstandingBalance(instalment);
        if (balance <= 0) { summary.skipped++; continue; }

        const parentEmail = student?.parentEmail;
        if (!parentEmail) { summary.skipped++; continue; }

        // Check upcoming reminder windows (3 days, 1 day)
        let sent = false;
        for (const windowDays of reminderWindows) {
          if (isDueWithinWindow(instalment, windowDays)) {
            try {
              await sendFeeReminder({
                to:          parentEmail,
                studentName: student?.name || plan.studentId,
                schoolName:  school.name,
                amount:      balance,
                dueDate:     instalment.dueDate,
                type:        'instalment_reminder',
                daysUntilDue: windowDays,
                instalmentIndex: i,
                totalInstalments: plan.installments.length,
              });
              summary.reminders++;
              sent = true;
            } catch (err) {
              logger.error('[InstalmentReminder] Failed to send reminder', {
                studentId: plan.studentId, instalmentIndex: i, error: err.message,
              });
              summary.failed++;
            }
            break; // Only the most urgent window per instalment per run
          }
        }

        // Grace period notice for overdue instalments
        if (!sent && isInGracePeriod(instalment)) {
          try {
            await sendFeeReminder({
              to:          parentEmail,
              studentName: student?.name || plan.studentId,
              schoolName:  school.name,
              amount:      balance,
              dueDate:     instalment.dueDate,
              type:        'instalment_grace_period',
              daysUntilDue: 0,
              instalmentIndex: i,
              totalInstalments: plan.installments.length,
            });
            summary.graceNotices++;
          } catch (err) {
            logger.error('[InstalmentReminder] Failed to send grace-period notice', {
              studentId: plan.studentId, instalmentIndex: i, error: err.message,
            });
            summary.failed++;
          }
        }
      }
    }
  }

  _lastRunAt      = new Date();
  _lastRunSummary = { ...summary };
  return summary;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Parse a cron expression to an interval in ms.
 * Supports only the daily pattern used in production: '0 H * * *'.
 * Falls back to 24h for unrecognised patterns.
 *
 * @param {string} cron
 * @returns {number} ms between runs
 */
function cronToIntervalMs(cron) {
  // Simple daily cron 'M H * * *' → next scheduled time today or tomorrow
  const dailyMatch = cron && cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (!dailyMatch) return 24 * 60 * 60 * 1000; // default 24h

  const minute = parseInt(dailyMatch[1], 10);
  const hour   = parseInt(dailyMatch[2], 10);
  const now    = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function startInstalmentReminderScheduler() {
  if (_timer) return;

  const cron = process.env.REMINDER_CRON || '0 8 * * *';
  const intervalMs = cronToIntervalMs(cron);

  logger.info(`[InstalmentReminder] Starting scheduler (REMINDER_CRON="${cron}", next run in ${Math.round(intervalMs / 60000)}min)`);

  // Schedule first run at the computed offset, then repeat every 24h.
  _timer = setTimeout(async function tick() {
    try {
      const summary = await processInstalmentReminders();
      logger.info('[InstalmentReminder] Run complete', summary);
    } catch (err) {
      logger.error('[InstalmentReminder] Unexpected error during run', { error: err.message });
    }
    _timer = setInterval(async () => {
      try {
        const summary = await processInstalmentReminders();
        logger.info('[InstalmentReminder] Run complete', summary);
      } catch (err) {
        logger.error('[InstalmentReminder] Unexpected error during run', { error: err.message });
      }
    }, 24 * 60 * 60 * 1000);
    if (_timer.unref) _timer.unref();
  }, intervalMs);
  if (_timer.unref) _timer.unref();
}

function stopInstalmentReminderScheduler() {
  if (_timer) {
    clearTimeout(_timer);
    clearInterval(_timer);
    _timer = null;
    logger.info('[InstalmentReminder] Scheduler stopped');
  }
}

function getInstalmentReminderStatus() {
  return {
    schedulerRunning: _timer !== null,
    lastRunAt:        _lastRunAt,
    lastRunSummary:   _lastRunSummary,
  };
}

module.exports = {
  processInstalmentReminders,
  startInstalmentReminderScheduler,
  stopInstalmentReminderScheduler,
  getInstalmentReminderStatus,
  // exported for unit tests
  outstandingBalance,
  isDueWithinWindow,
  isInGracePeriod,
  cronToIntervalMs,
};
