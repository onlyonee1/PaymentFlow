'use strict';

const mongoose = require('mongoose');
const tenantScope = require('../plugins/tenantScope');

const schema = new mongoose.Schema({
  schoolId: { type: String, required: true },
  day: { type: String, required: true },
  observedAt: { type: Date, required: true },
  walletAddress: { type: String, required: true },
  initialBalance: { type: String, required: true },
  confirmedPayments: { type: String, required: true },
  confirmedRefunds: { type: String, required: true },
  expectedBalance: { type: String, required: true },
  actualBalance: { type: String, required: true },
  delta: { type: String, required: true },
  discrepancy: { type: Boolean, required: true },
  suspectTransactions: [{ _id: false, txHash: String, reason: String }],
  financeEmail: String,
  emailedAt: Date,
  slackAlertedAt: Date,
}, { collection: 'reconciliation_reports', timestamps: true });

schema.index({ schoolId: 1, day: 1 }, { unique: true });
schema.plugin(tenantScope, { modelName: 'SettlementReport' });

module.exports = mongoose.model('SettlementReport', schema);
