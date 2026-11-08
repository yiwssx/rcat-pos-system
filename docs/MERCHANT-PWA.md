# Merchant PWA — Safe Offline Shell (G3 / #8)

The merchant Angular app is installable as a standalone Progressive Web App. It
is **online-only for business operations**: it does not allow offline mutation,
Order acceptance, financial confirmation or notification acknowledgements.

## Install/registration

- `apps/merchant/public/manifest.webmanifest` supplies a Thai app name,
  standalone display mode, theme color and SVG icon. All assets are included in
  the Angular production build through `angular.json`.
- Browser registers `/sw.js` under HTTPS (or local loopback for dev).
  If unsupported, disabled or rejected, the normal authenticated merchant
  board and HTTP fallback still work without offline caching.
- On install the service worker caches **only** `/offline.html`, PWA manifest
  and the public logo. On-demand cache applies **only** to same-origin hashed
  JavaScript/CSS build assets (not any `/api`, Session, tenant/order response,
  images containing customer data, routes or dynamically fetched JSON).
- Navigations always fetch from the server and are NEVER cached. If the network
  fails, all navigations (including previously authenticated Order Board and
  report routes) display the **generic offline screen**. The screen displays
  no historical Orders, store memberships, prices or unconfirmed status.

## Isolation and recovery

- An authenticated `/api/**` request is not intercepted, and a streaming
  SSE request is never cached. Changing Order states always requires a live
  HTTP request, Session, Origin and CSRF in the existing API. There is no
  Background Sync, offline queue, IndexedDB or replay of side-effectful calls.
- On browser reconnect, the existing Order Board opens SSE again and re-reads
  the authoritative Inbox + persisted Durable Outbox. The Service Worker does
  **not** acknowledge events or infer that offline orders were received.
- A cache-version update deletes older RCAT Merchant static-only cache versions.
  It does not delete caches owned by other apps. Same-origin deploys of
  Merchant and Customer/Admin with overlapping paths are unsupported: deploy
  merchant to a distinct origin before enabling `scope: /`.
- Offline navigation still serves an informational `offline.html`; cached
  scripts cannot bootstrap the authenticated merchant UI while offline.

## Tests and operational gates

`node tests/pwa-service-worker.mjs` executes the actual Service Worker
source in a simulated event context. It verifies that offline navigation
shows a generic message, API/SSE/mutations are excluded, only approved
hashed static assets qualify for runtime cache, and install cache contains
only public files. It runs under `merchant:test` in Workspace CI.

**Not yet production-qualified:** installability on iOS Safari/Chrome/Android,
actual proxy `Cache-Control` and response headers, TLS, CSP, reload after
Service Worker upgrades, SW lifecycle after role revocation, multiple tabs,
mobile background/sleep, storage quota, static icon install criteria on
target devices, and full browser End-to-End validation. Installability is
a convenience, not offline operations. The deferred PromptPay flow remains
outside this feature (G5/#7).

## G3 immutable asset cache hardening (8 Nov 2026)

The Merchant service worker remains **static-assets-only**. It now accepts
only same-origin, query-free build-hashed JavaScript requested as scripts and
build-hashed CSS requested as styles. Caching also requires an actual
non-redirected `basic` response with matching JavaScript/CSS Content-Type,
a successful status, and no `private` or `no-store` Cache-Control.

The Node service-worker regression test exercises cached hashed asset
fallback after disconnection, rejects HTML/auth redirects and private/no-store
responses, denies query-string variants and mismatched MIME/destination, and
continues to block API/SSE/authenticated navigation/order mutation caching.
Offline navigation still shows only the warning page, with **no Order data**.

Real physical Service Worker update lifecycle, mobile process eviction and
multi-replica SSE staging soak remain operational acceptance gates.

## Real Browser Service Worker lifecycle qualification (8 Nov 2026; G3/#8)

A separate authenticated Chromium mobile-width Merchant session installs
and activates `/sw.js` over test-only HTTPS and reloads into a
Service-Worker-controlled Order Board. While the browser context is
disconnected, the app marks its Order data as potentially stale, and the
test reads actual Chromium Cache Storage to verify that `/offline.html`
is available, contains only an informational warning, and never leaks
an Order ID. It asserts that the browser cache contains no `/api`,
`/orders/` or `/auth` resources. On reconnect it reloads the live
PostgreSQL-backed Merchant Order Board.

The deterministic Node Service Worker test separately invokes the
`fetch` handler with a failing network and verifies that an
offline navigation produces the informational page, **not** cached Orders.
It also tests worker activation: only obsolete
`rcat-pos-merchant-static-*` cache versions can be deleted, the current
cache and unrelated application caches are preserved, and clients are
claimed. The G4 E2E workflow executes this suite explicitly.

**CI limitation:** Chromium page-context offline emulation does not
reliably emulate the separate Service Worker network target in this
configuration. Browser tests therefore verify the real offline resource,
stale warning and reconnection; the offline navigation fallback is proven
at the isolated worker-handler level, **not** in a live offline-navigation
browser test. The Playwright launcher bypasses certificate errors ONLY
for the ephemeral self-signed CI loopback origin; no Production TLS bypass
exists.

**Not yet proven:** physical Android/iOS offline navigation, mobile
process eviction, iOS Safari PWA, real proxy SSE buffering, multi-replica
staging soak or Production worker update behavior. No Payment or
Production signoff.
