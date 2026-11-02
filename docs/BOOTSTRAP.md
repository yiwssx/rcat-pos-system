# G1 workspace — first runnable scaffold

This is a **framework foundation**, not a working ordering or payment product. Tracking: #2. Tenant auth/database is tracked separately under #3.

## Requirements
- Node.js >=24.15.0 and <25 (Angular 22 compatibility)
- pnpm 10.23.0

## Commands
```bash
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install
pnpm exec nx show projects
pnpm build
pnpm typecheck
pnpm test\npnpm exec nx smoke api
pnpm dev:customer   # alternate terminal: merchant/admin/api
```

Angular Customer/Merchant/Admin run using Angular CLI via Nx; NestJS API starts on port 3000 at `/api/health` and `/api/ready`. In this milestone readiness is **process-level only** and must not be treated as database/transaction readiness.

## Boundaries
- No database schema/migrations or real orders yet (#3–#6).
- No authentication, QR ordering, bank integrations, PromptPay, or real payment state.
- UI pages show explicit development status and cannot be used for transactions.
- Do not expose any of these apps as a public production service.

## Next steps
1. Generate and commit `pnpm-lock.yaml` on trusted CI, then enable `--frozen-lockfile` (required before #2 closure).
2. Complete lint/format and Nx affected CI behavior using actual project graph.
3. Add PostgreSQL Docker profile and migration baseline under #3.
4. Add integration and UI tests before implementing financial endpoints.
