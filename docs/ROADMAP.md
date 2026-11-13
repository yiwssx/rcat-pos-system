# Delivery roadmap and release gates

**Decision (2026-11-02; revised 2026-11-13):** Implement real payments **last among product modules**. G5-M1 is **standard PromptPay amount QR per Order + private slip upload + authorized merchant confirmation after checking actual bank receipt**, paid directly to each merchant's account. No Bank API, gateway or webhook in M1. The final production gate still follows payment implementation.

| Stage | Outcome | Active owner | Done when |
|---|---|---|---|
| Master / G0 decisions | Approved business journeys and sequenced scope; G7 future backlog parked | [#13](https://github.com/yiwssx/rcat-pos-system/issues/13) | Changes accepted and prior scope linked, not silently forgotten |
| G1–G3 Ordering & Operations | Catalog/QR, Customer customizations, required ordered-by/location, Order/Bills, Merchant realtime, inventory and non-financial reports | [#102](https://github.com/yiwssx/rcat-pos-system/issues/102) | End-to-end Guest Order appears immediately and Merchant can prepare regardless of unpaid state; safe snapshots and relevant tests |
| G4 non-payment hardening | Auth, tenant isolation, repository protections, real Staging B1–B6, policies, private backups and operational monitoring | [#81](https://github.com/yiwssx/rcat-pos-system/issues/81) | Independent operator evidence and owner signoff; no live Payment yet |
| G5-M1 — final product feature | Store-owned PromptPay QR after Order creation, upload slip, manual bank-receipt review, fraud/exception/refund records | [#7](https://github.com/yiwssx/rcat-pos-system/issues/7) | Focused security/retry/receipt UAT and non-money sandbox checks pass |
| G6 release qualification | Approved controlled real-money pilot, recovery and security go/no-go | [#81](https://github.com/yiwssx/rcat-pos-system/issues/81) with #7 | Explicit operator/owner approval, never inferred from docs/CI |
| G7 optional | Booking, split bills, delivery, subscriptions, accounting | [#13](https://github.com/yiwssx/rcat-pos-system/issues/13) (deferred backlog only) | Not started unless pilot evidence and explicit reprioritization |

**Consolidation (13 Nov 2026):** Historical predecessor Issues #1/#3/#5/#6/#8/#9/#10/#11/#12/#15/#38/#82 were closed as **superseded/not_planned**, not accepted or finished. Their outstanding safety checks and evidence remain mapped to four live Issues. Do not create new tracker Issue for each UI screen, API or test.

**Not scheduled by date yet:** need team capacity and validated scope.

## Important implementation boundary
- Build **Order and Bill** entities, totals in integer satang, item-price snapshots and separate Order/Payment states at G1/G2; this is data architecture **not** payment implementation.
- Through G2–G4, do not integrate a bank, generate live payable QR, store real merchant credentials, or fake successful payment status. Tests may use isolated, clearly labelled payment stubs only.
- G5-M1 creates **one logical payment request per Order**, with bounded retries, a pinned store-owned receiver, amount from server-authoritative Order snapshot and an **internal** Order reference only. No claim of bank-level unique QR reference.
- The ordering QR on a table/store is separate from the per-Order PromptPay QR shown **immediately after** successful Order submission. Kitchen receives Order immediately and is never gated by Payment; customer may pay early or late.
- A personal PromptPay target + amount generates a payable QR but does not inherently provide unique bank transaction reference or automated confirmation. M1 requires explicit authorized Merchant review of actual bank incoming transactions and private slip evidence. Bank/provider APIs and webhooks are future optional G5-M2 scope, not M1.
- Treat **Payment as the final business feature**, **not** as work that can be skipped before accepting real money. No public paid production until G6. [M1 detailed requirements](G5-M1-MANUAL-PROMPTPAY.md).
- In MVP, one Order's amount is paid as one order-scoped obligation. Multiple Orders on a table retain individual obligations. Split bills / combined-table settlement are designed as future capabilities (#12) unless explicit product requirements change.

## Critical dependencies
- #8 Merchant operation features depend on #3/#6, **not** #7. Cross-layer ordering-context UX is owned only by [#102](https://github.com/yiwssx/rcat-pos-system/issues/102); historical implementation Issues #5/#6/#8 are archived, not finished. Mobile/printed QR physical acceptance remains #81.
- #9 initial order-volume/operational reports depend on #6, **not** #7; actual revenue/refund reconciliation is added at G5.
- #81 owns G4 Staging/G6 release acceptance without live money until authorized Pilot; Production Go-live depends on both #7 and #81.
- Threat modelling begins in G0 and runs throughout. Global auth/schema checks apply to changes that affect those boundaries.
- CI should use Nx affected jobs where safe and preserve transaction/security and release gates.

## Change control
Each issue owns acceptance criteria, test evidence, risks and rollout notes. Do not close a feature based on a docs-only PR or green documentation workflow.
