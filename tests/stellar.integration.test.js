'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const enabled = process.env.RUN_INTEGRATION_TESTS === 'true';

(enabled ? describe : describe.skip)('Payment lifecycle on Stellar Testnet', () => {
  jest.setTimeout(165_000);

  test('credits an intent after ledger confirmation, downloads its receipt, and decodes a Soroban transfer', async () => {
    const {
      Address, Asset, BASE_FEE, Contract, Horizon, Keypair, Memo, Networks,
      Operation, TransactionBuilder, nativeToScVal, SorobanRpc, scValToNative,
    } = require('../backend/node_modules/@stellar/stellar-sdk');
    const { assertNotProduction, FIXTURE_SEED_DEFAULT } = require('./fixtures/contractFixtureAccounts');
    assertNotProduction();
    process.env.STELLAR_NETWORK = 'testnet';

    // Use deterministic signing keys isolated to this CI run.
    const run = process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
      : randomUUID();
    const fixture = (role) => Keypair.fromRawEd25519Seed(
      createHash('sha256').update(`${FIXTURE_SEED_DEFAULT}:testnet:${run}:${role}`).digest()
    );
    const payer = fixture('payer');
    const recipient = fixture('school');
    process.env.SCHOOL_WALLET_ADDRESS = recipient.publicKey();
    const horizon = new Horizon.Server('https://horizon-testnet.stellar.org', { timeout: 10_000 });
    const soroban = new SorobanRpc.Server('https://soroban-testnet.stellar.org', { timeout: 10_000 });

    const app = require('../backend/src/app');
    const mongoose = require('../backend/node_modules/mongoose');
    const jwt = require('../backend/node_modules/jsonwebtoken');
    const request = require('supertest')(app);
    const Payment = require('../backend/src/models/paymentModel');
    const PaymentIntent = require('../backend/src/models/paymentIntentModel');
    const Student = require('../backend/src/models/studentModel');

    async function poll(action, description) {
      for (let attempt = 0; attempt < 15; attempt++) {
        const result = await action();
        if (result) return result;
        await delay(2_000);
      }
      throw new Error(`Timed out waiting for ${description}`);
    }

    try {
      await Promise.all([
        mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 }),
        ...[payer, recipient].map(async (keypair) => {
          const response = await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`, {
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error(`Friendbot returned HTTP ${response.status}`);
        }),
      ]);

      const token = jwt.sign({ role: 'admin', username: 'testnet-ci' }, process.env.JWT_SECRET);
      const school = await request.post('/api/schools').auth(token, { type: 'bearer' })
        .send({ name: 'Testnet CI School', slug: `testnet-${randomUUID().slice(0, 8)}`, stellarAddress: recipient.publicKey() })
        .expect(201);
      const schoolId = school.body.schoolId;
      const headers = { 'X-School-ID': schoolId, Authorization: `Bearer ${token}` };
      const studentId = 'TESTNET-001';
      await request.post('/api/fees').set(headers)
        .send({ className: 'CI', feeAmount: 5 }).expect(201);
      await request.post('/api/students').set(headers)
        .send({ studentId, name: 'Testnet Student', class: 'CI' }).expect(201);

      const { body: intent } = await request.post('/api/payments/intent').set(headers)
        .set('Idempotency-Key', randomUUID()).send({ studentId }).expect(201);
      const source = await horizon.loadAccount(payer.publicKey());
      const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({ destination: recipient.publicKey(), asset: Asset.native(), amount: '5' }))
        .addMemo(Memo.text(intent.memo)).setTimeout(30).build();
      tx.sign(payer);
      const submitted = await horizon.submitTransaction(tx);
      expect(submitted.successful).toBe(true);

      await poll(async () => {
        const { records } = await horizon.ledgers().order('desc').limit(1).call();
        return records[0].sequence >= submitted.ledger + 2;
      }, 'two ledgers after submission');

      await request.post('/api/payments/sync').set(headers).expect(200);
      const payment = await Payment.findOne({ schoolId, txHash: submitted.hash }).lean();
      expect(payment).toMatchObject({ studentId, amount: 5, status: 'SUCCESS', confirmationStatus: 'confirmed' });
      expect(await PaymentIntent.findOne({ schoolId, _id: intent.intentId }).lean())
        .toMatchObject({ status: 'completed' });
      expect(await Student.findOne({ schoolId, studentId }).lean())
        .toMatchObject({ totalPaid: 5, feePaid: true });

      const receipt = await request.get(`/api/payments/receipt/${submitted.hash}`).set(headers);
      expect([200, 201]).toContain(receipt.status);
      await request.get(`/api/receipts/${submitted.hash}?format=pdf`).set(headers)
        .expect(200).expect('Content-Type', /application\/pdf/)
        .expect('Content-Disposition', /attachment/);

      const assetContractId = Asset.native().contractId(Networks.TESTNET);
      const contract = new Contract(assetContractId);
      const account = await soroban.getAccount(payer.publicKey());
      const invocation = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call('transfer', new Address(payer.publicKey()).toScVal(),
          new Address(recipient.publicKey()).toScVal(), nativeToScVal(12345n, { type: 'i128' })))
        .setTimeout(30).build();
      const prepared = await soroban.prepareTransaction(invocation);
      prepared.sign(payer);
      const { sequence: startLedger } = await soroban.getLatestLedger();
      const sent = await soroban.sendTransaction(prepared);
      expect(['PENDING', 'DUPLICATE']).toContain(sent.status);

      const event = await poll(async () => {
        const { events } = await soroban.getEvents({
          startLedger,
          filters: [{ type: 'contract', contractIds: [assetContractId] }],
        });
        return events.find((row) => row.txHash === sent.hash && row.inSuccessfulContractCall
          && scValToNative(row.topic[0]) === 'transfer');
      }, 'indexed Soroban transfer event');
      expect(event.topic.slice(1, 3).map(scValToNative)).toEqual([payer.publicKey(), recipient.publicKey()]);
      const value = scValToNative(event.value);
      expect(typeof value === 'bigint' ? value : value.amount).toBe(12345n);
    } finally {
      await mongoose.disconnect();
    }
  });
});
