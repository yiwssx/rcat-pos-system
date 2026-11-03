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

**Important limitations:** The Inbox uses keyset pagination with 50 Orders per page. The board checks
up to 20 pages (1,000 Orders) on each refresh/replay; if older Orders lie
outside that explicit bounded recovery window, it deliberately **does not
acknowledge them** and raises a warning. Thus durable event persistence is in place but full
high-volume recovery is still blocked until a paginated authoritative
Orders endpoint is added. Multiple devices signed in as the same staff user
share the server acknowledgment cursor; another device always re-fetches
Inbox on resume. At-least-once replay is supported; exactly-once display,
offline writes, real push/WebSocket/SSE, broker workers, production-ready
rate limits and event retention are not claimed.

## Interaction and adverse state coverage

| Situation | Behavior |
|---|---|
| Signed out / revoked session | No Orders displayed; ask user to sign in |
| Staff opens another tenant/store | Store discovery and backend ACL reject access |
| Phone offline / tab asleep | Warning, no status mutations; refresh on resume |
| Duplicate Outbox deliveries | Deduplicate by eventId; ack monotonic |
| Concurrent status mutation (CAS 409) | No optimistic success; error + Inbox refresh |
| Outbox references an older Order (>50 Inbox limit) | Do not ack; show coverage warning |
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
using the "โหลดออเดอร์เก่า" control. At every reconnect the board re-fetches
the number of pages selected. For each Outbox batch, it reads authoritative
Order pages until all referenced Order IDs are covered; **only then** does
it acknowledge that event batch. If 20 pages do not cover an event, it
shows a warning and leaves the Outbox cursor unacknowledged for retry rather
than pretending that the missing Order was processed. Loaded-card counters
are explicitly for loaded Orders, not a store-wide report.

**Further hardening:** The 20-page/1,000-Order per-refresh bound is a
safety limit, **not** full historical recovery at arbitrary volume. A
server-side batched Order-by-ID lookup or dedicated worker / store-level
read model, dynamic scanning budgets, and load/performance testing are
recommended before public Production. The 10-second polling is not
push delivery; SSE/WebSocket remains a separate increment. No Payment
state was changed; G5 PromptPay per Order remains LAST.
