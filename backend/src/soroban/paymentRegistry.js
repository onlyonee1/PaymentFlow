'use strict';

const { Address, Asset, BASE_FEE, Contract, SorobanRpc, nativeToScVal, scValToNative, TransactionBuilder, xdr } = require('@stellar/stellar-sdk');

const MAX_BATCH_SIZE = 10;
const EVENT_NAME = 'PaymentsBatchRegistered';

async function buildBatchTransaction({ payer, recipient, contractId, rpcUrl, networkPassphrase, payments }) {
  const server = new SorobanRpc.Server(rpcUrl);
  const source = await server.getAccount(payer);
  const asset = Asset.native().contractId(networkPassphrase);
  const paymentVector = xdr.ScVal.scvVec(payments.map(({ paymentId, amountStroops }) =>
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('amount_stroops'), val: nativeToScVal(amountStroops, { type: 'i128' }) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('payment_id'), val: xdr.ScVal.scvSymbol(paymentId) }),
    ])
  ));
  const operation = new Contract(contractId).call('batch_register_payment',
    new Address(payer).toScVal(), new Address(recipient).toScVal(),
    new Address(asset).toScVal(), paymentVector);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .addOperation(operation).setTimeout(60).build();
  const simulation = await server.simulateTransaction(tx);
  if (!SorobanRpc.Api.isSimulationSuccess(simulation) || SorobanRpc.Api.isSimulationRestore(simulation)) {
    throw new Error('Could not simulate the batch payment');
  }
  const prepared = SorobanRpc.assembleTransaction(tx, simulation).build();
  return {
    xdr: prepared.toXDR(),
    instructions: simulation.transactionData.build().resources().instructions(),
    txHash: prepared.hash().toString('hex'),
    expiresAt: new Date(Number(prepared.timeBounds.maxTime) * 1000),
  };
}

function parsePaymentsBatchRegistered(event, contractId) {
  if (event.contractId?.contractId() !== contractId || event.topic.length !== 2
      || event.topic.map(scValToNative).join(':') !== `registry:${EVENT_NAME}`) return null;

  const { schemaVersion, payment_ids: ids, payments, payer, recipient, asset } = scValToNative(event.value);
  if (schemaVersion !== 1 || !Array.isArray(ids) || !ids.length
      || ids.length > MAX_BATCH_SIZE || new Set(ids).size !== ids.length
      || !Array.isArray(payments) || payments.length !== ids.length
      || payments.some((payment, index) => payment.payment_id !== ids[index]
        || typeof payment.amount_stroops !== 'bigint' || payment.amount_stroops <= 0n)) {
    throw new Error('Invalid PaymentsBatchRegistered event');
  }
  return payments.map(({ payment_id: paymentId, amount_stroops: amountStroops }) => ({
    paymentId, amountStroops: amountStroops.toString(), payer, recipient, asset,
  }));
}

async function getConfirmedBatch({ rpcUrl, contractId, txHash, ledger, confirmationThreshold }) {
  const server = new SorobanRpc.Server(rpcUrl);
  const topics = ['registry', EVENT_NAME].map((topic) =>
    xdr.ScVal.scvSymbol(topic).toXDR('base64'));
  const { events, latestLedger } = await server.getEvents({
    startLedger: ledger,
    filters: [{ type: 'contract', contractIds: [contractId], topics: [topics] }],
  });
  if (latestLedger - ledger < confirmationThreshold) return null;

  const event = events.find((row) => row.ledger === ledger && row.txHash === txHash
    && row.inSuccessfulContractCall);
  if (!event) return null;
  const payments = parsePaymentsBatchRegistered(event, contractId);
  return payments && { payments, closedAt: new Date(event.ledgerClosedAt) };
}

module.exports = { MAX_BATCH_SIZE, buildBatchTransaction, parsePaymentsBatchRegistered, getConfirmedBatch };
