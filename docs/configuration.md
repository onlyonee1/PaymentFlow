# Configuration reference

This page documents every active variable in [`.env.example`](../.env.example). Keep the example file and this table in sync; CI checks that every key has exactly one complete row. The [environment reference](environment-reference.md) explains runtime behavior, scope, owners, and sensitivity in more detail.

**Reading defaults:** a populated value is the safe example value from .env.example, not necessarily the runtime fallback. Empty values are unset and use the application's fallback unless the linked reference identifies a required setting. Secrets in .env.example are placeholders only; never use them in a deployed environment.

## Core server

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | enum | Example value: `development` | No | Express/runtime mode; use production in deployed environments. | `development` |
| `PORT` | number | Example value: `5000` | No | Backend HTTP port; docker-compose maps this host port to container port 5000. | `5000` |
| `API_URL` | URL | Example value: `http://localhost:5000/api` | No | Public API URL used in Swagger/OpenAPI docs. | `http://localhost:5000/api` |
| `APP_URL` | URL | Example value: `http://localhost:5000` | No | Public app URL used in generated notifications. | `http://localhost:5000` |
| `ALLOWED_ORIGIN` | comma-separated string list | Example value: `http://localhost:3000` | No | Allowed CORS origin or comma-separated origins. | `http://localhost:3000` |
| `TRUSTED_PROXY_HOPS` | number | Example value: `1` | No | Number of trusted reverse-proxy hops for client IP detection. | `1` |

## MongoDB

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `MONGO_URI` | URI | Required by the backend at startup. | Yes (secret; store in a secret manager). | MongoDB connection string required by the backend. | `<managed secret; do not commit>` |
| `MONGO_ROOT_USERNAME` | string | Example value: `root` | No | Mongo root username used by docker-compose. | `root` |
| `MONGO_ROOT_PASSWORD` | string | Local placeholder only; replace before use. | Yes (secret; store in a secret manager). | Mongo root password used by docker-compose. | `<managed secret; do not commit>` |
| `MONGODB_POOL_SIZE` | number | Example value: `20` | No | Canonical MongoDB max connection pool size. | `20` |
| `DB_MAX_POOL_SIZE` | number | Example value: `20` | No | Legacy MongoDB pool-size alias still accepted by the backend. | `20` |
| `DB_MIN_POOL_SIZE` | number | Example value: `10` | No | Minimum MongoDB connection pool size. | `10` |
| `DB_MAX_IDLE_TIME_MS` | number | Example value: `30000` | No | Maximum idle time for MongoDB sockets. | `30000` |
| `DB_CONNECT_TIMEOUT_MS` | number | Example value: `10000` | No | MongoDB connection timeout. | `10000` |
| `DB_SOCKET_TIMEOUT_MS` | number | Example value: `45000` | No | MongoDB socket timeout. | `45000` |
| `DB_SERVER_SELECTION_TIMEOUT_MS` | number | Example value: `5000` | No | MongoDB server selection timeout. | `5000` |
| `DB_MAX_CONCURRENT` | number | Example value: `50` | No | Maximum concurrent database operations tracked by the app. | `50` |
| `DB_READ_CONCERN` | string | Example value: `majority` | No | MongoDB transaction read concern. | `majority` |
| `DB_WRITE_CONCERN` | number | Example value: `1` | No | MongoDB write concern value. | `1` |
| `DB_JOURNAL` | boolean | Example value: `true` | No | Whether MongoDB writes request journal acknowledgement. | `true` |
| `DB_TRANSACTION_TIMEOUT_MS` | number | Example value: `30000` | No | MongoDB transaction timeout. | `30000` |
| `DB_MAX_RETRIES` | number | Example value: `3` | No | Maximum retry attempts for transient database errors. | `3` |
| `DB_INITIAL_RETRY_DELAY_MS` | number | Example value: `100` | No | Initial database retry delay. | `100` |
| `DB_MAX_RETRY_DELAY_MS` | number | Example value: `5000` | No | Maximum database retry delay. | `5000` |
| `MONGODB_CONNECT_RETRIES` | number | Example value: `5` | No | Startup MongoDB connection retry count. | `5` |
| `MONGODB_CONNECT_DELAY_MS` | number | Example value: `2000` | No | Initial startup MongoDB retry delay. | `2000` |

## Authentication

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `JWT_SECRET` | string | Required by the backend at startup. | Yes (secret; store in a secret manager). | Secret for signing admin JWTs; generate a unique 64-byte value with: openssl rand -hex 32 | `<managed secret; do not commit>` |
| `JWT_EXPIRES_IN` | string | Example value: `8h` | No | Legacy admin JWT expiry used by config. | `8h` |
| `JWT_ACCESS_TOKEN_TTL` | duration string | Example value: `8h` | No | Admin access-token lifetime, parsed as a duration. | `8h` |
| `JWT_REFRESH_TOKEN_TTL` | duration string | Example value: `30d` | No | Admin refresh-token lifetime, parsed as a duration. | `30d` |
| `ADMIN_USERNAME` | string | Example value: `admin` | No | Break-glass admin username for /api/auth/login. | `admin` |
| `ADMIN_PASSWORD` | string | Local placeholder only; replace before use. | Yes (secret; store in a secret manager). | Plaintext fallback admin password for local development only. | `<managed secret; do not commit>` |
| `ADMIN_PASSWORD_HASH` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Preferred bcrypt hash for the admin password; overrides ADMIN_PASSWORD when set. | `<managed secret; do not commit>` |

