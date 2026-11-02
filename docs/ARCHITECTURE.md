# Architecture proposal — not yet implemented

## Code organization
Nx/pnpm Monorepo:
- apps/customer: Angular mobile-first guest ordering; selectively consider SSR where it measurably helps first load.
- apps/merchant: Angular PWA (CSR) for orders, tables, cashier and shop administration.
- apps/admin: Angular CSR for platform operations.
- apps/api: NestJS modular monolith, HTTP adapter chosen by compatibility/benchmarks.
- libs: shared contracts, UI tokens, validation and API client (do not share privileged server logic with browsers).
- Database: PostgreSQL with migrations; queue/cache added after reliability requirements demand it.

## Service boundaries
API domains: identity, tenants, stores, catalog, QR/table sessions, orders, bills, payments, refunds, reporting, audit and notifications. Start as a modular monolith with explicit boundaries; no microservices by default.

## Core data entities
tenants, stores, users, memberships, roles, permissions, tables, table_sessions, products, product_variants, option_groups, menu_items, orders, order_items, bills, bill_items, payment_attempts, payments, refunds, stock_movements, audit_events, idempotency_keys, outbox_events.

## Invariants
- Every merchant-owned query and mutation must be scoped to an authorized tenant/store; avoid trusting IDs from the client.
- Use database constraints, transactions, and per-request idempotency keys.
- Store monetary amounts in satang integers (or fixed-precision decimal with explicit rounding), never JS floating point for authoritative balances.
- Payment state is verified via trusted provider API/webhook or explicitly labelled merchant manual confirmation.
- Webhooks: authenticate signature, dedupe event, safely replay, handle out-of-order arrival and reconcile actual provider status.
- Queue/events: transactional outbox to avoid lost order notifications when implementing asynchronous delivery.
- Reconnect: client fetches authoritative outstanding orders and acknowledgements; push is advisory only.
- QR must identify store/table plus guarded session; consider rotating tokens and preventing stale links.

## Auth and operations
Secure HTTP-only same-site cookies with CSRF protection, session rotation/revocation, audit, rate limits and role-scoped APIs. Decide deployment topology separately. Secrets kept in environment/secret store, not repository.

## Decisions pending verification
- Frontend first-load rendering: CSR vs SSR on actual customer flow.
- HTTP adapter for NestJS: default compatibility vs Fastify based on test results.
- SSE vs WebSocket and queue adoption after load/reconnect test.
- Payment providers supported for Thai merchants, onboarding, fees and legal obligations.
- Cloud provider, database backups and production domains.

See docs/DECISIONS.md for formal ADRs.

