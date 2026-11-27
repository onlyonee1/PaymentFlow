# Multi-tenancy in PaymentFlow

A tenant is a school. Schools share a MongoDB database and collections. Each
tenant-owned record carries a `schoolId`. School-local identifiers such as
`studentId` may repeat, so use both fields for lookups and uniqueness.

## API

Mount `resolveSchool` to resolve the tenant from the school ID or slug header.
Protected endpoints also need `requireSchoolAuth` with the roles appropriate
to the operation. It verifies credentials and binds school users to their
tenant. `requireAdminAuth` protects global break-glass endpoints. Public routes
must explicitly limit the fields they expose.

Use the verified `req.schoolId` in controllers. If a route accepts a separate
school identifier, compare it with the authenticated scope or apply
`assertTenantScope` where its identifier rules fit. Pass the verified scope
explicitly to services and background jobs. The AsyncLocalStorage in
`utils/logger.js` supplies logging context only.

## Database

For models with `tenantScope`, the plugin requires a top-level `schoolId`
filter on supported query operations and in the first aggregation `$match`.
Provide an exact, trusted scalar. The plugin checks field presence and leaves
value validation to the caller. Scope each nested `$lookup`, `$unionWith`,
and population query independently.

Set `schoolId` from trusted context on inserts, and add it to every tenant
read, update, and delete. Keep it immutable in request-driven updates. Raw
MongoDB calls, bulk operations, and unregistered models require explicit
scoping. Reserve `bypassTenantScope()` for privileged infrastructure work.

## Cache and event streams

Include the canonical school ID in every tenant cache key, including
invalidation keys, then add the resource ID and any parameters that change
the response. Include an authorization variant if responses differ by role.
This rule applies to local memory and Redis. Treat legacy helper keys that
lack school IDs as unsuitable for new tenant data.

Configure SSE subscriptions from authenticated scope and publish with the
school ID from the underlying record or trusted job payload. The SSE service
uses `sse:<schoolId>` for Redis and a school-keyed client map in each process.
Tenant membership is checked when the connection is established.

## File storage

Use a server-generated tenant prefix and object ID for new artifacts. Resolve
downloads through a job or file record fetched by both ID and school ID.
Check the user's current authorization before issuing a short-lived signed
URL. Signed URLs are bearer credentials until they expire. GridFS buckets
such as `studentImports` are shared. Workers must obtain file IDs from
trusted jobs associated with the owning tenant.

## Testing a new feature

Use [cross-tenant API tests](../../tests/cross-tenant-access.test.js) and
[cross-school isolation tests](../../tests/cross-school-isolation.test.js) as
starting points. Seed two schools with the same local resource ID and different
values. Use a school A credential to exercise its own record, then try a school
B header, slug, job ID, or resource ID. Check for rejection or a scoped empty
result and verify that the school B record is unchanged after mutation attempts.
For caches, warm with one tenant then read and invalidate from the other.
For events and artifacts, verify that only the owning tenant receives or can
download the result. Exercise background workers with persisted tenant scope.

## Known gaps and follow-up

The owners and timing below describe proposed maintenance responsibility and
review checkpoints.

| Partially enforced area | Mitigation | Proposed owner | Checkpoint |
| --- | --- | --- | --- |
| Plugin checks presence only and misses unregistered models, raw operations, inserts, and nested aggregation branches | Review the exact filter, trusted writes, and each collection access | Backend maintainers | Every new model or query PR |
| Tenant context is passed explicitly across request and queue boundaries | Authenticate before using the resolved school and scope each worker query | API and worker maintainers | Every new route or job PR |
| Legacy cache helpers omit tenant identifiers | Use scoped keys and audit existing callers | Cache maintainers | Next cache change |
| Shared storage and bearer download links | Validate tenant and authorization before signing, use short expiry, and scope artifacts and jobs | Storage and worker maintainers | Every artifact endpoint change |
| SSE admission and producer scope rely on callers | Verify scope on connect and publish, and review token revocation for long-lived connections | API maintainers | Next SSE authorization change |
| Global administration and migrations can span schools | Restrict access, audit privileged requests, and review scoped filters | Platform maintainers | Every privileged workflow change |
