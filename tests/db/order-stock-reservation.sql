\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES ('00000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002','cashier');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
        decode(repeat('a1',32),'hex'),decode(repeat('a3',32),'hex'),now()+interval '1 hour'),
       ('10000000-0000-4000-8000-000000000002',
        decode(repeat('a2',32),'hex'),decode(repeat('a4',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 t uuid:='00000000-0000-4000-8000-000000000001';
 s uuid:='20000000-0000-4000-8000-000000000001';
 owner bytea:=decode(repeat('a1',32),'hex');
 cashier bytea:=decode(repeat('a2',32),'hex');
 visit bytea:=decode(repeat('aa',32),'hex');
 cat uuid;product uuid;side uuid;grp uuid;opt uuid;
 rice uuid;broth uuid;tab uuid;ordered uuid;other uuid;
 result jsonb;cart jsonb;denied boolean;
BEGIN
 cat:=rcat_private.add_menu_category(owner,t,s,'stock-order-ci','Stock CI');
 product:=rcat_private.add_menu_product(owner,t,s,cat,'Soup',11900);
 side:=rcat_private.add_menu_product(owner,t,s,cat,'Untracked',5900);
 rice:=rcat_private.inventory_create_item(owner,t,s,'Rice','g',100);
 broth:=rcat_private.inventory_create_item(owner,t,s,'Broth','ml',200);
 PERFORM rcat_private.inventory_move(owner,t,s,rice,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001','receipt',5000,'Rice delivery');
 PERFORM rcat_private.inventory_move(owner,t,s,broth,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002','receipt',5000,'Broth delivery');
 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_set_product_tracking(owner,t,s,product,true);
 EXCEPTION WHEN SQLSTATE 'P0005' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Accepted tracked product without base recipe'; END IF;

 PERFORM rcat_private.inventory_set_recipe(owner,t,s,product,rice,100.500);
 grp:=rcat_private.add_modifier_group(owner,t,s,product,'extra-broth','Broth',0,1);
 opt:=rcat_private.add_modifier_option(owner,t,s,product,grp,'Extra broth',3500);
 PERFORM rcat_private.inventory_set_modifier_recipe(
   owner,t,s,product,grp,opt,broth,30.250);
 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_set_product_tracking(cashier,t,s,product,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cashier enabled tracking'; END IF;
 PERFORM rcat_private.inventory_set_product_tracking(owner,t,s,product,true);
 result:=rcat_private.inventory_snapshot(owner,t,s);
 IF result->>'stockMode'<>'order_acceptance_opt_in'
   OR result->>'orderConsumptionEnabled'<>'true'
   OR jsonb_array_length(result->'modifierRecipes')<>1
 THEN RAISE EXCEPTION 'Snapshot missing opt-in config: %',result; END IF;
 tab:=rcat_private.create_ordering_table(owner,t,s,'Stock CI table');
 PERFORM rcat_private.rotate_ordering_visit(owner,t,s,tab,visit);
 cart:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object(
   'productId',product,'quantity',2,'optionIds',jsonb_build_array(opt))));
 result:=rcat_private.place_guest_order(visit,'stock-accept-order-ci1',cart);
 ordered:=(result->>'orderId')::uuid;
 result:=rcat_private.transition_merchant_order(
   cashier,t,s,ordered,'submitted','accepted');
 IF result->>'inventoryMovementCount'<>'2'
   OR result->>'paymentState'<>'not_requested'
   OR (SELECT (x->>'onHand')::numeric
       FROM jsonb_array_elements(
         (rcat_private.inventory_snapshot(owner,t,s))->'items') x
       WHERE x->>'itemId'=rice::text)<>4799.000
   OR (SELECT (x->>'onHand')::numeric
       FROM jsonb_array_elements(
         (rcat_private.inventory_snapshot(owner,t,s))->'items') x
       WHERE x->>'itemId'=broth::text)<>4939.500
 THEN RAISE EXCEPTION 'Accept failed base+option consumption'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.transition_merchant_order(
     cashier,t,s,ordered,'submitted','accepted');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Duplicate accepted Order'; END IF;
 PERFORM rcat_private.inventory_set_recipe(owner,t,s,product,rice,400.000);
 PERFORM rcat_private.inventory_set_modifier_recipe(
   owner,t,s,product,grp,opt,broth,600.000);
 result:=rcat_private.transition_merchant_order(
   cashier,t,s,ordered,'accepted','cancelled');
 IF result->>'inventoryMovementCount'<>'2'
   OR (SELECT (x->>'onHand')::numeric
       FROM jsonb_array_elements(
         (rcat_private.inventory_snapshot(owner,t,s))->'items') x
       WHERE x->>'itemId'=rice::text)<>5000.000
   OR (SELECT (x->>'onHand')::numeric
       FROM jsonb_array_elements(
         (rcat_private.inventory_snapshot(owner,t,s))->'items') x
       WHERE x->>'itemId'=broth::text)<>5000.000
 THEN RAISE EXCEPTION 'Cancellation did not return frozen quantity'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.transition_merchant_order(
     cashier,t,s,ordered,'accepted','cancelled');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Double cancellation return'; END IF;

 cart:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object(
   'productId',side,'quantity',1,'optionIds',jsonb_build_array())));
 result:=rcat_private.place_guest_order(visit,'stock-untracked-order-ci',cart);
 other:=(result->>'orderId')::uuid;
 result:=rcat_private.transition_merchant_order(
   cashier,t,s,other,'submitted','accepted');
 IF result->>'inventoryMovementCount'<>'0'
 THEN RAISE EXCEPTION 'Legacy untracked item consumed stock'; END IF;

 PERFORM set_config('test.stock_accepted',ordered::text,true);
 PERFORM set_config('test.stock_untracked',other::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE id uuid:=current_setting('test.stock_accepted')::uuid;
  untracked uuid:=current_setting('test.stock_untracked')::uuid;
BEGIN
 IF (SELECT count(*) FROM rcat.inventory_movements
     WHERE order_id=id AND kind='order_consumption')<>2
 OR (SELECT count(*) FROM rcat.inventory_movements
     WHERE order_id=id AND kind='order_return')<>2
 OR (SELECT count(*) FROM rcat.audit_events
     WHERE subject_id=id AND action='inventory.order.allocated')<>1
 OR (SELECT count(*) FROM rcat.audit_events
     WHERE subject_id=id AND action='inventory.order.returned')<>1
 OR (SELECT count(*) FROM rcat.inventory_order_allocations
     WHERE order_id=id AND returned_at IS NOT NULL)<>2
 OR EXISTS(SELECT 1 FROM rcat.inventory_order_allocations
     WHERE order_id=untracked)
 THEN RAISE EXCEPTION 'Audited inventory movements duplicated or missing'; END IF;
END $$;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN SELECT 1 FROM rcat.inventory_order_allocations LIMIT 1;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'rcat_app read private allocations'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: modifier ingredient Order acceptance, exact frozen return, legacy opt-out, CAS and audit'
