# Merchant Operational Reports — G3 / Issue #9

These reports show **Orders placed and fulfilment operations, NOT money
received**. They do not read bank feeds, cash drawers, payment requests,
payment status or refunds and must never be presented as verified sales
revenue. PromptPay remains the final business feature G5 (#7).

## Access and scope

- `GET /api/tenants/:tenantId/stores/:storeId/reports/operations?day=YYYY-MM-DD`
- `GET /api/tenants/:tenantId/stores/:storeId/reports/operations.csv?day=YYYY-MM-DD`

Both endpoints require a non-revoked HttpOnly staff Session and an active
**owner or manager** membership in the exact tenant/store. Cashiers,
kitchen workers, other tenants and anonymous visitors do not see reports.
The access check runs inside PostgreSQL SECURITY DEFINER
`rcat_private.merchant_daily_operational_report` in migration 019; no
direct runtime grants on raw Order tables are broadened. Sensitive report
responses are `Cache-Control: no-store`.

## Semantics

- A business day is midnight to midnight in `Asia/Bangkok`, evaluated as a
  half-open `[start,end)` range against `orders.created_at`. This prevents
  UTC midnight errors. Dates are validated strictly and bounded to current
  Thai date + 1 day; no unrestricted all-time scan.
- Order counts come from server-stored immutable Orders, grouped by their
  **current** operational status. Thus reports are a live view of the
  creation-day cohort, **not** a historical as-of-day financial snapshot.
  The day an Order was placed never moves when it later changes state.
- `orderedAmountSatang` is the sum of **all Orders** (including cancelled).
  `activeOrderedAmountSatang` excludes cancelled Orders and
  `cancelledOrderedAmountSatang` is reported separately. These fields
  reconcile exactly; neither is a collected payment total. A cancellation
  never implies a refund.
- `servedOrderedAmountSatang` is the immutable snapshot amount for Orders
  now in `served` state. Serving does not imply bank or cash collection.
- `topProducts` counts non-cancelled Order line quantities and sums their
  immutable `order_items.line_total_satang`, not current catalog prices.
  Results are restricted to ten popular products. Reports cannot be used
  to infer future settled revenue. Modifier price adjustments are already
  included in immutable Order item totals.
- `avgSecondsToAccept` and `avgSecondsToServe` are the average elapsed
  wall-clock seconds from Order creation to the first respective audited
  transition, excluding Orders without that event. Null means no qualifying
  event; frontend does not label missing data as zero.

All aggregate satang amounts and unit counts are transported as decimal
**strings** to avoid IEEE-754 precision loss. Angular formats amounts with
BigInt into Thai THB display while remaining explicitly **not paid**.

## CSV security

The server exports after the same scoped authorization as JSON. CSV has
UTF-8 BOM for Thai Excel support, filename restricted to validated
`YYYY-MM-DD` business date, and full quoting of cells. Merchant-entered
product names starting with Excel formula characters `= + - @` (including
leading whitespace) are escaped by prefixing a literal apostrophe. Newlines
are normalized. CSV titles clearly state `ORDERED VALUE ONLY — NOT REVENUE`
and `Payment status: not_implemented`.

## Tests, rollout and remaining scope

- PostgreSQL fixture creates three Orders with identical immutable price:
  one served, one cancelled, one submitted. Verifies day-boundary, counts,
  active+cancelled monetary reconciliation, product aggregates, elapsed
  performance, owner access, cashier denial, wrong-tenant denial, forged
  Session and invalid dates. Entire fixture is rolled back.
- HTTP smoke validates owner-only JSON and CSV, unauthorized/malformed day
  denial, status reconciliation and no-store headers.
- API unit tests cover strict calendar validation and CSV formula injection;
  Angular unit tests cover Thai date shift and exact BigInt formatting.
- This is only the G3 **baseline reporting**. Missing before full #9 close:
  approved operational stock ledger/recipes, report period comparisons,
  configurable cutoff, privacy retention policy, end-to-end mobile browser
  report checks, query/load budgets, and any accounting/receipt logic.
  Actual payment-ledger revenue, reconciled refunds and settlement
  reports must be built **only after G5 Payment** and separately audited.

No changes permit real bank integration, public paid production or false
paid indicators. Infrastructure pilot and release gates remain open.
