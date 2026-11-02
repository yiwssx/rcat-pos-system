# RCAT POS — User journeys and scope baseline (G0)

Status: implementation baseline for #1 (product acceptance still subject to merchant pilot feedback).

## Personas
- Guest: scans store/table **ordering** QR, never required to sign in or install an app.
- Merchant Owner: creates shop, catalog, staff permissions and table ordering QR; monitors orders.
- Merchant Staff: accepts, prepares, serves, cancels/reviews orders within role scope.
- Platform Admin: oversees tenants and abuse with auditable least-privilege access.

## Initial functional vertical slices

### Guest order without payment (G2)
1. Guest scans **ordering** QR identifying store/table and session (not a bank QR).
2. Browser loads available menu, item details, modifier pricing and store identity.
3. Guest customizes cart, sees estimate; server revalidates availability and price.
4. Guest confirms; backend creates an Order ID and immutable amount snapshot with idempotency key.
5. Guest sees Order confirmation and tracking; no claim of payment success.
6. Merchant receives a durable notification and can accept, prepare and serve even after device reconnect.

### Merchant operations (G3)
1. Owner onboards store and staff with permitted roles.
2. Owner creates categories/products/modifiers, availability, table QR.
3. Staff sees new orders ordered by creation and acknowledgment status.
4. Staff accepts, prepares, serves or cancels with reason, permissions and audit.
5. Reconnect fetches all unacknowledged orders from backend; push/sounds are supplemental.
6. Owner sees operational counts and **ordered value**, never mislabeled as collected revenue.

### Per-Order PromptPay (G5 — deferred)
1. Order already exists with server-authoritative amount in satang, store and stable Order ID.
2. Backend creates a Payment Request for **this Order**, not the table.
3. User pays merchant's configured PromptPay destination via QR amount bound to Order.
4. UI shows pending until bank/provider confirmation or distinct merchant manual confirmation.
5. Retry/expiry/cancel/refund do not mutate original Order price snapshot.
6. Identical recipient+amount personal PromptPay payloads may be indistinguishable at bank level; automatic correlation requires verified provider capabilities. Do not claim otherwise.

## MVP inclusion
Tenant/shop onboarding; staff roles; menus/modifiers; static/rotating *ordering* QR; guest cart/order; table sessions; separate order/bill aggregates; durable realtime order board; operational reports; G5 PromptPay per Order; G6 payment/security pilot gate.

## Explicit non-goals
Native apps, obligatory hardware/printers, offline financial reconciliation, multi-order merged settlements/split bills, subscriptions, delivery fleet, full accounting and e-tax compliance automation.

## Platform boundaries
- Frontend never authoritative for totals, authorization, or payment state.
- One Order has one payable obligation in initial release, with multiple payment attempts allowed later.
- Many orders may share a table session and bill for display, but are not paid as one combined PromptPay request in first release.
- Real-money checkout is forbidden until #7, security and release tests are complete.

## Acceptance scenarios
- [ ] A new guest can order without an account from an active QR and see the correct table/store.
- [ ] An expired QR cannot add Orders to a previous customer's session.
- [ ] Double click/retry returns the same Order rather than creating duplicates.
- [ ] Menu price/stock changes during checkout result in explicit re-confirmation.
- [ ] Merchant sleep/reconnect does not lose unacknowledged orders.
- [ ] Order state and Payment state are visibly distinct.
- [ ] Cross-tenant access denied on every scoped API and query.
- [ ] Payments deferred until G5, no mock marked as real cash received.

Sources: docs/PRODUCT.md, docs/ROADMAP.md, docs/DECISIONS.md (ADR-006). Functional inspiration is publicly documented ThaiQROrder workflows; no third-party layouts, code, assets or branding are copied.
