# RCAT POS Owner/Tenant Administration — G3

This is an authenticated **tenant-owner console**, NOT a global platform-admin
role. The server's secure staff Session, CSRF/Origin checks and PostgreSQL RLS
are authoritative. The UI cannot grant privileges simply by knowing a
tenant ID, store ID or user ID.

## Journeys and API

- Merchant staff authenticate via same-origin
  `/api/auth/google/start` (Workspace `@rcat.ac.th`); no Google token in
  Angular or client storage.
- `GET /api/auth/merchant-stores` lists server-scoped stores and roles.
  Only owner membership shows a Staff Management link.
- `POST /api/tenants` creates a merchant tenant/store under the
  existing database owner quota after backend CSRF/session verification.
  UI slugs and names are validated and the store list refreshed.
- `POST /api/invitations/accept` takes a one-time opaque token from a
  password field. It is never stored in a URL, persistent browser storage
  or log. A fresh staff list is requested after server success.
- Owner-only `POST /api/tenants/:tenantId/invitations` creates an
  invitation for an existing approved `@rcat.ac.th` account with a role of
  manager, cashier or kitchen. The token is displayed once in-memory
  for secure manual sharing; **this endpoint does not email invitations**.
- `GET /api/tenants/:tenantId/staff`, `PATCH /staff/:userId` and
  `DELETE /staff/:userId` support review, owner-confirmed role changes
  and removal. The API returns only user IDs and roles; the UI uses
  shortened IDs and never invents/discloses staff emails.
- `POST /api/auth/logout` revokes the server-side Session with CSRF.

## Security and release boundaries

The UI's `@rcat.ac.th` email/owner checks are for safe input and
discoverability; **backend** membership and restricted SQL functions
decide access. Do not treat a frontend role or URL as authorization.
No app code or PR can imply all-tenants/platform-admin access. A global
support console will require a separate privileged role, explicit
audit, incident and approval policy.

This remains development-gated by `ENABLE_DEVELOPMENT_AUTH` and
production readiness is still 503; configure real Google OAuth Client,
HTTPS reverse proxy, distributed throttling, audit and staging reviews
before production. Browser E2E, screen-reader, device/mobile acceptance
and email invitation delivery also remain work items.

The console does not change Payment, PromptPay, Order monetary state,
financial reporting or guest QR; per-Order Payment remains LAST G5.
