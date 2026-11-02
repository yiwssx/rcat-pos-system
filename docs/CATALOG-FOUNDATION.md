# G2 Catalog foundation — Issue #4 (partial, development only)

## Scope
- PostgreSQL migration 008: `menu_categories` and `menu_products` with composite foreign keys bound to **tenant and store**; category slug unique within the store; immutable IDs.
- Product prices are **integer satang** (`bigint` in PostgreSQL), not JS floating-point baht or client-authored Order totals. Product listing uses JSONB which returns safe numeric values while the catalog price ceiling stays below JavaScript's safe integer limit.
- Database-enforced **FORCE ROW LEVEL SECURITY** on both tables; the `rcat_app` role may only SELECT under its transaction-local tenant scope, and never INSERT/UPDATE/DELETE directly.
- Catalog writes happen only in narrowly granted `rcat_private` SECURITY DEFINER functions. Each operation rechecks a server-verified session digest and current tenant/store membership in the **same transaction**. Only Owner/Manager can mutate; Owner/Manager/Cashier can read, Kitchen cannot.
- Category/product creation and changes to product availability produce tenant-scoped audit events, with data mutations in the same transaction.
- No Guest-facing menu or ordering links are public yet.

## Development-only endpoints

| Endpoint | Permission |
| --- | --- |
| `GET /api/tenants/:tenantId/stores/:storeId/catalog` | Authenticated Owner/Manager/Cashier |
| `POST /api/tenants/:tenantId/stores/:storeId/catalog/categories` | Owner/Manager, Origin + Session + CSRF |
| `POST /api/tenants/:tenantId/stores/:storeId/catalog/products` | Owner/Manager, Origin + Session + CSRF |
| `PATCH /api/tenants/:tenantId/stores/:storeId/catalog/products/:productId/availability` | Owner/Manager, Origin + Session + CSRF |

Example create category: `{"slug":"thai-food","name":"อาหารไทย"}`.
Example product: `{"categoryId":"<UUID>","name":"ข้าวผัด","priceSatang":8900}`.
Availability: `{"available":false}`. Sold-out products remain in merchant views, never incorrectly advertised as available.

## Security and test evidence
- Real PostgreSQL integration tests: tenant-isolated reads, restricted direct writes, cross-tenant function denial, cross-store/category composite FK rejection, negative satang check, and sold-out mutation.
- Real HTTP tests: authenticated category/product CRUD subset, CSRF denial, duplicate slugs, fractional/negative satang rejected, unauthorized/removed staff denial and cross-tenant catalog isolation.
- Existing `/api/ready` continues HTTP 503 and public Production Login remains hard-disabled.

## Not yet implemented (Issue #4 remains open)
Category/product full CRUD and price editing, photos and storage, modifier/option groups and add-ons, merchant image management, tables, secure Ordering QR issuance/rotation, per-visit Guest sessions, Guest menu browser view, content moderation and E2E mobile tests. **No Payment QR or bank transactions**; PromptPay per Order remains strictly G5. Order price snapshots are a separate immutable concern in #6.

## Design rationale
Do not infer that price updates to a catalog should mutate existing Orders; the later Order engine must record an immutable product/option price snapshot in satang. Also, an Ordering QR identifies a table/visit and is not a payment receipt.
