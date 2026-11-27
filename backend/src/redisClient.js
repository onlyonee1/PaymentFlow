'use strict';

/**
 * Sentinel-aware Redis client factory.
 *
 * When REDIS_SENTINEL_HOSTS is set, creates an ioredis client configured for
 * Redis Sentinel (automatic failover). Otherwise falls back to a plain
 * standalone connection using REDIS_HOST / REDIS_PORT.
 *
 * Usage:
 *   const { createRedisClient, isSentinelMode } = require('./redisClient');
 *   const redis = createRedisClient();
 *
 * Environment variables:
 *   REDIS_SENTINEL_HOSTS  — comma-separated list of sentinel host:port pairs
 *                            e.g. "sentinel1:26379,sentinel2:26379,sentinel3:26379"
 *   REDIS_SENTINEL_NAME   — monitored master name (default: "mymaster")
 *   REDIS_HOST            — standalone host (default: "localhost")
 *   REDIS_PORT            — standalone port (default: 6379)
 *   REDIS_PASSWORD        — optional AUTH password (applies to both modes)
 */

const Redis = require('ioredis');

/**
 * Returns true when Redis Sentinel mode is active (REDIS_SENTINEL_HOSTS is set).
 */
function isSentinelMode() {
  return !!(process.env.REDIS_SENTINEL_HOSTS);
}

/**
 * Creates and returns a new ioredis client.
 *
 * In Sentinel mode the client auto-reconnects to the new primary after
 * failover — the application does not need to restart.
 *
 * @param {object} [options] - Additional ioredis constructor options (merged last).
 * @returns {import('ioredis').Redis}
 */
function createRedisClient(options = {}) {
  if (isSentinelMode()) {
    const sentinels = process.env.REDIS_SENTINEL_HOSTS.split(',').map((entry) => {
      const [host, port] = entry.trim().split(':');
      return { host: host.trim(), port: parseInt(port || '26379', 10) };
    });

    const name = process.env.REDIS_SENTINEL_NAME || 'mymaster';

    return new Redis({
      sentinels,
      name,
      password: process.env.REDIS_PASSWORD || undefined,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      // Exponential back-off capped at 3 s — fast enough to recover within
      // the 10-second failover SLA (sentinel quorum + election + reconnect).
      retryStrategy: (times) => Math.min(times * 100, 3000),
      ...options,
    });
  }

  // Standalone (default) — used in development and when Sentinel is not configured.
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    ...options,
  });
}

module.exports = { createRedisClient, isSentinelMode };
