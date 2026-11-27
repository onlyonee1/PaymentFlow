'use strict';

const Joi = require('joi');
const { paginationSchema, auditQuerySchema } = require('./requestLimitSchemas');

const text = Joi.string().allow('');
const integer = Joi.number().integer();
const positive = integer.min(1);
const nonnegative = integer.min(0);
const flag = Joi.boolean();
const schoolId = Joi.string().max(200);
const token = Joi.string().max(4096).allow('');
const numeric = Joi.number();
const date = Joi.string().isoDate().strict();

function query(fields) {
  return Joi.object({ schoolId, ...fields }).prefs({ stripUnknown: true });
}

const pagination = query({ page: positive, limit: positive });
const limitOnly = query({ limit: positive });
const limitOffset = query({ limit: positive, offset: nonnegative });
const limitSkip = query({ limit: positive, skip: nonnegative });
const studentFilters = { class: text.max(100), status: text.max(100) };

module.exports = {
  query,
  tenantQuery: Joi.object({ schoolId }).unknown(true),
  pagination,
  limitOnly,
  limitOffset,
  limitSkip,
  studentList: paginationSchema.keys({ schoolId, ...studentFilters, search: text.max(200), cursor: text.max(2048) }),
  studentExport: query({ ...studentFilters, includeDeleted: flag }),
  paymentList: paginationSchema.keys({
    schoolId,
    startDate: date,
    endDate: date,
    minAmount: numeric,
    maxAmount: numeric,
    status: text.max(100),
    studentId: text.max(100),
    isSuspicious: flag,
    cursor: text.max(2048),
  }),
  disputeList: paginationSchema.keys({
    schoolId, status: text, studentId: text, escalationLevel: nonnegative, slaBreached: flag, sort: text,
  }),
  feeList: pagination.keys({ includeDeleted: flag }),
  feeDelete: query({ force: flag }),
  schoolList: query({ includeInactive: flag }),
  auditExport: auditQuerySchema.fork(['page', 'limit'], (field) => field.optional()).keys({
    schoolId,
    limit: positive.max(10000).default(10000),
    format: Joi.string().valid('csv', 'json'),
  }),
  retentionList: query({ limit: positive.max(200).default(50) }),
  analyticsTrend: query({ period: Joi.string().valid('daily', 'weekly', 'monthly') }),
  reconciliationList: pagination.keys({ reviewStatus: text, discrepancyType: text }),
  reconciliationRuns: pagination.keys({ status: text }),
  paymentLimits: query({ asset: text }),
  refundList: query({ status: text }),
  webhookDeliveries: pagination.keys({ endpointId: text, event: text, success: flag }),
  webhookReplay: query({ resetAttempts: flag }),
  sourceRules: query({ type: text, isActive: flag }),
  emailWebhook: query({ token }),
  unsubscribe: query({ token }),
  notifications: pagination.keys({ unreadOnly: flag }),
  receipt: query({ format: text }),
};