## Stellar network and payment sync

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `STELLAR_NETWORK` | enum | Example value: `testnet` | No | Stellar network selector: testnet or mainnet. | `testnet` |
| `STELLAR_HORIZON_URL` | URL | Example value: `https://horizon-testnet.stellar.org` | No | Primary Horizon URL. | `https://horizon-testnet.stellar.org` |
| `HORIZON_URL` | URL | Unset in this example; application fallback or feature-specific requirement applies. | No | Backward-compatible Horizon URL fallback. | `https://service.example.invalid` |
| `STELLAR_HORIZON_URLS` | URL list | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional comma-separated Horizon failover URLs; overrides single URL when set. | `https://one.example.invalid,https://two.example.invalid` |
| `SCHOOL_WALLET_ADDRESS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional default school public wallet for migration/seed flows. | `example-value` |
| `ACCEPTED_ASSET` | enum | Example value: `XLM` | No | Accepted payment asset code, for example XLM or USDC. | `XLM` |
| `USDC_ISSUER` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional issuer override for USDC or another accepted credit asset. | `example-value` |
| `CONFIRMATION_THRESHOLD` | number | Example value: `2` | No | Ledgers required before a transaction is confirmed. | `2` |
| `FINALIZATION_THRESHOLD` | number | Example value: `10` | No | Ledgers required before a transaction is finalized. | `10` |
| `POLL_INTERVAL_MS` | number | Example value: `30000` | No | Legacy transaction polling interval. | `30000` |
| `POLL_MAX_BACKOFF_MS` | number | Example value: `300000` | No | Maximum polling backoff after Horizon errors. | `300000` |
| `SYNC_INTERVAL_MS` | number | Example value: `60000` | No | Canonical automatic sync interval; 0 disables automatic sync. | `60000` |
| `SYNC_LOCK_TTL_MS` | number | Example value: `60000` | No | Distributed sync lock time-to-live. | `60000` |
| `SYNC_MAX_PAGES_PER_POLL` | number | Example value: `50` | No | Maximum Horizon pages processed in one poll cycle. | `50` |
| `VERIFY_LOCK_TTL_MS` | number | Example value: `30000` | No | Payment verification lock time-to-live. | `30000` |
| `STELLAR_TIMEOUT_MS` | number | Example value: `10000` | No | Generic outbound Stellar timeout. | `10000` |
| `STELLAR_NETWORK_TIMEOUT_MS` | number | Example value: `10000` | No | Transaction retry queue Stellar request timeout. | `10000` |
| `STELLAR_CALL_RETRY_ATTEMPTS` | number | Example value: `3` | No | Generic Stellar call retry attempts. | `3` |
| `STELLAR_CALL_RETRY_DELAY_MS` | number | Example value: `1000` | No | Generic Stellar call retry delay. | `1000` |
| `STELLAR_TX_TIMEOUT_SECONDS` | number | Example value: `300` | No | Transaction maxTime timeout in seconds. | `300` |
| `STELLAR_TX_BASE_FEE` | number | Example value: `100` | No | Base fee for Stellar transactions. | `100` |
| `STELLAR_TX_FEE_MULTIPLIER` | number | Example value: `1.5` | No | Multiplier applied to Horizon fee stats. | `1.5` |
| `STELLAR_RATE_LIMIT_MIN_TIME` | number | Example value: `50` | No | Minimum spacing between Horizon requests. | `50` |
| `STELLAR_RATE_LIMIT_MAX_CONCURRENT` | number | Example value: `10` | No | Maximum concurrent Horizon requests. | `10` |
| `STELLAR_RATE_LIMIT_HIGH_WATER` | number | Example value: `100` | No | Horizon limiter queue high-water mark. | `100` |
| `STELLAR_RATE_LIMIT_STRATEGY` | enum | Example value: `LEAK` | No | Horizon limiter strategy name. | `LEAK` |
| `STELLAR_RETRY_MAX_ATTEMPTS` | number | Example value: `5` | No | Rate-limited Stellar client retry attempts. | `5` |
| `STELLAR_RETRY_INITIAL_DELAY` | number | Example value: `1000` | No | Initial retry delay for Stellar client calls. | `1000` |
| `STELLAR_RETRY_MAX_DELAY` | number | Example value: `30000` | No | Maximum retry delay for Stellar client calls. | `30000` |
| `STELLAR_RETRY_FACTOR` | number | Example value: `2` | No | Exponential retry factor for Stellar client calls. | `2` |
| `HORIZON_RATE_LIMIT_HEADER` | number | Example value: `3600` | No | Expected Horizon hourly rate-limit budget. | `3600` |
| `HORIZON_RATE_LIMIT_WINDOW_MS` | number | Example value: `3600000` | No | Horizon rate-limit window in milliseconds. | `3600000` |
| `STELLAR_BURST_ALLOWANCE` | number | Example value: `20` | No | Maximum short-window Stellar request burst size. | `20` |
| `STELLAR_BURST_WINDOW` | number | Example value: `1000` | No | Stellar burst window in milliseconds. | `1000` |
| `CB_FAILURE_THRESHOLD` | number | Example value: `5` | No | Horizon circuit-breaker failure threshold. | `5` |
| `CB_RESET_TIMEOUT_MS` | number | Example value: `30000` | No | Horizon circuit-breaker reset timeout. | `30000` |
| `CB_HALF_OPEN_SUCCESS_THRESHOLD` | number | Example value: `2` | No | Successes required to close a half-open Horizon circuit. | `2` |

## Redis, queues, and distributed coordination

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `REDIS_HOST` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Redis host; set to localhost locally or redis in containers to enable BullMQ/distributed features. | `example-value` |
| `REDIS_PORT` | number | Example value: `6379` | No | Redis port. | `6379` |
| `REDIS_PASSWORD` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Redis password; leave empty when Redis has no auth. | `<managed secret; do not commit>` |
| `REDIS_LOG_THROTTLE_MS` | number | Example value: `60000` | No | Minimum interval for repeated Redis connection logs. | `60000` |
| `REDIS_RECONNECT_MAX_ATTEMPTS` | number | Example value: `8` | No | Maximum Redis reconnect attempts. | `8` |
| `REDIS_RECONNECT_BASE_DELAY_MS` | number | Example value: `500` | No | Initial Redis reconnect delay. | `500` |
| `REDIS_RECONNECT_MAX_DELAY_MS` | number | Example value: `30000` | No | Maximum Redis reconnect delay. | `30000` |
| `REPLICA_COUNT` | number | Example value: `1` | No | Explicit replica count for retry-backend safety warnings. | `1` |
| `WEB_CONCURRENCY` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Platform-provided worker count fallback. | `1000` |
| `INSTANCE_COUNT` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Platform-provided instance count fallback. | `1000` |
| `NUMBER_OF_REPLICAS` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Orchestrator-provided replica count fallback. | `1000` |
| `LEADER_LOCK_TTL_MS` | number | Example value: `30000` | No | Leader-election lock time-to-live. | `30000` |
| `LEADER_RENEW_INTERVAL_MS` | number | Example value: `15000` | No | Leader-election renewal interval. | `15000` |
| `LEADER_ACQUIRE_INTERVAL_MS` | number | Example value: `10000` | No | Leader-election acquisition interval. | `10000` |
| `DRAIN_TIMEOUT_MS` | number | Example value: `60000` | No | Worker drain timeout during shutdown. | `60000` |
| `SHUTDOWN_TIMEOUT_MS` | number | Example value: `30000` | No | Forced shutdown timeout after receiving a signal. | `30000` |
| `RETRIES_ENABLED` | boolean | Example value: `true` | No | Enables the BullMQ transaction retry queue. | `true` |
| `RETRY_INTERVAL_MS` | number | Example value: `60000` | No | MongoDB retry worker interval. | `60000` |
| `RETRY_MAX_ATTEMPTS` | number | Example value: `10` | No | MongoDB retry worker max attempts. | `10` |
| `MAX_RETRY_ATTEMPTS` | number | Example value: `10` | No | BullMQ retry max attempts. | `10` |
| `INITIAL_RETRY_DELAY_MS` | number | Example value: `60000` | No | BullMQ initial retry delay. | `60000` |
| `MAX_RETRY_DELAY_MS` | number | Example value: `3600000` | No | BullMQ maximum retry delay. | `3600000` |
| `RETRY_BACKOFF_MULTIPLIER` | number | Example value: `2` | No | BullMQ exponential backoff multiplier. | `2` |
| `RETRY_JITTER_RATIO` | number | Example value: `0.2` | No | Jitter ratio applied to BullMQ retry delays. | `0.2` |
| `DLQ_ENABLED` | boolean | Example value: `true` | No | Enables dead-letter queue handling. | `true` |
| `DLQ_MAX_AGE_MS` | number | Example value: `604800000` | No | Dead-letter queue retention window. | `604800000` |
| `QUEUE_CONCURRENCY` | number | Example value: `5` | No | BullMQ retry worker concurrency. | `5` |
| `TX_QUEUE_CONCURRENCY` | number | Example value: `5` | No | Transaction queue worker concurrency. | `5` |
| `QUEUE_LOCK_DURATION_MS` | number | Example value: `30000` | No | BullMQ job lock duration. | `30000` |
| `QUEUE_STALLED_INTERVAL_MS` | number | Example value: `30000` | No | BullMQ stalled-job scan interval. | `30000` |
| `QUEUE_MAX_STALLED_COUNT` | number | Example value: `2` | No | Maximum stalled recoveries before failing a job. | `2` |
| `MAX_QUEUE_DEPTH` | number | Example value: `1000` | No | Maximum in-flight payment processing depth. | `1000` |
| `QUEUE_BACKPRESSURE_HIGH_WATER` | number | Example value: `800` | No | Queue depth where backpressure begins. | `800` |
| `QUEUE_BACKPRESSURE_LOW_WATER` | number | Example value: `500` | No | Queue depth where backpressure clears. | `500` |
| `REPORT_QUEUE_CONCURRENCY` | number | Example value: `2` | No | Async report queue worker concurrency. | `2` |
| `REPORT_JOB_TTL_MS` | number | Example value: `21600000` | No | Async report job retention. | `21600000` |
| `REPORTS_S3_BUCKET` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Private S3 bucket for generated report artifacts; required for async report generation. | `example-value` |
| `REPORTS_S3_REGION` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | S3 region for report artifacts; falls back to AWS_REGION. | `example-value` |
| `REPORTS_S3_ENDPOINT` | URL | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional S3-compatible endpoint for local/object-storage providers. | `https://service.example.invalid` |
| `OUTBOX_DISPATCH_INTERVAL_MS` | number | Example value: `5000` | No | Outbox dispatcher interval. | `5000` |

