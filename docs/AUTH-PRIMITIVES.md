# Server-side Authentication Primitives — G1

This module implements **server-only building blocks**; it does **not** add or expose login, sign-up, password reset or merchant account APIs.

## Implemented
- Password hashing using the asynchronous Node.js scrypt KDF with a random per-password salt (32768/8/1 parameters); constant-time digest check.
- CSPRNG 256-bit opaque session and CSRF tokens; 32-byte SHA-256 digests for persistence, matching PostgreSQL migration 002.
- Secure host-only HttpOnly cookies using the __Host- prefix, SameSite=Lax, Secure and 12-hour Max-Age.
- Minimal permission matrix (owner, manager, cashier, kitchen), denied by default outside explicitly listed permissions.
- Unit tests for password verification/rejection, secret randomness/digests, cookie flags and RBAC defaults.

## Pending Security Work Before Public Use
1. Implement tenant-backed invitation/registration and user provisioning.
2. Integrate a restricted auth database service for verifying hashes and saving session digests.
3. Check user status, session expiry, revocation and active tenant membership on every protected request.
4. Add email/account-enumeration resistance, throttling and temporary lockouts.
5. Validate Origin and CSRF header/token on state-changing operations; SameSite alone is not CSRF protection.
6. Add password reset flow, session rotation, logout revocation and invalidation after credential changes.
7. Ensure tenant-scoped database transactions use verified membership and an RLS-bound role; add negative HTTP tests.
8. Perform an additional security review before introducing live credential endpoints.

These server-auth utilities must never be imported into any Angular browser bundle. Role policies are initial defaults awaiting product owner/merchant approval. Consider Argon2id if operational benchmarks and maintained packages support it; do not silently change the password hash format.

Payment remains G5 and is not part of this module.
