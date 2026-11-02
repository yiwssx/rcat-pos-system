# Product modifier groups and add-ons — G2, partial

## Scope
- PostgreSQL migration 010 adds store/product-bound `menu_modifier_groups` and `menu_modifier_options`, composite foreign keys, tenant-scoped FORCE RLS, and restrictive `rcat_auth` SECURITY DEFINER mutation APIs.
- A group has a unique slug within a product, a Thai-capable display name, `minSelect` (0–8), `maxSelect` (1–8), and `minSelect <= maxSelect`. Limits: up to 10 groups per product and 30 options per group to bound abuse.
- An option has a name, availability, and **signed integer** `priceDeltaSatang` from -100,000,000 to +100,000,000. Negative deltas represent a discount/reduction, not a negative price charged to the customer.
- Only Owner/Manager of the matching Tenant and Store can create groups, add options or toggle availability; session and membership are rechecked inside PostgreSQL. All actual changes are audited atomically.
- Existing merchant catalog snapshot now returns `modifierGroups` and `modifierOptions` arrays with foreign keys for UI mapping.
- Existing guest visit resolver returns modifiers only for available products and only available options, without requiring a customer account. It never exposes the database token digest.

## Merchant API

| Method/path (prefix `/api/tenants/:tenantId/stores/:storeId/catalog/products/:productId/modifier-groups`) | Purpose |
| --- | --- |
| POST `/` | Create group: `{"slug":"extras","name":"เพิ่มท็อปปิ้ง","minSelect":0,"maxSelect":2}` |
| POST `/:groupId/options` | Add choice: `{"name":"ไข่ดาว","priceDeltaSatang":1500}` |
| PATCH `/:groupId/options/:optionId/availability` | Enable/disable choice: `{"available":false}` |

All merchant writes require Origin, authenticated Session and CSRF. Product/group IDs from another store or Tenant do not pass foreign-key and scope checks.

## Deliberately incomplete / release blockers
The **Order Engine (#6)** must validate the selected option IDs and group constraints against a transactionally consistent catalog snapshot, ensure a final nonnegative total, impose an order total cap, and record immutable product/option names and satang deltas in each Order row. Displaying modifiers alone is **not** checkout validation.

Required-group availability can become invalid if too few options remain. Future guest ordering must block submissions for such configurations and tell the store to correct them; current guest resolver exposes the group rules but does not create Orders.

No images, permanent table QR challenge, public mobile Guest UI or Payment has been implemented. Public Production authentication remains disabled; `/api/ready` remains HTTP 503. **PromptPay per Order is G5, last.**

## Tests
PostgreSQL and HTTP integration cover signed satang, invalid min/max, duplicate groups, cross-tenant writes/read, role denial, sold-out product and unavailable option filtering, audit events, and CSRF.
