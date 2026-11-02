# Delivery roadmap and release gates

**Decision (2026-11-02):** Implement real payments **last among product modules**. The intended payment method is a **merchant-directed PromptPay QR generated for each submitted Order**, not a single static payment QR for all customers. The final production gate still follows payment implementation.

| Stage | Outcome | GitHub issues | Done when |
|---|---|---|---|
| G0 Discovery | Validated journeys, Order-level QR payment requirements, state diagrams, threat model | #1 | Product acceptance criteria reviewed |
| G1 Foundation | Angular/NestJS Nx/pnpm workspace, CI, multi-tenant auth | #2 #3 | Fresh install, auth/tenant isolation tests pass |
| G2 Ordering core | Catalog and static **ordering** QR, table sessions, orders and bills, customer storefront | #4 #6 #5 | End-to-end guest order works **without any live payment** |
| G3 Store operations | Merchant PWA and realtime queue, basic order/operational reporting | #8 #9 | Order recovery after device sleep; basic reports match order records |
| G4 Non-payment hardening | Security, concurrency, disaster recovery, Staging, Pilot infrastructure preparedness | #10 #11 (preparation only) | Order system resilient with test-only payment stubs, no real banking enabled |
| **G5 Final product module — PromptPay per Order** | Order-specific PromptPay payment requests/QR, verified or explicit manual receipt, refunds and reconciliation | **#7** | Validated provider/merchant configuration, simulated and test payments, retries, refunds, duplicate/late payment scenarios |
| G6 Release qualification | End-to-end with real payment mechanism in controlled environment, security signoff and controlled pilot | #10 #11 | Payment + operational recovery tests passed; go/no-go approval before using real customer funds |
| G7 Optional expansion | Delivery, bookings, sophisticated split bills, accounting, subscriptions | #12 | Prioritized based on pilot evidence |

**Not scheduled by date yet:** need team capacity and validated scope.

## Important implementation boundary
- Build **Order and Bill** entities, totals in integer satang, item-price snapshots and separate Order/Payment states at G1/G2; this is data architecture **not** payment implementation.
- Through G2–G4, do not integrate a bank, generate live payable QR, store real merchant credentials, or fake successful payment status. Tests may use isolated, clearly labelled payment stubs only.
- G5 creates **one logical payment request per Order**, with zero or more retry attempts, merchant routing, amount from server-authoritative Order snapshot, and a stable order reference.
- The ordering QR on a table/store is separate from the per-Order PromptPay QR shown **after** order submission.
- A personal PromptPay target + amount generates a payable QR but does not inherently provide unique bank transaction reference or automated confirmation. Only use provider-specific references, notification/webhooks, or manual confirmation after verifying capabilities.
- Treat **Payment as the final business feature**, **not** as work that can be skipped before accepting real money. No public paid production until G6.
- In MVP, one Order's amount is paid as one order-scoped obligation. Multiple Orders on a table retain individual obligations. Split bills / combined-table settlement are designed as future capabilities (#12) unless explicit product requirements change.

## Critical dependencies
- #8 Merchant operation features depend on #3/#6, **not** #7.
- #9 initial order-volume/operational reports depend on #6, **not** #7; actual revenue/refund reconciliation is added at G5.
- #11 staging/infrastructure can start at G4 without money. Production Go-live depends on #7 + #10.
- Threat modelling begins in G0 and runs throughout. Global auth/schema checks apply to changes that affect those boundaries.
- CI should use Nx affected jobs where safe and preserve transaction/security and release gates.

## Change control
Each issue owns acceptance criteria, test evidence, risks and rollout notes. Do not close a feature based on a docs-only PR or green documentation workflow.
