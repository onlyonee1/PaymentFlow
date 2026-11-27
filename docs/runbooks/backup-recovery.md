# Backup and recovery runbook

This runbook describes the backup and restore behavior implemented in this
repository and the recovery targets that still need operational validation.
It is for the on-call platform/database operator. Do not treat an untested
target as a production guarantee.

## Current safeguards and production gaps

| Area | Implemented behavior | Operational caveat |
| --- | --- | --- |
| Backup cadence | Docker Compose runs `scripts/backup.sh` immediately and then every 24 hours. | This is an interval loop, not a fixed-time or incremental schedule. |
| Archive | Gzip-compressed `mongodump` archive; minimum-size check followed by `mongorestore --dryRun`. | The archive is not encrypted by the script. |
| Storage | `BACKUP_DIR` bind-mounts a host directory; default is `./backups`. | No off-host, cross-region, or object-store copy is performed by the backup script. A host failure can therefore remove the database and its backups together. |
| Retention | `RETAIN_DAYS` defaults to 7 and prunes older local archives. | No separate 30-day or annual retention tier is implemented. |
| Restore verification | Compose `backup-verify` restores the latest archive into a disposable MongoDB and compares aggregate document counts weekly. GitHub Actions also runs a synthetic backup/restore test on Mondays at 03:00 UTC, checking collection counts, indexes, and representative payment documents. | These automated checks are not a production staging drill and do not prove off-host recovery. |

### Recovery objectives

- **RPO target: 24 hours.** This is an unverified planning target based on the
  daily archive cadence. It is not guaranteed: failed runs, local-only storage,
  or a corrupt newest archive can increase data loss.
- **RTO target: 4 hours.** This is an unmeasured planning target. Provisioning,
  archive availability, database size, migration time, and validation have not
  been timed in a staging recovery drill.
- **Point-in-time recovery:** not implemented. The scripts do not create
  incremental backups or archive the MongoDB oplog.

Before production use, the service owner must provide access-controlled,
encrypted, independent off-host storage, confirm alert routing, and run and
record a timed staging recovery. Until then, these objectives are targets only.

## Backup operations

The Compose `backup` service runs `scripts/backup.sh`; the archive is stored at
`${BACKUP_DIR:-./backups}/<UTC timestamp>.gz`. `RETAIN_DAYS` defaults to 7.
The script requires `MONGO_URI`, rejects archives smaller than
`MIN_BACKUP_SIZE` (default 1024 bytes), runs `mongorestore --dryRun`, prunes
expired local archives, and optionally posts a success heartbeat when
`BACKUP_NOTIFY_TOKEN` is configured.

To check the service and recent result:

```bash
docker compose ps backup
docker compose logs --tail=100 backup
```

For an approved on-demand backup, run the same script in the configured
container/environment rather than copying a database URI into a ticket or
shell history:

```bash
docker compose exec backup bash /scripts/backup.sh
```

Confirm the new archive exists, is non-empty, and the log reports successful
dry-run verification. Treat archive names and sizes as operational metadata;
never upload the archive to a public location.

## Restore procedure

Restores can overwrite data. Coordinate a maintenance window, obtain the
database/service owner's approval, and record the selected archive and target
environment in the incident record. Never restore into production as a test.

1. **Identify a known-good archive.** Check the last successful backup and
   verification logs. Prefer the newest archive whose verification completed;
   if that is unavailable, choose an older verified archive and update the
   incident's RPO estimate.
2. **Provision an isolated MongoDB target** and restrict access to the
   recovery operators. Do not use a production URI for the initial restore.
3. **Dry-run the command** with the intended archive and isolated target:

   ```bash
   MONGO_URI="<isolated-target-uri>" \
   BACKUP_FILE="<path-to-verified-archive.gz>" \
   ./scripts/restore.sh --dry-run
   ```

   Check the target and archive carefully. The script prints the target URI;
   keep credentials out of terminal transcripts and incident notes.
