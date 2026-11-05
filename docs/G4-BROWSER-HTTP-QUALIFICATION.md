# G4 Browser + HTTP Order Qualification (PR #62)

**Scope:** non-payment end-to-end reliability tests on **disposable CI PostgreSQL**, not a staging capacity certificate or live customer acceptance test. The user-facing Customer and Merchant UIs are Angular; the API is NestJS. G5 PromptPay is deliberately not exercised.

## Environment

`.github/workflows/g4-browser-http.yml` runs on GitHub Actions with:

- PostgreSQL 16 in a local disposable service, migrations applied and known
  development-only HTTP login fixtures created with no real credentials.
- Node 24 / pnpm 10 with the repository's **unchanged frozen pnpm lockfile**.
- NestJS API at `127.0.0.1:3000`, the exact existing Angular development
  proxy target. Customer and Merchant Angular apps are served on separate
  loopback origins.
- A version-pinned `playwright@1.56.1` installed **only in /tmp**, with
  Chromium, so shipping app dependencies and the production bundle do not
  acquire a browser automation framework.
- Session-cookie/CSRF checks, Origin allowlist, and real database-backed Orders.
  Dev password login is enabled **only** in this isolated test environment.

The entry point is `tests/e2e/g4-browser-http.cjs`. No payment provider, bank
account, external production domain, public staging URL, or real customer data
is used. Screenshot artifacts, when a test fails, use synthetic Order/menu
data and expire after five days.

## Browser journey

1. On a mobile-sized Chromium context open an authentic table **ordering**
   QR visit URL fragment, resolve the menu through the API and verify the
   bearer secret is removed from the browser's address bar.
2. Add a product to a real Angular cart. Disable the customer browser's
   network to verify checkout is disabled; restore connectivity and submit.
3. Wait for the Order Tracking route and server-backed `not_requested`
   Payment state without claiming money was received.
4. Sign into two independent Merchant browser contexts through test-only
   authentication, load the same store board, and confirm the newly submitted
   Order exists on both devices.
5. Accept it on one device and verify status reconciliation on the other and
   after the Customer manually refreshes its status.
6. End one Merchant session with the real CSRF-protected logout endpoint;
   refreshing that browser must not continue to reveal the Order board.

## HTTP burst and correctness assertions

The same fixture is reused for true HTTP requests through the Angular
proxy and NestJS API, not direct stored-procedure calls:

- 24 concurrent requests with identical `Idempotency-Key` and cart must
  produce one Order; exactly one response is `replayed=false`.
- 24 independent Order requests commit once each. PostgreSQL queries confirm
  immutable amounts, Order count and exactly one `order.submitted` Outbox
  event per Order (no phantom customer Orders).
- After the staff rotates the table's visit token, eight requests using the
  obsolete QR token must all return 404 and create zero additional Orders.

Durations are printed in milliseconds (p50/p95) for CI diagnostics.
These numbers include Node, proxy, application connection queues and
PostgreSQL overhead. They are **not** a declared production SLO, load-test
throughput capacity, or a substitute for a sustained soak test.

## Remaining release gates

- Multiple worker nodes and sustained peak-hour HTTP capacity with error-rate
  thresholds, server telemetry and bounded SSE/backpressure.
- Browser version/device matrix, accessibility, reconnect after mobile sleep,
  session expiration across Google OAuth flow, and screen reader support.
- Actual staging and backup/restore disaster-recovery drills before any
  Production decision.
- G5 PromptPay per Order, provider verification, refunds and reconciliation
  remain LAST, followed by G6 release qualifications with real money controls.
