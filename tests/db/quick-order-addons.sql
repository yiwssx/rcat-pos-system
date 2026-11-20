\set ON_ERROR_STOP on
-- C / Issue #102. Disposable CI only, no public QR as an Order bearer.
BEGIN;
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES('00000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000002','cashier');
INSERT INTO rcat_private.auth_sessions(
  user_id,token_digest,csrf_digest,expires_at
) VALUES
('10000000-0000-4000-8000-000000000001',
 decode(repeat('c1',32),'hex'),decode(repeat('d1',32),'hex'),
 now()+interval '1 hour'),
('10000000-0000-4000-8000-000000000002',
 decode(repeat('c2',32),'hex'),decode(repeat('d2',32),'hex'),
 now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 t uuid:='00000000-0000-4000-8000-000000000001';
 s uuid:='20000000-0000-4000-8000-000000000001';
 foreign_t uuid:='00000000-0000-4000-8000-000000000002';
 foreign_s uuid:='20000000-0000-4000-8000-000000000002';
 owner bytea:=decode(repeat('c1',32),'hex');
 cashier bytea:=decode(repeat('c2',32),'hex');
 guest_a bytea:=decode(repeat('a1',32),'hex');
 guest_b bytea:=decode(repeat('a2',32),'hex');
 guest_stale bytea:=decode(repeat('a3',32),'hex');
 qr uuid;cat uuid; product uuid; stock uuid;
 order_a uuid;order_b uuid;order_after uuid;
 request jsonb;result jsonb;first jsonb;other jsonb;
 denied boolean;remaining numeric;my jsonb;
BEGIN
 cat:=rcat_private.add_menu_category(
   owner,t,s,'quick-c-ci','Quick C');
 product:=rcat_private.add_menu_product(
   owner,t,s,cat,'Quick coffee',6500);
 stock:=rcat_private.inventory_create_item(
   owner,t,s,'C Quick milk','ml',200);
 PERFORM rcat_private.inventory_move(owner,t,s,stock,
   '11111111-1111-4111-8111-111111111111','receipt',5000,
   'Batched milk delivery');
 PERFORM rcat_private.inventory_set_recipe(owner,t,s,product,stock,100);
 PERFORM rcat_private.inventory_set_product_tracking(owner,t,s,product,true);

 PERFORM rcat_private.set_store_service_mode(owner,t,s,'quick',0);
 qr:=(rcat_private.rotate_store_qr(owner,t,s)->>'publicId')::uuid;
 PERFORM rcat_private.set_store_ordering_enabled(owner,t,s,true);
 result:=rcat_private.open_printed_store_qr(t,s,qr,guest_a);
 IF NOT (result->>'open')::boolean THEN RAISE EXCEPTION 'Counter QR denied'; END IF;
 result:=rcat_private.open_printed_store_qr(t,s,qr,guest_b);
 IF NOT (result->>'open')::boolean THEN RAISE EXCEPTION 'Second client denied'; END IF;

 -- D: menu and selected-item review use the private counter capability.
 result:=rcat_private.quick_guest_catalog_page(guest_a,'Quick coffee',cat,NULL,NULL,24);
 IF result->>'entryMode'<>'counter'
   OR jsonb_array_length(result->'products')<>1
   OR result->'products'->0->>'id'<>product::text
   OR result?'tableId' OR result?'visitId' THEN
   RAISE EXCEPTION 'Counter menu returned wrong scope or fake Table Visit'; END IF;
 result:=rcat_private.quick_guest_cart_review(guest_b,ARRAY[product],ARRAY[]::uuid[]);
 IF jsonb_array_length(result->'products')<>1
   OR result->'products'->0->>'priceSatang'<>'6500' THEN
   RAISE EXCEPTION 'Counter cart review incorrect'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.quick_guest_catalog_page(
     guest_stale,'',NULL,NULL,NULL,24);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unknown guest can browse private counter menu'; END IF;

 request:=jsonb_build_object(
  'orderedBy','Customer A','deliverTo','Counter',
  'items',jsonb_build_array(jsonb_build_object(
    'productId',product,'quantity',1,'optionIds','[]'::jsonb,
    'note','Less ice'
  ))
 );
 first:=rcat_private.quick_order_submit(
   guest_a,'quick-first-c-00001',request,NULL);
 order_a:=(first->>'orderId')::uuid;
 IF order_a IS NULL OR first->>'action'<>'created'
   OR first->>'amountSatang'<>'6500' OR
   first->>'paymentState'<>'not_requested'
 THEN RAISE EXCEPTION 'Initial Quick Order not properly created'; END IF;
 other:=rcat_private.quick_order_submit(
   guest_b,'quick-second-c-0001',
   jsonb_set(request,'{orderedBy}','"Customer B"'::jsonb),NULL);
 order_b:=(other->>'orderId')::uuid;
 IF order_a=order_b OR order_b IS NULL THEN
   RAISE EXCEPTION 'Two customers shared a Quick Order'; END IF;

 my:=rcat_private.quick_order_my_orders(guest_a);
 IF jsonb_array_length(my->'orders')<>1
   OR my->'orders'->0->>'orderId'<>order_a::text THEN
   RAISE EXCEPTION 'Customer A can see foreign orders'; END IF;
 my:=rcat_private.quick_order_my_orders(guest_b);
 IF jsonb_array_length(my->'orders')<>1
   OR my->'orders'->0->>'orderId'<>order_b::text THEN
   RAISE EXCEPTION 'Customer B can see foreign orders'; END IF;

 denied:=false;
 BEGIN
   PERFORM rcat_private.quick_order_submit(
     guest_b,'quick-forged-c-0001',request,order_a);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign customer appended Order'; END IF;

 result:=rcat_private.quick_order_submit(
   guest_a,'quick-first-c-00001',request,NULL);
 IF NOT (result->>'replayed')::boolean OR
   (result->>'orderId')::uuid<>order_a THEN
   RAISE EXCEPTION 'Order creation retried twice'; END IF;

 denied:=false;
 BEGIN
   PERFORM rcat_private.quick_order_submit(
     guest_a,'quick-first-c-00001',
     jsonb_set(request,'{orderedBy}','"Other Name"'::jsonb),NULL);
 EXCEPTION WHEN unique_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Changed Cart idempotency reused'; END IF;

 result:=rcat_private.quick_order_submit(
   guest_a,'quick-append-c-00001',request,order_a);
 IF result->>'action'<>'appended' OR result->>'addedSatang'<>'6500'
   OR result->>'amountSatang'<>'13000' OR
   (result->>'orderId')::uuid<>order_a THEN
   RAISE EXCEPTION 'Submitted add-on lost Order identity or amount'; END IF;
 result:=rcat_private.quick_order_submit(
   guest_a,'quick-append-c-00001',request,order_a);
 IF NOT (result->>'replayed')::boolean THEN
   RAISE EXCEPTION 'Duplicate append created extra items'; END IF;

 result:=rcat_private.transition_merchant_order(
   cashier,t,s,order_a,'submitted','accepted');
 IF result->>'inventoryMovementCount'<>'1' THEN
   RAISE EXCEPTION 'Acceptance did not allocate initial+append stock'; END IF;
 remaining:=(SELECT (x->>'onHand')::numeric
    FROM jsonb_array_elements(
      (rcat_private.inventory_snapshot(owner,t,s))->'items') x
    WHERE x->>'itemId'=stock::text);
 IF remaining<>4800 THEN RAISE EXCEPTION 'Wrong stock after acceptance: %',remaining; END IF;

 result:=rcat_private.quick_order_submit(
   guest_a,'quick-postaccept-0001',request,order_a);
 IF result->>'action'<>'appended' OR result->>'amountSatang'<>'19500' THEN
   RAISE EXCEPTION 'Accepted but not preparing Order rejected add-on'; END IF;
 remaining:=(SELECT (x->>'onHand')::numeric
    FROM jsonb_array_elements(
      (rcat_private.inventory_snapshot(owner,t,s))->'items') x
    WHERE x->>'itemId'=stock::text);
 IF remaining<>4700 THEN
   RAISE EXCEPTION 'Accepted add-on was not allocated once: %',remaining; END IF;
 PERFORM rcat_private.quick_order_submit(
   guest_a,'quick-postaccept-0001',request,order_a);
 remaining:=(SELECT (x->>'onHand')::numeric
    FROM jsonb_array_elements(
      (rcat_private.inventory_snapshot(owner,t,s))->'items') x
    WHERE x->>'itemId'=stock::text);
 IF remaining<>4700 THEN
   RAISE EXCEPTION 'Idempotent add-on consumed extra inventory'; END IF;

 -- Accepted != Preparing. Kitchen starts cooking explicitly.
 PERFORM rcat_private.transition_merchant_order(
   owner,t,s,order_a,'accepted','preparing');
 result:=rcat_private.quick_order_submit(
   guest_a,'quick-afterprep-0001',request,order_a);
 order_after:=(result->>'orderId')::uuid;
 IF result->>'action'<>'new_after_cutoff'
   OR order_after=order_a OR result->>'amountSatang'<>'6500' THEN
   RAISE EXCEPTION 'Preparing order was mutated instead of new Order'; END IF;

 denied:=false;
 BEGIN
   PERFORM rcat_private.quick_order_submit(
     guest_b,'quick-afterprep-b1',request,order_after);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN
   RAISE EXCEPTION 'Foreign guest modified post-Preparing Order'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.quick_order_submit(
     guest_a,'quick-crossstore-1',request,
       '00000000-0000-4000-8000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign Order UUID bypassed scope'; END IF;

 PERFORM set_config('test.quick.order_a',order_a::text,true);
 PERFORM set_config('test.quick.order_b',order_b::text,true);
 PERFORM set_config('test.quick.order_after',order_after::text,true);
 PERFORM set_config('test.quick.stock',stock::text,true);

 -- Session revocation is authoritative for both read and write.
 PERFORM rcat_private.rotate_store_qr(owner,t,s);
 denied:=false;
 BEGIN
   PERFORM rcat_private.quick_order_my_orders(guest_a);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Old token read after QR rotation'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.quick_guest_cart_review(guest_a,ARRAY[product],ARRAY[]::uuid[]);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Revoked guest can review counter cart'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.quick_order_submit(
     guest_a,'quick-revoked-c-1',request,NULL);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Revoked customer created new Order'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
 a uuid:=current_setting('test.quick.order_a')::uuid;
 b uuid:=current_setting('test.quick.order_b')::uuid;
 n uuid:=current_setting('test.quick.order_after')::uuid;
 item uuid:=current_setting('test.quick.stock')::uuid;
BEGIN
 IF (SELECT count(*) FROM rcat.orders
    WHERE id IN (a,b,n) AND table_id IS NULL AND visit_id IS NULL
      AND quick_session_id IS NOT NULL)<>3 THEN
   RAISE EXCEPTION 'Quick Orders not isolated from Table Visits'; END IF;
 IF (SELECT count(*) FROM rcat.order_items WHERE order_id=a)<>3
   OR (SELECT sum(amount_satang) FROM rcat.orders WHERE id=a)<>19500 THEN
   RAISE EXCEPTION 'Quick append duplicated/missed snapshot lines'; END IF;
 IF (SELECT quantity FROM rcat.inventory_order_allocations
   WHERE order_id=a AND item_id=item)<>300 THEN
   RAISE EXCEPTION 'Accepted add-on allocation did not aggregate correctly'; END IF;
 IF (SELECT count(*) FROM rcat.inventory_movements
   WHERE order_id=a AND kind='order_consumption')<>2 THEN
   RAISE EXCEPTION 'Guest add-on inventory movement missing'; END IF;
 IF (SELECT count(*) FROM rcat.order_outbox_events
   WHERE order_id=a AND event_type='order.items.added')<>2 THEN
   RAISE EXCEPTION 'Quick add-on outbox events duplicated/lost'; END IF;
 IF (SELECT count(*) FROM rcat.audit_events WHERE subject_id=a
   AND action='order.quick.appended')<>2 THEN
   RAISE EXCEPTION 'Guest append audit duplicated/lost'; END IF;
 IF (SELECT count(*) FROM rcat.audit_events WHERE subject_id=n
   AND action='order.quick.new_after_cutoff')<>1 THEN
   RAISE EXCEPTION 'Preparing cutoff outcome was not audited'; END IF;
 IF EXISTS (SELECT 1 FROM rcat.bills b
   WHERE b.visit_id IS NULL) THEN
   RAISE EXCEPTION 'Counter Order forged a Table Bill'; END IF;
END $$;
SET LOCAL ROLE rcat_app;
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN PERFORM 1 FROM rcat_private.quick_order_actions;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'App role can read customer action ledger'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: person-scoped Quick Order, submitted/accepted add-ons, stock deltas, explicit Preparing cutoff, idempotency and revocation'
