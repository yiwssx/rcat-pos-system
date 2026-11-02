# Owner-only staff administration — Issue #3 (development)

This increment extends the existing authenticated Merchant API. Staff administration operates on **existing verified accounts and memberships only**; it does not enable public signup, email delivery, or payments.

| Endpoint | Required authority | Behavior |
| --- | --- | --- |
| `GET /api/tenants/:tenantId/staff` | Signed-in tenant owner | List member IDs and roles only |
| `PATCH /api/tenants/:tenantId/staff/:userId` | Owner + Origin + CSRF | Change a non-owner to manager, cashier or kitchen |
| `DELETE /api/tenants/:tenantId/staff/:userId` | Owner + Origin + CSRF | Remove a non-owner membership |

Mutations verify the **actual active session again inside PostgreSQL** and require the initiating user to be a current tenant owner. They execute in one database transaction, lock the tenant row to serialize owner administration, and append a tenant-scoped audit event with the previous/new roles. `rcat_auth` has EXECUTE access only to the SQL functions, not direct INSERT/UPDATE/DELETE membership grants.

Existing owners are immutable through these endpoints. Owner transfer, deletion and account recovery require a separate audited multi-factor process; these endpoints cannot accidentally remove the last owner.

Removed users' sessions may remain valid for their other tenants, but access to the removed tenant fails on the next membership check. Store read permissions change immediately on role mutation. Tokens/cookies are not returned by these management routes.

CI covers SQL owner/cashier privileges, one-time active sessions, attempts to remove owner or reassign removed users, real HTTP CSRF denial, role changes and immediate authorization revocation, and recorded audit actions.

**Production authentication remains disabled; `/api/ready` stays HTTP 503. Payment/PromptPay remains G5.**
