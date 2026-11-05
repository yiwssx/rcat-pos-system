\set ON_ERROR_STOP on
-- Run against rcat_ci_restore ONLY after restoring from a CI-only dump.
SELECT set_config('test.expected_migrations', :'expected_migrations', false);
DO $$
BEGIN
  IF current_database() <> 'rcat_ci_restore' THEN
    RAISE EXCEPTION 'Recovery assertions must not run outside rcat_ci_restore';
  END IF;
  IF (SELECT count(*) FROM rcat.orders) <> 2 THEN
    RAISE EXCEPTION 'Restore lost Order records';
  END IF;
  IF (SELECT count(*) FROM rcat.order_outbox_events) <> 5 THEN
    RAISE EXCEPTION 'Restore lost committed Outbox records';
  END IF;
  IF (SELECT count(*) FROM rcat.orders WHERE payment_state='not_requested'
      AND amount_satang=12500) <> 2 THEN
    RAISE EXCEPTION 'Restore changed immutable Order amounts / payment state';
  END IF;
  IF (SELECT count(*) FROM rcat.audit_events
      WHERE action='order.status.changed') <> 3 THEN
    RAISE EXCEPTION 'Restore lost Order audit events';
  END IF;
  IF (SELECT count(*) FROM rcat_migrations.applied) <>
      current_setting('test.expected_migrations')::integer THEN
    RAISE EXCEPTION 'Restore lost checksummed migration ledger';
  END IF;
END $$;

-- A restored database must preserve RLS and the separation of auth/tenant
-- roles. Setting a tenant ID must never be sufficient to view another tenant.
BEGIN;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id',
  '00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
  IF (SELECT count(*) FROM rcat.orders) <> 0 OR
     (SELECT count(*) FROM rcat.stores) <> 1 THEN
    RAISE EXCEPTION 'Restored database leaked cross-tenant Orders';
  END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE v_feed jsonb;
BEGIN
  v_feed := rcat_private.merchant_order_notifications(
    decode(repeat('f1',32),'hex'),
    '00000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',NULL,50);
  IF jsonb_array_length(v_feed->'events') <> 5 OR
     v_feed#>>'{events,4,eventType}' IS NULL THEN
    RAISE EXCEPTION 'Restored replay unread events are missing';
  END IF;
END $$;
ROLLBACK;
\echo 'PASS: restore preserved RLS, Outbox replay, session, audit and Payment not_requested'
