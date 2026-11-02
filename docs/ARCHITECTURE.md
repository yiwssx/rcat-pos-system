# Architecture proposal — not yet implemented

## Code organization
Nx/pnpm Monorepo:
- apps/customer: Angular mobile-first guest ordering; evaluate SSR selectively for fast first view.
- apps/merchant: Angular PWA (CSR) for Orders, tables and administration.
- apps/admin: Angular CSR for platform operations.
- apps/api: NestJS modular monolith, HTTP adapter chosen after compatibility tests.
- libs: shared contracts, UI tokens, validation and API client; never ship privileged server rules to browsers.
- Database: PostgreSQL with migrations; queue/cache added when justified by durable event processing.

## Delivery boundary: Payment LAST
**Ordering, fulfilment, merchant dashboards, basic reports, security and staging first**. Defer all real PromptPay integration, merchant bank onboarding and payment webhooks until final functional milestone (#7). Production acceptance with real customer funds cannot occur until payment milestone and the following integrated security/recovery release gate pass.

The Order schema must be payment-ready without having to build Payment now:
- server authoritative \`order_id\`, \`tenant_id\`, \`store_id\`, \`amount_satang\`, \`currency=THB\`, immutable line-price snapshots and idempotency key;
- separate \`order_status\` and \`payment_status\` (early phases: \`not_requested\`, no fake \`paid\`);
- table session and Bill may group Orders, but the initial PromptPay obligation is **one per Order**, not per table or merged bill;
- interface/contracts for later payment-request/refund handling without creating a live adapter or QR payment flow during early milestones.

## Eventual Payment module (G5, after operational core)
- \`payment_requests\` reference \`order_id\`, \`store_id\`, merchant receiving configuration, server-authoritative \`amount_satang\`, request state, expiry and reference.
- \`payment_attempts\` and \`payments\` support retry, expiry, duplicate/late receipts and audit; do not assume a QR visually changes for equal amounts.
- Generate a payment QR **for each Order** only after successful Order creation.
- For personal PromptPay recipient + amount, bank-level reference and automatic receipt confirmation are **not** inherently available. Bill Payment merchant QR, provider-generated dynamic QR or another authorized provider may support unique references and server confirmation. Verify the provider's actual APIs and bank compatibility before choosing.
- Verify signatures/identity of webhooks, apply idempotency and reconciliation, and never trust client screenshots/redirects.
- Merchant financial destination is scoped to owning store and kept server-side; protect receiver identifier data as sensitive.
- For same-device customer checkout, support safe QR image save/import and approved deep links where provided.
- Web UI should show \`awaiting_payment\` / \`pending_verification\` until a trusted confirmation or explicitly authorized manual settlement.

## Domain boundaries
identity, tenants, stores, catalog, ordering/table sessions, Orders, Bills, fulfilment, merchant notifications, reporting, audit; **payments/refunds are an independently implementable module later**. A modular monolith is sufficient until evidence shows otherwise.

## Invariants
- All merchant-owned actions are authorized and scoped to tenant/store.
- Use database transactions, constraints and per-request idempotency.
- Use integer satang for authoritative money; avoid floating point.
- Transactional outbox/replay strategy for durable order notifications.
- Reconnect fetches server-authoritative Orders/acknowledgements; push is advisory only.
- Revocable guest QR sessions and protections against stale/abusive Order creation.
- Distinguish successful Order placement from successful receipt of money.

## Auth and operations
Secure HttpOnly same-site session cookies with CSRF protection, session rotation/revocation, role scopes, audit and rate limiting. Store all merchant and provider secrets outside git. Start with development/staging environments using mock payment interfaces only.

## Decisions pending verification
- CSR vs SSR for fast customer landing page.
- NestJS HTTP adapter compatibility.
- SSE vs WebSocket and whether queue/caching are justified by tests.
- Last-feature PromptPay provider/bank onboarding, whether settlement confirmation will be manual or API-confirmed, fees, references and regulatory suitability.
- Hosting, backup and production domains.

See docs/DECISIONS.md.
