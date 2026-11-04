\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
 decode(repeat('d1',32),'hex'),decode(repeat('d2',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 t uuid:='00000000-0000-4000-8000-000000000001';
 s uuid:='20000000-0000-4000-8000-000000000001';
 foreign_t uuid:='00000000-0000-4000-8000-000000000002';
 foreign_s uuid:='20000000-0000-4000-8000-000000000002';
 owner bytea:=decode(repeat('d1',32),'hex');
 visit bytea:=decode(repeat('da',32),'hex');
 cat uuid;p uuid;ingredient uuid;other uuid;tab uuid;order_id uuid;
 result jsonb;cart jsonb;denied boolean;stock_snapshot jsonb;
BEGIN
 cat:=rcat_private.add_menu_category(owner,t,s,'stock-shortage-ci','Shortage');
 p:=rcat_private.add_menu_product(owner,t,s,cat,'Limited soup',5900);
 ingredient:=rcat_private.inventory_create_item(owner,t,s,'Limited rice','g',0);
 other:=rcat_private.inventory_create_item(owner,t,s,'Shared broth','ml',0);
 PERFORM rcat_private.inventory_move(owner,t,s,ingredient,
 'dddddddd-dddd-4ddd-8ddd-dddddddddd01','receipt',5,'Initial stock');
 PERFORM rcat_private.inventory_move(owner,t,s,other,
 'dddddddd-dddd-4ddd-8ddd-dddddddddd02','receipt',2,'Initial broth');
 PERFORM rcat_private.inventory_set_recipe(owner,t,s,p,ingredient,4.000);
 PERFORM rcat_private.inventory_set_recipe(owner,t,s,p,other,3.000);
 PERFORM rcat_private.inventory_set_product_tracking(owner,t,s,p,true);
 tab:=rcat_private.create_ordering_table(owner,t,s,'Stock shortage CI');
 PERFORM rcat_private.rotate_ordering_visit(owner,t,s,tab,visit);
 cart:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object(
   'productId',p,'quantity',1,'optionIds',jsonb_build_array())));
 result:=rcat_private.place_guest_order(
   visit,'stock-shortage-ci-00001',cart);
 order_id:=(result->>'orderId')::uuid;
 denied:=false;
 BEGIN
   PERFORM rcat_private.transition_merchant_order(
     owner,t,s,order_id,'submitted','accepted');
 EXCEPTION WHEN SQLSTATE 'P0004' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Short stock accepted'; END IF;
 stock_snapshot:=rcat_private.inventory_snapshot(owner,t,s);
 IF (SELECT (x->>'onHand')::numeric FROM
   jsonb_array_elements(stock_snapshot->'items') x
   WHERE x->>'itemId'=ingredient::text)<>5.000
   OR (SELECT (x->>'onHand')::numeric FROM
   jsonb_array_elements(stock_snapshot->'items') x
   WHERE x->>'itemId'=other::text)<>2.000
   OR (SELECT count(*) FROM jsonb_array_elements(
     stock_snapshot->'recentMovements') x)<>2
 THEN RAISE EXCEPTION 'Partial ingredient deduction was not rolled back'; END IF;

 PERFORM rcat_private.inventory_move(owner,t,s,other,
   'dddddddd-dddd-4ddd-8ddd-dddddddddd03','receipt',3,
   'Replenish broth');
 result:=rcat_private.transition_merchant_order(
   owner,t,s,order_id,'submitted','accepted');
 IF result->>'inventoryMovementCount'<>'2' THEN
   RAISE EXCEPTION 'Replenished Order failed: %',result; END IF;

 -- A cross-tenant manager cannot configure a foreign product or modify
 -- its option recipes simply by knowing UUIDs.
 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_set_product_tracking(
     owner,foreign_t,foreign_s,p,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign store tracking allowed'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_set_modifier_recipe(
     owner,foreign_t,foreign_s,p,
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',ingredient,1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign modifier recipe accepted'; END IF;
 PERFORM set_config('test.short_order',order_id::text,true);
 PERFORM set_config('test.short_item',ingredient::text,true);
 PERFORM set_config('test.short_other',other::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE id uuid:=current_setting('test.short_order')::uuid;
  ingredient uuid:=current_setting('test.short_item')::uuid;
  other uuid:=current_setting('test.short_other')::uuid;
BEGIN
 IF (SELECT status FROM rcat.orders WHERE id=id)<>'accepted'
   OR (SELECT on_hand FROM rcat.inventory_items WHERE id=ingredient)<>1
   OR (SELECT on_hand FROM rcat.inventory_items WHERE id=other)<>2
   OR (SELECT count(*) FROM rcat.inventory_order_allocations
     WHERE order_id=id)<>2
   OR (SELECT count(*) FROM rcat.order_outbox_events
     WHERE order_id=id AND event_type='order.status.changed')<>1
 THEN RAISE EXCEPTION 'Failed attempt leaked status/outbox/stock, or retry not atomic'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: shortage atomically rolls back all ingredient locks and Order/outbox; replenishment succeeds and tenants cannot cross-edit'