## Idempotency, payments, and currency conversion

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | number | Example value: `86400` | No | Stored idempotency key retention window. | `86400` |
| `IDEMPOTENCY_IN_FLIGHT_TTL_MS` | number | Example value: `30000` | No | In-flight idempotency reservation timeout. | `30000` |
| `PAYMENT_INTENT_TTL_SECONDS` | number | Example value: `86400` | No | MongoDB TTL for abandoned payment intents. | `86400` |
| `PAYMENT_INTENT_TTL_MS` | number | Example value: `86400000` | No | Runtime payment-intent expiry in milliseconds. | `86400000` |
| `PAYMENT_WEBHOOK_URL` | URL | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional default payment webhook URL for schools without one. | `https://service.example.invalid` |
| `MIN_PAYMENT_AMOUNT` | number | Example value: `0.01` | No | Minimum accepted payment amount. | `0.01` |
| `MAX_PAYMENT_AMOUNT` | number | Example value: `100000` | No | Maximum accepted payment amount. | `100000` |
| `DEFAULT_FIAT_CURRENCY` | string | Example value: `USD` | No | Default fiat currency for conversion snapshots. | `USD` |
| `PRICE_CACHE_TTL_MS` | number | Example value: `60000` | No | Fresh price cache lifetime. | `60000` |
| `PRICE_STALE_THRESHOLD_MS` | number | Example value: `3600000` | No | Maximum age for stale fallback prices. | `3600000` |
| `SUPPORTED_CURRENCIES_TTL_MS` | number | Example value: `3600000` | No | Supported fiat currency list cache lifetime. | `3600000` |
| `CURRENCY_LRU_MAX_SIZE` | number | Example value: `50` | No | In-process fiat conversion cache size. | `50` |
| `ALLOWED_FIAT_CURRENCIES` | comma-separated string list | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional comma-separated fiat allowlist. | `value-one,value-two` |
| `COINGECKO_API_KEY` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Optional CoinGecko API key for higher rate limits. | `<managed secret; do not commit>` |

