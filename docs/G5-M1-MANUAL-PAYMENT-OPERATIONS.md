# G5-M1 — Manual PromptPay Operations and Release Boundary

**Scope:** [Issue #7](https://github.com/yiwssx/rcat-pos-system/issues/7), [Draft PR #109](https://github.com/yiwssx/rcat-pos-system/pull/109). Release/physical Staging remains [Issue #81](https://github.com/yiwssx/rcat-pos-system/issues/81).

**Do not merge, deploy, enable a receiver, or accept real money merely because code or CI passes.** The existing order/stock/kitchen pipeline remains independent.

## What M1 does (and does not)

- A customer submits an **Order first**. The store sees it and may prepare/serve without Payment.
- When separately activated, an Order-specific tracking capability requests a PromptPay QR using the immutable server-sourced THB amount and the store's approved receiver.
- Customers may send a bounded image. A slip is **not proof of settlement**.
- An authenticated Owner/Manager opens a **private** image, checks the external **bank account's actual inbound transaction**, records the bank reference and exact amount, and explicitly confirms or rejects. `manual_confirmed` is **not** `bank_verified`.
- The independent Manual Finance view reports outstanding Orders, manual inbound confirmations, and outbound refunds recorded by staff. It also records under/overpayment, unmatched/late transfers, duplicated transfers and cancelled-after-transfer exceptions. **Nothing in these screens moves money**, verifies a bank through an API, produces an official receipt, or changes kitchen status.
- Refund request: `pending → manually_recorded | voided`. An Owner/Manager may request a refund only for an Order with a manually confirmed receipt; the sum of outstanding requests and recorded refunds cannot exceed that receipt. `manually_recorded` means staff checked an **external bank outgoing transfer** (amount and bank reference). A refund is **never automatic**.
- Exceptions are an auditable manual queue: `open → resolved`. Resolving an exception **does not** pay an Order or issue a refund.

## Fail-closed activation (operator-owned, not public API)

The code defaults to inactive. The operator must explicitly approve **all** relevant controls after Gate #81 is satisfied:

| Control | Required for | Default |
| --- | --- | --- |
| `RCAT_POS_PAYMENT_QR_RELEASE_APPROVED=true` | Order-specific QR | OFF |
| `store_promptpay_receivers.enabled=true` (DBA-only) | QR and slip intake; receiver ownership must be independently checked | FALSE |
| `RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED=true` | Guest PNG evidence intake (also requires QR flag) | OFF |
| `RCAT_POS_PAYMENT_FINANCE_RELEASE_APPROVED=true` | Manual refund / exception **writes** | OFF |

**There is no Merchant toggle to enable the receiver.** Changing the receiver disables it. Earlier unpaid QR snapshots must not re-expose an outdated receiver. Cashier/kitchen have no right to payment evidence, review, or finance ledger. Merchant writes require session, Origin and CSRF; guest evidence requires Order-specific Bearer and shared abuse budget. Invalid and cross-store actions are rejected by both API and SQL.

## Manual reconciliation procedure

1. In Merchant, select **กระทบยอดและคืนเงิน** for an authorized store. Use 7/30/90 days.
2. Compare the manual confirmed receipt **events** in that period to the store's bank inbound statement. Compare manual recorded refund **events** to bank outbound transfers separately.
3. For discrepancies: open an exception with the appropriate category, Order reference if known, amount, and a redacted explanation. Do **not** include card, account, national ID or raw bank reference in free text. Never silently reassign a transfer between Orders.
4. For a refund, confirm a valid Order/amount, create the pending request, make the **actual refund outside RCAT POS** using the Merchant bank, independently inspect the bank outflow, and enter its transaction reference and exact amount to record it. If no transfer occurred, void the pending request instead of marking paid.
5. For a cancelled Order with an already manually confirmed receipt, do not erase the receipt or mutate the Order price; follow the separate refund/exception process. Late/duplicate/partial transfers must be investigated manually.
6. Resolve exceptions with the actual investigation outcome and audit trail. Do not infer automatic settlement from closure.

**Metric meaning:** `orderTotalSatang` and `outstandingSatang` are **Order-creation cohorts**; `manualReceiptSatang` and `manualRefundRecordedSatang` are **bank-check record timestamps**. They can cover different Orders and must **not** be directly subtracted as the same cohort. `manualReceipt - manualRefundRecorded` is only a staff register of events, **not** bank balance or verified revenue. Summary sums are transmitted as decimal **strings** to preserve exact bigint satang. Item lists are bounded to 50 per section; summary aggregates use the full selected period. Pending refunds and open exceptions remain visible even outside that period.

## Evidence privacy and operator obligations

- Slips are private `bytea` inside PostgreSQL and therefore **also enter every relevant database backup**. Bounded PNG only, max 512 KiB (one Order has at most three attempts); no public file bucket or URL. The customer-side canvas attempts to strip source metadata; server validates CRC, structure, dimensions and inflated raster size.
- Bank transaction references are persisted only as **store-scoped digests**, not cleartext. Do not expose them or the actual slip in logs, Issues, screenshots or test fixtures.
- **No automatic retention purge or destructive restoration/purge script is authorized.** Before any real customer evidence: the owner must choose retention period and deletion trigger, backups/offsite retention/erasure scope, access-review and incident procedure under #81. A technically successful database backup may still be unacceptable if sensitive evidence is retained longer than approved.
- Freeze a non-money QA environment for CI and controlled browser checks. Test data must remain synthetic; no real bank receipts or live transfers in GitHub Actions or public artifacts.

## G4/G6 release acceptance (must remain OPEN until proven)

- [ ] Owner-approved retention/erasure and private backup/offsite policy, with demonstrated safe restore and disposal boundaries.
- [ ] Real RCAT IOT staging domain/TLS, Google Workspace access, allowed Origins, private databases/roles and backup checked by an authorized operator.
- [ ] Physical Android/iOS one-phone QR and slip flow, Desktop/Tablet Owner and Manager reviews, cancelled Order edge cases, concurrency/replay tests, responsive V6 Visual UAT.
- [ ] Verified receiver ownership and controlled real banking compatibility; explicitly approved limited live-funds pilot and reconciliation against the external bank.
- [ ] Exception/refund response, audit review and separation of manual confirmation from bank/provider verification understood and accepted.
- [ ] Independent explicit human G6 **go/no-go**, then signed release/controlled rollout and rollback plan. **Never infer this from a green PR/CI.**

## Implementation paths

`db/migrations/036–040`; `tests/db/g5-*.sql`; `apps/api/src/payments/`; `apps/customer/src/app/guest-track.page.ts`; `apps/merchant/src/app/payment-review.page.ts` and `merchant-finance.page.ts`. Review is part of **existing** #7; operator release remains in existing #81. No additional Issue, tracker or CI matrix is required.
