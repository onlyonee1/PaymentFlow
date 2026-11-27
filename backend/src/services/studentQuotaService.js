'use strict';

const Student = require('../models/studentModel');
const { withLock } = require('./distributedLock');

const limits = { free: 100, standard: 1000, enterprise: null };

const upgradeUrl = process.env.STUDENT_QUOTA_UPGRADE_URL || '/billing/upgrade';

function studentLimit(school = {}) {
  if (school.studentQuota != null) return school.studentQuota;
  if (school.maxStudents != null && school.maxStudents !== 10000) return school.maxStudents;
  return limits[school.subscriptionTier || 'free'];
}

async function quotaUsage(school) {
  return {
    tier: school.subscriptionTier || 'free',
    limit: studentLimit(school),
    used: await Student.countDocuments({ schoolId: school.schoolId, deletedAt: null }),
    upgrade_url: upgradeUrl,
  };
}

function quotaExceeded(res, usage) {
  return res.status(402).json({
    error: { code: 'STUDENT_QUOTA_EXCEEDED', message: `Student limit of ${usage.limit} reached. Upgrade your school subscription to add more students.` },
    upgrade_url: usage.upgrade_url,
  });
}

async function withStudentQuotaLock(schoolId, fn) {
  const acquired = await withLock(`student-quota:${schoolId}`, 30000, fn);
  if (!acquired) {
    const error = new Error('A student or quota update is in progress. Please retry.');
    error.status = 503;
    throw error;
  }
  return acquired.result;
}

module.exports = { studentLimit, upgradeUrl, quotaUsage, quotaExceeded, withStudentQuotaLock };
