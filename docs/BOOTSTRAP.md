# G1 Workspace — runnable framework foundation

The framework shell is runnable and CI-verified. It is **not a working ordering system or payment product**. Tracking: #2. Tenant isolation and database integration are separate work in #3.

## Requirements
- Node.js 24.15.0 (see `.node-version`)
- pnpm 10.23.0 (see `package.json`)

## Local commands

```bash
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install --frozen-lockfile
pnpm exec nx show projects

pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm exec nx smoke api

pnpm dev:customer
# Open separate terminals for merchant, admin and API:
pnpm dev:merchant
pnpm dev:admin
pnpm dev:api
```

The Angular frontends are independent applications. The NestJS API serves `/api/health` (200 and explicitly not production ready) and `/api/ready` (HTTP 503 until DB/auth/ordering dependencies are built). The CI smoke target starts the **compiled** NestJS API on a test-only port and verifies both statuses.

## Verified work
- `pnpm-lock.yaml` is committed and used with `--frozen-lockfile` in CI.
- Nx affected-project build, typecheck, tests and Prettier format checks passed for 7 projects.
- Shared UI, contracts and validation libraries are present and tested.
- The API HTTP smoke test passes in GitHub Actions.

## Not implemented
- PostgreSQL schema, migrations, tenant authentication and RBAC (#3).
- Catalog, table QR, customer Order creation and Merchant operations (#4–#8).
- Production, backups and merchant signup (#10–#11).
- PromptPay/payment (#7) explicitly remains the final functional milestone (G5).

## Remaining quality follow-ups
- Introduce semantic TypeScript/Angular ESLint beyond the current formatting check.
- Add database/tenant isolation integration tests and global safety gates with #3/#10.
- Add Playwright browser E2E flows once real catalog/guest interactions exist.

Do not expose this framework-only environment as a public ordering/payment service.
