\set ON_ERROR_STOP on
-- G2 Bill aggregation isolation, no payment state and no persisted fixtures.
BEGIN;
INSERT INTO rcat.users(id,email,password_hash)
VALUES('10000000-0000-4000-8000-000000000003',
  'bill-kitchen@test.invalid','INVALID_TEST_HASH');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','cashier'),
 ('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','kitchen');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
  decode(repeat('a1',32),'hex'),decode(repeat('f1',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
  decode(repeat('a2',32),'hex'),decode(repeat('f2',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000003',
  decode(repeat('a3',32),'hex'),decode(repeat('f3',32),'hex'),
  now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 v_tenant uuid:='00000000-0000-4000-8000-000000000001';
 v_store uuid:='20000000-0000-4000-8000-000000000001';
 v_owner bytea:=decode(repeat('a1',32),'hex');
 v_cashier bytea:=decode(repeat('a2',32),'hex');
 v_kitchen bytea:=decode(repeat('a3',32),'hex');
 v_visit_token bytea:=decode(repeat('a7',32),'hex');
 v_new_token bytea:=decode(repeat('a8',32),'hex');
 v_cat uuid; v_product uuid; v_table uuid;
 v_visit uuid; v_second_visit uuid;
 v_order uuid; v_cancel uuid; v_late uuid;
 v_bill uuid; v_other_bill uuid;
 v_cart jsonb; v_out jsonb; v_snap jsonb;
 denied boolean;
BEGIN
 v_cat:=rcat_private.add_menu_category(
   v_owner,v_tenant,v_store,'bill-test','Bill tests');
 v_product:=rcat_private.add_menu_product(
   v_owner,v_tenant,v_store,v_cat,'Noodles',7500);
 v_table:=rcat_private.create_ordering_table(
   v_owner,v_tenant,v_store,'Bill test table');
 SELECT visit_id INTO v_visit FROM rcat_private.rotate_ordering_visit(
   v_owner,v_tenant,v_store,v_table,v_visit_token);
 v_cart:=jsonb_build_object('items',jsonb_build_array(
   jsonb_build_object('productId',v_product,'quantity',2,
     'optionIds',jsonb_build_array())));

 denied:=false;
 BEGIN
  PERFORM rcat_private.create_operational_bill(
    v_owner,v_tenant,v_store,v_visit);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Empty table Bill was created'; END IF;

 v_out:=rcat_private.place_guest_order(
   v_visit_token,'bill-first-order-001',v_cart);
 v_order:=(v_out->>'orderId')::uuid;
 v_out:=rcat_private.place_guest_order(
   v_visit_token,'bill-second-order001',
   jsonb_build_object('items',jsonb_build_array(
     jsonb_build_object('productId',v_product,'quantity',1,
       'optionIds',jsonb_build_array()))));
 v_cancel:=(v_out->>'orderId')::uuid;
 IF v_cancel=v_order THEN RAISE EXCEPTION 'Orders were incorrectly merged'; END IF;
 v_out:=rcat_private.create_operational_bill(
   v_cashier,v_tenant,v_store,v_visit);
 IF NOT (v_out->>'created')::boolean THEN
   RAISE EXCEPTION 'Bill was not first-created'; END IF;
 v_bill:=(v_out->>'billId')::uuid;
 v_out:=rcat_private.create_operational_bill(
   v_owner,v_tenant,v_store,v_visit);
 IF (v_out->>'billId')::uuid<>v_bill
    OR (v_out->>'created')::boolean THEN
   RAISE EXCEPTION 'Repeated Bill creation was not idempotent'; END IF;

 v_snap:=rcat_private.operational_bill_snapshot(
   v_kitchen,v_tenant,v_store,v_bill,1);
 IF (v_snap->>'operationalTotalSatang')::bigint<>22500
   OR (v_snap->>'cancelledTotalSatang')::bigint<>0
   OR (v_snap->>'orderCount')::integer<>2
   OR NOT (v_snap->>'hasMore')::boolean
   OR jsonb_array_length(v_snap->'orders')<>1
   OR v_snap?'paymentStatus'
 THEN RAISE EXCEPTION 'Bill pagination/aggregation leaked financial state'; END IF;
 v_snap:=rcat_private.operational_bill_snapshot(
   v_owner,v_tenant,v_store,v_bill,50);
 IF (v_snap->>'hasMore')::boolean
   OR jsonb_array_length(v_snap->'orders')<>2
   OR (v_snap->'orders'->0->>'orderId') IS NULL
 THEN RAISE EXCEPTION 'Bill order listing incorrect'; END IF;

 PERFORM rcat_private.transition_merchant_order(
   v_owner,v_tenant,v_store,v_cancel,'submitted','cancelled');
 v_snap:=rcat_private.operational_bill_snapshot(
   v_owner,v_tenant,v_store,v_bill,50);
 IF (v_snap->>'operationalTotalSatang')::bigint<>15000
   OR (v_snap->>'cancelledTotalSatang')::bigint<>7500
 THEN RAISE EXCEPTION 'Cancelled amount was conflated with active'; END IF;
 v_out:=rcat_private.place_guest_order(
   v_visit_token,'bill-late-order-001',
   jsonb_build_object('items',jsonb_build_array(
     jsonb_build_object('productId',v_product,'quantity',1,
       'optionIds',jsonb_build_array()))));
 v_late:=(v_out->>'orderId')::uuid;
 v_snap:=rcat_private.operational_bill_snapshot(
   v_owner,v_tenant,v_store,v_bill,50);
 IF (v_snap->>'operationalTotalSatang')::bigint<>22500
   OR (v_snap->>'orderCount')::integer<>3
   OR (v_snap->>'cancelledTotalSatang')::bigint<>7500
 THEN RAISE EXCEPTION 'New Order was not included in existing Visit Bill'; END IF;

 denied:=false;
 BEGIN
   PERFORM rcat_private.create_operational_bill(
     v_kitchen,v_tenant,v_store,v_visit);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Kitchen was allowed to create Bill'; END IF;

 denied:=false;
 BEGIN
   PERFORM rcat_private.create_operational_bill(
     v_owner,'00000000-0000-4000-8000-000000000002',
     '20000000-0000-4000-8000-000000000002',v_visit);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant Bill mutation allowed'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.operational_bill_snapshot(
     v_cashier,'00000000-0000-4000-8000-000000000002',
     '20000000-0000-4000-8000-000000000002',v_bill,50);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant Bill read allowed'; END IF;

 denied:=false;
 BEGIN
   PERFORM rcat_private.operational_bill_snapshot(
     v_owner,v_tenant,v_store,v_bill,0);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unbounded bill read accepted'; END IF;

 -- Rotation starts another table visit and therefore another Bill.
 SELECT visit_id INTO v_second_visit
   FROM rcat_private.rotate_ordering_visit(
     v_owner,v_tenant,v_store,v_table,v_new_token);
 v_out:=rcat_private.place_guest_order(
   v_new_token,'bill-other-visit001',v_cart);
 v_out:=rcat_private.create_operational_bill(
   v_owner,v_tenant,v_store,v_second_visit);
 v_other_bill:=(v_out->>'billId')::uuid;
 IF v_bill=v_other_bill THEN
    RAISE EXCEPTION 'Two table visits were merged into one Bill'; END IF;
 v_snap:=rcat_private.operational_bill_snapshot(
   v_owner,v_tenant,v_store,v_bill,50);
 IF (v_snap->>'orderCount')::integer<>3 THEN
    RAISE EXCEPTION 'New visit contaminated old Bill'; END IF;
 v_snap:=rcat_private.operational_bill_snapshot(
   v_owner,v_tenant,v_store,v_other_bill,50);
 IF (v_snap->>'orderCount')::integer<>1 OR
   (v_snap->>'operationalTotalSatang')::bigint<>15000 THEN
   RAISE EXCEPTION 'New visit Bill aggregate incorrect'; END IF;

 denied:=false;
 BEGIN
   INSERT INTO rcat.bills(tenant_id,store_id,table_id,visit_id,created_by)
   VALUES(v_tenant,v_store,v_table,v_visit,
     '10000000-0000-4000-8000-000000000001');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Auth role directly inserted Bill'; END IF;

 PERFORM set_config('test.bill_id',v_bill::text,true);
 PERFORM set_config('test.second_bill_id',v_other_bill::text,true);
 PERFORM set_config('test.first_order_id',v_order::text,true);
 PERFORM set_config('test.cancel_order_id',v_cancel::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE v_bill uuid:=current_setting('test.bill_id')::uuid;
 v_other uuid:=current_setting('test.second_bill_id')::uuid;
 v_order uuid:=current_setting('test.first_order_id')::uuid;
 v_cancel uuid:=current_setting('test.cancel_order_id')::uuid;
 v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM rcat.bills
  WHERE id IN (v_bill,v_other);
 IF v_count<>2 THEN RAISE EXCEPTION 'Bill creation duplicated or lost'; END IF;
 SELECT count(*) INTO v_count FROM rcat.audit_events
  WHERE action='bill.operational.created'
    AND subject_id IN (v_bill,v_other);
 IF v_count<>2 THEN RAISE EXCEPTION 'Bill audit not exactly once'; END IF;
 SELECT count(*) INTO v_count FROM rcat.orders
  WHERE id IN (v_order,v_cancel)
    AND payment_state='not_requested' AND amount_satang IN (15000,7500);
 IF v_count<>2 THEN RAISE EXCEPTION 'Original Order payment obligation mutated'; END IF;
 SELECT count(*) INTO v_count FROM rcat.order_items
  WHERE order_id IN (v_order,v_cancel)
    AND line_total_satang IN (15000,7500);
 IF v_count<>2 THEN RAISE EXCEPTION 'Original item snapshots mutated'; END IF;
END $$;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id',
  '00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.bills)<>0 THEN
   RAISE EXCEPTION 'Cross-tenant Bill RLS failed'; END IF;
END $$;
SELECT set_config('app.tenant_id',
  '00000000-0000-4000-8000-000000000001',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.bills)<>2 THEN
   RAISE EXCEPTION 'Own tenant Bill RLS unavailable'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: operational Bill aggregates, cancellations, idempotency, role gates, visit isolation and RLS'
