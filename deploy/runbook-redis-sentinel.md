# Runbook: Redis Sentinel High-Availability

## Overview

PaymentFlow uses Redis for rate limiting, session management, idempotency keys,
and the Horizon polling cursor. In production, Redis Sentinel provides automatic
failover so that the loss of the primary instance does not require a manual restart
or cause a prolonged outage.

**Topology:** 1 primary, 2 replicas, 3 sentinels. Quorum = 2.

---

## Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_SENTINEL_HOSTS` | _(not set)_ | Comma-separated `host:port` list of sentinels. Setting this activates Sentinel mode. |
| `REDIS_SENTINEL_NAME` | `mymaster` | Name of the monitored master, as configured in sentinel.conf. |
| `REDIS_PASSWORD` | _(not set)_ | AUTH password for both primary and sentinels (if configured). |
| `REDIS_HOST` | `localhost` | Standalone host — used only when `REDIS_SENTINEL_HOSTS` is absent. |
| `REDIS_PORT` | `6379` | Standalone port — used only when `REDIS_SENTINEL_HOSTS` is absent. |

### Local development (Sentinel mode)

```bash
# Start the full Sentinel topology alongside the app stack
docker compose -f docker-compose.yml -f docker-compose.sentinel.yml up -d

# Verify Sentinel quorum
docker compose -f docker-compose.yml -f docker-compose.sentinel.yml \
  exec sentinel1 redis-cli -p 26379 SENTINEL masters
```

### Production (Kubernetes)

Deploy Redis as a StatefulSet with 3 pods (1 primary + 2 replicas) and a
separate Sentinel Deployment with 3 replicas. Configure the backend
Deployment with:

```yaml
env:
  - name: REDIS_SENTINEL_HOSTS
    value: "sentinel-0.redis-sentinel:26379,sentinel-1.redis-sentinel:26379,sentinel-2.redis-sentinel:26379"
  - name: REDIS_SENTINEL_NAME
    value: "mymaster"
```

---

## Failover procedure

### Automatic failover (normal operation)

1. A sentinel detects the primary is unreachable (after `down-after-milliseconds`: 5 s).
2. Sentinels vote for a failover (quorum = 2 out of 3 must agree).
3. The sentinel leader promotes the replica with the least replication lag.
4. All sentinels (and clients) are notified of the new primary address.
5. The backend ioredis client reconnects automatically via its `retryStrategy`.

**Expected recovery time:** ≤ 10 s from primary failure to backend reconnection.

### Testing failover manually

```bash
# Force the primary to become temporarily unavailable (sleeps for 30 s)
docker compose -f docker-compose.yml -f docker-compose.sentinel.yml \
  exec redis redis-cli DEBUG SLEEP 30

# Watch sentinel logs for the FAILOVER event
docker compose -f docker-compose.yml -f docker-compose.sentinel.yml logs -f sentinel1

# Confirm the new primary
docker compose -f docker-compose.yml -f docker-compose.sentinel.yml \
  exec sentinel1 redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster
```

### Manual failover (planned maintenance)

```bash
# Trigger an immediate failover (e.g. before patching the primary)
docker compose exec sentinel1 redis-cli -p 26379 SENTINEL failover mymaster
```

---

## Alert thresholds

| Alert | Condition | Severity | Action |
|---|---|---|---|
| `RedisMemoryHigh` | `used / maxmemory > 80%` for 5 m | warning | Review keyspace, consider raising maxmemory or purging stale keys |
| `RedisMemoryCritical` | `used / maxmemory > 95%` for 2 m | critical | Page on-call; evictions are occurring |
| `RedisNoReplicasConnected` | `connected_slaves == 0` for 2 m | warning | Check replica health; failover safety is compromised |
| `RedisReplicationLagHigh` | `replication_lag > 5 s` for 2 m | warning | Investigate network/disk I/O between primary and replica |

Alert rules are defined in `monitoring/alerts/redis.yml` and scraped by
`docker-compose.monitoring.yml`.

---

## Key Prometheus metrics

| Metric | Source | Description |
|---|---|---|
| `redis_connected_clients` | redis_exporter | Total connected clients |
| `redis_connected_slaves` | redis_exporter | Number of connected replicas |
| `redis_memory_used_bytes` | redis_exporter | Current heap memory usage |
| `redis_memory_max_bytes` | redis_exporter | Configured maxmemory (0 = unlimited) |
| `redis_replication_lag` | redis_exporter | Replication lag in seconds (replica only) |

---

## Rate limit counter durability on failover

Rate limit counters (stored as Redis keys by `express-rate-limit`) are replicated
synchronously to at least one replica before Sentinel will trigger a failover
(`min-replicas-to-write 1` in production sentinel.conf). This means counter resets
after failover are bounded to writes in the last `replication_lag` window — typically
< 1 s under normal operation.

---

## References

- [Redis Sentinel documentation](https://redis.io/docs/management/sentinel/)
- `backend/src/redisClient.js` — Sentinel-aware client factory
- `docker-compose.sentinel.yml` — local dev Sentinel topology
- `monitoring/alerts/redis.yml` — Prometheus alert rules
