---
name: pos-ux-design
description: Design and critically review Thai-language QR self-ordering and mobile/tablet merchant POS workflows for RCAT POS, focusing on payment trust, real-time operations, accessibility and failure recovery.
---

# RCAT POS — Operational UX Design

**Read** `docs/PRODUCT.md`, `docs/DESIGN-SYSTEM.md`, `docs/ARCHITECTURE.md` and `references/personas-and-flows.md`. This skill is purpose-built for RCAT POS and overrides aesthetic/general guidance when usability or payment clarity is at stake.

## Personas and device priority
1. Guest ordering on a 320–430px phone with one hand, Thai-first language, variable bandwidth and no app or signup requirement.
2. Merchant accepting/fulfilling orders on a phone/tablet, sometimes using a single device while doing other tasks.
3. Manager reviewing tables, bills, staff, sales and reports on tablet/desktop.
4. Platform admin managing multiple tenants; tenant separation and audit visibility must be explicit.

## Deliverables for every new flow
- User goal, entry point, context (device/network), success path and at least 5 adverse paths.
- Wireframe or annotated layout with information hierarchy and interaction targets.
- States: idle, loading, disabled, empty, retrying, offline, failed, conflict and verified success.
- Thai text and error copy, accessible equivalents, keyboard and screen-reader behavior.
- Component token usage and visual regression plan.
- Evidence-driven tests at 320px phone, common phone, tablet landscape and desktop.

## POS-specific non-negotiables
- QR **ordering** vs QR **payment** are distinct; avoid ambiguous labels.
- Payment may be `awaiting_customer`, `processing`, `provider_verified`, `manual_confirmed`, `failed`, `refunded`; never present “paid” after only QR generation, a return redirect or screenshot.
- If guest pays on the same phone, show a legitimate save/open payment method supported by the provider; do not instruct users to scan their own screen.
- In postpay mode, ordering and billing remain separate, support repeat orders and bill reconciliation; split payment must show remaining amount.
- Stale QR, expired table session, unavailable menu item, changed price, lost network, duplicate submission, timed-out payment, guest leaving mid-checkout, order pending confirmation and merchant phone resuming must each have safe UI states.
- Merchant notifications are advisory. An order queue has a durable unread/unacknowledged state; reconnect always re-fetches.
- Prefer large tappable actions and readable order numbers; avoid auto-changing user selection due to real-time updates without explanation.

## Evaluation rubric
Score each flow 0–2 (missing/partial/verified) in: discoverability, efficiency, accessibility, payment clarity, error recovery, responsiveness, status consistency, cross-device continuity and safety. Do not call a screen production-ready without test evidence for critical payment and tenant states.

## Workflow with other skills
- `frontend-design`: deliberate visual direction, not imitation of the reference product.
- `design-system`: shared Angular component tokens, states and variants.
- `web-ui-review`: WAI/WCAG-style a11y and comprehensive UI review.
- `angular-developer`: architecture and implementation of tested components.
- `playwright-cli`: test guest and merchant user flows after runtime is installed.

ThaiQROrder is a **functional reference** only; do not copy its code, illustrations, trademarks or exact UI layouts.
