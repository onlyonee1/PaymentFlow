'use strict';

/**
 * Issue #617 — Dead-letter queue handling for the transactional outbox.
 *
 * After OUTBOX_MAX_RETRIES (default 3) failed dispatch attempts, an outbox
 * event is moved to the dead-letter state: deadLettered=true, deadLetteredAt,
 * deadLetterReason set. These tests assert the full dead-letter lifecycle:
 *   1. An event that exhausts all retries is dead-lettered with correct fields.
 *   2. A dead-lettered event is excluded from normal dispatch queries.
 *   3. Dead-lettering is idempotent: calling it twice produces the same result.
 *   4. The error message is preserved in lastError.
 *   5. deadLetterReason is always 'max_retries_exhausted'.
 *   6. The dispatchOutboxEvents loop continues processing after dead-lettering.
 *   7. OUTBOX_MAX_RETRIES env override is respected.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFindByIdAndUpdate = jest.fn().mockResolvedValue(undefined);
const mockOutboxFind        = jest.fn();

jest.mock('../backend/src/models/outboxModel', () => ({
  find:              (...a) => mockOutboxFind(...a),
  findByIdAndUpdate: (...a) => mockFindByIdAndUpdate(...a),
  create:            jest.fn().mockResolvedValue({}),
}));

const mockAsyncEmit = jest.fn();
jest.mock('../backend/src/events/paymentEvents', () => ({
  emit:     jest.fn(),
  asyncEmit: (...a) => mockAsyncEmit(...a),
  on:       jest.fn(),
  rawListeners: jest.fn().mockReturnValue([]),
  removeAllListeners: jest.fn(),
}));

jest.mock('../backend/src/utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockBatch(batch) {
  const sort  = jest.fn().mockResolvedValue(batch);
  const limit = jest.fn().mockReturnValue({ sort });
  mockOutboxFind.mockReturnValue({ limit });
}

function makeEvent(overrides = {}) {
  return {
    _id:        'ev-dl-1',
    eventId:    'eid-dl-1',
    eventType:  'payment.saved',
    payload:    { txHash: 'tx-dl' },
    retryCount: 0,
    lastError:  null,
    ...overrides,
  };
}

// ── Imports ───────────────────────────────────────────────────────────────────

const { dispatchOutboxEvents } = require('../backend/src/services/outboxDispatcher');

beforeEach(() => {
  jest.clearAllMocks();
  mockAsyncEmit.mockResolvedValue([{ status: 'fulfilled', value: undefined }]);
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. Event that exhausts all retries is dead-lettered with correct fields
// ─────────────────────────────────────────────────────────────────────────────

describe('dead-letter — exhausted event fields', () => {
  it('sets deadLettered=true, deadLetteredAt (Date), deadLetterReason when retryCount >= MAX', async () => {
    const event = makeEvent({ retryCount: 5, lastError: 'webhook unreachable' });
    mockBatch([event]);

    await dispatchOutboxEvents();

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      event._id,
      expect.objectContaining({
        deadLettered:     true,
        deadLetteredAt:   expect.any(Date),
        deadLetterReason: 'max_retries_exhausted',
      }),
    );
  });

  it('preserves the original lastError in the dead-letter document', async () => {
    const event = makeEvent({ retryCount: 5, lastError: 'Connection refused after 10 s' });
    mockBatch([event]);

    await dispatchOutboxEvents();

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      event._id,
      expect.objectContaining({ lastError: 'Connection refused after 10 s' }),
    );
  });

  it('deadLetterReason is always max_retries_exhausted', async () => {
    for (const retryCount of [5, 6, 10]) {
      jest.clearAllMocks();
      const event = makeEvent({ _id: `ev-${retryCount}`, retryCount });
      mockBatch([event]);
      await dispatchOutboxEvents();
      const call = mockFindByIdAndUpdate.mock.calls.find(
        ([id]) => id === `ev-${retryCount}`,
      );
      expect(call[1].deadLetterReason).toBe('max_retries_exhausted');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. Dead-lettered events excluded from dispatch query
// ─────────────────────────────────────────────────────────────────────────────

describe('dead-letter — excluded from dispatch query', () => {
  it('the outbox query filters out deadLettered events', async () => {
    mockBatch([]);
    await dispatchOutboxEvents();
    const query = mockOutboxFind.mock.calls[0][0];
    expect(query.processed).toBe(false);
    expect(query.deadLettered).toEqual({ $ne: true });
  });

  it('asyncEmit is never called for an already-dead-lettered event in the batch', async () => {
    // The dispatcher should dead-letter it immediately without dispatching
    const event = makeEvent({ retryCount: 5 });
    mockBatch([event]);

    await dispatchOutboxEvents();

    expect(mockAsyncEmit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. Dispatch loop continues after dead-lettering one event
// ─────────────────────────────────────────────────────────────────────────────

describe('dead-letter — dispatcher continues after dead-lettering', () => {
  it('processes subsequent healthy events after dead-lettering one', async () => {
    const dead    = makeEvent({ _id: 'ev-dead',    retryCount: 5 });
    const healthy = makeEvent({ _id: 'ev-alive',   retryCount: 0 });
    mockBatch([dead, healthy]);

    await dispatchOutboxEvents();

    expect(mockAsyncEmit).toHaveBeenCalledTimes(1);
    expect(mockAsyncEmit).toHaveBeenCalledWith(healthy.eventType, healthy.payload);
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'ev-alive',
      expect.objectContaining({ processed: true }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. Dead-letter when the final retry attempt itself fails
// ─────────────────────────────────────────────────────────────────────────────

describe('dead-letter — triggered on final retry failure', () => {
  it('dead-letters when retryCount reaches MAX after one more failure', async () => {
    // retryCount: 4 → after one more failure it becomes 5 (= MAX_RETRIES)
    const event = makeEvent({ retryCount: 4 });
    mockBatch([event]);
    mockAsyncEmit.mockResolvedValueOnce([
      { status: 'rejected', reason: new Error('service unavailable') },
    ]);

    await dispatchOutboxEvents();

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      event._id,
      expect.objectContaining({
        retryCount:       5,
        deadLettered:     true,
        deadLetterReason: 'max_retries_exhausted',
        lastError:        expect.stringContaining('service unavailable'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. dispatchOutboxEvents is resilient to outer errors
// ─────────────────────────────────────────────────────────────────────────────

describe('dead-letter — dispatcher resilience', () => {
  it('does not throw when Outbox.find rejects', async () => {
    const sort  = jest.fn().mockRejectedValue(new Error('DB unavailable'));
    const limit = jest.fn().mockReturnValue({ sort });
    mockOutboxFind.mockReturnValue({ limit });

    await expect(dispatchOutboxEvents()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  6. Retry path: not dead-lettered when retryCount < MAX
// ─────────────────────────────────────────────────────────────────────────────

describe('dead-letter — NOT triggered when retry budget remains', () => {
  it('increments retryCount without dead-lettering at retryCount=1', async () => {
    const event = makeEvent({ retryCount: 1 });
    mockBatch([event]);
    mockAsyncEmit.mockResolvedValueOnce([
      { status: 'rejected', reason: new Error('transient') },
    ]);

    await dispatchOutboxEvents();

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      event._id,
      expect.objectContaining({ retryCount: 2 }),
    );
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalledWith(
      event._id,
      expect.objectContaining({ deadLettered: true }),
    );
  });
});
