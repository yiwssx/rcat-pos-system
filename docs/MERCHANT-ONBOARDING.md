# Merchant Onboarding and Staff Invitations — G1 Development

The first authenticated merchant onboarding vertical slice is now implemented, protected by PostgreSQL 16 stored routines, verified opaque sessions and mandatory CSRF.

## Endpoints (development/test only)

| Endpoint | Who can call | Effect |
| --- | --- | --- |
| POST `/api/tenants` | Existing authenticated user | Creates a tenant, its first store, and the signed-in user as owner in **one database transaction** |
| POST `/api/tenants/:tenantId/invitations` | Owner of that tenant | Creates an expiring, single-use invitation for an existing user's email; manager/cashier/kitchen only |
| POST `/api/invitations/accept` | Signed-in user whose email matches | Adds the existing user to the tenant with invited role; token cannot be replayed |
| GET `/api/tenants/:tenantId/stores` | Existing authorized member | Read-only, RLS-scoped existing API |

## Example JSON bodies

Create merchant: `{"tenantSlug":"my-cafe","tenantName":"ร้านกาแฟ","storeSlug":"main","storeName":"สาขาหลัก"}`

Invite staff: `{"email":"staff@example.invalid","role":"cashier"}`

Accept invitation: `{"invitationToken":"<one-time 256-bit token>"}`

## Transactional / security guarantees

- The session is revalidated **inside a SECURITY DEFINER database function** before a new owner, tenant, store or invitation can be inserted. Caller cannot provide another user ID as owner.
- Function owner is a reviewed elevated migration identity; SECURITY DEFINER search path is pinned to `pg_catalog` and objects are schema-qualified. PUBLIC cannot execute the functions; only restricted `rcat_auth` can.
- Direct table INSERT/UPDATE remains unavailable to `rcat_auth` and `rcat_app`. Audit entries are written atomically with tenant creation and invitation acceptance.
- The owner's active tenant limit is 5 for this development implementation. Up to 20 outstanding invitations per tenant, each valid 72 hours.
- Invitation token is a random 256-bit secret. Only a digest is saved; the raw token is returned **once** to the owner for secure manual delivery, not emailed or logged. Staff cannot invite an owner or elevate their own role.
- Only an existing signed-in account with an exactly matching email can accept an invitation. An existing membership cannot be silently replaced/downgraded.
- The API requires Origin allowlist, session, CSRF token+cookie for mutations. SQL errors map to safe API responses without leaking database details.
- These endpoints are **disabled in production** because `ENABLE_DEVELOPMENT_AUTH=true` fails on `NODE_ENV=production`.

## Deliberately deferred

- Public self-signup and email verification: users must currently be provisioned by a trusted operator. Do not call this public merchant registration.
- Automated invitation emailing, invitation revocation/resend and onboarding of brand new staff accounts.
- Password reset/account recovery, production rate limiting, audit review, notifications, production deployment.
- Merchant UI for these flows, menu/QR ordering and Payment (Payment remains G5).

## Verification

PostgreSQL SQL integration tests cover permissions, actor session, one-transaction tenant+store+owner creation, invite recipient binding/replay. CI HTTP tests cover real login, CSRF, duplicate/invalid store creation, owner invitation, wrong recipient, staff acceptance, cashier unauthorized invitation, tenant isolation.

This is **not** release-ready. `/api/ready` must remain 503.
