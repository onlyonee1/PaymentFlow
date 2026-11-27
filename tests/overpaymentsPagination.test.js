'use strict';

process.env.JWT_SECRET ||= 'test-only-payment-pagination-secret';

const mockRows = Array.from({ length: 51 }, (_, index) => ({
  _id: (51 - index).toString(16).padStart(24, '0'),
  createdAt: new Date(2026, 0, 1),
  excessAmount: 1,
}));
const mockQuery = {
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn(),
};
const mockPayment = {
  find: jest.fn(() => mockQuery),
  countDocuments: jest.fn(),
};

jest.mock('../backend/src/models/paymentModel', () => mockPayment);
jest.mock('../backend/src/models/studentModel', () => ({}));
jest.mock('../backend/src/models/pendingVerificationModel', () => ({}));
jest.mock('../backend/src/config/stellarConfig', () => ({ ACCEPTED_ASSETS: {} }));
jest.mock('../backend/src/utils/paymentLimits', () => ({}));
jest.mock('../backend/src/services/currencyConversionService', () => ({}));

const { getOverpayments } = require('../backend/src/controllers/paymentQueryController');

async function request(query = {}) {
  const res = { json: jest.fn() };
  const next = jest.fn();
  await getOverpayments({ query, schoolId: 'SCH-TEST' }, res, next);
  return { body: res.json.mock.calls[0]?.[0], next };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.limit.mockImplementation(async (limit) => mockRows.slice(0, limit));
});

test('uses a tenant-scoped query and returns a signed cursor for the next page', async () => {
  const { body } = await request();
  expect(mockPayment.find).toHaveBeenCalledWith({ schoolId: 'SCH-TEST', feeValidationStatus: 'overpaid' });
  expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
  expect(mockQuery.limit).toHaveBeenCalledWith(51);
  expect(mockPayment.countDocuments).not.toHaveBeenCalled();
  expect(body.overpayments).toHaveLength(50);
  expect(body.pagination).toEqual({
    limit: 50, hasMore: true, nextCursor: expect.any(String), prevCursor: null,
  });
});

test('honors limit and ignores numeric offsets', async () => {
  const { body } = await request({ limit: '20', page: '2' });
  expect(mockQuery.limit).toHaveBeenCalledWith(21);
  expect(mockQuery.skip).not.toHaveBeenCalled();
  expect(body.overpayments).toHaveLength(20);
});

test('caps limit at 100 and returns null cursors when the results fit', async () => {
  const { body } = await request({ limit: '9999' });
  expect(mockQuery.limit).toHaveBeenCalledWith(101);
  expect(body.pagination).toEqual({ limit: 100, hasMore: false, nextCursor: null, prevCursor: null });
});

test('a malformed cursor returns a 400 error before querying', async () => {
  const { next } = await request({ cursor: 'malformed' });
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_CURSOR', status: 400 }));
  expect(mockPayment.find).not.toHaveBeenCalled();
});

test('sums excess only from the returned page', async () => {
  const { body } = await request({ limit: '20' });
  expect(body.totalExcess).toBe(20);
});
