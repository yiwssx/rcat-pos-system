# PostgreSQL Tenancy Baseline — Issue #3 (partial)

## Included
- PostgreSQL 16 schema: tenants, users, tenant memberships, stores, audit events.
- Restricted rcat_app NOLOGIN/NOBYPASSRLS role with no access to global password-hash records.
- ENABLE and FORCE ROW LEVEL SECURITY for tenant-scoped tables.
- Checksummed migrations with transactionally committed ledger and drift detection.
- Real PostgreSQL CI proving cross-tenant read/write isolation, privileged table denial, append-only audit, tenant-context reset and repeat-safe migration.

## Local setup
Set a unique, development-only POSTGRES_PASSWORD in your own terminal, then run:

```bash
docker compose -f compose.db.yaml up -d
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=rcat_dev_admin PGDATABASE=rcat_pos_dev
export PGPASSWORD="$POSTGRES_PASSWORD"
bash scripts/db/migrate.sh
```

Do not run tests/db/tenant-isolation.sql against a live or shared database. It inserts deterministic fixtures for ephemeral CI only.

## Important security boundary
PostgreSQL RLS is **defense-in-depth, not authentication**. Custom session settings can be changed by a database client. A future backend must derive tenant context from verified login/membership, never from an arbitrary browser-provided tenant ID. It must SET LOCAL app.tenant_id within a scoped transaction, enforce RBAC in the API and use a database role that cannot bypass RLS.

The rcat_app role is not a login role or database owner, and is intentionally not granted access to password hashes. Dedicated least-privilege authentication/login DB access and API session processing must be implemented before any merchant traffic.

## Remaining work for Issue #3
- Password hash authentication, secure HttpOnly cookies, CSRF prevention, session rotation/expiry/revocation, account reset and invitations.
- NestJS authorization matrix and tenant membership verification.
- Restricted connection pool with verified transaction-local tenant context and negative HTTP integration tests.
- Audit for administrative actions, login limits, production secrets, backup/restore and migration role separation.
- API /api/ready remains HTTP 503 until these prerequisites are satisfied.

## Migration policy
Applied SQL checksums are immutable. Changes require a new migration. Do not destructively drop merchant/order records; use controlled forward fixes and backup restore drills. This does not implement QR ordering or payment.

Payment remains **G5**, the final functional milestone.
