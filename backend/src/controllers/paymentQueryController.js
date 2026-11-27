'use strict';

const { Stroops, paymentAmountDecimal } = require('../utils/stroops');
const { classifyFeePayment, decimalFromMongo, toMoneyNumber } = require('../utils/money');

/**
 * paymentQueryController — read-only payment queries, all school-scoped.
 */

const crypto = require('crypto');
const Payment = require('../models/paymentModel');
const { paginateList } = require('../utils/listCursor');
const Student = require('../models/studentModel');
const PendingVerification = require('../models/pendingVerificationModel');
const { ACCEPTED_ASSETS } = require('../config/stellarConfig');
const { getPaymentLimits } = require('../utils/paymentLimits');
const {
  convertToLocalCurrency,
  enrichPaymentWithConversion,
} = require('../services/currencyConversionService');

function getExplorerUrl(txHash) {
  if (!txHash) return null;
  const network = process.env.STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

// Compute once at startup — changes only when stellarConfig changes.
const _acceptedAssetsBody = JSON.stringify({
  assets: Object.values(ACCEPTED_ASSETS).map((a) => ({
    code: a.code,
    type: a.type,
    displayName: a.displayName,
  })),
});
const _acceptedAssetsETag = `"${crypto.createHash('sha1').update(_acceptedAssetsBody).digest('hex')}"`;

async function getAcceptedAssets(req, res, next) {
  try {
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('ETag', _acceptedAssetsETag);
    if (req.headers['if-none-match'] === _acceptedAssetsETag) return res.status(304).end();
    res.type('json').send(_acceptedAssetsBody);
  } catch (err) {
    next(err);
  }
}

async function getPaymentLimitsEndpoint(req, res, next) {
  try {
    const limits = await getPaymentLimits({ schoolId: req.schoolId });
    res.json({
      min: limits.min,
      max: limits.max,
      message: `Payment amounts must be between ${limits.min} and ${limits.max}`,
    });
  } catch (err) {
    next(err);
  }
}

async function getStudentPayments(req, res, next) {
  try {
    const targetCurrency = req.school.localCurrency || 'USD';
    const network = process.env.STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet';

    const student = await Student.findOne({ schoolId: req.schoolId, studentId: req.params.studentId });
    if (!student) return res.status(404).json({ error: 'Student not found', code: 'NOT_FOUND' });

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const { items: payments, pagination } = await paginateList({
      find: (query) => Payment.find(query).lean(),
      scope: 'student-payments',
      filter: { schoolId: req.schoolId, studentId: req.params.studentId, deletedAt: null },
      cursor: req.query.cursor,
      limit,
    });

    const enriched = await Promise.all(
      payments.map(async (p) => {
        const hash = p.transactionHash || p.txHash;
        const explorerUrl = hash ? `https://stellar.expert/explorer/${network}/tx/${hash}` : null;
        const converted = await enrichPaymentWithConversion(p, targetCurrency);
        return { ...converted, ...Stroops.fromPayment(p).toAmountFields(), explorerUrl };
      }),
    );

    res.json({ payments: enriched, pagination });
  } catch (err) {
    next(err);
  }
}

async function getAllPayments(req, res, next) {
  try {
    const { schoolId } = req;
    const { limit = 50, startDate, endDate, minAmount, maxAmount, status, studentId, isSuspicious } = req.query;

    const filter = { schoolId, studentDeleted: { $ne: true }, deletedAt: null };

    if (startDate || endDate) {
      filter.confirmedAt = {};
      if (startDate) {
        if (isNaN(Date.parse(startDate))) return res.status(400).json({ error: 'Invalid startDate', code: 'VALIDATION_ERROR' });
        filter.confirmedAt.$gte = new Date(startDate);
      }
      if (endDate) {
        if (isNaN(Date.parse(endDate))) return res.status(400).json({ error: 'Invalid endDate', code: 'VALIDATION_ERROR' });
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        filter.confirmedAt.$lte = end;
      }
    }

    if (minAmount || maxAmount) {
      filter.amount = {};
      if (minAmount) {
        const min = Number(minAmount);
        if (!Number.isFinite(min)) return res.status(400).json({ error: 'Invalid minAmount', code: 'VALIDATION_ERROR' });
        filter.amount.$gte = min;
      }
      if (maxAmount) {
        const max = Number(maxAmount);
        if (!Number.isFinite(max)) return res.status(400).json({ error: 'Invalid maxAmount', code: 'VALIDATION_ERROR' });
        filter.amount.$lte = max;
      }
    }

    if (status) filter.status = status.toUpperCase();
    if (studentId) filter.studentId = studentId;
    if (isSuspicious !== undefined) filter.isSuspicious = isSuspicious === 'true';

    const { items: payments, pagination } = await paginateList({
      find: (query) => Payment.find(query).lean(),
      scope: 'payments',
      filter,
      cursor: req.query.cursor,
      limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
    });

    const enrichedPayments = payments.map((p) => ({
      ...p,
      ...Stroops.fromPayment(p).toAmountFields(),
      stellarExplorerUrl: getExplorerUrl(p.transactionHash || p.txHash),
      explorerUrl: getExplorerUrl(p.transactionHash || p.txHash),
    }));

    res.json({
      payments: enrichedPayments,
      pagination,
    });
  } catch (err) {
    if (err.code === 'INVALID_CURSOR') {
      return res.status(400).json({ error: err.message, code: 'INVALID_CURSOR' });
    }
    next(err);
  }
}

async function getOverpayments(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const { items: overpayments, pagination } = await paginateList({
      find: (query) => Payment.find(query),
      scope: 'overpayments',
      filter: { schoolId: req.schoolId, feeValidationStatus: 'overpaid' },
      cursor: req.query.cursor,
      limit,
    });
    const totalExcess = overpayments.reduce((sum, payment) => sum + (payment.excessAmount || 0), 0);

    res.json({ count: overpayments.length, totalExcess, overpayments, pagination });
  } catch (err) {
    next(err);
  }
}

