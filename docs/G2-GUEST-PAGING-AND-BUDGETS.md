# G2 Guest server-side menu pagination and shared request budgets

**Engineering scope (2026-11-08):** #5, #38, #8 and Tracker #13. Does not
enable Payment/PromptPay and does not deploy Production or Staging.

## Real Guest Catalog paging (not just browser DOM batching)

- `POST /api/guest/ordering-visit/page` with JSON
  `{token,search:"",categoryId:null,cursor:null,limit:24}`.
  Requires exact allowed Origin; no guest login. The 43-char QR/grant secret
  is carried only inside the JSON body and never in URLs, logs, localStorage
  or cache. Every response is `Cache-Control: no-store`.
- PostgreSQL `rcat_private.guest_catalog_page` enforces a currently active
  visit/grant AND active table. It searches only available, unarchived products
  of the matched tenant/store, returns at most 50 rows, bounded matching
  Modifier groups and available options, and a stable `(created_at,id)`
  keyset cursor. Search is bounded to 80 characters. The browser defaults
  to 24 products and requests subsequent pages on demand.
- Search/category changes **reset the cursor** and require a fresh server
  page; stale responses are ignored, including during 300ms Thai search
  debounce. Only current filtered page products are displayed. The
  in-memory cart keeps previously reviewed product/Modifier snapshots
  across pages; page merges never silently reprice a cart line.
- Before checkout the existing full visit resolver revalidates the **entire
  cart** against current server catalog and selected option rules, then the
  PostgreSQL Order Engine revalidates and saves immutable satang snapshots.
  Thus keyset paging is not a trust boundary or a change to payment status.
  Legacy `POST /guest/ordering-visit/resolve` remains available for backward
  compatibility and checkout preflight; on large catalogs it is still
  heavy, so a future batch cart-validation endpoint is an optimization.

## Cross-instance Guest rate budgets

- `rcat_private.claim_guest_request_budget` stores counters atomically
  in PostgreSQL with `INSERT ... ON CONFLICT ... WHERE hits < limit`. There
  is no per-Nest-instance rate-limit Map that can be bypassed by using
  another worker. Fixed policies (not supplied by clients) apply to
  redemption, visit resolution, pages, checkout and tracking.
- Per-peer and per-token subjects are derived by domain-separated
  HMAC-SHA256 using **existing** `GUEST_TABLE_CODE_PEPPER`, so neither
  raw IP addresses nor guest tokens appear in the counter table.
  No extra application secret is required; missing/invalid pepper or peer
  identity makes public Guest endpoints fail closed (503). The runtime
  database role only gets EXECUTE on the single budget function; table data
  is not exposed.
- Current quotas:

  | Lane | Peer per window | Token/table per window |
  | --- | --- | --- |
  | redeem code | 30 / 5 min | 60 / 5 min |
  | resolve visit | 300 / min | 120 / min |
  | page | 300 / min | 120 / min |
  | checkout | 600 / min | 150 / min |
  | tracking | 600 / min | 180 / min |

  A limit rejection returns HTTP **429**; a shared staff QR address does
  not bypass table-specific failed-code attempt caps or guest-grant limits.
  True checkout idempotency and stock policy remain inside PostgreSQL.

### Deployment boundary and operational caveats

- The peer identity is the **TCP socket remote address**. Neither
  `X-Forwarded-For` nor another user-set header is trusted in application
  code. Behind a reverse proxy this may be the same IP for many guests:
  enforce client-IP edge limits on the **trusted ingress** and validate NAT
  fairness in Staging. This PostgreSQL limiter provides a shared secondary
  budget, not a substitute for authenticated edge filtering, DDoS protection
  or distributed load qualification.
- A DBA/scheduler must call
  `SELECT rcat_private.prune_guest_request_budgets();` daily using a
  privileged maintenance identity; never grant this function or direct table
  SELECT/DELETE to `rcat_auth` or `rcat_app`. Confirm maintenance and
  retention on staging backup/restore before public enablement.
- Hashed subjects are retained in buckets for at most a day **only when
  scheduled housekeeping runs**. Do not claim an automatic retention SLA
  without proving the scheduler.
- CI verifies 55-row Guest keyset + Thai search + tenant bearer denial +
  fixed quota boundary + RLS and real HTTP 31-row paged menu/search/timing,
  with Chromium guest ordering through the new endpoint. These are
  ephemeral CI results, **not** a real mobile radio/proxy/Production SLO.
