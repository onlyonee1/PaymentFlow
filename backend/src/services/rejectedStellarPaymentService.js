'use strict';

const mongoose = require('mongoose');
const { sendAdminAlert } = require('./alertService');

const schema = new mongoose.Schema({
  schoolId: { type: String, required: true },
  txHash: { type: String, required: true },
  operationId: { type: String, required: true },
  sender: String,
  reason: { type: String, enum: ['UNSUPPORTED_ASSET', 'INVALID_ISSUER'], required: true },
  transaction: Object,
  operation: Object,
  observedAt: Date,
  anomalyAlerted: { type: Boolean, default: false },
}, { collection: 'rejected_payments' });
schema.index({ schoolId: 1, txHash: 1, operationId: 1 }, { unique: true });
schema.index({ schoolId: 1, sender: 1, observedAt: -1 });
const RejectedPayment = mongoose.model('RejectedStellarPayment', schema);

async function recordRejectedPayment(schoolId, tx, operation, reason, operationId) {
  const identity = { schoolId, txHash: tx.hash, operationId };
  const sender = operation.from || tx.source_account;
  const event = await RejectedPayment.findOneAndUpdate(identity, {
    $setOnInsert: {
      sender,
      reason,
      transaction: JSON.parse(JSON.stringify(tx)),
      operation: JSON.parse(JSON.stringify(operation)),
      observedAt: new Date(),
    },
  }, { upsert: true, new: true });

  if (!sender || event.anomalyAlerted) return;

  const recent = await RejectedPayment.find({
    schoolId, sender, observedAt: { $gte: new Date(Date.now() - 3600000) },
  }).sort({ observedAt: 1, _id: 1 }).limit(3).lean();
  if (recent.length < 3) return;

  // Claim the threshold event so concurrent ingestion and retries share one alert.
  const result = await RejectedPayment.updateOne(
    { schoolId, _id: recent[2]._id, anomalyAlerted: false },
    { $set: { anomalyAlerted: true } },
  );
  if (result.modifiedCount) {
    await sendAdminAlert('Repeated rejected Stellar asset payments', { schoolId, sender, reason });
  }
}

module.exports = { recordRejectedPayment };
