# Authentication session storage (Issue #3 — partial)

The PostgreSQL 002 migration introduces a separate authentication service role and a private session table. It **does not implement merchant login endpoints or authenticate users yet**.

## Security architecture

- rcat_auth: NOLOGIN and NOBYPASSRLS; can read only selected credential fields from rcat.users and manage auth session rows.
- rcat_app: tenant-scoped database role for store operations; **no** access to rcat_private or password hashes.
- Sessions store a 32-byte token digest and independent CSRF-token digest, not cleartext tokens. A future authentication service must generate at least 256 bits of CSPRNG randomness and hash the opaque token before storage.
- Session query must check revoked_at IS NULL AND expires_at > now() and is_active account state on every request.
- Future password hashing should use a calibrated algorithm (e.g. Argon2id) with server-side input validation, rate limiting, account recovery and logging protections; password hashes in migration tests are deliberately invalid fixtures.
- Session cookie rules (HttpOnly, Secure, SameSite, scoped Path, rotation, expiration) and Origin/CSRF validation must be added and tested before exposing a login route.
- Future login role credentials must not be shared with the tenant store-operations DB pool; never run public API database requests with migration/superuser authority.
- The application cannot trust any client-provided tenant id; verify membership and role then derive tenant scope from trusted session.

## Tested in CI

The isolated auth database role can validate an account's password-hash record, create a digest-only session, revoke it and reject expired sessions. The same role cannot query stores; the tenant app role cannot query authentication sessions. These are database privilege tests, **not an HTTP login flow**.

## Remaining #3

Implement API-side password verification, secure registration/invitations, sessions/revocation, CSRF, login throttling, authorization and account recovery; test real HTTP tenant separation with restricted PostgreSQL connections. The current NestJS readiness status stays HTTP 503.

No PromptPay, paid status or financial transaction API is implemented. Payment remains last at G5.
