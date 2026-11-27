'use strict';

// #467 — GET /api/students always returns { students, pagination }
// Tests the controller directly to avoid app-level dependency issues.

process.env.JWT_SECRET ||= 'test-only-student-pagination-secret';
process.env.MONGO_URI = 'mongodb://localhost:27017/test';
process.env.SCHOOL_WALLET_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockStudents = [
  { studentId: 'STU001', name: 'Alice', class: '5A', feeAmount: 200, feePaid: false },
  { studentId: 'STU002', name: 'Bob',   class: '5A', feeAmount: 200, feePaid: true  },
];

const mockChainable = {
  sort: jest.fn(),
  skip: jest.fn(),
  limit: jest.fn(),
};
mockChainable.sort.mockReturnValue(mockChainable);
mockChainable.skip.mockReturnValue(mockChainable);
mockChainable.limit.mockResolvedValue(mockStudents);

jest.mock('../backend/src/models/studentModel', () => ({
  find: jest.fn().mockReturnValue(mockChainable),
  findOne: jest.fn().mockResolvedValue(null),
  countDocuments: jest.fn().mockResolvedValue(2),
  create: jest.fn(),
}));

jest.mock('../backend/src/models/feeStructureModel', () => ({
  findOne: jest.fn().mockResolvedValue(null),
}));

jest.mock('../backend/src/cache', () => ({
  get: jest.fn().mockReturnValue(undefined),
  set: jest.fn(),
  del: jest.fn(),
  KEYS: { studentsAll: () => 'students:all', student: (id) => `student:${id}` },
  TTL: { STUDENT: 60 },
}));

jest.mock('../backend/src/services/auditService', () => ({
  logAudit: jest.fn().mockResolvedValue({}),
}));

jest.mock('csv-parser', () => jest.fn(), { virtual: true });

// ─── Tests ────────────────────────────────────────────────────────────────────

const { getAllStudents } = require('../backend/src/controllers/studentController');

describe('#467 GET /api/students consistent response shape', () => {
  function makeReqRes(query = {}) {
    const req = { schoolId: 'SCH1', query };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();
    return { req, res, next };
  }

  it('always returns { students, pagination }', async () => {
    const { req, res, next } = makeReqRes();
    await getAllStudents(req, res, next);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body.students).toEqual(mockStudents);
    expect(body.pagination).toEqual({ limit: 50, nextCursor: null, prevCursor: null, hasMore: false });
  });

  it('applies the requested limit without a numeric offset', async () => {
    const { req, res, next } = makeReqRes({ page: '2', limit: '10' });
    await getAllStudents(req, res, next);
    expect(res.json.mock.calls[0][0].pagination.limit).toBe(10);
    expect(mockChainable.limit).toHaveBeenCalledWith(11);
    expect(mockChainable.skip).not.toHaveBeenCalled();
  });

  it('response is never a bare array', async () => {
    const { req, res, next } = makeReqRes();
    await getAllStudents(req, res, next);

    const body = res.json.mock.calls[0][0];
    expect(Array.isArray(body)).toBe(false);
  });

  it('students field is an array', async () => {
    const { req, res, next } = makeReqRes();
    await getAllStudents(req, res, next);

    const body = res.json.mock.calls[0][0];
    expect(Array.isArray(body.students)).toBe(true);
    expect(body.students).toHaveLength(2);
  });
});
