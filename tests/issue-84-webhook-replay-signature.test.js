'use strict';

/**
 * Issue #84 — Outbound webhook signing and replay protection.
 *
 * Verifies the original acceptance criteria:
 *   1. All outbound webhooks include an HMAC signature header.
 *   2. All outbound webhooks include a timestamp header (Unix seconds).
 *   3. The header format is sha256={64-hex-chars}.
 *   4. Consumers can reject payloads where the timestamp is older than 5 min.
 *   5. verifyWebhookSignature SDK helper enforces the 300 s tolerance window.
 *   6. Secret rotation: a new secret produces a different signature, old
 *      signatures are immediately invalid under the new secret.
 */

const crypto = require('crypto');

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockAxiosPost = jest.fn();
jest.mock('axios', () => ({ post: mockAxiosPost, create: () => ({ post: mockAxiosPost }) }));
jest.mock('uuid', () => ({ v4: () => 'test-delivery-uuid-84' }));

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
  fireWebhook,
  generateSignature,
  verifyWebhookSignature,
  _resetNonces,
} = require('../backend/src/services/webhookService');

// ── Constants ─────────────────────────────────────────────────────────────────

const SECRET  = 'school-webhook-secret-rotation-test';
const URL     = 'https://school.example.com/webhook';
const EVENT   = 'payment.confirmed';
const PAYLOAD = { studentId: 'STU001', amount: 250, txHash: 'tx-84' };

