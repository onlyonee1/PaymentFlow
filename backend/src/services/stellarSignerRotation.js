'use strict';

const { Keypair, Operation, Transaction, TransactionBuilder, BASE_FEE } = require('@stellar/stellar-sdk');
const { server, networkPassphrase } = require('../config/stellarConfig');
const State = require('../models/stellarSignerModel');
const { encryptSecretKey, getKeypair } = require('../utils/signerKeyManager');
const logger = require('../utils/logger');

const LEDGER_MARGIN_SECONDS = 30;
const CEREMONY_TX_TIMEOUT_SECONDS = 60;
const CEREMONY_INTERVAL_MS = 5000;

function managedAccount() {
  return process.env.STELLAR_MANAGED_SIGNER_ACCOUNT;
}

function rotationWindowSeconds() {
  const minutes = Number(process.env.KEY_ROTATION_WINDOW_MINUTES ?? 15);
  if (!Number.isFinite(minutes) || minutes * 60 <= LEDGER_MARGIN_SECONDS || minutes > 55) {
    throw new Error('KEY_ROTATION_WINDOW_MINUTES must be greater than 0.5 and at most 55');
  }
  return minutes * 60;
}

function ceremonySource(account) {
  const seed = process.env.STELLAR_ROTATION_FEE_SOURCE_SECRET;
  if (!seed) throw httpError(503, 'Stellar rotation fee source is not configured');
  const pair = Keypair.fromSecret(seed);
  if (pair.publicKey() === account) throw httpError(503, 'Rotation fee source must be a separate account');
  return pair;
}

