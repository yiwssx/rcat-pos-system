# RCAT POS System

Hardware-free, mobile-first, multi-merchant QR ordering SaaS.

> **Status (9 Nov 2026): G1–G4 non-payment engineering code exists; G4 real On-prem Staging acceptance remains OPEN. NOT deployed to Staging or Production.** Ordering, Google Workspace Auth, merchant PWA and stock are implemented in code/CI; **real PromptPay/Payment is NOT implemented** (G5 remains last).

## Architecture

- `apps/customer` — Angular mobile-first guest frontend
- `apps/merchant` — Angular merchant frontend with bounded static-only PWA offline shell
- `apps/admin` — Angular platform administration frontend
- `apps/api` — NestJS HTTP API (authenticated tenant, Guest Order and inventory services; non-payment)
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


## On-prem staging and lean CI

- **Selected staging architecture:** RCAT IOT On-prem (candidate LAN `10.10.1.100`) with isolated Docker Compose and approved RMS HTTPS ingress; not yet installed or verified. See [A1 staging package](docs/ONPREM-STAGING-A1.md).
- **Do not run full local CI on IOT.** `scripts/ci/impact-policy.mjs` routes change-scoped GitHub Actions; [Lean Evidence-Based Delivery](docs/LEAN-EVIDENCE-DELIVERY.md) and [historical CI evidence register](docs/evidence-register.json) explicitly distinguish code checks from real host/provider approval.
- A Coding [#80](https://github.com/yiwssx/rcat-pos-system/issues/80) closed; B Staging [#81](https://github.com/yiwssx/rcat-pos-system/issues/81) and C Policies [#82](https://github.com/yiwssx/rcat-pos-system/issues/82) open. No real Payment or Production.
