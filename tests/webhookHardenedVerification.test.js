'use strict';

/**
 * Hardened verification tests for webhook HMAC signatures.
 *
 * Covers:
 *   1. verifySignature correctness and tamper-resistance (V1)
 *   2. verifyWebhookSignature SDK helper: timestamp tolerance, signature
 *      verification, and consumer-facing error reasons
 *   3. generateSignature determinism and secret-sensitivity
 */

const crypto = require('crypto');

// ── Mocks (keep the module loadable without real infrastructure) ──────────────

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 200 }),
  create: () => ({ post: jest.fn().mockResolvedValue({ status: 200 }) }),
}));
jest.mock('../backend/src/models/webhookRetryModel', () => ({
  create: jest.fn().mockResolvedValue({}),
  find: jest.fn().mockResolvedValue([]),
  updateOne: jest.fn().mockResolvedValue({}),
  findOneAndUpdate: jest.fn().mockResolvedValue(null),
}));
jest.mock('../backend/src/models/webhookDeliveryModel', () => ({
  create: jest.fn().mockResolvedValue({}),
}));
jest.mock('../backend/src/models/webhookEndpointModel', () => ({
  find: jest.fn().mockResolvedValue([]),
}));
jest.mock('../backend/src/utils/validateWebhookUrl', () => ({
  validateWebhookUrl: jest.fn().mockResolvedValue({ valid: true }),
  validateResolvedIp: jest.fn().mockReturnValue({ blocked: false }),
}));
jest.mock('../backend/src/utils/logger', () => {
  const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return Object.assign(l, { child: () => l });
});
jest.mock('../backend/src/config/redisClient', () => ({
  isRedisReady: jest.fn().mockReturnValue(true),
  getRedisClient: jest.fn().mockReturnValue({
    set: jest.fn().mockResolvedValue('1'),
  }),
}));

// ── Load module under test ────────────────────────────────────────────────────

const {
  generateSignature,
  verifySignature,
  verifyWebhookSignature,
} = require('../backend/src/services/webhookService');

// ── Constants ─────────────────────────────────────────────────────────────────

const SECRET = 'hardened-test-secret-abc123';
const BODY   = { event: 'payment.confirmed', data: { txHash: 'tx-abc', amount: 100 } };

// ─────────────────────────────────────────────────────────────────────────────
//  1. generateSignature
// ─────────────────────────────────────────────────────────────────────────────

