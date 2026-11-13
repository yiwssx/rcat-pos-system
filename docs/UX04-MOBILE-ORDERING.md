# UX-04 — Mobile Guest Ordering (iOS-inspired web)

Issue: #5. Existing plan: [UX-REDESIGN-PLAN.md](UX-REDESIGN-PLAN.md).
Scope: Customer QR menu only. Store intake toggle, Order pricing and Payment logic are untouched.

## Design reference, not a copy

- [Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout): content safe areas, responsive adaptive layouts, readable controls and margins.
- [Apple HIG Tab Bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars): reserve tabs for actual destinations, not add-to-cart actions. This guest flow needs one main menu and focused sheets, **not** a decorative tab bar.
- [Toast Online Ordering FAQ](https://support.toasttab.com/en/article/Online-Ordering-FAQ): fast search and compact mobile menu navigation. Use native dialog product/cart sheets, not an external POS component.
- Preserve RCAT orange/white design tokens and original branding. No third-party artwork, trademarks or proprietary templates.

## Journey

Entry: existing static per-table QR (when merchant intake is open), or existing short-lived staff visit link. No login.

1. Header shows store name and table, with independent **ติดตามออเดอร์** route.
2. Search + swipeable category chips -> compact photo/menu cards -> one primary Add button.
3. Items with modifier groups open a **native product detail dialog** so required/optional options do not expand every card. Quantity selector is capped before adding; existing `addToCart` domain validation runs for each requested quantity.
4. Sticky, thumb-accessible cart button shows item count and **estimated** amount. A native cart dialog displays lines, quantities and the only Checkout action.
5. Checkout still calls scoped cart review and server-authoritative Order submission with the existing idempotency key. No Payment confirmation is implied.

## Explicit adverse paths / states

- **Store closed:** existing friendly notice and retry; server-side checkout rejects new Orders.
- **No/expired QR:** existing guest error with retry or rescan copy; do not expose tokens in URL.
- **Offline:** disable Checkout; keep cart in memory; never auto-submit after reconnect.
- **Stale products/options:** dialog validates selections; existing pre-submit review rejects stale prices or names.
- **Repeat click/retry:** existing deterministic idempotency and request busy state.
- **Empty catalog/search:** empty state with an editable search and category choices.
- **Input accessibility:** 44px controls, visible focus, keyboard-operable chips and native dialog focus/ESC restoration.
- **Unverified Payment:** bottom copy says estimates only; no PromptPay calls or paid success message.

## Evidence / acceptance boundary

- Existing Nx frontend unit/typecheck and affected-project Prettier via Workspace Quality.
- Existing Browser/HTTP E2E updated for category keyboard navigation and product/cart dialog, 320px menu scroll bounds, offline Order blocking, checkout and tracking.
- Existing Local Compose browser E2E updated for real QR open/closed and Guest cart dialog before submitting, without duplicating an external synthetic database load.
- Screenshots under CI are **synthetic**. Physical iOS Safari/Android devices, 200% text/zoom and weak network need targeted owner acceptance before claiming full UX signoff.
- No domain, staging host, PostgreSQL, payment, DNS, auth or production change.