## Request limits, validation, and reports

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `MAX_BODY_SIZE` | number | Example value: `10kb` | No | Maximum JSON body size for normal endpoints. | `10kb` |
| `JSON_MAX_DEPTH` | number | Example value: `10` | No | Maximum JSON nesting depth accepted by sanitizer. | `10` |
| `JSON_MAX_ARRAY_LENGTH` | number | Example value: `100` | No | Maximum JSON array length accepted by sanitizer. | `100` |
| `CSV_MAX_SIZE_BYTES` | number | Example value: `5242880` | No | Maximum CSV upload size. | `5242880` |
| `CSV_MAX_ROWS` | number | Example value: `10000` | No | Maximum rows per CSV import. | `10000` |
| `CSV_MAX_COLUMNS` | number | Example value: `20` | No | Maximum columns per CSV import. | `20` |
| `BULK_IMPORT_RATE_LIMIT` | number | Example value: `5` | No | Bulk student import requests allowed per hour. | `5` |
| `VERIFY_RATE_LIMIT` | number | Example value: `10` | No | Payment verification requests allowed per minute. | `10` |
| `REPORT_MAX_RANGE_DAYS` | number | Example value: `366` | No | Maximum report query date range. | `366` |
| `LARGE_REPORT_THRESHOLD_DAYS` | number | Example value: `30` | No | Date range that switches reports to async mode. | `30` |
| `REQUEST_TIMEOUT_MS` | number | Example value: `30000` | No | Inbound request timeout. | `30000` |

## Schedulers, retention, and background jobs

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `CONSISTENCY_CHECK_INTERVAL_MS` | number | Example value: `300000` | No | Consistency checker interval. | `300000` |
| `RECONCILIATION_INTERVAL_MS` | number | Example value: `86400000` | No | Payment reconciliation interval. | `86400000` |
| `RECONCILIATION_DRIFT_THRESHOLD` | number | Example value: `0.5` | No | Reconciliation drift alert threshold. | `0.5` |
| `RECONCILIATION_REPORT_INTERVAL_MS` | number | Example value: `86400000` | No | Reconciliation report scheduler interval. | `86400000` |
| `METRICS_RECONCILE_INTERVAL_MS` | number | Example value: `21600000` | No | Metrics rollup reconciliation interval. | `21600000` |
| `SESSION_CLEANUP_INTERVAL_MS` | number | Example value: `3600000` | No | Refresh-token session cleanup interval. | `3600000` |
| `STUCK_PAYMENT_THRESHOLD_MS` | number | Example value: `600000` | No | Age before a submitted payment is reconciled. | `600000` |
| `STUCK_PAYMENT_RECONCILIATION_INTERVAL_MS` | number | Example value: `900000` | No | Scheduled provider reconciliation interval (15 minutes). | `900000` |
| `STUCK_PAYMENT_RECONCILIATION_MAX_BATCH` | number | Example value: `100` | No | Maximum stuck payments reconciled per pass. | `100` |
| `PAYMENT_RECONCILIATION_MISMATCH_RATE_THRESHOLD` | number | Example value: `0.1` | No | Alert when reconciliation mismatches exceed 10 percent. | `0.1` |
| `AUDIT_LOG_RETENTION_DAYS` | number | Example value: `730` | No | Runtime audit-log cleanup retention period. | `730` |
| `AUDIT_LOG_TTL_DAYS` | number | Example value: `730` | No | Migration audit-log TTL retention period. | `730` |
| `REMINDER_LOG_TTL_SECONDS` | number | Example value: `7776000` | No | Reminder log retention in seconds. | `7776000` |
| `STUDENT_FEE_HISTORY_CAP` | number | Example value: `100` | No | Maximum fee history entries retained on a student document. | `100` |
| `DISPUTE_SLA_HOURS` | number | Example value: `72` | No | Hours before disputes breach SLA. | `72` |
| `DEFAULT_SCHOOL_ID` | string | Example value: `SCH-DEFAULT` | No | Default school id used by migration scripts. | `SCH-DEFAULT` |

