# Async Report Generation (Issue #621)

## Overview

Large financial reports (full academic year, 10k+ students) previously timed out
when generated synchronously (> 30 s). Reports are now generated asynchronously
via a BullMQ job queue, with the client polling for status or receiving an SSE
notification when the download is ready.

## Flow

```
POST /api/reports?async=true   →  202 Accepted  { jobId, statusUrl }
                                       │
                                  BullMQ enqueues "generate-report" job
                                       │
                               Worker picks up job
                                       │
                           reportQueueService processes
                           (generateReport / generateAccountingCsv)
                                       │
                        ReportJob record updated: completed / failed
                                       │
                        SSE event emitted to connected clients
                                       │
GET /api/reports/jobs/:jobId          →  { status, downloadUrl }
GET /api/reports/jobs/:jobId/download →  report payload
```

## Endpoints

### `POST /api/reports?async=true`
Enqueues a report job. Returns `202 Accepted` immediately.

```json
{
  "jobId": "report-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "pending",
  "message": "Report generation started. Poll /api/reports/jobs/{jobId} for status.",
  "statusUrl": "/api/reports/jobs/report-xxxxxxxx-..."
}
```

The `async=true` flag is only honoured when the date range is ≥ `LARGE_REPORT_THRESHOLD_DAYS`
(default 30 days). Smaller reports are still generated synchronously.

### `GET /api/reports/jobs/:jobId`
Returns current job status.

```json
{
  "jobId": "report-...",
  "type": "report",
  "status": "completed",
  "downloadUrl": "/api/reports/jobs/report-.../download",
  "params": { "startDate": "2026-01-01", "endDate": "2026-12-31" },
  "completedAt": "2026-01-15T12:05:00.000Z"
}
```

**Status values**: `pending` | `processing` | `completed` | `failed`

Failed jobs include an `error` field:
```json
{ "status": "failed", "error": "Aggregation exceeded time budget (15000 ms)" }
```

### `GET /api/reports/jobs/:jobId/download`
Streams the report payload. Returns `409 Conflict` if the job is not yet complete.

## Implementation Details

### Queue (`backend/src/queue/reportQueue.js`)
- BullMQ `Queue` on Redis connection (`report-generation` queue name).
- `enqueueReportJob` creates a `ReportJob` Mongoose document and enqueues the job.
- Job options: 2 attempts, exponential backoff (5 s base), completed jobs cleaned
  after 1 hour (up to 100 entries).

### Worker (`backend/src/services/reportQueueService.js`)
- BullMQ `Worker` processes `generate-report` jobs.
- Calls `generateReport` or `generateAccountingCsv` depending on `type`.
- Writes result into `ReportJob.result`; sets status to `completed` or `failed`.
- TTL-based expiry via `ReportJob.expiresAt` (default 6 hours).

### Model (`backend/src/models/reportJobModel.js`)
- Fields: `schoolId`, `jobId`, `type`, `status`, `params`, `result`, timestamps.
- TTL index on `expiresAt` for automatic cleanup.
- Virtual `downloadUrl` and `statusUrl` properties.

### Aggregation Time Budget
Every MongoDB aggregation in `reportService.js` passes `maxTimeMS` from
`POOL_CONFIG.reportAggregationMaxTimeMS` (default 15 000 ms, overridable via
`DB_REPORT_AGGREGATION_MAX_TIME_MS`). This prevents slow pipelines from
pinning pool connections indefinitely.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `LARGE_REPORT_THRESHOLD_DAYS` | `30` | Minimum date range to trigger async path |
| `REPORT_JOB_TTL_MS` | `21600000` (6 h) | Lifetime of completed job artifacts |
| `REPORT_QUEUE_CONCURRENCY` | `2` | Parallel worker slots |
| `DB_REPORT_AGGREGATION_MAX_TIME_MS` | `15000` | MongoDB maxTimeMS for report aggregations |

## Tests

| File | Coverage |
|---|---|
| `tests/report-async.test.js` | Cache key versioning, ReportJob model structure |
| `tests/reportDownload.test.js` | Download component logic, CSV URL building |
| `tests/report-aggregation-maxtimems.test.js` | maxTimeMS enforcement on every aggregation |
