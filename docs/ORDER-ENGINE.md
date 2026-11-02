# Guest Order Engine — G2 / Issue #6 (first transactional slice)

**This implementation creates Orders, not Bills or payments.** Every Order represents a separate future payable obligation; its `paymentState` is a database-constrained **`not_requested`** placeholder. No PromptPay, payments, settlement, bank account information, webhooks or invoices are implemented.

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
  "replayed": false
}
```

## Database transaction

- PostgreSQL migration `011_guest_orders.sql` introduces `orders` and `order_items` with tenant/store foreign keys, separate Order and visit IDs, `THB` currency, explicit payment state placeholder, immutable price/name/option snapshots.
- The single SECURITY DEFINER `place_guest_order` routine checks a fresh hashed visit token, active table, expiry and non-revocation. A table row is locked **FOR SHARE** to serialize with staff rotation's **FOR UPDATE**, preventing check-then-rotate races.
- A unique index on `(visit_id,idempotency_key)` serializes simultaneous retries across replicas. The same normalized cart returns the existing Order; a changed cart with the same key returns HTTP 409.
- PostgreSQL selects active product, option and group rows under read locks, enforces per-group min/max cardinality, disallows duplicate/wrong-store/disabled options and unavailable products, calculates signed integer-satang unit totals and line totals, rejects nonpositive and excessive totals, then inserts snapshots and aggregate total in one transaction. Any validation failure rolls the entire Order back.
- Roles `rcat_auth` and `rcat_app` do not gain direct Order mutation grants. `rcat_app` has tenant-scoped read-only RLS; Guest API can only call the specific scoped SQL routine.
- Exposed order status is `submitted`; no merchant accept/prepare/serve transitions yet. No guest status token or order listing endpoint yet.

## Verified in CI

Real PostgreSQL and HTTP integration tests exercise required modifier groups, duplicate and unavailable choices, wrong-store product IDs, sold-out products, server-calculated satang amounts, stored snapshots, concurrent five-request HTTP retries, cart mismatch conflicts, stale table visits, missing Origin, required idempotency key and cross-tenant RLS.

## Release blockers / next Issue #6 increments

- Merchant order inbox, authorized state transitions and role-specific acceptance/preparing/served/cancellation with audited event log.
- Separate Bill model/aggregate and independent Order obligations, status history, guest status access, conflict handling and reliable notifications.
- Distributed abuse/throttling protections for Guest endpoints, checkout replay retention/expiry policies, operational monitoring and E2E with mobile clients.
- Strict release guard remains: development Authentication cannot run in production and `/api/ready` stays 503.

**Ordering QR** is a table visit token. **PromptPay QR per Order** remains the final G5 milestone (#7).
