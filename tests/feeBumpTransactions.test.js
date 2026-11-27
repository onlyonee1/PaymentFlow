'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Student = require('../backend/src/models/studentModel');

let mongoServer;
const schoolId = 'SCH-TEST-001';
const walletAddress = 'GSCHOOL123456789';
const TEST_DB = 'fee_bump_tx_test';
const externalMongoUri = process.env.MONGO_URI;
process.env.MONGO_URI ||= 'mongodb://localhost:27017/fee_bump_tx_test';
process.env.JWT_SECRET ||= 'fee-bump-transaction-test-jwt-secret';

const mockLookupTransaction = jest.fn();
jest.mock('../backend/src/config/stellarConfig', () => ({
  ...jest.requireActual('../backend/src/config/stellarConfig'),
  server: { transactions: () => ({ transaction: () => ({ call: mockLookupTransaction }) }) },
}));

beforeAll(async () => {
  if (externalMongoUri) {
    await mongoose.connect(externalMongoUri, { dbName: TEST_DB });
  } else {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Student.deleteMany({ schoolId });

  await Student.create({
    schoolId,
    studentId: 'STU001',
    name: 'Alice Johnson',
    class: 'Grade 5A',
    feeAmount: 250,
  });
});

describe('Fee-Bump Transaction Handling', () => {
  test('should extract payment from fee-bump transaction', async () => {
    const stellarService = require('../backend/src/services/stellarService');

    // Mock fee-bump transaction structure
    const feeBumpTx = {
      hash: 'feebump123',
      successful: true,
      memo_type: 'none', // Fee-bump outer tx has no memo
      memo: null,
      inner_transaction: {
        hash: 'inner456',
        successful: true,
        memo_type: 'text',
        memo: 'STU001',
        operations: async () => ({
          records: [
            {
              type: 'payment',
              to: walletAddress,
              asset_type: 'native',
              amount: '250.0000000',
            },
          ],
        }),
      },
      operations: async () => ({
        records: [
          {
            type: 'payment',
            to: walletAddress,
            asset_type: 'native',
            amount: '250.0000000',
          },
        ],
      }),
    };

    const result = await stellarService.extractValidPayment(feeBumpTx, walletAddress);

    expect(result).not.toBeNull();
    expect(result.memo).toBe('STU001');
    expect(result.asset.assetCode).toBe('XLM');
  });

  test('should verify fee-bump transaction correctly', async () => {
    const stellarService = require('../backend/src/services/stellarService');

    // Mock fee-bump transaction
    const feeBumpTx = {
      hash: 'feebump789',
      successful: true,
      memo_type: 'text',
      memo: 'STU001',
      inner_transaction: { hash: 'inner789' },
      operations: async () => ({
        records: [
          {
            type: 'payment',
            to: walletAddress,
            asset_type: 'native',
            amount: '250.0000000',
          },
        ],
      }),
    };

    mockLookupTransaction.mockResolvedValue(feeBumpTx);
    const result = await stellarService.verifyTransaction('feebump789', walletAddress, schoolId);

    expect(result.memo).toBe('STU001');
    expect(result.hash).toBe('inner789');
    expect(result.feeBumpTxHash).toBe('feebump789');
    expect(result.amount).toBe(250);
    expect(result.feeValidation.status).toBe('valid');
  });

  test('should handle fee-bump with inner transaction memo', async () => {
    const stellarService = require('../backend/src/services/stellarService');

    const feeBumpTx = {
      hash: 'feebump999',
      successful: true,
      memo_type: 'none',
      memo: null,
      inner_transaction: {
        hash: 'inner999',
        successful: true,
        memo_type: 'text',
        memo: 'STU001',
        operations: async () => ({
          records: [
            {
              type: 'payment',
              to: walletAddress,
              asset_type: 'native',
              amount: '250.0000000',
            },
          ],
        }),
      },
      operations: async () => ({
        records: [
          {
            type: 'payment',
            to: walletAddress,
            asset_type: 'native',
            amount: '250.0000000',
          },
        ],
      }),
    };

    const result = await stellarService.extractValidPayment(feeBumpTx, walletAddress);

    expect(result).not.toBeNull();
    expect(result.memo).toBe('STU001');
    expect(result.memoType).toBe('text');
  });

  test('should reject fee-bump with no inner memo', async () => {
    const stellarService = require('../backend/src/services/stellarService');

    const feeBumpTx = {
      hash: 'feebump000',
      successful: true,
      memo_type: 'none',
      memo: null,
      inner_transaction: {
        hash: 'inner000',
        successful: true,
        memo_type: 'none',
        memo: null,
        operations: async () => ({
          records: [
            {
              type: 'payment',
              to: walletAddress,
              asset_type: 'native',
              amount: '250.0000000',
            },
          ],
        }),
      },
      operations: async () => ({
        records: [
          {
            type: 'payment',
            to: walletAddress,
            asset_type: 'native',
            amount: '250.0000000',
          },
        ],
      }),
    };

    const result = await stellarService.extractValidPayment(feeBumpTx, walletAddress);

    expect(result).toBeNull();
  });
});
