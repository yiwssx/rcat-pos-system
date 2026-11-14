# RCAT POS UI V6 — Spartan Angular + Official RCAT Brand (foundation history)

> **CURRENT:** This is the PR #105 foundation record. V6 screen design and Thai font must follow [UI-V6-POS-WORKBENCH.md](UI-V6-POS-WORKBENCH.md).
**Date:** 14 November 2026  
**Status:** Implemented foundation on isolated branch; Owner Visual UAT remains OPEN.  
**Work owner:** Existing UI/UX unified tracker #102 and master #13; no new Epic/Issue.

## Decision (do not install two systems)
- Use **spartan/ui 1.9.0** Brain on Angular 22 / Nx 24, with local RCAT-owned Helm-like styles and Tailwind CSS v4 tokens. Follow spartan's Angular-native accessibility and copy-owned styling approach.
- Keep **Zard UI** as a comparison reference only. Do not install React shadcn/ui, Zard, another router or a second form framework.
- Preserve Angular Customer/Merchant/Admin and NestJS APIs, role checks, static table QR, Order/Payment separation, Merchant inventory acceptance, and current deployment/runtime.
- Brand identity: orange #B94D1B, warm ivory #F7F5F1, gold as restrained accents, dark neutral text; green represents success only, not payment verification.

## Actual asset provenance
- Owner uploaded **RCAT_POS_System_512x512.png** (512px original), 14 Nov 2026.
- Repository stores an **optimized 96x96 WebP derivative** (`rcat-pos-logo.webp`) in the Customer, Merchant and Admin `public/` directories. The derivation is visually faithful but deliberately resized for small UI display; it is **not** a claim that the 512px original PNG is in Git.
- Customer/Guest Header, Landing/Login card, fallback Merchant/Admin shell and favicon reference the committed derivative. Reuse this official image; do not generate/reconstruct the college crest or fabricate alternate art.
- Existing PWA SVG icon is retained until a production-quality, correctly sized multi-resolution icon set is explicitly reviewed; avoid a 96px asset incorrectly advertised as a 512px maskable icon.

## Design architecture
1. `libs/ui/src/spartan-theme.css` defines the semantic color, radius, action and focus tokens.
2. Angular 22 apps share one PostCSS/Tailwind v4 setup; do not add a `tailwind.config.js` or run the CSS reset globally without Owner review.
3. `RcatButtonDirective` bridges the Spartan Brain `BrnButton` accessibility primitive to RCAT-owned presentation. Adopt only on key actions initially; keep Order forms and native Guest Dialog behavior stable.
4. Customer: meaningful brand, balanced Login/Workspace hierarchy and compact QR ordering.
5. Merchant: high-contrast instruction and delivery context, operational density, visible Order state and unaffected fulfilment.
6. Admin: compact panels/forms with the same spacing/radius/typography language.

## Evidence-aware acceptance
- Use existing changed-file Nx formatting/typecheck/unit/build, G4 Chromium HTTP ordering, Local Demo browser screenshots and staging packaging CI. Do not repeat database/host verification for styling-only changes.
- Existing screenshot suite must verify the committed logo actually loads, not just an `img` node in DOM. Inspect Owner UI at mobile widths (320px, 390px) and desktop (1365px) against V5.
- Visual UAT is a separate **OWNER decision**, not interchangeable with green CI.
- No production cutover, bank, PromptPay, host or DNS mutation. Keep G4 #81 and owner policy #82 open.

## Maintenance
- Pin Brain/CLI to the same minor version, re-run Tailwind/Angular checks only for affected code.
- The one-time dependency lock CI bootstrap is removed after the immutable pnpm-lock is generated and verified. No standing bot with write access is retained.
