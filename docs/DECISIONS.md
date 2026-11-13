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
**Status:** Accepted for G5-M1 (2026-11-13), implementation still deferred until G4 acceptance
**Decision:** Merchants receive standard amount-specific PromptPay payments **directly** into their own store account; customers upload a slip, and authorized merchant staff manually confirm only after checking the incoming bank transaction. No Bank API, gateway or platform custody in M1.
**Why:** Lower onboarding/cost/complexity while keeping financial claims explicitly human-attested, not bank-verified.

## ADR-005 — Durable orders and tenant isolation
**Status:** Proposed
**Decision:** Server-authoritative Order and financial state, tenant authorization, transactional idempotency, durable event recovery.
**Why:** No lost Orders or cross-tenant leakage.

## ADR-006 — Implement PromptPay last; create a payment QR per Order
**Status:** Accepted (2026-11-02); revised to G5-M1 manual-first (2026-11-13), provider selection not required for M1.
**Decision:**
1. Complete catalog, table/ordering QR, customer Orders, merchant operations, operational reporting and non-payment security/staging **before** implementing real Payment.
2. At design time, retain Order IDs, immutable amounts and separate Order/Payment state fields to prevent schema redesign.
3. Each submitted Order gets its own logical PromptPay payment request, amount and payment QR once the final Payment module exists. Repeat orders in the same table are separate obligations.
4. The static QR attached to a store/table is **only an ordering QR** and is not the payment QR.
5. Ordinary personal PromptPay target+amount QR cannot guarantee a unique bank reference or automated receipt. In G5-M1 use merchant verification of actual incoming bank transactions only; Bank/PSP integrations are optional future G5-M2.
6. Payment is the **last business feature**, but Production with live payments is blocked until integration/security/reconciliation tests and release approval are complete.
7. Split-bill and combined multi-Order settlement are future features unless explicitly prioritized separately.

**Consequences:** #8 and early #9 must not depend on #7. The API cannot expose an unverified "paid" status. Staging and demo Orders work before payment integration with non-production mock states only.

## ADR-007 — G5-M1 Manual PromptPay + uploaded slip; distinct merchant-confirmed receipt
**Status:** Accepted as scope (2026-11-13); not approved for production
**Decision:** Keep the static Ordering QR. Generate a separate store-receiver+Order-amount payment QR for each logical payment request; the customer uploads a private slip. Only authorized merchant personnel who check actual bank-account incoming transactions can record `manual_confirmed`. Never infer a bank-verified settlement from a receipt image, OCR, redirect or QR. Review/reject/retry, audit, privacy, reconciliation and manual refund evidence are required. No bank API, gateway, provider webhook, automatic payout or platform custody in M1.
**Release:** G4 operational and G6 controlled-pilot gates remain; payment implementation remains last. See [G5-M1 design](G5-M1-MANUAL-PROMPTPAY.md) and [Issue #7](https://github.com/yiwssx/rcat-pos-system/issues/7).
