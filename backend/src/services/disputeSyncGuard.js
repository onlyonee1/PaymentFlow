'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { getRedisClient } = require('../config/redisClient');
const logger = require('../utils/logger');

const TTL_SECONDS = 172800;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

async function claimDisputeEvent(req, eventId) {
  const redis = getRedisClient();
  if (!redis) throw Object.assign(new Error('Dispute sync requires Redis.'), { status: 503 });

  const key = `dispute:sync:event:${eventId}`;
  const body = { ...req.body };
  delete body.eventId;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(canonicalize([req.schoolId, req.params.id, body])))
    .digest('hex');
  const pending = `${fingerprint}:${randomUUID()}`;

  try {
    if (await redis.set(key, pending, 'NX', 'EX', TTL_SECONDS)) {
      return {
        complete: () => redis.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL') end",
          1, key, pending, fingerprint,
        ),
        release: () => redis.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end",
          1, key, pending,
        ),
      };
    }

    const existing = await redis.get(key);
    if (existing === fingerprint) return { duplicate: true };
    if (!existing || existing.startsWith(`${fingerprint}:`)) return { processing: true };
    logger.warn('Dispute sync event ID reused with a different payload', { eventId, schoolId: req.schoolId });
    return { conflict: true };
  } catch (err) {
    logger.warn('Dispute sync deduplication unavailable', { error: err.message });
    throw Object.assign(new Error('Dispute sync deduplication is temporarily unavailable.'), { status: 503 });
  }
}

module.exports = { claimDisputeEvent };