## Email, reminders, and SMS

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `REMINDER_INTERVAL_MS` | number | Example value: `3600000` | No | Fee reminder scheduler interval. | `3600000` |
| `REMINDER_COOLDOWN_HOURS` | number | Example value: `48` | No | Minimum hours between reminders to the same student. | `48` |
| `REMINDER_MAX_COUNT` | number | Example value: `5` | No | Maximum reminders sent per student. | `5` |
| `EMAIL_PROVIDER` | enum | Example value: `console` | No | Email provider selector: console, smtp, ses, or sendgrid. | `console` |
| `EMAIL_MAX_RETRIES` | number | Example value: `3` | No | Email send retry attempts. | `3` |
| `EMAIL_RETRY_BASE_MS` | number | Example value: `500` | No | Initial email retry delay. | `500` |
| `EMAIL_RETRY_MAX_MS` | number | Example value: `30000` | No | Maximum email retry delay. | `30000` |
| `EMAIL_PROVIDER_WEBHOOK_SECRET` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Shared secret for email delivery provider webhooks. | `<managed secret; do not commit>` |
| `EMAIL_WEBHOOK_SECRET` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Shared secret for bounce/complaint webhook routes. | `<managed secret; do not commit>` |
| `SMTP_HOST` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | SMTP host when EMAIL_PROVIDER=smtp. | `example-value` |
| `SMTP_PORT` | number | Example value: `587` | No | SMTP port. | `587` |
| `SMTP_SECURE` | boolean | Example value: `false` | No | Whether SMTP uses TLS from connection start. | `false` |
| `SMTP_USER` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | SMTP username. | `example-value` |
| `SMTP_PASS` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | SMTP password. | `<managed secret; do not commit>` |
| `SMTP_FROM` | email address | Example value: `noreply@stellaredupay.com` | No | Default sender address for email. | `noreply@stellaredupay.com` |
| `SMTP_FROM_EMAIL` | email address | Unset in this example; application fallback or feature-specific requirement applies. | No | Default sender email for admin alerts (falls back to SMTP_USER). | `admin@example.invalid` |
| `SENDGRID_API_KEY` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | SendGrid API key when EMAIL_PROVIDER=sendgrid. | `<managed secret; do not commit>` |
| `AWS_REGION` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | AWS region when EMAIL_PROVIDER=ses. | `example-value` |
| `TWILIO_ACCOUNT_SID` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Twilio Account SID for SMS/WhatsApp. | `example-value` |
| `TWILIO_AUTH_TOKEN` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Twilio auth token. | `<managed secret; do not commit>` |
| `TWILIO_FROM_NUMBER` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Twilio SMS sender number. | `example-value` |
| `TWILIO_WHATSAPP_FROM` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Twilio WhatsApp sender address. | `example-value` |
| `ADMIN_ALERT_EMAIL` | email address | Unset in this example; application fallback or feature-specific requirement applies. | No | Email address for admin alerts (warn + critical severity). | `admin@example.invalid` |
| `ADMIN_ALERT_WEBHOOK_URL` | URL | Unset in this example; application fallback or feature-specific requirement applies. | No | Webhook URL for critical alerts only. | `https://service.example.invalid` |

## Webhooks, metrics, and secrets

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `METRICS_TOKEN` | string | Local placeholder only; replace before use. | Yes (secret; store in a secret manager). | Bearer token required for GET /metrics. | `<managed secret; do not commit>` |
| `AUDIT_HMAC_KEY` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Optional audit integrity HMAC key; falls back to JWT_SECRET. | `<managed secret; do not commit>` |
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | 64-character hex key for stored webhook secrets. | `<managed secret; do not commit>` |
| `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` | number | Example value: `300` | No | Inbound webhook timestamp tolerance. | `300` |
| `WEBHOOK_REPLAY_WINDOW_S` | number | Example value: `300` | No | Outbound webhook replay window. | `300` |
| `WEBHOOK_MAX_ATTEMPTS` | number | Example value: `3` | No | Maximum webhook delivery attempts. | `3` |
| `WEBHOOK_LEASE_TIMEOUT_MS` | number | Example value: `30000` | No | Webhook delivery lease timeout. | `30000` |
| `WEBHOOK_RETRY_INTERVAL_MS` | number | Example value: `60000` | No | Webhook retry scheduler interval. | `60000` |
| `WEBHOOK_DELIVERY_TTL_SECONDS` | number | Example value: `7776000` | No | Webhook delivery record retention. | `7776000` |
| `RECEIPT_SIGNATURE_SECRET` | string | Local placeholder only; replace before use. | Yes (secret; store in a secret manager). | Secret used to sign receipts. | `<managed secret; do not commit>` |
| `SIGNER_MASTER_KEY` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | 64-character hex master key for encrypted school signing keys. | `<managed secret; do not commit>` |
| `SIGNER_MASTER_KEY_OLD` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Previous signer master key during key rotation. | `<managed secret; do not commit>` |

## Logging and realtime updates

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `LOG_LEVEL` | enum | Example value: `info` | No | Initial application log level. | `info` |
| `LOG_MAX_SIZE` | number | Example value: `100m` | No | Maximum size of each rotated log file. | `100m` |
| `LOG_MAX_FILES` | string | Example value: `14d` | No | Number or age of rotated log files to keep. | `14d` |
| `LOG_REDACT_FIELDS` | comma-separated string list | Example value: `txHash,studentId,memo,senderAddress` | No | Request fields redacted from logs. | `txHash,studentId,memo,senderAddress` |
| `LOG_REQUEST_HEADERS` | boolean | Example value: `false` | No | Whether request headers are included in request logs. | `false` |
| `SSE_HEARTBEAT_MS` | number | Example value: `15000` | No | Server-sent events heartbeat interval. | `15000` |
| `SSE_MAX_CONNECTIONS_PER_SCHOOL` | number | Example value: `100` | No | Server-sent events connection cap per school. | `100` |

