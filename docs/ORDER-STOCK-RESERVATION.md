# Explicit Order-Linked Ingredient Stock (G3 / #9)

This feature adds **optional product-level automatic ingredient consumption**
to the existing manual inventory ledger. Default: **OFF for every product**.
Previously submitted and historical Orders are not backfilled or deducted.

## Operational contract

- Each owner/manager explicitly configures a base ingredient recipe and
  reviews optional Modifier recipes before choosing **enable tracking** for a
  product. Enabling with no base recipe fails closed (409).
- Menu products not enabled remain 100% manual stock as before. A selected
  modifier with no configured ingredient components represents **zero extra
  usage**; configuring modifiers is a deliberate operator responsibility.
- An Order is always created in `submitted` state without any stock deduction.
  On the authorized `submitted → accepted` transition, a single PostgreSQL
  transaction acquires the Order row lock, locks all tracked product rows in
  UUID order (serializes recipe/config edits), then locks every required
  ingredient row in UUID order.
- Required quantity = (product base recipe + all selected Modifier option
  ingredient recipes) × **immutable Order line quantity**. Duplicate
  ingredients across multiple lines/options aggregate to one movement.
  The `option_snapshots` stored on the Order are authoritative: later changes
  to available options do not alter the historical Order.
- If **any** ingredient is short, missing, invalid, exceeds the ledger
  quantity cap or has no configured base recipe, the transition raises a
  conflict and **rolls back every stock mutation and the Order status**.
  There is no partially accepted Order or optimistic "accepted" frontend.
- A successful acceptance atomically writes each ingredient's new balance,
  a typed `order_consumption` movement, an immutable per-Order allocation
  quantity and an audit event. The existing status Audit and Outbox triggers
  still participate in the same transaction.
- `accepted → cancelled` returns exactly the quantities persisted in the
  original Order allocation, writes typed `order_return` movements and
  marks those allocations returned. Formula edits, opt-out, or altered Modifier
  metadata after acceptance **never** change what is returned.
- `submitted → cancelled` never moves stock; `preparing → served` does not
  move stock and, under existing workflow, Orders past `accepted` cannot be
  cancelled without a separate approved reversal policy.
- Existing Order status CAS + per-row locking makes repeated accept/cancel
  requests conflict rather than double-consume/double-return. The outbox
  remains the notification source; it never confirms Payment.

## Authorization

Read inventory: existing approved **owner, manager, kitchen** membership.
Configure tracked products and Modifier recipe components: **owner/manager
only** and exact tenant/store via restricted SQL SECURITY DEFINER routines.
Same-origin Session, Origin and CSRF are mandatory for PUT endpoints.
Runtime DB roles have **no raw ledger/table grants**. Composite foreign keys
prevent a product, Modifier, Order or ingredient referring across stores.

Endpoints added to existing Inventory API:

- `PUT /api/tenants/:tenantId/stores/:storeId/inventory/products/:productId/tracking`
  body `{"tracked":true|false}`
- `PUT /api/tenants/:tenantId/stores/:storeId/inventory/modifier-recipes/:productId/groups/:groupId/options/:optionId/items/:itemId`
  body `{"quantityPerProduct":"0.250"}` — `"0"` removes a component.

`GET .../inventory` adds `trackedProducts` and `modifierRecipes` and
returns mode `order_acceptance_opt_in` whenever ≥1 product is tracked.
Recent manual receipts/adjustments remain preserved, while automated
movements carry explicit `order_consumption`/`order_return` kinds.

## Remaining safety gates

- This is **commit-on-accept**, not a stock reservation at guest checkout.
  Multiple guests can submit Orders when ingredients are scarce; only orders
  that win acceptance are fulfilled. The Merchant Board must clearly show
  the shortage conflict and allow replenishment/retry.
- No automatic sold-out flag, recipe-version change approval, inventory
  reconciliation, waste/spoilage approval, negative-lot stock or tax valuation.
- Any return after `preparing`/`served` needs an explicit manager-approved
  exception and audit/refund policy; it is not enabled silently.
- Modifier ingredient mappings are optional. For allergen/food safety, recipes
  must be reviewed separately. Production signoff must include multi-device
  concurrent acceptance load tests and backup/restore on a separate staging DB.
- Payment/PromptPay is **not implemented** here and remains LAST in G5.

## CI

PostgreSQL test fixtures verify base+modifier exact consumption, frozen
returns after recipe mutation, default opt-out, CAS duplicate rejection,
insufficient shared ingredient rollback, replenishment and cross-tenant
permission denial. The test SQL is rolled back, leaving no production data.
