# RCAT POS G4 On-prem Staging A4/A5 — bounded qualification and devices

**Coding-only delivery.** Implements repeatable **read-only** qualification harnesses for [#80](https://github.com/yiwssx/rcat-pos-system/issues/80); host operation and evidence still belong to [#81](https://github.com/yiwssx/rcat-pos-system/issues/81). No IOT/RMS/DNS changes, no live OAuth credentials, no Payment or Production deploy.

## A4 — Qualifications already in automated disposable CI

- PostgreSQL independent sessions and HTTP burst tests: unique/identical idempotency keys, stock shortage atomicity, cancellation/return conflicts; existing `tests/db/order-concurrency*` / `tests/e2e/g4-browser-http.cjs`.
- Multi-process, shared-DB SSE event/ack, capacity 32 per API process, 33rd denied, replay and session revocation; existing `tests/e2e/g4-sse-qualification.cjs`.
- Real nginx SSE no-buffering/restart CI, isolated PostgreSQL backup/restore and schema checksums; existing G4 CI.
- New `tests/ops/onprem-qualification.test.mjs` generates **501 synthetic catalogue items** on a disposable local HTTP endpoint and verifies 21 distinct keyset pages and rejects repeated cursors, wrong status, unbounded pages, Production hosts. It also verifies bounded two-stream SSE with a synthetic protected cookie file and rejects unsafe targets and excessive stream counts. These tests do NOT prove host capacity.

## A4 — Safe real Staging read-only scripts (after B preflight)

These scripts do not create Orders, change stock, acknowledge notification events or handle Payment. Both refuse non-staging HTTPS hostnames, credentials in URLs, wildcards and excessive workloads. CI may use loopback HTTP with synthetic fixtures only.

### Seeded 500+ product Guest pagination (read-only)

Staging operator must first provision a **synthetic** catalogue containing 500+ distinct active products and an authorized disposable Guest visit token. Never use live customer Order data. The token is sensitive and must not be pasted into public tickets.

```bash
RCAT_STAGING_API_URL=https://customer-staging.example.invalid/ \
RCAT_STAGING_CUSTOMER_ORIGIN=https://customer-staging.example.invalid \
RCAT_STAGING_VISIT_TOKEN='<staging-only-secret>' \
RCAT_CATALOG_MIN_PRODUCTS=500 RCAT_CATALOG_MAX_PAGES=50 \
node scripts/load/onprem-catalog-qualification.mjs
```

Expected: JSON `status:"pass"`, `products>=500`, unique IDs, bounded pages, `p50ms/p95ms/maxMs`. It makes at most 50 paginated Guest read requests sequentially. **It is not a throughput SLO or sustained load test.** The existing `staging-guest-read-soak.mjs` can issue at most 60 bounded Guest read requests separately after appropriate staging budget/NAT review.

### Merchant SSE proxy read stability (read-only)

Operator creates an isolated, disposable pre-approved Staff session using **actual HTTPS Google OAuth** and writes the private `__Host-rcat_session=...` cookie into a local file readable only by the operator (`chmod 600`); never commit the file, place credentials in a URL or enable tracing of its contents. Use a *synthetic staging store UUID*.

```bash
RCAT_STAGING_SSE_URL='https://merchant-staging.example.invalid/api/tenants/<UUID>/stores/<UUID>/notifications/stream' \
RCAT_SSE_COOKIE_FILE='/opt/rcat-pos-system/.secrets/staging-sse-staff-cookie' \
RCAT_SSE_STREAMS=2 RCAT_SSE_SECONDS=30 \
node scripts/load/onprem-sse-read-soak.mjs
```

Cap: 1–4 concurrent authenticated GET streams, 15–90 seconds on real Staging, 1 MiB per stream. Output contains only connection count, duration, frame/byte aggregate, no event body or token. A passing read probe means **that one ingress route** maintained connections; it does **not** prove round-robin landed on two replicas or that all committed Orders replayed. B must independently verify proxy routing to two NestJS replicas and durable event IDs/ack, reconnect storm behavior, client-IP NAT limits, 500+ product real host metrics and extended supervised soak.

## A5 — Accessibility + device qualification

Automated Chromium E2E adds keyboard-focus assertions for Guest search-to-category navigation at 320 px, and keyboard focus on Merchant acceptance control, in addition to existing real HTTP/mobile/PWA browser checks. **Chromium mobile emulation is not physical Safari, Android Chrome or a screen reader.**

B operator acceptance matrix (record tested OS/browser versions, device make, timing/errors, anonymized screenshots and reproducible failures; **never** record tokens, customer details or QR grants):

| Surface | Real device/browser | Required test |
| --- | --- | --- |
| Customer QR | Android Chrome & iOS Safari | Printed A5 QR, rotating table code, scan → menu, 320/390px, correct table, inaccessible after revocation |
| Guest weak network | Android/iOS, throttled cell/Wi-Fi | Checkout disabled offline, resume without duplicate Order, tracking stale warning and recover |
| Merchant | Android Chrome & iOS Safari PWA | Google Workspace login, Secure cookies/CSRF, Add-to-Home-Screen, Order notification after background/screen sleep, reconnect authoritative refresh |
| Accessibility | Keyboard + TalkBack/VoiceOver | Focus sequence, discernible labels, cart modifier names, actionable error/status announcements, zoom at 200%, contrast |
| Recovery | Two devices / independent sessions | Same Order appears once, mutation idempotent, logout/revocation, SSE interrupted by proxy restart then replay |
| Host reliability | RCA operator | 2+ Nest workers, resource and connection limits, pg restore in *isolated* DB, measured RPO/RTO, alert delivery |

Failures must be filed back to A coding before marking B and G4 accepted. The business Sold-out policy and retention approvals are tracked in [#82](https://github.com/yiwssx/rcat-pos-system/issues/82). **G5 PromptPay remains last.**
