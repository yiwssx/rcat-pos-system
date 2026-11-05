# G4 — Operations, security and recovery acceptance (non-payment only)

**Scope:** RCAT POS hardware-free Order/merchant platform, **no real money**.
Review date: 5 Nov 2026. Related #8, #10, #11, #13, PR #61–#64.
This is an operational checklist and evidence map; CI is **not** approval to
deploy production or receive actual PromptPay funds.

## Application contracts

| Endpoint / control | Guaranteed behavior | Source |
| --- | --- | --- |
| `GET /api/health` | Liveness only; remains HTTP 200 when DB offline. The response explicitly says `productionReady:false`, `paymentEnabled:false`. | Existing Foundation tests |
| `GET /api/ready` | HTTP 200 only when both restricted PostgreSQL roles can connect and auth/Order/Outbox schema exist. Otherwise generic HTTP 503, no raw DB error. `Cache-Control:no-store`. This is **non-payment** readiness, not production signoff. | G4 Browser/HTTP E2E + Google-only production-mode CI |
| `POST /api/auth/login` | Disabled (404) unless explicit `ENABLE_DEVELOPMENT_AUTH=true` outside production. Production startup rejects the flag even when DB configured. | G4 Google-only CI |
| Google Workspace | Signed Google ID token + nonce/PKCE, immutable subject, `@rcat.ac.th` domain. Real OAuth client setup and provider reachability are **not** tested by mock CI. | PR #53; G4 Google-only start-route CI |
| `X-Request-Id` | Server-generated random UUID on responses. JSON request trace logs include only method, fixed route group, status code, duration, disconnect/finish; no raw paths, tokens, query, cookies, IP or body. | G4 telemetry unit tests |
| Merchant SSE | Advisory wake signal, store-scoped unacknowledged Outbox; DB cursor, not `Last-Event-ID`, controls replay. 32/instance cap, HTTP 503 overflow, 3-second poll, bounded frame write; HTTP/proxy disconnect forces reconciliation. | PR #63 + G4 nginx/slow-reader checks |
| Payments | Order state `not_requested`; no payable QR, bank integration, merchant receiving credentials or receipts. | G2–G4 tests |

## Backup and restore drill (test-only automated)

GitHub workflow `G4 PostgreSQL Recovery and Integrity` uses disposable
PostgreSQL 16 `rcat_ci_test` and `rcat_ci_restore`. The script
`scripts/ops/ci-backup-restore.sh` **refuses** execution unless CI,
loopback, PostgreSQL superuser and exact disposable DB name match. It:

1. Applies 25 checksummed migrations, seeds two distinct tenants and creates
   two committed, unpaid Orders, five Outbox events, three audit transitions.
2. Executes physical logical custom archive `pg_dump -Fc` and independently
   restores into a fresh second database with `pg_restore --exit-on-error`.
3. Compares row count and canonical JSONB hash in **every** tenant, private
   and migration table, including session digests and inventory.
4. Re-runs the checksum-enforcing migration runner against the restored DB.
5. Verifies immutable satang values, `not_requested` Payment, Outbox feed
   replay with a restored staff session, append-only audit and tenant RLS.
6. Deletes local archive and disposable restored database even after failure.

This validates **logical restore integrity**. It does **not** validate
WAL/PITR, offsite encryption/retention, multi-volume storage, backup jobs
on a host, restore time target under Production data volumes, or disaster
failover. Those require infrastructure signoff under #11.

## Incident decision tree

**S1 — Missing Orders / UI desynchronization:** Check `/ready`, DB
connectivity, stored `orders` and `order_outbox_events`, staff ack cursor,
SSE 503/reconnect and nginx `proxy_buffering off`. Authoritative Orders
prevail over an SSE frame or a merchant browser cache. Never reconstruct
orders from notifications alone. If gap is found, stop new Order intake at
the gateway before a data restore; preserve audit evidence.

**S1 — Cross-tenant or auth boundary:** Disable affected staff sessions
using approved administrative process, rotate exposed credentials and guest
table tokens, retain audit/trace metadata without publishing personal data.
Review reverse proxy and RLS policy; do not restore an unsafe snapshot into
the live database without security signoff.

**S2 — Database unavailable:** `/health` may be green while `/ready` is
503; take the node out of traffic. Check PostgreSQL reachability, roles,
storage and migration ledger. Restore from a verified encrypted snapshot to
a **new isolated database**; verify checksums, foreign-key constraints,
tenant RLS, Orders, Outbox, session invalidation strategy, and migration
drift before an authorized cutover. Do not attempt automatic destructive
restore or silently overwrite the existing database.

**S2 — SSE proxy buffering/reconnect:** Verify idle timeout at least 45s
(greater than 15s heartbeat), `proxy_buffering off`,
`proxy_cache off`, keepalive, and 503 cap. Reconnect using a new
connection; re-fetch authoritative inbox and commit ack only after
coverage. Inspect `X-Request-Id` logs for status and duration, never
record bearer tracking tokens.

**Security reporting:** use private vulnerability reporting, not public
GitHub issues. Do not paste login cookies, visit tokens, OAuth secrets or
customer details into CI artifacts or support tickets.

## Suggested monitoring and alert policy (NOT yet attached to a host)

These are **operator targets**, not claims of active alarms:

- /api/ready HTTP 503 on two successive checks over ~60s: page on-call,
  stop routing Orders to that instance.
- 5xx rate above 1% for 5 minutes (exclude expected 404, 409 and deliberate
  SSE 503-cap probes): review recent releases and DB connectivity.
- Surge of `auth` 401/403 or `guest` 404 in request group metrics:
  investigate brute-force/QR abuse without disclosing request tokens.
- Staff SSE stream saturation (32 per instance), reconnect storms, outbox
  backlog/oldest unacknowledged event age: page when real backlog persists.
  Backend and durable store metrics exporters still need staging integration.
- Backup freshness, checksum/restore drill failures: do not approve release.
  Do not treat a successful dump file as a proven restore.
- Secret rotation, third-party mail transport and production Google OAuth
  have separate manual signoff, never inferred from mocked CI.

## G4 closeout versus staging/production gates

| Area | Automated evidence | External signoff remaining |
| --- | --- | --- |
| Tenant isolation, Order/stock concurrency and QR revocation | PR #61–#63 and database suite | Real traffic and edge limits |
| 32 SSE connections, replay, proxy restart, slow-reader write(false) | PR #63–#64 | Multi-replica prolonged soak / physical mobile sleep |
| Backup/restore RLS, Order, Audit and Outbox | G4 Recovery CI | Backup scheduling, encryption, offsite retention, host RPO/RTO |
| Auth, CSRF, Google subject binding, password-login guard | Unit/DB/HTTP CI | Live OAuth client/provider and domain/TLS |
| Request IDs and safe JSON logs | Unit/HTTP CI | Central logs, alerts, paging and operational ownership |
| Checkout, Merchant operations and no paid false positives | Chromium/HTTP CI | Staging UAT / accessibility |
| G5 payment and G6 Production acceptance | Intentionally not started | Never pre-approved in G4 |

**Go/no-go rule:** Code-complete G4 CI can be marked delivered **only after all
its workflows are green**. Do NOT close the shared #10/#11 release epics or
represent G4 as operationally signed off while the explicit external gates
above remain unverified. G5 Payment is the final functional module, and G6
will require payment-specific verification and a separate go/no-go.
