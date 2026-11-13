# RCAT POS — development tracker

GitHub is the source of truth. Master tracker: https://github.com/yiwssx/rcat-pos-system/issues/13

**Decision (revised 13 Nov 2026):** Single G2/G3 UI/order-context tracker **[#102](https://github.com/yiwssx/rcat-pos-system/issues/102)**; guest Order reaches Merchant immediately and kitchen may prepare regardless of payment. Payment (#7) remains the final business module: store-owned PromptPay amount QR available immediately after submission, optional early/late payment, private slip upload and manual bank-account confirmation. No bank/gateway API in M1; G6 approval required before taking real funds.

## Execution order
| Stage | Issue | Area | Priority | State |
|---|---|---|---|---|
| G0 | #1 | Product scope and per-Order QR payment requirements | P0 | Open |
| G1 | #2 | Nx/pnpm Angular/NestJS foundation | P0 | Closed |
| G1 | #3 | Multi-tenant auth/data | P0 | Open |
| G2 | #4 | Catalog/tables/ordering QR baseline; former #38 superseded by #102 + #81 + #3 (not completed) | P0 | Closed |
| G2 | #6 | Orders, prices and Bills (payment-ready schema only) | P0 | Open |
| G2 | #5 | Guest ordering and Order tracking UI | P0 | Open |
| **G2/G3** | **#102** | **Single cross-functional tracker: modifier UX, per-item notes, required ordered-by/delivery, Merchant Order Board** | **P0; P1/P2 optional** | **Open** |
| G3 | #8 | Merchant PWA/realtime (no Payment dependency) | P0 | Open |
| G3 | #9 | Basic operational reporting/stock (financial reports later) | P1 | Open |
| G4 | #10 | Ordering security and reliability (continues across release) | P0 | Open |
| G4 | #11 | Staging/hosting infrastructure preparation (not production release) | P1 | Open |
| **G5-M1** | **#7** | **Final business feature: per-Order PromptPay QR, private slip, manual Merchant confirmation/reconciliation** | **P0 — Release blocker** | **Open** |
| G6 | #10 #11 | Integrated security/payment tests, pilot and Production go/no-go | P0/P1 | Open |
| G7 | #12 | Expansion modules (after pilot) | P2 | Open |

A high-priority issue can deliberately be scheduled late if it needs mature upstream requirements. No feature issue has been completed by this decision-only update.

## Delivery invariants
- Every Order has its own payable total and future PromptPay request; a table QR never doubles as the payment QR.
- Successful Order submission immediately enters Merchant inbox; Merchant may accept/prepare/serve even if unpaid, paid late or awaiting slip review. No pay-first kitchen gate.
- P0 item instructions / mandatory name and destination are owned only by #102 (implementation in existing #5/#6/#8), not new child Issues.
- A generic personal PromptPay QR with an amount does not prove payment or provide guaranteed unique transaction reference.
- No bank integration, live QR payment endpoint, receiving-account credentials or false "paid" flags before G5; G5-M1 also excludes Bank API/gateway/automatic slip verification. See [M1 design](G5-M1-MANUAL-PROMPTPAY.md).
- Issue state in GitHub is authoritative; document table is not a synced progress mirror. Consolidated #38 was closed **superseded/not_planned**, not completed; its unresolved staging signoffs remain #81.

## Proof of done
Linked PR, relevant tests pass, tenant/permission and transaction invariants verified, relevant docs and rollout updated; never close Payment or Production on the strength of docs-only checks.


## Current G4 On-prem and nonredundant verification — 9 Nov 2026
| Track | Issue | State | Evidence / blocker |
| --- | --- | --- | --- |
| A — Coding | [#80](https://github.com/yiwssx/rcat-pos-system/issues/80) | **Closed (code-only)** | PR #83/#84/#85 CI artifacts and code merged; not a host acceptance |
| Lean evidence/CI | [#86](https://github.com/yiwssx/rcat-pos-system/issues/86) | See GitHub issue | [Rules, impact gates and register](LEAN-EVIDENCE-DELIVERY.md) |
| B — Staging deployment | [#81](https://github.com/yiwssx/rcat-pos-system/issues/81) | **Open** | Real RCAT IOT/RMS host capacity, DNS/TLS/OAuth/backup/restore/QR not verified |
| C — Policies/Acceptance | [#82](https://github.com/yiwssx/rcat-pos-system/issues/82) | **Open (partial approval)** | Owner approved C1 manual stock-on-accept and C3 Guest/Order p95 + RPO/RTO. C2 Offsite/cadence/retention still pending; B signoff not obtained |

Never rerun complete Nx/Database/Browser CI on RCAT IOT. Use prior CI evidence only where tested SHA and environmental boundary match. [Evidence register](evidence-register.json) contains historical CI proof and explicit missing Staging gates. Build only unique reviewed Staging release tags. G5 PromptPay remains LAST; G6/Production not approved.


## Owner-approved G4 execution — 9 November 2026
- [x] **C1** Manual Merchant sold-out and atomic ingredient stock consumption on Merchant acceptance; no checkout reservation/automatic sold-out.
- [x] **C3 targets** Guest menu p95 <=2.5 s, Order submit p95 <=3 s, backup RPO <=24 h and isolated restore RTO <=4 h. **Not measured** on RCAT IOT.
- [ ] **C2** Offsite destination, backup cadence/retention and permission to enable maintenance jobs remain **unapproved**. `RCAT_POS_BACKUP_POLICY_APPROVED=no`, `RCAT_POS_GUEST_RETENTION_APPROVED=no`.
- [ ] **B1–B6 #81** Operator host staging/HTTPS/OAuth/deploy/recovery/physical validation not executed. See [operator packet](G4-B1-B6-OPERATOR-RUNBOOK.md), [owner policy JSON](g4-staging-owner-policy.json), and read-only [evidence gate](../scripts/ops/g4-staging-acceptance.mjs). G4 acceptance is blocked until actual host proof and C2.
- [ ] **G5/G6** Payment and Production remain unstarted/not approved. No full local CI repeats on IOT.

## G4 decision update — 13 November 2026

- [x] Owner authorized **Staging-only preparation/deploy subject to existing real B1–B6 safety gates** and selected a **12-hour encrypted offsite backup cadence** (00:00 and 12:00 Asia/Bangkok) with **14 daily / 4 weekly / 3 monthly backup snapshots retained**. Existing timer stays *uninstalled*. No Restic pruning or application-record deletion approved.
- [ ] **C2 activation remains BLOCKED** until a real pre-existing approved offsite storage destination, cost/storage-capacity review, protected credentials, repository verification and isolated restore proof exist. Current Cloudflare R2 is not enabled; do not turn it on merely to get a green check. `RCAT_POS_BACKUP_POLICY_APPROVED=no` remains mandatory.
- [ ] **B1–B6 Operational Acceptance remains BLOCKED** until HTTPS/OAuth, protected DB role/secrets, verified pre-migration backup, actual staging deployment/health, restore timing, and owner/host acceptance. No Production, Payment, DNS, public SSH or new Host executor approved.

## HDA-06 signed OCI preparation — 13 November 2026

- [x] Added manual-only trusted-`main` four-component GHCR OCI publisher in the existing On-prem workflow; source policy and PR CI govern its admission. No new workflow file, Runner, SSH, cloud account, protected secret or Production change.
- [ ] **Publication/Operational Acceptance PENDING**: no owner-triggered signed image candidate has run, no four actual published digests or consumer-side attestations have been independently verified, and no real RCAT IOT B1–B6 deployment is accepted. Never promote signed source configuration alone to G4 PASS.
