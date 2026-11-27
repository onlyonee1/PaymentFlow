# ADR-001 — Shared-schema multi-tenancy

**Status:** Accepted. This record describes the existing approach and supersedes the implementation description in [ADR-004](004-multi-tenancy-isolation.md).

## Context

PaymentFlow serves multiple schools with common data models. Schools need
independent access to student, payment, report, and configuration records.
Operations staff also need controlled cross-school access for support and
maintenance.

## Decision

Use shared MongoDB collections with `schoolId` as the tenant discriminator.
Authenticate the tenant at the HTTP boundary, pass the verified school ID
explicitly, and use the tenant-scope plugin to reject missing filters on
supported model operations. Include school IDs in tenant cache keys, event
channels, and artifact namespaces. Authorize file downloads through
school-scoped metadata.

## Alternatives

- Database per tenant provides separate credentials, backup boundaries, and
  stronger isolation at higher provisioning and migration cost.
- Collection per tenant keeps data apart in a shared database but complicates
  indexing, schema deployment, and platform-wide maintenance.
- Database row-level security can enforce scope below application code.
  Adopting it would require moving these models to a different storage engine.
- Unchecked application filters minimize infrastructure changes but make
  missing filters harder to detect before a query executes.

## Consequences

Shared schemas keep deployment, provisioning, and maintenance consistent.
The application remains responsible for tenant isolation. Callers supply
trusted filter values, own cache and storage scoping, and test negative
access cases. See the [multi-tenancy guide](../architecture/multi-tenancy.md)
for enforcement limits, mitigations, and test patterns.
