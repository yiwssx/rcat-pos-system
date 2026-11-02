# Ordering Tables and Per-Visit Tokens — G2 / Issue #4 (partial)

**Ordering QR is not a Payment/PromptPay QR.** This milestone creates table-specific, rotatable visit links but does not produce QR bitmap/SVG images, submit Orders, validate payments, or accept customer money.

## Mechanism
1. An authenticated **Owner or Manager** creates a table for a particular store.
2. Owner/Manager issues a new 256-bit visit token using POST `/api/tenants/:tenantId/stores/:storeId/tables/:tableId/rotate`.
3. PostgreSQL locks that specific table, revokes any existing visit, inserts the new digest-only bearer token record and appends `table.visit.rotated` to the tenant audit log in one transaction.
4. The API returns a **one-time visible Ordering URL** of the form `https://your-guest-site.example/order#token=<secret>`. The fragment is not transmitted in the HTTP URL. The Angular Guest app must read it, immediately remove it from browser history, and POST it to `/api/guest/ordering-visit/resolve`.
5. The resolve operation verifies the digest, table activity, expiry (6 hours) and non-revocation, then returns that store's safe public menu (excluding sold-out products), table label and visit ID. No Session cookie required for the Guest resolution.
6. Once the visit is rotated, the previous token is unusable. Multiple simultaneous rotations serialize on the table row.

## Endpoint access
- `POST /api/tenants/:tenantId/stores/:storeId/tables` — authenticated Owner/Manager, CSRF + exact Origin.
- `POST /api/tenants/:tenantId/stores/:storeId/tables/:tableId/rotate` — authenticated Owner/Manager, CSRF + exact Origin.
- `POST /api/guest/ordering-visit/resolve` — bearer visit token, allowed Origin, no login, returns store-specific public menu only. **No placing Orders**.

The trusted server environment must supply `GUEST_ORDER_BASE_URL`. It must be HTTPS (except 127.0.0.1/localhost in isolated CI). No client input may alter the destination URL. The token is not logged, not sent in URL query parameters and never stored in cleartext.

## Static QR vs rotating visits: important UX constraint
A **permanently printed static table QR cannot on its own prove that a new guest physically occupies that table**. These rotatable visit links require staff to display/print a new Ordering QR per visit, or an additional fresh table PIN/merchant-approval step. Do not represent a permanent printed QR as preventing reuse by previous guests. A stable/printed QR flow and rendering should be designed and tested before pilot; this PR implements only the rotating link/token foundation.

## Security + tests
- Real PostgreSQL tests: 256-bit hashed token constraints, tenant-aware FK/RLS, SQL role denial, cross-tenant rotation, revoked/forged/expired token rejection, multi-visit history, and serializable per-table rotation.
- Real HTTP tests: CSRF protection, duplicate table rejection, one-time token visibility in URL fragment, Guest public menu filtered for unavailable items, previous visit invalid after rotation, and removed-staff/cross-tenant denial.
- Public deployment remains **disabled by the current development-auth backend gate**. Distributed rate limiting, bot controls, visited-token abuse monitoring, customer frontend and Order placement are pending.
- `/api/ready` remains HTTP 503.

## Remaining Issue #4
QR artwork/rendering and printable table placement, stable QR + per-visit challenge design, option groups/add-ons and availability, product images and editing, table deactivate/archive, guest mobile UX and stale URL/scan/weak-network E2E. Order creation/snapshots are #6; PromptPay per Order remains G5.
