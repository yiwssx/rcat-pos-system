# Architecture decision log

## ADR-001 — Angular frontend
**Status:** Proposed, awaiting implementation validation
**Decision:** Angular + TypeScript for customer, merchant and admin; share typed UI and API contracts within Nx/pnpm.
**Why:** Consistent feature boundaries, tooling, strict TypeScript and long-term maintenance. Customer performance must be measured; SSR is optional per route.

## ADR-002 — NestJS modular monolith
**Status:** Proposed
**Decision:** NestJS API + PostgreSQL, no mandatory Fastify. HTTP adapter picked after compatibility and benchmark tests.
**Why:** Domain modularity and DI; transaction and payment correctness matter more than HTTP benchmark differences.

## ADR-003 — Hardware-free web first
**Status:** Proposed
**Decision:** Customer browser + Merchant PWA; optional printers; native app shell deferred.
**Why:** No POS terminal required and supports smart phones, tablets and computers.

## ADR-004 — Merchant-directed payments
**Status:** Investigation required
**Decision candidate:** Platform orchestrates provider-verified payments directly for each merchant and supports separately labelled manual verification.
**Why:** Reduce risk of platform handling custodial funds and avoid falsified payment success. Provider/legal feasibility must be validated.

## ADR-005 — Durable orders and tenant isolation
**Status:** Proposed
**Decision:** Database-authoritative order/bill/payment state, server-side tenant authorization, transactional idempotency and outbox-based reliable event delivery.
**Why:** Financial integrity and zero silent lost orders.

