# Delivery roadmap and release gates

**Decision (2026-11-02; revised 2026-11-13):** Implement real payments **last among product modules**. G5-M1 is **standard PromptPay amount QR per Order + private slip upload + authorized merchant confirmation after checking actual bank receipt**, paid directly to each merchant's account. No Bank API, gateway or webhook in M1. The final production gate still follows payment implementation.

| Stage | Outcome | GitHub issues | Done when |
|---|---|---|---|
| G0 Discovery | Validated journeys, Order-level QR payment requirements, state diagrams, threat model | #1 | Product acceptance criteria reviewed |
| G1 Foundation | Angular/NestJS Nx/pnpm workspace, CI, multi-tenant auth | #2 #3 | Fresh install, auth/tenant isolation tests pass |
| G2 Ordering core | Catalog and static **ordering** QR, table sessions, orders and bills, customer storefront | #4 #6 #5 | End-to-end guest order works **without any live payment** |
| G3 Store operations | Merchant PWA and realtime queue, basic order/operational reporting | #8 #9 | Order recovery after device sleep; basic reports match order records |
| G4 Non-payment hardening | Security, concurrency, disaster recovery, Staging, Pilot infrastructure preparedness | #10 #11 (preparation only) | Order system resilient with test-only payment stubs, no real banking enabled |
| **G5-M1 Final product module — Manual PromptPay** | Store-owned standard PromptPay amount QR per Order, slip upload, merchant bank-account review/confirmation, exception/refund records and manual reconciliation | **#7** | Scoped QR/receiver, slip privacy, human-attested state, unauthorized/duplicate/race tests and non-money E2E pass |
| G6 Release qualification | End-to-end **manual** payment/review and exception workflow in controlled environment, security signoff and controlled pilot | #10 #11 | Manual verification procedure, evidence privacy, operational recovery and owner go/no-go approved before real customer funds |
| G7 Optional expansion | Delivery, bookings, sophisticated split bills, accounting, subscriptions | #12 | Prioritized based on pilot evidence |

**Not scheduled by date yet:** need team capacity and validated scope.

## Important implementation boundary
- Build **Order and Bill** entities, totals in integer satang, item-price snapshots and separate Order/Payment states at G1/G2; this is data architecture **not** payment implementation.
- Through G2–G4, do not integrate a bank, generate live payable QR, store real merchant credentials, or fake successful payment status. Tests may use isolated, clearly labelled payment stubs only.
- G5-M1 creates **one logical payment request per Order**, with bounded retries, a pinned store-owned receiver, amount from server-authoritative Order snapshot and an **internal** Order reference only. No claim of bank-level unique QR reference.
- The ordering QR on a table/store is separate from the per-Order PromptPay QR shown **after** order submission.
- A personal PromptPay target + amount generates a payable QR but does not inherently provide unique bank transaction reference or automated confirmation. M1 requires explicit authorized Merchant review of actual bank incoming transactions and private slip evidence. Bank/provider APIs and webhooks are future optional G5-M2 scope, not M1.
- Treat **Payment as the final business feature**, **not** as work that can be skipped before accepting real money. No public paid production until G6. [M1 detailed requirements](G5-M1-MANUAL-PROMPTPAY.md).
- In MVP, one Order's amount is paid as one order-scoped obligation. Multiple Orders on a table retain individual obligations. Split bills / combined-table settlement are designed as future capabilities (#12) unless explicit product requirements change.

## Critical dependencies
- #8 Merchant operation features depend on #3/#6, **not** #7.
- #9 initial order-volume/operational reports depend on #6, **not** #7; actual revenue/refund reconciliation is added at G5.
- #11 staging/infrastructure can start at G4 without money. Production Go-live depends on #7 + #10.
- Threat modelling begins in G0 and runs throughout. Global auth/schema checks apply to changes that affect those boundaries.
- CI should use Nx affected jobs where safe and preserve transaction/security and release gates.

## Change control
Each issue owns acceptance criteria, test evidence, risks and rollout notes. Do not close a feature based on a docs-only PR or green documentation workflow.
