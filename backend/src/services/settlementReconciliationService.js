'use strict';

const Decimal = require('decimal.js');
const axios = require('axios');
const School = require('../models/schoolModel');
const Payment = require('../models/paymentModel');
const Refund = require('../models/refundModel');
const SettlementReport = require('../models/settlementReportModel');
const { PAYMENT_STATUS } = require('../constants/paymentStatus');
const { STELLAR_NETWORK } = require('../config');
const { withLock } = require('./distributedLock');
const { createClient, getClient } = require('./stellarRateLimitedClient');
const { _upsertDiscrepancy } = require('./providerReconciliationJob');
const { sendEmail } = require('./email');
const logger = require('../utils/logger').child('SettlementReconciliation');

const DAY_MS = 86400000;
const THRESHOLD = new Decimal('0.01');
const clients = new Map();

function clientFor(network) {
  if (!network || network === STELLAR_NETWORK) return getClient();
  if (!clients.has(network)) {
    const horizonUrl = network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
    clients.set(network, createClient({ horizonUrl }));
  }
  return clients.get(network);
}

async function paymentTotals(schoolId, observedAt) {
  const [payments, refunds] = await Promise.all([
    Payment.aggregate([
      { $match: {
        schoolId,
        status: { $in: [PAYMENT_STATUS.SUCCESS, PAYMENT_STATUS.DISPUTED, PAYMENT_STATUS.REFUNDED] },
        assetCode: { $in: ['XLM', null] },
        confirmedAt: { $type: 'date', $lte: observedAt },
      } },
      { $group: { _id: null, total: { $sum: { $toDecimal: '$amount' } } } },
    ]),
    Refund.aggregate([
      { $match: { schoolId, status: 'confirmed', confirmedAt: { $type: 'date', $lte: observedAt } } },
      { $lookup: {
        from: Payment.collection.name,
        localField: 'originalTxHash',
        foreignField: 'txHash',
        as: 'original',
        pipeline: [{ $match: { schoolId, assetCode: { $in: ['XLM', null] } } }],
      } },
      { $match: { 'original.0': { $exists: true } } },
      { $group: { _id: null, total: { $sum: { $toDecimal: '$amount' } } } },
    ]),
  ]);
  return [payments, refunds].map(([row]) => new Decimal(row?.total.toString() || '0'));
}

async function suspectTransactions(school, client, start, end) {
  const schoolId = school.schoolId;
  const window = { $gte: start, $lte: end };
  const [payments, refunds] = await Promise.all([
    Payment.find({ schoolId, confirmedAt: window, status: { $in: ['SUCCESS', 'DISPUTED', 'REFUNDED'] } })
      .includeDeleted().select('txHash').lean(),
    Refund.find({ schoolId, status: 'confirmed', confirmedAt: window }).select('refundTxHash').lean(),
  ]);
  const local = new Set([...payments.map(p => p.txHash), ...refunds.map(r => r.refundTxHash)].filter(Boolean));
  const suspects = new Map();
  let cursor;
  for (;;) {
    const { records = [] } = await client.getTransactionsForAccount(school.stellarAddress, { limit: 200, cursor });
    let reachedStart = false;
    for (const tx of records) {
      const time = new Date(tx.created_at);
      if (time < start) {
        reachedStart = true;
        break;
      }
      if (time <= end && tx.successful !== false && !local.delete(tx.hash)) {
        suspects.set(tx.hash, 'On-chain transaction without a matching confirmed payment or refund in the report window');
      }
    }
    if (reachedStart || records.length < 200) break;
    const nextCursor = records[records.length - 1].paging_token;
    if (!nextCursor || nextCursor === cursor) throw new Error('Horizon settlement cursor did not advance');
    cursor = nextCursor;
  }
  for (const hash of local) suspects.set(hash, 'Confirmed payment or refund without a matching on-chain transaction in the report window');
  return [...suspects].map(([txHash, reason]) => ({ txHash, reason }))
    .sort((a, b) => a.txHash.localeCompare(b.txHash));
}

