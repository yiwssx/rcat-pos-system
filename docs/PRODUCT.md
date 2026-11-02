# Product requirements (draft, 2026-11-02)

## Vision
RCAT POS is a hardware-free, multi-merchant ordering/POS SaaS inspired by ThaiQROrder's publicly documented workflows, not a source/code or trademark clone. Merchants manage their own shops using mobile, tablet or desktop. Guests use a table/store QR to order and pay without an app download or registration.

## Actors
- Platform admin: tenants, operational support, global incident/audit.
- Merchant owner: shop onboarding, staff permissions, menu, QR, payment configuration, reports.
- Staff: scoped order management, preparation and optional manual payment confirmation.
- Guest: browse menu, customize items, order, pay, view status.

## MVP user journeys
1. Register merchant -> create store -> configure menu/options -> generate table/store QR.
2. Guest scans QR -> browse/search -> choose quantities and add-ons -> confirm server-calculated price -> submit order.
3. Store receives durable order notification and acknowledges, even after device sleep/reconnect.
4. Guest pays using merchant-supported method; server verifies provider payment or staff explicitly confirms manual payment.
5. Guest tracks accepted/preparing/served/complete status; merchant sees auditable bill/payment balances.
6. Owners review sales, payment status and staff activity on web/PWA.

## Business rules
- A table can have successive sessions; old sessions must expire or be revoked and cannot add new orders.
- Multiple orders can belong to a bill. Bills and payments are distinct, with explicit partial/split settlement support in the domain model.
- Support prepay and postpay as shop-level policies; prepay orders reach kitchen only after verified payment.
- Record snapshots of line-item names, modifiers, taxes/discounts and prices at the time of order.
- Refunds, voids and cancellations preserve the audit trail.
- No guest account required by default; protect QR links against abuse.
- Manual PromptPay is never labelled automatically verified.
- Payments go to merchants using an eligible payment provider; platform money flow requires legal review.

## Non-functional requirements / proof
- Responsive, accessible customer flow on budget mobile devices and slow connections.
- Tenant isolation is enforced server-side and covered by negative integration tests.
- Idempotent order submission and webhook handling; reconcile balances after retries.
- Zero silent loss of orders; reconnection and durable acknowledgement behavior.
- Secure sessions, CSRF protections, per-tenant authorization, backups and restore drills.
- Explicit privacy/retention policy and Thai payment/e-tax applicability review before launch.

## Out of scope for initial MVP
- Forced printer/terminal hardware; offline financial settlement; full accounting or tax invoicing engine.
- Native iOS/Android builds, delivery fleet, kiosks, payroll, loyalty and automated advanced inventory.

## Requirement tracking
See GitHub master tracker #13 and EPICs #1–#12. Scope and acceptance criteria should be reviewed in EPIC-01 before feature development.

