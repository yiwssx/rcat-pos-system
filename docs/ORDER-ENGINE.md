# Guest Order Engine — G2 / Issue #6 (first transactional slice)

**The system creates independent Orders and operational Bills, but no payments.** Each Order remains a separate future payment obligation, and its `paymentState` is constrained to **`not_requested`**. Bills group Orders for the merchant only; no PromptPay, settlement, bank account information, webhooks or invoices are implemented.

## Guest API

`POST /api/guest/orders` (development-gated application only).

Required request headers: `Origin` (must exactly match the server allowlist), `Content-Type: application/json`, and `Idempotency-Key: a-new-unpredictable-retry-stable-key` (16–96 characters, letters/digits/underscore/hyphen). Generate a new UUID-style key for **every new intentional checkout**, keep the same key for network retries and double taps. Do not reuse a key after changing cart contents.

Body:
```json
{
  "visitToken": "<256-bit active visit bearer token>",
  "items": [
    { "productId": "<UUID>", "quantity": 2, "optionIds": ["<UUID>"] }
  ]
}
```

The server ignores any client-supplied prices, money totals, payment status or tenant IDs. It validates up to 20 lines, 100 total units, each quantity 1–20, and at most 32 selected option IDs per line, with no duplicates. It canonicalizes IDs and option ordering for deterministic idempotency comparisons.

Response (HTTP 201 for new and repeated submissions):
```json
{
  "orderId": "<UUID>",
  "amountSatang": 20800,
  "currency": "THB",
  "status": "submitted",
  "paymentState": "not_requested",
  "replayed": false,
  "trackingToken": "<256-bit order-scoped bearer token>"
}
```

## Database transaction

- PostgreSQL migration `011_guest_orders.sql` introduces `orders` and `order_items` with tenant/store foreign keys, separate Order and visit IDs, `THB` currency, explicit payment state placeholder, immutable price/name/option snapshots.
- The single SECURITY DEFINER `place_guest_order` routine checks a fresh hashed visit token, active table, expiry and non-revocation. A table row is locked **FOR SHARE** to serialize with staff rotation's **FOR UPDATE**, preventing check-then-rotate races.
- A unique index on `(visit_id,idempotency_key)` serializes simultaneous retries across replicas. The same normalized cart returns the existing Order; a changed cart with the same key returns HTTP 409.
- PostgreSQL selects active product, option and group rows under read locks, enforces per-group min/max cardinality, disallows duplicate/wrong-store/disabled options and unavailable products, calculates signed integer-satang unit totals and line totals, rejects nonpositive and excessive totals, then inserts snapshots and aggregate total in one transaction. Any validation failure rolls the entire Order back.
- Roles `rcat_auth` and `rcat_app` do not gain direct Order mutation grants. `rcat_app` has tenant-scoped read-only RLS; Guest API can only call the specific scoped SQL routine.
- Merchant fulfilment and Guest Tracking are separate authenticated/capability-scoped increments; no automatic payment confirmation or guest order-listing endpoint is available.

## Verified in CI

Real PostgreSQL and HTTP integration tests exercise required modifier groups, duplicate and unavailable choices, wrong-store product IDs, sold-out products, server-calculated satang amounts, stored snapshots, concurrent five-request HTTP retries, cart mismatch conflicts, stale table visits, missing Origin, required idempotency key and cross-tenant RLS.

## Release blockers / next Issue #6 increments

- Merchant inbox and basic transitions are available in development; merchant realtime, exceptional cancellation workflow and recoverable notifications remain pending.
- Separate Bill model/aggregate and independent Order obligations, full status-event history, conflict handling and reliable notifications.
- Distributed abuse/throttling protections for Guest endpoints, checkout replay retention/expiry policies, operational monitoring and E2E with mobile clients.
- Strict release guard remains: development Authentication cannot run in production and `/api/ready` stays 503.