4. **Restore into the isolated target.** The default is additive (`DROP=false`):

   ```bash
   MONGO_URI="<isolated-target-uri>" \
   BACKUP_FILE="<path-to-verified-archive.gz>" \
   ./scripts/restore.sh
   ```

   `DROP=true` permanently drops target collections. Use it only when a
   clean replacement is intended, after explicit approval and a second URI
   check. The script requires interactive confirmation unless `--yes` is
   supplied; do not use `--yes` for an unreviewed operation.
5. **Validate the isolated restore** using the checklist below. Compare
   collection counts and indexes with the weekly verification artifacts or a
   pre-incident manifest. Validate key payment records and application health.
6. **Apply migrations** using the repository's migration procedure if the
   restored database is behind the deployed application version. Review
   migration logs before continuing.
7. **Promote or reconnect only after approval.** Stop application writes during
   a production replacement. Confirm the final target URI, start the backend,
   verify health and critical workflows, and monitor error and reconciliation
   metrics. Record completion time and actual RTO.

### Restore validation checklist

- [ ] Archive passed `mongorestore --dryRun` and was restored without errors.
- [ ] Collection counts and expected indexes match the selected archive or
      available verification manifest.
- [ ] Representative schools, students, fee structures, disputes, and payment
      records are present; validate with authorized synthetic/test identifiers
      or approved non-sensitive record references.
- [ ] Backend health endpoint responds successfully and administrative
      authentication works.
- [ ] Payment sync/reconciliation and audit logging behave as expected.
- [ ] No credential, student record, or payment detail was copied into logs,
      screenshots, or the incident report.
- [ ] Record the selected archive timestamp, validation results, RPO estimate,
      start/end times, and measured RTO.

The MongoDB archive is not an export of Redis queues or application logs.
Follow their service-specific recovery procedures separately. Stellar records
may help reconcile confirmed chain transactions, but they do not replace the
MongoDB records or restore school, student, fee, and dispute state.

## Staleness alerts and escalation

The rules in `monitoring/alerts/backup.yml` define:

- `BackupStale`: warning when the last successful heartbeat is older than
  26 hours.
- `BackupCriticallyStale`: critical when it is older than 48 hours.
- `BackupNotRun`: warning when no heartbeat has been recorded for 26 hours
  after backend startup.
- Separate warning alerts when weekly restore-test or backup-verification
  heartbeats are more than 8 days old.

When an alert fires:

1. Acknowledge it using the configured on-call process and open an incident if
   the latest verified archive is outside the 24-hour RPO target.
2. Check `docker compose ps backup`, `docker compose logs backup`, and available
   disk space for the configured backup directory. Inspect the error without
   copying secrets or full connection strings into the incident.
3. Confirm MongoDB reachability, `BACKUP_DIR` write access, and
   `BACKUP_NOTIFY_TOKEN` configuration in both backup and backend services.
   The backup can succeed even when its heartbeat fails, so verify the archive
   timestamp independently.
4. If safe and authorized, run an on-demand backup. Do not delete the previous
   known-good archive to make space without approval and a replacement plan.
5. Escalate a 48-hour critical alert, missing/corrupt archives, or unavailable
   storage to the database/platform owner immediately. If independent
   off-host copies are not configured, treat host or disk failure as potential
   data loss and communicate the limitation to the incident lead.
6. For stale weekly verification alerts, inspect the GitHub Actions workflow
   and/or Compose `backup-verify` logs, repair verification, then confirm the
   relevant heartbeat is fresh.

Alert rules create Prometheus alerts; paging and notification delivery depend
on the deployment's Alertmanager/on-call configuration and must be verified by
the service owner.

## Drill status and related resources

The scheduled GitHub Actions test is an automated isolated round-trip check.
It is not evidence that a staging restore has been performed. No staging drill,
measured RTO, or operator sign-off is recorded by this change; the service
owner must complete and record those before relying on the targets above.

- [`scripts/backup.sh`](../../scripts/backup.sh)
- [`scripts/restore.sh`](../../scripts/restore.sh)
- [`scripts/verify-latest-backup.sh`](../../scripts/verify-latest-backup.sh)
- [Weekly GitHub Actions restore test](../../.github/workflows/backup-restore-test.yml)
- [Backup alert rules](../../monitoring/alerts/backup.yml)