async function getStudentBalance(req, res, next) {
  try {
    const { schoolId } = req;
    const { studentId } = req.params;

    const student = await Student.findOne({ schoolId, studentId });
    if (!student) return res.status(404).json({ error: 'Student not found', code: 'NOT_FOUND' });

    const [result, deletedCount] = await Promise.all([
      Payment.aggregate([
        { $match: { schoolId, studentId, deletedAt: null } },
        { $group: { _id: null, totalPaid: { $sum: paymentAmountDecimal }, count: { $sum: 1 } } },
      ]),
      Payment.countDocuments({ schoolId, studentId, deletedAt: { $ne: null } }),
    ]);

    const balance = classifyFeePayment(decimalFromMongo(result[0]?.totalPaid), student.feeAmount);
    const { cumulativeTotal: totalPaid, remainingBalance, excessAmount } = balance;

    const targetCurrency = req.school.localCurrency || 'USD';
    const [feeConv, paidConv, remainingConv] = await Promise.all([
      convertToLocalCurrency(student.feeAmount, 'XLM', targetCurrency),
      convertToLocalCurrency(totalPaid, 'XLM', targetCurrency),
      convertToLocalCurrency(remainingBalance, 'XLM', targetCurrency),
    ]);

    const buildLocal = (conv) =>
      conv.available ? { amount: conv.localAmount, currency: conv.currency, rate: conv.rate, rateTimestamp: conv.rateTimestamp } : null;

    let categoryBreakdown = [];
    if (student.fees && student.fees.length > 0) {
      const categoryPayments = await Payment.aggregate([
        { $match: { schoolId, studentId, feeCategory: { $ne: null }, deletedAt: null } },
        { $group: { _id: '$feeCategory', totalPaid: { $sum: paymentAmountDecimal }, count: { $sum: 1 } } },
      ]);
      const categoryPaymentMap = {};
      categoryPayments.forEach((cp) => {
        categoryPaymentMap[cp._id] = { totalPaid: decimalFromMongo(cp.totalPaid), installmentCount: cp.count };
      });
      categoryBreakdown = student.fees.map((fee) => {
        const paid = categoryPaymentMap[fee.category] || { totalPaid: 0, installmentCount: 0 };
        const category = classifyFeePayment(paid.totalPaid, fee.amount);
        return {
          category: fee.category,
          amount: fee.amount,
          totalPaid: category.cumulativeTotal,
          remainingBalance: category.remainingBalance,
          paid: category.feePaid,
          installmentCount: paid.installmentCount,
          paymentDeadline: fee.paymentDeadline,
        };
      });
    }

    res.json({
      studentId,
      feeAmount: student.feeAmount,
      totalPaid,
      remainingBalance,
      excessAmount,
      feePaid: totalPaid >= student.feeAmount,
      installmentCount: result.length ? result[0].count : 0,
      categoryBreakdown,
      localCurrency: {
        currency: targetCurrency,
        available: feeConv.available,
        rateTimestamp: feeConv.rateTimestamp,
        feeAmount: buildLocal(feeConv),
        totalPaid: buildLocal(paidConv),
        remainingBalance: buildLocal(remainingConv),
      },
      hasDeletedPayments: deletedCount > 0,
    });
  } catch (err) {
    next(err);
  }
}

async function getSuspiciousPayments(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const { items: suspicious, pagination } = await paginateList({
      find: (query) => Payment.find(query),
      scope: 'suspicious',
      filter: { schoolId: req.schoolId, isSuspicious: true },
      cursor: req.query.cursor,
      limit,
    });

    res.json({ count: suspicious.length, suspicious, pagination });
  } catch (err) {
    next(err);
  }
}

