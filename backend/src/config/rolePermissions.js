'use strict';

const ADMIN_COLUMNS = [
  'studentId', 'name', 'class', 'feeAmount', 'totalPaid', 'remainingBalance', 'feePaid', 'createdAt',
];
const ADMIN_OPTIONAL_COLUMNS = [
  'academicYear', 'paymentDeadline', 'creditAdjustments', 'graduatedAt', 'lastPaymentAt', 'updatedAt',
];
const PII_COLUMNS = ['parentEmail', 'parentPhone', 'parentName', 'contactNumber', 'dateOfBirth', 'gender'];
const FINANCE_COLUMNS = ['name', 'feePaid', 'feeAmount', 'totalPaid', 'remainingBalance'];
const VIEWER_COLUMNS = ['studentId', 'class'];

function studentExportPermissions(user, canExportPii) {
  const roles = new Set([user.role, ...(user.roles || [])]);
  const admin = ['admin', 'super_admin', 'owner'].some((role) => roles.has(role));
  const finance = ['finance', 'finance_officer'].some((role) => roles.has(role));
  const viewer = ['viewer', 'read_only', 'staff'].some((role) => roles.has(role));
  const defaults = admin ? ADMIN_COLUMNS : finance ? FINANCE_COLUMNS : viewer ? VIEWER_COLUMNS : [];
  const allowed = admin ? [...defaults, ...ADMIN_OPTIONAL_COLUMNS, 'deletedAt'] : [...defaults];

  return {
    defaults,
    allowed: canExportPii && allowed.length ? [...allowed, ...PII_COLUMNS] : allowed,
    admin,
  };
}

module.exports = { studentExportPermissions };