**Ordering QR** is a table visit token. **PromptPay QR per Order** remains the final G5 milestone (#7).

## Merchant fulfilment API (second G2 increment)

This development-gated API provides a durable merchant Order inbox and
role-authorized status transitions, **not real-time delivery or payments**.

- `GET /api/tenants/:tenantId/stores/:storeId/orders?status=submitted&limit=25`
  uses a valid merchant session (owner, manager, cashier or kitchen).
  It returns the latest 1–50 Orders and their immutable priced item/option
  snapshots. The optional `status` filter accepts `submitted`, `accepted`,
  `preparing`, `served` or `cancelled`. Cursor pagination and notifications are not implemented yet.
- `PATCH /api/tenants/:tenantId/stores/:storeId/orders/:orderId/status`
  requires an allowed Origin, session cookie and matching CSRF cookie/header.
  Request body: `{"expectedStatus":"submitted","nextStatus":"accepted"}`.
  A stale expected status produces HTTP 409, an unauthorized, foreign or
  invalid state transition produces HTTP 404. No direct Order write grants
  are given to application or authentication roles.

Allowed state changes:

| From | To | Authorized roles |
|---|---|---|
| submitted | accepted, cancelled | owner, manager, cashier |
| accepted | preparing | owner, manager, kitchen |
| accepted | cancelled | owner, manager, cashier |
| preparing | served | owner, manager, kitchen |

`served` and `cancelled` are terminal in this increment; cancelling a
preparing/served Order requires a separately designed exceptional workflow.
The SQL function takes a row lock, compares the expected state, updates one
Order and appends an actor-attributed `order.status.changed` audit event
within the same transaction. Neither the amount, immutable items nor
`payment_state='not_requested'` may change. All Order and table identifiers
remain tenant/store scoped. These development APIs must not be enabled for
real customers before production auth, throttling and operational gates.

**Still open in Issue #6:** full status history read endpoint,
per-Order future payment obligation design, merchant notifications,
outbox/realtime, operational recovery and full role-specific UIs.
**Payment QR per Order remains G5 / Issue #7.**

## Guest Order Tracking (third G2 increment)

Every new checkout now returns `trackingToken` alongside the Order ID and
server-calculated amount. It is a separate, 256-bit **bearer capability for
one Order only**, not a table QR or payment QR. Use a cryptographically
random, retry-stable `Idempotency-Key` for **each** intentional checkout
(e.g., `crypto.randomUUID()` in the Angular client). This key must remain
private; low-entropy values weaken tracking security if a table visit secret
is shared. The backend derives a deterministic HMAC-SHA256 tracking capability
from the visit secret and idempotency key. Concurrent/repeated checkout calls
receive the *same* capability. Only SHA-256 of the decoded capability is
stored in `orders.tracking_token_digest`; neither raw guest credentials nor
table visit tokens are stored there.

**Read status:** `GET /api/guest/orders/:orderId/status`

Send `Authorization: Bearer <trackingToken>` (not cookies, URL query, URL
fragment, or table QR token). The endpoint returns only
`orderId`, `status`, `paymentState`, `amountSatang`, `currency`,
`createdAt`, and `updatedAt` with `Cache-Control: no-store`.
A missing/incorrect token or another Order's ID returns the same HTTP 404.
The token remains valid for that Order when the table visit is rotated,
and does not permit new checkout or access to a different Order.

The backend calls `place_guest_order` and
`bind_guest_order_tracking` in the **same DB transaction**. The digest
bind is write-once and idempotent; an incompatible bind aborts the
transaction. Historical Orders submitted before migration 013 have no
capability; they cannot be read from this endpoint unless the original
checkout is replayed while its visit is still active. No backfill creates
weakened guest tracking rights.

**Security / release blockers:** The capability is sensitive. The guest UI
must keep it out of URLs, logs, analytics, screenshots and localStorage; use
in-memory state or carefully designed session-scoped recovery. A client-side
cryptographic key generator, distributed throttling, retention/revocation
policy and same-device browser E2E must be reviewed before public deployment.
Guest status is not a payment receipt: `paymentState` remains
`not_requested` until the final G5 Payment module is implemented.

## Operational Bills: one Table Visit, many independent Orders (G2 increment four)

Migration `014_operational_bills.sql` introduces `rcat.bills` with a strict
composite reference to a single `table_ordering_visits` row. One visit can
have at most one Bill. An Order is associated **by its original, immutable
`visit_id`**, not by adding a mutable Bill assignment or changing its amount.
Later Orders placed during the same visit appear in that Bill automatically;
an old Bill never absorbs Orders from the next rotated table visit.

Merchant session endpoints (development-gated):

- `POST /api/tenants/:tenantId/stores/:storeId/bills`: body
  `{"visitId":"<UUID>"}`. Only owner, manager and cashier may create a
  Bill, and only for a visit that already has an Order. Requires allowed
  `Origin`, session cookie and CSRF header/cookie. Concurrent repeats
  return the **same** `billId` and `created:false`; only the first
  creation writes a `bill.operational.created` audit event.
- `GET /api/tenants/:tenantId/stores/:storeId/bills/:billId?limit=50`:
  owner, manager, cashier and kitchen may view. Returns `billId`,
  `tableId`, `visitId`, `orderCount`, `orders`, `hasMore`,
  `currency:THB`, `createdAt`, and two separately computed numbers:
  `operationalTotalSatang` (non-cancelled Orders) and
  `cancelledTotalSatang` (excluded Orders). The bounded list
  (1–50 items) may be truncated; aggregate totals and `orderCount`
  always cover **all** Orders in the visit.

Merchant Order inbox now includes `visitId` on each entry for identifying
the correct Bill. The server recomputes Bill aggregates from immutable
Order snapshots without accepting a client-entered price or altering
Order payment states. The Bill does **not** have a payment state or a
bill-wide payment QR. A cancelled Order's amount is separated only for
operational reporting; this is neither a refund nor proof of settlement.
**Each Order still owns its future PromptPay payment request at G5.**

Rights are enforced by PostgreSQL security-definer functions and
`bills` FORCE RLS. The authentication role cannot insert directly;
unauthorized or foreign visits/Bills return generic 404 responses.
Creating Bills does not deactivate visits, close tables, take payment,
or freeze additional same-visit Orders. A Bill can therefore change as
new Orders arrive or statuses move. Cursor pagination, bill closure,
table release, order-level financial obligations and merchant realtime
remain separate follow-up work. Database/HTTP tests exercise role and
tenant isolation, idempotent concurrent creation, cancellation, RLS and
preservation after QR visit rotation. Production remains blocked.
