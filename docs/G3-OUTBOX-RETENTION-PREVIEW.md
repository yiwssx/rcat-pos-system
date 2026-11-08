# G3 Order Outbox: read-only retention preview and safety gate

G3 does **not** delete Order events yet. A database administrator can review
Outbox accumulation with a PostgreSQL 16 `security_invoker` view:

```sql
SELECT tenant_id, store_id, event_count, older_than_30_days,
       oldest_event_at, oldest_event_id, newest_event_id,
       cursor_accounts, lowest_recorded_ack,
       events_after_slowest_recorded_ack
FROM rcat_private.order_outbox_retention_preview
ORDER BY older_than_30_days DESC, event_count DESC;
```

Use a **privileged, audited maintenance connection**; `rcat_auth`, `rcat_app`
and public users have no SELECT privilege on the view, underlying Order
Outbox or staff cursor table. The view is informational and performs no
DELETE/UPDATE, no mutation, and no per-request scan. The database integration
suite checks that it cannot change committed event data and runtime roles
are denied.

## Retention interpretation and limits

- `event_count` and `older_than_30_days` quantify retained events by
  tenant/store. The **30-day interval is an observation threshold only**,
  not an approved deletion SLA or automatic expiry.
- `cursor_accounts` counts staff accounts that have *recorded an ack
  cursor*, not every staff member currently entitled to the store.
  `lowest_recorded_ack` / `events_after_slowest_recorded_ack` therefore
  are **not proof that every active/offline device received an event**.
- The canonical Order records, durable status history and item snapshots
  remain distinct from advisory Outbox events. Never purge the only evidence
  of an unacknowledged Order, and do not equate a browser SSE receipt with a
  persisted acknowledgment or a verified payment.
- A proposed retention/purge routine must await operator approval of
  account offboarding, max offline window, backup/replay proof, recovery
  watermark, legal retention and staging failure injection. No destructive
  pruning trigger or API endpoint has been added.

## G3 dual-instance SSE regression

`tests/e2e/g4-sse-qualification.cjs` now opens two authenticated SSE feeds
on **independent Node/NestJS API processes**, with separate PostgreSQL
connection pools. One is behind the real CI Merchant HTTPS proxy and the
other uses a direct loopback test listener. A newly committed HTTP Guest
Order must produce the **same Event ID and Order** in both streams; the
test then looks up the authoritative Order via tenant-scoped Merchant API,
acknowledges the event through the primary API and verifies the
second API immediately sees the same PostgreSQL cursor. Existing tests also
verify 32 SSE sockets / instance, the 33rd HTTP 503, forged Last-Event-ID
rejection, nginx restart replay and cross-process staff session revocation.

These tests demonstrate cross-process cursor/event consistency on one
ephemeral Postgres instance; they do **not** demonstrate multi-host
production resilience, multi-hour soak, genuine Android/iOS process
suspension, load-balancer idle timeouts or alert delivery. Physical Staging
and operator signoff remain open. No Payment/PromptPay and no Production.
