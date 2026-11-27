'use strict';

const { setTraceAttributes } = require('../tracing/spans');

/**
 * paymentController — core payment flow: instructions, intent, submit, verify.
 * req.school and req.schoolId are injected by resolveSchool middleware.
 */

const crypto = require('crypto');
const Payment = require('../models/paymentModel');
const PaymentIntent = require('../models/paymentIntentModel');
const Student = require('../models/studentModel');
const StellarSdk = require('@stellar/stellar-sdk');

const {
  recordPayment,
  validatePaymentWithDynamicFee,
  determineConfirmationState,
  detectAsset,
} = require('../services/stellarService');
const { queueForRetry } = require('../services/retryService');
const { transition: transitionPayment } = require('../services/paymentTransitionService');
const { server } = require('../config/stellarConfig');
const { ACCEPTED_ASSETS } = require('../config/stellarConfig');
const { validateTransactionHash } = require('../utils/hashValidator');
const { getPaymentLimits, validatePaymentAmount } = require('../utils/paymentLimits');
const { SUPPORTED_MEMO_TYPES, decodeMemoToCanonical } = require('../utils/stellarMemo');
const { convertToLocalCurrency } = require('../services/currencyConversionService');
const { getProvider } = require('../services/providers/registry');
const { makePaymentAuditLogger } = require('../utils/paymentAuditLogger');
const lock = require('../services/distributedLock');
const logger = require('../utils/logger');
const { toMoney, decimalFromMongo, classifyFeePayment } = require('../utils/money');
const { simulateTransaction, buildSimulationXdr } = require('../soroban/simulationService');

// TTL for the per-school distributed verify lock.  Verify is a fast Horizon
// round-trip; 30 s is more than enough while still auto-expiring on crash.
const VERIFY_LOCK_TTL_MS = parseInt(process.env.VERIFY_LOCK_TTL_MS || '30000', 10);

// TTL for the per-student balance lock (#1026). Guards the read-aggregate-then-write
// sequence that computes cumulativeTotal and writes it as an absolute Student.$set,
// which is not safe to run concurrently for the same student — whether the second
// writer is another verifyPayment call or syncPaymentsForSchool.
const STUDENT_BALANCE_LOCK_TTL_MS = parseInt(process.env.STUDENT_BALANCE_LOCK_TTL_MS || '15000', 10);

// Permanent error codes that should NOT be retried
const PERMANENT_FAIL_CODES = [
  'TX_FAILED',
  'MISSING_MEMO',
  'INVALID_DESTINATION',
  'UNSUPPORTED_ASSET',
  'AMOUNT_TOO_LOW',
  'AMOUNT_TOO_HIGH',
  'UNDERPAID',
];

