'use strict';

const Student = require('../models/studentModel');
const Payment = require('../models/paymentModel');

const configuredLimit = Number(process.env.BULK_STATUS_MAX_IDS || 500);
const maxIds = Number.isSafeInteger(configuredLimit) && configuredLimit > 0
  ? Math.min(configuredLimit, 500)
  : 500;
const validIdentifier = (value) => typeof value === 'string' &&
  value.trim().length > 0 && value.length <= 100;
const roundAmount = (amount) => Number(amount.toFixed(7));

async function getBulkPaymentStatus(req, res, next) {
  const { studentIds, feeTypes } = req.body || {};
  if (Array.isArray(studentIds) && studentIds.length > maxIds) {
    return res.status(422).json({ error: `Provide at most ${maxIds} student IDs`, code: 'BATCH_TOO_LARGE' });
  }
  if (!Array.isArray(studentIds) || !studentIds.every(validIdentifier) ||
      (feeTypes !== undefined && (!Array.isArray(feeTypes) || feeTypes.length > 100 ||
        !feeTypes.every(validIdentifier)))) {
    return res.status(422).json({ error: 'studentIds and optional feeTypes must be arrays of identifiers', code: 'VALIDATION_ERROR' });
  }

  try {
    const { schoolId } = req;
    const response = Object.create(null);
    if (!studentIds.length) return res.json(response);

    const students = await Student.find({
      schoolId,
      studentId: { $in: [...new Set(studentIds)] },
    }).select('studentId feeAmount fees.category fees.amount').lean();
    if (!students.length) return res.json(response);

    const categories = feeTypes?.length ? new Set(feeTypes) : null;
    const match = {
      schoolId,
      studentId: { $in: students.map(({ studentId }) => studentId) },
      status: 'SUCCESS',
      deletedAt: null,
      studentDeleted: { $ne: true },
    };
    if (categories) match.feeCategory = { $in: [...categories] };

    const payments = await Payment.aggregate([
      { $match: match },
      { $group: {
        _id: '$studentId',
        paidAmount: { $sum: '$amount' },
        lastPaymentDate: { $max: { $ifNull: ['$confirmedAt', '$createdAt'] } },
      } },
    ]);
    const byStudent = new Map(payments.map((payment) => [payment._id, payment]));

    for (const student of students) {
      const payment = byStudent.get(student.studentId);
      const assessed = categories
        ? (student.fees || []).reduce((total, fee) => total + (categories.has(fee.category) ? fee.amount : 0), 0)
        : student.feeAmount;
      const paidAmount = roundAmount(payment?.paidAmount ?? 0);
      const outstandingAmount = roundAmount(Math.max(0, (assessed ?? 0) - paidAmount));
      response[student.studentId] = {
        status: outstandingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
        paidAmount,
        outstandingAmount,
        lastPaymentDate: payment?.lastPaymentDate ?? null,
      };
    }

    return res.json(response);
  } catch (error) {
    return next(error);
  }
}

module.exports = { getBulkPaymentStatus };