describe('generateSignature', () => {
  it('produces a 64-character lowercase hex string', () => {
    const sig = generateSignature(BODY, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches a manual HMAC-SHA256 computation', () => {
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(JSON.stringify(BODY))
      .digest('hex');
    expect(generateSignature(BODY, SECRET)).toBe(expected);
  });

  it('is deterministic: same inputs always give the same digest', () => {
    expect(generateSignature(BODY, SECRET)).toBe(generateSignature(BODY, SECRET));
  });

  it('is sensitive to payload changes', () => {
    const altered = { ...BODY, data: { ...BODY.data, amount: 999 } };
    expect(generateSignature(BODY, SECRET)).not.toBe(generateSignature(altered, SECRET));
  });

  it('is sensitive to secret changes', () => {
    expect(generateSignature(BODY, SECRET)).not.toBe(generateSignature(BODY, 'different-secret'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. verifySignature
// ─────────────────────────────────────────────────────────────────────────────

describe('verifySignature', () => {
  it('returns true for a valid signature', () => {
    const sig = generateSignature(BODY, SECRET);
    expect(verifySignature(BODY, sig, SECRET)).toBe(true);
  });

  it('returns false for a tampered payload', () => {
    const sig = generateSignature(BODY, SECRET);
    const tampered = { ...BODY, data: { ...BODY.data, amount: 0 } };
    expect(verifySignature(tampered, sig, SECRET)).toBe(false);
  });

  it('returns false for a wrong secret', () => {
    const sig = generateSignature(BODY, SECRET);
    expect(verifySignature(BODY, sig, 'wrong-secret')).toBe(false);
  });

  it('returns false for a truncated (length-mismatched) signature without calling timingSafeEqual', () => {
    // A short hex string produces a Buffer shorter than 32 bytes, so the
    // length-guard fires before timingSafeEqual (which would throw on unequal
    // lengths).
    expect(verifySignature(BODY, 'deadbeef', SECRET)).toBe(false);
  });

  it('returns false for an all-zeros signature', () => {
    const zeros = '0'.repeat(64);
    expect(verifySignature(BODY, zeros, SECRET)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. verifyWebhookSignature — SDK helper
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyWebhookSignature SDK helper', () => {
  function makeHeaders(overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify(BODY);
    const sig = `sha256=${crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
    return {
      'x-stellaredupay-timestamp': String(overrides.ts ?? now),
      'x-stellaredupay-signature': overrides.sig ?? sig,
      ...overrides.extra,
    };
  }

  it('returns { valid: true } for a correctly signed fresh delivery', () => {
    const rawBody = JSON.stringify(BODY);
    const headers = makeHeaders();
    expect(verifyWebhookSignature(rawBody, headers, SECRET)).toEqual({ valid: true });
  });

  it('accepts a Buffer payload (raw bytes from framework middleware)', () => {
    const rawBody = Buffer.from(JSON.stringify(BODY));
    const headers = makeHeaders();
    expect(verifyWebhookSignature(rawBody, headers, SECRET)).toEqual({ valid: true });
  });

  it('rejects a stale timestamp (> 300 s old)', () => {
    const staleTs = Math.floor(Date.now() / 1000) - 400;
    const rawBody = JSON.stringify(BODY);
    const headers = makeHeaders({ ts: staleTs });
    const result = verifyWebhookSignature(rawBody, headers, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('timestamp out of tolerance');
  });

  it('rejects a future timestamp (> 300 s ahead)', () => {
    const futureTs = Math.floor(Date.now() / 1000) + 400;
    const rawBody = JSON.stringify(BODY);
    const headers = makeHeaders({ ts: futureTs });
    const result = verifyWebhookSignature(rawBody, headers, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('timestamp out of tolerance');
  });

  it('rejects when the signature header is missing', () => {
    const rawBody = JSON.stringify(BODY);
    const headers = {
      'x-stellaredupay-timestamp': String(Math.floor(Date.now() / 1000)),
    };
    const result = verifyWebhookSignature(rawBody, headers, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing signature');
  });

  it('rejects a tampered payload', () => {
    const rawBody = JSON.stringify(BODY);
    const headers = makeHeaders(); // signature over original rawBody
    const tamperedBody = JSON.stringify({ ...BODY, data: { txHash: 'evil' } });
    const result = verifyWebhookSignature(tamperedBody, headers, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature mismatch');
  });

  it('rejects a wrong secret', () => {
    const rawBody = JSON.stringify(BODY);
    const headers = makeHeaders(); // signed with SECRET
    const result = verifyWebhookSignature(rawBody, headers, 'wrong-secret');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature mismatch');
  });

  it('rejects a signature of wrong length (truncated hex)', () => {
    const rawBody = JSON.stringify(BODY);
    const headers = makeHeaders({ sig: 'sha256=abcd' });
    const result = verifyWebhookSignature(rawBody, headers, SECRET);
    expect(result.valid).toBe(false);
  });

  it('accepts uppercase header names (framework normalisation)', () => {
    const rawBody = JSON.stringify(BODY);
    const now = Math.floor(Date.now() / 1000);
    const sig = `sha256=${crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
    const headers = {
      'X-StellarEduPay-Timestamp': String(now),
      'X-StellarEduPay-Signature': sig,
    };
    expect(verifyWebhookSignature(rawBody, headers, SECRET)).toEqual({ valid: true });
  });
});
