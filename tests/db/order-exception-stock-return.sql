\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','manager');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
('10000000-0000-4000-8000-000000000001',
 decode(repeat('d1',32),'hex'),decode(repeat('d2',32),'hex'),now()+interval '1 hour'),
('10000000-0000-4000-8000-000000000002',
 decode(repeat('d3',32),'hex'),decode(repeat('d4',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 t uuid:='00000000-0000-4000-8000-000000000001';
 s uuid:='20000000-0000-4000-8000-000000000001';
 other_t uuid:='00000000-0000-4000-8000-000000000002';
 other_s uuid:='20000000-0000-4000-8000-000000000002';
 owner bytea:=decode(repeat('d1',32),'hex');
 manager bytea:=decode(repeat('d3',32),'hex');
 visit bytea:=decode(repeat('d5',32),'hex');
 cat uuid;product uuid;rice uuid;tab uuid;ordered uuid;req1 uuid;req2 uuid;
 r jsonb;cart jsonb;denied boolean;
BEGIN
 cat:=rcat_private.add_menu_category(owner,t,s,
   'exception-return-test','Exception CI category');
 product:=rcat_private.add_menu_product(owner,t,s,cat,'Prepared bowl',12900);
 rice:=rcat_private.inventory_create_item(owner,t,s,'Exception rice','g',100);
 PERFORM rcat_private.inventory_move(owner,t,s,rice,
   'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001','receipt',500,
   'Fixture initial recoverable ingredients');
 PERFORM rcat_private.inventory_set_recipe(owner,t,s,product,rice,100.500);
 PERFORM rcat_private.inventory_set_product_tracking(owner,t,s,product,true);
 tab:=rcat_private.create_ordering_table(owner,t,s,'Exception CI table');
 PERFORM rcat_private.rotate_ordering_visit(owner,t,s,tab,visit);
 cart:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object(
   'productId',product,'quantity',2,'optionIds',jsonb_build_array())));
 r:=rcat_private.place_guest_order(visit,'exception-order-ci1',cart);
 ordered:=(r->>'orderId')::uuid;

 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_request_exception_return(
     owner,t,s,ordered,rice,'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002',
     100,'unused_unopened','Not yet accepted kitchen return');
 EXCEPTION WHEN SQLSTATE 'P0008' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unaccepted Order exception allowed'; END IF;

 PERFORM rcat_private.transition_merchant_order(owner,t,s,ordered,
   'submitted','accepted');
 PERFORM rcat_private.transition_merchant_order(owner,t,s,ordered,
   'accepted','preparing');
 r:=rcat_private.inventory_exception_return_view(owner,t,s,ordered);
 IF r->>'eligible'<>'true' OR
   (r#>>'{allocations,0,allocated}')::numeric<>201.000 OR
   (r#>>'{allocations,0,remaining}')::numeric<>201.000
 THEN RAISE EXCEPTION 'Frozen allocation view invalid: %',r; END IF;

 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_request_exception_return(
     owner,t,s,ordered,rice,'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003',
     5,'damaged_food','Destroyed kitchen ingredients must not be restocked');
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Waste accepted as recoverable stock'; END IF;

 r:=rcat_private.inventory_request_exception_return(
   owner,t,s,ordered,rice,'eeeeeeee-eeee-4eee-8eee-eeeeeeee0004',
   100.125,'unused_unopened','Unused sealed rice, verified physically');
 req1:=(r->>'requestId')::uuid;
 IF r->>'state'<>'pending' OR r->>'replayed'<>'false' THEN
   RAISE EXCEPTION 'Initial request failed: %',r; END IF;
 r:=rcat_private.inventory_request_exception_return(
   owner,t,s,ordered,rice,'eeeeeeee-eeee-4eee-8eee-eeeeeeee0004',
   100.125,'unused_unopened','Unused sealed rice, verified physically');
 IF r->>'replayed'<>'true' OR (r->>'requestId')::uuid<>req1 THEN
   RAISE EXCEPTION 'Retry returned a new request'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_request_exception_return(
     owner,t,s,ordered,rice,'eeeeeeee-eeee-4eee-8eee-eeeeeeee0004',
     99,'unused_unopened','Unused sealed rice, verified physically');
 EXCEPTION WHEN unique_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Retry key changed amount'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_request_exception_return(
     owner,t,s,ordered,rice,'eeeeeeee-eeee-4eee-8eee-eeeeeeee0005',
     1,'unused_unopened','Duplicate pending request must be blocked');
 EXCEPTION WHEN unique_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Multiple pending returns allowed'; END IF;

 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_review_exception_return(
     owner,t,s,req1,true);
 EXCEPTION WHEN SQLSTATE 'P0007' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Requester self-approved'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_review_exception_return(
     manager,other_t,other_s,req1,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant reviewer allowed'; END IF;

 r:=rcat_private.inventory_review_exception_return(manager,t,s,req1,true);
 IF r->>'state'<>'approved' OR r->>'movementId' IS NULL OR
    r->>'replayed'<>'false' THEN
   RAISE EXCEPTION 'Approved partial return not posted: %',r; END IF;
 r:=rcat_private.inventory_review_exception_return(manager,t,s,req1,true);
 IF r->>'replayed'<>'true' THEN
   RAISE EXCEPTION 'Approved request posted twice'; END IF;
 r:=rcat_private.inventory_exception_return_view(owner,t,s,ordered);
 IF (r#>>'{allocations,0,remaining}')::numeric<>100.875 OR
    (r#>>'{allocations,0,alreadyReturned}')::numeric<>100.125 THEN
   RAISE EXCEPTION 'Partial return not reconciled: %',r; END IF;

 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_request_exception_return(
     manager,t,s,ordered,rice,'eeeeeeee-eeee-4eee-8eee-eeeeeeee0006',
     100.876,'kitchen_error_unconsumed','Unopened unused quantity');
 EXCEPTION WHEN SQLSTATE 'P0008' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Exceeded frozen allocation'; END IF;
 PERFORM rcat_private.transition_merchant_order(owner,t,s,ordered,
   'preparing','served');
 r:=rcat_private.inventory_request_exception_return(
   manager,t,s,ordered,rice,'eeeeeeee-eeee-4eee-8eee-eeeeeeee0007',
   100.875,'kitchen_error_unconsumed',
   'Unused portion preserved after kitchen handoff');
 req2:=(r->>'requestId')::uuid;
 r:=rcat_private.inventory_review_exception_return(owner,t,s,req2,true);
 IF r->>'state'<>'approved' THEN
   RAISE EXCEPTION 'Independent served return rejected: %',r; END IF;
 r:=rcat_private.inventory_exception_return_view(owner,t,s,ordered);
 IF (r#>>'{allocations,0,remaining}')::numeric<>0 THEN
   RAISE EXCEPTION 'Over-return invariant violated'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.inventory_request_exception_return(
     manager,t,s,ordered,rice,'eeeeeeee-eeee-4eee-8eee-eeeeeeee0008',
     0.001,'unused_unopened','No remaining physically unused stock');
 EXCEPTION WHEN SQLSTATE 'P0008' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Return exceeded total allocation'; END IF;
 PERFORM set_config('test.exception_order',ordered::text,true);
 PERFORM set_config('test.exception_item',rice::text,true);
 PERFORM set_config('test.exception_req1',req1::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE o uuid:=current_setting('test.exception_order')::uuid;
  item uuid:=current_setting('test.exception_item')::uuid;
  request_id uuid:=current_setting('test.exception_req1')::uuid;
BEGIN
 IF (SELECT count(*) FROM rcat.inventory_movements
     WHERE order_id=o AND kind='exception_return')<>2
 OR (SELECT sum(delta) FROM rcat.inventory_movements
     WHERE order_id=o AND kind='exception_return')<>201.000
 OR (SELECT on_hand FROM rcat.inventory_items WHERE id=item)<>500.000
 OR (SELECT status FROM rcat.orders WHERE id=o)<>'served'
 OR (SELECT payment_state FROM rcat.orders WHERE id=o)<>'not_requested'
 OR (SELECT count(*) FROM rcat.inventory_movements
     WHERE exception_return_id=request_id)<>1
 OR (SELECT count(*) FROM rcat.audit_events
     WHERE action='inventory.exception.approved' AND
       subject_id IN (SELECT id FROM rcat.inventory_exception_returns
         WHERE order_id=o))<>2
 THEN RAISE EXCEPTION 'Exception ledger or immutable Order invariants failed'; END IF;
END $$;
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN SELECT 1 FROM rcat.inventory_exception_returns LIMIT 1;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Restricted role read exception table'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: physically recoverable partial kitchen returns, dual review, exact cap, retry, audit and tenant isolation'