function signerRecord(pair) {
  return { publicKey: pair.publicKey(), encryptedSecret: encryptSecretKey(pair.secret()) };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function provisionSigner(secret) {
  const account = managedAccount();
  if (!account) throw new Error('STELLAR_MANAGED_SIGNER_ACCOUNT is required');
  const pair = Keypair.fromSecret(secret);
  const ledger = await server.loadAccount(account);
  if (!usableWeight(ledger, pair.publicKey())) throw new Error('Bootstrap signer cannot authorize this account');
  return State.updateOne({ _id: account }, { $setOnInsert: { active: signerRecord(pair) } }, { upsert: true });
}

function weightFor(account, key) {
  return account.signers.find((signer) => signer.key === key && signer.type === 'ed25519_public_key')?.weight ?? 0;
}

function usableWeight(account, key) {
  const weight = weightFor(account, key);
  return weight >= Math.max(1, account.thresholds.low_threshold, account.thresholds.med_threshold,
    account.thresholds.high_threshold) ? weight : 0;
}

async function initiateRotation(actor) {
  const account = managedAccount();
  if (!account) throw httpError(503, 'Managed Stellar signer is disabled');
  const feeSource = ceremonySource(account);
  const txTimeout = Number(process.env.STELLAR_TX_TIMEOUT_SECONDS || 300);
  if (!Number.isFinite(txTimeout) || txTimeout <= 0 ||
      rotationWindowSeconds() <= txTimeout + LEDGER_MARGIN_SECONDS) {
    throw httpError(503, 'Rotation window must exceed the managed transaction timeout and ledger margin');
  }
  const state = await State.findById(account).lean();
  if (!state) throw httpError(503, 'Managed Stellar signer is not provisioned');
  if (state.pending || state.retiringPublicKey) throw httpError(409, 'Signer rotation already in progress');

  const [ledger, feeLedger] = await Promise.all([
    server.loadAccount(account),
    server.loadAccount(feeSource.publicKey()),
  ]);
  if (!usableWeight(feeLedger, feeSource.publicKey())) {
    throw httpError(409, 'Rotation fee source cannot independently authorize its account');
  }
  if (!usableWeight(ledger, state.active.publicKey)) {
    throw httpError(409, 'Active signer cannot independently authorize the account');
  }

  const pending = signerRecord(Keypair.random());
  const result = await State.updateOne({
    _id: account, 'active.publicKey': state.active.publicKey,
    pending: { $exists: false }, retiringPublicKey: { $exists: false },
  }, { $set: { pending, initiatedBy: actor } });
  if (!result.modifiedCount) throw httpError(409, 'Signer rotation already in progress');
  return { account, oldPublicKey: state.active.publicKey, newPublicKey: pending.publicKey, status: 'adding' };
}

async function getActiveSigner(account) {
  const state = await State.findById(account).select('active').lean();
  if (!state) throw new Error('Managed Stellar signer is not provisioned');
  return getKeypair(state.active.encryptedSecret);
}

async function advanceRotation(accountId = managedAccount()) {
  if (!accountId) return;
  const state = await State.findById(accountId).lean();
  if (!state || (!state.pending && !state.retiringPublicKey)) return;
  if (!state.pending && state.retireAt > new Date()) return;

  const ledger = await server.loadAccount(accountId);
  const adding = Boolean(state.pending);
  const target = adding ? state.pending.publicKey : state.retiringPublicKey;
  const condition = {
    _id: accountId,
    'active.publicKey': state.active.publicKey,
    [adding ? 'pending.publicKey' : 'retiringPublicKey']: target,
    envelope: state.envelope ?? null,
  };
  const activeWeight = usableWeight(ledger, state.active.publicKey);
  if (!activeWeight) throw new Error('Managed signer cannot authorize Set Options');

  const targetWeight = weightFor(ledger, target);
  if (adding && usableWeight(ledger, target)) {
    const retireAt = new Date(Date.now() + rotationWindowSeconds() * 1000);
    await State.updateOne(condition, {
      $set: { active: state.pending, retireAt, retiringPublicKey: state.active.publicKey },
      $unset: { pending: 1, envelope: 1, envelopeExpiresAt: 1 },
    });
    return;
  }
  if (!adding && targetWeight === 0) {
    await State.updateOne(condition, {
      $unset: { retireAt: 1, retiringPublicKey: 1, envelope: 1, envelopeExpiresAt: 1 },
    });
    return;
  }

  const feeSource = ceremonySource(accountId);
  const feeLedger = await server.loadAccount(feeSource.publicKey());
  let tx;
  if (state.envelope) {
    if (state.envelopeExpiresAt <= new Date() || BigInt(feeLedger.sequence) >= BigInt(
      new Transaction(state.envelope, networkPassphrase).sequence
    )) {
      await State.updateOne(condition, { $unset: { envelope: 1, envelopeExpiresAt: 1 } });
      return;
    }
    tx = new Transaction(state.envelope, networkPassphrase);
  } else {
    const signer = target === accountId
      ? { masterWeight: 0 }
      : { signer: { ed25519PublicKey: target, weight: adding ? activeWeight : 0 } };
    const feeStats = await server.feeStats();
    tx = new TransactionBuilder(feeLedger, {
      fee: String(Math.max(Number(BASE_FEE), Number(feeStats.max_fee?.p95) || 0)),
      networkPassphrase,
    }).addOperation(Operation.setOptions({ ...signer, source: accountId })).setTimeout(CEREMONY_TX_TIMEOUT_SECONDS).build();
    const activeSigner = getKeypair(state.active.encryptedSecret);
    if (activeSigner.publicKey() === feeSource.publicKey()) tx.sign(activeSigner);
    else tx.sign(feeSource, activeSigner);
    const result = await State.updateOne(condition, {
      $set: {
        envelope: tx.toXDR(),
        envelopeExpiresAt: new Date(Number(tx.timeBounds.maxTime) * 1000),
      },
    });
    if (!result.modifiedCount) return;
  }

  // Every worker submits the same persisted transaction. The next pass checks
  // ledger state before activating the new signer or declaring retirement.
  await server.submitTransaction(tx);
}

let interval;
let running = false;

function startSignerRotationWorker() {
  if (!managedAccount() || interval) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await advanceRotation();
    } catch (err) {
      const code = err.response?.data?.extras?.result_codes?.transaction;
      logger.warn('[StellarSignerRotation] Ceremony step will retry', { code: code || 'STEP_FAILED' });
    } finally {
      running = false;
    }
  };
  interval = setInterval(tick, CEREMONY_INTERVAL_MS);
  interval.unref();
  void tick();
}

function stopSignerRotationWorker() {
  clearInterval(interval);
  interval = undefined;
}

module.exports = {
  managedAccount, rotationWindowSeconds, provisionSigner, initiateRotation, getActiveSigner,
  advanceRotation, startSignerRotationWorker, stopSignerRotationWorker,
};
