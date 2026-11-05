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
