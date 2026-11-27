# Role-Based Access Control (RBAC) Enforcement (Issue #620)

## Overview

Admin routes are now protected by fine-grained RBAC in addition to authentication.
Any authenticated admin can no longer access every endpoint — each route declares
an explicit role requirement and the middleware enforces it before the handler runs.

## Roles

| Role | Scope | Description |
|---|---|---|
| `super_admin` | Global | Break-glass access to all tenants and all endpoints |
| `owner` | Per-school | Full access to their school's data |
| `finance` | Per-school | Report, receipt, and accounting exports |
| `staff` | Per-school | Student management, fee collection |
| `viewer` | Per-school | Read-only access to their school's data |

A user may hold different roles at different schools (e.g. `finance` at School A
and `viewer` at School B). The JWT carries a `schoolId` claim that is verified
against the `X-School-ID` request header to enforce tenant isolation.

## Middleware

### `requireSchoolAuth(allowedRoles)`

Located at `backend/src/middleware/auth.js`.

```js
// Allow only owner and finance roles on report routes
const requireFinanceRole = requireSchoolAuth(['owner', 'finance']);
router.get('/', requireFinanceRole, getReport);
```

**Enforcement order:**
1. JWT signature and expiry validation.
2. Super-admin bypass (`role:'admin'` or `roles:['super_admin']`).
3. Tenant isolation: `decoded.schoolId` must match `X-School-ID` header.
4. Role check: `decoded.roles` must include at least one of `allowedRoles`.

**Error responses:**

| Condition | Status | Code |
|---|---|---|
| No token | 401 | `MISSING_AUTH_TOKEN` |
| Token expired | 401 | `TOKEN_EXPIRED` |
| Token invalid | 401 | `INVALID_AUTH_TOKEN` |
| Token not school-scoped | 403 | `MISSING_TENANT_CLAIM` |
| Cross-school mismatch | 403 | `TENANT_MISMATCH` |
| Insufficient role | 403 | `INSUFFICIENT_ROLE` |

## Authorization Matrix

The full endpoint-to-role mapping is documented in
`backend/src/middleware/authorizationMatrix.js`. It exports:

- `MATRIX` — the canonical mapping grouped by functional area.
- `flattenMatrix()` — a flat list of `{ path, method, roles, description }`.
- `endpointsForGroup(groupName)` — all endpoints for a named group.
- `validateMatrix()` — asserts matrix completeness (used in CI).

## Route Coverage

Every mutating route (`POST`, `PUT`, `PATCH`, `DELETE`) in the student, fee, and
school routers includes `requireAdminAuth` or `requireSchoolAuth` middleware.
The `routeAuthCoverage.test.js` suite fails if any mutating route is missing
authentication middleware.

## Tenant Isolation

Cross-school role elevation is impossible:

- The JWT `schoolId` claim is set at login time and cannot be changed without
  re-authenticating at the target school.
- `requireSchoolAuth` rejects any token whose `schoolId` does not match the
  `X-School-ID` request header, returning `403 TENANT_MISMATCH`.
- Super-admin tokens carry no `schoolId` claim, so they are never subject to
  the tenant mismatch check and can access any school.

## Tests

| File | Coverage |
|---|---|
| `tests/issue-35-authorization-matrix.test.js` | Full role × endpoint matrix |
| `tests/admin-authorization.test.js` | Per-route 401/403/200 assertions |
| `tests/financeRoleEnforcement.test.js` | Finance-gated report and receipt routes |
| `tests/routeAuthCoverage.test.js` | Structural check: all mutating routes have auth |
| `tests/tenant-scope-plugin.test.js` | Mongoose tenant-scope plugin |
