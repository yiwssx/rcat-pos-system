# Architecture decision log

## ADR-001 — Angular frontend
**Status:** Proposed, awaiting implementation validation
**Decision:** Angular + TypeScript for customer, merchant and admin; typed contracts within Nx/pnpm.
**Why:** Consistent feature boundaries and maintenance. SSR considered per route after measurements.

## ADR-002 — NestJS modular monolith
**Status:** Proposed
**Decision:** NestJS API + PostgreSQL, no mandatory Fastify. Choose HTTP adapter after compatibility and tests.
**Why:** Business correctness and transactions matter more than HTTP throughput benchmarks.

## ADR-003 — Hardware-free web first
**Status:** Proposed
**Decision:** Customer browser + Merchant PWA; printers optional; native apps deferred.
**Why:** Accessible on existing phones/tablets/computers.

## ADR-004 — Merchant-directed payments
**Status:** Investigation required (implementation deferred to G5)
**Decision candidate:** Merchants receive PromptPay funds directly through permitted receiving accounts/providers. No unapproved platform custody. Support server/provider verification or explicit merchant manual confirmation.
**Why:** Minimize regulatory risk and never falsely claim successful payment.

## ADR-005 — Durable orders and tenant isolation
**Status:** Proposed
**Decision:** Server-authoritative Order and financial state, tenant authorization, transactional idempotency, durable event recovery.
**Why:** No lost Orders or cross-tenant leakage.

## ADR-006 — Implement PromptPay last; create a payment QR per Order
**Status:** Accepted as product sequencing and payment scope (2026-11-02); provider selection pending.
**Decision:**
1. Complete catalog, table/ordering QR, customer Orders, merchant operations, operational reporting and non-payment security/staging **before** implementing real Payment.
2. At design time, retain Order IDs, immutable amounts and separate Order/Payment state fields to prevent schema redesign.
3. Each submitted Order gets its own logical PromptPay payment request, amount and payment QR once the final Payment module exists. Repeat orders in the same table are separate obligations.
4. The static QR attached to a store/table is **only an ordering QR** and is not the payment QR.
5. Ordinary personal PromptPay target+amount QR cannot guarantee unique reference or automatic receipt confirmation; obtain bank/provider capabilities for unique references and reliable webhooks or explicitly use manual verification.
6. Payment is the **last business feature**, but Production with live payments is blocked until integration/security/reconciliation tests and release approval are complete.
7. Split-bill and combined multi-Order settlement are future features unless explicitly prioritized separately.

**Consequences:** #8 and early #9 must not depend on #7. The API cannot expose an unverified "paid" status. Staging and demo Orders work before payment integration with non-production mock states only.
