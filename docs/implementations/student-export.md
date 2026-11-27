# Student CSV export

Use `GET /api/students/export?columns=studentId,name,class&format=csv` with
your school credentials. Columns appear in request order. An unsupported
column returns HTTP 400 with the caller's `allowedColumns`.

Viewers and read-only or staff accounts can export student IDs and classes.
Finance accounts can export names and fee fields. Owners and superadmins
can choose from the full export whitelist. An active account needs the
separate `pii_export` permission to request contact or demographic fields.
Default exports omit those fields.

The endpoint supports a class filter and the payment status filters
`paid`, `unpaid`, and `partial`. Admins can set `includeDeleted=true`.

Exports above 1,000 matching rows return HTTP 202 with a job ID and a status
URL. Poll the status URL using the original account and school. Once ready,
it returns a short-lived download URL. The report worker needs Redis and
the configured private report artifact bucket. Configure object lifecycle
expiration for the `student-exports/` prefix to match your export retention
policy.
