---
name: payment-integrity
description: Use for PromptPay QR, payment gateways, webhooks, refunds, split bills, payment ledger or checkout flows.
---
# Payment Integrity — RCAT POS

**High risk: money must never be inferred from an untrusted client UI.**

- Distinguish STATIC ordering QR, payment-request QR and actual provider-confirmed payment.
- Manual PromptPay confirmation must be merchant-actioned and clearly labelled manual/unverified by provider.
- Do not use screenshot, bank redirect or browser callback alone as proof of settlement.
- Secure provider credentials server-side; verify webhook signatures; handle replay, retries and out-of-order delivery.
- Re-fetch provider source-of-truth where needed and reconcile amounts, currency, shop and order reference.
- Keep immutable payment attempt and ledger records; process refund and cancellation separately.
- Use satang integer amounts or precise decimals; explicit rounding rules and currency.
- Merchant onboarding, custody of funds, provider fees and regulatory requirements must be approved before live launch.
- Test duplicate webhook, fake webhook, partial/split payments, timeouts, refunds, mismatches and concurrent checkout.
- Do not enable real credentials or production payouts without explicit approval.

