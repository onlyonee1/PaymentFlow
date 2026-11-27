'use strict';

const mongoose = require('mongoose');
const tenantScope = require('../plugins/tenantScope');

const schema = new mongoose.Schema({
  schoolId: { type: String, required: true },
  txHash: { type: String, required: true },
  operationId: { type: String, required: true },
  amount: { type: String, required: true },
  assetCode: String,
  assetType: String,
  sender: String,
  memo: String,
  ledger: Number,
  receivedAt: Date,
  transaction: Object,
  operation: Object,
  matchedAt: { type: Date, default: null },
  matchedBy: String,
  studentId: String,
  feeCategory: String,
}, { collection: 'orphaned_payments' });

schema.index({ schoolId: 1, txHash: 1, operationId: 1 }, { unique: true });
schema.index({ schoolId: 1, matchedAt: 1, receivedAt: -1, _id: -1 });
schema.plugin(tenantScope, { modelName: 'OrphanedPayment' });

module.exports = mongoose.model('OrphanedPayment', schema);
