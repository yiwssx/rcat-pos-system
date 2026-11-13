# RCAT POS — Visual Design V5 (13 November 2026)

## Purpose
The owner explicitly rejected the earlier visual result despite successful tests:
the product still looked unattractive. Passing CI never implies visual acceptance.
This is a **visual-design slice**, not a change to operational ordering logic.

## Reference-informed principles
- [Square POS redesign](https://squareup.com/us/en/the-bottom-line/inside-square/square-pos-redesign): controlled item hierarchy, clear active primary action and a calm neutral canvas.
- [Shopify POS smart grid](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/customize-pos/smart-grid-management/edit): coherent component scale, restrained surface language and device-specific preview.
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/): predictable typography, alignment, spacing, and familiar hit targets.
- These are references, **not licenses to copy artwork, UI screenshots, logos, code or layouts**. RCAT's orange identity remains unique.

## Visual foundation
1. **Palette:** warm neutral canvas #f5f5f3, white working surfaces, charcoal text #202c34 and deep teal #21383d, RCAT orange #b94d1b reserved for primary actions and selection. Dark accents are not payment indicators.
2. **Type:** Thai-readable sans stack; one dominant title per view, supporting labels <= 12px only for metadata, normal body >= 14px, 44px minimum important touch targets.
3. **Surfaces:** neutral outlines, 12–22px radii by scale, low-opacity shadows only where a layer is raised. No competing blue/teal/orange CTAs.
4. **App shell:** fixed desktop sidebar with line icons and soft active highlight; mobile remains a collapsible menu through 980px. Keep navigation role-gated.
5. **Merchant home:** store identity and actionable tools share one balanced card; one-card store no longer occupies only half the desktop.
6. **Guest:** compact restaurant header; search, category chips, products, primary add and cart states remain visible. No fake photos or payment states.
7. **Orders:** primary status cards and individual order cards, with a functional realtime indicator; don't hide order alerts behind aesthetics.
8. **Catalog / inventory / reports:** coherent hierarchy, inputs, cards and numeric emphasis; this slice does not rewrite forms or business processes.

## Acceptance / boundaries
- Preserve same-origin and existing Angular app, role permissions and all API/Order/QR/Stock rules.
- Reuse existing isolated Local Demo Chromium screenshot CI, not synthetic AI renders. At least 320, 390, 768 and 1365 width; review real Guest menu/cart, Merchant workspace/orders and management screens.
- Reuse exact-head Foundation, affected Nx build/test/typecheck/lint, G4 browser order and staging packaging proofs. No production release.
- **Owner Visual UAT remains separate from engineering PASS**. Don't mark design approved until reviewed on real Local preview.
- No bank credentials, real PromptPay, Google scopes, DNS/host or deployment changes. Existing #81, #82 and #7 remain independent.