## Docker Compose and local operations

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | URL | Example value: `http://localhost:5000/api` | No | Frontend API URL passed as a Docker build arg. | `http://localhost:5000/api` |
| `BACKEND_MEM_LIMIT` | number | Example value: `512m` | No | Backend container memory limit. | `512m` |
| `BACKEND_CPUS` | number | Example value: `1.0` | No | Backend container CPU limit. | `1.0` |
| `FRONTEND_MEM_LIMIT` | number | Example value: `256m` | No | Frontend container memory limit. | `256m` |
| `FRONTEND_CPUS` | number | Example value: `0.5` | No | Frontend container CPU limit. | `0.5` |
| `MONGO_MEM_LIMIT` | number | Example value: `1g` | No | Mongo container memory limit. | `1g` |
| `MONGO_CPUS` | number | Example value: `1.0` | No | Mongo container CPU limit. | `1.0` |
| `REDIS_MEM_LIMIT` | number | Example value: `128m` | No | Redis container memory limit. | `128m` |
| `BACKUP_DIR` | path | Example value: `./backups` | No | Host directory mounted for Mongo backups. | `./backups` |
| `RETAIN_DAYS` | number | Example value: `7` | No | Backup retention period in days. | `7` |
| `GRAFANA_PASSWORD` | string | Local placeholder only; replace before use. | Yes (secret; store in a secret manager). | Local Grafana admin password for docker-compose.monitoring.yml. | `<managed secret; do not commit>` |