beforeEach(() => {
  jest.clearAllMocks();
  mockAxiosPost.mockResolvedValue({ status: 200 });
  _resetNonces();
  // Restore Redis mock after clearAllMocks
  const redisClient = require('../backend/src/config/redisClient');
  redisClient.isRedisReady.mockReturnValue(true);
  redisClient.getRedisClient.mockReturnValue({ set: jest.fn().mockResolvedValue('1') });
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. Outbound webhooks include the HMAC signature header
// ─────────────────────────────────────────────────────────────────────────────

describe('#84 — outbound webhook includes X-StellarEduPay-Signature', () => {
  it('header is present when a secret is provided', async () => {
    await fireWebhook(URL, EVENT, PAYLOAD, SECRET);
    const [, , config] = mockAxiosPost.mock.calls[0];
    expect(config.headers).toHaveProperty('X-StellarEduPay-Signature');
  });

  it('header is absent when no secret is provided', async () => {
    await fireWebhook(URL, EVENT, PAYLOAD);
    const [, , config] = mockAxiosPost.mock.calls[0];
    expect(config.headers).not.toHaveProperty('X-StellarEduPay-Signature');
  });

  it('header value starts with sha256=', async () => {
    await fireWebhook(URL, EVENT, PAYLOAD, SECRET);
    const [, , config] = mockAxiosPost.mock.calls[0];
    expect(config.headers['X-StellarEduPay-Signature']).toMatch(/^sha256=/);
  });

  it('header value is exactly sha256={64 hex chars}', async () => {
    await fireWebhook(URL, EVENT, PAYLOAD, SECRET);
    const [, , config] = mockAxiosPost.mock.calls[0];
    expect(config.headers['X-StellarEduPay-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

// ────────���────────────────────────────────────────────────────────────────────
//  2. Outbound webhooks include the timestamp header
// ─────────────────────────────────────────────────────────────────────────────

describe('#84 — outbound webhook includes X-StellarEduPay-Timestamp', () => {
  it('header is always present regardless of secret', async () => {
    await fireWebhook(URL, EVENT, PAYLOAD);
    const [, , config] = mockAxiosPost.mock.calls[0];
    expect(config.headers).toHaveProperty('X-StellarEduPay-Timestamp');
  });

  it('timestamp is a numeric Unix-epoch-seconds string', async () => {
    const before = Math.floor(Date.now() / 1000);
    await fireWebhook(URL, EVENT, PAYLOAD, SECRET);
    const after = Math.floor(Date.now() / 1000);
    const [, , config] = mockAxiosPost.mock.calls[0];
    const ts = parseInt(config.headers['X-StellarEduPay-Timestamp'], 10);
    expect(Number.isFinite(ts)).toBe(true);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('timestamp in body ISO string matches the header unix value (same second)', async () => {
    await fireWebhook(URL, EVENT, PAYLOAD, SECRET);
    const [, rawBodyArg, config] = mockAxiosPost.mock.calls[0];
    const body = JSON.parse(typeof rawBodyArg === 'string' ? rawBodyArg : JSON.stringify(rawBodyArg));
    const headerTs = parseInt(config.headers['X-StellarEduPay-Timestamp'], 10);
    const bodyTs   = Math.floor(new Date(body.timestamp).getTime() / 1000);
    expect(bodyTs).toBe(headerTs);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. Consumer-side: reject payloads with stale timestamps (> 300 s)
// ─────────────────────────────────────────────────────────────────────────────

describe('#84 — consumers must reject stale timestamps (replay protection)', () => {
  it('verifyWebhookSignature rejects a timestamp older than 300 s', () => {
    const staleTs   = Math.floor(Date.now() / 1000) - 400; // 400 s ago
    const rawBody   = JSON.stringify(PAYLOAD);
    const staleSig  = `sha256=${crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
    const headers   = {
      'x-stellaredupay-timestamp': String(staleTs),
      'x-stellaredupay-signature': staleSig,
    };
    const result = verifyWebhookSignature(rawBody, headers, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('timestamp out of tolerance');
  });

  it('verifyWebhookSignature accepts a timestamp within the 300 s window', () => {
    const freshTs  = Math.floor(Date.now() / 1000);
    const rawBody  = JSON.stringify(PAYLOAD);
    const freshSig = `sha256=${crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
    const headers  = {
      'x-stellaredupay-timestamp': String(freshTs),
      'x-stellaredupay-signature': freshSig,
    };
    expect(verifyWebhookSignature(rawBody, headers, SECRET)).toEqual({ valid: true });
  });

  it('verifyWebhookSignature rejects exactly at tolerance boundary + 1 s', () => {
    const borderTs = Math.floor(Date.now() / 1000) - 301;
    const rawBody  = JSON.stringify(PAYLOAD);
    const sig      = `sha256=${crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
    const headers  = {
      'x-stellaredupay-timestamp': String(borderTs),
      'x-stellaredupay-signature': sig,
    };
    const result = verifyWebhookSignature(rawBody, headers, SECRET);
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. Secret rotation
// ─────────────────────────────────────────────────────────────────────────────

describe('#84 — secret rotation invalidates old signatures immediately', () => {
  const SECRET_V1 = 'old-webhook-secret';
  const SECRET_V2 = 'new-rotated-webhook-secret';

  it('different secrets produce different signatures for the same body', () => {
    const body = { event: EVENT, data: PAYLOAD };
    const sig1 = generateSignature(body, SECRET_V1);
    const sig2 = generateSignature(body, SECRET_V2);
    expect(sig1).not.toBe(sig2);
  });

  it('a signature made with the old secret fails verification under the new secret', () => {
    const rawBody  = JSON.stringify(PAYLOAD);
    const freshTs  = Math.floor(Date.now() / 1000);
    const oldSig   = `sha256=${crypto.createHmac('sha256', SECRET_V1).update(rawBody).digest('hex')}`;
    const headers  = {
      'x-stellaredupay-timestamp': String(freshTs),
      'x-stellaredupay-signature': oldSig,
    };
    const result = verifyWebhookSignature(rawBody, headers, SECRET_V2);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature mismatch');
  });

  it('a signature made with the new secret passes verification under the new secret', () => {
    const rawBody  = JSON.stringify(PAYLOAD);
    const freshTs  = Math.floor(Date.now() / 1000);
    const newSig   = `sha256=${crypto.createHmac('sha256', SECRET_V2).update(rawBody).digest('hex')}`;
    const headers  = {
      'x-stellaredupay-timestamp': String(freshTs),
      'x-stellaredupay-signature': newSig,
    };
    expect(verifyWebhookSignature(rawBody, headers, SECRET_V2)).toEqual({ valid: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. fireWebhook signature is verifiable by the SDK helper
// ─────────────────────────────────────────────────────────────────────────────

describe('#84 — fireWebhook signature is verifiable by verifyWebhookSignature', () => {
  it('a delivery signed by fireWebhook passes the SDK helper', async () => {
    await fireWebhook(URL, EVENT, PAYLOAD, SECRET);
    const [, rawBodyArg, config] = mockAxiosPost.mock.calls[0];
    const rawBody  = typeof rawBodyArg === 'string' ? rawBodyArg : JSON.stringify(rawBodyArg);
    const headers  = {
      'x-stellaredupay-timestamp': config.headers['X-StellarEduPay-Timestamp'],
      'x-stellaredupay-signature': config.headers['X-StellarEduPay-Signature'],
    };
    expect(verifyWebhookSignature(rawBody, headers, SECRET)).toEqual({ valid: true });
  });

  it('a delivery signed by fireWebhook fails the SDK helper with a wrong secret', async () => {
    await fireWebhook(URL, EVENT, PAYLOAD, SECRET);
    const [, rawBodyArg, config] = mockAxiosPost.mock.calls[0];
    const rawBody  = typeof rawBodyArg === 'string' ? rawBodyArg : JSON.stringify(rawBodyArg);
    const headers  = {
      'x-stellaredupay-timestamp': config.headers['X-StellarEduPay-Timestamp'],
      'x-stellaredupay-signature': config.headers['X-StellarEduPay-Signature'],
    };
    const result = verifyWebhookSignature(rawBody, headers, 'wrong-secret');
    expect(result.valid).toBe(false);
  });
});
