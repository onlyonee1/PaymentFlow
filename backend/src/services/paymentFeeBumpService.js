'use strict';

const { BASE_FEE, Keypair, TransactionBuilder } = require('@stellar/stellar-sdk');
const { pollForLedgerInclusion, validatePaymentAgainstFee } = require('./stellarService');
const { PAYMENT_FAILURE_REASONS } = require('../constants/paymentStatus');
const Payment = require('../models/paymentModel');
const School = require('../models/schoolModel');
const Student = require('../models/studentModel');
const lock = require('./distributedLock');
const { transition } = require('./paymentTransitionService');
const { updateStudentBalance } = require('../utils/studentBalanceUpdater');
const stellar = require('../config/stellarConfig');
const logger = require('../utils/logger');

const BUMP_AFTER_MS = 60_000;
const DEFAULT_CEILING = 100_000;
const SUBMISSION_LEASE_MS = 30_000;
const RECOVERY_INTERVAL_MS = 10_000;
let recoveryTimer;
let recovering = false;

function submissionLockKey(schoolId, memo) {
  return `payment:submit:${schoolId}:${memo}`;
}

function feeSourceFor(school) {
  const secrets = JSON.parse(process.env.STELLAR_SCHOOL_FEE_SOURCE_SECRETS || '{}');
  const secret = Object.hasOwn(secrets, school.schoolId)
    ? secrets[school.schoolId]
    : process.env.STELLAR_FEE_SOURCE_SECRET;
  if (!secret) return null;
  const signer = Keypair.fromSecret(secret);
  // The single-key deployment setting can only sponsor its own school's wallet.
  return Object.hasOwn(secrets, school.schoolId) || signer.publicKey() === school.stellarAddress
    ? signer : null;
}

async function feeStats() {
  try {
    return await stellar.server.feeStats();
  } catch (error) {
    logger.warn('Unable to read Stellar fee statistics', { error: error.message });
    return {};
  }
}

function buildFeeBump(tx, signer, stats) {
  const multiplier = Number(process.env.FEE_BUMP_MULTIPLIER ?? 10);
  const ceiling = Number(process.env.FEE_BUMP_MAX_FEE_STROOPS ?? DEFAULT_CEILING);
  // Stellar counts the envelope as an extra operation when calculating the total fee.
  const operationCount = tx.operations.length + 1;
  const originalFee = Math.ceil(Number(tx.fee) / tx.operations.length);
  const minimum = Math.max(Number(BASE_FEE), Number(stats.last_ledger_base_fee) || 0, originalFee);
  if (!Number.isFinite(multiplier) || multiplier <= 1 || !Number.isSafeInteger(ceiling)) {
    throw new Error('Invalid Stellar fee bump configuration');
  }
  const marketFee = Number(stats.fee_charged?.p80) || 0;
  const baseFee = Math.min(Math.floor(ceiling / operationCount),
    Math.max(minimum, Math.ceil(originalFee * multiplier), marketFee));
  if (baseFee < minimum || baseFee <= originalFee) throw new Error('Stellar fee bump exceeds the configured fee ceiling');
  const bump = TransactionBuilder.buildFeeBumpTransaction(signer, String(baseFee), tx, stellar.networkPassphrase);
  bump.sign(signer);
  return bump;
}

function resultCode(error) {
  return error.response?.data?.extras?.result_codes?.transaction;
}

