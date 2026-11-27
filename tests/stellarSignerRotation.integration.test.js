'use strict';

const { Account, Asset, Keypair, Operation } = require('@stellar/stellar-sdk');

jest.mock('../backend/src/config/stellarConfig', () => ({
  server: { loadAccount: jest.fn(), feeStats: jest.fn(), submitTransaction: jest.fn() },
  networkPassphrase: 'Test SDF Network ; September 2015',
}));
jest.mock('../backend/src/models/stellarSignerModel', () => ({
  findById: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../backend/src/utils/withStellarRetry', () => ({
  withStellarRetry: (operation) => operation(),
}));

const { server } = require('../backend/src/config/stellarConfig');
const State = require('../backend/src/models/stellarSignerModel');
const { provisionSigner, initiateRotation, advanceRotation } = require('../backend/src/services/stellarSignerRotation');
const { createTransactionManager } = require('../backend/src/services/stellarTransactionManager');

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  jest.useRealTimers();
});

test('managed payments use both valid signers during the overlap and continue after retirement', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  const oldSigner = Keypair.random();
  const feeSigner = Keypair.random();
  const master = oldSigner.publicKey();
  const feeAccount = feeSigner.publicKey();
  process.env = {
    ...originalEnv,
    STELLAR_MANAGED_SIGNER_ACCOUNT: master,
    STELLAR_ROTATION_FEE_SOURCE_SECRET: feeSigner.secret(),
    SIGNER_MASTER_KEY: 'ab'.repeat(32),
    KEY_ROTATION_WINDOW_MINUTES: '15',
    STELLAR_TX_TIMEOUT_SECONDS: '300',
  };

  let state;
  State.findById.mockImplementation(() => ({
    select() { return this; },
    lean: async () => structuredClone(state),
  }));
  State.updateOne.mockImplementation(async (_filter, update) => {
    if (update.$setOnInsert) state = { ...update.$setOnInsert };
    Object.assign(state, update.$set);
    for (const key of Object.keys(update.$unset || {})) delete state[key];
    return { modifiedCount: 1 };
  });

  const weights = new Map([[master, 1]]);
  const sequences = new Map([[master, 0n], [feeAccount, 0n]]);
  const paymentSigners = [];
  server.loadAccount.mockImplementation(async (address) => {
    const account = new Account(address, String(sequences.get(address)));
    account.thresholds = { low_threshold: 1, med_threshold: 1, high_threshold: 1 };
    account.signers = Array.from(address === master ? weights : [[feeAccount, 1]],
      ([key, weight]) => ({ key, weight, type: 'ed25519_public_key' }));
    return account;
  });
  server.feeStats.mockResolvedValue({ max_fee: { p95: '100' } });

  function verifySignature(tx, key) {
    const signer = Keypair.fromPublicKey(key);
    return tx.signatures.some((entry) => signer.verify(tx.hash(), entry.signature()));
  }

  let releaseOldPayment;
  let oldPaymentStarted;
  const oldPaymentWaiting = new Promise((resolve) => { oldPaymentStarted = resolve; });
  const release = new Promise((resolve) => { releaseOldPayment = resolve; });

  server.submitTransaction.mockImplementation(async (tx) => {
    const [operation] = tx.operations;
    if (operation.type === 'setOptions') {
      expect(tx.source).toBe(feeAccount);
      expect(operation.source).toBe(master);
      expect(verifySignature(tx, feeAccount)).toBe(true);
      expect([...weights].some(([key, weight]) => weight && verifySignature(tx, key))).toBe(true);
      if (operation.signer) weights.set(operation.signer.ed25519PublicKey, operation.signer.weight);
      if (operation.masterWeight === 0) weights.set(master, 0);
    } else {
      if (!paymentSigners.length && verifySignature(tx, master)) {
        oldPaymentStarted();
        await release;
      }
      const signingKey = [...weights].find(([key, weight]) => weight && verifySignature(tx, key))?.[0];
      expect(signingKey).toBeDefined();
      paymentSigners.push(signingKey);
    }
    expect(BigInt(tx.sequence)).toBe(sequences.get(tx.source) + 1n);
    sequences.set(tx.source, BigInt(tx.sequence));
    return { hash: tx.hash().toString('hex'), ledger: 1, envelope_xdr: tx.toXDR() };
  });

  await provisionSigner(oldSigner.secret());
  const manager = createTransactionManager();
  const destination = Keypair.random().publicKey();
  const pay = () => manager.buildAndSubmit((builder) => {
    builder.addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' }));
  });

  const inFlight = pay();
  await oldPaymentWaiting;
  const rotation = await initiateRotation('operator');
  await advanceRotation();
  await advanceRotation();
  expect(weights.get(master)).toBe(1);
  expect(weights.get(rotation.newPublicKey)).toBe(1);
  expect(state.active.publicKey).toBe(rotation.newPublicKey);
  releaseOldPayment();
  await inFlight;
  await pay();

  jest.advanceTimersByTime(15 * 60 * 1000);
  await advanceRotation();
  await advanceRotation();
  expect(state.retiringPublicKey).toBeUndefined();
  expect(weights.get(master)).toBe(0);
  await pay();
  expect(paymentSigners).toEqual([master, rotation.newPublicKey, rotation.newPublicKey]);
});
