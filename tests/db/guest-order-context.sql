\set ON_ERROR_STOP on
-- Focused G2 context tests: real SQL snapshots, unchanged server prices,
-- same-key conflict on name/delivery/note, staff-scoped Inbox and lookup.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES('10000000-0000-4000-8000-000000000001',
 decode(repeat('d5',32),'hex'),decode(repeat('f5',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 v_tenant uuid:='00000000-0000-4000-8000-000000000001';
 v_store uuid:='20000000-0000-4000-8000-000000000001';
 v_cat uuid; v_prod uuid; v_table uuid;
 v_cart jsonb; v_result jsonb; v_replay jsonb; v_order uuid;
 v_page jsonb; v_lookup jsonb; v_rejected boolean;
BEGIN
 v_cat:=rcat_private.add_menu_category(decode(repeat('d5',32),'hex'),
   v_tenant,v_store,'context-snapshot-test','Context snapshot test');
 v_prod:=rcat_private.add_menu_product(decode(repeat('d5',32),'hex'),
   v_tenant,v_store,v_cat,'ชาไทย',4500);
 v_table:=rcat_private.create_ordering_table(decode(repeat('d5',32),'hex'),
   v_tenant,v_store,'Context test table');
 PERFORM rcat_private.rotate_ordering_visit(decode(repeat('d5',32),'hex'),
   v_tenant,v_store,v_table,decode(repeat('b1',32),'hex'));
 PERFORM rcat_private.set_store_ordering_enabled(decode(repeat('d5',32),'hex'),
   v_tenant,v_store,true);
 v_cart:=jsonb_build_object(
   'orderedBy','นาย ก','deliverTo','อาคาร ข ชั้น 2',
   'items',jsonb_build_array(
     jsonb_build_object('productId',v_prod,'quantity',1,
       'optionIds','[]'::jsonb,'note','หวานน้อย'),
     jsonb_build_object('productId',v_prod,'quantity',1,
       'optionIds','[]'::jsonb,'note','ไม่ใส่น้ำแข็ง')
   ));
 v_rejected:=false;
 BEGIN
   PERFORM rcat_private.place_guest_order_when_open(
     decode(repeat('b1',32),'hex'),'context-no-name-0001',v_cart-'orderedBy');
 EXCEPTION WHEN invalid_parameter_value THEN v_rejected:=true;
 END;
 IF NOT v_rejected THEN RAISE EXCEPTION 'Missing orderedBy accepted'; END IF;
 v_rejected:=false;
 BEGIN
   PERFORM rcat_private.place_guest_order_when_open(
     decode(repeat('b1',32),'hex'),'context-empty-place-0001',
     jsonb_set(v_cart,'{deliverTo}','"   "'::jsonb));
 EXCEPTION WHEN invalid_parameter_value THEN v_rejected:=true;
 END;
 IF NOT v_rejected THEN RAISE EXCEPTION 'Blank deliverTo accepted'; END IF;
 v_result:=rcat_private.place_guest_order_when_open(
   decode(repeat('b1',32),'hex'),'context-key-valid-0001',v_cart);
 IF (v_result->>'amountSatang')::bigint<>9000
   OR v_result->>'paymentState'<>'not_requested' THEN
   RAISE EXCEPTION 'Order price/payment authority changed';
 END IF;
 v_order:=(v_result->>'orderId')::uuid;
 v_replay:=rcat_private.place_guest_order_when_open(
   decode(repeat('b1',32),'hex'),'context-key-valid-0001',v_cart);
 IF v_replay->>'orderId'<>v_order::text OR
   (v_replay->>'replayed')::boolean IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Stable same-key request failed replay';
 END IF;
 FOREACH v_cart IN ARRAY ARRAY[
   jsonb_set(v_cart,'{orderedBy}','"นาย ข"'::jsonb),
   jsonb_set(v_cart,'{deliverTo}','"อาคาร ค"'::jsonb),
   jsonb_set(v_cart,'{items,0,note}','"หวานมาก"'::jsonb)
 ] LOOP
   v_rejected:=false;
   BEGIN
     PERFORM rcat_private.place_guest_order_when_open(
       decode(repeat('b1',32),'hex'),'context-key-valid-0001',v_cart);
   EXCEPTION WHEN unique_violation THEN v_rejected:=true;
   END;
   IF NOT v_rejected THEN RAISE EXCEPTION 'Changed order context replayed'; END IF;
 END LOOP;
 v_page:=rcat_private.merchant_order_inbox_page(
   decode(repeat('d5',32),'hex'),v_tenant,v_store,NULL,25,NULL,NULL);
 IF v_page->'orders'->0->>'orderedBy'<>'นาย ก'
   OR v_page->'orders'->0->>'deliverTo'<>'อาคาร ข ชั้น 2'
   OR (SELECT count(*) FROM jsonb_array_elements(
     v_page->'orders'->0->'items') x
     WHERE x->>'note' IN ('หวานน้อย','ไม่ใส่น้ำแข็ง'))<>2 THEN
   RAISE EXCEPTION 'Merchant Inbox missing persisted context/notes';
 END IF;
 v_lookup:=rcat_private.merchant_order_lookup_ids(
   decode(repeat('d5',32),'hex'),v_tenant,v_store,ARRAY[v_order]);
 IF v_lookup->'orders'->0->>'orderedBy'<>'นาย ก'
   OR v_lookup->'orders'->0->>'deliverTo'<>'อาคาร ข ชั้น 2'
   OR jsonb_array_length(v_lookup->'orders'->0->'items')<>2 THEN
   RAISE EXCEPTION 'Merchant reconnect lookup lost context';
 END IF;
 PERFORM set_config('test.context_order',v_order::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE v_order uuid:=current_setting('test.context_order')::uuid;
BEGIN
 IF (SELECT count(*) FROM rcat.orders
   WHERE id=v_order AND ordered_by='นาย ก'
     AND deliver_to='อาคาร ข ชั้น 2' AND amount_satang=9000)<>1 THEN
   RAISE EXCEPTION 'Identity/delivery SQL snapshot missing';
 END IF;
 IF (SELECT count(*) FROM rcat.order_items
   WHERE order_id=v_order AND product_name='ชาไทย'
     AND unit_price_satang=4500 AND line_total_satang=4500
     AND special_instructions IN ('หวานน้อย','ไม่ใส่น้ำแข็ง'))<>2 THEN
   RAISE EXCEPTION 'Differently noted line snapshots merged/lost';
 END IF;
END $$;
ROLLBACK;
\echo 'PASS: order context, notes, SQL validation, payment independence and merchant recovery'
