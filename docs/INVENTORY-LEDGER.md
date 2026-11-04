# Inventory Ledger and Recipes — G3 / #9

RCAT POS now has an **operational, manually maintained ingredient stock ledger**
that is scoped to each tenant and store. It is deliberately **not** an
automatic stock-allocation system, accounting ledger or Payment subsystem.

## Model and exact quantities

Migration `022_inventory_ledger_recipes.sql` introduces:

- `inventory_items`: unique ingredient names for a store, `g`, `ml` or
  `unit` units, a current exact `NUMERIC(18,3)` quantity and reorder level.
  New ingredients always start with **zero** balance.
- `inventory_movements`: immutable receipt or signed adjustment records,
  before/after balances, reason, actor, timestamp and a unique
  `(tenant_id,store_id,idempotency_key)`. Every change locks the ingredient
  row and rejects a negative balance. A replay with exactly the same key and
  payload returns the original movement without changing stock or duplicating
  audit; a conflicting replay fails.
- `inventory_recipe_components`: store-scoped association of an existing
  menu product and ingredient with an exact quantity required for one product.
  Setting quantity to `0` removes that ingredient from the recipe.

Decimal quantities travel over JSON as **strings**, validated at the NestJS
edge and once again in PostgreSQL. Angular uses BigInt scaled to thousandths
for display and low-stock warnings. There is no JavaScript floating-point
authority over inventory balances.

## Auth, tenancy and privacy

- `GET /api/tenants/:tenantId/stores/:storeId/inventory`
  reads a bounded recent 50-movement history, ingredients and recipes for
  an authorized owner, manager or kitchen staff member.
- `POST .../inventory/items` creates an ingredient (owner/manager only).
- `POST .../inventory/movements` records a receipt or manual adjustment,
  with exact quantity, reason and a cryptographically random UUID idempotency
  key (owner/manager only).
- `PUT .../inventory/recipes/:productId/items/:itemId` creates, changes
  or deletes one per-product ingredient quantity (owner/manager only).

Every mutation requires existing **Session, Origin and CSRF** defenses and
executes in a transactional PostgreSQL SECURITY DEFINER function that checks
the exact tenant/store/role. The runtime authentication roles have **no**
direct table grants; composite foreign keys prevent linking products or
ingredients belonging to another store. Changes append an audit event, but
no client controls actor IDs. The frontend role check is only UX; not a
security boundary.

## Critical limitations

**NO automatic Order consumption** is performed by this foundation. A QR
Order, fulfilment transition, cancellation or Bill currently leaves stock
untouched. Recipes describe planning intent only. Before adding automatic
decrement or low-stock sellout rules, a separate reviewed transaction must
cover multi-ingredient locking order, idempotent Order reservations,
cancellations/returns, shared stock across concurrent checkout devices,
modifier-specific recipes, inventory shortage policy and eventual consistency.

There is no stock valuation/cost of goods, purchase-order integration,
adjustment approval workflow, multi-store stock transfer, supplier
management, expiry/lots, recipe versioning, stocktake reconciliation or
payment/settlement accounting. The current ledger is **manual and
operational**, not suitable for posting audited financial statements.

## Tests

- `tests/db/inventory-ledger.sql`: creates a scoped ingredient, receipts
  2000.125 g, verifies replay does not duplicate an audit or mutate balance,
  adjusts -100.125 g, rejects negative balance, checks recipe 125.500 g
  preserves balance and zero removes recipe, verifies cross-tenant foreign
  item rejection, cashier denial, forged session rejection and no raw writes.
  Test fixture is rolled back.
- `apps/api/src/inventory/inventory.core.spec.ts`: rejects JSON
  floating-point, exponential/overprecision, negative receipts, malformed
  UUID keys, missing reasons and invalid recipe values.
- `scripts/smoke-inventory.mjs`: isolated CI-only NestJS HTTP test of
  Session/CSRF, replay, conflict, precise balance, recipe creation/deletion
  and other-tenant denial. Runs **after** legacy audit-count smoke tests.
- Merchant Angular tests cover BigInt precision, low-stock thresholds,
  strictly typed quantity input and lazy route loading.

Before production: add a finite item quota/pagination, high-volume
concurrent stock-change and recipe stress tests, low-bandwidth Browser E2E,
item/stocktake permissions review, audit retention and staged rollback/
backup exercises. Real OAuth/production auth and API readiness gates
remain blocked. **Payment/PromptPay per Order stays LAST G5 (#7).**
