# RCAT POS System

Hardware-free, mobile-first, multi-merchant QR ordering SaaS.

> **Status: G1 framework foundation, NOT production-ready.** No ordering, shop authentication, live banking or PromptPay feature exists yet.

## Architecture

- `apps/customer` — Angular mobile-first guest frontend
- `apps/merchant` — Angular merchant frontend (PWA functionality pending #8)
- `apps/admin` — Angular platform administration frontend
- `apps/api` — NestJS HTTP API, health endpoint only
- `libs/contracts` — shared Order/Payment type declarations and safe satang parser
- `pnpm + Nx` — workspace tasks and affected-project CI

Current technology: Angular 22, NestJS 11, Nx 24, TypeScript 6, Node.js 24, pnpm 10. All real payment functionality is deliberately deferred until **issue #7 (G5)**.

## Local development

Requires Node.js 24.15.0, pnpm 10.23.0:

```bash
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install --frozen-lockfile

pnpm exec nx show projects
pnpm build
pnpm test
pnpm typecheck
pnpm lint

pnpm dev:customer
pnpm dev:merchant
pnpm dev:admin
pnpm dev:api
```

See [bootstrap and limitations](docs/BOOTSTRAP.md), [development roadmap](docs/ROADMAP.md), and [Master Tracker #13](https://github.com/yiwssx/rcat-pos-system/issues/13).

## Product goals

- Merchants open/manage stores using a browser, tablet or phone; no mandatory POS hardware.
- Guests scan a store/table **ordering QR** to place an Order.
- Each Order will eventually have its own PromptPay QR payment request (G5), not implemented yet.
- Strict multi-tenant authorization, idempotency, accurate money and resilient order delivery before public release.

## Security

Do **not** deploy this foundation to production or accept real customer funds. `/api/health` indicates process availability only; `/api/ready` rejects readiness until core dependencies and isolation tests are complete. See [SECURITY.md](SECURITY.md).
