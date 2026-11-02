# RCAT POS System — Agent Instructions

Read docs/PRODUCT.md, docs/ARCHITECTURE.md and docs/TRACKER.md before changes.

## Working agreements
- Follow an issue and open a pull request; do not implement unrelated features.
- Customer: Angular mobile-first website; Merchant: Angular PWA; Admin: Angular portal; API: NestJS + PostgreSQL.
- Use TypeScript strict mode, Angular standalone components and Signals where suitable.
- Do not pick a NestJS HTTP adapter purely from microbenchmarks; evaluate compatibility.
- Minimize new dependencies and keep feature boundaries explicit.
- All prices and payment status are server-authoritative. Use integer satang or explicit decimal money representation.
- Treat multi-tenant isolation, webhooks, QR sessions and payment/refund operations as security-critical.
- No real merchant secrets or private customer data in git, mocks, logs or screenshots.
- Implement and test idempotency, concurrency and failure recovery before considering payment flows complete.
- Never assume a client-side redirect/screenshot proves successful payment.
- No dedicated POS hardware requirement; printers remain optional.
- Avoid global CI rebuilding everything when affected-project checks can safely narrow the scope; retain security/schema checks for all changes.
- Do not deploy to production or connect live payment accounts without explicit approval and a pilot gate.

## Repository skills
Read matching SKILL.md under .agents/skills/ when modifying that area:
- angular-frontend: Angular customer, merchant and admin interface.
- nestjs-backend: API architecture and domain boundaries.
- payment-integrity: payment confirmation, refunds and ledger.
- tenant-security: tenant boundaries, auth and RBAC.
- ci-quality: development workflow, tests and secure CI.

Skills are repository-local agent instructions; they are not marketplace plugins or npm dependencies.

