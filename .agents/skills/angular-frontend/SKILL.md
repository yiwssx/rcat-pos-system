---
name: angular-frontend
description: Use when creating or editing RCAT POS Angular customer, merchant, admin views, UI states, PWA or accessibility.
---
# Angular Frontend — RCAT POS

Before work, read docs/PRODUCT.md and docs/ARCHITECTURE.md.
- Use Angular standalone components, strict TypeScript and Signals for local reactive state.
- Keep product/ordering UI mobile-first, keyboard accessible and responsive on tablet/desktop.
- Fetch the server-authoritative prices and payment/order states. Never calculate trusted checkout totals solely on the client.
- Lazy-load feature routes. Budget bundle size; measure first render on budget phones.
- Use reactive forms and accessible validation; ensure Thai text and currency formatting.
- Treat SSR as a route-level choice to benchmark rather than a universal default.
- Handle disconnected/reconnecting UI explicitly: re-fetch unacknowledged orders and do not treat a notification as delivery.
- No tokens or provider secrets in browser bundles. Use safe cookie-based auth and CSRF defenses as designed.
- Write component/unit/e2e tests for menu modifiers, cart, QR sessions, statuses, edge cases and a11y.
- Keep styles in the shared design system; no copying third-party visual assets or proprietary code.

