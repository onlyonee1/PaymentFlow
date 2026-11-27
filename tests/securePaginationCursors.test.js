'use strict';

/**
 * Tests for Issue #40 — Secure pagination cursors for the audit log.
 *
 * Verifies:
 *   - Valid cursors advance the page without skipping or duplicating records
 *   - Tampered cursors are rejected with INVALID_CURSOR
 *   - Expired cursors are rejected with INVALID_CURSOR
 *   - Cursors from a different filter set are rejected
 *   - Navigation is tenant-scoped and works in both directions
 *
 * All tests run without a live server or database (AuditLog is fully mocked).
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

process.env.JWT_SECRET ||= 'test-only-cursor-secret-32-characters';

let mockFind;
let mockCount;

jest.mock('../backend/src/models/auditLogModel', () => ({
  find:           (...args) => mockFind(...args),
  countDocuments: (...args) => mockCount(...args),
}));

jest.mock('../backend/src/utils/logger', () => ({
  child:  () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
  error:  jest.fn(),
  warn:   jest.fn(),
  info:   jest.fn(),
}));

const { getAuditLogs, _signCursor, _verifyCursor, CURSOR_TTL_MS } =
  require('../backend/src/services/auditService');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeLogs(n, offsetMs = 0) {
  return Array.from({ length: n }, (_, i) => ({
    _id:       (1000 + i).toString(16).padStart(24, '0'),
    schoolId:  'SCH-1',
    action:    'student_create',
    result:    'success',
    createdAt: new Date(Date.now() - i * 1000 - offsetMs),
  }));
}

function makeChain(results) {
  return {
    hint:  jest.fn().mockReturnThis(),
    sort:  jest.fn().mockReturnThis(),
    skip:  jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean:  jest.fn().mockResolvedValue(results),
  };
}

const BASE_FILTERS = { schoolId: 'SCH-1', action: undefined, targetType: undefined,
  performedBy: undefined, result: undefined, search: undefined,
  startDate: undefined, endDate: undefined };

beforeEach(() => {
  const logs = makeLogs(3);
  mockFind  = jest.fn(() => makeChain(logs));
  mockCount = jest.fn().mockResolvedValue(3);
});

// ── _signCursor / _verifyCursor unit tests ────────────────────────────────────

describe('_signCursor and _verifyCursor', () => {
  test('round-trips a valid cursor', () => {
    const entry   = { _id: '000000000000000000abc123', createdAt: new Date('2026-01-01T00:00:00Z') };
    const filters = { ...BASE_FILTERS };
    const token   = _signCursor(entry, filters);
    expect(typeof token).toBe('string');
    const payload = _verifyCursor(token, filters);
    expect(payload._id).toBe('000000000000000000abc123');
    expect(payload.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('rejects a token with a flipped bit (tampered signature)', () => {
    const entry   = { _id: '000000000000000000abc123', createdAt: new Date() };
    const filters = { ...BASE_FILTERS };
    const token   = _signCursor(entry, filters);
    // Flip the last character of the base64url token
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
    expect(() => _verifyCursor(tampered, filters)).toThrow(
      expect.objectContaining({ code: 'INVALID_CURSOR' }),
    );
  });

  test('rejects a completely invalid base64 string', () => {
    expect(() => _verifyCursor('not.a.valid.cursor!!!', BASE_FILTERS)).toThrow(
      expect.objectContaining({ code: 'INVALID_CURSOR' }),
    );
  });

  test('rejects an expired cursor', () => {
    jest.useFakeTimers();
    const entry   = { _id: '000000000000000000abc123', createdAt: new Date() };
    const filters = { ...BASE_FILTERS };
    const token   = _signCursor(entry, filters);

    // Advance time past the TTL
    jest.advanceTimersByTime(CURSOR_TTL_MS + 1000);

    expect(() => _verifyCursor(token, filters)).toThrow(
      expect.objectContaining({ code: 'INVALID_CURSOR' }),
    );
    jest.useRealTimers();
  });

  test('rejects a cursor when filters differ from original', () => {
    const entry         = { _id: '000000000000000000abc123', createdAt: new Date() };
    const originalFilters = { ...BASE_FILTERS };
    const changedFilters  = { ...BASE_FILTERS, action: 'fee_create' };
    const token = _signCursor(entry, originalFilters);
    expect(() => _verifyCursor(token, changedFilters)).toThrow(
      expect.objectContaining({ code: 'INVALID_CURSOR' }),
    );
  });

  test('accepts a cursor just before expiry', () => {
    jest.useFakeTimers();
    const entry   = { _id: '000000000000000000abc123', createdAt: new Date() };
    const filters = { ...BASE_FILTERS };
    const token   = _signCursor(entry, filters);

    // Advance time to 1 ms before TTL
    jest.advanceTimersByTime(CURSOR_TTL_MS - 1);

    expect(() => _verifyCursor(token, filters)).not.toThrow();
    jest.useRealTimers();
  });
});

// ── getAuditLogs — cursor mode ────────────────────────────────────────────────

describe('getAuditLogs — cursor mode', () => {
  test('returns nextCursor when another page exists', async () => {
    const logs = makeLogs(51);
    mockFind  = jest.fn(() => makeChain(logs));
    mockCount = jest.fn().mockResolvedValue(200);

    const result = await getAuditLogs({ schoolId: 'SCH-1', limit: 50 });
    expect(result.nextCursor).not.toBeNull();
    expect(typeof result.nextCursor).toBe('string');
    expect(result.cursorExpiry).not.toBeNull();
  });

  test('nextCursor is null when fewer records than limit are returned', async () => {
    const logs = makeLogs(3);
    mockFind  = jest.fn(() => makeChain(logs));
    mockCount = jest.fn().mockResolvedValue(3);

    const result = await getAuditLogs({ schoolId: 'SCH-1', limit: 50 });
    expect(result.nextCursor).toBeNull();
  });

  test('uses keyset query when a valid cursor is supplied', async () => {
    const firstLogs = makeLogs(51);
    mockFind  = jest.fn(() => makeChain(firstLogs));
    mockCount = jest.fn().mockResolvedValue(200);

    // Get first page and its cursor
    const page1 = await getAuditLogs({ schoolId: 'SCH-1', limit: 50 });
    expect(page1.nextCursor).not.toBeNull();

    // Mock second page fetch
    const secondLogs = makeLogs(50, 51000);
    mockFind  = jest.fn(() => makeChain(secondLogs));
    mockCount = jest.fn().mockResolvedValue(200);

    const page2 = await getAuditLogs({ schoolId: 'SCH-1', limit: 50, cursor: page1.nextCursor });

    // The find call should include a keyset $or condition, not a skip
    const findArg = mockFind.mock.calls[0][0];
    expect(findArg).toMatchObject({ schoolId: 'SCH-1', $and: [{ $or: expect.any(Array) }] });
    expect(page2.logs).toHaveLength(50);
  });

  test('keyset query does NOT use skip (stable under inserts)', async () => {
    const firstLogs = makeLogs(11);
    mockFind  = jest.fn(() => makeChain(firstLogs));
    mockCount = jest.fn().mockResolvedValue(100);

    const page1 = await getAuditLogs({ schoolId: 'SCH-1', limit: 10 });

    mockFind  = jest.fn(() => makeChain(makeLogs(10, 11000)));
    mockCount = jest.fn().mockResolvedValue(100);

    await getAuditLogs({ schoolId: 'SCH-1', limit: 10, cursor: page1.nextCursor });

    const chain = mockFind.mock.results[0].value;
    // skip() should NOT have been called in cursor mode
    expect(chain.skip).not.toHaveBeenCalled();
  });

  test('throws INVALID_CURSOR for a tampered cursor', async () => {
    const logs = makeLogs(11);
    mockFind  = jest.fn(() => makeChain(logs));
    mockCount = jest.fn().mockResolvedValue(100);
    const page1 = await getAuditLogs({ schoolId: 'SCH-1', limit: 10 });

    const tampered = page1.nextCursor.slice(0, -1) + (page1.nextCursor.endsWith('A') ? 'B' : 'A');

    await expect(
      getAuditLogs({ schoolId: 'SCH-1', limit: 10, cursor: tampered }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  test('throws INVALID_CURSOR for a completely invalid cursor string', async () => {
    await expect(
      getAuditLogs({ schoolId: 'SCH-1', cursor: 'garbage!!!' }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  test('throws INVALID_CURSOR for an expired cursor', async () => {
    jest.useFakeTimers();

    const logs = makeLogs(11);
    mockFind  = jest.fn(() => makeChain(logs));
    mockCount = jest.fn().mockResolvedValue(100);

    const page1 = await getAuditLogs({ schoolId: 'SCH-1', limit: 10 });
    jest.advanceTimersByTime(CURSOR_TTL_MS + 1000);

    await expect(
      getAuditLogs({ schoolId: 'SCH-1', limit: 10, cursor: page1.nextCursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });

    jest.useRealTimers();
  });

  test('throws INVALID_CURSOR when filter changes between pages', async () => {
    const logs = makeLogs(11);
    mockFind  = jest.fn(() => makeChain(logs));
    mockCount = jest.fn().mockResolvedValue(100);

    // Page 1 fetched with action filter
    const page1 = await getAuditLogs({ schoolId: 'SCH-1', limit: 10, action: 'student_create' });

    // Attempt page 2 with a different action filter
    await expect(
      getAuditLogs({ schoolId: 'SCH-1', limit: 10, action: 'fee_create', cursor: page1.nextCursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
});

test('rejects a valid cursor from another tenant before querying', async () => {
  const page = await getAuditLogs({ schoolId: 'SCH-1', limit: 2 });
  mockFind.mockClear();

  await expect(getAuditLogs({ schoolId: 'SCH-2', limit: 2, cursor: page.nextCursor }))
    .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 });
  expect(mockFind).not.toHaveBeenCalled();
});

test('queries earlier rows in ascending order and reverses the returned page', async () => {
  const first = makeLogs(3);
  mockFind.mockImplementationOnce(() => makeChain(first));
  const page1 = await getAuditLogs({ schoolId: 'SCH-1', limit: 2 });
  mockFind.mockImplementationOnce(() => makeChain(makeLogs(2, 2000)));
  const page2 = await getAuditLogs({ schoolId: 'SCH-1', limit: 2, cursor: page1.nextCursor });
  const reverseQuery = makeChain([first[1], first[0]]);
  mockFind.mockReturnValueOnce(reverseQuery);
  const previous = await getAuditLogs({ schoolId: 'SCH-1', limit: 2, cursor: page2.prevCursor });

  expect(reverseQuery.sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
  expect(previous.logs).toEqual(first.slice(0, 2));
  expect(previous.prevCursor).toBeNull();
  expect(previous.hasMore).toBe(true);
});

// ── Response shape ────────────────────────────────────────────────────────────

describe('response shape', () => {
  test('cursorExpiry is an ISO string when nextCursor is present', async () => {
    const logs = makeLogs(51);
    mockFind  = jest.fn(() => makeChain(logs));
    mockCount = jest.fn().mockResolvedValue(200);

    const result = await getAuditLogs({ schoolId: 'SCH-1', limit: 50 });
    expect(result.cursorExpiry).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('cursorExpiry is null when nextCursor is null', async () => {
    const result = await getAuditLogs({ schoolId: 'SCH-1' });
    expect(result.cursorExpiry).toBeNull();
  });
});
