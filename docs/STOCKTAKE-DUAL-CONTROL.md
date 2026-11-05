# G3 — Physical Stocktake with Two-Person Control (#9)

This increment adds independently reviewed inventory stocktaking before public
launch. It does **not** change guest checkout, Payment, PromptPay or the
`submitted → accepted` automatic Order stock allocation introduced in #58.

## Operational workflow

1. **Owner/manager opens** a count for exactly one ingredient:
   `POST /api/tenants/:tenantId/stores/:storeId/inventory/stocktakes`
   with `itemId` and an opaque UUID `idempotencyKey`. PostgreSQL locks
   the ingredient, records exact baseline `on_hand` and monotonically
   increasing `stock_version`, then writes an audit entry.
   One nonterminal stocktake is allowed per ingredient.
2. **Owner/manager/kitchen staff submits** a physical count, exact
   nonnegative NUMERIC(18,3) string and explanation (3–200 characters):
   `POST .../stocktakes/:stocktakeId/count`. Submission is immutable
   and idempotently replayable by its original counter with the same value.
3. **A different owner or manager** reviews:
   `POST .../stocktakes/:stocktakeId/review` with `{"approve":true|false}`.
   The original counter may never approve or reject their own submission.
   Rejecting closes the count without updating stock, including for stale
   counts. Approving locks the ingredient and requires the current
   `stock_version` to match the captured baseline.
4. An approved nonzero difference updates the live ingredient balance,
   creates exactly one immutable `stocktake_adjustment` movement linked to
   the stocktake and appends a separate approval audit event. Approving an
   unchanged physical count records an approval audit without inventing
   a zero-value inventory movement. Network retries return the existing
   review result and never change the stock twice.

Every live stock movement, including receipts, adjustments, automatic Order
consumption and cancellation returns, changes `stock_version` through a
database trigger. Even if the balance changes away and later returns to
the same number, a pending count becomes **stale**. Stale approval fails
409 with no stock changes; reject and start a fresh count. This is
optimistic version locking, not an "eventually reconcile" overwrite.

## Security and data model

- Migration `024_stocktake_dual_control.sql`:
  `inventory_items.stock_version`, `inventory_stocktakes` (immutable
  count and auditable review), per-item partial unique constraint, exact
  quantity checks, and a single stocktake-backed ledger movement.
- The staff Session determines tenant/store/role inside restricted
  SECURITY DEFINER routines. Runtime `rcat_auth`/`rcat_app` do not have
  direct SELECT or write grants on stocktakes. All POST routes require
  validated Origin, CSRF and live Session; all responses are `no-store`.
- No Client identity, role, staff ID, baseline balance, expected version or
  movement delta supplied to a mutation endpoint is trusted; PostgreSQL
  derives those values. A counted amount cannot be negative, a correction
  cannot exceed 1 billion units in a single movement, and stock cannot
  exceed the existing 1 trillion-unit cap.
- A separate `GET .../stocktakes` returns only the 40 most recent
  store-scoped counts. The Angular screen uses role-scoped navigation,
  explicit status, quantities, reviewer IDs and confirmation dialogs.
- The system requires **two distinct approved staff identities** for
  final approval. A single-staff shop cannot self-approve a stocktake.
  Staff invitation and offboarding must be configured before rollout.

## Coverage and outstanding gates

`tests/db/inventory-stocktake.sql` tests a 1000.125→975.500 exact
adjustment, duplicate opening/submission/review, unauthorized self-review,
rejection, zero-delta approval, false-stability stale version detection
(change +10 and −10), denied cross-tenant access and immutable audit.
`scripts/smoke-inventory.mjs` additionally exercises real HTTP CSRF,
Session, scoped list and denied self-review. Vitest verifies exact
decimal/UUID inputs and Angular BigInt preview.

Before Production: mobile Browser E2E with two real Workspace accounts,
lock contention under many concurrent Order acceptances/receipts,
stocktake retention and export, operational stocktake/cycle-count policy,
staff review escalation, backup/recovery, real proxy/HTTPS and accessibility
signoff. This is **single-item stocktaking**; no multi-location stocktake,
blind count, barcode scan, offline count queue or financial valuation is
claimed. Payment/PromptPay remains LAST, G5 (#7).
