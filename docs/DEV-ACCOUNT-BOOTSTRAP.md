# Developer-only first merchant account provisioning

Merchant onboarding in `POST /api/tenants` requires an **existing authenticated account**. Until the public account registration, verification and recovery workflow has passed security review, developers may create a first test account using this **local-only operator CLI**.

## Prerequisites

- PostgreSQL 16 development database `rcat_pos_dev`, migrated with `bash scripts/db/migrate.sh`.
- PostgreSQL running on `127.0.0.1` or `localhost`.
- Dedicated **local development database owner** `rcat_dev_admin`; do not use in API request pools.
- Set `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and optionally `PGPORT` in the operator's shell.

## Create a test account

```bash
# A securely obtained secret in the shell, not placed directly on the command line.
# Do not echo or log passwords in a real production pipeline.
printf '%s\n' "$DEVELOPMENT_TEST_PASSWORD" | \
  pnpm exec tsx scripts/dev/provision-account.ts --email owner@example.invalid
```

The tool reads the password from stdin, validates length, stores the existing scrypt hash format, inserts a normalized account and prints **only the user ID**. It does not create the tenant yet; log in via development-only API and call `POST /api/tenants` to create the tenant, store and owner membership atomically.

## Safety

- Refuses `NODE_ENV=production`, remote PostgreSQL hosts, unexpected database names and unexpected database role names.
- Rejects duplicate emails; does not overwrite/upgrade existing accounts.
- Never accepts password as a command-line argument; never commits user credentials.
- Available on isolated CI fixtures as well, with `rcat_ci_test` and explicit CI mode.
- This is **not** the public SaaS signup flow, email verification, invitation mailing or password recovery.
- Do not use database administrator credentials from a web-serving process.

See [Merchant Onboarding](MERCHANT-ONBOARDING.md). Public registration will require a separate security-reviewed implementation. Payment remains G5.
