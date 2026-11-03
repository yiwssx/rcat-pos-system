\set ON_ERROR_STOP on
-- Isolated tracking integration test: never persist fixtures.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
 decode(repeat('b1',32),'hex'),decode(repeat('d1',32),'hex'),
 now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 v_tenant uuid:='00000000-0000-4000-8000-000000000001';
 v_store uuid:='20000000-0000-4000-8000-000000000001';
 v_owner bytea:=decode(repeat('b1',32),'hex');
 v_visit bytea:=decode(repeat('b2',32),'hex');
 v_token1 bytea:=decode(repeat('b3',32),'hex');
 v_token2 bytea:=decode(repeat('b4',32),'hex');
 v_wrong bytea:=decode(repeat('b5',32),'hex');
 v_cat uuid;v_product uuid;v_table uuid;v_order uuid;v_second uuid;
 v_unbound uuid;v_cart jsonb;v_out jsonb;v_count integer;
 denied boolean;
BEGIN
 v_cat:=rcat_private.add_menu_category(
  v_owner,v_tenant,v_store,'tracking-test','Tracking');
 v_product:=rcat_private.add_menu_product(
  v_owner,v_tenant,v_store,v_cat,'Rice',15000);
 v_table:=rcat_private.create_ordering_table(
  v_owner,v_tenant,v_store,'Tracking table');
 PERFORM rcat_private.rotate_ordering_visit(
  v_owner,v_tenant,v_store,v_table,v_visit);
 v_cart:=jsonb_build_object('items',jsonb_build_array(
  jsonb_build_object('productId',v_product,'quantity',2,
    'optionIds',jsonb_build_array())));
 v_out:=rcat_private.place_guest_order(
  v_visit,'tracking-checkout0001',v_cart);
 v_order:=(v_out->>'orderId')::uuid;
 PERFORM rcat_private.bind_guest_order_tracking(
  v_order,v_visit,'tracking-checkout0001',v_token1);
 v_out:=rcat_private.guest_order_status(v_order,v_token1);
 IF v_out->>'status'<>'submitted' OR
    (v_out->>'amountSatang')::bigint<>30000 OR
    v_out->>'currency'<>'THB' OR
    v_out->>'paymentState'<>'not_requested'
 THEN RAISE EXCEPTION 'Guest status has wrong data'; END IF;

 v_out:=rcat_private.place_guest_order(
  v_visit,'tracking-checkout0001',v_cart);
 IF (v_out->>'orderId')::uuid<>v_order
   OR NOT (v_out->>'replayed')::boolean
 THEN RAISE EXCEPTION 'Idempotent tracking replay mismatch'; END IF;
 PERFORM rcat_private.bind_guest_order_tracking(
  v_order,v_visit,'tracking-checkout0001',v_token1);

 denied:=false;
 BEGIN
  PERFORM rcat_private.bind_guest_order_tracking(
   v_order,v_visit,'tracking-checkout0001',v_wrong);
 EXCEPTION WHEN unique_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Tracking token overwritten'; END IF;

 v_out:=rcat_private.place_guest_order(
  v_visit,'tracking-checkout0002',v_cart);
 v_second:=(v_out->>'orderId')::uuid;
 PERFORM rcat_private.bind_guest_order_tracking(
  v_second,v_visit,'tracking-checkout0002',v_token2);
 denied:=false;
 BEGIN
  PERFORM rcat_private.guest_order_status(v_second,v_token1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Other guest Order exposed'; END IF;

 denied:=false;
 BEGIN
  PERFORM rcat_private.guest_order_status(v_order,v_wrong);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid tracking bearer accepted'; END IF;

 denied:=false;
 BEGIN
  PERFORM rcat_private.guest_order_status(
    '11111111-1111-4111-8111-111111111111',v_token1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Nonexistent Order exposed'; END IF;

 v_out:=rcat_private.place_guest_order(
  v_visit,'tracking-unbound001',v_cart);
 v_unbound:=(v_out->>'orderId')::uuid;
 denied:=false;
 BEGIN
  PERFORM rcat_private.guest_order_status(v_unbound,v_token1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unbound legacy Order exposed'; END IF;

 PERFORM rcat_private.rotate_ordering_visit(
  v_owner,v_tenant,v_store,v_table,decode(repeat('b6',32),'hex'));
 v_out:=rcat_private.guest_order_status(v_order,v_token1);
 IF v_out->>'status'<>'submitted'
 THEN RAISE EXCEPTION 'Status lost on table QR rotation'; END IF;
 v_out:=rcat_private.transition_merchant_order(
  v_owner,v_tenant,v_store,v_order,'submitted','accepted');
 v_out:=rcat_private.guest_order_status(v_order,v_token1);
 IF v_out->>'status'<>'accepted' OR
    v_out->>'paymentState'<>'not_requested'
 THEN RAISE EXCEPTION 'Merchant status not reflected safely to guest'; END IF;

 denied:=false;
 BEGIN
  SELECT count(*) INTO v_count FROM rcat.orders;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Guest role direct Order reads allowed'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: Order-only tracking, replay, rotation, status changes, isolation, no payment, no direct reads'
