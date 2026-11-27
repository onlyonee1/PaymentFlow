'use strict';

const Student = require('../models/studentModel');
const { studentExportPermissions } = require('../config/rolePermissions');

const MAX_EXPORT_ROWS = 50000;
const ASYNC_EXPORT_THRESHOLD = 1000;

function csvCell(value) {
  let text = value instanceof Date ? value.toISOString() : String(value ?? '');
  if (typeof value === 'string' && /^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function exportQuery(filter, includeDeleted) {
  const query = Student.find(filter).sort({ createdAt: -1, _id: -1 });
  if (includeDeleted) query.includeDeleted();
  return query;
}

async function currentExportPermissions(user, schoolId) {
  const { userId } = user;
  if (user.role === 'admin' && userId === 'super_admin') {
    return studentExportPermissions(user, false);
  }
  if (!/^[a-f0-9]{24}$/i.test(userId || '')) return studentExportPermissions({}, false);
  const User = require('../models/userModel');
  const account = await User.findOne({
    _id: userId,
    $or: [{ schoolId }, { schoolId: null, roles: 'super_admin' }],
    isActive: true,
  }).select('roles permissions').lean();
  return studentExportPermissions(account || {}, account?.permissions?.includes('pii_export'));
}

async function generateStudentExport({ schoolId, columns, filters, includeDeleted, requestedBy, globalAdmin }) {
  const { allowed, admin } = await currentExportPermissions({
    userId: requestedBy, role: globalAdmin ? 'admin' : undefined,
  }, schoolId);
  if (!allowed.length || (includeDeleted && !admin) || columns.some((column) => !allowed.includes(column))) {
    throw new Error('Student export access denied');
  }
  const filter = { ...filters, schoolId };
  const cursor = exportQuery(filter, includeDeleted).select(columns.join(' ')).cursor();
  const lines = [columns.join(',')];
  try {
    for await (const doc of cursor) {
      if (lines.length > MAX_EXPORT_ROWS) throw new Error('Student export row limit exceeded');
      lines.push(columns.map((column) => csvCell(doc[column])).join(','));
    }
    return lines.join('\n') + '\n';
  } finally {
    await cursor.close();
  }
}

module.exports = { MAX_EXPORT_ROWS, ASYNC_EXPORT_THRESHOLD, csvCell, exportQuery, generateStudentExport, currentExportPermissions };