function getExplorerUrl(txHash) {
  if (!txHash) return null;
  const network = process.env.STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

function wrapStellarError(err) {
  if (!err.code) {
    err.code = 'STELLAR_NETWORK_ERROR';
    err.message = `Stellar network error: ${err.message}`;
  }
  return err;
}

// ====================== PAYMENT INSTRUCTIONS ======================
async function getPaymentInstructions(req, res, next) {
  try {
    const targetCurrency = req.school.localCurrency || 'USD';
    const { feeCategory, asset } = req.query;

    if (asset) {
      const assetCode = asset.split(':')[0];
      if (!Object.keys(ACCEPTED_ASSETS).includes(assetCode)) {
        const supportedAssets = Object.values(ACCEPTED_ASSETS).map((a) => ({ code: a.code, displayName: a.displayName }));
        return res.status(400).json({ error: `Asset ${assetCode} is not accepted by this school`, code: 'ASSET_NOT_ACCEPTED', supportedAssets });
      }
    }

    // Resolved after the asset is known so per-asset limits apply (#1117).
    const limits = await getPaymentLimits({
      schoolId: req.schoolId,
      asset: asset ? asset.split(':')[0] : undefined,
    });

    const student = await Student.findOne({ schoolId: req.schoolId, studentId: req.params.studentId });

    let feeAmount = student ? student.feeAmount : null;
    let feeConversion = null;
    let categoryInfo = null;

    if (feeCategory && student?.fees?.length > 0) {
      const fee = student.fees.find((f) => f.category === feeCategory);
      if (fee) {
        feeAmount = fee.amount;
        categoryInfo = { category: fee.category, amount: fee.amount, paid: fee.paid, totalPaid: fee.totalPaid || 0, remainingBalance: fee.remainingBalance || fee.amount };
      }
    }

    if (feeAmount) {
      feeConversion = await convertToLocalCurrency(feeAmount, 'XLM', targetCurrency);
    }

    const fees = student?.fees?.length > 0
      ? student.fees.map((f) => ({ category: f.category, amount: f.amount, paid: f.paid, totalPaid: f.totalPaid || 0, remainingBalance: f.remainingBalance || f.amount }))
      : [];

    res.json({
      walletAddress: req.school.stellarAddress,
      memo: req.params.studentId,
      acceptedAssets: Object.values(ACCEPTED_ASSETS).map((a) => ({ code: a.code, type: a.type, displayName: a.displayName, issuer: a.issuer ?? null })),
      paymentLimits: { min: limits.min, max: limits.max },
      minAmount: limits.min,
      maxAmount: limits.max,
      feeAmount,
      feeCategory: feeCategory || null,
      categoryInfo,
      fees,
      feeLocalEquivalent: feeConversion?.available
        ? { amount: feeConversion.localAmount, currency: feeConversion.currency, rate: feeConversion.rate, rateTimestamp: feeConversion.rateTimestamp }
        : null,
      note: 'Include the payment intent memo exactly when sending payment. MEMO_TEXT is recommended; wallets that cannot send text memos may use MEMO_ID or MEMO_HASH with the encoded form of the same reference. MEMO_RETURN is not recognised and such payments will not be matched.',
      // `memoType` keeps its original 'text' spelling — it is part of the
      // published API response and existing clients compare against it
      // directly. New clients should read `supportedMemoTypes` (#1118).
      memoType: 'text',
      supportedMemoTypes: SUPPORTED_MEMO_TYPES,
    });
  } catch (err) {
    next(err);
  }
}

// ====================== PAYMENT INTENT ======================
async function createPaymentIntent(req, res, next) {
  try {
    const { schoolId } = req;
    const { studentId, feeCategory } = req.body;

    const student = await Student.findOne({ schoolId, studentId });
    if (!student) return res.status(404).json({ error: 'Student not found', code: 'NOT_FOUND' });

    let feeAmount = student.feeAmount;
    let categoryInfo = null;

    if (feeCategory && student.fees?.length > 0) {
      const fee = student.fees.find((f) => f.category === feeCategory);
      if (!fee) return res.status(400).json({ error: `Fee category '${feeCategory}' not found for student`, code: 'INVALID_FEE_CATEGORY' });
      feeAmount = fee.amount;
      categoryInfo = { category: fee.category, amount: fee.amount, paid: fee.paid, totalPaid: fee.totalPaid || 0, remainingBalance: fee.remainingBalance || fee.amount };
    }

    const limitValidation = await validatePaymentAmount(feeAmount, { schoolId });
    if (!limitValidation.valid) return res.status(400).json({ error: limitValidation.error, code: limitValidation.code });

    const memo = crypto.randomBytes(4).toString('hex').toUpperCase();
    const ttlMs = Number(process.env.PAYMENT_INTENT_TTL_MS)
      || Number(process.env.PAYMENT_INTENT_TTL_SECONDS) * 1000 || 900_000;

    const intent = await PaymentIntent.create({
      schoolId,
      studentId,
      amount: feeAmount,
      feeCategory: feeCategory || null,
      memo,
      status: 'pending',
      expiresAt: new Date(Date.now() + ttlMs),
      startedAt: new Date(),
    });

    // Issue #634: Run a Soroban simulation dry-run before returning the intent
    // so the frontend can show the exact fee breakdown rather than an estimate.
    // A simulation failure returns 422 with simulation_error — the intent is
    // NOT persisted in that case because we cannot guarantee the transaction
    // will succeed on-chain (e.g. insufficient balance).
    let simulation = null;
    if (req.school.stellarAddress && feeAmount) {
      // Build a placeholder XDR for the fee estimation — no sequence number
      // is consumed because simulateTransaction is a read-only RPC call.
      const xdr = buildSimulationXdr({
        sourceAccount: req.school.stellarAddress,
        destination: req.school.stellarAddress,
        amount: String(feeAmount),
        memo,
      });

      if (xdr) {
        const simResult = await simulateTransaction(xdr);
        if (!simResult.success) {
          // Roll back the persisted intent before returning the error
          await PaymentIntent.findByIdAndDelete(intent._id).catch(() => {});
          return res.status(422).json({
            error: 'Transaction simulation failed — cannot guarantee fee accuracy',
            code: 'SIMULATION_FAILED',
            simulation_error: simResult.simulation_error,
          });
        }
        simulation = {
          fee_stroops: simResult.fee_stroops,
          resource_fee: simResult.resource_fee,
          instruction_count: simResult.instruction_count,
          cached: simResult.cached || false,
        };
      }
    }

    const intentObj = intent.toObject();
    res.status(201).json({
      ...intentObj,
      // Issue #1035: Include intentId in response so client can pass it back in submitTransaction
      // to ensure the submission is matched to the correct PENDING record
      intentId: intent._id.toString(),
      categoryInfo,
      // Issue #634: Exact fee breakdown from Soroban simulation dry-run
      simulation,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A payment intent with that memo already exists for this school', code: 'DUPLICATE_PAYMENT_INTENT' });
    }
    next(err);
  }
}

// ====================== SUBMIT XDR TRANSACTION ======================
function sendSubmissionResult(res, payment) {
  const hash = payment.txHash;
  const feeBumpTxHash = payment.feeBumpTxHash || null;
  if (payment.status === 'FAILED') {
    return res.status(400).json({
      verified: false, status: 'FAILED', hash, feeBumpTxHash,
      error: 'Stellar payment could not be confirmed', code: payment.suspicionReason,
    });
  }
  if (payment.status !== 'SUCCESS') {
    return res.status(202).json({ verified: false, hash, feeBumpTxHash, status: payment.status });
  }
  return res.json({
    verified: true, hash, feeBumpTxHash, status: 'SUCCESS',
    ledger: payment.ledgerSequence,
    confirmationState: payment.confirmationState,
    explorerUrl: getExplorerUrl(payment.ledgerTransactionHash || hash),
  });
}

async function submitTransaction(req, res, next) {
  const { schoolId, school } = req;
  let lease;
  let lockKey;
  let stopWatchdog;
  try {
    const { xdr, paymentIntentId } = req.body;
    if (!xdr) return res.status(400).json({ error: 'Missing xdr parameter', code: 'MISSING_XDR' });

    const provider = getProvider(undefined, req.school);
    const tx = new StellarSdk.Transaction(xdr, require('../config/stellarConfig').networkPassphrase);
    const transactionHash = tx.hash().toString('hex');

    const hashValidation = validateTransactionHash(transactionHash);
    if (!hashValidation.valid) {
      const err = new Error(hashValidation.error);
      err.code = hashValidation.code;
      return next(err);
    }

    const normalizedHash = hashValidation.normalized;
    const memo = tx.memo.value ? tx.memo.value.toString() : null;
    if (!memo) return res.status(400).json({ error: 'Transaction must include the student ID as a memo', code: 'MISSING_MEMO' });

    // Issue #1035: Match the specific PENDING record via paymentIntentId when provided
    // to avoid misattribution if multiple PENDING records exist for the same memo.
    // When paymentIntentId is not provided, fall back to matching by memo (backward compatibility).
    let paymentRecord;
    if (paymentIntentId) {
      const intent = await PaymentIntent.findById(paymentIntentId);
      if (!intent) {
        return res.status(404).json({ error: 'Payment intent not found', code: 'INTENT_NOT_FOUND' });
      }
      if (intent.schoolId !== req.schoolId) {
        return res.status(403).json({ error: 'Payment intent does not belong to this school', code: 'INTENT_MISMATCH' });
      }
      if (intent.status !== 'pending') {
        return res.status(400).json({ error: `Payment intent is not in pending status (status: ${intent.status})`, code: 'INTENT_NOT_PENDING' });
      }

      // Look for a PENDING payment record that corresponds to this intent
      paymentRecord = await Payment.findOne({
        schoolId: req.schoolId,
        studentId: intent.studentId,
        memo: intent.memo,
        status: 'PENDING',
      });
    } else {
      // Backward compatibility: match by memo alone (highest risk path)
      paymentRecord = await Payment.findOne({ schoolId: req.schoolId, memo, status: 'PENDING' }).sort({ createdAt: -1 });
    }

    if (!paymentRecord) {
      const studentObj = await Student.findOne({ schoolId: req.schoolId, studentId: memo });
      if (!studentObj) return res.status(404).json({ error: 'Associated student not found in the database. Cannot process transaction.', code: 'STUDENT_NOT_FOUND' });
      paymentRecord = new Payment({ schoolId: req.schoolId, studentId: studentObj.studentId || memo, memo, amount: 0 });
    }

    const transitionActor = req.user?.username || req.user?.id || 'payment-controller';
    setTraceAttributes({ schoolId: req.schoolId, paymentId: paymentRecord._id });
    paymentRecord = (await transitionPayment(paymentRecord, 'SUBMITTED', {
      performedBy: transitionActor,
      schoolId: req.schoolId,
      updates: { txHash: normalizedHash, transactionHash: normalizedHash, submittedAt: new Date() },
      initialUpdates: { txHash: normalizedHash, transactionHash: normalizedHash },
    })).payment;

    // Submit the XDR to Horizon. A submission error (network/SDK) means the tx
    // was never broadcast — fail immediately without polling.
    let txResponse;
    try {
      txResponse = await provider.submitPayment(tx);
    } catch (err) {
      paymentRecord = (await transitionPayment(paymentRecord, 'FAILED', {
        performedBy: transitionActor,
        schoolId: req.schoolId,
        updates: { suspicionReason: err.response?.data?.extras?.result_codes?.transaction ?? err.message },
      })).payment;
      logger.warn('[PaymentController] submitTransaction on-chain failure', { txHash: normalizedHash, suspicionReason: paymentRecord.suspicionReason });
      return res.status(400).json({ error: 'Transaction submission failed', code: 'TX_SUBMISSION_FAILED' });
    }

    const txHash = tx.hash().toString('hex');
    const rawMemo = tx.memo.value;
    const memo = decodeMemoToCanonical(tx.memo.type === 'hash' ? rawMemo?.toString('hex') : rawMemo, tx.memo.type);
    if (!memo) return res.status(400).json({ error: 'Transaction must include a valid payment memo', code: 'MISSING_MEMO' });
    const [operation] = tx.operations;
    if (tx.operations.length !== 1 || operation.type !== 'payment' ||
        operation.destination !== school.stellarAddress || !tx.signatures.length) {
      return res.status(400).json({ error: 'A signed payment to the school wallet is required', code: 'INVALID_PAYMENT' });
    }
    const asset = detectAsset({
      asset_type: operation.asset.getAssetType(),
      asset_code: operation.asset.getCode(),
      asset_issuer: operation.asset.getIssuer(),
    });
    if (!asset) return res.status(400).json({ error: 'Unsupported asset', code: 'UNSUPPORTED_ASSET' });
    const amount = normalizeToNumber(operation.amount);
    const limits = await validatePaymentAmount(amount, { schoolId, asset: asset.assetCode });
    if (!limits.valid) return res.status(400).json({ error: limits.error, code: limits.code });

    lockKey = submissionLockKey(schoolId, memo);
    lease = await lock.acquire(lockKey, SUBMISSION_LEASE_MS);
    if (lease) stopWatchdog = lock.startWatchdog(lockKey, lease.token, SUBMISSION_LEASE_MS);
    const existing = await Payment.findOne({ schoolId, txHash, deletedAt: null });
    if (existing) return sendSubmissionResult(res, existing);
    if (!lease) return res.status(409).json({ error: 'Payment submission is in progress', code: 'SUBMISSION_IN_PROGRESS' });

    const intent = paymentIntentId
      ? await PaymentIntent.findOne({ _id: paymentIntentId, schoolId })
      : await PaymentIntent.findOne({ schoolId, memo });
    if (paymentIntentId && !intent) return res.status(404).json({ error: 'Payment intent not found', code: 'INTENT_NOT_FOUND' });
    if (intent && (intent.schoolId !== schoolId || intent.memo !== memo)) {
      return res.status(400).json({ error: 'Payment memo does not match the intent', code: 'INTENT_MISMATCH' });
    }
    if (intent && (intent.status !== 'pending' || intent.expiresAt <= new Date())) {
      return res.status(400).json({ error: 'Payment intent is no longer pending', code: 'INTENT_NOT_PENDING' });
    }

    if (intent) {
      const inFlight = await Payment.findOne({ schoolId, memo, status: 'SUBMITTED', deletedAt: null });
      if (inFlight) return sendSubmissionResult(res, inFlight);
    }
    const studentId = intent?.studentId || memo;
    const student = await Student.findOne({ schoolId, studentId });
    if (!student) return res.status(404).json({ error: 'Associated student not found', code: 'STUDENT_NOT_FOUND' });

    const pending = await Payment.findOne({ schoolId, studentId, memo, status: 'PENDING' }).sort({ createdAt: -1 });
    const payment = pending || new Payment({ schoolId, studentId, memo, amount });
    const options = { performedBy: req.user?.username || req.user?.id || 'payment-controller', schoolId };
    const submitted = await transitionPayment(payment, 'SUBMITTED', {
      ...options,
      updates: {
        txHash, transactionHash: txHash, submittedAt: new Date(), signedSubmissionXdr: xdr,
        submissionIntentId: intent?._id,
        amount, assetCode: asset.assetCode, assetType: asset.assetType, senderAddress: operation.source || tx.source,
        feeAmount: intent?.amount ?? student.feeAmount,
        feeCategory: intent?.feeCategory || undefined,
      },
      initialUpdates: { txHash, transactionHash: txHash },
    });
    if (submitted.unchanged) return sendSubmissionResult(res, submitted.payment);

    const heldLease = lease;
    const stopRenewal = stopWatchdog;
    lease = null;
    stopWatchdog = null;
    const completion = finishSubmission(submitted.payment, tx, school, student, options.performedBy)
      .finally(async () => {
        stopRenewal();
        await lock.release(lockKey, heldLease.token);
      });
    let responseTimer;
    try {
      const pendingResponse = new Promise(resolve => {
        responseTimer = setTimeout(() => resolve(submitted.payment), 10_000);
      });
      return sendSubmissionResult(res, await Promise.race([completion, pendingResponse]));
    } finally {
      clearTimeout(responseTimer);
      completion.catch(error => {
        logger.error('Stellar payment submission will be recovered', { schoolId, txHash, error: error.message });
      });
    }
  } catch (err) {
    return next(err);
  } finally {
    stopWatchdog?.();
    if (lease) await lock.release(lockKey, lease.token);
  }
}

// ====================== VERIFY PAYMENT ======================
async function verifyPayment(req, res, next) {
  const startTime = Date.now();

  try {
    const { schoolId } = req;
    const { txHash } = req.body;

    if (!txHash) {
      const audit = makePaymentAuditLogger(req, schoolId, `missing-tx:${schoolId}`);
      await audit.failure('txHash is required', { receivedKeys: Object.keys(req.body || {}) });
      return res.status(400).json({ error: 'txHash is required', code: 'VALIDATION_ERROR' });
    }

    const hashValidation = validateTransactionHash(txHash);
    if (!hashValidation.valid) {
      const audit = makePaymentAuditLogger(req, schoolId, txHash);
      await audit.failure(hashValidation.error, { txHash, validationError: hashValidation.error });
      const err = new Error(hashValidation.error);
      err.code = hashValidation.code;
      return next(err);
    }

    const normalizedHash = hashValidation.normalized;
    const audit = makePaymentAuditLogger(req, schoolId, normalizedHash);

    // Idempotency — return cached result if already recorded
    const existing = await Payment.findOne({
      schoolId, $or: [{ txHash: normalizedHash }, { feeBumpTxHash: normalizedHash }],
    });
    if (existing) {
      setTraceAttributes({ schoolId, paymentId: existing._id });
      await audit.success({ txHash: normalizedHash, cached: true, studentId: existing.studentId, amount: existing.amount });

      const targetCurrency = req.school.localCurrency || 'USD';
      const conversion = await convertToLocalCurrency(existing.amount, existing.assetCode || 'XLM', targetCurrency);
      const stellarExplorerUrl = getExplorerUrl(existing.ledgerTransactionHash || existing.feeBumpTxHash || existing.txHash);

      return res.json({
        verified: existing.status === 'SUCCESS',
        cached: true,
        hash: existing.txHash,
        feeBumpTxHash: existing.feeBumpTxHash || null,
        stellarExplorerUrl,
        explorerUrl: stellarExplorerUrl,
        memo: existing.memo,
        studentId: existing.studentId,
        amount: existing.amount,
        ...Stroops.fromPayment(existing).toAmountFields(),
        assetCode: existing.assetCode,
        assetType: existing.assetType,
        feeAmount: existing.feeAmount,
        feeValidation: { status: existing.feeValidationStatus, excessAmount: existing.excessAmount },
        networkFee: existing.networkFee || null,
        date: existing.confirmedAt || existing.createdAt,
        status: existing.status,
        confirmationStatus: existing.confirmationStatus,
        localCurrency: {
          amount: conversion.available ? conversion.localAmount : null,
          currency: conversion.currency,
          rate: conversion.rate,
          rateTimestamp: conversion.rateTimestamp,
          available: conversion.available,
        },
      });
    }

    // Issue #69 — distributed lock prevents two replicas from concurrently
    // verifying the same transaction, which would risk a double-write race even
    // though the unique index on Payment { schoolId, txHash } is the ultimate
    // dedup guard.  The lock is keyed per (school, txHash) so only identical
    // concurrent verify calls contend — different hashes proceed in parallel.
    const provider = getProvider(undefined, req.school);
    const verifyLockKey = `sync:lock:${schoolId}:verify:${normalizedHash}`;
    // acquire() returns { token, fencingToken } (or null); release() needs the
    // raw token string, so destructure it — otherwise the lock never releases.
    const verifyLockInfo = await lock.acquire(verifyLockKey, VERIFY_LOCK_TTL_MS);
    if (!verifyLockInfo) {
      return res.status(409).json({ error: 'Sync already in progress', code: 'SYNC_IN_PROGRESS' });
    }
    const verifyToken = verifyLockInfo.token;

    try {
      let result;
      try {
        // Pass schoolId so verifyTransaction scopes the student lookup to this school (#845).
        result = await provider.queryStatus(normalizedHash, req.school.stellarAddress, schoolId);
      } catch (stellarErr) {
        if (PERMANENT_FAIL_CODES.includes(stellarErr.code)) {
          await audit.failure(stellarErr.message, { txHash: normalizedHash, errorCode: stellarErr.code });
          await Payment.create({ schoolId, studentId: 'unknown', txHash: normalizedHash, amount: 0, status: 'FAILED', feeValidationStatus: 'unknown' }).catch(err => logger.error('[PaymentController] failed to persist permanent failure record', { txHash: normalizedHash, error: err.message }));
          return next(stellarErr);
        }

        await audit.success({ txHash: normalizedHash, queuedForRetry: true, reason: stellarErr.message });
        await queueForRetry(normalizedHash, req.body.studentId || null, stellarErr.message, schoolId);
        return res.status(202).json({
          message: 'Stellar network is temporarily unavailable. Your transaction has been queued and will be verified automatically.',
          txHash: normalizedHash,
          status: 'queued_for_retry',
        });
      }

      if (!result) {
        await audit.failure('Transaction found but contains no valid payment to this school wallet', { txHash: normalizedHash });
        return res.status(404).json({ error: 'Transaction found but contains no valid payment to this school wallet', code: 'NOT_FOUND' });
      }

      const studentStrId = result.studentId || result.memo;
      const studentObj = await Student.findOne({ schoolId, studentId: studentStrId });
      if (!studentObj) {
        await audit.failure('Associated student not found', { txHash: normalizedHash, studentId: studentStrId });
        return res.status(404).json({ error: 'Associated student not found. Cannot record transaction.', code: 'STUDENT_NOT_FOUND' });
      }

      // Intents are a UX convenience; an expired intent must not block crediting (#848).
      // Mark it expired for bookkeeping but continue to record the payment.
      const intent = await PaymentIntent.findOne({ memo: result.memo, schoolId });
      if (intent?.expiresAt && intent.expiresAt < new Date()) {
        await PaymentIntent.findByIdAndUpdate(intent._id, { status: 'expired' });
      }

      // Issue #1026 — the tx-hash lock above only prevents two calls for the SAME
      // transaction from racing; two DIFFERENT transactions for the same student
      // can still verify concurrently. The balance write below is a non-atomic
      // read-aggregate-then-absolute-write, so it also needs a lock scoped to the
      // student, shared with syncPaymentsForSchool's equivalent section so the two
      // code paths serialize against each other too.
      const studentLockKey = lock.studentBalanceLockKey(schoolId, studentStrId);
      const studentLockInfo = await lock.acquire(studentLockKey, STUDENT_BALANCE_LOCK_TTL_MS);
      if (!studentLockInfo) {
        return res.status(409).json({ error: 'Sync already in progress', code: 'SYNC_IN_PROGRESS' });
      }
      const studentLockToken = studentLockInfo.token;

      let cumulativeTotal;
      let feeValidationStatus;
      let computedExcessAmount;
      let remainingBalance;
      let now;
      try {
        // Determine cumulative feeValidationStatus (#846).
        // Partial payments (amount < fee) are accepted — money is already on-chain.
        // The cumulative total drives the status; per-payment underpaid rejection
        // is not applied here because a parent may be paying in installments.
        //
        // Summed via $toDecimal (#1123 money-representation fix) so the addition
        // happens in exact Decimal128 space inside MongoDB — a plain `$sum` over
        // the `amount` doubles would accumulate float error server-side, before
        // the result ever reaches this function, and toFixed(7) cannot repair
        // that afterwards. classifyFeePayment then compares in exact Decimal
        // space, so an installment plan that sums exactly to the fee is never
        // misclassified by a float epsilon.
        const prevAgg = await Payment.aggregate([
          { $match: { schoolId, studentId: studentStrId, deletedAt: null, status: 'SUCCESS' } },
          { $group: { _id: null, total: { $sum: paymentAmountDecimal } } },
        ]);
        const prevTotal = asStroops(decimalFromMongo(prevAgg[0]?.total));
        const classification = classifyFeePayment(prevTotal.add(Stroops.fromPayment(result)), studentObj.feeAmount);
        cumulativeTotal = classification.cumulativeTotal;
        feeValidationStatus = classification.status;
        computedExcessAmount = classification.excessAmount;
        remainingBalance = classification.remainingBalance;

        now = new Date();

        // Issue #1027: Compute confirmationState using the same logic as syncPaymentsForSchool
        // to ensure manual verify produces consistent state machine values
        const confirmation = await determineConfirmationState(
          result.ledger || null,
          undefined,
          false,
        );

        try {
          await recordPayment({
            schoolId,
            studentId: studentStrId,
            txHash: result.hash,
            feeBumpTxHash: result.feeBumpTxHash,
            amount: result.amount,
            amountStroops: Stroops.fromPayment(result).value.toString(),
            feeAmount: result.feeAmount || studentObj.feeAmount,
            feeValidationStatus,
            excessAmount: computedExcessAmount,
            networkFee: result.networkFee,
            status: 'SUCCESS',
            memo: result.memo,
            senderAddress: result.senderAddress || null,
            ledgerSequence: result.ledger || null,
            confirmationStatus: confirmation.confirmationStatus,
            confirmationState: confirmation.state,
            confirmedAt: result.date ? new Date(result.date) : now,
            verifiedAt: now,
          });
        } catch (dupErr) {
          if (dupErr.code === 'DUPLICATE_TX') {
            // Concurrent path (poller or another verify call) already recorded this tx.
            // Fetch and return the existing record as a cache hit.
            const cached = await Payment.findOne({ schoolId, txHash: result.hash });
            if (cached) {
              await audit.success({ txHash: normalizedHash, cached: true, studentId: studentStrId, amount: cached.amount });
              const targetCurrency = req.school.localCurrency || 'USD';
              const cachedConv = await convertToLocalCurrency(cached.amount, cached.assetCode || 'XLM', targetCurrency);
              return res.json({
                verified: true, cached: true, hash: cached.txHash,
                stellarExplorerUrl: getExplorerUrl(cached.txHash), explorerUrl: getExplorerUrl(cached.txHash),
                memo: cached.memo, studentId: cached.studentId, amount: cached.amount,
                ...Stroops.fromPayment(cached).toAmountFields(),
                assetCode: cached.assetCode, feeAmount: cached.feeAmount,
                feeValidation: { status: cached.feeValidationStatus, excessAmount: cached.excessAmount },
                date: cached.confirmedAt || cached.createdAt, status: cached.status,
                localCurrency: {
                  amount: cachedConv.available ? cachedConv.localAmount : null,
                  currency: cachedConv.currency, rate: cachedConv.rate,
                  rateTimestamp: cachedConv.rateTimestamp, available: cachedConv.available,
                },
              });
            }
          }
          throw dupErr;
        }

        // Issue #1034: Update student balance using the unified balance updater.
        // This ensures verifyPayment, submitTransaction, and syncPaymentsForSchool
        // all use the same balance computation logic.
        const { updateStudentBalance } = require('../utils/studentBalanceUpdater');
        await updateStudentBalance(schoolId, studentStrId, {});
      } finally {
        await lock.release(studentLockKey, studentLockToken);
      }

      await audit.success({
        txHash: normalizedHash,
        studentId: studentStrId,
        amount: result.amount,
        ...Stroops.fromPayment(result).toAmountFields(),
        assetCode: result.assetCode || 'XLM',
        feeValidationStatus,
        duration: `${Date.now() - startTime}ms`,
      });

      // Auto-generate receipt (fire-and-forget)
      const { createReceipt } = require('../services/receiptService');
      createReceipt({
        txHash: result.hash,
        studentId: studentStrId,
        schoolId,
        amount: result.amount,
        ...Stroops.fromPayment(result).toAmountFields(),
        assetCode: result.assetCode || 'XLM',
        feeAmount: result.feeAmount || studentObj.feeAmount,
        feeValidationStatus,
        memo: result.memo,
        confirmedAt: result.date ? new Date(result.date) : now,
      }).catch(err => {
        // Fire-and-forget, but never silent (#1122). A systemic receipt failure
        // (bad template, receipt-model fault, downstream outage) must leave a
        // log trail and a metric, not wait for a parent to report it missing.
        logger.error('[PaymentController] receipt generation failed', {
          txHash: result.hash,
          correlationId: req.correlationId,
          schoolId,
          studentId: studentStrId,
          error: err.message,
          stack: err.stack,
        });
        try {
          require('../metrics').receiptGenerationFailuresTotal.inc({ source: 'verify_controller' });
        } catch (_) {
          // metrics module unavailable — logging above is still the primary signal
        }
      });

      const targetCurrency = req.school.localCurrency || 'USD';
      const conversion = await convertToLocalCurrency(result.amount, result.assetCode || 'XLM', targetCurrency);
      const stellarExplorerUrl = getExplorerUrl(result.feeBumpTxHash || result.hash);

      res.json({
        verified: true,
        cached: false,
        hash: result.hash,
        stellarExplorerUrl,
        explorerUrl: stellarExplorerUrl,
        memo: result.memo,
        studentId: studentStrId,
        amount: result.amount,
        ...Stroops.fromPayment(result).toAmountFields(),
        assetCode: result.assetCode,
        assetType: result.assetType,
        feeAmount: result.feeAmount || studentObj.feeAmount,
        feeValidation: { status: feeValidationStatus, excessAmount: computedExcessAmount },
        remainingBalance,
        networkFee: result.networkFee,
        date: result.date,
        localCurrency: {
          amount: conversion.available ? conversion.localAmount : null,
          currency: conversion.currency,
          rate: conversion.rate,
          rateTimestamp: conversion.rateTimestamp,
          available: conversion.available,
        },
      });
    } finally {
      await lock.release(verifyLockKey, verifyToken);
    }
  } catch (err) {
    await makePaymentAuditLogger(req, req.schoolId, req.body?.txHash || 'unknown')
      .failure(err.message, { error: err.message })
      .catch(() => logger.debug('[PaymentController] audit failure log missed', { txHash: req.body?.txHash || 'unknown' }));
    next(err);
  }
}

// ====================== VERIFY TX HASH (no school context) ======================
async function verifyTransactionHash(req, res, next) {
  try {
    const { txHash } = req.params;
    const tx = await server.transactions().transaction(txHash).call();
    res.json({
      hash: tx.hash,
      successful: tx.successful,
      created_at: tx.created_at,
      ledger: tx.ledger_attr || tx.ledger,
      memo: tx.memo,
      fee_paid: tx.fee_paid,
      source_account: tx.source_account,
      operations_count: tx.operation_count,
    });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ error: 'Transaction not found', code: 'NOT_FOUND' });
    next(wrapStellarError(err));
  }
}

module.exports = {
  getPaymentInstructions,
  createPaymentIntent,
  submitTransaction,
  verifyPayment,
  verifyTransactionHash,
  getExplorerUrl,
  wrapStellarError,
  // Re-export from split controllers so tests importing paymentController still work
  ...require('./paymentQueryController'),
  ...require('./paymentAdminController'),
};
