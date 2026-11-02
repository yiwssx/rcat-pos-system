\set ON_ERROR_STOP on
-- Isolated CI transaction; no order or payment data is persisted.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES('10000000-0000-4000-8000-000000000001',
 decode(repeat('d5',32),'hex'),decode(repeat('f5',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE v_cat uuid;v_prod uuid;v_group uuid;v_opt uuid;v_table uuid;
 v_result jsonb;v_replay jsonb;v_cart jsonb;v_bad jsonb;denied boolean;v_num integer;v_order uuid;
BEGIN
 v_cat:=rcat_private.add_menu_category(
  decode(repeat('d5',32),'hex'),'00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','orders-test','Order test');
 v_prod:=rcat_private.add_menu_product(
  decode(repeat('d5',32),'hex'),'00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',v_cat,'ข้าวผัด',8000);
 v_group:=rcat_private.add_modifier_group(
  decode(repeat('d5',32),'hex'),'00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  v_prod,'required-extra','Extra',1,1);
 v_opt:=rcat_private.add_modifier_option(
  decode(repeat('d5',32),'hex'),'00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  v_prod,v_group,'ไข่ดาว',1500);
 v_table:=rcat_private.create_ordering_table(
  decode(repeat('d5',32),'hex'),'00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','Orders test table');
 PERFORM rcat_private.rotate_ordering_visit(
  decode(repeat('d5',32),'hex'),'00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  v_table,decode(repeat('ab',32),'hex'));
 v_cart:=jsonb_build_object('items',jsonb_build_array(
  jsonb_build_object('productId',v_prod,'quantity',2,
   'optionIds',jsonb_build_array(v_opt))));
 denied:=false;
 BEGIN
  PERFORM rcat_private.place_guest_order(decode(repeat('ab',32),'hex'),
   'testmissingmodifier0001',
   jsonb_build_object('items',jsonb_build_array(
     jsonb_build_object('productId',v_prod,'quantity',1,
       'optionIds',jsonb_build_array()))));
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Required add-on was skipped'; END IF;
 v_result:=rcat_private.place_guest_order(decode(repeat('ab',32),'hex'),
  'sql-repeat-key-test001',v_cart);
 IF (v_result->>'amountSatang')::bigint<>19000
   OR v_result->>'paymentState'<>'not_requested'
   OR v_result->>'currency'<>'THB'
   OR (v_result->>'replayed')::boolean
 THEN RAISE EXCEPTION 'Order amount/state not server-derived'; END IF;
 v_order:=(v_result->>'orderId')::uuid;
 v_replay:=rcat_private.place_guest_order(decode(repeat('ab',32),'hex'),
  'sql-repeat-key-test001',v_cart);
 IF (v_replay->>'orderId')::uuid<>v_order
   OR NOT (v_replay->>'replayed')::boolean
 THEN RAISE EXCEPTION 'Idempotent replay created another order'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.place_guest_order(decode(repeat('ab',32),'hex'),
   'sql-repeat-key-test001',
    jsonb_build_object('items',jsonb_build_array(
      jsonb_build_object('productId',v_prod,'quantity',3,
       'optionIds',jsonb_build_array(v_opt)))));
 EXCEPTION WHEN unique_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Changed cart accepted under same key'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.place_guest_order(decode(repeat('ab',32),'hex'),
   'testduplicateoption0001',
   jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('productId',v_prod,'quantity',1,
     'optionIds',jsonb_build_array(v_opt,v_opt)))));
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Duplicate option was accepted'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.place_guest_order(decode(repeat('ab',32),'hex'),
   'testwrongproduct00001',
   jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('productId','10000000-0000-4000-8000-000000000001',
     'quantity',1,'optionIds',jsonb_build_array(v_opt)))));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign product was accepted'; END IF;
 PERFORM rcat_private.set_menu_product_availability(
  decode(repeat('d5',32),'hex'),'00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',v_prod,false);
 denied:=false;
 BEGIN
  PERFORM rcat_private.place_guest_order(decode(repeat('ab',32),'hex'),
   'testinvaliditem000001',v_cart);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Sold out product ordered'; END IF;
 SELECT count(*) INTO v_num FROM rcat.orders WHERE id=v_order
  AND amount_satang=19000 AND payment_state='not_requested'
  AND status='submitted';
 IF v_num<>1 THEN RAISE EXCEPTION 'Persisted order mutated after catalog change'; END IF;
 SELECT count(*) INTO v_num FROM rcat.order_items WHERE order_id=v_order
   AND product_name='ข้าวผัด' AND quantity=2 AND base_price_satang=8000
   AND unit_price_satang=9500 AND line_total_satang=19000
   AND jsonb_array_length(option_snapshots)=1;
 IF v_num<>1 THEN RAISE EXCEPTION 'Order line snapshot not immutable'; END IF;
 PERFORM rcat_private.rotate_ordering_visit(
  decode(repeat('d5',32),'hex'),'00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  v_table,decode(repeat('ac',32),'hex'));
 denied:=false;
 BEGIN
  PERFORM rcat_private.place_guest_order(decode(repeat('ab',32),'hex'),
   'testexpiredvisit00001',v_cart);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Rotated old visit placed another order'; END IF;
 denied:=false;
 BEGIN
  SELECT count(*) INTO v_num FROM rcat.order_items;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'auth role read order snapshots directly'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.orders)<>0 OR
    (SELECT count(*) FROM rcat.order_items)<>0 THEN
  RAISE EXCEPTION 'Cross-tenant Order RLS leaked'; END IF;
END $$;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000001',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.orders)<>1 OR
    (SELECT count(*) FROM rcat.order_items)<>1 THEN
  RAISE EXCEPTION 'Order and item count incorrect'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: guest order snapshots, selection rules, isolation, idempotency, and payment placeholder'
