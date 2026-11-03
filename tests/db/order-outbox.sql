\set ON_ERROR_STOP on
-- Ephemeral database test: commit-order notifications, replay and staff acks.
BEGIN;
INSERT INTO rcat.stores(id,tenant_id,slug,display_name) VALUES
 ('20000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-000000000001',
  'outbox-other-store','Outbox Other Store');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','cashier');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
  decode(repeat('91',32),'hex'),decode(repeat('92',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
  decode(repeat('93',32),'hex'),decode(repeat('94',32),'hex'),
  now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 v_tenant uuid:='00000000-0000-4000-8000-000000000001';
 v_store uuid:='20000000-0000-4000-8000-000000000001';
 v_other_store uuid:='20000000-0000-4000-8000-000000000099';
 v_owner bytea:=decode(repeat('91',32),'hex');
 v_cashier bytea:=decode(repeat('93',32),'hex');
 v_visit_token bytea:=decode(repeat('95',32),'hex');
 v_cat uuid;v_prod uuid;v_table uuid;v_o1 uuid;v_o2 uuid;
 v_cart jsonb;v_out jsonb;v_feed jsonb;v_paged jsonb;
 v_ack jsonb;v_first bigint;v_second bigint;v_last bigint;
 v_before integer;v_after integer;denied boolean;
BEGIN
 v_cat:=rcat_private.add_menu_category(
   v_owner,v_tenant,v_store,'outbox-test','Outbox');
 v_prod:=rcat_private.add_menu_product(
   v_owner,v_tenant,v_store,v_cat,'Noodles',9900);
 v_table:=rcat_private.create_ordering_table(
   v_owner,v_tenant,v_store,'Outbox test table');
 PERFORM rcat_private.rotate_ordering_visit(
   v_owner,v_tenant,v_store,v_table,v_visit_token);
 v_cart:=jsonb_build_object('items',jsonb_build_array(
   jsonb_build_object('productId',v_prod,'quantity',1,
     'optionIds',jsonb_build_array())));

 v_feed:=rcat_private.merchant_order_notifications(
   v_owner,v_tenant,v_store,NULL,25);
 IF jsonb_array_length(v_feed->'events')<>0
    OR v_feed->>'acknowledgedCursor'<>'0'
    OR v_feed->>'nextCursor'<>'0'
 THEN RAISE EXCEPTION 'New merchant feed is not empty'; END IF;

 v_out:=rcat_private.place_guest_order(
   v_visit_token,'outbox-first-order-001',v_cart);
 v_o1:=(v_out->>'orderId')::uuid;
 v_out:=rcat_private.place_guest_order(
   v_visit_token,'outbox-first-order-001',v_cart);
 IF (v_out->>'orderId')::uuid<>v_o1
    OR NOT (v_out->>'replayed')::boolean
 THEN RAISE EXCEPTION 'Checkout replay was not idempotent'; END IF;
 v_feed:=rcat_private.merchant_order_notifications(
   v_owner,v_tenant,v_store,NULL,25);
 IF jsonb_array_length(v_feed->'events')<>1
    OR v_feed#>>'{events,0,eventType}'<>'order.submitted'
    OR v_feed#>>'{events,0,status}'<>'submitted'
    OR v_feed#>>'{events,0,orderId}'<>v_o1::text
    OR (v_feed#>'{events,0}')?'trackingToken'
 THEN RAISE EXCEPTION 'Initial Order enqueue failed or leaked tokens'; END IF;
 v_first:=(v_feed#>>'{events,0,eventId}')::bigint;
 IF v_first<1 THEN RAISE EXCEPTION 'Outbox cursor invalid'; END IF;

 v_before:=jsonb_array_length(v_feed->'events');
 denied:=false;
 BEGIN
  PERFORM rcat_private.place_guest_order(
    v_visit_token,'outbox-failed-order-01',
    jsonb_build_object('items',jsonb_build_array(
      jsonb_build_object('productId',
        '11111111-1111-4111-8111-111111111111',
        'quantity',1,'optionIds',jsonb_build_array()))));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid checkout succeeded'; END IF;
 v_feed:=rcat_private.merchant_order_notifications(
   v_owner,v_tenant,v_store,NULL,25);
 IF jsonb_array_length(v_feed->'events')<>v_before THEN
   RAISE EXCEPTION 'Rolled-back checkout published ghost notification'; END IF;

 v_out:=rcat_private.place_guest_order(
   v_visit_token,'outbox-second-order001',v_cart);
 v_o2:=(v_out->>'orderId')::uuid;
 PERFORM rcat_private.transition_merchant_order(
   v_cashier,v_tenant,v_store,v_o1,'submitted','accepted');
 denied:=false;
 BEGIN
  PERFORM rcat_private.transition_merchant_order(
    v_owner,v_tenant,v_store,v_o1,'submitted','cancelled');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale transition accepted'; END IF;
 PERFORM rcat_private.transition_merchant_order(
   v_owner,v_tenant,v_store,v_o1,'accepted','preparing');
 PERFORM rcat_private.transition_merchant_order(
   v_owner,v_tenant,v_store,v_o1,'preparing','served');
 PERFORM rcat_private.transition_merchant_order(
   v_cashier,v_tenant,v_store,v_o2,'submitted','cancelled');
 v_feed:=rcat_private.merchant_order_notifications(
   v_owner,v_tenant,v_store,'0'::bigint,25);
 IF jsonb_array_length(v_feed->'events')<>6
    OR v_feed#>>'{events,0,eventType}'<>'order.submitted'
    OR v_feed#>>'{events,1,eventType}'<>'order.submitted'
    OR v_feed#>>'{events,2,eventType}'<>'order.status.changed'
    OR v_feed#>>'{events,2,status}'<>'accepted'
    OR v_feed#>>'{events,2,previousStatus}'<>'submitted'
    OR v_feed#>>'{events,3,status}'<>'preparing'
    OR v_feed#>>'{events,4,status}'<>'served'
    OR v_feed#>>'{events,5,status}'<>'cancelled'
    OR v_feed#>>'{events,5,previousStatus}'<>'submitted'
    OR v_feed->>'acknowledgedCursor'<>'0'
    OR (v_feed->>'hasMore')::boolean
 THEN RAISE EXCEPTION 'Outbox event set/order is incorrect'; END IF;
 v_last:=(v_feed#>>'{events,5,eventId}')::bigint;
 FOR v_paged IN SELECT value FROM jsonb_array_elements(v_feed->'events')
 LOOP
  IF (v_paged->>'eventId')::bigint<=v_first THEN
    IF v_paged->>'eventId'<>v_first::text THEN
      RAISE EXCEPTION 'Outbox event cursor not monotonic'; END IF;
  ELSE
    v_first:=(v_paged->>'eventId')::bigint;
  END IF;
 END LOOP;
 IF v_first<>v_last THEN
   RAISE EXCEPTION 'Outbox IDs are not monotonically increasing'; END IF;

 v_paged:=rcat_private.merchant_order_notifications(
   v_cashier,v_tenant,v_store,0,2);
 IF jsonb_array_length(v_paged->'events')<>2
    OR NOT (v_paged->>'hasMore')::boolean
 THEN RAISE EXCEPTION 'Bounded notifications and hasMore failed'; END IF;
 v_second:=(v_paged#>>'{events,1,eventId}')::bigint;
 v_paged:=rcat_private.merchant_order_notifications(
   v_cashier,v_tenant,v_store,v_second,50);
 IF jsonb_array_length(v_paged->'events')<>4
    OR (v_paged->>'hasMore')::boolean
    OR (v_paged->>'nextCursor')::bigint<>v_last
 THEN RAISE EXCEPTION 'Cursor resume skipped or duplicated events'; END IF;
 -- GET does not acknowledge. Recovering from disconnect replays events.
 v_paged:=rcat_private.merchant_order_notifications(
   v_cashier,v_tenant,v_store,NULL,50);
 IF jsonb_array_length(v_paged->'events')<>6 THEN
   RAISE EXCEPTION 'Notifications were implicitly acknowledged'; END IF;

 v_ack:=rcat_private.ack_merchant_order_notification(
   v_cashier,v_tenant,v_store,v_second);
 IF (v_ack->>'acknowledgedCursor')::bigint<>v_second THEN
   RAISE EXCEPTION 'Ack cursor not persisted'; END IF;
 v_paged:=rcat_private.merchant_order_notifications(
   v_cashier,v_tenant,v_store,NULL,50);
 IF jsonb_array_length(v_paged->'events')<>4 OR
   (v_paged->>'acknowledgedCursor')::bigint<>v_second THEN
   RAISE EXCEPTION 'Saved ack cursor did not resume feed'; END IF;
 v_ack:=rcat_private.ack_merchant_order_notification(
   v_cashier,v_tenant,v_store,v_last);
 v_ack:=rcat_private.ack_merchant_order_notification(
   v_cashier,v_tenant,v_store,v_second);
 IF (v_ack->>'acknowledgedCursor')::bigint<>v_last THEN
   RAISE EXCEPTION 'Stale ack moved cursor backward'; END IF;
 v_paged:=rcat_private.merchant_order_notifications(
   v_cashier,v_tenant,v_store,NULL,50);
 IF jsonb_array_length(v_paged->'events')<>0
    OR v_paged->>'nextCursor'<>v_last::text
 THEN RAISE EXCEPTION 'Reconnect after full ack is not empty'; END IF;
 v_paged:=rcat_private.merchant_order_notifications(
   v_owner,v_tenant,v_store,NULL,50);
 IF jsonb_array_length(v_paged->'events')<>6 THEN
   RAISE EXCEPTION 'Cashier ack incorrectly advanced owner cursor'; END IF;

 v_paged:=rcat_private.merchant_order_notifications(
   v_owner,v_tenant,v_other_store,NULL,50);
 IF jsonb_array_length(v_paged->'events')<>0 THEN
   RAISE EXCEPTION 'Another store leaked notifications'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.ack_merchant_order_notification(
    v_owner,v_tenant,v_other_store,v_last);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-store ack accepted'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.merchant_order_notifications(
    v_owner,'00000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',NULL,25);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant feed accepted'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.merchant_order_notifications(
    v_owner,v_tenant,v_store,NULL,51);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unbounded notifications accepted'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.ack_merchant_order_notification(
    v_owner,v_tenant,v_store,v_last+999);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Nonexistent future ack accepted'; END IF;
 denied:=false;
 BEGIN
  INSERT INTO rcat.order_outbox_events(
    tenant_id,store_id,order_id,table_id,event_type,status
  ) VALUES(v_tenant,v_store,v_o1,v_table,'order.submitted','submitted');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Auth role directly enqueued event'; END IF;
 denied:=false;
 BEGIN
  UPDATE rcat.order_notification_cursors SET last_event_id=0
  WHERE tenant_id=v_tenant AND store_id=v_store;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Auth role directly reset acknowledgements'; END IF;
 PERFORM set_config('test.outbox_o1',v_o1::text,true);
 PERFORM set_config('test.outbox_o2',v_o2::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE v_o1 uuid:=current_setting('test.outbox_o1')::uuid;
 v_o2 uuid:=current_setting('test.outbox_o2')::uuid;
 v_num integer;
BEGIN
 SELECT count(*) INTO v_num FROM rcat.order_outbox_events
 WHERE order_id IN (v_o1,v_o2);
 IF v_num<>6 THEN RAISE EXCEPTION 'Outbox should contain exactly six events'; END IF;
 SELECT count(*) INTO v_num FROM rcat.audit_events
 WHERE subject_id IN (v_o1,v_o2) AND action='order.status.changed';
 IF v_num<>4 THEN RAISE EXCEPTION 'Rejected transition appended audit'; END IF;
 SELECT count(*) INTO v_num FROM rcat.orders
 WHERE id IN (v_o1,v_o2) AND amount_satang=9900
 AND payment_state='not_requested';
 IF v_num<>2 THEN RAISE EXCEPTION 'Outbox changed monetary obligations'; END IF;
END $$;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id',
  '00000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE denied boolean:=false;v_count integer;
BEGIN
 BEGIN
  SELECT count(*) INTO v_count FROM rcat.order_outbox_events;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'App role could read outbox directly'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: committed outbox, rollback, replay, cursor/acks, RBAC, tenant/store isolation'
