'use strict';

const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const { Asset, StrKey } = require('@stellar/stellar-sdk');
const Payment = require('../models/paymentModel');
const Student = require('../models/studentModel');
const PaymentIntent = require('../models/paymentIntentModel');
const { CONFIRMATION_THRESHOLD, networkPassphrase } = require('../config/stellarConfig');
const { validatePaymentAmount } = require('../utils/paymentLimits');
const { toMoney } = require('../utils/money');
const { MAX_BATCH_SIZE, buildBatchTransaction, getConfirmedBatch } = require('../soroban/paymentRegistry');

const { updateStudentBalance } = require('../utils/studentBalanceUpdater');
const lock = require('../services/distributedLock');

const asStroops = (amount) => toMoney(amount).times(10_000_000);

async function createBatchPaymentIntent(req, res, next) {
  const { studentId, feeIds, payer } = req.body;
  if (typeof studentId !== 'string' || !studentId.trim() || studentId.length > 28
      || typeof payer !== 'string' || !StrKey.isValidEd25519PublicKey(payer)
      || !Array.isArray(feeIds) || !feeIds.length || feeIds.length > MAX_BATCH_SIZE
      || feeIds.some((id) => typeof id !== 'string' || !id.trim())
      || new Set(feeIds).size !== feeIds.length) {
    return res.status(400).json({ error: 'Provide a student ID, payer public key, and 1–10 distinct fee categories', code: 'VALIDATION_ERROR' });
  }

  const { PAYMENT_REGISTRY_CONTRACT_ID: contractId, SOROBAN_RPC_URL: rpcUrl } = process.env;
  if (!contractId || !rpcUrl) {
    return res.status(503).json({ error: 'Batch payments are unavailable', code: 'SERVICE_UNAVAILABLE' });
  }
  try {
    const { schoolId } = req;
    const student = await Student.findOne({ schoolId, studentId });
    if (!student) return res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });

    const intents = [];
    const payments = [];
    for (const feeId of feeIds) {
      const fee = student.fees?.find(({ category }) => category === feeId);
      const amount = fee?.remainingBalance ?? fee?.amount;
      if (!fee || fee.paid || !(amount > 0)) {
        return res.status(400).json({ error: 'Every fee must belong to the student and have a balance due', code: 'INVALID_FEE_CATEGORY' });
      }
      const validation = await validatePaymentAmount(amount, { schoolId, asset: 'XLM' });
      if (!validation.valid) return res.status(400).json({ error: validation.error, code: validation.code });
      const stroops = asStroops(amount);
      if (!stroops.isInteger()) {
        return res.status(400).json({ error: 'Fee exceeds Stellar amount precision', code: 'INVALID_AMOUNT' });
      }
      const _id = new mongoose.Types.ObjectId();
      const paymentId = _id.toString();
      intents.push({ _id, schoolId, studentId, amount, feeCategory: feeId, memo: paymentId });
      payments.push({ paymentId, amountStroops: BigInt(stroops.toFixed(0)) });
    }

    const { xdr, txHash, expiresAt } = await buildBatchTransaction({
      payer, recipient: req.school.stellarAddress, contractId, rpcUrl, networkPassphrase, payments,
    });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(() => PaymentIntent.insertMany(intents.map((intent) => ({
        ...intent, expiresAt, batchTxHash: txHash, batchPayer: payer,
      })), { session }));
    } finally {
      await session.endSession();
    }
    return res.status(201).json({
      xdr, txHash, expiresAt, intents: intents.map(({ memo, amount, feeCategory }) => ({
        intentId: memo, amount, feeId: feeCategory,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

async function confirmBatchPayment(req, res, next) {
  const { txHash, ledger } = req.body;
  const { schoolId } = req;
  if (typeof txHash !== 'string' || !/^[a-f0-9]{64}$/.test(txHash)
      || !Number.isSafeInteger(ledger) || ledger < 1 || ledger > 0xffffffff) {
    return res.status(400).json({ error: 'Provide the transaction hash and ledger sequence', code: 'VALIDATION_ERROR' });
  }
  const { PAYMENT_REGISTRY_CONTRACT_ID: contractId, SOROBAN_RPC_URL: rpcUrl } = process.env;
  if (!contractId || !rpcUrl) {
    return res.status(503).json({ error: 'Batch payments are unavailable', code: 'SERVICE_UNAVAILABLE' });
  }

  try {
    const intents = await PaymentIntent.find({ schoolId, batchTxHash: txHash }).lean();
    if (!intents.length) return res.status(404).json({ error: 'Batch intent not found', code: 'INTENT_NOT_FOUND' });
    if (intents.every(({ status }) => status === 'completed')) {
      return res.json({ txHash, status: 'confirmed' });
    }
    const batch = await getConfirmedBatch({
      rpcUrl, contractId, txHash, ledger, confirmationThreshold: CONFIRMATION_THRESHOLD,
    });
    if (!batch) return res.status(202).json({ txHash, status: 'pending' });

    const byId = new Map(batch.payments.map((payment) => [payment.paymentId, payment]));
    const recipient = req.school.stellarAddress;
    const asset = Asset.native().contractId(networkPassphrase);
    if (byId.size !== intents.length || intents.some((intent) => {
      const payment = byId.get(intent.memo);
      return !payment || payment.payer !== intent.batchPayer || payment.recipient !== recipient
        || payment.asset !== asset || !asStroops(intent.amount).eq(payment.amountStroops);
    })) {
      return res.status(422).json({ error: 'Ledger event does not match the batch intent', code: 'INTENT_MISMATCH' });
    }

    const { studentId } = intents[0];
    const key = lock.studentBalanceLockKey(schoolId, studentId);
    const acquired = await lock.acquire(key, 30_000);
    if (!acquired) return res.status(409).json({ error: 'Payment confirmation is already in progress', code: 'SYNC_IN_PROGRESS' });
    try {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const update = await PaymentIntent.updateMany(
            { schoolId, batchTxHash: txHash, status: { $ne: 'completed' } },
            { $set: { status: 'completed' } }, { session },
          );
          if (!update.modifiedCount) return;

          await Payment.insertMany(intents.map((intent) => ({
            schoolId, studentId, amount: intent.amount, feeCategory: intent.feeCategory,
            feeAmount: intent.amount, feeValidationStatus: 'valid', assetCode: 'XLM',
            memo: intent.memo, status: 'SUCCESS', confirmationState: 'confirmed',
            confirmationStatus: 'confirmed', confirmedAt: batch.closedAt, ledgerSequence: ledger,
            transactionHash: txHash,
            txHash: createHash('sha256').update(`soroban-batch:${txHash}:${intent.memo}`).digest('hex'),
          })), { session, ordered: true });
          await updateStudentBalance(schoolId, studentId, { session });
        });
      } finally {
        await session.endSession();
      }
    } finally {
      await lock.release(key, acquired.token);
    }
    return res.json({ txHash, status: 'confirmed' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createBatchPaymentIntent, confirmBatchPayment };
