-- G3/G4 operator-only, non-destructive visibility into durable Order Outbox
-- retention exposure. This is NOT an event purge policy or authorization gate.
-- Postgres 16 invoker view and no runtime grants; only a DBA may inspect it.
CREATE VIEW rcat_private.order_outbox_retention_preview
WITH (security_invoker=true) AS
SELECT
  e.tenant_id,
  e.store_id,
  count(*)::bigint AS event_count,
  count(*) FILTER (
    WHERE e.occurred_at < clock_timestamp()-interval '30 days'
  )::bigint AS older_than_30_days,
  min(e.occurred_at) AS oldest_event_at,
  min(e.id) AS oldest_event_id,
  max(e.id) AS newest_event_id,
  coalesce(c.cursor_accounts,0)::bigint AS cursor_accounts,
  coalesce(c.lowest_ack_id,0)::bigint AS lowest_recorded_ack,
  count(*) FILTER (
    WHERE e.id > coalesce(c.lowest_ack_id,0)
  )::bigint AS events_after_slowest_recorded_ack
FROM rcat.order_outbox_events e
LEFT JOIN (
  SELECT tenant_id,store_id,
    count(*)::bigint AS cursor_accounts,
    min(last_event_id) AS lowest_ack_id
  FROM rcat.order_notification_cursors
  GROUP BY tenant_id,store_id
) c ON c.tenant_id=e.tenant_id AND c.store_id=e.store_id
GROUP BY e.tenant_id,e.store_id,
  c.cursor_accounts,c.lowest_ack_id;

REVOKE ALL ON rcat_private.order_outbox_retention_preview
  FROM PUBLIC,rcat_auth,rcat_app;
-- No DELETE/UPDATE function or trigger is installed.
