# Merchant Order Board — G3 / Issue #8

The merchant Angular app now provides a **session-authorized** store selector at
`/` and a staff operational board at
`/orders/:tenantId/:storeId`. The API remains the authority for tenant,
store, staff role, order status, immutable satang totals and payment placeholder.
These screens are an **increment** toward issue #8, not a Production release.

## Getting into a store

1. A staff member establishes a same-origin, valid HttpOnly
   `__Host-rcat_session` cookie through the supported authentication system.
   During this development phase only, the NestJS API has development-gated
   password auth. Google OAuth for `@rcat.ac.th` staff is not yet wired and
   is required before the controlled deployment gate.
2. `GET /api/auth/merchant-stores` returns only this staff user's accessible
   stores, including their role and safe display names. Migration 017
   restricts access to `rcat_auth` via a session-gated SECURITY DEFINER
   routine, without direct tenant table read grants.
3. Choose a store card. Navigating to a crafted URL is **not authority**:
   the board first re-reads the store scopes and all data/mutations are
   separately checked in the PostgreSQL tenant/store routines.

## Staff workflow

- Board loads the authoritative first 50 Orders per page from the staff-scoped Order
  Inbox and then polls the **transactional Outbox** every 10 seconds when
  visible/online. It recovers on `online`, window focus and tab visibility.
  The Orders list is the only source of truth; event envelopes are advisory.
- The API offers only role-permitted transitions. The Angular buttons mirror
  the policy: owner/manager/cashier can accept and cancel a submitted Order;
  kitchen staff can start preparing an accepted Order and serve a preparing
  Order; owner/manager can do both. Backend enforces permission anyway.
- A write sends `expectedStatus` and `nextStatus` with Session cookie,
  approved Origin and CSRF double-submit token, never applies optimistic
  status, and reloads the Inbox. A 409 warns of concurrent updates. A
  cancellation requires explicit confirmation; it never implies refund.
- The board can display a staff-scoped status history, including milestones
  and timestamps. No staff identity or history is exposed through public
  guest APIs. Payment is shown only as **not yet implemented**, and money
  is displayed from the original integer-satang server snapshots.

## Reconnection / recovery

The Outbox API returns a bounded page, `nextCursor`, `hasMore` and a
persisted per-user acknowledgment cursor. On each refresh:

1. Fetch authoritative Inbox.
2. Read the next Outbox page (beginning after previously acknowledged event).
3. Re-fetch Inbox to guard against an event committed after the first read.
4. Only if **all referenced Order IDs are visible** in the Inbox, merge
   events into a bounded deduplicated activity list and acknowledge the
   page's last cursor. If the cursor cannot safely be acknowledged, the event
   stays durable for a later retry.
5. Follow at most six 50-event pages per refresh; remaining pages are
   recovered by subsequent polls. There is **no** localStorage or session
   storage of session cookies, CSRF tokens or order details. Event IDs use
   strings/BigInt and are never converted to unsafe JS numbers.

**Current recovery policy:** Keyset pagination remains operator-controlled
(50 Orders per page, up to 20 visual history pages). Durable Outbox replay
uses a bounded **exact Order ID lookup** for referenced Orders not in visible
pages, independent of Order age or backlog size. Each Outbox page has at
most 50 event IDs; missing/foreign-store Orders prevent acknowledgment.
Multiple devices with the same staff user share a server cursor and must
recheck the authoritative API on resume. No offline writes or guaranteed
exactly-once display are claimed.

## Interaction and adverse state coverage

| Situation | Behavior |
|---|---|
| Signed out / revoked session | No Orders displayed; ask user to sign in |
| Staff opens another tenant/store | Store discovery and backend ACL reject access |
| Phone offline / tab asleep | Warning, no status mutations; refresh on resume |
| Duplicate Outbox deliveries | Deduplicate by eventId; ack monotonic |
| Concurrent status mutation (CAS 409) | No optimistic success; error + Inbox refresh |
| Outbox references an older Order (>50 Inbox limit) | Fetch exact Order ID from scoped backend before ack |
| CSRF cookie missing/expired | Reject local write and show session recovery prompt |
| Order cancelled or served | Clear terminal state; no payment/settlement claim |

## Run and quality gates