## Additional runtime variables. Leave blank to use the application fallback.

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `API_VERSION` | string | Example value: `1.0.0` | No | Version returned in the X-API-Version response header. | `1.0.0` |
| `APPROVAL_SECRET` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Secret used to authenticate approval actions. | `<managed secret; do not commit>` |
| `AUDIT_CURSOR_HMAC_KEY` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Optional HMAC key for signing audit-log cursors. | `<managed secret; do not commit>` |
| `CB_SUCCESS_THRESHOLD` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Successes required to close a half-open currency circuit breaker. | `1000` |
| `BUNDLE_MAX_CHUNK_KB` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional maximum JavaScript chunk budget checked in CI. | `1000` |
| `BUNDLE_MAX_INITIAL_GZIP_KB` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional maximum initial bundle gzip budget checked in CI. | `1000` |
| `BUNDLE_MAX_ROUTE_INITIAL_KB` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional per-route initial bundle budget checked in CI. | `1000` |
| `BUNDLE_MAX_SHARED_KB` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional shared-chunk budget checked in CI. | `1000` |
| `CONTRACT_ADMIN_ADDRESS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional Stellar address used as the contract administrator. | `example-value` |
| `CONTRACT_SIMULATION_TOOLCHAIN` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Toolchain selector for local contract simulation. | `example-value` |
| `CSV_MAX_FIELD_LENGTH` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Maximum characters allowed in an uploaded CSV field. | `example-value` |
| `DEPENDENCY_REPORT_OUTPUT` | path | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional output path for the dependency report script. | `./local-output` |
| `DATA_RETENTION_AUTO_PURGE` | boolean | Unset in this example; application fallback or feature-specific requirement applies. | No | Whether scheduled retention automatically purges eligible records. | `false` |
| `DATA_RETENTION_INTERVAL_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Interval between scheduled data-retention passes. | `example-value` |
| `FINALITY_POLL_INITIAL_DELAY_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Initial wait before polling transaction finality. | `example-value` |
| `FINALITY_POLL_MAX_DELAY_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Maximum delay between finality polls. | `example-value` |
| `FINALITY_POLL_TIMEOUT_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Maximum time spent polling for finality. | `example-value` |
| `FINALITY_TIMEOUT_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Overall transaction-finality timeout. | `example-value` |
| `FRONTEND_URL` | URL | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional frontend URL used in notifications and generated links. | `https://service.example.invalid` |
| `LIST_CURSOR_HMAC_KEY` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Optional HMAC key for signing list-pagination cursors. | `<managed secret; do not commit>` |
| `LOG_SHIPPING_TIMEOUT_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Timeout for forwarding logs to an external collector. | `example-value` |
| `LOG_SHIPPING_URL` | URL | Unset in this example; application fallback or feature-specific requirement applies. | No | Optional endpoint for forwarding logs to an external collector. | `https://service.example.invalid` |
| `MULTISIG_APPROVAL_TTL_HOURS` | number | Defaults to 24 hours when unset. | No | Expiration window for pending multisignature approvals. | `24` |
| `MULTISIG_REQUIRED_SIGNERS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Number of signatures required for a multisignature action. | `example-value` |
| `MULTISIG_SIGNERS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Comma-separated Stellar signer addresses allowed to approve. | `example-value` |
| `OUTBOX_LOCK_TTL_MS` | number | Defaults to 30000 ms when unset. | No | Lease duration for claiming an outbox record. | `30000` |
| `OUTBOX_PROCESSED_TTL_SECONDS` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Retention for successfully processed outbox records. | `1000` |
| `PAYMENT_MEMO_RETENTION_DAYS` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Retention period for payment memo data. | `1000` |
| `PROVIDER_DEFAULT_BASE_DELAY_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Default initial delay for provider retries. | `example-value` |
| `PROVIDER_DEFAULT_MAX_ATTEMPTS` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Default maximum attempts for provider requests. | `1000` |
| `PROVIDER_DEFAULT_MAX_DELAY_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Default maximum backoff delay for provider retries. | `example-value` |
| `PROVIDER_DEFAULT_TIMEOUT_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Default timeout for provider requests. | `example-value` |
| `RECONCILIATION_LOCAL_PAGE_SIZE` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Page size for local reconciliation reads. | `1000` |
| `RECONCILIATION_MAX_DISCREPANCIES` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Maximum discrepancies retained per reconciliation run. | `example-value` |
| `RECONCILIATION_MAX_RANGE_DAYS` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Maximum time span for one reconciliation run. | `1000` |
| `REDIS_CACHE_TIMEOUT_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Timeout for Redis cache operations. | `example-value` |
| `REDIS_CHECK_TIMEOUT_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Timeout for Redis health checks. | `example-value` |
| `REDIS_REQUIRED` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Whether startup requires a ready Redis connection. | `example-value` |
| `REDIS_STARTUP_TIMEOUT_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Maximum wait for Redis readiness during startup. | `example-value` |
| `ROTATION_OPERATOR` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Operator identifier recorded for key-rotation actions. | `example-value` |
| `SERVICE_NAME` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Service name attached to logs and metrics. | `example-value` |
| `SOROBAN_RPC_URL` | URL | Unset in this example; application fallback or feature-specific requirement applies. | No | Soroban RPC endpoint used by contract tooling. | `https://service.example.invalid` |
| `STUDENT_IMPORT_CONCURRENCY` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Maximum concurrent student-import jobs. | `1000` |
| `WEBHOOK_MAX_BACKOFF_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Maximum retry backoff for webhook deliveries. | `example-value` |
| `BACKUP_NOTIFY_TOKEN` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Controls backup notify token; consult the runtime reference before changing it. | `<managed secret; do not commit>` |
| `BULK_IMPORT_MAX_FAILURES` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls bulk import max failures; consult the runtime reference before changing it. | `1000` |
| `BULK_PAYMENT_STATUS_LIMIT` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls bulk payment status limit; consult the runtime reference before changing it. | `1000` |
| `CURRENCY_CB_FAILURE_THRESHOLD` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls currency cb failure threshold; consult the runtime reference before changing it. | `1000` |
| `CURRENCY_CB_RESET_TIMEOUT_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls currency cb reset timeout ms; consult the runtime reference before changing it. | `example-value` |
| `CURRENCY_CB_SUCCESS_THRESHOLD` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls currency cb success threshold; consult the runtime reference before changing it. | `1000` |
| `DAILY_METRICS_TTL_SECONDS` | number | Defaults to 34560000 seconds (400 days) when unset. | No | Retention period for daily metrics documents. | `34560000` |
| `DB_REPORT_AGGREGATION_MAX_TIME_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls db report aggregation max time ms; consult the runtime reference before changing it. | `example-value` |
| `HORIZON_POLL_BUDGET_SAFETY_FACTOR` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls horizon poll budget safety factor; consult the runtime reference before changing it. | `1000` |
| `HORIZON_POLL_MIN_BUDGET` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls horizon poll min budget; consult the runtime reference before changing it. | `1000` |
| `HORIZON_POLL_RECENT_ACTIVITY_WINDOW_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls horizon poll recent activity window ms; consult the runtime reference before changing it. | `example-value` |
| `HORIZON_POLL_REPLICA_COUNT` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls horizon poll replica count; consult the runtime reference before changing it. | `1000` |
| `HORIZON_RATE_LIMIT_PER_HOUR` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls horizon rate limit per hour; consult the runtime reference before changing it. | `example-value` |
| `JOB_RECOVERY_BASE_DELAY_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls job recovery base delay ms; consult the runtime reference before changing it. | `example-value` |
| `JOB_RECOVERY_INTERVAL_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls job recovery interval ms; consult the runtime reference before changing it. | `example-value` |
| `JOB_RECOVERY_MAX_DELAY_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls job recovery max delay ms; consult the runtime reference before changing it. | `example-value` |
| `JOB_RECOVERY_MAX_RETRIES` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls job recovery max retries; consult the runtime reference before changing it. | `1000` |
| `METRICS_BEARER_TOKEN` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Controls metrics bearer token; consult the runtime reference before changing it. | `<managed secret; do not commit>` |
| `MIN_BACKUP_SIZE` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls min backup size; consult the runtime reference before changing it. | `1000` |
| `OUTBOX_MAX_RETRIES` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls outbox max retries; consult the runtime reference before changing it. | `1000` |
| `PAYMENT_LIMITS_CACHE_TTL_MS` | number | Defaults to 30000 ms when unset. | No | Time-to-live for the in-process payment limits cache. | `30000` |
| `PAYMENT_LIMITS_READ_TIMEOUT_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls payment limits read timeout ms; consult the runtime reference before changing it. | `example-value` |
| `RECONCILIATION_BATCH_SIZE` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls reconciliation batch size; consult the runtime reference before changing it. | `1000` |
| `RECONCILIATION_CHAIN_LOOKBACK_DAYS` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls reconciliation chain lookback days; consult the runtime reference before changing it. | `1000` |
| `RECONCILIATION_CHAIN_TOTAL_TTL_SEC` | number | Defaults to 300 seconds when unset. | No | Cache lifetime for reconciliation chain totals. | `300` |
| `REQUIRE_MFA` | boolean | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls require mfa; consult the runtime reference before changing it. | `false` |
| `SCHOOL_ADMIN_PASSWORD` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Controls school admin password; consult the runtime reference before changing it. | `<managed secret; do not commit>` |
| `SCHOOL_ADMIN_PASSWORD_HASH` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Controls school admin password hash; consult the runtime reference before changing it. | `<managed secret; do not commit>` |
| `SEED_SCHOOL_ID` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls seed school id; consult the runtime reference before changing it. | `example-value` |
| `SEED_SCHOOL_NAME` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls seed school name; consult the runtime reference before changing it. | `example-value` |
| `SEED_SCHOOL_SLUG` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls seed school slug; consult the runtime reference before changing it. | `example-value` |
| `SIGNER_KEY_SOURCE` | enum | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls signer key source; consult the runtime reference before changing it. | `choose a documented option` |
| `SIGNER_MASTER_KEY_HTTP_TOKEN` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Controls signer master key http token; consult the runtime reference before changing it. | `<managed secret; do not commit>` |
| `SIGNER_MASTER_KEY_HTTP_URL` | URL | Unset; required only when `SIGNER_KEY_SOURCE=http`. | No | Base URL of the HTTP signer master-key provider. | `<unset; set only for HTTP signer source>` |
| `SIGNER_MASTER_KEY_SECRET_ID` | string | Unset; required only when `SIGNER_KEY_SOURCE=aws_secrets_manager`. | No | Identifier of the AWS Secrets Manager entry holding the signer key. | `<unset; set only for AWS Secrets Manager>` |
| `STUDENT_BALANCE_LOCK_TTL_MS` | number | Defaults to 15000 ms when unset. | No | Lease duration for per-student balance locks. | `15000` |
| `STUDENT_PII_ENCRYPTION_KEY` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Controls student pii encryption key; consult the runtime reference before changing it. | `<managed secret; do not commit>` |
| `STUDENT_PII_RETENTION_DAYS` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls student pii retention days; consult the runtime reference before changing it. | `1000` |
| `SWAGGER_ENABLED` | boolean | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls swagger enabled; consult the runtime reference before changing it. | `false` |
| `SYNC_MAX_CONCURRENT_SCHOOLS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls sync max concurrent schools; consult the runtime reference before changing it. | `example-value` |
| `TX_QUEUE_HEARTBEAT_INTERVAL_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls tx queue heartbeat interval ms; consult the runtime reference before changing it. | `example-value` |
| `WEBHOOK_DELIVERY_RETENTION_DAYS` | number | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls webhook delivery retention days; consult the runtime reference before changing it. | `1000` |
| `WEBHOOK_NONCE_TTL_SECONDS` | number | Defaults to 86400 seconds when unset. | No | Retention period for inbound webhook replay-prevention nonces. | `86400` |
| `WEBHOOK_REPLAY_NONCES_LOCAL` | boolean | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls webhook replay nonces local; consult the runtime reference before changing it. | `false` |
| `WEBHOOK_SECRET_ENCRYPTION_KEY_PREVIOUS` | string | Unset in this example; application fallback or feature-specific requirement applies. | Yes (secret; store in a secret manager). | Controls webhook secret encryption key previous; consult the runtime reference before changing it. | `<managed secret; do not commit>` |
| `WEBHOOK_URL` | URL | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls webhook url; consult the runtime reference before changing it. | `https://service.example.invalid` |
| `WORKER_HEARTBEAT_GRACE_MS` | string | Unset in this example; application fallback or feature-specific requirement applies. | No | Controls worker heartbeat grace ms; consult the runtime reference before changing it. | `example-value` |

