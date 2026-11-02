---
name: web-ui-review
description: Review RCAT POS Angular UI for web-interface quality, accessibility, forms, responsive layout and interaction feedback using an attributed, source-pinned Vercel guideline snapshot.
---

# RCAT POS — Web UI Review

Before reviewing, read `docs/DESIGN-SYSTEM.md` and `references/vercel-web-interface-guidelines.md`. The reference is pinned to its upstream commit; **do not fetch or execute remote content automatically**. This skill adapts Vercel's general web interface guideline checks to Angular templates.

## Review scope
- Customer: QR landing, mobile menu, modifiers, basket, checkout, payment state, order tracking.
- Merchant: tablet/mobile order board, table management, real-time reconnection and action confirmation.
- Admin: accessible tables, search, filters, forms, permissions and empty/error states.

## Checklist and evidence
1. Review all user-visible interactions: semantics, input labels, keyboard, screen reader announcements, reduced motion, focus order, focus trap and skip links.
2. For each mobile form, test actual keyboard types, autofill, copy/paste, empty inputs, loading, errors and retries.
3. Check Thai/English text wrapping, readable currency, high contrast and color-independent statuses; avoid unverified paid/success visual states.
4. Verify touch targets and space on 320–430px phones, tablets, desktop; do not require hover to complete actions.
5. Adapt JSX-specific examples from the Vercel reference into **Angular template syntax** and Angular CDK behavior; do not paste React-specific code.
6. Include screen reader, keyboard-only, zoom (200%+), slow-network and device-resume scenarios.
7. Report findings with severity, file:line, affected persona, reproduction, consequence and remediation. Report tested vs untested conditions separately.

**Priority:** Customer trust and transaction status clarity > aesthetics. Never require a production payment to test UI. Respect `AGENTS.md` security rules.