async function getPendingPayments(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const { items: pending, pagination } = await paginateList({
      find: (query) => Payment.find(query),
      scope: 'pending',
      filter: { schoolId: req.schoolId, confirmationStatus: 'pending_confirmation' },
      cursor: req.query.cursor,
      limit,
    });

    res.json({ count: pending.length, pending, pagination });
  } catch (err) {
    next(err);
  }
}

async function getRetryQueue(req, res, next) {
  try {
    if (!PendingVerification || typeof PendingVerification.find !== 'function') {
      return res.json({ pending: { count: 0, items: [] }, dead_letter: { count: 0, items: [] }, recently_resolved: { count: 0, items: [] } });
    }

    const [pending, deadLetter, resolved] = await Promise.all([
      PendingVerification.find({ schoolId: req.schoolId, status: 'pending' }).sort({ nextRetryAt: 1 }),
      PendingVerification.find({ schoolId: req.schoolId, status: 'dead_letter' }).sort({ updatedAt: -1 }),
      PendingVerification.find({ schoolId: req.schoolId, status: 'resolved' }).sort({ resolvedAt: -1 }).limit(20),
    ]);

    res.json({
      pending: { count: pending.length, items: pending },
      dead_letter: { count: deadLetter.length, items: deadLetter },
      recently_resolved: { count: resolved.length, items: resolved },
    });
  } catch (err) {
    next(err);
  }
}

async function getExchangeRates(req, res, next) {
  try {
    const targetCurrency = req.school.localCurrency || 'USD';
    const { _getRates } = require('../services/currencyConversionService');
    const rateEntry = await _getRates(targetCurrency);

    const payload = rateEntry ? {
      available: true,
      currency: targetCurrency,
      rates: rateEntry.rates,
      lastFetchedAt: (rateEntry.lastSuccessfulFetch || rateEntry.fetchedAt).toISOString(),
      stale: rateEntry.stale || false,
      staleAge: rateEntry.staleAge || null,
      rateTimestamp: rateEntry.fetchedAt.toISOString(),
    } : {
      available: false,
      currency: targetCurrency,
      rates: null,
      lastFetchedAt: null,
      stale: false,
      staleAge: null,
      message: 'Price feed is currently unavailable. Amounts are shown in XLM only.',
    };

    // The same URL can serve different school currencies. Request credentials
    // also affect access, so shared caches must key on them.
    for (const field of ['X-School-ID', 'X-School-Slug', 'Authorization', 'Cookie']) {
      res.vary(field);
    }
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.removeHeader('Pragma');
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

async function getPaymentSummary(req, res, next) {
  try {
    const { schoolId } = req;

    const [studentStats, xlmStats, categoryStats] = await Promise.all([
      Student.aggregate([
        { $match: { schoolId, deletedAt: null } },
        { $group: { _id: null, totalStudents: { $sum: 1 }, paidCount: { $sum: { $cond: ['$feePaid', 1, 0] } }, unpaidCount: { $sum: { $cond: ['$feePaid', 0, 1] } } } },
      ]),
      Payment.aggregate([
        { $match: { schoolId, status: 'SUCCESS', deletedAt: null, studentDeleted: { $ne: true } } },
        { $group: { _id: null, totalXlmCollected: { $sum: paymentAmountDecimal } } },
      ]),
      Payment.aggregate([
        { $match: { schoolId, status: 'SUCCESS', deletedAt: null, studentDeleted: { $ne: true }, feeCategory: { $ne: null } } },
        { $group: { _id: '$feeCategory', totalCollected: { $sum: paymentAmountDecimal }, paymentCount: { $sum: 1 } } },
      ]),
    ]);

    const s = studentStats[0] || { totalStudents: 0, paidCount: 0, unpaidCount: 0 };
    const x = xlmStats[0] || { totalXlmCollected: 0 };

    res.json({
      totalStudents: s.totalStudents,
      paidCount: s.paidCount,
      unpaidCount: s.unpaidCount,
      totalXlmCollected: toMoneyNumber(decimalFromMongo(x.totalXlmCollected)),
      categoryBreakdown: categoryStats.map((cat) => ({
        category: cat._id,
        totalCollected: toMoneyNumber(decimalFromMongo(cat.totalCollected)),
        paymentCount: cat.paymentCount,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAcceptedAssets,
  getPaymentLimitsEndpoint,
  getStudentPayments,
  getAllPayments,
  getOverpayments,
  getStudentBalance,
  getSuspiciousPayments,
  getPendingPayments,
  getRetryQueue,
  getExchangeRates,
  getPaymentSummary,
};
