'use strict';

const { isAcceptedAsset } = require('../config/stellarConfig');
const { withStellarRetry } = require('../utils/withStellarRetry');

async function captureUnmatchedPayments(tx, schoolId, walletAddress) {
  if (tx.successful !== true) return 0;
  const innerTx = tx.inner_transaction || tx;
  const source = typeof innerTx.operations === 'function' ? innerTx : tx;
  const operations = await withStellarRetry(() => source.operations(), {
    label: 'captureUnmatchedPayments.operations',
    context: `Transaction ${tx.hash} operations`,
  });
  let captured = 0;
  for (const [index, operation] of operations.records.entries()) {
    if (!['payment', 'path_payment_strict_send', 'path_payment_strict_receive'].includes(operation.type)
      || operation.to !== walletAddress) continue;
    const assetType = operation.asset_type;
    const assetCode = assetType === 'native' ? 'XLM' : operation.asset_code;
    if (!isAcceptedAsset(assetCode, assetType, operation.asset_issuer).accepted) continue;

    const OrphanedPayment = require('../models/orphanedPaymentModel');
    await OrphanedPayment.updateOne({
      schoolId,
      txHash: tx.hash,
      operationId: String(operation.id || operation.paging_token || index),
    }, {
      $setOnInsert: {
        amount: operation.amount,
        assetCode,
        assetType,
        sender: operation.from || tx.source_account,
        memo: innerTx.memo,
        ledger: tx.ledger_attr || tx.ledger || null,
        receivedAt: new Date(operation.created_at || tx.created_at),
        transaction: JSON.parse(JSON.stringify(tx)),
        operation: JSON.parse(JSON.stringify(operation)),
      },
    }, { upsert: true });
    captured++;
  }
  return captured;
}

module.exports = { captureUnmatchedPayments };