function hardRejection(error) {
  const code = resultCode(error);
  if (code === 'tx_insufficient_fee' || code === 'tx_bad_seq') return false;
  const status = error.response?.status ?? error.response?.statusCode;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function submitToHorizon(tx, state) {
  // Polling runs independently of Horizon's synchronous submit response.
  void Promise.resolve().then(() => stellar.server.submitTransaction(tx)).then(result => {
    state.result = result;
  }).catch(error => {
    if (hardRejection(error)) state.rejection = resultCode(error) || 'TX_SUBMISSION_FAILED';
    logger.warn('Horizon payment submission returned an error', {
      hash: tx.hash().toString('hex'),
      code: resultCode(error) || error.code,
    });
  });
}

async function submitPaymentWithFeeBump(payment, tx, school, recordBumpHash) {
  const original = { hash: payment.txHash };
  const bumped = { hash: payment.feeBumpTxHash };
  let included;
  let bumpAttempt;
  let failureReason;
  let closed = false;
  await feeStats(); // A signed envelope fixes the original bid.
  const submittedAt = payment.submittedAt.getTime();
  const bumpAt = submittedAt + BUMP_AFTER_MS;
  const deadline = submittedAt + Math.max(2 * BUMP_AFTER_MS, Number(process.env.FINALITY_POLL_TIMEOUT_MS) || 300_000);
  if (Date.now() < deadline) {
    if (payment.signedFeeBumpXdr) {
      const bump = TransactionBuilder.fromXDR(payment.signedFeeBumpXdr, stellar.networkPassphrase);
      submitToHorizon(bump, bumped);
    } else {
      submitToHorizon(tx, original);
    }
  }

  async function attemptBump() {
    try {
      const signer = feeSourceFor(school);
      if (!signer || tx.operations.some(operation => operation.source && operation.source !== tx.source)) return;
      // Classic transactions cannot be rescued after their signed bounds expire.
      const maxTime = Number(tx.timeBounds?.maxTime || 0);
      if (maxTime && maxTime <= Date.now() / 1000) return;
      // Sponsor only envelopes with a direct signature from the payment source.
      const source = Keypair.fromPublicKey(tx.source);
      if (!tx.signatures.some(signature => source.verify(tx.hash(), signature.signature()))) return;

      const bump = buildFeeBump(tx, signer, await feeStats());
      const hash = bump.hash().toString('hex');
      if (closed || included || original.result?.ledger) return;
      await recordBumpHash(hash, bump.toXDR());
      bumped.hash = hash;
      if (!closed && !included && !original.result?.ledger) submitToHorizon(bump, bumped);
    } catch (error) {
      logger.warn('Unable to sponsor pending Stellar payment', { txHash: original.hash, error: error.message });
    }
  }

  function lookup(state) {
    if (state.result?.ledger) return state.result;
    return stellar.server.transactions().transaction(state.hash).call();
  }

  const outcome = await pollForLedgerInclusion(payment, original.hash, {
    timeoutMs: Math.max(1000, deadline - Date.now()),
    stopOnInclusion: true,
    wakeAt: bumpAt,
    async findTransaction() {
      const hashes = bumped.hash ? [original, bumped] : [original];
      const results = await Promise.allSettled(hashes.map(lookup));
      const included = results.filter(result => result.status === 'fulfilled');
      if (included.length) {
        return included.find(({ value }) => value.successful === true)?.value || included[0].value;
      }
      if (original.rejection && !bumped.hash) {
        failureReason = original.rejection;
        return { successful: false };
      }
      if (!bumped.hash && !bumpAttempt && Date.now() >= bumpAt && Date.now() < deadline && results[0].reason?.response &&
          (results[0].reason.response.status ?? results[0].reason.response.statusCode) === 404) {
        bumpAttempt = attemptBump();
      }
      const networkError = results.find(({ reason }) =>
        (reason?.response?.status ?? reason?.response?.statusCode) !== 404);
      throw (networkError || results[0]).reason;
    },
    onInclusion: result => { if (result.successful) included = result; },
  }).finally(() => { closed = true; });
  return {
    ...outcome,
    failureReason: failureReason || outcome.failureReason,
    included,
  };
}

async function notifyPaymentTimeout(payment, student) {
  if (!student?.parentEmail || student.parentEmailSuppressed) return;
  try {
    const result = await require('./email').sendEmail({
      to: student.parentEmail,
      subject: 'Stellar payment confirmation timed out',
      text: `We could not confirm payment ${payment.txHash} before the confirmation window expired. Check your wallet or contact your school before sending another payment.`,
      category: 'payment_failed',
    });
    if (!result.sent && !result.skipped) logger.warn('Payment timeout email was not delivered', { txHash: payment.txHash });
  } catch (error) {
    logger.warn('Unable to send payment timeout email', { txHash: payment.txHash, error: error.message });
  }
}

async function finishSubmission(payment, tx, school, student, performedBy) {
  const { schoolId, studentId, txHash } = payment;
  const options = { performedBy, schoolId, emitPaymentSaved: true, clearSubmissionEnvelopes: true };
  const result = await submitPaymentWithFeeBump(payment, tx, school, async (feeBumpTxHash, signedFeeBumpXdr) => {
    const update = await Payment.updateOne(
      { _id: payment._id, schoolId, status: 'SUBMITTED', feeBumpTxHash: { $exists: false } },
      { $set: { feeBumpTxHash, signedFeeBumpXdr } },
    );
    if (!update.modifiedCount) throw new Error('Payment is no longer eligible for a fee bump');
  });

  if (result.status === 'FAILED') {
    const failed = await transition(payment, 'FAILED', {
      ...options, reason: result.failureReason,
      updates: {
        confirmationStatus: 'failed', confirmationState: result.confirmationState,
        suspicionReason: result.failureReason,
      },
    });
    if (!failed.unchanged && [PAYMENT_FAILURE_REASONS.FINALITY_TIMEOUT, PAYMENT_FAILURE_REASONS.STELLAR_NETWORK_ERROR].includes(result.failureReason)) {
      await notifyPaymentTimeout(failed.payment, student);
    }
    return failed.payment;
  }

  const validation = validatePaymentAgainstFee(payment.amount, payment.feeAmount);
  const confirmed = await transition(payment, 'SUCCESS', {
    ...options,
    paymentIntentId: payment.submissionIntentId,
    updates: {
      confirmedAt: new Date(), ledger: result.ledger, ledgerSequence: result.ledger,
      ledgerTransactionHash: result.included?.hash || txHash,
      confirmationStatus: result.confirmationStatus,
      confirmationState: result.confirmationState,
      feeValidationStatus: validation.status,
      excessAmount: validation.excessAmount,
    },
  });
  if (!confirmed.unchanged) {
    await updateStudentBalance(schoolId, studentId).catch(error => {
      logger.error('Failed to update student balance after submitTransaction', { schoolId, studentId, txHash, error: error.message });
    });
  }
  return confirmed.payment;
}

async function recoverSubmission(pending) {
  const { _id, schoolId, memo } = pending;
  await lock.withLock(submissionLockKey(schoolId, memo), SUBMISSION_LEASE_MS, async () => {
    const payment = await Payment.findOne({ _id, schoolId, status: 'SUBMITTED', deletedAt: null })
      .select('+signedSubmissionXdr +signedFeeBumpXdr +submissionIntentId');
    if (!payment?.signedSubmissionXdr) return;
    const [school, student] = await Promise.all([
      School.findOne({ schoolId }),
      Student.findOne({ schoolId, studentId: payment.studentId }),
    ]);
    const tx = TransactionBuilder.fromXDR(payment.signedSubmissionXdr, stellar.networkPassphrase);
    await finishSubmission(payment, tx, school || { schoolId }, student, 'payment-submission-recovery');
  });
}

async function recoverSubmissions() {
  if (recovering) return;
  recovering = true;
  try {
    const pending = await Payment.find({ status: 'SUBMITTED', signedSubmissionXdr: { $exists: true }, deletedAt: null })
      .bypassTenantScope().sort({ submittedAt: 1 }).select('_id schoolId memo').limit(50);
    for (let index = 0; index < pending.length; index += 5) {
      const outcomes = await Promise.allSettled(pending.slice(index, index + 5).map(recoverSubmission));
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') logger.error('Unable to recover submitted Stellar payment', { error: outcome.reason.message });
      }
    }
  } catch (error) {
    logger.error('Unable to scan submitted Stellar payments', { error: error.message });
  } finally {
    recovering = false;
  }
}

function startPaymentSubmissionRecovery() {
  if (recoveryTimer) return;
  recoveryTimer = setInterval(recoverSubmissions, RECOVERY_INTERVAL_MS);
  recoveryTimer.unref();
  void recoverSubmissions();
}

function stopPaymentSubmissionRecovery() {
  clearInterval(recoveryTimer);
  recoveryTimer = undefined;
}

module.exports = {
  finishSubmission,
  submissionLockKey,
  SUBMISSION_LEASE_MS,
  startPaymentSubmissionRecovery,
  stopPaymentSubmissionRecovery,
};
