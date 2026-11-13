# Product requirements (draft, 2026-11-02; G5-M1 manual payment scope accepted 2026-11-13)

## Vision
RCAT POS is a hardware-free, multi-merchant ordering/POS SaaS inspired by ThaiQROrder's public workflows, without reusing proprietary source/design. Merchants operate from phone/tablet/desktop. Guests scan an **ordering** QR, submit an Order, then eventually pay using **a PromptPay payment QR created for that Order**. No dedicated POS terminal, printer, guest account or guest-installed app required.

## Actors
- Platform admin: tenants, operational support, global incident/audit.
- Merchant owner: shop onboarding, staff, menu, table QR, *future* per-store PromptPay receiving configuration, reports.
- Staff: manage orders/fulfilment; explicit manual payment confirmation only after Payment is implemented and authorized.
- Guest: browse menu, customize items, submit/track orders, *later* pay per Order.

## Development order (important)
1. Merchant registration and shop/tenant administration.
2. Menu, modifiers, availability, table/ordering QR.
3. Guest storefront, cart, server-priced Order creation and Order tracking.
4. Merchant realtime order board, kitchen workflow, table/bill administration, basic operational reporting.
5. Robust testing, staging, backup/recovery and security of the **ordering** system. Use test-only stubs if financial-state tests need them.
6. **Last functional feature (G5-M1):** per-Order standard PromptPay amount QR to each store's own receiver, customer slip upload, authorized Merchant checks incoming bank transactions and explicitly confirms/rejects, plus exception/manual refund audit; no bank/gateway API or auto-verification.
7. End-to-end release signoff and controlled Production pilot after payment functionality passes all tests.

## Separate QR codes
- **Ordering QR:** static or rotating link to store/table and an authorized guest session; not a bank payment payload.
- **Payment QR:** created only for a submitted Order, reflecting the immutable server-validated payable total in THB; payable to the configured merchant's destination.
- Payment QR is distinct by **logical Order/payment-request ID**. An ordinary personal PromptPay QR containing the same recipient/amount may generate identical payloads for equal totals and need not contain a usable Order reference. Do not claim that different visible QR images prove unique bank-level transaction identity.

## MVP user journey (after G5)
1. Guest scans table/store ordering QR → menu → cart → confirm.
2. Backend recalculates totals, stores immutable Order snapshot, assigns Order ID and exposes tracking.
3. Order reaches merchant's durable queue, independently of payment status (order acceptance policy is configurable later).
4. After Merchant accepts the Order (initial policy proposal subject to stock/fulfilment review), show a standard PromptPay amount QR for that Order and store receiver; same-phone UX offers saving/importing QR.
5. Guest submits a private slip; authorized Merchant personnel checks the actual bank account's incoming transaction and then explicitly confirms or rejects. Showing a QR or uploading a slip **never** proves receipt. Label confirmation **merchant-confirmed**, not bank-verified.
6. Merchant sees independent Order and Payment states, with audit history and recovery options.

## Business rules
- One Order has one payment obligation for its full total in the initial release; retries may create multiple payment attempts but should have one active payment request at a time.
- Each additional Order at the same table gets its **own** payable amount and QR; a Bill/table can aggregate Orders for operations but does not silently combine their payment requirements.
- Always use server-authoritative integer-satang totals and snapshots of line items/modifiers, taxes/discounts.
- Distinguish `order_status` (submitted, accepted, preparing, served, cancelled) and `payment_status` (not_requested, awaiting_payment, slip_submitted, under_review, rejected, manual_confirmed, expired, payment_exception); track manual refund requests/completions separately. `provider_verified` is future M2-only.
- Refunds, cancellations and corrections preserve financial audit history.
- Never treat a personal PromptPay target + amount or uploaded slip as bank-provided automatic reconciliation. Staff must check actual bank-account receipt. Bank/PSP integration is optional G5-M2, outside M1 #7.
- Payout/receipt destination belongs to each merchant through permitted onboarding/configuration; regulated money-flow and fee/legal assessment before launch.
- Guest session QR must expire/revoke safely; no account required by default.
- Cash/manual workflows can exist as demo or separately scoped checkout policy, but do **not** simulate automatic PromptPay confirmation for production users.

## Non-functional requirements / proof
- Mobile performance, Thai accessibility and weak-network recovery.
- Strict server-side tenant/store isolation and negative authorization tests.
- Idempotent Order submission, payment-request creation, slip upload and manual review/confirm/reject with concurrency tests (provider webhook processing is not implemented in M1).
- No silently lost Orders; retrieve unacknowledged queue after device reconnect.
- Secure sessions, CSRF, audit logs, backups and restore exercises.
- Privacy/data-retention, Thai payment-service and receipt/tax obligations reviewed before public launch.

## Out of scope for initial release
- Forced POS terminal/printer, offline settlement, full tax invoicing/accounting.
- Native apps, delivery fleet, kiosk, payroll, advanced inventory, subscription billing.
- Automatic split payments or merged payment across many Orders unless decided as separate work.

## Requirements tracking
Master tracker #13. Product/ordering #1–#6, #8–#10; deferred manual-first payment #7; pilot #11. See [M1 detailed requirements](G5-M1-MANUAL-PROMPTPAY.md), docs/ROADMAP.md and docs/DECISIONS.md.
