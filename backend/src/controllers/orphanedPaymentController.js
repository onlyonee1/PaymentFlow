'use strict';

const mongoose = require('mongoose');
const OrphanedPayment = require('../models/orphanedPaymentModel');
const Student = require('../models/studentModel');
const Payment = require('../models/paymentModel');
const { IS_TESTNET } = require('../config');
const { compareAmounts, toStroops, stroopsToNumber } = require('../utils/stellarAmount');
const { updateStudentBalance } = require('../utils/studentBalanceUpdater');
const { deriveCorrelationId } = require('../utils/correlationId');
const { savePayment } = require('../services/transactionService');
const { determineConfirmationState } = require('../services/stellarService');
const { CONFIRMATION_STATES, isConfirmedOrAbove } = require('../services/paymentConfirmationStateMachine');
const lock = require('../services/distributedLock');

function feeChoices(student) {
  const fees = student.fees?.length
    ? student.fees
    : [{ category: null, amount: student.feeAmount, totalPaid: student.totalPaid, remainingBalance: student.remainingBalance }];
  return fees.map(fee => ({
    category: fee.category,
    amount: fee.amount,
    outstanding: Math.max(0, fee.remainingBalance ?? fee.amount - (fee.totalPaid || 0)),
  }));
}

async function listOrphanedPayments(req, res, next) {
  try {
    const { schoolId } = req;
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) {
      return res.status(400).json({ error: 'Invalid page.' });
    }
    const limit = 25;
    const filter = { schoolId, matchedAt: null };
    const [payments, total] = await Promise.all([
      OrphanedPayment.find(filter).select('-transaction -operation').sort({ receivedAt: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      OrphanedPayment.countDocuments(filter),
    ]);
    const suggestions = new Map();
    if (payments.length) {
      const amounts = payments.map(payment => stroopsToNumber(toStroops(payment.amount)));
      const candidates = await Student.aggregate([
        { $match: { schoolId, deletedAt: null } },
        { $project: {
          studentId: 1,
          fees: { $cond: [
            { $gt: [{ $size: { $ifNull: ['$fees', []] } }, 0] },
            '$fees',
            [{ category: null, amount: '$feeAmount', totalPaid: '$totalPaid', remainingBalance: '$remainingBalance' }],
          ] },
        } },
        { $unwind: '$fees' },
        { $project: {
          studentId: 1,
          feeCategory: '$fees.category',
          amount: { $round: [{ $ifNull: [
            '$fees.remainingBalance',
            { $subtract: ['$fees.amount', { $ifNull: ['$fees.totalPaid', 0] }] },
          ] }, 7] },
        } },
        { $match: { amount: { $in: amounts, $gt: 0 } } },
        { $group: { _id: '$amount', count: { $sum: 1 }, candidate: { $first: '$$ROOT' } } },
        { $match: { count: 1 } },
      ]);
      for (const { _id, candidate } of candidates) {
        suggestions.set(toStroops(_id), { studentId: candidate.studentId, feeCategory: candidate.feeCategory });
      }
    }

    const network = IS_TESTNET ? 'testnet' : 'public';
    res.json({
      payments: payments.map(payment => ({
        ...payment,
        explorerUrl: `https://stellar.expert/explorer/${network}/tx/${payment.txHash}`,
        suggestion: suggestions.get(toStroops(payment.amount)) || null,
      })),
      page,
      hasNext: page * limit < total,
    });
  } catch (err) { next(err); }
}

async function searchReconciliationStudents(req, res, next) {
  try {
    const search = req.query.search ?? '';
    const includeStudentId = req.query.includeStudentId;
    if (typeof search !== 'string' || search.length > 100) {
      return res.status(400).json({ error: 'Invalid student search.' });
    }
    const filter = { schoolId: req.schoolId };
    if (search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ studentId: new RegExp(escaped, 'i') }, { name: new RegExp(escaped, 'i') }];
    }
    const fields = 'studentId name feeAmount totalPaid remainingBalance fees';
    const students = await Student.find(filter).select(fields).sort({ studentId: 1 }).limit(30);
    if (typeof includeStudentId === 'string' && includeStudentId.length <= 28
      && !students.some(student => student.studentId === includeStudentId)) {
      const suggested = await Student.findOne({ schoolId: req.schoolId, studentId: includeStudentId }).select(fields);
      if (suggested) students.unshift(suggested);
    }
    res.json(students.map(student => ({
      studentId: student.studentId, name: student.name, fees: feeChoices(student),
    })));
  } catch (err) { next(err); }
}

