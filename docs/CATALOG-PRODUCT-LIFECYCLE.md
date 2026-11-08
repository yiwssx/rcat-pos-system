# Merchant Catalog editing and archive (G2 follow-up #38)

## Delivery boundary

- `db/migrations/026_catalog_product_lifecycle.sql` introduces an
  `archived_at` soft-delete marker and monotonically increasing `revision`.
- Owners/managers can add categories and products, edit a product's name,
  category and **integer satang price**, toggle availability, and archive a
  product in the Angular Merchant mobile/tablet/desktop view.
- **Archiving is irreversible through ordinary Merchant APIs**: it sets
  `available=false`, preserves the original product UUID, inventory recipes,
  audit trail and preexisting immutable Order snapshot, and removes the
  product from the public Guest menu and future checkout.
- The database constrains `archived_at IS NULL OR available=false`. A prior
  availability route cannot reactivate an archived product.
- Every modified row serializes on `FOR UPDATE`; edit/archive operations
  require an exact `expectedRevision`. Stale requests fail with HTTP 409,
  instead of silently overwriting another merchant tab.
- A no-op edit does not increment revision or create an extra audit event.
  Updates and archiving emit owner/manager-attributed tenant audit records
  in the same transaction; restricted database roles cannot modify rows.
- Customer checkout stays server-authoritative and snapshots the current
  price. Editing a current product **does not reprice already submitted Orders**
  or mark them paid; Payment state stays `not_requested`.

## HTTP routes

All routes are scoped to `/api/tenants/:tenantId/stores/:storeId/catalog`
and require secure staff session, allowed Origin and CSRF for mutations.

| Method / suffix | Input | Response |
| --- | --- | --- |
| GET `/` | — | Categories, products, modifiers, product revision/archive metadata |
| POST `/categories` | `{slug,name}` | `{categoryId}` |
| POST `/products` | `{categoryId,name,priceSatang}` | `{productId}` |
| PATCH `/products/:productId` | `{expectedRevision,name,categoryId,priceSatang}` | Product fields, revision, changed |
| PATCH `/products/:productId/availability` | `{available}` | Product availability |
| POST `/products/:productId/archive` | `{expectedRevision}` | Product ID, archived, available, revision |

Only Owner/Manager may mutate. A Cashier may read but not modify,
and a Kitchen staff role is not authorized for the Catalog view.
There is no delete endpoint for product rows.

## Tests and explicit remaining scope

- SQL: tenant role/RLS, cross-store category denial, negative price/stale
  revision refusal, no-op, availability version bump, archived Guest hidden
  and unsaleable, retained archived Product FK, immutable old and new Order
  snapshots in satang, one update/one archive audit.
- Real API smoke: origin/CSRF and RBAC denial, price validation, stale edit
  HTTP 409, archive, cannot reopen, Guest menu exclusion and old
  Order-tracking continuity.
- Chromium mobile Merchant: category creation, product creation, edit and
  archive through Angular UI. Existing Customer/Order/Payment-not-requested
  Browser and HTTP tests continue unchanged.
- Existing G4 restore drill derives the expected migration count from the
  repository so a future migration does not silently invalidate backups.

**Not in this increment:** file uploads/object storage, product photo
validation, printable fixed QR + fresh visit challenge, menu search at large
scale, catalog history/archival restoration, kitchen stock reservation at
checkout, or real PromptPay Payment. These remain tracked under #38,
#5/#9 and the final Payment #7. No production deployment.

## G2 follow-up: Merchant Catalog local filters and paging (8 Nov 2026)

- The authorized Merchant Catalog snapshot can now be filtered by product name,
  category, and the existing archived visibility switch, with a 20-item page
  size and accessible previous/next navigation. Search/filter changes reset
  page number and close edits to avoid acting on an invisible item.
- Filter/paging behavior is tested with archived rows, Thai names, category
  combinations, empty results and page boundaries.
- This is **client-side display pagination**, not an API/database scalability
  guarantee: `GET /catalog` still downloads the whole scoped snapshot. A
  future server-side cursor/search API with tenant-aware limits and load tests
  is required before treating large-store performance as completed (#38).
- No changes to prices, order snapshots, inventory or Payment. No Staging or
  Production claim is made from this UI-only increment.


## G2 server-side keyset pagination (8 Nov 2026; #38)

- Merchant Catalog now requests only **20 product records per page** via authenticated
  `GET /api/tenants/:tenantId/stores/:storeId/catalog/products/page`.
  The existing full `GET /catalog` snapshot remains for legacy consumers.
- Database `rcat_private.catalog_products_page` enforces verified staff
  membership, tenant/store scoping, a hard limit of 50, bounded search and
  paired keyset cursor `(created_at,id)`, even for identical timestamps.
- Request filters: `search` (literal Thai/Unicode substring), `categoryId`,
  `includeArchived`, `limit`, `cursorCreatedAt`, `cursorId`.
  Response includes `products`, `categories`, page-specific
  `modifierGroups` and `modifierOptions`, `hasMore`, `nextCursor`.
- Frontend keeps cursor history to navigate back, resets the cursor on
  search/category/archive changes, and re-fetches authoritatively after mutation.
  Pending display edits cannot silently carry over between pages.
- SQL regression exercises a 45-product set, stable pages with shared creation
  timestamps, no duplicates, negative tenant tests, invalid cursors, category
  and Thai search, archived visibility, and hard page-size caps.
- **Scope limitation:** this is server-side keyset pagination for Merchant
  products, not for the anonymous Guest menu. Large-store page latency/soak,
  mobile scanner tests and operational staging signoff remain open. No Payment.
