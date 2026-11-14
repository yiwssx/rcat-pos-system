# RCAT POS — V6 Restaurant Workbench (canonical UI contract)

**Owner decision:** 14 Nov 2026. V1–V5 visual designs are retired. This is a **new app information architecture**, not another V5 CSS polish. V6 Spartan foundation PR #105 is retained; this implementation completely replaces the old merchant hero/store split and changes the Order Queue, Guest catalog and Admin interaction patterns. Historical screenshots/docs remain as evidence only.

## Design reference / independence
Wongnai POS / FoodStory supplied structural inspiration: compact operator-first left navigation, visible queue and item state, category-first food grid and immediate actions. Source: official Wongnai POS product and Help Center documentation; **no copying source code, product UI screenshots, brand assets or Wongnai logo**. RCAT remains one-origin QR self-ordering and no dedicated POS hardware; there is no cashier numeric keypad or invented payment controls.

## Thai-first typography — corrected at source
- `RCAT Plex Thai` is a locally served IBM Plex Sans Thai family (regular/medium/semibold/bold). All assets are fetched from the **immutable Google Fonts commit** `29b4ec6df2522a8aee279414b78a07910b065874` with `OFL.txt` in each app's `public/fonts/` tree.
- A shared `libs/ui/src/pos-thai-type.css` defines real `@font-face` entries. Customer, Merchant, Admin forms and controls use the same font. No dependency on a user-installed Noto Sans Thai or external font CDN.
- Fixed weight map 400/500/600/700, `font-synthesis: none`, no unbounded fake heavy fonts. Readable Thai body and Arabic digits, avoid decorative typography in operations.
- Browser qualification checks 200 response and `document.fonts.load/check` before screenshots.

## New screen composition
**Merchant Workbench (/)**: 220px dark operational nav desktop; compact one-screen management panel; status/roles at store level; first action goes directly to Order queue. Right guide pane desktop, hidden mobile. Under 980px, nav changes to a compact selector + accessible disclosure. Removes giant dark left hero with little information.
**Order Board**: Short heading and refresh, a small connection banner, three clickable status counters (new/in-progress/served), Order cards with name and delivery and notes, high-priority actions, historical Outbox events in collapsed native disclosure. No fake paid status and no payment gating.
**Customer QR**: Small store+table header, search+category grouped toolbar, responsive 2-column compact food grid on standard phones/tablets, single-column fallback at 320px, same optional modifiers and note sheet and required checkout name/delivery; stable sticky cart.
**Owner Admin**: Store access visible, creation and invitation as distinct collapsed operations, not a long stack of forms at rest; labels and native keyboard behavior retained.

## Non-negotiable functionality
- Keep all Angular signals and routing (owner/kitchen/cashier), session, CSRF, QR, stock-on-accept, immutable satang amount, Order paid/not-paid independent, SSE+re-fetch.
- No new server endpoint, database migration, payment/mock-payment claims, paid status, host, OAuth, DNS, staging/Production cutover.
- E2E real browser screenshot captured at 320, 390, 768, 1365. Previous version comparison uses PR #105 artifact as **pre-V6-workbench** baseline, not invented renderings.
- Owner Visual UAT **OPEN** independent of green Nx/Chromium/Local Demo. G4 RCAT IOT staging #81 still distinct.
- One feature PR under master #13 / unified #102, no new issues or standing CI workflows.

## Cleanup policy
Do not delete Git history, old Order APIs or old functional styles relied on by unmigrated routes. Retired V1–V5 design notes are read-only historical reference. Strip deprecated CSS only when its selectors are verified unused; never remove accessibility or error/empty/recovery behavior for visual reasons.
