\set ON_ERROR_STOP on
-- Ephemeral PostgreSQL status timeline integration; roll back fixture/audit.
BEGIN;
INSERT INTO rcat.users(id,email,password_hash) VALUES
 ('10000000-0000-4000-8000-000000000003',
  'history-kitchen@test.invalid','INVALID_TEST_HASH');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','cashier'),
 ('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','kitchen');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
  decode(repeat('71',32),'hex'),decode(repeat('72',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
  decode(repeat('73',32),'hex'),decode(repeat('74',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000003',
  decode(repeat('75',32),'hex'),decode(repeat('76',32),'hex'),
  now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 v_tenant uuid:='00000000-0000-4000-8000-000000000001';
 v_store uuid:='20000000-0000-4000-8000-000000000001';
 v_owner bytea:=decode(repeat('71',32),'hex');
 v_cashier bytea:=decode(repeat('73',32),'hex');
 v_kitchen bytea:=decode(repeat('75',32),'hex');
 v_visit bytea:=decode(repeat('78',32),'hex');
 v_token1 bytea:=decode(repeat('79',32),'hex');
 v_token2 bytea:=decode(repeat('7a',32),'hex');
 v_wrong bytea:=decode(repeat('7b',32),'hex');
 v_cat uuid;v_product uuid;v_table uuid;v_order uuid;v_other uuid;
 v_unbound uuid;v_cart jsonb;v_out jsonb;v_hist jsonb;v_guest jsonb;
 v_first bigint;v_second bigint;v_third bigint;denied boolean;
BEGIN
 v_cat:=rcat_private.add_menu_category(
   v_owner,v_tenant,v_store,'history-test','History');
 v_product:=rcat_private.add_menu_product(
   v_owner,v_tenant,v_store,v_cat,'History bowl',23000);
 v_table:=rcat_private.create_ordering_table(
   v_owner,v_tenant,v_store,'History table');
 PERFORM rcat_private.rotate_ordering_visit(
   v_owner,v_tenant,v_store,v_table,v_visit);
 v_cart:=jsonb_build_object('items',jsonb_build_array(
   jsonb_build_object('productId',v_product,'quantity',1,
     'optionIds',jsonb_build_array())));

 v_out:=rcat_private.place_guest_order(
   v_visit,'history-checkout-001',v_cart);
 v_order:=(v_out->>'orderId')::uuid;
 PERFORM rcat_private.bind_guest_order_tracking(
   v_order,v_visit,'history-checkout-001',v_token1);

 v_hist:=rcat_private.guest_order_history(v_order,v_token1);
 IF v_hist->>'status'<>'submitted' OR
    v_hist->>'paymentState'<>'not_requested' OR
    jsonb_array_length(v_hist->'events')<>1 OR
    v_hist#>>'{events,0,status}'<>'submitted' OR
    (v_hist#>'{events,0}')?'actorUserId'
 THEN RAISE EXCEPTION 'Initial guest timeline invalid'; END IF;
 v_hist:=rcat_private.merchant_order_history(
   v_kitchen,v_tenant,v_store,v_order);
 IF jsonb_array_length(v_hist->'events')<>1 THEN
   RAISE EXCEPTION 'Initial merchant history invalid'; END IF;

 denied:=false;
 BEGIN
  PERFORM rcat_private.transition_merchant_order(
    v_kitchen,v_tenant,v_store,v_order,'submitted','accepted');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unauthorized transition was accepted'; END IF;

 PERFORM rcat_private.transition_merchant_order(
   v_cashier,v_tenant,v_store,v_order,'submitted','accepted');
 denied:=false;
 BEGIN
  PERFORM rcat_private.transition_merchant_order(
    v_cashier,v_tenant,v_store,v_order,'submitted','cancelled');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale transition was accepted'; END IF;
 PERFORM rcat_private.transition_merchant_order(
   v_kitchen,v_tenant,v_store,v_order,'accepted','preparing');
 PERFORM rcat_private.transition_merchant_order(
   v_kitchen,v_tenant,v_store,v_order,'preparing','served');

 v_hist:=rcat_private.merchant_order_history(
   v_owner,v_tenant,v_store,v_order);
 IF v_hist->>'status'<>'served'
   OR v_hist->>'paymentState'<>'not_requested'
   OR jsonb_array_length(v_hist->'events')<>4
   OR v_hist#>>'{events,0,status}'<>'submitted'
   OR v_hist#>>'{events,1,fromStatus}'<>'submitted'
   OR v_hist#>>'{events,1,status}'<>'accepted'
   OR v_hist#>>'{events,2,fromStatus}'<>'accepted'
   OR v_hist#>>'{events,2,status}'<>'preparing'
   OR v_hist#>>'{events,3,fromStatus}'<>'preparing'
   OR v_hist#>>'{events,3,status}'<>'served'
 THEN RAISE EXCEPTION 'Merchant history sequence or status incorrect'; END IF;
 v_first:=(v_hist#>>'{events,1,eventId}')::bigint;
 v_second:=(v_hist#>>'{events,2,eventId}')::bigint;
 v_third:=(v_hist#>>'{events,3,eventId}')::bigint;
 IF v_first>=v_second OR v_second>=v_third
   OR v_hist#>>'{events,1,actorUserId}'
     <>'10000000-0000-4000-8000-000000000002'
   OR v_hist#>>'{events,2,actorUserId}'
     <>'10000000-0000-4000-8000-000000000003'
   OR v_hist#>>'{events,3,actorUserId}'
     <>'10000000-0000-4000-8000-000000000003'
   OR (v_hist#>'{events,1}')?'metadata'
 THEN RAISE EXCEPTION 'Merchant actor/audit ordering incorrect'; END IF;

 v_guest:=rcat_private.guest_order_history(v_order,v_token1);
 IF v_guest->'events' @> '[{"actorUserId":null}]'::jsonb
   OR (v_guest#>'{events,1}')?'actorUserId'
   OR (v_guest#>'{events,2}')?'actorUserId'
   OR (v_guest#>'{events,3}')?'actorUserId'
   OR (v_guest#>'{events,1}')?'metadata'
   OR jsonb_array_length(v_guest->'events')<>4
   OR v_guest->>'status'<>'served'
 THEN RAISE EXCEPTION 'Guest history leaked employee information'; END IF;

 v_out:=rcat_private.place_guest_order(
   v_visit,'history-checkout-002',v_cart);
 v_other:=(v_out->>'orderId')::uuid;
 PERFORM rcat_private.bind_guest_order_tracking(
   v_other,v_visit,'history-checkout-002',v_token2);
 PERFORM rcat_private.transition_merchant_order(
   v_cashier,v_tenant,v_store,v_other,'submitted','cancelled');
 v_guest:=rcat_private.guest_order_history(v_other,v_token2);
 IF v_guest->>'status'<>'cancelled' OR
   jsonb_array_length(v_guest->'events')<>2 OR
   v_guest#>>'{events,1,status}'<>'cancelled'
 THEN RAISE EXCEPTION 'Guest cancellation history incorrect'; END IF;

 denied:=false;
 BEGIN
  PERFORM rcat_private.guest_order_history(v_other,v_token1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-order history was readable'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.guest_order_history(v_order,v_wrong);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid guest bearer exposed history'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.guest_order_history(
    '11111111-1111-4111-8111-111111111111',v_token1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Guessable Order history leaked'; END IF;

 v_out:=rcat_private.place_guest_order(
   v_visit,'history-checkout-003',v_cart);
 v_unbound:=(v_out->>'orderId')::uuid;
 denied:=false;
 BEGIN
  PERFORM rcat_private.guest_order_history(v_unbound,v_token1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unbound legacy Order history leaked'; END IF;

 denied:=false;
 BEGIN
  PERFORM rcat_private.merchant_order_history(
    v_cashier,'00000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',v_order);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant merchant history leaked'; END IF;

 denied:=false;
 BEGIN
  PERFORM rcat_private.merchant_order_history(
    v_owner,v_tenant,v_store,'11111111-1111-4111-8111-111111111111');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unknown Order merchant history leaked'; END IF;

 denied:=false;
 BEGIN
  PERFORM rcat_private._order_status_timeline(
    v_tenant,v_store,v_order,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Private history helper was callable'; END IF;

 -- A rotated table QR stops checkout but must not remove historical status.
 PERFORM rcat_private.rotate_ordering_visit(
   v_owner,v_tenant,v_store,v_table,decode(repeat('7c',32),'hex'));
 v_guest:=rcat_private.guest_order_history(v_order,v_token1);
 IF v_guest->>'status'<>'served' OR
   jsonb_array_length(v_guest->'events')<>4
 THEN RAISE EXCEPTION 'Rotation destroyed Order history'; END IF;
 PERFORM set_config('test.history_order_id',v_order::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE v_id uuid:=current_setting('test.history_order_id')::uuid;
 v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM rcat.audit_events
 WHERE subject_id=v_id AND action='order.status.changed';
 IF v_count<>3 THEN
   RAISE EXCEPTION 'Rejected or repeated writes added extra audit entries'; END IF;
 SELECT count(*) INTO v_count FROM rcat.orders
 WHERE id=v_id AND amount_satang=23000 AND payment_state='not_requested';
 IF v_count<>1 THEN RAISE EXCEPTION 'History read modified Order amount/payment'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: guest/merchant timelines, privacy, ordering, stale writes, rotations, audit and RLS'
