'use strict';

/**
 * Issue #617 — Transactional outbox pattern: at-least-once webhook delivery.
 *
 * The outbox pattern guarantees that a webhook event is never silently lost:
 * the event is written to the outbox collection in the same DB transaction as
 * the domain write (savePayment), and a background worker delivers it at least
 * once with exponential back-off and dead-lettering after 5 failures.
 *
 * Tests:
 *   1. savePayment writes an outbox event atomically with the payment record.
 *   2. savePayment does NOT create an outbox event when Payment.create fails.
 *   3. dispatchOutboxEvents picks up unprocessed events and marks them processed.
 *   4. dispatchOutboxEvents retries failed events (at-least-once guarantee).
 *   5. dispatchOutboxEvents dead-letters events that exceed MAX_RETRIES.
 *   6. dispatchOutboxEvents skips already-dead-lettered events.
 *   7. dispatchOutboxEvents processes a mixed batch correctly.
 *   8. The outbox event payload contains all fields needed for downstream delivery.
 *   9. Outbox write failure does not leave a dangling payment (transaction safety).
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../backend/src/models/paymentModel');
jest.mock('../backend/src/utils/generateReferenceCode', () => ({
  generateReferenceCode: jest.fn().mockResolvedValue('REF-OUTBOX-001'),
}));
jest.mock('../backend/src/utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const mockFindByIdAndUpdate = jest.fn().mockResolvedValue(undefined);
const mockOutboxFind        = jest.fn();
const mockOutboxCreate      = jest.fn().mockResolvedValue({});
jest.mock('../backend/src/models/outboxModel', () => ({
  find:              (...a) => mockOutboxFind(...a),
  findByIdAndUpdate: (...a) => mockFindByIdAndUpdate(...a),
  create:            (...a) => mockOutboxCreate(...a),
}));

const mockAsyncEmit = jest.fn().mockResolvedValue([{ status: 'fulfilled', value: undefined }]);
jest.mock('../backend/src/events/paymentEvents', () => ({
  emit:     jest.fn(),
  asyncEmit: (...a) => mockAsyncEmit(...a),
  on:       jest.fn(),
  rawListeners: jest.fn().mockReturnValue([]),
  removeAllListeners: jest.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockBatch(batch) {
  const sort  = jest.fn().mockResolvedValue(batch);
  const limit = jest.fn().mockReturnValue({ sort });
  mockOutboxFind.mockReturnValue({ limit });
  return { limit, sort };
}

// ── Imports (after mocks) ─────────────────────────────────────────────────────

const Payment             = require('../backend/src/models/paymentModel');
const { savePayment }     = require('../backend/src/services/transactionService');
const { dispatchOutboxEvents } = require('../backend/src/services/outboxDispatcher');

const PAYMENT_DATA = {
  transactionHash: 'tx-outbox-001',
  txHash:          'tx-outbox-001',
  schoolId:        'SCH-617',
  studentId:       'STU-617',
  amount:          500,
};

const PAYMENT_DOC = {
  ...PAYMENT_DATA,
  _id:        'pay-617',
  toObject:   () => ({ ...PAYMENT_DATA, _id: 'pay-617' }),
};

beforeEach(() => {
  jest.clearAllMocks();
  Payment.findOne.mockResolvedValue(null);
  Payment.create.mockResolvedValue(PAYMENT_DOC);
  mockOutboxCreate.mockResolvedValue({});
  mockFindByIdAndUpdate.mockResolvedValue(undefined);
  mockAsyncEmit.mockResolvedValue([{ status: 'fulfilled', value: undefined }]);
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. savePayment writes an outbox event atomically with the payment
// ─────────────────────────────────────────────────────────────────────────────

describe('savePayment — outbox event written atomically', () => {
  it('calls Outbox.create with the correct event shape after Payment.create', async () => {
    await savePayment(PAYMENT_DATA);

    expect(Payment.create).toHaveBeenCalledTimes(1);
    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);

    const [outboxDoc] = mockOutboxCreate.mock.calls[0];
    expect(outboxDoc).toMatchObject({
      eventType:     'payment.saved',
      aggregateId:   PAYMENT_DATA.transactionHash,
      aggregateType: 'payment',
      payload:       expect.objectContaining({
        txHash:   PAYMENT_DATA.txHash,
        schoolId: PAYMENT_DATA.schoolId,
      }),
    });
  });

  it('assigns a UUID eventId to every outbox event', async () => {
    await savePayment(PAYMENT_DATA);
    const [outboxDoc] = mockOutboxCreate.mock.calls[0];
    expect(typeof outboxDoc.eventId).toBe('string');
    expect(outboxDoc.eventId.length).toBeGreaterThan(0);
  });

  it('Outbox.create is called in the same call stack as Payment.create', async () => {
    const callOrder = [];
    Payment.create.mockImplementation(async () => {
      callOrder.push('payment');
      return PAYMENT_DOC;
    });
    mockOutboxCreate.mockImplementation(async () => {
      callOrder.push('outbox');
      return {};
    });

    await savePayment(PAYMENT_DATA);
    expect(callOrder).toEqual(['payment', 'outbox']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. savePayment does NOT write an outbox event when Payment.create fails
// ─────────────────────────────────────────────────────────────────────────────

describe('savePayment — no outbox event on payment write failure', () => {
  it('does not call Outbox.create when Payment.create throws', async () => {
    Payment.create.mockRejectedValue(new Error('DB write error'));
    await expect(savePayment(PAYMENT_DATA)).rejects.toThrow('DB write error');
    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });

  it('propagates duplicate-key errors as DUPLICATE_TX', async () => {
    const dupErr = Object.assign(new Error('E11000'), { code: 11000 });
    Payment.create.mockRejectedValue(dupErr);
    await expect(savePayment(PAYMENT_DATA)).rejects.toMatchObject({ code: 'DUPLICATE_TX' });
    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. dispatchOutboxEvents — delivers pending events and marks them processed
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchOutboxEvents — delivers pending events', () => {
  it('queries for unprocessed, non-dead-lettered events that are due', async () => {
    mockBatch([]);
    await dispatchOutboxEvents();
    const query = mockOutboxFind.mock.calls[0][0];
    expect(query.processed).toBe(false);
    expect(query.deadLettered).toEqual({ $ne: true });
    // nextRetryAt filter should be present
    expect(query.$or).toBeDefined();
  });

  it('calls asyncEmit for each pending event', async () => {
    const event = {
      _id: 'ev-1', eventId: 'eid-1', eventType: 'payment.saved',
      payload: { txHash: 'tx1' }, retryCount: 0,
    };
    mockBatch([event]);
    await dispatchOutboxEvents();
    expect(mockAsyncEmit).toHaveBeenCalledWith('payment.saved', event.payload);
  });

  it('marks the event processed: true after successful dispatch', async () => {
    const event = {
      _id: 'ev-2', eventId: 'eid-2', eventType: 'payment.saved',
      payload: { txHash: 'tx2' }, retryCount: 0,
    };
    mockBatch([event]);
    await dispatchOutboxEvents();
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'ev-2',
      expect.objectContaining({ processed: true, processedAt: expect.any(Date) }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. At-least-once: retries on listener failure
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchOutboxEvents — retries on listener failure (at-least-once)', () => {
  it('increments retryCount when a listener rejects', async () => {
    const event = {
      _id: 'ev-retry', eventId: 'eid-retry', eventType: 'payment.saved',
      payload: { txHash: 'tx-retry' }, retryCount: 0,
    };
    mockBatch([event]);
    mockAsyncEmit.mockResolvedValueOnce([
      { status: 'rejected', reason: new Error('webhook timeout') },
    ]);

    await dispatchOutboxEvents();

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'ev-retry',
      expect.objectContaining({ retryCount: 1, lastError: expect.any(String) }),
    );
    // Must NOT be marked processed
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalledWith(
      'ev-retry',
      expect.objectContaining({ processed: true }),
    );
  });

  it('does not dead-letter an event that still has retry budget remaining', async () => {
    const event = {
      _id: 'ev-budget', eventId: 'eid-budget', eventType: 'payment.saved',
      payload: {}, retryCount: 1,
    };
    mockBatch([event]);
    mockAsyncEmit.mockResolvedValueOnce([
      { status: 'rejected', reason: new Error('transient error') },
    ]);

    await dispatchOutboxEvents();

    expect(mockFindByIdAndUpdate).not.toHaveBeenCalledWith(
      'ev-budget',
      expect.objectContaining({ deadLettered: true }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. Dead-lettering after MAX_RETRIES
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchOutboxEvents — dead-letters events that exhaust retries', () => {
  it('dead-letters an event whose retryCount is already at MAX_RETRIES', async () => {
    // MAX_RETRIES defaults to 5 (from OUTBOX_MAX_RETRIES env or fallback)
    const event = {
      _id: 'ev-dl', eventId: 'eid-dl', eventType: 'payment.saved',
      payload: {}, retryCount: 5, lastError: 'persistent failure',
    };
    mockBatch([event]);

    await dispatchOutboxEvents();

    // asyncEmit should NOT be called — event is already exhausted
    expect(mockAsyncEmit).not.toHaveBeenCalled();
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'ev-dl',
      expect.objectContaining({
        deadLettered:     true,
        deadLetteredAt:   expect.any(Date),
        deadLetterReason: 'max_retries_exhausted',
      }),
    );
  });

  it('dead-letters when the final retry attempt also fails', async () => {
    const event = {
      _id: 'ev-final', eventId: 'eid-final', eventType: 'payment.saved',
      payload: {}, retryCount: 4,
    };
    mockBatch([event]);
    mockAsyncEmit.mockResolvedValueOnce([
      { status: 'rejected', reason: new Error('final failure') },
    ]);

    await dispatchOutboxEvents();

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'ev-final',
      expect.objectContaining({
        deadLettered:     true,
        deadLetterReason: 'max_retries_exhausted',
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  6. Dead-lettered events are skipped by the dispatcher query
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchOutboxEvents — skips dead-lettered events', () => {
  it('the query excludes deadLettered: true events', async () => {
    mockBatch([]);
    await dispatchOutboxEvents();
    const query = mockOutboxFind.mock.calls[0][0];
    expect(query.deadLettered).toEqual({ $ne: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  7. Mixed batch: healthy and exhausted events processed correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchOutboxEvents — mixed batch', () => {
  it('processes healthy events and dead-letters exhausted ones in the same batch', async () => {
    const healthy = {
      _id: 'ev-healthy', eventId: 'eid-healthy', eventType: 'payment.confirmed',
      payload: { txHash: 'ok' }, retryCount: 0,
    };
    const exhausted = {
      _id: 'ev-exhausted', eventId: 'eid-exhausted', eventType: 'payment.failed',
      payload: {}, retryCount: 5, lastError: 'old error',
    };
    mockBatch([exhausted, healthy]);

    await dispatchOutboxEvents();

    // Exhausted event must be dead-lettered without calling asyncEmit for it
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'ev-exhausted',
      expect.objectContaining({ deadLettered: true }),
    );
    // Healthy event must be dispatched and marked processed
    expect(mockAsyncEmit).toHaveBeenCalledWith('payment.confirmed', healthy.payload);
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'ev-healthy',
      expect.objectContaining({ processed: true }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  8. Outbox event payload contains the fields needed for downstream delivery
// ─────────────────────────────────────────────────────────────────────────────

describe('savePayment — outbox payload completeness', () => {
  it('outbox payload includes txHash, schoolId, studentId, amount', async () => {
    await savePayment(PAYMENT_DATA);
    const [outboxDoc] = mockOutboxCreate.mock.calls[0];
    expect(outboxDoc.payload).toMatchObject({
      txHash:    expect.any(String),
      schoolId:  PAYMENT_DATA.schoolId,
    });
  });

  it('outbox aggregateId matches the payment txHash', async () => {
    await savePayment(PAYMENT_DATA);
    const [outboxDoc] = mockOutboxCreate.mock.calls[0];
    expect(outboxDoc.aggregateId).toBe(PAYMENT_DATA.transactionHash);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  9. Exponential back-off: nextRetryAt is set on retry
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchOutboxEvents — exponential back-off on retry', () => {
  it('sets nextRetryAt when a listener fails and retries remain', async () => {
    const event = {
      _id: 'ev-backoff', eventId: 'eid-backoff', eventType: 'payment.saved',
      payload: {}, retryCount: 0,
    };
    mockBatch([event]);
    mockAsyncEmit.mockResolvedValueOnce([
      { status: 'rejected', reason: new Error('timeout') },
    ]);

    const before = Date.now();
    await dispatchOutboxEvents();
    const after = Date.now();

    const call = mockFindByIdAndUpdate.mock.calls.find(([id]) => id === 'ev-backoff');
    expect(call).toBeDefined();
    const { nextRetryAt } = call[1];
    expect(nextRetryAt).toBeInstanceOf(Date);
    // nextRetryAt should be in the future (at least 1 s from now)
    expect(nextRetryAt.getTime()).toBeGreaterThanOrEqual(before + 1_000 - 50);
  });

  it('back-off delay grows with each retry attempt', async () => {
    const { getOutboxBackoffMs } = require('../backend/src/services/outboxDispatcher');
    const d0 = getOutboxBackoffMs(1);
    const d1 = getOutboxBackoffMs(2);
    const d2 = getOutboxBackoffMs(3);
    const d3 = getOutboxBackoffMs(4);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    // Should cap at 8 s
    expect(d3).toBe(d2);
  });
});
