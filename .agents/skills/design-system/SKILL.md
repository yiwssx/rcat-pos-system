---
name: design-system
description: Build and maintain RCAT POS Angular design tokens, component specifications, responsive patterns, typography and component state behavior.
---

# RCAT POS — Design System

Read `docs/DESIGN-SYSTEM.md` first. Use the license-attributed design-token references in this folder. This is a **project adaptation** of NextLevelBuilder's token architecture (not the complete upstream skill; upstream scripts/slides are intentionally excluded).

## Three-layer tokens
- Primitives: raw hue/spacing/type/radius/size values, independent of the component.
- Semantic: surface, foreground, muted, primary, success, warning, destructive, focus and states.
- Components: QR card, menu item, modifier, cart, order status, table tile, payment panel, dialog, sidebar.
- Use semantic design tokens in Tailwind CSS and Angular component styles. No unreviewed hardcoded hex/spaces in individual feature screens.

## Specifications before code
For every UI component, document: purpose, persona, responsive variants, touch/keyboard behavior, required accessibility labels, loading/disabled/empty/error/optimistic states, localization, privacy and transaction behavior.

## Mandatory design patterns
- Phone 320–430px first for guest QR ordering; tablet landscape for merchant order board; desktop for admin.
- Thai-first typography and stable monospaced/tabular numbers for bill amounts.
- Status changes must not be color-only; checkout must distinguish **initiated**, **pending**, **verified**, **manual-confirmed**, **failed**, **refunded**.
- Visual design must not obscure buttons or order numbers. Payment provider verification always comes from backend.
- Design tokens support light/dark only if both are tested; do not blindly promise dark mode.
- Define min 44px touch targets in operational flows unless exceptions are specifically audited.

## Workflow
1. Translate user journeys into content hierarchy and interaction flow.
2. Specify primitive/semantic/component token scales from the references.
3. Create wireframes, then component specs and interactive states.
4. Run a visual, a11y, screen-size and transaction-state review using `web-ui-review` and `pos-ux-design`.
5. Validate consistency across all three Angular apps; document approved changes as tokens and component specs.

Never execute upstream scripts without review or use its slide-related assets: they are out of scope for RCAT POS.
