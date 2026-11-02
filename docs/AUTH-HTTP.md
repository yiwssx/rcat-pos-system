# Authenticated tenant HTTP API — Development Gate (#3)

This adds a real PostgreSQL-backed authentication slice, but production authentication is explicitly disabled until cross-replica throttling, audit, password reset/invitations, TLS deployment, observability and incident handling are complete.

## Endpoints (only when ENABLE_DEVELOPMENT_AUTH=true and NODE_ENV is not production)
- POST /api/auth/login — email and password; generic invalid-credentials response; strict Origin allowlist and bounded development-only login throttling.
- GET /api/auth/me — validates opaque HttpOnly session cookie on every request.
- POST /api/auth/logout — requires Origin, session and CSRF cookie/header; revokes persistent session.
- GET /api/tenants/:tenantId/stores — checks signed-in user membership before stores query with transaction-scoped PostgreSQL RLS.

## Role boundaries
Configure two distinct PostgreSQL login identities: one permitted to SET ROLE rcat_auth, another permitted to SET ROLE rcat_app. Do not use DB superuser, schema owner or migration credentials. The API rejects superuser/BYPASSRLS login roles and uses SET LOCAL ROLE with transaction-scoped scope. User ID for membership lookup is obtained only after verifying the session, not from the request.

Both Session and CSRF tokens are CSPRNG 256-bit secrets; only SHA-256 digests are stored. The session cookie uses Secure, HttpOnly, SameSite=Lax, host-only __Host- prefix. CSRF cookie is readable by JS, also Secure/host-only, checked against the stored digest plus an X-CSRF-Token header. Mutations require an explicitly allowed Origin.

## Development-only env configuration
- ENABLE_DEVELOPMENT_AUTH=true
- NODE_ENV=development or test; production fails closed.
- AUTH_DATABASE_URL: restricted auth-role PostgreSQL login.
- TENANT_DATABASE_URL: separate restricted tenant-role PostgreSQL login.
- AUTH_ALLOWED_ORIGINS: exact comma-separated allowed browser origins.

Never commit real credentials. Local access should be via HTTPS or localhost browser Secure-cookie exception. Do not weaken cookies for public HTTP.

## CI integration verification
Temporary PostgreSQL login identities and fixture user are provisioned in CI. A compiled NestJS API is started and tested: missing Origin denied, wrong password denied, valid login, secure cookies, session lookup, Tenant A store access, Tenant B denied, missing CSRF denied, valid logout and session revocation. Separate SQL tests enforce database role boundaries.

## Remaining Issue #3
- Authenticated signup/onboarding/invitations, account recovery and password resets.
- Distributed rate limiting, abuse monitoring and audit for login/security events.
- Session rotation after sensitive changes, invalidation and device/session management.
- Production TLS/CSRF security review, remove development gate after signoff.
- Role-aware audit and negative HTTP tests for future mutation APIs.

API readiness remains HTTP 503. No bank or PromptPay work until G5.