## CI-only browser smoke-test settings

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `GITHUB_OUTPUT` | CI-provided file path | Supplied by GitHub Actions; unset for local runs. | No | Runner output-file path used by CI scripts to publish step outputs. | `runner-provided path` |
| `SMOKE_ADMIN_EMAIL` | email address | Unset outside the browser-smoke workflow. | No | Synthetic administrator email for browser smoke tests. | `smoke-admin@example.invalid` |
| `SMOKE_ADMIN_PASSWORD` | string | Unset outside the browser-smoke workflow. | Yes (secret; store in CI secrets). | CI secret for browser smoke tests; never use a real account. | `<CI secret; do not commit>` |
| `SMOKE_BACKEND_URL` | URL | Example value: `http://localhost:5000` | No | Backend URL for local browser smoke tests. | `http://localhost:5000` |
| `SMOKE_FRONTEND_URL` | URL | Example value: `http://localhost:3000` | No | Frontend URL for local browser smoke tests. | `http://localhost:3000` |

## Variables outside .env.example

These build, CI, and test variables are supplied by their runners and are not application deployment settings. They are intentionally documented here without adding runner-only values to the deployment example.

| Variable | Type | Default / unset behavior | Secret? | Description | Safe example |
| --- | --- | --- | --- | --- | --- |
| `ANALYZE` | boolean | Unset unless the corresponding build or feature is enabled. | No | Enables bundle analysis during a frontend build when set to true. | `true` |
| `NEXT_PUBLIC_FEATURE_BULK_STUDENT_IMPORT` | boolean | Unset unless the corresponding build or feature is enabled. | No | Frontend build-time flag for the student-import interface. | `true` |
| `NEXT_PUBLIC_FEATURE_DISPUTES` | boolean | Unset unless the corresponding build or feature is enabled. | No | Frontend build-time flag for dispute screens. | `true` |
| `NEXT_PUBLIC_FEATURE_FEE_ADJUSTMENTS` | boolean | Unset unless the corresponding build or feature is enabled. | No | Frontend build-time flag for fee-adjustment screens. | `true` |
| `NEXT_PUBLIC_FEATURE_MULTI_ASSET` | boolean | Unset unless the corresponding build or feature is enabled. | No | Frontend build-time flag for multi-asset payment support. | `true` |
| `NEXT_PUBLIC_FEATURE_PAYMENT_PLANS` | boolean | Unset unless the corresponding build or feature is enabled. | No | Frontend build-time flag for payment-plan screens. | `true` |
| `NEXT_PUBLIC_FEATURE_PAYMENT_VERIFICATION` | boolean | Unset unless the corresponding build or feature is enabled. | No | Frontend build-time flag for payment verification controls. | `true` |
| `NEXT_PUBLIC_FEATURE_REFUNDS` | boolean | Unset unless the corresponding build or feature is enabled. | No | Frontend build-time flag for refund screens. | `true` |
| `NEXT_PUBLIC_FEATURE_SOURCE_VALIDATION` | boolean | Unset unless the corresponding build or feature is enabled. | No | Frontend build-time flag for source-validation settings. | `true` |

## Safe handling

- Generate production secrets independently for each environment and store them in the deployment secret manager.
- Do not commit populated secret values, include them in screenshots, or paste them into support tickets.
- Values prefixed with `NEXT_PUBLIC_` are exposed to browser clients after build; never put credentials in them.
- Review [environment-reference.md](environment-reference.md) for required-variable behavior, ownership, rotation, and runtime defaults.