function reconciliationError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function matchOrphanedPayment(req, res, next) {
  const { schoolId } = req;
  const { studentId, feeCategory } = req.body;
  if (!/^[a-f\d]{24}$/i.test(req.params.id) || typeof studentId !== 'string' || !studentId.trim()
    || (feeCategory !== null && typeof feeCategory !== 'string')) {
    return res.status(400).json({ error: 'Select a valid student and fee.' });
  }

  const key = lock.studentBalanceLockKey(schoolId, studentId);
  let acquired;
  let session;
  try {
    const filter = { _id: req.params.id, schoolId };
    const orphan = await OrphanedPayment.findOne(filter).lean();
    if (!orphan) throw reconciliationError('Payment not found.', 404);
    if (orphan.matchedAt) {
      if (orphan.studentId === studentId && orphan.feeCategory === feeCategory) return res.json({ matched: true });
      throw reconciliationError('This payment was already matched.', 409);
    }

    const confirmation = await determineConfirmationState(orphan.ledger, CONFIRMATION_STATES.DETECTED, false);
    if (!isConfirmedOrAbove(confirmation.state)) {
      throw reconciliationError('Wait for Stellar confirmation before matching this payment.', 409);
    }

    acquired = await lock.acquire(key, 15000);
    if (!acquired) throw reconciliationError('The student balance is being updated. Try again shortly.', 409);

    session = await mongoose.connection.startSession();
    await session.withTransaction(async () => {
      const claimed = await OrphanedPayment.updateOne({ ...filter, matchedAt: null }, {
        $set: {
          matchedAt: new Date(), matchedBy: req.user?.email || req.user?.sub || req.user?.id,
          studentId, feeCategory,
        },
      }, { session });
      if (!claimed.modifiedCount) throw reconciliationError('This payment was already matched.', 409);

      const student = await Student.findOne({ schoolId, studentId }).session(session);
      if (!student) throw reconciliationError('Student not found.', 404);
      const fee = feeChoices(student).find(choice => choice.category === feeCategory);
      if (!fee) throw reconciliationError('The selected fee does not belong to the student.', 400);

      const existing = await Payment.findOne({ schoolId, txHash: orphan.txHash }).session(session);
      if (existing) throw reconciliationError('A payment is already recorded for this Stellar transaction.', 409);

      const comparison = compareAmounts(orphan.amount, fee.outstanding);
      await savePayment({
        schoolId, studentId, feeCategory,
        txHash: orphan.txHash, transactionHash: orphan.txHash,
        correlationId: deriveCorrelationId(orphan.txHash),
        memo: orphan.memo, amount: stroopsToNumber(toStroops(orphan.amount)), feeAmount: fee.amount,
        assetCode: orphan.assetCode, assetType: orphan.assetType, senderAddress: orphan.sender,
        feeValidationStatus: comparison < 0 ? 'partial' : comparison > 0 ? 'overpaid' : 'valid',
        excessAmount: comparison > 0 ? stroopsToNumber(toStroops(orphan.amount) - toStroops(fee.outstanding)) : 0,
        status: 'SUCCESS', confirmationState: confirmation.state, confirmationStatus: confirmation.confirmationStatus,
        ledger: orphan.ledger, ledgerSequence: orphan.ledger, confirmedAt: orphan.receivedAt,
      }, { session });
      await updateStudentBalance(schoolId, studentId, { session });
    });
    res.json({ matched: true });
  } catch (err) {
    if (err.code === 'DUPLICATE_TX') return res.status(409).json({ error: err.message });
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  } finally {
    if (session) await session.endSession();
    if (acquired) await lock.release(key, acquired.token);
  }
}

module.exports = { listOrphanedPayments, searchReconciliationStudents, matchOrphanedPayment };
