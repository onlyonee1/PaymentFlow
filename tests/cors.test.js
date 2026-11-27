'use strict';

/**
 * Tests for Issue #824 — CORS credentials + origin allowlist audit.
 *
 * parseAllowedOrigins() must:
 *  - Reject wildcard (*) unconditionally (credentials:true makes it unsafe)
 *  - Reject an empty/blank origin list
 *  - Accept a single valid origin
 *  - Accept a comma-separated list of valid origins
 *  - Trim whitespace around each entry
 *  - Reject invalid URLs
 */

const { parseAllowedOrigins, createOriginPolicy } = require('../backend/src/utils/corsOrigins');

function withEnv(envOverrides, read) {
  const saved = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  let result, error;
  try {
    result = read();
  } catch (e) {
    error = e;
  }
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (error) throw error;
  return result;
}

const parse = (env) => withEnv(env, parseAllowedOrigins);

describe('Issue #824 — CORS origin allowlist', () => {
  // ── Wildcard rejection (credentials:true makes * unsafe) ─────────────────

  test('wildcard (*) is rejected in development', () => {
    expect(() =>
      parse({ NODE_ENV: 'development', ALLOWED_ORIGIN: '*' })
    ).toThrow(/wildcard.*not permitted/i);
  });

  test('wildcard (*) is rejected in production', () => {
    expect(() =>
      parse({ NODE_ENV: 'production', ALLOWED_ORIGIN: '*' })
    ).toThrow(/wildcard.*not permitted/i);
  });

  // ── Empty / blank origin list ─────────────────────────────────────────────

  test('empty ALLOWED_ORIGIN string throws a descriptive error', () => {
    expect(() =>
      parse({ ALLOWED_ORIGIN: '   ' })
    ).toThrow(/at least one valid origin/i);
  });

  // ── Valid configurations ──────────────────────────────────────────────────

  test('single valid origin returns the origin string', () => {
    expect(parse({ ALLOWED_ORIGIN: 'https://app.school.com' }))
      .toBe('https://app.school.com');
  });

  test('comma-separated valid origins return an array', () => {
    expect(
      parse({ ALLOWED_ORIGIN: 'https://app.school.com,https://admin.school.com' })
    ).toEqual(['https://app.school.com', 'https://admin.school.com']);
  });

  test('whitespace around origins is trimmed', () => {
    expect(
      parse({ ALLOWED_ORIGIN: '  https://app.school.com  ,  https://admin.school.com  ' })
    ).toEqual(['https://app.school.com', 'https://admin.school.com']);
  });

  test('missing ALLOWED_ORIGIN falls back to http://localhost:3000', () => {
    expect(parse({ ALLOWED_ORIGIN: undefined })).toBe('http://localhost:3000');
  });

  // ── Invalid URL rejection ─────────────────────────────────────────────────

  test('invalid URL throws a descriptive error', () => {
    expect(() =>
      parse({ ALLOWED_ORIGIN: 'not-a-url' })
    ).toThrow(/invalid URL/i);
  });

  test('one invalid URL in a comma-separated list throws', () => {
    expect(() =>
      parse({ ALLOWED_ORIGIN: 'https://app.school.com,bad-url' })
    ).toThrow(/invalid URL/i);
  });
});

describe('environment origin policy', () => {
  function isAllowed(env, origin) {
    const policy = withEnv(env, createOriginPolicy);
    const callback = jest.fn();
    policy(origin, callback);
    return callback.mock.calls[0][1];
  }

  test('production serves only its configured frontend and ignores preview patterns', () => {
    const env = {
      NODE_ENV: 'production',
      CORS_ENV: undefined,
      ALLOWED_ORIGIN: 'https://app.school.com',
      CORS_ALLOWED_ORIGIN_PATTERN: '.*',
    };
    expect(isAllowed(env, 'https://app.school.com')).toBe(true);
    expect(isAllowed(env, 'https://paymentflow-pr-12.vercel.app')).toBe(false);
    expect(isAllowed(env, 'null')).toBe(false);
  });

  test('staging preview matching requires the full canonical HTTPS origin', () => {
    const env = {
      NODE_ENV: 'production',
      CORS_ENV: 'staging',
      ALLOWED_ORIGIN: 'https://staging.school.com',
      CORS_ALLOWED_ORIGIN_PATTERN: String.raw`https://paymentflow-pr-[0-9]+\.vercel\.app`,
    };
    expect(isAllowed(env, 'https://staging.school.com')).toBe(true);
    expect(isAllowed(env, 'https://paymentflow-pr-12.vercel.app')).toBe(true);
    expect(isAllowed(env, 'https://paymentflow-pr-12.vercel.app.example.com')).toBe(false);
    expect(isAllowed(env, 'https://paymentflow-pr-12.vercel.app/path')).toBe(false);
  });

  test('development allows only localhost:3000', () => {
    const env = { NODE_ENV: 'development', CORS_ENV: undefined, ALLOWED_ORIGIN: 'https://app.school.com' };
    expect(isAllowed(env, 'http://localhost:3000')).toBe(true);
    expect(isAllowed(env, 'https://app.school.com')).toBe(false);
  });
});
