# RCAT POS — development tracker

GitHub is the source of truth. Master tracker: https://github.com/yiwssx/rcat-pos-system/issues/13

**Decision:** Payment implementation (#7) is the final functional milestone, with **PromptPay QR/payment request for each Order**. Real-money production launch takes place **after** payment verification and release testing, not before.

## Execution order
| Stage | Issue | Area | Priority | State |
|---|---|---|---|---|
| G0 | #1 | Product scope and per-Order QR payment requirements | P0 | Open |
| G1 | #2 | Nx/pnpm Angular/NestJS foundation | P0 | Closed |
| G1 | #3 | Multi-tenant auth/data | P0 | Open |
| G2 | #4 | Catalog, tables, ordering QR session (G2 follow-up #38 remains open) | P0 | Closed |
| G2 | #6 | Orders, prices and Bills (payment-ready schema only) | P0 | Open |
| G2 | #5 | Guest ordering and Order tracking UI | P0 | Open |
| G3 | #8 | Merchant PWA/realtime (no Payment dependency) | P0 | Open |
| G3 | #9 | Basic operational reporting/stock (financial reports later) | P1 | Open |
| G4 | #10 | Ordering security and reliability (continues across release) | P0 | Open |
| G4 | #11 | Staging/hosting infrastructure preparation (not production release) | P1 | Open |
| **G5** | **#7** | **Final business feature: per-Order PromptPay QR, verification, reconciliation** | **P0 — Release blocker** | **Open** |
| G6 | #10 #11 | Integrated security/payment tests, pilot and Production go/no-go | P0/P1 | Open |
| G7 | #12 | Expansion modules (after pilot) | P2 | Open |

A high-priority issue can deliberately be scheduled late if it needs mature upstream requirements. No feature issue has been completed by this decision-only update.

## Delivery invariants
- Every Order has its own payable total and future PromptPay request; a table QR never doubles as the payment QR.
- A generic personal PromptPay QR with an amount does not prove payment or provide guaranteed unique transaction reference.
- No bank integration, live QR payment endpoint, payment credentials or false "paid" flags before G5.
- Issue state in GitHub is authoritative; document table is not a synced progress mirror.

## Proof of done
Linked PR, relevant tests pass, tenant/permission and transaction invariants verified, relevant docs and rollout updated; never close Payment or Production on the strength of docs-only checks.


## Current G4 On-prem and nonredundant verification — 9 Nov 2026
| Track | Issue | State | Evidence / blocker |
| --- | --- | --- | --- |
| A — Coding | [#80](https://github.com/yiwssx/rcat-pos-system/issues/80) | **Closed (code-only)** | PR #83/#84/#85 CI artifacts and code merged; not a host acceptance |
| Lean evidence/CI | [#86](https://github.com/yiwssx/rcat-pos-system/issues/86) | See GitHub issue | [Rules, impact gates and register](LEAN-EVIDENCE-DELIVERY.md) |
| B — Staging deployment | [#81](https://github.com/yiwssx/rcat-pos-system/issues/81) | **Open** | Real RCAT IOT/RMS host capacity, DNS/TLS/OAuth/backup/restore/QR not verified |
| C — Policies/Acceptance | [#82](https://github.com/yiwssx/rcat-pos-system/issues/82) | **Open** | Owner must approve stock/retention/SLO/RPO/RTO and B signoff |

Never rerun complete Nx/Database/Browser CI on RCAT IOT. Use prior CI evidence only where tested SHA and environmental boundary match. [Evidence register](evidence-register.json) contains historical CI proof and explicit missing Staging gates. Build only unique reviewed Staging release tags. G5 PromptPay remains LAST; G6/Production not approved.
