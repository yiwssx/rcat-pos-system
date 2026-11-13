# RCAT POS — Reference-driven UI/UX balance (13 Nov 2026)

## Evidence and boundaries

Baseline: `main` at `dcf35984a7094dcfb114b35dd33f14ca08e2bcb5` (captured before this change).
This is a source-level change; **rendered screenshots, cross-device visual acceptance and CI on this branch are not yet proven by this document**. Do not present a mock-up as an actual application capture.

Reference systems (design patterns only, not code/asset copies):
- [DOME POS documented screenshots](https://github.com/jaturapornchai/domepos/tree/main/docs/screenshots): short task navigation, product visuals, table/status cards, visible actions. **Do not copy** its no-login single-owner authorization model; RCAT has multiple merchants and server-enforced roles.
- [Square POS app redesign](https://squareup.com/us/en/the-bottom-line/inside-square/square-pos-redesign): quick-scan item grid, explicit active workflow, usable touch targets. RCAT Guest is QR-first, not staff register checkout.
- [Loyverse POS screen arrangement](https://help.loyverse.com/help/how-apply-discounts-during-sale): visible menu + active ticket hierarchy, readable prices.
- [Shopify POS editor guidance](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/customize-pos): task-focused smart grid; customize the workflow to the operator role, not one universal screen.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): AA reflow at 320 CSS px equivalent, WCAG 2.5.8 minimum target 24 CSS px (with exceptions), visible keyboard focus. RCAT adopts **44 px internal target** for critical touch actions as a more usable product rule, not a claim that 44 px is required by WCAG AA.

## Design decisions / balance contract

| Dimension | RCAT decision | Rationale and review proof |
| --- | --- | --- |
| Task hierarchy | Guest: menu → details → cart; Merchant: order status and action → tables/catalog/stock; Owner: per-store settings only | DOME/Square role-specific operational flow; verify primary action visible without reading a long introduction |
| Width | Shared content max 1180 px, compact settings max 1040 px; desktop staff sidebar 252 px | Prevent unreadably long line lengths; verify 1280/1440 desktop |
| Spacing | Shared 4/8/12/16/20/24/32/40 px rhythm and small card elevation | Measure card alignment and repeated form spacing |
| Typography | Thai-first font stack; staff page H1 approx 30–42 px; body line height 1.6; important totals remain visible at 320 px | Verify readable controls at 320/390 and 200% zoom; avoid tiny context labels |
| Navigation | Desktop sidebar visible, mobile sidebar links collapsed behind an explicitly labeled toggle; menu closes on route change | Reduces horizontal chip scrolling, avoids showing all administration destinations at once |
| Mobile Guest | Preserve product card, item options, native dialog, persistent cart; show approximate amount even at 320–350 px | Avoid hiding a financial amount on smaller devices |
| States | Existing text + status colors, loading, offline, error/retry and permission messaging retained | No color-only communication, no fake payment success |
| Access | One portal and server-enforced tenant role, no new authority or URLs | Security model remains unchanged |
| Financial | PromptPay deferred; estimated amount explicitly marked | Must not suggest paid or cash-received state |
| Motion | Existing reduced-motion support; no new busy animation | Focus on task completion instead of ornament |

## Source changes in this slice

- `apps/customer/src/app/app.component.ts`: accessible mobile navigation toggle and close on route change (same scoped nav; no new route/permission paths).
- `apps/customer/src/styles.css`: responsive mobile task navigation, legible landing/login descriptions and store-card spacing.
- `libs/ui/src/pos-tokens.css`: shared content width, touch and spacing measures.
- `apps/customer/src/app/guest-order.css`: product/category/option typography; **never hide the cart amount on a narrow phone**.
- Merchant order board, tables, catalog, inventory, reports and Owner settings CSS: aligned header scale, card density, controls and small-screen composition.

## Acceptance matrix — requires actual rendered evidence

Capture **real browser screenshots** (not generated images or Figma frames), with commit SHA and viewport metadata. Use Local Demo sample data only; never real student/staff/client or payment credentials.

| Surface | Viewports | Acceptance |
| --- | --- | --- |
| Guest menu + product sheet + cart | 320×700, 390×844, 768×1024 | Table context, product names and prices fit; amount never disappears; dialogs keyboard usable, safe area respected |
| Staff portal and expanded/collapsed nav | 320×700, 390×844, 1280×800 | Toggle has accessible name, aria-expanded changes, tabs/links functional; navigations close mobile panel; no unauthorized links |
| Merchant order board | 320×700, 768×1024, 1440×900 | Status/total/action readable, summary does not overflow, order action at least 44 px |
| Tables + QR | 390×844, 1280×800 | Table state visible, QR and print presentation unchanged, ordering open/closed truth preserved |
| Catalog + Inventory | 390×844, 1440×900 | Editor not clipped, accessible controls, no accidental horizontal page overflow |
| Reports + Owner settings | 390×844, 1440×900 | KPI labels/totals readable, only report tables scroll inside their own frame; role restrictions intact |

Before claiming visual acceptance: browser test keyboard, focus, 200% zoom and 320px reflow; check 400% zoom equivalent on 1280px for WCAG 1.4.10. Verify touch targets, empty/error/offline states, Thai wrapping, server-granted role restrictions and QR closed-store behavior.

Build/test *only affected projects* on the PR head using existing CI tasks (`pnpm exec nx build customer`, `pnpm exec nx test customer`, and existing relevant checks). Reuse previous service/database evidence; no repeated on-prem DB testing for a CSS/navigation change.

## Out of scope

No backend/API/DB/Auth/RBAC/PromptPay/production/DNS/host or migration changes. This PR is not deployment approval and is **not** evidence of RCAT IOT browser rendering. Attach actual captures and review deltas before merge; keep original #5 (Guest), #8 (Merchant), #81 (Staging) and #82 (Policies) acceptance boundaries.
