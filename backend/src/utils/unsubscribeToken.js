'use strict';

const crypto = require('crypto');

const TOKEN_EXPIRY_DAYS = 90;

/**
 * Generate a signed unsubscribe token for a student.
 * Token format: base64(timestamp:signature)
 * Signature covers: studentId:schoolId:timestamp
 * 
 * @param {string} studentId
 * @param {string} schoolId
 * @param {string} secret - JWT_SECRET or similar
 * @returns {string} Signed token
 */
function generateUnsubscribeToken(studentId, schoolId, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const data = `${studentId}:${schoolId}:${timestamp}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
  const token = `${timestamp}.${signature}.${Buffer.from(studentId).toString('base64')}.${Buffer.from(schoolId).toString('base64')}`;
  return token;
}

/**
 * Verify and decode an unsubscribe token.
 * Returns { valid: true, studentId, schoolId } or { valid: false, error }
 * 
 * @param {string} token
 * @param {string} secret
 * @returns {object}
 */
function verifyUnsubscribeToken(token, secret) {
  try {
    const parts = typeof token === 'string' && token.length <= 1024
      ? /^([1-9][0-9]{0,11})\.([0-9a-f]{64})\.([A-Za-z0-9+/]+={0,2})\.([A-Za-z0-9+/]+={0,2})$/.exec(token)
      : null;
    if (!parts) return { valid: false, error: 'Invalid token format' };

    const [, timestampStr, signature, studentIdB64, schoolIdB64] = parts;
    const timestamp = Number(timestampStr);
    const age = Math.floor(Date.now() / 1000) - timestamp;
    if (age < 0) return { valid: false, error: 'Invalid timestamp' };
    if (age > TOKEN_EXPIRY_DAYS * 86400) return { valid: false, error: 'Token expired' };

    const studentId = Buffer.from(studentIdB64, 'base64').toString('utf8');
    const schoolId = Buffer.from(schoolIdB64, 'base64').toString('utf8');
    if (Buffer.from(studentId).toString('base64') !== studentIdB64 || Buffer.from(schoolId).toString('base64') !== schoolIdB64) {
      return { valid: false, error: 'Invalid token format' };
    }

    const data = `${studentId}:${schoolId}:${timestamp}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(data).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))) {
      return { valid: false, error: 'Invalid signature' };
    }

    return { valid: true, studentId, schoolId };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

const emailPreferenceFields = Object.freeze({
  payment_reminder: 'reminderOptOut',
  payment_confirmation: 'paymentConfirmationOptOut',
  dispute_update: 'disputeUpdateOptOut',
});

function emailPreferenceField(type) {
  return Object.hasOwn(emailPreferenceFields, type) ? emailPreferenceFields[type] : null;
}

function signEmailPreference(userId, type, timestamp, secret) {
  return crypto.createHmac('sha256', secret)
    .update(`${userId}:${type}:${timestamp}`).digest('base64url');
}

function generateEmailUnsubscribeToken(studentId, schoolId, type, secret) {
  if (!emailPreferenceField(type)) throw new TypeError('Invalid email type');
  const userId = Buffer.from(JSON.stringify([schoolId, studentId])).toString('base64url');
  const timestamp = Math.floor(Date.now() / 1000);
  return `${userId}.${timestamp}.${signEmailPreference(userId, type, timestamp, secret)}`;
}

function verifyEmailUnsubscribeToken(token, type, secret) {
  if (typeof token !== 'string' || token.length > 1024 || !emailPreferenceField(type)) return null;
  const match = /^([A-Za-z0-9_-]+)\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const [, userId, timestamp, signature] = match;
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (age < 0 || age > TOKEN_EXPIRY_DAYS * 86400) return null;
  const expected = signEmailPreference(userId, type, timestamp, secret);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const [schoolId, studentId] = JSON.parse(Buffer.from(userId, 'base64url').toString());
    if (typeof schoolId === 'string' && schoolId && typeof studentId === 'string' && studentId) {
      return { schoolId, studentId };
    }
  } catch {
    return null;
  }
  return null;
}

function emailUnsubscribeUrl(studentId, schoolId, type, config) {
  const url = new URL('/unsubscribe', config.APP_URL || 'http://localhost:5000');
  url.searchParams.set('token', generateEmailUnsubscribeToken(studentId, schoolId, type, config.EMAIL_UNSUBSCRIBE_SECRET || config.JWT_SECRET));
  url.searchParams.set('type', type);
  return url.href;
}

module.exports = {
  generateUnsubscribeToken, verifyUnsubscribeToken, emailPreferenceField,
  generateEmailUnsubscribeToken, verifyEmailUnsubscribeToken, emailUnsubscribeUrl,
};
