'use strict';

/**
 * Payment Plan Controller (#622)
 *
 * Manages payment plan lifecycle:
 *   POST   /:studentId                        — create a plan with instalment records + due dates
 *   GET    /:studentId                        — fetch the active plan
 *   PATCH  /:studentId/installment/:idx       — apply a payment (full or partial) to an instalment
 *   DELETE /:studentId                        — cancel the plan
 *
 * Partial payments: a payment that is less than the instalment amount reduces
 * the outstanding balance (paidAmount) without marking the instalment as paid.
 * Only when paidAmount reaches the full instalment amount is paid set to true.
 */

const PaymentPlan = require('../models/paymentPlanModel');
const Student     = require('../models/studentModel');
const { logAudit } = require('../services/auditService');
const Decimal = require('decimal.js');
const { validateDecimalAmount } = require('../utils/decimalPrecision');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute due dates for each instalment when the caller supplies an
 * intervalDays + startDate instead of explicit dueDate values.
 *
 * @param {Array}  instalments  - raw instalment objects from req.body
 * @param {string} [startDate]  - ISO date for the first instalment (default: now)
 * @param {number} [intervalDays] - days between instalments (default: 30)
 * @returns {Array} instalments with dueDate resolved
 */
function resolveInstalmentDueDates(instalments, startDate, intervalDays) {
  const base     = startDate ? new Date(startDate) : new Date();
  const interval = Number(intervalDays) || 30;

  return instalments.map((inst, i) => {
    if (inst.dueDate) {
      return { ...inst, dueDate: new Date(inst.dueDate) };
    }
    const due = new Date(base.getTime() + i * interval * 24 * 60 * 60 * 1000);
    return { ...inst, dueDate: due };
  });
}

// ── Controllers ───────────────────────────────────────────────────────────────

async function createPaymentPlan(req, res, next) {
  try {
    const { schoolId } = req;
    const { studentId } = req.params;
    const { installments, startDate, intervalDays } = req.body;

    if (!Array.isArray(installments) || installments.length === 0) {
      return res.status(400).json({ error: 'At least one installment is required', code: 'VALIDATION_ERROR' });
    }

    const normalizedInstallments = [];
    for (let index = 0; index < installments.length; index++) {
      const amount = validateDecimalAmount(installments[index]?.amount, { minValue: 0.01 });
      if (!amount.ok) {
        return res.status(400).json({
          error: `Installment ${index + 1}: ${amount.error}`,
          code: amount.code,
          field: `installments.${index}.amount`,
        });
      }
      normalizedInstallments.push({ ...installments[index], amount: amount.value });
    }

    const student = await Student.findOne({ schoolId, studentId });
    if (!student) {
      return res.status(404).json({ error: 'Student not found', code: 'NOT_FOUND' });
    }

    const totalAmount = normalizedInstallments.reduce((sum, installment) => sum.plus(installment.amount), new Decimal(0));

    const plan = await PaymentPlan.create({
      schoolId,
      studentId,
      totalAmount: totalAmount.toNumber(),
      installments: normalizedInstallments.map(inst => ({
        amount: inst.amount.toNumber(),
        dueDate: new Date(inst.dueDate),
        paid: false,
        paidAmount: 0,
      })),
    });

    if (req.auditContext) {
      await logAudit({
        schoolId,
        action: 'payment_plan_create',
        performedBy: req.auditContext.performedBy,
        targetId: studentId,
        targetType: 'payment_plan',
        details: { totalAmount: totalAmount.toString(), installmentCount: installments.length },
        result: 'success',
        ipAddress: req.auditContext.ipAddress,
        userAgent: req.auditContext.userAgent,
      });
    }

    res.status(201).json(plan);
  } catch (err) {
    next(err);
  }
}

async function getPaymentPlan(req, res, next) {
  try {
    const { schoolId } = req;
    const { studentId } = req.params;

    const plan = await PaymentPlan.findOne({ schoolId, studentId, deletedAt: null });
    if (!plan) {
      return res.status(404).json({ error: 'Payment plan not found', code: 'NOT_FOUND' });
    }

    res.json(plan);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /:studentId/installment/:installmentIndex
 *
 * Apply a payment amount to a specific instalment.
 *
 * - Full payment (paidAmount >= instalment.amount): marks instalment paid.
 * - Partial payment (paidAmount < instalment.amount): accumulates paidAmount,
 *   leaves paid: false, records the outstanding balance implicitly via
 *   (amount - paidAmount).
 *
 * When `paid: true` is sent explicitly it overrides the partial-payment logic
 * and closes the instalment regardless of paidAmount (admin override).
 */
async function updateInstallmentStatus(req, res, next) {
  try {
    const { schoolId } = req;
    const { studentId, installmentIndex } = req.params;
    const { paid, paidAmount } = req.body;

    const plan = await PaymentPlan.findOne({ schoolId, studentId, deletedAt: null });
    if (!plan) {
      return res.status(404).json({ error: 'Payment plan not found', code: 'NOT_FOUND' });
    }

    const idx = Number(installmentIndex);
    if (isNaN(idx) || idx < 0 || idx >= plan.installments.length) {
      return res.status(400).json({ error: 'Invalid installment index', code: 'VALIDATION_ERROR' });
    }

    const installment = plan.installments[installmentIndex];
    const normalizedAmount = validateDecimalAmount(paidAmount ?? installment.amount, { currency: 'XLM', minValue: 0 });
    if (!normalizedAmount.ok) {
      return res.status(400).json({ error: normalizedAmount.error, code: normalizedAmount.code, field: 'paidAmount' });
    }
    installment.paid = paid;
    installment.paidAmount = normalizedAmount.value.toNumber();
    if (paid) {
      installment.paidAt = new Date();
    }

    if (instalment.paid && !instalment.paidAt) {
      instalment.paidAt = new Date();
    }

    // Auto-complete the plan when every instalment is paid.
    const allPaid = plan.installments.every((i) => i.paid);
    if (allPaid) plan.status = 'completed';

    await plan.save();

    if (req.auditContext) {
      await logAudit({
        schoolId,
        action: 'installment_update',
        performedBy: req.auditContext.performedBy,
        targetId: studentId,
        targetType: 'payment_plan',
        details: {
          installmentIndex: idx,
          paid: instalment.paid,
          paidAmount: instalment.paidAmount,
          outstandingBalance: Math.max(0, instalment.amount - instalment.paidAmount),
        },
        result: 'success',
        ipAddress: req.auditContext.ipAddress,
        userAgent: req.auditContext.userAgent,
      });
    }

    res.json(plan);
  } catch (err) {
    next(err);
  }
}

async function cancelPaymentPlan(req, res, next) {
  try {
    const { schoolId } = req;
    const { studentId } = req.params;

    const plan = await PaymentPlan.findOne({ schoolId, studentId, deletedAt: null });
    if (!plan) {
      return res.status(404).json({ error: 'Payment plan not found', code: 'NOT_FOUND' });
    }

    plan.status    = 'cancelled';
    plan.deletedAt = new Date();
    await plan.save();

    if (req.auditContext) {
      await logAudit({
        schoolId,
        action: 'payment_plan_cancel',
        performedBy: req.auditContext.performedBy,
        targetId: studentId,
        targetType: 'payment_plan',
        details: {},
        result: 'success',
        ipAddress: req.auditContext.ipAddress,
        userAgent: req.auditContext.userAgent,
      });
    }

    res.json({ message: 'Payment plan cancelled' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createPaymentPlan,
  getPaymentPlan,
  updateInstallmentStatus,
  cancelPaymentPlan,
  // exported for tests
  resolveInstalmentDueDates,
};