async function createDailyReport(school, day) {
  const client = clientFor(school.network);
  const balances = await client.getAccountBalances(school.stellarAddress);
  const native = balances.find(balance => balance.asset_type === 'native');
  if (!native) throw new Error('Horizon returned no native XLM balance');

  const observedAt = new Date();
  const start = new Date(`${day}T00:00:00.000Z`);
  if (observedAt < start || observedAt >= new Date(start.getTime() + DAY_MS)) {
    throw new Error('A live balance snapshot can only be created for the current UTC day');
  }
  const [payments, refunds] = await paymentTotals(school.schoolId, observedAt);
  const initial = new Decimal(school.settlementInitialBalanceXlm || '0');
  const expected = initial.plus(payments).minus(refunds);
  const actual = new Decimal(native.balance);
  const delta = actual.minus(expected);
  const discrepancy = delta.abs().gt(THRESHOLD);
  let suspects = [];
  if (discrepancy) {
    try {
      suspects = await suspectTransactions(school, client, start, observedAt);
    } catch (err) {
      logger.error('Could not collect settlement suspect transactions', { schoolId: school.schoolId, error: err.message });
      throw err;
    }
  }

  return SettlementReport.create({
    schoolId: school.schoolId, day, observedAt, walletAddress: school.stellarAddress,
    initialBalance: initial.toFixed(7), confirmedPayments: payments.toFixed(7), confirmedRefunds: refunds.toFixed(7),
    expectedBalance: expected.toFixed(7), actualBalance: actual.toFixed(7), delta: delta.toFixed(7),
    discrepancy, suspectTransactions: suspects, financeEmail: school.financeEmail || school.contactEmail || school.adminEmail,
  });
}

async function deliverReport(report) {
  const { schoolId, day, expectedBalance, actualBalance, delta } = report;
  const key = { schoolId, day };
  const summary = [
    `School: ${schoolId} | Settlement date: ${day} UTC`,
    `Expected: ${expectedBalance} XLM | Actual: ${actualBalance} XLM | Delta: ${delta} XLM`,
  ].join('\n');

  if (report.discrepancy) {
    await _upsertDiscrepancy({
      schoolId, jobRunId: `settlement:${day}`, discrepancyType: 'SETTLEMENT_BALANCE_MISMATCH',
      details: { day, expectedBalance, actualBalance, delta },
    });
    logger.warn('Settlement balance exceeds discrepancy threshold', key);
  }

  const deliveries = await Promise.allSettled([
    (async () => {
      if (report.emailedAt || !report.financeEmail) return;
      const text = [
        summary,
        `Initial balance: ${report.initialBalance} XLM`,
        `Confirmed payments: ${report.confirmedPayments} XLM`,
        `Confirmed refunds: ${report.confirmedRefunds} XLM`,
        'Suspect transactions:',
        ...(report.suspectTransactions.length
          ? report.suspectTransactions.map(({ txHash, reason }) => `${txHash} — ${reason}`)
          : ['None identified']),
      ].join('\n');
      const result = await sendEmail({
        to: report.financeEmail, subject: report.discrepancy ? 'Stellar settlement discrepancy' : 'Daily Stellar settlement report',
        text, category: 'settlement_reconciliation',
      });
      if (!result.sent) throw new Error('Finance email did not send');
      await SettlementReport.updateOne(key, { $set: { emailedAt: new Date() } });
    })(),
    (async () => {
      const webhook = process.env.RECONCILIATION_SLACK_WEBHOOK_URL;
      if (!report.discrepancy || report.slackAlertedAt || !webhook) return;
      try {
        await axios.post(webhook, { text: `Stellar settlement discrepancy\n${summary}` }, { timeout: 10000 });
      } catch (err) {
        throw new Error(`Slack delivery failed (${err.response?.status || err.code || 'network error'})`);
      }
      await SettlementReport.updateOne(key, { $set: { slackAlertedAt: new Date() } });
    })(),
  ]);
  for (const delivery of deliveries) {
    if (delivery.status === 'rejected') logger.error('Settlement report delivery failed', { ...key, error: delivery.reason.message });
  }
}

async function runDailySettlementReconciliation({ day = new Date().toISOString().slice(0, 10) } = {}) {
  const schools = await School.find({ isActive: true }).select('+financeEmail +settlementInitialBalanceXlm').lean();
  const reports = [];
  for (const school of schools) {
    const { schoolId } = school;
    try {
      const run = await withLock(`settlement:${schoolId}:${day}`, 60000, async () => {
        let report = await SettlementReport.findOne({ schoolId, day }).lean();
        if (!report) {
          try {
            report = await createDailyReport(school, day);
          } catch (err) {
            if (err.code !== 11000) throw err;
            report = await SettlementReport.findOne({ schoolId, day }).lean();
            if (!report) throw err;
          }
        }
        await deliverReport(report);
        return report;
      });
      if (run) reports.push(run.result);
    } catch (err) {
      logger.error('School settlement reconciliation failed', { schoolId, day, error: err.message });
    }
  }
  return reports;
}

module.exports = { runDailySettlementReconciliation };
