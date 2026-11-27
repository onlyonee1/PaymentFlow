'use strict';

const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const School = require('../models/schoolModel');
const Student = require('../models/studentModel');
const FeeStructure = require('../models/feeStructureModel');
const PaymentIntent = require('../models/paymentIntentModel');
const Payment = require('../models/paymentModel');
const { APP_URL } = require('../config');
const { validateDecimalAmount } = require('../utils/decimalPrecision');
const { createParentPaymentMemo, parentPaymentMemoPattern } = require('../utils/parentPaymentMemo');
const { validatePaymentAmount } = require('../utils/paymentLimits');
const { requireSchoolAuth } = require('../middleware/auth');
const { resolveSchool } = require('../middleware/schoolContext');
const { contractPaused } = require('../middleware/contractPaused');
const { verifyLimiter } = require('../middleware/rateLimiter');
const idempotency = require('../middleware/idempotency')({ criticalPaymentEndpoints: true });

const router = express.Router();
const DAY_MS = 86400000;
const objectId = /^[a-f0-9]{24}$/i;
const studentIdPattern = /^[A-Za-z0-9_-]{3,20}$/;

function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

function signature(encoded, secret, purpose) {
  return crypto.createHmac('sha256', secret).update(`paymentflow:${purpose}:${encoded}`).digest('base64url');
}

function sign(data, secret, purpose) {
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${encoded}.${signature(encoded, secret, purpose)}`;
}

async function readSignedToken(token, purpose) {
  const invalid = () => httpError(400, 'This payment link is invalid or has expired.');
  if (typeof token !== 'string' || token.length > 1024) throw invalid();
  const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!parts) throw invalid();
  const [, encoded, supplied] = parts;
  let data;
  try {
    data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof data?.schoolId !== 'string' || !data.schoolId || data.schoolId.length > 100 ||
      !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now()) throw invalid();
  // Fetch the document rather than using the lean cached school context so secret
  // decryption runs and a rotation invalidates QR codes immediately.
  const school = await School.findOne({ schoolId: data.schoolId, isActive: true });
  if (!school?.webhookSecret || school.maintenanceMode) throw invalid();
  const expected = signature(encoded, school.webhookSecret, purpose);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw invalid();
  return { data, school };
}

async function lookupFee(schoolId, feeId) {
  if (typeof feeId !== 'string' || !objectId.test(feeId)) return null;
  return FeeStructure.findOne({ schoolId, _id: feeId, isActive: true }).lean();
}

async function resolveLink(token) {
  const { data, school } = await readSignedToken(token, 'fee-qr');
  const fee = await lookupFee(school.schoolId, data.feeId);
  if (!fee || data.amount !== fee.feeAmount) {
    throw httpError(400, 'This fee has changed. Ask your school for a new QR code.');
  }
  return { data, school, fee };
}

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(err => {
    if (err.expose) return res.status(err.status).json({ error: err.message });
    next(err);
  });
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/fees/:feeId/qr', resolveSchool, requireSchoolAuth(['owner', 'staff']), route(async (req, res) => {
  const school = await School.findOne({ schoolId: req.schoolId, isActive: true });
  if (!school?.webhookSecret) throw httpError(409, 'Set up a school webhook secret before creating a payment QR code.');
  const fee = await lookupFee(school.schoolId, req.params.feeId);
  if (!fee) throw httpError(404, 'Active fee not found.');
  const amount = validateDecimalAmount(fee.feeAmount, { currency: 'XLM', minValue: 0.0000001 });
  if (!amount.ok) throw httpError(400, amount.error);
  const validation = await validatePaymentAmount(fee.feeAmount, { schoolId: school.schoolId, asset: 'XLM' });
  if (!validation.valid) throw httpError(400, validation.error);

  const expiresAt = Date.now() + 30 * DAY_MS;
  const signed = sign({ schoolId: school.schoolId, feeId: String(fee._id), amount: fee.feeAmount, expiresAt }, school.webhookSecret, 'fee-qr');
  const url = new URL('/pay', process.env.PARENT_PORTAL_URL || APP_URL || 'http://localhost:3000');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('PARENT_PORTAL_URL must use HTTPS in production');
  }
  url.hash = `qr=${signed}`;
  const qrImage = await QRCode.toDataURL(url.href, { width: 512, margin: 4, errorCorrectionLevel: 'M' });
  res.json({ url: url.href, expiresAt, qrImage });
}));

router.post('/link', verifyLimiter, route(async (req, res) => {
  const { data, school, fee } = await resolveLink(req.body?.token);
  res.json({ schoolName: school.name, feeName: fee.className, amount: data.amount, expiresAt: data.expiresAt });
}));

router.post('/intent', verifyLimiter, route(async (req, res, next) => {
  const { token, studentId } = req.body || {};
  if (typeof studentId !== 'string' || !studentIdPattern.test(studentId)) {
    throw httpError(400, 'Enter a valid student ID.');
  }
  req.paymentLink = await resolveLink(token);
  req.schoolId = req.paymentLink.school.schoolId;
  next();
}), contractPaused, idempotency, route(async (req, res) => {
  const { studentId } = req.body;
  const { data, school, fee } = req.paymentLink;
  const schoolId = school.schoolId;
  const student = await Student.findOne({ schoolId, studentId, class: fee.className }).select('studentId').lean();
  if (!student) throw httpError(404, 'This student ID does not match the fee. Check the ID and try again.');

  const limit = await validatePaymentAmount(data.amount, { schoolId, asset: 'XLM' });
  if (!limit.valid) throw httpError(400, limit.error);

  const memo = createParentPaymentMemo();
  const expiresAt = new Date(Date.now() + (parseInt(process.env.PAYMENT_INTENT_TTL_MS, 10) || DAY_MS));
  await PaymentIntent.create({ schoolId, studentId, amount: data.amount, memo, expiresAt });
  const receiptToken = sign({ schoolId, memo, expiresAt: Date.now() + 90 * DAY_MS }, school.webhookSecret, 'receipt');
  res.status(201).json({
    walletAddress: school.stellarAddress, network: school.network, memo, amount: data.amount,
    expiresAt: expiresAt.toISOString(), receiptToken,
  });
}));

router.post('/receipt', verifyLimiter, route(async (req, res) => {
  const { data, school } = await readSignedToken(req.body?.token, 'receipt');
  if (typeof data.memo !== 'string' || !parentPaymentMemoPattern.test(data.memo)) throw httpError(400, 'Invalid receipt link.');
  const payment = await Payment.findOne({
    schoolId: school.schoolId, memo: data.memo, status: 'SUCCESS', isSuspicious: { $ne: true },
  }).select('txHash amount assetCode confirmedAt').lean();
  if (!payment) return res.status(202).json({ pending: true });
  res.json({
    txHash: payment.txHash, amount: payment.amount, currency: payment.assetCode || 'XLM',
    confirmedAt: payment.confirmedAt, schoolName: school.name,
  });
}));

module.exports = router;
