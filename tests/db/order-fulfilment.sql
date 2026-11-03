\set ON_ERROR_STOP on
-- Ephemeral PostgreSQL integration; all changes (including audit) are rolled back.
BEGIN;
INSERT INTO rcat.users(id,email,password_hash) VALUES
 ('10000000-0000-4000-8000-000000000003','kitchen@test.invalid','INVALID_TEST_HASH');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','cashier'),
 ('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','kitchen');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
   decode(repeat('e1',32),'hex'),decode(repeat('e4',32),'hex'),now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
   decode(repeat('e2',32),'hex'),decode(repeat('e5',32),'hex'),now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000003',
   decode(repeat('e3',32),'hex'),decode(repeat('e6',32),'hex'),now()+interval '1 hour');

SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 v_tenant uuid:='00000000-0000-4000-8000-000000000001';
 v_store uuid:='20000000-0000-4000-8000-000000000001';
 v_owner bytea:=decode(repeat('e1',32),'hex');
 v_cashier bytea:=decode(repeat('e2',32),'hex');
 v_kitchen bytea:=decode(repeat('e3',32),'hex');
 v_category uuid; v_product uuid; v_table uuid; v_order uuid; v_cancel uuid;
 v_cart jsonb; v_result jsonb; v_inbox jsonb;
 denied boolean;
BEGIN
 v_category:=rcat_private.add_menu_category(
   v_owner,v_tenant,v_store,'fulfilment-test','Fulfilment');
 v_product:=rcat_private.add_menu_product(
   v_owner,v_tenant,v_store,v_category,'Test bowl',12500);
 v_table:=rcat_private.create_ordering_table(
   v_owner,v_tenant,v_store,'Fulfilment table');
 PERFORM rcat_private.rotate_ordering_visit(
   v_owner,v_tenant,v_store,v_table,decode(repeat('ef',32),'hex'));
 v_cart:=jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('productId',v_product,'quantity',1,
      'optionIds',jsonb_build_array())));
 v_result:=rcat_private.place_guest_order(
   decode(repeat('ef',32),'hex'),'fulfilment-accepted-01',v_cart);
 v_order:=(v_result->>'orderId')::uuid;
 v_result:=rcat_private.place_guest_order(
   decode(repeat('ef',32),'hex'),'fulfilment-cancelled-01',v_cart);
 v_cancel:=(v_result->>'orderId')::uuid;

 v_inbox:=rcat_private.merchant_order_inbox(v_owner,v_tenant,v_store,NULL,25);
 IF jsonb_array_length(v_inbox->'orders')<>2
   OR (v_inbox->'orders'->0->>'amountSatang')::bigint<>12500
   OR jsonb_array_length(v_inbox->'orders'->0->'items')<>1
   OR v_inbox->'orders'->0->>'paymentState'<>'not_requested'
 THEN RAISE EXCEPTION 'Merchant inbox lost priced Order snapshot'; END IF;
 IF jsonb_array_length(
   (rcat_private.merchant_order_inbox(v_kitchen,v_tenant,v_store,'submitted',1))->'orders'
 )<>1 THEN RAISE EXCEPTION 'Kitchen inbox filter/limit failed'; END IF;

 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_order_inbox(
     v_cashier,'00000000-0000-4000-8000-000000000002',v_store,NULL,25);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant merchant read allowed'; END IF;

 denied:=false;
 BEGIN
  PERFORM rcat_private.transition_merchant_order(
    v_kitchen,v_tenant,v_store,v_order,'submitted','accepted');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Kitchen accepted submitted Order'; END IF;

 v_result:=rcat_private.transition_merchant_order(
   v_cashier,v_tenant,v_store,v_order,'submitted','accepted');
 IF v_result->>'status'<>'accepted' THEN
   RAISE EXCEPTION 'Cashier failed to accept'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.transition_merchant_order(
    v_cashier,v_tenant,v_store,v_order,'submitted','cancelled');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Concurrent stale write not rejected'; END IF;

 denied:=false;
 BEGIN
  PERFORM rcat_private.transition_merchant_order(
    v_cashier,v_tenant,v_store,v_order,'accepted','served');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cashier skipped preparation'; END IF;

 PERFORM rcat_private.transition_merchant_order(
   v_kitchen,v_tenant,v_store,v_order,'accepted','preparing');
 v_result:=rcat_private.transition_merchant_order(
   v_kitchen,v_tenant,v_store,v_order,'preparing','served');
 IF v_result->>'status'<>'served' OR
    v_result->>'paymentState'<>'not_requested'
 THEN RAISE EXCEPTION 'Serving falsely mutated payment state'; END IF;

 denied:=false;
 BEGIN
  PERFORM rcat_private.transition_merchant_order(
    v_owner,v_tenant,v_store,v_order,'served','cancelled');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Served Order was cancelled'; END IF;
 PERFORM rcat_private.transition_merchant_order(
   v_cashier,v_tenant,v_store,v_cancel,'submitted','cancelled');

 denied:=false;
 BEGIN
  UPDATE rcat.orders SET status='accepted' WHERE id=v_order;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Auth role directly mutated Order'; END IF;
 PERFORM set_config('test.fulfilment_order',v_order::text,true);
 PERFORM set_config('test.fulfilment_cancel',v_cancel::text,true);
END $$;
RESET ROLE;

DO $$
DECLARE v_order uuid:=current_setting('test.fulfilment_order')::uuid;
 v_cancel uuid:=current_setting('test.fulfilment_cancel')::uuid; v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM rcat.audit_events
 WHERE action='order.status.changed' AND subject_id=v_order;
 IF v_count<>3 THEN RAISE EXCEPTION 'Fulfilment audit is not exactly-once'; END IF;
 SELECT count(*) INTO v_count FROM rcat.audit_events
 WHERE action='order.status.changed' AND subject_id=v_cancel
   AND metadata->>'to'='cancelled';
 IF v_count<>1 THEN RAISE EXCEPTION 'Cancellation audit missing'; END IF;
 SELECT count(*) INTO v_count FROM rcat.orders
 WHERE id=v_order AND status='served' AND amount_satang=12500
   AND payment_state='not_requested';
 IF v_count<>1 THEN RAISE EXCEPTION 'Immutable amount or state changed'; END IF;
 SELECT count(*) INTO v_count FROM rcat.order_items
 WHERE order_id=v_order AND unit_price_satang=12500
   AND line_total_satang=12500;
 IF v_count<>1 THEN RAISE EXCEPTION 'Order item snapshot was modified'; END IF;
END $$;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.orders)<>0 THEN
   RAISE EXCEPTION 'Cross-tenant Order RLS bypassed by fulfilment'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: merchant inbox, role gates, linear fulfilment, stale-state conflict, audit, snapshots and tenant RLS'
