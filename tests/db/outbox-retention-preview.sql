\set ON_ERROR_STOP on
-- Operator-only read exposure test, all live Order fixtures rolled back.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
  decode(repeat('f1',32),'hex'),decode(repeat('f2',32),'hex'),
  now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 a uuid:='00000000-0000-4000-8000-000000000001';
 st uuid:='20000000-0000-4000-8000-000000000001';
 staff bytea:=decode(repeat('f1',32),'hex');
 token bytea:=decode(repeat('f3',32),'hex');
 cat uuid;product uuid;tbl uuid;
 first_order jsonb;second_order jsonb;
 first_id bigint;
BEGIN
 cat:=rcat_private.add_menu_category(staff,a,st,
   'retention-audit-ci','Outbox Retention CI');
 product:=rcat_private.add_menu_product(staff,a,st,cat,'Outbox CI Menu',10500);
 tbl:=rcat_private.create_ordering_table(staff,a,st,'Outbox retention test table');
 PERFORM rcat_private.rotate_ordering_visit(staff,a,st,tbl,token);
 first_order:=rcat_private.place_guest_order(
   token,'retention-audit-key-0001',
   jsonb_build_object('items',jsonb_build_array(
     jsonb_build_object('productId',product,'quantity',1,
       'optionIds','[]'::jsonb))));
 second_order:=rcat_private.place_guest_order(
   token,'retention-audit-key-0002',
   jsonb_build_object('items',jsonb_build_array(
     jsonb_build_object('productId',product,'quantity',1,
       'optionIds','[]'::jsonb))));
 SELECT e.id INTO first_id
 FROM rcat.order_outbox_events e
 WHERE e.order_id=(first_order->>'orderId')::uuid;
 IF first_id IS NULL THEN RAISE EXCEPTION 'Missing first Outbox event'; END IF;
 PERFORM rcat_private.ack_merchant_order_notification(staff,a,st,first_id);
 PERFORM set_config('test.retention_first',first_order->>'orderId',true);
 PERFORM set_config('test.retention_second',second_order->>'orderId',true);
END $$;
RESET ROLE;
DO $$
DECLARE
 a uuid:='00000000-0000-4000-8000-000000000001';
 st uuid:='20000000-0000-4000-8000-000000000001';
 first_order uuid:=current_setting('test.retention_first')::uuid;
 second_order uuid:=current_setting('test.retention_second')::uuid;
 original bigint;after_count bigint;
 audit record;
BEGIN
 SELECT count(*) INTO original FROM rcat.order_outbox_events
 WHERE order_id IN (first_order,second_order);
 IF original<>2 THEN RAISE EXCEPTION 'Two Orders must each append an event'; END IF;
 SELECT * INTO audit FROM rcat_private.order_outbox_retention_preview
 WHERE tenant_id=a AND store_id=st;
 IF NOT FOUND OR audit.event_count<2 OR audit.cursor_accounts<1
   OR audit.events_after_slowest_recorded_ack<1
   OR audit.newest_event_id<audit.oldest_event_id
 THEN RAISE EXCEPTION 'Outbox retention preview counters incorrect'; END IF;
 SELECT count(*) INTO after_count FROM rcat.order_outbox_events
 WHERE order_id IN (first_order,second_order);
 IF after_count<>original THEN
   RAISE EXCEPTION 'Read-only retention audit mutated durable Outbox'; END IF;
END $$;
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE denied boolean:=false;v bigint;
BEGIN
 BEGIN
   SELECT count(*) INTO v FROM rcat_private.order_outbox_retention_preview;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Runtime auth role can read DBA audit view'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: DBA-only Outbox retention audit, no deletion, runtime access denied'
