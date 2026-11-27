'use strict';

/**
 * #575 — GET /api/audit-logs pagination, filtering, and boundary cases.
 * Tests the auditService.getAuditLogs function directly with a mocked AuditLog model.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

process.env.JWT_SECRET ||= 'test-only-audit-pagination-secret';

const mockLogs = [
  { _id: '000000000000000000000001', schoolId: 'SCH-1', action: 'student_create', result: 'success', createdAt: new Date('2026-01-01') },
  { _id: '000000000000000000000002', schoolId: 'SCH-1', action: 'fee_create',     result: 'failure', createdAt: new Date('2026-01-02') },
  { _id: '000000000000000000000003', schoolId: 'SCH-1', action: 'student_delete', result: 'success', createdAt: new Date('2026-01-03') },
];

let mockFind;
let mockCount;

jest.mock('../backend/src/models/auditLogModel', () => ({
  find: (...args) => mockFind(...args),
  countDocuments: (...args) => mockCount(...args),
}));

function makeChain(results) {
  const chain = {
    hint:  jest.fn().mockReturnThis(),
    sort:  jest.fn().mockReturnThis(),
    skip:  jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean:  jest.fn().mockResolvedValue(results),
  };
  return chain;
}

const { getAuditLogs } = require('../backend/src/services/auditService');

beforeEach(() => {
  mockFind  = jest.fn(() => makeChain(mockLogs));
  mockCount = jest.fn().mockResolvedValue(mockLogs.length);
});

// ── Pagination envelope ───────────────────────────────────────────────────────

describe('pagination envelope', () => {
  test('returns logs and cursor metadata without a record count', async () => {
    const result = await getAuditLogs({ schoolId: 'SCH-1', limit: 2 });
    expect(result).toMatchObject({
      logs: mockLogs.slice(0, 2),
      limit: 2,
      nextCursor: expect.any(String),
      prevCursor: null,
      hasMore: true,
    });
    expect(mockCount).not.toHaveBeenCalled();
  });

  test('defaults to 50 and caps the requested page size at 200', async () => {
    expect((await getAuditLogs({ schoolId: 'SCH-1' })).limit).toBe(50);
    expect((await getAuditLogs({ schoolId: 'SCH-1', limit: 999 })).limit).toBe(200);
    expect(mockFind.mock.results[1].value.limit).toHaveBeenCalledWith(201);
  });

  test('does not accept numeric offsets as a position', async () => {
    await getAuditLogs({ schoolId: 'SCH-1', page: 3, limit: 10 });
    expect(mockFind.mock.results[0].value.skip).not.toHaveBeenCalled();
  });
});

// ── Filtering ─────────────────────────────────────────────────────────────────

describe('filtering', () => {
  test('filters by action', async () => {
    await getAuditLogs({ schoolId: 'SCH-1', action: 'student_create' });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'student_create' }),
    );
  });

  test('filters by targetType', async () => {
    await getAuditLogs({ schoolId: 'SCH-1', targetType: 'payment' });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'payment' }),
    );
  });

  test('filters by performedBy', async () => {
    await getAuditLogs({ schoolId: 'SCH-1', performedBy: 'admin@school.edu' });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ performedBy: 'admin@school.edu' }),
    );
  });

  test('filters by result (success)', async () => {
    await getAuditLogs({ schoolId: 'SCH-1', result: 'success' });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'success' }),
    );
  });

  test('filters by result (failure)', async () => {
    await getAuditLogs({ schoolId: 'SCH-1', result: 'failure' });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failure' }),
    );
  });

  test('filters by startDate', async () => {
    await getAuditLogs({ schoolId: 'SCH-1', startDate: '2026-01-01' });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: expect.objectContaining({ $gte: expect.any(Date) }),
      }),
    );
  });

  test('filters by endDate', async () => {
    await getAuditLogs({ schoolId: 'SCH-1', endDate: '2026-12-31' });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: expect.objectContaining({ $lte: expect.any(Date) }),
      }),
    );
  });

  test('filters by date range (both startDate and endDate)', async () => {
    await getAuditLogs({ schoolId: 'SCH-1', startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: expect.objectContaining({ $gte: expect.any(Date), $lte: expect.any(Date) }),
      }),
    );
  });

  test('always scopes query to schoolId', async () => {
    await getAuditLogs({ schoolId: 'SCH-99' });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 'SCH-99' }),
    );
  });

  test('omits optional filters when not provided', async () => {
    await getAuditLogs({ schoolId: 'SCH-1' });
    const query = mockFind.mock.calls[0][0];
    expect(query).not.toHaveProperty('action');
    expect(query).not.toHaveProperty('targetType');
    expect(query).not.toHaveProperty('performedBy');
    expect(query).not.toHaveProperty('result');
    expect(query).not.toHaveProperty('createdAt');
  });
});

// ── Boundary cases ────────────────────────────────────────────────────────────

describe('boundary cases', () => {
  test('empty results have no navigation cursors', async () => {
    mockFind.mockReturnValueOnce(makeChain([]));
    const result = await getAuditLogs({ schoolId: 'SCH-1' });
    expect(result).toMatchObject({ logs: [], nextCursor: null, prevCursor: null, hasMore: false });
  });

  test('sorting is always by createdAt descending', async () => {
    await getAuditLogs({ schoolId: 'SCH-1' });
    const chain = mockFind.mock.results[0].value;
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
  });
});
