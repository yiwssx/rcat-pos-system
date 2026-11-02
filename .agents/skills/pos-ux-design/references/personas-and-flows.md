# Personas, flows and adversarial states — RCAT POS

## Guest QR ordering
Entry: scan restaurant/table QR; resolve merchant and table session → show name/table and menu → select items/modifiers → cart with taxes/options → server priced review → create order with idempotency key → follow order and payment status.

**Adverse paths to design:** QR is stale/revoked, shop is closed, item sold out during checkout, price changed server-side, network drops before response, customer taps Place Order twice, payment pending after banking-app return, wrong billing account configured, partial/split payment pending, user resumes session hours later.

## Merchant mobile/tablet
Entry: resume PWA → authenticate/revalidate → fetch authoritative unacknowledged orders → accept/reject with reason → prepare/serve → manage table bills and payments → reconcile and close bill.

**Adverse paths to design:** phone asleep when order arrived, duplicate notification, simultaneous staff actions, kitchen delay, lost internet, changed table session, manual payment mistaken for verified, bill cannot close, refund pending, offline retry race.

## Platform admin
Entry: select tenant context → review account/merchant status → manage staff/support (least privilege) → view health/alerts → audit all privilege-sensitive actions.

## Screen inventory (MVP)
Customer: QR landing, category/menu list, item/detail/modifiers, cart, order confirmation, payment request/QR, payment pending and confirmed, order tracking, error/recovery.
Merchant: onboarding and shop setup, menu/availability, QR table management, live order board, order detail and actions, bill/payment management, staff permissions, basic reports.
Admin: tenant list/detail, account state, support/audit, usage/health, security incidents.

## Acceptance probes
- Can an unfamiliar guest complete an order without signing in?
- Is checkout amount confirmed by the server before payment?
- Does the UI tell verified payment apart from manual confirmation?
- Can a merchant find missed orders after reopening an app?
- Can staff safely handle double taps and unexpected network failures?
- Are order/table/customer identifiers protected from unauthorized access?