Build: `pnpm exec nx build merchant`; unit/type/lint:
`pnpm exec nx run-many -t test typecheck lint --projects=merchant`.
Start the API in the development-gated configuration and serve the Merchant
app behind **the same HTTPS origin**; every frontend API request is relative
to `/api`. Angular's local dev server can proxy `/api` to
`http://127.0.0.1:3000` for local experimentation, but the API still
requires `AUTH_ALLOWED_ORIGINS` to allow the exact frontend origin and
Secure cookies need a suitable secure development origin. No authentication
bypass or fake guest payment endpoint is added.

CI verifies Angular routing, role-specific actions, satang display,
BigInt event ordering/deduplication, Inbox coverage gating, store-scoped
discovery, session revocation and pre-existing Order/Outbox SQL/HTTP
invariants. The next gates are an end-to-end browser pilot at 320px,
tablet/desktop screenreader/keyboard audit, paginated Inbox for large
backlogs, configurable store/tenant selection for very large organizations,
real staff Google OAuth and realtime push on top of the durable Outbox.
Payment/PromptPay remains the last business feature at G5 (#7).

## G3 keyset-paginated Order Inbox (migration 018)

`GET /api/tenants/:tenantId/stores/:storeId/orders?limit=50&cursor=...`
remains session/tenant/store scoped, supports the existing optional
`status=submitted|accepted|preparing|served|cancelled` filter and returns:

```json
{
  "orders": ["... immutable Order snapshots ..."],
  "hasMore": true,
  "nextCursor": "2026-11-03T07:32:54.123456Z_00000000-0000-4000-8000-000000000001"
}
```

A cursor is **not a capability** or secret. It encodes the immutable
`created_at` timestamp with the **full PostgreSQL microsecond precision**
and its tie-breaking UUID. The SQL query uses the strict composite
`(created_at,id) < (cursor_time,cursor_uuid)`, ordered descending, with a
supporting `(tenant_id,store_id,created_at DESC,id DESC)` index. This
avoids duplicate/missing rows when multiple Orders share a timestamp or
new Orders are inserted at the front. Both cursor fields are required
together. Invalid cursors, malformed dates and limits outside 1–50 are
rejected. The final page returns `hasMore:false,nextCursor:null`.

**Merchant frontend:** The operator can load 50 older Orders at a time
using the "โหลดออเดอร์เก่า" control. Reconnect refreshes selected pages.
For each Outbox page, it compares committed event Order IDs to newly
retrieved authoritative snapshots and performs a separate bounded
`GET .../orders/lookup?ids=UUID,UUID` for missing references. It
**acknowledges only when every referenced Order is covered**. This
removes the former 1,000-Order recovery ceiling without scanning historical
pages, while retaining the 20-page limit for interactive manual browsing.
Loaded-card counters are for loaded Orders, not store-wide reports.

**Further hardening:** This closes the page-depth correctness gap but
not every production scaling concern: prolonged event bursts, cursor
retention, browser memory, process restarts, concurrent clients and
database/index load still require load/recovery testing. The exact-ID
query is limited to 50 IDs and remains staff/tenant/store scoped.
SSE is advisory; the persisted Outbox is the replay authority.
Payment remains deferred to G5.

## G3 SSE merchant notifications — PR #49 increment

The merchant board uses **native browser EventSource** to receive advisory
Order wake-up signals and requests an authoritative Inbox + Durable Outbox
reconciliation after every signal. It never updates Order status directly
from SSE and never acknowledges a notification without verifying the
referenced Orders. A compatible environment must serve Angular and the
NestJS API behind HTTPS with consistent same-origin paths.

### API and transport

`GET /api/tenants/:tenantId/stores/:storeId/notifications/stream`

- Requires a valid, non-revoked HttpOnly staff Session and the same
  tenant/store/role checks as the merchant notification polling API. When an
  `Origin` header is present it must be explicitly allowlisted. Invalid or
  cross-tenant sessions receive HTTP 401/403/404 **before** any SSE headers.
  Authentication revalidates on every server poll, so revoked sessions or
  removed memberships receive `event: access-revoked` and the stream closes.
- Sends `Content-Type: text/event-stream`, `Cache-Control: no-store,
  no-transform` and `X-Accel-Buffering: no` to discourage proxy buffering.
  Sends an initial `retry: 5000` hint and periodic `: keepalive` comments.
- Sends committed events as:
  ```text
  id: 9007199254740993
  event: order-event
  data: {"eventId":"9007199254740993","orderId":"...","eventType":"order.status.changed","status":"accepted"}

  ```
  Only event ID, Order ID, event type and operational status are included:
  no actor IDs, customer tokens, CSRF/session secrets, line-item prices or
  payment data. Event IDs remain decimal **strings**, never unsafe JS
  Numbers. The Server-Sent Events `Last-Event-ID` header is intentionally
  **ignored as an acknowledgement**. On stream reconnect, the server starts
  from the last staff acknowledgement persisted in PostgreSQL, ensuring a
  malicious/stale or ahead-of-ack browser cursor cannot silently skip
  unacknowledged Orders. Event delivery is therefore at-least-once;
  duplicates are expected and safely deduplicated by the existing Outbox.
- A server-local stream polls the committed Outbox approximately every **3
  seconds**. It does **not** use PostgreSQL LISTEN/NOTIFY, Redis pub/sub,
  WebSocket, or a broker in this increment. Reads are bounded to 50 events
  per page, with fast (50ms) catch-up while additional pages exist.
  Connection memory is capped at 32 SSE clients per API instance. Slow
  network readers are disconnected rather than buffered without limit,
  reconnecting through durable staff acknowledgements.
  A stream is rotated after 15 minutes; browser EventSource reconnects.
- The stream holds no database connection between polls. Operational
  readiness still requires measurement of CPU/DB load, pooled connections,
  reverse-proxy idle timeout, Cloudflare buffering/edge behavior, horizontal
  scaling and SSE error rates. The 32-connection cap is a deliberately
  conservative initial instance limit, **not** a production capacity claim.

### Browser lifecycle and fallback

- When a merchant opens a valid store, the Angular board establishes one
  EventSource with the session cookie. `order-event` and `open` (including
  automatic reconnection) trigger a debounced Inbox/Outbox refresh.
  The existing 10-second HTTP poll remains **active whenever SSE is
  unavailable or reconnecting**. A healthy SSE connection still performs a
  full reconciliation at least every 60 seconds.
- Background tabs release SSE connections. When the screen wakes or network
  resumes, the client opens a new SSE connection and fetches authoritative
  records. Offline, unsubscribed, destroyed or revoked pages close the
  EventSource explicitly. `access-revoked` clears retained Order cards and
  requires a fresh authenticated Session.
- SSE never triggers Payment or implies payment receipt. Money remains
  `paymentState=not_requested`; per-Order PromptPay stays deferred to
  G5 (#7).

### Testing / remaining gates

The HTTP integration suite opens real streaming connections and verifies
the MIME/cache/buffering headers, anonymous/foreign-Origin/cross-tenant
denial, a spoofed high `Last-Event-ID` not skipping unacknowledged Orders,
live submitted-to-accepted delivery after commit, **no auto-ack**, and
midstream session revocation. API unit tests verify line-safe framing,
64-bit ID preservation and payload minimization.

This does not yet qualify as production push: provider/device/browser E2E
checks, slow readers and proxy buffering in the intended hosting topology,
session churn, load tests, active-stream metrics, reconnection storm
throttling, user-visible audio/toast preferences and operational retention
are still release gates. Durable polling remains mandatory.

## G3 exact Order-ID replay — migration 021

`GET /api/tenants/:tenantId/stores/:storeId/orders/lookup?ids=UUID,UUID`
reads 1–50 unique IDs through
`rcat_private.merchant_order_lookup_ids`. This function validates the
existing active staff session and Tenant/Store role, returns the **same
immutable Order item and satang snapshots** as the paginated Inbox and
silently omits unknown or foreign-store IDs. Duplicate, missing or
malformed IDs are rejected; no direct Order table grants are added.
The Angular board refuses to acknowledge an Outbox page unless the
returned current snapshot covers **every** referenced Order ID.
No client-provided UUID or SSE event ID is permission to query another
store. The endpoint is `Cache-Control: no-store` and cannot mark an Order
paid or change its fulfilment state.

Real PostgreSQL integration verifies an Order beyond the first 50,
tenant isolation and duplicate-ID rejection. HTTP integration verifies
staff-only access, cross-tenant denial and current immutable Order
snapshots. Angular tests cover targeted recovery from a simulated
1,200-Order backlog.
