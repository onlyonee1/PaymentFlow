# Stellar Horizon Transaction Polling with Cursor-Based Resumption (Issue #619)

## Overview

The Horizon API poller previously restarted from the beginning of transaction
history on every process restart, causing expensive re-scans and duplicate-
processing overhead. It now persists a cursor to the school document after each
batch and resumes from there on restart.

## Cursor Management

### Persistence
After each successful poll cycle the last `paging_token` seen is written to the
school document:

```js
await School.updateOne(
  { schoolId },
  { $set: { syncCursor: cursor } }
);
```

### Resumption
On startup (or after a crash/restart) the poller reads `school.syncCursor` before
calling Horizon:

```js
const cursor = school.syncCursor || null;
// cursor passed to .cursor(c) on the Horizon request builder
// if null, Horizon starts from the oldest available record
```

### Cursor-Too-Old Fallback
If Horizon returns a 404 (paging_token no longer in its history), the poller
resets to the current ledger and emits a warning metric. This prevents the poller
from becoming permanently stuck on an expired cursor.

## Distributed Lock

Only one poller instance may process a given school wallet at a time. The lock
uses Redis `SET NX` via `distributedLock.acquire`:

- **TTL**: `SYNC_LOCK_TTL_MS` (default 30 s, refreshed every 10 s while running).
- If `acquire` returns `null` (lock already held), the school is skipped for
  that cycle without touching the cursor, so the winning worker can finish safely.
- The lock is always released in a `finally` block.

```js
const fencingToken = await lock.acquire(lockKey, SYNC_LOCK_TTL_MS);
if (!fencingToken) return { lockSkipped: true };
try {
  // ... poll Horizon ...
} finally {
  await lock.release(lockKey, fencingToken);
}
```

## Exponential Backoff

Consecutive Horizon errors trigger exponential backoff on the poll interval:

- Each error doubles `currentIntervalMs` (up to `POLL_MAX_BACKOFF_MS`, default 5 min).
- A successful cycle resets `consecutiveErrors` and `currentIntervalMs` to the
  base `SYNC_INTERVAL_MS`.
- A 429 response from Horizon surfaces `horizonError: true` on the result and
  does **not** advance the cursor, so the next cycle retries the same batch safely.

## Cross-School Rate Budget (#1124)

Schools no longer poll as independent operations that each assume the whole
Horizon rate limit is theirs. A shared `HorizonPollBudget` per cycle distributes
the allowance across schools in priority order:

- Schools with pending payment verifications get higher priority.
- Schools that have not synced recently age up in priority.
- The cycle budget is a function of the poll interval and Horizon's rate limit;
  adding schools divides the budget rather than growing it.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `SYNC_INTERVAL_MS` | From config | Base poll interval |
| `SYNC_LOCK_TTL_MS` | From config | Distributed lock TTL |
| `SYNC_MAX_PAGES_PER_POLL` | `50` | Max pages drained per school per cycle |
| `SYNC_MAX_CONCURRENT_SCHOOLS` | `4` | Max schools polled simultaneously |
| `POLL_MAX_BACKOFF_MS` | `300000` (5 min) | Backoff ceiling |

## Tests

| File | Coverage |
|---|---|
| `tests/transactionPollingCursor.test.js` | Cursor persistence, resumption, 429 handling, lock contention |
| `tests/transactionPollingBackoff.test.js` | Exponential backoff on consecutive errors |
| `tests/issue-1124-horizon-poll-budget.test.js` | Cross-school rate budget, priority ordering |
