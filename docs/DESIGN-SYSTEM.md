# RCAT POS — Design System Brief (draft)

**Status:** Design guidelines, not an approved visual brand or implemented UI.

## Audience and product principles
Mobile-first Thai QR ordering with no sign-up, hardware-free merchant operations, and reliable financial status. Visual quality must support fast scanning, calm transaction feedback, and clarity under pressure.

## Three applications, one system
- **Customer:** touch-first, fast menu search/filter, clear modifiers, persistent cart/checkout, table context, minimal cognitive load.
- **Merchant:** high-density but legible order board, distinct order states, easy acknowledgement, resilient reconnect, tablet + phone layout.
- **Admin:** structured navigation, tables, filters, summaries, auditable actions; keyboard efficiency.

## Shared design tokens — to specify in EPIC #1/#2 before UI implementation
- **Primitives:** typography families supporting Thai, font sizes, line heights, spacing scale, radii, elevation, breakpoints, raw colors.
- **Semantic:** surface, foreground, muted, focus, primary, info, warning, danger, success, disabled, field errors.
- **Components:** product tile, category chip, modifier selector, quantity stepper, cart summary, table tile, order card, bill settlement panel, payment-state alert and dialog.
- Define token interfaces first; final palette/logo/typography must be approved separately.

## Interaction and quality bars
- Optimize for 320px phones through tablet landscape and desktop; avoid horizontal scrolling at default zoom.
- Target at least 44x44 CSS px for important touch actions, with adequate gaps; validate WCAG 2.2 guidance on target sizes and contrast with accessibility review.
- Prioritize visible focus, full keyboard path, semantic labels, no color-only error/status, Thai-friendly wrapping, readable currency/tabular numbers.
- Customer ordering should remain usable on slow mobile connections; measure load and interaction after Angular implementation.
- Every async action needs pending, failure/retry and explicit success behavior. Do not use optimistic **paid** states.
- Use no production customer or bank information in demos, recordings, screenshots or design files.

## Design gates
1. User journey and adverse-case review (issue #1)
2. Shared token and component inventory before screen coding (issue #2)
3. Wireframe review for customer/merchant/admin
4. Visual + keyboard/screenreader + mobile cross-device testing
5. Product security and payment status verification

## Use of public reference
ThaiQROrder informs core workflows and functional requirements. Visual designs must be independent and must not copy logos, screenshots or code. Sources/skills documented in docs/SKILLS.md.
