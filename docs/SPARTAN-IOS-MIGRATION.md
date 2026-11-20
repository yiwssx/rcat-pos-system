# RCAT POS — Spartan-first / iOS-inspired interaction contract

> **20 Nov 2026:** [V7 Warm Modern](UI-V7-WARM-MODERN.md) supersedes the 18 Nov visual palette only. All component architecture and security restrictions below remain binding.

**Owner directive, 18 Nov 2026.** This overrides the V6 vivid/gradient treatment for future UI decisions. It is an implementation contract for the existing Angular 22 + Nx 24 application, not a second frontend framework or a claim that all screens are already migrated.

## Required component architecture

1. **Spartan UI 1.9.0 is the primary component system.** Generate the official Brain + Helm components with the pinned `@spartan-ng/cli`, into the existing `components.json` target `libs/ui/src/spartan`. Use generated Helm imports and normal Angular templates. Do not hand-roll lookalike controls, copy React shadcn/ui, or add Zard/PrimeNG/Material.
2. **Style ownership has exactly two layers:** one semantic Spartan/Tailwind theme (`libs/ui/src/spartan-theme.css`) and the necessary self-hosted Thai font faces (`libs/ui/src/pos-thai-type.css`). Existing application CSS is **migration debt**, not a basis for new components. Migrate styles to official Helm components and semantic Tailwind utilities, then **delete** superseded feature CSS. Avoid one-off selector overrides, new feature `.css` files, inline `style`, `[ngStyle]`, arbitrary Tailwind colors, and `!important` fixes.
3. **Keep feature logic separate from presentation.** Existing Angular signals/services/forms/API calls, authorization, CSRF, guest QR recovery, tenant isolation, offline reconciliation, Order status and Payment restrictions remain intact. Create small presentational components where multiple screens genuinely reuse the same information pattern. Never move a business rule into a reusable visual component.
4. **Do not treat the old `RcatButtonDirective` as full Helm adoption.** It bridges Brain behavior to hand-written `.rcat-btn` styles. Replace it and the per-page button styles with official Helm Button in a bounded migration, and delete the bridge only after the last use is gone.
5. **Preserve the original RCAT POS logo.** The desired iOS-like feel concerns visual hierarchy, density, whitespace, motion, touch and legibility; it must not suggest the product is an Apple app or copy iOS system assets.

## Design language

- **Canvas:** Warm Cream `#FFF5E9`; **surface:** Ivory `#FFFDFA`; **text:** Espresso `#382921`; **secondary text:** `#765B4C`; **separators:** `#E9D7C4`. Deep Teal `#186B60` is the primary action; Terracotta `#C04C2B` is brand accent only. Mint selection, semantic status colors, no decorative waves or gradient sidebar on operational screens.
- **Font:** keep self-hosted IBM Plex Sans Thai until device-level comparison proves a better alternative. Use actual weights 400, 500, 600, 700; no synthetic 750/800/850/900 variants. Body at least 16px in the primary work surfaces, supportive text generally at least 14px; line-height around 1.5–1.65 for Thai text. Currency and order numbers use tabular numerals.
- **Spacing:** one consistent Tailwind rhythm (4/8/12/16/24/32px), with 16px phone and 24–32px desktop outer gutters. Component interior padding comes from Helm's variants rather than per-screen selectors.
- **Components:** Helm Button, Card, Input, Field/Label, Native Select/Select, Badge, Alert, Dialog/Sheet, Dropdown Menu, Tabs, Table, Skeleton, Separator, Tooltip, Pagination, Switch as appropriate. Use native semantics where Spartan does not offer a primitive. Controls remain at least 44px touchable in operational flows.
- **Layouts:** compact yet breathable, no endlessly expanded form or giant empty hero. Desktop uses a legible light nav and an operator-focused content area; mobile uses adaptive navigation, disclosures and sheets. Loading, error, disabled, offline, destructive-confirmation and keyboard focus are real states, not cosmetic.
- **Accessibility and performance:** 320/390/768/1365px screen checks; no horizontal scrolling; predictable focus; Thai wrapping; reasonable contrast; actual fonts loaded; do not ship new external font/CDN requests.

## Migration order under existing Issue #102

| Slice | Target | Action |
| --- | --- | --- |
| 0 — Policy/Theme | Shared foundation | Introduce this contract and a delta-only guard; neutralize semantic Spartan theme. Do **not** claim whole-app completion. |
| 1 — Genuine Helm setup | Component library | Run `pnpm exec nx g @spartan-ng/cli:info --json` then the official `pnpm exec nx g @spartan-ng/cli:ui` to generate only needed components. Review generated files and lockfile. Avoid `ui-theme` overwriting the approved semantic tokens. |
| 2 — Shell and sign-in | Single-origin Customer shell | Replace hand-built nav/action layout with Helm + semantic Tailwind utilities; preserve OAuth URL and owner access. Delete obsolete shell/legacy decoration CSS proven unused. |
| 3 — Merchant management | Catalog, Tables, Inventory, Stocktake, Reports | Convert forms, cards, filters, uploads and destructive actions to Helm and remove each corresponding legacy stylesheet as it is replaced. |
| 4 — Order operations | Orders/merchant board | Convert high-density queue while preserving SSE, recovery, stock-on-accept and order status transitions. |
| 5 — Guest and Admin | QR catalog/checkout and owner/platform screens | Migrate sensitive flows with full browser coverage; never conflate ordering/payment or loosen RBAC. |

**Acceptance for a slice:** all changed UI controls are official Helm or native semantic elements; new feature CSS = 0; replaced legacy CSS is removed instead of overridden; no change to business behavior; affected Nx checks and existing Browser E2E pass; real owner visual UAT covers phone and desktop. CI alone is not visual approval. No automatic host or Production deployment.

## Evidence and limits

Repository baseline at `972978cb349e556c69697bc6498f0e97c071b35f`: 17 app CSS files (~226 KB), including V1/V5/V6-specific overrides. `components.json` already targets `libs/ui/src/spartan`, but that directory was absent on the reviewed `main`; installed `@spartan-ng/brain` and a one-off `RcatButtonDirective` are **not** a generated Helm component inventory.

Spartan's official v1.9 CLI documentation: https://www.spartan.ng/documentation/cli . Original code and security requirements: `AGENTS.md`, `docs/UI-V6-POS-WORKBENCH.md` (history only for aesthetics), and `docs/SINGLE-ENTRY-PORTAL.md`.
